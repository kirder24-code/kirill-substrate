/**
 * SYSTEM HEALTHCHECK — runs every 4 hours
 *
 * Uses structured heartbeat data (health_status, last_success_at, error)
 * to classify each bot as: ok / degraded / error / dead.
 *
 * Sends ONE Telegram message with full picture.
 */

import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import { tgSendToKirill, setIntelligence, getIntelligenceKey } from "./orchestrator.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, "../../.data/linkedin-brand-os.sqlite");
const LOGS_DIR = resolve(__dirname, "../../.logs");

const EXPECTED_BOTS = [
  { name: "scout-bot",              script: "scout-bot.mjs",              critical: true,  hbId: "scout" },
  { name: "reddit-monitor",         script: "reddit-monitor.mjs",         critical: true,  hbId: "reddit-monitor" },
  { name: "telegram-sales-agent",   script: "telegram-sales-agent.mjs",   critical: true,  hbId: "telegram-sales-agent" },
  { name: "telegram-control",       script: "telegram-control.mjs",       critical: true,  hbId: "telegram-control" },
  { name: "content-bot",            script: "content-bot.mjs",            critical: false, hbId: "content_factory" },
  { name: "trend-bot",              script: "trend-bot.mjs",              critical: false, hbId: "trend" },
  { name: "community-bot",          script: "community-bot.mjs",          critical: false, hbId: "community-bot" },
  { name: "idea-bot",               script: "idea-bot.mjs",               critical: false, hbId: "idea-bot" },
  { name: "research-bot",           script: "research-bot.mjs",           critical: false, hbId: "research-bot" },
  { name: "linkedin-hunter",        script: "linkedin-hunter.mjs",        critical: false, hbId: "linkedin-hunter" },
  { name: "sales-bot",              script: "sales-bot.mjs",              critical: false, hbId: "sales" },
  { name: "pr-bot",                 script: "pr-bot.mjs",                 critical: false, hbId: "pr-bot" },
  { name: "analytics-bot",          script: "analytics-bot.mjs",          critical: false, hbId: "analytics" },
  { name: "brief-agent",            script: "brief-agent.mjs",            critical: false, hbId: "brief-agent" },
  { name: "learn-bot",              script: "learn-bot.mjs",              critical: false, hbId: "learn-bot" },
  { name: "evolution-bot",          script: "evolution-bot.mjs",          critical: false, hbId: "evolution" },
  { name: "service-bot",            script: "service-bot.mjs",            critical: false, hbId: "service_bot" },
  { name: "build-bot",              script: "build-bot.mjs",              critical: false, hbId: "build" },
];

function isProcessRunning(scriptName) {
  try {
    const out = execSync(`pgrep -f "${scriptName}"`, { encoding: "utf8", timeout: 5000 });
    return out.trim().split("\n").filter(Boolean).length > 0;
  } catch { return false; }
}

/**
 * Read recent log errors for a bot. Two-pass approach:
 * 1. Parse structured JSON lines ({"_r":1,...}) — precise, no false positives
 * 2. Fallback: count lines containing "ERROR" — legacy, may have false positives
 *
 * Returns { structured: number, legacy: number, total: number, lastCode: string|null }
 */
function getRecentLogErrors(botName) {
  const logFile = resolve(LOGS_DIR, `${botName}.log`);
  if (!existsSync(logFile)) return { structured: 0, legacy: 0, total: 0, lastCode: null };
  try {
    const content = execSync(`tail -300 "${logFile}"`, { encoding: "utf8", timeout: 5000 });
    const oneHourAgo = Date.now() - 3600000;
    const lines = content.split("\n");

    let structured = 0;
    let legacy = 0;
    let lastCode = null;

    for (const line of lines) {
      // Try structured entry first
      const jsonStart = line.indexOf('{"_r":1,');
      if (jsonStart >= 0) {
        try {
          const entry = JSON.parse(line.slice(jsonStart));
          if (entry._r === 1 && (entry.level === "error" || entry.level === "warn")) {
            const entryTime = entry.at ? new Date(entry.at).getTime() : 0;
            if (entryTime > oneHourAgo) {
              structured++;
              if (entry.level === "error" && entry.code) lastCode = entry.code;
            }
          }
          continue; // Don't double-count as legacy
        } catch {} // Not valid JSON — fall through to legacy
      }

      // Legacy fallback: grep for ERROR/Error:
      if (line.includes("ERROR") || line.includes("Error:")) {
        const m = line.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
        if (!m || new Date(m[0]).getTime() > oneHourAgo) {
          legacy++;
        }
      }
    }

    return { structured, legacy, total: structured + legacy, lastCode };
  } catch { return { structured: 0, legacy: 0, total: 0, lastCode: null }; }
}

