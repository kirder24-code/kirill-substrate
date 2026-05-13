/**
 * cortex/affect-state.mjs - GWT Layer 4 Steps 1-3 (2026-05-09)
 *
 * GOAL-DRIVEN AFFECT: 4 internal state variables tied to real outcomes.
 *
 * The first time this codebase has CONTINUOUS internal state derived from real
 * substrate events. Not log-based. Not snapshot-based. State that grows, decays,
 * and biases downstream decisions.
 *
 * State variables (each in [0, 1]):
 *   - satisfaction: how much recent outcomes match goals (success events)
 *   - frustration: how stuck / how many failures + repetitions
 *   - curiosity:   epistemic drive (high prediction errors + blind spots)
 *   - fatigue:     low when actively engaged, high when substrate silent / cycles wasted
 *
 * Update rules (per event):
 *   bot_result success            -> satisfaction += 0.05 (caps at 1)
 *   bot_result failure            -> frustration += 0.10
 *   prediction_error_high         -> curiosity += 0.15, frustration += 0.05
 *   pattern_repetition            -> frustration += 0.20 (stuck = bad)
 *   spotlight_winner              -> fatigue -= 0.10 (engaged), satisfaction += 0.02
 *   investigation_proposed        -> curiosity += 0.05
 *   self_noticing (high salience) -> curiosity += 0.05 if salience >= 7
 *   meta_noticing                 -> fatigue -= 0.05 (system observing itself)
 *   free_energy regime=high       -> curiosity += 0.10
 *   free_energy regime=low        -> satisfaction += 0.03 (model fits world)
 *
 * Decay (per tick, every 60s):
 *   each state var decays by DECAY_RATE_PER_MIN toward 0.5 (neutral)
 *   half-life ~10 min unless reinforced by events
 *
 * Why this matters for AGI pyramid:
 *   - Layer 1-3 gave the system substrate, predictions, recursive observation.
 *     But everything was reactive/scheduled. No continuous "drive" state.
 *   - Layer 4 Step 1-3 (THIS): the system has 4 dimensions of "how does it feel
 *     right now" derived from real signals.
 *   - Layer 4 Step 4 (next): attention proposals get urgency bias from affect.
 *   - Layer 4 Step 5 (next): when affect crosses threshold, system reaches out
 *     to Kirill via Telegram (proxy for "system has something it wants to say").
 *
 * Honest limits:
 *   - The 4 vars + update rules are MY OPINION on what should drive an AGI substrate.
 *     Different cognitive theories have different sets (e.g. PAD model: pleasure,
 *     arousal, dominance; or basic emotions). Choosing 4 with these names is
 *     a design decision that biases what behaviors emerge.
 *   - Tuning of update magnitudes and decay rate is heuristic. Layer 4 Step 5
 *     observability will help calibrate.
 *   - Affect state is a NUMBER. Whether the system "feels" anything is
 *     unprovable phenomenologically. This is BEHAVIORAL drive, not subjective.
 */

