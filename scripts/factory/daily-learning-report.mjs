/**
 * daily-learning-report.mjs
 *
 * Sends Kirill a Telegram summary of what the system learned today.
 * Reads awareness, observations, evolution, orchestrator log, content, pipeline.
 * No AI calls - just reads data and formats a report.
 *
 * Run: node scripts/factory/daily-learning-report.mjs
 * Cron: daily, after awareness-bot and daily-observations have run
 */

import { readFileSync, existsSync, statSync } from "fs";
import { execSync } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { tgSendToKirill, getDb, heartbeat } from "./orchestrator.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const TODAY = new Date().toLocaleDateString("en-CA", { timeZone: "America/Edmonton" });
const TODAY_SHORT = TODAY.replace(/^\d{4}-/, "").replace("-", "/");
const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const [, mon, day] = TODAY.split("-");
const DATE_LABEL = `${MONTH_NAMES[parseInt(mon, 10) - 1]} ${parseInt(day, 10)}`;

function readSafe(path) {
  try { return existsSync(path) ? readFileSync(path, "utf-8") : null; } catch { return null; }
}

function jsonSafe(path) {
  try { return JSON.parse(readFileSync(path, "utf-8")); } catch { return null; }
}

function s1(db, sql, params = []) {
  try { return db.prepare(sql).get(...params) || {}; } catch { return {}; }
}

// ── 1. Awareness ─────────────────────────────────────────────────────

