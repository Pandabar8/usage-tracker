// src/lib/parsers/claude.test.ts
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { parseClaudeFile } from "./claude";

const fixture = fileURLToPath(
  new URL("./__fixtures__/claude-sample.jsonl", import.meta.url),
);

describe("parseClaudeFile", () => {
  it("extracts one record per assistant turn with usage, skipping others and malformed lines", () => {
    const { records, quota } = parseClaudeFile(fixture);
    expect(quota).toBeNull();
    expect(records).toHaveLength(2);

    const [a, b] = records;
    expect(a).toMatchObject({
      tool: "claude",
      model: "claude-opus-4-8",
      project: "ProjA",
      sessionId: "s1",
      timestamp: "2026-06-01T10:00:00.000Z",
      inputTokens: 100,
      outputTokens: 50,
      cacheWriteTokens: 200,
      cacheReadTokens: 300,
      reasoningTokens: 0,
    });
    expect(b).toMatchObject({
      model: "claude-sonnet-4-6",
      inputTokens: 10,
      outputTokens: 5,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
    });
  });
});
