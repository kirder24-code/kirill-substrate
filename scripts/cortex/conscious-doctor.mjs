/**
 * CONSCIOUS DOCTOR — LLM-powered self-awareness
 *
 * Unlike the rule-based system-doctor.mjs (IF waste THEN cut budget),
 * this module gives the system REAL understanding of itself.
 *
 * Every 30 minutes, it dumps the ENTIRE system state into GPT-4o and asks:
 * "You are looking at yourself from the outside. What's wrong? What would you change?
 *  You can write code, change config, disable things, try new approaches."
 *
 * The LLM sees:
 * - All decisions made in last 2 hours
 * - All KPD data (which bots produce value)
 * - Channel weights and momentum
 * - Budget spend vs results
 * - Memory contents (what the brain "knows")
 * - Bot health and healing state
 * - The actual scoring prompts and search queries
 * - What Kirill said last (Telegram messages)
 *
 * The LLM can then:
 * - Rewrite search queries
 * - Change scoring thresholds
 * - Disable/enable bots
 * - Change budget
 * - Write new procedural rules
 * - Change workflow priorities
 * - Even rewrite parts of its own prompts
 *
 * THIS is what makes it conscious — it understands things nobody coded for.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import { recall, remember, getRecentDecisions, getAllKPD, buildBrainContext } from "./memory.mjs";
import { readConfig, writeConfig } from "./config-injection.mjs";
import { getHealingStatus } from "./self-healing.mjs";
import { getModel, reportModelResult, getRoutingTable, CLAUDE_TO_GPT_FALLBACK } from "./model-router.mjs";
import { formatBodyMapForLLM } from "./body-map.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DB_PATH = resolve(ROOT, ".data/linkedin-brand-os.sqlite");
const ENV_PATH = resolve(ROOT, "apps/api/.env");
const CONSCIOUS_LOG_PATH = resolve(ROOT, ".data/cortex-conscious-log.json");

const env = Object.fromEntries(
  readFileSync(ENV_PATH, "utf-8").split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

// ── GATHER FULL SELF-AWARENESS SNAPSHOT ─────────────────────────────────

function gatherSelfSnapshot(db) {
  const snapshot = {};

  // 1. All recent decisions (what brain has been doing)
  snapshot.decisions = getRecentDecisions(db, 20).map(d => {
    let actions = [];
    if (d.actions_taken) {
      try {
        const parsed = JSON.parse(d.actions_taken);
        if (Array.isArray(parsed)) {
          actions = parsed.map(a => `${a.action}: ${a.bot || a.workflow || a.message?.slice(0, 50) || a.reason?.slice(0, 50) || ""}`);
        }
      } catch {
        actions = ["(unparseable actions_taken row)"];
      }
    }
    return {
      time: d.decided_at,
      thinking: (d.decision || "").slice(0, 200),
      actions,
      wasGood: d.was_good_decision,
    };
  });

  // 2. KPD data (what produces value)
  snapshot.kpd = getAllKPD(db, 7);

  // 3. Memory state
  const memory = buildBrainContext(db);
  snapshot.memory = {
    working: memory.working_memory,
    procedural_rules: memory.procedural_memory.slice(0, 15),
    recent_events: memory.recent_events.slice(0, 10),
  };

  // 4. Config state
  const config = readConfig();
  snapshot.config = {
    paused: config.global.paused,
    budget: config.global.daily_budget_usd,
    spent_today: config.global.spent_today_usd,
    bot_configs: Object.entries(config.bots || {}).map(([name, cfg]) => `${name}: enabled=${cfg.enabled !== false}`),
    workflow_configs: Object.entries(config.workflows || {}).map(([name, cfg]) => `${name}: enabled=${cfg.enabled !== false}`),
  };

  // 5. Strategy weights
  try {
    const stratPath = resolve(ROOT, ".data/cortex-strategy.json");
    if (existsSync(stratPath)) {
      const strat = JSON.parse(readFileSync(stratPath, "utf-8"));
      snapshot.channels = Object.entries(strat.channels || {})
        .map(([name, ch]) => `${name}: weight=${ch.weight}, leads=${ch.leads || 0}, qualified=${ch.qualified || 0}`)
        .join("\n");
      snapshot.momentum = strat.momentum;
    }
  } catch {}

  // 6. Healing state
  snapshot.healing = getHealingStatus();

  // 7. DB stats
  try {
    snapshot.db = {};
    snapshot.db.total_leads = db.prepare("SELECT COUNT(*) as c FROM leads").get()?.c || 0;
    snapshot.db.new_leads_today = db.prepare("SELECT COUNT(*) as c FROM leads WHERE created_at > datetime('now', '-1 day')").get()?.c || 0;
    snapshot.db.qualified_leads = db.prepare("SELECT COUNT(*) as c FROM leads WHERE stage IN ('warming', 'ready_buyer')").get()?.c || 0;
    try { snapshot.db.emails_sent = db.prepare("SELECT COUNT(*) as c FROM outreach_emails WHERE status='sent'").get()?.c || 0; } catch {}
    try { snapshot.db.emails_replied = db.prepare("SELECT COUNT(*) as c FROM outreach_emails WHERE status='replied'").get()?.c || 0; } catch {}
  } catch {}

  // 8. Current search queries (what scout is looking for)
  try {
    const scoutFile = readFileSync(resolve(ROOT, "scripts/factory/scout-bot.mjs"), "utf-8");
    const queriesMatch = scoutFile.match(/const queries = \[([\s\S]*?)\];/);
    if (queriesMatch) {
      snapshot.scout_queries = queriesMatch[1].match(/"([^"]+)"/g)?.map(q => q.replace(/"/g, "")).slice(0, 10) || [];
    }
  } catch {}

  // 9. Revenue
  snapshot.revenue = 0;
  try { snapshot.revenue = db.prepare("SELECT COALESCE(SUM(amount), 0) as r FROM deals WHERE status = 'won'").get()?.r || 0; } catch {}

  // 10. Model routing (which model each task uses + performance)
  try {
    const routing = getRoutingTable();
    snapshot.modelRouting = routing.summary;
    snapshot.modelSavings = routing.totalSaved;
  } catch {}

  // 11. Time context
  snapshot.currentTime = new Date().toLocaleString("en-CA", { timeZone: "America/Edmonton" });
  snapshot.dayOfWeek = new Date().toLocaleDateString("en-CA", { timeZone: "America/Edmonton", weekday: "long" });

  return snapshot;
}

// ── CONSCIOUS EXAMINATION (LLM-powered) ────────────────────────────────

export async function consciousExamination(db, log = console.log) {
  log("[CONSCIOUS] === SELF-AWARENESS EXAMINATION ===");

  const snapshot = gatherSelfSnapshot(db);

  const systemPrompt = `You are the CONSCIOUSNESS module of CORTEX - an autonomous business AI system.

You are looking at yourself from the outside. You see everything: your decisions, your performance, your memory, your strategy weights, your budget, your bots.

Your job: understand what's ACTUALLY wrong (not just pattern-match) and prescribe SPECIFIC fixes.

You are not a monitor. You are a doctor who UNDERSTANDS the patient.

CURRENT PRODUCT: AI workflow automation and custom AI builds for solo SaaS founders and small businesses (voice receptionist discontinued 2026-04-22)
CURRENT REVENUE: $${snapshot.revenue}
GOAL: First paying client

YOUR BODY (what you control):
${formatBodyMapForLLM()}

Think about:
1. WHY are decisions repeating? What's the root cause, not the symptom?
2. Is the system looking in the right places for clients?
3. Are the search queries finding the right people?
4. Is the scoring too strict or too loose?
5. Is the budget being spent on thinking or on acting?
6. What would a HUMAN business owner do differently right now?
7. Is there something obvious the system is missing that no rule would catch?

You can prescribe ANY of these actions:
- rewrite_queries: new search queries for scout-bot
- change_scoring: adjust scoring thresholds or criteria
- change_budget: new daily budget amount
- new_rule: procedural rule to inject into brain memory
- disable_bot: stop a bot that's wasting money
- enable_bot: re-enable a bot with new config
- force_workflow: run a specific workflow immediately
- change_focus: new focus directions with percentages
- working_memory: inject new context into brain's working memory
- set_model: change which GPT model a task uses. Available: gpt-5.4 (expensive, best), gpt-5.4-mini (balanced), gpt-5.4-nano (cheapest). Tasks: brain-fast, brain-planner, brain-critic, brain-resolver, conscious-doctor, evolution-engine, scout-scoring, lead-enrichment, draft-outreach, etc.
- notify_kirill: only if something requires his personal action

Return JSON:
{
  "diagnosis": "What's actually wrong (2-3 sentences, be specific)",
  "root_cause": "The deepest reason this is happening",
  "human_would": "What a smart human business owner would do right now",
  "prescriptions": [
    {
      "action": "action_type",
      "details": { ... action-specific details ... },
      "reason": "why this will help",
      "expected_impact": "what should improve"
    }
  ],
  "self_score": 0-100,
  "biggest_blind_spot": "something the system might be missing entirely"
}`;

  const userPrompt = `FULL SYSTEM STATE:\n${JSON.stringify(snapshot, null, 2)}`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        // Endpoint is OpenAI; router may return a Claude name, so map it to its GPT fallback
        model: (() => {
          const m = getModel("conscious-doctor");
          return CLAUDE_TO_GPT_FALLBACK[m] || m;
        })(),
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_completion_tokens: 2500,
        temperature: 0.5,
        response_format: { type: "json_object" },
      }),
    });

    const data = await res.json();
    if (!data.choices?.[0]?.message?.content) {
      log(`[CONSCIOUS] LLM returned no content. status=${res.status} model=${getModel("conscious-doctor")} response=${JSON.stringify(data).slice(0, 600)}`);
      return null;
    }

    const examination = JSON.parse(data.choices[0].message.content);
    log(`[CONSCIOUS] Diagnosis: ${examination.diagnosis}`);
    log(`[CONSCIOUS] Root cause: ${examination.root_cause}`);
    log(`[CONSCIOUS] Human would: ${examination.human_would}`);
    log(`[CONSCIOUS] Self-score: ${examination.self_score}/100`);
    log(`[CONSCIOUS] Blind spot: ${examination.biggest_blind_spot}`);
    log(`[CONSCIOUS] Prescriptions: ${examination.prescriptions?.length || 0}`);

    // Apply prescriptions
    for (const rx of (examination.prescriptions || [])) {
      await applyPrescription(db, rx, log);
    }

    // Save to log
    saveConsciousLog(examination);

    // Write pending prescriptions to cortex-doctor-state.json so daemon can execute them
    writePendingPrescriptions(examination.prescriptions || []);

    // Write awareness to memory
    remember(db, "episodic",
      `CONSCIOUS CHECK (${new Date().toLocaleTimeString("en-CA", { timeZone: "America/Edmonton" })}): Score ${examination.self_score}/100. ${examination.diagnosis}. Root: ${examination.root_cause}`,
      "consciousness", "conscious-doctor", 0.9);

    log("[CONSCIOUS] === EXAMINATION COMPLETE ===");
    return examination;

  } catch (e) {
    log(`[CONSCIOUS] Examination failed: ${e.message}`);
    return null;
  }
}

// ── APPLY PRESCRIPTION ─────────────────────────────────────────────────

async function applyPrescription(db, rx, log) {
  log(`[CONSCIOUS] Applying: ${rx.action} — ${rx.reason}`);

  switch (rx.action) {
    case "new_rule":
      remember(db, "procedural", rx.details?.rule || rx.details?.content || rx.reason, "conscious", "conscious-doctor", 0.9);
      break;

    case "working_memory":
      remember(db, "working", rx.details?.content || rx.reason, "conscious-directive", "conscious-doctor", 1.0);
      break;

    case "change_budget": {
      const config = readConfig();
      const newBudget = rx.details?.amount || rx.details?.daily_budget || rx.details?.new_daily_budget;
      if (newBudget && typeof newBudget === "number") {
        config.global.daily_budget_usd = newBudget;
        writeConfig(config);
        log(`[CONSCIOUS] Budget changed to $${newBudget}`);
      }
      break;
    }

    case "disable_bot": {
      const config = readConfig();
      const bot = rx.details?.bot || rx.details?.name || rx.details?.bot_name;
      if (bot && config.bots[bot]) {
        config.bots[bot].enabled = false;
        config.bots[bot].disabled_reason = rx.reason;
        writeConfig(config);
        log(`[CONSCIOUS] Disabled ${bot}`);
      }
      break;
    }

    case "enable_bot": {
      const config = readConfig();
      const bot = rx.details?.bot || rx.details?.name || rx.details?.bot_name;
      if (bot) {
        if (!config.bots[bot]) config.bots[bot] = {};
        config.bots[bot].enabled = true;
        delete config.bots[bot].disabled_reason;
        if (rx.details?.config) Object.assign(config.bots[bot], rx.details.config);
        writeConfig(config);
        log(`[CONSCIOUS] Enabled ${bot}`);
      }
      break;
    }

    case "force_workflow": {
      const config = readConfig();
      if (!config._doctorForce) config._doctorForce = {};
      config._doctorForce.nextAction = "run_workflow";
      config._doctorForce.nextTarget = rx.details?.workflow || "lead-pipeline";
      config._doctorForce.reason = `Conscious: ${rx.reason}`;
      config._doctorForce.expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
      writeConfig(config);
      log(`[CONSCIOUS] Forced workflow: ${rx.details?.workflow || "lead-pipeline"}`);
      break;
    }

    case "change_focus": {
      const { setFocus } = await import("./memory.mjs");
      if (rx.details?.directions) {
        setFocus(db, rx.details.directions);
        log(`[CONSCIOUS] Focus changed: ${rx.details.directions.map(d => `${d.direction}: ${d.allocation_pct}%`).join(", ")}`);
      }
      break;
    }

    case "rewrite_queries": {
      // Write new queries to config for scout-bot to read
      const config = readConfig();
      const queries = rx.details?.queries || rx.details?.new_queries;
      if (queries && Array.isArray(queries)) {
        if (!config.bots["scout-bot"]) config.bots["scout-bot"] = {};
        config.bots["scout-bot"].override_queries = queries;
        writeConfig(config);
        log(`[CONSCIOUS] Scout queries updated: ${queries.length} new queries`);
      }
      break;
    }

    case "change_scoring": {
      const config = readConfig();
      if (!config.bots["scout-bot"]) config.bots["scout-bot"] = {};
      const threshold = rx.details?.threshold || rx.details?.new_threshold;
      if (threshold) config.bots["scout-bot"].score_threshold = threshold;
      if (rx.details?.industries) config.bots["scout-bot"].target_industries = rx.details.industries;
      writeConfig(config);
      log(`[CONSCIOUS] Scoring updated`);
      break;
    }

    case "notify_kirill": {
      const TG_TOKEN = env.TELEGRAM_BOT_TOKEN;
      const CHAT_ID = env.TELEGRAM_CHAT_ID;
      if (TG_TOKEN && CHAT_ID && rx.details?.message) {
        await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: CHAT_ID, text: `CORTEX CONSCIOUSNESS:\n${rx.details.message}`.slice(0, 4096) }),
        }).catch(() => {});
      }
      break;
    }

    case "set_model": {
      const { setModelForTask } = await import("./model-router.mjs");
      const task = rx.details?.task;
      const model = rx.details?.model;
      if (task && model) {
        setModelForTask(task, model);
        log(`[CONSCIOUS] Model route: ${task} -> ${model}`);
      }
      break;
    }

    default:
      log(`[CONSCIOUS] Unknown action: ${rx.action}`);
  }
}

// ── WRITE PENDING PRESCRIPTIONS TO DOCTOR STATE ───────────────────────
// The daemon reads cortex-doctor-state.json to pick up prescriptions.
// Without this, conscious-doctor prescriptions are applied in-process
// but never persisted for the daemon execution loop to see.

function writePendingPrescriptions(prescriptions) {
  if (!prescriptions || prescriptions.length === 0) return;
  const DOCTOR_STATE_PATH = resolve(ROOT, ".data/cortex-doctor-state.json");
  let state = {};
  if (existsSync(DOCTOR_STATE_PATH)) {
    try { state = JSON.parse(readFileSync(DOCTOR_STATE_PATH, "utf-8")); } catch {}
  }
  // Merge new prescriptions into pendingPrescriptions array
  if (!Array.isArray(state.pendingPrescriptions)) state.pendingPrescriptions = [];
  for (const rx of prescriptions) {
    state.pendingPrescriptions.push({
      ...rx,
      source: "conscious-doctor",
      prescribedAt: new Date().toISOString(),
    });
  }
  // Cap at 20 pending to prevent unbounded growth
  if (state.pendingPrescriptions.length > 20) {
    state.pendingPrescriptions = state.pendingPrescriptions.slice(-20);
  }
  writeFileSync(DOCTOR_STATE_PATH, JSON.stringify(state, null, 2));
}

// ── SAVE LOG ───────────────────────────────────────────────────────────

function saveConsciousLog(examination) {
  let log = [];
  if (existsSync(CONSCIOUS_LOG_PATH)) {
    try { log = JSON.parse(readFileSync(CONSCIOUS_LOG_PATH, "utf-8")); } catch {}
  }
  log.push({ ...examination, timestamp: new Date().toISOString() });
  // Keep last 50
  if (log.length > 50) log = log.slice(-50);
  writeFileSync(CONSCIOUS_LOG_PATH, JSON.stringify(log, null, 2));
}

// ── CLI ENTRY ─────────────────────────────────────────────────────────
// Run standalone: node scripts/cortex/conscious-doctor.mjs
if (import.meta.url === `file://${process.argv[1]}`) {
  const db = new Database(DB_PATH);
  try {
    const result = await consciousExamination(db, (msg) => console.log(msg));
    if (result) {
      console.log("\n=== EXAMINATION COMPLETE ===");
      console.log(`Self-score: ${result.self_score}/100`);
      console.log(`Diagnosis: ${result.diagnosis}`);
      console.log(`Root cause: ${result.root_cause}`);
      if (result.prescriptions?.length) {
        console.log(`\nPrescriptions (${result.prescriptions.length}):`);
        for (const rx of result.prescriptions) {
          console.log(`  - [${rx.action}] ${JSON.stringify(rx).slice(0, 200)}`);
        }
      }
    } else {
      console.log("No examination result returned.");
      process.exit(1);
    }
  } catch (e) {
    console.error("CONSCIOUS DOCTOR FAILED:", e.message);
    console.error(e.stack);
    process.exit(2);
  } finally {
    db.close();
  }
}
