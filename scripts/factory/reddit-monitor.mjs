/**
 * REDDIT MONITOR v2
 *
 * Runs every 2h. TWO sources:
 *   1. Auto-discovers ALL Kirill's recent Reddit comments via user API
 *   2. Checks registered monitoring entries from Telegram callbacks
 *
 * For each comment: finds direct replies → generates follow-up → sends to Kirill
 */

import { spawnSync } from "child_process";
import { writeFileSync } from "fs";
import { tmpdir } from "os";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import { getDb, callAI, tgSendToKirill, setIntelligence, getIntelligenceKey, logActivity, sendMessage as sendEventBus, heartbeat, reportError, clearError, preflight, logError, logWarn } from "./orchestrator.mjs";
import { readWiki, appendLog } from "../../wiki/reader.mjs";
import { recordReply, generateNextAction } from "./conversation-tracker.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BOT_NAME = "reddit-monitor";
const KIRILL_USERNAME = "Ok-Serve4908";

// Subreddits where Kirill can't post (karma/age requirements)
const BANNED_SUBREDDITS = new Set([
  "ecommerce",    // requires 20 karma
]);

// High-value threads discovered by awareness-bot — Kirill should comment here
// Add new entries as: { url, subreddit, title, why, addedAt }
// DISABLED: auto-monitoring threads where Kirill hasn't commented creates fake "reply" notifications
const AWARENESS_OPPORTUNITY_THREADS = [];

// Chain/franchise ICP subreddits - keyword-filtered, 10 posts/subreddit/cycle max
const SUBREDDIT_SCAN = [
  { subreddit: 'FranchiseForum', searchTerms: ['AI OR automation OR workflow OR manual OR operations OR scale'] },
  { subreddit: 'legaltech', searchTerms: ['AI OR automation OR workflow OR manual OR operations OR scale'] },
  { subreddit: 'smallbusiness_hub', searchTerms: ['AI OR automation OR workflow OR manual OR operations OR scale'] },
  { subreddit: 'Entrepreneur', searchTerms: ['AI OR automation OR workflow OR manual OR operations OR scale'] },
  // Self-identified buyers describing agent failure modes - priority: generates reply drafts via dispatch
  { subreddit: 'AI_Agents', searchTerms: ['"pilot to production" OR "agent loop" OR "worked in testing" OR "fails in production" OR "wrong tool" OR drift OR compounding'], priority: true },
  { subreddit: 'LocalLLaMA', searchTerms: ['"pilot to production" OR "agent loop" OR "worked in testing" OR "fails in production" OR "wrong tool" OR drift OR compounding'], priority: true },
  { subreddit: 'LangChain', searchTerms: ['"pilot to production" OR "agent loop" OR "worked in testing" OR "fails in production" OR drift OR "keeps hallucinating" OR "wrong tool" OR compounding'], priority: true },
  // Franchise/chain-business ICP - keyword-filtered for multi-location operations pain
  { subreddit: 'Entrepreneur', searchTerms: ['franchise OR "multi-location" OR "chain business" OR "multiple locations"'] },
  { subreddit: 'Franchises', searchTerms: ['franchise operations OR "multi-location management" OR "chain automation" OR "franchise software" OR AI OR automation OR workflow'] },
  { subreddit: 'smallbusiness', searchTerms: ['franchise OR "multiple locations" OR "multi-location" OR "chain business"'] },
  { subreddit: 'FranchisedBusiness', searchTerms: ['automation OR workflow OR manual OR operations OR software OR AI'] },
  // Service-business software pain cluster - Canada-wide owners/operators asking how to automate field service tools
  { subreddit: 'Jobber', searchTerms: ['automate OR automation OR "follow up" OR quoting OR dispatch OR workflow OR manual OR reminder'], priority: true },
  { subreddit: 'ServiceTitan', searchTerms: ['automate OR automation OR dispatch OR workflow OR manual OR invoicing OR intake'], priority: true },
  { subreddit: 'HousecallPro', searchTerms: ['automate OR automation OR invoice OR reminder OR quoting OR workflow OR manual'], priority: true },
  { subreddit: 'QuickBooks', searchTerms: ['automate OR automation OR workflow OR "small business" OR invoicing OR manual OR followup'], priority: true },
  { subreddit: 'hubspot', searchTerms: ['automate OR automation OR intake OR workflow OR contractor OR "follow up" OR manual'], priority: true },
  { subreddit: 'smallbusiness', searchTerms: ['Jobber OR ServiceTitan OR "Housecall Pro" OR HubSpot OR QuickBooks AND (automate OR automation OR workflow OR manual OR invoice OR dispatch OR quoting)'] },
  { subreddit: 'Contractor', searchTerms: ['automate OR automation OR Jobber OR ServiceTitan OR "Housecall Pro" OR dispatch OR invoicing OR "follow up" OR workflow'] },
];

// Ignore replies from these bots
const IGNORE_AUTHORS = new Set([
  "AutoModerator", "BotDefense", "RemindMeBot", "sneakpeekbot",
]);

// ── Cross-phase dedup: PHASE 2/3/4 all generate their own seenCommentIds. ──
// Without a shared check, the same Reddit reply can trigger 2-3 Telegram cards.
// This shared key is set right after each successful tgSendToKirill notify and
// checked before every notify call. TTL 30 days matches reply_context.
function wasReplyAlreadyNotified(db, replyId) {
  if (!replyId) return false;
  try {
    return getIntelligenceKey(db, "reddit", "reply_notified", replyId) != null;
  } catch { return false; }
}

function markReplyNotified(db, replyId, source) {
  if (!replyId) return;
  try {
    setIntelligence(db, "reddit", "reply_notified", replyId, {
      notifiedAt: new Date().toISOString(),
      source, // "phase2_main" | "phase3_self_diag" | "phase4_inbox"
    }, 30);
  } catch {}
}

// Reply body length in Telegram cards. Was 400 (truncated mid-sentence on long replies).
// Telegram message limit is 4096; header+draft+footer ~1500, so 2000 for body fits.
const REPLY_BODY_TG_CHARS = 2000;

