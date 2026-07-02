// src/lib/compare.test.ts
import { describe, it, expect } from "vitest";
import { diffSessions, diffModels, type DiffRow } from "./compare";
import type { SessionSummary } from "./normalize";
import type { ModelStats } from "./aggregate";

const row = (rows: DiffRow[], key: string) => rows.find((r) => r.key === key)!;

const sA: SessionSummary = {
  key: "claude:s1",
  id: "s1",
  tool: "claude",
  project: "ProjA",
  models: ["claude-opus-4-8"],
  startedAt: "2026-06-01T10:00:00.000Z",
  endedAt: "2026-06-01T12:00:00.000Z",
  durationMs: 7200000,
  turns: 5,
  toolCalls: 3,
  tokens: { input: 110, output: 55, cacheWrite: 200, cacheRead: 300 },
  totalTokens: 665,
  cost: 0.003325,
  unpriced: false,
};

const sB: SessionSummary = {
  key: "codex:c1",
  id: "c1",
  tool: "codex",
  project: "ProjB",
  models: ["gpt-5.3-codex"],
  startedAt: "2026-06-02T09:00:00.000Z",
  endedAt: "2026-06-02T09:30:00.000Z",
  durationMs: 1800000,
  turns: 2,
  toolCalls: 4,
  tokens: { input: 200, output: 100, cacheWrite: 0, cacheRead: 800 },
  totalTokens: 1100,
  cost: 0.00189,
  unpriced: false,
};

describe("diffSessions", () => {
  it("pins values, kinds, and B-minus-A deltas per metric", () => {
    const { rows } = diffSessions(sA, sB);
    expect(row(rows, "totalTokens")).toMatchObject({
      a: 665,
      b: 1100,
      delta: 435,
      kind: "int",
    });
    expect(row(rows, "input")).toMatchObject({ a: 110, b: 200, delta: 90 });
    expect(row(rows, "output")).toMatchObject({ a: 55, b: 100, delta: 45 });
    expect(row(rows, "toolCalls")).toMatchObject({ a: 3, b: 4, delta: 1 });
    expect(row(rows, "turns")).toMatchObject({ a: 5, b: 2, delta: -3 });
    expect(row(rows, "durationMs")).toMatchObject({
      a: 7200000,
      b: 1800000,
      delta: -5400000,
      kind: "dur",
    });

    const cost = row(rows, "cost");
    expect(cost.kind).toBe("usd");
    expect(cost.delta).toBeCloseTo(-0.001435, 10); // 0.00189 - 0.003325

    const chr = row(rows, "cacheHitRate");
    expect(chr.kind).toBe("pct");
    expect(chr.a).toBeCloseTo(0.7317073170731707, 12); // 300/410
    expect(chr.b).toBe(0.8); // 800/1000
    expect(chr.delta).toBeCloseTo(0.0682926829268293, 12);
  });

  it("treats a missing side as zeros and negates the present side", () => {
    const { a, b, rows } = diffSessions(sA, null);
    expect(a).toBe(sA);
    expect(b).toBeNull();
    expect(row(rows, "totalTokens")).toMatchObject({
      a: 665,
      b: 0,
      delta: -665,
    });
  });
});

const mA: ModelStats = {
  model: "claude-opus-4-8",
  tool: "claude",
  inputTokens: 110,
  outputTokens: 55,
  cacheWriteTokens: 200,
  cacheReadTokens: 300,
  totalTokens: 665,
  cost: 0.003325,
  unpriced: false,
  sessions: 2,
  cacheHitRate: 0.7317073170731707,
  avgTokensPerSession: 332.5,
  avgCostPerSession: 0.0016625,
};

const mB: ModelStats = {
  model: "gpt-5.3-codex",
  tool: "codex",
  inputTokens: 200,
  outputTokens: 100,
  cacheWriteTokens: 0,
  cacheReadTokens: 800,
  totalTokens: 1100,
  cost: 0.00189,
  unpriced: false,
  sessions: 1,
  cacheHitRate: 0.8,
  avgTokensPerSession: 1100,
  avgCostPerSession: 0.00189,
};

describe("diffModels", () => {
  it("pins values and deltas for the model-compare rows", () => {
    const { rows } = diffModels(mA, mB);
    expect(row(rows, "input")).toMatchObject({ a: 110, b: 200, delta: 90 });
    expect(row(rows, "output")).toMatchObject({ a: 55, b: 100, delta: 45 });
    expect(row(rows, "sessions")).toMatchObject({ a: 2, b: 1, delta: -1 });
    expect(row(rows, "avgTokensPerSession")).toMatchObject({
      a: 332.5,
      b: 1100,
      delta: 767.5,
    });

    const chr = row(rows, "cacheHitRate");
    expect(chr.kind).toBe("pct");
    expect(chr.delta).toBeCloseTo(0.0682926829268293, 12);

    const avgCost = row(rows, "avgCostPerSession");
    expect(avgCost.kind).toBe("usd");
    expect(avgCost.delta).toBeCloseTo(0.0002275, 12); // 0.00189 - 0.0016625
  });
});
