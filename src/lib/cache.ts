// src/lib/cache.ts
import { statSync } from "node:fs";
import type { ParsedFile } from "./normalize";

interface CacheEntry {
  mtimeMs: number;
  size: number;
  parsed: ParsedFile;
}

const cache = new Map<string, CacheEntry>();

// Parse a file, reusing a cached parse when the file is unchanged. The
// invalidation key is (path, mtimeMs, size): a file whose mtime OR byte length
// changed is re-parsed. mtime alone can miss a same-mtime in-place edit, so size
// guards appends — session logs are append-only with strictly growing size.
export function parseFileCached(
  path: string,
  parser: (p: string) => ParsedFile,
): ParsedFile {
  const { mtimeMs, size } = statSync(path);
  const hit = cache.get(path);
  if (hit && hit.mtimeMs === mtimeMs && hit.size === size) return hit.parsed;
  const parsed = parser(path);
  cache.set(path, { mtimeMs, size, parsed });
  return parsed;
}

// Evict cache entries for files no longer on disk. `livePaths` must hold the same
// path strings used as cache keys (the values passed to parseFileCached), so the
// in-process Map does not grow unbounded as sessions come and go.
export function pruneCache(livePaths: Set<string>): void {
  for (const path of cache.keys()) {
    if (!livePaths.has(path)) cache.delete(path);
  }
}

export function cacheSize(): number {
  return cache.size;
}

export function clearCache(): void {
  cache.clear();
}
