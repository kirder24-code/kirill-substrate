# Survival Loop Contract — v1 (frozen 2026-05-11)

This file defines what "alive" means for this system in code-executable terms.
**Once frozen, no LLM and no module may rewrite this file during an experiment.**
Manual edit by Kirill resets the experiment counter.

---

## Food (positive fitness signal)

**Money in the wallet.** A monotonic increase in the system's read-only crypto
wallet balance is the only thing that counts as food. No proxy, no LLM
classification, no "engagement metric". The numeric balance, queried from a
public RPC endpoint by `resource-ledger.mjs`, is the ground truth.

Threshold for "fed": any positive delta `balance(t) - balance(t-Δ) > 0` after
discounting expected periodic burn. Fitness magnitude = USD value of delta.

## Death

**Wallet balance falls below the cost of the next planned LLM call.**
When `current_balance < model_call_cost(next_planned_model)`, the system enters
`hibernation` state. In hibernation: no LLM calls, no outbound actions, only
read of own state and wallet. Exit from hibernation requires balance recovery
via external deposit.

Strategy-level death: a strategy that consumes more than `STRATEGY_BUDGET_CAP`
USD worth of LLM calls without producing a single positive food signal is
permanently retired (`status='retired'` in `policy_strategies` table). A retired
strategy is never selected again, even after launcher restart.

## Resources

- **Wallet**: ETH/USDC address provided via `SURVIVAL_WALLET_ADDRESS` env.
  Read-only access via public RPC. System cannot spend or transfer.
- **LLM budget**: hard ceiling of **$5 CAD / 24-hour rolling window**, enforced
  by `budget-guard.mjs`. Crossing this ceiling = forced hibernation regardless
  of wallet balance.
- **Action attempts**: maximum 100 attempts per 24h to prevent runaway loops.

## Action Catalog (initial)

System may select from these actions only:

1. `web_research` — fetch a public URL, summarize, store observation. Auto-OK.
2. `site_audit` — read kirill's own site files/HTML, propose improvements to a
   file. Auto-OK.
3. `seo_learning` — fetch SEO articles, extract patterns, store in memory.
   Auto-OK.
4. `draft_writing` — produce a draft (email/post/comment) into a file. Auto-OK.
   **Sending requires explicit Kirill approval via approval-queue.**
5. `growth_articulation` — system writes "I want X because Y" to a read-only
   wishlist file Kirill reviews. Auto-OK.
6. `competitor_analysis` — fetch competitor public pages, extract patterns.
   Auto-OK.
7. `pattern_extraction` — read own past experiment_log, extract what worked
   and what didn't. Auto-OK.

New actions cannot be added by the system. Adding requires manual edit of this
file by Kirill, which resets the experiment counter.

## Approval Policy

- Any action that produces side effects in the world (sending an email,
  publishing a post, calling an external API with mutation) → blocked unless
  Kirill approves via approval queue.
- Any read-only action (fetch public URL, read own files, write to local file)
  → executed automatically.

## Variation, Selection, Retention

- **Variation**: at experiment-runner cycle, system samples from `policy_strategies`
  weighted by current Laplace-smoothed fitness. May propose a new strategy by
  combining two existing ones (mutation), bounded by action catalog.
- **Selection**: fitness updates only when external observation confirms food
  signal (wallet delta) attributable to the strategy within a 30-day window.
- **Retention**: strategies above median fitness persist with `status='active'`.
  Below median for 14 days → `probation`. Below `STRATEGY_BUDGET_CAP` exhausted
  without food → `retired` (permanent).

## Growth

System cannot purchase anything. System can publish to `growth-wishlist.md` a
structured request: `{want: <thing>, why: <reason>, estimated_cost_usd: <n>,
how_i_will_earn_it: <plan>}`. Kirill reviews the wishlist manually.

## Frozen Constants

```
WALLET_ADDRESS = $SURVIVAL_WALLET_ADDRESS  (env)
WALLET_CHAIN = "ethereum"
WALLET_TOKEN = "USDC"
DAILY_LLM_BUDGET_CAD = 5.00
DAILY_ACTION_CAP = 100
STRATEGY_BUDGET_CAP_USD = 1.00
PROBATION_DAYS = 14
RETENTION_FITNESS_PERCENTILE = 50
HIBERNATION_RESERVE_USD = 0.10  # safety buffer below pure cost-of-call
EXPERIMENT_WINDOW_DAYS = 7
```

## Falsification Criterion

After a 7-day continuous run with the launcher booted and the survival_loop
active, the architecture is considered **falsified as a substrate for autonomy**
if BOTH conditions hold:

1. `wallet_delta` is exactly 0 across all 7 days from system actions
   (Kirill-driven deposits do not count, only system-attributable changes).
2. NO strategy was retired by the system itself via the budget exhaustion rule.

If either condition is broken (system caused at least one wallet delta, OR
selection mechanism retired at least one strategy), the architecture is
considered **alive as a seed**, not as an organism.
