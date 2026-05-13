/**
 * PHILIPPINES BOT — Dedicated Market Entry Agent
 *
 * Задача: сделать Кирилла лидером мнения на рынке Филиппин.
 *
 * ФАЗА 1 — РАЗВЕДКА: каналы, influencers, ниши (запускается всегда)
 * ФАЗА 2 — ПРИСУТСТВИЕ: мониторинг Reddit/Facebook/PH boards (ежедневно)
 * ФАЗА 3 — ВИДИМОСТЬ: контент под PH аудиторию (когда есть присутствие)
 * ФАЗА 4 — ЛИДЫ: горячие PH consulting запросы → в основной pipeline
 *
 * Расписание: каждые 6 часов
 * Логика: каждая фаза зависит от результатов предыдущей
 */

import {
  getDb, callAI, tgSendToKirill, heartbeat,
  setIntelligence, getIntelligenceKey, createTask,
  emitEvent, logActivity, env, MODEL_STRONG, MODEL_MINI,
  sendMessage
} from "./orchestrator.mjs";
import { webSearch } from "../search-client.mjs";

const BOT_NAME = "ph-bot";
const BRAVE_KEY = env.BRAVE_SEARCH_API_KEY;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function braveSearch(query, count = 5) {
  if (!BRAVE_KEY) return [];
  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}&freshness=pm`;
    const res = await fetch(url, {
      headers: { "Accept": "application/json", "Accept-Encoding": "gzip", "X-Subscription-Token": BRAVE_KEY },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.web?.results || [];
  } catch { return []; }
}

async function redditFetch(subreddit, sort = "new", limit = 25) {
  try {
    const res = await fetch(
      `https://www.reddit.com/r/${subreddit}/${sort}.json?limit=${limit}`,
      { headers: { "User-Agent": "PHBot/1.0" }, signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data?.data?.children?.map(c => c.data) || [];
  } catch { return []; }
}

// ── ФАЗА 1: РАЗВЕДКА ─────────────────────────────────────────────────────────
// Запускается раз в неделю — строит карту рынка

async function phaseRecon(db) {
  console.log("[PHBot] Phase 1: Market Recon...");

  // 1.1 Найти все каналы где PH founders тусуются
  const channelQueries = [
    "Philippines entrepreneurs Facebook group automation AI 2026",
    "Manila startup community Slack Discord 2026",
    "Philippines n8n zapier automation community forum",
    "BuhayDigital Philippines tech founders community",
    "Philippines SaaS founders group online community",
  ];

  const channelsFound = [];
  for (const q of channelQueries) {
    const results = await braveSearch(q, 5);
    results.forEach(r => {
      if (r.url && !r.url.includes("linkedin.com")) {
        channelsFound.push({ title: r.title, url: r.url, snippet: r.description?.slice(0, 150) });
      }
    });
    await new Promise(r => setTimeout(r, 400));
  }

  // 1.2 Найти PH influencers в automation/AI
  const influencerQueries = [
    "Philippines AI automation influencer LinkedIn thought leader 2026",
    "top Philippines tech founders automation workflow",
    "BPO automation Philippines expert consultant",
  ];

  const influencers = [];
  for (const q of influencerQueries) {
    const results = await braveSearch(q, 5);
    results.filter(r => r.url?.includes("linkedin.com")).forEach(r => {
      influencers.push({ name: r.title?.split("|")[0]?.trim(), url: r.url, bio: r.description?.slice(0, 100) });
    });
    await new Promise(r => setTimeout(r, 400));
  }

  // 1.3 Найти горячие ниши — где automation нужна прямо сейчас
  const nicheResult = await callAI(
    `You are a market research analyst. Based on Philippines business context in 2026, identify the top 5 niches where AI/workflow automation consulting is most urgently needed right now.

Context: Philippines has 92% AI awareness, 65% of enterprises in pilot mode. BPO sector is massive ($30B+). Fintech growing fast (GCash, Maya). Ecommerce booming. Many SMBs still fully manual.

Return JSON: {"niches": [{"name": "niche name", "why_urgent": "one sentence", "example_companies": "types of companies", "estimated_projects": "avg project size USD", "how_to_reach": "where to find them online"}]}`,
    "Philippines automation consulting niches 2026",
    MODEL_STRONG
  );

  let niches = [];
  try {
    const resultStr = typeof nicheResult === "string" ? nicheResult : JSON.stringify(nicheResult);
    const json = resultStr?.match(/\{[\s\S]*\}/)?.[0];
    if (!json) {
      console.warn("[PHBot] ⚠️ No JSON found in niches response. Raw response:", resultStr?.slice(0, 200));
    } else {
      const parsed = JSON.parse(json);
      niches = parsed.niches || [];
      if (!niches.length) console.warn("[PHBot] ⚠️ Parsed JSON but niches array is empty");
    }
  } catch (e) {
    const raw = typeof nicheResult === "string" ? nicheResult : JSON.stringify(nicheResult);
    console.error("[PHBot] ❌ Failed to parse niches JSON:", e.message);
    console.error("[PHBot] Raw response:", raw?.slice(0, 300));
  }

  // Сохранить разведку
  setIntelligence(db, BOT_NAME, "recon", "channels", channelsFound.slice(0, 20), 90);
  setIntelligence(db, BOT_NAME, "recon", "influencers", influencers.slice(0, 15), 85);
  setIntelligence(db, BOT_NAME, "recon", "niches", niches, 90);
  setIntelligence(db, BOT_NAME, "recon", "last_run", new Date().toISOString());

  console.log(`[PHBot] Recon: ${channelsFound.length} channels, ${influencers.length} influencers, ${niches.length} niches`);
  return { channelsFound, influencers, niches };
}

