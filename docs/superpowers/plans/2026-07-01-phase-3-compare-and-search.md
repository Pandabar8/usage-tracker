---
# Phase 3 — Compare + Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/compare` surface (side-by-side session and model diffs) and bounded, tolerant full-text message search across Claude + Codex session files, on top of the Phase 2 session modules.

**Architecture:** Three new pure `lib` modules feed the new surfaces: `search.ts` (case-insensitive snippet + per-session match) runs the Phase 2 message parsers on demand behind `/api/search`; `compare.ts` turns two `SessionSummary` or two per-model `ModelStats` into a metric-diff table; `aggregate.ts` gains a `modelStats` aggregator and a shared `cacheHitRate` helper both compare paths use. New Astro SSR routes (`/compare`, `/api/search`) and React islands (`Compare`, `SessionSearch`) consume them; nothing on the Overview or Sessions hot path changes shape.

**Tech Stack:** TypeScript (ESM), Astro 5 SSR (`@astrojs/node` standalone), React 19 islands, Tailwind v4, Vitest 3.

## Global Constraints
- Local-only, read-only, no-upload personal tool.
- Claude + Codex only, no OpenCode.
- Notional API-rate cost labeling on every surface.
- Quota/forecast computed from UNFILTERED records.
- Canonical-pinned tests asserting against literals, not the SUT's own formula.
- New fixtures are real-derived and cover every real line-type variety (multi-session rollouts, split-`message.id` turns, injected/synthetic context, compaction markers), not single-record stubs. Structural fidelity, not raw line count, is the bar.
- Node/Astro SSR stack.

## File Structure

### Created
- `src/lib/search.ts` — case-insensitive `snippet()` + `searchMessages()` over one session's `Message[]`; exported `SearchResult` type.
- `src/lib/search.test.ts` — canonical-pinned snippet + match tests over the Phase 2 message fixtures.
- `src/pages/api/search.ts` — GET `/api/search?q=`, bounded + tolerant scan across session files → `SearchResult[]`.
- `src/pages/api/search.test.ts` — endpoint test (match, tolerance, empty query).
- `src/lib/compare.ts` — pure `diffSessions()` / `diffModels()` → metric diff rows.
- `src/lib/compare.test.ts` — canonical-pinned diff-row tests (values, deltas, null side).
- `src/pages/compare.astro` — SSR `/compare` page passing summaries + model stats to the island.
- `src/components/Compare.tsx` — two-tab (sessions / models) picker + diff-table island.
- `src/components/SessionSearch.tsx` — search box island with `?q=` URL sync and results linking into `/sessions/[id]`.

### Modified
- `src/lib/aggregate.ts` — add `cacheHitRate()` helper, `ModelStats` interface, and `modelStats()` aggregator (per-model totals, session count, cache-hit-rate, per-session averages).
- `src/lib/aggregate.test.ts` — `cacheHitRate` + `modelStats` canonical tests.
- `src/pages/sessions/index.astro` — (created in Phase 2) render `SessionSearch` above the list, seeded from `?q=`.
- `src/layouts/Layout.astro` — (Phase 2 added the Overview/Sessions nav) add a `Compare` link.

---

### Task 1: `search.ts` — snippet + per-session message match

**Files:**

- Create: `src/lib/search.ts`
- Test: `src/lib/search.test.ts`

**Interfaces:**

- Consumes (from Phase 2): `Message`, `Tool` from `./normalize`; `parseClaudeMessages(path: string): Message[]` from `./parsers/claude-messages`; `parseCodexMessages(path: string, sessionId: string): Message[]` from `./parsers/codex-messages` (two args — the codex fixture's session id is `c9`; used by the test to build inputs).
- Produces: `function snippet(text: string, query: string, radius?: number): string`, `function searchMessages(messages: Message[], query: string): { matchCount: number; snippet: string } | null`, and `interface SearchResult { key: string; id: string; tool: Tool; project: string; snippet: string; matchCount: number; startedAt: string }` (the composite `key` is what results link on; consumed by Tasks 2 and 6).

Steps:

- [ ] Create `src/lib/search.test.ts`:

```ts
// src/lib/search.test.ts
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { snippet, searchMessages } from "./search";
import { parseClaudeMessages } from "./parsers/claude-messages";
import { parseCodexMessages } from "./parsers/codex-messages";

const claudeFixture = fileURLToPath(
  new URL("./parsers/__fixtures__/claude-messages.jsonl", import.meta.url),
);
const codexFixture = fileURLToPath(
  new URL("./parsers/__fixtures__/codex-messages.jsonl", import.meta.url),
);

describe("snippet", () => {
  it("returns the whole text (no ellipses) when it fits the window", () => {
    expect(snippet("The quick brown fox", "quick")).toBe("The quick brown fox");
  });

  it("returns an empty string when the query is absent", () => {
    expect(snippet("abc", "xyz")).toBe("");
    expect(snippet("abc", "")).toBe("");
  });

  it("clips around the first match with leading/trailing ellipses, case-insensitively", () => {
    const text = "x".repeat(100) + "NEEDLE" + "y".repeat(100);
    expect(snippet(text, "needle", 10)).toBe("…xxxxxxxxxxNEEDLEyyyyyyyyyy…");
  });
});

describe("searchMessages", () => {
  it("counts every matching Claude message and snippets the first hit", () => {
    const messages = parseClaudeMessages(claudeFixture);
    const hit = searchMessages(messages, "compaction");
    expect(hit).not.toBeNull();
    // Enlarged Phase 2 claude fixture (10 messages): matches messages[5]
    // "Continuing after compaction." and messages[7] (long prompt mentions
    // "compaction counts"). messages[4] says "compacted" (no "compaction"
    // substring); messages[6] micro marker has empty text.
    expect(hit!.matchCount).toBe(2);
    expect(hit!.snippet.toLowerCase()).toContain("compaction");
  });

  it("matches a Codex user message case-insensitively", () => {
    const messages = parseCodexMessages(codexFixture, "c9");
    const hit = searchMessages(messages, "run it");
    expect(hit).not.toBeNull();
    // Enlarged Phase 2 codex fixture (4 messages): only messages[2] "Now run it."
    expect(hit!.matchCount).toBe(1);
    expect(hit!.snippet).toContain("Now run it.");
  });

  it("returns null when nothing matches or the query is blank", () => {
    const messages = parseClaudeMessages(claudeFixture);
    expect(searchMessages(messages, "ZZZ-NO-MATCH")).toBeNull();
    expect(searchMessages(messages, "   ")).toBeNull();
  });
});
```

- [ ] Run it, expect FAIL: `npx vitest run src/lib/search.test.ts` → fails with `Failed to load url ./search` (module does not exist).

- [ ] Create `src/lib/search.ts`:

```ts
// src/lib/search.ts
import type { Message, Tool } from "./normalize";

// A session that contained at least one matching message, plus a one-line
// snippet from the first hit. Built by the /api/search route from the scan
// index; the pure matcher below produces matchCount + snippet.
export interface SearchResult {
  key: string; // composite `${tool}:${sessionId}` — what results link on
  id: string;
  tool: Tool;
  project: string;
  snippet: string;
  matchCount: number;
  startedAt: string;
}

// Case-insensitive substring position; -1 when the query is empty or absent.
function indexOfCI(text: string, query: string): number {
  if (!query) return -1;
  return text.toLowerCase().indexOf(query.toLowerCase());
}

// One-line context window around the first match of `query` in `text`, with
// leading/trailing ellipses when the window is clipped. Internal whitespace is
// collapsed to single spaces so a multi-line message renders on one row.
export function snippet(text: string, query: string, radius = 60): string {
  const at = indexOfCI(text, query);
  if (at < 0) return "";
  const start = Math.max(0, at - radius);
  const end = Math.min(text.length, at + query.length + radius);
  const core = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${core}${end < text.length ? "…" : ""}`;
}

