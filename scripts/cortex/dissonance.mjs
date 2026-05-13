/**
 * CORTEX COGNITIVE DISSONANCE — The tension that forces truth
 *
 * When a human holds two contradictory beliefs simultaneously,
 * they feel UNCOMFORTABLE. Not intellectually. Physically.
 * That discomfort is a FORCING FUNCTION — it drives resolution.
 *
 * "I believe cold email is dead" + "I just sent 50 cold emails"
 * = DISSONANCE. You can't hold both. Something has to give.
 *
 * Resolution options:
 * 1. CHANGE BELIEF — "cold email isn't dead, I was wrong"
 * 2. CHANGE BEHAVIOR — "stop sending cold email, it contradicts what I know"
 * 3. RATIONALIZE — "this is different because..." (weakest, but sometimes valid)
 *
 * Without dissonance:
 *   Brain holds "dental is dead hypothesis" AND runs dental outreach
 *   Brain believes "Reddit comments work" AND never writes Reddit comments
 *   Brain says "revenue is #1 priority" AND spends cycles on system upgrades
 *   = comfortable contradictions that never get resolved
 *
 * With dissonance:
 *   Each contradiction creates PRESSURE (emotional signal)
 *   Pressure accumulates until brain is FORCED to resolve
 *   Resolution = one of the beliefs changes confidence, or behavior changes
 *   = consistent, honest system that doesn't lie to itself
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DISSONANCE_PATH = resolve(ROOT, ".data/cortex-dissonance.json");

// ── CONTRADICTION PATTERNS ──────────────────────────────────────────────
// Known patterns of beliefs that contradict each other.
// These are semantic opposites — if both are held with high confidence, that's dissonance.

const CONTRADICTION_PAIRS = [
  { a: "dead",     b: "works",     domain: "channel",   desc: "Channel declared dead but also believed to work" },
  { a: "dead",     b: "promising", domain: "channel",   desc: "Channel declared dead but also called promising" },
  { a: "commodity", b: "differentiator", domain: "product", desc: "Product is both commodity and differentiator" },
  { a: "priority",  b: "skip",     domain: "action",    desc: "Declared priority but consistently skipped" },
  { a: "proven",    b: "untested", domain: "strategy",  desc: "Claimed proven but also marked untested" },
  { a: "best",      b: "worst",    domain: "ranking",   desc: "Ranked both best and worst" },
  { a: "growing",   b: "shrinking", domain: "market",   desc: "Market both growing and shrinking" },
  { a: "cheap",     b: "expensive", domain: "pricing",  desc: "Priced as both cheap and expensive" },
];

// Belief-behavior contradictions (what we say vs what we do)
const BEHAVIOR_CONTRADICTIONS = [
  {
    belief: /revenue.*priority|priority.*revenue|money.*first|first.*money/i,
    behavior: /system.*upgrade|refactor|infrastructure|build.*module/i,
    desc: "Says revenue is priority, but spending time on infrastructure",
  },
  {
    belief: /comment.*first|help.*first|engage.*first/i,
    behavior: /cold.*dm|direct.*message|mass.*outreach/i,
    desc: "Believes in comment-first approach, but sending cold DMs",
  },
  {
    belief: /specific.*pain|targeted|personali/i,
    behavior: /generic|template|mass|bulk/i,
    desc: "Believes in specificity, but using generic messaging",
  },
  {
    belief: /manual.*better|manual.*beats|manual.*first/i,
    behavior: /automat|pipeline|batch|daemon/i,
    desc: "Believes manual > automation at $0, but building automation",
  },
  {
    belief: /evidence.*over|data.*driven|evidence.*based/i,
    behavior: /assume|guess|predict.*without|no.*data/i,
    desc: "Claims evidence-based, but making assumptions without data",
  },
];

// ── STATE ────────────────────────────────────────────────────────────────

function loadState() {
  if (!existsSync(DISSONANCE_PATH)) {
    return {
      activeDissonances: [],  // Currently unresolved contradictions
      resolved: [],           // Past dissonances and how they were resolved
      pressure: 0,            // Accumulated dissonance pressure (0-1)
      stats: {
        totalDetected: 0,
        totalResolved: 0,
        avgResolutionCycles: 0,
        byType: { belief_belief: 0, belief_behavior: 0 },
      },
      lastScan: null,
    };
  }
  try { return JSON.parse(readFileSync(DISSONANCE_PATH, "utf-8")); }
  catch { return loadState(); }
}

function saveState(state) {
  // Keep resolved list manageable
  if (state.resolved.length > 50) state.resolved = state.resolved.slice(-50);
  writeFileSync(DISSONANCE_PATH, JSON.stringify(state, null, 2));
}

// ── SCAN FOR BELIEF-BELIEF CONTRADICTIONS ───────────────────────────────

/**
 * Scan the world model for contradictory beliefs.
 * No LLM — pure pattern matching against known contradiction pairs.
 *
 * @param {object} db - database
 * @returns {array} list of detected contradictions
 */
