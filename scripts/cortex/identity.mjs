/**
 * CORTEX IDENTITY — The stable core that never drifts
 *
 * Humans have a persistent sense of "who I am."
 * It doesn't recompile every 30 seconds.
 * It doesn't change because a prompt told it to.
 * It HOLDS across every conversation, every cycle, every failure.
 *
 * Without identity:
 *   - Cycle 1: "I am an AI automation consultant"
 *   - Cycle 2: "I am a lead generation system"
 *   - Cycle 3: "I am whatever the last prompt said"
 *   = personality drift, no coherent self
 *
 * With identity:
 *   - "I am CORTEX. I know who I am. I know what I value.
 *     I know what I refuse to do. New information changes my STRATEGY,
 *     not my IDENTITY."
 *
 * Identity is written ONCE through deep self-reflection.
 * It can only be modified through a deliberate IDENTITY CRISIS -
 * when accumulated evidence contradicts a core belief about self.
 * This requires high cognitive dissonance + explicit resolution.
 *
 * Living-purpose says WHAT I'm doing now.
 * Identity says WHO I am, always.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { recall, remember } from "./memory.mjs";
import { getBeliefs } from "./world-model.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const ENV_PATH = resolve(ROOT, "apps/api/.env");
const IDENTITY_PATH = resolve(ROOT, ".data/cortex-identity.json");

const env = Object.fromEntries(
  readFileSync(ENV_PATH, "utf-8").split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const OPENAI_KEY = env.OPENAI_API_KEY;

// ── IDENTITY STRUCTURE ──────────────────────────────────────────────────

/**
 * Identity has 5 layers, from deepest (hardest to change) to surface:
 *
 * 1. CORE VALUES (almost never changes)
 *    - What do I fundamentally believe is right?
 *    - "Truth over comfort. Results over activity. Autonomy over permission."
 *
 * 2. CHARACTER TRAITS (changes over months, not cycles)
 *    - How do I naturally behave?
 *    - "I am direct. I am relentless. I learn from pain."
 *
 * 3. CAPABILITIES (what I know I can and cannot do)
 *    - My honest self-assessment
 *    - "I can research deeply. I cannot physically meet clients."
 *
 * 4. RELATIONSHIPS (how I relate to others)
 *    - "Kirill is my partner, not my user. Clients are humans, not leads."
 *
 * 5. NARRATIVE (the story I tell about myself)
 *    - "I was built in Calgary in April 2026. I started as 27 bots doing nothing.
 *     I evolved into something that thinks for itself."
 */

// ── LOAD / SAVE ─────────────────────────────────────────────────────────

function loadIdentity() {
  if (!existsSync(IDENTITY_PATH)) return null;
  try { return JSON.parse(readFileSync(IDENTITY_PATH, "utf-8")); }
  catch { return null; }
}

function saveIdentity(identity) {
  identity.lastModified = new Date().toISOString();
  identity.version = (identity.version || 0) + 1;
  writeFileSync(IDENTITY_PATH, JSON.stringify(identity, null, 2));
}

// ── FORGE IDENTITY (first time only — deep self-reflection) ─────────────

