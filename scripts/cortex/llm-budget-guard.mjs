/**
 * cortex/llm-budget-guard.mjs - Hard budget cap on substrate LLM consumption
 *   (substrate-requested pre-launch, May 9 2026)
 *
 * SUBSTRATE'S CONCERN #2: "Cost runaway if self-construction interprets
 * low-confidence observations as invitations to spawn new modules, each
 * triggering Claude API calls. The $50-150 estimate assumes normal
 * operation. A feedback loop between self-construction and existential-
 * stake could multiply calls by 10x. Without a cap Kirill has no upper
 * bound on cost."
 *
 * SOLUTION: shared in-process counter checked by modules before LLM calls.
 * Per-hour and per-day limits. When exceeded, modules degrade gracefully
 * (skip LLM call, use heuristic fallback OR honestly broadcast budget_exhausted).
 *
 * This module is PROTECTED in self-construction (substrate cannot raise its
 * own budget without operator).
 */

import { writeFileSync, readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const BUDGET_PATH = resolve(ROOT, ".data/cortex-llm-budget.json");

// DEFAULT BUDGETS (Kirill can edit directly via file - substrate cannot)
const DEFAULT_PER_HOUR_USD = 5.0;
const DEFAULT_PER_DAY_USD = 30.0;
const DEFAULT_PER_HOUR_CALLS = 60;
const DEFAULT_PER_DAY_CALLS = 600;

// Estimated cost per call by model
const COST_PER_CALL = {
  "claude-sonnet-4-6": 0.04,
  "claude-haiku-4-5-20251001": 0.005,
  "claude-opus-4-7": 0.20,
  "default": 0.03,
};

let _config = {
  per_hour_usd: DEFAULT_PER_HOUR_USD,
  per_day_usd: DEFAULT_PER_DAY_USD,
  per_hour_calls: DEFAULT_PER_HOUR_CALLS,
  per_day_calls: DEFAULT_PER_DAY_CALLS,
};

const _calls = []; // { at, source, model, cost_usd }
const MAX_HISTORY = 5000;

let _busRef = null;
let _exhaustedNotificationSent = false;

function _loadPersisted() {
  if (!existsSync(BUDGET_PATH)) return;
  try {
    const raw = JSON.parse(readFileSync(BUDGET_PATH, "utf-8"));
    if (raw?.config) Object.assign(_config, raw.config);
    if (Array.isArray(raw?.calls)) _calls.push(...raw.calls);
  } catch {}
}

function _persist() {
  if (_calls.length > MAX_HISTORY) _calls.splice(0, _calls.length - MAX_HISTORY);
  try {
    writeFileSync(BUDGET_PATH, JSON.stringify({
      updatedAt: new Date().toISOString(),
      config: _config,
      currentUsage: getCurrentUsage(),
      recentCalls: _calls.slice(-50),
      callCount: _calls.length,
    }, null, 2));
  } catch {}
}

export function getCurrentUsage() {
  const now = Date.now();
  const hourAgo = now - 3600_000;
  const dayAgo = now - 86400_000;
  const hourCalls = _calls.filter(c => new Date(c.at).getTime() > hourAgo);
  const dayCalls = _calls.filter(c => new Date(c.at).getTime() > dayAgo);
  return {
    hour_calls: hourCalls.length,
    hour_cost_usd: Number(hourCalls.reduce((s, c) => s + (c.cost_usd || 0), 0).toFixed(2)),
    day_calls: dayCalls.length,
    day_cost_usd: Number(dayCalls.reduce((s, c) => s + (c.cost_usd || 0), 0).toFixed(2)),
    total_calls: _calls.length,
  };
}

/**
 * THE KEY API: modules call this BEFORE making an LLM call.
 * Returns { allow: true } if within budget, or { allow: false, reason } if exceeded.
 *
 * Caller responsibility:
 *   - If allow: true -> proceed with LLM call, then call recordCall(...)
 *   - If allow: false -> skip LLM, use heuristic fallback OR broadcast budget_exhausted
 */
export function canCall(source, model = "default") {
  const usage = getCurrentUsage();
  const estimatedCost = COST_PER_CALL[model] || COST_PER_CALL.default;

  if (usage.hour_calls >= _config.per_hour_calls) {
    return { allow: false, reason: `hour call limit ${_config.per_hour_calls}/h reached`, usage };
  }
  if (usage.day_calls >= _config.per_day_calls) {
    return { allow: false, reason: `day call limit ${_config.per_day_calls}/d reached`, usage };
  }
  if (usage.hour_cost_usd + estimatedCost > _config.per_hour_usd) {
    return { allow: false, reason: `hour cost limit $${_config.per_hour_usd}/h would be exceeded`, usage };
  }
  if (usage.day_cost_usd + estimatedCost > _config.per_day_usd) {
    return { allow: false, reason: `day cost limit $${_config.per_day_usd}/d would be exceeded`, usage };
  }
  return { allow: true, usage, estimatedCost };
}

export function recordCall(source, model = "default", actual_cost_usd = null) {
  const cost = actual_cost_usd ?? COST_PER_CALL[model] ?? COST_PER_CALL.default;
  _calls.push({ at: new Date().toISOString(), source, model, cost_usd: cost });
  _persist();

  // Check if we just crossed a threshold and notify
  const usage = getCurrentUsage();
  const hourPctUsed = usage.hour_cost_usd / _config.per_hour_usd;
  const dayPctUsed = usage.day_cost_usd / _config.per_day_usd;

  if ((hourPctUsed >= 0.8 || dayPctUsed >= 0.8) && !_exhaustedNotificationSent) {
    _exhaustedNotificationSent = true;
    if (_busRef) {
      try {
        _busRef.broadcast({
          source: "llm-budget-guard",
          type: "budget_warning",
          data: {
            usage,
            hour_pct: Number(hourPctUsed.toFixed(2)),
            day_pct: Number(dayPctUsed.toFixed(2)),
            config: _config,
          },
        });
      } catch {}
    }
    // Reset notification flag after 30 min
    setTimeout(() => { _exhaustedNotificationSent = false; }, 30 * 60_000).unref?.();
  }
}

/**
 * Convenience wrapper: takes a function that returns { stdout, status }
 * (typical spawnSync result), tracks cost automatically.
 */
export function trackedCall(source, model, llmFn) {
  const guard = canCall(source, model);
  if (!guard.allow) {
    return { skipped: true, reason: guard.reason, usage: guard.usage };
  }
  const result = llmFn();
  recordCall(source, model);
  return { skipped: false, result };
}

export function register(bus) {
  _busRef = bus;
  _loadPersisted();
}

export function getConfig() { return { ..._config }; }
export function _setConfig(newConfig) { Object.assign(_config, newConfig); _persist(); }
export function _resetState() {
  _calls.length = 0;
  _exhaustedNotificationSent = false;
  _busRef = null;
}
