/**
 * CORTEX PRIMING — Continuity of thought between cycles
 *
 * When you hear "doctor", your brain instantly activates
 * "nurse", "hospital", "health", "stethoscope" — before you
 * consciously think about them. Recent thoughts make related
 * concepts MORE ACCESSIBLE.
 *
 * Without priming:
 *   Cycle 1: "HVAC leads look promising, Calgary market is..."
 *   Cycle 2: *blank slate* — brain starts from zero, picks random topic
 *   Cycle 3: *blank slate* — brain randomly returns to HVAC
 *   = no trains of thought, constant reset, shallow cycling
 *
 * With priming:
 *   Cycle 1: "HVAC leads look promising, Calgary market is..."
 *   Cycle 2: primed with [HVAC, Calgary, leads, promising]
 *            → brain naturally continues: "...let me research HVAC companies"
 *   Cycle 3: primed with [HVAC, research, companies, Calgary]
 *            → brain continues: "found 3 targets, drafting outreach"
 *   = natural train of thought, depth builds, quality compounds
 *
 * Priming buffer holds last 3-5 cognitive traces.
 * Each trace = thought + concepts + emotional valence + timestamp.
 * Older traces decay — recent thoughts prime strongest.
 *
 * This is NOT memory. Memory is permanent. Priming is TEMPORARY.
 * It's the echo of recent thinking that shapes the next thought.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const PRIMING_PATH = resolve(ROOT, ".data/cortex-priming.json");

// ── CONFIGURATION ───────────────────────────────────────────────────────

const CONFIG = {
  maxTraces: 5,           // How many recent thoughts stay in buffer
  decayRate: 0.2,         // How much strength drops per cycle (0-1)
  minStrength: 0.1,       // Below this, trace is evicted
  conceptsPerTrace: 8,    // Max concepts extracted per thought
};

// ── STATE ────────────────────────────────────────────────────────────────

function loadState() {
  if (!existsSync(PRIMING_PATH)) {
    return { traces: [], cycleCount: 0 };
  }
  try { return JSON.parse(readFileSync(PRIMING_PATH, "utf-8")); }
  catch { return { traces: [], cycleCount: 0 }; }
}

function saveState(state) {
  writeFileSync(PRIMING_PATH, JSON.stringify(state, null, 2));
}

// ── EXTRACT CONCEPTS ────────────────────────────────────────────────────

/**
 * Extract key concepts from a thought/decision/observation.
 * No LLM — pure text analysis. Fast.
 *
 * Returns weighted concepts: [{concept, weight}]
 */