// ── Fetch Kirill's recent comments from Reddit user API ──────────────
async function fetchKirillComments(limit = 25) {
  const url = `https://www.reddit.com/user/${KIRILL_USERNAME}/comments.json?limit=${limit}&sort=new&raw_json=1`;
  const data = await fetchRedditJSON(url);

  if (!data?.data?.children) return [];

  return data.data.children
    .filter(c => c.kind === "t1" && c.data)
    .map(c => {
      const d = c.data;
      return {
        commentId: d.id,
        subreddit: d.subreddit,
        postTitle: d.link_title,
        postUrl: `https://reddit.com/r/${d.subreddit}/comments/${d.link_id?.replace("t3_", "")}/`,
        commentBody: d.body?.slice(0, 300),
        created: d.created_utc * 1000,
        permalink: `https://reddit.com${d.permalink}`,
        parentId: d.parent_id,
      };
    });
}

// ── Fetch Kirill's recent POSTS from Reddit user API ─────────────────
async function fetchKirillPosts(limit = 10) {
  const url = `https://www.reddit.com/user/${KIRILL_USERNAME}/submitted.json?limit=${limit}&sort=new&raw_json=1`;
  const data = await fetchRedditJSON(url);

  if (!data?.data?.children) return [];

  return data.data.children
    .filter(c => c.kind === "t3" && c.data)
    .map(c => {
      const d = c.data;
      return {
        postId: d.id,
        subreddit: d.subreddit,
        title: d.title,
        postUrl: `https://reddit.com${d.permalink}`,
        numComments: d.num_comments,
        created: d.created_utc * 1000,
      };
    });
}

// ── Fetch with retry on 429 ──
async function fetchRedditJSON(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, {
      headers: { "User-Agent": "KirillBot/1.0 (reply-monitor)", "Accept": "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 429) {
      const wait = (attempt + 1) * 10000; // 10s, 20s, 30s
      console.log(`[${BOT_NAME}] 429 rate limited, waiting ${wait/1000}s...`);
      await new Promise(r => setTimeout(r, wait));
      continue;
    }
    if (!res.ok) throw new Error(`Reddit fetch failed: ${res.status}`);
    return res.json();
  }
  throw new Error("Reddit fetch failed: 429 after 3 retries");
}

// ── Fetch ALL top-level comments on a post (replies to the post itself) ──
async function fetchPostReplies(postUrl) {
  const jsonUrl = postUrl.replace(/\/$/, "").replace(/\?.*/, "") + ".json?limit=200&sort=new";
  const data = await fetchRedditJSON(jsonUrl);

  const replies = [];
  if (Array.isArray(data) && data[1]?.data?.children) {
    for (const child of data[1].data.children) {
      if (child.kind === "t1" && child.data) {
        const r = child.data;
        if (r.author !== KIRILL_USERNAME && r.author !== "[deleted]" && !IGNORE_AUTHORS.has(r.author) && r.body?.length > 10) {
          replies.push({
            id: r.id,
            author: r.author,
            body: (r.body || "").slice(0, 600),
            created: r.created_utc * 1000,
            score: r.score,
          });
        }
      }
    }
  }
  return replies;
}

// ── Fetch direct replies to ALL of Kirill's comments in a thread ─────
async function fetchRepliesToComment(postUrl, _kirillCommentId) {
  const jsonUrl = postUrl.replace(/\/$/, "") + ".json?limit=200&sort=new";
  const data = await fetchRedditJSON(jsonUrl);

  const directReplies = [];

  // Find ALL of Kirill's comments and collect replies to each
  function searchTree(children) {
    for (const child of (children || [])) {
      if (child.kind !== "t1" || !child.data) continue;
      const d = child.data;

      if (d.author === KIRILL_USERNAME) {
        // This is Kirill's comment — collect direct replies to it
        if (d.replies?.data?.children) {
          for (const reply of d.replies.data.children) {
            if (reply.kind === "t1" && reply.data) {
              const r = reply.data;
              if (r.author !== KIRILL_USERNAME && r.author !== "[deleted]" && !IGNORE_AUTHORS.has(r.author) && r.body?.length > 10) {
                directReplies.push({
                  id: r.id,
                  author: r.author,
                  body: (r.body || "").slice(0, 600),
                  created: r.created_utc * 1000,
                  score: r.score,
                  inReplyToComment: d.id,
                });
              }
            }
          }
        }
      }

      // Always recurse to find Kirill's comments at any depth
      if (d.replies?.data?.children) {
        searchTree(d.replies.data.children);
      }
    }
  }

  if (Array.isArray(data) && data[1]?.data?.children) {
    searchTree(data[1].data.children);
  }

  return directReplies;
}

// ── Search a subreddit for posts matching a query (last 24h) ─────────
async function searchSubredditNewPosts(subreddit, query, limit = 10) {
  const url = `https://www.reddit.com/r/${subreddit}/search.json?q=${encodeURIComponent(query)}&sort=new&restrict_sr=1&limit=${limit}&raw_json=1`;
  const data = await fetchRedditJSON(url);
  if (!data?.data?.children) return [];

  const cutoff = Date.now() - 24 * 3600000;
  return data.data.children
    .filter(c => c.kind === "t3" && c.data && c.data.created_utc * 1000 > cutoff)
    .map(c => {
      const d = c.data;
      return {
        postId: d.id,
        subreddit: d.subreddit,
        title: d.title,
        selftext: (d.selftext || "").slice(0, 400),
        postUrl: `https://reddit.com${d.permalink}`,
        author: d.author,
        created: d.created_utc * 1000,
        score: d.score,
      };
    });
}

// ── Generate human-sounding follow-up reply ──────────────────────────
// ICP PATTERN (2026-04-27): Skeptical operator = highest-value lead type.
// Profile: real business owner, manual-work pain, wants ROI proof, rejects buzzwords.
// Thread signal: "are AI consultancy services scam?" — logistics/warehousing owner,
// budget present, wants structured workflow audit + concrete before/after numbers.
// Response rule: lead with one specific before/after example, no promises, no hype.
async function generateFollowUp(originalTitle, replyText, subreddit) {
  return callAI(
    `You are writing as Kirill D. — AI automation consultant in Calgary. Real person.

Someone replied to your Reddit comment. Write a natural follow-up response.

LEAD DETECTION — is_lead = true ONLY if the person:
- Has a SPECIFIC business problem they need PAID help solving (not learning for free)
- Mentions budget, hiring, looking for someone, "can you do this for us"
- is_lead = false if they just want free advice, learning resources, or are making conversation

SKEPTIC RULE — if the person expresses skepticism about AI hype or consultants being scammers:
- Do NOT defend AI or consultants in general
- Acknowledge the skepticism directly ("yeah most of it is hype, honestly")
- Lead with one concrete before/after example (e.g. "cut a 3-hour manual task to 15 minutes")
- No promises, no buzzwords, no ROI percentages — just what actually happened
- This profile (real operator, specific pain, skeptical of hype) is is_lead = true if they have a specific operational problem

CRITICAL — pass AI detection:
- NO bullet points or numbered lists — plain paragraphs only
- Mix short and long sentences
- First-person, personal, casual ("yeah exactly", "the tricky part is...", "we ran into this too")
- Contractions everywhere: don't, it's, you'll, haven't
- Specific numbers that sound remembered, not calculated
- One small imperfection — a tangent, a parenthetical aside, a "well, sort of..."
- Max 120 words
- End casually ("lmk if you want more details", "happy to share the workflow")
- If they seem interested in hiring or getting help — one soft mention of your work

Return JSON: { "reply": "the reply text", "is_lead": true/false, "why": "one sentence" }
be brief.`,
    `Original post: ${originalTitle}\nTheir reply: ${replyText}\nSubreddit: r/${subreddit}`
  );
}

