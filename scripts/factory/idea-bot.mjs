/**
 * IDEA BOT — Стратегический синтез-агент
 *
 * Запускается каждое утро в 7 AM.
 * Читает ВСЁ что видели боты за последние 48 часов:
 * — боли лидов, Reddit дискуссии, тренды, рыночные сигналы, форумы, PH рынок
 *
 * Ищет ПАТТЕРНЫ которые пересекаются в нескольких источниках.
 * Генерирует 1-2 нестандартные идеи о том как заработать деньги.
 * Идеи не должны быть "n8n автоматизация" — они должны быть НЕОЖИДАННЫМИ.
 * Каждая идея подкреплена реальными сигналами которые видела система.
 *
 * Формат: утренняя карточка в Telegram.
 * "Я заметил X в трёх источниках → вот идея → вот как проверить за 48ч"
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import {
  getDb, callAI, tgSendToKirill, heartbeat,
  setIntelligence, getIntelligenceKey,
  pollMessages, markMessageActedOn,
  MODEL_STRONG, MODEL_MINI, reportError, clearError,
  getDirectivesFor
} from "./orchestrator.mjs";
import { getWikiContext, readPurpose, appendLog } from "../../wiki/reader.mjs";

const __dirname_idea = dirname(fileURLToPath(import.meta.url));
const LAST_RUN_FILE = resolve(__dirname_idea, "../../.data/idea-bot-last-run.json");
const COOLDOWN_MS = 20 * 60 * 60 * 1000; // 20 hours — run once per day max

const BOT_NAME = "idea-bot";

// Dead themes from voice agent era — NEVER suggest these
const DEAD_THEMES = [
  "missed call", "voice agent", "voice receptionist", "after hours",
  "answering service", "AI receptionist", "phone answering", "call handling",
  "IVR", "virtual receptionist"
];

// Dead channels — do NOT suggest ideas for these
const DEAD_CHANNELS = [
  "cold email outreach", "Reddit DMs", "voice agents", "Fiverr gigs",
  "n8n community selling"
];

/**
 * Load recently rejected/skipped ideas from bot_intelligence to avoid recycling.
 */
function getRecentRejectedIdeas(db) {
  try {
    const rows = db.prepare(`
      SELECT key, value_json FROM bot_intelligence
      WHERE bot_id = ? AND insight_type = 'ideas'
      ORDER BY created_at DESC LIMIT 20
    `).all(BOT_NAME);
    const titles = [];
    for (const r of rows) {
      try {
        const val = JSON.parse(r.value_json);
        if (val.title) titles.push(val.title);
      } catch {}
    }
    return titles.slice(0, 15);
  } catch { return []; }
}

// Wiki context - idea-bot reads EVERYTHING to synthesize
const WIKI_CTX = getWikiContext([
  "strategy/current-thesis.md",
  "market/what-converts.md",
  "market/dead-channels.md",
  "market/icp-profile.md",
  "leads/patterns.md",
  "strategy/lessons.md",
  "strategy/experiments.md",
]);

// ── СБОР ВСЕХ СИГНАЛОВ СО ВСЕЙ СИСТЕМЫ ───────────────────────────────────────

