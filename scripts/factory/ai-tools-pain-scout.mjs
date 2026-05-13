/**
 * ai-tools-pain-scout.mjs
 *
 * Hunts solo builders on Reddit + HN + X complaining about:
 *   - Cursor limits (context, pricing, rate limits)
 *   - Claude limits (context window, tokens, API cost)
 *   - AI QA pain (bugs ship because AI can't test its own output)
 *   - Vibe-code debt (moved fast, now broken)
 *
 * These are the "First 10 Customers" ICP: solo founder, ships with AI,
 * hits friction, ready to pay for a system that reduces the pain.
 *
 * Pipeline:
 *   Reddit + HN leads -> SQLite leads table (stage=new, source=ai-tools-pain-scout)
 *   X -> Telegram search links for manual comment outreach
 *   Telegram summary -> top prospects with outreach angles
 *
 * Built April 22 2026.
 */
import Database from "better-sqlite3";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync, existsSync } from "fs";
import { randomUUID } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const db = new Database(resolve(ROOT, ".data/linkedin-brand-os.sqlite"));
const env = Object.fromEntries(
  readFileSync(resolve(ROOT, "apps/api/.env"), "utf-8").split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const TG = env.TELEGRAM_BOT_TOKEN, CHAT = env.TELEGRAM_CHAT_ID;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const NOW = () => new Date().toISOString();

// ── Reddit: subs where AI-tools pain surfaces ──────────────────────────────
const SUBS = [
  "cursor",          // Cursor IDE - direct product complaints
  "ClaudeAI",        // Claude limits, API frustrations
  "vibecoding",      // vibe coders hitting walls
  "buildinpublic",   // solo founders shipping with AI
  "SaaS",            // SaaS founders with QA debt
  "microsaas",       // micro-SaaS with no QA budget
  "indiehackers",    // IH equivalent
  "learnprogramming",// beginners hit limits faster
  "webdev",          // "AI wrote this, now it's broken"
  "ExperiencedDevs", // backlash angle + switching signals
  "ChatGPTCoding",   // people trying GPT for code
  "LocalLLaMA",      // limit-escapers, very ICP
];

// Primary pain signals: must match at least one
const PAIN_TOOLS = /\b(cursor|claude|chatgpt|copilot|lovable|bolt\.new|v0|replit agent)\b/i;

// Pain context: limit, cost, broken, quality issues
const PAIN_CONTEXT = /\b(limit|rate.?limit|context.?window|token|ran out|hit.the.limit|too.?expensive|subscription|broke|broken|bug|crash|hallucin|wrong|fail|bad.?code|can.?t.?test|no.?qa|ship.?bug|regression|debt|refactor|mess|spaghetti|not.?work|stopped.work)\b/i;

// Buyer signals: actively looking for help
const BUYER = /\b(looking for|need help|any(one|body) (tried|used|know)|how do you|recommend|hire|paid|best.?(tool|way|service)|alternative|switch(ing)?|frustrat|done with)\b/i;

// Scoring boost: strong First 10 Customers signals
const F10_BOOST = /\b(first.?customer|first.?sale|first.?user|no.?traction|no.?revenue|just.?launched|pre-?launch|mvp|solo.?founder|indie.?(hacker|founder)|just.?me|side.?project|bootstrapp)\b/i;

const MAX_AGE_DAYS = 10;

async function fetchSubReddit(sub) {
  try {
    const r = await fetch(`https://www.reddit.com/r/${sub}/new.json?limit=30`, {
      headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) { console.log(`[reddit/${sub}] HTTP ${r.status}`); return []; }
    const data = await r.json();
    return (data?.data?.children || []).map(c => c.data);
  } catch (e) { console.log(`[reddit/${sub}] ${e.message}`); return []; }
}

// ── HN: Algolia search for AI-tools pain ──────────────────────────────────
const HN_QUERIES = [
  "cursor context limit",
  "claude context window limit",
  "vibe coding broke production",
  "AI generated code bug QA",
  "cursor rate limit frustrated",
  "claude API too expensive",
  "copilot wrong code shipped",
];

async function searchHN(query) {
  try {
    const since = Math.floor(Date.now() / 1000) - MAX_AGE_DAYS * 86400;
    const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=comment,story&numericFilters=created_at_i%3E${since}&hitsPerPage=20`;
    const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) { console.log(`[hn] HTTP ${r.status} for "${query}"`); return []; }
    const data = await r.json();
    return (data.hits || []);
  } catch (e) { console.log(`[hn] ${e.message}`); return []; }
}

// ── X search links (manual Telegram dispatch) ─────────────────────────────
const X_SEARCHES = [
  {
    label: "Cursor limit complaints",
    query: "(cursor IDE OR @cursor_ai) (limit OR context OR \"rate limit\" OR expensive OR broke) -job -hiring lang:en",
  },
  {
    label: "Claude limit frustration",
    query: "(@AnthropicAI OR claude) (context window OR token limit OR expensive OR API limit) solo founder OR indie hacker lang:en",
  },
  {
    label: "Vibe code debt / shipped bugs",
    query: "(\"vibe coded\" OR \"vibe coding\" OR lovable OR bolt.new) (broke OR bug OR production OR regression OR QA OR \"doesn't work\") lang:en",
  },
  {
    label: "Solo founder AI QA pain",
    query: "(solo founder OR indie hacker OR buildinpublic) (AI wrote OR cursor OR claude) (bug OR broken OR QA OR test OR \"shipped a bug\") lang:en",
  },
  {
    label: "Need AI dev help - paid",
    query: "(\"need help\" OR \"looking for\" OR hiring) (cursor OR claude OR AI development) (solo OR mvp OR saas OR freelance) -crypto lang:en",
  },
];

function buildXSearchUrl(query) {
  return `https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query&f=live`;
}

// ── Outreach sequence (embedded in lead notes) ────────────────────────────
function buildOutreachSequence(platform, author, painSignal) {
  const safe = painSignal.slice(0, 200).replace(/\n/g, " ");
  return [
    `OUTREACH SEQUENCE (First 10 Customers - AI tools pain):`,
    ``,
    `Touch 1 (comment, same day):`,
    `Reply to their post from a position of pattern recognition. e.g. "I've seen this same wall with Cursor - the context drops right when the file gets complex. What I do: split the session into a context file + main file. Still annoying but keeps it stable." No pitch. Just useful.`,
    ``,
    `Touch 2 (DM, 2-3 days after engagement):`,
    `"Hey - followed up on your [topic] post. We actually built a system that handles the QA gap Cursor leaves. Not a pitch - happy to share the pattern if it's relevant to what you're building."`,
    ``,
    `Touch 3 (offer, only if Touch 2 gets a reply):`,
    `"We do fixed-scope builds for solo founders: AI-assisted workflow with QA gates so you're not shipping blind. $1.5-2.5K CAD, 2 weeks, one system you own. Here's how it works: [launchsoloai.com]"`,
    ``,
    `Platform: ${platform} | Author: ${author}`,
    `Pain signal: ${safe}`,
  ].join("\n");
}

// ── DB helpers ────────────────────────────────────────────────────────────
const exists = db.prepare(`SELECT 1 FROM leads WHERE source_url = ?`);
const insert = db.prepare(`
  INSERT INTO leads
    (id, name, source, source_platform, source_url, pain_description, score, stage,
     first_signal_at, created_at, updated_at, notes)
  VALUES (?, ?, 'ai-tools-pain-scout', ?, ?, ?, ?, 'new', ?, ?, ?, ?)
`);

function scorePost(text, upvotes = 0) {
  let score = 0;
  if (BUYER.test(text)) score += 12;
  if (F10_BOOST.test(text)) score += 10;
  if (/paid|hire|budget|freelanc/i.test(text)) score += 15;
  if (/\$\d+|CAD|USD|per month|per week/i.test(text)) score += 8;
  if (/frustrated|done with|switching|gave up/i.test(text)) score += 6;
  score += Math.min(10, Math.floor((upvotes || 0) / 5));
  return score;
}

// ── Telegram ──────────────────────────────────────────────────────────────
async function tg(text) {
  if (!TG || !CHAT) return;
  const chunks = [];
  while (text.length > 0) {
    chunks.push(text.slice(0, 4000));
    text = text.slice(4000);
  }
  // Egress guard on full body before chunking
  const { safeSend } = await import("../lib/safe-send.mjs");
  const guard = await safeSend({ channel: "telegram", text: chunks.join("\n"), meta: { source: "ai-tools-pain-scout" } });
  if (!guard.ok) {
    console.error(`[ai-tools-pain-scout] BLOCKED by egress-guard: ${guard.egress_reason || guard.reason}`);
    return;
  }
  for (const chunk of chunks) {
    await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT, text: chunk, parse_mode: "HTML", disable_web_page_preview: true }),
    }).catch(() => {});
    if (chunks.length > 1) await new Promise(r => setTimeout(r, 300));
  }
}

// ── Main ──────────────────────────────────────────────────────────────────
(async () => {
  if (existsSync(resolve(ROOT, ".data/scouts-paused.flag"))) {
    console.log("[ai-tools-pain-scout] PAUSED by system-brain. Skipping.");
    db.close();
    return;
  }

  let added = 0, skipped_dupe = 0, skipped_nopain = 0, skipped_old = 0;
  const fresh = [];

  // ── Reddit pass ──────────────────────────────────────────────────────────
  for (const sub of SUBS) {
    const posts = await fetchSubReddit(sub);
    for (const p of posts) {
      const ageDays = (Date.now() / 1000 - p.created_utc) / 86400;
      if (ageDays > MAX_AGE_DAYS) { skipped_old++; continue; }
      const text = `${p.title}\n${p.selftext || ""}`;
      // Must mention an AI tool AND have pain context
      if (!PAIN_TOOLS.test(text) || !PAIN_CONTEXT.test(text)) { skipped_nopain++; continue; }
      const url = `https://reddit.com${p.permalink}`;
      if (exists.get(url)) { skipped_dupe++; continue; }

      const score = scorePost(text, p.score);
      const id = `aitools-${randomUUID().slice(0, 12)}`;
      const author = p.author || "unknown";
      const painSnip = text.slice(0, 1200);
      const notes = buildOutreachSequence(`reddit/r/${sub}`, author, painSnip);

      insert.run(id, author, "reddit", url, painSnip, score, NOW(), NOW(), NOW(), notes);
      fresh.push({ platform: `r/${sub}`, title: p.title, ageDays: Math.floor(ageDays), score, url, author });
      added++;
    }
    await new Promise(r => setTimeout(r, 700));
  }

  // ── HN pass ──────────────────────────────────────────────────────────────
  const seenHN = new Set();
  for (const q of HN_QUERIES) {
    const hits = await searchHN(q);
    for (const h of hits) {
      const itemUrl = `https://news.ycombinator.com/item?id=${h.objectID}`;
      if (seenHN.has(h.objectID)) continue;
      seenHN.add(h.objectID);
      if (exists.get(itemUrl)) { skipped_dupe++; continue; }

      const text = `${h.title || ""} ${h.comment_text || h.story_text || ""}`;
      if (!PAIN_TOOLS.test(text) && !PAIN_CONTEXT.test(text)) { skipped_nopain++; continue; }

      const score = scorePost(text, h.points || 0);
      const id = `aitools-hn-${h.objectID}`;
      const author = h.author || "anonymous";
      const painSnip = text.slice(0, 1200);
      const notes = buildOutreachSequence("hacker-news", author, painSnip);

      insert.run(id, author, "hn", itemUrl, painSnip, score, NOW(), NOW(), NOW(), notes);
      fresh.push({ platform: "HN", title: (h.title || h.comment_text || "HN item").slice(0, 80), ageDays: 0, score, url: itemUrl, author });
      added++;
    }
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`[ai-tools-pain-scout] added=${added} old=${skipped_old} dupe=${skipped_dupe} nopain=${skipped_nopain}`);

  // ── Telegram: X search links ─────────────────────────────────────────────
  const xLinks = X_SEARCHES.map((s, i) =>
    `${i + 1}. <b>${s.label}</b>\n<a href="${buildXSearchUrl(s.query)}">Open X search</a>`
  ).join("\n\n");

  await tg([
    `<b>AI-Tools Pain Scout - X search links</b>`,
    ``,
    `Solo builders hitting Cursor/Claude limits. Open each, reply with pattern recognition. No pitch.`,
    ``,
    xLinks,
    ``,
    `Goal: 2-3 replies per session. Comment first, DM only after engagement.`,
  ].join("\n"));

  // ── Telegram: DB results ─────────────────────────────────────────────────
  if (added > 0) {
    const top = fresh.sort((a, b) => b.score - a.score).slice(0, 8)
      .map(f => `- [${f.platform}] <b>${f.author}</b> (${f.ageDays}d, score ${f.score})\n  ${f.title.slice(0, 90)}`).join("\n");

    await tg([
      `<b>AI-Tools Pain Scout: ${added} new leads stored</b>`,
      ``,
      `ICP: solo builders hitting Cursor/Claude limits and AI QA gaps.`,
      `Offer angle: First 10 Customers - fixed-scope AI workflow build, $1.5-2.5K CAD, 2 weeks.`,
      ``,
      `Top ${Math.min(8, fresh.length)}:`,
      top,
      ``,
      `All stored to leads table, stage=new, source=ai-tools-pain-scout.`,
      `Each lead has 3-touch outreach sequence in notes field.`,
    ].join("\n"));
  } else {
    console.log("[ai-tools-pain-scout] 0 new leads - all dupes or no pain match");
  }

  db.close();
})();
