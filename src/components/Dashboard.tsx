// src/components/Dashboard.tsx
import { useState } from "react";
import type { DashboardData } from "../lib/aggregate";
import type { Tool } from "../lib/normalize";
import Overview from "./Overview";
import TrendChart from "./TrendChart";
import ByModel from "./ByModel";
import ByProject from "./ByProject";
import QuotaPanel from "./QuotaPanel";

type ToolFilter = Tool | "all";

export default function Dashboard({ initial }: { initial: DashboardData }) {
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
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <div className="flex gap-2">
          {(["all", "claude", "codex"] as const).map((t) => (
            <button
              key={t}
              onClick={() => {
                setTool(t);
                load({ tool: t });
              }}
              className={`px-3 py-1 rounded ${tool === t ? "bg-blue-500 text-white" : "bg-neutral-800 text-neutral-300"}`}
            >
              {t}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1 text-neutral-400">
          From
          <input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              load({ from: e.target.value });
            }}
            className="bg-neutral-800 rounded px-2 py-1 text-neutral-100"
          />
        </label>
        <label className="flex items-center gap-1 text-neutral-400">
          To
          <input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              load({ to: e.target.value });
            }}
            className="bg-neutral-800 rounded px-2 py-1 text-neutral-100"
          />
        </label>
        <button
          onClick={() => load({}, true)}
          className="ml-auto px-3 py-1 rounded bg-neutral-800 text-neutral-300"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>
      <Overview data={data} />
      <TrendChart data={data} />
      <div className="grid md:grid-cols-2 gap-8">
        <ByModel data={data} />
        <ByProject data={data} />
      </div>
      <QuotaPanel data={data} />
    </div>
  );
}
