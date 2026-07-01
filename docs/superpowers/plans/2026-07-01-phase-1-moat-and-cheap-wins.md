---
# Phase 1 — Moat + Cheap Wins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deepen the quota-correctness moat by adding burn-rate quota forecasting, a deterministic quota-aware tips engine, and Claude retention protection, surfaced on the existing dashboard without touching the aggregate hot path.

**Architecture:** Three new pure `lib` modules (`forecast.ts`, `tips.ts`, `settings.ts`) computed server-side from the same `scan()` records the Overview already uses, plus one local `scripts/fix-retention.mjs` write tool. Forecast and tips are computed from the **unfiltered** record set in both the SSR entry (`index.astro`) and `/api/usage`, merged into the dashboard payload as `DashboardData = Rollups & { forecast, tips }`, then rendered by a new forecast line in `QuotaPanel`, a new `Tips` island, and a new `RetentionBanner` island fed by read-only settings primitives.

**Tech Stack:** TypeScript · Astro 5 (SSR, `@astrojs/node` standalone) · React 19 islands · Tailwind v4 · Vitest 3 · Node ESM.

## Global Constraints
- Local-only, read-only, no-upload: no network calls, no npm publish, no public README; the only write anywhere is the explicit `fix-retention` command against `~/.claude/settings.json`.
- Claude + Codex only; no OpenCode source, no third provider.
- Notional (API-rate) cost labeling on every new surface; Claude "no server-side limit" framing preserved.
- Quota and forecast are computed from **UNFILTERED** records regardless of the active tool/date filter (matches the existing `claudeWindows`/`codexQuota` invariant).
- Canonical-pinned tests assert against numeric/string literals, never against the module's own formula recomputed in the test.
- New fixtures mirror real data shape (hundreds-of-lines files, not single-record stubs); Phase 1 adds no parser fixtures, so its lib tests use synthetic `UsageRecord[]` builders consistent with the existing `aggregate.test.ts`/`pricing.test.ts` `rec()` pattern.
- Node/Astro SSR stack; ESM, TypeScript, Vitest, Astro routes, React islands, Tailwind v4 conventions matched exactly.
---

## File Structure

**Created**

- `src/lib/forecast.ts` — pure Codex linear-projection + Claude volume-projection forecaster over unfiltered records/quota.
- `src/lib/forecast.test.ts` — canonical-pinned tests for Codex projection, `willExhaust`/`etaToLimit`, divide-by-zero nulls, Claude volume.
- `src/lib/tips.ts` — deterministic advisory rules (`approaching-limit`, `right-size-model`, `low-cache`, `unpriced-present`) over records + forecast.
- `src/lib/tips.test.ts` — canonical-pinned per-rule fire/no-fire tests with pinned `savingsUsd`.
- `src/lib/settings.ts` — read-only `getRetention()` + pure `raiseRetention()` transform + retention-risk helpers.
- `src/lib/settings.test.ts` — retention read tests + read-modify-write key-preservation/idempotency tests.
- `scripts/fix-retention.mjs` — safe read-modify-write of `~/.claude/settings.json` `cleanupPeriodDays` (preserves keys, idempotent, aborts on parse error).
- `src/components/Tips.tsx` — React island rendering `Tip[]` as cards on the Overview.
- `src/components/RetentionBanner.tsx` — React island warning banner fed by retention primitives.

**Modified**

- `src/lib/normalize.ts` — add `WindowForecast`, `VolumeForecast`, `Forecast`, `Tip` types.
- `src/lib/aggregate.ts` — add `DashboardData` payload type (no runtime change).
- `src/pages/index.astro` — compute forecast/tips/retention from unfiltered records, pass to `Dashboard`.
- `src/pages/api/usage.ts` — compute forecast/tips from unfiltered records, include in JSON payload.
- `src/components/Dashboard.tsx` — accept `DashboardData` + `retention` prop; render `RetentionBanner` and `Tips`.
- `src/components/QuotaPanel.tsx` — add Codex forecast line and Claude volume-projection line.
- `package.json` — add `fix-retention` script.

---

### Task 1: Quota forecasting module (`forecast.ts`)

**Files:**

- Create: `src/lib/forecast.ts`
- Modify: `src/lib/normalize.ts` (append forecast types after `totalTokens`, ends at line 52)
- Test: `src/lib/forecast.test.ts`

**Interfaces:**

- Consumes: `UsageRecord` (`src/lib/normalize.ts` lines 4-15), `RateLimitWindow` (`{ usedPercent: number; windowMinutes: number; resetsAt: number }`, lines 17-21), `RateLimitSnapshot` (`{ timestamp: string; primary: RateLimitWindow | null; secondary: RateLimitWindow | null }`, lines 23-27), `totalTokens(r: UsageRecord): number` (lines 48-52). Note `resetsAt` is UNIX **seconds** (QuotaPanel multiplies by 1000).
- Produces:
  - `WindowForecast = { willExhaust: boolean; projectedPercentAtReset: number | null; etaToLimit: string | null }`
  - `VolumeForecast = { projectedTokens: number | null; note: string }`
  - `Forecast = { codexPrimary?: WindowForecast; codexSecondary?: WindowForecast; claudeFiveHour?: VolumeForecast; claudeSevenDay?: VolumeForecast }`
  - `buildForecast(records: UsageRecord[], codexQuota: RateLimitSnapshot | null, nowMs: number): Forecast`

Steps:

- [ ] Create `src/lib/forecast.test.ts` with this exact content:

