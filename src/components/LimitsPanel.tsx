// src/components/LimitsPanel.tsx
import type { DashboardData } from "../lib/aggregate";
import type { RateLimitWindow, WindowForecast } from "../lib/normalize";
import { fmtTokens } from "../lib/format";

function CodexRow({ label, w }: { label: string; w: RateLimitWindow | null }) {
  if (!w)
    return (
      <div className="qrow">
        <span className="qlab">{label}</span>
        <span className="qmeta">no data</span>
      </div>
    );
  const pct = Math.min(100, w.usedPercent);
  const resets = new Date(w.resetsAt * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <div className="qrow">
      <span className="qlab">{label}</span>
      <div className="qbar bar" style={{ height: 8 }}>
        <i
          style={{
            width: `${pct}%`,
            background: "linear-gradient(90deg,var(--codex),var(--codex-2))",
          }}
        />
      </div>
      <span className="qmeta">
        {Math.round(w.usedPercent)}% · resets {resets}
      </span>
    </div>
  );
}

function ClaudeRow({
  label,
  tokens,
  width,
}: {
  label: string;
  tokens: number;
  width: number;
}) {
  return (
    <div className="qrow">
      <span className="qlab">{label}</span>
      <div className="qbar bar" style={{ height: 8 }}>
        <i
          style={{
            width: `${width}%`,
            background: "linear-gradient(90deg,var(--claude),var(--claude-2))",
          }}
        />
      </div>
      <span className="qmeta">{fmtTokens(tokens)} tokens</span>
    </div>
  );
}

function ForecastLine({ f }: { f?: WindowForecast }) {
  if (!f || f.projectedPercentAtReset == null) return null;
  return (
    <div className="forecast">
      ▲ projected {Math.round(f.projectedPercentAtReset)}% by weekly reset at
      current pace
    </div>
  );
}

export default function LimitsPanel({ data }: { data: DashboardData }) {
  const w = data.claudeWindows;
  const weekly = w.sevenDayTokens;
  const fiveWidth =
    weekly > 0
      ? Math.min(100, Math.round((w.fiveHourTokens / weekly) * 100))
      : 0;
  const weeklyWidth = weekly > 0 ? 100 : 0;
  const q = data.codexQuota;

  return (
    <div className="card">
      <div className="qgroup">
        <div className="qhead">
          <span className="sw" style={{ background: "var(--claude)" }} />
          Claude
          <span className="qsub">
            rolling token volume — no server-side limit
          </span>
        </div>
        <ClaudeRow
          label="5h window"
          tokens={w.fiveHourTokens}
          width={fiveWidth}
        />
        <ClaudeRow label="Weekly" tokens={weekly} width={weeklyWidth} />
      </div>
      <div className="qgroup">
        <div className="qhead">
          <span className="sw" style={{ background: "var(--codex)" }} />
          Codex
          <span className="qsub">server-reported quota</span>
        </div>
        {q ? (
          <>
            <CodexRow label="5h window" w={q.primary} />
            <CodexRow label="Weekly" w={q.secondary} />
            <ForecastLine f={data.forecast.codexSecondary} />
          </>
        ) : (
          <div className="qrow">
            <span className="qlab">Weekly</span>
            <span className="qmeta">No Codex quota data found.</span>
          </div>
        )}
      </div>
      <div className="note">
        Codex percentages are server-reported. Claude exposes no server-side
        limit, so its 5h/weekly bars are token <b>volume</b> relative to your
        own recent peak, not a quota.
      </div>
    </div>
  );
}
