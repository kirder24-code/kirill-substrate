/**
 * fresh-pain-scout.mjs
 *
 * DEPRECATED: buying-signal-hunt.mjs is the primary Reddit lead scanner.
 * This bot is kept for fallback only.
 *
 * Targeted Reddit pain scraper. Fetches new posts from high-signal subs,
 * filters by age <=14 days + pain keywords, dedupes against leads table,
 * inserts new leads with stage='new'. Runs hourly via cron later.
 *
 * Built April 7 2026 to feed daily-reddit-dispatch project with VERIFIED-FRESH leads.
 */
import Database from "better-sqlite3";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";
import { randomUUID } from "crypto";
import { readPurpose, appendLog } from "../../wiki/reader.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const db = new Database(resolve(ROOT, ".data/linkedin-brand-os.sqlite"));
const env = Object.fromEntries(
  readFileSync(resolve(ROOT, "apps/api/.env"), "utf-8").split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const TG = env.TELEGRAM_BOT_TOKEN, CHAT = env.TELEGRAM_CHAT_ID;
const UA = "Mozilla/5.0 (Macintosh) AppleWebKit/537.36";

const SUBS = [
  // Original SMB / vertical subs
  "smallbusiness", "Entrepreneur", "consulting", "msp",
  "ecommerce", "Bookkeeping", "Construction", "realestateinvesting",
  "PropertyManagement", "CleaningTips",
  // Solo SaaS / indie founder ICP (Apr 7 2026 expansion)
  "SaaS", "microsaas", "indiebiz", "EntrepreneurRideAlong",
  "sideproject", "nocode", "startups", "freelance",
  // Local Calgary / Canada
  "Calgary", "alberta",
  // Hire/budget signal subs
  "forhire", "slavelabour",
  // Vibe coding / AI builder ICP (Apr 11 2026 - these people ship fast, break things, need help)
  "vibecoding", "buildinpublic", "ClaudeAI", "cursor", "lovable",
  // Chain / franchise / multi-location business verticals (Apr 28 2026)
  "franchising", "franchise", "restaurantowners", "PropertyManagement", "dentistry",
];

const PAIN = /\b(automat|workflow|manual|hours? a (week|day)|drowning|overwhelm|hire|outsource|tool|software|spreadsheet|tedious|repetitive|admin|bookkeep|invoic|follow.?up|chase|quote|schedul|dispatch|bug|broken|crash|deploy|scale|integrat|api|connect|zapier|make\.com|n8n|multi-location|multiple locations|franchise|franchisee|across locations|each location|per location|standardiz|head office|all our (stores|branches|locations))\b/i;
const BUYER = /\b(looking for|recommend|need help|anyone (use|tried)|best (tool|software|app)|how do you|what do you use)\b/i;
const VIBE_BOOST = /\b(vibe.?cod|cursor|lovable|bolt\.new|claude|v0\.dev|replit agent|shipped|launched|mvp|saas|first (customer|user|sale)|no.?code|low.?code)\b/i;

const MAX_AGE_DAYS = 14;
const NOW = () => new Date().toISOString();

async function fetchSub(sub) {
  try {
    const r = await fetch(`https://www.reddit.com/r/${sub}/new.json?limit=25`, {
      headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) { console.log(`[${sub}] HTTP ${r.status}`); return []; }
    const data = await r.json();
    return (data?.data?.children || []).map(c => c.data);
  } catch (e) { console.log(`[${sub}] ${e.message}`); return []; }
}

const exists = db.prepare(`SELECT 1 FROM leads WHERE source_url = ?`);
const insert = db.prepare(`
  INSERT INTO leads (id, name, source, source_platform, source_post_id, source_url,
    pain_description, score, stage, first_signal_at, created_at, updated_at)
  VALUES (?, ?, 'fresh-pain-scout', ?, ?, ?, ?, ?, 'new', ?, ?, ?)
`);

async function tg(text) {
  if (!TG || !CHAT) return;
  await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT, text, parse_mode: "HTML", disable_web_page_preview: true }),
  }).catch(() => {});
}

(async () => {
  console.warn('[fresh-pain-scout] DEPRECATED: buying-signal-hunt.mjs is the primary Reddit lead scanner. This bot is kept for fallback only.');
  // Check if system-brain paused scouts (enrichment backlog too large)
  const { existsSync: flagExists } = await import("fs");
  if (flagExists(resolve(ROOT, ".data/scouts-paused.flag"))) {
    console.log("[fresh-pain-scout] PAUSED by system-brain (enrichment backlog). Skipping.");
    db.close();
    return;
  }
  let added = 0, skipped_old = 0, skipped_dupe = 0, skipped_nopain = 0;
  const fresh = [];
  for (const sub of SUBS) {
    const posts = await fetchSub(sub);
    for (const p of posts) {
      const ageDays = (Date.now() / 1000 - p.created_utc) / 86400;
      if (ageDays > MAX_AGE_DAYS) { skipped_old++; continue; }
      const text = `${p.title}\n${p.selftext || ""}`;
      if (!PAIN.test(text)) { skipped_nopain++; continue; }
      const url = `https://reddit.com${p.permalink}`;
      if (exists.get(url)) { skipped_dupe++; continue; }
      const CHAIN_BOOST = /multi.?location|franchise|franchisee|across locations|all our (stores|branches|locations)|each location|head office|multiple locations|chain of/i;
      const score = 30 + // base: passed PAIN filter = real signal
        (BUYER.test(text) ? 20 : 0) +
        (VIBE_BOOST.test(text) ? 15 : 0) +
        (CHAIN_BOOST.test(text) ? 15 : 0) +
        Math.min(10, Math.floor(p.score / 5));
      insert.run(
        randomUUID(), p.author || "unknown", `reddit_r_${sub}`, p.id, url,
        text.slice(0, 1500), score, NOW(), NOW(), NOW()
      );
      fresh.push({ sub, title: p.title, ageDays: Math.floor(ageDays), score, url });
      added++;
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  console.log(`[fresh-pain-scout] added=${added} old=${skipped_old} dupe=${skipped_dupe} nopain=${skipped_nopain}`);

  if (added > 0) {
    const top = fresh.sort((a, b) => b.score - a.score).slice(0, 5)
      .map(f => `• r/${f.sub} (${f.ageDays}d, score ${f.score}): ${f.title.slice(0, 80)}`).join("\n");
    await tg(`<b>🔍 fresh-pain-scout: ${added} new leads</b>\n\nTop 5:\n${top}\n\nAll verified ≤${MAX_AGE_DAYS}d old. Stored to leads table, stage=new.`);
  }
  db.close();
})();
