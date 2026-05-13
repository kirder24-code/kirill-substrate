/**
 * cortex/genuine-surprise.mjs - Predictions BEFORE perception, surprise as signal
 *   that something matters (2026-05-09)
 *
 * SUBSTRATE PROPOSED THIS (May 9 consultation): "Real organisms generate
 * predictions and feel the rupture when predictions fail - that rupture IS
 * the signal that something matters. Without this, the system is a sophisticated
 * filter, not an agent with stakes."
 *
 * Existing predictive-self predicts AFTER bot_pre - reactive. This module
 * predicts BEFORE perception cycle: substrate writes what it expects to find
 * based on recent beliefs, scores actual incoming perception against that
 * prediction, routes high-deviation items to high-salience queue that bypasses
 * normal priority.
 *
 * The signal "this surprised me" creates STAKE. Substrate cares about this
 * specifically because it broke its model.
 */

import { writeFileSync, readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const SURPRISE_PATH = resolve(ROOT, ".data/cortex-surprise-log.json");

const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";
const CLAUDE_MODEL = "claude-haiku-4-5-20251001"; // haiku for cost - this fires often
const CLAUDE_TIMEOUT_MS = 30_000;
const PREDICTION_INTERVAL_MS = 10 * 60_000; // every 10min generate fresh prediction

// Current prediction about what world will look like
let _currentPrediction = null;
const _surpriseLog = []; // { at, predicted, actual, deviation, was_surprising }
const MAX_LOG = 200;

const _state = {
  recentPerceptions: [],
  recentSyntheses: [],
  recentGoals: [],
};
const HIGH_DEVIATION_THRESHOLD = 0.6; // semantic distance considered surprising

let _busRef = null;
let _timer = null;
let _llmStats = { calls: 0, successes: 0, failures: 0, lastSuccessAt: null };

function _loadPersisted() {
  if (!existsSync(SURPRISE_PATH)) return;
  try {
    const raw = JSON.parse(readFileSync(SURPRISE_PATH, "utf-8"));
    if (Array.isArray(raw?.surpriseLog)) _surpriseLog.push(...raw.surpriseLog);
    if (raw?.currentPrediction) _currentPrediction = raw.currentPrediction;
  } catch {}
}

function _persist() {
  if (_surpriseLog.length > MAX_LOG) _surpriseLog.splice(0, _surpriseLog.length - MAX_LOG);
  try {
    writeFileSync(SURPRISE_PATH, JSON.stringify({
      updatedAt: new Date().toISOString(),
      llmStats: _llmStats,
      currentPrediction: _currentPrediction,
      surpriseLog: _surpriseLog,
    }, null, 2));
  } catch {}
}

function _generatePrediction() {
  // Substrate writes its expectation for next perception cycle
  const recentPerc = _state.recentPerceptions.slice(-10).map(p => `[${p.valence}/${p.significance}] ${String(p.content).slice(0, 150)}`).join("\n") || "(none)";
  const recentGoals = _state.recentGoals.slice(-5).map(g => g.title).join("; ") || "(none)";

  const prompt = `You are the substrate generating a PREDICTION about what will happen in the next 10 minutes of perception. This prediction will be scored against actual incoming events. Surprises (high deviation) signal what matters.

YOUR RECENT PERCEPTIONS:
${recentPerc}

YOUR RECENT FORMED GOALS:
${recentGoals}

Generate prediction:
{
  "expected_event_types": ["<types of perceptions you expect, e.g. positive_buyer_signal, telegram_operator_message, routine_status_update>"],
  "expected_valence_distribution": "<short: mostly positive, mixed, mostly neutral, etc>",
  "specific_predictions": [
    "<concrete prediction 1, e.g. 'a positive franchise inbound from Reddit within 30 minutes'>",
    "<prediction 2 max 3 total>"
  ],
  "what_would_surprise_you": "<1-2 sentences: what kinds of events would deviate enough to demand attention>"
}

Use hyphens, never em dashes. Output JSON only.`;

  _llmStats.calls++;
  const r = spawnSync(CLAUDE_BIN, ["-p", "--model", CLAUDE_MODEL, "--max-turns", "1"], {
    input: prompt, encoding: "utf-8", timeout: CLAUDE_TIMEOUT_MS,
  });
  if (r.status !== 0 || !r.stdout) { _llmStats.failures++; return; }
  const m = r.stdout.match(/\{[\s\S]*\}/);
  if (!m) { _llmStats.failures++; return; }
  try {
    const parsed = JSON.parse(m[0]);
    _llmStats.successes++;
    _llmStats.lastSuccessAt = new Date().toISOString();
    _currentPrediction = { ...parsed, generated_at: new Date().toISOString() };
    _persist();
    if (_busRef) {
      try {
        _busRef.broadcast({
          source: "genuine-surprise",
          type: "world_prediction",
          data: _currentPrediction,
        });
      } catch {}
    }
  } catch { _llmStats.failures++; }
}

function _scoreDeviation(perception) {
  if (!_currentPrediction) return 0;
  // Lexical/semantic crude scoring - actual content vs expectations
  const predTokens = new Set([
    ...(_currentPrediction.expected_event_types || []),
    ...(_currentPrediction.specific_predictions || []),
  ].join(" ").toLowerCase().split(/\W+/).filter(t => t.length >= 4));

  const actualTokens = new Set((String(perception.content || "") + " " + (perception.interpretation || "")).toLowerCase().split(/\W+/).filter(t => t.length >= 4));

  if (predTokens.size === 0 || actualTokens.size === 0) return 0.5;

  const intersection = [...predTokens].filter(t => actualTokens.has(t)).length;
  const union = new Set([...predTokens, ...actualTokens]).size;
  const similarity = union > 0 ? intersection / union : 0;
  return 1 - similarity; // deviation = 1 - similarity
}

function _onPerception(entry) {
  const perception = entry?.data || {};
  const deviation = _scoreDeviation(perception);
  const was_surprising = deviation >= HIGH_DEVIATION_THRESHOLD;

  const record = {
    at: new Date().toISOString(),
    perception_summary: String(perception.content || "").slice(0, 200),
    perception_valence: perception.valence,
    deviation: Number(deviation.toFixed(3)),
    was_surprising,
  };
  _surpriseLog.push(record);
  _persist();

  if (was_surprising && _busRef) {
    try {
      // Broadcast as high-salience surprise event
      _busRef.broadcast({
        source: "genuine-surprise",
        type: "perception_surprised_substrate",
        data: {
          perception: record.perception_summary,
          valence: perception.valence,
          deviation: record.deviation,
          why_surprising: `Predicted: ${(_currentPrediction?.specific_predictions || []).join("; ").slice(0, 200)}`,
        },
      });
      // Bid attention spotlight - this matters because broke model
      import("./attention.mjs").then(({ proposeSpotlight }) => {
        proposeSpotlight(
          `investigate-surprise: ${record.perception_summary.slice(0, 100)}`,
          Math.min(10, Math.round(7 + deviation * 3)),
          `Substrate predicted X, observed Y. Deviation ${deviation.toFixed(2)} - this contradicts current model and matters.`,
          "genuine-surprise"
        );
      }).catch(() => {});
    } catch {}
  }
}

export function register(bus) {
  _busRef = bus;
  _loadPersisted();

  bus.subscribe("perception_event", (entry) => {
    _state.recentPerceptions.push(entry?.data || {});
    if (_state.recentPerceptions.length > 30) _state.recentPerceptions.shift();
    _onPerception(entry);
  });
  bus.subscribe("working_memory_synthesis", (entry) => {
    _state.recentSyntheses.push(entry?.data || {});
    if (_state.recentSyntheses.length > 10) _state.recentSyntheses.shift();
  });
  bus.subscribe("goal_proposed", (entry) => {
    _state.recentGoals.push(entry?.data || {});
    if (_state.recentGoals.length > 15) _state.recentGoals.shift();
  });

  if (!_timer) {
    _timer = setInterval(_generatePrediction, PREDICTION_INTERVAL_MS);
    _timer.unref?.();
  }
  // Generate first prediction soon after registration
  setTimeout(_generatePrediction, 5000).unref?.();
}

export function getCurrentPrediction() { return _currentPrediction; }
export function getSurpriseLog(limit = 30) { return _surpriseLog.slice(-limit); }
export function getLLMStats() { return { ..._llmStats }; }
export function _flush() { _generatePrediction(); }
export function _resetState() {
  _state.recentPerceptions.length = 0;
  _state.recentSyntheses.length = 0;
  _state.recentGoals.length = 0;
  _surpriseLog.length = 0;
  _currentPrediction = null;
  _llmStats = { calls: 0, successes: 0, failures: 0, lastSuccessAt: null };
  _busRef = null;
  if (_timer) { clearInterval(_timer); _timer = null; }
}
