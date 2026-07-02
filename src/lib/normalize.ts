// src/lib/normalize.ts
export type Tool = "claude" | "codex";

export interface UsageRecord {
  tool: Tool;
  timestamp: string;
  model: string;
  project: string;
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  reasoningTokens: number;
}

export interface RateLimitWindow {
  usedPercent: number;
  windowMinutes: number;
  resetsAt: number;
}

export interface RateLimitSnapshot {
  timestamp: string;
  primary: RateLimitWindow | null;
  secondary: RateLimitWindow | null;
}

// Per-session structural meta computed during the cached scan parse (no extra
// file reads). Token totals live in UsageRecord; this carries counts that
// records do not: assistant turns, tool calls, models, span, and (Claude only)
// compaction counts.
export interface SessionMeta {
  sessionId: string;
  tool: Tool;
  turns: number;
  toolCalls: number;
  models: string[];
  startedAt: string;
  endedAt: string;
  compaction?: { full: number; micro: number; tokensSaved: number };
}

export interface ParsedFile {
  records: UsageRecord[];
  quota: RateLimitSnapshot | null;
  sessions?: SessionMeta[];
  // Codex only: highest cumulative total_tokens reached per session id in this
  // file. scan() uses it to pick the authoritative file when a forked rollout
  // replays a parent id across files.
  sessionMaxTotals?: Map<string, number>;
}

// Claude Code persists no rate-limit data, so its "limits" are shown as the
// volume of tokens used in rolling windows ending at `asOf`.
export interface ClaudeWindows {
  fiveHourTokens: number;
  sevenDayTokens: number;
  asOf: string; // ISO timestamp of the `now` the windows were computed against; "" when unknown
}

export interface SessionSummary {
  key: string; // stable composite route key `${tool}:${sessionId}`, unique across tools
  id: string; // raw session id, kept for display and raw-id lookups
  tool: Tool;
  project: string;
  models: string[];
  startedAt: string;
  endedAt: string;
  durationMs: number;
  turns: number;
  toolCalls: number;
  tokens: {
    input: number;
    output: number;
    cacheWrite: number;
    cacheRead: number;
  };
  totalTokens: number;
  cost: number; // notional, API-rate
  unpriced: boolean;
  compaction?: { full: number; micro: number; tokensSaved: number }; // Claude only
}

export interface Message {
  index: number;
  role: "user" | "assistant";
  text: string; // full text in the payload; the UI truncates for display
  toolUses: string[]; // tool names
  model?: string;
  tokens?: number;
  timestamp: string;
  compaction?: "full" | "micro"; // Claude only
}

export interface SessionDetail {
  summary: SessionSummary;
  messages: Message[];
}

export function projectFromCwd(cwd?: string | null): string {
  if (!cwd) return "(unknown)";
  const parts = cwd.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "(unknown)";
}

export function totalTokens(r: UsageRecord): number {
  return (
    r.inputTokens + r.outputTokens + r.cacheWriteTokens + r.cacheReadTokens
  );
}

// Shortens text for display, appending an ellipsis when cut. Callers keep the
// full text in the API payload; only the UI shortens.
export function truncate(text: string, max: number): string {
  if (max <= 0) return "";
  if (text.length <= max) return text;
  return text.slice(0, max) + "…";
}

// --- Phase 1 types (forecast + tips) — preserved through this full-file
// replace so Phase 1's forecast.ts/tips.ts/aggregate.ts/QuotaPanel/Tips keep
// compiling. Do not drop. ---
export interface WindowForecast {
  willExhaust: boolean;
  projectedPercentAtReset: number | null;
  etaToLimit: string | null; // ISO timestamp the linear projection crosses 100%, or null
}

export interface VolumeForecast {
  projectedTokens: number | null;
  note: string;
}

export interface Forecast {
  codexPrimary?: WindowForecast; // 5h
  codexSecondary?: WindowForecast; // weekly
  claudeFiveHour?: VolumeForecast;
  claudeSevenDay?: VolumeForecast;
}

export interface Tip {
  id: string;
  severity: "info" | "warn";
  title: string;
  detail: string;
  savingsUsd?: number; // notional, API-rate
}
