# Usage Tracker — Competitive Features — Design

**Date:** 2026-07-01
**Status:** Approved design, pending implementation plan
**Stack:** TypeScript · Astro (SSR, `@astrojs/node` standalone) · React islands · Recharts · Tailwind v4 · Vitest

## Goal

Extend the personal, locally-run usage tracker with the best ideas from three peer tools (token-bleed, Claud-ometer, Grafana) while keeping the project's defensible core: **real quota/limit tracking across Claude + Codex, done correctly and tested.** This remains a local, read-only, no-upload personal tool — no npm publish, no public README, no OpenCode.

Strategic frame: _don't out-feature the competitors, out-correct them._ Deepen the quota/correctness moat first, then reach parity on the session-centric surface they have and we lack.

## Scope

### In scope (9 approved features)

**Phase 1 — Moat + cheap wins**

1. Quota forecasting
2. Quota-aware tips engine
3. Retention protection

**Phase 2 — Session surface**

- **6.** Sessions list page
- **7.** Session-detail replay (Claude + Codex)
- **8.** Compaction tracking (Claude only)

**Phase 3 — Compare + search**

- **9.** Session compare
- **10.** Model compare
- **11.** Full-text message search (Claude + Codex)

### Out of scope (explicitly cut)

- **CSV export** and **incremental-scan hardening** (dropped during brainstorming — current perf is adequate at personal scale).
- **OpenCode** as a third source (avoids the sqlite3-subprocess liability; can be a future phase).
- **npm/npx publishing**, public README, model bridge, cost-mode selector.
- Compaction tracking for Codex (no equivalent concept).

Feature numbering is kept from the brainstorming checklist (4 and 5 intentionally absent).

## Architecture principles

- The existing core stays framework-agnostic and untouched on its hot path: `parsers → normalize → aggregate → pricing → scan/cache`, with Astro routes + React islands on top.
- All new work is **additive**: new pure `lib` modules + new routes/components. The fast aggregate path that powers the current Overview must not get slower.
- **On-demand parsing** for anything message-level: session detail and search parse individual files when needed; there is no maintained global message index to invalidate.
- Honesty invariants carried forward: notional (API-rate) cost labeling on every new surface; Claude "no server-side limit" framing preserved; quota/forecast computed from **unfiltered** records regardless of the active tool/date filter.
- Correctness is the product: every new pure module ships with canonical-pinned tests asserting against literals, not the module's own formula.

## New `lib` modules (pure, tested)

| Module                               | Responsibility                                                                            | Feeds    |
| ------------------------------------ | ----------------------------------------------------------------------------------------- | -------- |
| `src/lib/sessions.ts`                | Group `UsageRecord[]` (from `scan()`) into `SessionSummary[]`. No new file reads.         | 6, 9, 10 |
| `src/lib/parsers/claude-messages.ts` | On-demand full parse of one Claude session file → `Message[]`; detect compaction markers. | 7, 8, 11 |
| `src/lib/parsers/codex-messages.ts`  | On-demand full parse of one Codex rollout file → `Message[]`.                             | 7, 11    |
| `src/lib/forecast.ts`                | Burn-rate projection over records + quota windows.                                        | 1, 2     |
| `src/lib/tips.ts`                    | Deterministic advisory rules over rollups + quota + forecast.                             | 2        |
| `src/lib/settings.ts`                | Read-only reader of `~/.claude/settings.json` (retention).                                | 3        |

## New data shapes (added to `src/lib/normalize.ts`)

