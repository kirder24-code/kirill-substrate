/**
 * market-scanner.mjs
 *
 * Scans Reddit, HackerNews, and ProductHunt for niche buying signals.
 * Aggregates pain density, demand scores, and sample prospects per niche.
 * Sends summary to Telegram with top recommendation.
 *
 * Run: node scripts/factory/market-scanner.mjs
 */
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const env = Object.fromEntries(
  readFileSync(resolve(ROOT, "apps/api/.env"), "utf-8").split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const TG = env.TELEGRAM_BOT_TOKEN;
const CHAT = env.TELEGRAM_CHAT_ID;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

// --- Niche definitions: subreddits + keywords + market labels ---
const NICHES = [
  {
    id: "solo_saas",
    label: "Solo SaaS / Vibe Coders",
    subs: ["SaaS", "microsaas", "vibecoding", "buildinpublic", "sideproject", "ClaudeAI", "cursor", "lovable"],
    keywords: /\b(first (customer|user|sale)|no (customer|revenue)|vibe.?cod|launched|mvp|struggling (to|with)|need help|marketing|onboarding|churn|where do i find|how do i get|looking for feedback)\b/i,
    market: "100K+ vibe-coded MVPs launched in 2025-2026",
  },
  {
    id: "small_biz_ops",
    label: "Small Biz Ops / Admin Pain",
    subs: ["smallbusiness", "Entrepreneur", "consulting", "freelance", "forhire"],
    keywords: /\b(manual|hours? a (week|day)|spreadsheet|tedious|repetitive|automat|workflow|follow.?up|invoic|admin|bookkeep|quote|schedul|overwhelm|drowning)\b/i,
    market: "32M small businesses in North America",
  },
  {
    id: "trades_contractors",
    label: "Trades / Contractors",
    subs: ["Construction", "Contractor", "HVAC", "plumbing", "realestateinvesting", "PropertyManagement"],
    keywords: /\b(dispatch|missed call|scheduling|crm|follow.?up|quote|estimate|invoice|lose (job|customer)|no-show|booking|automat)\b/i,
    market: "3M+ trades businesses in Canada + US",
  },
  {
    id: "ecommerce_dtc",
    label: "Ecommerce / DTC",
    subs: ["ecommerce", "dropship", "FulfillmentByAmazon", "Etsy", "shopify"],
    keywords: /\b(abandoned cart|email (flow|sequence|automat)|retention|churn|refund|return|ad (spend|cost)|roas|customer (service|support)|automat|ai tool)\b/i,
    market: "26M ecommerce stores globally",
  },
  {
    id: "agency_msp",
    label: "Agency / MSP / Productized Services",
    subs: ["agency", "msp", "webdev", "digital_marketing", "PPC"],
    keywords: /\b(client (report|update|churn|onboard)|automat|white.?label|proposal|retainer|scope creep|project management|handoff|ai (tool|workflow))\b/i,
    market: "500K+ digital agencies in US/Canada/UK",
  },
];

// --- Reddit fetch ---
async function fetchRedditSub(sub) {
  try {
    const r = await fetch(`https://www.reddit.com/r/${sub}/new.json?limit=50`, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) return [];
    const data = await r.json();
    return (data?.data?.children || []).map(c => c.data);
  } catch {
    return [];
  }
}

// --- HN Algolia fetch ---
async function fetchHNPosts(query) {
  try {
    const since = Math.floor(Date.now() / 1000) - 30 * 86400;
    const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&numericFilters=created_at_i>${since}&hitsPerPage=30`;
    const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) return [];
    const data = await r.json();
    return (data?.hits || []).map(h => ({
      title: h.title || "",
      selftext: h.story_text || "",
      url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      author: h.author || "",
      score: h.points || 0,
      num_comments: h.num_comments || 0,
    }));
  } catch {
    return [];
  }
}

// --- ProductHunt via Algolia (Indie Hackers public index) ---
async function fetchIHProducts(query) {
  try {
    const url = `https://n86t1r3owz-dsn.algolia.net/1/indexes/products/query?x-algolia-application-id=N86T1R3OWZ&x-algolia-api-key=5140dac5e87f47346abbda1a34ee70c3`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, hitsPerPage: 20, attributesToRetrieve: ["name", "tagline", "url", "makerName", "tags", "revenue"] }),
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) return [];
    const data = await r.json();
    return (data?.hits || []).map(h => ({
      title: `${h.name || ""}: ${h.tagline || ""}`,
      url: h.url || "",
      author: h.makerName || "",
      score: 0,
      num_comments: 0,
      selftext: (h.tags || []).join(" "),
    }));
  } catch {
    return [];
  }
}

// --- Scoring ---
function scorePost(post, niche) {
  const text = `${post.title || ""} ${post.selftext || ""}`;
  let score = 0;
  if (niche.keywords.test(text)) score += 3;
  if (post.num_comments > 5) score += 1;
  if (post.score > 10) score += 1;
  // Buyer intent
  if (/\b(looking for|recommend|need|best|how do you|anyone tried|what do you use)\b/i.test(text)) score += 2;
  return score;
}

