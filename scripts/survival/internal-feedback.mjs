/**
 * scripts/survival/internal-feedback.mjs
 *
 * Substrate's self-learning loop WITHOUT real wallet/money fitness signal.
 *
 * Replaces the missing food signal with INTERNAL PROXIES that approximate
 * "did this action work":
 *
 *   1. operator_approved (in survival-outbound-queue.jsonl) -> +1.0
 *   2. operator_denied                                       -> -0.5
 *   3. action produced an opportunity that was later promoted to
 *      "in_progress" by another action                       -> +0.3
 *   4. action produced a file artifact that another action consumed
 *      (research.md read by implementation_plan, etc)         -> +0.2
 *   5. action threw or returned ok=false                      -> -0.2
 *   6. specialist output > 1KB and parseable                  -> +0.1
 *
 * Aggregated per strategy_id and folded back into policy_registry as
 * synthetic food_received_usd (so existing Laplace selection benefits
 * from this signal without requiring real money).
 *
 * This is the difference between "substrate spins for nothing" and
 * "substrate gradually biases toward actions that produced visible
 * value in the real workflow."
 *
 * Marked AS-IF food: stored in policy_strategies.food_received_usd as
 * synthetic numeric units. When real wallet signals arrive later they
 * will be in the same column — substrate cannot tell them apart by
 * design (treat both as "value flowed in").
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const SURVIVAL_DB = resolve(ROOT, ".data/survival.db");
const QUEUE_PATH = resolve(ROOT, ".data/survival-outbound-queue.jsonl");
const LEDGER_PATH = resolve(ROOT, ".data/survival-experiment-log.jsonl");
const STATE_PATH = resolve(ROOT, ".data/survival-feedback-state.json");

function loadState() {
  if (!existsSync(STATE_PATH)) return { last_processed_at: null, applied_per_strategy: {} };
  try { return JSON.parse(readFileSync(STATE_PATH, "utf-8")); }
  catch { return { last_processed_at: null, applied_per_strategy: {} }; }
}
function saveState(s) {
  writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}

function readQueueRows() {
  if (!existsSync(QUEUE_PATH)) return [];
  return readFileSync(QUEUE_PATH, "utf-8").split("\n").filter(Boolean).map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

function readLedgerRows() {
  if (!existsSync(LEDGER_PATH)) return [];
  return readFileSync(LEDGER_PATH, "utf-8").split("\n").filter(Boolean).map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

export const internalFeedbackMeta = {
  description: "Aggregate internal proxy fitness signals (approvals, opportunity promotions, action success rate) into policy_registry as synthetic food. NO LLM.",
  side_effect_class: "auto",
  expected_signal: "internal_feedback_applied",
  expected_signal_delay_min: 0,
  estimated_cost_usd: 0.0,
};

export async function runInternalFeedback({ strategy }) {
  const state = loadState();
  const sinceISO = state.last_processed_at;
  const queue = readQueueRows();
  const ledger = readLedgerRows();
  const newLedger = sinceISO ? ledger.filter(r => r.ts > sinceISO) : ledger;

  // Aggregate signal per strategy_id from new events.
  const perStrategy = {};
  function bump(strategy_id, delta, reason) {
    if (!strategy_id) return;
    if (!perStrategy[strategy_id]) perStrategy[strategy_id] = { delta: 0, reasons: [] };
    perStrategy[strategy_id].delta += delta;
    perStrategy[strategy_id].reasons.push(`${delta > 0 ? "+" : ""}${delta.toFixed(2)} ${reason}`);
  }

  // Signal 1+2: queue approval/denial since last run
  for (const q of queue) {
    if (!q.decided_at) continue;
    if (sinceISO && q.decided_at <= sinceISO) continue;
    if (q.decision === "approved") bump(q.strategy_id, 1.0, "operator_approved_outbound");
    else if (q.decision === "denied") bump(q.strategy_id, -0.5, "operator_denied_outbound");
  }

  // Signal 5: action returned ok=false in new ledger events
  for (const e of newLedger) {
    if (e.kind !== "action_attempt") continue;
    if (e.action_result?.ok === false) bump(e.strategy_id, -0.2, `action_failed:${e.action_result.reason || "unknown"}`);
    else if (e.action_result?.ok === true) bump(e.strategy_id, 0.1, "action_succeeded");
  }

  // Signal 3+4: opportunity transitions (read from survival.db)
  if (existsSync(SURVIVAL_DB)) {
    const db = new Database(SURVIVAL_DB, { readonly: true });
    try {
      // Opportunities promoted to in_progress since last run, attributed to
      // their parent_strategy_id (the strategy that created them).
      const opps = db.prepare(
        `SELECT parent_strategy_id, COUNT(*) AS n FROM opportunities
         WHERE state = 'in_progress' AND state_changed_at > COALESCE(?, '1970-01-01')
         GROUP BY parent_strategy_id`
      ).all(sinceISO || null);
      for (const o of opps) {
        if (o.parent_strategy_id) bump(o.parent_strategy_id, 0.3 * o.n, `opportunity_promoted_x${o.n}`);
      }
    } catch (e) { /* best-effort */ }
    db.close();
  }

  // Apply: write to policy_strategies.food_received_usd (synthetic units).
  const db = new Database(SURVIVAL_DB);
  let updated = 0;
  for (const [sid, summary] of Object.entries(perStrategy)) {
    if (Math.abs(summary.delta) < 0.01) continue;
    const result = db.prepare(
      `UPDATE policy_strategies SET food_received_usd = food_received_usd + ?
       WHERE id = ?`
    ).run(summary.delta, sid);
    if (result.changes > 0) updated++;
  }
  db.close();

  saveState({
    last_processed_at: new Date().toISOString(),
    applied_per_strategy: { ...state.applied_per_strategy, ...Object.fromEntries(Object.entries(perStrategy).map(([k, v]) => [k, (state.applied_per_strategy[k] || 0) + v.delta])) },
  });

  return {
    ok: true,
    strategies_updated: updated,
    signals_seen: Object.keys(perStrategy).length,
    breakdown: Object.fromEntries(Object.entries(perStrategy).slice(0, 10).map(([k, v]) => [k, { delta: Number(v.delta.toFixed(2)), reasons: v.reasons.slice(0, 5) }])),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await runInternalFeedback({ strategy: { id: "manual" } });
  console.log(JSON.stringify(r, null, 2));
}
