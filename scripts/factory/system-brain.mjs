/**
 * system-brain.mjs — The ONE controller that manages the entire system
 *
 * This is the missing piece. Before this, nobody watched the whole picture.
 * Now ONE process:
 *   1. Reads wiki/PURPOSE.md — knows the goal
 *   2. Checks every bot's health — who is alive, who is dead
 *   3. Restarts dead bots — self-healing
 *   4. Distributes tasks — tells bots what to focus on
 *   5. Tracks achievements — are we closer to $4,500/month?
 *   6. Updates wiki — writes health + progress back
 *
 * Schedule: every 15 min via sonnet-bots-daemon
 */
import Database from "better-sqlite3";
import { execSync, spawnSync } from "child_process";
import { readFileSync, writeFileSync, existsSync, statSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readPurpose, readWiki, updatePage, appendLog, getWikiContext } from "../../wiki/reader.mjs";
import { getBeliefsSummary, autoValidatePredictions, addBelief, getBrainStats } from "../../wiki/brain/reader.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DB_PATH = resolve(ROOT, ".data/linkedin-brand-os.sqlite");
const NODE_BIN_HARDCODED = "$HOME/.nvm/versions/node/v22.22.2/bin/node";
// Path mapping for bots NOT in scripts/factory/
const BOT_PATH_MAP = {
  "monitor-replies": "scripts/outreach/monitor-replies.mjs",
};

function botScriptPath(name) {
  if (BOT_PATH_MAP[name]) return resolve(ROOT, BOT_PATH_MAP[name]);
  return resolve(ROOT, `scripts/factory/${name}.mjs`);
}

// Error patterns that indicate code bugs (restart won't help)
const CODE_ERROR_RE = /MODULE_NOT_FOUND|ReferenceError|SyntaxError|TypeError|Cannot find module|ENOENT/;

/**
 * Read the last N lines of a bot's log and check for code errors.
 * Returns { hasCodeError, errorType, errorLine } or null if log unreadable.
 */
function diagnoseBot(logPath, lines = 5) {
  try {
    if (!existsSync(logPath)) return null;
    const content = readFileSync(logPath, "utf-8");
    const tail = content.split("\n").filter(Boolean).slice(-lines);
    for (const line of tail) {
      const match = line.match(CODE_ERROR_RE);
      if (match) {
        return { hasCodeError: true, errorType: match[0], errorLine: line.trim().slice(0, 200) };
      }
    }
    return { hasCodeError: false };
  } catch {
    return null;
  }
}

const NODE_BIN = (() => {
  if (existsSync(NODE_BIN_HARDCODED)) return NODE_BIN_HARDCODED;
  try {
    const found = spawnSync("which", ["node"], { encoding: "utf-8" }).stdout?.trim();
    if (found && existsSync(found)) return found;
  } catch {}
  return NODE_BIN_HARDCODED;
})();

const env = Object.fromEntries(
  readFileSync(resolve(ROOT, "apps/api/.env"), "utf-8").split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const TG = env.TELEGRAM_BOT_TOKEN, CHAT = env.TELEGRAM_CHAT_ID;

function log(msg) { console.log(`${new Date().toISOString()} [system-brain] ${msg}`); }

async function tg(text) {
  if (!TG || !CHAT) return;
  await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT, text: text.slice(0, 4096), parse_mode: "HTML", disable_web_page_preview: true }),
  }).catch(() => {});
}

// ── 1. HEALTH CHECK — who is alive, who is dead ──────────────────────────────

