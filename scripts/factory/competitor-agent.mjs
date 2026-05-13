/**
 * COMPETITOR AGENT — Market Intelligence & Competitive Analysis
 *
 * Запускается ПОСЛЕ IdeaBot, ДО BuilderBot.
 * Проверяет: есть ли уже решения на рынке? Кто конкуренты? Какой gap?
 * Если gap слишком маленький → отменяет build.
 *
 * Анализирует:
 * 1. Google Search — существующие решения
 * 2. Product Hunt — новые продукты
 * 3. Reddit comments — что люди уже пробовали
 * 4. LinkedIn — кто продаёт похожее
 * 5. Pricing analysis — по какой цене продают конкуренты
 */

import {
  getDb, pollMessages, sendMessage, markMessageActedOn,
  heartbeat, setIntelligence, getIntelligenceKey,
  callAI, MODEL_STRONG, MODEL_MINI
} from "./orchestrator.mjs";
import { readWiki, appendLog } from "../../wiki/reader.mjs";

const BOT_NAME = "competitor-agent";
const POLL_INTERVAL = 15000; // 15 секунд

// ── MAIN LOOP ─────────────────────────────────────────────────────────────────

async function mainLoop() {
  console.log(`[CompetitorAgent] Starting competitive intelligence run...`);

  try {
    const db = getDb();

    // Проверить сообщения от IdeaBot
    const messages = pollMessages(db, BOT_NAME, 10);
    console.log(`[CompetitorAgent] Found ${messages.length} messages to process`);

    for (const msg of messages) {
      await handleMessage(db, msg);
    }

    heartbeat(db, BOT_NAME, "CompetitorAgent", "analyzing market", {
      messages_processed: messages.length
    });

    db.close();
    console.log(`[CompetitorAgent] Done. Processed ${messages.length} messages.`);
  } catch (err) {
    console.error(`[CompetitorAgent] Error:`, err.message);
  }
  // Single-run: exit after processing. Daemon respawns daily at 06:00 UTC.
  // Old design used while(true) loop which caused zombie process accumulation.
}

// ── MESSAGE HANDLERS ──────────────────────────────────────────────────────────

async function handleMessage(db, msg) {
  console.log(`[CompetitorAgent] Message from ${msg.from_bot}: ${msg.message_type}`);

  if (msg.message_type === "analyze_competition") {
    // IdeaBot хочет проверить идею перед build
    const analysis = await analyzeCompetition(db, msg.payload);
    markMessageActedOn(db, msg.id, analysis);

    if (analysis.should_build) {
      // Gap найден → отправить в BuilderBot
      sendMessage(db, {
        fromBot: BOT_NAME,
        toBot: "builder-bot",
        messageType: "build_idea",
        payload: {
          ...msg.payload,
          competitive_analysis: analysis
        },
        priority: 9
      });
    } else {
      // Gap слишком маленький → отменить build
      console.log(`[CompetitorAgent] ❌ Idea rejected: ${analysis.rejection_reason}`);

      // Уведомить IdeaBot
      sendMessage(db, {
        fromBot: BOT_NAME,
        toBot: "idea-bot",
        messageType: "idea_rejected",
        payload: {
          idea: msg.payload.idea.title,
          reason: analysis.rejection_reason,
          competitors: analysis.competitors
        },
        priority: 5
      });
    }
  }
}

// ── COMPETITIVE ANALYSIS ──────────────────────────────────────────────────────

async function analyzeCompetition(db, { idea, auto_triggered, score }) {
  console.log(`[CompetitorAgent] Analyzing competition for: ${idea.title}`);

  const competitors = [];

  // 1. Google Search — существующие решения
  const googleResults = await searchGoogle(idea.title, idea.service_definition);
  competitors.push(...googleResults);

  // 2. Product Hunt — новые продукты
  const phResults = await searchProductHunt(idea.title);
  competitors.push(...phResults);

  // 3. Reddit comments — что люди уже пробовали
  const redditSolutions = await searchRedditSolutions(idea.title);
  competitors.push(...redditSolutions);

  // 4. AI-анализ конкурентов и gap
  const gapAnalysis = await analyzeGap(idea, competitors);

  // 5. Принять решение: строить или нет?
  const decision = makeDecision(gapAnalysis, competitors, score);

  // Сохранить анализ
  setIntelligence(db, BOT_NAME, "competitive_analysis", idea.title.toLowerCase().replace(/[^a-z0-9]/g, "_"), {
    idea: idea.title,
    competitors: competitors.length,
    gap_score: gapAnalysis.gap_score,
    should_build: decision.should_build,
    rejection_reason: decision.rejection_reason,
    analyzed_at: new Date().toISOString()
  }, 90);

  return {
    competitors,
    gap_analysis: gapAnalysis,
    should_build: decision.should_build,
    rejection_reason: decision.rejection_reason
  };
}

// ── SEARCH FUNCTIONS ──────────────────────────────────────────────────────────

