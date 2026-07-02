// src/components/CacheGauge.tsx
const ARC_LEN = 94; // path length of the semicircle arc used below

export default function CacheGauge({ rate }: { rate: number }) {
  const clamped = Math.max(0, Math.min(1, rate));
  const dash = clamped * ARC_LEN;
  return (
    <div className="gaugewrap">
      <svg width="72" height="42" viewBox="0 0 72 42">
        <path
          d="M6 40 A30 30 0 0 1 66 40"
          fill="none"
          stroke="#0e1218"
          strokeWidth="7"
          strokeLinecap="round"
        />
        <path
          d="M6 40 A30 30 0 0 1 66 40"
          fill="none"
          stroke="#4fd6a8"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${ARC_LEN}`}
        />
      </svg>
      <div className="txt">
        <div className="big">{Math.round(clamped * 100)}%</div>
        <div className="lbl">cache hit rate</div>
      </div>
    </div>
  );
}
