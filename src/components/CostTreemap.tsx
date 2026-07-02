// src/components/CostTreemap.tsx
import type { Rollups } from "../lib/aggregate";
import { fmtUsd } from "../lib/format";

interface Tile {
  project: string;
  cost: number;
  claude: boolean;
}

function toTiles(data: Rollups): Tile[] {
  const map = new Map<
    string,
    { cost: number; claudeCost: number; codexCost: number }
  >();
  for (const p of data.byProject) {
    const e = map.get(p.project) ?? { cost: 0, claudeCost: 0, codexCost: 0 };
    e.cost += p.cost;
    if (p.tool === "claude") e.claudeCost += p.cost;
    else e.codexCost += p.cost;
    map.set(p.project, e);
  }
  return [...map.entries()]
    .map(([project, e]) => ({
      project,
      cost: e.cost,
      claude: e.claudeCost >= e.codexCost,
    }))
    .filter((t) => t.cost > 0)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 8);
}

function span(cost: number, max: number): number {
  if (cost >= 0.5 * max) return 3;
  if (cost >= 0.25 * max) return 2;
  return 1;
}

export default function CostTreemap({ data }: { data: Rollups }) {
  const tiles = toTiles(data);
  const max = tiles.reduce((m, t) => Math.max(m, t.cost), 0) || 1;
  return (
    <div className="tree">
      {tiles.map((t) => {
        const s = span(t.cost, max);
        const bg = t.claude
          ? "linear-gradient(140deg,#e88a4e,#c56a2e)"
          : "linear-gradient(140deg,#a486f7,#7c5fd6)";
        return (
          <div
            className="tile"
            key={t.project}
            style={{
              gridColumn: `span ${s}`,
              gridRow: `span ${s}`,
              background: bg,
            }}
          >
            <div className="tn">{t.project}</div>
            <div className="tv">{fmtUsd(t.cost)}</div>
          </div>
        );
      })}
    </div>
  );
}
