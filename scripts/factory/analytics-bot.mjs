/**
 * ANALYTICS BOT — @LBO_Analytics_bot
 * Аналитик и обучающий движок. Работает ежедневно.
 *
 * Задачи:
 * 1. Каждые 21:00 — статус фабрики за день
 * 2. Каждое воскресенье — полный отчёт с рекомендациями
 * 3. Обучает другие боты на основе данных
 * 4. Следит за "живостью" всех ботов
 * 5. Считает ROI системы (доход vs расходы на API)
 */

import { getDb, BOTS, CHAT_ID, callAI, tgSend, tgSendToKirill, heartbeat, createTask, setIntelligence, getIntelligence, logActivity, sendMessage, reportError, clearError } from "./orchestrator.mjs";

const BOT_TOKEN = BOTS.analytics.token;
const BOT_ID = "analytics";

// ── Gather stats ─────────────────────────────────────────────────────
function getDailyStats(db) {
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  const leads = {
    total: db.prepare(`SELECT COUNT(*) as c FROM leads`).get().c,
    new_today: db.prepare(`SELECT COUNT(*) as c FROM leads WHERE created_at >= ?`).get(today + "T00:00:00").c,
    hot: db.prepare(`SELECT COUNT(*) as c FROM leads WHERE score >= 70 AND stage NOT IN ('won','lost')`).get().c,
    contacted: db.prepare(`SELECT COUNT(*) as c FROM leads WHERE stage = 'contacted'`).get().c,
    proposals: db.prepare(`SELECT COUNT(*) as c FROM leads WHERE stage = 'proposal_sent'`).get().c,
    won: db.prepare(`SELECT COUNT(*) as c FROM leads WHERE stage = 'won'`).get().c
  };

  const deals = {
    pipeline: db.prepare(`SELECT COALESCE(SUM(amount),0) as s FROM deals WHERE status = 'proposed'`).get().s,
    closed_total: db.prepare(`SELECT COALESCE(SUM(amount),0) as s FROM deals WHERE status IN ('active','delivered')`).get().s,
    mrr: db.prepare(`SELECT COALESCE(SUM(recurring_monthly),0) as s FROM deals WHERE status = 'active'`).get().s,
    count: db.prepare(`SELECT COUNT(*) as c FROM deals WHERE status IN ('active','delivered')`).get().c
  };

  const posts = {
    total: db.prepare(`SELECT COUNT(*) as c FROM published_posts`).get().c,
    published: db.prepare(`SELECT COUNT(*) as c FROM published_posts WHERE status = 'published'`).get().c,
    this_week: db.prepare(`SELECT COUNT(*) as c FROM published_posts WHERE published_at >= ?`).get(weekAgo).c,
    avg_score: db.prepare(`SELECT COALESCE(AVG(performance_score),0) as a FROM published_posts WHERE status = 'published'`).get().a
  };

  const bots = db.prepare(`SELECT * FROM bot_heartbeats WHERE bot_id NOT IN ('sales_offset')`).all();
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const activeBots = bots.filter(b => b.pinged_at >= fiveMinAgo);

  const tasks = {
    pending: db.prepare(`SELECT COUNT(*) as c FROM bot_tasks WHERE status = 'pending'`).get().c,
    done_today: db.prepare(`SELECT COUNT(*) as c FROM bot_tasks WHERE status = 'done' AND completed_at >= ?`).get(today + "T00:00:00").c
  };

  return { leads, deals, posts, bots: { total: bots.length, active: activeBots.length, list: bots }, tasks };
}

// ── Daily status report ──────────────────────────────────────────────
async function sendDailyStatus(db) {
  const stats = getDailyStats(db);
  const { leads, deals, posts, bots, tasks } = stats;

  const modeEmoji = deals.closed_total > 20000 ? "🟢" : deals.closed_total > 5000 ? "🟡" : "🔴";
  const modeText = deals.closed_total > 20000 ? "МАСШТАБ" : deals.closed_total > 5000 ? "РОСТ" : "ОХОТА";

  let text = `<b>📊 СТАТУС ФАБРИКИ — ${new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}</b>\n\n`;

  text += `<b>💰 Финансы:</b>\n`;
  text += `  Pipeline: $${deals.pipeline.toLocaleString()} CAD\n`;
  text += `  Закрыто всего: $${deals.closed_total.toLocaleString()} CAD\n`;
  text += `  MRR (поддержка): $${deals.mrr.toLocaleString()}/мес\n`;
  text += `  Режим: ${modeEmoji} ${modeText}\n\n`;

  text += `<b>🎯 Лиды:</b>\n`;
  text += `  Всего в базе: ${leads.total}\n`;
  text += `  Горячих (70+): ${leads.hot}\n`;
  text += `  Контактировали: ${leads.contacted}\n`;
  text += `  Предложение отправлено: ${leads.proposals}\n`;
  text += `  Выиграно: ${leads.won}\n\n`;

  text += `<b>📝 Контент:</b>\n`;
  text += `  Постов опубликовано: ${posts.published}\n`;
  text += `  За эту неделю: ${posts.this_week}\n\n`;

  text += `<b>⚙️ Боты:</b>\n`;
  for (const bot of bots.list) {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const isAlive = bot.pinged_at >= fiveMinAgo;
    text += `  ${isAlive ? "🟢" : "🔴"} ${bot.bot_name} — ${bot.last_action || "нет данных"}\n`;
  }
  text += `\n<b>📋 Задач в очереди:</b> ${tasks.pending} | Выполнено сегодня: ${tasks.done_today}`;

  await tgSendToKirill(text);
}

