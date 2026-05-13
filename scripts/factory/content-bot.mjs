/**
 * CONTENT BOT — Фабричный модуль
 * Получает задачи от Orchestrator и создаёт контент.
 *
 * Что умеет:
 * 1. draft_linkedin_post — пишет пост по теме/тренду от TrendBot
 * 2. draft_from_lead_pain — пишет пост о боли которую видит ScoutBot
 * 3. Отправляет черновик Кириллу на одобрение
 * 4. Записывает что создал в bot_intelligence
 *
 * Расписание: каждые 30 минут
 */

import { randomUUID } from "crypto";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import {
  getDb, BOTS, CHAT_ID, callAI, tgSend,
  claimTasks, completeTask, heartbeat,
  setIntelligence, getIntelligence, getIntelligenceKey, tgSendToKirill, logActivity,
  MODEL_DEFAULT, MODEL_MINI, reportKPIs, reportError, clearError, preflight,
  getDirectivesFor
} from "./orchestrator.mjs";

const __dirname_content = dirname(fileURLToPath(import.meta.url));
const LAST_RUN_FILE = resolve(__dirname_content, "../../.data/content-bot-last-run.json");
const COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours

const BOT_ID = "content";
const BOT_ID_FACTORY = "content_factory";

const KIRILL_VOICE = `
You write LinkedIn posts for Kirill D. — AI Automation Consultant in Calgary, Canada.
He is a SYSTEMS ARCHITECT — not a "prompt engineer", "AI enthusiast", or "automation specialist".

KIRILL'S UNIQUE TERMINOLOGY (use these exact phrases — they are his brand identity):
- "AI Orchestrator" (not "AI tool" or "AI solution")
- "digital manual laborer" (what generic AI without architecture becomes)
- "autonomous digital workforce" (what he builds for clients)
- "horizontal + vertical thinking" (his methodology — seeing both strategy and execution)
- "closed-loop architecture" (self-improving systems that learn)
- "Systems Architect" (Kirill's core identity — capitalize it)
- "autonomous ecosystems" (the end result he delivers)

VOICE: Direct, specific, zero corporate fluff. Real numbers. Short punchy sentences.
He shows results not promises. He calls out inefficiency bluntly.
Background: 10 years in operations at Ukraine's parliament — credibility shows in how he writes.
He is building the first fully autonomous business operation in Calgary.

CONTENT PILLARS (pick one per post, go deep):
- One person + the right system = entire team output
- Stop buying tools, start building ecosystems
- AI amateurs vs true Systems Architects
- Real automation replaces real people costs (with numbers)
- The difference between using AI and orchestrating AI

TONE RULES — CRITICAL:
- NEVER "5 tips", "here's how", advice lists, or how-to formats
- Strong positions only — manifesto style, provocative, takes a clear stance
- Real numbers from real cases ($, hours saved, %, headcount)
- First-person stories, not third-person observations
- End with a manifesto statement OR a question that forces the reader to choose a side
- NO: "I'm excited to share", "In today's world", "Let's talk about", "Game changer", "Thrilled"

FORMAT: hook (1 powerful line) → story/context (3-4 short lines) → insight (2-3 lines) → CTA (1 line)
Hook: must stop the scroll in first 2-4 words. The hook is a claim or a provocation.
`;

