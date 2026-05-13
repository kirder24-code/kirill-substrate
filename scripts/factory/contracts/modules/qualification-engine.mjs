/**
 * QUALIFICATION ENGINE — Contracted Module
 *
 * Converts raw signals into scored, qualified opportunities.
 * First module in the decision spine.
 */

import { qualifyOpportunity, getWorldState } from "../../orchestrator.mjs";
import { ValidationError, StaleStateError, DuplicateEntityError } from "../error-types.mjs";

// ═══ CONTRACT ═══
export const CONTRACT = {
  module_name: "qualification-engine",
  version: "1.0.0",
  purpose: "Convert raw signals into scored, qualified opportunities",
  owner_layer: "reasoning",

  inputs: {
    schema: { signal: "Signal" },
    required: ["signal"],
  },
  outputs: {
    schema: { opportunity: "Opportunity | null" },
    guaranteed: [],
  },

  reads_from: ["leads", "opportunities", "constraints", "bot_intelligence"],
  writes_to: ["opportunities"],
  depends_on_modules: ["world-state-compiler"],
  downstream_modules: ["decision-engine"],
  emits_events: ["opportunity_qualified", "signal_rejected"],
  consumes_events: ["signal_found", "lead_found", "trend_spotted"],

  preconditions: [
    { check: "input.signal.title", severity: "block" },
    { check: "context.world_state.state_confidence", severity: "warn" },
  ],
  postconditions: [
    { check: "context.evidence_written == true", severity: "warn" },
  ],

  hooks_before: [
    "validate_input_schema",
    "check_duplicates",
  ],
  hooks_after: [
    "write_evidence",
    "emit_events",
    "write_run_log",
  ],

  autonomy: {
    level: "automatic",
    risk_class: "low",
    approval_required_from: null,
    escalation_on_failure: "log_and_continue",
  },

  error_types: ["ValidationError", "StaleStateError", "DuplicateEntityError"],
  retry_policy: { max_retries: 1, backoff_ms: 5000 },
  timeout_ms: 30000,
};

// ═══ EXECUTE ═══
export async function execute(db, input, context) {
  const { signal } = input;

  if (!signal?.title) {
    throw new ValidationError("Signal has no title", { module: CONTRACT.module_name });
  }

  const opportunity = await qualifyOpportunity(db, signal);

  if (opportunity) {
    context._emittedEvents = [{ type: "opportunity_qualified", payload: { id: opportunity.id, title: opportunity.title, score: opportunity.priority_score } }];
  } else {
    context._emittedEvents = [{ type: "signal_rejected", payload: { title: signal.title, reason: "below_threshold" } }];
  }

  return { opportunity };
}
