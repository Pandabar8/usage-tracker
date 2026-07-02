# Usage Tracker UI Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-column dashboard with a refined-dark two-column shell (persistent sidebar + scrolling main), restyle every existing surface to agent-coded colors, and add five new visualizations plus dedicated Costs / Activity / Settings pages, all backed by three new canonical-pinned pure aggregators.

**Architecture:** Presentation-only overhaul plus three small pure aggregators. The correctness-sensitive parser/token/cost math (Phases 1-3) is untouched. Aggregators (`peakHours`, `calendarGrid`, and a global `cacheHitRate` on `Rollups`) get full TDD with literal-pinned Vitest. React islands, the Astro layout, and CSS are build-gated (`npm run build` must print `Complete!`) and render-verified (curl the built SSR server and grep for expected markup, then eyeball paint). The sidebar owns the single global tool/date filter; it writes URL params (`?tool=&from=&to=`) and broadcasts a `window` CustomEvent that page-content islands listen for to re-fetch `/api/usage`; SSR pages read `Astro.url.searchParams` for first paint.

**Tech Stack:** Astro 5 SSR, React 19 islands (`client:load`), Recharts 2 (already a dependency), custom inline SVG for donut/gauge/heatmap/treemap/sparkline/peak-hours, Tailwind v4 plus a ported design-system stylesheet, Vitest 3.

## Global Constraints

Every task's requirements implicitly include this section.

- **Local-only, read-only, no-upload.** No network calls off-machine; the tool only reads `~/.claude` and `~/.codex` via the existing `scan()`.
- **Claude + Codex only.** No third agent.
- **Notional cost honesty.** Cost labels stay "notional / at API rates". Claude has **no server-side limit**: its 5h/weekly bars are token **volume** (never a fabricated percent). Codex percentages are server-reported.
- **Canonical-pinned tests.** New aggregators assert against numeric/string literals, never against the SUT's own formula.
- **No new runtime dependencies** beyond what exists. Recharts is already present; everything else is custom SVG/CSS. Do not add packages.
- **Fonts:** **Inter** (UI) + **JetBrains Mono** (all numbers/data), loaded via Google Fonts `@import` in `global.css`. Radius token `14px`.
- **Theme tokens (exact hex, dark), verbatim:**
  - `--bg:#0a0c10` · `--panel:#12151b` · `--panel-2:#171b22` · `--panel-3:#1c2129`
  - `--line:rgba(233,238,246,.07)` · `--line-2:rgba(233,238,246,.13)`
  - `--ink:#e8ecf2` · `--muted:#98a2b3` · `--faint:#5c6675`
  - Claude: `--claude:#e88a4e` · `--claude-2:#c56a2e`
  - Codex: `--codex:#a486f7` · `--codex-2:#7c5fd6`
  - Neutral UI accent: `--primary:#4ac0e0` (cyan — nav active, logo, peak-hours bars only; not an agent color)
  - `--mint:#4fd6a8` · `--warn:#f5a524` · `--danger:#ff6b6b`
  - Model-donut palette: opus `#e88a4e`, sonnet `#f2ad76`, haiku `#b5652b`, other-Claude `#c56a2e`, Codex `#a486f7`.
- **Retention banner REMOVED.** The `RetentionBanner` component and its usage are deleted; the one-time `npm run fix-retention` script replaces the nag. Retention status is shown read-only on `/settings`.
- **Commit style:** plain product Conventional Commits (`feat(ui)`, `feat(lib)`, `refactor(ui)`, `test(lib)`). Product-domain "Claude"/"Codex" are fine. No tooling/process/attribution words in commit bodies or code.

### Render-check recipe (used by every build-gated task)

After `npm run build` prints `Complete!`, start the built SSR server and curl the route:

```bash
npm run build            # expect final line: [build] Complete!
(PORT=4321 HOST=127.0.0.1 node ./dist/server/entry.mjs &) ; sleep 1.5
curl -s http://127.0.0.1:4321<ROUTE> | grep -F "<GREP TOKEN>" && echo RENDER_OK
pkill -f dist/server/entry.mjs
```

