// src/lib/parsers/claude-messages.ts
import { readFileSync } from "node:fs";
import type { Message } from "../normalize";

// Claude persists two compaction markers as top-level keys on their own JSONL
// line: `compactMetadata` (full) and `microcompactMetadata` (micro). Full lines
// carry preTokens/postTokens (saved = pre - post); micro lines carry an explicit
// tokensSaved. Shared by the cached scan pass (claude.ts) and this parser.
export function detectClaudeCompaction(obj: any): "full" | "micro" | null {
  if (obj?.microcompactMetadata) return "micro";
  if (obj?.compactMetadata) return "full";
  return null;
}

export function claudeCompactionSaved(obj: any): number {
  if (obj?.microcompactMetadata) {
    const s = obj.microcompactMetadata.tokensSaved;
    return typeof s === "number" && s > 0 ? s : 0;
  }
  if (obj?.compactMetadata) {
    const pre = obj.compactMetadata.preTokens;
    const post = obj.compactMetadata.postTokens;
    if (typeof pre === "number" && typeof post === "number" && pre > post) {
      return pre - post;
    }
  }
  return 0;
}

function extractUserText(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c) => c && c.type === "text" && typeof c.text === "string")
      .map((c) => c.text)
      .join("\n");
  }
  return "";
}

// Adds a tool name to a per-turn badge list without duplicates, so a turn that
// calls the same tool twice shows ONE badge. (The RAW call count lives on
// SessionMeta.toolCalls in claude.ts and is intentionally not deduped.)
function pushUnique(arr: string[], name: string): void {
  if (!arr.includes(name)) arr.push(name);
}

function extractAssistant(content: any): { text: string; toolUses: string[] } {
  const toolUses: string[] = [];
  let text = "";
  if (Array.isArray(content)) {
    for (const c of content) {
      if (!c || typeof c !== "object") continue;
      if (c.type === "text" && typeof c.text === "string") {
        text += (text ? "\n" : "") + c.text;
      } else if (c.type === "tool_use" && typeof c.name === "string") {
        pushUnique(toolUses, c.name);
      }
    }
  } else if (typeof content === "string") {
    text = content;
  }
  return { text, toolUses };
}

export function parseClaudeMessages(path: string): Message[] {
  const messages: Message[] = [];
  const lines = readFileSync(path, "utf8").split("\n");

  // A real assistant turn is written as several ADJACENT lines sharing one
  // `message.id` (separate thinking/text/tool_use content blocks) that repeat the
  // SAME `usage`. Merge those lines into ONE assistant message: append text, union
  // tool names, keep the model, and set tokens once (last-wins on the repeated
  // usage). `lastAssistantId`/`lastAssistantIdx` track the open merge run; a user
  // or compaction line ends it (an assistant with a new id also ends it).
  let lastAssistantId = "";
  let lastAssistantIdx = -1;
  const endRun = () => {
    lastAssistantId = "";
    lastAssistantIdx = -1;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: any;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }

    const kind = detectClaudeCompaction(obj);
    if (kind) {
      messages.push({
        index: messages.length,
        role: "assistant",
        text: typeof obj.content === "string" ? obj.content : "",
        toolUses: [],
        timestamp: String(obj.timestamp ?? ""),
        compaction: kind,
      });
      endRun();
      continue;
    }

    if (obj.type === "user" && obj.message?.role === "user") {
      const text = extractUserText(obj.message.content);
      if (text) {
        messages.push({
          index: messages.length,
          role: "user",
          text,
          toolUses: [],
          timestamp: String(obj.timestamp ?? ""),
        });
      }
      endRun();
      continue;
    }

    if (obj.type === "assistant" && obj.message) {
      const { text, toolUses } = extractAssistant(obj.message.content);
      const usage = obj.message.usage;
      const tokens = usage
        ? (usage.input_tokens ?? 0) +
          (usage.output_tokens ?? 0) +
          (usage.cache_creation_input_tokens ?? 0) +
          (usage.cache_read_input_tokens ?? 0)
        : undefined;
      const model = obj.message.model ? String(obj.message.model) : undefined;
      const msgId = obj.message.id ? String(obj.message.id) : "";

      // Merge into the open run when this line continues the same message.id.
      if (msgId && msgId === lastAssistantId && lastAssistantIdx >= 0) {
        const prev = messages[lastAssistantIdx];
        if (text) prev.text += (prev.text ? "\n" : "") + text;
        for (const t of toolUses) pushUnique(prev.toolUses, t);
        if (model) prev.model = model;
        if (tokens !== undefined) prev.tokens = tokens; // last-wins; identical here
        continue;
      }

      // A thinking-only first split line has no text/tool_use and is skipped; the
      // following text/tool_use line of the same message.id then opens the run.
      if (text || toolUses.length > 0) {
        messages.push({
          index: messages.length,
          role: "assistant",
          text,
          toolUses,
          model,
          tokens,
          timestamp: String(obj.timestamp ?? ""),
        });
        lastAssistantId = msgId;
        lastAssistantIdx = messages.length - 1;
      }
    }
  }

  return messages;
}
