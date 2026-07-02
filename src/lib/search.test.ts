// src/lib/search.test.ts
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { snippet, searchMessages } from "./search";
import { parseClaudeMessages } from "./parsers/claude-messages";
import { parseCodexMessages } from "./parsers/codex-messages";

const claudeFixture = fileURLToPath(
  new URL("./parsers/__fixtures__/claude-messages.jsonl", import.meta.url),
);
const codexFixture = fileURLToPath(
  new URL("./parsers/__fixtures__/codex-messages.jsonl", import.meta.url),
);

describe("snippet", () => {
  it("returns the whole text (no ellipses) when it fits the window", () => {
    expect(snippet("The quick brown fox", "quick")).toBe("The quick brown fox");
  });

  it("returns an empty string when the query is absent", () => {
    expect(snippet("abc", "xyz")).toBe("");
    expect(snippet("abc", "")).toBe("");
  });

  it("clips around the first match with leading/trailing ellipses, case-insensitively", () => {
    const text = "x".repeat(100) + "NEEDLE" + "y".repeat(100);
    expect(snippet(text, "needle", 10)).toBe("…xxxxxxxxxxNEEDLEyyyyyyyyyy…");
  });
});

describe("searchMessages", () => {
  it("counts every matching Claude message and snippets the first hit", () => {
    const messages = parseClaudeMessages(claudeFixture);
    const hit = searchMessages(messages, "compaction");
    expect(hit).not.toBeNull();
    // Enlarged Phase 2 claude fixture (10 messages): matches messages[5]
    // "Continuing after compaction." and messages[7] (long prompt mentions
    // "compaction counts"). messages[4] says "compacted" (no "compaction"
    // substring); messages[6] micro marker has empty text.
    expect(hit!.matchCount).toBe(2);
    expect(hit!.snippet.toLowerCase()).toContain("compaction");
  });

  it("matches a Codex user message case-insensitively", () => {
    const messages = parseCodexMessages(codexFixture, "c9");
    const hit = searchMessages(messages, "run it");
    expect(hit).not.toBeNull();
    // Enlarged Phase 2 codex fixture (4 messages): only messages[2] "Now run it."
    expect(hit!.matchCount).toBe(1);
    expect(hit!.snippet).toContain("Now run it.");
  });

  it("returns null when nothing matches or the query is blank", () => {
    const messages = parseClaudeMessages(claudeFixture);
    expect(searchMessages(messages, "ZZZ-NO-MATCH")).toBeNull();
    expect(searchMessages(messages, "   ")).toBeNull();
  });
});
