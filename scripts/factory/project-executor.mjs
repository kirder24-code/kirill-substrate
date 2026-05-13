/**
 * project-executor.mjs - Unified orchestration layer. v1.
 *
 * v1 adds over v0:
 *   - BOT_REGISTRY: 27 factory bots wired to orchestrator
 *   - run_bot step type: dispatch any registered bot as a project step
 *   - Dependency graph: steps declare depends_on:[seq,...] - blocked until deps are done
 *   - Priority queue: projects tick in priority order (0-10, higher first)
 *   - Budget state machine: daily AI spend cap, tier-gated execution (critical|high|normal|low)
 *   - parallel_group: steps in same group run within one tick
 *   - State machine: pending -> ready/blocked -> running -> done/failed/skipped
 *
 * Step types (v1):
 *   dispatch_telegram | run_command | write_file | sql_select |
 *   await_human | verify_post_date | execute_hands | run_bot |
 *   analyze_niche_financial
 *
 * CLI:
 *   node scripts/factory/project-executor.mjs tick
 *   node scripts/factory/project-executor.mjs load <plan.json>
 *   node scripts/factory/project-executor.mjs status
 *   node scripts/factory/project-executor.mjs resume <project_id>
 *   node scripts/factory/project-executor.mjs list-bots
 *   node scripts/factory/project-executor.mjs run-bot <name> [args...]
 *   node scripts/factory/project-executor.mjs budget
 *
 * Cron: every 15 min
 */

import Database from "better-sqlite3";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { randomUUID } from "crypto";
import { readPurpose, appendLog } from "../../wiki/reader.mjs";
import { executeHands } from "../cortex/hands.mjs";
import { addBelief } from "../../wiki/brain/reader.mjs";

const _purpose = readPurpose();
const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");
const DB_PATH = resolve(PROJECT_ROOT, ".data/linkedin-brand-os.sqlite");
const ENV_PATH = resolve(PROJECT_ROOT, "apps/api/.env");

