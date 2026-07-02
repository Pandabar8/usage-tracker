// src/components/Overview.tsx
import type { Rollups } from "../lib/aggregate";
import { fmtCompact, fmtUsd } from "../lib/format";
import StatCard from "./StatCard";

function pctDelta(pts: number[]): number | null {
  if (pts.length < 2) return null;
  const mid = Math.floor(pts.length / 2);
  const first = pts.slice(0, mid).reduce((a, b) => a + b, 0);
  const second = pts.slice(mid).reduce((a, b) => a + b, 0);
  if (first === 0) return null;
  return Math.round(((second - first) / first) * 100);
}

export default function Overview({ data }: { data: Rollups }) {
  const totalTokens = data.byDay.map((d) => d.claudeTokens + d.codexTokens);
  const totalCost = data.byDay.map((d) => d.claudeCost + d.codexCost);
  const claudeTokens = data.byDay.map((d) => d.claudeTokens);
  const codexTokens = data.byDay.map((d) => d.codexTokens);

  return (
    <div className="grid cards4">
      <StatCard
        label="Total tokens"
        value={fmtCompact(data.totals.combined.tokens)}
        deltaPct={pctDelta(totalTokens)}
        color="var(--primary)"
        points={totalTokens}
      />
      <StatCard
        label="Est. cost"
        value={fmtUsd(data.totals.combined.cost)}
        deltaPct={pctDelta(totalCost)}
        color="var(--mint)"
        points={totalCost}
      />
      <StatCard
        label="Claude"
        value={fmtCompact(data.totals.claude.tokens)}
        deltaPct={pctDelta(claudeTokens)}
        color="var(--claude)"
        points={claudeTokens}
      />
      <StatCard
        label="Codex"
        value={fmtCompact(data.totals.codex.tokens)}
        deltaPct={pctDelta(codexTokens)}
        color="var(--codex)"
        points={codexTokens}
      />
    </div>
  );
}
