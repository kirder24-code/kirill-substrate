/**
 * scripts/policy/ledger.test.mjs
 *
 * Tests the verifier-first contract and the context-discrimination
 * property of the outcome ledger + policy store.
 *
 * All synthetic. No real executor or verifier is involved. Exit 0 if
 * every test asserts cleanly, exit 1 with a diagnostic otherwise.
 *
 * Tests:
 *   1. happy_path: select -> verify (different source) -> apply -> weights changed
 *   2. same_source_rejection: verifier_source == executor_source must throw
 *   3. already_verified_rejection: second verification on same row must throw
 *   4. apply_idempotent: applyVerifiedToPolicy called twice must not double-update
 *   5. shadow_mode_does_not_update: shadow row is marked applied but policy unchanged
 *   6. context_discrimination: success in context X must not affect context Y
 */

import { openPolicyStore } from "./policy-store.mjs";
import { openOutcomeLedger, VerifierContractError } from "./outcome-ledger.mjs";
import { probabilities } from "./select-action.mjs";

const ACTION = "email_send";
const VARIANTS = ["A", "B", "C"];

function freshStore() {
  const store = openPolicyStore(":memory:");
  for (const v of VARIANTS) for (const c of ["cold_lead", "warm_lead"]) {
    store.registerVariant(ACTION, v, c);
  }
  return store;
}

const results = [];
function check(name, condition, detail = "") {
  if (condition) {
    results.push({ name, pass: true });
  } else {
    results.push({ name, pass: false, detail });
  }
}

// ---- 1. happy_path ----
{
  const store = freshStore();
  const ledger = openOutcomeLedger(":memory:");
  const before = probabilities({ store, action_id: ACTION, context_bucket: "cold_lead" }).A;
  for (let i = 0; i < 10; i++) {
    const id = ledger.recordSelection({
      action_id: ACTION, variant_id: "A", context_bucket: "cold_lead",
      executor_source: "executor:cron", mode: "live",
    });
    ledger.recordVerification({
      ledger_id: id, verified_outcome: "success", verifier_source: "verifier:imap",
    });
  }
  const res = ledger.applyVerifiedToPolicy({ store });
  const after = probabilities({ store, action_id: ACTION, context_bucket: "cold_lead" }).A;
  check("happy_path applied 10 live rows", res.applied === 10 && res.skipped_shadow === 0,
    `applied=${res.applied} skipped_shadow=${res.skipped_shadow}`);
  check("happy_path p(A) increased", after > before + 0.1,
    `before=${before.toFixed(3)} after=${after.toFixed(3)}`);
  store.close(); ledger.close();
}

// ---- 2. same_source_rejection ----
{
  const ledger = openOutcomeLedger(":memory:");
  const id = ledger.recordSelection({
    action_id: ACTION, variant_id: "A", context_bucket: "cold_lead",
    executor_source: "executor:cron", mode: "live",
  });
  let threw = false;
  try {
    ledger.recordVerification({
      ledger_id: id, verified_outcome: "success", verifier_source: "executor:cron",
    });
  } catch (e) {
    threw = e instanceof VerifierContractError;
  }
  check("same_source_rejection throws VerifierContractError", threw);
  ledger.close();
}

// ---- 3. already_verified_rejection ----
{
  const ledger = openOutcomeLedger(":memory:");
  const id = ledger.recordSelection({
    action_id: ACTION, variant_id: "A", context_bucket: "cold_lead",
    executor_source: "executor:cron", mode: "live",
  });
  ledger.recordVerification({
    ledger_id: id, verified_outcome: "success", verifier_source: "verifier:imap",
  });
  let threw = false;
  try {
    ledger.recordVerification({
      ledger_id: id, verified_outcome: "failure", verifier_source: "verifier:other",
    });
  } catch (e) {
    threw = e instanceof VerifierContractError;
  }
  check("already_verified_rejection throws on second verify", threw);
  ledger.close();
}

