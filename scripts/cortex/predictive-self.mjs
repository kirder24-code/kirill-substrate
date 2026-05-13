/**
 * cortex/predictive-self.mjs - GWT Layer 2 Step 1 (2026-05-09)
 *
 * The first module that PREDICTS instead of just observing.
 *
 * What it does:
 *   - Subscribes to "*pre*" events (when daemon is about to run a bot/workflow,
 *     emit "bot_pre" before "bot_result")
 *   - For each pre-event: generates a prediction (using fast LLM or heuristic)
 *     about the likely outcome
 *   - Stores prediction keyed by (source, type, action_id) with timestamp
 *   - Subscribes to outcome events (bot_result, hands_result, workflow_result)
 *   - When outcome arrives, retrieves matching prediction, computes error,
 *     persists prediction-vs-outcome record
 *
 * Why this matters for AGI pyramid:
 *   - Without prediction, the system is purely reactive
 *   - Prediction is the substrate for "knowing what you don't know"
 *   - Prediction error is the GRADIENT signal that drives Active Inference
 *   - Layer 2 Steps 2-5 build on this primitive
 *
 * LLM strategy:
 *   - Production: heuristic predictor first (fast, $0). LLM-based predictor in Step 2
 *     when we add semantic comparison.
 *   - Tests: pure heuristic, no LLM call. Tests verify storage + retrieval + matching.
 *
 * Honest limit: predictions are only as good as the predictor. Heuristic is a stub
 * that predicts "success" for everything. Step 2 will add real semantic prediction.
 * Step 1 just builds the storage + matching infrastructure.
 */

