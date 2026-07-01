// src/lib/settings.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  effectiveRetentionDays,
  getRetention,
  isRetentionRisky,
  raiseRetention,
  type RetentionInfo,
} from "./settings";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "ut-settings-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("getRetention", () => {
  it("reads cleanupPeriodDays from settings.json", () => {
    const p = join(dir, "with-value.json");
    writeFileSync(p, JSON.stringify({ theme: "dark", cleanupPeriodDays: 30 }));
    const info = getRetention(p);
    expect(info.cleanupPeriodDays).toBe(30);
    expect(info.exists).toBe(true);
  });

  it("returns null cleanup when the key is absent", () => {
    const p = join(dir, "no-key.json");
    writeFileSync(p, JSON.stringify({ theme: "dark" }));
    const info = getRetention(p);
    expect(info.cleanupPeriodDays).toBeNull();
    expect(info.exists).toBe(true);
  });

  it("reports exists:false for a missing file", () => {
    const info = getRetention(join(dir, "does-not-exist.json"));
    expect(info.exists).toBe(false);
    expect(info.cleanupPeriodDays).toBeNull();
  });
});

describe("retention risk", () => {
  it("treats an absent key as the 30-day default and flags it risky", () => {
    const info: RetentionInfo = {
      cleanupPeriodDays: null,
      exists: true,
      path: "x",
    };
    expect(effectiveRetentionDays(info)).toBe(30);
    expect(isRetentionRisky(info)).toBe(true);
  });

  it("is not risky when retention is long", () => {
    const info: RetentionInfo = {
      cleanupPeriodDays: 365,
      exists: true,
      path: "x",
    };
    expect(effectiveRetentionDays(info)).toBe(365);
    expect(isRetentionRisky(info)).toBe(false);
  });
});

describe("raiseRetention", () => {
  it("raises a short retention and preserves other keys", () => {
    const { next, changed } = raiseRetention(
      { theme: "dark", cleanupPeriodDays: 30 },
      3650,
    );
    expect(changed).toBe(true);
    expect(next).toEqual({ theme: "dark", cleanupPeriodDays: 3650 });
  });

  it("is idempotent when retention already meets the target", () => {
    const input = { theme: "dark", cleanupPeriodDays: 3650 };
    const { next, changed } = raiseRetention(input, 3650);
    expect(changed).toBe(false);
    expect(next).toBe(input);
  });

  it("adds the key when missing without dropping unknown keys", () => {
    const { next, changed } = raiseRetention({ apiKeyHelper: "x" }, 3650);
    expect(changed).toBe(true);
    expect(next).toEqual({ apiKeyHelper: "x", cleanupPeriodDays: 3650 });
  });
});
