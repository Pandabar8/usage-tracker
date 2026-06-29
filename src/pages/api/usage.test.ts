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
});
