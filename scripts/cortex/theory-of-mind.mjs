/**
 * THEORY OF MIND — Model the other person's mind
 *
 * When a human writes an email, they THINK about the reader:
 * "This HVAC owner wakes up at 6am. Gets 50 spam emails before coffee.
 *  He doesn't care about 'AI'. He cares that his phone rang at 2am
 *  and nobody answered and the customer called his competitor instead.
 *  He lost $3,000. THAT's what I lead with."
 *
 * Our brain doesn't do this. It writes outreach from ITS perspective,
 * not the READER's perspective.
 *
 * Theory of Mind builds a mental model of the recipient before
 * any outreach is drafted. It answers:
 * - What does this person's day look like?
 * - What emails do they get? What do they delete?
 * - What problem keeps them up at night?
 * - What language do they use? (not "AI automation" — "missed calls")
 * - What would make them STOP SCROLLING and actually read?
 * - What would make them RESPOND?
 * - What would make them TRUST a stranger?
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { getEntity, getBeliefs, upsertEntity } from "./world-model.mjs";
import { remember } from "./memory.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const ENV_PATH = resolve(ROOT, "apps/api/.env");

const env = Object.fromEntries(
  readFileSync(ENV_PATH, "utf-8").split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

/**
 * Build a mental model of a specific person or persona.
 * Used before drafting outreach.
 *
 * @param {object} db
 * @param {object} persona - { role, industry, location, context }
 * @returns {object} mental model of the person
 */
export async function modelMind(db, persona, log = console.log) {
  log(`[THEORY-OF-MIND] Modeling: ${persona.role} in ${persona.industry}`);

  const beliefs = getBeliefs(db, null, 0.4, 10);
  const industryEntity = getEntity(db, "industry", persona.industry);

  const prompt = `You are building a MENTAL MODEL of a specific person. Not demographics. Their INNER WORLD.

WHO:
- Role: ${persona.role || "business owner"}
- Industry: ${persona.industry || "unknown"}
- Location: ${persona.location || "Calgary, Canada"}
- Context: ${persona.context || "small business, <20 employees"}

WHAT YOU KNOW ABOUT THEIR INDUSTRY:
${industryEntity ? JSON.stringify(industryEntity.properties) : "limited data"}
${beliefs.filter(b => b.belief.toLowerCase().includes(persona.industry?.toLowerCase() || "???")).map(b => b.belief).join("\n") || "no specific beliefs"}

Build their mental model. Think like a method actor preparing for a role:

1. THEIR DAY: What does a typical Tuesday look like? When do they check email? When are they busy? When are they stressed?

2. THEIR INBOX: How many emails do they get? How many are spam/sales? What makes them open vs delete? What subject lines work on THEM?

3. THEIR PAIN: What keeps them up at night? Not what WE think their pain is - what THEY would say if you asked them over a beer. In THEIR words.

4. THEIR LANGUAGE: What words do they use? They don't say "AI automation" - they say what? "I need someone to answer the damn phone." "We're losing jobs because we can't call people back fast enough."

5. THEIR TRUST: What would make them trust a cold email from a stranger? What would make them immediately delete it? What signals credibility to them?

6. THEIR TRIGGER: What specific moment would make them think "I need to solve this NOW"? A missed call from a big client? A bad Google review? A competitor getting the job?

7. THE PERFECT MESSAGE: Given everything above, what would make them STOP and READ and REPLY? Not what we want to say - what THEY need to hear.

Return JSON:
{
  "persona_summary": "1-2 sentence vivid description of this person",
  "daily_routine": "their typical day in 3-4 sentences",
  "inbox_behavior": "how they handle email",
  "pain_in_their_words": "what they would say about their problem",
  "language_they_use": ["phrases they actually use"],
  "trust_signals": ["what makes them trust"],
  "delete_signals": ["what makes them delete/ignore"],
  "trigger_moment": "the specific moment they'd buy",
  "perfect_opening": "the first sentence of a message they'd actually read",
  "perfect_subject": "email subject line they'd open",
  "emotional_state": "how they feel about their business right now"
}`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.4",
        messages: [{ role: "user", content: prompt }],
        max_completion_tokens: 1500,
        temperature: 0.5,
        response_format: { type: "json_object" },
      }),
    });

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;

    const model = JSON.parse(content);

    log(`[THEORY-OF-MIND] Persona: ${model.persona_summary?.slice(0, 80)}`);
    log(`[THEORY-OF-MIND] Pain: ${model.pain_in_their_words?.slice(0, 80)}`);
    log(`[THEORY-OF-MIND] Perfect opening: ${model.perfect_opening?.slice(0, 80)}`);
    log(`[THEORY-OF-MIND] Trigger: ${model.trigger_moment?.slice(0, 80)}`);

    // Store the persona model in world model
    upsertEntity(db, "persona", `${persona.role}-${persona.industry}`, {
      ...model,
      language_they_use: model.language_they_use?.join("; "),
      trust_signals: model.trust_signals?.join("; "),
      delete_signals: model.delete_signals?.join("; "),
    }, "theory-of-mind");

    // Store key insights
    if (model.pain_in_their_words) {
      remember(db, "semantic",
        `THEIR WORDS (${persona.industry} ${persona.role}): "${model.pain_in_their_words}"`,
        "theory-of-mind", "theory-of-mind", 0.6
      );
    }

    return model;

  } catch (e) {
    log(`[THEORY-OF-MIND] Error: ${e.message}`);
    return null;
  }
}

/**
 * Format a persona model for use in outreach drafting.
 */
export function formatPersonaForOutreach(model) {
  if (!model) return "";

  return `RECIPIENT MENTAL MODEL:
${model.persona_summary}
Pain (in their words): ${model.pain_in_their_words}
They open emails with: ${model.perfect_subject}
They respond to: ${model.perfect_opening}
Trust signals: ${model.trust_signals?.join(", ")}
Delete signals: ${model.delete_signals?.join(", ")}
Trigger moment: ${model.trigger_moment}
Emotional state: ${model.emotional_state}
LANGUAGE THEY USE: ${model.language_they_use?.join(" | ")}

USE THEIR LANGUAGE. NOT YOURS.`;
}
