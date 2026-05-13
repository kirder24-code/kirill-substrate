/**
 * scripts/cortex/run-3-cycles.mjs
 *
 * Drives three end-to-end cycles:
 *   1. predict-emit  (1 Claude call)
 *   2. wait WINDOW_MIN minutes
 *   3. observe-and-update  (no Claude)
 * Repeat 3 times. Print a final summary.
 *
 * Run:
 *   WINDOW_MIN=10 node scripts/cortex/run-3-cycles.mjs
 *
 * Total wall time = 3 * WINDOW_MIN + a few seconds per cycle.
 */

import { execSync } from "node:child_process";
import { readAll } from "./outcome-ledger.mjs";

const WINDOW_MIN = Number(process.env.WINDOW_MIN ?? 10);
const NODE_BIN = process.execPath;
const SCRIPTS = "$CLAUDE_PROJECT_DIR/scripts/cortex";

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function run(cmd) {
  return execSync(cmd, {
    encoding: "utf-8",
    env: { ...process.env, WINDOW_MIN: String(WINDOW_MIN) },
  });
}

const cycleResults = [];

for (let cycle = 1; cycle <= 3; cycle++) {
  log(`=== Cycle ${cycle}/3 ===`);
  log(`Emitting prediction (window ${WINDOW_MIN} min)...`);
  const emitOut = run(`"${NODE_BIN}" "${SCRIPTS}/predict-emit.mjs"`);
  const emitted = JSON.parse(emitOut.match(/\{[\s\S]*\}/)[0]);
  log(`Predicted ${emitted.predicted_value}. Reasoning: ${emitted.reasoning}`);
  log(`Deadline: ${emitted.deadline}`);

  log(`Sleeping ${WINDOW_MIN} minutes until deadline...`);
  await new Promise(r => setTimeout(r, WINDOW_MIN * 60_000));

  log(`Observing and updating policy...`);
  const obsOut = run(`"${NODE_BIN}" "${SCRIPTS}/observe-and-update.mjs"`);
  const obs = JSON.parse(obsOut.match(/\{[\s\S]*\}/s)[0]);
  const r = obs.results.find(x => x.id === emitted.id);
  log(`Predicted=${r.predicted} Observed=${r.observed} Error=${r.error} Bucket=${r.bucket}`);
  cycleResults.push({ cycle, ...r });
}

log("=== Summary ===");
console.log(JSON.stringify(cycleResults, null, 2));

const errors = cycleResults.map(c => c.error);
const trend = errors[2] < errors[0] ? "ERROR DECREASED" : "no decrease";
console.log(`Error trajectory: ${errors.join(" -> ")}  (${trend})`);

const ledger = readAll();
console.log(`Total ledger rows: ${ledger.length}`);
