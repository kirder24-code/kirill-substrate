/**
 * awareness-gtm-extension.mjs
 *
 * Extends awareness-bot with GTM/channel-discovery sources, not just technique.
 * Hunts for new sales channels, ICP signals, and "what worked" stories from
 * solo founders / consultants. Output goes to same awareness_items table.
 *
 * Sources:
 *   - r/SaaS "first customer" / "what worked" search
 *   - r/Entrepreneur high-engagement "I got my first X customers" posts
 *   - HN Algolia search for "how I got my first customers" stories
 *   - IndieHackers milestones tag (when scrapeable)
 */
import Database from "better-sqlite3";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const db = new Database(resolve(ROOT, ".data/linkedin-brand-os.sqlite"));
const NOW = () => new Date().toISOString();
const TODAY = () => new Date().toISOString().slice(0, 10);
const UA = "Mozilla/5.0 (Macintosh) AppleWebKit/537.36";

const items = [];

// HN Algolia search for first-customer stories
async function fetchHN(query) {
  try {
    const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&numericFilters=points>30,created_at_i>${Math.floor(Date.now()/1000) - 90*86400}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return [];
    const d = await r.json();
    return (d.hits || []).slice(0, 5).map(h => ({
      title: h.title,
      url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      score: 14,
      category: "gtm_tactic",
      summary: `HN story (${h.points} points): "${h.title}" - search query: ${query}`,
      why_matters: `Founder narratives about "first customers" / channel discovery feed our channel matrix.`,
      action_target: "channel matrix / GTM playbook",
      action_type: "channel_test",
      confidence: "medium",
    }));
  } catch (e) { console.log(`[hn] ${query}: ${e.message}`); return []; }
}

// Reddit search for "first customer" / "what worked"
async function fetchReddit(sub, query) {
  try {
    const url = `https://www.reddit.com/r/${sub}/search.json?q=${encodeURIComponent(query)}&restrict_sr=1&sort=top&t=month&limit=10`;
    const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return [];
    const d = await r.json();
    return (d?.data?.children || []).slice(0, 5).map(c => ({
      title: c.data.title,
      url: `https://reddit.com${c.data.permalink}`,
      score: Math.min(18, 12 + Math.floor(c.data.ups / 50)),
      category: "gtm_tactic",
      summary: (c.data.selftext || c.data.title).slice(0, 400),
      why_matters: `r/${sub} founder share: "${c.data.title.slice(0, 60)}". May reveal new channel or ICP angle.`,
      action_target: "channel matrix / GTM",
      action_type: "channel_test",
      confidence: "medium",
    }));
  } catch (e) { console.log(`[r/${sub}] ${e.message}`); return []; }
}

(async () => {
  const tasks = [
    // Original first-customer queries
    fetchHN("how I got first customers"),
    fetchHN("first paying customers"),
    fetchReddit("SaaS", "first customers"),
    fetchReddit("Entrepreneur", "what worked first customer"),
    fetchReddit("startups", "first 10 customers"),
    // NEW: free channel discovery queries (April 7 2026 - Kirill needs more channels, no budget)
    fetchHN("free marketing channels"),
    fetchHN("solo consultant find clients"),
    fetchHN("indie hackers community where"),
    fetchReddit("freelance", "where to find clients free"),
    fetchReddit("indiebiz", "free customer acquisition"),
    fetchReddit("EntrepreneurRideAlong", "free marketing"),
    fetchReddit("smallbusiness", "free customer acquisition channel"),
    fetchReddit("consulting", "where do you find clients"),
    fetchReddit("nocode", "looking for help with"),
    fetchReddit("microsaas", "first customers"),
    fetchReddit("sideproject", "feedback wanted"),
  ];
  const results = (await Promise.all(tasks)).flat();
  console.log(`[gtm-extension] fetched ${results.length} candidates`);

  const insert = db.prepare(`
    INSERT OR IGNORE INTO awareness_items
      (id, date, score, title, category, summary, why_matters, action_target, action_type, confidence, url, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)
  `);
  let added = 0;
  for (const it of results) {
    const r = insert.run(
      randomUUID(), TODAY(), it.score, it.title, it.category, it.summary,
      it.why_matters, it.action_target, it.action_type, it.confidence, it.url, NOW(), NOW()
    );
    if (r.changes > 0) added++;
  }
  console.log(`[gtm-extension] added ${added} new GTM items`);
  db.close();
})();
