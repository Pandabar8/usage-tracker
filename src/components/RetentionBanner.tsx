// src/components/RetentionBanner.tsx
export default function RetentionBanner({
  risky,
  days,
}: {
  risky: boolean;
  days: number;
}) {
  if (!risky) return null;
  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
      <div className="font-medium">
        Claude is set to delete usage history after {days} days.
      </div>
      <p className="mt-1 text-amber-200/80">
        Run{" "}
        <code className="rounded bg-neutral-800 px-1 py-0.5 text-amber-100">
          npm run fix-retention
        </code>{" "}
        to raise the retention window so past usage is not lost.
      </p>
    </div>
  );
}
