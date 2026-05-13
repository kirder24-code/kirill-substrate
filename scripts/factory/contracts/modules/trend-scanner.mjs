/**
 * TREND SCANNER — Contracted Module
 *
 * Wraps TrendBot as a formal module.
 * Scans GitHub, ProductHunt, HN for emerging tools/trends.
 */

import { ValidationError } from "../error-types.mjs";

// ═══ CONTRACT ═══
export const CONTRACT = {
  module_name: "trend-scanner",
  version: "1.0.0",
  purpose: "Scan GitHub/ProductHunt/HN for emerging automation tools and trends",
  owner_layer: "truth",

  inputs: {
    schema: { focus_markets: "string[]?" },
    required: [],
  },
  outputs: {
    schema: { trends: "Trend[]", sources_scanned: "number" },
    guaranteed: ["trends"],
  },

  reads_from: ["bot_intelligence", "constraints"],
  writes_to: ["bot_intelligence", "bot_events"],
  depends_on_modules: [],
  downstream_modules: ["qualification-engine"],
  emits_events: ["trend_spotted"],
  consumes_events: [],

  preconditions: [],
  postconditions: [
    { check: "output.trends.length >= 0", severity: "warn" },
  ],

  hooks_before: ["load_constraints"],
  hooks_after: [
    "route_trends_to_qualification",
    "report_kpis",
    "write_run_log",
  ],

  autonomy: {
    level: "automatic",
    risk_class: "low",
    approval_required_from: null,
    escalation_on_failure: "log_and_continue",
  },

  error_types: ["ValidationError"],
  retry_policy: { max_retries: 1, backoff_ms: 30000 },
  timeout_ms: 120000,
};

// ═══ EXECUTE ═══
export async function execute(db, input, context) {
  const { runTrend } = await import("../../trend-bot.mjs");
  await runTrend();

  // TrendBot emits events — collect from bot_events
  const recentTrends = db.prepare(
    "SELECT payload_json FROM bot_events WHERE event_type = 'trend_spotted' AND created_at > datetime('now', '-1 hours') AND processed = 0"
  ).all();

  const trends = recentTrends.map(r => {
    try { return JSON.parse(r.payload_json); } catch { return null; }
  }).filter(Boolean);

  context._emittedEvents = trends.map(t => ({
    type: "trend_spotted",
    payload: { title: t.title, score: t.score },
  }));

  return { trends, sources_scanned: 3 };
}
