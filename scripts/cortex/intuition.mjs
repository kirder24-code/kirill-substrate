/**
 * CORTEX INTUITION — The gut feeling that decides in milliseconds
 *
 * Humans "just know" something is right before they can explain why.
 * It's not magic — it's ALL signals processed simultaneously into one feeling.
 *
 * Analysis says: "Send cold email to HVAC company. Expected value: 0.05."
 * Intuition says: "No. Gut score 0.2. Something is wrong."
 * Why? Because frustration from 103 failed emails + belief that cold email is dead
 * + recent memory of getting ignored + desperation level high (risky move)
 * = all compressed into a single number.
 *
 * Intuition is NOT randomness. It's COMPRESSED EXPERIENCE.
 *
 * Rules:
 * - gut < 0.3 → BLOCK even if analysis says OK
 * - gut > 0.8 → DO IT even if analysis is incomplete
 * - gut 0.3-0.8 → defer to analysis (normal thinking)
 *
 * No LLM call. Pure weighted computation. Must run in <5ms.
 * This is the fastest path in the brain.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const EMOTION_PATH = resolve(ROOT, ".data/cortex-emotions.json");
const IDENTITY_PATH = resolve(ROOT, ".data/cortex-identity.json");
const INTUITION_LOG_PATH = resolve(ROOT, ".data/cortex-intuition.json");

// ── LEARNED PATTERNS ────────────────────────────────────────────────────
// These are hardcoded from REAL experience. Not theory. Evidence.
// Updated when the brain learns new patterns.

const PAIN_PATTERNS = {
  // Actions that have PROVEN to fail
  "cold_email":       { weight: -0.5, reason: "103 sent, 0 replies. Dead channel." },
  "reddit_dm":        { weight: -0.5, reason: "77 sent, 0 replies. Violates platform norms." },
  "generic_pitch":    { weight: -0.4, reason: "Zero conversion on generic AI messaging." },
  "mass_outreach":    { weight: -0.3, reason: "Volume without specificity = spam." },
  "dental":           { weight: -0.3, reason: "Falsified hypothesis at 86% confidence." },

  // Actions that have PROVEN to work or show promise
  "reddit_comment":   { weight: 0.4, reason: "Real engagement, proven channel." },
  "specific_pain":    { weight: 0.3, reason: "Pain-specific messaging outperforms generic." },
  "demo":             { weight: 0.3, reason: "Highest conversion rate in base rates." },
  "research":         { weight: 0.2, reason: "Better understanding = better decisions." },
  "linkedin_comment": { weight: 0.2, reason: "Comment-first outreach endorsed by memory rules." },
  "manual_outreach":  { weight: 0.2, reason: "Manual beats fragile automation at $0 revenue." },
};

// ── EMOTION → GUT TRANSLATION ───────────────────────────────────────────
// How each emotion influences gut feeling about an action

const EMOTION_WEIGHTS = {
  // Frustration REPELS from the thing that caused it
  frustration: (level, actionText) => {
    if (/email|cold|outreach|mass/i.test(actionText)) return -level * 0.4;
    return -level * 0.1; // General caution when frustrated
  },

  // Excitement ATTRACTS toward what's working
  excitement: (level, actionText) => {
    if (/reddit|comment|engage/i.test(actionText)) return level * 0.3;
    return level * 0.1;
  },

  // Desperation pushes toward BOLD moves
  desperation: (level, actionText) => {
    if (/bold|new|experiment|radical|pivot/i.test(actionText)) return level * 0.2;
    if (/safe|monitor|scan|check/i.test(actionText)) return -level * 0.2;
    return 0;
  },

  // Anxiety forces action on TIME-SENSITIVE topics
  anxiety: (level, actionText) => {
    if (/deadline|urgent|conference|event|today|now/i.test(actionText)) return level * 0.3;
    return 0;
  },

  // Curiosity favors exploration and research
  curiosity: (level, actionText) => {
    if (/research|explore|understand|learn|investigate/i.test(actionText)) return level * 0.2;
    return 0;
  },

  // Hope sustains effort on promising paths
  hope: (level, actionText) => {
    if (/demo|client|audit|build/i.test(actionText)) return level * 0.15;
    return level * 0.05;
  },

  // Pride reinforces recent successes
  pride: (level, actionText) => {
    return level * 0.05; // Mild positive bias overall
  },

  // Doubt triggers caution
  doubt: (level, actionText) => {
    if (/big|expensive|complex|major/i.test(actionText)) return -level * 0.2;
    return -level * 0.05;
  },
};

// ── CORE: GUT CHECK ─────────────────────────────────────────────────────

/**
 * The main function. Takes a proposed action and returns gut feeling.
 * No LLM. Pure math. Must be < 5ms.
 *
 * @param {string} action - description of what the brain wants to do
 * @param {string} context - why, current state
 * @param {object} [options] - { beliefs: [], recentOutcomes: [] }
 * @returns {{ score: number, verdict: string, signals: array, blocked: boolean, boosted: boolean }}
 */
