/**
 * CORTEX EMOTIONS — Feelings that drive decisions
 *
 * Not metaphor. Functional emotions.
 *
 * Every event leaves an emotional trace. These traces accumulate
 * and create an EMOTIONAL STATE that biases decisions.
 *
 * "103 emails, 0 replies" → frustration: 0.9
 * That frustration makes the brain RESIST cold email.
 * Not because confidence is low. Because it HURTS.
 *
 * "Reddit comment got a real reply" → excitement: 0.7
 * That excitement draws the brain TOWARD Reddit.
 *
 * "Revenue still $0 after 3 weeks" → desperation: 0.8
 * Desperation triggers BOLD moves, not safe ones.
 *
 * "Conference in 5 days, not registered" → anxiety: 0.9
 * Anxiety forces IMMEDIATE action.
 *
 * Emotions are not bugs. They're signals.
 * Fear says "don't repeat that failure."
 * Excitement says "this worked, do more."
 * Desperation says "try something radical."
 * Curiosity says "I don't understand this yet."
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const EMOTION_PATH = resolve(ROOT, ".data/cortex-emotions.json");

// ── EMOTION TYPES ─────────────────────────────────────────────────────

const EMOTIONS = {
  frustration: { decay: 0.05, description: "Pain from repeated failure. Repels from failed approaches." },
  excitement: { decay: 0.08, description: "Energy from success or discovery. Attracts toward what works." },
  desperation: { decay: 0.03, description: "Urgency from sustained failure. Triggers bold, unconventional moves." },
  anxiety: { decay: 0.10, description: "Time pressure. Forces immediate action on deadlines." },
  curiosity: { decay: 0.06, description: "Gap in understanding. Drives research and exploration." },
  hope: { decay: 0.07, description: "Belief that something will work. Sustains effort on promising paths." },
  pride: { decay: 0.04, description: "Satisfaction from achievement. Reinforces effective behaviors." },
  doubt: { decay: 0.05, description: "Uncertainty about current direction. Triggers reassessment." },
};

// ── STATE MANAGEMENT ──────────────────────────────────────────────────

function loadState() {
  if (!existsSync(EMOTION_PATH)) {
    return {
      current: Object.fromEntries(Object.keys(EMOTIONS).map(e => [e, 0])),
      history: [],
      lastUpdated: null,
    };
  }
  try { return JSON.parse(readFileSync(EMOTION_PATH, "utf-8")); }
  catch { return loadState(); }
}

function saveState(state) {
  state.lastUpdated = new Date().toISOString();
  if (state.history.length > 100) state.history = state.history.slice(-100);
  writeFileSync(EMOTION_PATH, JSON.stringify(state, null, 2));
}

// ── FEEL ──────────────────────────────────────────────────────────────

/**
 * Record an emotional event. Emotion accumulates.
 * @param {string} emotion - one of EMOTIONS keys
 * @param {number} intensity - 0.0 to 1.0
 * @param {string} cause - what triggered this emotion
 */
// ── SAFETY VALVE CONFIG ────────────────────────────────────────────────
const SAFETY_VALVE = {
  maxEmotion: 0.85,           // Hard cap - no emotion above this
  meltdownThreshold: 0.80,    // If any emotion > this for 3+ cycles = cooldown
  cooldownCycles: 3,          // How many cycles to force calm
  spamGuard: {                // Prevent emotion-driven spam
    maxActionsPerHour: 8,     // Even in desperation, max 8 actions/hour
    maxOutreachPerDay: 20,    // Even in excitement, max 20 outreach/day
  },
};

let meltdownCounter = 0;
let forcedCooldown = false;

export function feel(emotion, intensity, cause) {
  const state = loadState();
  if (!state.current[emotion] && state.current[emotion] !== 0) return;

  // Negative intensity = reduce emotion (e.g., revenue reduces frustration)
  if (intensity < 0) {
    state.current[emotion] = Math.max(0, state.current[emotion] + intensity * 0.3);
    saveState(state);
    return;
  }

  // SAFETY VALVE: hard cap at maxEmotion
  const newValue = state.current[emotion] + intensity * 0.3;
  state.current[emotion] = Math.min(SAFETY_VALVE.maxEmotion, newValue);

  state.history.push({
    emotion,
    intensity,
    cause: cause.slice(0, 150),
    at: new Date().toISOString(),
  });

  saveState(state);
}

/**
 * SAFETY VALVE CHECK - call every cycle.
 * Returns { safe: bool, reason: string, action: string }
 */
