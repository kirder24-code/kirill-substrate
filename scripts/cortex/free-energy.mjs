/**
 * cortex/free-energy.mjs - GWT Layer 2 Step 5 (2026-05-09)
 *
 * SYSTEM-LEVEL DRIVE: aggregates ALL prediction errors into a single "free energy"
 * scalar that represents how much the system's model diverges from reality overall.
 *
 * Per Friston's free energy principle:
 *   - Living systems minimize prediction error to maintain coherent self-model
 *   - High free energy = "I am in unfamiliar territory" → drives exploration
 *   - Low free energy = "I understand my world" → can pursue planned action
 *   - The gradient itself is the substrate for "wanting"
 *
 * What this module does:
 *   - Subscribes to ALL prediction_resolved events (across all domains)
 *   - Maintains a rolling window of recent (combinedError, age_ms) tuples
 *   - Computes free energy as weighted-by-recency average error
 *   - Periodically broadcasts free_energy event so other modules can react:
 *     - high free_energy → curiosity should research
 *     - high free_energy → attention should bias toward learning
 *     - low free_energy → system can rest or pursue revenue work confidently
 *
 * Why this matters for AGI pyramid:
 *   - Layer 1 substrate: events flow
 *   - Layer 2 Steps 1-4: predict, measure, identify blind spots, act on them
 *   - Layer 2 Step 5: GLOBAL motivator. The system has "I am surprised" as a number.
 *   - Layer 4 (affect) will use free_energy as one input to satisfaction/frustration state.
 *   - This is NOT consciousness. It's the closest current substrate to "I want X" without
 *     hand-coded goals.
 *
 * Honest limit: weights are simple recency-decay (exponential, half-life 5 min).
 * Free energy in nervous systems is much more complex. This is a tractable proxy.
 */

const _errorWindow = []; // { combinedError, at }
const MAX_WINDOW = 100;
const HALF_LIFE_MS = 5 * 60_000; // 5 minutes

let _busRef = null;
let _broadcastTimer = null;
const BROADCAST_INTERVAL_MS = 60_000; // emit free_energy every 60s

function _decayWeight(ageMs) {
  // Exponential decay with HALF_LIFE_MS half-life: weight = 0.5^(ageMs / HALF_LIFE_MS)
  return Math.pow(0.5, ageMs / HALF_LIFE_MS);
}

function _computeFreeEnergy() {
  if (_errorWindow.length === 0) {
    return {
      value: null,
      samples: 0,
      components: {},
      status: "unknown",
      regime: "blind",
      grounding_status: "blind",
      confidence_basis: "none",
      provenance_chain: [],
    };
  }
  const now = Date.now();
  let totalWeight = 0;
  let weightedSum = 0;
  for (const e of _errorWindow) {
    const ageMs = now - new Date(e.at).getTime();
    const w = _decayWeight(ageMs);
    weightedSum += e.combinedError * w;
    totalWeight += w;
  }
  const value = totalWeight > 0 ? weightedSum / totalWeight : 0;
  return {
    value,
    samples: _errorWindow.length,
    halfLifeMs: HALF_LIFE_MS,
    windowSizeCap: MAX_WINDOW,
    status: "measured",
    grounding_status: "grounded",
    confidence_basis: "prediction_resolved_window",
    provenance_chain: _errorWindow.slice(-5).map((e) => ({
      kind: "prediction_resolved",
      at: e.at,
      combinedError: Number(e.combinedError.toFixed?.(3) ?? e.combinedError),
    })),
  };
}

function _emitFreeEnergy() {
  if (!_busRef) return;
  const fe = _computeFreeEnergy();
  // Categorize for downstream consumers (Layer 3+ may want simple high/medium/low)
  let regime = fe.regime;
  if (!regime) {
    if (fe.value >= 0.6) regime = "high";       // system surprised, should investigate
    else if (fe.value >= 0.3) regime = "medium"; // mixed
    else regime = "low";                          // system understands its world
  }
  try {
    _busRef.broadcast({
      source: "free-energy",
      type: "free_energy",
      data: {
        value: typeof fe.value === "number" ? Number(fe.value.toFixed(3)) : null,
        samples: fe.samples,
        status: fe.status,
        regime,
        halfLifeMs: fe.halfLifeMs,
        grounding_status: fe.grounding_status,
        confidence_basis: fe.confidence_basis,
        provenance_chain: fe.provenance_chain,
      },
    });
  } catch (e) {
    process.stderr.write(`[free-energy] broadcast failed: ${e?.message || e}\n`);
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
    _errorWindow.push({ combinedError: data.combinedError, at: entry.at });
    if (_errorWindow.length > MAX_WINDOW) _errorWindow.shift();
  });

  if (!_broadcastTimer) {
    _broadcastTimer = setInterval(_emitFreeEnergy, BROADCAST_INTERVAL_MS);
    _broadcastTimer.unref?.();
  }
}

/**
 * Test/introspection helpers
 */
export function getFreeEnergy() {
  return _computeFreeEnergy();
}

export function _flush() {
  // Force immediate broadcast (test helper, bypasses timer)
  _emitFreeEnergy();
}

export function _resetState() {
  _errorWindow.length = 0;
  _busRef = null;
  if (_broadcastTimer) { clearInterval(_broadcastTimer); _broadcastTimer = null; }
}