function extractConcepts(text) {
  if (!text) return [];
  const lower = text.toLowerCase();

  // Stop words to filter out
  const stopWords = new Set([
    "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "need", "dare", "ought",
    "used", "to", "of", "in", "for", "on", "with", "at", "by", "from",
    "as", "into", "through", "during", "before", "after", "above", "below",
    "between", "out", "off", "over", "under", "again", "further", "then",
    "once", "here", "there", "when", "where", "why", "how", "all", "both",
    "each", "few", "more", "most", "other", "some", "such", "no", "nor",
    "not", "only", "own", "same", "so", "than", "too", "very", "just",
    "don", "now", "also", "that", "this", "these", "those", "what", "which",
    "who", "whom", "it", "its", "i", "me", "my", "we", "our", "you", "your",
    "he", "him", "his", "she", "her", "they", "them", "their", "but", "and",
    "or", "if", "because", "about", "get", "got", "run", "set", "new", "old",
    "try", "want", "make", "like", "time", "still", "back", "much", "even",
  ]);

  // Extract words, filter, count frequency
  const words = lower
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w));

  // Count occurrences
  const freq = {};
  for (const w of words) {
    freq[w] = (freq[w] || 0) + 1;
  }

  // Also extract 2-word phrases (bigrams) for compound concepts
  const bigrams = {};
  for (let i = 0; i < words.length - 1; i++) {
    if (words[i].length > 3 && words[i + 1].length > 3) {
      const bigram = `${words[i]} ${words[i + 1]}`;
      bigrams[bigram] = (bigrams[bigram] || 0) + 1;
    }
  }

  // Combine and rank
  const concepts = [];

  // Add frequent bigrams first (higher value)
  for (const [bigram, count] of Object.entries(bigrams)) {
    if (count >= 1) {
      concepts.push({ concept: bigram, weight: Math.min(1, count * 0.4) });
    }
  }

  // Add single words
  for (const [word, count] of Object.entries(freq)) {
    // Skip words already captured in bigrams
    const inBigram = concepts.some(c => c.concept.includes(word));
    if (!inBigram) {
      concepts.push({ concept: word, weight: Math.min(1, count * 0.3) });
    }
  }

  // Boost domain-specific terms
  const domainBoosts = {
    revenue: 0.3, client: 0.3, payment: 0.3, money: 0.3, deal: 0.3,
    lead: 0.2, outreach: 0.2, reply: 0.2, prospect: 0.2,
    hvac: 0.2, dental: 0.2, calgary: 0.2, voice: 0.2, agent: 0.2,
    reddit: 0.2, linkedin: 0.2, fiverr: 0.2, email: 0.2,
    surprise: 0.3, error: 0.2, failed: 0.2, success: 0.3,
    research: 0.15, market: 0.15, competitor: 0.15,
  };

  for (const c of concepts) {
    for (const [term, boost] of Object.entries(domainBoosts)) {
      if (c.concept.includes(term)) {
        c.weight = Math.min(1, c.weight + boost);
        break;
      }
    }
  }

  // Sort by weight, take top N
  return concepts
    .sort((a, b) => b.weight - a.weight)
    .slice(0, CONFIG.conceptsPerTrace);
}

// ── PRIME (record a thought) ────────────────────────────────────────────

/**
 * Record a cognitive trace from the current cycle.
 * Called after brain thinks or makes a decision.
 *
 * @param {string} thought - the brain's thinking output
 * @param {string} type - "thinking" | "decision" | "discovery" | "surprise" | "emotion"
 * @param {object} [meta] - optional metadata (emotional valence, etc)
 */
export function prime(thought, type = "thinking", meta = {}) {
  const state = loadState();

  const concepts = extractConcepts(thought);
  if (concepts.length === 0) return; // Nothing worth priming

  const trace = {
    thought: thought.slice(0, 300),
    type,
    concepts,
    strength: 1.0,  // Starts at full strength
    emotionalValence: meta.valence || 0, // -1 negative, 0 neutral, +1 positive
    createdAt: new Date().toISOString(),
    cycle: state.cycleCount,
  };

  state.traces.push(trace);

  // Evict oldest if over limit
  if (state.traces.length > CONFIG.maxTraces) {
    state.traces = state.traces.slice(-CONFIG.maxTraces);
  }

  saveState(state);
}

// ── DECAY (called every cycle) ──────────────────────────────────────────

/**
 * Decay all traces. Recent thoughts stay strong, old ones fade.
 * Must be called at start of each cycle.
 */
export function decay() {
  const state = loadState();
  state.cycleCount++;

  for (const trace of state.traces) {
    trace.strength -= CONFIG.decayRate;
  }

  // Remove dead traces
  state.traces = state.traces.filter(t => t.strength >= CONFIG.minStrength);

  saveState(state);
}

// ── GET PRIMED CONCEPTS ─────────────────────────────────────────────────

/**
 * Get the current priming state: which concepts are "hot" right now?
 * Returns concepts weighted by trace strength and concept weight.
 * Used to bias the brain's context toward recent trains of thought.
 */
