/**
 * PR BOT — Global Market Intelligence Commander
 *
 * Runs weekly (Monday 8 AM). The brain that connects all bots toward ONE goal.
 *
 * What it does:
 * 1. Reads market heat data from ResearchBot — which countries are heating up
 * 2. Picks #1 target market for the week
 * 3. Finds real LinkedIn profiles from that market (founders/owners with automation pain)
 * 4. Sends Kirill a weekly focus brief: "This week: Nigeria — here are 8 people to connect with"
 * 5. Saves the target market → LinkedInHunter picks it up and scans that country
 * 6. Creates a task for ContentBot to write a post about that market/pain
 *
 * WHY THIS EXISTS:
 * Without a commander, each bot scans randomly. With PRBot:
 * - ResearchBot finds hot market
 * - PRBot picks target
 * - LinkedInHunter scans that country
 * - ContentBot writes posts about that audience
 * - Kirill's LinkedIn fills with the right people seeing the right posts
 * - They reach out → deals close
 *
 * This is what it means to work as ONE organism.
 */

import { getDb, callAI, tgSendToKirill, heartbeat, setIntelligence, getIntelligenceKey, createTask, logActivity, env, sendMessage, MODEL_MINI, reportError, clearError } from "./orchestrator.mjs";
import { sendLeadCard } from "./telegram-control.mjs";
import { webSearch } from "../search-client.mjs";
import { randomUUID } from "crypto";

const BOT_NAME = "pr-bot";

const BRAVE_API_KEY = env.BRAVE_SEARCH_API_KEY;

