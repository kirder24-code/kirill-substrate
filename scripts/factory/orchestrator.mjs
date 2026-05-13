// TODO [claude_code v2.1.136 / test_needed]:
// 1. MCP silent failure fix: if MCP servers are added to .mcp.json, verify they surface
//    errors visibly (not silent fail) — phantom health reports have been a recurring issue.
//    Add a startup MCP connectivity check here when .mcp.json is introduced.
// 2. settings.autoMode.hard_deny: evaluate adding hard_deny rules to .claude/settings.json
//    to unconditionally block high-risk autonomy actions (auto-post, bulk DM).
//    Ref: https://github.com/anthropics/claude-code/releases/tag/v2.1.136

/**
 * MASTER ORCHESTRATOR v2
 * Единственный голос системы. Работает каждую минуту.
 *
 * Принципы:
 * 1. Все боты молчат — только Orchestrator пишет Кириллу
 * 2. Система работает на ОДНУ ЦЕЛЬ до её достижения
 * 3. Каждое событие обрабатывается немедленно (event-driven)
 * 4. Кирилл получает конкретные действия, не информацию
 *
 * VALIDATION RULE (added 2026-05-09 from awareness apply, score 14):
 *
 * NEVER use one part of the system to validate another part of the same system.
 * Circular validation - where the system confirms itself using its own outputs -
 * is a primary cause of "system silently lying about its own state". Symptoms:
 *   - bot reports health status by reading its own log
 *   - cycle marks success by reading own DB write
 *   - a bot's heartbeat counts as proof the bot did real work
 *
 * Required pattern when asserting health or completion:
 *   - check the EXTERNAL EFFECT (file mtime moved, HTTP 200 from independent endpoint,
 *     row count delta in a table this bot does not own, real reply received)
 *   - if no external check is available, the assertion is "presumed alive", not "verified ok"
 *
 * Maps to existing memory rules: feedback_fail_loud_never_fake, feedback_never_claim_works.
 * Reinforcement, not new principle - circular validation is the mechanism behind
 * the "process alive but pipeline dead" failures already documented.
 */

/*
 * * BRAIN/HANDS SEPARATION (ref: https://www.anthropic.com/engineering/managed-agents):
 *  * Orchestrator owns reasoning only -- no direct execution tools in the decision path.
 *  * Executor bots own action only -- no reasoning, only consume task payloads.
 *  * Decoupling pattern: orchestrator writes task row -> executor acts -> external effect verified.
 *  * Benefit: failure isolation, independent scaling, clean audit trail per layer.
 *  * Violation sign: orchestrator directly calls send/post/scrape instead of enqueuing a task.
 */

import Database from "better-sqlite3";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, "../../.data/linkedin-brand-os.sqlite");
const ENV_PATH = resolve(__dirname, "../../apps/api/.env");

// ── Load config ───────────────────────────────────────────────────────
export const env = Object.fromEntries(
  readFileSync(ENV_PATH, "utf-8")
    .split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

// Inject loaded env vars into process.env so preflight() checks pass
// when bots are spawned from daemon context without shell .env exports
for (const [k, v] of Object.entries(env)) {
  if (v && !process.env[k]) process.env[k] = v;
}

export const BOTS = {
  content:   { token: env.TELEGRAM_BOT_TOKEN,           name: "ContentBot"   },
  sales:     { token: env.TELEGRAM_SALES_BOT_TOKEN,     name: "SalesBot"     },
  scout:     { token: env.TELEGRAM_SCOUT_BOT_TOKEN,     name: "ScoutBot"     },
  analytics: { token: env.TELEGRAM_ANALYTICS_BOT_TOKEN, name: "AnalyticsBot" },
  build:     { token: env.TELEGRAM_BUILD_BOT_TOKEN,     name: "BuildBot"     }
};

// Единственный токен для всех сообщений Кириллу — ContentBot
const VOICE_TOKEN = BOTS.content.token;

export const CHAT_ID = env.TELEGRAM_CHAT_ID;
export const OPENAI_KEY = env.OPENAI_API_KEY;

// ── DB helpers ────────────────────────────────────────────────────────
export function getDb() { return new Database(DB_PATH); }

export function createTask(db, { fromBot, toBot, taskType, payload, priority = 5 }) {
  db.prepare(`
    INSERT INTO bot_tasks (id, from_bot, to_bot, task_type, payload_json, priority, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(randomUUID(), fromBot, toBot, taskType, JSON.stringify(payload), priority, new Date().toISOString());
}

export function claimTasks(db, botId, taskType = null) {
  const q = taskType
    ? `SELECT * FROM bot_tasks WHERE to_bot = ? AND task_type = ? AND status = 'pending' ORDER BY priority DESC, created_at ASC LIMIT 10`
    : `SELECT * FROM bot_tasks WHERE to_bot = ? AND status = 'pending' ORDER BY priority DESC, created_at ASC LIMIT 10`;
  const rows = taskType ? db.prepare(q).all(botId, taskType) : db.prepare(q).all(botId);
  for (const r of rows) {
    db.prepare(`UPDATE bot_tasks SET status = 'claimed', claimed_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), r.id);
  }
  return rows.map(r => ({ ...r, payload: JSON.parse(r.payload_json) }));
}

export function completeTask(db, taskId, result = {}) {
  db.prepare(`UPDATE bot_tasks SET status = 'done', result_json = ?, completed_at = ? WHERE id = ?`)
    .run(JSON.stringify(result), new Date().toISOString(), taskId);
}

/**
 * Structured heartbeat — every bot calls this to report health.
 *
 * @param {object}  db
 * @param {string}  botId
 * @param {string}  botName
 * @param {string}  lastAction — human-readable description
 * @param {object}  metrics    — any numbers/data (backwards compat)
 * @param {object}  [health]   — NEW: { status, last_success_at, error }
 *   status:          "ok" | "degraded" | "error"
 *   last_success_at: ISO string of last useful output (null if never)
 *   error:           short error description (null if ok)
 *
 * Old calls without health param still work — health_status = "unknown".
 */
export function heartbeat(db, botId, botName, lastAction, metrics = {}, health = {}) {
  const now = new Date().toISOString();
  const healthStatus = health.status || "unknown";
  const lastSuccessAt = health.last_success_at || null;
  const error = health.error || null;

  db.prepare(`
    INSERT OR REPLACE INTO bot_heartbeats
      (id, bot_id, bot_name, status, last_action, metrics_json, pinged_at, health_status, last_success_at, error)
    VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)
  `).run(botId, botId, botName, lastAction, JSON.stringify(metrics), now, healthStatus, lastSuccessAt, error);
}

/**
 * Structured reliability log — JSON line to stderr.
 * Machine-readable. Healthcheck parses these instead of grepping for "ERROR".
 *
 * Format: {"_r":1,"level":"error","botId":"...","code":"...","message":"...","at":"..."}
 * The "_r":1 marker distinguishes structured entries from plain text.
 */
export function logError(botId, code, message, source = null) {
  const entry = {
    _r: 1,
    level: "error",
    botId: botId || "unknown",
    code: code || null,
    message: (message || "").slice(0, 200),
    source: source || null,
    at: new Date().toISOString(),
  };
  console.error(JSON.stringify(entry));
}

export function logWarn(botId, code, message) {
  const entry = {
    _r: 1,
    level: "warn",
    botId: botId || "unknown",
    code: code || null,
    message: (message || "").slice(0, 200),
    at: new Date().toISOString(),
  };
  console.error(JSON.stringify(entry));
}

/**
 * Report a structured error for a bot. Writes to bot_heartbeats.error as compact JSON
 * AND emits a structured log line.
 *
 * Error codes: "crash" | "api" | "auth" | "config" | "timeout" | "rate_limit"
 */
export function reportError(db, botId, botName, message, code = null, source = null) {
  // Emit structured log line (always, even if DB write fails)
  logError(botId, code, message, source);
  const errorObj = JSON.stringify({
    message: (message || "unknown error").slice(0, 150),
    code: code || null,
    source: source || null,
    at: new Date().toISOString(),
  });

  db.prepare(`
    INSERT OR REPLACE INTO bot_heartbeats
      (id, bot_id, bot_name, status, last_action, metrics_json, pinged_at, health_status, last_success_at, error)
    VALUES (
      ?, ?, ?, 'active', 'error reported',
      (SELECT metrics_json FROM bot_heartbeats WHERE bot_id = ?),
      ?,
      'error',
      (SELECT last_success_at FROM bot_heartbeats WHERE bot_id = ?),
      ?
    )
  `).run(botId, botId, botName, botId, new Date().toISOString(), botId, errorObj);
}

/**
 * Clear error for a bot after successful useful output.
 * Preserves last_success_at — updates it to now.
 */
export function clearError(db, botId) {
  db.prepare(`
    UPDATE bot_heartbeats
    SET error = NULL, health_status = 'ok', last_success_at = ?
    WHERE bot_id = ?
  `).run(new Date().toISOString(), botId);
}

/**
 * Preflight config check — run before entering live loop.
 * Fast, deterministic, no network calls.
 *
 * @param {object[]} checks — array of { name, value, file? }
 *   name:     human-readable label ("TELEGRAM_BOT_TOKEN")
 *   value:    the actual value to check (env var, path, etc.)
 *   file:     if true, value is a file path — check existsSync
 *   required: default true. If false, missing = warning not failure.
 *
 * @returns {{ ok, code, message, missing, warnings }}
 */
export function preflight(checks) {
  const missing = [];
  const warnings = [];

  for (const c of checks) {
    const required = c.required !== false;
    const present = c.file
      ? (c.value && existsSync(c.value))
      : (!!c.value && c.value !== "undefined" && c.value !== "null");

    if (!present) {
      (required ? missing : warnings).push(c.name);
    }
  }

  if (missing.length > 0) {
    return { ok: false, code: "config", message: `Missing required: ${missing.join(", ")}`, missing, warnings };
  }
  return { ok: true, code: null, message: warnings.length ? `Optional missing: ${warnings.join(", ")}` : null, missing: [], warnings };
}

// ── Event bus ─────────────────────────────────────────────────────────
export function emitEvent(db, { fromBot, eventType, payload }) {
  db.prepare(`
    INSERT INTO bot_events (id, from_bot, event_type, payload_json, processed, created_at)
    VALUES (?, ?, ?, ?, 0, ?)
  `).run(randomUUID(), fromBot, eventType, JSON.stringify(payload), new Date().toISOString());
}

export function getUnprocessedEvents(db) {
  return db.prepare(`SELECT * FROM bot_events WHERE processed = 0 ORDER BY created_at ASC LIMIT 20`)
    .all()
    .map(r => ({ ...r, payload: JSON.parse(r.payload_json) }));
}

export function markEventProcessed(db, eventId) {
  db.prepare(`UPDATE bot_events SET processed = 1, processed_at = ? WHERE id = ?`)
    .run(new Date().toISOString(), eventId);
}

// ── Escalation Protocol — боты сообщают об ошибках оркестратору и Кириллу ──
// Если ошибка повторяется 2-3 раза, бот эскалирует. Оркестратор решает.
export async function escalateError(db, botId, errorType, details, severity = "warning") {
  const escalationKey = `${botId}_${errorType}`;
  const existing = getIntelligenceKey(db, "escalation", "errors", escalationKey);
  const count = (existing?.count || 0) + 1;
  const now = new Date().toISOString();

  // Save error with count
  setIntelligence(db, "escalation", "errors", escalationKey, {
    botId, errorType, details: (details || "").slice(0, 300),
    count, firstSeen: existing?.firstSeen || now, lastSeen: now,
    severity, resolved: false,
  }, 90);

  console.log(`[ESCALATION] ${botId}: ${errorType} (${count}x) — ${details?.slice(0, 80)}`);

  // After 3 occurrences — notify Kirill
  if (count === 3) {
    const emoji = severity === "critical" ? "🔴" : "⚠️";
    try {
      await tgSendToKirill(
        `${emoji} <b>Бот ${botId} — проблема</b>\n\n` +
        `<b>Ошибка:</b> ${errorType}\n` +
        `<b>Детали:</b> ${(details || "").slice(0, 200)}\n` +
        `<b>Повторений:</b> ${count}\n\n` +
        `<i>Бот будет пытаться решить проблему самостоятельно. Если не получится — отключит эту функцию.</i>`
      );
    } catch (e) { logError(botId, "api", `Escalation TG notify failed: ${e.message}`, "escalateError"); }
  }

  // Return count so bot can decide what to do
  return count;
}

