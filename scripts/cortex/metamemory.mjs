/**
 * CORTEX METAMEMORY — Knowing what you know and what you don't
 *
 * "I understand the Calgary HVAC market at 7/10.
 *  I understand dental clinic operations at 2/10.
 *  I understand competitor pricing at 4/10.
 *  I understand what makes a cold email work at 3/10."
 *
 * This self-knowledge about knowledge guides WHERE to invest
 * learning effort. Without it, the brain researches randomly.
 * With it, the brain targets its biggest knowledge gaps.
 *
 * Metamemory has two parts:
 *
 * 1. KNOWLEDGE MAP — for each domain, how well do I understand it?
 *    Auto-computed from: belief count + confidence + evidence depth
 *    + recency of last update + prediction accuracy in that domain
 *
 * 2. IMPORTANCE MAP — for each domain, how much does it matter?
 *    Computed from: revenue relevance + current focus + identity values
 *
 * The intersection = LEARNING PRIORITIES:
 *   Low knowledge + High importance = LEARN THIS FIRST
 *   High knowledge + High importance = LEVERAGE THIS
 *   Low knowledge + Low importance = IGNORE
 *   High knowledge + Low importance = NICE TO HAVE
 *
 * No LLM. Pure computation from existing data. <10ms.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const META_PATH = resolve(ROOT, ".data/cortex-metamemory.json");

// ── KNOWLEDGE DOMAINS ───────────────────────────────────────────────────
// All domains the brain could know about. Importance is relative.

const DOMAINS = {
  // Market knowledge (broad, not industry-specific)
  "calgary_business":   { category: "market", importance: 8, desc: "Calgary business landscape, economy, tariffs, who needs AI" },
  "canadian_tariffs":   { category: "market", importance: 9, desc: "Tariff crisis impact on Canadian businesses, AI as survival tool" },
  "energy_sector":      { category: "market", importance: 8, desc: "Calgary energy/oil&gas sector, digitalization, conference" },
  "global_ai_market":   { category: "market", importance: 6, desc: "Global AI services market, trends, demand signals" },
  "canadian_smb":       { category: "market", importance: 7, desc: "Canadian small/medium businesses, their pain, willingness to pay for AI" },

  // Product knowledge
  "ai_employee":        { category: "product", importance: 9, desc: "AI employee concept ($1,500/mo), positioning vs automation/chatbots" },
  "ai_workflows":       { category: "product", importance: 7, desc: "Multi-step AI automation for businesses" },
  "competitor_landscape": { category: "product", importance: 7, desc: "Artisan, 11x, Sintra, Lindy, and other AI agent companies" },
  "our_capabilities":   { category: "product", importance: 9, desc: "What our 48-module system can actually do for clients" },

  // Sales knowledge
  "outreach_methods":   { category: "sales", importance: 8, desc: "What works: cold email, DM, comments, networking, conferences, freelance platforms" },
  "demo_conversion":    { category: "sales", importance: 9, desc: "How to convert interest into paying clients" },
  "channel_effectiveness": { category: "sales", importance: 8, desc: "Which channels actually produce results across all industries" },
  "positioning":        { category: "sales", importance: 8, desc: "How to position Kirill: Parliament + Calgary + AI + bilingual" },

  // Technical knowledge
  "system_capabilities": { category: "technical", importance: 7, desc: "CORTEX 48 modules, what each can do, how to leverage for clients" },
  "ai_tools_2026":      { category: "technical", importance: 6, desc: "Latest AI tools, APIs, frameworks available in 2026" },

  // Strategic knowledge
  "first_client_path":  { category: "strategy", importance: 10, desc: "Exact steps to close first paying client — any industry" },
  "threads_channel":     { category: "strategy", importance: 9, desc: "Threads as discovery channel - Kirill's posts getting engagement, 5 contacts in 1 day" },
  "revenue_models":     { category: "strategy", importance: 7, desc: "Subscription, project, retainer, equity — which model for which client" },
};

// ── STATE ────────────────────────────────────────────────────────────────

function loadState() {
  if (!existsSync(META_PATH)) {
    return {
      knowledgeMap: {},  // domain -> { score, lastAssessed, evidence }
      assessmentCount: 0,
      lastFullAssessment: null,
    };
  }
  try { return JSON.parse(readFileSync(META_PATH, "utf-8")); }
  catch { return loadState(); }
}

function saveState(state) {
  writeFileSync(META_PATH, JSON.stringify(state, null, 2));
}

// ── ASSESS KNOWLEDGE ────────────────────────────────────────────────────

/**
 * Assess knowledge level for a specific domain.
 * Score 0-10 computed from real data:
 * - How many beliefs in this domain?
 * - How confident are they?
 * - How recent?
 * - Any prediction accuracy data?
 * - Any procedural memories (learned rules)?
 *
 * @param {object} db - database
 * @param {string} domain - domain key
 * @returns {{ score: number, factors: object }}
 */
