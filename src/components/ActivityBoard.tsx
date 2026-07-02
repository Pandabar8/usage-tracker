// src/components/ActivityBoard.tsx
import { useEffect, useState } from "react";
import type { BoardData } from "../lib/charts";
import { onFilter, toQuery, type FilterState } from "../lib/filter-bus";
import { fmtTokens } from "../lib/format";
import ActivityHeatmap from "./ActivityHeatmap";
import PeakHours from "./PeakHours";
import StatCard from "./StatCard";

function currentStreak(calendar: BoardData["calendar"]): number {
  let streak = 0;
  for (let i = calendar.length - 1; i >= 0; i--) {
    if (calendar[i].total > 0) streak++;
    else break;
  }
  return streak;
}

export default function ActivityBoard({ initial }: { initial: BoardData }) {
  const [data, setData] = useState<BoardData>(initial);

  async function load(f: FilterState) {
    const qs = toQuery(f);
    const res = await fetch(`/api/usage${qs ? `?${qs}` : ""}`);
    if (res.ok) setData(await res.json());
  }
  useEffect(() => onFilter((f) => load(f)), []);

  const activeDays = data.calendar.filter((d) => d.total > 0).length;
  const windowTotal = data.calendar.reduce((a, d) => a + d.total, 0);
  const streak = currentStreak(data.calendar);

  return (
    <>
      <div className="top">
        <div>
          <h1>Activity</h1>
          <div className="sub">
            when work happened across the selected range
          </div>
        </div>
      </div>

      <div className="grid cards4">
        <StatCard
          label="Active days"
          value={String(activeDays)}
          deltaPct={null}
          color="var(--primary)"
          points={data.calendar.map((d) => d.total)}
        />
        <StatCard
          label="Current streak"
          value={`${streak}d`}
          deltaPct={null}
          color="var(--mint)"
          points={[]}
        />
        <StatCard
          label="Tokens (range)"
          value={fmtTokens(windowTotal)}
          deltaPct={null}
          color="var(--claude)"
          points={data.calendar.map((d) => d.total)}
        />
        <StatCard
          label="Days shown"
          value={String(data.calendar.length)}
          deltaPct={null}
          color="var(--codex)"
          points={[]}
        />
      </div>

      <div className="sectitle">When you shipped</div>
      <div className="card">
        <div className="head">
          <h3>Activity heatmap</h3>
          <span className="hint" style={{ margin: 0 }}>
            color blends by agent
          </span>
        </div>
        <ActivityHeatmap calendar={data.calendar} />
      </div>

      <div className="sectitle">Peak hours</div>
      <div className="card">
        <h3>Peak hours</h3>
        <p className="hint">assistant turns by hour of day</p>
        <PeakHours hours={data.peakHours} />
      </div>
    </>
  );
}
