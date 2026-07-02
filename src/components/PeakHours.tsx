// src/components/PeakHours.tsx
export default function PeakHours({ hours }: { hours: number[] }) {
  const max = Math.max(...hours, 1);
  return (
    <div>
      <div className="bars">
        {hours.map((v, i) => (
          <div
            key={i}
            className="b"
            title={`${String(i).padStart(2, "0")}:00 — ${v} turns`}
            style={{
              height: `${(v / max) * 100}%`,
              ...(v === max
                ? {
                    background:
                      "linear-gradient(180deg,var(--primary),#4ac0e055)",
                  }
                : {}),
            }}
          />
        ))}
      </div>
      <div className="axis">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>23</span>
      </div>
    </div>
  );
}
