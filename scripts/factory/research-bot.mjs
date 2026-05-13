/**
 * RESEARCH BOT — Kirill's Autonomous Intelligence Agent
 *
 * Runs nightly at 3 AM. Works while Kirill sleeps.
 *
 * What it does:
 * 1. Monitors competitors globally — pricing, new pages, weaknesses
 * 2. Finds demand signals — n8n jobs, automation requests WORLDWIDE
 * 3. Scans emerging markets — Africa, CIS, SEA, MENA, LatAm
 * 4. Tracks market heat scores — learns which countries are heating up
 * 5. Detects market spikes — alerts when a new market suddenly activates
 * 6. Saves everything to DB → morning brief includes global intelligence
 *
 * LEARNING SYSTEM:
 * Every signal found from a country increments that country's heat score.
 * Weekly comparison detects which markets are emerging BEFORE they're obvious.
 * The system discovers new markets autonomously — Kirill never needs to add them.
 *
 * Kirill's unique advantage: Russian language → CIS markets (300M people, 0 competitors)
 */

import { getDb, callAI, tgSendToKirill, heartbeat, setIntelligence, getIntelligenceKey, logActivity, env, MODEL_MINI, isCleanOutreach, reportError, clearError } from "./orchestrator.mjs";
import { sendLeadCard } from "./telegram-control.mjs";

const BOT_NAME = "research-bot";

const BRAVE_API_KEY = env.BRAVE_SEARCH_API_KEY;

// ── Brave Search ──────────────────────────────────────────────────────
async function braveSearch(query, count = 8) {
  if (!BRAVE_API_KEY) return [];
  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}&country=CA`;
    const res = await fetch(url, {
      headers: { "Accept": "application/json", "X-Subscription-Token": BRAVE_API_KEY },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.web?.results || []).map(r => ({
      title: r.title,
      url: r.url,
      description: r.description || ""
    }));
  } catch { return []; }
}

// ── Fetch a page and extract text ─────────────────────────────────────
async function fetchPageText(url) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; research-bot/1.0)" },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return "";
    const html = await res.text();
    // Strip tags, get readable text
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 3000);
  } catch { return ""; }
}

// ── Fetch Reddit posts via public JSON ────────────────────────────────
async function fetchReddit(subreddit, query, limit = 10) {
  try {
    const url = `https://www.reddit.com/r/${subreddit}/search.json?q=${encodeURIComponent(query)}&sort=new&limit=${limit}&restrict_sr=1`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; research-bot/1.0)" },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return [];
    const data = await res.json();
    const now = Date.now() / 1000;
    return (data?.data?.children || [])
      .map(c => c.data)
      .filter(p => (now - p.created_utc) < 7 * 24 * 3600) // last 7 days
      .map(p => ({
        title: p.title,
        body: (p.selftext || "").slice(0, 400),
        url: "https://reddit.com" + p.permalink,
        subreddit: p.subreddit,
        score: p.score,
        created: p.created_utc
      }));
  } catch { return []; }
}

// ── Monitor competitors ───────────────────────────────────────────────
const COMPETITORS = [
  { name: "The Automators", url: "https://theautomators.ai", searchQuery: "The Automators Calgary AI automation" },
  { name: "NuTab Digital", url: "https://nutab.ca/services/ai-automation/", searchQuery: "NuTab Digital Calgary automation" },
  { name: "Calgary AI", url: "https://calgary-ai.ca", searchQuery: "calgary-ai.ca automation pricing" },
  { name: "MakeAI Consulting", url: "https://makeai.ca", searchQuery: "MakeAI Calgary consulting" },
];

async function monitorCompetitors(db) {
  console.log(`[${BOT_NAME}] Monitoring ${COMPETITORS.length} competitors...`);
  const findings = [];

  for (const comp of COMPETITORS) {
    try {
      const text = await fetchPageText(comp.url);
      if (!text) continue;

      // Check for pricing mentions
      const hasPricing = /\$[\d,]+|\d+,?\d+\s*(CAD|USD|\/month|\/mo|per month)/i.test(text);
      const pricingMatches = text.match(/\$[\d,]+[^.]{0,50}/g) || [];

      // Store snapshot hash to detect changes
      const snapshot = text.slice(0, 500);
      const prevKey = `competitor_${comp.name.replace(/\s+/g, "_")}`;
      const prev = getIntelligenceKey(db, BOT_NAME, "competitor_snapshots", prevKey);

      const changed = prev && prev.snapshot !== snapshot;

      setIntelligence(db, BOT_NAME, "competitor_snapshots", prevKey, {
        name: comp.name,
        url: comp.url,
        snapshot,
        hasPricing,
        pricing: pricingMatches.slice(0, 3),
        checkedAt: new Date().toISOString()
      }, 90);

      if (changed) {
        findings.push(`⚠️ <b>${comp.name}</b> сайт изменился — проверь: ${comp.url}`);
        console.log(`[${BOT_NAME}] ${comp.name} changed!`);
      }

      console.log(`[${BOT_NAME}] ${comp.name}: ${hasPricing ? "has pricing" : "no pricing"}`);
    } catch (e) {
      console.error(`[${BOT_NAME}] Error monitoring ${comp.name}:`, e.message);
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  return findings;
}

// ── Market heat tracking — LEARNING SYSTEM ───────────────────────────
function updateMarketHeatScore(db, market) {
  if (!market || market === "unknown") return;
  const week = getWeekKey();
  const key = `week_${week}`;
  const existing = getIntelligenceKey(db, BOT_NAME, "market_heat", key) || {};
  existing[market] = (existing[market] || 0) + 1;
  setIntelligence(db, BOT_NAME, "market_heat", key, existing, 60);
}

function getWeekKey() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const week = Math.ceil(((now - start) / 86400000 + start.getDay() + 1) / 7);
  return `${now.getFullYear()}_W${week}`;
}

function detectMarketSpikes(db) {
  const thisWeek = getWeekKey();
  const [year, wNum] = thisWeek.split("_W").map(Number);
  const lastWeekNum = wNum > 1 ? wNum - 1 : 52;
  const lastWeek = `${wNum > 1 ? year : year - 1}_W${lastWeekNum}`;

  const thisData = getIntelligenceKey(db, BOT_NAME, "market_heat", `week_${thisWeek}`) || {};
  const lastData = getIntelligenceKey(db, BOT_NAME, "market_heat", `week_${lastWeek}`) || {};

  const spikes = [];
  for (const [market, count] of Object.entries(thisData)) {
    const prev = lastData[market] || 0;
    if (count >= 3 && prev === 0) {
      spikes.push({ market, count, type: "new" });
    } else if (prev > 0 && count / prev >= 2.5) {
      spikes.push({ market, count, prev, type: "spike", growth: Math.round(count / prev * 100) + "%" });
    }
  }
  return spikes;
}

function getTopMarketsByHeat(db, limit = 8) {
  const week = getWeekKey();
  const data = getIntelligenceKey(db, BOT_NAME, "market_heat", `week_${week}`) || {};
  return Object.entries(data)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([market]) => market);
}