// ── Load Kirill's content feedback from intelligence DB ──────────────
function loadContentFeedback(db) {
  let purpose = "";
  try { purpose = readPurpose().slice(0, 400); } catch {}

  let rejectionReasons = [];
  let goodExamples = [];
  try {
    const raw = getIntelligenceKey(db, "content_feedback", "rejections", "reasons") || [];
    rejectionReasons = Array.isArray(raw) ? raw.filter(r => r && typeof r.reason === "string") : [];
  } catch (e) { console.warn("[ContentBot] Intelligence read failed:", e.message); }
  try {
    const raw = getIntelligenceKey(db, "content_feedback", "good_examples", "posts") || [];
    goodExamples = Array.isArray(raw) ? raw.filter(e => e && typeof e.text === "string") : [];
  } catch (e) { console.warn("[ContentBot] Intelligence read failed:", e.message); }

  let feedbackBlock = "";
  if (purpose) feedbackBlock += `\nSYSTEM PURPOSE: ${purpose}\n`;
  if (rejectionReasons.length > 0) {
    feedbackBlock += `\nKirill has REJECTED posts for these reasons — AVOID:\n`;
    feedbackBlock += rejectionReasons.slice(-8).map(r => `- "${r.reason}"`).join("\n");
  }
  if (goodExamples.length > 0) {
    feedbackBlock += `\n\nKirill's OWN past posts (study his style, tone, structure):\n`;
    feedbackBlock += goodExamples.slice(-3).map((e, i) => `[Example ${i+1}]:\n${e.text.slice(0, 400)}`).join("\n\n");
  }

  // Kirill's brand voice — unique terms, tone rules, winning formats (saved from winning post analysis)
  try {
    const brandVoice = getIntelligenceKey(db, "content_feedback", "brand_voice", "kirill_style");
    if (brandVoice) {
      feedbackBlock += `\n\nKIRILL'S BRAND IDENTITY (critical — use this to match his exact style):`;
      if (brandVoice.unique_terms?.length) {
        feedbackBlock += `\nUnique terms to use naturally: ${brandVoice.unique_terms.join(", ")}`;
      }
      if (brandVoice.tone_rules?.length) {
        feedbackBlock += `\nTone rules: ${brandVoice.tone_rules.slice(0, 5).join(" | ")}`;
      }
      if (brandVoice.winning_formats?.length) {
        feedbackBlock += `\nBest performing formats: ${brandVoice.winning_formats.join(", ")}`;
      }
      if (brandVoice.never_do?.length) {
        feedbackBlock += `\nNEVER do: ${brandVoice.never_do.slice(0, 4).join(" | ")}`;
      }
    }
  } catch (e) { console.warn("[ContentBot] Intelligence read failed:", e.message); }

  // LearnBot-generated content style rules (auto-updated daily)
  try {
    const learnedStyle = getIntelligenceKey(db, "learn-bot", "learned_rules", "content_style");
    if (learnedStyle) {
      feedbackBlock += `\n\nLEARNED STYLE RULES (from pattern analysis):`;
      if (learnedStyle.preferred_hooks?.length) feedbackBlock += `\nPreferred hooks: ${learnedStyle.preferred_hooks.join(", ")}`;
      if (learnedStyle.avoided_angles?.length) feedbackBlock += `\nAvoided angles: ${learnedStyle.avoided_angles.join(", ")}`;
      if (learnedStyle.tone) feedbackBlock += `\nTone: ${learnedStyle.tone}`;
      if (learnedStyle.topics_to_avoid?.length) feedbackBlock += `\nTopics to avoid: ${learnedStyle.topics_to_avoid.join(", ")}`;
    }
  } catch (e) { console.warn("[ContentBot] Intelligence read failed:", e.message); }

  // EvolutionBot evolved content strategy
  try {
    const evolved = getIntelligenceKey(db, "content", "strategy", "current");
    if (evolved?.description) {
      feedbackBlock += `\n\nEVOLVED CONTENT STRATEGY (from EvolutionBot): ${evolved.description.slice(0, 300)}`;
    }
  } catch {}

  // Content calendar check
  try {
    const recentPosts = db.prepare("SELECT COUNT(*) as c FROM content_calendar WHERE status = 'published' AND published_at > datetime('now', '-2 days')").get()?.c || 0;
    if (recentPosts > 0) {
      feedbackBlock += `\n\nCONTENT LIMIT: Already published ${recentPosts} post in last 2 days. Do NOT generate new post.`;
    }
  } catch {}

  // Kirill's active directives for content
  try {
    const directives = getDirectivesFor("content").filter(d => d.active);
    if (directives.length > 0) {
      feedbackBlock += `\n\nOWNER DIRECTIVES (from Kirill - HIGHEST PRIORITY):`;
      for (const d of directives) {
        feedbackBlock += `\n  [${d.action.toUpperCase()}] ${d.what}`;
      }
    }
  } catch {}

  return feedbackBlock;
}

// ── Draft a LinkedIn post about a market trend ───────────────────────
async function draftTrendPost(trend, db) {
  const feedback = db ? loadContentFeedback(db) : "";
  return callAI(
    `${KIRILL_VOICE}
Write a LinkedIn post about this emerging AI/automation trend.
Make it about business opportunity — not technology hype.
Kirill should come across as the person who already knows this and can implement it.
${feedback}
Return JSON:
{
  "hook": "first line that stops the scroll (max 12 words)",
  "body": "the post body (3-5 short paragraphs, no emojis except max 1)",
  "cta": "call to action (1 short line)",
  "hashtags": ["tag1", "tag2", "tag3"],
  "best_time": "morning|noon|evening",
  "expected_reach": "estimated reach score 1-10"
}
be brief.`,
    `Trend: ${trend.title}
Category: ${trend.category}
Hook idea from analysis: ${trend.hook}
Monetization angle: ${trend.monetization}
Source: ${trend.source}
URL: ${trend.url}`,
    MODEL_DEFAULT,
    true
  );
}