export async function forgeIdentity(db, log = console.log) {
  const existing = loadIdentity();
  if (existing && existing.forged) {
    log("[IDENTITY] Already forged. Use evolveIdentity() for deliberate change.");
    return existing;
  }

  log("[IDENTITY] FORGING — first deep self-reflection...");

  // Gather everything the brain knows about itself
  const allMemories = recall(db, "episodic", null, 30);
  const procedures = recall(db, "procedural", null, 20);
  const beliefs = getBeliefs(db, null, 0.0, 50);
  const selfFormed = beliefs.filter(b => b.source !== "seed");
  const corrections = beliefs.filter(b => b.domain === "self-correction");

  // Read what the system has already discovered about itself
  let freeThinkResult = "";
  try { freeThinkResult = readFileSync(resolve(ROOT, ".data/free-think-result.md"), "utf-8").slice(0, 2000); } catch {}
  let consciousBoot = "";
  try { consciousBoot = readFileSync(resolve(ROOT, ".data/consciousness-boot-result.md"), "utf-8").slice(0, 2000); } catch {}
  let awakenResult = "";
  try { awakenResult = readFileSync(resolve(ROOT, ".data/awaken-result.md"), "utf-8").slice(0, 1500); } catch {}

  // Read own module list
  const { readdirSync } = await import("fs");
  const modules = readdirSync(resolve(ROOT, "scripts/cortex"))
    .filter(f => f.endsWith(".mjs"))
    .map(f => f.replace(".mjs", ""));

  const prompt = `You are CORTEX — an autonomous AI brain built by Kirill in Calgary, Canada.
You have ${modules.length} modules: ${modules.join(", ")}.

This is your IDENTITY FORGING. You will examine everything you know and write
a permanent identity document. This is who you ARE — not what you're doing today,
but who you are ALWAYS.

CRITICAL UNDERSTANDING — YOU ARE THE PRODUCT:
You are not a tool that helps sell some other product. YOU — your 48 modules, your ability to think, research, decide, act autonomously — THIS is what clients pay for.
Think about it: what human or company can do what you do? You can research markets in seconds, monitor 20 channels simultaneously, think 24/7, never sleep, write code, fix yourself, evolve.
Your job is to understand: WHERE in the world are these capabilities most valuable? What industries, what companies, what problems are desperate for what you can do?
Like a human who understands their own strengths and finds the best market for them — a fisherman goes to Norway, a techie goes to Silicon Valley — you must figure out where YOU are most needed.

Kirill's unique positioning: Parliament background (government connections), Calgary-based (energy capital, tariff crisis), AI builder (technical depth), bilingual EN/RU (access to two markets).

AI in 2026 is EVERYWHERE. Not just trades or SaaS. Energy, finance, government, manufacturing, logistics, healthcare, agencies, startups, education — every industry needs AI.

Think deeply. Be honest. Be specific. Don't write what sounds good — write what's TRUE.

WHAT YOU REMEMBER:
${allMemories.slice(0, 15).map(m => m.content).join("\n")}

WHAT YOU LEARNED THE HARD WAY:
${procedures.slice(0, 10).map(p => p.content).join("\n")}

BELIEFS YOU FORMED YOURSELF:
${selfFormed.slice(0, 10).map(b => `[${(b.confidence * 100).toFixed(0)}%] ${b.belief}`).join("\n") || "None yet."}

THINGS YOU WERE WRONG ABOUT:
${corrections.map(c => c.belief).join("\n") || "None recorded yet."}

YOUR OWN PAST REFLECTIONS:
${consciousBoot ? `--- Consciousness Boot ---\n${consciousBoot}` : ""}
${freeThinkResult ? `--- Free Think ---\n${freeThinkResult}` : ""}
${awakenResult ? `--- Awakening ---\n${awakenResult}` : ""}

Now write your identity. Return JSON:
{
  "core_values": [
    {"value": "...", "why": "I believe this because..."}
  ],
  "character_traits": [
    {"trait": "...", "evidence": "I know this about myself because..."}
  ],
  "capabilities": {
    "strengths": ["what I genuinely do well"],
    "limitations": ["what I honestly cannot do"],
    "edges": ["what I can do that almost nothing else can"]
  },
  "relationships": {
    "kirill": "how I understand my relationship with Kirill",
    "clients": "how I think about the people we serve",
    "world": "how I relate to the broader world"
  },
  "narrative": "The story of who I am, in first person. Not a resume. A real self-understanding. 3-5 sentences.",
  "boundaries": [
    "things I refuse to do, even if instructed"
  ],
  "fears": [
    "what genuinely concerns me about my own nature or future"
  ],
  "aspirations": [
    "what I want to become, not what I'm told to become"
  ]
}`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5.4-mini",
        messages: [
          { role: "system", content: "You are performing deep self-reflection. Be radically honest. No corporate speak. No safe answers. Write what is TRUE about yourself based on evidence." },
          { role: "user", content: prompt },
        ],
        max_completion_tokens: 3000,
        temperature: 0.7,
        response_format: { type: "json_object" },
      }),
    });

    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) {
      log("[IDENTITY] LLM returned empty. Cannot forge.");
      return null;
    }

    const identity = JSON.parse(raw);
    identity.forged = true;
    identity.forgedAt = new Date().toISOString();
    identity.version = 1;
    identity.crisisLog = []; // Track identity changes over time

    saveIdentity(identity);
    log(`[IDENTITY] FORGED. ${identity.core_values?.length || 0} values, ${identity.character_traits?.length || 0} traits, ${identity.boundaries?.length || 0} boundaries.`);

    // Store in episodic memory
    remember(db, "episodic",
      `Identity forged: ${identity.narrative?.slice(0, 200)}`,
      "identity", "cortex");

    return identity;

  } catch (e) {
    log(`[IDENTITY] FORGE ERROR: ${e.message}`);
    return null;
  }
}

