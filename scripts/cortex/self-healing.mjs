/**
 * CORTEX SELF-HEALING — Autonomous failure recovery
 *
 * When bots fail repeatedly, CORTEX doesn't just log it:
 * 1. DETECT - track failure counts per bot
 * 2. DIAGNOSE - categorize the failure type
 * 3. ADAPT - disable broken bot, switch to alternative approach
 * 4. RECOVER - re-enable after cooldown if conditions change
 * 5. NOTIFY - tell Kirill only when stuck (not every failure)
 *
 * Failure categories:
 * - TRANSIENT: API timeout, rate limit -> retry with backoff
 * - PERSISTENT: crash, missing dependency -> disable + notify
 * - ENVIRONMENTAL: missing API key, wrong config -> fix config
 * - STRATEGIC: bot runs but produces 0 value -> replace approach
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { remember, recall } from "./memory.mjs";
import { updateBotConfig, readConfig } from "./config-injection.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const HEALING_STATE_PATH = resolve(ROOT, ".data/cortex-healing-state.json");

// ── FAILURE TRACKER ────────────────────────────────────────────────────

function loadHealingState() {
  if (!existsSync(HEALING_STATE_PATH)) return { bots: {}, lastCheck: null };
  try {
    return JSON.parse(readFileSync(HEALING_STATE_PATH, "utf-8"));
  } catch { return { bots: {}, lastCheck: null }; }
}

function saveHealingState(state) {
  state.lastCheck = new Date().toISOString();
  writeFileSync(HEALING_STATE_PATH, JSON.stringify(state, null, 2));
}

// ── RECORD A FAILURE ───────────────────────────────────────────────────

export function recordFailure(botName, error, log = console.log) {
  const state = loadHealingState();

  if (!state.bots[botName]) {
    state.bots[botName] = {
      failures: [],
      consecutiveFailures: 0,
      disabled: false,
      disabledAt: null,
      disabledReason: null,
      cooldownUntil: null,
      totalFailures: 0,
      totalSuccesses: 0,
    };
  }

  const bot = state.bots[botName];
  bot.consecutiveFailures++;
  bot.totalFailures++;
  bot.failures.push({
    error: (error || "unknown").slice(0, 200),
    at: new Date().toISOString(),
    category: categorizeError(error),
  });

  // Keep only last 20 failures
  if (bot.failures.length > 20) bot.failures = bot.failures.slice(-20);

  saveHealingState(state);
  return bot;
}

// ── RECORD A SUCCESS ───────────────────────────────────────────────────

export function recordSuccess(botName) {
  const state = loadHealingState();
  if (!state.bots[botName]) return;

  const bot = state.bots[botName];
  bot.consecutiveFailures = 0;
  bot.totalSuccesses++;

  // If was disabled and succeeded, re-enable
  if (bot.disabled) {
    bot.disabled = false;
    bot.disabledAt = null;
    bot.disabledReason = null;
  }

  saveHealingState(state);
}

// ── CATEGORIZE ERROR ───────────────────────────────────────────────────

function categorizeError(error) {
  if (!error) return "unknown";
  const e = error.toLowerCase();

  if (e.includes("timeout") || e.includes("timed out")) return "transient";
  if (e.includes("max turns") || e.includes("reached max")) return "transient";
  if (e.includes("429") || e.includes("rate limit")) return "transient";
  if (e.includes("econnreset") || e.includes("enotfound")) return "transient";
  if (e.includes("api key") || e.includes("unauthorized") || e.includes("401")) return "environmental";
  if (e.includes("missing") || e.includes("not found") || e.includes("enoent")) return "environmental";
  if (e.includes("slice") || e.includes("undefined") || e.includes("null")) return "persistent";
  if (e.includes("cannot read") || e.includes("is not a function")) return "persistent";
  if (e.includes("credit") || e.includes("quota") || e.includes("insufficient")) return "environmental";

  return "unknown";
}

// ── HEALING DECISION ───────────────────────────────────────────────────

export function checkAndHeal(db, log = console.log) {
  const state = loadHealingState();
  const actions = [];

  for (const [botName, bot] of Object.entries(state.bots)) {
    // Skip already disabled bots (check cooldown)
    if (bot.disabled) {
      if (bot.cooldownUntil && new Date() > new Date(bot.cooldownUntil)) {
        // Cooldown expired - re-enable for retry
        bot.disabled = false;
        bot.consecutiveFailures = 0;
        bot.disabledReason = null;
        updateBotConfig(botName, { enabled: true });
        actions.push({
          bot: botName,
          action: "re-enabled",
          reason: "Cooldown expired. Retrying.",
        });
        log(`[HEAL] Re-enabled ${botName} after cooldown`);
      }
      continue;
    }

    // Analyze failure pattern
    if (bot.consecutiveFailures >= 3) {
      const recentCategories = bot.failures.slice(-3).map(f => f.category);
      const allSameCategory = recentCategories.every(c => c === recentCategories[0]);
      const category = allSameCategory ? recentCategories[0] : "mixed";

      let action;

      switch (category) {
        case "transient":
          // Transient errors: increase backoff, don't disable yet
          if (bot.consecutiveFailures >= 5) {
            action = disableBot(state, botName, "Transient errors 5x in a row. Cooling down 30 min.", 30);
          } else {
            action = { bot: botName, action: "backoff", reason: "Transient errors, will retry next cycle" };
          }
          break;

        case "environmental":
          // Missing API key or config: disable until fixed
          action = disableBot(state, botName, `Environmental: ${bot.failures.at(-1)?.error}. Needs manual fix.`, 120);
          break;

        case "persistent":
          // Code bug: disable for longer
          action = disableBot(state, botName, `Persistent crash: ${bot.failures.at(-1)?.error}. Code fix needed.`, 240);
          break;

        default:
          // Mixed/unknown: disable with medium cooldown
          if (bot.consecutiveFailures >= 5) {
            action = disableBot(state, botName, `${bot.consecutiveFailures} consecutive failures (mixed types).`, 60);
          }
          break;
      }

      if (action) {
        actions.push(action);
        log(`[HEAL] ${action.action}: ${botName} - ${action.reason}`);

        // Write to CORTEX memory
        remember(db, "episodic",
          `Self-healing: ${action.action} ${botName}. Reason: ${action.reason}`,
          "self-healing", "cortex", 0.9);
      }
    }
  }

  // Check for strategic failures (bot runs but 0 value)
  const strategicActions = checkStrategicFailures(db, state, log);
  actions.push(...strategicActions);

  saveHealingState(state);
  return actions;
}

// ── DISABLE A BOT ──────────────────────────────────────────────────────

function disableBot(state, botName, reason, cooldownMinutes) {
  const bot = state.bots[botName];
  bot.disabled = true;
  bot.disabledAt = new Date().toISOString();
  bot.disabledReason = reason;
  bot.cooldownUntil = new Date(Date.now() + cooldownMinutes * 60_000).toISOString();

  // Write to config so CORTEX brain knows
  updateBotConfig(botName, { enabled: false, disabled_reason: reason, cooldown_until: bot.cooldownUntil });

  return {
    bot: botName,
    action: "disabled",
    reason,
    cooldownMinutes,
    cooldownUntil: bot.cooldownUntil,
  };
}

// ── STRATEGIC FAILURE CHECK ────────────────────────────────────────────

function checkStrategicFailures(db, state, log) {
  const actions = [];

  try {
    // Check KPD: bots that ran many times but produced 0 value
    const kpd = db.prepare(`
      SELECT bot_name, COUNT(*) as runs, SUM(output_value) as total_value, SUM(cost_usd) as total_cost
      FROM cortex_kpd
      WHERE run_at > datetime('now', '-3 days')
      GROUP BY bot_name
      HAVING runs >= 3 AND total_value = 0 AND total_cost > 0
    `).all();

    for (const k of kpd) {
      const botState = state.bots[k.bot_name] || {};
      if (botState.disabled) continue;

      // This bot is burning money with 0 results
      const reason = `Strategic: ${k.runs} runs, $${k.total_cost.toFixed(2)} spent, 0 value produced in 3 days.`;
      const action = disableBot(state, k.bot_name, reason, 360); // 6 hour cooldown
      actions.push(action);
      log(`[HEAL] STRATEGIC DISABLE: ${k.bot_name} - ${reason}`);

      remember(db, "procedural",
        `Bot ${k.bot_name} produces 0 value after ${k.runs} runs ($${k.total_cost.toFixed(2)} wasted). Consider replacing approach.`,
        "self-healing", "cortex", 0.9);
    }
  } catch {}

  return actions;
}

// ── ALTERNATIVE APPROACH SUGGESTIONS ───────────────────────────────────

const ALTERNATIVE_APPROACHES = {
  "scout-bot": {
    alternatives: ["awareness-bot", "reddit-monitor"],
    strategy: "If scout finds 0 leads, try awareness-bot to discover new channels, or reddit-monitor for direct engagement.",
  },
  "icp-outreach-bot": {
    alternatives: ["content-bot"],
    strategy: "If outreach produces 0 drafts, switch to content marketing (LinkedIn posts) to attract inbound leads.",
  },
  "lead-enrichment-bot": {
    alternatives: [],
    strategy: "If enrichment keeps failing, skip enrichment and send to Kirill for manual classification.",
  },
};

export function suggestAlternative(botName) {
  return ALTERNATIVE_APPROACHES[botName] || null;
}

// ── GET HEALING STATUS ─────────────────────────────────────────────────

export function getHealingStatus() {
  const state = loadHealingState();
  const disabled = Object.entries(state.bots)
    .filter(([_, b]) => b.disabled)
    .map(([name, b]) => ({ name, reason: b.disabledReason, cooldownUntil: b.cooldownUntil }));

  const unhealthy = Object.entries(state.bots)
    .filter(([_, b]) => b.consecutiveFailures >= 2 && !b.disabled)
    .map(([name, b]) => ({ name, failures: b.consecutiveFailures }));

  return { disabled, unhealthy, totalBots: Object.keys(state.bots).length };
}