function extractTopPains(posts, niche) {
  const PAIN_PATTERNS = [
    { label: "manual/repetitive work", re: /\b(manual|spreadsheet|tedious|repetitive|hours? a (week|day))\b/i },
    { label: "no customers / growth stuck", re: /\b(no (customer|user|sale)|first (customer|sale)|struggling to (grow|get|find))\b/i },
    { label: "tools don't connect / workflow broken", re: /\b(integrat|zapier|workflow|automat|connect|api|broken|doesn't work)\b/i },
    { label: "drowning in admin / follow-ups", re: /\b(admin|overwhelm|drowning|follow.?up|chase|invoic|quote)\b/i },
    { label: "missed calls / leads falling through", re: /\b(missed call|no-show|lost (lead|customer|job)|dispatch)\b/i },
    { label: "don't know how to market / get visibility", re: /\b(market|visibility|seo|ad|traffic|where do i|how do i get)\b/i },
    { label: "client management / reporting chaos", re: /\b(client (report|update|churn|onboard)|scope creep|proposal|retainer)\b/i },
    { label: "scaling from MVP / post-launch panic", re: /\b(vibe.?cod|launched|mvp|scale|next step|what now|churn|onboarding)\b/i },
  ];

  const counts = {};
  for (const post of posts) {
    const text = `${post.title || ""} ${post.selftext || ""}`;
    for (const p of PAIN_PATTERNS) {
      if (p.re.test(text)) counts[p.label] = (counts[p.label] || 0) + 1;
    }
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([label]) => label);
}

function extractSampleProspects(posts, niche, limit = 3) {
  return posts
    .filter(p => scorePost(p, niche) >= 3)
    .slice(0, limit)
    .map(p => {
      const title = (p.title || "").slice(0, 80);
      const src = p.url ? p.url.replace(/^https?:\/\//, "").split("/")[0] : "unknown";
      return `${title} [${src}]`;
    });
}

// --- Main ---
async function tg(text) {
  if (!TG || !CHAT) { console.log("[TG]", text); return; }
  const chunks = [];
  while (text.length > 0) {
    chunks.push(text.slice(0, 4000));
    text = text.slice(4000);
  }
  for (const chunk of chunks) {
    await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT, text: chunk, parse_mode: "HTML", disable_web_page_preview: true }),
    }).catch(e => console.error("[TG]", e.message));
  }
}

(async () => {
  console.log("[market-scanner] Starting scan across Reddit + HN + IH...");

  const results = [];

  for (const niche of NICHES) {
    console.log(`[market-scanner] Scanning niche: ${niche.label}`);
    const posts = [];

    // Reddit
    for (const sub of niche.subs) {
      const fetched = await fetchRedditSub(sub);
      posts.push(...fetched);
      await new Promise(r => setTimeout(r, 800));
    }

    // HN
    const hnPosts = await fetchHNPosts(niche.label.split("/")[0].trim());
    posts.push(...hnPosts);

    // IH (only for solo_saas niche)
    if (niche.id === "solo_saas") {
      const ihPosts = await fetchIHProducts("struggling first customer");
      posts.push(...ihPosts);
    }

    const scoredPosts = posts.filter(p => scorePost(p, niche) >= 2);
    const demandScore = Math.min(100, Math.round((scoredPosts.length / Math.max(posts.length, 1)) * 100 + scoredPosts.length * 0.5));
    const topPains = extractTopPains(scoredPosts, niche);
    const prospects = extractSampleProspects(scoredPosts, niche);

    results.push({
      niche: niche.label,
      id: niche.id,
      demandScore,
      totalPosts: posts.length,
      signalPosts: scoredPosts.length,
      topPains,
      market: niche.market,
      prospects,
    });

    console.log(`  -> ${scoredPosts.length}/${posts.length} signal posts, demand=${demandScore}`);
  }

  // Sort by demand score
  results.sort((a, b) => b.demandScore - a.demandScore);
  const top = results[0];

  // Build Telegram message
  const lines = [];
  lines.push("<b>MARKET SCANNER - TOP NICHES</b>");
  lines.push("");

  for (let i = 0; i < Math.min(5, results.length); i++) {
    const r = results[i];
    const rank = i + 1;
    lines.push(`<b>${rank}. ${r.niche}</b> - score: ${r.demandScore}/100`);
    lines.push(`   Signals: ${r.signalPosts}/${r.totalPosts} posts`);
    if (r.topPains.length > 0) {
      lines.push(`   Pains: ${r.topPains.join(" | ")}`);
    }
    lines.push(`   Market: ${r.market}`);
    if (r.prospects.length > 0) {
      lines.push(`   Prospects:`);
      r.prospects.forEach(p => lines.push(`     - ${p}`));
    }
    lines.push("");
  }

  lines.push(`<b>TOP PICK: ${top.niche}</b>`);
  lines.push(`Score: ${top.demandScore}/100 - ${top.signalPosts} live pain signals`);
  if (top.topPains[0]) lines.push(`Lead pain: "${top.topPains[0]}"`);
  lines.push(`Action: post in r/${NICHES.find(n => n.id === top.id)?.subs?.[0] || "relevant sub"} targeting this pain today`);

  await tg(lines.join("\n"));

  // Also print table to stdout
  console.log("\n=== RESULTS ===");
  console.log("Niche | Score | Signals | Top Pain | Market");
  for (const r of results) {
    console.log(`${r.niche} | ${r.demandScore} | ${r.signalPosts} | ${r.topPains[0] || "-"} | ${r.market}`);
  }
  console.log("\nTop recommendation:", top.niche, `(score ${top.demandScore})`);
  console.log("[market-scanner] Done.");
})();
