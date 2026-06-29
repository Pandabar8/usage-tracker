// src/lib/scan.ts
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseFileCached } from "./cache";
import { parseClaudeFile } from "./parsers/claude";
import { parseCodexFile } from "./parsers/codex";
import type { RateLimitSnapshot, UsageRecord } from "./normalize";

export interface ScanResult {
  records: UsageRecord[];
  codexQuota: RateLimitSnapshot | null;
}

export function listJsonlFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { recursive: true, encoding: "utf8" })
      .filter((name) => name.endsWith(".jsonl"))
      .map((name) => join(dir, name));
  } catch {
    return []; // directory missing
  }
}

export function scan(
  opts: { claudeDir?: string; codexDir?: string } = {},
): ScanResult {
  const claudeDir = opts.claudeDir ?? join(homedir(), ".claude", "projects");
  const codexDir = opts.codexDir ?? join(homedir(), ".codex", "sessions");

  const records: UsageRecord[] = [];
  let codexQuota: RateLimitSnapshot | null = null;

  for (const file of listJsonlFiles(claudeDir)) {
    try {
      records.push(...parseFileCached(file, parseClaudeFile).records);
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
    } catch {
      // file vanished or became unreadable between enumeration and parse; skip it
    }
  }

  return { records, codexQuota };
}
