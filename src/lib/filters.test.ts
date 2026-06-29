// src/lib/filters.test.ts
import { describe, it, expect } from "vitest";
import { applyFilters } from "./filters";
import type { UsageRecord } from "./normalize";

function rec(p: Partial<UsageRecord>): UsageRecord {
  return {
    tool: "claude",
    timestamp: "2026-06-01T10:00:00.000Z",
    model: "m",
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

const records = [
  rec({ tool: "claude", timestamp: "2026-06-01T10:00:00.000Z" }),
  rec({ tool: "codex", timestamp: "2026-06-03T10:00:00.000Z" }),
];

describe("applyFilters", () => {
  it("returns all records when no params", () => {
    expect(applyFilters(records, new URLSearchParams())).toHaveLength(2);
  });
  it("filters by tool", () => {
    const out = applyFilters(records, new URLSearchParams({ tool: "codex" }));
    expect(out).toHaveLength(1);
    expect(out[0].tool).toBe("codex");
  });
  it("filters by from/to date range (inclusive)", () => {
    const out = applyFilters(
      records,
      new URLSearchParams({ from: "2026-06-02", to: "2026-06-04" }),
    );
    expect(out).toHaveLength(1);
    expect(out[0].tool).toBe("codex");
  });
});
