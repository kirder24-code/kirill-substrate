/**
 * orchestrator-daemon.mjs - Long-running scheduler for orchestrator-loop
 *
 * REASON FOR EXISTENCE: macOS cron daemon cannot access Keychain (no GUI
 * session), so cron-launched claude CLI fails with "Not logged in".
 *
 * This daemon must be launched from a USER SHELL SESSION (GUI active)
 * to inherit Keychain access. Once launched, it stays alive and triggers
 * orchestrator-loop.mjs every 30 minutes. Each subprocess inherits the
 * daemon's Keychain context, so claude CLI auth works.
 *
 * Trade-off: dies on reboot. Must be relaunched manually after restart
 * (or via launchd plist - tomorrow's work).
 *
 * Launch:
 *   nohup node scripts/factory/orchestrator-daemon.mjs > /tmp/lbo-orchestrator-daemon.log 2>&1 &
 *
 * Stop:
 *   kill $(cat .data/orchestrator-daemon.pid)
 */

import { enforceOAuthBilling } from "../lib/billing-guard.mjs";
enforceOAuthBilling();
import { existsSync, writeFileSync, unlinkSync, readFileSync, appendFileSync, mkdirSync } from "fs";
import { spawn, spawnSync } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = resolve(__dirname, "../..");
const PID_FILE = resolve(PROJECT_DIR, ".data/orchestrator-daemon.pid");
const DAEMON_LOG = "/tmp/lbo-orchestrator-daemon.log";
const LOOP_SCRIPT = resolve(PROJECT_DIR, "scripts/factory/orchestrator-loop.mjs");
const REVENUE_GATE_SCRIPT = resolve(PROJECT_DIR, "scripts/outreach/revenue-gate.mjs");
const REVENUE_GATE_STATUS = resolve(PROJECT_DIR, ".data/revenue-gate-status.json");
const NODE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/node";
const INTERVAL_MS = 30 * 60 * 1000;

if (!existsSync(dirname(PID_FILE))) mkdirSync(dirname(PID_FILE), { recursive: true });

if (existsSync(PID_FILE)) {
  const oldPid = parseInt(readFileSync(PID_FILE, "utf-8").trim());
  let alive = false;
  try { process.kill(oldPid, 0); alive = true; } catch {}
  if (alive) {
    console.error(`[daemon] already running PID ${oldPid}, exit`);
    process.exit(1);
  } else {
    console.log(`[daemon] stale PID file (${oldPid} dead), clearing`);
    unlinkSync(PID_FILE);
  }
}

writeFileSync(PID_FILE, String(process.pid));
function cleanup() {
  try { if (existsSync(PID_FILE)) unlinkSync(PID_FILE); } catch {}
}
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(0); });
process.on("SIGTERM", () => { cleanup(); process.exit(0); });

function log(msg) {
  const line = `${new Date().toISOString()} ${msg}\n`;
  process.stdout.write(line);
  try { appendFileSync(DAEMON_LOG, line); } catch {}
}

log(`[daemon] started PID ${process.pid}, interval ${INTERVAL_MS / 1000}s`);

function passRevenueGate() {
  const result = spawnSync(NODE_BIN, [
    REVENUE_GATE_SCRIPT,
    "--log-path",
    resolve(PROJECT_DIR, ".data/outreach-log.json"),
  ], {
    cwd: PROJECT_DIR,
    encoding: "utf-8",
    env: process.env,
  });

  try {
    writeFileSync(REVENUE_GATE_STATUS, result.stdout || result.stderr || "{}");
  } catch {}

  if (result.status === 0) return true;

  const details = (result.stdout || result.stderr || "").trim().slice(0, 500);
  log(`[daemon] revenue gate failed - no approved external outreach outcome in the last 72h`);
  if (details) log(`[daemon] revenue gate details: ${details}`);
  return false;
}

function runCycle() {
  if (!passRevenueGate()) {
    cleanup();
    process.exit(1);
  }

  log(`[daemon] triggering orchestrator-loop cycle`);
  const child = spawn(NODE_BIN, [LOOP_SCRIPT], {
    cwd: PROJECT_DIR,
    env: process.env,
    detached: false,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "", stderr = "";
  child.stdout.on("data", d => { stdout += d.toString(); });
  child.stderr.on("data", d => { stderr += d.toString(); });

  child.on("close", code => {
    log(`[daemon] cycle exit=${code}`);
    if (stdout.trim()) log(`[daemon] stdout: ${stdout.trim().slice(0, 300)}`);
    if (stderr.trim()) log(`[daemon] stderr: ${stderr.trim().slice(0, 300)}`);
  });
  child.on("error", err => {
    log(`[daemon] spawn error: ${err.message}`);
  });
}

runCycle();
setInterval(runCycle, INTERVAL_MS);

// Reply-to-booking: follow up on replied emails that have not booked, every 6h
const REPLY_BOOKING_SCRIPT = resolve(PROJECT_DIR, "scripts/factory/reply-to-booking-bot.mjs");
const REPLY_BOOKING_INTERVAL_MS = 6 * 60 * 60 * 1000;

function runReplyToBooking() {
  log(`[daemon] triggering reply-to-booking-bot`);
  const child = spawn(NODE_BIN, [REPLY_BOOKING_SCRIPT], {
    cwd: PROJECT_DIR,
    env: process.env,
    detached: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "", stderr = "";
  child.stdout.on("data", d => { stdout += d.toString(); });
  child.stderr.on("data", d => { stderr += d.toString(); });
  child.on("close", code => {
    log(`[daemon] reply-to-booking exit=${code}`);
    if (stdout.trim()) log(`[daemon] reply-to-booking stdout: ${stdout.trim().slice(0, 500)}`);
    if (stderr.trim()) log(`[daemon] reply-to-booking stderr: ${stderr.trim().slice(0, 300)}`);
  });
  child.on("error", err => log(`[daemon] reply-to-booking spawn error: ${err.message}`));
}

runReplyToBooking();
setInterval(runReplyToBooking, REPLY_BOOKING_INTERVAL_MS);

// Warm-reply cards: send Telegram card per warm reply, every 6h
const WARM_REPLY_CARDS_SCRIPT = resolve(PROJECT_DIR, "scripts/factory/warm-reply-cards.mjs");
const WARM_REPLY_CARDS_INTERVAL_MS = 6 * 60 * 60 * 1000;

function runWarmReplyCards() {
  log(`[daemon] triggering warm-reply-cards`);
  const child = spawn(NODE_BIN, [WARM_REPLY_CARDS_SCRIPT], {
    cwd: PROJECT_DIR,
    env: process.env,
    detached: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "", stderr = "";
  child.stdout.on("data", d => { stdout += d.toString(); });
  child.stderr.on("data", d => { stderr += d.toString(); });
  child.on("close", code => {
    log(`[daemon] warm-reply-cards exit=${code}`);
    if (stdout.trim()) log(`[daemon] warm-reply-cards stdout: ${stdout.trim().slice(0, 500)}`);
    if (stderr.trim()) log(`[daemon] warm-reply-cards stderr: ${stderr.trim().slice(0, 300)}`);
  });
  child.on("error", err => log(`[daemon] warm-reply-cards spawn error: ${err.message}`));
}

runWarmReplyCards();
setInterval(runWarmReplyCards, WARM_REPLY_CARDS_INTERVAL_MS);

setInterval(() => {
  log(`[daemon] heartbeat - alive, ${Math.round(process.uptime() / 60)}min uptime`);
}, 5 * 60 * 1000);
