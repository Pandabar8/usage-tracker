# Usage Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A locally-run website that reads the JSONL usage data Claude Code (`~/.claude/projects`) and Codex (`~/.codex/sessions`) already write, and shows tokens over time, estimated cost, and breakdowns by project and model, plus Codex plan-quota windows.

**Architecture:** A framework-agnostic core in `src/lib/` (parsers → pricing → aggregate → cache/scan) made of pure, unit-tested functions, behind an Astro SSR shell (`@astrojs/node` standalone) that server-renders the dashboard and exposes `/api/usage` + `/api/refresh`. React islands render the charts.

**Tech Stack:** TypeScript · Astro 5 (SSR) · `@astrojs/node` · `@astrojs/react` + React 19 · Recharts · Tailwind v4 (`@tailwindcss/vite`) · Vitest 3.

## Global Constraints

- Node ≥ 20.6 (recursive `fs.readdir` + Astro 5).
- Astro `output: 'server'` with `@astrojs/node` `mode: 'standalone'`.
- Tailwind v4 via the `@tailwindcss/vite` plugin (NOT the legacy `@astrojs/tailwind` integration).
- All `src/lib/` modules are pure and import nothing from `astro`. Only `src/pages/**` and `src/components/**` may use Astro/React.
- No emojis anywhere in code, comments, or UI. If an icon is needed, use an inline SVG.
- No attribution or tool-process mentions in code, comments, or commit messages. Commit messages describe the change and its product reason only; use Conventional Commits (`feat:`, `test:`, `chore:`, `docs:`).
- Token-accounting rules (apply in every parser/aggregate task):
  - `inputTokens` = **fresh (uncached) input**. Claude: `usage.input_tokens` (already uncached). Codex: `input_tokens − cached_input_tokens`.
  - `cacheReadTokens`. Claude: `usage.cache_read_input_tokens`. Codex: `cached_input_tokens`.
  - `cacheWriteTokens`. Claude: `usage.cache_creation_input_tokens`. Codex: `0`.
  - `outputTokens`. Claude: `usage.output_tokens`. Codex: `output_tokens` (this already includes reasoning).
  - `reasoningTokens` is **informational only** — a subset of `outputTokens` (Codex `reasoning_output_tokens`; Claude `0`). It is excluded from both `totalTokens()` and `cost()`.
  - `totalTokens(r) = inputTokens + outputTokens + cacheWriteTokens + cacheReadTokens`.
  - `cost(r) = (inputTokens*input + outputTokens*output + cacheWriteTokens*cacheWrite + cacheReadTokens*cacheRead) / 1_000_000`.
  - (These refine the spec: cost is computed at aggregation time, not stored on the record; reasoning is never added to totals/cost.)

---

## File Structure

| File                                                                                             | Responsibility                                                                                      |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `package.json`, `astro.config.mjs`, `tsconfig.json`, `vitest.config.ts`, `src/styles/global.css` | Project + build + test + Tailwind config                                                            |
| `src/lib/normalize.ts`                                                                           | `Tool`, `UsageRecord`, `RateLimitSnapshot`, `ParsedFile` types; `projectFromCwd()`, `totalTokens()` |
| `src/lib/pricing.json`                                                                           | Editable per-model rate table (source of truth)                                                     |
| `src/lib/pricing.ts`                                                                             | `PricingTable` type, `defaultPricing`, `isPriced()`, `cost()`                                       |
| `src/lib/parsers/claude.ts`                                                                      | `parseClaudeFile(path) -> ParsedFile`                                                               |
| `src/lib/parsers/codex.ts`                                                                       | `parseCodexFile(path) -> ParsedFile`                                                                |
| `src/lib/parsers/__fixtures__/*.jsonl`                                                           | Canonical test fixtures with pinned token totals                                                    |
| `src/lib/aggregate.ts`                                                                           | `Rollups` type; `aggregate(records, quota, pricing) -> Rollups`                                     |
| `src/lib/cache.ts`                                                                               | mtime-keyed parse cache: `parseFileCached()`, `clearCache()`                                        |
| `src/lib/scan.ts`                                                                                | `scan(opts) -> { records, codexQuota }`; `listJsonlFiles()`                                         |
| `src/lib/filters.ts`                                                                             | `applyFilters(records, params) -> UsageRecord[]`                                                    |
| `src/pages/api/usage.ts`                                                                         | `GET` → aggregated JSON (honours filters)                                                           |
| `src/pages/api/refresh.ts`                                                                       | `POST` → clears cache, returns fresh JSON                                                           |
| `src/pages/index.astro`                                                                          | Server-renders rollups, mounts islands                                                              |
| `src/layouts/Layout.astro`                                                                       | HTML shell + global styles                                                                          |
| `src/components/*.tsx`                                                                           | React islands: Overview, TrendChart, ByProject, ByModel, QuotaPanel, Filters                        |

---

## Task 1: Project scaffold

**Files:**

- Create: `package.json`, `astro.config.mjs`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`
- Create: `src/styles/global.css`, `src/pages/index.astro`
- Test: `src/lib/__tests__/smoke.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: a working `npm run dev`, `npm run build`, `npm test`. No exported code yet.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "usage-tracker",
  "type": "module",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "start": "node ./dist/server/entry.mjs",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@astrojs/node": "^9.0.0",
    "@astrojs/react": "^4.0.0",
    "astro": "^5.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "recharts": "^2.13.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.6.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Create `astro.config.mjs`**

```js
import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  integrations: [react()],
  vite: { plugins: [tailwindcss()] },
});
```

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "extends": "astro/tsconfigs/strict",
  "include": [".astro/types.d.ts", "**/*"],
  "exclude": ["dist"],
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "react"
  }
}
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 5: Create `.gitignore`**

```
node_modules/
dist/
.astro/
*.log
```

- [ ] **Step 6: Create `src/styles/global.css`**

```css
@import "tailwindcss";
```

- [ ] **Step 7: Create `src/pages/index.astro`**

```astro
---
---
<html lang="en">
  <head><meta charset="utf-8" /><title>Usage Tracker</title></head>
  <body><main>Usage Tracker — scaffold</main></body>
</html>
```

- [ ] **Step 8: Write the smoke test**

```ts
// src/lib/__tests__/smoke.test.ts
import { describe, it, expect } from "vitest";

describe("scaffold", () => {
  it("runs the test runner", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 9: Install and verify the test runner**

Run: `npm install && npm test`
Expected: Vitest runs and reports `1 passed`.

- [ ] **Step 10: Verify the dev server boots**

Run: `npm run build`
Expected: build completes and writes `dist/server/entry.mjs` (confirms the SSR Node adapter is wired).

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "chore: scaffold Astro SSR project with React, Tailwind, Vitest"
```

---

## Task 2: Normalization types and helpers

**Files:**

- Create: `src/lib/normalize.ts`
- Test: `src/lib/normalize.test.ts`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `type Tool = 'claude' | 'codex'`
  - `interface UsageRecord { tool, timestamp, model, project, sessionId, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens, reasoningTokens }` (all token fields `number`, the rest `string`)
  - `interface RateLimitWindow { usedPercent: number; windowMinutes: number; resetsAt: number }`
  - `interface RateLimitSnapshot { timestamp: string; primary: RateLimitWindow | null; secondary: RateLimitWindow | null }`
  - `interface ParsedFile { records: UsageRecord[]; quota: RateLimitSnapshot | null }`
  - `projectFromCwd(cwd?: string | null): string`
  - `totalTokens(r: UsageRecord): number`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/normalize.test.ts
