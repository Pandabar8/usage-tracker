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

  it("skips a file that fails to read and still returns records from valid files", () => {
    // Valid claude record alongside a directory named bad.jsonl.
    // listJsonlFiles picks up the directory path; readFileSync on a directory
    // throws EISDIR, exercising the per-file try/catch in scan().
    mkdirSync(join(claudeDir, "proj"), { recursive: true });
    writeFileSync(join(claudeDir, "proj", "good.jsonl"), claudeLine);
    mkdirSync(join(claudeDir, "proj", "bad.jsonl"), { recursive: true });

    const { records } = scan({ claudeDir, codexDir });
    expect(records).toHaveLength(1);
    expect(records[0].tool).toBe("claude");
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

describe("scan session meta and index", () => {
  it("builds sessionMeta and sessionIndex from the parse pass", () => {
    const claudeContent = JSON.stringify({
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
        content: [{ type: "tool_use", id: "t", name: "Bash", input: {} }],
      },
    });
    mkdirSync(join(claudeDir, "proj"), { recursive: true });
    writeFileSync(join(claudeDir, "proj", "s1.jsonl"), claudeContent);

    const { sessionMeta, sessionIndex } = scan({ claudeDir, codexDir });
    // Both maps are keyed by the composite `${tool}:${sessionId}` route key.
    expect(sessionMeta.get("claude:s1")).toMatchObject({
      tool: "claude",
      turns: 1,
      toolCalls: 1,
    });
    expect(sessionIndex.get("claude:s1")?.tool).toBe("claude");
    expect(sessionIndex.get("claude:s1")?.sessionId).toBe("s1");
    expect(sessionIndex.get("claude:s1")?.files).toHaveLength(1);
    expect(sessionIndex.get("claude:s1")?.files[0].endsWith("s1.jsonl")).toBe(
      true,
    );
  });

  it("does not double-count meta when the same session id spans files across repeat scans", () => {
    const line = (ts: string) =>
      JSON.stringify({
        type: "assistant",
        timestamp: ts,
        cwd: "/Users/me/ProjA",
        sessionId: "dup",
        message: {
          model: "claude-opus-4-8",
          usage: {
            input_tokens: 1,
            output_tokens: 1,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      });
    mkdirSync(join(claudeDir, "p"), { recursive: true });
    writeFileSync(
      join(claudeDir, "p", "a.jsonl"),
      line("2026-06-01T10:00:00.000Z"),
    );
    writeFileSync(
      join(claudeDir, "p", "b.jsonl"),
      line("2026-06-01T11:00:00.000Z"),
    );

    const first = scan({ claudeDir, codexDir });
    expect(first.sessionMeta.get("claude:dup")?.turns).toBe(2);
    // both files are indexed under the one composite key
    expect(first.sessionIndex.get("claude:dup")?.files).toHaveLength(2);
    const second = scan({ claudeDir, codexDir }); // cache hit; must not mutate cached meta
    expect(second.sessionMeta.get("claude:dup")?.turns).toBe(2);
    expect(second.sessionIndex.get("claude:dup")?.files).toHaveLength(2);
  });

  it("indexes every distinct id of a multi-session Codex rollout under the same file", () => {
    const idA = "019e39b9-0000-7000-a000-0000000000a1";
    const idB = "019e2f27-0000-7000-a000-0000000000b2";
    const content = [
      JSON.stringify({
        timestamp: "2026-06-11T09:00:00.000Z",
        type: "session_meta",
        payload: { id: idA, cwd: "/Users/me/ProjX" },
      }),
      JSON.stringify({
        timestamp: "2026-06-11T09:00:01.000Z",
        type: "turn_context",
        payload: { model: "gpt-5.5", cwd: "/Users/me/ProjX" },
      }),
      JSON.stringify({
        timestamp: "2026-06-11T09:00:02.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "a" }],
        },
      }),
      JSON.stringify({
        timestamp: "2026-06-11T09:00:03.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 100,
              cached_input_tokens: 0,
              output_tokens: 0,
              reasoning_output_tokens: 0,
              total_tokens: 100,
            },
          },
        },
      }),
      JSON.stringify({
        timestamp: "2026-06-11T09:00:10.000Z",
        type: "session_meta",
        payload: { id: idB, cwd: "/Users/me/ProjY" },
      }),
      JSON.stringify({
        timestamp: "2026-06-11T09:00:11.000Z",
        type: "turn_context",
        payload: { model: "gpt-5.3-codex", cwd: "/Users/me/ProjY" },
      }),
      JSON.stringify({
        timestamp: "2026-06-11T09:00:12.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "b" }],
        },
      }),
      JSON.stringify({
        timestamp: "2026-06-11T09:00:13.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 300,
              cached_input_tokens: 0,
              output_tokens: 0,
              reasoning_output_tokens: 0,
              total_tokens: 300,
            },
          },
        },
      }),
    ].join("\n");
    mkdirSync(join(codexDir, "2026", "06", "11"), { recursive: true });
    const file = join(codexDir, "2026", "06", "11", "rollout-multi.jsonl");
    writeFileSync(file, content);

    const { sessionMeta, sessionIndex, records } = scan({
      claudeDir,
      codexDir,
    });
    expect(sessionMeta.get(`codex:${idA}`)?.turns).toBe(1);
    expect(sessionMeta.get(`codex:${idB}`)?.turns).toBe(1);
    expect(sessionMeta.get(`codex:${idA}`)?.models).toEqual(["gpt-5.5"]);
    expect(sessionMeta.get(`codex:${idB}`)?.models).toEqual(["gpt-5.3-codex"]);
    // both ids point at the SAME single file
    expect(sessionIndex.get(`codex:${idA}`)?.files).toEqual([file]);
    expect(sessionIndex.get(`codex:${idB}`)?.files).toEqual([file]);
    expect(sessionIndex.get(`codex:${idA}`)?.sessionId).toBe(idA);
    // Continuous counter: idB's record delta is 300 - 100 = 200 (baseline never
    // reset), so its input is 200, not the full cumulative 300.
    const rb = records.find((r) => r.sessionId === idB)!;
    expect(rb.inputTokens).toBe(200);
  });
});
