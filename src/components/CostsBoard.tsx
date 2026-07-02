// src/components/CostsBoard.tsx
import { useEffect, useState } from "react";
import type { BoardData } from "../lib/charts";
import { onFilter, toQuery, type FilterState } from "../lib/filter-bus";
import { fmtUsd } from "../lib/format";
import StatCard from "./StatCard";
import UsageTrend from "./UsageTrend";
import CostTreemap from "./CostTreemap";
import ByModel from "./ByModel";
import ByProject from "./ByProject";

export default function CostsBoard({ initial }: { initial: BoardData }) {
  const [data, setData] = useState<BoardData>(initial);

  async function load(f: FilterState) {
    const qs = toQuery(f);
    const res = await fetch(`/api/usage${qs ? `?${qs}` : ""}`);
    if (res.ok) setData(await res.json());
  }
  useEffect(() => onFilter((f) => load(f)), []);

  const costSeries = data.byDay.map((d) => d.claudeCost + d.codexCost);
  const priced = data.byModel.filter((m) => !m.unpriced);

  return (
    <>
      <div className="top">
        <div>
          <h1>Costs</h1>
          <div className="sub">notional spend at API rates</div>
        </div>
      </div>

      <div className="grid cards4">
        <StatCard
          label="Est. cost"
          value={fmtUsd(data.totals.combined.cost)}
          deltaPct={null}
          color="var(--mint)"
          points={costSeries}
        />
        <StatCard
          label="Claude cost"
          value={fmtUsd(data.totals.claude.cost)}
          deltaPct={null}
          color="var(--claude)"
          points={data.byDay.map((d) => d.claudeCost)}
        />
        <StatCard
          label="Codex cost"
          value={fmtUsd(data.totals.codex.cost)}
          deltaPct={null}
          color="var(--codex)"
          points={data.byDay.map((d) => d.codexCost)}
        />
        <StatCard
          label="Cache hit rate"
          value={`${Math.round(data.cacheHitRate * 100)}%`}
          deltaPct={null}
          color="var(--mint)"
          points={[]}
        />
      </div>

      <div className="grid c2" style={{ marginTop: 16 }}>
        <UsageTrend data={data} initialMetric="cost" />
        <div className="card">
          <h3>Cost by project</h3>
          <p className="hint">size = spend · color = dominant agent</p>
          <CostTreemap data={data} />
        </div>
      </div>

      <div className="sectitle">Per-model cost</div>
      <div className="card">
        <table
          style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}
        >
          <thead>
            <tr style={{ color: "var(--faint)", textAlign: "left" }}>
              <th style={{ padding: "6px 8px" }}>Model</th>
              <th style={{ padding: "6px 8px" }}>Agent</th>
              <th
                style={{ padding: "6px 8px", textAlign: "right" }}
                className="mono"
              >
                Cost
              </th>
            </tr>
          </thead>
          <tbody>
            {priced.map((m) => (
              <tr
                key={`${m.tool}:${m.model}`}
                style={{ borderTop: "1px solid var(--line)" }}
              >
                <td style={{ padding: "6px 8px" }}>{m.model}</td>
                <td
                  style={{
                    padding: "6px 8px",
                    color:
                      m.tool === "claude" ? "var(--claude)" : "var(--codex)",
                  }}
                >
                  {m.tool}
                </td>
                <td
                  style={{ padding: "6px 8px", textAlign: "right" }}
                  className="mono"
                >
                  {fmtUsd(m.cost)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid c2" style={{ marginTop: 16 }}>
        <ByModel data={data} />
        <ByProject data={data} />
      </div>
    </>
  );
}
