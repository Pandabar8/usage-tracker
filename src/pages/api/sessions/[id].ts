// src/pages/api/sessions/[id].ts
import type { APIRoute } from "astro";
import { scan } from "../../../lib/scan";
import { groupSessions } from "../../../lib/sessions";
import { defaultPricing } from "../../../lib/pricing";
import { parseClaudeMessages } from "../../../lib/parsers/claude-messages";
import { parseCodexMessages } from "../../../lib/parsers/codex-messages";
import type { Message } from "../../../lib/normalize";

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

  const { records, sessionMeta, sessionIndex } = scan();
  const entry = sessionIndex.get(key);
  if (!entry) return notFound();

  // A key can span more than one file (a resumed Claude session), and a Codex
  // file can hold several sessions, so the Codex parser filters by the raw
  // sessionId. Parse every file, concatenate in timestamp order, and re-index
  // 0..n so the replay is one coherent stream.
  let messages: Message[];
  try {
    messages =
      entry.tool === "claude"
        ? entry.files.flatMap((file) => parseClaudeMessages(file))
        : entry.files.flatMap((file) =>
            parseCodexMessages(file, entry.sessionId),
          );
  } catch {
    return notFound(); // a file vanished or became unreadable
  }
  messages.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  messages = messages.map((m, i) => ({ ...m, index: i }));

  const summary = groupSessions(records, sessionMeta, defaultPricing).find(
    (s) => s.key === key,
  );
  if (!summary) return notFound();

  return new Response(JSON.stringify({ summary, messages }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
