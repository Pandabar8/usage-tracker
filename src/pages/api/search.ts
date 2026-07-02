// src/pages/api/search.ts
import type { APIRoute } from "astro";
import { scan } from "../../lib/scan";
import { groupSessions } from "../../lib/sessions";
import { defaultPricing } from "../../lib/pricing";
import type { Message } from "../../lib/normalize";
import { parseClaudeMessages } from "../../lib/parsers/claude-messages";
import { parseCodexMessages } from "../../lib/parsers/codex-messages";
import { searchMessages, type SearchResult } from "../../lib/search";

export const prerender = false;

// Bounds keep search cheap on a large history: at most SCAN_CAP sessions are
// parsed per query, and at most RESULT_CAP sessions are returned. Sessions are
// visited in groupSessions order so the caps keep a stable, freshest-first set.
const SCAN_CAP = 500;
const RESULT_CAP = 50;
// Coarse total-work bound: cap the number of files parsed across ALL scanned
// sessions. A session can reference many files, and a shared Codex file is parsed
// once per session id it holds, so bounding sessions alone is not enough.
const FILE_CAP = 4000;

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

export const GET: APIRoute = ({ url }) => {
  const q = (url.searchParams.get("q") ?? "").trim();
  if (!q) return json([]);

  const { records, sessionMeta, sessionIndex } = scan();
  const summaries = groupSessions(records, sessionMeta, defaultPricing);

  const results: SearchResult[] = [];
  let scanned = 0;
  let filesParsed = 0;
  for (const s of summaries) {
    if (
      scanned >= SCAN_CAP ||
      results.length >= RESULT_CAP ||
      filesParsed >= FILE_CAP
    )
      break;
    const entry = sessionIndex.get(s.key);
    if (!entry) continue;
    scanned += 1;

    // A session id can span more than one file, so parse every file the index
    // recorded and concatenate. Each file is parsed under its own try/catch so a
    // single vanished/corrupt file drops only that file, not the whole session.
    const messages: Message[] = [];
    for (const file of entry.files) {
      if (filesParsed >= FILE_CAP) break;
      filesParsed += 1;
      try {
        const parsed =
          entry.tool === "claude"
            ? parseClaudeMessages(file)
            : parseCodexMessages(file, entry.sessionId);
        messages.push(...parsed);
      } catch {
        continue; // vanished/corrupt file: skip it, keep the readable files
      }
    }
    if (messages.length === 0) continue; // every file was unreadable
    messages.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    const hit = searchMessages(messages, q);
    if (hit) {
      results.push({
        key: s.key,
        id: s.id,
        tool: s.tool,
        project: s.project,
        snippet: hit.snippet,
        matchCount: hit.matchCount,
        startedAt: s.startedAt,
      });
    }
  }

  return json(results);
};
