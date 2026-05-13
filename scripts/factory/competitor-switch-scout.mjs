/**
 * DISCONTINUED - Voice agent product was killed April 22, 2026.
 * This file is no longer active. Do not import or call.
 * Kept for reference only.
 */
/**
 * competitor-switch-scout.mjs
 *
 * Finds businesses publicly advertising their use of human/legacy answering services
 * (PATLive, Ruby Receptionist, Smith.ai, AnswerConnect, etc.) on social media and
 * review sites. These prospects are already paying for call coverage -- the switch
 * angle is: lower cost, zero rigidity, immediate setup.
 *
 * Outreach angle: "You already solved the missed-call problem with [Competitor].
 * Our AI receptionist costs less, never calls in sick, and is live in 24 hours."
 *
 * Built April 2026. Uses webSearch (Brave/Google CSE fallback).
 * Stores leads to SQLite with source='competitor-switch-scout', stage='new'.
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

// Competitor service name -> normalized label used in pain_description and notes
const COMPETITOR_LABELS = {
  "PATLive":          "PATLive",
  "Ruby Receptionist":"Ruby Receptionist",
  "Smith.ai":         "Smith.ai",
  "AnswerConnect":    "AnswerConnect",
  "VoiceNation":      "VoiceNation",
  "MAP Communications":"MAP Communications",
  "answering service":"generic-answering-service",
};

// Search queries targeting businesses that publicly name their answering service
const QUERIES = [
  // Facebook: business pages mentioning competitors in posts/about
  { q: 'site:facebook.com "PATLive" dentist',                         competitor: "PATLive",           vertical: "dental" },
  { q: 'site:facebook.com "PATLive" law firm',                        competitor: "PATLive",           vertical: "legal" },
  { q: 'site:facebook.com "PATLive" HVAC',                            competitor: "PATLive",           vertical: "hvac" },
  { q: 'site:facebook.com "PATLive" plumber',                         competitor: "PATLive",           vertical: "trades" },
  { q: 'site:facebook.com "Ruby Receptionist" dentist',               competitor: "Ruby Receptionist", vertical: "dental" },
  { q: 'site:facebook.com "Ruby Receptionist" law firm',              competitor: "Ruby Receptionist", vertical: "legal" },
  { q: 'site:facebook.com "Ruby Receptionist" HVAC plumber',          competitor: "Ruby Receptionist", vertical: "trades" },
  { q: 'site:facebook.com "Smith.ai" dentist',                        competitor: "Smith.ai",          vertical: "dental" },
  { q: 'site:facebook.com "Smith.ai" law firm',                       competitor: "Smith.ai",          vertical: "legal" },
  { q: 'site:facebook.com "Smith.ai" small business',                 competitor: "Smith.ai",          vertical: "smb" },
  { q: 'site:facebook.com "answering service" HVAC heating cooling',  competitor: "generic-answering-service", vertical: "hvac" },
  { q: 'site:facebook.com "answering service" plumber drain',         competitor: "generic-answering-service", vertical: "trades" },
  // Instagram: tagged posts / bios that name a competitor
  { q: 'site:instagram.com "Ruby Receptionist" law firm',             competitor: "Ruby Receptionist", vertical: "legal" },
  { q: 'site:instagram.com "Ruby Receptionist" dentist',              competitor: "Ruby Receptionist", vertical: "dental" },
  { q: 'site:instagram.com "Smith.ai" small business',                competitor: "Smith.ai",          vertical: "smb" },
  { q: 'site:instagram.com "answering service" HVAC',                 competitor: "generic-answering-service", vertical: "hvac" },
  // Direct mentions with company name in quotes (catch any indexed page)
  { q: '"Smith.ai" plumber site:yelp.com OR site:google.com',         competitor: "Smith.ai",          vertical: "trades" },
  { q: '"Smith.ai" HVAC site:yelp.com OR site:google.com',            competitor: "Smith.ai",          vertical: "hvac" },
  { q: '"Ruby Receptionist" HVAC site:yelp.com OR site:google.com',   competitor: "Ruby Receptionist", vertical: "hvac" },
  { q: '"answering service provided by" HVAC',                        competitor: "generic-answering-service", vertical: "hvac" },
  { q: '"answering service provided by" plumber',                     competitor: "generic-answering-service", vertical: "trades" },
  { q: '"answering service provided by" dentist',                     competitor: "generic-answering-service", vertical: "dental" },
  { q: '"answering service provided by" law firm',                    competitor: "generic-answering-service", vertical: "legal" },
  { q: '"answering service provided by" accountant',                  competitor: "generic-answering-service", vertical: "professional" },
  // Complaint / dissatisfaction signals -- highest intent for a switch
  { q: '"PATLive" expensive OR "too expensive" OR "cancel" OR "cancelled"',    competitor: "PATLive",           vertical: "smb" },
  { q: '"Ruby Receptionist" expensive OR "too expensive" OR "cancel"',         competitor: "Ruby Receptionist", vertical: "smb" },
  { q: '"Smith.ai" expensive OR "overpriced" OR "cancel" OR "cancelled"',      competitor: "Smith.ai",          vertical: "smb" },
  { q: '"AnswerConnect" expensive OR "cancel" OR "unhappy" OR "switch"',       competitor: "AnswerConnect",     vertical: "smb" },
  { q: '"VoiceNation" switch OR expensive OR "looking for alternative"',       competitor: "VoiceNation",       vertical: "smb" },
  // Review pages where businesses compare services (comparison content = in-market)
  { q: '"PATLive vs" OR "vs PATLive" answering service',                       competitor: "PATLive",           vertical: "smb" },
  { q: '"Smith.ai vs" OR "vs Smith.ai" answering service',                     competitor: "Smith.ai",          vertical: "smb" },
  { q: '"Ruby Receptionist vs" OR "vs Ruby Receptionist"',                     competitor: "Ruby Receptionist", vertical: "smb" },
  // Calgary / Canada regional
  { q: '"answering service" HVAC Calgary Alberta',                             competitor: "generic-answering-service", vertical: "hvac" },
  { q: '"answering service" plumber Calgary',                                  competitor: "generic-answering-service", vertical: "trades" },
  { q: '"answering service" dentist Calgary',                                  competitor: "generic-answering-service", vertical: "dental" },
  { q: '"MAP Communications" OR "AnswerConnect" OR "VoiceNation" Canada',      competitor: "AnswerConnect",     vertical: "smb" },
];

// Source URLs that are noise (comparison articles, not real businesses)
const NOISE_URL_PATTERNS = [
  /blog\.smith\.ai/, /blog\.ruby\.com/, /patlive\.com\/blog/,
  /capterra\.com/, /g2\.com/, /trustpilot\.com\/review\/patlive/,
  /getapp\.com/, /softwareadvice\.com/,
];

const exists = db.prepare(`SELECT 1 FROM leads WHERE source_url = ?`);
const insert = db.prepare(`
  INSERT INTO leads
    (id, name, source, source_platform, source_url, pain_description, score, stage,
     first_signal_at, created_at, updated_at, notes)
  VALUES (?, ?, 'competitor-switch-scout', ?, ?, ?, ?, 'new', ?, ?, ?, ?)
`);

async function tg(text) {
  if (!TG || !CHAT) return;
  await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT, text, parse_mode: "HTML", disable_web_page_preview: true }),
  }).catch(() => {});
}

function isNoise(url) {
  return NOISE_URL_PATTERNS.some(p => p.test(url));
}

function scoreResult(title, snippet, vertical, competitor) {
  const text = `${title} ${snippet}`.toLowerCase();
  let score = 25; // base: already paying for answering service = confirmed budget
  // Vertical bonuses
  if (vertical === "dental" || vertical === "medical" || vertical === "health") score += 15;
  if (vertical === "legal") score += 14;
  if (vertical === "hvac" || vertical === "trades") score += 12;
  if (vertical === "salon") score += 10;
  // Dissatisfaction signals -- highest priority for switch outreach
  if (/expens|too much|overpric|cancel|unhappy|frustrat|slow|miss(ed)? call|switch|alternative|replace/i.test(text)) score += 25;
  // Comparison intent
  if (/\bvs\b|compare|alternative|best/i.test(text)) score += 10;
  // Small business signals
  if (/small (practice|office|team|business)|independent|family.owned|solo/i.test(text)) score += 8;
  // Location bonus
  if (/calgary|alberta|edmonton/i.test(text)) score += 15;
  if (/canada|toronto|vancouver|ontario/i.test(text)) score += 8;
  // After-hours pain
  if (/after.hours|weekend|24.?7|on.call|overflow/i.test(text)) score += 12;
  // Competitor is a premium-priced service (extra motivation to switch)
  if (competitor === "Ruby Receptionist" || competitor === "Smith.ai") score += 5;
  return score;
}

(async () => {
  if (existsSync(resolve(ROOT, ".data/scouts-paused.flag"))) {
    console.log("[competitor-switch-scout] PAUSED by system-brain. Skipping.");
    db.close();
    return;
  }

  let added = 0, skipped_dupe = 0, skipped_noise = 0;
  const fresh = [];

  for (const { q, competitor, vertical } of QUERIES) {
    let results;
    try {
      results = await webSearch(q, 5);
    } catch (e) {
      console.log(`[competitor-switch] search error for "${q}": ${e.message}`);
      results = [];
    }

    for (const r of results) {
      if (!r.url) continue;
      if (isNoise(r.url)) { skipped_noise++; continue; }
      if (exists.get(r.url)) { skipped_dupe++; continue; }

      const score = scoreResult(r.title || "", r.snippet || "", vertical, competitor);
      const id = `compswitch-${randomUUID().slice(0, 12)}`;
      const name = (r.title || "").replace(/\s*[\|\-].*$/, "").trim().slice(0, 120) || "Competitor-switch lead";
      const pain = `[${vertical}] Using ${competitor}\n${r.title || ""}\n${r.snippet || ""}`.slice(0, 1500);
      const note = `Competitor-switch. Already paying for ${competitor}. Outreach angle: switch to AI receptionist - lower cost, no sick days, live in 24h. Query: ${q}`;

      insert.run(id, name, vertical, r.url, pain, score, NOW(), NOW(), NOW(), note);
      fresh.push({ vertical, competitor, title: r.title || r.url, score, url: r.url });
      added++;
    }

    await new Promise(res => setTimeout(res, 1200));
  }

  console.log(`[competitor-switch-scout] added=${added} dupes=${skipped_dupe} noise=${skipped_noise}`);

  if (added > 0) {
    const top = fresh.sort((a, b) => b.score - a.score).slice(0, 5)
      .map(f => `- [${f.vertical}/${f.competitor}] ${(f.title || "").slice(0, 80)} (score ${f.score})`).join("\n");
    await tg(
      `<b>Competitor-switch scout: ${added} new leads</b>\n\nThese businesses already pay for ${[...new Set(fresh.map(f => f.competitor))].join(", ")}. Angle: switch to AI receptionist - lower cost, no sick days, live in 24h.\n\nTop ${Math.min(5, fresh.length)}:\n${top}\n\nStored to leads table, stage=new, source=competitor-switch-scout.`
    );
  }

  db.close();
})();
