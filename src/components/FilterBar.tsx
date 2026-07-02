// src/components/FilterBar.tsx
export type ToolFilter = "all" | "claude" | "codex";

interface Props {
  tool: ToolFilter;
  from: string;
  to: string;
  loading: boolean;
  onChange: (next: { tool?: ToolFilter; from?: string; to?: string }) => void;
  onRefresh?: () => void;
}

export default function FilterBar({
  tool,
  from,
  to,
  loading,
  onChange,
  onRefresh,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <div className="flex gap-2">
        {(["all", "claude", "codex"] as const).map((t) => (
          <button
            key={t}
            onClick={() => onChange({ tool: t })}
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
          onChange={(e) => onChange({ from: e.target.value })}
          className="bg-neutral-800 rounded px-2 py-1 text-neutral-100"
        />
      </label>
      <label className="flex items-center gap-1 text-neutral-400">
        To
        <input
          type="date"
          value={to}
          onChange={(e) => onChange({ to: e.target.value })}
          className="bg-neutral-800 rounded px-2 py-1 text-neutral-100"
        />
      </label>
      {onRefresh && (
        <button
          onClick={onRefresh}
          className="ml-auto px-3 py-1 rounded bg-neutral-800 text-neutral-300"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      )}
    </div>
  );
}
