// src/lib/parsers/claude.test.ts
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { parseClaudeFile } from "./claude";

const fixture = fileURLToPath(
  new URL("./__fixtures__/claude-sample.jsonl", import.meta.url),
);

describe("parseClaudeFile", () => {
  it("extracts one record per assistant turn with usage, skipping others and malformed lines", () => {
    const { records, quota } = parseClaudeFile(fixture);
    expect(quota).toBeNull();
    expect(records).toHaveLength(2);

    const [a, b] = records;
    expect(a).toMatchObject({
      tool: "claude",
      model: "claude-opus-4-8",
      project: "ProjA",
      sessionId: "s1",
      timestamp: "2026-06-01T10:00:00.000Z",
      inputTokens: 100,
      outputTokens: 50,
      cacheWriteTokens: 200,
      cacheReadTokens: 300,
      reasoningTokens: 0,
    });
    expect(b).toMatchObject({
      model: "claude-sonnet-4-6",
      inputTokens: 10,
      outputTokens: 5,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
    });
  });
});

const compactionFixture = fileURLToPath(
  new URL("./__fixtures__/claude-messages.jsonl", import.meta.url),
);

describe("parseClaudeFile session meta", () => {
  it("counts turns, tool calls, and compaction during the parse pass", () => {
    const { records, sessions } = parseClaudeFile(compactionFixture);
    // Five DISTINCT message.ids carry usage (msg_a1..msg_a5); the three msg_a1
    // split lines collapse to ONE record, so five records total — NOT seven.
    expect(records).toHaveLength(5);
    expect(sessions).toHaveLength(1);
    expect(sessions![0]).toMatchObject({
      sessionId: "m1",
      tool: "claude",
      turns: 5, // one per distinct message.id, not one per split line
      toolCalls: 2, // Bash in msg_a1 (its tool_use line) + Bash in msg_a2
      models: ["claude-opus-4-8"],
      startedAt: "2026-06-10T10:00:00.000Z",
      endedAt: "2026-06-10T10:10:00.000Z",
      compaction: { full: 1, micro: 1, tokensSaved: 785000 }, // 780000 + 5000
    });
  });

  it("dedupes records by message.id so the repeated split-line usage is counted once", () => {
    const { records } = parseClaudeFile(compactionFixture);
    // The msg_a1 turn is written as three lines that each repeat usage
    // {100,50,200,300}. It must appear as exactly ONE record, not three.
    const a1 = records.filter(
      (r) => r.inputTokens === 100 && r.cacheWriteTokens === 200,
    );
    expect(a1).toHaveLength(1);
    expect(a1[0]).toMatchObject({
      sessionId: "m1",
      model: "claude-opus-4-8",
      inputTokens: 100,
      outputTokens: 50,
      cacheWriteTokens: 200,
      cacheReadTokens: 300,
    });
    // Canonical anchor: summed input across the deduped records is 170
    // (100 + 20 + 15 + 30 + 5). The un-deduped per-line parser would sum 370
    // (100 counted three times), which is the pre-existing over-count.
    expect(records.reduce((acc, r) => acc + r.inputTokens, 0)).toBe(170);
  });
});
