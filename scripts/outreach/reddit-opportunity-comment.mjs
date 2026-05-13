#!/usr/bin/env node
/**
 * One-shot: draft a comment for a specific Reddit opportunity thread
 * and send it to Kirill via Telegram for review + manual posting.
 *
 * Usage: node scripts/outreach/reddit-opportunity-comment.mjs <thread_url>
 * Default target: the AI consultancy scam thread in r/AI_Agents
 */
import { callAI, tgSendToKirill } from "../factory/orchestrator.mjs";

const TARGET_URL = process.argv[2] || "https://www.reddit.com/r/AI_Agents/comments/1sx0s83/are_ai_consultancy_services_scam/";

async function fetchThread(url) {
  const jsonUrl = url.replace(/\/$/, "").replace(/\?.*/, "") + ".json?limit=10&raw_json=1";
  const res = await fetch(jsonUrl, {
    headers: { "User-Agent": "KirillBot/1.0 (opportunity-comment)", "Accept": "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Reddit fetch failed: ${res.status}`);
  const data = await res.json();
  const post = data?.[0]?.data?.children?.[0]?.data;
  if (!post) throw new Error("Could not parse thread data");
  return {
    title: post.title || "",
    selftext: (post.selftext || "").slice(0, 800),
    author: post.author || "",
    subreddit: post.subreddit || "",
    created: post.created_utc ? new Date(post.created_utc * 1000).toISOString() : "unknown",
    url: `https://reddit.com${post.permalink}`,
  };
}

async function draftComment(thread) {
  const raw = await callAI(
    `You are writing as Kirill D. — AI automation consultant based in Calgary, Canada.
Background: 5+ years in high-stakes ops (government level), M.Sc. Systems Engineering. You build practical automations for SMBs, not hype.

TASK: Write ONE comment for this Reddit thread. The poster is skeptical that AI consultants are scams. They are likely a real business owner with operational pain.

RULES — hard rules, no exceptions:
- Acknowledge the scam concern as valid. Most AI consultants ARE vague and overpromise.
- Give ONE concrete before/after example with real numbers. Use this: "had a logistics client — manual route change approval was taking 45 minutes, now it's 4 minutes. That's it. One workflow."
- End with: "happy to share the audit checklist I use if that's useful"
- NO pitch. NO link to your website. NO promises about ROI.
- NO bullet points or numbered lists. Plain paragraphs only.
- Mix short and long sentences. Contractions everywhere (don't, it's, you'll).
- One small imperfection: a tangent or parenthetical aside.
- Max 150 words total.
- No em dashes. Use hyphens instead.
- No money-back guarantees or results-based payment language.

Return JSON: { "comment": "the full comment text", "why": "one line on why this will land" }`,
    `Thread title: ${thread.title}\nOP body: ${thread.selftext || "(no body)"}\nPosted: ${thread.created}`
  );

  if (typeof raw === "string") {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("AI returned non-JSON: " + raw.slice(0, 200));
  }
  return raw;
}

async function run() {
  console.log(`[reddit-opportunity-comment] Fetching thread: ${TARGET_URL}`);
  let thread;
  try {
    thread = await fetchThread(TARGET_URL);
  } catch (err) {
    console.error(`[reddit-opportunity-comment] Failed to fetch thread:`, err.message);
    await tgSendToKirill(
      `<b>Reddit Opportunity - FETCH FAILED</b>\n\n${err.message}\n\nThread: ${TARGET_URL}`
    );
    process.exit(1);
  }

  console.log(`[reddit-opportunity-comment] Thread: "${thread.title}" by u/${thread.author} (${thread.created})`);
  console.log(`[reddit-opportunity-comment] Drafting comment...`);

  let draft;
  try {
    draft = await draftComment(thread);
  } catch (err) {
    console.error(`[reddit-opportunity-comment] Draft failed:`, err.message);
    await tgSendToKirill(
      `<b>Reddit Opportunity - DRAFT FAILED</b>\n\n${err.message}\n\nThread: ${thread.url}`
    );
    process.exit(1);
  }

  const msg =
    `<b>Reddit Comment Draft - r/${thread.subreddit}</b>\n\n` +
    `<b>Thread:</b> ${thread.title}\n` +
    `<b>Posted:</b> ${thread.created}\n\n` +
    `--- DRAFT ---\n${draft.comment}\n--- END ---\n\n` +
    `<i>Why this lands: ${draft.why}</i>\n\n` +
    `Post manually at:\n${thread.url}`;

  await tgSendToKirill(msg, {
    reply_markup: {
      inline_keyboard: [[{ text: "Open Thread", url: thread.url }]],
    },
  });

  console.log(`[reddit-opportunity-comment] Draft sent to Telegram.`);
  console.log(`\n=== COMMENT DRAFT ===\n${draft.comment}\n=== END ===\n`);
}

run().catch(err => {
  console.error("[reddit-opportunity-comment] Fatal:", err.message);
  process.exit(1);
});