// ── Load Kirill's intel feedback to guide scoring ─────────────────────
function loadIntelFeedback(db) {
  const parts = [];

  // Old-style manual feedback
  try {
    const history = getIntelligenceKey(db, "research-bot", "intel_feedback", "history") || [];
    if (history.length > 0) {
      parts.push(`Kirill's feedback on previous reports:\n${history.slice(-5).map(h => `- "${h.feedback}"`).join("\n")}`);
    }
  } catch {}

  // LearnBot generated rules (auto-updated daily)
  try {
    const scoring = getIntelligenceKey(db, "learn-bot", "learned_rules", "lead_scoring");
    if (scoring) {
      if (scoring.hard_reject_patterns?.length) {
        parts.push(`LEARNED hard-reject patterns (from Kirill's feedback): ${scoring.hard_reject_patterns.join(", ")}`);
      }
      if (scoring.hard_accept_patterns?.length) {
        parts.push(`LEARNED accept signals: ${scoring.hard_accept_patterns.join(", ")}`);
      }
      if (scoring.icp_refinement) {
        parts.push(`LEARNED ICP: ${scoring.icp_refinement}`);
      }
    }
  } catch {}

  return parts.length > 0 ? `\n${parts.join("\n")}` : "";
}

// Load learned outreach style rules from LearnBot
function loadOutreachRules(db) {
  try {
    const rules = getIntelligenceKey(db, "learn-bot", "learned_rules", "outreach_style");
    if (!rules) return "";
    const parts = [];
    if (rules.banned_openers?.length) parts.push(`BANNED OPENERS: ${rules.banned_openers.join(", ")}`);
    if (rules.tone_rules?.length) parts.push(`TONE: ${rules.tone_rules.join("; ")}`);
    if (rules.required_elements?.length) parts.push(`MUST INCLUDE: ${rules.required_elements.join("; ")}`);
    return parts.length > 0 ? `\nLEARNED RULES:\n${parts.join("\n")}` : "";
  } catch { return ""; }
}

// ── Extract date from search result snippet ───────────────────────────
function extractDateFromSnippet(title, description) {
  const text = `${title} ${description}`;

  // Explicit year patterns: "Nov 2025", "November 2025", "2025-11", "03/2025"
  const monthNames = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december";
  const patterns = [
    new RegExp(`(${monthNames})[\\s,.-]+(20\\d{2})`, "i"),
    new RegExp(`(20\\d{2})[\\s,.-]+(${monthNames})`, "i"),
    /(\d{1,2})[\/\-\.](20\d{2})/,
    /(20\d{2})[\/\-\.](\d{1,2})/,
    /posted\s+(\w+\s+\d{1,2},?\s+20\d{2})/i,
  ];

  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (m) {
      try {
        const d = new Date(m[0]);
        if (!isNaN(d.getTime()) && d.getFullYear() >= 2020) return d;
      } catch {}
    }
  }
  return null;
}

function isTooOld(title, description, maxDays = 45) {
  const date = extractDateFromSnippet(title, description);
  if (!date) return false; // can't determine — allow through, AI will judge
  const ageDays = (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays > maxDays) {
    console.log(`[${BOT_NAME}] ⏰ Too old (${Math.round(ageDays)}d): ${title.slice(0, 60)}`);
    return true;
  }
  return false;
}

// ── AI scoring — returns relevance + market tag ───────────────────────
async function scoreResult(title, description, url, context, feedbackContext = "") {
  try {
    const result = await callAI(
      `You are a strict lead quality filter for Kirill D. — remote AI automation consultant (works globally from Calgary).

A result is RELEVANT only if it is:
- A real business or person ACTIVELY LOOKING to hire an AI/automation consultant (any country)
- OR a real business showing pain with manual/repetitive processes that automation could solve
- OR a freelance/contract posting for n8n, automation, AI workflow, or process automation work
- High-value markets: UAE, UK, Australia, Singapore, Kenya, Nigeria, Brazil, Kazakhstan, Poland

A result is IRRELEVANT if it is:
- A competitor agency, SaaS product, or consulting firm
- A generic article, blog post, tutorial, or listicle
- A directory listing, ranking, or aggregator
- A full-time employment job posting (not freelance/contract/consulting)
- Unrelated to automation, AI, or workflow efficiency
- Personal finance, investment, or company acquisition questions
${feedbackContext}
Return JSON only: { "relevant": true/false, "reason": "one sentence", "market": "country or region name" }`,
      `Title: ${title}\nDescription: ${description}\nURL: ${url}\nContext: ${context}`
    );
    return { relevant: result?.relevant === true, market: result?.market || "unknown" };
  } catch { return { relevant: false, market: "unknown" }; }
}