// ── Shared Intelligence (общая память всех ботов) ─────────────────────
export function setIntelligence(db, botId, insightType, key, value, confidence = 50) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO bot_intelligence (id, bot_id, insight_type, key, value_json, confidence, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(bot_id, insight_type, key) DO UPDATE SET
      value_json = excluded.value_json,
      confidence = excluded.confidence,
      updated_at = excluded.updated_at
  `).run(randomUUID(), botId, insightType, key, JSON.stringify(value), confidence, now, now);
}

export function getIntelligence(db, botId = null, insightType = null) {
  let query = `SELECT * FROM bot_intelligence`;
  const params = [];
  const where = [];
  if (botId) { where.push(`bot_id = ?`); params.push(botId); }
  if (insightType) { where.push(`insight_type = ?`); params.push(insightType); }
  if (where.length) query += ` WHERE ${where.join(" AND ")}`;
  query += ` ORDER BY updated_at DESC`;
  return db.prepare(query).all(...params).map(r => ({ ...r, value: JSON.parse(r.value_json) }));
}

export function getIntelligenceKey(db, botId, insightType, key) {
  const row = db.prepare(`SELECT value_json FROM bot_intelligence WHERE bot_id=? AND insight_type=? AND key=?`).get(botId, insightType, key);
  return row ? JSON.parse(row.value_json) : null;
}

// ── Kirill Directives — feedback-extractor writes, bots read ────────────
// Re-export from feedback-extractor so bots can import from orchestrator
export { getDirectivesFor, getLearnings } from "../cortex/feedback-extractor.mjs";

// ── KPI Reporting — каждый бот вызывает в конце запуска ──────────────
export function reportKPIs(db, botId, kpis) {
  // kpis = { leads_found, leads_qualified, tasks_completed, searches_run, errors, custom: {...} }
  const today = new Date().toISOString().slice(0, 10);
  const existing = getIntelligenceKey(db, botId, "kpis", today) || {};
  const merged = { ...existing, ...kpis, date: today, updatedAt: new Date().toISOString() };
  setIntelligence(db, botId, "kpis", today, merged, 100);

  // Также обновить rolling 7-day summary
  const history = getIntelligenceKey(db, botId, "kpis", "history") || [];
  const historyFiltered = history.filter(h => h.date !== today);
  historyFiltered.push(merged);
  // Keep last 30 days
  setIntelligence(db, botId, "kpis", "history", historyFiltered.slice(-30), 100);
}

// ── Conversion Signal — когда лид конвертируется, передать сигнал обратно ──
export function signalConversion(db, lead, newStage) {
  // Сохранить конверсионное событие для EvolutionBot
  const conversions = getIntelligenceKey(db, "evolution", "conversions", "events") || [];
  conversions.push({
    leadId: lead.id,
    source: lead.source,
    sourcePlatform: lead.source_platform,
    score: lead.score,
    painDescription: lead.pain_description,
    serviceMatch: lead.service_match,
    fromStage: lead.stage,
    toStage: newStage,
    convertedAt: new Date().toISOString()
  });
  setIntelligence(db, "evolution", "conversions", "events", conversions.slice(-200), 100);

  // Если это won — особо важный сигнал
  if (newStage === "won") {
    const wins = getIntelligenceKey(db, "evolution", "conversions", "wins") || [];
    wins.push({ source: lead.source, score: lead.score, serviceMatch: lead.service_match, wonAt: new Date().toISOString() });
    setIntelligence(db, "evolution", "conversions", "wins", wins.slice(-50), 100);
  }
}

// ── Inline proposal helpers (for instant КП generation) ───────────────
const PROPOSAL_SERVICES = {
  "vibe-code-audit":     { name: "Vibe-Code Audit",                price: "CAD $1,500–$2,500", days: "3-5 days" },
  "reply-chaser":        { name: "Reply Chaser Automation",        price: "CAD $1,500",        days: "5 days"   },
  "first-10-customers":  { name: "First 10 Customers Sales Motion", price: "CAD $2,000",        days: "7 days"   },
  "custom-ai-build":     { name: "Custom AI / n8n Build",          price: "CAD $2,500–$8,000", days: "5-14 days" }
};

const KIRILL_PROFILE_PROPOSAL = `
Kirill D. — AI Automation Consultant, Calgary, Alberta, Canada.
5.5 years Senior PM at Ukraine's parliament (zero-trust, high-stakes ops).
Physics degree. Builds: n8n, Notion, LLM orchestrators, local AI servers.
Tone: direct, specific, no corporate speak. Short sentences. Real numbers.
`;

async function generateProposalInline(lead) {
  const serviceKey = lead.service_match || "custom-ai-build";
  const service = PROPOSAL_SERVICES[serviceKey] || PROPOSAL_SERVICES["custom-ai-build"];
  const proposal = await callAI(
    `${KIRILL_PROFILE_PROPOSAL}
Write a concise commercial proposal. Be specific. Use their actual pain points.
Return JSON with:
{
  "subject": "email subject",
  "opener": "2 sentences showing you understand their exact problem",
  "deliverables": ["item1", "item2", "item3"],
  "timeline": "X days/weeks",
  "investment": "price range with ROI context",
  "next_step": "one clear action",
  "ps": "one trust-building sentence"
}`,
    `Client: ${lead.name}, ${lead.company || ""}
Pain: ${lead.pain_description}
Service: ${service.name} — ${service.price} — ${service.days}
What they told us: ${lead.notes || "No additional context"}`
  );

  const text = [
    `<b>📧 КОММЕРЧЕСКОЕ ПРЕДЛОЖЕНИЕ ГОТОВО</b>`,
    ``,
    `<b>Клиент:</b> ${lead.name} — ${lead.company || ""}`,
    `<b>Сервис:</b> ${service.name}`,
    `<b>Цена:</b> ${service.price}`,
    ``,
    `<b>Тема письма:</b> ${proposal.subject}`,
    ``,
    `<b>Открытие:</b>`,
    proposal.opener,
    ``,
    `<b>Что получит клиент:</b>`,
    ...(proposal.deliverables || []).map(d => `• ${d}`),
    ``,
    `<b>Сроки:</b> ${proposal.timeline}`,
    `<b>Инвестиция:</b> ${proposal.investment}`,
    ``,
    `<b>Следующий шаг:</b> ${proposal.next_step}`,
    ``,
    `<b>P.S.</b> ${proposal.ps}`,
    ``,
    `Отправь это предложение клиенту в LinkedIn DM.`,
    `После отправки напиши: /proposal_sent ${lead.id}`
  ].join("\n");

  await tgSendToKirill(text);
}

// ── Goal helpers ──────────────────────────────────────────────────────
export function getActiveGoal(db) {
  return db.prepare(`SELECT * FROM goals WHERE status = 'active' ORDER BY created_at DESC LIMIT 1`).get();
}

export function updateGoalProgress(db, goalId, amount) {
  db.prepare(`UPDATE goals SET current_amount = ?, updated_at = ? WHERE id = ?`)
    .run(amount, new Date().toISOString(), goalId);
}

// ── Telegram ──────────────────────────────────────────────────────────
import { safeSend } from "../lib/safe-send.mjs";
import { trackFailure } from "./tool-failure-tracker.mjs";
import { scanContent } from "./injection-scanner.mjs";

export async function tgSend(botToken, chatId, text, extra = {}) {
  // Egress guard: refuse to send if body leaks credentials, internal paths, or env refs
  const guard = await safeSend({ channel: "telegram", text, meta: { recipient: chatId } });
  if (!guard.ok) {
    trackFailure({ tool: "tgSend", error: guard.reason, channel: "telegram", egress: guard.egress_reason });
    console.error(`[Telegram] BLOCKED by egress-guard: ${guard.egress_reason || guard.reason}`);
    return { ok: false, reason: "egress_guard_denied", description: guard.egress_reason };
  }
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra })
  });
  const data = await res.json();
  if (!data.ok) {
    console.error(`[Telegram] Error: ${data.description}`);
    trackFailure({ tool: "tgSend", error: data.description, channel: "telegram", http_status: res.status });
  }
  return data;
}

// Единственная функция отправки Кириллу
export async function tgSendToKirill(text, extra = {}) {
  return tgSend(VOICE_TOKEN, CHAT_ID, text, extra);
}

// ── Activity Feed — живой лог работы системы ─────────────────────────
// Каждый бот вызывает это при ключевых событиях.
// /verbose on|off управляет видимостью.
export async function logActivity(db, botId, message) {
  try {
    const setting = db.prepare(`SELECT value_json FROM bot_intelligence WHERE bot_id='orchestrator' AND insight_type='settings' AND key='verbose_mode'`).get();
    const verbose = setting ? JSON.parse(setting.value_json) : false; // default OFF — brief is the voice
    if (!verbose) return;
    const emoji = { scout: "🔍", trend: "🔮", content: "✍️", sales: "💼", analytics: "📊", build: "🔨", orchestrator: "⚡" }[botId] || "⚙️";
    await tgSendToKirill(`${emoji} <i>${message}</i>`);
  } catch {}
}

export async function tgSendPhoto(botToken, chatId, imagePath, caption = "") {
  const { readFileSync } = await import("fs");
  const bytes = readFileSync(imagePath);
  const blob = new Blob([bytes], { type: "image/png" });
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("photo", blob, "image.png");
  if (caption) { form.append("caption", caption); form.append("parse_mode", "HTML"); }
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, { method: "POST", body: form });
  return res.json();
}

// ── Model constants (routing policy from 2026-03-27)
// strong  → architecture, agent workflows, BuilderBot, CommunityBot scoring, SalesBot КП
// default → content drafts, emails, summaries, analysis
// mini    → bulk scoring, extraction, 200-char notes, classification
// nano    → binary checks, language detect, simple validation
// Claude CLI models (Max subscription, $0 per call)
export const MODEL_STRONG  = "claude-sonnet-4-6";
export const MODEL_DEFAULT = "claude-sonnet-4-6";
export const MODEL_MINI    = "claude-haiku-4-5-20251001";
export const MODEL_NANO    = "claude-haiku-4-5-20251001";

// ── AI Output Quality Guard ───────────────────────────────────────────
// Call this before saving ANY AI-generated outreach message to DB or sending to Kirill.
// Returns true if the message is clean, false if it contains banned patterns.
const OUTREACH_BANNED = [
  "hi there", "hello!", "i can help you", "i can build", "i can create",
  "i can set up", "i can guide", "i can design", "i can work with",
  "i can develop", "i can handle", "i specialize in", "i noticed you",
  "streamline your", "streamline", "leverage", "game-changer", "seamlessly", "furthermore",
  "let me know if", "i've worked with a client", "for instance, i",
  "i recently worked", "i hope this", "ensuring", "enhancing",
  "i can assist", "feel free to", "don't hesitate", "reach out to me",
  "i'd love to", "i would love to", "as an ai", "as an automation"
];

export function isCleanOutreach(text) {
  if (!text || text.trim().length < 20) return false;
  const lower = text.toLowerCase();
  const banned = OUTREACH_BANNED.find(p => lower.includes(p));
  if (banned) {
    console.warn(`[QualityGuard] Blocked outreach — contains banned phrase: "${banned}"`);
    return false;
  }
  return true;
}

// ── OpenAI ────────────────────────────────────────────────────────────
// ── SYSTEM MISSION — injected into every AI call ─────────────────────
let _missionCache = null;
let _missionCacheTime = 0;

// ── PURPOSE + DIRECTIVES — cached wiki context for every callAI ─────
const PURPOSE_PATH = resolve(__dirname, "../../wiki/PURPOSE.md");
const DIRECTIVES_PATH = resolve(__dirname, "../../wiki/directives.md");

let _purposeCache = null;
let _purposeCacheTime = 0;
function getPurposeContext() {
  const now = Date.now();
  if (_purposeCache && (now - _purposeCacheTime) < 10 * 60 * 1000) return _purposeCache;
  try {
    const raw = readFileSync(PURPOSE_PATH, "utf-8");
    _purposeCache = raw.slice(0, 600);
    _purposeCacheTime = now;
  } catch { _purposeCache = ""; _purposeCacheTime = now; }
  return _purposeCache;
}

let _directivesFullCache = null;
let _directivesFullCacheTime = 0;
function getDirectivesFull() {
  const now = Date.now();
  if (_directivesFullCache && (now - _directivesFullCacheTime) < 10 * 60 * 1000) return _directivesFullCache;
  try {
    _directivesFullCache = readFileSync(DIRECTIVES_PATH, "utf-8");
    _directivesFullCacheTime = now;
  } catch { _directivesFullCache = ""; _directivesFullCacheTime = now; }
  return _directivesFullCache;
}

export function getSystemMission() {
  // Cache for 5 minutes
  if (_missionCache && Date.now() - _missionCacheTime < 5 * 60 * 1000) return _missionCache;

  try {
    const db = getDb();
    const goal = db.prepare("SELECT * FROM goals WHERE status = 'active' ORDER BY created_at DESC LIMIT 1").get();
    const revenue = getRevenueStatus(db);
    const leadsNew = db.prepare("SELECT COUNT(*) as c FROM leads WHERE stage IN ('new','briefed')").get()?.c || 0;
    const leadsContacted = db.prepare("SELECT COUNT(*) as c FROM leads WHERE stage = 'contacted'").get()?.c || 0;
    const repliesCount = db.prepare("SELECT COUNT(*) as c FROM outreach_emails WHERE reply_received_at IS NOT NULL").get()?.c || 0;
    const publishedPosts = db.prepare("SELECT COUNT(*) as c FROM published_posts").get()?.c || 0;

    const deadline = goal?.deadline ? new Date(goal.deadline) : new Date("2026-06-01");
    const daysLeft = Math.max(0, Math.ceil((deadline - new Date()) / (1000 * 60 * 60 * 24)));

    // What has actually worked
    const learnedRules = db.prepare("SELECT key, value_json FROM bot_intelligence WHERE bot_id = 'learn-bot' AND insight_type = 'learned_rules'").all();
    let lessonsStr = "";
    for (const r of learnedRules.slice(0, 3)) {
      try { lessonsStr += JSON.stringify(JSON.parse(r.value_json)).slice(0, 150) + " "; } catch {}
    }

    db.close();

    // Active projects context — so every bot knows what we're working on
    let projectContext = "";
    try {
      const projects = db.prepare("SELECT name, status, linked_market, current_stage FROM projects WHERE status NOT IN ('completed','archived') ORDER BY priority_score DESC LIMIT 5").all();
      if (projects.length > 0) {
        projectContext = `ACTIVE PROJECTS: ${projects.map(p => `"${p.name}" (${p.status}, market: ${p.linked_market || "?"}, stage: ${p.current_stage})`).join("; ")}. All actions should support these projects.`;
      }
    } catch {}

    // Outcomes context — what happened recently
    let outcomesContext = "";
    try {
      const recentReplies = db.prepare("SELECT COUNT(*) as c FROM outreach_emails WHERE reply_received_at > datetime('now', '-7 days')").get()?.c || 0;
      const sentTotal = db.prepare("SELECT COUNT(*) as c FROM outreach_emails WHERE status = 'sent' AND sent_at > datetime('now', '-7 days')").get()?.c || 0;
      const replyRate = sentTotal > 0 ? Math.round(recentReplies / sentTotal * 100) : 0;
      if (sentTotal > 0) outcomesContext = `OUTCOMES (7 days): ${sentTotal} messages sent, ${recentReplies} replies (${replyRate}% rate). ${replyRate < 5 ? "Reply rate is low — try different angle or more specific pain." : ""}`;

      // Self-correction signal
      const angleChange = getIntelligenceKey(db, "orchestrator", "outcomes", "angle_change_needed");
      if (angleChange?.diagnosis) {
        outcomesContext += ` SELF-CORRECTION: ${angleChange.diagnosis} ${angleChange.suggestion}`;
      }
    } catch {}

    _missionCache = [
      `SYSTEM MISSION: Help Kirill D. close his first paying client.`,
      `GOAL: $${goal?.target_amount || 1500} CAD by ${deadline.toISOString().slice(0, 10)} (${daysLeft} days left).`,
      `CURRENT STATE: $${revenue.totalClosed} revenue. ${leadsNew} new leads, ${leadsContacted} contacted, ${repliesCount} replies, ${publishedPosts} published posts.`,
      `MODE: ${revenue.mode}. Pipeline: $${revenue.pipeline}.`,
      projectContext,
      outcomesContext,
      `WHO IS KIRILL: AI systems builder and operations-minded architect in Calgary. NOT a generic AI freelancer. His edge: operator mindset from government-level coordination, business bottleneck recognition, system thinking. Thinks from owner's pain, not from tools.`,
      `WHAT HE SELLS: 7 workflow packages (1-2 weeks each): (1) Lead Response System (2) Sales Follow-Up Automation (3) Client/Project Coordination (4) AI Internal Ops Assistant (5) Content+Outreach Workflow (6) Reporting/Daily Visibility (7) Intake→Triage→Action. Pilot: $1,500 CAD. Full: $2-5K CAD. Monthly: $500-1,500.`,
      `BEST VERTICALS: local service businesses, property/admin, construction-adjacent, agencies, clinics, consultants, founder-led B2B. NOT enterprise, NOT decorative websites, NOT abstract strategy.`,
      `POSITIONING: "I help businesses turn messy manual workflows into structured AI-assisted operating systems — lead handling, follow-up, coordination, reporting, owner visibility."`,
      `PRIMARY MARKET: Canada (local trust, speed to first pilot). BACKUP: United States.`,
      `WHAT WORKS: Direct outreach referencing SPECIFIC business pain (not "I do automation"). Expert community comments showing competence. Concrete workflow examples.`,
      `WHAT DOESN'T WORK: Generic AI-sounding messages. Mass cold email. Abstract offers. Contacting competitors or job seekers. Promising "autonomous AI" or "replace your team".`,
      `CHANNEL RULES — CRITICAL:`,
      `- LinkedIn: 525 followers, mostly Calgary/Canada. NO Premium — cannot DM people who are not connections. Can ONLY send connection requests with 200-char note. Do NOT suggest LinkedIn DMs to strangers. LinkedIn posts ONLY work for Canadian/global English audience.`,
      `- Philippines: Use Facebook groups (95% penetration), Kalibrr, OnlineJobs.ph, local Telegram groups. NOT LinkedIn.`,
      `- Reddit: Only expert comments (karma is low). Cannot post in r/ecommerce (banned). Good subs: r/n8n, r/automation, r/smallbusiness, r/buhaydigital.`,
      `- n8n Community: Account ON HOLD — do not suggest posting there.`,
      `- Email: Can auto-send via SMTP. Good for cold outreach with verified emails.`,
      `- NEVER suggest posting content where Kirill has no audience. Match channel to market.`,
      `CONTENT RULES: Maximum 1 post per 2 days. Do NOT suggest multiple posts in one step.`,
      lessonsStr ? `LEARNED: ${lessonsStr.slice(0, 300)}` : "",
      `EVERY DECISION YOU MAKE MUST MOVE CLOSER TO THIS GOAL. Ask: "Does this help close a $1,500 deal in ${daysLeft} days?"`,
    ].filter(Boolean).join("\n");

    _missionCacheTime = Date.now();
  } catch (err) {
    _missionCache = "MISSION: Help Kirill close first paying client for LaunchSolo AI. Four productized offers: Vibe-Code Audit ($1.5-2.5K), Reply Chaser ($1.5K), First 10 Customers ($2K), Custom AI Build ($2.5-8K). Two ICPs: Solo SaaS founders + Calgary service businesses. Site: launchsoloai.com";
    _missionCacheTime = Date.now();
  }
  return _missionCache;
}

// Text sanitizer - removes em dashes and other AI detection markers from ALL generated text
import { sanitizeForHuman, sanitizeObject } from "./text-sanitizer.mjs";

// Extract the last valid JSON object or array from a string.
// When Claude uses tools (multi-turn), earlier output contains JSON from
// tool results. We want the LAST top-level JSON the model produced.
function extractLastJson(text) {
  // Strip markdown code blocks (```json ... ```)
  text = text.replace(/```(?:json)?\s*\n?/gi, "").replace(/```\s*$/gm, "");

  // Find all positions where a top-level { or [ starts
  const candidates = [];
  for (let i = text.length - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === '}' || ch === ']') {
      // Find the matching opener by trying to parse backward substrings
      const opener = ch === '}' ? '{' : '[';
      // Search backward for the opener
      let depth = 0;
      for (let j = i; j >= 0; j--) {
        if (text[j] === ch) depth++;
        if (text[j] === opener) depth--;
        if (depth === 0) {
          const slice = text.slice(j, i + 1);
          try {
            const parsed = JSON.parse(slice);
            return parsed;
          } catch {
            break; // this pair didn't parse, keep scanning
          }
        }
      }
    }
  }
  return undefined;
}

