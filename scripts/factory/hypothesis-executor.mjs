/**
 * hypothesis-executor.mjs — Bridge between discovery-engine hypotheses and real execution
 *
 * The missing link: discovery-engine generates hypotheses, this bot ACTS on them.
 * Reads the active hypothesis, finds matching posts via Brave Search + Reddit,
 * drafts expert comments via callAI, sends to Telegram for Kirill's approval,
 * and tracks everything in hypothesis_tests table for discovery-engine's analyze mode.
 *
 * Usage:
 *   node scripts/factory/hypothesis-executor.mjs
 *
 * Built April 27 2026
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DB_PATH = resolve(ROOT, ".data/linkedin-brand-os.sqlite");
const STATE_PATH = resolve(ROOT, ".data/cortex-discovery-state.json");
const RESULTS_PATH = resolve(ROOT, ".data/hypothesis-test-results.json");

// ── Imports from system ──────────────────────────────────────────────
const { callAI, MODEL_STRONG, MODEL_MINI, tgSend, BOTS, CHAT_ID, heartbeat, reportError, isCleanOutreach } = await import("./orchestrator.mjs");
const { recordFirstContact } = await import("./conversation-tracker.mjs");
const { shouldAct } = await import("./simulate-before-act.mjs");
const { readPurpose, readWiki } = await import("../../wiki/reader.mjs");

// Read channel capabilities so we know what we can actually do
const channelCapabilities = readWiki("channels/capabilities.md");

// Read filter teaching so the bot learns from past outcomes (created 2026-05-08 after 6/7 noise batch)
const learnedFiltering = readWiki("learned-hypothesis-filtering.md");

const BOT_ID = "hypothesis-executor";
const BOT_NAME = "HypothesisExecutor";

// ── Load env ─────────────────────────────────────────────────────────
const ENV_PATH = resolve(ROOT, "apps/api/.env");
const envRaw = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, "utf-8") : "";
const env = Object.fromEntries(
  envRaw.split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const BRAVE_KEY = env.BRAVE_SEARCH_API_KEY || env.BRAVE_API_KEY || "";

// ── DB setup ─────────────────────────────────────────────────────────
const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS hypothesis_tests (
    id TEXT PRIMARY KEY,
    hypothesis_id TEXT NOT NULL,
    hypothesis_market TEXT,
    channel TEXT,
    action_type TEXT CHECK(action_type IN ('comment', 'dm', 'email')) DEFAULT 'comment',
    subreddit TEXT,
    post_url TEXT,
    post_title TEXT,
    draft_text TEXT,
    status TEXT CHECK(status IN ('drafted', 'sent', 'skipped', 'replied')) DEFAULT 'drafted',
    created_at TEXT NOT NULL,
    sent_at TEXT,
    reply_at TEXT
  )
`);

// ── Brave Search helper ──────────────────────────────────────────────
async function braveSearch(query, count = 10) {
  if (!BRAVE_KEY) {
    console.warn("[hyp-exec] No BRAVE_API_KEY - skipping web search");
    return [];
  }
  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}&freshness=pw`;
    const res = await fetch(url, {
      headers: { Accept: "application/json", "X-Subscription-Token": BRAVE_KEY },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.error(`[hyp-exec] Brave API ${res.status}: ${res.statusText}`);
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
    console.error("[hyp-exec] Brave fetch error:", e.message);
    return [];
  }
}

// ── Reddit fetch helper ──────────────────────────────────────────────
const UA = "Mozilla/5.0 (Macintosh) AppleWebKit/537.36";

async function fetchSubredditPosts(sub, limit = 15) {
  try {
    const r = await fetch(`https://www.reddit.com/r/${sub}/new.json?limit=${limit}`, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) {
      console.log(`[hyp-exec] Reddit r/${sub} HTTP ${r.status}`);
      return [];
    }
    const data = await r.json();
    return (data?.data?.children || []).map(c => c.data).filter(p => p && p.selftext);
  } catch (e) {
    console.log(`[hyp-exec] Reddit r/${sub} error: ${e.message}`);
    return [];
  }
}

// ── Parse hypothesis ─────────────────────────────────────────────────
function parseHypothesis(hyp) {
  const channel = hyp.channel || "";
  const testAction = hyp.test_action || "";

  // Extract subreddits from channel and test_action fields
  const subPattern = /r\/(\w+)/g;
  const subs = new Set();
  let m;
  while ((m = subPattern.exec(channel)) !== null) subs.add(m[1]);
  // Reset lastIndex and scan test_action too
  subPattern.lastIndex = 0;
  while ((m = subPattern.exec(testAction)) !== null) subs.add(m[1]);

  // Determine action type from test_action
  let actionType = "comment"; // default: comment first, not DM
  if (/\b(cold emails?|send emails?|email outreach)\b/i.test(testAction)) actionType = "email";
  if (/\b(DM|direct message)\b/i.test(testAction)) actionType = "dm";
  // If it says "comment" anywhere, prefer that
  if (/\bcomment/i.test(testAction)) actionType = "comment";

  // Extract pain keywords for search
  const pain = hyp.pain || "";
  const market = hyp.market || "";

  return {
    subreddits: [...subs],
    actionType,
    pain,
    market,
    channel,
    testAction,
  };
}

// ── Build search queries from hypothesis ─────────────────────────────
function buildSearchQueries(parsed) {
  const queries = [];
  const painWords = parsed.pain.split(/[,.;]+/).map(s => s.trim()).filter(s => s.length > 10).slice(0, 3);

  for (const sub of parsed.subreddits) {
    queries.push(`site:reddit.com/r/${sub} ${painWords[0] || parsed.market.split(" ").slice(0, 4).join(" ")}`);
  }
  // General pain query
  if (painWords.length > 0) {
    queries.push(`site:reddit.com "${painWords[0]}"`);
  }
  // Market-specific
  queries.push(`site:reddit.com ${parsed.market.split(" ").slice(0, 6).join(" ")}`);

  return queries.slice(0, 5); // max 5 queries to stay within rate limits
}

// ── Pull existing warming/ready_buyer leads from DB (Strategy 0) ──────
// Added 2026-05-08: hypothesis-executor was always going to Brave for cold
// candidates while warming leads sat unused in DB. Use these first - they
// are pre-qualified by scout-bot scoring + lead-enrichment-bot classification.
function loadDbWarmingLeads(seenUrls, existingUrls) {
  const out = [];
  try {
    // Use lead_enrichment.classification as source of truth (leads.stage often stale after enrichment).
    // Also include high buyer_score leads even if classification is missing.
    const rows = db.prepare(`
      SELECT l.id, l.name, l.source_url, l.pain_description, l.score, l.created_at, l.stage,
             e.classification, e.next_message_angle, e.pain_category, e.buyer_score
      FROM leads l
      LEFT JOIN lead_enrichment e ON e.lead_id = l.id
      WHERE l.source_platform = 'reddit'
        AND l.source_url IS NOT NULL
        AND l.source_url LIKE '%reddit.com%'
        AND (
          e.classification IN ('warming', 'ready_buyer')
          OR (e.buyer_score IS NOT NULL AND e.buyer_score >= 2.5)
        )
        AND COALESCE(e.classification, '') != 'not_fit'
      ORDER BY COALESCE(e.buyer_score, 0) DESC, l.score DESC
      LIMIT 30
    `).all();
    for (const r of rows) {
      if (seenUrls.has(r.source_url) || existingUrls.has(r.source_url)) continue;
      const subMatch = r.source_url.match(/reddit\.com\/r\/(\w+)/);
      // pain_description format from scout-bot: "Post title - body text"
      const sep = (r.pain_description || "").indexOf(" - ");
      const title = sep > 0 ? r.pain_description.slice(0, sep).trim() : (r.pain_description || "").slice(0, 120);
      const body = sep > 0 ? r.pain_description.slice(sep + 3).trim() : "";
      const ageDays = r.created_at
        ? Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86400000)
        : null;
      out.push({
        title: title || `Post by ${r.name || "user"}`,
        url: r.source_url,
        body,
        sub: subMatch ? subMatch[1] : "unknown",
        author: r.name || "",
        ageDays,
        score: r.score || null,
        numComments: null,
        source: "db_warming_lead",
        // Pre-qualified context for the drafting prompt
        leadId: r.id,
        classification: r.classification || null,
        recommendedAngle: r.next_message_angle || null,
        painCategory: r.pain_category || null,
        buyerScore: r.buyer_score || null,
      });
      seenUrls.add(r.source_url);
    }
  } catch (e) {
    console.warn(`[hyp-exec] DB warming-leads pull failed: ${e.message}`);
  }
  return out;
}

// ── Find posts matching hypothesis ───────────────────────────────────
async function findMatchingPosts(parsed) {
  console.log(`[hyp-exec] Finding posts for: ${parsed.market.slice(0, 80)}`);
  console.log(`[hyp-exec] Subreddits: ${parsed.subreddits.join(", ") || "(none - using Brave only)"}`);
  console.log(`[hyp-exec] Action type: ${parsed.actionType}`);

  const posts = [];
  const seenUrls = new Set();

  // Already-tracked URLs - don't re-draft
  const existingUrls = new Set();
  try {
    const rows = db.prepare(`SELECT post_url FROM hypothesis_tests WHERE post_url IS NOT NULL`).all();
    for (const r of rows) existingUrls.add(r.post_url);
  } catch {}

  // Strategy 0: pre-qualified warming/ready_buyer leads from DB (highest priority)
  const dbLeads = loadDbWarmingLeads(seenUrls, existingUrls);
  if (dbLeads.length > 0) {
    console.log(`[hyp-exec] Pulled ${dbLeads.length} pre-qualified DB warming leads (priority pool)`);
    posts.push(...dbLeads);
  } else {
    console.log(`[hyp-exec] No DB warming leads found - falling back to subreddit fetch + Brave`);
  }

  // Strategy 1: Direct Reddit fetch for each subreddit
  for (const sub of parsed.subreddits) {
    console.log(`[hyp-exec] Fetching r/${sub}...`);
    const redditPosts = await fetchSubredditPosts(sub, 15);

    for (const p of redditPosts) {
      const url = `https://www.reddit.com${p.permalink}`;
      if (seenUrls.has(url) || existingUrls.has(url)) continue;

      // Age check: skip posts older than 7 days
      const ageSeconds = Date.now() / 1000 - (p.created_utc || 0);
      const ageDays = ageSeconds / 86400;
      if (ageDays > 7) continue;

      posts.push({
        title: p.title || "",
        url,
        body: (p.selftext || "").slice(0, 1000),
        sub,
        author: p.author || "",
        ageDays: Math.round(ageDays * 10) / 10,
        score: p.score || 0,
        numComments: p.num_comments || 0,
        source: "reddit_direct",
      });
      seenUrls.add(url);
    }
    // Rate limit between Reddit requests
    await new Promise(r => setTimeout(r, 2000));
  }

  // Strategy 2: Brave Search for broader discovery
  const queries = buildSearchQueries(parsed);
  for (const q of queries) {
    console.log(`[hyp-exec] Brave: "${q.slice(0, 60)}..."`);
    const results = await braveSearch(q, 8);
    for (const r of results) {
      if (seenUrls.has(r.url) || existingUrls.has(r.url)) continue;
      // Only keep Reddit results
      if (!r.url.includes("reddit.com")) continue;
      // Extract subreddit from URL
      const subMatch = r.url.match(/reddit\.com\/r\/(\w+)/);
      posts.push({
        title: r.title || "",
        url: r.url,
        body: r.description || "",
        sub: subMatch ? subMatch[1] : "unknown",
        author: "",
        ageDays: null,
        score: null,
        numComments: null,
        source: "brave_search",
      });
      seenUrls.add(r.url);
    }
    // Rate limit Brave: 1 req/sec
    await new Promise(r => setTimeout(r, 1100));
  }

  console.log(`[hyp-exec] Found ${posts.length} candidate posts total`);
  return posts;
}

// ── Score and filter posts using AI ──────────────────────────────────
async function scoreAndFilterPosts(posts, parsed, targetCount = 7) {
  if (posts.length === 0) return [];
  if (posts.length <= targetCount) return posts;

  // Use AI to pick the best posts for this hypothesis
  const postSummaries = posts.slice(0, 25).map((p, i) =>
    `${i + 1}. [r/${p.sub}] "${p.title}" - ${p.body.slice(0, 150)}... (${p.ageDays != null ? p.ageDays + "d old" : "age unknown"})`
  ).join("\n");

  try {
    const result = await callAI(
      `You are a market analyst selecting Reddit posts for expert comment outreach. Pick the BEST posts where an AI automation consultant can add genuine value.

LEARNED FILTERING RULES (apply strictly, last updated 2026-05-08):
${learnedFiltering ? learnedFiltering.slice(0, 4000) : "Pick posts where the author has a real problem (not theoretical question)."}

Better to return FEWER high-fit posts than to fill a quota with noise. If only 2 posts pass the filter, return 2.

Return JSON.`,
      `HYPOTHESIS TARGET:
Market: ${parsed.market}
Pain: ${parsed.pain}
Target count (max): ${targetCount}

CANDIDATE POSTS:
${postSummaries}

Apply the LEARNED FILTERING RULES. Drop any post matching anti-patterns (vendor announcement, discovery question, tech support ticket, student/pet project, philosophical debate). Require BOTH a pain marker AND a context marker.

Return: { "selected": [1, 3, 5, ...], "reasoning": "brief explanation per pick", "rejected": [{"index": 2, "reason": "why dropped"}] }`,
      MODEL_MINI,
      true
    );

    const selected = result?.selected || [];
    if (!Array.isArray(selected) || selected.length === 0) return posts.slice(0, targetCount);

    return selected
      .filter(i => typeof i === "number" && i >= 1 && i <= posts.length)
      .map(i => posts[i - 1])
      .slice(0, targetCount);
  } catch (e) {
    console.error("[hyp-exec] AI scoring failed:", e.message);
    return posts.slice(0, targetCount);
  }
}

// ── Draft expert comment for a post ──────────────────────────────────
async function draftComment(post, parsed) {
  const purpose = readPurpose();

  try {
    const result = await callAI(
      `You are Kirill, an AI automation consultant (launchsoloai.com). You are writing a Reddit comment that demonstrates expertise and offers genuine help.

RULES:
- Write as a human practitioner sharing experience, NOT as a salesperson
- Address the SPECIFIC problem in the post - show you understand their exact situation
- Give 1-2 concrete, actionable suggestions they can use immediately
- End with a soft CTA: offer a free audit, ask a clarifying question, or suggest a next step
- Keep it under 200 words
- NO em dashes (use hyphens only)
- NO phrases like "I can help you", "let me know if", "feel free to", "I'd love to"
- NO generic advice - be specific to their situation
- Sound like a practitioner who has solved this exact problem before
- Use plain conversational tone, not marketing speak

CURRENT OFFERS: ${purpose?.slice(0, 400) || "AI workflow automation consulting, $1.5K-10K CAD"}

LEARNED FILTERING (use this to RATE relevance, last updated 2026-05-08):
${learnedFiltering ? learnedFiltering.slice(0, 2500) : ""}

When self-rating relevance:
- "high" = both pain marker AND context marker, no anti-pattern triggers, draft is specific
- "medium" = pain marker present but context weak (eligible for human review)
- "low" = anti-pattern detected OR generic content. The system will auto-skip "low" without sending to Kirill, so use this honestly.

Return JSON.`,
      `POST from r/${post.sub}:
Title: "${post.title}"
Body: ${post.body.slice(0, 800)}

HYPOTHESIS CONTEXT:
Target market: ${parsed.market}
Pain we solve: ${parsed.pain}

Draft an expert comment for this post. Return:
{ "comment": "the full comment text", "relevance": "high|medium|low", "angle": "1-sentence description of the approach taken" }`,
      MODEL_STRONG,
      true
    );

    const comment = result?.comment || "";
    const relevance = result?.relevance || "medium";
    const angle = result?.angle || "";

    if (!comment || comment.length < 30) {
      console.warn(`[hyp-exec] Empty/short comment for: ${post.title.slice(0, 50)}`);
      return null;
    }

    // Quality gate: outreach style
    if (!isCleanOutreach(comment)) {
      console.warn(`[hyp-exec] Comment failed quality gate for: ${post.title.slice(0, 50)}`);
      return null;
    }

    // Learned-filtering gate: bot self-rated as low = auto-skip, do not send to Telegram
    // (added 2026-05-08 after 6/7 noise batch — see wiki/learned-hypothesis-filtering.md)
    if (relevance === "low") {
      console.warn(`[hyp-exec] AUTO-SKIP relevance=low: "${post.title.slice(0, 60)}" — angle: ${angle}`);
      return { auto_skipped: true, reason: "relevance_low", post, angle };
    }

    return { comment, relevance, angle };
  } catch (e) {
    console.error(`[hyp-exec] Draft failed for "${post.title.slice(0, 40)}": ${e.message}`);
    return null;
  }
}

// ── Send draft to Telegram with buttons ──────────────────────────────
async function sendDraftToTelegram(post, draft, hypothesisId, testId, index, total) {
  const token = BOTS.content.token;
  if (!token || !CHAT_ID) {
    console.warn("[hyp-exec] No Telegram credentials");
    return;
  }

  const ageStr = post.ageDays != null ? ` (${post.ageDays}d old)` : "";
  const msg = [
    `<b>${index}/${total} HYPOTHESIS TEST - Comment</b>`,
    `<i>Testing: ${hypothesisId.slice(0, 60)}</i>`,
    ``,
    `<b>r/${post.sub}${ageStr}</b>`,
    `${post.title.slice(0, 120)}`,
    `${post.url}`,
    ``,
    `<b>Angle:</b> ${draft.angle || "direct"}`,
    `<b>Relevance:</b> ${draft.relevance}`,
    ``,
    `<b>Comment:</b>`,
    `<pre>${draft.comment.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`,
  ].join("\n");

  // Trim to 4096
  const trimmed = msg.length > 4000 ? msg.slice(0, 3997) + "..." : msg;

  const reply_markup = {
    inline_keyboard: [[
      { text: "Posted", callback_data: `hyp_posted:${testId}` },
      { text: "Skip", callback_data: `hyp_skip:${testId}` },
    ]],
  };

  try {
    await tgSend(token, CHAT_ID, trimmed, { reply_markup });
  } catch (e) {
    console.error(`[hyp-exec] Telegram send failed: ${e.message}`);
  }
}

// ── Save test to DB ──────────────────────────────────────────────────
function saveTest(hypothesisId, market, post, draft, actionType) {
  const id = `hyp-${randomUUID().slice(0, 12)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO hypothesis_tests (id, hypothesis_id, hypothesis_market, channel, action_type, subreddit, post_url, post_title, draft_text, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'drafted', ?)
  `).run(
    id, hypothesisId, market.slice(0, 500),
    `reddit_r_${post.sub}`, actionType,
    post.sub, post.url, post.title.slice(0, 500),
    draft.comment, now
  );

  // Register post for reddit-monitor so replies get tracked
  const monitorKey = `hyp_${post.url.match(/comments\/([^/]+)/)?.[1] || id}`;
  try {
    db.prepare(`
      INSERT OR IGNORE INTO bot_intelligence (id, bot_id, insight_type, key, value_json, confidence, created_at, updated_at)
      VALUES (?, 'reddit', 'monitoring', ?, ?, 30, ?, ?)
    `).run(
      randomUUID(), monitorKey,
      JSON.stringify({
        monitorId: monitorKey, postUrl: post.url, subreddit: post.sub,
        title: post.title.slice(0, 200), monitoredSince: Date.now(),
        seenCommentIds: [], kirillCommentId: "hypothesis_test",
        type: "comment", source: "hypothesis_executor",
      }),
      now, now
    );
  } catch {}

  // Track conversation for this prospect/post
  try {
    const prospectPain = draft.pain || market || null;
    recordFirstContact(
      post.author || "unknown",
      "reddit",
      `r/${post.sub}`,
      draft.comment,
      prospectPain,
      post.url
    );
  } catch (convErr) {
    console.error(`[hypothesis-executor] Conversation tracking error: ${convErr.message}`);
  }

  return id;
}

// ── Update results file for discovery-engine analyze mode ────────────
function updateResultsFile(hypothesisId, market) {
  const tests = db.prepare(`
    SELECT status, COUNT(*) as cnt
    FROM hypothesis_tests
    WHERE hypothesis_id = ?
    GROUP BY status
  `).all(hypothesisId);

  const statusMap = {};
  for (const t of tests) statusMap[t.status] = t.cnt;

  const totalActions = db.prepare(`
    SELECT COUNT(*) as cnt FROM hypothesis_tests WHERE hypothesis_id = ?
  `).get(hypothesisId)?.cnt || 0;

  const channels = db.prepare(`
    SELECT DISTINCT subreddit FROM hypothesis_tests WHERE hypothesis_id = ? AND subreddit IS NOT NULL
  `).all(hypothesisId).map(r => r.subreddit);

  const result = {
    hypothesis_id: hypothesisId,
    hypothesis_market: market,
    updated_at: new Date().toISOString(),
    actions_taken: totalActions,
    comments_drafted: statusMap.drafted || 0,
    comments_posted: statusMap.sent || 0,
    comments_skipped: statusMap.skipped || 0,
    replies_received: statusMap.replied || 0,
    channels_tested: channels,
    conversion_signals: (statusMap.replied || 0) > 0
      ? `${statusMap.replied} replies from ${statusMap.sent || 0} posted comments`
      : "No replies yet",
  };

  // Read existing results and update/append
  let allResults = {};
  if (existsSync(RESULTS_PATH)) {
    try {
      allResults = JSON.parse(readFileSync(RESULTS_PATH, "utf-8"));
    } catch {}
  }
  allResults[hypothesisId] = result;
  allResults._lastUpdated = new Date().toISOString();

  writeFileSync(RESULTS_PATH, JSON.stringify(allResults, null, 2));
  console.log(`[hyp-exec] Results file updated: ${RESULTS_PATH}`);
}

// ── MAIN ─────────────────────────────────────────────────────────────
async function main() {
  console.log("[hyp-exec] Starting hypothesis executor...\n");

  // 1. Read active hypothesis
  if (!existsSync(STATE_PATH)) {
    console.log("[hyp-exec] No discovery state file. Run discovery-engine first.");
    return;
  }

  let state;
  try {
    state = JSON.parse(readFileSync(STATE_PATH, "utf-8"));
  } catch (e) {
    console.error("[hyp-exec] Failed to parse discovery state:", e.message);
    return;
  }

  const active = state.activeHypothesis;
  if (!active || active.status !== "active") {
    console.log("[hyp-exec] No active hypothesis. Run discovery-engine first.");
    return;
  }

  const hypothesisId = active.market.slice(0, 80).replace(/[^a-zA-Z0-9 ]/g, "").replace(/\s+/g, "-").toLowerCase();
  console.log(`[hyp-exec] Active hypothesis: "${active.market.slice(0, 100)}"`);
  console.log(`[hyp-exec] ID: ${hypothesisId}`);

  // Check how many tests already exist for this hypothesis
  const existingCount = db.prepare(`SELECT COUNT(*) as cnt FROM hypothesis_tests WHERE hypothesis_id = ?`).get(hypothesisId)?.cnt || 0;
  if (existingCount >= 7) {
    console.log(`[hyp-exec] Already have ${existingCount} tests for this hypothesis. Skipping to avoid over-drafting.`);
    console.log("[hyp-exec] Run discovery-engine analyze to evaluate results.");
    updateResultsFile(hypothesisId, active.market);
    heartbeat(db, BOT_ID, BOT_NAME, `Skipped - ${existingCount} tests already exist`, { existingCount }, { status: "ok", last_success_at: new Date().toISOString() });
    return;
  }

  // 2. Check if we have the channel capability
  const channel = (active.channel || "").toLowerCase();
  const needsReddit = /reddit|r\//.test(channel);
  const needsEmail = /email/.test(channel);
  const needsLinkedin = /linkedin/.test(channel);
  const needsThreads = /threads/.test(channel);
  const needsTwitter = /twitter|x\.com/.test(channel);

  // Flag if hypothesis requires a channel we don't have
  if (needsLinkedin && !channelCapabilities.includes("LinkedIn") ||
      (needsLinkedin && channelCapabilities.includes("Draft only"))) {
    console.log("[hyp-exec] Hypothesis requires LinkedIn posting but we only have draft capability.");
    await tgSend(BOTS.content.token, CHAT_ID,
      `<b>Hypothesis needs LinkedIn posting</b>\n\nHypothesis: ${active.market.slice(0, 100)}\nChannel: ${channel.slice(0, 100)}\n\nSystem can only draft LinkedIn posts, not post them. Kirill: should we test this via Telegram drafts for manual posting?`);
  }
  if (needsTwitter) {
    console.log("[hyp-exec] Hypothesis requires X/Twitter but API is depleted.");
    await tgSend(BOTS.content.token, CHAT_ID,
      `<b>Hypothesis needs X/Twitter access</b>\n\nHypothesis: ${active.market.slice(0, 100)}\n\nX/Twitter API is depleted. Kirill: should we get new API credits, or test via manual posting?`);
  }

  // 3. Parse the hypothesis
  const parsed = parseHypothesis(active);

  if (parsed.subreddits.length === 0) {
    console.warn("[hyp-exec] No subreddits found in hypothesis. Will rely on Brave Search only.");
  }

  // 3. Find matching posts
  const allPosts = await findMatchingPosts(parsed);

  if (allPosts.length === 0) {
    console.error("[hyp-exec] No matching posts found. Check subreddits and search queries.");
    reportError(db, BOT_ID, BOT_NAME, "No matching posts found for active hypothesis", "api");
    heartbeat(db, BOT_ID, BOT_NAME, "No posts found", {}, { status: "degraded", error: "No matching posts" });
    return;
  }

  // 4. Score and filter to best 5-7 posts
  const targetCount = Math.min(7 - existingCount, 7);
  const bestPosts = await scoreAndFilterPosts(allPosts, parsed, targetCount);
  console.log(`\n[hyp-exec] Selected ${bestPosts.length} posts for drafting\n`);

  // 5. Draft expert comments (auto-skip relevance=low per learned filtering)
  const drafts = [];
  const autoSkipped = [];
  for (const post of bestPosts) {
    console.log(`[hyp-exec] Drafting for: "${post.title.slice(0, 60)}..."`);
    const draft = await draftComment(post, parsed);
    if (!draft) continue;
    if (draft.auto_skipped) {
      autoSkipped.push(draft);
      continue;
    }
    drafts.push({ post, draft });
    // Rate limit between AI calls
    await new Promise(r => setTimeout(r, 500));
  }

  if (autoSkipped.length > 0) {
    console.log(`[hyp-exec] AUTO-SKIPPED ${autoSkipped.length} low-relevance posts (never reached Telegram)`);
    for (const s of autoSkipped) {
      console.log(`  - "${s.post.title.slice(0, 70)}" reason=${s.reason}`);
    }
  }

  console.log(`\n[hyp-exec] Drafted ${drafts.length} usable + ${autoSkipped.length} auto-skipped (out of ${bestPosts.length} candidates)\n`);

  if (drafts.length === 0) {
    console.error("[hyp-exec] All drafts failed quality gate or AI error.");
    reportError(db, BOT_ID, BOT_NAME, "All drafts failed quality gate", "api");
    heartbeat(db, BOT_ID, BOT_NAME, "All drafts failed", {}, { status: "degraded", error: "Zero usable drafts" });
    return;
  }

  // 6. Save to DB + send to Telegram
  let sentCount = 0;
  for (let i = 0; i < drafts.length; i++) {
    const { post, draft } = drafts[i];
    const testId = saveTest(hypothesisId, active.market, post, draft, parsed.actionType);
    await sendDraftToTelegram(post, draft, hypothesisId, testId, i + 1, drafts.length);
    sentCount++;
    // Rate limit Telegram sends
    await new Promise(r => setTimeout(r, 1500));
  }

  // 7. Update results file for discovery-engine analyze mode
  updateResultsFile(hypothesisId, active.market);

  // 8. Send summary to Telegram
  const token = BOTS.content.token;
  if (token && CHAT_ID) {
    const summary = [
      `<b>HYPOTHESIS EXECUTOR - Batch Complete</b>`,
      ``,
      `Testing: ${active.market.slice(0, 100)}`,
      `Posts found: ${allPosts.length}`,
      `Drafts created: ${drafts.length}`,
      `Sent for review: ${sentCount}`,
      `Total tests for this hypothesis: ${existingCount + sentCount}`,
      ``,
      `Channels: ${parsed.subreddits.map(s => `r/${s}`).join(", ")}`,
      `Action: ${parsed.actionType}`,
      ``,
      `Click Posted/Skip on each draft above.`,
    ].join("\n");
    await tgSend(token, CHAT_ID, summary);
  }

  // 9. Heartbeat
  heartbeat(db, BOT_ID, BOT_NAME,
    `Drafted ${drafts.length} comments for hypothesis: ${hypothesisId.slice(0, 40)}`,
    { drafts: drafts.length, posts_found: allPosts.length, subreddits: parsed.subreddits },
    { status: "ok", last_success_at: new Date().toISOString() }
  );

  console.log(`\n[hyp-exec] Done. ${drafts.length} drafts sent to Telegram for review.`);
  db.close();
}

main().catch(e => {
  console.error("[hyp-exec] FATAL:", e);
  try {
    reportError(db, BOT_ID, BOT_NAME, e.message, "crash");
  } catch {}
  process.exit(1);
});