// Scans one session's messages for a case-insensitive substring, searching the
// full (untruncated) payload text. Returns the number of matching messages and
// a snippet from the first match, or null when the query is blank or unmatched.
export function searchMessages(
  messages: Message[],
  query: string,
): { matchCount: number; snippet: string } | null {
  const q = query.trim();
  if (!q) return null;
  let matchCount = 0;
  let firstSnippet = "";
  for (const m of messages) {
    if (indexOfCI(m.text, q) >= 0) {
      matchCount += 1;
      if (!firstSnippet) firstSnippet = snippet(m.text, q);
    }
  }
  return matchCount > 0 ? { matchCount, snippet: firstSnippet } : null;
}
```

- [ ] Run it, expect PASS: `npx vitest run src/lib/search.test.ts` → all green.
- [ ] Commit: `git add src/lib/search.ts src/lib/search.test.ts && git commit -m "feat(lib): add full-text message search with case-insensitive snippet extraction"`

---

### Task 2: `/api/search` endpoint (bounded, tolerant)

**Files:**

- Create: `src/pages/api/search.ts`
- Test: `src/pages/api/search.test.ts`

**Interfaces:**

- Consumes (from Phase 2): `scan()` returning `{ records, codexQuota, sessionMeta: Map<string, SessionMeta>, sessionIndex: Map<string, { files: string[]; tool: Tool; sessionId: string }> }` from `../../lib/scan` — both maps keyed by the composite `` `${tool}:${sessionId}` `` route key; the index value lists every file for that session and carries the raw `sessionId` the Codex message parser needs; `groupSessions(records, meta, pricing?): SessionSummary[]` from `../../lib/sessions`; `Message` type from `../../lib/normalize`; `parseClaudeMessages`/`parseCodexMessages` from `../../lib/parsers/*-messages`; `defaultPricing` from `../../lib/pricing`. From Task 1: `searchMessages`, `SearchResult`.
- Produces: `export const GET: APIRoute` returning `SearchResult[]` (JSON, 200); `[]` for a blank query. Parses **every** file in each session's `entry.files` and concatenates them (per-file tolerant, so one unreadable file drops only that file, not the whole session), then searches the combined messages. Consumed by Task 6's island.

Steps:

- [ ] Create `src/pages/api/search.test.ts` (mocks `scan`, points the index at the real Phase 2 fixtures + one missing file to prove tolerance):

```ts
// src/pages/api/search.test.ts
import { describe, it, expect, vi } from "vitest";
import type { SessionMeta } from "../../lib/normalize";

// vitest hoists vi.mock above the imports, so the factory cannot read
// module-scope consts. Fixture paths are computed in vi.hoisted (import.meta.url
// IS available there) and the rec builder / SessionMeta map / sessionIndex are
// all constructed INSIDE the factory. Each sessionIndex value uses the NEW
// Phase 2 shape `{ files: string[]; tool }` — a list of files per session id.
const { claudeFixture, codexFixture } = vi.hoisted(() => ({
  claudeFixture: new URL(
    "../../lib/parsers/__fixtures__/claude-messages.jsonl",
    import.meta.url,
  ).pathname,
  codexFixture: new URL(
    "../../lib/parsers/__fixtures__/codex-messages.jsonl",
    import.meta.url,
  ).pathname,
}));

vi.mock("../../lib/scan", () => {
  const rec = (over: Record<string, unknown>) => ({
    tool: "claude",
    timestamp: "2026-06-10T10:00:00.000Z",
    model: "claude-opus-4-8",
    project: "ProjX",
    sessionId: "m1",
    inputTokens: 1,
    outputTokens: 1,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    reasoningTokens: 0,
    ...over,
  });
  return {
    scan: () => ({
      records: [
        rec({
          sessionId: "m1",
          project: "ProjX",
          timestamp: "2026-06-10T10:00:00.000Z",
        }),
        rec({
          tool: "codex",
          model: "gpt-5.3-codex",
          sessionId: "c9",
          project: "ProjB",
          timestamp: "2026-06-11T09:00:00.000Z",
        }),
        rec({
          sessionId: "bad",
          project: "ProjBad",
          timestamp: "2026-06-09T10:00:00.000Z",
        }),
      ],
      codexQuota: null,
      sessionMeta: new Map<string, SessionMeta>([
        [
          "claude:m1",
          {
            sessionId: "m1",
            tool: "claude",
            turns: 3,
            toolCalls: 1,
            models: ["claude-opus-4-8"],
            startedAt: "2026-06-10T10:00:00.000Z",
            endedAt: "2026-06-10T10:07:00.000Z",
          },
        ],
        [
          "codex:c9",
          {
            sessionId: "c9",
            tool: "codex",
            turns: 2,
            toolCalls: 2,
            models: ["gpt-5.3-codex"],
            startedAt: "2026-06-11T09:00:00.000Z",
            endedAt: "2026-06-11T09:00:25.000Z",
          },
        ],
        [
          "claude:bad",
          {
            sessionId: "bad",
            tool: "claude",
            turns: 1,
            toolCalls: 0,
            models: ["claude-opus-4-8"],
            startedAt: "2026-06-09T10:00:00.000Z",
            endedAt: "2026-06-09T10:00:00.000Z",
          },
        ],
      ]),
      sessionIndex: new Map([
        [
          "claude:m1",
          { files: [claudeFixture], tool: "claude", sessionId: "m1" },
        ],
        ["codex:c9", { files: [codexFixture], tool: "codex", sessionId: "c9" }],
        [
          "claude:bad",
          { files: ["/no/such/file.jsonl"], tool: "claude", sessionId: "bad" },
        ],
      ]),
    }),
  };
});

describe("GET /api/search", () => {
  it("returns only sessions whose messages match, with count + snippet", async () => {
    const { GET } = await import("./search");
    const res = await GET({
      url: new URL("http://localhost/api/search?q=compaction"),
    } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe("m1");
    expect(body[0].tool).toBe("claude");
    // Enlarged Phase 2 claude fixture: "compaction" hits messages[5]
    // "Continuing after compaction." and messages[7] (the long prompt mentions
    // "compaction counts"). messages[4] says "compacted" (no "compaction"
    // substring) and the micro marker messages[6] has empty text.
    expect(body[0].matchCount).toBe(2);
    expect(body[0].snippet.toLowerCase()).toContain("compaction");
  });

  it("matches Codex sessions and skips the unreadable file without failing", async () => {
    const { GET } = await import("./search");
    const res = await GET({
      url: new URL("http://localhost/api/search?q=run%20it"),
    } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    // Enlarged Phase 2 codex fixture: "run it" hits only c9 (messages[2]
    // "Now run it."); the "bad" session's single file in files[] threw on parse
    // and was skipped, leaving c9 as the only result.
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe("c9");
    expect(body[0].tool).toBe("codex");
  });

  it("returns an empty array for a blank query", async () => {
    const { GET } = await import("./search");
    const res = await GET({
      url: new URL("http://localhost/api/search?q="),
    } as any);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});
```

- [ ] Run it, expect FAIL: `npx vitest run "src/pages/api/search.test.ts"` → fails with `Failed to load url ./search` (module does not exist).

- [ ] Create `src/pages/api/search.ts`:

```ts
// src/pages/api/search.ts
import type { APIRoute } from "astro";
import { scan } from "../../lib/scan";
import { groupSessions } from "../../lib/sessions";
import { defaultPricing } from "../../lib/pricing";
import type { Message } from "../../lib/normalize";
import { parseClaudeMessages } from "../../lib/parsers/claude-messages";
import { parseCodexMessages } from "../../lib/parsers/codex-messages";
import { searchMessages, type SearchResult } from "../../lib/search";

export const prerender = false;

// Bounds keep search cheap on a large history: at most SCAN_CAP sessions are
// parsed per query, and at most RESULT_CAP sessions are returned. Sessions are
// visited in groupSessions order so the caps keep a stable, freshest-first set.
const SCAN_CAP = 500;
const RESULT_CAP = 50;
// Coarse total-work bound: cap the number of files parsed across ALL scanned
// sessions. A session can reference many files, and a shared Codex file is parsed
// once per session id it holds, so bounding sessions alone is not enough.
const FILE_CAP = 4000;

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

export const GET: APIRoute = ({ url }) => {
  const q = (url.searchParams.get("q") ?? "").trim();
  if (!q) return json([]);

  const { records, sessionMeta, sessionIndex } = scan();
  const summaries = groupSessions(records, sessionMeta, defaultPricing);

  const results: SearchResult[] = [];
  let scanned = 0;
  let filesParsed = 0;
  for (const s of summaries) {
    if (
      scanned >= SCAN_CAP ||
      results.length >= RESULT_CAP ||
      filesParsed >= FILE_CAP
    )
      break;
    const entry = sessionIndex.get(s.key);
    if (!entry) continue;
    scanned += 1;

    // A session id can span more than one file, so parse every file the index
    // recorded and concatenate. Each file is parsed under its own try/catch so a
    // single vanished/corrupt file drops only that file, not the whole session.
    const messages: Message[] = [];
    for (const file of entry.files) {
      if (filesParsed >= FILE_CAP) break;
      filesParsed += 1;
      try {
        const parsed =
          entry.tool === "claude"
            ? parseClaudeMessages(file)
            : parseCodexMessages(file, entry.sessionId);
        messages.push(...parsed);
      } catch {
        continue; // vanished/corrupt file: skip it, keep the readable files
      }
    }
    if (messages.length === 0) continue; // every file was unreadable
    messages.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    const hit = searchMessages(messages, q);
    if (hit) {
      results.push({
        key: s.key,
        id: s.id,
        tool: s.tool,
        project: s.project,
        snippet: hit.snippet,
        matchCount: hit.matchCount,
        startedAt: s.startedAt,
      });
    }
  }

  return json(results);
};
```

- [ ] Run it, expect PASS: `npx vitest run "src/pages/api/search.test.ts"` → all green.
- [ ] Commit: `git add "src/pages/api/search.ts" "src/pages/api/search.test.ts" && git commit -m "feat(api): serve bounded full-text search across session files"`

---

### Task 3: `aggregate.ts` — `cacheHitRate` + per-model `modelStats`

**Files:**

- Modify: `src/lib/aggregate.ts` (append `cacheHitRate()`, the `ModelStats` interface, and `modelStats()` after the existing `aggregate()` function; the file already imports `totalTokens`, `isPriced`, `cost`, `defaultPricing`, `PricingTable`, `Tool`, `UsageRecord`).
- Test: `src/lib/aggregate.test.ts` (extend; change the import on line 3, append new describes; the file already has a `rec()` helper and imports `type PricingTable`).

**Interfaces:**

- Consumes: `UsageRecord`, `Tool`, `totalTokens` from `./normalize`; `cost`, `isPriced`, `defaultPricing`, `PricingTable` from `./pricing` (all already imported).
- Produces: `function cacheHitRate(inputTokens: number, cacheReadTokens: number): number`; `interface ModelStats`; `function modelStats(records: UsageRecord[], pricing?: PricingTable): ModelStats[]` (consumed by Tasks 4, 5).

Steps:

- [ ] Change line 3 of `src/lib/aggregate.test.ts` from `import { aggregate, claudeWindows } from "./aggregate";` to:

```ts
import {
  aggregate,
  cacheHitRate,
  claudeWindows,
  modelStats,
} from "./aggregate";
```

- [ ] Append to `src/lib/aggregate.test.ts`:

```ts
const statsPricing: PricingTable = {
  "claude-opus-4-8": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "gpt-5.3-codex": { input: 1.75, output: 14, cacheWrite: 0, cacheRead: 0.175 },
};

describe("cacheHitRate", () => {
  it("computes the cache-read share of read-side tokens", () => {
    expect(cacheHitRate(100, 300)).toBe(0.75); // 300 / (100 + 300)
    expect(cacheHitRate(200, 800)).toBe(0.8); // 800 / 1000
  });
  it("returns 0 when there are no read-side tokens", () => {
    expect(cacheHitRate(0, 0)).toBe(0);
    expect(cacheHitRate(100, 0)).toBe(0);
  });
});

describe("modelStats", () => {
  const records = [
    rec({
      sessionId: "s1",
      inputTokens: 100,
      outputTokens: 50,
      cacheWriteTokens: 200,
      cacheReadTokens: 300,
    }),
    rec({ sessionId: "s2", inputTokens: 10, outputTokens: 5 }),
    rec({
      tool: "codex",
      model: "gpt-5.3-codex",
      sessionId: "c1",
      inputTokens: 200,
      outputTokens: 100,
      cacheReadTokens: 800,
      reasoningTokens: 40,
    }),
  ];
  const stats = modelStats(records, statsPricing);

  it("sorts models by total tokens descending", () => {
    expect(stats.map((s) => s.model)).toEqual([
      "gpt-5.3-codex",
      "claude-opus-4-8",
    ]);
  });

  it("pins opus aggregates, session count, cache-hit-rate, and per-session averages", () => {
    const opus = stats.find((s) => s.model === "claude-opus-4-8")!;
    expect(opus).toMatchObject({
      tool: "claude",
      inputTokens: 110,
      outputTokens: 55,
      cacheWriteTokens: 200,
      cacheReadTokens: 300,
      totalTokens: 665,
      sessions: 2,
      unpriced: false,
    });
    expect(opus.cost).toBeCloseTo(0.003325, 10); // 3150/1e6 + 175/1e6
    expect(opus.cacheHitRate).toBeCloseTo(0.7317073170731707, 12); // 300/410
    expect(opus.avgTokensPerSession).toBe(332.5); // 665 / 2
    expect(opus.avgCostPerSession).toBeCloseTo(0.0016625, 12);
  });

  it("pins codex aggregates and single-session averages", () => {
    const codex = stats.find((s) => s.model === "gpt-5.3-codex")!;
    expect(codex.totalTokens).toBe(1100); // 200 + 100 + 0 + 800
    expect(codex.sessions).toBe(1);
    expect(codex.cacheHitRate).toBe(0.8); // 800 / 1000
    expect(codex.cost).toBeCloseTo(0.00189, 10); // (200*1.75 + 100*14 + 800*0.175)/1e6
    expect(codex.avgTokensPerSession).toBe(1100);
    expect(codex.avgCostPerSession).toBeCloseTo(0.00189, 10);
  });
});
```

- [ ] Run it, expect FAIL: `npx vitest run src/lib/aggregate.test.ts` → fails with `"cacheHitRate" is not exported` / `"modelStats" is not exported`.

- [ ] Append to `src/lib/aggregate.ts` (after the existing `aggregate` function, at end of file):

```ts
// Share of read-side tokens served from cache: cacheRead / (input + cacheRead).
// Returns 0 when there were no read-side tokens (avoids divide-by-zero).
export function cacheHitRate(
  inputTokens: number,
  cacheReadTokens: number,
): number {
  const denom = inputTokens + cacheReadTokens;
  return denom > 0 ? cacheReadTokens / denom : 0;
}

export interface ModelStats {
  model: string;
  tool: Tool;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  cost: number; // notional, API-rate
  unpriced: boolean;
  sessions: number; // distinct session ids that used this model
  cacheHitRate: number;
  avgTokensPerSession: number;
  avgCostPerSession: number;
}

// Per-model aggregation for the model-compare surface: token totals, notional
// cost, distinct-session count, cache-hit-rate, and per-session averages.
// Keyed by [tool, model] to match aggregate()'s byModel grouping; sorted by
// total tokens descending.
export function modelStats(
  records: UsageRecord[],
  pricing: PricingTable = defaultPricing,
): ModelStats[] {
  interface Acc {
    model: string;
    tool: Tool;
    inputTokens: number;
    outputTokens: number;
    cacheWriteTokens: number;
    cacheReadTokens: number;
    totalTokens: number;
    cost: number;
    unpriced: boolean;
    sessions: Set<string>;
  }
  const map = new Map<string, Acc>();

  for (const r of records) {
    const key = JSON.stringify([r.tool, r.model]);
    let a = map.get(key);
    if (!a) {
      a = {
        model: r.model,
        tool: r.tool,
        inputTokens: 0,
        outputTokens: 0,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 0,
        cost: 0,
        unpriced: !isPriced(r.model, pricing),
        sessions: new Set(),
      };
      map.set(key, a);
    }
    a.inputTokens += r.inputTokens;
    a.outputTokens += r.outputTokens;
    a.cacheWriteTokens += r.cacheWriteTokens;
    a.cacheReadTokens += r.cacheReadTokens;
    a.totalTokens += totalTokens(r);
    a.cost += cost(r, pricing);
    if (r.sessionId) a.sessions.add(r.sessionId);
  }

  const out: ModelStats[] = [];
  for (const a of map.values()) {
    const sessions = a.sessions.size;
    out.push({
      model: a.model,
      tool: a.tool,
      inputTokens: a.inputTokens,
      outputTokens: a.outputTokens,
      cacheWriteTokens: a.cacheWriteTokens,
      cacheReadTokens: a.cacheReadTokens,
      totalTokens: a.totalTokens,
      cost: a.cost,
      unpriced: a.unpriced,
      sessions,
      cacheHitRate: cacheHitRate(a.inputTokens, a.cacheReadTokens),
      avgTokensPerSession: sessions > 0 ? a.totalTokens / sessions : 0,
      avgCostPerSession: sessions > 0 ? a.cost / sessions : 0,
    });
  }
  out.sort((x, y) => y.totalTokens - x.totalTokens);
  return out;
}
```

- [ ] Run it, expect PASS: `npx vitest run src/lib/aggregate.test.ts` → all green (existing `aggregate`/`claudeWindows` tests unchanged).
- [ ] Commit: `git add src/lib/aggregate.ts src/lib/aggregate.test.ts && git commit -m "feat(lib): add per-model stats and cache-hit-rate helpers for comparison"`

---

### Task 4: `compare.ts` — session + model diff helpers

**Files:**

- Create: `src/lib/compare.ts`
- Test: `src/lib/compare.test.ts`

**Interfaces:**

- Consumes: `SessionSummary` from `./normalize` (Phase 2 Task 1); `cacheHitRate`, `ModelStats` from `./aggregate` (Task 3).
- Produces: `type DiffKind = "int" | "usd" | "pct" | "dur"`; `interface DiffRow { key: string; label: string; a: number; b: number; delta: number; kind: DiffKind }`; `interface Diff<T> { a: T | null; b: T | null; rows: DiffRow[] }`; `function diffSessions(a: SessionSummary | null, b: SessionSummary | null): Diff<SessionSummary>`; `function diffModels(a: ModelStats | null, b: ModelStats | null): Diff<ModelStats>` (consumed by Task 5).

Steps:

- [ ] Create `src/lib/compare.test.ts`:

```ts
// src/lib/compare.test.ts
import { describe, it, expect } from "vitest";
import { diffSessions, diffModels, type DiffRow } from "./compare";
import type { SessionSummary } from "./normalize";
import type { ModelStats } from "./aggregate";

const row = (rows: DiffRow[], key: string) => rows.find((r) => r.key === key)!;

const sA: SessionSummary = {
  key: "claude:s1",
  id: "s1",
  tool: "claude",
  project: "ProjA",
  models: ["claude-opus-4-8"],
  startedAt: "2026-06-01T10:00:00.000Z",
  endedAt: "2026-06-01T12:00:00.000Z",
  durationMs: 7200000,
  turns: 5,
  toolCalls: 3,
  tokens: { input: 110, output: 55, cacheWrite: 200, cacheRead: 300 },
  totalTokens: 665,
  cost: 0.003325,
  unpriced: false,
};

const sB: SessionSummary = {
  key: "codex:c1",
  id: "c1",
  tool: "codex",
  project: "ProjB",
  models: ["gpt-5.3-codex"],
  startedAt: "2026-06-02T09:00:00.000Z",
  endedAt: "2026-06-02T09:30:00.000Z",
  durationMs: 1800000,
  turns: 2,
  toolCalls: 4,
  tokens: { input: 200, output: 100, cacheWrite: 0, cacheRead: 800 },
  totalTokens: 1100,
  cost: 0.00189,
  unpriced: false,
};

describe("diffSessions", () => {
  it("pins values, kinds, and B-minus-A deltas per metric", () => {
    const { rows } = diffSessions(sA, sB);
    expect(row(rows, "totalTokens")).toMatchObject({
      a: 665,
      b: 1100,
      delta: 435,
      kind: "int",
    });
    expect(row(rows, "input")).toMatchObject({ a: 110, b: 200, delta: 90 });
    expect(row(rows, "output")).toMatchObject({ a: 55, b: 100, delta: 45 });
    expect(row(rows, "toolCalls")).toMatchObject({ a: 3, b: 4, delta: 1 });
    expect(row(rows, "turns")).toMatchObject({ a: 5, b: 2, delta: -3 });
    expect(row(rows, "durationMs")).toMatchObject({
      a: 7200000,
      b: 1800000,
      delta: -5400000,
      kind: "dur",
    });

    const cost = row(rows, "cost");
    expect(cost.kind).toBe("usd");
    expect(cost.delta).toBeCloseTo(-0.001435, 10); // 0.00189 - 0.003325

    const chr = row(rows, "cacheHitRate");
    expect(chr.kind).toBe("pct");
    expect(chr.a).toBeCloseTo(0.7317073170731707, 12); // 300/410
    expect(chr.b).toBe(0.8); // 800/1000
    expect(chr.delta).toBeCloseTo(0.0682926829268293, 12);
  });

  it("treats a missing side as zeros and negates the present side", () => {
    const { a, b, rows } = diffSessions(sA, null);
    expect(a).toBe(sA);
    expect(b).toBeNull();
    expect(row(rows, "totalTokens")).toMatchObject({
      a: 665,
      b: 0,
      delta: -665,
    });
  });
});

const mA: ModelStats = {
  model: "claude-opus-4-8",
  tool: "claude",
  inputTokens: 110,
  outputTokens: 55,
  cacheWriteTokens: 200,
  cacheReadTokens: 300,
  totalTokens: 665,
  cost: 0.003325,
  unpriced: false,
  sessions: 2,
  cacheHitRate: 0.7317073170731707,
  avgTokensPerSession: 332.5,
  avgCostPerSession: 0.0016625,
};

const mB: ModelStats = {
  model: "gpt-5.3-codex",
  tool: "codex",
  inputTokens: 200,
  outputTokens: 100,
  cacheWriteTokens: 0,
  cacheReadTokens: 800,
  totalTokens: 1100,
  cost: 0.00189,
  unpriced: false,
  sessions: 1,
  cacheHitRate: 0.8,
  avgTokensPerSession: 1100,
  avgCostPerSession: 0.00189,
};

describe("diffModels", () => {
  it("pins values and deltas for the model-compare rows", () => {
    const { rows } = diffModels(mA, mB);
    expect(row(rows, "input")).toMatchObject({ a: 110, b: 200, delta: 90 });
    expect(row(rows, "output")).toMatchObject({ a: 55, b: 100, delta: 45 });
    expect(row(rows, "sessions")).toMatchObject({ a: 2, b: 1, delta: -1 });
    expect(row(rows, "avgTokensPerSession")).toMatchObject({
      a: 332.5,
      b: 1100,
      delta: 767.5,
    });

    const chr = row(rows, "cacheHitRate");
    expect(chr.kind).toBe("pct");
    expect(chr.delta).toBeCloseTo(0.0682926829268293, 12);

    const avgCost = row(rows, "avgCostPerSession");
    expect(avgCost.kind).toBe("usd");
    expect(avgCost.delta).toBeCloseTo(0.0002275, 12); // 0.00189 - 0.0016625
  });
});
```

- [ ] Run it, expect FAIL: `npx vitest run src/lib/compare.test.ts` → fails with `Failed to load url ./compare` (module does not exist).

- [ ] Create `src/lib/compare.ts`:

```ts
// src/lib/compare.ts
import { cacheHitRate, type ModelStats } from "./aggregate";
import type { SessionSummary } from "./normalize";

export type DiffKind = "int" | "usd" | "pct" | "dur";

export interface DiffRow {
  key: string;
  label: string;
  a: number;
  b: number;
  delta: number; // b - a
  kind: DiffKind;
}

export interface Diff<T> {
  a: T | null;
  b: T | null;
  rows: DiffRow[];
}

function makeRow(
  key: string,
  label: string,
  a: number,
  b: number,
  kind: DiffKind,
): DiffRow {
  return { key, label, a, b, delta: b - a, kind };
}

// Side-by-side metric diff for two session summaries. A missing side reads as
// zeros so a half-selected comparison still renders. Cache-hit-rate is derived
// from each summary's input/cache-read tokens via the shared helper.
export function diffSessions(
  a: SessionSummary | null,
  b: SessionSummary | null,
): Diff<SessionSummary> {
  const rows: DiffRow[] = [
    makeRow(
      "totalTokens",
      "Total tokens",
      a?.totalTokens ?? 0,
      b?.totalTokens ?? 0,
      "int",
    ),
    makeRow(
      "input",
      "Input tokens",
      a?.tokens.input ?? 0,
      b?.tokens.input ?? 0,
      "int",
    ),
    makeRow(
      "output",
      "Output tokens",
      a?.tokens.output ?? 0,
      b?.tokens.output ?? 0,
      "int",
    ),
    makeRow(
      "cacheHitRate",
      "Cache hit rate",
      cacheHitRate(a?.tokens.input ?? 0, a?.tokens.cacheRead ?? 0),
      cacheHitRate(b?.tokens.input ?? 0, b?.tokens.cacheRead ?? 0),
      "pct",
    ),
    makeRow("cost", "Cost (notional)", a?.cost ?? 0, b?.cost ?? 0, "usd"),
    makeRow(
      "toolCalls",
      "Tool calls",
      a?.toolCalls ?? 0,
      b?.toolCalls ?? 0,
      "int",
    ),
    makeRow("turns", "Turns", a?.turns ?? 0, b?.turns ?? 0, "int"),
    makeRow(
      "durationMs",
      "Duration",
      a?.durationMs ?? 0,
      b?.durationMs ?? 0,
      "dur",
    ),
  ];
  return { a: a ?? null, b: b ?? null, rows };
}

// Side-by-side metric diff for two per-model aggregates. A missing side reads as
// zeros. cacheHitRate is already precomputed on ModelStats.
export function diffModels(
  a: ModelStats | null,
  b: ModelStats | null,
): Diff<ModelStats> {
  const rows: DiffRow[] = [
    makeRow(
      "input",
      "Input tokens",
      a?.inputTokens ?? 0,
      b?.inputTokens ?? 0,
      "int",
    ),
    makeRow(
      "output",
      "Output tokens",
      a?.outputTokens ?? 0,
      b?.outputTokens ?? 0,
      "int",
    ),
    makeRow(
      "cacheHitRate",
      "Cache hit rate",
      a?.cacheHitRate ?? 0,
      b?.cacheHitRate ?? 0,
      "pct",
    ),
    makeRow("cost", "Cost (notional)", a?.cost ?? 0, b?.cost ?? 0, "usd"),
    makeRow(
      "avgTokensPerSession",
      "Avg tokens / session",
      a?.avgTokensPerSession ?? 0,
      b?.avgTokensPerSession ?? 0,
      "int",
    ),
    makeRow(
      "avgCostPerSession",
      "Avg cost / session",
      a?.avgCostPerSession ?? 0,
      b?.avgCostPerSession ?? 0,
      "usd",
    ),
    makeRow("sessions", "Sessions", a?.sessions ?? 0, b?.sessions ?? 0, "int"),
  ];
  return { a: a ?? null, b: b ?? null, rows };
}
```

- [ ] Run it, expect PASS: `npx vitest run src/lib/compare.test.ts` → all green.
- [ ] Run the full suite, expect PASS: `npx vitest run` → all green.
- [ ] Commit: `git add src/lib/compare.ts src/lib/compare.test.ts && git commit -m "feat(lib): add session and model comparison diff helpers"`

---

### Task 5: `/compare` page + `Compare` island (session + model tabs)

**Files:**

- Create: `src/components/Compare.tsx`
- Create: `src/pages/compare.astro`

**Interfaces:**

- Consumes: `SessionSummary` from `../lib/normalize`; `ModelStats` from `../lib/aggregate`; `diffSessions`, `diffModels`, `DiffRow` from `../lib/compare` (Task 4); `scan`, `groupSessions`, `modelStats`, `defaultPricing` in the page frontmatter.
- Produces: `/compare` SSR route rendering `Compare`.

Steps:

- [ ] Create `src/pages/compare.astro` (references `Compare` before it exists, so it is the failing red gate for the build):

```astro
---
import Layout from '../layouts/Layout.astro';
import Compare from '../components/Compare.tsx';
import { scan } from '../lib/scan';
import { groupSessions } from '../lib/sessions';
import { modelStats } from '../lib/aggregate';
import { defaultPricing } from '../lib/pricing';

export const prerender = false;

const { records, sessionMeta } = scan();
const sessions = groupSessions(records, sessionMeta, defaultPricing);
const models = modelStats(records, defaultPricing);
---
<Layout title="Compare">
  <Compare client:load sessions={sessions} models={models} />
</Layout>
```

- [ ] Run build, expect FAIL: `npm run build` → fails to resolve `../components/Compare.tsx` (module does not exist).

- [ ] Create `src/components/Compare.tsx`:

```tsx
// src/components/Compare.tsx
import { useState } from "react";
import type { SessionSummary } from "../lib/normalize";
import type { ModelStats } from "../lib/aggregate";
import { diffSessions, diffModels, type DiffRow } from "../lib/compare";

const fmtInt = (n: number) =>
  new Intl.NumberFormat("en-US").format(Math.round(n));
const fmtUsd = (n: number) => `$${n.toFixed(4)}`;
const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;

function fmtDur(ms: number): string {
  if (ms <= 0) return "-";
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function fmtVal(kind: DiffRow["kind"], n: number): string {
  switch (kind) {
    case "usd":
      return fmtUsd(n);
    case "pct":
      return fmtPct(n);
    case "dur":
      return fmtDur(n);
    default:
      return fmtInt(n);
  }
}

function fmtDelta(kind: DiffRow["kind"], n: number): string {
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  const mag = Math.abs(n);
  const body =
    kind === "usd"
      ? `$${mag.toFixed(4)}`
      : kind === "pct"
        ? `${(mag * 100).toFixed(1)}pp`
        : kind === "dur"
          ? fmtDur(mag)
          : fmtInt(mag);
  return `${sign}${body}`;
}

export default function Compare({
  sessions,
  models,
}: {
  sessions: SessionSummary[];
  models: ModelStats[];
}) {
  const [tab, setTab] = useState<"sessions" | "models">("sessions");
  return (
    <div className="space-y-6">
      <div className="flex gap-2 text-sm">
        {(["sessions", "models"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1 rounded ${tab === t ? "bg-blue-500 text-white" : "bg-neutral-800 text-neutral-300"}`}
          >
            {t === "sessions" ? "Sessions" : "Models"}
          </button>
        ))}
      </div>
      <p className="text-xs text-neutral-500">
        Costs are notional, computed at public API rates.
      </p>
      {tab === "sessions" ? (
        <SessionCompare sessions={sessions} />
      ) : (
        <ModelCompare models={models} />
      )}
    </div>
  );
}

function SessionCompare({ sessions }: { sessions: SessionSummary[] }) {
  const [aKey, setAKey] = useState(sessions[0]?.key ?? "");
  const [bKey, setBKey] = useState(sessions[1]?.key ?? sessions[0]?.key ?? "");
  const a = sessions.find((s) => s.key === aKey) ?? null;
  const b = sessions.find((s) => s.key === bKey) ?? null;
  const diff = diffSessions(a, b);
  const label = (s: SessionSummary) =>
    `${s.project} · ${s.tool} · ${new Date(s.startedAt).toLocaleDateString()}`;

  if (sessions.length === 0) {
    return <p className="text-neutral-400">No sessions to compare.</p>;
  }
  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-2 gap-4">
        <Picker
          label="Session A"
          value={aKey}
          onChange={setAKey}
          options={sessions.map((s) => ({ value: s.key, label: label(s) }))}
        />
        <Picker
          label="Session B"
          value={bKey}
          onChange={setBKey}
          options={sessions.map((s) => ({ value: s.key, label: label(s) }))}
        />
      </div>
      <DiffTable
        rows={diff.rows}
        aName={a ? label(a) : "A"}
        bName={b ? label(b) : "B"}
      />
    </div>
  );
}

function ModelCompare({ models }: { models: ModelStats[] }) {
  const key = (m: ModelStats) => `${m.tool}:${m.model}`;
  const [aKey, setAKey] = useState(models[0] ? key(models[0]) : "");
  const [bKey, setBKey] = useState(
    models[1] ? key(models[1]) : models[0] ? key(models[0]) : "",
  );
  const a = models.find((m) => key(m) === aKey) ?? null;
  const b = models.find((m) => key(m) === bKey) ?? null;
  const diff = diffModels(a, b);
  const label = (m: ModelStats) => `${m.model} (${m.tool})`;

  if (models.length === 0) {
    return <p className="text-neutral-400">No models to compare.</p>;
  }
  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-2 gap-4">
        <Picker
          label="Model A"
          value={aKey}
          onChange={setAKey}
          options={models.map((m) => ({ value: key(m), label: label(m) }))}
        />
        <Picker
          label="Model B"
          value={bKey}
          onChange={setBKey}
          options={models.map((m) => ({ value: key(m), label: label(m) }))}
        />
      </div>
      <DiffTable
        rows={diff.rows}
        aName={a ? label(a) : "A"}
        bName={b ? label(b) : "B"}
      />
    </div>
  );
}

function Picker({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block text-sm">
      <span className="text-neutral-400">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full bg-neutral-800 rounded px-2 py-1 text-neutral-100"
      >
        {options.length === 0 && <option value="">(none)</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function DiffTable({
  rows,
  aName,
  bName,
}: {
  rows: DiffRow[];
  aName: string;
  bName: string;
}) {
  return (
    <div className="overflow-x-auto rounded-xl bg-neutral-900">
      <table className="w-full text-sm">
        <thead className="text-neutral-400">
          <tr>
            <th className="text-left p-3">Metric</th>
            <th className="text-right p-3">{aName}</th>
            <th className="text-right p-3">{bName}</th>
            <th className="text-right p-3">Δ (B − A)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-neutral-800">
              <td className="p-3 text-neutral-300">{r.label}</td>
              <td className="p-3 text-right text-neutral-200">
                {fmtVal(r.kind, r.a)}
              </td>
              <td className="p-3 text-right text-neutral-200">
                {fmtVal(r.kind, r.b)}
              </td>
              <td
                className={`p-3 text-right ${r.delta > 0 ? "text-emerald-400" : r.delta < 0 ? "text-rose-400" : "text-neutral-500"}`}
              >
                {fmtDelta(r.kind, r.delta)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] Run build, expect PASS: `npm run build` → completes without errors.
- [ ] Manual smoke (paint): `npm run dev`, open `http://localhost:4321/compare`; confirm the Sessions tab shows two session pickers and a diff table with a colored Δ column; switch to the Models tab and confirm two model pickers and a diff table; change a picker and confirm the values and deltas update.
- [ ] Commit: `git add src/components/Compare.tsx src/pages/compare.astro && git commit -m "feat(ui): add compare page with session and model diff tabs"`

---

### Task 6: `SessionSearch` island + `/sessions` search wiring

**Files:**

- Create: `src/components/SessionSearch.tsx`
- Modify: `src/pages/sessions/index.astro` (created in Phase 2; add the `SessionSearch` import + element and seed it from `?q=`).

**Interfaces:**

- Consumes: `SearchResult` from `../lib/search` (Task 1); `GET /api/search?q=` (Task 2); `Astro.url.searchParams` in the page frontmatter.
- Produces: a search box rendered above the Phase 2 `SessionsList` on `/sessions`, with `?q=` URL sync and result links into `/sessions/[id]`.

Steps:

- [ ] Create `src/components/SessionSearch.tsx`:

```tsx
// src/components/SessionSearch.tsx
import { useEffect, useState } from "react";
import type { SearchResult } from "../lib/search";

export default function SessionSearch({
  initialQuery = "",
}: {
  initialQuery?: string;
}) {
  const [q, setQ] = useState(initialQuery);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  async function run(query: string) {
    const trimmed = query.trim();
    // Keep ?q= in the URL so a search is deep-linkable and survives reload.
    const url = new URL(window.location.href);
    if (trimmed) url.searchParams.set("q", trimmed);
    else url.searchParams.delete("q");
    window.history.replaceState({}, "", url);

    if (!trimmed) {
      setResults([]);
      setSearched(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`);
      if (!res.ok) throw new Error(`search failed: ${res.status}`);
      setResults(await res.json());
      setSearched(true);
    } finally {
      setLoading(false);
    }
  }

  // Run once for an initial ?q= (deep link into /sessions?q=...).
  useEffect(() => {
    if (initialQuery.trim()) run(initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(q);
        }}
        className="flex items-center gap-2 text-sm"
      >
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search message text across sessions…"
          className="flex-1 bg-neutral-800 rounded px-3 py-1.5 text-neutral-100 placeholder:text-neutral-500"
        />
        <button
          type="submit"
          className="px-3 py-1.5 rounded bg-blue-500 text-white"
        >
          {loading ? "Searching…" : "Search"}
        </button>
        {searched && (
          <button
            type="button"
            onClick={() => {
              setQ("");
              run("");
            }}
            className="px-3 py-1.5 rounded bg-neutral-800 text-neutral-300"
          >
            Clear
          </button>
        )}
      </form>

      {searched && (
        <div className="space-y-2">
          {results.length === 0 ? (
            <p className="text-neutral-400 text-sm">No matches.</p>
          ) : (
            results.map((r) => (
              <a
                key={r.key}
                href={`/sessions/${encodeURIComponent(r.key)}`}
                className="block rounded-xl bg-neutral-900 p-3 hover:bg-neutral-800/60"
              >
                <div className="flex items-center justify-between text-sm">
                  <span className="text-blue-400">
                    {r.project} · {r.tool}
                  </span>
                  <span className="text-xs text-neutral-500">
                    {r.matchCount} match{r.matchCount === 1 ? "" : "es"}
                  </span>
                </div>
                <p className="mt-1 text-sm text-neutral-300">{r.snippet}</p>
              </a>
            ))
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] Replace the whole of `src/pages/sessions/index.astro` (the Phase 2 version) with:

```astro
---
import Layout from '../../layouts/Layout.astro';
import SessionSearch from '../../components/SessionSearch.tsx';
import SessionsList from '../../components/SessionsList.tsx';
import { scan } from '../../lib/scan';
import { groupSessions } from '../../lib/sessions';
import { defaultPricing } from '../../lib/pricing';

export const prerender = false;

const { records, sessionMeta } = scan();
const sessions = groupSessions(records, sessionMeta, defaultPricing);
const q = Astro.url.searchParams.get('q') ?? '';
---
<Layout title="Sessions">
  <SessionSearch client:load initialQuery={q} />
  <SessionsList client:load initial={sessions} />
</Layout>
```

- [ ] Run build, expect PASS: `npm run build` → completes without errors.
- [ ] Manual smoke (paint): `npm run dev`, open `http://localhost:4321/sessions`; type a substring you know exists in a session and press Enter, confirm matching sessions render with a snippet and a match count and that clicking one navigates to `/sessions/<id>`; confirm the URL gains `?q=`; reload and confirm the search re-runs from the URL; click Clear and confirm results disappear and the URL drops `?q=`.
- [ ] Commit: `git add src/components/SessionSearch.tsx "src/pages/sessions/index.astro" && git commit -m "feat(ui): add session search box with query URL sync on sessions page"`

---

### Task 7: Top navigation — add `Compare` link

**Files:**

- Modify: `src/layouts/Layout.astro` (Phase 2 added the `<nav>` with Overview/Sessions inside the header row; add a third link).

**Interfaces:**

- Consumes: nothing new.
- Produces: a `Compare` link in the shared top nav on every page that uses `Layout`.

Steps:

- [ ] In `src/layouts/Layout.astro`, replace the Phase 2 nav block:

```astro
        <nav class="flex gap-4 text-sm">
          <a href="/" class="text-neutral-300 hover:text-white">Overview</a>
          <a href="/sessions" class="text-neutral-300 hover:text-white">Sessions</a>
        </nav>
```

with:

```astro
        <nav class="flex gap-4 text-sm">
          <a href="/" class="text-neutral-300 hover:text-white">Overview</a>
          <a href="/sessions" class="text-neutral-300 hover:text-white">Sessions</a>
          <a href="/compare" class="text-neutral-300 hover:text-white">Compare</a>
        </nav>
```

- [ ] Run build, expect PASS: `npm run build` → completes without errors.
- [ ] Manual smoke (paint): `npm run dev`, confirm the `Compare` link appears in the nav on `/`, `/sessions`, and `/compare`, and that it navigates to `/compare`.
- [ ] Run the full suite one final time, expect PASS: `npx vitest run` → all green.
- [ ] Commit: `git add src/layouts/Layout.astro && git commit -m "feat(ui): add compare link to top navigation"`

---

## Implementation-time hardening (required)

1. **Search cap enforcement test** — add a `/api/search` test with a mocked scan of many sessions (and shared multi-file sessions) plus parser spies asserting `SCAN_CAP`, `RESULT_CAP`, and `FILE_CAP` are actually enforced (the parser is not invoked beyond the budget). Export the caps (or accept overrides) so the test can drive small bounds deterministically.
