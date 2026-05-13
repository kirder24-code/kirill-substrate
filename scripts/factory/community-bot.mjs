/**
 * COMMUNITY BOT — n8n Community Expert Presence
 *
 * Every 2 hours:
 * 1. Fetches new questions from community.n8n.io (Discourse JSON API — no auth needed)
 * 2. AI filters: Is this something Kirill can BUILD if client hires him?
 * 3. AI writes expert answer (not generic — real solution)
 * 4. Sends to Kirill with [✅ Опубликую] [❌ Пропустить] buttons
 * 5. Kirill copies → pastes → 30 seconds
 *
 * Why this matters: every answer is seen by hundreds of people googling the same problem.
 * Expert answers → people DM Kirill → consulting project.
 *
 * IMPORTANT: AI scoring uses gpt-4o (must evaluate technical feasibility)
 * Answer writing uses gpt-4o (quality matters — this is public)
 */

import { getDb, callAI, tgSendToKirill, heartbeat, sendMessage, setIntelligence, getIntelligenceKey, env, MODEL_STRONG, reportError, clearError } from "./orchestrator.mjs";

const BOT_NAME = "community-bot";
const FORUM_BASE = "https://community.n8n.io";
const SEEN_WINDOW_HOURS = 48; // don't show same question twice

// Discourse API credentials — set these in .env to enable auto-posting
// N8N_DISCOURSE_API_KEY = get from community.n8n.io → Settings → API → Generate Key
// N8N_DISCOURSE_USERNAME = your forum username (e.g. "Ok-Serve4908" or your n8n forum handle)
const DISCOURSE_KEY = env.N8N_DISCOURSE_API_KEY;
const DISCOURSE_USER = env.N8N_DISCOURSE_USERNAME;

