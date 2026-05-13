/**
 * scripts/survival/armed-flag.mjs
 *
 * Explicit safety: the survival_loop does NOT tick automatically until
 * Kirill creates a file `.data/survival-armed.flag` with content "armed".
 * Without this file, every tick attempt is a no-op that logs "disarmed".
 *
 * This is independent of budget-guard. It exists to protect against
 * accidentally starting a 24/7 loop before Kirill is ready.
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const FLAG_PATH = resolve(ROOT, ".data/survival-armed.flag");

export function isArmed() {
  if (!existsSync(FLAG_PATH)) return false;
  try {
    return readFileSync(FLAG_PATH, "utf-8").trim().toLowerCase() === "armed";
  } catch {
    return false;
  }
}

export function arm() {
  writeFileSync(FLAG_PATH, "armed\n");
  return { armed: true, path: FLAG_PATH };
}

export function disarm() {
  if (existsSync(FLAG_PATH)) unlinkSync(FLAG_PATH);
  return { armed: false };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2];
  if (cmd === "arm") console.log(JSON.stringify(arm()));
  else if (cmd === "disarm") console.log(JSON.stringify(disarm()));
  else console.log(JSON.stringify({ armed: isArmed(), path: FLAG_PATH }));
}