function checkHealth() {
  const bots = [];

  // Daemons — check via ps
  let psOut = "";
  try { psOut = execSync("ps aux", { encoding: "utf-8" }); } catch {}

  const daemons = [
    { name: "sonnet-bots-daemon", pattern: "sonnet-bots-daemon.mjs" },
    { name: "orchestrator-daemon", pattern: "orchestrator-daemon.sh" },
    { name: "telegram-control", pattern: "telegram-control.mjs" },
    // Supervisor-managed long-running bots — alive = process exists.
    // Their .logs/ mtime can be stale while process is healthy and idle, so don't gate on logs.
    { name: "scout-bot", pattern: "scout-bot.mjs" },
    { name: "reddit-monitor", pattern: "reddit-monitor.mjs" },
    { name: "telegram-sales-agent", pattern: "telegram-sales-agent.mjs" },
    { name: "content-bot", pattern: "content-bot.mjs" },
    { name: "trend-bot", pattern: "trend-bot.mjs" },
    { name: "community-bot", pattern: "community-bot.mjs" },
    { name: "idea-bot", pattern: "idea-bot.mjs" },
    { name: "research-bot", pattern: "research-bot.mjs" },
    { name: "linkedin-hunter", pattern: "linkedin-hunter.mjs" },
    { name: "sales-bot", pattern: "sales-bot.mjs" },
    { name: "pr-bot", pattern: "pr-bot.mjs" },
    { name: "analytics-bot", pattern: "analytics-bot.mjs" },
    { name: "brief-agent", pattern: "brief-agent.mjs" },
    { name: "learn-bot", pattern: "learn-bot.mjs" },
    { name: "evolution-bot", pattern: "evolution-bot.mjs" },
    { name: "service-bot", pattern: "service-bot.mjs" },
    { name: "build-bot", pattern: "build-bot.mjs" },
    // competitor-agent moved out 2026-05-08: it's a one-shot bot, not a daemon (exits 0 after each run)
  ];
  for (const d of daemons) {
    bots.push({ name: d.name, type: "daemon", alive: psOut.includes(d.pattern) });
  }

  // Cron/daemon bots — check via log freshness
  // Returns "alive" | "dead" | "pending" (file never existed = bot scheduled but not yet fired)
  function logStatus(path, maxMin) {
    try {
      if (!existsSync(path)) return "pending";
      const ageMin = (Date.now() - statSync(path).mtimeMs) / 60000;
      return ageMin <= maxMin ? "alive" : "dead";
    } catch { return "pending"; }
  }

  // Sonnet-daemon scheduled bots — fire on cron-like slots, not long-running.
  // Check via log mtime. If log file never existed = pending (not yet fired since daemon start), not dead.
  // maxMin = expected gap between fires. canRestart = system-brain can trigger directly.
  const scheduled = [
    { name: "lead-enrichment-bot", log: "/tmp/lbo-lead-enrichment-bot.log", maxMin: 120, canRestart: true },
    { name: "icp-outreach-bot", log: "/tmp/lbo-icp-outreach-bot.log", maxMin: 120, canRestart: true },
    { name: "research-bot-v2", log: "/tmp/lbo-research-bot-v2.log", maxMin: 120, canRestart: true },
    { name: "pipeline-bridge", log: "/tmp/lbo-pipeline-bridge.log", maxMin: 180, canRestart: true },
    { name: "builder-bot", log: "/tmp/lbo-builder-bot.log", maxMin: 300, canRestart: true },
    { name: "linkedin-deep-analyzer", log: "/tmp/lbo-linkedin-deep-analyzer.log", maxMin: 500, canRestart: true },
    { name: "content-curator-bot", log: "/tmp/lbo-content-curator-bot.log", maxMin: 1500, canRestart: true },
    { name: "daily-heartbeat-report", log: "/tmp/lbo-daily-heartbeat-report.log", maxMin: 1500, canRestart: false },
    { name: "site-curator-bot", log: "/tmp/lbo-site-curator-bot.log", maxMin: 10080, canRestart: false },
    { name: "hn-show-hn-scout", log: "/tmp/lbo-hn-show-hn-scout.log", maxMin: 270, canRestart: false },
    { name: "buying-signal-hunt", log: "/tmp/lbo-buying-signal-hunt.log", maxMin: 200, canRestart: false },
    { name: "monitor-replies", log: "/tmp/lbo-monitor-replies.log", maxMin: 130, canRestart: false },
    // competitor-agent: daily one-shot at 06:00 UTC, exits immediately. Long maxMin so a daily fire keeps it "alive".
    { name: "competitor-agent", log: "/tmp/lbo-competitor-agent.log", maxMin: 1500, canRestart: true },
    // Removed May 5 2026:
    // - fresh-pain-scout: DEPRECATED per its own docstring, replaced by buying-signal-hunt
    // - cron-watchdog: obsolete, nothing in cron to watch
    // - 18 supervisor-managed bots: moved to daemons[] above (process check, not log check)
  ];
  for (const s of scheduled) {
    const status = logStatus(s.log, s.maxMin);
    bots.push({
      name: s.name,
      type: "scheduled",
      alive: status === "alive",
      pending: status === "pending",
    });
  }

  return bots;
}

// ── 2. SELF-HEALING — restart dead daemons ───────────────────────────────────

