/**
 * CORTEX ATTENTION — The spotlight that creates depth
 *
 * Human brain cannot think about everything at once.
 * When deeply thinking about closing a client, it FILTERS OUT
 * noise about competitor research, blog post ideas, system refactoring.
 *
 * Without attention:
 *   Cycle 1: "conference outreach"
 *   Cycle 2: "HVAC leads"
 *   Cycle 3: "self-evolution"
 *   Cycle 4: "back to conference"
 *   = shallow cycling, never goes deep, never produces quality
 *
 * With attention:
 *   Cycles 1-8: "conference outreach" (FOCUS MODE)
 *   - Research speakers, prepare talking points, draft emails,
 *     plan follow-up, simulate conversations, refine approach
 *   = DEEP work that produces real quality
 *
 * Attention is NOT the same as "focus allocation" (80% voice, 15% scanning).
 * Focus allocation says WHERE to invest across the day.
 * Attention says WHAT to think about RIGHT NOW, for the next N cycles.
 *
 * Three modes:
 * 1. SPOTLIGHT - locked on one topic, everything else queued
 * 2. SCANNING - broad awareness, no deep processing
 * 3. ALERT - interrupted by high-priority signal, spotlight suspended
 *
 * Attention is a finite resource. Using it on noise = wasting it.
 * The brain must CHOOSE what to attend to, and COMMIT.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { recall } from "./memory.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const ATTENTION_PATH = resolve(ROOT, ".data/cortex-attention.json");

// ── ATTENTION STATE ─────────────────────────────────────────────────────

function loadState() {
  if (!existsSync(ATTENTION_PATH)) {
    return {
      mode: "scanning",       // scanning | spotlight | alert
      spotlight: null,         // current focus topic when in spotlight mode
      spotlightStartedAt: null,
      spotlightCyclesRemaining: 0,
      spotlightDepth: 0,       // how many cycles deep we've gone
      spotlightHistory: [],    // what did we do while focused
      queue: [],               // signals received but deferred during spotlight
      alertStack: [],          // interrupted spotlights waiting to resume
      stats: {
        totalSpotlights: 0,
        avgDepth: 0,
        deepestEver: 0,
        interruptRate: 0,      // how often spotlight gets interrupted
      },
      lastUpdated: null,
    };
  }
  try { return JSON.parse(readFileSync(ATTENTION_PATH, "utf-8")); }
  catch { return loadState(); }
}

function saveState(state) {
  state.lastUpdated = new Date().toISOString();
  writeFileSync(ATTENTION_PATH, JSON.stringify(state, null, 2));
}

// ── ENGAGE SPOTLIGHT ────────────────────────────────────────────────────

/**
 * Lock attention onto a specific topic for N cycles.
 * During spotlight, only signals above interrupt threshold get through.
 * Everything else gets queued.
 *
 * @param {string} topic - what to focus on (e.g. "close Taren deal")
 * @param {number} cycles - how many cycles to maintain focus (default 6 = ~3 min of deep work)
 * @param {string} reason - why this deserves deep attention
 * @param {object} plan - optional step-by-step plan for the focus session
 */
export function engageSpotlight(topic, cycles = 6, reason = "", plan = null) {
  const state = loadState();

  // If already in spotlight on same topic, extend it
  if (state.mode === "spotlight" && state.spotlight?.topic === topic) {
    state.spotlightCyclesRemaining += cycles;
    saveState(state);
    return { action: "extended", topic, cyclesNow: state.spotlightCyclesRemaining };
  }

  // If in spotlight on DIFFERENT topic, push current to alert stack
  if (state.mode === "spotlight" && state.spotlight) {
    state.alertStack.push({
      ...state.spotlight,
      cyclesRemaining: state.spotlightCyclesRemaining,
      depth: state.spotlightDepth,
      history: state.spotlightHistory,
      suspendedAt: new Date().toISOString(),
    });
    // Keep stack manageable
    if (state.alertStack.length > 5) state.alertStack = state.alertStack.slice(-5);
  }

  state.mode = "spotlight";
  state.spotlight = {
    topic,
    reason,
    plan: plan || generateFocusPlan(topic),
    startedAt: new Date().toISOString(),
  };
  state.spotlightCyclesRemaining = cycles;
  state.spotlightDepth = 0;
  state.spotlightHistory = [];
  state.stats.totalSpotlights++;

  saveState(state);
  return { action: "engaged", topic, cycles, plan: state.spotlight.plan };
}