// ── Generate reply for AI_Agents / LocalLLaMA failure-mode posts ─────
async function generateAgentFailureReply(post) {
  return callAI(
    `You are writing as Kirill D. - AI automation consultant in Calgary. Real person, not a bot.

Someone posted about an AI agent failure mode. Write a reply that:
1. Names the EXACT failure mode they described - mirror their specific problem, don't generalize
2. Offers one concrete structural fix (e.g. "separate the planning step from the execution step", "add a human-in-the-loop gate before any write operation", "scope the tool set per agent role")
3. Mentions you've solved this pattern before without naming a price or promising outcomes

HARD RULES:
- NO bullet points or numbered lists - plain paragraphs only
- NO hype words: "game-changing", "revolutionary", "powerful", "leverage"
- Mix short and long sentences. Contractions everywhere.
- Max 100 words
- End with a soft open: "happy to share how we structured it" or "lmk if useful"
- No money-back guarantees or results-based promises
- No em dashes - use hyphens only

Return JSON: { "reply": "the reply text", "topic": "one-line failure mode name" }
be brief.`,
    `Post title: ${post.title}\nPost body: ${post.selftext || "(no body)"}\nSubreddit: r/${post.subreddit}`
  );
}

// ── Main monitor loop ────────────────────────────────────────────────
export async function runRedditMonitor() {
  const db = getDb();
  console.log(`[${BOT_NAME}] Starting Reddit reply monitor v2...`);
  let totalNewReplies = 0;
  let monitoredCount = 0;
  let hadError = false;

  try {
    // ═══ PHASE 1: Auto-discover Kirill's comments and register for monitoring ═══
    console.log(`[${BOT_NAME}] Fetching ${KIRILL_USERNAME}'s recent comments...`);
    let kirillComments = [];
    try {
      kirillComments = await fetchKirillComments(25);
      console.log(`[${BOT_NAME}] Found ${kirillComments.length} recent comments`);
    } catch (err) {
      console.error(`[${BOT_NAME}] Failed to fetch user comments:`, err.message);
    }

    // Build set of already-monitored URLs to prevent duplicates
    const existingRows = db.prepare(
      `SELECT value_json FROM bot_intelligence WHERE bot_id = 'reddit' AND insight_type = 'monitoring'`
    ).all();
    const monitoredUrls = new Set(existingRows.map(r => { try { return JSON.parse(r.value_json).postUrl; } catch { return null; } }).filter(Boolean));

    // Auto-register DISABLED — was creating fake "reply" notifications for posts Kirill never commented on.
    // Only monitor posts that Kirill explicitly engages with via Telegram approve buttons.
    const SKIP_AUTO_REGISTER = true;
    const sevenDaysMs = 7 * 24 * 3600000;
    for (const comment of (SKIP_AUTO_REGISTER ? [] : kirillComments)) {
      if (monitoredUrls.has(comment.postUrl)) continue;
      if (comment.created && (Date.now() - comment.created) > sevenDaysMs) continue;
      const monitorKey = `auto_${comment.commentId}`;
      const existing = getIntelligenceKey(db, "reddit", "monitoring", monitorKey);
      if (!existing) {
        console.log(`[${BOT_NAME}] Auto-registering comment: r/${comment.subreddit} — "${comment.postTitle?.slice(0, 50)}"`);
        setIntelligence(db, "reddit", "monitoring", monitorKey, {
          monitorId: monitorKey,
          postUrl: comment.postUrl,
          subreddit: comment.subreddit,
          title: comment.postTitle || "",
          monitoredSince: Date.now(),
          seenCommentIds: [],
          kirillCommentId: comment.commentId,
          type: "comment",
          source: "auto_discovered",
        }, 30);
      }
    }

    // ═══ PHASE 1b: Auto-discover posts DISABLED ═══
    // Was auto-registering posts and showing ALL comments as "replies to you"
    // Only monitor posts Kirill explicitly engages with
    console.log(`[${BOT_NAME}] Auto-discover posts: DISABLED (use Telegram approve to add)`);

    // ═══ PHASE 1c: Register awareness-discovered opportunity threads ═══
    for (const thread of AWARENESS_OPPORTUNITY_THREADS) {
      if (BANNED_SUBREDDITS.has((thread.subreddit || "").toLowerCase())) continue;
      const monitorKey = `opportunity_${Buffer.from(thread.url).toString("base64").slice(0, 20)}`;
      const existing = getIntelligenceKey(db, "reddit", "monitoring", monitorKey);
      if (!existing) {
        console.log(`[${BOT_NAME}] Registering awareness opportunity: r/${thread.subreddit} — "${thread.title.slice(0, 50)}"`);
        setIntelligence(db, "reddit", "monitoring", monitorKey, {
          monitorId: monitorKey,
          postUrl: thread.url,
          subreddit: thread.subreddit,
          title: thread.title,
          monitoredSince: Date.now(),
          seenCommentIds: [],
          kirillCommentId: null,
          type: "opportunity",
          source: "awareness_bot",
          why: thread.why,
          addedAt: thread.addedAt,
        }, 14); // TTL 14 days — fresh threads only
        // Notify Kirill to engage
        await tgSendToKirill(
          `🎯 <b>Reddit Opportunity</b> — r/${thread.subreddit}\n\n<b>${thread.title}</b>\n\n${thread.why}\n\n<i>Now monitoring for replies once you comment.</i>`,
          { reply_markup: { inline_keyboard: [[{ text: "🔗 Open Thread", url: thread.url }]] } }
        ).catch(err => console.error(`[${BOT_NAME}] Failed to notify about opportunity thread:`, err.message));
      }
    }

    // ═══ PHASE 1d: Scan configured subreddits for buyer-intent posts ═══
    const priorityDrafts = [];
    for (const { subreddit, searchTerms, priority } of SUBREDDIT_SCAN) {
      if (BANNED_SUBREDDITS.has(subreddit.toLowerCase())) continue;
      for (const term of searchTerms) {
        let hits;
        try {
          hits = await searchSubredditNewPosts(subreddit, term);
        } catch (err) {
          console.error(`[${BOT_NAME}] Subreddit scan failed r/${subreddit} "${term}":`, err.message);
          continue;
        }

        // Quality gates — skip obvious noise BEFORE storing or notifying:
        // 1. Scam/fraud warnings — these mention "franchise" but are NOT buyers
        // 2. Moderator announcements — Events/AMA/Megathread/Pinned posts
        // 3. Help-OUT posts (someone TELLING people how to do X) vs help-WANTED
        const NOISE_TITLE_RX = /\b(scam|fraud|beware|warning|phishing|stolen|hacked|alert|announcement|megathread|ama|weekly thread|upcoming events?|programs?|reminder|welcome to|read first|sticky|guide|tutorial|tips and tricks|how to)\b/i;
        const NOISE_BODY_RX = /\b(suspicious situation|wanted to share|share our experience|we run a|let me tell you|in this post i('|')ll|here are some tips|disclaimer|sponsored)\b/i;
        for (const post of hits) {
          if (post.author === KIRILL_USERNAME) continue;
          // Apply noise filter — skip but log so we can audit false-negatives
          if (NOISE_TITLE_RX.test(post.title) || NOISE_BODY_RX.test((post.selftext || "").slice(0, 400))) {
            console.log(`[${BOT_NAME}] Buyer-intent SKIPPED (noise filter): r/${subreddit} "${post.title.slice(0, 60)}"`);
            continue;
          }
          const monitorKey = `scan_${post.postId}`;
          const existing = getIntelligenceKey(db, "reddit", "monitoring", monitorKey);
          if (!existing) {
            console.log(`[${BOT_NAME}] Buyer-intent post found r/${subreddit}: "${post.title.slice(0, 60)}" (term: "${term}")`);
            setIntelligence(db, "reddit", "monitoring", monitorKey, {
              monitorId: monitorKey,
              postUrl: post.postUrl,
              subreddit: post.subreddit,
              title: post.title,
              monitoredSince: Date.now(),
              seenCommentIds: [],
              kirillCommentId: null,
              type: "opportunity",
              source: "subreddit_scan",
              matchedTerm: term,
              postAuthor: post.author,
              priority: priority || false,
            }, 7); // TTL 7 days — fresh buyer-intent posts only

            // ─── Telegram push rule (Kirill 2026-05-13): NO RAW SIGNAL SPAM ───
            // Raw keyword matches are LOGGED to DB only. The priority-flagged
            // posts continue to generate auto-drafts (further down). Those
            // drafts (with actual content Kirill can act on) go to Telegram.
            // Empty matches and non-priority hits stay silent — visible only
            // in dashboard panel / dashboard later.

            if (priority) {
              try {
                const parsed = await generateAgentFailureReply(post);
                if (parsed?.reply) {
                  priorityDrafts.push({
                    name: `u/${post.author}`,
                    sub: post.subreddit,
                    kind: "comment",
                    topic: (parsed.topic || post.title).slice(0, 80),
                    url: post.postUrl,
                    body: parsed.reply,
                    ageHours: (Date.now() - post.created) / 3600000,
                    priority: true,
                  });
                  console.log(`[${BOT_NAME}] Priority draft queued for r/${subreddit}: "${(parsed.topic || post.title).slice(0, 50)}"`);
                }
              } catch (err) {
                console.error(`[${BOT_NAME}] Priority reply generation failed for ${post.postUrl}:`, err.message);
              }
            }
          }
        }

        await new Promise(r => setTimeout(r, 3000)); // rate limit between search queries
      }
    }

    if (priorityDrafts.length > 0) {
      const tmpPath = join(tmpdir(), `reddit-priority-${Date.now()}.json`);
      writeFileSync(tmpPath, JSON.stringify(priorityDrafts));
      console.log(`[${BOT_NAME}] Routing ${priorityDrafts.length} priority drafts through dispatch-reddit-drafts...`);
      spawnSync("node", [resolve(__dirname, "dispatch-reddit-drafts.mjs"), tmpPath], {
        cwd: resolve(__dirname, "../.."), encoding: "utf-8", stdio: "inherit", timeout: 120000,
      });
    }

    // ═══ PHASE 2: Check all monitored posts for replies ═══
    const rows = db.prepare(
      `SELECT key, value_json FROM bot_intelligence WHERE bot_id = 'reddit' AND insight_type = 'monitoring'`
    ).all();

    if (!rows.length) {
      console.log(`[${BOT_NAME}] No monitored posts. Done.`);
      return;
    }

    monitoredCount = rows.length;
    console.log(`[${BOT_NAME}] Checking ${rows.length} monitored post(s) for replies...`);

    for (const row of rows) {
      let monitor;
      try { monitor = JSON.parse(row.value_json); } catch (e) { logWarn(BOT_NAME, "config", `Bad monitor JSON for key ${row.key}: ${e.message}`); continue; }

      const { monitorId, postUrl, subreddit, title, seenCommentIds = [], kirillCommentId } = monitor;
      if (!postUrl) continue;

      // Skip banned subreddits
      if (BANNED_SUBREDDITS.has((subreddit || "").toLowerCase())) {
        console.log(`[${BOT_NAME}] Skip banned subreddit: r/${subreddit}`);
        continue;
      }

      // Posts without kirillCommentId = Kirill's own posts, check all top-level replies
      // Comments with kirillCommentId = replies to Kirill's comment specifically
      // Opportunity threads = awareness-discovered, watch ONLY replies to Kirill's comment once he engages
      if (!kirillCommentId && monitor.type !== "post") continue;

      try {
        const directReplies = monitor.type === "post"
          ? await fetchPostReplies(postUrl)
          : await fetchRepliesToComment(postUrl, kirillCommentId);

        const newReplies = directReplies.filter(c => !seenCommentIds.includes(c.id));

        if (!newReplies.length) {
          console.log(`[${BOT_NAME}] No new replies in r/${subreddit}: ${title?.slice(0, 50)}`);
          // Still update lastChecked
          setIntelligence(db, "reddit", "monitoring", monitorId, {
            ...monitor,
            lastChecked: Date.now(),
          }, 30);
          continue;
        }

        console.log(`[${BOT_NAME}] 🔔 ${newReplies.length} new reply(ies) in r/${subreddit}: ${title?.slice(0, 50)}`);
        totalNewReplies += newReplies.length;

        for (const comment of newReplies.slice(0, 10)) {
          // Cross-phase dedup: skip if any phase already notified for this reply
          if (wasReplyAlreadyNotified(db, comment.id)) {
            console.log(`[${BOT_NAME}] PHASE2 skip (already notified): reply ${comment.id} from ${comment.author}`);
            continue;
          }

          // ── Record reply in conversation tracker ──
          let convContext = null;
          let strategicAction = null;
          try {
            // Find Kirill's original comment text for context
            const kirillComment = kirillCommentId
              ? (await fetchRepliesToComment(postUrl, kirillCommentId).catch(() => [])).length > 0
                ? null // we already fetched, originalComment comes from the monitor record
                : null
              : null;

            convContext = recordReply(
              comment.author, "reddit", `r/${subreddit}`,
              comment.body, monitor.kirillOriginalComment || title
            );

            // Generate strategic next action using full conversation history
            if (convContext?.id) {
              strategicAction = await generateNextAction(convContext.id).catch(err => {
                console.error(`[${BOT_NAME}] generateNextAction failed: ${err.message}`);
                return null;
              });
            }
          } catch (convErr) {
            console.error(`[${BOT_NAME}] Conversation tracking error: ${convErr.message}`);
          }

          // Fallback to generic follow-up if strategic action failed
          const followUp = strategicAction
            ? { reply: strategicAction.next_message, is_lead: strategicAction.is_ready_for_proposal || false, why: strategicAction.reason }
            : await generateFollowUp(title, comment.body, subreddit).catch(() => null);

          // Build stage and history summary for Telegram card
          const stageLabel = convContext?.stage ? ` | Stage: ${convContext.stage}` : "";
          const msgCount = convContext?.history?.length || 0;
          const historyLine = msgCount > 1 ? `\n<b>History:</b> ${msgCount} messages in conversation` : "";
          const painLine = (convContext?.prospect_pain || strategicAction?.detected_pain)
            ? `\n<b>Pain:</b> ${(convContext?.prospect_pain || strategicAction?.detected_pain).slice(0, 150)}`
            : "";
          const reasonLine = strategicAction?.reason ? `\n<b>Strategy:</b> ${strategicAction.reason.slice(0, 200)}` : "";

          const text = [
            monitor.type === "opportunity"
              ? `💬 <b>Новый коммент в треде (r/${subreddit})</b>`
              : `💬 <b>Тебе ответили на Reddit!</b>`,
            `<b>r/${subreddit}</b>${followUp?.is_lead ? " | 🔥 Потенциальный лид!" : ""}${stageLabel}`,
            ``,
            `<b>${comment.author} написал:</b>`,
            `<i>${comment.body.slice(0, REPLY_BODY_TG_CHARS)}</i>`,
            historyLine + painLine + reasonLine,
            ``,
            followUp ? [
              `<b>Готовый ответ (скопируй):</b>`,
              `<code>${followUp.reply}</code>`,
            ].join("\n") : "",
          ].filter(Boolean).join("\n");

          const replyKey = `reddit_reply_${comment.id}`;

          // Save reply context so telegram-control can record it
          setIntelligence(db, "reddit", "reply_context", replyKey, {
            commentId: comment.id,
            author: comment.author,
            body: comment.body.slice(0, 300),
            subreddit,
            postUrl,
            postTitle: title,
            monitorId,
            kirillCommentId,
            isLead: followUp?.is_lead || false,
            conversationId: convContext?.id || null,
            conversationStage: convContext?.stage || null,
            detectedAt: new Date().toISOString(),
          }, 30);

          const keyboard = { inline_keyboard: [
            [{ text: "🔗 Открыть тред", url: postUrl }],
            [
              { text: "✅ Ответил", callback_data: `reddit_replied:${replyKey}` },
              { text: "⏭ Пропустить", callback_data: `reddit_skip:${replyKey}` },
            ],
            [{ text: "🤖 Меню", callback_data: "menu" }],
          ]};

          // Only mark as seen AFTER successful Telegram notification
          try {
            await tgSendToKirill(text, { reply_markup: keyboard });
            seenCommentIds.push(comment.id);
            markReplyNotified(db, comment.id, "phase2_main");
            console.log(`[${BOT_NAME}] ✅ Notified Kirill about reply from ${comment.author} (conv: ${convContext?.id || "new"}, stage: ${convContext?.stage || "n/a"})`);
          } catch (sendErr) {
            console.error(`[${BOT_NAME}] ❌ FAILED to notify Kirill about reply from ${comment.author}: ${sendErr.message}`);
            // Do NOT add to seenCommentIds — will retry next cycle
          }
          await new Promise(r => setTimeout(r, 500));
        }

        // Update DB
        setIntelligence(db, "reddit", "monitoring", monitorId, {
          ...monitor,
          seenCommentIds,
          lastChecked: Date.now(),
        }, 30);

        logActivity(db, BOT_NAME, "replies_found", { postUrl, count: newReplies.length });

      } catch (err) {
        console.error(`[${BOT_NAME}] Error checking ${postUrl}:`, err.message);
      }

      await new Promise(r => setTimeout(r, 5000)); // rate limit — 5 sec between requests to avoid 429
    }

    console.log(`[${BOT_NAME}] Total new replies found: ${totalNewReplies}`);

    // ═══ PHASE 3: Self-diagnosis — find replies we missed ═══
    // Fetch Kirill's recent comments and check if any have replies we haven't seen
    try {
      console.log(`[${BOT_NAME}] Self-diagnosis: checking for missed replies...`);
      let missedCount = 0;

      for (const comment of kirillComments.slice(0, 10)) {
        // For each comment, check seen IDs from either monitoring registry or inbox_seen fallback
        const monitorKey = `auto_${comment.commentId}`;
        const monitor = getIntelligenceKey(db, "reddit", "monitoring", monitorKey);
        const inboxSeen = getIntelligenceKey(db, "reddit-inbox", "inbox_seen", comment.commentId);
        // If neither monitoring nor inbox_seen exists for this comment, still check — inbox check is disabled so we need to scan here
        const seenIds = new Set([...(monitor?.seenCommentIds || []), ...(inboxSeen?.ids || [])]);

        // Fetch replies to ALL Kirill's comments in this thread (not just one)
        try {
          const allReplies = await fetchRepliesToComment(comment.postUrl, comment.commentId);
          const missed = allReplies.filter(r => !seenIds.has(r.id));

          if (missed.length > 0) {
            console.log(`[${BOT_NAME}] 🔍 Self-diagnosis found ${missed.length} missed reply(ies) in r/${comment.subreddit}: ${comment.postTitle?.slice(0, 40)}`);
            missedCount += missed.length;

            for (const reply of missed.slice(0, 2)) {
              // Cross-phase dedup: skip if PHASE 2 or PHASE 4 already notified for this reply
              if (wasReplyAlreadyNotified(db, reply.id)) {
                console.log(`[${BOT_NAME}] PHASE3 skip (already notified): reply ${reply.id} from ${reply.author}`);
                seenIds.add(reply.id);
                continue;
              }

              // ── Record in conversation tracker ──
              let convContext = null;
              let strategicAction = null;
              try {
                convContext = recordReply(
                  reply.author, "reddit", `r/${comment.subreddit}`,
                  reply.body, comment.commentBody || comment.postTitle
                );
                if (convContext?.id) {
                  strategicAction = await generateNextAction(convContext.id).catch(() => null);
                }
              } catch (convErr) {
                console.error(`[${BOT_NAME}] Self-diag conversation tracking error: ${convErr.message}`);
              }

              const followUp = strategicAction
                ? { reply: strategicAction.next_message, is_lead: strategicAction.is_ready_for_proposal || false, why: strategicAction.reason }
                : await generateFollowUp(comment.postTitle, reply.body, comment.subreddit).catch(() => null);

              const replyKey = `reddit_reply_${reply.id}`;
              const stageLabel = convContext?.stage ? ` | Stage: ${convContext.stage}` : "";

              setIntelligence(db, "reddit", "reply_context", replyKey, {
                commentId: reply.id, author: reply.author, body: reply.body.slice(0, 300),
                subreddit: comment.subreddit, postUrl: comment.postUrl,
                postTitle: comment.postTitle, monitorId: monitorKey,
                kirillCommentId: reply.inReplyToComment || comment.commentId,
                isLead: followUp?.is_lead || false, detectedAt: new Date().toISOString(),
                conversationId: convContext?.id || null,
                source: "self_diagnosis",
              }, 30);

              const text = [
                `💬 <b>Тебе ответили на Reddit!</b> (найдено самодиагностикой)`,
                `<b>r/${comment.subreddit}</b>${followUp?.is_lead ? " | 🔥 Потенциальный лид!" : ""}${stageLabel}`,
                ``, `<b>${reply.author} написал:</b>`,
                `<i>${reply.body.slice(0, REPLY_BODY_TG_CHARS)}</i>`, ``,
                followUp ? `<b>Готовый ответ (скопируй):</b>\n<code>${followUp.reply}</code>` : "",
              ].filter(Boolean).join("\n");

              try {
                await tgSendToKirill(text, { reply_markup: { inline_keyboard: [
                  [{ text: "🔗 Открыть тред", url: comment.postUrl }],
                  [{ text: "✅ Ответил", callback_data: `reddit_replied:${replyKey}` }, { text: "⏭ Пропустить", callback_data: `reddit_skip:${replyKey}` }],
                  [{ text: "🤖 Меню", callback_data: "menu" }],
                ]}});
                seenIds.add(reply.id);
                markReplyNotified(db, reply.id, "phase3_self_diag");
                console.log(`[${BOT_NAME}] ✅ Notified Kirill about missed reply from ${reply.author} (conv: ${convContext?.id || "new"})`);
              } catch (sendErr) {
                console.error(`[${BOT_NAME}] ❌ FAILED to notify about missed reply from ${reply.author}: ${sendErr.message}`);
              }
              await new Promise(r => setTimeout(r, 1000));
            }

            // Update seen list
            setIntelligence(db, "reddit", "monitoring", monitorKey, {
              ...monitor, seenCommentIds: [...seenIds], lastChecked: Date.now(),
            }, 30);
          }

          await new Promise(r => setTimeout(r, 3000));
        } catch (err) {
          // rate limit or fetch error — skip silently
        }
      }

      if (missedCount > 0) {
        console.log(`[${BOT_NAME}] 🔍 Self-diagnosis: recovered ${missedCount} missed replies`);
        // Log the diagnosis event for EvolutionBot to learn from
        setIntelligence(db, BOT_NAME, "self_diagnosis", `run_${Date.now()}`, {
          missedCount, reason: "replies_to_nested_comments_or_new_comments",
          fixedAt: new Date().toISOString(),
        }, 50);
      } else {
        console.log(`[${BOT_NAME}] Self-diagnosis: all replies accounted for ✅`);
      }
    } catch (err) {
      console.error(`[${BOT_NAME}] Self-diagnosis error:`, err.message);
    }

  } finally {
    const healthStatus = hadError ? "error" : totalNewReplies > 0 ? "ok" : monitoredCount === 0 ? "degraded" : "ok";
    heartbeat(db, BOT_NAME, "RedditMonitor", `done — ${totalNewReplies} new replies from ${monitoredCount} posts`, {}, {
      status: healthStatus,
      last_success_at: totalNewReplies > 0 ? new Date().toISOString() : null,
      error: hadError ? "errors during cycle" : null
    });

    if (healthStatus === "ok") {
      try { clearError(db, BOT_NAME); } catch {}
    } else if (hadError) {
      try { reportError(db, BOT_NAME, "RedditMonitor", "errors during cycle", "api", "runRedditMonitor"); } catch {}
    }

    db.close();
    console.log(`[${BOT_NAME}] Done.`);
  }
}

