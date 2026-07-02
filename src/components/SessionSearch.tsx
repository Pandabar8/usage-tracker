// src/components/SessionSearch.tsx
import { useEffect, useState } from "react";
import type { SearchResult } from "../lib/search";

export default function SessionSearch({
  initialQuery = "",
}: {
  initialQuery?: string;
}) {
  const [q, setQ] = useState(initialQuery);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  async function run(query: string) {
    const trimmed = query.trim();
    // Keep ?q= in the URL so a search is deep-linkable and survives reload.
    const url = new URL(window.location.href);
    if (trimmed) url.searchParams.set("q", trimmed);
    else url.searchParams.delete("q");
    window.history.replaceState({}, "", url);

    if (!trimmed) {
      setResults([]);
      setSearched(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`);
      if (!res.ok) throw new Error(`search failed: ${res.status}`);
      setResults(await res.json());
      setSearched(true);
    } finally {
      setLoading(false);
    }
  }

  // Run once for an initial ?q= (deep link into /sessions?q=...).
  useEffect(() => {
    if (initialQuery.trim()) run(initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ marginBottom: 16 }}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(q);
        }}
        style={{ display: "flex", alignItems: "center", gap: 8 }}
      >
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search message text across sessions…"
          className="input"
          style={{ flex: 1 }}
        />
        <button type="submit" className="btn">
          {loading ? "Searching…" : "Search"}
        </button>
        {searched && (
          <button
            type="button"
            onClick={() => {
              setQ("");
              run("");
            }}
            className="btn"
          >
            Clear
          </button>
        )}
      </form>

      {searched && (
        <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
          {results.length === 0 ? (
            <p className="hint" style={{ margin: 0 }}>
              No matches.
            </p>
          ) : (
            results.map((r) => (
              <a
                key={r.key}
                href={`/sessions/${encodeURIComponent(r.key)}`}
                className="card link"
                style={{ padding: "12px 14px" }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <span>
                    <span style={{ color: "var(--primary)" }}>{r.project}</span>{" "}
                    <span
                      className="tag"
                      style={{
                        color:
                          r.tool === "claude"
                            ? "var(--claude)"
                            : "var(--codex)",
                        background:
                          r.tool === "claude" ? "#e88a4e15" : "#a486f715",
                      }}
                    >
                      {r.tool}
                    </span>
                  </span>
                  <span className="mono" style={{ color: "var(--faint)" }}>
                    {r.matchCount} match{r.matchCount === 1 ? "" : "es"}
                  </span>
                </div>
                <p
                  style={{
                    margin: "8px 0 0",
                    color: "var(--muted)",
                    fontSize: 12.5,
                  }}
                >
                  {r.snippet}
                </p>
              </a>
            ))
          )}
        </div>
      )}
    </div>
  );
}
