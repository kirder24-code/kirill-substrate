/**
 * TREND BOT — Рыночная разведка
 * Видит рынок на 3-6 месяцев вперёд.
 *
 * Задача: найти инструменты/технологии которые ТОЛЬКО набирают силу
 * и которые Кирилл может первым внедрить в клиентские проекты.
 *
 * Источники:
 * 1. GitHub Trending — новые репо с растущими звёздами
 * 2. ProductHunt RSS — новые продукты в AI/automation
 * 3. HN "Show HN" — реальные продукты от разработчиков
 * 4. Apify GitHub Trending (если есть ключ)
 *
 * Расписание: раз в 12 часов
 */

import { getDb, BOTS, CHAT_ID, callAI, tgSend, tgSendToKirill, heartbeat, emitEvent, sendMessage, setIntelligence, logActivity, env, reportError, clearError } from "./orchestrator.mjs";

const BOT_ID = "trend";
const BOT_TOKEN = BOTS.analytics.token; // используем AnalyticsBot для отправки
const APIFY_KEY = env.APIFY_API_KEY;

// Категории которые релевантны для бизнеса Кирилла
const RELEVANT_TOPICS = [
  "automation", "workflow", "n8n", "ai-agent", "llm", "local-ai",
  "self-hosted", "no-code", "low-code", "business-intelligence",
  "data-pipeline", "integration", "zapier", "notion", "crm",
  "document-ai", "speech-to-text", "transcription", "ocr",
  "rag", "vector-database", "langchain", "ollama", "openai"
];

// Стоп-лист — чисто исследовательские/академические проекты
const TOPIC_REJECT = [
  "machine-learning-course", "tutorial", "awesome-list", "cheatsheet",
  "leetcode", "algorithm", "data-structures", "competitive-programming"
];

// ── GitHub Search API ────────────────────────────────────────────────
async function scanGitHub() {
  const candidates = [];
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  const queries = [
    `topic:automation created:>${sevenDaysAgo} stars:>15`,
    `topic:ai-agent created:>${sevenDaysAgo} stars:>20`,
    `topic:workflow created:>${sevenDaysAgo} stars:>10`,
    `llm automation business created:>${sevenDaysAgo} stars:>25`,
    `topic:local-ai created:>${sevenDaysAgo} stars:>10`,
    `topic:n8n stars:>50 pushed:>${sevenDaysAgo}`,
    `topic:rag created:>${sevenDaysAgo} stars:>30`
  ];

  for (const q of queries) {
    try {
      const res = await fetch(
        `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=5`,
        { headers: { "User-Agent": "LBO-TrendBot/1.0", "Accept": "application/vnd.github.v3+json" } }
      );
      if (!res.ok) continue;
      const data = await res.json();

      for (const repo of (data.items || [])) {
        const text = `${repo.name} ${repo.description || ""} ${(repo.topics || []).join(" ")}`.toLowerCase();
        if (TOPIC_REJECT.some(t => text.includes(t))) continue;

        candidates.push({
          id: `gh-${repo.id}`,
          source: "github",
          name: repo.full_name,
          title: repo.name,
          description: repo.description || "No description",
          url: repo.html_url,
          stars: repo.stargazers_count,
          starsThisWeek: repo.stargazers_count, // approximate
          language: repo.language,
          topics: repo.topics || [],
          createdAt: repo.created_at,
          pushedAt: repo.pushed_at
        });
      }
    } catch (err) {
      console.warn(`[TrendBot] GitHub query "${q}": ${err.message}`);
    }

    // Уважаем rate limit (60 req/hour без токена)
    await new Promise(r => setTimeout(r, 800));
  }

  // Дедупликация
  const seen = new Set();
  return candidates.filter(c => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
}

// ── ProductHunt Atom Feed ────────────────────────────────────────────
async function scanProductHunt() {
  const candidates = [];

  try {
    const res = await fetch("https://www.producthunt.com/feed", {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; LBO-TrendBot/1.0)" }
    });
    if (!res.ok) return [];

    const xml = await res.text();
    // ProductHunt uses Atom format: <entry> not <item>
    const entries = xml.match(/<entry>([\s\S]*?)<\/entry>/g) || [];

    for (const entry of entries.slice(0, 30)) {
      const title = entry.match(/<title>(.*?)<\/title>/)?.[1]?.replace(/&amp;/g, "&") || "";
      const content = entry.match(/<content[^>]*>([\s\S]*?)<\/content>/)?.[1] || "";
      const link = entry.match(/href="([^"]+)"/)?.[1] || "";
      const published = entry.match(/<published>(.*?)<\/published>/)?.[1] || "";

      const desc = content.replace(/&lt;[^&]+&gt;/g, "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").slice(0, 300).trim();
      const text = `${title} ${desc}`.toLowerCase();

      const isRelevant = RELEVANT_TOPICS.some(t => text.includes(t.replace(/-/g, " ")));
      if (!isRelevant) continue;

      const id = entry.match(/<id>(.*?)<\/id>/)?.[1] || link;
      candidates.push({
        id: `ph-${Buffer.from(id).toString("base64").slice(0, 16)}`,
        source: "producthunt",
        name: title,
        title,
        description: desc,
        url: link,
        stars: 0,
        topics: RELEVANT_TOPICS.filter(t => text.includes(t.replace(/-/g, " "))),
        createdAt: published ? new Date(published).toISOString() : new Date().toISOString()
      });
    }
  } catch (err) {
    console.warn(`[TrendBot] ProductHunt: ${err.message}`);
  }

  return candidates;
}

