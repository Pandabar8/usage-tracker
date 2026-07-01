// src/lib/retention.mjs
// Pure retention transform + target, shared by settings.ts and
// scripts/fix-retention.mjs. Plain ESM (.mjs) so the raw-`node` script imports it
// on any Node version without a TypeScript loader.

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