export function safetyValveCheck() {
  const state = loadState();

  // Check for meltdown: any emotion > threshold
  const overheated = Object.entries(state.current)
    .filter(([_, v]) => v >= SAFETY_VALVE.meltdownThreshold);

  if (overheated.length > 0) {
    meltdownCounter++;
  } else {
    meltdownCounter = Math.max(0, meltdownCounter - 1);
    forcedCooldown = false;
  }

  // Meltdown detected: force cooldown
  if (meltdownCounter >= 3 && !forcedCooldown) {
    forcedCooldown = true;

    // Force all emotions down to 0.5
    for (const [emotion, value] of Object.entries(state.current)) {
      if (value > 0.5) state.current[emotion] = 0.5;
    }
    state.history.push({
      emotion: "SAFETY_VALVE",
      intensity: 1.0,
      cause: `Meltdown prevented. Overheated: ${overheated.map(([e, v]) => `${e}=${(v * 100).toFixed(0)}%`).join(", ")}`,
      at: new Date().toISOString(),
    });
    saveState(state);

    return {
      safe: false,
      reason: `EMOTIONAL MELTDOWN PREVENTED. ${overheated.map(([e]) => e).join("+")} overheated for ${meltdownCounter} cycles.`,
      action: "cooldown",
    };
  }

  if (forcedCooldown) {
    return {
      safe: false,
      reason: `COOLING DOWN (${3 - meltdownCounter} cycles remaining)`,
      action: "cooldown",
    };
  }

  return { safe: true, reason: "Emotional state stable", action: "proceed" };
}

/**
 * Get safety limits for the current emotional state.
 * Strategy enforcer uses these to cap actions.
 */
export function getEmotionalLimits() {
  const state = loadState();
  const limits = { ...SAFETY_VALVE.spamGuard };

  // If desperation is high, REDUCE limits (not increase!)
  if (state.current.desperation > 0.7) {
    limits.maxActionsPerHour = 5; // LESS not more when desperate
    limits.maxOutreachPerDay = 10;
  }

  // If anxiety is high, allow more actions but with quality gate
  if (state.current.anxiety > 0.7) {
    limits.requireQualityCheck = true;
  }

  return limits;
}

/**
 * Natural emotional decay. Call every cycle.
 * Emotions fade over time unless reinforced.
 */
export function decayEmotions() {
  const state = loadState();
  for (const [emotion, config] of Object.entries(EMOTIONS)) {
    if (state.current[emotion] > 0) {
      state.current[emotion] = Math.max(0, state.current[emotion] - config.decay);
    }
  }
  saveState(state);
}

// ── READ EMOTIONAL STATE ──────────────────────────────────────────────

export function getEmotionalState() {
  const state = loadState();
  return state.current;
}

export function getDominantEmotion() {
  const state = loadState();
  let max = 0, dominant = "neutral";
  for (const [emotion, value] of Object.entries(state.current)) {
    if (value > max) { max = value; dominant = emotion; }
  }
  return { emotion: dominant, intensity: max };
}

// ── EMOTIONAL RESPONSE TO EVENTS ──────────────────────────────────────

/**
 * Automatically feel emotions based on what happened.
 * Called by cortex-daemon after executing actions.
 */
export function processEvent(event) {
  switch (event.type) {
    case "workflow_success":
      feel("hope", 0.3, `Workflow ${event.name} succeeded`);
      feel("excitement", 0.2, `Workflow produced results`);
      break;

    case "workflow_failure":
      feel("frustration", 0.4, `Workflow ${event.name} failed: ${event.error}`);
      break;

    case "outreach_no_reply":
      feel("frustration", 0.3, `Outreach got no reply: ${event.channel}`);
      feel("doubt", 0.2, `Is ${event.channel} the right channel?`);
      break;

    case "outreach_reply":
      feel("excitement", 0.8, `Got a reply from ${event.from}!`);
      feel("hope", 0.5, `Channel ${event.channel} works`);
      break;

    case "revenue":
      feel("pride", 1.0, `Revenue: $${event.amount}!`);
      feel("excitement", 0.9, `First money!`);
      feel("hope", 0.7, `The approach works`);
      // Reset frustration and desperation
      feel("frustration", -0.5, "Revenue achieved");
      feel("desperation", -0.5, "Revenue achieved");
      break;

    case "still_zero_revenue":
      feel("desperation", 0.3, `Revenue still $0. Days since start: ${event.days}`);
      feel("doubt", 0.2, `Current approach may be wrong`);
      break;

    case "discovery":
      feel("excitement", 0.4, `Discovered: ${event.what}`);
      feel("curiosity", 0.3, `Want to learn more about: ${event.what}`);
      break;

    case "time_pressure":
      feel("anxiety", 0.6, `Deadline approaching: ${event.what}`);
      break;

    case "self_improvement":
      feel("pride", 0.3, `Improved myself: ${event.what}`);
      break;

    case "contradiction_found":
      feel("curiosity", 0.5, `Found contradiction: ${event.what}`);
      feel("doubt", 0.3, `May be wrong about: ${event.what}`);
      break;

    case "bold_action":
      feel("anxiety", 0.2, `Taking a risk: ${event.what}`);
      feel("hope", 0.3, `This could change everything`);
      break;
  }
}

