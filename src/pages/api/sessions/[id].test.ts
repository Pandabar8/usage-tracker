// src/pages/api/sessions/[id].test.ts
import { describe, it, expect, vi } from "vitest";
import type { SessionMeta } from "../../../lib/normalize";

// vitest hoists vi.mock above imports; compute fixture paths in vi.hoisted so
// they exist when the factory runs. import.meta.url is available here; do NOT
// call the top-level fileURLToPath inside the factory.
const { claudeFixture, claudeFixture2, codexFixture, badFile } = vi.hoisted(
  () => ({
    claudeFixture: new URL(
      "../../../lib/parsers/__fixtures__/claude-messages.jsonl",
      import.meta.url,
    ).pathname,
    claudeFixture2: new URL(
      "../../../lib/parsers/__fixtures__/claude-messages-2.jsonl",
      import.meta.url,
    ).pathname,
    codexFixture: new URL(
      "../../../lib/parsers/__fixtures__/codex-messages.jsonl",
      import.meta.url,
    ).pathname,
    badFile: "/no/such/file.jsonl",
  }),
);

vi.mock("../../../lib/scan", () => {
  const claudeMeta: SessionMeta = {
    sessionId: "m1",
    tool: "claude",
    turns: 5,
    toolCalls: 2,
    models: ["claude-opus-4-8"],
    startedAt: "2026-06-10T10:00:00.000Z",
    endedAt: "2026-06-10T10:11:00.000Z",
    compaction: { full: 1, micro: 1, tokensSaved: 785000 },
  };
  const codexMeta: SessionMeta = {
    sessionId: "c9",
    tool: "codex",
    turns: 2,
    toolCalls: 2,
    models: ["gpt-5.3-codex"],
    startedAt: "2026-06-11T09:00:00.000Z",
    endedAt: "2026-06-11T09:00:25.000Z",
  };
  const claudeRec = {
    tool: "claude" as const,
    timestamp: "2026-06-10T10:00:00.000Z",
    model: "claude-opus-4-8",
    project: "ProjX",
    sessionId: "m1",
    inputTokens: 100,
    outputTokens: 50,
    cacheWriteTokens: 200,
    cacheReadTokens: 300,
    reasoningTokens: 0,
  };
  const codexRec = {
    tool: "codex" as const,
    timestamp: "2026-06-11T09:00:10.000Z",
    model: "gpt-5.3-codex",
    project: "ProjX",
    sessionId: "c9",
    inputTokens: 800,
    outputTokens: 34,
    cacheWriteTokens: 0,
    cacheReadTokens: 200,
    reasoningTokens: 0,
  };
  return {
    scan: () => ({
      records: [claudeRec, codexRec],
      codexQuota: null,
      // Both maps are keyed by the composite `${tool}:${sessionId}` route key.
      sessionMeta: new Map<string, SessionMeta>([
        ["claude:m1", claudeMeta],
        ["codex:c9", codexMeta],
      ]),
      // claude:m1 spans TWO files that BOTH embed sessionId m1 (a resumed
      // session); codex:c9 is one shared rollout parsed with its raw id;
      // claude:bad points at an unreadable file to drive the corrupt-file 404.
      sessionIndex: new Map([
        [
          "claude:m1",
          {
            files: [claudeFixture, claudeFixture2],
            tool: "claude",
            sessionId: "m1",
          },
        ],
        ["codex:c9", { files: [codexFixture], tool: "codex", sessionId: "c9" }],
        ["claude:bad", { files: [badFile], tool: "claude", sessionId: "bad" }],
      ]),
    }),
  };
});

describe("GET /api/sessions/[id]", () => {
  it("returns 200 for a Codex session, parsing the shared rollout by its raw id and filtering injected context", async () => {
    const { GET } = await import("./[id]");
    const res = await GET({ params: { id: "codex:c9" } } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.id).toBe("c9");
    expect(body.summary.key).toBe("codex:c9");
    expect(body.summary.turns).toBe(2);
    // parseCodexMessages(codexFixture, "c9") yields exactly the real turns.
    expect(body.messages).toHaveLength(4);
    expect(body.messages[0]).toMatchObject({
      index: 0,
      role: "user",
      text: "Add a test for the parser.",
    });
    expect(body.messages[1]).toMatchObject({
      index: 1,
      role: "assistant",
      toolUses: ["shell"],
    });
    // No injected context leaks into the replay.
    const allText = body.messages.map((m: any) => m.text).join("\n");
    expect(allText).not.toContain("AGENTS.md");
    expect(allText).not.toContain("<environment_context>");
    expect(body.messages.every((m: any, i: number) => m.index === i)).toBe(
      true,
    );
  });

  it("parses ALL files of a resumed Claude session and concatenates in timestamp order, re-indexing", async () => {
    const { GET } = await import("./[id]");
    // Both files embed sessionId m1, so real scan() indexes them under claude:m1.
    const res = await GET({ params: { id: "claude:m1" } } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.id).toBe("m1");
    expect(body.summary.key).toBe("claude:m1");
    expect(body.messages).toHaveLength(12);
    // the 10:03:30 line from the second file slots into the middle by timestamp
    expect(body.messages[3]).toMatchObject({
      index: 3,
      role: "user",
      text: "mid extra question",
    });
    // the full-compaction marker shifts down by one after the inserted message
    expect(body.messages[5].compaction).toBe("full");
    // the 10:11:00 line from the second file lands last
    expect(body.messages[11]).toMatchObject({
      index: 11,
      text: "Later reply.",
    });
    expect(body.messages.every((m: any, i: number) => m.index === i)).toBe(
      true,
    );
  });

  it("decodes a percent-encoded composite key from a link (claude%3Am1)", async () => {
    const { GET } = await import("./[id]");
    const res = await GET({ params: { id: "claude%3Am1" } } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.key).toBe("claude:m1");
  });

  it("returns 404 for an unknown session id", async () => {
    const { GET } = await import("./[id]");
    const res = await GET({ params: { id: "missing" } } as any);
    expect(res.status).toBe(404);
  });

  it("returns 404 when a session file is vanished or corrupt", async () => {
    const { GET } = await import("./[id]");
    // "claude:bad" has a valid index entry but its file cannot be read, so the
    // parse failure (not a missing summary) drives the 404.
    const res = await GET({ params: { id: "claude:bad" } } as any);
    expect(res.status).toBe(404);
  });
});