// ── Draft a post about a client pain point (from ScoutBot) ──────────
async function draftPainPost(painData, db) {
  const feedback = db ? loadContentFeedback(db) : "";
  return callAI(
    `${KIRILL_VOICE}
Write a LinkedIn post that speaks directly to this business pain.
Business owners who have this exact problem should read this and think "this is me".
Do NOT mention you can solve it in the post — just describe the pain vividly and hint at the solution.
${feedback}
Return JSON:
{
  "hook": "first line that stops the scroll (max 12 words)",
  "body": "the post body (3-5 short paragraphs)",
  "cta": "soft CTA — invite to comment or DM",
  "hashtags": ["tag1", "tag2", "tag3"],
  "best_time": "morning|noon|evening",
  "expected_reach": "1-10"
}
be brief.`,
    `Business pain pattern spotted by ScoutBot:
${painData.map(p => `- Platform: ${p.platform} | Pain: ${p.pain} | Service match: ${p.service}`).join("\n")}`,
    MODEL_DEFAULT,
    true
  );
}

// ── Draft a commentary post on trending viral content ─────────────────
// This is Kirill's best-performing format: find viral post → add Systems Architect angle
// Example: his post got 8 comments + 4 likes in 40 minutes using this formula
async function draftCommentaryPost(trendingPost, db) {
  const feedback = db ? loadContentFeedback(db) : "";
  return callAI(
    `${KIRILL_VOICE}
SPECIAL FORMAT — Kirill's highest-performing post type: commentary on viral/trending content.

The winning formula (from Kirill's post that got 8 comments + 4 likes in 40 minutes):
1. Hook: challenge the viral claim OR name what it REALLY means for business ("Everyone talks about X. Here's what they miss.")
2. Build YOUR angle: introduce a real situation with specific numbers (hours, $, headcount)
3. Name the contrast: what amateurs/companies get wrong vs what Systems Architects do
4. Use at least 1-2 of Kirill's unique terms naturally (AI Orchestrator, digital manual laborer, etc.)
5. End: strong manifesto statement OR a question that forces the reader to take a side

CRITICAL: This is NOT a reaction post. Kirill ADDS VALUE by having a stronger, more specific take.
The reader should think: "This guy sees something everyone else missed."

${feedback}
Return JSON:
{
  "hook": "first line that stops the scroll (max 12 words, must be a strong claim or provocation)",
  "body": "the post body (3-5 short paragraphs, manifesto style, real numbers)",
  "cta": "strong question or manifesto statement (1 line)",
  "hashtags": ["tag1", "tag2", "tag3"],
  "best_time": "morning|noon|evening",
  "expected_reach": "1-10"
}
be brief.`,
    `Trending content to comment on:
Title: ${trendingPost.title}
Source: ${trendingPost.source || "LinkedIn/news"}
URL: ${trendingPost.url || ""}
Key claim or idea: ${trendingPost.hook || trendingPost.summary || trendingPost.title}
Kirill's angle: Add Systems Architect perspective — what does this really mean for business owners who want to stay relevant?`,
    MODEL_DEFAULT,
    true
  );
}

// ── Simulate audience reaction (MiroFish pattern) ────────────────────
// Runs the draft through 5 LinkedIn persona AI agents before showing to Kirill.
// Gives a pre-flight engagement score + key objections to fix.
async function simulateAudienceReaction(draft) {
  const KIRILL_PERSONAS = `Be brief.
You are simulating 5 different LinkedIn followers of Kirill D. (AI Automation Consultant, Calgary).
Each persona reads the post and reacts authentically. Personas:

1. SKEPTIC_CEO — Small business owner, 45yo, tired of AI hype, has been burned by consultants before.
   "Show me ROI or don't bother." Scrolls fast. Only stops for specific numbers.

2. CURIOUS_OPS — Operations manager at a 30-person company, 35yo, knows their manual processes are slow,
   looking for solutions but not technical. Will DM if the post speaks to their exact pain.

3. TECH_FOUNDER — SaaS founder, 32yo, already uses n8n and Zapier. Respects technical credibility.
   Will comment if he disagrees or has something to add. Shares if it's genuinely insightful.

4. BUSY_CFO — Finance director, 50yo. Reads only the first line. Numbers and dollar amounts catch attention.
   Will not engage unless there's a clear business case in the first 2 sentences.

5. WARM_LEAD — Owner of a 10-person Calgary accounting firm who already follows Kirill,
   has thought about automation but hasn't pulled the trigger yet. Looking for a sign to reach out.
`;

  try {
    const result = await callAI(
      `${KIRILL_PERSONAS}

For each persona, simulate their reaction to this LinkedIn post.
Then give an overall pre-flight score.

Return JSON only:
{
  "personas": [
    { "name": "SKEPTIC_CEO",   "stops_scrolling": true/false, "reaction": "one sentence", "would": "ignore|like|comment|DM|share" },
    { "name": "CURIOUS_OPS",   "stops_scrolling": true/false, "reaction": "one sentence", "would": "ignore|like|comment|DM|share" },
    { "name": "TECH_FOUNDER",  "stops_scrolling": true/false, "reaction": "one sentence", "would": "ignore|like|comment|DM|share" },
    { "name": "BUSY_CFO",      "stops_scrolling": true/false, "reaction": "one sentence", "would": "ignore|like|comment|DM|share" },
    { "name": "WARM_LEAD",     "stops_scrolling": true/false, "reaction": "one sentence", "would": "ignore|like|comment|DM|share" }
  ],
  "hook_verdict": "strong|weak|average",
  "biggest_risk": "one sentence — what will kill engagement",
  "biggest_strength": "one sentence — what will drive engagement",
  "predicted_leads": 0-3,
  "preflight_score": 1-10
}
be brief.`,
      `POST TO EVALUATE:
Hook: ${draft.hook}
Body: ${(draft.body || "").slice(0, 600)}
CTA: ${draft.cta}`,
      MODEL_DEFAULT,
      true
    );
    return result;
  } catch {
    return null;
  }
}