export async function callAI(systemPrompt, userPrompt, model = MODEL_MINI, json = true) {
  // Inject mission + purpose + wiki directives into every AI call
  const mission = getSystemMission();

  // PURPOSE from wiki/PURPOSE.md (cached 10 min)
  const purpose = getPurposeContext();

  // Current directives from wiki/directives.md (cached 10 min, single read)
  const directivesRaw = getDirectivesFull();
  let directivesStructured = "";
  if (directivesRaw) {
    const analysisMatch = directivesRaw.match(/## Analysis\n([\s\S]*?)(?=\n## )/);
    const bottleneckMatch = directivesRaw.match(/## Bottleneck\n([\s\S]*?)(?=\n## )/);
    const tempoMatch = directivesRaw.match(/## Tempo: (\w+)/);
    directivesStructured = [
      analysisMatch ? `CURRENT ANALYSIS: ${analysisMatch[1].trim()}` : "",
      bottleneckMatch ? `BOTTLENECK: ${bottleneckMatch[1].trim()}` : "",
      tempoMatch ? `TEMPO: ${tempoMatch[1]}` : "",
    ].filter(Boolean).join("\n");
  }

  // Build full system prompt: mission + purpose + directives + bot-specific prompt
  const contextParts = [mission];
  if (purpose) contextParts.push(`SYSTEM PURPOSE (from wiki/PURPOSE.md):\n${purpose}`);
  if (directivesRaw) contextParts.push(`CURRENT DIRECTIVES (from wiki/directives.md):\n${directivesRaw.slice(0, 400)}`);
  if (directivesStructured) contextParts.push(directivesStructured);
  const fullSystemPrompt = contextParts.join("\n\n") + "\n\n---\n\n" + systemPrompt;

  // Anti-AI-detection instruction appended to every prompt
  const antiDetectionRule = "\n\nCRITICAL FORMATTING: Use ONLY short hyphens (-), NEVER use em dashes (—) or en dashes (–) in prose. Use straight quotes (\" '), not curly quotes. Write naturally without em dashes - this is non-negotiable.";

  // OpenAI requires the word "JSON" in the prompt when using json_object mode
  const effectiveSystemPrompt = (json && !fullSystemPrompt.toLowerCase().includes('json')
    ? fullSystemPrompt + ' Return your response in JSON format.'
    : fullSystemPrompt) + antiDetectionRule;

  // Claude CLI subprocess (Max subscription, $0 per call)
  const { spawnSync } = await import("child_process");
  const { writeFileSync: _ws, mkdirSync: _mk } = await import("fs");
  const { resolve: _r } = await import("path");

  const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";
  const promptFile = _r(import.meta.dirname || ".", "../../.data/callai-prompt.md");

  const fullPrompt = effectiveSystemPrompt + "\n\n---\n\nUSER REQUEST:\n" + userPrompt;
  _ws(promptFile, fullPrompt);

  // Map model names - use sonnet for strong/default, haiku for mini/nano
  const cliModel = model.includes("haiku") ? "claude-haiku-4-5-20251001" : "claude-sonnet-4-6";
  const timeout = cliModel.includes("haiku") ? 30_000 : 180_000;

  const cleanEnv = { ...process.env };
  delete cleanEnv.CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING;
  cleanEnv.PATH = `$HOME/.nvm/versions/node/v22.22.2/bin:${process.env.PATH || "/usr/bin:/bin"}`;

  // Rate-limit-aware retry (Datadog: 60% of LLM errors are rate limits)
  const MAX_RETRIES = 3;
  let r, rawContent;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    r = spawnSync("bash", [
      "-c",
      `cat "${promptFile}" | "${CLAUDE_BIN}" -p --model ${cliModel} --max-turns 5 --output-format text --allowedTools "WebFetch,WebSearch,Read" 2>&1`,
    ], {
      cwd: _r(import.meta.dirname || ".", "../.."),
      env: cleanEnv,
      encoding: "utf-8",
      timeout,
      maxBuffer: 5 * 1024 * 1024,
    });
    rawContent = ((r.stdout || "") + (r.stderr || "")).trim();
    const isRateLimit = r.status !== 0 && (
      rawContent.includes("rate limit") ||
      rawContent.includes("429") ||
      rawContent.includes("too many requests") ||
      rawContent.includes("overloaded")
    );
    if (!isRateLimit) break;
    if (attempt < MAX_RETRIES) {
      const waitMs = 15_000 * Math.pow(2, attempt); // 15s, 30s, 60s
      await new Promise(res => setTimeout(res, waitMs));
    }
  }

  // Strip markdown code fences that Claude sometimes wraps around JSON output
  if (rawContent) {
    rawContent = rawContent.replace(/^```json\s*/m, '').replace(/^```\s*/m, '').replace(/\s*```$/m, '').trim();
  }

  // Allow exit=null (killed/timeout) when there is content to parse; fail only on explicit non-zero exit
  if (!rawContent || (r.status !== 0 && r.status !== null)) {
    throw new Error(`Claude CLI failed: exit=${r.status}, output=${rawContent?.slice(0, 200)}`);
  }

  // POST-GENERATION SANITIZATION: Strip em dashes and AI tells from ALL responses
  if (json) {
    // Extract the LAST valid JSON object or array from Claude output.
    // With multi-turn tool use, earlier turns may contain JSON fragments
    // that cause greedy regex to grab too much. We find all top-level
    // { } and [ ] candidates and try parsing from the last one backward.
    const parsed = extractLastJson(rawContent);
    if (parsed !== undefined) {
      try { return sanitizeObject(parsed); } catch { return parsed; }
    }
    throw new Error(`No JSON in Claude output: ${rawContent.slice(0, 200)}`);
  } else {
    return sanitizeForHuman(rawContent);
  }
}

// ── Revenue check ─────────────────────────────────────────────────────
function getRevenueStatus(db) {
  const deals = db.prepare(`SELECT * FROM deals WHERE status NOT IN ('lost', 'cancelled')`).all();
  const pipeline = deals.filter(d => d.status === "proposed").reduce((s, d) => s + d.amount, 0);
  const mrr = deals.filter(d => d.status === "active").reduce((s, d) => s + (d.recurring_monthly || 0), 0);
  const totalClosed = deals.filter(d => d.status === "active" || d.status === "delivered")
    .reduce((s, d) => s + d.amount, 0);
  const leads = db.prepare(`SELECT COUNT(*) as c FROM leads WHERE stage NOT IN ('lost', 'won')`).get();

  let mode = "HUNT";
  if (totalClosed > 5000 || pipeline > 10000) mode = "GROW";
  if (totalClosed > 20000 || mrr > 2000) mode = "SCALE";

  return { pipeline, mrr, totalClosed, activeLeads: leads.c, mode };
}

// ── Lead research via AI (быстро обогащаем каждый лид) ───────────────
async function researchLead(lead) {
  try {
    return await callAI(
      `You are researching a potential client for Kirill D., AI automation consultant.
Extract everything useful about this person/company for a sales approach.
Return JSON:
{
  "company_size_estimate": "1-10|10-50|50-200|200+|unknown",
  "estimated_monthly_saas_spend": "$X-Y/month estimate",
  "decision_maker": true/false,
  "urgency_signals": ["signal1", "signal2"],
  "recommended_service": "exact service from: vibe-code-audit|reply-chaser|first-10-customers|custom-ai-build",
  "estimated_deal_size": "$X,XXX",
  "outreach_message": "personalized 2-sentence DM that mentions their specific pain and offers specific value. Sound human.",
  "why_now": "1 sentence why they need this TODAY not next quarter"
}`,
      `Name: ${lead.name}
Platform: ${lead.source_platform}
Pain: ${lead.pain_description}
Post/URL: ${lead.source_url}
Service match: ${lead.service_match}
Score: ${lead.score}`
    );
  } catch (e) { console.error(`[orchestrator] researchLead failed for ${lead.id}: ${e.message}`); return null; }
}

// ── Process bot events (event-driven reactions) ───────────────────────
async function processEvents(db, goal) {
  const events = getUnprocessedEvents(db);
  if (events.length === 0) return;

  console.log(`[Orchestrator] Processing ${events.length} events...`);

  for (const event of events) {
    try {
      if (event.event_type === "lead_found") {
        const lead = db.prepare(`SELECT * FROM leads WHERE id = ?`).get(event.payload.leadId);
        if (!lead) { markEventProcessed(db, event.id); continue; }

        console.log(`  → lead_found: ${lead.name} (${lead.score}/100)`);

        // Enrich lead with research
        const research = await researchLead(lead);
        if (research) {
          db.prepare(`UPDATE leads SET research_summary = ?, notes = ?, updated_at = ? WHERE id = ?`)
            .run(JSON.stringify(research), research.outreach_message, new Date().toISOString(), lead.id);
        }

        // Route through CONTRACTED Qualification → Decision Engine
        if (lead.score >= 60) {
          try {
            const { runModule } = await import("./contracts/pipeline-runner.mjs");
            const { CONTRACT: qC, execute: qE } = await import("./contracts/modules/qualification-engine.mjs");
            const { CONTRACT: dC, execute: dE } = await import("./contracts/modules/decision-engine.mjs");
            const ws = getWorldState(db);

            const qResult = await runModule(db, qC, {
              signal: {
                title: `Lead: ${lead.name} — ${lead.pain_description?.slice(0, 80) || lead.company || "unknown"}`,
                source: lead.source_platform, origin_bot: "scout-bot",
                description: lead.pain_description || lead.notes || "",
                market: lead.location || "global", type: "lead",
                proof: `Score ${lead.score}/100 from ${lead.source_platform}`,
              }
            }, qE, { world_state: ws });

            if (qResult.output?.opportunity) {
              const dResult = await runModule(db, dC, { opportunity_id: qResult.output.opportunity.id }, dE, { world_state: ws });
              // If ready_to_promote — send lead card to Kirill
              if (dResult.output?.decision === "ready_to_promote") {
                try {
                  const { sendLeadCard } = await import("./telegram-control.mjs");
                  const freshLead = db.prepare("SELECT * FROM leads WHERE id = ?").get(lead.id);
                  await sendLeadCard(freshLead || lead);
                } catch {}
              }
            }
          } catch (contractErr) {
            // Fallback to direct functions if contracted modules fail
            console.error(`[Orchestrator] Contracted qualification error, falling back:`, contractErr.message);
            const opp = await qualifyOpportunity(db, {
              title: `Lead: ${lead.name}`, source: lead.source_platform, origin_bot: "scout-bot",
              description: lead.pain_description || "", market: lead.location || "global", type: "lead",
              proof: `Score ${lead.score}/100`,
            });
            if (opp) await decisionEngine(db, opp.id);
          }
        }
        // Lead still saved in leads table for AutoPipeline — just no Telegram spam
      }

      // TrendBot → qualify as opportunity, not direct content
      if (event.event_type === "trend_spotted") {
        const { title, score, hook, monetization, urgency, url, source, category } = event.payload;
        console.log(`  → trend_spotted: ${title} (${score}/100)`);

        if (score >= 70 && urgency !== "skip") {
          try {
            const { runModule } = await import("./contracts/pipeline-runner.mjs");
            const { CONTRACT: qC, execute: qE } = await import("./contracts/modules/qualification-engine.mjs");
            const { CONTRACT: dC, execute: dE } = await import("./contracts/modules/decision-engine.mjs");
            const ws = getWorldState(db);

            const qR = await runModule(db, qC, {
              signal: { title: `Trend: ${title}`, source: source || "trend-bot", origin_bot: "trend-bot",
                description: `${hook || ""}. Monetization: ${monetization || "unknown"}`,
                market: category || "global", type: "trend", proof: `Score ${score}/100` }
            }, qE, { world_state: ws });

            if (qR.output?.opportunity) {
              await runModule(db, dC, { opportunity_id: qR.output.opportunity.id }, dE, { world_state: ws });
            }
          } catch (contractErr) {
            console.error(`[Orchestrator] Contracted trend qualification error:`, contractErr.message);
            const opp = await qualifyOpportunity(db, {
              title: `Trend: ${title}`, source: source || "trend-bot", origin_bot: "trend-bot",
              description: `${hook || ""}`, market: category || "global", type: "trend", proof: `Score ${score}/100`,
            });
            if (opp) { await decisionEngine(db, opp.id); }
          }
        }
      }

      if (event.event_type === "deal_closed") {
        const { amount } = event.payload;
        if (goal) {
          const newAmount = (goal.current_amount || 0) + amount;
          updateGoalProgress(db, goal.id, newAmount);
          const pct = Math.round((newAmount / goal.target_amount) * 100);
          await tgSendToKirill(
            `🎉 <b>СДЕЛКА ЗАКРЫТА! ${pct}% от цели</b>\n\n` +
            `+$${amount.toLocaleString()} CAD\n` +
            `Итого: $${newAmount.toLocaleString()} / $${goal.target_amount.toLocaleString()} CAD\n\n` +
            (pct >= 100 ? `🏆 <b>ЦЕЛЬ ДОСТИГНУТА!</b>` : `Осталось: $${(goal.target_amount - newAmount).toLocaleString()} CAD`)
          );
        }
      }

      markEventProcessed(db, event.id);
    } catch (err) {
      console.warn(`[Orchestrator] Event ${event.event_type} error: ${err.message}`);
      markEventProcessed(db, event.id); // Mark processed to avoid infinite loop
    }
  }
}

// ── Notify Kirill about a lead — ONE message, ONE action ─────────────
async function notifyLeadToKirill(db, lead, research, goal) {
  const goalBar = goal
    ? `🎯 <b>Цель:</b> $${goal.current_amount || 0} / $${goal.target_amount} CAD (${Math.round(((goal.current_amount || 0) / goal.target_amount) * 100)}%)\n\n`
    : "";

  const sourceLabel = {
    upwork: "🟢 Upwork — готов платить СЕЙЧАС",
    linkedin: "🔵 LinkedIn",
    threads: "🧵 Threads",
    reddit: "Reddit",
    hackernews: "HackerNews",
    indeed: "Indeed"
  }[lead.source_platform] || lead.source_platform;

  const dealSize = research?.estimated_deal_size || `$${lead.score >= 80 ? "2,500-4,500" : "1,500-2,500"}`;

  const text = [
    `${goalBar}🔥 <b>НОВЫЙ ЛИД — ТРЕБУЕТ ДЕЙСТВИЯ</b>`,
    ``,
    `<b>👤 Кто:</b> ${lead.name}`,
    `<b>📍 Источник:</b> ${sourceLabel}`,
    `<b>⭐ Скор:</b> ${lead.score}/100 | <b>💰 Потенциал:</b> ${dealSize}`,
    ``,
    `<b>🔥 Боль:</b>`,
    lead.pain_description?.slice(0, 200),
    ``,
    research ? `<b>📊 Что я узнал:</b>` : null,
    research ? `• Размер компании: ${research.company_size_estimate}` : null,
    research ? `• Решение: ${research.recommended_service}` : null,
    research ? `• Почему сейчас: ${research.why_now}` : null,
    ``,
    `<b>✍️ Готовое сообщение:</b>`,
    `<code>${research?.outreach_message || "Написать вручную"}</code>`,
    ``,
    `<b>🔗</b> ${lead.source_url}`,
  ].filter(l => l !== null).join("\n");

  const keyboard = {
    inline_keyboard: [[
      { text: "✅ Написал им", callback_data: `contacted:${lead.id}` },
      { text: "❌ Не подходит", callback_data: `skip:${lead.id}` }
    ], [
      { text: "📧 Сгенерировать КП", callback_data: `proposal:${lead.id}` }
    ]]
  };

  await tgSendToKirill(text, { reply_markup: keyboard });
}

// ── Main menu — все действия одним взглядом ───────────────────────────
async function sendMainMenu() {
  const keyboard = { inline_keyboard: [
    [
      { text: "📋 Мои лиды", callback_data: "show_pipeline" },
      { text: "📊 Статус системы", callback_data: "show_status" }
    ],
    [
      { text: "📝 Черновики постов", callback_data: "show_posts" },
      { text: "📧 Email рассылка", callback_data: "show_outreach" }
    ],
    [
      { text: "🎓 Обучить из поста", callback_data: "learn_mode" },
      { text: "🧠 Мои предпочтения", callback_data: "show_feedback" }
    ],
    [
      { text: "☀️ Показать бриф", callback_data: "run_brief" },
      { text: "🔍 Найти лидов сейчас", callback_data: "run_scout" }
    ]
  ]};
  await tgSendToKirill(`<b>🤖 Главное меню</b>\n\nВыбери действие:`, { reply_markup: keyboard });
}

// ── Morning brief — ОДИН раз в день, ОДНО сообщение ─────────────────
async function sendMorningBrief(db, revenue, goal) {
  const leads = db.prepare(`
    SELECT * FROM leads WHERE stage NOT IN ('lost','won')
    ORDER BY score DESC LIMIT 3
  `).all();

  const daysLeft = goal
    ? Math.max(0, Math.ceil((new Date(goal.deadline) - new Date()) / 86400000))
    : null;

  const pct = goal ? Math.round(((goal.current_amount || 0) / goal.target_amount) * 100) : 0;

  // Pending events for today
  const pendingLeads = db.prepare(`SELECT COUNT(*) as c FROM leads WHERE stage = 'new'`).get();
  const todayTasks = db.prepare(`SELECT COUNT(*) as c FROM bot_tasks WHERE status = 'pending'`).get();

  let text = `☀️ <b>Доброе утро, Кирилл!</b>\n\n`;

  if (goal) {
    const progressBar = "█".repeat(Math.floor(pct / 10)) + "░".repeat(10 - Math.floor(pct / 10));
    text += `🎯 <b>ЦЕЛЬ: $${goal.target_amount} CAD к ${new Date(goal.deadline).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}</b>\n`;
    text += `${progressBar} ${pct}% | Осталось: ${daysLeft} дней\n`;
    text += `Заработано: $${(goal.current_amount || 0).toLocaleString()} / $${goal.target_amount.toLocaleString()} CAD\n\n`;
  }

  text += `<b>💼 Активных лидов:</b> ${leads.length} | <b>Новых (не отработано):</b> ${pendingLeads.c}\n`;
  text += `<b>📋 Задач в очереди:</b> ${todayTasks.c}\n\n`;

  if (leads.length > 0) {
    text += `<b>🔥 Лиды которые ждут тебя:</b>\n`;
    for (const l of leads) {
      const stageEmoji = { new: "🆕", contacted: "📩", qualified: "✅", proposal_sent: "📧" }[l.stage] || "❓";
      text += `${stageEmoji} <b>${l.name}</b> — ${l.service_match || "?"} | ${l.score}/100\n`;
      if (l.notes) text += `   <i>"${l.notes.slice(0, 80)}"</i>\n`;
    }
    text += `\n`;
  }

  if (revenue.mode === "HUNT" && leads.length === 0) {
    text += `⚡ <b>Система в режиме ОХОТА</b>\n`;
    text += `ScoutBot сканирует Upwork + LinkedIn каждые 4ч\n`;
    text += `Следующее сканирование — через ${4 - (new Date().getHours() % 4)} ч\n\n`;
  }

  text += `<i>Система работает автономно. Тебе напишут только когда нужно действие.</i>`;

  const keyboard = { inline_keyboard: [
    [
      { text: "💼 Воронка лидов", callback_data: "show_pipeline" },
      { text: "📋 Мои посты", callback_data: "show_posts" }
    ],
    [
      { text: "📊 Статус системы", callback_data: "show_status" },
      { text: "🔇 Тишина", callback_data: "verbose_off" }
    ]
  ]};
  await tgSendToKirill(text, { reply_markup: keyboard });
}

// ── Process Kirill's button responses ────────────────────────────────
async function processKirillResponses(db) {
  try {
    let offset = 0;
    const st = db.prepare(`SELECT bot_name FROM bot_heartbeats WHERE bot_id = 'orchestrator_cmd_offset'`).get();
    if (st) offset = parseInt(st.bot_name) || 0;

    const res = await fetch(`https://api.telegram.org/bot${VOICE_TOKEN}/getUpdates?offset=${offset}&timeout=1`);
    const data = await res.json();
    if (!data.ok) return;
    if (!data.result?.length) {
      // Save offset even with no updates — ensures we track position
      db.prepare(`INSERT OR REPLACE INTO bot_heartbeats (id, bot_id, bot_name, status, last_action, metrics_json, pinged_at) VALUES (?,?,?,?,?,?,?)`)
        .run("orchestrator_cmd_offset", "orchestrator_cmd_offset", String(offset), "active", "offset_tracker", "{}", new Date().toISOString());
      return;
    }

    for (const update of data.result) {
      offset = update.update_id + 1;

      // Handle callback buttons
      const cb = update.callback_query;
      if (cb) {
        const [action, leadId] = (cb.data || "").split(":");
        const now = new Date().toISOString();
        const lead = db.prepare(`SELECT * FROM leads WHERE id = ?`).get(leadId);

        const answerCb = (text, show_alert = false) =>
          fetch(`https://api.telegram.org/bot${VOICE_TOKEN}/answerCallbackQuery`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ callback_query_id: cb.id, text, show_alert })
          });

        if (action === "contacted" && lead) {
          const followup = new Date(Date.now() + 3 * 86400000).toISOString();
          db.prepare(`UPDATE leads SET stage='contacted', last_contact_at=?, next_followup_at=?, updated_at=? WHERE id=?`)
            .run(now, followup, now, leadId);
          await answerCb(`✅ Зафиксировано! Напомню про ${lead.name} через 3 дня.`, true);
        }

        if ((action === "reject" || action === "skip") && lead) {
          db.prepare(`UPDATE leads SET stage='lost', updated_at=? WHERE id=?`).run(now, leadId);
          await answerCb(`❌ Лид убран из воронки.`, true);
        }

        if (action === "proposal" && lead) {
          await answerCb(`⏳ Генерирую КП для ${lead.name}... Пришлю через минуту.`, true);
          generateProposalInline(lead).catch(err =>
            tgSendToKirill(`⚠️ Ошибка генерации КП для ${lead.name}: ${err.message}`)
          );
        }

        // ── Кнопки контента ────────────────────────────────────────
        if (action === "menu") {
          await answerCb("Главное меню");
          await sendMainMenu();
        }

        if (action === "show_posts") {
          await answerCb("Загружаю посты...");
          const { readFileSync: rfs } = await import("fs");
          let archive = [];
          try { archive = JSON.parse(rfs(resolve(__dirname, "../../.data/post-archive.json"), "utf-8")); } catch {}
          if (archive.length === 0) {
            await tgSendToKirill(`📋 <b>Архив постов пуст.</b>`);
          } else {
            const keyboard = { inline_keyboard: archive.map(p => ([
              { text: `${p.date} — ${p.topic}`, callback_data: `post_proposal:${p.id}` }
            ])) };
            await tgSendToKirill(
              `📋 <b>Все посты (${archive.length})</b>\n<i>Нажми на пост чтобы получить КП:</i>`,
              { reply_markup: keyboard }
            );
          }
        }

        if (action === "post_proposal") {
          const postId = cb.data.split(":")[1];
          await answerCb("Загружаю КП...");
          const { readFileSync: rfs } = await import("fs");
          let archive = [];
          try { archive = JSON.parse(rfs(resolve(__dirname, "../../.data/post-archive.json"), "utf-8")); } catch {}
          const entry = archive.find(p => p.id === postId);
          const p = entry?.proposal;
          if (!p) {
            await tgSendToKirill(`❌ КП для <code>${postId}</code> не найдено.`);
          } else {
            const keyboard = { inline_keyboard: [[
              { text: "✅ КП отправлено клиенту", callback_data: `menu` }
            ]] };
            await tgSendToKirill([
              `<b>📧 КП для поста: ${entry.topic}</b>`,
              `<b>Дата поста:</b> ${entry.date}`,
              ``,
              `<b>Subject:</b> ${p.subject}`,
              ``,
              `<b>Opening:</b>`, p.greeting,
              ``,
              `<b>What I deliver:</b>`,
              ...(p.whatWeDeliver || []).map(d => `• ${d}`),
              ``,
              `<b>Timeline:</b> ${p.howLong}`,
              `<b>Investment:</b> ${p.investment}`,
              ``,
              `<b>Next step:</b> ${p.nextStep}`,
              ``,
              `<b>P.S.</b> ${p.ps}`
            ].join("\n"), { reply_markup: keyboard });
          }
        }

        if (action === "mark_published") {
          const postId = cb.data.split(":")[1];
          const now = new Date().toISOString();
          db.prepare(`INSERT OR IGNORE INTO published_posts (id, post_id, platform, status, published_at, created_at) VALUES (?,?,'linkedin','published',?,?)`)
            .run(randomUUID(), postId, now, now);
          db.prepare(`UPDATE published_posts SET status='published', published_at=? WHERE post_id=?`).run(now, postId);
          await answerCb(`✅ Зафиксировано! Отслеживаю результаты.`, true);
          await tgSendToKirill(
            `📊 <b>Пост опубликован!</b>\n\nКогда увидишь статистику — нажми кнопку ниже.`,
            { reply_markup: { inline_keyboard: [
              [{ text: "📈 Внести статистику поста", callback_data: `update_stats:${postId}` }],
              [{ text: "◀️ Главное меню", callback_data: "menu" }]
            ]}}
          );
        }

        if (action === "not_publishing") {
          const postId = cb.data.split(":")[1];
          await answerCb("Понял, жду объяснение...");
          // Save pending state — next message from Kirill is the rejection reason
          const { writeFileSync: wfs } = await import("fs");
          wfs(resolve(__dirname, "../../.data/pending-feedback.json"), JSON.stringify({
            type: "post_rejection",
            postId,
            askedAt: new Date().toISOString()
          }));
          await tgSendToKirill(
            `❌ <b>Не публикуешь пост <code>${postId.slice(0,8)}</code></b>\n\n` +
            `Напиши одним сообщением — почему?\n\n` +
            `Примеры:\n` +
            `• <i>Тема скучная, не моя аудитория</i>\n` +
            `• <i>Слишком продажно, без ценности</i>\n` +
            `• <i>Hook слабый, не цепляет</i>\n` +
            `• <i>Не актуально сейчас</i>\n\n` +
            `_ContentBot запомнит и больше так не делает._`
          );
        }

        if (action === "show_pipeline") {
          await answerCb("Загружаю воронку...");
          const leads = db.prepare(`SELECT * FROM leads WHERE stage NOT IN ('won','lost') ORDER BY score DESC`).all();
          const goal = getActiveGoal(db);
          let reply = `<b>💼 ВОРОНКА ПРОДАЖ</b>\n\n`;
          if (goal) reply += `🎯 Цель: $${goal.current_amount || 0}/$${goal.target_amount} CAD\n\n`;
          if (leads.length === 0) {
            reply += `Лидов пока нет. ScoutBot ищет...`;
            await tgSendToKirill(reply);
          } else {
            for (const l of leads) {
              const e = { new: "🆕", contacted: "📩", qualified: "✅", proposal_sent: "📧" }[l.stage] || "❓";
              reply += `${e} <b>${l.name}</b> | ${l.stage} | ${l.score}/100\n`;
            }
            const keyboard = { inline_keyboard: leads.slice(0, 3).map(l => ([
              { text: `📧 КП: ${l.name.slice(0,20)}`, callback_data: `proposal:${l.id}` },
              { text: `✅ Написал`, callback_data: `contacted:${l.id}` }
            ])).concat([[{ text: "◀️ Меню", callback_data: "menu" }]]) };
            await tgSendToKirill(reply, { reply_markup: keyboard });
          }
        }

        if (action === "update_stats") {
          const postId = cb.data.split(":")[1];
          await answerCb("Выбери диапазон результатов");
          await tgSendToKirill(
            `📈 <b>Результат поста</b>\n\nСколько лайков получил пост?`,
            { reply_markup: { inline_keyboard: [
              [
                { text: "0–10", callback_data: `post_likes:${postId}:5` },
                { text: "10–30", callback_data: `post_likes:${postId}:20` },
                { text: "30–70", callback_data: `post_likes:${postId}:50` },
                { text: "70+", callback_data: `post_likes:${postId}:100` }
              ],
              [{ text: "❌ Пропустить", callback_data: "menu" }]
            ]}}
          );
        }

        if (action === "post_likes") {
          const [, postId, likes] = cb.data.split(":");
          await answerCb("Записано!");
          const now = new Date().toISOString();
          db.prepare(`UPDATE published_posts SET likes=?, updated_at=? WHERE post_id=?`).run(parseInt(likes), now, postId);
          await tgSendToKirill(
            `✅ <b>Лайки записаны: ${likes}</b>\n\nБыли ли входящие сообщения или лиды после поста?`,
            { reply_markup: { inline_keyboard: [
              [
                { text: "✅ Да, были лиды", callback_data: `post_leads:${postId}:1` },
                { text: "❌ Нет лидов", callback_data: `post_leads:${postId}:0` }
              ]
            ]}}
          );
        }

        if (action === "post_leads") {
          const [, postId, leadsCount] = cb.data.split(":");
          await answerCb("Сохранено!");
          const now = new Date().toISOString();
          db.prepare(`UPDATE published_posts SET leads_generated=?, updated_at=? WHERE post_id=?`).run(parseInt(leadsCount), now, postId);
          setIntelligence(db, "content_feedback", "post_results", postId, {
            postId, leads: parseInt(leadsCount), recordedAt: now
          }, 90);
          await tgSendToKirill(
            `📊 <b>Статистика поста сохранена.</b>\n\nContentBot учтёт это при создании следующих постов.`,
            { reply_markup: { inline_keyboard: [[{ text: "◀️ Главное меню", callback_data: "menu" }]] }}
          );
        }

        if (action === "verbose_off") {
          setIntelligence(db, "orchestrator", "settings", "verbose_mode", false, 100);
          await answerCb("🔇 Уведомления выключены", true);
        }

        if (action === "verbose_on") {
          setIntelligence(db, "orchestrator", "settings", "verbose_mode", true, 100);
          await answerCb("🔊 Уведомления включены", true);
        }

        if (action === "show_stats") {
          await answerCb("Загружаю статистику...");
          const { sendDailyStatus } = await import("./analytics-bot.mjs");
          const db2 = getDb();
          await sendDailyStatus(db2);
          db2.close();
        }

        if (action === "show_status") {
          await answerCb("Загружаю статус...");
          const goal = getActiveGoal(db);
          const hbs = db.prepare(`SELECT * FROM bot_heartbeats WHERE bot_id IN ('scout','sales','analytics','build','orchestrator','trend','linkedin-hunter','brief-agent','telegram-control') ORDER BY pinged_at DESC`).all();
          const emailsSent = db.prepare(`SELECT COUNT(*) as n FROM outreach_emails WHERE status='sent'`).get()?.n || 0;
          const emailReplies = db.prepare(`SELECT COUNT(*) as n FROM outreach_emails WHERE reply_received_at IS NOT NULL`).get()?.n || 0;
          const deadline = new Date("2026-06-01T23:59:00-06:00");
          const daysLeft = Math.max(0, Math.ceil((deadline - new Date()) / 86400000));
          let reply = `<b>⚙️ СТАТУС СИСТЕМЫ</b>\n\n`;
          reply += `⏳ До дедлайна: <b>${daysLeft} дней</b> | Цель: $1,500 CAD\n`;
          if (goal) reply += `💰 Заработано: $${goal.current_amount || 0} / $${goal.target_amount}\n`;
          reply += `📧 Писем: ${emailsSent} отправлено, ${emailReplies} ответов\n\n`;
          reply += `<b>Боты:</b>\n`;
          for (const hb of hbs) {
            const mins = Math.floor((Date.now() - new Date(hb.pinged_at).getTime()) / 60000);
            reply += `${mins < 120 ? "🟢" : "🔴"} ${hb.bot_name} (${mins}м назад)\n`;
          }
          await tgSendToKirill(reply, { reply_markup: { inline_keyboard: [[
            { text: "◀️ Главное меню", callback_data: "menu" }
          ]] }});
        }

        // ── Тренды ─────────────────────────────────────────────────
        if (action === "trend_post") {
          const trendKey = cb.data.split(":")[1];
          await answerCb("Запускаю ContentBot...", true);
          const trend = getIntelligence(db, "trend_bot", "pending_trends", trendKey);
          if (trend) {
            createTask(db, {
              fromBot: "orchestrator", toBot: "content_factory",
              taskType: "draft_linkedin_post",
              payload: trend,
              priority: 10
            });
            await tgSendToKirill(
              `✍️ <b>ContentBot пишет пост о тренде:</b>\n<i>${trend.title}</i>\n\nЧерновик придёт через 1-2 минуты.`,
              { reply_markup: { inline_keyboard: [[{ text: "◀️ Главное меню", callback_data: "menu" }]] }}
            );
          } else {
            await tgSendToKirill(`❌ Данные тренда не найдены. Запусти /trend вручную.`);
          }
        }

        if (action === "trend_save") {
          const trendKey = cb.data.split(":")[1];
          await answerCb("Сохранено в идеи!", true);
          const trend = getIntelligence(db, "trend_bot", "pending_trends", trendKey);
          if (trend) {
            const saved = (() => {
              try { return getIntelligence(db, "trend_bot", "saved_ideas", "list") || []; } catch { return []; }
            })();
            saved.push({ ...trend, savedAt: new Date().toISOString() });
            setIntelligence(db, "trend_bot", "saved_ideas", "list", saved.slice(-20), 100);
            await tgSendToKirill(
              `💡 <b>Идея сохранена.</b>\nМожешь вернуться к ней позже через меню.`,
              { reply_markup: { inline_keyboard: [
                [{ text: "✍️ Написать пост сейчас", callback_data: `trend_post:${trendKey}` }],
                [{ text: "◀️ Главное меню", callback_data: "menu" }]
              ]}}
            );
          }
        }

        if (action === "trend_skip") {
          const trendKey = cb.data.split(":")[1];
          await answerCb("Понял, пропускаю.");
          const trend = getIntelligence(db, "trend_bot", "pending_trends", trendKey);
          if (trend) {
            // Save skip reason to improve future filtering
            const skipped = (() => {
              try { return getIntelligence(db, "trend_bot", "skipped", "list") || []; } catch { return []; }
            })();
            skipped.push({ title: trend.title, skippedAt: new Date().toISOString() });
            setIntelligence(db, "trend_bot", "skipped", "list", skipped.slice(-30), 100);
          }
          await tgSendToKirill(
            `❌ <b>Тренд пропущен.</b>\nTrendBot учтёт это и не будет предлагать похожие темы.`,
            { reply_markup: { inline_keyboard: [[{ text: "◀️ Главное меню", callback_data: "menu" }]] }}
          );
        }

        // ── Обучение ContentBot из примеров постов ──────────────────
        if (action === "learn_mode") {
          await answerCb("Режим обучения...");
          const { writeFileSync: wfs } = await import("fs");
          wfs(resolve(__dirname, "../../.data/pending-feedback.json"), JSON.stringify({
            type: "learn_post", askedAt: new Date().toISOString()
          }));
          const examples = (() => {
            try { return getIntelligence(db, "content_feedback", "good_examples", "posts") || []; } catch { return []; }
          })();
          await tgSendToKirill(
            `🎓 <b>Режим обучения</b>\n\n` +
            `Загружено примеров: <b>${examples.length}/10</b>\n\n` +
            `Отправь текст своего лучшего LinkedIn поста следующим сообщением.\n` +
            `ContentBot изучит твой стиль и будет писать похоже.\n\n` +
            `_Чем больше примеров — тем точнее подбор тона и структуры._`,
            { reply_markup: { inline_keyboard: [[
              { text: "❌ Отмена", callback_data: "menu" }
            ]] }}
          );
        }

        // ── Предпочтения по контенту ────────────────────────────────
        if (action === "show_feedback") {
          await answerCb("Загружаю...");
          const rejections = (() => {
            try { return getIntelligence(db, "content_feedback", "rejections", "reasons") || []; } catch { return []; }
          })();
          const examples = (() => {
            try { return getIntelligence(db, "content_feedback", "good_examples", "posts") || []; } catch { return []; }
          })();
          let reply = `🧠 <b>Что ContentBot знает о тебе:</b>\n\n`;
          reply += `✅ Загружено постов-примеров: <b>${examples.length}</b>\n`;
          reply += `❌ Причин отказа записано: <b>${rejections.length}</b>\n\n`;
          if (rejections.length > 0) {
            reply += `<b>Последние причины "не публикую":</b>\n`;
            rejections.slice(-5).forEach(r => { reply += `• <i>${r.reason}</i>\n`; });
          } else {
            reply += `<i>Ещё нет отказов. Нажимай "❌ Не публикую" на постах которые не нравятся.</i>\n`;
          }
          await tgSendToKirill(reply, { reply_markup: { inline_keyboard: [
            [{ text: "🎓 Добавить пост-пример", callback_data: "learn_mode" }],
            [{ text: "◀️ Главное меню", callback_data: "menu" }]
          ]}});
        }

        // ── Email рассылка статус ───────────────────────────────────
        if (action === "show_outreach") {
          await answerCb("Загружаю...");
          const sent = db.prepare(`SELECT COUNT(*) as n FROM outreach_emails WHERE status='sent'`).get()?.n || 0;
          const replies = db.prepare(`SELECT COUNT(*) as n FROM outreach_emails WHERE reply_received_at IS NOT NULL`).get()?.n || 0;
          const todaySent = db.prepare(`SELECT COUNT(*) as n FROM outreach_emails WHERE status='sent' AND sent_at > datetime('now', '-24 hours')`).get()?.n || 0;
          let businesses = 0;
          try {
            const { readFileSync: rfs } = await import("fs");
            businesses = JSON.parse(rfs(resolve(__dirname, "../../.data/calgary-businesses.json"), "utf-8")).length;
          } catch {}
          const reply = `<b>📧 Cold Email рассылка</b>\n\n` +
            `Отправлено всего: <b>${sent}</b>\n` +
            `Сегодня: <b>${todaySent}</b>\n` +
            `Ответов: <b>${replies}</b>\n` +
            `В очереди: <b>${businesses}</b> бизнесов\n\n` +
            `Рассылка идёт автоматически каждый будний день в 9 AM Calgary.`;
          await tgSendToKirill(reply, { reply_markup: { inline_keyboard: [
            [{ text: "📤 Отправить сейчас (15 писем)", callback_data: "send_outreach_now" }],
            [{ text: "◀️ Главное меню", callback_data: "menu" }]
          ]}});
        }

        // ── Отправить рассылку прямо сейчас ────────────────────────
        if (action === "send_outreach_now") {
          await answerCb("Запускаю рассылку...", true);
          await tgSendToKirill(`📤 <b>Запускаю рассылку...</b>\nПришлю результат через 1-2 минуты.`);
          import("../outreach/send-outreach.mjs").then(({ runOutreach }) => {
            runOutreach().then(count => {
              tgSendToKirill(
                `✅ <b>Рассылка завершена</b>\nОтправлено: <b>${count || "~15"}</b> писем`,
                { reply_markup: { inline_keyboard: [[{ text: "◀️ Меню", callback_data: "menu" }]] }}
              );
            }).catch(e => tgSendToKirill(`❌ Ошибка рассылки: ${e.message}`));
          });
        }

        // ── Запустить бриф прямо сейчас ────────────────────────────
        if (action === "run_brief") {
          await answerCb("Готовлю бриф...", true);
          import("./brief-agent.mjs").then(({ runBriefAgent }) => {
            runBriefAgent().catch(e => tgSendToKirill(`❌ Ошибка брифа: ${e.message}`));
          });
        }

        // ── Запустить сканирование лидов прямо сейчас ──────────────
        if (action === "run_scout") {
          await answerCb("Запускаю сканирование...", true);
          await tgSendToKirill(`🔍 <b>Ищу новых лидов...</b>\nLinkedIn + Reddit + HN. Результат через 1-2 минуты.`);
          Promise.all([
            import("./linkedin-hunter.mjs").then(({ runLinkedInHunter }) => runLinkedInHunter()),
            import("./scout-bot.mjs").then(({ runScout }) => runScout()),
          ]).then(([li]) => {
            tgSendToKirill(
              `✅ <b>Сканирование завершено</b>\nLinkedIn: ${li?.length || 0} новых лидов`,
              { reply_markup: { inline_keyboard: [[
                { text: "📋 Посмотреть лидов", callback_data: "show_pipeline" },
                { text: "◀️ Меню", callback_data: "menu" }
              ]] }}
            );
          }).catch(e => tgSendToKirill(`❌ Ошибка сканирования: ${e.message}`));
        }
      }

      // Handle text commands
      const msg = update.message?.text || "";
      const msgChatId = update.message?.chat?.id;
      if (msgChatId && String(msgChatId) === String(CHAT_ID)) {

        // ── Check for pending feedback (post rejection reason) ──────
        if (msg && !msg.startsWith("/")) {
          let pendingFeedback = null;
          try {
            const { readFileSync: rfs } = await import("fs");
            pendingFeedback = JSON.parse(rfs(resolve(__dirname, "../../.data/pending-feedback.json"), "utf-8"));
          } catch {}

          if (pendingFeedback?.type === "post_rejection") {
            // Save rejection reason to bot_intelligence
            const rejections = (() => {
              try {
                const existing = getIntelligence(db, "content_feedback", "rejections", "reasons");
                return Array.isArray(existing) ? existing : [];
              } catch { return []; }
            })();
            rejections.push({
              postId: pendingFeedback.postId,
              reason: msg,
              at: new Date().toISOString()
            });
            // Keep last 20 rejections
            setIntelligence(db, "content_feedback", "rejections", "reasons", rejections.slice(-20), 100);

            // Clear pending state
            try {
              const { writeFileSync: wfs } = await import("fs");
              wfs(resolve(__dirname, "../../.data/pending-feedback.json"), JSON.stringify({}));
            } catch {}

            await tgSendToKirill(
              `🧠 <b>Записано!</b>\n\n` +
              `Причина: <i>${msg}</i>\n\n` +
              `ContentBot обновит стратегию — следующие посты будут лучше.`
            );
            continue; // Don't process as command
          }

          if (pendingFeedback?.type === "learn_post") {
            // Kirill sent a past post text — save as positive example
            const examples = (() => {
              try {
                const existing = getIntelligence(db, "content_feedback", "good_examples", "posts");
                return Array.isArray(existing) ? existing : [];
              } catch { return []; }
            })();
            examples.push({ text: msg, addedAt: new Date().toISOString() });
            setIntelligence(db, "content_feedback", "good_examples", "posts", examples.slice(-10), 100);

            try {
              const { writeFileSync: wfs } = await import("fs");
              wfs(resolve(__dirname, "../../.data/pending-feedback.json"), JSON.stringify({}));
            } catch {}

            await tgSendToKirill(
              `✅ <b>Пост добавлен в базу примеров (${examples.length}/10).</b>\n\n` +
              `ContentBot изучит твой стиль и будет писать похоже.`,
              { reply_markup: { inline_keyboard: [
                [{ text: "➕ Добавить ещё пост", callback_data: "learn_mode" }],
                [{ text: "◀️ Главное меню", callback_data: "menu" }]
              ]}}
            );
            continue;
          }
        }

        // Любое неизвестное сообщение — показываем меню
        if (msg && !msg.startsWith("/update_post")) {
          await sendMainMenu();
          continue;
        }

        if (msg === "/menu" || msg === "/start") {
          await sendMainMenu();
        }

        if (msg === "/pipeline") {
          const leads = db.prepare(`SELECT * FROM leads WHERE stage NOT IN ('won','lost') ORDER BY score DESC`).all();
          const goal = getActiveGoal(db);
          let reply = `<b>💼 ВОРОНКА ПРОДАЖ</b>\n\n`;
          if (goal) reply += `🎯 Цель: $${goal.current_amount || 0}/$${goal.target_amount} CAD\n\n`;
          if (leads.length === 0) {
            reply += `Лидов пока нет. ScoutBot ищет...`;
            await tgSendToKirill(reply, { reply_markup: { inline_keyboard: [[{ text: "◀️ Меню", callback_data: "menu" }]] }});
          } else {
            for (const l of leads) {
              const e = { new: "🆕", contacted: "📩", qualified: "✅", proposal_sent: "📧" }[l.stage] || "❓";
              reply += `${e} <b>${l.name}</b> | ${l.stage} | ${l.score}/100\n`;
            }
            const keyboard = { inline_keyboard: leads.slice(0, 3).map(l => ([
              { text: `📧 КП: ${l.name.slice(0,18)}`, callback_data: `proposal:${l.id}` },
              { text: `✅ Написал`, callback_data: `contacted:${l.id}` }
            ])).concat([[{ text: "◀️ Меню", callback_data: "menu" }]]) };
            await tgSendToKirill(reply, { reply_markup: keyboard });
          }
        }

        if (msg === "/status") {
          const goal = getActiveGoal(db);
          const revenue = getRevenueStatus(db);
          const hbs = db.prepare(`SELECT * FROM bot_heartbeats WHERE bot_id IN ('scout','sales','analytics','build','orchestrator','trend') ORDER BY pinged_at DESC`).all();
          let reply = `<b>⚙️ СТАТУС СИСТЕМЫ</b>\n\n`;
          if (goal) reply += `🎯 Цель: $${goal.current_amount || 0}/$${goal.target_amount} CAD\n\n`;
          reply += `<b>Боты:</b>\n`;
          for (const hb of hbs) {
            const mins = Math.floor((Date.now() - new Date(hb.pinged_at).getTime()) / 60000);
            const alive = mins < 120;
            reply += `${alive ? "🟢" : "🔴"} ${hb.bot_name}: ${hb.last_action} (${mins}м назад)\n`;
          }
          await tgSendToKirill(reply);
        }

        // /learn — режим обучения: Кирилл отправляет свои лучшие посты, система учится стилю
        if (msg === "/learn") {
          const { writeFileSync: wfs } = await import("fs");
          wfs(resolve(__dirname, "../../.data/pending-feedback.json"), JSON.stringify({
            type: "learn_post",
            askedAt: new Date().toISOString()
          }));
          const examples = (() => {
            try { return getIntelligence(db, "content_feedback", "good_examples", "posts") || []; } catch { return []; }
          })();
          await tgSendToKirill(
            `🎓 <b>Режим обучения активирован</b>\n\n` +
            `Отправь текст своего лучшего LinkedIn поста.\n` +
            `ContentBot изучит твой стиль, тон и структуру.\n\n` +
            `Уже загружено примеров: <b>${examples.length}</b>\n\n` +
            `_Чем больше примеров — тем точнее система пишет в твоём стиле._`
          );
        }

        // /feedback — показать что система узнала о твоих предпочтениях
        if (msg === "/feedback") {
          const rejections = (() => {
            try { return getIntelligence(db, "content_feedback", "rejections", "reasons") || []; } catch { return []; }
          })();
          const examples = (() => {
            try { return getIntelligence(db, "content_feedback", "good_examples", "posts") || []; } catch { return []; }
          })();
          let reply = `🧠 <b>Что я знаю о твоих предпочтениях:</b>\n\n`;
          reply += `✅ Хороших примеров загружено: <b>${examples.length}</b>\n`;
          reply += `❌ Причин отказа записано: <b>${rejections.length}</b>\n\n`;
          if (rejections.length > 0) {
            reply += `<b>Последние причины отказа:</b>\n`;
            rejections.slice(-5).forEach(r => {
              reply += `• <i>${r.reason}</i>\n`;
            });
          }
          await tgSendToKirill(reply);
        }

        // /note <leadId> <text> — логируем что сказал клиент → SalesBot генерирует следующий шаг
        if (msg.startsWith("/note ")) {
          const parts = msg.split(" ");
          const leadId = parts[1];
          const note = parts.slice(2).join(" ");
          if (leadId && note) {
            const lead = db.prepare(`SELECT * FROM leads WHERE id = ?`).get(leadId);
            if (lead) {
              const now = new Date().toISOString();
              const prev = lead.notes && !lead.notes.startsWith("[") ? "" : (lead.notes || "");
              db.prepare(`UPDATE leads SET notes = ?, updated_at = ? WHERE id = ?`)
                .run(`${prev}${prev ? "\n" : ""}[${now.slice(0,10)}] ${note}`, now, leadId);
              createTask(db, {
                fromBot: "orchestrator", toBot: "sales",
                taskType: "generate_reply",
                payload: { leadId, note },
                priority: 8
              });
              await tgSendToKirill(`📝 <b>Записано для ${lead.name}</b>\n<i>${note}</i>\n\n⏳ Генерирую следующий шаг...`);
            } else {
              await tgSendToKirill(`❌ Лид ${leadId} не найден. Используй /pipeline чтобы увидеть ID.`);
            }
          }
        }

        // /qualify <leadId> — показать квалификационный статус лида
        if (msg.startsWith("/qualify ")) {
          const leadId = msg.split(" ")[1];
          const lead = db.prepare(`SELECT * FROM leads WHERE id = ?`).get(leadId);
          if (lead) {
            const allText = `${lead.notes || ""} ${lead.pain_description || ""}`.toLowerCase();
            const q = {
              budget: /(\$[\d,]+|budget|\d+k|\d+ k|per month|monthly|pricing|pay|invest)/i.test(allText),
              dm: /(i (am|own|run|manage|lead)|owner|ceo|founder|cto|director|head of|myself)/i.test(allText),
              timeline: /(asap|urgent|this week|this month|need by|deadline|soon|right away|quickly)/i.test(allText),
              pain: (lead.pain_description || "").length > 60
            };
            const score = Object.values(q).filter(Boolean).length * 25;
            let reply = `<b>🎯 КВАЛИФИКАЦИЯ: ${lead.name}</b>\n`;
            reply += `Stage: ${lead.stage} | Score: ${lead.score}/100\n\n`;
            reply += `${q.budget ? "✅" : "❌"} Бюджет подтверждён\n`;
            reply += `${q.dm ? "✅" : "❌"} Принимает решения сам\n`;
            reply += `${q.timeline ? "✅" : "❌"} Есть срочность/дедлайн\n`;
            reply += `${q.pain ? "✅" : "❌"} Боль описана чётко\n\n`;
            reply += `<b>Готовность к КП: ${score}/100</b>\n`;
            reply += score >= 75 ? `🟢 Готов — нажми "Сгенерировать КП"` :
                     score >= 50 ? `🟡 Нужно ещё уточнений` :
                     `🔴 Продолжай квалификацию`;
            if (lead.notes) reply += `\n\n<b>Заметки:</b>\n<i>${lead.notes.slice(-400)}</i>`;
            await tgSendToKirill(reply);
          }
        }

        // /project_done <dealId> — проект сдан → кейс-стади + поиск похожих клиентов
        if (msg.startsWith("/project_done ")) {
          const dealId = msg.split(" ")[1];
          const deal = db.prepare(`SELECT * FROM deals WHERE id = ?`).get(dealId);
          if (deal) {
            const lead = db.prepare(`SELECT * FROM leads WHERE id = ?`).get(deal.lead_id);
            const now = new Date().toISOString();
            db.prepare(`UPDATE deals SET status = 'delivered', updated_at = ? WHERE id = ?`).run(now, dealId);
            db.prepare(`UPDATE mvp_projects SET status = 'completed', updated_at = ? WHERE deal_id = ?`).run(now, dealId);
            // ContentBot: написать кейс-стади
            createTask(db, {
              fromBot: "orchestrator", toBot: "content_factory",
              taskType: "draft_case_study",
              payload: {
                leadId: deal.lead_id, dealId,
                clientName: lead?.name, serviceType: deal.service_type,
                amount: deal.amount, painDescription: lead?.pain_description
              },
              priority: 9
            });
            // ScoutBot: искать похожих клиентов
            setIntelligence(db, "orchestrator", "scout_directive", "find_similar", {
              serviceType: deal.service_type,
              painPattern: (lead?.pain_description || "").slice(0, 120),
              at: now
            }, 85);
            await tgSendToKirill(
              `🎉 <b>ПРОЕКТ СДАН!</b>\n\n` +
              `👤 ${lead?.name} | $${deal.amount?.toLocaleString() || 0} CAD\n\n` +
              `✍️ ContentBot напишет кейс-стади\n` +
              `🔍 ScoutBot будет искать похожих клиентов\n\n` +
              `<i>Запроси отзыв у клиента — это усилит кейс.</i>`
            );
          }
        }

        // /milestone <projectId> <phaseNumber> — отмечаем завершение фазы проекта
        if (msg.startsWith("/milestone ")) {
          const parts = msg.split(" ");
          const projectId = parts[1];
          const phaseNum = parseInt(parts[2]) || 1;
          if (projectId) {
            createTask(db, {
              fromBot: "orchestrator", toBot: "build",
              taskType: "phase_complete",
              payload: { projectId, phaseNumber: phaseNum },
              priority: 9
            });
            await tgSendToKirill(`✅ Фаза ${phaseNum} проекта отмечена — BuildBot обновит план.`);
          }
        }

        // /update_post <postId> <likes> <comments> <leads> — обновляем статистику поста
        if (msg.startsWith("/update_post ")) {
          const parts = msg.split(" ");
          const [, postId, likes, comments, leadsGen] = parts;
          if (postId) {
            const score = Math.min(100, (parseInt(likes)||0)*2 + (parseInt(comments)||0)*5 + (parseInt(leadsGen)||0)*20);
            db.prepare(`UPDATE published_posts SET likes=?, comments=?, leads_generated=?, performance_score=?, updated_at=? WHERE post_id=?`)
              .run(parseInt(likes)||0, parseInt(comments)||0, parseInt(leadsGen)||0, score, new Date().toISOString(), postId);
            await tgSendToKirill(`📊 Статистика обновлена. Скор поста: ${score}/100\nAnalyticsBot учтёт это при следующей стратегии.`);
          }
        }

        // /stats — быстрый статус системы
        if (msg === "/stats") {
          const { sendDailyStatus } = await import("./analytics-bot.mjs");
          const db2 = getDb();
          await sendDailyStatus(db2);
          db2.close();
        }

        // /report — полный еженедельный отчёт по запросу
        if (msg === "/report") {
          const { sendWeeklyReport } = await import("./analytics-bot.mjs");
          const db2 = getDb();
          await sendWeeklyReport(db2);
          db2.close();
        }

        // /verbose on|off — управляем activity feed
        if (msg === "/verbose on") {
          setIntelligence(db, "orchestrator", "settings", "verbose_mode", true, 100);
          await tgSendToKirill(`🔊 <b>Activity feed включён</b> — буду сообщать о работе ботов в реальном времени.`);
        }
        if (msg === "/verbose off") {
          setIntelligence(db, "orchestrator", "settings", "verbose_mode", false, 100);
          await tgSendToKirill(`🔇 <b>Activity feed выключен</b> — только важные уведомления.`);
        }

        // /post_published <postId> — фиксируем публикацию → AnalyticsBot начинает учиться
        if (msg.startsWith("/post_published ")) {
          const postId = msg.split(" ")[1];
          if (postId) {
            const now = new Date().toISOString();
            db.prepare(`
              INSERT OR IGNORE INTO published_posts (id, post_id, platform, status, published_at, created_at)
              VALUES (?, ?, 'linkedin', 'published', ?, ?)
            `).run(randomUUID(), postId, now, now);
            db.prepare(`UPDATE published_posts SET status='published', published_at=? WHERE post_id=?`).run(now, postId);
            await tgSendToKirill(
              `📊 <b>Пост опубликован! Отслеживаю результаты.</b>\n\nКогда увидишь статистику в LinkedIn — введи цифры кнопкой ниже.`,
              { reply_markup: { inline_keyboard: [
                [{ text: "📈 Обновить статистику поста", callback_data: `update_stats:${postId}` }],
                [{ text: "💼 Воронка лидов", callback_data: "show_pipeline" }, { text: "🤖 Меню", callback_data: "menu" }]
              ]}}
            );
          }
        }

        // /posts — список всех опубликованных постов с датами
        if (msg === "/posts") {
          const { readFileSync: rfs } = await import("fs");
          const archivePath = resolve(__dirname, "../../.data/post-archive.json");
          let archive = [];
          try { archive = JSON.parse(rfs(archivePath, "utf-8")); } catch {}
          if (archive.length === 0) {
            await tgSendToKirill(`📋 <b>Архив постов пуст.</b>`, { reply_markup: { inline_keyboard: [[{ text: "◀️ Меню", callback_data: "menu" }]] }});
          } else {
            const keyboard = { inline_keyboard: archive.map(p => ([
              { text: `${p.date} — ${p.topic}`, callback_data: `post_proposal:${p.id}` }
            ])).concat([[{ text: "◀️ Меню", callback_data: "menu" }]]) };
            await tgSendToKirill(
              `📋 <b>Все посты (${archive.length})</b>\n<i>Нажми на пост — получишь КП:</i>`,
              { reply_markup: keyboard }
            );
          }
        }

        // /proposal <id> — повторно отправить шаблон предложения для поста
        if (msg.startsWith("/proposal ")) {
          const postId = msg.split(" ")[1];
          const { readFileSync: rfs } = await import("fs");
          const archivePath = resolve(__dirname, "../../.data/post-archive.json");
          let archive = [];
          try { archive = JSON.parse(rfs(archivePath, "utf-8")); } catch {}
          const entry = archive.find(p => p.id === postId);
          if (!entry) {
            await tgSendToKirill(`❌ Пост <code>${postId}</code> не найден.\n\nСписок всех постов: /posts`);
          } else {
            const p = entry.proposal;
            const text = p ? [
              `<b>📧 КП для поста: ${entry.topic}</b>`,
              `<b>Дата поста:</b> ${entry.date}`,
              ``,
              `<b>Subject:</b> ${p.subject}`,
              ``,
              `<b>Opening:</b>`,
              p.greeting,
              ``,
              `<b>What I deliver:</b>`,
              ...(p.whatWeDeliver || []).map(d => `• ${d}`),
              ``,
              `<b>Timeline:</b> ${p.howLong}`,
              `<b>Investment:</b> ${p.investment}`,
              ``,
              `<b>Next step:</b> ${p.nextStep}`,
              ``,
              `<b>P.S.</b> ${p.ps}`
            ].join("\n") : `Шаблон для <b>${entry.topic}</b> (${entry.date}) не сохранён.`;
            await tgSendToKirill(text);
          }
        }

        if (msg.startsWith("/proposal_sent ")) {
          const leadId = msg.split(" ")[1];
          if (leadId) {
            const now = new Date().toISOString();
            db.prepare(`UPDATE leads SET stage = 'proposal_sent', last_contact_at = ?, updated_at = ? WHERE id = ?`)
              .run(now, now, leadId);
            const lead = db.prepare(`SELECT * FROM leads WHERE id = ?`).get(leadId);
            await tgSendToKirill(`📧 КП для ${lead?.name || leadId} помечено как отправлено. Жду ответа клиента.`);
          }
        }

        if (msg.startsWith("/lead_contacted ")) {
          const leadId = msg.split(" ")[1];
          if (leadId) {
            const now = new Date().toISOString();
            const followup = new Date(Date.now() + 3 * 86400000).toISOString();
            db.prepare(`UPDATE leads SET stage = 'contacted', last_contact_at = ?, next_followup_at = ?, updated_at = ? WHERE id = ?`)
              .run(now, followup, now, leadId);
            const lead = db.prepare(`SELECT * FROM leads WHERE id = ?`).get(leadId);
            await tgSendToKirill(`✅ Касание с ${lead?.name || leadId} зафиксировано. Напомню через 3 дня.`);
          }
        }

        if (msg.startsWith("/deal_closed ")) {
          const parts = msg.split(" ");
          const leadId = parts[1];
          const amount = parseInt(parts[2]) || 0;
          if (leadId && amount > 0) {
            const lead = db.prepare(`SELECT * FROM leads WHERE id = ?`).get(leadId);
            const now = new Date().toISOString();
            const dealId = randomUUID();
            db.prepare(`INSERT INTO deals (id, lead_id, service_type, amount, currency, status, closed_at, created_at, updated_at)
              VALUES (?, ?, ?, ?, 'CAD', 'active', ?, ?, ?)`)
              .run(dealId, leadId, lead?.service_match || "custom", amount, now, now, now);
            db.prepare(`UPDATE leads SET stage = 'won', updated_at = ? WHERE id = ?`).run(now, leadId);
            emitEvent(db, { fromBot: "orchestrator", eventType: "deal_closed", payload: { dealId, leadId, amount } });
            createTask(db, { fromBot: "orchestrator", toBot: "build", taskType: "start_project",
              payload: { dealId, leadId, leadName: lead?.name, amount, serviceType: lead?.service_match }, priority: 10 });
          }
        }
      }
    }

    db.prepare(`INSERT OR REPLACE INTO bot_heartbeats (id, bot_id, bot_name, status, last_action, metrics_json, pinged_at) VALUES (?,?,?,?,?,?,?)`)
      .run("orchestrator_cmd_offset", "orchestrator_cmd_offset", String(offset), "active", "offset_tracker", "{}", new Date().toISOString());
  } catch (err) {
    console.warn(`[Orchestrator] processKirillResponses error: ${err.message}`);
  }
}

