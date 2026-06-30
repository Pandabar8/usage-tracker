// src/pages/api/usage.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/scan", () => ({
  scan: () => ({
    records: [
      {
        tool: "claude",
        timestamp: "2026-06-01T10:00:00.000Z",
        model: "claude-opus-4-8",
        project: "ProjA",
        sessionId: "s",
        inputTokens: 100,
        outputTokens: 50,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
        reasoningTokens: 0,
      },
      {
        tool: "codex",
        timestamp: "2026-06-02T10:00:00.000Z",
        model: "gpt-5.3-codex",
        project: "ProjB",
        sessionId: "c",
        inputTokens: 200,
        outputTokens: 20,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
        reasoningTokens: 0,
      },
    ],
    codexQuota: {
      timestamp: "2026-06-02T10:00:00.000Z",
      primary: { usedPercent: 15, windowMinutes: 300, resetsAt: 1 },
      secondary: null,
    },
  }),
}));

beforeEach(() => vi.clearAllMocks());

describe("GET /api/usage", () => {
  it("returns aggregated rollups as JSON", async () => {
    const { GET } = await import("./usage");
    const res = await GET({
      url: new URL("http://localhost/api/usage"),
    } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totals.combined.tokens).toBe(370); // 150 + 220
    expect(body.codexQuota.primary.usedPercent).toBe(15);
  });

  it("honours the tool filter", async () => {
    const { GET } = await import("./usage");
    const res = await GET({
      url: new URL("http://localhost/api/usage?tool=claude"),
    } as any);
    const body = await res.json();
    expect(body.totals.combined.tokens).toBe(150);
  });

  it("computes claudeWindows from unfiltered records even under a tool=codex filter", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T12:00:00.000Z"));
    try {
      const { GET } = await import("./usage");
      const res = await GET({
        url: new URL("http://localhost/api/usage?tool=codex"),
      } as any);
      const body = await res.json();
      // The claude record (2026-06-01T10:00, 150 tok) is 2h old -> in both windows;
      // codex is excluded from the windows. tool=codex filter must NOT zero them.
      expect(body.claudeWindows.fiveHourTokens).toBe(150);
      expect(body.claudeWindows.sevenDayTokens).toBe(150);
      // The filter DID apply to the rollups, proving the windows used the unfiltered set.
      expect(body.totals.claude.tokens).toBe(0);
      expect(body.totals.codex.tokens).toBe(220);
    } finally {
      vi.useRealTimers();
    }
  });
});
