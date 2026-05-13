/**
 * CORTEX FLOW STATE — When the brain goes deep
 *
 * Flow is not just "focus". Focus is choosing WHAT to think about.
 * Flow is the brain entering a HIGHER GEAR of processing.
 *
 * In normal mode: one LLM call per cycle. Shallow. Quick. Adequate.
 * In flow: multiple calls, deeper reasoning, cross-referencing,
 * following chains of thought until they're exhausted.
 *
 * Flow is triggered when THREE signals converge:
 * 1. High excitement or curiosity (emotional engagement)
 * 2. Recent surprise (something unexpected happened)
 * 3. Revenue relevance (topic matters for $0 → $first)
 *
 * Any one of these = interesting.
 * Two of three = worth deeper thinking.
 * All three = FLOW. Brain enters high-performance mode.
 *
 * In flow, the brain:
 * - Gets more thinking time (higher max_tokens)
 * - Uses lower temperature (more precise, less random)
 * - Can make additional research calls
 * - Doesn't end the cycle at the normal boundary
 * - Produces the brain's BEST work
 *
 * Flow is EXPENSIVE (more LLM calls). But flow produces the
 * insights that change everything. It's the 10% of effort
 * that produces 90% of value.
 *
 * Guard: flow can only trigger once per 3 hours to prevent burnout.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const FLOW_PATH = resolve(ROOT, ".data/cortex-flow.json");
const EMOTION_PATH = resolve(ROOT, ".data/cortex-emotions.json");
const SURPRISE_PATH = resolve(ROOT, ".data/cortex-surprise.json");

// ── FLOW CONFIGURATION ──────────────────────────────────────────────────

const CONFIG = {
  // Trigger thresholds (all must be met for flow)
  emotionThreshold: 0.4,      // excitement or curiosity must be above this
  surpriseRecency: 30,        // surprise must be within last N minutes
  revenueKeywords: /revenue|client|deal|sale|payment|demo|reply|inbound|booking|money|prospect|close/i,

  // Flow parameters
  maxTokensNormal: 2000,
  maxTokensFlow: 4000,
  temperatureNormal: 0.3,
  temperatureFlow: 0.15,      // Lower = more precise, focused

  // Guards
  cooldownHours: 3,           // Minimum hours between flow states
  maxDurationCycles: 5,       // Flow auto-exits after this many cycles
  maxFlowsPerDay: 4,          // Hard cap on flows per day
};

// ── STATE ────────────────────────────────────────────────────────────────

function loadState() {
  if (!existsSync(FLOW_PATH)) {
    return {
      active: false,
      trigger: null,           // What triggered flow
      startedAt: null,
      cyclesInFlow: 0,
      discoveries: [],         // What was found during flow
      history: [],             // Past flow sessions
      stats: {
        totalFlows: 0,
        totalDiscoveries: 0,
        avgDuration: 0,
        flowsToday: 0,
        lastFlowDate: null,
      },
    };
  }
  try { return JSON.parse(readFileSync(FLOW_PATH, "utf-8")); }
  catch { return loadState(); }
}

function saveState(state) {
  if (state.history.length > 30) state.history = state.history.slice(-30);
  writeFileSync(FLOW_PATH, JSON.stringify(state, null, 2));
}

// ── DETECT FLOW CONDITIONS ──────────────────────────────────────────────

/**
 * Check if conditions are right for flow state.
 * Returns { shouldFlow, signals, score }
 * Called every cycle. No LLM.
 */
