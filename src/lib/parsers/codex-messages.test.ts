// src/lib/parsers/codex-messages.test.ts
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { parseCodexMessages, isSyntheticCodexContext } from "./codex-messages";

const fixture = fileURLToPath(
  new URL("./__fixtures__/codex-messages.jsonl", import.meta.url),
);
const multiFixture = fileURLToPath(
  new URL("./__fixtures__/codex-multi-session.jsonl", import.meta.url),
);
const compactionFixture = fileURLToPath(
  new URL("./__fixtures__/codex-compaction.jsonl", import.meta.url),
);
const repeatPromptFixture = fileURLToPath(
  new URL("./__fixtures__/codex-repeat-prompt.jsonl", import.meta.url),
);
const ID_A = "019e39b9-0000-7000-a000-0000000000a1";
const ID_B = "019e2f27-0000-7000-a000-0000000000b2";

describe("parseCodexMessages", () => {
  it("emits user/assistant messages, dedups response_item users, and falls back to agent_message", () => {
    const messages = parseCodexMessages(fixture, "c9");
    expect(messages).toHaveLength(4);

    expect(messages[0]).toMatchObject({
      index: 0,
      role: "user",
      text: "Add a test for the parser.",
      toolUses: [],
    });
    expect(messages[1]).toMatchObject({
      index: 1,
      role: "assistant",
      text: "Added the test.",
      toolUses: ["shell"],
      model: "gpt-5.3-codex",
      tokens: 1234, // last_token_usage.total_tokens
    });
    // Turn 2 user arrives ONLY as a response_item user (no event_msg.user_message).
    expect(messages[2]).toMatchObject({
      index: 2,
      role: "user",
      text: "Now run it.",
    });
    // Turn 2 assistant comes from event_msg.agent_message (no assistant response_item).
    expect(messages[3]).toMatchObject({
      index: 3,
      role: "assistant",
      text: "Tests pass.",
      toolUses: ["shell"],
      model: "gpt-5.3-codex",
    });
    // No token_count in the second turn, so tokens is undefined there.
    expect(messages[3].tokens).toBeUndefined();

    // Dedup: the duplicated response_item user and the developer line are NOT
    // emitted, so there are exactly two user messages (one per real turn).
    expect(messages.filter((m) => m.role === "user")).toHaveLength(2);
    // The turn-1 agent_message duplicates the assistant response_item, so it is
    // NOT double-emitted: exactly two assistant messages overall.
    expect(messages.filter((m) => m.role === "assistant")).toHaveLength(2);
  });

  it("filters synthetic response_item context and never surfaces it as a user prompt", () => {
    const messages = parseCodexMessages(fixture, "c9");
    const allText = messages.map((m) => m.text).join("\n");
    // The AGENTS.md + environment_context payload, the user_instructions payload,
    // and the developer permissions block are all injected context, not prompts.
    expect(allText).not.toContain("AGENTS.md");
    expect(allText).not.toContain("<environment_context>");
    expect(allText).not.toContain("<user_instructions>");
    expect(allText).not.toContain("<permissions instructions>");
    // The REAL user prompts still come through intact.
    expect(
      messages.some(
        (m) => m.role === "user" && m.text === "Add a test for the parser.",
      ),
    ).toBe(true);
    expect(
      messages.some((m) => m.role === "user" && m.text === "Now run it."),
    ).toBe(true);
  });

  it("recognises the synthetic context markers, and passes real prompts through", () => {
    expect(
      isSyntheticCodexContext("# AGENTS.md instructions for /Users/me/ProjX"),
    ).toBe(true);
    expect(
      isSyntheticCodexContext(
        "<environment_context>\n  <cwd>/x</cwd>\n</environment_context>",
      ),
    ).toBe(true);
    expect(
      isSyntheticCodexContext(
        "<user_instructions>\nBe concise.\n</user_instructions>",
      ),
    ).toBe(true);
    expect(isSyntheticCodexContext("<permissions instructions>\n...")).toBe(
      true,
    );
    expect(isSyntheticCodexContext("Add a test for the parser.")).toBe(false);
    expect(isSyntheticCodexContext("Now run it.")).toBe(false);
  });
});

describe("parseCodexMessages user-dedup scope", () => {
  it("keeps a genuinely repeated identical prompt in a LATER turn (dedup is intra-turn only)", () => {
    const messages = parseCodexMessages(repeatPromptFixture, "cr");
    // Two turns, each opening with the SAME prompt text. Both user prompts must
    // survive; only an intra-turn mirror would be deduped.
    expect(messages).toHaveLength(4);
    expect(messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
    expect(messages.filter((m) => m.role === "user")).toHaveLength(2);
    expect(
      messages.filter((m) => m.role === "user" && m.text === "Run the build."),
    ).toHaveLength(2);
    expect(messages[3].text).toBe("Build passed again.");
  });
});

describe("parseCodexMessages Codex compaction", () => {
  it("never surfaces the compacted replacement_history as a prompt", () => {
    const messages = parseCodexMessages(compactionFixture, "cc");
    // Two real user turns + two real assistant turns; the compacted /
    // context_compacted events add nothing.
    expect(messages).toHaveLength(4);
    const allText = messages.map((m) => m.text).join("\n");
    expect(allText).not.toContain("COMPACTED_HISTORY_SHOULD_NOT_SURFACE");
    expect(messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
  });
});

describe("parseCodexMessages across a multi-session rollout", () => {
  it("returns only session A's turns", () => {
    const a = parseCodexMessages(multiFixture, ID_A);
    expect(a).toHaveLength(2);
    expect(a[0]).toMatchObject({
      index: 0,
      role: "user",
      text: "Fix the failing test.",
    });
    expect(a[1]).toMatchObject({
      index: 1,
      role: "assistant",
      text: "Fixed the test.",
      toolUses: ["shell"],
      model: "gpt-5.5",
      tokens: 1000, // session A's last_token_usage.total_tokens
    });
  });

  it("returns only session B's turns, with the agent_message fallback assistant", () => {
    const b = parseCodexMessages(multiFixture, ID_B);
    expect(b).toHaveLength(2);
    expect(b[0]).toMatchObject({
      index: 0,
      role: "user",
      text: "Now add docs.", // arrives only as a response_item user in session B
    });
    expect(b[1]).toMatchObject({
      index: 1,
      role: "assistant",
      text: "Docs added.", // agent_message fallback (no assistant response_item)
      toolUses: ["shell"],
      model: "gpt-5.3-codex",
      tokens: 600, // session B's last_token_usage.total_tokens
    });
  });

  it("never leaks a message from one session into the other", () => {
    const a = parseCodexMessages(multiFixture, ID_A);
    const b = parseCodexMessages(multiFixture, ID_B);
    expect(
      a.some((m) => m.text === "Now add docs." || m.text === "Docs added."),
    ).toBe(false);
    expect(
      b.some(
        (m) =>
          m.text === "Fix the failing test." || m.text === "Fixed the test.",
      ),
    ).toBe(false);
  });
});
