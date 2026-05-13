/**
 * scripts/policy/update-policy.mjs
 *
 * Canonical entry point: outcome of a past action changes the next selection.
 * This is the function whose existence + behavior the Counterfactual Policy
 * Ablation gate measures.
 *
 *   updatePolicy({ store, action_id, variant_id, context_bucket, verified_outcome })
 *
 * verified_outcome must be one of { "success", "failure" }. The function
 * bumps n_attempts always, and n_successes only on "success". It does NOT
 * decide whether the outcome was independently verified; that contract is
 * the caller's responsibility (phase 3 — Verifier-First Ledger).
 *
 * The function is the single mutation point on the policy store from the
 * outside. Direct bumpAttempt/bumpSuccess on the store object are
 * implementation detail; in real code, always route through updatePolicy.
 */

export function updatePolicy({
  store,
  action_id,
  variant_id,
  context_bucket,
  verified_outcome,
}) {
  if (verified_outcome !== "success" && verified_outcome !== "failure") {
    throw new Error(
      `[update-policy] verified_outcome must be "success" or "failure", got: ${JSON.stringify(verified_outcome)}`
    );
  }
  store.registerVariant(action_id, variant_id, context_bucket);
  store.bumpAttempt(action_id, variant_id, context_bucket);
  if (verified_outcome === "success") {
    store.bumpSuccess(action_id, variant_id, context_bucket);
  }
  return store.getRow(action_id, variant_id, context_bucket);
}