// ── Find demand signals — GLOBAL ──────────────────────────────────────
async function findDemandSignals(db) {
  console.log(`[${BOT_NAME}] Searching for demand signals globally...`);
  const candidates = [];

  // Global web searches — broad net, all markets
  const searches = [
    // Core demand signals
    "n8n automation consultant hire freelance 2026",
    "AI automation workflow freelancer hire remote",
    "Zapier to n8n migration consultant hire",
    "n8n workflow expert hire project",
    "n8n developer freelance contract remote",
    "business process automation consultant hire",
    "workflow automation freelancer upwork 2026",
    // High-budget markets
    "AI automation UAE digital transformation consultant hire",
    "automation consultant Australia SMB hire 2026",
    "n8n automation UK business hire consultant",
    "AI automation consultant Singapore hire freelance",
    "Canada AI automation consultant hire project",
    // Emerging / first-mover markets
    "AI automation Nigeria Kenya Ghana startup hire",
    "automation consultant Kazakhstan Uzbekistan hire",
    "Brazil Mexico automation workflow consultant hire",
    "Vietnam Indonesia Philippines automation hire 2026",
    "Egypt Morocco automation AI consultant hire",
    "Poland Romania startup automation consultant",
    // Pain signals (people searching for solutions)
    "automate business processes without hiring developer",
    "n8n help setup workflow small business",
  ];

  for (const q of searches) {
    const results = await braveSearch(q, 5);
    for (const r of results) {
      const isCompetitor = COMPETITORS.some(c => {
        try { return r.url.includes(new URL(c.url).hostname); } catch { return false; }
      });
      if (!isCompetitor) candidates.push({ ...r, query: q });
    }
    await new Promise(r => setTimeout(r, 350));
  }

  // n8n Community forum — people directly asking for help
  const n8nCommunitySearches = [
    "site:community.n8n.io looking for consultant",
    "site:community.n8n.io hire freelancer help",
    "site:community.n8n.io need help workflow",
  ];
  for (const q of n8nCommunitySearches) {
    const results = await braveSearch(q, 5);
    for (const r of results) candidates.push({ ...r, query: q, platform: "n8n_community" });
    await new Promise(r => setTimeout(r, 350));
  }

  // Reddit — expanded subreddit list + geo-specific
  const redditSearches = [
    // Core automation subreddits
    { sub: "n8n", q: "looking for help hire consultant" },
    { sub: "n8n", q: "need freelancer workflow" },
    { sub: "automation", q: "consultant hire project" },
    { sub: "nocode", q: "hire help automation consultant" },
    { sub: "lowcode", q: "need developer automation" },
    // Business subreddits
    { sub: "smallbusiness", q: "need automation help" },
    { sub: "Entrepreneur", q: "looking for automation developer" },
    { sub: "freelance", q: "n8n automation project" },
    // NOTE: r/forhire is NOT scraped — those posts are freelancers SELLING services, not buyers
    // Regional subreddits — emerging markets
    { sub: "Nigeria", q: "automation business startup" },
    { sub: "Kenya", q: "automation business hire" },
    { sub: "india", q: "n8n automation consultant" },
    { sub: "Philippines", q: "automation workflow business" },
    { sub: "brasil", q: "automação negócios contratar" },
    // HackerNews hiring threads
    { sub: "HiringAndJobSearch", q: "n8n automation workflow" },
  ];

  for (const { sub, q } of redditSearches) {
    const posts = await fetchReddit(sub, q, 5);
    for (const p of posts) {
      candidates.push({
        title: p.title,
        url: p.url,
        description: p.body.slice(0, 300),
        platform: `r/${p.subreddit}`,
        query: q
      });
    }
    await new Promise(r => setTimeout(r, 400));
  }

  // DATE FILTER: reject anything older than 45 days before AI call
  const dated = candidates.filter(c => !isTooOld(c.title, c.description || "", 45));
  const tooOldCount = candidates.length - dated.length;
  if (tooOldCount > 0) console.log(`[${BOT_NAME}] ⏰ Rejected ${tooOldCount} results as too old`);

  // AI-filter every candidate — only keep genuinely relevant ones
  const feedbackCtx = loadIntelFeedback(db);
  console.log(`[${BOT_NAME}] AI-filtering ${dated.length} demand candidates...`);
  const signals = [];
  for (const c of dated) {
    const { relevant, market } = await scoreResult(c.title, c.description || "", c.url, "demand signal for remote AI automation consultant", feedbackCtx);
    if (relevant) {
      signals.push({ ...c, market, foundAt: new Date().toISOString() });
      updateMarketHeatScore(db, market);
      console.log(`[${BOT_NAME}] ✅ Signal [${market}]: ${c.title.slice(0, 60)}`);
    } else {
      console.log(`[${BOT_NAME}] ❌ Filtered: ${c.title.slice(0, 60)}`);
    }
    await new Promise(r => setTimeout(r, 200));
  }

  if (signals.length > 0) {
    setIntelligence(db, BOT_NAME, "demand_signals", "latest", signals.slice(0, 20), 14);
  }

  console.log(`[${BOT_NAME}] Demand signals after filter: ${signals.length}/${candidates.length}`);
  return signals;
}

