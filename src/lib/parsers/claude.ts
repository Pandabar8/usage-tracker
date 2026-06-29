// src/lib/parsers/claude.ts
import { readFileSync } from "node:fs";
import {
  projectFromCwd,
  type ParsedFile,
  type UsageRecord,
} from "../normalize";

export function parseClaudeFile(path: string): ParsedFile {
  const records: UsageRecord[] = [];
  const lines = readFileSync(path, "utf8").split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: any;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue; // skip malformed lines
    }
    const message = obj?.message;
    const usage = message?.usage;
    if (!usage || obj?.type !== "assistant") continue;

    records.push({
      tool: "claude",
      timestamp: String(obj.timestamp ?? ""),
      model: String(message.model ?? "unknown"),
      project: projectFromCwd(obj.cwd),
      sessionId: String(obj.sessionId ?? ""),
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      reasoningTokens: 0,
    });
  }

  return { records, quota: null };
}