// ── ФАЗА 2: МОНИТОРИНГ ───────────────────────────────────────────────────────
// Запускается каждый run — ищет свежие сигналы

async function phasePresence(db) {
  console.log("[PHBot] Phase 2: Daily Monitoring...");

  const signals = [];

  // 2.1 Reddit PH каналы
  const phSubreddits = ["buhaydigital", "phdigitalnomads", "Philippines", "phcareers"];
  for (const sub of phSubreddits) {
    const posts = await redditFetch(sub, "new", 20);
    for (const p of posts) {
      const text = `${p.title} ${p.selftext || ""}`.toLowerCase();
      const automationKeywords = ["automate", "automation", "workflow", "n8n", "zapier", "ai tool", "manual process", "consultant", "hire", "outsource", "system", "crm", "integration"];
      if (!automationKeywords.some(k => text.includes(k))) continue;
      const ageDays = (Date.now() / 1000 - p.created_utc) / 86400;
      if (ageDays > 3) continue;

      signals.push({
        type: "reddit",
        subreddit: sub,
        title: p.title,
        body: (p.selftext || "").slice(0, 300),
        url: `https://reddit.com${p.permalink}`,
        author: p.author,
        upvotes: p.score,
        comments: p.num_comments,
        ageDays: Math.round(ageDays * 10) / 10,
        isOpportunity: text.includes("hire") || text.includes("consultant") || text.includes("help") || text.includes("looking for")
      });
    }
    await new Promise(r => setTimeout(r, 500));
  }

  // 2.2 Brave: PH job boards и communities
  const phJobQueries = [
    "site:kalibrr.com automation workflow n8n AI consultant",
    "site:onlinejobs.ph automation workflow AI systems",
    "Philippines startup hiring automation consultant n8n zapier 2026",
    "\"Philippines\" \"looking for\" automation consultant workflow AI",
  ];

  for (const q of phJobQueries) {
    const results = await braveSearch(q, 5);
    results.forEach(r => {
      signals.push({
        type: "job_board",
        title: r.title,
        body: r.description?.slice(0, 300) || "",
        url: r.url,
        isOpportunity: true
      });
    });
    await new Promise(r => setTimeout(r, 400));
  }

  // 2.3 PH tech news — что сейчас горячо
  const newsQueries = [
    "Philippines AI automation business news 2026",
    "Philippines startup automation funding 2026",
    "BPO Philippines AI transformation 2026",
  ];

  const news = [];
  for (const q of newsQueries) {
    const results = await braveSearch(q, 3);
    results.forEach(r => news.push({ title: r.title, url: r.url, snippet: r.description?.slice(0, 150) }));
    await new Promise(r => setTimeout(r, 400));
  }

  // Сохранить
  setIntelligence(db, BOT_NAME, "monitoring", "signals", signals.slice(0, 30), 80);
  setIntelligence(db, BOT_NAME, "monitoring", "news", news.slice(0, 10), 75);
  setIntelligence(db, BOT_NAME, "monitoring", "last_run", new Date().toISOString());

  const opportunities = signals.filter(s => s.isOpportunity);
  console.log(`[PHBot] Monitoring: ${signals.length} signals, ${opportunities.length} opportunities`);
  return { signals, news, opportunities };
}

