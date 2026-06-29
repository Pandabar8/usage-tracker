# Usage Tracker — Design

**Date:** 2026-06-29
**Status:** Approved design, pending implementation plan
**Stack:** TypeScript · Astro (SSR, `@astrojs/node` standalone) · React islands · Recharts · Tailwind v4 · Vitest

## Goal

A personal, locally-run website that shows my own usage of **Claude Code** and **Codex**, side by side: tokens over time, estimated dollar cost, breakdown by project, breakdown by model, and Codex plan-quota consumption. It reads the data each tool already writes to disk on this Mac. No data leaves the machine; nothing is uploaded.

Run it on demand:

```
npm run dev -- --open      # parses ~/.claude + ~/.codex live, opens browser
```

## Data sources (verified on this machine)

### Claude Code — `~/.claude/projects/**/*.jsonl` (778 session transcripts)

Each assistant turn is one JSONL line. Relevant fields:

- `timestamp` — ISO 8601 (e.g. `2026-06-03T23:17:48.284Z`)
- `cwd` — project working directory (used to derive the project label)
- `sessionId`, `gitBranch`, `version`
- `message.model` — e.g. `claude-opus-4-8`
- `message.usage`:
  - `input_tokens`
  - `output_tokens`
  - `cache_creation_input_tokens` (cache write)
  - `cache_read_input_tokens` (cache read)
  - `service_tier`, plus `server_tool_use.{web_search_requests,web_fetch_requests}`

There is **no plan-quota / rate-limit block** in Claude transcripts.

### Codex — `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` (784 rollout files)

Per turn the relevant events are:

- `session_meta` (one per file) — `timestamp`, `cwd`, `cli_version`, `git`
- `turn_context` (per turn) — `model` (e.g. `gpt-5.3-codex`), `cwd`, `reasoning_effort`
- `event_msg` with `payload.type == "token_count"` — `payload.info`:
  - `total_token_usage` — **cumulative** for the session: `{input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens, total_tokens}`
  - `last_token_usage` — the **most recent turn's** usage, same shape
  - `model_context_window`
- `payload.rate_limits` (on `token_count` events) — `primary` (5h window) and `secondary` (weekly window), each with `used_percent`, `window_minutes`, `resets_at`; plus `credits`, `plan_type`

Note: `~/.codex/logs_2.sqlite` is TRACE-level diagnostics only — **not** a usage source. Ignore it.

## Normalized record

Both sources collapse to one shape (`src/lib/normalize.ts`):

```ts
type UsageRecord = {
  tool: "claude" | "codex";
  timestamp: string; // ISO 8601
  model: string; // claude-opus-4-8 | gpt-5.3-codex | ...
  project: string; // derived from cwd (see below)
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number; // claude: cache_creation_input_tokens; codex: 0
  cacheReadTokens: number; // claude: cache_read_input_tokens; codex: cached_input_tokens
  reasoningTokens: number; // codex: reasoning_output_tokens; claude: 0
  costUsd: number; // computed by pricing.ts
};
```

**Project label:** derive from `cwd`. Default to the basename of the path (e.g. `/Users/.../FinApp` → `FinApp`); keep the full path available for disambiguation when two projects share a basename. Records with no `cwd` are grouped under `(unknown)`.

## Architecture (small, framework-agnostic core + Astro shell)

The parsing/pricing/aggregation logic lives in `src/lib/` as pure functions with **no Astro imports**, so it is unit-tested in isolation and Astro is only the delivery shell.

- **`src/lib/parsers/claude.ts`** — `(filePath) -> UsageRecord[]`. One record per assistant turn that has a `usage` block. Skips malformed lines (counts them).
- **`src/lib/parsers/codex.ts`** — `(filePath) -> UsageRecord[]`. Walks events in order, tracking the current `turn_context.model` and the session `cwd`; emits one record per forward step in the cumulative **`total_token_usage`** (each record is the delta from the previous snapshot; duplicate/zero-delta snapshots are skipped; `last_token_usage` is not used). See "Codex accounting guard" below.
- **`src/lib/normalize.ts`** — the `UsageRecord` type + the `cwd → project` helper.
- **`src/lib/pricing.ts` + `src/lib/pricing.json`** — model → per-1M-token rates. `cost(record) -> usd`. Unknown model → cost 0 and the model is flagged `unpriced` in the UI. `pricing.json` is the editable source of truth (see Pricing below).
- **`src/lib/aggregate.ts`** — `UsageRecord[] -> Rollups`: by day, by project, by model, by tool; plus the latest Codex quota snapshot. Pure reducers.
- **`src/lib/cache.ts`** — in-memory store of parsed records keyed by file path + mtime. Because the Astro Node server is long-running, the first request parses everything (~1,500 files); later requests only re-parse files whose mtime changed. `POST /api/refresh` clears and rescans.
- **`src/lib/scan.ts`** — globs the two source dirs, runs the parsers through `cache.ts`, returns all records.

### Astro shell (SSR)

`astro.config.mjs`: `output: 'server'`, `adapter: node({ mode: 'standalone' })`, integrations `react()` + Tailwind v4 via `@tailwindcss/vite`.

- **`src/pages/index.astro`** — server-renders the dashboard: calls `scan()` + `aggregate()` at request time, passes rollups as props to the React islands. First paint already has data.
- **`src/pages/api/usage.ts`** — `GET`, returns aggregated rollups as JSON. Accepts query params for date range + tool filter so the client can re-fetch without a full reload.
- **`src/pages/api/refresh.ts`** — `POST`, forces a cache rescan, returns fresh rollups.
- **`src/components/`** — React islands (`client:load`) for the interactive charts; plain `.astro` components for static layout/cards.