```ts
// src/lib/forecast.test.ts
import { describe, it, expect } from "vitest";
import { buildForecast } from "./forecast";
import type { RateLimitSnapshot, UsageRecord } from "./normalize";

function rec(p: Partial<UsageRecord>): UsageRecord {
  return {
    tool: "claude",
    timestamp: "2026-06-29T10:00:00.000Z",
    model: "claude-opus-4-8",
    project: "p",
    sessionId: "s",
    inputTokens: 0,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    reasoningTokens: 0,
    ...p,
  };
}

const NOW = Date.parse("2026-06-29T12:00:00.000Z");

describe("buildForecast codex", () => {
  it("projects end-of-window percent linearly from elapsed fraction", () => {
    const quota: RateLimitSnapshot = {
      timestamp: "2026-06-29T12:00:00.000Z",
      primary: {
        usedPercent: 40,
        windowMinutes: 300,
        resetsAt: Date.parse("2026-06-29T14:30:00.000Z") / 1000,
      },
      secondary: {
        usedPercent: 60,
        windowMinutes: 300,
        resetsAt: Date.parse("2026-06-29T14:30:00.000Z") / 1000,
      },
    };
    const f = buildForecast([], quota, NOW);
    expect(f.codexPrimary?.projectedPercentAtReset).toBeCloseTo(80, 10);
    expect(f.codexPrimary?.willExhaust).toBe(false);
    expect(f.codexPrimary?.etaToLimit).toBeNull();
    expect(f.codexSecondary?.projectedPercentAtReset).toBeCloseTo(120, 10);
    expect(f.codexSecondary?.willExhaust).toBe(true);
    expect(f.codexSecondary?.etaToLimit).toBe("2026-06-29T13:40:00.000Z");
  });

  it("returns null projection right after a reset (elapsed fraction zero)", () => {
    const quota: RateLimitSnapshot = {
      timestamp: "2026-06-29T12:00:00.000Z",
      primary: {
        usedPercent: 10,
        windowMinutes: 300,
        resetsAt: Date.parse("2026-06-29T17:00:00.000Z") / 1000,
      },
      secondary: null,
    };
    const f = buildForecast([], quota, NOW);
    expect(f.codexPrimary?.projectedPercentAtReset).toBeNull();
    expect(f.codexPrimary?.willExhaust).toBe(false);
    expect(f.codexPrimary?.etaToLimit).toBeNull();
  });

  it("omits codex windows when there is no quota", () => {
    const f = buildForecast([], null, NOW);
    expect(f.codexPrimary).toBeUndefined();
    expect(f.codexSecondary).toBeUndefined();
  });

  it("projects from the snapshot timestamp, not the request time (no drift as the snapshot ages)", () => {
    const quota: RateLimitSnapshot = {
      timestamp: "2026-06-29T12:00:00.000Z", // 40% used as of 12:00 -> 0.5 elapsed -> 80
      primary: {
        usedPercent: 40,
        windowMinutes: 300,
        resetsAt: Date.parse("2026-06-29T14:30:00.000Z") / 1000,
      },
      secondary: null,
    };
    // 90 min later, still before reset, no new snapshot. Projection stays anchored
    // to the snapshot (80), not recomputed against `now` (which would give 50).
    const later = Date.parse("2026-06-29T13:30:00.000Z");
    const f = buildForecast([], quota, later);
    expect(f.codexPrimary?.projectedPercentAtReset).toBeCloseTo(80, 10);
  });

  it("returns null for a stale snapshot whose window already reset", () => {
    const quota: RateLimitSnapshot = {
      timestamp: "2026-06-29T06:00:00.000Z",
      primary: {
        usedPercent: 40,
        windowMinutes: 300,
        resetsAt: Date.parse("2026-06-29T08:00:00.000Z") / 1000, // window 03:00-08:00
      },
      secondary: null,
    };
    const f = buildForecast([], quota, NOW); // NOW = 12:00, past the 08:00 reset
    expect(f.codexPrimary?.projectedPercentAtReset).toBeNull();
    expect(f.codexPrimary?.willExhaust).toBe(false);
    expect(f.codexPrimary?.etaToLimit).toBeNull();
  });
});

describe("buildForecast claude volume", () => {
  it("projects rolling token volume from the recent burn rate", () => {
    const records = [
      rec({
        tool: "claude",
        timestamp: "2026-06-29T10:00:00.000Z",
        outputTokens: 100,
      }),
      rec({
        tool: "claude",
        timestamp: "2026-06-29T11:00:00.000Z",
        outputTokens: 200,
      }),
    ];
    const f = buildForecast(records, null, NOW);
    expect(f.claudeFiveHour?.projectedTokens).toBe(750);
    expect(f.claudeFiveHour?.note).toBe("no limit, volume projection");
    expect(f.claudeSevenDay?.projectedTokens).toBe(25200);
  });

  it("returns null volume when there is no recent Claude activity", () => {
    const f = buildForecast([], null, NOW);
    expect(f.claudeFiveHour?.projectedTokens).toBeNull();
    expect(f.claudeFiveHour?.note).toBe("no recent Claude activity");
  });

  it("returns null volume when the activity span is zero", () => {
    const records = [
      rec({
        tool: "claude",
        timestamp: "2026-06-29T12:00:00.000Z",
        outputTokens: 500,
      }),
    ];
    const f = buildForecast(records, null, NOW);
    expect(f.claudeFiveHour?.projectedTokens).toBeNull();
    expect(f.claudeFiveHour?.note).toBe("insufficient time span");
  });
});
```

- [ ] Run the test and expect FAIL: `npx vitest run src/lib/forecast.test.ts` → fails with a module-resolution error (`Failed to load url ./forecast` / cannot find `./forecast`) because the module does not exist yet.

- [ ] Append the forecast types to `src/lib/normalize.ts` after the `totalTokens` function (current last line 52):

```ts
export interface WindowForecast {
  willExhaust: boolean;
  projectedPercentAtReset: number | null;
  etaToLimit: string | null; // ISO timestamp the linear projection crosses 100%, or null
}

export interface VolumeForecast {
  projectedTokens: number | null;
  note: string;
}

export interface Forecast {
  codexPrimary?: WindowForecast; // 5h
  codexSecondary?: WindowForecast; // weekly
  claudeFiveHour?: VolumeForecast;
  claudeSevenDay?: VolumeForecast;
}
```

- [ ] Create `src/lib/forecast.ts` with this exact content:

