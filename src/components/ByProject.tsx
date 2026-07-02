// src/components/ByProject.tsx
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { Rollups } from "../lib/aggregate";

export default function ByProject({ data }: { data: Rollups }) {
  const rows = data.byProject
    .slice(0, 12)
    .map((p) => ({ name: `${p.project} · ${p.tool}`, tokens: p.tokens }));
  return (
    <div className="card">
      <h3>By project</h3>
      <p className="hint">tokens per project</p>
      <ResponsiveContainer
        width="100%"
        height={Math.max(120, rows.length * 34)}
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
            width={190}
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
          <Bar dataKey="tokens" fill="#a486f7" radius={4} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