Each build-gated task names its exact `<ROUTE>` and `<GREP TOKEN>`. A passing grep is necessary but **not** sufficient: also open the route in `npm run dev` (http://localhost:4321) and confirm the surface actually paints (colors, layout, SVG shapes) — a green build never proves paint.

---

## File Structure

**Create:**

- `src/lib/charts.ts` — pure aggregators `peakHours`, `calendarGrid`, `CalendarDay`, `BoardData`.
- `src/lib/charts.test.ts` — canonical-pinned tests for the above.
- `src/lib/format.ts` — shared `fmtTokens` / `fmtCompact` / `fmtUsd`.
- `src/lib/filter-bus.ts` — client-side filter state read/write + `usage:filter` CustomEvent bus.
- `src/components/Sidebar.tsx` — brand, global filter, grouped nav, quota mini, local badge.
- `src/components/StatCard.tsx` — value + delta + inline SVG sparkline.
- `src/components/ModelDonut.tsx` — custom SVG donut over `byModel`.
- `src/components/CacheGauge.tsx` — custom SVG radial gauge.
- `src/components/ActivityHeatmap.tsx` — calendar heatmap with per-day orange↔purple blend.
- `src/components/CostTreemap.tsx` — CSS-grid treemap over `byProject` cost.
- `src/components/PeakHours.tsx` — 24-bar histogram.
- `src/components/OverviewBoard.tsx` — Overview page island (composes everything, owns refetch).
- `src/components/CostsBoard.tsx` — Costs page island.
- `src/components/ActivityBoard.tsx` — Activity page island.
- `src/pages/costs.astro`, `src/pages/activity.astro`, `src/pages/settings.astro`.

**Modify:**

- `src/styles/global.css` — ported design-system stylesheet + tokens + font import.
- `src/layouts/Layout.astro` — two-column AppShell mounting `Sidebar`.
- `src/lib/aggregate.ts` — add global `cacheHitRate` field to `Rollups`.
- `src/lib/aggregate.test.ts` — pin the new `cacheHitRate` field.
- `src/pages/api/usage.ts` — return `peakHours` + `calendar`.
- `src/components/Overview.tsx` — render 4 `StatCard`s.
- `src/components/TrendChart.tsx` → rename to `src/components/UsageTrend.tsx` — agent colors + `initialMetric` prop.
- `src/components/QuotaPanel.tsx` → rename to `src/components/LimitsPanel.tsx` — grouped by agent, 5h+weekly for both.
- `src/components/Tips.tsx` — restyle to `.tips`/`.tip` classes.
- `src/components/ByModel.tsx`, `src/components/ByProject.tsx` — restyle to `.card` + agent colors.
- `src/pages/index.astro` — SSR filter + `peakHours`/`calendarGrid`, render `OverviewBoard`.

**Delete:**

- `src/components/Dashboard.tsx` (superseded by `OverviewBoard` + `Sidebar`).
- `src/components/RetentionBanner.tsx` (nag removed).

**Leave untouched:** `src/components/FilterBar.tsx` (still imported by `SessionsList.tsx`), `src/pages/sessions/*`, `src/pages/compare.astro`, all `src/lib/parsers/*`, `scan`, `pricing`, `forecast`, `tips`, `settings`.

---

### Task 1: Design-system stylesheet + theme tokens + fonts

**Files:**

- Modify: `src/styles/global.css`

**Interfaces:**

- Produces: CSS custom properties and design-system classes (`.app`, `aside`, `.brand`, `.logo`, `.filters`, `.seg`, `.chips`, `nav`, `.navsec`, `.side-quota`, `.bar`, `.side-foot`, `.dot`, `main`, `.top`, `.btn`, `.grid`, `.cards4`, `.c2`, `.c2b`, `.card`, `.toggle`, `.stat`, `.delta`, `.up`, `.down`, `.spark`, `.legend`, `.sw`, `.donutwrap`, `.metrics`, `.gaugewrap`, `.heat`, `.heatcol`, `.cell`, `.heatscale`, `.tree`, `.tile`, `.bars`, `.axis`, `.qgroup`, `.qhead`, `.qrow`, `.qlab`, `.qbar`, `.qmeta`, `.forecast`, `.note`, `.tips`, `.tip`, `.sectitle`, `.mono`) consumed by all later island tasks.

- [ ] **Step 1: Replace `src/styles/global.css` with the ported mockup stylesheet**

Keep the Tailwind import first, add the font import, then paste the mockup `<style>` body verbatim (this is the approved visual source of truth — copy exact hex values and class rules):

```css
@import "tailwindcss";
@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap");

:root {
  --bg: #0a0c10;
  --panel: #12151b;
  --panel-2: #171b22;
  --panel-3: #1c2129;
  --line: rgba(233, 238, 246, 0.07);
  --line-2: rgba(233, 238, 246, 0.13);
  --ink: #e8ecf2;
  --muted: #98a2b3;
  --faint: #5c6675;
  --claude: #e88a4e;
  --claude-2: #c56a2e;
  --codex: #a486f7;
  --codex-2: #7c5fd6;
  --primary: #4ac0e0;
  --mint: #4fd6a8;
  --warn: #f5a524;
  --danger: #ff6b6b;
  --sans: "Inter", system-ui, sans-serif;
  --mono: "JetBrains Mono", ui-monospace, monospace;
  --r: 14px;
}
* {
  box-sizing: border-box;
}
html {
  -webkit-font-smoothing: antialiased;
}
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-family: var(--sans);
  font-size: 14px;
  line-height: 1.5;
  letter-spacing: -0.005em;
  background-image:
    radial-gradient(1100px 600px at 80% -10%, #a486f70e, transparent 60%),
    radial-gradient(900px 500px at 0% 8%, #e88a4e0b, transparent 55%);
}
::selection {
  background: var(--claude);
  color: #1a0d03;
}
.mono {
  font-family: var(--mono);
  font-variant-numeric: tabular-nums;
}
.app {
  display: grid;
  grid-template-columns: 248px 1fr;
  min-height: 100vh;
}

aside {
  position: sticky;
  top: 0;
  height: 100vh;
  border-right: 1px solid var(--line);
  background: linear-gradient(180deg, #12151b, #0e1116);
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 18px 14px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px 14px;
}
.logo {
  width: 30px;
  height: 30px;
  border-radius: 9px;
  background: linear-gradient(145deg, var(--claude), var(--codex));
  display: grid;
  place-items: center;
  box-shadow: 0 4px 14px #a486f733;
}
.logo svg {
  width: 17px;
  height: 17px;
  color: #160b04;
}
.brand b {
  font-size: 14.5px;
  letter-spacing: -0.02em;
}
.brand .v {
  font-family: var(--mono);
  font-size: 9.5px;
  color: var(--faint);
  border: 1px solid var(--line-2);
  border-radius: 5px;
  padding: 1px 5px;
  margin-left: auto;
}

.filters {
  background: var(--panel-2);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 11px;
  margin-bottom: 6px;
}
.filters .lbl {
  font-family: var(--mono);
  font-size: 9.5px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--faint);
  margin: 0 0 7px;
}
.seg {
  display: flex;
  background: #0c0f14;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 2px;
  gap: 2px;
  margin-bottom: 9px;
}
.seg button {
  flex: 1;
  font-family: var(--mono);
  font-size: 11px;
  padding: 5px 0;
  border: 0;
  background: transparent;
  color: var(--muted);
  border-radius: 6px;
  cursor: pointer;
}
.seg button.on {
  background: var(--panel-3);
  color: var(--ink);
  box-shadow: 0 1px 0 #ffffff10 inset;
}
.chips {
  display: flex;
  gap: 5px;
}
.chips button {
  flex: 1;
  font-family: var(--mono);
  font-size: 10.5px;
  padding: 5px 0;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--muted);
  border-radius: 6px;
  cursor: pointer;
}
.chips button.on {
  border-color: var(--primary);
  color: var(--primary);
  background: #4ac0e012;
}

nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 4px;
}
nav a {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 9px 10px;
  border-radius: 9px;
  color: var(--muted);
  text-decoration: none;
  font-weight: 500;
  font-size: 13.5px;
  transition: 0.15s;
}
nav a svg {
  width: 17px;
  height: 17px;
  opacity: 0.8;
}
nav a:hover {
  background: #ffffff06;
  color: var(--ink);
}
nav a.active {
  background: linear-gradient(90deg, #e88a4e1c, transparent);
  color: var(--ink);
  box-shadow: inset 2px 0 0 var(--claude);
}
nav a.active svg {
  color: var(--claude);
  opacity: 1;
}
.navsec {
  font-family: var(--mono);
  font-size: 9px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--faint);
  padding: 14px 10px 5px;
}

.side-quota {
  margin-top: auto;
  background: var(--panel-2);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 12px;
}
.side-quota .row {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--muted);
  margin-bottom: 6px;
}
.side-quota .row b {
  color: var(--ink);
}
.bar {
  height: 6px;
  border-radius: 4px;
  background: #0c0f14;
  overflow: hidden;
}
.bar i {
  display: block;
  height: 100%;
  border-radius: 4px;
}
.side-foot {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: var(--mono);
  font-size: 9.5px;
  color: var(--faint);
  margin-top: 12px;
  padding-left: 2px;
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--mint);
  box-shadow: 0 0 8px var(--mint);
}

main {
  padding: 22px 26px 60px;
  max-width: 1280px;
}
.top {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-bottom: 22px;
  gap: 16px;
}
.top h1 {
  margin: 0;
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.03em;
}
.top .sub {
  color: var(--muted);
  font-size: 12.5px;
  margin-top: 3px;
}
.top .sub .mono {
  color: var(--faint);
}
.btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
  padding: 8px 13px;
  border: 1px solid var(--line-2);
  border-radius: 9px;
  background: var(--panel-2);
  color: var(--ink);
  cursor: pointer;
}
.btn svg {
  width: 14px;
  height: 14px;
  color: var(--muted);
}

.grid {
  display: grid;
  gap: 16px;
}
.cards4 {
  grid-template-columns: repeat(4, 1fr);
}
.c2 {
  grid-template-columns: 2fr 1fr;
}
.c2b {
  grid-template-columns: 1.4fr 1fr;
}
@media (max-width: 1080px) {
  .cards4 {
    grid-template-columns: repeat(2, 1fr);
  }
  .c2,
  .c2b {
    grid-template-columns: 1fr;
  }
}

.card {
  background: linear-gradient(180deg, #ffffff05, transparent 22%), var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--r);
  padding: 16px 17px;
  position: relative;
}
.card h3 {
  margin: 0 0 2px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
}
.card .hint {
  font-size: 11px;
  color: var(--faint);
  margin: 0 0 14px;
}
.card .head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.card .head h3 {
  margin: 0;
}
.toggle {
  display: flex;
  background: #0c0f14;
  border: 1px solid var(--line);
  border-radius: 7px;
  padding: 2px;
}
.toggle button {
  font-family: var(--mono);
  font-size: 10px;
  padding: 3px 9px;
  border: 0;
  background: transparent;
  color: var(--muted);
  border-radius: 5px;
  cursor: pointer;
}
.toggle button.on {
  background: var(--panel-3);
  color: var(--ink);
}

.stat .k {
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--faint);
}
.stat .v {
  font-family: var(--mono);
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.02em;
  margin: 6px 0 2px;
}
.stat .foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.delta {
  font-family: var(--mono);
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 5px;
}
.up {
  color: var(--mint);
  background: #4fd6a815;
}
.down {
  color: var(--danger);
  background: #ff6b6b15;
}
.spark {
  height: 30px;
  width: 96px;
}

.legend {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  margin-top: 12px;
  font-size: 11.5px;
  color: var(--muted);
}
.legend span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.sw {
  width: 9px;
  height: 9px;
  border-radius: 3px;
  display: inline-block;
}

.donutwrap {
  display: flex;
  align-items: center;
  gap: 18px;
}
.metrics {
  display: flex;
  flex-direction: column;
  gap: 9px;
  flex: 1;
}
.metrics .m {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
}
.metrics .m .nm {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--muted);
}
.metrics .m .val {
  font-family: var(--mono);
  color: var(--ink);
}
.gaugewrap {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 6px;
  padding-top: 14px;
  border-top: 1px solid var(--line);
}
.gaugewrap .txt .big {
  font-family: var(--mono);
  font-size: 22px;
  font-weight: 700;
  color: var(--mint);
}
.gaugewrap .txt .lbl {
  font-size: 11px;
  color: var(--muted);
}

.heat {
  display: flex;
  gap: 3px;
  overflow-x: auto;
  padding-bottom: 4px;
}
.heatcol {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.cell {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  background: #0e1218;
}
.heatscale {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10.5px;
  color: var(--faint);
  margin-top: 10px;
  font-family: var(--mono);
}

.tree {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  grid-auto-rows: 34px;
  gap: 6px;
  grid-auto-flow: dense;
}
.tile {
  border-radius: 8px;
  padding: 8px 10px;
  overflow: hidden;
  position: relative;
  border: 1px solid #ffffff10;
}
.tile .tn {
  font-size: 11px;
  font-weight: 600;
  color: #160b04;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tile .tv {
  font-family: var(--mono);
  font-size: 10px;
  color: #160b04cc;
}

.bars {
  display: flex;
  align-items: flex-end;
  gap: 3px;
  height: 120px;
}
.bars .b {
  flex: 1;
  background: linear-gradient(180deg, var(--primary), #4ac0e055);
  border-radius: 3px 3px 0 0;
  min-height: 3px;
}
.axis {
  display: flex;
  justify-content: space-between;
  font-family: var(--mono);
  font-size: 9px;
  color: var(--faint);
  margin-top: 6px;
}

.qgroup {
  margin-bottom: 16px;
}
.qgroup:last-of-type {
  margin-bottom: 0;
}
.qhead {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  font-weight: 600;
  margin-bottom: 11px;
}
.qhead .qsub {
  font-weight: 400;
  font-size: 11px;
  color: var(--faint);
}
.qrow {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 9px;
}
.qrow .qlab {
  width: 96px;
  font-size: 12px;
  color: var(--muted);
}
.qrow .qbar {
  flex: 1;
}
.qrow .qmeta {
  font-family: var(--mono);
  font-size: 10.5px;
  color: var(--faint);
  width: 150px;
  text-align: right;
}
.forecast {
  font-family: var(--mono);
  font-size: 10.5px;
  color: var(--warn);
  margin: 2px 0 0 108px;
}
.note {
  font-size: 11px;
  color: var(--faint);
  border-left: 2px solid var(--line-2);
  padding-left: 9px;
  margin-top: 14px;
}

.tips {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}
@media (max-width: 1080px) {
  .tips {
    grid-template-columns: 1fr;
  }
}
.tip {
  background: var(--panel-2);
  border: 1px solid var(--line);
  border-left: 3px solid var(--primary);
  border-radius: 10px;
  padding: 12px 13px;
}
.tip.warn {
  border-left-color: var(--warn);
}
.tip .tt {
  font-size: 12.5px;
  font-weight: 600;
  margin: 0 0 4px;
}
.tip .td {
  font-size: 11.5px;
  color: var(--muted);
  margin: 0;
}
.tip .save {
  font-family: var(--mono);
  font-size: 10.5px;
  color: var(--mint);
  background: #4fd6a815;
  border-radius: 5px;
  padding: 2px 6px;
  display: inline-block;
  margin-top: 8px;
}

.sectitle {
  font-family: var(--mono);
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--faint);
  margin: 26px 2px 4px;
}
```

- [ ] **Step 2: Build gate**

Run: `npm run build`
Expected: final line `[build] Complete!` (no CSS/parse errors).

- [ ] **Step 3: Render-check (existing route still styles)**

Use the render-check recipe. `<ROUTE>` = `/`, `<GREP TOKEN>` = `--claude:#e88a4e`.
Expected: `RENDER_OK` (the token block is inlined into the built CSS). Also open `npm run dev` at `/` and confirm the background is near-black `#0a0c10` with the two faint radial gradients.

- [ ] **Step 4: Commit**

```bash
git add src/styles/global.css && git commit -m "feat(ui): add refined-dark theme tokens, fonts, and design-system stylesheet"
```

---

### Task 2: `peakHours` aggregator (TDD)

**Files:**

- Create: `src/lib/charts.ts`
- Create: `src/lib/charts.test.ts`

**Interfaces:**

- Consumes: `UsageRecord` from `./normalize`.
- Produces: `export function peakHours(records: UsageRecord[]): number[]` — length-24 array; index = local hour-of-day (`Date#getHours`) of each record's timestamp; value = record (assistant-turn) count in that hour. Records with missing/malformed timestamps are skipped.

- [ ] **Step 1: Write the failing test**

Fixtures use timestamps **without** a `Z`/offset so they parse as local wall-clock, making `getHours()` deterministic across runner time zones.

```ts
// src/lib/charts.test.ts
import { describe, it, expect } from "vitest";
import { peakHours } from "./charts";
import type { UsageRecord } from "./normalize";

function rec(p: Partial<UsageRecord>): UsageRecord {
  return {
    tool: "claude",
    timestamp: "2026-06-01T00:15:00",
    model: "claude-opus-4-8",
    project: "ProjA",
    sessionId: "s",
    inputTokens: 0,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    reasoningTokens: 0,
    ...p,
  };
}

describe("peakHours", () => {
  it("counts records per local hour-of-day across a length-24 array", () => {
    const records = [
      rec({ tool: "claude", timestamp: "2026-06-01T00:15:00" }),
      rec({ tool: "claude", timestamp: "2026-06-01T03:00:00" }),
      rec({ tool: "codex", timestamp: "2026-06-02T03:59:00" }),
      rec({ tool: "claude", timestamp: "2026-06-01T14:30:00" }),
      rec({ tool: "codex", timestamp: "2026-06-03T23:00:00" }),
      rec({ tool: "claude", timestamp: "not-a-date" }),
    ];
    const h = peakHours(records);
    expect(h).toEqual([
      1, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    ]);
    expect(h).toHaveLength(24);
  });

  it("returns a length-24 zero array for no records", () => {
    expect(peakHours([])).toEqual(new Array(24).fill(0));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/charts.test.ts`
Expected: FAIL — `peakHours is not a function` (module has no export yet).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/charts.ts
import type { UsageRecord } from "./normalize";

// Length-24 histogram of records by local hour-of-day. Assistant-turn count =
// record count; tool-agnostic. Records without a parseable timestamp are skipped.
export function peakHours(records: UsageRecord[]): number[] {
  const hours = new Array<number>(24).fill(0);
  for (const r of records) {
    if (!r.timestamp) continue;
    const t = new Date(r.timestamp);
    if (Number.isNaN(t.getTime())) continue;
    hours[t.getHours()] += 1;
  }
  return hours;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/charts.test.ts`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add src/lib/charts.ts src/lib/charts.test.ts && git commit -m "feat(lib): add peak-hours histogram aggregator"
```

---

### Task 3: `calendarGrid` aggregator (TDD)

**Files:**

- Modify: `src/lib/charts.ts`
- Modify: `src/lib/charts.test.ts`

**Interfaces:**

- Consumes: `DayPoint` from `./aggregate`.
- Produces:
  - `export interface CalendarDay { date: string; claudeTokens: number; codexTokens: number; total: number; }`
  - `export function calendarGrid(byDay: DayPoint[], nowMs: number): CalendarDay[]` — fills every missing calendar day (UTC) from the earliest `byDay.date` through the later of the last `byDay.date` and the UTC date of `nowMs`; ascending; missing days are zero-filled; `[]` when `byDay` is empty.

- [ ] **Step 1: Add the failing tests**

Dates are derived via `toISOString().slice(0,10)` (UTC), matching how `aggregate()` keys `byDay` from `timestamp.slice(0,10)`, so the test is timezone-independent.

```ts
// append to src/lib/charts.test.ts
import { calendarGrid } from "./charts";
import type { DayPoint } from "./aggregate";

function day(p: Partial<DayPoint>): DayPoint {
  return {
    date: "2026-06-01",
    claudeTokens: 0,
    codexTokens: 0,
    claudeCost: 0,
    codexCost: 0,
    ...p,
  };
}

describe("calendarGrid", () => {
  it("gap-fills missing days and orders ascending, ending at last data day", () => {
    const byDay = [
      day({ date: "2026-06-03", codexTokens: 50 }),
      day({ date: "2026-06-01", claudeTokens: 100 }),
    ];
    const now = Date.parse("2026-06-03T12:00:00.000Z");
    expect(calendarGrid(byDay, now)).toEqual([
      { date: "2026-06-01", claudeTokens: 100, codexTokens: 0, total: 100 },
      { date: "2026-06-02", claudeTokens: 0, codexTokens: 0, total: 0 },
      { date: "2026-06-03", claudeTokens: 0, codexTokens: 50, total: 50 },
    ]);
  });

  it("extends the grid to the UTC date of nowMs when it is past the last data day", () => {
    const byDay = [day({ date: "2026-06-01", claudeTokens: 10 })];
    const now = Date.parse("2026-06-04T00:00:00.000Z");
    const grid = calendarGrid(byDay, now);
    expect(grid.map((d) => d.date)).toEqual([
      "2026-06-01",
      "2026-06-02",
      "2026-06-03",
      "2026-06-04",
    ]);
    expect(grid[0]).toEqual({
      date: "2026-06-01",
      claudeTokens: 10,
      codexTokens: 0,
      total: 10,
    });
  });

  it("returns an empty array for no days", () => {
    expect(calendarGrid([], Date.parse("2026-06-04T00:00:00.000Z"))).toEqual(
      [],
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/charts.test.ts`
Expected: FAIL — `calendarGrid is not a function`.

- [ ] **Step 3: Write minimal implementation**

```ts
// append to src/lib/charts.ts
import type { DayPoint } from "./aggregate";

export interface CalendarDay {
  date: string;
  claudeTokens: number;
  codexTokens: number;
  total: number;
}

const DAY_MS = 86400000;
const utcDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

// Continuous daily grid (UTC) so the heatmap has no holes. Spans the earliest
// byDay date through the later of the last byDay date and today (from nowMs).
export function calendarGrid(byDay: DayPoint[], nowMs: number): CalendarDay[] {
  if (byDay.length === 0) return [];
  const sorted = [...byDay].sort((a, b) => a.date.localeCompare(b.date));
  const start = sorted[0].date;
  const lastData = sorted[sorted.length - 1].date;
  const today = utcDate(nowMs);
  const end = today > lastData ? today : lastData;
  const map = new Map(sorted.map((d) => [d.date, d]));

  const out: CalendarDay[] = [];
  const endMs = Date.parse(`${end}T00:00:00.000Z`);
  for (let t = Date.parse(`${start}T00:00:00.000Z`); t <= endMs; t += DAY_MS) {
    const date = utcDate(t);
    const d = map.get(date);
    const claudeTokens = d?.claudeTokens ?? 0;
    const codexTokens = d?.codexTokens ?? 0;
    out.push({
      date,
      claudeTokens,
      codexTokens,
      total: claudeTokens + codexTokens,
    });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/charts.test.ts`
Expected: PASS (5 passed total in this file).

- [ ] **Step 5: Commit**

```bash
git add src/lib/charts.ts src/lib/charts.test.ts && git commit -m "feat(lib): add calendar-grid gap-fill aggregator"
```

---

### Task 4: Expose global `cacheHitRate` on `Rollups` (TDD)

**Files:**

- Modify: `src/lib/aggregate.ts:68-76` (the `Rollups` interface) and the `aggregate()` reducer/return
- Modify: `src/lib/aggregate.test.ts`

**Interfaces:**

- Produces: `Rollups.cacheHitRate: number` — global cache-read share `cacheRead / (input + cacheRead)` summed across all records; `0` when there are no read-side tokens. Reuses the existing `cacheHitRate(input, cacheRead)` helper.

- [ ] **Step 1: Add the failing test**

The existing `aggregate` fixture has input 100+10+200=310 and cacheRead 300+0+800=1100.

```ts
// add inside the existing describe("aggregate", ...) block in src/lib/aggregate.test.ts
it("exposes a global cache-hit rate over all records", () => {
  // cacheRead 1100 / (input 310 + cacheRead 1100) = 1100/1410
  expect(r.cacheHitRate).toBeCloseTo(0.7801418439716312, 12);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/aggregate.test.ts`
Expected: FAIL — `expected undefined to be close to 0.7801...` (`cacheHitRate` not on `Rollups` yet).

- [ ] **Step 3: Implement**

Add the field to the interface:

```ts
export interface Rollups {
  totals: { claude: ToolTotal; codex: ToolTotal; combined: ToolTotal };
  byDay: DayPoint[];
  byProject: ProjectPoint[];
  byModel: ModelPoint[];
  dateRange: { start: string | null; end: string | null };
  codexQuota: RateLimitSnapshot | null;
  claudeWindows: ClaudeWindows;
  cacheHitRate: number;
}
```

In `aggregate()`, add accumulators before the loop and update them inside it:

```ts
let inputSum = 0;
let cacheReadSum = 0;
```

Inside the `for (const r of records)` loop (next to the existing `const tokens = ...`):

```ts
inputSum += r.inputTokens;
cacheReadSum += r.cacheReadTokens;
```

Add to the returned object (alongside `claudeWindows: windows,`):

```ts
    cacheHitRate: cacheHitRate(inputSum, cacheReadSum),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/aggregate.test.ts`
Expected: PASS (all existing + the new case).

- [ ] **Step 5: Commit**

```bash
git add src/lib/aggregate.ts src/lib/aggregate.test.ts && git commit -m "feat(lib): expose global cache-hit rate on rollups"
```

---

### Task 5: Return `peakHours` + `calendar` from `/api/usage` and define `BoardData`

**Files:**

- Modify: `src/lib/charts.ts`
- Modify: `src/pages/api/usage.ts`

**Interfaces:**

- Consumes: `peakHours`, `calendarGrid`, `CalendarDay` (Task 2/3); `DashboardData` (`src/lib/aggregate.ts`); `applyFilters` (`src/lib/filters.ts`).
- Produces:
  - `export interface BoardData extends DashboardData { peakHours: number[]; calendar: CalendarDay[]; }` in `charts.ts`.
  - `/api/usage` JSON now includes `peakHours: number[]` (from filtered records) and `calendar: CalendarDay[]` (from `rollups.byDay`), so it deserializes to `BoardData`.

- [ ] **Step 1: Add `BoardData` to `charts.ts`**

```ts
// append to src/lib/charts.ts
import type { DashboardData } from "./aggregate";

// Everything a page-content island renders: the dashboard rollups plus the two
// chart-only aggregates that need raw records / byDay to compute.
export interface BoardData extends DashboardData {
  peakHours: number[];
  calendar: CalendarDay[];
}
```

- [ ] **Step 2: Extend the API route**

Rewrite `src/pages/api/usage.ts` to compute and return the two extra fields (filtered view; forecast/tips/windows stay unfiltered as today):

```ts
// src/pages/api/usage.ts
import type { APIRoute } from "astro";
import { scan } from "../../lib/scan";
import { applyFilters } from "../../lib/filters";
import { aggregate, claudeWindows } from "../../lib/aggregate";
import { peakHours, calendarGrid } from "../../lib/charts";
import { defaultPricing } from "../../lib/pricing";
import { buildForecast } from "../../lib/forecast";
import { buildTips } from "../../lib/tips";

export const prerender = false;

export const GET: APIRoute = ({ url }) => {
  const now = Date.now();
  const { records, codexQuota } = scan();
  // Windows, forecast, and tips reflect current account state (unfiltered).
  const windows = claudeWindows(records, now);
  const forecast = buildForecast(records, codexQuota, now);
  const tips = buildTips(records, forecast, defaultPricing);
  const filtered = applyFilters(records, url.searchParams);
  const rollups = aggregate(filtered, codexQuota, defaultPricing, windows);
  const body = {
    ...rollups,
    forecast,
    tips,
    peakHours: peakHours(filtered),
    calendar: calendarGrid(rollups.byDay, now),
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
```

- [ ] **Step 3: Build gate**

Run: `npm run build`
Expected: `[build] Complete!`

- [ ] **Step 4: Render-check the API payload**

Render-check recipe with `<ROUTE>` = `/api/usage` and `<GREP TOKEN>` = `"peakHours"`.
Expected: `RENDER_OK`. Also confirm `curl -s http://127.0.0.1:4321/api/usage | grep -F '"calendar"'` matches.

- [ ] **Step 5: Commit**

```bash
git add src/lib/charts.ts src/pages/api/usage.ts && git commit -m "feat(lib): return peak hours and calendar grid from usage api"
```

---

### Task 6: `Sidebar` island + filter bus

**Files:**

- Create: `src/lib/filter-bus.ts`
- Create: `src/components/Sidebar.tsx`

**Interfaces:**

- Produces (`filter-bus.ts`):
  - `export type ToolFilter = "all" | "claude" | "codex";`
  - `export interface FilterState { tool: ToolFilter; from: string; to: string; }`
  - `export const FILTER_EVENT = "usage:filter";`
  - `export function readFilter(): FilterState;`
  - `export function toQuery(f: FilterState): string;`
  - `export function writeFilter(next: Partial<FilterState>): FilterState;` (updates URL via `history.replaceState`, dispatches `FILTER_EVENT`)
  - `export function onFilter(cb: (f: FilterState) => void): () => void;`
- Produces (`Sidebar.tsx`): `export default function Sidebar({ pathname, codexQuota }: { pathname: string; codexQuota: RateLimitSnapshot | null }): JSX.Element` — consumed by `Layout.astro` (Task 7). All `window` access is inside functions so SSR of the island is safe.

- [ ] **Step 1: Write the filter bus**

```ts
// src/lib/filter-bus.ts
export type ToolFilter = "all" | "claude" | "codex";

export interface FilterState {
  tool: ToolFilter;
  from: string;
  to: string;
}

export const FILTER_EVENT = "usage:filter";

export function readFilter(): FilterState {
  const p = new URLSearchParams(window.location.search);
  const raw = p.get("tool");
  const tool: ToolFilter = raw === "claude" || raw === "codex" ? raw : "all";
  return { tool, from: p.get("from") ?? "", to: p.get("to") ?? "" };
}

export function toQuery(f: FilterState): string {
  const p = new URLSearchParams();
  if (f.tool !== "all") p.set("tool", f.tool);
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  return p.toString();
}

export function writeFilter(next: Partial<FilterState>): FilterState {
  const merged: FilterState = { ...readFilter(), ...next };
  const qs = toQuery(merged);
  window.history.replaceState(
    null,
    "",
    qs ? `?${qs}` : window.location.pathname,
  );
  window.dispatchEvent(
    new CustomEvent<FilterState>(FILTER_EVENT, { detail: merged }),
  );
  return merged;
}

export function onFilter(cb: (f: FilterState) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<FilterState>).detail);
  window.addEventListener(FILTER_EVENT, handler);
  return () => window.removeEventListener(FILTER_EVENT, handler);
}
```

- [ ] **Step 2: Write the Sidebar island**

Mirrors the mockup markup exactly (brand + `.filters` + grouped `nav` + `.side-quota` + `.side-foot`). Range chips compute `from`/`to` (inclusive, last N days) via UTC date slices; "All" clears both.

```tsx
// src/components/Sidebar.tsx
import { useEffect, useState } from "react";
import type { RateLimitSnapshot } from "../lib/normalize";
import {
  readFilter,
  writeFilter,
  type FilterState,
  type ToolFilter,
} from "../lib/filter-bus";

const RANGES: { label: string; days: number | null }[] = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "All", days: null },
];

function rangeDates(days: number | null): { from: string; to: string } {
  if (days == null) return { from: "", to: "" };
  const to = new Date();
  const from = new Date(to.getTime() - (days - 1) * 86400000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

function activeRange(f: FilterState): string {
  if (!f.from && !f.to) return "All";
  for (const r of RANGES) {
    if (r.days == null) continue;
    const d = rangeDates(r.days);
    if (d.from === f.from && d.to === f.to) return r.label;
  }
  return "";
}

const NAV = {
  Core: [
    { href: "/", label: "Overview" },
    { href: "/sessions", label: "Sessions" },
    { href: "/compare", label: "Compare" },
  ],
  Analyze: [
    { href: "/costs", label: "Costs" },
    { href: "/activity", label: "Activity" },
  ],
  System: [{ href: "/settings", label: "Settings" }],
};

function isActive(pathname: string, href: string): boolean {
  return href === "/"
    ? pathname === "/"
    : pathname === href || pathname.startsWith(`${href}/`);
}

export default function Sidebar({
  pathname,
  codexQuota,
}: {
  pathname: string;
  codexQuota: RateLimitSnapshot | null;
}) {
  const [filter, setFilter] = useState<FilterState>({
    tool: "all",
    from: "",
    to: "",
  });
  useEffect(() => setFilter(readFilter()), []);

  const setTool = (tool: ToolFilter) => setFilter(writeFilter({ tool }));
  const setRange = (days: number | null) =>
    setFilter(writeFilter(rangeDates(days)));
  const range = activeRange(filter);

  const weekly = Math.round(codexQuota?.secondary?.usedPercent ?? 0);
  const fiveH = Math.round(codexQuota?.primary?.usedPercent ?? 0);

  return (
    <aside>
      <div className="brand">
        <span className="logo">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 3v18h18" />
            <path d="M7 14l3-4 3 3 4-6" />
          </svg>
        </span>
        <b>Usage Tracker</b>
        <span className="v">v0.1</span>
      </div>

      <div className="filters">
        <p className="lbl">Agent</p>
        <div className="seg">
          {(["all", "claude", "codex"] as ToolFilter[]).map((t) => (
            <button
              key={t}
              className={filter.tool === t ? "on" : ""}
              onClick={() => setTool(t)}
            >
              {t === "all" ? "All" : t === "claude" ? "Claude" : "Codex"}
            </button>
          ))}
        </div>
        <p className="lbl">Range</p>
        <div className="chips">
          {RANGES.map((r) => (
            <button
              key={r.label}
              className={range === r.label ? "on" : ""}
              onClick={() => setRange(r.days)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <nav>
        {Object.entries(NAV).map(([section, items], i) => (
          <div key={section} style={{ display: "contents" }}>
            {i > 0 && <div className="navsec">{section}</div>}
            {items.map((it) => (
              <a
                key={it.href}
                href={it.href}
                className={isActive(pathname, it.href) ? "active" : ""}
              >
                {it.label}
              </a>
            ))}
          </div>
        ))}
      </nav>

      <div className="side-quota">
        <div className="row">
          <span>Codex weekly</span>
          <b className="mono">{weekly}%</b>
        </div>
        <div className="bar">
          <i
            style={{
              width: `${weekly}%`,
              background: "linear-gradient(90deg,var(--codex),var(--codex-2))",
            }}
          />
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <span>Codex 5h</span>
          <b className="mono">{fiveH}%</b>
        </div>
        <div className="bar">
          <i
            style={{
              width: `${fiveH}%`,
              background: "linear-gradient(90deg,var(--codex),var(--codex-2))",
            }}
          />
        </div>
        <div className="side-foot">
          <span className="dot" />
          local · read-only · no upload
        </div>
      </div>
    </aside>
  );
}
```

- [ ] **Step 3: Build gate**

Run: `npm run build`
Expected: `[build] Complete!` (Sidebar not mounted yet; this only verifies it compiles.)

- [ ] **Step 4: Commit**

```bash
git add src/lib/filter-bus.ts src/components/Sidebar.tsx && git commit -m "feat(ui): add sidebar with global agent and range filter"
```

---

### Task 7: AppShell layout (two-column, mounts Sidebar)

**Files:**

- Modify: `src/layouts/Layout.astro`

**Interfaces:**

- Consumes: `Sidebar` (Task 6), `scan` (`src/lib/scan.ts`) for the sidebar's `codexQuota`.
- Produces: a two-column `.app` shell — sticky 248px `<Sidebar>` + scrolling `<main>` wrapping `<slot />`; passes `pathname={Astro.url.pathname}` (drives nav active state) and `codexQuota`.

- [ ] **Step 1: Rewrite `Layout.astro`**

```astro
---
import '../styles/global.css';
import Sidebar from '../components/Sidebar.tsx';
import { scan } from '../lib/scan';
interface Props { title?: string }
const { title = 'Usage Tracker' } = Astro.props;
const { codexQuota } = scan();
const pathname = Astro.url.pathname;
---
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title}</title>
  </head>
  <body>
    <div class="app">
      <Sidebar client:load pathname={pathname} codexQuota={codexQuota} />
      <main>
        <slot />
      </main>
    </div>
  </body>
</html>
```

- [ ] **Step 2: Build gate**

Run: `npm run build`
Expected: `[build] Complete!`

- [ ] **Step 3: Render-check the shell**

Render-check recipe. `<ROUTE>` = `/sessions` (an unmodified page, so the shell is what changed), `<GREP TOKEN>` = `local · read-only · no upload`.
Expected: `RENDER_OK`. In `npm run dev`, open `/sessions` and confirm: sidebar is sticky on the left at 248px, brand + gradient logo render, and the "Sessions" nav link shows the orange active bar.

- [ ] **Step 4: Commit**

```bash
git add src/layouts/Layout.astro && git commit -m "feat(ui): make layout a two-column app shell with persistent sidebar"
```

---

### Task 8: `StatCard` + shared formatters + restyled `Overview`

**Files:**

- Create: `src/lib/format.ts`
- Create: `src/components/StatCard.tsx`
- Modify: `src/components/Overview.tsx`

**Interfaces:**

- Produces (`format.ts`): `fmtTokens(n: number): string`, `fmtCompact(n: number): string`, `fmtUsd(n: number): string`.
- Produces (`StatCard.tsx`): `export default function StatCard({ label, value, deltaPct, color, points }: { label: string; value: string; deltaPct: number | null; color: string; points: number[] }): JSX.Element` — renders one `.card.stat` with an inline SVG sparkline.
- Produces (`Overview.tsx`): `export default function Overview({ data }: { data: Rollups })` — renders the `.grid.cards4` of four `StatCard`s.

- [ ] **Step 1: Write shared formatters**

```ts
// src/lib/format.ts
export function fmtTokens(n: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(n));
}
export function fmtCompact(n: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}
export function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}
```

- [ ] **Step 2: Write `StatCard`**

```tsx
// src/components/StatCard.tsx
function sparkPoints(pts: number[]): string {
  if (pts.length === 0) return "0,29 96,29";
  const max = Math.max(...pts, 1);
  const n = pts.length;
  return pts
    .map((v, i) => {
      const x = n === 1 ? 0 : (i / (n - 1)) * 96;
      const y = 30 - (v / max) * 28 - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export default function StatCard({
  label,
  value,
  deltaPct,
  color,
  points,
}: {
  label: string;
  value: string;
  deltaPct: number | null;
  color: string;
  points: number[];
}) {
  const up = (deltaPct ?? 0) >= 0;
  return (
    <div className="card stat">
      <div className="k">{label}</div>
      <div className="v">{value}</div>
      <div className="foot">
        {deltaPct == null ? (
          <span className="delta" style={{ color: "var(--faint)" }}>
            —
          </span>
        ) : (
          <span className={`delta ${up ? "up" : "down"}`}>
            {up ? "▲" : "▼"} {Math.abs(deltaPct)}%
          </span>
        )}
        <svg className="spark" viewBox="0 0 96 30" preserveAspectRatio="none">
          <polyline
            fill="none"
            stroke={color}
            strokeWidth="2"
            points={sparkPoints(points)}
          />
        </svg>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Rewrite `Overview` to render four StatCards**

Delta = percent change of the second half of the window's daily series vs the first half.

```tsx
// src/components/Overview.tsx
import type { Rollups } from "../lib/aggregate";
import { fmtCompact, fmtUsd } from "../lib/format";
import StatCard from "./StatCard";

function pctDelta(pts: number[]): number | null {
  if (pts.length < 2) return null;
  const mid = Math.floor(pts.length / 2);
  const first = pts.slice(0, mid).reduce((a, b) => a + b, 0);
  const second = pts.slice(mid).reduce((a, b) => a + b, 0);
  if (first === 0) return null;
  return Math.round(((second - first) / first) * 100);
}

export default function Overview({ data }: { data: Rollups }) {
  const totalTokens = data.byDay.map((d) => d.claudeTokens + d.codexTokens);
  const totalCost = data.byDay.map((d) => d.claudeCost + d.codexCost);
  const claudeTokens = data.byDay.map((d) => d.claudeTokens);
  const codexTokens = data.byDay.map((d) => d.codexTokens);

  return (
    <div className="grid cards4">
      <StatCard
        label="Total tokens"
        value={fmtCompact(data.totals.combined.tokens)}
        deltaPct={pctDelta(totalTokens)}
        color="var(--primary)"
        points={totalTokens}
      />
      <StatCard
        label="Est. cost"
        value={fmtUsd(data.totals.combined.cost)}
        deltaPct={pctDelta(totalCost)}
        color="var(--mint)"
        points={totalCost}
      />
      <StatCard
        label="Claude"
        value={fmtCompact(data.totals.claude.tokens)}
        deltaPct={pctDelta(claudeTokens)}
        color="var(--claude)"
        points={claudeTokens}
      />
      <StatCard
        label="Codex"
        value={fmtCompact(data.totals.codex.tokens)}
        deltaPct={pctDelta(codexTokens)}
        color="var(--codex)"
        points={codexTokens}
      />
    </div>
  );
}
```

- [ ] **Step 4: Build gate**

Run: `npm run build`
Expected: `[build] Complete!` (Overview not on a page yet; compiles only. Its render is verified in Task 18.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/format.ts src/components/StatCard.tsx src/components/Overview.tsx && git commit -m "feat(ui): add stat cards with sparklines and deltas"
```

---

### Task 9: `UsageTrend` (restyle `TrendChart`)

**Files:**

- Rename: `src/components/TrendChart.tsx` → `src/components/UsageTrend.tsx`

**Interfaces:**

- Produces: `export default function UsageTrend({ data, initialMetric }: { data: Rollups; initialMetric?: "tokens" | "cost" }): JSX.Element` — a `.card` with a Tokens/Cost `.toggle`; Recharts overlapping areas, Claude `#e88a4e`, Codex `#a486f7`.

- [ ] **Step 1: Rename the file**

Run: `git mv src/components/TrendChart.tsx src/components/UsageTrend.tsx`

- [ ] **Step 2: Rewrite the component**

```tsx
// src/components/UsageTrend.tsx
import { useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { Rollups } from "../lib/aggregate";

export default function UsageTrend({
  data,
  initialMetric = "tokens",
}: {
  data: Rollups;
  initialMetric?: "tokens" | "cost";
}) {
  const [metric, setMetric] = useState<"tokens" | "cost">(initialMetric);
  const rows = data.byDay.map((d) => ({
    date: d.date,
    Claude: metric === "tokens" ? d.claudeTokens : d.claudeCost,
    Codex: metric === "tokens" ? d.codexTokens : d.codexCost,
  }));
  return (
    <div className="card">
      <div className="head">
        <h3>Usage over time</h3>
        <div className="toggle">
          {(["tokens", "cost"] as const).map((m) => (
            <button
              key={m}
              className={metric === m ? "on" : ""}
              onClick={() => setMetric(m)}
            >
              {m === "tokens" ? "Tokens" : "Cost"}
            </button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={rows}>
          <defs>
            <linearGradient id="gc" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#e88a4e" stopOpacity={0.45} />
              <stop offset="1" stopColor="#e88a4e" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gx" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#a486f7" stopOpacity={0.42} />
              <stop offset="1" stopColor="#a486f7" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="date" stroke="#5c6675" fontSize={10} />
          <YAxis stroke="#5c6675" fontSize={10} />
          <Tooltip
            contentStyle={{
              background: "#12151b",
              border: "1px solid rgba(233,238,246,.13)",
              borderRadius: 8,
              color: "#e8ecf2",
            }}
          />
          <Area
            type="monotone"
            dataKey="Claude"
            stroke="#e88a4e"
            strokeWidth={2}
            fill="url(#gc)"
          />
          <Area
            type="monotone"
            dataKey="Codex"
            stroke="#a486f7"
            strokeWidth={2}
            fill="url(#gx)"
          />
        </AreaChart>
      </ResponsiveContainer>
      <div className="legend">
        <span>
          <i className="sw" style={{ background: "var(--claude)" }} />
          Claude
        </span>
        <span>
          <i className="sw" style={{ background: "var(--codex)" }} />
          Codex
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Build gate**

Run: `npm run build`
Expected: `[build] Complete!`

- [ ] **Step 4: Commit**

```bash
git add src/components/UsageTrend.tsx && git commit -m "refactor(ui): restyle usage trend chart in agent colors"
```

---

### Task 10: `ModelDonut`

**Files:**

- Create: `src/components/ModelDonut.tsx`

**Interfaces:**

- Produces: `export default function ModelDonut({ data }: { data: Rollups }): JSX.Element` — a `.donutwrap` (no `.card` wrapper; the page wraps it). SVG donut over `data.byModel` shares; Claude models orange shades, Codex purple.

- [ ] **Step 1: Write the component**

```tsx
// src/components/ModelDonut.tsx
import type { ModelPoint, Rollups } from "../lib/aggregate";

function modelColor(m: ModelPoint): string {
  if (m.tool === "codex") return "#a486f7";
  const n = m.model.toLowerCase();
  if (n.includes("opus")) return "#e88a4e";
  if (n.includes("sonnet")) return "#f2ad76";
  if (n.includes("haiku")) return "#b5652b";
  return "#c56a2e";
}

const R = 15.9;
const C = 2 * Math.PI * R; // ~99.9 circumference units

export default function ModelDonut({ data }: { data: Rollups }) {
  const total = data.byModel.reduce((a, m) => a + m.tokens, 0) || 1;
  let offset = 25; // start at top (mockup convention)
  const segments = data.byModel.map((m) => {
    const pct = (m.tokens / total) * 100;
    const len = (pct / 100) * C;
    const seg = {
      color: modelColor(m),
      dash: `${len} ${C - len}`,
      dashoffset: offset,
      model: m.model,
      pct,
    };
    offset = (offset - len + C) % C;
    return seg;
  });
  const top = segments.slice(0, 4);

  return (
    <div className="donutwrap">
      <svg width="112" height="112" viewBox="0 0 42 42">
        <circle
          cx="21"
          cy="21"
          r={R}
          fill="none"
          stroke="#0e1218"
          strokeWidth="6"
        />
        {segments.map((s, i) => (
          <circle
            key={i}
            cx="21"
            cy="21"
            r={R}
            fill="none"
            stroke={s.color}
            strokeWidth="6"
            strokeDasharray={s.dash}
            strokeDashoffset={s.dashoffset}
          />
        ))}
        <text
          x="21"
          y="20"
          textAnchor="middle"
          className="mono"
          fill="#e8ecf2"
          fontSize="6"
          fontWeight="700"
        >
          {data.byModel.length}
        </text>
        <text x="21" y="26" textAnchor="middle" fill="#5c6675" fontSize="3">
          models
        </text>
      </svg>
      <div className="metrics">
        {top.map((s) => (
          <div className="m" key={s.model}>
            <span className="nm">
              <i className="sw" style={{ background: s.color }} />
              {s.model}
            </span>
            <span className="val">{Math.round(s.pct)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build gate**

Run: `npm run build`
Expected: `[build] Complete!`

- [ ] **Step 3: Commit**

```bash
git add src/components/ModelDonut.tsx && git commit -m "feat(ui): add model-mix donut chart"
```

---

### Task 11: `CacheGauge`

**Files:**

- Create: `src/components/CacheGauge.tsx`

**Interfaces:**

- Produces: `export default function CacheGauge({ rate }: { rate: number }): JSX.Element` — a `.gaugewrap` (no card); `rate` is `0..1`; mint semicircular arc.

- [ ] **Step 1: Write the component**

```tsx
// src/components/CacheGauge.tsx
const ARC_LEN = 94; // path length of the semicircle arc used below

export default function CacheGauge({ rate }: { rate: number }) {
  const clamped = Math.max(0, Math.min(1, rate));
  const dash = clamped * ARC_LEN;
  return (
    <div className="gaugewrap">
      <svg width="72" height="42" viewBox="0 0 72 42">
        <path
          d="M6 40 A30 30 0 0 1 66 40"
          fill="none"
          stroke="#0e1218"
          strokeWidth="7"
          strokeLinecap="round"
        />
        <path
          d="M6 40 A30 30 0 0 1 66 40"
          fill="none"
          stroke="#4fd6a8"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${ARC_LEN}`}
        />
      </svg>
      <div className="txt">
        <div className="big">{Math.round(clamped * 100)}%</div>
        <div className="lbl">cache hit rate</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build gate**

Run: `npm run build`
Expected: `[build] Complete!`

- [ ] **Step 3: Commit**

```bash
git add src/components/CacheGauge.tsx && git commit -m "feat(ui): add cache-hit-rate radial gauge"
```

---

### Task 12: `ActivityHeatmap`

**Files:**

- Create: `src/components/ActivityHeatmap.tsx`

**Interfaces:**

- Consumes: `CalendarDay` (`src/lib/charts.ts`).
- Produces: `export default function ActivityHeatmap({ calendar }: { calendar: CalendarDay[] }): JSX.Element` — a `<div>` containing `.heat` columns (weeks of 7) + `.heatscale`; per-day RGB blend Claude(232,138,78)↔Codex(164,134,247) by Claude share, alpha by intensity.

- [ ] **Step 1: Write the component**

```tsx
// src/components/ActivityHeatmap.tsx
import type { CalendarDay } from "../lib/charts";

function cellColor(d: CalendarDay, max: number): string {
  if (d.total <= 0) return "#0e1218";
  const share = d.claudeTokens / d.total; // 1 = all Claude, 0 = all Codex
  const r = Math.round(232 * share + 164 * (1 - share));
  const g = Math.round(138 * share + 134 * (1 - share));
  const b = Math.round(78 * share + 247 * (1 - share));
  const intensity = max > 0 ? d.total / max : 0;
  return `rgba(${r},${g},${b},${(0.18 + intensity * 0.82).toFixed(3)})`;
}

export default function ActivityHeatmap({
  calendar,
}: {
  calendar: CalendarDay[];
}) {
  const max = calendar.reduce((m, d) => Math.max(m, d.total), 0);
  const weeks: CalendarDay[][] = [];
  for (let i = 0; i < calendar.length; i += 7)
    weeks.push(calendar.slice(i, i + 7));

  return (
    <div>
      <div className="heat">
        {weeks.map((week, wi) => (
          <div className="heatcol" key={wi}>
            {week.map((d) => (
              <div
                className="cell"
                key={d.date}
                title={`${d.date}: ${d.total.toLocaleString()} tokens`}
                style={{ background: cellColor(d, max) }}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="heatscale">
        <span>less</span>
        <span className="cell" style={{ background: "#141a22" }} />
        <span className="cell" style={{ background: "#4a3320" }} />
        <span className="cell" style={{ background: "#8a5a34" }} />
        <span className="cell" style={{ background: "#e88a4e" }} />
        <span>more</span>
        <span style={{ marginLeft: 14, color: "var(--claude)" }}>■ Claude</span>
        <span style={{ color: "var(--codex)" }}>■ Codex</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build gate**

Run: `npm run build`
Expected: `[build] Complete!`

- [ ] **Step 3: Commit**

```bash
git add src/components/ActivityHeatmap.tsx && git commit -m "feat(ui): add activity heatmap with per-day agent blend"
```

---

### Task 13: `CostTreemap`

**Files:**

- Create: `src/components/CostTreemap.tsx`

**Interfaces:**

- Consumes: `Rollups`, `fmtUsd`.
- Produces: `export default function CostTreemap({ data }: { data: Rollups }): JSX.Element` — a `.tree` grid (no card). Aggregates `data.byProject` per project across tools; tile size (grid span) buckets by cost; gradient color by dominant-agent tool.

- [ ] **Step 1: Write the component**

```tsx
// src/components/CostTreemap.tsx
import type { Rollups } from "../lib/aggregate";
import { fmtUsd } from "../lib/format";

interface Tile {
  project: string;
  cost: number;
  claude: boolean;
}

function toTiles(data: Rollups): Tile[] {
  const map = new Map<
    string,
    { cost: number; claudeCost: number; codexCost: number }
  >();
  for (const p of data.byProject) {
    const e = map.get(p.project) ?? { cost: 0, claudeCost: 0, codexCost: 0 };
    e.cost += p.cost;
    if (p.tool === "claude") e.claudeCost += p.cost;
    else e.codexCost += p.cost;
    map.set(p.project, e);
  }
  return [...map.entries()]
    .map(([project, e]) => ({
      project,
      cost: e.cost,
      claude: e.claudeCost >= e.codexCost,
    }))
    .filter((t) => t.cost > 0)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 8);
}

function span(cost: number, max: number): number {
  if (cost >= 0.5 * max) return 3;
  if (cost >= 0.25 * max) return 2;
  return 1;
}

export default function CostTreemap({ data }: { data: Rollups }) {
  const tiles = toTiles(data);
  const max = tiles.reduce((m, t) => Math.max(m, t.cost), 0) || 1;
  return (
    <div className="tree">
      {tiles.map((t) => {
        const s = span(t.cost, max);
        const bg = t.claude
          ? "linear-gradient(140deg,#e88a4e,#c56a2e)"
          : "linear-gradient(140deg,#a486f7,#7c5fd6)";
        return (
          <div
            className="tile"
            key={t.project}
            style={{
              gridColumn: `span ${s}`,
              gridRow: `span ${s}`,
              background: bg,
            }}
          >
            <div className="tn">{t.project}</div>
            <div className="tv">{fmtUsd(t.cost)}</div>
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Build gate**

Run: `npm run build`
Expected: `[build] Complete!`

- [ ] **Step 3: Commit**

```bash
git add src/components/CostTreemap.tsx && git commit -m "feat(ui): add cost-by-project treemap"
```

---

### Task 14: `PeakHours` component

**Files:**

- Create: `src/components/PeakHours.tsx`

**Interfaces:**

- Produces: `export default function PeakHours({ hours }: { hours: number[] }): JSX.Element` — a `<div>` with `.bars` (24 bars, tallest highlighted in `--primary`) + `.axis` (00/06/12/18/23). `hours` is the length-24 `peakHours` array.

- [ ] **Step 1: Write the component**

```tsx
// src/components/PeakHours.tsx
export default function PeakHours({ hours }: { hours: number[] }) {
  const max = Math.max(...hours, 1);
  return (
    <div>
      <div className="bars">
        {hours.map((v, i) => (
          <div
            key={i}
            className="b"
            title={`${String(i).padStart(2, "0")}:00 — ${v} turns`}
            style={{
              height: `${(v / max) * 100}%`,
              ...(v === max
                ? {
                    background:
                      "linear-gradient(180deg,var(--primary),#4ac0e055)",
                  }
                : {}),
            }}
          />
        ))}
      </div>
      <div className="axis">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>23</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build gate**

Run: `npm run build`
Expected: `[build] Complete!`

- [ ] **Step 3: Commit**

```bash
git add src/components/PeakHours.tsx && git commit -m "feat(ui): add peak-hours histogram component"
```

---

### Task 15: `LimitsPanel` (restyle `QuotaPanel`, both agents 5h+weekly)

**Files:**

- Rename: `src/components/QuotaPanel.tsx` → `src/components/LimitsPanel.tsx`

**Interfaces:**

- Consumes: `DashboardData`, `RateLimitWindow`, `WindowForecast`, `fmtTokens`.
- Produces: `export default function LimitsPanel({ data }: { data: DashboardData }): JSX.Element` — a `.card` with a Claude group (5h + weekly **token volume** bars; weekly is the recent peak = full bar, 5h is its proportion) and a Codex group (5h + weekly **server %** bars, warn color + forecast line on weekly), plus the honesty `.note`.

- [ ] **Step 1: Rename the file**

Run: `git mv src/components/QuotaPanel.tsx src/components/LimitsPanel.tsx`

- [ ] **Step 2: Rewrite the component**

```tsx
// src/components/LimitsPanel.tsx
import type { DashboardData } from "../lib/aggregate";
import type { RateLimitWindow, WindowForecast } from "../lib/normalize";
import { fmtTokens } from "../lib/format";

function CodexRow({ label, w }: { label: string; w: RateLimitWindow | null }) {
  if (!w)
    return (
      <div className="qrow">
        <span className="qlab">{label}</span>
        <span className="qmeta">no data</span>
      </div>
    );
  const pct = Math.min(100, w.usedPercent);
  const resets = new Date(w.resetsAt * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <div className="qrow">
      <span className="qlab">{label}</span>
      <div className="qbar bar" style={{ height: 8 }}>
        <i
          style={{
            width: `${pct}%`,
            background: "linear-gradient(90deg,var(--codex),var(--codex-2))",
          }}
        />
      </div>
      <span className="qmeta">
        {Math.round(w.usedPercent)}% · resets {resets}
      </span>
    </div>
  );
}

function ClaudeRow({
  label,
  tokens,
  width,
}: {
  label: string;
  tokens: number;
  width: number;
}) {
  return (
    <div className="qrow">
      <span className="qlab">{label}</span>
      <div className="qbar bar" style={{ height: 8 }}>
        <i
          style={{
            width: `${width}%`,
            background: "linear-gradient(90deg,var(--claude),var(--claude-2))",
          }}
        />
      </div>
      <span className="qmeta">{fmtTokens(tokens)} tokens</span>
    </div>
  );
}

function ForecastLine({ f }: { f?: WindowForecast }) {
  if (!f || f.projectedPercentAtReset == null) return null;
  return (
    <div className="forecast">
      ▲ projected {Math.round(f.projectedPercentAtReset)}% by weekly reset at
      current pace
    </div>
  );
}

export default function LimitsPanel({ data }: { data: DashboardData }) {
  const w = data.claudeWindows;
  const weekly = w.sevenDayTokens;
  const fiveWidth =
    weekly > 0
      ? Math.min(100, Math.round((w.fiveHourTokens / weekly) * 100))
      : 0;
  const weeklyWidth = weekly > 0 ? 100 : 0;
  const q = data.codexQuota;

  return (
    <div className="card">
      <div className="qgroup">
        <div className="qhead">
          <span className="sw" style={{ background: "var(--claude)" }} />
          Claude
          <span className="qsub">
            rolling token volume — no server-side limit
          </span>
        </div>
        <ClaudeRow
          label="5h window"
          tokens={w.fiveHourTokens}
          width={fiveWidth}
        />
        <ClaudeRow label="Weekly" tokens={weekly} width={weeklyWidth} />
      </div>
      <div className="qgroup">
        <div className="qhead">
          <span className="sw" style={{ background: "var(--codex)" }} />
          Codex
          <span className="qsub">server-reported quota</span>
        </div>
        {q ? (
          <>
            <CodexRow label="5h window" w={q.primary} />
            <CodexRow label="Weekly" w={q.secondary} />
            <ForecastLine f={data.forecast.codexSecondary} />
          </>
        ) : (
          <div className="qrow">
            <span className="qlab">Weekly</span>
            <span className="qmeta">No Codex quota data found.</span>
          </div>
        )}
      </div>
      <div className="note">
        Codex percentages are server-reported. Claude exposes no server-side
        limit, so its 5h/weekly bars are token <b>volume</b> relative to your
        own recent peak, not a quota.
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Build gate**

Run: `npm run build`
Expected: `[build] Complete!`

- [ ] **Step 4: Commit**

```bash
git add src/components/LimitsPanel.tsx && git commit -m "refactor(ui): regroup limits panel by agent with 5h and weekly windows"
```

---

### Task 16: Restyle `Tips`

**Files:**

- Modify: `src/components/Tips.tsx`

**Interfaces:**

- Produces: `export default function Tips({ tips }: { tips: Tip[] })` — `.tips` grid of `.tip` tiles; `.warn` variant by severity; `.save` chip when `savingsUsd` present. Unchanged signature.

- [ ] **Step 1: Rewrite the component**

```tsx
// src/components/Tips.tsx
import type { Tip } from "../lib/normalize";

export default function Tips({ tips }: { tips: Tip[] }) {
  if (!tips.length) return null;
  return (
    <div className="tips">
      {tips.map((t) => (
        <div
          key={t.id}
          className={`tip ${t.severity === "warn" ? "warn" : ""}`}
        >
          <p className="tt">{t.title}</p>
          <p className="td">{t.detail}</p>
          {t.savingsUsd != null ? (
            <span className="save">save ~${t.savingsUsd.toFixed(2)}</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Build gate**

Run: `npm run build`
Expected: `[build] Complete!`

- [ ] **Step 3: Commit**

```bash
git add src/components/Tips.tsx && git commit -m "refactor(ui): restyle optimization tips as left-accented tiles"
```

---

### Task 17: Restyle `ByModel` + `ByProject`

**Files:**

- Modify: `src/components/ByModel.tsx`
- Modify: `src/components/ByProject.tsx`

**Interfaces:**

- Produces: `ByModel({ data }: { data: Rollups })` and `ByProject({ data }: { data: Rollups })` — each a `.card` with a themed Recharts horizontal bar chart (ByModel bars `#e88a4e`, ByProject bars `#a486f7`, dark axes/tooltip). Unchanged signatures. Used by `CostsBoard` (Task 19).

- [ ] **Step 1: Rewrite `ByModel`**

```tsx
// src/components/ByModel.tsx
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { Rollups } from "../lib/aggregate";

export default function ByModel({ data }: { data: Rollups }) {
  const rows = data.byModel.map((m) => ({
    name: m.unpriced ? `${m.model} (unpriced)` : m.model,
    tokens: m.tokens,
  }));
  return (
    <div className="card">
      <h3>By model</h3>
      <p className="hint">tokens per model</p>
      <ResponsiveContainer
        width="100%"
        height={Math.max(120, rows.length * 40)}
      >
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ left: 24, right: 24 }}
        >
          <XAxis type="number" stroke="#5c6675" fontSize={10} />
          <YAxis
            type="category"
            dataKey="name"
            width={170}
            stroke="#98a2b3"
            fontSize={11}
          />
          <Tooltip
            contentStyle={{
              background: "#12151b",
              border: "1px solid rgba(233,238,246,.13)",
              borderRadius: 8,
              color: "#e8ecf2",
            }}
          />
          <Bar dataKey="tokens" fill="#e88a4e" radius={4} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 2: Rewrite `ByProject`**

```tsx
// src/components/ByProject.tsx
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { Rollups } from "../lib/aggregate";

export default function ByProject({ data }: { data: Rollups }) {
  const rows = data.byProject
    .slice(0, 12)
    .map((p) => ({ name: `${p.project} · ${p.tool}`, tokens: p.tokens }));
  return (
    <div className="card">
      <h3>By project</h3>
      <p className="hint">tokens per project</p>
      <ResponsiveContainer
        width="100%"
        height={Math.max(120, rows.length * 34)}
      >
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ left: 24, right: 24 }}
        >
          <XAxis type="number" stroke="#5c6675" fontSize={10} />
          <YAxis
            type="category"
            dataKey="name"
            width={190}
            stroke="#98a2b3"
            fontSize={11}
          />
          <Tooltip
            contentStyle={{
              background: "#12151b",
              border: "1px solid rgba(233,238,246,.13)",
              borderRadius: 8,
              color: "#e8ecf2",
            }}
          />
          <Bar dataKey="tokens" fill="#a486f7" radius={4} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 3: Build gate**

Run: `npm run build`
Expected: `[build] Complete!`

- [ ] **Step 4: Commit**

```bash
git add src/components/ByModel.tsx src/components/ByProject.tsx && git commit -m "refactor(ui): restyle by-model and by-project bar charts"
```

---

### Task 18: `OverviewBoard` + wire `index.astro`; delete Dashboard + RetentionBanner

**Files:**

- Create: `src/components/OverviewBoard.tsx`
- Modify: `src/pages/index.astro`
- Delete: `src/components/Dashboard.tsx`
- Delete: `src/components/RetentionBanner.tsx`

**Interfaces:**

- Consumes: `BoardData` (Task 5), `onFilter`/`toQuery`/`readFilter` (Task 6), and every component from Tasks 8-16.
- Produces: `export default function OverviewBoard({ initial }: { initial: BoardData }): JSX.Element` — the Overview page; owns `data` state, re-fetches `/api/usage?<query>` on `usage:filter` events and on Refresh (POST `/api/refresh` first).

- [ ] **Step 1: Write `OverviewBoard`**

```tsx
// src/components/OverviewBoard.tsx
import { useEffect, useState } from "react";
import type { BoardData } from "../lib/charts";
import {
  onFilter,
  readFilter,
  toQuery,
  type FilterState,
} from "../lib/filter-bus";
import Overview from "./Overview";
import UsageTrend from "./UsageTrend";
import ModelDonut from "./ModelDonut";
import CacheGauge from "./CacheGauge";
import ActivityHeatmap from "./ActivityHeatmap";
import CostTreemap from "./CostTreemap";
import PeakHours from "./PeakHours";
import LimitsPanel from "./LimitsPanel";
import Tips from "./Tips";

function fmtRange(start: string | null, end: string | null): string {
  if (!start || !end) return "no data";
  return `${start.slice(0, 10)} → ${end.slice(0, 10)}`;
}

export default function OverviewBoard({ initial }: { initial: BoardData }) {
  const [data, setData] = useState<BoardData>(initial);
  const [loading, setLoading] = useState(false);

  async function load(f: FilterState, refresh = false) {
    setLoading(true);
    try {
      if (refresh) await fetch("/api/refresh", { method: "POST" });
      const qs = toQuery(f);
      const res = await fetch(`/api/usage${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw new Error(`usage request failed: ${res.status}`);
      setData(await res.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => onFilter((f) => load(f)), []);

  const toolLabel =
    data.totals.claude.tokens && data.totals.codex.tokens
      ? "All agents"
      : data.totals.codex.tokens
        ? "Codex"
        : "Claude";

  return (
    <>
      <div className="top">
        <div>
          <h1>Overview</h1>
          <div className="sub">
            {toolLabel} ·{" "}
            <span className="mono">
              {fmtRange(data.dateRange.start, data.dateRange.end)}
            </span>{" "}
            · notional cost at API rates
          </div>
        </div>
        <button className="btn" onClick={() => load(readFilter(), true)}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M23 4v6h-6M1 20v-6h6" />
            <path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15" />
          </svg>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      <Overview data={data} />

      <div className="grid c2" style={{ marginTop: 16 }}>
        <UsageTrend data={data} />
        <div className="card">
          <h3>Model mix</h3>
          <p className="hint">share of total tokens</p>
          <ModelDonut data={data} />
          <CacheGauge rate={data.cacheHitRate} />
        </div>
      </div>

      <div className="sectitle">Activity</div>
      <div className="card">
        <div className="head">
          <h3>When you shipped</h3>
          <span className="hint" style={{ margin: 0 }}>
            color blends by agent
          </span>
        </div>
        <ActivityHeatmap calendar={data.calendar} />
      </div>

      <div className="grid c2b" style={{ marginTop: 16 }}>
        <div className="card">
          <h3>Cost by project</h3>
          <p className="hint">size = spend · color = dominant agent</p>
          <CostTreemap data={data} />
        </div>
        <div className="card">
          <h3>Peak hours</h3>
          <p className="hint">assistant turns by hour of day</p>
          <PeakHours hours={data.peakHours} />
        </div>
      </div>

      <div className="sectitle">Usage limits &amp; forecast</div>
      <LimitsPanel data={data} />

      <div className="sectitle">Optimization tips</div>
      <Tips tips={data.tips} />
    </>
  );
}
```

- [ ] **Step 2: Rewrite `index.astro` (SSR filter + peakHours/calendar; drop retention)**

```astro
---
import Layout from '../layouts/Layout.astro';
import OverviewBoard from '../components/OverviewBoard.tsx';
import { scan } from '../lib/scan';
import { applyFilters } from '../lib/filters';
import { aggregate, claudeWindows } from '../lib/aggregate';
import { peakHours, calendarGrid } from '../lib/charts';
import { defaultPricing } from '../lib/pricing';
import { buildForecast } from '../lib/forecast';
import { buildTips } from '../lib/tips';

export const prerender = false;

const now = Date.now();
const { records, codexQuota } = scan();
// Windows, forecast, tips reflect current account state (unfiltered).
const windows = claudeWindows(records, now);
const forecast = buildForecast(records, codexQuota, now);
const tips = buildTips(records, forecast, defaultPricing);
const filtered = applyFilters(records, Astro.url.searchParams);
const rollups = aggregate(filtered, codexQuota, defaultPricing, windows);
const initial = {
  ...rollups,
  forecast,
  tips,
  peakHours: peakHours(filtered),
  calendar: calendarGrid(rollups.byDay, now),
};
---
<Layout>
  <OverviewBoard client:load initial={initial} />
</Layout>
```

- [ ] **Step 3: Delete the superseded components**

Run: `git rm src/components/Dashboard.tsx src/components/RetentionBanner.tsx`

- [ ] **Step 4: Build gate**

Run: `npm run build`
Expected: `[build] Complete!` (no dangling imports of `Dashboard`/`RetentionBanner`).

- [ ] **Step 5: Render-check the Overview page**

Render-check recipe. `<ROUTE>` = `/`, `<GREP TOKEN>` = `When you shipped`.
Expected: `RENDER_OK`. Also confirm each of these greps matches on `/`: `Total tokens`, `Usage over time`, `Model mix`, `cache hit rate`, `Cost by project`, `Peak hours`, `no server-side limit`. In `npm run dev`, load `/` and confirm every surface paints with real data: the 4 stat cards + sparklines, orange/purple trend, donut + mint gauge, heatmap blend, treemap tiles, peak-hours bars (tallest cyan), and both agents' 5h+weekly limit rows. Change the Agent segmented control and a Range chip in the sidebar and confirm the board re-fetches (numbers change, URL gains `?tool=`/`?from=`/`?to=`).

- [ ] **Step 6: Full suite + commit**

Run: `npm run test`
Expected: all suites pass.

```bash
git add src/components/OverviewBoard.tsx src/pages/index.astro && git rm src/components/Dashboard.tsx src/components/RetentionBanner.tsx && git commit -m "feat(ui): rebuild overview board and lift filter to sidebar"
```

---

### Task 19: `/costs` page + `CostsBoard`

**Files:**

- Create: `src/components/CostsBoard.tsx`
- Create: `src/pages/costs.astro`

**Interfaces:**

- Consumes: `BoardData`, filter bus, `UsageTrend` (cost mode), `CostTreemap`, `ByModel`, `ByProject`, `StatCard`, `fmtUsd`.
- Produces: `export default function CostsBoard({ initial }: { initial: BoardData }): JSX.Element` — cost-focused surface reusing Overview components at larger scale + a per-model cost table; re-fetches on `usage:filter`.

- [ ] **Step 1: Write `CostsBoard`**

```tsx
// src/components/CostsBoard.tsx
import { useEffect, useState } from "react";
import type { BoardData } from "../lib/charts";
import { onFilter, toQuery, type FilterState } from "../lib/filter-bus";
import { fmtUsd } from "../lib/format";
import StatCard from "./StatCard";
import UsageTrend from "./UsageTrend";
import CostTreemap from "./CostTreemap";
import ByModel from "./ByModel";
import ByProject from "./ByProject";

export default function CostsBoard({ initial }: { initial: BoardData }) {
  const [data, setData] = useState<BoardData>(initial);

  async function load(f: FilterState) {
    const qs = toQuery(f);
    const res = await fetch(`/api/usage${qs ? `?${qs}` : ""}`);
    if (res.ok) setData(await res.json());
  }
  useEffect(() => onFilter((f) => load(f)), []);

  const costSeries = data.byDay.map((d) => d.claudeCost + d.codexCost);
  const priced = data.byModel.filter((m) => !m.unpriced);

  return (
    <>
      <div className="top">
        <div>
          <h1>Costs</h1>
          <div className="sub">notional spend at API rates</div>
        </div>
      </div>

      <div className="grid cards4">
        <StatCard
          label="Est. cost"
          value={fmtUsd(data.totals.combined.cost)}
          deltaPct={null}
          color="var(--mint)"
          points={costSeries}
        />
        <StatCard
          label="Claude cost"
          value={fmtUsd(data.totals.claude.cost)}
          deltaPct={null}
          color="var(--claude)"
          points={data.byDay.map((d) => d.claudeCost)}
        />
        <StatCard
          label="Codex cost"
          value={fmtUsd(data.totals.codex.cost)}
          deltaPct={null}
          color="var(--codex)"
          points={data.byDay.map((d) => d.codexCost)}
        />
        <StatCard
          label="Cache hit rate"
          value={`${Math.round(data.cacheHitRate * 100)}%`}
          deltaPct={null}
          color="var(--mint)"
          points={[]}
        />
      </div>

      <div className="grid c2" style={{ marginTop: 16 }}>
        <UsageTrend data={data} initialMetric="cost" />
        <div className="card">
          <h3>Cost by project</h3>
          <p className="hint">size = spend · color = dominant agent</p>
          <CostTreemap data={data} />
        </div>
      </div>

      <div className="sectitle">Per-model cost</div>
      <div className="card">
        <table
          style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}
        >
          <thead>
            <tr style={{ color: "var(--faint)", textAlign: "left" }}>
              <th style={{ padding: "6px 8px" }}>Model</th>
              <th style={{ padding: "6px 8px" }}>Agent</th>
              <th
                style={{ padding: "6px 8px", textAlign: "right" }}
                className="mono"
              >
                Cost
              </th>
            </tr>
          </thead>
          <tbody>
            {priced.map((m) => (
              <tr
                key={`${m.tool}:${m.model}`}
                style={{ borderTop: "1px solid var(--line)" }}
              >
                <td style={{ padding: "6px 8px" }}>{m.model}</td>
                <td
                  style={{
                    padding: "6px 8px",
                    color:
                      m.tool === "claude" ? "var(--claude)" : "var(--codex)",
                  }}
                >
                  {m.tool}
                </td>
                <td
                  style={{ padding: "6px 8px", textAlign: "right" }}
                  className="mono"
                >
                  {fmtUsd(m.cost)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid c2" style={{ marginTop: 16 }}>
        <ByModel data={data} />
        <ByProject data={data} />
      </div>
    </>
  );
}
```

- [ ] **Step 2: Write `costs.astro`** (same SSR pattern as `index.astro`)

```astro
---
import Layout from '../layouts/Layout.astro';
import CostsBoard from '../components/CostsBoard.tsx';
import { scan } from '../lib/scan';
import { applyFilters } from '../lib/filters';
import { aggregate, claudeWindows } from '../lib/aggregate';
import { peakHours, calendarGrid } from '../lib/charts';
import { defaultPricing } from '../lib/pricing';
import { buildForecast } from '../lib/forecast';
import { buildTips } from '../lib/tips';

export const prerender = false;

const now = Date.now();
const { records, codexQuota } = scan();
const windows = claudeWindows(records, now);
const forecast = buildForecast(records, codexQuota, now);
const tips = buildTips(records, forecast, defaultPricing);
const filtered = applyFilters(records, Astro.url.searchParams);
const rollups = aggregate(filtered, codexQuota, defaultPricing, windows);
const initial = {
  ...rollups,
  forecast,
  tips,
  peakHours: peakHours(filtered),
  calendar: calendarGrid(rollups.byDay, now),
};
---
<Layout title="Costs">
  <CostsBoard client:load initial={initial} />
</Layout>
```

- [ ] **Step 3: Build gate**

Run: `npm run build`
Expected: `[build] Complete!`

- [ ] **Step 4: Render-check `/costs`**

Render-check recipe. `<ROUTE>` = `/costs`, `<GREP TOKEN>` = `Per-model cost`.
Expected: `RENDER_OK`. In `npm run dev`, open `/costs` and confirm: cost stat cards, the trend defaults to Cost, treemap, per-model cost table, and both bar charts paint; the sidebar nav shows Costs active.

- [ ] **Step 5: Commit**

```bash
git add src/components/CostsBoard.tsx src/pages/costs.astro && git commit -m "feat(ui): add dedicated costs page"
```

---

### Task 20: `/activity` page + `ActivityBoard`

**Files:**

- Create: `src/components/ActivityBoard.tsx`
- Create: `src/pages/activity.astro`

**Interfaces:**

- Consumes: `BoardData`, filter bus, `ActivityHeatmap`, `PeakHours`, `StatCard`, `fmtTokens`.
- Produces: `export default function ActivityBoard({ initial }: { initial: BoardData }): JSX.Element` — full heatmap + peak-hours + streak/summary stats; re-fetches on `usage:filter`.

- [ ] **Step 1: Write `ActivityBoard`**

```tsx
// src/components/ActivityBoard.tsx
import { useEffect, useState } from "react";
import type { BoardData } from "../lib/charts";
import { onFilter, toQuery, type FilterState } from "../lib/filter-bus";
import { fmtTokens } from "../lib/format";
import ActivityHeatmap from "./ActivityHeatmap";
import PeakHours from "./PeakHours";
import StatCard from "./StatCard";

function currentStreak(calendar: BoardData["calendar"]): number {
  let streak = 0;
  for (let i = calendar.length - 1; i >= 0; i--) {
    if (calendar[i].total > 0) streak++;
    else break;
  }
  return streak;
}

export default function ActivityBoard({ initial }: { initial: BoardData }) {
  const [data, setData] = useState<BoardData>(initial);

  async function load(f: FilterState) {
    const qs = toQuery(f);
    const res = await fetch(`/api/usage${qs ? `?${qs}` : ""}`);
    if (res.ok) setData(await res.json());
  }
  useEffect(() => onFilter((f) => load(f)), []);

  const activeDays = data.calendar.filter((d) => d.total > 0).length;
  const windowTotal = data.calendar.reduce((a, d) => a + d.total, 0);
  const streak = currentStreak(data.calendar);

  return (
    <>
      <div className="top">
        <div>
          <h1>Activity</h1>
          <div className="sub">
            when work happened across the selected range
          </div>
        </div>
      </div>

      <div className="grid cards4">
        <StatCard
          label="Active days"
          value={String(activeDays)}
          deltaPct={null}
          color="var(--primary)"
          points={data.calendar.map((d) => d.total)}
        />
        <StatCard
          label="Current streak"
          value={`${streak}d`}
          deltaPct={null}
          color="var(--mint)"
          points={[]}
        />
        <StatCard
          label="Tokens (range)"
          value={fmtTokens(windowTotal)}
          deltaPct={null}
          color="var(--claude)"
          points={data.calendar.map((d) => d.total)}
        />
        <StatCard
          label="Days shown"
          value={String(data.calendar.length)}
          deltaPct={null}
          color="var(--codex)"
          points={[]}
        />
      </div>

      <div className="sectitle">When you shipped</div>
      <div className="card">
        <div className="head">
          <h3>Activity heatmap</h3>
          <span className="hint" style={{ margin: 0 }}>
            color blends by agent
          </span>
        </div>
        <ActivityHeatmap calendar={data.calendar} />
      </div>

      <div className="sectitle">Peak hours</div>
      <div className="card">
        <h3>Peak hours</h3>
        <p className="hint">assistant turns by hour of day</p>
        <PeakHours hours={data.peakHours} />
      </div>
    </>
  );
}
```

- [ ] **Step 2: Write `activity.astro`** (same SSR pattern)

```astro
---
import Layout from '../layouts/Layout.astro';
import ActivityBoard from '../components/ActivityBoard.tsx';
import { scan } from '../lib/scan';
import { applyFilters } from '../lib/filters';
import { aggregate, claudeWindows } from '../lib/aggregate';
import { peakHours, calendarGrid } from '../lib/charts';
import { defaultPricing } from '../lib/pricing';
import { buildForecast } from '../lib/forecast';
import { buildTips } from '../lib/tips';

export const prerender = false;

const now = Date.now();
const { records, codexQuota } = scan();
const windows = claudeWindows(records, now);
const forecast = buildForecast(records, codexQuota, now);
const tips = buildTips(records, forecast, defaultPricing);
const filtered = applyFilters(records, Astro.url.searchParams);
const rollups = aggregate(filtered, codexQuota, defaultPricing, windows);
const initial = {
  ...rollups,
  forecast,
  tips,
  peakHours: peakHours(filtered),
  calendar: calendarGrid(rollups.byDay, now),
};
---
<Layout title="Activity">
  <ActivityBoard client:load initial={initial} />
</Layout>
```

- [ ] **Step 3: Build gate**

Run: `npm run build`
Expected: `[build] Complete!`

- [ ] **Step 4: Render-check `/activity`**

Render-check recipe. `<ROUTE>` = `/activity`, `<GREP TOKEN>` = `Activity heatmap`.
Expected: `RENDER_OK`. In `npm run dev`, open `/activity` and confirm the summary cards, full heatmap, and peak-hours bars paint; Activity nav link is active.

- [ ] **Step 5: Commit**

```bash
git add src/components/ActivityBoard.tsx src/pages/activity.astro && git commit -m "feat(ui): add dedicated activity page"
```

---

### Task 21: `/settings` stub page

**Files:**

- Create: `src/pages/settings.astro`

**Interfaces:**

- Consumes: `getRetention`, `isRetentionRisky`, `effectiveRetentionDays` (`src/lib/settings.ts`).
- Produces: a static v1 stub — theme note + read-only retention status (replaces the removed banner nag). No island; real controls deferred (out of scope).

- [ ] **Step 1: Write `settings.astro`**

```astro
---
import Layout from '../layouts/Layout.astro';
import { getRetention, isRetentionRisky, effectiveRetentionDays } from '../lib/settings';

export const prerender = false;

const info = getRetention();
const days = effectiveRetentionDays(info);
const risky = isRetentionRisky(info);
---
<Layout title="Settings">
  <div class="top">
    <div>
      <h1>Settings</h1>
      <div class="sub">read-only in v1 · controls coming later</div>
    </div>
  </div>

  <div class="card" style="margin-bottom:16px">
    <h3>Theme</h3>
    <p class="hint">Refined dark. Light theme is out of scope for v1.</p>
  </div>

  <div class="card">
    <h3>Retention</h3>
    <p class="hint">Claude usage-history retention window.</p>
    <div class="qrow">
      <span class="qlab">Current</span>
      <span class="qmeta">{days} days{risky ? ' · at risk of data loss' : ' · safe'}</span>
    </div>
    {risky && (
      <p class="note">
        Run <span class="mono">npm run fix-retention</span> to raise the retention window so past usage is not lost.
      </p>
    )}
  </div>
</Layout>
```

- [ ] **Step 2: Build gate**

Run: `npm run build`
Expected: `[build] Complete!`

- [ ] **Step 3: Render-check `/settings`**

Render-check recipe. `<ROUTE>` = `/settings`, `<GREP TOKEN>` = `Retention`.
Expected: `RENDER_OK`. In `npm run dev`, open `/settings` and confirm the two cards paint inside the shell and the Settings nav link is active.

- [ ] **Step 4: Final full suite + commit**

Run: `npm run test`
Expected: all suites pass.

```bash
git add src/pages/settings.astro && git commit -m "feat(ui): add settings stub with read-only retention status"
```

---

## Self-Review

**1. Spec coverage:**

| Spec item                                                                                                                                              | Task          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| Theme tokens (global.css + fonts + radius)                                                                                                             | 1             |
| `peakHours` aggregator (canonical-pinned)                                                                                                              | 2             |
| `calendarGrid` aggregator (canonical-pinned)                                                                                                           | 3             |
| Global `cacheHitRate` on `Rollups` (pinned)                                                                                                            | 4             |
| SSR/API pass rollups + peakHours + calendarGrid                                                                                                        | 5, 18, 19, 20 |
| Sidebar: brand, global agent+range filter → `?tool=&from=&to=`, grouped nav Core/Analyze/System, bottom quota mini + local badge, active from pathname | 6, 7          |
| AppShell two-column Layout                                                                                                                             | 7             |
| Lift filter out of Dashboard into sidebar                                                                                                              | 6, 18         |
| StatCard (+sparkline)                                                                                                                                  | 8             |
| Restyle Overview                                                                                                                                       | 8             |
| Restyle TrendChart → UsageTrend (orange/purple)                                                                                                        | 9             |
| ModelDonut                                                                                                                                             | 10            |
| CacheGauge                                                                                                                                             | 11            |
| ActivityHeatmap (per-day orange↔purple blend)                                                                                                          | 12            |
| CostTreemap                                                                                                                                            | 13            |
| PeakHours                                                                                                                                              | 14            |
| Restyle QuotaPanel → LimitsPanel (grouped by agent, 5h+weekly both; Codex %, Claude volume)                                                            | 15            |
| Restyle Tips                                                                                                                                           | 16            |
| Restyle ByModel/ByProject                                                                                                                              | 17            |
| Overview page (`/`) rich summary                                                                                                                       | 18            |
| `/costs` page                                                                                                                                          | 19            |
| `/activity` page                                                                                                                                       | 20            |
| `/settings` stub                                                                                                                                       | 21            |
| DELETE RetentionBanner + its usage                                                                                                                     | 18            |

**2. Placeholder scan:** No "TBD"/"similar to Task N"/code-less code steps. Every code step contains full source; every render-check names an exact route + grep token.

**3. Type consistency:** `peakHours(records) → number[]` and `calendarGrid(byDay, nowMs) → CalendarDay[]` are produced in Tasks 2/3 and consumed identically in Tasks 5/18/19/20 (API + all three SSR pages) and by `PeakHours({hours})` / `ActivityHeatmap({calendar})`. `BoardData extends DashboardData` (Task 5) is the single prop type for all three boards. `FilterState`/`ToolFilter`/`toQuery`/`onFilter`/`readFilter`/`writeFilter` (Task 6) are used consistently by Sidebar and all boards. `cacheHitRate` field (Task 4) is read by `CacheGauge` via `data.cacheHitRate` (Tasks 18/19). `fmtTokens`/`fmtCompact`/`fmtUsd` (Task 8) are the shared formatters used by StatCard/Overview/LimitsPanel/CostTreemap/CostsBoard/ActivityBoard. `FilterBar.tsx` is intentionally NOT deleted (still imported by `SessionsList.tsx`).
