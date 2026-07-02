// src/lib/parsers/codex.test.ts
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { parseCodexFile } from "./codex";
import { totalTokens } from "../normalize";

const sample = fileURLToPath(
  new URL("./__fixtures__/codex-sample.jsonl", import.meta.url),
);
const edge = fileURLToPath(
  new URL("./__fixtures__/codex-edge.jsonl", import.meta.url),
);
const reset = fileURLToPath(
  new URL("./__fixtures__/codex-reset.jsonl", import.meta.url),
);
const multimeta = fileURLToPath(
  new URL("./__fixtures__/codex-multimeta.jsonl", import.meta.url),
);
const trim = fileURLToPath(
  new URL("./__fixtures__/codex-trim.jsonl", import.meta.url),
);
const hwmRecover = fileURLToPath(
  new URL("./__fixtures__/codex-hwm-recover.jsonl", import.meta.url),
);

describe("parseCodexFile", () => {
  it("does not over-count when one file has many session_meta lines sharing a single monotonic counter", () => {
    // Real Codex rollouts pack hundreds of session_meta lines around ONE
    // continuous cumulative counter. The baseline must NOT reset on session_meta,
    // or each subsequent event's delta becomes the full running cumulative.
    const { records } = parseCodexFile(multimeta);
    expect(records).toHaveLength(3);
    expect(records[1]).toMatchObject({ inputTokens: 170, outputTokens: 30 }); // delta 100 -> 300
    expect(records[2]).toMatchObject({ inputTokens: 250, outputTokens: 50 }); // delta 300 -> 600
    const summed = records.reduce((acc, r) => acc + totalTokens(r), 0);
    expect(summed).toBe(600); // final cumulative total, NOT 1000 (the session_meta over-count)
  });

  it("derives records from cumulative total_token_usage deltas, mapping fresh input and cache read", () => {
    const { records } = parseCodexFile(sample);
    expect(records).toHaveLength(2);

    expect(records[0]).toMatchObject({
      tool: "codex",
      model: "gpt-5.3-codex",
      project: "ProjB",
      sessionId: "c1",
      timestamp: "2026-06-02T09:05:00.000Z",
      inputTokens: 200,
      cacheReadTokens: 800,
      outputTokens: 100,
      reasoningTokens: 40,
      cacheWriteTokens: 0,
    });
    expect(records[1]).toMatchObject({
      timestamp: "2026-06-02T09:10:00.000Z",
      inputTokens: 300,
      cacheReadTokens: 200,
      outputTokens: 50,
      reasoningTokens: 10,
    });
  });

  it("accounting guard: summed record totals equal the final cumulative total", () => {
    const { records } = parseCodexFile(sample);
    const summed = records.reduce((acc, r) => acc + totalTokens(r), 0);
    expect(summed).toBe(1650); // final total_token_usage.total_tokens
  });

  it("skips duplicate snapshots and needs no last_token_usage (edge fixture)", () => {
    const { records } = parseCodexFile(edge);
    expect(records).toHaveLength(2); // the duplicate 09:02 snapshot is skipped
    expect(records[0]).toMatchObject({
      inputTokens: 100,
      cacheReadTokens: 0,
      outputTokens: 10,
    });
    expect(records[1]).toMatchObject({
      inputTokens: 150,
      cacheReadTokens: 50,
      outputTokens: 20,
      reasoningTokens: 5,
    });
    const summed = records.reduce((acc, r) => acc + totalTokens(r), 0);
    expect(summed).toBe(330); // final cumulative total
  });

  it("clamps a per-field regression to zero without over-counting (reset fixture)", () => {
    const { records } = parseCodexFile(reset);
    expect(records).toHaveLength(2);
    expect(records[1]).toMatchObject({
      inputTokens: 100,
      cacheReadTokens: 0, // cached regressed 80 -> 50; the delta clamps to 0, not -30
      outputTokens: 15,
    });
    const summed = records.reduce((acc, r) => acc + totalTokens(r), 0);
    expect(summed).toBe(225); // still equals the final cumulative total
  });

  it("captures the latest rate-limit snapshot as quota", () => {
    const { quota } = parseCodexFile(sample);
    expect(quota).not.toBeNull();
    expect(quota!.timestamp).toBe("2026-06-02T09:10:00.000Z");
    expect(quota!.primary).toMatchObject({
      usedPercent: 30,
      windowMinutes: 300,
      resetsAt: 1000,
    });
    expect(quota!.secondary).toMatchObject({
      usedPercent: 7,
      windowMinutes: 10080,
      resetsAt: 2000,
    });
  });

  it("neutralizes a mid-session context trim with a high-water-mark delta", () => {
    // Real anchor 019e93ca: total drops 10,281,101 -> 4,710,806 mid-stream;
    // correct total is the max cumulative 41,502,331, NOT the 51,783,432 the old
    // "backwards move => re-add the whole snapshot" rule produced.
    const { records } = parseCodexFile(trim);
    expect(records).toHaveLength(3); // the 2000 trim snapshot yields NO record
    expect(records.map((r) => r.inputTokens)).toEqual([1000, 4000, 3000]);
    const summed = records.reduce((acc, r) => acc + totalTokens(r), 0);
    expect(summed).toBe(8000); // == max cumulative; the old rule summed 13000
  });

  it("tracks the high-water mark PER FIELD so a regressed-then-recovered component is not re-added", () => {
    // output regresses (1000 -> 200) while the cumulative total advances
    // (2000 -> 5200), then recovers to 1200. Measuring output's recovery from its
    // own high-water value (1000) counts only the genuinely-new 200; measuring it
    // from the regressed low (200) would re-add 800 and over-count.
    // Correct summed total = max cumulative total_tokens = 7200 (input peaks at
    // 6000, output at 1200; 6000 + 1200 = 7200). Both the OLD prev-based rule and
    // a whole-snapshot HWM replacement would report 8000 (the extra 800).
    const { records } = parseCodexFile(hwmRecover);
    expect(records).toHaveLength(3);
    expect(records.map((r) => r.inputTokens)).toEqual([1000, 4000, 1000]);
    expect(records.map((r) => r.outputTokens)).toEqual([1000, 0, 200]);
    const summed = records.reduce((acc, r) => acc + totalTokens(r), 0);
    expect(summed).toBe(7200); // == max cumulative; the un-fielded rule summed 8000
  });
});

