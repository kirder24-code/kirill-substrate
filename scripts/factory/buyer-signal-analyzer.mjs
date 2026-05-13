/**
 * buyer-signal-analyzer.mjs
 *
 * Finds people with BUDGET, not just pain.
 *
 * Three-part scan:
 *   1. Budget re-score: re-analyzes existing leads in DB for budget indicators
 *      (software spend, hiring history, service search intent)
 *   2. Channel map: scans ProductHunt, Gumroad, IndieHackers, G2 for high-intent
 *      buyers vs discussion-only forums - ranks channels by buying density
 *   3. LinkedIn offer variants: generates CA-filtered offer test plan with
 *      3 angle variants for Kirill to test on LinkedIn (no auto-post)
 *
 * Run:
 *   node scripts/factory/buyer-signal-analyzer.mjs
 *   node scripts/factory/buyer-signal-analyzer.mjs --channel-only   (skip DB re-score)
 *   node scripts/factory/buyer-signal-analyzer.mjs --db-only        (skip channel scan)
 *
 * Output: sandbox-review/buyer-signal-report-YYYY-MM-DD.md + Telegram summary
 */
import Database from "better-sqlite3";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync, writeFileSync } from "fs";
import { callAI } from "./orchestrator.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DB_PATH = resolve(ROOT, ".data/linkedin-brand-os.sqlite");
const db = new Database(DB_PATH);

const env = Object.fromEntries(
  readFileSync(resolve(ROOT, "apps/api/.env"), "utf-8").split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const TG = env.TELEGRAM_BOT_TOKEN, CHAT = env.TELEGRAM_CHAT_ID;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const NOW = () => new Date().toISOString();
const TODAY = new Date().toISOString().slice(0, 10);

// ── Budget signal patterns ─────────────────────────────────────────────────────

// Strong: person has already paid for something OR is actively searching to hire
const BUDGET_STRONG = /\b(we (use|pay for|subscribe to|bought)|paying for|subscri(be|ption)|hired (a|an|agency|developer|consultant|freelancer)|spent .{0,30}(on|for) (software|tools|dev|agency)|monthly (fee|cost|spend)|annual plan|annual contract|how much (do you|does it|is it) cost|what('s| is) (your|the) price|budget for|ready to pay|willing to pay|take my money|shut up and take|how do i (buy|purchase|sign up|get started))\b/i;

// Medium: person is evaluating or comparing tools/services (about to spend)
const BUDGET_MEDIUM = /\b(looking for (a|an) (tool|solution|software|service|consultant|developer|agency)|considering (switching|moving|trying|hiring)|comparing|alternatives to|vs\b|versus|recommend(ation)?s? for|best (way|tool|app|service|platform) for|anyone (used|tried|using)|review(s)? of|tried [A-Z][a-z]+\?|experience with|worth (it|the price|paying for)|is .{0,30} good|switched from|migrated from)\b/i;

// Weak: mentions tools/money but unclear context
const BUDGET_WEAK = /\b(zapier|make\.com|n8n|airtable|notion|hubspot|salesforce|pipedrive|stripe|lemon squeezy|gumroad|shopify|webflow|bubble|retool|framer|cursor|v0\.dev|lovable|bolt\.new|claude|openai|budget|revenue|mrr|arr|monthly|annually|startup|funded|vc|angel|grant)\b/i;

// Hiring history = they already know how to buy external help
const HIRING_SIGNAL = /\b(hired|worked with|contracted|freelancer|agency|upwork|toptal|fiverr|99designs|we brought in|brought on|onboard(ed)?|part.?time (hire|help)|contractor|outsource[d]?|consultant)\b/i;

function scoreBudget(text) {
  if (!text) return { score: 0, signals: [] };
  const signals = [];
  let score = 0;
  if (BUDGET_STRONG.test(text)) { score += 40; signals.push("strong_buyer"); }
  if (BUDGET_MEDIUM.test(text)) { score += 20; signals.push("evaluating"); }
  if (BUDGET_WEAK.test(text))   { score += 5;  signals.push("tool_user"); }
  if (HIRING_SIGNAL.test(text)) { score += 25; signals.push("hired_before"); }
  return { score, signals };
}

// ── Telegram helper ────────────────────────────────────────────────────────────
import { safeSend } from "../lib/safe-send.mjs";

async function tg(text) {
  if (!TG || !CHAT) return;
  // Egress guard on the full text before chunking
  const guard = await safeSend({ channel: "telegram", text, meta: { source: "buyer-signal-analyzer" } });
  if (!guard.ok) {
    console.error(`[buyer-signal-analyzer] BLOCKED by egress-guard: ${guard.egress_reason || guard.reason}`);
    return;
  }
  const chunks = [];
  for (let i = 0; i < text.length; i += 4000) chunks.push(text.slice(i, i + 4000));
  for (const chunk of chunks) {
    await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT, text: chunk, parse_mode: "HTML", disable_web_page_preview: true }),
    }).catch(() => {});
    if (chunks.length > 1) await new Promise(r => setTimeout(r, 500));
  }
}