```ts
type SessionSummary = {
  id: string;
  tool: "claude" | "codex";
  project: string;
  models: string[];
  startedAt: string; // ISO
  endedAt: string; // ISO
  durationMs: number;
  turns: number; // assistant turns
  toolCalls: number;
  tokens: {
    input: number;
    output: number;
    cacheWrite: number;
    cacheRead: number;
  };
  totalTokens: number;
  cost: number; // notional, API-rate
  unpriced: boolean;
  compaction?: { full: number; micro: number; tokensSaved: number }; // Claude only
};

type Message = {
  index: number;
  role: "user" | "assistant";
  text: string; // truncated in UI, full in payload
  toolUses: string[]; // tool names
  model?: string;
  tokens?: number;
  timestamp: string;
  compaction?: "full" | "micro"; // Claude only
};

type SessionDetail = { summary: SessionSummary; messages: Message[] };

type WindowForecast = {
  willExhaust: boolean;
  projectedPercentAtReset: number | null;
  etaToLimit: string | null; // ISO, null when N/A or insufficient data
};

type VolumeForecast = { projectedTokens: number | null; note: string };

type Forecast = {
  codexPrimary?: WindowForecast; // 5h
  codexSecondary?: WindowForecast; // weekly
  claudeFiveHour?: VolumeForecast;
  claudeSevenDay?: VolumeForecast;
};

type Tip = {
  id: string;
  severity: "info" | "warn";
  title: string;
  detail: string;
  savingsUsd?: number;
};
```

`scan()` gains a lightweight `sessionId → { file, tool }` index (built during the pass it already runs) so the detail route can locate a single file without re-listing.

## New routes / pages

| Path                 | Type                              | Notes                                                                 |
| -------------------- | --------------------------------- | --------------------------------------------------------------------- |
| `/sessions`          | SSR page → `SessionsList` island  | sortable, compaction-flagged, tool+date filter bar reused, search box |
| `/sessions/[id]`     | SSR page → `SessionDetail` island | on-demand parse of one file; replay + sidebar                         |
| `/compare`           | SSR page → `Compare` island       | two tabs: session-compare, model-compare                              |
| `/api/sessions`      | GET                               | `SessionSummary[]`, honors tool/date filters                          |
| `/api/sessions/[id]` | GET                               | `SessionDetail` (on-demand parse), 404 on missing/corrupt             |
| `/api/search?q=`     | GET                               | matching sessions + snippet; tolerant, bounded                        |

Existing `/api/usage` and `/api/refresh` are unchanged. `Layout.astro` gains a small top nav (Overview / Sessions / Compare). `QuotaPanel` gains a forecast line; a new `Tips` component renders on the Overview.

Retention is a **local script**, not a server endpoint: `scripts/fix-retention.mjs` + a `package.json` script. The dashboard only warns (read-only `settings.ts`); it never mutates settings.

## Feature behavior

### 1 · Quota forecasting (`forecast.ts`)

- **Codex:** from the latest snapshot's `used_percent`, `resets_at`, `window_minutes`, compute elapsed fraction of the window and linearly project end-of-window percent: `projected = used_percent / elapsedFraction`. `willExhaust = projected >= 100`; `etaToLimit` = timestamp when the linear projection crosses 100. Uses only server-authoritative fields — no token→percent mapping.
- **Claude:** no server limit exists, so forecast projects rolling **volume** (tokens/hour over recent activity → 5h and 7d projections), labeled "no limit — volume projection."
- Insufficient data (e.g., `elapsedFraction ≈ 0` right after reset) → `null` fields. Never fabricates a number.
- Computed from **unfiltered** records (matches the existing `claudeWindows`/`codexQuota` invariant).

### 2 · Tips engine (`tips.ts`)

Deterministic rules → `Tip[]` shown as cards on the Overview:

- `approaching-limit` — from forecast: Codex projected `>=` a threshold (e.g. 85%) before reset. _(Unique to us.)_
- `low-cache` — cache-read share of Claude prompt tokens (all recorded activity) below a threshold; deterministic, no time window.
- `right-size-model` — expensive-model sessions with short outputs; `savingsUsd` = re-price the same usage at the sonnet-equivalent rate.
- `unpriced-present` — one or more models rendered with `unpriced` (cost gaps are visible).

### 3 · Retention protection

- `scripts/fix-retention.mjs`: safe read-modify-write of `~/.claude/settings.json` — raises `cleanupPeriodDays` to a high value, **preserves all other keys**, idempotent, prints before/after. Aborts without writing on a parse error (no data loss). Creates a minimal file if none exists.
- `settings.ts:getRetention()` (read-only) backs a dashboard banner that warns when `cleanupPeriodDays` is short and instructs the user to run `npm run fix-retention`.

