/**
 * CORTEX SIMULATION ENGINE — Think before you act
 *
 * Every other AI agent: "Send email. Wait. See what happens."
 * CORTEX: "If I send this email, what will happen? Let me simulate."
 *
 * The Simulation Engine takes a proposed action and predicts its outcome
 * BEFORE executing it. It uses:
 *
 * 1. WORLD MODEL — beliefs about the market, channels, competitors
 * 2. NARRATIVE MEMORY — what happened when we tried similar things
 * 3. PREDICTION HISTORY — how accurate our past predictions were
 * 4. BASE RATES — statistical priors for different action types
 *
 * For each proposed action, it returns:
 * - Expected outcome (what will probably happen)
 * - Expected value (0-10 scale, how much does this help revenue)
 * - Confidence (how sure are we)
 * - Risks (what could go wrong)
 * - Better alternative (if simulation finds a higher EV action)
 *
 * The brain uses simulation to CHOOSE between actions.
 * After the action, the actual result is compared to prediction.
 * This closes the loop: predict -> act -> compare -> learn.
 *
 * No other system does this. They all act blindly.
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { getBeliefs, getUntestedPredictions, getPredictionAccuracy, makePrediction, testPrediction } from "./world-model.mjs";
import { getActiveThreads } from "./narrative.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const ENV_PATH = resolve(ROOT, "apps/api/.env");

const env = Object.fromEntries(
  readFileSync(ENV_PATH, "utf-8").split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

// ── BASE RATES ────────────────────────────────────────────────────────
// Statistical priors from our experience and general knowledge

const BASE_RATES = {
  "cold_email_generic": { response_rate: 0.00, conversion: 0.00, evidence: "103 sent, 0 replies - confirmed dead channel" },
  "cold_email_specific": { response_rate: 0.01, conversion: 0.005, evidence: "not tested standalone, but 103 generic cold emails got 0 replies; entire cold email channel classified dead - rate lowered from industry baseline" },
  "reddit_comment": { response_rate: 0.15, conversion: 0.02, evidence: "confirmed best channel; comment-first approach, Calgary AI services (vibe-code audit, automation, first-10-customers)" },
  "reddit_dm": { response_rate: 0.00, conversion: 0.00, evidence: "77 sent, 0 replies" },
  "fiverr_organic": { response_rate: 0.02, conversion: 0.01, evidence: "gig live, 0 clients acquired as of Apr 2026" },
  "google_ads": { response_rate: 0.015, conversion: 0.003, evidence: "running since Apr 15 2026 at $10/day, 0 conversions" },
  "linkedin_comment": { response_rate: 0.08, conversion: 0.01, evidence: "8 outbound sent, 0 replies; comment-first approach, no premium" },
  "linkedin_dm": { response_rate: 0.00, conversion: 0.00, evidence: "8 sent, 0 replies; no LinkedIn Premium, 200-char note limit" },
  "outbound_call": { response_rate: 0.00, conversion: 0.00, evidence: "vapi caller discontinued 2026-04-22, 0 value in 5 runs" },
  "demo_call": { response_rate: 0.30, conversion: 0.15, evidence: "industry average for booked demos - no internal data yet, 0 clients acquired" },
};

// ── CORE SIMULATION ───────────────────────────────────────────────────

/**
 * Simulate the outcome of a proposed action.
 *
 * @param {object} db - Database
 * @param {object} action - The proposed action (from brain decisions)
 * @param {object} [options]
 * @returns {object} { expectedOutcome, expectedValue, confidence, risks, alternative, predictionId }
 */
export async function simulate(db, action, options = {}) {
  const log = options.log || console.log;

  // 1. Gather context for simulation
  const beliefs = getBeliefs(db, null, 0.3, 15);
  const threads = getActiveThreads(db, 5);
  const accuracy = getPredictionAccuracy(db);
  const calibration = accuracy?.total_tested > 0
    ? accuracy.correct / accuracy.total_tested
    : 0.5; // no track record = 50/50

  // 2. Fast simulation (no LLM) for simple actions
  const fastResult = fastSimulate(action, beliefs, threads, calibration);
  if (fastResult && !options.forceLLM) {
    // Record prediction for future calibration
    const predId = makePrediction(db,
      `Action ${action.action} ${action.workflow || action.bot || ""}: ${fastResult.expectedOutcome}`,
      fastResult.basis,
      fastResult.confidence,
      action.action
    );
    return { ...fastResult, predictionId: predId };
  }

  // 3. Deep simulation (LLM) for complex decisions
  return deepSimulate(db, action, beliefs, threads, calibration, log);
}