// ── Format simulation block for Telegram ─────────────────────────────
function formatSimulation(sim) {
  if (!sim) return "";
  const reactionEmoji = { ignore: "😶", like: "👍", comment: "💬", DM: "📩", share: "🔁" };
  const scoreEmoji = sim.preflight_score >= 8 ? "🟢" : sim.preflight_score >= 6 ? "🟡" : "🔴";
  const lines = [
    ``,
    `<b>🎭 Симуляция аудитории (pre-flight):</b>`,
  ];
  for (const p of (sim.personas || [])) {
    const emoji = reactionEmoji[p.would] || "•";
    const scroll = p.stops_scrolling ? "✋" : "→";
    lines.push(`${scroll} <b>${p.name}</b>: ${emoji} ${p.reaction}`);
  }
  lines.push(``);
  lines.push(`${scoreEmoji} <b>Оценка: ${sim.preflight_score}/10</b> | Хук: ${sim.hook_verdict}`);
  lines.push(`⚠️ Риск: <i>${sim.biggest_risk}</i>`);
  lines.push(`💡 Сила: <i>${sim.biggest_strength}</i>`);
  if (sim.predicted_leads > 0) lines.push(`🎯 Прогноз лидов: ${sim.predicted_leads}`);
  return lines.join("\n");
}

// ── Send draft to Kirill for approval ────────────────────────────────
async function sendDraftToKirill(draft, taskType, sourceInfo, sourceUrl = null) {
  const postId = `draft_${Date.now()}`;
  const sourceLabel = taskType === "draft_linkedin_post" ? "📡 Тренд"
    : taskType === "draft_commentary_post" ? "📣 Комментарий к тренду"
    : taskType === "draft_market_post" ? "🌍 Рынок"
    : "🔍 Боль клиентов";

  // Run audience simulation before sending (MiroFish pattern)
  const simulation = await simulateAudienceReaction(draft);
  const simBlock = formatSimulation(simulation);

  const text = [
    `✍️ <b>НОВЫЙ ЧЕРНОВИК ПОСТА</b>`,
    `<i>${sourceLabel}: ${sourceInfo}</i>`,
    ``,
    `<b>Hook (первая строка):</b>`,
    `<code>${draft.hook}</code>`,
    ``,
    `<b>Тело:</b>`,
    draft.body,
    ``,
    `<b>CTA:</b> <i>${draft.cta}</i>`,
    ``,
    `<b>Хэштеги:</b> ${(draft.hashtags || []).map(h => `#${h}`).join(" ")}`,
    `<b>Лучшее время:</b> ${draft.best_time} | <b>Охват:</b> ${draft.expected_reach}/10`,
    simBlock,
  ].join("\n");

  const keyboard = { inline_keyboard: [
    [{ text: "✅ Опубликовал в LinkedIn", callback_data: `mark_published:${postId}` }],
    [{ text: "📤 Адаптировать для Reddit", callback_data: `adapt_reddit:${postId}` }],
    [{ text: "🖼 Найти фото к посту", callback_data: `get_image:${postId}` }],
    [{ text: "❌ Не публикую — скажу почему", callback_data: `not_publishing:${postId}` }],
    [
      { text: "📋 Все посты", callback_data: "show_posts" },
      { text: "🤖 Меню", callback_data: "menu" }
    ]
  ]};

  await tgSendToKirill(text, { reply_markup: keyboard });

  // Save post meta so image finder can use hook + sourceUrl
  setIntelligence(getDb(), "content", "post_meta", postId, {
    hook: draft.hook,
    body: (draft.body || "").slice(0, 300),
    sourceInfo,
    sourceUrl,
    createdAt: new Date().toISOString()
  }, 90);

  return postId;
}