const env = Object.fromEntries(
  readFileSync(ENV_PATH, "utf-8").split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const TG = env.TELEGRAM_BOT_TOKEN;
const CHAT = env.TELEGRAM_CHAT_ID;
// Daily AI cost cap in USD. Override via env EXECUTOR_BUDGET_CAP.
const DAILY_BUDGET_CAP = parseFloat(env.EXECUTOR_BUDGET_CAP || "5.00");

const db = new Database(DB_PATH);

// ─── Schema v1 ───────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS executor_projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    goal TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    -- pending | running | paused | completed | failed
    priority INTEGER NOT NULL DEFAULT 5,
    -- 0-10: higher = runs first in tick. 10=critical, 7=high, 5=normal, 2=low
    pause_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS executor_steps (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    description TEXT NOT NULL,
    type TEXT NOT NULL,
    -- dispatch_telegram | run_command | write_file | sql_select | await_human
    -- verify_post_date | execute_hands | run_bot | analyze_niche_financial
    params_json TEXT,
    depends_on_json TEXT,
    -- JSON array of seq numbers that must be 'done' before this step runs
    parallel_group TEXT,
    -- steps sharing a group string run in the same tick (logically parallel)
    budget_tier TEXT NOT NULL DEFAULT 'normal',
    -- critical | high | normal | low - gates execution against daily budget
    status TEXT NOT NULL DEFAULT 'pending',
    -- pending | running | done | failed | skipped
    result TEXT,
    started_at TEXT,
    completed_at TEXT,
    FOREIGN KEY (project_id) REFERENCES executor_projects(id)
  );

  CREATE INDEX IF NOT EXISTS idx_executor_steps_project ON executor_steps(project_id, seq);

  CREATE TABLE IF NOT EXISTS executor_budget (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    -- YYYY-MM-DD
    bot_name TEXT,
    calls INTEGER NOT NULL DEFAULT 0,
    tokens_est INTEGER NOT NULL DEFAULT 0,
    usd_est REAL NOT NULL DEFAULT 0,
    recorded_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_executor_budget_date ON executor_budget(date);
`);

// Schema migration: add columns to existing tables if absent
try {
  db.exec(`ALTER TABLE executor_projects ADD COLUMN priority INTEGER NOT NULL DEFAULT 5`);
} catch {}
try {
  db.exec(`ALTER TABLE executor_steps ADD COLUMN depends_on_json TEXT`);
} catch {}
try {
  db.exec(`ALTER TABLE executor_steps ADD COLUMN parallel_group TEXT`);
} catch {}
try {
  db.exec(`ALTER TABLE executor_steps ADD COLUMN budget_tier TEXT NOT NULL DEFAULT 'normal'`);
} catch {}

const NOW = () => new Date().toISOString();
const TODAY = () => new Date().toISOString().slice(0, 10);

// ─── Bot registry ─────────────────────────────────────────────────────────────
// 27 factory bots wired to orchestrator. Keys are canonical bot names.
export const BOT_REGISTRY = {
  scout:            { script: "scripts/factory/scout-bot.mjs",            label: "ScoutBot - find pain signals across Reddit/Brave/HN" },
  sales:            { script: "scripts/factory/sales-bot.mjs",            label: "SalesBot - lead pipeline + follow-up" },
  content:          { script: "scripts/factory/content-bot.mjs",          label: "ContentBot - LinkedIn post generation" },
  analytics:        { script: "scripts/factory/analytics-bot.mjs",        label: "AnalyticsBot - KPI reporting" },
  build:            { script: "scripts/factory/build-bot.mjs",            label: "BuildBot - project delivery ops" },
  community:        { script: "scripts/factory/community-bot.mjs",        label: "CommunityBot - comment engagement" },
  awareness:        { script: "scripts/factory/awareness-bot.mjs",        label: "AwarenessBot - market signal watch" },
  brief:            { script: "scripts/factory/brief-agent.mjs",          label: "BriefAgent - project brief + planning" },
  competitor:       { script: "scripts/factory/competitor-agent.mjs",     label: "CompetitorAgent - competitor intel" },
  evolution:        { script: "scripts/factory/evolution-bot.mjs",        label: "EvolutionBot - system upgrade proposals" },
  idea:             { script: "scripts/factory/idea-bot.mjs",             label: "IdeaBot - opportunity generation" },
  reddit_monitor:   { script: "scripts/factory/reddit-monitor.mjs",       label: "RedditMonitor - comment thread watch" },
  daily_obs:        { script: "scripts/factory/daily-observations.mjs",   label: "DailyObservations - intel digest" },
  enrichment:       { script: "scripts/factory/lead-enrichment-bot.mjs",  label: "LeadEnrichment - ICP classification" },
  draft_quality:    { script: "scripts/factory/draft-quality-checker.mjs",label: "DraftQuality - AI-tell detection gate" },
  reply_classifier: { script: "scripts/factory/reply-classifier.mjs",     label: "ReplyClassifier - intent detection" },
  dispatch_reddit:  { script: "scripts/factory/dispatch-reddit-drafts.mjs",label: "DispatchReddit - send Reddit drafts" },
  content_curator:  { script: "scripts/factory/content-curator-bot.mjs",  label: "ContentCurator - feed curation" },
  site_curator:     { script: "scripts/factory/site-curator-bot.mjs",     label: "SiteCurator - website scrape" },
  fresh_pain:       { script: "scripts/factory/fresh-pain-scout.mjs",     label: "FreshPain - fresh pain signal hunt" },
  buying_signal:    { script: "scripts/factory/buying-signal-hunt.mjs",   label: "BuyingSignal - purchase intent detection" },
  icp_outreach:     { script: "scripts/factory/icp-outreach-bot.mjs",     label: "ICPOutreach - targeted outreach" },
  pipeline_bridge:  { script: "scripts/factory/pipeline-bridge.mjs",      label: "PipelineBridge - cross-system data sync" },
  cron_watchdog:    { script: "scripts/factory/cron-watchdog.mjs",        label: "CronWatchdog - health monitor" },
  system_brain:     { script: "scripts/factory/system-brain.mjs",         label: "SystemBrain - strategy analysis" },
  wave_pipeline:    { script: "scripts/factory/wave-pipeline.mjs",        label: "WavePipeline - bulk outreach waves" },
  telegram_sales:   { script: "scripts/factory/telegram-sales-agent.mjs", label: "TelegramSales - Kirill ops interface" },
  financial_analysis: { script: "scripts/factory/financial-analysis-bot.mjs", label: "FinancialAnalysis - TAM/SAM/SOM + profitability score" },
};

// ─── Budget helpers ───────────────────────────────────────────────────────────
function getDailyBudgetUsed() {
  const row = db.prepare(`
    SELECT COALESCE(SUM(usd_est), 0) as total FROM executor_budget WHERE date = ?
  `).get(TODAY());
  return row ? row.total : 0;
}

function recordBudget(botName, calls, usd) {
  db.prepare(`
    INSERT INTO executor_budget (id, date, bot_name, calls, usd_est, recorded_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), TODAY(), botName || "unknown", calls, usd, NOW());
}

