// src/components/Sidebar.tsx
import { useEffect, useState } from "react";
import type { RateLimitSnapshot } from "../lib/normalize";
import {
  readFilter,
  writeFilter,
  type FilterState,
  type ToolFilter,
} from "../lib/filter-bus";

const RANGES: { label: string; days: number | null }[] = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "All", days: null },
];

function rangeDates(days: number | null): { from: string; to: string } {
  if (days == null) return { from: "", to: "" };
  const to = new Date();
  const from = new Date(to.getTime() - (days - 1) * 86400000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

function activeRange(f: FilterState): string {
  if (!f.from && !f.to) return "All";
  for (const r of RANGES) {
    if (r.days == null) continue;
    const d = rangeDates(r.days);
    if (d.from === f.from && d.to === f.to) return r.label;
  }
  return "";
}

const NAV = {
  Core: [
    { href: "/", label: "Overview" },
    { href: "/sessions", label: "Sessions" },
    { href: "/compare", label: "Compare" },
  ],
  Analyze: [
    { href: "/costs", label: "Costs" },
    { href: "/activity", label: "Activity" },
  ],
  System: [{ href: "/settings", label: "Settings" }],
};

function isActive(pathname: string, href: string): boolean {
  return href === "/"
    ? pathname === "/"
    : pathname === href || pathname.startsWith(`${href}/`);
}

export default function Sidebar({
  pathname,
  codexQuota,
}: {
  pathname: string;
  codexQuota: RateLimitSnapshot | null;
}) {
  const [filter, setFilter] = useState<FilterState>({
    tool: "all",
    from: "",
    to: "",
  });
  useEffect(() => setFilter(readFilter()), []);

  const setTool = (tool: ToolFilter) => setFilter(writeFilter({ tool }));
  const setRange = (days: number | null) =>
    setFilter(writeFilter(rangeDates(days)));
  const range = activeRange(filter);

  const weekly = Math.round(codexQuota?.secondary?.usedPercent ?? 0);
  const fiveH = Math.round(codexQuota?.primary?.usedPercent ?? 0);

  return (
    <aside>
      <div className="brand">
        <span className="logo">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 3v18h18" />
            <path d="M7 14l3-4 3 3 4-6" />
          </svg>
        </span>
        <b>Usage Tracker</b>
        <span className="v">v0.1</span>
      </div>

      <div className="filters">
        <p className="lbl">Agent</p>
        <div className="seg">
          {(["all", "claude", "codex"] as ToolFilter[]).map((t) => (
            <button
              key={t}
              className={filter.tool === t ? "on" : ""}
              onClick={() => setTool(t)}
            >
              {t === "all" ? "All" : t === "claude" ? "Claude" : "Codex"}
            </button>
          ))}
        </div>
        <p className="lbl">Range</p>
        <div className="chips">
          {RANGES.map((r) => (
            <button
              key={r.label}
              className={range === r.label ? "on" : ""}
              onClick={() => setRange(r.days)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <nav>
        {Object.entries(NAV).map(([section, items], i) => (
          <div key={section} style={{ display: "contents" }}>
            {i > 0 && <div className="navsec">{section}</div>}
            {items.map((it) => (
              <a
                key={it.href}
                href={it.href}
                className={isActive(pathname, it.href) ? "active" : ""}
              >
                {it.label}
              </a>
            ))}
          </div>
        ))}
      </nav>

      <div className="side-quota">
        <div className="row">
          <span>Codex weekly</span>
          <b className="mono">{weekly}%</b>
        </div>
        <div className="bar">
          <i
            style={{
              width: `${weekly}%`,
              background: "linear-gradient(90deg,var(--codex),var(--codex-2))",
            }}
          />
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <span>Codex 5h</span>
          <b className="mono">{fiveH}%</b>
        </div>
        <div className="bar">
          <i
            style={{
              width: `${fiveH}%`,
              background: "linear-gradient(90deg,var(--codex),var(--codex-2))",
            }}
          />
        </div>
        <div className="side-foot">
          <span className="dot" />
          local · read-only · no upload
        </div>
      </div>
    </aside>
  );
}
