/**
 * SERVICE BOT — Двигатель новых услуг
 *
 * Главная петля Кирилла: найти идею → упаковать → найти покупателя → продать.
 *
 * Что делает:
 * 1. Сканирует тренды, посты, боли лидов — ищет паттерны новых услуг
 * 2. Оценивает: может ли Кирилл это делать? Кто купит? Сколько стоит?
 * 3. Упаковывает: LinkedIn пост + outreach шаблон + ICP сегмент
 * 4. Отправляет Кириллу на решение: тестировать или нет
 * 5. Если "тестировать" — создаёт задачи ContentBot + OutreachBot
 *
 * Расписание: раз в 6 часов
 */

import { randomUUID } from "crypto";
import {
  getDb, callAI, tgSendToKirill, heartbeat,
  setIntelligence, getIntelligenceKey, logActivity,
  createTask, emitEvent, reportError, clearError
} from "./orchestrator.mjs";

const BOT_ID = "service_bot";

const KIRILL_CAPABILITIES = `
Kirill D. — AI Automation Consultant, Calgary, Canada.
He CAN deliver:
- n8n workflow automation (connecting any SaaS tools, APIs, databases)
- Local AI deployments (Ollama, private LLM servers, no cloud dependency)
- AI agents that automate business operations (lead gen, reporting, outreach)
- Document AI (invoice processing, contract extraction, PDF automation)
- CRM/email automation (HubSpot, Notion, Airtable integrations)
- Custom chatbots for client-facing operations
- Data pipelines and reporting automation

His ICP (Ideal Customer Profile):
- Calgary/Canadian SMBs 5-50 employees
- Industries: law, accounting, real estate, healthcare, agencies, e-commerce
- Pain: manual processes eating hours, staff doing repetitive tasks
- Budget: $1,500-$10,000 CAD per project
- Decision maker: owner, CEO, ops manager — NOT IT department
`;

// ── Scan sources for service ideas ───────────────────────────────────
async function gatherServiceSignals(db) {
  const signals = [];

  // 1. Recent trends from TrendBot
  try {
    const trendRows = db.prepare(`
      SELECT value_json FROM bot_intelligence
      WHERE bot_id = 'trend_bot' AND insight_type = 'pending_trends'
      ORDER BY updated_at DESC LIMIT 10
    `).all();
    for (const row of trendRows) {
      const t = JSON.parse(row.value_json);
      signals.push({ source: "trend", text: `${t.title} — ${t.monetization || ""}`, raw: t });
    }
  } catch {}

  // 2. Lead pain patterns from recent leads
  try {
    const leads = db.prepare(`
      SELECT name, pain_description, source_platform, score
      FROM leads WHERE pain_description IS NOT NULL
      ORDER BY created_at DESC LIMIT 15
    `).all();
    const pains = leads.map(l => l.pain_description).filter(Boolean).join(" | ");
    if (pains) signals.push({ source: "lead_pains", text: pains });
  } catch {}

  // 3. Lead rejection patterns — what Kirill said NO to
  try {
    const rejections = getIntelligenceKey(db, "lead_feedback", "rejections", "reasons") || [];
    if (rejections.length > 0) {
      const reasons = rejections.map(r => r.reason).join(", ");
      signals.push({ source: "lead_rejections", text: `Rejected because: ${reasons}` });
    }
  } catch {}

  // 4. Previously saved service ideas (avoid duplicates)
  const existing = getIntelligenceKey(db, "service_bot", "ideas", "catalog") || [];

  return { signals, existing };
}

// ── Evaluate and generate new service ideas ───────────────────────────
async function generateServiceIdeas(signals, existingIdeas) {
  const existingTitles = existingIdeas.map(i => i.title).join(", ");

  const result = await callAI(
    `${KIRILL_CAPABILITIES}

You are a business strategist. Based on market signals below, identify 2-3 NEW service ideas for Kirill.

Rules:
- Must be deliverable by Kirill with his current skills (n8n, Ollama, GPT-4o, Playwright, SQLite)
- Must solve a SPECIFIC pain in a SPECIFIC industry — no generic "efficiency" vague ideas
- Must be packageable as a fixed-price project ($1,500-$10,000 CAD), delivered in 1-2 weeks
- ICP must be specific: "Owner of a 5-15 person accounting firm in Calgary" not "SMBs"
- The pain must be something they currently do MANUALLY and HATE doing
- Avoid these already-known ideas: ${existingTitles || "none yet"}
- AVOID corporate language: no "suite", "ecosystem", "leverage", "synergy", "comprehensive solution"
- Think like a freelancer who just landed a client — what did they ask for?

Bad example: "AI Operational Efficiency Suite" — too vague
Good example: "Automated client intake + contract generator for law firms — lawyer fills one form, system generates NDA + engagement letter + sends to client for e-sign" — specific, deliverable, valuable

Return JSON array:
[
  {
    "title": "short service name (5 words max)",
    "description": "what Kirill builds and delivers (2-3 sentences)",
    "icp": "specific buyer: role at what company type, size, industry",
    "pain": "what they do manually today that wastes time/money",
    "roi_hook": "one specific number: e.g. 'saves 12 hours/week of manual reporting'",
    "price_cad": 2500,
    "delivery_days": 5,
    "linkedin_angle": "what angle makes a great LinkedIn post about this",
    "outreach_opener": "first sentence of a cold email to this ICP (personalized, no fluff)",
    "confidence": 1-10
  }
]`,
    `Market signals:\n${signals.map(s => `[${s.source}] ${s.text}`).join("\n")}`
  );

  // Handle both array response and wrapped { services: [...] } response
  if (Array.isArray(result)) return result;
  if (result?.services && Array.isArray(result.services)) return result.services;
  if (result?.ideas && Array.isArray(result.ideas)) return result.ideas;
  return [];
}

