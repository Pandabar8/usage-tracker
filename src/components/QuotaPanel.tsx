// src/components/QuotaPanel.tsx
import type { Rollups } from "../lib/aggregate";
import type { ClaudeWindows, RateLimitWindow } from "../lib/normalize";

const fmtTokens = (n: number) => new Intl.NumberFormat().format(n);

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

function Row({ label, tokens }: { label: string; tokens: number }) {
  return (
    <div className="flex justify-between text-sm text-neutral-400">
      <span>{label}</span>
      <span className="text-neutral-200">{fmtTokens(tokens)} tokens</span>
    </div>
  );
}

function ClaudeLimits({ w }: { w: ClaudeWindows }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-neutral-300">Claude</h3>
      <Row label="Last 5 hours" tokens={w.fiveHourTokens} />
      <Row label="Last 7 days" tokens={w.sevenDayTokens} />
      <p className="text-xs text-neutral-500">
        No server-side limit reported by Claude; shown from token volume.
        {w.asOf ? ` As of ${new Date(w.asOf).toLocaleString()}.` : ""}
      </p>
    </div>
  );
}

function CodexLimits({ q }: { q: Rollups["codexQuota"] }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-neutral-300">Codex</h3>
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
    </div>
  );
}

export default function QuotaPanel({ data }: { data: Rollups }) {
  return (
    <section className="rounded-xl bg-neutral-900 p-4 space-y-3">
      <h2 className="text-lg font-medium">Usage limits</h2>
      <div className="grid sm:grid-cols-2 gap-6">
        <ClaudeLimits w={data.claudeWindows} />
        <CodexLimits q={data.codexQuota} />
      </div>
    </section>
  );
}