// ── GENERATE FOCUS PLAN ─────────────────────────────────────────────────

/**
 * When entering spotlight, generate a step-by-step plan for deep work.
 * This prevents shallow cycling within the focus session itself.
 */
function generateFocusPlan(topic) {
  const tLower = topic.toLowerCase();

  // Context-aware plans based on topic type
  if (/client|deal|close|sale|lead/i.test(tLower)) {
    return {
      steps: [
        { step: "research", desc: "Understand their business, pain points, context" },
        { step: "prepare", desc: "Draft tailored pitch, prepare objection handling" },
        { step: "simulate", desc: "Run simulation of their likely response" },
        { step: "execute", desc: "Send the outreach / make the contact" },
        { step: "plan_followup", desc: "Set up next touch if no immediate response" },
      ],
      currentStep: 0,
    };
  }

  if (/outreach|campaign|email/i.test(tLower)) {
    return {
      steps: [
        { step: "target", desc: "Identify specific recipients and their pain" },
        { step: "research_pain", desc: "Read their content, understand their world" },
        { step: "craft", desc: "Write highly specific, personalized messages" },
        { step: "quality_check", desc: "Check for AI-tells, em-dashes, generic language" },
        { step: "send", desc: "Execute the outreach" },
      ],
      currentStep: 0,
    };
  }

  if (/research|market|competitor|understand/i.test(tLower)) {
    return {
      steps: [
        { step: "define_question", desc: "What exactly do I need to learn?" },
        { step: "gather", desc: "Read 5+ real sources, not just summaries" },
        { step: "cross_reference", desc: "Compare sources, find contradictions" },
        { step: "form_opinion", desc: "Synthesize into a specific, testable belief" },
        { step: "update_model", desc: "Write findings to world model" },
      ],
      currentStep: 0,
    };
  }

  if (/content|post|linkedin|write/i.test(tLower)) {
    return {
      steps: [
        { step: "research_similar", desc: "Read 3-5 similar posts, study what worked" },
        { step: "find_angle", desc: "What unique insight can I add?" },
        { step: "draft", desc: "Write first draft, focus on hook and takeaway" },
        { step: "refine", desc: "Cut fluff, sharpen language, add specifics" },
        { step: "review", desc: "Final quality check, send to Kirill" },
      ],
      currentStep: 0,
    };
  }

  // Generic deep work plan
  return {
    steps: [
      { step: "understand", desc: "What exactly needs to be done and why?" },
      { step: "research", desc: "Gather relevant information" },
      { step: "plan", desc: "Define specific actions" },
      { step: "execute", desc: "Do the work" },
      { step: "verify", desc: "Did it achieve the goal?" },
    ],
    currentStep: 0,
  };
}

// ── TICK — called every cycle ───────────────────────────────────────────

/**
 * Process one attention cycle. Must be called at the start of each brain cycle.
 * Returns instructions for the brain: what to focus on, what's filtered.
 *
 * @param {object} signal - current cycle's primary signal/event (if any)
 * @returns {{ mode: string, instruction: string, filter: function, queue: array }}
 */
