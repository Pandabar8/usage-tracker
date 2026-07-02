// src/components/Dashboard.tsx
import { useState } from "react";
import type { DashboardData } from "../lib/aggregate";
import FilterBar, { type ToolFilter } from "./FilterBar";
import Overview from "./Overview";
import Tips from "./Tips";
import RetentionBanner from "./RetentionBanner";
import TrendChart from "./TrendChart";
import ByModel from "./ByModel";
import ByProject from "./ByProject";
import QuotaPanel from "./QuotaPanel";

export default function Dashboard({
  initial,
  retention,
}: {
  initial: DashboardData;
  retention: { risky: boolean; days: number };
}) {
  const [data, setData] = useState<DashboardData>(initial);
  const [tool, setTool] = useState<ToolFilter>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(false);

  async function load(
    next: { tool?: ToolFilter; from?: string; to?: string } = {},
    refresh = false,
  ) {
    const t = next.tool ?? tool;
    const f = next.from ?? from;
    const u = next.to ?? to;
    setLoading(true);
    try {
      if (refresh) await fetch("/api/refresh", { method: "POST" });
      const params = new URLSearchParams();
      if (t !== "all") params.set("tool", t);
      if (f) params.set("from", f);
      if (u) params.set("to", u);
      const res = await fetch(`/api/usage?${params.toString()}`);
      if (!res.ok) throw new Error(`usage request failed: ${res.status}`);
      setData(await res.json());
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-8">
      <RetentionBanner risky={retention.risky} days={retention.days} />
      <FilterBar
        tool={tool}
        from={from}
        to={to}
        loading={loading}
        onChange={(n) => {
          if (n.tool !== undefined) setTool(n.tool);
          if (n.from !== undefined) setFrom(n.from);
          if (n.to !== undefined) setTo(n.to);
          load(n);
        }}
        onRefresh={() => load({}, true)}
      />
      <Overview data={data} />
      <Tips tips={data.tips} />
      <TrendChart data={data} />
      <div className="grid md:grid-cols-2 gap-8">
        <ByModel data={data} />
        <ByProject data={data} />
      </div>
      <QuotaPanel data={data} />
    </div>
  );
}
