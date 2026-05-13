/**
 * SYSTEM DOCTOR v2 - Knows EVERYTHING, Controls EVERYTHING
 *
 * Like a doctor who knows every organ of the patient:
 * - Knows every bot, its schedule, what it does, when it last ran
 * - Checks health every 15 minutes
 * - Fixes problems AUTONOMOUSLY (restarts, cron fixes, path fixes)
 * - Only alerts Kirill for things it CAN'T fix itself
 *
 * Run: node scripts/cortex/system-doctor-v2.mjs
 * Integrated into: cortex-daemon cycle
 */

import { readFileSync, existsSync, statSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const STATE_PATH = resolve(ROOT, ".data/doctor-v2-state.json");

// ═══════════════════════════════════════════════════════════════════════
// THE PATIENT: Complete knowledge of every bot in the system
// ═══════════════════════════════════════════════════════════════════════

const SYSTEM_MAP = {
  // ── DAEMONS (must be running 24/7) ──────────────────────────────────
  daemons: [
    {
      name: "cortex-daemon",
      pidFile: ".data/cortex-daemon.pid",
      logFile: "/tmp/lbo-cortex-daemon-new.log",
      script: "scripts/cortex/cortex-daemon.mjs",
      purpose: "Main brain - perceive/think/act cycle every 30s. Runs feedback-extractor, hunger-engine.",
      maxSilenceMin: 5,
      canRestart: false, // don't restart self
    },
    {
      name: "orchestrator-daemon",
      pidFile: ".data/orchestrator-daemon.pid",
      logFile: "/tmp/lbo-orchestrator-daemon.log",
      script: "scripts/factory/orchestrator-daemon.mjs",
      purpose: "Runs orchestrator-loop every 30 min. Core execution engine.",
      maxSilenceMin: 35,
      canRestart: true,
    },
    {
      name: "sonnet-bots-daemon",
      pidFile: ".data/sonnet-bots-daemon.pid",
      logFile: "/tmp/lbo-sonnet-bots-daemon.log",
      script: "scripts/factory/sonnet-bots-daemon.mjs",
      purpose: "Runs research-bot-v2, lead-enrichment-bot, content-curator, site-curator on schedule.",
      maxSilenceMin: 65,
      canRestart: true,
    },
    {
      name: "telegram-control",
      pidFile: ".data/telegram-control.pid",
      logFile: "/tmp/lbo-telegram-control.log",
      script: "scripts/factory/telegram-control.mjs",
      purpose: "Kirill's Telegram interface. Text/voice/photo messages + button callbacks.",
      maxSilenceMin: 5,
      canRestart: true,
    },
  ],

  // ── CRON BOTS (run on schedule) ─────────────────────────────────────
  cronBots: [
    // All cron-scheduled bots have been migrated to sonnet-bots-daemon since cron is
    // broken on this machine (no Keychain access, plus user has not installed crontab).
    // - threads-bot moved Apr 27 2026
    // - monitor-replies moved Apr 27 2026
    // - daily-heartbeat moved Apr 27 2026
    // - buying-signal-hunt moved May 5 2026
    // - hn-show-hn-scout moved May 5 2026
    // cron-watchdog removed May 5 2026 (obsolete - nothing left in cron to watch)
  ],

  // ── SONNET DAEMON BOTS (run from sonnet-bots-daemon) ────────────────
  sonnetBots: [
    {
      name: "research-bot-v2",
      schedule: "every 60 min at :15",
      logFile: "/tmp/lbo-research-bot-v2.log",
      purpose: "Deep lead investigation with tool chaining.",
      maxSilenceMin: 65,
    },
    {
      name: "lead-enrichment-bot",
      schedule: "every 60 min at :30",
      logFile: "/tmp/lbo-lead-enrichment-bot.log",
      purpose: "Classify leads: ready_buyer, warming, peer, lurker, not_fit. Only score 60+.",
      maxSilenceMin: 65,
    },
    {
      name: "content-curator-bot",
      schedule: "daily at 21:00",
      logFile: "/tmp/lbo-content-curator-bot.log",
      purpose: "Draft insights post from system data.",
      maxSilenceMin: 1450,
    },
    {
      name: "monitor-replies",
      schedule: "every 2h at :05",
      logFile: "/tmp/lbo-monitor-replies.log",
      purpose: "Check for new email replies via IMAP.",
      maxSilenceMin: 150,
    },
    {
      name: "daily-heartbeat",
      schedule: "2x/day at 08:00/20:00 UTC",
      logFile: "/tmp/lbo-daily-heartbeat.log",
      purpose: "Daily achievement report to Kirill.",
      maxSilenceMin: 1450,
    },
    {
      name: "buying-signal-hunt",
      schedule: "every 3h at :00",
      logFile: "/tmp/lbo-buying-signal-hunt.log",
      purpose: "Walk Reddit comment threads for buying intent signals.",
      maxSilenceMin: 200,
    },
    {
      name: "hn-show-hn-scout",
      schedule: "every 4h at :20",
      logFile: "/tmp/lbo-hn-show-hn-scout.log",
      purpose: "Find low-upvote Show HN posts (MVP-stage founders).",
      maxSilenceMin: 260,
    },
  ],

  // ── ORCHESTRATOR LOOP BOTS (called by orchestrator-loop) ────────────
  orchBots: [
    {
      name: "icp-outreach-bot",
      trigger: "SEND branch",
      logFile: "/tmp/lbo-icp-outreach-bot.log",
      purpose: "Draft personalized outreach for enriched warming/ready_buyer leads.",
    },
    {
      name: "sales-bot",
      trigger: "orchestrator task",
      logFile: "/tmp/lbo-sales-bot.log",
      purpose: "Pipeline management - qualification, proposals, follow-ups.",
    },
    {
      name: "idea-bot",
      trigger: "3x daily (7AM, 1PM, 7PM)",
      logFile: "/tmp/lbo-idea-bot.log",
      purpose: "Synthesize signals from all bots into actionable business ideas.",
    },
    {
      name: "community-bot",
      trigger: "every 4 hours",
      logFile: "/tmp/lbo-community-bot.log",
      purpose: "Answer n8n forum questions. Max 5 per run. Builds reputation.",
    },
    {
      name: "awareness-bot",
      trigger: "daily at 3 AM",
      logFile: "/tmp/lbo-awareness-bot.log",
      purpose: "Scan 384+ sources for actionable AI/business/economy news.",
    },
    {
      name: "evolution-bot",
      trigger: "daily at 3 AM",
      logFile: "/tmp/lbo-evolution-bot.log",
      purpose: "Evolve bot strategies based on KPIs and Kirill directives.",
    },
  ],

  // ── CORTEX MODULES (inside cortex-daemon) ──────────────────────────
  cortexModules: [
    { name: "feedback-extractor", purpose: "Extract directives from Kirill's messages. Runs every cycle.", stateFile: ".data/cortex-feedback-state.json" },
    { name: "hunger-engine", purpose: "Find new channels, tech, market opportunities. Every 6 hours.", stateFile: ".data/cortex-hunger-state.json" },
    { name: "causal-reasoning", purpose: "Build cause-effect chains for business opportunities.", stateFile: ".data/reasoning-chains" },
    { name: "self-evolution", purpose: "Scan own code for improvements, fix via HANDS.", stateFile: null },
    { name: "emotions", purpose: "Functional emotional state modulating decisions.", stateFile: ".data/cortex-emotions.json" },
    { name: "dreams", purpose: "Memory consolidation during idle time.", stateFile: ".data/cortex-dreams.json" },
    { name: "identity", purpose: "Immutable core values and self-model.", stateFile: ".data/cortex-identity.json" },
  ],
};

// ═══════════════════════════════════════════════════════════════════════
// DIAGNOSIS ENGINE
// ═══════════════════════════════════════════════════════════════════════

function loadState() {
  try { return JSON.parse(readFileSync(STATE_PATH, "utf-8")); }
  catch { return { lastRunAt: null, fixes: [], alerts: [] }; }
}

function saveState(state) {
  state.lastRunAt = new Date().toISOString();
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function getLogAge(logFile) {
  try {
    if (!existsSync(logFile)) return Infinity;
    return (Date.now() - statSync(logFile).mtimeMs) / 60000;
  } catch { return Infinity; }
}

function isProcessAlive(pidFile) {
  try {
    const pid = parseInt(readFileSync(resolve(ROOT, pidFile), "utf-8").trim());
    process.kill(pid, 0);
    return { alive: true, pid };
  } catch {
    return { alive: false, pid: null };
  }
}

function isCronInstalled(script) {
  try {
    const cron = execSync("crontab -l 2>/dev/null", { encoding: "utf-8" });
    return cron.includes(script.replace("scripts/", ""));
  } catch { return false; }
}

// ═══════════════════════════════════════════════════════════════════════
// EXAMINATION - Check everything
// ═══════════════════════════════════════════════════════════════════════

export function examine(log = console.log) {
  log("[DOCTOR] === FULL EXAMINATION ===");
  const issues = [];
  const fixes = [];

  // 1. Check all daemons
  for (const d of SYSTEM_MAP.daemons) {
    const proc = isProcessAlive(d.pidFile);
    const logAge = getLogAge(d.logFile);

    if (!proc.alive) {
      issues.push({ severity: "CRITICAL", bot: d.name, issue: "NOT RUNNING", canFix: d.canRestart });
      if (d.canRestart) {
        log(`[DOCTOR] CRITICAL: ${d.name} is DEAD. Restarting...`);
        try {
          execSync(`nohup $HOME/.nvm/versions/node/v22.22.2/bin/node ${resolve(ROOT, d.script)} > ${d.logFile} 2>&1 &`, {
            cwd: ROOT, timeout: 5000
          });
          fixes.push(`Restarted ${d.name}`);
          log(`[DOCTOR] FIXED: ${d.name} restarted`);
        } catch (e) {
          log(`[DOCTOR] FAILED to restart ${d.name}: ${e.message}`);
        }
      }
    } else if (logAge > d.maxSilenceMin) {
      issues.push({ severity: "WARNING", bot: d.name, issue: `Silent for ${Math.round(logAge)} min (max ${d.maxSilenceMin})` });
    } else {
      log(`[DOCTOR] ${d.name}: OK (PID ${proc.pid}, log ${Math.round(logAge)}m ago)`);
    }
  }

  // 2. Check all cron bots
  for (const b of SYSTEM_MAP.cronBots) {
    const logAge = getLogAge(b.logFile);
    const inCron = isCronInstalled(b.script);

    if (!inCron) {
      issues.push({ severity: "CRITICAL", bot: b.name, issue: "NOT IN CRON" });
      log(`[DOCTOR] CRITICAL: ${b.name} not in crontab!`);
    } else if (logAge > b.maxSilenceMin) {
      issues.push({ severity: "WARNING", bot: b.name, issue: `Last ran ${Math.round(logAge)} min ago (max ${b.maxSilenceMin})` });
    } else {
      log(`[DOCTOR] ${b.name}: OK (${Math.round(logAge)}m ago)`);
    }
  }

  // 3. Check sonnet daemon bots
  for (const b of SYSTEM_MAP.sonnetBots) {
    const logAge = getLogAge(b.logFile);
    if (logAge > b.maxSilenceMin) {
      issues.push({ severity: "WARNING", bot: b.name, issue: `Last ran ${Math.round(logAge)} min ago` });
    } else {
      log(`[DOCTOR] ${b.name}: OK (${Math.round(logAge)}m ago)`);
    }
  }

  // 4. Check cortex modules
  for (const m of SYSTEM_MAP.cortexModules) {
    if (m.stateFile) {
      const path = resolve(ROOT, m.stateFile);
      if (existsSync(path)) {
        const age = getLogAge(path);
        log(`[DOCTOR] ${m.name}: state ${Math.round(age)}m old`);
      } else {
        issues.push({ severity: "INFO", bot: m.name, issue: "No state file yet" });
      }
    }
  }

  // 5. Check for common errors in recent logs
  for (const b of [...SYSTEM_MAP.cronBots, ...SYSTEM_MAP.sonnetBots]) {
    try {
      const tail = execSync(`tail -5 ${b.logFile} 2>/dev/null`, { encoding: "utf-8" });
      if (tail.includes("MODULE_NOT_FOUND") || tail.includes("Cannot find module")) {
        issues.push({ severity: "CRITICAL", bot: b.name, issue: "MODULE_NOT_FOUND - path error in cron" });
      }
      if (tail.includes("insufficient_quota")) {
        issues.push({ severity: "WARNING", bot: b.name, issue: "API quota exceeded (should use Claude CLI)" });
      }
    } catch {}
  }

  // Summary
  const critical = issues.filter(i => i.severity === "CRITICAL");
  const warnings = issues.filter(i => i.severity === "WARNING");
  log(`[DOCTOR] === EXAM COMPLETE: ${critical.length} critical, ${warnings.length} warnings, ${fixes.length} auto-fixes ===`);

  return { issues, fixes, critical: critical.length, warnings: warnings.length };
}

// ═══════════════════════════════════════════════════════════════════════
// TELEGRAM ALERT - Only for things doctor CAN'T fix
// ═══════════════════════════════════════════════════════════════════════

export async function alertIfNeeded(result) {
  const unfixed = result.issues.filter(i => i.severity === "CRITICAL" && !i.canFix);
  if (unfixed.length === 0 && result.fixes.length === 0) return;

  const env = Object.fromEntries(
    readFileSync(resolve(ROOT, "apps/api/.env"), "utf-8").split("\n")
      .filter(l => l && !l.startsWith("#") && l.includes("="))
      .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
  );

  const lines = [];
  if (result.fixes.length > 0) {
    lines.push(`Doctor auto-fixed: ${result.fixes.join(", ")}`);
  }
  if (unfixed.length > 0) {
    lines.push(`Needs attention:`);
    unfixed.forEach(i => lines.push(`- ${i.bot}: ${i.issue}`));
  }

  if (lines.length > 0) {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: lines.join("\n").slice(0, 4000) }),
    }).catch(() => {});
  }
}

// ═══════════════════════════════════════════════════════════════════════
// RUN
// ═══════════════════════════════════════════════════════════════════════

export async function runDoctor(log = console.log) {
  const result = examine(log);
  await alertIfNeeded(result);
  const state = loadState();
  state.fixes.push(...result.fixes.map(f => ({ fix: f, at: new Date().toISOString() })));
  if (state.fixes.length > 50) state.fixes = state.fixes.slice(-50);
  saveState(state);
  return result;
}

// CLI entry
if (process.argv[1]?.includes("system-doctor-v2")) {
  runDoctor().then(r => {
    console.log(`\nDone: ${r.critical} critical, ${r.warnings} warnings, ${r.fixes.length} fixes`);
  });
}
