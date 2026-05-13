/**
 * CORTEX CURIOSITY ENGINE — The system that asks its own questions
 *
 * Every AI agent waits for instructions. CORTEX asks questions.
 *
 * The Curiosity Engine finds GAPS in the world model and generates
 * questions to fill them. Then it researches those questions,
 * integrates the findings, and generates NEW questions from the findings.
 *
 * This creates a SELF-PERPETUATING LEARNING LOOP:
 *
 *   World model has gap → Generate question →
 *   Research question → New knowledge →
 *   Integrate into world model → Find new gaps →
 *   Generate more questions → ...
 *
 * Types of curiosity:
 *
 * 1. GAP-DRIVEN: "I believe dental loses 23% of calls but I don't know
 *    what they currently PAY to solve this. Question: how much do dental
 *    SMBs spend on automation consultants?"
 *
 * 2. CONTRADICTION-DRIVEN: "One source says HVAC gets 100 calls/month,
 *    another says 300. Question: what's the real number and why the range?"
 *
 * 3. TEMPORAL: "My competitor data is 2 weeks old. Question: has Smith.ai
 *    changed pricing or features since then?"
 *
 * 4. STRATEGIC: "Revenue is $0. Question: what did other AI service sellers
 *    do in their first 30 days that actually worked?"
 *
 * 5. ANALOGICAL: "Reddit comments work for us. Question: what other
 *    platforms have a similar comment-then-DM pattern we could use?"
 *
 * The queue is self-filling. The system never runs out of things to learn.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { getBeliefs, getEntitiesByType, getUntestedPredictions, upsertEntity, addBelief } from "./world-model.mjs";
import { getActiveThreads } from "./narrative.mjs";
import { deepResearch } from "./deep-research.mjs";
import { remember } from "./memory.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const ENV_PATH = resolve(ROOT, "apps/api/.env");
const CURIOSITY_PATH = resolve(ROOT, ".data/curiosity-queue.json");

const env = Object.fromEntries(
  readFileSync(ENV_PATH, "utf-8").split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

// ── CURIOSITY QUEUE ───────────────────────────────────────────────────

function loadQueue() {
  if (!existsSync(CURIOSITY_PATH)) return { questions: [], answered: [], lastGenerated: null };
  try { return JSON.parse(readFileSync(CURIOSITY_PATH, "utf-8")); }
  catch { return { questions: [], answered: [], lastGenerated: null }; }
}

function saveQueue(queue) {
  if (queue.answered.length > 50) queue.answered = queue.answered.slice(-50);
  if (queue.questions.length > 30) queue.questions = queue.questions.slice(0, 30);
  writeFileSync(CURIOSITY_PATH, JSON.stringify(queue, null, 2));
}

// ── QUESTION GENERATORS ───────────────────────────────────────────────

/**
 * Scan the world model for gaps and generate questions.
 * No LLM needed - pure logic analysis of what's missing.
 */