export function scanBeliefConflicts(db) {
  let beliefs;
  try {
    beliefs = db.prepare(
      "SELECT * FROM wm_beliefs WHERE confidence >= 0.3 ORDER BY confidence DESC LIMIT 100"
    ).all().map(b => ({
      ...b,
      evidence: JSON.parse(b.evidence || "[]"),
      contradictions: JSON.parse(b.contradictions || "[]"),
    }));
  } catch { return []; }

  if (beliefs.length < 2) return [];

  const conflicts = [];

  // Check every pair of beliefs for semantic contradiction
  for (let i = 0; i < beliefs.length; i++) {
    for (let j = i + 1; j < beliefs.length; j++) {
      const a = beliefs[i];
      const b = beliefs[j];
      const aLower = a.belief.toLowerCase();
      const bLower = b.belief.toLowerCase();

      // Check against known contradiction patterns
      for (const pattern of CONTRADICTION_PAIRS) {
        const aHasFirst = aLower.includes(pattern.a);
        const bHasSecond = bLower.includes(pattern.b);
        const aHasSecond = aLower.includes(pattern.b);
        const bHasFirst = bLower.includes(pattern.a);

        // Check if they share a subject (same domain or overlapping words)
        const aWords = new Set(aLower.split(/\s+/).filter(w => w.length > 4));
        const bWords = new Set(bLower.split(/\s+/).filter(w => w.length > 4));
        const sharedWords = [...aWords].filter(w => bWords.has(w));
        const shareSubject = sharedWords.length >= 1 || a.domain === b.domain;

        if ((aHasFirst && bHasSecond || aHasSecond && bHasFirst) && shareSubject) {
          const tension = (a.confidence + b.confidence) / 2; // Higher confidence = more tension
          conflicts.push({
            type: "belief_belief",
            beliefA: { id: a.id, text: a.belief, confidence: a.confidence, domain: a.domain },
            beliefB: { id: b.id, text: b.belief, confidence: b.confidence, domain: b.domain },
            pattern: pattern.desc,
            sharedSubject: sharedWords.join(", "),
            tension: Math.round(tension * 100) / 100,
            detectedAt: new Date().toISOString(),
          });
        }
      }

      // Also check for explicit contradictions already recorded
      if (a.contradictions.length > 0) {
        for (const c of a.contradictions) {
          if (bLower.includes(c.text?.toLowerCase()?.slice(0, 20) || "___")) {
            conflicts.push({
              type: "belief_belief",
              beliefA: { id: a.id, text: a.belief, confidence: a.confidence, domain: a.domain },
              beliefB: { id: b.id, text: b.belief, confidence: b.confidence, domain: b.domain },
              pattern: "Explicit contradiction recorded in world model",
              tension: (a.confidence + b.confidence) / 2,
              detectedAt: new Date().toISOString(),
            });
          }
        }
      }
    }
  }

  return conflicts;
}

// ── SCAN FOR BELIEF-BEHAVIOR CONTRADICTIONS ─────────────────────────────

/**
 * Check if recent actions contradict stated beliefs.
 * This is the deeper form of dissonance — hypocrisy detection.
 */
export function scanBehaviorConflicts(db) {
  let beliefs, recentActions;
  try {
    beliefs = db.prepare(
      "SELECT belief FROM wm_beliefs WHERE confidence >= 0.5 ORDER BY confidence DESC LIMIT 50"
    ).all();
    recentActions = db.prepare(
      "SELECT thinking, actions FROM cortex_decisions ORDER BY decided_at DESC LIMIT 10"
    ).all();
  } catch { return []; }

  const beliefText = beliefs.map(b => b.belief).join(" ").toLowerCase();
  const actionText = recentActions.map(a => `${a.thinking || ""} ${a.actions || ""}`).join(" ").toLowerCase();

  const conflicts = [];

  for (const pattern of BEHAVIOR_CONTRADICTIONS) {
    const beliefMatch = pattern.belief.test(beliefText);
    const behaviorMatch = pattern.behavior.test(actionText);

    if (beliefMatch && behaviorMatch) {
      conflicts.push({
        type: "belief_behavior",
        pattern: pattern.desc,
        beliefEvidence: beliefText.match(pattern.belief)?.[0]?.slice(0, 60) || "",
        behaviorEvidence: actionText.match(pattern.behavior)?.[0]?.slice(0, 60) || "",
        tension: 0.6, // Behavior contradictions are always significant
        detectedAt: new Date().toISOString(),
      });
    }
  }

  return conflicts;
}

