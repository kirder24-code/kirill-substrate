/**
 * REDDIT PUBLISHER — Playwright Edition
 *
 * Использует браузер (Playwright) вместо API.
 * Reddit видит обычного пользователя — никаких API ключей не нужно.
 *
 * Два режима:
 * 1. postToReddit(subreddit, title, text) — публикует пост
 * 2. commentOnReddit(postUrl, text) — оставляет комментарий
 */

import { chromium } from "@playwright/test";
import { getDb, callAI, tgSendToKirill, setIntelligence, getIntelligenceKey, logActivity, env } from "./orchestrator.mjs";

const REDDIT_USERNAME = env.REDDIT_USERNAME;
const REDDIT_PASSWORD = env.REDDIT_PASSWORD;

// Subreddits and their tone
const POSTING_SUBREDDITS = {
  "smallbusiness":  { tone: "practical, no self-promo in title, value first" },
  "entrepreneur":   { tone: "founder-to-founder, results focused, specific numbers" },
  "automation":     { tone: "technical + business outcome, show the workflow" },
  "Calgary":        { tone: "local, friendly, community-first, mention Calgary context" },
  "n8n":            { tone: "technical, show n8n workflow context, community helpful" },
};

// ── Login to Reddit ───────────────────────────────────────────────────
async function loginToReddit(page) {
  await page.goto("https://www.reddit.com/login", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  // Fill login form
  await page.fill('input[name="username"]', REDDIT_USERNAME);
  await page.fill('input[name="password"]', REDDIT_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);

  // Check if logged in
  const url = page.url();
  if (url.includes("/login")) throw new Error("Reddit login failed — check credentials");
  console.log("[Reddit] Logged in successfully");
}

// ── Post to subreddit ─────────────────────────────────────────────────
export async function postToReddit(subreddit, title, text) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  });
  const page = await context.newPage();

  try {
    await loginToReddit(page);

    // Go to submit page for subreddit
    await page.goto(`https://www.reddit.com/r/${subreddit}/submit`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);

    // Click "Text" post type if options are shown
    const textTab = page.locator('[data-testid="post-type-text"], button:has-text("Text"), [aria-label="Text"]').first();
    if (await textTab.isVisible({ timeout: 3000 }).catch(() => false)) {
      await textTab.click();
      await page.waitForTimeout(1000);
    }

    // Fill title
    const titleInput = page.locator('[placeholder*="title" i], [data-testid="post-title"], textarea[name="title"]').first();
    await titleInput.waitFor({ timeout: 10000 });
    await titleInput.click();
    await titleInput.fill(title);

    // Fill body text
    await page.waitForTimeout(1000);
    const bodyInput = page.locator('[data-testid="post-body"], .DraftEditor-root, [contenteditable="true"]').first();
    if (await bodyInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await bodyInput.click();
      await bodyInput.fill(text);
    } else {
      // Try textarea
      const textArea = page.locator('textarea[name="text"], [placeholder*="body" i]').first();
      if (await textArea.isVisible({ timeout: 3000 }).catch(() => false)) {
        await textArea.fill(text);
      }
    }

    await page.waitForTimeout(1500);

    // Submit
    const submitBtn = page.locator('button[type="submit"]:has-text("Post"), button:has-text("Submit"), [data-testid="post-submit"]').first();
    await submitBtn.click();
    await page.waitForTimeout(4000);

    const postUrl = page.url();
    if (postUrl.includes("/submit")) throw new Error("Post may not have submitted — still on submit page");

    console.log(`[Reddit] Posted to r/${subreddit}: ${postUrl}`);
    return postUrl;

  } finally {
    await browser.close();
  }
}

// ── Comment on a Reddit post ──────────────────────────────────────────
export async function commentOnReddit(postUrl, text) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  });
  const page = await context.newPage();

  try {
    await loginToReddit(page);

    await page.goto(postUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);

    // Click comment box
    const commentBox = page.locator('[data-testid="comment-submit-button"]').first();
    const commentArea = page.locator('[placeholder*="comment" i], [data-testid="comment-text-area"], .DraftEditor-root').first();
    await commentArea.waitFor({ timeout: 10000 });
    await commentArea.click();
    await commentArea.fill(text);
    await page.waitForTimeout(1000);

    // Submit comment
    const submitBtn = page.locator('button:has-text("Comment"), [data-testid="comment-submit-button"]').first();
    await submitBtn.click();
    await page.waitForTimeout(3000);

    console.log(`[Reddit] Comment posted on ${postUrl}`);
    return postUrl;

  } finally {
    await browser.close();
  }
}