// ── Scan emerging markets — Africa, CIS, SEA, India ──────────────────
async function scanEmergingMarkets(db) {
  console.log(`[${BOT_NAME}] Scanning emerging markets...`);

  const emergingQueries = [
    // Africa — explosive fintech + startup growth, governments pouring money into AI
    "Nigeria Kenya Ghana startup AI automation consultant hire 2026",
    "Africa fintech startup manual processes automate workflow",
    "South Africa SMB digital transformation automation consultant",
    // CIS / Russian-speaking — Kirill's language = unique advantage, zero competitors
    "Казахстан автоматизация бизнеса n8n консультант найти",
    "Узбекистан цифровая трансформация автоматизация процессов",
    "Kazakhstan business automation digital transformation consultant hire",
    // India Tier 2-3 — millions of SMBs going digital right now
    "India SMB startup automation workflow consultant freelance hire",
    "Bangalore Mumbai startup business process automation n8n",
    // Vietnam + Indonesia — manufacturing + ecommerce automation wave
    "Vietnam Indonesia startup automation workflow hire consultant",
    "Southeast Asia digital transformation manual process pain 2026",
    // Egypt, Morocco, Jordan — World Bank digital grants flowing
    "Egypt Morocco Jordan AI digital transformation automation consultant",
    // Eastern Europe — EU digital funds, technical market
    "Poland Romania Czech startup automation consultant hire",
  ];

  const candidates = [];
  for (const q of emergingQueries) {
    const results = await braveSearch(q, 4);
    for (const r of results) {
      const isDirectory = /directory|list of|top \d+|best \d+|agencies in|clutch\.co/i.test(r.title + r.url);
      if (!isDirectory) candidates.push({ ...r, query: q, scanType: "emerging" });
    }
    await new Promise(r => setTimeout(r, 400));
  }

  const datedEm = candidates.filter(c => !isTooOld(c.title, c.description || "", 60));
  const feedbackCtxEm = loadIntelFeedback(db);
  console.log(`[${BOT_NAME}] AI-filtering ${datedEm.length} emerging market candidates...`);
  const prospects = [];
  for (const c of datedEm) {
    const { relevant, market } = await scoreResult(c.title, c.description || "", c.url, "emerging market business with automation need, Kirill works remotely globally", feedbackCtxEm);
    if (relevant) {
      prospects.push({ ...c, market, foundAt: new Date().toISOString() });
      updateMarketHeatScore(db, market);
      console.log(`[${BOT_NAME}] ✅ Emerging [${market}]: ${c.title.slice(0, 55)}`);
    }
    await new Promise(r => setTimeout(r, 200));
  }

  setIntelligence(db, BOT_NAME, "emerging_prospects", "latest", prospects.slice(0, 20), 7);
  console.log(`[${BOT_NAME}] Emerging prospects: ${prospects.length}/${candidates.length}`);
  return prospects;
}

// ── Research global business prospects ────────────────────────────────
async function researchGlobalProspects(db) {
  console.log(`[${BOT_NAME}] Researching global business opportunities...`);

  // Static tier-1 queries — proven high-budget markets
  const staticQueries = [
    "UAE small business AI automation workflow pain 2026",
    "Dubai SMB manual processes inefficiency automate",
    "UK small business owner automate manual workflows",
    "London accounting firm manual invoicing automate",
    "Australia small business automation consultant hire",
    "Brazil startup automation n8n workflow consultant",
    "Singapore Philippines startup manual workflow automation",
    "Canada small business AI automation consultant hire",
  ];

  // Dynamic queries from learned hot markets — system improves over time
  const topMarkets = getTopMarketsByHeat(db, 5);
  const dynamicQueries = topMarkets
    .filter(m => m !== "unknown")
    .map(m => `${m} business automation AI consultant hire 2026`);

  const queries = [...staticQueries, ...dynamicQueries];

  const candidates = [];

  for (const q of queries) {
    const results = await braveSearch(q, 5);
    for (const r of results) {
      const isCompetitor = COMPETITORS.some(c => {
        try { return r.url.includes(new URL(c.url).hostname); } catch { return false; }
      });
      const isDirectory = /directory|list of|top \d+|best \d+|agencies in|clutch\.co|hellodarwin/i.test(r.title + r.url);
      if (!isCompetitor && !isDirectory) candidates.push({ ...r, query: q });
    }
    await new Promise(r => setTimeout(r, 400));
  }

  const datedGl = candidates.filter(c => !isTooOld(c.title, c.description || "", 60));
  // AI-filter: real businesses with automation pain anywhere in the world
  const feedbackCtxGl = loadIntelFeedback(db);
  console.log(`[${BOT_NAME}] AI-filtering ${datedGl.length} global prospects...`);
  const prospects = [];
  for (const c of datedGl) {
    const { relevant, market } = await scoreResult(c.title, c.description || "", c.url, "business with manual process pain, potential remote client for AI automation consultant", feedbackCtxGl);
    if (relevant) {
      prospects.push({ ...c, market, foundAt: new Date().toISOString() });
      updateMarketHeatScore(db, market);
      console.log(`[${BOT_NAME}] ✅ Prospect [${market}]: ${c.title.slice(0, 60)}`);
    } else {
      console.log(`[${BOT_NAME}] ❌ Filtered: ${c.title.slice(0, 60)}`);
    }
    await new Promise(r => setTimeout(r, 200));
  }

  setIntelligence(db, BOT_NAME, "global_prospects", "latest", prospects.slice(0, 20), 7);
  // Keep calgary_prospects key for backward compat with brief-agent
  setIntelligence(db, BOT_NAME, "calgary_prospects", "latest", prospects.slice(0, 15), 7);
  console.log(`[${BOT_NAME}] Global prospects after filter: ${prospects.length}/${candidates.length}`);
  return prospects;
}