const codexMessages = fileURLToPath(
  new URL("./__fixtures__/codex-messages.jsonl", import.meta.url),
);
const codexMulti = fileURLToPath(
  new URL("./__fixtures__/codex-multi-session.jsonl", import.meta.url),
);
const codexCompaction = fileURLToPath(
  new URL("./__fixtures__/codex-compaction.jsonl", import.meta.url),
);
const codexTools = fileURLToPath(
  new URL("./__fixtures__/codex-tools.jsonl", import.meta.url),
);

describe("parseCodexFile session meta", () => {
  it("counts assistant turns, function calls, and models during the parse pass", () => {
    const { records, sessions } = parseCodexFile(codexMessages);
    expect(records).toHaveLength(1); // one token_count with forward progress
    expect(sessions).toHaveLength(1);
    expect(sessions![0]).toMatchObject({
      sessionId: "c9",
      tool: "codex",
      turns: 2, // one response_item assistant + one agent_message fallback turn
      toolCalls: 2, // two function_call items
      models: ["gpt-5.3-codex"],
      startedAt: "2026-06-11T09:00:00.000Z",
      endedAt: "2026-06-11T09:00:25.000Z",
    });
    expect(sessions![0].compaction).toBeUndefined();
  });
});

describe("parseCodexFile across a multi-session rollout", () => {
  it("emits one SessionMeta per distinct id with per-id counts, sharing one continuous token counter", () => {
    const { records, sessions } = parseCodexFile(codexMulti);
    expect(sessions).toHaveLength(2);

    const a = sessions!.find(
      (s) => s.sessionId === "019e39b9-0000-7000-a000-0000000000a1",
    )!;
    const b = sessions!.find(
      (s) => s.sessionId === "019e2f27-0000-7000-a000-0000000000b2",
    )!;
    expect(a).toMatchObject({
      tool: "codex",
      turns: 1, // one response_item assistant
      toolCalls: 1, // one function_call
      models: ["gpt-5.5"],
      startedAt: "2026-06-11T09:00:00.000Z",
      endedAt: "2026-06-11T09:00:06.000Z",
    });
    expect(b).toMatchObject({
      tool: "codex",
      turns: 1, // one agent_message fallback turn
      toolCalls: 1, // one function_call
      models: ["gpt-5.3-codex"],
      startedAt: "2026-06-11T09:00:10.000Z",
      endedAt: "2026-06-11T09:00:16.000Z",
    });

    // One record per token_count with forward progress, attributed to the active
    // id at that point.
    expect(records).toHaveLength(2);
    const ra = records.find(
      (r) => r.sessionId === "019e39b9-0000-7000-a000-0000000000a1",
    )!;
    const rb = records.find(
      (r) => r.sessionId === "019e2f27-0000-7000-a000-0000000000b2",
    )!;
    // Session A cumulative 1000 (delta from 0): input 900 - cached 100 = 800,
    // cacheRead 100, output 100.
    expect(ra).toMatchObject({
      model: "gpt-5.5",
      inputTokens: 800,
      outputTokens: 100,
      cacheWriteTokens: 0,
      cacheReadTokens: 100,
      reasoningTokens: 0,
    });
    // Session B cumulative 1600 (delta 600, NOT 1600 — the baseline is never
    // reset on session_meta): input 600 - cached 300 = 300, cacheRead 300,
    // output 0. A reset would have produced inputTokens 1100.
    expect(rb).toMatchObject({
      model: "gpt-5.3-codex",
      inputTokens: 300,
      outputTokens: 0,
      cacheWriteTokens: 0,
      cacheReadTokens: 300,
      reasoningTokens: 0,
    });
  });

  it("exposes each session's max cumulative total for cross-file reconciliation", () => {
    const { sessionMaxTotals } = parseCodexFile(codexMulti);
    expect(sessionMaxTotals?.get("019e39b9-0000-7000-a000-0000000000a1")).toBe(
      1000,
    );
    expect(sessionMaxTotals?.get("019e2f27-0000-7000-a000-0000000000b2")).toBe(
      1600,
    );
  });
});