function gatherSystemSignals(db) {
  const signals = {};

  // 1. Боли лидов — что людям реально нужно (из ScoutBot)
  signals.leadPains = (() => {
    try {
      const leads = db.prepare(`
        SELECT pain_description, service_match, source_platform, score, location
        FROM leads
        WHERE created_at > datetime('now', '-14 days')
        AND pain_description IS NOT NULL
        ORDER BY score DESC LIMIT 30
      `).all();

      // Добавить свежие боли от ScoutBot через event bus
      const scoutPains = getIntelligenceKey(db, BOT_NAME, "scout_pains", "recent") || [];

      return [
        ...leads.map(l => ({
          pain: l.pain_description,
          service: l.service_match,
          platform: l.source_platform,
          score: l.score,
          location: l.location
        })),
        ...scoutPains.map(p => ({
          pain: p.pain,
          service: p.serviceMatch,
          platform: p.platform,
          score: p.score,
          location: "unknown"
        }))
      ];
    } catch (e) { console.warn("[IdeaBot] Signal read failed:", e.message); return []; }
  })();

  // 2. Скипнутые лиды и причины — чего система НЕ умеет делать
  signals.rejectionReasons = (() => {
    try {
      return getIntelligenceKey(db, "lead_feedback", "rejections", "reasons") || [];
    } catch (e) { console.warn("[IdeaBot] Signal read failed:", e.message); return []; }
  })();

  // 3. Reddit сигналы — что люди обсуждают прямо сейчас
  signals.redditSignals = (() => {
    try {
      const monitoring = getIntelligenceKey(db, "ph-bot", "monitoring", "signals") || [];
      const redditOpp = getIntelligenceKey(db, "scout", "visibility_opportunities", "reddit") || [];
      return [...monitoring.slice(0, 15), ...redditOpp.slice(0, 10)];
    } catch (e) { console.warn("[IdeaBot] Signal read failed:", e.message); return []; }
  })();

  // 4. PH рынок — Philippines специфика
  signals.phRecon = (() => {
    try {
      // Читать из bot_intelligence (старые данные) И из ph_signals (новые сообщения)
      const phMessages = getIntelligenceKey(db, BOT_NAME, "ph_signals", "recent") || [];
      return {
        niches: getIntelligenceKey(db, "ph-bot", "recon", "niches") || [],
        channels: getIntelligenceKey(db, "ph-bot", "recon", "channels") || [],
        news: getIntelligenceKey(db, "ph-bot", "monitoring", "news") || [],
        signals: phMessages // Новые сигналы от PHBot через event bus
      };
    } catch { return {}; }
  })();

  // 5. Глобальная рыночная разведка (ResearchBot)
  signals.marketIntel = (() => {
    try {
      return {
        heatMap: getIntelligenceKey(db, "research-bot", "market_heat", "latest") || {},
        demandSignals: (getIntelligenceKey(db, "research-bot", "demand_signals", "latest") || []).slice(0, 15),
        analysis: getIntelligenceKey(db, "research-bot", "market_intelligence", "latest")?.analysis || ""
      };
    } catch { return {}; }
  })();

  // 6. N8N Community — что технически не хватает людям
  signals.communityGaps = (() => {
    try {
      const answered = getIntelligenceKey(db, "community-bot", "answered", "recent") || [];
      const questions = db.prepare(`
        SELECT key, value_json FROM bot_intelligence
        WHERE bot_id = 'community-bot' AND insight_type = 'questions'
        ORDER BY created_at DESC LIMIT 20
      `).all().map(r => { try { return JSON.parse(r.value_json); } catch { return null; }}).filter(Boolean);
      return questions.slice(0, 10);
    } catch (e) { console.warn("[IdeaBot] Signal read failed:", e.message); return []; }
  })();

  // 7. Тренды (TrendBot)
  signals.trends = (() => {
    try {
      return getIntelligenceKey(db, "trend_bot", "saved_ideas", "list") || [];
    } catch { return []; }
  })();

  // 8. Какие посты Кирилла сработали (по лайкам/лидам)
  signals.successfulContent = (() => {
    try {
      const posts = db.prepare(`
        SELECT hook, topic, likes, leads_generated, performance_score
        FROM published_posts
        WHERE status = 'published' AND likes > 10
        ORDER BY likes DESC LIMIT 10
      `).all();
      return posts;
    } catch { return []; }
  })();

  // 9. Конверсионные паттерны (что реально сработало)
  signals.conversionPatterns = (() => {
    try {
      const wins = getIntelligenceKey(db, "evolution", "conversions", "wins") || [];
      const replied = (getIntelligenceKey(db, "evolution", "conversions", "events") || [])
        .filter(e => e.toStage === "replied");
      return { wins, replied: replied.slice(-10) };
    } catch { return {}; }
  })();

  return signals;
}

