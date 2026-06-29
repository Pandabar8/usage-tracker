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

describe("parseCodexFile", () => {
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
});