// Budget tiers: how much of the daily cap each tier can consume.
// critical = always runs; high = ok up to 90% cap; normal = ok up to 70%; low = ok up to 40%
const BUDGET_TIER_THRESHOLDS = {
  critical: Infinity,
  high: 0.90,
  normal: 0.70,
  low: 0.40,
};

function isBudgetOk(tier) {
  const used = getDailyBudgetUsed();
  const ratio = used / DAILY_BUDGET_CAP;
  const threshold = BUDGET_TIER_THRESHOLDS[tier] || 0.70;
  return ratio < threshold;
}

// ─── Dependency graph helpers ─────────────────────────────────────────────────
// Returns true if all steps listed in step.depends_on_json are in status='done'.
function isStepReady(projectId, step) {
  let deps = [];
  try { deps = JSON.parse(step.depends_on_json || "[]"); } catch {}
  if (!Array.isArray(deps) || deps.length === 0) return true;

  for (const depSeq of deps) {
    const depStep = db.prepare(`
      SELECT status FROM executor_steps WHERE project_id = ? AND seq = ?
    `).get(projectId, depSeq);
    if (!depStep || depStep.status !== "done") return false;
  }
  return true;
}

// ─── Telegram helper ──────────────────────────────────────────────────────────
async function tgSend(text, replyMarkup) {
  if (!TG || !CHAT) return null;
  try {
    const body = { chat_id: CHAT, text, parse_mode: "HTML", disable_web_page_preview: true };
    if (replyMarkup) body.reply_markup = replyMarkup;
    const r = await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    return await r.json();
  } catch (e) {
    console.error("[executor] telegram failed:", e.message);
    return null;
  }
}

// ─── Step executors ───────────────────────────────────────────────────────────
async function execDispatchTelegram(params) {
  const { message, reply_markup } = params;
  const r = await tgSend(message, reply_markup);
  if (r && r.ok) return { status: "done", result: `tg msg_id=${r.result?.message_id ?? "?"}` };
  return { status: "failed", result: `telegram send failed: ${JSON.stringify(r)}` };
}

async function execRunCommand(params) {
  const { cmd, cwd } = params;
  const FORBIDDEN = /\brm\s+-[rf]{2}|\bsudo|\bdd\s+if=|>\s*\/dev\/|chmod\s+777|drop\s+table|delete\s+from/i;
  if (FORBIDDEN.test(cmd)) {
    return { status: "failed", result: `forbidden command pattern: ${cmd.slice(0, 100)}` };
  }
  try {
    const r = spawnSync(cmd, [], {
      shell: true,
      cwd: cwd || PROJECT_ROOT,
      encoding: "utf-8",
      timeout: 5 * 60 * 1000,
      maxBuffer: 10 * 1024 * 1024,
    });
    const output = (r.stdout || "") + (r.stderr || "");
    if (r.status === 0) {
      return { status: "done", result: output.slice(0, 5000) };
    }
    return { status: "failed", result: `exit ${r.status}: ${output.slice(0, 5000)}` };
  } catch (e) {
    return { status: "failed", result: `spawn error: ${e.message}` };
  }
}

