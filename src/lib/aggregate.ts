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

  for (const r of records) {
    const tokens = totalTokens(r);
    const c = cost(r, pricing);

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
  };
}
