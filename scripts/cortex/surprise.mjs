/**
 * CORTEX SURPRISE DETECTION — The prediction error engine
 *
 * Human brain has the strongest learning mechanism in nature:
 * PREDICTION ERROR.
 *
 * Expected events get IGNORED. The brain literally filters them out.
 * You don't notice your heartbeat. You don't notice familiar street sounds.
 *
 * UNEXPECTED events get MAXIMUM ATTENTION.
 * A car horn. A message from someone who never messages.
 * A reply when you expected silence. Silence when you expected reply.
 *
 * This is the fastest learning signal in existence:
 * - Positive surprise (better than expected) → reinforce this path
 * - Negative surprise (worse than expected) → abandon or fix
 * - No surprise (as expected) → low learning value, move on
 *
 * Without surprise detection:
 *   Brain treats "0 replies from 50 emails" the same as "3 replies from 5 emails"
 *   = no learning gradient, no adaptation
 *
 * With surprise detection:
 *   "Expected 0 replies, got 3" → SURPRISE 10x → what did we do differently?
 *   "Expected 5 leads, got 5" → expected → minimal processing
 *   "Expected reply from hot lead, got silence" → negative surprise → why?
 *
 * Surprise = the derivative of learning. It tells the brain WHERE to invest attention.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const SURPRISE_PATH = resolve(ROOT, ".data/cortex-surprise.json");

// ── EXPECTATIONS — what the brain assumes will happen ────────────────────

/**
 * Default expectations (base rates from real experience).
 * These represent "what normally happens" for different event types.
 * Surprise = |actual - expected| / max(expected, 1)
 */
const EXPECTATIONS = {
  // Outreach
  cold_email_replies:    { expected: 0, unit: "replies",    source: "103 sent, 0 replies" },
  reddit_dm_replies:     { expected: 0, unit: "replies",    source: "77 sent, 0 replies" },
  reddit_comment_engage: { expected: 1, unit: "engagements", source: "proven channel, ~15% rate" },
  linkedin_replies:      { expected: 0, unit: "replies",    source: "limited data" },

  // Pipeline
  leads_per_scan:        { expected: 5, unit: "leads",      source: "typical scout output" },
  enrichment_rate:       { expected: 0.3, unit: "ratio",    source: "~30% classify as interesting" },

  // Revenue
  daily_revenue:         { expected: 0, unit: "CAD",        source: "revenue = $0 currently" },
  demo_bookings:         { expected: 0, unit: "bookings",   source: "0 demos booked to date" },
  inbound_messages:      { expected: 0, unit: "messages",   source: "rare inbound" },

  // System
  bot_errors_per_day:    { expected: 2, unit: "errors",     source: "average from healing data" },
  cycle_cost:            { expected: 0.02, unit: "USD",     source: "typical gpt-5.4-mini cost" },
};

// ── STATE ────────────────────────────────────────────────────────────────

function loadState() {
  if (!existsSync(SURPRISE_PATH)) {
    return {
      // Dynamic expectations (updated from experience)
      expectations: { ...EXPECTATIONS },
      // Recent surprises
      surprises: [],
      // Surprise stats
      stats: {
        totalDetected: 0,
        positiveCount: 0,
        negativeCount: 0,
        biggestPositive: null,
        biggestNegative: null,
        adaptationCount: 0,    // how many times expectations were updated
      },
      lastUpdated: null,
    };
  }
  try { return JSON.parse(readFileSync(SURPRISE_PATH, "utf-8")); }
  catch { return loadState(); }
}

function saveState(state) {
  state.lastUpdated = new Date().toISOString();
  // Keep surprises list manageable
  if (state.surprises.length > 100) state.surprises = state.surprises.slice(-100);
  writeFileSync(SURPRISE_PATH, JSON.stringify(state, null, 2));
}

// ── CORE: DETECT SURPRISE ───────────────────────────────────────────────

/**
 * Compare an actual outcome against expectation.
 * Returns surprise object with magnitude, direction, and learning signal.
 *
 * @param {string} eventType - key from EXPECTATIONS (or custom)
 * @param {number} actual - what actually happened
 * @param {string} context - what caused this (for logging)
 * @returns {{ surprised: boolean, magnitude: number, direction: string, expected: number, actual: number, learningSignal: string, attentionMultiplier: number }}
 */
