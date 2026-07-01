#!/usr/bin/env node
// Raises Claude Code's cleanupPeriodDays so usage history is not auto-deleted.
// Safe read-modify-write: preserves every other key, aborts without writing on a
// parse error, and is safe to run repeatedly. Pass a path as the first argument
// to target a file other than ~/.claude/settings.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  raiseRetention,
  RETENTION_TARGET_DAYS,
} from "../src/lib/retention.mjs";

function run(settingsPath) {
  let obj = {};
  const existed = existsSync(settingsPath);

  if (existed) {
    let raw;
    try {
      raw = readFileSync(settingsPath, "utf8");
    } catch (err) {
      console.error(`Could not read ${settingsPath}: ${err.message}`);
      process.exit(1);
    }
    try {
      obj = JSON.parse(raw);
    } catch {
      console.error(
        `Refusing to write: ${settingsPath} is not valid JSON. Fix it by hand first.`,
      );
      process.exit(1);
    }
    if (typeof obj !== "object" || obj === null || Array.isArray(obj)) {
      console.error(`Refusing to write: ${settingsPath} is not a JSON object.`);
      process.exit(1);
    }
  } else {
    console.log(`No settings file at ${settingsPath}; creating a minimal one.`);
  }

  const before =
    typeof obj.cleanupPeriodDays === "number"
      ? obj.cleanupPeriodDays
      : "(unset, defaults to 30)";
  const { next, changed } = raiseRetention(obj, RETENTION_TARGET_DAYS);

  if (!changed && existed) {
    console.log(`cleanupPeriodDays already ${before}; nothing to do.`);
    return;
  }

  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, JSON.stringify(next, null, 2) + "\n");
  console.log(`cleanupPeriodDays: ${before} -> ${next.cleanupPeriodDays}`);
  console.log(`Wrote ${settingsPath}`);
}

const target = process.argv[2] ?? join(homedir(), ".claude", "settings.json");
run(target);
