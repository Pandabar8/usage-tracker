// src/lib/retention.mjs
// Retention transform + target + on-disk apply, shared by settings.ts, the
// scripts/fix-retention.mjs CLI, and the dashboard's protect endpoint. Plain ESM
// (.mjs) so the raw-`node` script imports it on any Node version without a
// TypeScript loader. Only ever imported server-side (never from a client island).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// Claude Code deletes usage history older than cleanupPeriodDays (30-day default
// when the key is absent). We raise it to ~10 years to preserve history.
export const RETENTION_TARGET_DAYS = 3650;

// Raise cleanupPeriodDays to at least targetDays, preserving every other key.
// Idempotent: returns the same object with changed=false when already met.
export function raiseRetention(obj, targetDays = RETENTION_TARGET_DAYS) {
  const current =
    typeof obj.cleanupPeriodDays === "number" ? obj.cleanupPeriodDays : 0;
  if (current >= targetDays) {
    return { next: obj, changed: false };
  }
  return { next: { ...obj, cleanupPeriodDays: targetDays }, changed: true };
}

// Read-modify-write settings.json, raising cleanupPeriodDays to at least
// targetDays while preserving every other key. Returns before/after (and whether
// the file existed) so callers can report the change. Throws with a clear message
// on an unreadable file or non-object JSON so the caller surfaces the reason
// instead of writing blind. The single write path shared by the CLI and endpoint.
export function raiseRetentionInFile(
  settingsPath,
  targetDays = RETENTION_TARGET_DAYS,
) {
  let obj = {};
  const existed = existsSync(settingsPath);
  if (existed) {
    const raw = readFileSync(settingsPath, "utf8");
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`${settingsPath} is not valid JSON; fix it by hand first.`);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error(`${settingsPath} is not a JSON object.`);
    }
    obj = parsed;
  }
  const before =
    typeof obj.cleanupPeriodDays === "number" ? obj.cleanupPeriodDays : null;
  const { next, changed } = raiseRetention(obj, targetDays);
  if (changed) {
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(next, null, 2) + "\n");
  }
  return {
    before,
    after: next.cleanupPeriodDays,
    changed,
    existed,
    path: settingsPath,
  };
}
