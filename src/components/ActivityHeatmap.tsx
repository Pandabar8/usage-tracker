// src/components/ActivityHeatmap.tsx
import type { CalendarDay } from "../lib/charts";

function cellColor(d: CalendarDay, max: number): string {
  if (d.total <= 0) return "#0e1218";
  const share = d.claudeTokens / d.total; // 1 = all Claude, 0 = all Codex
  const r = Math.round(232 * share + 164 * (1 - share));
  const g = Math.round(138 * share + 134 * (1 - share));
  const b = Math.round(78 * share + 247 * (1 - share));
  const intensity = max > 0 ? d.total / max : 0;
  return `rgba(${r},${g},${b},${(0.18 + intensity * 0.82).toFixed(3)})`;
}

export default function ActivityHeatmap({
  calendar,
}: {
  calendar: CalendarDay[];
}) {
  const max = calendar.reduce((m, d) => Math.max(m, d.total), 0);
  const weeks: CalendarDay[][] = [];
  for (let i = 0; i < calendar.length; i += 7)
    weeks.push(calendar.slice(i, i + 7));

  return (
    <div>
      <div className="heat">
        {weeks.map((week, wi) => (
          <div className="heatcol" key={wi}>
            {week.map((d) => (
              <div
                className="cell"
                key={d.date}
                title={`${d.date}: ${d.total.toLocaleString()} tokens`}
                style={{ background: cellColor(d, max) }}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="heatscale">
        <span>less</span>
        <span className="cell" style={{ background: "#141a22" }} />
        <span className="cell" style={{ background: "#4a3320" }} />
        <span className="cell" style={{ background: "#8a5a34" }} />
        <span className="cell" style={{ background: "#e88a4e" }} />
        <span>more</span>
        <span style={{ marginLeft: 14, color: "var(--claude)" }}>■ Claude</span>
        <span style={{ color: "var(--codex)" }}>■ Codex</span>
      </div>
    </div>
  );
}
