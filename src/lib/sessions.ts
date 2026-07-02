// src/lib/sessions.ts
import {
  totalTokens,
  type SessionMeta,
  type SessionSummary,
  type Tool,
  type UsageRecord,
} from "./normalize";
import { cost, defaultPricing, isPriced, type PricingTable } from "./pricing";

interface Acc {
  id: string; // raw session id
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  total: number;
  cost: number;
  unpriced: boolean;
  project: string;
  tool: Tool;
  models: Set<string>;
  started: string;
  ended: string;
}

export function groupSessions(
  records: UsageRecord[],
  meta: Map<string, SessionMeta>,
  pricing: PricingTable = defaultPricing,
): SessionSummary[] {
  // Keyed by the composite route key `${tool}:${sessionId}` so Claude and Codex
  // sessions never collide even if two raw ids ever coincide.
  const groups = new Map<string, Acc>();

  for (const r of records) {
    const id = r.sessionId;
    if (!id) continue;
    const key = `${r.tool}:${id}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        id,
        input: 0,
        output: 0,
        cacheWrite: 0,
        cacheRead: 0,
        total: 0,
        cost: 0,
        unpriced: false,
        project: r.project,
        tool: r.tool,
        models: new Set(),
        started: r.timestamp,
        ended: r.timestamp,
      };
      groups.set(key, g);
    }
    g.input += r.inputTokens;
    g.output += r.outputTokens;
    g.cacheWrite += r.cacheWriteTokens;
    g.cacheRead += r.cacheReadTokens;
    g.total += totalTokens(r);
    g.cost += cost(r, pricing);
    if (!isPriced(r.model, pricing)) g.unpriced = true;
    if (r.model) g.models.add(r.model);
    if (r.timestamp) {
      if (r.timestamp < g.started) g.started = r.timestamp;
      if (r.timestamp > g.ended) g.ended = r.timestamp;
    }
  }

  const summaries: SessionSummary[] = [];
  for (const [key, g] of groups) {
    const m = meta.get(key);
    const startedAt = m?.startedAt || g.started;
    const endedAt = m?.endedAt || g.ended;
    const startMs = Date.parse(startedAt);
    const endMs = Date.parse(endedAt);
    const durationMs =
      Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
        ? endMs - startMs
        : 0;
    const models = m && m.models.length ? m.models : [...g.models];

    const summary: SessionSummary = {
      key,
      id: g.id,
      tool: m?.tool ?? g.tool,
      project: g.project,
      models,
      startedAt,
      endedAt,
      durationMs,
      turns: m?.turns ?? 0,
      toolCalls: m?.toolCalls ?? 0,
      tokens: {
        input: g.input,
        output: g.output,
        cacheWrite: g.cacheWrite,
        cacheRead: g.cacheRead,
      },
      totalTokens: g.total,
      cost: g.cost,
      unpriced: g.unpriced,
    };
    if (m?.compaction && (m.compaction.full > 0 || m.compaction.micro > 0)) {
      summary.compaction = m.compaction;
    }
    summaries.push(summary);
  }

  summaries.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return summaries;
}
