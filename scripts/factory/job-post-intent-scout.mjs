/**
 * DISCONTINUED - Voice agent product was killed April 22, 2026.
 * This file is no longer active. Do not import or call.
 * Kept for reference only.
 */
/**
 * job-post-intent-scout.mjs
 *
 * Finds businesses actively hiring receptionists / front-desk / answering help
 * on job boards (Indeed, ZipRecruiter, Craigslist, LinkedIn Jobs).
 *
 * Insight: a company posting a receptionist job is a company that:
 *   - Needs phone/front-desk coverage RIGHT NOW
 *   - Is already budgeting for it (salary > AI cost)
 *   - Hasn't yet considered an AI alternative
 *
 * Outreach angle: "instead of hiring/covering phones manually,
 * trial an after-hours AI receptionist for 7 days."
 *
 * Built April 2026. Uses Brave Search API via search-client.mjs.
 * Stores leads to SQLite with source='job-post-intent-scout', stage='new'.
 */
import Database from "better-sqlite3";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync, existsSync } from "fs";
import { randomUUID } from "crypto";
import { webSearch } from "../search-client.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const db = new Database(resolve(ROOT, ".data/linkedin-brand-os.sqlite"));

const env = Object.fromEntries(
  readFileSync(resolve(ROOT, "apps/api/.env"), "utf-8").split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const TG = env.TELEGRAM_BOT_TOKEN, CHAT = env.TELEGRAM_CHAT_ID;
const NOW = () => new Date().toISOString();

// Job board search queries — each targets a vertical known to need receptionist coverage
const QUERIES = [
  // Dental / medical
  { q: "site:indeed.com dental receptionist",                     vertical: "dental" },
  { q: "site:indeed.com receptionist dental clinic",              vertical: "dental" },
  { q: "site:indeed.com medical receptionist urgent care",        vertical: "medical" },
  { q: "site:indeed.com front desk chiropractic physiotherapy",   vertical: "health" },
  { q: "site:ziprecruiter.com receptionist dental office",        vertical: "dental" },
  { q: "site:ziprecruiter.com medical front desk answering",      vertical: "medical" },
  // HVAC / trades
  { q: "site:ziprecruiter.com hvac dispatcher",                   vertical: "hvac" },
  { q: "site:indeed.com dispatcher answering hvac heating cooling", vertical: "hvac" },
  { q: "site:ziprecruiter.com front desk hvac plumbing electrical", vertical: "trades" },
  { q: "site:craigslist.org plumber office assistant",            vertical: "trades" },
  { q: "site:craigslist.org answering service plumbing",          vertical: "trades" },
  { q: "site:craigslist.org receptionist hvac heating air conditioning", vertical: "hvac" },
  // General small business
  { q: "site:linkedin.com/jobs front desk urgent care",           vertical: "medical" },
  { q: "site:linkedin.com/jobs medical receptionist urgent care", vertical: "medical" },
  { q: "site:linkedin.com/jobs front desk receptionist small business", vertical: "smb" },
  { q: "site:indeed.com receptionist answering phones small business", vertical: "smb" },
  { q: "site:ziprecruiter.com receptionist answering service",    vertical: "smb" },
  // Salon / spa / beauty
  { q: "site:indeed.com salon receptionist front desk",           vertical: "salon" },
  { q: "site:indeed.com spa receptionist booking phones",         vertical: "salon" },
  { q: "site:ziprecruiter.com salon front desk answering",        vertical: "salon" },
  { q: "site:linkedin.com/jobs salon receptionist answering",     vertical: "salon" },
  // Law / legal
  { q: "site:indeed.com receptionist law firm answering phones",  vertical: "legal" },
  { q: "site:ziprecruiter.com legal receptionist front desk",     vertical: "legal" },
  { q: "site:linkedin.com/jobs law firm receptionist",            vertical: "legal" },
  { q: "site:indeed.com paralegal receptionist legal office",     vertical: "legal" },
  // Property / accounting
  { q: "site:indeed.com receptionist property management office", vertical: "property" },
  { q: "site:ziprecruiter.com receptionist accounting office",    vertical: "professional" },
  // Calgary-focused job-posting pain signals
  { q: "site:indeed.com Calgary HVAC dispatcher",                 vertical: "hvac" },
  { q: "site:ca.indeed.com plumber receptionist Calgary",         vertical: "trades" },
  { q: "site:linkedin.com/jobs dental receptionist Calgary",      vertical: "dental" },
  { q: "site:ziprecruiter.com Canada answering service HVAC",     vertical: "hvac" },
  { q: "site:indeed.com Calgary call taker dispatcher trades",    vertical: "trades" },
  { q: "site:ca.indeed.com Calgary receptionist plumbing electrical", vertical: "trades" },
];

const exists = db.prepare(`SELECT 1 FROM leads WHERE source_url = ?`);
const insert = db.prepare(`
  INSERT INTO leads
    (id, name, source, source_platform, source_url, pain_description, score, stage,
     first_signal_at, created_at, updated_at, notes)
  VALUES (?, ?, 'job-post-intent-scout', ?, ?, ?, ?, 'new', ?, ?, ?, ?)
`);

async function tg(text) {
  if (!TG || !CHAT) return;
  await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT, text, parse_mode: "HTML", disable_web_page_preview: true }),
  }).catch(() => {});
}

