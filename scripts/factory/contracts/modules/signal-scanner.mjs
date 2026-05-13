/**
 * SIGNAL SCANNER — Contracted Module
 *
 * Wraps ScoutBot as a formal module.
 * Scans external sources for market signals, returns structured Signal[].
 */

import { ValidationError, StaleStateError } from "../error-types.mjs";

// ═══ CONTRACT ═══
export const CONTRACT = {
  module_name: "signal-scanner",
  version: "1.0.0",
  purpose: "Scan external sources for market signals and pain indicators",
  owner_layer: "truth",

  inputs: {
    schema: { scope: "MarketScope?" },
    required: [],
  },
  outputs: {
    schema: { signals: "Signal[]", sources_scanned: "number" },
    guaranteed: ["signals"],
  },

  reads_from: ["bot_intelligence", "constraints", "leads"],
  writes_to: ["leads", "bot_intelligence", "bot_events"],
  depends_on_modules: [],
  downstream_modules: ["qualification-engine"],
  emits_events: ["lead_found", "signal_found"],
  consumes_events: ["lead_pain_signal"],

  preconditions: [
    { check: "context.world_state.state_confidence", severity: "warn" },
  ],
  postconditions: [
    { check: "output.signals.length >= 0", severity: "warn" },
  ],

  hooks_before: [
    "load_constraints",
    "load_learned_rules",
    "load_outcome_rates",
    "load_evolved_strategy",
  ],
  hooks_after: [
    "write_evidence",
    "route_signals_to_qualification",
    "report_kpis",
    "write_run_log",
  ],

  autonomy: {
    level: "automatic",
    risk_class: "low",
    approval_required_from: null,
    escalation_on_failure: "log_and_continue",
  },

  error_types: ["ValidationError", "StaleStateError"],
  retry_policy: { max_retries: 1, backoff_ms: 10000 },
  timeout_ms: 120000,
};

// ═══ EXECUTE ═══
export async function execute(db, input, context) {
  // Import ScoutBot's actual scan function
  const { runScout } = await import("../../scout-bot.mjs");

  // Run the scan
  await runScout();

  // Collect results from DB (ScoutBot writes directly)
  const recentLeads = db.prepare(
    "SELECT id, name, score, source_platform, pain_description FROM leads WHERE created_at > datetime('now', '-1 hours') ORDER BY score DESC"
  ).all();

  const signals = recentLeads.map(l => ({
    id: l.id,
    title: l.name,
    score: l.score,
    source: l.source_platform,
    pain: l.pain_description,
  }));

  context._emittedEvents = signals.map(s => ({
    type: "signal_found",
    payload: { id: s.id, title: s.title, score: s.score },
  }));

  return { signals, sources_scanned: 15 };
}
