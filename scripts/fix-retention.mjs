#!/usr/bin/env node
// Raises Claude Code's cleanupPeriodDays so usage history is not auto-deleted.
// Safe read-modify-write: preserves every other key, aborts without writing on a
// parse error, and is safe to run repeatedly. Pass a path as the first argument
// to target a file other than ~/.claude/settings.json.
import { homedir } from "node:os";
import { join } from "node:path";
import {
  raiseRetentionInFile,
  RETENTION_TARGET_DAYS,
} from "../src/lib/retention.mjs";

function run(settingsPath) {
  let result;
  try {
    result = raiseRetentionInFile(settingsPath, RETENTION_TARGET_DAYS);
  } catch (err) {
    console.error(`Refusing to write: ${err.message}`);
    process.exit(1);
  }

  const { before, after, changed, existed } = result;
  const beforeLabel = before === null ? "(unset, defaults to 30)" : before;

  if (!existed) {
    console.log(`No settings file at ${settingsPath}; created a minimal one.`);
  }
  if (!changed && existed) {
    console.log(`cleanupPeriodDays already ${beforeLabel}; nothing to do.`);
    return;
  }
  console.log(`cleanupPeriodDays: ${beforeLabel} -> ${after}`);
  console.log(`Wrote ${settingsPath}`);
}

const target = process.argv[2] ?? join(homedir(), ".claude", "settings.json");
run(target);
