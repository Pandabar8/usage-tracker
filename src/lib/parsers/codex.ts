// src/lib/parsers/codex.ts
import { readFileSync } from "node:fs";
import {
  projectFromCwd,
  type ParsedFile,
  type RateLimitSnapshot,
  type RateLimitWindow,
  type SessionMeta,
  type UsageRecord,
} from "../normalize";
import {
  codexToolName,
  extractCodexText,
  isSyntheticCodexContext,
} from "./codex-messages";

function toWindow(w: any): RateLimitWindow | null {
  if (!w || typeof w.used_percent !== "number") return null;
  return {
    usedPercent: w.used_percent,
    windowMinutes: w.window_minutes ?? 0,
    resetsAt: w.resets_at ?? 0,
  };
}

interface Cumulative {
  input: number;
  cached: number;
  output: number;
  reasoning: number;
  total: number;
}

function readCumulative(info: any): Cumulative | null {
  const t = info?.total_token_usage;
  if (!t) return null;
  return {
    input: t.input_tokens ?? 0,
    cached: t.cached_input_tokens ?? 0,
    output: t.output_tokens ?? 0,
    reasoning: t.reasoning_output_tokens ?? 0,
    total: t.total_tokens ?? 0,
  };
}

// Per-session structural accumulator, mutated during the pass.
interface SessionAcc {
  sessionId: string;
  turns: number;
  toolCalls: number;
  models: Set<string>;
  startedAt: string;
  endedAt: string;
}

