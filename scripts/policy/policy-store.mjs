/**
 * scripts/policy/policy-store.mjs
 *
 * Minimum policy store: SQLite-backed table of weights for
 * (action_id, variant_id, context_bucket). Used by select-action.mjs and
 * update-policy.mjs to satisfy the Counterfactual Policy Ablation gate
 * (see scripts/policy/ablation.test.mjs).
 *
 * Schema is deliberately small. The store is a posterior counter: Laplace-
 * smoothed success rate per (action, variant, context). Sampling weight =
 * (n_successes + 1) / (n_attempts + K) where K = number of variants in the
 * same (action, context) bucket. update_policy increments either n_attempts
 * (failure) or both n_attempts and n_successes (success).
 *
 * The store does NOT decide whether an outcome is verified. That contract
 * lives at the call site (verifier-first ledger, phase 3). The store is
 * dumb on purpose.
 */

import Database from "better-sqlite3";
import { resolve, dirname } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DEFAULT_DB_PATH = resolve(ROOT, ".data/organism.db");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS policy_weights (
  action_id      TEXT NOT NULL,
  variant_id     TEXT NOT NULL,
  context_bucket TEXT NOT NULL,
  n_attempts     INTEGER NOT NULL DEFAULT 0,
  n_successes    INTEGER NOT NULL DEFAULT 0,
  last_updated   TEXT,
  PRIMARY KEY (action_id, variant_id, context_bucket)
);
`;

export function openPolicyStore(dbPath = DEFAULT_DB_PATH) {
  if (dbPath !== ":memory:") {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  const db = new Database(dbPath);
  db.exec(SCHEMA);
  return {
    db,
    registerVariant,
    listVariants,
    bumpAttempt,
    bumpSuccess,
    getRow,
    close: () => db.close(),
  };

  function registerVariant(action_id, variant_id, context_bucket) {
    db.prepare(
      `INSERT OR IGNORE INTO policy_weights (action_id, variant_id, context_bucket)
       VALUES (?, ?, ?)`
    ).run(action_id, variant_id, context_bucket);
  }

  function listVariants(action_id, context_bucket) {
    return db
      .prepare(
        `SELECT variant_id, n_attempts, n_successes
         FROM policy_weights
         WHERE action_id = ? AND context_bucket = ?
         ORDER BY variant_id`
      )
      .all(action_id, context_bucket);
  }

  function bumpAttempt(action_id, variant_id, context_bucket) {
    db.prepare(
      `UPDATE policy_weights
       SET n_attempts = n_attempts + 1, last_updated = ?
       WHERE action_id = ? AND variant_id = ? AND context_bucket = ?`
    ).run(new Date().toISOString(), action_id, variant_id, context_bucket);
  }

  function bumpSuccess(action_id, variant_id, context_bucket) {
    db.prepare(
      `UPDATE policy_weights
       SET n_successes = n_successes + 1, last_updated = ?
       WHERE action_id = ? AND variant_id = ? AND context_bucket = ?`
    ).run(new Date().toISOString(), action_id, variant_id, context_bucket);
  }

  function getRow(action_id, variant_id, context_bucket) {
    return db
      .prepare(
        `SELECT * FROM policy_weights
         WHERE action_id = ? AND variant_id = ? AND context_bucket = ?`
      )
      .get(action_id, variant_id, context_bucket);
  }
}