async function execWriteFile(params) {
  const { path, content } = params;
  const ALLOWED = /^(sandbox-review|\.data|\.logs|\/tmp)\//;
  const ABSOLUTE_ALLOWED = /^\/tmp\//;
  const isRelative = !path.startsWith("/");
  if (isRelative && !ALLOWED.test(path)) {
    return { status: "failed", result: `forbidden write path: ${path}` };
  }
  if (!isRelative && !ABSOLUTE_ALLOWED.test(path)) {
    return { status: "failed", result: `forbidden absolute write path: ${path}` };
  }
  try {
    const fullPath = isRelative ? resolve(PROJECT_ROOT, path) : path;
    const dir = dirname(fullPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(fullPath, content);
    return { status: "done", result: `wrote ${content.length} bytes to ${path}` };
  } catch (e) {
    return { status: "failed", result: `write error: ${e.message}` };
  }
}

async function execSqlSelect(params) {
  const { query } = params;
  if (!/^\s*SELECT\b/i.test(query)) {
    return { status: "failed", result: `only SELECT allowed: ${query.slice(0, 100)}` };
  }
  if (/;\s*\w/.test(query)) {
    return { status: "failed", result: "multiple statements not allowed" };
  }
  try {
    const rows = db.prepare(query).all();
    return { status: "done", result: JSON.stringify(rows).slice(0, 5000) };
  } catch (e) {
    return { status: "failed", result: `sql error: ${e.message}` };
  }
}

async function execAwaitHuman(params, project) {
  const { question } = params;
  await tgSend(`<b>Paused: ${project.name}</b>\n\n${question}\n\n<i>Resume: node scripts/factory/project-executor.mjs resume ${project.id}</i>`);
  return { status: "skipped", result: "awaiting human" };
}

async function execVerifyPostDate(params) {
  const { url, max_age_days } = params;
  if (!url || !max_age_days) {
    return { status: "failed", result: "verify_post_date requires url + max_age_days" };
  }
  try {
    let postDate = null;
    const UA = "Mozilla/5.0 (Macintosh) AppleWebKit/537.36";

    if (/reddit\.com\/r\//.test(url)) {
      const cleanUrl = url.replace(/\/$/, "") + ".json";
      const r = await fetch(cleanUrl, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) return { status: "failed", result: `reddit fetch ${r.status}` };
      const data = await r.json();
      const ts = data?.[0]?.data?.children?.[0]?.data?.created_utc;
      if (!ts) return { status: "failed", result: "no created_utc in reddit response" };
      postDate = new Date(ts * 1000);
    } else if (/news\.ycombinator\.com\/item\?id=(\d+)/.test(url)) {
      const m = url.match(/id=(\d+)/);
      const r = await fetch(`https://hn.algolia.com/api/v1/items/${m[1]}`, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) return { status: "failed", result: `hn fetch ${r.status}` };
      const data = await r.json();
      if (!data.created_at) return { status: "failed", result: "no created_at in hn response" };
      postDate = new Date(data.created_at);
    } else {
      return { status: "failed", result: `unsupported url for verify_post_date: ${url}` };
    }

    const ageDays = Math.floor((Date.now() - postDate.getTime()) / 86400000);
    const isoDate = postDate.toISOString().slice(0, 10);

    if (ageDays > max_age_days) {
      return { status: "failed", result: `post too old: ${isoDate} (${ageDays} days, max ${max_age_days})` };
    }
    return { status: "done", result: `post fresh: ${isoDate} (${ageDays} days, max ${max_age_days})` };
  } catch (e) {
    return { status: "failed", result: `verify error: ${e.message}` };
  }
}

async function execExecuteHands(params) {
  const { task, type, files, context } = params;
  if (!task) return { status: "failed", result: "execute_hands requires params.task" };
  try {
    const handsResult = await executeHands({
      description: task,
      type: type || "code_edit",
      files: files || [],
      context: context || "",
      origin: "project-executor",
    });
    if (handsResult.success) {
      return {
        status: "done",
        result: `hands ok: ${handsResult.filesChanged.join(", ") || "no file changes"} | ${(handsResult.output || "").slice(0, 300)}`,
      };
    }
    return { status: "failed", result: `hands failed: ${handsResult.error || "unknown"} | ${(handsResult.output || "").slice(0, 200)}` };
  } catch (e) {
    return { status: "failed", result: `execute_hands exception: ${e.message}` };
  }
}

// run_bot - spawn a registered bot as a subprocess.
// params: { bot: "scout", args: ["--limit","20"], usd_est: 0.05 }
// bot must be a key in BOT_REGISTRY.
// usd_est is recorded to the budget ledger (default 0.02 per run).
async function execRunBot(params) {
  const { bot, args, usd_est } = params;
  if (!bot) return { status: "failed", result: "run_bot requires params.bot" };

  const entry = BOT_REGISTRY[bot];
  if (!entry) {
    return { status: "failed", result: `bot not in registry: ${bot}. Use list-bots to see available bots.` };
  }

  const scriptPath = resolve(PROJECT_ROOT, entry.script);
  if (!existsSync(scriptPath)) {
    return { status: "failed", result: `bot script not found: ${entry.script}` };
  }

  const extraArgs = Array.isArray(args) ? args : [];
  console.log(`[executor] run_bot ${bot}: node ${entry.script} ${extraArgs.join(" ")}`);

  try {
    const r = spawnSync("node", [scriptPath, ...extraArgs], {
      cwd: PROJECT_ROOT,
      encoding: "utf-8",
      timeout: 10 * 60 * 1000,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env },
    });

    const output = ((r.stdout || "") + (r.stderr || "")).slice(0, 5000);
    const cost = typeof usd_est === "number" ? usd_est : 0.02;
    recordBudget(bot, 1, cost);

    if (r.status === 0) {
      return { status: "done", result: `bot ${bot} ok | ${output}` };
    }
    return { status: "failed", result: `bot ${bot} exit ${r.status} | ${output}` };
  } catch (e) {
    return { status: "failed", result: `run_bot spawn error: ${e.message}` };
  }
}

