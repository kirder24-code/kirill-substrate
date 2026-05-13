/**
 * CORTEX DISCOVERY ENGINE v2 - REAL Market Discovery
 *
 * Dynamically discovers new markets using Brave Search + DB ground truth + AI analysis.
 * No hardcoded categories. Finds where real pain lives, generates testable hypotheses.
 *
 * Modes:
 *   node scripts/cortex/discovery-engine.mjs           — discover new markets
 *   node scripts/cortex/discovery-engine.mjs analyze    — analyze active hypothesis
 *
 * Called by: orchestrator-loop.mjs DISCOVER and ANALYZE branches
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DB_PATH = resolve(ROOT, ".data/linkedin-brand-os.sqlite");
const STATE_PATH = resolve(ROOT, ".data/cortex-discovery-state.json");
const ENV_PATH = resolve(ROOT, "apps/api/.env");

// ── Load env ─────────────────────────────────────────────────────────
const envRaw = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf-8") : "";
const env = Object.fromEntries(
  envRaw.split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const BRAVE_KEY = env.BRAVE_SEARCH_API_KEY || env.BRAVE_API_KEY || "";

// ── Imports from system ──────────────────────────────────────────────
const { callAI, MODEL_STRONG, tgSend, BOTS, CHAT_ID } = await import("../factory/orchestrator.mjs");
const { readPurpose } = await import("../../wiki/reader.mjs");

// ── Brave Search helper ──────────────────────────────────────────────
async function braveSearch(query, count = 10) {
  if (!BRAVE_KEY) {
    console.warn("[discovery] No BRAVE_API_KEY - skipping web search");
    return [];
  }
  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}&freshness=pm`;
    const res = await fetch(url, {
      headers: { Accept: "application/json", "X-Subscription-Token": BRAVE_KEY }
    });
    if (!res.ok) {
      console.error(`[discovery] Brave API ${res.status}: ${res.statusText}`);
      return [];
    }
    const data = await res.json();
    return (data?.web?.results || []).map(r => ({
      title: r.title || "",
      url: r.url || "",
      description: r.description || "",
      age: r.age || "",
    }));
  } catch (e) {
    console.error("[discovery] Brave fetch error:", e.message);
    return [];
  }
}

// ── Step 1: Scan markets dynamically via Brave Search ────────────────
async function scanMarketSignals() {
  console.log("[discovery] Scanning market signals via Brave Search...");

  const searchQueries = [
    // Direct pain signals
    "looking for AI automation consultant",
    "need help with n8n zapier make automation",
    "vibe coded app broken need developer",
    "SaaS founder struggling with automation",
    "small business automation help AI",
    // Platform-specific pain
    "site:reddit.com \"need someone to build\" AI automation",
    "site:reddit.com \"looking for help\" workflow automation n8n",
    "site:news.ycombinator.com hiring AI automation freelancer",
    "site:indiehackers.com \"looking for\" automation developer",
    // Service-specific pain
    "\"broken workflow\" OR \"broken automation\" need fix",
    "\"too many manual tasks\" small business automation",
  ];

  const allResults = [];
  for (const q of searchQueries) {
    const results = await braveSearch(q, 8);
    for (const r of results) {
      allResults.push({ ...r, query: q });
    }
    // Rate limit: 1 req/sec for Brave free tier
    await new Promise(resolve => setTimeout(resolve, 1100));
  }

  console.log(`[discovery] Found ${allResults.length} raw signals from ${searchQueries.length} queries`);
  return allResults;
}

// ── Step 2: Analyze existing lead data from SQLite ───────────────────
function analyzeLeadData() {
  console.log("[discovery] Analyzing lead data from DB...");

  if (!existsSync(DB_PATH)) {
    console.warn("[discovery] No DB file - skipping lead analysis");
    return { categoryStats: [], replyCategories: [], painCategories: [], topSources: [] };
  }

  const db = new Database(DB_PATH, { readonly: true });

  // What source categories have highest warming/ready_buyer rate?
  let categoryStats = [];
  try {
    categoryStats = db.prepare(`
      SELECT
        le.classification,
        COUNT(*) as total,
        SUM(CASE WHEN le.classification IN ('warming', 'ready_buyer') THEN 1 ELSE 0 END) as hot,
        ROUND(100.0 * SUM(CASE WHEN le.classification IN ('warming', 'ready_buyer') THEN 1 ELSE 0 END) / COUNT(*), 1) as hot_rate,
        AVG(le.buyer_score) as avg_buyer_score
      FROM lead_enrichment le
      GROUP BY le.classification
      ORDER BY hot_rate DESC
    `).all();
  } catch (e) { console.error("[discovery] categoryStats query failed:", e.message); }

  // What outreach categories got replies?
  let replyCategories = [];
  try {
    replyCategories = db.prepare(`
      SELECT
        business_category,
        COUNT(*) as sent,
        SUM(CASE WHEN status = 'replied' THEN 1 ELSE 0 END) as replied,
        ROUND(100.0 * SUM(CASE WHEN status = 'replied' THEN 1 ELSE 0 END) / COUNT(*), 1) as reply_rate
      FROM outreach_emails
      WHERE status IN ('sent', 'replied')
      GROUP BY business_category
      HAVING sent >= 3
      ORDER BY reply_rate DESC
    `).all();
  } catch (e) { console.error("[discovery] replyCategories query failed:", e.message); }

  // What pain_categories appear most in warming leads?
  let painCategories = [];
  try {
    painCategories = db.prepare(`
      SELECT
        le.pain_category,
        COUNT(*) as count,
        AVG(le.pain_score) as avg_pain,
        AVG(le.buyer_score) as avg_buyer
      FROM lead_enrichment le
      WHERE le.classification IN ('warming', 'ready_buyer')
        AND le.pain_category IS NOT NULL
        AND le.pain_category != ''
      GROUP BY le.pain_category
      ORDER BY count DESC
      LIMIT 15
    `).all();
  } catch (e) { console.error("[discovery] painCategories query failed:", e.message); }

  // What lead sources produce the most?
  let topSources = [];
  try {
    topSources = db.prepare(`
      SELECT
        l.source_platform,
        l.source,
        COUNT(*) as total,
        SUM(CASE WHEN le.classification IN ('warming', 'ready_buyer') THEN 1 ELSE 0 END) as hot
      FROM leads l
      LEFT JOIN lead_enrichment le ON l.id = le.lead_id
      GROUP BY l.source_platform, l.source
      HAVING total >= 3
      ORDER BY hot DESC
      LIMIT 10
    `).all();
  } catch (e) { console.error("[discovery] topSources query failed:", e.message); }

  db.close();

  console.log(`[discovery] DB analysis: ${replyCategories.length} reply categories, ${painCategories.length} pain categories, ${topSources.length} top sources`);
  return { categoryStats, replyCategories, painCategories, topSources };
}

// ── Step 3: Generate hypotheses using AI ─────────────────────────────
async function generateHypotheses(braveSignals, dbAnalysis) {
  console.log("[discovery] Generating hypotheses with AI...");

  const purpose = readPurpose();

  // Summarize Brave signals for the prompt (avoid token bloat)
  const signalSummary = braveSignals.slice(0, 40).map(s =>
    `- [${s.query}] "${s.title}" - ${s.description?.slice(0, 120)}`
  ).join("\n");

  const dbSummary = [
    "## Reply rates by outreach category:",
    ...dbAnalysis.replyCategories.slice(0, 10).map(r =>
      `- ${r.business_category}: ${r.sent} sent, ${r.replied} replied (${r.reply_rate}%)`
    ),
    "",
    "## Top pain categories in warming/ready leads:",
    ...dbAnalysis.painCategories.slice(0, 10).map(p =>
      `- ${p.pain_category}: ${p.count} leads, avg pain=${p.avg_pain?.toFixed?.(1) || "?"}, avg buyer=${p.avg_buyer?.toFixed?.(1) || "?"}`
    ),
    "",
    "## Top lead sources:",
    ...dbAnalysis.topSources.slice(0, 8).map(s =>
      `- ${s.source_platform}/${s.source}: ${s.total} total, ${s.hot} hot`
    ),
  ].join("\n");

  const systemPrompt = `You are a market discovery analyst for an AI automation consultancy.

CURRENT PURPOSE & OFFERS:
${purpose?.slice(0, 1500) || "AI workflow automation consulting, $1.5K-10K CAD per project"}

Your job: analyze market signals and conversion data to find the top 3 UNTESTED market opportunities.

Rules:
- Each opportunity must be specific (not "small businesses" - say "solo SaaS founders who vibe-coded an MVP and need production hardening")
- Each must have a clear pain signal from the search data or DB data
- Prefer markets where we see REAL replies or warming leads, not theoretical demand
- Avoid markets we already dominate or have tested extensively (check the reply data)
- Each hypothesis must be testable in 5-7 days with specific actions
- Think about WHERE these people hang out (subreddit, HN thread type, LinkedIn group, forum)

Return JSON.`;

  const userPrompt = `## BRAVE SEARCH SIGNALS (recent web results for pain queries):
${signalSummary || "(no search results - Brave API unavailable)"}

## DATABASE GROUND TRUTH:
${dbSummary}

Based on the above signals and conversion data, what are the top 3 UNTESTED market opportunities?

Return JSON array of exactly 3 objects:
[
  {
    "market": "specific market description",
    "pain": "the specific pain they have that we solve",
    "channel": "where to find them (specific subreddit, forum, platform)",
    "test_action": "concrete action to test this in 5 days",
    "success_metric": "what result proves this works",
    "duration_days": 5,
    "confidence": "low|medium|high",
    "reasoning": "why this looks promising based on the data"
  }
]`;

  try {
    const result = await callAI(systemPrompt, userPrompt, MODEL_STRONG, true);
    // Result could be the array directly or wrapped in an object
    const hypotheses = Array.isArray(result) ? result : (result?.hypotheses || result?.opportunities || []);
    if (!Array.isArray(hypotheses) || hypotheses.length === 0) {
      console.error("[discovery] AI returned no hypotheses");
      return [];
    }
    return hypotheses.slice(0, 3).map(h => ({
      market: h.market || "unknown",
      pain: h.pain || "",
      channel: h.channel || "",
      test_action: h.test_action || "",
      success_metric: h.success_metric || "",
      duration_days: h.duration_days || 5,
      confidence: h.confidence || "low",
      reasoning: h.reasoning || "",
      status: "pending",
      startedAt: null,
      analyzedAt: null,
      verdict: null,
      results: null,
    }));
  } catch (e) {
    console.error("[discovery] AI hypothesis generation failed:", e.message);
    return [];
  }
}

// ── State management ─────────────────────────────────────────────────
function loadState() {
  if (!existsSync(STATE_PATH)) {
    return {
      updatedAt: null,
      activeHypothesis: null,
      queuedHypotheses: [],
      completedHypotheses: [],
      lastBraveSignals: [],
      lastDbAnalysis: {},
    };
  }
  try {
    return JSON.parse(readFileSync(STATE_PATH, "utf-8"));
  } catch {
    return { updatedAt: null, activeHypothesis: null, queuedHypotheses: [], completedHypotheses: [], lastBraveSignals: [], lastDbAnalysis: {} };
  }
}

function saveState(state) {
  state.updatedAt = new Date().toISOString();
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

// ── Send Telegram report ─────────────────────────────────────────────
async function sendReport(text) {
  try {
    const token = BOTS.content.token;
    if (!token || !CHAT_ID) {
      console.warn("[discovery] No Telegram credentials - skipping notification");
      return;
    }
    // Respect 4096 char limit
    const trimmed = text.length > 4000 ? text.slice(0, 3997) + "..." : text;
    await tgSend(token, CHAT_ID, trimmed);
  } catch (e) {
    console.error("[discovery] Telegram send failed:", e.message);
  }
}

// ── DISCOVER MODE ────────────────────────────────────────────────────
async function runDiscover() {
  console.log("[discovery-engine] Starting REAL market discovery...\n");

  const state = loadState();

  // If there's already an active hypothesis being tested, don't overwrite it
  if (state.activeHypothesis && state.activeHypothesis.status === "active") {
    const startedAt = new Date(state.activeHypothesis.startedAt);
    const daysSinceStart = (Date.now() - startedAt.getTime()) / (1000 * 60 * 60 * 24);
    console.log(`[discovery] Active hypothesis exists: "${state.activeHypothesis.market}" (${daysSinceStart.toFixed(1)} days)`);
    if (daysSinceStart < state.activeHypothesis.duration_days) {
      console.log("[discovery] Still within test period - not generating new hypotheses");
      console.log("[discovery] Run with 'analyze' arg when test period is over");
      return state;
    }
    console.log("[discovery] Test period expired - will analyze and rotate");
  }

  // Step 1: Scan Brave for market signals
  const braveSignals = await scanMarketSignals();

  // Step 2: Analyze DB ground truth
  const dbAnalysis = analyzeLeadData();

  // Step 3: Generate hypotheses via AI
  const hypotheses = await generateHypotheses(braveSignals, dbAnalysis);

  if (hypotheses.length === 0) {
    console.error("[discovery] No hypotheses generated - check API keys and DB");
    return state;
  }

  // Activate first hypothesis, queue the rest
  const activeHypothesis = {
    ...hypotheses[0],
    status: "active",
    startedAt: new Date().toISOString(),
  };

  const queuedHypotheses = hypotheses.slice(1).map(h => ({
    ...h,
    status: "queued",
  }));

  // Preserve completed history
  const completedHypotheses = state.completedHypotheses || [];

  // If old active was expired, move it to completed as "expired"
  if (state.activeHypothesis && state.activeHypothesis.status === "active") {
    state.activeHypothesis.status = "expired";
    state.activeHypothesis.analyzedAt = new Date().toISOString();
    state.activeHypothesis.verdict = "expired_no_analysis";
    completedHypotheses.push(state.activeHypothesis);
  }

  const newState = {
    updatedAt: new Date().toISOString(),
    activeHypothesis,
    queuedHypotheses,
    completedHypotheses,
    lastBraveSignals: braveSignals.slice(0, 20).map(s => ({ title: s.title, url: s.url, query: s.query })),
    lastDbAnalysis: {
      replyCategories: dbAnalysis.replyCategories?.slice(0, 5) || [],
      painCategories: dbAnalysis.painCategories?.slice(0, 5) || [],
      topSources: dbAnalysis.topSources?.slice(0, 5) || [],
    },
  };

  saveState(newState);

  // Console output
  console.log("\n[discovery-engine] Hypotheses generated:");
  console.log(`  ACTIVE: ${activeHypothesis.market}`);
  console.log(`    Pain: ${activeHypothesis.pain}`);
  console.log(`    Channel: ${activeHypothesis.channel}`);
  console.log(`    Test: ${activeHypothesis.test_action}`);
  console.log(`    Metric: ${activeHypothesis.success_metric}`);
  for (const q of queuedHypotheses) {
    console.log(`  QUEUED: ${q.market}`);
  }

  // Telegram report
  const tgMsg = [
    "<b>DISCOVERY ENGINE - New Hypotheses</b>",
    "",
    `<b>TESTING NOW:</b> ${activeHypothesis.market}`,
    `Pain: ${activeHypothesis.pain}`,
    `Channel: ${activeHypothesis.channel}`,
    `Action: ${activeHypothesis.test_action}`,
    `Success = ${activeHypothesis.success_metric}`,
    `Duration: ${activeHypothesis.duration_days} days`,
    "",
    ...queuedHypotheses.map((q, i) => `<b>NEXT ${i + 1}:</b> ${q.market} (${q.channel})`),
    "",
    `Brave signals: ${braveSignals.length} | DB categories with replies: ${dbAnalysis.replyCategories?.length || 0}`,
  ].join("\n");

  await sendReport(tgMsg);

  console.log("\n[discovery-engine] Done. State saved.");
  return newState;
}

// ── ANALYZE MODE ─────────────────────────────────────────────────────
async function runAnalyze() {
  console.log("[discovery-engine] Analyzing active hypothesis...\n");

  const state = loadState();
  const active = state.activeHypothesis;

  if (!active || active.status !== "active") {
    console.log("[discovery] No active hypothesis to analyze. Run discover first.");
    return null;
  }

  const startedAt = new Date(active.startedAt);
  const daysSinceStart = (Date.now() - startedAt.getTime()) / (1000 * 60 * 60 * 24);
  console.log(`[discovery] Hypothesis: "${active.market}" - ${daysSinceStart.toFixed(1)} days since start`);

  // Gather evidence - first check hypothesis-specific test results from hypothesis-executor
  const RESULTS_PATH = resolve(ROOT, ".data/hypothesis-test-results.json");
  const hypothesisId = (active.market || "").slice(0, 80).replace(/[^a-zA-Z0-9 ]/g, "").replace(/\s+/g, "-").toLowerCase();

  let evidence = { emailsSent: 0, emailsReplied: 0, leadsFound: 0, warmingLeads: 0, replyRate: 0, hypothesisTests: null };

  // Read hypothesis-specific test results (from hypothesis-executor.mjs)
  if (existsSync(RESULTS_PATH)) {
    try {
      const allResults = JSON.parse(readFileSync(RESULTS_PATH, "utf-8"));
      const hypResults = allResults[hypothesisId];
      if (hypResults) {
        evidence.hypothesisTests = hypResults;
        console.log(`[discovery] Hypothesis test data: ${hypResults.actions_taken} actions, ${hypResults.comments_posted} posted, ${hypResults.replies_received} replies`);
      } else {
        console.log("[discovery] No hypothesis-executor test data found for this hypothesis");
      }
    } catch (e) { console.error("[discovery] Failed to read hypothesis results:", e.message); }
  }

  // Also check hypothesis_tests table directly for latest status
  if (existsSync(DB_PATH)) {
    const db = new Database(DB_PATH, { readonly: true });

    // Hypothesis-specific: query hypothesis_tests table
    try {
      const row = db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as posted,
          SUM(CASE WHEN status = 'replied' THEN 1 ELSE 0 END) as replied
        FROM hypothesis_tests
        WHERE hypothesis_id = ?
      `).get(hypothesisId);
      if (row && row.total > 0) {
        evidence.hypothesisCommentsDrafted = row.total;
        evidence.hypothesisCommentsPosted = row.posted || 0;
        evidence.hypothesisReplies = row.replied || 0;
      }
    } catch (e) { /* hypothesis_tests table may not exist yet */ }

    // Also check general outreach emails sent since hypothesis started (broader signal)
    try {
      const row = db.prepare(`
        SELECT
          COUNT(*) as sent,
          SUM(CASE WHEN status = 'replied' THEN 1 ELSE 0 END) as replied
        FROM outreach_emails
        WHERE sent_at >= ?
      `).get(active.startedAt);
      evidence.emailsSent = row?.sent || 0;
      evidence.emailsReplied = row?.replied || 0;
      evidence.replyRate = evidence.emailsSent > 0
        ? (100 * evidence.emailsReplied / evidence.emailsSent).toFixed(1) + "%"
        : "0%";
    } catch (e) { console.error("[discovery] email query failed:", e.message); }

    // Check leads found since hypothesis started
    try {
      const row = db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN le.classification IN ('warming', 'ready_buyer') THEN 1 ELSE 0 END) as hot
        FROM leads l
        LEFT JOIN lead_enrichment le ON l.id = le.lead_id
        WHERE l.created_at >= ?
      `).get(active.startedAt);
      evidence.leadsFound = row?.total || 0;
      evidence.warmingLeads = row?.hot || 0;
    } catch (e) { console.error("[discovery] leads query failed:", e.message); }

    db.close();
  }

  // Use AI to produce verdict
  const purpose = readPurpose();
  let verdict = "EXTEND";
  let analysis = "";

  try {
    const result = await callAI(
      `You analyze market test results for an AI automation consultancy.