// ── ФАЗА 3: ВИДИМОСТЬ ────────────────────────────────────────────────────────
// Запускается когда есть активность — создаёт контент и находит треды для комментариев

async function phaseVisibility(db, signals) {
  console.log("[PHBot] Phase 3: Visibility...");

  // 3.1 Найти треды где экспертный комментарий даст охват
  // ТОЛЬКО buhaydigital и phdigitalnomads — бизнес/tech аудитория
  // r/Philippines — слишком широкий (новости, политика, армия) — исключить
  const VISIBILITY_SUBREDDITS = new Set(["buhaydigital", "phdigitalnomads"]);
  // Требуем явные бизнес/tech термины — не просто технические слова
  const EXPERT_KEYWORDS = ["automate", "automation", "workflow", "n8n", "zapier", "make.com", "airtable", "notion", "crm", "ai tool", "chatgpt", "openai", "llm", "freelance", "client", "agency", "startup", "saas", "outsource", "virtual assistant", "va", "remote work", "productivity tool", "learn", "course", "skill"];
  const visibilityThreads = signals
    .filter(s =>
      s.type === "reddit" &&
      VISIBILITY_SUBREDDITS.has(s.subreddit) &&
      s.comments >= 3 &&
      s.ageDays <= 2 &&
      !s.isOpportunity &&
      EXPERT_KEYWORDS.some(k => `${s.title} ${s.body}`.toLowerCase().includes(k))
    )
    .sort((a, b) => (b.upvotes + b.comments * 3) - (a.upvotes + a.comments * 3))
    .slice(0, 3);

  setIntelligence(db, BOT_NAME, "visibility", "comment_opportunities", visibilityThreads, 85);

  // 3.1b Для каждого треда — сгенерировать комментарий и отправить карточку
  for (const thread of visibilityThreads) {
    const comment = await generateExpertComment(thread);
    await sendThreadCard(db, thread, comment);
    await new Promise(r => setTimeout(r, 600));
  }

  // 3.2 Проверить: достаточно ли PH контактов для поста?
  const { default: Database } = await import("better-sqlite3");
  const mainDb = new Database(".data/linkedin-brand-os.sqlite");
  const phContacts = mainDb.prepare(
    "SELECT COUNT(*) as c FROM leads WHERE source_platform='linkedin_ph' AND stage IN ('contacted','replied','won')"
  ).get();
  mainDb.close();

  const readyForPost = phContacts.c >= 10;
  console.log(`[PHBot] PH contacts: ${phContacts.c}/10 needed for post`);

  if (readyForPost) {
    // NO automatic content generation — save as content idea, Kirill decides
    // Old: createTask for ContentBot. New: save to content_ideas.
    setIntelligence(db, "content-bot", "content_ideas", `ph_market_${Date.now()}`, {
      title: "Philippines market entry post",
      market: "Philippines",
      hook: "AI automation is transforming Philippine business — but most are still doing it manually",
      source: "ph-bot",
      savedAt: new Date().toISOString(),
    }, 30);
    console.log("[PHBot] Saved PH content idea (no auto-generation)");
    if (false) { // DISABLED — no auto content
    createTask(db, {
      fromBot: BOT_NAME,
      toBot: "content_factory",
      taskType: "draft_market_post",
      payload: {
        market: "Philippines",
        angle: "AI automation is transforming Philippine business — but most are still doing it manually",
        instructions: `Write a LinkedIn post targeting Filipino founders and ops directors.
Philippines context: BPO sector huge, GCash/Maya fintech ecosystem, 92% AI awareness but most SMBs still manual.
Use hashtags: #Philippines #ManilaTech #BuhayDigital #PhilippinesBusiness #AutomationPH
Show understanding of local culture: team-oriented, relationships first, practical ROI focus.
Kirill voice — no hype, real systems talk, specific examples.
Goal: Filipino founders see this → follow Kirill → DM about automation project.`
      },
      priority: 8
    });
    } // end if(false)

  }

  return { visibilityThreads, readyForPost, phContactCount: phContacts.c };
}