function healDeadBots(bots) {
  const healed = [];
  const codeFixNeeded = []; // bots with code errors that restart won't fix

  // Daemons — always attempt restart (critical infrastructure)
  for (const bot of bots) {
    if (bot.alive) continue;

    const daemonNames = ["sonnet-bots-daemon", "orchestrator-daemon", "telegram-control"];
    if (!daemonNames.includes(bot.name)) continue;

    // Diagnose before restart
    const logPath = `/tmp/lbo-${bot.name}.log`;
    const diag = diagnoseBot(logPath);
    if (diag?.hasCodeError) {
      log(`SKIP restart ${bot.name}: code error detected — ${diag.errorType}`);
      codeFixNeeded.push({ name: bot.name, errorType: diag.errorType, errorLine: diag.errorLine });
      continue;
    }

    log(`CRITICAL: ${bot.name} is dead! Restarting...`);
    const scriptPath = botScriptPath(bot.name);
    try {
      execSync(`nohup ${NODE_BIN} ${scriptPath} > ${logPath} 2>&1 &`, { encoding: "utf-8" });
      healed.push(`${bot.name} (restarted)`);
    } catch (e) { log(`Failed to restart ${bot.name}: ${e.message}`); }
  }

  // Restart scheduled bots that missed their cycle
  const restartable = [
    "lead-enrichment-bot", "icp-outreach-bot", "research-bot-v2",
    "sales-bot", "reddit-monitor", "pipeline-bridge", "build-bot",
    "content-bot", "builder-bot", "community-bot", "linkedin-deep-analyzer",
    "idea-bot", "evolution-bot", "competitor-agent", "content-curator-bot",
    "brief-agent", "analytics-bot",
  ];
  let restarted = 0;
  for (const bot of bots) {
    if (bot.alive || !restartable.includes(bot.name) || restarted >= 3) continue;

    // Diagnose before restart — check log for code errors
    const logPath = `/tmp/lbo-${bot.name}.log`;
    const diag = diagnoseBot(logPath);
    if (diag?.hasCodeError) {
      log(`SKIP restart ${bot.name}: code error detected — ${diag.errorType}: ${diag.errorLine}`);
      codeFixNeeded.push({ name: bot.name, errorType: diag.errorType, errorLine: diag.errorLine });
      continue;
    }

    log(`Restarting missed bot: ${bot.name}`);
    const args = ["lead-enrichment-bot", "research-bot-v2"].includes(bot.name) ? "--batch" : "";
    const scriptPath = botScriptPath(bot.name);
    try {
      execSync(
        `nohup ${NODE_BIN} ${scriptPath} ${args} >> ${logPath} 2>&1 &`,
        { encoding: "utf-8", timeout: 5000 }
      );
      healed.push(`${bot.name} (restarted)`);
      restarted++;
    } catch (e) { log(`Failed to restart ${bot.name}: ${e.message}`); }
  }

  return { healed, codeFixNeeded };
}

// ── 3. ACHIEVEMENTS — track progress toward goals ────────────────────────────

function trackAchievements(db) {
  const achievements = {};

  // Revenue
  const goal = db.prepare("SELECT target_amount, current_amount FROM goals WHERE status = 'active' LIMIT 1").get();
  achievements.revenue = goal?.current_amount || 0;
  achievements.revenueGoal = goal?.target_amount || 4500;

  // Leads pipeline
  const stages = db.prepare("SELECT stage, COUNT(*) as c FROM leads GROUP BY stage").all();
  achievements.leads = {};
  for (const s of stages) achievements.leads[s.stage] = s.c;

  // Enrichment
  const enriched = db.prepare("SELECT COUNT(*) as c FROM lead_enrichment").get()?.c || 0;
  const warming = db.prepare("SELECT COUNT(*) as c FROM lead_enrichment WHERE classification IN ('warming','ready_buyer')").get()?.c || 0;
  achievements.enriched = enriched;
  achievements.warming = warming;
  achievements.warmingRate = enriched > 0 ? (warming / enriched * 100).toFixed(1) + "%" : "0%";

  // Outreach
  const sent = db.prepare("SELECT COUNT(*) as c FROM outreach_emails WHERE status='sent'").get()?.c || 0;
  const replied = db.prepare("SELECT COUNT(*) as c FROM outreach_emails WHERE reply_received_at IS NOT NULL").get()?.c || 0;
  achievements.emailsSent = sent;
  achievements.emailsReplied = replied;

  // Deals
  try {
    const deals = db.prepare("SELECT COUNT(*) as c FROM deals").get()?.c || 0;
    achievements.deals = deals;
  } catch { achievements.deals = 0; }

  // Today's activity
  const today = new Date().toISOString().slice(0, 10);
  try {
    achievements.todayEnriched = db.prepare("SELECT COUNT(*) as c FROM lead_enrichment WHERE date(enriched_at)=?").get(today)?.c || 0;
  } catch { achievements.todayEnriched = 0; }
  try {
    achievements.todayEmails = db.prepare("SELECT COUNT(*) as c FROM outreach_emails WHERE date(sent_at)=?").get(today)?.c || 0;
  } catch { achievements.todayEmails = 0; }

  return achievements;
}

// ── 4. TASK DISTRIBUTION — decide what the system should focus on ─────────────

