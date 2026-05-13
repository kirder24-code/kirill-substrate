/**
 * ih-products-scout.mjs
 *
 * IndieHackers Products scout via their public Algolia search API.
 * Found by inspecting their HTML on Apr 9 2026 - search-only key is exposed
 * client-side (read-only, intentionally public).
 *
 * Why this beats Apify Twitter:
 *   - Each result is a self-identified founder with stated product
 *   - Tags include founders-solo, employees-0, stripe-verified-revenue
 *   - Has direct twitterHandle for contact
 *   - Has revenue signal (sometimes Stripe-verified)
 *   - 100% free, no Apify, no Claude
 *
 * Filters for Kirill's ICP:
 *   - founders-solo
 *   - revenue > 0 (someone actually paid them) OR stripe-verified-revenue tag
 *   - createdTimestamp within last 120 days (recent launch = post-launch crisis window)
 *   - skip if revenue too high ($10K+ MRR = beyond first-10 stage)
 */
import Database from "better-sqlite3";
import { readFileSync, existsSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import { readPurpose, appendLog } from "../../wiki/reader.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DB_PATH = resolve(ROOT, ".data/linkedin-brand-os.sqlite");

const env = Object.fromEntries(
  readFileSync(resolve(ROOT, "apps/api/.env"), "utf-8").split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const TG = env.TELEGRAM_BOT_TOKEN;
const TG_CHAT = env.TELEGRAM_CHAT_ID;

const ALGOLIA_APP = "N86T1R3OWZ";
const ALGOLIA_KEY = "5140dac5e87f47346abbda1a34ee70c3";
const INDEX = "products";

// Search queries that surface relevant founders
const QUERIES = [
  "vibe coded",
  "just launched",
  "looking for first customers",
  "need help marketing",
  "MVP",
  "Claude code",
  "lovable",
  "bolt new",
  "no code SaaS",
  "automation",
  "cursor built",
  "struggling with",
  "need developer",
  "ai wrapper",
  "saas launch",
];

async function searchIH(query, hitsPerPage = 50) {
  const resp = await fetch(`https://${ALGOLIA_APP}-dsn.algolia.net/1/indexes/${INDEX}/query`, {
    method: "POST",
    headers: {
      "X-Algolia-Application-Id": ALGOLIA_APP,
      "X-Algolia-API-Key": ALGOLIA_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, hitsPerPage }),
  });
  if (!resp.ok) throw new Error(`Algolia ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  return data.hits || [];
}

function isICP(hit) {
  const tags = hit._tags || [];
  if (!tags.includes("founders-solo")) return false;

  // Skip if no revenue at all AND no stripe-verified tag (need some signal of real activity)
  const revenue = hit.revenue || 0;
  const hasStripe = tags.includes("stripe-verified-revenue");
  if (revenue === 0 && !hasStripe) return false;

  // Skip if revenue too high - they are past first-10-customers stage
  if (revenue > 10000) return false;

  // Skip if product too old - 120 day window for "post-launch crisis"
  const created = hit.createdTimestamp || 0;
  const ageDays = (Date.now() - created) / (1000 * 60 * 60 * 24);
  if (ageDays > 120) return false;

  return true;
}

// ---- IH Looking-For mode ----

const IH_FEED_JSON = "https://www.indiehackers.com/feed.json";
const IH_FEED_RSS = "https://www.indiehackers.com/feed.xml";
const IH_SEEN_FILE = resolve(ROOT, ".data/ih-looking-for-seen.json");
const IH_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const LOOKING_FOR_RE = /looking\s+for/i;
const RELEVANT_KW_RE = /\b(automation|automati|AI|workflow|outreach|pipeline)\b/i;

function loadIHSeen() {
  if (!existsSync(IH_SEEN_FILE)) return new Set();
  try { return new Set(JSON.parse(readFileSync(IH_SEEN_FILE, "utf-8"))); }
  catch { return new Set(); }
}

function saveIHSeen(seen) {
  const arr = [...seen].slice(-3000);
  writeFileSync(IH_SEEN_FILE, JSON.stringify(arr));
}

async function fetchIHFeedItems() {
  // Try JSON Feed spec first
  try {
    const res = await fetch(IH_FEED_JSON, {
      headers: { "User-Agent": "KirillBot/1.0 (ih-looking-for)" },
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.items) && data.items.length > 0) {
        return data.items.map(item => ({
          id: item.id || item.url || String(Math.random()),
          title: item.title || "",
          body: item.content_text || (item.content_html || "").replace(/<[^>]+>/g, ""),
          url: item.url || "",
          publishedAt: item.date_published ? new Date(item.date_published).getTime() : Date.now(),
        }));
      }
    }
  } catch {}

  // Fall back to RSS
  const res = await fetch(IH_FEED_RSS, {
    headers: { "User-Agent": "KirillBot/1.0 (ih-looking-for)" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`IH RSS ${res.status}`);
  const xml = await res.text();

  const items = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    const title = (block.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1] || "")
      .replace(/<!\[CDATA\[|\]\]>/g, "").trim();
    const link = (block.match(/<link[^>]*>([\s\S]*?)<\/link>/)?.[1] || "").trim();
    const desc = (block.match(/<description[^>]*>([\s\S]*?)<\/description>/)?.[1] || "")
      .replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").trim();
    const guid = (block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/)?.[1] || link).trim();
    const pubDate = (block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/)?.[1] || "").trim();
    if (!guid) continue;
    items.push({
      id: guid,
      title,
      body: desc,
      url: link,
      publishedAt: pubDate ? new Date(pubDate).getTime() : Date.now(),
    });
  }
  return items;
}

async function callClaudeDraftIH(post) {
  const { spawnSync } = await import("child_process");
  const promptFile = resolve(ROOT, ".data/callai-prompt.md");

  const prompt = `You are helping Kirill Kireyev respond to an IndieHackers post where a solo founder is looking for AI automation help.

Kirill offers: custom AI workflow automation for SaaS founders and small businesses. Services from $1,500-$10,000 CAD. Real deliverables: automated lead pipelines, AI assistants, workflow integrations.

POST TITLE: ${post.title}
POST BODY: ${(post.body || "").slice(0, 800)}

Write a 3-bullet comment from Kirill's POV. Rules:
- First bullet: acknowledge their specific need directly (no flattery)
- Second bullet: one concrete relevant thing Kirill has built/shipped (be specific)
- Third bullet: low-friction next step (e.g. "Happy to share how - drop a comment or DM")
- NO em dashes, NO buzzwords like "game-changer" or "revolutionary"
- NO money-back guarantees or results-based promises
- Sound like a practitioner, not a vendor
- Max 150 words total
- Output ONLY the comment text, nothing else`;

  writeFileSync(promptFile, prompt);

  const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";
  const cleanEnv = { ...process.env };
  delete cleanEnv.CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING;
  cleanEnv.PATH = `$HOME/.nvm/versions/node/v22.22.2/bin:${process.env.PATH || "/usr/bin:/bin"}`;

  const r = spawnSync("bash", ["-c",
    `cat "${promptFile}" | "${CLAUDE_BIN}" -p --model claude-haiku-4-5-20251001 --max-turns 1 --output-format text 2>&1`,
  ], {
    cwd: ROOT,
    env: cleanEnv,
    encoding: "utf-8",
    timeout: 30000,
    maxBuffer: 2 * 1024 * 1024,
  });

  const out = ((r.stdout || "") + (r.stderr || "")).trim();
  if (!out || r.status !== 0) throw new Error(`Claude failed: exit=${r.status} output=${out?.slice(0, 200)}`);
  return out.replace(/\u2014/g, "-").replace(/\u2013/g, "-");
}

async function tgSend(text) {
  if (!TG || !TG_CHAT) { console.log("[ih-looking-for][tg]", text.slice(0, 200)); return; }
  try {
    await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TG_CHAT,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
  } catch (e) {
    console.error("[ih-looking-for] tg error:", e.message);
  }
}

async function runIHLookingFor() {
  console.log("[ih-looking-for] starting");
  const seen = loadIHSeen();

  let items = [];
  try {
    items = await fetchIHFeedItems();
  } catch (e) {
    console.error("[ih-looking-for] feed fetch error:", e.message);
    return 0;
  }

  const cutoff = Date.now() - IH_MAX_AGE_MS;
  const matches = items.filter(item => {
    if (seen.has(item.id)) return false;
    if (item.publishedAt < cutoff) return false;
    const text = `${item.title}\n${item.body}`;
    return LOOKING_FOR_RE.test(text) && RELEVANT_KW_RE.test(text);
  });

  console.log(`[ih-looking-for] feed items=${items.length} matches=${matches.length}`);

  for (const match of matches) {
    seen.add(match.id);

    let draft = "(draft generation failed)";
    try {
      draft = await callClaudeDraftIH(match);
    } catch (e) {
      console.error(`[ih-looking-for] draft error: ${e.message}`);
    }

    const ageMins = Math.floor((Date.now() - match.publishedAt) / 60000);
    const snippet = (match.body || "").slice(0, 200).replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const msg =
      `<b>[IH LOOKING FOR] High-intent founder post</b>\n` +
      `Age: ${ageMins}min\n` +
      `Post: ${match.url}\n\n` +
      `<b>Title:</b> ${(match.title || "").slice(0, 200)}\n` +
      `<b>Snippet:</b> ${snippet}\n\n` +
      `<b>Draft comment:</b>\n${draft}\n\n` +
      `Reply Y to engage`;

    // Trim to 4096 char Telegram limit
    await tgSend(msg.slice(0, 4096));
    console.log(`[ih-looking-for] alerted: ${match.url}`);
    await new Promise(r => setTimeout(r, 1000));
  }

  saveIHSeen(seen);
  console.log(`[ih-looking-for] done. alerted=${matches.length}`);
  return matches.length;
}

async function main() {
  const db = new Database(DB_PATH);
  console.log("[ih-products] starting");

  const insert = db.prepare(`
    INSERT OR IGNORE INTO leads
      (id, name, role, company, pain_description, source_url, source, score, stage, first_signal_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', datetime('now'), datetime('now'), datetime('now'))
  `);

  let totalHits = 0, totalICP = 0, totalInserted = 0;
  const seenIds = new Set();

  for (const q of QUERIES) {
    let hits = [];
    try {
      hits = await searchIH(q, 50);
    } catch (e) {
      console.error(`[ih-products] query "${q}" failed: ${e.message}`);
      continue;
    }
    totalHits += hits.length;
    let qInserted = 0;

    for (const hit of hits) {
      if (seenIds.has(hit.objectID)) continue;
      seenIds.add(hit.objectID);

      if (!isICP(hit)) continue;
      totalICP++;

      const ageDays = ((Date.now() - (hit.createdTimestamp || 0)) / (1000 * 60 * 60 * 24)).toFixed(0);
      const tags = (hit._tags || []).filter(t => /^vertical-|founders-|employees-|funding-|stripe/.test(t)).join(", ");
      const painDesc =
        `Product: ${hit.name}\n` +
        `Tagline: ${hit.tagline || "(none)"}\n` +
        `Description: ${(hit.description || "").slice(0, 500)}\n\n` +
        `Founder Twitter: @${hit.twitterHandle || "unknown"}\n` +
        `Website: ${hit.websiteUrl || "unknown"}\n` +
        `Revenue: $${hit.revenue || 0}/mo${tags.includes("stripe") ? " (Stripe verified)" : ""}\n` +
        `Last 30d uniques: ${hit.last30DaysUniques || "unknown"}\n` +
        `Started: ${hit.startDateStr || "unknown"} (${ageDays} days ago)\n` +
        `Tags: ${tags}\n\n` +
        `[Source: IndieHackers products, query "${q}"]`;

      try {
        const r = insert.run(
          randomUUID(),
          hit.twitterHandle || hit.name || "unknown",
          hit.tagline?.slice(0, 100) || "",
          hit.name?.slice(0, 100) || "",
          painDesc,
          `https://www.indiehackers.com/product/${hit.productId}`,
          "ih-products",
          25  // higher base score - this is verified founder + real revenue signal
        );
        if (r.changes > 0) { qInserted++; totalInserted++; }
      } catch {}
    }

    console.log(`[ih-products] "${q}" → ${hits.length} hits, ${qInserted} inserted ICP`);
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`[ih-products] done: hits=${totalHits} unique_ICP=${totalICP} inserted=${totalInserted}`);
  db.close();

  await runIHLookingFor();
}

main().catch(e => {
  console.error("[ih-products] FATAL:", e);
  process.exit(1);
});
