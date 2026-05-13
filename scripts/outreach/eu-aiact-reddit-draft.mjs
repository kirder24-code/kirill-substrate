#!/usr/bin/env node
/**
 * One-shot: search r/SaaS and r/startups for EU-related posts from last 7 days,
 * pick the top post by engagement, draft an EU AI Act compliance reply,
 * and send to Kirill via Telegram for review + manual posting.
 *
 * Usage: node scripts/outreach/eu-aiact-reddit-draft.mjs
 */
import { callAI, tgSendToKirill } from "../factory/orchestrator.mjs";

const SUBREDDITS = ["SaaS", "startups"];
const SEARCH_TERM = "EU AI Act";
const SEVEN_DAYS_AGO = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;

async function searchSubreddit(subreddit) {
  const url = `https://www.reddit.com/r/${subreddit}/search.json?q=${encodeURIComponent(SEARCH_TERM)}&restrict_sr=1&sort=top&t=week&limit=10&raw_json=1`;
  const res = await fetch(url, {
    headers: { "User-Agent": "KirillBot/1.0 (eu-aiact-draft)", "Accept": "application/json" },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Reddit search failed for r/${subreddit}: ${res.status}`);
  const data = await res.json();
  return (data?.data?.children || [])
    .map(c => c.data)
    .filter(p => p.created_utc >= SEVEN_DAYS_AGO)
    .map(p => ({
      title: p.title || "",
      selftext: (p.selftext || "").slice(0, 600),
      author: p.author || "",
      subreddit: p.subreddit || subreddit,
      score: p.score || 0,
      num_comments: p.num_comments || 0,
      created: new Date(p.created_utc * 1000).toISOString(),
      url: `https://reddit.com${p.permalink}`,
    }));
}

async function findTopPost() {
  const allPosts = [];
  for (const sub of SUBREDDITS) {
    try {
      const posts = await searchSubreddit(sub);
      console.log(`[eu-aiact] r/${sub}: found ${posts.length} EU posts in last 7 days`);
      allPosts.push(...posts);
    } catch (err) {
      console.log(`[eu-aiact] r/${sub} search error: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 600));
  }
  if (!allPosts.length) return null;
  allPosts.sort((a, b) => (b.score + b.num_comments * 3) - (a.score + a.num_comments * 3));
  return allPosts[0];
}

async function draftComment(post) {
  const raw = await callAI(
    `You are writing as Kirill D. - AI automation consultant based in Calgary, Canada.
Background: 5+ years in high-stakes ops (government level), M.Sc. Systems Engineering. You build practical AI workflow automations for SMBs and SaaS founders.

TASK: Write ONE comment for this Reddit thread about the EU AI Act / EU compliance.

The draft must follow this exact message:
"The EU AI Act simplification that passed this week actually creates a short window for Canadian SaaS founders - SME exemptions now cover a wider bracket, but you still need AI usage documentation to qualify. Most founders I talk to don't have this. Happy to share the 3-document checklist if useful."

RULES - hard rules, no exceptions:
- Use the above draft as the base. You may adjust the opening 1-2 sentences to naturally connect with what the OP actually wrote, but keep the core message intact.
- NO pitch. NO link to your website. NO promises about ROI.
- NO bullet points or numbered lists. Plain paragraphs only.
- Mix short and long sentences. Contractions are fine (don't, it's, you'll).
- Max 120 words total.
- No em dashes. Use hyphens instead.
- No money-back guarantees or results-based payment language.

Return JSON: { "comment": "the full comment text", "why": "one line on why this will land" }`,
    `Thread title: ${post.title}\nOP body: ${post.selftext || "(no body)"}\nSubreddit: r/${post.subreddit}\nPosted: ${post.created}\nScore: ${post.score}, Comments: ${post.num_comments}`
  );

  if (typeof raw === "string") {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("AI returned non-JSON: " + raw.slice(0, 200));
  }
  return raw;
}

async function run() {
  console.log(`[eu-aiact] Searching r/SaaS and r/startups for EU AI Act posts...`);

  const post = await findTopPost();
  if (!post) {
    const msg = `<b>EU AI Act Reddit Draft - NO POSTS FOUND</b>\n\nNo EU AI Act posts found in r/SaaS or r/startups in the last 7 days.\n\nConsider posting the compliance checklist as a standalone post instead.`;
    await tgSendToKirill(msg);
    console.log("[eu-aiact] No posts found. Notified Kirill.");
    return;
  }

  console.log(`[eu-aiact] Top post: "${post.title}" in r/${post.subreddit} (score: ${post.score}, comments: ${post.num_comments})`);
  console.log(`[eu-aiact] Drafting comment...`);

  let draft;
  try {
    draft = await draftComment(post);
  } catch (err) {
    console.error(`[eu-aiact] Draft failed:`, err.message);
    await tgSendToKirill(
      `<b>EU AI Act Reddit Draft - DRAFT FAILED</b>\n\n${err.message}\n\nTop post: ${post.url}`
    );
    process.exit(1);
  }

  const msg =
    `<b>EU AI Act Reply Draft - r/${post.subreddit}</b>\n\n` +
    `<b>Thread:</b> ${post.title}\n` +
    `<b>Posted:</b> ${post.created}\n` +
    `<b>Engagement:</b> ${post.score} upvotes, ${post.num_comments} comments\n\n` +
    `--- DRAFT ---\n${draft.comment}\n--- END ---\n\n` +
    `<i>Why this lands: ${draft.why}</i>\n\n` +
    `Post manually at:\n${post.url}`;

  await tgSendToKirill(msg, {
    reply_markup: {
      inline_keyboard: [[{ text: "Open Thread", url: post.url }]],
    },
  });

  console.log(`[eu-aiact] Draft sent to Telegram for Kirill approval.`);
  console.log(`\n=== COMMENT DRAFT ===\n${draft.comment}\n=== END ===\n`);
  console.log(`Thread: ${post.url}`);
}

run().catch(err => {
  console.error("[eu-aiact] Fatal:", err.message);
  process.exit(1);
});
