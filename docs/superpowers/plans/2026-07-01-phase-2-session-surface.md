# Phase 2 — Session Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a session-centric surface (sortable sessions list, on-demand Claude+Codex session-detail replay, and Claude compaction tracking) on top of the existing framework-agnostic core, without slowing the hot aggregate path.

**Architecture:** The mtime-cached scan pass is extended to emit per-session meta (turns, tool calls, compaction counts) and a `sessionId → { files, tool }` index alongside the existing records, so the list is built by grouping records with zero extra file reads. Session detail parses every file for the session on demand via new message parsers, concatenating messages in timestamp order. New pure `lib` modules (`sessions.ts`, `parsers/claude-messages.ts`, `parsers/codex-messages.ts`) feed new Astro SSR routes and React islands; nothing on the current Overview hot path changes shape. A single Codex rollout can contain more than one distinct `session_meta` id (e.g. a forked session that replays its parent's history — real forks open with the child `session_meta` carrying `forked_from_id` immediately followed by the parent's `session_meta`), so the Codex parser tracks the active id, attributes every record and meta count to it, and emits one `SessionMeta` per distinct id — while keeping ONE continuous cumulative-token baseline for the whole file (only attribution switches, never the token counter). A single real Claude assistant turn is split across several ADJACENT JSONL lines that share ONE `message.id` (separate thinking / text / tool_use content blocks) and repeat the SAME `usage` on every split line; the Claude message parser therefore MERGES those lines into one assistant `Message` (concatenate text, union tool names, model once, tokens counted once — last-wins on the repeated usage), and the Claude scan parse counts turns and emits records PER `message.id` (usage counted once, tool_use unioned across the split lines) rather than per line. Counting per line is a pre-existing token over-count in `claude.ts` (each split line repeats the full `usage`, so a 3-way-split turn is counted 3×); deduping records by `message.id` corrects it, which lowers Claude token/cost totals on the existing Overview — a deliberate, noted behavior change. Real Codex rollouts also emit synthetic `response_item` user payloads (`# AGENTS.md instructions for …`, `<environment_context>`, `<user_instructions>`, and developer-role `<permissions instructions>`) BEFORE the real `event_msg.user_message`; both Codex parsers filter these so injected context never surfaces as a user prompt. Sessions are addressed everywhere by a stable composite route key `` `${tool}:${sessionId}` `` so Claude and Codex share one namespace without collisions.

**Tech Stack:** TypeScript (ESM), Astro 5 SSR (`@astrojs/node` standalone), React 19 islands, Tailwind v4, Vitest 3.

## Global Constraints

- Local-only, read-only, no-upload personal tool.
- Claude + Codex only, no OpenCode.
- Notional API-rate cost labeling on every surface.
- Quota/forecast computed from UNFILTERED records.
- Canonical-pinned tests asserting against literals, not the SUT's own formula.
- New fixtures are real-derived and cover every real line-type variety (multi-session rollouts, split-`message.id` turns, injected/synthetic context, compaction markers), not single-record stubs. Structural fidelity, not raw line count, is the bar.
- A Codex rollout may hold multiple distinct session ids sharing ONE continuous cumulative-token counter; sessions are keyed by the composite `` `${tool}:${sessionId}` `` route key.
- A real Claude assistant turn spans several ADJACENT JSONL lines sharing one `message.id` (thinking/text/tool_use blocks) that REPEAT the same `usage`; the Claude message parser merges them into one `Message` and the Claude scan parse counts turns and emits records per `message.id` (usage once, tool_use unioned). This corrects a pre-existing per-line over-count in `claude.ts` and lowers Claude token/cost totals on the existing Overview — an intended, documented behavior change.
- Codex synthetic `response_item` context payloads (`# AGENTS.md instructions for …`, `<environment_context>`, `<user_instructions>`, `<permissions instructions>`) are filtered by both Codex parsers and never surface as user prompts in replay/search.
- New fixtures are DERIVED FROM REAL sanitized session files (real structural shape kept exact; private text/paths redacted to neutral placeholders), including a split-`message.id` Claude turn and a multi-`session_meta` Codex fork.
- Node/Astro SSR stack.

## File Structure

### Created

- `src/lib/sessions.ts` — group `UsageRecord[]` + per-session meta into `SessionSummary[]`.
- `src/lib/sessions.test.ts` — canonical-pinned grouping tests.
- `src/lib/parsers/claude-messages.ts` — on-demand full parse of one Claude file → `Message[]`; exported compaction-detection helpers.
- `src/lib/parsers/codex-messages.ts` — on-demand full parse of one Codex rollout → `Message[]`.
- `src/lib/parsers/claude-messages.test.ts` — Claude message parse (compaction full+micro, tool_use, full-text) tests.
- `src/lib/parsers/codex-messages.test.ts` — Codex message parse (user/assistant, tool_use, tokens) tests.
- `src/lib/parsers/__fixtures__/claude-messages.jsonl` — real-derived multi-turn Claude fixture (redacted): a split-`message.id` assistant turn across THREE adjacent lines (thinking / text / tool_use content blocks) that REPEAT the same `usage` on every line, single-line assistant turns, a user/assistant exchange, a tool_result-only user line, full + micro compaction, a long untruncated prompt, and a malformed line. Exercises the `message.id` merge/dedup.
- `src/lib/parsers/__fixtures__/claude-messages-2.jsonl` — small second Claude fixture that embeds the SAME session id (`m1`) as `claude-messages.jsonl`, with an interleaving timestamp and a later one, for the multi-file concatenation test (a session split across two real files, which real `scan()` indexes under one composite key `claude:m1`).
- `src/lib/parsers/__fixtures__/codex-messages.jsonl` — real-derived multi-turn Codex fixture (redacted, one session id `c9`): two session_meta lines (same id), a developer `<permissions instructions>` line, a SYNTHETIC `response_item` user payload combining `# AGENTS.md instructions for …` + `<environment_context>` blocks (must be filtered), a SYNTHETIC `<user_instructions>` payload (filtered), the real user turn as BOTH `event_msg.user_message` and a duplicated `response_item` user (deduped), reasoning, function_call + function_call_output, two token_count events (one no-progress duplicate), a response_item assistant, an agent_message duplicate of it, a response_item-only user turn, an agent_message fallback assistant, and a malformed line.
- `src/lib/parsers/__fixtures__/codex-multi-session.jsonl` — real-derived fork-shaped Codex rollout with TWO DISTINCT `session_meta` ids (a forked child carrying `forked_from_id` + a `.codex/worktrees` cwd, then its parent switches the active id mid-file), each with its own turns/function_call/model, sharing ONE continuous `total_token_usage` counter (the parent's cumulative 1600 follows the child's 1000, so its delta is 600 — proving the baseline never resets on session_meta), plus a synthetic `<environment_context>` line, a reasoning line, a no-progress token_count duplicate, and a malformed line.
- `src/pages/api/sessions/index.ts` — GET `SessionSummary[]`, honors tool/date filters.
- `src/pages/api/sessions/index.test.ts` — endpoint test.
- `src/pages/api/sessions/[id].ts` — GET `SessionDetail`, 404 on missing/corrupt.
- `src/pages/api/sessions/[id].test.ts` — endpoint test (200 + 404 paths).
- `src/pages/sessions/index.astro` — SSR sessions list page.
- `src/pages/sessions/[id].astro` — SSR session detail page (404 on missing).
- `src/components/FilterBar.tsx` — shared tool+date filter bar.
- `src/components/SessionsList.tsx` — sortable list island with compaction flag.
- `src/components/SessionDetail.tsx` — replay + sidebar island.

### Modified

- `src/lib/normalize.ts` — add `Message`, `SessionSummary`, `SessionDetail`, `SessionMeta` types, `truncate()` helper, optional `ParsedFile.sessions`.
- `src/lib/normalize.test.ts` — `truncate()` tests.
- `src/lib/parsers/claude.ts` — build per-session meta (turns, tool calls, compaction) in the parse pass AND dedupe records + turn counts by `message.id` (usage counted once — corrects the pre-existing per-line token over-count on split assistant turns).
- `src/lib/parsers/claude.test.ts` — assert per-session meta.
- `src/lib/parsers/codex.ts` — build per-session meta (turns, tool calls, models) per distinct session id in the parse pass, attributing every record and meta count to the active id while keeping one continuous cumulative-token baseline.
- `src/lib/parsers/codex.test.ts` — assert per-session meta.
- `src/lib/scan.ts` — aggregate `sessionMeta` map + `sessionIndex` map (both keyed by the composite `${tool}:${sessionId}` route key; a file can appear under several keys) into `ScanResult`.
- `src/lib/scan.test.ts` — assert index + no double-count across scans.
- `src/components/Dashboard.tsx` — consume the extracted `FilterBar`.
- `src/layouts/Layout.astro` — add Overview/Sessions top nav.

---

### Task 1: Session/message types + `truncate` helper

**Files:**

- Modify: `src/lib/normalize.ts` (add exports; make `ParsedFile.sessions` optional at the `ParsedFile` interface, currently lines 29-32).
- Test: `src/lib/normalize.test.ts` (extend, currently ends line 35).

**Interfaces:**

- Produces: `interface Message`, `interface SessionSummary`, `interface SessionDetail`, `interface SessionMeta`, `function truncate(text: string, max: number): string`, and `ParsedFile.sessions?: SessionMeta[]` consumed by Tasks 4-11.

Steps:

- [ ] Append this test block to `src/lib/normalize.test.ts` (add `truncate` to the import on line 3 first):

```ts
import {
  projectFromCwd,
  totalTokens,
  truncate,
  type UsageRecord,
} from "./normalize";
```

```ts
describe("truncate", () => {
  it("returns the text unchanged when within the limit", () => {
    expect(truncate("hello", 10)).toBe("hello");
    expect(truncate("hello", 5)).toBe("hello");
  });
  it("cuts to max and appends an ellipsis when over the limit", () => {
    expect(truncate("hello world", 5)).toBe("hello…");
  });
  it("handles empty text and a non-positive limit", () => {
    expect(truncate("", 5)).toBe("");
    expect(truncate("abc", 0)).toBe("");
  });
});
```

- [ ] Run it, expect FAIL: `npx vitest run src/lib/normalize.test.ts` → fails with `"truncate" is not exported by ... normalize.ts` (or `truncate is not a function`).

- [ ] Replace the whole of `src/lib/normalize.ts` with the block below. **This runs after Phase 1, so the block deliberately keeps Phase 1's `WindowForecast`/`VolumeForecast`/`Forecast`/`Tip` types (added by Phase 1 Tasks 1-2); they must stay in the file or `forecast.ts`, `tips.ts`, `aggregate.ts`, `QuotaPanel.tsx`, and `Tips.tsx` fail to compile:**

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

// Per-session structural meta computed during the cached scan parse (no extra
// file reads). Token totals live in UsageRecord; this carries counts that
// records do not: assistant turns, tool calls, models, span, and (Claude only)
// compaction counts.
export interface SessionMeta {
  sessionId: string;
  tool: Tool;
  turns: number;
  toolCalls: number;
  models: string[];
  startedAt: string;
  endedAt: string;
  compaction?: { full: number; micro: number; tokensSaved: number };
}

export interface ParsedFile {
  records: UsageRecord[];
  quota: RateLimitSnapshot | null;
  sessions?: SessionMeta[];
}

// Claude Code persists no rate-limit data, so its "limits" are shown as the
// volume of tokens used in rolling windows ending at `asOf`.
export interface ClaudeWindows {
  fiveHourTokens: number;
  sevenDayTokens: number;
  asOf: string; // ISO timestamp of the `now` the windows were computed against; "" when unknown
}

export interface SessionSummary {
  key: string; // stable composite route key `${tool}:${sessionId}`, unique across tools
  id: string; // raw session id, kept for display and raw-id lookups
  tool: Tool;
  project: string;
  models: string[];
  startedAt: string;
  endedAt: string;
  durationMs: number;
  turns: number;
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
}

export interface Message {
  index: number;
  role: "user" | "assistant";
  text: string; // full text in the payload; the UI truncates for display
  toolUses: string[]; // tool names
  model?: string;
  tokens?: number;
  timestamp: string;
  compaction?: "full" | "micro"; // Claude only
}