// ── Weekly full report ───────────────────────────────────────────────
async function sendWeeklyReport(db) {
  const stats = getDailyStats(db);
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  // Best performing post this week
  const bestPost = db.prepare(`
    SELECT * FROM published_posts
    WHERE published_at >= ? AND status = 'published'
    ORDER BY performance_score DESC LIMIT 1
  `).get(weekAgo);

  // Best lead source
  const sourceStat = db.prepare(`
    SELECT source_platform, COUNT(*) as c FROM leads
    WHERE created_at >= ? GROUP BY source_platform ORDER BY c DESC LIMIT 1
  `).get(weekAgo);

  // Conversion rate
  const weekLeads = db.prepare(`SELECT COUNT(*) as c FROM leads WHERE created_at >= ?`).get(weekAgo).c;
  const weekWon = db.prepare(`SELECT COUNT(*) as c FROM leads WHERE stage = 'won' AND updated_at >= ?`).get(weekAgo).c;

  // Ask AI for strategic recommendations
  const recommendations = await callAI(
    `You are an analytics AI for Kirill D.'s LinkedIn marketing system.
Based on weekly data, give 3 specific actionable recommendations to increase revenue.
Return JSON: { "recommendations": [{ "action": "...", "reason": "...", "bot": "scout|content|sales" }] }`,
    `Weekly stats:
New leads: ${weekLeads}
Won deals: ${weekWon}
Pipeline: $${stats.deals.pipeline}
Best post topic: ${bestPost?.topic || "none"}
Best lead source: ${sourceStat?.source_platform || "unknown"}
Active leads: ${stats.leads.hot} hot leads`
  );

  let text = `<b>📈 ЕЖЕНЕДЕЛЬНЫЙ ОТЧЁТ</b>\n`;
  text += `${new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" })}\n\n`;

  text += `<b>💰 Revenue эта неделя:</b>\n`;
  text += `  Новых лидов: ${weekLeads}\n`;
  text += `  Закрыто сделок: ${weekWon}\n`;
  text += `  Pipeline: $${stats.deals.pipeline.toLocaleString()} CAD\n\n`;

  if (bestPost) {
    text += `<b>🔥 Лучший пост:</b>\n`;
    text += `  ${bestPost.topic}\n`;
    text += `  Скор: ${bestPost.performance_score}/100\n\n`;
  }

  if (sourceStat) {
    text += `<b>📡 Лучший источник лидов:</b> ${sourceStat.source_platform} (${sourceStat.c} лидов)\n\n`;
  }

  text += `<b>🧠 Рекомендации системы:</b>\n`;
  for (const rec of (recommendations.recommendations || [])) {
    const botEmoji = { scout: "🔍", content: "✍️", sales: "💼" }[rec.bot] || "⚡";
    text += `${botEmoji} ${rec.action}\n   → ${rec.reason}\n\n`;
  }

  await tgSendToKirill(text);

  // Push recommendations to relevant bots as tasks
  for (const rec of (recommendations.recommendations || [])) {
    if (rec.bot && ["scout", "content", "sales"].includes(rec.bot)) {
      createTask(db, {
        fromBot: BOT_ID,
        toBot: rec.bot,
        taskType: "strategy_update",
        payload: { action: rec.action, reason: rec.reason },
        priority: 6
      });
    }
  }
}

// NOTE: processCommands() removed — /update_post, /stats, /report
// are now handled by Orchestrator (One Voice principle, runs every 1 min).