// ── Brave Search ──────────────────────────────────────────────────────
async function braveSearch(query, count = 8) {
  if (!BRAVE_API_KEY) return [];
  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`;
    const res = await fetch(url, {
      headers: { "Accept": "application/json", "X-Subscription-Token": BRAVE_API_KEY },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.web?.results || []).map(r => ({
      title: r.title,
      url: r.url,
      description: r.description || ""
    }));
  } catch { return []; }
}

// ── Fetch LinkedIn profile text via li_at cookie ──────────────────────
async function fetchLinkedInProfile(url) {
  const liAt = env.LINKEDIN_LI_AT;
  if (!liAt) return "";
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Cookie": `li_at=${liAt}`,
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return "";
    const html = await res.text();
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 2000);
  } catch { return ""; }
}

// ── Pick the best target market for this week ─────────────────────────
function pickTargetMarket(db) {
  const week = getCurrentWeekKey();
  const heatData = getIntelligenceKey(db, "research-bot", "market_heat", `week_${week}`) || {};

  // Get previously targeted markets so we rotate
  const pastTargets = getIntelligenceKey(db, BOT_NAME, "past_targets", "history") || [];

  // Sort by heat score, skip already targeted this month
  const oneMonthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const recentTargets = new Set(
    pastTargets
      .filter(t => new Date(t.targetedAt).getTime() > oneMonthAgo)
      .map(t => t.market)
  );

  const ranked = Object.entries(heatData)
    .filter(([market]) => market !== "unknown" && !recentTargets.has(market))
    .sort((a, b) => b[1] - a[1]);

  if (ranked.length > 0) return ranked[0][0];

  // Fallback: if all markets recently targeted, pick the hottest one anyway
  const fallback = Object.entries(heatData).sort((a, b) => b[1] - a[1]);
  return fallback[0]?.[0] || null;
}

function getCurrentWeekKey() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const week = Math.ceil(((now - start) / 86400000 + start.getDay() + 1) / 7);
  return `${now.getFullYear()}_W${week}`;
}

// ── Find LinkedIn profiles from target market ─────────────────────────
async function findProfilesInMarket(market, db) {
  console.log(`[${BOT_NAME}] Finding LinkedIn profiles for market: ${market}`);

  // Build targeted LinkedIn search queries for this market
  const queries = [
    `site:linkedin.com/in "${market}" "founder" OR "owner" "startup" OR "SMB" OR "small business"`,
    `site:linkedin.com/in "${market}" "CEO" OR "managing director" "automation" OR "operations" OR "process"`,
    `site:linkedin.com/in "${market}" "founder" "fintech" OR "logistics" OR "ecommerce" OR "healthcare"`,
    `site:linkedin.com/in "${market}" "owner" "accounting" OR "law" OR "agency" OR "consulting"`,
  ];

  const candidates = [];
  for (const q of queries) {
    const results = await braveSearch(q, 5);
    for (const r of results) {
      if (r.url.includes("linkedin.com/in/")) {
        candidates.push(r);
      }
    }
    await new Promise(r => setTimeout(r, 500));
  }

  // Deduplicate by URL
  const seen = new Set();
  const unique = candidates.filter(c => {
    if (seen.has(c.url)) return false;
    seen.add(c.url);
    return true;
  });

  // Check not already in leads DB
  const fresh = unique.filter(c => {
    const exists = db.prepare("SELECT id FROM leads WHERE source_url = ?").get(c.url);
    return !exists;
  });

  console.log(`[${BOT_NAME}] Found ${fresh.length} fresh profiles in ${market}`);
  return fresh.slice(0, 12);
}

// ── Score a LinkedIn profile for relevance ────────────────────────────
async function scoreProfile(title, description, url, market) {
  try {
    const result = await callAI(
      `You are filtering LinkedIn profiles for Kirill — remote AI automation consultant.
Target market: ${market}

RELEVANT profile:
- Business owner, founder, CEO, MD, managing director, or partner
- Works in a small/medium business (not a massive corporation)
- Industry where automation helps: accounting, legal, logistics, ecommerce, healthcare, real estate, fintech, operations
- Shows any sign of manual processes, growth challenges, or operations complexity

IRRELEVANT:
- Students, job seekers, employees (not decision makers)
- Purely technical roles (devs, engineers) — unless also a founder
- Giant corporations
- Already AI/automation consultants themselves

Return JSON: { "relevant": true/false, "score": 0-100, "pain": "one-line pain hypothesis", "why": "reason" }`,
      `Name/Title: ${title}\nDescription: ${description}\nURL: ${url}`
    );
    return result;
  } catch { return { relevant: false, score: 0 }; }
}

// ── Save profiles as leads in DB ──────────────────────────────────────
async function saveProfilesAsLeads(db, profiles, market) {
  const saved = [];
  for (const p of profiles) {
    const scoring = await scoreProfile(p.title, p.description, p.url, market);
    if (!scoring?.relevant) continue;

    const leadId = randomUUID();
    const now = new Date().toISOString();
    const name = p.title.split(" - ")[0].split(" | ")[0].trim().slice(0, 100);

    // Generate 200-char connection note
    const note = await generateConnectionNote(name, p.description || p.title, market);

    db.prepare(`
      INSERT INTO leads (id, name, source, source_platform, source_url, pain_description, score, stage, notes, first_signal_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      leadId,
      name,
      "pr_bot",
      `linkedin_${market.toLowerCase().replace(/\s+/g, "_")}`,
      p.url,
      (scoring.pain || p.description || "").slice(0, 500),
      scoring.score || 55,
      "new",
      note,
      now, now, now
    );

    saved.push({ ...p, leadId, name, score: scoring.score, pain: scoring.pain, note });
    console.log(`[${BOT_NAME}] ✅ Lead saved [${market}]: ${name} (${scoring.score})`);
    await new Promise(r => setTimeout(r, 300));
  }
  return saved;
}

// ── Generate 200-char LinkedIn connection note ────────────────────────
async function generateConnectionNote(name, context, market) {
  const firstName = name.split(" ")[0] || "there";
  const raw = await callAI(
    `Write a LinkedIn connection note from Kirill (AI automation consultant, Calgary, works globally) to ${firstName}.
HARD RULE: 200 characters MAX — count every character including spaces and punctuation.
Mention one specific business pain. One concrete benefit. End with a question.
No filler. No "I came across your profile". Just direct value.
Return ONLY the note text, nothing else.`,
    `Context: ${context}\nMarket: ${market}`,
    MODEL_MINI,
    false
  );
  if (!raw) return "";
  const trimmed = raw.trim();
  if (trimmed.length <= 200) return trimmed;
  const cut = trimmed.slice(0, 197);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 150 ? cut.slice(0, lastSpace) : cut) + "...";
}