describe("parseCodexFile tool-call coverage", () => {
  it("counts every real Codex tool payload type, deduping completion events by call_id", () => {
    const { sessions } = parseCodexFile(codexTools);
    expect(sessions).toHaveLength(1);
    // shell + apply_patch + web_search + tool_search + resolve_library_id
    // (mcp_tool_call_end for the same call_id deduped) + apply_patch (patch_apply_end
    // for the same call_id deduped) + srv.solo_tool (event-only) + apply_patch
    // (event-only) = 8 raw tool calls, NOT 10.
    expect(sessions![0]).toMatchObject({
      sessionId: "ct",
      tool: "codex",
      turns: 1,
      toolCalls: 8,
    });
  });
});

describe("parseCodexFile Codex compaction (v1: intentionally no compaction field)", () => {
  it("ignores compacted / context_compacted events and never sets a compaction field", () => {
    const { sessions } = parseCodexFile(codexCompaction);
    expect(sessions).toHaveLength(1);
    expect(sessions![0].compaction).toBeUndefined();
    // Turns are the two real assistant turns; the compacted line's
    // replacement_history does NOT inflate the count.
    expect(sessions![0]).toMatchObject({
      sessionId: "cc",
      tool: "codex",
      turns: 2,
      toolCalls: 1,
    });
  });
});
