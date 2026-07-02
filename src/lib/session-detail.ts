// src/lib/session-detail.ts
import { scan } from "./scan";
import { groupSessions } from "./sessions";
import { defaultPricing } from "./pricing";
import { parseClaudeMessages } from "./parsers/claude-messages";
import { parseCodexMessages } from "./parsers/codex-messages";
import type { Message, SessionDetail } from "./normalize";

// Single source of truth for resolving a composite `${tool}:${sessionId}` route
// key into a full SessionDetail: scan → index lookup → parse EVERY file for the
// key → concatenate in timestamp order → re-index 0..n → match the summary by key.
// Both the `/api/sessions/[id]` endpoint and the `/sessions/[id]` page call this,
// so the resolution logic cannot drift between them. The Codex parser filters a
// shared rollout by the raw session id; a key can also span several files (a
// resumed Claude session). Returns null when the key is unknown, has no summary,
// or any of its files cannot be read (vanished/corrupt).
export function loadSessionDetail(key: string): SessionDetail | null {
  const { records, sessionMeta, sessionIndex } = scan();
  const entry = sessionIndex.get(key);
  if (!entry) return null;

  let messages: Message[];
  try {
    messages =
      entry.tool === "claude"
        ? entry.files.flatMap((file) => parseClaudeMessages(file))
        : entry.files.flatMap((file) =>
            parseCodexMessages(file, entry.sessionId),
          );
  } catch {
    return null; // a file vanished or became unreadable
  }
  messages.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  messages = messages.map((m, i) => ({ ...m, index: i }));

  const summary = groupSessions(records, sessionMeta, defaultPricing).find(
    (s) => s.key === key,
  );
  if (!summary) return null;

  return { summary, messages };
}