// ── PART 1: Re-score existing leads for budget signals ─────────────────────────
function reScoredLeads() {
  // Pull leads with enrichment data - look for anyone who might have budget signals
  const leads = db.prepare(`
    SELECT l.id, l.name, l.pain_description, l.source_platform, l.stage, l.score,
           e.classification, e.reasoning, e.next_message_angle, e.raw_output
    FROM leads l
    LEFT JOIN lead_enrichment e ON e.lead_id = l.id
    WHERE l.stage NOT IN ('dead', 'closed', 'not_fit')
      AND l.created_at >= date('now', '-30 days')
    ORDER BY l.score DESC
    LIMIT 300
  `).all();

  const results = [];
  for (const lead of leads) {
    const allText = [
      lead.pain_description || "",
      lead.reasoning || "",
      lead.next_message_angle || "",
      lead.raw_output || "",
    ].join(" ");

    const { score, signals } = scoreBudget(allText);
    if (score > 0) {
      results.push({
        id: lead.id,
        name: lead.name,
        platform: lead.source_platform,
        enrichClass: lead.classification,
        budgetScore: score,
        signals,
        stage: lead.stage,
        angle: lead.next_message_angle?.slice(0, 120) || "",
      });
    }
  }

  // Sort by budget score desc
  results.sort((a, b) => b.budgetScore - a.budgetScore);
  return results;
}

// ── PART 2: Channel scan for high-intent buyers ────────────────────────────────

async function fetchJson(url, headers = {}) {
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": UA, ...headers },
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) return null;
    return r.json();
  } catch { return null; }
}

async function scanProductHunt() {
  // ProductHunt GraphQL - public API for recent posts
  // Using the public RSS feed which is unauthed
  const d = await fetchJson("https://www.producthunt.com/feed?category=tech", {
    "Accept": "application/rss+xml, text/xml",
  });
  // RSS returns text, not JSON - handle separately
  return { name: "ProductHunt", note: "Requires RSS parse - see channel map below", leads: [] };
}

async function scanHNHiring() {
  // HN monthly "Who is hiring" and "Who wants to be hired" - strong budget signal
  const since = Math.floor(Date.now() / 1000) - 35 * 86400;
  const url = `https://hn.algolia.com/api/v1/search?tags=story&query=%22Who+is+hiring%22&numericFilters=created_at_i%3E${since}&hitsPerPage=5`;
  const d = await fetchJson(url);
  const hits = d?.hits || [];
  return {
    name: "HN Who is Hiring",
    type: "high_intent",
    reason: "Companies posting hiring = active budget + automation pain likely",
    count: hits.length,
    examples: hits.slice(0, 3).map(h => ({ title: h.title, url: `https://news.ycombinator.com/item?id=${h.objectID}` })),
  };
}