import { describe, it, expect } from "vitest";
import { projectFromCwd, totalTokens, type UsageRecord } from "./normalize";

describe("projectFromCwd", () => {
  it("returns the basename of a path", () => {
    expect(projectFromCwd("/Users/me/FinApp")).toBe("FinApp");
  });
  it("handles a trailing slash", () => {
    expect(projectFromCwd("/Users/me/FinApp/")).toBe("FinApp");
  });
  it("falls back for empty/missing input", () => {
    expect(projectFromCwd("")).toBe("(unknown)");
    expect(projectFromCwd(undefined)).toBe("(unknown)");
    expect(projectFromCwd("/")).toBe("(unknown)");
  });
});

describe("totalTokens", () => {
  it("sums fresh input, output, cache write, and cache read (not reasoning)", () => {
    const r: UsageRecord = {
      tool: "codex",
      timestamp: "t",
      model: "m",
      project: "p",
      sessionId: "s",
      inputTokens: 200,
      outputTokens: 100,
      cacheWriteTokens: 0,
      cacheReadTokens: 800,
      reasoningTokens: 40,
    };
    expect(totalTokens(r)).toBe(1100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/normalize.test.ts`
Expected: FAIL — cannot find module `./normalize`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/normalize.ts
export type Tool = "claude" | "codex";

export interface UsageRecord {
  tool: Tool;
  timestamp: string;
  model: string;
  project: string;
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  reasoningTokens: number;
}

export interface RateLimitWindow {
  usedPercent: number;
  windowMinutes: number;
  resetsAt: number;
}

export interface RateLimitSnapshot {
  timestamp: string;
  primary: RateLimitWindow | null;
  secondary: RateLimitWindow | null;
}

export interface ParsedFile {
  records: UsageRecord[];
  quota: RateLimitSnapshot | null;
}

export function projectFromCwd(cwd?: string | null): string {
  if (!cwd) return "(unknown)";
  const parts = cwd.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "(unknown)";
}

export function totalTokens(r: UsageRecord): number {
  return (
    r.inputTokens + r.outputTokens + r.cacheWriteTokens + r.cacheReadTokens
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/normalize.test.ts`
Expected: PASS — all assertions green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/normalize.ts src/lib/normalize.test.ts
git commit -m "feat(lib): add usage record types and normalization helpers"
```

---

## Task 3: Pricing table and cost function

**Files:**

- Create: `src/lib/pricing.json`, `src/lib/pricing.ts`
- Test: `src/lib/pricing.test.ts`

**Interfaces:**

- Consumes: `UsageRecord` from `normalize.ts`.
- Produces:
  - `interface Rate { input: number; output: number; cacheWrite: number; cacheRead: number }`
  - `type PricingTable = Record<string, Rate>`
  - `const defaultPricing: PricingTable` (loaded from `pricing.json`)
  - `isPriced(model: string, table?: PricingTable): boolean`
  - `cost(r: UsageRecord, table?: PricingTable): number`

- [ ] **Step 1: Create `src/lib/pricing.json`**

```json
{
  "claude-opus-4-8": {
    "input": 5,
    "output": 25,
    "cacheWrite": 6.25,
    "cacheRead": 0.5
  },
  "claude-opus-4-7": {
    "input": 5,
    "output": 25,
    "cacheWrite": 6.25,
    "cacheRead": 0.5
  },
  "claude-opus-4-6": {
    "input": 5,
    "output": 25,
    "cacheWrite": 6.25,
    "cacheRead": 0.5
  },
  "claude-sonnet-4-6": {
    "input": 3,
    "output": 15,
    "cacheWrite": 3.75,
    "cacheRead": 0.3
  },
  "claude-haiku-4-5": {
    "input": 1,
    "output": 5,
    "cacheWrite": 1.25,
    "cacheRead": 0.1
  },
  "claude-fable-5": {
    "input": 10,
    "output": 50,
    "cacheWrite": 12.5,
    "cacheRead": 1.0
  },
  "gpt-5.3-codex": { "input": 0, "output": 0, "cacheWrite": 0, "cacheRead": 0 },
  "gpt-5-codex": { "input": 0, "output": 0, "cacheWrite": 0, "cacheRead": 0 }
}
```

> The `gpt-5.x-codex` rows are seed placeholders (0). Fill them with OpenAI's published rates before trusting Codex dollar figures; a `0` rate makes the model show as `unpriced` in the UI.

- [ ] **Step 2: Write the failing test**

```ts
// src/lib/pricing.test.ts
import { describe, it, expect } from "vitest";
import { cost, isPriced, type PricingTable } from "./pricing";
import type { UsageRecord } from "./normalize";

const table: PricingTable = {
  "claude-opus-4-8": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "gpt-5.3-codex": { input: 1.25, output: 10, cacheWrite: 0, cacheRead: 0.125 },
  "gpt-5-codex": { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
};

function rec(p: Partial<UsageRecord>): UsageRecord {
  return {
    tool: "claude",
    timestamp: "t",
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

describe("cost", () => {
  it("prices a Claude record across all token kinds", () => {
    const c = cost(
      rec({
        model: "claude-opus-4-8",
        inputTokens: 100,
        outputTokens: 50,
        cacheWriteTokens: 200,
        cacheReadTokens: 300,
      }),
      table,
    );
    // (100*5 + 50*25 + 200*6.25 + 300*0.5) / 1e6 = 3150/1e6
    expect(c).toBeCloseTo(0.00315, 10);
  });

  it("excludes reasoning tokens from cost (they are part of output)", () => {
    const c = cost(
      rec({
        tool: "codex",
        model: "gpt-5.3-codex",
        inputTokens: 200,
        outputTokens: 100,
        cacheReadTokens: 800,
        reasoningTokens: 40,
      }),
      table,
    );
    // (200*1.25 + 100*10 + 800*0.125) / 1e6 = 1350/1e6
    expect(c).toBeCloseTo(0.00135, 10);
  });

  it("returns 0 for an unknown model", () => {
    expect(
      cost(rec({ model: "mystery-model", inputTokens: 1000 }), table),
    ).toBe(0);
  });
});

describe("isPriced", () => {
  it("is false for unknown models and all-zero rates", () => {
    expect(isPriced("mystery-model", table)).toBe(false);
    expect(isPriced("gpt-5-codex", table)).toBe(false);
  });
  it("is true when at least one rate is non-zero", () => {
    expect(isPriced("claude-opus-4-8", table)).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/pricing.test.ts`
Expected: FAIL — cannot find module `./pricing`.

- [ ] **Step 4: Write the implementation**

```ts
// src/lib/pricing.ts
import type { UsageRecord } from "./normalize";
import pricingData from "./pricing.json" with { type: "json" };

export interface Rate {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

export type PricingTable = Record<string, Rate>;

export const defaultPricing: PricingTable = pricingData as PricingTable;

export function isPriced(
  model: string,
  table: PricingTable = defaultPricing,
): boolean {
  const r = table[model];
  if (!r) return false;
  return r.input > 0 || r.output > 0 || r.cacheWrite > 0 || r.cacheRead > 0;
}

export function cost(
  r: UsageRecord,
  table: PricingTable = defaultPricing,
): number {
  const rate = table[r.model];
  if (!rate) return 0;
  return (
    (r.inputTokens * rate.input +
      r.outputTokens * rate.output +
      r.cacheWriteTokens * rate.cacheWrite +
      r.cacheReadTokens * rate.cacheRead) /
    1_000_000
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/pricing.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/pricing.json src/lib/pricing.ts src/lib/pricing.test.ts
git commit -m "feat(lib): add editable pricing table and cost computation"
```

---

## Task 4: Claude transcript parser

**Files:**

- Create: `src/lib/parsers/claude.ts`, `src/lib/parsers/__fixtures__/claude-sample.jsonl`
- Test: `src/lib/parsers/claude.test.ts`

**Interfaces:**

- Consumes: `UsageRecord`, `ParsedFile`, `projectFromCwd` from `normalize.ts`.
- Produces: `parseClaudeFile(path: string): ParsedFile` — one `UsageRecord` per assistant line that has a `message.usage` block; `quota` is always `null`; malformed JSON lines are skipped.

- [ ] **Step 1: Create the fixture**

```jsonl
{"type":"assistant","timestamp":"2026-06-01T10:00:00.000Z","cwd":"/Users/me/ProjA","sessionId":"s1","gitBranch":"main","message":{"model":"claude-opus-4-8","usage":{"input_tokens":100,"output_tokens":50,"cache_creation_input_tokens":200,"cache_read_input_tokens":300}}}
{"type":"user","timestamp":"2026-06-01T10:30:00.000Z","cwd":"/Users/me/ProjA","sessionId":"s1","message":{"role":"user","content":"hi"}}
{"type":"assistant","timestamp":"2026-06-01T11:00:00.000Z","cwd":"/Users/me/ProjA","sessionId":"s1","message":{"model":"claude-sonnet-4-6","usage":{"input_tokens":10,"output_tokens":5,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}
{ this line is not valid json
```

> Expected: 2 records (the two assistant lines). The user line has no `usage`; the last line is malformed and skipped.

- [ ] **Step 2: Write the failing test**

```ts
// src/lib/parsers/claude.test.ts
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { parseClaudeFile } from "./claude";

const fixture = fileURLToPath(
  new URL("./__fixtures__/claude-sample.jsonl", import.meta.url),
);

describe("parseClaudeFile", () => {
  it("extracts one record per assistant turn with usage, skipping others and malformed lines", () => {
    const { records, quota } = parseClaudeFile(fixture);
    expect(quota).toBeNull();
    expect(records).toHaveLength(2);

    const [a, b] = records;
    expect(a).toMatchObject({
      tool: "claude",
      model: "claude-opus-4-8",
      project: "ProjA",
      sessionId: "s1",
      timestamp: "2026-06-01T10:00:00.000Z",
      inputTokens: 100,
      outputTokens: 50,
      cacheWriteTokens: 200,
      cacheReadTokens: 300,
      reasoningTokens: 0,
    });
    expect(b).toMatchObject({
      model: "claude-sonnet-4-6",
      inputTokens: 10,
      outputTokens: 5,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/parsers/claude.test.ts`
Expected: FAIL — cannot find module `./claude`.

- [ ] **Step 4: Write the implementation**

```ts
// src/lib/parsers/claude.ts
import { readFileSync } from "node:fs";
import {
  projectFromCwd,
  type ParsedFile,
  type UsageRecord,
} from "../normalize";

export function parseClaudeFile(path: string): ParsedFile {
  const records: UsageRecord[] = [];
  const lines = readFileSync(path, "utf8").split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: any;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue; // skip malformed lines
    }
    const message = obj?.message;
    const usage = message?.usage;
    if (!usage || obj?.type !== "assistant") continue;

    records.push({
      tool: "claude",
      timestamp: String(obj.timestamp ?? ""),
      model: String(message.model ?? "unknown"),
      project: projectFromCwd(obj.cwd),
      sessionId: String(obj.sessionId ?? ""),
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      reasoningTokens: 0,
    });
  }

  return { records, quota: null };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/parsers/claude.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/parsers/claude.ts src/lib/parsers/claude.test.ts src/lib/parsers/__fixtures__/claude-sample.jsonl
git commit -m "feat(lib): parse Claude Code transcripts into usage records"
```

---

## Task 5: Codex rollout parser (with double-count guard)

**Files:**

- Create: `src/lib/parsers/codex.ts`, `src/lib/parsers/__fixtures__/codex-sample.jsonl`
- Test: `src/lib/parsers/codex.test.ts`

**Interfaces:**

- Consumes: `UsageRecord`, `ParsedFile`, `RateLimitSnapshot`, `projectFromCwd`, `totalTokens` from `normalize.ts`.
- Produces: `parseCodexFile(path: string): ParsedFile` — one `UsageRecord` per `token_count` event whose `info.last_token_usage` is present; `quota` is the latest `rate_limits` snapshot in the file (or `null`). Tracks current model from `turn_context` and cwd from `session_meta`/`turn_context`.

- [ ] **Step 1: Create the fixture**

```jsonl
{"timestamp":"2026-06-02T09:00:00.000Z","type":"session_meta","payload":{"id":"c1","timestamp":"2026-06-02T09:00:00.000Z","cwd":"/Users/me/ProjB","cli_version":"1.0.0"}}
{"timestamp":"2026-06-02T09:00:00.500Z","type":"turn_context","payload":{"turn_id":"t1","cwd":"/Users/me/ProjB","model":"gpt-5.3-codex","reasoning_effort":"medium"}}
{"timestamp":"2026-06-02T09:00:01.000Z","type":"event_msg","payload":{"type":"token_count","info":null,"rate_limits":{"primary":{"used_percent":10,"window_minutes":300,"resets_at":1000},"secondary":{"used_percent":5,"window_minutes":10080,"resets_at":2000}}}}
{"timestamp":"2026-06-02T09:05:00.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1000,"cached_input_tokens":800,"output_tokens":100,"reasoning_output_tokens":40,"total_tokens":1100},"last_token_usage":{"input_tokens":1000,"cached_input_tokens":800,"output_tokens":100,"reasoning_output_tokens":40,"total_tokens":1100},"model_context_window":258400},"rate_limits":{"primary":{"used_percent":20,"window_minutes":300,"resets_at":1000},"secondary":{"used_percent":6,"window_minutes":10080,"resets_at":2000}}}}
{"timestamp":"2026-06-02T09:10:00.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1500,"cached_input_tokens":1000,"output_tokens":150,"reasoning_output_tokens":50,"total_tokens":1650},"last_token_usage":{"input_tokens":500,"cached_input_tokens":200,"output_tokens":50,"reasoning_output_tokens":10,"total_tokens":550},"model_context_window":258400},"rate_limits":{"primary":{"used_percent":30,"window_minutes":300,"resets_at":1000},"secondary":{"used_percent":7,"window_minutes":10080,"resets_at":2000}}}}
```

> Canonical anchors: the final `total_token_usage.total_tokens` is **1650**. The two emitted records (events 4 and 5; event 3 has `info: null`) carry `last_token_usage.total_tokens` of 1100 and 550, which sum to 1650 — the double-count guard.
> Record 1: fresh input `1000 − 800 = 200`, cacheRead `800`, output `100`, reasoning `40` → `totalTokens = 1100`.
> Record 2: fresh input `500 − 200 = 300`, cacheRead `200`, output `50`, reasoning `10` → `totalTokens = 550`.

- [ ] **Step 2: Write the failing test**

```ts
// src/lib/parsers/codex.test.ts
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { parseCodexFile } from "./codex";
import { totalTokens } from "../normalize";

const fixture = fileURLToPath(
  new URL("./__fixtures__/codex-sample.jsonl", import.meta.url),
);

describe("parseCodexFile", () => {
  it("emits one record per token_count with last_token_usage, mapping fresh input and cache read", () => {
    const { records } = parseCodexFile(fixture);
    expect(records).toHaveLength(2);

    expect(records[0]).toMatchObject({
      tool: "codex",
      model: "gpt-5.3-codex",
      project: "ProjB",
      sessionId: "c1",
      timestamp: "2026-06-02T09:05:00.000Z",
      inputTokens: 200,
      cacheReadTokens: 800,
      outputTokens: 100,
      reasoningTokens: 40,
      cacheWriteTokens: 0,
    });
    expect(records[1]).toMatchObject({
      timestamp: "2026-06-02T09:10:00.000Z",
      inputTokens: 300,
      cacheReadTokens: 200,
      outputTokens: 50,
      reasoningTokens: 10,
    });
  });

  it("double-count guard: summed last_token_usage equals the final cumulative total", () => {
    const { records } = parseCodexFile(fixture);
    const summed = records.reduce((acc, r) => acc + totalTokens(r), 0);
    expect(summed).toBe(1650); // final total_token_usage.total_tokens
  });

  it("captures the latest rate-limit snapshot as quota", () => {
    const { quota } = parseCodexFile(fixture);
    expect(quota).not.toBeNull();
    expect(quota!.timestamp).toBe("2026-06-02T09:10:00.000Z");
    expect(quota!.primary).toMatchObject({
      usedPercent: 30,
      windowMinutes: 300,
      resetsAt: 1000,
    });
    expect(quota!.secondary).toMatchObject({
      usedPercent: 7,
      windowMinutes: 10080,
      resetsAt: 2000,
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/parsers/codex.test.ts`
Expected: FAIL — cannot find module `./codex`.

- [ ] **Step 4: Write the implementation**

```ts
// src/lib/parsers/codex.ts
import { readFileSync } from "node:fs";
import {
  projectFromCwd,
  type ParsedFile,
  type RateLimitSnapshot,
  type RateLimitWindow,
  type UsageRecord,
} from "../normalize";

function toWindow(w: any): RateLimitWindow | null {
  if (!w || typeof w.used_percent !== "number") return null;
  return {
    usedPercent: w.used_percent,
    windowMinutes: w.window_minutes ?? 0,
    resetsAt: w.resets_at ?? 0,
  };
}

export function parseCodexFile(path: string): ParsedFile {
  const records: UsageRecord[] = [];
  let quota: RateLimitSnapshot | null = null;
  let model = "unknown";
  let cwd: string | null = null;
  let sessionId = "";

  const lines = readFileSync(path, "utf8").split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: any;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }

    if (obj.type === "session_meta") {
      cwd = obj.payload?.cwd ?? cwd;
      sessionId = obj.payload?.id ?? sessionId;
      continue;
    }

    if (obj.type === "turn_context") {
      if (obj.payload?.model) model = obj.payload.model;
      if (obj.payload?.cwd) cwd = obj.payload.cwd;
      continue;
    }

    if (obj.type === "event_msg" && obj.payload?.type === "token_count") {
      const rl = obj.payload.rate_limits;
      if (rl) {
        quota = {
          timestamp: String(obj.timestamp ?? ""),
          primary: toWindow(rl.primary),
          secondary: toWindow(rl.secondary),
        };
      }
      const last = obj.payload.info?.last_token_usage;
      if (!last) continue;

      const input = last.input_tokens ?? 0;
      const cached = last.cached_input_tokens ?? 0;
      records.push({
        tool: "codex",
        timestamp: String(obj.timestamp ?? ""),
        model,
        project: projectFromCwd(cwd),
        sessionId,
        inputTokens: Math.max(0, input - cached),
        outputTokens: last.output_tokens ?? 0,
        cacheWriteTokens: 0,
        cacheReadTokens: cached,
        reasoningTokens: last.reasoning_output_tokens ?? 0,
      });
    }
  }

  return { records, quota };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/parsers/codex.test.ts`
Expected: PASS — including the double-count guard.

- [ ] **Step 6: Commit**

```bash
git add src/lib/parsers/codex.ts src/lib/parsers/codex.test.ts src/lib/parsers/__fixtures__/codex-sample.jsonl
git commit -m "feat(lib): parse Codex rollouts with per-turn token accounting"
```

---

## Task 6: Aggregation

**Files:**

- Create: `src/lib/aggregate.ts`
- Test: `src/lib/aggregate.test.ts`

**Interfaces:**

- Consumes: `UsageRecord`, `RateLimitSnapshot`, `totalTokens` from `normalize.ts`; `cost`, `isPriced`, `PricingTable` from `pricing.ts`.
- Produces:
  - `interface ToolTotal { tokens: number; cost: number }`
  - `interface DayPoint { date: string; claudeTokens: number; codexTokens: number; claudeCost: number; codexCost: number }`
  - `interface ProjectPoint { project: string; tool: Tool; tokens: number; cost: number }`
  - `interface ModelPoint { model: string; tool: Tool; tokens: number; cost: number; unpriced: boolean }`
  - `interface Rollups { totals: { claude: ToolTotal; codex: ToolTotal; combined: ToolTotal }; byDay: DayPoint[]; byProject: ProjectPoint[]; byModel: ModelPoint[]; dateRange: { start: string | null; end: string | null }; codexQuota: RateLimitSnapshot | null }`
  - `aggregate(records: UsageRecord[], codexQuota: RateLimitSnapshot | null, pricing?: PricingTable): Rollups`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/aggregate.test.ts
import { describe, it, expect } from "vitest";
import { aggregate } from "./aggregate";
import type { UsageRecord } from "./normalize";
import type { PricingTable } from "./pricing";

const pricing: PricingTable = {
  "claude-opus-4-8": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "gpt-5.3-codex": { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
};

function rec(p: Partial<UsageRecord>): UsageRecord {
  return {
    tool: "claude",
    timestamp: "2026-06-01T10:00:00.000Z",
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

describe("aggregate", () => {
  const records = [
    rec({
      tool: "claude",
      timestamp: "2026-06-01T10:00:00.000Z",
      model: "claude-opus-4-8",
      project: "ProjA",
      inputTokens: 100,
      outputTokens: 50,
      cacheWriteTokens: 200,
      cacheReadTokens: 300,
    }),
    rec({
      tool: "claude",
      timestamp: "2026-06-02T10:00:00.000Z",
      model: "claude-opus-4-8",
      project: "ProjB",
      inputTokens: 10,
      outputTokens: 5,
    }),
    rec({
      tool: "codex",
      timestamp: "2026-06-02T11:00:00.000Z",
      model: "gpt-5.3-codex",
      project: "ProjB",
      inputTokens: 200,
      cacheReadTokens: 800,
      outputTokens: 100,
      reasoningTokens: 40,
    }),
  ];
  const r = aggregate(records, null, pricing);

  it("totals tokens and cost per tool and combined", () => {
    // claude tokens: (100+50+200+300) + (10+5) = 665
    expect(r.totals.claude.tokens).toBe(665);
    // codex tokens: 200+100+0+800 = 1100
    expect(r.totals.codex.tokens).toBe(1100);
    expect(r.totals.combined.tokens).toBe(1765);
    // claude cost: rec1 3150/1e6 + rec2 (10*5+5*25)/1e6 = 3150/1e6 + 175/1e6
    expect(r.totals.claude.cost).toBeCloseTo(0.003325, 10);
    // codex priced at 0 → cost 0
    expect(r.totals.codex.cost).toBe(0);
  });

  it("buckets by day with per-tool token totals", () => {
    expect(r.byDay).toEqual([
      {
        date: "2026-06-01",
        claudeTokens: 650,
        codexTokens: 0,
        claudeCost: 0.00315,
        codexCost: 0,
      },
      {
        date: "2026-06-02",
        claudeTokens: 15,
        codexTokens: 1100,
        claudeCost: 0.000175,
        codexCost: 0,
      },
    ]);
  });

  it("buckets by project and by model, marking unpriced models", () => {
    const codexModel = r.byModel.find((m) => m.model === "gpt-5.3-codex");
    expect(codexModel?.unpriced).toBe(true);
    const opusModel = r.byModel.find((m) => m.model === "claude-opus-4-8");
    expect(opusModel?.unpriced).toBe(false);
    expect(r.byProject.map((p) => p.project)).toContain("ProjB");
  });

  it("reports the date range", () => {
    expect(r.dateRange).toEqual({
      start: "2026-06-01T10:00:00.000Z",
      end: "2026-06-02T11:00:00.000Z",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/aggregate.test.ts`
Expected: FAIL — cannot find module `./aggregate`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/aggregate.ts
import {
  totalTokens,
  type RateLimitSnapshot,
  type Tool,
  type UsageRecord,
} from "./normalize";
import { cost, defaultPricing, isPriced, type PricingTable } from "./pricing";

export interface ToolTotal {
  tokens: number;
  cost: number;
}
export interface DayPoint {
  date: string;
  claudeTokens: number;
  codexTokens: number;
  claudeCost: number;
  codexCost: number;
}
export interface ProjectPoint {
  project: string;
  tool: Tool;
  tokens: number;
  cost: number;
}
export interface ModelPoint {
  model: string;
  tool: Tool;
  tokens: number;
  cost: number;
  unpriced: boolean;
}

export interface Rollups {
  totals: { claude: ToolTotal; codex: ToolTotal; combined: ToolTotal };
  byDay: DayPoint[];
  byProject: ProjectPoint[];
  byModel: ModelPoint[];
  dateRange: { start: string | null; end: string | null };
  codexQuota: RateLimitSnapshot | null;
}

export function aggregate(
  records: UsageRecord[],
  codexQuota: RateLimitSnapshot | null,
  pricing: PricingTable = defaultPricing,
): Rollups {
  const claude: ToolTotal = { tokens: 0, cost: 0 };
  const codex: ToolTotal = { tokens: 0, cost: 0 };
  const days = new Map<string, DayPoint>();
  const projects = new Map<string, ProjectPoint>();
  const models = new Map<string, ModelPoint>();
  let start: string | null = null;
  let end: string | null = null;

  for (const r of records) {
    const tokens = totalTokens(r);
    const c = cost(r, pricing);

    const toolTotal = r.tool === "claude" ? claude : codex;
    toolTotal.tokens += tokens;
    toolTotal.cost += c;

    const date = r.timestamp.slice(0, 10);
    let day = days.get(date);
    if (!day) {
      day = {
        date,
        claudeTokens: 0,
        codexTokens: 0,
        claudeCost: 0,
        codexCost: 0,
      };
      days.set(date, day);
    }
    if (r.tool === "claude") {
      day.claudeTokens += tokens;
      day.claudeCost += c;
    } else {
      day.codexTokens += tokens;
      day.codexCost += c;
    }

    const pKey = `${r.tool}�${r.project}`;
    let proj = projects.get(pKey);
    if (!proj) {
      proj = { project: r.project, tool: r.tool, tokens: 0, cost: 0 };
      projects.set(pKey, proj);
    }
    proj.tokens += tokens;
    proj.cost += c;

    const mKey = `${r.tool}�${r.model}`;
    let mod = models.get(mKey);
    if (!mod) {
      mod = {
        model: r.model,
        tool: r.tool,
        tokens: 0,
        cost: 0,
        unpriced: !isPriced(r.model, pricing),
      };
      models.set(mKey, mod);
    }
    mod.tokens += tokens;
    mod.cost += c;

    if (r.timestamp) {
      if (start === null || r.timestamp < start) start = r.timestamp;
      if (end === null || r.timestamp > end) end = r.timestamp;
    }
  }

  return {
    totals: {
      claude,
      codex,
      combined: {
        tokens: claude.tokens + codex.tokens,
        cost: claude.cost + codex.cost,
      },
    },
    byDay: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    byProject: [...projects.values()].sort((a, b) => b.tokens - a.tokens),
    byModel: [...models.values()].sort((a, b) => b.tokens - a.tokens),
    dateRange: { start, end },
    codexQuota,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/aggregate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/aggregate.ts src/lib/aggregate.test.ts
git commit -m "feat(lib): aggregate usage records into dashboard rollups"
```

---

## Task 7: Filesystem scan with mtime cache

**Files:**

- Create: `src/lib/cache.ts`, `src/lib/scan.ts`
- Test: `src/lib/scan.test.ts`

**Interfaces:**

- Consumes: `parseClaudeFile`, `parseCodexFile`; `ParsedFile`, `UsageRecord`, `RateLimitSnapshot`.
- Produces:
  - `parseFileCached(path: string, parser: (p: string) => ParsedFile): ParsedFile`
  - `clearCache(): void`
  - `listJsonlFiles(dir: string): string[]` (recursive; empty array if dir missing)
  - `interface ScanResult { records: UsageRecord[]; codexQuota: RateLimitSnapshot | null }`
  - `scan(opts?: { claudeDir?: string; codexDir?: string }): ScanResult` (defaults to `~/.claude/projects` and `~/.codex/sessions`)

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/scan.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  mkdirSync,
  utimesSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scan } from "./scan";
import { parseClaudeFile } from "./parsers/claude";
import { parseFileCached, clearCache } from "./cache";

let claudeDir: string;
let codexDir: string;

beforeEach(() => {
  clearCache();
  claudeDir = mkdtempSync(join(tmpdir(), "ut-claude-"));
  codexDir = mkdtempSync(join(tmpdir(), "ut-codex-"));
});
afterEach(() => {
  rmSync(claudeDir, { recursive: true, force: true });
  rmSync(codexDir, { recursive: true, force: true });
});

const claudeLine = JSON.stringify({
  type: "assistant",
  timestamp: "2026-06-01T10:00:00.000Z",
  cwd: "/Users/me/ProjA",
  sessionId: "s1",
  message: {
    model: "claude-opus-4-8",
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  },
});

const codexLines = [
  JSON.stringify({
    timestamp: "2026-06-02T09:00:00.000Z",
    type: "turn_context",
    payload: { cwd: "/Users/me/ProjB", model: "gpt-5.3-codex" },
  }),
  JSON.stringify({
    timestamp: "2026-06-02T09:05:00.000Z",
    type: "event_msg",
    payload: {
      type: "token_count",
      info: {
        last_token_usage: {
          input_tokens: 300,
          cached_input_tokens: 100,
          output_tokens: 20,
          reasoning_output_tokens: 5,
          total_tokens: 320,
        },
      },
      rate_limits: {
        primary: { used_percent: 12, window_minutes: 300, resets_at: 1 },
        secondary: { used_percent: 3, window_minutes: 10080, resets_at: 2 },
      },
    },
  }),
].join("\n");

describe("scan", () => {
  it("reads nested .jsonl files from both roots and merges records", () => {
    mkdirSync(join(claudeDir, "proj"), { recursive: true });
    writeFileSync(join(claudeDir, "proj", "a.jsonl"), claudeLine);
    mkdirSync(join(codexDir, "2026", "06", "02"), { recursive: true });
    writeFileSync(join(codexDir, "2026", "06", "02", "r.jsonl"), codexLines);

    const { records, codexQuota } = scan({ claudeDir, codexDir });
    expect(records).toHaveLength(2);
    expect(records.some((r) => r.tool === "claude")).toBe(true);
    expect(records.some((r) => r.tool === "codex")).toBe(true);
    expect(codexQuota?.primary?.usedPercent).toBe(12);
  });

  it("returns empty results for a missing directory", () => {
    const { records } = scan({
      claudeDir: join(claudeDir, "nope"),
      codexDir: join(codexDir, "nope"),
    });
    expect(records).toEqual([]);
  });
});

describe("parseFileCached", () => {
  it("re-parses only when mtime changes", () => {
    const f = join(claudeDir, "a.jsonl");
    writeFileSync(f, claudeLine);
    let calls = 0;
    const counting = (p: string) => {
      calls++;
      return parseClaudeFile(p);
    };

    parseFileCached(f, counting);
    parseFileCached(f, counting);
    expect(calls).toBe(1); // second call served from cache

    utimesSync(f, new Date(), new Date(Date.now() + 5000)); // bump mtime
    parseFileCached(f, counting);
    expect(calls).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/scan.test.ts`
Expected: FAIL — cannot find module `./scan` / `./cache`.

- [ ] **Step 3: Write `src/lib/cache.ts`**

```ts
// src/lib/cache.ts
import { statSync } from "node:fs";
import type { ParsedFile } from "./normalize";

interface CacheEntry {
  mtimeMs: number;
  parsed: ParsedFile;
}

const cache = new Map<string, CacheEntry>();

export function parseFileCached(
  path: string,
  parser: (p: string) => ParsedFile,
): ParsedFile {
  const mtimeMs = statSync(path).mtimeMs;
  const hit = cache.get(path);
  if (hit && hit.mtimeMs === mtimeMs) return hit.parsed;
  const parsed = parser(path);
  cache.set(path, { mtimeMs, parsed });
  return parsed;
}

export function clearCache(): void {
  cache.clear();
}
```

- [ ] **Step 4: Write `src/lib/scan.ts`**

```ts
// src/lib/scan.ts
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseFileCached } from "./cache";
import { parseClaudeFile } from "./parsers/claude";
import { parseCodexFile } from "./parsers/codex";
import type { RateLimitSnapshot, UsageRecord } from "./normalize";

export interface ScanResult {
  records: UsageRecord[];
  codexQuota: RateLimitSnapshot | null;
}

export function listJsonlFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { recursive: true, encoding: "utf8" })
      .filter((name) => name.endsWith(".jsonl"))
      .map((name) => join(dir, name));
  } catch {
    return []; // directory missing
  }
}

export function scan(
  opts: { claudeDir?: string; codexDir?: string } = {},
): ScanResult {
  const claudeDir = opts.claudeDir ?? join(homedir(), ".claude", "projects");
  const codexDir = opts.codexDir ?? join(homedir(), ".codex", "sessions");

  const records: UsageRecord[] = [];
  let codexQuota: RateLimitSnapshot | null = null;

  for (const file of listJsonlFiles(claudeDir)) {
    records.push(...parseFileCached(file, parseClaudeFile).records);
  }

  for (const file of listJsonlFiles(codexDir)) {
    const parsed = parseFileCached(file, parseCodexFile);
    records.push(...parsed.records);
    if (
      parsed.quota &&
      (!codexQuota || parsed.quota.timestamp > codexQuota.timestamp)
    ) {
      codexQuota = parsed.quota;
    }
  }

  return { records, codexQuota };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/scan.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/cache.ts src/lib/scan.ts src/lib/scan.test.ts
git commit -m "feat(lib): scan usage directories with mtime-based parse cache"
```

---

## Task 8: Filters and API endpoints

**Files:**

- Create: `src/lib/filters.ts`, `src/pages/api/usage.ts`, `src/pages/api/refresh.ts`
- Test: `src/lib/filters.test.ts`, `src/pages/api/usage.test.ts`

**Interfaces:**

- Consumes: `UsageRecord`; `scan`, `clearCache`; `aggregate`; `defaultPricing`.
- Produces:
  - `applyFilters(records: UsageRecord[], params: URLSearchParams): UsageRecord[]` (supports `tool`, `from`, `to`)
  - `GET` route at `/api/usage` returning `Rollups` JSON.
  - `POST` route at `/api/refresh` returning fresh `Rollups` JSON after clearing the cache.

- [ ] **Step 1: Write the failing filters test**

```ts
// src/lib/filters.test.ts
import { describe, it, expect } from "vitest";
import { applyFilters } from "./filters";
import type { UsageRecord } from "./normalize";

function rec(p: Partial<UsageRecord>): UsageRecord {
  return {
    tool: "claude",
    timestamp: "2026-06-01T10:00:00.000Z",
    model: "m",
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

const records = [
  rec({ tool: "claude", timestamp: "2026-06-01T10:00:00.000Z" }),
  rec({ tool: "codex", timestamp: "2026-06-03T10:00:00.000Z" }),
];

describe("applyFilters", () => {
  it("returns all records when no params", () => {
    expect(applyFilters(records, new URLSearchParams())).toHaveLength(2);
  });
  it("filters by tool", () => {
    const out = applyFilters(records, new URLSearchParams({ tool: "codex" }));
    expect(out).toHaveLength(1);
    expect(out[0].tool).toBe("codex");
  });
  it("filters by from/to date range (inclusive)", () => {
    const out = applyFilters(
      records,
      new URLSearchParams({ from: "2026-06-02", to: "2026-06-04" }),
    );
    expect(out).toHaveLength(1);
    expect(out[0].tool).toBe("codex");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/filters.test.ts`
Expected: FAIL — cannot find module `./filters`.

- [ ] **Step 3: Write `src/lib/filters.ts`**

```ts
// src/lib/filters.ts
import type { Tool, UsageRecord } from "./normalize";

export function applyFilters(
  records: UsageRecord[],
  params: URLSearchParams,
): UsageRecord[] {
  const tool = params.get("tool") as Tool | null;
  const from = params.get("from"); // YYYY-MM-DD inclusive
  const to = params.get("to"); // YYYY-MM-DD inclusive

  return records.filter((r) => {
    if (tool && r.tool !== tool) return false;
    const date = r.timestamp.slice(0, 10);
    if (from && date < from) return false;
    if (to && date > to) return false;
    return true;
  });
}
```

- [ ] **Step 4: Run filters test to verify it passes**

Run: `npx vitest run src/lib/filters.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing endpoint test**

```ts
// src/pages/api/usage.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/scan", () => ({
  scan: () => ({
    records: [
      {
        tool: "claude",
        timestamp: "2026-06-01T10:00:00.000Z",
        model: "claude-opus-4-8",
        project: "ProjA",
        sessionId: "s",
        inputTokens: 100,
        outputTokens: 50,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
        reasoningTokens: 0,
      },
      {
        tool: "codex",
        timestamp: "2026-06-02T10:00:00.000Z",
        model: "gpt-5.3-codex",
        project: "ProjB",
        sessionId: "c",
        inputTokens: 200,
        outputTokens: 20,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
        reasoningTokens: 0,
      },
    ],
    codexQuota: {
      timestamp: "2026-06-02T10:00:00.000Z",
      primary: { usedPercent: 15, windowMinutes: 300, resetsAt: 1 },
      secondary: null,
    },
  }),
}));

beforeEach(() => vi.clearAllMocks());

describe("GET /api/usage", () => {
  it("returns aggregated rollups as JSON", async () => {
    const { GET } = await import("./usage");
    const res = await GET({
      url: new URL("http://localhost/api/usage"),
    } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totals.combined.tokens).toBe(370); // 150 + 220
    expect(body.codexQuota.primary.usedPercent).toBe(15);
  });

  it("honours the tool filter", async () => {
    const { GET } = await import("./usage");
    const res = await GET({
      url: new URL("http://localhost/api/usage?tool=claude"),
    } as any);
    const body = await res.json();
    expect(body.totals.combined.tokens).toBe(150);
  });
});
```

- [ ] **Step 6: Run endpoint test to verify it fails**

Run: `npx vitest run src/pages/api/usage.test.ts`
Expected: FAIL — cannot find module `./usage`.

- [ ] **Step 7: Write `src/pages/api/usage.ts`**

```ts
// src/pages/api/usage.ts
import type { APIRoute } from "astro";
import { scan } from "../../lib/scan";
import { applyFilters } from "../../lib/filters";
import { aggregate } from "../../lib/aggregate";

export const prerender = false;

export const GET: APIRoute = ({ url }) => {
  const { records, codexQuota } = scan();
  const filtered = applyFilters(records, url.searchParams);
  const rollups = aggregate(filtered, codexQuota);
  return new Response(JSON.stringify(rollups), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
```

- [ ] **Step 8: Write `src/pages/api/refresh.ts`**

```ts
// src/pages/api/refresh.ts
import type { APIRoute } from "astro";
import { scan } from "../../lib/scan";
import { clearCache } from "../../lib/cache";
import { aggregate } from "../../lib/aggregate";

export const prerender = false;

export const POST: APIRoute = () => {
  clearCache();
  const { records, codexQuota } = scan();
  const rollups = aggregate(records, codexQuota);
  return new Response(JSON.stringify(rollups), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
```

- [ ] **Step 9: Run endpoint test to verify it passes**

Run: `npx vitest run src/pages/api/usage.test.ts`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/lib/filters.ts src/lib/filters.test.ts src/pages/api/usage.ts src/pages/api/refresh.ts src/pages/api/usage.test.ts
git commit -m "feat(api): expose usage and refresh endpoints with filtering"
```

---

## Task 9: Layout, dashboard page, and summary islands

**Files:**

- Create: `src/layouts/Layout.astro`, `src/components/Overview.tsx`, `src/components/ByModel.tsx`, `src/components/ByProject.tsx`
- Modify: `src/pages/index.astro` (replace the scaffold)

**Interfaces:**

- Consumes: `scan`, `aggregate`, `Rollups`.
- Produces: a server-rendered page mounting the three islands with `rollups` props. `Overview` shows headline totals; `ByModel`/`ByProject` are Recharts bar charts.

- [ ] **Step 1: Create `src/layouts/Layout.astro`**

```astro
---
import '../styles/global.css';
interface Props { title?: string }
const { title = 'Usage Tracker' } = Astro.props;
---
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title}</title>
  </head>
  <body class="bg-neutral-950 text-neutral-100 min-h-screen">
    <main class="max-w-6xl mx-auto px-6 py-8 space-y-8">
      <h1 class="text-2xl font-semibold">Usage Tracker</h1>
      <slot />
    </main>
  </body>
</html>
```

- [ ] **Step 2: Create `src/components/Overview.tsx`**

```tsx
// src/components/Overview.tsx
import type { Rollups } from "../lib/aggregate";

function fmtTokens(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}
function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

export default function Overview({ data }: { data: Rollups }) {
  const cards = [
    { label: "Total tokens", value: fmtTokens(data.totals.combined.tokens) },
    { label: "Estimated cost", value: fmtUsd(data.totals.combined.cost) },
    { label: "Claude tokens", value: fmtTokens(data.totals.claude.tokens) },
    { label: "Codex tokens", value: fmtTokens(data.totals.codex.tokens) },
  ];
  return (
    <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {cards.map((c) => (
        <div key={c.label} className="rounded-xl bg-neutral-900 p-4">
          <div className="text-sm text-neutral-400">{c.label}</div>
          <div className="text-2xl font-semibold mt-1">{c.value}</div>
        </div>
      ))}
    </section>
  );
}
```

- [ ] **Step 3: Create `src/components/ByModel.tsx`**

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
    <section className="rounded-xl bg-neutral-900 p-4">
      <h2 className="text-lg font-medium mb-4">By model</h2>
      <ResponsiveContainer
        width="100%"
        height={Math.max(120, rows.length * 44)}
      >
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ left: 24, right: 24 }}
        >
          <XAxis type="number" stroke="#9ca3af" />
          <YAxis type="category" dataKey="name" width={180} stroke="#9ca3af" />
          <Tooltip />
          <Bar dataKey="tokens" fill="#60a5fa" radius={4} />
        </BarChart>
      </ResponsiveContainer>
    </section>
  );
}
```

- [ ] **Step 4: Create `src/components/ByProject.tsx`**

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
  const rows = data.byProject.slice(0, 12).map((p) => ({
    name: `${p.project} · ${p.tool}`,
    tokens: p.tokens,
  }));
  return (
    <section className="rounded-xl bg-neutral-900 p-4">
      <h2 className="text-lg font-medium mb-4">By project</h2>
      <ResponsiveContainer
        width="100%"
        height={Math.max(120, rows.length * 36)}
      >
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ left: 24, right: 24 }}
        >
          <XAxis type="number" stroke="#9ca3af" />
          <YAxis type="category" dataKey="name" width={200} stroke="#9ca3af" />
          <Tooltip />
          <Bar dataKey="tokens" fill="#34d399" radius={4} />
        </BarChart>
      </ResponsiveContainer>
    </section>
  );
}
```

- [ ] **Step 5: Replace `src/pages/index.astro`**

```astro
---
import Layout from '../layouts/Layout.astro';
import Overview from '../components/Overview.tsx';
import ByModel from '../components/ByModel.tsx';
import ByProject from '../components/ByProject.tsx';
import { scan } from '../lib/scan';
import { aggregate } from '../lib/aggregate';

export const prerender = false;

const { records, codexQuota } = scan();
const rollups = aggregate(records, codexQuota);
---
<Layout>
  <Overview client:load data={rollups} />
  <ByModel client:load data={rollups} />
  <ByProject client:load data={rollups} />
</Layout>
```

- [ ] **Step 6: Verify the dashboard renders against real data**

Run: `npm run dev`
Then open `http://localhost:4321`.
Expected: the page loads with four total cards showing non-zero token counts (your real `~/.claude` + `~/.codex` data), plus "By model" and "By project" bar charts. Confirm Claude and Codex both appear. Stop the server when done.

- [ ] **Step 7: Commit**

```bash
git add src/layouts/Layout.astro src/components/Overview.tsx src/components/ByModel.tsx src/components/ByProject.tsx src/pages/index.astro
git commit -m "feat(ui): render overview totals and model/project breakdowns"
```

---

## Task 10: Trend chart, quota panel, and filters

**Files:**

- Create: `src/components/TrendChart.tsx`, `src/components/QuotaPanel.tsx`, `src/components/Dashboard.tsx`
- Modify: `src/pages/index.astro` (mount a single `Dashboard` island that owns filters + refetch)

**Interfaces:**

- Consumes: `Rollups`. `Dashboard` fetches `/api/usage` with filter params and `/api/refresh`, re-rendering all child charts.
- Produces: the complete interactive dashboard.

- [ ] **Step 1: Create `src/components/TrendChart.tsx`**

```tsx
// src/components/TrendChart.tsx
import { useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { Rollups } from "../lib/aggregate";

export default function TrendChart({ data }: { data: Rollups }) {
  const [metric, setMetric] = useState<"tokens" | "cost">("tokens");
  const rows = data.byDay.map((d) => ({
    date: d.date,
    Claude: metric === "tokens" ? d.claudeTokens : d.claudeCost,
    Codex: metric === "tokens" ? d.codexTokens : d.codexCost,
  }));
  return (
    <section className="rounded-xl bg-neutral-900 p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-medium">Over time</h2>
        <div className="flex gap-2 text-sm">
          {(["tokens", "cost"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMetric(m)}
              className={`px-2 py-1 rounded ${metric === m ? "bg-blue-500 text-white" : "bg-neutral-800 text-neutral-300"}`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={rows}>
          <XAxis dataKey="date" stroke="#9ca3af" />
          <YAxis stroke="#9ca3af" />
          <Tooltip />
          <Legend />
          <Area
            type="monotone"
            dataKey="Claude"
            stackId="1"
            stroke="#60a5fa"
            fill="#60a5fa"
            fillOpacity={0.5}
          />
          <Area
            type="monotone"
            dataKey="Codex"
            stackId="1"
            stroke="#f59e0b"
            fill="#f59e0b"
            fillOpacity={0.5}
          />
        </AreaChart>
      </ResponsiveContainer>
    </section>
  );
}
```

- [ ] **Step 2: Create `src/components/QuotaPanel.tsx`**

```tsx
// src/components/QuotaPanel.tsx
import type { Rollups } from "../lib/aggregate";
import type { RateLimitWindow } from "../lib/normalize";

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

export default function QuotaPanel({ data }: { data: Rollups }) {
  const q = data.codexQuota;
  return (
    <section className="rounded-xl bg-neutral-900 p-4 space-y-3">
      <h2 className="text-lg font-medium">Codex quota</h2>
      {q ? (
        <>
          <Bar label="5h window" w={q.primary} />
          <Bar label="Weekly window" w={q.secondary} />
        </>
      ) : (
        <div className="text-sm text-neutral-400">
          No Codex quota data found.
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Create `src/components/Dashboard.tsx`**

```tsx
// src/components/Dashboard.tsx
import { useState } from "react";
import type { Rollups } from "../lib/aggregate";
import type { Tool } from "../lib/normalize";
import Overview from "./Overview";
import TrendChart from "./TrendChart";
import ByModel from "./ByModel";
import ByProject from "./ByProject";
import QuotaPanel from "./QuotaPanel";

export default function Dashboard({ initial }: { initial: Rollups }) {
  const [data, setData] = useState<Rollups>(initial);
  const [tool, setTool] = useState<Tool | "all">("all");
  const [loading, setLoading] = useState(false);

  async function load(nextTool: Tool | "all", refresh = false) {
    setLoading(true);
    try {
      if (refresh) {
        await fetch("/api/refresh", { method: "POST" });
      }
      const params = new URLSearchParams();
      if (nextTool !== "all") params.set("tool", nextTool);
      const res = await fetch(`/api/usage?${params.toString()}`);
      setData(await res.json());
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2 text-sm">
        {(["all", "claude", "codex"] as const).map((t) => (
          <button
            key={t}
            onClick={() => {
              setTool(t);
              load(t);
            }}
            className={`px-3 py-1 rounded ${tool === t ? "bg-blue-500 text-white" : "bg-neutral-800 text-neutral-300"}`}
          >
            {t}
          </button>
        ))}
        <button
          onClick={() => load(tool, true)}
          className="ml-auto px-3 py-1 rounded bg-neutral-800 text-neutral-300"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>
      <Overview data={data} />
      <TrendChart data={data} />
      <div className="grid md:grid-cols-2 gap-8">
        <ByModel data={data} />
        <ByProject data={data} />
      </div>
      <QuotaPanel data={data} />
    </div>
  );
}
```

- [ ] **Step 4: Replace `src/pages/index.astro` to mount the single Dashboard island**

```astro
---
import Layout from '../layouts/Layout.astro';
import Dashboard from '../components/Dashboard.tsx';
import { scan } from '../lib/scan';
import { aggregate } from '../lib/aggregate';

export const prerender = false;

const { records, codexQuota } = scan();
const rollups = aggregate(records, codexQuota);
---
<Layout>
  <Dashboard client:load initial={rollups} />
</Layout>
```

- [ ] **Step 5: Verify the full dashboard end to end**

Run: `npm run dev`
Then open `http://localhost:4321` and check:

- Overview cards, "Over time" stacked area chart, "By model", "By project", and "Codex quota" all render with your real data.
- The `tokens`/`cost` toggle on the trend chart switches the series.
- The `all`/`claude`/`codex` filter buttons re-fetch and the totals change.
- `Refresh` re-scans (totals stay consistent; no error in the browser console).
  Stop the server when done.

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: all Vitest suites pass.

- [ ] **Step 7: Commit**

```bash
git add src/components/TrendChart.tsx src/components/QuotaPanel.tsx src/components/Dashboard.tsx src/pages/index.astro
git commit -m "feat(ui): add trend chart, Codex quota panel, and live filters"
```

---

## Self-Review notes (already folded into the plan)

- **Spec coverage:** tokens-over-time (Task 10 TrendChart), cost estimates (Tasks 3/6, Overview), by-project (Task 9), by-model (Task 9), Codex quota (Task 10), local on-demand run (Tasks 1/8/9). All five spec sections map to tasks.
- **Codex double-count guard** (spec decision #1): Task 5, dedicated test against the fixture's canonical `1650` total.
- **Quota honesty** (decision #2): Codex quota only; Claude has no quota panel (QuotaPanel shows Codex only) — no fabricated Claude percentage.
- **Cost notional** (decision #3): cache-read weighted at its own low rate in `cost()`.
- **Correction over spec:** Codex `input_tokens` includes cached, and `output_tokens` includes reasoning. The plan computes fresh input = `input − cached` and treats reasoning as informational (excluded from totals and cost). `costUsd` is computed at aggregation, not stored on the record. These are documented in Global Constraints.
- **Type consistency:** `Rollups`, `UsageRecord`, `RateLimitSnapshot`, `ParsedFile`, `cost`, `isPriced`, `aggregate`, `scan`, `applyFilters` names are used identically across tasks.

## Post-build iteration points (from the spec)

- Fill the real `gpt-5.x-codex` rates in `pricing.json`.
- Decide whether the trend chart defaults to `tokens` or `cost` (currently `tokens`).
- Project-label collisions (worktrees share a basename) — revisit `projectFromCwd` if noisy.
- Optional configured Claude plan-token limit for a Claude-side quota indicator.
- If real Codex sessions ever show `sum(last_token_usage) ≠ final total_token_usage`, switch the Codex parser to attribute each session's final `total_token_usage` to its date instead of per-event deltas.