### 6 · Sessions list

- `scan()` records grouped by `sessionId` via `sessions.ts`. Turn/tool counts and compaction counts are computed **inside the existing mtime-cached parse pass** (paid once per changed file), so the list stays cheap.
- Columns: project·tool, models, started (relative), duration, turns, tokens, cost, compaction badge (amber when `> 0`). Sortable. Reuses the dashboard's tool+date filter bar.

### 7 · Session detail (Claude + Codex)

- Route resolves `sessionId → file` from the scan index, then parses that one file on demand with the matching message parser → `SessionDetail`.
- Renders conversation replay (user prompts + assistant text with expand, `tool_use` badges, per-message model + tokens) and a sidebar (token breakdown, tools used, metadata, Claude compaction timeline).

### 8 · Compaction tracking (Claude only)

- The Claude message parser detects full-compaction and micro-compaction markers, counts them, and sums `tokensSaved`. Surfaced as the list amber flag, the detail timeline, and the summary `compaction` field. Codex sessions carry no compaction data.

### 9 · Session compare

- `/compare` session tab: two session pickers → side-by-side `SessionSummary` diff (tokens, cost, cache-hit, tool calls, duration).

### 10 · Model compare

- `/compare` model tab: two model pickers → aggregated diff (input/output tokens, cache-hit rate, cost, avg-per-session). May add a small per-model session-average helper to `aggregate.ts`.

### 11 · Full-text search (Claude + Codex)

- `/api/search?q=` runs the message parsers across session files (case-insensitive substring), collecting sessions with matching message text + a snippet. Tolerant (skips unreadable files), bounded (result/scan cap). `?q=` synced on `/sessions`.

## Error handling

- **Session detail:** missing / vanished / corrupt file → graceful 404 page; bad JSONL lines swallowed (existing philosophy).
- **Search:** per-file tolerant, bounded, returns partial results rather than failing.
- **Forecast:** divide-by-zero and insufficient-data guards → `null`; never fabricates.
- **Retention script:** aborts without writing on parse error; preserves unknown keys; idempotent.
- **Invariant preserved:** forecast/quota computed from unfiltered records even under an active filter.

## Testing (non-negotiable — the moat)

Canonical-pinned Vitest for every new module, asserting against literals (not the module's own formula):

- `forecast.test.ts` — Codex projection math, `willExhaust`/`etaToLimit`, divide-by-zero → null, Claude volume projection.
- `tips.test.ts` — each rule fires/doesn't on fixtures; `savingsUsd` math pinned.
- `sessions.test.ts` — grouping → summaries (turns, duration, tokens, cost, compaction counts) pinned.
- `parsers/claude-messages.test.ts` + `parsers/codex-messages.test.ts` — new fixtures including a compaction fixture (full + micro), tool_use extraction, truncation.
- `settings.test.ts` — retention read; read-modify-write preserves other keys.
- search match function — unit test over fixtures.

New fixtures live under `src/lib/parsers/__fixtures__/` alongside the existing ones and are real-derived, covering every real line-type variety (multi-session rollouts, split-`message.id` turns, injected/synthetic context, compaction markers), not single-record stubs. Structural fidelity, not raw line count, is the bar.

## Phasing

Each phase is independently shippable and testable.

1. **Phase 1 (moat + cheap wins):** `forecast.ts`, `tips.ts`, `settings.ts` + `scripts/fix-retention.mjs`, QuotaPanel forecast line, Overview Tips + retention banner. No new page architecture.
2. **Phase 2 (session surface):** scan `sessionId → file` index + session-meta enrichment, `sessions.ts`, both message parsers, `/sessions`, `/sessions/[id]`, compaction.
3. **Phase 3 (compare + search):** `/compare` (session + model tabs), `/api/search`, search box wiring.

## Open questions

None. All scope, tool coverage, and cut decisions were resolved during brainstorming.
