/**
 * scripts/survival/system-map.mjs
 *
 * Generates .data/SYSTEM-MAP.md — a flow diagram in markdown that shows
 * how data and decisions move through the substrate. Pure read.
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const OUT = resolve(ROOT, ".data/SYSTEM-MAP.md");

const MAP = `# SYSTEM MAP

Generated: ${new Date().toISOString()}

This file shows how the substrate makes decisions and where data flows.
For per-tick state see SYSTEM-STATE.md. For wiring audit see
integration-audit.md. This file is the conceptual model.

---

## High-level architecture

\`\`\`
                       ┌──────────────────────────┐
                       │   PULSE-DAEMON (hourly)  │
                       │   organism-pulse.sh       │
                       └────────────┬─────────────┘
                                    │ each hour:
                                    ▼
                ┌───────────────────────────────────────┐
                │ 14 sequential steps, including:       │
                │   0a: perception-feeder flush         │
                │   0b: announce-perception (throttled) │
                │   0c: SURVIVAL TICK (one action)      │
                │   0d: cortex-alive watchdog           │
                │   0e: outbound-approval process       │
                │   0f: regenerate SYSTEM-STATE.md      │
                │   1-9: organism research, digest, etc │
                └────────────────┬──────────────────────┘
                                 │
                                 ▼
                    ┌────────────────────────────┐
                    │   SURVIVAL-LOOP TICK       │
                    │   experiment-runner.mjs    │
                    └────────────────────────────┘
                                 │
                                 ▼
        ┌────────────────────────────────────────────────────┐
        │ Step 1: armed-flag check (no-op if disarmed)       │
        │ Step 2: survival-projection (LLM budget + wallet)   │
        │ Step 3: pick strategy (Laplace weights from prior   │
        │         outcomes)                                  │
        │ Step 4: budget-guard authorize                     │
        │ Step 5: RUN ACTION (one of 13)                     │
        │ Step 6: record attempt + cost                      │
        │ Step 7: poll wallet for food                       │
        │ Step 8: evaluate + retire                          │
        └────────────────────┬───────────────────────────────┘
                             │
                             ▼
              ┌──────────────────────────────────┐
              │   ACTION CATALOG (13 actions)    │
              └──────────────────────────────────┘

Discovery actions:                Cognition actions:
  funding_opportunity_hunter        opportunity_deep_research
  ingest_organism_research          opportunity_implementation_plan
  web_research                      growth_articulation
  competitor_analysis               pattern_extraction

Execution actions:                Specialist dispatch:
  draft_writing                     dispatch_to_specialist (10 personas)
  site_audit                          ↓
  seo_learning                      market_researcher | marketing_strategist
  propose_outbound_send             | copywriter | web_strategist
                                    | telegram_strategist | reddit_strategist
Bookkeeping actions:                | prospecting_specialist | sales_strategist
  wishlist_processor                | pricing_strategist | partnership_strategist
\`\`\`

---

## How an opportunity flows end-to-end

\`\`\`
1. funding_opportunity_hunter scans 10 gov sites
   → finds new program
   → creates opportunity (state=detected)
   → tags audience_fit_level

2. Next tick: opportunity_deep_research picks oldest detected
   → reads opportunity seed + INTEL.md + wiki + lead db
   → gets identity context + voice strategy from operator-identity.mjs
   → calls Claude
   → writes research.md
   → state → researched

3. Next tick: opportunity_implementation_plan picks oldest researched
   → reads research.md
   → calls Claude with persona-aware prompt
   → writes plan.md (LinkedIn drafts + outreach + checklist)
   → registers 5 sub-strategies in policy_registry
   → state → in_progress

4. Subsequent ticks: dispatch_to_specialist round-robins through 10
   personas for this opportunity
   → market_researcher first (sizing + GO/HOLD/DROP)
   → marketing_strategist (channel + 6-week plan)
   → prospecting_specialist (named prospect list)
   → pricing_strategist (anchor analysis)
   → copywriter (publish-ready copy)
   → web_strategist, telegram_strategist, reddit_strategist
     (channel-specific tactics)
   → partnership_strategist (referral network)
   → sales_strategist (discovery + proposal scripts)

5. Sub-strategies from plan execute in parallel:
   → web_research verifies eligibility / advisor lists
   → draft_writing generates more drafts
   → competitor_analysis maps competition

6. propose_outbound_send picks oldest draft
   → applies audience-fit check
   → queues to .data/survival-outbound-queue.jsonl
   → sends Telegram message to Kirill with full body + approve/deny

7. Kirill manually approves via CLI
   → outbound-approval process step marks ready
   → Kirill manually sends from his account
   → reply (or non-reply) flows back via wallet/email/manual mark
   → policy_registry updates fitness for the originating strategy
\`\`\`

---

## What grounds substrate's reasoning at each step

Every Claude call substrate makes is preceded by:

| Block | Source | Refresh |
|---|---|---|
| Operator identity | scripts/survival/operator-identity.md | manual edit |
| Audience fit + voice strategy | operator-identity.mjs computed per opportunity | per call |
| Wiki knowledge (top 3 matches) | .data/wiki-archive/ (63 pages) | manual + obsidian-sync |
| Lead database stats + matched leads | .data/linkedin-brand-os.sqlite | live read |
| Organism intel | .data/INTEL.md | organism research bot |
| Specialist persona | scripts/survival/personas/<id>.md | manual edit |
| Opportunity context | .data/survival.db opportunities table | live |
| Research excerpt (when planning) | .data/survival-opportunities/<id>/research.md | per dispatch |

This is what makes substrate appear coherent across calls without
having continuous memory. Every "thought" is rehydrated from these
files at the start.

---

## Hard limits and safety

- $5 CAD / 24h LLM budget cap (budget-guard)
- 100 actions per 24h cap
- armed-flag must exist for any action to fire
- approval-queue gate for any outbound (Telegram message to Kirill)
- read-only wallet (substrate cannot spend)
- contract.md frozen, LLM cannot rewrite during experiment
- operator-identity.md frozen, LLM cannot rewrite
- specialist personas frozen, LLM cannot rewrite
- strategies that cost > $1 without food signal → permanently retired

---

## What lives where (key paths)

| Path | Purpose |
|---|---|
| scripts/survival/contract.md | Survival contract (food/death rules) |
| scripts/survival/operator-identity.md | Who Kirill is, voice rules per market |
| scripts/survival/personas/*.md | 10 specialist persona priming files |
| scripts/survival/*.mjs | Substrate machinery (action runner, gates) |
| .data/survival.db | Strategies + opportunities + LLM logs |
| .data/survival-opportunities/<id>/ | Per-opportunity workspace (research, plan, specialists output) |
| .data/survival-drafts/ | Generated outbound drafts pending approval |
| .data/survival-wishlist.md | Substrate's articulated wants for Kirill review |
| .data/survival-outbound-queue.jsonl | Drafts queued for Kirill approval |
| .data/survival-funding-scans/ | Per-scan audit log of funding-hunter |
| .data/survival-experiment-log.jsonl | Append-only event log for falsification |
| .data/SYSTEM-STATE.md | Live state snapshot (regen every pulse) |
| .data/SYSTEM-MAP.md | This file (manual regen) |
| .data/integration-audit.md | Wired-vs-orphan classification |
| .data/cortex-alive-bus.jsonl | Cortex bus event log |
| .data/cortex-alive-heartbeat.json | Cortex-alive process heartbeat |

---

## How Kirill reads this map

Two ways to use this file:
1. **Architecture reference**: when you wonder "how does substrate
   know X" or "who decides Y", trace the flow above.
2. **Audit checklist**: at any time, open .data/SYSTEM-STATE.md (live)
   and verify that the components shown here are alive and producing
   output you can inspect.

To regenerate: \`node scripts/survival/system-map.mjs\`
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, MAP);
console.log(`SYSTEM-MAP.md written: ${OUT}`);
