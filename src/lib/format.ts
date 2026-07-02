// src/lib/format.ts
export function fmtTokens(n: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(n));
}
export function fmtCompact(n: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}
export function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}