export function detect(eventType, actual, context = "") {
  const state = loadState();

  // Get expectation (dynamic > default > 0)
  const expectation = state.expectations[eventType] || EXPECTATIONS[eventType] || { expected: 0, unit: "units" };
  const expected = expectation.expected;

  // Calculate prediction error
  const diff = actual - expected;
  const denominator = Math.max(Math.abs(expected), 1); // avoid division by zero
  const magnitude = Math.abs(diff) / denominator;

  // Determine direction
  let direction;
  if (diff > 0) direction = "positive"; // better than expected
  else if (diff < 0) direction = "negative"; // worse than expected
  else direction = "neutral"; // exactly as expected

  // Is this actually surprising?
  const surprised = magnitude > 0.3; // 30% deviation = surprise threshold

  // Calculate attention multiplier (1x = normal, up to 10x for huge surprises)
  const attentionMultiplier = surprised
    ? Math.min(10, 1 + magnitude * 3)
    : 1;

  // Generate learning signal
  let learningSignal;
  if (!surprised) {
    learningSignal = `As expected: ${eventType} = ${actual} (expected ${expected}). Low learning value.`;
  } else if (direction === "positive") {
    learningSignal = `POSITIVE SURPRISE: ${eventType} = ${actual} (expected ${expected}). What caused this? Investigate and replicate.`;
  } else {
    learningSignal = `NEGATIVE SURPRISE: ${eventType} = ${actual} (expected ${expected}). What went wrong? Investigate and prevent.`;
  }

  // Record
  const surprise = {
    eventType,
    actual,
    expected,
    diff,
    magnitude: Math.round(magnitude * 100) / 100,
    direction,
    surprised,
    attentionMultiplier: Math.round(attentionMultiplier * 10) / 10,
    learningSignal,
    context: context.slice(0, 200),
    at: new Date().toISOString(),
  };

  if (surprised) {
    state.surprises.push(surprise);
    state.stats.totalDetected++;
    if (direction === "positive") {
      state.stats.positiveCount++;
      if (!state.stats.biggestPositive || magnitude > state.stats.biggestPositive.magnitude) {
        state.stats.biggestPositive = { eventType, magnitude, actual, expected, at: surprise.at };
      }
    } else {
      state.stats.negativeCount++;
      if (!state.stats.biggestNegative || magnitude > state.stats.biggestNegative.magnitude) {
        state.stats.biggestNegative = { eventType, magnitude, actual, expected, at: surprise.at };
      }
    }
  }

  saveState(state);
  return surprise;
}

// ── BATCH DETECT (check multiple events at once) ────────────────────────

/**
 * Process a set of events and return only the surprising ones.
 * Used at the start of each cycle to quickly filter what matters.
 */
export function batchDetect(events) {
  const surprises = [];
  for (const event of events) {
    const result = detect(event.type, event.value, event.context || "");
    if (result.surprised) {
      surprises.push(result);
    }
  }
  // Sort by magnitude (biggest surprise first)
  return surprises.sort((a, b) => b.magnitude - a.magnitude);
}

// ── ADAPT EXPECTATIONS ──────────────────────────────────────────────────

/**
 * After observing real outcomes, update expectations.
 * This is how the brain's "normal" baseline shifts over time.
 *
 * Uses exponential moving average:
 *   new_expected = old_expected * (1 - alpha) + actual * alpha
 *
 * Alpha = 0.3 means recent observations have 30% weight.
 * Higher alpha = faster adaptation (more reactive).
 * Lower alpha = slower adaptation (more stable).
 */
export function adaptExpectation(eventType, actual, alpha = 0.3) {
  const state = loadState();

  if (!state.expectations[eventType]) {
    state.expectations[eventType] = { expected: actual, unit: "units", source: "first observation" };
  } else {
    const old = state.expectations[eventType].expected;
    state.expectations[eventType].expected = old * (1 - alpha) + actual * alpha;
    state.expectations[eventType].lastAdapted = new Date().toISOString();
    state.expectations[eventType].sampleCount = (state.expectations[eventType].sampleCount || 1) + 1;
  }

  state.stats.adaptationCount++;
  saveState(state);

  return state.expectations[eventType];
}

