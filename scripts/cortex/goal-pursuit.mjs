/**
 * cortex/goal-pursuit.mjs - Hierarchical planning + persistent execution
 *   (Kirill's AGI roadmap direction #4: Agency, May 9 2026)
 *
 * Substrate moves from reactive (event -> handler) to proactive
 * (goal -> plan -> schedule -> execute -> review).
 *
 * Three-level hierarchy:
 *   1. TOP-LEVEL GOALS (months-years) - manually seeded by Kirill OR derived
 *      from sustained observation patterns. E.g., "Achieve financial
 *      sustainability via service business in 6 months."
 *   2. MID-LEVEL GOALS (weeks) - decomposed from top-level. E.g., "Land first
 *      paying client in 30 days. Build referral pipeline by day 60."
 *   3. TASKS (hours-days) - decomposed from mid-level. E.g., "Reply to
 *      Apollo by Tuesday. Send 5 personalized DMs to franchise CEOs this week."
 *
 * Operations:
 *   - decompose_top_to_mid: every 7 days, review top, decompose if mid empty
 *   - decompose_mid_to_tasks: every 24h, take active mid, generate tasks
 *   - dispatch_tasks: every hour, take pending tasks, send to cortex-executor
 *   - review_hierarchy: weekly, ask substrate (Claude) to review what worked
 *     and revise hierarchy
 *
 * Persistence: top-level-goals.json, mid-level-goals.json, tasks.json
 * survive across daemon restarts. Substrate continues pursuing across sessions.
 */

