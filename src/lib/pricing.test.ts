// src/lib/pricing.test.ts
import { describe, it, expect } from "vitest";
import { cost, isPriced, type PricingTable } from "./pricing";
import type { UsageRecord } from "./normalize";

const table: PricingTable = {
  "claude-opus-4-8": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "gpt-5.3-codex": { input: 1.25, output: 10, cacheWrite: 0, cacheRead: 0.125 },
  "gpt-5-codex": { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
};

function rec(p: Partial<UsageRecord>): UsageRecord {
  return {
    tool: "claude",
    timestamp: "t",
    model: "claude-opus-4-8",
    project: "p",
    sessionId: "s",
    inputTokens: 0,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    reasoningTokens: 0,
    ...p,
  };
}

describe("cost", () => {
  it("prices a Claude record across all token kinds", () => {
    const c = cost(
      rec({
        model: "claude-opus-4-8",
        inputTokens: 100,
        outputTokens: 50,
        cacheWriteTokens: 200,
        cacheReadTokens: 300,
      }),
      table,
    );
    // (100*5 + 50*25 + 200*6.25 + 300*0.5) / 1e6 = 3150/1e6
    expect(c).toBeCloseTo(0.00315, 10);
  });

  it("excludes reasoning tokens from cost (they are part of output)", () => {
    const c = cost(
      rec({
        tool: "codex",
        model: "gpt-5.3-codex",
        inputTokens: 200,
        outputTokens: 100,
        cacheReadTokens: 800,
        reasoningTokens: 40,
      }),
      table,
    );
    // (200*1.25 + 100*10 + 800*0.125) / 1e6 = 1350/1e6
    expect(c).toBeCloseTo(0.00135, 10);
  });

  it("returns 0 for an unknown model", () => {
    expect(
      cost(rec({ model: "mystery-model", inputTokens: 1000 }), table),
    ).toBe(0);
  });
});

describe("isPriced", () => {
  it("is false for unknown models and all-zero rates", () => {
    expect(isPriced("mystery-model", table)).toBe(false);
    expect(isPriced("gpt-5-codex", table)).toBe(false);
  });
  it("is true when at least one rate is non-zero", () => {
    expect(isPriced("claude-opus-4-8", table)).toBe(true);
  });
});
