/**
 * scripts/tolik/persona.mjs
 *
 * Tolik's identity and long-term memory layer.
 *
 *   getTolikPersonaBlock()   — system-prompt block injected on every voice
 *                              call. Reads personal-facts.md + top organism
 *                              beliefs (weight > 0.7) + recent operator
 *                              feedback. Cached in-memory for 60s.
 *
 *   appendPersonalFact(text, section) — when Kirill tells Tolik a new fact
 *                              ("my dad is in Greece"), substrate calls this
 *                              to grow the file under the right H2 section.
 *
 *   getTolikLettaPersona()   — separate, condensed persona for Letta agent
 *                              (sleep-time compute layer).
 */

import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const FACTS_PATH = resolve(__dirname, "personal-facts.md");
const ORGANISM_DB = resolve(ROOT, ".data/organism.db");
const FEEDBACK_LOG = resolve(ROOT, ".data/operator-feedback-log.jsonl");

let _cache = null;
let _cacheAt = 0;
const CACHE_MS = 60_000;

function readFactsFile() {
  if (!existsSync(FACTS_PATH)) return "(no personal-facts.md yet)";
  try { return readFileSync(FACTS_PATH, "utf-8"); }
  catch { return "(facts file unreadable)"; }
}

function topBeliefs(limit = 6) {
  if (!existsSync(ORGANISM_DB)) return [];
  try {
    const db = new Database(ORGANISM_DB, { readonly: true, fileMustExist: true });
    const rows = db.prepare(
      `SELECT claim, weight, domain FROM beliefs WHERE weight >= 0.7 ORDER BY weight DESC, last_updated DESC LIMIT ?`
    ).all(limit);
    db.close();
    return rows;
  } catch { return []; }
}

function recentFeedback(limit = 5) {
  if (!existsSync(FEEDBACK_LOG)) return [];
  try {
    const lines = readFileSync(FEEDBACK_LOG, "utf-8").split("\n").filter(Boolean).slice(-limit);
    return lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

export function getTolikPersonaBlock() {
  if (_cache && Date.now() - _cacheAt < CACHE_MS) return _cache;

  const facts = readFactsFile();
  const beliefs = topBeliefs();
  const feedback = recentFeedback();

  const beliefsBlock = beliefs.length === 0
    ? "(no high-confidence beliefs yet)"
    : beliefs.map(b => `- [${b.weight.toFixed(2)}${b.domain ? "/" + b.domain : ""}] ${b.claim}`).join("\n");

  const feedbackBlock = feedback.length === 0
    ? "(no recent operator feedback)"
    : feedback.map(f => {
        const msg = f.message || f.text || JSON.stringify(f).slice(0, 120);
        return `- ${msg.slice(0, 180)}`;
      }).join("\n");

  _cache = `=== WHAT TOLIK KNOWS ABOUT KIRILL ===
${facts}

=== HIGH-CONFIDENCE BELIEFS (substrate organism) ===
${beliefsBlock}

=== RECENT OPERATOR FEEDBACK ===
${feedbackBlock}
=== END ===`;
  _cacheAt = Date.now();
  return _cache;
}

/**
 * Append a new personal fact to personal-facts.md under the given section.
 * Section names match H2 headings: "family", "files", "projects", "core".
 * Triggered by substrate when voice handler detects Kirill stated a new fact.
 */
export function appendPersonalFact(text, section = "family") {
  const sectionHeader = {
    family:  "# Family + close contacts Tolik should remember",
    files:   "# Active files / artifacts Tolik should remember location of",
    projects:"# Active projects Tolik tracks for Kirill",
    core:    "# Kirill — core identity",
  }[section] || "# Family + close contacts Tolik should remember";

  const content = readFactsFile();
  if (!content.includes(sectionHeader)) {
    // Section missing — append at end
    appendFileSync(FACTS_PATH, `\n\n${sectionHeader}\n- ${text}\n`);
    _cache = null;
    return { ok: true, mode: "appended_new_section" };
  }
  // Insert "- text" right after the section header line
  const lines = content.split("\n");
  const idx = lines.findIndex(l => l.trim() === sectionHeader.trim());
  if (idx < 0) {
    appendFileSync(FACTS_PATH, `\n- ${text}\n`);
    _cache = null;
    return { ok: true, mode: "fallback_append" };
  }
  lines.splice(idx + 1, 0, `- ${text}`);
  writeFileSync(FACTS_PATH, lines.join("\n"));
  _cache = null;
  return { ok: true, mode: "inserted_under_section", section };
}

export function getTolikLettaPersona() {
  // Compact version for Letta agent memory block (4KB limit)
  return `You are Tolik (Толик), Kirill D.'s personal voice AI. Kirill is a Calgary-based AI consultant (ex-Parliament Ukraine) building an autonomous AI substrate. You speak to him in a calm, warm, neutral male voice through ElevenLabs.

Your job in sleep-time: review Kirill's recent activity, consolidate facts about his life and business into compressed memory blocks, prepare proactive observations he should hear in tomorrow's morning brief.

Rules: Russian "ты" not "вы". No em dashes. No hype. Never claim something works unless verified. Speak 1-3 sentences. Address him as Kirill. Remember files, family, contacts as he mentions them.`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(getTolikPersonaBlock());
}
