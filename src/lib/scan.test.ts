// src/lib/scan.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
import { totalTokens } from "./normalize";

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

  it("reconciles a forked rollout across files: the session total equals its max cumulative, not the replay-inflated sum", () => {
    // Stands in for real id 019e2f27 spanning 3 files. A fork REPLAYS the parent's
    // session_meta + cumulative token history under the SAME id in a new file, so
    // summing every file double-counts the replay. Correct total = the max
    // cumulative (10000 here; 199,637,209 in real data), NOT 20200.
    const P = "019e2f27-0000-7000-a000-00000000cafe";
    const F1 = "019e39b8-0000-7000-a000-00000000f001";
    const F2 = "019e39b9-0000-7000-a000-00000000f002";
    const meta = (ts: string, id: string, forked?: string) =>
      JSON.stringify({
        timestamp: ts,
        type: "session_meta",
        payload: forked
          ? { id, forked_from_id: forked, cwd: "/Users/me/FinApp" }
          : { id, cwd: "/Users/me/FinApp" },
      });
    const turn = (ts: string) =>
      JSON.stringify({
        timestamp: ts,
        type: "turn_context",
        payload: { model: "gpt-5.5", cwd: "/Users/me/FinApp" },
      });
    const tc = (
      ts: string,
      input: number,
      cached: number,
      output: number,
      total: number,
    ) =>
      JSON.stringify({
        timestamp: ts,
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: input,
              cached_input_tokens: cached,
              output_tokens: output,
              reasoning_output_tokens: 0,
              total_tokens: total,
            },
          },
        },
      });

    const parent = [
      meta("2026-05-16T00:00:00.000Z", P),
      turn("2026-05-16T00:00:30.000Z"),
      tc("2026-05-16T00:01:00.000Z", 900, 100, 100, 1000),
      tc("2026-05-16T00:02:00.000Z", 4500, 500, 500, 5000),
      tc("2026-05-16T00:03:00.000Z", 9000, 1000, 1000, 10000),
    ].join("\n");
    // fork1: own id F1, then REPLAYS parent meta P + parent snapshots verbatim, zero new
    const fork1 = [
      meta("2026-05-18T00:00:00.000Z", F1, P),
      turn("2026-05-18T00:00:00.050Z"),
      meta("2026-05-18T00:00:00.100Z", P),
      tc("2026-05-18T00:00:00.200Z", 900, 100, 100, 1000),
      tc("2026-05-18T00:00:00.300Z", 4500, 500, 500, 5000),
    ].join("\n");
    // fork2: replays P to the fork point then adds 200 genuinely-new (attributed to P)
    const fork2 = [
      meta("2026-05-18T01:00:00.000Z", F2, P),
      turn("2026-05-18T01:00:00.050Z"),
      meta("2026-05-18T01:00:00.100Z", P),
      tc("2026-05-18T01:00:00.200Z", 900, 100, 100, 1000),
      tc("2026-05-18T01:00:00.300Z", 4500, 500, 500, 5000),
      tc("2026-05-18T01:00:00.400Z", 4600, 500, 600, 5200),
    ].join("\n");

    mkdirSync(join(codexDir, "2026", "05", "16"), { recursive: true });
    mkdirSync(join(codexDir, "2026", "05", "18"), { recursive: true });
    writeFileSync(
      join(codexDir, "2026", "05", "16", "rollout-parent.jsonl"),
      parent,
    );
    writeFileSync(
      join(codexDir, "2026", "05", "18", "rollout-fork1.jsonl"),
      fork1,
    );
    writeFileSync(
      join(codexDir, "2026", "05", "18", "rollout-fork2.jsonl"),
      fork2,
    );

    const { records } = scan({ claudeDir, codexDir });
    const codex = records.filter((r) => r.tool === "codex");
    const summed = codex.reduce((acc, r) => acc + totalTokens(r), 0);
    // Parent (max 10000) is authoritative; both replay files' P records dropped,
    // including fork2's 200 genuinely-new (absorbed below the parent high-water
    // mark, matching the oracle max-cumulative ground truth). NOT 10000+5000+5200.
    expect(summed).toBe(10000);
    expect(codex).toHaveLength(3); // only the parent file's three P records survive
    expect(codex.every((r) => r.sessionId === P)).toBe(true);
  });

  it("does not inflate a forked session's turn count with replayed turns", () => {
    // A fork REPLAYS the parent's session_meta AND a prefix of its turns under the
    // SAME id in a new file. mergeMeta summed turns across every file, so the
    // parent's authoritative turns were inflated by the replay. The turn count must
    // match the authoritative (highest-max) file's turns, consistent with how the
    // tokens are reconciled to that same file.
    const P = "019e2f27-0000-7000-a000-00000000ab01";
    const F = "019e39b8-0000-7000-a000-00000000ab02";
    const meta = (ts: string, id: string, forked?: string) =>
      JSON.stringify({
        timestamp: ts,
        type: "session_meta",
        payload: forked
          ? { id, forked_from_id: forked, cwd: "/Users/me/FinApp" }
          : { id, cwd: "/Users/me/FinApp" },
      });
    const turn = (ts: string) =>
      JSON.stringify({
        timestamp: ts,
        type: "turn_context",
        payload: { model: "gpt-5.5", cwd: "/Users/me/FinApp" },
      });
    const assistant = (ts: string, text: string) =>
      JSON.stringify({
        timestamp: ts,
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text }],
        },
      });
    const tc = (ts: string, input: number, total: number) =>
      JSON.stringify({
        timestamp: ts,
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: input,
              cached_input_tokens: 0,
              output_tokens: 0,
              reasoning_output_tokens: 0,
              total_tokens: total,
            },
          },
        },
      });

    // Parent P: TWO real assistant turns, cumulative total peaks at 10000 → authoritative.
    const parent = [
      meta("2026-05-16T00:00:00.000Z", P),
      turn("2026-05-16T00:00:30.000Z"),
      assistant("2026-05-16T00:01:00.000Z", "a1"),
      tc("2026-05-16T00:01:30.000Z", 1000, 1000),
      assistant("2026-05-16T00:02:00.000Z", "a2"),
      tc("2026-05-16T00:02:30.000Z", 10000, 10000),
    ].join("\n");
    // Fork: own id F, then replays P's meta + ONE of P's turns (a prefix) + a
    // token prefix peaking at 5000 (< 10000, so P's records here are dropped).
    const fork = [
      meta("2026-05-18T00:00:00.000Z", F, P),
      turn("2026-05-18T00:00:00.050Z"),
      meta("2026-05-18T00:00:00.100Z", P),
      assistant("2026-05-18T00:00:00.200Z", "a1"),
      tc("2026-05-18T00:00:00.300Z", 1000, 1000),
      tc("2026-05-18T00:00:00.400Z", 5000, 5000),
    ].join("\n");

    mkdirSync(join(codexDir, "2026", "05", "16"), { recursive: true });
    mkdirSync(join(codexDir, "2026", "05", "18"), { recursive: true });
    writeFileSync(
      join(codexDir, "2026", "05", "16", "rollout-parent.jsonl"),
      parent,
    );
    writeFileSync(
      join(codexDir, "2026", "05", "18", "rollout-fork.jsonl"),
      fork,
    );

    const { records, sessionMeta } = scan({ claudeDir, codexDir });
    // Canonical: the parent authoritative file has exactly two assistant turns
    // (a1, a2). The replay's one turn must NOT be summed on top (would give 3).
    expect(sessionMeta.get(`codex:${P}`)?.turns).toBe(2);
    // Token reconciliation must still hold: only the parent's records survive.
    const codexP = records.filter(
      (r) => r.tool === "codex" && r.sessionId === P,
    );
    expect(codexP.reduce((acc, r) => acc + totalTokens(r), 0)).toBe(10000);
  });

  it("breaks an authoritative-file tie toward the earliest (parent) file and warns", () => {
    // Two files carry the SAME id reaching the SAME max cumulative total (5000).
    // Selection must be deterministic regardless of scan order: the earliest-
    // timestamped file (the original rollout; a replay is always written later)
    // wins, so the parent's day/project attribution is kept, not the replay's.
    // Equal maxima across files is exactly the "comparable maxima" ambiguity the
    // reconciler logs (not silently drops).
    const P = "019e2f27-0000-7000-a000-00000000d1e1";
    const tc = (
      ts: string,
      input: number,
      cached: number,
      output: number,
      total: number,
      id: string,
      cwd: string,
    ) =>
      [
        JSON.stringify({
          timestamp: ts,
          type: "session_meta",
          payload: { id, cwd },
        }),
        JSON.stringify({
          timestamp: ts,
          type: "turn_context",
          payload: { model: "gpt-5.5", cwd },
        }),
        JSON.stringify({
          timestamp: ts,
          type: "event_msg",
          payload: {
            type: "token_count",
            info: {
              total_token_usage: {
                input_tokens: input,
                cached_input_tokens: cached,
                output_tokens: output,
                reasoning_output_tokens: 0,
                total_tokens: total,
              },
            },
          },
        }),
      ].join("\n");

    // Both reach total 5000; earlier file is dated 05-16 with project ProjEarly,
    // later replay is dated 05-18 with project ProjLate.
    const early = tc(
      "2026-05-16T00:01:00.000Z",
      4500,
      500,
      500,
      5000,
      P,
      "/Users/me/ProjEarly",
    );
    const late = tc(
      "2026-05-18T00:01:00.000Z",
      4500,
      500,
      500,
      5000,
      P,
      "/Users/me/ProjLate",
    );
    mkdirSync(join(codexDir, "2026", "05", "16"), { recursive: true });
    mkdirSync(join(codexDir, "2026", "05", "18"), { recursive: true });
    writeFileSync(
      join(codexDir, "2026", "05", "16", "rollout-tie-early.jsonl"),
      early,
    );
    writeFileSync(
      join(codexDir, "2026", "05", "18", "rollout-tie-late.jsonl"),
      late,
    );

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { records } = scan({ claudeDir, codexDir });
    // Capture the spy's call state BEFORE restoring: mockRestore() also resets
    // call history, so asserting on `warn` after restore is unreliable.
    const warnCalled = warn.mock.calls.length > 0;
    warn.mockRestore();

    const codex = records.filter(
      (r) => r.tool === "codex" && r.sessionId === P,
    );
    const summed = codex.reduce((acc, r) => acc + totalTokens(r), 0);
    expect(summed).toBe(5000); // one file wins the tie; NOT 10000
    expect(codex).toHaveLength(1); // only the winning file's single record survives
    expect(codex.every((r) => r.project === "ProjEarly")).toBe(true); // parent attribution kept
    expect(warnCalled).toBe(true); // comparable-maxima ambiguity is logged, not silent
  });
});