function generateQuestionsFromGaps(db) {
  const questions = [];

  // 1. GAP-DRIVEN: beliefs with low confidence
  const weakBeliefs = getBeliefs(db, null, 0.0, 20).filter(b => b.confidence < 0.5);
  for (const b of weakBeliefs.slice(0, 3)) {
    questions.push({
      type: "gap",
      question: `Verify: "${b.belief}" (confidence only ${(b.confidence * 100).toFixed(0)}%). What does real data say?`,
      domain: b.domain,
      priority: 0.6,
      source: `weak belief #${b.id}`,
    });
  }

  // 2. CONTRADICTION-DRIVEN: beliefs with contradictions
  const contradicted = getBeliefs(db, null, 0.0, 20).filter(b => {
    const c = b.contradictions;
    return Array.isArray(c) && c.length > 0;
  });
  for (const b of contradicted.slice(0, 2)) {
    questions.push({
      type: "contradiction",
      question: `Resolve contradiction: "${b.belief}" is contradicted by: ${b.contradictions.map(c => c.text || c).join("; ")}. Which is true?`,
      domain: b.domain,
      priority: 0.7,
      source: `contradicted belief #${b.id}`,
    });
  }

  // 3. MISSING DATA: entities with sparse properties
  const industries = getEntitiesByType(db, "industry", 10);
  for (const ind of industries) {
    const props = ind.properties;
    if (!props.avg_deal_size) {
      questions.push({
        type: "gap",
        question: `What would a ${ind.name} business pay for AI automation services? Average deal size for this vertical?`,
        domain: "pricing",
        priority: 0.8,
        source: `industry ${ind.name} missing avg_deal_size`,
      });
    }
    if (!props.decision_maker) {
      questions.push({
        type: "gap",
        question: `Who is the decision maker for phone systems at a ${ind.name} business? Office manager? Owner? IT?`,
        domain: "sales",
        priority: 0.5,
        source: `industry ${ind.name} missing decision_maker`,
      });
    }
    if (!props.buying_trigger) {
      questions.push({
        type: "gap",
        question: `What triggers a ${ind.name} business to look for a receptionist solution? Growth? Bad reviews? Staff turnover?`,
        domain: "sales",
        priority: 0.6,
        source: `industry ${ind.name} missing buying_trigger`,
      });
    }
  }

  // 4. COMPETITOR GAPS
  const competitors = getEntitiesByType(db, "competitor", 10);
  for (const comp of competitors) {
    const props = comp.properties;
    if (!props.customer_count && !props.revenue) {
      questions.push({
        type: "gap",
        question: `How big is ${comp.name}? How many customers? What's their revenue? Are they growing or shrinking?`,
        domain: "competition",
        priority: 0.5,
        source: `competitor ${comp.name} missing size data`,
      });
    }
    if (!props.weakness_verified) {
      questions.push({
        type: "gap",
        question: `What do ${comp.name} customers complain about? What are their real weaknesses based on reviews?`,
        domain: "competition",
        priority: 0.7,
        source: `competitor ${comp.name} weakness unverified`,
      });
    }
  }

  // 5. STRATEGIC: based on revenue status
  questions.push({
    type: "strategic",
    question: "What did successful AI service sellers do in their first 30 days to get their first paying client?",
    domain: "strategy",
    priority: 0.9,
    source: "revenue = $0, need first client strategy",
  });

  // 6. TEMPORAL: stale data
  const staleEntities = getEntitiesByType(db, "competitor", 10).filter(e => {
    const daysSinceUpdate = (Date.now() - new Date(e.updated_at).getTime()) / 86_400_000;
    return daysSinceUpdate > 7;
  });
  for (const e of staleEntities.slice(0, 2)) {
    questions.push({
      type: "temporal",
      question: `Has ${e.name} changed anything in the last week? New features, pricing, or positioning?`,
      domain: "competition",
      priority: 0.4,
      source: `stale data for ${e.name}`,
    });
  }

  // 7. ANALOGICAL: what else works like our best channel
  const channels = getEntitiesByType(db, "channel", 10);
  const bestChannel = channels.find(c => c.properties.effectiveness === "high");
  if (bestChannel) {
    questions.push({
      type: "analogical",
      question: `${bestChannel.name} works for us (${bestChannel.properties.method || "?"}). What other platforms have a similar dynamic where helpful comments lead to business conversations?`,
      domain: "channels",
      priority: 0.6,
      source: `analogical from ${bestChannel.name}`,
    });
  }

  return questions;
}

// ── MAIN CURIOSITY CYCLE ──────────────────────────────────────────────

/**
 * Run one curiosity cycle:
 * 1. Generate new questions from world model gaps
 * 2. Pick the highest-priority unanswered question
 * 3. Research it via deep-research
 * 4. Integrate findings into world model
 * 5. Generate follow-up questions from findings
 */