```ts
// src/lib/forecast.ts
import {
  totalTokens,
  type Forecast,
  type RateLimitSnapshot,
  type RateLimitWindow,
  type UsageRecord,
  type VolumeForecast,
  type WindowForecast,
} from "./normalize";

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// Codex reports server-authoritative used_percent AS OF the snapshot's timestamp,
// for a window that resets at a known time. We linearly project the end-of-window
// percent from the fraction of the window elapsed AT THE SNAPSHOT — not `now`. The
// percent has not changed since the snapshot, so anchoring elapsed to `now` would
// understate the projection as the snapshot ages (downward drift). A snapshot whose
// window has already reset in real time (now >= resetsAt) is stale: no projection.
function forecastWindow(
  w: RateLimitWindow,
  snapshotMs: number,
  nowMs: number,
): WindowForecast {
  const insufficient: WindowForecast = {
    willExhaust: false,
    projectedPercentAtReset: null,
    etaToLimit: null,
  };
  const windowMs = w.windowMinutes * 60_000;
  const resetsAtMs = w.resetsAt * 1000; // resetsAt is UNIX seconds
  if (windowMs <= 0 || resetsAtMs <= 0) return insufficient;
  // Stale: the window has reset since this snapshot was recorded.
  if (nowMs >= resetsAtMs) return insufficient;

  const windowStartMs = resetsAtMs - windowMs;
  const elapsedMs = snapshotMs - windowStartMs; // elapsed AT THE SNAPSHOT
  const elapsedFraction = elapsedMs / windowMs;
  // Right after a reset (fraction ~0) or a bad snapshot (fraction >1): no honest
  // projection. Never fabricate a number.
  if (!(elapsedFraction > 0 && elapsedFraction <= 1)) return insufficient;

  const projected = w.usedPercent / elapsedFraction;
  const willExhaust = projected >= 100;
  let etaToLimit: string | null = null;
  if (willExhaust && w.usedPercent > 0) {
    const crossMs = windowStartMs + (100 / w.usedPercent) * elapsedMs;
    etaToLimit = new Date(crossMs).toISOString();
  }
  return { willExhaust, projectedPercentAtReset: projected, etaToLimit };
}

// Claude reports no server limit, so we project rolling token VOLUME: measure the
// burn rate over recent activity in the window and extrapolate to a full window.
function volumeForecast(
  records: UsageRecord[],
  nowMs: number,
  windowMs: number,
): VolumeForecast {
  let tokens = 0;
  let earliest = Infinity;
  for (const r of records) {
    if (r.tool !== "claude" || !r.timestamp) continue;
    const t = Date.parse(r.timestamp);
    if (Number.isNaN(t)) continue;
    const age = nowMs - t;
    if (age < 0 || age > windowMs) continue;
    tokens += totalTokens(r);
    if (t < earliest) earliest = t;
  }
  if (tokens === 0 || earliest === Infinity) {
    return { projectedTokens: null, note: "no recent Claude activity" };
  }
  const spanMs = nowMs - earliest;
  if (spanMs <= 0) {
    return { projectedTokens: null, note: "insufficient time span" };
  }
  const projected = Math.round((tokens / spanMs) * windowMs);
  return { projectedTokens: projected, note: "no limit, volume projection" };
}

export function buildForecast(
  records: UsageRecord[],
  codexQuota: RateLimitSnapshot | null,
  nowMs: number,
): Forecast {
  const forecast: Forecast = {
    claudeFiveHour: volumeForecast(records, nowMs, FIVE_HOURS_MS),
    claudeSevenDay: volumeForecast(records, nowMs, SEVEN_DAYS_MS),
  };
  // Codex percent is as-of the snapshot's timestamp; anchor elapsed to it.
  const snapshotMs = codexQuota ? Date.parse(codexQuota.timestamp) : NaN;
  if (codexQuota?.primary && !Number.isNaN(snapshotMs)) {
    forecast.codexPrimary = forecastWindow(
      codexQuota.primary,
      snapshotMs,
      nowMs,
    );
  }
  if (codexQuota?.secondary && !Number.isNaN(snapshotMs)) {
    forecast.codexSecondary = forecastWindow(
      codexQuota.secondary,
      snapshotMs,
      nowMs,
    );
  }
  return forecast;
}
```

- [ ] Run the test and expect PASS: `npx vitest run src/lib/forecast.test.ts` → all 6 tests pass.

- [ ] Commit: `git add src/lib/normalize.ts src/lib/forecast.ts src/lib/forecast.test.ts && git commit -m "feat(lib): add quota burn-rate forecasting"`

---

### Task 2: Quota-aware tips engine (`tips.ts`)

**Files:**

- Create: `src/lib/tips.ts`
- Modify: `src/lib/normalize.ts` (append `Tip` type after the `Forecast` type added in Task 1)
- Test: `src/lib/tips.test.ts`

**Interfaces:**

- Consumes: `UsageRecord`, `totalTokens`, `Forecast`, `WindowForecast` (from `src/lib/normalize.ts`); `cost(r, table)`, `isPriced(model, table)`, `defaultPricing`, `PricingTable`, `Rate` (from `src/lib/pricing.ts` lines 5-38); `Forecast.codexPrimary/codexSecondary` from Task 1.
- Produces:
  - `Tip = { id: string; severity: "info" | "warn"; title: string; detail: string; savingsUsd?: number }`
  - `buildTips(records: UsageRecord[], forecast: Forecast, pricing?: PricingTable): Tip[]`

Steps:

- [ ] Create `src/lib/tips.test.ts` with this exact content:

```ts
// src/lib/tips.test.ts
import { describe, it, expect } from "vitest";
import { buildTips } from "./tips";
import type { Forecast, UsageRecord } from "./normalize";
import type { PricingTable } from "./pricing";

const pricing: PricingTable = {
  "claude-opus-4-8": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-sonnet-4-6": {
    input: 3,
    output: 15,
    cacheWrite: 3.75,
    cacheRead: 0.3,
  },
  "gpt-5-codex": { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
};

function rec(p: Partial<UsageRecord>): UsageRecord {
  return {
    tool: "claude",
    timestamp: "2026-06-29T10:00:00.000Z",
    model: "claude-opus-4-8",
    project: "p",
    sessionId: "s",
    inputTokens: 0,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    reasoningTokens: 0,
    ...p,
  };
}

describe("approaching-limit rule", () => {
  it("warns when a codex window is projected past the threshold", () => {
    const forecast: Forecast = {
      codexPrimary: {
        willExhaust: true,
        projectedPercentAtReset: 120,
        etaToLimit: "2026-06-29T13:40:00.000Z",
      },
      codexSecondary: {
        willExhaust: false,
        projectedPercentAtReset: 80,
        etaToLimit: null,
      },
    };
    const tips = buildTips([], forecast, pricing);
    const t = tips.find((x) => x.id === "approaching-limit-codex-5h");
    expect(t).toBeDefined();
    expect(t?.severity).toBe("warn");
    expect(t?.title).toBe("Codex 5h quota approaching limit");
    expect(t?.detail).toBe(
      "Projected 120% of the Codex 5h quota by reset at the current pace.",
    );
    expect(
      tips.find((x) => x.id === "approaching-limit-codex-weekly"),
    ).toBeUndefined();
  });

  it("does not fire when the projection is null", () => {
    const tips = buildTips(
      [],
      {
        codexPrimary: {
          willExhaust: false,
          projectedPercentAtReset: null,
          etaToLimit: null,
        },
      },
      pricing,
    );
    expect(
      tips.find((x) => x.id === "approaching-limit-codex-5h"),
    ).toBeUndefined();
  });
});

describe("right-size-model rule", () => {
  it("fires with pinned sonnet-equivalent savings for short-output opus work", () => {
    const records = [
      rec({
        tool: "claude",
        model: "claude-opus-4-8",
        inputTokens: 1_000_000,
        outputTokens: 50_000,
      }),
    ];
    const tips = buildTips(records, {}, pricing);
    const t = tips.find((x) => x.id === "right-size-model");
    expect(t).toBeDefined();
    expect(t?.severity).toBe("info");
    expect(t?.savingsUsd).toBeCloseTo(2.5, 10);
    expect(t?.detail).toBe(
      "Opus handled work with little output. The same tokens at Sonnet rates would cost about $3.75 instead of $6.25.",
    );
  });

  it("does not fire when output share is high", () => {
    const records = [
      rec({
        tool: "claude",
        model: "claude-opus-4-8",
        inputTokens: 100_000,
        outputTokens: 900_000,
      }),
    ];
    const tips = buildTips(records, {}, pricing);
    expect(tips.find((x) => x.id === "right-size-model")).toBeUndefined();
  });
});

describe("low-cache rule", () => {
  it("fires when cache read share of prompt tokens is low", () => {
    const records = [
      rec({
        tool: "claude",
        model: "claude-sonnet-4-6",
        inputTokens: 8000,
        cacheReadTokens: 2000,
      }),
    ];
    const tips = buildTips(records, {}, pricing);
    const t = tips.find((x) => x.id === "low-cache");
    expect(t).toBeDefined();
    expect(t?.detail).toBe(
      "Only 20% of prompt tokens were served from cache. Reusing context across turns lowers cost.",
    );
  });

  it("does not fire when cache reuse is high", () => {
    const records = [
      rec({
        tool: "claude",
        model: "claude-sonnet-4-6",
        inputTokens: 1000,
        cacheReadTokens: 90000,
      }),
    ];
    const tips = buildTips(records, {}, pricing);
    expect(tips.find((x) => x.id === "low-cache")).toBeUndefined();
  });

  it("does not fire below the minimum prompt-token floor", () => {
    const records = [
      rec({
        tool: "claude",
        model: "claude-sonnet-4-6",
        inputTokens: 500,
        cacheReadTokens: 100,
      }),
    ];
    const tips = buildTips(records, {}, pricing);
    expect(tips.find((x) => x.id === "low-cache")).toBeUndefined();
  });
});

describe("unpriced-present rule", () => {
  it("fires and names the unpriced model", () => {
    const records = [
      rec({
        tool: "codex",
        model: "gpt-5-codex",
        inputTokens: 5000,
        outputTokens: 1000,
      }),
    ];
    const tips = buildTips(records, {}, pricing);
    const t = tips.find((x) => x.id === "unpriced-present");
    expect(t).toBeDefined();
    expect(t?.detail).toContain("gpt-5-codex");
  });
});

describe("buildTips baseline", () => {
  it("returns no tips for empty input", () => {
    expect(buildTips([], {}, pricing)).toEqual([]);
  });
});
```