export function getPrimedConcepts() {
  const state = loadState();
  if (state.traces.length === 0) return [];

  // Merge all concepts from all active traces, weighted by trace strength
  const merged = {};
  for (const trace of state.traces) {
    for (const c of trace.concepts) {
      const effectiveWeight = c.weight * trace.strength;
      if (!merged[c.concept] || merged[c.concept] < effectiveWeight) {
        merged[c.concept] = effectiveWeight;
      }
    }
  }

  return Object.entries(merged)
    .map(([concept, weight]) => ({ concept, weight: Math.round(weight * 100) / 100 }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 12); // Top 12 primed concepts
}

// ── RELEVANCE SCORER ────────────────────────────────────────────────────

/**
 * Score how relevant a piece of text is to current priming state.
 * Used to boost relevant signals and filter irrelevant ones.
 *
 * @param {string} text - text to score
 * @returns {number} 0-1 relevance to current priming
 */
export function relevanceScore(text) {
  const primed = getPrimedConcepts();
  if (primed.length === 0) return 0.5; // No priming = neutral

  const lower = text.toLowerCase();
  let totalWeight = 0;
  let matchWeight = 0;

  for (const p of primed) {
    totalWeight += p.weight;
    if (lower.includes(p.concept)) {
      matchWeight += p.weight;
    }
  }

  if (totalWeight === 0) return 0.5;
  return Math.min(1, matchWeight / totalWeight + 0.3); // 0.3 base so nothing is completely irrelevant
}

// ── FORMAT FOR BRAIN CONTEXT ────────────────────────────────────────────

export function formatPrimingForBrain() {
  const state = loadState();
  if (state.traces.length === 0) {
    return "PRIMING: Empty. No recent thought traces. This is the first cycle.";
  }

  const primed = getPrimedConcepts();
  const recentThoughts = state.traces
    .slice(-3)
    .reverse() // Most recent first
    .map((t, i) => {
      const strength = "●".repeat(Math.round(t.strength * 5)) + "○".repeat(5 - Math.round(t.strength * 5));
      return `  ${i + 1}. [${strength}] ${t.thought.slice(0, 120)}`;
    });

  const hotConcepts = primed.slice(0, 8).map(p => p.concept).join(", ");

  return `PRIMING (continuity of thought):
Recent trains of thought:
${recentThoughts.join("\n")}
Hot concepts: ${hotConcepts}
Your thinking should NATURALLY continue from these traces. Don't restart from zero.
If a new topic is more important, that's fine — but don't context-switch without reason.`;
}

// ── STANDALONE TEST ─────────────────────────────────────────────────────

if (process.argv[1] && process.argv[1].includes("priming.mjs")) {
  console.log("=== PRIMING MODULE TEST ===\n");

  // Simulate 3 cycles of thinking
  console.log("Cycle 1: Brain thinks about HVAC market");
  prime("HVAC companies in Calgary are struggling with missed calls. Average HVAC company misses 23% of calls. Voice agent could save $3500/month in missed revenue.", "thinking", { valence: 0.5 });

  console.log("Concepts extracted:");
  const state1 = loadState();
  console.log(state1.traces[0].concepts.map(c => `  ${c.concept}: ${c.weight.toFixed(2)}`).join("\n"));

  decay();
  console.log("\nCycle 2: Brain thinks about outreach");
  prime("Found 3 HVAC companies in Calgary with bad Google reviews about not answering phones. Draft specific outreach mentioning their exact pain point.", "decision", { valence: 0.7 });

  console.log("\nPrimed concepts after 2 cycles:");
  const primed = getPrimedConcepts();
  console.log(primed.map(p => `  ${p.concept}: ${p.weight}`).join("\n"));

  // Test relevance scoring
  console.log("\nRelevance scores:");
  console.log(`  "vibe-code audit for SaaS founder": ${relevanceScore("vibe-code audit for SaaS founder").toFixed(2)}`);
  console.log(`  "LinkedIn content about AI trends": ${relevanceScore("LinkedIn content about AI trends").toFixed(2)}`);
  console.log(`  "workflow automation for service business": ${relevanceScore("workflow automation for service business").toFixed(2)}`);

  decay();
  console.log("\nCycle 3: Brain continues HVAC thread");
  prime("Sent outreach to 3 HVAC companies. Used specific missed-call pain point. Expected 1 reply based on gut feeling.", "decision", { valence: 0.3 });

  console.log("\nFull brain context:");
  console.log(formatPrimingForBrain());
}
