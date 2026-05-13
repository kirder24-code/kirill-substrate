/**
 * CORTEX DREAMS — Memory consolidation during idle
 *
 * When a human sleeps, the brain does NOT shut off.
 * It REPLAYS the day. Rapidly. Over and over.
 * During replay, it does three things:
 *
 * 1. PATTERN EXTRACTION — "In the last 3 days, everything with
 *    specific pain framing got further than generic messaging."
 *    The day's noise → one crisp rule.
 *
 * 2. CONSOLIDATION — Short-term memories merge into long-term beliefs.
 *    "HVAC reply on Tuesday" + "HVAC like on Thursday" + "HVAC demo Friday"
 *    → "HVAC is a validated vertical" (high-confidence belief)
 *
 * 3. PRUNING — Noise gets discarded. Irrelevant events fade.
 *    "Checked bot health at 3pm, all normal" → deleted.
 *    Brain only keeps what matters.
 *
 * Subconscious = random creative collisions (any time).
 * Dreams = systematic consolidation (during idle/night).
 *
 * Without dreams:
 *   Memory fills with noise. Every "checked health, all ok" persists.
 *   Patterns that span multiple days are never detected.
 *   Brain treats day-1 event and day-5 event as unrelated.
 *
 * With dreams:
 *   Overnight, brain reviews ALL recent memories.
 *   Extracts 3-5 patterns. Promotes them to beliefs.
 *   Marks noise as outdated. Wakes up SMARTER.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { recall, remember } from "./memory.mjs";
import { addBelief, getBeliefs } from "./world-model.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const ENV_PATH = resolve(ROOT, "apps/api/.env");
const DREAM_PATH = resolve(ROOT, ".data/cortex-dreams.json");

const env = Object.fromEntries(
  readFileSync(ENV_PATH, "utf-8").split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

// ── STATE ────────────────────────────────────────────────────────────────

function loadState() {
  if (!existsSync(DREAM_PATH)) {
    return {
      lastDreamAt: null,
      dreamCount: 0,
      consolidatedPatterns: [],
      prunedCount: 0,
      stats: {
        totalPatterns: 0,
        totalPruned: 0,
        totalConsolidated: 0,
      },
    };
  }
  try { return JSON.parse(readFileSync(DREAM_PATH, "utf-8")); }
  catch { return loadState(); }
}

function saveState(state) {
  if (state.consolidatedPatterns.length > 50) {
    state.consolidatedPatterns = state.consolidatedPatterns.slice(-50);
  }
  writeFileSync(DREAM_PATH, JSON.stringify(state, null, 2));
}

// ── SHOULD DREAM? ───────────────────────────────────────────────────────

/**
 * Dreams should run:
 * - At most once per 6 hours
 * - Preferably during idle (night, or long gaps)
 * - When there's enough new material (5+ recent memories)
 */
export function shouldDream() {
  const state = loadState();
  if (!state.lastDreamAt) return true; // Never dreamed

  const hoursSince = (Date.now() - new Date(state.lastDreamAt).getTime()) / 3_600_000;
  return hoursSince >= 6;
}

// ── DREAM CYCLE ─────────────────────────────────────────────────────────

/**
 * Run a full dream cycle. This is the main function.
 * 1. Gather recent memories (last 24-48h)
 * 2. LLM extracts patterns, consolidations, and noise markers
 * 3. Apply: new beliefs, merged memories, pruned noise
 *
 * @param {object} db - database
 * @param {function} log
 * @returns {{ patterns: number, consolidated: number, pruned: number, insights: array }}
 */
