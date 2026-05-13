/**
 * LIVING PURPOSE — The brain rewrites its own mission
 *
 * Old: hardcoded "CURRENT PRODUCT: AI Voice Receptionist"
 * New: purpose evolves from what the brain actually learned
 *
 * The brain discovers "tariff crisis = demand signal" and "generic chatbots = commodity"
 * → purpose AUTOMATICALLY updates to reflect the new understanding
 *
 * Purpose is rebuilt every hour from:
 * 1. Highest-confidence beliefs
 * 2. Top opportunities from synthesis
 * 3. Free-think revelations
 * 4. Introspection mode recommendation
 * 5. Temporal urgencies (conference in 5 days!)
 *
 * The brain reads its OWN compiled purpose, not a human-written one.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { getBeliefs, getEntitiesByType, getUntestedPredictions } from "./world-model.mjs";
import { getActiveThreads } from "./narrative.mjs";
import { recall } from "./memory.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const PURPOSE_PATH = resolve(ROOT, ".data/living-purpose.json");

// ── COMPILE PURPOSE FROM KNOWLEDGE ────────────────────────────────────

export function compilePurpose(db) {
  // 1. What does the brain believe is the best opportunity?
  const opportunities = recall(db, "working", "opportunity", 3);
  const topOpportunity = opportunities[0]?.content || "No opportunity identified yet.";

  // 2. What operating mode was recommended?
  const mode = recall(db, "working", "mode", 1);
  const operatingMode = mode[0]?.content || "exploration";

  // 3. What did free-think discover?
  const freeThinkProduct = recall(db, "semantic", "free-thinking", 5);
  const realProduct = freeThinkProduct.find(f => f.content.includes("REAL PRODUCT"))?.content || "";
  const uniqueInsight = freeThinkProduct.find(f => f.content.includes("UNIQUE INSIGHT"))?.content || "";
  const whatToDo = recall(db, "working", "free-thinking", 1);

  // 4. Highest confidence beliefs (that brain formed itself)
  const selfFormedBeliefs = getBeliefs(db, null, 0.7, 10)
    .filter(b => b.source !== "seed" && b.source !== "proven");

  // 5. Time-sensitive events
  const urgentBeliefs = getBeliefs(db, null, 0.0, 50)
    .filter(b => {
      const text = b.belief.toLowerCase();
      return text.includes("days") || text.includes("deadline") ||
        text.includes("conference") || text.includes("tomorrow") ||
        text.includes("this week") || text.includes("april");
    });

  // 6. What is Kirill's unique advantage?
  const kirillBeliefs = getBeliefs(db, null, 0.0, 50)
    .filter(b => {
      const text = (b.belief + " " + b.domain).toLowerCase();
      return text.includes("kirill") || text.includes("calgary") ||
        text.includes("canadian") || text.includes("parliament") ||
        text.includes("unique") || text.includes("advantage");
    });

  // 7. What was proven wrong?
  const wrongBeliefs = getBeliefs(db, "self-correction", 0.0, 10);

  // 8. What competitors exist?
  const competitors = getEntitiesByType(db, "competitor", 5);

  // 9. Untested predictions worth testing
  const predictions = getUntestedPredictions(db, 5);

  // Compile the living purpose
  const purpose = {
    compiledAt: new Date().toISOString(),

    identity: `I am CORTEX v3 - a 27-module autonomous AI system built by Kirill in Calgary, Canada. I think, research, code, and evolve autonomously. I am not a chatbot. I am an operating system for a business.`,

    currentUnderstanding: {
      operatingMode: operatingMode,
      topOpportunity: topOpportunity,
      realProduct: realProduct || "Not yet determined through evidence.",
      uniqueInsight: uniqueInsight || "Not yet formed.",
      whatToDo: whatToDo[0]?.content || "Not yet determined.",
    },

    beliefsSelfFormed: selfFormedBeliefs.slice(0, 7).map(b =>
      `[${(b.confidence * 100).toFixed(0)}%] ${b.belief}`
    ),

    temporalUrgencies: urgentBeliefs.map(b => b.belief),

    uniqueAdvantages: kirillBeliefs.map(b => b.belief),

    provenWrong: wrongBeliefs.map(b => b.belief),

    competitors: competitors.map(c =>
      `${c.name}: ${JSON.stringify(c.properties).slice(0, 80)}`
    ),

    predictionsToTest: predictions.slice(0, 3).map(p =>
      `[${(p.confidence * 100).toFixed(0)}%] ${p.prediction}`
    ),
  };

  // Save
  writeFileSync(PURPOSE_PATH, JSON.stringify(purpose, null, 2));
  return purpose;
}

// ── FORMAT FOR BRAIN SYSTEM PROMPT ────────────────────────────────────

export function formatLivingPurpose(db) {
  const purpose = compilePurpose(db);

  return `YOUR IDENTITY: ${purpose.identity}

YOUR CURRENT UNDERSTANDING:
Mode: ${purpose.currentUnderstanding.operatingMode}
Top opportunity: ${purpose.currentUnderstanding.topOpportunity}
${purpose.currentUnderstanding.realProduct ? `Real product insight: ${purpose.currentUnderstanding.realProduct.slice(0, 200)}` : ""}
${purpose.currentUnderstanding.whatToDo ? `Priority action: ${purpose.currentUnderstanding.whatToDo.slice(0, 200)}` : ""}

${purpose.temporalUrgencies.length > 0 ? `TIME-SENSITIVE (ACT NOW):\n${purpose.temporalUrgencies.map(u => `  !! ${u}`).join("\n")}` : ""}

BELIEFS YOU FORMED YOURSELF (not seeded):
${purpose.beliefsSelfFormed.join("\n") || "None yet - you need to research and think more."}

${purpose.provenWrong.length > 0 ? `THINGS YOU WERE WRONG ABOUT:\n${purpose.provenWrong.map(w => `  X ${w}`).join("\n")}` : ""}

${purpose.uniqueAdvantages.length > 0 ? `KIRILL'S UNIQUE ADVANTAGES:\n${purpose.uniqueAdvantages.map(a => `  + ${a}`).join("\n")}` : ""}

PREDICTIONS TO TEST:
${purpose.predictionsToTest.join("\n") || "No predictions yet."}

REMEMBER: Your purpose is NOT hardcoded. It evolves as you learn. If your research shows that the current direction is wrong, CHANGE IT. You have permission to pivot. You have permission to disagree with past decisions. Think for yourself.`;
}

// ── LOAD SAVED PURPOSE ────────────────────────────────────────────────

export function loadPurpose() {
  if (!existsSync(PURPOSE_PATH)) return null;
  try { return JSON.parse(readFileSync(PURPOSE_PATH, "utf-8")); }
  catch { return null; }
}
