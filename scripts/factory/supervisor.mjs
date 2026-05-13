/**
 * SUPERVISOR — Process Manager with Circuit Breaker
 *
 * Запускает всех ботов как постоянные процессы.
 * Следит за здоровьем, перезапускает при падении.
 *
 * CIRCUIT BREAKER: если бот рестартится >= 5 раз за 30 мин →
 * ставит на паузу, уведомляет Кирилла, не рестартит до cooldown (1 час).
 */

import { spawn } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { writeFileSync, readFileSync, appendFileSync, existsSync, mkdirSync, statSync, renameSync, unlinkSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = resolve(__dirname, "../../.logs");
const PID_FILE = resolve(__dirname, "../../.data/supervisor.pid");
const TRIPPED_FILE = resolve(__dirname, "../../.data/supervisor-tripped.json");

// ── LOG ROTATION CONFIG ──────────────────────────────────────────────────────
const LOG_MAX_BYTES = 5 * 1024 * 1024;  // 5 MB per log file
const LOG_KEEP_ROTATED = 1;              // keep .log.1 only (delete .log.2+)

// ── CIRCUIT BREAKER CONFIG ───────────────────────────────────────────────────
const CB_MAX_RESTARTS = 5;         // max restarts before trip
const CB_WINDOW_MS = 30 * 60000;  // 30 minute rolling window
const CB_COOLDOWN_MS = 60 * 60000; // 1 hour cooldown after trip

// ── TELEGRAM (lightweight, no orchestrator dependency) ───────────────────────
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT = process.env.TELEGRAM_CHAT_ID;

async function notifyKirill(text) {
  if (!TG_TOKEN || !TG_CHAT) {
    console.warn(`[Supervisor] ⚠️ TG_TOKEN/CHAT not set — cannot send alert. Message: ${text.replace(/<[^>]*>/g, "").slice(0, 200)}`);
    return;
  }
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TG_CHAT, text, parse_mode: "HTML" }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    console.error(`[Supervisor] TG notify failed: ${err.message}`);
  }
}

// ── BOT LIST ─────────────────────────────────────────────────────────────────
const BOTS = [
  // DISABLED: test-bot, market-bot, competitor-agent, builder-bot, ph-bot
  // { name: "test-bot", script: "test-bot.mjs", restartDelay: 5000 },
  // { name: "market-bot", script: "market-bot.mjs", restartDelay: 5000 },
  // { name: "competitor-agent", script: "competitor-agent.mjs", restartDelay: 5000 },
  // { name: "builder-bot", script: "builder-bot.mjs", args: ["live"], restartDelay: 5000 },
  // { name: "ph-bot", script: "ph-bot.mjs", args: ["live"], restartDelay: 5000 }, // Philippines not in focus, spams bot_messages
  { name: "content-bot", script: "content-bot.mjs", args: ["live"], restartDelay: 5000 },
  { name: "scout-bot", script: "scout-bot.mjs", args: ["live"], restartDelay: 5000 },
  { name: "evolution-bot", script: "evolution-bot.mjs", args: ["live"], restartDelay: 10000 },
  { name: "trend-bot", script: "trend-bot.mjs", args: ["live"], restartDelay: 5000 },
  { name: "community-bot", script: "community-bot.mjs", args: ["live"], restartDelay: 5000 },
  { name: "idea-bot", script: "idea-bot.mjs", args: ["live"], restartDelay: 5000 },
  { name: "research-bot", script: "research-bot.mjs", args: ["live"], restartDelay: 5000 },
  { name: "linkedin-hunter", script: "linkedin-hunter.mjs", args: ["live"], restartDelay: 5000 },
  // DISABLED April 7 2026 - this daemon has a no-ICP-filter code path on ready_email status
  // rows and was sending to non-ICP categories (concrete-contractors, tree-service, etc) for 60+
  // hours. send-outreach.mjs via cron 9 AM Mon-Fri is the canonical sender with proper ICP filter.
  // Do not re-enable without first adding ICP filter to the readyEmails SQL query.
  // { name: "outreach-bot", script: "outreach-bot.mjs", args: ["live"], restartDelay: 5000 },
  { name: "sales-bot", script: "sales-bot.mjs", args: ["live"], restartDelay: 5000 },
  { name: "pr-bot", script: "pr-bot.mjs", args: ["live"], restartDelay: 5000 },
  { name: "analytics-bot", script: "analytics-bot.mjs", args: ["live"], restartDelay: 5000 },
  { name: "brief-agent", script: "brief-agent.mjs", args: ["live"], restartDelay: 5000 },
  { name: "learn-bot", script: "learn-bot.mjs", args: ["live"], restartDelay: 5000 },
  { name: "reddit-monitor", script: "reddit-monitor.mjs", args: ["live"], restartDelay: 5000 },
  { name: "build-bot", script: "build-bot.mjs", args: ["live"], restartDelay: 5000 },
  { name: "service-bot", script: "service-bot.mjs", args: ["live"], restartDelay: 5000 },
  { name: "telegram-control", script: "telegram-control.mjs", restartDelay: 10000 },
  { name: "telegram-sales-agent", script: "telegram-sales-agent.mjs", args: ["live"], restartDelay: 30000 },
  { name: "healthcheck", script: "healthcheck.mjs", args: ["live"], restartDelay: 60000 },
];

