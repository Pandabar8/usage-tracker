// src/lib/search.ts
import type { Message, Tool } from "./normalize";

// A session that contained at least one matching message, plus a one-line
// snippet from the first hit. Built by the /api/search route from the scan
// index; the pure matcher below produces matchCount + snippet.
export interface SearchResult {
  key: string; // composite `${tool}:${sessionId}` — what results link on
  id: string;
  tool: Tool;
  project: string;
  snippet: string;
  matchCount: number;
  startedAt: string;
}

// Case-insensitive substring position; -1 when the query is empty or absent.
function indexOfCI(text: string, query: string): number {
  if (!query) return -1;
  return text.toLowerCase().indexOf(query.toLowerCase());
}

// One-line context window around the first match of `query` in `text`, with
// leading/trailing ellipses when the window is clipped. Internal whitespace is
// collapsed to single spaces so a multi-line message renders on one row.
export function snippet(text: string, query: string, radius = 60): string {
  const at = indexOfCI(text, query);
  if (at < 0) return "";
  const start = Math.max(0, at - radius);
  const end = Math.min(text.length, at + query.length + radius);
  const core = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${core}${end < text.length ? "…" : ""}`;
}

// Scans one session's messages for a case-insensitive substring, searching the
// full (untruncated) payload text. Returns the number of matching messages and
// a snippet from the first match, or null when the query is blank or unmatched.
export function searchMessages(
  messages: Message[],
  query: string,
): { matchCount: number; snippet: string } | null {
  const q = query.trim();
  if (!q) return null;
  let matchCount = 0;
  let firstSnippet = "";
  for (const m of messages) {
    if (indexOfCI(m.text, q) >= 0) {
      matchCount += 1;
      if (!firstSnippet) firstSnippet = snippet(m.text, q);
    }
  }
  return matchCount > 0 ? { matchCount, snippet: firstSnippet } : null;
}