export function parseCodexFile(path: string): ParsedFile {
  const records: UsageRecord[] = [];
  let quota: RateLimitSnapshot | null = null;
  let model = "unknown";
  let cwd: string | null = null;

  // ONE continuous cumulative baseline for the WHOLE file. A single rollout can
  // contain several session_meta ids (e.g. a fork that replays a parent session),
  // but they all share ONE monotonic `total_token_usage` counter; resetting `prev`
  // to zero on a session switch would turn every subsequent event's delta into the
  // full running cumulative and massively over-count. Only session ATTRIBUTION
  // switches on session_meta; a genuine counter restart is still handled solely by
  // the `cur.total < prev.total` reset branch below.
  let prev: Cumulative = {
    input: 0,
    cached: 0,
    output: 0,
    reasoning: 0,
    total: 0,
  };

  // A rollout can contain MULTIPLE distinct session ids. `activeId` is the id of
  // the most recent session_meta; every record and every meta count is attributed
  // to it, and one SessionMeta is emitted per distinct id.
  const sessions = new Map<string, SessionAcc>();
  let activeId = "";
  function accFor(id: string): SessionAcc {
    let a = sessions.get(id);
    if (!a) {
      a = {
        sessionId: id,
        turns: 0,
        toolCalls: 0,
        models: new Set(),
        startedAt: "",
        endedAt: "",
      };
      sessions.set(id, a);
    }
    return a;
  }

  // Assistant-turn detection mirrors parseCodexMessages so SessionMeta.turns never
  // contradicts the rendered detail: a `response_item` assistant closes a turn, and
  // an `event_msg.agent_message` is counted only when its turn produced no assistant
  // response_item (flushed at the next user turn, at a session switch, or at EOF).
  let lastUserText = "";
  // The response_item user copy mirrors an event_msg user_message ONLY within the
  // open turn (see parseCodexMessages); scope the dedup to the turn so a repeated
  // identical prompt in a LATER turn is still counted as a new turn.
  let hasUserInTurn = false;
  let sawAssistant = false;
  let pendingAgent = false;
  const flushTurn = () => {
    if (pendingAgent && !sawAssistant && activeId) accFor(activeId).turns += 1;
    pendingAgent = false;
  };
  const resetTurnState = () => {
    lastUserText = "";
    hasUserInTurn = false;
    sawAssistant = false;
    pendingAgent = false;
  };
  const openUserTurn = (text: string) => {
    flushTurn();
    lastUserText = text;
    hasUserInTurn = true;
    sawAssistant = false;
  };

  // Raw tool-call count across ALL Codex tool payload types, deduped file-wide by
  // call_id so an event-side completion (mcp_tool_call_end / patch_apply_end) does
  // not re-count the response_item tool call it mirrors.
  const seenToolCalls = new Set<string>();
  const countTool = (p: any): boolean => {
    const name = codexToolName(p);
    if (!name) return false;
    const cid = typeof p.call_id === "string" ? p.call_id : "";
    if (cid && seenToolCalls.has(cid)) return true; // already counted from its other surface
    if (cid) seenToolCalls.add(cid);
    if (activeId) accFor(activeId).toolCalls += 1;
    return true;
  };

  const lines = readFileSync(path, "utf8").split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: any;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }

    const ts = String(obj.timestamp ?? "");

    if (obj.type === "session_meta") {
      const newId = obj.payload?.id ? String(obj.payload.id) : "";
      if (newId && newId !== activeId) {
        flushTurn(); // close the OLD active session's dangling agent turn first
        activeId = newId;
        resetTurnState(); // the new session starts a fresh turn stream
      }
      cwd = obj.payload?.cwd ?? cwd;
      // NB: `prev` is deliberately NOT reset here (continuous counter).
    }

    // Attribute every line's timestamp to the active session's span (covers
    // session_meta itself, so a switched-in session's span starts at its meta).
    if (activeId && ts) {
      const a = accFor(activeId);
      if (!a.startedAt || ts < a.startedAt) a.startedAt = ts;
      if (ts > a.endedAt) a.endedAt = ts;
    }

    if (obj.type === "session_meta") continue;

    if (obj.type === "turn_context") {
      if (obj.payload?.model) {
        model = obj.payload.model;
        if (activeId) accFor(activeId).models.add(model);
      }
      if (obj.payload?.cwd) cwd = obj.payload.cwd;
      continue;
    }

    // Tool calls on either surface (response_item item or event-side completion),
    // deduped by call_id, mirror parseCodexMessages so toolCalls tracks toolUses.
    if (
      (obj.type === "response_item" || obj.type === "event_msg") &&
      countTool(obj.payload ?? {})
    ) {
      continue;
    }

    if (obj.type === "response_item") {
      const pt = obj.payload?.type;
      if (pt === "message" && obj.payload?.role === "assistant") {
        if (activeId) accFor(activeId).turns += 1;
        sawAssistant = true;
        hasUserInTurn = false; // the model responded; the turn's user echo window closed
        pendingAgent = false;
      } else if (pt === "message" && obj.payload?.role === "user") {
        const text = extractCodexText(obj.payload.content);
        // Skip synthetic context injection so turn boundaries match the detail,
        // and dedup the response_item user mirror ONLY within the open turn.
        if (
          text &&
          !isSyntheticCodexContext(text) &&
          !(hasUserInTurn && text === lastUserText)
        ) {
          openUserTurn(text);
        }
      }
      continue;
    }

    if (obj.type === "event_msg" && obj.payload?.type === "user_message") {
      openUserTurn(
        typeof obj.payload.message === "string" ? obj.payload.message : "",
      );
      continue;
    }

    if (obj.type === "event_msg" && obj.payload?.type === "agent_message") {
      pendingAgent = true;
      hasUserInTurn = false; // the model responded; the turn's user echo window closed
      continue;
    }

    if (obj.type === "event_msg" && obj.payload?.type === "token_count") {
      const rl = obj.payload.rate_limits;
      if (rl) {
        quota = {
          timestamp: String(obj.timestamp ?? ""),
          primary: toWindow(rl.primary),
          secondary: toWindow(rl.secondary),
        };
      }

      const cur = readCumulative(obj.payload.info);
      if (!cur) continue; // info null, or no cumulative usage on this event

      // Delta from the previous cumulative snapshot.
      // - True reset (the cumulative TOTAL went backwards → counter/session
      //   restarted): take the current snapshot as the delta.
      // - Otherwise difference per field, clamping each to >= 0 so a single
      //   component regressing while the total still advances cannot produce a
      //   negative delta. (Clamping a component here — rather than treating any
      //   field decrease as a full reset — keeps the per-record totals summing to
      //   the final cumulative total, which is exactly the accounting guard.)
      const d =
        cur.total < prev.total
          ? cur
          : {
              input: Math.max(0, cur.input - prev.input),
              cached: Math.max(0, cur.cached - prev.cached),
              output: Math.max(0, cur.output - prev.output),
              reasoning: Math.max(0, cur.reasoning - prev.reasoning),
              total: cur.total - prev.total,
            };
      prev = cur;

      if (d.total <= 0) continue; // duplicate snapshot / no forward progress

      records.push({
        tool: "codex",
        timestamp: String(obj.timestamp ?? ""),
        model,
        project: projectFromCwd(cwd),
        sessionId: activeId,
        inputTokens: Math.max(0, d.input - d.cached),
        outputTokens: d.output,
        cacheWriteTokens: 0,
        cacheReadTokens: d.cached,
        reasoningTokens: d.reasoning,
      });
    }
  }

  flushTurn(); // count a trailing agent_message-only turn for the final session

  const sessionsOut: SessionMeta[] = [...sessions.values()].map((a) => ({
    sessionId: a.sessionId,
    tool: "codex",
    turns: a.turns,
    toolCalls: a.toolCalls,
    models: [...a.models],
    startedAt: a.startedAt,
    endedAt: a.endedAt,
  }));

  return { records, quota, sessions: sessionsOut };
}
