// src/components/QuotaPanel.tsx
import type { DashboardData } from "../lib/aggregate";
import type {
  ClaudeWindows,
  Forecast,
  RateLimitWindow,
  VolumeForecast,
  WindowForecast,
} from "../lib/normalize";

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

function CodexForecastLine({ f }: { f?: WindowForecast }) {
  if (!f || f.projectedPercentAtReset == null) return null;
  const pct = Math.round(f.projectedPercentAtReset);
  return (
    <div
      className={`text-xs mt-1 ${f.willExhaust ? "text-amber-400" : "text-neutral-500"}`}
    >
      Projected {pct}% by reset
      {f.willExhaust && f.etaToLimit
        ? ` · limit ~${new Date(f.etaToLimit).toLocaleString()}`
        : ""}
    </div>
  );
}

function ClaudeForecastLine({
  label,
  v,
}: {
  label: string;
  v?: VolumeForecast;
}) {
  if (!v || v.projectedTokens == null) return null;
  return (
    <div className="text-xs text-neutral-500">
      {label}: ~{fmtTokens(v.projectedTokens)} tokens projected
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

function ClaudeLimits({ w, f }: { w: ClaudeWindows; f: Forecast }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-neutral-300">Claude</h3>
      <Row label="Last 5 hours" tokens={w.fiveHourTokens} />
      <ClaudeForecastLine label="5h projection" v={f.claudeFiveHour} />
      <Row label="Last 7 days" tokens={w.sevenDayTokens} />
      <ClaudeForecastLine label="7d projection" v={f.claudeSevenDay} />
      <p className="text-xs text-neutral-500">
        No server-side limit reported by Claude; shown from token volume.
        {w.asOf ? ` As of ${new Date(w.asOf).toLocaleString()}.` : ""}
      </p>
    </div>
  );
}

function CodexLimits({
  q,
  f,
}: {
  q: DashboardData["codexQuota"];
  f: Forecast;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-neutral-300">Codex</h3>
      {q ? (
        <>
          <div>
            <Bar label="5h window" w={q.primary} />
            <CodexForecastLine f={f.codexPrimary} />
          </div>
          <div>
            <Bar label="Weekly window" w={q.secondary} />
            <CodexForecastLine f={f.codexSecondary} />
          </div>
        </>
      ) : (
        <div className="text-sm text-neutral-400">
          No Codex quota data found.
        </div>
      )}
    </div>
  );
}

export default function QuotaPanel({ data }: { data: DashboardData }) {
  return (
    <section className="rounded-xl bg-neutral-900 p-4 space-y-3">
      <h2 className="text-lg font-medium">Usage limits</h2>
      <div className="grid sm:grid-cols-2 gap-6">
        <ClaudeLimits w={data.claudeWindows} f={data.forecast} />
        <CodexLimits q={data.codexQuota} f={data.forecast} />
      </div>
    </section>
  );
}
