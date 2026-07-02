// src/pages/api/search.caps.test.ts
// Cap-enforcement: proves SCAN_CAP / RESULT_CAP / FILE_CAP actually bound the
// work by spying on the message parsers and driving small overridable bounds.
// The mocked scan returns one codex session with THREE files first (freshest),
// then ten single-file claude sessions, so the file cap can be shown to break
// MID-session (bounding sessions alone would not be enough for a multi-file id).
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../lib/parsers/claude-messages", () => ({
  parseClaudeMessages: vi.fn(() => [
    {
      index: 0,
      role: "assistant",
      text: "MATCH_TOKEN in a claude message",
      toolUses: [],
      timestamp: "2026-01-01T00:00:00.000Z",
    },
  ]),
}));

vi.mock("../../lib/parsers/codex-messages", () => ({
  parseCodexMessages: vi.fn(() => [
    {
      index: 0,
      role: "assistant",
      text: "MATCH_TOKEN in a codex message",
      toolUses: [],
      timestamp: "2026-01-01T00:00:00.000Z",
    },
  ]),
}));

vi.mock("../../lib/scan", () => {
  const records: any[] = [];
  const sessionIndex = new Map<string, any>();

  // Freshest session: a codex id spanning THREE files (e.g. a shared rollout).
  records.push({
    tool: "codex",
    timestamp: "2026-06-30T10:00:00.000Z",
    model: "gpt-5.3-codex",
    project: "ProjMulti",
    sessionId: "multi",
    inputTokens: 1,
    outputTokens: 1,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    reasoningTokens: 0,
  });
  sessionIndex.set("codex:multi", {
    files: ["/f/multi-1.jsonl", "/f/multi-2.jsonl", "/f/multi-3.jsonl"],
    tool: "codex",
    sessionId: "multi",
  });

  // Then ten single-file claude sessions, strictly older (descending) so the
  // groupSessions order is deterministic: multi, s0, s1, ... s9.
  for (let i = 0; i < 10; i++) {
    const day = 29 - i; // 29..20, all before 30
    records.push({
      tool: "claude",
      timestamp: `2026-06-${day}T10:00:00.000Z`,
      model: "claude-opus-4-8",
      project: `Proj${i}`,
      sessionId: `s${i}`,
      inputTokens: 1,
      outputTokens: 1,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      reasoningTokens: 0,
    });
    sessionIndex.set(`claude:s${i}`, {
      files: [`/f/s${i}.jsonl`],
      tool: "claude",
      sessionId: `s${i}`,
    });
  }

  return {
    scan: () => ({
      records,
      codexQuota: null,
      sessionMeta: new Map(),
      sessionIndex,
    }),
  };
});

import { searchSessions, DEFAULT_SEARCH_CAPS } from "./search";
import { parseClaudeMessages } from "../../lib/parsers/claude-messages";
import { parseCodexMessages } from "../../lib/parsers/codex-messages";

const claudeFiles = () =>
  vi.mocked(parseClaudeMessages).mock.calls.map((c) => c[0]);
const codexFiles = () =>
  vi.mocked(parseCodexMessages).mock.calls.map((c) => c[0]);

describe("search cap enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks(); // reset call history; keep the mocked implementations
  });

  it("exposes the production defaults as an overridable cap set", () => {
    expect(DEFAULT_SEARCH_CAPS).toEqual({
      scanCap: 500,
      resultCap: 50,
      fileCap: 4000,
    });
  });

  it("stops after scanCap sessions (parser never touches beyond-cap sessions)", () => {
    const results = searchSessions("MATCH_TOKEN", {
      scanCap: 3,
      resultCap: 999,
      fileCap: 999,
    });
    // multi + s0 + s1 = 3 sessions visited, all match.
    expect(results).toHaveLength(3);
    expect(parseCodexMessages).toHaveBeenCalledTimes(3); // multi's 3 files
    expect(parseClaudeMessages).toHaveBeenCalledTimes(2); // s0, s1
    // s2 is the 4th session — beyond scanCap — so its file is never parsed.
    expect(claudeFiles()).not.toContain("/f/s2.jsonl");
  });

  it("stops once resultCap matches are collected", () => {
    const results = searchSessions("MATCH_TOKEN", {
      scanCap: 999,
      resultCap: 2,
      fileCap: 999,
    });
    // multi (result 1) + s0 (result 2); the loop breaks before s1.
    expect(results).toHaveLength(2);
    expect(parseCodexMessages).toHaveBeenCalledTimes(3); // multi's 3 files
    expect(parseClaudeMessages).toHaveBeenCalledTimes(1); // s0 only
    expect(claudeFiles()).not.toContain("/f/s1.jsonl");
  });

  it("stops at fileCap total files, breaking mid multi-file session", () => {
    const results = searchSessions("MATCH_TOKEN", {
      scanCap: 999,
      resultCap: 999,
      fileCap: 2,
    });
    // Only multi is (partially) parsed: files 1 and 2, then the file cap binds
    // BEFORE its 3rd file and before any claude session is reached.
    expect(results).toHaveLength(1);
    expect(parseCodexMessages).toHaveBeenCalledTimes(2); // multi-1, multi-2
    expect(codexFiles()).not.toContain("/f/multi-3.jsonl"); // mid-session break
    expect(parseClaudeMessages).toHaveBeenCalledTimes(0); // s0 never reached
  });
});