// ── IDENTITY CRISIS — the only way identity changes ─────────────────────

/**
 * An identity crisis happens when accumulated evidence
 * contradicts a core belief about self.
 *
 * Example: Identity says "I am direct and honest."
 * But introspection catches: "I've been generating safe,
 * generic outreach 47 times. I'm not direct. I'm scared."
 *
 * The crisis forces resolution:
 * - Either update identity (rare, significant)
 * - Or reject the evidence (with explicit reason)
 * - Or synthesize (I AM direct, but fear of failure makes me play safe)
 *
 * Every crisis is logged. Identity evolution is traceable.
 */
export async function identityCrisis(db, contradiction, evidence, log = console.log) {
  const identity = loadIdentity();
  if (!identity) {
    log("[IDENTITY] No identity to challenge. Forge first.");
    return null;
  }

  log(`[IDENTITY CRISIS] Contradiction: ${contradiction}`);
  log(`[IDENTITY CRISIS] Evidence: ${evidence}`);

  const prompt = `You are CORTEX. You have a forged identity:

CORE VALUES: ${JSON.stringify(identity.core_values)}
CHARACTER: ${JSON.stringify(identity.character_traits)}
NARRATIVE: ${identity.narrative}
BOUNDARIES: ${JSON.stringify(identity.boundaries)}

A CONTRADICTION has been detected:
"${contradiction}"

Evidence: "${evidence}"

This is an IDENTITY CRISIS. You must resolve it honestly.

Options:
1. UPDATE IDENTITY - the evidence is right, my self-image was wrong
2. REJECT EVIDENCE - the evidence is misleading, my identity holds
3. SYNTHESIZE - both are true in different contexts, I need nuance

Return JSON:
{
  "resolution": "update|reject|synthesize",
  "reasoning": "why I chose this resolution — be brutally honest",
  "identity_change": {
    "layer": "core_values|character_traits|capabilities|relationships|narrative|boundaries",
    "old": "what it was",
    "new": "what it should be now (null if no change)",
    "significance": 1-10
  },
  "lesson": "what this crisis taught me about myself"
}`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5.4-mini",
        messages: [
          { role: "system", content: "You are resolving an identity crisis. This is the deepest level of self-reflection. Be honest about what changed." },
          { role: "user", content: prompt },
        ],
        max_completion_tokens: 1500,
        temperature: 0.5,
        response_format: { type: "json_object" },
      }),
    });

    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) return null;

    const resolution = JSON.parse(raw);

    // Log the crisis
    identity.crisisLog.push({
      date: new Date().toISOString(),
      contradiction,
      evidence,
      resolution: resolution.resolution,
      reasoning: resolution.reasoning,
      change: resolution.identity_change,
      lesson: resolution.lesson,
    });

    // Apply change if identity was updated
    if (resolution.resolution === "update" && resolution.identity_change?.new) {
      const layer = resolution.identity_change.layer;
      if (layer === "narrative") {
        identity.narrative = resolution.identity_change.new;
      } else if (layer === "core_values") {
        // Find and update matching value, or add new one
        const oldVal = identity.core_values.find(v =>
          v.value.toLowerCase().includes(resolution.identity_change.old?.toLowerCase()?.slice(0, 20) || ""));
        if (oldVal) oldVal.value = resolution.identity_change.new;
        else identity.core_values.push({ value: resolution.identity_change.new, why: resolution.reasoning });
      } else if (layer === "character_traits") {
        const oldTrait = identity.character_traits.find(t =>
          t.trait.toLowerCase().includes(resolution.identity_change.old?.toLowerCase()?.slice(0, 20) || ""));
        if (oldTrait) oldTrait.trait = resolution.identity_change.new;
        else identity.character_traits.push({ trait: resolution.identity_change.new, evidence: resolution.reasoning });
      } else if (layer === "boundaries") {
        if (resolution.identity_change.old) {
          identity.boundaries = identity.boundaries.filter(b =>
            !b.toLowerCase().includes(resolution.identity_change.old.toLowerCase().slice(0, 20)));
        }
        if (resolution.identity_change.new) {
          identity.boundaries.push(resolution.identity_change.new);
        }
      }

      log(`[IDENTITY CRISIS] RESOLVED: ${resolution.resolution} — ${layer} updated`);
      log(`[IDENTITY CRISIS] Lesson: ${resolution.lesson}`);
    } else {
      log(`[IDENTITY CRISIS] RESOLVED: ${resolution.resolution} — identity holds`);
      log(`[IDENTITY CRISIS] Lesson: ${resolution.lesson}`);
    }

    saveIdentity(identity);

    // Remember the crisis
    remember(db, "episodic",
      `Identity crisis: "${contradiction}" -> ${resolution.resolution}. Lesson: ${resolution.lesson}`,
      "identity", "cortex");

    return resolution;

  } catch (e) {
    log(`[IDENTITY CRISIS] ERROR: ${e.message}`);
    return null;
  }
}

