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

import type { DayPoint } from "./aggregate";

export interface CalendarDay {
  date: string;
  claudeTokens: number;
  codexTokens: number;
  total: number;
}

const DAY_MS = 86400000;
const utcDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

// Continuous daily grid (UTC) so the heatmap has no holes. Spans the earliest
// byDay date through the later of the last byDay date and today (from nowMs).
export function calendarGrid(byDay: DayPoint[], nowMs: number): CalendarDay[] {
  if (byDay.length === 0) return [];
  const sorted = [...byDay].sort((a, b) => a.date.localeCompare(b.date));
  const start = sorted[0].date;
  const lastData = sorted[sorted.length - 1].date;
  const today = utcDate(nowMs);
  const end = today > lastData ? today : lastData;
  const map = new Map(sorted.map((d) => [d.date, d]));

  const out: CalendarDay[] = [];
  const endMs = Date.parse(`${end}T00:00:00.000Z`);
  for (let t = Date.parse(`${start}T00:00:00.000Z`); t <= endMs; t += DAY_MS) {
    const date = utcDate(t);
    const d = map.get(date);
    const claudeTokens = d?.claudeTokens ?? 0;
    const codexTokens = d?.codexTokens ?? 0;
    out.push({
      date,
      claudeTokens,
      codexTokens,
      total: claudeTokens + codexTokens,
    });
  }
  return out;
}

import type { DashboardData } from "./aggregate";

// Everything a page-content island renders: the dashboard rollups plus the two
// chart-only aggregates that need raw records / byDay to compute.
export interface BoardData extends DashboardData {
  peakHours: number[];
  calendar: CalendarDay[];
}