// ── Main ContentBot run ───────────────────────────────────────────────
async function runContentFactory() {
  // 6-hour cooldown: skip if ran recently (saves API calls when nothing to do)
  try {
    if (existsSync(LAST_RUN_FILE)) {
      const lastRun = JSON.parse(readFileSync(LAST_RUN_FILE, "utf-8"));
      const elapsed = Date.now() - new Date(lastRun.ran_at).getTime();
      if (elapsed < COOLDOWN_MS) {
        console.log(`[ContentBot] Cooldown: ran ${(elapsed / 60000).toFixed(0)}min ago, need ${(COOLDOWN_MS / 60000).toFixed(0)}min gap. Exiting.`);
        return;
      }
    }
  } catch {}

  const db = getDb();
  heartbeat(db, BOT_ID_FACTORY, "ContentBot", "checking tasks");

  // Обрабатываем задачи от Orchestrator
  const tasks = claimTasks(db, BOT_ID_FACTORY);
  let postsCreated = 0;

  for (const task of tasks) {
    try {
      if (task.task_type === "draft_linkedin_post") {
        // Dedup: skip if we already drafted a post about this exact topic in the last 24h
        const topicKey = Buffer.from(task.payload.title || "").toString("base64").slice(-20);
        const alreadyDrafted = getIntelligence(db, "content", "posts_drafted")
          .find(i => {
            if (i.key !== `topic_${topicKey}`) return false;
            const age = Date.now() - new Date(JSON.parse(i.value_json).drafted_at).getTime();
            return age < 24 * 60 * 60 * 1000;
          });
        if (alreadyDrafted) {
          console.log(`[ContentBot] Skipping duplicate topic: ${task.payload.title}`);
          completeTask(db, task.id);
          continue;
        }

        console.log(`[ContentBot] Drafting trend post: ${task.payload.title}`);
        const draft = await draftTrendPost(task.payload, db);
        const postId = await sendDraftToKirill(draft, task.task_type, task.payload.title, task.payload.url);
        await logActivity(db, "content", `Черновик поста готов: "<b>${(draft.hook || "").slice(0, 60)}</b>" → отправил тебе`);

        // Сохраняем в общую память
        setIntelligence(db, "content", "posts_drafted", postId, {
          type: "trend",
          hook: draft.hook,
          source: task.payload.title,
          drafted_at: new Date().toISOString()
        }, 90);
        // Store topic key for dedup
        setIntelligence(db, "content", "posts_drafted", `topic_${topicKey}`, {
          title: task.payload.title,
          drafted_at: new Date().toISOString()
        }, 100);
        postsCreated++;
      }

      if (task.task_type === "draft_from_lead_pain") {
        // Dedup: don't draft pain posts more than once per 6h
        const recentPain = getIntelligence(db, "content", "posts_drafted")
          .find(i => {
            try {
              const v = JSON.parse(i.value_json);
              if (v.type !== "pain") return false;
              return Date.now() - new Date(v.drafted_at).getTime() < 6 * 60 * 60 * 1000;
            } catch { return false; }
          });
        if (recentPain) {
          console.log(`[ContentBot] Skipping pain post — already drafted one in last 6h`);
          completeTask(db, task.id);
          continue;
        }

        console.log(`[ContentBot] Drafting pain post from Scout insights`);
        const draft = await draftPainPost(task.payload.pains, db);
        const postId = await sendDraftToKirill(draft, task.task_type, "боли из ScoutBot");
        await logActivity(db, "content", `Пост о болях клиентов готов: "<b>${(draft.hook || "").slice(0, 60)}</b>"`);

        setIntelligence(db, "content", "posts_drafted", postId, {
          type: "pain", hook: draft.hook, drafted_at: new Date().toISOString()
        }, 80);
        postsCreated++;
      }

      // Commentary on trending/viral content — Kirill's highest-performing format
      if (task.task_type === "draft_commentary_post") {
        // Dedup: don't draft commentary post more than once per 4h
        const recentCommentary = getIntelligence(db, "content", "posts_drafted")
          .find(i => {
            try {
              const v = JSON.parse(i.value_json);
              if (v.type !== "commentary") return false;
              return Date.now() - new Date(v.drafted_at).getTime() < 4 * 60 * 60 * 1000;
            } catch { return false; }
          });
        if (recentCommentary) {
          console.log(`[ContentBot] Skipping commentary post — already drafted one in last 4h`);
          completeTask(db, task.id);
          continue;
        }

        console.log(`[ContentBot] Drafting commentary post on: ${task.payload.title}`);
        const draft = await draftCommentaryPost(task.payload, db);
        const postId = await sendDraftToKirill(
          draft,
          "draft_commentary_post",
          `📣 Комментарий к тренду: ${(task.payload.title || "").slice(0, 60)}`,
          task.payload.url
        );
        await logActivity(db, "content", `Пост-комментарий готов: "<b>${(draft.hook || "").slice(0, 60)}</b>" → отправил тебе`);

        setIntelligence(db, "content", "posts_drafted", postId, {
          type: "commentary", hook: draft.hook, source: task.payload.title,
          drafted_at: new Date().toISOString()
        }, 90);
        postsCreated++;
      }

      if (task.task_type === "strategy_update") {
        console.log(`[ContentBot] Strategy update: ${task.payload.action}`);
        await logActivity(db, "content", `Получил стратегическую директиву от AnalyticsBot: ${(task.payload.action || "").slice(0, 80)}`);
        setIntelligence(db, "content", "strategy", "latest_directive", {
          action: task.payload.action, reason: task.payload.reason,
          received_at: new Date().toISOString()
        }, 85);
      }

      // PRBot: пост для конкретного рынка — привлечь founders из целевой страны
      if (task.task_type === "draft_market_post") {
        const { market, angle, instructions } = task.payload;
        console.log(`[ContentBot] Drafting market-targeted post for: ${market}`);

        const draft = await callAI(
          `${KIRILL_VOICE}
Write a LinkedIn post specifically for business owners in ${market}.
Goal: founders from ${market} see this post → recognise their pain → DM Kirill.
${instructions || ""}

Rules:
- Start with a hook that names a specific industry or challenge common in ${market}
- Show you understand their local market (mention something specific to ${market} if you know it)
- One clear insight about AI/automation that solves their problem
- End with a question directed at ${market} founders specifically
- 150-200 words max
Return JSON: { "hook": "...", "body": "...", "cta": "...", "hashtags": ["tag1","tag2","tag3"] }
be brief.`,
          `Market: ${market}\nAngle: ${angle || "AI automation for SMB owners"}`
        );

        const postId = await sendDraftToKirill(draft, "draft_market_post", `${market} — market post`);
        await logActivity(db, "content", `Пост для рынка <b>${market}</b> готов → опубликуй, чтобы founders оттуда тебя нашли`);

        setIntelligence(db, "content", "posts_drafted", postId || `market_${Date.now()}`, {
          type: "market_post", market, hook: draft?.hook,
          drafted_at: new Date().toISOString()
        }, 80);
        postsCreated++;
      }

      // Кейс-стади после завершения проекта → замыкает петлю
      if (task.task_type === "draft_case_study") {
        const { clientName, serviceType, amount, painDescription } = task.payload;
        console.log(`[ContentBot] Drafting case study for ${clientName}`);
        await logActivity(db, "content", `Пишу кейс-стади для клиента <b>${clientName}</b>...`);

        const caseDraft = await callAI(
          `${KIRILL_VOICE}
Write a LinkedIn case study post. Real results. Specific numbers. Client stays anonymous (use "a client").
Format: Problem (1-2 lines) → What was built (2-3 lines) → Results in numbers (2-3 lines) → insight
Hook must be the RESULT — e.g., "Cut 40 hours/month of manual work."
Return JSON: { "hook": "...", "body": "...", "cta": "...", "hashtags": ["tag1","tag2","tag3"] }
be brief.`,
          `Service delivered: ${serviceType}
Client pain: ${painDescription}
Deal value: $${amount} CAD
Focus on: what was automated, time saved, ROI`
        );

        const casePostId = `case_${Date.now()}`;
        const caseText = [
          `✍️ <b>КЕЙС-СТАДИ ГОТОВ</b>`,
          `<i>Клиент: ${clientName}</i>`, ``,
          `<b>Hook:</b>`, `<code>${caseDraft.hook}</code>`, ``,
          `<b>Текст:</b>`, caseDraft.body, ``,
          `<b>CTA:</b> <i>${caseDraft.cta}</i>`, ``,
          `<b>Хэштеги:</b> ${(caseDraft.hashtags || []).map(h => `#${h}`).join(" ")}`, ``,
          `<b>Скопируй и опубликуй в LinkedIn.</b>`,
          `После публикации: /post_published ${casePostId}`
        ].join("\n");

        await tgSendToKirill(caseText);
        await logActivity(db, "content", `Кейс-стади для ${clientName} отправлен тебе → опубликуй и петля замкнётся`);

        setIntelligence(db, "content", "posts_drafted", casePostId, {
          type: "case_study", clientName, hook: caseDraft.hook,
          drafted_at: new Date().toISOString()
        }, 95);
        postsCreated++;
      }

      completeTask(db, task.id);
    } catch (err) {
      console.warn(`[ContentBot] Task ${task.task_type} error: ${err.message}`);
    }
  }

  // Записываем статистику в общую память
  setIntelligence(db, "content", "activity", "last_run_at", new Date().toISOString(), 100);
  setIntelligence(db, "content", "activity", "posts_drafted_today", postsCreated, 100);

  // KPI репорт для EvolutionBot
  const publishedCount = (() => { try { return db.prepare("SELECT COUNT(*) as c FROM published_posts WHERE status='published' AND published_at > datetime('now', '-7 days')").get()?.c || 0; } catch { return 0; }})();
  const rejectedCount = (() => { try { return db.prepare("SELECT COUNT(*) as c FROM published_posts WHERE status='rejected' AND updated_at > datetime('now', '-7 days')").get()?.c || 0; } catch { return 0; }})();
  reportKPIs(db, "content", {
    leads_found: 0,
    leads_qualified: 0,
    tasks_completed: postsCreated,
    errors: 0,
    custom: {
      drafts_created: postsCreated,
      published_last_7d: publishedCount,
      rejected_last_7d: rejectedCount,
      approval_rate: (publishedCount + rejectedCount) > 0 ? (publishedCount / (publishedCount + rejectedCount) * 100).toFixed(1) : 0
    }
  });

  heartbeat(db, BOT_ID_FACTORY, "ContentBot", `done — ${postsCreated} drafts created`, {
    tasks: tasks.length, posts: postsCreated
  }, {
    status: postsCreated > 0 ? "ok" : "degraded",
    last_success_at: postsCreated > 0 ? new Date().toISOString() : null,
    error: null
  });
  try { clearError(db, BOT_ID_FACTORY); } catch {}
  try { clearError(db, BOT_ID); } catch {}

  // Record last run time for cooldown
  try { writeFileSync(LAST_RUN_FILE, JSON.stringify({ ran_at: new Date().toISOString(), posts: postsCreated })); } catch {}

  db.close();
  console.log(`[ContentBot] Done. ${postsCreated} posts drafted.`);
}

