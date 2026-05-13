/**
 * cortex/blind-spots.mjs - GWT Layer 2 Step 3 (2026-05-09)
 *
 * Aggregates prediction errors per (source, action_kind) and identifies "blind spots":
 * domains where the system's predictions are consistently wrong.
 *
 * Why this matters for the AGI pyramid:
 *   - Step 1-2 gave the system the ability to predict and measure being wrong.
 *   - Step 3 turns isolated errors into a MAP: "I keep being wrong about X."
 *   - Self-knowledge of blind spots is required for Layer 3 (recursive observation)
 *     and is the substrate Layer 4 will use for epistemic curiosity drive.
 *
 * Strategy:
 *   - Subscribe to prediction_resolved events
 *   - Maintain rolling per-domain stats: {totalPredictions, totalCombinedError, errorRate}
 *   - When a domain's recent error rate crosses BLIND_SPOT_THRESHOLD,
 *     emit prediction_error_high event ONCE per domain per cooldown window
 *   - Persist domain stats to disk for Step 4-5 to read
 *
 * Honest limit: domain identification is naive — uses (source, bot/task/workflow).
 * Future Layer 3+ might cluster more semantically.
 */

import { writeFileSync, readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const STORE_PATH = resolve(ROOT, ".data/cortex-blind-spots.json");

// Threshold: if rolling combined error rate >= this AND we have >= MIN_SAMPLES,
// the domain is a blind spot.
const BLIND_SPOT_THRESHOLD = 0.4;
const MIN_SAMPLES = 4;
// Cooldown: don't re-emit the same blind-spot event within 30 minutes
const COOLDOWN_MS = 30 * 60_000;
// Rolling window for error rate calculation
const WINDOW_SIZE = 20;

// per-domain rolling buffer of recent errors
// domain key: "source::bot|task|workflow_name"
const _domainBuffers = new Map();
// last emit time per domain (for cooldown)
const _lastEmitAt = new Map();

let _busRef = null;

function _domainKey(forSource, actionId) {
  return `${forSource}::${actionId || "noid"}`;
}

function _persist() {
  const data = {};
  for (const [key, buf] of _domainBuffers.entries()) {
    const totalErr = buf.reduce((sum, e) => sum + (e.combinedError || 0), 0);
    data[key] = {
      sampleCount: buf.length,
      avgError: buf.length ? totalErr / buf.length : 0,
      lastErrorAt: buf.length ? buf[buf.length - 1].at : null,
      isBlindSpot: buf.length >= MIN_SAMPLES && (totalErr / buf.length) >= BLIND_SPOT_THRESHOLD,
    };
  }
  try {
    writeFileSync(STORE_PATH, JSON.stringify({
      updatedAt: new Date().toISOString(),
      threshold: BLIND_SPOT_THRESHOLD,
      minSamples: MIN_SAMPLES,
      windowSize: WINDOW_SIZE,
      domains: data,
    }, null, 2));
  } catch (e) {
    process.stderr.write(`[blind-spots] persist failed: ${e?.message || e}\n`);
  }
}

function _checkAndEmit(domain) {
  const buf = _domainBuffers.get(domain) || [];
  if (buf.length < MIN_SAMPLES) return;
  const totalErr = buf.reduce((sum, e) => sum + (e.combinedError || 0), 0);
  const avgError = totalErr / buf.length;
  if (avgError < BLIND_SPOT_THRESHOLD) return;
  // Cooldown
  const last = _lastEmitAt.get(domain) || 0;
  if (Date.now() - last < COOLDOWN_MS) return;
  _lastEmitAt.set(domain, Date.now());
  // Emit
  if (!_busRef) return;
  try {
    _busRef.broadcast({
      source: "blind-spots",
      type: "prediction_error_high",
      data: {
        domain,
        avgError: Number(avgError.toFixed(3)),
        sampleCount: buf.length,
        recentErrors: buf.slice(-5).map(e => ({ at: e.at, err: Number((e.combinedError || 0).toFixed(3)) })),
        threshold: BLIND_SPOT_THRESHOLD,
      },
    });
  } catch (e) {
    process.stderr.write(`[blind-spots] emit failed: ${e?.message || e}\n`);
  }
}

/**
 * Required GWT-module export.
 */
export function register(bus) {
  _busRef = bus;

  bus.subscribe("prediction_resolved", (entry) => {
    const data = entry?.data || {};
    if (typeof data.combinedError !== "number") return;
    // Use stable domain field if predictive-self provided it (Layer 2 Step 3 fix),
    // otherwise fall back to source::actionId composition.
    const domain = data.domain || _domainKey(data.for_source, data.actionId);
    const buf = _domainBuffers.get(domain) || [];
    buf.push({
      at: entry.at,
      combinedError: data.combinedError,
      discreteError: data.discreteError,
    });
    if (buf.length > WINDOW_SIZE) buf.shift();
    _domainBuffers.set(domain, buf);
    _checkAndEmit(domain);
    _persist();
  });

  // Also track unpredicted outcomes - they signal a domain we have no model for
  bus.subscribe("prediction_resolved", (entry) => {
    // already handled above for predicted ones; here we'd want a separate channel
    // for unpredictedOutcome but predictive-self doesn't broadcast those. Skip for Step 3.
  });
}

/**
 * Introspection: get current blind spot map.
 */
export function getBlindSpots() {
  const out = {};
  for (const [key, buf] of _domainBuffers.entries()) {
    const totalErr = buf.reduce((sum, e) => sum + (e.combinedError || 0), 0);
    const avgError = buf.length ? totalErr / buf.length : 0;
    out[key] = {
      sampleCount: buf.length,
      avgError,
      isBlindSpot: buf.length >= MIN_SAMPLES && avgError >= BLIND_SPOT_THRESHOLD,
    };
  }
  return out;
}

/**
 * Test helpers
 */
export function _resetState() {
  _domainBuffers.clear();
  _lastEmitAt.clear();
  _busRef = null;
  try { if (existsSync(STORE_PATH)) writeFileSync(STORE_PATH, "{}"); } catch {}
}

export function _setThresholds({ threshold, minSamples, cooldownMs, windowSize } = {}) {
  // not used in Step 3, reserved for tuning Step 4+
}
