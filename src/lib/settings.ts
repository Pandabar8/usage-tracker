// src/lib/settings.ts
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Single source of truth for the write transform lives in retention.mjs so the
// raw-`node` fix-retention script and this module share one implementation.
export { RETENTION_TARGET_DAYS, raiseRetention } from "./retention.mjs";

// Claude Code applies a 30-day default when cleanupPeriodDays is absent.
export const RETENTION_DEFAULT_DAYS = 30;
export const RETENTION_SAFE_DAYS = 180;

export interface RetentionInfo {
  cleanupPeriodDays: number | null;
  exists: boolean;
  path: string;
}

// Read-only. The dashboard only ever warns; it never mutates settings.json.
export function getRetention(
  settingsPath: string = join(homedir(), ".claude", "settings.json"),
): RetentionInfo {
  try {
    const raw = readFileSync(settingsPath, "utf8");
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const v = obj.cleanupPeriodDays;
    return {
      cleanupPeriodDays: typeof v === "number" ? v : null,
      exists: true,
      path: settingsPath,
    };
  } catch {
    return { cleanupPeriodDays: null, exists: false, path: settingsPath };
  }
}

export function effectiveRetentionDays(info: RetentionInfo): number {
  return info.cleanupPeriodDays ?? RETENTION_DEFAULT_DAYS;
}

export function isRetentionRisky(info: RetentionInfo): boolean {
  return effectiveRetentionDays(info) < RETENTION_SAFE_DAYS;
}
