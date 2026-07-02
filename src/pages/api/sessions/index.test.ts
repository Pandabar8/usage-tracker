// src/pages/api/sessions/index.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionMeta } from "../../../lib/normalize";

// vitest hoists vi.mock above imports, so the factory must not close over any
// top-level runtime consts. Everything the mock returns (the record builder, the
// SessionMeta map, the records) is constructed INSIDE the factory.
vi.mock("../../../lib/scan", () => {
  const rec = (
    sessionId: string,
    tool: "claude" | "codex",
    project: string,
    model: string,
    timestamp: string,
    inputTokens: number,
  ) => ({
    tool,
    timestamp,
    model,
    project,
    sessionId,
    inputTokens,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    reasoningTokens: 0,
  });

  // Keyed by the composite route key `${tool}:${sessionId}`.
  const sessionMeta = new Map<string, SessionMeta>([
    [
      "claude:s1",
      {
        sessionId: "s1",
        tool: "claude",
        turns: 3,
        toolCalls: 1,
        models: ["claude-opus-4-8"],
        startedAt: "2026-06-01T23:00:00.000Z",
        endedAt: "2026-06-02T01:00:00.000Z",
        compaction: { full: 1, micro: 0, tokensSaved: 999 },
      },
    ],
    [
      "codex:c1",
      {
        sessionId: "c1",
        tool: "codex",
        turns: 2,
        toolCalls: 0,
        models: ["gpt-5.3-codex"],
        startedAt: "2026-06-02T10:00:00.000Z",
        endedAt: "2026-06-02T10:05:00.000Z",
      },
    ],
  ]);

  return {
    scan: () => ({
      // s1 straddles 06-01 and 06-02 (1000 tokens total across the two days).
      records: [
        rec(
          "s1",
          "claude",
          "ProjA",
          "claude-opus-4-8",
          "2026-06-01T23:00:00.000Z",
          100,
        ),
        rec(
          "s1",
          "claude",
          "ProjA",
          "claude-opus-4-8",
          "2026-06-02T01:00:00.000Z",
          900,
        ),
        // c1 lives entirely on 06-02.
        rec(
          "c1",
          "codex",
          "ProjB",
          "gpt-5.3-codex",
          "2026-06-02T10:00:00.000Z",
          200,
        ),
      ],
      codexQuota: null,
      sessionMeta,
      sessionIndex: new Map(),
    }),
  };
});

beforeEach(() => vi.clearAllMocks());

describe("GET /api/sessions", () => {
  it("returns whole-session summaries as JSON sorted by most recent start", async () => {
    const { GET } = await import("./index");
    const res = await GET({
      url: new URL("http://localhost/api/sessions"),
    } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(body.map((s: any) => s.id)).toEqual(["c1", "s1"]);
    const s1 = body.find((s: any) => s.id === "s1");
    expect(s1.key).toBe("claude:s1");
    expect(s1.turns).toBe(3);
    expect(s1.totalTokens).toBe(1000); // both s1 records, whole session
    expect(s1.compaction).toEqual({ full: 1, micro: 0, tokensSaved: 999 });
  });

  it("honours the tool filter", async () => {
    const { GET } = await import("./index");
    const res = await GET({
      url: new URL("http://localhost/api/sessions?tool=claude"),
    } as any);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe("s1");
  });

  it("includes a session that only partially overlaps the date window WHOLE, and excludes one fully outside", async () => {
    const { GET } = await import("./index");
    const res = await GET({
      url: new URL(
        "http://localhost/api/sessions?from=2026-06-01&to=2026-06-01",
      ),
    } as any);
    const body = await res.json();
    // s1 started on 06-01 (overlaps the window) -> included; c1 is entirely on
    // 06-02 (starts after the window) -> excluded.
    expect(body.map((s: any) => s.id)).toEqual(["s1"]);
    const s1 = body.find((s: any) => s.id === "s1");
    // WHOLE-session totals: the 06-02 record is NOT truncated away by the 06-01
    // window (a truncated total would be 100, not 1000).
    expect(s1.totalTokens).toBe(1000);
    expect(s1.tokens.input).toBe(1000);
    // meta stays unfiltered and internally consistent with the token totals.
    expect(s1.turns).toBe(3);
  });
});