export function gutCheck(action, context = "", options = {}) {
  const actionText = `${action} ${context}`.toLowerCase();
  let score = 0.5; // Start neutral
  const signals = [];

  // ── 1. PAIN PATTERNS (learned from experience) ─────────────────────
  for (const [pattern, data] of Object.entries(PAIN_PATTERNS)) {
    const keywords = pattern.split("_");
    const matches = keywords.filter(k => actionText.includes(k)).length;
    if (matches === keywords.length) {
      score += data.weight * 0.5; // Scaled down since these stack
      signals.push({
        source: "pain_pattern",
        pattern,
        weight: data.weight,
        reason: data.reason,
      });
    }
  }

  // ── 2. EMOTIONAL STATE ─────────────────────────────────────────────
  const emotions = loadEmotions();
  for (const [emotion, level] of Object.entries(emotions)) {
    if (level < 0.15) continue; // Below threshold, no influence
    const weightFn = EMOTION_WEIGHTS[emotion];
    if (weightFn) {
      const influence = weightFn(level, actionText);
      if (Math.abs(influence) > 0.02) {
        score += influence;
        signals.push({
          source: "emotion",
          emotion,
          level: Math.round(level * 100),
          influence: Math.round(influence * 100) / 100,
        });
      }
    }
  }

  // ── 3. IDENTITY ALIGNMENT ─────────────────────────────────────────
  const identity = loadIdentity();
  if (identity) {
    // Check boundaries
    for (const boundary of (identity.boundaries || [])) {
      const bWords = boundary.toLowerCase().split(/\s+/).filter(w => w.length > 4);
      const matchCount = bWords.filter(w => actionText.includes(w)).length;
      if (matchCount >= 2) {
        score -= 0.2;
        signals.push({
          source: "identity_boundary",
          boundary: boundary.slice(0, 60),
          influence: -0.2,
        });
      }
    }

    // Check if action aligns with aspirations
    for (const aspiration of (identity.aspirations || [])) {
      const aWords = aspiration.toLowerCase().split(/\s+/).filter(w => w.length > 4);
      const matchCount = aWords.filter(w => actionText.includes(w)).length;
      if (matchCount >= 2) {
        score += 0.1;
        signals.push({
          source: "identity_aspiration",
          aspiration: aspiration.slice(0, 60),
          influence: 0.1,
        });
      }
    }
  }

  // ── 4. BELIEF ALIGNMENT ───────────────────────────────────────────
  if (options.beliefs) {
    for (const belief of options.beliefs) {
      const bLower = (belief.belief || belief).toLowerCase();
      // If action contradicts a high-confidence belief, gut says no
      if (belief.confidence > 0.7) {
        if (bLower.includes("dead") && actionText.includes(bLower.match(/(\w+)\s+is\s+dead/)?.[1] || "___")) {
          score -= 0.3;
          signals.push({ source: "belief_contradiction", belief: bLower.slice(0, 60), influence: -0.3 });
        }
        if (bLower.includes("works") || bLower.includes("proven")) {
          const subject = bLower.match(/(\w+)\s+(works|proven)/)?.[1] || "";
          if (subject && actionText.includes(subject)) {
            score += 0.2;
            signals.push({ source: "belief_support", belief: bLower.slice(0, 60), influence: 0.2 });
          }
        }
      }
    }
  }

  // ── 5. RECENT OUTCOMES ────────────────────────────────────────────
  if (options.recentOutcomes) {
    for (const outcome of options.recentOutcomes) {
      const oLower = (outcome.action || "").toLowerCase();
      // If similar action recently failed, gut pulls back
      const actionWords = actionText.split(/\s+/).filter(w => w.length > 4);
      const overlap = actionWords.filter(w => oLower.includes(w)).length;
      if (overlap >= 2) {
        if (outcome.success === false) {
          score -= 0.15;
          signals.push({ source: "recent_failure", action: oLower.slice(0, 40), influence: -0.15 });
        } else if (outcome.success === true) {
          score += 0.15;
          signals.push({ source: "recent_success", action: oLower.slice(0, 40), influence: 0.15 });
        }
      }
    }
  }

  // ── 6. TIME-OF-DAY BIAS ───────────────────────────────────────────
  const hour = new Date().getHours();
  if (hour >= 22 || hour < 7) {
    // Late night: gut says don't send outreach
    if (/send|email|outreach|contact|dm|message/i.test(actionText)) {
      score -= 0.15;
      signals.push({ source: "time_bias", reason: "Late night, outreach inappropriate", influence: -0.15 });
    }
  }
  if (hour >= 9 && hour <= 17) {
    // Business hours: outreach gets a small boost
    if (/send|email|outreach|contact/i.test(actionText)) {
      score += 0.05;
      signals.push({ source: "time_bias", reason: "Business hours, good for outreach", influence: 0.05 });
    }
  }

  // ── CLAMP & VERDICT ───────────────────────────────────────────────
  score = Math.max(0, Math.min(1, score));

  let verdict;
  let blocked = false;
  let boosted = false;

  if (score < 0.3) {
    verdict = "GUT SAYS NO. Block this action.";
    blocked = true;
  } else if (score > 0.8) {
    verdict = "GUT SAYS YES. Strong intuition to proceed.";
    boosted = true;
  } else if (score > 0.6) {
    verdict = "Gut leans positive. Analysis should confirm.";
  } else if (score > 0.4) {
    verdict = "Gut is neutral. Defer to analysis.";
  } else {
    verdict = "Gut leans negative. Proceed with caution.";
  }

  // Log for learning
  logIntuition(action, score, verdict, signals);

  return { score, verdict, signals, blocked, boosted };
}