// ── Auto-post reply to n8n Community topic ──────────────────────────
// Returns true if posted, false if no credentials (falls back to manual)
export async function postToDiscourse(topicId, message) {
  if (!DISCOURSE_KEY || !DISCOURSE_USER) return false;
  try {
    const res = await fetch(`${FORUM_BASE}/posts.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Api-Key": DISCOURSE_KEY,
        "Api-Username": DISCOURSE_USER,
      },
      body: JSON.stringify({ topic_id: Number(topicId), raw: message }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error(`[CommunityBot] Discourse post failed ${res.status}: ${err.slice(0, 200)}`);
      return false;
    }
    const data = await res.json();
    console.log(`[CommunityBot] ✅ Auto-posted to topic ${topicId}, post id: ${data.id}`);
    return true;
  } catch (err) {
    console.error(`[CommunityBot] Discourse error: ${err.message}`);
    return false;
  }
}

// ── Auto-reply to n8n Community job posts (leads in DB) ──────────────
// Runs daily: takes leads from n8n_community with clean notes → posts reply automatically
// TODO: Extract autoReplyToJobPosts into separate bot - it targets hiring companies
// (different ICP) vs community answering which targets help-seekers. Running both in
// same file conflates different ICPs.
export async function autoReplyToJobPosts(db) {
  if (!DISCOURSE_KEY || !DISCOURSE_USER) {
    console.log(`[CommunityBot] No Discourse credentials — skipping auto-reply to job posts`);
    console.log(`[CommunityBot] Add N8N_DISCOURSE_API_KEY + N8N_DISCOURSE_USERNAME to .env`);
    return 0;
  }

  // Get n8n community leads with clean notes, not yet replied
  const leads = db.prepare(`
    SELECT id, name, source_url, notes FROM leads
    WHERE source_platform IN ('n8n_community', 'web')
    AND source_url LIKE '%community.n8n.io%'
    AND stage IN ('new', 'briefed')
    AND notes IS NOT NULL AND LENGTH(notes) > 50
    ORDER BY score DESC LIMIT 5
  `).all();

  if (!leads.length) return 0;

  let posted = 0;
  for (const lead of leads) {
    // Extract topic ID from URL
    const topicIdMatch = lead.source_url.match(/\/(\d+)(?:[/?#]|$)/);
    if (!topicIdMatch) continue;
    const topicId = topicIdMatch[1];

    // Check if already replied
    const alreadyReplied = getIntelligenceKey(db, BOT_NAME, "job_replies", topicId);
    if (alreadyReplied) continue;

    const success = await postToDiscourse(topicId, lead.notes);
    if (success) {
      // Mark as contacted in leads table
      db.prepare(`UPDATE leads SET stage='contacted', last_contact_at=?, next_followup_at=?, updated_at=? WHERE id=?`)
        .run(new Date().toISOString(), new Date(Date.now() + 48 * 3600000).toISOString(), new Date().toISOString(), lead.id);
      // Save that we replied
      setIntelligence(db, BOT_NAME, "job_replies", topicId, {
        leadId: lead.id, postedAt: new Date().toISOString(), topicId
      }, 100);
      await tgSendToKirill(
        `🤖 <b>Система автоответила в n8n Community</b>\n\n` +
        `<b>Тред:</b> ${lead.name.slice(0, 60)}\n` +
        `<b>Сообщение:</b> <i>${lead.notes.slice(0, 200)}</i>\n\n` +
        `<a href="${lead.source_url}">Посмотреть тред →</a>`
      );
      posted++;
      await new Promise(r => setTimeout(r, 3000)); // rate limit
    }
  }

  console.log(`[CommunityBot] Auto-replied to ${posted} job posts`);
  return posted;
}

// Kirill's actual skill set — what he can BUILD for a paying client
const KIRILL_CAN_BUILD = `
- n8n workflows: any trigger, any integration, complex multi-step automation
- AI agents: OpenAI/Claude API, tool use, memory, multi-step reasoning
- Data pipelines: Google Sheets, Airtable, Notion, HubSpot, PostgreSQL, SQLite
- Integrations: REST APIs, webhooks, OAuth, email (SMTP/IMAP), Telegram bots
- Web scraping: Playwright, Puppeteer, Apify
- Scheduling: cron jobs, time-based triggers
- Error handling: retry logic, fallbacks, alerting
- Deployment: self-hosted n8n on VPS, Docker, Railway, Render
- LLM integration: OpenAI, Claude, Ollama (local), LangChain patterns
- File processing: PDF, CSV, images, documents
`;

// ─── DISCOURSE API ────────────────────────────────────────────────────────────

async function fetchLatestQuestions() {
  try {
    const res = await fetch(`${FORUM_BASE}/c/questions.json?page=0`, {
      headers: { "User-Agent": "n8n-community-reader/1.0" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data.topic_list?.topics || []).filter(t =>
      !t.pinned && t.posts_count >= 1
    );
  } catch (err) {
    console.error(`[CommunityBot] Failed to fetch questions: ${err.message}`);
    return [];
  }
}

async function fetchQuestionDetail(topicId) {
  try {
    const res = await fetch(`${FORUM_BASE}/t/${topicId}.json`, {
      headers: { "User-Agent": "n8n-community-reader/1.0" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const firstPost = data.post_stream?.posts?.[0];
    return {
      title: data.title,
      body: firstPost?.cooked?.replace(/<[^>]+>/g, " ").slice(0, 2000) || "",
      url: `${FORUM_BASE}/t/${data.slug}/${topicId}`,
      topicId: topicId,
      replyCount: data.posts_count - 1,
      createdAt: data.created_at,
    };
  } catch {
    return null;
  }
}

// ─── AI SCORING — gpt-4o ─────────────────────────────────────────────────────

async function callAIWithRetry(prompt, context, model, maxAttempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) console.log(`[CommunityBot] STREAM_RETRY attempt=${attempt}`);
    try {
      const result = await Promise.race([
        callAI(prompt, context, model),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Stream idle timeout - 300s exceeded')), 300000))
      ]);
      // Same fix as evolution-bot (2026-05-13): callAI may return object, not string.
      const resultStr = typeof result === 'string' ? result :
        (result?.text || result?.answer || result?.content || (result ? JSON.stringify(result) : ""));
      if (resultStr && !resultStr.includes('Stream idle timeout')) return result;
      lastError = new Error(resultStr.includes('Stream idle timeout') ? 'Stream idle timeout' : 'empty response');
    } catch (err) {
      lastError = err;
      console.warn(`[CommunityBot] callAI attempt ${attempt}/${maxAttempts} failed: ${err.message}`);
    }
    if (attempt < maxAttempts) {
      const delay = lastError?.message?.includes('Stream idle timeout') ? 30000 : 5000;
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw lastError || new Error("callAI failed after all retries");
}

async function scoreQuestion(question) {
  const result = await callAIWithRetry(
    `You are evaluating whether an automation consultant should answer this n8n community question.

Evaluate TWO things:
1. CAN_BUILD: Could Kirill actually BUILD a solution for this person if they hired him? (not just answer the forum question — but deliver a real working system)
2. ANSWER_QUALITY: Can we write a specific, helpful technical answer (not vague or generic)?

Kirill's skills:
${KIRILL_CAN_BUILD}

Return JSON:
{
  "can_build": true/false,
  "answer_quality": "high|medium|low",
  "score": 0-100,
  "why": "one sentence",
  "problem_summary": "what they actually need in plain English",
  "service_type": "what Kirill would charge for if they hired him"
}

Score 70+ = send to Kirill. Score below 70 = skip.
Skip if: pure bug report, n8n Cloud billing issue, licensing, UI glitch, or something Kirill can't build.`,
    `Title: ${question.title}\n\nBody: ${question.body}`,
    MODEL_STRONG
  );

  // callAI may return object (with .text/.answer/.content) or string. Coerce.
  const resultStr = typeof result === 'string' ? result :
    (result?.text || result?.answer || result?.content || (result ? JSON.stringify(result) : ""));
  try {
    const json = resultStr.match(/\{[\s\S]*\}/)?.[0];
    return json ? JSON.parse(json) : null;
  } catch {
    if (resultStr) {
      const lastBrace = resultStr.lastIndexOf('}');
      if (lastBrace >= 0) try { return JSON.parse(resultStr.slice(0, lastBrace + 1)); } catch {}
    }
    return null;
  }
}

// ─── ANSWER WRITING — gpt-4o ─────────────────────────────────────────────────

async function writeExpertAnswer(question, scoring) {
  const answer = await callAIWithRetry(
    `You are writing a reply on the n8n Community forum (Discourse). This is a REAL community with strict moderation — spam, self-promotion, or AI-sounding text will get the account banned.

You are Kirill — you actually use n8n daily, build workflows for clients, and have hands-on experience.

CRITICAL RULES:
- Write like a real person on a forum, not an AI assistant. Short sentences. Casual tone. "I ran into this too" not "This is a common challenge"
- Give the ACTUAL technical answer — specific nodes, settings, expressions, code snippets if needed
- If you mention a workaround — say you've used it yourself ("what worked for me was..." not "you could try...")
- NO self-promotion. NO "I do this professionally". NO links to services. NO "feel free to reach out"
- NO generic advice like "check the documentation" or "there are several approaches"
- If you don't know the exact answer — don't fake it. Better to share a partial solution than a wrong one
- Keep it under 200 words. Forum answers that are too long look like AI
- Use code blocks for any n8n expressions or JSON
- Mix sentence lengths. Start some with lowercase. Use contractions (it's, don't, I've)
- One small imperfection is OK — a tangent, a "well actually", an "edit: forgot to mention"

The goal is to be genuinely helpful and build reputation over time. NOT to get a client from this answer.`,
    `Question title: ${question.title}

Question body: ${question.body}

What they actually need: ${scoring.problem_summary}`,
    MODEL_STRONG
  );

  return answer;
}

// ─── SEEN TRACKING ────────────────────────────────────────────────────────────

function isAlreadySeen(db, topicId) {
  const key = getIntelligenceKey(db, BOT_NAME, "seen_questions", String(topicId));
  if (!key) return false;
  const seenAt = new Date(key);
  const hoursDiff = (Date.now() - seenAt.getTime()) / 3600000;
  return hoursDiff < SEEN_WINDOW_HOURS;
}

function markSeen(db, topicId) {
  setIntelligence(db, BOT_NAME, "seen_questions", String(topicId), new Date().toISOString());
}

// ─── TELEGRAM CARD ───────────────────────────────────────────────────────────

async function sendQuestionCard(db, question, scoring, answer) {
  const cardId = `community_${question.topicId}`;

  const text =
    `💬 *n8n Community — вопрос который стоит ответить*\n\n` +
    `*${question.title}*\n` +
    `Score: ${scoring.score}/100 | Ответов уже: ${question.replyCount}\n\n` +
    `*Что им нужно:* ${scoring.problem_summary}\n` +
    `*Если наймут:* ${scoring.service_type}\n\n` +
    `───────────────\n` +
    `*Готовый ответ:*\n\n${answer}\n` +
    `───────────────\n` +
    `[Открыть вопрос](${question.url})`;

  const keyboard = {
    inline_keyboard: [[
      { text: "✅ Опубликую", callback_data: `community_post:${question.topicId}` },
      { text: "❌ Пропустить", callback_data: `community_skip:${question.topicId}` },
    ]]
  };

  // Save answer so telegram-control can auto-post when Kirill approves
  setIntelligence(db, BOT_NAME, "pending_answers", String(question.topicId), {
    answer, topicId: question.topicId, url: question.url, savedAt: new Date().toISOString()
  });

  await tgSendToKirill(text, { parse_mode: "Markdown", reply_markup: keyboard });
  markSeen(db, question.topicId);
  console.log(`[CommunityBot] Sent card for: ${question.title}`);
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

export async function runCommunityBot() {
  const db = getDb();
  heartbeat(db, BOT_NAME, "CommunityBot", "starting run");

  console.log(`[CommunityBot] Fetching questions from n8n community...`);
  const topics = await fetchLatestQuestions();

  if (!topics.length) {
    console.log(`[CommunityBot] No topics found`);
    heartbeat(db, BOT_NAME, "CommunityBot", "done — no topics found", {}, {
      status: "degraded",
      last_success_at: new Date().toISOString(),
      error: null
    });
    db.close();
    return;
  }

  // Filter unseen, recent (last 72h), with few answers (opportunity to be first/early)
  const cutoff = Date.now() - 72 * 3600 * 1000;
  const candidates = topics
    .filter(t => {
      if (isAlreadySeen(db, t.id)) return false;
      if (new Date(t.created_at).getTime() < cutoff) return false;
      if (t.posts_count > 8) return false; // already answered well
      return true;
    })
    .slice(0, 15); // max 15 to score per run

  console.log(`[CommunityBot] ${candidates.length} candidates to evaluate`);

  let sent = 0;
  for (const topic of candidates) {
    if (sent >= 5) break; // max 5 answers per run — hard cap to limit API calls

    const detail = await fetchQuestionDetail(topic.id);
    if (!detail || detail.body.length < 50) continue;

    const scoring = await scoreQuestion(detail);
    if (!scoring || scoring.score < 70 || !scoring.can_build) {
      console.log(`[CommunityBot] Skip (score ${scoring?.score || 0}): ${topic.title}`);
      markSeen(db, topic.id);
      continue;
    }

    console.log(`[CommunityBot] Good question (${scoring.score}): ${detail.title}`);
    const answer = await writeExpertAnswer(detail, scoring);

    // Check if n8n community posting is paused (account on hold)
    const paused = getIntelligenceKey(db, BOT_NAME, "settings", "paused");
    if (paused) {
      // Save to queue silently — don't spam Telegram
      setIntelligence(db, BOT_NAME, "queued_answers", String(detail.topicId), {
        question: detail, scoring, answer, queuedAt: new Date().toISOString(),
      }, 60);
      console.log(`[CommunityBot] Queued (paused): ${detail.title}`);
    } else {
      await sendQuestionCard(db, detail, scoring, answer);
    }
    sent++;

    // Если score ≥80 — это потенциальный клиент, отправить в ScoutBot
    if (scoring.score >= 80 && scoring.can_build) {
      console.log(`[CommunityBot] High-value lead (${scoring.score}/100) — sending to ScoutBot`);
      sendMessage(db, {
        fromBot: BOT_NAME,
        toBot: "scout-bot",
        messageType: "community_lead",
        payload: {
          title: detail.title,
          url: detail.url,
          problem: scoring.problem_summary,
          service: scoring.service_type,
          score: scoring.score,
          topicId: detail.topicId
        },
        priority: 8
      });
    }

    // Rate limit — don't hammer the forum API
    await new Promise(r => setTimeout(r, 2000));
  }

  heartbeat(db, BOT_NAME, "CommunityBot", `done — ${sent} cards sent`, {}, {
    status: sent > 0 ? "ok" : "degraded",
    last_success_at: new Date().toISOString(),
    error: null
  });
  try { clearError(db, BOT_NAME); } catch {}
  db.close();
  console.log(`[CommunityBot] Done. Sent ${sent} cards.`);
}

// ── LIVE MODE (24/7 процесс) ──────────────────────────────────────────────────
async function liveMode() {
  console.log(`[CommunityBot] Starting in LIVE mode (runs every 2 hours)...`);

  while (true) {
    try {
      await runCommunityBot();
    } catch (err) {
      console.error(`[CommunityBot] Error in live mode:`, err.message);
      try { const edb = getDb(); reportError(edb, BOT_NAME, "CommunityBot", err.message, "crash", "liveMode"); edb.close(); } catch {}
    }

    // Запускать каждые 2 часа
    console.log(`[CommunityBot] Sleeping 2 hours until next check...`);
    await new Promise(r => setTimeout(r, 2 * 60 * 60 * 1000));
  }
}

import { fileURLToPath as _ftu } from "url";
import { readWiki, appendLog } from "../../wiki/reader.mjs";
if (process.argv[1] === _ftu(import.meta.url)) {
  const isLive = process.argv.includes("live");
  if (isLive) {
    liveMode().catch(err => {
      console.error(`[CommunityBot] Fatal error:`, err);
      process.exit(1);
    });
  } else {
    runCommunityBot().catch(console.error);
  }
}