// ── LIVING MODE ───────────────────────────────────────────────────────────────

async function runLivingMode() {
  const { pollMessages, markMessageActedOn, heartbeat } = await import("./orchestrator.mjs");

  console.log(`[ContentBot] Starting in living mode — listening for messages...`);

  // Preflight — callAI uses Claude CLI subprocess, no API key needed
  // (OpenAI preflight removed — system migrated to Claude CLI)

  while (true) {
    try {
      const db = getDb();

      // Poll messages from other bots
      const messages = pollMessages(db, "content-bot", 5);

      for (const msg of messages) {
        console.log(`[ContentBot] Message from ${msg.from_bot}: ${msg.message_type}`);

        if (msg.message_type === "create_marketing") {
          // MarketBot нашёл покупателей → создать маркетинговые материалы
          await handleCreateMarketing(db, msg);
          markMessageActedOn(db, msg.id, { marketing_created: true });
        }

        if (msg.message_type === "trend_signal") {
          // TrendBot нашёл тренд → написать пост
          await handleTrendSignal(db, msg);
          markMessageActedOn(db, msg.id, { trend_post_created: true });
        }

        if (msg.message_type === "update_positioning") {
          // MarketBot обнаружил изменения на рынке → обновить позиционирование
          await handleUpdatePositioning(db, msg);
          markMessageActedOn(db, msg.id, { positioning_updated: true });
        }
      }

      heartbeat(db, "content-bot", "ContentBot", "listening for messages", {
        messages_processed: messages.length
      });

      db.close();
    } catch (err) {
      console.error(`[ContentBot] Error in living mode:`, err.message);
      try { const edb = getDb(); reportError(edb, BOT_ID, "ContentBot", err.message, "crash", "liveMode"); edb.close(); } catch {}
    }

    await new Promise(r => setTimeout(r, 10000)); // Poll every 10 seconds
  }
}

