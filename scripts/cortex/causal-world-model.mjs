/**
 * cortex/causal-world-model.mjs - Causal graph over observed events
 *   (Kirill's AGI roadmap direction #1: World Model, May 9 2026)
 *
 * Real world model approximation. Not deep ML world model (would need PyTorch
 * + graph DB + causal inference framework). What this builds:
 *
 * NODES: distinct event types observed (e.g. "perception:positive_franchise_signal",
 *        "cortex_action:outreach_dispatched", "perception:rejection_email")
 *
 * EDGES: directed causal links A->B with weight = how often B follows A within
 *        a time window. As substrate observes, graph updates.
 *
 * PATTERN DETECTION: when A->B fires N times with consistent timing, mark as
 *        "confirmed pattern". Use Claude to interpret WHY this causation might
 *        be (semantic explanation grounded in actual events).
 *
 * QUERY: substrate can ask "given current event, what is likely to follow?"
 *        Returns probability distribution over likely next events with
 *        Claude-generated explanation.
 *
 * INTERVENTION: substrate can ask "if I do X, what tends to happen?" Compare
 *        graph paths starting from X vs starting from current state.
 *
 * Limitation: this is observational, not interventional in causal-inference
 * sense. Real intervention modeling (Pearl's do-calculus) needs counterfactual
 * graph manipulation we cannot do here. But: graph that learns from observation
 * IS substantively more than perception's flat classification.
 */