export async function curiosityCycle(db, log = console.log) {
  log("[CURIOSITY] === CURIOSITY CYCLE ===");

  const queue = loadQueue();

  // 1. Generate new questions
  const newQuestions = generateQuestionsFromGaps(db);
  const existingTexts = new Set([
    ...queue.questions.map(q => q.question),
    ...queue.answered.map(q => q.question),
  ]);

  let added = 0;
  for (const q of newQuestions) {
    if (!existingTexts.has(q.question)) {
      queue.questions.push({ ...q, generatedAt: new Date().toISOString() });
      added++;
    }
  }
  log(`[CURIOSITY] Generated ${added} new questions (${queue.questions.length} in queue)`);

  // 2. Pick highest priority unanswered question
  queue.questions.sort((a, b) => (b.priority || 0) - (a.priority || 0));
  const topQuestion = queue.questions[0];

  if (!topQuestion) {
    log("[CURIOSITY] No questions in queue");
    saveQueue(queue);
    return { questionsGenerated: added, researched: false };
  }

  log(`[CURIOSITY] Researching: "${topQuestion.question.slice(0, 80)}" (p=${topQuestion.priority})`);

  // 3. Research via deep-research
  const result = await deepResearch({
    question: topQuestion.question,
    context: `Curiosity-driven research. Domain: ${topQuestion.domain}. Source: ${topQuestion.source}. The system generated this question from gaps in its world model.`,
    origin: "curiosity-engine",
  }, { log, timeoutMs: 4 * 60 * 1000 });

  // 4. Move question to answered
  queue.questions = queue.questions.filter(q => q.question !== topQuestion.question);
  queue.answered.push({
    ...topQuestion,
    answeredAt: new Date().toISOString(),
    success: result.success,
    insight: result.insight?.slice(0, 300),
  });

  if (result.success) {
    log(`[CURIOSITY] Answer: ${result.opinion?.slice(0, 100) || result.insight?.slice(0, 100)}`);

    // 5. Integrate findings into world model
    try {
      const { integrateKnowledge } = await import("./world-model.mjs");
      await integrateKnowledge(db, result.insight, "curiosity-research", log);
    } catch (e) {
      log(`[CURIOSITY] Integration error: ${e.message}`);
    }

    // 6. Generate follow-up questions from findings
    const followUps = generateFollowUps(result, topQuestion);
    for (const q of followUps) {
      if (!existingTexts.has(q.question)) {
        queue.questions.push(q);
        log(`[CURIOSITY] Follow-up: "${q.question.slice(0, 60)}"`);
      }
    }

    // Store in narrative
    try {
      const { appendToThread } = await import("./narrative.mjs");
      appendToThread(db, `curiosity-${topQuestion.domain}`,
        `Researched: "${topQuestion.question.slice(0, 60)}". Finding: ${result.opinion?.slice(0, 100) || result.insight?.slice(0, 100)}`,
        log
      );
    } catch {}
  }

  queue.lastGenerated = new Date().toISOString();
  saveQueue(queue);

  return {
    questionsGenerated: added,
    researched: true,
    question: topQuestion.question,
    success: result.success,
    followUps: result.success ? generateFollowUps(result, topQuestion).length : 0,
  };
}

function generateFollowUps(researchResult, originalQuestion) {
  const followUps = [];

  // From gaps in research
  for (const gap of (researchResult.gaps || []).slice(0, 2)) {
    followUps.push({
      type: "follow-up",
      question: gap,
      domain: originalQuestion.domain,
      priority: originalQuestion.priority * 0.8,
      source: `follow-up from "${originalQuestion.question.slice(0, 40)}"`,
      generatedAt: new Date().toISOString(),
    });
  }

  // From actionable items
  for (const action of (researchResult.actionable || []).slice(0, 1)) {
    if (action.includes("?") || action.includes("test") || action.includes("verify")) {
      followUps.push({
        type: "follow-up",
        question: action,
        domain: originalQuestion.domain,
        priority: 0.7,
        source: `actionable from research`,
        generatedAt: new Date().toISOString(),
      });
    }
  }

  return followUps;
}

// ── FORMAT FOR BRAIN ──────────────────────────────────────────────────

export function formatCuriosityForBrain() {
  const queue = loadQueue();
  if (queue.questions.length === 0) return "Curiosity queue empty.";

  const top3 = queue.questions.slice(0, 3);
  return `Curiosity queue (${queue.questions.length} questions, ${queue.answered.length} answered):\n` +
    top3.map(q => `  [${q.type}] ${q.question.slice(0, 80)} (p=${q.priority})`).join("\n");
}

// ── GET QUEUE STATUS ──────────────────────────────────────────────────

export function getCuriosityStatus() {
  const queue = loadQueue();
  return {
    pending: queue.questions.length,
    answered: queue.answered.length,
    topQuestion: queue.questions[0]?.question || null,
    lastResearched: queue.answered[queue.answered.length - 1]?.answeredAt || null,
  };
}