// ── Check stale leads → remind Kirill ────────────────────────────────
async function checkStaleLeads(db) {
  const now = new Date().toISOString();
  const staleLeads = db.prepare(`
    SELECT * FROM leads
    WHERE stage IN ('contacted', 'qualified')
    AND next_followup_at <= ?
    AND stage != 'lost'
    LIMIT 3
  `).all(now);

  for (const lead of staleLeads) {
    // Dedup: skip if we already created a followup task for this lead in the last 6 hours
    const recentTask = db.prepare(`
      SELECT id FROM bot_tasks
      WHERE to_bot = 'sales' AND task_type = 'followup_lead'
      AND payload_json LIKE ? AND created_at >= datetime('now', '-6 hours')
    `).get(`%${lead.id}%`);
    if (recentTask) continue;

    const days = Math.floor((Date.now() - new Date(lead.last_contact_at || lead.created_at).getTime()) / 86400000);
    createTask(db, {
      fromBot: "orchestrator", toBot: "sales", taskType: "followup_lead",
      payload: { leadId: lead.id, leadName: lead.name, stage: lead.stage, daysSinceContact: days },
      priority: 8
    });

    // Push next_followup_at forward immediately so this lead won't be picked up again until SalesBot handles it
    db.prepare(`UPDATE leads SET next_followup_at = datetime('now', '+4 days'), updated_at = ? WHERE id = ?`)
      .run(now, lead.id);
  }
}