const processes = new Map();
let isShuttingDown = false;

// ── CIRCUIT BREAKER STATE ────────────────────────────────────────────────────
// restartHistory: Map<botName, number[]>  — timestamps of recent restarts
// trippedBots:    Map<botName, { trippedAt, restarts, lastError, notified }>
const restartHistory = new Map();
const trippedBots = new Map();

function loadTrippedState() {
  try {
    if (existsSync(TRIPPED_FILE)) {
      const data = JSON.parse(readFileSync(TRIPPED_FILE, "utf8"));
      for (const [name, state] of Object.entries(data)) {
        trippedBots.set(name, state);
      }
      console.log(`[Supervisor] Loaded ${trippedBots.size} tripped bot(s) from disk`);
    }
  } catch {}
}

function saveTrippedState() {
  try {
    const obj = {};
    for (const [name, state] of trippedBots) obj[name] = state;
    writeFileSync(TRIPPED_FILE, JSON.stringify(obj, null, 2));
  } catch {}
}

function recordRestart(botName, exitCode, lastError) {
  const now = Date.now();
  const history = restartHistory.get(botName) || [];
  history.push(now);

  // Keep only restarts within the rolling window
  const cutoff = now - CB_WINDOW_MS;
  const recent = history.filter(t => t > cutoff);
  restartHistory.set(botName, recent);

  return recent.length;
}

function isBotTripped(botName) {
  const state = trippedBots.get(botName);
  if (!state) return false;

  // Check if cooldown expired → auto-reset
  const elapsed = Date.now() - state.trippedAt;
  if (elapsed > CB_COOLDOWN_MS) {
    console.log(`[Supervisor] Circuit breaker RESET for ${botName} (cooldown ${Math.round(elapsed / 60000)}m expired)`);
    trippedBots.delete(botName);
    restartHistory.delete(botName);
    saveTrippedState();
    return false;
  }

  return true;
}

async function tripBot(botName, restartCount, lastError) {
  // Try to get structured error from DB (richer than raw stderr)
  let errorMessage = (lastError || "unknown").slice(0, 200);
  try {
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(resolve(__dirname, "../../.data/linkedin-brand-os.sqlite"), { readonly: true });
    const hbId = BOTS.find(b => b.name === botName)?.name || botName;
    const row = db.prepare("SELECT error FROM bot_heartbeats WHERE bot_id = ?").get(hbId);
    if (row?.error) {
      try {
        const parsed = JSON.parse(row.error);
        errorMessage = parsed.code ? `[${parsed.code}] ${parsed.message}` : parsed.message;
      } catch { errorMessage = row.error; }
    }
    db.close();
  } catch {} // DB read is best-effort, fall back to stderr

  const state = {
    trippedAt: Date.now(),
    restarts: restartCount,
    lastError: errorMessage.slice(0, 200),
    notified: false,
  };
  trippedBots.set(botName, state);
  saveTrippedState();

  // Structured reliability log
  console.error(JSON.stringify({ _r: 1, level: "error", botId: botName, code: "circuit_breaker", message: `Tripped: ${restartCount} restarts in ${CB_WINDOW_MS / 60000}m — ${errorMessage.slice(0, 100)}`, at: new Date().toISOString() }));
  console.log(`[Supervisor] ⚡ CIRCUIT BREAKER TRIPPED: ${botName} (${restartCount} restarts in ${CB_WINDOW_MS / 60000}m)`);

  // Send ONE notification
  const cooldownMin = Math.round(CB_COOLDOWN_MS / 60000);
  await notifyKirill(
    `⚡ <b>Circuit Breaker: ${botName}</b>\n\n` +
    `Бот перезапускался ${restartCount} раз за ${CB_WINDOW_MS / 60000} мин.\n` +
    `<b>Последняя ошибка:</b> ${state.lastError}\n\n` +
    `🛑 Бот поставлен на паузу (${cooldownMin} мин cooldown).\n` +
    `<i>Авторестарт через ${cooldownMin} мин, или перезапустите supervisor вручную.</i>`
  );
  state.notified = true;
  saveTrippedState();
}

