// src/lib/tips.test.ts
import { describe, it, expect } from "vitest";
import { buildTips } from "./tips";
import type { Forecast, UsageRecord } from "./normalize";
import type { PricingTable } from "./pricing";

const pricing: PricingTable = {
  "claude-opus-4-8": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-sonnet-4-6": {
    input: 3,
    output: 15,
    cacheWrite: 3.75,
    cacheRead: 0.3,
  },
  "gpt-5-codex": { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
};

function rec(p: Partial<UsageRecord>): UsageRecord {
  return {
    tool: "claude",
    timestamp: "2026-06-29T10:00:00.000Z",
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

describe("approaching-limit rule", () => {
  it("warns when a codex window is projected past the threshold", () => {
    const forecast: Forecast = {
      codexPrimary: {
        willExhaust: true,
        projectedPercentAtReset: 120,
        etaToLimit: "2026-06-29T13:40:00.000Z",
      },
      codexSecondary: {
        willExhaust: false,
        projectedPercentAtReset: 80,
        etaToLimit: null,
      },
    };
    const tips = buildTips([], forecast, pricing);
    const t = tips.find((x) => x.id === "approaching-limit-codex-5h");
    expect(t).toBeDefined();
    expect(t?.severity).toBe("warn");
    expect(t?.title).toBe("Codex 5h quota approaching limit");
    expect(t?.detail).toBe(
      "Projected 120% of the Codex 5h quota by reset at the current pace.",
    );
    expect(
      tips.find((x) => x.id === "approaching-limit-codex-weekly"),
    ).toBeUndefined();
  });

  it("does not fire when the projection is null", () => {
    const tips = buildTips(
      [],
      {
        codexPrimary: {
          willExhaust: false,
          projectedPercentAtReset: null,
          etaToLimit: null,
        },
      },
      pricing,
    );
    expect(
      tips.find((x) => x.id === "approaching-limit-codex-5h"),
    ).toBeUndefined();
  });
});

describe("right-size-model rule", () => {
  it("fires with pinned sonnet-equivalent savings for short-output opus work", () => {
    const records = [
      rec({
        tool: "claude",
        model: "claude-opus-4-8",
        inputTokens: 1_000_000,
        outputTokens: 50_000,
      }),
    ];
    const tips = buildTips(records, {}, pricing);
    const t = tips.find((x) => x.id === "right-size-model");
    expect(t).toBeDefined();
    expect(t?.severity).toBe("info");
    expect(t?.savingsUsd).toBeCloseTo(2.5, 10);
    expect(t?.detail).toBe(
      "Opus handled work with little output. The same tokens at Sonnet rates would cost about $3.75 instead of $6.25.",
    );
  });

  it("does not fire when output share is high", () => {
    const records = [
      rec({
        tool: "claude",
        model: "claude-opus-4-8",
        inputTokens: 100_000,
        outputTokens: 900_000,
      }),
    ];
    const tips = buildTips(records, {}, pricing);
    expect(tips.find((x) => x.id === "right-size-model")).toBeUndefined();
  });
});

describe("low-cache rule", () => {
  it("fires when cache read share of prompt tokens is low", () => {
    const records = [
      rec({
        tool: "claude",
        model: "claude-sonnet-4-6",
        inputTokens: 8000,
        cacheReadTokens: 2000,
      }),
    ];
    const tips = buildTips(records, {}, pricing);
    const t = tips.find((x) => x.id === "low-cache");
    expect(t).toBeDefined();
    expect(t?.detail).toBe(
      "Only 20% of prompt tokens were served from cache. Reusing context across turns lowers cost.",
    );
  });

  it("does not fire when cache reuse is high", () => {
    const records = [
      rec({
        tool: "claude",
        model: "claude-sonnet-4-6",
        inputTokens: 1000,
        cacheReadTokens: 90000,
      }),
    ];
    const tips = buildTips(records, {}, pricing);
    expect(tips.find((x) => x.id === "low-cache")).toBeUndefined();
  });

  it("does not fire below the minimum prompt-token floor", () => {
    const records = [
      rec({
        tool: "claude",
        model: "claude-sonnet-4-6",
        inputTokens: 500,
        cacheReadTokens: 100,
      }),
    ];
    const tips = buildTips(records, {}, pricing);
    expect(tips.find((x) => x.id === "low-cache")).toBeUndefined();
  });
});

describe("unpriced-present rule", () => {
  it("fires and names the unpriced model", () => {
    const records = [
      rec({
        tool: "codex",
        model: "gpt-5-codex",
        inputTokens: 5000,
        outputTokens: 1000,
      }),
    ];
    const tips = buildTips(records, {}, pricing);
    const t = tips.find((x) => x.id === "unpriced-present");
    expect(t).toBeDefined();
    expect(t?.detail).toContain("gpt-5-codex");
  });
});

describe("buildTips baseline", () => {
  it("returns no tips for empty input", () => {
    expect(buildTips([], {}, pricing)).toEqual([]);
  });
});