import { writeFileSync, readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const GRAPH_PATH = resolve(ROOT, ".data/cortex-causal-graph.json");

const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";
const CLAUDE_MODEL = "claude-sonnet-4-6";
const CLAUDE_TIMEOUT_MS = 60_000;

const CAUSAL_WINDOW_MS = 60_000; // events within 60s of each other considered candidate cause-effect
const PATTERN_CONFIRMATION_COUNT = 4; // edge fires 4+ times = confirmed pattern
const INTERPRETATION_INTERVAL_MS = 30 * 60_000; // every 30min interpret new patterns

// Graph structure
let _graph = {
  nodes: {},  // id -> { id, type, source, label, first_seen, last_seen, count }
  edges: {},  // "A->B" -> { from, to, count, avg_delay_ms, last_seen, confirmed: bool, interpretation: str }
  meta: {
    total_observations: 0,
    confirmed_patterns: 0,
    last_interpretation_at: null,
  },
};

// Recent events buffer for finding causal candidates
const _recentEvents = []; // { id, at, node_id }
const RECENT_BUFFER_SIZE = 100;

let _busRef = null;
let _llmStats = { calls: 0, successes: 0, failures: 0, lastSuccessAt: null };
let _interpretTimer = null;

function _loadPersisted() {
  if (!existsSync(GRAPH_PATH)) return;
  try {
    const raw = JSON.parse(readFileSync(GRAPH_PATH, "utf-8"));
    if (raw?.graph) _graph = raw.graph;
  } catch {}
}

function _persist() {
  try {
    writeFileSync(GRAPH_PATH, JSON.stringify({
      updatedAt: new Date().toISOString(),
      llmStats: _llmStats,
      graph: _graph,
      stats: {
        node_count: Object.keys(_graph.nodes).length,
        edge_count: Object.keys(_graph.edges).length,
        confirmed_patterns: _graph.meta.confirmed_patterns,
      },
    }, null, 2));
  } catch (e) {
    process.stderr.write(`[causal-world-model] persist failed: ${e?.message || e}\n`);
  }
}

function _nodeIdForEvent(entry) {
  // Build stable node ID. For perception events, use source + valence.
  // For other events, use type alone.
  const type = entry?.type || "unknown";
  const data = entry?.data || {};
  if (type === "perception_event") {
    return `perception::${data.source || "?"}::${data.valence || "neutral"}`;
  }
  if (type === "cortex_action_completed") {
    return `cortex_action::${data.action_type || "?"}::${data.success ? "ok" : "failed"}`;
  }
  if (type === "goal_proposed") return `goal_proposed::P${data.priority || "?"}`;
  if (type === "self_noticing") return `self_noticing::${data.kind || "?"}`;
  if (type === "memory_scar") return `memory_scar::${data.trigger_event_type || "?"}`;
  if (type === "task_dispatched") return `task_dispatched`;
  return `${type}::${entry?.source || "?"}`;
}

function _ensureNode(nodeId, entry) {
  if (!_graph.nodes[nodeId]) {
    _graph.nodes[nodeId] = {
      id: nodeId,
      type: entry?.type,
      source: entry?.source,
      label: nodeId,
      first_seen: entry?.at || new Date().toISOString(),
      last_seen: entry?.at || new Date().toISOString(),
      count: 0,
    };
  }
  _graph.nodes[nodeId].last_seen = entry?.at || new Date().toISOString();
  _graph.nodes[nodeId].count++;
}

function _registerObservation(entry) {
  if (!entry?.type) return;
  // Skip self-events to prevent recursion
  if (entry.source === "causal-world-model") return;
  // Skip very high-frequency low-info events
  if (["gwt_health", "free_energy", "stake_update", "affect_state"].includes(entry.type)) return;

  const nodeId = _nodeIdForEvent(entry);
  _ensureNode(nodeId, entry);
  _graph.meta.total_observations++;

  const now = new Date(entry?.at || Date.now()).getTime();

  // Find candidate causes (events in recent window before this one)
  for (const recent of _recentEvents) {
    const recentTime = new Date(recent.at).getTime();
    const delay = now - recentTime;
    if (delay <= 0 || delay > CAUSAL_WINDOW_MS) continue;
    if (recent.node_id === nodeId) continue; // self-loop skip

    const edgeKey = `${recent.node_id}->${nodeId}`;
    if (!_graph.edges[edgeKey]) {
      _graph.edges[edgeKey] = {
        from: recent.node_id,
        to: nodeId,
        count: 0,
        total_delay_ms: 0,
        avg_delay_ms: 0,
        last_seen: entry?.at,
        confirmed: false,
        interpretation: null,
      };
    }
    const edge = _graph.edges[edgeKey];
    edge.count++;
    edge.total_delay_ms += delay;
    edge.avg_delay_ms = Math.round(edge.total_delay_ms / edge.count);
    edge.last_seen = entry?.at;

    // Confirm pattern when count threshold reached
    if (!edge.confirmed && edge.count >= PATTERN_CONFIRMATION_COUNT) {
      edge.confirmed = true;
      _graph.meta.confirmed_patterns++;
      // Will get Claude interpretation on next interval
      if (_busRef) {
        try {
          _busRef.broadcast({
            source: "causal-world-model",
            type: "pattern_confirmed",
            data: {
              edge: edgeKey,
              count: edge.count,
              avg_delay_ms: edge.avg_delay_ms,
            },
          });
        } catch {}
      }
    }
  }

  // Add this event to recent buffer
  _recentEvents.push({ at: entry?.at, node_id: nodeId });
  if (_recentEvents.length > RECENT_BUFFER_SIZE) _recentEvents.shift();

  _persist();
}

// ─── Pattern interpretation via Claude ─────────────────────────────────

async function _interpretNewConfirmedPatterns() {
  const unconfirmed = Object.entries(_graph.edges).filter(([_, e]) => e.confirmed && !e.interpretation);
  if (unconfirmed.length === 0) return;

  // Process up to 3 at a time
  const batch = unconfirmed.slice(0, 3);
  for (const [edgeKey, edge] of batch) {
    try {
      const budget = await import("./llm-budget-guard.mjs");
      const guard = budget.canCall("causal-world-model-interpret", "claude-sonnet-4-6");
      if (!guard.allow) return;
    } catch {}

    const fromNode = _graph.nodes[edge.from];
    const toNode = _graph.nodes[edge.to];

    const prompt = `You are the causal-world-model interpreter for an autonomous cognitive substrate. A pattern has been confirmed via observation: event A consistently precedes event B in time. You explain WHY this might be causal vs coincidence.

PATTERN:
A: ${edge.from} (observed ${fromNode?.count || "?"} times total)
B: ${edge.to} (observed ${toNode?.count || "?"} times total)
A->B count: ${edge.count}
Average delay: ${edge.avg_delay_ms}ms
Last observed: ${edge.last_seen}

Output JSON ONLY:
{
  "is_likely_causal": true|false,
  "interpretation": "<2-3 sentences: what this pattern likely means in plain language>",
  "alternative_explanations": ["<other reasons A->B might appear without A causing B>"],
  "actionable_implication": "<1 sentence - what substrate should do differently knowing this pattern, or null>",
  "confidence": "high" | "medium" | "low"
}

Use hyphens, never em dashes. Output JSON only.`;

    _llmStats.calls++;
    const r = spawnSync(CLAUDE_BIN, ["-p", "--model", CLAUDE_MODEL, "--max-turns", "1"], {
      input: prompt, encoding: "utf-8", timeout: CLAUDE_TIMEOUT_MS,
    });
    try {
      const budget = await import("./llm-budget-guard.mjs");
      budget.recordCall("causal-world-model-interpret", "claude-sonnet-4-6");
    } catch {}

    if (r.status !== 0 || !r.stdout) { _llmStats.failures++; continue; }
    const m = r.stdout.match(/\{[\s\S]*\}/);
    if (!m) { _llmStats.failures++; continue; }
    try {
      const parsed = JSON.parse(m[0]);
      _llmStats.successes++;
      _llmStats.lastSuccessAt = new Date().toISOString();
      edge.interpretation = parsed;
      _persist();

      if (_busRef && parsed.actionable_implication) {
        try {
          _busRef.broadcast({
            source: "causal-world-model",
            type: "pattern_interpreted",
            data: {
              edge: edgeKey,
              interpretation: parsed.interpretation,
              actionable: parsed.actionable_implication,
              confidence: parsed.confidence,
            },
          });
        } catch {}
      }
    } catch { _llmStats.failures++; }
  }
  _graph.meta.last_interpretation_at = new Date().toISOString();
}

// ─── Public query API ──────────────────────────────────────────────────

/**
 * Given a node id (current event), what nodes are likely to follow based on graph?
 * Returns sorted list of likely follows with probability and avg delay.
 */
export function predictNext(currentNodeId, topK = 5) {
  const candidates = Object.values(_graph.edges)
    .filter(e => e.from === currentNodeId)
    .map(e => ({
      to: e.to,
      probability: e.count / (_graph.nodes[currentNodeId]?.count || 1),
      avg_delay_ms: e.avg_delay_ms,
      confirmed: e.confirmed,
      interpretation: e.interpretation?.interpretation || null,
    }))
    .sort((a, b) => b.probability - a.probability);
  return candidates.slice(0, topK);
}

/**
 * What patterns have been confirmed in the graph?
 */
export function getConfirmedPatterns() {
  return Object.entries(_graph.edges)
    .filter(([_, e]) => e.confirmed)
    .map(([key, e]) => ({
      pattern: key,
      count: e.count,
      avg_delay_ms: e.avg_delay_ms,
      interpretation: e.interpretation,
    }));
}

export function getGraphStats() {
  return {
    node_count: Object.keys(_graph.nodes).length,
    edge_count: Object.keys(_graph.edges).length,
    confirmed_patterns: _graph.meta.confirmed_patterns,
    total_observations: _graph.meta.total_observations,
  };
}

// ─── Required GWT-module export ─────────────────────────────────────────

export function register(bus) {
  _busRef = bus;
  _loadPersisted();

  // Subscribe to wildcard - we observe everything to build causal graph
  bus.subscribe("*", _registerObservation);

  if (!_interpretTimer) {
    _interpretTimer = setInterval(() => _interpretNewConfirmedPatterns().catch(() => {}), INTERPRETATION_INTERVAL_MS);
    _interpretTimer.unref?.();
  }
}

export function getLLMStats() { return { ..._llmStats }; }
export function _flush() { return _interpretNewConfirmedPatterns(); }
export function _resetState() {
  _graph = { nodes: {}, edges: {}, meta: { total_observations: 0, confirmed_patterns: 0, last_interpretation_at: null } };
  _recentEvents.length = 0;
  _llmStats = { calls: 0, successes: 0, failures: 0, lastSuccessAt: null };
  _busRef = null;
  if (_interpretTimer) { clearInterval(_interpretTimer); _interpretTimer = null; }
}
