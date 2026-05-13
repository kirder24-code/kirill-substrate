/**
 * scripts/survival/policy-registry.mjs
 *
 * Strategies as first-class persistent records. Each strategy is one
 * (action_id, context_hash, parameters) combo. Status transitions:
 *
 *   active     -> probation  (below median fitness for 14 days)
 *   probation  -> retired    (budget cap exhausted without food signal)
 *   probation  -> active     (positive food signal lands)
 *   retired    -> (terminal, never re-selected)
 *
 * `retired` is permanent — survives launcher restarts, written to SQLite
 * with status flag.
 */

import Database from "better-sqlite3";
import { resolve, dirname } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DB_PATH = resolve(ROOT, ".data/survival.db");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS policy_strategies (
  id              TEXT PRIMARY KEY,
  action_id       TEXT NOT NULL,
  context_hash    TEXT NOT NULL,
  parameters_json TEXT,
  status          TEXT NOT NULL DEFAULT 'active',  -- active | probation | retired
  created_at      TEXT NOT NULL,
  status_changed_at TEXT NOT NULL,
  retire_reason   TEXT,
  parent_strategy_id TEXT,                          -- if mutated from another
  attempts        INTEGER NOT NULL DEFAULT 0,
  observations    INTEGER NOT NULL DEFAULT 0,
  successes       INTEGER NOT NULL DEFAULT 0,
  total_cost_usd  REAL NOT NULL DEFAULT 0.0,
  food_received_usd REAL NOT NULL DEFAULT 0.0
);
CREATE INDEX IF NOT EXISTS idx_strategies_status ON policy_strategies(status);
CREATE INDEX IF NOT EXISTS idx_strategies_action ON policy_strategies(action_id);
`;

function ensureDir(p) {
  const d = dirname(p);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

export function openRegistry() {
  ensureDir(DB_PATH);
  const db = new Database(DB_PATH);
  db.exec(SCHEMA);
  return db;
}

export function registerStrategy({ id, action_id, context_hash, parameters, parent_strategy_id }) {
  const db = openRegistry();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO policy_strategies
     (id, action_id, context_hash, parameters_json, status, created_at, status_changed_at, parent_strategy_id)
     VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`
  ).run(id, action_id, context_hash, JSON.stringify(parameters || {}), now, now, parent_strategy_id || null);
  db.close();
}

export function listSelectable() {
  const db = openRegistry();
  const rows = db
    .prepare(`SELECT * FROM policy_strategies WHERE status IN ('active','probation') ORDER BY id`)
    .all();
  db.close();
  return rows;
}

export function recordAttempt({ strategy_id, cost_usd }) {
  const db = openRegistry();
  db.prepare(
    `UPDATE policy_strategies SET attempts = attempts + 1, total_cost_usd = total_cost_usd + ?
     WHERE id = ?`
  ).run(cost_usd, strategy_id);
  db.close();
}

export function recordObservation({ strategy_id, food_signal_usd }) {
  const db = openRegistry();
  const food = food_signal_usd > 0 ? food_signal_usd : 0;
  db.prepare(
    `UPDATE policy_strategies
     SET observations = observations + 1,
         successes = successes + (CASE WHEN ? > 0 THEN 1 ELSE 0 END),
         food_received_usd = food_received_usd + ?
     WHERE id = ?`
  ).run(food_signal_usd, food, strategy_id);
  db.close();
}

const STRATEGY_BUDGET_CAP_USD = 1.00;

export function evaluateAndRetire() {
  const db = openRegistry();
  const candidates = db
    .prepare(
      `SELECT * FROM policy_strategies
       WHERE status IN ('active','probation')
         AND total_cost_usd >= ?
         AND food_received_usd = 0`
    )
    .all(STRATEGY_BUDGET_CAP_USD);

  const retired = [];
  const stamp = new Date().toISOString();
  for (const row of candidates) {
    db.prepare(
      `UPDATE policy_strategies
       SET status = 'retired', status_changed_at = ?,
           retire_reason = ?
       WHERE id = ?`
    ).run(stamp, `budget_cap_exhausted_no_food (spent $${row.total_cost_usd.toFixed(4)})`, row.id);
    retired.push(row.id);
  }
  db.close();
  return retired;
}

export function fitness(strategy) {
  // Laplace-smoothed: (food_per_dollar_spent + 1) / (attempts + K)
  const K = 3;
  const food = strategy.food_received_usd || 0;
  const cost = strategy.total_cost_usd || 0;
  const fitness_raw = cost > 0 ? food / cost : 0;
  return (fitness_raw + 1) / (strategy.attempts + K);
}

export function pickStrategy({ rng = Math.random } = {}) {
  const candidates = listSelectable();
  if (candidates.length === 0) return null;
  const weights = candidates.map(fitness);
  const total = weights.reduce((a, b) => a + b, 0);
  const r = rng() * total;
  let acc = 0;
  for (let i = 0; i < candidates.length; i++) {
    acc += weights[i];
    if (r < acc) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify({ selectable: listSelectable().length }, null, 2));
}