// ── HN "Show HN" — реальные продукты ────────────────────────────────
async function scanHNShowHN() {
  const candidates = [];
  const relevantQueries = [
    "Show HN automation workflow",
    "Show HN AI agent business",
    "Show HN local LLM",
    "Show HN self-hosted AI",
    "Show HN n8n",
    "Show HN document AI"
  ];

  for (const q of relevantQueries) {
    try {
      const res = await fetch(
        `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(q)}&tags=show_hn&hitsPerPage=5&numericFilters=created_at_i>%3D${Math.floor(Date.now() / 1000) - 7 * 86400}`
      );
      const data = await res.json();

      for (const hit of (data.hits || [])) {
        const text = `${hit.title} ${hit.story_text || ""}`.toLowerCase();
        const isRelevant = RELEVANT_TOPICS.some(t => text.includes(t.replace(/-/g, " ")));
        if (!isRelevant) continue;

        candidates.push({
          id: `hn-${hit.objectID}`,
          source: "hackernews",
          name: hit.title,
          title: hit.title,
          description: (hit.story_text || "").replace(/<[^>]+>/g, "").slice(0, 300),
          url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
          stars: hit.points || 0,
          topics: RELEVANT_TOPICS.filter(t => text.includes(t.replace(/-/g, " "))),
          createdAt: hit.created_at
        });
      }
    } catch (err) {
      console.warn(`[TrendBot] HN: ${err.message}`);
    }
  }

  return candidates;
}

// ── AI Opportunity Analyzer ──────────────────────────────────────────
async function analyzeOpportunity(item) {
  return callAI(
    `You are a business opportunity analyst for Kirill D., AI automation consultant.
He sells: n8n automation, AI orchestrators, local AI servers, workflow consulting.
Clients: SMB owners, CTOs, operations managers in Canada & USA.

Analyze this new tool/product and assess if Kirill can monetize it.

Score 0-100:
- 0-30: academic/dev tool, no business angle
- 31-60: interesting but indirect value
- 61-80: clear business application, worth tracking
- 81-100: GOLDEN NICHE — Kirill can be first mover, charge premium

Return JSON:
{
  "opportunity_score": 0-100,
  "category": "ai_agent|workflow|local_ai|integration|productivity|document_ai|voice_ai|other",
  "business_problem_solved": "what business pain does this solve in 1 sentence",
  "target_client": "who would pay Kirill to implement this",
  "monetization_angle": "how Kirill sells this — as a service, as part of AI Box, etc",
  "linkedin_post_hook": "compelling first sentence for a LinkedIn post about this",
  "urgency": "now|3months|6months|skip",
  "why_first_mover": "why being first matters here or 'not applicable'"
}`,
    `Tool: ${item.title}
Source: ${item.source}
Description: ${item.description}
Topics: ${item.topics?.join(", ") || "n/a"}
Stars/Upvotes: ${item.stars}
URL: ${item.url}`
  );
}

