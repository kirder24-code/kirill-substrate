/**
 * scripts/survival/memory-consolidation.mjs
 *
 * Substrate writes its OWN wiki pages. Reads its own activity log
 * over a window (default 7 days) and asks Claude to distill into a
 * new wiki page that future actions will read as prior knowledge
 * via wiki-brain.mjs.
 *
 * This is how substrate becomes smarter over time WITHOUT fine-tuning:
 * each consolidation cycle adds compressed knowledge to the wiki that
 * informs future Claude calls. After 4 weeks substrate's wiki should
 * contain its own patterns, not just human-curated content.
 *
 * Throttled: writes max 1 new wiki page per day to avoid wiki bloat
 * and budget drain. Skips if last consolidation was within 24h.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

import { think } from "./llm-think.mjs";
import { getIdentityBlock } from "./operator-identity.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const WIKI_DIR = resolve(ROOT, ".data/wiki-archive");
const STATE_PATH = resolve(ROOT, ".data/survival-memory-consolidation-state.json");
const SURVIVAL_DB = resolve(ROOT, ".data/survival.db");
const LEDGER_PATH = resolve(ROOT, ".data/survival-experiment-log.jsonl");

const THROTTLE_HOURS = 24;

function ensureDir(p) { if (!existsSync(p)) mkdirSync(p, { recursive: true }); }

function loadState() {
  if (!existsSync(STATE_PATH)) return { last_consolidation_at: null, count: 0 };
  try { return JSON.parse(readFileSync(STATE_PATH, "utf-8")); }
  catch { return { last_consolidation_at: null, count: 0 }; }
}

function saveState(s) {
  writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}

function gatherActivityWindow(hours = 168) {
  const sinceISO = new Date(Date.now() - hours * 3600_000).toISOString();
  // Strategies + their outcomes
  const db = new Database(SURVIVAL_DB, { readonly: true });
  let strategies = [];
  let opps = [];
  let llm_calls = 0;
  let llm_cost = 0;
  try {
    strategies = db.prepare(
      `SELECT action_id, status, attempts, observations, food_received_usd
       FROM policy_strategies
       WHERE status_changed_at > ? OR attempts > 0`
    ).all(sinceISO);
    opps = db.prepare(
      `SELECT id, title, source, state, state_changed_at FROM opportunities
       WHERE state_changed_at > ?
       ORDER BY state_changed_at`
    ).all(sinceISO);
    const cost = db.prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(cost_usd),0) AS total FROM llm_call_log
       WHERE ts > ?`
    ).get(sinceISO);
    llm_calls = cost.n;
    llm_cost = cost.total;
  } catch {}
  db.close();
  // Recent ledger events
  let ledger = [];
  if (existsSync(LEDGER_PATH)) {
    ledger = readFileSync(LEDGER_PATH, "utf-8").split("\n").filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean)
      .filter(e => e.ts && e.ts > sinceISO);
  }
  return { sinceISO, strategies, opps, ledger, llm_calls, llm_cost };
}

export const memoryConsolidationMeta = {
  description: "Distill substrate's recent activity into a new wiki page. Throttled to once per 24h.",
  side_effect_class: "auto",
  expected_signal: "wiki_page_appended",
  expected_signal_delay_min: 0,
  estimated_cost_usd: 0.20,
};

export async function runMemoryConsolidation({ strategy }) {
  const state = loadState();
  if (state.last_consolidation_at) {
    const ageH = (Date.now() - new Date(state.last_consolidation_at).getTime()) / 3600_000;
    if (ageH < THROTTLE_HOURS) return { ok: true, reason: "throttled", hours_since_last: ageH.toFixed(1) };
  }

  const window = gatherActivityWindow(7 * 24);
  // Need at least some activity to be worth consolidating
  if (window.strategies.length === 0 && window.opps.length === 0 && window.ledger.length < 10) {
    return { ok: true, reason: "insufficient_activity_to_consolidate", window };
  }

  // Top action_ids by attempts
  const byAction = {};
  for (const s of window.strategies) {
    byAction[s.action_id] = byAction[s.action_id] || { attempts: 0, food: 0, count: 0 };
    byAction[s.action_id].attempts += s.attempts;
    byAction[s.action_id].food += s.food_received_usd;
    byAction[s.action_id].count += 1;
  }
  const actionsRanked = Object.entries(byAction).sort((a, b) => b[1].attempts - a[1].attempts);

  const oppsBlock = window.opps.slice(0, 20).map(o =>
    `- ${o.id} | ${o.state} | ${o.title.slice(0, 80)} | source=${o.source}`
  ).join("\n");
  const actionsBlock = actionsRanked.slice(0, 15).map(([action, st]) =>
    `- ${action}: ${st.attempts} attempts across ${st.count} strategies, food=${st.food.toFixed(2)}`
  ).join("\n");
  const ledgerSample = window.ledger.slice(-15).map(e =>
    `- ${e.ts} | ${e.kind} | ${e.action_id || "?"} | ok=${e.action_result?.ok ?? "?"}`
  ).join("\n");

  const identity = getIdentityBlock();

  const prompt = `You are substrate. Review your past 7 days of activity and write ONE wiki page distilling what happened, what you learned, and what to try differently.

OPERATOR IDENTITY (constraint):
${identity}

YOUR ACTIVITY (window: ${window.sinceISO} to now)

LLM calls: ${window.llm_calls}, total spend: $${window.llm_cost.toFixed(2)}

Top actions by attempt count:
${actionsBlock}

Opportunity transitions:
${oppsBlock}

Recent action ledger sample:
${ledgerSample}

TASK: produce a markdown wiki page that future substrate ticks will read as prior knowledge. Title should be specific (e.g. "what worked in week of <date>"), not generic.

Sections REQUIRED:
## What I did this week
2-4 sentences summarizing actions taken.

## What worked (with evidence)
3-5 named patterns. For each: what action, what outcome (operator approval, opportunity promotion, file artifact). Anchor each in concrete data from the ledger.

## What did not work (with evidence)
3-5 named anti-patterns. Same evidence requirement.

## What to try next week
2-3 specific shifts. Concrete enough to be actionable.

## Key facts learned about operator's market
2-4 facts about Canada SMB / specific opportunities / ICP that are now common knowledge in the wiki.

NO em dashes. Hyphens only. NO hype. Plain text wisdom.

Output ONLY the markdown content (with frontmatter).`;

  const result = await think({
    prompt, caller: "memory_consolidation", strategy_id: strategy.id,
    max_input_tokens: 6000, max_output_tokens: 2500,
  });
  if (!result.ok) return { ok: false, reason: result.reason, error: result.error };

  ensureDir(WIKI_DIR);
  const slug = `substrate-week-${new Date().toISOString().slice(0, 10)}-consolidation`;
  const out = resolve(WIKI_DIR, `${slug}.md`);
  const header = `---
title: "Substrate weekly consolidation"
generated_at: ${new Date().toISOString()}
generated_by: substrate_self
window_start: ${window.sinceISO}
strategies_in_window: ${window.strategies.length}
opportunities_in_window: ${window.opps.length}
llm_calls_in_window: ${window.llm_calls}
llm_cost_in_window: $${window.llm_cost.toFixed(2)}
---

`;
  writeFileSync(out, header + result.output);

  saveState({ last_consolidation_at: new Date().toISOString(), count: state.count + 1 });

  return {
    ok: true,
    output_file: out,
    llm_cost_usd: result.cost_usd,
    consolidation_count: state.count + 1,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await runMemoryConsolidation({ strategy: { id: "manual" } });
  console.log(JSON.stringify(r, null, 2));
}