export function tick(signal = null) {
  const state = loadState();

  // ── SCANNING MODE: everything gets through ──────────────────────────
  if (state.mode === "scanning") {
    saveState(state);
    return {
      mode: "scanning",
      instruction: "Broad awareness. Look for something worth going deep on.",
      filter: () => true,       // nothing filtered
      queue: state.queue,
      spotlight: null,
    };
  }

  // ── SPOTLIGHT MODE: filter + depth tracking ─────────────────────────
  if (state.mode === "spotlight") {
    // Check if spotlight expired
    if (state.spotlightCyclesRemaining <= 0) {
      return exitSpotlight(state, "completed");
    }

    // Check if signal is important enough to interrupt
    if (signal) {
      const interruptPriority = getInterruptPriority(signal);
      // Only priority 9+ can interrupt spotlight (revenue events, errors)
      if (interruptPriority >= 9) {
        // Save spotlight state and switch to alert
        state.alertStack.push({
          ...state.spotlight,
          cyclesRemaining: state.spotlightCyclesRemaining,
          depth: state.spotlightDepth,
          history: state.spotlightHistory,
          suspendedAt: new Date().toISOString(),
        });
        state.mode = "alert";
        state.stats.interruptRate = (
          (state.stats.interruptRate * (state.stats.totalSpotlights - 1) + 1) /
          state.stats.totalSpotlights
        );
        saveState(state);

        return {
          mode: "alert",
          instruction: `INTERRUPT: ${signal.type} (priority ${interruptPriority}). Handle this, then resume "${state.spotlight.topic}".`,
          filter: () => true,
          queue: state.queue,
          spotlight: state.spotlight,
          interrupted: true,
        };
      } else {
        // Queue the signal for later
        state.queue.push({
          signal,
          queuedAt: new Date().toISOString(),
          reason: `Deferred: spotlight on "${state.spotlight.topic}"`,
        });
        // Keep queue manageable
        if (state.queue.length > 30) state.queue = state.queue.slice(-30);
      }
    }

    // Advance depth
    state.spotlightDepth++;
    state.spotlightCyclesRemaining--;

    // Advance plan step if applicable
    const plan = state.spotlight.plan;
    if (plan?.steps) {
      const stepsPerCycle = Math.max(1, Math.ceil(plan.steps.length / (state.spotlightDepth + state.spotlightCyclesRemaining)));
      if (state.spotlightDepth > 0 && state.spotlightDepth % stepsPerCycle === 0 && plan.currentStep < plan.steps.length - 1) {
        plan.currentStep++;
      }
    }

    // Track depth stats
    if (state.spotlightDepth > state.stats.deepestEver) {
      state.stats.deepestEver = state.spotlightDepth;
    }

    const currentStep = plan?.steps?.[plan.currentStep];
    const stepsLeft = plan?.steps ? plan.steps.length - (plan.currentStep + 1) : 0;

    saveState(state);

    // Build the focus filter: only topic-related signals pass
    const topicWords = state.spotlight.topic.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const filterFn = (signalText) => {
      if (!signalText) return false;
      const sLower = signalText.toLowerCase();
      return topicWords.some(w => sLower.includes(w));
    };

    return {
      mode: "spotlight",
      instruction: buildSpotlightInstruction(state, currentStep, stepsLeft),
      filter: filterFn,
      queue: state.queue,
      spotlight: state.spotlight,
      depth: state.spotlightDepth,
      cyclesRemaining: state.spotlightCyclesRemaining,
    };
  }

  // ── ALERT MODE: handle interrupt, then resume ─────────────────────
  if (state.mode === "alert") {
    // After handling alert, try to resume previous spotlight
    if (state.alertStack.length > 0) {
      const suspended = state.alertStack.pop();
      state.mode = "spotlight";
      state.spotlight = {
        topic: suspended.topic,
        reason: suspended.reason,
        plan: suspended.plan,
        startedAt: suspended.startedAt,
      };
      state.spotlightCyclesRemaining = suspended.cyclesRemaining;
      state.spotlightDepth = suspended.depth;
      state.spotlightHistory = suspended.history || [];
      saveState(state);

      return {
        mode: "spotlight",
        instruction: `Resuming spotlight: "${suspended.topic}" (${suspended.cyclesRemaining} cycles left, depth ${suspended.depth})`,
        filter: () => true,
        queue: state.queue,
        spotlight: state.spotlight,
        resumed: true,
      };
    }

    // Nothing to resume, go back to scanning
    state.mode = "scanning";
    saveState(state);
    return {
      mode: "scanning",
      instruction: "Alert handled. Back to broad scanning.",
      filter: () => true,
      queue: state.queue,
      spotlight: null,
    };
  }

  // Fallback
  return {
    mode: "scanning",
    instruction: "Default: scanning",
    filter: () => true,
    queue: [],
    spotlight: null,
  };
}

// ── EXIT SPOTLIGHT ──────────────────────────────────────────────────────