function distributeTasks(achievements, bots, db) {
  const tasks = [];
  const deadChannels = readWiki("market/dead-channels.md");
  const thesis = readWiki("strategy/current-thesis.md");

  // Priority 1: If no revenue — focus on getting first client
  if (achievements.revenue === 0) {
    tasks.push({
      priority: "CRITICAL",
      task: "FIRST CLIENT",
      detail: "Revenue is $0. Every bot should prioritize actions that lead to a paying client.",
      assignTo: "all"
    });
  }

  // Priority 2: If warming leads exist but no drafts sent — unblock outreach
  if (achievements.warming > 0) {
    const undrafted = db.prepare(`
      SELECT COUNT(*) as c FROM lead_enrichment e
      JOIN leads l ON e.lead_id = l.id
      WHERE e.classification IN ('warming','ready_buyer')
      AND l.outreach_status IS NULL AND l.stage='new'
    `).get()?.c || 0;
    if (undrafted > 0) {
      tasks.push({
        priority: "HIGH",
        task: `${undrafted} warming leads without drafts`,
        detail: "icp-outreach-bot must produce drafts for these leads this cycle",
        assignTo: "icp-outreach-bot"
      });
    }
  }

  // Priority 3: If lots of unenriched leads — enrichment should run
  // Must match lead-enrichment-bot's score >= 60 filter (fixed Apr 27 2026)
  const unenriched = db.prepare("SELECT COUNT(*) as c FROM leads WHERE stage='new' AND score >= 60 AND id NOT IN (SELECT lead_id FROM lead_enrichment)").get()?.c || 0;
  if (unenriched > 100) {
    tasks.push({
      priority: "MEDIUM",
      task: `${unenriched} leads waiting for enrichment`,
      detail: "lead-enrichment-bot should process these in batches of 30",
      assignTo: "lead-enrichment-bot"
    });
  }

  // Priority 4: Check if content is stale
  try {
    const lastInsight = db.prepare("SELECT MAX(created_at) as d FROM content_queue_items").get()?.d;
    if (!lastInsight || (Date.now() - new Date(lastInsight).getTime()) > 3 * 24 * 3600 * 1000) {
      tasks.push({
        priority: "MEDIUM",
        task: "No content created in 3+ days",
        detail: "content-curator-bot should draft a new insight for launchsoloai.com",
        assignTo: "content-curator-bot"
      });
    }
  } catch {}

  // Priority 5: RESOURCE LOGIC - stop scouts if backlog exists
  const BACKLOG_THRESHOLD = 500;
  if (unenriched > BACKLOG_THRESHOLD) {
    tasks.push({
      priority: "HIGH",
      task: `PAUSE SCOUTS: ${unenriched} unenriched backlog > ${BACKLOG_THRESHOLD} threshold`,
      detail: "Scouts paused until enrichment clears backlog. No point finding more leads when we can't process existing ones.",
      assignTo: "system-brain"
    });
    // Actually pause scouts by writing a flag file
    writeFileSync(resolve(ROOT, ".data/scouts-paused.flag"), `paused by system-brain at ${new Date().toISOString()}\nreason: ${unenriched} unenriched leads backlog\nresume when: backlog < ${BACKLOG_THRESHOLD}`);
  } else {
    // Resume scouts if backlog is cleared
    const flagPath = resolve(ROOT, ".data/scouts-paused.flag");
    if (existsSync(flagPath)) {
      try { execSync(`rm "${flagPath}"`); } catch {}
      log("scouts resumed - backlog cleared");
    }
  }

  // Priority 6: Dead bots
  const deadBots = bots.filter(b => !b.alive).map(b => b.name);
  if (deadBots.length > 0) {
    tasks.push({
      priority: "MEDIUM",
      task: `${deadBots.length} bots offline`,
      detail: "Self-healing in progress, max 3 restarts per cycle.",
      assignTo: "system-brain"
    });
  }

  return tasks;
}

// ── 5. UPDATE WIKI — write everything back ───────────────────────────────────