import { writeFileSync, readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const TOP_PATH = resolve(ROOT, ".data/top-level-goals.json");
const MID_PATH = resolve(ROOT, ".data/cortex-mid-level-goals.json");
const TASKS_PATH = resolve(ROOT, ".data/cortex-tasks.json");

const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";
const CLAUDE_MODEL = "claude-sonnet-4-6";
const CLAUDE_TIMEOUT_MS = 120_000;

// Intervals
const DECOMPOSE_TOP_TO_MID_INTERVAL_MS = 7 * 24 * 60 * 60_000;  // weekly
const DECOMPOSE_MID_TO_TASKS_INTERVAL_MS = 24 * 60 * 60_000;     // daily
const DISPATCH_TASKS_INTERVAL_MS = 60 * 60_000;                  // hourly
const REVIEW_HIERARCHY_INTERVAL_MS = 7 * 24 * 60 * 60_000;       // weekly

let _topGoals = []; // { id, title, why, deadline, status: active|completed|abandoned, created_at, decomposed_at }
let _midGoals = []; // { id, top_id, title, success_criterion, deadline, status, generated_at }
let _tasks = [];     // { id, mid_id, title, action, dispatched_at, completed_at, status, outcome }

let _busRef = null;
let _llmStats = { calls: 0, successes: 0, failures: 0, lastSuccessAt: null };

function _persistAll() {
  try {
    writeFileSync(TOP_PATH, JSON.stringify({ updatedAt: new Date().toISOString(), goals: _topGoals }, null, 2));
    writeFileSync(MID_PATH, JSON.stringify({ updatedAt: new Date().toISOString(), goals: _midGoals }, null, 2));
    writeFileSync(TASKS_PATH, JSON.stringify({ updatedAt: new Date().toISOString(), tasks: _tasks, llmStats: _llmStats }, null, 2));
  } catch (e) {
    process.stderr.write(`[goal-pursuit] persist failed: ${e?.message || e}\n`);
  }
}

function _loadAll() {
  if (existsSync(TOP_PATH)) {
    try {
      const raw = JSON.parse(readFileSync(TOP_PATH, "utf-8"));
      // Accept two formats: {goals: [...]} OR plain array [...]
      const arr = Array.isArray(raw) ? raw : (raw.goals || []);
      // Normalize to internal format
      _topGoals = arr.map(g => ({
        id: g.id || `top_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        title: g.title || g.description || "(no title)",
        why: g.why || g.description || g.title || "",
        deadline: g.deadline || new Date(Date.now() + 180 * 86400_000).toISOString(),
        priority: g.priority,
        status: g.status || "active",
        created_at: g.created_at || new Date().toISOString(),
        decomposed_at: g.decomposed_at,
      }));
    } catch (e) {
      process.stderr.write(`[goal-pursuit] failed to load top goals: ${e?.message || e}\n`);
    }
  }
  if (existsSync(MID_PATH)) try { _midGoals = JSON.parse(readFileSync(MID_PATH, "utf-8")).goals || []; } catch {}
  if (existsSync(TASKS_PATH)) try { _tasks = JSON.parse(readFileSync(TASKS_PATH, "utf-8")).tasks || []; } catch {}
}

// ─── Decomposition: top → mid ───────────────────────────────────────────

async function _decomposeTopToMid() {
  for (const top of _topGoals.filter(g => g.status === "active")) {
    const existingMid = _midGoals.filter(m => m.top_id === top.id && m.status === "active");
    if (existingMid.length >= 3) continue; // already have mid-level for this top
    if (top.decomposed_at && Date.now() - new Date(top.decomposed_at).getTime() < 7 * 86400_000) continue;

    // Budget check
    try {
      const budget = await import("./llm-budget-guard.mjs");
      const guard = budget.canCall("goal-pursuit-decompose-mid", "claude-sonnet-4-6");
      if (!guard.allow) return;
    } catch {}

    const prompt = `You are the goal-pursuit module decomposing a top-level goal into 2-4 mid-level goals (week-scale).

TOP-LEVEL GOAL:
Title: ${top.title}
Why: ${top.why}
Deadline: ${top.deadline}

Existing mid-level goals for this top (do not duplicate):
${existingMid.map(m => `- ${m.title}`).join("\n") || "(none)"}

Generate 2-4 mid-level goals. Each must have measurable success_criterion and realistic week-scale deadline.

Output JSON array ONLY:
[
  {
    "title": "<concrete week-scale goal>",
    "success_criterion": "<measurable - 'received N replies', 'closed 1 deal', etc>",
    "deadline_days_from_now": <integer 7-30>
  }
]

Use hyphens, never em dashes. Output JSON array only.`;

    _llmStats.calls++;
    const r = spawnSync(CLAUDE_BIN, ["-p", "--model", CLAUDE_MODEL, "--max-turns", "2"], {
      input: prompt, encoding: "utf-8", timeout: CLAUDE_TIMEOUT_MS,
    });
    try {
      const budget = await import("./llm-budget-guard.mjs");
      budget.recordCall("goal-pursuit-decompose-mid", "claude-sonnet-4-6");
    } catch {}

    if (r.status !== 0 || !r.stdout) { _llmStats.failures++; continue; }
    const m = r.stdout.match(/\[[\s\S]*\]/);
    if (!m) { _llmStats.failures++; continue; }
    try {
      const parsed = JSON.parse(m[0]);
      _llmStats.successes++;
      _llmStats.lastSuccessAt = new Date().toISOString();
      const now = new Date().toISOString();
      for (const mid of parsed) {
        if (!mid.title || !mid.success_criterion) continue;
        _midGoals.push({
          id: `mid_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          top_id: top.id,
          title: String(mid.title).slice(0, 200),
          success_criterion: String(mid.success_criterion).slice(0, 300),
          deadline: new Date(Date.now() + (mid.deadline_days_from_now || 14) * 86400_000).toISOString(),
          status: "active",
          generated_at: now,
        });
      }
      top.decomposed_at = now;
    } catch { _llmStats.failures++; }
  }
  _persistAll();
}

// ─── Decomposition: mid → tasks ─────────────────────────────────────────

async function _decomposeMidToTasks() {
  for (const mid of _midGoals.filter(g => g.status === "active")) {
    const existingTasks = _tasks.filter(t => t.mid_id === mid.id && t.status !== "completed");
    if (existingTasks.length >= 5) continue; // already have tasks for this mid

    try {
      const budget = await import("./llm-budget-guard.mjs");
      const guard = budget.canCall("goal-pursuit-decompose-tasks", "claude-sonnet-4-6");
      if (!guard.allow) return;
    } catch {}

    const top = _topGoals.find(t => t.id === mid.top_id);
    const recentCompleted = _tasks.filter(t => t.mid_id === mid.id && t.status === "completed").slice(-5);

    const prompt = `You are the goal-pursuit module decomposing a mid-level goal into 1-3 concrete tasks (hours-days scale). Also identify CAPABILITY GAPS - tasks that would require a NEW module/connector/code that does not yet exist in substrate.

TOP CONTEXT: ${top?.title || "(unknown top)"}
MID-LEVEL GOAL: ${mid.title}
Success criterion: ${mid.success_criterion}
Deadline: ${mid.deadline}

Tasks already pending for this mid (do not duplicate):
${existingTasks.map(t => `- ${t.title}`).join("\n") || "(none)"}

Recently completed tasks for this mid:
${recentCompleted.map(t => `- ${t.title} (${t.outcome?.slice(0, 100) || "?"})`).join("\n") || "(none)"}

EXISTING SUBSTRATE CAPABILITIES (what cortex-executor can already do):
- Run scripts in scripts/cortex/, scripts/factory/, scripts/automation/, scripts/observability/
- Delegate code edits to hands.mjs (Claude subprocess that can read/edit files)
- Inquiry-only Claude calls
- Send Telegram messages (via affect-outreach, communication-drive)

Generate 1-3 concrete tasks. Each must be:
- Concrete enough to dispatch to cortex-executor (not vague)
- Have clear "done" definition
- Move toward the success_criterion

For EACH task, also identify if it needs a NEW capability (new module, new connector, new tool that does not exist).

Output JSON object ONLY:
{
  "tasks": [
    {
      "title": "<short task name>",
      "action": "<concrete imperative the executor can run, includes specifics>",
      "estimated_hours": <number>,
      "capability_gap": "<short description of missing capability OR null if existing capabilities sufficient>"
    }
  ]
}

Use hyphens, never em dashes. Output JSON only.`;

    _llmStats.calls++;
    const r = spawnSync(CLAUDE_BIN, ["-p", "--model", CLAUDE_MODEL, "--max-turns", "2"], {
      input: prompt, encoding: "utf-8", timeout: CLAUDE_TIMEOUT_MS,
    });
    try {
      const budget = await import("./llm-budget-guard.mjs");
      budget.recordCall("goal-pursuit-decompose-tasks", "claude-sonnet-4-6");
    } catch {}

    if (r.status !== 0 || !r.stdout) { _llmStats.failures++; continue; }
    const m = r.stdout.match(/\{[\s\S]*\}/);
    if (!m) { _llmStats.failures++; continue; }
    try {
      const parsed = JSON.parse(m[0]);
      _llmStats.successes++;
      _llmStats.lastSuccessAt = new Date().toISOString();
      const tasksArr = parsed.tasks || (Array.isArray(parsed) ? parsed : []);
      for (const task of tasksArr) {
        if (!task.title || !task.action) continue;
        _tasks.push({
          id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          mid_id: mid.id,
          title: String(task.title).slice(0, 200),
          action: String(task.action).slice(0, 600),
          estimated_hours: task.estimated_hours || 1,
          capability_gap: task.capability_gap || null,
          status: "pending",
          created_at: new Date().toISOString(),
        });
        // CAPABILITY GAP - emit event so self-construction can react
        if (task.capability_gap && _busRef) {
          try {
            _busRef.broadcast({
              source: "goal-pursuit",
              type: "capability_gap_identified",
              data: {
                gap: String(task.capability_gap).slice(0, 400),
                blocking_task: task.title,
                blocking_task_id: _tasks[_tasks.length - 1].id,
                mid_goal: mid.title,
                top_goal: top?.title,
              },
            });
          } catch {}
        }
      }
    } catch { _llmStats.failures++; }
  }
  _persistAll();
}

// ─── Dispatch tasks ────────────────────────────────────────────────────

function _dispatchTasks() {
  const pending = _tasks.filter(t => t.status === "pending");
  if (pending.length === 0) return;

  // Pick highest priority (closest deadline mid first, then oldest task)
  pending.sort((a, b) => {
    const midA = _midGoals.find(m => m.id === a.mid_id);
    const midB = _midGoals.find(m => m.id === b.mid_id);
    const deadlineA = midA?.deadline ? new Date(midA.deadline).getTime() : Infinity;
    const deadlineB = midB?.deadline ? new Date(midB.deadline).getTime() : Infinity;
    if (deadlineA !== deadlineB) return deadlineA - deadlineB;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  const next = pending[0];
  next.status = "dispatched";
  next.dispatched_at = new Date().toISOString();
  _persistAll();

  // Bid attention spotlight - cortex-executor will pick up
  if (_busRef) {
    try {
      import("./attention.mjs").then(({ proposeSpotlight }) => {
        proposeSpotlight(
          next.action,
          7, // urgency 7 - goal-derived task
          `goal-pursuit task ${next.id}: ${next.title}`,
          "goal-pursuit"
        );
      }).catch(() => {});
      _busRef.broadcast({
        source: "goal-pursuit",
        type: "task_dispatched",
        data: {
          task_id: next.id,
          title: next.title,
          action: next.action.slice(0, 300),
          mid_id: next.mid_id,
        },
      });
    } catch {}
  }
}

// ─── Track completion ──────────────────────────────────────────────────

function _onCortexActionCompleted(entry) {
  const data = entry?.data || {};
  // Find dispatched task this might satisfy
  const dispatched = _tasks.filter(t => t.status === "dispatched");
  for (const task of dispatched) {
    if (data.summary?.toLowerCase().includes(task.title.toLowerCase().slice(0, 30)) ||
        data.topic?.includes(task.id)) {
      task.status = data.success ? "completed" : "failed";
      task.completed_at = new Date().toISOString();
      task.outcome = data.summary?.slice(0, 300) || (data.success ? "ok" : "failed");
      _persistAll();
      // Check if mid-level goal might be complete
      const mid = _midGoals.find(m => m.id === task.mid_id);
      if (mid) _checkMidProgress(mid);
      break;
    }
  }
}

function _checkMidProgress(mid) {
  const tasks = _tasks.filter(t => t.mid_id === mid.id);
  const completed = tasks.filter(t => t.status === "completed").length;
  const failed = tasks.filter(t => t.status === "failed").length;
  // If all tasks completed AND deadline passed, mark mid as completed (review will assess)
  const now = Date.now();
  const deadlinePassed = mid.deadline && new Date(mid.deadline).getTime() < now;
  if (tasks.length > 0 && completed > 0 && completed >= tasks.length - failed && deadlinePassed) {
    mid.status = "review_pending";
    if (_busRef) {
      try {
        _busRef.broadcast({
          source: "goal-pursuit",
          type: "mid_goal_review_pending",
          data: { mid_id: mid.id, title: mid.title, completed, failed, total: tasks.length },
        });
      } catch {}
    }
  }
}

// ─── Public API for seeding goals ──────────────────────────────────────

export function addTopLevelGoal(title, why, deadline_days_from_now = 180) {
  const goal = {
    id: `top_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title: String(title).slice(0, 300),
    why: String(why).slice(0, 500),
    deadline: new Date(Date.now() + deadline_days_from_now * 86400_000).toISOString(),
    status: "active",
    created_at: new Date().toISOString(),
  };
  _topGoals.push(goal);
  _persistAll();
  return goal;
}

export function getHierarchy() {
  return {
    top: _topGoals.filter(g => g.status === "active"),
    mid: _midGoals.filter(g => g.status === "active" || g.status === "review_pending"),
    tasks: {
      pending: _tasks.filter(t => t.status === "pending"),
      dispatched: _tasks.filter(t => t.status === "dispatched"),
      completed: _tasks.filter(t => t.status === "completed").slice(-20),
      failed: _tasks.filter(t => t.status === "failed").slice(-10),
    },
  };
}

// ─── Required GWT-module export ─────────────────────────────────────────

export function register(bus) {
  _busRef = bus;
  _loadAll();

  bus.subscribe("cortex_action_completed", _onCortexActionCompleted);

  // Periodic schedules
  setInterval(() => _decomposeTopToMid().catch(() => {}), DECOMPOSE_TOP_TO_MID_INTERVAL_MS).unref?.();
  setInterval(() => _decomposeMidToTasks().catch(() => {}), DECOMPOSE_MID_TO_TASKS_INTERVAL_MS).unref?.();
  setInterval(_dispatchTasks, DISPATCH_TASKS_INTERVAL_MS).unref?.();

  // Initial pass shortly after boot if hierarchy exists but no tasks
  setTimeout(() => {
    if (_topGoals.length > 0 && _tasks.filter(t => t.status === "pending").length === 0) {
      _decomposeMidToTasks().then(_dispatchTasks).catch(() => {});
    }
  }, 30_000).unref?.();
}

export function getLLMStats() { return { ..._llmStats }; }
export function _resetState() {
  _topGoals = [];
  _midGoals = [];
  _tasks = [];
  _llmStats = { calls: 0, successes: 0, failures: 0, lastSuccessAt: null };
  _busRef = null;
}
