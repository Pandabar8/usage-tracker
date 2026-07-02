// src/components/ModelDonut.tsx
import type { ModelPoint, Rollups } from "../lib/aggregate";

function modelColor(m: ModelPoint): string {
  if (m.tool === "codex") return "#a486f7";
  const n = m.model.toLowerCase();
  if (n.includes("opus")) return "#e88a4e";
  if (n.includes("sonnet")) return "#f2ad76";
  if (n.includes("haiku")) return "#b5652b";
  return "#c56a2e";
}

const R = 15.9;
const C = 2 * Math.PI * R; // ~99.9 circumference units

export default function ModelDonut({ data }: { data: Rollups }) {
  const total = data.byModel.reduce((a, m) => a + m.tokens, 0) || 1;
  let offset = 25; // start at top (mockup convention)
  const segments = data.byModel.map((m) => {
    const pct = (m.tokens / total) * 100;
    const len = (pct / 100) * C;
    const seg = {
      color: modelColor(m),
      dash: `${len} ${C - len}`,
      dashoffset: offset,
      model: m.model,
      pct,
    };
    offset = (offset - len + C) % C;
    return seg;
  });
  const top = segments.slice(0, 4);

  return (
    <div className="donutwrap">
      <svg width="112" height="112" viewBox="0 0 42 42">
        <circle
          cx="21"
          cy="21"
          r={R}
          fill="none"
          stroke="#0e1218"
          strokeWidth="6"
        />
        {segments.map((s, i) => (
          <circle
            key={i}
            cx="21"
            cy="21"
            r={R}
            fill="none"
            stroke={s.color}
            strokeWidth="6"
            strokeDasharray={s.dash}
            strokeDashoffset={s.dashoffset}
          />
        ))}
        <text
          x="21"
          y="20"
          textAnchor="middle"
          className="mono"
          fill="#e8ecf2"
          fontSize="6"
          fontWeight="700"
        >
          {data.byModel.length}
        </text>
        <text x="21" y="26" textAnchor="middle" fill="#5c6675" fontSize="3">
          models
        </text>
      </svg>
      <div className="metrics">
        {top.map((s) => (
          <div className="m" key={s.model}>
            <span className="nm">
              <i className="sw" style={{ background: s.color }} />
              {s.model}
            </span>
            <span className="val">{Math.round(s.pct)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