// ── Identify hottest global markets + detect spikes ───────────────────
async function identifyHotMarkets(db) {
  console.log(`[${BOT_NAME}] Scanning global AI market signals...`);

  // Check for market spikes from this week's learning data
  const spikes = detectMarketSpikes(db);
  const topMarkets = getTopMarketsByHeat(db, 6);

  const marketQueries = [
    "AI automation consultant demand global 2026 freelance hire",
    "n8n workflow consultant hire remote worldwide 2026",
    "Africa Nigeria Kenya AI startup digital transformation 2026",
    "Kazakhstan Uzbekistan digital transformation business AI 2026",
    "Vietnam Indonesia Philippines AI automation SMB 2026",
    "government AI grant digital transformation 2026 fund",
    "World Bank digital transformation AI developing countries 2026",
  ];

  const raw = [];
  for (const q of marketQueries) {
    const results = await braveSearch(q, 3);
    raw.push(...results.map(r => `${r.title}: ${r.description || ""}`));
    await new Promise(r => setTimeout(r, 400));
  }

  const spikeContext = spikes.length > 0
    ? `\nMarket spikes detected this week: ${spikes.map(s => `${s.market} (${s.type === "new" ? "NEW market" : "+" + s.growth})`).join(", ")}`
    : "";

  const heatContext = topMarkets.length > 0
    ? `\nTop markets by signal count this week: ${topMarkets.join(", ")}`
    : "";

  const analysis = await callAI(
    `You are a global market intelligence analyst for Kirill D. — remote AI automation consultant (n8n, LLMs).
Kirill speaks English and Russian — giving him unique access to CIS markets (Kazakhstan, Uzbekistan, etc).
Based on search results and market data, write 4-5 sentences covering:
1. Which 2-3 markets are hottest RIGHT NOW for automation consultants?
2. Any country where AI is just arriving = first-mover opportunity?
3. Any government funding or grants that create budget for consultants?
4. One specific market where competition is lowest but demand is growing?
Be specific: name countries, industries, dollar amounts, programs. No generic advice.
Return plain text.`,
    `${raw.slice(0, 15).join("\n")}${spikeContext}${heatContext}`,
    MODEL_MINI,
    false
  );

  // Alert if new market spike detected
  if (spikes.length > 0) {
    const spikeMsg = spikes.map(s =>
      s.type === "new"
        ? `🆕 <b>Новый рынок:</b> ${s.market} — ${s.count} сигналов (0 на прошлой неделе)`
        : `📈 <b>Спайк:</b> ${s.market} — ${s.count} сигналов (рост ${s.growth} за неделю)`
    ).join("\n");
    await tgSendToKirill(`🌍 <b>Рыночный сигнал!</b>\n\n${spikeMsg}`);
    console.log(`[${BOT_NAME}] Market spikes detected: ${spikes.map(s => s.market).join(", ")}`);
  }

  if (analysis) {
    setIntelligence(db, BOT_NAME, "market_intelligence", "latest", {
      analysis,
      topMarkets,
      spikes,
      ranAt: new Date().toISOString()
    }, 3);
    console.log(`[${BOT_NAME}] Market intelligence saved. Top markets: ${topMarkets.join(", ") || "none yet"}`);
  }

  return analysis;
}

