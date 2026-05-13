/**
 * apify-linkedin-hunter.mjs
 *
 * LinkedIn posts search via Apify. Built April 8 2026 after Kirill called
 * out that I was burning Claude credits on Reddit enrichment when LinkedIn
 * was the channel he actually needed Apify for.
 *
 * Why LinkedIn matters: posts on LinkedIn come with FULL author profile URL
 * (direct DM target), headline (CTO/Founder verification), and the buying-
 * intent population skews older + employed = real budget. This is the channel
 * we cannot reach for free.
 *
 * Cost: $0.005/post. 100 posts/query × 8 queries = $4 max. Probably $2-3.
 *
 * Strategy: high-intent search phrases that explicit money-having founders
 * post when they need outside help.
 */
import Database from "better-sqlite3";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";
import { randomUUID } from "crypto";
import { tgSendToKirill } from "./orchestrator.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DB_PATH = resolve(ROOT, ".data/linkedin-brand-os.sqlite");

const env = Object.fromEntries(
  readFileSync(resolve(ROOT, "apps/api/.env"), "utf-8").split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const APIFY_TOKEN = env.APIFY_API_KEY;
if (!APIFY_TOKEN) { console.error("APIFY_API_KEY missing"); process.exit(1); }

const ACTOR = "apimaestro~linkedin-posts-search-scraper-no-cookies";

// High-intent LinkedIn search phrases - posts where someone explicitly says
// they need to hire help. Each maps to one of Kirill's offers.
const QUERIES = [
  // Buyer D/E: Custom AI / n8n builds ($2.5-8K)
  { q: "need n8n expert", offer: "n8n_build" },
  { q: "looking for automation consultant", offer: "n8n_build" },
  { q: "hiring AI implementation", offer: "n8n_build" },
  { q: "need someone to build AI workflow", offer: "n8n_build" },

  // Buyer A: Vibe-code audit ($1.5-2.5K)
  { q: "fractional CTO startup", offer: "vibe_audit" },
  { q: "MVP broken production", offer: "vibe_audit" },

  // Buyer B: First 10 customers ($2K)
  { q: "just launched my SaaS feedback", offer: "first_10" },
  { q: "need help marketing my SaaS", offer: "first_10" },
];

async function runQuery(keyword) {
  console.log(`[linkedin] querying: ${keyword}`);
  const resp = await fetch(
    `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${APIFY_TOKEN}&maxItems=10`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword, totalPosts: 10 }), // Apr 13 2026: reduced from 30 to save budget
    }
  );
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`${resp.status}: ${err.slice(0, 300)}`);
  }
  return resp.json();
}

function extractLead(post, offer) {
  const author = post.author || {};
  const name = author.name || "Unknown";
  const headline = author.headline || "";
  const profileUrl = author.profile_url || "";
  const text = post.text || "";
  const postUrl = post.post_url || "";
  const postedAt = post.posted_at?.date || "";

  if (!name || !text || !profileUrl) return null;

  // Filter out job postings (those are companies hiring, not founders in pain)
  // Unless it's "fractional CTO" (then a job post IS the buyer signal)
  if (post.content?.type === "job" && !/fractional|consultant|advisor/i.test(post.content?.title || "")) {
    return null;
  }

  // Filter out news bots, recruiters, agencies
  const lowerHead = headline.toLowerCase();
  if (/recruiter|talent acquisition|head of talent|sourcer/i.test(lowerHead)) return null;
  if (/news|media|press|journalist/i.test(lowerHead) && text.length < 200) return null;

  return {
    name,
    headline,
    profileUrl,
    text,
    postUrl,
    postedAt,
    offer,
  };
}

async function main() {
  const db = new Database(DB_PATH);
  const insert = db.prepare(`
    INSERT OR IGNORE INTO leads
      (id, name, role, linkedin_url, pain_description, source_url, source, score, stage, first_signal_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', datetime('now'), datetime('now'), datetime('now'))
  `);

  let totalFetched = 0, totalInserted = 0, totalSkipped = 0;
  const stats = [];

  for (const { q, offer } of QUERIES) {
    let posts = [];
    try {
      posts = await runQuery(q);
    } catch (e) {
      console.error(`[linkedin] ${q} failed: ${e.message}`);
      stats.push({ q, fetched: 0, inserted: 0, error: e.message.slice(0, 100) });
      continue;
    }

    let qInserted = 0, qSkipped = 0;
    for (const p of posts) {
      const lead = extractLead(p, offer);
      if (!lead) { qSkipped++; continue; }
      try {
        const r = insert.run(
          randomUUID(),
          lead.name,
          lead.headline.slice(0, 200),
          lead.profileUrl,
          `${lead.text}\n\n[Headline: ${lead.headline}]\n[Posted: ${lead.postedAt}]\n[Offer angle: ${offer}]`,
          lead.postUrl,
          `apify-linkedin-${offer}`,
          20  // higher base score - LinkedIn intent is stronger
        );
        if (r.changes > 0) qInserted++; else qSkipped++;
      } catch (e) { qSkipped++; }
    }
    totalFetched += posts.length;
    totalInserted += qInserted;
    totalSkipped += qSkipped;
    stats.push({ q, fetched: posts.length, inserted: qInserted });
    console.log(`[linkedin] [${q}] → ${posts.length} fetched, ${qInserted} inserted, ${qSkipped} skipped`);
  }

  console.log(`[linkedin] TOTAL: ${totalFetched} fetched, ${totalInserted} inserted, ${totalSkipped} skipped`);

  const cost = (totalFetched * 0.005).toFixed(2);
  const top = stats
    .filter(s => s.inserted > 0)
    .sort((a, b) => b.inserted - a.inserted)
    .slice(0, 5)
    .map(s => `• <code>${s.q}</code>: <b>${s.inserted}</b>`)
    .join("\n");

  await tgSendToKirill(
    `🔗 <b>apify-linkedin-hunter complete</b>\n\n` +
    `Queries: ${QUERIES.length}\n` +
    `Posts fetched: ${totalFetched}\n` +
    `Cost: ~$${cost}\n` +
    `New LinkedIn leads: <b>${totalInserted}</b>\n` +
    `Filtered (jobs/recruiters/news): ${totalSkipped}\n\n` +
    (top ? `<b>Top queries:</b>\n${top}\n\n` : "") +
    `Each lead has: post text + author headline + profile URL (DMable).\n` +
    `Next: filter top ${Math.min(20, totalInserted)} by hand or pipe to icp-burn.`
  );

  db.close();
}

main().catch(e => {
  console.error("[linkedin] FATAL:", e);
  tgSendToKirill(`🚨 apify-linkedin-hunter CRASHED: ${e.message}`).catch(() => {});
  process.exit(1);
});