export interface SessionDetail {
  summary: SessionSummary;
  messages: Message[];
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

// Shortens text for display, appending an ellipsis when cut. Callers keep the
// full text in the API payload; only the UI shortens.
export function truncate(text: string, max: number): string {
  if (max <= 0) return "";
  if (text.length <= max) return text;
  return text.slice(0, max) + "…";
}

// --- Phase 1 types (forecast + tips) — preserved through this full-file
// replace so Phase 1's forecast.ts/tips.ts/aggregate.ts/QuotaPanel/Tips keep
// compiling. Do not drop. ---
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

export interface Tip {
  id: string;
  severity: "info" | "warn";
  title: string;
  detail: string;
  savingsUsd?: number; // notional, API-rate
}
```

- [ ] Run it, expect PASS: `npx vitest run src/lib/normalize.test.ts` → all green.
- [ ] Commit: `git add src/lib/normalize.ts src/lib/normalize.test.ts && git commit -m "feat(lib): add session and message types with text truncation helper"`

---

### Task 2: Claude message parser + compaction detection

**Files:**

- Create: `src/lib/parsers/claude-messages.ts`
- Create: `src/lib/parsers/__fixtures__/claude-messages.jsonl`
- Test: `src/lib/parsers/claude-messages.test.ts`

**Interfaces:**

- Consumes: `Message` from `../normalize`.
- Produces: `function parseClaudeMessages(path: string): Message[]`, `function detectClaudeCompaction(obj: any): "full" | "micro" | null`, `function claudeCompactionSaved(obj: any): number` (last two consumed by Task 4's `claude.ts`). `parseClaudeMessages` MERGES adjacent assistant lines that share one `message.id` into a single `Message`: it concatenates their text blocks, unions their tool_use names, keeps the model once, and counts tokens ONCE (last-wins on the repeated `usage`). A real assistant turn is written as separate thinking/text/tool_use lines that all repeat the same `usage`, so without this merge one turn would appear as several messages with multiplied tokens.

Steps:

- [ ] Create `src/lib/parsers/__fixtures__/claude-messages.jsonl` with exactly these 14 lines (real-derived, redacted; the FIRST assistant turn `msg_a1` is split across three ADJACENT lines — thinking, then text, then tool_use — that REPEAT the same `usage`, mirroring the real on-disk shape; followed by a plain user turn, a single-line text+tool_use assistant turn, a skipped tool_result-only user line, a single-line assistant turn, full compaction, a post-compaction turn, micro compaction, a long untruncated prompt, a final short user/assistant exchange, and a malformed line). Every line embeds `sessionId":"m1"`:

```
{"type":"assistant","timestamp":"2026-06-10T10:00:00.000Z","cwd":"/Users/me/ProjX","sessionId":"m1","requestId":"req_a1","uuid":"u1","message":{"id":"msg_a1","role":"assistant","model":"claude-opus-4-8","usage":{"input_tokens":100,"output_tokens":50,"cache_creation_input_tokens":200,"cache_read_input_tokens":300,"service_tier":"standard"},"content":[{"type":"thinking","thinking":"Considering the request."}]}}
{"type":"assistant","timestamp":"2026-06-10T10:00:00.000Z","cwd":"/Users/me/ProjX","sessionId":"m1","requestId":"req_a1","uuid":"u2","message":{"id":"msg_a1","role":"assistant","model":"claude-opus-4-8","usage":{"input_tokens":100,"output_tokens":50,"cache_creation_input_tokens":200,"cache_read_input_tokens":300,"service_tier":"standard"},"content":[{"type":"text","text":"Let me check."}]}}
{"type":"assistant","timestamp":"2026-06-10T10:00:00.000Z","cwd":"/Users/me/ProjX","sessionId":"m1","requestId":"req_a1","uuid":"u3","message":{"id":"msg_a1","role":"assistant","model":"claude-opus-4-8","usage":{"input_tokens":100,"output_tokens":50,"cache_creation_input_tokens":200,"cache_read_input_tokens":300,"service_tier":"standard"},"content":[{"type":"tool_use","id":"toolu_1","name":"Bash","input":{"command":"ls"}}]}}
{"type":"user","timestamp":"2026-06-10T10:01:00.000Z","cwd":"/Users/me/ProjX","sessionId":"m1","message":{"role":"user","content":"run the tests"}}
{"type":"assistant","timestamp":"2026-06-10T10:02:00.000Z","cwd":"/Users/me/ProjX","sessionId":"m1","message":{"id":"msg_a2","role":"assistant","model":"claude-opus-4-8","usage":{"input_tokens":20,"output_tokens":10,"cache_creation_input_tokens":0,"cache_read_input_tokens":0},"content":[{"type":"text","text":"Running now."},{"type":"tool_use","id":"toolu_2","name":"Bash","input":{"command":"npx vitest"}}]}}
{"type":"user","timestamp":"2026-06-10T10:03:00.000Z","cwd":"/Users/me/ProjX","sessionId":"m1","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"ok"}]}}
{"type":"assistant","timestamp":"2026-06-10T10:04:00.000Z","cwd":"/Users/me/ProjX","sessionId":"m1","message":{"id":"msg_a3","role":"assistant","model":"claude-opus-4-8","usage":{"input_tokens":15,"output_tokens":8,"cache_creation_input_tokens":0,"cache_read_input_tokens":0},"content":[{"type":"text","text":"All tests pass."}]}}
{"type":"system","subtype":"compact_boundary","timestamp":"2026-06-10T10:05:00.000Z","cwd":"/Users/me/ProjX","sessionId":"m1","content":"Conversation compacted.","compactMetadata":{"trigger":"auto","preTokens":800000,"postTokens":20000,"durationMs":1000,"preservedSegment":{"headUuid":"h","anchorUuid":"a","tailUuid":"t"},"preservedMessages":{"anchorUuid":"a","uuids":["h","t"],"allUuids":["h","t"]}}}
{"type":"assistant","timestamp":"2026-06-10T10:06:00.000Z","cwd":"/Users/me/ProjX","sessionId":"m1","message":{"id":"msg_a4","role":"assistant","model":"claude-opus-4-8","usage":{"input_tokens":30,"output_tokens":15,"cache_creation_input_tokens":0,"cache_read_input_tokens":0},"content":[{"type":"text","text":"Continuing after compaction."}]}}
{"type":"system","subtype":"microcompact","timestamp":"2026-06-10T10:07:00.000Z","cwd":"/Users/me/ProjX","sessionId":"m1","content":"","microcompactMetadata":{"trigger":"tool_use","preTokens":50000,"tokensSaved":5000,"compactedToolIds":["toolu_2"],"clearedAttachmentUUIDs":[]}}
{"type":"user","timestamp":"2026-06-10T10:08:00.000Z","cwd":"/Users/me/ProjX","sessionId":"m1","message":{"role":"user","content":"Please refactor the session parser so it groups records by session id and computes turns, tool calls, and compaction counts in a single cached pass over each file, keeping the hot aggregate path unchanged, and make sure the on demand message parser preserves the full untruncated text in the payload so search and detail both have complete content available. END_OF_LONG_PROMPT"}}
{"type":"user","timestamp":"2026-06-10T10:09:00.000Z","cwd":"/Users/me/ProjX","sessionId":"m1","message":{"role":"user","content":"thanks"}}
{"type":"assistant","timestamp":"2026-06-10T10:10:00.000Z","cwd":"/Users/me/ProjX","sessionId":"m1","message":{"id":"msg_a5","role":"assistant","model":"claude-opus-4-8","usage":{"input_tokens":5,"output_tokens":3,"cache_creation_input_tokens":0,"cache_read_input_tokens":0},"content":[{"type":"text","text":"You're welcome."}]}}
{ this line is not valid json
```

- [ ] Create `src/lib/parsers/claude-messages.test.ts`:

```ts
// src/lib/parsers/claude-messages.test.ts
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import {
  parseClaudeMessages,
  detectClaudeCompaction,
  claudeCompactionSaved,
} from "./claude-messages";

const fixture = fileURLToPath(
  new URL("./__fixtures__/claude-messages.jsonl", import.meta.url),
);

describe("parseClaudeMessages", () => {
  it("merges the split message.id turn (thinking/text/tool_use) into ONE assistant message with tokens counted once", () => {
    const messages = parseClaudeMessages(fixture);
    // The three msg_a1 lines collapse to a single message, not three; the ten
    // messages total prove there is no split-line inflation.
    expect(messages).toHaveLength(10);
    const a1 = messages[0];
    expect(a1.role).toBe("assistant");
    expect(a1.text).toBe("Let me check."); // text block from the middle split line
    expect(a1.toolUses).toEqual(["Bash"]); // tool_use block from the third split line
    expect(a1.model).toBe("claude-opus-4-8");
    expect(a1.tokens).toBe(650); // 100 + 50 + 200 + 300 counted ONCE, not ×3
    // Only ONE assistant message carries the Bash tool_use from msg_a1.
    expect(
      messages.filter(
        (m) => m.role === "assistant" && m.text === "Let me check.",
      ),
    ).toHaveLength(1);
  });

  it("emits user/assistant messages, extracts tool_use, and skips tool_result-only users", () => {
    const messages = parseClaudeMessages(fixture);
    expect(messages).toHaveLength(10);

    expect(messages[0]).toMatchObject({
      index: 0,
      role: "assistant",
      text: "Let me check.",
      toolUses: ["Bash"],
      model: "claude-opus-4-8",
      tokens: 650, // 100 + 50 + 200 + 300, counted once across the split lines
    });
    expect(messages[1]).toMatchObject({
      index: 1,
      role: "user",
      text: "run the tests",
      toolUses: [],
    });
    expect(messages[2]).toMatchObject({
      index: 2,
      role: "assistant",
      text: "Running now.",
      toolUses: ["Bash"],
      tokens: 30, // 20 + 10
    });
    expect(messages[3]).toMatchObject({
      index: 3,
      role: "assistant",
      text: "All tests pass.",
      toolUses: [],
      tokens: 23, // 15 + 8
    });
  });

  it("emits full and micro compaction markers inline in order", () => {
    const messages = parseClaudeMessages(fixture);
    expect(messages[4]).toMatchObject({
      index: 4,
      compaction: "full",
      text: "Conversation compacted.",
    });
    expect(messages[5]).toMatchObject({
      index: 5,
      text: "Continuing after compaction.",
    });
    expect(messages[6]).toMatchObject({ index: 6, compaction: "micro" });
  });

  it("keeps the full untruncated text in the payload", () => {
    const messages = parseClaudeMessages(fixture);
    const long = messages[7];
    expect(long.role).toBe("user");
    expect(long.text.endsWith("END_OF_LONG_PROMPT")).toBe(true);
    expect(long.text.length).toBeGreaterThan(300);
  });

  it("emits the final short user/assistant exchange", () => {
    const messages = parseClaudeMessages(fixture);
    expect(messages[8]).toMatchObject({
      index: 8,
      role: "user",
      text: "thanks",
    });
    expect(messages[9]).toMatchObject({
      index: 9,
      role: "assistant",
      text: "You're welcome.",
      tokens: 8, // 5 + 3
    });
  });
});

describe("detectClaudeCompaction / claudeCompactionSaved", () => {
  it("detects full compaction and derives saved tokens from pre/post", () => {
    const obj = { compactMetadata: { preTokens: 800000, postTokens: 20000 } };
    expect(detectClaudeCompaction(obj)).toBe("full");
    expect(claudeCompactionSaved(obj)).toBe(780000);
  });
  it("detects micro compaction and reads its explicit tokensSaved", () => {
    const obj = { microcompactMetadata: { tokensSaved: 5000 } };
    expect(detectClaudeCompaction(obj)).toBe("micro");
    expect(claudeCompactionSaved(obj)).toBe(5000);
  });
  it("returns null / 0 for a normal line", () => {
    expect(detectClaudeCompaction({ type: "assistant" })).toBeNull();
    expect(claudeCompactionSaved({ type: "assistant" })).toBe(0);
  });
});
```

- [ ] Run it, expect FAIL: `npx vitest run src/lib/parsers/claude-messages.test.ts` → fails with `Failed to load url ./claude-messages` (module does not exist).

- [ ] Create `src/lib/parsers/claude-messages.ts`:

```ts
// src/lib/parsers/claude-messages.ts
import { readFileSync } from "node:fs";
import type { Message } from "../normalize";

// Claude persists two compaction markers as top-level keys on their own JSONL
// line: `compactMetadata` (full) and `microcompactMetadata` (micro). Full lines
// carry preTokens/postTokens (saved = pre - post); micro lines carry an explicit
// tokensSaved. Shared by the cached scan pass (claude.ts) and this parser.
export function detectClaudeCompaction(obj: any): "full" | "micro" | null {
  if (obj?.microcompactMetadata) return "micro";
  if (obj?.compactMetadata) return "full";
  return null;
}

export function claudeCompactionSaved(obj: any): number {
  if (obj?.microcompactMetadata) {
    const s = obj.microcompactMetadata.tokensSaved;
    return typeof s === "number" && s > 0 ? s : 0;
  }
  if (obj?.compactMetadata) {
    const pre = obj.compactMetadata.preTokens;
    const post = obj.compactMetadata.postTokens;
    if (typeof pre === "number" && typeof post === "number" && pre > post) {
      return pre - post;
    }
  }
  return 0;
}

function extractUserText(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c) => c && c.type === "text" && typeof c.text === "string")
      .map((c) => c.text)
      .join("\n");
  }
  return "";
}

function extractAssistant(content: any): { text: string; toolUses: string[] } {
  const toolUses: string[] = [];
  let text = "";
  if (Array.isArray(content)) {
    for (const c of content) {
      if (!c || typeof c !== "object") continue;
      if (c.type === "text" && typeof c.text === "string") {
        text += (text ? "\n" : "") + c.text;
      } else if (c.type === "tool_use" && typeof c.name === "string") {
        toolUses.push(c.name);
      }
    }
  } else if (typeof content === "string") {
    text = content;
  }
  return { text, toolUses };
}

export function parseClaudeMessages(path: string): Message[] {
  const messages: Message[] = [];
  const lines = readFileSync(path, "utf8").split("\n");

  // A real assistant turn is written as several ADJACENT lines sharing one
  // `message.id` (separate thinking/text/tool_use content blocks) that repeat the
  // SAME `usage`. Merge those lines into ONE assistant message: append text, union
  // tool names, keep the model, and set tokens once (last-wins on the repeated
  // usage). `lastAssistantId`/`lastAssistantIdx` track the open merge run; a user
  // or compaction line ends it (an assistant with a new id also ends it).
  let lastAssistantId = "";
  let lastAssistantIdx = -1;
  const endRun = () => {
    lastAssistantId = "";
    lastAssistantIdx = -1;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: any;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }

    const kind = detectClaudeCompaction(obj);
    if (kind) {
      messages.push({
        index: messages.length,
        role: "assistant",
        text: typeof obj.content === "string" ? obj.content : "",
        toolUses: [],
        timestamp: String(obj.timestamp ?? ""),
        compaction: kind,
      });
      endRun();
      continue;
    }

    if (obj.type === "user" && obj.message?.role === "user") {
      const text = extractUserText(obj.message.content);
      if (text) {
        messages.push({
          index: messages.length,
          role: "user",
          text,
          toolUses: [],
          timestamp: String(obj.timestamp ?? ""),
        });
      }
      endRun();
      continue;
    }

    if (obj.type === "assistant" && obj.message) {
      const { text, toolUses } = extractAssistant(obj.message.content);
      const usage = obj.message.usage;
      const tokens = usage
        ? (usage.input_tokens ?? 0) +
          (usage.output_tokens ?? 0) +
          (usage.cache_creation_input_tokens ?? 0) +
          (usage.cache_read_input_tokens ?? 0)
        : undefined;
      const model = obj.message.model ? String(obj.message.model) : undefined;
      const msgId = obj.message.id ? String(obj.message.id) : "";

      // Merge into the open run when this line continues the same message.id.
      if (msgId && msgId === lastAssistantId && lastAssistantIdx >= 0) {
        const prev = messages[lastAssistantIdx];
        if (text) prev.text += (prev.text ? "\n" : "") + text;
        for (const t of toolUses) prev.toolUses.push(t);
        if (model) prev.model = model;
        if (tokens !== undefined) prev.tokens = tokens; // last-wins; identical here
        continue;
      }

      // A thinking-only first split line has no text/tool_use and is skipped; the
      // following text/tool_use line of the same message.id then opens the run.
      if (text || toolUses.length > 0) {
        messages.push({
          index: messages.length,
          role: "assistant",
          text,
          toolUses,
          model,
          tokens,
          timestamp: String(obj.timestamp ?? ""),
        });
        lastAssistantId = msgId;
        lastAssistantIdx = messages.length - 1;
      }
    }
  }

  return messages;
}
```

- [ ] Run it, expect PASS: `npx vitest run src/lib/parsers/claude-messages.test.ts` → all green.
- [ ] Commit: `git add src/lib/parsers/claude-messages.ts src/lib/parsers/claude-messages.test.ts src/lib/parsers/__fixtures__/claude-messages.jsonl && git commit -m "feat(lib): parse Claude session messages, merging split turns by message id"`

---

### Task 3: Codex message parser

**Files:**

- Create: `src/lib/parsers/codex-messages.ts`
- Create: `src/lib/parsers/__fixtures__/codex-messages.jsonl`
- Test: `src/lib/parsers/codex-messages.test.ts`

**Interfaces:**

- Consumes: `Message` from `../normalize`.
- Produces: `function parseCodexMessages(path: string, sessionId: string): Message[]` (consumed by Tasks 8, 11; the same fixtures are consumed by Task 4's codex meta tests), `function extractCodexText(content: any): string` (exported so Task 4's `codex.ts` detects user turns with the identical text extraction, keeping `SessionSummary.turns` consistent with the rendered detail), and `function isSyntheticCodexContext(text: string): boolean` (the single source of truth for the synthetic-context markers, consumed by Task 4's `codex.ts` so both parsers filter identically). A rollout can hold multiple distinct session ids; `parseCodexMessages` returns ONLY the messages belonging to `sessionId` by tracking the active id and emitting a message only while the active id equals the requested one. It also FILTERS synthetic `response_item` user payloads — the CLI injects `# AGENTS.md instructions for …`, `<environment_context>`, `<user_instructions>`, and developer-role `<permissions instructions>` blocks BEFORE the real `event_msg.user_message` — so injected context never surfaces as a user prompt in replay/search.

Steps:

- [ ] Create `src/lib/parsers/__fixtures__/codex-messages.jsonl` with exactly these 20 lines (real-derived rollout shape, redacted; one session id `c9`): a developer `<permissions instructions>` line (ignored by role), a SYNTHETIC `response_item` user payload combining `# AGENTS.md instructions for …` + `<environment_context>` blocks (must be filtered — the two blocks arrive in ONE `response_item` exactly as the CLI writes them), then the real user turn appearing as BOTH `event_msg.user_message` and a duplicated `response_item` user (deduped), reasoning, `function_call` + `function_call_output`, two `token_count` events (the second a no-progress duplicate whose `last_token_usage.total_tokens` is 0), a `response_item` assistant, an `agent_message` that duplicates that assistant (ignored because the assistant response_item exists), a second `session_meta` (same id), a SYNTHETIC `<user_instructions>` payload (filtered), a second turn whose user arrives ONLY as a `response_item` user, another `function_call` + `function_call_output`, an `agent_message` that IS the assistant fallback for that turn (no assistant response_item follows), and a malformed line:

```
{"timestamp":"2026-06-11T09:00:00.000Z","type":"session_meta","payload":{"id":"c9","cwd":"/Users/me/ProjX","cli_version":"0.137.0","source":"cli","git":{"branch":"main"}}}
{"timestamp":"2026-06-11T09:00:01.000Z","type":"turn_context","payload":{"cwd":"/Users/me/ProjX","model":"gpt-5.3-codex","reasoning_effort":"medium"}}
{"timestamp":"2026-06-11T09:00:02.000Z","type":"response_item","payload":{"type":"message","role":"developer","content":[{"type":"input_text","text":"<permissions instructions>\nFilesystem sandboxing defines which files can be read or written. sandbox_mode is read-only; approval_policy is never."}]}}
{"timestamp":"2026-06-11T09:00:03.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"# AGENTS.md instructions for /Users/me/ProjX\n\n<INSTRUCTIONS>\nProject guidance here.\n</INSTRUCTIONS>"},{"type":"input_text","text":"<environment_context>\n  <cwd>/Users/me/ProjX</cwd>\n  <shell>zsh</shell>\n</environment_context>"}]}}
{"timestamp":"2026-06-11T09:00:05.000Z","type":"event_msg","payload":{"type":"user_message","message":"Add a test for the parser.","images":[]}}
{"timestamp":"2026-06-11T09:00:06.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Add a test for the parser."}]}}
{"timestamp":"2026-06-11T09:00:07.000Z","type":"response_item","payload":{"type":"reasoning","summary":[{"type":"summary_text","text":"Planning the test."}]}}
{"timestamp":"2026-06-11T09:00:08.000Z","type":"response_item","payload":{"type":"function_call","name":"shell","arguments":"{\"command\":[\"ls\"]}","call_id":"call_1"}}
{"timestamp":"2026-06-11T09:00:09.000Z","type":"response_item","payload":{"type":"function_call_output","call_id":"call_1","output":"file.ts"}}
{"timestamp":"2026-06-11T09:00:10.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1000,"cached_input_tokens":200,"output_tokens":34,"reasoning_output_tokens":0,"total_tokens":1234},"last_token_usage":{"input_tokens":1000,"cached_input_tokens":200,"output_tokens":34,"reasoning_output_tokens":0,"total_tokens":1234}},"rate_limits":{"primary":{"used_percent":11,"window_minutes":300,"resets_at":1},"secondary":{"used_percent":2,"window_minutes":10080,"resets_at":2}}}}
{"timestamp":"2026-06-11T09:00:12.000Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Added the test."}]}}
{"timestamp":"2026-06-11T09:00:13.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1000,"cached_input_tokens":200,"output_tokens":34,"reasoning_output_tokens":0,"total_tokens":1234},"last_token_usage":{"input_tokens":0,"cached_input_tokens":0,"output_tokens":0,"reasoning_output_tokens":0,"total_tokens":0}}}}
{"timestamp":"2026-06-11T09:00:14.000Z","type":"event_msg","payload":{"type":"agent_message","message":"Added the test."}}
{"timestamp":"2026-06-11T09:00:16.000Z","type":"session_meta","payload":{"id":"c9","cwd":"/Users/me/ProjX"}}
{"timestamp":"2026-06-11T09:00:17.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"<user_instructions>\nBe concise.\n</user_instructions>"}]}}
{"timestamp":"2026-06-11T09:00:20.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Now run it."}]}}
{"timestamp":"2026-06-11T09:00:21.000Z","type":"response_item","payload":{"type":"function_call","name":"shell","arguments":"{\"command\":[\"npx\",\"vitest\"]}","call_id":"call_2"}}
{"timestamp":"2026-06-11T09:00:22.000Z","type":"response_item","payload":{"type":"function_call_output","call_id":"call_2","output":"ok"}}
{"timestamp":"2026-06-11T09:00:25.000Z","type":"event_msg","payload":{"type":"agent_message","message":"Tests pass."}}
{ this line is not valid json
```

- [ ] Create `src/lib/parsers/__fixtures__/codex-multi-session.jsonl` with exactly these 18 lines (a real fork shape, redacted: session A opens the file with `forked_from_id` pointing at its parent and a `.codex/worktrees` cwd; a new `session_meta` for the parent id B then switches the ACTIVE session mid-file; both sessions carry their own turn/function_call/model; the cumulative `total_token_usage` counter is ONE continuous series across the switch — B's cumulative 1600 follows A's 1000, so B's delta is 600, proving the baseline is never reset on session_meta; session A closes its turn with a `response_item` assistant, session B closes its turn with an `agent_message` fallback. A also carries a SYNTHETIC `<environment_context>` payload (filtered even in the pre-switch session), a reasoning line (ignored), and a no-progress `token_count` duplicate whose `last_token_usage.total_tokens` is 0 — which is why the token attach guards on `total_tokens > 0` so the duplicate does not clobber A's assistant token count; and a malformed line):

```
{"timestamp":"2026-06-11T09:00:00.000Z","type":"session_meta","payload":{"id":"019e39b9-0000-7000-a000-0000000000a1","forked_from_id":"019e2f27-0000-7000-a000-0000000000b2","cwd":"/Users/me/.codex/worktrees/ProjX","cli_version":"0.137.0","source":"fork"}}
{"timestamp":"2026-06-11T09:00:01.000Z","type":"turn_context","payload":{"cwd":"/Users/me/.codex/worktrees/ProjX","model":"gpt-5.5","reasoning_effort":"high"}}
{"timestamp":"2026-06-11T09:00:01.500Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"<environment_context>\n  <cwd>/Users/me/.codex/worktrees/ProjX</cwd>\n</environment_context>"}]}}
{"timestamp":"2026-06-11T09:00:02.000Z","type":"event_msg","payload":{"type":"user_message","message":"Fix the failing test.","images":[]}}
{"timestamp":"2026-06-11T09:00:02.500Z","type":"response_item","payload":{"type":"reasoning","summary":[{"type":"summary_text","text":"Inspecting the failure."}]}}
{"timestamp":"2026-06-11T09:00:03.000Z","type":"response_item","payload":{"type":"function_call","name":"shell","arguments":"{\"command\":[\"npx\",\"vitest\"]}","call_id":"call_a1"}}
{"timestamp":"2026-06-11T09:00:04.000Z","type":"response_item","payload":{"type":"function_call_output","call_id":"call_a1","output":"1 failing"}}
{"timestamp":"2026-06-11T09:00:05.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":900,"cached_input_tokens":100,"output_tokens":100,"reasoning_output_tokens":0,"total_tokens":1000},"last_token_usage":{"input_tokens":900,"cached_input_tokens":100,"output_tokens":100,"reasoning_output_tokens":0,"total_tokens":1000}},"rate_limits":{"primary":{"used_percent":20,"window_minutes":300,"resets_at":1},"secondary":{"used_percent":5,"window_minutes":10080,"resets_at":2}}}}
{"timestamp":"2026-06-11T09:00:05.500Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":900,"cached_input_tokens":100,"output_tokens":100,"reasoning_output_tokens":0,"total_tokens":1000},"last_token_usage":{"input_tokens":0,"cached_input_tokens":0,"output_tokens":0,"reasoning_output_tokens":0,"total_tokens":0}}}}
{"timestamp":"2026-06-11T09:00:06.000Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Fixed the test."}]}}
{"timestamp":"2026-06-11T09:00:10.000Z","type":"session_meta","payload":{"id":"019e2f27-0000-7000-a000-0000000000b2","cwd":"/Users/me/ProjX","cli_version":"0.137.0","source":"cli"}}
{"timestamp":"2026-06-11T09:00:11.000Z","type":"turn_context","payload":{"cwd":"/Users/me/ProjX","model":"gpt-5.3-codex","reasoning_effort":"medium"}}
{"timestamp":"2026-06-11T09:00:12.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Now add docs."}]}}
{"timestamp":"2026-06-11T09:00:13.000Z","type":"response_item","payload":{"type":"function_call","name":"shell","arguments":"{\"command\":[\"ls\",\"docs\"]}","call_id":"call_b2"}}
{"timestamp":"2026-06-11T09:00:14.000Z","type":"response_item","payload":{"type":"function_call_output","call_id":"call_b2","output":"README.md"}}
{"timestamp":"2026-06-11T09:00:15.000Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":1500,"cached_input_tokens":400,"output_tokens":100,"reasoning_output_tokens":0,"total_tokens":1600},"last_token_usage":{"input_tokens":500,"cached_input_tokens":300,"output_tokens":0,"reasoning_output_tokens":0,"total_tokens":600}}}}
{"timestamp":"2026-06-11T09:00:16.000Z","type":"event_msg","payload":{"type":"agent_message","message":"Docs added."}}
{ this line is not valid json
```

- [ ] Create `src/lib/parsers/codex-messages.test.ts`:

```ts
// src/lib/parsers/codex-messages.test.ts
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { parseCodexMessages, isSyntheticCodexContext } from "./codex-messages";

const fixture = fileURLToPath(
  new URL("./__fixtures__/codex-messages.jsonl", import.meta.url),
);
const multiFixture = fileURLToPath(
  new URL("./__fixtures__/codex-multi-session.jsonl", import.meta.url),
);
const ID_A = "019e39b9-0000-7000-a000-0000000000a1";
const ID_B = "019e2f27-0000-7000-a000-0000000000b2";

describe("parseCodexMessages", () => {
  it("emits user/assistant messages, dedups response_item users, and falls back to agent_message", () => {
    const messages = parseCodexMessages(fixture, "c9");
    expect(messages).toHaveLength(4);

    expect(messages[0]).toMatchObject({
      index: 0,
      role: "user",
      text: "Add a test for the parser.",
      toolUses: [],
    });
    expect(messages[1]).toMatchObject({
      index: 1,
      role: "assistant",
      text: "Added the test.",
      toolUses: ["shell"],
      model: "gpt-5.3-codex",
      tokens: 1234, // last_token_usage.total_tokens
    });
    // Turn 2 user arrives ONLY as a response_item user (no event_msg.user_message).
    expect(messages[2]).toMatchObject({
      index: 2,
      role: "user",
      text: "Now run it.",
    });
    // Turn 2 assistant comes from event_msg.agent_message (no assistant response_item).
    expect(messages[3]).toMatchObject({
      index: 3,
      role: "assistant",
      text: "Tests pass.",
      toolUses: ["shell"],
      model: "gpt-5.3-codex",
    });
    // No token_count in the second turn, so tokens is undefined there.
    expect(messages[3].tokens).toBeUndefined();

    // Dedup: the duplicated response_item user and the developer line are NOT
    // emitted, so there are exactly two user messages (one per real turn).
    expect(messages.filter((m) => m.role === "user")).toHaveLength(2);
    // The turn-1 agent_message duplicates the assistant response_item, so it is
    // NOT double-emitted: exactly two assistant messages overall.
    expect(messages.filter((m) => m.role === "assistant")).toHaveLength(2);
  });

  it("filters synthetic response_item context and never surfaces it as a user prompt", () => {
    const messages = parseCodexMessages(fixture, "c9");
    const allText = messages.map((m) => m.text).join("\n");
    // The AGENTS.md + environment_context payload, the user_instructions payload,
    // and the developer permissions block are all injected context, not prompts.
    expect(allText).not.toContain("AGENTS.md");
    expect(allText).not.toContain("<environment_context>");
    expect(allText).not.toContain("<user_instructions>");
    expect(allText).not.toContain("<permissions instructions>");
    // The REAL user prompts still come through intact.
    expect(
      messages.some(
        (m) => m.role === "user" && m.text === "Add a test for the parser.",
      ),
    ).toBe(true);
    expect(
      messages.some((m) => m.role === "user" && m.text === "Now run it."),
    ).toBe(true);
  });

  it("recognises the synthetic context markers, and passes real prompts through", () => {
    expect(
      isSyntheticCodexContext("# AGENTS.md instructions for /Users/me/ProjX"),
    ).toBe(true);
    expect(
      isSyntheticCodexContext(
        "<environment_context>\n  <cwd>/x</cwd>\n</environment_context>",
      ),
    ).toBe(true);
    expect(
      isSyntheticCodexContext(
        "<user_instructions>\nBe concise.\n</user_instructions>",
      ),
    ).toBe(true);
    expect(isSyntheticCodexContext("<permissions instructions>\n...")).toBe(
      true,
    );
    expect(isSyntheticCodexContext("Add a test for the parser.")).toBe(false);
    expect(isSyntheticCodexContext("Now run it.")).toBe(false);
  });
});

describe("parseCodexMessages across a multi-session rollout", () => {
  it("returns only session A's turns", () => {
    const a = parseCodexMessages(multiFixture, ID_A);
    expect(a).toHaveLength(2);
    expect(a[0]).toMatchObject({
      index: 0,
      role: "user",
      text: "Fix the failing test.",
    });
    expect(a[1]).toMatchObject({
      index: 1,
      role: "assistant",
      text: "Fixed the test.",
      toolUses: ["shell"],
      model: "gpt-5.5",
      tokens: 1000, // session A's last_token_usage.total_tokens
    });
  });

  it("returns only session B's turns, with the agent_message fallback assistant", () => {
    const b = parseCodexMessages(multiFixture, ID_B);
    expect(b).toHaveLength(2);
    expect(b[0]).toMatchObject({
      index: 0,
      role: "user",
      text: "Now add docs.", // arrives only as a response_item user in session B
    });
    expect(b[1]).toMatchObject({
      index: 1,
      role: "assistant",
      text: "Docs added.", // agent_message fallback (no assistant response_item)
      toolUses: ["shell"],
      model: "gpt-5.3-codex",
      tokens: 600, // session B's last_token_usage.total_tokens
    });
  });

  it("never leaks a message from one session into the other", () => {
    const a = parseCodexMessages(multiFixture, ID_A);
    const b = parseCodexMessages(multiFixture, ID_B);
    expect(
      a.some((m) => m.text === "Now add docs." || m.text === "Docs added."),
    ).toBe(false);
    expect(
      b.some(
        (m) =>
          m.text === "Fix the failing test." || m.text === "Fixed the test.",
      ),
    ).toBe(false);
  });
});
```

- [ ] Run it, expect FAIL: `npx vitest run src/lib/parsers/codex-messages.test.ts` → fails with `Failed to load url ./codex-messages` (module does not exist).

- [ ] Create `src/lib/parsers/codex-messages.ts`:

```ts
// src/lib/parsers/codex-messages.ts
import { readFileSync } from "node:fs";
import type { Message } from "../normalize";

// Extracts text from a Codex message payload. Assistant messages use
// `output_text`; user/developer messages use `input_text`. Exported so
// `codex.ts` detects user turns with the identical extraction.
export function extractCodexText(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter(
        (c) =>
          c &&
          (c.type === "output_text" ||
            c.type === "input_text" ||
            c.type === "text") &&
          typeof c.text === "string",
      )
      .map((c) => c.text)
      .join("\n");
  }
  return "";
}

// The CLI injects synthetic `response_item` user payloads BEFORE the real
// `event_msg.user_message`: an AGENTS.md/user-instructions block, an
// `<environment_context>` block, and a developer-role `<permissions instructions>`
// block. These are context, not prompts, and must never surface in replay/search.
// Single source of truth for the markers — `codex.ts` imports and reuses this so
// both parsers filter identically.
const SYNTHETIC_CODEX_CONTEXT_MARKERS = [
  "# AGENTS.md instructions for",
  "<environment_context>",
  "<user_instructions>",
  "<permissions instructions>",
];

export function isSyntheticCodexContext(text: string): boolean {
  const t = text.trimStart();
  return SYNTHETIC_CODEX_CONTEXT_MARKERS.some((m) => t.startsWith(m));
}

// A single Codex rollout can hold MULTIPLE distinct session ids (e.g. a fork that
// replays a parent session's history). `parseCodexMessages` returns ONLY the
// messages belonging to `sessionId`: it tracks the active session id (the id of
// the most recent session_meta) and emits a message only while the active id
// equals the requested one.
//
// Within the requested session a turn opens on a user message and closes on an
// assistant message.
// - Users arrive as an `event_msg` user_message OR as a `response_item` message
//   with role "user" (the two mirror each other within a turn, so the
//   response_item copy is deduped against the last user text). `role:"developer"`
//   messages and synthetic context payloads (AGENTS.md / environment_context /
//   user_instructions / permissions injection) are ignored via
//   `isSyntheticCodexContext`.
// - Assistants arrive as a `response_item` message with role "assistant"; when a
//   turn carries only an `event_msg.agent_message` and no assistant response_item,
//   that agent_message is emitted as the fallback (flushed at the next user turn,
//   at a session switch, or at end of file). Function calls and the turn's
//   token_count are attached to whichever assistant closes the turn. Text stays
//   full for the payload.
export function parseCodexMessages(path: string, sessionId: string): Message[] {
  const messages: Message[] = [];
  const lines = readFileSync(path, "utf8").split("\n");

  let activeId = "";
  let currentModel = "unknown";
  let pendingTools: string[] = [];
  let turnTokens: number | undefined;
  let lastUserText = "";
  let sawAssistant = false;
  let pendingAgent: { text: string; timestamp: string } | null = null;

  // Push only messages belonging to the requested session; index stays dense
  // (0..n) over the emitted messages.
  const emit = (m: Omit<Message, "index">) => {
    if (activeId !== sessionId) return;
    messages.push({ ...m, index: messages.length });
  };

  const flushAgent = () => {
    if (pendingAgent && !sawAssistant) {
      emit({
        role: "assistant",
        text: pendingAgent.text,
        toolUses: pendingTools,
        model: currentModel,
        tokens: turnTokens,
        timestamp: pendingAgent.timestamp,
      });
      pendingTools = [];
      turnTokens = undefined;
    }
    pendingAgent = null;
  };

  const resetTurnState = () => {
    pendingTools = [];
    turnTokens = undefined;
    lastUserText = "";
    sawAssistant = false;
    pendingAgent = null;
  };

  const openUserTurn = (text: string, timestamp: string) => {
    flushAgent();
    emit({ role: "user", text, toolUses: [], timestamp });
    lastUserText = text;
    sawAssistant = false;
    pendingTools = [];
    turnTokens = undefined;
    pendingAgent = null;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: any;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const p = obj.payload ?? {};

    if (obj.type === "session_meta") {
      const newId = p.id ? String(p.id) : "";
      if (newId && newId !== activeId) {
        flushAgent(); // close the old session's dangling agent turn (emits only
        // if the old active session is the requested one)
        activeId = newId;
        resetTurnState(); // the new session starts a fresh turn stream
      }
      continue;
    }

    if (obj.type === "turn_context") {
      if (p.model) currentModel = String(p.model);
      continue;
    }

    if (obj.type === "event_msg" && p.type === "user_message") {
      openUserTurn(
        typeof p.message === "string" ? p.message : "",
        String(obj.timestamp ?? ""),
      );
      continue;
    }

    if (obj.type === "event_msg" && p.type === "token_count") {
      const last = p.info?.last_token_usage;
      // Guard on > 0: a no-progress duplicate token_count carries
      // last_token_usage.total_tokens === 0 and must NOT clobber the real turn
      // tokens already captured for the assistant that is about to close.
      if (
        last &&
        typeof last.total_tokens === "number" &&
        last.total_tokens > 0
      ) {
        turnTokens = last.total_tokens;
      }
      continue;
    }

    if (obj.type === "event_msg" && p.type === "agent_message") {
      pendingAgent = {
        text: typeof p.message === "string" ? p.message : "",
        timestamp: String(obj.timestamp ?? ""),
      };
      continue;
    }

    if (obj.type === "response_item" && p.type === "function_call") {
      if (typeof p.name === "string") pendingTools.push(p.name);
      continue;
    }

    if (obj.type === "response_item" && p.type === "message") {
      if (p.role === "user") {
        const text = extractCodexText(p.content);
        // Skip synthetic context injection (AGENTS.md / environment_context /
        // user_instructions / permissions), and dedup the response_item copy of
        // the current turn's user text.
        if (text && !isSyntheticCodexContext(text) && text !== lastUserText) {
          openUserTurn(text, String(obj.timestamp ?? ""));
        }
        continue;
      }
      if (p.role === "assistant") {
        emit({
          role: "assistant",
          text: extractCodexText(p.content),
          toolUses: pendingTools,
          model: currentModel,
          tokens: turnTokens,
          timestamp: String(obj.timestamp ?? ""),
        });
        sawAssistant = true;
        pendingAgent = null; // an assistant response_item supersedes any agent_message
        pendingTools = [];
        turnTokens = undefined;
      }
      continue; // ignore role "developer" and any other roles
    }
  }

  flushAgent();
  return messages;
}
```

- [ ] Run it, expect PASS: `npx vitest run src/lib/parsers/codex-messages.test.ts` → all green.
- [ ] Commit: `git add src/lib/parsers/codex-messages.ts src/lib/parsers/codex-messages.test.ts src/lib/parsers/__fixtures__/codex-messages.jsonl src/lib/parsers/__fixtures__/codex-multi-session.jsonl && git commit -m "feat(lib): parse Codex session messages per session id, filtering injected context"`

---

### Task 4: Per-session meta in the cached scan parse (both parsers)

**Files:**

- Modify: `src/lib/parsers/claude.ts` (full rewrite; currently 41 lines).
- Modify: `src/lib/parsers/codex.ts` (full rewrite; currently 135 lines).
- Test: `src/lib/parsers/claude.test.ts` (extend; currently ends line 37), `src/lib/parsers/codex.test.ts` (extend; currently ends line 109).

**Interfaces:**

- Consumes: `detectClaudeCompaction`, `claudeCompactionSaved` from `./claude-messages` (Task 2); `extractCodexText`, `isSyntheticCodexContext` from `./codex-messages` (Task 3); `SessionMeta`, `ParsedFile` from `../normalize` (Task 1).
- Produces: `ParsedFile.sessions: SessionMeta[]` from both `parseClaudeFile` and `parseCodexFile` (consumed by Task 5's `scan.ts`). **`parseClaudeFile` now dedupes records AND turn counts by `message.id`.** A real assistant turn is split across several adjacent lines that share one `message.id` and REPEAT the same `usage`; the previous per-line emission produced one record per split line, multiplying that turn's tokens (a 3-way-split turn counted 3×). The new pass emits ONE record per `message.id` (usage counted once, last-wins on the repeated values; `tool_use` blocks are disjoint across the split lines so `toolCalls` still sums correctly) and increments `turns` once per distinct `message.id`. Lines without a `message.id` fall back to one record per line. **Behavior change (intended, documented): Claude token/cost totals on the existing Overview drop to the true per-turn values** (the over-count is removed); the Codex cumulative-delta invariant and quota behavior are unchanged. Codex assistant-turn detection mirrors `parseCodexMessages` (counts the `response_item` assistant, or the `agent_message` fallback when a turn has none) and filters synthetic context via `isSyntheticCodexContext`, so `turns` matches the rendered detail. `parseCodexFile` handles a rollout with MULTIPLE distinct `session_meta` ids: it tracks the active id, attributes every record (`UsageRecord.sessionId = activeId`) and every meta count to it, and emits ONE `SessionMeta` per distinct id — while keeping ONE continuous cumulative-token baseline for the whole file (only ATTRIBUTION switches on a new `session_meta`, never the token counter; the existing `cur.total < prev.total` branch is still the only reset).

Steps:

- [ ] Append to `src/lib/parsers/claude.test.ts` (ensure `import { fileURLToPath } from "node:url";` exists exactly once at the top — add it only if missing):

```ts
const compactionFixture = fileURLToPath(
  new URL("./__fixtures__/claude-messages.jsonl", import.meta.url),
);

describe("parseClaudeFile session meta", () => {
  it("counts turns, tool calls, and compaction during the parse pass", () => {
    const { records, sessions } = parseClaudeFile(compactionFixture);
    // Five DISTINCT message.ids carry usage (msg_a1..msg_a5); the three msg_a1
    // split lines collapse to ONE record, so five records total — NOT seven.
    expect(records).toHaveLength(5);
    expect(sessions).toHaveLength(1);
    expect(sessions![0]).toMatchObject({
      sessionId: "m1",
      tool: "claude",
      turns: 5, // one per distinct message.id, not one per split line
      toolCalls: 2, // Bash in msg_a1 (its tool_use line) + Bash in msg_a2
      models: ["claude-opus-4-8"],
      startedAt: "2026-06-10T10:00:00.000Z",
      endedAt: "2026-06-10T10:10:00.000Z",
      compaction: { full: 1, micro: 1, tokensSaved: 785000 }, // 780000 + 5000
    });
  });

  it("dedupes records by message.id so the repeated split-line usage is counted once", () => {
    const { records } = parseClaudeFile(compactionFixture);
    // The msg_a1 turn is written as three lines that each repeat usage
    // {100,50,200,300}. It must appear as exactly ONE record, not three.
    const a1 = records.filter(
      (r) => r.inputTokens === 100 && r.cacheWriteTokens === 200,
    );
    expect(a1).toHaveLength(1);
    expect(a1[0]).toMatchObject({
      sessionId: "m1",
      model: "claude-opus-4-8",
      inputTokens: 100,
      outputTokens: 50,
      cacheWriteTokens: 200,
      cacheReadTokens: 300,
    });
    // Canonical anchor: summed input across the deduped records is 170
    // (100 + 20 + 15 + 30 + 5). The un-deduped per-line parser would sum 370
    // (100 counted three times), which is the pre-existing over-count.
    expect(records.reduce((acc, r) => acc + r.inputTokens, 0)).toBe(170);
  });
});
```

- [ ] Run it, expect FAIL: `npx vitest run src/lib/parsers/claude.test.ts` → fails on both new tests: `sessions` is `undefined`, AND the un-deduped parser emits 7 records (the split msg_a1 turn counted three times) with a summed input of 370 instead of 5 records / 170.

- [ ] Replace the whole of `src/lib/parsers/claude.ts` with:

```ts
// src/lib/parsers/claude.ts
import { readFileSync } from "node:fs";
import {
  projectFromCwd,
  type ParsedFile,
  type SessionMeta,
  type UsageRecord,
} from "../normalize";
import {
  detectClaudeCompaction,
  claudeCompactionSaved,
} from "./claude-messages";

export function parseClaudeFile(path: string): ParsedFile {
  const records: UsageRecord[] = [];
  const sessions = new Map<string, SessionMeta>();
  const lines = readFileSync(path, "utf8").split("\n");

  // A real assistant turn is split across several adjacent lines that share one
  // `message.id` and REPEAT the same `usage`. Emit ONE record per `message.id`
  // (usage last-wins, identical in practice) and count ONE turn per `message.id`,
  // instead of one per line. `recordByMsgId` maps a message.id to its records
  // index; `seenMsgIds` gates the per-turn count. Lines without a message.id fall
  // back to one record / one turn per line.
  const recordByMsgId = new Map<string, number>();
  const seenMsgIds = new Set<string>();

  function metaFor(id: string): SessionMeta {
    let m = sessions.get(id);
    if (!m) {
      m = {
        sessionId: id,
        tool: "claude",
        turns: 0,
        toolCalls: 0,
        models: [],
        startedAt: "",
        endedAt: "",
        compaction: { full: 0, micro: 0, tokensSaved: 0 },
      };
      sessions.set(id, m);
    }
    return m;
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: any;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue; // skip malformed lines
    }

    const id = String(obj.sessionId ?? "");
    if (id) {
      const m = metaFor(id);
      const ts = String(obj.timestamp ?? "");
      if (ts) {
        if (!m.startedAt || ts < m.startedAt) m.startedAt = ts;
        if (ts > m.endedAt) m.endedAt = ts;
      }
      const kind = detectClaudeCompaction(obj);
      if (kind && m.compaction) {
        m.compaction[kind] += 1;
        m.compaction.tokensSaved += claudeCompactionSaved(obj);
      }
    }

    const message = obj?.message;
    const usage = message?.usage;
    if (!usage || obj?.type !== "assistant") continue;

    const model = String(message.model ?? "unknown");
    const msgId = message.id ? String(message.id) : "";
    // First sighting of a message.id (or any line without one) opens a turn/record.
    const isNewTurn = !msgId || !seenMsgIds.has(msgId);

    // Count tool_use blocks on THIS line; they are disjoint across the split
    // lines of one message.id, so summing over all lines is the real tool total.
    let toolUsesOnLine = 0;
    if (Array.isArray(message.content)) {
      for (const c of message.content) {
        if (c && c.type === "tool_use") toolUsesOnLine += 1;
      }
    }

    if (id) {
      const m = metaFor(id);
      m.toolCalls += toolUsesOnLine;
      if (!m.models.includes(model)) m.models.push(model);
      if (isNewTurn) m.turns += 1;
    }

    if (msgId && !isNewTurn) {
      // A continuation line of an already-recorded turn: usage is repeated, so
      // overwrite the existing record (last-wins) rather than adding a new one.
      const idx = recordByMsgId.get(msgId)!;
      const rec = records[idx];
      rec.inputTokens = usage.input_tokens ?? 0;
      rec.outputTokens = usage.output_tokens ?? 0;
      rec.cacheWriteTokens = usage.cache_creation_input_tokens ?? 0;
      rec.cacheReadTokens = usage.cache_read_input_tokens ?? 0;
      rec.model = model;
      continue;
    }

    if (msgId) seenMsgIds.add(msgId);
    records.push({
      tool: "claude",
      timestamp: String(obj.timestamp ?? ""),
      model,
      project: projectFromCwd(obj.cwd),
      sessionId: id,
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      reasoningTokens: 0,
    });
    if (msgId) recordByMsgId.set(msgId, records.length - 1);
  }

  return { records, quota: null, sessions: [...sessions.values()] };
}
```

- [ ] Run it, expect PASS: `npx vitest run src/lib/parsers/claude.test.ts` → all green (existing record tests unchanged).

- [ ] Append to `src/lib/parsers/codex.test.ts` (ensure `import { fileURLToPath } from "node:url";` exists exactly once at the top — add it only if missing):

```ts
const codexMessages = fileURLToPath(
  new URL("./__fixtures__/codex-messages.jsonl", import.meta.url),
);
const codexMulti = fileURLToPath(
  new URL("./__fixtures__/codex-multi-session.jsonl", import.meta.url),
);

describe("parseCodexFile session meta", () => {
  it("counts assistant turns, function calls, and models during the parse pass", () => {
    const { records, sessions } = parseCodexFile(codexMessages);
    expect(records).toHaveLength(1); // one token_count with forward progress
    expect(sessions).toHaveLength(1);
    expect(sessions![0]).toMatchObject({
      sessionId: "c9",
      tool: "codex",
      turns: 2, // one response_item assistant + one agent_message fallback turn
      toolCalls: 2, // two function_call items
      models: ["gpt-5.3-codex"],
      startedAt: "2026-06-11T09:00:00.000Z",
      endedAt: "2026-06-11T09:00:25.000Z",
    });
    expect(sessions![0].compaction).toBeUndefined();
  });
});

describe("parseCodexFile across a multi-session rollout", () => {
  it("emits one SessionMeta per distinct id with per-id counts, sharing one continuous token counter", () => {
    const { records, sessions } = parseCodexFile(codexMulti);
    expect(sessions).toHaveLength(2);

    const a = sessions!.find(
      (s) => s.sessionId === "019e39b9-0000-7000-a000-0000000000a1",
    )!;
    const b = sessions!.find(
      (s) => s.sessionId === "019e2f27-0000-7000-a000-0000000000b2",
    )!;
    expect(a).toMatchObject({
      tool: "codex",
      turns: 1, // one response_item assistant
      toolCalls: 1, // one function_call
      models: ["gpt-5.5"],
      startedAt: "2026-06-11T09:00:00.000Z",
      endedAt: "2026-06-11T09:00:06.000Z",
    });
    expect(b).toMatchObject({
      tool: "codex",
      turns: 1, // one agent_message fallback turn
      toolCalls: 1, // one function_call
      models: ["gpt-5.3-codex"],
      startedAt: "2026-06-11T09:00:10.000Z",
      endedAt: "2026-06-11T09:00:16.000Z",
    });

    // One record per token_count with forward progress, attributed to the active
    // id at that point.
    expect(records).toHaveLength(2);
    const ra = records.find(
      (r) => r.sessionId === "019e39b9-0000-7000-a000-0000000000a1",
    )!;
    const rb = records.find(
      (r) => r.sessionId === "019e2f27-0000-7000-a000-0000000000b2",
    )!;
    // Session A cumulative 1000 (delta from 0): input 900 - cached 100 = 800,
    // cacheRead 100, output 100.
    expect(ra).toMatchObject({
      model: "gpt-5.5",
      inputTokens: 800,
      outputTokens: 100,
      cacheWriteTokens: 0,
      cacheReadTokens: 100,
      reasoningTokens: 0,
    });
    // Session B cumulative 1600 (delta 600, NOT 1600 — the baseline is never
    // reset on session_meta): input 600 - cached 300 = 300, cacheRead 300,
    // output 0. A reset would have produced inputTokens 1100.
    expect(rb).toMatchObject({
      model: "gpt-5.3-codex",
      inputTokens: 300,
      outputTokens: 0,
      cacheWriteTokens: 0,
      cacheReadTokens: 300,
      reasoningTokens: 0,
    });
  });
});
```

- [ ] Run it, expect FAIL: `npx vitest run src/lib/parsers/codex.test.ts` → fails (`sessions` is `undefined`).

- [ ] Replace the whole of `src/lib/parsers/codex.ts` with:

```ts
// src/lib/parsers/codex.ts
import { readFileSync } from "node:fs";
import {
  projectFromCwd,
  type ParsedFile,
  type RateLimitSnapshot,
  type RateLimitWindow,
  type SessionMeta,
  type UsageRecord,
} from "../normalize";
import { extractCodexText, isSyntheticCodexContext } from "./codex-messages";

function toWindow(w: any): RateLimitWindow | null {
  if (!w || typeof w.used_percent !== "number") return null;
  return {
    usedPercent: w.used_percent,
    windowMinutes: w.window_minutes ?? 0,
    resetsAt: w.resets_at ?? 0,
  };
}

interface Cumulative {
  input: number;
  cached: number;
  output: number;
  reasoning: number;
  total: number;
}

function readCumulative(info: any): Cumulative | null {
  const t = info?.total_token_usage;
  if (!t) return null;
  return {
    input: t.input_tokens ?? 0,
    cached: t.cached_input_tokens ?? 0,
    output: t.output_tokens ?? 0,
    reasoning: t.reasoning_output_tokens ?? 0,
    total: t.total_tokens ?? 0,
  };
}

// Per-session structural accumulator, mutated during the pass.
interface SessionAcc {
  sessionId: string;
  turns: number;
  toolCalls: number;
  models: Set<string>;
  startedAt: string;
  endedAt: string;
}

export function parseCodexFile(path: string): ParsedFile {
  const records: UsageRecord[] = [];
  let quota: RateLimitSnapshot | null = null;
  let model = "unknown";
  let cwd: string | null = null;

  // ONE continuous cumulative baseline for the WHOLE file. A single rollout can
  // contain several session_meta ids (e.g. a fork that replays a parent session),
  // but they all share ONE monotonic `total_token_usage` counter; resetting `prev`
  // to zero on a session switch would turn every subsequent event's delta into the
  // full running cumulative and massively over-count. Only session ATTRIBUTION
  // switches on session_meta; a genuine counter restart is still handled solely by
  // the `cur.total < prev.total` reset branch below.
  let prev: Cumulative = {
    input: 0,
    cached: 0,
    output: 0,
    reasoning: 0,
    total: 0,
  };

  // A rollout can contain MULTIPLE distinct session ids. `activeId` is the id of
  // the most recent session_meta; every record and every meta count is attributed
  // to it, and one SessionMeta is emitted per distinct id.
  const sessions = new Map<string, SessionAcc>();
  let activeId = "";
  function accFor(id: string): SessionAcc {
    let a = sessions.get(id);
    if (!a) {
      a = {
        sessionId: id,
        turns: 0,
        toolCalls: 0,
        models: new Set(),
        startedAt: "",
        endedAt: "",
      };
      sessions.set(id, a);
    }
    return a;
  }

  // Assistant-turn detection mirrors parseCodexMessages so SessionMeta.turns never
  // contradicts the rendered detail: a `response_item` assistant closes a turn, and
  // an `event_msg.agent_message` is counted only when its turn produced no assistant
  // response_item (flushed at the next user turn, at a session switch, or at EOF).
  let lastUserText = "";
  let sawAssistant = false;
  let pendingAgent = false;
  const flushTurn = () => {
    if (pendingAgent && !sawAssistant && activeId) accFor(activeId).turns += 1;
    pendingAgent = false;
  };
  const resetTurnState = () => {
    lastUserText = "";
    sawAssistant = false;
    pendingAgent = false;
  };
  const openUserTurn = (text: string) => {
    flushTurn();
    lastUserText = text;
    sawAssistant = false;
  };

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

    const ts = String(obj.timestamp ?? "");

    if (obj.type === "session_meta") {
      const newId = obj.payload?.id ? String(obj.payload.id) : "";
      if (newId && newId !== activeId) {
        flushTurn(); // close the OLD active session's dangling agent turn first
        activeId = newId;
        resetTurnState(); // the new session starts a fresh turn stream
      }
      cwd = obj.payload?.cwd ?? cwd;
      // NB: `prev` is deliberately NOT reset here (continuous counter).
    }

    // Attribute every line's timestamp to the active session's span (covers
    // session_meta itself, so a switched-in session's span starts at its meta).
    if (activeId && ts) {
      const a = accFor(activeId);
      if (!a.startedAt || ts < a.startedAt) a.startedAt = ts;
      if (ts > a.endedAt) a.endedAt = ts;
    }

    if (obj.type === "session_meta") continue;

    if (obj.type === "turn_context") {
      if (obj.payload?.model) {
        model = obj.payload.model;
        if (activeId) accFor(activeId).models.add(model);
      }
      if (obj.payload?.cwd) cwd = obj.payload.cwd;
      continue;
    }

    if (obj.type === "response_item") {
      const pt = obj.payload?.type;
      if (pt === "function_call") {
        if (activeId) accFor(activeId).toolCalls += 1;
      } else if (pt === "message" && obj.payload?.role === "assistant") {
        if (activeId) accFor(activeId).turns += 1;
        sawAssistant = true;
        pendingAgent = false;
      } else if (pt === "message" && obj.payload?.role === "user") {
        const text = extractCodexText(obj.payload.content);
        // Skip synthetic context injection so turn boundaries match the detail.
        if (text && !isSyntheticCodexContext(text) && text !== lastUserText) {
          openUserTurn(text);
        }
      }
      continue;
    }

    if (obj.type === "event_msg" && obj.payload?.type === "user_message") {
      openUserTurn(
        typeof obj.payload.message === "string" ? obj.payload.message : "",
      );
      continue;
    }

    if (obj.type === "event_msg" && obj.payload?.type === "agent_message") {
      pendingAgent = true;
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

      const cur = readCumulative(obj.payload.info);
      if (!cur) continue; // info null, or no cumulative usage on this event

      // Delta from the previous cumulative snapshot.
      // - True reset (the cumulative TOTAL went backwards → counter/session
      //   restarted): take the current snapshot as the delta.
      // - Otherwise difference per field, clamping each to >= 0 so a single
      //   component regressing while the total still advances cannot produce a
      //   negative delta. (Clamping a component here — rather than treating any
      //   field decrease as a full reset — keeps the per-record totals summing to
      //   the final cumulative total, which is exactly the accounting guard.)
      const d =
        cur.total < prev.total
          ? cur
          : {
              input: Math.max(0, cur.input - prev.input),
              cached: Math.max(0, cur.cached - prev.cached),
              output: Math.max(0, cur.output - prev.output),
              reasoning: Math.max(0, cur.reasoning - prev.reasoning),
              total: cur.total - prev.total,
            };
      prev = cur;

      if (d.total <= 0) continue; // duplicate snapshot / no forward progress

      records.push({
        tool: "codex",
        timestamp: String(obj.timestamp ?? ""),
        model,
        project: projectFromCwd(cwd),
        sessionId: activeId,
        inputTokens: Math.max(0, d.input - d.cached),
        outputTokens: d.output,
        cacheWriteTokens: 0,
        cacheReadTokens: d.cached,
        reasoningTokens: d.reasoning,
      });
    }
  }

  flushTurn(); // count a trailing agent_message-only turn for the final session

  const sessionsOut: SessionMeta[] = [...sessions.values()].map((a) => ({
    sessionId: a.sessionId,
    tool: "codex",
    turns: a.turns,
    toolCalls: a.toolCalls,
    models: [...a.models],
    startedAt: a.startedAt,
    endedAt: a.endedAt,
  }));

  return { records, quota, sessions: sessionsOut };
}
```

- [ ] Run it, expect PASS: `npx vitest run src/lib/parsers/codex.test.ts` → all green (existing token-accounting tests unchanged).
- [ ] Run the full suite, expect PASS: `npx vitest run` → all green.
- [ ] Commit: `git add src/lib/parsers/claude.ts src/lib/parsers/claude.test.ts src/lib/parsers/codex.ts src/lib/parsers/codex.test.ts && git commit -m "fix(lib): dedupe Claude records by message id and compute per-session meta"`

---

### Task 5: `scan()` session index + meta aggregation

**Files:**

- Modify: `src/lib/scan.ts` (full rewrite; currently 58 lines).
- Test: `src/lib/scan.test.ts` (extend; currently ends line 128).

**Interfaces:**

- Consumes: `ParsedFile.sessions` from both parsers (Task 4); `SessionMeta`, `Tool` from `../normalize`.
- Produces: `ScanResult.sessionMeta: Map<string, SessionMeta>` and `ScanResult.sessionIndex: Map<string, { files: string[]; tool: Tool; sessionId: string }>` — BOTH keyed by the composite route key `` `${tool}:${sessionId}` `` (a Claude and a Codex session can never collide). A single file can now contribute to MULTIPLE keys (a Codex fork holds >1 distinct id), and a single key can span more than one file (a resumed Claude session), so the index accumulates a deduped list of files per key and stores the raw `sessionId` the message parsers need (consumed by Tasks 6-11). `records` and `codexQuota` unchanged.

Steps:

- [ ] Append to `src/lib/scan.test.ts` (inside the existing `describe("scan", ...)` block or a new block; it already imports `mkdirSync`, `writeFileSync`, etc.):

```ts
describe("scan session meta and index", () => {
  it("builds sessionMeta and sessionIndex from the parse pass", () => {
    const claudeContent = JSON.stringify({
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
        content: [{ type: "tool_use", id: "t", name: "Bash", input: {} }],
      },
    });
    mkdirSync(join(claudeDir, "proj"), { recursive: true });
    writeFileSync(join(claudeDir, "proj", "s1.jsonl"), claudeContent);

    const { sessionMeta, sessionIndex } = scan({ claudeDir, codexDir });
    // Both maps are keyed by the composite `${tool}:${sessionId}` route key.
    expect(sessionMeta.get("claude:s1")).toMatchObject({
      tool: "claude",
      turns: 1,
      toolCalls: 1,
    });
    expect(sessionIndex.get("claude:s1")?.tool).toBe("claude");
    expect(sessionIndex.get("claude:s1")?.sessionId).toBe("s1");
    expect(sessionIndex.get("claude:s1")?.files).toHaveLength(1);
    expect(sessionIndex.get("claude:s1")?.files[0].endsWith("s1.jsonl")).toBe(
      true,
    );
  });

  it("does not double-count meta when the same session id spans files across repeat scans", () => {
    const line = (ts: string) =>
      JSON.stringify({
        type: "assistant",
        timestamp: ts,
        cwd: "/Users/me/ProjA",
        sessionId: "dup",
        message: {
          model: "claude-opus-4-8",
          usage: {
            input_tokens: 1,
            output_tokens: 1,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      });
    mkdirSync(join(claudeDir, "p"), { recursive: true });
    writeFileSync(
      join(claudeDir, "p", "a.jsonl"),
      line("2026-06-01T10:00:00.000Z"),
    );
    writeFileSync(
      join(claudeDir, "p", "b.jsonl"),
      line("2026-06-01T11:00:00.000Z"),
    );

    const first = scan({ claudeDir, codexDir });
    expect(first.sessionMeta.get("claude:dup")?.turns).toBe(2);
    // both files are indexed under the one composite key
    expect(first.sessionIndex.get("claude:dup")?.files).toHaveLength(2);
    const second = scan({ claudeDir, codexDir }); // cache hit; must not mutate cached meta
    expect(second.sessionMeta.get("claude:dup")?.turns).toBe(2);
    expect(second.sessionIndex.get("claude:dup")?.files).toHaveLength(2);
  });

  it("indexes every distinct id of a multi-session Codex rollout under the same file", () => {
    const idA = "019e39b9-0000-7000-a000-0000000000a1";
    const idB = "019e2f27-0000-7000-a000-0000000000b2";
    const content = [
      JSON.stringify({
        timestamp: "2026-06-11T09:00:00.000Z",
        type: "session_meta",
        payload: { id: idA, cwd: "/Users/me/ProjX" },
      }),
      JSON.stringify({
        timestamp: "2026-06-11T09:00:01.000Z",
        type: "turn_context",
        payload: { model: "gpt-5.5", cwd: "/Users/me/ProjX" },
      }),
      JSON.stringify({
        timestamp: "2026-06-11T09:00:02.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "a" }],
        },
      }),
      JSON.stringify({
        timestamp: "2026-06-11T09:00:03.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 100,
              cached_input_tokens: 0,
              output_tokens: 0,
              reasoning_output_tokens: 0,
              total_tokens: 100,
            },
          },
        },
      }),
      JSON.stringify({
        timestamp: "2026-06-11T09:00:10.000Z",
        type: "session_meta",
        payload: { id: idB, cwd: "/Users/me/ProjY" },
      }),
      JSON.stringify({
        timestamp: "2026-06-11T09:00:11.000Z",
        type: "turn_context",
        payload: { model: "gpt-5.3-codex", cwd: "/Users/me/ProjY" },
      }),
      JSON.stringify({
        timestamp: "2026-06-11T09:00:12.000Z",
        type: "response_item",
        payload: {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "b" }],
        },
      }),
      JSON.stringify({
        timestamp: "2026-06-11T09:00:13.000Z",
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 300,
              cached_input_tokens: 0,
              output_tokens: 0,
              reasoning_output_tokens: 0,
              total_tokens: 300,
            },
          },
        },
      }),
    ].join("\n");
    mkdirSync(join(codexDir, "2026", "06", "11"), { recursive: true });
    const file = join(codexDir, "2026", "06", "11", "rollout-multi.jsonl");
    writeFileSync(file, content);

    const { sessionMeta, sessionIndex, records } = scan({
      claudeDir,
      codexDir,
    });
    expect(sessionMeta.get(`codex:${idA}`)?.turns).toBe(1);
    expect(sessionMeta.get(`codex:${idB}`)?.turns).toBe(1);
    expect(sessionMeta.get(`codex:${idA}`)?.models).toEqual(["gpt-5.5"]);
    expect(sessionMeta.get(`codex:${idB}`)?.models).toEqual(["gpt-5.3-codex"]);
    // both ids point at the SAME single file
    expect(sessionIndex.get(`codex:${idA}`)?.files).toEqual([file]);
    expect(sessionIndex.get(`codex:${idB}`)?.files).toEqual([file]);
    expect(sessionIndex.get(`codex:${idA}`)?.sessionId).toBe(idA);
    // Continuous counter: idB's record delta is 300 - 100 = 200 (baseline never
    // reset), so its input is 200, not the full cumulative 300.
    const rb = records.find((r) => r.sessionId === idB)!;
    expect(rb.inputTokens).toBe(200);
  });
});
```

- [ ] Run it, expect FAIL: `npx vitest run src/lib/scan.test.ts` → fails (`sessionMeta`/`sessionIndex` are `undefined`).

- [ ] Replace the whole of `src/lib/scan.ts` with:

```ts
// src/lib/scan.ts
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseFileCached } from "./cache";
import { parseClaudeFile } from "./parsers/claude";
import { parseCodexFile } from "./parsers/codex";
import type {
  RateLimitSnapshot,
  SessionMeta,
  Tool,
  UsageRecord,
} from "./normalize";

export interface SessionIndexEntry {
  files: string[];
  tool: Tool;
  sessionId: string; // raw id the message parsers need (Codex filters by it)
}

export interface ScanResult {
  records: UsageRecord[];
  codexQuota: RateLimitSnapshot | null;
  // Both maps are keyed by the composite route key `${tool}:${sessionId}` so a
  // Claude and a Codex session can never collide in the shared namespace.
  sessionMeta: Map<string, SessionMeta>;
  sessionIndex: Map<string, SessionIndexEntry>;
}

const keyOf = (tool: Tool, sessionId: string): string => `${tool}:${sessionId}`;

export function listJsonlFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { recursive: true, encoding: "utf8" })
      .filter((name) => name.endsWith(".jsonl"))
      .map((name) => join(dir, name));
  } catch {
    return []; // directory missing
  }
}

// Cloned on first insert so merging never mutates the SessionMeta objects held
// inside the mtime cache (parseFileCached returns the same references across
// scans; mutating them would inflate counts on the next scan).
function cloneMeta(s: SessionMeta): SessionMeta {
  return {
    ...s,
    models: [...s.models],
    compaction: s.compaction ? { ...s.compaction } : undefined,
  };
}

// Accumulates the files a session key appears in, deduped, and records the raw
// session id. A key can span several files (e.g. a resumed Claude session) and a
// file can appear under several keys (e.g. a Codex fork holding >1 id); the detail
// route parses every file listed under the key.
function addSessionFile(
  index: Map<string, SessionIndexEntry>,
  tool: Tool,
  sessionId: string,
  file: string,
): void {
  if (!sessionId) return;
  const key = keyOf(tool, sessionId);
  const e = index.get(key);
  if (!e) {
    index.set(key, { files: [file], tool, sessionId });
    return;
  }
  if (!e.files.includes(file)) e.files.push(file);
}

function mergeMeta(map: Map<string, SessionMeta>, s: SessionMeta): void {
  const key = keyOf(s.tool, s.sessionId);
  const e = map.get(key);
  if (!e) {
    map.set(key, cloneMeta(s));
    return;
  }
  e.turns += s.turns;
  e.toolCalls += s.toolCalls;
  for (const m of s.models) if (!e.models.includes(m)) e.models.push(m);
  if (s.startedAt && (!e.startedAt || s.startedAt < e.startedAt)) {
    e.startedAt = s.startedAt;
  }
  if (s.endedAt && s.endedAt > e.endedAt) e.endedAt = s.endedAt;
  if (s.compaction) {
    if (!e.compaction) e.compaction = { full: 0, micro: 0, tokensSaved: 0 };
    e.compaction.full += s.compaction.full;
    e.compaction.micro += s.compaction.micro;
    e.compaction.tokensSaved += s.compaction.tokensSaved;
  }
}

export function scan(
  opts: { claudeDir?: string; codexDir?: string } = {},
): ScanResult {
  const claudeDir = opts.claudeDir ?? join(homedir(), ".claude", "projects");
  const codexDir = opts.codexDir ?? join(homedir(), ".codex", "sessions");

  const records: UsageRecord[] = [];
  let codexQuota: RateLimitSnapshot | null = null;
  const sessionMeta = new Map<string, SessionMeta>();
  const sessionIndex = new Map<string, SessionIndexEntry>();

  for (const file of listJsonlFiles(claudeDir)) {
    try {
      const parsed = parseFileCached(file, parseClaudeFile);
      records.push(...parsed.records);
      for (const s of parsed.sessions ?? []) {
        mergeMeta(sessionMeta, s);
        addSessionFile(sessionIndex, s.tool, s.sessionId, file);
      }
    } catch {
      // file vanished or became unreadable between enumeration and parse; skip it
    }
  }

  for (const file of listJsonlFiles(codexDir)) {
    try {
      const parsed = parseFileCached(file, parseCodexFile);
      records.push(...parsed.records);
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

  return { records, codexQuota, sessionMeta, sessionIndex };
}
```

- [ ] Run it, expect PASS: `npx vitest run src/lib/scan.test.ts` → all green (existing scan/cache tests unchanged).
- [ ] Commit: `git add src/lib/scan.ts src/lib/scan.test.ts && git commit -m "feat(lib): index sessions by id and expose per-session meta from scan"`

---

### Task 6: `sessions.ts` — group records into summaries

**Files:**

- Create: `src/lib/sessions.ts`
- Test: `src/lib/sessions.test.ts`

**Interfaces:**

- Consumes: `SessionMeta`, `SessionSummary`, `Tool`, `UsageRecord`, `totalTokens` from `./normalize`; `cost`, `isPriced`, `defaultPricing`, `PricingTable` from `./pricing`.
- Produces: `function groupSessions(records: UsageRecord[], meta: Map<string, SessionMeta>, pricing?: PricingTable): SessionSummary[]` (consumed by Tasks 7, 8, 10, 11). Records are grouped/deduped by the composite key `` `${tool}:${sessionId}` `` (matching `scan()`'s `sessionMeta`/`sessionIndex` keys), so `meta` is looked up by that same key. Each `SessionSummary` carries both `key` (the composite route key) and `id` (the raw session id).

Steps:

- [ ] Create `src/lib/sessions.test.ts` (cost literals hand-computed from `pricing.json`: opus rates 5/25/6.25/0.5, sonnet 3/15/3.75/0.3, gpt-5.3-codex 1.75/14/0/0.175):

```ts
// src/lib/sessions.test.ts
import { describe, it, expect } from "vitest";
import { groupSessions } from "./sessions";
import type { SessionMeta, UsageRecord } from "./normalize";

const records: UsageRecord[] = [
  {
    tool: "claude",
    timestamp: "2026-06-01T10:00:00.000Z",
    model: "claude-opus-4-8",
    project: "ProjA",
    sessionId: "s1",
    inputTokens: 100,
    outputTokens: 50,
    cacheWriteTokens: 200,
    cacheReadTokens: 300,
    reasoningTokens: 0,
  },
  {
    tool: "claude",
    timestamp: "2026-06-01T11:00:00.000Z",
    model: "claude-sonnet-4-6",
    project: "ProjA",
    sessionId: "s1",
    inputTokens: 10,
    outputTokens: 5,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    reasoningTokens: 0,
  },
  {
    tool: "codex",
    timestamp: "2026-06-02T09:00:00.000Z",
    model: "gpt-5.3-codex",
    project: "ProjB",
    sessionId: "c1",
    inputTokens: 200,
    outputTokens: 100,
    cacheWriteTokens: 0,
    cacheReadTokens: 800,
    reasoningTokens: 40,
  },
];

// `meta` is keyed by the composite route key `${tool}:${sessionId}`, matching
// scan()'s sessionMeta.
const meta = new Map<string, SessionMeta>([
  [
    "claude:s1",
    {
      sessionId: "s1",
      tool: "claude",
      turns: 5,
      toolCalls: 3,
      models: ["claude-opus-4-8", "claude-sonnet-4-6"],
      startedAt: "2026-06-01T10:00:00.000Z",
      endedAt: "2026-06-01T12:00:00.000Z",
      compaction: { full: 1, micro: 2, tokensSaved: 12345 },
    },
  ],
  [
    "codex:c1",
    {
      sessionId: "c1",
      tool: "codex",
      turns: 2,
      toolCalls: 4,
      models: ["gpt-5.3-codex"],
      startedAt: "2026-06-02T09:00:00.000Z",
      endedAt: "2026-06-02T09:30:00.000Z",
    },
  ],
]);

describe("groupSessions", () => {
  it("groups records + meta into summaries sorted by most recent start", () => {
    const summaries = groupSessions(records, meta);
    expect(summaries).toHaveLength(2);
    expect(summaries.map((s) => s.id)).toEqual(["c1", "s1"]);
    // Each summary carries both the composite route key and the raw id.
    expect(summaries.map((s) => s.key)).toEqual(["codex:c1", "claude:s1"]);
  });

  it("pins token totals, cost, duration, and compaction for a Claude session", () => {
    const s1 = groupSessions(records, meta).find((s) => s.id === "s1")!;
    expect(s1.key).toBe("claude:s1");
    expect(s1).toMatchObject({
      tool: "claude",
      project: "ProjA",
      models: ["claude-opus-4-8", "claude-sonnet-4-6"],
      turns: 5,
      toolCalls: 3,
      totalTokens: 665, // 650 + 15
      durationMs: 7200000, // 10:00 -> 12:00
      unpriced: false,
      compaction: { full: 1, micro: 2, tokensSaved: 12345 },
    });
    expect(s1.tokens).toEqual({
      input: 110,
      output: 55,
      cacheWrite: 200,
      cacheRead: 300,
    });
    // opus: (100*5 + 50*25 + 200*6.25 + 300*0.5)/1e6 = 0.00315
    // sonnet: (10*3 + 5*15)/1e6 = 0.000105
    expect(s1.cost).toBeCloseTo(0.003255, 8);
  });

  it("omits compaction for Codex sessions and pins Codex cost", () => {
    const c1 = groupSessions(records, meta).find((s) => s.id === "c1")!;
    expect(c1.key).toBe("codex:c1");
    expect(c1.compaction).toBeUndefined();
    expect(c1.totalTokens).toBe(1100); // 200 + 100 + 0 + 800
    // (200*1.75 + 100*14 + 800*0.175)/1e6 = 0.00189
    expect(c1.cost).toBeCloseTo(0.00189, 8);
  });
});
```

- [ ] Run it, expect FAIL: `npx vitest run src/lib/sessions.test.ts` → fails with `Failed to load url ./sessions` (module does not exist).

- [ ] Create `src/lib/sessions.ts`:

```ts
// src/lib/sessions.ts
import {
  totalTokens,
  type SessionMeta,
  type SessionSummary,
  type Tool,
  type UsageRecord,
} from "./normalize";
import { cost, defaultPricing, isPriced, type PricingTable } from "./pricing";

interface Acc {
  id: string; // raw session id
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  total: number;
  cost: number;
  unpriced: boolean;
  project: string;
  tool: Tool;
  models: Set<string>;
  started: string;
  ended: string;
}

export function groupSessions(
  records: UsageRecord[],
  meta: Map<string, SessionMeta>,
  pricing: PricingTable = defaultPricing,
): SessionSummary[] {
  // Keyed by the composite route key `${tool}:${sessionId}` so Claude and Codex
  // sessions never collide even if two raw ids ever coincide.
  const groups = new Map<string, Acc>();

  for (const r of records) {
    const id = r.sessionId;
    if (!id) continue;
    const key = `${r.tool}:${id}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        id,
        input: 0,
        output: 0,
        cacheWrite: 0,
        cacheRead: 0,
        total: 0,
        cost: 0,
        unpriced: false,
        project: r.project,
        tool: r.tool,
        models: new Set(),
        started: r.timestamp,
        ended: r.timestamp,
      };
      groups.set(key, g);
    }
    g.input += r.inputTokens;
    g.output += r.outputTokens;
    g.cacheWrite += r.cacheWriteTokens;
    g.cacheRead += r.cacheReadTokens;
    g.total += totalTokens(r);
    g.cost += cost(r, pricing);
    if (!isPriced(r.model, pricing)) g.unpriced = true;
    if (r.model) g.models.add(r.model);
    if (r.timestamp) {
      if (r.timestamp < g.started) g.started = r.timestamp;
      if (r.timestamp > g.ended) g.ended = r.timestamp;
    }
  }

