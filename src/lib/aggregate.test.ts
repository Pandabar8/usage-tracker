// src/lib/aggregate.test.ts
import { describe, it, expect } from "vitest";
import { aggregate, claudeWindows } from "./aggregate";
import type { UsageRecord } from "./normalize";
import type { PricingTable } from "./pricing";

const pricing: PricingTable = {
  "claude-opus-4-8": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "gpt-5.3-codex": { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
};

function rec(p: Partial<UsageRecord>): UsageRecord {
  return {
    tool: "claude",
    timestamp: "2026-06-01T10:00:00.000Z",
    model: "claude-opus-4-8",
    project: "ProjA",
    sessionId: "s",
    inputTokens: 0,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    reasoningTokens: 0,
    ...p,
  };
}

describe("aggregate", () => {
  const records = [
    rec({
      tool: "claude",
      timestamp: "2026-06-01T10:00:00.000Z",
      model: "claude-opus-4-8",
      project: "ProjA",
      inputTokens: 100,
      outputTokens: 50,
      cacheWriteTokens: 200,
      cacheReadTokens: 300,
    }),
    rec({
      tool: "claude",
      timestamp: "2026-06-02T10:00:00.000Z",
      model: "claude-opus-4-8",
      project: "ProjB",
      inputTokens: 10,
      outputTokens: 5,
    }),
    rec({
      tool: "codex",
      timestamp: "2026-06-02T11:00:00.000Z",
      model: "gpt-5.3-codex",
      project: "ProjB",
      inputTokens: 200,
      cacheReadTokens: 800,
      outputTokens: 100,
      reasoningTokens: 40,
    }),
  ];
  const r = aggregate(records, null, pricing);

  it("totals tokens and cost per tool and combined", () => {
    // claude tokens: (100+50+200+300) + (10+5) = 665
    expect(r.totals.claude.tokens).toBe(665);
    // codex tokens: 200+100+0+800 = 1100
    expect(r.totals.codex.tokens).toBe(1100);
    expect(r.totals.combined.tokens).toBe(1765);
    // claude cost: rec1 3150/1e6 + rec2 (10*5+5*25)/1e6 = 3150/1e6 + 175/1e6
    expect(r.totals.claude.cost).toBeCloseTo(0.003325, 10);
    // codex priced at 0 → cost 0
    expect(r.totals.codex.cost).toBe(0);
  });

  it("buckets by day with per-tool token totals", () => {
    expect(r.byDay).toEqual([
      {
        date: "2026-06-01",
        claudeTokens: 650,
        codexTokens: 0,
        claudeCost: 0.00315,
        codexCost: 0,
      },
      {
        date: "2026-06-02",
        claudeTokens: 15,
        codexTokens: 1100,
        claudeCost: 0.000175,
        codexCost: 0,
      },
    ]);
  });

  it("buckets by project and by model, marking unpriced models", () => {
    const codexModel = r.byModel.find((m: any) => m.model === "gpt-5.3-codex");
    expect(codexModel?.unpriced).toBe(true);
    const opusModel = r.byModel.find((m: any) => m.model === "claude-opus-4-8");
    expect(opusModel?.unpriced).toBe(false);
    expect(r.byProject.map((p: any) => p.project)).toContain("ProjB");
  });

  it("reports the date range", () => {
    expect(r.dateRange).toEqual({
      start: "2026-06-01T10:00:00.000Z",
      end: "2026-06-02T11:00:00.000Z",
    });
  });
});

describe("claudeWindows", () => {
  const now = Date.parse("2026-06-29T12:00:00.000Z");
  const records = [
    rec({
      tool: "claude",
      timestamp: "2026-06-29T10:00:00.000Z",
      outputTokens: 100,
    }), // 2h old -> 5h & 7d
    rec({
      tool: "claude",
      timestamp: "2026-06-29T05:00:00.000Z",
      outputTokens: 200,
    }), // 7h old -> 7d only
    rec({
      tool: "claude",
      timestamp: "2026-06-25T12:00:00.000Z",
      outputTokens: 400,
    }), // 4d old -> 7d only
    rec({
      tool: "claude",
      timestamp: "2026-06-20T12:00:00.000Z",
      outputTokens: 800,
    }), // 9d old -> neither
    rec({
      tool: "codex",
      timestamp: "2026-06-29T11:30:00.000Z",
      outputTokens: 1000,
    }), // excluded: not claude
    rec({
      tool: "claude",
      timestamp: "2026-06-30T00:00:00.000Z",
      outputTokens: 50,
    }), // future -> excluded
  ];

  it("sums claude tokens in the rolling 5h and 7d windows, excluding codex and future records", () => {
    const w = claudeWindows(records, now);
    expect(w.fiveHourTokens).toBe(100);
    expect(w.sevenDayTokens).toBe(700);
    expect(w.asOf).toBe("2026-06-29T12:00:00.000Z");
  });

  it("skips malformed timestamps without throwing", () => {
    const w = claudeWindows(
      [rec({ tool: "claude", timestamp: "not-a-date", outputTokens: 99 })],
      now,
    );
    expect(w.fiveHourTokens).toBe(0);
    expect(w.sevenDayTokens).toBe(0);
  });
});