// ── Dead bot check (max 1 alert per 6h) ──────────────────────────────
const BOT_SCHEDULES = {
  scout: 6 * 60, sales: 2 * 60, analytics: 2 * 60, build: 24 * 60
};

async function checkDeadBots(db) {
  const lastAlertKey = "orchestrator_last_dead_alert";
  const lastAlert = db.prepare(`SELECT bot_name FROM bot_heartbeats WHERE bot_id = ?`).get(lastAlertKey);
  const lastAlertTime = lastAlert ? new Date(lastAlert.bot_name).getTime() : 0;
  if (Date.now() - lastAlertTime < 6 * 60 * 60 * 1000) return;

  const deadBots = [];
  for (const [botId, thresholdMin] of Object.entries(BOT_SCHEDULES)) {
    const thresholdAgo = new Date(Date.now() - thresholdMin * 60 * 1000).toISOString();
    const hb = db.prepare(`SELECT * FROM bot_heartbeats WHERE bot_id = ? AND pinged_at >= ?`).get(botId, thresholdAgo);
    if (!hb) deadBots.push(botId);
  }

  if (deadBots.length > 0) {
    const now = new Date();
    await tgSendToKirill(`⚠️ Боты молчат: <b>${deadBots.join(", ")}</b>\nПроверь систему.`);
    db.prepare(`INSERT OR REPLACE INTO bot_heartbeats (id, bot_id, bot_name, status, last_action, metrics_json, pinged_at) VALUES (?,?,?,?,?,?,?)`)
      .run(lastAlertKey, lastAlertKey, now.toISOString(), "active", "alert_sent", "{}", now.toISOString());
  }
}

