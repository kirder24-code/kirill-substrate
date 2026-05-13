/**
 * DISCONTINUED - Voice agent product was killed April 22, 2026.
 * This file is no longer active. Do not import or call any functions from it.
 * Kept for reference only.
 */

/**
 * missed-call-scout.mjs
 *
 * Finds businesses that publicly advertise missed-call text-back, call-now
 * widgets, or after-hours callback language on their own websites.
 *
 * Insight: a business that already promotes "text us if we miss your call"
 * or "call now - we answer 24/7" on their site:
 *   - Already knows missed calls cost them revenue
 *   - Has tried to patch the problem themselves (or with a cheap widget)
 *   - Is primed for "here is why an AI receptionist does this better"
 *
 * Verticals: HVAC, plumbing, dental, law
 * Outreach angle: "You already know missed calls hurt you - our AI receptionist
 * answers every call, qualifies the lead, and books the appointment automatically."
 *
 * Built April 2026. Uses webSearch (Brave -> Google CSE -> DDG).
 * Stores leads to SQLite with source='missed-call-scout', stage='new'.
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

// Search queries targeting businesses that surface missed-call evidence publicly.
// Each query finds sites where the business themselves put this language.
const QUERIES = [
  // HVAC - missed call text-back language
  { q: '"missed call text back" HVAC site:.com',                          vertical: "hvac" },
  { q: '"text us back" HVAC "heating" "cooling" site:.com',              vertical: "hvac" },
  { q: '"we\'ll text you back" HVAC OR furnace OR "air conditioning"',   vertical: "hvac" },
  { q: '"missed your call" HVAC site:.com -reddit -yelp -yellowpages',   vertical: "hvac" },
  { q: '"after hours" HVAC "text us" site:.com',                         vertical: "hvac" },
  { q: '"call now" "we answer" HVAC heating cooling site:.com',          vertical: "hvac" },

  // Plumbing - missed call / after-hours signals
  { q: '"missed call text back" plumber OR plumbing site:.com',          vertical: "plumbing" },
  { q: '"text us if we miss your call" plumber site:.com',               vertical: "plumbing" },
  { q: '"after hours" plumber "call us" site:.com -reddit -yelp',        vertical: "plumbing" },
  { q: '"we\'ll call you back" plumbing site:.com',                      vertical: "plumbing" },
  { q: '"24 hour" plumber "missed call" OR "text us" site:.com',         vertical: "plumbing" },

  // Dental - call-now / text-back widgets
  { q: '"call us now" dentist site:.com -yelp -zocdoc -healthgrades',    vertical: "dental" },
  { q: '"missed call text back" dentist OR dental site:.com',            vertical: "dental" },
  { q: '"text us" dentist "we\'ll call you back" site:.com',             vertical: "dental" },
  { q: '"after hours" dental "leave a message" OR "we\'ll get back"',    vertical: "dental" },
  { q: '"call back" dentist "missed your call" site:.com',               vertical: "dental" },

  // Law firms - after-hours / callback language
  { q: '"after hours" "law firm" "call us" site:.com',                   vertical: "legal" },
  { q: '"missed call" "law firm" "text us" site:.com',                   vertical: "legal" },
  { q: '"call now" "attorney" "we answer" site:.com -findlaw -avvo',     vertical: "legal" },
  { q: '"available 24" attorney OR lawyer "call us" site:.com',          vertical: "legal" },
  { q: '"text back" lawyer OR attorney "missed your call" site:.com',    vertical: "legal" },

  // Veterinary clinics / emergency animal hospitals - after-hours overflow demand
  { q: '"24/7 emergency vet" site:.com',                                          vertical: "vet" },
  { q: '"after hours" "animal hospital" site:.com -yelp -yellowpages',            vertical: "vet" },
  { q: '"call us immediately" veterinarian site:.com',                            vertical: "vet" },
  { q: '"if we miss your call" vet site:.com',                                    vertical: "vet" },
  { q: '"emergency animal hospital" "leave a message" site:.com',                 vertical: "vet" },
  { q: '"after hours" "veterinary clinic" "call us" site:.com',                   vertical: "vet" },
  { q: '"on call" veterinarian "text us" OR "call back" site:.com',               vertical: "vet" },

  // Calgary-specific - all verticals
  { q: '"missed call" Calgary HVAC OR plumber OR dentist OR lawyer',     vertical: "calgary" },
  { q: '"text us back" Calgary trades OR dental OR legal',               vertical: "calgary" },
  { q: '"after hours" Calgary "call us" HVAC OR plumbing OR dental',     vertical: "calgary" },
  { q: '"after hours" Calgary "animal hospital" OR "vet clinic"',        vertical: "calgary" },

  // Reddit - plumber missed calls (community pain discussions)
  { q: 'site:reddit.com plumber missed calls',                                    vertical: "plumbing_reddit" },
  { q: 'site:reddit.com hvac "after hours" calls',                                vertical: "hvac_reddit" },
  { q: 'site:reddit.com "med spa" "no receptionist"',                             vertical: "med_spa" },
  { q: 'site:reddit.com "dental office" "phones busy"',                           vertical: "dental_reddit" },
  { q: 'site:reddit.com "law firm" "answering calls"',                            vertical: "legal_reddit" },
  { q: 'site:reddit.com "property management" "tenant emergency" calls',          vertical: "property_mgmt" },

  // Web - roofing, urgent care, home services missed-call intent
  { q: '"roofing" "missed calls" site:.com -reddit -yelp',                        vertical: "roofing" },
  { q: '"urgent care" "phone overflow" OR "calls going to voicemail" site:.com',  vertical: "urgent_care" },
  { q: '"home services" "after hours answering" site:.com',                        vertical: "home_services" },

  // Review-mining: businesses with VISIBLE reputational damage from phone failures
  // These queries find third-party complaints (Google reviews, Reddit, Yelp discussions)
  // where customers publicly call out a business for not answering - the strongest
  // possible pain signal because the damage is already public and costing them leads.

  // Dentist - customer reviews complaining about phone handling
  { q: '"never answer the phone" dentist',                                         vertical: "review_dental" },
  { q: '"never answer the phone" dentist Calgary',                                 vertical: "review_dental_calgary" },
  { q: '"hard to reach by phone" dentist OR "dental office"',                      vertical: "review_dental" },
  { q: '"impossible to reach" dentist site:google.com OR site:yelp.com',           vertical: "review_dental" },
  { q: '"no one answers" dentist OR "dental clinic" -site:dentist.com',            vertical: "review_dental" },
  { q: '"phone always busy" dentist OR "dental office"',                           vertical: "review_dental" },

  // Med spa / aesthetics - appointment-driven, high-ticket, review-visible
  { q: '"hard to reach by phone" "med spa" OR "medical spa" OR medspa',            vertical: "review_med_spa" },
  { q: '"never answer the phone" "med spa" OR "medical spa" OR medspa',            vertical: "review_med_spa" },
  { q: '"no one answers" "med spa" OR aesthetics clinic',                           vertical: "review_med_spa" },
  { q: '"phone always busy" "med spa" OR "skin clinic" OR "laser clinic"',          vertical: "review_med_spa" },
  { q: '"impossible to book" "med spa" "phone" OR "call"',                          vertical: "review_med_spa" },

  // Law firms - clients frustrated by phone access
  { q: '"never answer the phone" "law firm" OR attorney OR lawyer',                 vertical: "review_legal" },
  { q: '"hard to reach by phone" "law firm" OR attorney',                           vertical: "review_legal" },
  { q: '"no one answers" "law firm" OR "legal office"',                             vertical: "review_legal" },
  { q: '"phone always busy" lawyer OR attorney OR "law office"',                    vertical: "review_legal" },
  { q: '"impossible to reach" attorney OR lawyer -site:avvo.com -site:findlaw.com', vertical: "review_legal" },

  // Clinic / healthcare - appointment-driven, high call volume
  { q: '"phone always busy" clinic OR "medical clinic" OR "walk-in"',               vertical: "review_clinic" },
  { q: '"never answer the phone" clinic OR "family doctor" OR "GP office"',         vertical: "review_clinic" },
  { q: '"hard to reach by phone" clinic OR "health clinic"',                        vertical: "review_clinic" },
  { q: '"no one answers" "medical clinic" OR "urgent care" OR "walk-in clinic"',    vertical: "review_clinic" },
  { q: '"always goes to voicemail" clinic OR doctor OR "medical office"',            vertical: "review_clinic" },

  // Chiropractor / physio / PT - high repeat-visit, phone-reliant booking
  { q: '"never answer the phone" chiropractor OR "physio" OR "physiotherapy"',      vertical: "review_allied_health" },
  { q: '"hard to reach by phone" chiropractor OR "physical therapy"',               vertical: "review_allied_health" },
  { q: '"no one answers" chiropractor OR physiotherapist OR "massage therapy"',      vertical: "review_allied_health" },

  // Veterinary - urgent call nature makes bad phone handling especially painful
  { q: '"never answer the phone" vet OR veterinarian OR "animal clinic"',            vertical: "review_vet" },
  { q: '"hard to reach by phone" vet OR "veterinary clinic"',                        vertical: "review_vet" },
  { q: '"no one answers" vet OR veterinarian OR "animal hospital"',                  vertical: "review_vet" },
  { q: '"phone always busy" veterinarian OR "pet clinic" OR "animal hospital"',      vertical: "review_vet" },

  // Calgary-specific review-mining
  { q: '"never answer the phone" Calgary dentist OR clinic OR "med spa" OR lawyer',  vertical: "review_calgary" },
  { q: '"hard to reach by phone" Calgary business OR clinic OR office',              vertical: "review_calgary" },
  { q: '"no one answers" Calgary dentist OR vet OR clinic OR lawyer',                vertical: "review_calgary" },
  { q: '"phone always busy" Calgary clinic OR "dental office" OR lawyer',            vertical: "review_calgary" },

  // Reddit - business owners describing their own phone overload
  { q: 'site:reddit.com "phones ringing off the hook" business owner',              vertical: "reddit_phone_pain" },
  { q: 'site:reddit.com "can\'t keep up with calls" small business',                vertical: "reddit_phone_pain" },
  { q: 'site:reddit.com "missing calls" "small business" OR "solo" OR "owner"',     vertical: "reddit_phone_pain" },
  { q: 'site:reddit.com "losing clients" "phone" OR "calls" small business',        vertical: "reddit_phone_pain" },
  { q: 'site:reddit.com "too many calls" "can\'t answer" business',                 vertical: "reddit_phone_pain" },
  { q: 'site:reddit.com "appointment booking" "phone" "overwhelmed" business',      vertical: "reddit_phone_pain" },

  // Edmonton geo-specific complaint queries
  { q: 'Edmonton dentist "never answers phone" OR "hard to reach" OR "no one answers"',       vertical: "review_dental_edmonton" },
  { q: 'Edmonton "med spa" "missed calls" OR "never answers" OR "hard to reach" phone',       vertical: "review_med_spa_edmonton" },
  { q: 'Edmonton HVAC "after hours answering" OR "no one answers" OR "missed calls"',          vertical: "hvac_edmonton" },
  { q: 'Edmonton plumber "missed calls" OR "never answers" OR "after hours" phone',            vertical: "plumbing_edmonton" },
  { q: 'Edmonton "law firm" OR lawyer "no one answers" OR "hard to reach" phone',              vertical: "review_legal_edmonton" },
  { q: 'Edmonton "missed call" HVAC OR plumber OR dentist OR lawyer',                          vertical: "edmonton" },
  { q: 'Edmonton "after hours" "call us" HVAC OR plumbing OR dental',                          vertical: "edmonton" },

  // Nearby Alberta cities - complaint and replacement-intent
  { q: '"Red Deer" OR "Lethbridge" OR "Airdrie" dentist "never answers" OR "hard to reach"',  vertical: "review_dental_calgary" },
  { q: '"Red Deer" OR "Lethbridge" OR "Airdrie" HVAC OR plumber "missed calls" OR "no answer"', vertical: "calgary" },
  { q: '"Fort McMurray" OR "Grande Prairie" dentist OR "med spa" "missed calls"',              vertical: "review_dental_calgary" },
  { q: '"Airdrie" OR "Cochrane" OR "Okotoks" dentist OR "med spa" "never answers"',            vertical: "review_dental_calgary" },

  // Facebook-specific complaint and replacement-intent queries
  { q: 'site:facebook.com "law firm" "no one answers" OR "never answers phone"',               vertical: "review_legal_facebook" },
  { q: 'site:facebook.com Calgary dentist "missed call" OR "hard to reach" OR "no answer"',    vertical: "review_dental_calgary" },
  { q: 'site:facebook.com "med spa" "missed calls" OR "never answers" Calgary OR Edmonton',    vertical: "review_med_spa_facebook" },
  { q: 'site:facebook.com HVAC OR plumber Calgary "no one answers" OR "after hours"',          vertical: "calgary" },

  // Replacement-intent: businesses actively looking for an answering solution
  { q: 'Calgary "answering service" dental OR dentist OR "med spa" OR clinic',                 vertical: "replacement_intent_calgary" },
  { q: 'Calgary HVAC "after hours answering service" OR "virtual receptionist"',               vertical: "replacement_intent_calgary" },
  { q: '"answering service" plumber Calgary OR Edmonton OR Alberta',                            vertical: "replacement_intent_calgary" },
  { q: 'site:reddit.com plumber "missing calls" booking OR appointment',                       vertical: "plumbing_reddit" },
  { q: 'site:reddit.com "med spa" "missed calls" OR "no receptionist" OR "phone overflow"',    vertical: "med_spa" },
];

const exists = db.prepare(`SELECT 1 FROM leads WHERE source_url = ?`);
const insert = db.prepare(`
  INSERT INTO leads
    (id, name, source, source_platform, source_url, pain_description, score, stage,
     first_signal_at, created_at, updated_at, notes)
  VALUES (?, ?, 'missed-call-scout', ?, ?, ?, ?, 'new', ?, ?, ?, ?)
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
  let score = 25; // base: explicit missed-call language = strong AI receptionist intent signal

  // Vertical bonuses
  if (vertical === "dental")          score += 15;
  if (vertical === "dental_reddit")   score += 14;
  if (vertical === "vet")             score += 15;
  if (vertical === "legal")           score += 14;
  if (vertical === "legal_reddit")    score += 13;
  if (vertical === "hvac")            score += 13;
  if (vertical === "hvac_reddit")     score += 12;
  if (vertical === "plumbing")        score += 13;
  if (vertical === "plumbing_reddit") score += 12;
  if (vertical === "med_spa")         score += 16; // high-ticket, appointment-driven
  if (vertical === "property_mgmt")   score += 12;
  if (vertical === "roofing")               score += 13;
  if (vertical === "urgent_care")           score += 15; // high call volume, overflow pain
  if (vertical === "home_services")         score += 12;
  if (vertical === "calgary")               score += 18; // local = highest value

  // Review-mining verticals: public reputational damage = highest intent signal
  if (vertical === "review_dental")         score += 20; // visible complaint = active pain
  if (vertical === "review_dental_calgary") score += 28; // local + active pain = top priority
  if (vertical === "review_med_spa")        score += 22; // high-ticket + appointment = prime fit
  if (vertical === "review_legal")          score += 20; // professional, budget exists
  if (vertical === "review_clinic")         score += 19; // high call volume, repeat visits
  if (vertical === "review_allied_health")  score += 17; // physio/chiro, steady volume
  if (vertical === "review_vet")            score += 20; // urgent calls, emotional stakes
  if (vertical === "review_calgary")             score += 26; // local + public complaint = act now
  if (vertical === "reddit_phone_pain")          score += 18; // owner articulating own pain
  if (vertical === "review_dental_edmonton")     score += 22; // Edmonton local = high value
  if (vertical === "review_med_spa_edmonton")    score += 22; // high-ticket Edmonton
  if (vertical === "hvac_edmonton")              score += 18; // Edmonton HVAC geo
  if (vertical === "plumbing_edmonton")          score += 18; // Edmonton plumbing geo
  if (vertical === "review_legal_edmonton")      score += 20; // Edmonton legal
  if (vertical === "edmonton")                   score += 18; // Edmonton multi-vertical
  if (vertical === "review_legal_facebook")      score += 20; // Facebook complaint = public pain
  if (vertical === "review_med_spa_facebook")    score += 22; // Facebook med spa complaint
  if (vertical === "replacement_intent_calgary") score += 24; // actively seeking solution = hottest signal

  // Review-mining signals: third-party complaints about phone failures
  if (/never answer the phone|hard to reach by phone|no one answers|phone always busy|impossible to reach|always goes to voicemail|ringing off the hook|can.t keep up with calls/i.test(text)) score += 25;
  // Explicit missed-call signals (strongest possible intent)
  if (/missed.?call.?text|text.?us.?back|text.?back|we.?ll.?text.?you/i.test(text)) score += 20;
  // After-hours signals (implies lost leads daily)
  if (/after.hours|evenings|weekends|24.?7|on.?call|overnight/i.test(text)) score += 15;
  // Call-now / urgency signals
  if (/call.?us.?now|call.?now|answer.*24|we.?answer|always.?available/i.test(text)) score += 12;
  // Small / independent signals (better fit than large chains)
  if (/family.owned|locally.owned|independent|single.location|small (practice|office)/i.test(text)) score += 10;
  // Location bonus
  if (/calgary|alberta/i.test(text)) score += 15;
  if (/edmonton|red deer|lethbridge|airdrie|cochrane|okotoks|fort mcmurray|grande prairie/i.test(text)) score += 12;
  if (/canada|toronto|vancouver|ontario/i.test(text)) score += 8;

  return score;
}

(async () => {
  if (existsSync(resolve(ROOT, ".data/scouts-paused.flag"))) {
    console.log("[missed-call-scout] PAUSED by system-brain. Skipping.");
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
      console.log(`[missed-call-scout] search error for "${q}": ${e.message}`);
      results = [];
    }

    for (const r of results) {
      if (!r.url) continue;
      if (exists.get(r.url)) { skipped_dupe++; continue; }

      const score = scoreResult(r.title || "", r.snippet || "", vertical);
      const id = `missedcall-${randomUUID().slice(0, 12)}`;
      const name = (r.title || "").replace(/\s*[\|\-].*$/, "").trim().slice(0, 120) || "Missed-call lead";
      const pain = `[${vertical}] ${r.title || ""}\n${r.snippet || ""}`.slice(0, 1500);
      const note = `Missed-call evidence signal. Vertical: ${vertical}. Outreach angle: You already know missed calls cost you - our AI receptionist answers every call, qualifies the lead, and books the appointment automatically. Query: ${q}`;

      insert.run(id, name, vertical, r.url, pain, score, NOW(), NOW(), NOW(), note);
      fresh.push({ vertical, title: r.title || r.url, score, url: r.url });
      added++;
    }

    // Rate limit: 1.2s between search API calls
    await new Promise(res => setTimeout(res, 1200));
  }

  console.log(`[missed-call-scout] added=${added} dupes=${skipped_dupe}`);

  if (added > 0) {
    const top = fresh.sort((a, b) => b.score - a.score).slice(0, 5)
      .map(f => `- [${f.vertical}] ${(f.title || "").slice(0, 80)} (score ${f.score})`).join("\n");
    await tg(
      `<b>Missed-call scout: ${added} new leads</b>\n\nThese businesses publicly advertise missed-call text-back or after-hours callback language - they already know they lose phone leads.\n\nAngle: "You already know missed calls cost you - our AI receptionist answers every call and books the appointment."\n\nTop ${Math.min(5, fresh.length)}:\n${top}\n\nStored to leads table, stage=new, source=missed-call-scout.`
    );
  }

  db.close();
})();
