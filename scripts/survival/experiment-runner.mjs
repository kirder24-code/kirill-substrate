/**
 * scripts/survival/experiment-runner.mjs
 *
 * The core selection loop:
 *   1. Check budget-guard. If exhausted, hibernate.
 *   2. Check survival projection. If hibernation, skip this tick.
 *   3. Pick a strategy from policy-registry by Laplace-weighted sampling.
 *   4. Authorize the projected cost via budget-guard.
 *   5. Run the action via action-catalog.
 *   6. Record attempt + cost. Poll wallet for any food.
 *   7. Run evaluateAndRetire to kill any strategies past the budget cap.
 *
 * One tick = one attempt. Caller decides cadence (cron, daemon, etc).
 */

import { authorizeNextCall } from "./budget-guard.mjs";
import { isArmed } from "./armed-flag.mjs";
import { survivalProjection, recordLlmCall } from "./resource-ledger.mjs";
import {
  openRegistry,
  registerStrategy,
  pickStrategy,
  recordAttempt,
  evaluateAndRetire,
} from "./policy-registry.mjs";
import { runAction, getActionMetadata } from "./action-catalog.mjs";
import {
  recordActionAttempt,
  pollWalletForFood,
} from "./external-observation.mjs";
import crypto from "node:crypto";

function hashContext(obj) {
  return crypto.createHash("sha256").update(JSON.stringify(obj)).digest("hex").slice(0, 12);
}

/**
 * Seed initial strategies if registry is empty. Idempotent: registerStrategy
 * uses INSERT OR IGNORE on the id PK.
 */
export function seedInitialStrategies() {
  const seeds = [
    { action_id: "growth_articulation", params: { want: "(let substrate decide)", why: "(let substrate justify)" } },
    { action_id: "pattern_extraction", params: {} },
    { action_id: "site_audit", params: {} },
    { action_id: "web_research", params: { url: "https://news.ycombinator.com" } },
    { action_id: "seo_learning", params: { url: "https://moz.com/learn/seo/what-is-seo" } },
    // Opportunity-loop seeds: these are always-available actions that pick up
    // queued opportunities and process them. Each is parameter-free; the action
    // implementation chooses the next opportunity in the right state.
    { action_id: "opportunity_deep_research", params: {} },
    { action_id: "opportunity_implementation_plan", params: {} },
    { action_id: "wishlist_processor", params: {} },
    { action_id: "ingest_organism_research", params: {} },
    { action_id: "funding_opportunity_hunter", params: {} },
    { action_id: "propose_outbound_send", params: {} },
    { action_id: "dispatch_to_specialist", params: {} },
    { action_id: "telegram_listener", params: {} },
    { action_id: "site_audit_live", params: {} },
    { action_id: "site_content_generate", params: {} },
    { action_id: "channel_match", params: {} },
    { action_id: "factory_status", params: {} },
    { action_id: "factory_output_ingest", params: {} },
    { action_id: "dispatch_to_factory", params: {} },
    { action_id: "poll_factory_results", params: {} },
    { action_id: "cortex_bus_listener", params: {} },
    { action_id: "internal_feedback", params: {} },
    { action_id: "memory_consolidation", params: {} },
    { action_id: "inbox_monitor", params: {} },
    { action_id: "letta_sleep_bridge", params: {} },
    { action_id: "prompt_optimizer", params: {} },
    // telegram_callback_poller DISABLED: conflicts with telegram-control's
    // getUpdates session. Inline buttons render; CLI approval works.
  ];
  for (const s of seeds) {
    const ctx = hashContext({ action: s.action_id, params: s.params });
    const id = `seed-${s.action_id}-${ctx}`;
    registerStrategy({
      id,
      action_id: s.action_id,
      context_hash: ctx,
      parameters: s.params,
    });
  }
}

export async function runOneTick({ wallet_address, force = false }) {
  const tick = { ts: new Date().toISOString(), steps: [] };

  // Step 0: armed flag (unless force=true for manual smoke tests).
  if (!force && !isArmed()) {
    tick.terminated = "disarmed";
    tick.steps.push({ step: "armed_check", armed: false, hint: "create .data/survival-armed.flag with content 'armed' to enable" });
    return tick;
  }

  // Step 1+2: survival projection.
  const proj = await survivalProjection({ address: wallet_address });
  tick.steps.push({ step: "survival_projection", result: proj });
  if (proj.state.startsWith("hibernation")) {
    tick.terminated = proj.state;
    return tick;
  }
  // states "alive" and "alive_blind" both proceed; "alive_blind" just means
  // food signal won't be observable this tick (no wallet configured).

  // Step 3: pick strategy.
  const strategy = pickStrategy();
  if (!strategy) {
    tick.terminated = "no_active_strategies";
    return tick;
  }
  tick.steps.push({
    step: "pick_strategy",
    strategy_id: strategy.id,
    action_id: strategy.action_id,
  });

  // Step 4: authorize via budget-guard.
  const meta = getActionMetadata(strategy.action_id);
  const projected_cost = meta?.estimated_cost_usd ?? 0.05;
  const auth = authorizeNextCall({ projected_cost_usd: projected_cost });
  tick.steps.push({ step: "budget_authorize", auth });
  if (!auth.permitted) {
    tick.terminated = `budget_block:${auth.reason}`;
    return tick;
  }

  // Step 5: run action.
  let action_result;
  try {
    action_result = await runAction(strategy.action_id, { strategy, deps: {} });
  } catch (e) {
    action_result = { ok: false, reason: "action_threw", error: e.message };
  }
  tick.steps.push({ step: "run_action", action_result });

  // Step 6: record attempt + cost (estimated; real LLM-cost recording is
  // the responsibility of any LLM-using adapter, none of the current adapters
  // call LLM yet).
  recordAttempt({ strategy_id: strategy.id, cost_usd: projected_cost });
  recordActionAttempt({
    strategy_id: strategy.id,
    action_id: strategy.action_id,
    action_result,
    cost_usd_estimated: projected_cost,
  });

  // Step 7: poll wallet for food.
  const food = await pollWalletForFood({
    address: wallet_address,
    recent_strategy_ids: [strategy.id],
  });
  tick.steps.push({ step: "poll_wallet", food });

  // Step 8: evaluate + retire.
  const retired = evaluateAndRetire();
  tick.steps.push({ step: "evaluate_and_retire", retired });

  return tick;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedInitialStrategies();
  const addr = process.env.SURVIVAL_WALLET_ADDRESS;
  const tick = await runOneTick({ wallet_address: addr });
  console.log(JSON.stringify(tick, null, 2));
}