// ── Intelligence Review — мозг смотрит на всю систему ────────────────
// Запускается каждый час. Читает общую память → принимает кросс-бот решения.
async function intelligenceReview(db, revenue, goal) {
  console.log(`[Orchestrator] Intelligence review...`);
  const now = new Date().toISOString();
  const actions = [];

  // 1. Читаем что знает ScoutBot
  const scoutScan = getIntelligenceKey(db, "scout", "scan_results", "last_run_at");
  const scoutQualified = getIntelligenceKey(db, "scout", "scan_results", "qualified_this_run");
  const recentPains = getIntelligenceKey(db, "scout", "lead_signals", "recent_pains");

  // Если ScoutBot находит 0 лидов уже давно → ContentBot пишет пост о болях из последних сканов
  const hoursSinceLastQualified = scoutScan
    ? (Date.now() - new Date(scoutScan).getTime()) / 3600000
    : 999;

  // Content: NO automatic generation. Kirill decides when to publish.
  // Ideas saved to content_ideas, shown in brief. Kirill presses "Write post" when ready.

  // 2. Читаем что нашёл TrendBot
  const hotTopics = getIntelligenceKey(db, "trend", "hot_topics", "latest");
  if (hotTopics && hotTopics.length > 0) {
    // Проверяем нет ли уже задач по этим топикам
    const pendingContentTasks = db.prepare(`SELECT COUNT(*) as c FROM bot_tasks WHERE to_bot='content_factory' AND task_type='draft_linkedin_post' AND status='pending'`).get().c;
    if (pendingContentTasks === 0) {
      const bestTopic = hotTopics[0];
      if (bestTopic.score >= 70) {
        // Save as content idea — Kirill decides when to write posts
        const topicKey = `topic_${bestTopic.title.toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 40)}`;
        setIntelligence(db, "content-bot", "content_ideas", topicKey, {
          title: bestTopic.title, hook: bestTopic.hook, monetization: bestTopic.monetization,
          score: bestTopic.score, category: bestTopic.category,
          savedAt: new Date().toISOString(),
        }, 30);
        actions.push(`content_idea_saved: "${bestTopic.title}" (${bestTopic.score}/100)`);
      }
    }
  }

  // 3. Читаем состояние воронки
  const newLeads = db.prepare(`SELECT COUNT(*) as c FROM leads WHERE stage = 'new' AND created_at >= ?`).get(new Date(Date.now() - 86400000).toISOString()).c;
  const contactedLeads = db.prepare(`SELECT * FROM leads WHERE stage = 'contacted' AND next_followup_at <= ?`).all(now);

  // Если есть overdue follow-ups → SalesBot должен написать напоминание
  for (const lead of contactedLeads) {
    const days = Math.floor((Date.now() - new Date(lead.last_contact_at || lead.created_at).getTime()) / 86400000);
    if (days >= 3) {
      const existingFollowup = db.prepare(`SELECT id FROM bot_tasks WHERE to_bot='sales' AND task_type='followup_lead' AND payload_json LIKE ? AND status='pending'`).get(`%${lead.id}%`);
      if (!existingFollowup) {
        createTask(db, {
          fromBot: "orchestrator", toBot: "sales", taskType: "followup_lead",
          payload: { leadId: lead.id, leadName: lead.name, daysSinceContact: days },
          priority: 9
        });
        actions.push(`followup: ${lead.name} (${days} days silent)`);
      }
    }
  }

  // 4. ALARM MODE — if goal is not met and deadline is close, push harder
  const deadline = new Date("2026-06-01T23:59:00-06:00");
  const daysLeft = Math.ceil((deadline - new Date()) / 86400000);
  const goalAmount = goal?.target_amount || 1500;
  const earned = revenue?.earned || 0;

  if (earned < goalAmount && daysLeft <= 10) {
    // Force daily outreach if not sent today
    const outreachToday = db.prepare(`
      SELECT COUNT(*) as c FROM outreach_emails
      WHERE sent_at > datetime('now', '-20 hours') AND status = 'sent'
    `).get().c;

    if (outreachToday === 0) {
      const existingOutreach = db.prepare(`SELECT id FROM bot_tasks WHERE to_bot='outreach' AND task_type='send_batch' AND status='pending'`).get();
      if (!existingOutreach) {
        createTask(db, {
          fromBot: "orchestrator", toBot: "outreach", taskType: "send_batch",
          payload: { reason: "alarm_mode_no_outreach_today", daysLeft },
          priority: 10
        });
        actions.push(`ALARM: no outreach today — forcing batch send (${daysLeft} days left)`);
      }
    }

    // Alert Kirill every 4 hours if no leads in pipeline
    const activeLeads = db.prepare(`SELECT COUNT(*) as c FROM leads WHERE stage IN ('new','researched','briefed')`).get().c;
    const lastAlertKey = getIntelligenceKey(db, "orchestrator", "alarm", "last_kirill_alert");
    const hoursSinceAlert = lastAlertKey
      ? (Date.now() - new Date(lastAlertKey).getTime()) / 3600000
      : 999;

    if (activeLeads === 0 && hoursSinceAlert > 4) {
      setIntelligence(db, "orchestrator", "alarm", "last_kirill_alert", now, 100);
      actions.push(`ALARM: pipeline empty, ${daysLeft} days left — alerting Kirill`);
      tgSendToKirill(
        `⚠️ *Система работает, но воронка пуста*\n\n` +
        `• Дней до дедлайна: *${daysLeft}*\n` +
        `• Лидов в очереди: *0*\n` +
        `• Писем отправлено: ${outreachToday} сегодня\n\n` +
        `Система ищет активно. LinkedIn Hunter запущен. ` +
        `ScoutBot расширил поиск.\n\n` +
        `_Жди утренний бриф в 9 AM._`
      ).catch(e => logError("orchestrator", "api", `Status TG send failed: ${e.message}`, "orchestratorTick"));
    }
  }

  // 5. Фиксируем что мы сделали в общую память
  if (actions.length > 0) {
    setIntelligence(db, "orchestrator", "intelligence_review", "last_actions", {
      at: now,
      actions,
      newLeads,
      mode: revenue.mode,
      daysLeft
    }, 100);
    console.log(`[Orchestrator] Intelligence actions: ${actions.join(" | ")}`);
  } else {
    console.log(`[Orchestrator] Intelligence review: ${daysLeft} days left, $${earned}/$${goalAmount} — monitoring`);
  }
}

// ── MAIN ORCHESTRATOR TICK ────────────────────────────────────────────
async function orchestratorTick() {
  const db = getDb();
  const now = new Date();
  const hourUtc = now.getUTCHours();
  const hourCalgary = (hourUtc - 6 + 24) % 24;
  const minutesCalgary = now.getUTCMinutes();

  const revenue = getRevenueStatus(db);
  const goal = getActiveGoal(db);

  heartbeat(db, "orchestrator", "Orchestrator", `tick at ${now.toISOString()}`, {
    ...revenue,
    goal: goal ? `$${goal.current_amount || 0}/$${goal.target_amount}` : "no goal"
  }, {
    status: "ok",
    last_success_at: now.toISOString(),
    error: null
  });

  console.log(`[Orchestrator] ${now.toISOString()} | Mode: ${revenue.mode} | Goal: ${goal ? `$${goal.current_amount || 0}/$${goal.target_amount} CAD` : "none"}`);

  // 1. Process Kirill's button responses first
  await processKirillResponses(db);

  // 2. Process bot events (leads found → research → notify)
  await processEvents(db, goal);

  // 3. Morning brief at 7:00 AM Calgary
  if (hourCalgary === 7 && minutesCalgary < 2) {
    await sendMorningBrief(db, revenue, goal);
  }

  // 4. Intelligence review — каждые 10 минут Orchestrator анализирует всю систему
  if (minutesCalgary % 10 === 0) {
    await intelligenceReview(db, revenue, goal);
  }

  // 5. Autonomous pipeline — every 30 minutes
  if (minutesCalgary % 30 < 2) {
    await runAutonomousPipeline(db);
  }

  // 6. Check stale leads
  await checkStaleLeads(db);

  // 7. Check dead bots
  await checkDeadBots(db);

  // 8. Outcome collection — contracted module (every hour)
  if (minutesCalgary === 0) {
    try {
      const { runModule } = await import("./contracts/pipeline-runner.mjs");
      const { CONTRACT: ocContract, execute: ocExecute } = await import("./contracts/modules/outcome-collector.mjs");
      const ws = getWorldState(db);
      const result = await runModule(db, ocContract, { time_window_hours: 168 }, ocExecute, { world_state: ws });
      if (result.success) {
        console.log(`[Orchestrator] Outcome collector: ${result.output?.reply_rate}% reply rate, ${result.output?.behavior_changes} changes`);
      } else {
        console.error(`[Orchestrator] Outcome collector failed:`, result.errors);
      }
    } catch (err) {
      // Fallback to old collectOutcomes if contracted module fails
      console.error(`[Orchestrator] Contracted outcome-collector error, falling back:`, err.message);
      await collectOutcomes(db);
    }
  }

  db.close();
}

