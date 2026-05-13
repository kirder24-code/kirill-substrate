/**
 * scripts/policy/outcome-ledger.mjs
 *
 * VERIFIER-FIRST OUTCOME LEDGER (phase 3 of the council plan)
 *
 * An outcome record may update the policy store ONLY if an independent
 * verifier (verifier_source) signs the verification AFTER the executor
 * (executor_source) recorded the selection. The two sources must differ.
 *
 * This prevents the self-confirmation loop where the executor claims
 * "success" on actions it took and the policy learns from its own
 * unverified claims.
 *
 * Three entry points:
 *
 *   recordSelection({ ledger, action_id, variant_id, context_bucket,
 *                     context_snapshot, executor_source, mode })
 *     -> ledger_id
 *     Called by an executor when it has selected a variant. The row is
 *     created in pending state (verified_outcome NULL, no verifier yet).
 *     mode = "shadow" or "live". Shadow rows are observed but their
 *     verified outcomes do NOT update the policy store. Live rows do.
 *
 *   recordVerification({ ledger, ledger_id, observation, verified_outcome,
 *                        verifier_source })
 *     Independent verifier attaches an observation and outcome to a
 *     pending row. Throws if verifier_source === executor_source. Throws
 *     if the row is already verified. The verification step itself does
 *     NOT update the policy; that is applyVerifiedToPolicy's job.
 *
 *   applyVerifiedToPolicy({ ledger, store })
 *     -> { applied: int, skipped_shadow: int }
 *     Idempotent. Scans rows where verified_outcome is set and
 *     update_applied_at is NULL. For each LIVE row, calls updatePolicy.
 *     Marks the row as applied. SHADOW rows are passed over and counted
 *     in skipped_shadow.
 */

import Database from "better-sqlite3";
import { resolve, dirname } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { updatePolicy } from "./update-policy.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DEFAULT_DB_PATH = resolve(ROOT, ".data/organism.db");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS policy_outcome_ledger (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  action_id         TEXT NOT NULL,
  variant_id        TEXT NOT NULL,
  context_bucket    TEXT NOT NULL,
  context_snapshot  TEXT,
  executor_source   TEXT NOT NULL,
  mode              TEXT NOT NULL DEFAULT 'shadow',
  selected_at       TEXT NOT NULL,
  observation       TEXT,
  verified_outcome  TEXT,
  verifier_source   TEXT,
  verified_at       TEXT,
  update_applied_at TEXT
);
`;

export class VerifierContractError extends Error {}

export function openOutcomeLedger(dbPath = DEFAULT_DB_PATH) {
  if (dbPath !== ":memory:") {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  const db = new Database(dbPath);
  db.exec(SCHEMA);

  function recordSelection({
    action_id,
    variant_id,
    context_bucket,
    context_snapshot,
    executor_source,
    mode = "shadow",
  }) {
    if (!action_id || !variant_id || !context_bucket || !executor_source) {
      throw new VerifierContractError(
        "[outcome-ledger] action_id, variant_id, context_bucket, executor_source are required"
      );
    }
    if (mode !== "shadow" && mode !== "live") {
      throw new VerifierContractError(
        `[outcome-ledger] mode must be "shadow" or "live", got: ${JSON.stringify(mode)}`
      );
    }
    const info = db
      .prepare(
        `INSERT INTO policy_outcome_ledger
         (action_id, variant_id, context_bucket, context_snapshot,
          executor_source, mode, selected_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        action_id,
        variant_id,
        context_bucket,
        context_snapshot ? JSON.stringify(context_snapshot) : null,
        executor_source,
        mode,
        new Date().toISOString()
      );
    return info.lastInsertRowid;
  }

  function recordVerification({
    ledger_id,
    observation,
    verified_outcome,
    verifier_source,
  }) {
    if (verified_outcome !== "success" && verified_outcome !== "failure") {
      throw new VerifierContractError(
        `[outcome-ledger] verified_outcome must be "success" or "failure", got: ${JSON.stringify(verified_outcome)}`
      );
    }
    if (!verifier_source) {
      throw new VerifierContractError("[outcome-ledger] verifier_source is required");
    }
    const row = db
      .prepare(`SELECT * FROM policy_outcome_ledger WHERE id = ?`)
      .get(ledger_id);
    if (!row) {
      throw new VerifierContractError(`[outcome-ledger] no ledger row id=${ledger_id}`);
    }
    if (row.verified_outcome) {
      throw new VerifierContractError(
        `[outcome-ledger] ledger row id=${ledger_id} already verified at ${row.verified_at}`
      );
    }
    if (row.executor_source === verifier_source) {
      throw new VerifierContractError(
        `[outcome-ledger] verifier_source must differ from executor_source ` +
          `(both are "${verifier_source}"). Independent verifier required.`
      );
    }
    db.prepare(
      `UPDATE policy_outcome_ledger
       SET observation = ?, verified_outcome = ?, verifier_source = ?, verified_at = ?
       WHERE id = ?`
    ).run(
      observation ? JSON.stringify(observation) : null,
      verified_outcome,
      verifier_source,
      new Date().toISOString(),
      ledger_id
    );
    return getRow(ledger_id);
  }

  function applyVerifiedToPolicy({ store }) {
    const pending = db
      .prepare(
        `SELECT * FROM policy_outcome_ledger
         WHERE verified_outcome IS NOT NULL AND update_applied_at IS NULL`
      )
      .all();
    let applied = 0;
    let skipped_shadow = 0;
    const stamp = new Date().toISOString();
    for (const row of pending) {
      if (row.mode === "shadow") {
        db.prepare(
          `UPDATE policy_outcome_ledger SET update_applied_at = ? WHERE id = ?`
        ).run(stamp, row.id);
        skipped_shadow++;
        continue;
      }
      updatePolicy({
        store,
        action_id: row.action_id,
        variant_id: row.variant_id,
        context_bucket: row.context_bucket,
        verified_outcome: row.verified_outcome,
      });
      db.prepare(
        `UPDATE policy_outcome_ledger SET update_applied_at = ? WHERE id = ?`
      ).run(stamp, row.id);
      applied++;
    }
    return { applied, skipped_shadow };
  }

  function getRow(ledger_id) {
    return db
      .prepare(`SELECT * FROM policy_outcome_ledger WHERE id = ?`)
      .get(ledger_id);
  }

  function listPending() {
    return db
      .prepare(
        `SELECT * FROM policy_outcome_ledger
         WHERE verified_outcome IS NULL
         ORDER BY id`
      )
      .all();
  }

  return {
    db,
    recordSelection,
    recordVerification,
    applyVerifiedToPolicy,
    getRow,
    listPending,
    close: () => db.close(),
  };
}