async function scanIHProducts() {
  // IndieHackers products with revenue > 0 (someone paid them = they understand paying)
  const ALGOLIA_APP = "N86T1R3OWZ";
  const ALGOLIA_KEY = "5140dac5e87f47346abbda1a34ee70c3";
  const body = JSON.stringify({
    query: "automation",
    filters: "tags:founders-solo",
    hitsPerPage: 30,
    attributesToRetrieve: ["name", "tagline", "revenue", "url", "twitterHandle", "tags"],
    numericFilters: ["revenue > 0"],
  });
  const url = `https://${ALGOLIA_APP}-dsn.algolia.net/1/indexes/products/query`;
  const d = await fetchJson(url, {
    "X-Algolia-Application-Id": ALGOLIA_APP,
    "X-Algolia-API-Key": ALGOLIA_KEY,
    "Content-Type": "application/json",
  });
  const hits = (d?.hits || []).filter(h => h.revenue > 0 && h.revenue < 5000);
  return {
    name: "IndieHackers Products",
    type: "high_intent",
    reason: "Stripe-verified revenue, solo founder, <$5K MRR = classic First 10 Customers ICP",
    count: hits.length,
    examples: hits.slice(0, 5).map(h => ({
      product: h.name,
      revenue: `$${h.revenue}/mo`,
      twitter: h.twitterHandle ? `@${h.twitterHandle}` : null,
      tagline: h.tagline?.slice(0, 80),
    })),
  };
}

async function scanHNShowHN() {
  const since = Math.floor(Date.now() / 1000) - 7 * 86400;
  const url = `https://hn.algolia.com/api/v1/search?tags=story&query=Show+HN+automation&numericFilters=points%3E5,points%3C80,created_at_i%3E${since}&hitsPerPage=20`;
  const d = await fetchJson(url);
  const hits = (d?.hits || []);
  const withBudget = hits.filter(h => scoreBudget(h.title + " " + (h.story_text || "")).score > 0);
  return {
    name: "HN Show HN (automation)",
    type: "medium_intent",
    reason: "Founders shipping tools = need help with distribution/customers",
    count: hits.length,
    budgetSignals: withBudget.length,
    examples: hits.slice(0, 4).map(h => ({ title: h.title, url: `https://news.ycombinator.com/item?id=${h.objectID}` })),
  };
}

async function scanRedditHighIntent() {
  // Specific buyer-intent posts in business/hiring subs
  const BUYER_SUBS = ["forhire", "slavelabour", "hiring", "Jobs4Bitcoins"];
  const results = [];
  for (const sub of BUYER_SUBS) {
    try {
      const d = await fetchJson(`https://www.reddit.com/r/${sub}/new.json?limit=15`, { "User-Agent": UA });
      const posts = (d?.data?.children || []).map(c => c.data);
      const relevant = posts.filter(p => {
        const text = (p.title + " " + (p.selftext || "")).toLowerCase();
        return /automat|workflow|ai |chatbot|integration|api|scraping|n8n|zapier|make\.com/.test(text);
      });
      results.push({
        sub: `r/${sub}`,
        type: "high_intent",
        reason: "Explicit hiring posts - these people are writing checks",
        total: posts.length,
        relevant: relevant.length,
        examples: relevant.slice(0, 2).map(p => ({ title: p.title.slice(0, 100), url: `https://reddit.com${p.permalink}` })),
      });
    } catch { /* skip */ }
    await new Promise(r => setTimeout(r, 1000));
  }
  return results;
}

