// src/lib/tips.ts
import {
  totalTokens,
  type Forecast,
  type Tip,
  type UsageRecord,
  type WindowForecast,
} from "./normalize";
import { cost, defaultPricing, isPriced, type PricingTable } from "./pricing";

const APPROACHING_LIMIT_PCT = 85;
const LOW_CACHE_THRESHOLD = 0.5;
const LOW_CACHE_MIN_INPUT = 10_000;
const SONNET_MODEL = "claude-sonnet-4-6";
const EXPENSIVE_PREFIX = "claude-opus";
const RIGHT_SIZE_MIN_SAVINGS = 0.5;
const SHORT_OUTPUT_SHARE = 0.1;

function approachingTip(
  id: string,
  label: string,
  wf?: WindowForecast,
): Tip | null {
  if (!wf || wf.projectedPercentAtReset == null) return null;
  if (wf.projectedPercentAtReset < APPROACHING_LIMIT_PCT) return null;
  const pct = Math.round(wf.projectedPercentAtReset);
  return {
    id,
    severity: "warn",
    title: `${label} quota approaching limit`,
    detail: `Projected ${pct}% of the ${label} quota by reset at the current pace.`,
  };
}

export function buildTips(
  records: UsageRecord[],
  forecast: Forecast,
  pricing: PricingTable = defaultPricing,
): Tip[] {
  const tips: Tip[] = [];

  const primary = approachingTip(
    "approaching-limit-codex-5h",
    "Codex 5h",
    forecast.codexPrimary,
  );
  if (primary) tips.push(primary);
  const secondary = approachingTip(
    "approaching-limit-codex-weekly",
    "Codex weekly",
    forecast.codexSecondary,
  );
  if (secondary) tips.push(secondary);

  // right-size-model: opus work with little output, priced at sonnet-equivalent.
  const sonnetRate = pricing[SONNET_MODEL];
  if (sonnetRate) {
    let input = 0;
    let output = 0;
    let cacheWrite = 0;
    let cacheRead = 0;
    let total = 0;
    let current = 0;
    for (const r of records) {
      if (!r.model.startsWith(EXPENSIVE_PREFIX)) continue;
      input += r.inputTokens;
      output += r.outputTokens;
      cacheWrite += r.cacheWriteTokens;
      cacheRead += r.cacheReadTokens;
      total += totalTokens(r);
      current += cost(r, pricing);
    }
    if (total > 0) {
      const sonnet =
        (input * sonnetRate.input +
          output * sonnetRate.output +
          cacheWrite * sonnetRate.cacheWrite +
          cacheRead * sonnetRate.cacheRead) /
        1_000_000;
      const savings = current - sonnet;
      const outputShare = output / total;
      if (
        savings >= RIGHT_SIZE_MIN_SAVINGS &&
        outputShare < SHORT_OUTPUT_SHARE
      ) {
        tips.push({
          id: "right-size-model",
          severity: "info",
          title: "Consider a smaller model for short-output work",
          detail: `Opus handled work with little output. The same tokens at Sonnet rates would cost about $${sonnet.toFixed(2)} instead of $${current.toFixed(2)}.`,
          savingsUsd: savings,
        });
      }
    }
  }

  // low-cache: cache-read share of Claude prompt tokens below the threshold,
  // over all recorded activity (deterministic; intentionally not time-windowed).
  let freshInput = 0;
  let claudeCacheRead = 0;
  for (const r of records) {
    if (r.tool !== "claude") continue;
    freshInput += r.inputTokens;
    claudeCacheRead += r.cacheReadTokens;
  }
  const promptSide = freshInput + claudeCacheRead;
  if (promptSide >= LOW_CACHE_MIN_INPUT) {
    const share = claudeCacheRead / promptSide;
    if (share < LOW_CACHE_THRESHOLD) {
      const pct = Math.round(share * 100);
      tips.push({
        id: "low-cache",
        severity: "info",
        title: "Low prompt cache reuse",
        detail: `Only ${pct}% of prompt tokens were served from cache. Reusing context across turns lowers cost.`,
      });
    }
  }

  // unpriced-present: models rendered without a price so cost gaps are visible.
  const unpriced = new Set<string>();
  for (const r of records) {
    if (totalTokens(r) <= 0) continue;
    if (!isPriced(r.model, pricing)) unpriced.add(r.model);
  }
  if (unpriced.size > 0) {
    const models = [...unpriced].sort().join(", ");
    tips.push({
      id: "unpriced-present",
      severity: "info",
      title: "Some models have no pricing",
      detail: `${unpriced.size} model(s) are shown without cost: ${models}. Their spend is not included in totals.`,
    });
  }

  return tips;
}