async function searchGoogle(title, description) {
  const competitors = [];

  try {
    const apiKey = process.env.GOOGLE_CSE_API_KEY;
    const cx = process.env.GOOGLE_CSE_CX;

    if (!apiKey || !cx) {
      console.log(`[CompetitorAgent] Google CSE not configured, skipping`);
      return competitors;
    }

    // Поиск по ключевым словам из идеи
    const query = `${title} tool software solution`;
    const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(query)}&num=10`;

    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return competitors;

    const data = await res.json();
    const items = data.items || [];

    for (const item of items) {
      // Фильтр: только если это похоже на продукт/сервис
      if (item.link.includes('product') || item.link.includes('pricing') || item.link.includes('solution')) {
        competitors.push({
          source: "google",
          name: item.title,
          url: item.link,
          snippet: item.snippet,
          detected_at: new Date().toISOString()
        });
      }
    }
  } catch (err) {
    console.warn(`[CompetitorAgent] Google search error:`, err.message);
  }

  return competitors;
}

async function searchProductHunt(title) {
  const competitors = [];

  try {
    // Product Hunt API требует auth, используем Google CSE с site:producthunt.com
    const apiKey = process.env.GOOGLE_CSE_API_KEY;
    const cx = process.env.GOOGLE_CSE_CX;

    if (!apiKey || !cx) return competitors;

    const query = `site:producthunt.com ${title}`;
    const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(query)}&num=5`;

    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return competitors;

    const data = await res.json();
    const items = data.items || [];

    for (const item of items) {
      competitors.push({
        source: "producthunt",
        name: item.title,
        url: item.link,
        snippet: item.snippet,
        detected_at: new Date().toISOString()
      });
    }
  } catch (err) {
    console.warn(`[CompetitorAgent] Product Hunt search error:`, err.message);
  }

  return competitors;
}

async function searchRedditSolutions(title) {
  const solutions = [];

  try {
    // Поиск в Reddit comments — что люди рекомендуют
    const keywords = title.toLowerCase().split(' ').slice(0, 3).join(' ');
    const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(keywords)}&limit=10&sort=relevance`;

    const res = await fetch(url, {
      headers: { "User-Agent": "linkedin-brand-os-competitor-agent" },
      signal: AbortSignal.timeout(8000)
    });

    if (!res.ok) return solutions;

    const data = await res.json();
    const posts = data.data?.children || [];

    for (const p of posts) {
      const post = p.data;
      const text = `${post.title} ${post.selftext || ""}`.toLowerCase();

      // Ищем упоминания инструментов/решений
      const toolKeywords = ['using', 'tried', 'recommend', 'switched to', 'built with', 'tool', 'software', 'platform'];
      const hasSolution = toolKeywords.some(k => text.includes(k));

      if (hasSolution) {
        solutions.push({
          source: "reddit",
          subreddit: post.subreddit,
          title: post.title,
          url: `https://reddit.com${post.permalink}`,
          snippet: post.selftext?.slice(0, 200) || post.title,
          detected_at: new Date().toISOString()
        });
      }
    }
  } catch (err) {
    console.warn(`[CompetitorAgent] Reddit search error:`, err.message);
  }

  return solutions;
}

// ── GAP ANALYSIS ──────────────────────────────────────────────────────────────

async function analyzeGap(idea, competitors) {
  console.log(`[CompetitorAgent] Analyzing gap with ${competitors.length} competitors...`);

  if (competitors.length === 0) {
    return {
      gap_score: 10,
      gap_description: "No direct competitors found — blue ocean opportunity",
      our_advantage: idea.service_definition,
      competitive_moat: "First mover in this specific niche"
    };
  }

  // AI-анализ: что делают конкуренты и где gap
  const analysis = await callAI(
    `You are a market analysis AI. Search results show existing solutions. Assess: is there a real gap? Score competition density (0-10). Recommend: BUILD (clear gap exists), WAIT (saturated but improvable), or SKIP (fully saturated). Return JSON.

Product being assessed: ${idea.title}
Service definition: ${idea.service_definition}
Target ICP: ${idea.icp}
Price point: ${idea.price_point}

Existing solutions found:
${competitors.map(c => `- ${c.name} (${c.source}): ${c.snippet}`).join('\n')}

Return JSON: {"gap_score": number, "gap_description": "...", "our_advantage": "...", "competitive_moat": "...", "competitors_do_well": "...", "recommendation": "BUILD" | "WAIT" | "SKIP", "should_build": boolean, "reason": "..."}`,
    JSON.stringify({ idea, competitors: competitors.slice(0, 10) }),
    MODEL_STRONG
  );

  // callAI returns parsed object
  if (typeof analysis === 'object' && analysis !== null) {
    return analysis;
  }

  // Fallback
  return {
    gap_score: 5,
    gap_description: "Unable to analyze gap",
    our_advantage: idea.service_definition,
    competitive_moat: "Unknown",
    should_build: true,
    reason: "Analysis failed, proceeding with caution"
  };
}

// ── DECISION LOGIC ────────────────────────────────────────────────────────────

function makeDecision(gapAnalysis, competitors, ideaScore) {
  // Правила принятия решения:

  // 1. Если gap_score < 3 → рынок слишком насыщен
  if (gapAnalysis.gap_score < 3) {
    return {
      should_build: false,
      rejection_reason: `Market too saturated (gap score: ${gapAnalysis.gap_score}/10). ${competitors.length} competitors found. ${gapAnalysis.gap_description}`
    };
  }

  // 2. Если gap_score >= 7 → строить однозначно
  if (gapAnalysis.gap_score >= 7) {
    return {
      should_build: true,
      rejection_reason: null
    };
  }

  // 3. Если gap_score 3-7 → смотрим на idea score
  if (ideaScore >= 8.5 && gapAnalysis.gap_score >= 5) {
    return {
      should_build: true,
      rejection_reason: null
    };
  }

  // 4. Иначе → не строить
  return {
    should_build: false,
    rejection_reason: `Gap too small (${gapAnalysis.gap_score}/10) for idea score ${ideaScore}/10. Need either gap ≥7 or (gap ≥5 AND idea ≥8.5). Competitors: ${competitors.length}`
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── ENTRY POINT ───────────────────────────────────────────────────────────────

import { fileURLToPath } from "url";
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mainLoop().catch(err => {
    console.error(`[CompetitorAgent] Fatal error:`, err);
    process.exit(1);
  });
}

export { analyzeCompetition };