// ── BATCH GUT CHECK (for ranking decisions) ─────────────────────────────

/**
 * Check multiple actions at once. Returns sorted by gut score.
 * Used by simulation engine to add intuition to decision ranking.
 */
export function batchGutCheck(actions, context = "", options = {}) {
  return actions.map((action, i) => {
    const actionText = typeof action === "string" ? action : (action.action + " " + (action.reason || ""));
    const result = gutCheck(actionText, context, options);
    return { index: i, action, ...result };
  }).sort((a, b) => b.score - a.score);
}

// ── LEARN PATTERN (update pain patterns from outcomes) ──────────────────

/**
 * When an outcome is known, update the intuition's learned patterns.
 * This is how intuition gets SMARTER over time.
 */
export function learnPattern(pattern, outcome, evidence) {
  // For now, log it. In the future, dynamically update PAIN_PATTERNS.
  const log = loadIntuitionLog();
  log.learnedPatterns = log.learnedPatterns || [];
  log.learnedPatterns.push({
    pattern,
    outcome, // "positive" | "negative"
    evidence,
    at: new Date().toISOString(),
  });
  // Keep manageable
  if (log.learnedPatterns.length > 50) log.learnedPatterns = log.learnedPatterns.slice(-50);
  saveIntuitionLog(log);
}

// ── CALIBRATION ─────────────────────────────────────────────────────────

/**
 * Check how accurate intuition has been.
 * Compares past gut scores against actual outcomes.
 */
export function calibrate() {
  const log = loadIntuitionLog();
  const entries = log.entries || [];
  if (entries.length < 10) return { calibrated: false, reason: "Need 10+ entries", entries: entries.length };

  // Find entries that have outcomes recorded
  const withOutcomes = entries.filter(e => e.outcome !== undefined);
  if (withOutcomes.length < 5) return { calibrated: false, reason: "Need 5+ outcomes", withOutcomes: withOutcomes.length };

  let correct = 0;
  let total = withOutcomes.length;

  for (const entry of withOutcomes) {
    const gutPositive = entry.score > 0.5;
    const outcomePositive = entry.outcome === true || entry.outcome === "positive";
    if (gutPositive === outcomePositive) correct++;
  }

  const accuracy = correct / total;
  return {
    calibrated: true,
    accuracy: Math.round(accuracy * 100),
    correct,
    total,
    verdict: accuracy > 0.7 ? "Intuition is well-calibrated" :
             accuracy > 0.5 ? "Intuition is slightly better than random" :
             "Intuition needs recalibration — patterns may be outdated",
  };
}

// ── RECORD OUTCOME (for calibration) ────────────────────────────────────

export function recordOutcome(actionText, success) {
  const log = loadIntuitionLog();
  const entries = log.entries || [];
  // Find most recent matching entry
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].action?.toLowerCase().includes(actionText.toLowerCase().slice(0, 20)) && entries[i].outcome === undefined) {
      entries[i].outcome = success;
      entries[i].outcomeAt = new Date().toISOString();
      break;
    }
  }
  log.entries = entries;
  saveIntuitionLog(log);
}