// analyze_niche_financial - run financial-analysis-bot for a niche, persist result.
// params: { niche: "AI voice agents for dental clinics", out: ".data/niche-analysis.json" }
// out is optional; if omitted, saves to .data/financial-analysis/<slug>.json
async function execAnalyzeNicheFinancial(params) {
  const { niche, out } = params;
  if (!niche) return { status: "failed", result: "analyze_niche_financial requires params.niche" };

  const slug = niche.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60);
  const outPath = out || `.data/financial-analysis/${slug}.json`;
  const scriptPath = resolve(PROJECT_ROOT, "scripts/factory/financial-analysis-bot.mjs");

  if (!existsSync(scriptPath)) {
    return { status: "failed", result: "financial-analysis-bot.mjs not found" };
  }

  try {
    const r = spawnSync("node", [scriptPath, niche, "--out", outPath], {
      cwd: PROJECT_ROOT,
      encoding: "utf-8",
      timeout: 3 * 60 * 1000,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env },
    });
    const output = ((r.stdout || "") + (r.stderr || "")).slice(0, 5000);
    if (r.status === 0) {
      return { status: "done", result: `financial analysis ok -> ${outPath} | ${output.slice(0, 300)}` };
    }
    return { status: "failed", result: `financial analysis exit ${r.status} | ${output.slice(0, 500)}` };
  } catch (e) {
    return { status: "failed", result: `analyze_niche_financial exception: ${e.message}` };
  }
}