export function assessDomain(db, domain) {
  const domainConfig = DOMAINS[domain];
  if (!domainConfig) return { score: 0, factors: { reason: "Unknown domain" } };

  const keywords = domain.replace(/_/g, " ").split(" ").filter(w => w.length > 2);
  const factors = {};
  let score = 0;

  // 1. Belief count and confidence in this domain
  try {
    const beliefs = db.prepare(
      "SELECT COUNT(*) as cnt, AVG(confidence) as avg_conf FROM wm_beliefs WHERE confidence > 0.2"
    ).get();

    // Filter beliefs that match domain keywords
    const allBeliefs = db.prepare(
      "SELECT belief, confidence, updated_at FROM wm_beliefs WHERE confidence > 0.2"
    ).all();

    const domainBeliefs = allBeliefs.filter(b => {
      const bLower = b.belief.toLowerCase();
      return keywords.some(k => bLower.includes(k));
    });

    factors.beliefCount = domainBeliefs.length;
    factors.avgConfidence = domainBeliefs.length > 0
      ? Math.round(domainBeliefs.reduce((s, b) => s + b.confidence, 0) / domainBeliefs.length * 100) / 100
      : 0;

    // More beliefs = more knowledge (diminishing returns)
    score += Math.min(3, domainBeliefs.length * 0.5);
    score += factors.avgConfidence * 2;
  } catch {
    factors.beliefCount = 0;
    factors.avgConfidence = 0;
  }

  // 2. Procedural memories (learned rules) in this domain
  try {
    const procedures = db.prepare(
      "SELECT content FROM cortex_memory WHERE type = 'procedural' AND outdated = 0"
    ).all();

    const domainProcedures = procedures.filter(p =>
      keywords.some(k => p.content.toLowerCase().includes(k))
    );

    factors.procedureCount = domainProcedures.length;
    score += Math.min(2, domainProcedures.length * 0.5);
  } catch {
    factors.procedureCount = 0;
  }

  // 3. Episodic memories (experience) in this domain
  try {
    const episodes = db.prepare(
      "SELECT content, created_at FROM cortex_memory WHERE type = 'episodic' AND outdated = 0 ORDER BY created_at DESC LIMIT 50"
    ).all();

    const domainEpisodes = episodes.filter(e =>
      keywords.some(k => e.content.toLowerCase().includes(k))
    );

    factors.episodeCount = domainEpisodes.length;
    // Recent experience is worth more
    const recentCount = domainEpisodes.filter(e => {
      const age = Date.now() - new Date(e.created_at).getTime();
      return age < 72 * 3600 * 1000; // Last 72 hours
    }).length;
    factors.recentEpisodes = recentCount;

    score += Math.min(1.5, domainEpisodes.length * 0.2);
    score += recentCount * 0.3; // Recency bonus
  } catch {
    factors.episodeCount = 0;
    factors.recentEpisodes = 0;
  }

  // 4. Prediction accuracy in related domain
  try {
    const predictions = db.prepare(
      "SELECT was_correct FROM wm_predictions WHERE tested_at IS NOT NULL AND domain LIKE ?"
    ).all(`%${keywords[0]}%`);

    if (predictions.length > 0) {
      const accuracy = predictions.filter(p => p.was_correct).length / predictions.length;
      factors.predictionAccuracy = Math.round(accuracy * 100);
      score += accuracy * 1.5;
    }
  } catch {}

  // Clamp to 0-10
  score = Math.max(0, Math.min(10, Math.round(score * 10) / 10));

  return { score, factors };
}

// ── FULL ASSESSMENT ─────────────────────────────────────────────────────

/**
 * Assess ALL domains. Returns complete knowledge map with priorities.
 */
