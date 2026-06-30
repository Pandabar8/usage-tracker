// src/pages/api/refresh.ts
import type { APIRoute } from "astro";
import { scan } from "../../lib/scan";
import { clearCache } from "../../lib/cache";
import { aggregate, claudeWindows } from "../../lib/aggregate";
import { defaultPricing } from "../../lib/pricing";

export const prerender = false;

export const POST: APIRoute = () => {
  clearCache();
  const { records, codexQuota } = scan();
  const rollups = aggregate(
    records,
    codexQuota,
    defaultPricing,
    claudeWindows(records, Date.now()),
  );
  return new Response(JSON.stringify(rollups), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