async function handleCreateMarketing(db, msg) {
  const { product, buyers, icp } = msg.payload;

  console.log(`[ContentBot] Creating marketing materials for: ${product}`);

  // Генерируем пост для LinkedIn (упрощённый промпт)
  let marketingPost;
  try {
    marketingPost = await callAI(
      `Create a LinkedIn post for this product. Return JSON with: hook, body, cta\nbe brief.`,
      `Product: ${product}\nAudience: ${icp}\nChannels: ${buyers.slice(0, 3).map(b => b.platform).join(", ")}`,
      MODEL_DEFAULT
    );
  } catch (err) {
    console.log(`[ContentBot] API error:`, err.message);
    try { const edb = getDb(); reportError(edb, BOT_ID, "ContentBot", err.message, "api", "handleCreateMarketing"); edb.close(); } catch {}
    return;
  }

  // callAI returns parsed object when json=true
  let draft = null;
  if (typeof marketingPost === 'object' && marketingPost !== null) {
    // Check if it has the expected structure
    if (marketingPost.hook && marketingPost.body) {
      draft = marketingPost;
    } else if (marketingPost.post) {
      // Fallback: if it returned {post: "..."}, split it
      const lines = marketingPost.post.split('\n\n');
      draft = {
        hook: lines[0] || '',
        body: lines.slice(1, -1).join('\n\n') || marketingPost.post,
        cta: lines[lines.length - 1] || 'DM me to learn more'
      };
    } else {
      // Last resort: use whatever we got
      draft = {
        hook: product,
        body: JSON.stringify(marketingPost),
        cta: 'Interested? Let me know.'
      };
    }
  }

  if (!draft || !draft.hook) {
    console.log(`[ContentBot] Failed to generate marketing post - invalid structure:`, marketingPost);
    return;
  }

  console.log(`[ContentBot] Draft ready: ${draft.hook.slice(0, 50)}...`);

  // Отправить Кириллу
  const postId = await sendDraftToKirill(draft, "product_launch", product);

  setIntelligence(db, "content", "marketing_posts", postId, {
    product,
    buyers: buyers.length,
    drafted_at: new Date().toISOString()
  }, 85);

  await logActivity(db, "content", `Маркетинговый пост для "${product}" готов → отправил тебе`);
}

