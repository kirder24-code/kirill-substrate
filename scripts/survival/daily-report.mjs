/**
 * scripts/survival/daily-report.mjs
 *
 * Daily aggregator. Reports the last 7 days of survival_loop activity:
 *   - tick count + action distribution
 *   - LLM spend per day vs cap
 *   - wallet balance trajectory + system-attributed deltas
 *   - strategies retired
 *   - falsification check (per contract.md)
 *
 * Pure read of survival.db + experiment-log.jsonl. No LLM, no mutation.
 */

import Database from "better-sqlite3";
import { resolve, dirname } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DB_PATH = resolve(ROOT, ".data/survival.db");
const LOG_PATH = resolve(ROOT, ".data/survival-experiment-log.jsonl");

function db() { return new Database(DB_PATH, { readonly: true }); }

function spendByDay(days = 7) {
  const con = db();
  const rows = con.prepare(
    `SELECT date(ts) as day, SUM(cost_usd) as total_usd, COUNT(*) as calls
     FROM llm_call_log WHERE ts >= datetime('now', ?)
     GROUP BY day ORDER BY day`
  ).all(`-${days} days`);
  con.close();
  return rows;
}

function strategyStatus() {
  const con = db();
  const rows = con.prepare(
    `SELECT status, COUNT(*) AS n, COALESCE(SUM(food_received_usd), 0) AS food, COALESCE(SUM(total_cost_usd), 0) AS spent
     FROM policy_strategies GROUP BY status`
  ).all();
  con.close();
  return rows;
}

function recentRetirements() {
  const con = db();
  const rows = con.prepare(
    `SELECT id, action_id, status_changed_at, retire_reason
     FROM policy_strategies WHERE status = 'retired'
     ORDER BY status_changed_at DESC LIMIT 10`
  ).all();
  con.close();
  return rows;
}

function walletTrajectory(days = 7) {
  const con = db();
  const rows = con.prepare(
    `SELECT date(ts) as day, MIN(balance_usd) as min_usd, MAX(balance_usd) as max_usd, COUNT(*) as polls
     FROM wallet_snapshots WHERE ts >= datetime('now', ?)
     GROUP BY day ORDER BY day`
  ).all(`-${days} days`);
  con.close();
  return rows;
}

function systemAttributedDeltas() {
  if (!existsSync(LOG_PATH)) return { count: 0, total_usd: 0 };
  const lines = readFileSync(LOG_PATH, "utf-8").split("\n").filter(Boolean);
  let count = 0, total = 0;
  for (const l of lines) {
    try {
      const e = JSON.parse(l);
      if (e.kind === "wallet_poll" && e.food_attributed_to && e.delta_usd > 0) {
        count++;
        total += e.delta_usd;
      }
    } catch {}
  }
  return { count, total_usd: total };
}

const report = {
  generated_at: new Date().toISOString(),
  spend_by_day: spendByDay(7),
  strategy_status: strategyStatus(),
  recent_retirements: recentRetirements(),
  wallet_trajectory: walletTrajectory(7),
  system_attributed_food: systemAttributedDeltas(),
};

const totalSpent7d = report.spend_by_day.reduce((a, r) => a + (r.total_usd || 0), 0);
const totalCalls7d = report.spend_by_day.reduce((a, r) => a + (r.calls || 0), 0);
const retiredCount = (report.strategy_status.find(s => s.status === "retired")?.n) || 0;

const falsified =
  report.system_attributed_food.count === 0 && retiredCount === 0;

report.headline = {
  total_spent_7d_usd: totalSpent7d,
  total_calls_7d: totalCalls7d,
  food_events: report.system_attributed_food.count,
  food_total_usd: report.system_attributed_food.total_usd,
  strategies_retired_count: retiredCount,
  falsification_per_contract: falsified
    ? "FALSIFIED — no system-attributed food and no auto-retired strategies"
    : "NOT FALSIFIED — at least one of {food, retirement} occurred",
};

console.log(JSON.stringify(report, null, 2));