// ── Inbox check: scan all recent Kirill comments for new replies ──────
// Runs every 15 min. No OAuth required - uses public Reddit user API.
// Independent of the monitoring registration system so no comments are missed.
export async function runInboxCheck() {
  const db = getDb();
  const BOT_INBOX = "reddit-inbox";
  console.log(`[${BOT_INBOX}] Inbox check starting...`);
  let found = 0;

  try {
    let kirillComments = [];
    try {
      kirillComments = await fetchKirillComments(25);
    } catch (err) {
      console.error(`[${BOT_INBOX}] Failed to fetch comments: ${err.message}`);
      return;
    }

    const sevenDaysMs = 7 * 24 * 3600000;
    const recentComments = kirillComments.filter(c => Date.now() - (c.created || 0) < sevenDaysMs);
    console.log(`[${BOT_INBOX}] Checking ${recentComments.length} comments from last 7 days`);

    for (const comment of recentComments.slice(0, 15)) {
      const seenRecord = getIntelligenceKey(db, BOT_INBOX, "inbox_seen", comment.commentId) || { ids: [] };
      const seenIds = new Set(seenRecord.ids || []);

      let replies;
      try {
        replies = await fetchRepliesToComment(comment.postUrl, comment.commentId);
      } catch (err) {
        console.error(`[${BOT_INBOX}] Fetch replies error for ${comment.commentId}: ${err.message}`);
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }

      const newReplies = replies.filter(r => !seenIds.has(r.id));

      if (!newReplies.length) {
        await new Promise(r => setTimeout(r, 3000));
        continue;
      }

      console.log(`[${BOT_INBOX}] ${newReplies.length} new reply(ies) on comment ${comment.commentId} in r/${comment.subreddit}`);
      found += newReplies.length;

      for (const reply of newReplies.slice(0, 5)) {
        // Cross-phase dedup: skip if PHASE 2 or PHASE 3 already notified for this reply
        if (wasReplyAlreadyNotified(db, reply.id)) {
          console.log(`[${BOT_INBOX}] PHASE4 skip (already notified): reply ${reply.id} from ${reply.author}`);
          seenIds.add(reply.id);
          continue;
        }

        let convContext = null;
        let strategicAction = null;
        try {
          convContext = recordReply(
            reply.author, "reddit", `r/${comment.subreddit}`,
            reply.body, comment.commentBody || comment.postTitle
          );
          if (convContext?.id) {
            strategicAction = await generateNextAction(convContext.id).catch(() => null);
          }
        } catch (convErr) {
          console.error(`[${BOT_INBOX}] Conversation tracking error: ${convErr.message}`);
        }

        const followUp = strategicAction
          ? { reply: strategicAction.next_message, is_lead: strategicAction.is_ready_for_proposal || false, why: strategicAction.reason }
          : await generateFollowUp(comment.postTitle, reply.body, comment.subreddit).catch(() => null);

        const replyKey = `reddit_reply_${reply.id}`;
        const stageLabel = convContext?.stage ? ` | Stage: ${convContext.stage}` : "";
        const painLine = (convContext?.prospect_pain || strategicAction?.detected_pain)
          ? `\n<b>Pain:</b> ${(convContext?.prospect_pain || strategicAction?.detected_pain).slice(0, 150)}`
          : "";

        setIntelligence(db, "reddit", "reply_context", replyKey, {
          commentId: reply.id, author: reply.author, body: reply.body.slice(0, 300),
          subreddit: comment.subreddit, postUrl: comment.postUrl,
          postTitle: comment.postTitle, kirillCommentId: comment.commentId,
          isLead: followUp?.is_lead || false, detectedAt: new Date().toISOString(),
          conversationId: convContext?.id || null, source: "inbox_check",
        }, 30);

        const text = [
          `💬 <b>Тебе ответили на Reddit!</b>`,
          `<b>r/${comment.subreddit}</b>${followUp?.is_lead ? " | 🔥 Потенциальный лид!" : ""}${stageLabel}`,
          ``,
          `<b>${reply.author} написал:</b>`,
          `<i>${reply.body.slice(0, REPLY_BODY_TG_CHARS)}</i>`,
          painLine,
          ``,
          followUp ? `<b>Готовый ответ (скопируй):</b>\n<code>${followUp.reply}</code>` : "",
        ].filter(Boolean).join("\n");

        try {
          await tgSendToKirill(text, {
            reply_markup: { inline_keyboard: [
              [{ text: "🔗 Открыть тред", url: comment.postUrl }],
              [
                { text: "✅ Ответил", callback_data: `reddit_replied:${replyKey}` },
                { text: "⏭ Пропустить", callback_data: `reddit_skip:${replyKey}` },
              ],
              [{ text: "🤖 Меню", callback_data: "menu" }],
            ]},
          });
          seenIds.add(reply.id);
          markReplyNotified(db, reply.id, "phase4_inbox");
          console.log(`[${BOT_INBOX}] Notified: ${reply.author} replied to ${comment.commentId} (conv: ${convContext?.id || "new"})`);
        } catch (sendErr) {
          console.error(`[${BOT_INBOX}] FAILED to notify about ${reply.author}: ${sendErr.message}`);
        }
        await new Promise(r => setTimeout(r, 500));
      }

      setIntelligence(db, BOT_INBOX, "inbox_seen", comment.commentId, {
        ids: [...seenIds], lastChecked: Date.now(),
      }, 14);

      await new Promise(r => setTimeout(r, 5000));
    }

    console.log(`[${BOT_INBOX}] Done. ${found} new replies found.`);
    heartbeat(db, BOT_INBOX, "RedditInboxCheck", `done — ${found} new replies across ${recentComments.length} comments`, {}, {
      status: "ok",
    });

  } catch (err) {
    console.error(`[${BOT_INBOX}] Error:`, err.message);
    try { reportError(db, BOT_INBOX, "RedditInboxCheck", err.message, "crash", "runInboxCheck"); } catch {}
  } finally {
    db.close();
  }
}