// ── Format & Send to Telegram ─────────────────────────────────────────
async function notifyTrend(item, analysis) {
  const scoreEmoji =
    analysis.opportunity_score >= 80 ? "🥇" :
    analysis.opportunity_score >= 65 ? "🔥" :
    analysis.opportunity_score >= 50 ? "⚡" : "💡";

  const sourceLabel =
    item.source === "github" ? `GitHub ⭐${item.stars}` :
    item.source === "producthunt" ? "ProductHunt" : "HackerNews";

  const urgencyLabel = {
    now: "🚨 ДЕЙСТВУЙ СЕЙЧАС",
    "3months": "📅 На радаре (3 мес)",
    "6months": "📍 Следи (6 мес)",
    skip: "💤 Пропустить"
  }[analysis.urgency] || analysis.urgency;

  const text = [
    `${scoreEmoji} <b>ТРЕНД: ${item.title}</b>`,
    `<b>Оценка возможности:</b> ${analysis.opportunity_score}/100 | ${sourceLabel}`,
    ``,
    `<b>Проблема которую решает:</b>`,
    analysis.business_problem_solved,
    ``,
    `<b>Целевой клиент:</b> ${analysis.target_client}`,
    `<b>Как монетизировать:</b> ${analysis.monetization_angle}`,
    ``,
    `<b>Хук для LinkedIn поста:</b>`,
    `<i>${analysis.linkedin_post_hook}</i>`,
    ``,
    `<b>Зачем быть первым:</b> ${analysis.why_first_mover}`,
    `<b>⏰ Срочность:</b> ${urgencyLabel}`,
    ``,
    `🔗 ${item.url}`,
  ].join("\n");

  // Encode trend data for callback (compact JSON, base64 to survive Telegram's 64-byte limit)
  const trendKey = `trend_${Date.now()}`;
  // Store trend payload in intelligence so callback can retrieve it
  const { getDb, setIntelligence } = await import("./orchestrator.mjs");
  const _db = getDb();
  setIntelligence(_db, "trend_bot", "pending_trends", trendKey, {
    title: item.title,
    score: analysis.opportunity_score,
    category: analysis.category,
    hook: analysis.linkedin_post_hook,
    monetization: analysis.monetization_angle,
    urgency: analysis.urgency,
    url: item.url,
    source: item.source
  }, 95);
  _db.close();

  const keyboard = {
    inline_keyboard: [
      [
        { text: "✍️ Написать пост об этом", callback_data: `trend_post:${trendKey}` },
      ],
      [
        { text: "💡 Сохранить идею", callback_data: `trend_save:${trendKey}` },
        { text: "❌ Не интересно", callback_data: `trend_skip:${trendKey}` },
      ]
    ]
  };

  await tgSendToKirill(text, { reply_markup: keyboard });
}