// ── ФОРМАТИРОВАНИЕ СИГНАЛОВ ДЛЯ ПРОМПТА ──────────────────────────────────────

function formatSignalsForPrompt(signals) {
  const parts = [];

  if (signals.leadPains?.length) {
    parts.push(`=== БОЛИ ЛИДОВ (что реально ищут клиенты, последние 14 дней) ===`);
    signals.leadPains.slice(0, 15).forEach(l =>
      parts.push(`• [${l.platform}] ${l.pain} → ожидается: ${l.service} (score: ${l.score})`)
    );
  }

  if (signals.rejectionReasons?.length) {
    parts.push(`\n=== ПОЧЕМУ КИРИЛЛ СКИПАЕТ ЛИДОВ (чего система не может предложить) ===`);
    signals.rejectionReasons.slice(-10).forEach(r =>
      parts.push(`• ${r.reason} (platform: ${r.platform})`)
    );
  }

  if (signals.redditSignals?.length) {
    parts.push(`\n=== REDDIT ОБСУЖДЕНИЯ (что волнует людей прямо сейчас) ===`);
    signals.redditSignals.slice(0, 10).forEach(s => {
      if (s.title) parts.push(`• r/${s.subreddit}: "${s.title}" (${s.upvotes || 0} upvotes, ${s.comments || 0} comments)`);
    });
  }

  if (signals.phRecon?.niches?.length) {
    parts.push(`\n=== PHILIPPINES РЫНОК (горячие ниши) ===`);
    signals.phRecon.niches.forEach(n =>
      parts.push(`• ${n.name}: ${n.why_urgent} | Reach: ${n.how_to_reach}`)
    );
  }

  if (signals.marketIntel?.demandSignals?.length) {
    parts.push(`\n=== ГЛОБАЛЬНЫЕ СИГНАЛЫ СПРОСА ===`);
    signals.marketIntel.demandSignals.slice(0, 8).forEach(s =>
      parts.push(`• [${s.market || "?"}] ${s.title}`)
    );
  }

  if (signals.communityGaps?.length) {
    parts.push(`\n=== N8N COMMUNITY — ЧТО ТЕХНИЧЕСКИ НЕ УМЕЮТ СДЕЛАТЬ ===`);
    signals.communityGaps.slice(0, 8).forEach(q => {
      if (q.title) parts.push(`• "${q.title}"`);
    });
  }

  if (signals.trends?.length) {
    parts.push(`\n=== ТРЕНДЫ ===`);
    signals.trends.slice(0, 5).forEach(t =>
      parts.push(`• ${t.title || t.topic}: ${t.angle || ""}`)
    );
  }

  if (signals.successfulContent?.length) {
    parts.push(`\n=== КОНТЕНТ КОТОРЫЙ СРАБОТАЛ У КИРИЛЛА ===`);
    signals.successfulContent.forEach(p =>
      parts.push(`• "${p.hook}" → ${p.likes} лайков, ${p.leads_generated} лидов`)
    );
  }

  return parts.join("\n");
}

// ── ГЕНЕРАЦИЯ ИДЕЙ ────────────────────────────────────────────────────────────

