// src/lib/scan.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  mkdirSync,
  utimesSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scan } from "./scan";
import { parseClaudeFile } from "./parsers/claude";
import { parseFileCached, clearCache } from "./cache";
import type { UsageRecord } from "./normalize";

let claudeDir: string;
let codexDir: string;

beforeEach(() => {
  clearCache();
  claudeDir = mkdtempSync(join(tmpdir(), "ut-claude-"));
  codexDir = mkdtempSync(join(tmpdir(), "ut-codex-"));
});
afterEach(() => {
  rmSync(claudeDir, { recursive: true, force: true });
  rmSync(codexDir, { recursive: true, force: true });
});

const claudeLine = JSON.stringify({
  type: "assistant",
  timestamp: "2026-06-01T10:00:00.000Z",
  cwd: "/Users/me/ProjA",
  sessionId: "s1",
  message: {
    model: "claude-opus-4-8",
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  },
});

const codexLines = [
  JSON.stringify({
    timestamp: "2026-06-02T09:00:00.000Z",
    type: "turn_context",
    payload: { cwd: "/Users/me/ProjB", model: "gpt-5.3-codex" },
  }),
  JSON.stringify({
    timestamp: "2026-06-02T09:05:00.000Z",
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        total_token_usage: {
          input_tokens: 300,
          cached_input_tokens: 100,
          output_tokens: 20,
          reasoning_output_tokens: 5,
          total_tokens: 320,
        },
      },
      rate_limits: {
        primary: { used_percent: 12, window_minutes: 300, resets_at: 1 },
        secondary: { used_percent: 3, window_minutes: 10080, resets_at: 2 },
      },
    },
  }),
].join("\n");

describe("scan", () => {
  it("reads nested .jsonl files from both roots and merges records", () => {
    mkdirSync(join(claudeDir, "proj"), { recursive: true });
    writeFileSync(join(claudeDir, "proj", "a.jsonl"), claudeLine);
    mkdirSync(join(codexDir, "2026", "06", "02"), { recursive: true });
    writeFileSync(join(codexDir, "2026", "06", "02", "r.jsonl"), codexLines);

    const { records, codexQuota } = scan({ claudeDir, codexDir });
    expect(records).toHaveLength(2);
    expect(records.some((r: UsageRecord) => r.tool === "claude")).toBe(true);
    expect(records.some((r: UsageRecord) => r.tool === "codex")).toBe(true);
    expect(codexQuota?.primary?.usedPercent).toBe(12);
  });

  it("returns empty results for a missing directory", () => {
    const { records } = scan({
      claudeDir: join(claudeDir, "nope"),
      codexDir: join(codexDir, "nope"),
    });
    expect(records).toEqual([]);
  });
});

describe("parseFileCached", () => {
  it("re-parses only when mtime changes", () => {
    const f = join(claudeDir, "a.jsonl");
    writeFileSync(f, claudeLine);
    let calls = 0;
    const counting = (p: string) => {
      calls++;
      return parseClaudeFile(p);
    };

    parseFileCached(f, counting);
    parseFileCached(f, counting);
    expect(calls).toBe(1); // second call served from cache

    utimesSync(f, new Date(), new Date(Date.now() + 5000)); // bump mtime
    parseFileCached(f, counting);
    expect(calls).toBe(2);
  });
});
