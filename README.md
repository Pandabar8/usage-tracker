# Usage Tracker

A local, read-only dashboard for your **Claude Code** and **Codex** usage. It parses the session logs those tools already write to your machine and turns them into token, cost, cache, quota, and session analytics. Nothing is uploaded; the app only reads files under your home directory.

## Why

Claude Code and Codex both leave rich JSONL transcripts on disk, but neither gives you a consolidated view of _how much_ you're using across projects and models, how close you are to your limits, or where your tokens and money go. This does.

It also takes correctness seriously: token math is validated against an independent recompute of the raw files, and it never fabricates numbers it can't know — see [Honesty](#honesty-about-limits).

## What it shows

- **Overview** — total tokens and notional cost, per-agent split, usage-over-time, model mix, cache-hit rate, an activity heatmap, a cost-by-project treemap, peak hours, and at-a-glance stat cards.
- **Limits & forecast** — for both agents, a 5-hour and weekly view. Codex uses its server-reported quota percentages; Claude shows rolling token **volume** (it exposes no server-side limit). A simple forecast projects Codex usage to the next reset.
- **Tips** — lightweight, data-driven suggestions (right-sizing model choice, cache discipline, quota pacing).
- **Sessions** — a sortable, filterable list of every session, plus a per-session **replay** (message-by-message, Claude and Codex) with compaction tracking.
- **Compare** — session-vs-session and model-vs-model diffs.
- **Search** — full-text across your sessions.
- **Costs / Activity** — dedicated deep-dive pages.

## Honesty about limits

Codex reports real rate-limit windows (`rate_limits` with `used_percent` for the 5-hour and weekly windows), so those are shown as true percentages. Claude Code exposes **no** server-side limit, so the tool never invents a percentage for it — instead it shows your rolling 5-hour and 7-day token **volume** relative to your own recent peak. Costs are **notional**, computed at public API rates (they don't reflect subscription pricing).

## Data sources

| Agent       | Location read                   |
| ----------- | ------------------------------- |
| Claude Code | `~/.claude/projects/**/*.jsonl` |
| Codex       | `~/.codex/sessions/**/*.jsonl`  |

Reads are local and read-only. Your usage data never leaves your machine and is **not** part of this repository.

## Retention protection

Claude Code deletes session logs older than `cleanupPeriodDays` (default **30**), so your history silently disappears after a month. Run this once to stop that and preserve your history going forward:

```bash
npm run fix-retention
```

It raises `cleanupPeriodDays` in `~/.claude/settings.json` to a large value. Note: it can only protect data that still exists — logs already deleted by the 30-day default are not recoverable.

## Quick start

```bash
npm install

# development (hot reload)
npm run dev

# or a production build + run
npm run build
node ./dist/server/entry.mjs        # serves on http://localhost:4321 (PORT to override)

# protect your Claude history from the 30-day purge
npm run fix-retention
```

Filter the whole dashboard by agent (All / Claude / Codex) and time range (7d / 30d / 90d / All) from the sidebar.

## Tech

Astro 5 (SSR, standalone Node adapter) · React 19 islands · Recharts + custom SVG · Tailwind v4 · Vitest 3 · TypeScript.

The core library is framework-agnostic and lives in `src/lib/`: `parsers → normalize → aggregate → pricing → scan`. The UI in `src/components/` and `src/pages/` consumes it.

## Tests

```bash
npm test            # vitest
npx tsc --noEmit    # typecheck
```

Token/cost aggregation is covered by canonical-pinned tests (assertions use independently-derived values, not the code's own output), including regression tests for Codex forked-session reconciliation and mid-session counter trims.

## Notes

- Personal tool, desktop-first.
- Costs are notional (public API rates), not billed amounts.
