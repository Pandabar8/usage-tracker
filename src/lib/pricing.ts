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