export function fullAssessment(db) {
  const state = loadState();
  const results = [];

  for (const [domain, config] of Object.entries(DOMAINS)) {
    const assessment = assessDomain(db, domain);
    const gap = Math.max(0, 10 - assessment.score);
    const priority = gap * (config.importance / 10); // Gap * importance = priority

    const entry = {
      domain,
      category: config.category,
      desc: config.desc,
      knowledge: assessment.score,
      importance: config.importance,
      gap,
      priority: Math.round(priority * 10) / 10,
      factors: assessment.factors,
      assessedAt: new Date().toISOString(),
    };

    results.push(entry);
    state.knowledgeMap[domain] = entry;
  }

  state.assessmentCount++;
  state.lastFullAssessment = new Date().toISOString();
  saveState(state);

  // Sort by priority (highest first = biggest knowledge gaps in important areas)
  results.sort((a, b) => b.priority - a.priority);

  return results;
}

// ── GET LEARNING PRIORITIES ─────────────────────────────────────────────

/**
 * Get the top N domains where learning would have the most impact.
 * = highest (importance * gap)
 */
export function getLearningPriorities(db, topN = 5) {
  const assessment = fullAssessment(db);
  return assessment.slice(0, topN);
}

// ── GET STRENGTHS ───────────────────────────────────────────────────────

/**
 * What does the brain know WELL? (high knowledge + high importance)
 */
export function getStrengths(db) {
  const assessment = fullAssessment(db);
  return assessment.filter(a => a.knowledge >= 5 && a.importance >= 6);
}

// ── FORMAT FOR BRAIN CONTEXT ────────────────────────────────────────────

export function formatMetamemoryForBrain(db) {
  let assessment;
  try {
    assessment = fullAssessment(db);
  } catch {
    return "METAMEMORY: Cannot assess. Database unavailable.";
  }

  const priorities = assessment.slice(0, 5);
  const strengths = assessment.filter(a => a.knowledge >= 5 && a.importance >= 6);
  const blind = assessment.filter(a => a.knowledge <= 2 && a.importance >= 7);

  const parts = ["METAMEMORY (what I know and don't know):"];

  if (blind.length > 0) {
    parts.push("BLIND SPOTS (low knowledge + high importance — LEARN THESE):");
    for (const b of blind) {
      parts.push(`  !! ${b.domain}: ${b.knowledge}/10 knowledge, ${b.importance}/10 importance — ${b.desc}`);
    }
  }

  if (strengths.length > 0) {
    parts.push("STRENGTHS (high knowledge + high importance — LEVERAGE THESE):");
    for (const s of strengths) {
      parts.push(`  ++ ${s.domain}: ${s.knowledge}/10 knowledge — ${s.desc}`);
    }
  }

  parts.push("TOP LEARNING PRIORITIES:");
  for (const p of priorities) {
    const bar = "█".repeat(Math.round(p.knowledge)) + "░".repeat(10 - Math.round(p.knowledge));
    parts.push(`  ${bar} ${p.domain}: ${p.knowledge}/10 (importance: ${p.importance}, priority: ${p.priority})`);
  }

  parts.push("Research and learn in priority order. Don't research what you already know well.");

  return parts.join("\n");
}

// ── STANDALONE TEST ─────────────────────────────────────────────────────

if (process.argv[1] && process.argv[1].includes("metamemory.mjs")) {
  const { initMemory } = await import("./memory.mjs");
  const { initWorldModel } = await import("./world-model.mjs");
  const { initNarrative } = await import("./narrative.mjs");

  const db = initMemory();
  initNarrative(db);
  initWorldModel(db);

  console.log("=== METAMEMORY TEST ===\n");

  const assessment = fullAssessment(db);

  console.log("FULL KNOWLEDGE MAP:");
  console.log("─".repeat(80));
  for (const a of assessment) {
    const bar = "█".repeat(Math.round(a.knowledge)) + "░".repeat(10 - Math.round(a.knowledge));
    const impBar = "★".repeat(Math.round(a.importance / 2));
    console.log(`${bar} ${a.knowledge.toFixed(1)}/10 | ${impBar} imp:${a.importance} | pri:${a.priority} | ${a.domain}`);
    console.log(`  ${a.desc}`);
    console.log(`  beliefs:${a.factors.beliefCount} proc:${a.factors.procedureCount} episodes:${a.factors.episodeCount} recent:${a.factors.recentEpisodes}`);
  }

  console.log("\n\nBrain context:");
  console.log(formatMetamemoryForBrain(db));
}
