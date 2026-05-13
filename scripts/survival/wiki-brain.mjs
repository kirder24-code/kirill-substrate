/**
 * scripts/survival/wiki-brain.mjs
 *
 * Active query interface to the Obsidian-style wiki at .data/wiki-archive/.
 * Turns 63 markdown pages from passive archive into a brain substrate
 * can read before generating drafts/research/plans.
 *
 * Two query modes:
 *   1. Filename keyword match (deterministic, free, no LLM)
 *   2. Content-grep across all pages (deterministic, free, no LLM)
 *
 * Both return matching pages with content + provenance, so the calling
 * action can include them in its LLM prompt as prior knowledge.
 */

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const WIKI_DIR = resolve(ROOT, ".data/wiki-archive");
const MAX_PAGES_RETURNED = 4;
const MAX_BYTES_PER_PAGE = 4000;

function listWikiFiles() {
  if (!existsSync(WIKI_DIR)) return [];
  return readdirSync(WIKI_DIR)
    .filter(f => f.endsWith(".md"))
    .map(f => resolve(WIKI_DIR, f));
}

function tokenize(s) {
  return String(s || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length >= 3);
}

/**
 * Return matching wiki pages for a query.
 * Strategy:
 *   - Tokenize query into keywords
 *   - For each page: filename score (keyword in filename = +5) + content score (keyword in body = +1)
 *   - Sort, take top N
 */
export function queryWiki(query, { limit = MAX_PAGES_RETURNED } = {}) {
  const keywords = tokenize(query);
  if (keywords.length === 0) return [];
  const files = listWikiFiles();
  const scored = [];
  for (const file of files) {
    const filename = file.split("/").pop().toLowerCase();
    const content = readFileSync(file, "utf-8");
    const lower = content.toLowerCase();
    let score = 0;
    for (const k of keywords) {
      if (filename.includes(k)) score += 5;
      // Count occurrences in content (capped per keyword)
      const occurrences = Math.min(10, (lower.match(new RegExp(k, "g")) || []).length);
      score += occurrences;
    }
    if (score > 0) scored.push({ file, filename, score, content });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(s => ({
    filename: s.filename,
    score: s.score,
    excerpt: s.content.slice(0, MAX_BYTES_PER_PAGE),
    full_path: s.file,
  }));
}

/**
 * Build a compact prompt-ready knowledge block from query results.
 * Returns a string suitable to drop into an LLM prompt.
 */
export function buildKnowledgeBlock(query, { limit = MAX_PAGES_RETURNED } = {}) {
  const matches = queryWiki(query, { limit });
  if (matches.length === 0) {
    return `(No wiki pages match query: "${query}". Wiki has ${listWikiFiles().length} pages indexed.)`;
  }
  const blocks = matches.map((m, i) =>
    `--- WIKI PAGE ${i + 1}: ${m.filename} (score=${m.score}) ---\n${m.excerpt}`
  );
  return `Prior knowledge from wiki (${matches.length} of ${listWikiFiles().length} pages matched):\n\n${blocks.join("\n\n")}`;
}

export function listAllWikiTitles() {
  return listWikiFiles().map(f => f.split("/").pop());
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const q = process.argv.slice(2).join(" ") || "AI grants Canada SMB";
  const r = queryWiki(q, { limit: 5 });
  console.log(`Query: "${q}"\nMatches: ${r.length} of ${listWikiFiles().length} wiki pages\n`);
  for (const m of r) {
    console.log(`  [score=${m.score}] ${m.filename}`);
  }
}
