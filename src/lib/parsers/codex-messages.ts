// src/lib/parsers/codex-messages.ts
import { readFileSync } from "node:fs";
import type { Message } from "../normalize";

// Extracts text from a Codex message payload. Assistant messages use
// `output_text`; user/developer messages use `input_text`. Exported so
// `codex.ts` detects user turns with the identical extraction.
export function extractCodexText(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter(
        (c) =>
          c &&
          (c.type === "output_text" ||
            c.type === "input_text" ||
            c.type === "text") &&
          typeof c.text === "string",
      )
      .map((c) => c.text)
      .join("\n");
  }
  return "";
}

// The CLI injects synthetic `response_item` user payloads BEFORE the real
// `event_msg.user_message`: an AGENTS.md/user-instructions block, an
// `<environment_context>` block, and a developer-role `<permissions instructions>`
// block. These are context, not prompts, and must never surface in replay/search.
// Single source of truth for the markers — `codex.ts` imports and reuses this so
// both parsers filter identically.
const SYNTHETIC_CODEX_CONTEXT_MARKERS = [
  "# AGENTS.md instructions for",
  "<environment_context>",
  "<user_instructions>",
  "<permissions instructions>",
];

export function isSyntheticCodexContext(text: string): boolean {
  const t = text.trimStart();
  return SYNTHETIC_CODEX_CONTEXT_MARKERS.some((m) => t.startsWith(m));
}

// Codex compaction scope (v1 decision). Real Codex rollouts DO emit compaction
// events — a top-level `{"type":"compacted","payload":{...,"replacement_history":[...]}}`
// line and an `{"type":"event_msg","payload":{"type":"context_compacted"}}` line —
// so "Codex has no compaction" is not literally true. v1 intentionally does NOT
// surface Codex compaction: unlike Claude it carries no tokens-saved figure and no
// per-turn full/micro marker semantics, so a Codex `compaction` field would be a
// bare, non-comparable count. Both Codex parsers therefore leave `SessionMeta`
// without a `compaction` field, and the top-level `compacted` line is ignored (its
// `replacement_history` messages never surface as prompts). A Codex-only compaction
// count (no tokens-saved) is a noted future enhancement.

// A single Codex rollout can hold MULTIPLE distinct session ids (e.g. a fork that
// replays a parent session's history). `parseCodexMessages` returns ONLY the
// messages belonging to `sessionId`: it tracks the active session id (the id of
// the most recent session_meta) and emits a message only while the active id
// equals the requested one.
//
// Within the requested session a turn opens on a user message and closes on an
// assistant message.
// - Users arrive as an `event_msg` user_message OR as a `response_item` message
//   with role "user" (the two mirror each other within a turn, so the
//   response_item copy is deduped against the last user text). `role:"developer"`
//   messages and synthetic context payloads (AGENTS.md / environment_context /
//   user_instructions / permissions injection) are ignored via
//   `isSyntheticCodexContext`.
// - Assistants arrive as a `response_item` message with role "assistant"; when a
//   turn carries only an `event_msg.agent_message` and no assistant response_item,
//   that agent_message is emitted as the fallback (flushed at the next user turn,
//   at a session switch, or at end of file). Function calls and the turn's
//   token_count are attached to whichever assistant closes the turn. Text stays
//   full for the payload.
export function parseCodexMessages(path: string, sessionId: string): Message[] {
  const messages: Message[] = [];
  const lines = readFileSync(path, "utf8").split("\n");

  let activeId = "";
  let currentModel = "unknown";
  let pendingTools: string[] = [];
  let turnTokens: number | undefined;
  let lastUserText = "";
  let sawAssistant = false;
  let pendingAgent: { text: string; timestamp: string } | null = null;

  // Push only messages belonging to the requested session; index stays dense
  // (0..n) over the emitted messages.
  const emit = (m: Omit<Message, "index">) => {
    if (activeId !== sessionId) return;
    messages.push({ ...m, index: messages.length });
  };

  const flushAgent = () => {
    if (pendingAgent && !sawAssistant) {
      emit({
        role: "assistant",
        text: pendingAgent.text,
        toolUses: pendingTools,
        model: currentModel,
        tokens: turnTokens,
        timestamp: pendingAgent.timestamp,
      });
      pendingTools = [];
      turnTokens = undefined;
    }
    pendingAgent = null;
  };

  const resetTurnState = () => {
    pendingTools = [];
    turnTokens = undefined;
    lastUserText = "";
    sawAssistant = false;
    pendingAgent = null;
  };

  const openUserTurn = (text: string, timestamp: string) => {
    flushAgent();
    emit({ role: "user", text, toolUses: [], timestamp });
    lastUserText = text;
    sawAssistant = false;
    pendingTools = [];
    turnTokens = undefined;
    pendingAgent = null;
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
    const p = obj.payload ?? {};

    if (obj.type === "session_meta") {
      const newId = p.id ? String(p.id) : "";
      if (newId && newId !== activeId) {
        flushAgent(); // close the old session's dangling agent turn (emits only
        // if the old active session is the requested one)
        activeId = newId;
        resetTurnState(); // the new session starts a fresh turn stream
      }
      continue;
    }

    if (obj.type === "turn_context") {
      if (p.model) currentModel = String(p.model);
      continue;
    }

    if (obj.type === "event_msg" && p.type === "user_message") {
      openUserTurn(
        typeof p.message === "string" ? p.message : "",
        String(obj.timestamp ?? ""),
      );
      continue;
    }

    if (obj.type === "event_msg" && p.type === "token_count") {
      const last = p.info?.last_token_usage;
      // Guard on > 0: a no-progress duplicate token_count carries
      // last_token_usage.total_tokens === 0 and must NOT clobber the real turn
      // tokens already captured for the assistant that is about to close.
      if (
        last &&
        typeof last.total_tokens === "number" &&
        last.total_tokens > 0
      ) {
        turnTokens = last.total_tokens;
      }
      continue;
    }

    if (obj.type === "event_msg" && p.type === "agent_message") {
      pendingAgent = {
        text: typeof p.message === "string" ? p.message : "",
        timestamp: String(obj.timestamp ?? ""),
      };
      continue;
    }

    if (obj.type === "response_item" && p.type === "function_call") {
      if (typeof p.name === "string") pendingTools.push(p.name);
      continue;
    }

    if (obj.type === "response_item" && p.type === "message") {
      if (p.role === "user") {
        const text = extractCodexText(p.content);
        // Skip synthetic context injection (AGENTS.md / environment_context /
        // user_instructions / permissions), and dedup the response_item copy of
        // the current turn's user text.
        if (text && !isSyntheticCodexContext(text) && text !== lastUserText) {
          openUserTurn(text, String(obj.timestamp ?? ""));
        }
        continue;
      }
      if (p.role === "assistant") {
        emit({
          role: "assistant",
          text: extractCodexText(p.content),
          toolUses: pendingTools,
          model: currentModel,
          tokens: turnTokens,
          timestamp: String(obj.timestamp ?? ""),
        });
        sawAssistant = true;
        pendingAgent = null; // an assistant response_item supersedes any agent_message
        pendingTools = [];
        turnTokens = undefined;
      }
      continue; // ignore role "developer" and any other roles
    }
  }

  flushAgent();
  return messages;
}