function parseAwareness() {
  const md = readSafe(resolve(ROOT, ".data/awareness/latest.md"));
  if (!md) return { accepted: 0, flagged: 0, items: [], date: null };

  // Check if this is today's report
  const dateMatch = md.match(/Awareness Brief - (\d{4}-\d{2}-\d{2})/);
  const reportDate = dateMatch ? dateMatch[1] : null;

  // Count accepted and flagged from summary
  const acceptedMatch = md.match(/ACCEPTED:\s*(\d+)/i);
  const flaggedMatch = md.match(/FLAGGED:\s*(\d+)/i);
  const accepted = acceptedMatch ? parseInt(acceptedMatch[1]) : 0;
  const flagged = flaggedMatch ? parseInt(flaggedMatch[1]) : 0;

  // Extract item titles
  const items = [];
  // Accepted items - look for ### headings after ACCEPTED section
  const acceptedSection = md.split(/^## ACCEPTED/m)[1]?.split(/^## /m)[0] || "";
  for (const m of acceptedSection.matchAll(/\*\*Summary:\*\*\s*(.+)/g)) {
    items.push({ type: "Applied", title: m[1].slice(0, 80) });
  }
  // Flagged items - extract from numbered list
  const flaggedSection = md.split(/^## FLAGGED/m)[1]?.split(/^## /m)[0] || "";
  for (const m of flaggedSection.matchAll(/\d+\.\s*\[\d+\/\d+\]\s*(?:undefined\s*-\s*)?(.+?)(?:\s*\((?:undefined|http\S+)\))?$/gm)) {
    items.push({ type: "Flagged", title: m[1].slice(0, 80) });
  }

  return { accepted, flagged, items, date: reportDate };
}

// ── 2. Observations ──────────────────────────────────────────────────

function parseObservations() {
  const md = readSafe(resolve(ROOT, `.data/observations/${TODAY}.md`));
  if (!md) return null;

  const lines = [];
  // Extract pipeline section
  const pipelineMatch = md.match(/## Pipeline\n([\s\S]*?)(?=\n##|\n---|\n_Generated|$)/);
  if (pipelineMatch) {
    lines.push(pipelineMatch[1].trim());
  }
  // Extract hypotheses count
  const hypotheses = (md.match(/### \d+\./g) || []).length;

  return { raw: md, hypotheses };
}

// ── 3. Evolution ─────────────────────────────────────────────────────

function parseEvolution() {
  const evo = jsonSafe(resolve(ROOT, ".data/cortex-evolution.json"));
  if (!evo) return "file missing";

  const gen = evo.generation || 0;
  const experiments = (evo.experiments || []).filter(e => !e.result?.includes("purged"));
  const active = experiments.filter(e => !e.result);
  const completed = experiments.filter(e => e.result);

  if (active.length === 0 && completed.length === 0) return "no changes";
  if (active.length > 0) return `gen ${gen}, ${active.length} active experiment(s)`;
  return `gen ${gen}, ${completed.length} completed`;
}

// ── 4. Orchestrator loop log ─────────────────────────────────────────

function parseOrchestratorLog() {
  const logPath = resolve(ROOT, ".logs/orchestrator-loop.log");
  if (!existsSync(logPath)) return null;

  // Check if log was modified today
  const mtime = statSync(logPath).mtime;
  const logDate = mtime.toLocaleDateString("en-CA", { timeZone: "America/Edmonton" });

  try {
    // Count lines with today's date and extract action types
    const grepCmd = `grep -c "${TODAY}" "${logPath}" 2>/dev/null || echo 0`;
    const totalLines = parseInt(execSync(grepCmd, { encoding: "utf-8" }).trim(), 10);

    // Count action types from log
    const actionCmd = `grep "${TODAY}" "${logPath}" 2>/dev/null | grep -oE '"action":"[^"]+"' | sort | uniq -c | sort -rn | head -10`;
    let actions = {};
    try {
      const actionOutput = execSync(actionCmd, { encoding: "utf-8" }).trim();
      for (const line of actionOutput.split("\n").filter(Boolean)) {
        const m = line.trim().match(/(\d+)\s+"action":"(.+)"/);
        if (m) actions[m[2]] = parseInt(m[1]);
      }
    } catch {}

    // Also try counting cycle numbers
    let cycles = 0;
    try {
      const cycleCmd = `grep "${TODAY}" "${logPath}" 2>/dev/null | grep -oE 'cycle\\s*\\d+' | tail -1`;
      const lastCycle = execSync(cycleCmd, { encoding: "utf-8" }).trim();
      const cm = lastCycle.match(/cycle\s*(\d+)/);
      if (cm) cycles = parseInt(cm[1]);
    } catch {}

    return { totalLines, actions, cycles, logDate };
  } catch {
    return null;
  }
}

// ── 5. Content bot ───────────────────────────────────────────────────

function parseContentBot() {
  const lastRun = jsonSafe(resolve(ROOT, ".data/content-bot-last-run.json"));
  const draftsDir = resolve(ROOT, ".data/draft-quality");
  let draftsToday = 0;

  if (existsSync(draftsDir)) {
    try {
      const files = execSync(`find "${draftsDir}" -name "*.json" -newer "${resolve(ROOT, `.data/observations/${TODAY}.md`)}" 2>/dev/null | wc -l`, { encoding: "utf-8" });
      draftsToday = parseInt(files.trim(), 10) || 0;
    } catch {}
  }

  const posts = lastRun?.posts || 0;
  const ranAt = lastRun?.ran_at;
  const ranToday = ranAt && ranAt.startsWith(TODAY);

  return { draftsToday, postsPublished: ranToday ? posts : 0 };
}

// ── 6. Pipeline (leads) ─────────────────────────────────────────────

function parsePipeline(db) {
  const newToday = s1(db, `SELECT COUNT(*) as n FROM leads WHERE date(created_at) = date('now')`).n || 0;
  const sentToday = s1(db, `SELECT COUNT(*) as n FROM outreach_emails WHERE date(sent_at) = date('now') AND status IN ('sent','replied')`).n || 0;
  const repliesToday = s1(db, `SELECT COUNT(*) as n FROM outreach_emails WHERE date(reply_received_at) = date('now')`).n || 0;
  const totalLeads = s1(db, `SELECT COUNT(*) as n FROM leads`).n || 0;
  const meaningfulAll = s1(db, `SELECT COUNT(*) as n FROM outreach_emails WHERE is_meaningful_reply=1`).n || 0;

  return { newToday, sentToday, repliesToday, totalLeads, meaningfulAll };
}

// ── 7. Issues detection ──────────────────────────────────────────────

function detectIssues(db, pipeline, awareness, content) {
  const issues = [];

  // Check for broken bots (stale heartbeats)
  try {
    const stale = db.prepare(`
      SELECT bot_name, health_status, error FROM bot_heartbeats
      WHERE health_status IN ('error','degraded')
        AND pinged_at > datetime('now', '-24 hours')
    `).all();
    for (const s of stale) {
      issues.push(`${s.bot_name}: ${s.error || s.health_status}`);
    }
  } catch {}

  // Pipeline concern: lots of leads but no replies
  if (pipeline.newToday > 50 && pipeline.repliesToday === 0) {
    issues.push(`${pipeline.newToday} new leads but 0 replies - outreach not converting`);
  }

  // Check content bot log for errors
  const contentLog = resolve(ROOT, ".logs/content-bot.log");
  if (existsSync(contentLog)) {
    try {
      const errors = execSync(`tail -50 "${contentLog}" 2>/dev/null | grep -i "error\\|quota\\|fail" | tail -3`, { encoding: "utf-8" }).trim();
      for (const line of errors.split("\n").filter(Boolean)) {
        const short = line.replace(/^.*?(?:error|Error|ERROR)/i, "").slice(0, 80).trim();
        if (short) issues.push(`ContentBot: ${short}`);
      }
    } catch {}
  }

  return issues;
}

// ── MAIN ─────────────────────────────────────────────────────────────

async function main() {
  const db = getDb();
  db.pragma("journal_mode = WAL");

  const awareness = parseAwareness();
  const observations = parseObservations();
  const evolution = parseEvolution();
  const orcLog = parseOrchestratorLog();
  const content = parseContentBot();
  const pipeline = parsePipeline(db);
  const issues = detectIssues(db, pipeline, awareness, content);

  // ── Build message ────────────────────────────────────────────────
  const L = [];

  L.push(`<b>Daily Learning Report - ${DATE_LABEL}</b>`);
  L.push("");

  // Awareness
  const awNote = awareness.date && !awareness.date.startsWith(TODAY) ? " (stale)" : "";
  L.push(`<b>Awareness:</b> ${awareness.accepted} actionable, ${awareness.flagged} flagged${awNote}`);
  for (const item of awareness.items.slice(0, 4)) {
    L.push(`- [${item.type}] ${escHtml(item.title)}`);
  }
  L.push("");

  // Pipeline
  L.push(`<b>Pipeline:</b> +${pipeline.newToday} leads, ${pipeline.sentToday} sent, ${pipeline.repliesToday} replies`);
  L.push(`  Total: ${pipeline.totalLeads} leads, ${pipeline.meaningfulAll} meaningful replies`);

  // Content
  L.push(`<b>Content:</b> ${content.draftsToday} draft(s), ${content.postsPublished} published`);

  // Orchestrator
  if (orcLog) {
    const actionSummary = Object.entries(orcLog.actions)
      .slice(0, 5)
      .map(([k, v]) => `${v} ${k}`)
      .join(", ");
    const cycleNote = orcLog.cycles > 0 ? `${orcLog.cycles} cycles` : `${orcLog.totalLines} log lines`;
    L.push(`<b>Orchestrator:</b> ${cycleNote}${actionSummary ? ` (${actionSummary})` : ""}`);
  } else {
    L.push(`<b>Orchestrator:</b> no log data`);
  }

  // Evolution
  L.push(`<b>Evolution:</b> ${evolution}`);

  // Observations hypotheses
  if (observations && observations.hypotheses > 0) {
    L.push(`<b>Hypotheses:</b> ${observations.hypotheses} pattern(s) identified`);
  }

  // Issues
  if (issues.length > 0) {
    L.push("");
    L.push(`<b>Issues found:</b>`);
    for (const issue of issues.slice(0, 5)) {
      L.push(`- ${escHtml(issue)}`);
    }
  }

  const msg = L.join("\n");
  console.log(msg.replace(/<[^>]+>/g, "")); // plain text to stdout

  await tgSendToKirill(msg);

  // Heartbeat
  heartbeat(db, "daily-learning-report", "DailyLearningReport", `Report sent: ${DATE_LABEL}`, {
    awareness_accepted: awareness.accepted,
    awareness_flagged: awareness.flagged,
    pipeline_new: pipeline.newToday,
    pipeline_sent: pipeline.sentToday,
    issues: issues.length,
  }, { status: "ok", last_success_at: new Date().toISOString(), error: null });

  db.close();
  console.log("Daily learning report sent.");
}

function escHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

main().catch(err => {
  console.error("daily-learning-report FATAL:", err);
  process.exit(1);
});
