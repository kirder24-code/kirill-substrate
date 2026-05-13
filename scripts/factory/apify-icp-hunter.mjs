/**
 * apify-icp-hunter.mjs
 *
 * Surgical Apify-powered hunt for hot-intent solo SaaS founders.
 *
 * Built April 8 2026 after Kirill said "find money or close project". The
 * goal: stop scraping random Reddit posts and use Apify's paid actors to
 * surface high-intent twitter and IH posts where founders explicitly say
 * "I have no customers" or "I just launched and need help".
 *
 * Strategy: ONE actor, ONE narrow query, ONE shot. Don't burn budget on
 * speculative searches. Each fire costs $0.50-2 and produces 50-200 leads.
 *
 * Fired manually first run, then can be added to cron once we know it works.
 *
 * Usage: node scripts/factory/apify-icp-hunter.mjs [--max-cost-cents 200]
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

// ────────────────────────────────────────────────────────────────────────────
// HOT INTENT QUERIES — these are the exact phrases solo SaaS founders use when
// they are stuck and would actually pay for help. Each one is targeted at one
// of Kirill's offers.
// ────────────────────────────────────────────────────────────────────────────
const HOT_INTENT_QUERIES = [
  // === Buyer A: Vibe-coded MVP in crisis ($1.5-2.5K Vibe-Code Audit) ===
  '"vibe coded" (broken OR bug OR crashed OR failing OR help) lang:en -is:retweet',
  '"lovable.dev" (broken OR bug OR stuck OR help OR error) lang:en -is:retweet',
  '"bolt.new" (broken OR bug OR stuck OR help OR error) lang:en -is:retweet',
  '"cursor" "production" (broken OR bug OR crashed OR error) lang:en -is:retweet',
  '"my MVP" (broken OR bugs OR "in production") lang:en -is:retweet',
  '"AI wrote" (broken OR "doesn t work" OR bugs) lang:en -is:retweet',
  '"v0.dev" (broken OR stuck OR help) lang:en -is:retweet',
  '"replit agent" (broken OR stuck OR bug) lang:en -is:retweet',

  // === Buyer B: Founder with no customers ($2K First 10 Customers) ===
  '"$0 MRR" (launched OR SaaS OR indie) lang:en -is:retweet',
  '"0 users" SaaS launched lang:en -is:retweet',
  '"first customer" (struggling OR stuck OR help) SaaS lang:en -is:retweet',
  '"no one is buying" (SaaS OR product) lang:en -is:retweet',
  '"just launched" "no traction" lang:en -is:retweet',
  '"stuck at $0" (MRR OR users) lang:en -is:retweet',
  '"need help marketing" (SaaS OR startup OR product) lang:en -is:retweet',
  '"first 10 customers" (struggling OR stuck OR help) lang:en -is:retweet',
  '"can t find customers" SaaS lang:en -is:retweet',
  '"how do I get my first" (customer OR sale) lang:en -is:retweet',

  // === Buyer C: Cold outreach pipeline leak ($1.5K Reply Chaser) ===
  '"cold email" "no replies" (founder OR SaaS) lang:en -is:retweet',
  '"losing leads" follow up lang:en -is:retweet',

  // === Buyer D/E: Need automation built ($2.5-8K Custom AI/n8n) ===
  '"need" (n8n OR Zapier) "expert" lang:en -is:retweet',
  '"looking for" "automation expert" lang:en -is:retweet',
  '"fractional CTO" looking lang:en -is:retweet',
];

// Use the lite Twitter scraper - cheaper, sufficient for our needs
const ACTOR_ID = "apidojo~tweet-scraper";

async function runActor(input) {
  console.log(`[apify] starting actor ${ACTOR_ID}`);
  console.log(`[apify] input:`, JSON.stringify(input, null, 2));

  const startResp = await fetch(
    `https://api.apify.com/v2/acts/${ACTOR_ID}/run-sync-get-dataset-items?token=${APIFY_TOKEN}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }
  );

  if (!startResp.ok) {
    const err = await startResp.text();
    throw new Error(`Apify ${startResp.status}: ${err.slice(0, 500)}`);
  }

  const items = await startResp.json();
  console.log(`[apify] got ${items.length} items`);
  return items;
}

function extractLead(tweet) {
  // Schema varies by actor. Handle apidojo tweet-scraper format.
  const author = tweet.author || tweet.user || {};
  const username = author.userName || author.screen_name || author.username || tweet.username;
  const text = tweet.text || tweet.full_text || tweet.fullText || "";
  const url = tweet.url || tweet.tweetUrl || (username ? `https://twitter.com/${username}/status/${tweet.id || tweet.id_str}` : null);
  const followers = author.followers || author.followersCount || 0;
  const bio = author.description || author.bio || "";

  // Tweet creation date - apidojo format: "Tue Apr 07 18:43:41 +0000 2026"
  const createdAtStr = tweet.createdAt || tweet.created_at || "";
  let createdAt = null;
  let ageDays = 9999;
  if (createdAtStr) {
    const t = new Date(createdAtStr);
    if (!isNaN(t.getTime())) {
      createdAt = t.toISOString();
      ageDays = (Date.now() - t.getTime()) / (24 * 3600 * 1000);
    }
  }

  if (!username || !text) return null;

  // FRESHNESS GATE — Apr 8 2026 fix after dev_guid Feb 23 incident.
  // Cold outbound on tweet older than 21 days = waste. Kirill caught it.
  if (ageDays > 21) return null;

  // Filter: skip clear non-founders (employees, agencies, big accounts)
  if (followers > 10000) return null;
  if (/recruiter|agency|hiring|we are hiring|VC|investor partner/i.test(bio)) return null;

  return {
    name: username,
    pain_description: `${text}\n\n[Bio: ${bio.slice(0, 200)}]\n[Tweet posted: ${createdAt || "unknown"}]\n[Age: ${ageDays.toFixed(1)} days]`,
    source_url: url,
    source: "apify-twitter-icp",
    score: followers < 500 ? 18 : 12, // small accounts = more likely solo
  };
}

async function main() {
  const db = new Database(DB_PATH);
  const args = process.argv.slice(2);
  const isFullBatch = args.includes("--full");
  const queries = isFullBatch
    ? HOT_INTENT_QUERIES
    : [HOT_INTENT_QUERIES[new Date().getUTCHours() % HOT_INTENT_QUERIES.length]];

  console.log(`[hunter] running ${queries.length} queries (mode: ${isFullBatch ? "FULL BATCH" : "single rotation"})`);

  const insert = db.prepare(`
    INSERT OR IGNORE INTO leads (id, name, pain_description, source_url, source, score, stage, first_signal_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'new', datetime('now'), datetime('now'), datetime('now'))
  `);

  let totalTweets = 0, totalInserted = 0, totalSkipped = 0;
  const queryStats = [];

  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    console.log(`[hunter] [${i+1}/${queries.length}] ${q}`);
    let tweets = [];
    try {
      tweets = await runActor({
        searchTerms: [q],
        maxItems: isFullBatch ? 30 : 100,
        sort: "Latest",
        tweetLanguage: "en",
      });
    } catch (e) {
      console.error(`[hunter] query ${i+1} failed:`, e.message);
      queryStats.push({ q, fetched: 0, inserted: 0, error: e.message.slice(0, 100) });
      continue;
    }

    let qInserted = 0, qSkipped = 0;
    for (const t of tweets) {
      const lead = extractLead(t);
      if (!lead) { qSkipped++; continue; }
      try {
        const r = insert.run(randomUUID(), lead.name, lead.pain_description, lead.source_url, lead.source, lead.score);
        if (r.changes > 0) qInserted++; else qSkipped++;
      } catch (e) { qSkipped++; }
    }
    totalTweets += tweets.length;
    totalInserted += qInserted;
    totalSkipped += qSkipped;
    queryStats.push({ q, fetched: tweets.length, inserted: qInserted });
    console.log(`[hunter]   → ${tweets.length} tweets, ${qInserted} new leads, ${qSkipped} skipped`);
  }

  console.log(`[hunter] TOTAL: ${totalTweets} tweets, ${totalInserted} new leads, ${totalSkipped} skipped`);

  // Build summary by query for Telegram
  const topQueries = queryStats
    .filter(s => s.inserted > 0)
    .sort((a, b) => b.inserted - a.inserted)
    .slice(0, 5)
    .map(s => `• <code>${s.q.slice(0, 50)}</code>: <b>${s.inserted}</b>`)
    .join("\n");

  const estCostUsd = (totalTweets * 0.0004).toFixed(3);

  await tgSendToKirill(
    `🎯 <b>apify-icp-hunter complete</b>\n\n` +
    `Mode: ${isFullBatch ? "FULL BATCH" : "single rotation"}\n` +
    `Queries run: ${queries.length}\n` +
    `Tweets fetched: ${totalTweets}\n` +
    `Estimated cost: $${estCostUsd}\n` +
    `New ICP leads: <b>${totalInserted}</b>\n` +
    `Filtered (big accounts/agencies): ${totalSkipped}\n\n` +
    (topQueries ? `<b>Top performing queries:</b>\n${topQueries}\n\n` : "") +
    `→ icp-outreach-bot will pick these up on next :45 fire and draft DMs.\n` +
    `→ Triggering icp-outreach-bot manually now to start enrichment immediately.`
  );

  db.close();

  // Auto-chain into icp-outreach-bot so leads get enriched + drafted right away
  if (totalInserted > 0) {
    console.log(`[hunter] chaining into icp-outreach-bot...`);
    const { spawn } = await import("child_process");
    spawn(
      "$HOME/.nvm/versions/node/v22.22.2/bin/node",
      ["scripts/factory/icp-outreach-bot.mjs"],
      { cwd: ROOT, detached: true, stdio: "ignore" }
    ).unref();
  }
}

main().catch(e => {
  console.error("[hunter] FATAL:", e);
  tgSendToKirill(`🚨 apify-icp-hunter CRASHED: ${e.message}`).catch(() => {});
  process.exit(1);
});