async function generateIdeas(signalsText, db) {
  // Load purpose from wiki for current context
  let purposeCtx = "";
  try { purposeCtx = readPurpose() || ""; } catch {}

  // Load recently generated ideas to avoid recycling
  const recentIdeas = getRecentRejectedIdeas(db);
  const recentIdeasBlock = recentIdeas.length > 0
    ? `\n\nDO NOT SUGGEST THESE AGAIN (already generated recently):\n${recentIdeas.map(t => `- ${t}`).join("\n")}`
    : "";

  const deadThemesBlock = `\n\nDEAD THEMES — NEVER suggest ideas involving these (discontinued products):\n${DEAD_THEMES.map(t => `- ${t}`).join("\n")}`;
  const deadChannelsBlock = `\n\nDEAD CHANNELS — NEVER suggest ideas for these channels (proven failures):\n${DEAD_CHANNELS.map(c => `- ${c}`).join("\n")}`;

  const systemPrompt = `${WIKI_CTX}

${purposeCtx ? `<current-purpose>\n${purposeCtx}\n</current-purpose>\n` : ""}
You analyze pain signals from service-business owners and produce TWO outputs for each:
1. A value-first Reddit comment (for Kirill to post)
2. A specific service offer idea (for outreach)

TARGET VERTICALS: solo SaaS founders, indie hackers, pre-PMF founders, bootstrapped product builders.
TARGET BUYER: Solo founder with a working product, no consistent lead flow or no idea if it scales.
TARGET PAIN: no customers, broken sales pipeline, manual ops burning time, untested code at scale, struggling to get first 10 paying users.

CURRENT OFFER STACK (these are the ONLY things Kirill sells):
- Vibe Code Audit: $1,500-$3,000 CAD — solo founder with working product, no idea if it scales
- First 10 Customers Sales Motion: $2,500 CAD — pre-PMF founder, has product, no consistent lead flow
- AI Workflow Design Sprint: $1,500-$5,000 CAD — founder drowning in manual ops, ready to automate
- Full Pipeline Build: $5,000-$10,000 CAD — funded founder needs end-to-end sales infrastructure

Ideas MUST align with one of these offers. Do NOT invent new service categories.

FOR THE REDDIT COMMENT:
- Give VALUE FIRST — one specific actionable tip they can use WITHOUT hiring anyone
- Show you understand THEIR specific problem using their own words
- Include one realistic result ("win rate went from 35% to 55%")
- End with soft offer: "happy to share more if helpful"
- Maximum 4 sentences. No jargon (no n8n, API, webhook, workflow, automation platform)
- NEVER pitch. NEVER mention pricing. NEVER say "I can build this for you" or "DM me"

FOR THE SERVICE OFFER IDEA:
- Must connect to a SPECIFIC pain signal found in the data
- Price should match the scope: $250 for 1-hour fix, $750 pilot, $1,500 full project, $3,000-$5,000+ for complex multi-week builds. Don't limit — match price to real effort and value.
- Must include: who to sell to, where to find them, what to say first
- Verticals: service businesses are primary, but if real pain + real buyer exists elsewhere — propose it

IGNORE completely:
- Developers, hobbyists, students, learners
- Enterprise companies, SaaS, fintech, ecommerce
- Non-service-business pain (HR, hiring, marketing strategy)
- Abstract business advice without operational pain
- Anything about voice agents, missed calls, after-hours answering, AI receptionists (DISCONTINUED)
- Anything about HVAC, dental, or plumbing niches unless there is STRONG fresh signal data
${recentIdeasBlock}${deadThemesBlock}${deadChannelsBlock}

Return JSON:
{"ideas":[{"title":"...","pain_found":"exact quote or description of the pain signal","source_platform":"reddit","source_community":"r/sweatystartup","source_author":"username","source_url":"https://...","reddit_comment":"the value-first comment to post (4 sentences max)","service_offer":"what Kirill could sell to this person","price_cad":0,"price_note":"set price based on real effort: $250 for 1h, $750 for 3 days, $1500 for 1 week, $3000-5000 for complex builds","where_to_sell":"where to find more people with this pain","first_action":"what to do in the next 24h","score":8.5}]}`;

  // Inject Kirill's directives
  let directiveBlock = "";
  try {
    const directives = getDirectivesFor("idea-bot").filter(d => d.active);
    if (directives.length > 0) {
      directiveBlock = `\n\nOWNER DIRECTIVES (from Kirill - HIGHEST PRIORITY, override other rules):\n` +
        directives.map(d => `  [${d.action.toUpperCase()}] ${d.what}`).join("\n");
    }
  } catch {}

  let result = null;
  try {
    result = await callAI(systemPrompt + directiveBlock, signalsText, MODEL_STRONG);
  } catch (err) {
    console.error(`[IdeaBot] callAI error: ${err.message}`);
    try { const edb = getDb(); reportError(edb, BOT_NAME, "IdeaBot", err.message, "api", "generateIdeas"); edb.close(); } catch {}
    return [];
  }

  if (!result) { console.log("[IdeaBot] callAI returned null"); return []; }

  try {
    // callAI returns string; parse it
    const resultStr = typeof result === "string" ? result : JSON.stringify(result);
    const json = resultStr.match(/\{[\s\S]*\}/)?.[0];
    if (!json) { console.log("[IdeaBot] No JSON in response:", resultStr.slice(0, 200)); return []; }
    const parsed = JSON.parse(json);
    if (!parsed.ideas?.length) console.log("[IdeaBot] Parsed OK but ideas array empty:", JSON.stringify(parsed).slice(0, 200));
    return parsed.ideas || [];
  } catch (e) {
    const raw = typeof result === "string" ? result : JSON.stringify(result);
    console.error(`[IdeaBot] JSON parse error: ${e.message}. Raw: ${raw.slice(0, 300)}`);
    return [];
  }
}

