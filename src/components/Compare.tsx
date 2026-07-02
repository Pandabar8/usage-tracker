// src/components/Compare.tsx
import { useState } from "react";
import type { SessionSummary } from "../lib/normalize";
import type { ModelStats } from "../lib/aggregate";
import { diffSessions, diffModels, type DiffRow } from "../lib/compare";

const fmtInt = (n: number) =>
  new Intl.NumberFormat("en-US").format(Math.round(n));
const fmtUsd = (n: number) => `$${n.toFixed(4)}`;
const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;

function fmtDur(ms: number): string {
  if (ms <= 0) return "-";
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function fmtVal(kind: DiffRow["kind"], n: number): string {
  switch (kind) {
    case "usd":
      return fmtUsd(n);
    case "pct":
      return fmtPct(n);
    case "dur":
      return fmtDur(n);
    default:
      return fmtInt(n);
  }
}

function fmtDelta(kind: DiffRow["kind"], n: number): string {
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  const mag = Math.abs(n);
  const body =
    kind === "usd"
      ? `$${mag.toFixed(4)}`
      : kind === "pct"
        ? `${(mag * 100).toFixed(1)}pp`
        : kind === "dur"
          ? fmtDur(mag)
          : fmtInt(mag);
  return `${sign}${body}`;
}

export default function Compare({
  sessions,
  models,
}: {
  sessions: SessionSummary[];
  models: ModelStats[];
}) {
  const [tab, setTab] = useState<"sessions" | "models">("sessions");
  return (
    <>
      <div className="top">
        <div>
          <h1>Compare</h1>
          <div className="sub">
            side-by-side deltas · notional cost at API rates
          </div>
        </div>
        <div className="toggle">
          {(["sessions", "models"] as const).map((t) => (
            <button
              key={t}
              className={tab === t ? "on" : ""}
              onClick={() => setTab(t)}
            >
              {t === "sessions" ? "Sessions" : "Models"}
            </button>
          ))}
        </div>
      </div>

      {tab === "sessions" ? (
        <SessionCompare sessions={sessions} />
      ) : (
        <ModelCompare models={models} />
      )}
    </>
  );
}

function SessionCompare({ sessions }: { sessions: SessionSummary[] }) {
  const [aKey, setAKey] = useState(sessions[0]?.key ?? "");
  const [bKey, setBKey] = useState(sessions[1]?.key ?? sessions[0]?.key ?? "");
  const a = sessions.find((s) => s.key === aKey) ?? null;
  const b = sessions.find((s) => s.key === bKey) ?? null;
  const diff = diffSessions(a, b);
  const label = (s: SessionSummary) =>
    `${s.project} · ${s.tool} · ${new Date(s.startedAt).toLocaleDateString()}`;

  if (sessions.length === 0) {
    return <p className="hint">No sessions to compare.</p>;
  }
  return (
    <div className="card" style={{ display: "grid", gap: 16 }}>
      <div className="grid c2" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <Picker
          label="Session A"
          value={aKey}
          onChange={setAKey}
          options={sessions.map((s) => ({ value: s.key, label: label(s) }))}
        />
        <Picker
          label="Session B"
          value={bKey}
          onChange={setBKey}
          options={sessions.map((s) => ({ value: s.key, label: label(s) }))}
        />
      </div>
      <DiffTable
        rows={diff.rows}
        aName={a ? label(a) : "A"}
        bName={b ? label(b) : "B"}
      />
    </div>
  );
}

function ModelCompare({ models }: { models: ModelStats[] }) {
  const key = (m: ModelStats) => `${m.tool}:${m.model}`;
  const [aKey, setAKey] = useState(models[0] ? key(models[0]) : "");
  const [bKey, setBKey] = useState(
    models[1] ? key(models[1]) : models[0] ? key(models[0]) : "",
  );
  const a = models.find((m) => key(m) === aKey) ?? null;
  const b = models.find((m) => key(m) === bKey) ?? null;
  const diff = diffModels(a, b);
  const label = (m: ModelStats) => `${m.model} (${m.tool})`;

  if (models.length === 0) {
    return <p className="hint">No models to compare.</p>;
  }
  return (
    <div className="card" style={{ display: "grid", gap: 16 }}>
      <div className="grid c2" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <Picker
          label="Model A"
          value={aKey}
          onChange={setAKey}
          options={models.map((m) => ({ value: key(m), label: label(m) }))}
        />
        <Picker
          label="Model B"
          value={bKey}
          onChange={setBKey}
          options={models.map((m) => ({ value: key(m), label: label(m) }))}
        />
      </div>
      <DiffTable
        rows={diff.rows}
        aName={a ? label(a) : "A"}
        bName={b ? label(b) : "B"}
      />
    </div>
  );
}

function Picker({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label style={{ display: "block" }}>
      <span className="field-lbl">{label}</span>
      <select
        className="select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.length === 0 && <option value="">(none)</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function DiffTable({
  rows,
  aName,
  bName,
}: {
  rows: DiffRow[];
  aName: string;
  bName: string;
}) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="dtable">
        <thead>
          <tr>
            <th>Metric</th>
            <th className="r">{aName}</th>
            <th className="r">{bName}</th>
            <th className="r">Δ (B − A)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td style={{ color: "var(--muted)" }}>{r.label}</td>
              <td className="mono r" style={{ color: "var(--ink)" }}>
                {fmtVal(r.kind, r.a)}
              </td>
              <td className="mono r" style={{ color: "var(--ink)" }}>
                {fmtVal(r.kind, r.b)}
              </td>
              <td className="r">
                <span
                  className={`delta ${
                    r.delta > 0 ? "up" : r.delta < 0 ? "down" : ""
                  }`}
                  style={r.delta === 0 ? { color: "var(--faint)" } : undefined}
                >
                  {fmtDelta(r.kind, r.delta)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
