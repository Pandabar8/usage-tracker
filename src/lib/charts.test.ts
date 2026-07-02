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

import { calendarGrid } from "./charts";
import type { DayPoint } from "./aggregate";

function day(p: Partial<DayPoint>): DayPoint {
  return {
    date: "2026-06-01",
    claudeTokens: 0,
    codexTokens: 0,
    claudeCost: 0,
    codexCost: 0,
    ...p,
  };
}

describe("calendarGrid", () => {
  it("gap-fills missing days and orders ascending, ending at last data day", () => {
    const byDay = [
      day({ date: "2026-06-03", codexTokens: 50 }),
      day({ date: "2026-06-01", claudeTokens: 100 }),
    ];
    const now = Date.parse("2026-06-03T12:00:00.000Z");
    expect(calendarGrid(byDay, now)).toEqual([
      { date: "2026-06-01", claudeTokens: 100, codexTokens: 0, total: 100 },
      { date: "2026-06-02", claudeTokens: 0, codexTokens: 0, total: 0 },
      { date: "2026-06-03", claudeTokens: 0, codexTokens: 50, total: 50 },
    ]);
  });

  it("extends the grid to the UTC date of nowMs when it is past the last data day", () => {
    const byDay = [day({ date: "2026-06-01", claudeTokens: 10 })];
    const now = Date.parse("2026-06-04T00:00:00.000Z");
    const grid = calendarGrid(byDay, now);
    expect(grid.map((d) => d.date)).toEqual([
      "2026-06-01",
      "2026-06-02",
      "2026-06-03",
      "2026-06-04",
    ]);
    expect(grid[0]).toEqual({
      date: "2026-06-01",
      claudeTokens: 10,
      codexTokens: 0,
      total: 10,
    });
  });

  it("returns an empty array for no days", () => {
    expect(calendarGrid([], Date.parse("2026-06-04T00:00:00.000Z"))).toEqual(
      [],
    );
  });
});