  const summaries: SessionSummary[] = [];
  for (const [key, g] of groups) {
    const m = meta.get(key);
    const startedAt = m?.startedAt || g.started;
    const endedAt = m?.endedAt || g.ended;
    const startMs = Date.parse(startedAt);
    const endMs = Date.parse(endedAt);
    const durationMs =
      Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
        ? endMs - startMs
        : 0;
    const models = m && m.models.length ? m.models : [...g.models];

    const summary: SessionSummary = {
      key,
      id: g.id,
      tool: m?.tool ?? g.tool,
      project: g.project,
      models,
      startedAt,
      endedAt,
      durationMs,
      turns: m?.turns ?? 0,
      toolCalls: m?.toolCalls ?? 0,
      tokens: {
        input: g.input,
        output: g.output,
        cacheWrite: g.cacheWrite,
        cacheRead: g.cacheRead,
      },
      totalTokens: g.total,
      cost: g.cost,
      unpriced: g.unpriced,
    };
    if (m?.compaction && (m.compaction.full > 0 || m.compaction.micro > 0)) {
      summary.compaction = m.compaction;
    }
    summaries.push(summary);
  }

  summaries.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return summaries;
}
```

- [ ] Run it, expect PASS: `npx vitest run src/lib/sessions.test.ts` → all green.
- [ ] Commit: `git add src/lib/sessions.ts src/lib/sessions.test.ts && git commit -m "feat(lib): group usage records into session summaries"`

---

### Task 7: `/api/sessions` endpoint

**Files:**

- Create: `src/pages/api/sessions/index.ts`
- Test: `src/pages/api/sessions/index.test.ts`

**Interfaces:**

- Consumes: `scan` from `../../../lib/scan`, `groupSessions` from `../../../lib/sessions`, `defaultPricing` from `../../../lib/pricing`.
- Produces: `export const GET: APIRoute` returning `SessionSummary[]` (JSON). Consumed by Task 10's island. Whole-session semantics: summaries are built from the UNFILTERED records + meta (so each session's numbers are internally consistent), then the tool/date filters include or exclude WHOLE sessions; a session that overlaps the date window is returned intact, never truncated.

Steps:

- [ ] Create `src/pages/api/sessions/index.test.ts` (mirrors `usage.test.ts` mock pattern; note the deeper relative path `../../../lib/scan`):

```ts
// src/pages/api/sessions/index.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SessionMeta } from "../../../lib/normalize";

