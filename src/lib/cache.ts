// src/lib/cache.ts
import { statSync } from "node:fs";
import type { ParsedFile } from "./normalize";

interface CacheEntry {
  mtimeMs: number;
  parsed: ParsedFile;
}

const cache = new Map<string, CacheEntry>();

export function parseFileCached(
  path: string,
  parser: (p: string) => ParsedFile,
): ParsedFile {
  const mtimeMs = statSync(path).mtimeMs;
  const hit = cache.get(path);
  if (hit && hit.mtimeMs === mtimeMs) return hit.parsed;
  const parsed = parser(path);
  cache.set(path, { mtimeMs, parsed });
  return parsed;
}

export function clearCache(): void {
  cache.clear();
}
