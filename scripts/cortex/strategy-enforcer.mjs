/**
 * STRATEGY ENFORCER — Hard gates that brain CANNOT bypass
 *
 * Unlike prompt-based rules (which GPT can ignore), these are CODE gates.
 * Every decision from the brain passes through enforcement before execution.
 *
 * Gates:
 * 1. CHANNEL GATE — dead channels (weight < 15) cannot be used
 * 2. BUDGET GATE — no execution if daily budget exhausted
 * 3. KPD GATE — bots with KPD < 0.1 over 5+ runs get blocked
 * 4. REPEAT GATE — same action can't run more than 2x in 1 hour
 * 5. SPAM GATE — max 3 Telegram notifications per hour
 * 6. STRATEGIC GATE — if revenue = $0 for 7+ days, force outreach-only mode
 *
 * The brain proposes. The enforcer disposes.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readConfig, checkBudget } from "./config-injection.mjs";
import { getAllKPD } from "./memory.mjs";
import { safetyValveCheck, getEmotionalLimits, getEmotionalState } from "./emotions.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const STRATEGY_PATH = resolve(ROOT, ".data/cortex-strategy.json");
const ENFORCEMENT_LOG_PATH = resolve(ROOT, ".data/cortex-enforcement.json");

// ── ENFORCEMENT STATE (tracks recent actions for repeat/spam detection) ──

function loadEnforcementState() {
  if (!existsSync(ENFORCEMENT_LOG_PATH)) return { actions: [], notifications: [], lastReset: null };
  try {
    return JSON.parse(readFileSync(ENFORCEMENT_LOG_PATH, "utf-8"));
  } catch { return { actions: [], notifications: [], lastReset: null }; }
}

function saveEnforcementState(state) {
  // Prune old entries (keep last 2 hours)
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  state.actions = (state.actions || []).filter(a => a.ts > cutoff);
  state.notifications = (state.notifications || []).filter(n => n.ts > cutoff);
  writeFileSync(ENFORCEMENT_LOG_PATH, JSON.stringify(state));
}

// ── LOAD STRATEGY WEIGHTS ──────────────────────────────────────────────

function loadStrategy() {
  if (!existsSync(STRATEGY_PATH)) return null;
  try { return JSON.parse(readFileSync(STRATEGY_PATH, "utf-8")); } catch { return null; }
}

// ── MAIN ENFORCER: filter brain decisions ──────────────────────────────

export function enforceDecisions(db, decisions, log = console.log) {
  if (!Array.isArray(decisions)) return [];

  const state = loadEnforcementState();
  const strategy = loadStrategy();
  const config = readConfig();
  const kpdData = getAllKPD(db, 7);
  const enforced = [];
  const blocked = [];

  for (const d of decisions) {
    const result = enforceOne(d, state, strategy, config, kpdData, db);
    if (result.allowed) {
      enforced.push(d);
      // Track this action
      if (d.action === "run_bot" || d.action === "run_workflow") {
        state.actions.push({ action: d.action, target: d.bot || d.workflow, ts: Date.now() });
      }
      if (d.action === "notify_kirill") {
        state.notifications.push({ msg: d.message?.slice(0, 50), ts: Date.now() });
      }
    } else {
      blocked.push({ decision: d, reason: result.reason, gate: result.gate });
      log(`[ENFORCER] BLOCKED: ${result.gate} — ${result.reason}`);
    }
  }

  saveEnforcementState(state);

  // Save blocked decisions so brain can see them next cycle and NOT repeat
  if (blocked.length > 0) {
    log(`[ENFORCER] ${enforced.length} allowed, ${blocked.length} blocked`);
    try {
      const blocksPath = resolve(ROOT, ".data/cortex-enforcer-blocks.json");
      const blocksData = blocked.map(b => ({
        action: b.decision.action,
        target: b.decision.bot || b.decision.workflow || b.decision.topic || "",
        reason: b.reason,
        gate: b.gate,
        ts: new Date().toISOString(),
      }));
      writeFileSync(blocksPath, JSON.stringify(blocksData, null, 2));
    } catch (e) {
      log(`[ENFORCER] Failed to save blocks: ${e.message}`);
    }
  } else {
    // Clear blocks file when nothing is blocked
    try {
      const blocksPath = resolve(ROOT, ".data/cortex-enforcer-blocks.json");
      writeFileSync(blocksPath, "[]");
    } catch {}
  }

  return enforced;
}

// ── ENFORCE A SINGLE DECISION ──────────────────────────────────────────

function enforceOne(decision, state, strategy, config, kpdData, db) {
  const d = decision;

  // ── GATE 1: BUDGET ────────────────────────────────────────────────
  if (d.action === "run_bot" || d.action === "run_workflow") {
    const budget = checkBudget(0.10);
    if (!budget.allowed) {
      return { allowed: false, gate: "BUDGET", reason: `Daily budget exhausted ($${budget.spent.toFixed(2)} spent)` };
    }
  }

  // ── GATE 2: CHANNEL (dead channels blocked) ───────────────────────
  if (d.action === "run_bot" && strategy?.channels) {
    const botToChannel = {
      "icp-outreach-bot": getChannelForBot("icp-outreach-bot", strategy),
      "vapi-outbound-caller": "vapi_outbound",
      "content-bot": "linkedin",
    };
    const channel = botToChannel[d.bot];
    if (channel && strategy.channels[channel]?.weight < 15) {
      return {
        allowed: false,
        gate: "CHANNEL",
        reason: `Channel "${channel}" weight=${strategy.channels[channel].weight} (< 15 threshold). Dead channel.`
      };
    }
  }

  // ── GATE 3: KPD (inefficient bots blocked) ────────────────────────
  if (d.action === "run_bot") {
    const botKpd = kpdData.find(k => k.bot_name === d.bot);
    if (botKpd && botKpd.runs >= 5 && botKpd.avg_kpd < 0.1 && botKpd.total_value === 0) {
      // Queue-aware exception: never block processing bots when actionable input exists.
      // KPD=0 was designed to skip empty-queue runs, not to prevent processing real inbound.
      if (d.bot === "lead-enrichment-bot" || d.bot === "sales-bot") {
        let hasQueue = false;
        try {
          const newLeads = db.prepare("SELECT COUNT(*) as n FROM leads WHERE stage = 'new'").get()?.n || 0;
          const pendingReplies = db.prepare("SELECT COUNT(*) as n FROM outreach_emails WHERE status = 'replied'").get()?.n || 0;
          hasQueue = newLeads > 0 || pendingReplies > 0;
        } catch {}
        if (hasQueue) return { allowed: true };
      }
      return {
        allowed: false,
        gate: "KPD",
        reason: `${d.bot} has KPD=${botKpd.avg_kpd} over ${botKpd.runs} runs with $0 value. Blocked until conditions change.`
      };
    }
  }

  // ── GATE 4: REPEAT (same action max 2x per hour) ──────────────────
  if (d.action === "run_bot" || d.action === "run_workflow") {
    const target = d.bot || d.workflow;
    const hourAgo = Date.now() - 60 * 60 * 1000;
    const recentSame = state.actions.filter(a => a.target === target && a.ts > hourAgo).length;
    if (recentSame >= 2) {
      return {
        allowed: false,
        gate: "REPEAT",
        reason: `${target} already ran ${recentSame}x in the last hour. Max 2.`
      };
    }
  }

  // ── GATE 5: SPAM (max 3 notifications per hour) ───────────────────
  if (d.action === "notify_kirill") {
    const hourAgo = Date.now() - 60 * 60 * 1000;
    const recentNotifs = state.notifications.filter(n => n.ts > hourAgo).length;
    if (recentNotifs >= 1) {
      return {
        allowed: false,
        gate: "SPAM",
        reason: `Already sent ${recentNotifs} notification(s) this hour. Max 1. Kirill hates spam.`
      };
    }

    // Also block duplicate messages
    const lastMsg = d.message?.slice(0, 50);
    const duplicate = state.notifications.find(n => n.msg === lastMsg && n.ts > hourAgo);
    if (duplicate) {
      return {
        allowed: false,
        gate: "SPAM",
        reason: `Duplicate notification blocked: "${lastMsg}"`
      };
    }
  }

  // ── GATE 6: STRATEGIC (force outreach if revenue = $0 too long) ───
  if (d.action === "run_bot" || d.action === "run_workflow") {
    const nonRevenueActions = ["site-curator-bot", "evolution-bot", "awareness-bot", "idea-bot"];
    const revenueActions = ["scout-bot", "icp-outreach-bot", "lead-enrichment-bot", "sales-bot",
                           "monitor-replies", "content-bot", "brief-agent"];

    // Check if revenue is still $0
    let revenue = 0;
    try { revenue = db.prepare("SELECT COALESCE(SUM(amount), 0) as r FROM deals WHERE status = 'won'").get()?.r || 0; } catch {}

    if (revenue === 0) {
      const target = d.bot || d.workflow;
      // Block non-revenue bots when revenue = $0 (except brief which is always useful)
      if (nonRevenueActions.includes(target)) {
        return {
          allowed: false,
          gate: "STRATEGIC",
          reason: `Revenue = $0. Only revenue-generating actions allowed. ${target} is not revenue-generating.`
        };
      }
    }
  }

  // ── GATE 7: DISABLED BOT ──────────────────────────────────────────
  if (d.action === "run_bot") {
    const botConfig = config.bots?.[d.bot];
    if (botConfig?.enabled === false) {
      return {
        allowed: false,
        gate: "DISABLED",
        reason: `${d.bot} is disabled: ${botConfig.disabled_reason || "no reason given"}`
      };
    }
  }

  // ── GATE 8: EMOTIONAL GOVERNANCE ────────────────────────────────────
  // Emotions inform decisions but governance has FINAL SAY

  // 8a. Safety valve - block ALL actions during emotional meltdown
  const safetyCheck = safetyValveCheck();
  if (!safetyCheck.safe) {
    if (d.action !== "skip" && d.action !== "remember") {
      return {
        allowed: false,
        gate: "EMOTIONAL_SAFETY",
        reason: safetyCheck.reason,
      };
    }
  }

  // 8b. Emotional limits - prevent desperation-driven spam
  const limits = getEmotionalLimits();
  if (d.action === "run_bot" || d.action === "run_workflow" || d.action === "execute_hands") {
    const hourAgo = Date.now() - 60 * 60 * 1000;
    const actionsThisHour = state.actions.filter(a => a.ts > hourAgo).length;
    if (actionsThisHour >= limits.maxActionsPerHour) {
      return {
        allowed: false,
        gate: "EMOTIONAL_LIMIT",
        reason: `Emotional limit: max ${limits.maxActionsPerHour} actions/hour (currently ${actionsThisHour}). Desperation doesn't help - calm decisions do.`,
      };
    }
  }

  // 8c. Desperation guard - if desperation > 0.7, block outreach-type actions
  // (desperate outreach sounds desperate and hurts brand)
  const emotions = getEmotionalState();
  if (emotions.desperation > 0.7) {
    if (d.action === "run_bot" && ["icp-outreach-bot", "vapi-outbound-caller", "sales-bot"].includes(d.bot)) {
      return {
        allowed: false,
        gate: "DESPERATION_GUARD",
        reason: `Desperation too high (${(emotions.desperation * 100).toFixed(0)}%). Desperate outreach hurts brand. Research or introspect instead.`,
      };
    }
  }

  return { allowed: true };
}

// ── HELPERS ─────────────────────────────────────────────────────────────

function getChannelForBot(botName, strategy) {
  // Map bots to their primary channel
  const map = {
    "scout-bot": "reddit_comments",
    "icp-outreach-bot": "reddit_comments",
    "vapi-outbound-caller": "vapi_outbound",
    "content-bot": "linkedin",
    "monitor-replies": null, // infrastructure, always allowed
    "lead-enrichment-bot": null,
    "brief-agent": null,
  };
  return map[botName] || null;
}

// ── EXPLAIN WHY SOMETHING WAS BLOCKED (for brain context) ──────────────

export function getEnforcementSummary() {
  const state = loadEnforcementState();
  const hourAgo = Date.now() - 60 * 60 * 1000;
  const recentActions = state.actions.filter(a => a.ts > hourAgo);
  const recentNotifs = state.notifications.filter(n => n.ts > hourAgo);

  return {
    actionsThisHour: recentActions.length,
    notificationsThisHour: recentNotifs.length,
    notifSlotsRemaining: Math.max(0, 3 - recentNotifs.length),
  };
}