// ── SET EXPLICIT EXPECTATION ────────────────────────────────────────────

/**
 * Brain can explicitly set an expectation for something.
 * "I predict this outreach will get 2 replies" → if it gets 0 or 5, that's surprise.
 */
export function setExpectation(eventType, expected, basis = "") {
  const state = loadState();
  state.expectations[eventType] = {
    expected,
    unit: "units",
    source: basis || "brain prediction",
    setAt: new Date().toISOString(),
  };
  saveState(state);
  return state.expectations[eventType];
}

// ── GET RECENT SURPRISES ────────────────────────────────────────────────

export function getRecentSurprises(limit = 10) {
  const state = loadState();
  return state.surprises.slice(-limit);
}

// ── GET SURPRISE PATTERNS ───────────────────────────────────────────────

/**
 * Analyze recent surprises for patterns.
 * "Are we consistently surprised by the same thing?"
 * If yes → our model of that thing is wrong → update it.
 */
export function analyzePatterns() {
  const state = loadState();
  const recent = state.surprises.slice(-30);
  if (recent.length < 3) return { patterns: [], insight: "Not enough data" };

  // Count surprises by type
  const counts = {};
  for (const s of recent) {
    const key = `${s.eventType}:${s.direction}`;
    counts[key] = (counts[key] || 0) + 1;
  }

  const patterns = Object.entries(counts)
    .filter(([_, count]) => count >= 2)
    .map(([key, count]) => {
      const [type, direction] = key.split(":");
      return {
        eventType: type,
        direction,
        count,
        insight: direction === "positive"
          ? `We keep underestimating ${type}. Our model is too pessimistic. Update expectations upward.`
          : `We keep overestimating ${type}. Our model is too optimistic. Update expectations downward.`,
      };
    })
    .sort((a, b) => b.count - a.count);

  return {
    patterns,
    insight: patterns.length > 0
      ? `Found ${patterns.length} surprise patterns. Top: ${patterns[0].insight}`
      : "No repeating patterns. Surprises are diverse (good — means model is generally accurate).",
  };
}

// ── FORMAT FOR BRAIN CONTEXT ────────────────────────────────────────────

export function formatSurpriseForBrain() {
  const state = loadState();
  const recent = state.surprises.slice(-5);
  const patterns = analyzePatterns();

  if (recent.length === 0 && state.stats.totalDetected === 0) {
    return "SURPRISE DETECTION: Active. No surprises detected yet. System is building baseline expectations.";
  }

  const lines = recent.map(s => {
    const arrow = s.direction === "positive" ? "↑↑" : "↓↓";
    return `  ${arrow} ${s.eventType}: got ${s.actual} (expected ${s.expected}) — ${s.magnitude}x surprise, ${s.attentionMultiplier}x attention`;
  });

  const parts = [`SURPRISE DETECTION (${state.stats.totalDetected} total: ${state.stats.positiveCount}↑ ${state.stats.negativeCount}↓):`];
  if (lines.length > 0) {
    parts.push("Recent:");
    parts.push(...lines);
  }
  if (patterns.patterns.length > 0) {
    parts.push(`Pattern: ${patterns.patterns[0].insight}`);
  }
  if (state.stats.biggestPositive) {
    parts.push(`Biggest positive ever: ${state.stats.biggestPositive.eventType} (${state.stats.biggestPositive.magnitude}x)`);
  }

  parts.push("Surprises get heightened attention. Expected events get filtered. Learn from prediction errors.");

  return parts.join("\n");
}

// ── INTEGRATION: check cycle events for surprises ───────────────────────

/**
 * Called at the start of each brain cycle.
 * Takes perception events and system state, checks for surprises.
 * Returns list of surprises for the brain to attend to.
 */