// ── ФАЗА 4: ЛИДЫ ─────────────────────────────────────────────────────────────
// Квалифицирует opportunity signals и передаёт в основной pipeline

async function phaseLeads(db, opportunities) {
  console.log(`[PHBot] Phase 4: Qualifying ${opportunities.length} opportunities...`);

  let saved = 0;
  for (const opp of opportunities.slice(0, 5)) {
    // Проверка — не дубль
    const existing = db.prepare("SELECT id FROM leads WHERE source_url=?").get(opp.url);
    if (existing) continue;

    const scoring = await callAI(
      `You are a B2B sales analyst. Score this Philippines automation opportunity 0-100. Return JSON:
{"score": number, "pain": "one sentence - what they need", "service": "what Kirill would build", "urgency": "high|medium|low", "pass": true/false}
Pass=true if score>=65 and this is a real consulting project (not employment).`,
      `Title: ${opp.title}\nBody: ${opp.body}\nURL: ${opp.url}`,
      MODEL_MINI
    );

    let parsed = null;
    try { parsed = JSON.parse(scoring?.match(/\{[\s\S]*\}/)?.[0]); } catch {}
    if (!parsed?.pass || parsed.score < 65) continue;

    const { randomUUID } = await import("crypto");
    const leadId = randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO leads (id, name, source, source_platform, source_url, location,
        score, pain_description, service_match, notes, stage, first_signal_at, created_at, updated_at)
      VALUES (?, ?, 'ph_bot', 'ph_market', ?, 'Philippines', ?, ?, ?, ?, 'new', ?, ?, ?)
    `).run(
      leadId,
      opp.title?.slice(0, 80) || "PH Lead",
      opp.url, parsed.score, parsed.pain, parsed.service, parsed.pain,
      now, now, now
    );

    emitEvent(db, {
      fromBot: BOT_NAME,
      eventType: "lead_found",
      payload: { leadId, platform: "ph_market", score: parsed.score, pain: parsed.pain, urgency: parsed.urgency }
    });

    saved++;
    console.log(`[PHBot] ✅ PH Lead saved [${parsed.score}]: ${opp.title?.slice(0, 60)}`);
    await new Promise(r => setTimeout(r, 500));
  }

  return saved;
}

// ── ГЕНЕРАЦИЯ ЭКСПЕРТНОГО КОММЕНТАРИЯ ────────────────────────────────────────

async function generateExpertComment(thread) {
  const prompt = `You are Kirill D. — AI workflow architect from Calgary. You build n8n/LLM automation systems for agencies and ops-heavy businesses. You write in a direct, practical tone — no buzzwords, no hype, just systems that work.

Write an expert Reddit comment for this thread. The comment should:
- Start with a genuine insight or experience, NOT "Great question!" or "As an AI expert..."
- Be 3-5 sentences max (Reddit comments are short)
- Show real expertise — mention specific tools/approaches (n8n, LLMs, specific workflow patterns)
- End with an open question or practical offer to help
- Sound like a practitioner, not a consultant selling something
- If relevant, mention you work with Philippines businesses remotely

Thread subreddit: r/${thread.subreddit}
Thread title: ${thread.title}
Thread body: ${thread.body?.slice(0, 400) || "(no body)"}

Return ONLY the comment text. No quotes, no explanation.`;

  const comment = await callAI(prompt, `ph_comment_${thread.url}`, MODEL_STRONG, false);
  return comment?.trim() || null;
}

// ── ОТПРАВКА КАРТОЧКИ ТРЕДА ───────────────────────────────────────────────────

async function sendThreadCard(db, thread, comment) {
  // Уникальный ключ для треда (короткий)
  const threadKey = Buffer.from(thread.url).toString("base64").slice(-20).replace(/[+/=]/g, "x");

  // Проверить — не отправляли уже эту карточку
  const alreadySent = getIntelligenceKey(db, BOT_NAME, "thread_cards", threadKey);
  if (alreadySent) return;

  const card = [
    `🇵🇭 <b>Тред для комментария</b> · r/${thread.subreddit}`,
    ``,
    `<b>${thread.title}</b>`,
    `${thread.upvotes} upvotes · ${thread.comments} комментов`,
    ``,
    `<b>✍️ Готовый комментарий (скопируй и вставь):</b>`,
    ``,
    thread.comment || comment || "(комментарий не сгенерирован)",
    ``,
    `<a href="${thread.url}">➡️ Открыть тред</a>`,
  ].join("\n");

  const result = await tgSendToKirill(card, {
    reply_markup: {
      inline_keyboard: [[
        { text: "✅ Прокомментировал", callback_data: `ph_commented:${threadKey}` },
        { text: "❌ Пропустить", callback_data: `ph_skip:${threadKey}` }
      ]]
    }
  });

  // Сохранить: ключ → статус + message_id
  const msgId = result?.result?.message_id;
  setIntelligence(db, BOT_NAME, "thread_cards", threadKey, {
    url: thread.url,
    title: thread.title,
    comment: comment,
    tg_message_id: msgId,
    status: "sent",
    sentAt: new Date().toISOString()
  });

  console.log(`[PHBot] Thread card sent: ${thread.title?.slice(0, 50)}`);
}

// ── ЕЖЕНЕДЕЛЬНЫЙ БРИФИНГ ─────────────────────────────────────────────────────

async function sendWeeklyBrief(db, recon, monitoring, visibility, leadsFound) {
  const niches = recon.niches?.slice(0, 3) || [];
  const channels = recon.channelsFound?.slice(0, 5) || [];
  const facebookGroups = channels.filter(c => c.url?.includes("facebook.com"));

  const lines = [
    `🇵🇭 <b>Philippines Market Report</b>`,
    ``,
    `<b>🔥 Горячие ниши прямо сейчас:</b>`,
  ];

  niches.forEach(n => lines.push(`• <b>${n.name}</b> — ${n.why_urgent}`));

  if (facebookGroups.length > 0) {
    lines.push(`\n<b>📱 Facebook Groups для вступления:</b>`);
    facebookGroups.slice(0, 3).forEach(g => lines.push(`• <a href="${g.url}">${g.title?.slice(0, 60)}</a>`));
  }

  lines.push(`\n<b>📊 Статус:</b>`);
  lines.push(`• Сигналов найдено: ${monitoring.signals?.length || 0}`);
  lines.push(`• Лидов квалифицировано: ${leadsFound}`);
  lines.push(`• PH контактов LinkedIn: ${visibility.phContactCount}/10 для поста`);

  if (!visibility.readyForPost) {
    lines.push(`\n<i>Пост выйдет автоматически когда будет 10+ PH контактов в сети.</i>`);
  }

  const threadCount = visibility.visibilityThreads?.length || 0;
  if (threadCount > 0) {
    lines.push(`\n<i>Карточки с комментариями для ${threadCount} трендовых тредов отправлены выше ↑</i>`);
  }

  lines.push(`\n<b>👇 Выбери нишу — система найдёт лидов, профили и подготовит контент:</b>`);

  // Save niches for callback lookup
  for (const [i, n] of niches.entries()) {
    const nicheKey = `ph_niche_${Date.now()}_${i}`;
    setIntelligence(db, BOT_NAME, "niche_cards", nicheKey, {
      name: n.name,
      why_urgent: n.why_urgent,
      market: "Philippines",
    }, 14);
  }

  const nicheButtons = niches.map((n, i) => [{
    text: `🎯 ${n.name.slice(0, 35)}`,
    callback_data: `ph_target_niche:${i}`,
  }]);

  await tgSendToKirill(lines.join("\n"), {
    reply_markup: { inline_keyboard: [
      ...nicheButtons,
      [{ text: "🤖 Меню", callback_data: "menu" }],
    ]}
  });

  // Save niches list for callback handler
  setIntelligence(db, BOT_NAME, "report", "latest_niches", niches.slice(0, 3), 14);
}

// ── MAIN ──────────────────────────────────────────────────────────────────────

export async function runPHBot() {
  const db = getDb();
  heartbeat(db, BOT_NAME, "Philippines Bot", "starting");

  const now = new Date();
  const dayOfWeek = now.getUTCDay(); // 0=Sun, 1=Mon
  const lastRecon = getIntelligenceKey(db, BOT_NAME, "recon", "last_run");
  const reconAge = lastRecon
    ? (Date.now() - new Date(lastRecon).getTime()) / (1000 * 3600)
    : 999;

  // Фаза 1 — раз в неделю (Monday) или если никогда не запускалась
  let recon = { channelsFound: [], influencers: [], niches: [] };
  if (dayOfWeek === 1 || reconAge > 120) {
    recon = await phaseRecon(db);
  } else {
    // Загрузить из кэша
    recon.channelsFound = getIntelligenceKey(db, BOT_NAME, "recon", "channels") || [];
    recon.influencers   = getIntelligenceKey(db, BOT_NAME, "recon", "influencers") || [];
    recon.niches        = getIntelligenceKey(db, BOT_NAME, "recon", "niches") || [];
    console.log("[PHBot] Phase 1: Using cached recon data");
  }

  // Фаза 2 — каждый запуск
  const monitoring = await phasePresence(db);

  // Фаза 3 — видимость (зависит от phase 2)
  const visibility = await phaseVisibility(db, monitoring.signals);

  // Фаза 4 — лиды (зависит от phase 2)
  const leadsFound = await phaseLeads(db, monitoring.opportunities);

  // Отправить сигналы в IdeaBot если есть горячие ниши
  if (recon.niches?.length > 0) {
    for (const niche of recon.niches.slice(0, 3)) {
      sendMessage(db, {
        fromBot: BOT_NAME,
        toBot: "idea-bot",
        messageType: "ph_market_signal",
        payload: {
          niche: niche.name,
          urgency: niche.why_urgent,
          companies: niche.example_companies,
          projectSize: niche.estimated_projects,
          reach: niche.how_to_reach,
          market: "Philippines"
        },
        priority: 8
      });
    }
    console.log(`[PHBot] Sent ${recon.niches.slice(0, 3).length} PH market signals to IdeaBot`);
  }

  // Еженедельный брифинг — по понедельникам или при первом запуске
  const lastBrief = getIntelligenceKey(db, BOT_NAME, "meta", "last_brief");
  const briefAge = lastBrief ? (Date.now() - new Date(lastBrief).getTime()) / (1000 * 3600) : 999;

  if (briefAge > 72 || dayOfWeek === 1) {
    await sendWeeklyBrief(db, recon, monitoring, visibility, leadsFound);
    setIntelligence(db, BOT_NAME, "meta", "last_brief", new Date().toISOString());
  }

  heartbeat(db, BOT_NAME, "Philippines Bot",
    `done — ${monitoring.signals.length} signals, ${leadsFound} leads, PH contacts: ${visibility.phContactCount}/10`
  );

  console.log(`[PHBot] Complete. Signals: ${monitoring.signals.length}, Leads: ${leadsFound}, PH contacts: ${visibility.phContactCount}/10`);
  db.close();
}

// ── LIVE MODE (24/7 процесс) ──────────────────────────────────────────────────
async function liveMode() {
  console.log(`[PHBot] Starting in LIVE mode (runs every 12 hours)...`);

  while (true) {
    try {
      console.log(`[PHBot] Running Philippines market scan...`);
      await runPHBot();

      // Спать 12 часов
      console.log(`[PHBot] Sleeping 12 hours until next scan...`);
      await new Promise(r => setTimeout(r, 12 * 60 * 60 * 1000));
    } catch (err) {
      console.error(`[PHBot] Error in live mode:`, err.message);
      await new Promise(r => setTimeout(r, 60 * 60 * 1000)); // retry in 1 hour
    }
  }
}

import { fileURLToPath as _ftu } from "url";
if (process.argv[1] === _ftu(import.meta.url)) {
  const isLive = process.argv.includes("live");
  if (isLive) {
    liveMode().catch(err => {
      console.error(`[PHBot] Fatal error:`, err);
      process.exit(1);
    });
  } else {
    runPHBot().catch(console.error);
  }
}
