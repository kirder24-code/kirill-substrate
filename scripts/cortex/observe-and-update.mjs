/**
 * scripts/cortex/observe-and-update.mjs
 *
 * Deterministic observer. For every prediction past its deadline:
 *   1. Read the real value from the external source (no LLM).
 *   2. Compute error = |predicted - observed|.
 *   3. Bucket the error: too_low (predicted < observed), too_high
 *      (predicted > observed), close (within tolerance).
 *   4. Update the corresponding Laplace counter in policy_weights.
 *   5. Mark the ledger row as observed + policy_applied.
 *
 * NO LLM in any step of this script.
 */

import { pendingPastDeadline, appendObservation } from "./outcome-ledger.mjs";
import { getMaxItemId } from "./hn-counter.mjs";
import { openPolicyStore } from "../policy/policy-store.mjs";
import { updatePolicy } from "../policy/update-policy.mjs";

const WINDOW_MIN = Number(process.env.WINDOW_MIN ?? 20);
const ACTION = "predict_hn_delta";
const CONTEXT = `hn:maxitem:window_${WINDOW_MIN}min`;
const CLOSE_TOLERANCE = Number(process.env.CLOSE_TOLERANCE ?? 50);

function bucketError(predicted, observed) {
  const diff = predicted - observed;
  if (Math.abs(diff) <= CLOSE_TOLERANCE) return "close";
  return diff < 0 ? "too_low" : "too_high";
}

const pending = pendingPastDeadline();
if (pending.length === 0) {
  console.log("[observe-and-update] no rows past deadline; nothing to do.");
  process.exit(0);
}

const store = openPolicyStore();
for (const b of ["too_low", "close", "too_high"]) {
  store.registerVariant(ACTION, b, CONTEXT);
}

const results = [];
for (const row of pending) {
  if (!row.source.startsWith("hn:maxitem_delta:")) {
    console.log(`[observe-and-update] skip non-hn row ${row.id}`);
    continue;
  }
  // Recover baseline from notes ("baseline_maxitem=N | reasoning: ...")
  const baselineMatch = String(row.notes || "").match(/baseline_maxitem=(\d+)/);
  if (!baselineMatch) {
    console.log(`[observe-and-update] no baseline_maxitem in notes for ${row.id}, skip`);
    continue;
  }
  const baseline = Number.parseInt(baselineMatch[1], 10);
  const current = await getMaxItemId();
  const observed = current - baseline;  // actual delta
  const error = Math.abs(row.predicted_value - observed);
  const bucket = bucketError(row.predicted_value, observed);
  const verified_outcome = bucket === "close" ? "success" : "failure";

  updatePolicy({
    store,
    action_id: ACTION,
    variant_id: bucket,
    context_bucket: CONTEXT,
    verified_outcome,
  });

  appendObservation({
    id: row.id,
    observed_value: observed,
    error,
    policy_applied_at: new Date().toISOString(),
    error_bucket: bucket,
  });

  results.push({
    id: row.id,
    predicted: row.predicted_value,
    observed,
    error,
    bucket,
    verified_outcome,
  });
}
store.close();

console.log(JSON.stringify({ updated: results.length, results }, null, 2));
