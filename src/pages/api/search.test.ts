// src/pages/api/search.test.ts
import { describe, it, expect, vi } from "vitest";
import type { SessionMeta } from "../../lib/normalize";

// vitest hoists vi.mock above the imports, so the factory cannot read
// module-scope consts. Fixture paths are computed in vi.hoisted (import.meta.url
// IS available there) and the rec builder / SessionMeta map / sessionIndex are
// all constructed INSIDE the factory. Each sessionIndex value uses the NEW
// Phase 2 shape `{ files: string[]; tool }` — a list of files per session id.
const { claudeFixture, codexFixture } = vi.hoisted(() => ({
  claudeFixture: new URL(
    "../../lib/parsers/__fixtures__/claude-messages.jsonl",
    import.meta.url,
  ).pathname,
  codexFixture: new URL(
    "../../lib/parsers/__fixtures__/codex-messages.jsonl",
    import.meta.url,
  ).pathname,
}));

vi.mock("../../lib/scan", () => {
  const rec = (over: Record<string, unknown>) => ({
    tool: "claude",
    timestamp: "2026-06-10T10:00:00.000Z",
    model: "claude-opus-4-8",
    project: "ProjX",
    sessionId: "m1",
    inputTokens: 1,
    outputTokens: 1,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    reasoningTokens: 0,
    ...over,
  });
  return {
    scan: () => ({
      records: [
        rec({
          sessionId: "m1",
          project: "ProjX",
          timestamp: "2026-06-10T10:00:00.000Z",
        }),
        rec({
          tool: "codex",
          model: "gpt-5.3-codex",
          sessionId: "c9",
          project: "ProjB",
          timestamp: "2026-06-11T09:00:00.000Z",
        }),
        rec({
          sessionId: "bad",
          project: "ProjBad",
          timestamp: "2026-06-09T10:00:00.000Z",
        }),
      ],
      codexQuota: null,
      sessionMeta: new Map<string, SessionMeta>([
        [
          "claude:m1",
          {
            sessionId: "m1",
            tool: "claude",
            turns: 3,
            toolCalls: 1,
            models: ["claude-opus-4-8"],
            startedAt: "2026-06-10T10:00:00.000Z",
            endedAt: "2026-06-10T10:07:00.000Z",
          },
        ],
        [
          "codex:c9",
          {
            sessionId: "c9",
            tool: "codex",
            turns: 2,
            toolCalls: 2,
            models: ["gpt-5.3-codex"],
            startedAt: "2026-06-11T09:00:00.000Z",
            endedAt: "2026-06-11T09:00:25.000Z",
          },
        ],
        [
          "claude:bad",
          {
            sessionId: "bad",
            tool: "claude",
            turns: 1,
            toolCalls: 0,
            models: ["claude-opus-4-8"],
            startedAt: "2026-06-09T10:00:00.000Z",
            endedAt: "2026-06-09T10:00:00.000Z",
          },
        ],
      ]),
      sessionIndex: new Map([
        [
          "claude:m1",
          { files: [claudeFixture], tool: "claude", sessionId: "m1" },
        ],
        ["codex:c9", { files: [codexFixture], tool: "codex", sessionId: "c9" }],
        [
          "claude:bad",
          { files: ["/no/such/file.jsonl"], tool: "claude", sessionId: "bad" },
        ],
      ]),
    }),
  };
});

describe("GET /api/search", () => {
  it("returns only sessions whose messages match, with count + snippet", async () => {
    const { GET } = await import("./search");
    const res = await GET({
      url: new URL("http://localhost/api/search?q=compaction"),
    } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe("m1");
    expect(body[0].tool).toBe("claude");
    // Enlarged Phase 2 claude fixture: "compaction" hits messages[5]
    // "Continuing after compaction." and messages[7] (the long prompt mentions
    // "compaction counts"). messages[4] says "compacted" (no "compaction"
    // substring) and the micro marker messages[6] has empty text.
    expect(body[0].matchCount).toBe(2);
    expect(body[0].snippet.toLowerCase()).toContain("compaction");
  });

  it("matches Codex sessions and skips the unreadable file without failing", async () => {
    const { GET } = await import("./search");
    const res = await GET({
      url: new URL("http://localhost/api/search?q=run%20it"),
    } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    // Enlarged Phase 2 codex fixture: "run it" hits only c9 (messages[2]
    // "Now run it."); the "bad" session's single file in files[] threw on parse
    // and was skipped, leaving c9 as the only result.
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe("c9");
    expect(body[0].tool).toBe("codex");
  });

  it("returns an empty array for a blank query", async () => {
    const { GET } = await import("./search");
    const res = await GET({
      url: new URL("http://localhost/api/search?q="),
    } as any);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});
