// src/lib/aggregate.ts
import {
  totalTokens,
  type ClaudeWindows,
  type Forecast,
  type RateLimitSnapshot,
  type Tip,
  type Tool,
  type UsageRecord,
} from "./normalize";
import { cost, defaultPricing, isPriced, type PricingTable } from "./pricing";

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// Claude has no server-reported quota, so we surface how many Claude tokens were
// used in the rolling 5h and 7d windows ending at `nowMs`. `nowMs` is injected
// (not read here) so the reducer stays deterministic and testable; the Astro
// request handlers pass `Date.now()`.
export function claudeWindows(
  records: UsageRecord[],
  nowMs: number,
): ClaudeWindows {
  let fiveHourTokens = 0;
  let sevenDayTokens = 0;
  for (const r of records) {
    if (r.tool !== "claude" || !r.timestamp) continue;
    const t = Date.parse(r.timestamp);
    if (Number.isNaN(t)) continue;
    const age = nowMs - t;
    if (age < 0) continue; // ignore future-dated records
    const tokens = totalTokens(r);
    if (age <= FIVE_HOURS_MS) fiveHourTokens += tokens;
    if (age <= SEVEN_DAYS_MS) sevenDayTokens += tokens;
  }
  return {
    fiveHourTokens,
    sevenDayTokens,
    asOf: new Date(nowMs).toISOString(),
  };
}

export interface ToolTotal {
  tokens: number;
  cost: number;
}
export interface DayPoint {
  date: string;
  claudeTokens: number;
  codexTokens: number;
  claudeCost: number;
  codexCost: number;
}
export interface ProjectPoint {
  project: string;
  tool: Tool;
  tokens: number;
  cost: number;
}
export interface ModelPoint {
  model: string;
  tool: Tool;
  tokens: number;
  cost: number;
  unpriced: boolean;
}

export interface Rollups {
  totals: { claude: ToolTotal; codex: ToolTotal; combined: ToolTotal };
  byDay: DayPoint[];
  byProject: ProjectPoint[];
  byModel: ModelPoint[];
  dateRange: { start: string | null; end: string | null };
  codexQuota: RateLimitSnapshot | null;
  claudeWindows: ClaudeWindows;
  cacheHitRate: number;
}

export interface DashboardData extends Rollups {
  forecast: Forecast;
  tips: Tip[];
}

export function aggregate(
  records: UsageRecord[],
  codexQuota: RateLimitSnapshot | null,
  pricing: PricingTable = defaultPricing,
  windows: ClaudeWindows = { fiveHourTokens: 0, sevenDayTokens: 0, asOf: "" },
): Rollups {
  const claude: ToolTotal = { tokens: 0, cost: 0 };
  const codex: ToolTotal = { tokens: 0, cost: 0 };
  const days = new Map<string, DayPoint>();
  const projects = new Map<string, ProjectPoint>();
  const models = new Map<string, ModelPoint>();
  let start: string | null = null;
  let end: string | null = null;
  let inputSum = 0;
  let cacheWriteSum = 0;
  let cacheReadSum = 0;

  for (const r of records) {
    const tokens = totalTokens(r);
    const c = cost(r, pricing);
    inputSum += r.inputTokens;
    cacheWriteSum += r.cacheWriteTokens;
    cacheReadSum += r.cacheReadTokens;

    const toolTotal = r.tool === "claude" ? claude : codex;
    toolTotal.tokens += tokens;
    toolTotal.cost += c;

    const date = r.timestamp.slice(0, 10);
    let day = days.get(date);
    if (!day) {
      day = {
        date,
        claudeTokens: 0,
        codexTokens: 0,
        claudeCost: 0,
        codexCost: 0,
      };
      days.set(date, day);
    }
    if (r.tool === "claude") {
      day.claudeTokens += tokens;
      day.claudeCost += c;
    } else {
      day.codexTokens += tokens;
      day.codexCost += c;
    }

    const pKey = JSON.stringify([r.tool, r.project]);
    let proj = projects.get(pKey);
    if (!proj) {
      proj = { project: r.project, tool: r.tool, tokens: 0, cost: 0 };
      projects.set(pKey, proj);
    }
    proj.tokens += tokens;
    proj.cost += c;

    const mKey = JSON.stringify([r.tool, r.model]);
    let mod = models.get(mKey);
    if (!mod) {
      mod = {
        model: r.model,
        tool: r.tool,
        tokens: 0,
        cost: 0,
        unpriced: !isPriced(r.model, pricing),
      };
      models.set(mKey, mod);
    }
    mod.tokens += tokens;
    mod.cost += c;

    if (r.timestamp) {
      if (start === null || r.timestamp < start) start = r.timestamp;
      if (end === null || r.timestamp > end) end = r.timestamp;
    }
  }

  return {
    totals: {
      claude,
      codex,
      combined: {
        tokens: claude.tokens + codex.tokens,
        cost: claude.cost + codex.cost,
      },
    },
    byDay: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    byProject: [...projects.values()].sort((a, b) => b.tokens - a.tokens),
    byModel: [...models.values()].sort((a, b) => b.tokens - a.tokens),
    dateRange: { start, end },
    codexQuota,
    claudeWindows: windows,
    cacheHitRate: cacheHitRate(inputSum, cacheWriteSum, cacheReadSum),
  };
}