function scoreResult(title, snippet, vertical) {
  const text = `${title} ${snippet}`.toLowerCase();
  let score = 20; // base: active hiring = strong intent signal
  // Vertical bonuses
  if (vertical === "dental" || vertical === "medical" || vertical === "health") score += 15;
  if (vertical === "legal") score += 14;
  if (vertical === "salon") score += 12;
  if (vertical === "hvac" || vertical === "trades") score += 12;
  // Urgency keywords
  if (/urgent|immediately|asap|now hiring|start (immediately|asap|monday)/i.test(text)) score += 10;
  // Small business signals
  if (/small (practice|office|team|business)|independent|family.owned|single.location/i.test(text)) score += 8;
  // Location bonus
  if (/calgary|alberta|edmonton/i.test(text)) score += 15;
  if (/canada|toronto|vancouver|ontario/i.test(text)) score += 8;
  // After-hours / phone coverage signals (highest intent for AI receptionist)
  if (/after.hours|evenings|weekends|on.call|24.?7|phone coverage|answering (phones|calls|service)/i.test(text)) score += 20;
  // Scheduling signals
  if (/schedul(ing|er)|appointment(s)?|booking|calendar|dispatch/i.test(text)) score += 12;
  // Bilingual signals
  if (/bilingual|spanish|french|mandarin|cantonese|tagalog|bilinge/i.test(text)) score += 10;
  return score;
}

(async () => {
  if (existsSync(resolve(ROOT, ".data/scouts-paused.flag"))) {
    console.log("[job-post-intent-scout] PAUSED by system-brain. Skipping.");
    db.close();
    return;
  }

  let added = 0, skipped_dupe = 0;
  const fresh = [];

  for (const { q, vertical } of QUERIES) {
    let results;
    try {
      results = await webSearch(q, 5);
    } catch (e) {
      console.log(`[job-post-intent] search error for "${q}": ${e.message}`);
      results = [];
    }

    for (const r of results) {
      if (!r.url) continue;
      if (exists.get(r.url)) { skipped_dupe++; continue; }

      const score = scoreResult(r.title || "", r.snippet || "", vertical);
      const id = `jobpost-${randomUUID().slice(0, 12)}`;
      const name = (r.title || "").replace(/\s*[\|\-].*$/, "").trim().slice(0, 120) || "Job post lead";
      const pain = `[${vertical}] ${r.title || ""}\n${r.snippet || ""}`.slice(0, 1500);
      const note = `Job-board hiring signal. Vertical: ${vertical}. Outreach angle: If you're hiring just to stop missed calls, our AI receptionist can answer now for less than one shift. Query: ${q}`;

      insert.run(id, name, vertical, r.url, pain, score, NOW(), NOW(), NOW(), note);
      fresh.push({ vertical, title: r.title || r.url, score, url: r.url });
      added++;
    }

    // Rate limit: 1.2s between Brave API calls
    await new Promise(res => setTimeout(res, 1200));
  }

  console.log(`[job-post-intent-scout] added=${added} dupes=${skipped_dupe}`);

  if (added > 0) {
    const top = fresh.sort((a, b) => b.score - a.score).slice(0, 5)
      .map(f => `- [${f.vertical}] ${(f.title || "").slice(0, 80)} (score ${f.score})`).join("\n");
    await tg(
      `<b>Job-post intent scout: ${added} new leads</b>\n\nThese businesses are actively hiring receptionists. Angle: "If you're hiring just to stop missed calls, our AI receptionist can answer now for less than one shift."\n\nTop ${Math.min(5, fresh.length)}:\n${top}\n\nStored to leads table, stage=new, source=job-post-intent-scout.`
    );
  }

  db.close();
})();