- [ ] Run the test and expect FAIL: `npx vitest run src/lib/tips.test.ts` → fails with a module-resolution error (`./tips` does not exist yet).

- [ ] Append the `Tip` type to `src/lib/normalize.ts` after the `Forecast` interface:

```ts
export interface Tip {
  id: string;
  severity: "info" | "warn";
  title: string;
  detail: string;
  savingsUsd?: number; // notional, API-rate
}
```

- [ ] Create `src/lib/tips.ts` with this exact content:

```ts
// src/lib/tips.ts
import {
  totalTokens,
  type Forecast,
  type Tip,
  type UsageRecord,
  type WindowForecast,
} from "./normalize";
import { cost, defaultPricing, isPriced, type PricingTable } from "./pricing";

const APPROACHING_LIMIT_PCT = 85;
const LOW_CACHE_THRESHOLD = 0.5;
const LOW_CACHE_MIN_INPUT = 10_000;
const SONNET_MODEL = "claude-sonnet-4-6";
const EXPENSIVE_PREFIX = "claude-opus";
const RIGHT_SIZE_MIN_SAVINGS = 0.5;
const SHORT_OUTPUT_SHARE = 0.1;

function approachingTip(
  id: string,
  label: string,
  wf?: WindowForecast,
): Tip | null {
  if (!wf || wf.projectedPercentAtReset == null) return null;
  if (wf.projectedPercentAtReset < APPROACHING_LIMIT_PCT) return null;
  const pct = Math.round(wf.projectedPercentAtReset);
  return {
    id,
    severity: "warn",
    title: `${label} quota approaching limit`,
    detail: `Projected ${pct}% of the ${label} quota by reset at the current pace.`,
  };
}

export function buildTips(
  records: UsageRecord[],
  forecast: Forecast,
  pricing: PricingTable = defaultPricing,
): Tip[] {
  const tips: Tip[] = [];

  const primary = approachingTip(
    "approaching-limit-codex-5h",
    "Codex 5h",
    forecast.codexPrimary,
  );
  if (primary) tips.push(primary);
  const secondary = approachingTip(
    "approaching-limit-codex-weekly",
    "Codex weekly",
    forecast.codexSecondary,
  );
  if (secondary) tips.push(secondary);

  // right-size-model: opus work with little output, priced at sonnet-equivalent.
  const sonnetRate = pricing[SONNET_MODEL];
  if (sonnetRate) {
    let input = 0;
    let output = 0;
    let cacheWrite = 0;
    let cacheRead = 0;
    let total = 0;
    let current = 0;
    for (const r of records) {
      if (!r.model.startsWith(EXPENSIVE_PREFIX)) continue;
      input += r.inputTokens;
      output += r.outputTokens;
      cacheWrite += r.cacheWriteTokens;
      cacheRead += r.cacheReadTokens;
      total += totalTokens(r);
      current += cost(r, pricing);
    }
    if (total > 0) {
      const sonnet =
        (input * sonnetRate.input +
          output * sonnetRate.output +
          cacheWrite * sonnetRate.cacheWrite +
          cacheRead * sonnetRate.cacheRead) /
        1_000_000;
      const savings = current - sonnet;
      const outputShare = output / total;
      if (
        savings >= RIGHT_SIZE_MIN_SAVINGS &&
        outputShare < SHORT_OUTPUT_SHARE
      ) {
        tips.push({
          id: "right-size-model",
          severity: "info",
          title: "Consider a smaller model for short-output work",
          detail: `Opus handled work with little output. The same tokens at Sonnet rates would cost about $${sonnet.toFixed(2)} instead of $${current.toFixed(2)}.`,
          savingsUsd: savings,
        });
      }
    }
  }

  // low-cache: cache-read share of Claude prompt tokens below the threshold,
  // over all recorded activity (deterministic; intentionally not time-windowed).
  let freshInput = 0;
  let claudeCacheRead = 0;
  for (const r of records) {
    if (r.tool !== "claude") continue;
    freshInput += r.inputTokens;
    claudeCacheRead += r.cacheReadTokens;
  }
  const promptSide = freshInput + claudeCacheRead;
  if (promptSide >= LOW_CACHE_MIN_INPUT) {
    const share = claudeCacheRead / promptSide;
    if (share < LOW_CACHE_THRESHOLD) {
      const pct = Math.round(share * 100);
      tips.push({
        id: "low-cache",
        severity: "info",
        title: "Low prompt cache reuse",
        detail: `Only ${pct}% of prompt tokens were served from cache. Reusing context across turns lowers cost.`,
      });
    }
  }

  // unpriced-present: models rendered without a price so cost gaps are visible.
  const unpriced = new Set<string>();
  for (const r of records) {
    if (totalTokens(r) <= 0) continue;
    if (!isPriced(r.model, pricing)) unpriced.add(r.model);
  }
  if (unpriced.size > 0) {
    const models = [...unpriced].sort().join(", ");
    tips.push({
      id: "unpriced-present",
      severity: "info",
      title: "Some models have no pricing",
      detail: `${unpriced.size} model(s) are shown without cost: ${models}. Their spend is not included in totals.`,
    });
  }

  return tips;
}
```