PURPOSE: ${purpose?.slice(0, 500) || "AI workflow automation consulting"}

You must return a JSON verdict.`,
      `HYPOTHESIS BEING TESTED:
Market: ${active.market}
Pain: ${active.pain}
Channel: ${active.channel}
Test action: ${active.test_action}
Success metric: ${active.success_metric}
Duration target: ${active.duration_days} days
Actual days elapsed: ${daysSinceStart.toFixed(1)}

HYPOTHESIS-SPECIFIC TEST DATA (from hypothesis-executor):
- Comments drafted: ${evidence.hypothesisCommentsDrafted || 0}
- Comments posted by Kirill: ${evidence.hypothesisCommentsPosted || 0}
- Replies received on comments: ${evidence.hypothesisReplies || 0}
- Channels tested: ${evidence.hypothesisTests?.channels_tested?.join(", ") || "none yet"}

BROADER EVIDENCE (all activity since test start):
- Emails sent since test start: ${evidence.emailsSent}
- Email replies received: ${evidence.emailsReplied} (${evidence.replyRate})
- New leads found: ${evidence.leadsFound}
- Warming/ready leads: ${evidence.warmingLeads}

Based on this evidence, produce a verdict:
- PROMOTE: clear signal this market works, invest more
- KILL: no signal after sufficient testing, move on
- EXTEND: not enough data yet, need more time (only if < 7 days and some positive signal)