export async function runHealthcheck() {
  const db = new Database(DB_PATH);
  const now = Date.now();

  const errorBots = [];
  const degradedBots = [];
  const okBots = [];
  const deadBots = [];
  const trippedBots = [];

  // Read circuit breaker state from supervisor
  let trippedState = {};
  try {
    const trippedFile = resolve(__dirname, "../../.data/supervisor-tripped.json");
    if (existsSync(trippedFile)) {
      trippedState = JSON.parse(readFileSync(trippedFile, "utf8"));
    }
  } catch {}

  for (const bot of EXPECTED_BOTS) {
    // Check circuit breaker first
    const tripped = trippedState[bot.name];
    if (tripped) {
      const elapsed = Math.round((Date.now() - tripped.trippedAt) / 60000);
      trippedBots.push({ ...bot, restarts: tripped.restarts, elapsed, lastError: tripped.lastError });
      continue; // Don't check further — we know the state
    }

    const running = isProcessRunning(bot.script);

    // Read structured heartbeat
    let hb = null;
    try {
      hb = db.prepare(
        `SELECT health_status, last_success_at, error, pinged_at, last_action FROM bot_heartbeats WHERE bot_id = ?`
      ).get(bot.hbId);
    } catch {}

    const pingAge = hb?.pinged_at ? (now - new Date(hb.pinged_at + "Z").getTime()) : Infinity;
    const pingMins = Math.round(pingAge / 60000);
    const healthStatus = hb?.health_status || "unknown";
    const lastSuccess = hb?.last_success_at || null;
    const logErrs = getRecentLogErrors(bot.name);

    // Parse structured error from heartbeat (JSON) or plain string
    let errorReason = null;
    if (hb?.error) {
      try {
        const parsed = JSON.parse(hb.error);
        errorReason = parsed.message || hb.error;
        if (parsed.code) errorReason = `[${parsed.code}] ${errorReason}`;
      } catch {
        errorReason = hb.error;
      }
      if (errorReason.length > 80) errorReason = errorReason.slice(0, 77) + "...";
    }

    // Enrich with log error code if heartbeat doesn't have one
    if (!errorReason && logErrs.lastCode) {
      errorReason = `[${logErrs.lastCode}] errors in log`;
    }

    // Classify — prefer structured log errors over legacy text grep
    // structured errors = real reliability events, legacy = may be false positives
    const hasRealErrors = logErrs.structured >= 3 || (logErrs.structured === 0 && logErrs.legacy >= 5);

    if (!running) {
      deadBots.push({ ...bot, reason: "процесс не запущен", pingMins });
    } else if (healthStatus === "error" || (hasRealErrors && healthStatus !== "ok")) {
      const errDetail = errorReason || (logErrs.structured > 0
        ? `${logErrs.structured} structured errors in log`
        : `${logErrs.legacy} errors in log (text match)`);
      errorBots.push({ ...bot, reason: errDetail, pingMins, lastSuccess });
    } else if (healthStatus === "degraded") {
      degradedBots.push({ ...bot, reason: hb?.last_action || "0 output", pingMins, lastSuccess });
    } else if (healthStatus === "unknown" && pingMins > 60) {
      degradedBots.push({ ...bot, reason: `heartbeat ${pingMins}м назад (unknown status)`, pingMins, lastSuccess });
    } else {
      okBots.push({ ...bot, pingMins, lastSuccess });
    }
  }

  // Key metrics
  const m = {};
  try {
    m.sent = db.prepare("SELECT COUNT(*) as c FROM outreach_emails WHERE status='sent'").get()?.c || 0;
    m.replied = db.prepare("SELECT COUNT(*) as c FROM outreach_emails WHERE reply_received_at IS NOT NULL").get()?.c || 0;
    m.leads = db.prepare("SELECT COUNT(*) as c FROM leads").get()?.c || 0;
    m.reddit = db.prepare("SELECT COUNT(*) as c FROM bot_intelligence WHERE bot_id='reddit' AND insight_type='monitoring'").get()?.c || 0;
  } catch {}

  try {
    const tg = getIntelligenceKey(db, "telegram-sales-agent", "status", "latest");
    if (tg) { m.tgGroups = tg.groups; m.tgSignals = tg.signals; m.tgPosts = tg.groupPosts; }
  } catch {}

  // Build message
  const calgaryTime = new Date().toLocaleString("ru-RU", { timeZone: "America/Edmonton", hour: "2-digit", minute: "2-digit" });

  let msg = `🏥 <b>Диагностика</b> (${calgaryTime} Calgary)\n\n`;

  if (trippedBots.length > 0) {
    msg += `⚡ <b>Circuit Breaker (${trippedBots.length}):</b>\n`;
    trippedBots.forEach(b => { msg += `  ${b.name}: ${b.restarts} restarts, paused ${b.elapsed}m ago\n`; });
    msg += `\n`;
  }

  if (deadBots.length > 0) {
    msg += `💀 <b>Мёртвые (${deadBots.length}):</b>\n`;
    deadBots.forEach(b => { msg += `  ${b.critical ? "🔴" : "⚪"} ${b.name}\n`; });
    msg += `\n`;
  }

  if (errorBots.length > 0) {
    msg += `🔴 <b>Ошибки (${errorBots.length}):</b>\n`;
    errorBots.forEach(b => { msg += `  ${b.name}: ${b.reason}\n`; });
    msg += `\n`;
  }

  if (degradedBots.length > 0) {
    msg += `🟡 <b>Деградация (${degradedBots.length}):</b>\n`;
    degradedBots.forEach(b => { msg += `  ${b.name}: ${b.reason}\n`; });
    msg += `\n`;
  }

  if (deadBots.length === 0 && errorBots.length === 0 && degradedBots.length === 0) {
    msg += `✅ Все ${okBots.length} ботов работают нормально\n\n`;
  } else {
    msg += `✅ <b>OK (${okBots.length}):</b> ${okBots.map(b => b.name).slice(0, 10).join(", ")}\n\n`;
  }

  msg += `📊 Email: ${m.sent || 0} sent, ${m.replied || 0} replied | Leads: ${m.leads || 0} | Reddit: ${m.reddit || 0} posts\n`;
  if (m.tgGroups !== undefined) {
    msg += `📱 TG: ${m.tgGroups} groups, ${m.tgSignals || 0} signals, ${m.tgPosts || 0} posts`;
  }

  // Save result
  setIntelligence(db, "healthcheck", "results", "latest", {
    timestamp: new Date().toISOString(),
    tripped: trippedBots.map(b => b.name),
    dead: deadBots.map(b => b.name),
    error: errorBots.map(b => b.name),
    degraded: degradedBots.map(b => b.name),
    ok: okBots.map(b => b.name),
    metrics: m,
  }, 100);

  await tgSendToKirill(msg);
  console.log(`[Healthcheck] Dead:${deadBots.length} Error:${errorBots.length} Degraded:${degradedBots.length} OK:${okBots.length}`);

  db.close();
}

async function liveMode() {
  console.log("[Healthcheck] Starting — runs every 4 hours");
  while (true) {
    try { await runHealthcheck(); } catch (err) { console.error("[Healthcheck] Error:", err.message); }
    await new Promise(r => setTimeout(r, 4 * 60 * 60 * 1000));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const isLive = process.argv.includes("live");
  if (isLive) liveMode().catch(console.error);
  else runHealthcheck().catch(console.error);
}