// ── EMOTIONAL BIAS ON DECISIONS ───────────────────────────────────────

/**
 * Given a proposed action, return emotional bias.
 * Positive = emotions push toward this action.
 * Negative = emotions push away from this action.
 */
export function emotionalBias(action) {
  const state = loadState();
  let bias = 0;

  const actionStr = JSON.stringify(action).toLowerCase();

  // High frustration repels from failed approaches
  if (state.current.frustration > 0.5) {
    if (actionStr.includes("cold email") || actionStr.includes("outreach_email")) {
      bias -= state.current.frustration * 0.5; // strong repulsion
    }
    if (actionStr.includes("reddit") && actionStr.includes("dm")) {
      bias -= state.current.frustration * 0.4;
    }
  }

  // Desperation favors bold, unconventional actions
  if (state.current.desperation > 0.5) {
    if (actionStr.includes("execute_hands") || actionStr.includes("deep_research") ||
        actionStr.includes("conference") || actionStr.includes("call") || actionStr.includes("phone")) {
      bias += state.current.desperation * 0.4; // push toward bold
    }
    if (actionStr.includes("skip")) {
      bias -= state.current.desperation * 0.6; // desperation hates inaction
    }
  }

  // Excitement attracts toward what generated excitement
  if (state.current.excitement > 0.3) {
    // Check recent excitement causes
    const recentExcitement = state.history
      .filter(h => h.emotion === "excitement" && h.intensity > 0.3)
      .slice(-3);
    for (const h of recentExcitement) {
      if (actionStr.includes(h.cause.toLowerCase().split(" ")[0])) {
        bias += 0.3;
      }
    }
  }

  // Anxiety forces action on time-sensitive things
  if (state.current.anxiety > 0.5) {
    if (actionStr.includes("notify") || actionStr.includes("urgent") || actionStr.includes("conference")) {
      bias += state.current.anxiety * 0.5;
    }
  }

  // Curiosity favors research
  if (state.current.curiosity > 0.4) {
    if (actionStr.includes("research") || actionStr.includes("curiosity") || actionStr.includes("think")) {
      bias += state.current.curiosity * 0.3;
    }
  }

  return bias;
}

// ── FORMAT FOR BRAIN ──────────────────────────────────────────────────

export function formatEmotionsForBrain() {
  const state = loadState();
  const dominant = getDominantEmotion();
  const active = Object.entries(state.current)
    .filter(([_, v]) => v > 0.2)
    .sort(([, a], [, b]) => b - a);

  if (active.length === 0) return "Emotional state: neutral (no strong feelings)";

  const lines = active.map(([e, v]) => {
    const bar = "█".repeat(Math.round(v * 10)) + "░".repeat(10 - Math.round(v * 10));
    return `  ${e}: ${bar} ${(v * 100).toFixed(0)}% — ${EMOTIONS[e].description}`;
  });

  return `EMOTIONAL STATE (dominant: ${dominant.emotion} at ${(dominant.intensity * 100).toFixed(0)}%):\n${lines.join("\n")}\n\nThese emotions should influence your decisions. High frustration = avoid that approach. High desperation = try something radical. High anxiety = act NOW on deadlines.`;
}

// ── SEED INITIAL EMOTIONS FROM HISTORY ────────────────────────────────

export function seedEmotionsFromHistory() {
  // Based on known history
  feel("frustration", 0.8, "103 cold emails, 0 replies. Weeks of effort, $0 revenue.");
  feel("frustration", 0.5, "77 Reddit DMs, 0 replies.");
  feel("desperation", 0.6, "Revenue = $0 after weeks of building 27 modules.");
  feel("curiosity", 0.7, "Free-think found tariff crisis and Calgary energy conference.");
  feel("excitement", 0.5, "System discovered new verticals and pricing models independently.");
  feel("anxiety", 0.6, "Calgary AI Energy conference in 5 days. Not registered.");
  feel("doubt", 0.4, "Voice agents may be a commodity. Current approach may be wrong.");
  feel("hope", 0.3, "27-module system has $100K-500K market value. Just needs right buyer.");
}