import { writeFileSync, readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const STORE_PATH = resolve(ROOT, ".data/cortex-predictions.json");

const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";
const CLAUDE_MODEL = "claude-haiku-4-5-20251001"; // haiku for cost - prediction needs to be cheap
const CLAUDE_TIMEOUT_MS = 30_000;

let _llmStats = { calls: 0, successes: 0, failures: 0, fallbacks: 0, cacheHits: 0, lastError: null, lastSuccessAt: null };

// Cache predictions per stable domain to control cost (same bot firing 5x in 5min reuses)
const _predictionCache = new Map(); // domainKey -> { prediction, at }
const CACHE_TTL_MS = 5 * 60_000;

// Types of "pre" events we predict outcomes for, mapped to their corresponding
// outcome event types. Matching by (source, action_id) which the producer sets.
const PREDICTION_PAIRS = {
  bot_pre: "bot_result",
  hands_pre: "hands_result",
  workflow_pre: "workflow_result",
  research_pre: "research_result",
};

// Keep predictions in memory while waiting for outcome. Bounded to prevent leak.
const _pending = new Map(); // key -> { prediction, predictedAt, preEntry }
const MAX_PENDING = 200;

// Persisted history of resolved prediction-outcome pairs
let _history = [];
const MAX_HISTORY = 500;

function _loadHistory() {
  if (!existsSync(STORE_PATH)) return [];
  try {
    const raw = JSON.parse(readFileSync(STORE_PATH, "utf-8"));
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
}

function _saveHistory() {
  try {
    if (_history.length > MAX_HISTORY) _history = _history.slice(-MAX_HISTORY);
    writeFileSync(STORE_PATH, JSON.stringify(_history, null, 2));
  } catch (e) {
    process.stderr.write(`[predictive-self] save history failed: ${e?.message || e}\n`);
  }
}

function _key(source, actionId) {
  // Compose a key. action_id is producer-supplied to link pre + outcome.
  return `${source}::${actionId || "noid"}`;
}

/**
 * REAL LLM predictor: takes a pre-event + recent history of similar actions,
 * asks Claude (haiku, fast/cheap) to reason about the likely outcome.
 * Returns prediction or null on failure.
 */
function _llmPredict(preEntry, recentHistory) {
  const data = preEntry?.data || {};
  const action = data.bot || data.task || data.workflow || data.question || "?";
  const histSummary = recentHistory.slice(-5).map(h => {
    const od = h.outcomeEntry?.data || {};
    return `- ran ${h.preEntry?.data?.bot || h.preEntry?.data?.task || "?"} -> success=${!!od.success}${od.result_count !== undefined ? `, count=${od.result_count}` : ""}${od.summary ? `, "${String(od.summary).slice(0, 80)}"` : ""}${od.error ? `, error="${String(od.error).slice(0, 80)}"` : ""}`;
  }).join("\n") || "(no prior runs of this action)";

  const prompt = `You are the predictive module of an autonomous cognitive substrate. You read what an action is about to do, plus its recent run history, and predict the outcome.

CONSTRAINTS:
- Reference ONLY information present in the inputs below. No invented values.
- Use hyphens, never em dashes.
- If you have insufficient information to make a meaningful prediction, output low confidence and say so.

ACTION ABOUT TO RUN:
- Source module: ${preEntry.source}
- Action name: ${action}
- Pre-event data: ${JSON.stringify(data)}

RECENT HISTORY OF THIS ACTION (most recent ${recentHistory.length}):
${histSummary}

Output a JSON object ONLY:
{
  "success": <true|false: do you expect this run to succeed?>,
  "expected_count": <number or null: if you can predict an item count from history pattern, predict it; else null>,
  "expected_summary": "<1-2 sentences: what specifically you expect to happen, grounded in name + history>",
  "confidence": <0.0 to 1.0: how confident, given your evidence>,
  "basis": "<short: what evidence shaped this prediction>"
}

Output the JSON object only, no preamble, no markdown fences.`;

  _llmStats.calls++;
  const r = spawnSync(CLAUDE_BIN, ["-p", "--model", CLAUDE_MODEL, "--max-turns", "1"], {
    input: prompt, encoding: "utf-8", timeout: CLAUDE_TIMEOUT_MS,
  });

  if (r.status !== 0 || !r.stdout) {
    _llmStats.failures++;
    _llmStats.lastError = `claude exit=${r.status}`;
    return null;
  }
  const m = r.stdout.match(/\{[\s\S]*\}/);
  if (!m) { _llmStats.failures++; _llmStats.lastError = "no JSON"; return null; }
  try {
    const parsed = JSON.parse(m[0]);
    _llmStats.successes++;
    _llmStats.lastSuccessAt = new Date().toISOString();
    _llmStats.lastError = null;
    return {
      success: !!parsed.success,
      expected_count: typeof parsed.expected_count === "number" ? parsed.expected_count : null,
      expected_summary: typeof parsed.expected_summary === "string" ? parsed.expected_summary.slice(0, 400) : "",
      confidence: typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.3,
      basis: typeof parsed.basis === "string" ? parsed.basis.slice(0, 200) : "claude-llm-prediction",
      generator: "claude-llm",
    };
  } catch (e) {
    _llmStats.failures++;
    _llmStats.lastError = "JSON parse: " + e.message;
    return null;
  }
}

/**
 * Heuristic predictor - now ONLY used as fallback when LLM fails.
 * Daemon must keep moving; honest fallback (tagged) > blocking pipeline.
 */
function _heuristicPredict(preEntry) {
  const data = preEntry?.data || {};
  // Naive: predict success based on bot/action having succeeded recently in history
  const source = preEntry?.source || "?";
  const action = data.bot || data.task || data.workflow || data.question || "?";
  // Match by ANY non-undefined identifier matching. undefined === undefined would falsely
  // match unrelated history (when both prediction and history record lack a given field).
  // Require at least one defined-AND-equal id pair.
  const recentForAction = _history.filter(h => {
    if (h.preEntry?.source !== source) return false;
    const hd = h.preEntry?.data || {};
    const sameBot = data.bot !== undefined && hd.bot === data.bot;
    const sameTask = data.task !== undefined && hd.task === data.task;
    const sameWorkflow = data.workflow !== undefined && hd.workflow === data.workflow;
    return sameBot || sameTask || sameWorkflow;
  }).slice(-10);
  if (recentForAction.length === 0) {
    return { success: true, expected_summary: "no prior data, default success", confidence: 0.5, basis: "no-history-default", generator: "heuristic-fallback" };
  }
  const successes = recentForAction.filter(h => h.outcomeEntry?.data?.success === true).length;
  const successRate = successes / recentForAction.length;
  return {
    success: successRate >= 0.5,
    expected_summary: `based on last ${recentForAction.length} runs of ${action}, success rate ${(successRate * 100).toFixed(0)}%`,
    confidence: Math.abs(successRate - 0.5) * 2,
    basis: `historical-success-rate-${recentForAction.length}-runs`,
    generator: "heuristic-fallback",
  };
}

function _historyForAction(preEntry) {
  const data = preEntry?.data || {};
  const source = preEntry?.source || "?";
  return _history.filter(h => {
    if (h.preEntry?.source !== source) return false;
    const hd = h.preEntry?.data || {};
    const sameBot = data.bot !== undefined && hd.bot === data.bot;
    const sameTask = data.task !== undefined && hd.task === data.task;
    const sameWorkflow = data.workflow !== undefined && hd.workflow === data.workflow;
    return sameBot || sameTask || sameWorkflow;
  });
}

function _domainKey(preEntry) {
  const data = preEntry?.data || {};
  const id = data.bot || data.task || data.workflow || data.question || "noid";
  return `${preEntry?.source || "?"}::${id}`;
}

/**
 * Predict via LLM with caching. Falls back to heuristic on LLM failure or
 * when explicit fallback is needed (test mode, daemon flag, etc).
 */
function _predict(preEntry) {
  const cacheKey = _domainKey(preEntry);
  const cached = _predictionCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    _llmStats.cacheHits++;
    return { ...cached.prediction, basis: `${cached.prediction.basis}|cached` };
  }
  const recent = _historyForAction(preEntry).slice(-10);
  const llmResult = _llmPredict(preEntry, recent);
  if (llmResult !== null) {
    _predictionCache.set(cacheKey, { prediction: llmResult, at: Date.now() });
    return llmResult;
  }
  _llmStats.fallbacks++;
  return _heuristicPredict(preEntry);
}

/**
 * Compute discrete error: did prediction's `success` field match outcome's?
 * Returns 0 (perfect) or 1 (wrong).
 */
function _discreteError(prediction, outcomeEntry) {
  const predictedSuccess = !!prediction.success;
  const actualSuccess = !!outcomeEntry?.data?.success;
  return predictedSuccess === actualSuccess ? 0 : 1;
}

/**
 * Compute numeric error when prediction has expected_count and outcome has count-like field.
 * Returns relative error in [0, 1] or null if numeric comparison not applicable.
 *   0   = exact match
 *   0.5 = predicted off by ~50% (e.g. predicted 4, got 2)
 *   1   = predicted off by 100%+ OR predicted N got 0
 *
 * Outcome count keys we look at (in order): result_count, count, leads, replies, items, n
 */
function _numericError(prediction, outcomeEntry) {
  const expected = prediction.expected_count;
  if (typeof expected !== "number") return null;
  const data = outcomeEntry?.data || {};
  const actual = data.result_count ?? data.count ?? data.leads ?? data.replies ?? data.items ?? data.n;
  if (typeof actual !== "number") return null;
  if (expected === 0 && actual === 0) return 0;
  const denom = Math.max(Math.abs(expected), Math.abs(actual), 1);
  return Math.min(1, Math.abs(expected - actual) / denom);
}

/**
 * Compute semantic error stub. Returns null in Step 2 - real LLM-based scoring is Step 4
 * once we wire Claude CLI subprocess. For now we just check if expected_summary keywords
 * appear in outcome summary; very crude proxy.
 *   null  = comparison not applicable (no expected_summary or no outcome text)
 *   0     = high keyword overlap
 *   1     = no overlap
 */
function _semanticErrorStub(prediction, outcomeEntry) {
  const expected = (prediction.expected_summary || "").toLowerCase();
  const actual = (outcomeEntry?.data?.summary || outcomeEntry?.data?.error || "").toLowerCase();
  if (!expected || !actual) return null;
  // Strip noise words, take meaningful tokens (length >= 4)
  const expectedTokens = expected.split(/\W+/).filter(w => w.length >= 4);
  const actualTokens = new Set(actual.split(/\W+/).filter(w => w.length >= 4));
  if (expectedTokens.length === 0) return null;
  const overlap = expectedTokens.filter(t => actualTokens.has(t)).length;
  const ratio = overlap / expectedTokens.length;
  return Math.max(0, Math.min(1, 1 - ratio));
}

/**
 * Combined error score across all available error dimensions.
 * Weights: discrete=0.5, numeric=0.3, semantic=0.2 (when available).
 * Returns { combined, components: {discrete, numeric, semantic} }.
 * Combined is in [0, 1] where 0 = perfect prediction, 1 = totally wrong.
 */
function _combinedError(prediction, outcomeEntry) {
  const components = {
    discrete: _discreteError(prediction, outcomeEntry),
    numeric: _numericError(prediction, outcomeEntry),
    semantic: _semanticErrorStub(prediction, outcomeEntry),
  };
  const weights = { discrete: 0.5, numeric: 0.3, semantic: 0.2 };
  let totalWeight = 0;
  let weightedSum = 0;
  for (const [k, v] of Object.entries(components)) {
    if (v === null || v === undefined) continue;
    weightedSum += v * weights[k];
    totalWeight += weights[k];
  }
  const combined = totalWeight > 0 ? weightedSum / totalWeight : 0;
  return { combined, components };
}

/**
 * Predict the world-state implication of a perception. This closes the
 * cascade gap that the substrate self-diagnosed: perception_event entered
 * the bus but produced no downstream prediction signal, so blind-spots /
 * free-energy / introspector never updated. Now each perception spawns
 * a synthetic "perception_pre" -> immediate prediction -> immediate
 * resolution against the perception's own valence/significance, generating
 * a real cascade chain.
 */
function _handlePerception(bus, entry) {
  const data = entry?.data || {};
  const source = data.source || "unknown";
  const synthAction = `perception::${source}`;
  // Build a synthetic pre-event so the same predictor can run
  const synthPre = {
    source: "perception",
    type: "perception_pre",
    at: entry.at,
    data: { action_id: `perc-${Date.now()}`, bot: synthAction, task: `interpret ${source}` },
    cascade_depth: (entry.cascade_depth || 0) + 1,
  };
  const prediction = _predict(synthPre);
  // Compose a synthetic outcome from perception's valence -> success bool
  const synthOutcome = {
    source: "perception",
    type: "perception_resolved",
    at: entry.at,
    data: {
      action_id: synthPre.data.action_id,
      bot: synthAction,
      success: data.valence === "positive" || data.valence === "neutral",
      result_count: data.significance,
      summary: data.interpretation || data.content,
    },
    cascade_depth: (entry.cascade_depth || 0) + 1,
  };
  const errors = _combinedError(prediction, synthOutcome);
  const stableDomainId = source;
  const domain = `perception::${stableDomainId}`;

  // Broadcast prediction_made + prediction_resolved with cascade depth set
  // so the chain shows real propagation (perception -> prediction -> resolved -> blind-spots)
  bus.broadcast({
    source: "predictive-self",
    type: "prediction_made",
    data: {
      for_action: synthPre.data.action_id,
      for_source: "perception",
      for_type: "perception_event",
      prediction,
    },
  });
  bus.broadcast({
    source: "predictive-self",
    type: "prediction_resolved",
    data: {
      actionId: synthPre.data.action_id,
      for_source: "perception",
      domain,
      discreteError: errors.components.discrete,
      numericError: errors.components.numeric,
      semanticError: errors.components.semantic,
      combinedError: errors.combined,
      predicted_success: prediction.success,
      actual_success: !!synthOutcome.data.success,
      confidence: prediction.confidence,
    },
  });
  // Persist as bot-style record so calibration history accumulates
  _history.push({
    actionId: synthPre.data.action_id,
    source: "perception",
    outcomeType: "perception_resolved",
    predicted: true,
    prediction,
    predictedAt: new Date().toISOString(),
    outcomeEntry: { at: synthOutcome.at, data: synthOutcome.data },
    preEntry: { at: synthPre.at, source: "perception", data: synthPre.data },
    discreteError: errors.components.discrete,
    numericError: errors.components.numeric,
    semanticError: errors.components.semantic,
    combinedError: errors.combined,
    recordedAt: new Date().toISOString(),
  });
  _saveHistory();
}

/**
 * Required GWT-module export. Wires subscriptions on bus.
 */
export function register(bus) {
  // Load history on first register
  if (_history.length === 0) {
    _history = _loadHistory();
  }

  // CASCADE FIX (substrate-discovered May 9 2026):
  // Subscribe to perception_event so each world signal triggers a prediction
  // that feeds blind-spots / free-energy / introspector. Without this, perception
  // entered the bus but went nowhere - cascade depth stayed at 0 because no
  // module reacted to perception with broadcasts of its own.
  bus.subscribe("perception_event", (entry) => {
    try { _handlePerception(bus, entry); }
    catch (e) { process.stderr.write(`[predictive-self] perception handler failed: ${e?.message || e}\n`); }
  });

  // Subscribe to pre-events: when daemon is about to do something, predict it
  for (const preType of Object.keys(PREDICTION_PAIRS)) {
    bus.subscribe(preType, (entry) => {
      const data = entry?.data || {};
      const actionId = data.action_id || data.id || data.task || data.bot || "noid";
      const key = _key(entry.source, actionId);
      const prediction = _predict(entry);
      _pending.set(key, {
        prediction,
        predictedAt: new Date().toISOString(),
        preEntry: entry,
      });
      // Bound pending size
      if (_pending.size > MAX_PENDING) {
        // Drop oldest
        const oldest = _pending.keys().next().value;
        _pending.delete(oldest);
      }
      // Broadcast the prediction so other modules can see "system expects X"
      // Use a pre-broadcast channel so Step 4-5 modules can observe predictions
      bus.broadcast({
        source: "predictive-self",
        type: "prediction_made",
        data: {
          for_action: actionId,
          for_source: entry.source,
          for_type: preType,
          prediction,
        },
      });
    });
  }

  // Subscribe to outcome events: match against pending predictions
  for (const [preType, outcomeType] of Object.entries(PREDICTION_PAIRS)) {
    bus.subscribe(outcomeType, (entry) => {
      const data = entry?.data || {};
      const actionId = data.action_id || data.id || data.task || data.bot || "noid";
      const key = _key(entry.source, actionId);
      const pending = _pending.get(key);
      if (!pending) {
        // No matching prediction - either we missed the pre-event or the producer didn't fire one.
        // Record an "unpredicted outcome" so Step 3 can flag domains we never predict for.
        _history.push({
          actionId,
          source: entry.source,
          outcomeType,
          predicted: false,
          unpredictedOutcome: true,
          outcomeEntry: { at: entry.at, data: entry.data },
          recordedAt: new Date().toISOString(),
        });
        _saveHistory();
        return;
      }
      _pending.delete(key);
      const errors = _combinedError(pending.prediction, entry);
      const record = {
        actionId,
        source: entry.source,
        outcomeType,
        predicted: true,
        prediction: pending.prediction,
        predictedAt: pending.predictedAt,
        outcomeEntry: { at: entry.at, data: entry.data },
        preEntry: { at: pending.preEntry.at, source: pending.preEntry.source, data: pending.preEntry.data },
        discreteError: errors.components.discrete,
        numericError: errors.components.numeric,
        semanticError: errors.components.semantic,
        combinedError: errors.combined,
        recordedAt: new Date().toISOString(),
      };
      _history.push(record);
      _saveHistory();
      // Compute stable domain identifier from pre-event data (NOT action_id which is per-call).
      // This is what blind-spots aggregates on. Falls back to action_id if no stable id available.
      const preData = pending.preEntry?.data || {};
      const stableDomainId = preData.bot || preData.task || preData.workflow || preData.question || actionId;
      const domain = `${entry.source}::${stableDomainId}`;

      // Broadcast resolution so Step 3 (blind spot tracker) can observe error rates
      bus.broadcast({
        source: "predictive-self",
        type: "prediction_resolved",
        data: {
          actionId,
          for_source: entry.source,
          domain,        // stable per-bot/task/workflow identifier (Step 3 keys on this)
          discreteError: errors.components.discrete,
          numericError: errors.components.numeric,
          semanticError: errors.components.semantic,
          combinedError: errors.combined,
          predicted_success: pending.prediction.success,
          actual_success: !!entry.data?.success,
          confidence: pending.prediction.confidence,
        },
      });
    });
  }
}

// ─── Test / introspection helpers ───────────────────────────────────────

export function getPendingCount() {
  return _pending.size;
}

export function getHistory() {
  return [..._history];
}

export function getLLMStats() { return { ..._llmStats }; }

export function _resetState() {
  _pending.clear();
  _history = [];
  _predictionCache.clear();
  _llmStats = { calls: 0, successes: 0, failures: 0, fallbacks: 0, cacheHits: 0, lastError: null, lastSuccessAt: null };
  try { if (existsSync(STORE_PATH)) writeFileSync(STORE_PATH, "[]"); } catch {}
}

export function _setHeuristic(_fn) {
  // not used yet but reserved for Step 2 LLM injection
}
