/**
 * DECISION ENGINE — Contracted Module
 *
 * Decides: promote / queue / merge / defer / reject
 * Second module in the decision spine.
 */

import { decisionEngine as runDecision, getWorldState, getPortfolio, CONSTRAINTS } from "../../orchestrator.mjs";
import { ValidationError, ConstraintViolation } from "../error-types.mjs";

// ═══ CONTRACT ═══
export const CONTRACT = {
  module_name: "decision-engine",
  version: "1.0.0",
  purpose: "Decide promote/queue/merge/defer/reject for qualified opportunities",
  owner_layer: "reasoning",

  inputs: {
    schema: { opportunity_id: "string" },
    required: ["opportunity_id"],
  },
  outputs: {
    schema: { decision: "string", reason: "string", alternatives: "string[]" },
    guaranteed: ["decision", "reason"],
  },

  reads_from: ["opportunities", "projects", "constraints", "hypotheses"],
  writes_to: ["opportunities"],
  depends_on_modules: ["qualification-engine"],
  downstream_modules: ["project-creator"],
  emits_events: ["decision_made"],
  consumes_events: ["opportunity_qualified"],

  preconditions: [
    { check: "input.opportunity_id", severity: "block" },
    { check: "context.world_state.portfolio", severity: "block" },
  ],
  postconditions: [
    { check: "output.decision", severity: "block" },
    { check: "output.reason", severity: "block" },
  ],

  hooks_before: [
    "validate_input_schema",
    "load_portfolio",
    "load_constraints",
    "load_active_hypotheses",
  ],
  hooks_after: [
    "write_evidence",
    "write_justification",
    "emit_events",
    "write_run_log",
  ],

  autonomy: {
    level: "automatic",
    risk_class: "medium",
    approval_required_from: null,
    escalation_on_failure: "notify_human",
    note: "Decision itself is automatic, but 'promote' requires human_gate at project-creator level",
  },

  error_types: ["ValidationError", "ConstraintViolation"],
  retry_policy: { max_retries: 0, backoff_ms: 0 },
  timeout_ms: 15000,
};

// ═══ EXECUTE ═══
export async function execute(db, input, context) {
  const { opportunity_id } = input;

  if (!opportunity_id) {
    throw new ValidationError("No opportunity_id provided", { module: CONTRACT.module_name });
  }

  const result = await runDecision(db, opportunity_id);

  if (!result) {
    throw new ValidationError("Decision engine returned null", { module: CONTRACT.module_name });
  }

  context._emittedEvents = [{
    type: "decision_made",
    payload: {
      opportunity_id,
      decision: result.decision,
      reason: result.reason,
    },
  }];

  return {
    decision: result.decision,
    reason: result.reason,
    opportunity: result.opportunity,
  };
}
