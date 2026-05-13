/**
 * calgary-local-pain-scout.mjs
 *
 * Scrapes r/Calgary, r/alberta, r/CalgaryFlames (active local subs) for posts
 * mentioning local SMB pain, hiring, recommendations for tools/services.
 *
 * Why: Calgary local prospects are Kirill's geographic moat. Solo consultants
 * compete globally on Reddit/HN/IH but locally Kirill can offer in-person
 * meetings, same timezone, and a local reference network.
 *
 * Built April 7 2026 to add channel diversity. Free, no API key, no subscription.
 */
import Database from "better-sqlite3";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";
import { randomUUID } from "crypto";
import { readPurpose, getWikiContext, appendLog } from "../../wiki/reader.mjs";

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
const NOW = () => new Date().toISOString();

const SUBS = ["Calgary", "alberta", "yyc", "Edmonton", "yyz_smallbusiness"];
const MAX_AGE_DAYS = 14;

// Local SMB pain signals
const PAIN = /\b(small business|local business|owner|hire|hiring|recommend|automation|automate|software|tool|spreadsheet|manual|admin|bookkeep|invoice|quote|schedul|customers|tradespeople|contractor|cleaning|landscape|hvac|plumb|electric|consultant|freelance|developer|programmer|automator)\b/i;
const BUYER = /\b(looking for|need|recommend|anyone know|can someone|how do i|where do i|best way to|hire|pay|budget|quote|cost|service)\b/i;

const exists = db.prepare(`SELECT 1 FROM leads WHERE source_url = ?`);
const insert = db.prepare(`
  INSERT INTO leads (id, name, source, source_platform, source_url, pain_description, score, stage, location, first_signal_at, created_at, updated_at, notes)
  VALUES (?, ?, 'calgary-local-pain-scout', ?, ?, ?, ?, 'new', 'Calgary, AB', ?, ?, ?, ?)
`);

async function tg(text) {
  if (!TG || !CHAT) return;
  await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT, text, parse_mode: "HTML", disable_web_page_preview: true }),
  }).catch(() => {});
}

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

(async () => {
  // Check if system-brain paused scouts
  const { existsSync: _fe } = await import("fs");
  if (_fe(import.meta.dirname + "/../../../../Desktop/linkedin-brand-os/.data/scouts-paused.flag") || _fe("$CLAUDE_PROJECT_DIR/.data/scouts-paused.flag")) { console.log(`[${scout}] PAUSED by system-brain`); process.exit(0); }
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
      const score = (BUYER.test(text) ? 12 : 5) + Math.min(8, Math.floor(p.score / 5)) + 5; // +5 local bonus
      const id = `cal-${p.id}`;
      insert.run(id, p.author || "unknown", `reddit_r_${sub}`, url, text.slice(0, 1500), score, NOW(), NOW(), NOW(), `Calgary local lead. Found by calgary-local-pain-scout ${NOW().slice(0, 10)}.`);
      fresh.push({ sub, title: p.title, ageDays: Math.floor(ageDays), score, url });
      added++;
    }
    await new Promise(r => setTimeout(r, 1500));
  }
  console.log(`[calgary-scout] added=${added} old=${skipped_old} dupe=${skipped_dupe} nopain=${skipped_nopain}`);

  if (added > 0) {
    const top = fresh.sort((a, b) => b.score - a.score).slice(0, 5)
      .map(f => `• r/${f.sub} (${f.ageDays}d, ${f.score}): ${f.title.slice(0, 80)}`).join("\n");
    await tg(`<b>🏔 calgary-local-pain-scout: ${added} new local leads</b>\n\nTop 5:\n${top}\n\nGeographic moat - same timezone, in-person possible, local reference network. All stored stage=new.`);
  }
  db.close();
})();
