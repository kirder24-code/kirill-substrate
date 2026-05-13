/**
 * scripts/policy/ablation.test.mjs
 *
 * SYNTHETIC DIFFERENTIAL TEST WITH NEGATIVE CONTROL
 *
 * This file is renamed in spirit, not on disk, to preserve git history. It is
 * NOT a "counterfactual ablation" — there is no counterfactual world and no
 * component is being ablated. It is a synthetic differential test of the
 * arithmetic in updatePolicy + selectAction, gated by a noise floor measured
 * from random labels (negative control).
 *
 * Council guidance (May 11 2026): the synthetic empirics validating the math
 * I wrote are tautological without a baseline. Random labels MUST produce a
 * smaller shift than structured labels, otherwise the gate is just measuring
 * "any update". The threshold is not a magic 0.30; it is derived from
 * baseline_mean + 3 sigma over N random trials.
 *
 * STRUCTURED TEST (must pass):
 *   Branch SUCCESS: updatePolicy(..., variant=A, outcome=success) x N
 *   Branch FAILURE: updatePolicy(..., variant=A, outcome=failure) x N
 *   shift_structured = |p(A | success) - p(A | failure)|
 *
 * NEGATIVE CONTROL (must NOT exceed structured shift):
 *   Branch RANDOM_1: updatePolicy(..., variant=A, outcome=coin_flip(seed_1)) x N
 *   Branch RANDOM_2: updatePolicy(..., variant=A, outcome=coin_flip(seed_2)) x N
 *   shift_random = |p(A | random_1) - p(A | random_2)|, repeated R times
 *   noise_floor = mean(shift_random) + 3 * std(shift_random)
 *
 * Gate:
 *   exit 0 iff shift_structured >= noise_floor
 *   exit 1 otherwise
 *
 * Passing this gate does NOT prove learning. It proves the arithmetic
 * routes structured signal through to next selection above the noise floor
 * of arbitrary outcome labels. Real policy learning requires:
 *   (a) verifier-first outcome ledger (independent attribution),
 *   (b) wire-in to a real executor (shadow mode first),
 *   (c) context feature richer than fixed bucket.
 * None of those are tested here.
 */

import { openPolicyStore } from "./policy-store.mjs";
import { selectAction, probabilities } from "./select-action.mjs";
import { updatePolicy } from "./update-policy.mjs";

const ACTION = "email_send";
const CONTEXT = "cold_lead";
const VARIANTS = ["A", "B", "C"];
const UPDATE_COUNT = 10;     // outcomes injected per branch
const SAMPLE_COUNT = 1000;   // next-action draws per branch
const NEG_TRIALS = 30;       // random branch pairs for noise floor

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function freshStore() {
  const store = openPolicyStore(":memory:");
  for (const v of VARIANTS) store.registerVariant(ACTION, v, CONTEXT);
  return store;
}

function injectOutcomes(store, outcomeFn) {
  for (let i = 0; i < UPDATE_COUNT; i++) {
    updatePolicy({
      store,
      action_id: ACTION,
      variant_id: "A",
      context_bucket: CONTEXT,
      verified_outcome: outcomeFn(i),
    });
  }
}

function measureProbA(store, samplingSeed) {
  const rng = mulberry32(samplingSeed);
  let hits = 0;
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    if (selectAction({ store, action_id: ACTION, context_bucket: CONTEXT, rng }) === "A") hits++;
  }
  return hits / SAMPLE_COUNT;
}

function shiftBetweenBranches({ outcomeFnA, outcomeFnB, seedA, seedB, sampSeedA, sampSeedB }) {
  const storeA = freshStore();
  injectOutcomes(storeA, outcomeFnA);
  const pA = measureProbA(storeA, sampSeedA);
  storeA.close();

  const storeB = freshStore();
  injectOutcomes(storeB, outcomeFnB);
  const pB = measureProbA(storeB, sampSeedB);
  storeB.close();

  return { pA, pB, shift: Math.abs(pA - pB) };
}

// --- Negative control: noise floor from random labels ---
const noiseShifts = [];
for (let t = 0; t < NEG_TRIALS; t++) {
  const rngA = mulberry32(0x10000 + t * 7);
  const rngB = mulberry32(0x20000 + t * 11);
  const { shift } = shiftBetweenBranches({
    outcomeFnA: () => (rngA() < 0.5 ? "success" : "failure"),
    outcomeFnB: () => (rngB() < 0.5 ? "success" : "failure"),
    sampSeedA: 0x30000 + t * 13,
    sampSeedB: 0x40000 + t * 17,
  });
  noiseShifts.push(shift);
}
const noiseMean = noiseShifts.reduce((a, b) => a + b, 0) / noiseShifts.length;
const noiseVar = noiseShifts.reduce((a, b) => a + (b - noiseMean) ** 2, 0) / noiseShifts.length;
const noiseStd = Math.sqrt(noiseVar);
const noiseFloor = noiseMean + 3 * noiseStd;
const noiseMax = Math.max(...noiseShifts);

// --- Structured test ---
const structured = shiftBetweenBranches({
  outcomeFnA: () => "success",
  outcomeFnB: () => "failure",
  sampSeedA: 0xA5A5,
  sampSeedB: 0x5A5A,
});

console.log("=== Synthetic Differential Test (with negative control) ===");
console.log(`action=${ACTION} context=${CONTEXT} variants=${VARIANTS.join(",")}`);
console.log(`update_count=${UPDATE_COUNT} sample_count=${SAMPLE_COUNT} neg_trials=${NEG_TRIALS}`);
console.log();
console.log("Negative control (random labels, no structured signal):");
console.log(`  mean shift   = ${noiseMean.toFixed(4)}`);
console.log(`  std  shift   = ${noiseStd.toFixed(4)}`);
console.log(`  max  shift   = ${noiseMax.toFixed(4)}`);
console.log(`  noise floor  = mean + 3*std = ${noiseFloor.toFixed(4)}`);
console.log();
console.log("Structured test (success vs failure on variant A):");
console.log(`  p(A | success) = ${structured.pA.toFixed(3)}`);
console.log(`  p(A | failure) = ${structured.pB.toFixed(3)}`);
console.log(`  shift          = ${structured.shift.toFixed(4)}`);
console.log();

const passes = structured.shift >= noiseFloor;
if (passes) {
  console.log(`PASS: structured shift ${structured.shift.toFixed(4)} >= noise floor ${noiseFloor.toFixed(4)}.`);
  console.log("The arithmetic routes structured outcome labels through to next selection above the noise floor.");
  console.log("This does NOT prove policy learning. Verifier-first ledger and real-executor wire-in are required next.");
  process.exit(0);
} else {
  console.log(`FAIL: structured shift ${structured.shift.toFixed(4)} < noise floor ${noiseFloor.toFixed(4)}.`);
  console.log("Cannot distinguish structured signal from random labels. No claim is justified.");
  process.exit(1);
}