// ── FULL SCAN ───────────────────────────────────────────────────────────

/**
 * Run complete dissonance scan. Called periodically (e.g., every 12 cycles).
 * Returns all active dissonances and updates pressure.
 */
export function scan(db) {
  const state = loadState();

  const beliefConflicts = scanBeliefConflicts(db);
  const behaviorConflicts = scanBehaviorConflicts(db);
  const allConflicts = [...beliefConflicts, ...behaviorConflicts];

  // Deduplicate against already-tracked dissonances
  const existingPatterns = new Set(state.activeDissonances.map(d => d.pattern));
  const newConflicts = allConflicts.filter(c => !existingPatterns.has(c.pattern));

  // Add new ones
  for (const conflict of newConflicts) {
    conflict.cyclesUnresolved = 0;
    state.activeDissonances.push(conflict);
    state.stats.totalDetected++;
    state.stats.byType[conflict.type] = (state.stats.byType[conflict.type] || 0) + 1;
  }

  // Increment unresolved counter for existing ones
  for (const d of state.activeDissonances) {
    d.cyclesUnresolved = (d.cyclesUnresolved || 0) + 1;
  }

  // Calculate pressure: more dissonances + longer unresolved = more pressure
  const pressureFromCount = Math.min(0.5, state.activeDissonances.length * 0.1);
  const pressureFromAge = state.activeDissonances.reduce((sum, d) =>
    sum + Math.min(0.1, (d.cyclesUnresolved || 0) * 0.01), 0);
  state.pressure = Math.min(1, pressureFromCount + pressureFromAge);

  state.lastScan = new Date().toISOString();
  saveState(state);

  return {
    newConflicts: newConflicts.length,
    totalActive: state.activeDissonances.length,
    pressure: state.pressure,
    conflicts: state.activeDissonances,
    urgent: state.activeDissonances.filter(d => d.tension > 0.6 || (d.cyclesUnresolved || 0) > 6),
  };
}

// ── RESOLVE DISSONANCE ──────────────────────────────────────────────────

/**
 * Resolve a dissonance. Called when brain makes a choice.
 *
 * @param {number} index - index in activeDissonances array
 * @param {string} resolution - "change_belief_a" | "change_belief_b" | "change_behavior" | "rationalize"
 * @param {string} reasoning - why this resolution
 * @param {object} [db] - if resolving belief, can update world model
 */
export function resolveConflict(index, resolution, reasoning, db = null) {
  const state = loadState();
  if (index < 0 || index >= state.activeDissonances.length) return null;

  const dissonance = state.activeDissonances[index];
  const resolved = {
    ...dissonance,
    resolution,
    reasoning,
    resolvedAt: new Date().toISOString(),
  };

  // If resolving by changing a belief and we have DB, update confidence
  if (db && resolution === "change_belief_a" && dissonance.beliefA?.id) {
    try {
      db.prepare("UPDATE wm_beliefs SET confidence = MAX(0.1, confidence - 0.3), updated_at = datetime('now') WHERE id = ?")
        .run(dissonance.beliefA.id);
    } catch {}
  }
  if (db && resolution === "change_belief_b" && dissonance.beliefB?.id) {
    try {
      db.prepare("UPDATE wm_beliefs SET confidence = MAX(0.1, confidence - 0.3), updated_at = datetime('now') WHERE id = ?")
        .run(dissonance.beliefB.id);
    } catch {}
  }

  // Move from active to resolved
  state.activeDissonances.splice(index, 1);
  state.resolved.push(resolved);
  state.stats.totalResolved++;

  // Update average resolution time
  const totalResolved = state.stats.totalResolved;
  state.stats.avgResolutionCycles = (
    (state.stats.avgResolutionCycles * (totalResolved - 1) + (dissonance.cyclesUnresolved || 0))
    / totalResolved
  );

  // Recalculate pressure
  const pressureFromCount = Math.min(0.5, state.activeDissonances.length * 0.1);
  state.pressure = Math.max(0, pressureFromCount);

  saveState(state);
  return resolved;
}

