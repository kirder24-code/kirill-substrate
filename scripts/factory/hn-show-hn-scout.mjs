/**
 * hn-show-hn-scout.mjs
 *
 * Free, unrate-limited Reddit alternative. Hunts HackerNews "Show HN" posts
 * with low upvotes (founders in MVP stage with small audience = high intent,
 * low competition for our comments).
 *
 * Uses Algolia HN search API - no auth, no rate limit at our scale.
 *
 * Built April 7 2026 because Reddit moved from 429 to 403, blocking our main
 * channel. Kirill needs more channels and has no budget for paid scraping.
 *
 * Pipeline: this scout writes leads with stage='new' and source_platform='hn_show_hn'.
 * The hourly research-bot-v2 + lead-enrichment-bot batch crons will pick them up.
 *
 * Run:
 *   node scripts/factory/hn-show-hn-scout.mjs
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
const NOW = () => new Date().toISOString();

async function tg(text) {
  if (!TG || !CHAT) return;
  await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT, text, parse_mode: "HTML", disable_web_page_preview: true }),
  }).catch(() => {});
}

// Algolia HN: tagged story, prefix Show HN, low upvote, last 14 days
const since = Math.floor(Date.now() / 1000) - 14 * 86400;
// CAP: max 20 per run - bulk-pull of 240 in one hour caused pipeline artifact (cycle 644 verdict)
const url = `https://hn.algolia.com/api/v1/search?tags=story&query=Show+HN&numericFilters=points%3E5,points%3C100,created_at_i%3E${since}&hitsPerPage=20`;

const findExisting = db.prepare(`SELECT 1 FROM leads WHERE source_url = ?`);
const insert = db.prepare(`
  INSERT INTO leads (id, name, source, source_platform, source_url, pain_description, score, stage, first_signal_at, created_at, updated_at, notes)
  VALUES (?, ?, 'hn-show-hn-scout', 'hn_show_hn', ?, ?, ?, 'new', ?, ?, ?, ?)
`);

(async () => {
  // Check if system-brain paused scouts
  const { existsSync: _fe } = await import("fs");
  if (_fe(import.meta.dirname + "/../../../../Desktop/linkedin-brand-os/.data/scouts-paused.flag") || _fe("$CLAUDE_PROJECT_DIR/.data/scouts-paused.flag")) { console.log(`[hn-show-hn-scout] PAUSED by system-brain`); process.exit(0); }
  let added = 0, skipped_dupe = 0, skipped_low = 0;
  const fresh = [];
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) {
      console.error(`[hn-scout] Algolia HTTP ${r.status}`);
      return;
    }
    const data = await r.json();
    const hits = (data.hits || []).slice(0, 20);
    console.log(`[hn-scout] Algolia returned ${data.hits?.length || 0} Show HN candidates (capped at ${hits.length})`);

    for (const h of hits) {
      const itemUrl = `https://news.ycombinator.com/item?id=${h.objectID}`;
      if (findExisting.get(itemUrl)) { skipped_dupe++; continue; }
      // Filter: must have a real product URL or be substantive
      if (!h.title || h.title.length < 15) { skipped_low++; continue; }
      const titleLower = (h.title || "").toLowerCase();
      const isMVP = /show hn|launch|built|shipping|my app|my saas|my tool|side project/i.test(titleLower);
      const hasAI = /ai|gpt|claude|llm|agent|automat/i.test(titleLower);
      const score = 35 + // base: Show HN = real builder with product
        (isMVP ? 15 : 0) +
        (hasAI ? 10 : 0) +
        Math.min(15, Math.floor(h.points / 2)) +
        (h.num_comments > 5 ? 5 : 0);
      const id = `hn-${h.objectID}`;
      const author = h.author || "anonymous";
      const desc = `Show HN: ${h.title}\nProduct URL: ${h.url || "(none)"}\nUpvotes: ${h.points}, Comments: ${h.num_comments}\nAuthor: ${author}`;
      insert.run(id, author, itemUrl, desc, score, NOW(), NOW(), NOW(), `Found via hn-show-hn-scout ${NOW().slice(0, 10)}. Low-upvote Show HN = MVP stage founder.`);
      fresh.push({ title: h.title, url: itemUrl, points: h.points, comments: h.num_comments, author });
      added++;
    }
  } catch (e) {
    console.error(`[hn-scout] error: ${e.message}`);
    return;
  }
  console.log(`[hn-scout] added=${added} dupe=${skipped_dupe} low=${skipped_low}`);

  if (added > 0) {
    const top = fresh.sort((a, b) => b.points - a.points).slice(0, 10)
      .map(f => `• ${f.points}↑ ${f.comments}c  ${f.title.slice(0, 80)}`).join("\n");
    await tg(`<b>📡 hn-show-hn-scout: ${added} new Show HN founders</b>

Source: HN Algolia API (free, no rate limit, no Reddit dependency).
Filter: Show HN, last 14 days, 5-100 upvotes, MVP stage founders.

Top 10:
${top}

All stored as leads stage=new. Next hourly crons will research + enrich them.`);
  }
  db.close();
})();