- [ ] Run the test and expect PASS: `npx vitest run src/lib/tips.test.ts` → all 9 tests pass.

- [ ] Commit: `git add src/lib/normalize.ts src/lib/tips.ts src/lib/tips.test.ts && git commit -m "feat(lib): add quota-aware tips engine"`

---

### Task 3: Retention settings reader (`settings.ts`)

**Files:**

- Create: `src/lib/retention.mjs` (runtime-safe pure transform shared with the `.mjs` script)
- Create: `src/lib/retention.d.mts` (types so `settings.ts` can import the `.mjs` under strict TS)
- Create: `src/lib/settings.ts`
- Test: `src/lib/settings.test.ts`

**Interfaces:**

- Consumes: `node:fs` `readFileSync`, `node:os` `homedir`, `node:path` `join`.
- Produces (`src/lib/retention.mjs` — plain ESM so both TS and the raw-`node` script import one implementation):
  - `RETENTION_TARGET_DAYS = 3650`
  - `raiseRetention(obj: Record<string, unknown>, targetDays?: number): { next: Record<string, unknown>; changed: boolean }`
- Produces (`src/lib/settings.ts`):
  - `RETENTION_DEFAULT_DAYS = 30`, `RETENTION_SAFE_DAYS = 180`
  - re-exports `RETENTION_TARGET_DAYS` and `raiseRetention` from `./retention.mjs` (single source of truth)
  - `RetentionInfo = { cleanupPeriodDays: number | null; exists: boolean; path: string }`
  - `getRetention(settingsPath?: string): RetentionInfo`
  - `effectiveRetentionDays(info: RetentionInfo): number`
  - `isRetentionRisky(info: RetentionInfo): boolean`

Steps:

- [ ] Create `src/lib/settings.test.ts` with this exact content:

```ts
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
```

- [ ] Run the test and expect FAIL: `npx vitest run src/lib/settings.test.ts` → fails with a module-resolution error (`./settings` does not exist yet).

- [ ] Create `src/lib/retention.mjs` with this exact content:

```js
// src/lib/retention.mjs
// Pure retention transform + target, shared by settings.ts and
// scripts/fix-retention.mjs. Plain ESM (.mjs) so the raw-`node` script imports it
// on any Node version without a TypeScript loader.

// Claude Code deletes usage history older than cleanupPeriodDays (30-day default
// when the key is absent). We raise it to ~10 years to preserve history.
export const RETENTION_TARGET_DAYS = 3650;

// Raise cleanupPeriodDays to at least targetDays, preserving every other key.
// Idempotent: returns the same object with changed=false when already met.
export function raiseRetention(obj, targetDays = RETENTION_TARGET_DAYS) {
  const current =
    typeof obj.cleanupPeriodDays === "number" ? obj.cleanupPeriodDays : 0;
  if (current >= targetDays) {
    return { next: obj, changed: false };
  }
  return { next: { ...obj, cleanupPeriodDays: targetDays }, changed: true };
}
```

- [ ] Create `src/lib/retention.d.mts` with this exact content:

```ts
// src/lib/retention.d.mts
export const RETENTION_TARGET_DAYS: number;
export function raiseRetention(
  obj: Record<string, unknown>,
  targetDays?: number,
): { next: Record<string, unknown>; changed: boolean };
```

- [ ] Create `src/lib/settings.ts` with this exact content:

```ts
// src/lib/settings.ts
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Single source of truth for the write transform lives in retention.mjs so the
// raw-`node` fix-retention script and this module share one implementation.
export { RETENTION_TARGET_DAYS, raiseRetention } from "./retention.mjs";

// Claude Code applies a 30-day default when cleanupPeriodDays is absent.
export const RETENTION_DEFAULT_DAYS = 30;
export const RETENTION_SAFE_DAYS = 180;

export interface RetentionInfo {
  cleanupPeriodDays: number | null;
  exists: boolean;
  path: string;
}

// Read-only. The dashboard only ever warns; it never mutates settings.json.
export function getRetention(
  settingsPath: string = join(homedir(), ".claude", "settings.json"),
): RetentionInfo {
  try {
    const raw = readFileSync(settingsPath, "utf8");
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const v = obj.cleanupPeriodDays;
    return {
      cleanupPeriodDays: typeof v === "number" ? v : null,
      exists: true,
      path: settingsPath,
    };
  } catch {
    return { cleanupPeriodDays: null, exists: false, path: settingsPath };
  }
}

export function effectiveRetentionDays(info: RetentionInfo): number {
  return info.cleanupPeriodDays ?? RETENTION_DEFAULT_DAYS;
}

export function isRetentionRisky(info: RetentionInfo): boolean {
  return effectiveRetentionDays(info) < RETENTION_SAFE_DAYS;
}
```

- [ ] Run the test and expect PASS: `npx vitest run src/lib/settings.test.ts` → all 8 tests pass.

- [ ] Commit: `git add src/lib/retention.mjs src/lib/retention.d.mts src/lib/settings.ts src/lib/settings.test.ts && git commit -m "feat(lib): add read-only Claude retention settings reader"`

---

### Task 4: Retention protection command (`fix-retention.mjs`)

**Files:**

- Create: `scripts/fix-retention.mjs`
- Modify: `package.json` (add `fix-retention` script to `scripts`, lines 6-12)

**Interfaces:**

- Consumes: `raiseRetention(obj, targetDays)` and `RETENTION_TARGET_DAYS` from `src/lib/retention.mjs` (Task 3 — plain `.mjs` so a raw-`node` script imports it on any Node version, no TypeScript loader needed); `node:fs`, `node:os`, `node:path`.
- Produces: a CLI that takes an optional settings-path argument (`process.argv[2]`, default `~/.claude/settings.json`) and performs the safe read-modify-write. No new importable API.

Steps:

- [ ] Create the `scripts` directory: `mkdir -p scripts`

- [ ] Create `scripts/fix-retention.mjs` with this exact content:

