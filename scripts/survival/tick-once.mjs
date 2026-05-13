/**
 * scripts/survival/tick-once.mjs
 *
 * CLI entrypoint for pulse-daemon. Runs exactly one survival tick if
 * armed, otherwise no-op. Writes a single-line summary to stdout for
 * the pulse log.
 */

import { runOneTick } from "./experiment-runner.mjs";

const addr = process.env.SURVIVAL_WALLET_ADDRESS;
const tick = await runOneTick({ wallet_address: addr });

if (tick.terminated) {
  process.stdout.write(`[survival-tick] terminated=${tick.terminated}\n`);
  process.exit(0);
}

const pickStep = tick.steps.find(s => s.step === "pick_strategy");
const actionStep = tick.steps.find(s => s.step === "run_action");
const foodStep = tick.steps.find(s => s.step === "poll_wallet");
const retireStep = tick.steps.find(s => s.step === "evaluate_and_retire");

const ok = actionStep?.action_result?.ok;
const summary = [
  pickStep?.action_id || "?",
  ok ? "ran" : `failed:${actionStep?.action_result?.reason || "?"}`,
  `food_delta=${foodStep?.food?.delta_usd ?? "n/a"}`,
  `retired=${retireStep?.retired?.length ?? 0}`,
].join(" | ");

process.stdout.write(`[survival-tick] ${summary}\n`);
process.exit(0);
