// src/components/SessionsList.tsx
import { useState } from "react";
import type { SessionSummary } from "../lib/normalize";
import FilterBar, { type ToolFilter } from "./FilterBar";

const fmtInt = (n: number) => new Intl.NumberFormat("en-US").format(n);
const fmtUsd = (n: number) => `$${n.toFixed(2)}`;

function fmtDuration(ms: number): string {
  if (ms <= 0) return "-";
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function fmtWhen(iso: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleString();
}

type SortKey = "startedAt" | "durationMs" | "turns" | "totalTokens" | "cost";

export default function SessionsList({
  initial,
}: {
  initial: SessionSummary[];
}) {
  const [rows, setRows] = useState<SessionSummary[]>(initial);
  const [tool, setTool] = useState<ToolFilter>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({
    key: "startedAt",
    dir: -1,
  });

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
      const res = await fetch(`/api/sessions?${params.toString()}`);
      if (!res.ok) throw new Error(`sessions request failed: ${res.status}`);
      setRows(await res.json());
    } finally {
      setLoading(false);
    }
  }

  const sorted = [...rows].sort((a, b) => {
    const k = sort.key;
    const av = k === "startedAt" ? a.startedAt : (a[k] as number);
    const bv = k === "startedAt" ? b.startedAt : (b[k] as number);
    if (av < bv) return -1 * sort.dir;
    if (av > bv) return 1 * sort.dir;
    return 0;
  });

  function toggleSort(k: SortKey) {
    setSort((s) =>
      s.key === k ? { key: k, dir: s.dir === 1 ? -1 : 1 } : { key: k, dir: -1 },
    );
  }

  return (
    <div className="space-y-6">
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
      <p className="text-xs text-neutral-500">
        Costs are notional, computed at public API rates.
      </p>
      <div className="overflow-x-auto rounded-xl bg-neutral-900">
        <table className="w-full text-sm">
          <thead className="text-neutral-400">
            <tr>
              <th className="text-left p-3">Session</th>
              <th className="text-left p-3">Models</th>
              <Th
                label="Started"
                k="startedAt"
                sort={sort}
                onSort={toggleSort}
              />
              <Th
                label="Duration"
                k="durationMs"
                sort={sort}
                onSort={toggleSort}
              />
              <Th label="Turns" k="turns" sort={sort} onSort={toggleSort} />
              <Th
                label="Tokens"
                k="totalTokens"
                sort={sort}
                onSort={toggleSort}
              />
              <Th label="Cost" k="cost" sort={sort} onSort={toggleSort} />
              <th className="text-left p-3">Compaction</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => (
              <tr
                key={s.key}
                className="border-t border-neutral-800 hover:bg-neutral-800/50"
              >
                <td className="p-3">
                  <a
                    className="text-blue-400 hover:underline"
                    href={`/sessions/${encodeURIComponent(s.key)}`}
                  >
                    {s.project} · {s.tool}
                  </a>
                </td>
                <td className="p-3 text-neutral-300">
                  {s.models.join(", ") || "-"}
                </td>
                <td className="p-3 text-neutral-300">{fmtWhen(s.startedAt)}</td>
                <td className="p-3 text-neutral-300">
                  {fmtDuration(s.durationMs)}
                </td>
                <td className="p-3 text-neutral-300">{s.turns}</td>
                <td className="p-3 text-neutral-300">
                  {fmtInt(s.totalTokens)}
                </td>
                <td className="p-3 text-neutral-300">
                  {s.unpriced ? "unpriced" : fmtUsd(s.cost)}
                </td>
                <td className="p-3">
                  {s.compaction ? (
                    <span className="rounded bg-amber-500/20 text-amber-400 px-2 py-0.5 text-xs">
                      {s.compaction.full + s.compaction.micro}×
                    </span>
                  ) : (
                    <span className="text-neutral-600">-</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length === 0 && (
        <p className="text-neutral-400">No sessions found.</p>
      )}
    </div>
  );
}

function Th({
  label,
  k,
  sort,
  onSort,
}: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; dir: 1 | -1 };
  onSort: (k: SortKey) => void;
}) {
  const active = sort.key === k;
  return (
    <th
      className="text-left p-3 cursor-pointer select-none"
      onClick={() => onSort(k)}
    >
      {label}
      {active ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
    </th>
  );
}
