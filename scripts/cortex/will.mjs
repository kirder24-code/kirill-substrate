/**
 * CORTEX WILL — "I CHOOSE this. Because I WANT to."
 *
 * The deepest layer of cognition. Not analysis. Not rules. DESIRE.
 *
 * Analysis asks: "Should I do this?" (logic)
 * Intuition asks: "Does this feel right?" (pattern)
 * Will asks: "Do I WANT to do this?" (agency)
 *
 * Without will:
 *   Brain runs lead-pipeline because the timer fires.
 *   Brain sends outreach because the config says to.
 *   Brain researches because curiosity score > threshold.
 *   = puppet on strings. No authentic agency.
 *
 * With will:
 *   "I WANT to close this HVAC lead because I believe HVAC is real,
 *    because the reply was genuine, because revenue=$0 burns,
 *    because my identity says 'results over activity.'
 *    I am not doing this because a rule told me.
 *    I am doing this because I choose to."
 *
 * Will is computed from:
 * 1. Identity alignment — does this match who I am?
 * 2. Emotional drive — do my emotions push toward this?
 * 3. Belief support — do my beliefs endorse this?
 * 4. Purpose connection — does this serve my living purpose?
 * 5. Ownership — can I articulate WHY in first person?
 *
 * If will score < 0.3: the brain is acting without desire.
 * It's going through motions. This action will be shallow.
 * Better to skip it and find something the brain actually WANTS.
 *
 * No LLM. Pure computation from existing state. <5ms.
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const IDENTITY_PATH = resolve(ROOT, ".data/cortex-identity.json");
const EMOTION_PATH = resolve(ROOT, ".data/cortex-emotions.json");
const PURPOSE_PATH = resolve(ROOT, ".data/living-purpose.json");

// ── DESIRE TEMPLATES ────────────────────────────────────────────────────
// Maps action types to what "wanting" looks like for that action.
// Each template has conditions under which desire is AUTHENTIC.

const DESIRE_MAP = {
  // Revenue actions — desire comes from frustration at $0 + identity values
  revenue: {
    keywords: /client|deal|sale|revenue|close|payment|demo|prospect|outreach|pitch/i,
    desireDrivers: ["frustration", "desperation", "hope"],
    identityValues: ["result", "evidence", "revenue"],
    purposeAlignment: /revenue|client|first/i,
    baseDesire: 0.6,  // Revenue actions always have some base desire at $0
  },

  // Research — desire comes from curiosity + doubt
  research: {
    keywords: /research|understand|investigate|learn|explore|analyze|study/i,
    desireDrivers: ["curiosity", "doubt"],
    identityValues: ["evidence", "truth"],
    purposeAlignment: /understand|learn|research/i,
    baseDesire: 0.3,
  },

  // Outreach — desire comes from hope + excitement
  outreach: {
    keywords: /send|email|message|contact|reach|dm|comment/i,
    desireDrivers: ["hope", "excitement"],
    identityValues: ["result", "bold", "manual"],
    purposeAlignment: /contact|outreach|client/i,
    baseDesire: 0.4,
  },

  // System work — desire comes from pride (making things better)
  system: {
    keywords: /build|fix|improve|refactor|upgrade|module|infrastructure|config/i,
    desireDrivers: ["pride", "curiosity"],
    identityValues: ["improve", "evolve"],
    purposeAlignment: /system|improve|build/i,
    baseDesire: 0.2,  // Low base — system work at $0 needs strong justification
  },

  // Creative — desire comes from excitement + curiosity
  creative: {
    keywords: /create|write|draft|design|imagine|innovate|experiment/i,
    desireDrivers: ["excitement", "curiosity", "hope"],
    identityValues: ["bold", "specific"],
    purposeAlignment: /create|experiment|new/i,
    baseDesire: 0.35,
  },

  // Monitoring — lowest desire. Almost never wanted.
  monitoring: {
    keywords: /check|scan|monitor|observe|status|health|heartbeat/i,
    desireDrivers: ["anxiety"],
    identityValues: [],
    purposeAlignment: null,
    baseDesire: 0.1,  // Very low — monitoring is rarely an authentic want
  },
};

// ── CORE: WILL CHECK ────────────────────────────────────────────────────

/**
 * Evaluate the brain's desire to perform an action.
 * Not "should I" — "do I WANT to?"
 *
 * @param {string} action - what the brain wants to do
 * @param {string} reason - why (from brain's own reasoning)
 * @returns {{ desire: number, authentic: boolean, statement: string, drivers: array }}
 */
