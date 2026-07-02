// src/lib/filter-bus.ts
export type ToolFilter = "all" | "claude" | "codex";

export interface FilterState {
  tool: ToolFilter;
  from: string;
  to: string;
}

export const FILTER_EVENT = "usage:filter";

export function readFilter(): FilterState {
  const p = new URLSearchParams(window.location.search);
  const raw = p.get("tool");
  const tool: ToolFilter = raw === "claude" || raw === "codex" ? raw : "all";
  return { tool, from: p.get("from") ?? "", to: p.get("to") ?? "" };
}

export function toQuery(f: FilterState): string {
  const p = new URLSearchParams();
  if (f.tool !== "all") p.set("tool", f.tool);
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  return p.toString();
}

export function writeFilter(next: Partial<FilterState>): FilterState {
  const merged: FilterState = { ...readFilter(), ...next };
  const qs = toQuery(merged);
  window.history.replaceState(
    null,
    "",
    qs ? `?${qs}` : window.location.pathname,
  );
  window.dispatchEvent(
    new CustomEvent<FilterState>(FILTER_EVENT, { detail: merged }),
  );
  return merged;
}

export function onFilter(cb: (f: FilterState) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<FilterState>).detail);
  window.addEventListener(FILTER_EVENT, handler);
  return () => window.removeEventListener(FILTER_EVENT, handler);
}