// ── Get market context for the brief ─────────────────────────────────
async function getMarketContext(market, db) {
  const marketIntel = getIntelligenceKey(db, "research-bot", "market_intelligence", "latest");
  const signals = getIntelligenceKey(db, "research-bot", "demand_signals", "latest") || [];
  const marketSignals = signals.filter(s => s.market === market);

  const context = await callAI(
    `You are advising Kirill — remote AI automation consultant — on why to focus on ${market} this week.
Write 3 sentences:
1. Why THIS market right now (growth, budget, opportunity)
2. Which industry in ${market} needs automation most (be specific)
3. One tactical tip for connecting with ${market} founders on LinkedIn
Be specific. Name companies, industries, dollar amounts if you know them. No generic advice.
Return plain text.`,
    `Market intel: ${marketIntel?.analysis || "N/A"}\nDemand signals from ${market}: ${marketSignals.length}\nSignal titles: ${marketSignals.slice(0, 3).map(s => s.title).join("; ")}`,
    MODEL_MINI,
    false
  );
  return context;
}

// ── Trigger other bots to align on this market ────────────────────────
function alignSystemOnMarket(db, market) {
  // Tell LinkedInHunter to scan this market next run
  setIntelligence(db, BOT_NAME, "current_target_market", "market", {
    market,
    startedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  }, 90);

  // NO auto content — save as idea, Kirill decides when to publish
  setIntelligence(db, "content-bot", "content_ideas", `pr_market_${Date.now()}`, {
    title: `Market post: ${market}`,
    market,
    hook: `How AI automation is transforming ${market} SMBs`,
    source: "pr-bot",
    savedAt: new Date().toISOString(),
  }, 30);

  console.log(`[${BOT_NAME}] System aligned on market: ${market}`);
}

