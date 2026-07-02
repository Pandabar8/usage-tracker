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
