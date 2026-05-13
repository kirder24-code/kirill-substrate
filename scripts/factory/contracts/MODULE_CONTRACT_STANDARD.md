# Module Contract Standard v1

Every module in the system must declare this contract before it can be registered and executed by the pipeline runner.

## Contract Shape

```javascript
{
  // Identity
  module_name: "qualification-engine",
  version: "1.0.0",
  purpose: "Convert raw signals into scored, qualified opportunities",
  owner_layer: "reasoning",  // truth | compiled_state | reasoning | adaptation

  // Input/Output
  inputs: {
    schema: { signals: "Signal[]", world_state: "WorldState" },
    required: ["signals"],
  },
  outputs: {
    schema: { opportunities: "Opportunity[]", rejected: "Signal[]" },
    guaranteed: ["opportunities"],
  },

  // Dependencies
  reads_from: ["leads", "opportunities", "constraints", "bot_intelligence"],
  writes_to: ["opportunities"],
  depends_on_modules: ["world-state-compiler"],
  downstream_modules: ["decision-engine"],
  emits_events: ["opportunity_qualified", "signal_rejected"],
  consumes_events: ["signal_found", "lead_found"],

  // Preconditions (machine-checkable)
  preconditions: [
    { check: "world_state.freshness_score >= 0.8", severity: "block" },
    { check: "constraints.loaded == true", severity: "block" },
    { check: "input.signals.length > 0", severity: "skip" },
  ],

  // Postconditions (machine-checkable)
  postconditions: [
    { check: "output.opportunities.length >= 0", severity: "warn" },
    { check: "evidence_written == true", severity: "block" },
    { check: "dedup_verified == true", severity: "block" },
  ],

  // Hooks
  hooks_before: [
    "validate_input_schema",
    "check_preconditions",
    "load_constraints",
    "check_duplicates",
    "load_active_hypotheses",
  ],
  hooks_after: [
    "validate_output_schema",
    "check_postconditions",
    "write_evidence",
    "update_world_state",
    "emit_events",
    "write_run_log",
  ],

  // Autonomy Policy
  autonomy: {
    level: "automatic",         // automatic | human_gate | manual
    risk_class: "low",          // low | medium | high | critical
    approval_required_from: null,
    evidence_threshold: null,    // min evidence records before auto-execute
    escalation_on_failure: "log_and_continue",  // log_and_continue | halt | notify_human
  },

  // Error handling
  error_types: ["ValidationError", "StaleStateError", "DuplicateEntityError"],
  retry_policy: { max_retries: 1, backoff_ms: 5000 },
  timeout_ms: 60000,
}
```

## Rules

1. No module runs without a registered contract
2. Pipeline runner checks preconditions BEFORE execution — block or skip
3. Pipeline runner checks postconditions AFTER execution — warn or block
4. All hooks run in declared order
5. Every run writes to module_run_log
6. Contract changes require version bump
7. Input/output schemas must be backwards compatible or version bumped
