/**
 * wave-pipeline.mjs — THE orchestrator that replaced cron chaos
 *
 * Instead of 27 bots on independent cron schedules, this runs them
 * in WAVES where each wave depends on the previous one completing.
 *
 * Wave 1: DISCOVER  (parallel) → scouts find leads
 * Wave 2: ENRICH    (depends on wave 1) → classify and score leads
 * Wave 3: DRAFT     (depends on wave 2) → create outreach drafts
 * Wave 4: DISPATCH  (depends on wave 3) → send drafts to Telegram
 * Wave 5: LEARN     (depends on all) → update wiki, evolve, report
 *
 * After wave 5: System Brain THINKS via GPT-5.4 and decides:
 * - Run another cycle?
 * - Change focus?
 * - Pause something?
 * - Start an experiment?
 *
 * This file replaces sonnet-bots-daemon.mjs as the primary scheduler.
 *
 * Run: nohup node scripts/factory/wave-pipeline.mjs > /tmp/lbo-wave-pipeline.log 2>&1 &
 */
import { execSync, spawn } from "child_process";
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readPurpose, readWiki, updatePage, appendLog, getWikiContext } from "../../wiki/reader.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const NODE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/node";
const STATE_FILE = resolve(ROOT, "wiki/STATE.md");
const LOG_FILE = "/tmp/lbo-wave-pipeline.log";
const PID_FILE = resolve(ROOT, ".data/wave-pipeline.pid");

const env = Object.fromEntries(
  readFileSync(resolve(ROOT, "apps/api/.env"), "utf-8").split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const TG = env.TELEGRAM_BOT_TOKEN, CHAT = env.TELEGRAM_CHAT_ID;

function log(msg) {
  const line = `${new Date().toISOString()} [wave] ${msg}`;
  console.log(line);
  try { appendFileSync(LOG_FILE, line + "\n"); } catch {}
}

async function tg(text) {
  if (!TG || !CHAT) return;
  await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT, text: text.slice(0, 4096), parse_mode: "HTML", disable_web_page_preview: true }),
  }).catch(() => {});
}

// ── Run a bot and WAIT for it to finish. Returns { ok, output, elapsed } ─────
function runBot(name, args = [], timeoutSec = 300) {
  const start = Date.now();
  log(`  → ${name} ${args.join(" ")} (max ${timeoutSec}s)`);
  try {
    const result = execSync(
      `${NODE_BIN} ${ROOT}/scripts/factory/${name}.mjs ${args.join(" ")} 2>&1`,
      { encoding: "utf-8", timeout: timeoutSec * 1000, cwd: ROOT, maxBuffer: 10 * 1024 * 1024 }
    );
    const elapsed = ((Date.now() - start) / 1000).toFixed(0);
    // Extract key metrics from output
    const lastLine = result.trim().split("\n").pop() || "";
    log(`  ✓ ${name} done (${elapsed}s) ${lastLine.slice(0, 100)}`);
    return { ok: true, output: result, elapsed: +elapsed, lastLine };
  } catch (e) {
    const elapsed = ((Date.now() - start) / 1000).toFixed(0);
    const msg = e.stderr?.slice(0, 200) || e.message?.slice(0, 200) || "unknown error";
    log(`  ✗ ${name} FAILED (${elapsed}s): ${msg}`);
    return { ok: false, output: msg, elapsed: +elapsed, lastLine: msg };
  }
}

// ── Run multiple bots in parallel, wait for ALL to finish ────────────────────
async function runParallel(bots, timeoutSec = 300) {
  return Promise.all(bots.map(([name, args]) =>
    new Promise(resolve => {
      const result = runBot(name, args || [], timeoutSec);
      resolve({ name, ...result });
    })
  ));
}