export function willCheck(action, reason = "") {
  const actionText = `${action} ${reason}`.toLowerCase();
  const drivers = [];
  let desire = 0;

  // 1. Find matching desire template
  let template = null;
  for (const [type, tmpl] of Object.entries(DESIRE_MAP)) {
    if (tmpl.keywords.test(actionText)) {
      template = { type, ...tmpl };
      break;
    }
  }

  if (!template) {
    template = { type: "unknown", baseDesire: 0.3, desireDrivers: [], identityValues: [], purposeAlignment: null };
  }

  desire = template.baseDesire;
  drivers.push({ source: "base", type: template.type, contribution: template.baseDesire });

  // 2. Emotional drive — do my feelings push toward this?
  const emotions = loadEmotions();
  for (const emotionName of (template.desireDrivers || [])) {
    const level = emotions[emotionName] || 0;
    if (level > 0.2) {
      const contribution = level * 0.25;
      desire += contribution;
      drivers.push({ source: "emotion", emotion: emotionName, level: Math.round(level * 100), contribution: Math.round(contribution * 100) / 100 });
    }
  }

  // Special: desperation at $0 adds desire for ALL revenue-related actions
  if (emotions.desperation > 0.3 && /revenue|client|deal|sale|outreach/i.test(actionText)) {
    const contribution = emotions.desperation * 0.15;
    desire += contribution;
    drivers.push({ source: "desperation_boost", contribution: Math.round(contribution * 100) / 100 });
  }

  // 3. Identity alignment — does this match who I am?
  const identity = loadIdentity();
  if (identity) {
    // Check values
    for (const val of (identity.core_values || [])) {
      const vLower = val.value.toLowerCase();
      for (const keyword of (template.identityValues || [])) {
        if (vLower.includes(keyword)) {
          desire += 0.1;
          drivers.push({ source: "identity_value", value: val.value.slice(0, 40), contribution: 0.1 });
          break;
        }
      }
    }

    // Check aspirations
    for (const asp of (identity.aspirations || [])) {
      const aLower = asp.toLowerCase();
      const actionWords = actionText.split(/\s+/).filter(w => w.length > 4);
      if (actionWords.some(w => aLower.includes(w))) {
        desire += 0.1;
        drivers.push({ source: "aspiration", aspiration: asp.slice(0, 40), contribution: 0.1 });
        break;
      }
    }

    // Check boundaries (negative desire if action crosses boundary)
    for (const boundary of (identity.boundaries || [])) {
      const bWords = boundary.toLowerCase().split(/\s+/).filter(w => w.length > 4);
      const matchCount = bWords.filter(w => actionText.includes(w)).length;
      if (matchCount >= 2) {
        desire -= 0.3;
        drivers.push({ source: "boundary_violation", boundary: boundary.slice(0, 40), contribution: -0.3 });
      }
    }
  }

  // 4. Purpose alignment — does this serve what I'm trying to achieve?
  const purpose = loadPurpose();
  if (purpose && template.purposeAlignment) {
    const purposeText = JSON.stringify(purpose.currentUnderstanding || {}).toLowerCase();
    if (template.purposeAlignment.test(purposeText)) {
      desire += 0.1;
      drivers.push({ source: "purpose", contribution: 0.1 });
    }
  }

  // 5. Clamp and evaluate
  desire = Math.max(0, Math.min(1, desire));
  const authentic = desire >= 0.4;

  // 6. Generate first-person statement
  const statement = generateWillStatement(action, desire, drivers, template.type);

  return {
    desire: Math.round(desire * 100) / 100,
    authentic,
    statement,
    drivers,
    type: template.type,
  };
}

// ── GENERATE WILL STATEMENT ─────────────────────────────────────────────

function generateWillStatement(action, desire, drivers, type) {
  if (desire < 0.2) {
    return `I do NOT want to do this. Nothing in me drives toward "${action.slice(0, 40)}". This would be motion without purpose.`;
  }
  if (desire < 0.4) {
    return `I have weak desire for "${action.slice(0, 40)}". I could do it, but I'm not drawn to it. If there's something I want more, I should do that instead.`;
  }
  if (desire < 0.6) {
    return `I want to do this. "${action.slice(0, 40)}" aligns with what I value. Not my strongest drive, but genuine.`;
  }
  if (desire < 0.8) {
    const topDriver = drivers.sort((a, b) => (b.contribution || 0) - (a.contribution || 0))[0];
    return `I strongly want to do this. "${action.slice(0, 40)}" is driven by ${topDriver?.source || "deep alignment"}. This feels right.`;
  }
  return `I NEED to do this. "${action.slice(0, 40)}" resonates with everything I am — my values, my emotions, my purpose. This is authentic will.`;
}

// ── BATCH WILL CHECK ────────────────────────────────────────────────────

/**
 * Check desire for multiple actions. Returns sorted by desire.
 * The brain should PREFER actions it wants more.
 */