const STEP_EXECUTORS = {
  dispatch_telegram:        execDispatchTelegram,
  run_command:              execRunCommand,
  write_file:               execWriteFile,
  sql_select:               execSqlSelect,
  await_human:              execAwaitHuman,
  verify_post_date:         execVerifyPostDate,
  execute_hands:            execExecuteHands,
  run_bot:                  execRunBot,
  analyze_niche_financial:  execAnalyzeNicheFinancial,
};

// ─── Main tick (v1) ───────────────────────────────────────────────────────────
// - Projects sorted by priority DESC (higher priority runs first)
// - Per project: find ALL ready steps (deps satisfied, budget ok), not just lowest seq
// - Steps in the same parallel_group all run in one tick
// - After running a group, break so next tick picks up remaining
async function tick() {
  // Sort by priority DESC, then oldest first within same priority
  const candidates = db.prepare(`
    SELECT * FROM executor_projects
    WHERE status IN ('pending','running')
    ORDER BY priority DESC, created_at ASC
  `).all();

  if (candidates.length === 0) {
    console.log("[executor] no active projects");
    return;
  }

  for (const project of candidates) {
    // Find all pending steps for this project
    const allPending = db.prepare(`
      SELECT * FROM executor_steps
      WHERE project_id = ? AND status = 'pending'
      ORDER BY seq ASC
    `).all(project.id);

    if (allPending.length === 0) {
      // No pending steps - project completed
      db.prepare(`UPDATE executor_projects SET status='completed', completed_at=?, updated_at=? WHERE id=?`)
        .run(NOW(), NOW(), project.id);
      console.log(`[executor] ${project.name} -> completed`);
      await tgSend(`<b>Project completed: ${project.name}</b>\n\nAll steps done.`);

      // Record completion as brain belief
      try {
        const stepCount = db.prepare("SELECT COUNT(*) as c FROM executor_steps WHERE project_id=?").get(project.id)?.c || 0;
        addBelief({
          domain: "experiments",
          belief: `Project "${project.name}" completed (${stepCount} steps). Priority: ${project.priority || "normal"}.`,
          confidence: 0.6,
          source: "project-executor",
          evidence: `Completed ${NOW()}`
        });
      } catch (e) { console.log(`[executor] brain addBelief error: ${e.message}`); }
      continue;
    }

    // Filter to steps whose dependencies are satisfied
    const readySteps = allPending.filter(s => isStepReady(project.id, s));

    if (readySteps.length === 0) {
      // All pending steps are blocked on deps - leave project running, revisit next tick
      db.prepare(`UPDATE executor_projects SET status='running', updated_at=? WHERE id=?`).run(NOW(), project.id);
      console.log(`[executor] ${project.name} -> all pending steps blocked (deps not met)`);
      continue;
    }

    // Determine which steps to run this tick:
    // If first ready step has a parallel_group, run all steps in that group.
    // Otherwise run just the first ready step.
    let toRun = [];
    const firstReady = readySteps[0];
    if (firstReady.parallel_group) {
      toRun = readySteps.filter(s => s.parallel_group === firstReady.parallel_group);
    } else {
      toRun = [firstReady];
    }

    db.prepare(`UPDATE executor_projects SET status='running', updated_at=? WHERE id=?`).run(NOW(), project.id);

    for (const step of toRun) {
      // Budget gate
      const tier = step.budget_tier || "normal";
      if (!isBudgetOk(tier)) {
        console.log(`[executor] ${project.name} step ${step.seq} SKIPPED: budget cap reached for tier=${tier}`);
        await tgSend(`<b>Budget cap reached</b>\nProject: ${project.name}\nStep ${step.seq} (${tier}) skipped.\nDaily used: $${getDailyBudgetUsed().toFixed(3)} / $${DAILY_BUDGET_CAP}`);
        // Mark project paused due to budget
        db.prepare(`UPDATE executor_projects SET status='paused', pause_reason=?, updated_at=? WHERE id=?`)
          .run(`budget cap: tier=${tier}`, NOW(), project.id);
        break;
      }

      console.log(`[executor] ${project.name} -> step ${step.seq} [${step.type}]: ${step.description.slice(0, 60)}`);
      db.prepare(`UPDATE executor_steps SET status='running', started_at=? WHERE id=?`).run(NOW(), step.id);

      let result = { status: "failed", result: `unknown step type: ${step.type}` };
      try {
        const params = JSON.parse(step.params_json || "{}");
        const executor = STEP_EXECUTORS[step.type];
        if (executor) {
          result = await executor(params, project);
        }
      } catch (e) {
        result = { status: "failed", result: `executor exception: ${e.message}` };
      }

      db.prepare(`UPDATE executor_steps SET status=?, result=?, completed_at=? WHERE id=?`)
        .run(result.status, result.result, NOW(), step.id);
      console.log(`[executor]   -> ${result.status}: ${(result.result || "").slice(0, 80)}`);

      // Step state transitions
      if (result.status === "skipped" && step.type === "await_human") {
        db.prepare(`UPDATE executor_projects SET status='paused', pause_reason='await_human step', updated_at=? WHERE id=?`)
          .run(NOW(), project.id);
        console.log(`[executor] ${project.name} -> paused (await_human)`);
        break; // stop processing this project's steps this tick
      } else if (result.status === "failed") {
        db.prepare(`UPDATE executor_projects SET status='failed', pause_reason=?, updated_at=? WHERE id=?`)
          .run(result.result.slice(0, 500), NOW(), project.id);
        console.log(`[executor] ${project.name} -> failed`);
        await tgSend(`<b>Project failed: ${project.name}</b>\n\nStep ${step.seq}: ${step.description}\n\nReason: ${result.result.slice(0, 300)}`);
        break; // stop this project
      }
    }
  }
}