// ── FAST SIMULATION (no LLM, ~1ms) ───────────────────────────────────

function fastSimulate(action, beliefs, threads, calibration) {
  switch (action.action) {
    case "run_workflow": {
      if (action.workflow === "lead-pipeline") {
        const redditBelief = beliefs.find(b => b.belief.includes("Reddit") && b.belief.includes("comment"));
        return {
          expectedOutcome: "Scout finds 3-15 leads, enrichment classifies ~30%, outreach drafts sent to Telegram",
          expectedValue: 5,
          confidence: 0.7 * calibration,
          risks: ["Scout may find 0 if keywords stale", "Enrichment bot may timeout"],
          basis: "Pipeline has run successfully before. Reddit weight 80.",
          alternative: null,
        };
      }
      if (action.workflow === "reply-pipeline") {
        return {
          expectedOutcome: "Check for new replies, classify intent, notify if hot",
          expectedValue: 7, // replies are high value
          confidence: 0.6 * calibration,
          risks: ["May find 0 replies"],
          basis: "Reply monitoring is essential. Any real reply is high-value signal.",
          alternative: null,
        };
      }
      if (action.workflow === "morning-brief") {
        return {
          expectedOutcome: "Summary sent to Kirill via Telegram",
          expectedValue: 3,
          confidence: 0.9,
          risks: [],
          basis: "Always works. Low risk, moderate value.",
          alternative: null,
        };
      }
      return null; // unknown workflow, use LLM
    }

    case "run_bot": {
      if (action.bot === "scout-bot") {
        return {
          expectedOutcome: "Finds 5-20 raw leads from Reddit/Brave/HN. ~30% will be relevant.",
          expectedValue: 4,
          confidence: 0.65 * calibration,
          risks: ["May find duplicates of existing leads", "Brave API rate limit"],
          basis: "Scout has been finding leads consistently. KPD is positive.",
          alternative: null,
        };
      }
      return null;
    }

    case "deep_research": {
      return {
        expectedOutcome: "5+ pages read, structured insight with evidence and gaps",
        expectedValue: 6,
        confidence: 0.7,
        risks: ["Claude CLI timeout", "Irrelevant results if question too broad"],
        basis: "Deep research produces actionable insights that update world model.",
        alternative: null,
      };
    }

    case "execute_hands": {
      return {
        expectedOutcome: `Code change: ${action.task?.slice(0, 60)}. 1-3 files modified.`,
        expectedValue: action.type === "create_page" ? 7 : 5,
        confidence: 0.6,
        risks: ["Syntax errors in generated code", "May break existing functionality"],
        basis: "Claude CLI code changes work but need verification.",
        alternative: null,
      };
    }

    case "skip": {
      return {
        expectedOutcome: "Nothing happens. Money saved.",
        expectedValue: 1,
        confidence: 1.0,
        risks: ["Missing time-sensitive opportunity"],
        basis: "Skip is always safe but has opportunity cost.",
        alternative: null,
      };
    }

    default:
      return null;
  }
}

// ── DEEP SIMULATION (LLM, ~2s) ───────────────────────────────────────