function updateWiki(bots, achievements, tasks, healed) {
  const today = new Date().toISOString().slice(0, 10);
  const aliveCount = bots.filter(b => b.alive).length;
  const totalCount = bots.length;

  // Update health page
  updatePage("bots/health.md", content => {
    // Update the status counts in the content
    const statusLine = `\n\n## Live Status (auto-updated by system-brain)\n` +
      `**${aliveCount}/${totalCount} bots alive** | Last check: ${new Date().toISOString().slice(11, 19)} UTC\n\n` +
      bots.map(b => `- ${b.alive ? "🟢" : "🔴"} ${b.name} (${b.type})`).join("\n") + "\n";

    // Replace or append live status section
    if (content.includes("## Live Status")) {
      return content.replace(/## Live Status[\s\S]*?(?=\n## |$)/, statusLine.trim());
    }
    return content + "\n" + statusLine;
  });

  // Log entry
  const taskSummary = tasks.map(t => `[${t.priority}] ${t.task}`).join("; ");
  const healedSummary = healed.length > 0 ? ` Healed: ${healed.join(", ")}.` : "";
  appendLog("brain", `${aliveCount}/${totalCount} alive. Revenue: $${achievements.revenue}. Warming: ${achievements.warming}. Tasks: ${taskSummary}.${healedSummary}`);
}

// ── 6. TELEGRAM REPORT — ONLY morning summary or critical alerts ─────────────
// Rule: NO status spam every 15 min. ONLY send when:
// 1. Morning report (first run between 7-8 AM Calgary time)
// 2. A bot died and could not be healed
// 3. Revenue changed (new client!)
// 4. A lead replied (hot signal)
// Everything else: system works silently.

async function reportToTelegram(bots, achievements, tasks, healed, codeFixNeeded = []) {
  const aliveCount = bots.filter(b => b.alive).length;
  const deadBots = bots.filter(b => !b.alive);
  const hour = new Date().getHours(); // UTC, Calgary = UTC-6

  // Morning report: once per day between 13-14 UTC (7-8 AM Calgary)
  const isMorning = hour >= 13 && hour < 14;
  const morningFlagFile = "/tmp/lbo-morning-report-sent.flag";
  const morningAlreadySent = (() => {
    try {
      const stat = statSync(morningFlagFile);
      return (Date.now() - stat.mtimeMs) < 12 * 60 * 60 * 1000; // within 12h
    } catch { return false; }
  })();

  if (isMorning && !morningAlreadySent) {
    // Send morning summary
    let msg = `☀️ <b>Morning Report</b>\n\n`;
    msg += `<b>Revenue:</b> $${achievements.revenue}\n`;
    msg += `<b>Warming leads:</b> ${achievements.warming}\n`;
    msg += `<b>Yesterday:</b> ${achievements.todayEnriched} enriched, ${achievements.todayEmails} emails\n`;
    msg += `<b>Bots:</b> ${aliveCount}/${bots.length} alive\n`;
    if (deadBots.length > 0) msg += `<b>Dead:</b> ${deadBots.map(b => b.name).join(", ")}\n`;
    if (healed.length > 0) msg += `<b>Healed:</b> ${healed.join(", ")}\n`;
    // Focus pulled from cortex_focus table (set by conscious-doctor / Kirill directives)
    // Fallback to current strategic verdict if no focus set.
    let currentFocus = "First paying client (AI workflow services)";
    try {
      const db = getDb();
      const row = db.prepare(`SELECT direction FROM cortex_focus ORDER BY allocation_pct DESC LIMIT 1`).get();
      if (row?.direction) currentFocus = row.direction.slice(0, 150);
      db.close();
    } catch {}
    msg += `\n<b>Focus:</b> ${currentFocus}`;
    await tg(msg);
    try { writeFileSync(morningFlagFile, new Date().toISOString()); } catch {}
    return;
  }

  // Critical alerts only - bot died and NOT healed.
  // - Exclude "pending" (log file never existed = scheduled bot waiting for first slot).
  // - healed entries look like "name (restarted)", so match by prefix.
  const isHealed = (name) => healed.some(h => h === name || h.startsWith(name + " "));
  const unhealed = deadBots.filter(b => !b.pending && !isHealed(b.name));
  if (unhealed.length > 3) {
    await tg(`🔴 <b>ALERT:</b> ${unhealed.length} bots dead: ${unhealed.map(b => b.name).join(", ")}`);
  }

  // Revenue change alert
  if (achievements.revenue > 0) {
    await tg(`💰 <b>REVENUE!</b> $${achievements.revenue}`);
  }

  // Code-fix-needed alerts — bots crashing with code errors
  if (codeFixNeeded.length > 0) {
    const lines = codeFixNeeded.map(b =>
      `• <b>${b.name}</b> — ${b.errorType}\n  <code>${(b.errorLine || "").slice(0, 150)}</code>`
    ).join("\n");
    await tg(`🔧 <b>CODE FIX NEEDED</b> (${codeFixNeeded.length} bot${codeFixNeeded.length > 1 ? "s" : ""}):\n\n${lines}\n\nRestart won't help - code fix required.`);
  }

  // Do NOT send routine status updates. System works silently.
}

// ── 7. THINK — GPT-5.4 analyzes situation and produces directives ────────────

async function think(bots, achievements, tasks) {
  const wikiCtx = getWikiContext([
    "bots/architecture.md",
    "strategy/current-thesis.md",
    "market/what-converts.md",
    "market/dead-channels.md",
    "leads/hot-prospects.md",
    "strategy/experiments.md",
    "strategy/lessons.md",
  ]);

  const aliveBots = bots.filter(b => b.alive).map(b => b.name).join(", ");
  const deadBotsList = bots.filter(b => !b.alive).map(b => b.name).join(", ");
  const taskList = tasks.map(t => `[${t.priority}] ${t.task}`).join("\n");

  // Inject brain knowledge
  let brainKnowledge = "";
  try { brainKnowledge = getBeliefsSummary(); } catch (e) { log(`brain beliefs read failed: ${e.message}`); }

  const prompt = `You are the System Brain - the ONE controller of Kirill's autonomous business system.

${wikiCtx}

${brainKnowledge}

CURRENT STATE:
- Revenue: $${achievements.revenue} / $${achievements.revenueGoal} goal
- Warming leads: ${achievements.warming} (${achievements.warmingRate})
- Emails sent: ${achievements.emailsSent}, replied: ${achievements.emailsReplied}
- Deals: ${achievements.deals}
- Today: ${achievements.todayEnriched} enriched, ${achievements.todayEmails} emails
- Alive bots: ${aliveBots}
- Dead bots: ${deadBotsList}
- Tasks detected: ${taskList}

YOUR JOB: Analyze the situation and produce DIRECTIVES for each active bot.
Think about:
1. What should each bot FOCUS on right now to get the first paying client?
2. What should each bot STOP doing that wastes resources?
3. What TEMPO should the system work at? (fast/normal/slow based on resources)
4. Are there any IDEAS that should be tested? What experiment to run next?
5. What is the BIGGEST BOTTLENECK preventing revenue?

Output JSON:
{
  "analysis": "2-3 sentences: what is the system's biggest problem right now",
  "bottleneck": "the ONE thing blocking revenue",
  "tempo": "fast|normal|slow",
  "tempo_reason": "why this tempo",
  "directives": [
    {"bot": "bot-name", "directive": "what this bot should focus on", "stop": "what to stop doing"},
    ...
  ],
  "next_experiment": {"hypothesis": "...", "test": "...", "measure": "...", "duration": "..."},
  "urgent_action": "ONE thing to do in the next hour or null",
  "research_query": "If a bot needs knowledge the system doesn't have (new tool, API, integration pattern), write a search query here. awareness-bot will research it and write findings to wiki. Example: 'how to send SMS from n8n using Twilio' or 'best CRM API for plumbing companies'. null if no research needed."
}`;

  try {
    const { callAI, MODEL_STRONG } = await import("./orchestrator.mjs");
    const result = await callAI(prompt, "Produce directives now.", MODEL_STRONG);
    if (!result) return null;

    const jsonStr = typeof result === "string" ? result : JSON.stringify(result);
    const match = jsonStr.match(/\{[\s\S]*\}/);
    if (!match) return null;

    const directives = JSON.parse(match[0]);

    // Write directives to wiki so all bots can read them
    const directivesPage = `# System Directives

Last updated: ${new Date().toISOString().slice(0, 19)}Z
Generated by: system-brain via GPT-5.4
Based on: [[PURPOSE]], [[current-thesis]], [[what-converts]], [[dead-channels]], [[hot-prospects]]

## Analysis
${directives.analysis}

## Bottleneck
**${directives.bottleneck}**

## Tempo: ${directives.tempo}
${directives.tempo_reason}

## Bot Directives
${(directives.directives || []).map(d =>
  `### ${d.bot}\n- **FOCUS:** ${d.directive}\n- **STOP:** ${d.stop}`
).join("\n\n")}

## Next Experiment
${directives.next_experiment ? `- **Hypothesis:** ${directives.next_experiment.hypothesis}
- **Test:** ${directives.next_experiment.test}
- **Measure:** ${directives.next_experiment.measure}
- **Duration:** ${directives.next_experiment.duration}` : "None proposed"}

## Urgent Action
${directives.urgent_action || "None"}

## Related
- [[PURPOSE]] - system purpose
- [[architecture]] - bot connections
- [[health]] - bot status
- [[current-thesis]] - strategy
- [[hot-prospects]] - active leads
- [[experiments]] - active tests
- [[lessons]] - past mistakes
- [[learned-scoring]] - scoring rules
- [[learned-outreach]] - outreach rules
`;

    writeFileSync(resolve(ROOT, "wiki/directives.md"), directivesPage);
    log(`directives written: bottleneck="${directives.bottleneck}", tempo=${directives.tempo}`);

    return directives;
  } catch (e) {
    log(`think failed: ${e.message}`);
    return null;
  }
}

// ── 8. EXECUTE — System Brain doesn't just think, it ACTS ────────────────────

function spawnBot(name, args = []) {
  log(`EXECUTING: ${name} ${args.join(" ")}`);
  const scriptPath = botScriptPath(name);
  try {
    execSync(
      `nohup ${NODE_BIN} ${scriptPath} ${args.join(" ")} >> /tmp/lbo-${name}.log 2>&1 &`,
      { encoding: "utf-8", timeout: 5000 }
    );
    return true;
  } catch (e) {
    log(`spawn failed ${name}: ${e.message}`);
    return false;
  }
}

async function executeDirectives(directives, db) {
  if (!directives) return;
  const executed = [];

  // Execute urgent action
  if (directives.urgent_action && directives.urgent_action !== "None" && directives.urgent_action !== "null") {
    log(`URGENT: ${directives.urgent_action}`);

    // Parse urgent action and map to bot commands
    const urgent = directives.urgent_action.toLowerCase();

    if (urgent.includes("outreach draft") || urgent.includes("personalized") || urgent.includes("warming lead")) {
      spawnBot("icp-outreach-bot");
      executed.push("icp-outreach-bot (urgent drafts)");
    }
    if (urgent.includes("enrichment") || urgent.includes("enrich")) {
      spawnBot("lead-enrichment-bot", ["--batch"]);
      executed.push("lead-enrichment-bot (urgent batch)");
    }
    if (urgent.includes("content") || urgent.includes("post") || urgent.includes("linkedin")) {
      spawnBot("content-curator-bot");
      executed.push("content-curator-bot (urgent content)");
    }
    if (urgent.includes("brief") || urgent.includes("research")) {
      spawnBot("brief-agent");
      executed.push("brief-agent (urgent briefs)");
    }
    if (urgent.includes("sales") || urgent.includes("proposal") || urgent.includes("close")) {
      spawnBot("sales-bot");
      executed.push("sales-bot (urgent close)");
    }
  }

  // Execute directed research if brain identified a knowledge gap
  if (directives.research_query && directives.research_query !== "null" && directives.research_query !== "None") {
    log(`RESEARCH: ${directives.research_query}`);
    spawnBot("awareness-bot", ["research", directives.research_query]);
    executed.push(`awareness-bot (research: ${directives.research_query.slice(0, 60)})`);
  }

  // Execute bot directives - spawn bots that have specific focus tasks
  for (const d of (directives.directives || [])) {
    // Only spawn bots that have actionable FOCUS directives
    const focus = (d.directive || "").toLowerCase();
    const botName = d.bot;

    // Skip daemon/infrastructure bots (they run continuously)
    if (["orchestrator-daemon", "sonnet-bots-daemon", "telegram-control"].includes(botName)) continue;

    // Skip already executed
    if (executed.some(e => e.startsWith(botName))) continue;

    // Spawn bots with urgent/time-sensitive directives
    if (focus.includes("immediately") || focus.includes("within the next") || focus.includes("right now") || focus.includes("today")) {
      const args = ["lead-enrichment-bot", "research-bot-v2"].includes(botName) ? ["--batch"] : [];
      spawnBot(botName, args);
      executed.push(`${botName} (directive: ${focus.slice(0, 50)})`);
    }
  }

  // Start the experiment if one is proposed
  if (directives.next_experiment && directives.next_experiment.test) {
    const test = directives.next_experiment.test.toLowerCase();
    if (test.includes("draft") || test.includes("outreach") || test.includes("send")) {
      if (!executed.some(e => e.includes("icp-outreach"))) {
        spawnBot("icp-outreach-bot");
        executed.push("icp-outreach-bot (experiment)");
      }
    }
  }

  if (executed.length > 0) {
    log(`EXECUTED ${executed.length} actions: ${executed.join(", ")}`);
    appendLog("execute", `System Brain executed: ${executed.join(", ")}`);
    // Log executions silently - no Telegram spam
    log(`EXECUTED ${executed.length} actions: ${executed.map(e => e.split(" (")[0]).join(", ")}`);
  }

  return executed;
}

// ── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  log("=== SYSTEM BRAIN CYCLE START ===");

  // Read purpose — remind ourselves why we exist
  const purpose = readPurpose();
  log(`PURPOSE loaded (${purpose.length} bytes)`);

  // 1. Health check
  const bots = checkHealth();
  const alive = bots.filter(b => b.alive).length;
  const dead = bots.filter(b => !b.alive).length;
  log(`health: ${alive}/${bots.length} alive, ${dead} dead`);

  // 2. Self-heal (with diagnosis)
  const { healed, codeFixNeeded } = healDeadBots(bots);
  if (healed.length > 0) log(`healed: ${healed.join(", ")}`);
  if (codeFixNeeded.length > 0) log(`code fix needed: ${codeFixNeeded.map(b => `${b.name} (${b.errorType})`).join(", ")}`);

  // 3. Track achievements
  const db = new Database(DB_PATH, { readonly: true });
  const achievements = trackAchievements(db);
  log(`achievements: revenue=$${achievements.revenue}, warming=${achievements.warming} (${achievements.warmingRate}), emails=${achievements.emailsSent}, deals=${achievements.deals}`);

  // 4. Distribute tasks
  const tasks = distributeTasks(achievements, bots, db);
  for (const t of tasks) log(`task [${t.priority}]: ${t.task} → ${t.assignTo}`);
  db.close();

  // 5. AUTO-UPDATE wiki pages with fresh data
  try {
    const dbW = new Database(DB_PATH, { readonly: true });

    // Update hot-prospects with current warming leads
    const warmLeads = dbW.prepare(`
      SELECT l.name, l.source, e.buyer_score, e.pain_category, e.recommended_action
      FROM leads l JOIN lead_enrichment e ON e.lead_id=l.id
      WHERE e.classification IN ('warming','ready_buyer') AND l.stage='new'
      ORDER BY e.buyer_score DESC LIMIT 20
    `).all();
    if (warmLeads.length > 0) {
      const table = warmLeads.map(l =>
        `| ${l.name} | ${l.source} | ${l.pain_category || "?"} | ${l.buyer_score} | ${l.recommended_action} |`
      ).join("\n");
      updatePage("leads/hot-prospects.md", c => {
        const header = "| Name | Source | Pain | Score | Action |\n|------|--------|------|-------|--------|";
        const newSection = `## Current Top Warming Leads (auto-updated)\n${header}\n${table}`;
        if (c.includes("## Current Top Warming")) {
          return c.replace(/## Current Top Warming[\s\S]*?(?=\n## |$)/, newSection);
        }
        return c + "\n\n" + newSection;
      });
    }

    // Update enrichment-insights with fresh stats
    const enrichTotal = dbW.prepare("SELECT COUNT(*) as c FROM lead_enrichment").get()?.c || 0;
    const enrichWarming = dbW.prepare("SELECT COUNT(*) as c FROM lead_enrichment WHERE classification IN ('warming','ready_buyer')").get()?.c || 0;
    const rate = enrichTotal > 0 ? (enrichWarming / enrichTotal * 100).toFixed(1) : "0";
    updatePage("leads/enrichment-insights.md", c => {
      return c.replace(/Total enriched: \d+/, `Total enriched: ${enrichTotal}`)
              .replace(/Pass rate.*?: [\d.]+%/, `Pass rate (warming+ready): ${rate}%`);
    });

    // Update experiments with email stats
    const emailStats = dbW.prepare(`
      SELECT template_version, COUNT(*) as sent,
        SUM(CASE WHEN is_meaningful_reply=1 THEN 1 ELSE 0 END) as meaningful
      FROM outreach_emails WHERE status='sent' GROUP BY template_version
    `).all();
    if (emailStats.length > 0) {
      const expTable = emailStats.map(e =>
        `- ${e.template_version}: ${e.sent} sent, ${e.meaningful} meaningful`
      ).join("\n");
      updatePage("strategy/experiments.md", c => {
        const section = `## Email Template Results (auto-updated)\n${expTable}`;
        if (c.includes("## Email Template Results")) {
          return c.replace(/## Email Template Results[\s\S]*?(?=\n## |$)/, section);
        }
        return c + "\n\n" + section;
      });
    }

    dbW.close();
    log("wiki pages auto-updated");
  } catch (e) { log(`wiki auto-update error: ${e.message}`); }

  // 6. THINK — GPT-5.4 analyzes and produces directives (once per hour, not every 15 min)
  const now = new Date();
  const lastThinkFile = resolve(ROOT, ".data/last-brain-think.txt");
  let shouldThink = true;
  try {
    const lastThink = readFileSync(lastThinkFile, "utf-8").trim();
    const elapsed = (Date.now() - new Date(lastThink).getTime()) / 60000;
    if (elapsed < 55) shouldThink = false; // Think only once per hour
  } catch {} // No file = first time

  // Auto-validate predictions with real DB data (every cycle, cheap operation)
  try {
    const validated = autoValidatePredictions();
    if (validated.length > 0) {
      log(`auto-validated ${validated.length} predictions: ${validated.map(v => `#${v.id} ${v.correct ? "CONFIRMED" : "FAILED"}`).join(", ")}`);
      appendLog("brain", `Auto-validated ${validated.length} predictions: ${validated.map(v => `#${v.id} ${v.correct ? "CONFIRMED" : "FAILED"} (actual: ${v.actual})`).join("; ")}`);
    }
  } catch (e) { log(`prediction auto-validate error: ${e.message}`); }

  if (shouldThink) {
    log("THINKING via GPT-5.4...");
    const directives = await think(bots, achievements, tasks);
    if (directives) {
      writeFileSync(lastThinkFile, new Date().toISOString());
      // Directives saved to wiki silently. NO Telegram spam.
      log(`directives written: bottleneck="${directives.bottleneck}", tempo=${directives.tempo}`);

      // EXECUTE — don't just think, ACT
      const db2 = new Database(DB_PATH);
      await executeDirectives(directives, db2);
      db2.close();

      // Record experiment as a brain belief if one was proposed
      if (directives.next_experiment?.hypothesis) {
        try {
          addBelief({
            domain: "experiments",
            belief: `Experiment proposed: ${directives.next_experiment.hypothesis} (test: ${directives.next_experiment.test})`,
            confidence: 0.3,
            source: "system-brain",
            evidence: `Proposed ${new Date().toISOString().slice(0, 10)}, measure: ${directives.next_experiment.measure}`
          });
        } catch (e) { log(`brain addBelief error: ${e.message}`); }
      }
    }
  } else {
    log("skipping think (last think < 55 min ago)");
    // Even without thinking, execute based on existing directives
    const existingDirectives = readWiki("directives.md");
    if (existingDirectives && existingDirectives.includes("Urgent Action")) {
      // Re-read and act on pending urgent items
      log("checking existing directives for pending actions");
    }
  }

  // 6. Update wiki + brain stats
  updateWiki(bots, achievements, tasks, healed);
  try {
    const stats = getBrainStats();
    log(`brain: ${stats.beliefs} beliefs (${stats.highConf} high-conf), ${stats.predictions} predictions (${stats.tested} tested, ${stats.correct} correct)`);
  } catch (e) { log(`brain stats error: ${e.message}`); }
  log("wiki updated");

  // 7. Report to Telegram (only if something needs attention)
  await reportToTelegram(bots, achievements, tasks, healed, codeFixNeeded);

  log("=== SYSTEM BRAIN CYCLE END ===");
}

main().catch(e => {
  console.error("[system-brain] FATAL:", e.message);
  tg(`🚨 system-brain CRASHED: ${e.message}`).catch(() => {});
  process.exit(1);
});