// ── Adapt LinkedIn post to Reddit format ─────────────────────────────
export async function adaptForReddit(linkedinDraft, subreddit) {
  const rules = POSTING_SUBREDDITS[subreddit] || { tone: "helpful and practical" };
  return callAI(
    `You are adapting a LinkedIn post for Reddit r/${subreddit}.

Reddit rules:
- Tone: ${rules.tone}
- No corporate speak, no hashtags
- Reddit hates self-promotion — lead with VALUE, mention your background only at the end if relevant
- Title must make people click (question or bold statement, max 12 words)
- Body: use paragraph breaks, conversational, end with a genuine question to drive comments
- If mentioning a service/tool, frame it as "what I've been using" not "what I sell"

Return JSON:
{
  "title": "Reddit post title (max 12 words)",
  "body": "full Reddit post body (150-400 words, no hashtags)",
  "subreddit": "${subreddit}",
  "risk_of_removal": "low|medium|high",
  "risk_reason": "why it might get removed"
}`,
    `LinkedIn draft:
Hook: ${linkedinDraft.hook}
Body: ${linkedinDraft.body}
CTA: ${linkedinDraft.cta}`
  );
}

// ── Generate human-sounding Reddit comment (bypasses AI detectors) ────
// Many subreddits use AI detectors. Key: write like a real person types —
// casual, imperfect, personal, no lists, varied sentence length.
export async function generateExpertComment(post) {
  return callAI(
    `You are writing as Kirill D. — AI automation consultant in Calgary. Real person, not a bot.

Write a Reddit comment that sounds like a real human typed it quickly from experience.

CRITICAL rules to pass AI detection:
- NO numbered lists, NO bullet points — just natural paragraphs
- Mix short and long sentences. Like this. Then a much longer sentence that kind of rambles a bit because that's how people actually type when they're sharing something from memory
- Use "I" and personal experience ("ran into this with a client last month", "we tried X and it didn't work until")
- Include ONE small imperfection — a word repeated, a casual aside in parentheses, or a thought that trails off slightly
- Contractions everywhere: don't, it's, you'll, we've
- Specific real-sounding numbers: "saved maybe 11-13 hours a week" not "saved 12 hours"
- No "Furthermore", "Additionally", "In conclusion", no em dashes (—)
- End with something casual, not a polished CTA. Like "anyway, happy to dig into specifics if that's helpful" or "lmk if you want the n8n workflow, I can share the structure"
- Max 150 words total
- Sound like a 35yo founder who's been doing this for years and is used to helping people on forums

Return JSON:
{
  "comment": "the comment text, plain paragraphs only",
  "lead_potential": "low|medium|high",
  "why": "one sentence why worth commenting"
}`,
    `Post: ${post.title}\nBody: ${(post.body || "").slice(0, 500)}\nSubreddit: r/${post.subreddit}`
  );
}

// ── Send Reddit post draft to Kirill ─────────────────────────────────
export async function sendRedditDraftToKirill(adapted, originalDraft) {
  const draftId = `reddit_${Date.now()}`;
  const db = getDb();
  setIntelligence(db, "reddit", "pending_posts", draftId, { ...adapted, originalDraft, draftId }, 90);
  db.close();

  const text = [
    `📤 <b>REDDIT ПОСТ — нужно одобрение</b>`,
    `<b>r/${adapted.subreddit}</b> | Риск удаления: ${adapted.risk_of_removal}`,
    ``,
    `<b>Заголовок:</b>`,
    `<code>${adapted.title}</code>`,
    ``,
    `<b>Текст:</b>`,
    (adapted.body || "").slice(0, 800),
    adapted.risk_of_removal !== "low" ? `\n⚠️ <i>${adapted.risk_reason}</i>` : "",
  ].filter(Boolean).join("\n");

  const keyboard = { inline_keyboard: [
    [{ text: `✅ Опубликовать в r/${adapted.subreddit}`, callback_data: `post_reddit:${draftId}` }],
    [{ text: "❌ Не публиковать", callback_data: `skip_reddit:${draftId}` }],
    [{ text: "🤖 Меню", callback_data: "menu" }]
  ]};

  await tgSendToKirill(text, { reply_markup: keyboard });
  return draftId;
}

// ── Send Reddit comment to Kirill ─────────────────────────────────────
export async function sendRedditCommentToKirill(post, comment) {
  const commentId = `rcomment_${Date.now()}`;
  const db = getDb();
  setIntelligence(db, "reddit", "pending_comments", commentId, { post, comment, commentId }, 90);
  db.close();

  const text = [
    `💬 <b>ОТВЕТ НА REDDIT — нужно одобрение</b>`,
    `<b>r/${post.subreddit}</b> | Потенциал лида: ${comment.lead_potential}`,
    ``,
    `<b>Вопрос:</b> <i>${post.title}</i>`,
    ``,
    `<b>Твой ответ:</b>`,
    comment.comment,
    ``,
    `<i>${comment.why}</i>`,
  ].join("\n");

  const keyboard = { inline_keyboard: [
    [{ text: "🔗 Открыть пост", url: post.url || `https://reddit.com/r/${post.subreddit}` }],
    [{ text: "✅ Опубликовал — следи за ответами", callback_data: `confirm_reddit_post:${commentId}` }],
    [{ text: "❌ Пропустить", callback_data: `skip_reddit_comment:${commentId}` }],
    [{ text: "🤖 Меню", callback_data: "menu" }]
  ]};

  await tgSendToKirill(text, { reply_markup: keyboard });
  return commentId;
}

export function isRedditConfigured() {
  return !!(REDDIT_USERNAME && REDDIT_PASSWORD);
}
