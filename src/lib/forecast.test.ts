// src/lib/forecast.test.ts
import { describe, it, expect } from "vitest";
import { buildForecast } from "./forecast";
import type { RateLimitSnapshot, UsageRecord } from "./normalize";

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

const NOW = Date.parse("2026-06-29T12:00:00.000Z");

describe("buildForecast codex", () => {
  it("projects end-of-window percent linearly from elapsed fraction", () => {
    const quota: RateLimitSnapshot = {
      timestamp: "2026-06-29T12:00:00.000Z",
      primary: {
        usedPercent: 40,
        windowMinutes: 300,
        resetsAt: Date.parse("2026-06-29T14:30:00.000Z") / 1000,
      },
      secondary: {
        usedPercent: 60,
        windowMinutes: 300,
        resetsAt: Date.parse("2026-06-29T14:30:00.000Z") / 1000,
      },
    };
    const f = buildForecast([], quota, NOW);
    expect(f.codexPrimary?.projectedPercentAtReset).toBeCloseTo(80, 10);
    expect(f.codexPrimary?.willExhaust).toBe(false);
    expect(f.codexPrimary?.etaToLimit).toBeNull();
    expect(f.codexSecondary?.projectedPercentAtReset).toBeCloseTo(120, 10);
    expect(f.codexSecondary?.willExhaust).toBe(true);
    expect(f.codexSecondary?.etaToLimit).toBe("2026-06-29T13:40:00.000Z");
  });

  it("returns null projection right after a reset (elapsed fraction zero)", () => {
    const quota: RateLimitSnapshot = {
      timestamp: "2026-06-29T12:00:00.000Z",
      primary: {
        usedPercent: 10,
        windowMinutes: 300,
        resetsAt: Date.parse("2026-06-29T17:00:00.000Z") / 1000,
      },
      secondary: null,
    };
    const f = buildForecast([], quota, NOW);
    expect(f.codexPrimary?.projectedPercentAtReset).toBeNull();
    expect(f.codexPrimary?.willExhaust).toBe(false);
    expect(f.codexPrimary?.etaToLimit).toBeNull();
  });

  it("omits codex windows when there is no quota", () => {
    const f = buildForecast([], null, NOW);
    expect(f.codexPrimary).toBeUndefined();
    expect(f.codexSecondary).toBeUndefined();
  });

  it("projects from the snapshot timestamp, not the request time (no drift as the snapshot ages)", () => {
    const quota: RateLimitSnapshot = {
      timestamp: "2026-06-29T12:00:00.000Z", // 40% used as of 12:00 -> 0.5 elapsed -> 80
      primary: {
        usedPercent: 40,
        windowMinutes: 300,
        resetsAt: Date.parse("2026-06-29T14:30:00.000Z") / 1000,
      },
      secondary: null,
    };
    // 90 min later, still before reset, no new snapshot. Projection stays anchored
    // to the snapshot (80), not recomputed against `now` (which would give 50).
    const later = Date.parse("2026-06-29T13:30:00.000Z");
    const f = buildForecast([], quota, later);
    expect(f.codexPrimary?.projectedPercentAtReset).toBeCloseTo(80, 10);
  });

  it("returns null for a stale snapshot whose window already reset", () => {
    const quota: RateLimitSnapshot = {
      timestamp: "2026-06-29T06:00:00.000Z",
      primary: {
        usedPercent: 40,
        windowMinutes: 300,
        resetsAt: Date.parse("2026-06-29T08:00:00.000Z") / 1000, // window 03:00-08:00
      },
      secondary: null,
    };
    const f = buildForecast([], quota, NOW); // NOW = 12:00, past the 08:00 reset
    expect(f.codexPrimary?.projectedPercentAtReset).toBeNull();
    expect(f.codexPrimary?.willExhaust).toBe(false);
    expect(f.codexPrimary?.etaToLimit).toBeNull();
  });
});

describe("buildForecast claude volume", () => {
  it("projects rolling token volume from the recent burn rate", () => {
    const records = [
      rec({
        tool: "claude",
        timestamp: "2026-06-29T10:00:00.000Z",
        outputTokens: 100,
      }),
      rec({
        tool: "claude",
        timestamp: "2026-06-29T11:00:00.000Z",
        outputTokens: 200,
      }),
    ];
    const f = buildForecast(records, null, NOW);
    expect(f.claudeFiveHour?.projectedTokens).toBe(750);
    expect(f.claudeFiveHour?.note).toBe("no limit, volume projection");
    expect(f.claudeSevenDay?.projectedTokens).toBe(25200);
  });

  it("returns null volume when there is no recent Claude activity", () => {
    const f = buildForecast([], null, NOW);
    expect(f.claudeFiveHour?.projectedTokens).toBeNull();
    expect(f.claudeFiveHour?.note).toBe("no recent Claude activity");
  });

  it("returns null volume when the activity span is zero", () => {
    const records = [
      rec({
        tool: "claude",
        timestamp: "2026-06-29T12:00:00.000Z",
        outputTokens: 500,
      }),
    ];
    const f = buildForecast(records, null, NOW);
    expect(f.claudeFiveHour?.projectedTokens).toBeNull();
    expect(f.claudeFiveHour?.note).toBe("insufficient time span");
  });
});
