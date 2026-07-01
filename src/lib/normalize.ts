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

export interface ParsedFile {
  records: UsageRecord[];
  quota: RateLimitSnapshot | null;
}

// Claude Code persists no rate-limit data, so its "limits" are shown as the
// volume of tokens used in rolling windows ending at `asOf`.
export interface ClaudeWindows {
  fiveHourTokens: number;
  sevenDayTokens: number;
  asOf: string; // ISO timestamp of the `now` the windows were computed against; "" when unknown
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