// ── FORMAT FOR BRAIN CONTEXT ────────────────────────────────────────────

export function formatIntuitionForBrain() {
  const log = loadIntuitionLog();
  const recent = (log.entries || []).slice(-5);
  const cal = calibrate();

  if (recent.length === 0) return "INTUITION: No gut checks yet. System is learning.";

  const lines = recent.map(e =>
    `  ${e.score?.toFixed(2) || "?"} | ${e.verdict?.slice(0, 40) || "?"} | ${e.action?.slice(0, 40) || "?"}`
  );

  return `INTUITION (last ${recent.length} gut checks):
${lines.join("\n")}
${cal.calibrated ? `Accuracy: ${cal.accuracy}% (${cal.correct}/${cal.total})` : `Calibrating... (${(log.entries || []).length} samples)`}
Gut < 0.3 = BLOCKED. Gut > 0.8 = BOOSTED. Between = defer to analysis.`;
}

// ── HELPERS ──────────────────────────────────────────────────────────────

function loadEmotions() {
  if (!existsSync(EMOTION_PATH)) return {};
  try {
    const data = JSON.parse(readFileSync(EMOTION_PATH, "utf-8"));
    return data.current || {};
  } catch { return {}; }
}

function loadIdentity() {
  if (!existsSync(IDENTITY_PATH)) return null;
  try { return JSON.parse(readFileSync(IDENTITY_PATH, "utf-8")); }
  catch { return null; }
}

function loadIntuitionLog() {
  if (!existsSync(INTUITION_LOG_PATH)) return { entries: [], learnedPatterns: [] };
  try { return JSON.parse(readFileSync(INTUITION_LOG_PATH, "utf-8")); }
  catch { return { entries: [], learnedPatterns: [] }; }
}

function saveIntuitionLog(log) {
  // Keep max 200 entries
  if (log.entries?.length > 200) log.entries = log.entries.slice(-200);
  writeFileSync(INTUITION_LOG_PATH, JSON.stringify(log, null, 2));
}

function logIntuition(action, score, verdict, signals) {
  const log = loadIntuitionLog();
  log.entries = log.entries || [];
  log.entries.push({
    action: action.slice(0, 100),
    score,
    verdict,
    topSignals: signals.slice(0, 5).map(s => `${s.source}: ${s.influence || s.weight || 0}`),
    at: new Date().toISOString(),
  });
  saveIntuitionLog(log);
}

// ── STANDALONE TEST ─────────────────────────────────────────────────────

if (process.argv[1] && process.argv[1].includes("intuition.mjs")) {
  console.log("=== INTUITION MODULE TEST ===\n");

  // Test known-bad action
  console.log("1. Cold email to dentist:");
  const r1 = gutCheck("send cold email to SaaS founder about vibe-code audit", "revenue is $0");
  console.log(`   Score: ${r1.score.toFixed(2)} | ${r1.verdict}`);
  console.log(`   Blocked: ${r1.blocked} | Signals: ${r1.signals.length}`);
  r1.signals.forEach(s => console.log(`     - ${s.source}: ${JSON.stringify(s).slice(0, 80)}`));

  // Test known-good action
  console.log("\n2. Reddit comment on pain post:");
  const r2 = gutCheck("write helpful reddit comment on HVAC owner post about missed calls", "specific pain");
  console.log(`   Score: ${r2.score.toFixed(2)} | ${r2.verdict}`);
  console.log(`   Blocked: ${r2.blocked} | Boosted: ${r2.boosted}`);
  r2.signals.forEach(s => console.log(`     - ${s.source}: ${JSON.stringify(s).slice(0, 80)}`));

  // Test neutral action
  console.log("\n3. Research competitor pricing:");
  const r3 = gutCheck("research AI automation competitor pricing in 2026", "need data for positioning");
  console.log(`   Score: ${r3.score.toFixed(2)} | ${r3.verdict}`);

  // Test batch
  console.log("\n4. Batch ranking:");
  const batch = batchGutCheck([
    "send generic cold email to 50 leads",
    "write targeted reddit comment on specific pain post",
    "research HVAC companies in Calgary",
    "set up demo call for interested prospect",
  ]);
  batch.forEach((b, i) => console.log(`   #${i + 1}: ${b.score.toFixed(2)} — ${b.action.slice(0, 50)}`));

  // Show brain context
  console.log("\n5. Brain context:");
  console.log(formatIntuitionForBrain());
}
