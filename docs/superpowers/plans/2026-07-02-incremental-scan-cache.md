# Incremental Scan Cache (mtime + size) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the in-process incremental parse cache so `scan()` re-parses only new or changed files, reuses cached parses for unchanged files, and drops entries for deleted files — with output byte-identical to a cold scan for the same on-disk state.

**Architecture:** A baseline per-file cache ALREADY exists: `src/lib/cache.ts` exposes `parseFileCached(path, parser)` keyed on `path` + `mtimeMs`, plus `clearCache()`, and `scan()` already routes every per-file parse through it. This plan closes the remaining gap to the stated spec in three layered steps, all BELOW the cross-file reconciliation layer: (1) add `size` to the invalidation key so an in-place edit that changes byte length is caught even when mtime is unchanged; (2) evict cache entries for files that no longer exist on disk each scan, and prove a warm (all-cache-hit) scan is byte-identical to a cold scan; (3) pin — as a regression guard — that the GLOBAL Codex fork reconciliation still runs over the full merged set (cached + freshly parsed) and picks the same authoritative file on a warm scan and on a mixed hit/miss scan. The cache sits at the per-file PARSE layer only; `sessionMeta`/`sessionIndex` merge, the Claude `message.id` dedup, the Codex per-file high-water-mark, and the cross-file authoritative-file selection all stay exactly where they are and re-run over the full set on every scan.

**Tech Stack:** TypeScript (Node ESM), Vitest, Astro (unaffected). No new dependencies. In-process module-level `Map` only — no persistence layer.

## Global Constraints

