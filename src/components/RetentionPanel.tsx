// src/components/RetentionPanel.tsx
import { useState } from "react";

// Initial retention state read on the server from ~/.claude/settings.json.
export interface RetentionInitial {
  cleanupPeriodDays: number | null; // raw key value, null when unset
  effectiveDays: number; // cleanupPeriodDays ?? 30
  protected: boolean; // effectiveDays >= safe threshold
  claudeStart: string | null; // earliest Claude record on disk, ISO or null
  targetDays: number; // value the protect action raises to
}

interface ProtectResult {
  before: number | null;
  after: number;
}

export default function RetentionPanel({
  initial,
}: {
  initial: RetentionInitial;
}) {
  const [cleanup, setCleanup] = useState<number | null>(
    initial.cleanupPeriodDays,
  );
  const [days, setDays] = useState<number>(initial.effectiveDays);
  const [isProtected, setIsProtected] = useState<boolean>(initial.protected);
  const [status, setStatus] = useState<"idle" | "working" | "done" | "error">(
    "idle",
  );
  const [result, setResult] = useState<ProtectResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentLabel =
    cleanup === null ? "unset — defaults to 30 days" : `${cleanup} days`;

  async function protectHistory() {
    setStatus("working");
    setError(null);
    try {
      const res = await fetch("/api/fix-retention", { method: "POST" });
      if (!res.ok) throw new Error(`request failed: ${res.status}`);
      const data = (await res.json()) as {
        before: number | null;
        after: number;
        protected: boolean;
      };
      setResult({ before: data.before, after: data.after });
      setCleanup(data.after);
      setDays(data.after);
      setIsProtected(data.protected);
      setStatus("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update settings.");
      setStatus("error");
    }
  }

  return (
    <div className="card">
      <h3>Retention</h3>
      <p className="hint">
        Claude Code purges usage history older than its cleanup window. Raising
        it preserves what this dashboard can show.
      </p>

      <div className="qrow">
        <span className="qlab">Current</span>
        <span className="qmeta">{currentLabel}</span>
      </div>
      <div className="qrow">
        <span className="qlab">Status</span>
        <span className="qmeta">
          <span
            className="tag"
            style={{
              color: isProtected ? "var(--mint)" : "var(--warn)",
              background: isProtected ? "#4fd6a815" : "#f5a52418",
            }}
          >
            {isProtected ? "protected" : "at risk of data loss"}
          </span>
        </span>
      </div>
      <div className="qrow">
        <span className="qlab">Claude data from</span>
        <span className="qmeta">
          {initial.claudeStart ? initial.claudeStart.slice(0, 10) : "no data"}
        </span>
      </div>

      <div
        style={{
          marginTop: 14,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <button
          className="btn"
          onClick={protectHistory}
          disabled={status === "working" || isProtected}
          style={
            status === "working" || isProtected ? { opacity: 0.6 } : undefined
          }
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          {status === "working"
            ? "Protecting…"
            : isProtected
              ? "History protected"
              : "Protect history"}
        </button>
        {status === "done" && result && (
          <span className="qmeta" style={{ color: "var(--mint)" }}>
            Raised from{" "}
            {result.before === null ? "30 (default)" : result.before} →{" "}
            {result.after} days
          </span>
        )}
        {status === "error" && error && (
          <span className="qmeta" style={{ color: "var(--danger)" }}>
            {error}
          </span>
        )}
      </div>

      {!isProtected && status !== "done" && (
        <p className="note">
          Raises <span className="mono">cleanupPeriodDays</span> to{" "}
          {initial.targetDays} days in{" "}
          <span className="mono">~/.claude/settings.json</span>. This is the
          only time the dashboard writes to disk.
        </p>
      )}
      <p className="hint" style={{ marginTop: 12 }}>
        Effective retention window: <span className="mono">{days}</span> days.
      </p>
    </div>
  );
}
