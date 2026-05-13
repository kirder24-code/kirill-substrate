/**
 * CORTEX WORKFLOWS — Multi-step bot pipelines
 *
 * Instead of just spawning bots randomly, CORTEX runs WORKFLOWS:
 * chains of bots where output of one feeds input of the next.
 *
 * Workflows:
 * 1. DISCOVERY -> ENRICH -> OUTREACH (find leads, classify, draft messages)
 * 2. MONITOR -> CLASSIFY -> RESPOND (watch replies, classify intent, draft response)
 * 3. CONTENT -> QUALITY -> DISPATCH (draft post, quality check, send to Telegram)
 *
 * Each step reports KPD back to CORTEX memory.
 * If a step fails, the workflow halts and logs the failure.
 */

import { resolve as pathResolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { logKPD, remember } from "./memory.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = pathResolve(__dirname, "../..");

// ── WORKFLOW DEFINITIONS ───────────────────────────────────────────────

export const WORKFLOWS = {
  "lead-pipeline": {
    description: "Discover leads -> Enrich -> Draft outreach",
    steps: [
      { bot: "scout-bot", args: [], timeout: 120_000, extract: "leads_found" },
      { bot: "lead-enrichment-bot", args: ["--batch"], timeout: 300_000, extract: "enriched", dependsOn: "leads_found", skipIf: v => v === 0 },
      { bot: "icp-outreach-bot", args: [], timeout: 120_000, extract: "dispatched" },
    ],
  },

  "reply-pipeline": {
    description: "Monitor replies -> Classify -> Notify Kirill",
    steps: [
      { bot: "monitor-replies", args: [], timeout: 180_000, extract: "replies_found" },
      { bot: "reply-classifier", args: [], timeout: 60_000, extract: "classified", dependsOn: "replies_found", skipIf: v => v === 0 },
    ],
  },

  "content-pipeline": {
    description: "Draft content -> Quality check -> Send to Telegram",
    steps: [
      { bot: "content-bot", args: ["draft"], timeout: 90_000, extract: "drafts" },
      { bot: "draft-quality-checker", args: ["--batch"], timeout: 60_000, extract: "passed", dependsOn: "drafts", skipIf: v => v === 0 },
    ],
  },

  "morning-brief": {
    description: "Generate morning briefing for Kirill",
    steps: [
      { bot: "brief-agent", args: [], timeout: 120_000, extract: "brief_sent" },
    ],
  },

  "opportunity-scan": {
    description: "Scan for new opportunities + validate",
    steps: [
      { bot: "awareness-bot", args: [], timeout: 120_000, extract: "findings" },
      { bot: "idea-bot", args: [], timeout: 90_000, extract: "ideas" },
    ],
  },
};

// ── BOT SCRIPT MAP ─────────────────────────────────────────────────────

const BOT_SCRIPTS = {
  "scout-bot": "scripts/factory/scout-bot.mjs",
  "awareness-bot": "scripts/factory/awareness-bot.mjs",
  "reddit-monitor": "scripts/factory/reddit-monitor.mjs",
  "lead-enrichment-bot": "scripts/factory/lead-enrichment-bot.mjs",
  "icp-outreach-bot": "scripts/factory/icp-outreach-bot.mjs",
  "draft-quality-checker": "scripts/factory/draft-quality-checker.mjs",
  "sales-bot": "scripts/factory/sales-bot.mjs",
  "content-bot": "scripts/factory/content-bot.mjs",
  "builder-bot": "scripts/factory/builder-bot.mjs",
  "idea-bot": "scripts/factory/idea-bot.mjs",
  "competitor-agent": "scripts/factory/competitor-agent.mjs",
  "evolution-bot": "scripts/factory/evolution-bot.mjs",
  "brief-agent": "scripts/factory/brief-agent.mjs",
  // vapi-voice-agent: DISCONTINUED Apr 22 2026
  // vapi-outbound-caller: DISCONTINUED Apr 22 2026
  "site-curator-bot": "scripts/factory/site-curator-bot.mjs",
  "monitor-replies": "scripts/outreach/monitor-replies.mjs",
  "reply-classifier": "scripts/factory/reply-classifier.mjs",
};

// Per-bot timeout overrides for bots that consistently need more time
const BOT_TIMEOUTS = {
  "reddit-monitor": 180_000,
  "lead-enrichment-bot": 300_000,
  "monitor-replies": 180_000,
};

// ── RUN A SINGLE BOT (with timeout + output capture) ───────────────────

function runBot(botName, args = [], timeoutMs = 120_000) {
  return new Promise((promiseResolve, reject) => {
    const script = BOT_SCRIPTS[botName];
    if (!script) return reject(new Error(`Unknown bot: ${botName}`));

    const scriptPath = pathResolve(ROOT, script);
    if (!existsSync(scriptPath)) return reject(new Error(`Script not found: ${scriptPath}`));

    let output = "";
    let stderr = "";
    const startTime = Date.now();

    const child = spawn("node", [scriptPath, ...args], {
      cwd: ROOT,
      stdio: "pipe",
      env: { ...process.env, CORTEX_MODE: "1", PATH: process.env.PATH },
      timeout: timeoutMs,
    });

    child.stdout?.on("data", d => { output += d.toString(); });
    child.stderr?.on("data", d => { stderr += d.toString(); });

    child.on("close", (code, signal) => {
      const durationMs = Date.now() - startTime;

      // Try to extract structured result from last line of stdout
      let result = {};
      const lines = output.trim().split("\n").filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const parsed = JSON.parse(lines[i]);
          if (typeof parsed === "object") { result = parsed; break; }
        } catch {}
      }

      if (code === 0) {
        promiseResolve({ botName, code, durationMs, result, output: output.slice(-2000), stderr: stderr.slice(-500) });
      } else if (signal) {
        reject(new Error(`${botName} timed out after ${timeoutMs}ms`));
      } else {
        reject(new Error(`${botName} exited with code ${code}: ${stderr.slice(-300)}`));
      }
    });

    child.on("error", (err) => {
      reject(new Error(`${botName} spawn error: ${err.message}`));
    });
  });
}