- Test runner is Vitest. Run one file: `npx vitest run src/lib/scan.test.ts`. Run one test: `npx vitest run src/lib/scan.test.ts -t "<name substring>"`.
- This is a PURE performance optimization. Output MUST be byte-identical to a cold scan for the same on-disk state: same `records` array (same order, same values), same `sessionMeta`, same `sessionIndex`, same `codexQuota`. A test asserts warm-scan output equals cold-scan output.
- The cache sits ONLY at the per-file parse layer. Do NOT move, cache, or short-circuit any cross-file step:
  - The Codex fork reconciliation (authoritative-file selection via each file's `sessionMaxTotals`) is a GLOBAL step over ALL files and MUST still run over the full merged set (cached + freshly parsed) on every scan — never per file, never cached.
  - `mergeMeta` / `addSessionFile`, the Claude `message.id` dedup, and the Codex per-session delta / high-water-mark are per-file properties (safe to cache per file); every cross-file step runs after, unchanged.
- Do NOT mutate cached objects. `scan()` already clones `SessionMeta` on first insert (`cloneMeta`) and spreads `parsed.records` into a fresh array; keep both. `parseFileCached` returns the SAME references across scans, so any in-place mutation would corrupt later scans.
- Invalidation key is `(path, mtimeMs, size)`. A file whose mtime OR size changed is re-parsed. New files are parsed. Deleted files are evicted. Accepted tradeoff (spec-approved): a same-mtime AND same-size in-place edit is NOT detected — acceptable for local session logs, which are append-only with strictly changing size.
- Keep the cache in-process (module-level `Map`). No new deps, no disk persistence. `scan()` keeps its exact signature `scan(opts?: { claudeDir?; codexDir? }): ScanResult`. `clearCache()` remains the test reset.
- Commit messages are plain product Conventional Commits (`perf(lib)` / `test(lib)`). No tool names, no process or review vocabulary, no attribution trailers, no emojis.

### Canonical anchors (reused verbatim from `src/lib/scan.test.ts`)

- **Fork trio:** parent id `P = "019e2f27-0000-7000-a000-00000000cafe"` reaches max cumulative total **10000**; fork1 (`F1`) is a pure replay (max 5000); fork2 (`F2`) replays then adds genuinely-new (max 5200). Parent is authoritative → reconciled Codex total is **10000**, exactly **3** surviving Codex records, every survivor `sessionId === P`. NOT 10000+5000+5200.
- **Single Claude line:** one assistant record, `input_tokens: 100`, `output_tokens: 50`.
- **Size-change:** appending a second copy of the Claude line doubles the byte length; with mtime pinned equal, the file MUST re-parse (proves `size` participates in the key).
- **Deleted file:** two Claude files cached → delete one → next scan drops to **1** record and cache size drops to **1**.

---

## File Structure

- `src/lib/cache.ts` — MODIFY. `CacheEntry` gains `size`; `parseFileCached` stats once, compares `mtimeMs` AND `size`. ADD `pruneCache(livePaths: Set<string>)` (evicts keys not in the live set) and `cacheSize(): number` (test-only observability). `clearCache()` unchanged.
- `src/lib/scan.ts` — MODIFY. Capture the two enumerated file lists into locals, iterate them (no behavior change), and after both parse loops call `pruneCache` with the union of live paths. Import `pruneCache`. The reconciliation block is untouched.
- `src/lib/scan.test.ts` — MODIFY. Add the size-change, eviction, warm-identity, and fork-through-cache tests. Import `pruneCache`, `cacheSize` from `./cache`.

---

## Task 1: Invalidate the parse cache on file size change

**Files:**

- Modify: `src/lib/cache.ts`
- Test: `src/lib/scan.test.ts`

**Interfaces:**

- Consumes: `statSync` (`node:fs`) returns `{ mtimeMs: number, size: number }`; `ParsedFile` from `./normalize`.
- Produces: `parseFileCached(path: string, parser: (p: string) => ParsedFile): ParsedFile` — unchanged signature, now keyed on `(path, mtimeMs, size)`. `clearCache(): void` unchanged.

- [ ] **Step 1: Write the failing test**

Add to `src/lib/scan.test.ts` (extend the top-of-file import to include `statSync`, `utimesSync` — `utimesSync` is already imported), inside the existing `describe("parseFileCached", ...)` block:

```ts
it("re-parses when only the file SIZE changes with mtime pinned equal", () => {
  const f = join(claudeDir, "size.jsonl");
  const fixed = new Date("2026-06-01T00:00:00.000Z"); // pin mtime across writes
  let calls = 0;
  const counting = (p: string) => {
    calls++;
    return parseClaudeFile(p);
  };

  writeFileSync(f, claudeLine); // size S1
  utimesSync(f, fixed, fixed);
  parseFileCached(f, counting); // miss -> parse
  parseFileCached(f, counting); // hit (same mtime + size)
  expect(calls).toBe(1);

  writeFileSync(f, `${claudeLine}\n${claudeLine}`); // DIFFERENT size (write bumps mtime)
  utimesSync(f, fixed, fixed); // reset mtime to the SAME value it had before
  parseFileCached(f, counting); // mtime identical, size differs -> re-parse
  expect(calls).toBe(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/scan.test.ts -t "only the file SIZE changes"`
Expected: FAIL — the current cache keys on `mtimeMs` only, so the second `parseFileCached` after the size change is served from cache and `calls` stays `1` (`expected 1 to be 2`).

- [ ] **Step 3: Write minimal implementation**

Replace the body of `src/lib/cache.ts` with:

```ts
// src/lib/cache.ts
import { statSync } from "node:fs";
import type { ParsedFile } from "./normalize";

interface CacheEntry {
  mtimeMs: number;
  size: number;
  parsed: ParsedFile;
}

const cache = new Map<string, CacheEntry>();

export function parseFileCached(
  path: string,
  parser: (p: string) => ParsedFile,
): ParsedFile {
  const st = statSync(path);
  const hit = cache.get(path);
  // Key on (path, mtimeMs, size). A same-mtime AND same-size in-place edit is not
  // detected — accepted tradeoff: local session logs are append-only with a
  // strictly changing size.
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
    return hit.parsed;
  }
  const parsed = parser(path);
  cache.set(path, { mtimeMs: st.mtimeMs, size: st.size, parsed });
  return parsed;
}

export function clearCache(): void {
  cache.clear();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/scan.test.ts`
Expected: PASS — the new size test passes, and the existing `re-parses only when mtime changes` test still passes (mtime change alone still invalidates).

- [ ] **Step 5: Commit**

```bash
git add src/lib/cache.ts src/lib/scan.test.ts
git commit -m "perf(lib): invalidate parse cache on file size change"
```

---

## Task 2: Evict deleted files and prove warm output equals cold output

**Files:**

- Modify: `src/lib/cache.ts`
- Modify: `src/lib/scan.ts`
- Test: `src/lib/scan.test.ts`

**Interfaces:**

- Consumes: `parseFileCached` from Task 1; `listJsonlFiles(dir: string): string[]` (existing, in `scan.ts`).
- Produces:
  - `pruneCache(livePaths: Set<string>): void` — deletes every cache key not present in `livePaths`.
  - `cacheSize(): number` — current entry count (test observability).
  - `scan(opts?): ScanResult` — same signature and same output; now evicts stale entries.

- [ ] **Step 1: Write the failing tests**

Extend the `import { parseFileCached, clearCache } from "./cache";` line in `src/lib/scan.test.ts` to `import { parseFileCached, clearCache, pruneCache, cacheSize } from "./cache";` (`pruneCache` is imported for the module to type-check; the tests below call `cacheSize` and `scan`). Add a new describe block at the end of the file:

```ts
describe("scan cache lifecycle", () => {
  it("evicts cache entries for files deleted between scans", () => {
    mkdirSync(join(claudeDir, "p"), { recursive: true });
    const a = join(claudeDir, "p", "a.jsonl");
    const b = join(claudeDir, "p", "b.jsonl");
    writeFileSync(a, claudeLine);
    writeFileSync(b, claudeLine);

    const first = scan({ claudeDir, codexDir });
    expect(first.records).toHaveLength(2); // both claude files
    expect(cacheSize()).toBe(2);

    rmSync(b); // b removed on disk
    const second = scan({ claudeDir, codexDir });
    expect(second.records).toHaveLength(1); // only a survives
    expect(cacheSize()).toBe(1); // b's stale entry evicted, not just ignored
  });

  it("produces output identical to a cold scan on a fully warm (all cache-hit) scan", () => {
    // Fixture: one Claude file + the 3-file Codex fork trio, so the identity
    // covers records order, sessionMeta/sessionIndex, quota, AND reconciliation.
    mkdirSync(join(claudeDir, "proj"), { recursive: true });
    writeFileSync(join(claudeDir, "proj", "a.jsonl"), claudeLine);

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
    const fork1 = [
      meta("2026-05-18T00:00:00.000Z", F1, P),
      turn("2026-05-18T00:00:00.050Z"),
      meta("2026-05-18T00:00:00.100Z", P),
      tc("2026-05-18T00:00:00.200Z", 900, 100, 100, 1000),
      tc("2026-05-18T00:00:00.300Z", 4500, 500, 500, 5000),
    ].join("\n");
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

    const cold = scan({ claudeDir, codexDir }); // every file a cache miss
    const warm = scan({ claudeDir, codexDir }); // every file a cache hit

    expect(warm.records).toEqual(cold.records); // same records, SAME order
    expect(warm.sessionMeta).toEqual(cold.sessionMeta); // Map deep-equal
    expect(warm.sessionIndex).toEqual(cold.sessionIndex);
    expect(warm.codexQuota).toEqual(cold.codexQuota);

    // Canonical anchor: reconciled Codex total is the parent max, warm == cold.
    const warmCodex = warm.records.filter((r) => r.tool === "codex");
    expect(warmCodex.reduce((s, r) => s + totalTokens(r), 0)).toBe(10000);
    expect(warmCodex).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/scan.test.ts -t "scan cache lifecycle"`
Expected: FAIL — `cacheSize` and `pruneCache` are not exported yet (`SyntaxError: ... does not provide an export named 'cacheSize'`), so the whole file fails to load. (The warm-identity test itself passes on current code once the exports exist, but eviction must be added for the deletion test.)

- [ ] **Step 3: Write minimal implementation**

Add to `src/lib/cache.ts`, after `clearCache`:

```ts
// Drop entries for files no longer present under any scanned root. Called by
// scan() with the union of live paths from both roots. Deleting the current key
// during Map key iteration is safe. Purely memory hygiene: records already come
// only from enumerated files, so a stale entry is never re-emitted — but leaving
// it would leak memory and let a same-mtime+size recreation serve stale data.
export function pruneCache(livePaths: Set<string>): void {
  for (const path of cache.keys()) {
    if (!livePaths.has(path)) cache.delete(path);
  }
}

// Current entry count — test observability for eviction.
export function cacheSize(): number {
  return cache.size;
}
```

In `src/lib/scan.ts`, update the import and the `scan` body. Change the import line to:

```ts
import { parseFileCached, pruneCache } from "./cache";
```

Capture the two enumerations into locals and iterate them (replace the two inline `for (const file of listJsonlFiles(...))` loops), then prune before returning:

```ts
const claudeFiles = listJsonlFiles(claudeDir);
const codexFiles = listJsonlFiles(codexDir);

for (const file of claudeFiles) {
  // ...unchanged claude loop body...
}

// ...unchanged codexParsed loop now iterates `codexFiles`...
for (const file of codexFiles) {
  // ...unchanged codex loop body...
}
```

(Only the two `for (const file of listJsonlFiles(...))` headers change — the loop bodies and the entire reconciliation block below them stay exactly as they are.) Then, immediately before `return { records, codexQuota, sessionMeta, sessionIndex };`, add:

```ts
// Evict entries for files deleted since the last scan (union of both roots).
pruneCache(new Set([...claudeFiles, ...codexFiles]));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/scan.test.ts`
Expected: PASS — eviction drops `cacheSize()` to 1 after the delete, and warm output deep-equals cold output. Run the full lib suite to confirm no regression: `npx vitest run src/lib`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cache.ts src/lib/scan.ts src/lib/scan.test.ts
git commit -m "perf(lib): evict deleted files from the scan parse cache"
```

---

## Task 3: Pin Codex fork reconciliation through the warm cache

**Files:**

- Test: `src/lib/scan.test.ts` (test only — no source change)

**Interfaces:**

- Consumes: `scan(opts?)`, `parseFileCached`/`pruneCache` behavior from Tasks 1-2, `totalTokens` (already imported), `utimesSync` (already imported).
- Produces: nothing new — a regression guard locking the "reconciliation runs over the full merged set, below the cache" invariant.

- [ ] **Step 1: Write the guard test**

This test asserts an invariant that the current architecture already satisfies (the cache is below reconciliation), so it is a regression GUARD, not a red-first behavioral change: it starts GREEN and would only fail if a future change wrongly cached or per-file'd the cross-file reconciliation. Add to `src/lib/scan.test.ts`, inside the `describe("scan cache lifecycle", ...)` block from Task 2:

```ts
it("keeps the fork authoritative-file result across warm and mixed hit/miss scans", () => {
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
  const fork1 = [
    meta("2026-05-18T00:00:00.000Z", F1, P),
    turn("2026-05-18T00:00:00.050Z"),
    meta("2026-05-18T00:00:00.100Z", P),
    tc("2026-05-18T00:00:00.200Z", 900, 100, 100, 1000),
    tc("2026-05-18T00:00:00.300Z", 4500, 500, 500, 5000),
  ].join("\n");
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
  const fork2Path = join(codexDir, "2026", "05", "18", "rollout-fork2.jsonl");
  writeFileSync(fork2Path, fork2);

  const authoritative = (r: ReturnType<typeof scan>) => {
    const codex = r.records.filter((x) => x.tool === "codex");
    return {
      summed: codex.reduce((s, x) => s + totalTokens(x), 0),
      count: codex.length,
      allParent: codex.every((x) => x.sessionId === P),
    };
  };

  // Cold: every file freshly parsed. Parent (max 10000) is authoritative.
  expect(authoritative(scan({ claudeDir, codexDir }))).toEqual({
    summed: 10000,
    count: 3,
    allParent: true,
  });

  // Warm: every file a cache hit. Reconciliation still runs over the full set.
  expect(authoritative(scan({ claudeDir, codexDir }))).toEqual({
    summed: 10000,
    count: 3,
    allParent: true,
  });

  // Mixed: re-parse ONLY the non-authoritative fork2 (bump its mtime) so it is a
  // fresh parse while parent + fork1 are cache hits. The GLOBAL reconciliation
  // over the mixed hit/miss set must STILL pick the parent as authoritative.
  utimesSync(fork2Path, new Date(), new Date(Date.now() + 5000));
  expect(authoritative(scan({ claudeDir, codexDir }))).toEqual({
    summed: 10000,
    count: 3,
    allParent: true,
  });
});
```

- [ ] **Step 2: Run test to verify it passes (regression guard, starts green)**

Run: `npx vitest run src/lib/scan.test.ts -t "authoritative-file result across warm and mixed"`
Expected: PASS on the first run — the cache is below reconciliation, so cold, warm, and mixed hit/miss scans all reconcile to the parent (10000, 3 records, all `P`). This guard would FAIL if a later change cached or per-file'd the cross-file authoritative-file selection.

- [ ] **Step 3: Run the full lib suite**

Run: `npx vitest run src/lib`
Expected: PASS — full regression clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/scan.test.ts
git commit -m "test(lib): pin Codex fork reconciliation through the warm cache"
```

---

## Self-Review

**1. Spec coverage:**

- Cache per-file parse keyed on `(path, mtime, size)` → Task 1 (size added to existing mtime key).
- Re-parse new/changed files, reuse unchanged → existing `parseFileCached` + Task 1; warm-identity test (Task 2) proves reuse.
- Drop entries for deleted files → Task 2 `pruneCache` + eviction test.
- Reconciliation stays global over the full merged set, below the cache → Task 3 guard + Global Constraints.
- Byte-identical warm vs cold output → Task 2 warm-identity test (`records`, `sessionMeta`, `sessionIndex`, `codexQuota`).
- In-process module `Map`, no deps, same `scan()` signature, `clearCache()` reset → Global Constraints; no new files, no new deps.
- Same-mtime same-size edit tradeoff → called out in Global Constraints and in the `parseFileCached` comment.

**2. Placeholder scan:** No TBD/TODO; every code and test step shows complete code; every command lists expected output.

**3. Type consistency:** `parseFileCached(path, parser)`, `pruneCache(livePaths: Set<string>)`, `cacheSize(): number`, `clearCache()`, `scan(opts?)`, `totalTokens(r)` are used with identical names and signatures across every task. Canonical anchors (10000 / 3 / all `P`; input 100 output 50; delete → 1 record + cacheSize 1) match `src/lib/scan.test.ts` verbatim.
