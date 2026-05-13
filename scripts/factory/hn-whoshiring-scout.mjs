/**
 * hn-whoshiring-scout.mjs
 *
 * Scrapes HackerNews monthly "Who is hiring?" thread for posts that match
 * Kirill's ICP: solo founders / small SaaS hiring n8n / automation / AI /
 * fractional CTO / contract builders.
 *
 * 100% free via HN public API. No Apify, no Claude.
 *
 * Filters:
 *   - Recent month threads only
 *   - Top-level comments (job posts) not replies
 *   - Keyword match: n8n / automation / AI / CTO / contract / fractional / consultant
 *   - Skip: huge corp listings (Google, Meta, FAANG)
 *
 * Built April 9 2026 after Kirill flagged that we have no IH/HN founder hiring channel.
 */
import Database from "better-sqlite3";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import { readPurpose, appendLog } from "../../wiki/reader.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DB_PATH = resolve(ROOT, ".data/linkedin-brand-os.sqlite");

const HN_BASE = "https://hacker-news.firebaseio.com/v0";

// Look for these in the comment text
const POSITIVE_KEYWORDS = [
  /\bn8n\b/i, /\bzapier\b/i, /\bmake\.com\b/i, /\bairtable\b/i,
  /automation\s+(engineer|expert|consultant|specialist|developer|builder)/i,
  /AI\s+(engineer|consultant|builder|automation|workflow)/i,
  /\bagent(ic)?\s+(framework|workflow|builder)/i,
  /\bn8n\s+expert/i, /\bworkflow\s+builder/i,
  /fractional\s+(CTO|engineer|developer)/i,
  /contract\s+(developer|engineer|builder)/i,
  /vibe.coded?\s+(MVP|app|product|stack)/i,
  /\bClaude\b.*(agent|workflow|build)/i,
  /\bLLM\b.*(integration|workflow)/i,
];

// Skip these - they are huge corps not solo founders
const NEGATIVE_KEYWORDS = [
  /^Google\b/, /^Meta\b/, /^Apple\b/, /^Amazon\b/, /^Microsoft\b/,
  /^Stripe\b/, /^Coinbase\b/, /^Uber\b/, /^Airbnb\b/, /^Netflix\b/,
  /\bvisa.sponsorship/i, /\b\d{3,}\s*employees/i,
  /\bonsite.only/i, /\bin.person.only/i,
  /senior.principal/i, /staff.engineer/i, /\bL[5-9]\b/,
];

async function fetchItem(id) {
  const r = await fetch(`${HN_BASE}/item/${id}.json`);
  if (!r.ok) return null;
  return r.json();
}

function isMatch(text) {
  if (!text) return false;
  // Skip if matches any negative
  for (const rx of NEGATIVE_KEYWORDS) if (rx.test(text)) return false;
  // Need at least one positive
  for (const rx of POSITIVE_KEYWORDS) if (rx.test(text)) return true;
  return false;
}

function extractCompany(text) {
  // First line usually has company name like "Acme Inc | Backend Engineer | Remote | $100k-150k"
  const firstLine = text.split("\n")[0].replace(/<[^>]+>/g, "").trim();
  const company = firstLine.split("|")[0]?.trim() || "Unknown";
  return company.slice(0, 100);
}

function extractRole(text) {
  const firstLine = text.split("\n")[0].replace(/<[^>]+>/g, "").trim();
  const parts = firstLine.split("|").map(s => s.trim());
  return (parts[1] || parts[0] || "").slice(0, 100);
}

function stripHtml(html) {
  if (!html) return "";
  return html
    .replace(/<p>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .trim();
}

async function main() {
  const db = new Database(DB_PATH);
  console.log("[hn-whoshiring] starting");

  // Find latest "Who is hiring?" thread - whoishiring user submissions, the EVEN-indexed ones
  const userResp = await fetch(`${HN_BASE}/user/whoishiring.json`);
  const user = await userResp.json();
  const submitted = user.submitted || [];

  // Take the 2 most recent threads (current + previous month)
  const threadIds = submitted.slice(0, 4);
  const threads = [];
  for (const id of threadIds) {
    const item = await fetchItem(id);
    if (item && /Who is hiring/i.test(item.title || "")) {
      threads.push(item);
      console.log(`[hn-whoshiring] found thread: ${item.title} (${(item.kids || []).length} comments)`);
    }
  }

  if (threads.length === 0) {
    console.log("[hn-whoshiring] no Who is hiring threads found");
    db.close();
    return;
  }

  // Process top-level comments (job posts) from each thread
  const insert = db.prepare(`
    INSERT OR IGNORE INTO leads
      (id, name, role, company, pain_description, source_url, source, score, stage, first_signal_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', datetime('now'), datetime('now'), datetime('now'))
  `);

  let totalChecked = 0, totalMatched = 0, totalInserted = 0;

  for (const thread of threads) {
    const kids = thread.kids || [];
    console.log(`[hn-whoshiring] processing ${kids.length} top-level comments from ${thread.title}`);
    for (const kidId of kids) {
      totalChecked++;
      const comment = await fetchItem(kidId);
      if (!comment || comment.deleted || comment.dead) continue;
      const text = stripHtml(comment.text || "");
      if (!isMatch(text)) continue;
      totalMatched++;

      const company = extractCompany(text);
      const role = extractRole(text);
      const author = comment.by || "anon";
      const url = `https://news.ycombinator.com/item?id=${kidId}`;

      try {
        const r = insert.run(
          randomUUID(),
          author,
          role,
          company,
          `${text.slice(0, 1500)}\n\n[HN by ${author}]\n[Posted: ${new Date(comment.time * 1000).toISOString()}]\n[Thread: ${thread.title}]`,
          url,
          "hn-whoshiring",
          22
        );
        if (r.changes > 0) totalInserted++;
      } catch {}

      // Be nice to HN API
      await new Promise(r => setTimeout(r, 100));
    }
  }

  console.log(`[hn-whoshiring] done: checked=${totalChecked} matched=${totalMatched} inserted=${totalInserted}`);
  db.close();
}

main().catch(e => {
  console.error("[hn-whoshiring] FATAL:", e);
  process.exit(1);
});