// ── Generate living INTEL document ───────────────────────────────────
async function generateIntelDocument(db, demandSignals, prospects, emergingProspects, marketIntel, competitorFindings) {
  const { writeFileSync } = await import("fs");
  const { resolve, dirname } = await import("path");
  const { fileURLToPath } = await import("url");
  const __dir = dirname(fileURLToPath(import.meta.url));
  const intelPath = resolve(__dir, "../../.data/INTEL.md");

  const now = new Date();
  const dateStr = now.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
  const timeStr = now.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

  // Market heat breakdown
  const week = getWeekKey();
  const heatData = getIntelligenceKey(db, BOT_NAME, "market_heat", `week_${week}`) || {};
  const sortedMarkets = Object.entries(heatData).sort((a, b) => b[1] - a[1]);

  const prTarget = getIntelligenceKey(db, "pr-bot", "current_target_market", "market");

  // Group signals by market
  const signalsByMarket = {};
  for (const s of demandSignals) {
    const m = s.market || "unknown";
    if (!signalsByMarket[m]) signalsByMarket[m] = [];
    signalsByMarket[m].push(s);
  }

  // Group prospects by market
  const prospectsByMarket = {};
  for (const p of [...prospects, ...emergingProspects]) {
    const m = p.market || "unknown";
    if (!prospectsByMarket[m]) prospectsByMarket[m] = [];
    prospectsByMarket[m].push(p);
  }

  const lines = [];
  lines.push(`# 🌍 INTEL — Глобальная разведка`);
  lines.push(`> Обновлено: ${dateStr}, ${timeStr} | Запуск: research-bot`);
  lines.push(``);
  lines.push(`---`);
  lines.push(``);

  // === MARKET HEAT ===
  lines.push(`## 🔥 Тепловая карта рынков (эта неделя)`);
  lines.push(``);
  if (sortedMarkets.length > 0) {
    lines.push(`| Страна | Сигналов | Статус | Действие |`);
    lines.push(`|--------|----------|--------|---------|`);
    for (const [market, count] of sortedMarkets.slice(0, 15)) {
      if (market === "unknown") continue;
      const isTarget = prTarget?.market === market;
      const status = count >= 5 ? "🔴 Горячий" : count >= 3 ? "🟡 Тёплый" : "🟢 Мониторинг";
      const action = isTarget ? "**ФОКУС НЕДЕЛИ**" : count >= 5 ? "Подключись сейчас" : count >= 3 ? "Написать позже" : "Следить";
      lines.push(`| ${market} | ${count} | ${status} | ${action} |`);
    }
  } else {
    lines.push(`_Данных пока нет — ResearchBot накапливает сигналы (обычно 3-7 дней)_`);
  }
  lines.push(``);

  // === ACTIVE TARGET ===
  if (prTarget?.market) {
    lines.push(`## 🎯 Текущий фокус`);
    lines.push(``);
    lines.push(`**Рынок:** ${prTarget.market}`);
    lines.push(`**Начат:** ${new Date(prTarget.startedAt).toLocaleDateString("ru-RU")}`);
    lines.push(`**Истекает:** ${new Date(prTarget.expiresAt).toLocaleDateString("ru-RU")}`);
    lines.push(``);
    lines.push(`_PRBot выбрал этот рынок на основе сигналов. LinkedInHunter и ContentBot настроены на него._`);
    lines.push(``);
  }

  // === DEMAND SIGNALS — ACT NOW ===
  const hotSignals = demandSignals.filter(s => {
    if (!s.foundAt) return false;
    return Date.now() - new Date(s.foundAt).getTime() < 7 * 24 * 60 * 60 * 1000;
  });

  lines.push(`## 🚨 Активные сигналы спроса (последние 7 дней)`);
  lines.push(``);
  if (hotSignals.length > 0) {
    for (const s of hotSignals.slice(0, 15)) {
      const market = s.market && s.market !== "unknown" ? ` \`[${s.market}]\`` : "";
      lines.push(`- **${s.title.slice(0, 80)}**${market}`);
      if (s.description) lines.push(`  > ${s.description.slice(0, 150)}`);
      lines.push(`  🔗 ${s.url}`);
      lines.push(`  📅 ${new Date(s.foundAt).toLocaleDateString("ru-RU")} | 📍 ${s.platform || s.query || "web"}`);
      lines.push(``);
    }
  } else {
    lines.push(`_Нет свежих сигналов спроса. Следующая проверка ночью._`);
    lines.push(``);
  }

  // === PROSPECTS BY MARKET ===
  lines.push(`## 🏢 Бизнесы с болями — по рынкам`);
  lines.push(``);
  const allProspectMarkets = Object.entries(prospectsByMarket)
    .filter(([m]) => m !== "unknown")
    .sort((a, b) => b[1].length - a[1].length);

  if (allProspectMarkets.length > 0) {
    for (const [market, mProspects] of allProspectMarkets.slice(0, 10)) {
      lines.push(`### ${market} (${mProspects.length})`);
      for (const p of mProspects.slice(0, 4)) {
        lines.push(`- **${p.title.slice(0, 70)}**`);
        if (p.description) lines.push(`  > ${p.description.slice(0, 120)}`);
        lines.push(`  🔗 ${p.url}`);
      }
      lines.push(``);
    }
  } else {
    lines.push(`_Данных пока нет._`);
    lines.push(``);
  }

  // === MARKET INTELLIGENCE ===
  if (marketIntel) {
    lines.push(`## 🗺 Рыночная разведка`);
    lines.push(``);
    lines.push(marketIntel);
    lines.push(``);
  }

  // === COMPETITORS ===
  if (competitorFindings.length > 0) {
    lines.push(`## ⚠️ Изменения у конкурентов`);
    lines.push(``);
    for (const f of competitorFindings) {
      lines.push(`- ${f.replace(/<[^>]+>/g, "")}`);
    }
    lines.push(``);
  }

  // === ACTION MATRIX ===
  lines.push(`## ✅ Матрица действий`);
  lines.push(``);
  lines.push(`| Действие | Рынок | Срочность |`);
  lines.push(`|---------|-------|---------|`);

  const topMarkets = sortedMarkets.slice(0, 5).filter(([m]) => m !== "unknown");
  for (const [market, count] of topMarkets) {
    if (count >= 4) lines.push(`| Подключиться в LinkedIn | ${market} | 🔴 Сейчас |`);
    else if (count >= 2) lines.push(`| Написать пост для аудитории | ${market} | 🟡 На этой неделе |`);
    else lines.push(`| Мониторить сигналы | ${market} | 🟢 Позже |`);
  }

  if (hotSignals.length > 0) {
    lines.push(`| Ответить на ${hotSignals.length} запрос(ов) | Глобально | 🔴 Сейчас |`);
  }
  lines.push(``);

  lines.push(`---`);
  lines.push(`_Этот файл обновляется автоматически каждую ночь в 3 AM. Команда /intel в Telegram покажет краткую версию._`);

  writeFileSync(intelPath, lines.join("\n"), "utf-8");
  console.log(`[${BOT_NAME}] INTEL.md updated: ${intelPath}`);
  return intelPath;
}

// ── Generate intelligence summary ─────────────────────────────────────
async function generateSummary(competitorFindings, demandSignals, prospects, marketIntel) {
  const context = [
    demandSignals.length > 0 ? `Demand signals found (${demandSignals.length}): ${demandSignals.slice(0, 3).map(s => s.title).join("; ")}` : "",
    prospects.length > 0 ? `Global prospects (${prospects.length}): ${prospects.slice(0, 3).map(p => p.title).join("; ")}` : "",
    competitorFindings.length > 0 ? `Competitor changes: ${competitorFindings.join("; ")}` : "",
    marketIntel ? `Market intelligence: ${marketIntel.slice(0, 300)}` : "",
  ].filter(Boolean).join("\n");

  if (!context) return null;

  return callAI(
    `You are a revenue intelligence analyst for Kirill D. — remote AI automation consultant (n8n, LLMs). Works globally.
Based on overnight research, write ONE concrete action Kirill should take today.
Consider global markets: UAE, UK, Australia, LatAm, SEA — not just Calgary.
Be specific: name a business, a subreddit, a market, or a platform. Max 2 sentences. Direct and actionable.
Return plain text, not JSON.`,
    context,
    MODEL_MINI,
    false
  );
}