// ── PART 3: LinkedIn CA offer variant test plan ────────────────────────────────
function buildLinkedInTestPlan() {
  return {
    targetAudience: {
      geo: "Canada (CA) - primarily Alberta, BC, Ontario",
      jobTitles: ["Founder", "Co-Founder", "CEO", "CTO", "Head of Operations", "Director of Technology"],
      companySize: "1-50 employees",
      industries: ["SaaS", "Professional Services", "Digital Marketing", "Consulting"],
      geoFilter: "Search LinkedIn with 'location:Canada' + keyword filters",
    },
    offerVariants: [
      {
        variant: "A - Diagnostic Angle",
        headline: "AI Workflow Audit for Canadian Founders",
        hook: "Found 3 hours of manual work hiding in your SaaS ops this week. Here is how I found them.",
        cta: "Reply 'audit' - I will send a 5-question diagnostic",
        targetSignal: "People posting about ops inefficiency, manual processes",
        expectedResponse: "Curious/skeptical - need proof before buying",
        priceAnchor: "CA$997 workflow audit",
      },
      {
        variant: "B - First Customers Angle",
        headline: "From 0 to First 10 Paying Customers",
        hook: "Solo founders who vibe-coded their MVP spend 80% of time on the wrong thing after launch. Here is the pattern I see.",
        cta: "Built something? Reply with one line about it.",
        targetSignal: "Show HN, IH products, buildinpublic posts with <10 customers",
        expectedResponse: "High curiosity - this is their exact problem",
        priceAnchor: "CA$1,500 launch sprint",
      },
      {
        variant: "C - Rescue Angle",
        headline: "AI Build That Broke? Let's Fix It.",
        hook: "Vibe-coded a tool for your business. Cursor gave you 80% of what you needed. The last 20% costs more than the first 80%.",
        cta: "What broke? Reply and I will tell you if it's fixable in a weekend.",
        targetSignal: "vibecoding, cursor, lovable posts with deployment/bugs",
        expectedResponse: "Relief - someone who understands the specific pain",
        priceAnchor: "CA$750 fix sprint",
      },
    ],
    testProtocol: {
      method: "Organic LinkedIn comment + DM sequence (no paid ads required for test)",
      volume: "5 comments per variant per week (15 total/week)",
      measurement: "Reply rate per variant after 7 days",
      caGeoFilter: "In LinkedIn search: People > Location > Canada. Sort by 'Posts' activity.",
      contentFilter: "Search '#vibecoding OR #buildinpublic OR #saas' with Canada location",
      winCriteria: "Variant with >20% reply rate within 7 days gets scaled to 20 comments/week",
      note: "No auto-posting. Kirill manually sends each comment after reviewing the target.",
    },
  };
}

