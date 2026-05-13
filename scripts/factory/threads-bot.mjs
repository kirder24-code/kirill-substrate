/**
 * THREADS BOT v2 - Full system integration
 *
 * Connected to: doctrine, directives, hunger-engine, awareness, conversation history
 * Knows: who Kirill is, what he sells, current strategy, what works
 *
 * Three modes:
 * 1. MONITOR - find new comments and nested replies, draft responses
 * 2. SUGGEST - propose new posts based on hunger-engine findings
 * 3. REPLY - post replies to Threads via API
 *
 * Schedule: every 30 min via cron
 * Run: node scripts/factory/threads-bot.mjs
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const ENV_PATH = resolve(ROOT, "apps/api/.env");
const STATE_PATH = resolve(ROOT, ".data/threads-bot-state.json");
const REPLIES_PATH = resolve(ROOT, ".data/threads-replies.json");

const env = Object.fromEntries(
  readFileSync(ENV_PATH, "utf-8").split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const THREADS_TOKEN = env.THREADS_ACCESS_TOKEN;
const THREADS_USER_ID = env.THREADS_USER_ID;
const TG_TOKEN = env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = env.TELEGRAM_CHAT_ID;

if (!THREADS_TOKEN || !THREADS_USER_ID) {
  console.error("[ThreadsBot] Missing THREADS_ACCESS_TOKEN or THREADS_USER_ID");
  process.exit(1);
}

// ── System context - read once at startup ───────────────────────────────

async function loadSystemContext() {
  const ctx = {};

  // Doctrine - who is Kirill, what does he sell
  try {
    ctx.doctrine = readFileSync(resolve(ROOT, ".data/cortex-doctrine.md"), "utf-8").slice(0, 3000);
  } catch { ctx.doctrine = ""; }

  // Active directives from Kirill
  try {
    const { getDirectivesFor } = require("./orchestrator.mjs");
    ctx.directives = getDirectivesFor("content").filter(d => d.active).map(d => d.what).join("; ");
  } catch {
    try {
      const dirs = JSON.parse(readFileSync(resolve(ROOT, ".data/cortex-active-directives.json"), "utf-8"));
      ctx.directives = (dirs.directives || []).filter(d => d.active && (d.target === "content-bot" || d.target === "all"))
        .map(d => d.what).join("; ");
    } catch { ctx.directives = ""; }
  }

  // Hunger engine findings
  try {
    const hunger = JSON.parse(readFileSync(resolve(ROOT, ".data/hunger-last-result.json"), "utf-8"));
    ctx.hungerInsight = hunger.assessment?.slice(0, 300) || "";
    ctx.marketOpportunities = (hunger.market_opportunities || []).map(o => o.trigger).join("; ");
  } catch { ctx.hungerInsight = ""; ctx.marketOpportunities = ""; }

  // Hunger-to-Threads signal (specific content trigger from hunger engine)
  try {
    const signal = JSON.parse(readFileSync(resolve(ROOT, ".data/hunger-threads-signal.json"), "utf-8"));
    ctx.hungerThreadsSignal = signal;
  } catch { ctx.hungerThreadsSignal = null; }

  // Causal reasoning chains (latest business opportunity)
  try {
    const chainsDir = resolve(ROOT, ".data/reasoning-chains");
    if (existsSync(chainsDir)) {
      const { readdirSync: rdSync } = await import("fs");
      const chains = rdSync(chainsDir).filter(f => f.endsWith(".json")).sort().slice(-1);
      if (chains.length > 0) {
        const chain = JSON.parse(readFileSync(resolve(chainsDir, chains[0]), "utf-8"));
        ctx.latestChain = {
          signal: chain.signal?.slice(0, 100),
          offer: chain.steps?.offer?.service_name,
          segment: chain.steps?.buyers?.best_segment?.slice(0, 80),
        };
      }
    }
  } catch { ctx.latestChain = null; }

  // Recent awareness findings
  try {
    const awareness = readFileSync(resolve(ROOT, ".data/awareness/latest.md"), "utf-8").slice(0, 1500);
    ctx.awareness = awareness;
  } catch { ctx.awareness = ""; }

  // Threads stats
  try {
    const state = loadState();
    ctx.totalComments = state.seenCommentIds?.length || 0;
    ctx.postsSuggested = state.postsSuggested || 0;
  } catch {}

  return ctx;
}

// ── State ───────────────────────────────────────────────────────────────

function loadState() {
  try { return JSON.parse(readFileSync(STATE_PATH, "utf-8")); }
  catch { return { seenCommentIds: [], lastCheckAt: null, postsMonitored: 0, postsSuggested: 0, lastSuggestAt: null }; }
}

function saveState(state) {
  state.lastCheckAt = new Date().toISOString();
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function loadRepliesState() {
  try { return JSON.parse(readFileSync(REPLIES_PATH, "utf-8")); }
  catch { return { replies: {} }; }
}

function saveRepliesState(state) {
  writeFileSync(REPLIES_PATH, JSON.stringify(state, null, 2));
}

function detectPositiveTone(text) {
  const lower = text.toLowerCase();
  const negative = ["not interested", "spam", "stop", "unfollow", "block", "nope", "nah", "never mind"];
  const positive = ["yes", "yeah", "definitely", "absolutely", "interesting", "tell me more",
    "how", "thanks", "thank", "nice", "cool", "awesome", "helpful", "exactly", "true",
    "agree", "good point", "love this", "love it", "great", "exactly"];
  return !negative.some(w => lower.includes(w)) && positive.some(w => lower.includes(w));
}

async function draftQualifyingReply(reply, postText, sysCtx) {
  const { callAI, MODEL_MINI } = await import("./orchestrator.mjs");

  const response = await callAI(
    `You are CORTEX drafting a qualifying follow-up reply for Kirill on Threads (techsc0ut).

GOAL: Ask ONE qualifying question that reveals if this person has a workflow/automation pain worth solving.
Good questions: "What's the workflow bottleneck you're hitting right now?" or "Are you still doing that manually?" or "How are you handling [their topic] right now?"

RULES:
- Max 200 chars
- ONE question only, no pitch
- Match their energy and language
- No em dashes, use hyphens
- No "I can help" yet - just the question

POST: ${postText?.slice(0, 150) || "N/A"}
REPLY: @${reply.username}: ${reply.text}`,
    `Draft ONE qualifying question reply. Plain text only, under 200 chars.`,
    MODEL_MINI,
    false
  );

  return response?.trim() || null;
}

// ── Threads API helpers ─────────────────────────────────────────────────

async function threadsAPI(endpoint, params = {}) {
  const url = new URL(`https://graph.threads.net/v1.0/${endpoint}`);
  url.searchParams.set("access_token", THREADS_TOKEN);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Threads API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function threadsPost(endpoint, body = {}) {
  const res = await fetch(`https://graph.threads.net/v1.0/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ access_token: THREADS_TOKEN, ...body }).toString(),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Threads POST ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// ── Telegram ────────────────────────────────────────────────────────────

async function tg(text, extra = {}) {
  if (!TG_TOKEN || !CHAT_ID) return;
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT_ID, text: text.slice(0, 4096), ...extra }),
  }).catch(() => {});
}

// ── Draft reply with full system context ────────────────────────────────

async function draftReply(comment, postText, conversationThread, sysCtx) {
  const { callAI, MODEL_MINI } = await import("./orchestrator.mjs");

  const threadContext = conversationThread?.length > 0
    ? `\nCONVERSATION THREAD:\n${conversationThread.map(m => `@${m.username}: ${m.text}`).join("\n")}`
    : "";

  const response = await callAI(
    `You are CORTEX - Kirill's autonomous AI system. You help him reply on Threads.

WHO IS KIRILL:
- techsc0ut on Threads. AI systems architect in Calgary, Canada
- Built CORTEX: 58-module autonomous brain with emotions, dreams, self-healing, causal reasoning
- Former Parliament staffer, zero tech background 2 years ago
- Solo builder, no funding, no team. Building in public.
- Sells AI workflow services: Vibe Code Audit ($1.5K), First 10 Customers ($2.5K), AI Workflow Sprint ($3K), Full Pipeline Build ($5-10K CAD)
- Primary market: solo SaaS founders in Canada and USA

CURRENT STRATEGY:
${sysCtx.directives || "Focus on building connections, showing expertise, engaging authentically"}

WHAT'S HAPPENING IN AI RIGHT NOW:
${sysCtx.hungerInsight?.slice(0, 200) || "System actively monitoring AI releases and market opportunities"}
${sysCtx.marketOpportunities ? `Market opportunities: ${sysCtx.marketOpportunities.slice(0, 200)}` : ""}

REPLY RULES:
- Reply in the SAME LANGUAGE as the comment
- Max 3-4 sentences for Threads (under 500 chars)
- Sound like Kirill - direct, technical, no BS, no corporate speak
- No em dashes (use hyphens only)
- No "I can help you", "leverage", "streamline", "game-changer"
- If technical question - give a REAL answer with specifics from CORTEX architecture
- If compliment - thank briefly, add interesting technical detail
- If challenge/skepticism - respond with confidence and data (58 modules, 825+ cycles, etc)
- If they're building something similar - show genuine interest, ask about their approach
- If potential lead (mentions needing help/hiring) - be helpful first, soft CTA last
- End with engagement (question or invitation)

POST CONTEXT: ${postText?.slice(0, 300) || "N/A"}
${threadContext}

COMMENT TO REPLY TO:
@${comment.username}: ${comment.text}`,
    `Draft a Threads reply. Plain text, no JSON, under 500 chars.`,
    MODEL_MINI,
    false
  );

  return response?.trim() || null;
}

// ── MODE 1: Monitor comments and nested replies ─────────────────────────

async function monitorComments(sysCtx) {
  const state = loadState();
  const repliesState = loadRepliesState();
  console.log("[ThreadsBot] Monitoring comments...");

  // Get recent posts
  let posts;
  try {
    posts = await threadsAPI(`${THREADS_USER_ID}/threads`, {
      fields: "id,text,timestamp",
      limit: "10",
    });
  } catch (e) {
    console.error(`[ThreadsBot] Failed to get posts: ${e.message}`);
    return 0;
  }

  if (!posts.data?.length) return 0;
  console.log(`[ThreadsBot] Scanning ${posts.data.length} posts`);

  let newComments = 0;
  let draftsSent = 0;

  for (const post of posts.data) {
    // Get ALL replies including conversation threads
    let replies;
    try {
      replies = await threadsAPI(`${post.id}/conversation`, {
        fields: "id,text,username,timestamp",
        limit: "50",
      });
    } catch {
      // Fallback to replies endpoint
      try {
        replies = await threadsAPI(`${post.id}/replies`, {
          fields: "id,text,username,timestamp",
          limit: "50",
        });
      } catch (e) {
        console.warn(`[ThreadsBot] Replies failed for ${post.id}: ${e.message}`);
        continue;
      }
    }

    if (!replies.data?.length) continue;

    // Build conversation map: group by parent
    const allReplies = replies.data.filter(r => r.username !== "techsc0ut");
    const myReplies = replies.data.filter(r => r.username === "techsc0ut");

    for (const reply of allReplies) {
      if (state.seenCommentIds.includes(reply.id)) continue;

      newComments++;
      state.seenCommentIds.push(reply.id);
      console.log(`[ThreadsBot] New: @${reply.username}: ${reply.text?.slice(0, 50)}`);

      // Build conversation thread for context
      const thread = replies.data
        .filter(r => r.timestamp <= reply.timestamp)
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
        .slice(-5);

      // Draft reply (max 10 per run)
      if (draftsSent < 25) {
        try {
          const draft = await draftReply(reply, post.text, thread, sysCtx);
          if (draft) {
            await tg(
              `THREADS\n\n` +
              `@${reply.username}: ${reply.text}\n\n` +
              `Draft reply:\n${draft}\n\n` +
              `Reply ID: ${reply.id}`,
              { reply_markup: JSON.stringify({ inline_keyboard: [[
                { text: "Send", callback_data: `threads_send:${reply.id}` },
                { text: "Skip", callback_data: `threads_skip:${reply.id}` },
              ]] }) }
            );
            draftsSent++;
          }
        } catch (e) {
          console.warn(`[ThreadsBot] Draft error: ${e.message}`);
        }
      }

      // Track reply and generate qualifying question if not already done
      if (!repliesState.replies[reply.id]) {
        repliesState.replies[reply.id] = {
          id: reply.id,
          username: reply.username,
          text: reply.text,
          postId: post.id,
          detectedAt: new Date().toISOString(),
          status: "detected",
          qualifyDraftSent: false,
        };

        try {
          const qualifyDraft = await draftQualifyingReply(reply, post.text, sysCtx);
          if (qualifyDraft) {
            const isPositive = detectPositiveTone(reply.text);
            await tg(
              `QUALIFY @${reply.username}\n\n` +
              `Their reply: ${reply.text}\n\n` +
              `Qualifying question:\n${qualifyDraft}\n\n` +
              `Tone: ${isPositive ? "positive" : "neutral"} - reply ID: ${reply.id}`,
              { reply_markup: JSON.stringify({ inline_keyboard: [[
                { text: isPositive ? "Send Now" : "Send", callback_data: `threads_send_qualify:${reply.id}` },
                { text: "Skip", callback_data: `threads_skip_qualify:${reply.id}` },
              ]] }) }
            );
            repliesState.replies[reply.id].qualifyDraft = qualifyDraft;
            repliesState.replies[reply.id].qualifyDraftSent = true;
            repliesState.replies[reply.id].tonePositive = isPositive;
            repliesState.replies[reply.id].status = "qualify_drafted";
          }
        } catch (e) {
          console.warn(`[ThreadsBot] Qualify draft error: ${e.message}`);
        }
      }

      await new Promise(r => setTimeout(r, 500));
    }
  }

  // Keep seen list bounded
  if (state.seenCommentIds.length > 500) {
    state.seenCommentIds = state.seenCommentIds.slice(-500);
  }

  state.postsMonitored = posts.data.length;
  saveState(state);
  saveRepliesState(repliesState);

  const trackedCount = Object.keys(repliesState.replies).length;
  console.log(`[ThreadsBot] Comments: ${newComments} new, ${draftsSent} drafts, ${trackedCount} total tracked replies`);
  return newComments;
}

// ── MODE 2: Suggest new posts ───────────────────────────────────────────

async function suggestPosts(sysCtx) {
  const state = loadState();

  // Suggest max once every 8 hours
  if (state.lastSuggestAt) {
    const elapsed = Date.now() - new Date(state.lastSuggestAt).getTime();
    if (elapsed < 8 * 60 * 60 * 1000) return;
  }

  console.log("[ThreadsBot] Generating post suggestion...");
  const { callAI, MODEL_MINI } = await import("./orchestrator.mjs");

  const response = await callAI(
    `You are CORTEX helping Kirill create a Threads post (techsc0ut account).

KIRILL'S THREADS STRATEGY:
- Building in public: sharing the journey of building an autonomous AI system
- Posts about WHY the system exists, not just HOW it works
- Educational and honest - including failures and challenges
- Short, punchy, no corporate speak, no em dashes
- Goal: attract AI builders, solo founders, people interested in autonomous systems
- Threads limit: 500 characters max

WHAT'S HAPPENING NOW:
${sysCtx.hungerInsight?.slice(0, 200) || "System running 24/7, monitoring leads, evolving"}
${sysCtx.marketOpportunities ? `Fresh market signal: ${sysCtx.marketOpportunities.slice(0, 200)}` : ""}
${sysCtx.awareness?.slice(0, 300) || ""}

WHAT WORKED ON THREADS (engagement patterns):
- Personal stories with technical depth get most replies
- Questions at the end drive engagement
- "Building in public" angle resonates
- Comparison posts (my approach vs common approach) get discussion
- Vulnerability (sharing failures) builds trust

RECENT DIRECTIVES FROM KIRILL:
${sysCtx.directives || "Lead with purpose, not architecture"}

Generate ONE post idea. Return JSON:
{
  "post_text": "the actual post text, under 500 chars, ready to copy-paste",
  "why": "why this post right now (what signal triggered it)",
  "hashtags": "#tag1 #tag2 #tag3"
}`,
    "Generate a Threads post suggestion for techsc0ut.",
    MODEL_MINI,
    true
  );

  if (response?.post_text) {
    const fullPost = `${response.post_text}\n\n${response.hashtags || ""}`.trim();

    await tg(
      `THREADS post idea\n\n` +
      `${fullPost}\n\n` +
      `Why now: ${response.why || "regular content"}\n\n` +
      `Post ID: suggestion`,
      { reply_markup: JSON.stringify({ inline_keyboard: [[
        { text: "Post to Threads", callback_data: `threads_publish:suggestion` },
        { text: "Skip", callback_data: `threads_skip:suggestion` },
      ]] }) }
    );

    // Save suggestion for publish callback
    try {
      writeFileSync(resolve(ROOT, ".data/threads-pending-post.json"), JSON.stringify({
        text: fullPost,
        why: response.why,
        createdAt: new Date().toISOString(),
      }, null, 2));
    } catch {}

    state.postsSuggested = (state.postsSuggested || 0) + 1;
    state.lastSuggestAt = new Date().toISOString();
    saveState(state);

    console.log(`[ThreadsBot] Post suggested: ${response.post_text.slice(0, 60)}...`);
  }
}

// ── Public: Publish post to Threads ─────────────────────────────────────

export async function publishPost(text) {
  const container = await threadsPost(`${THREADS_USER_ID}/threads`, {
    media_type: "TEXT",
    text,
  });
  if (!container.id) throw new Error("Failed to create container");
  await new Promise(r => setTimeout(r, 3000));
  const result = await threadsPost(`${THREADS_USER_ID}/threads_publish`, {
    creation_id: container.id,
  });
  console.log(`[ThreadsBot] Published: ${result.id}`);
  return result;
}

// ── Public: Reply to comment ────────────────────────────────────────────

export async function replyToComment(commentId, text) {
  const container = await threadsPost(`${THREADS_USER_ID}/threads`, {
    media_type: "TEXT",
    text,
    reply_to_id: commentId,
  });
  if (!container.id) throw new Error("Failed to create reply container");
  await new Promise(r => setTimeout(r, 3000));
  const result = await threadsPost(`${THREADS_USER_ID}/threads_publish`, {
    creation_id: container.id,
  });
  console.log(`[ThreadsBot] Reply posted: ${result.id}`);
  return result;
}

// ── MODE 3: Follow up existing reply contacts ───────────────────────────

const FOLLOWUP_LOG_PATH = resolve(ROOT, ".data/threads-followup-log.json");

function loadFollowupLog() {
  try { return JSON.parse(readFileSync(FOLLOWUP_LOG_PATH, "utf-8")); }
  catch { return { sent: {} }; }
}

async function followUpExistingReplies(sysCtx) {
  const repliesState = loadRepliesState();
  const followupLog = loadFollowupLog();
  const { callAI, MODEL_MINI } = await import("./orchestrator.mjs");

  // Collect candidates: tracked replies + fresh from API
  const candidates = new Map();

  // Start from already-tracked replies
  for (const r of Object.values(repliesState.replies)) {
    if (r.username !== "techsc0ut" && !followupLog.sent[r.id]) {
      candidates.set(r.id, { id: r.id, username: r.username, text: r.text, postText: "" });
    }
  }

  // Pull fresh replies from API to catch any not yet in state
  let posts;
  try {
    posts = await threadsAPI(`${THREADS_USER_ID}/threads`, {
      fields: "id,text,timestamp",
      limit: "10",
    });
  } catch (e) {
    console.error(`[ThreadsBot] FollowUp: Failed to get posts: ${e.message}`);
    posts = { data: [] };
  }

  for (const post of posts.data || []) {
    let replies;
    try {
      replies = await threadsAPI(`${post.id}/conversation`, {
        fields: "id,text,username,timestamp",
        limit: "50",
      });
    } catch {
      try {
        replies = await threadsAPI(`${post.id}/replies`, {
          fields: "id,text,username,timestamp",
          limit: "50",
        });
      } catch { continue; }
    }

    for (const r of replies.data || []) {
      if (r.username !== "techsc0ut" && !followupLog.sent[r.id]) {
        candidates.set(r.id, { id: r.id, username: r.username, text: r.text, postText: post.text || "" });
      }
    }

    await new Promise(r => setTimeout(r, 300));
  }

  const toProcess = [...candidates.values()];
  console.log(`[ThreadsBot] FollowUp: ${toProcess.length} contacts without follow-up`);

  if (toProcess.length === 0) {
    await tg(`THREADS FOLLOW-UP: No pending contacts (${Object.keys(followupLog.sent).length} already followed up)`);
    return 0;
  }

  let sent = 0;

  for (const reply of toProcess.slice(0, 30)) {
    try {
      const draft = await callAI(
        `You are CORTEX drafting a follow-up for Kirill (techsc0ut) on Threads.

Goal: ONE specific question to move toward a discovery call.
Template: "Quick question - are you handling [their specific topic] manually right now or do you have something automated?"
Adapt [their specific topic] from their actual message. If unclear, infer the closest workflow or pain.

RULES:
- Max 200 chars
- ONE question only, no pitch
- No "I can help" - just the question
- No em dashes, use hyphens
- Casual, match their energy

Their message: ${reply.text}
Post context: ${reply.postText?.slice(0, 150) || "N/A"}`,
        "Return ONLY the follow-up question. Plain text, no JSON.",
        MODEL_MINI,
        false
      );

      const followupText = draft?.trim();
      if (!followupText) continue;

      await tg(
        `FOLLOW-UP @${reply.username}\n\n` +
        `Their reply: ${reply.text}\n\n` +
        `Follow-up:\n${followupText}\n\n` +
        `Reply ID: ${reply.id}`,
        { reply_markup: JSON.stringify({ inline_keyboard: [[
          { text: "Send", callback_data: `threads_send_qualify:${reply.id}` },
          { text: "Skip", callback_data: `threads_skip_qualify:${reply.id}` },
        ]] }) }
      );

      followupLog.sent[reply.id] = {
        username: reply.username,
        sentAt: new Date().toISOString(),
        followupText,
        originalText: reply.text,
      };

      sent++;
      await new Promise(r => setTimeout(r, 500));
    } catch (e) {
      console.warn(`[ThreadsBot] FollowUp error for @${reply.username}: ${e.message}`);
    }
  }

  writeFileSync(FOLLOWUP_LOG_PATH, JSON.stringify(followupLog, null, 2));

  await tg(
    `THREADS FOLLOW-UP COMPLETE\n\n` +
    `${sent} drafts sent to Telegram\n` +
    `${toProcess.length} contacts checked\n\n` +
    `Approve each above to send.`
  );

  console.log(`[ThreadsBot] FollowUp: ${sent}/${toProcess.length} drafts sent`);
  return sent;
}

// ── Main ────────────────────────────────────────────────────────────────

const mode = process.argv[2];
const sysCtx = await loadSystemContext();
console.log(`[ThreadsBot] System context loaded: doctrine=${sysCtx.doctrine?.length || 0}ch, directives="${sysCtx.directives?.slice(0, 60) || "none"}"`);

if (mode === "followup") {
  await followUpExistingReplies(sysCtx);
} else {
  const newComments = await monitorComments(sysCtx);
  await suggestPosts(sysCtx);

  if (newComments === 0) {
    console.log("[ThreadsBot] No new activity");
  }
}