async function deepSimulate(db, action, beliefs, threads, calibration, log) {
  const prompt = `You are the SIMULATION ENGINE of an autonomous business system.

PROPOSED ACTION:
${JSON.stringify(action, null, 2)}

WORLD MODEL BELIEFS (what the system knows):
${beliefs.slice(0, 8).map(b => `[${b.domain}] ${b.belief} (confidence: ${b.confidence})`).join("\n")}

NARRATIVE THREADS (recent history):
${threads.slice(0, 3).map(t => `[${t.status}] ${t.topic}: ${t.arc.slice(0, 150)}`).join("\n")}

PREDICTION CALIBRATION: ${(calibration * 100).toFixed(0)}% accuracy on past predictions

BASE RATES:
${Object.entries(BASE_RATES).map(([k, v]) => `${k}: response=${v.response_rate}, conversion=${v.conversion} (${v.evidence})`).join("\n")}

Simulate what will PROBABLY happen if this action is executed.
Be realistic - use base rates and past data, not optimism.

Return JSON:
{
  "expectedOutcome": "What will probably happen in 1-2 sentences",
  "expectedValue": 0-10 (0=waste, 5=moderate progress, 10=likely revenue),
  "confidence": 0.0-1.0 (how sure, calibrated to our track record),
  "risks": ["specific risk 1", "specific risk 2"],
  "basis": "Why I predict this (reference base rates, beliefs, or past results)",
  "alternative": {"action": "...", "reason": "This would have higher EV because..."} or null,
  "prediction": "A specific, testable prediction about the outcome"
}`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.4-mini",
        messages: [{ role: "user", content: prompt }],
        max_completion_tokens: 800,
        temperature: 0.3,
        response_format: { type: "json_object" },
      }),
    });

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return fallbackSimulation(action);

    const result = JSON.parse(content);

    // Record prediction for calibration
    const predId = makePrediction(db,
      result.prediction || `${action.action}: ${result.expectedOutcome?.slice(0, 100)}`,
      result.basis,
      result.confidence,
      action.action
    );

    return { ...result, predictionId: predId };
  } catch (e) {
    log(`[SIMULATION] LLM failed: ${e.message}`);
    return fallbackSimulation(action);
  }
}

function fallbackSimulation(action) {
  return {
    expectedOutcome: "Unable to simulate - proceeding with default expectation",
    expectedValue: 3,
    confidence: 0.3,
    risks: ["No simulation available"],
    basis: "Fallback - LLM unavailable",
    alternative: null,
  };
}

// ── DECISION RANKER ───────────────────────────────────────────────────

/**
 * Given multiple proposed actions, simulate all and rank by expected value.
 * This is the key function: the brain proposes N actions,
 * simulation ranks them, and only the best are executed.
 */
export async function rankDecisions(db, decisions, log = console.log) {
  const ranked = [];

  for (const decision of decisions) {
    if (decision.action === "remember" || decision.action === "update_focus") {
      // Non-actionable decisions always pass through
      ranked.push({ decision, simulation: { expectedValue: 5, confidence: 1.0 }, rank: "pass-through" });
      continue;
    }

    const sim = await simulate(db, decision, { log });
    ranked.push({
      decision,
      simulation: sim,
      ev: sim.expectedValue * sim.confidence, // expected value weighted by confidence
    });
  }

  // Sort by EV (highest first), but pass-throughs stay in place
  ranked.sort((a, b) => {
    if (a.rank === "pass-through") return 0;
    if (b.rank === "pass-through") return 0;
    return (b.ev || 0) - (a.ev || 0);
  });

  // Log rankings
  log(`[SIMULATION] Decision ranking:`);
  for (const r of ranked) {
    if (r.rank === "pass-through") continue;
    log(`  EV=${(r.ev || 0).toFixed(1)} | ${r.decision.action} ${r.decision.workflow || r.decision.bot || r.decision.task?.slice(0, 40) || ""} | ${r.simulation.expectedOutcome?.slice(0, 60)}`);
  }

  // Check if simulation suggests a better alternative
  const topSim = ranked.find(r => r.simulation?.alternative);
  if (topSim?.simulation?.alternative) {
    log(`[SIMULATION] ALTERNATIVE SUGGESTED: ${topSim.simulation.alternative.reason}`);
  }

  return ranked;
}

// ── OUTCOME TRACKING ──────────────────────────────────────────────────

/**
 * After an action completes, compare actual result to prediction.
 * This calibrates future predictions.
 */
export function recordOutcome(db, predictionId, actualResult, wasSuccessful, log = console.log) {
  if (!predictionId) return;

  const result = testPrediction(db, predictionId, actualResult, wasSuccessful);
  if (result) {
    log(`[SIMULATION] Prediction ${wasSuccessful ? "CORRECT" : "WRONG"} (error: ${result.error?.toFixed(2)}): ${result.prediction?.slice(0, 80)}`);
  }
}

// ── FORMAT FOR BRAIN ──────────────────────────────────────────────────

export function formatSimulationForBrain(db) {
  const accuracy = getPredictionAccuracy(db);
  if (!accuracy || accuracy.total_tested === 0) return "No prediction history yet.";

  return `Prediction accuracy: ${accuracy.correct}/${accuracy.total_tested} (${Math.round(accuracy.correct / accuracy.total_tested * 100)}%). Avg error: ${accuracy.avg_error}. Avg confidence: ${accuracy.avg_confidence}.`;
}