// ---- 4. apply_idempotent ----
{
  const store = freshStore();
  const ledger = openOutcomeLedger(":memory:");
  for (let i = 0; i < 5; i++) {
    const id = ledger.recordSelection({
      action_id: ACTION, variant_id: "A", context_bucket: "cold_lead",
      executor_source: "executor:cron", mode: "live",
    });
    ledger.recordVerification({
      ledger_id: id, verified_outcome: "success", verifier_source: "verifier:imap",
    });
  }
  const first = ledger.applyVerifiedToPolicy({ store });
  const after_first = store.getRow(ACTION, "A", "cold_lead");
  const second = ledger.applyVerifiedToPolicy({ store });
  const after_second = store.getRow(ACTION, "A", "cold_lead");
  check("apply_idempotent first run applies 5", first.applied === 5);
  check("apply_idempotent second run applies 0", second.applied === 0);
  check("apply_idempotent state unchanged on second run",
    after_first.n_successes === after_second.n_successes &&
    after_first.n_attempts === after_second.n_attempts,
    `first=${JSON.stringify(after_first)} second=${JSON.stringify(after_second)}`);
  store.close(); ledger.close();
}

// ---- 5. shadow_mode_does_not_update ----
{
  const store = freshStore();
  const ledger = openOutcomeLedger(":memory:");
  const before = probabilities({ store, action_id: ACTION, context_bucket: "cold_lead" }).A;
  for (let i = 0; i < 10; i++) {
    const id = ledger.recordSelection({
      action_id: ACTION, variant_id: "A", context_bucket: "cold_lead",
      executor_source: "executor:cron", mode: "shadow",
    });
    ledger.recordVerification({
      ledger_id: id, verified_outcome: "success", verifier_source: "verifier:imap",
    });
  }
  const res = ledger.applyVerifiedToPolicy({ store });
  const after = probabilities({ store, action_id: ACTION, context_bucket: "cold_lead" }).A;
  check("shadow_mode counted as skipped, not applied",
    res.applied === 0 && res.skipped_shadow === 10,
    `applied=${res.applied} skipped_shadow=${res.skipped_shadow}`);
  check("shadow_mode p(A) unchanged", Math.abs(after - before) < 1e-9,
    `before=${before} after=${after}`);
  store.close(); ledger.close();
}

// ---- 6. context_discrimination ----
{
  const store = freshStore();
  const ledger = openOutcomeLedger(":memory:");
  for (let i = 0; i < 10; i++) {
    const id_cold = ledger.recordSelection({
      action_id: ACTION, variant_id: "A", context_bucket: "cold_lead",
      executor_source: "executor:cron", mode: "live",
    });
    ledger.recordVerification({
      ledger_id: id_cold, verified_outcome: "success", verifier_source: "verifier:imap",
    });
    const id_warm = ledger.recordSelection({
      action_id: ACTION, variant_id: "A", context_bucket: "warm_lead",
      executor_source: "executor:cron", mode: "live",
    });
    ledger.recordVerification({
      ledger_id: id_warm, verified_outcome: "failure", verifier_source: "verifier:imap",
    });
  }
  ledger.applyVerifiedToPolicy({ store });
  const p_cold_A = probabilities({ store, action_id: ACTION, context_bucket: "cold_lead" }).A;
  const p_warm_A = probabilities({ store, action_id: ACTION, context_bucket: "warm_lead" }).A;
  check("context_discrimination: p(A|cold_lead) high after successes",
    p_cold_A > 0.5,
    `p_cold_A=${p_cold_A.toFixed(3)}`);
  check("context_discrimination: p(A|warm_lead) low after failures",
    p_warm_A < 0.2,
    `p_warm_A=${p_warm_A.toFixed(3)}`);
  check("context_discrimination: contexts diverge",
    p_cold_A - p_warm_A > 0.3,
    `delta=${(p_cold_A - p_warm_A).toFixed(3)}`);
  store.close(); ledger.close();
}

// ---- Report ----
const passed = results.filter(r => r.pass).length;
const failed = results.length - passed;

console.log("=== Verifier-first ledger tests ===");
for (const r of results) {
  console.log(`  ${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.detail ? "  -> " + r.detail : ""}`);
}
console.log();
console.log(`${passed}/${results.length} passed`);

if (failed > 0) process.exit(1);
process.exit(0);
