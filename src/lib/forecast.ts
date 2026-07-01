// src/lib/forecast.ts
import {
  totalTokens,
  type Forecast,
  type RateLimitSnapshot,
  type RateLimitWindow,
  type UsageRecord,
  type VolumeForecast,
  type WindowForecast,
} from "./normalize";

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// Codex reports server-authoritative used_percent AS OF the snapshot's timestamp,
// for a window that resets at a known time. We linearly project the end-of-window
// percent from the fraction of the window elapsed AT THE SNAPSHOT — not `now`. The
// percent has not changed since the snapshot, so anchoring elapsed to `now` would
// understate the projection as the snapshot ages (downward drift). A snapshot whose
// window has already reset in real time (now >= resetsAt) is stale: no projection.
function forecastWindow(
  w: RateLimitWindow,
  snapshotMs: number,
  nowMs: number,
): WindowForecast {
  const insufficient: WindowForecast = {
    willExhaust: false,
    projectedPercentAtReset: null,
    etaToLimit: null,
  };
  const windowMs = w.windowMinutes * 60_000;
  const resetsAtMs = w.resetsAt * 1000; // resetsAt is UNIX seconds
  if (windowMs <= 0 || resetsAtMs <= 0) return insufficient;
  // Stale: the window has reset since this snapshot was recorded.
  if (nowMs >= resetsAtMs) return insufficient;

  const windowStartMs = resetsAtMs - windowMs;
  const elapsedMs = snapshotMs - windowStartMs; // elapsed AT THE SNAPSHOT
  const elapsedFraction = elapsedMs / windowMs;
  // Right after a reset (fraction ~0) or a bad snapshot (fraction >1): no honest
  // projection. Never fabricate a number.
  if (!(elapsedFraction > 0 && elapsedFraction <= 1)) return insufficient;

  const projected = w.usedPercent / elapsedFraction;
  const willExhaust = projected >= 100;
  let etaToLimit: string | null = null;
  if (willExhaust && w.usedPercent > 0) {
    const crossMs = windowStartMs + (100 / w.usedPercent) * elapsedMs;
    etaToLimit = new Date(crossMs).toISOString();
  }
  return { willExhaust, projectedPercentAtReset: projected, etaToLimit };
}

// Claude reports no server limit, so we project rolling token VOLUME: measure the
// burn rate over recent activity in the window and extrapolate to a full window.
function volumeForecast(
  records: UsageRecord[],
  nowMs: number,
  windowMs: number,
): VolumeForecast {
  let tokens = 0;
  let earliest = Infinity;
  for (const r of records) {
    if (r.tool !== "claude" || !r.timestamp) continue;
    const t = Date.parse(r.timestamp);
    if (Number.isNaN(t)) continue;
    const age = nowMs - t;
    if (age < 0 || age > windowMs) continue;
    tokens += totalTokens(r);
    if (t < earliest) earliest = t;
  }
  if (tokens === 0 || earliest === Infinity) {
    return { projectedTokens: null, note: "no recent Claude activity" };
  }
  const spanMs = nowMs - earliest;
  if (spanMs <= 0) {
    return { projectedTokens: null, note: "insufficient time span" };
  }
  const projected = Math.round((tokens / spanMs) * windowMs);
  return { projectedTokens: projected, note: "no limit, volume projection" };
}

export function buildForecast(
  records: UsageRecord[],
  codexQuota: RateLimitSnapshot | null,
  nowMs: number,
): Forecast {
  const forecast: Forecast = {
    claudeFiveHour: volumeForecast(records, nowMs, FIVE_HOURS_MS),
    claudeSevenDay: volumeForecast(records, nowMs, SEVEN_DAYS_MS),
  };
  // Codex percent is as-of the snapshot's timestamp; anchor elapsed to it.
  const snapshotMs = codexQuota ? Date.parse(codexQuota.timestamp) : NaN;
  if (codexQuota?.primary && !Number.isNaN(snapshotMs)) {
    forecast.codexPrimary = forecastWindow(
      codexQuota.primary,
      snapshotMs,
      nowMs,
    );
  }
  if (codexQuota?.secondary && !Number.isNaN(snapshotMs)) {
    forecast.codexSecondary = forecastWindow(
      codexQuota.secondary,
      snapshotMs,
      nowMs,
    );
  }
  return forecast;
}