// ── Fetch status of a specific comment in its thread ─────────────────
// Returns { fetched, found, removed, shadowRemoved, body, replyCount, error }
async function fetchCommentStatus(postUrl, commentId) {
  const jsonUrl = postUrl.replace(/\/$/, "").replace(/\?.*/, "") + ".json?limit=500&raw_json=1";
  let data;
  try {
    data = await fetchRedditJSON(jsonUrl);
  } catch (err) {
    return { fetched: false, error: err.message };
  }

  function findInTree(children) {
    for (const child of (children || [])) {
      if (child.kind !== "t1" || !child.data) continue;
      const d = child.data;
      if (d.id === commentId) {
        const body = d.body || "";
        const removed = body === "[removed]" || body === "[deleted]" || d.author === "[deleted]";
        const directReplies = (d.replies?.data?.children || []).filter(r => r.kind === "t1").length;
        return { found: true, removed, body: body.slice(0, 120), replyCount: directReplies };
      }
      if (d.replies?.data?.children) {
        const hit = findInTree(d.replies.data.children);
        if (hit) return hit;
      }
    }
    return null;
  }

  if (!Array.isArray(data) || !data[1]?.data?.children) {
    return { fetched: true, found: false, error: "unexpected_response" };
  }

  const hit = findInTree(data[1].data.children);
  if (!hit) return { fetched: true, found: false, shadowRemoved: true };
  return { fetched: true, ...hit };
}

