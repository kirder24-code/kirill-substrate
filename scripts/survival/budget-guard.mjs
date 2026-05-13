/**
 * scripts/survival/budget-guard.mjs
 *
 * Hard ceiling enforcer. The only thing that prevents a runaway loop from
 * burning Kirill's wallet at 3am. Reads llm_call_log totals, refuses to
 * authorize next call when 24h spend approaches the cap.
 */

import { spentLastNHours } from "./resource-ledger.mjs";

const DAILY_LLM_BUDGET_CAD = 5.00;
const USD_PER_CAD = 0.73;
const DAILY_LLM_BUDGET_USD = DAILY_LLM_BUDGET_CAD * USD_PER_CAD;
const DAILY_ACTION_CAP = 100;

/**
 * Check whether the next planned LLM call is permitted.
 * Returns { permitted: bool, reason?: string, projection: {...} }.
 */
export function authorizeNextCall({ projected_cost_usd }) {
  const spent = spentLastNHours(24);
  const remaining_budget = DAILY_LLM_BUDGET_USD - spent;
  if (remaining_budget <= 0) {
    return {
      permitted: false,
      reason: "daily_budget_exhausted",
      projection: { spent_24h_usd: spent, daily_cap_usd: DAILY_LLM_BUDGET_USD },
    };
  }
  if (projected_cost_usd > remaining_budget) {
    return {
      permitted: false,
      reason: "next_call_exceeds_remaining_budget",
      projection: {
        spent_24h_usd: spent,
        remaining_budget_usd: remaining_budget,
        projected_cost_usd,
      },
    };
  }
  return {
    permitted: true,
    projection: {
      spent_24h_usd: spent,
      remaining_budget_usd: remaining_budget,
      projected_cost_usd,
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cost = Number(process.argv[2] ?? 0.03);
  console.log(JSON.stringify(authorizeNextCall({ projected_cost_usd: cost }), null, 2));
}
