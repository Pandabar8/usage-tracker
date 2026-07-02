// src/components/SessionDetail.tsx
import { useState } from "react";
import type { Tool } from "../lib/normalize";
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

function agentColor(tool: Tool): string {
  return tool === "claude" ? "var(--claude)" : "var(--codex)";
}

export default function SessionDetail({
  detail,
}: {
  detail: SessionDetailData;
}) {
  const { summary, messages } = detail;
  return (
    <>
      <a href="/sessions" className="back">
        ← Sessions
      </a>

      <div className="top" style={{ marginTop: 14 }}>
        <div>
          <h1>{summary.project}</h1>
          <div className="sub">
            <span
              className="tag"
              style={{
                color: agentColor(summary.tool),
                background:
                  summary.tool === "claude" ? "#e88a4e15" : "#a486f715",
              }}
            >
              {summary.tool}
            </span>{" "}
            · notional cost at API rates
          </div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 280px",
          gap: 16,
          alignItems: "start",
        }}
      >
        <div style={{ display: "grid", gap: 12 }}>
          {messages.map((m) => (
            <MessageRow key={m.index} m={m} tool={summary.tool} />
          ))}
          {messages.length === 0 && (
            <p className="hint">No messages in this session.</p>
          )}
        </div>
        <Sidebar summary={summary} />
      </div>
    </>
  );
}

function MessageRow({ m, tool }: { m: Message; tool: Tool }) {
  const [open, setOpen] = useState(false);

  if (m.compaction) {
    return (
      <div className="tip warn">
        <p className="tt" style={{ color: "var(--warn)" }}>
          {m.compaction === "full" ? "Full compaction" : "Micro compaction"}
        </p>
        {m.text ? <p className="td">{truncate(m.text, 120)}</p> : null}
      </div>
    );
  }

  const accent = m.role === "user" ? "var(--primary)" : agentColor(tool);
  const long = m.text.length > 300;
  const shown = open || !long ? m.text : truncate(m.text, 300);
  return (
    <div className="card" style={{ borderLeft: `3px solid ${accent}` }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 6,
        }}
      >
        <span
          className="mono"
          style={{
            fontSize: 10,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: m.role === "user" ? "var(--primary)" : agentColor(tool),
          }}
        >
          {m.role}
          {m.model ? (
            <span style={{ color: "var(--faint)" }}> · {m.model}</span>
          ) : (
            ""
          )}
        </span>
        <span className="mono" style={{ fontSize: 11, color: "var(--faint)" }}>
          {typeof m.tokens === "number" ? `${fmtInt(m.tokens)} tok` : ""}
        </span>
      </div>
      <div
        style={{
          whiteSpace: "pre-wrap",
          fontSize: 13,
          color: "var(--ink)",
        }}
      >
        {shown || <span style={{ color: "var(--faint)" }}>(no text)</span>}
      </div>
      {long && (
        <button
          onClick={() => setOpen((o) => !o)}
          className="linkbtn"
          style={{ marginTop: 6 }}
        >
          {open ? "Show less" : "Show more"}
        </button>
      )}
      {m.toolUses.length > 0 && (
        <div
          style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 10 }}
        >
          {m.toolUses.map((t, i) => (
            <span
              key={i}
              className="tag"
              style={{ color: "var(--muted)", background: "var(--panel-3)" }}
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
    <div
      className="card"
      style={{ display: "grid", gap: 10, position: "sticky", top: 22 }}
    >
      <h3>Session summary</h3>
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
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          paddingTop: 8,
          borderTop: "1px solid var(--line)",
        }}
      >
        <span style={{ color: "var(--muted)" }}>Models</span>
        <span
          className="mono"
          style={{ color: "var(--ink)", textAlign: "right" }}
        >
          {summary.models.join(", ") || "-"}
        </span>
      </div>
      {summary.compaction && (
        <div className="tip warn" style={{ marginTop: 2 }}>
          <p className="td" style={{ color: "var(--warn)" }}>
            Compaction: {summary.compaction.full} full ·{" "}
            {summary.compaction.micro} micro ·{" "}
            {fmtInt(summary.compaction.tokensSaved)} tokens saved
          </p>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <span style={{ color: "var(--muted)" }}>{label}</span>
      <span className="mono" style={{ color: "var(--ink)" }}>
        {value}
      </span>
    </div>
  );
}
