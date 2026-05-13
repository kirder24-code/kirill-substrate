/**
 * sonnet-bots-daemon.mjs
 *
 * Long-running daemon that schedules and runs the 6 Sonnet 4.6 multi-tool bots
 * INTERNALLY, inheriting Keychain access from the user shell session that
 * launches it.
 *
 * Built April 8 2026 to fix the cron auth bug. The 6 Sonnet 4.6 bots that I
 * added April 7 (research-bot-v2, lead-enrichment-bot, content-curator-bot,
 * site-curator-bot, draft-quality-checker, reply-classifier) were running as
 * direct cron entries. Cron context cannot access macOS Keychain, so Claude
 * CLI failed with "Not logged in" every single nighttime run. The
 * orchestrator-daemon.mjs uses the same pattern - it solves the same problem
 * for orchestrator-loop. This daemon does the same for the new Sonnet stack.
 *
 * draft-quality-checker and reply-classifier are NOT scheduled here - they
 * are on-demand only (called inline by dispatch wrapper and monitor-replies).
 *
 * Schedule (partial - see tick() for full list):
 *   - research-bot-v2 --batch       every 60 min at :15
 *   - lead-enrichment-bot --batch   every 60 min at :30
 *   - content-curator-bot           daily at 21:00
 *   - site-curator-bot              weekly Sunday at 20:00
 *   - discovery-engine              daily at 10:00 UTC (4AM Calgary)
 *   - monitor-replies               every 2h at :05
 *
 * Launch from user shell (NOT from cron):
 *   nohup $HOME/.nvm/versions/node/v22.22.2/bin/node \
 *     $CLAUDE_PROJECT_DIR/scripts/factory/sonnet-bots-daemon.mjs \
 *     > /tmp/lbo-sonnet-bots-daemon.log 2>&1 &
 */
import { enforceOAuthBilling } from "../lib/billing-guard.mjs";
enforceOAuthBilling();
import { spawn } from "child_process";
import { appendFileSync } from "fs";
import { resolve, dirname } from "path";

const PROJECT_DIR = "$CLAUDE_PROJECT_DIR";
const NODE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/node";
const LOG_FILE = "/tmp/lbo-sonnet-bots-daemon.log";

function log(msg) {
  const line = `${new Date().toISOString()} [sonnet-daemon] ${msg}\n`;
  process.stdout.write(line);
  try { appendFileSync(LOG_FILE, line); } catch {}
}

// PID file for stale-detection
import { writeFileSync, existsSync, readFileSync, unlinkSync } from "fs";
const PID_FILE = resolve(PROJECT_DIR, ".data/sonnet-bots-daemon.pid");

if (existsSync(PID_FILE)) {
  const oldPid = parseInt(readFileSync(PID_FILE, "utf-8"));
  try {
    process.kill(oldPid, 0);
    log(`another instance already running PID ${oldPid}, exiting`);
    process.exit(1);
  } catch {
    log(`stale PID file (${oldPid} dead), removing`);
    try { unlinkSync(PID_FILE); } catch {}
  }
}
writeFileSync(PID_FILE, String(process.pid));
log(`started PID ${process.pid}`);

process.on("exit", () => { try { unlinkSync(PID_FILE); } catch {} });
process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));