// ── Generate outreach message for a signal ────────────────────────────
async function generateOutreachMessage(signal, db = null) {
  try {
    const cleanDesc = (signal.description || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 400);

    const isReddit = (signal.platform || "").includes("reddit");

    // Load learned outreach rules from LearnBot (evolves over time)
    const learnedRules = db ? loadOutreachRules(db) : "";

    const BANNED_LIST = `ABSOLUTELY BANNED — do NOT use any of these under any circumstances:
"Hi there" / "Hello!" / "I can help you" / "I can build" / "I can create" / "I can set up"
"I specialize in" / "I noticed you" / "streamline" / "leverage" / "game-changer" / "seamlessly"
"Furthermore" / "Let me know if" / "I've worked with" / "For instance" / "I recently worked"
"ensuring" / "enhancing" / "feel free to" / "don't hesitate" / "reach out"
RULE: Do NOT start the message with "I". Start with the technology, the action, or the result.${learnedRules}`;

    const msg = await callAI(
      isReddit
        ? `You are writing as Kirill — AI automation consultant, real person on Reddit.

${BANNED_LIST}

Rules:
- Start with your own take on the topic (not "I've seen this")
- Real messy numbers: "saved maybe 11-13 hrs/week" not "12 hours"
- Contractions everywhere: don't, it's, we've
- Mix short and longer sentences that trail off naturally
- One casual aside in parentheses
- End casual: "happy to share the setup if useful" or "lmk what stack you're on"
- Max 120 words. Sound like a 35yo who does this every day.
Return JSON: { "message": "plain text only, no markdown" }`
        : `You are Kirill — AI automation consultant, Calgary. Write a SHORT outreach DM (2-3 sentences) to someone who posted this job/request.

${BANNED_LIST}

Rules:
- 2-3 sentences MAX
- Start with WHAT you'll specifically build (the tool, the workflow, the integration)
- Be specific to their exact request — name their tools, their pain
- Sound like a real developer replying, not a sales pitch
Return JSON: { "message": "plain text only, no markdown" }`,
      `Post: ${signal.title}\n${cleanDesc}`,
      MODEL_MINI
    );

    const message = msg?.message || null;

    // Validate output — if banned phrase slipped through, discard (isCleanOutreach is the system gate)
    if (!isCleanOutreach(message)) {
      console.warn(`[ResearchBot] Generated message failed quality check, discarding: "${(message||"").slice(0, 80)}"`);
      return null;
    }

    return message;
  } catch {
    return null;
  }
}

// ── Save hot signals as proper leads in DB ────────────────────────────
// URL patterns that are job board INDEX pages (not individual leads)
const JOB_BOARD_INDEX_PATTERNS = [
  /upwork\.com\/freelance-jobs\//,
  /freelancer\.com\/jobs\//,
  /remoteok\.com\/remote-jobs/,
  /workingnomads\.com\/jobs/,
  /remotive\.com\/remote-jobs/,
  /jobicy\.com\/jobs/,
  /indeed\.com\/jobs/,
  /hire\.n8n\.io\/freelancers/,
];

// Title patterns that indicate the post is from a freelancer SELLING services (not a buyer)
const SELLER_TITLE_PATTERNS = [
  /^\[for hire\]/i,
  /^for hire:/i,
  /^hiring out:/i,
  /^i (will|can) (help|build|create|automate|set up)/i,
];

async function saveSignalsAsLeads(db, signals) {
  const { randomUUID } = await import("crypto");
  const saved = [];
  for (const s of signals) {
    const exists = db.prepare("SELECT id FROM leads WHERE source_url = ?").get(s.url);
    if (exists) continue;

    // Skip job board index pages — these are category listings, not individual leads
    if (JOB_BOARD_INDEX_PATTERNS.some(p => p.test(s.url || ""))) {
      console.log(`[ResearchBot] Skipping job board index page: ${s.url}`);
      continue;
    }

    // Skip posts from freelancers offering services — they are competitors, not buyers
    if (SELLER_TITLE_PATTERNS.some(p => p.test(s.title || ""))) {
      console.log(`[ResearchBot] Skipping seller/competitor post: ${s.title}`);
      continue;
    }

    // Generate real outreach message — not raw snippet
    const outreachMsg = await generateOutreachMessage(s, db);

    const leadId = randomUUID();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO leads (id, name, source, source_platform, source_url, pain_description, score, stage, notes, first_signal_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      leadId,
      s.title.slice(0, 100),
      "research_bot",
      s.platform || "web",
      s.url,
      (s.description || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500),
      65,
      "new",
      outreachMsg || "",
      now, now, now
    );
    saved.push({ ...s, leadId });
  }
  return saved;
}