// ── GET MOST URGENT ─────────────────────────────────────────────────────

/**
 * Get the single most urgent dissonance that needs resolution.
 * Used by the brain to decide what to address.
 */
export function getMostUrgent() {
  const state = loadState();
  if (state.activeDissonances.length === 0) return null;

  // Score by tension * age
  return state.activeDissonances
    .map((d, i) => ({
      ...d,
      index: i,
      urgency: (d.tension || 0.5) * Math.log2(2 + (d.cyclesUnresolved || 0)),
    }))
    .sort((a, b) => b.urgency - a.urgency)[0];
}

// ── FORMAT FOR BRAIN CONTEXT ────────────────────────────────────────────

export function formatDissonanceForBrain() {
  const state = loadState();

  if (state.activeDissonances.length === 0 && state.stats.totalDetected === 0) {
    return "COGNITIVE DISSONANCE: No contradictions detected. System beliefs are consistent (or untested).";
  }

  if (state.activeDissonances.length === 0) {
    return `COGNITIVE DISSONANCE: Clear. ${state.stats.totalResolved} contradictions resolved in the past. No active conflicts.`;
  }

  const lines = state.activeDissonances.slice(0, 5).map((d, i) => {
    const age = d.cyclesUnresolved || 0;
    const urgency = age > 6 ? "URGENT" : age > 3 ? "growing" : "new";
    if (d.type === "belief_belief") {
      return `  ${i + 1}. [${urgency}] "${d.beliefA?.text?.slice(0, 50)}" vs "${d.beliefB?.text?.slice(0, 50)}" (tension: ${d.tension})`;
    }
    return `  ${i + 1}. [${urgency}] ${d.pattern} (tension: ${d.tension})`;
  });

  return `COGNITIVE DISSONANCE (pressure: ${(state.pressure * 100).toFixed(0)}%, ${state.activeDissonances.length} active):
${lines.join("\n")}
You CANNOT hold contradictory beliefs. Resolve them:
- change_belief_a: first belief is wrong, lower its confidence
- change_belief_b: second belief is wrong, lower its confidence
- change_behavior: beliefs are right, stop the contradictory action
- rationalize: both are true in different contexts (explain why)
Use action: {"action": "resolve_dissonance", "index": 0, "resolution": "change_belief_a", "reasoning": "why"}`;
}

// ── STANDALONE TEST ─────────────────────────────────────────────────────

if (process.argv[1] && process.argv[1].includes("dissonance.mjs")) {
  // Test with mock beliefs
  console.log("=== COGNITIVE DISSONANCE TEST ===\n");

  console.log("Testing belief-behavior contradiction patterns...");
  const testBeliefs = "revenue is the top priority. evidence over vibes.";
  const testActions = "building new infrastructure module. assuming dental market is viable without data.";

  for (const pattern of BEHAVIOR_CONTRADICTIONS) {
    const bMatch = pattern.belief.test(testBeliefs);
    const aMatch = pattern.behavior.test(testActions);
    if (bMatch && aMatch) {
      console.log(`  CONFLICT: ${pattern.desc}`);
    }
  }

  console.log("\nPressure and format:");
  const state = loadState();
  // Inject a test dissonance
  state.activeDissonances.push({
    type: "belief_behavior",
    pattern: "Says revenue is priority, but spending time on infrastructure",
    tension: 0.7,
    cyclesUnresolved: 4,
    detectedAt: new Date().toISOString(),
  });
  state.activeDissonances.push({
    type: "belief_belief",
    beliefA: { id: 1, text: "Reddit comments are the best channel", confidence: 0.8 },
    beliefB: { id: 2, text: "Reddit engagement is dead for AI services", confidence: 0.4 },
    pattern: "Channel declared dead but also believed to work",
    tension: 0.6,
    cyclesUnresolved: 2,
    detectedAt: new Date().toISOString(),
  });
  state.stats.totalDetected = 2;
  state.pressure = 0.3;
  saveState(state);

  console.log(formatDissonanceForBrain());

  // Test resolution
  console.log("\nResolving first dissonance (change behavior)...");
  const resolved = resolveConflict(0, "change_behavior", "Revenue IS the priority. Stop building modules, start selling.");
  console.log(`  Resolved: ${resolved.resolution} — ${resolved.reasoning}`);

  console.log("\nAfter resolution:");
  console.log(formatDissonanceForBrain());

  // Test getMostUrgent
  console.log("\nMost urgent:");
  const urgent = getMostUrgent();
  console.log(`  ${urgent ? urgent.pattern : "None"}`);
}
