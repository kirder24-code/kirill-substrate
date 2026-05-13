/**
 * scripts/policy/select-action.mjs
 *
 * Given (action_id, context_bucket), sample one variant according to the
 * Laplace-smoothed posterior of past success rate.
 *
 *   weight(v) = (n_successes(v) + 1) / (n_attempts(v) + K)
 *
 * where K is the number of variants in this (action, context) bucket.
 * Sampling is weighted-random over normalized weights, NOT argmax — this
 * preserves exploration when one variant has only marginally more evidence.
 *
 * Returns the chosen variant_id. Does NOT mutate the store; the caller is
 * responsible for calling update_policy after the verified outcome lands.
 */

export function selectAction({ store, action_id, context_bucket, rng = Math.random }) {
  const rows = store.listVariants(action_id, context_bucket);
  if (rows.length === 0) {
    throw new Error(
      `[select-action] no variants registered for action_id=${action_id} context_bucket=${context_bucket}`
    );
  }
  const K = rows.length;
  const weights = rows.map(r => (r.n_successes + 1) / (r.n_attempts + K));
  const total = weights.reduce((a, b) => a + b, 0);
  const r = rng() * total;
  let acc = 0;
  for (let i = 0; i < rows.length; i++) {
    acc += weights[i];
    if (r < acc) return rows[i].variant_id;
  }
  return rows[rows.length - 1].variant_id;
}

export function probabilities({ store, action_id, context_bucket }) {
  const rows = store.listVariants(action_id, context_bucket);
  const K = rows.length;
  const weights = rows.map(r => (r.n_successes + 1) / (r.n_attempts + K));
  const total = weights.reduce((a, b) => a + b, 0);
  const out = {};
  for (let i = 0; i < rows.length; i++) {
    out[rows[i].variant_id] = weights[i] / total;
  }
  return out;
}