export function detectFlowConditions(brainThinking = "", cycleSurprises = []) {
  const state = loadState();

  // Guard: already in flow
  if (state.active) {
    return { shouldFlow: false, reason: "Already in flow", inFlow: true };
  }

  // Guard: cooldown
  if (state.history.length > 0) {
    const lastFlow = state.history[state.history.length - 1];
    const hoursSince = (Date.now() - new Date(lastFlow.endedAt || lastFlow.startedAt).getTime()) / 3_600_000;
    if (hoursSince < CONFIG.cooldownHours) {
      return { shouldFlow: false, reason: `Cooldown: ${(CONFIG.cooldownHours - hoursSince).toFixed(1)}h remaining` };
    }
  }

  // Guard: daily cap
  const today = new Date().toISOString().slice(0, 10);
  if (state.stats.lastFlowDate === today && state.stats.flowsToday >= CONFIG.maxFlowsPerDay) {
    return { shouldFlow: false, reason: `Daily cap reached (${CONFIG.maxFlowsPerDay})` };
  }

  // Check signals
  const signals = [];
  let score = 0;

  // 1. Emotional engagement
  const emotions = loadEmotions();
  const excitement = emotions.excitement || 0;
  const curiosity = emotions.curiosity || 0;
  const hope = emotions.hope || 0;
  const emotionSignal = Math.max(excitement, curiosity, hope);

  if (emotionSignal >= CONFIG.emotionThreshold) {
    const dominantEmotion = excitement >= curiosity && excitement >= hope ? "excitement"
      : curiosity >= hope ? "curiosity" : "hope";
    signals.push({ type: "emotion", emotion: dominantEmotion, level: emotionSignal });
    score += emotionSignal;
  }

  // 2. Recent surprise
  const recentSurprises = loadRecentSurprises(CONFIG.surpriseRecency);
  if (recentSurprises.length > 0) {
    const topSurprise = recentSurprises[0];
    signals.push({ type: "surprise", eventType: topSurprise.eventType, magnitude: topSurprise.magnitude });
    score += Math.min(1, topSurprise.magnitude * 0.3);
  }

  // Also check cycle surprises passed directly
  if (cycleSurprises.length > 0) {
    signals.push({ type: "cycle_surprise", count: cycleSurprises.length });
    score += 0.3;
  }

  // 3. Revenue relevance
  const thinkingText = brainThinking.toLowerCase();
  if (CONFIG.revenueKeywords.test(thinkingText)) {
    signals.push({ type: "revenue_relevant" });
    score += 0.4;
  }

  // Flow triggers when score >= 1.2 (roughly 2+ strong signals)
  const shouldFlow = score >= 1.2 && signals.length >= 2;

  return {
    shouldFlow,
    score: Math.round(score * 100) / 100,
    signals,
    reason: shouldFlow
      ? `Flow conditions met (score ${score.toFixed(2)}): ${signals.map(s => s.type).join(" + ")}`
      : `Below threshold (score ${score.toFixed(2)}, need 1.2)`,
  };
}

// ── ENTER FLOW ──────────────────────────────────────────────────────────

export function enterFlow(trigger, signals) {
  const state = loadState();

  const today = new Date().toISOString().slice(0, 10);
  if (state.stats.lastFlowDate !== today) {
    state.stats.flowsToday = 0;
    state.stats.lastFlowDate = today;
  }

  state.active = true;
  state.trigger = trigger;
  state.startedAt = new Date().toISOString();
  state.cyclesInFlow = 0;
  state.discoveries = [];
  state.stats.totalFlows++;
  state.stats.flowsToday++;

  saveState(state);

  return {
    entered: true,
    trigger,
    params: getFlowParams(),
  };
}

// ── TICK FLOW (called every cycle while in flow) ────────────────────────

export function tickFlow() {
  const state = loadState();
  if (!state.active) return { inFlow: false };

  state.cyclesInFlow++;

  // Auto-exit after max duration
  if (state.cyclesInFlow >= CONFIG.maxDurationCycles) {
    return exitFlow("max_duration_reached");
  }

  saveState(state);

  return {
    inFlow: true,
    cycle: state.cyclesInFlow,
    remaining: CONFIG.maxDurationCycles - state.cyclesInFlow,
    params: getFlowParams(),
  };
}

// ── EXIT FLOW ───────────────────────────────────────────────────────────

export function exitFlow(reason = "natural") {
  const state = loadState();
  if (!state.active) return { exited: false, reason: "Not in flow" };

  const session = {
    trigger: state.trigger,
    startedAt: state.startedAt,
    endedAt: new Date().toISOString(),
    cycles: state.cyclesInFlow,
    discoveries: state.discoveries,
    reason,
  };

  state.history.push(session);

  // Update avg duration
  const total = state.stats.totalFlows || 1;
  state.stats.avgDuration = (
    (state.stats.avgDuration * (total - 1) + state.cyclesInFlow) / total
  );
  state.stats.totalDiscoveries += state.discoveries.length;

  state.active = false;
  state.trigger = null;
  state.startedAt = null;
  state.cyclesInFlow = 0;
  state.discoveries = [];

  saveState(state);

  return {
    exited: true,
    reason,
    session,
  };
}

// ── RECORD DISCOVERY (during flow) ──────────────────────────────────────

export function recordDiscovery(discovery) {
  const state = loadState();
  if (!state.active) return;

  state.discoveries.push({
    text: discovery.slice(0, 300),
    at: new Date().toISOString(),
    cycle: state.cyclesInFlow,
  });

  saveState(state);
}

// ── GET FLOW PARAMETERS ─────────────────────────────────────────────────

/**
 * Returns LLM parameters to use. Different in flow vs normal.
 */
export function getFlowParams() {
  const state = loadState();

  if (state.active) {
    return {
      inFlow: true,
      maxTokens: CONFIG.maxTokensFlow,
      temperature: CONFIG.temperatureFlow,
      allowDeepResearch: true,
      allowMultipleActions: true,
      cyclesRemaining: CONFIG.maxDurationCycles - state.cyclesInFlow,
    };
  }

  return {
    inFlow: false,
    maxTokens: CONFIG.maxTokensNormal,
    temperature: CONFIG.temperatureNormal,
    allowDeepResearch: false,
    allowMultipleActions: false,
  };
}