// ── OUTCOME COLLECTION — feed results back into system ──────────────
async function collectOutcomes(db) {
  try {
    // A. Track reply rates by source platform → update scoring weights
    const platforms = db.prepare(`
      SELECT l.source_platform, COUNT(*) as total,
        SUM(CASE WHEN oe.reply_received_at IS NOT NULL THEN 1 ELSE 0 END) as replies
      FROM outreach_emails oe
      JOIN leads l ON l.id = oe.lead_id
      WHERE oe.sent_at > datetime('now', '-14 days') AND oe.lead_id IS NOT NULL
      GROUP BY l.source_platform
    `).all();

    if (platforms.length > 0) {
      const platformScores = {};
      for (const p of platforms) {
        platformScores[p.source_platform] = {
          total: p.total,
          replies: p.replies,
          replyRate: p.total > 0 ? Math.round(p.replies / p.total * 100) : 0
        };
      }
      setIntelligence(db, "orchestrator", "outcomes", "platform_reply_rates", platformScores, 90);
    }

    // B. Track which scores actually convert → calibrate scoring
    const conversions = db.prepare(`
      SELECT score, stage, source_platform FROM leads
      WHERE stage IN ('contacted', 'replied', 'won') AND score IS NOT NULL AND updated_at > datetime('now', '-14 days')
    `).all();

    if (conversions.length > 5) {
      const replied = conversions.filter(c => c.stage === "replied" || c.stage === "won");
      const avgScoreReplied = replied.length > 0 ? Math.round(replied.reduce((s, c) => s + c.score, 0) / replied.length) : 0;
      const avgScoreAll = Math.round(conversions.reduce((s, c) => s + c.score, 0) / conversions.length);

      setIntelligence(db, "orchestrator", "outcomes", "score_calibration", {
        avgScoreReplied, avgScoreAll,
        sampleSize: conversions.length,
        repliedCount: replied.length,
        insight: avgScoreReplied > avgScoreAll + 10
          ? `Leads that reply have avg score ${avgScoreReplied} vs all contacted ${avgScoreAll}. Raise minimum threshold.`
          : `Score doesn't strongly predict replies. Focus on message quality over lead score.`,
        updatedAt: new Date().toISOString(),
      }, 85);
    }

    // C. Track outreach message patterns that get replies
    const repliedMessages = db.prepare(`
      SELECT oe.body, l.source_platform, l.pain_description
      FROM outreach_emails oe JOIN leads l ON l.id = oe.lead_id
      WHERE oe.reply_received_at IS NOT NULL AND oe.lead_id IS NOT NULL
      ORDER BY oe.reply_received_at DESC LIMIT 10
    `).all();

    if (repliedMessages.length > 0) {
      setIntelligence(db, "orchestrator", "outcomes", "winning_messages", {
        count: repliedMessages.length,
        samples: repliedMessages.map(m => ({
          platform: m.source_platform,
          pain: m.pain_description?.slice(0, 80),
          messagePreview: m.body?.slice(0, 150),
        })),
        updatedAt: new Date().toISOString(),
      }, 90);
    }

    // D. Self-correction: detect failing patterns and flag for angle change
    const totalSent = db.prepare("SELECT COUNT(*) as c FROM outreach_emails WHERE status = 'sent' AND sent_at > datetime('now', '-7 days')").get()?.c || 0;
    const totalReplied = db.prepare("SELECT COUNT(*) as c FROM outreach_emails WHERE reply_received_at IS NOT NULL AND reply_received_at > datetime('now', '-7 days')").get()?.c || 0;
    const replyRate = totalSent > 0 ? Math.round(totalReplied / totalSent * 100) : 0;

    if (totalSent >= 10 && replyRate < 3) {
      setIntelligence(db, "orchestrator", "outcomes", "angle_change_needed", {
        totalSent, totalReplied, replyRate,
        diagnosis: `${totalSent} messages sent, ${totalReplied} replies (${replyRate}%). Current approach is not working. Need to change: message angle, target selection, or channel.`,
        suggestion: replyRate === 0
          ? "Zero replies suggests fundamental mismatch. Consider: 1) different ICP, 2) different pain angle, 3) different channel entirely."
          : `Low reply rate. Try: shorter messages, more specific pain reference, or switch to community engagement over cold outreach.`,
        updatedAt: new Date().toISOString(),
      }, 95);
      console.log(`[Orchestrator] ⚠️ ANGLE CHANGE NEEDED: ${replyRate}% reply rate (${totalReplied}/${totalSent})`);

      // Auto-generate hypotheses (Layer 3) when results are bad
      const existingHypotheses = db.prepare("SELECT COUNT(*) as c FROM hypotheses WHERE status = 'active'").get()?.c || 0;
      if (existingHypotheses < 3) {
        const hypothesesToCreate = [
          { category: "icp", hypothesis: "Current ICP is wrong — targets don't have the pain we're solving", confidence: 40, impact: 90, cost: 30, time: "48h", test: "Interview 3 skipped leads to understand why they didn't respond", signal: "2+ leads say the pain doesn't match their reality" },
          { category: "message", hypothesis: "Opener is too generic — doesn't reference specific enough pain", confidence: 60, impact: 70, cost: 10, time: "24h", test: "A/B: current opener vs ultra-specific pain reference with real example", signal: "Variant B gets 2+ replies vs 0 for variant A" },
          { category: "channel", hypothesis: "Wrong channel for this market — targets aren't active here", confidence: 50, impact: 80, cost: 20, time: "48h", test: "Try Facebook groups / Kalibrr / OnlineJobs.ph instead of LinkedIn", signal: "1+ engagement from alternative channel within 48h" },
          { category: "offer", hypothesis: "Offer is too abstract — needs concrete deliverable and price", confidence: 55, impact: 75, cost: 15, time: "24h", test: "Rewrite offer as: specific deliverable + price + timeframe", signal: "Reply rate increases to >3%" },
          { category: "timing", hypothesis: "Outreach timing is off — sending when targets aren't online", confidence: 30, impact: 40, cost: 5, time: "48h", test: "Send next batch at different time of day", signal: "Open/view rate changes" },
        ];
        for (const h of hypothesesToCreate) {
          createHypothesis(db, {
            category: h.category, hypothesis: h.hypothesis,
            confidence: h.confidence, impactScore: h.impact,
            testCostScore: h.cost, timeToSignal: h.time,
            cheapestTest: h.test, expectedSignal: h.signal,
          });
        }
        console.log(`[Orchestrator] Created ${hypothesesToCreate.length} hypotheses for investigation`);
      }
    }

    console.log(`[Orchestrator] Outcomes collected: ${platforms.length} platforms, ${conversions.length} leads tracked, reply rate: ${replyRate}%`);
  } catch (err) {
    console.error(`[Orchestrator] Outcome collection error:`, err.message);
  }
}

// ── AUTONOMOUS PIPELINE — Lead → Contact → Follow-up ─────────────────
// Runs automatically. Kirill sets rules, system executes.

