// src/lib/filters.ts
import type { Tool, UsageRecord } from "./normalize";

export function applyFilters(
  records: UsageRecord[],
  params: URLSearchParams,
): UsageRecord[] {
  const tool = params.get("tool") as Tool | null;
  const from = params.get("from"); // YYYY-MM-DD inclusive
  const to = params.get("to"); // YYYY-MM-DD inclusive

  return records.filter((r) => {
    if (tool && r.tool !== tool) return false;
    const date = r.timestamp.slice(0, 10);
    if (from && date < from) return false;
    if (to && date > to) return false;
    return true;
  });
}
