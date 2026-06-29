// src/pages/api/usage.ts
import type { APIRoute } from "astro";
import { scan } from "../../lib/scan";
import { applyFilters } from "../../lib/filters";
import { aggregate } from "../../lib/aggregate";

export const prerender = false;

export const GET: APIRoute = ({ url }) => {
  const { records, codexQuota } = scan();
  const filtered = applyFilters(records, url.searchParams);
  const rollups = aggregate(filtered, codexQuota);
  return new Response(JSON.stringify(rollups), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
