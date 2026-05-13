/**
 * scripts/tolik/goals.mjs
 *
 * Tolik's awareness of what Kirill is actually trying to achieve. Goals
 * are explicit numbers/states with a target and a current value (read
 * live from substrate when possible). Tolik:
 *   1. Mentions them in proactive observations
 *   2. Praises when current moves towards target
 *   3. Nudges when stalled
 *
 * Goals live in .data/tolik-goals.json. Kirill can edit by voice
 * ("Толик, поставь цель: 30 квалифицированных лидов до конца месяца")
 * - that writes a new entry via add_goal action.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const GOALS_PATH = resolve(ROOT, ".data/tolik-goals.json");
const SURVIVAL_DB = resolve(ROOT, ".data/survival.db");
const MAIN_DB = resolve(ROOT, ".data/linkedin-brand-os.sqlite");

const DEFAULT_GOALS = [
  {
    id: "revenue_monthly",
    label: "Месячная выручка",
    target: 5000,
    unit: "USD/мес",
    measure: { kind: "manual", current: 0 },
    deadline: null,
    why: "Floor для выживания solo-операции и подтверждение что substrate→Tolik→продажа работает",
  },
  {
    id: "qualified_leads_week",
    label: "Квалифицированных лидов в неделю",
    target: 10,
    unit: "leads",
    measure: { kind: "leads_db" },
    deadline: null,
    why: "Минимум для устойчивого pipeline на месяц",
  },
  {
    id: "posts_per_week",
    label: "Постов в LinkedIn в неделю",
    target: 3,
    unit: "posts",
    measure: { kind: "linkedin_posts_7d" },
    deadline: null,
    why: "Дистрибуция собственного capability как AI-архитектора",
  },
  {
    id: "opps_active",
    label: "Активные opportunities",
    target: 5,
    unit: "opps",
    measure: { kind: "opps_active" },
    deadline: null,
    why: "Pipeline должен быть всегда наполнен, без него нет cash flow",
  },
];

function loadGoals() {
  if (!existsSync(GOALS_PATH)) {
    saveGoals(DEFAULT_GOALS);
    return DEFAULT_GOALS;
  }
  try { return JSON.parse(readFileSync(GOALS_PATH, "utf-8")); }
  catch { return DEFAULT_GOALS; }
}
function saveGoals(goals) {
  if (!existsSync(dirname(GOALS_PATH))) mkdirSync(dirname(GOALS_PATH), { recursive: true });
  writeFileSync(GOALS_PATH, JSON.stringify(goals, null, 2));
}

function measureCurrent(measure) {
  try {
    if (measure?.kind === "manual") return measure.current ?? 0;
    if (measure?.kind === "opps_active") {
      const db = new Database(SURVIVAL_DB, { readonly: true, fileMustExist: true });
      const r = db.prepare(`SELECT COUNT(*) AS n FROM opportunities WHERE state IN ('qualified','researched','planned','in_progress')`).get();
      db.close();
      return r.n;
    }
    if (measure?.kind === "leads_db" && existsSync(MAIN_DB)) {
      const db = new Database(MAIN_DB, { readonly: true });
      try {
        const r = db.prepare(`SELECT COUNT(*) AS n FROM leads WHERE created_at > datetime('now','-7 days')`).get();
        db.close();
        return r.n;
      } catch { db.close(); return 0; }
    }
    if (measure?.kind === "linkedin_posts_7d" && existsSync(MAIN_DB)) {
      const db = new Database(MAIN_DB, { readonly: true });
      try {
        const r = db.prepare(`SELECT COUNT(*) AS n FROM published_posts WHERE created_at > datetime('now','-7 days')`).get();
        db.close();
        return r.n;
      } catch { db.close(); return 0; }
    }
  } catch {}
  return 0;
}

export function getGoals() {
  const goals = loadGoals();
  return goals.map(g => {
    const current = measureCurrent(g.measure);
    const pct = g.target > 0 ? Math.round((current / g.target) * 100) : 0;
    return {
      ...g,
      current,
      pct: Math.min(999, pct),
      status: pct >= 100 ? "done" : pct >= 70 ? "on_track" : pct >= 30 ? "starting" : "cold",
    };
  });
}

export function getGoalsBlock() {
  const goals = getGoals();
  if (goals.length === 0) return "(no goals set)";
  return `KIRILL'S CURRENT TARGETS:\n${goals.map(g =>
    `- ${g.label}: ${g.current} / ${g.target} ${g.unit} (${g.pct}% - ${g.status})${g.why ? ` // ${g.why}` : ""}`
  ).join("\n")}`;
}

export function getProgressDeltas() {
  // Snapshot last 6 hours of goal values; reads .data/tolik-goal-history.jsonl.
  const path = resolve(ROOT, ".data/tolik-goal-history.jsonl");
  const now = new Date();
  const current = getGoals().map(g => ({ id: g.id, current: g.current, ts: now.toISOString() }));
  // Append to history
  try {
    if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
    const fs = require("node:fs");
    for (const c of current) {
      writeFileSync(path, JSON.stringify(c) + "\n", { flag: "a" });
    }
  } catch {}
  return current;
}

export async function tolik_get_goals() {
  return { ok: true, goals: getGoals() };
}

export async function tolik_add_goal({ id, label, target, unit, measure, why, deadline }) {
  if (!id || !label || !target) return { ok: false, reason: "need_id_label_target" };
  const goals = loadGoals();
  if (goals.find(g => g.id === id)) return { ok: false, reason: "goal_id_exists" };
  goals.push({
    id, label, target,
    unit: unit || "",
    measure: measure || { kind: "manual", current: 0 },
    why: why || null,
    deadline: deadline || null,
  });
  saveGoals(goals);
  return { ok: true, goal: goals[goals.length - 1] };
}

export async function tolik_update_goal_value({ id, current }) {
  const goals = loadGoals();
  const g = goals.find(x => x.id === id);
  if (!g) return { ok: false, reason: "goal_not_found" };
  if (!g.measure || g.measure.kind !== "manual") return { ok: false, reason: "only_manual_goals_editable_directly" };
  g.measure.current = current;
  saveGoals(goals);
  return { ok: true, goal: g };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(getGoalsBlock());
}