```js
#!/usr/bin/env node
// Raises Claude Code's cleanupPeriodDays so usage history is not auto-deleted.
// Safe read-modify-write: preserves every other key, aborts without writing on a
// parse error, and is safe to run repeatedly. Pass a path as the first argument
// to target a file other than ~/.claude/settings.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  raiseRetention,
  RETENTION_TARGET_DAYS,
} from "../src/lib/retention.mjs";

function run(settingsPath) {
  let obj = {};
  const existed = existsSync(settingsPath);

  if (existed) {
    let raw;
    try {
      raw = readFileSync(settingsPath, "utf8");
    } catch (err) {
      console.error(`Could not read ${settingsPath}: ${err.message}`);
      process.exit(1);
    }
    try {
      obj = JSON.parse(raw);
    } catch {
      console.error(
        `Refusing to write: ${settingsPath} is not valid JSON. Fix it by hand first.`,
      );
      process.exit(1);
    }
    if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
      console.error(`Refusing to write: ${settingsPath} is not a JSON object.`);
      process.exit(1);
    }
  } else {
    console.log(`No settings file at ${settingsPath}; creating a minimal one.`);
  }

  const before =
    typeof obj.cleanupPeriodDays === "number"
      ? obj.cleanupPeriodDays
      : "(unset, defaults to 30)";
  const { next, changed } = raiseRetention(obj, RETENTION_TARGET_DAYS);

  if (!changed && existed) {
    console.log(`cleanupPeriodDays already ${before}; nothing to do.`);
    return;
  }

  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(next, null, 2) + "\n");
  console.log(`cleanupPeriodDays: ${before} -> ${next.cleanupPeriodDays}`);
  console.log(`Wrote ${settingsPath}`);
}

const target = process.argv[2] ?? join(homedir(), ".claude", "settings.json");
run(target);
```

- [ ] Add the script to `package.json`. Replace the `scripts` block (lines 6-12):

```json
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "start": "node ./dist/server/entry.mjs",
    "test": "vitest run",
    "test:watch": "vitest",
    "fix-retention": "node scripts/fix-retention.mjs"
  },
```

- [ ] Verify raise + idempotency + key preservation against a temp file. Run: `printf '{\n  "theme": "dark",\n  "cleanupPeriodDays": 30\n}\n' > "$TMPDIR/ut-settings.json" && node scripts/fix-retention.mjs "$TMPDIR/ut-settings.json"` → expect stdout `cleanupPeriodDays: 30 -> 3650` and `Wrote ...`. Then run `node scripts/fix-retention.mjs "$TMPDIR/ut-settings.json"` again → expect `cleanupPeriodDays already 3650; nothing to do.`

- [ ] Verify keys preserved: Read `$TMPDIR/ut-settings.json` with the Read tool and confirm it contains `"theme": "dark"` and `"cleanupPeriodDays": 3650`.

- [ ] Verify parse-error abort: Run `printf 'not json' > "$TMPDIR/ut-bad.json" && node scripts/fix-retention.mjs "$TMPDIR/ut-bad.json"; echo "exit=$?"` → expect `Refusing to write: ... is not valid JSON.` and `exit=1`, with the file left unchanged.

- [ ] Commit: `git add scripts/fix-retention.mjs package.json && git commit -m "feat(scripts): add retention protection command"`

---

### Task 5: Wire forecast and tips into the SSR/API payload

**Files:**

- Modify: `src/lib/aggregate.ts` (import line 2-9; append `DashboardData` after `Rollups`, line 74)
- Modify: `src/pages/index.astro` (full frontmatter + body, lines 1-16)
- Modify: `src/pages/api/usage.ts` (full file, lines 1-22)
- Modify: `src/components/Dashboard.tsx` (import line 3; signature line 13; state line 14)

**Interfaces:**

- Consumes: `aggregate(records, codexQuota, pricing, windows): Rollups` (lines 76-164), `claudeWindows(records, nowMs): ClaudeWindows` (lines 18-39), `Rollups` (lines 66-74), `buildForecast` (Task 1), `buildTips` (Task 2), `applyFilters(records, params): UsageRecord[]` (`src/lib/filters.ts`), `scan(): { records, codexQuota }` (`src/lib/scan.ts`).
- Produces: `DashboardData extends Rollups { forecast: Forecast; tips: Tip[] }` in `src/lib/aggregate.ts`; SSR `initial` payload and `/api/usage` JSON now include `forecast` and `tips` computed from **unfiltered** records.

Steps:

- [ ] Update the `normalize` import in `src/lib/aggregate.ts` (lines 2-9) to add `Forecast` and `Tip`:

```ts
import {
  totalTokens,
  type ClaudeWindows,
  type Forecast,
  type RateLimitSnapshot,
  type Tip,
  type Tool,
  type UsageRecord,
} from "./normalize";
```

- [ ] Append the `DashboardData` type to `src/lib/aggregate.ts` immediately after the closing brace of the `Rollups` interface (after line 74):

```ts
export interface DashboardData extends Rollups {
  forecast: Forecast;
  tips: Tip[];
}
```

- [ ] Replace the entire contents of `src/pages/index.astro` with:

```astro
---
import Layout from '../layouts/Layout.astro';
import Dashboard from '../components/Dashboard.tsx';
import { scan } from '../lib/scan';
import { aggregate, claudeWindows } from '../lib/aggregate';
import { defaultPricing } from '../lib/pricing';
import { buildForecast } from '../lib/forecast';
import { buildTips } from '../lib/tips';

export const prerender = false;

const now = Date.now();
const { records, codexQuota } = scan();
// Windows, forecast, and tips are computed from the UNFILTERED records so they
// reflect current account state regardless of any filter applied later.
const windows = claudeWindows(records, now);
const rollups = aggregate(records, codexQuota, defaultPricing, windows);
const forecast = buildForecast(records, codexQuota, now);
const tips = buildTips(records, forecast, defaultPricing);
const initial = { ...rollups, forecast, tips };
---
<Layout>
  <Dashboard client:load initial={initial} />
</Layout>
```

- [ ] Replace the entire contents of `src/pages/api/usage.ts` with:

```ts
// src/pages/api/usage.ts
import type { APIRoute } from "astro";
import { scan } from "../../lib/scan";
import { applyFilters } from "../../lib/filters";
import { aggregate, claudeWindows } from "../../lib/aggregate";
import { defaultPricing } from "../../lib/pricing";
import { buildForecast } from "../../lib/forecast";
import { buildTips } from "../../lib/tips";

export const prerender = false;

export const GET: APIRoute = ({ url }) => {
  const now = Date.now();
  const { records, codexQuota } = scan();
  // Windows, forecast, and tips are computed from the UNFILTERED records so the
  // limits panel, forecast line, and advisories reflect current account state
  // regardless of the active tool/date filter (matching codexQuota).
  const windows = claudeWindows(records, now);
  const forecast = buildForecast(records, codexQuota, now);
  const tips = buildTips(records, forecast, defaultPricing);
  const filtered = applyFilters(records, url.searchParams);
  const rollups = aggregate(filtered, codexQuota, defaultPricing, windows);
  return new Response(JSON.stringify({ ...rollups, forecast, tips }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
```