// vitest hoists vi.mock above imports, so the factory must not close over any
// top-level runtime consts. Everything the mock returns (the record builder, the
// SessionMeta map, the records) is constructed INSIDE the factory.
vi.mock("../../../lib/scan", () => {
  const rec = (
    sessionId: string,
    tool: "claude" | "codex",
    project: string,
    model: string,
    timestamp: string,
    inputTokens: number,
  ) => ({
    tool,
    timestamp,
    model,
    project,
    sessionId,
    inputTokens,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    reasoningTokens: 0,
  });

  // Keyed by the composite route key `${tool}:${sessionId}`.
  const sessionMeta = new Map<string, SessionMeta>([
    [
      "claude:s1",
      {
        sessionId: "s1",
        tool: "claude",
        turns: 3,
        toolCalls: 1,
        models: ["claude-opus-4-8"],
        startedAt: "2026-06-01T23:00:00.000Z",
        endedAt: "2026-06-02T01:00:00.000Z",
        compaction: { full: 1, micro: 0, tokensSaved: 999 },
      },
    ],
    [
      "codex:c1",
      {
        sessionId: "c1",
        tool: "codex",
        turns: 2,
        toolCalls: 0,
        models: ["gpt-5.3-codex"],
        startedAt: "2026-06-02T10:00:00.000Z",
        endedAt: "2026-06-02T10:05:00.000Z",
      },
    ],
  ]);

  return {
    scan: () => ({
      // s1 straddles 06-01 and 06-02 (1000 tokens total across the two days).
      records: [
        rec(
          "s1",
          "claude",
          "ProjA",
          "claude-opus-4-8",
          "2026-06-01T23:00:00.000Z",
          100,
        ),
        rec(
          "s1",
          "claude",
          "ProjA",
          "claude-opus-4-8",
          "2026-06-02T01:00:00.000Z",
          900,
        ),
        // c1 lives entirely on 06-02.
        rec(
          "c1",
          "codex",
          "ProjB",
          "gpt-5.3-codex",
          "2026-06-02T10:00:00.000Z",
          200,
        ),
      ],
      codexQuota: null,
      sessionMeta,
      sessionIndex: new Map(),
    }),
  };
});

