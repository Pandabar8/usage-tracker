// src/components/Tips.tsx
import type { Tip } from "../lib/normalize";

export default function Tips({ tips }: { tips: Tip[] }) {
  if (!tips.length) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-medium">Tips</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {tips.map((t) => (
          <div
            key={t.id}
            className={`rounded-xl p-4 border ${
              t.severity === "warn"
                ? "border-amber-500/40 bg-amber-500/5"
                : "border-neutral-800 bg-neutral-900"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium text-neutral-200">
                {t.title}
              </div>
              {t.savingsUsd != null ? (
                <div className="text-sm text-emerald-400 whitespace-nowrap">
                  save ~${t.savingsUsd.toFixed(2)}
                </div>
              ) : null}
            </div>
            <p className="text-sm text-neutral-400 mt-1">{t.detail}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