export async function dream(db, log = console.log) {
  if (!shouldDream()) {
    log("[DREAMS] Too soon since last dream. Skipping.");
    return { patterns: 0, consolidated: 0, pruned: 0, insights: [] };
  }

  log("[DREAMS] Entering dream cycle...");
  const state = loadState();

  // 1. GATHER: all recent memories (last 48h)
  const episodic = recall(db, "episodic", null, 50);
  const procedural = recall(db, "procedural", null, 20);
  const working = recall(db, "working", null, 10);
  const beliefs = getBeliefs(db, null, 0.3, 30);

  const allRecent = [...episodic, ...procedural, ...working]
    .filter(m => {
      const age = Date.now() - new Date(m.created_at).getTime();
      return age < 48 * 3600 * 1000; // Last 48 hours
    })
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  if (allRecent.length < 5) {
    log("[DREAMS] Not enough recent memories to dream about. Need 5+, have " + allRecent.length);
    state.lastDreamAt = new Date().toISOString();
    saveState(state);
    return { patterns: 0, consolidated: 0, pruned: 0, insights: [] };
  }

  log(`[DREAMS] Replaying ${allRecent.length} memories...`);

  // 2. LLM DREAM: extract patterns, consolidate, identify noise
  const memoryDump = allRecent.map((m, i) =>
    `[${i}] [${m.type}] ${m.created_at}: ${m.content}`
  ).join("\n");

  const beliefDump = beliefs.slice(0, 15).map(b =>
    `[${(b.confidence * 100).toFixed(0)}%] ${b.belief}`
  ).join("\n");

  const prompt = `You are a dreaming brain. You are replaying the last 48 hours of memories.
Your job is NOT to plan or decide. Your job is to CONSOLIDATE.

RECENT MEMORIES (${allRecent.length}):
${memoryDump}

CURRENT BELIEFS:
${beliefDump}

Do three things:

1. PATTERNS — What recurring themes span multiple memories?
   Not obvious ones. HIDDEN patterns. Things that connect events
   from different times/contexts but share a deeper signal.
   "Every time we tried X, Y happened" or "Z keeps appearing across unrelated events"

2. CONSOLIDATIONS — Which separate memories should merge into one rule/belief?
   "3 separate HVAC interactions all showed interest" → "HVAC is a validated vertical"
   Short-term events → long-term knowledge.

3. NOISE — Which memories have ZERO future value? Things like:
   "Checked health, all normal", "Ran cycle, nothing happened", "No new leads found"
   These waste memory space. Mark them for pruning.

Return JSON:
{
  "patterns": [
    {"pattern": "description of recurring pattern", "evidence": [0, 3, 7], "confidence": 0.7, "implication": "what this means for future action"}
  ],
  "consolidations": [
    {"merged_from": [1, 4, 9], "into": "single belief/rule that captures all three", "confidence": 0.6}
  ],
  "noise_indices": [2, 5, 8, 12],
  "dream_insight": "The single most important thing the brain should realize from replaying these memories. One sentence."
}`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5.4-mini",
        messages: [
          { role: "system", content: "You are a dreaming brain. Extract patterns, consolidate memories, identify noise. Be honest — most events are noise. Only flag real patterns." },
          { role: "user", content: prompt },
        ],
        max_completion_tokens: 2000,
        temperature: 0.4,
        response_format: { type: "json_object" },
      }),
    });

    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) {
      log("[DREAMS] LLM returned empty. Dream failed.");
      return { patterns: 0, consolidated: 0, pruned: 0, insights: [] };
    }

    const dreamResult = JSON.parse(raw);

    // 3. APPLY PATTERNS → new beliefs
    const insights = [];
    for (const pattern of (dreamResult.patterns || [])) {
      addBelief(db, "dream",
        `DREAM PATTERN: ${pattern.pattern}. Implication: ${pattern.implication || "unknown"}`,
        pattern.confidence || 0.5,
        (pattern.evidence || []).map(i => allRecent[i]?.content?.slice(0, 60) || `memory #${i}`),
        "dreams"
      );
      state.consolidatedPatterns.push({
        pattern: pattern.pattern,
        implication: pattern.implication,
        confidence: pattern.confidence,
        dreamedAt: new Date().toISOString(),
      });
      state.stats.totalPatterns++;
      insights.push(pattern.pattern);
      log(`[DREAMS] Pattern: ${pattern.pattern.slice(0, 80)}`);
    }

    // 4. APPLY CONSOLIDATIONS → merged beliefs
    for (const cons of (dreamResult.consolidations || [])) {
      addBelief(db, "consolidated",
        cons.into,
        cons.confidence || 0.6,
        (cons.merged_from || []).map(i => allRecent[i]?.content?.slice(0, 60) || `memory #${i}`),
        "dreams"
      );
      state.stats.totalConsolidated++;
      log(`[DREAMS] Consolidated: ${cons.into.slice(0, 80)}`);
    }

    // 5. PRUNE NOISE → mark as outdated
    let pruned = 0;
    for (const idx of (dreamResult.noise_indices || [])) {
      if (idx >= 0 && idx < allRecent.length) {
        const mem = allRecent[idx];
        try {
          db.prepare(
            "UPDATE cortex_memory SET outdated = 1, outdated_reason = 'dream-pruned: noise' WHERE id = ?"
          ).run(mem.id);
          pruned++;
        } catch {}
      }
    }
    state.stats.totalPruned += pruned;
    state.prunedCount = pruned;
    log(`[DREAMS] Pruned ${pruned} noise memories`);

    // 6. DREAM INSIGHT → store as special memory
    if (dreamResult.dream_insight) {
      remember(db, "episodic",
        `DREAM INSIGHT: ${dreamResult.dream_insight}`,
        "dream", "dreams"
      );
      insights.push(dreamResult.dream_insight);
      log(`[DREAMS] INSIGHT: ${dreamResult.dream_insight}`);
    }

    state.lastDreamAt = new Date().toISOString();
    state.dreamCount++;
    saveState(state);

    return {
      patterns: (dreamResult.patterns || []).length,
      consolidated: (dreamResult.consolidations || []).length,
      pruned,
      insights,
      dreamInsight: dreamResult.dream_insight,
    };

  } catch (e) {
    log(`[DREAMS] Error: ${e.message}`);
    state.lastDreamAt = new Date().toISOString();
    saveState(state);
    return { patterns: 0, consolidated: 0, pruned: 0, insights: [], error: e.message };
  }
}

