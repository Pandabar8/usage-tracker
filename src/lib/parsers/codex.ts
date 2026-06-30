// src/lib/parsers/codex.ts
import { readFileSync } from "node:fs";
import {
  projectFromCwd,
  type ParsedFile,
  type RateLimitSnapshot,
  type RateLimitWindow,
  type UsageRecord,
} from "../normalize";

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

export function parseCodexFile(path: string): ParsedFile {
  const records: UsageRecord[] = [];
  let quota: RateLimitSnapshot | null = null;
  let model = "unknown";
  let cwd: string | null = null;
  let sessionId = "";
  let prev: Cumulative = {
    input: 0,
    cached: 0,
    output: 0,
    reasoning: 0,
    total: 0,
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

    if (obj.type === "session_meta") {
      cwd = obj.payload?.cwd ?? cwd;
      sessionId = obj.payload?.id ?? sessionId;
      // Do NOT reset the cumulative baseline here. A single Codex rollout file
      // can contain many session_meta lines that all share ONE continuous,
      // monotonic `total_token_usage` counter; resetting `prev` to zero on each
      // would turn every subsequent event's delta into the full running
      // cumulative and massively over-count. A genuine counter restart is
      // already handled by the `cur.total < prev.total` reset branch below.
      continue;
    }

    if (obj.type === "turn_context") {
      if (obj.payload?.model) model = obj.payload.model;
      if (obj.payload?.cwd) cwd = obj.payload.cwd;
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
        sessionId,
        inputTokens: Math.max(0, d.input - d.cached),
        outputTokens: d.output,
        cacheWriteTokens: 0,
        cacheReadTokens: d.cached,
        reasoningTokens: d.reasoning,
      });
    }
  }

  return { records, quota };
}