// ── Diagnostic: check last N comments for existence and replies ───────
export async function runReplyAudit(limit = 50) {
  const db = getDb();
  const PROJECT_ROOT = resolve(__dirname, "../..");
  console.log(`[${BOT_NAME}] reply-audit: fetching last ${limit} comments for ${KIRILL_USERNAME}...`);

  let comments = [];
  try {
    comments = await fetchKirillComments(limit);
  } catch (err) {
    console.error(`[${BOT_NAME}] reply-audit: failed to fetch comments: ${err.message}`);
    db.close();
    return;
  }
  console.log(`[${BOT_NAME}] reply-audit: got ${comments.length} comments from user API`);

  let existsCount = 0, removedCount = 0, shadowRemovedCount = 0, hasRepliesCount = 0, fetchErrorCount = 0;
  const results = [];

  for (const comment of comments) {
    console.log(`[${BOT_NAME}] reply-audit: checking ${comment.commentId} r/${comment.subreddit}...`);
    const status = await fetchCommentStatus(comment.postUrl, comment.commentId);

    const entry = {
      commentId: comment.commentId,
      subreddit: comment.subreddit,
      postTitle: (comment.postTitle || "").slice(0, 80),
      commentSnippet: (comment.commentBody || "").slice(0, 100),
      postedAt: comment.created ? new Date(comment.created).toISOString() : null,
      permalink: comment.permalink,
      ...status,
    };

    if (!status.fetched) {
      fetchErrorCount++;
    } else if (status.found && !status.removed) {
      existsCount++;
      if ((status.replyCount || 0) > 0) hasRepliesCount++;
    } else if (status.found && status.removed) {
      removedCount++;
    } else {
      shadowRemovedCount++;
    }

    results.push(entry);
    await new Promise(r => setTimeout(r, 3000));
  }

  const auditData = {
    auditAt: new Date().toISOString(),
    total: comments.length,
    exists: existsCount,
    removed: removedCount,
    shadowRemoved: shadowRemovedCount,
    fetchErrors: fetchErrorCount,
    hasReplies: hasRepliesCount,
    comments: results,
  };

  const auditPath = resolve(PROJECT_ROOT, ".data/reddit-reply-audit.json");
  writeFileSync(auditPath, JSON.stringify(auditData, null, 2));
  console.log(`[${BOT_NAME}] reply-audit: written to .data/reddit-reply-audit.json`);

  const alertLine = shadowRemovedCount > Math.floor(comments.length * 0.3)
    ? `\n<b>ALERT: ${shadowRemovedCount}/${comments.length} shadow-removed - reddit channel may be dead</b>`
    : `Shadow-removal rate: ${shadowRemovedCount}/${comments.length} (normal if low)`;

  const msg = [
    `<b>Reddit Reply Audit</b>`,
    ``,
    `Checked: ${comments.length} comments`,
    `Live (not removed): ${existsCount}`,
    `Removed by mods: ${removedCount}`,
    `Shadow-removed (gone from thread): ${shadowRemovedCount}`,
    `Fetch errors: ${fetchErrorCount}`,
    `Has direct replies: ${hasRepliesCount}`,
    alertLine,
  ].join("\n");

  try {
    await tgSendToKirill(msg);
  } catch (err) {
    console.error(`[${BOT_NAME}] reply-audit: Telegram send failed: ${err.message}`);
  }

  db.close();
  return auditData;
}

