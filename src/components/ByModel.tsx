// src/components/ByModel.tsx
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { Rollups } from "../lib/aggregate";

export default function ByModel({ data }: { data: Rollups }) {
  const rows = data.byModel.map((m) => ({
    name: m.unpriced ? `${m.model} (unpriced)` : m.model,
    tokens: m.tokens,
  }));
  return (
    <div className="card">
      <h3>By model</h3>
      <p className="hint">tokens per model</p>
      <ResponsiveContainer
        width="100%"
        height={Math.max(120, rows.length * 40)}
      >
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ left: 24, right: 24 }}
        >
          <XAxis type="number" stroke="#5c6675" fontSize={10} />
          <YAxis
            type="category"
            dataKey="name"
            width={170}
            stroke="#98a2b3"
            fontSize={11}
          />
          <Tooltip
            contentStyle={{
              background: "#12151b",
              border: "1px solid rgba(233,238,246,.13)",
              borderRadius: 8,
              color: "#e8ecf2",
            }}
          />
          <Bar dataKey="tokens" fill="#e88a4e" radius={4} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