// ── RUN A WORKFLOW ─────────────────────────────────────────────────────

export async function runWorkflow(db, workflowName, log = console.log) {
  const workflow = WORKFLOWS[workflowName];
  if (!workflow) throw new Error(`Unknown workflow: ${workflowName}`);

  log(`[WORKFLOW] Starting: ${workflowName} - ${workflow.description}`);
  const startTime = Date.now();
  const stepResults = {};
  const errors = [];

  for (const step of workflow.steps) {
    // Check skip condition
    if (step.dependsOn && step.skipIf) {
      const depValue = stepResults[step.dependsOn];
      if (step.skipIf(depValue)) {
        log(`[WORKFLOW] Skipping ${step.bot} - ${step.dependsOn} = ${depValue}`);
        continue;
      }
    }

    try {
      log(`[WORKFLOW] Running: ${step.bot}`);
      const result = await runBot(step.bot, step.args || [], step.timeout || 120_000);

      // Extract the metric we care about
      if (step.extract && result.result) {
        stepResults[step.extract] = result.result[step.extract] ?? result.result.count ?? 0;
      }

      // Report KPD for this step
      const cost = estimateBotCost(step.bot, result.durationMs);
      const value = stepResults[step.extract] || 0;
      logKPD(db, step.bot, cost, JSON.stringify(result.result).slice(0, 200), value);

      log(`[WORKFLOW] ${step.bot} done in ${(result.durationMs / 1000).toFixed(1)}s - ${step.extract}: ${stepResults[step.extract] ?? "?"}`);
    } catch (err) {
      log(`[WORKFLOW] ${step.bot} FAILED: ${err.message}`);
      errors.push({ bot: step.bot, error: err.message });

      // Log failure to memory
      remember(db, "episodic", `Workflow ${workflowName} failed at step ${step.bot}: ${err.message}`, "workflow-failure", "cortex");

      // Don't continue if a step fails (pipeline broken)
      break;
    }
  }

  const totalMs = Date.now() - startTime;
  const success = errors.length === 0;

  log(`[WORKFLOW] ${workflowName} ${success ? "COMPLETED" : "FAILED"} in ${(totalMs / 1000).toFixed(1)}s`);

  return { workflowName, success, stepResults, errors, totalMs };
}

// ── RUN A SINGLE BOT (standalone, not part of workflow) ────────────────

export async function runSingleBot(db, botName, args = [], log = console.log) {
  log(`[BOT] Running: ${botName} ${args.join(" ")}`);
  const timeout = BOT_TIMEOUTS[botName] || 120_000;
  try {
    const result = await runBot(botName, args, timeout);
    const cost = estimateBotCost(botName, result.durationMs);
    logKPD(db, botName, cost, JSON.stringify(result.result).slice(0, 200), 0);
    log(`[BOT] ${botName} done in ${(result.durationMs / 1000).toFixed(1)}s`);
    return result;
  } catch (err) {
    log(`[BOT] ${botName} FAILED: ${err.message}`);
    remember(db, "episodic", `Bot ${botName} failed: ${err.message}`, "bot-failure", "cortex");
    throw err;
  }
}

// ── COST ESTIMATION ────────────────────────────────────────────────────

const BOT_COSTS = {
  "scout-bot": 0.15,
  "awareness-bot": 0.30,
  "reddit-monitor": 0.05,
  "lead-enrichment-bot": 0.50,
  "icp-outreach-bot": 0.40,
  "draft-quality-checker": 0.02,
  "sales-bot": 0.20,
  "content-bot": 0.15,
  "builder-bot": 1.00,
  "idea-bot": 0.30,
  "competitor-agent": 0.20,
  "evolution-bot": 0.30,
  "brief-agent": 0.25,
  // vapi-voice-agent: DISCONTINUED
  // vapi-outbound-caller: DISCONTINUED
  "site-curator-bot": 0.15,
  "monitor-replies": 0.05,
  "reply-classifier": 0.10,
};

function estimateBotCost(botName, durationMs) {
  const baseCost = BOT_COSTS[botName] || 0.10;
  // Scale by duration (longer runs = more API calls)
  const durationMinutes = durationMs / 60_000;
  return Math.round((baseCost * Math.max(1, durationMinutes)) * 100) / 100;
}