// ── Send weekly PR brief to Kirill ────────────────────────────────────
async function sendWeeklyBrief(db, market, savedLeads, context, heatScore) {
  const lines = [
    `🎯 <b>Фокус недели: ${market}</b>`,
    ``,
    `<b>Почему сейчас:</b>`,
    `<i>${context || "Быстрорастущий рынок с низкой конкуренцией среди AI консультантов."}</i>`,
    ``,
    `<b>📊 Сигналов за неделю: ${heatScore}</b>`,
    ``,
  ];

  if (savedLeads.length > 0) {
    lines.push(`<b>LinkedIn профили для подключения (${savedLeads.length}):</b>`);
    lines.push(`<i>Карточки с кнопками идут ниже 👇</i>`);
    lines.push(``);
    lines.push(`<b>✅ Что делать:</b>`);
    lines.push(`1. Открой каждую карточку → нажми Профиль → подключись с заметкой (200 символов)`);
  } else {
    lines.push(`<i>Профилей пока нет — LinkedInHunter не нашёл qualified leads для ${market}. Скоро повторит поиск.</i>`);
  }

  await tgSendToKirill(lines.join("\n"), {
    reply_markup: { inline_keyboard: [[{ text: "🤖 Меню", callback_data: "menu" }]] }
  });

  // Send each lead card with buttons
  for (let i = 0; i < savedLeads.length; i++) {
    const lead = db.prepare("SELECT * FROM leads WHERE id = ?").get(savedLeads[i].leadId);
    if (lead) {
      await new Promise(r => setTimeout(r, 700));
      await sendLeadCard(lead, i + 1);
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────
export async function runPRBot() {
  const db = getDb();
  heartbeat(db, BOT_NAME, "PR Bot", "running");
  console.log(`[${BOT_NAME}] Starting weekly PR intelligence sweep...`);

  try {
    // 1. Pick target market from ResearchBot's heat data
    const market = pickTargetMarket(db);

    if (!market) {
      console.log(`[${BOT_NAME}] No market data yet — ResearchBot needs to run first.`);
      await tgSendToKirill(`🎯 <b>PR Bot:</b> Пока нет данных о горячих рынках. ResearchBot работает ночью и соберёт сигналы. Запусти его вручную: <code>node scripts/factory/run-factory.mjs research</code>`);
      db.close();
      return;
    }

    const week = getCurrentWeekKey();
    const heatData = getIntelligenceKey(db, "research-bot", "market_heat", `week_${week}`) || {};
    const heatScore = heatData[market] || 0;

    console.log(`[${BOT_NAME}] Target market: ${market} (heat score: ${heatScore})`);

    // 2. Get market context (why this market, what industry, tactical tips)
    const context = await getMarketContext(market, db);

    // 3. Find LinkedIn profiles from this market
    const profiles = await findProfilesInMarket(market, db);

    // 4. Score and save as leads
    const savedLeads = await saveProfilesAsLeads(db, profiles, market);

    // 5. Record this market as targeted
    const pastTargets = getIntelligenceKey(db, BOT_NAME, "past_targets", "history") || [];
    pastTargets.push({ market, heatScore, targetedAt: new Date().toISOString() });
    setIntelligence(db, BOT_NAME, "past_targets", "history", pastTargets.slice(-20), 365);

    // 6. Align all other bots on this market
    alignSystemOnMarket(db, market);

    // 6b. Отправить сигнал в ContentBot через event bus
    sendMessage(db, {
      fromBot: BOT_NAME,
      toBot: "content-bot",
      messageType: "market_focus",
      payload: {
        market,
        heatScore,
        context,
        angle: `How AI automation is transforming ${market} SMBs`,
        instructions: `Write a LinkedIn post specifically for ${market} business owners. Show you understand their market. Mention a specific local industry. Goal: founders from ${market} see this and DM Kirill.`
      },
      priority: 9
    });

    console.log(`[${BOT_NAME}] Sent market_focus signal to ContentBot: ${market}`);

    // 7. Send brief to Kirill
    await sendWeeklyBrief(db, market, savedLeads, context, heatScore);

    logActivity(db, BOT_NAME, "weekly_brief_sent", {
      market,
      heatScore,
      profilesFound: profiles.length,
      leadsSaved: savedLeads.length
    });

    console.log(`[${BOT_NAME}] Done. Market: ${market}, Leads: ${savedLeads.length}`);
    heartbeat(db, BOT_NAME, "PR Bot", `done — ${market}, ${savedLeads.length} leads`, {}, {
      status: savedLeads.length > 0 ? "ok" : "degraded",
      last_success_at: new Date().toISOString(),
      error: null
    });
    try { clearError(db, BOT_NAME); } catch {}
  } catch (e) {
    console.error(`[${BOT_NAME}] Fatal error:`, e.message);
    heartbeat(db, BOT_NAME, "PR Bot", `error — ${e.message}`, {}, {
      status: "error",
      last_success_at: null,
      error: e.message
    });
  } finally {
    db.close();
  }
}

// ── LIVE MODE (24/7 процесс) ──────────────────────────────────────────────────
async function processMessages() {
  const { getDb, pollMessages, markMessageActedOn } = await import("./orchestrator.mjs");
  const db = getDb();
  try {
    const messages = pollMessages(db, "pr-bot", 5);
    for (const msg of messages) {
      console.log(`[${BOT_NAME}] Got message: ${msg.message_type} from ${msg.from_bot}`);
      if (msg.message_type === "market_focus") {
        // Someone requested market focus change
        await runPRBot();
      }
      markMessageActedOn(db, msg.id, { processed: true });
    }
  } finally { db.close(); }
}

async function liveMode() {
  console.log(`[${BOT_NAME}] Starting in LIVE mode (Monday 8AM + check messages every 10min)...`);
  let lastFullRun = 0;

  while (true) {
    try {
      const now = new Date();
      const dayOfWeek = now.getDay();
      const hour = now.getHours();

      if (dayOfWeek === 1 && hour === 8 && Date.now() - lastFullRun > 20 * 60 * 60 * 1000) {
        await runPRBot();
        lastFullRun = Date.now();
      }

      await processMessages();
      await new Promise(r => setTimeout(r, 10 * 60 * 1000));
    } catch (err) {
      console.error(`[${BOT_NAME}] Error in live mode:`, err.message);
      try { const edb = getDb(); reportError(edb, BOT_NAME, "PR Bot", err.message, "crash", "liveMode"); edb.close(); } catch {}
      await new Promise(r => setTimeout(r, 10 * 60 * 1000));
    }
  }
}

import { fileURLToPath } from "url";
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const isLive = process.argv.includes("live");
  if (isLive) {
    liveMode().catch(err => {
      console.error(`[${BOT_NAME}] Fatal error:`, err);
      process.exit(1);
    });
  } else {
    runPRBot().catch(console.error);
  }
}