// ── Main TrendBot run ─────────────────────────────────────────────────
async function runTrend() {
  const db = getDb();
  heartbeat(db, BOT_ID, "TrendBot", "scanning market intelligence");

  console.log(`[TrendBot] Scanning GitHub + ProductHunt + HN Show HN...`);
  await logActivity(db, "trend", `Начинаю рыночную разведку: GitHub Trending + ProductHunt + HN Show HN`);

  // Сканируем все источники
  const [githubItems, phItems, hnItems] = await Promise.all([
    scanGitHub(),
    scanProductHunt(),
    scanHNShowHN()
  ]);

  const allItems = [...githubItems, ...phItems, ...hnItems];
  console.log(`[TrendBot] Found: ${githubItems.length} GitHub | ${phItems.length} ProductHunt | ${hnItems.length} HN`);

  if (allItems.length === 0) {
    heartbeat(db, BOT_ID, "TrendBot", "scan complete — no items", {}, {
      status: "degraded",
      last_success_at: null,
      error: null
    });
    db.close();
    return;
  }

  // Дедупликация по ID (уже виденные)
  const seenKey = "trend_seen_ids";
  let seenIds = new Set();
  try {
    const row = db.prepare(`SELECT metrics_json FROM bot_heartbeats WHERE bot_id = ?`).get(seenKey);
    if (row?.metrics_json) seenIds = new Set(JSON.parse(row.metrics_json));
  } catch {}

  const newItems = allItems.filter(i => !seenIds.has(i.id));
  console.log(`[TrendBot] New items to analyze: ${newItems.length} / ${allItems.length}`);

  // Анализируем топ кандидатов по звёздам
  const toAnalyze = newItems
    .sort((a, b) => (b.stars || 0) - (a.stars || 0))
    .slice(0, 8); // Макс 8 AI calls за раз

  const opportunities = [];
  for (const item of toAnalyze) {
    try {
      const analysis = await analyzeOpportunity(item);
      seenIds.add(item.id);
      if (analysis.opportunity_score >= 60 && analysis.urgency !== "skip") {
        opportunities.push({ item, analysis });
      } else {
        console.log(`  ✗ ${item.title}: ${analysis.opportunity_score}/100 (${analysis.urgency})`);
      }
    } catch (err) {
      console.warn(`[TrendBot] Analysis error for ${item.title}: ${err.message}`);
    }
  }

  // Сортируем по score, берём топ 3
  opportunities.sort((a, b) => b.analysis.opportunity_score - a.analysis.opportunity_score);
  const topOpportunities = opportunities.slice(0, 3);

  console.log(`[TrendBot] Qualified opportunities: ${topOpportunities.length}`);

  // Сохраняем разведку в общую память — другие боты будут это читать
  setIntelligence(db, "trend", "market_scan", "last_scan_at", new Date().toISOString(), 100);
  setIntelligence(db, "trend", "market_scan", "scanned_count", allItems.length, 100);
  setIntelligence(db, "trend", "market_scan", "opportunities_found", topOpportunities.length, 100);
  if (topOpportunities.length > 0) {
    setIntelligence(db, "trend", "hot_topics", "latest", topOpportunities.map(o => ({
      title: o.item.title,
      score: o.analysis.opportunity_score,
      hook: o.analysis.linkedin_post_hook,
      category: o.analysis.category,
      urgency: o.analysis.urgency,
      monetization: o.analysis.monetization_angle
    })), 90);
  }

  if (topOpportunities.length === 0) {
    console.log(`[TrendBot] No strong opportunities this run.`);
  } else {
    console.log(`[TrendBot] ${topOpportunities.length} opportunities found — routing through qualification (no Telegram spam)`);

    for (const { item, analysis } of topOpportunities) {
      // No direct Telegram — signals go through event → orchestrator → qualifyOpportunity
      emitEvent(db, {
        fromBot: BOT_ID,
        eventType: "trend_spotted",
        payload: {
          title: item.title,
          score: analysis.opportunity_score,
          category: analysis.category,
          hook: analysis.linkedin_post_hook,
          monetization: analysis.monetization_angle,
          urgency: analysis.urgency,
          url: item.url,
          source: item.source
        }
      });

      if (analysis.opportunity_score >= 70) {
        // Save as content idea (Kirill decides when to write)
        const ideaKey = `trend_${item.title.toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 40)}`;
        setIntelligence(db, "content-bot", "content_ideas", ideaKey, {
          title: item.title, score: analysis.opportunity_score, hook: analysis.linkedin_post_hook,
          monetization: analysis.monetization_angle, category: analysis.category,
          source: item.source, url: item.url, savedAt: new Date().toISOString(),
        }, 30);

        // Send to IdeaBot — trend = potential business idea
        sendMessage(db, {
          fromBot: BOT_ID,
          toBot: "idea-bot",
          messageType: "lead_pain_signal",
          payload: {
            platform: item.source,
            pain: `TREND: ${item.title} — ${analysis.business_problem_solved || analysis.monetization_angle}`,
            score: analysis.opportunity_score,
            serviceMatch: analysis.monetization_angle,
            target_client: analysis.target_client,
          },
          priority: analysis.urgency === "now" ? 10 : 7
        });
        console.log(`[TrendBot] Trend → IdeaBot + content idea: ${item.title} (${analysis.opportunity_score}/100)`);
      }
    }
  }

  // Сохраняем виденные ID
  try {
    const seenArr = [...seenIds].slice(-500); // Храним последние 500
    db.prepare(`INSERT OR REPLACE INTO bot_heartbeats (id, bot_id, bot_name, status, last_action, metrics_json, pinged_at) VALUES (?,?,?,?,?,?,?)`)
      .run(seenKey, seenKey, "TrendBot", "active", "seen_tracker", JSON.stringify(seenArr), new Date().toISOString());
  } catch {}

  heartbeat(db, BOT_ID, "TrendBot", `scan complete — ${topOpportunities.length} opportunities`, {
    scanned: allItems.length,
    new: newItems.length,
    qualified: topOpportunities.length
  }, {
    status: topOpportunities.length > 0 ? "ok" : "degraded",
    last_success_at: topOpportunities.length > 0 ? new Date().toISOString() : null,
    error: null
  });
  try { clearError(db, BOT_ID); } catch {}
  db.close();
  console.log(`[TrendBot] Done. ${topOpportunities.length} opportunities sent to Telegram.`);
}

// ── LIVE MODE (24/7 процесс) ──────────────────────────────────────────────────
async function liveMode() {
  console.log(`[TrendBot] Starting in LIVE mode (runs every 12 hours)...`);

  while (true) {
    try {
      await runTrend();
    } catch (err) {
      console.error(`[TrendBot] Error in live mode:`, err.message);
      try { const edb = getDb(); heartbeat(edb, BOT_ID, "TrendBot", "error", {}, { status: "error", last_success_at: null, error: err.message }); reportError(edb, BOT_ID, "TrendBot", err.message, "crash", "liveMode"); edb.close(); } catch {}
    }

    // Запускать каждые 12 часов
    console.log(`[TrendBot] Sleeping 12 hours until next scan...`);
    await new Promise(r => setTimeout(r, 12 * 60 * 60 * 1000));
  }
}

import { fileURLToPath as _ftu } from "url";
if (process.argv[1] === _ftu(import.meta.url)) {
  const isLive = process.argv.includes("live");
  if (isLive) {
    liveMode().catch(err => {
      console.error(`[TrendBot] Fatal error:`, err);
      process.exit(1);
    });
  } else {
    runTrend().catch(console.error);
  }
}

export { runTrend };
