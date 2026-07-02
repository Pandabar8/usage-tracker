// src/components/StatCard.tsx
function sparkPoints(pts: number[]): string {
  if (pts.length === 0) return "0,29 96,29";
  const max = Math.max(...pts, 1);
  const n = pts.length;
  return pts
    .map((v, i) => {
      const x = n === 1 ? 0 : (i / (n - 1)) * 96;
      const y = 30 - (v / max) * 28 - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export default function StatCard({
  label,
  value,
  deltaPct,
  color,
  points,
}: {
  label: string;
  value: string;
  deltaPct: number | null;
  color: string;
  points: number[];
}) {
  const up = (deltaPct ?? 0) >= 0;
  return (
    <div className="card stat">
      <div className="k">{label}</div>
      <div className="v">{value}</div>
      <div className="foot">
        {deltaPct == null ? (
          <span className="delta" style={{ color: "var(--faint)" }}>
            —
          </span>
        ) : (
          <span className={`delta ${up ? "up" : "down"}`}>
            {up ? "▲" : "▼"} {Math.abs(deltaPct)}%
          </span>
        )}
        <svg className="spark" viewBox="0 0 96 30" preserveAspectRatio="none">
          <polyline
            fill="none"
            stroke={color}
            strokeWidth="2"
            points={sparkPoints(points)}
          />
        </svg>
      </div>
    </div>
  );
}
