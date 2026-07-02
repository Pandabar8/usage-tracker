# Codex Token Over-Count Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three confirmed Codex token over-count defects so the tool matches the independent oracle (removes +6.07% / +79,459,605 over-counted Codex tokens) without touching the already-correct Claude path.

**Architecture:** Three layered, independent fixes. (1) Aggregation: the cache-hit-rate denominator must include cache-write. (2) Per-file parse: replace the "any backwards cumulative move is a restart, re-add the whole snapshot" rule with a high-water-mark delta so a mid-session context trim adds zero. (3) Cross-file scan: a forked rollout replays its parent's cumulative history in a separate file under the SAME session id, so the parent id appears in several files; keep each id's records only from its authoritative file (the one where its cumulative counter reached the highest total, i.e. the original) and drop the id's records from the replay files. The per-file high-water-mark (fix 2) and the cross-file authoritative-file selection (fix 3) are layered, not intermixed: high-water-mark makes each file's own records internally correct (trims neutralized, never exceeding that file's own max), and the scan step then drops whole replay contributions per session id using each file's per-id max cumulative. This ordering is why fork-dedup and the trim rule never conflict.

**Tech Stack:** TypeScript (Node ESM), Vitest, Astro (unaffected). No new dependencies.

## Global Constraints

- Test runner is Vitest. Run one file: `npx vitest run <path>`. Run one test: `npx vitest run <path> -t "<name substring>"`.
- Do NOT modify the Claude parser or Claude aggregation. The oracle confirms Claude is correct.
- Preserve these existing invariants in every task:
  - Reasoning tokens are EXCLUDED from `totalTokens()` (input + output + cacheWrite + cacheRead only); records still carry `reasoningTokens` for display.
  - A single file may contain multiple distinct `session_meta` ids sharing ONE continuous file-wide cumulative counter; the delta baseline is never reset on a `session_meta` switch (the `codex-multi-session` fixture pins this: session B's delta is 600, not its full 1600).
  - Per-field clamping to `>= 0` when the total advances but one component regresses (the `codex-reset` fixture pins this).
  - Duplicate / no-forward-progress snapshots emit no record (the `codex-edge` fixture pins this).
  - Session maps stay keyed by the composite route key `` `${tool}:${sessionId}` ``.
- Assert tests against the oracle ground-truth numbers (canonical anchors below), NEVER against the code's own recomputation of the same formula.
- Commit messages are plain product Conventional Commits (`fix(lib)` / `test(lib)`). No tool names, no process/review vocabulary, no attribution trailers, no emojis.

### Canonical anchors (from the independent oracle over real `~/.codex` data)

- **Fork cross-file:** session id `019e2f27-6a3d-7e73-bfd0-d300f482cfab` spans 3 files (parent `2026/05/16/rollout-...019e2f27...` max cumulative **199,637,209**; forks `2026/05/18/rollout-...019e39b8...` max **34,179,185** pure replay, and `...019e39b9...` max **34,999,319** replay + ~820K new). Tool sums **268,815,713**; correct is **199,637,209** (the max cumulative). Over-count removed: **+69,178,504** (= 34,179,185 + 34,999,319). The fork's own ~820K genuinely-new tokens are absorbed below the parent's high-water mark, matching the oracle's max-cumulative ground truth.
- **Mid-session trim:** file `2026/06/04/rollout-2026-06-04T11-59-17-019e93ca-...` drops total **10,281,101 -> 4,710,806** mid-stream (same session id, no `session_meta` at the drop). Tool sums **51,783,432**; correct (high-water-mark = max cumulative) is **41,502,331**. Over-count removed: **+10,281,101**. NOTE the naive "adopt the lower value as baseline, delta 0" rule gives 47,072,626 — WRONG; only the high-water-mark rule reproduces 41,502,331.
- **Cache-hit-rate:** real value is **0.948** (denominator including cache-write); the tool currently shows **0.972** (denominator excluding cache-write).

Synthetic fixtures below use small clean numbers that reproduce the SAME shape and the SAME class of over-count; each test comment references the real anchor it stands in for.

---

## File Structure

- `src/lib/aggregate.ts` — MODIFY `cacheHitRate` signature + denominator; accumulate `cacheWriteSum` in `aggregate()`; update its two internal call sites (`aggregate` return, `modelStats`).
- `src/lib/aggregate.test.ts` — MODIFY the three pinned cache-hit-rate assertions.
- `src/lib/compare.ts` — MODIFY the `cacheHitRate` call sites in `diffSessions` (lines 64-65) to the 3-arg signature, passing `cacheWrite`.
- `src/lib/compare.test.ts` — MODIFY the `sA` cache-hit-rate + delta pins, the `mA.cacheHitRate` fixture, and the `diffModels` cache-hit-rate delta pin.
- `src/lib/parsers/codex.ts` — MODIFY the delta block to a total-gated, field-wise high-water-mark rule; track and return a per-session max cumulative total.
- `src/lib/normalize.ts` — MODIFY `ParsedFile` to add optional `sessionMaxTotals`.
- `src/lib/parsers/codex.test.ts` — ADD a trim test, a regression-plus-recovery test, and a `sessionMaxTotals` test.
- `src/lib/parsers/__fixtures__/codex-trim.jsonl` — CREATE the mid-session-trim fixture.
- `src/lib/parsers/__fixtures__/codex-hwm-recover.jsonl` — CREATE the regression-plus-recovery fixture.
- `src/lib/scan.ts` — MODIFY the Codex loop into collect-then-reconcile (deterministic authoritative file per session id).
- `src/lib/scan.test.ts` — ADD the multi-file fork reconciliation test and an authoritative-file tie test.

Each file keeps a single responsibility: `codex.ts` extracts + does within-file delta math, `scan.ts` orchestrates cross-file reconciliation, `aggregate.ts` rolls up. The cross-file reconciliation lives in `scan.ts` (not a new module) because it needs the multi-file view scan already owns and reuses the same iteration; the only new parser output it needs is a small `Map<sessionId, maxCumulativeTotal>`. **Tradeoff considered and rejected:** a "raw-snapshot session-assembler" that re-derives every delta per session id from zero would be a larger refactor AND would break the within-file continuous-counter invariant (session B in one file would delta from 0 to its full 1600 instead of 600), because that continuity is a per-file property, not a per-id property. Layering per-file high-water-mark + a per-id authoritative-file filter keeps both invariants and is a far smaller diff.

---

## Task 1: Cache-hit-rate denominator includes cache-write (Defect 3)

**Files:**

- Modify: `src/lib/aggregate.ts:97-104` (accumulators), `src/lib/aggregate.ts:175` (return), `src/lib/aggregate.ts:181-187` (`cacheHitRate`), `src/lib/aggregate.ts:268` (`modelStats` call site)
- Modify: `src/lib/compare.ts:64-65` (the `diffSessions` `cacheHitRate` call sites — the ONLY other live caller of the exported helper)
- Test: `src/lib/aggregate.test.ts:112-116, 175-184, 228`
- Test: `src/lib/compare.test.ts:67-72` (`sA` cache-hit-rate + delta), `src/lib/compare.test.ts:97` (`mA.cacheHitRate` fixture), `src/lib/compare.test.ts:130-132` (`diffModels` cache-hit-rate delta)

**Interfaces:**

- Produces: `cacheHitRate(inputTokens: number, cacheWriteTokens: number, cacheReadTokens: number): number` returning `cacheReadTokens / (inputTokens + cacheWriteTokens + cacheReadTokens)`, or `0` when the denominator is `0`. (Signature changes from 2 args to 3; the middle arg is cache-write.)

**Call-site inventory (do this first).** `cacheHitRate` is exported from `aggregate.ts` and has exactly THREE live call sites plus its declaration. Confirm with:

```bash
grep -rn "cacheHitRate(" src
```

Expected hits: `src/lib/aggregate.ts:175` (`aggregate` return), `src/lib/aggregate.ts:268` (`modelStats`), `src/lib/compare.ts:64` and `src/lib/compare.ts:65` (`diffSessions`). Every one is migrated to the 3-arg form in this task. (`diffModels` reads a precomputed `ModelStats.cacheHitRate` field and does NOT call the helper — but its `mA` test fixture value is derived from the same formula, so it is repinned below.)

- [ ] **Step 1: Update the failing tests with canonical-pinned literals**

In `src/lib/aggregate.test.ts`, replace the global cache-hit-rate assertion (currently at lines 112-116):

```ts
it("exposes a global cache-hit rate over all records, cache-write in the denominator", () => {
  // cacheRead 1100 / (input 310 + cacheWrite 200 + cacheRead 1100) = 1100/1610.
  // Real anchor: 0.948 (was 0.972 while cache-write was excluded).
  expect(r.cacheHitRate).toBeCloseTo(0.6832298136645962, 12);
});
```

Replace the `cacheHitRate` unit-test block (currently at lines 175-184):

```ts
describe("cacheHitRate", () => {
  it("computes cache-read share of read-side tokens, including cache-write", () => {
    expect(cacheHitRate(100, 0, 300)).toBe(0.75); // 300 / (100 + 0 + 300)
    expect(cacheHitRate(200, 0, 800)).toBe(0.8); // 800 / 1000
    expect(cacheHitRate(100, 50, 300)).toBeCloseTo(0.6666666666666666, 12); // 300 / 450
  });
  it("returns 0 when there are no read-side tokens", () => {
    expect(cacheHitRate(0, 0, 0)).toBe(0);
    expect(cacheHitRate(100, 0, 0)).toBe(0);
    expect(cacheHitRate(100, 50, 0)).toBe(0); // denom 150 but no cache reads
  });
});
```

Replace the `modelStats` opus cache-hit-rate assertion (currently line 228):

```ts
expect(opus.cacheHitRate).toBeCloseTo(0.4918032786885246, 12); // 300 / (110 + 200 + 300)
```

Then update `src/lib/compare.test.ts` (the second live caller of the helper, via `diffSessions`).

Replace the `diffSessions` cache-hit-rate block (currently lines 67-72). `sA.tokens = { input: 110, cacheWrite: 200, cacheRead: 300 }`, `sB.tokens = { input: 200, cacheWrite: 0, cacheRead: 800 }`:

```ts
const chr = row(rows, "cacheHitRate");
expect(chr.kind).toBe("pct");
expect(chr.a).toBeCloseTo(0.4918032786885246, 12); // 300 / (110 + 200 + 300)
expect(chr.b).toBe(0.8); // 800 / (200 + 0 + 800)
expect(chr.delta).toBeCloseTo(0.3081967213114754, 12); // 0.8 - 0.4918032786885246
```

Repin the `mA` fixture's `cacheHitRate` (currently line 97, pinned to the OLD `0.7317073170731707`). `mA` has `inputTokens: 110, cacheWriteTokens: 200, cacheReadTokens: 300`, so the cache-write-inclusive value is `300 / (110 + 200 + 300) = 300/610 = 0.4918032786885246`:

```ts
  cacheHitRate: 0.4918032786885246, // 300 / (110 + 200 + 300)
```

Update the `diffModels` cache-hit-rate delta (currently line 132). `diffModels` reads the precomputed `mA.cacheHitRate` (now `0.4918032786885246`) and `mB.cacheHitRate` (`0.8`, unchanged since `mB` has zero cache-write), so the delta is `0.8 - 0.4918032786885246`:

```ts
const chr = row(rows, "cacheHitRate");
expect(chr.kind).toBe("pct");
expect(chr.delta).toBeCloseTo(0.3081967213114754, 12); // 0.8 - 0.4918032786885246
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/aggregate.test.ts src/lib/compare.test.ts`
Expected: FAIL — `cacheHitRate` called with 3 args currently ignores the 3rd; `aggregate.test.ts` global expects 0.7801… and opus expects 0.7317…, and `compare.test.ts` `sA`/`mA` still pin the old 0.7317…, so the new pins mismatch.

- [ ] **Step 3: Write the minimal implementation**

In `src/lib/aggregate.ts`, add a cache-write accumulator. Change lines 97-98 from:

```ts
let inputSum = 0;
let cacheReadSum = 0;
```

to:

```ts
let inputSum = 0;
let cacheWriteSum = 0;
let cacheReadSum = 0;
```

Inside the record loop (after line 103 `inputSum += r.inputTokens;`) add:

```ts
cacheWriteSum += r.cacheWriteTokens;
```

Change the return (line 175) from:

```ts
    cacheHitRate: cacheHitRate(inputSum, cacheReadSum),
```

to:

```ts
    cacheHitRate: cacheHitRate(inputSum, cacheWriteSum, cacheReadSum),
```

Replace `cacheHitRate` (lines 179-187) with:

```ts
// Share of read-side tokens served from cache: cacheRead / (input + cacheWrite +
// cacheRead). Cache writes are billed as non-cached input, so they belong in the
// denominator. Returns 0 when there were no read-side tokens (avoids /0).
export function cacheHitRate(
  inputTokens: number,
  cacheWriteTokens: number,
  cacheReadTokens: number,
): number {
  const denom = inputTokens + cacheWriteTokens + cacheReadTokens;
  return denom > 0 ? cacheReadTokens / denom : 0;
}
```

Change the `modelStats` call site (line 268) from:

```ts
      cacheHitRate: cacheHitRate(a.inputTokens, a.cacheReadTokens),
```

to:

```ts
      cacheHitRate: cacheHitRate(a.inputTokens, a.cacheWriteTokens, a.cacheReadTokens),
```

In `src/lib/compare.ts`, migrate the `diffSessions` call sites (lines 64-65) from:

```ts
      cacheHitRate(a?.tokens.input ?? 0, a?.tokens.cacheRead ?? 0),
      cacheHitRate(b?.tokens.input ?? 0, b?.tokens.cacheRead ?? 0),
```

to (insert `cacheWrite` as the middle arg — `SessionSummary.tokens` already carries `cacheWrite`):

```ts
      cacheHitRate(
        a?.tokens.input ?? 0,
        a?.tokens.cacheWrite ?? 0,
        a?.tokens.cacheRead ?? 0,
      ),
      cacheHitRate(
        b?.tokens.input ?? 0,
        b?.tokens.cacheWrite ?? 0,
        b?.tokens.cacheRead ?? 0,
      ),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/aggregate.test.ts src/lib/compare.test.ts`
Expected: PASS (all cases in both files).

- [ ] **Step 5: Type-check and commit**

Run `npx tsc --noEmit` and confirm no errors (the 3-arg `cacheHitRate` is now consistent at every call site: `aggregate` return, `modelStats`, and both `diffSessions` sites). Then re-run the two touched suites together as the final gate for this task:

Run: `npx vitest run src/lib/compare.test.ts src/lib/aggregate.test.ts`
Expected: PASS.

```bash
git add src/lib/aggregate.ts src/lib/aggregate.test.ts src/lib/compare.ts src/lib/compare.test.ts
git commit -m "fix(lib): include cache-write in cache-hit-rate denominator"
```

---

## Task 2: High-water-mark delta neutralizes mid-session trims (Defect 2)

**Files:**

- Create: `src/lib/parsers/__fixtures__/codex-trim.jsonl`, `src/lib/parsers/__fixtures__/codex-hwm-recover.jsonl`
- Modify: `src/lib/parsers/codex.ts:62-75` (baseline declaration + comment), `src/lib/parsers/codex.ts:162` (comment), `src/lib/parsers/codex.ts:241-261` (delta block)
- Test: `src/lib/parsers/codex.test.ts`

**Interfaces:**

- Consumes: existing `parseCodexFile(path): ParsedFile`.
- Produces: unchanged signature. Behavior change ONLY when a cumulative snapshot does NOT advance the running-max cumulative TOTAL: such a snapshot (a mid-session trim, a replayed prefix, or a duplicate) now yields no record. When the total does advance, each field is measured from its own running-max value (clamped `>= 0`) so a component that regressed while the total advanced is not re-added when it later recovers. The cumulative-TOTAL deltas telescope to the session's max cumulative total; the per-field record totals track the max reached in each field (equal to the max cumulative total in the common case where every field peaks at the final snapshot).

- [ ] **Step 1: Create the fixtures**

Create `src/lib/parsers/__fixtures__/codex-trim.jsonl` (stands in for the real `019e93ca` trim; total climbs to a peak, a context trim drops it, then it climbs past the old peak):

```
{"timestamp":"2026-06-04T09:00:00.000Z","type":"session_meta","payload":{"id":"ct1","cwd":"/Users/me/ProjT"}}
{"timestamp":"2026-06-04T09:00:00.500Z","type":"turn_context","payload":{"cwd":"/Users/me/ProjT","model":"gpt-5.3-codex"}}
{"timestamp":"2026-06-04T09:01:00.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1000,"cached_input_tokens":0,"output_tokens":0,"reasoning_output_tokens":0,"total_tokens":1000}}}}
{"timestamp":"2026-06-04T09:02:00.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":5000,"cached_input_tokens":0,"output_tokens":0,"reasoning_output_tokens":0,"total_tokens":5000}}}}
{"timestamp":"2026-06-04T09:03:00.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":2000,"cached_input_tokens":0,"output_tokens":0,"reasoning_output_tokens":0,"total_tokens":2000}}}}
{"timestamp":"2026-06-04T09:04:00.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":8000,"cached_input_tokens":0,"output_tokens":0,"reasoning_output_tokens":0,"total_tokens":8000}}}}
```

Create `src/lib/parsers/__fixtures__/codex-hwm-recover.jsonl` (one component regresses while the total advances, then recovers above its earlier peak; proves the high-water mark is tracked PER FIELD, not by replacing the whole snapshot). Here `total_tokens = input_tokens + output_tokens` at every snapshot; `output` goes `1000 -> 200 (regress) -> 1200 (recover)` while `total` climbs `2000 -> 5200 -> 7200`:

```
{"timestamp":"2026-06-05T09:00:00.000Z","type":"session_meta","payload":{"id":"ct2","cwd":"/Users/me/ProjR"}}
{"timestamp":"2026-06-05T09:00:00.500Z","type":"turn_context","payload":{"cwd":"/Users/me/ProjR","model":"gpt-5.3-codex"}}
{"timestamp":"2026-06-05T09:01:00.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1000,"cached_input_tokens":0,"output_tokens":1000,"reasoning_output_tokens":0,"total_tokens":2000}}}}
{"timestamp":"2026-06-05T09:02:00.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":5000,"cached_input_tokens":0,"output_tokens":200,"reasoning_output_tokens":0,"total_tokens":5200}}}}
{"timestamp":"2026-06-05T09:03:00.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":6000,"cached_input_tokens":0,"output_tokens":1200,"reasoning_output_tokens":0,"total_tokens":7200}}}}
```

- [ ] **Step 2: Write the failing tests**

In `src/lib/parsers/codex.test.ts`, add the fixture URLs near the other fixture constants (after line 18):

```ts
const trim = fileURLToPath(
  new URL("./__fixtures__/codex-trim.jsonl", import.meta.url),
);
const hwmRecover = fileURLToPath(
  new URL("./__fixtures__/codex-hwm-recover.jsonl", import.meta.url),
);
```

Add inside `describe("parseCodexFile", ...)`:

```ts
it("neutralizes a mid-session context trim with a high-water-mark delta", () => {
  // Real anchor 019e93ca: total drops 10,281,101 -> 4,710,806 mid-stream;
  // correct total is the max cumulative 41,502,331, NOT the 51,783,432 the old
  // "backwards move => re-add the whole snapshot" rule produced.
  const { records } = parseCodexFile(trim);
  expect(records).toHaveLength(3); // the 2000 trim snapshot yields NO record
  expect(records.map((r) => r.inputTokens)).toEqual([1000, 4000, 3000]);
  const summed = records.reduce((acc, r) => acc + totalTokens(r), 0);
  expect(summed).toBe(8000); // == max cumulative; the old rule summed 13000
});

it("tracks the high-water mark PER FIELD so a regressed-then-recovered component is not re-added", () => {
  // output regresses (1000 -> 200) while the cumulative total advances
  // (2000 -> 5200), then recovers to 1200. Measuring output's recovery from its
  // own high-water value (1000) counts only the genuinely-new 200; measuring it
  // from the regressed low (200) would re-add 800 and over-count.
  // Correct summed total = max cumulative total_tokens = 7200 (input peaks at
  // 6000, output at 1200; 6000 + 1200 = 7200). Both the OLD prev-based rule and
  // a whole-snapshot HWM replacement would report 8000 (the extra 800).
  const { records } = parseCodexFile(hwmRecover);
  expect(records).toHaveLength(3);
  expect(records.map((r) => r.inputTokens)).toEqual([1000, 4000, 1000]);
  expect(records.map((r) => r.outputTokens)).toEqual([1000, 0, 200]);
  const summed = records.reduce((acc, r) => acc + totalTokens(r), 0);
  expect(summed).toBe(7200); // == max cumulative; the un-fielded rule summed 8000
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/lib/parsers/codex.test.ts -t "high-water"`
Expected: FAIL — the old prev-based rule emits 4 records `[1000, 4000, 2000, 6000]` (sum 13000) for the trim fixture, and reports `summed === 8000` for the recover fixture (it re-adds the 800 recovered output).

- [ ] **Step 4: Write the minimal implementation**

In `src/lib/parsers/codex.ts`, replace the baseline declaration + comment (lines 62-75) with:

```ts
// ONE continuous high-water-mark for the WHOLE file. A single rollout can
// contain several session_meta ids sharing ONE monotonic `total_token_usage`
// counter, so the baseline is NOT reset on a session switch. `hwm` holds the
// running MAX reached in each field (advanced field-wise, below), and the max
// cumulative total seen so far. Deltas are measured against it, so a snapshot
// that does not advance the total (a mid-session context TRIM, a replayed
// prefix, or a duplicate) contributes zero, and a component that regressed
// while the total advanced is measured from its own peak — never re-added — when
// it later recovers. A true counter restart lands under a NEW session_meta id
// and is reconciled across files in scan(), never here.
let hwm: Cumulative = {
  input: 0,
  cached: 0,
  output: 0,
  reasoning: 0,
  total: 0,
};
```

Update the stale comment at line 162 from:

```ts
// NB: `prev` is deliberately NOT reset here (continuous counter).
```

to:

```ts
// NB: `hwm` is deliberately NOT reset here (continuous counter).
```

Replace the delta block (lines 241-261) with:

```ts
// Total-gated, field-wise high-water-mark delta. GATE: a snapshot contributes
// new usage ONLY when its cumulative TOTAL exceeds the high-water total; a
// snapshot with `cur.total <= hwm.total` (a mid-session context TRIM, a replayed
// prefix, or a duplicate) contributes zero. When it does contribute, each
// field's delta is measured from that field's own high-water value, clamped to
// >= 0 so a component that regressed while the total advanced cannot go
// negative. The high-water snapshot is then advanced PER FIELD (running max per
// field; total set to the new higher cur.total), so when a regressed component
// later recovers it is measured from its true peak and only genuinely-new
// tokens above that peak are counted. The cumulative-TOTAL deltas telescope to
// the session's max cumulative total; do NOT assume the per-field record totals
// equal that value in general (they equal the sum of per-field maxima, which
// coincides with the max cumulative total when every field peaks at the final
// snapshot — the common monotonic case the fixtures pin).
if (cur.total <= hwm.total) continue; // trim / replay / duplicate: no new usage
const d = {
  input: Math.max(0, cur.input - hwm.input),
  cached: Math.max(0, cur.cached - hwm.cached),
  output: Math.max(0, cur.output - hwm.output),
  reasoning: Math.max(0, cur.reasoning - hwm.reasoning),
  total: cur.total - hwm.total,
};
hwm = {
  input: Math.max(hwm.input, cur.input),
  cached: Math.max(hwm.cached, cur.cached),
  output: Math.max(hwm.output, cur.output),
  reasoning: Math.max(hwm.reasoning, cur.reasoning),
  total: cur.total, // gated above: cur.total > hwm.total, so this is the new max
};
```

- [ ] **Step 5: Run the new tests and the full codex suite**

Run: `npx vitest run src/lib/parsers/codex.test.ts`
Expected: PASS — the new trim test AND the new field-wise recover test pass, AND the existing `sample` (1650), `edge` (330), `reset` (225 with per-field clamp), `multimeta` (600), and `multi-session` record tests are unchanged. The field-wise high-water mark reproduces the previous per-field delta for every monotonic sequence (and for the `reset` fixture, where `cached` regresses once but is not revisited), differing only on the trim and the recover fixtures.

- [ ] **Step 6: Commit**

```bash
git add src/lib/parsers/codex.ts src/lib/parsers/codex.test.ts src/lib/parsers/__fixtures__/codex-trim.jsonl src/lib/parsers/__fixtures__/codex-hwm-recover.jsonl
git commit -m "fix(lib): count Codex tokens by high-water mark to skip mid-session trims"
```

---

## Task 3: Expose per-session max cumulative total from the parser

**Files:**

- Modify: `src/lib/normalize.ts:44-48` (`ParsedFile`)
- Modify: `src/lib/parsers/codex.ts` (track + return `sessionMaxTotals`)
- Test: `src/lib/parsers/codex.test.ts`

**Interfaces:**

- Produces: `ParsedFile.sessionMaxTotals?: Map<string, number>` — for Codex, maps each session id seen in the file to the highest cumulative `total_tokens` reached under that id in that file. Consumed by Task 4's scan reconciliation. Claude leaves it undefined.

- [ ] **Step 1: Write the failing test**

In `src/lib/parsers/codex.test.ts`, add inside `describe("parseCodexFile across a multi-session rollout", ...)`:

```ts
it("exposes each session's max cumulative total for cross-file reconciliation", () => {
  const { sessionMaxTotals } = parseCodexFile(codexMulti);
  expect(sessionMaxTotals?.get("019e39b9-0000-7000-a000-0000000000a1")).toBe(
    1000,
  );
  expect(sessionMaxTotals?.get("019e2f27-0000-7000-a000-0000000000b2")).toBe(
    1600,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/parsers/codex.test.ts -t "max cumulative total for cross-file"`
Expected: FAIL — `sessionMaxTotals` is `undefined`.

- [ ] **Step 3: Write the minimal implementation**

In `src/lib/normalize.ts`, extend `ParsedFile` (lines 44-48) to:

```ts
export interface ParsedFile {
  records: UsageRecord[];
  quota: RateLimitSnapshot | null;
  sessions?: SessionMeta[];
  // Codex only: highest cumulative total_tokens reached per session id in this
  // file. scan() uses it to pick the authoritative file when a forked rollout
  // replays a parent id across files.
  sessionMaxTotals?: Map<string, number>;
}
```

In `src/lib/parsers/codex.ts`, declare the map near the other per-file accumulators (right after the `sessions` map is created around line 80):

```ts
const sessionMaxTotals = new Map<string, number>();
```

Inside the `token_count` branch, immediately after `const cur = readCumulative(obj.payload.info); if (!cur) continue;` (currently lines 238-239) and BEFORE the high-water-mark block, add:

```ts
if (activeId) {
  const seen = sessionMaxTotals.get(activeId) ?? 0;
  if (cur.total > seen) sessionMaxTotals.set(activeId, cur.total);
}
```

Add `sessionMaxTotals` to the return object (currently lines 290):

```ts
return { records, quota, sessions: sessionsOut, sessionMaxTotals };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/parsers/codex.test.ts`
Expected: PASS (new test plus all prior codex tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/normalize.ts src/lib/parsers/codex.ts src/lib/parsers/codex.test.ts
git commit -m "feat(lib): expose per-session max cumulative total from Codex parser"
```

---

## Task 4: Reconcile forked rollouts across files in scan (Defect 1)

**Files:**

- Modify: `src/lib/scan.ts:8-13` (import `ParsedFile`), `src/lib/scan.ts:119-136` (Codex loop)
- Test: `src/lib/scan.test.ts`

**Interfaces:**

- Consumes: `ParsedFile.records`, `ParsedFile.sessionMaxTotals` (Task 3), `ParsedFile.quota`, `ParsedFile.sessions`.
- Produces: `scan()` result whose Codex records contain each session id only from its authoritative file (the file where that id's cumulative total reached the highest value). Selection is DETERMINISTIC and independent of `listJsonlFiles` order: candidate files for an id are sorted by max cumulative total (desc), then by earliest event timestamp (asc), then by path — so on equal maxima the ORIGINAL/parent file (written first; a replay is always later) wins and its day/project/model attribution is preserved. Records with an empty session id (token_count before any `session_meta`) are kept as-is. `sessionMeta` / `sessionIndex` are unchanged (every id still indexed under every file it appears in, so the detail route can still read all files).

- [ ] **Step 1: Write the failing test**

In `src/lib/scan.test.ts`, add a value import for `totalTokens` (the file currently only imports the `UsageRecord` type), and add `vi` to the existing vitest import (line 2) for the tie test's warn spy:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { totalTokens } from "./normalize";
```

Add inside `describe("scan session meta and index", ...)`:

```ts
it("reconciles a forked rollout across files: the session total equals its max cumulative, not the replay-inflated sum", () => {
  // Stands in for real id 019e2f27 spanning 3 files. A fork REPLAYS the parent's
  // session_meta + cumulative token history under the SAME id in a new file, so
  // summing every file double-counts the replay. Correct total = the max
  // cumulative (10000 here; 199,637,209 in real data), NOT 20200.
  const P = "019e2f27-0000-7000-a000-00000000cafe";
  const F1 = "019e39b8-0000-7000-a000-00000000f001";
  const F2 = "019e39b9-0000-7000-a000-00000000f002";
  const meta = (ts: string, id: string, forked?: string) =>
    JSON.stringify({
      timestamp: ts,
      type: "session_meta",
      payload: forked
        ? { id, forked_from_id: forked, cwd: "/Users/me/FinApp" }
        : { id, cwd: "/Users/me/FinApp" },
    });
  const turn = (ts: string) =>
    JSON.stringify({
      timestamp: ts,
      type: "turn_context",
      payload: { model: "gpt-5.5", cwd: "/Users/me/FinApp" },
    });
  const tc = (
    ts: string,
    input: number,
    cached: number,
    output: number,
    total: number,
  ) =>
    JSON.stringify({
      timestamp: ts,
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: input,
            cached_input_tokens: cached,
            output_tokens: output,
            reasoning_output_tokens: 0,
            total_tokens: total,
          },
        },
      },
    });

  const parent = [
    meta("2026-05-16T00:00:00.000Z", P),
    turn("2026-05-16T00:00:30.000Z"),
    tc("2026-05-16T00:01:00.000Z", 900, 100, 100, 1000),
    tc("2026-05-16T00:02:00.000Z", 4500, 500, 500, 5000),
    tc("2026-05-16T00:03:00.000Z", 9000, 1000, 1000, 10000),
  ].join("\n");
  // fork1: own id F1, then REPLAYS parent meta P + parent snapshots verbatim, zero new
  const fork1 = [
    meta("2026-05-18T00:00:00.000Z", F1, P),
    turn("2026-05-18T00:00:00.050Z"),
    meta("2026-05-18T00:00:00.100Z", P),
    tc("2026-05-18T00:00:00.200Z", 900, 100, 100, 1000),
    tc("2026-05-18T00:00:00.300Z", 4500, 500, 500, 5000),
  ].join("\n");
  // fork2: replays P to the fork point then adds 200 genuinely-new (attributed to P)
  const fork2 = [
    meta("2026-05-18T01:00:00.000Z", F2, P),
    turn("2026-05-18T01:00:00.050Z"),
    meta("2026-05-18T01:00:00.100Z", P),
    tc("2026-05-18T01:00:00.200Z", 900, 100, 100, 1000),
    tc("2026-05-18T01:00:00.300Z", 4500, 500, 500, 5000),
    tc("2026-05-18T01:00:00.400Z", 4600, 500, 600, 5200),
  ].join("\n");

  mkdirSync(join(codexDir, "2026", "05", "16"), { recursive: true });
  mkdirSync(join(codexDir, "2026", "05", "18"), { recursive: true });
  writeFileSync(
    join(codexDir, "2026", "05", "16", "rollout-parent.jsonl"),
    parent,
  );
  writeFileSync(
    join(codexDir, "2026", "05", "18", "rollout-fork1.jsonl"),
    fork1,
  );
  writeFileSync(
    join(codexDir, "2026", "05", "18", "rollout-fork2.jsonl"),
    fork2,
  );

  const { records } = scan({ claudeDir, codexDir });
  const codex = records.filter((r) => r.tool === "codex");
  const summed = codex.reduce((acc, r) => acc + totalTokens(r), 0);
  // Parent (max 10000) is authoritative; both replay files' P records dropped,
  // including fork2's 200 genuinely-new (absorbed below the parent high-water
  // mark, matching the oracle max-cumulative ground truth). NOT 10000+5000+5200.
  expect(summed).toBe(10000);
  expect(codex).toHaveLength(3); // only the parent file's three P records survive
  expect(codex.every((r) => r.sessionId === P)).toBe(true);
});

it("breaks an authoritative-file tie toward the earliest (parent) file and warns", () => {
  // Two files carry the SAME id reaching the SAME max cumulative total (5000).
  // Selection must be deterministic regardless of scan order: the earliest-
  // timestamped file (the original rollout; a replay is always written later)
  // wins, so the parent's day/project attribution is kept, not the replay's.
  // Equal maxima across files is exactly the "comparable maxima" ambiguity the
  // reconciler logs (not silently drops).
  const P = "019e2f27-0000-7000-a000-00000000d1e1";
  const tc = (
    ts: string,
    input: number,
    cached: number,
    output: number,
    total: number,
    id: string,
    cwd: string,
  ) =>
    [
      JSON.stringify({
        timestamp: ts,
        type: "session_meta",
        payload: { id, cwd },
      }),
      JSON.stringify({
        timestamp: ts,
        type: "turn_context",
        payload: { model: "gpt-5.5", cwd },
      }),
      JSON.stringify({
        timestamp: ts,
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: input,
              cached_input_tokens: cached,
              output_tokens: output,
              reasoning_output_tokens: 0,
              total_tokens: total,
            },
          },
        },
      }),
    ].join("\n");

  // Both reach total 5000; earlier file is dated 05-16 with project ProjEarly,
  // later replay is dated 05-18 with project ProjLate.
  const early = tc(
    "2026-05-16T00:01:00.000Z",
    4500,
    500,
    500,
    5000,
    P,
    "/Users/me/ProjEarly",
  );
  const late = tc(
    "2026-05-18T00:01:00.000Z",
    4500,
    500,
    500,
    5000,
    P,
    "/Users/me/ProjLate",
  );
  mkdirSync(join(codexDir, "2026", "05", "16"), { recursive: true });
  mkdirSync(join(codexDir, "2026", "05", "18"), { recursive: true });
  writeFileSync(
    join(codexDir, "2026", "05", "16", "rollout-tie-early.jsonl"),
    early,
  );
  writeFileSync(
    join(codexDir, "2026", "05", "18", "rollout-tie-late.jsonl"),
    late,
  );

  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const { records } = scan({ claudeDir, codexDir });
  // Capture the spy's call state BEFORE restoring: mockRestore() also resets
  // call history, so asserting on `warn` after restore is unreliable.
  const warnCalled = warn.mock.calls.length > 0;
  warn.mockRestore();

  const codex = records.filter((r) => r.tool === "codex" && r.sessionId === P);
  const summed = codex.reduce((acc, r) => acc + totalTokens(r), 0);
  expect(summed).toBe(5000); // one file wins the tie; NOT 10000
  expect(codex).toHaveLength(1); // only the winning file's single record survives
  expect(codex.every((r) => r.project === "ProjEarly")).toBe(true); // parent attribution kept
  expect(warnCalled).toBe(true); // comparable-maxima ambiguity is logged, not silent
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/scan.test.ts -t "reconciles a forked rollout"`
Expected: FAIL — current scan concatenates every file's records; codex sum is 20200 and length 7.

Run: `npx vitest run src/lib/scan.test.ts -t "breaks an authoritative-file tie"`
Expected: FAIL — current scan keeps both files' P records (sum 10000, length 2) and never warns.

- [ ] **Step 3: Write the minimal implementation**

In `src/lib/scan.ts`, add `ParsedFile` to the type import (lines 8-13):

```ts
import type {
  ParsedFile,
  RateLimitSnapshot,
  SessionMeta,
  Tool,
  UsageRecord,
} from "./normalize";
```

Replace the Codex loop (lines 119-136) with a collect-then-reconcile pass:

```ts
// Codex records need cross-file reconciliation. A forked rollout REPLAYS its
// parent's session_meta and cumulative token history in a separate file under
// the SAME session id, so a parent id appears in several files. Summing every
// file would double-count the replay. For each session id we keep the records
// from its AUTHORITATIVE file — the one where that id's cumulative counter
// reached the highest total (the original; a replay only ever reaches a prefix
// of it) — and drop the id's records from the replay files. Records with no
// session id (token_count before any session_meta) can't be reconciled and are
// kept as-is. sessionMeta / sessionIndex still see every file.
const codexParsed: { file: string; parsed: ParsedFile }[] = [];
for (const file of listJsonlFiles(codexDir)) {
  try {
    const parsed = parseFileCached(file, parseCodexFile);
    codexParsed.push({ file, parsed });
    if (
      parsed.quota &&
      (!codexQuota || parsed.quota.timestamp > codexQuota.timestamp)
    ) {
      codexQuota = parsed.quota;
    }
    for (const s of parsed.sessions ?? []) {
      mergeMeta(sessionMeta, s);
      addSessionFile(sessionIndex, s.tool, s.sessionId, file);
    }
  } catch {
    // file vanished or became unreadable between enumeration and parse; skip it
  }
}

// Earliest event timestamp per (file, sessionId): a replay/fork is written
// LATER, so the earliest-timestamped file carrying an id is its parent, and ties
// on max cumulative total break toward it. Keyed per (file, id) — not per file —
// so the tiebreak stays precise even if a file ever carried token records under
// multiple ids. Ids with no timestamped record fall back to path order.
const fileIdFirstTs = new Map<string, string>(); // key: `${file}�${id}`
for (const { file, parsed } of codexParsed) {
  for (const r of parsed.records) {
    if (r.tool !== "codex" || !r.sessionId || !r.timestamp) continue;
    const key = `${file}�${r.sessionId}`;
    const cur = fileIdFirstTs.get(key);
    if (cur === undefined || r.timestamp < cur)
      fileIdFirstTs.set(key, r.timestamp);
  }
}

// Collect every file that carries each session id, with that file's max
// cumulative total for that id and that id's earliest event timestamp in the file.
const perId = new Map<
  string,
  { file: string; max: number; firstTs: string }[]
>();
for (const { file, parsed } of codexParsed) {
  for (const [id, max] of parsed.sessionMaxTotals ?? []) {
    const firstTs = fileIdFirstTs.get(`${file}�${id}`) ?? "";
    const list = perId.get(id) ?? [];
    list.push({ file, max, firstTs });
    perId.set(id, list);
  }
}

// Deterministic authoritative file per session id, independent of
// listJsonlFiles order: highest max cumulative total wins; on EQUAL maxima the
// earliest-timestamped file (the parent, since a replay is written later) wins;
// path is the final stable tiebreak. This keeps day/project/model attribution
// on the parent rather than a replay.
const authoritativeFile = new Map<string, string>();
for (const [id, cands] of perId) {
  cands.sort(
    (a, b) =>
      b.max - a.max ||
      (a.firstTs < b.firstTs ? -1 : a.firstTs > b.firstTs ? 1 : 0) ||
      (a.file < b.file ? -1 : a.file > b.file ? 1 : 0),
  );
  authoritativeFile.set(id, cands[0].file);

  // Defensive log (never silent): the product rule keeps ONLY the highest-max
  // file per id. That is correct for the observed fork pattern, where a replay's
  // max is a strict prefix far below the parent's (~0.17 ratio in real data). If
  // an id ever spans multiple files with COMPARABLE maxima — a fork whose max
  // exceeds its parent, or an additive split with no single authoritative file —
  // dropping the runner-up could mis-count. Neither exists in the real data
  // today, so we do NOT special-case it (YAGNI); we surface it so a future
  // occurrence is visible instead of silently mis-counted.
  if (
    cands.length > 1 &&
    cands[1].max > 0 &&
    cands[1].max >= cands[0].max * 0.9
  ) {
    console.warn(
      `[scan] Codex session ${id} spans ${cands.length} files with comparable ` +
        `max cumulative totals (winner ${cands[0].max} in ${cands[0].file}, ` +
        `runner-up ${cands[1].max} in ${cands[1].file}); keeping only the ` +
        `highest-max file — verify this is a replay, not an additive split.`,
    );
  }
}

for (const { file, parsed } of codexParsed) {
  for (const r of parsed.records) {
    if (r.sessionId === "" || authoritativeFile.get(r.sessionId) === file) {
      records.push(r);
    }
  }
}
```

The `0.9` ratio marks a near-tie as "comparable"; it is above both the real fork ratio (~0.17) and the synthetic fork test's runner-up ratio (5200/10000 = 0.52), so those legitimate replays stay quiet, while the equal-maxima tie test (ratio 1.0) and any true additive split fire the log.

- [ ] **Step 4: Run the fork test, the tie test, and the full scan suite**

Run: `npx vitest run src/lib/scan.test.ts`
Expected: PASS — the new fork test AND the new tie test pass, AND the existing scan tests are unchanged: the "merges records" codex file (no session_meta, empty session id) is kept; the multi-session file's ids are each authoritative in their single file so both records survive with session B's continuous delta 200. The tie test's `console.warn` is expected output (the spy suppresses it), not a failure.

- [ ] **Step 5: Commit**

```bash
git add src/lib/scan.ts src/lib/scan.test.ts
git commit -m "fix(lib): reconcile forked Codex rollouts across files by session id"
```

### Known limitations / product rule

- **Product rule: max-cumulative-per-session-id.** A session id's tokens are counted from the single file where its cumulative counter reached the highest total; every other file's records for that id (replays/forks) are dropped. This matches the independent oracle's ground truth. It knowingly drops the replay-fork `019e39b9`'s extra genuinely-new tokens: that fork's max (34,999,319) exceeds the pure-replay fork `019e39b8`'s max (34,179,185) by **820,134 tokens** (~0.06% of total Codex tokens), which are absorbed below the parent's high-water mark (199,637,209) and therefore not counted. This is **accepted** — it is exactly the oracle's definition and keeps the fix simple.
- **Edge cases NOT in the real data, NOT specially handled (YAGNI).** Two shapes would defeat pure highest-max selection: (1) a fork whose max cumulative _exceeds_ its parent's (the fork would be chosen as authoritative and the parent's tail dropped), and (2) an additive session split where the same id genuinely accrues _different_ new tokens in two files with no single authoritative file. Neither exists in the observed `~/.codex` data, so selection deliberately keeps only the highest-max file rather than merging. To keep future occurrences visible instead of silently mis-counted, the reconciler emits a `console.warn` whenever an id spans multiple files with **comparable** maxima (runner-up within 90% of the winner). No speculative merge logic is added beyond that log.

---

## Task 5: Full-suite regression gate

**Files:** none (verification only).

- [ ] **Step 1: Run the entire test suite**

Run: `npx vitest run`
Expected: PASS, all files. Confirms the three fixes compose and nothing else regressed (aggregate, modelStats, forecast, tips, sessions, session-detail, charts, compare, search, filters, pricing, normalize, claude parser, codex parser, scan).

- [ ] **Step 2: Type-check the project**

Run: `npx tsc --noEmit` (or the project's configured type-check script if present)
Expected: no errors — the `cacheHitRate` 3-arg signature and `ParsedFile.sessionMaxTotals` are consistent at every call site.

- [ ] **Step 3: No commit** (verification only; the three fixes are already committed).

---

## Self-Review

**1. Defect coverage.**

- Defect 1 (fork cross-file double-count, +69,178,504): Task 4 — pinned by the multi-file fork scan test to `summed === 10000` (= max cumulative, not the 20200 replay-inflated sum), plus a tie test pinning deterministic parent-wins selection (`summed === 5000`, `project === "ProjEarly"`) and the comparable-maxima warn; Task 3 provides the `sessionMaxTotals` it needs.
- Defect 2 (reset/trim re-add, +10,281,101): Task 2 — pinned by the trim test to `summed === 8000` (high-water-mark = max cumulative, not the 13000 re-add) and the field-wise recover test to `summed === 7200` (per-field HWM, not the 8000 an un-fielded rule produces).
- Defect 3 (cache-hit-rate overstated): Task 1 — pinned by the aggregate global (`0.6832…`), unit (`0.75 / 0.8 / 0.6666…`), and modelStats (`0.4918…`) assertions AND the compare `diffSessions` (`sA` `0.4918…`, delta `0.3081…`) and `diffModels` (`mA` fixture `0.4918…`, delta `0.3081…`) assertions, all with cache-write in the denominator.
  Every test pins a canonical value derived from the oracle ground truth (max cumulative / cache-write-inclusive denominator), never the SUT's own recomputation.

**2. Fork + trim interaction.** Addressed and ordered: per-file high-water-mark (Task 2) runs first and makes each file's records internally correct (the cumulative-total gate neutralizes backwards moves; per-field running-max advance prevents a regressed-then-recovered component from being re-added); the cross-file authoritative-file filter (Task 4) then drops whole replay contributions per session id using each file's per-id max cumulative total. They cannot conflict because within-file trims never raise a file's max and cross-file replays are dropped wholesale. Documented in the Architecture section and both fix-site comments. The earlier over-claim (per-field clamping alone "keeps summed record totals equal to max cumulative total") was corrected: the cumulative-TOTAL deltas telescope to that value; the per-field record totals coincide with it in the common case where every field peaks at the final snapshot (what the fixtures pin).

**3. Invariants preserved.** Reasoning excluded from `totalTokens` (records still carry it); continuous file-wide baseline across `session_meta` switches (session B delta 600 / 200 unchanged — field-wise high-water-mark equals the old per-field delta for monotonic sequences); per-field clamp (`codex-reset` 225 unchanged — `cached` regresses once, is not revisited, so field-wise gives the same result); duplicate skip (`codex-edge` unchanged); composite `${tool}:${sessionId}` keys untouched; multiple ids per file still emitted and indexed.

**4. Type consistency.** `cacheHitRate` is 3-arg at ALL call sites (`aggregate` return, `modelStats`, and both `diffSessions` sites in `compare.ts`), confirmed via `grep -rn "cacheHitRate(" src`. `ParsedFile.sessionMaxTotals` is defined in Task 3 and consumed in Task 4 with the same `Map<string, number>` shape. `parseCodexFile` signature is unchanged; only its returned `ParsedFile` gains a field. `Cumulative` is unchanged (the field-wise HWM advance reuses its five fields).

**5. Placeholder scan.** None: every code and test step contains complete, runnable content and exact run/expected lines.

**Known out-of-scope (documented, not a shipped contradiction):** structural session meta (`turns` / `toolCalls`) for a replayed parent id is still summed across the fork files by `mergeMeta`, so a forked session's turn count remains inflated. This is pre-existing behavior orthogonal to the token audit (the oracle measured tokens only); the token totals shipped here are correct. Owner: follow-up, apply the same authoritative-file selection to `mergeMeta` if the inflated turn counts prove user-visible.