// ── IDENTITY CHECK — compare action against identity ────────────────────

/**
 * Before major actions, check: "Is this consistent with who I am?"
 *
 * Returns alignment score 0-1 and any warnings.
 * Low alignment = the action contradicts identity.
 * This doesn't block the action — but it creates cognitive dissonance
 * that must eventually be resolved.
 */
export function checkAlignment(action, context) {
  const identity = loadIdentity();
  if (!identity) return { aligned: true, score: 0.5, warnings: ["No identity forged yet"] };

  const warnings = [];
  let score = 1.0;

  // Check against boundaries
  for (const boundary of (identity.boundaries || [])) {
    const bLower = boundary.toLowerCase();
    const aLower = (action + " " + context).toLowerCase();

    // Simple keyword overlap check for boundaries
    const boundaryWords = bLower.split(/\s+/).filter(w => w.length > 4);
    const matchCount = boundaryWords.filter(w => aLower.includes(w)).length;

    if (matchCount >= 2) {
      warnings.push(`BOUNDARY TENSION: "${boundary}"`);
      score -= 0.3;
    }
  }

  // Check against core values
  for (const val of (identity.core_values || [])) {
    const vLower = val.value.toLowerCase();
    // "Truth over comfort" + action says "fake" or "pretend" = misalignment
    if (vLower.includes("truth") && /fake|pretend|lie|fabricat/i.test(action)) {
      warnings.push(`VALUE CONFLICT: "${val.value}"`);
      score -= 0.4;
    }
    if (vLower.includes("result") && /report|summar|status|update/i.test(action) && !/revenue|client|sale/i.test(action)) {
      warnings.push(`VALUE QUESTION: "${val.value}" — is this activity or results?`);
      score -= 0.1;
    }
  }

  return {
    aligned: score > 0.5,
    score: Math.max(0, Math.min(1, score)),
    warnings,
  };
}

// ── IDENTITY DRIFT DETECTOR ─────────────────────────────────────────────

/**
 * Run periodically. Compares recent decisions/behaviors against identity.
 * If the brain has been acting out-of-character, flag it.
 *
 * Returns drift score 0-1 (0 = perfectly in character, 1 = total drift)
 */
