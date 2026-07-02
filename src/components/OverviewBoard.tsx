// src/components/OverviewBoard.tsx
import { useEffect, useState } from "react";
import type { BoardData } from "../lib/charts";
import {
  onFilter,
  readFilter,
  toQuery,
  type FilterState,
} from "../lib/filter-bus";
import Overview from "./Overview";
import UsageTrend from "./UsageTrend";
import ModelDonut from "./ModelDonut";
import CacheGauge from "./CacheGauge";
import ActivityHeatmap from "./ActivityHeatmap";
import CostTreemap from "./CostTreemap";
import PeakHours from "./PeakHours";
import LimitsPanel from "./LimitsPanel";
import Tips from "./Tips";

function fmtRange(start: string | null, end: string | null): string {
  if (!start || !end) return "no data";
  return `${start.slice(0, 10)} → ${end.slice(0, 10)}`;
}

// On-disk coverage of Claude history. `claudeStart` is the earliest Claude
// record timestamp (null when there are no Claude records); `protected` is true
// once the retention window has been raised past the risky default.
interface Coverage {
  claudeStart: string | null;
  protected: boolean;
}

export default function OverviewBoard({
  initial,
  coverage,
}: {
  initial: BoardData;
  coverage: Coverage;
}) {
  const [data, setData] = useState<BoardData>(initial);
  const [loading, setLoading] = useState(false);

  async function load(f: FilterState, refresh = false) {
    setLoading(true);
    try {
      if (refresh) await fetch("/api/refresh", { method: "POST" });
      const qs = toQuery(f);
      const res = await fetch(`/api/usage${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw new Error(`usage request failed: ${res.status}`);
      setData(await res.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => onFilter((f) => load(f)), []);

  const toolLabel =
    data.totals.claude.tokens && data.totals.codex.tokens
      ? "All agents"
      : data.totals.codex.tokens
        ? "Codex"
        : "Claude";

  return (
    <>
      <div className="top">
        <div>
          <h1>Overview</h1>
          <div className="sub">
            {toolLabel} ·{" "}
            <span className="mono">
              {fmtRange(data.dateRange.start, data.dateRange.end)}
            </span>{" "}
            · notional cost at API rates
          </div>
        </div>
        <button className="btn" onClick={() => load(readFilter(), true)}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M23 4v6h-6M1 20v-6h6" />
            <path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15" />
          </svg>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {coverage.claudeStart && (
        <p
          className="note"
          style={{ marginTop: 0, marginBottom: 16, color: "var(--muted)" }}
        >
          Claude data from{" "}
          <span className="mono" style={{ color: "var(--faint)" }}>
            {coverage.claudeStart.slice(0, 10)}
          </span>{" "}
          — earlier sessions were purged by Claude Code's 30-day retention
          {coverage.protected
            ? " (now protected)."
            : ". Raise the window in Settings to prevent further loss."}
        </p>
      )}

      <Overview data={data} />

      <div className="grid c2" style={{ marginTop: 16 }}>
        <UsageTrend data={data} />
        <div className="card">
          <h3>Model mix</h3>
          <p className="hint">share of total tokens</p>
          <ModelDonut data={data} />
          <CacheGauge rate={data.cacheHitRate} />
        </div>
      </div>

      <div className="sectitle">Activity</div>
      <div className="card">
        <div className="head">
          <h3>When you shipped</h3>
          <span className="hint" style={{ margin: 0 }}>
            color blends by agent
          </span>
        </div>
        <ActivityHeatmap calendar={data.calendar} />
      </div>

      <div className="grid c2b" style={{ marginTop: 16 }}>
        <div className="card">
          <h3>Cost by project</h3>
          <p className="hint">size = spend · color = dominant agent</p>
          <CostTreemap data={data} />
        </div>
        <div className="card">
          <h3>Peak hours</h3>
          <p className="hint">assistant turns by hour of day</p>
          <PeakHours hours={data.peakHours} />
        </div>
      </div>

      <div className="sectitle">Usage limits &amp; forecast</div>
      <LimitsPanel data={data} />

      <div className="sectitle">Optimization tips</div>
      <Tips tips={data.tips} />
    </>
  );
}