// ── Send morning intelligence report ─────────────────────────────────
async function sendIntelligenceReport(db, competitorFindings, demandSignals, prospects, marketIntel = null) {
  // CRITICAL: Only show signals from last 30 days
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
  const freshSignals = demandSignals.filter(s => {
    if (!s.foundAt) return false;
    return Date.now() - new Date(s.foundAt).getTime() < THIRTY_DAYS;
  });

  const hasAnything = freshSignals.length > 0 || competitorFindings.length > 0;

  if (!hasAnything) {
    console.log(`[${BOT_NAME}] Nothing fresh to report.`);
    return;
  }

  // Save real signals as leads in DB so buttons work
  let savedLeads = [];
  if (freshSignals.length > 0) {
    savedLeads = await saveSignalsAsLeads(db, freshSignals);
  }

  const recommendation = await generateSummary(competitorFindings, freshSignals, prospects, marketIntel);

  const lines = [
    `🌍 <b>Ночная разведка завершена (глобально)</b>`,
    ``,
  ];

  if (marketIntel) {
    lines.push(`<b>🗺 Горячие рынки прямо сейчас:</b>`);
    lines.push(`<i>${marketIntel.slice(0, 400)}</i>`);
    lines.push(``);
  }

  if (competitorFindings.length > 0) {
    lines.push(`<b>Конкуренты:</b>`);
    competitorFindings.forEach(f => lines.push(f));
    lines.push(``);
  }

  if (freshSignals.length > 0) {
    lines.push(`<b>Свежих сигналов найдено: ${freshSignals.length}</b>`);
    lines.push(``);
  }

  if (recommendation) {
    lines.push(`<b>💡 Что делать сегодня:</b>`);
    lines.push(`<i>${recommendation}</i>`);
  }

  await tgSendToKirill(lines.join("\n"), {
    reply_markup: { inline_keyboard: [[{ text: "🤖 Меню", callback_data: "menu" }]] }
  });

  // Send each saved lead as a proper card with buttons
  for (let i = 0; i < savedLeads.slice(0, 5).length; i++) {
    const lead = db.prepare("SELECT * FROM leads WHERE id = ?").get(savedLeads[i].leadId);
    if (lead) {
      await new Promise(r => setTimeout(r, 600));
      await sendLeadCard(lead, i + 1);
    }
  }

  logActivity(db, BOT_NAME, "report_sent", {
    signals: demandSignals.length,
    prospects: prospects.length,
    competitorChanges: competitorFindings.length
  });
}

// ── Main ──────────────────────────────────────────────────────────────
export async function runResearchBot() {
  const db = getDb();
  heartbeat(db, BOT_NAME, "Research Bot", "running");
  console.log(`[${BOT_NAME}] Starting overnight intelligence sweep (GLOBAL)...`);

  try {
    const [competitorFindings, demandSignals, prospects, emergingProspects, marketIntel] = await Promise.all([
      monitorCompetitors(db),
      findDemandSignals(db),
      researchGlobalProspects(db),
      scanEmergingMarkets(db),
      identifyHotMarkets(db),
    ]);

    // Merge all prospects — emerging market finds included
    const allProspects = [...prospects, ...emergingProspects];

    setIntelligence(db, BOT_NAME, "last_run", "summary", {
      competitorChanges: competitorFindings.length,
      demandSignals: demandSignals.length,
      prospects: allProspects.length,
      emergingMarkets: emergingProspects.length,
      topMarkets: getTopMarketsByHeat(db, 5),
      marketIntel: marketIntel?.slice(0, 200) || null,
      ranAt: new Date().toISOString()
    }, 7);

    // Generate living INTEL document
    await generateIntelDocument(db, demandSignals, prospects, emergingProspects, marketIntel, competitorFindings);

    await sendIntelligenceReport(db, competitorFindings, demandSignals, allProspects, marketIntel);

    console.log(`[${BOT_NAME}] Done. Signals: ${demandSignals.length}, Prospects: ${allProspects.length} (${emergingProspects.length} emerging)`);
    heartbeat(db, BOT_NAME, "Research Bot", `done — ${demandSignals.length} signals, ${allProspects.length} prospects`, {}, {
      status: demandSignals.length > 0 ? "ok" : "degraded",
      last_success_at: new Date().toISOString(),
      error: null
    });
    try { clearError(db, BOT_NAME); } catch {}
  } catch (e) {
    console.error(`[${BOT_NAME}] Fatal error:`, e.message);
    heartbeat(db, BOT_NAME, "Research Bot", `error — ${e.message}`, {}, {
      status: "error",
      last_success_at: null,
      error: e.message
    });
  } finally {
    db.close();
  }
}

// ── LIVE MODE (24/7 процесс) ──────────────────────────────────────────────────
async function liveMode() {
  console.log(`[ResearchBot] Starting in LIVE mode (runs every night at 3 AM)...`);

  while (true) {
    try {
      // Проверить время — запускать только в 3 AM
      const now = new Date();
      const hour = now.getHours();

      if (hour === 3) {
        console.log(`[ResearchBot] Running overnight intelligence sweep...`);
        await runResearchBot();
        // После запуска спать 23 часа чтобы не запускаться дважды в один час
        await new Promise(r => setTimeout(r, 23 * 60 * 60 * 1000));
      } else {
        // Проверять каждый час
        await new Promise(r => setTimeout(r, 60 * 60 * 1000));
      }
    } catch (err) {
      console.error(`[ResearchBot] Error in live mode:`, err.message);
      try { const edb = getDb(); reportError(edb, BOT_NAME, "Research Bot", err.message, "crash", "liveMode"); edb.close(); } catch {}
      await new Promise(r => setTimeout(r, 60 * 60 * 1000)); // retry in 1 hour
    }
  }
}

import { fileURLToPath as _ftu } from "url";
if (process.argv[1] === _ftu(import.meta.url)) {
  const isLive = process.argv.includes("live");
  if (isLive) {
    liveMode().catch(err => {
      console.error(`[ResearchBot] Fatal error:`, err);
      process.exit(1);
    });
  } else {
    runResearchBot().catch(console.error);
  }
}