// ── ОТПРАВКА УТРЕННЕЙ КАРТОЧКИ ────────────────────────────────────────────────

async function sendIdeaCard(db, ideas, signalCount, signals = {}) {
  if (!ideas?.length) {
    console.log("[IdeaBot] No ideas generated today");
    return;
  }

  const { qualifyOpportunity, decisionEngine } = await import("./orchestrator.mjs");

  for (const idea of ideas.slice(0, 2)) {
    // Route through Opportunity Qualification → Decision Engine
    const opp = await qualifyOpportunity(db, {
      title: idea.title,
      source: "idea-bot",
      origin_bot: "idea-bot",
      description: `${idea.opportunity || ""}. Service: ${idea.service_definition || ""}`,
      market: idea.icp || "global",
      type: "idea",
      proof: `${idea.insight || ""}. Urgency: ${idea.urgency_signal || ""}. Sources: ${(idea.sources || []).map(s => s.platform + "/" + s.community).join(", ")}`,
    });

    if (opp) {
      const decision = await decisionEngine(db, opp.id);
      console.log(`[IdeaBot] Idea "${idea.title}" → ${decision?.decision}`);
    } else {
      console.log(`[IdeaBot] Idea "${idea.title}" → rejected by qualification`);
    }

    const ideaKey = idea.title.toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 30);

    // Build Telegram card
    const lines = [
      `💡 <b>${idea.title}</b>`,
      ``,
      `<b>Инсайт:</b> ${(idea.insight || idea.opportunity || "").slice(0, 200)}`,
      `<b>Услуга:</b> ${(idea.service_definition || "").slice(0, 200)}`,
      `<b>ICP:</b> ${idea.icp || "?"}`,
      `<b>Цена:</b> ${idea.price_point || "?"}`,
      `<b>Score:</b> ${idea.score || "?"}/10`,
      ``,
      idea.first_step_48h ? `<b>Первый шаг:</b> ${idea.first_step_48h}` : "",
    ].filter(Boolean);

    // Сохранить идею в DB для callback обработки
    setIntelligence(db, BOT_NAME, "ideas", ideaKey, {
      ...idea,
      sources: idea.sources || [],
      where_to_sell: idea.where_to_sell || [],
      ideaKey,
      generatedAt: new Date().toISOString(),
      status: "pending"
    }, 60);

    // 🔥 АВТОЗАПУСК: если score ≥8 → отправить в CompetitorAgent для проверки
    if (idea.score >= 8) {
      console.log(`[IdeaBot] 🚀 High-score idea (${idea.score}/10) — sending to CompetitorAgent for validation`);

      const { sendMessage } = await import("./orchestrator.mjs");
      sendMessage(db, {
        fromBot: BOT_NAME,
        toBot: "competitor-agent",
        messageType: "analyze_competition",
        payload: {
          idea: {
            title: idea.title,
            service_definition: idea.service_definition,
            icp: idea.icp,
            price_point: idea.price_point,
            first_step: idea.first_step_48h
          },
          auto_triggered: true,
          score: idea.score
        },
        priority: 10
      });

      setIntelligence(db, BOT_NAME, "ideas", ideaKey, {
        ...idea, ideaKey,
        generatedAt: new Date().toISOString(),
        status: "analyzing_competition",
        sent_to_competitor_agent_at: new Date().toISOString()
      }, 90);

      lines.unshift(`🔍 <b>ANALYZING: Score ${idea.score}/10</b> — CompetitorAgent проверяет рынок...`);
      lines.unshift(``);
    }

    await tgSendToKirill(lines.join("\n"), {
      reply_markup: {
        inline_keyboard: [
          [
            { text: "🚀 Тестировать — пишем пост", callback_data: `idea_test:${ideaKey}` },
            { text: "💾 Сохранить на потом", callback_data: `idea_save:${ideaKey}` }
          ],
          [
            { text: "❌ Не моё", callback_data: `idea_skip:${ideaKey}` }
          ]
        ]
      }
    });

    await new Promise(r => setTimeout(r, 500));
  }

  // Мета-строка
  await tgSendToKirill(
    `<i>🤖 Синтез из ${signalCount} сигналов (${[
      signals.leadPains?.length ? `${signals.leadPains.length} lead pains` : null,
      signals.redditSignals?.length ? `${signals.redditSignals.length} reddit` : null,
      signals.marketIntel?.demandSignals?.length ? `${signals.marketIntel.demandSignals.length} market` : null,
      signals.trends?.length ? `${signals.trends.length} trends` : null,
    ].filter(Boolean).join(", ")})</i>`,
    { reply_markup: { inline_keyboard: [[{ text: "🤖 Меню", callback_data: "menu" }]] }}
  );
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

