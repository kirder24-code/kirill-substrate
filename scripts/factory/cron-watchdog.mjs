/**
 * cron-watchdog.mjs
 *
 * Independent verification that scheduled cron jobs are actually firing.
 * NOT based on code state. NOT based on crontab existence. ONLY on log mtime.
 *
 * For each known job:
 *   - Look at its log file mtime
 *   - Compare to expected interval
 *   - If mtime is older than 2x expected interval = MISS
 *   - Report all misses to Telegram + write summary
 *
 * Run: node scripts/factory/cron-watchdog.mjs
 * Cron: every hour. Yes, the watchdog watches the watchers.
 *
 * This exists because of two silent cron regressions found by Kirill on
 * April 6 2026 (timezone bug + nvm PATH bug). Both invisible from inside
 * the system. This watchdog makes them visible the next hour.
 */

import { enforceOAuthBilling } from "../lib/billing-guard.mjs";
enforceOAuthBilling();
import { statSync, existsSync, readFileSync, writeFileSync, appendFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import Database from "better-sqlite3";
import { readPurpose, appendLog } from "../../wiki/reader.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");
const ENV_PATH = resolve(PROJECT_ROOT, "apps/api/.env");

const env = Object.fromEntries(
  readFileSync(ENV_PATH, "utf-8").split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const TG = env.TELEGRAM_BOT_TOKEN;
const CHAT = env.TELEGRAM_CHAT_ID;

// ─── Manifest of known cron jobs and their expected freshness ───────────────
// max_age_min = how stale the log can be before we call it a MISS
// "interval_min × 2" is a sane default - one missed cycle is still acceptable.
const JOBS = [
  // Verified log paths against actual /tmp/lbo-*.log files on Apr 23 2026
  { id: "orchestrator-daemon",    log: "/tmp/lbo-orchestrator-daemon.log",     interval: "30min via daemon", max_age_min: 90, critical: true },
  { id: "orchestrator-loop",     log: ".logs/orchestrator-loop.log",           interval: "30min cycles", max_age_min: 90, critical: true, content_check: "BRANCH:" },
  { id: "followups",              log: "/tmp/lbo-followups.log",                interval: "daily weekday", max_age_min: 60*48, critical: true, weekday_only: true },
  { id: "daily-observations",     log: "/tmp/lbo-observations.log",             interval: "daily 8AM", max_age_min: 60*30, critical: true },
  { id: "monitor-replies",       log: "/tmp/lbo-monitor-replies.log",          interval: "30min", max_age_min: 90, critical: true },
  { id: "awareness-bot",          log: "/tmp/lbo-awareness-bot.log",            interval: "daily", max_age_min: 60*30, critical: false },
  { id: "evolution-bot",          log: "/tmp/lbo-evolution-bot.log",            interval: "daily 3AM", max_age_min: 60*30, critical: false },
  { id: "idea-bot",               log: "/tmp/lbo-idea-bot.log",                interval: "daily", max_age_min: 60*30, critical: false },
  { id: "fresh-pain-scout",       log: "/tmp/lbo-fresh-pain-scout.log",         interval: "2h",     max_age_min: 180,   critical: false },
  { id: "hn-show-hn-scout",       log: "/tmp/lbo-hn-show-hn-scout.log",         interval: "4h",     max_age_min: 300,   critical: false },
  { id: "buying-signal-hunt",     log: "/tmp/lbo-buying-signal-hunt.log",       interval: "3h",     max_age_min: 240,   critical: false },
  { id: "research-bot-v2",       log: "/tmp/lbo-research-bot-v2.log",          interval: "1h :15", max_age_min: 90,    critical: false },
  { id: "lead-enrichment-bot",   log: "/tmp/lbo-lead-enrichment-bot.log",      interval: "1h :30", max_age_min: 90,    critical: false },
  { id: "content-curator-bot",   log: "/tmp/lbo-content-curator-bot.log",      interval: "daily 21:00", max_age_min: 60*30, critical: false },
  { id: "site-curator-bot",      log: "/tmp/lbo-site-curator-bot.log",         interval: "weekly Sun 20:00", max_age_min: 60*24*9, critical: false },
  { id: "icp-outreach-bot",      log: "/tmp/lbo-icp-outreach-bot.log",         interval: "hourly", max_age_min: 120,   critical: false },
  { id: "reddit-monitor",        log: "/tmp/lbo-reddit-monitor.log",           interval: "hourly", max_age_min: 120,   critical: false },
  { id: "threads-bot",           log: "/tmp/lbo-threads-bot.log",              interval: "30min",  max_age_min: 90,    critical: false },
  { id: "sales-bot",             log: "/tmp/lbo-sales-bot.log",                interval: "hourly", max_age_min: 120,   critical: false },
  { id: "community-bot",         log: "/tmp/lbo-community-bot.log",            interval: "hourly", max_age_min: 120,   critical: false },
  { id: "daily-heartbeat",       log: "/tmp/lbo-daily-heartbeat.log",          interval: "daily 8AM", max_age_min: 60*30, critical: false },
];

// ─── For each job, check log freshness ──────────────────────────────────────

const NOW = Date.now();
const MIN = 60 * 1000;

const results = [];
for (const job of JOBS) {
  const logPath = job.log.startsWith("/") ? job.log : resolve(PROJECT_ROOT, job.log);
  let status = "UNKNOWN";
  let detail = "";
  let mtime = null;
  let age_min = null;

  if (!existsSync(logPath)) {
    status = "MISSING_LOG";
    detail = `log file does not exist: ${logPath}`;
  } else {
    try {
      const stat = statSync(logPath);
      mtime = stat.mtime.getTime();
      age_min = Math.floor((NOW - mtime) / MIN);

      if (age_min > job.max_age_min) {
        status = "MISS";
        detail = `last write ${age_min}min ago, expected within ${job.max_age_min}min`;
      } else {
        status = "OK";
        detail = `last write ${age_min}min ago`;
      }

      // Content check: for orchestrator-loop, verify recent cycles have BRANCH output.
      // Window expanded 15 → 60 lines Apr 8 2026 (covers ~4 cycles) so a single bad
      // cycle does not trigger an alert every hour. Wrapper auto-fallback also writes
      // BRANCH: IDLE on non-conforming output, so this should virtually never trip.
      if (status === "OK" && job.content_check) {
        const lastLines = readFileSync(logPath, "utf-8").split("\n").slice(-60);
        const hasContentRecent = lastLines.some(l => l.includes(job.content_check));
        if (!hasContentRecent) {
          status = "SILENT_FAIL";
          detail = `log fresh but no '${job.content_check}' in last 60 lines - 4+ cycles with no BRANCH output, real silent failure`;
        }
      }

      // ERROR PATTERN check: even if log mtime is fresh, the content might be
      // the error message itself. Only check last 10 lines (not 30) to avoid
      // flagging old errors that have already been fixed but are still in the log.
      if (status === "OK") {
        const lastLines = readFileSync(logPath, "utf-8").split("\n").slice(-10).join("\n");
        const ERROR_PATTERNS = [
          { rx: /Cannot find module/, name: "missing-cd-or-bad-path" },
          { rx: /env: node: No such file/, name: "nvm-PATH-missing" },
          { rx: /Operation not permitted/, name: "TCC-blocked" },
          { rx: /Not logged in.*Please run \/login/, name: "claude-OAuth-missing" },
          { rx: /Error: Reached max turns/, name: "claude-max-turns" },
          { rx: /MODULE_NOT_FOUND/, name: "node-module-resolution" },
          { rx: /EACCES|EPERM/, name: "permission-error" },
          { rx: /ECONNREFUSED|ETIMEDOUT/, name: "network-error" },
          { rx: /SQLITE_ERROR|SQLITE_BUSY|SQLITE_CORRUPT/, name: "sqlite-error" },
          { rx: /TypeError:/, name: "TypeError-crash" },
          { rx: /ReferenceError:/, name: "ReferenceError-crash" },
          { rx: /SyntaxError:/, name: "SyntaxError-crash" },
          { rx: /UnhandledPromiseRejection/, name: "unhandled-promise-rejection" },
        ];
        for (const ep of ERROR_PATTERNS) {
          if (ep.rx.test(lastLines)) {
            status = "SILENT_FAIL";
            detail = `log fresh but contains error pattern: ${ep.name}`;
            break;
          }
        }
      }
    } catch (e) {
      status = "ERROR";
      detail = `stat failed: ${e.message}`;
    }
  }

  results.push({ ...job, status, detail, mtime, age_min });
}

// ─── Build report ───────────────────────────────────────────────────────────

// Alert on misses, silent failures, AND missing logs (log should always exist)
const misses = results.filter(r => r.status === "MISS" || r.status === "SILENT_FAIL");
const criticalMisses = misses.filter(r => r.critical);
const missingLogs = results.filter(r => r.status === "MISSING_LOG");

let console_report = `\n═══════════════════════════════════════════════════════\n`;
console_report += `CRON WATCHDOG - ${new Date().toLocaleString("en-US", { timeZone: "America/Edmonton" })}\n`;
console_report += `═══════════════════════════════════════════════════════\n\n`;

const groups = { OK: [], MISS: [], SILENT_FAIL: [], MISSING_LOG: [], ERROR: [] };
for (const r of results) (groups[r.status] || []).push(r);

if (groups.OK.length > 0) {
  console_report += `✅ HEALTHY (${groups.OK.length}):\n`;
  for (const r of groups.OK) console_report += `   ${r.id} - ${r.detail}\n`;
  console_report += `\n`;
}
if (groups.MISS.length > 0) {
  console_report += `⚠️ MISS (${groups.MISS.length}):\n`;
  for (const r of groups.MISS) console_report += `   ${r.critical ? "🔴" : "🟡"} ${r.id} - ${r.detail}\n`;
  console_report += `\n`;
}
if (groups.SILENT_FAIL.length > 0) {
  console_report += `🚨 SILENT FAIL (${groups.SILENT_FAIL.length}):\n`;
  for (const r of groups.SILENT_FAIL) console_report += `   ${r.id} - ${r.detail}\n`;
  console_report += `\n`;
}
if (groups.MISSING_LOG.length > 0) {
  console_report += `❓ MISSING LOG (${groups.MISSING_LOG.length}):\n`;
  for (const r of groups.MISSING_LOG) console_report += `   ${r.id} - log not yet created (may not have fired yet)\n`;
  console_report += `\n`;
}

console.log(console_report);

// ─── Telegram alert if critical misses or silent fails ──────────────────────

async function tg(text) {
  if (!TG || !CHAT) return;
  try {
    await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT, text, parse_mode: "HTML" }),
    });
  } catch (e) { console.error("[watchdog] tg failed:", e.message); }
}

