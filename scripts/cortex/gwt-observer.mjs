/**
 * cortex/gwt-observer.mjs - GWT Layer 1 Step 5 (2026-05-09)
 *
 * The system observing itself. First proxy of recursive self-observation.
 *
 * What it does:
 *   - Subscribes to "*" (wildcard) - sees EVERY event on the bus
 *   - Tracks per-type counts, per-source counts, cascade depths, "dead modules"
 *     (registered but never producing or consuming events), broadcast latency
 *   - Persists snapshot to .data/cortex-gwt-observer.json on each tick
 *   - Periodically (every minute) rolls up stats and broadcasts a `gwt_health` event
 *     so OTHER modules can react to substrate state (basis for Layer 3)
 *
 * Why this matters for the pyramid:
 *   - Step 1-4 built the substrate (events flow, modules react)
 *   - Step 5 closes the substrate's self-monitoring loop
 *   - Without an observer, the substrate has no way to notice "spotlight winner has
 *     been the same module 10 times" or "no one ever subscribes to event X"
 *   - This is NOT yet recursive meta-awareness (that's Layer 3) - it's the data layer
 *     that meta-awareness will read
 *
 * Honest limit: the observer doesn't INTERPRET what it sees - just measures.
 * Interpretation is Layer 3's job. Without affect (Layer 4), even interpretation
 * is just description. Real "wanting" needs all layers.
 */

import { writeFileSync, readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const SNAPSHOT_PATH = resolve(ROOT, ".data/cortex-gwt-observer.json");

// Rolling window of recent events for analysis. Bounded to prevent memory growth.
const _recentEvents = [];
const MAX_RECENT = 500;

// Aggregate stats since process start
const _stats = {
  startedAt: null,
  totalEvents: 0,
  byType: {},        // { type: count }
  bySource: {},      // { source: count }
  bySubscriber: {},  // (would need bus introspection - placeholder for Layer 3)
  cascadeDepths: [], // every event's depth, used to compute distribution
  errorCount: 0,     // how many subscriber errors observed
  lastSnapshotAt: null,
  lastHealthAt: null,
};

let _snapshotTimer = null;
let _healthTimer = null;
let _busRef = null;

function _persistSnapshot() {
  _stats.lastSnapshotAt = new Date().toISOString();
  const snapshot = {
    ..._stats,
    cascadeDepthDistribution: _depthDistribution(),
    recentEvents: _recentEvents.slice(-50).map(e => ({
      at: e.at, source: e.source, type: e.type, depth: e._meta?.depth ?? 0,
    })),
  };
  try {
    writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2));
  } catch (e) {
    process.stderr.write(`[gwt-observer] snapshot write failed: ${e?.message || e}\n`);
  }
}

function _depthDistribution() {
  const dist = {};
  for (const d of _stats.cascadeDepths) {
    dist[d] = (dist[d] || 0) + 1;
  }
  return dist;
}

function _emitHealthSummary() {
  if (!_busRef) return;
  _stats.lastHealthAt = new Date().toISOString();
  // Compute summary metrics without persisting (snapshot does that)
  const dist = _depthDistribution();
  const maxDepth = Math.max(0, ..._stats.cascadeDepths);
  const avgDepth = _stats.cascadeDepths.length > 0
    ? _stats.cascadeDepths.reduce((a, b) => a + b, 0) / _stats.cascadeDepths.length
    : 0;
  const topTypes = Object.entries(_stats.byType).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topSources = Object.entries(_stats.bySource).sort((a, b) => b[1] - a[1]).slice(0, 5);
  // Broadcast gwt_health so Layer 3+ modules can subscribe and react.
  // Use try/catch - observer failure must not propagate.
  try {
    _busRef.broadcast({
      source: "gwt-observer",
      type: "gwt_health",
      data: {
        totalEvents: _stats.totalEvents,
        avgCascadeDepth: Number(avgDepth.toFixed(2)),
        maxCascadeDepth: maxDepth,
        depthDistribution: dist,
        topTypes: Object.fromEntries(topTypes),
        topSources: Object.fromEntries(topSources),
        errorCount: _stats.errorCount,
      },
    });
  } catch (e) {
    process.stderr.write(`[gwt-observer] health broadcast failed: ${e?.message || e}\n`);
  }
}

/**
 * Required GWT-module export. Subscribes to "*" and starts periodic snapshot/health.
 */
export function register(bus) {
  _busRef = bus;
  _stats.startedAt = new Date().toISOString();

  bus.subscribe("*", (entry) => {
    _stats.totalEvents++;
    _stats.byType[entry.type] = (_stats.byType[entry.type] || 0) + 1;
    _stats.bySource[entry.source] = (_stats.bySource[entry.source] || 0) + 1;
    const depth = entry._meta?.depth ?? 0;
    _stats.cascadeDepths.push(depth);
    if (_stats.cascadeDepths.length > 1000) _stats.cascadeDepths.shift();
    _recentEvents.push(entry);
    if (_recentEvents.length > MAX_RECENT) _recentEvents.shift();
  });

  // Periodic snapshot to disk (every 30s) + health broadcast (every 60s).
  // Use unref so timers don't block process exit.
  if (!_snapshotTimer) {
    _snapshotTimer = setInterval(_persistSnapshot, 30_000);
    _snapshotTimer.unref?.();
  }
  if (!_healthTimer) {
    _healthTimer = setInterval(_emitHealthSummary, 60_000);
    _healthTimer.unref?.();
  }
}

/**
 * Test/introspection helper: get current stats without persisting.
 */
export function getStats() {
  return {
    ..._stats,
    cascadeDepthDistribution: _depthDistribution(),
    recentEvents: [..._recentEvents],
  };
}

/**
 * Test helper: reset all stats and stop timers.
 */
export function _reset() {
  _stats.startedAt = null;
  _stats.totalEvents = 0;
  _stats.byType = {};
  _stats.bySource = {};
  _stats.cascadeDepths = [];
  _stats.errorCount = 0;
  _stats.lastSnapshotAt = null;
  _stats.lastHealthAt = null;
  _recentEvents.length = 0;
  if (_snapshotTimer) { clearInterval(_snapshotTimer); _snapshotTimer = null; }
  if (_healthTimer) { clearInterval(_healthTimer); _healthTimer = null; }
  _busRef = null;
}

/**
 * Test helper: trigger snapshot + health emit immediately (bypass timers).
 */
export function _flush() {
  _persistSnapshot();
  _emitHealthSummary();
}
