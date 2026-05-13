/**
 * CORTEX SUBCONSCIOUS — Random connections during idle time
 *
 * When the brain is idle (nothing to do, no signals), it doesn't stop.
 * It randomly picks two UNRELATED things from the world model
 * and asks: "Is there a connection?"
 *
 * Most of the time: no.
 * Sometimes: "Wait... tariffs + parliament background + energy conference
 *   = Kirill could position as policy-to-AI translator for energy companies"
 *
 * This is how creative breakthroughs happen.
 * Not through analysis. Through random collisions.
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { getBeliefs, getEntitiesByType, addBelief } from "./world-model.mjs";
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
 * Pick two random, unrelated items from the world model.
 * Ask if there's a connection.
 * If yes — that's an insight. Store it.
 */
export async function subconsciousConnect(db, log = console.log) {
  // Gather all knowledge items
  const items = [];

  for (const b of getBeliefs(db, null, 0.3, 30)) {
    items.push({ type: "belief", text: b.belief, domain: b.domain });
  }
  for (const type of ["competitor", "channel", "industry", "product"]) {
    for (const e of getEntitiesByType(db, type, 10)) {
      items.push({ type: e.type, text: `${e.name}: ${JSON.stringify(e.properties).slice(0, 80)}`, domain: type });
    }
  }

  if (items.length < 4) {
    log("[SUBCONSCIOUS] Not enough items for random connection");
    return null;
  }

  // Pick two UNRELATED items (different domains)
  let a, b_item;
  let attempts = 0;
  do {
    a = items[Math.floor(Math.random() * items.length)];
    b_item = items[Math.floor(Math.random() * items.length)];
    attempts++;
  } while (a.domain === b_item.domain && attempts < 20);

  if (a.text === b_item.text) return null;

  log(`[SUBCONSCIOUS] Connecting: "${a.text.slice(0, 40)}" + "${b_item.text.slice(0, 40)}"`);

  const prompt = `You are the subconscious mind. Two random items collided:

ITEM A [${a.type}]: ${a.text}
ITEM B [${b_item.type}]: ${b_item.text}

Is there a meaningful, non-obvious connection between these two things?
Not a forced connection. A REAL one that could lead to an insight or opportunity.

If YES: explain the connection in 1-2 sentences and rate it 1-10 (10 = breakthrough).
If NO: just say "no connection" and nothing else.

Be honest. Most random collisions produce nothing. Only flag real connections.`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.4-mini",
        messages: [{ role: "user", content: prompt }],
        max_completion_tokens: 200,
        temperature: 0.7,
      }),
    });

    const data = await res.json();
    const output = data.choices?.[0]?.message?.content || "";

    if (output.toLowerCase().includes("no connection")) {
      log("[SUBCONSCIOUS] No connection found. (This is normal.)");
      return null;
    }

    // Found a connection!
    const ratingMatch = output.match(/(\d+)\s*\/?\s*10/);
    const rating = parseInt(ratingMatch?.[1] || "3");

    if (rating >= 5) {
      log(`[SUBCONSCIOUS] CONNECTION (${rating}/10): ${output.slice(0, 100)}`);

      addBelief(db, "subconscious",
        `SUBCONSCIOUS CONNECTION: ${a.text.slice(0, 40)} + ${b_item.text.slice(0, 40)} = ${output.slice(0, 150)}`,
        rating / 10, [`random collision between ${a.type} and ${b_item.type}`], "subconscious"
      );

      remember(db, "semantic",
        `SUBCONSCIOUS: ${output.slice(0, 200)}`,
        "subconscious", "subconscious", rating / 10
      );

      return { itemA: a, itemB: b_item, connection: output, rating };
    }

    log(`[SUBCONSCIOUS] Weak connection (${rating}/10), discarded.`);
    return null;

  } catch (e) {
    log(`[SUBCONSCIOUS] Error: ${e.message}`);
    return null;
  }
}