// ── Route service idea through Opportunity Qualification ─────────────
async function sendServiceIdea(idea) {
  const ideaId = `idea_${Date.now()}`;
  const { getDb, qualifyOpportunity, decisionEngine, setIntelligence } = await import("./orchestrator.mjs");
  const db = getDb();

  try {
    const opp = await qualifyOpportunity(db, {
      title: idea.title,
      source: "service-bot",
      origin_bot: "service-bot",
      description: `${idea.description}. Pain: ${idea.pain}. ROI: ${idea.roi_hook}`,
      market: idea.icp || "global",
      type: "service",
      proof: `Confidence: ${idea.confidence}/10. Price: $${idea.price_cad} CAD. ICP: ${idea.icp}`,
    });

    if (opp) {
      const decision = await decisionEngine(db, opp.id);
      console.log(`[ServiceBot] Idea "${idea.title}" → ${decision?.decision}`);
    } else {
      console.log(`[ServiceBot] Idea "${idea.title}" → rejected by qualification`);
    }

    // Still save idea data for later use if promoted
    setIntelligence(db, "service_bot", "idea_data", ideaId, idea, 95);
  } finally {
    db.close();
  }

  return ideaId;
}

// ── Main ServiceBot run ───────────────────────────────────────────────
async function runServiceBot() {
  const db = getDb();
  heartbeat(db, BOT_ID, "ServiceBot", "scanning for new service ideas");

  const { signals, existing } = await gatherServiceSignals(db);

  if (signals.length === 0) {
    console.log("[ServiceBot] No signals to process");
    db.close();
    return;
  }

  console.log(`[ServiceBot] Processing ${signals.length} signals, ${existing.length} existing ideas`);

  let ideas;
  try {
    ideas = await generateServiceIdeas(signals, existing);
  } catch (err) {
    console.warn(`[ServiceBot] AI error: ${err.message}`);
    db.close();
    return;
  }

  // Filter by confidence and novelty
  const newIdeas = ideas.filter(i => {
    if (!i.title || i.confidence < 6) return false;
    return !existing.some(e => e.title.toLowerCase() === i.title.toLowerCase());
  });

  console.log(`[ServiceBot] ${newIdeas.length} new ideas to propose`);

  for (const idea of newIdeas.slice(0, 2)) { // Max 2 per run — don't spam
    const ideaId = await sendServiceIdea(idea);

    // Save to catalog (pending decision)
    const catalog = getIntelligenceKey(db, "service_bot", "ideas", "catalog") || [];
    catalog.push({
      id: ideaId,
      ...idea,
      status: "pending",
      discoveredAt: new Date().toISOString()
    });
    setIntelligence(db, "service_bot", "ideas", "catalog", catalog.slice(-50), 100);

    // Save full idea data for callback lookup
    setIntelligence(db, "service_bot", "idea_data", ideaId, idea, 95);

    await logActivity(db, "service", `Новая идея услуги: <b>${idea.title}</b> ($${idea.price_cad} CAD) — жду решения`);
    await new Promise(r => setTimeout(r, 1000));
  }

  heartbeat(db, BOT_ID, "ServiceBot", `done — ${newIdeas.length} ideas proposed`, {}, {
    status: "ok",
    last_success_at: new Date().toISOString(),
    error: null
  });
  try { clearError(db, BOT_ID); } catch {}
  db.close();
  console.log(`[ServiceBot] Done. ${newIdeas.length} ideas sent.`);
}

// ── Live mode (every 6h) ─────────────────────────────────────────────
async function liveMode() {
  console.log(`[ServiceBot] Live mode started — runs every 6h`);
  while (true) {
    try {
      await runServiceBot();
    } catch (err) {
      console.error(`[ServiceBot] Live mode error:`, err.message);
      try { const edb = getDb(); reportError(edb, BOT_ID, "ServiceBot", err.message, "crash", "liveMode"); edb.close(); } catch {}
    }
    await new Promise(r => setTimeout(r, 6 * 60 * 60 * 1000));
  }
}

import { fileURLToPath as _ftu } from "url";
if (process.argv[1] === _ftu(import.meta.url)) {
  if (process.argv[2] === "live") liveMode().catch(console.error);
  else runServiceBot().catch(console.error);
}

export { runServiceBot };