export async function runIdeaBot() {
  // 20-hour cooldown: run once per day max (prevents 75+ Telegram spam when called hourly)
  try {
    if (existsSync(LAST_RUN_FILE)) {
      const lastRun = JSON.parse(readFileSync(LAST_RUN_FILE, "utf-8"));
      const elapsed = Date.now() - new Date(lastRun.ran_at).getTime();
      if (elapsed < COOLDOWN_MS) {
        console.log(`[IdeaBot] Cooldown: ran ${(elapsed / 3600000).toFixed(1)}h ago, need ${(COOLDOWN_MS / 3600000).toFixed(0)}h gap. Exiting.`);
        return;
      }
    }
  } catch {}

  const db = getDb();
  heartbeat(db, BOT_NAME, "IdeaBot", "synthesizing signals...");
  console.log("[IdeaBot] Gathering signals from all system sources...");

  // Читаем сообщения от ScoutBot (боли лидов) и PHBot (PH рынок)
  const messages = pollMessages(db, BOT_NAME, 20);
  console.log(`[IdeaBot] Received ${messages.length} messages from other bots`);

  for (const msg of messages) {
    if (msg.message_type === "lead_pain_signal") {
      console.log(`[IdeaBot] Lead pain from ${msg.from_bot}: ${msg.payload.pain.slice(0, 60)}... (score: ${msg.payload.score})`);

      // Сохранить боль лида в intelligence для использования при генерации идей
      const existingPains = getIntelligenceKey(db, BOT_NAME, "scout_pains", "recent") || [];
      existingPains.push({
        pain: msg.payload.pain,
        platform: msg.payload.platform,
        score: msg.payload.score,
        serviceMatch: msg.payload.serviceMatch,
        receivedAt: new Date().toISOString()
      });
      setIntelligence(db, BOT_NAME, "scout_pains", "recent", existingPains.slice(-50), 90);

      markMessageActedOn(db, msg.id, { processed: true });
    }

    if (msg.message_type === "ph_market_signal") {
      console.log(`[IdeaBot] PH market signal from ${msg.from_bot}: ${msg.payload.niche}`);

      // Сохранить PH сигнал
      const existingPH = getIntelligenceKey(db, BOT_NAME, "ph_signals", "recent") || [];
      existingPH.push({
        niche: msg.payload.niche,
        urgency: msg.payload.urgency,
        companies: msg.payload.companies,
        projectSize: msg.payload.projectSize,
        reach: msg.payload.reach,
        market: msg.payload.market,
        receivedAt: new Date().toISOString()
      });
      setIntelligence(db, BOT_NAME, "ph_signals", "recent", existingPH.slice(-20), 90);

      markMessageActedOn(db, msg.id, { processed: true });
    }
  }

  const signals = gatherSystemSignals(db);
  const signalCount =
    (signals.leadPains?.length || 0) +
    (signals.redditSignals?.length || 0) +
    (signals.marketIntel?.demandSignals?.length || 0) +
    (signals.trends?.length || 0);

  console.log(`[IdeaBot] Signals: ${signalCount} total (${signals.leadPains?.length} lead pains, ${signals.redditSignals?.length} reddit, ${signals.marketIntel?.demandSignals?.length} market)`);

  if (signalCount < 5) {
    console.log("[IdeaBot] Not enough signals yet. Skipping today.");
    db.close();
    return;
  }

  const signalsText = formatSignalsForPrompt(signals);
  console.log("[IdeaBot] Generating ideas via GPT-5.4...");

  const ideas = await generateIdeas(signalsText, db);
  console.log(`[IdeaBot] Generated ${ideas.length} ideas`);

  await sendIdeaCard(db, ideas, signalCount, signals);

  setIntelligence(db, BOT_NAME, "meta", "last_run", {
    ranAt: new Date().toISOString(),
    signalCount,
    ideasGenerated: ideas.length
  });

  heartbeat(db, BOT_NAME, "IdeaBot", `done — ${ideas.length} ideas sent`, {}, {
    status: ideas.length > 0 ? "ok" : "degraded",
    last_success_at: ideas.length > 0 ? new Date().toISOString() : null,
    error: null
  });
  try { clearError(db, BOT_NAME); } catch {}

  // Record last run time for cooldown
  try { writeFileSync(LAST_RUN_FILE, JSON.stringify({ ran_at: new Date().toISOString(), ideas: ideas.length })); } catch {}

  db.close();
  console.log(`[IdeaBot] Done. ${ideas.length} ideas sent to Kirill.`);
}

