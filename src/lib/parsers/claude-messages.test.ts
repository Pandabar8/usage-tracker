// src/lib/parsers/claude-messages.test.ts
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import {
  parseClaudeMessages,
  detectClaudeCompaction,
  claudeCompactionSaved,
} from "./claude-messages";

const fixture = fileURLToPath(
  new URL("./__fixtures__/claude-messages.jsonl", import.meta.url),
);
const splitUsageFixture = fileURLToPath(
  new URL("./__fixtures__/claude-split-usage.jsonl", import.meta.url),
);

describe("parseClaudeMessages", () => {
  it("merges the split message.id turn (thinking/text/tool_use) into ONE assistant message with tokens counted once", () => {
    const messages = parseClaudeMessages(fixture);
    // The three msg_a1 lines collapse to a single message, not three; the ten
    // messages total prove there is no split-line inflation.
    expect(messages).toHaveLength(10);
    const a1 = messages[0];
    expect(a1.role).toBe("assistant");
    expect(a1.text).toBe("Let me check."); // text block from the middle split line
    expect(a1.toolUses).toEqual(["Bash"]); // tool_use block from the third split line
    expect(a1.model).toBe("claude-opus-4-8");
    expect(a1.tokens).toBe(650); // 100 + 50 + 200 + 300 counted ONCE, not ×3
    // Only ONE assistant message carries the Bash tool_use from msg_a1.
    expect(
      messages.filter(
        (m) => m.role === "assistant" && m.text === "Let me check.",
      ),
    ).toHaveLength(1);
  });

  it("emits user/assistant messages, extracts tool_use, and skips tool_result-only users", () => {
    const messages = parseClaudeMessages(fixture);
    expect(messages).toHaveLength(10);

    expect(messages[0]).toMatchObject({
      index: 0,
      role: "assistant",
      text: "Let me check.",
      toolUses: ["Bash"],
      model: "claude-opus-4-8",
      tokens: 650, // 100 + 50 + 200 + 300, counted once across the split lines
    });
    expect(messages[1]).toMatchObject({
      index: 1,
      role: "user",
      text: "run the tests",
      toolUses: [],
    });
    expect(messages[2]).toMatchObject({
      index: 2,
      role: "assistant",
      text: "Running now.",
      toolUses: ["Bash"],
      tokens: 30, // 20 + 10
    });
    expect(messages[3]).toMatchObject({
      index: 3,
      role: "assistant",
      text: "All tests pass.",
      toolUses: [],
      tokens: 23, // 15 + 8
    });
  });

  it("emits full and micro compaction markers inline in order", () => {
    const messages = parseClaudeMessages(fixture);
    expect(messages[4]).toMatchObject({
      index: 4,
      compaction: "full",
      text: "Conversation compacted.",
    });
    expect(messages[5]).toMatchObject({
      index: 5,
      text: "Continuing after compaction.",
    });
    expect(messages[6]).toMatchObject({ index: 6, compaction: "micro" });
  });

  it("keeps the full untruncated text in the payload", () => {
    const messages = parseClaudeMessages(fixture);
    const long = messages[7];
    expect(long.role).toBe("user");
    expect(long.text.endsWith("END_OF_LONG_PROMPT")).toBe(true);
    expect(long.text.length).toBeGreaterThan(300);
  });

  it("emits the final short user/assistant exchange", () => {
    const messages = parseClaudeMessages(fixture);
    expect(messages[8]).toMatchObject({
      index: 8,
      role: "user",
      text: "thanks",
    });
    expect(messages[9]).toMatchObject({
      index: 9,
      role: "assistant",
      text: "You're welcome.",
      tokens: 8, // 5 + 3
    });
  });
});

describe("parseClaudeMessages split-usage last-wins", () => {
  it("merges a split turn whose usage GROWS across lines using the FINAL complete usage, counted once", () => {
    const messages = parseClaudeMessages(splitUsageFixture);
    // The three msg_g lines (thinking / text / tool_use) collapse to ONE message.
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      role: "assistant",
      text: "Partial reply.",
      toolUses: ["Bash"],
      // FINAL line usage 10 + 20 + 30 + 40 = 100, not the intermediate 35 or a sum.
      tokens: 100,
    });
  });
});

describe("detectClaudeCompaction / claudeCompactionSaved", () => {
  it("detects full compaction and derives saved tokens from pre/post", () => {
    const obj = { compactMetadata: { preTokens: 800000, postTokens: 20000 } };
    expect(detectClaudeCompaction(obj)).toBe("full");
    expect(claudeCompactionSaved(obj)).toBe(780000);
  });
  it("detects micro compaction and reads its explicit tokensSaved", () => {
    const obj = { microcompactMetadata: { tokensSaved: 5000 } };
    expect(detectClaudeCompaction(obj)).toBe("micro");
    expect(claudeCompactionSaved(obj)).toBe(5000);
  });
  it("returns null / 0 for a normal line", () => {
    expect(detectClaudeCompaction({ type: "assistant" })).toBeNull();
    expect(claudeCompactionSaved({ type: "assistant" })).toBe(0);
  });
});
