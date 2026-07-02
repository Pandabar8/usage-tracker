# Usage Tracker — UI Overhaul — Design

**Date:** 2026-07-01
**Status:** Approved (via `dashboard-redesign-mockup.html`), pending implementation plan
**Stack:** Astro 5 SSR · React 19 islands · Recharts + custom SVG · Tailwind v4 · Vitest 3

## Goal

A refined-dark visual overhaul of the existing dashboard: a persistent left sidebar with global filters and grouped navigation, elevated cards, and five new/upgraded visualizations. The functional data (Phases 1-3) is unchanged; this is presentation + a few small pure aggregators. Approved direction is the committed mockup — treat it as the visual source of truth.

## Global constraints

- Local-only, read-only, no-upload; Claude + Codex only.
- Notional API-rate cost labeling preserved; Claude "no server-side limit" honesty preserved (its 5h/weekly bars are token volume, never a fabricated percent).
- New aggregators get canonical-pinned Vitest tests (assert literals, not the SUT's own formula).
- No new runtime dependencies beyond what exists (Recharts already present); custom SVG for heatmap/treemap/gauge/sparkline.
- The retention banner is removed (a one-time `npm run fix-retention` replaces the nag; the `RetentionBanner` component and its Overview usage are deleted).

## Theme tokens (Tailwind v4, in `src/styles/global.css` + `Layout.astro`)

CSS custom properties, dark:

- `--bg:#0a0c10` · `--panel:#12151b` · `--panel-2:#171b22` · `--panel-3:#1c2129`
- `--line:rgba(233,238,246,.07)` · `--line-2:rgba(233,238,246,.13)`
- `--ink:#e8ecf2` · `--muted:#98a2b3` · `--faint:#5c6675`
- **Claude:** `--claude:#e88a4e` (orange), `--claude-2:#c56a2e`
- **Codex:** `--codex:#a486f7` (purple), `--codex-2:#7c5fd6`
- Neutral UI accent: `--primary:#4ac0e0` (cyan — nav active, logo, peak-hours bars only; not an agent color)
- `--mint:#4fd6a8` (cache gauge / positive) · `--warn:#f5a524` · `--danger:#ff6b6b`
- Fonts: **Inter** (UI) + **JetBrains Mono** (all numbers/data). Radius `14px`.

Model palette (donut): Claude models are orange shades (`opus #e88a4e`, `sonnet #f2ad76`, `haiku #b5652b`); Codex is `#a486f7`.

## Layout — `AppShell` (new)

`src/layouts/Layout.astro` becomes a two-column shell: sticky 248px sidebar + scrolling main.

**Sidebar (`src/components/Sidebar.tsx` island):**

- Brand (logo mark + "Usage Tracker" + version chip).
- **Global filter block** — agent segmented control (All/Claude/Codex) + range chips (7d/30d/90d/All). This is the single source of the tool/date filter; it drives URL params (`?tool=&from=&to=`) and the pages read them. Replaces the inline filter bar currently inside `Dashboard.tsx`/`FilterBar.tsx` (FilterBar's markup is reused inside the sidebar).
- **Nav**, grouped: Core (Overview, Sessions, Compare), Analyze (Costs, Activity), System (Settings — stub route in v1).
- Bottom: quota mini-indicator (Codex 5h + weekly %) + "local · read-only · no upload" badge.

Active-link state derived from `Astro.url.pathname`.

## Pages

- **Overview (`/`)** — the rich summary exactly as mocked: stat cards + sparklines, usage trend, model donut + cache gauge, activity heatmap, cost-by-project treemap, peak-hours, limits & forecast, tips.
- **Costs (`/costs`)** — dedicated: larger cost treemap, cost-over-time (stacked by model), per-model cost table, cache-savings. Reuses Overview components at larger scale.
- **Activity (`/activity`)** — dedicated: full 52-week heatmap, peak-hours, simple streak/summary stats.
- **Sessions / Compare** — existing pages, restyled to the new theme (no structural change).
- **Settings (`/settings`)** — v1 stub (theme note + retention status read-only); real controls deferred.

## Components (React islands + pure render)

| Component                                     | Source data                                               | Notes                                                                         |
| --------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `StatCard`                                    | `byDay` per-metric series                                 | value + delta + inline sparkline (custom SVG)                                 |
| `UsageTrend` (restyle existing `TrendChart`)  | `byDay`                                                   | Recharts area, Claude orange / Codex purple, tokens/cost toggle               |
| `ModelDonut`                                  | `byModel`                                                 | custom SVG donut, orange-shade Claude + purple Codex                          |
| `CacheGauge`                                  | global cache-hit-rate                                     | custom SVG radial                                                             |
| `ActivityHeatmap`                             | daily per-agent tokens (`byDay.claudeTokens/codexTokens`) | calendar grid, per-day RGB blend orange↔purple                                |
| `CostTreemap`                                 | `byProject` cost                                          | squarified-ish CSS grid; color = dominant agent                               |
| `PeakHours`                                   | new `peakHours` aggregate                                 | 24-bar histogram                                                              |
| `LimitsPanel` (restyle existing `QuotaPanel`) | `codexQuota` + `claudeWindows`                            | grouped by agent, **5h + weekly for both**; Codex = server %, Claude = volume |
| `Tips` (existing)                             | `tips`                                                    | restyle only                                                                  |

## New aggregators (`src/lib/aggregate.ts` or `src/lib/charts.ts`) — tested

- `peakHours(records: UsageRecord[]): number[]` — length-24 array; index = hour-of-day (local) of each record's timestamp; value = assistant-turn count (record count) in that hour. Canonical-pinned test with fixed timestamps across hours.
- `calendarGrid(byDay, nowMs): { date, claudeTokens, codexTokens, total }[]` — fills missing days over the window so the heatmap has a continuous grid; test gap-filling + ordering.
- Reuse existing: `byDay` (trend, sparklines, heatmap source), `byModel` (donut), `byProject` cost (treemap), `cacheHitRate` (gauge), `claudeWindows` + `codexQuota` (limits). If a global cache-hit-rate for the gauge isn't already exposed on `Rollups`, add `cacheHitRate` to the aggregate output and pin it.

No change to token/cost math or the Phase 1-3 parsers.

## Data flow

`index.astro` (and `/costs`, `/activity`) SSR-call `scan()` + `aggregate()` (+ `peakHours`, `calendarGrid`) and pass rollups to the islands as today. The sidebar filter writes URL params; pages read `Astro.url.searchParams` for SSR and the islands re-fetch `/api/usage` on change (existing pattern, lifted out of `Dashboard.tsx` into the shell). `/api/usage` already honors `tool/from/to`.

## Testing & verification

- Canonical-pinned Vitest for `peakHours` and `calendarGrid` (+ `cacheHitRate` if newly exposed).
- `npm run build` clean; full suite green.
- **Render proof** (this is visual work): drive the built server / dev app and confirm each new surface paints with real data — sidebar + active state, sparklines, donut, cache gauge, heatmap blend, treemap, peak-hours, and the 5h+weekly limits for both agents. A green build is not sufficient for paint.

## Out of scope (v1)

Settings controls, command palette, light theme, cross-tool cost normalization, mobile-first layout (desktop-first; sidebar collapses under 1080px is a nice-to-have, not required).

## Process note

This is presentational + small pure aggregators (no auth/money/migrations/parser-correctness change). The correctness-sensitive backend already passed the Codex plan gate. This overhaul is verified via canonical-pinned aggregator tests + real-data render proof rather than another multi-round gate; a single sanity pass on the plan is optional.