// ── STATE.md — single file that captures current system state ────────────────
function writeState(wave, results, achievements) {
  const now = new Date().toISOString();
  const state = `# System State

Last updated: ${now}
Current wave: ${wave}

## Pipeline Position
- Leads total: ${achievements.leadsNew || "?"}
- Unenriched: ${achievements.unenriched || "?"}
- Warming: ${achievements.warming || "?"}
- Drafts dispatched today: ${achievements.draftsToday || "?"}
- Emails sent: ${achievements.emailsSent || "?"}
- Revenue: $${achievements.revenue || 0}

## Last Wave Results
${results.map(r => `- ${r.ok ? "✓" : "✗"} ${r.name} (${r.elapsed}s) ${r.lastLine?.slice(0, 80) || ""}`).join("\n")}

## Blockers
${achievements.blockers?.join("\n") || "None detected"}

## Related
- [[PURPOSE]] — system purpose
- [[directives]] — current brain directives
- [[health]] — bot health
`;
  writeFileSync(STATE_FILE, state);
}

async function getAchievements() {
  try {
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(resolve(ROOT, ".data/linkedin-brand-os.sqlite"), { readonly: true });
    const a = {};
    a.leadsNew = db.prepare("SELECT COUNT(*) as c FROM leads WHERE stage='new'").get()?.c || 0;
    a.unenriched = db.prepare("SELECT COUNT(*) as c FROM leads WHERE stage='new' AND id NOT IN (SELECT lead_id FROM lead_enrichment)").get()?.c || 0;
    a.warming = db.prepare("SELECT COUNT(*) as c FROM lead_enrichment WHERE classification IN ('warming','ready_buyer')").get()?.c || 0;
    a.emailsSent = db.prepare("SELECT COUNT(*) as c FROM outreach_emails WHERE status='sent'").get()?.c || 0;
    a.revenue = db.prepare("SELECT current_amount FROM goals WHERE status='active' LIMIT 1").get()?.current_amount || 0;
    const today = new Date().toISOString().slice(0, 10);
    a.draftsToday = db.prepare("SELECT COUNT(*) as c FROM bot_intelligence WHERE bot_id='icp-outreach' AND insight_type='dispatched' AND date(updated_at)=?").get(today)?.c || 0;
    a.blockers = [];
    if (a.unenriched > 500) a.blockers.push(`${a.unenriched} unenriched leads backlog`);
    if (a.warming === 0) a.blockers.push("0 warming leads - enrichment not finding buyers");
    if (a.revenue === 0) a.blockers.push("$0 revenue - need first client");
    db.close();
    return a;
  } catch (e) {
    log(`achievements error: ${e.message}`);
    return { leadsNew: "?", unenriched: "?", warming: "?", emailsSent: "?", revenue: 0, draftsToday: 0, blockers: [e.message] };
  }
}

// ── WAVES ────────────────────────────────────────────────────────────────────

