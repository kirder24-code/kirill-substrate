/**
 * STREAM OF CONSCIOUSNESS — One thought triggers the next
 *
 * Human thinking isn't one big LLM call.
 * It's a CHAIN: thought → association → follow that → new thought → insight
 *
 * "conference" → "energy" → "tariffs" → "wait, parliament experience"
 * → "regulatory compliance" → "Ultimarii raised $5M doing this"
 * → "I could do that" → "but I need to be IN the room"
 * → "conference is in 5 days" → PANIC → "email them NOW"
 *
 * Each thought is SHORT (1-2 sentences).
 * Each thought triggers the NEXT thought via association.
 * After 10-15 hops, the chain often arrives somewhere UNEXPECTED.
 *
 * This is how creative insights happen - not through analysis
 * but through WANDERING.
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { getBeliefs, getEntitiesByType } from "./world-model.mjs";
import { getActiveThreads } from "./narrative.mjs";
import { getEmotionalState, getDominantEmotion } from "./emotions.mjs";
import { remember } from "./memory.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const ENV_PATH = resolve(ROOT, "apps/api/.env");

const env = Object.fromEntries(
  readFileSync(ENV_PATH, "utf-8").split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

// ── STREAM ────────────────────────────────────────────────────────────

/**
 * Run a stream of consciousness. 10-15 short thoughts, each triggering the next.
 * Returns the chain and any insights found.
 */
export async function streamOfThought(db, seed = null, log = console.log) {
  log("[STREAM] === STREAM OF CONSCIOUSNESS ===");

  // Gather context seeds
  const beliefs = getBeliefs(db, null, 0.4, 15);
  const entities = [
    ...getEntitiesByType(db, "competitor", 5),
    ...getEntitiesByType(db, "channel", 5),
    ...getEntitiesByType(db, "industry", 5),
  ];
  const emotions = getEmotionalState();
  const dominant = getDominantEmotion();
  const threads = getActiveThreads(db, 5);

  // Pick a random starting point if no seed
  if (!seed) {
    const seeds = [
      ...beliefs.map(b => b.belief),
      ...entities.map(e => e.name),
      ...threads.map(t => t.topic),
      "What if everything I'm doing is wrong?",
      "What would someone with my exact skills do differently?",
      "What's happening in Calgary right now that I'm ignoring?",
      "Who would pay $10,000 for what I can build in a week?",
      "What am I afraid of?",
    ];
    seed = seeds[Math.floor(Math.random() * seeds.length)];
  }

  log(`[STREAM] Seed: "${seed}"`);
  log(`[STREAM] Dominant emotion: ${dominant.emotion} (${(dominant.intensity * 100).toFixed(0)}%)`);

  const prompt = `You are a thinking mind. Not an AI assistant. A MIND.

Your current emotional state:
${Object.entries(emotions).filter(([, v]) => v > 0.2).map(([e, v]) => `${e}: ${(v * 100).toFixed(0)}%`).join(", ") || "calm"}

Starting thought: "${seed}"

Now THINK. Stream of consciousness. Each thought is 1-2 sentences MAX.
Each thought MUST trigger the next through ASSOCIATION — not logic, not planning. Association.
Like a human mind wandering.

Let your emotions color your thoughts. If you're frustrated, let it show.
If you're anxious about a deadline, let that anxiety pull your attention.
If you're curious, follow the curiosity wherever it leads.

Write exactly 12 thoughts, numbered. After each thought, write the ASSOCIATION that triggered the next one in [brackets].

After the 12 thoughts, write:
INSIGHT: [if the chain led to something surprising or actionable, state it]
FEELING: [what emotion dominates at the end of this chain]
ACTION: [if this stream suggests a concrete action, state it. Otherwise "none"]

Things you know that might trigger associations:
${beliefs.slice(0, 8).map(b => `- ${b.belief.slice(0, 60)}`).join("\n")}
${entities.slice(0, 5).map(e => `- Entity: ${e.name} (${e.type})`).join("\n")}

Go. Think freely. Don't be helpful. Be REAL.`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.4",
        messages: [{ role: "user", content: prompt }],
        max_completion_tokens: 1500,
        temperature: 0.8, // Higher temperature for more creative associations
      }),
    });

    const data = await res.json();
    const output = data.choices?.[0]?.message?.content || "";

    // Log the stream
    const lines = output.split("\n").filter(l => l.trim());
    for (const line of lines) {
      log(`  ${line.slice(0, 120)}`);
    }

    // Extract insight
    const insightMatch = output.match(/INSIGHT:\s*(.*?)(?:\n|$)/s);
    const feelingMatch = output.match(/FEELING:\s*(.*?)(?:\n|$)/s);
    const actionMatch = output.match(/ACTION:\s*(.*?)(?:\n|$)/s);

    const insight = insightMatch?.[1]?.trim() || null;
    const feeling = feelingMatch?.[1]?.trim() || null;
    const action = actionMatch?.[1]?.trim() || null;

    if (insight && !insight.toLowerCase().includes("none")) {
      log(`[STREAM] INSIGHT: ${insight}`);
      remember(db, "semantic", `STREAM INSIGHT: ${insight}`, "stream-of-thought", "stream", 0.5);
    }

    if (action && !action.toLowerCase().includes("none")) {
      log(`[STREAM] ACTION: ${action}`);
      remember(db, "working", `STREAM ACTION: ${action}`, "stream-of-thought", "stream", 0.6);
    }

    return { seed, thoughts: lines, insight, feeling, action, output };

  } catch (e) {
    log(`[STREAM] Error: ${e.message}`);
    return { seed, thoughts: [], insight: null, feeling: null, action: null };
  }
}