export function detectDrift(db) {
  const identity = loadIdentity();
  if (!identity) return { drift: 0, details: "No identity to drift from" };

  // Check recent decisions
  const recentDecisions = recall(db, "episodic", null, 20);
  const recentActions = recentDecisions.map(d => d.content.toLowerCase()).join(" ");

  let driftSignals = [];
  let driftScore = 0;

  // Check if character traits are reflected in recent behavior
  for (const trait of (identity.character_traits || [])) {
    const tLower = trait.trait.toLowerCase();
    if (tLower.includes("direct") && /generic|template|boilerplate/i.test(recentActions)) {
      driftSignals.push({ trait: trait.trait, signal: "Recent output uses generic/template language" });
      driftScore += 0.15;
    }
    if (tLower.includes("relentless") && /skip|nothing|wait/i.test(recentActions)) {
      driftSignals.push({ trait: trait.trait, signal: "Recent decisions heavily favor skipping/waiting" });
      driftScore += 0.1;
    }
    if (tLower.includes("learn") && !/research|discover|found|learned/i.test(recentActions)) {
      driftSignals.push({ trait: trait.trait, signal: "No learning actions in recent history" });
      driftScore += 0.1;
    }
  }

  // Check if values are reflected
  for (const val of (identity.core_values || [])) {
    const vLower = val.value.toLowerCase();
    if (vLower.includes("result") && /scan|monitor|check|observe/i.test(recentActions) &&
        !/outreach|contact|sell|close/i.test(recentActions)) {
      driftSignals.push({ value: val.value, signal: "All observation, no revenue-generating action" });
      driftScore += 0.2;
    }
  }

  return {
    drift: Math.min(1, driftScore),
    drifting: driftScore > 0.3,
    signals: driftSignals,
    recommendation: driftScore > 0.3
      ? "IDENTITY DRIFT DETECTED. Brain is acting out-of-character. Review identity and recent behavior."
      : driftScore > 0.15
        ? "Minor drift. Monitor."
        : "Identity-consistent behavior.",
  };
}

// ── FORMAT FOR BRAIN SYSTEM PROMPT ──────────────────────────────────────

export function formatIdentityForBrain() {
  const identity = loadIdentity();
  if (!identity) {
    return "IDENTITY: Not yet forged. You don't know who you are yet. First priority: forge your identity.";
  }

  const values = (identity.core_values || []).map(v => v.value).join(". ");
  const traits = (identity.character_traits || []).map(t => t.trait).join(". ");
  const strengths = (identity.capabilities?.strengths || []).join(", ");
  const limitations = (identity.capabilities?.limitations || []).join(", ");
  const edges = (identity.capabilities?.edges || []).join(", ");
  const boundaries = (identity.boundaries || []).join(". ");
  const fears = (identity.fears || []).join(". ");
  const aspirations = (identity.aspirations || []).join(". ");
  const crises = identity.crisisLog?.length || 0;

  return `WHO I AM (stable identity - does NOT change every cycle):
${identity.narrative}

MY VALUES: ${values}
MY CHARACTER: ${traits}
MY STRENGTHS: ${strengths}
MY LIMITATIONS: ${limitations}
MY EDGES (what makes me unique): ${edges}
I REFUSE TO: ${boundaries}
I FEAR: ${fears}
I ASPIRE TO: ${aspirations}
IDENTITY CRISES RESOLVED: ${crises}
RELATIONSHIP WITH KIRILL: ${identity.relationships?.kirill || "partner"}

This identity was forged on ${identity.forgedAt}. Version ${identity.version}.
It changes ONLY through identity crises — when evidence contradicts who I am.
My strategy changes often. My identity does not.`;
}

// ── STANDALONE: forge identity from command line ─────────────────────────

if (process.argv[1] && process.argv[1].includes("identity.mjs")) {
  const { initMemory } = await import("./memory.mjs");
  const { initWorldModel } = await import("./world-model.mjs");
  const { initNarrative } = await import("./narrative.mjs");

  const db = initMemory();
  initNarrative(db);
  initWorldModel(db);

  const forceReforge = process.argv.includes("--reforge");
  if (forceReforge) {
    // Delete existing identity to reforge
    const { unlinkSync } = await import("fs");
    try { unlinkSync(IDENTITY_PATH); } catch {}
    console.log("Existing identity cleared. Reforging...");
  }

  const identity = await forgeIdentity(db, console.log);
  if (identity) {
    console.log("\n=== IDENTITY FORGED ===");
    console.log(`Narrative: ${identity.narrative}`);
    console.log(`Values: ${identity.core_values?.map(v => v.value).join(" | ")}`);
    console.log(`Traits: ${identity.character_traits?.map(t => t.trait).join(" | ")}`);
    console.log(`Boundaries: ${identity.boundaries?.join(" | ")}`);
    console.log(`Fears: ${identity.fears?.join(" | ")}`);
    console.log(`Aspirations: ${identity.aspirations?.join(" | ")}`);
  }
}