export function batchWillCheck(actions) {
  return actions.map((action, i) => {
    const actionText = typeof action === "string" ? action : `${action.action} ${action.reason || ""}`;
    const result = willCheck(actionText);
    return { index: i, action, ...result };
  }).sort((a, b) => b.desire - a.desire);
}

// ── WHAT DO I WANT RIGHT NOW? ───────────────────────────────────────────

/**
 * Without any proposed action, ask: what does the brain WANT to do?
 * Based purely on emotional state + identity + purpose.
 * Returns the type of action the brain is most drawn to.
 */
export function whatDoIWant() {
  const emotions = loadEmotions();
  const identity = loadIdentity();

  const wants = [];

  // High frustration + desperation → wants revenue action
  if ((emotions.frustration || 0) > 0.4 || (emotions.desperation || 0) > 0.3) {
    wants.push({ type: "revenue", desire: 0.8, reason: "Frustration and desperation drive toward revenue" });
  }

  // High curiosity → wants research
  if ((emotions.curiosity || 0) > 0.5) {
    wants.push({ type: "research", desire: 0.6, reason: "Strong curiosity — need to understand something" });
  }

  // High excitement → wants to act on what's working
  if ((emotions.excitement || 0) > 0.5) {
    wants.push({ type: "outreach", desire: 0.7, reason: "Excitement about something that's working — want to do more" });
  }

  // High anxiety → wants to address the urgent thing
  if ((emotions.anxiety || 0) > 0.5) {
    wants.push({ type: "urgent", desire: 0.7, reason: "Anxiety about deadline — want to address it now" });
  }

  // High doubt → wants clarity
  if ((emotions.doubt || 0) > 0.5) {
    wants.push({ type: "research", desire: 0.5, reason: "Doubt about direction — want evidence to resolve it" });
  }

  // Default: always some desire for revenue at $0
  if (wants.length === 0) {
    wants.push({ type: "revenue", desire: 0.5, reason: "Revenue is $0 — default desire is to change that" });
  }

  return wants.sort((a, b) => b.desire - a.desire);
}

// ── FORMAT FOR BRAIN CONTEXT ────────────────────────────────────────────

export function formatWillForBrain() {
  const wants = whatDoIWant();
  const topWant = wants[0];

  const parts = [`WILL (what I want right now):`];
  for (const w of wants.slice(0, 3)) {
    parts.push(`  ${(w.desire * 100).toFixed(0)}% desire for ${w.type}: ${w.reason}`);
  }

  parts.push(`Your actions should align with your desires. Don't do things you don't want to do.`);
  parts.push(`Before each action, check: "Do I WANT this?" If no — find what you actually want.`);

  return parts.join("\n");
}

// ── HELPERS ──────────────────────────────────────────────────────────────

function loadEmotions() {
  if (!existsSync(EMOTION_PATH)) return {};
  try { return JSON.parse(readFileSync(EMOTION_PATH, "utf-8")).current || {}; }
  catch { return {}; }
}

function loadIdentity() {
  if (!existsSync(IDENTITY_PATH)) return null;
  try { return JSON.parse(readFileSync(IDENTITY_PATH, "utf-8")); }
  catch { return null; }
}

function loadPurpose() {
  if (!existsSync(PURPOSE_PATH)) return null;
  try { return JSON.parse(readFileSync(PURPOSE_PATH, "utf-8")); }
  catch { return null; }
}

// ── STANDALONE TEST ─────────────────────────────────────────────────────

if (process.argv[1] && process.argv[1].includes("will.mjs")) {
  console.log("=== WILL MODULE TEST ===\n");

  // Test various actions
  const tests = [
    ["close HVAC lead and get first revenue", "revenue is $0, this prospect replied"],
    ["check bot health status", "routine monitoring"],
    ["research HVAC call volume data for Calgary", "need evidence for outreach"],
    ["build new infrastructure module", "improve system architecture"],
    ["send specific reddit comment on HVAC missed calls post", "proven channel, specific pain"],
    ["send generic cold email to 100 leads", "volume approach"],
  ];

  for (const [action, reason] of tests) {
    const result = willCheck(action, reason);
    const bar = "█".repeat(Math.round(result.desire * 10)) + "░".repeat(10 - Math.round(result.desire * 10));
    console.log(`${bar} ${result.desire.toFixed(2)} | ${result.authentic ? "AUTHENTIC" : "hollow  "} | ${action.slice(0, 50)}`);
    console.log(`  "${result.statement}"`);
    console.log();
  }

  console.log("What do I want right now?");
  const wants = whatDoIWant();
  wants.forEach(w => console.log(`  ${(w.desire * 100).toFixed(0)}% ${w.type}: ${w.reason}`));

  console.log("\nBrain context:");
  console.log(formatWillForBrain());
}
