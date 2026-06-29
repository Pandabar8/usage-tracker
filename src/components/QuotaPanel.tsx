// src/components/QuotaPanel.tsx
import type { Rollups } from "../lib/aggregate";
import type { RateLimitWindow } from "../lib/normalize";

function Bar({ label, w }: { label: string; w: RateLimitWindow | null }) {
  if (!w) return null;
  const resets = new Date(w.resetsAt * 1000).toLocaleString();
  return (
    <div>
      <div className="flex justify-between text-sm text-neutral-400">
        <span>{label}</span>
        <span>
          {w.usedPercent.toFixed(0)}% · resets {resets}
        </span>
      </div>
      <div className="h-2 bg-neutral-800 rounded mt-1">
        <div
          className="h-2 bg-amber-500 rounded"
          style={{ width: `${Math.min(100, w.usedPercent)}%` }}
        />
      </div>
    </div>
  );
}

export default function QuotaPanel({ data }: { data: Rollups }) {
  const q = data.codexQuota;
  return (
    <section className="rounded-xl bg-neutral-900 p-4 space-y-3">
      <h2 className="text-lg font-medium">Codex quota</h2>
      {q ? (
        <>
          <Bar label="5h window" w={q.primary} />
          <Bar label="Weekly window" w={q.secondary} />
        </>
      ) : (
        <div className="text-sm text-neutral-400">
          No Codex quota data found.
        </div>
      )}
    </section>
  );
}
