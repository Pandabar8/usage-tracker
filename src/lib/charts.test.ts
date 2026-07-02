// src/lib/charts.test.ts
import { describe, it, expect } from "vitest";
import { peakHours } from "./charts";
import type { UsageRecord } from "./normalize";

function rec(p: Partial<UsageRecord>): UsageRecord {
  return {
    tool: "claude",
    timestamp: "2026-06-01T00:15:00",
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

describe("peakHours", () => {
  it("counts records per local hour-of-day across a length-24 array", () => {
    const records = [
      rec({ tool: "claude", timestamp: "2026-06-01T00:15:00" }),
      rec({ tool: "claude", timestamp: "2026-06-01T03:00:00" }),
      rec({ tool: "codex", timestamp: "2026-06-02T03:59:00" }),
      rec({ tool: "claude", timestamp: "2026-06-01T14:30:00" }),
      rec({ tool: "codex", timestamp: "2026-06-03T23:00:00" }),
      rec({ tool: "claude", timestamp: "not-a-date" }),
    ];
    const h = peakHours(records);
    expect(h).toEqual([
      1, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    ]);
    expect(h).toHaveLength(24);
  });

  it("returns a length-24 zero array for no records", () => {
    expect(peakHours([])).toEqual(new Array(24).fill(0));
  });
});
