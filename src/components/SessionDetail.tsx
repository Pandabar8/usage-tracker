// src/components/SessionDetail.tsx
import { useState } from "react";
import {
  truncate,
  type Message,
  type SessionDetail as SessionDetailData,
} from "../lib/normalize";

const fmtInt = (n: number) => new Intl.NumberFormat("en-US").format(n);
const fmtUsd = (n: number) => `$${n.toFixed(2)}`;

function fmtDuration(ms: number): string {
  if (ms <= 0) return "-";
  const m = Math.round(ms / 60000);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export default function SessionDetail({
  detail,
}: {
  detail: SessionDetailData;
}) {
  const { summary, messages } = detail;
  return (
    <div className="space-y-6">
      <a href="/sessions" className="text-blue-400 hover:underline text-sm">
        ← Sessions
      </a>
      <div className="grid md:grid-cols-[1fr_280px] gap-6">
        <div className="space-y-4">
          <p className="text-xs text-neutral-500">
            Costs are notional, computed at public API rates.
          </p>
          {messages.map((m) => (
            <MessageRow key={m.index} m={m} />
          ))}
          {messages.length === 0 && (
            <p className="text-neutral-400">No messages in this session.</p>
          )}
        </div>
        <aside className="space-y-4">
          <Sidebar summary={summary} />
        </aside>
      </div>
    </div>
  );
}

function MessageRow({ m }: { m: Message }) {
  const [open, setOpen] = useState(false);

  if (m.compaction) {
    return (
      <div className="rounded border border-amber-500/40 bg-amber-500/10 text-amber-300 px-3 py-2 text-xs">
        {m.compaction === "full" ? "Full compaction" : "Micro compaction"}
        {m.text ? ` — ${truncate(m.text, 120)}` : ""}
      </div>
    );
  }

  const long = m.text.length > 300;
  const shown = open || !long ? m.text : truncate(m.text, 300);
  return (
    <div
      className={`rounded-xl p-3 ${m.role === "user" ? "bg-neutral-800" : "bg-neutral-900"}`}
    >
      <div className="flex items-center justify-between text-xs text-neutral-400 mb-1">
        <span>
          {m.role}
          {m.model ? ` · ${m.model}` : ""}
        </span>
        <span>
          {typeof m.tokens === "number" ? `${fmtInt(m.tokens)} tok` : ""}
        </span>
      </div>
      <div className="whitespace-pre-wrap text-sm text-neutral-100">
        {shown || <span className="text-neutral-500">(no text)</span>}
      </div>
      {long && (
        <button
          onClick={() => setOpen((o) => !o)}
          className="mt-1 text-xs text-blue-400"
        >
          {open ? "Show less" : "Show more"}
        </button>
      )}
      {m.toolUses.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {m.toolUses.map((t, i) => (
            <span
              key={i}
              className="rounded bg-neutral-700 text-neutral-200 px-2 py-0.5 text-xs"
            >
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Sidebar({ summary }: { summary: SessionDetailData["summary"] }) {
  return (
    <div className="rounded-xl bg-neutral-900 p-4 space-y-3 text-sm">
      <h2 className="text-base font-medium">
        {summary.project} · {summary.tool}
      </h2>
      <Row label="Turns" value={String(summary.turns)} />
      <Row label="Tool calls" value={String(summary.toolCalls)} />
      <Row label="Duration" value={fmtDuration(summary.durationMs)} />
      <Row label="Input" value={fmtInt(summary.tokens.input)} />
      <Row label="Output" value={fmtInt(summary.tokens.output)} />
      <Row label="Cache write" value={fmtInt(summary.tokens.cacheWrite)} />
      <Row label="Cache read" value={fmtInt(summary.tokens.cacheRead)} />
      <Row label="Total tokens" value={fmtInt(summary.totalTokens)} />
      <Row
        label="Cost"
        value={summary.unpriced ? "unpriced" : fmtUsd(summary.cost)}
      />
      <div>
        <div className="text-neutral-400">Models</div>
        <div className="text-neutral-200">
          {summary.models.join(", ") || "-"}
        </div>
      </div>
      {summary.compaction && (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-300">
          Compaction: {summary.compaction.full} full ·{" "}
          {summary.compaction.micro} micro ·{" "}
          {fmtInt(summary.compaction.tokensSaved)} tokens saved
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-neutral-400">{label}</span>
      <span className="text-neutral-200">{value}</span>
    </div>
  );
}