export async function runAutonomousPipeline(db) {
  const mission = getSystemMission();

  // ═══ PHASE 1: Auto-contact qualified leads ═══
  // Only contact leads that match active project markets
  const portfolio = getPortfolio(db);
  const activeMarkets = portfolio.active.map(p => (p.linked_market || "").toLowerCase()).filter(Boolean);

  let qualifiedLeads = [];
  if (activeMarkets.length > 0) {
    // Build market-aware query
    const marketClauses = activeMarkets.map(m => {
      const keyword = m.split(" ")[0]; // "philippines" from "Philippines BPO"
      return `(source_platform LIKE '%${keyword}%' OR location LIKE '%${keyword}%' OR pain_description LIKE '%${keyword}%')`;
    }).join(" OR ");

    qualifiedLeads = db.prepare(`
      SELECT * FROM leads
      WHERE stage = 'new' AND score >= 60
      AND id NOT IN (SELECT DISTINCT lead_id FROM outreach_emails WHERE lead_id IS NOT NULL)
      AND (${marketClauses})
      ORDER BY score DESC LIMIT 5
    `).all();
  }

  // Fallback: if no active projects or no market-matched leads, use general high-score leads
  if (qualifiedLeads.length === 0) {
    qualifiedLeads = db.prepare(`
      SELECT * FROM leads
      WHERE stage = 'new' AND score >= 75
      AND id NOT IN (SELECT DISTINCT lead_id FROM outreach_emails WHERE lead_id IS NOT NULL)
      ORDER BY score DESC LIMIT 3
    `).all();
  }

  if (qualifiedLeads.length > 0) {
    console.log(`[AutoPipeline] ${qualifiedLeads.length} leads ready (markets: ${activeMarkets.join(", ") || "general"})`);
  }

  for (const lead of qualifiedLeads) {
    try {
      // Generate personalized outreach message
      const outreach = await callAI(
        `${mission}

You are writing a FIRST CONTACT message from Kirill to a potential client.

RULES:
- Max 4 sentences. Be specific about THEIR pain, not your skills.
- Reference something specific from their post/profile.
- End with a question, not a pitch.
- NO: "I help businesses", "I can automate", "struggling with", "reaching out"
- YES: Reference their specific situation, ask about their specific problem.
- Sound like a real person who noticed their problem, not a sales bot.
- SIGN AS: Kirill D., Business Automation Consultant. NEVER use "Alex Carter" or any other name.
- NEVER suggest a call, phone call, Zoom, video meeting, or "15-min chat". Kirill sells through TEXT/EMAIL ONLY.
- For email CTA use: "Want me to show you how it works over email?" — NEVER suggest a call.

Return JSON: { "message": "the message", "channel": "email|linkedin|forum", "subject": "email subject if email" }`,
        `Lead: ${lead.name}
Company: ${lead.company || "unknown"}
Platform: ${lead.source_platform}
Pain: ${lead.pain_description || "unknown"}
Source URL: ${lead.source_url || "none"}
Notes: ${(lead.notes || "").slice(0, 500)}`,
        MODEL_DEFAULT
      );

      // Post-process: force correct identity and CTA regardless of GPT output
      if (outreach?.message) {
        outreach.message = outreach.message.replace(/Alex Carter/gi, "Kirill D.");
        outreach.message = outreach.message.replace(/Kirill D.\b/gi, "Kirill D.");
        outreach.message = outreach.message.replace(/Kirill D./gi, "Kirill D.");
        outreach.message = outreach.message.replace(/(?:Worth|Schedule|Book|How about|Want to hop on|Grab|Let'?s set up|Can we do|Have time for) a (?:15-min |quick |brief )?(?:call|chat|Zoom|video|phone)[^?.!]*[?.!]/gi, "Want me to show you how it works over email?");
        outreach.message = outreach.message.replace(/(?:hop on|jump on) a (?:quick )?(?:call|Zoom|chat)[^?.!]*[?.!]/gi, "Want me to show you how it works over email?");
        if (outreach.subject) {
          outreach.subject = outreach.subject.replace(/Alex Carter/gi, "Kirill D.");
        }
      }

      // Validate the message
      if (!outreach?.message || !isCleanOutreach(outreach.message)) {
        console.log(`[AutoPipeline] Skip ${lead.name} — AI-sounding message, regenerating later`);
        continue;
      }

      // Determine actual delivery channel based on platform
      const platform = lead.source_platform || "";
      const isReddit = platform.includes("reddit") || (lead.source_url || "").includes("reddit.com");
      const isLinkedIn = platform.includes("linkedin");
      const hasEmail = lead.email && lead.email.includes("@");
      const isForum = platform.includes("n8n_community") || platform.includes("community");

      let status = "prepared"; // default: ready for manual delivery
      let deliveryNote = "";

      if (isReddit && lead.source_url) {
        // Reddit: message is a reply on their post — Kirill copies and posts
        status = "ready_reddit";
        deliveryNote = `💬 Ответь на пост: ${lead.source_url}`;
      } else if (isForum && lead.source_url) {
        status = "ready_forum";
        deliveryNote = `💬 Ответь на форуме: ${lead.source_url}`;
      } else if (isLinkedIn) {
        status = "ready_linkedin";
        deliveryNote = `🔗 Отправь в LinkedIn: ${lead.linkedin_url || lead.source_url || "найди профиль"}`;
      } else if (hasEmail) {
        status = "ready_email";
        deliveryNote = `📧 Email: ${lead.email}`;
      }

      // Apr 8 2026 fix: only insert into outreach_emails if there is a real email.
      // Reddit/LinkedIn/forum leads without an email were creating data contamination
      // that broke monitor-replies (DMARC reports got matched to empty-email records
      // and triggered fake "client replied" Telegram alerts).
      if (!hasEmail) {
        console.log(`[AutoPipeline] Skip outreach_emails insert for ${lead.name} - no email (${lead.source_platform}). Lead remains in leads table only.`);
        // Still update lead stage to indicate outreach was prepared
        db.prepare(`UPDATE leads SET stage = 'contacted', last_contact_at = datetime('now'), next_followup_at = datetime('now', '+3 days'), updated_at = datetime('now'), notes = COALESCE(notes,'') || ' | autopipeline drafted ' || datetime('now') WHERE id = ?`).run(lead.id);
        continue;
      }

      // Save outreach to DB (only for real email leads)
      db.prepare(`
        INSERT INTO outreach_emails (id, business_name, business_email, business_category, subject, body, status, sent_at, lead_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(),
        lead.name,
        lead.email,
        lead.source_platform,
        outreach.subject || `Re: ${lead.name}`,
        outreach.message,
        status,
        new Date().toISOString(),
        lead.id
      );

      // Update lead stage
      db.prepare(`UPDATE leads SET stage = 'contacted', last_contact_at = datetime('now'), next_followup_at = datetime('now', '+3 days'), updated_at = datetime('now') WHERE id = ?`)
        .run(lead.id);

      // Notify Kirill with message + clear action to take
      const channelEmoji = { ready_reddit: "💬", ready_forum: "💬", ready_linkedin: "🔗", ready_email: "📧", prepared: "📨" };
      const actionButtons = [];
      if (lead.source_url) {
        actionButtons.push([{ text: "🔗 Открыть пост", url: lead.source_url }]);
      }
      actionButtons.push([
        { text: "✅ Отправил", callback_data: `auto_sent:${lead.id}` },
        { text: "👎 Плохое сообщение", callback_data: `auto_bad:${lead.id}` },
      ]);
      actionButtons.push([{ text: "🤖 Меню", callback_data: "menu" }]);

      await tgSendToKirill(
        `✉️ <b>Готово сообщение → ${lead.name}</b> (${lead.score}/100)\n` +
        `${channelEmoji[status] || "📨"} ${deliveryNote}\n\n` +
        `<b>Сообщение (скопируй):</b>\n` +
        `<code>${outreach.message}</code>\n\n` +
        `<i>Нажми "Отправил" когда скопируешь и отправишь.</i>`,
        { reply_markup: { inline_keyboard: actionButtons }}
      );

      console.log(`[AutoPipeline] ✉️ Contacted ${lead.name} via ${outreach.channel}`);

      // Log to agent_task_log for learning loop
      logAgentTask(db, {
        agentId: "auto-pipeline", projectId: null,
        taskType: "outreach", goal: `Contact ${lead.name} for ${lead.pain_description?.slice(0, 50)}`,
        whyNow: `Score ${lead.score}/100, stage was 'new'`,
        expectedOutcome: "Reply within 3 days",
        constraints: `Channel: ${status}`, nextAgent: "sales-bot",
      });

      await new Promise(r => setTimeout(r, 2000));

    } catch (err) {
      console.error(`[AutoPipeline] Error contacting ${lead.name}:`, err.message);
    }
  }

  // ═══ PHASE 2: Auto follow-up overdue leads ═══
  const overdueLeads = db.prepare(`
    SELECT * FROM leads
    WHERE stage = 'contacted'
    AND next_followup_at IS NOT NULL
    AND next_followup_at <= datetime('now')
    AND follow_up_count < 3
    ORDER BY next_followup_at ASC LIMIT 3
  `).all();

  for (const lead of overdueLeads) {
    try {
      const followUpNum = (lead.follow_up_count || 0) + 1;

      const followUp = await callAI(
        `${mission}

Write follow-up #${followUpNum} to someone who didn't reply to the first message.

RULES:
- Max 2 sentences.
- Reference the original outreach context.
- Don't be pushy. Be helpful.
- Follow-up 1: Quick bump, add value.
- Follow-up 2: Different angle, show understanding.
- Follow-up 3: Graceful close, leave door open.

Return JSON: { "message": "the follow-up text", "subject": "subject line" }`,
        `Lead: ${lead.name}, Company: ${lead.company || "?"}, Pain: ${lead.pain_description || "?"}
Days since last contact: ${getDaysSince(lead.last_contact_at)}`,
        MODEL_DEFAULT
      );

      if (!followUp?.message) continue;

      db.prepare(`UPDATE leads SET follow_up_count = ?, last_contact_at = datetime('now'), next_followup_at = datetime('now', '+4 days'), updated_at = datetime('now') WHERE id = ?`)
        .run(followUpNum, lead.id);

      await tgSendToKirill(
        `🔄 <b>Follow-up #${followUpNum} → ${lead.name}</b>\n\n<code>${followUp.message.slice(0, 300)}</code>`
      );

      console.log(`[AutoPipeline] Follow-up #${followUpNum} → ${lead.name}`);

    } catch (err) {
      console.error(`[AutoPipeline] Follow-up error for ${lead.name}:`, err.message);
    }
  }

  // ═══ PHASE 3: Enforce learned rules as CODE ═══
  const scoringRules = getIntelligenceKey(db, "learn-bot", "learned_rules", "lead_scoring");
  if (scoringRules?.hard_reject_patterns) {
    // Auto-reject leads that match hard reject patterns
    const newLeads = db.prepare(`SELECT id, name, pain_description, notes FROM leads WHERE stage = 'new'`).all();
    for (const lead of newLeads) {
      const text = `${lead.name} ${lead.pain_description || ""} ${lead.notes || ""}`.toLowerCase();
      for (const pattern of scoringRules.hard_reject_patterns) {
        if (text.includes(pattern.toLowerCase())) {
          db.prepare(`UPDATE leads SET stage = 'skipped', updated_at = datetime('now') WHERE id = ?`).run(lead.id);
          console.log(`[AutoPipeline] Auto-rejected ${lead.name}: matches "${pattern}"`);
          break;
        }
      }
    }
  }
}


function getDaysSince(dateStr) {
  if (!dateStr) return 999;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
}

// ── BOT-TO-BOT MESSAGING (живая система) ──────────────────────────────
// Боты могут напрямую общаться друг с другом в реальном времени

export function sendMessage(db, { fromBot, toBot, messageType, payload, priority = 5 }) {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO bot_messages (id, from_bot, to_bot, message_type, payload_json, priority, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(id, fromBot, toBot, messageType, JSON.stringify(payload), priority, new Date().toISOString());
  return id;
}

export function pollMessages(db, botId, limit = 10) {
  const rows = db.prepare(`
    SELECT * FROM bot_messages
    WHERE to_bot = ? AND status = 'pending'
    ORDER BY priority DESC, created_at ASC
    LIMIT ?
  `).all(botId, limit);

  // Mark as read
  for (const r of rows) {
    db.prepare(`UPDATE bot_messages SET status = 'read', read_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), r.id);
  }

  return rows.map(r => ({ ...r, payload: JSON.parse(r.payload_json) }));
}

export function markMessageActedOn(db, messageId, result = {}) {
  db.prepare(`UPDATE bot_messages SET status = 'acted_on', result_json = ?, acted_at = ? WHERE id = ?`)
    .run(JSON.stringify(result), new Date().toISOString(), messageId);
}

export function broadcastMessage(db, { fromBot, messageType, payload, priority = 5 }) {
  return sendMessage(db, { fromBot, toBot: "ALL", messageType, payload, priority });
}

// ═══════════════════════════════════════════════════════════════════════
// OPERATING CONSTRAINTS — hardcoded, not GPT-dependent
// ═══════════════════════════════════════════════════════════════════════

export const CONSTRAINTS = {
  MAX_ACTIVE_PROJECTS: 3,
  MAX_POSTS_PER_2_DAYS: 1,
  MAX_NEW_OPPORTUNITIES_PER_DAY: 1,
  MIN_OPPORTUNITY_SCORE: 70,
  // Auto: scan, qualify, prepare, update. Manual: promote, publish, outreach launch, build start
  REQUIRES_APPROVAL: ["promote_to_project", "publish_content", "launch_outreach", "start_build"],
};

// ═══════════════════════════════════════════════════════════════════════
// PORTFOLIO — all projects as one view
// ═══════════════════════════════════════════════════════════════════════

export function getPortfolio(db) {
  const projects = db.prepare(`SELECT * FROM projects ORDER BY priority_score DESC`).all();
  const active = projects.filter(p => ["planning", "execution", "waiting_response"].includes(p.status));
  const queued = projects.filter(p => p.status === "selected");
  const paused = projects.filter(p => p.status === "paused");
  const blocked = projects.filter(p => p.status === "blocked");
  const completed = projects.filter(p => p.status === "completed");

  return { active, queued, paused, blocked, completed, all: projects };
}

export function getProjectWithSteps(db, projectId) {
  const project = db.prepare(`SELECT * FROM projects WHERE id = ?`).get(projectId);
  if (!project) return null;
  const steps = db.prepare(`SELECT * FROM project_steps WHERE project_id = ? ORDER BY step_number ASC`).all(projectId);
  return { ...project, steps };
}

// ═══════════════════════════════════════════════════════════════════════
// OPPORTUNITY QUALIFICATION — signal → qualified opportunity
// ═══════════════════════════════════════════════════════════════════════

export async function qualifyOpportunity(db, signal) {
  // Check for duplicates
  const existing = db.prepare(`SELECT id FROM opportunities WHERE title = ? AND decision != 'rejected' AND created_at > datetime('now', '-14 days')`).get(signal.title);
  if (existing) {
    console.log(`[QualifyOpp] Duplicate: "${signal.title}" — skipping`);
    return null;
  }

  const mission = getSystemMission();
  const portfolio = getPortfolio(db);
  const activeNames = portfolio.active.map(p => p.name).join(", ") || "none";

  const analysis = await callAI(
    `${mission}

You are the Opportunity Qualification Engine. Analyze this market signal and decide if it's worth pursuing.

Current active projects: ${activeNames} (${portfolio.active.length}/${CONSTRAINTS.MAX_ACTIVE_PROJECTS} max)
Queued projects: ${portfolio.queued.length}

IMPORTANT: Be selective. Not every signal is an opportunity. Only qualify if there's clear evidence of demand AND Kirill can deliver.

Return JSON: {
  "is_qualified": true/false,
  "priority_score": 0-100,
  "why_good_for_kirill": "specific reason this matches his skills",
  "why_now": "why this week, not next month",
  "market": "specific market/niche",
  "icp": "who exactly would buy",
  "pain": "specific pain in 1 sentence",
  "proof_signals": "what data proves demand exists",
  "entry_path": "exact first 3 steps to enter this market",
  "risks": "what could go wrong",
  "execution_time": "hours to first result"
}`,
    `Signal: ${signal.title}\nSource: ${signal.source || signal.origin_bot}\nDetails: ${signal.description || signal.pain || ""}\nMarket: ${signal.market || "unknown"}\nEvidence: ${signal.proof || signal.body || ""}`,
    MODEL_DEFAULT
  ).catch(e => { logError("orchestrator", "api", `AI signal analysis failed: ${e.message}`, "processEvents"); return null; });

  if (!analysis || !analysis.is_qualified) {
    console.log(`[QualifyOpp] Rejected: "${signal.title}" — not qualified`);
    return null;
  }

  const oppId = randomUUID();
  db.prepare(`
    INSERT INTO opportunities (id, title, type, market, pain, proof_signals, why_good_for_kirill, why_now, icp, entry_path, execution_package, priority_score, origin_bot, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    oppId, String(signal.title || "").slice(0, 200), String(signal.type || "market"),
    String(analysis.market || "").slice(0, 100), String(analysis.pain || "").slice(0, 500),
    String(analysis.proof_signals || "").slice(0, 500),
    String(analysis.why_good_for_kirill || "").slice(0, 300),
    String(analysis.why_now || "").slice(0, 300),
    String(analysis.icp || "").slice(0, 300), String(analysis.entry_path || "").slice(0, 500),
    JSON.stringify({ risks: analysis.risks || "", execution_time: analysis.execution_time || "" }),
    parseInt(analysis.priority_score) || 50, String(signal.origin_bot || "unknown")
  );

  console.log(`[QualifyOpp] ✅ Qualified: "${signal.title}" (${analysis.priority_score}/100)`);
  return { id: oppId, ...analysis, title: signal.title };
}

// ═══════════════════════════════════════════════════════════════════════
// DECISION ENGINE — promote / queue / merge / defer / reject
// ═══════════════════════════════════════════════════════════════════════

export async function decisionEngine(db, opportunityId) {
  const opp = db.prepare(`SELECT * FROM opportunities WHERE id = ?`).get(opportunityId);
  if (!opp) return null;

  const portfolio = getPortfolio(db);
  const activeCount = portfolio.active.length;

  // Check today's promoted count
  const promotedToday = db.prepare(`SELECT COUNT(*) as c FROM opportunities WHERE decision = 'promoted' AND reviewed_at > datetime('now', '-24 hours')`).get()?.c || 0;

  // Check for similar active projects
  const similarProject = portfolio.active.find(p =>
    p.linked_market === opp.market || p.name.toLowerCase().includes(opp.market?.toLowerCase() || "___")
  );

  let decision = "pending";
  let reason = "";

  // Rule 1: Max active projects
  if (activeCount >= CONSTRAINTS.MAX_ACTIVE_PROJECTS) {
    decision = "queued";
    reason = `${activeCount}/${CONSTRAINTS.MAX_ACTIVE_PROJECTS} active projects — no capacity. Queued for when a slot opens.`;
  }
  // Rule 2: Max 1 new opportunity per day
  else if (promotedToday >= CONSTRAINTS.MAX_NEW_OPPORTUNITIES_PER_DAY) {
    decision = "deferred";
    reason = `Already promoted ${promotedToday} opportunity today. Deferred to tomorrow.`;
  }
  // Rule 3: Similar project exists — merge
  else if (similarProject) {
    decision = "merged";
    reason = `Similar active project "${similarProject.name}" in ${similarProject.linked_market}. Merged as subtask.`;
  }
  // Rule 4: Score too low
  else if (opp.priority_score < CONSTRAINTS.MIN_OPPORTUNITY_SCORE) {
    decision = "rejected";
    reason = `Score ${opp.priority_score} < ${CONSTRAINTS.MIN_OPPORTUNITY_SCORE} minimum.`;
  }
  // Rule 5: Ready to promote (requires Kirill approval)
  else {
    decision = "ready_to_promote";
    reason = `Score ${opp.priority_score}/100, capacity available (${activeCount}/${CONSTRAINTS.MAX_ACTIVE_PROJECTS}), fits Kirill's skills.`;
  }

  db.prepare(`UPDATE opportunities SET decision = ?, decision_reason = ?, reviewed_at = datetime('now') WHERE id = ?`)
    .run(decision, reason, opportunityId);

  console.log(`[DecisionEngine] ${opp.title}: ${decision} — ${reason}`);
  return { decision, reason, opportunity: opp };
}

// ═══════════════════════════════════════════════════════════════════════
// PROJECT CREATION — only after approval, with full execution package
// ═══════════════════════════════════════════════════════════════════════

export function createProjectFromOpportunity(db, opportunityId) {
  const opp = db.prepare(`SELECT * FROM opportunities WHERE id = ?`).get(opportunityId);
  if (!opp) return null;

  const projectId = randomUUID();
  const execPkg = (() => { try { return JSON.parse(opp.execution_package); } catch { return {}; } })();

  db.prepare(`
    INSERT INTO projects (id, name, type, goal, why_now, origin_opportunity_id, origin_signal, status, current_stage, next_step, priority_score, linked_market, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'planning', 'step_1', ?, ?, ?, datetime('now'), datetime('now'))
  `).run(
    projectId, opp.title, opp.type || "market",
    `Enter ${opp.market} market via ${opp.icp}`,
    opp.why_now, opportunityId,
    opp.proof_signals,
    opp.entry_path,
    opp.priority_score, opp.market
  );

  // Link opportunity to project
  db.prepare(`UPDATE opportunities SET decision = 'promoted', linked_project_id = ?, reviewed_at = datetime('now') WHERE id = ?`)
    .run(projectId, opportunityId);

  console.log(`[CreateProject] ✅ Project created: "${opp.title}" (${projectId})`);
  return projectId;
}

// ═══════════════════════════════════════════════════════════════════════
// AGENT TASK LOGGING — every bot action with purpose and outcome
// ═══════════════════════════════════════════════════════════════════════

export function logAgentTask(db, { agentId, projectId, taskType, goal, whyNow, expectedOutcome, constraints, nextAgent }) {
  const taskId = randomUUID();
  db.prepare(`
    INSERT INTO agent_task_log (id, agent_id, project_id, task_type, goal, why_this_now, expected_outcome, constraints, next_consumer_agent, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(taskId, agentId, projectId, taskType, goal, whyNow, expectedOutcome, constraints, nextAgent);
  return taskId;
}

export function completeAgentTask(db, taskId, { result, assumptions, risks, openItems, outcomeScore }) {
  db.prepare(`
    UPDATE agent_task_log SET result = ?, assumptions_used = ?, risks_seen = ?, open_items = ?, outcome_score = ?, completed_at = datetime('now') WHERE id = ?
  `).run(result, assumptions, risks, openItems, outcomeScore || null, taskId);
}

export function recordOutcomeFeedback(db, taskId, feedback) {
  db.prepare(`UPDATE agent_task_log SET outcome_feedback = ? WHERE id = ?`).run(feedback, taskId);
}

// ═══════════════════════════════════════════════════════════════════════
// CONTENT CALENDAR — governed publishing
// ═══════════════════════════════════════════════════════════════════════

export function canPublishToday(db) {
  const recent = db.prepare(`SELECT COUNT(*) as c FROM content_calendar WHERE status = 'published' AND published_at > datetime('now', '-2 days')`).get()?.c || 0;
  return recent < CONSTRAINTS.MAX_POSTS_PER_2_DAYS;
}

export function scheduleContent(db, { projectId, topic, angle, platform, purpose, scheduledDate }) {
  const id = randomUUID();
  db.prepare(`
    INSERT INTO content_calendar (id, project_id, content_type, topic, angle, target_platform, purpose, status, scheduled_date, created_at)
    VALUES (?, ?, 'linkedin_post', ?, ?, ?, ?, 'planned', ?, datetime('now'))
  `).run(id, projectId, topic, angle, platform || "linkedin", purpose, scheduledDate);
  return id;
}

// ═══════════════════════════════════════════════════════════════════════
// LAYER 2 — COMPILED WORLD STATE (materialized from truth tables)
// ═══════════════════════════════════════════════════════════════════════

let _worldStateCache = null;
let _worldStateCacheTime = 0;

export function getWorldState(db) {
  // Cache for 2 minutes
  if (_worldStateCache && Date.now() - _worldStateCacheTime < 2 * 60 * 1000) return _worldStateCache;

  const compiledAt = new Date().toISOString();
  const missingInputs = [];

  // Goal
  const goal = db.prepare("SELECT * FROM goals WHERE status = 'active' ORDER BY created_at DESC LIMIT 1").get();
  if (!goal) missingInputs.push("no_active_goal");
  const deadline = goal?.deadline ? new Date(goal.deadline) : new Date("2026-06-01");
  const daysLeft = Math.max(0, Math.ceil((deadline - new Date()) / (1000 * 60 * 60 * 24)));

  // Portfolio
  const portfolio = getPortfolio(db);

  // Constraints (from registry)
  let constraintsMap = {};
  try {
    const rows = db.prepare("SELECT constraint_type, scope, rule, priority, hard_or_soft FROM constraints WHERE active = 1 ORDER BY priority DESC").all();
    for (const r of rows) {
      const key = `${r.constraint_type}/${r.scope}`;
      if (!constraintsMap[key]) constraintsMap[key] = [];
      constraintsMap[key].push({ rule: r.rule, priority: r.priority, hard: r.hard_or_soft });
    }
  } catch {}

  // Outcomes
  const sent7d = db.prepare("SELECT COUNT(*) as c FROM outreach_emails WHERE status = 'sent' AND sent_at > datetime('now', '-7 days')").get()?.c || 0;
  const replied7d = db.prepare("SELECT COUNT(*) as c FROM outreach_emails WHERE reply_received_at > datetime('now', '-7 days')").get()?.c || 0;
  const replyRate = sent7d > 0 ? Math.round(replied7d / sent7d * 100) : 0;

  // Evidence stats
  const evidenceCount = db.prepare("SELECT COUNT(*) as c FROM execution_evidence").get()?.c || 0;

  // Active hypotheses
  let activeHypotheses = [];
  try {
    activeHypotheses = db.prepare("SELECT hypothesis, category, confidence, priority_score, cheapest_test FROM hypotheses WHERE status = 'active' ORDER BY priority_score DESC LIMIT 5").all();
  } catch {}

  // Winning patterns
  let winningMessages = [];
  try {
    const raw = getIntelligenceKey(db, "orchestrator", "outcomes", "winning_messages");
    if (raw?.samples) winningMessages = raw.samples;
  } catch {}

  // Channel effectiveness per market
  let channelEffectiveness = {};
  try {
    const raw = getIntelligenceKey(db, "orchestrator", "outcomes", "platform_reply_rates");
    if (raw) channelEffectiveness = raw;
  } catch {}

  // Disconfirmed patterns
  let disconfirmed = [];
  try {
    disconfirmed = db.prepare("SELECT hypothesis, evidence FROM hypotheses WHERE status = 'disconfirmed' ORDER BY resolved_at DESC LIMIT 10").all();
  } catch {}

  // Behavior changes (recent)
  let recentChanges = [];
  try {
    recentChanges = db.prepare("SELECT parameter_changed, before_value, after_value, reason FROM behavior_changes ORDER BY created_at DESC LIMIT 5").all();
  } catch {}

  const stateConfidence = missingInputs.length === 0 ? "high" : missingInputs.length <= 2 ? "medium" : "low";

  _worldStateCache = {
    compiled_at: compiledAt,
    fresh_until: new Date(Date.now() + 2 * 60 * 1000).toISOString(),
    data_freshness: "2min_cache",
    missing_inputs: missingInputs,
    state_confidence: stateConfidence,

    goal: {
      target: goal?.target_amount || 1500,
      current: goal?.current_amount || 0,
      currency: "CAD",
      deadline: deadline.toISOString().slice(0, 10),
      days_left: daysLeft,
    },

    portfolio: {
      active: portfolio.active.map(p => ({ id: p.id, name: p.name, market: p.linked_market, stage: p.current_stage, status: p.status })),
      queued: portfolio.queued.length,
      paused: portfolio.paused.length,
      waiting: portfolio.all.filter(p => p.status === "waiting_response").length,
      completed: portfolio.completed.length,
    },

    constraints: constraintsMap,

    outcomes: {
      sent_7d: sent7d,
      replied_7d: replied7d,
      reply_rate: replyRate,
      evidence_records: evidenceCount,
      channel_effectiveness: channelEffectiveness,
      winning_patterns: winningMessages.slice(0, 3),
    },

    hypotheses: {
      active: activeHypotheses,
      disconfirmed: disconfirmed.map(h => h.hypothesis),
    },

    recent_adaptations: recentChanges,
  };

  _worldStateCacheTime = Date.now();
  return _worldStateCache;
}

// Serialize world state for bot consumption (structured, not prompt text)
export function getWorldStateForBot(db, botId) {
  const state = getWorldState(db);

  // Filter constraints relevant to this bot
  const relevantConstraints = {};
  for (const [key, rules] of Object.entries(state.constraints)) {
    const [type, scope] = key.split("/");
    if (type === "platform" || type === "channel" || type === "execution" || type === "content") {
      relevantConstraints[key] = rules.map(r => r.rule).join("; ");
    }
  }

  return {
    ...state,
    constraints: relevantConstraints,
    requesting_bot: botId,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// LAYER 3 — REASONING SUPPORT (hypothesis + justification)
// ═══════════════════════════════════════════════════════════════════════

export function createHypothesis(db, { projectId, category, hypothesis, confidence, impactScore, testCostScore, timeToSignal, cheapestTest, expectedSignal }) {
  const id = randomUUID();
  const priorityScore = Math.round((impactScore * 0.4) + ((100 - testCostScore) * 0.3) + (confidence * 0.3));

  db.prepare(`INSERT INTO hypotheses (id, project_id, category, hypothesis, confidence, impact_score, test_cost_score, time_to_signal, priority_score, cheapest_test, expected_signal, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`)
    .run(id, projectId, category, hypothesis, confidence, impactScore, testCostScore, timeToSignal, priorityScore, cheapestTest, expectedSignal);
  return id;
}

export function resolveHypothesis(db, hypothesisId, status, evidence) {
  db.prepare("UPDATE hypotheses SET status = ?, evidence = ?, resolved_at = datetime('now') WHERE id = ?")
    .run(status, evidence, hypothesisId);
}

export function createExperiment(db, { hypothesisId, projectId, type, description, variantA, variantB, successMetric }) {
  const id = randomUUID();
  db.prepare("INSERT INTO experiments (id, hypothesis_id, project_id, experiment_type, description, variant_a, variant_b, success_metric) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, hypothesisId, projectId, type, description, variantA, variantB, successMetric);
  return id;
}

// ═══════════════════════════════════════════════════════════════════════
// LAYER 4 — ADAPTATION (behavior changes with proof)
// ═══════════════════════════════════════════════════════════════════════

export function recordBehaviorChange(db, { triggerType, triggerEvidenceId, changeType, scope, parameterChanged, beforeValue, afterValue, reason, impactExpected }) {
  const id = randomUUID();
  db.prepare("INSERT INTO behavior_changes (id, trigger_type, trigger_evidence_id, change_type, scope, parameter_changed, before_value, after_value, reason, impact_expected) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(id, triggerType, triggerEvidenceId, changeType, scope || "fast", parameterChanged, beforeValue, afterValue, reason, impactExpected);
  return id;
}

export function recordEvidence(db, { entityId, projectId, hypothesisId, experimentId, actionType, channel, deliveryMode, targetName, targetUrl, targetEntityId, sentText, sourceStepId, sourceArtifactId, approvedByHuman, outcomeTier }) {
  const id = randomUUID();
  const hash = sentText ? Buffer.from(sentText).toString("base64").slice(0, 32) : null;

  db.prepare(`INSERT INTO execution_evidence (id, entity_id, project_id, hypothesis_id, experiment_id, action_type, channel, delivery_mode, target_name, target_url, target_entity_id, sent_text, sent_text_hash, sent_at, source_step_id, source_artifact_id, approved_by_human, outcome_tier) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?)`)
    .run(id, entityId, projectId, hypothesisId, experimentId, actionType, channel, deliveryMode || "manual", targetName, targetUrl, targetEntityId, sentText, hash, sourceStepId, sourceArtifactId, approvedByHuman ? 1 : 0, outcomeTier);
  return id;
}

// ── Entry point ───────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  orchestratorTick().catch(console.error);
}

export { orchestratorTick };