### UI sections

- **Overview** — headline totals: total tokens, total estimated cost, split Claude vs Codex; date range of data.
- **Trend** — stacked area chart of tokens (or cost) over time, Claude vs Codex, daily granularity.
- **By project** — horizontal bar: top projects by tokens/cost, per tool.
- **By model** — bar/pie across `claude-opus-4-8`, `gpt-5.3-codex`, etc.; unpriced models flagged.
- **Quota** — Codex 5h + weekly windows from the latest `rate_limits` snapshot, with `used_percent` and reset times. Claude shows token volume against an optional configured plan limit, clearly labeled "estimated" (transcripts carry no real quota).

Filters: date-range picker + Claude/Codex toggle, plus a tokens↔cost toggle on the Trend chart.

## Three correctness decisions

1. **Codex accounting guard.** Each session logs cumulative `total_token_usage` on every `token_count` event. The parser derives each record from the **delta between consecutive cumulative snapshots** (duplicate snapshots → zero delta → skipped; a single component regressing while the total advances is clamped to 0; a true counter reset uses the current snapshot). It does **not** sum `last_token_usage`, which would over-count when Codex emits duplicate snapshots within a turn. A Vitest test pins the summed record totals against the session's final cumulative `total_token_usage` (the canonical value), and edge/reset fixtures exercise the duplicate and per-field-regression paths. This is the one real correctness risk in the project.

2. **Quota honesty.** Codex `rate_limits.used_percent` is real and is shown as-is. Claude has no quota signal in its transcripts, so the Claude side of the Quota panel shows token volume vs an optional, clearly-labeled configured plan limit — never a fabricated percentage.

3. **Cost is notional.** Both tools are flat-rate subscriptions, so dollars are "what this usage would cost at published API rates" (the ccusage framing). Cache-read tokens (very high volume, priced ~0.1× input) are weighted at their own rate so the figure is not wildly inflated.

## Pricing

`src/lib/pricing.json` is the editable source of truth. Rates are per 1,000,000 tokens, USD. Claude rates are seeded from current published Anthropic pricing; **GPT-5.x-codex rates are seeds to verify against OpenAI's published pricing** before trusting the dollar figures.

```jsonc
{
  // Claude — current published Anthropic rates (verified 2026-06-29)
  "claude-opus-4-8": {
    "input": 5,
    "output": 25,
    "cacheWrite": 6.25,
    "cacheRead": 0.5,
  },
  "claude-opus-4-7": {
    "input": 5,
    "output": 25,
    "cacheWrite": 6.25,
    "cacheRead": 0.5,
  },
  "claude-opus-4-6": {
    "input": 5,
    "output": 25,
    "cacheWrite": 6.25,
    "cacheRead": 0.5,
  },
  "claude-sonnet-4-6": {
    "input": 3,
    "output": 15,
    "cacheWrite": 3.75,
    "cacheRead": 0.3,
  },
  "claude-haiku-4-5": {
    "input": 1,
    "output": 5,
    "cacheWrite": 1.25,
    "cacheRead": 0.1,
  },
  "claude-fable-5": {
    "input": 10,
    "output": 50,
    "cacheWrite": 12.5,
    "cacheRead": 1.0,
  },

  // Codex / GPT-5.x — gpt-5.3-codex seeded from OpenAI published rates; re-confirm before trusting $ figures
  "gpt-5.3-codex": {
    "input": 1.75,
    "output": 14,
    "cacheWrite": 0,
    "cacheRead": 0.175,
  },
  "gpt-5-codex": { "input": 0, "output": 0, "cacheWrite": 0, "cacheRead": 0 },
}
```

`cost(record)` = `inputTokens·input + outputTokens·output + cacheWriteTokens·cacheWrite + cacheReadTokens·cacheRead`, each rate ÷ 1,000,000. `reasoningTokens` is **not** a separate cost term: for Codex it is already counted inside `output_tokens` (and billed at the output rate there), so adding it again would double-count. Unknown model → cost 0, flagged `unpriced`.

## Testing

- Vitest over `src/lib/` only (pure functions, no Astro runtime needed).
- Parser fixtures: a small trimmed real Claude transcript and a real Codex rollout, with **token totals pinned to literals read off the files** (canonical anchors), not recomputed by the parser's own formula.
- The Codex double-count test (decision #1) is the load-bearing one.

## How to run

- **Everyday (recommended):** `npm run dev -- --open` — Astro dev server, reads files live, hot reload, opens the browser.
- **Built local server:** `npm run build && node ./dist/server/entry.mjs` — standalone Node SSR server for a more "production" local run.

## Out of scope (v1)

- Cloud deploy / hosting (would require syncing local data up; revisit only if multi-device is wanted).
- Auth (single local user).
- Editing/annotating usage data.
- Real-time streaming updates (refresh-on-demand is enough).
- Historical pricing (rates are current-only; a record's cost uses today's `pricing.json`).

## Iteration points (expected post-build tweaks)

- Confirm/fill the GPT-5.x-codex pricing rates.
- Decide whether the Trend chart defaults to tokens or cost.
- Project-label collisions (same basename across different paths) — tune if it gets noisy.
- Optional: a configured Claude plan-token limit for the Quota panel.
