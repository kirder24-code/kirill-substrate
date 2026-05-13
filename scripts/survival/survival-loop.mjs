/**
 * scripts/survival/survival-loop.mjs
 *
 * Cortex-launcher facing facade. Implements the register(bus) contract
 * the launcher expects. On boot:
 *   - opens DBs (resource-ledger + policy-registry)
 *   - seeds initial strategies if registry empty
 *   - reads contract.md hash and broadcasts session_started_with_contract
 *   - subscribes to bus events that should trigger ticks
 *
 * Does NOT auto-tick. Ticking is the responsibility of pulse-daemon
 * which calls runOneTick() from experiment-runner.mjs after the armed
 * flag check.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

import { openLedger, survivalProjection } from "./resource-ledger.mjs";
import { openRegistry, listSelectable } from "./policy-registry.mjs";
import { seedInitialStrategies } from "./experiment-runner.mjs";
import { isArmed } from "./armed-flag.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const CONTRACT_PATH = resolve(__dirname, "contract.md");

let _busRef = null;

function contractHash() {
  if (!existsSync(CONTRACT_PATH)) return null;
  const txt = readFileSync(CONTRACT_PATH, "utf-8");
  return crypto.createHash("sha256").update(txt).digest("hex").slice(0, 12);
}

export function register(bus) {
  _busRef = bus;
  // Initialize storage layers.
  openLedger().close();
  openRegistry().close();
  // Seed strategies if empty.
  if (listSelectable().length === 0) {
    seedInitialStrategies();
  }
  // Broadcast contract pin so any downstream module sees the version.
  try {
    bus.broadcast({
      source: "survival-loop",
      type: "session_started_with_contract",
      data: {
        contract_hash: contractHash(),
        contract_path: CONTRACT_PATH,
        wallet_address: process.env.SURVIVAL_WALLET_ADDRESS || null,
        armed: isArmed(),
      },
    });
  } catch {}
}

export async function status() {
  const proj = await survivalProjection({ address: process.env.SURVIVAL_WALLET_ADDRESS });
  return {
    armed: isArmed(),
    contract_hash: contractHash(),
    selectable_strategies: listSelectable().length,
    survival: proj,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(await status(), null, 2));
}
