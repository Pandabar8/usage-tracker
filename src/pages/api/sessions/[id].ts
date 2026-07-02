// src/pages/api/sessions/[id].ts
import type { APIRoute } from "astro";
import { loadSessionDetail } from "../../../lib/session-detail";

export const prerender = false;

const notFound = () =>
  new Response(JSON.stringify({ error: "not found" }), {
    status: 404,
    headers: { "content-type": "application/json" },
  });

export const GET: APIRoute = ({ params }) => {
  // The `[id]` param is the composite route key `${tool}:${sessionId}`. Decode
  // defensively so a percent-encoded `${tool}%3A${sessionId}` from a link also
  // resolves (decodeURIComponent is a no-op on an already-decoded value).
  const key = params.id ? decodeURIComponent(params.id) : undefined;
  if (!key) return notFound();

  // Shared loader (session-detail.ts) resolves + parses; identical logic to the
  // /sessions/[id] page so the two cannot drift.
  const detail = loadSessionDetail(key);
  if (!detail) return notFound();

  return new Response(JSON.stringify(detail), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
