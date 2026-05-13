/**
 * MODEL ROUTER — Autonomous cost-optimized model selection
 *
 * Available models (GPT-5.4 family):
 *   gpt-5.4        — strongest reasoning, most expensive (~$0.03/call)
 *   gpt-5.4-mini   — balanced quality/cost (~$0.005/call)
 *   gpt-5.4-nano   — cheapest, fastest (~$0.001/call)
 *   codex-5.4      — code generation optimized
 *
 * The router STARTS everything on nano (cheapest).
 * If quality drops (KPD low, failures), it ESCALATES to mini.
 * If still poor, escalates to 5.4.
 * It tracks savings and adjusts continuously.
 *
 * The system optimizes its own costs without human intervention.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const ROUTER_PATH = resolve(ROOT, ".data/cortex-model-router.json");

// ── MODEL DEFINITIONS ──────────────────────────────────────────────────
//
// Hybrid routing: GPT handles structured JSON/classification tasks (fast, cheap).
// Claude handles nuanced writing, creativity, and deep reasoning (better quality).
// If ANTHROPIC_API_KEY is absent, Claude tasks auto-fallback to GPT equivalents.
//
// provider: "openai" | "anthropic"

export const MODELS = {
  // GPT family - fast structured reasoning, classification, JSON output
  "gpt-5.4":          { provider: "openai",    tier: 3, costPer1k: 0.030, quality: "highest",  use: "complex structured reasoning, strategy" },
  "gpt-5.4-mini":     { provider: "openai",    tier: 2, costPer1k: 0.005, quality: "good",     use: "routine decisions, scoring, classification" },
  "gpt-5.4-nano":     { provider: "openai",    tier: 1, costPer1k: 0.001, quality: "basic",    use: "simple tasks, parsing, formatting, quick checks" },
  "codex-5.4":        { provider: "openai",    tier: 2, costPer1k: 0.004, quality: "code",     use: "code generation, config writing" },
  // Claude family - nuanced writing, creative synthesis, deep introspection
  "claude-haiku-4-5": { provider: "anthropic", tier: 1, costPer1k: 0.001, quality: "fast",     use: "cheap classification, quick checks (Claude side)" },
  "claude-sonnet-4-6":{ provider: "anthropic", tier: 2, costPer1k: 0.003, quality: "creative", use: "outreach writing, content, hypothesis generation, self-analysis" },
  "claude-opus-4-6":  { provider: "anthropic", tier: 3, costPer1k: 0.015, quality: "premium",  use: "commercial proposals, complex persuasive writing" },
};

// GPT fallback for each Claude model (used when ANTHROPIC_API_KEY absent)
export const CLAUDE_TO_GPT_FALLBACK = {
  "claude-haiku-4-5":  "gpt-5.4-nano",
  "claude-sonnet-4-6": "gpt-5.4-mini",
  "claude-opus-4-6":   "gpt-5.4",
};

// ── TASK CATEGORIES ────────────────────────────────────────────────────
//
// Routing principle:
//   GPT  = structured JSON output, high-volume classification, planning loops
//   Claude = human-facing writing, creative synthesis, introspective self-analysis

// A/B test result (2026-04-21): Claude wins on strategy/self-analysis/long reasoning.
// GPT stays on code, tools, fast cycles, and JSON-output loops.
const DEFAULT_ROUTING = {
  // CORTEX brain modules
  "brain-fast":       "gpt-5.4-nano",     // routine cycle thinking (speed + cost)
  "brain-planner":    "claude-sonnet-4-6", // 5-step strategic plan - Claude wins on reasoning depth
  "brain-critic":     "gpt-5.4-nano",     // plan critique (pattern matching, cheap)
  "brain-resolver":   "gpt-5.4-nano",     // synthesize final decisions (JSON output, GPT reliable)
  // Self-awareness and evolution - Claude for introspection + creative hypotheses
  "conscious-doctor": "claude-sonnet-4-6", // self-awareness examination
  "evolution-engine": "claude-sonnet-4-6", // hypothesis generation

  // Bot tasks - GPT for volume/structure, Claude for human-facing writing
  "scout-scoring":    "gpt-5.4-nano",     // lead scoring (high volume, simple classification)
  "lead-enrichment":  "gpt-5.4-mini",     // structured enrichment (JSON schema)
  "draft-outreach":   "claude-sonnet-4-6", // outreach messages (human-facing, nuance matters)
  "draft-quality":    "gpt-5.4-nano",     // quality check (pattern matching)
  "content-draft":    "claude-sonnet-4-6", // LinkedIn post drafting (creativity + voice)
  "brief-generation": "gpt-5.4-nano",     // morning brief (summarization, cheap)
  "idea-generation":  "gpt-5.4-mini",     // revenue idea synthesis (structured)
  "proposal-writing": "claude-opus-4-6",  // commercial proposals (premium Claude)
};

// ── ROUTER STATE ───────────────────────────────────────────────────────

function loadRouterState() {
  if (!existsSync(ROUTER_PATH)) {
    const state = {
      routing: { ...DEFAULT_ROUTING },
      performance: {},  // task -> { calls, failures, escalations, totalCost }
      totalSaved: 0,
      lastOptimized: null,
    };
    saveRouterState(state);
    return state;
  }
  try { return JSON.parse(readFileSync(ROUTER_PATH, "utf-8")); } catch { return { routing: { ...DEFAULT_ROUTING }, performance: {}, totalSaved: 0 }; }
}

function saveRouterState(state) {
  writeFileSync(ROUTER_PATH, JSON.stringify(state, null, 2));
}

// ── GET MODEL FOR TASK ─────────────────────────────────────────────────

export function getModel(taskName) {
  const state = loadRouterState();
  return state.routing[taskName] || "gpt-5.4-nano"; // default to cheapest
}

// Returns "openai" or "anthropic" for a given model name.
export function getProvider(model) {
  return MODELS[model]?.provider || "openai";
}

// ── REPORT RESULT (for adaptive routing) ───────────────────────────────

export function reportModelResult(taskName, success, quality = null) {
  const state = loadRouterState();

  if (!state.performance[taskName]) {
    state.performance[taskName] = { calls: 0, successes: 0, failures: 0, escalations: 0, deescalations: 0 };
  }

  const perf = state.performance[taskName];
  perf.calls++;

  if (success) {
    perf.successes++;
  } else {
    perf.failures++;
  }

  // Auto-escalate: if failure rate > 30% over last 10 calls, upgrade model
  const recentFailRate = perf.calls >= 5 ? perf.failures / perf.calls : 0;
  const currentModel = state.routing[taskName] || "gpt-5.4-nano";
  const currentTier = MODELS[currentModel]?.tier || 1;

  if (recentFailRate > 0.3 && currentTier < 3) {
    // Escalate
    const nextModel = currentTier === 1 ? "gpt-5.4-mini" : "gpt-5.4";
    state.routing[taskName] = nextModel;
    perf.escalations++;
    perf.failures = 0; // reset after escalation
    perf.calls = 0;
  }

  // Auto-deescalate: if success rate > 90% over 20+ calls, try cheaper model
  const successRate = perf.calls >= 20 ? perf.successes / perf.calls : 0;
  if (successRate > 0.9 && currentTier > 1 && perf.calls >= 20) {
    const prevModel = currentTier === 3 ? "gpt-5.4-mini" : "gpt-5.4-nano";
    state.routing[taskName] = prevModel;
    perf.deescalations++;
    perf.successes = 0;
    perf.calls = 0;

    // Calculate savings
    const savedPerCall = (MODELS[currentModel]?.costPer1k || 0) - (MODELS[prevModel]?.costPer1k || 0);
    state.totalSaved += savedPerCall * 20; // estimate 20 calls worth of savings
  }

  saveRouterState(state);
}

// ── GET ROUTING TABLE (for dashboard/conscious doctor) ──────────────────

export function getRoutingTable() {
  const state = loadRouterState();
  return {
    routing: state.routing,
    performance: state.performance,
    totalSaved: state.totalSaved,
    summary: Object.entries(state.routing).map(([task, model]) => {
      const perf = state.performance[task] || {};
      const tier = MODELS[model]?.tier || 0;
      return `${task}: ${model} (tier ${tier}, ${perf.calls || 0} calls, ${perf.failures || 0} fails)`;
    }),
  };
}

// ── COST ESTIMATOR ─────────────────────────────────────────────────────

export function estimateCost(taskName, tokenEstimate = 1000) {
  const model = getModel(taskName);
  return (MODELS[model]?.costPer1k || 0.005) * (tokenEstimate / 1000);
}

// ── FORCE MODEL (for conscious doctor to override) ─────────────────────

export function setModelForTask(taskName, model) {
  if (!MODELS[model]) return false;
  const state = loadRouterState();
  state.routing[taskName] = model;
  saveRouterState(state);
  return true;
}

// ── OPTIMIZE ALL ROUTES (called by evolution engine) ────────────────────

export function optimizeRoutes() {
  const state = loadRouterState();
  const changes = [];

  for (const [task, perf] of Object.entries(state.performance)) {
    if (perf.calls < 10) continue; // not enough data

    const currentModel = state.routing[task];
    const failRate = perf.failures / perf.calls;
    const successRate = perf.successes / perf.calls;
    const tier = MODELS[currentModel]?.tier || 1;

    // Escalate if failing
    if (failRate > 0.3 && tier < 3) {
      const next = tier === 1 ? "gpt-5.4-mini" : "gpt-5.4";
      state.routing[task] = next;
      changes.push({ task, from: currentModel, to: next, reason: `${(failRate*100).toFixed(0)}% fail rate` });
    }

    // Deescalate if succeeding
    if (successRate > 0.9 && tier > 1 && perf.calls >= 20) {
      const prev = tier === 3 ? "gpt-5.4-mini" : "gpt-5.4-nano";
      state.routing[task] = prev;
      changes.push({ task, from: currentModel, to: prev, reason: `${(successRate*100).toFixed(0)}% success, downgrading to save cost` });
    }
  }

  saveRouterState(state);
  return changes;
}
