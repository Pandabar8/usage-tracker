// src/lib/charts.ts
import type { UsageRecord } from "./normalize";

// Length-24 histogram of records by local hour-of-day. Assistant-turn count =
// record count; tool-agnostic. Records without a parseable timestamp are skipped.
export function peakHours(records: UsageRecord[]): number[] {
  const hours = new Array<number>(24).fill(0);
  for (const r of records) {
    if (!r.timestamp) continue;
    const t = new Date(r.timestamp);
    if (Number.isNaN(t.getTime())) continue;
    hours[t.getHours()] += 1;
  }
  return hours;
}
