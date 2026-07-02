// src/lib/parsers/claude.ts
import { readFileSync } from "node:fs";
import {
  projectFromCwd,
  type ParsedFile,
  type SessionMeta,
  type UsageRecord,
} from "../normalize";
import {
  detectClaudeCompaction,
  claudeCompactionSaved,
} from "./claude-messages";

export function parseClaudeFile(path: string): ParsedFile {
  const records: UsageRecord[] = [];
  const sessions = new Map<string, SessionMeta>();
  const lines = readFileSync(path, "utf8").split("\n");

  // A real assistant turn is split across several adjacent lines that share one
  // `message.id` and REPEAT the same `usage`. Emit ONE record per `message.id`
  // (usage last-wins, identical in practice) and count ONE turn per `message.id`,
  // instead of one per line. `recordByMsgId` maps a message.id to its records
  // index; `seenMsgIds` gates the per-turn count. Lines without a message.id fall
  // back to one record / one turn per line.
  const recordByMsgId = new Map<string, number>();
  const seenMsgIds = new Set<string>();

  function metaFor(id: string): SessionMeta {
    let m = sessions.get(id);
    if (!m) {
      m = {
        sessionId: id,
        tool: "claude",
        turns: 0,
        toolCalls: 0,
        models: [],
        startedAt: "",
        endedAt: "",
        compaction: { full: 0, micro: 0, tokensSaved: 0 },
      };
      sessions.set(id, m);
    }
    return m;
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: any;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue; // skip malformed lines
    }

    const id = String(obj.sessionId ?? "");
    if (id) {
      const m = metaFor(id);
      const ts = String(obj.timestamp ?? "");
      if (ts) {
        if (!m.startedAt || ts < m.startedAt) m.startedAt = ts;
        if (ts > m.endedAt) m.endedAt = ts;
      }
      const kind = detectClaudeCompaction(obj);
      if (kind && m.compaction) {
        m.compaction[kind] += 1;
        m.compaction.tokensSaved += claudeCompactionSaved(obj);
      }
    }

    const message = obj?.message;
    const usage = message?.usage;
    if (!usage || obj?.type !== "assistant") continue;

    const model = String(message.model ?? "unknown");
    const msgId = message.id ? String(message.id) : "";
    // First sighting of a message.id (or any line without one) opens a turn/record.
    const isNewTurn = !msgId || !seenMsgIds.has(msgId);

    // Count tool_use blocks on THIS line; they are disjoint across the split
    // lines of one message.id, so summing over all lines is the real tool total.
    let toolUsesOnLine = 0;
    if (Array.isArray(message.content)) {
      for (const c of message.content) {
        if (c && c.type === "tool_use") toolUsesOnLine += 1;
      }
    }

    if (id) {
      const m = metaFor(id);
      m.toolCalls += toolUsesOnLine;
      if (!m.models.includes(model)) m.models.push(model);
      if (isNewTurn) m.turns += 1;
    }

    if (msgId && !isNewTurn) {
      // A continuation line of an already-recorded turn: usage is repeated, so
      // overwrite the existing record (last-wins) rather than adding a new one.
      const idx = recordByMsgId.get(msgId)!;
      const rec = records[idx];
      rec.inputTokens = usage.input_tokens ?? 0;
      rec.outputTokens = usage.output_tokens ?? 0;
      rec.cacheWriteTokens = usage.cache_creation_input_tokens ?? 0;
      rec.cacheReadTokens = usage.cache_read_input_tokens ?? 0;
      rec.model = model;
      continue;
    }

    if (msgId) seenMsgIds.add(msgId);
    records.push({
      tool: "claude",
      timestamp: String(obj.timestamp ?? ""),
      model,
      project: projectFromCwd(obj.cwd),
      sessionId: id,
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      reasoningTokens: 0,
    });
    if (msgId) recordByMsgId.set(msgId, records.length - 1);
  }

  return { records, quota: null, sessions: [...sessions.values()] };
}
