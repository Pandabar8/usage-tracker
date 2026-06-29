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
    <section className="rounded-xl bg-neutral-900 p-4">
      <h2 className="text-lg font-medium mb-4">By model</h2>
      <ResponsiveContainer
        width="100%"
        height={Math.max(120, rows.length * 44)}
      >
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ left: 24, right: 24 }}
        >
          <XAxis type="number" stroke="#9ca3af" />
          <YAxis type="category" dataKey="name" width={180} stroke="#9ca3af" />
          <Tooltip />
          <Bar dataKey="tokens" fill="#60a5fa" radius={4} />
        </BarChart>
      </ResponsiveContainer>
    </section>
  );
}