// ── Daily content strategy push to ContentBot ─────────────────────────
// Runs at 9 AM Calgary — reads what's working and pushes direction to ContentBot
async function pushDailyContentStrategy(db) {
  try {
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();

    // What lead pains has ScoutBot been seeing?
    const allIntelligence = getIntelligence(db);
    const recentPains = allIntelligence.find(i => i.bot_id === "scout" && i.key === "recent_pains");
    const hotTopics = allIntelligence.find(i => i.bot_id === "trend" && i.key === "latest");

    // Best performing content type
    const bestPost = db.prepare(`
      SELECT topic, post_type, performance_score FROM published_posts
      WHERE published_at >= ? AND status = 'published'
      ORDER BY performance_score DESC LIMIT 3
    `).get(weekAgo);

    // How many leads came in this week?
    const weekLeads = db.prepare(`SELECT COUNT(*) as c FROM leads WHERE created_at >= ?`).get(weekAgo).c;
    const hotLeads = db.prepare(`SELECT COUNT(*) as c FROM leads WHERE score >= 70 AND created_at >= ?`).get(weekAgo).c;

    const context = [
      `Recent lead pains from ScoutBot: ${recentPains ? JSON.stringify(JSON.parse(recentPains.value_json).slice(0,3)) : "none yet"}`,
      `Hot market topics from TrendBot: ${hotTopics ? JSON.stringify(JSON.parse(hotTopics.value_json).slice(0,2).map(t => t.title)) : "none yet"}`,
      `Best post this week: ${bestPost ? `"${bestPost.topic}" (score ${bestPost.performance_score})` : "no data yet"}`,
      `Leads this week: ${weekLeads} total, ${hotLeads} hot (70+ score)`
    ].join("\n");

    const rec = await callAI(
      `You are the analytics brain for Kirill D.'s LinkedIn growth system.
Based on today's data, give ONE specific content directive for the next 24 hours.
Focus: what topic/angle will attract the most consulting clients RIGHT NOW?
Return JSON: { "action": "write about X because Y", "reason": "one sentence", "angle": "pain|trend|case_study|contrarian" }`,
      context
    );

    if (rec?.action) {
      createTask(db, {
        fromBot: BOT_ID,
        toBot: "content_factory",
        taskType: "strategy_update",
        payload: { action: rec.action, reason: rec.reason, angle: rec.angle || "trend" },
        priority: 7
      });

      setIntelligence(db, "analytics", "content_strategy", "daily_directive",
        { action: rec.action, reason: rec.reason, pushed_at: new Date().toISOString() }, 85);

      await logActivity(db, "analytics", `Стратегия дня → ContentBot: ${(rec.action || "").slice(0, 80)}`);
      console.log(`[AnalyticsBot] Daily content strategy pushed: ${rec.action}`);
    }
  } catch (err) {
    console.warn(`[AnalyticsBot] pushDailyContentStrategy error: ${err.message}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────
async function runAnalytics() {
  const db = getDb();
  heartbeat(db, BOT_ID, "AnalyticsBot", "tick");

  const hourCalgary = (new Date().getUTCHours() - 6 + 24) % 24;
  const dayOfWeek = new Date().getDay(); // 0 = Sunday

  // Daily status at 21:00 Calgary
  if (hourCalgary === 21 && new Date().getUTCMinutes() < 2) {
    await sendDailyStatus(db);
  }

  // Daily content strategy push at 09:00 Calgary — tell ContentBot what to focus on today
  if (hourCalgary === 9 && new Date().getUTCMinutes() < 2) {
    await pushDailyContentStrategy(db);
  }

  // Weekly report on Sunday at 10:00 Calgary
  if (dayOfWeek === 0 && hourCalgary === 10 && new Date().getUTCMinutes() < 2) {
    await sendWeeklyReport(db);

    // Отправить недельный отчёт в EvolutionBot
    const stats = getDailyStats(db);
    sendMessage(db, {
      fromBot: BOT_ID,
      toBot: "evolution-bot",
      messageType: "weekly_analytics",
      payload: {
        leads: stats.leads,
        deals: stats.deals,
        posts: stats.posts,
        bots: { total: stats.bots.total, active: stats.bots.active },
        tasks: stats.tasks,
        reportedAt: new Date().toISOString()
      },
      priority: 7
    });
  }

  heartbeat(db, BOT_ID, "AnalyticsBot", "tick complete", {}, {
    status: "ok",
    last_success_at: new Date().toISOString(),
    error: null
  });
  try { clearError(db, BOT_ID); } catch {}
  db.close();
}

// ── LIVE MODE (24/7 процесс) ──────────────────────────────────────────────────
async function liveMode() {
  console.log(`[AnalyticsBot] Starting in LIVE mode (runs every 6 hours)...`);

  while (true) {
    try {
      console.log(`[AnalyticsBot] Running analytics cycle...`);
      await runAnalytics();

      // Спать 6 часов
      console.log(`[AnalyticsBot] Sleeping 6 hours until next cycle...`);
      await new Promise(r => setTimeout(r, 6 * 60 * 60 * 1000));
    } catch (err) {
      console.error(`[AnalyticsBot] Error in live mode:`, err.message);
      try { const edb = getDb(); reportError(edb, BOT_ID, "AnalyticsBot", err.message, "crash", "liveMode"); edb.close(); } catch {}
      await new Promise(r => setTimeout(r, 60 * 60 * 1000)); // retry in 1 hour
    }
  }
}

import { fileURLToPath as _ftu } from "url";
import { readWiki, appendLog } from "../../wiki/reader.mjs";
if (process.argv[1] === _ftu(import.meta.url)) {
  const isLive = process.argv.includes("live");
  if (isLive) {
    liveMode().catch(err => {
      console.error(`[AnalyticsBot] Fatal error:`, err);
      process.exit(1);
    });
  } else {
    runAnalytics().catch(console.error);
  }
}

export { runAnalytics, sendDailyStatus, sendWeeklyReport };