- [ ] Update `src/components/Dashboard.tsx` import (line 3) from `import type { Rollups } from "../lib/aggregate";` to:

```ts
import type { DashboardData } from "../lib/aggregate";
```

- [ ] Update the `Dashboard` signature (line 13) from `export default function Dashboard({ initial }: { initial: Rollups }) {` to:

```tsx
export default function Dashboard({ initial }: { initial: DashboardData }) {
```

- [ ] Update the state declaration (line 14) from `const [data, setData] = useState<Rollups>(initial);` to:

```tsx
const [data, setData] = useState<DashboardData>(initial);
```

- [ ] Run the full test suite and expect PASS (no regressions): `npm test` → all suites green.

- [ ] Verify the build compiles: `npm run build` → completes without errors.

- [ ] Verify the payload carries forecast/tips: `npm run build && (node ./dist/server/entry.mjs & sleep 2; curl -s http://localhost:4321/api/usage | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('forecast keys:',Object.keys(j.forecast||{}));console.log('tips:',Array.isArray(j.tips));}); "; kill %1)` → expect `forecast keys:` listing `claudeFiveHour`/`claudeSevenDay` (and codex windows if present) and `tips: true`.

- [ ] Commit: `git add src/lib/aggregate.ts src/pages/index.astro src/pages/api/usage.ts src/components/Dashboard.tsx && git commit -m "feat(ui): include forecast and tips in dashboard payload"`

---

### Task 6: Forecast line in `QuotaPanel`

**Files:**

- Modify: `src/components/QuotaPanel.tsx` (full file, lines 1-79)

**Interfaces:**

- Consumes: `DashboardData` (Task 5, provides `claudeWindows`, `codexQuota`, `forecast`), `ClaudeWindows`, `RateLimitWindow`, `Forecast`, `WindowForecast`, `VolumeForecast` (from `src/lib/normalize.ts`).
- Produces: `QuotaPanel({ data }: { data: DashboardData })` rendering per-window Codex projection lines and Claude 5h/7d volume-projection lines. No new exports consumed by later tasks.

Steps:

- [ ] Replace the entire contents of `src/components/QuotaPanel.tsx` with:

```tsx
// src/components/QuotaPanel.tsx
import type { DashboardData } from "../lib/aggregate";
import type {
  ClaudeWindows,
  Forecast,
  RateLimitWindow,
  VolumeForecast,
  WindowForecast,
} from "../lib/normalize";

const fmtTokens = (n: number) => new Intl.NumberFormat().format(n);

function Bar({ label, w }: { label: string; w: RateLimitWindow | null }) {
  if (!w) return null;
  const resets = new Date(w.resetsAt * 1000).toLocaleString();
  return (
    <div>
      <div className="flex justify-between text-sm text-neutral-400">
        <span>{label}</span>
        <span>
          {w.usedPercent.toFixed(0)}% · resets {resets}
        </span>
      </div>
      <div className="h-2 bg-neutral-800 rounded mt-1">
        <div
          className="h-2 bg-amber-500 rounded"
          style={{ width: `${Math.min(100, w.usedPercent)}%` }}
        />
      </div>
    </div>
  );
}

function CodexForecastLine({ f }: { f?: WindowForecast }) {
  if (!f || f.projectedPercentAtReset == null) return null;
  const pct = Math.round(f.projectedPercentAtReset);
  return (
    <div
      className={`text-xs mt-1 ${f.willExhaust ? "text-amber-400" : "text-neutral-500"}`}
    >
      Projected {pct}% by reset
      {f.willExhaust && f.etaToLimit
        ? ` · limit ~${new Date(f.etaToLimit).toLocaleString()}`
        : ""}
    </div>
  );
}

function ClaudeForecastLine({
  label,
  v,
}: {
  label: string;
  v?: VolumeForecast;
}) {
  if (!v || v.projectedTokens == null) return null;
  return (
    <div className="text-xs text-neutral-500">
      {label}: ~{fmtTokens(v.projectedTokens)} tokens projected
    </div>
  );
}

function Row({ label, tokens }: { label: string; tokens: number }) {
  return (
    <div className="flex justify-between text-sm text-neutral-400">
      <span>{label}</span>
      <span className="text-neutral-200">{fmtTokens(tokens)} tokens</span>
    </div>
  );
}

function ClaudeLimits({ w, f }: { w: ClaudeWindows; f: Forecast }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-neutral-300">Claude</h3>
      <Row label="Last 5 hours" tokens={w.fiveHourTokens} />
      <ClaudeForecastLine label="5h projection" v={f.claudeFiveHour} />
      <Row label="Last 7 days" tokens={w.sevenDayTokens} />
      <ClaudeForecastLine label="7d projection" v={f.claudeSevenDay} />
      <p className="text-xs text-neutral-500">
        No server-side limit reported by Claude; shown from token volume.
        {w.asOf ? ` As of ${new Date(w.asOf).toLocaleString()}.` : ""}
      </p>
    </div>
  );
}

function CodexLimits({
  q,
  f,
}: {
  q: DashboardData["codexQuota"];
  f: Forecast;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-neutral-300">Codex</h3>
      {q ? (
        <>
          <div>
            <Bar label="5h window" w={q.primary} />
            <CodexForecastLine f={f.codexPrimary} />
          </div>
          <div>
            <Bar label="Weekly window" w={q.secondary} />
            <CodexForecastLine f={f.codexSecondary} />
          </div>
        </>
      ) : (
        <div className="text-sm text-neutral-400">
          No Codex quota data found.
        </div>
      )}
    </div>
  );
}

export default function QuotaPanel({ data }: { data: DashboardData }) {
  return (
    <section className="rounded-xl bg-neutral-900 p-4 space-y-3">
      <h2 className="text-lg font-medium">Usage limits</h2>
      <div className="grid sm:grid-cols-2 gap-6">
        <ClaudeLimits w={data.claudeWindows} f={data.forecast} />
        <CodexLimits q={data.codexQuota} f={data.forecast} />
      </div>
    </section>
  );
}
```

- [ ] Run the full test suite and expect PASS: `npm test` → all green.

- [ ] Verify the build compiles: `npm run build` → completes without errors.

- [ ] Visual verification (tests do not verify paint): run `npm run dev`, open `http://localhost:4321`, and confirm in the "Usage limits" panel that (a) each Claude row shows a `5h projection: ~N tokens projected` / `7d projection: ~N tokens projected` line when Claude activity exists, and (b) each Codex bar shows a `Projected N% by reset` line, amber when it projects past 100%. Note the exact projected numbers observed.

- [ ] Commit: `git add src/components/QuotaPanel.tsx && git commit -m "feat(ui): show quota forecast line in the limits panel"`

---

### Task 7: Tips component on the Overview

**Files:**

