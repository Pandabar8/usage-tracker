// src/components/Overview.tsx
import type { Rollups } from "../lib/aggregate";

function fmtTokens(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}
function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}
function fmtRange(start: string | null, end: string | null): string {
  if (!start || !end) return "no data";
  return `${start.slice(0, 10)} to ${end.slice(0, 10)}`;
}

export default function Overview({ data }: { data: Rollups }) {
  const cards = [
    { label: "Total tokens", value: fmtTokens(data.totals.combined.tokens) },
    { label: "Estimated cost", value: fmtUsd(data.totals.combined.cost) },
    { label: "Claude tokens", value: fmtTokens(data.totals.claude.tokens) },
    { label: "Codex tokens", value: fmtTokens(data.totals.codex.tokens) },
  ];
  return (
    <section className="space-y-2">
      <div className="text-sm text-neutral-400">
        Date range: {fmtRange(data.dateRange.start, data.dateRange.end)}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl bg-neutral-900 p-4">
            <div className="text-sm text-neutral-400">{c.label}</div>
            <div className="text-2xl font-semibold mt-1">{c.value}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
