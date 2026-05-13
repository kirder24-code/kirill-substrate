/**
 * scripts/survival/external-observation.mjs
 *
 * Ingests world signals back into the survival_loop:
 *  - wallet balance deltas (food)
 *  - kirill manual approval/decision events
 *  - file-system effects of completed actions (output files exist, sizes)
 *
 * Each observation is attributed to a strategy_id and written to the
 * experiment log + policy registry.
 */

import { readWalletBalanceUSD } from "./resource-ledger.mjs";
import { recordObservation } from "./policy-registry.mjs";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const LOG_PATH = resolve(ROOT, ".data/survival-experiment-log.jsonl");

function ensureLog() {
  const d = dirname(LOG_PATH);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

let _lastWalletBalance = null;
let _lastWalletAddress = null;

/**
 * Poll wallet, compute delta vs last observation, attribute to most recent
 * pending strategy if positive. Returns the delta and any attribution.
 */
export async function pollWalletForFood({ address, recent_strategy_ids = [] }) {
  if (!address) return { ok: false, reason: "no_wallet" };
  const w = await readWalletBalanceUSD(address);
  if (!w.ok) return { ok: false, reason: w.reason };
  const delta = _lastWalletBalance === null ? 0 : (w.balance_usd - _lastWalletBalance);
  const previous = _lastWalletBalance;
  _lastWalletBalance = w.balance_usd;
  _lastWalletAddress = address;

  const event = {
    ts: new Date().toISOString(),
    kind: "wallet_poll",
    address,
    balance_usd: w.balance_usd,
    previous_balance_usd: previous,
    delta_usd: delta,
    food_attributed_to: null,
  };

  if (delta > 0 && recent_strategy_ids.length > 0) {
    // Attribution: simplest reasonable rule — distribute proportionally
    // across strategies that fired in the attribution window. For v1, give
    // the food signal to the most recent.
    const target = recent_strategy_ids[recent_strategy_ids.length - 1];
    recordObservation({ strategy_id: target, food_signal_usd: delta });
    event.food_attributed_to = target;
  }

  ensureLog();
  appendFileSync(LOG_PATH, JSON.stringify(event) + "\n");
  return { ok: true, ...event };
}

/**
 * Manual kirill approval/decision event.
 * approval_outcome: "approved" | "rejected" | "deferred"
 */
export function recordKirillDecision({ strategy_id, approval_outcome, note }) {
  const event = {
    ts: new Date().toISOString(),
    kind: "kirill_decision",
    strategy_id,
    approval_outcome,
    note: note || null,
  };
  ensureLog();
  appendFileSync(LOG_PATH, JSON.stringify(event) + "\n");
  // Note: this does NOT update fitness directly — only money in wallet
  // counts as food per contract.md. Approval is tracked for context only.
  return event;
}

/**
 * Record an action attempt (executor calls this immediately after running).
 */
export function recordActionAttempt({ strategy_id, action_id, action_result, cost_usd_estimated }) {
  const event = {
    ts: new Date().toISOString(),
    kind: "action_attempt",
    strategy_id,
    action_id,
    action_result,
    cost_usd_estimated,
  };
  ensureLog();
  appendFileSync(LOG_PATH, JSON.stringify(event) + "\n");
  return event;
}
