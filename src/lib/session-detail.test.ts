// src/lib/session-detail.test.ts
import { describe, it, expect, vi } from "vitest";
import type { SessionMeta } from "./normalize";

// Compute fixture paths in vi.hoisted so they exist when the hoisted vi.mock
// factory runs.
const { codexFixture, badFile } = vi.hoisted(() => ({
  codexFixture: new URL(
    "./parsers/__fixtures__/codex-messages.jsonl",
    import.meta.url,
  ).pathname,
  badFile: "/no/such/file.jsonl",
}));

vi.mock("./scan", () => {
  const codexMeta: SessionMeta = {
    sessionId: "c9",
    tool: "codex",
    turns: 2,
    toolCalls: 2,
    models: ["gpt-5.3-codex"],
    startedAt: "2026-06-11T09:00:00.000Z",
    endedAt: "2026-06-11T09:00:25.000Z",
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
      records: [codexRec],
      codexQuota: null,
      sessionMeta: new Map<string, SessionMeta>([["codex:c9", codexMeta]]),
      sessionIndex: new Map([
        ["codex:c9", { files: [codexFixture], tool: "codex", sessionId: "c9" }],
        ["claude:bad", { files: [badFile], tool: "claude", sessionId: "bad" }],
      ]),
    }),
  };
});

describe("loadSessionDetail", () => {
  it("resolves a composite key into a summary + timestamp-ordered, re-indexed messages", async () => {
    const { loadSessionDetail } = await import("./session-detail");
    const detail = loadSessionDetail("codex:c9")!;
    expect(detail).not.toBeNull();
    expect(detail.summary.key).toBe("codex:c9");
    expect(detail.summary.id).toBe("c9");
    expect(detail.messages).toHaveLength(4);
    expect(detail.messages.every((m, i) => m.index === i)).toBe(true);
    const allText = detail.messages.map((m) => m.text).join("\n");
    expect(allText).not.toContain("AGENTS.md");
  });

  it("returns null for an unknown key", async () => {
    const { loadSessionDetail } = await import("./session-detail");
    expect(loadSessionDetail("missing")).toBeNull();
  });

  it("returns null when a file cannot be read", async () => {
    const { loadSessionDetail } = await import("./session-detail");
    expect(loadSessionDetail("claude:bad")).toBeNull();
  });
});