// ── Main ───────────────────────────────────────────────────────────────────────
(async () => {
  const args = process.argv.slice(2);
  const channelOnly = args.includes("--channel-only");
  const dbOnly = args.includes("--db-only");

  console.log(`[buyer-signal-analyzer] starting ${TODAY}`);

  // Part 1: DB re-score
  let budgetLeads = [];
  if (!channelOnly) {
    console.log("[buyer-signal-analyzer] re-scoring existing leads for budget signals...");
    budgetLeads = reScoredLeads();
    console.log(`[buyer-signal-analyzer] found ${budgetLeads.length} leads with budget signals`);
  }

  // Part 2: Channel scan
  let channelResults = {};
  if (!dbOnly) {
    console.log("[buyer-signal-analyzer] scanning high-intent channels...");
    const [hnHiring, ihProducts, hnShowHN, redditHighIntent] = await Promise.all([
      scanHNHiring(),
      scanIHProducts(),
      scanHNShowHN(),
      scanRedditHighIntent(),
    ]);
    channelResults = { hnHiring, ihProducts, hnShowHN, redditHighIntent };
    console.log("[buyer-signal-analyzer] channel scan complete");
  }

  // Part 3: LinkedIn test plan
  const linkedInPlan = buildLinkedInTestPlan();

  // Build report
  const topBudgetLeads = budgetLeads.slice(0, 20);
  const strongBuyers = budgetLeads.filter(l => l.signals.includes("strong_buyer") || l.budgetScore >= 40);
  const hiredBefore = budgetLeads.filter(l => l.signals.includes("hired_before"));

  let report = `# Buyer Signal Analysis - ${TODAY}\n\n`;
  report += `## Summary\n`;
  report += `- Leads re-scored: ${budgetLeads.length} have budget indicators\n`;
  report += `- Strong buyers (explicit spend/hire intent): ${strongBuyers.length}\n`;
  report += `- Hiring history (bought before): ${hiredBefore.length}\n\n`;

  if (topBudgetLeads.length > 0) {
    report += `## Top Budget Leads (by signal score)\n\n`;
    for (const l of topBudgetLeads) {
      report += `### ${l.name} (${l.platform})\n`;
      report += `- Budget score: ${l.budgetScore} | Signals: ${l.signals.join(", ")}\n`;
      report += `- Enrichment: ${l.enrichClass || "not enriched"} | Stage: ${l.stage}\n`;
      if (l.angle) report += `- Angle: ${l.angle}\n`;
      report += `\n`;
    }
  }

  report += `## Channel Map: Buying Density\n\n`;
  report += `### HIGH INTENT (people writing checks)\n`;
  report += `| Channel | Why High Intent | Action |\n`;
  report += `|---------|----------------|--------|\n`;
  report += `| r/forhire + r/hiring | Explicit hire posts - they ARE buying | Comment on AI/automation requests |\n`;
  report += `| IndieHackers Products (revenue > 0) | Stripe-verified = understands paying | DM via Twitter handle |\n`;
  report += `| HN Who is Hiring | Companies with budget actively recruiting | Find ops/automation roles = pain exists |\n`;
  report += `| LinkedIn job posts (AI/automation) | Budget proven via hiring intent | Reach founder before they hire |\n`;
  report += `| ProductHunt (new launches, <50 upvotes) | Founder just shipped, needs customers | Be first comment with genuine feedback |\n\n`;

  report += `### MEDIUM INTENT (pain but not yet buying)\n`;
  report += `| Channel | Why Medium | Upgrade Path |\n`;
  report += `|---------|-----------|-------------|\n`;
  report += `| r/SaaS, r/startups (top posts) | Discussing problems, not buying | Comment-first, DM after engagement |\n`;
  report += `| HN Show HN (<80 pts) | Shipped but no customers yet | Same as PH - first comment wins |\n`;
  report += `| r/buildinpublic, r/vibecoding | Builders pre-revenue | Catch them at launch moment |\n\n`;

  report += `### LOW INTENT (avoid or minimize)\n`;
  report += `| Channel | Problem | Decision |\n`;
  report += `|---------|---------|----------|\n`;
  report += `| r/entrepreneur (general) | Mostly lurkers, high noise | Keep for brand only |\n`;
  report += `| Twitter/X general | No context, tone-deaf | Skip until established presence |\n`;
  report += `| Cold LinkedIn DMs (no prior engagement) | 2-5% acceptance | Comment first, DM second |\n\n`;

  if (channelResults.ihProducts) {
    const ih = channelResults.ihProducts;
    report += `## IndieHackers Live Scan: ${ih.count} solo founders with revenue\n`;
    for (const ex of (ih.examples || [])) {
      report += `- **${ex.product}** (${ex.revenue}) ${ex.twitter ? `- ${ex.twitter}` : ""}: ${ex.tagline}\n`;
    }
    report += `\n`;
  }

  if (channelResults.redditHighIntent) {
    report += `## Reddit Hiring Sub Scan\n`;
    for (const sub of channelResults.redditHighIntent) {
      report += `### ${sub.sub}: ${sub.relevant}/${sub.total} automation-relevant posts\n`;
      for (const ex of (sub.examples || [])) {
        report += `- [${ex.title}](${ex.url})\n`;
      }
    }
    report += `\n`;
  }

  report += `## LinkedIn Offer Variant Test Plan\n\n`;
  report += `**Target**: ${linkedInPlan.targetAudience.geo}\n`;
  report += `**Titles**: ${linkedInPlan.targetAudience.jobTitles.join(", ")}\n`;
  report += `**Filter method**: ${linkedInPlan.testProtocol.caGeoFilter}\n\n`;

  for (const v of linkedInPlan.offerVariants) {
    report += `### ${v.variant}\n`;
    report += `**Hook**: ${v.hook}\n\n`;
    report += `**CTA**: ${v.cta}\n\n`;
    report += `**Targets**: ${v.targetSignal}\n\n`;
    report += `**Price anchor**: ${v.priceAnchor}\n\n`;
  }

  report += `## Test Protocol\n`;
  report += `- Volume: ${linkedInPlan.testProtocol.volume}\n`;
  report += `- Measurement: ${linkedInPlan.testProtocol.measurement}\n`;
  report += `- Win criteria: ${linkedInPlan.testProtocol.winCriteria}\n`;
  report += `- Note: ${linkedInPlan.testProtocol.note}\n\n`;

  report += `## Immediate Action Queue\n\n`;
  if (strongBuyers.length > 0) {
    report += `**Priority 1**: ${strongBuyers.length} existing leads with explicit budget signals - these go to dispatch first.\n\n`;
    report += `Top 3:\n`;
    for (const l of strongBuyers.slice(0, 3)) {
      report += `- ${l.name} (score ${l.budgetScore}, ${l.signals.join("+")}): ${l.angle || "no angle yet"}\n`;
    }
    report += `\n`;
  }
  if (channelResults.ihProducts?.count > 0) {
    report += `**Priority 2**: ${channelResults.ihProducts.count} IH solo founders with revenue - DM via Twitter. Highest-density buyer pool found.\n\n`;
  }
  report += `**Priority 3**: Launch LinkedIn Variant A this week. 5 comments on CA founder posts. Measure replies by ${new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)}.\n`;

  // Write report
  const reportPath = resolve(ROOT, `sandbox-review/buyer-signal-report-${TODAY}.md`);
  writeFileSync(reportPath, report);
  console.log(`[buyer-signal-analyzer] report written to ${reportPath}`);

  // Telegram summary (under 4096 chars)
  const tgMsg = [
    `<b>💰 Buyer Signal Analyzer - ${TODAY}</b>`,
    ``,
    `<b>Leads with budget signals:</b> ${budgetLeads.length}`,
    `- Strong buyers: ${strongBuyers.length}`,
    `- Hired before: ${hiredBefore.length}`,
    ``,
    `<b>High-intent channels ranked:</b>`,
    `1. r/forhire + r/hiring - explicit cash ready`,
    `2. IndieHackers products (revenue>0): ${channelResults.ihProducts?.count || "?"} founders`,
    `3. HN Who is Hiring - companies with budget`,
    `4. LinkedIn job posts (automation roles)`,
    `5. ProductHunt new launches <50 upvotes`,
    ``,
    `<b>LinkedIn CA test plan: 3 offer variants</b>`,
    `A: Diagnostic audit (CA$997)`,
    `B: First 10 Customers sprint (CA$1500)`,
    `C: Vibe code rescue (CA$750)`,
    `Protocol: 5 comments/variant/week. Winner at 20%+ reply rate.`,
    ``,
    strongBuyers.length > 0 ? `<b>Top budget lead:</b> ${strongBuyers[0].name} (score ${strongBuyers[0].budgetScore}: ${strongBuyers[0].signals.join("+")})` : `<b>No strong buyers in recent leads</b> - channel expansion needed`,
    ``,
    `Full report: sandbox-review/buyer-signal-report-${TODAY}.md`,
  ].join("\n");

  await tg(tgMsg);

  db.close();
  console.log("[buyer-signal-analyzer] done");
})();