const silentFails = groups.SILENT_FAIL || [];
const shouldAlert = criticalMisses.length > 0 || silentFails.length > 0 || missingLogs.length > 0;
if (shouldAlert) {
  // ─── Deduplication: don't spam the same alert every 15 min ──────────────
  const ALERT_STATE_PATH = resolve(PROJECT_ROOT, ".data/watchdog-last-alert.json");
  const DEDUP_HOURS = 6;
  const currentIssues = [
    ...silentFails.map(r => `${r.id}: ${r.detail}`),
    ...criticalMisses.map(r => `${r.id}: ${r.detail}`),
    ...missingLogs.map(r => `${r.id}: missing_log`),
  ].sort();

  let skipAlert = false;
  try {
    if (existsSync(ALERT_STATE_PATH)) {
      const prev = JSON.parse(readFileSync(ALERT_STATE_PATH, "utf-8"));
      const hoursSince = (Date.now() - new Date(prev.alertedAt).getTime()) / (1000 * 60 * 60);
      const prevSet = new Set(prev.issues || []);
      const newIssues = currentIssues.filter(i => !prevSet.has(i));
      if (hoursSince < DEDUP_HOURS && newIssues.length === 0) {
        skipAlert = true;
        console.log(`[watchdog] same issues already alerted ${Math.round(hoursSince * 10) / 10}h ago, skipping Telegram`);
      }
    }
  } catch (e) {
    // state file corrupt/unreadable - just send the alert
  }

  if (!skipAlert) {
    let msg = `<b>🚨 Cron Watchdog Alert</b>\n\n`;
    if (silentFails.length > 0) {
      msg += `<b>Silent failures:</b>\n`;
      for (const r of silentFails) msg += `- ${r.id}: ${r.detail}\n`;
      msg += `\n`;
    }
    if (criticalMisses.length > 0) {
      msg += `<b>Critical misses:</b>\n`;
      for (const r of criticalMisses) msg += `- ${r.id}: ${r.detail}\n`;
      msg += `\n`;
    }
    if (missingLogs.length > 0) {
      msg += `<b>Missing logs (never ran?):</b>\n`;
      for (const r of missingLogs) msg += `- ${r.id}\n`;
      msg += `\n`;
    }
    msg += `Total: ${results.length}, healthy: ${groups.OK.length}, broken: ${misses.length + missingLogs.length}`;
    await tg(msg);
    console.log("[watchdog] alert sent to Telegram");

    // Save state for dedup
    try {
      writeFileSync(ALERT_STATE_PATH, JSON.stringify({ alertedAt: new Date().toISOString(), issues: currentIssues }, null, 2));
    } catch (e) {
      console.error("[watchdog] failed to save alert state:", e.message);
    }
  }
}

