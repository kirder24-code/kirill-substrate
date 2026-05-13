/**
 * CORTEX CONFIG INJECTION
 *
 * CORTEX writes config overrides to .data/cortex-config.json
 * Bots read this file at startup to get dynamic parameters.
 *
 * This lets CORTEX change bot behavior without code changes:
 * - Change scout keywords
 * - Adjust outreach templates
 * - Shift focus to different industries
 * - Cap daily sends
 * - Enable/disable specific bots
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const CONFIG_PATH = resolve(ROOT, ".data/cortex-config.json");

// ── DEFAULT CONFIG ─────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
  _version: 1,
  _updatedAt: null,
  _updatedBy: "cortex",

  // Global controls
  global: {
    paused: false,
    daily_budget_usd: 2.00,
    spent_today_usd: 0,
    budget_reset_date: null,
  },

  // Per-bot overrides (CORTEX brain can write these)
  bots: {
    "scout-bot": {
      enabled: true,
      keywords: [
        "vibe code audit", "ai automation small business", "n8n automation",
        "first customers saas", "ai workflow builder", "custom ai build",
        "reply chaser automation", "solo founder ai tools"
      ],
      geographic_focus: "Calgary, Alberta, Canada",
      max_leads_per_run: 20,
    },
    "icp-outreach-bot": {
      enabled: true,
      daily_dispatch_cap: 15,
      offer_description: "AI workflow automation and custom AI builds - Vibe-Code Audit, Reply Chaser, First 10 Customers Sales Motion, $1500-8000 CAD",
      target_industries: ["dental", "hvac", "plumbing", "law", "real-estate", "insurance", "salon"],
    },
    "pilot-email-bot": {
      enabled: true,
      offer_id: "local-pilot-99",
      daily_dispatch_cap: 25,
      target_industries: ["dental", "hvac", "plumbing"],
      target_stages: ["warming", "ready_buyer"],
      batch_size: 25,
      channel: "email",
    },
    "content-bot": {
      enabled: true,
      content_pillars: ["vibe-code-audit", "ai-automation", "first-10-customers", "small-business-ai"],
      posts_per_week: 2,
    },
    "awareness-bot": {
      enabled: true,
      focus_topics: ["AI workflow automation market", "vibe coding tools", "SMB AI adoption trends"],
    },
    "lead-enrichment-bot": {
      enabled: true,
      auto_pass_stages: ["ready_buyer", "warming"],
    },
    "brief-agent": {
      enabled: true,
      send_time_hour_utc: 13, // 7 AM Calgary
    },
  },

  // Active offers
  offers: {
    "vibe-code-audit": {
      name: "Vibe-Code Audit",
      headline: "Get a full audit of your AI-generated codebase - security, architecture, performance",
      body: "We review your vibe-coded app top to bottom. You get a detailed report with specific fixes and priorities. CA$1,500-2,500 depending on codebase size.",
      cta: "Reply and we will scope your audit within 24 hours.",
      price_cad: "1500-2500",
      price_label: "CA$1,500-2,500",
      target_industries: ["saas", "startups", "solo-founders"],
      target_regions: ["Canada", "US", "Global"],
      channel: "email",
      active: true,
    },
    "reply-chaser": {
      name: "Reply Chaser Automation",
      headline: "Automate your outbound follow-ups - never miss a reply again",
      body: "We build a custom reply-chasing automation that monitors your outreach and follows up intelligently. CA$1,500 flat.",
      cta: "Reply and we will map your outreach flow.",
      price_cad: 1500,
      price_label: "CA$1,500",
      target_industries: ["saas", "agencies", "consultants"],
      target_regions: ["Canada", "US", "Global"],
      channel: "email",
      active: true,
    },
    "first-10-customers": {
      name: "First 10 Customers Sales Motion",
      headline: "We build the system that gets your first 10 paying customers",
      body: "End-to-end sales motion: ICP, outreach, follow-up automation, CRM. CA$2,000 flat.",
      cta: "Reply with your product and we will draft your sales motion.",
      price_cad: 2000,
      price_label: "CA$2,000",
      target_industries: ["saas", "solo-founders", "startups"],
      target_regions: ["Canada", "US", "Global"],
      channel: "email",
      active: true,
    },
    "custom-ai-build": {
      name: "Custom AI / n8n Build",
      headline: "We build custom AI workflows and automations for your business",
      body: "From simple n8n flows to full AI agent systems. Scoped per project. CA$2,500-8,000.",
      cta: "Reply with what you need automated.",
      price_cad: "2500-8000",
      price_label: "CA$2,500-8,000",
      target_industries: ["any"],
      target_regions: ["Canada", "US", "Global"],
      channel: "email",
      active: true,
    },
  },

  // Micro-batch campaigns
  campaigns: {
    "local-pilot-batch-1": {
      offer_id: "local-pilot-99",
      status: "pending",
      batch_size: 25,
      industries: ["dental", "hvac", "plumbing"],
      lead_stages: ["warming", "ready_buyer"],
      channel: "email",
      notes: "Zero-budget direct-close. Manual send. 25-lead micro-batch warm/semi-warm only.",
      created_at: "2026-04-18",
    },
  },

  // Workflow controls
  workflows: {
    "lead-pipeline": { enabled: true, max_runs_per_day: 6 },
    "reply-pipeline": { enabled: true, max_runs_per_day: 12 },
    "content-pipeline": { enabled: true, max_runs_per_day: 1 },
    "morning-brief": { enabled: true, max_runs_per_day: 1 },
    "opportunity-scan": { enabled: true, max_runs_per_day: 2 },
  },
};

// ── READ CONFIG ────────────────────────────────────────────────────────

export function readConfig() {
  if (!existsSync(CONFIG_PATH)) {
    writeConfig(DEFAULT_CONFIG);
    return DEFAULT_CONFIG;
  }
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return DEFAULT_CONFIG;
  }
}

// ── WRITE CONFIG ───────────────────────────────────────────────────────

export function writeConfig(config) {
  config._updatedAt = new Date().toISOString();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// ── UPDATE BOT CONFIG ──────────────────────────────────────────────────

export function updateBotConfig(botName, overrides) {
  const config = readConfig();
  if (!config.bots[botName]) config.bots[botName] = {};
  Object.assign(config.bots[botName], overrides);
  writeConfig(config);
  return config.bots[botName];
}

// ── GET BOT CONFIG (for bots to read) ──────────────────────────────────

export function getBotConfig(botName) {
  const config = readConfig();
  return config.bots[botName] || {};
}

// ── CHECK IF BOT IS ENABLED ────────────────────────────────────────────

export function isBotEnabled(botName) {
  const config = readConfig();
  if (config.global.paused) return false;
  const botConfig = config.bots[botName];
  return botConfig ? botConfig.enabled !== false : true;
}

// ── CHECK BUDGET ───────────────────────────────────────────────────────

export function checkBudget(costUsd) {
  const config = readConfig();
  const today = new Date().toISOString().slice(0, 10);

  // Reset daily spend if new day
  if (config.global.budget_reset_date !== today) {
    config.global.spent_today_usd = 0;
    config.global.budget_reset_date = today;
    writeConfig(config);
  }

  const remaining = config.global.daily_budget_usd - config.global.spent_today_usd;
  return { allowed: remaining >= costUsd, remaining, spent: config.global.spent_today_usd };
}

// ── RECORD SPEND ───────────────────────────────────────────────────────

export function recordSpend(costUsd) {
  const config = readConfig();
  const today = new Date().toISOString().slice(0, 10);
  if (config.global.budget_reset_date !== today) {
    config.global.spent_today_usd = 0;
    config.global.budget_reset_date = today;
  }
  config.global.spent_today_usd += costUsd;
  writeConfig(config);
}

// ── CHECK WORKFLOW RUN COUNT ───────────────────────────────────────────

export function canRunWorkflow(workflowName) {
  const config = readConfig();
  const wf = config.workflows[workflowName];
  if (!wf || wf.enabled === false) return false;

  // Track daily runs in a separate counter
  const today = new Date().toISOString().slice(0, 10);
  const runKey = `_runs_${today}`;
  const runs = wf[runKey] || 0;
  return runs < (wf.max_runs_per_day || 999);
}

export function recordWorkflowRun(workflowName) {
  const config = readConfig();
  const wf = config.workflows[workflowName];
  if (!wf) return;
  const today = new Date().toISOString().slice(0, 10);
  const runKey = `_runs_${today}`;
  wf[runKey] = (wf[runKey] || 0) + 1;
  writeConfig(config);
}

// ── APPLY BRAIN DECISIONS TO CONFIG ────────────────────────────────────

export function applyBrainConfig(decisions) {
  const config = readConfig();

  for (const d of decisions) {
    if (d.action === "update_bot_config" && d.bot && d.config) {
      if (!config.bots[d.bot]) config.bots[d.bot] = {};
      Object.assign(config.bots[d.bot], d.config);
    }
    if (d.action === "update_budget" && typeof d.daily_budget_usd === "number") {
      config.global.daily_budget_usd = d.daily_budget_usd;
    }
    if (d.action === "pause_system") {
      config.global.paused = true;
    }
    if (d.action === "resume_system") {
      config.global.paused = false;
    }
  }

  writeConfig(config);
  return config;
}