// ── FORMAT FOR BRAIN CONTEXT ────────────────────────────────────────────

export function formatFlowForBrain() {
  const state = loadState();

  if (state.active) {
    const discoveries = state.discoveries.slice(-3);
    return `FLOW STATE: ACTIVE (cycle ${state.cyclesInFlow}/${CONFIG.maxDurationCycles})
Trigger: ${state.trigger || "unknown"}
You are in FLOW. This is your highest-performance mode:
- Think DEEPER. Follow chains of reasoning to their conclusion.
- Make connections between ideas. Don't stop at the obvious.
- Use additional research if needed.
- Quality over speed. This is where breakthroughs happen.
${discoveries.length > 0 ? `Discoveries so far:\n${discoveries.map(d => `  - ${d.text.slice(0, 100)}`).join("\n")}` : "No discoveries yet. Go deeper."}
${state.cyclesInFlow >= CONFIG.maxDurationCycles - 1 ? "LAST CYCLE IN FLOW. Synthesize everything." : ""}`;
  }

  if (state.stats.totalFlows === 0) {
    return "FLOW STATE: Never triggered. Flow activates when excitement/curiosity + surprise + revenue relevance converge.";
  }

  const lastFlow = state.history[state.history.length - 1];
  const hoursSince = lastFlow
    ? Math.round((Date.now() - new Date(lastFlow.endedAt).getTime()) / 3_600_000)
    : 999;

  return `FLOW STATE: Dormant. ${state.stats.totalFlows} total flows, ${state.stats.totalDiscoveries} discoveries. Last: ${hoursSince}h ago. Avg duration: ${state.stats.avgDuration.toFixed(1)} cycles.`;
}

// ── HELPERS ──────────────────────────────────────────────────────────────

function loadEmotions() {
  if (!existsSync(EMOTION_PATH)) return {};
  try {
    const data = JSON.parse(readFileSync(EMOTION_PATH, "utf-8"));
    return data.current || {};
  } catch { return {}; }
}

function loadRecentSurprises(minutesAgo) {
  if (!existsSync(SURPRISE_PATH)) return [];
  try {
    const data = JSON.parse(readFileSync(SURPRISE_PATH, "utf-8"));
    const cutoff = Date.now() - minutesAgo * 60_000;
    return (data.surprises || [])
      .filter(s => new Date(s.at).getTime() > cutoff)
      .sort((a, b) => b.magnitude - a.magnitude);
  } catch { return []; }
}

// ── STANDALONE TEST ─────────────────────────────────────────────────────

if (process.argv[1] && process.argv[1].includes("flow.mjs")) {
  console.log("=== FLOW STATE TEST ===\n");

  // Test detection with no conditions
  console.log("1. No flow conditions:");
  const r1 = detectFlowConditions("checking bot health", []);
  console.log(`   Should flow: ${r1.shouldFlow} | Score: ${r1.score} | ${r1.reason}`);

  // Test detection with revenue-relevant thinking + surprise
  console.log("\n2. Revenue topic + surprise:");
  const r2 = detectFlowConditions(
    "A prospect just replied to our HVAC outreach. This could be our first client payment!",
    [{ eventType: "email_reply", direction: "positive", magnitude: 3 }]
  );
  console.log(`   Should flow: ${r2.shouldFlow} | Score: ${r2.score}`);
  console.log(`   Signals: ${r2.signals.map(s => s.type).join(", ")}`);

  // Simulate entering flow
  if (r2.shouldFlow || true) { // Force for test
    console.log("\n3. Entering flow...");
    const entry = enterFlow("HVAC prospect replied", r2.signals);
    console.log(`   Entered: ${entry.entered}`);
    console.log(`   Params:`, entry.params);

    // Tick a few cycles
    console.log("\n4. Flow cycle 1:");
    const t1 = tickFlow();
    console.log(`   In flow: ${t1.inFlow} | Cycle: ${t1.cycle} | Remaining: ${t1.remaining}`);

    recordDiscovery("The prospect's company has 12 locations, each missing ~30 calls/week");
    recordDiscovery("Their current manual process costs 20 hours/week - our automation saves 80% of that time");

    console.log("\n5. Flow cycle 2:");
    const t2 = tickFlow();
    console.log(`   In flow: ${t2.inFlow} | Cycle: ${t2.cycle}`);

    // Exit
    console.log("\n6. Exiting flow:");
    const exit = exitFlow("test complete");
    console.log(`   Duration: ${exit.session.cycles} cycles`);
    console.log(`   Discoveries: ${exit.session.discoveries.length}`);
    exit.session.discoveries.forEach(d => console.log(`     - ${d.text.slice(0, 80)}`));
  }

  console.log("\n7. Brain context:");
  console.log(formatFlowForBrain());
}