// ── SETUP ────────────────────────────────────────────────────────────────────

function setup() {
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
  writeFileSync(PID_FILE, process.pid.toString());
  loadTrippedState();

  console.log(`[Supervisor] Starting... PID: ${process.pid}`);
  console.log(`[Supervisor] Logs: ${LOG_DIR}`);
  console.log(`[Supervisor] Managing ${BOTS.length} bots`);
  console.log(`[Supervisor] Circuit breaker: ${CB_MAX_RESTARTS} restarts / ${CB_WINDOW_MS / 60000}m → pause ${CB_COOLDOWN_MS / 60000}m\n`);
}

// ── LOG ROTATION ─────────────────────────────────────────────────────────────

/**
 * Rotate a log file if it exceeds LOG_MAX_BYTES.
 * Simple: current.log → current.log.1 (delete old .log.1 first)
 * Safe: uses rename (atomic on same filesystem), no data loss.
 */
function rotateLogIfNeeded(logPath) {
  try {
    if (!existsSync(logPath)) return false;
    const stat = statSync(logPath);
    if (stat.size < LOG_MAX_BYTES) return false;

    const rotated = logPath + ".1";
    // Delete old rotated file if exists
    try { if (existsSync(rotated)) unlinkSync(rotated); } catch {}
    // Rename current → .1
    renameSync(logPath, rotated);
    // Create fresh empty file so appendFileSync works immediately
    writeFileSync(logPath, `[${new Date().toISOString()}] [log-rotation] Rotated (previous file: ${rotated}, was ${(stat.size / 1024 / 1024).toFixed(1)}MB)\n`);

    console.log(`[Supervisor] Rotated ${logPath} (${(stat.size / 1024 / 1024).toFixed(1)}MB)`);
    return true;
  } catch (err) {
    console.error(`[Supervisor] Log rotation failed for ${logPath}: ${err.message}`);
    return false;
  }
}

/**
 * Check and rotate all bot logs + supervisor.log
 */
function rotateAllLogs() {
  let rotated = 0;

  // Rotate per-bot logs
  for (const bot of BOTS) {
    const logPath = resolve(LOG_DIR, `${bot.name}.log`);
    if (rotateLogIfNeeded(logPath)) rotated++;
  }

  // Rotate supervisor.log (written by shell redirect)
  const supervisorLog = resolve(LOG_DIR, "supervisor.log");
  if (rotateLogIfNeeded(supervisorLog)) rotated++;

  // Rotate orchestrator logs
  for (const name of ["orchestrator-loop.log", "orchestrator-decisions.log", "orchestrator-daemon.log"]) {
    const logPath = resolve(LOG_DIR, name);
    if (rotateLogIfNeeded(logPath)) rotated++;
  }

  if (rotated > 0) {
    console.log(`[Supervisor] Rotated ${rotated} log file(s)`);
  }
}

// ── BOT MANAGEMENT ───────────────────────────────────────────────────────────

// Track last stderr line per bot for error reporting
const lastStderr = new Map();

function startBot(bot) {
  if (isBotTripped(bot.name)) {
    return; // Circuit breaker active — don't start
  }

  const scriptPath = resolve(__dirname, bot.script);
  const logPath = resolve(LOG_DIR, `${bot.name}.log`);

  console.log(`[Supervisor] Starting ${bot.name}...`);

  const args = [scriptPath, ...(bot.args || [])];
  const child = spawn("node", args, {
    cwd: resolve(__dirname, "../.."),
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
    env: { ...process.env }
  });

  child.stdout.on("data", (data) => {
    const line = `[${new Date().toISOString()}] ${data.toString()}`;
    appendFileSync(logPath, line);
    process.stdout.write(`[${bot.name}] ${data.toString()}`);
  });

  child.stderr.on("data", (data) => {
    const line = `[${new Date().toISOString()}] ERROR: ${data.toString()}`;
    appendFileSync(logPath, line);
    process.stderr.write(`[${bot.name}] ERROR: ${data.toString()}`);
    // Remember last error for circuit breaker reporting
    const errText = data.toString().trim();
    if (errText) lastStderr.set(bot.name, errText.slice(-300));
  });

  child.on("exit", (code, signal) => {
    console.log(`[Supervisor] ${bot.name} exited with code ${code}, signal ${signal}`);
    processes.delete(bot.name);

    if (isShuttingDown) return;

    // Record restart and check circuit breaker
    const errMsg = lastStderr.get(bot.name) || `exit code ${code}`;
    const recentCount = recordRestart(bot.name, code, errMsg);

    if (recentCount >= CB_MAX_RESTARTS) {
      // TRIP — too many restarts
      tripBot(bot.name, recentCount, errMsg);
      return;
    }

    // Normal restart
    console.log(`[Supervisor] Restarting ${bot.name} in ${bot.restartDelay}ms... (${recentCount}/${CB_MAX_RESTARTS} in window)`);
    setTimeout(() => {
      if (!isShuttingDown && !isBotTripped(bot.name)) {
        startBot(bot);
      }
    }, bot.restartDelay);
  });

  child.on("error", (err) => {
    console.error(`[Supervisor] Failed to start ${bot.name}:`, err.message);
    lastStderr.set(bot.name, err.message);
  });

  processes.set(bot.name, { child, bot, startedAt: new Date() });
}