async function runCycle(cycleNum) {
  log(`\n${"=".repeat(60)}`);
  log(`CYCLE ${cycleNum} START`);
  log(`${"=".repeat(60)}`);

  const cycleStart = Date.now();
  const allResults = [];
  let achievements = await getAchievements();

  // Check if scouts should be paused (backlog too large)
  const scoutsPaused = achievements.unenriched > 500;

  const hour = new Date().getUTCHours();

  // ── WAVE 1: DISCOVER — find leads, scan channels, research ────────
  log(`\n── WAVE 1: DISCOVER ${scoutsPaused ? "(scouts paused)" : ""} ──`);
  if (!scoutsPaused) {
    allResults.push({ name: "fresh-pain-scout", ...runBot("fresh-pain-scout", [], 120) });
    allResults.push({ name: "buying-signal-hunt", ...runBot("buying-signal-hunt", [], 120) });
  } else {
    log("  (scouts paused - backlog > 500)");
  }
  // These always run - they find ideas and intelligence, not just leads
  allResults.push({ name: "research-bot-v2", ...runBot("research-bot-v2", ["--batch"], 300) });
  allResults.push({ name: "awareness-bot", ...runBot("awareness-bot", [], 120) });
  allResults.push({ name: "reddit-monitor", ...runBot("reddit-monitor", [], 120) });
  if (hour >= 14 || hour <= 4) { // LinkedIn during business hours
    allResults.push({ name: "linkedin-deep-analyzer", ...runBot("linkedin-deep-analyzer", [], 180) });
  }

  // ── WAVE 2: ENRICH + ANALYZE — process what was found ─────────────
  log(`\n── WAVE 2: ENRICH + ANALYZE ──`);
  allResults.push({ name: "lead-enrichment-bot", ...runBot("lead-enrichment-bot", ["--batch"], 600) });
  allResults.push({ name: "pipeline-bridge", ...runBot("pipeline-bridge", [], 30) });
  achievements = await getAchievements();

  // ── WAVE 3: THINK — generate ideas, test hypotheses, compete ──────
  log(`\n── WAVE 3: THINK ──`);
  allResults.push({ name: "idea-bot", ...runBot("idea-bot", [], 300) });
  allResults.push({ name: "competitor-agent", ...runBot("competitor-agent", [], 120) });
  allResults.push({ name: "community-bot", ...runBot("community-bot", [], 120) });

  // ── WAVE 4: ACT — draft messages, create content, sell ────────────
  log(`\n── WAVE 4: ACT ──`);
  if (achievements.warming > 0) {
    allResults.push({ name: "icp-outreach-bot", ...runBot("icp-outreach-bot", [], 600) });
  }
  if (hour >= 14 || hour <= 2) {
    allResults.push({ name: "calgary-email-outreach", ...runBot("calgary-email-outreach", [], 300) });
  }
  allResults.push({ name: "sales-bot", ...runBot("sales-bot", [], 120) });
  allResults.push({ name: "content-bot", ...runBot("content-bot", [], 180) });
  allResults.push({ name: "content-curator-bot", ...runBot("content-curator-bot", [], 300) });
  allResults.push({ name: "site-curator-bot", ...runBot("site-curator-bot", [], 120) });

  // ── WAVE 5: BUILD — execute projects, build MVPs ──────────────────
  log(`\n── WAVE 5: BUILD ──`);
  allResults.push({ name: "build-bot", ...runBot("build-bot", [], 120) });
  allResults.push({ name: "builder-bot", ...runBot("builder-bot", [], 180) });
  allResults.push({ name: "project-executor", ...runBot("project-executor", ["tick"], 120) });

  // ── WAVE 6: MONITOR — watch replies, track results ────────────────
  log(`\n── WAVE 6: MONITOR ──`);
  // monitor-replies is in scripts/outreach/, not scripts/factory/
const mrResult = (() => {
  try {
    const r = execSync(`${NODE_BIN} ${ROOT}/scripts/outreach/monitor-replies.mjs 2>&1`, { encoding: "utf-8", timeout: 120000, cwd: ROOT });
    return { ok: true, output: r, elapsed: 0, lastLine: r.trim().split("\n").pop() || "" };
  } catch (e) { return { ok: false, output: e.message, elapsed: 0, lastLine: e.message?.slice(0, 80) }; }
})();
allResults.push({ name: "monitor-replies", ...mrResult });
  allResults.push({ name: "telegram-sales-agent", ...runBot("telegram-sales-agent", [], 300) });

  // ── WAVE 7: LEARN — evolve, report, update brain ──────────────────
  log(`\n── WAVE 7: LEARN ──`);
  allResults.push({ name: "evolution-bot", ...runBot("evolution-bot", [], 180) });
  allResults.push({ name: "analytics-bot", ...runBot("analytics-bot", [], 120) });
  allResults.push({ name: "daily-heartbeat-report", ...runBot("daily-heartbeat-report", [], 60) });
  allResults.push({ name: "system-brain", ...runBot("system-brain", [], 120) });
  allResults.push({ name: "brief-agent", ...runBot("brief-agent", [], 120) });

  // Final state
  achievements = await getAchievements();
  writeState("completed", allResults, achievements);

  // ── AUTO-CAPTURE: Write every bot's result to wiki ──────────────
  for (const r of allResults) {
    if (!r.lastLine || r.lastLine === "PAUSED - backlog") continue;
    const summary = r.lastLine.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s*/, "").slice(0, 150);
    if (summary.length > 10) {
      appendLog("bot", `${r.name}: ${r.ok ? "✓" : "✗"} ${summary}`);
    }
  }

  // ── AUTO-UPDATE wiki pages based on results ───────────────────
  try {
    // Update hot-prospects if enrichment found new warming
    const warmingNow = achievements.warming || 0;
    // Update experiments if emails were sent
    // Update patterns if enrichment produced insights
    // These will be done by system-brain in Wave 7 using GPT analysis
  } catch {}

  const cycleElapsed = ((Date.now() - cycleStart) / 1000 / 60).toFixed(1);
  const okCount = allResults.filter(r => r.ok).length;
  const failCount = allResults.filter(r => !r.ok).length;

  log(`\n${"=".repeat(60)}`);
  log(`CYCLE ${cycleNum} END — ${cycleElapsed}min, ${okCount} ok, ${failCount} failed`);
  log(`STATE: warming=${achievements.warming}, drafts_today=${achievements.draftsToday}, revenue=$${achievements.revenue}`);
  log(`${"=".repeat(60)}\n`);

  appendLog("cycle", `Wave cycle ${cycleNum}: ${okCount} ok, ${failCount} failed, ${cycleElapsed}min. Warming=${achievements.warming}, drafts=${achievements.draftsToday}`);

  return { achievements, allResults, cycleElapsed };
}

