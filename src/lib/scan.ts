// src/lib/scan.ts
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseFileCached } from "./cache";
import { parseClaudeFile } from "./parsers/claude";
import { parseCodexFile } from "./parsers/codex";
import type {
  RateLimitSnapshot,
  SessionMeta,
  Tool,
  UsageRecord,
} from "./normalize";

export interface SessionIndexEntry {
  files: string[];
  tool: Tool;
  sessionId: string; // raw id the message parsers need (Codex filters by it)
}

export interface ScanResult {
  records: UsageRecord[];
  codexQuota: RateLimitSnapshot | null;
  // Both maps are keyed by the composite route key `${tool}:${sessionId}` so a
  // Claude and a Codex session can never collide in the shared namespace.
  sessionMeta: Map<string, SessionMeta>;
  sessionIndex: Map<string, SessionIndexEntry>;
}

const keyOf = (tool: Tool, sessionId: string): string => `${tool}:${sessionId}`;

export function listJsonlFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { recursive: true, encoding: "utf8" })
      .filter((name) => name.endsWith(".jsonl"))
      .map((name) => join(dir, name));
  } catch {
    return []; // directory missing
  }
}

// Cloned on first insert so merging never mutates the SessionMeta objects held
// inside the mtime cache (parseFileCached returns the same references across
// scans; mutating them would inflate counts on the next scan).
function cloneMeta(s: SessionMeta): SessionMeta {
  return {
    ...s,
    models: [...s.models],
    compaction: s.compaction ? { ...s.compaction } : undefined,
  };
}

// Accumulates the files a session key appears in, deduped, and records the raw
// session id. A key can span several files (e.g. a resumed Claude session) and a
// file can appear under several keys (e.g. a Codex fork holding >1 id); the detail
// route parses every file listed under the key.
function addSessionFile(
  index: Map<string, SessionIndexEntry>,
  tool: Tool,
  sessionId: string,
  file: string,
): void {
  if (!sessionId) return;
  const key = keyOf(tool, sessionId);
  const e = index.get(key);
  if (!e) {
    index.set(key, { files: [file], tool, sessionId });
    return;
  }
  if (!e.files.includes(file)) e.files.push(file);
}

function mergeMeta(map: Map<string, SessionMeta>, s: SessionMeta): void {
  const key = keyOf(s.tool, s.sessionId);
  const e = map.get(key);
  if (!e) {
    map.set(key, cloneMeta(s));
    return;
  }
  e.turns += s.turns;
  e.toolCalls += s.toolCalls;
  for (const m of s.models) if (!e.models.includes(m)) e.models.push(m);
  if (s.startedAt && (!e.startedAt || s.startedAt < e.startedAt)) {
    e.startedAt = s.startedAt;
  }
  if (s.endedAt && s.endedAt > e.endedAt) e.endedAt = s.endedAt;
  if (s.compaction) {
    if (!e.compaction) e.compaction = { full: 0, micro: 0, tokensSaved: 0 };
    e.compaction.full += s.compaction.full;
    e.compaction.micro += s.compaction.micro;
    e.compaction.tokensSaved += s.compaction.tokensSaved;
  }
}

export function scan(
  opts: { claudeDir?: string; codexDir?: string } = {},
): ScanResult {
  const claudeDir = opts.claudeDir ?? join(homedir(), ".claude", "projects");
  const codexDir = opts.codexDir ?? join(homedir(), ".codex", "sessions");

  const records: UsageRecord[] = [];
  let codexQuota: RateLimitSnapshot | null = null;
  const sessionMeta = new Map<string, SessionMeta>();
  const sessionIndex = new Map<string, SessionIndexEntry>();

  for (const file of listJsonlFiles(claudeDir)) {
    try {
      const parsed = parseFileCached(file, parseClaudeFile);
      records.push(...parsed.records);
      for (const s of parsed.sessions ?? []) {
        mergeMeta(sessionMeta, s);
        addSessionFile(sessionIndex, s.tool, s.sessionId, file);
      }
    } catch {
      // file vanished or became unreadable between enumeration and parse; skip it
    }
  }

  for (const file of listJsonlFiles(codexDir)) {
    try {
      const parsed = parseFileCached(file, parseCodexFile);
      records.push(...parsed.records);
      if (
        parsed.quota &&
        (!codexQuota || parsed.quota.timestamp > codexQuota.timestamp)
      ) {
        codexQuota = parsed.quota;
      }
      for (const s of parsed.sessions ?? []) {
        mergeMeta(sessionMeta, s);
        addSessionFile(sessionIndex, s.tool, s.sessionId, file);
      }
    } catch {
      // file vanished or became unreadable between enumeration and parse; skip it
    }
  }

  return { records, codexQuota, sessionMeta, sessionIndex };
}