function exitSpotlight(state, reason) {
  const result = {
    topic: state.spotlight?.topic,
    depth: state.spotlightDepth,
    duration: state.spotlight?.startedAt
      ? Math.round((Date.now() - new Date(state.spotlight.startedAt).getTime()) / 60000)
      : 0,
    reason,
    historyLength: state.spotlightHistory.length,
  };

  // Update average depth
  const total = state.stats.totalSpotlights || 1;
  state.stats.avgDepth = (state.stats.avgDepth * (total - 1) + state.spotlightDepth) / total;

  // Process queued items
  const deferredQueue = [...state.queue];

  // Reset
  state.mode = "scanning";
  state.spotlight = null;
  state.spotlightCyclesRemaining = 0;
  state.spotlightDepth = 0;
  state.spotlightHistory = [];
  state.queue = [];

  saveState(state);

  return {
    mode: "scanning",
    instruction: `Spotlight ended (${reason}): "${result.topic}" — depth ${result.depth}, ${result.duration}min. ${deferredQueue.length} deferred signals to process.`,
    filter: () => true,
    queue: deferredQueue,
    spotlight: null,
    completedSpotlight: result,
  };
}

// ── RECORD SPOTLIGHT PROGRESS ───────────────────────────────────────────

/**
 * Record what the brain did during a spotlight cycle.
 * Builds the spotlight history for continuity.
 */
export function recordSpotlightAction(action, result) {
  const state = loadState();
  if (state.mode !== "spotlight") return;

  state.spotlightHistory.push({
    cycle: state.spotlightDepth,
    action,
    result: typeof result === "string" ? result : JSON.stringify(result).slice(0, 200),
    at: new Date().toISOString(),
  });

  // Keep history manageable
  if (state.spotlightHistory.length > 20) {
    state.spotlightHistory = state.spotlightHistory.slice(-20);
  }

  saveState(state);
}

// ── INTERRUPT PRIORITY CALCULATOR ───────────────────────────────────────

function getInterruptPriority(signal) {
  if (!signal) return 0;
  const type = signal.type || "";

  // Revenue events = highest interrupt
  if (/appointment|payment|sale|revenue/i.test(type)) return 10;
  if (/email_reply|reply/i.test(type)) return 9;
  if (/vapi_call|call/i.test(type)) return 9;

  // Kirill commands = high interrupt
  if (/telegram_command|kirill/i.test(type)) return 10;

  // System errors = high interrupt
  if (/error|critical|crash/i.test(type)) return 9;

  // New leads = moderate (don't interrupt deep work)
  if (/new_lead|lead/i.test(type)) return 5;

  // Bot events = low
  if (/bot_event/i.test(type)) return 3;

  // Everything else = very low
  return 2;
}

// ── BUILD SPOTLIGHT INSTRUCTION ─────────────────────────────────────────

function buildSpotlightInstruction(state, currentStep, stepsLeft) {
  const parts = [];
  parts.push(`SPOTLIGHT MODE: "${state.spotlight.topic}"`);
  parts.push(`Depth: ${state.spotlightDepth} | Cycles left: ${state.spotlightCyclesRemaining}`);

  if (currentStep) {
    parts.push(`CURRENT STEP: [${currentStep.step}] ${currentStep.desc}`);
  }
  if (stepsLeft > 0) {
    parts.push(`${stepsLeft} steps remaining in plan`);
  }

  if (state.spotlightHistory.length > 0) {
    const last = state.spotlightHistory.slice(-3);
    parts.push(`Recent progress: ${last.map(h => h.action).join(" -> ")}`);
  }

  parts.push(`${state.queue.length} signals QUEUED (will process after spotlight ends)`);
  parts.push("ONLY think about the spotlight topic. Everything else is filtered.");

  return parts.join("\n");
}

// ── SHOULD ENGAGE? (heuristic) ──────────────────────────────────────────

/**
 * Called by the brain to decide if a topic deserves deep attention.
 * Returns a recommendation, not a command.
 *
 * Criteria for engaging spotlight:
 * - Topic has revenue potential (client, deal, hot lead)
 * - Topic has time pressure (deadline, event)
 * - Topic requires multiple steps that build on each other
 * - Brain keeps returning to this topic across cycles (oscillation)
 */