function stopBot(botName) {
  const proc = processes.get(botName);
  if (!proc) return;

  console.log(`[Supervisor] Stopping ${botName}...`);
  proc.child.kill("SIGTERM");

  setTimeout(() => {
    if (processes.has(botName)) {
      console.log(`[Supervisor] Force killing ${botName}...`);
      proc.child.kill("SIGKILL");
    }
  }, 10000);
}

function stopAllBots() {
  console.log(`[Supervisor] Stopping all bots...`);
  isShuttingDown = true;
  for (const [name] of processes) stopBot(name);
}

// ── HEALTH MONITORING ────────────────────────────────────────────────────────

function checkHealth() {
  for (const bot of BOTS) {
    // Skip tripped bots — they'll auto-reset after cooldown
    if (isBotTripped(bot.name)) continue;

    if (!processes.has(bot.name)) {
      console.log(`[Supervisor] ${bot.name} is not running, starting...`);
      startBot(bot);
    }
  }

  for (const [name, proc] of processes) {
    if (proc.child.killed) {
      console.log(`[Supervisor] ${name} process is killed, will restart...`);
      processes.delete(name);
    }
  }
}

// ── STATUS REPORT ────────────────────────────────────────────────────────────

function printStatus() {
  console.log(`\n[Supervisor] Status Report (${new Date().toISOString()})`);
  console.log(`─────────────────────────────────────────────────────────`);

  for (const bot of BOTS) {
    const tripped = trippedBots.get(bot.name);
    if (tripped) {
      const elapsed = Math.round((Date.now() - tripped.trippedAt) / 60000);
      const remaining = Math.round((CB_COOLDOWN_MS - (Date.now() - tripped.trippedAt)) / 60000);
      console.log(`⚡ ${bot.name.padEnd(25)} TRIPPED (${elapsed}m ago, reset in ${remaining}m)`);
      continue;
    }

    const proc = processes.get(bot.name);
    if (proc) {
      const uptime = Math.floor((Date.now() - proc.startedAt.getTime()) / 1000);
      const uptimeStr = uptime > 3600
        ? `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`
        : `${Math.floor(uptime / 60)}m ${uptime % 60}s`;
      const restarts = (restartHistory.get(bot.name) || []).length;
      const restartInfo = restarts > 0 ? ` (${restarts} restarts)` : "";
      console.log(`✅ ${bot.name.padEnd(25)} PID: ${proc.child.pid}  Uptime: ${uptimeStr}${restartInfo}`);
    } else {
      console.log(`❌ ${bot.name.padEnd(25)} NOT RUNNING`);
    }
  }

  if (trippedBots.size > 0) {
    console.log(`\n⚡ Circuit breaker active for: ${[...trippedBots.keys()].join(", ")}`);
  }

  console.log(`─────────────────────────────────────────────────────────\n`);
}

// ── GRACEFUL SHUTDOWN ────────────────────────────────────────────────────────

function setupShutdownHandlers() {
  const shutdown = (signal) => {
    console.log(`\n[Supervisor] Received ${signal}, shutting down gracefully...`);
    stopAllBots();
    setTimeout(() => {
      console.log(`[Supervisor] Shutdown complete.`);
      process.exit(0);
    }, 15000);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGHUP", () => shutdown("SIGHUP"));
}

// ── MAIN ─────────────────────────────────────────────────────────────────────

function main() {
  setup();
  setupShutdownHandlers();

  // Rotate oversized logs before starting bots
  rotateAllLogs();

  for (const bot of BOTS) startBot(bot);

  setInterval(() => checkHealth(), 30000);
  setInterval(() => printStatus(), 5 * 60 * 1000);

  // Check log rotation every 30 minutes
  setInterval(() => rotateAllLogs(), 30 * 60 * 1000);
  setTimeout(() => printStatus(), 10000);

  console.log(`[Supervisor] All bots started. Monitoring...\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
