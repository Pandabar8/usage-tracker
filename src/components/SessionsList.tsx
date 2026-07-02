// src/components/SessionsList.tsx
import { useEffect, useState } from "react";
import type { SessionSummary } from "../lib/normalize";
import {
  onFilter,
  readFilter,
  toQuery,
  type FilterState,
} from "../lib/filter-bus";

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
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({
    key: "startedAt",
    dir: -1,
  });

  async function load(f: FilterState, refresh = false) {
    setLoading(true);
    try {
      if (refresh) await fetch("/api/refresh", { method: "POST" });
      const qs = toQuery(f);
      const res = await fetch(`/api/sessions${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw new Error(`sessions request failed: ${res.status}`);
      setRows(await res.json());
    } finally {
      setLoading(false);
    }
  }

  // Consume the sidebar's global tool/date filter, matching the boards.
  useEffect(() => onFilter((f) => load(f)), []);

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
    <>
      <div className="top">
        <div>
          <h1>Sessions</h1>
          <div className="sub">
            {sorted.length} sessions · notional cost at API rates
          </div>
        </div>
        <button className="btn" onClick={() => load(readFilter(), true)}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M23 4v6h-6M1 20v-6h6" />
            <path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15" />
          </svg>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      <div className="card" style={{ overflowX: "auto", padding: 0 }}>
        <table className="dtable">
          <thead>
            <tr>
              <th>Session</th>
              <th>Models</th>
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
                right
              />
              <Th
                label="Turns"
                k="turns"
                sort={sort}
                onSort={toggleSort}
                right
              />
              <Th
                label="Tokens"
                k="totalTokens"
                sort={sort}
                onSort={toggleSort}
                right
              />
              <Th label="Cost" k="cost" sort={sort} onSort={toggleSort} right />
              <th className="r">Compaction</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => (
              <tr key={s.key}>
                <td>
                  <a
                    href={`/sessions/${encodeURIComponent(s.key)}`}
                    style={{ color: "var(--primary)", textDecoration: "none" }}
                  >
                    {s.project}
                  </a>{" "}
                  <span
                    className="tag"
                    style={{
                      color:
                        s.tool === "claude" ? "var(--claude)" : "var(--codex)",
                      background:
                        s.tool === "claude" ? "#e88a4e15" : "#a486f715",
                    }}
                  >
                    {s.tool}
                  </span>
                </td>
                <td style={{ color: "var(--muted)" }}>
                  {s.models.join(", ") || "-"}
                </td>
                <td className="mono">{fmtWhen(s.startedAt)}</td>
                <td className="mono r" style={{ color: "var(--ink)" }}>
                  {fmtDuration(s.durationMs)}
                </td>
                <td className="mono r" style={{ color: "var(--ink)" }}>
                  {s.turns}
                </td>
                <td className="mono r" style={{ color: "var(--ink)" }}>
                  {fmtInt(s.totalTokens)}
                </td>
                <td className="mono r" style={{ color: "var(--ink)" }}>
                  {s.unpriced ? "unpriced" : fmtUsd(s.cost)}
                </td>
                <td className="r">
                  {s.compaction ? (
                    <span
                      className="tag"
                      style={{
                        color: "var(--warn)",
                        background: "#f5a52418",
                      }}
                    >
                      {s.compaction.full + s.compaction.micro}×
                    </span>
                  ) : (
                    <span style={{ color: "var(--faint)" }}>-</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length === 0 && (
        <p className="hint" style={{ marginTop: 14 }}>
          No sessions found.
        </p>
      )}
    </>
  );
}

function Th({
  label,
  k,
  sort,
  onSort,
  right = false,
}: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; dir: 1 | -1 };
  onSort: (k: SortKey) => void;
  right?: boolean;
}) {
  const active = sort.key === k;
  return (
    <th className={`sortable${right ? " r" : ""}`} onClick={() => onSort(k)}>
      {label}
      {active ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
    </th>
  );
}
