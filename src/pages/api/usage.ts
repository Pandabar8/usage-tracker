// src/pages/api/usage.ts
import type { APIRoute } from "astro";
import { scan } from "../../lib/scan";
import { applyFilters } from "../../lib/filters";
import { aggregate, claudeWindows } from "../../lib/aggregate";
import { defaultPricing } from "../../lib/pricing";

export const prerender = false;

export const GET: APIRoute = ({ url }) => {
  const { records, codexQuota } = scan();
  // Compute the rolling Claude windows from the UNFILTERED records so the limits
  // panel reflects current state regardless of the tool/date filter (matching codexQuota).
  const windows = claudeWindows(records, Date.now());
  const filtered = applyFilters(records, url.searchParams);
  const rollups = aggregate(filtered, codexQuota, defaultPricing, windows);
  return new Response(JSON.stringify(rollups), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
