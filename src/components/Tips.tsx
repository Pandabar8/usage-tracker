// src/components/Tips.tsx
import type { Tip } from "../lib/normalize";

export default function Tips({ tips }: { tips: Tip[] }) {
  if (!tips.length) return null;
  return (
    <div className="tips">
      {tips.map((t) => (
        <div
          key={t.id}
          className={`tip ${t.severity === "warn" ? "warn" : ""}`}
        >
          <p className="tt">{t.title}</p>
          <p className="td">{t.detail}</p>
          {t.savingsUsd != null ? (
            <span className="save">save ~${t.savingsUsd.toFixed(2)}</span>
          ) : null}
        </div>
      ))}
    </div>
  );
}
