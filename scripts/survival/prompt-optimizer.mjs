/**
 * scripts/survival/prompt-optimizer.mjs
 *
 * Lite DSPy/GEPA-style prompt optimizer. No Python dependency.
 *
 * Pattern: take an action's prompt template + a set of recent
 * (input, real-outcome) pairs from substrate's logs. Use Claude as
 * a meta-optimizer to propose a refined prompt. Score candidates by
 * re-running them on held-out examples and measuring outcome quality.
 * Keep the winner; commit the new prompt template back to the action.
 *
 * Genetic-Pareto pattern (light):
 *   1. Population of N=4 prompt variants
 *   2. Score each by predicted outcome (Claude rates outputs)
 *   3. Keep top 2, mutate via Claude into 2 new
 *   4. Repeat for K generations (default 2)
 *   5. Best wins, written to .data/prompt-optimization-history/
 *
 * For now this is OFFLINE batch — runs once per week via pulse step.
 * Action templates are stored in .data/prompt-templates/<action_id>.md
 * so they can be swapped out without code change. If no template
 * file exists for an action, this is a no-op for that action.
 *
 * COST: high. Each optimization cycle is 4 candidates × K generations
 * × 2 LLM calls (generate + score) = ~16 LLM calls per action.
 * Throttled to 1 action per week. Skips if no real outcome data exists.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, appendFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

import { think } from "./llm-think.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const TEMPLATES_DIR = resolve(ROOT, ".data/prompt-templates");
const HISTORY_DIR = resolve(ROOT, ".data/prompt-optimization-history");
const STATE_PATH = resolve(ROOT, ".data/prompt-optimizer-state.json");
const SURVIVAL_DB = resolve(ROOT, ".data/survival.db");

const POPULATION_SIZE = 4;
const GENERATIONS = 2;
const MIN_OUTCOMES_REQUIRED = 5;
const THROTTLE_HOURS = 7 * 24; // weekly

function ensureDir(p) { if (!existsSync(p)) mkdirSync(p, { recursive: true }); }
function loadState() {
  if (!existsSync(STATE_PATH)) return { last_run_at: null, last_action_optimized: null };
  try { return JSON.parse(readFileSync(STATE_PATH, "utf-8")); }
  catch { return { last_run_at: null, last_action_optimized: null }; }
}
function saveState(s) {
  ensureDir(dirname(STATE_PATH));
  writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}

function listTemplateActions() {
  if (!existsSync(TEMPLATES_DIR)) return [];
  return readdirSync(TEMPLATES_DIR).filter(f => f.endsWith(".md")).map(f => f.replace(/\.md$/, ""));
}

function loadTemplate(action_id) {
  const p = resolve(TEMPLATES_DIR, `${action_id}.md`);
  if (!existsSync(p)) return null;
  return readFileSync(p, "utf-8");
}

function saveTemplate(action_id, content) {
  ensureDir(TEMPLATES_DIR);
  writeFileSync(resolve(TEMPLATES_DIR, `${action_id}.md`), content);
}

function gatherOutcomesForAction(action_id, limit = 10) {
  // Real outcomes = strategies of this action_id that have food_received_usd > 0
  // OR queue entries with operator decisions matching strategies of this action.
  if (!existsSync(SURVIVAL_DB)) return [];
  const db = new Database(SURVIVAL_DB, { readonly: true });
  let rows = [];
  try {
    rows = db.prepare(
      `SELECT id, parameters_json, attempts, food_received_usd, total_cost_usd
       FROM policy_strategies
       WHERE action_id = ? AND attempts > 0
       ORDER BY food_received_usd DESC LIMIT ?`
    ).all(action_id, limit);
  } catch { rows = []; }
  db.close();
  return rows;
}

async function generateMutation(currentTemplate, examples, mutation_hint) {
  const examplesBlock = examples.slice(0, 4).map((e, i) =>
    `Example ${i + 1}: parameters=${e.parameters_json?.slice(0, 200)} food_received=$${(e.food_received_usd || 0).toFixed(2)} cost=$${(e.total_cost_usd || 0).toFixed(3)}`
  ).join("\n");
  const prompt = `You are GEPA-lite, a prompt optimizer. Given a CURRENT prompt template used by an autonomous AI agent, and a set of REAL OUTCOMES from past runs, propose a SINGLE refined version of the prompt that should produce better outcomes.

CURRENT PROMPT:
${currentTemplate}

REAL OUTCOMES OBSERVED:
${examplesBlock}

MUTATION HINT (apply this kind of change):
${mutation_hint}

Output ONLY the refined prompt template. No explanation, no preamble.`;

  const result = await think({
    prompt, caller: "prompt_optimizer:mutate", max_input_tokens: 5000, max_output_tokens: 2000,
  });
  return result.ok ? result.output.trim() : null;
}

async function scoreVariant(template, examples) {
  const block = examples.slice(0, 3).map(e => `params=${e.parameters_json?.slice(0, 150)} food=$${(e.food_received_usd || 0).toFixed(2)}`).join(" | ");
  const prompt = `Rate this PROMPT TEMPLATE for an autonomous AI agent on a 0-10 scale based on whether it would produce outputs likely to attract more positive outcomes than current behavior.

PROMPT:
${template}

PAST OUTCOMES from current behavior: ${block}

Output ONLY JSON: {"score": <0-10 float>, "rationale": "<one sentence>"}`;

  const result = await think({
    prompt, caller: "prompt_optimizer:score", max_input_tokens: 4000, max_output_tokens: 200,
  });
  if (!result.ok) return { score: 0, rationale: result.reason };
  try {
    const m = result.output.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : { score: 0, rationale: "parse_failed" };
  } catch { return { score: 0, rationale: "parse_failed" }; }
}

export const promptOptimizerMeta = {
  description: "Weekly batch optimization of action prompt templates using GEPA-lite genetic loop. Throttled to 1 action per week.",
  side_effect_class: "auto",
  expected_signal: "prompt_template_evolved",
  expected_signal_delay_min: 0,
  estimated_cost_usd: 1.50, // 16+ LLM calls per cycle
};

export async function runPromptOptimizer({ strategy }) {
  const state = loadState();
  if (state.last_run_at) {
    const ageH = (Date.now() - new Date(state.last_run_at).getTime()) / 3600_000;
    if (ageH < THROTTLE_HOURS) return { ok: true, reason: "throttled", hours_since_last: ageH.toFixed(1) };
  }

  const actions = listTemplateActions();
  if (actions.length === 0) {
    return {
      ok: true,
      reason: "no_templates_yet",
      hint: `Create .data/prompt-templates/<action_id>.md to enable optimization for that action`,
    };
  }

  // Pick the action whose templates we haven't optimized most recently
  const candidate_action = actions.find(a => a !== state.last_action_optimized) || actions[0];
  const examples = gatherOutcomesForAction(candidate_action, 10);
  if (examples.length < MIN_OUTCOMES_REQUIRED) {
    return {
      ok: true,
      reason: "insufficient_outcomes",
      action: candidate_action,
      examples_found: examples.length,
      min_required: MIN_OUTCOMES_REQUIRED,
    };
  }

  const baseTemplate = loadTemplate(candidate_action);
  if (!baseTemplate) return { ok: false, reason: "template_load_failed" };

  ensureDir(HISTORY_DIR);
  const runDir = resolve(HISTORY_DIR, `${candidate_action}-${Date.now()}`);
  ensureDir(runDir);
  writeFileSync(resolve(runDir, "base.md"), baseTemplate);

  // Generation 0: population of base + 3 mutations
  const mutationHints = [
    "Make outcomes more concrete and numerical",
    "Tighten ICP framing — more specific buyer persona",
    "Add explicit risk-aware framing — what kills the deal",
  ];
  let population = [{ id: "base", template: baseTemplate, score: 0 }];
  for (let i = 0; i < mutationHints.length; i++) {
    const m = await generateMutation(baseTemplate, examples, mutationHints[i]);
    if (m) population.push({ id: `gen0-mut${i}`, template: m, score: 0 });
  }

  // Score generation 0
  for (const p of population) {
    const s = await scoreVariant(p.template, examples);
    p.score = s.score;
    p.rationale = s.rationale;
  }

  // Generation 1: take top 2, mutate each into 1 child
  for (let g = 1; g < GENERATIONS; g++) {
    population.sort((a, b) => b.score - a.score);
    const survivors = population.slice(0, 2);
    const children = [];
    for (let i = 0; i < survivors.length; i++) {
      const m = await generateMutation(survivors[i].template, examples, "Refine further: keep what works, fix what does not");
      if (m) children.push({ id: `gen${g}-child${i}`, template: m, score: 0 });
    }
    for (const c of children) {
      const s = await scoreVariant(c.template, examples);
      c.score = s.score;
      c.rationale = s.rationale;
    }
    population = [...survivors, ...children];
  }

  // Pick winner
  population.sort((a, b) => b.score - a.score);
  const winner = population[0];
  // Save run history + write winner as new template (only if meaningfully better)
  for (const p of population) {
    writeFileSync(resolve(runDir, `${p.id}-score${p.score.toFixed(1)}.md`), p.template);
  }
  appendFileSync(resolve(runDir, "summary.json"), JSON.stringify({
    candidate_action,
    base_score: population.find(p => p.id === "base")?.score || 0,
    winner_id: winner.id,
    winner_score: winner.score,
    population: population.map(p => ({ id: p.id, score: p.score, rationale: p.rationale })),
  }, null, 2));

  const baseScore = population.find(p => p.id === "base")?.score || 0;
  const replaced = winner.score > baseScore + 0.5;
  if (replaced) saveTemplate(candidate_action, winner.template);

  saveState({ last_run_at: new Date().toISOString(), last_action_optimized: candidate_action });

  return {
    ok: true,
    action: candidate_action,
    base_score: baseScore,
    winner_id: winner.id,
    winner_score: winner.score,
    replaced,
    history_dir: runDir,
  };
}
