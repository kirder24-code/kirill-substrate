/**
 * SYSTEM DOCTOR — The brain that watches the brain and FIXES it
 *
 * This is NOT monitoring. This is AUTONOMOUS CORRECTION.
 *
 * Every 30 minutes, the Doctor examines CORTEX and asks:
 * 1. Is the brain stuck in a loop? → BREAK the loop
 * 2. Is money being wasted? → CUT the waste
 * 3. Are bots producing zero? → CHANGE the approach
 * 4. Is deep think too expensive? → SWITCH to fast think
 * 5. Has strategy stagnated? → FORCE a new experiment
 *
 * The Doctor has OVERRIDE power — it can:
 * - Rewrite the brain's system prompt
 * - Disable expensive thinking modes
 * - Force specific workflows
 * - Change budget allocation
 * - Reset stuck memory patterns
 * - Inject new procedural rules
 *
 * When Kirill is away for a week, the Doctor keeps the system alive.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import { remember, recall, markOutdated, getRecentDecisions, getAllKPD } from "./memory.mjs";
import { readConfig, writeConfig, recordSpend } from "./config-injection.mjs";
import { getHealingStatus } from "./self-healing.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DB_PATH = resolve(ROOT, ".data/linkedin-brand-os.sqlite");
const DOCTOR_STATE_PATH = resolve(ROOT, ".data/cortex-doctor-state.json");

// ── DOCTOR STATE ───────────────────────────────────────────────────────

function loadDoctorState() {
  if (!existsSync(DOCTOR_STATE_PATH)) return {
    lastCheck: null,
    interventions: [],
    deepThinkOverride: null, // null = auto, "force_fast" = always fast, "force_deep" = always deep
    loopDetected: false,
    wasteDetected: false,
    totalInterventions: 0,
    lastExperiment: null,
  };
  try { return JSON.parse(readFileSync(DOCTOR_STATE_PATH, "utf-8")); } catch { return loadDoctorState(); }
}

function saveDoctorState(state) {
  state.lastCheck = new Date().toISOString();
  // Keep only last 50 interventions
  if (state.interventions.length > 50) state.interventions = state.interventions.slice(-50);
  writeFileSync(DOCTOR_STATE_PATH, JSON.stringify(state, null, 2));
}

// ── MAIN EXAMINATION ───────────────────────────────────────────────────

// Cooldown (hours) per intervention type - prevents flooding the state with identical entries
const INTERVENTION_COOLDOWN_HOURS = {
  "reset_bot_strategy": 6,
  "reduce_thinking": 4,
  "cut_waste": 8,
  "stop_spam": 2,
  "break_notification_loop": 1,
};

function wasRecentlyApplied(state, type) {
  const hours = INTERVENTION_COOLDOWN_HOURS[type];
  if (!hours) return false;
  const cutoff = Date.now() - hours * 3_600_000;
  return (state.interventions || []).some(
    i => i.type === type && new Date(i.appliedAt).getTime() > cutoff
  );
}

export function runDoctor(db, log = console.log) {
  log("[DOCTOR] === SYSTEM EXAMINATION ===");
  const state = loadDoctorState();
  const interventions = [];

  // EXAM 1: Is the brain stuck in a loop?
  const loopFix = examineLoopStuck(db, log);
  if (loopFix) interventions.push(loopFix);

  // EXAM 2: Is money being wasted?
  const wasteFix = examineWaste(db, log);
  if (wasteFix && !wasRecentlyApplied(state, wasteFix.type)) interventions.push(wasteFix);

  // EXAM 3: Are bots producing zero value?
  const botFix = examineBotsZeroValue(db, log);
  if (botFix && !wasRecentlyApplied(state, botFix.type)) interventions.push(botFix);
  else if (botFix) log(`[DOCTOR] SKIP ${botFix.type}: already applied within ${INTERVENTION_COOLDOWN_HOURS[botFix.type]}h`);

  // EXAM 4: Is deep think too expensive?
  const thinkFix = examineThinkCost(db, state, log);
  if (thinkFix && !wasRecentlyApplied(state, thinkFix.type)) interventions.push(thinkFix);
  else if (thinkFix) log(`[DOCTOR] SKIP ${thinkFix.type}: already applied within ${INTERVENTION_COOLDOWN_HOURS[thinkFix.type]}h`);

  // EXAM 5: Has strategy stagnated?
  const stratFix = examineStagnation(db, state, log);
  if (stratFix) interventions.push(stratFix);

  // EXAM 6: Is the system just sending notifications instead of acting?
  const notifFix = examineNotificationLoop(db, log);
  if (notifFix && !wasRecentlyApplied(state, notifFix.type)) interventions.push(notifFix);

  // Apply all interventions
  for (const fix of interventions) {
    applyIntervention(db, fix, state, log);
  }

  state.totalInterventions += interventions.length;
  saveDoctorState(state);

  log(`[DOCTOR] Examination complete: ${interventions.length} interventions applied`);
  return interventions;
}

// ── EXAM 1: Loop Detection ─────────────────────────────────────────────

function examineLoopStuck(db, log) {
  const decisions = getRecentDecisions(db, 10);
  if (decisions.length < 4) return null;

  // Check if last 4 decisions have the same thinking pattern
  const thinkings = decisions.slice(0, 4).map(d => (d.decision || "").slice(0, 60));
  const unique = new Set(thinkings);

  if (unique.size <= 2) {
    log(`[DOCTOR] LOOP DETECTED: Last 4 decisions are identical: "${thinkings[0]}"`);
    return {
      type: "break_loop",
      severity: "critical",
      diagnosis: `Brain stuck repeating: "${thinkings[0]}"`,
      prescription: "Clear working memory, inject fresh directive, force lead-pipeline workflow",
    };
  }

  // Check if brain is just sending notifications without running bots
  const recentActions = decisions.slice(0, 5).map(d => {
    try { return JSON.parse(d.actions_taken || "[]"); } catch { return []; }
  }).flat();

  const notifCount = recentActions.filter(a => a.action === "notify_kirill").length;
  const botCount = recentActions.filter(a => a.action === "run_bot" || a.action === "run_workflow").length;

  if (notifCount > 3 && botCount === 0) {
    log(`[DOCTOR] NOTIFICATION LOOP: ${notifCount} notifications, ${botCount} bot runs in last 5 cycles`);
    return {
      type: "break_notification_loop",
      severity: "high",
      diagnosis: `Brain sends ${notifCount} notifications but runs 0 bots. Useless.`,
      prescription: "Inject rule: stop notifying, start running lead-pipeline",
    };
  }

  return null;
}

// ── EXAM 2: Money Waste ────────────────────────────────────────────────

function examineWaste(db, log) {
  const config = readConfig();
  const spent = config.global.spent_today_usd || 0;
  const budget = config.global.daily_budget_usd || 5;

  // Check if we spent > 50% of budget with zero results
  const kpd = getAllKPD(db, 1); // last day
  const totalValue = kpd.reduce((sum, k) => sum + (k.total_value || 0), 0);

  if (spent > budget * 0.5 && totalValue === 0) {
    log(`[DOCTOR] WASTE: $${spent.toFixed(2)} spent today, $0 value produced`);
    return {
      type: "cut_waste",
      severity: "high",
      diagnosis: `$${spent.toFixed(2)} spent with $0 value. ROI = 0.`,
      prescription: "Reduce budget to $1/day, switch to fast-think only, run only lead-pipeline",
    };
  }

  return null;
}

// ── EXAM 3: Bots Zero Value ────────────────────────────────────────────

function examineBotsZeroValue(db, log) {
  const kpd = getAllKPD(db, 3);
  const zeroBots = kpd.filter(k => k.runs >= 3 && (k.total_value || 0) === 0);

  if (zeroBots.length >= 3) {
    log(`[DOCTOR] ZERO VALUE: ${zeroBots.length} bots produced $0 value in 3 days`);
    return {
      type: "reset_bot_strategy",
      severity: "high",
      diagnosis: `${zeroBots.map(b => b.bot_name).join(", ")} all produce 0 value after multiple runs`,
      prescription: "Disable all zero-value bots except scout-bot and icp-outreach-bot. Clear their KPD history. Give them fresh start with updated config.",
    };
  }

  return null;
}

// ── EXAM 4: Deep Think Cost ────────────────────────────────────────────

function examineThinkCost(db, state, log) {
  const config = readConfig();
  const spent = config.global.spent_today_usd || 0;

  // Estimate: each deep think = $0.035, fast = $0.005
  // If we've done many cycles and spending is high relative to actions
  const decisions = getRecentDecisions(db, 20);
  const botRuns = decisions.map(d => {
    try { return JSON.parse(d.actions_taken || "[]"); } catch { return []; }
  }).flat().filter(a => a.action === "run_bot" || a.action === "run_workflow").length;

  // If we've spent > $1 on thinking but ran < 3 bots, deep think is waste
  if (spent > 1 && botRuns < 3 && decisions.length > 5) {
    log(`[DOCTOR] THINK WASTE: $${spent.toFixed(2)} spent, only ${botRuns} bot runs`);
    return {
      type: "reduce_thinking",
      severity: "medium",
      diagnosis: `Spending too much on thinking ($${spent.toFixed(2)}) vs acting (${botRuns} bot runs)`,
      prescription: "Switch to fast-think only for next 2 hours. Deep think only for morning brief.",
    };
  }

  return null;
}

// ── EXAM 5: Strategy Stagnation ────────────────────────────────────────

function examineStagnation(db, state, log) {
  // If no experiment has been tried in 24 hours, force one
  const lastExperiment = state.lastExperiment;
  const hoursSinceExperiment = lastExperiment
    ? (Date.now() - new Date(lastExperiment).getTime()) / 3600000
    : 999;

  if (hoursSinceExperiment > 24) {
    log(`[DOCTOR] STAGNATION: No new experiment in ${Math.round(hoursSinceExperiment)}h`);
    return {
      type: "force_experiment",
      severity: "medium",
      diagnosis: `No new approach tried in ${Math.round(hoursSinceExperiment)} hours. System is stale.`,
      prescription: "Force lead-pipeline with updated scoring. If it finds 0 leads, try content-pipeline next.",
    };
  }

  return null;
}

// ── EXAM 6: Notification Loop ──────────────────────────────────────────

function examineNotificationLoop(db, log) {
  // Check if CORTEX sent > 5 similar notifications today
  const decisions = getRecentDecisions(db, 15);
  const notifications = decisions.map(d => {
    try { return JSON.parse(d.actions_taken || "[]"); } catch { return []; }
  }).flat().filter(a => a.action === "notify_kirill").map(a => (a.message || "").slice(0, 40));

  const counts = {};
  for (const n of notifications) { counts[n] = (counts[n] || 0) + 1; }
  const repeated = Object.entries(counts).filter(([, c]) => c >= 3);

  if (repeated.length > 0) {
    log(`[DOCTOR] SPAM: "${repeated[0][0]}" sent ${repeated[0][1]} times`);
    return {
      type: "stop_spam",
      severity: "high",
      diagnosis: `Notification "${repeated[0][0]}" repeated ${repeated[0][1]} times. This is spam.`,
      prescription: "Inject anti-spam rule into procedural memory. Force brain to run workflow instead of notify.",
    };
  }

  return null;
}

// ── APPLY INTERVENTION ─────────────────────────────────────────────────

function applyIntervention(db, fix, state, log) {
  log(`[DOCTOR] INTERVENTION: ${fix.type} — ${fix.prescription}`);

  switch (fix.type) {
    case "break_loop":
    case "break_notification_loop": {
      // 1. Clear working memory (brain is stuck on old context)
      const workingMems = recall(db, "working", null, 20);
      for (const m of workingMems) {
        markOutdated(db, m.id, "Doctor: clearing stuck loop context");
      }

      // 2. Inject fresh directive
      remember(db, "working", "DOCTOR OVERRIDE: Stop repeating. Run lead-pipeline workflow NOW. Do not just notify - ACT.", "directive", "doctor", 1.0);
      remember(db, "procedural", "RULE (Doctor): If you have nothing new to say, run lead-pipeline workflow. Never send the same notification twice.", "doctor-rule", "doctor", 0.95);

      // 3. Force next cycle to run lead-pipeline
      const config = readConfig();
      if (!config._doctorForce) config._doctorForce = {};
      config._doctorForce.nextAction = "run_workflow";
      config._doctorForce.nextTarget = "lead-pipeline";
      config._doctorForce.reason = "Doctor: breaking decision loop";
      config._doctorForce.expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
      writeConfig(config);
      break;
    }

    case "cut_waste": {
      const config = readConfig();
      config.global.daily_budget_usd = Math.max(1, config.global.daily_budget_usd * 0.5);
      writeConfig(config);
      remember(db, "procedural", "RULE (Doctor): Budget was cut because $0 value produced. Only run lead-pipeline and reply-pipeline. No experiments until revenue > $0.", "doctor-rule", "doctor", 0.95);
      state.deepThinkOverride = "force_fast";
      break;
    }

    case "reset_bot_strategy": {
      // Clear KPD for zero-value bots so they get a fresh evaluation
      try {
        db.prepare("DELETE FROM cortex_kpd WHERE output_value = 0 AND run_at < datetime('now', '-1 day')").run();
      } catch {}
      remember(db, "working", "DOCTOR RESET: Bot KPD history cleared. Fresh evaluation cycle. Focus on lead-pipeline.", "directive", "doctor", 1.0);
      break;
    }

    case "reduce_thinking": {
      state.deepThinkOverride = "force_fast";
      remember(db, "procedural", "RULE (Doctor): Deep think temporarily disabled. Use fast think. Too much money spent on thinking vs acting.", "doctor-rule", "doctor", 0.9);
      break;
    }

    case "force_experiment": {
      const config = readConfig();
      if (!config._doctorForce) config._doctorForce = {};
      config._doctorForce.nextAction = "run_workflow";
      config._doctorForce.nextTarget = "lead-pipeline";
      config._doctorForce.reason = "Doctor: forced experiment after stagnation";
      config._doctorForce.expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
      writeConfig(config);
      state.lastExperiment = new Date().toISOString();
      remember(db, "working", "DOCTOR: Forced lead-pipeline experiment. System was stagnant for 24h+.", "directive", "doctor", 1.0);
      break;
    }

    case "stop_spam": {
      remember(db, "procedural", "RULE (Doctor): NEVER send the same notification twice. If you already notified about something, run a workflow instead. Notifications without action = waste.", "doctor-rule", "doctor", 0.95);
      break;
    }
  }

  state.interventions.push({
    type: fix.type,
    severity: fix.severity,
    diagnosis: fix.diagnosis,
    prescription: fix.prescription,
    appliedAt: new Date().toISOString(),
  });
}

// ── DOCTOR FORCE CHECK (daemon reads this before brain thinks) ──────────

export function checkDoctorForce() {
  const config = readConfig();
  const force = config._doctorForce;
  if (!force || !force.nextAction) return null;

  // Check if expired
  if (force.expiresAt && new Date() > new Date(force.expiresAt)) {
    delete config._doctorForce;
    writeConfig(config);
    return null;
  }

  // Return the forced action and clear it
  const action = { ...force };
  delete config._doctorForce;
  writeConfig(config);
  return action;
}

// ── SHOULD DEEP THINK? (Doctor can override) ───────────────────────────

export function doctorAllowsDeepThink() {
  const state = loadDoctorState();
  if (state.deepThinkOverride === "force_fast") {
    // Check if override has been active for > 2 hours, auto-expire
    const lastCheck = state.lastCheck ? new Date(state.lastCheck) : new Date();
    if (Date.now() - lastCheck.getTime() > 2 * 3600_000) {
      state.deepThinkOverride = null;
      saveDoctorState(state);
      return true;
    }
    return false;
  }
  if (state.deepThinkOverride === "force_deep") return true;
  return null; // null = let normal logic decide
}

// ── GET DOCTOR STATUS (for dashboard) ──────────────────────────────────

export function getDoctorStatus() {
  const state = loadDoctorState();
  return {
    lastCheck: state.lastCheck,
    totalInterventions: state.totalInterventions,
    recentInterventions: (state.interventions || []).slice(-5),
    deepThinkOverride: state.deepThinkOverride,
    loopDetected: state.loopDetected,
  };
}