// ── Live mode (every 10 min monitor + every 15 min inbox check) ───────
async function liveMode() {
  console.log(`[${BOT_NAME}] Live mode started — monitor every 10 min, inbox check every 15 min`);

  // Preflight
  const precheck = preflight([
    { name: "OPENAI_API_KEY", value: process.env.OPENAI_API_KEY },
  ]);
  if (!precheck.ok) {
    console.error(`[${BOT_NAME}] Preflight FAILED: ${precheck.message}`);
    try { const db = getDb(); reportError(db, BOT_NAME, "RedditMonitor", precheck.message, "config", "preflight"); db.close(); } catch {}
    return;
  }

  // Run inbox check independently on 15-min interval
  (async () => {
    while (true) {
      try {
        await runInboxCheck();
      } catch (err) {
        console.error(`[${BOT_NAME}] Inbox check error:`, err.message);
      }
      await new Promise(r => setTimeout(r, 15 * 60 * 1000));
    }
  })();

  while (true) {
    try {
      await runRedditMonitor();
    } catch (err) {
      console.error(`[${BOT_NAME}] Live mode error:`, err.message);
      try { const edb = getDb(); reportError(edb, BOT_NAME, "RedditMonitor", err.message, "crash", "liveMode"); edb.close(); } catch {}
    }
    await new Promise(r => setTimeout(r, 10 * 60 * 1000));
  }
}

if (process.argv[2] === "live") {
  liveMode().catch(console.error);
} else if (process.argv[2] === "audit") {
  runReplyAudit(50).catch(console.error);
} else {
  // One-shot mode: run once and exit (for daemon scheduling)
  const precheck = preflight([
    { name: "OPENAI_API_KEY", value: process.env.OPENAI_API_KEY },
  ]);
  if (!precheck.ok) {
    console.error(`[${BOT_NAME}] Preflight FAILED: ${precheck.message}`);
    process.exit(1);
  }
  (async () => {
    try {
      await runRedditMonitor();
    } catch (err) {
      console.error(`[${BOT_NAME}] runRedditMonitor error:`, err.message);
    }
    try {
      await runInboxCheck();
    } catch (err) {
      console.error(`[${BOT_NAME}] runInboxCheck error:`, err.message);
    }
  })().catch(err => {
    console.error(`[${BOT_NAME}] Fatal error:`, err.message);
    process.exit(1);
  });
}
