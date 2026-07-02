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
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(q);
        }}
        className="flex items-center gap-2 text-sm"
      >
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search message text across sessions…"
          className="flex-1 bg-neutral-800 rounded px-3 py-1.5 text-neutral-100 placeholder:text-neutral-500"
        />
        <button
          type="submit"
          className="px-3 py-1.5 rounded bg-blue-500 text-white"
        >
          {loading ? "Searching…" : "Search"}
        </button>
        {searched && (
          <button
            type="button"
            onClick={() => {
              setQ("");
              run("");
            }}
            className="px-3 py-1.5 rounded bg-neutral-800 text-neutral-300"
          >
            Clear
          </button>
        )}
      </form>

      {searched && (
        <div className="space-y-2">
          {results.length === 0 ? (
            <p className="text-neutral-400 text-sm">No matches.</p>
          ) : (
            results.map((r) => (
              <a
                key={r.key}
                href={`/sessions/${encodeURIComponent(r.key)}`}
                className="block rounded-xl bg-neutral-900 p-3 hover:bg-neutral-800/60"
              >
                <div className="flex items-center justify-between text-sm">
                  <span className="text-blue-400">
                    {r.project} · {r.tool}
                  </span>
                  <span className="text-xs text-neutral-500">
                    {r.matchCount} match{r.matchCount === 1 ? "" : "es"}
                  </span>
                </div>
                <p className="mt-1 text-sm text-neutral-300">{r.snippet}</p>
              </a>
            ))
          )}
        </div>
      )}
    </div>
  );
}
