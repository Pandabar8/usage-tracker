// src/pages/api/sessions/index.ts
import type { APIRoute } from "astro";
import { scan } from "../../../lib/scan";
import { groupSessions } from "../../../lib/sessions";
import { defaultPricing } from "../../../lib/pricing";

export const prerender = false;

export const GET: APIRoute = ({ url }) => {
  // Whole-session semantics: build summaries from the UNFILTERED records + meta
  // so every session's tokens/cost stay internally consistent with its
  // turns/duration/toolCalls/compaction. The filters then include or exclude
  // WHOLE sessions; an overlapping session is returned intact, never truncated.
  const { records, sessionMeta } = scan();
  const all = groupSessions(records, sessionMeta, defaultPricing);

  const params = url.searchParams;
  const tool = params.get("tool"); // "claude" | "codex" | null
  const from = params.get("from"); // YYYY-MM-DD inclusive, or null
  const to = params.get("to"); // YYYY-MM-DD inclusive, or null

  const filtered = all.filter((s) => {
    if (tool && s.tool !== tool) return false;
    // Date-interval overlap on YYYY-MM-DD (matches applyFilters' slice
    // convention): include when endedAt >= from AND startedAt <= to.
    if (from && s.endedAt.slice(0, 10) < from) return false;
    if (to && s.startedAt.slice(0, 10) > to) return false;
    return true;
  });

  return new Response(JSON.stringify(filtered), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
