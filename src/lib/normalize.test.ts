// src/lib/normalize.test.ts
import { describe, it, expect } from "vitest";
import { projectFromCwd, totalTokens, type UsageRecord } from "./normalize";

describe("projectFromCwd", () => {
  it("returns the basename of a path", () => {
    expect(projectFromCwd("/Users/me/FinApp")).toBe("FinApp");
  });
  it("handles a trailing slash", () => {
    expect(projectFromCwd("/Users/me/FinApp/")).toBe("FinApp");
  });
  it("falls back for empty/missing input", () => {
    expect(projectFromCwd("")).toBe("(unknown)");
    expect(projectFromCwd(undefined)).toBe("(unknown)");
    expect(projectFromCwd("/")).toBe("(unknown)");
  });
});

describe("totalTokens", () => {
  it("sums fresh input, output, cache write, and cache read (not reasoning)", () => {
    const r: UsageRecord = {
      tool: "codex",
      timestamp: "t",
      model: "m",
      project: "p",
      sessionId: "s",
      inputTokens: 200,
      outputTokens: 100,
      cacheWriteTokens: 0,
      cacheReadTokens: 800,
      reasoningTokens: 40,
    };
    expect(totalTokens(r)).toBe(1100);
  });
});