import { writeFileSync, readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const STATE_PATH = resolve(ROOT, ".data/cortex-affect-state.json");

const NEUTRAL = 0.5;
const DECAY_PER_TICK = 0.05; // 5% toward neutral per tick (60s) → ~10min half-life

// Internal state vars
const _state = {
  satisfaction: NEUTRAL,
  frustration: NEUTRAL,
  curiosity: NEUTRAL,
  fatigue: NEUTRAL,
  lastUpdated: null,
  lastBroadcastAt: null,
};

// History of affect transitions (for Layer 5+ to read)
const _history = [];
const MAX_HISTORY = 200;

let _busRef = null;
let _decayTimer = null;
let _broadcastTimer = null;
const TICK_INTERVAL_MS = 60_000; // decay + broadcast every 60s
const GROUNDING_FRESH_MS = 10 * 60_000;
const STRONG_SATISFACTION_FLOOR = 0.9;
const UNGROUNDED_SATISFACTION_CAP = 0.699;
let _lastGroundedPositiveAt = null;

function _isFreshGrounded(entry) {
  const data = entry?.data || {};
  // Explicit ungrounded markers always disqualify
  if (["blind", "unknown", "ungrounded", "stale"].includes(data.grounding_status)) return false;
  const observedAt = Date.parse(data.observed_at || entry?.at || "");
  const expiresAt = Date.parse(data.expires_at || "");
  if (!Number.isFinite(observedAt)) return false;
  if (Number.isFinite(expiresAt) && expiresAt < Date.now()) return false;
  if (Date.now() - observedAt > GROUNDING_FRESH_MS) return false;
  // FIX (May 11 2026): action_id alone is just an identifier substrate
  // gave the call, not evidence of real-world outcome. False-positive bug:
  // every bot_result has action_id, so all bot_results counted as grounded,
  // letting satisfaction climb to 0.97 detached from reality (substrate's
  // own diagnosis + 4-AI council confirmation).
  // Real grounding requires EXTERNAL evidence:
  //   - explicit grounding_status === "grounded"
  //   - OR provenance_chain with >= 1 entry (multi-step trace to source)
  //   - OR observation_id (external observation reference)
  //   - OR outcome_id (independent outcome ledger entry)
  //   - OR operator_confirmation === true (operator marked it)
  if (data.grounding_status === "grounded") return true;
  const chain = Array.isArray(data.provenance_chain) ? data.provenance_chain : [];
  if (chain.length > 0) return true;
  if (data.observation_id) return true;
  if (data.outcome_id) return true;
  if (data.operator_confirmation === true) return true;
  return false; // action_id alone is NOT grounding
}

function _rememberPositiveGrounding(entry) {
  if (_isFreshGrounded(entry)) _lastGroundedPositiveAt = new Date().toISOString();
}

function _hasFreshPositiveGrounding() {
  if (!_lastGroundedPositiveAt) return false;
  const ageMs = Date.now() - Date.parse(_lastGroundedPositiveAt);
  return Number.isFinite(ageMs) && ageMs <= GROUNDING_FRESH_MS;
}

function _clamp(v) {
  return Math.max(0, Math.min(1, v));
}

function _adjust(varName, delta, reason) {
  const before = _state[varName];
  const after = _clamp(before + delta);
  if (after !== before) {
    _state[varName] = after;
    _state.lastUpdated = new Date().toISOString();
    _history.push({
      at: _state.lastUpdated,
      var: varName,
      before,
      after,
      delta,
      reason,
    });
    if (_history.length > MAX_HISTORY) _history.shift();
  }
}

function _persist() {
  try {
    writeFileSync(STATE_PATH, JSON.stringify({
      ..._state,
      recentHistory: _history.slice(-30),
    }, null, 2));
  } catch (e) {
    process.stderr.write(`[affect-state] persist failed: ${e?.message || e}\n`);
  }
}

function _decay() {
  for (const k of ["satisfaction", "frustration", "curiosity", "fatigue"]) {
    const v = _state[k];
    const dist = NEUTRAL - v;
    if (Math.abs(dist) < 0.001) continue;
    const move = dist * DECAY_PER_TICK;
    _state[k] = _clamp(v + move);
  }
  _state.lastUpdated = new Date().toISOString();
}

function _classifyState(state = _state) {
  // Simple regime: which var dominates? (Step 5 will use this)
  const vars = ["satisfaction", "frustration", "curiosity", "fatigue"];
  // Distance from neutral - the var furthest from 0.5 dominates
  const dominant = vars.reduce((best, v) =>
    Math.abs(state[v] - NEUTRAL) > Math.abs(state[best] - NEUTRAL) ? v : best
  );
  const dominantDist = Math.abs(state[dominant] - NEUTRAL);
  const intensity = dominantDist >= 0.4 ? "strong" :
                    dominantDist >= 0.2 ? "moderate" : "neutral";
  return { dominant, intensity, dominantValue: state[dominant] };
}

function _broadcastState() {
  if (!_busRef) return;
  let reportedSatisfaction = _state.satisfaction;
  const satisfactionGrounded = _hasFreshPositiveGrounding();
  if (reportedSatisfaction >= STRONG_SATISFACTION_FLOOR && !satisfactionGrounded) {
    reportedSatisfaction = UNGROUNDED_SATISFACTION_CAP;
  }
  const classification = _classifyState({
    satisfaction: reportedSatisfaction,
    frustration: _state.frustration,
    curiosity: _state.curiosity,
    fatigue: _state.fatigue,
  });
  _state.lastBroadcastAt = new Date().toISOString();
  try {
    _busRef.broadcast({
      source: "affect-state",
      type: "affect_state",
      data: {
        satisfaction: Number(reportedSatisfaction.toFixed(3)),
        frustration: Number(_state.frustration.toFixed(3)),
        curiosity: Number(_state.curiosity.toFixed(3)),
        fatigue: Number(_state.fatigue.toFixed(3)),
        dominant: classification.dominant,
        intensity: classification.intensity,
        grounding_status: satisfactionGrounded ? "grounded" : "ungrounded",
        confidence_basis: satisfactionGrounded ? "fresh_positive_outcome" : "no_fresh_positive_outcome",
        provenance_chain: satisfactionGrounded
          ? [{ kind: "positive_outcome_window", observed_at: _lastGroundedPositiveAt }]
          : [],
      },
    });
  } catch (e) {
    process.stderr.write(`[affect-state] broadcast failed: ${e?.message || e}\n`);
  }
}

function _tick() {
  _decay();
  _broadcastState();
  _persist();
}

/**
 * Required GWT-module export.
 */
export function register(bus) {
  _busRef = bus;

  // Reactive subscriptions (Step 1)
  bus.subscribe("bot_result", (entry) => {
    const success = !!entry?.data?.success;
    if (success) {
      _rememberPositiveGrounding(entry);
      _adjust("satisfaction", +0.05, "bot_result success");
    }
    else {
      _adjust("frustration", +0.10, "bot_result failure");
      _adjust("satisfaction", -0.05, "bot_result failure outcome");
    }
  });

  bus.subscribe("hands_result", (entry) => {
    if (entry?.data?.success) {
      _rememberPositiveGrounding(entry);
      _adjust("satisfaction", +0.05, "hands_result success");
    }
    else {
      _adjust("frustration", +0.10, "hands_result failure");
      _adjust("satisfaction", -0.05, "hands_result failure outcome");
    }
  });

  bus.subscribe("prediction_error_high", () => {
    _adjust("curiosity", +0.15, "prediction_error_high triggered");
    _adjust("frustration", +0.05, "blind spot detected");
  });

  bus.subscribe("pattern_repetition", () => {
    _adjust("frustration", +0.20, "pattern_repetition - stuck");
  });

  bus.subscribe("spotlight_winner", () => {
    _adjust("fatigue", -0.10, "spotlight_winner - engaged");
    _adjust("satisfaction", +0.02, "attention engaged");
  });

  bus.subscribe("investigation_proposed", () => {
    _adjust("curiosity", +0.05, "investigation queued");
  });

  bus.subscribe("self_noticing", (entry) => {
    const sal = entry?.data?.salience || 0;
    if (sal >= 7) _adjust("curiosity", +0.05, `high-salience noticing (${entry?.data?.kind})`);
  });

  bus.subscribe("meta_noticing", () => {
    _adjust("fatigue", -0.05, "meta-noticing - system observing self");
  });

  bus.subscribe("free_energy", (entry) => {
    const regime = entry?.data?.regime;
    if (regime === "high") _adjust("curiosity", +0.10, "free_energy high - unfamiliar territory");
    else if (regime === "low" && _isFreshGrounded(entry)) _adjust("satisfaction", +0.03, "free_energy low - model fits world");
    else if (regime === "blind" || entry?.data?.status === "unknown") _adjust("curiosity", +0.03, "free_energy blind - missing measurement");
  });

  // Periodic decay + broadcast (Step 2-3)
  if (!_decayTimer) {
    _decayTimer = setInterval(_tick, TICK_INTERVAL_MS);
    _decayTimer.unref?.();
  }
}

// ─── Test / introspection helpers ───────────────────────────────────────

export function getState() {
  return { ..._state, classification: _classifyState() };
}

export function getHistory(limit = 50) {
  return _history.slice(-limit);
}

export function _flush() { _tick(); }

export function _resetState() {
  _state.satisfaction = NEUTRAL;
  _state.frustration = NEUTRAL;
  _state.curiosity = NEUTRAL;
  _state.fatigue = NEUTRAL;
  _state.lastUpdated = null;
  _state.lastBroadcastAt = null;
  _lastGroundedPositiveAt = null;
  _history.length = 0;
  _busRef = null;
  if (_decayTimer) { clearInterval(_decayTimer); _decayTimer = null; }
  if (_broadcastTimer) { clearInterval(_broadcastTimer); _broadcastTimer = null; }
}

// Used by Step 4 (urgency biasing in attention)
export function getAffectBias() {
  // Returns numeric bias for attention urgency:
  //   high frustration -> +1 to +2 urgency for ALL proposals
  //   high curiosity   -> +1 specifically for investigation proposals (epistemic-driver, introspector)
  //   high fatigue     -> -1 (be conservative, prefer rest)
  //   high satisfaction -> 0 (no change, system stable)
  let urgencyDelta = 0;
  let investigationBoost = 0;
  if (_state.frustration >= 0.7) urgencyDelta += 2;
  else if (_state.frustration >= 0.6) urgencyDelta += 1;
  if (_state.curiosity >= 0.7) investigationBoost += 2;
  else if (_state.curiosity >= 0.6) investigationBoost += 1;
  if (_state.fatigue >= 0.7) urgencyDelta -= 1;
  return { urgencyDelta, investigationBoost, state: { ..._state } };
}
