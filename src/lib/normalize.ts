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