// ── LIVE MODE (24/7 процесс) ──────────────────────────────────────────────────
async function liveMode() {
  console.log(`[IdeaBot] Starting in LIVE mode (runs every day at 7 AM)...`);

  while (true) {
    try {
      // Проверить время — запускать только в 7 AM
      const now = new Date();
      const hour = now.getHours();

      if (hour === 7 || hour === 13 || hour === 19) { // 3x per day
        console.log(`[IdeaBot] Running idea generation cycle...`);
        await runIdeaBot();
        await new Promise(r => setTimeout(r, 5 * 60 * 60 * 1000)); // sleep 5h
      } else {
        await new Promise(r => setTimeout(r, 60 * 60 * 1000));
      }
    } catch (err) {
      console.error(`[IdeaBot] Error in live mode:`, err.message);
      try { const edb = getDb(); heartbeat(edb, BOT_NAME, "IdeaBot", "error", {}, { status: "error", last_success_at: null, error: err.message }); reportError(edb, BOT_NAME, "IdeaBot", err.message, "crash", "liveMode"); edb.close(); } catch {}
      await new Promise(r => setTimeout(r, 60 * 60 * 1000)); // retry in 1 hour
    }
  }
}

import { fileURLToPath as _ftu } from "url";
if (process.argv[1] === _ftu(import.meta.url)) {
  const isLive = process.argv.includes("live");
  if (isLive) {
    liveMode().catch(err => {
      console.error(`[IdeaBot] Fatal error:`, err);
      process.exit(1);
    });
  } else {
    runIdeaBot().catch(console.error);
  }
}
