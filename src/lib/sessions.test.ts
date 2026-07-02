// src/lib/sessions.test.ts
import { describe, it, expect } from "vitest";
import { groupSessions } from "./sessions";
import type { SessionMeta, UsageRecord } from "./normalize";

const records: UsageRecord[] = [
  {
    tool: "claude",
    timestamp: "2026-06-01T10:00:00.000Z",
    model: "claude-opus-4-8",
    project: "ProjA",
    sessionId: "s1",
    inputTokens: 100,
    outputTokens: 50,
    cacheWriteTokens: 200,
    cacheReadTokens: 300,
    reasoningTokens: 0,
  },
  {
    tool: "claude",
    timestamp: "2026-06-01T11:00:00.000Z",
    model: "claude-sonnet-4-6",
    project: "ProjA",
    sessionId: "s1",
    inputTokens: 10,
    outputTokens: 5,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    reasoningTokens: 0,
  },
  {
    tool: "codex",
    timestamp: "2026-06-02T09:00:00.000Z",
    model: "gpt-5.3-codex",
    project: "ProjB",
    sessionId: "c1",
    inputTokens: 200,
    outputTokens: 100,
    cacheWriteTokens: 0,
    cacheReadTokens: 800,
    reasoningTokens: 40,
  },
];

// `meta` is keyed by the composite route key `${tool}:${sessionId}`, matching
// scan()'s sessionMeta.
const meta = new Map<string, SessionMeta>([
  [
    "claude:s1",
    {
      sessionId: "s1",
      tool: "claude",
      turns: 5,
      toolCalls: 3,
      models: ["claude-opus-4-8", "claude-sonnet-4-6"],
      startedAt: "2026-06-01T10:00:00.000Z",
      endedAt: "2026-06-01T12:00:00.000Z",
      compaction: { full: 1, micro: 2, tokensSaved: 12345 },
    },
  ],
  [
    "codex:c1",
    {
      sessionId: "c1",
      tool: "codex",
      turns: 2,
      toolCalls: 4,
      models: ["gpt-5.3-codex"],
      startedAt: "2026-06-02T09:00:00.000Z",
      endedAt: "2026-06-02T09:30:00.000Z",
    },
  ],
]);

describe("groupSessions", () => {
  it("groups records + meta into summaries sorted by most recent start", () => {
    const summaries = groupSessions(records, meta);
    expect(summaries).toHaveLength(2);
    expect(summaries.map((s) => s.id)).toEqual(["c1", "s1"]);
    // Each summary carries both the composite route key and the raw id.
    expect(summaries.map((s) => s.key)).toEqual(["codex:c1", "claude:s1"]);
  });

  it("pins token totals, cost, duration, and compaction for a Claude session", () => {
    const s1 = groupSessions(records, meta).find((s) => s.id === "s1")!;
    expect(s1.key).toBe("claude:s1");
    expect(s1).toMatchObject({
      tool: "claude",
      project: "ProjA",
      models: ["claude-opus-4-8", "claude-sonnet-4-6"],
      turns: 5,
      toolCalls: 3,
      totalTokens: 665, // 650 + 15
      durationMs: 7200000, // 10:00 -> 12:00
      unpriced: false,
      compaction: { full: 1, micro: 2, tokensSaved: 12345 },
    });
    expect(s1.tokens).toEqual({
      input: 110,
      output: 55,
      cacheWrite: 200,
      cacheRead: 300,
    });
    // opus: (100*5 + 50*25 + 200*6.25 + 300*0.5)/1e6 = 0.00315
    // sonnet: (10*3 + 5*15)/1e6 = 0.000105
    expect(s1.cost).toBeCloseTo(0.003255, 8);
  });

  it("omits compaction for Codex sessions and pins Codex cost", () => {
    const c1 = groupSessions(records, meta).find((s) => s.id === "c1")!;
    expect(c1.key).toBe("codex:c1");
    expect(c1.compaction).toBeUndefined();
    expect(c1.totalTokens).toBe(1100); // 200 + 100 + 0 + 800
    // (200*1.75 + 100*14 + 800*0.175)/1e6 = 0.00189
    expect(c1.cost).toBeCloseTo(0.00189, 8);
  });
});
