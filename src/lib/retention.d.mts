// src/lib/retention.d.mts
export const RETENTION_TARGET_DAYS: number;
export function raiseRetention(
  obj: Record<string, unknown>,
  targetDays?: number,
): { next: Record<string, unknown>; changed: boolean };
export function raiseRetentionInFile(
  settingsPath: string,
  targetDays?: number,
): {
  before: number | null;
  after: number;
  changed: boolean;
  existed: boolean;
  path: string;
};