// Share of read-side tokens served from cache: cacheRead / (input + cacheWrite +
// cacheRead). Cache writes are billed as non-cached input, so they belong in the
// denominator. Returns 0 when there were no read-side tokens (avoids /0).
export function cacheHitRate(
  inputTokens: number,
  cacheWriteTokens: number,
  cacheReadTokens: number,
): number {
  const denom = inputTokens + cacheWriteTokens + cacheReadTokens;
  return denom > 0 ? cacheReadTokens / denom : 0;
}

export interface ModelStats {
  model: string;
  tool: Tool;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  cost: number; // notional, API-rate
  unpriced: boolean;
  sessions: number; // distinct session ids that used this model
  cacheHitRate: number;
  avgTokensPerSession: number;
  avgCostPerSession: number;
}

// Per-model aggregation for the model-compare surface: token totals, notional
// cost, distinct-session count, cache-hit-rate, and per-session averages.
// Keyed by [tool, model] to match aggregate()'s byModel grouping; sorted by
// total tokens descending.
export function modelStats(
  records: UsageRecord[],
  pricing: PricingTable = defaultPricing,
): ModelStats[] {
  interface Acc {
    model: string;
    tool: Tool;
    inputTokens: number;
    outputTokens: number;
    cacheWriteTokens: number;
    cacheReadTokens: number;
    totalTokens: number;
    cost: number;
    unpriced: boolean;
    sessions: Set<string>;
  }
  const map = new Map<string, Acc>();

  for (const r of records) {
    const key = JSON.stringify([r.tool, r.model]);
    let a = map.get(key);
    if (!a) {
      a = {
        model: r.model,
        tool: r.tool,
        inputTokens: 0,
        outputTokens: 0,
        cacheWriteTokens: 0,
        cacheReadTokens: 0,
        totalTokens: 0,
        cost: 0,
        unpriced: !isPriced(r.model, pricing),
        sessions: new Set(),
      };
      map.set(key, a);
    }
    a.inputTokens += r.inputTokens;
    a.outputTokens += r.outputTokens;
    a.cacheWriteTokens += r.cacheWriteTokens;
    a.cacheReadTokens += r.cacheReadTokens;
    a.totalTokens += totalTokens(r);
    a.cost += cost(r, pricing);
    if (r.sessionId) a.sessions.add(r.sessionId);
  }

  const out: ModelStats[] = [];
  for (const a of map.values()) {
    const sessions = a.sessions.size;
    out.push({
      model: a.model,
      tool: a.tool,
      inputTokens: a.inputTokens,
      outputTokens: a.outputTokens,
      cacheWriteTokens: a.cacheWriteTokens,
      cacheReadTokens: a.cacheReadTokens,
      totalTokens: a.totalTokens,
      cost: a.cost,
      unpriced: a.unpriced,
      sessions,
      cacheHitRate: cacheHitRate(
        a.inputTokens,
        a.cacheWriteTokens,
        a.cacheReadTokens,
      ),
      avgTokensPerSession: sessions > 0 ? a.totalTokens / sessions : 0,
      avgCostPerSession: sessions > 0 ? a.cost / sessions : 0,
    });
  }
  out.sort((x, y) => y.totalTokens - x.totalTokens);
  return out;
}