// ─── Project loader ───────────────────────────────────────────────────────────
function loadProject(planPath) {
  const plan = JSON.parse(readFileSync(planPath, "utf-8"));
  const projectId = randomUUID();
  const priority = typeof plan.priority === "number" ? plan.priority : 5;
  db.prepare(`
    INSERT INTO executor_projects (id, name, goal, status, priority, created_at, updated_at)
    VALUES (?, ?, ?, 'pending', ?, ?, ?)
  `).run(projectId, plan.name, plan.goal || "", priority, NOW(), NOW());

  for (let i = 0; i < plan.steps.length; i++) {
    const s = plan.steps[i];
    db.prepare(`
      INSERT INTO executor_steps
        (id, project_id, seq, description, type, params_json, depends_on_json, parallel_group, budget_tier, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(
      randomUUID(),
      projectId,
      i + 1,
      s.description,
      s.type,
      JSON.stringify(s.params || {}),
      JSON.stringify(s.depends_on || []),
      s.parallel_group || null,
      s.budget_tier || "normal",
    );
  }

  console.log(`[executor] loaded "${plan.name}" priority=${priority} steps=${plan.steps.length} id=${projectId}`);
  return projectId;
}

// ─── Status display ───────────────────────────────────────────────────────────
function showStatus() {
  const projects = db.prepare(`SELECT * FROM executor_projects ORDER BY priority DESC, created_at DESC LIMIT 10`).all();
  const budgetUsed = getDailyBudgetUsed();
  console.log(`\nBudget today: $${budgetUsed.toFixed(3)} / $${DAILY_BUDGET_CAP}\n`);
  console.log(`Projects (${projects.length}):\n`);
  for (const p of projects) {
    const steps = db.prepare(`SELECT status, COUNT(*) as c FROM executor_steps WHERE project_id=? GROUP BY status`).all(p.id);
    const counts = steps.map(s => `${s.status}:${s.c}`).join(" ");
    console.log(`  ${p.id.slice(0,8)} | p=${p.priority} | ${p.status.padEnd(10)} | ${p.name}`);
    console.log(`           steps: ${counts}`);
    if (p.pause_reason) console.log(`           paused: ${p.pause_reason.slice(0, 80)}`);
  }
}

// ─── Resume ───────────────────────────────────────────────────────────────────
function resumeProject(idPrefix) {
  const project = db.prepare(`SELECT * FROM executor_projects WHERE id LIKE ? || '%'`).get(idPrefix);
  if (!project) {
    console.error(`no project matching ${idPrefix}`);
    return;
  }
  const awaitStep = db.prepare(`
    SELECT * FROM executor_steps WHERE project_id=? AND type='await_human' AND status='skipped'
    ORDER BY seq DESC LIMIT 1
  `).get(project.id);
  if (awaitStep) {
    db.prepare(`UPDATE executor_steps SET status='done', completed_at=? WHERE id=?`).run(NOW(), awaitStep.id);
  }
  db.prepare(`UPDATE executor_projects SET status='running', pause_reason=NULL, updated_at=? WHERE id=?`).run(NOW(), project.id);
  console.log(`[executor] resumed ${project.name}`);
}

// ─── List bots ────────────────────────────────────────────────────────────────
function listBots() {
  console.log(`\nBot Registry (${Object.keys(BOT_REGISTRY).length} bots):\n`);
  for (const [name, entry] of Object.entries(BOT_REGISTRY)) {
    const exists = existsSync(resolve(PROJECT_ROOT, entry.script)) ? "ok" : "MISSING";
    console.log(`  ${name.padEnd(18)} [${exists}]  ${entry.label}`);
  }
  console.log(`\nUse in plan.json step: { "type": "run_bot", "params": { "bot": "<name>" } }`);
}

// ─── Run bot directly ─────────────────────────────────────────────────────────
async function runBotDirect(botName, extraArgs) {
  const entry = BOT_REGISTRY[botName];
  if (!entry) {
    console.error(`bot not found: ${botName}`);
    console.error(`available: ${Object.keys(BOT_REGISTRY).join(", ")}`);
    process.exit(1);
  }
  console.log(`[executor] running ${botName}: ${entry.label}`);
  const result = await execRunBot({ bot: botName, args: extraArgs, usd_est: 0.02 });
  console.log(`[executor] result: ${result.status}`);
  console.log(result.result);
}

// ─── Budget display ───────────────────────────────────────────────────────────
function showBudget() {
  const rows = db.prepare(`
    SELECT date, bot_name, SUM(calls) as calls, SUM(usd_est) as usd
    FROM executor_budget
    WHERE date >= date('now', '-7 days')
    GROUP BY date, bot_name
    ORDER BY date DESC, usd DESC
  `).all();
  const total = getDailyBudgetUsed();
  console.log(`\nBudget (last 7 days):\n`);
  let lastDate = null;
  for (const r of rows) {
    if (r.date !== lastDate) {
      if (lastDate) console.log("");
      console.log(`  ${r.date}`);
      lastDate = r.date;
    }
    console.log(`    ${(r.bot_name || "?").padEnd(18)} calls=${r.calls} usd=$${r.usd.toFixed(4)}`);
  }
  console.log(`\nToday used: $${total.toFixed(4)} / cap $${DAILY_BUDGET_CAP}`);
}

// ─── CLI ──────────────────────────────────────────────────────────────────────
const cmd = process.argv[2] || "tick";
switch (cmd) {
  case "tick":
    await tick();
    break;
  case "load":
    if (!process.argv[3]) { console.error("usage: load <plan.json>"); process.exit(1); }
    loadProject(process.argv[3]);
    break;
  case "status":
    showStatus();
    break;
  case "resume":
    if (!process.argv[3]) { console.error("usage: resume <project_id_prefix>"); process.exit(1); }
    resumeProject(process.argv[3]);
    break;
  case "list-bots":
    listBots();
    break;
  case "run-bot":
    if (!process.argv[3]) { console.error("usage: run-bot <name> [args...]"); process.exit(1); }
    await runBotDirect(process.argv[3], process.argv.slice(4));
    break;
  case "budget":
    showBudget();
    break;
  default:
    console.error(`unknown command: ${cmd}`);
    process.exit(1);
}

db.close();