export function shouldEngage(db, topic) {
  const tLower = topic.toLowerCase();
  let score = 0;
  let reasons = [];

  // Revenue potential
  if (/client|deal|sale|revenue|close|pay|money|price/i.test(tLower)) {
    score += 3;
    reasons.push("revenue-related");
  }

  // Time pressure
  if (/urgent|deadline|today|tomorrow|this week|conference|event/i.test(tLower)) {
    score += 2;
    reasons.push("time-sensitive");
  }

  // Multi-step nature (complex topics need depth)
  if (/outreach|campaign|research|build|create|plan|strateg/i.test(tLower)) {
    score += 1;
    reasons.push("multi-step task");
  }

  // Check if brain has been oscillating (same topic in recent memories)
  try {
    const recent = recall(db, "episodic", null, 10);
    const mentions = recent.filter(m => {
      const words = tLower.split(/\s+/).filter(w => w.length > 4);
      return words.some(w => m.content.toLowerCase().includes(w));
    }).length;
    if (mentions >= 3) {
      score += 2;
      reasons.push(`oscillation detected (${mentions} mentions in recent history)`);
    }
  } catch {}

  return {
    shouldEngage: score >= 3,
    score,
    reasons,
    suggestedCycles: score >= 5 ? 10 : score >= 3 ? 6 : 4,
  };
}

// ── FORCE EXIT ──────────────────────────────────────────────────────────

/**
 * Manually exit spotlight mode (e.g., Kirill overrides, or brain realizes
 * the topic is a dead end).
 */
export function disengageSpotlight(reason = "manual") {
  const state = loadState();
  if (state.mode !== "spotlight") {
    return { action: "none", reason: "Not in spotlight mode" };
  }

  const result = exitSpotlight(state, reason);
  return result;
}

// ── FORMAT FOR BRAIN CONTEXT ────────────────────────────────────────────

export function formatAttentionForBrain() {
  const state = loadState();

  if (state.mode === "scanning") {
    const parts = ["ATTENTION: Scanning (broad awareness)"];
    if (state.queue.length > 0) {
      parts.push(`${state.queue.length} deferred signals to review`);
    }
    parts.push(`Stats: ${state.stats.totalSpotlights} spotlights total, avg depth ${state.stats.avgDepth.toFixed(1)}, deepest ${state.stats.deepestEver}`);
    return parts.join(". ");
  }

  if (state.mode === "spotlight") {
    const plan = state.spotlight?.plan;
    const currentStep = plan?.steps?.[plan.currentStep];
    return `ATTENTION: SPOTLIGHT on "${state.spotlight?.topic}"
Depth: ${state.spotlightDepth} | Left: ${state.spotlightCyclesRemaining} cycles
${currentStep ? `Current step: [${currentStep.step}] ${currentStep.desc}` : ""}
${state.spotlightHistory.length > 0 ? `Progress: ${state.spotlightHistory.slice(-3).map(h => h.action).join(" -> ")}` : "No progress yet."}
${state.queue.length} signals deferred
DO NOT context-switch. Stay on topic: "${state.spotlight?.topic}"`;
  }

  if (state.mode === "alert") {
    return `ATTENTION: ALERT — handle interrupt, then resume spotlight`;
  }

  return "ATTENTION: active";
}

// ── STANDALONE TEST ─────────────────────────────────────────────────────

if (process.argv[1] && process.argv[1].includes("attention.mjs")) {
  console.log("=== ATTENTION MODULE TEST ===\n");

  // Test engage
  console.log("Engaging spotlight on 'close first client'...");
  const engaged = engageSpotlight("close first client", 8, "Revenue = $0. This is the #1 priority.");
  console.log("Result:", JSON.stringify(engaged, null, 2));

  // Test tick
  console.log("\nTick 1 (no signal):");
  const t1 = tick();
  console.log("Mode:", t1.mode);
  console.log("Instruction:", t1.instruction);

  // Test tick with low-priority signal (should be queued)
  console.log("\nTick 2 (low-priority signal):");
  const t2 = tick({ type: "new_lead", data: { name: "some lead" } });
  console.log("Mode:", t2.mode);
  console.log("Queue:", t2.queue.length, "items");

  // Test tick with high-priority signal (should interrupt)
  console.log("\nTick 3 (high-priority signal - reply!):");
  const t3 = tick({ type: "email_reply", data: { from: "hot prospect" } });
  console.log("Mode:", t3.mode);
  console.log("Interrupted:", t3.interrupted);

  // Test resume after alert
  console.log("\nTick 4 (alert handled, resume):");
  const t4 = tick();
  console.log("Mode:", t4.mode);
  console.log("Resumed:", t4.resumed);

  // Format for brain
  console.log("\nBrain context:");
  console.log(formatAttentionForBrain());
}

