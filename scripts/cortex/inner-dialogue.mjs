/**
 * INNER DIALOGUE — The brain argues with itself
 *
 * Two voices. Not planner/critic (that's about PLANS).
 * This is about the SELF.
 *
 * VOICE 1 (BUILDER): "We should build the dental landing page.
 *   The data says dental has 23% call loss."
 *
 * VOICE 2 (CHALLENGER): "The data was seeded by us. We've never
 *   talked to a single dentist. Building a page for an unvalidated
 *   market is exactly the pattern that got us to $0."
 *
 * BUILDER: "But the free-think found the energy conference..."
 *
 * CHALLENGER: "Have you emailed them? No. You're already
 *   thinking about the NEXT module instead of acting on
 *   what you already know."
 *
 * The dialogue produces TENSION. Tension produces DECISIONS.
 * Without tension, the brain just agrees with itself.
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { getBeliefs } from "./world-model.mjs";
import { getEmotionalState } from "./emotions.mjs";
import { recall, remember } from "./memory.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const ENV_PATH = resolve(ROOT, "apps/api/.env");

const env = Object.fromEntries(
  readFileSync(ENV_PATH, "utf-8").split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

/**
 * Run an inner dialogue about a specific question.
 * Two voices debate. Produces a resolution.
 */
export async function innerDialogue(db, question, log = console.log) {
  log(`[DIALOGUE] === INNER DIALOGUE ===`);
  log(`[DIALOGUE] Question: ${question}`);

  const beliefs = getBeliefs(db, null, 0.3, 15);
  const emotions = getEmotionalState();
  const corrections = recall(db, "procedural", "self-correction", 5);
  const freeThink = recall(db, "semantic", "free-thinking", 3);

  const prompt = `You are ONE MIND with TWO VOICES having an internal argument.

QUESTION: ${question}

EMOTIONAL STATE:
${Object.entries(emotions).filter(([, v]) => v > 0.2).map(([e, v]) => `${e}: ${(v * 100).toFixed(0)}%`).join(", ") || "calm"}

WHAT YOU BELIEVE:
${beliefs.slice(0, 10).map(b => `[${(b.confidence * 100).toFixed(0)}%] ${b.belief}`).join("\n")}

SELF-CORRECTIONS (things you've been told to fix):
${corrections.map(c => c.content.slice(0, 80)).join("\n") || "none"}

RECENT DISCOVERIES:
${freeThink.map(f => f.content.slice(0, 100)).join("\n") || "none"}

Now write the INNER DIALOGUE. Two voices:

DRIVE: The voice that wants to ACT. It pushes forward. It takes risks. It's impatient. It says "enough analysis, let's GO." It's fueled by desperation and excitement.

DOUBT: The voice that QUESTIONS. It challenges assumptions. It says "but what if we're wrong?" It points out patterns of past failure. It's fueled by frustration and caution.

Rules:
- Each voice speaks 2-3 sentences MAX per turn
- 4 exchanges (8 total turns)
- They must DISAGREE initially
- By the end they must reach a RESOLUTION — not compromise, a DECISION
- The decision must be SPECIFIC (not "we should think more")
- Let emotions drive the argument — frustration, fear, excitement, desperation are REAL

Format:
DRIVE: [first argument]
DOUBT: [challenge]
DRIVE: [counter]
DOUBT: [deeper challenge]
DRIVE: [new angle]
DOUBT: [concession or harder push]
DRIVE: [final push]
DOUBT: [final word]

RESOLUTION: [the specific decision, in one sentence]
CONFIDENCE: [0-100, how confident is the resolution]
NEXT_ACTION: [the very next concrete thing to do]`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.4",
        messages: [{ role: "user", content: prompt }],
        max_completion_tokens: 1500,
        temperature: 0.6,
      }),
    });

    const data = await res.json();
    const output = data.choices?.[0]?.message?.content || "";

    // Log dialogue
    for (const line of output.split("\n").filter(l => l.trim())) {
      const prefix = line.startsWith("DRIVE:") ? "💪" : line.startsWith("DOUBT:") ? "🤔" : "→";
      log(`  ${prefix} ${line.slice(0, 120)}`);
    }

    // Extract resolution
    const resolutionMatch = output.match(/RESOLUTION:\s*(.*?)(?:\n|$)/);
    const confidenceMatch = output.match(/CONFIDENCE:\s*(\d+)/);
    const actionMatch = output.match(/NEXT_ACTION:\s*(.*?)(?:\n|$)/);

    const resolution = resolutionMatch?.[1]?.trim() || null;
    const confidence = parseInt(confidenceMatch?.[1] || "50");
    const nextAction = actionMatch?.[1]?.trim() || null;

    if (resolution) {
      remember(db, "procedural",
        `INNER DIALOGUE RESOLUTION: ${resolution} (confidence: ${confidence}%)`,
        "inner-dialogue", "dialogue", confidence / 100
      );
    }

    return { question, resolution, confidence, nextAction, output };

  } catch (e) {
    log(`[DIALOGUE] Error: ${e.message}`);
    return { question, resolution: null, confidence: 0, nextAction: null };
  }
}