Return JSON:
{
  "verdict": "PROMOTE|KILL|EXTEND",
  "confidence": "low|medium|high",
  "analysis": "2-3 sentence analysis of what the data shows",
  "recommendation": "specific next action"
}`,
      MODEL_STRONG,
      true
    );

    verdict = result?.verdict || "EXTEND";
    analysis = result?.analysis || "";
    evidence.aiRecommendation = result?.recommendation || "";
    evidence.aiConfidence = result?.confidence || "low";
  } catch (e) {
    console.error("[discovery] AI analysis failed:", e.message);
    // Fallback: simple rules (use hypothesis-specific data first, then broader evidence)
    const totalReplies = (evidence.hypothesisReplies || 0) + (evidence.emailsReplied || 0);
    const totalPosted = (evidence.hypothesisCommentsPosted || 0) + (evidence.emailsSent || 0);
    if (daysSinceStart >= 7 && totalReplies === 0 && evidence.warmingLeads === 0) {
      verdict = "KILL";
      analysis = `7+ days with zero replies (${totalPosted} actions taken) and zero warming leads. No signal.`;
    } else if (totalReplies >= 2 || evidence.warmingLeads >= 3) {
      verdict = "PROMOTE";
      analysis = `${totalReplies} replies from ${totalPosted} actions and ${evidence.warmingLeads} warming leads - positive signal.`;
    } else {
      verdict = "EXTEND";
      analysis = `${daysSinceStart.toFixed(1)} days elapsed, ${totalPosted} actions taken, insufficient data to decide.`;
    }
  }

  console.log(`[discovery] Verdict: ${verdict}`);
  console.log(`[discovery] Analysis: ${analysis}`);

  // Update state
  active.status = "done";
  active.analyzedAt = new Date().toISOString();
  active.verdict = verdict;
  active.results = evidence;

  state.completedHypotheses = [...(state.completedHypotheses || []), active];

  // Handle verdict
  if (verdict === "EXTEND") {
    // Keep as active, extend duration
    active.status = "active";
    active.duration_days = (active.duration_days || 5) + 3;
    state.activeHypothesis = active;
    // Remove from completed since we're extending
    state.completedHypotheses = state.completedHypotheses.filter(h => h !== active);
  } else {
    // PROMOTE or KILL - rotate to next hypothesis
    const next = state.queuedHypotheses?.[0] || null;
    if (next) {
      next.status = "active";
      next.startedAt = new Date().toISOString();
      state.activeHypothesis = next;
      state.queuedHypotheses = state.queuedHypotheses.slice(1);
    } else {
      state.activeHypothesis = null;
      state.queuedHypotheses = [];
    }
  }

  saveState(state);

  // Telegram report
  const tgMsg = [
    `<b>DISCOVERY VERDICT: ${verdict}</b>`,
    "",
    `Market: ${active.market}`,
    `Tested for: ${daysSinceStart.toFixed(1)} days`,
    `Comments: ${evidence.hypothesisCommentsDrafted || 0} drafted, ${evidence.hypothesisCommentsPosted || 0} posted, ${evidence.hypothesisReplies || 0} replies`,
    `Emails: ${evidence.emailsSent} sent, ${evidence.emailsReplied} replied (${evidence.replyRate})`,
    `Leads: ${evidence.leadsFound} found, ${evidence.warmingLeads} warming`,
    "",
    `Analysis: ${analysis}`,
    evidence.aiRecommendation ? `Next: ${evidence.aiRecommendation}` : "",
    "",
    state.activeHypothesis
      ? `Next test: ${state.activeHypothesis.market}`
      : "No more queued hypotheses - run discover to generate new ones",
  ].filter(Boolean).join("\n");

  await sendReport(tgMsg);

  return { active, verdict, analysis, next: state.activeHypothesis };
}

// ── ENTRYPOINT ────────────────────────────────────────────────────────
const isMain = process.argv[1] && fileURLToPath(import.meta.url).endsWith(process.argv[1].replace(/^.*\//, ""));
if (isMain || process.argv[1]?.includes("discovery-engine")) {
  const mode = process.argv[2] || "discover";
  if (mode === "analyze") {
    runAnalyze().catch(e => { console.error("[discovery-engine] FATAL:", e); process.exit(1); });
  } else {
    runDiscover().catch(e => { console.error("[discovery-engine] FATAL:", e); process.exit(1); });
  }
}

export { runDiscover as runDiscovery, runAnalyze as analyzeActiveHypothesis };
