// src/components/TrendChart.tsx
import { useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { Rollups } from "../lib/aggregate";

export default function TrendChart({ data }: { data: Rollups }) {
  const [metric, setMetric] = useState<"tokens" | "cost">("tokens");
  const rows = data.byDay.map((d) => ({
    date: d.date,
    Claude: metric === "tokens" ? d.claudeTokens : d.claudeCost,
    Codex: metric === "tokens" ? d.codexTokens : d.codexCost,
  }));
  return (
    <section className="rounded-xl bg-neutral-900 p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-medium">Over time</h2>
        <div className="flex gap-2 text-sm">
          {(["tokens", "cost"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMetric(m)}
              className={`px-2 py-1 rounded ${metric === m ? "bg-blue-500 text-white" : "bg-neutral-800 text-neutral-300"}`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={rows}>
          <XAxis dataKey="date" stroke="#9ca3af" />
          <YAxis stroke="#9ca3af" />
          <Tooltip />
          <Legend />
          <Area
            type="monotone"
            dataKey="Claude"
            stackId="1"
            stroke="#60a5fa"
            fill="#60a5fa"
            fillOpacity={0.5}
          />
          <Area
            type="monotone"
            dataKey="Codex"
            stackId="1"
            stroke="#f59e0b"
            fill="#f59e0b"
            fillOpacity={0.5}
          />
        </AreaChart>
      </ResponsiveContainer>
    </section>
  );
}
