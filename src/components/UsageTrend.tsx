// src/components/UsageTrend.tsx
import { useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { Rollups } from "../lib/aggregate";

export default function UsageTrend({
  data,
  initialMetric = "tokens",
}: {
  data: Rollups;
  initialMetric?: "tokens" | "cost";
}) {
  const [metric, setMetric] = useState<"tokens" | "cost">(initialMetric);
  const rows = data.byDay.map((d) => ({
    date: d.date,
    Claude: metric === "tokens" ? d.claudeTokens : d.claudeCost,
    Codex: metric === "tokens" ? d.codexTokens : d.codexCost,
  }));
  return (
    <div className="card">
      <div className="head">
        <h3>Usage over time</h3>
        <div className="toggle">
          {(["tokens", "cost"] as const).map((m) => (
            <button
              key={m}
              className={metric === m ? "on" : ""}
              onClick={() => setMetric(m)}
            >
              {m === "tokens" ? "Tokens" : "Cost"}
            </button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={rows}>
          <defs>
            <linearGradient id="gc" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#e88a4e" stopOpacity={0.45} />
              <stop offset="1" stopColor="#e88a4e" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gx" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#a486f7" stopOpacity={0.42} />
              <stop offset="1" stopColor="#a486f7" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="date" stroke="#5c6675" fontSize={10} />
          <YAxis stroke="#5c6675" fontSize={10} />
          <Tooltip
            contentStyle={{
              background: "#12151b",
              border: "1px solid rgba(233,238,246,.13)",
              borderRadius: 8,
              color: "#e8ecf2",
            }}
          />
          <Area
            type="monotone"
            dataKey="Claude"
            stroke="#e88a4e"
            strokeWidth={2}
            fill="url(#gc)"
          />
          <Area
            type="monotone"
            dataKey="Codex"
            stroke="#a486f7"
            strokeWidth={2}
            fill="url(#gx)"
          />
        </AreaChart>
      </ResponsiveContainer>
      <div className="legend">
        <span>
          <i className="sw" style={{ background: "var(--claude)" }} />
          Claude
        </span>
        <span>
          <i className="sw" style={{ background: "var(--codex)" }} />
          Codex
        </span>
      </div>
    </div>
  );
}