// ═══════════════════════════════════════════════════════════════════════════
// GWT LAYER 1 STEP 3 (2026-05-09): real attention competition via proposal queue
// ═══════════════════════════════════════════════════════════════════════════
//
// Existing engageSpotlight() is direct-mode: caller decides what gets focus.
// proposeSpotlight() is competition-mode: anyone can submit a candidate, then
// pickSpotlightWinner() chooses by urgency * recency-decay and engages the winner.
//
// This is the GWT broadcast pattern: modules COMPETE for global workspace, only
// one wins per tick, winner gets broadcast for other modules to react.
//
// Proposal scoring: score = urgency * recency_decay
//   recency_decay = 1.0 within first minute, 0.5 at 5 min, 0.1 at 10 min
//   proposals older than 10 min are dropped (stale)
// Tie-breaking: highest urgency wins; if tied, most recent wins.

const PROPOSAL_MAX_AGE_MS = 10 * 60_000;

function _scoreProposal(proposal, now) {
  const ageMs = now - new Date(proposal.proposedAt).getTime();
  if (ageMs >= PROPOSAL_MAX_AGE_MS) return 0;
  // Linear decay 1.0 -> 0.1 over 10 min
  const decay = Math.max(0.1, 1.0 - (0.9 * ageMs / PROPOSAL_MAX_AGE_MS));
  return proposal.urgency * decay;
}

function _ensureProposalQueueField(state) {
  if (!Array.isArray(state.proposalQueue)) state.proposalQueue = [];
}

/**
 * Submit a candidate spotlight to the competition queue.
 * GWT Layer 4 Step 4 (2026-05-09): urgency is now BIASED by current affect state.
 * High frustration -> all proposals get +1 to +2 urgency boost (system pushes harder).
 * High curiosity -> "investigate" / "research" topics get +1 to +2 extra boost.
 * High fatigue -> -1 to all (system conservative when tired).
 * Affect bias is read from affect-state.mjs at proposal time. Original urgency is
 * preserved in evidence for traceability.
 *
 * @param {string} topic - what to focus on
 * @param {number} urgency - 1-10 (higher = more urgent) - BEFORE affect bias
 * @param {string} evidence - why this matters (1-2 sentences, becomes spotlight reason if winning)
 * @param {string} source - module name that proposed (for accountability)
 * @returns {object} {accepted: bool, queueDepth, reason, biasedUrgency, originalUrgency, affectBias}
 */
export function proposeSpotlight(topic, urgency, evidence, source) {
  if (!topic || typeof topic !== "string") return { accepted: false, reason: "topic required" };
  if (typeof urgency !== "number" || urgency < 1 || urgency > 10) {
    return { accepted: false, reason: "urgency must be 1-10" };
  }

  // Layer 4 Step 4: apply affect-state bias to urgency.
  // Lazy import to avoid circular dependency (affect-state may not be loaded in tests).
  let biasedUrgency = urgency;
  let appliedBias = { urgencyDelta: 0, investigationBoost: 0 };
  try {
    // Dynamic require (sync). attention.mjs is imported by many modules, can't await here.
    // Use a simple in-memory cached reference.
    const affectMod = _affectModRef();
    if (affectMod && typeof affectMod.getAffectBias === "function") {
      const bias = affectMod.getAffectBias();
      appliedBias = bias;
      let delta = bias.urgencyDelta;
      const isInvestigation = /investigate|research|study|explore|review/i.test(topic);
      if (isInvestigation) delta += bias.investigationBoost;
      biasedUrgency = Math.max(1, Math.min(10, urgency + delta));
    }
  } catch {} // affect-state not loaded yet - use unbiased urgency
  const state = loadState();
  _ensureProposalQueueField(state);
  // Drop stale before adding new
  const now = Date.now();
  state.proposalQueue = state.proposalQueue.filter(p => (now - new Date(p.proposedAt).getTime()) < PROPOSAL_MAX_AGE_MS);
  // Dedup: if same source proposes same topic within last minute, replace instead of duplicate
  const dupIdx = state.proposalQueue.findIndex(p =>
    p.source === source && p.topic === topic &&
    (now - new Date(p.proposedAt).getTime()) < 60_000
  );
  const proposal = {
    topic,
    urgency: biasedUrgency,                // what attention competition uses
    originalUrgency: urgency,              // what the proposing module asked for
    affectBias: appliedBias,               // record of bias applied (audit)
    evidence: (evidence || "").slice(0, 500),
    source: source || "unknown",
    proposedAt: new Date().toISOString(),
  };
  if (dupIdx >= 0) state.proposalQueue[dupIdx] = proposal;
  else state.proposalQueue.push(proposal);
  saveState(state);
  return { accepted: true, queueDepth: state.proposalQueue.length, biasedUrgency, originalUrgency: urgency, affectBias: appliedBias };
}