// ── FORMAT FOR BRAIN CONTEXT ────────────────────────────────────────────

export function formatDreamsForBrain() {
  const state = loadState();

  if (state.dreamCount === 0) {
    return "DREAMS: No dream cycles yet. Memory consolidation not started.";
  }

  const recent = state.consolidatedPatterns.slice(-5);
  const parts = [`DREAM MEMORY (${state.dreamCount} dreams, ${state.stats.totalPatterns} patterns found, ${state.stats.totalPruned} noise pruned):`];

  if (recent.length > 0) {
    parts.push("Recent dream patterns:");
    for (const p of recent) {
      parts.push(`  - [${(p.confidence * 100).toFixed(0)}%] ${p.pattern.slice(0, 100)}`);
      if (p.implication) parts.push(`    → ${p.implication.slice(0, 80)}`);
    }
  }

  const hoursSince = state.lastDreamAt
    ? Math.round((Date.now() - new Date(state.lastDreamAt).getTime()) / 3_600_000)
    : 999;
  parts.push(`Last dream: ${hoursSince}h ago. ${state.stats.totalConsolidated} memories consolidated into beliefs.`);

  return parts.join("\n");
}

// ── STANDALONE TEST ─────────────────────────────────────────────────────

if (process.argv[1] && process.argv[1].includes("dreams.mjs")) {
  const { initMemory } = await import("./memory.mjs");
  const { initWorldModel } = await import("./world-model.mjs");
  const { initNarrative } = await import("./narrative.mjs");

  const db = initMemory();
  initNarrative(db);
  initWorldModel(db);

  console.log("=== DREAM CYCLE TEST ===\n");
  console.log("Should dream:", shouldDream());

  const result = await dream(db, console.log);
  console.log("\nDream result:", JSON.stringify(result, null, 2));
  console.log("\nBrain context:");
  console.log(formatDreamsForBrain());
}
