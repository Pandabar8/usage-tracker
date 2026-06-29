// src/pages/api/refresh.ts
import type { APIRoute } from "astro";
import { scan } from "../../lib/scan";
import { clearCache } from "../../lib/cache";
import { aggregate } from "../../lib/aggregate";

export const prerender = false;

export const POST: APIRoute = () => {
  clearCache();
  const { records, codexQuota } = scan();
  const rollups = aggregate(records, codexQuota);
  return new Response(JSON.stringify(rollups), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