// Lazy resolver for affect-state module reference. Avoids circular import.
// Set externally via setAffectModule() if you want explicit wiring.
let _affectModule = null;
function _affectModRef() {
  if (_affectModule) return _affectModule;
  try {
    // dynamic load via require-equivalent. In ESM we can't require() synchronously.
    // Modules using proposeSpotlight should call setAffectModule(import("./affect-state.mjs"))
    // at startup if they want bias applied. Without explicit set, no bias - safe default.
    return null;
  } catch { return null; }
}

/**
 * Wire the affect-state module reference for urgency biasing in proposeSpotlight.
 * Call this once from event-router or daemon startup.
 */
export function setAffectModule(mod) {
  _affectModule = mod;
}

/**
 * Pick the highest-scored proposal, engage it as spotlight, broadcast winner via bus.
 * If no proposals or current spotlight already active and not expired, returns {winner: null}.
 * @param {object} bus - state-bus module (with .broadcast). Optional - if absent, just returns winner without broadcasting.
 * @returns {object} {winner, score, alternatives}
 */
export function pickSpotlightWinner(bus) {
  const state = loadState();
  _ensureProposalQueueField(state);
  const now = Date.now();
  // Drop stale
  state.proposalQueue = state.proposalQueue.filter(p => (now - new Date(p.proposedAt).getTime()) < PROPOSAL_MAX_AGE_MS);
  if (state.proposalQueue.length === 0) {
    saveState(state);
    return { winner: null, reason: "no proposals in queue" };
  }
  // Score each
  const scored = state.proposalQueue.map(p => ({ proposal: p, score: _scoreProposal(p, now) }));
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // tie-break: most recent
    return new Date(b.proposal.proposedAt).getTime() - new Date(a.proposal.proposedAt).getTime();
  });
  const winner = scored[0];
  // Engage winner via existing engageSpotlight (uses its own state machine + persistence)
  engageSpotlight(winner.proposal.topic, 6, winner.proposal.evidence, null);
  // Remove winner from queue
  state.proposalQueue = state.proposalQueue.filter(p => p !== winner.proposal);
  saveState(state);
  // Broadcast via bus if provided
  if (bus && typeof bus.broadcast === "function") {
    bus.broadcast({
      source: "attention",
      type: "spotlight_winner",
      data: {
        topic: winner.proposal.topic,
        urgency: winner.proposal.urgency,
        score: winner.score,
        proposed_by: winner.proposal.source,
        evidence: winner.proposal.evidence,
        alternatives: scored.slice(1, 4).map(s => ({
          topic: s.proposal.topic,
          source: s.proposal.source,
          score: s.score,
        })),
      },
    });
  }
  return {
    winner: winner.proposal,
    score: winner.score,
    alternatives: scored.slice(1).map(s => ({ topic: s.proposal.topic, source: s.proposal.source, score: s.score })),
  };
}

/**
 * Introspection: what's in the queue right now (after pruning stale).
 */
export function getProposalQueue() {
  const state = loadState();
  _ensureProposalQueueField(state);
  const now = Date.now();
  return state.proposalQueue
    .filter(p => (now - new Date(p.proposedAt).getTime()) < PROPOSAL_MAX_AGE_MS)
    .map(p => ({ ...p, currentScore: _scoreProposal(p, now) }));
}

/**
 * Test helper: clear the proposal queue.
 */
export function _clearProposalQueue() {
  const state = loadState();
  state.proposalQueue = [];
  saveState(state);
}
