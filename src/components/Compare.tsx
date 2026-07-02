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
    <div className="space-y-6">
      <div className="flex gap-2 text-sm">
        {(["sessions", "models"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1 rounded ${tab === t ? "bg-blue-500 text-white" : "bg-neutral-800 text-neutral-300"}`}
          >
            {t === "sessions" ? "Sessions" : "Models"}
          </button>
        ))}
      </div>
      <p className="text-xs text-neutral-500">
        Costs are notional, computed at public API rates.
      </p>
      {tab === "sessions" ? (
        <SessionCompare sessions={sessions} />
      ) : (
        <ModelCompare models={models} />
      )}
    </div>
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
    return <p className="text-neutral-400">No sessions to compare.</p>;
  }
  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-2 gap-4">
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
    return <p className="text-neutral-400">No models to compare.</p>;
  }
  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-2 gap-4">
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
    <label className="block text-sm">
      <span className="text-neutral-400">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full bg-neutral-800 rounded px-2 py-1 text-neutral-100"
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
    <div className="overflow-x-auto rounded-xl bg-neutral-900">
      <table className="w-full text-sm">
        <thead className="text-neutral-400">
          <tr>
            <th className="text-left p-3">Metric</th>
            <th className="text-right p-3">{aName}</th>
            <th className="text-right p-3">{bName}</th>
            <th className="text-right p-3">Δ (B − A)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-neutral-800">
              <td className="p-3 text-neutral-300">{r.label}</td>
              <td className="p-3 text-right text-neutral-200">
                {fmtVal(r.kind, r.a)}
              </td>
              <td className="p-3 text-right text-neutral-200">
                {fmtVal(r.kind, r.b)}
              </td>
              <td
                className={`p-3 text-right ${r.delta > 0 ? "text-emerald-400" : r.delta < 0 ? "text-rose-400" : "text-neutral-500"}`}
              >
                {fmtDelta(r.kind, r.delta)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