export function checkCycleForSurprises(events, systemState) {
  const surprises = [];

  // Check event-based surprises
  for (const e of events) {
    if (e.type === "new_leads" && e.count !== undefined) {
      const s = detect("leads_per_scan", e.count, "perception: new leads detected");
      if (s.surprised) surprises.push(s);
    }
    if (e.type === "email_replies" && e.count !== undefined) {
      const s = detect("cold_email_replies", e.count, "perception: email replies");
      if (s.surprised) surprises.push(s);
    }
    if (e.type === "appointments" && e.count !== undefined) {
      const s = detect("demo_bookings", e.count, "perception: appointments");
      if (s.surprised) surprises.push(s);
    }
    if (e.type === "vapi_calls" && e.count !== undefined) {
      const s = detect("inbound_messages", e.count, "perception: vapi calls");
      if (s.surprised) surprises.push(s);
    }
    if (e.type === "bot_event") {
      // Bot events with unexpected success/failure
      if (e.event === "error" || e.event === "critical") {
        const s = detect("bot_errors_per_day", 1, `bot error: ${e.from || "unknown"}`);
        if (s.surprised) surprises.push(s);
      }
    }
  }

  // Check state-based surprises
  if (systemState.revenue > 0) {
    const s = detect("daily_revenue", systemState.revenue, "REVENUE DETECTED");
    if (s.surprised) surprises.push(s);
  }

  // Sort by magnitude
  return surprises.sort((a, b) => b.magnitude - a.magnitude);
}

// ── STANDALONE TEST ─────────────────────────────────────────────────────

if (process.argv[1] && process.argv[1].includes("surprise.mjs")) {
  console.log("=== SURPRISE DETECTION TEST ===\n");

  // Test 1: Expected outcome (no surprise)
  console.log("1. Expected: 0 email replies, got 0:");
  const r1 = detect("cold_email_replies", 0, "sent 20 cold emails");
  console.log(`   Surprised: ${r1.surprised} | Magnitude: ${r1.magnitude} | Attention: ${r1.attentionMultiplier}x`);
  console.log(`   Signal: ${r1.learningSignal}`);

  // Test 2: Positive surprise (got replies!)
  console.log("\n2. Expected: 0 email replies, got 3:");
  const r2 = detect("cold_email_replies", 3, "sent 10 specific HVAC emails");
  console.log(`   Surprised: ${r2.surprised} | Magnitude: ${r2.magnitude} | Direction: ${r2.direction}`);
  console.log(`   Attention: ${r2.attentionMultiplier}x`);
  console.log(`   Signal: ${r2.learningSignal}`);

  // Test 3: Revenue surprise
  console.log("\n3. Expected: $0 revenue, got $1500:");
  const r3 = detect("daily_revenue", 1500, "first client paid!");
  console.log(`   Surprised: ${r3.surprised} | Magnitude: ${r3.magnitude} | Direction: ${r3.direction}`);
  console.log(`   Attention: ${r3.attentionMultiplier}x`);
  console.log(`   Signal: ${r3.learningSignal}`);

  // Test 4: Negative surprise (expected leads, got 0)
  console.log("\n4. Expected: 5 leads, got 0:");
  const r4 = detect("leads_per_scan", 0, "scout returned empty");
  console.log(`   Surprised: ${r4.surprised} | Magnitude: ${r4.magnitude} | Direction: ${r4.direction}`);
  console.log(`   Signal: ${r4.learningSignal}`);

  // Test 5: Adapt expectations
  console.log("\n5. Adapting email reply expectation after getting 3:");
  const adapted = adaptExpectation("cold_email_replies", 3);
  console.log(`   New expectation: ${adapted.expected.toFixed(2)} (was 0)`);

  // Test 6: Now same result is LESS surprising
  console.log("\n6. Same event again (3 replies) after adaptation:");
  const r6 = detect("cold_email_replies", 3, "second batch");
  console.log(`   Surprised: ${r6.surprised} | Magnitude: ${r6.magnitude}`);
  console.log(`   (Less surprising because expectations adapted!)`);

  // Test 7: Pattern analysis
  console.log("\n7. Surprise patterns:");
  const patterns = analyzePatterns();
  console.log(`   ${patterns.insight}`);

  // Test 8: Format for brain
  console.log("\n8. Brain context:");
  console.log(formatSurpriseForBrain());
}