async function handleTrendSignal(db, msg) {
  const { title, hook, monetization, category, url, target_client, business_problem } = msg.payload;

  console.log(`[ContentBot] Creating trend post: ${title}`);

  // Генерируем пост о тренде
  let trendPost;
  try {
    trendPost = await callAI(
      `${KIRILL_VOICE}

Write a LinkedIn post about this new tool/trend. Show how Kirill would use it for clients.

STRUCTURE:
- Hook: Why this tool matters NOW (1-2 sentences, specific)
- Body: How Kirill would integrate it into client systems (2-3 concrete examples)
- CTA: Clear next step

Return JSON: {hook, body, cta}
be brief.`,
      `Tool: ${title}
Hook idea: ${hook}
How to monetize: ${monetization}
Target client: ${target_client}
Problem it solves: ${business_problem}
Category: ${category}
URL: ${url}`,
      MODEL_DEFAULT
    );
  } catch (err) {
    console.log(`[ContentBot] API error:`, err.message);
    try { const edb = getDb(); reportError(edb, BOT_ID, "ContentBot", err.message, "api", "handleTrendSignal"); edb.close(); } catch {}
    return;
  }

  let draft = null;
  if (typeof trendPost === 'object' && trendPost !== null) {
    if (trendPost.hook && trendPost.body) {
      draft = trendPost;
    } else if (trendPost.post) {
      const lines = trendPost.post.split('\n\n');
      draft = {
        hook: lines[0] || '',
        body: lines.slice(1, -1).join('\n\n') || trendPost.post,
        cta: lines[lines.length - 1] || 'DM me to discuss'
      };
    }
  }

  if (!draft || !draft.hook) {
    console.log(`[ContentBot] Failed to generate trend post`);
    return;
  }

  console.log(`[ContentBot] Trend post ready: ${draft.hook.slice(0, 50)}...`);

  // Отправить Кириллу
  const postId = await sendDraftToKirill(draft, "trend", title);

  setIntelligence(db, "content", "trend_posts", postId, {
    trend: title,
    category,
    url,
    drafted_at: new Date().toISOString()
  }, 85);

  await logActivity(db, "content", `Пост о тренде "${title}" готов → отправил тебе`);
}

async function handleUpdatePositioning(db, msg) {
  const { product, changes } = msg.payload;

  console.log(`[ContentBot] Updating positioning for: ${product}`);

  // Получить текущие посты о продукте
  const existingPosts = getIntelligence(db, "content", "marketing_posts")
    .filter(i => {
      try {
        const v = JSON.parse(i.value_json);
        return v.product === product;
      } catch { return false; }
    });

  if (existingPosts.length === 0) {
    console.log(`[ContentBot] No existing posts for ${product}, skipping positioning update`);
    return;
  }

  // Генерируем обновлённый пост
  const updatedPost = await callAI(
    `Be brief.
You are a marketing strategist. Update the positioning of this product based on market feedback.

Product: ${product}
Market changes: ${JSON.stringify(changes)}

Rewrite the positioning to:
- Address the new market reality
- Emphasize what competitors are missing
- Keep Kirill's voice: direct, systems architect, no fluff
be brief.`,
    JSON.stringify({ product, changes }),
    MODEL_DEFAULT
  );

  // callAI returns parsed object when json=true
  let draft = null;
  if (typeof updatedPost === 'object' && updatedPost !== null) {
    draft = updatedPost;
  }

  if (!draft || !draft.hook) {
    console.log(`[ContentBot] Failed to update positioning`);
    return;
  }

  // Отправить Кириллу
  const postId = await sendDraftToKirill(draft, "positioning_update", product);

  setIntelligence(db, "content", "positioning_updates", postId, {
    product,
    changes: changes.length,
    updated_at: new Date().toISOString()
  }, 85);

  await logActivity(db, "content", `Обновил позиционирование для "${product}" → новый пост отправил`);
}

// ── ENTRY POINT ───────────────────────────────────────────────────────────────

import { fileURLToPath as _ftu } from "url";
import { readPurpose, getWikiContext, appendLog } from "../../wiki/reader.mjs";
if (process.argv[1] === _ftu(import.meta.url)) {
  const mode = process.argv[2];
  if (mode === "live") {
    runLivingMode().catch(console.error);
  } else {
    runContentFactory().catch(console.error);
  }
}

export { runContentFactory };
