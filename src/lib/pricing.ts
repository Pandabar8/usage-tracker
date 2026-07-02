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

// Claude models are logged with a trailing -YYYYMMDD release date
// (e.g. "claude-haiku-4-5-20251001") while the table is keyed by the base name.
// Try an exact match first, then the name with a trailing 8-digit date stripped.
const DATE_SUFFIX = /-\d{8}$/;

function resolveRate(model: string, table: PricingTable): Rate | undefined {
  return table[model] ?? table[model.replace(DATE_SUFFIX, "")];
}

export function isPriced(
  model: string,
  table: PricingTable = defaultPricing,
): boolean {
  const r = resolveRate(model, table);
  if (!r) return false;
  return r.input > 0 || r.output > 0 || r.cacheWrite > 0 || r.cacheRead > 0;
}

export function cost(
  r: UsageRecord,
  table: PricingTable = defaultPricing,
): number {
  const rate = resolveRate(r.model, table);
  if (!rate) return 0;
  return (
    (r.inputTokens * rate.input +
      r.outputTokens * rate.output +
      r.cacheWriteTokens * rate.cacheWrite +
      r.cacheReadTokens * rate.cacheRead) /
    1_000_000
  );
}
