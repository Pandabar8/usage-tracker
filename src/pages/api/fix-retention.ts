// src/pages/api/fix-retention.ts
import type { APIRoute } from "astro";
import { homedir } from "node:os";
import { join } from "node:path";
import { raiseRetentionInFile, RETENTION_SAFE_DAYS } from "../../lib/settings";

export const prerender = false;

// The one deliberate local write in the dashboard: raise Claude Code's
// cleanupPeriodDays so usage history stops being auto-purged. Runs the same
// transform as the fix-retention CLI (shared raiseRetentionInFile) and returns
// before/after so the Settings page can confirm the new value.
export const POST: APIRoute = () => {
  const path = join(homedir(), ".claude", "settings.json");
  try {
    const { before, after, changed } = raiseRetentionInFile(path);
    return new Response(
      JSON.stringify({
        before,
        after,
        changed,
        protected: after >= RETENTION_SAFE_DAYS,
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
};