function runBot(name, args = [], scriptPath) {
  const startedAt = new Date().toISOString();
  log(`spawn ${name} ${args.join(" ")}`);
  const botLogFile = `/tmp/lbo-${name}.log`;
  const script = scriptPath || `scripts/factory/${name}.mjs`;
  const child = spawn(NODE_BIN, [script, ...args], {
    cwd: PROJECT_DIR,
    env: { ...process.env, CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "", stderr = "";
  child.stdout.on("data", d => { stdout += d.toString(); });
  child.stderr.on("data", d => { stderr += d.toString(); });
  child.once("close", code => {
    const elapsed = ((Date.now() - new Date(startedAt).getTime()) / 1000).toFixed(0);
    log(`${name} exit=${code} elapsed=${elapsed}s stdout=${stdout.length}b stderr=${stderr.length}b`);
    // Write individual bot log so watchdog can track each bot
    try {
      const logEntry = `${new Date().toISOString()} exit=${code} elapsed=${elapsed}s\n${stdout}${stderr ? "\nSTDERR:\n" + stderr : ""}\n---\n`;
      appendFileSync(botLogFile, logEntry);
    } catch {}
    if (stdout.includes("Not logged in") || stderr.includes("Not logged in")) {
      log(`!!! ${name} got "Not logged in" - daemon may have lost Keychain access`);
    }
  });
  child.once("error", err => log(`${name} spawn error: ${err.message}`));
}

// ─── Scheduler logic ────────────────────────────────────────────────────────
// Check every minute, fire bots whose schedule matches current time.
let lastFired = {}; // key: "bot:slot", value: timestamp - prevents double-fire within same minute

function tick() {
  const now = new Date();
  const min = now.getMinutes();
  const hour = now.getHours();
  const dayOfWeek = now.getDay(); // 0 = Sunday

  // research-bot-v2 --batch every hour at :15
  if (min === 15) {
    const slot = `research:${hour}`;
    if (lastFired[slot] !== now.toDateString()) {
      lastFired[slot] = now.toDateString();
      runBot("research-bot-v2", ["--batch"]);
    }
  }

  // lead-enrichment-bot --batch every hour at :30
  if (min === 30) {
    const slot = `enrich:${hour}`;
    if (lastFired[slot] !== now.toDateString()) {
      lastFired[slot] = now.toDateString();
      runBot("lead-enrichment-bot", ["--batch"]);
    }
  }

  // content-curator-bot daily at 21:00
  if (hour === 21 && min === 0) {
    const slot = `content:${now.toDateString()}`;
    if (!lastFired[slot]) {
      lastFired[slot] = true;
      runBot("content-curator-bot");
    }
  }

  // site-curator-bot weekly Sunday at 20:00
  if (dayOfWeek === 0 && hour === 20 && min === 0) {
    const slot = `site:${now.toDateString()}`;
    if (!lastFired[slot]) {
      lastFired[slot] = true;
      runBot("site-curator-bot");
    }
  }

  // awareness-bot daily at 09:00 (moved from cron Apr 8 2026 - Keychain fix)
  // DUPLICATE WARNING: cron still has "0 9 * * * awareness-bot" entry - run fix-cron-dupes.sh to remove
  // Window 9:00-9:01 protects against setInterval drift (was missing daily slot for 7 days).
  if (hour === 9 && min < 2) {
    const slot = `awareness:${now.toDateString()}`;
    if (!lastFired[slot]) {
      lastFired[slot] = true;
      runBot("awareness-bot");
    }
  }

  // awareness-digest daily at 08:00 UTC (1h before next awareness-bot scan).
  // Sends ONE Telegram card with top 5 unread items + Apply/Later/Skip buttons per row.
  // Added 2026-05-09 to close awareness->action loop (close out unread items before
  // they get buried under fresh ones).
  if (hour === 8 && min < 2) {
    const slot = `aw-digest:${now.toDateString()}`;
    if (!lastFired[slot]) {
      lastFired[slot] = true;
      runBot("awareness-digest");
    }
  }

  // awareness-apply auto-promote daily at 09:30 UTC (30 min after awareness-bot scan).
  // Added 2026-05-09: was never scheduled, so 234 unprocessed items piled up over weeks.
  // The "list" command runs autoPromoteSafeItems() which moves status='new' -> 'apply_now'
  // for safe items (score >=14 + prompt_update/rule_update + existing file target).
  if (hour === 9 && min >= 30 && min < 32) {
    const slot = `aw-apply:${now.toDateString()}`;
    if (!lastFired[slot]) {
      lastFired[slot] = true;
      runBot("awareness-apply", ["list"]);
    }
  }

  // hypothesis-from-awareness daily at 09:45 UTC (15min after awareness-apply).
  // Converts top 3 case_study items into testable hypotheses, queues them in
  // discovery state for hypothesis-executor to pick up.
  // Added 2026-05-09 to close awareness -> hypothesis -> test loop.
  if (hour === 9 && min >= 45 && min < 47) {
    const slot = `aw-to-hyp:${now.toDateString()}`;
    if (!lastFired[slot]) {
      lastFired[slot] = true;
      runBot("hypothesis-from-awareness");
    }
  }

  // awareness-auto-applier daily at 10:00 UTC (15min after hypothesis-from-awareness).
  // Reads apply_now items, calls Claude CLI for safe patch JSON, applies via 1 of 3
  // deterministic write modes (doctrine_bonus / header_rule / relevance_terms),
  // syntax-checks, reverts on fail. Cap: 1 successful apply per run.
  // Added 2026-05-09 - LAST gap in autonomous learning loop.
  if (hour === 10 && min < 2) {
    const slot = `aw-auto-apply:${now.toDateString()}`;
    if (!lastFired[slot]) {
      lastFired[slot] = true;
      runBot("awareness-auto-applier");
    }
  }

  // threads-bot every 30 min (moved from cron Apr 27 2026 - cron can't access Keychain for Claude CLI)
  if (min === 0 || min === 30) {
    const slot = `threads:${hour}:${min > 15 ? 30 : 0}:${now.toDateString()}`;
    if (!lastFired[slot]) {
      lastFired[slot] = true;
      runBot("threads-bot");
    }
  }

  // x-pain-scout 2x/day at 9AM and 3PM Calgary (UTC 15, 21) - sends X search links
  if (min === 0 && (hour === 15 || hour === 21)) {
    const slot = `x-scout:${hour}:${now.toDateString()}`;
    if (!lastFired[slot]) {
      lastFired[slot] = true;
      runBot("x-pain-scout");
    }
  }

  // linkedin-deep-analyzer 3x/day at 10AM, 2PM, 6PM Calgary (UTC 16, 20, 00)
  // Apr 13 2026: reduced from hourly to 3x/day to save Apify budget ($0.45/day vs $2.25)
  if (min === 40 && (hour === 16 || hour === 20 || hour === 0)) {
    const slot = `li-analyzer:${hour}:${now.toDateString()}`;
    if (!lastFired[slot]) {
      lastFired[slot] = true;
      runBot("linkedin-deep-analyzer");
    }
  }

  // icp-outreach-bot EVERY HOUR at :45 - finds ICP leads, drafts DMs, dispatches to Telegram
  // Plus extra fires at :15 during overnight Calgary hours (22-07 local) so the
  // pipeline keeps producing while Kirill sleeps. He wakes to a full batch.
  if (min === 45) {
    const slot = `icp:${hour}:${now.toDateString()}`;
    if (!lastFired[slot]) {
      lastFired[slot] = true;
      runBot("icp-outreach-bot");
    }
  }
  if (min === 15 && (hour >= 4 || hour < 14)) {
    // Calgary is UTC-6/-7, daemon runs in UTC. Overnight Calgary = roughly UTC 04-14
    const slot = `icp-night:${hour}:${now.toDateString()}`;
    if (!lastFired[slot]) {
      lastFired[slot] = true;
      runBot("icp-outreach-bot");
    }
  }

  // heartbeat-report twice daily at 08:00 and 20:00 (UTC) - ground truth to Telegram
  // Reduced from hourly to avoid Telegram noise (Apr 11 2026)
  // DUPLICATE WARNING: cron still has "5 8 * * * daily-heartbeat-report" entry - run fix-cron-dupes.sh to remove
  if (min === 0 && (hour === 8 || hour === 20)) {
    const slot = `heartbeat:${hour}:${now.toDateString()}`;
    if (!lastFired[slot]) {
      lastFired[slot] = true;
      runBot("daily-heartbeat-report");
    }
  }

  // === RESTORED Apr 12 2026 - old bots that were silently left off during FULL MODE switch ===

  // reddit-monitor every 2h at :50 - monitors replies to Kirill's Reddit comments
  if (min === 50 && hour % 2 === 0) {
    const slot = `reddit-mon:${hour}:${now.toDateString()}`;
    if (!lastFired[slot]) {
      lastFired[slot] = true;
      runBot("reddit-monitor");
    }
  }

  // linkedin-hunter REMOVED Apr 14 2026 - replaced by linkedin-deep-analyzer (context-aware per-post)

  // pipeline-bridge every hour at :52 - creates tasks for sales-bot/content-bot from warming leads
  // MUST run before sales-bot (:55) so tasks exist when sales-bot wakes up
  if (min === 52 && hour % 2 === 0) {
    const slot = `bridge:${hour}:${now.toDateString()}`;
    if (!lastFired[slot]) {
      lastFired[slot] = true;
      runBot("pipeline-bridge");
    }
  }

  // sales-bot every 2h at :55 - moves leads through funnel, sends follow-ups
  if (min === 55 && hour % 2 === 0) {
    const slot = `sales:${hour}:${now.toDateString()}`;
    if (!lastFired[slot]) {
      lastFired[slot] = true;
      runBot("sales-bot");
    }
  }

  // === RESTORED Apr 13 2026 - 12 bots that were dead since LEAN MODE ===

  // idea-bot daily at 07:00 UTC - strategic synthesis from signals
  if (hour === 7 && min === 0) {
    const slot = `idea:${now.toDateString()}`;
    if (!lastFired[slot]) {
      lastFired[slot] = true;
      runBot("idea-bot");
    }
  }

  // evolution-bot daily at 03:00 UTC - meta-agent, analyzes other bots for improvements
  if (hour === 3 && min === 0) {
    const slot = `evolution:${now.toDateString()}`;
    if (!lastFired[slot]) {
      lastFired[slot] = true;
      runBot("evolution-bot");
    }
  }

  // learn-bot REMOVED Apr 14 2026 - redundant with lead-enrichment-bot + research-bot-v2

  // brief-agent daily at 14:00 UTC (8AM Calgary) - daily control center to Telegram
  if (hour === 14 && min === 0) {
    const slot = `brief:${now.toDateString()}`;
    if (!lastFired[slot]) {
      lastFired[slot] = true;
      runBot("brief-agent");
    }
  }

  // analytics-bot daily at 05:00 UTC - ROI analysis, bot health, weekly report on Sundays
  if (hour === 5 && min === 0) {
    const slot = `analytics:${now.toDateString()}`;
    if (!lastFired[slot]) {
      lastFired[slot] = true;
      runBot("analytics-bot");
    }
  }

  // content-bot every 4h at :20 - drafts LinkedIn posts from lead pain signals
  if (min === 20 && hour % 4 === 0) {
    const slot = `content:${hour}:${now.toDateString()}`;
    if (!lastFired[slot]) {
      lastFired[slot] = true;
      runBot("content-bot");
    }
  }

  // community-bot every 6h at :25 - n8n community expert presence
  if (min === 25 && hour % 6 === 0) {
    const slot = `community:${hour}:${now.toDateString()}`;
    if (!lastFired[slot]) {
      lastFired[slot] = true;
      runBot("community-bot");
    }
  }

  // competitor-agent daily at 06:00 UTC - competitive analysis
  if (hour === 6 && min === 0) {
    const slot = `competitor:${now.toDateString()}`;
    if (!lastFired[slot]) {
      lastFired[slot] = true;
      runBot("competitor-agent");
    }
  }

  // build-bot every 2h at :10 - checks for closed deals, generates project plans
  if (min === 10 && hour % 2 === 0) {
    const slot = `build:${hour}:${now.toDateString()}`;
    if (!lastFired[slot]) {
      lastFired[slot] = true;
      runBot("build-bot");
    }
  }

  // system-brain every 15min at :07 - THE master controller
  // Watches all bots, distributes tasks, tracks achievements, self-heals
  if (min % 15 === 7) {
    const slot = `brain:${hour}:${min}:${now.toDateString()}`;
    if (!lastFired[slot]) {
      lastFired[slot] = true;
      runBot("system-brain");
    }
  }

  // project-executor every 15min at :03 - runs multi-step projects to completion
  // The missing link: idea-bot creates projects, project-executor runs them
  if (min % 15 === 3) {
    const slot = `executor:${hour}:${min}:${now.toDateString()}`;
    if (!lastFired[slot]) {
      lastFired[slot] = true;
      runBot("project-executor", ["tick"]);
    }
  }

  // builder-bot every 4h at :35 - autonomous MVP delivery engine
  if (min === 35 && hour % 4 === 0) {
    const slot = `builder:${hour}:${now.toDateString()}`;
    if (!lastFired[slot]) {
      lastFired[slot] = true;
      runBot("builder-bot");
    }
  }

  // calgary-email-outreach every 2h at :00 during business hours (UTC 14-02 = 8AM-8PM Calgary)
  // Daily cap 20. Each run picks new random city+vertical combo.
  if (min === 0 && hour % 2 === 0 && ((hour >= 14 && hour <= 23) || hour <= 2)) {
    const slot = `calgary-email:${hour}:${now.toDateString()}`;
    if (!lastFired[slot]) {
      lastFired[slot] = true;
      runBot("calgary-email-outreach");
    }
  }

  // Email pipeline: rewrite generic drafts + send personalized — every 3h during business hours
  // This is the REVENUE chain: find business → draft email → personalize → send → monitor reply
  if (min === 0 && hour % 3 === 0 && ((hour >= 14 && hour <= 23) || hour <= 2)) {
    const slot = `email-pipeline:${hour}:${now.toDateString()}`;
    if (!lastFired[slot]) {
      lastFired[slot] = true;
      // Rewrite generics first, then send personalized
      log("spawn email-pipeline: rewrite + send");
      const rewriteProc = spawn(NODE_BIN, [resolve(PROJECT_DIR, "scripts/outreach/rewrite-generic-drafts.mjs"), "--limit", "5"], {
        cwd: PROJECT_DIR, stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PATH: `${dirname(NODE_BIN)}:${process.env.PATH}` },
      });
      rewriteProc.on("close", (code) => {
        log(`rewrite-generic exit=${code}`);
        // After rewrite, send what's ready
        const sendProc = spawn(NODE_BIN, [resolve(PROJECT_DIR, "scripts/outreach/send-ready-batch.mjs")], {
          cwd: PROJECT_DIR, stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, PATH: `${dirname(NODE_BIN)}:${process.env.PATH}` },
        });
        let sendOut = "";
        sendProc.stdout.on("data", d => sendOut += d);
        sendProc.on("close", (c) => {
          log(`send-ready-batch exit=${c} ${sendOut.slice(-200)}`);
        });
      });
    }
  }

  // chain-business-outreach daily at 16:00 UTC (10AM Calgary) - finds chain businesses, drafts emails
  if (hour === 16 && min === 0) {
    const slot = `chain-outreach:${now.toDateString()}`;
    if (!lastFired[slot]) {
      lastFired[slot] = true;
      runBot("chain-business-outreach");
    }
  }

  // discovery-engine daily at 10:00 UTC (4AM Calgary) - discovers new markets via Brave+DB+AI
  if (hour === 10 && min === 0) {
    const slot = `discovery:${now.toDateString()}`;
    if (!lastFired[slot]) {
      lastFired[slot] = true;
      runBot("discovery-engine", [], "scripts/cortex/discovery-engine.mjs");
    }
  }

  // monitor-replies every 2h at :05 - polls IMAP inbox for cold outreach replies
  if (min === 5 && hour % 2 === 0) {
    const slot = `monitor-replies:${hour}:${now.toDateString()}`;
    if (!lastFired[slot]) {
      lastFired[slot] = true;
      runBot("monitor-replies", [], "scripts/outreach/monitor-replies.mjs");
    }
  }

  // hypothesis-executor every 4h at :10 during daytime UTC (08-22) - executes discovery hypotheses
  // Finds posts matching active hypothesis, drafts expert comments, sends to Telegram
  if (min === 10 && hour % 4 === 2 && hour >= 8 && hour <= 22) {
    const slot = `hyp-exec:${hour}:${now.toDateString()}`;
    if (!lastFired[slot]) {
      lastFired[slot] = true;
      runBot("hypothesis-executor");
    }
  }

  // self-builder daily at 11:00 UTC (5AM Calgary) - detects system gaps, builds missing bots
  // Max 1 build per day. All builds require Kirill approval via Telegram.
  if (hour === 11 && min === 0) {
    const slot = `self-builder:${now.toDateString()}`;
    if (!lastFired[slot]) {
      lastFired[slot] = true;
      runBot("self-builder");
    }
  }

  // telegram-sales-agent every 3h at :45 - active AI sales via Telegram
  if (min === 45 && hour % 3 === 1) {
    const slot = `tg-sales:${hour}:${now.toDateString()}`;
    if (!lastFired[slot]) {
      lastFired[slot] = true;
      runBot("telegram-sales-agent");
    }
  }

  // field-kit-executor every 6h at :40 during business hours (UTC 14-02 = 8AM-8PM Calgary)
  // Searches for real businesses matching approved field kits, sends action cards
  if (min === 40 && hour % 6 === 2 && ((hour >= 14 && hour <= 23) || hour <= 2)) {
    const slot = `field-kit:${hour}:${now.toDateString()}`;
    if (!lastFired[slot]) {
      lastFired[slot] = true;
      runBot("field-kit-executor");
    }
  }

  // buying-signal-hunt every 3h at :00 - moved from cron May 5 2026 (cron broken on macOS)
  // Window 0-1 protects against setInterval drift causing missed minute boundaries.
  if (min < 2 && hour % 3 === 0) {
    const slot = `buying-signal:${hour}:${now.toDateString()}`;
    if (!lastFired[slot]) {
      lastFired[slot] = true;
      runBot("buying-signal-hunt");
    }
  }

  // hn-show-hn-scout every 4h at :20 (offset from buying-signal at :00) - moved from cron May 5 2026
  // Window 20-21 protects against setInterval drift.
  if (min >= 20 && min < 22 && hour % 4 === 0) {
    const slot = `hn-scout:${hour}:${now.toDateString()}`;
    if (!lastFired[slot]) {
      lastFired[slot] = true;
      runBot("hn-show-hn-scout");
    }
  }
}

// Heartbeat every 5 min
let startTime = Date.now();
setInterval(() => {
  const uptimeMin = Math.floor((Date.now() - startTime) / 60000);
  log(`heartbeat - alive, ${uptimeMin}min uptime`);
}, 5 * 60 * 1000);

// Tick every 60 seconds
setInterval(tick, 60 * 1000);
log("scheduler started, ticking every 60s");

// Run lead-enrichment immediately to verify Keychain access on startup
setTimeout(() => {
  log("startup verification: running lead-enrichment-bot --batch");
  runBot("lead-enrichment-bot", ["--batch"]);
}, 5000);