// ─── Enforcer gate idempotency check ─────────────────────────────────────────
// Reads project-executor.mjs and verifies the sales-bot entry exists in
// BOT_REGISTRY. If already correct, logs SKIP and does nothing. If missing or
// malformed, logs NEEDS_REPAIR so the caller knows repair is required.
// Running this 100 times will never overwrite a valid gate.
(function checkEnforcerGate() {
  const GATE_LOG = resolve(PROJECT_ROOT, ".data/enforcer-gate-skip.log");
  const EXECUTOR_PATH = resolve(PROJECT_ROOT, "scripts/factory/project-executor.mjs");
  const DB_PATH = resolve(PROJECT_ROOT, ".data/linkedin-brand-os.sqlite");
  const ts = new Date().toISOString();

  function gateLog(line) {
    try { appendFileSync(GATE_LOG, `[${ts}] ${line}\n`); } catch {}
    console.log(`[watchdog/enforcer-gate] ${line}`);
  }

  function logGateSkip(detail) {
    try {
      const db = new Database(DB_PATH);
      db.prepare(
        `INSERT INTO bot_events (id, from_bot, event_type, payload_json, processed, created_at) VALUES (?, ?, ?, ?, 0, ?)`
      ).run(
        randomUUID(),
        'cron-watchdog',
        'gate_guard',
        JSON.stringify({ message: 'GATE GUARD: skipped overwrite, gate already present', detail }),
        ts
      );
      db.close();
    } catch (e) {
      console.error(`[watchdog/enforcer-gate] DB log failed: ${e.message}`);
    }
  }

  if (!existsSync(EXECUTOR_PATH)) {
    gateLog(`NEEDS_REPAIR: project-executor.mjs not found at ${EXECUTOR_PATH}`);
    return;
  }

  let src;
  try { src = readFileSync(EXECUTOR_PATH, "utf-8"); } catch (e) {
    gateLog(`NEEDS_REPAIR: could not read project-executor.mjs: ${e.message}`);
    return;
  }

  if (src.includes('ENFORCER_GATE')) {
    gateLog('SKIP: enforcer gate already present (ENFORCER_GATE sentinel found) — skipping regeneration');
    logGateSkip('ENFORCER_GATE sentinel found');
    return;
  }

  // Required gate keys: sales entry with correct script path in BOT_REGISTRY
  const hasSalesKey = /sales\s*:\s*\{/.test(src);
  const hasSalesScript = src.includes("scripts/factory/sales-bot.mjs");

  if (hasSalesKey && hasSalesScript) {
    gateLog("SKIP: enforcer gate valid - sales-bot config present in BOT_REGISTRY, no overwrite needed");
    logGateSkip('sales-bot config present in BOT_REGISTRY');
    return;
  }

  if (!hasSalesKey) gateLog("NEEDS_REPAIR: missing 'sales:' key in BOT_REGISTRY");
  if (!hasSalesScript) gateLog("NEEDS_REPAIR: missing scripts/factory/sales-bot.mjs reference");
})();
