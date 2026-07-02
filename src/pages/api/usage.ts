// src/pages/api/usage.ts
import type { APIRoute } from "astro";
import { scan } from "../../lib/scan";
import { applyFilters } from "../../lib/filters";
import { aggregate, claudeWindows } from "../../lib/aggregate";
import { peakHours, calendarGrid } from "../../lib/charts";
import { defaultPricing } from "../../lib/pricing";
import { buildForecast } from "../../lib/forecast";
import { buildTips } from "../../lib/tips";

export const prerender = false;

export const GET: APIRoute = ({ url }) => {
  const now = Date.now();
  const { records, codexQuota } = scan();
  // Windows, forecast, and tips reflect current account state (unfiltered).
  const windows = claudeWindows(records, now);
  const forecast = buildForecast(records, codexQuota, now);
  const tips = buildTips(records, forecast, defaultPricing);
  const filtered = applyFilters(records, url.searchParams);
  const rollups = aggregate(filtered, codexQuota, defaultPricing, windows);
  const body = {
    ...rollups,
    forecast,
    tips,
    peakHours: peakHours(filtered),
    calendar: calendarGrid(rollups.byDay, now),
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
