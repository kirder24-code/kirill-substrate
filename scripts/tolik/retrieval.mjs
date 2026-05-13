/**
 * scripts/tolik/retrieval.mjs
 *
 * Pre-flight retrieval: before Tolik answers, pull the most relevant
 * specific facts from his memory:
 *   - top organism beliefs by keyword overlap
 *   - wiki-archive entries by keyword overlap
 *   - recent opportunities matching keywords
 *
 * Pure keyword retrieval (no embeddings yet). Token-set overlap + idf-ish
 * weighting. Fast (<50ms typical). Adds 500-1500 chars of HIGHLY RELEVANT
 * facts to every prompt, instead of giving the LLM only counters.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const ORGANISM_DB = resolve(ROOT, ".data/organism.db");
const SURVIVAL_DB = resolve(ROOT, ".data/survival.db");
const WIKI_DIR = resolve(ROOT, ".data/wiki-archive");
const FACTS_PATH = resolve(__dirname, "personal-facts.md");

// Russian + English stopwords (terse)
const STOP = new Set([
  "и","в","на","с","у","о","к","по","за","от","для","что","как","но","или","да","нет",
  "это","эти","это","я","ты","он","она","мы","вы","они","меня","тебя","его","её","нас","вас","их",
  "the","a","an","is","are","was","were","be","been","being","of","in","on","at","to","for",
  "with","by","from","as","that","this","these","those","i","you","he","she","we","they","it",
  "and","or","but","if","then","do","does","did","will","would","can","could","should","not",
  "what","when","where","why","how","which","who","whose",
  "толик","tolik","kirill","кирилл",
]);

function tokenize(text) {
  if (!text) return [];
  return text.toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOP.has(w));
}

function scoreOverlap(queryTokens, candidate) {
  const candidateTokens = new Set(tokenize(candidate));
  let hits = 0;
  for (const q of queryTokens) {
    if (candidateTokens.has(q)) hits++;
  }
  return hits;
}

function topBeliefsByQuery(queryTokens, limit = 5) {
  if (!existsSync(ORGANISM_DB) || queryTokens.length === 0) return [];
  try {
    const db = new Database(ORGANISM_DB, { readonly: true, fileMustExist: true });
    const all = db.prepare(`SELECT claim, weight, domain FROM beliefs WHERE weight >= 0.4 ORDER BY weight DESC LIMIT 400`).all();
    db.close();
    const scored = all.map(b => ({ ...b, score: scoreOverlap(queryTokens, b.claim) }));
    return scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score || b.weight - a.weight).slice(0, limit);
  } catch { return []; }
}

function topWikiByQuery(queryTokens, limit = 4) {
  if (!existsSync(WIKI_DIR) || queryTokens.length === 0) return [];
  const hits = [];
  for (const f of readdirSync(WIKI_DIR)) {
    if (!f.endsWith(".md")) continue;
    try {
      const content = readFileSync(resolve(WIKI_DIR, f), "utf-8");
      const score = scoreOverlap(queryTokens, content);
      if (score < 2) continue; // need at least 2 keyword hits
      // Extract title
      let title = f;
      const tm = content.match(/title:\s*["']?([^"'\n]+)/);
      if (tm) title = tm[1].trim();
      // Find a relevant snippet around the first matching token
      let snippet = content.slice(0, 600);
      const firstHit = queryTokens.find(t => content.toLowerCase().includes(t));
      if (firstHit) {
        const idx = content.toLowerCase().indexOf(firstHit);
        if (idx > 100) snippet = content.slice(Math.max(0, idx - 150), idx + 500);
      }
      hits.push({ file: f, title, score, snippet: snippet.replace(/\n+/g, " ").trim() });
    } catch {}
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

function relevantOpportunities(queryTokens, limit = 4) {
  if (!existsSync(SURVIVAL_DB) || queryTokens.length === 0) return [];
  try {
    const db = new Database(SURVIVAL_DB, { readonly: true, fileMustExist: true });
    const all = db.prepare(`SELECT id, title, source, state, channels, money_potential_usd, notes FROM opportunities ORDER BY state_changed_at DESC LIMIT 80`).all();
    db.close();
    const scored = all.map(o => ({ ...o, score: scoreOverlap(queryTokens, `${o.title} ${o.notes || ""}`) }));
    return scored.filter(s => s.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
  } catch { return []; }
}

function personalFactsHits(queryTokens) {
  if (!existsSync(FACTS_PATH) || queryTokens.length === 0) return null;
  try {
    const content = readFileSync(FACTS_PATH, "utf-8");
    const score = scoreOverlap(queryTokens, content);
    if (score < 2) return null;
    // Return any 1-line bullet that matches a query token
    const lines = content.split("\n").filter(l => l.startsWith("- ") || l.startsWith("* "));
    const matched = lines.filter(l => {
      const ll = l.toLowerCase();
      return queryTokens.some(t => ll.includes(t));
    }).slice(0, 5);
    if (matched.length === 0) return null;
    return matched.join("\n");
  } catch { return null; }
}

/**
 * Build the "GROUNDED FACTS" prompt block. Pure text, ready to inject
 * after the system prompt header.
 */
export function buildRetrievalBlock(query) {
  const tokens = tokenize(query);
  if (tokens.length === 0) return "";
  const beliefs = topBeliefsByQuery(tokens, 5);
  const wiki = topWikiByQuery(tokens, 3);
  const opps = relevantOpportunities(tokens, 3);
  const facts = personalFactsHits(tokens);

  const sections = [];
  if (beliefs.length > 0) {
    sections.push(`RELEVANT BELIEFS (substrate organism, confidence in [brackets]):\n` +
      beliefs.map(b => `- [${b.weight.toFixed(2)}${b.domain ? `/${b.domain}` : ""}] ${b.claim}`).join("\n"));
  }
  if (opps.length > 0) {
    sections.push(`RELEVANT OPPORTUNITIES (substrate pipeline):\n` +
      opps.map(o => `- [${o.state}] ${o.title}${o.money_potential_usd ? ` (~$${o.money_potential_usd})` : ""}${o.notes ? ` // ${o.notes.slice(0, 100)}` : ""}`).join("\n"));
  }
  if (wiki.length > 0) {
    sections.push(`RELEVANT WIKI EXCERPTS (Tolik's external memory):\n` +
      wiki.map(w => `[${w.title}]\n${w.snippet.slice(0, 350)}…`).join("\n\n"));
  }
  if (facts) {
    sections.push(`RELEVANT PERSONAL FACTS:\n${facts}`);
  }
  if (sections.length === 0) return "";
  return `=== GROUNDED FACTS (retrieved for this query) ===
${sections.join("\n\n")}
=== END GROUNDED FACTS ===`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const q = process.argv.slice(2).join(" ") || "что ты думаешь о портретe ICP для AI агентов";
  console.log(buildRetrievalBlock(q));
}
