/**
 * cortex/auto-react.mjs - GWT Layer 1 Step 2 (2026-05-09)
 *
 * First REAL event-reactive module in the cortex. Demonstrates the GWT primitive
 * "one module observes another's output and produces a derived signal" without
 * any daemon orchestration.
 *
 * What it does:
 *   - Subscribes to bot_result events (emitted by cortex-daemon when a bot completes)
 *   - Tracks a rolling buffer of recent (bot, success/fail, summary) tuples
 *   - When the SAME (bot, summary) repeats >= REPETITION_THRESHOLD times in a row,
 *     emits a "pattern_repetition" event so other modules can react (e.g. attention.mjs
 *     in Step 3 might escalate, or initiative.mjs might propose alternative)
 *
 * Why this is meaningful for GWT:
 *   - Until now, "bot did the same thing 5 times" was visible only to humans reading logs
 *   - With this module, the substrate itself notices repetition and broadcasts a derived signal
 *   - Other modules can now subscribe to "pattern_repetition" without knowing where it came from
 *   - This is the first proxy of "the system noticing itself"
 *
 * Honest limit: detection is naive (exact-match summary). Step 3-4 will replace with
 * semantic similarity. For Step 2 we just need ANY reactive signal flowing.
 */

const REPETITION_THRESHOLD = 3;
const BUFFER_SIZE = 20;

// Per-bot rolling buffer: { botName -> [{at, success, summary}] }
const _buffers = new Map();
// Per-bot last emitted pattern (so we don't spam pattern_repetition every cycle)
const _lastEmittedPattern = new Map();

function _summarize(data) {
  // bot_result events have shape { bot, success, summary?, error? }
  // Build a stable signature for repetition detection. Truncate to 100 chars.
  const success = data.success ? "ok" : "fail";
  const text = (data.summary || data.error || "").slice(0, 100).trim();
  return `${success}|${text}`;
}

function _checkAndEmitRepetition(bot, signature, bus) {
  const buf = _buffers.get(bot) || [];
  const recent = buf.slice(-REPETITION_THRESHOLD);
  if (recent.length < REPETITION_THRESHOLD) return false;
  const allSame = recent.every(e => e.signature === signature);
  if (!allSame) return false;
  // Don't re-emit the same pattern back-to-back
  if (_lastEmittedPattern.get(bot) === signature) return false;
  _lastEmittedPattern.set(bot, signature);
  bus.broadcast({
    source: "auto-react",
    type: "pattern_repetition",
    data: {
      bot,
      signature,
      consecutive_count: recent.length,
      detected_at: new Date().toISOString(),
    },
  });
  return true;
}

/**
 * Required GWT-module export: register handlers on the bus.
 * Called by event-router.registerAll() at cortex-daemon startup.
 */
export function register(bus) {
  bus.subscribe("bot_result", (entry) => {
    const data = entry?.data || {};
    const bot = data.bot;
    if (!bot) return;
    const signature = _summarize(data);
    const buf = _buffers.get(bot) || [];
    buf.push({ at: entry.at, signature });
    if (buf.length > BUFFER_SIZE) buf.shift();
    _buffers.set(bot, buf);
    _checkAndEmitRepetition(bot, signature, bus);
  });
}

// Test helpers (used by smoke test, not by production code)
export function _resetState() {
  _buffers.clear();
  _lastEmittedPattern.clear();
}
export function _getBufferFor(bot) {
  return [..._buffers.get(bot) || []];
}