beforeEach(() => vi.clearAllMocks());

describe("GET /api/sessions", () => {
  it("returns whole-session summaries as JSON sorted by most recent start", async () => {
    const { GET } = await import("./index");
    const res = await GET({
      url: new URL("http://localhost/api/sessions"),
    } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(body.map((s: any) => s.id)).toEqual(["c1", "s1"]);
    const s1 = body.find((s: any) => s.id === "s1");
    expect(s1.key).toBe("claude:s1");
    expect(s1.turns).toBe(3);
    expect(s1.totalTokens).toBe(1000); // both s1 records, whole session
    expect(s1.compaction).toEqual({ full: 1, micro: 0, tokensSaved: 999 });
  });

  it("honours the tool filter", async () => {
    const { GET } = await import("./index");
    const res = await GET({
      url: new URL("http://localhost/api/sessions?tool=claude"),
    } as any);
    const body = await res.json();
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe("s1");
  });

  it("includes a session that only partially overlaps the date window WHOLE, and excludes one fully outside", async () => {
    const { GET } = await import("./index");
    const res = await GET({
      url: new URL(
        "http://localhost/api/sessions?from=2026-06-01&to=2026-06-01",
      ),
    } as any);
    const body = await res.json();
    // s1 started on 06-01 (overlaps the window) -> included; c1 is entirely on
    // 06-02 (starts after the window) -> excluded.
    expect(body.map((s: any) => s.id)).toEqual(["s1"]);
    const s1 = body.find((s: any) => s.id === "s1");
    // WHOLE-session totals: the 06-02 record is NOT truncated away by the 06-01
    // window (a truncated total would be 100, not 1000).
    expect(s1.totalTokens).toBe(1000);
    expect(s1.tokens.input).toBe(1000);
    // meta stays unfiltered and internally consistent with the token totals.
    expect(s1.turns).toBe(3);
  });
});
```

- [ ] Run it, expect FAIL: `npx vitest run "src/pages/api/sessions/index.test.ts"` → fails with `Failed to load url ./index` (module does not exist).

- [ ] Create `src/pages/api/sessions/index.ts`:

```ts
// src/pages/api/sessions/index.ts
import type { APIRoute } from "astro";
import { scan } from "../../../lib/scan";
import { groupSessions } from "../../../lib/sessions";
import { defaultPricing } from "../../../lib/pricing";

export const prerender = false;

export const GET: APIRoute = ({ url }) => {
  // Whole-session semantics: build summaries from the UNFILTERED records + meta
  // so every session's tokens/cost stay internally consistent with its
  // turns/duration/toolCalls/compaction. The filters then include or exclude
  // WHOLE sessions; an overlapping session is returned intact, never truncated.
  const { records, sessionMeta } = scan();
  const all = groupSessions(records, sessionMeta, defaultPricing);

  const params = url.searchParams;
  const tool = params.get("tool"); // "claude" | "codex" | null
  const from = params.get("from"); // YYYY-MM-DD inclusive, or null
  const to = params.get("to"); // YYYY-MM-DD inclusive, or null

  const filtered = all.filter((s) => {
    if (tool && s.tool !== tool) return false;
    // Date-interval overlap on YYYY-MM-DD (matches applyFilters' slice
    // convention): include when endedAt >= from AND startedAt <= to.
    if (from && s.endedAt.slice(0, 10) < from) return false;
    if (to && s.startedAt.slice(0, 10) > to) return false;
    return true;
  });

  return new Response(JSON.stringify(filtered), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
```

- [ ] Run it, expect PASS: `npx vitest run "src/pages/api/sessions/index.test.ts"` → all green.
- [ ] Commit: `git add "src/pages/api/sessions/index.ts" "src/pages/api/sessions/index.test.ts" && git commit -m "feat(api): serve session summaries with tool and date filters"`

---

### Task 8: `/api/sessions/[id]` endpoint (on-demand detail, 404)

**Files:**

- Create: `src/pages/api/sessions/[id].ts`
- Test: `src/pages/api/sessions/[id].test.ts`

**Interfaces:**

- Consumes: `scan` from `../../../lib/scan`, `groupSessions` from `../../../lib/sessions`, `parseClaudeMessages` from `../../../lib/parsers/claude-messages`, `parseCodexMessages` from `../../../lib/parsers/codex-messages`, `defaultPricing`.
- Produces: `export const GET: APIRoute` returning `SessionDetail` (JSON, 200) or `404`. The `[id]` param is the composite route key `` `${tool}:${sessionId}` ``; the route looks up `sessionIndex.get(key)` and uses the entry's `tool` + raw `sessionId` to pick the matching parser — `parseClaudeMessages(file)` for Claude, `parseCodexMessages(file, entry.sessionId)` for Codex (so a shared Codex file yields only this session's messages). A key can map to more than one file, so the route parses ALL of `entry.files`, concatenates in timestamp order, and re-indexes `Message.index` 0..n; the summary is matched by `s.key === key`. Consumed by Task 11's page.

Steps:

- [ ] Create `src/lib/parsers/__fixtures__/claude-messages-2.jsonl` (a small second Claude file that embeds the SAME session id `m1` as `claude-messages.jsonl` — a session resumed into a second file, which real `scan()` indexes under the one composite key `claude:m1` — with an interleaving timestamp `10:03:30` and a later `10:11:00`, to prove timestamp-ordered concatenation across the two files):

```
{"type":"user","timestamp":"2026-06-10T10:03:30.000Z","cwd":"/Users/me/ProjX","sessionId":"m1","message":{"role":"user","content":"mid extra question"}}
{"type":"assistant","timestamp":"2026-06-10T10:11:00.000Z","cwd":"/Users/me/ProjX","sessionId":"m1","message":{"id":"msg_a6","role":"assistant","model":"claude-opus-4-8","usage":{"input_tokens":2,"output_tokens":1,"cache_creation_input_tokens":0,"cache_read_input_tokens":0},"content":[{"type":"text","text":"Later reply."}]}}
```

- [ ] Create `src/pages/api/sessions/[id].test.ts` (mocks `scan`; because vitest hoists `vi.mock`, fixture paths are computed with `vi.hoisted` — `import.meta.url` IS available inside `vi.hoisted` — and the records/SessionMeta/sessionIndex are built inside the factory. The Codex branch parses the REAL `codex-messages.jsonl` via `parseCodexMessages`, and the Claude branch parses TWO real files both embedding `m1` — exactly what real `scan()` would index under `claude:m1`, so no impossible key→id mapping):

```ts
// src/pages/api/sessions/[id].test.ts
import { describe, it, expect, vi } from "vitest";
import type { SessionMeta } from "../../../lib/normalize";

// vitest hoists vi.mock above imports; compute fixture paths in vi.hoisted so
// they exist when the factory runs. import.meta.url is available here; do NOT
// call the top-level fileURLToPath inside the factory.
const { claudeFixture, claudeFixture2, codexFixture, badFile } = vi.hoisted(
  () => ({
    claudeFixture: new URL(
      "../../../lib/parsers/__fixtures__/claude-messages.jsonl",
      import.meta.url,
    ).pathname,
    claudeFixture2: new URL(
      "../../../lib/parsers/__fixtures__/claude-messages-2.jsonl",
      import.meta.url,
    ).pathname,
    codexFixture: new URL(
      "../../../lib/parsers/__fixtures__/codex-messages.jsonl",
      import.meta.url,
    ).pathname,
    badFile: "/no/such/file.jsonl",
  }),
);

vi.mock("../../../lib/scan", () => {
  const claudeMeta: SessionMeta = {
    sessionId: "m1",
    tool: "claude",
    turns: 5,
    toolCalls: 2,
    models: ["claude-opus-4-8"],
    startedAt: "2026-06-10T10:00:00.000Z",
    endedAt: "2026-06-10T10:11:00.000Z",
    compaction: { full: 1, micro: 1, tokensSaved: 785000 },
  };
  const codexMeta: SessionMeta = {
    sessionId: "c9",
    tool: "codex",
    turns: 2,
    toolCalls: 2,
    models: ["gpt-5.3-codex"],
    startedAt: "2026-06-11T09:00:00.000Z",
    endedAt: "2026-06-11T09:00:25.000Z",
  };
  const claudeRec = {
    tool: "claude" as const,
    timestamp: "2026-06-10T10:00:00.000Z",
    model: "claude-opus-4-8",
    project: "ProjX",
    sessionId: "m1",
    inputTokens: 100,
    outputTokens: 50,
    cacheWriteTokens: 200,
    cacheReadTokens: 300,
    reasoningTokens: 0,
  };
  const codexRec = {
    tool: "codex" as const,
    timestamp: "2026-06-11T09:00:10.000Z",
    model: "gpt-5.3-codex",
    project: "ProjX",
    sessionId: "c9",
    inputTokens: 800,
    outputTokens: 34,
    cacheWriteTokens: 0,
    cacheReadTokens: 200,
    reasoningTokens: 0,
  };
  return {
    scan: () => ({
      records: [claudeRec, codexRec],
      codexQuota: null,
      // Both maps are keyed by the composite `${tool}:${sessionId}` route key.
      sessionMeta: new Map<string, SessionMeta>([
        ["claude:m1", claudeMeta],
        ["codex:c9", codexMeta],
      ]),
      // claude:m1 spans TWO files that BOTH embed sessionId m1 (a resumed
      // session); codex:c9 is one shared rollout parsed with its raw id;
      // claude:bad points at an unreadable file to drive the corrupt-file 404.
      sessionIndex: new Map([
        [
          "claude:m1",
          {
            files: [claudeFixture, claudeFixture2],
            tool: "claude",
            sessionId: "m1",
          },
        ],
        ["codex:c9", { files: [codexFixture], tool: "codex", sessionId: "c9" }],
        ["claude:bad", { files: [badFile], tool: "claude", sessionId: "bad" }],
      ]),
    }),
  };
});

describe("GET /api/sessions/[id]", () => {
  it("returns 200 for a Codex session, parsing the shared rollout by its raw id and filtering injected context", async () => {
    const { GET } = await import("./[id]");
    const res = await GET({ params: { id: "codex:c9" } } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.id).toBe("c9");
    expect(body.summary.key).toBe("codex:c9");
    expect(body.summary.turns).toBe(2);
    // parseCodexMessages(codexFixture, "c9") yields exactly the real turns.
    expect(body.messages).toHaveLength(4);
    expect(body.messages[0]).toMatchObject({
      index: 0,
      role: "user",
      text: "Add a test for the parser.",
    });
    expect(body.messages[1]).toMatchObject({
      index: 1,
      role: "assistant",
      toolUses: ["shell"],
    });
    // No injected context leaks into the replay.
    const allText = body.messages.map((m: any) => m.text).join("\n");
    expect(allText).not.toContain("AGENTS.md");
    expect(allText).not.toContain("<environment_context>");
    expect(body.messages.every((m: any, i: number) => m.index === i)).toBe(
      true,
    );
  });

  it("parses ALL files of a resumed Claude session and concatenates in timestamp order, re-indexing", async () => {
    const { GET } = await import("./[id]");
    // Both files embed sessionId m1, so real scan() indexes them under claude:m1.
    const res = await GET({ params: { id: "claude:m1" } } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.id).toBe("m1");
    expect(body.summary.key).toBe("claude:m1");
    expect(body.messages).toHaveLength(12);
    // the 10:03:30 line from the second file slots into the middle by timestamp
    expect(body.messages[3]).toMatchObject({
      index: 3,
      role: "user",
      text: "mid extra question",
    });
    // the full-compaction marker shifts down by one after the inserted message
    expect(body.messages[5].compaction).toBe("full");
    // the 10:11:00 line from the second file lands last
    expect(body.messages[11]).toMatchObject({
      index: 11,
      text: "Later reply.",
    });
    expect(body.messages.every((m: any, i: number) => m.index === i)).toBe(
      true,
    );
  });

  it("decodes a percent-encoded composite key from a link (claude%3Am1)", async () => {
    const { GET } = await import("./[id]");
    const res = await GET({ params: { id: "claude%3Am1" } } as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.key).toBe("claude:m1");
  });

  it("returns 404 for an unknown session id", async () => {
    const { GET } = await import("./[id]");
    const res = await GET({ params: { id: "missing" } } as any);
    expect(res.status).toBe(404);
  });

  it("returns 404 when a session file is vanished or corrupt", async () => {
    const { GET } = await import("./[id]");
    // "claude:bad" has a valid index entry but its file cannot be read, so the
    // parse failure (not a missing summary) drives the 404.
    const res = await GET({ params: { id: "claude:bad" } } as any);
    expect(res.status).toBe(404);
  });
});
```

- [ ] Run it, expect FAIL: `npx vitest run "src/pages/api/sessions/[id].test.ts"` → fails with `Failed to load url ./[id]` (module does not exist).

- [ ] Create `src/pages/api/sessions/[id].ts`:

```ts
// src/pages/api/sessions/[id].ts
import type { APIRoute } from "astro";
import { scan } from "../../../lib/scan";
import { groupSessions } from "../../../lib/sessions";
import { defaultPricing } from "../../../lib/pricing";
import { parseClaudeMessages } from "../../../lib/parsers/claude-messages";
import { parseCodexMessages } from "../../../lib/parsers/codex-messages";
import type { Message } from "../../../lib/normalize";

export const prerender = false;

const notFound = () =>
  new Response(JSON.stringify({ error: "not found" }), {
    status: 404,
    headers: { "content-type": "application/json" },
  });

export const GET: APIRoute = ({ params }) => {
  // The `[id]` param is the composite route key `${tool}:${sessionId}`. Decode
  // defensively so a percent-encoded `${tool}%3A${sessionId}` from a link also
  // resolves (decodeURIComponent is a no-op on an already-decoded value).
  const key = params.id ? decodeURIComponent(params.id) : undefined;
  if (!key) return notFound();

  const { records, sessionMeta, sessionIndex } = scan();
  const entry = sessionIndex.get(key);
  if (!entry) return notFound();

  // A key can span more than one file (a resumed Claude session), and a Codex
  // file can hold several sessions, so the Codex parser filters by the raw
  // sessionId. Parse every file, concatenate in timestamp order, and re-index
  // 0..n so the replay is one coherent stream.
  let messages: Message[];
  try {
    messages =
      entry.tool === "claude"
        ? entry.files.flatMap((file) => parseClaudeMessages(file))
        : entry.files.flatMap((file) =>
            parseCodexMessages(file, entry.sessionId),
          );
  } catch {
    return notFound(); // a file vanished or became unreadable
  }
  messages.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  messages = messages.map((m, i) => ({ ...m, index: i }));

  const summary = groupSessions(records, sessionMeta, defaultPricing).find(
    (s) => s.key === key,
  );
  if (!summary) return notFound();

  return new Response(JSON.stringify({ summary, messages }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
```

- [ ] Run it, expect PASS: `npx vitest run "src/pages/api/sessions/[id].test.ts"` → all green.
- [ ] Run the full suite, expect PASS: `npx vitest run` → all green.
- [ ] Commit: `git add "src/pages/api/sessions/[id].ts" "src/pages/api/sessions/[id].test.ts" src/lib/parsers/__fixtures__/claude-messages-2.jsonl && git commit -m "feat(api): serve session detail with on-demand message parsing"`

---

### Task 9: Extract shared `FilterBar` and consume it in `Dashboard`

**Files:**

- Create: `src/components/FilterBar.tsx`
- Modify: `src/components/Dashboard.tsx` (add the `FilterBar` import, drop the local `ToolFilter`, replace the inline filter-bar markup). **This runs after Phase 1 — keep Phase 1's `DashboardData` import and its `Tips`/`RetentionBanner` imports and `retention` prop intact. Edit by content match, never by the pre-Phase-1 line numbers.**

**Interfaces:**

- Produces: `export type ToolFilter = "all" | "claude" | "codex"` and `export default function FilterBar(props)` where `props = { tool: ToolFilter; from: string; to: string; loading: boolean; onChange: (next: { tool?: ToolFilter; from?: string; to?: string }) => void; onRefresh?: () => void }`. Consumed by Task 10's island and by `Dashboard`.

Steps:

- [ ] Create `src/components/FilterBar.tsx` (markup copied verbatim from Dashboard's current filter bar so the Overview is visually unchanged):

```tsx
// src/components/FilterBar.tsx
export type ToolFilter = "all" | "claude" | "codex";

interface Props {
  tool: ToolFilter;
  from: string;
  to: string;
  loading: boolean;
  onChange: (next: { tool?: ToolFilter; from?: string; to?: string }) => void;
  onRefresh?: () => void;
}

export default function FilterBar({
  tool,
  from,
  to,
  loading,
  onChange,
  onRefresh,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <div className="flex gap-2">
        {(["all", "claude", "codex"] as const).map((t) => (
          <button
            key={t}
            onClick={() => onChange({ tool: t })}
            className={`px-3 py-1 rounded ${tool === t ? "bg-blue-500 text-white" : "bg-neutral-800 text-neutral-300"}`}
          >
            {t}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-1 text-neutral-400">
        From
        <input
          type="date"
          value={from}
          onChange={(e) => onChange({ from: e.target.value })}
          className="bg-neutral-800 rounded px-2 py-1 text-neutral-100"
        />
      </label>
      <label className="flex items-center gap-1 text-neutral-400">
        To
        <input
          type="date"
          value={to}
          onChange={(e) => onChange({ to: e.target.value })}
          className="bg-neutral-800 rounded px-2 py-1 text-neutral-100"
        />
      </label>
      {onRefresh && (
        <button
          onClick={onRefresh}
          className="ml-auto px-3 py-1 rounded bg-neutral-800 text-neutral-300"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      )}
    </div>
  );
}
```

- [ ] Edit the top of `src/components/Dashboard.tsx` (post-Phase-1 state) additively:
  - Add `import FilterBar, { type ToolFilter } from "./FilterBar";` alongside the existing component imports.
  - Delete the now-unused `import type { Tool } from "../lib/normalize";` line and the local `type ToolFilter = Tool | "all";` declaration.
  - **Leave every Phase 1 addition untouched:** the `import type { DashboardData } from "../lib/aggregate";`, `import Tips from "./Tips";`, `import RetentionBanner from "./RetentionBanner";`, the `retention` prop, `useState<DashboardData>`, and `<QuotaPanel data={data} />` all stay exactly as Phase 1 left them. Do NOT reintroduce `import type { Rollups }`.

- [ ] Replace the inline filter-bar JSX in `src/components/Dashboard.tsx` (content-match the `<div className="flex flex-wrap items-center gap-3 text-sm"> … </div>` block that renders the tool buttons and From/To date inputs — do not rely on line numbers) with:

```tsx
<FilterBar
  tool={tool}
  from={from}
  to={to}
  loading={loading}
  onChange={(n) => {
    if (n.tool !== undefined) setTool(n.tool);
    if (n.from !== undefined) setFrom(n.from);
    if (n.to !== undefined) setTo(n.to);
    load(n);
  }}
  onRefresh={() => load({}, true)}
/>
```

- [ ] Run typecheck/build, expect PASS (no unit test harness for islands in this repo): `npm run build` → completes without TypeScript errors.
- [ ] Manual smoke (red→green for paint): `npm run dev`, open `http://localhost:4321/`, confirm the tool buttons and date inputs render and filtering still updates the Overview (unchanged behavior).
- [ ] Commit: `git add src/components/FilterBar.tsx src/components/Dashboard.tsx && git commit -m "refactor(ui): extract shared tool and date filter bar"`

---

### Task 10: Sessions list island + `/sessions` page

**Files:**

- Create: `src/components/SessionsList.tsx`
- Create: `src/pages/sessions/index.astro`

**Interfaces:**

- Consumes: `SessionSummary` from `../lib/normalize`; `FilterBar` + `ToolFilter` from `./FilterBar` (Task 9); `GET /api/sessions` (Task 7); `scan` + `groupSessions` in the page frontmatter.
- Produces: `/sessions` SSR route rendering `SessionsList`.

Steps:

- [ ] Create `src/pages/sessions/index.astro` (this references `SessionsList` before it exists, so it is the failing red gate for the build):

```astro
---
import Layout from '../../layouts/Layout.astro';
import SessionsList from '../../components/SessionsList.tsx';
import { scan } from '../../lib/scan';
import { groupSessions } from '../../lib/sessions';
import { defaultPricing } from '../../lib/pricing';

export const prerender = false;

const { records, sessionMeta } = scan();
const sessions = groupSessions(records, sessionMeta, defaultPricing);
---
<Layout title="Sessions">
  <SessionsList client:load initial={sessions} />
</Layout>
```

- [ ] Run build, expect FAIL: `npm run build` → fails to resolve `../../components/SessionsList.tsx` (module does not exist).

- [ ] Create `src/components/SessionsList.tsx`:

```tsx
// src/components/SessionsList.tsx
import { useState } from "react";
import type { SessionSummary } from "../lib/normalize";
import FilterBar, { type ToolFilter } from "./FilterBar";

const fmtInt = (n: number) => new Intl.NumberFormat("en-US").format(n);
const fmtUsd = (n: number) => `$${n.toFixed(2)}`;

function fmtDuration(ms: number): string {
  if (ms <= 0) return "-";
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function fmtWhen(iso: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleString();
}

type SortKey = "startedAt" | "durationMs" | "turns" | "totalTokens" | "cost";

export default function SessionsList({
  initial,
}: {
  initial: SessionSummary[];
}) {
  const [rows, setRows] = useState<SessionSummary[]>(initial);
  const [tool, setTool] = useState<ToolFilter>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({
    key: "startedAt",
    dir: -1,
  });

  async function load(
    next: { tool?: ToolFilter; from?: string; to?: string } = {},
    refresh = false,
  ) {
    const t = next.tool ?? tool;
    const f = next.from ?? from;
    const u = next.to ?? to;
    setLoading(true);
    try {
      if (refresh) await fetch("/api/refresh", { method: "POST" });
      const params = new URLSearchParams();
      if (t !== "all") params.set("tool", t);
      if (f) params.set("from", f);
      if (u) params.set("to", u);
      const res = await fetch(`/api/sessions?${params.toString()}`);
      if (!res.ok) throw new Error(`sessions request failed: ${res.status}`);
      setRows(await res.json());
    } finally {
      setLoading(false);
    }
  }

  const sorted = [...rows].sort((a, b) => {
    const k = sort.key;
    const av = k === "startedAt" ? a.startedAt : (a[k] as number);
    const bv = k === "startedAt" ? b.startedAt : (b[k] as number);
    if (av < bv) return -1 * sort.dir;
    if (av > bv) return 1 * sort.dir;
    return 0;
  });

  function toggleSort(k: SortKey) {
    setSort((s) =>
      s.key === k ? { key: k, dir: s.dir === 1 ? -1 : 1 } : { key: k, dir: -1 },
    );
  }

  return (
    <div className="space-y-6">
      <FilterBar
        tool={tool}
        from={from}
        to={to}
        loading={loading}
        onChange={(n) => {
          if (n.tool !== undefined) setTool(n.tool);
          if (n.from !== undefined) setFrom(n.from);
          if (n.to !== undefined) setTo(n.to);
          load(n);
        }}
        onRefresh={() => load({}, true)}
      />
      <p className="text-xs text-neutral-500">
        Costs are notional, computed at public API rates.
      </p>
      <div className="overflow-x-auto rounded-xl bg-neutral-900">
        <table className="w-full text-sm">
          <thead className="text-neutral-400">
            <tr>
              <th className="text-left p-3">Session</th>
              <th className="text-left p-3">Models</th>
              <Th
                label="Started"
                k="startedAt"
                sort={sort}
                onSort={toggleSort}
              />
              <Th
                label="Duration"
                k="durationMs"
                sort={sort}
                onSort={toggleSort}
              />
              <Th label="Turns" k="turns" sort={sort} onSort={toggleSort} />
              <Th
                label="Tokens"
                k="totalTokens"
                sort={sort}
                onSort={toggleSort}
              />
              <Th label="Cost" k="cost" sort={sort} onSort={toggleSort} />
              <th className="text-left p-3">Compaction</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => (
              <tr
                key={s.key}
                className="border-t border-neutral-800 hover:bg-neutral-800/50"
              >
                <td className="p-3">
                  <a
                    className="text-blue-400 hover:underline"
                    href={`/sessions/${encodeURIComponent(s.key)}`}
                  >
                    {s.project} · {s.tool}
                  </a>
                </td>
                <td className="p-3 text-neutral-300">
                  {s.models.join(", ") || "-"}
                </td>
                <td className="p-3 text-neutral-300">{fmtWhen(s.startedAt)}</td>
                <td className="p-3 text-neutral-300">
                  {fmtDuration(s.durationMs)}
                </td>
                <td className="p-3 text-neutral-300">{s.turns}</td>
                <td className="p-3 text-neutral-300">
                  {fmtInt(s.totalTokens)}
                </td>
                <td className="p-3 text-neutral-300">
                  {s.unpriced ? "unpriced" : fmtUsd(s.cost)}
                </td>
                <td className="p-3">
                  {s.compaction ? (
                    <span className="rounded bg-amber-500/20 text-amber-400 px-2 py-0.5 text-xs">
                      {s.compaction.full + s.compaction.micro}×
                    </span>
                  ) : (
                    <span className="text-neutral-600">-</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length === 0 && (
        <p className="text-neutral-400">No sessions found.</p>
      )}
    </div>
  );
}

function Th({
  label,
  k,
  sort,
  onSort,
}: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; dir: 1 | -1 };
  onSort: (k: SortKey) => void;
}) {
  const active = sort.key === k;
  return (
    <th
      className="text-left p-3 cursor-pointer select-none"
      onClick={() => onSort(k)}
    >
      {label}
      {active ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
    </th>
  );
}
```

- [ ] Run build, expect PASS: `npm run build` → completes without errors.
- [ ] Manual smoke (paint): `npm run dev`, open `http://localhost:4321/sessions`, confirm rows render, column headers sort, the tool/date filter refetches, and sessions with compaction show an amber badge; click a row and confirm it navigates to `/sessions/<key>` (the URL-encoded `${tool}:${sessionId}` composite key).
- [ ] Commit: `git add src/components/SessionsList.tsx src/pages/sessions/index.astro && git commit -m "feat(ui): add sessions list page with sortable columns and compaction flag"`

---

### Task 11: Session detail island + `/sessions/[id]` page

**Files:**

- Create: `src/components/SessionDetail.tsx`
- Create: `src/pages/sessions/[id].astro`

**Interfaces:**

- Consumes: `SessionDetail` (type), `Message`, `truncate` from `../lib/normalize`; `scan`, `groupSessions`, `parseClaudeMessages`, `parseCodexMessages` in the page frontmatter.
- Produces: `/sessions/[id]` SSR route rendering `SessionDetail`; 404 Response when the id is unknown or the file is corrupt.

Steps:

- [ ] Create `src/pages/sessions/[id].astro` (references `SessionDetail` before it exists, the failing red gate):

```astro
---
import Layout from '../../layouts/Layout.astro';
import SessionDetail from '../../components/SessionDetail.tsx';
import { scan } from '../../lib/scan';
import { groupSessions } from '../../lib/sessions';
import { defaultPricing } from '../../lib/pricing';
import { parseClaudeMessages } from '../../lib/parsers/claude-messages';
import { parseCodexMessages } from '../../lib/parsers/codex-messages';
import type { SessionDetail as SessionDetailData } from '../../lib/normalize';

export const prerender = false;

// Astro's `[id]` param is the composite route key `${tool}:${sessionId}`. Decode
// defensively so a percent-encoded `${tool}%3A${sessionId}` link also resolves
// (decodeURIComponent is a no-op on an already-decoded value).
const rawKey = Astro.params.id;
const key = rawKey ? decodeURIComponent(rawKey) : undefined;
const { records, sessionMeta, sessionIndex } = scan();

let detail: SessionDetailData | null = null;
const entry = key ? sessionIndex.get(key) : undefined;
if (entry) {
  try {
    let messages =
      entry.tool === 'claude'
        ? entry.files.flatMap((file) => parseClaudeMessages(file))
        : entry.files.flatMap((file) =>
            parseCodexMessages(file, entry.sessionId),
          );
    messages.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    messages = messages.map((m, i) => ({ ...m, index: i }));
    const summary = groupSessions(records, sessionMeta, defaultPricing).find(
      (s) => s.key === key,
    );
    if (summary) detail = { summary, messages };
  } catch {
    detail = null;
  }
}

if (!detail) {
  return new Response('Session not found', { status: 404 });
}
---
<Layout title="Session">
  <SessionDetail client:load detail={detail} />
</Layout>
```

- [ ] Run build, expect FAIL: `npm run build` → fails to resolve `../../components/SessionDetail.tsx` (module does not exist).

- [ ] Create `src/components/SessionDetail.tsx`:

```tsx
// src/components/SessionDetail.tsx
import { useState } from "react";
import {
  truncate,
  type Message,
  type SessionDetail as SessionDetailData,
} from "../lib/normalize";

const fmtInt = (n: number) => new Intl.NumberFormat("en-US").format(n);
const fmtUsd = (n: number) => `$${n.toFixed(2)}`;

function fmtDuration(ms: number): string {
  if (ms <= 0) return "-";
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export default function SessionDetail({
  detail,
}: {
  detail: SessionDetailData;
}) {
  const { summary, messages } = detail;
  return (
    <div className="space-y-6">
      <a href="/sessions" className="text-blue-400 hover:underline text-sm">
        ← Sessions
      </a>
      <div className="grid md:grid-cols-[1fr_280px] gap-6">
        <div className="space-y-4">
          <p className="text-xs text-neutral-500">
            Costs are notional, computed at public API rates.
          </p>
          {messages.map((m) => (
            <MessageRow key={m.index} m={m} />
          ))}
          {messages.length === 0 && (
            <p className="text-neutral-400">No messages in this session.</p>
          )}
        </div>
        <aside className="space-y-4">
          <Sidebar summary={summary} />
        </aside>
      </div>
    </div>
  );
}

function MessageRow({ m }: { m: Message }) {
  const [open, setOpen] = useState(false);

  if (m.compaction) {
    return (
      <div className="rounded border border-amber-500/40 bg-amber-500/10 text-amber-300 px-3 py-2 text-xs">
        {m.compaction === "full" ? "Full compaction" : "Micro compaction"}
        {m.text ? ` — ${truncate(m.text, 120)}` : ""}
      </div>
    );
  }

  const long = m.text.length > 300;
  const shown = open || !long ? m.text : truncate(m.text, 300);
  return (
    <div
      className={`rounded-xl p-3 ${m.role === "user" ? "bg-neutral-800" : "bg-neutral-900"}`}
    >
      <div className="flex items-center justify-between text-xs text-neutral-400 mb-1">
        <span>
          {m.role}
          {m.model ? ` · ${m.model}` : ""}
        </span>
        <span>
          {typeof m.tokens === "number" ? `${fmtInt(m.tokens)} tok` : ""}
        </span>
      </div>
      <div className="whitespace-pre-wrap text-sm text-neutral-100">
        {shown || <span className="text-neutral-500">(no text)</span>}
      </div>
      {long && (
        <button
          onClick={() => setOpen((o) => !o)}
          className="mt-1 text-xs text-blue-400"
        >
          {open ? "Show less" : "Show more"}
        </button>
      )}
      {m.toolUses.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {m.toolUses.map((t, i) => (
            <span
              key={i}
              className="rounded bg-neutral-700 text-neutral-200 px-2 py-0.5 text-xs"
            >
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Sidebar({ summary }: { summary: SessionDetailData["summary"] }) {
  return (
    <div className="rounded-xl bg-neutral-900 p-4 space-y-3 text-sm">
      <h2 className="text-base font-medium">
        {summary.project} · {summary.tool}
      </h2>
      <Row label="Turns" value={String(summary.turns)} />
      <Row label="Tool calls" value={String(summary.toolCalls)} />
      <Row label="Duration" value={fmtDuration(summary.durationMs)} />
      <Row label="Input" value={fmtInt(summary.tokens.input)} />
      <Row label="Output" value={fmtInt(summary.tokens.output)} />
      <Row label="Cache write" value={fmtInt(summary.tokens.cacheWrite)} />
      <Row label="Cache read" value={fmtInt(summary.tokens.cacheRead)} />
      <Row label="Total tokens" value={fmtInt(summary.totalTokens)} />
      <Row
        label="Cost"
        value={summary.unpriced ? "unpriced" : fmtUsd(summary.cost)}
      />
      <div>
        <div className="text-neutral-400">Models</div>
        <div className="text-neutral-200">
          {summary.models.join(", ") || "-"}
        </div>
      </div>
      {summary.compaction && (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-300">
          Compaction: {summary.compaction.full} full ·{" "}
          {summary.compaction.micro} micro ·{" "}
          {fmtInt(summary.compaction.tokensSaved)} tokens saved
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-neutral-400">{label}</span>
      <span className="text-neutral-200">{value}</span>
    </div>
  );
}
```

- [ ] Run build, expect PASS: `npm run build` → completes without errors.
- [ ] Manual smoke (paint): `npm run dev`; from `/sessions` click a Claude session with a compaction badge, confirm the replay shows user/assistant messages, tool_use badges, per-message model+tokens, an amber compaction divider inline, and the sidebar token breakdown + compaction summary; open a Codex session and confirm messages + tool badges render with no compaction section; visit `/sessions/does-not-exist` and confirm a 404 response.
- [ ] Commit: `git add src/components/SessionDetail.tsx "src/pages/sessions/[id].astro" && git commit -m "feat(ui): add session detail replay with sidebar and compaction timeline"`

---

### Task 12: Top navigation (Overview / Sessions)

**Files:**

- Modify: `src/layouts/Layout.astro` (the `<main>…</main>` region — matched by content, not by line number, so `</body>` is never swallowed).

**Interfaces:**

- Consumes: nothing new.
- Produces: a shared top nav rendered on every page that uses `Layout`.

Steps:

- [ ] Content-match the `<main>…</main>` region in `src/layouts/Layout.astro` — the block that opens with `<main class="max-w-6xl mx-auto px-6 py-8 space-y-8">`, contains `<h1 class="text-2xl font-semibold">Usage Tracker</h1>` and `<slot />`, and closes with `</main>` — and replace exactly that block (do NOT use line numbers; the line after `</main>` is `</body>`, which must stay untouched) with:

```astro
    <main class="max-w-6xl mx-auto px-6 py-8 space-y-8">
      <div class="flex items-center justify-between">
        <h1 class="text-2xl font-semibold">Usage Tracker</h1>
        <nav class="flex gap-4 text-sm">
          <a href="/" class="text-neutral-300 hover:text-white">Overview</a>
          <a href="/sessions" class="text-neutral-300 hover:text-white">Sessions</a>
        </nav>
      </div>
      <slot />
    </main>
```

- [ ] Run build, expect PASS: `npm run build` → completes without errors.
- [ ] Manual smoke (paint): `npm run dev`, confirm the Overview/Sessions nav appears on `/`, `/sessions`, and `/sessions/<id>`, and that both links navigate correctly.
- [ ] Run the full suite one final time, expect PASS: `npx vitest run` → all green.
- [ ] Commit: `git add src/layouts/Layout.astro && git commit -m "feat(ui): add top navigation between overview and sessions"`

---

## Implementation-time hardening (required)

These edge cases come from real `~/.claude` and `~/.codex` history that hand-authored fixtures alone miss. Each affects the accuracy that is this tool's whole point, so satisfy each WHILE implementing the tasks above — validating against real local files, not only the fixtures. Each gets a canonical-pinned test.

1. **Codex tool-call coverage** — `codex-messages.ts` + `codex.ts` must count/label ALL real Codex tool payloads, not just `function_call`: also `custom_tool_call`, `web_search_call`, `tool_search_call`, and event-side completions (`mcp_tool_call_end`, `patch_apply_end`). Extract one shared `codexToolName(payload): string | null` helper used by BOTH parsers; add a fixture line per type; assert `SessionMeta.toolCalls` and `Message.toolUses` include them. (Real sample: 969 `web_search_call`, 63 `custom_tool_call` — silently dropped today.)
2. **Codex user-dedup scope** — dedupe a `response_item` user against `event_msg.user_message` ONLY within the open turn (track `hasUserInTurn`, reset when an assistant closes the turn). A genuinely repeated identical prompt in a LATER turn must NOT be dropped. Fixture: two identical consecutive prompts in separate turns → assert both survive.
3. **Claude split-usage last-wins** — real split `message.id` groups have NON-identical usage across lines (the final line is the complete value). Add a fixture where usage grows across the split lines and assert the merged record/message uses the FINAL (complete) usage, counted once.
4. **`Message.toolUses` dedup** — dedupe tool names within one assistant turn (`pushUnique`) so repeats don't produce duplicate badges; keep `SessionMeta.toolCalls` as the RAW call count (duplicates counted).
5. **Shared session-detail loader** — extract `loadSessionDetail(key)` (scan → index lookup → parse all files → sort → reindex → match summary) into one server helper used by BOTH `/api/sessions/[id].ts` and `/sessions/[id].astro`, so the logic cannot drift.
6. **Codex compaction scope (decision)** — Codex history DOES emit `compacted` / `context_compacted` events, so "no equivalent" is not literally true. v1 intentionally does NOT surface Codex compaction (it lacks Claude's tokens-saved and per-turn marker semantics); document this with a comment in `codex-messages.ts` and add a test asserting Codex sessions carry no `compaction` field. A Codex-only count (no tokens-saved) is a noted future enhancement.