- Create: `src/components/Tips.tsx`
- Modify: `src/components/Dashboard.tsx` (add import; render `<Tips>` after `<Overview>`)

**Interfaces:**

- Consumes: `Tip` type (`src/lib/normalize.ts`), `DashboardData.tips` (Task 5).
- Produces: `Tips({ tips }: { tips: Tip[] }): JSX.Element | null`.

Steps:

- [ ] Create `src/components/Tips.tsx` with this exact content:

```tsx
// src/components/Tips.tsx
import type { Tip } from "../lib/normalize";

export default function Tips({ tips }: { tips: Tip[] }) {
  if (!tips.length) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-medium">Tips</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {tips.map((t) => (
          <div
            key={t.id}
            className={`rounded-xl p-4 border ${
              t.severity === "warn"
                ? "border-amber-500/40 bg-amber-500/5"
                : "border-neutral-800 bg-neutral-900"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium text-neutral-200">
                {t.title}
              </div>
              {t.savingsUsd != null ? (
                <div className="text-sm text-emerald-400 whitespace-nowrap">
                  save ~${t.savingsUsd.toFixed(2)}
                </div>
              ) : null}
            </div>
            <p className="text-sm text-neutral-400 mt-1">{t.detail}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] Add the `Tips` import to `src/components/Dashboard.tsx` after the `Overview` import (currently line 5):

```tsx
import Tips from "./Tips";
```

- [ ] Render `<Tips>` immediately after `<Overview data={data} />` (currently line 90):

```tsx
      <Overview data={data} />
      <Tips tips={data.tips} />
```

- [ ] Run the full test suite and expect PASS: `npm test` → all green.

- [ ] Verify the build compiles: `npm run build` → completes without errors.

- [ ] Visual verification: run `npm run dev`, open `http://localhost:4321`, and confirm a "Tips" section renders below the Overview cards with one card per active tip; warn-severity tips have an amber border and right-size tips show a green `save ~$X.XX` badge. Confirm the section disappears when no tips apply (e.g., no unpriced models and healthy cache).

- [ ] Commit: `git add src/components/Tips.tsx src/components/Dashboard.tsx && git commit -m "feat(ui): render usage tips on the overview"`

---

### Task 8: Retention warning banner

**Files:**

- Create: `src/components/RetentionBanner.tsx`
- Modify: `src/pages/index.astro` (add settings import; compute `retention` primitives; pass prop)
- Modify: `src/components/Dashboard.tsx` (add import; add `retention` prop; render banner first)

**Interfaces:**

- Consumes: `getRetention()`, `isRetentionRisky(info)`, `effectiveRetentionDays(info)` (Task 3) — called server-side only in `index.astro`; `RetentionBanner` receives plain primitives so no server module reaches the client bundle.
- Produces: `RetentionBanner({ risky, days }: { risky: boolean; days: number }): JSX.Element | null`; `Dashboard` gains a `retention: { risky: boolean; days: number }` prop.

Steps:

- [ ] Create `src/components/RetentionBanner.tsx` with this exact content:

```tsx
// src/components/RetentionBanner.tsx
export default function RetentionBanner({
  risky,
  days,
}: {
  risky: boolean;
  days: number;
}) {
  if (!risky) return null;
  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
      <div className="font-medium">
        Claude is set to delete usage history after {days} days.
      </div>
      <p className="mt-1 text-amber-200/80">
        Run{" "}
        <code className="rounded bg-neutral-800 px-1 py-0.5 text-amber-100">
          npm run fix-retention
        </code>{" "}
        to raise the retention window so past usage is not lost.
      </p>
    </div>
  );
}
```

- [ ] Add the settings import to `src/pages/index.astro` after the `buildTips` import:

```astro
import { getRetention, isRetentionRisky, effectiveRetentionDays } from '../lib/settings';
```

- [ ] Add the retention computation to the `index.astro` frontmatter immediately after the `const tips = ...` line:

```astro
const info = getRetention();
const retention = { risky: isRetentionRisky(info), days: effectiveRetentionDays(info) };
```

- [ ] Update the `index.astro` body to pass the prop, changing `<Dashboard client:load initial={initial} />` to:

```astro
  <Dashboard client:load initial={initial} retention={retention} />
```

- [ ] Add the `RetentionBanner` import to `src/components/Dashboard.tsx` after the `Tips` import:

```tsx
import RetentionBanner from "./RetentionBanner";
```

- [ ] Update the `Dashboard` signature to accept the `retention` prop, replacing `export default function Dashboard({ initial }: { initial: DashboardData }) {` with:

```tsx
export default function Dashboard({
  initial,
  retention,
}: {
  initial: DashboardData;
  retention: { risky: boolean; days: number };
}) {
```

- [ ] Render the banner as the first child of the outer `<div className="space-y-8">` (currently line 43), placing it before the filter bar:

```tsx
    <div className="space-y-8">
      <RetentionBanner risky={retention.risky} days={retention.days} />
      <div className="flex flex-wrap items-center gap-3 text-sm">
```

- [ ] Run the full test suite and expect PASS: `npm test` → all green.

- [ ] Verify the build compiles and does not pull `node:fs` into the client bundle: `npm run build` → completes without errors (no "Could not resolve node:fs" / externalized-module errors from the React island graph).

- [ ] Visual verification: with a short retention (`~/.claude/settings.json` `cleanupPeriodDays` unset or under 180), run `npm run dev`, open `http://localhost:4321`, and confirm an amber banner appears at the top reading "Claude is set to delete usage history after N days." with the `npm run fix-retention` code chip. Then run `npm run fix-retention`, reload, and confirm the banner disappears.

- [ ] Commit: `git add src/components/RetentionBanner.tsx src/pages/index.astro src/components/Dashboard.tsx && git commit -m "feat(ui): warn when Claude retention window is short"`

---

### Task 9: Full Phase 1 verification

**Files:**

- Test: entire suite + production build (no new files).

**Interfaces:**

- Consumes: everything from Tasks 1-8.
- Produces: a green full test run and a clean build confirming the phase is shippable.

Steps:

- [ ] Run the entire suite and expect PASS: `npm test` → all files green including `forecast.test.ts`, `tips.test.ts`, `settings.test.ts`, and the pre-existing `aggregate.test.ts`/`pricing.test.ts`/`filters.test.ts`/`normalize.test.ts`/`scan.test.ts`.

- [ ] Run the production build and expect success: `npm run build` → completes without errors.

- [ ] End-to-end visual smoke: run `npm run dev`, open `http://localhost:4321`, and confirm in one view: the retention banner (if retention is short), the Tips section, and the QuotaPanel forecast lines all render together; then toggle the tool filter and a date range and confirm the Overview cards/charts update while the QuotaPanel forecast lines and Tips stay constant (unfiltered-invariant holds).

- [ ] No commit (verification only).