// ── MAIN LOOP ────────────────────────────────────────────────────────────────

async function main() {
  // PID file
  if (existsSync(PID_FILE)) {
    const oldPid = parseInt(readFileSync(PID_FILE, "utf-8"));
    try { process.kill(oldPid, 0); log(`another instance running PID ${oldPid}, exiting`); process.exit(1); }
    catch { log(`stale PID file (${oldPid} dead), removing`); }
  }
  writeFileSync(PID_FILE, String(process.pid));
  process.on("exit", () => { try { execSync(`rm -f "${PID_FILE}"`); } catch {} });
  process.on("SIGTERM", () => process.exit(0));
  process.on("SIGINT", () => process.exit(0));

  log(`Wave Pipeline started PID ${process.pid}`);
  log(`PURPOSE loaded (${readPurpose().length} bytes)`);
  await tg(`⚡ <b>Wave Pipeline started</b>\nPID ${process.pid}\nCycles run continuously with 30min pause between.`);

  let cycle = 0;
  while (true) {
    cycle++;
    try {
      const { achievements } = await runCycle(cycle);

      // Decide pause duration based on tempo
      const directives = readWiki("directives.md");
      let pauseMin = 30; // default
      if (directives.includes("Tempo: fast")) pauseMin = 15;
      if (directives.includes("Tempo: slow")) pauseMin = 60;

      // Night mode (00:00-06:00 Calgary = 06:00-12:00 UTC) - slower
      const utcHour = new Date().getUTCHours();
      if (utcHour >= 6 && utcHour < 12) pauseMin = Math.max(pauseMin, 45);

      log(`Next cycle in ${pauseMin}min (tempo from directives)`);
      await new Promise(r => setTimeout(r, pauseMin * 60 * 1000));
    } catch (e) {
      log(`CYCLE ${cycle} CRASHED: ${e.message}`);
      await tg(`🚨 Wave Pipeline cycle ${cycle} crashed: ${e.message}`);
      await new Promise(r => setTimeout(r, 5 * 60 * 1000)); // wait 5min and retry
    }
  }
}

main().catch(e => {
  log(`FATAL: ${e.message}`);
  tg(`🚨 Wave Pipeline FATAL: ${e.message}`).catch(() => {});
  process.exit(1);
});
