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
  const rows = data.byProject.slice(0, 12).map((p) => ({
    name: `${p.project} · ${p.tool}`,
    tokens: p.tokens,
  }));
  return (
    <section className="rounded-xl bg-neutral-900 p-4">
      <h2 className="text-lg font-medium mb-4">By project</h2>
      <ResponsiveContainer
        width="100%"
        height={Math.max(120, rows.length * 36)}
      >
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ left: 24, right: 24 }}
        >
          <XAxis type="number" stroke="#9ca3af" />
          <YAxis type="category" dataKey="name" width={200} stroke="#9ca3af" />
          <Tooltip />
          <Bar dataKey="tokens" fill="#34d399" radius={4} />
        </BarChart>
      </ResponsiveContainer>
    </section>
  );
}
