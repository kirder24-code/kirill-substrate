/**
 * ERROR TAXONOMY v1
 *
 * Unified error types for all modules in the system.
 * Every error has: type, severity, retry_policy, and evidence_required.
 */

export class ModuleError extends Error {
  constructor(type, message, details = {}) {
    super(message);
    this.type = type;
    this.severity = details.severity || "medium";
    this.module = details.module || "unknown";
    this.recoverable = details.recoverable !== false;
    this.evidence = details.evidence || null;
    this.timestamp = new Date().toISOString();
  }
}

// ═══ Input/Validation Errors ═══
export class ValidationError extends ModuleError {
  constructor(message, details = {}) {
    super("ValidationError", message, { severity: "high", ...details });
  }
}

export class StaleStateError extends ModuleError {
  constructor(message, details = {}) {
    super("StaleStateError", message, { severity: "medium", ...details });
  }
}

export class ConstraintViolation extends ModuleError {
  constructor(message, details = {}) {
    super("ConstraintViolation", message, { severity: "high", recoverable: false, ...details });
  }
}

// ═══ Data Quality Errors ═══
export class DuplicateEntityError extends ModuleError {
  constructor(message, details = {}) {
    super("DuplicateEntityError", message, { severity: "medium", ...details });
  }
}

export class InvalidURLError extends ModuleError {
  constructor(message, details = {}) {
    super("InvalidURLError", message, { severity: "medium", ...details });
  }
}

export class MarketMismatchError extends ModuleError {
  constructor(message, details = {}) {
    super("MarketMismatchError", message, { severity: "high", ...details });
  }
}

// ═══ Execution Errors ═══
export class EvidenceWriteError extends ModuleError {
  constructor(message, details = {}) {
    super("EvidenceWriteError", message, { severity: "critical", recoverable: false, ...details });
  }
}

export class ExecutionBlocked extends ModuleError {
  constructor(message, details = {}) {
    super("ExecutionBlocked", message, { severity: "high", recoverable: false, ...details });
  }
}

export class OutcomeLinkFailed extends ModuleError {
  constructor(message, details = {}) {
    super("OutcomeLinkFailed", message, { severity: "medium", ...details });
  }
}

// ═══ Reasoning Errors ═══
export class ReasoningInsufficient extends ModuleError {
  constructor(message, details = {}) {
    super("ReasoningInsufficient", message, { severity: "medium", ...details });
  }
}

export class HypothesisConflict extends ModuleError {
  constructor(message, details = {}) {
    super("HypothesisConflict", message, { severity: "low", ...details });
  }
}

// ═══ Error Handling Policy ═══
export const ERROR_POLICIES = {
  ValidationError:      { retry: false, escalate: false, log: true, block: true },
  StaleStateError:      { retry: true,  escalate: false, log: true, block: false },
  ConstraintViolation:  { retry: false, escalate: true,  log: true, block: true },
  DuplicateEntityError: { retry: false, escalate: false, log: true, block: false },
  InvalidURLError:      { retry: false, escalate: false, log: true, block: false },
  MarketMismatchError:  { retry: false, escalate: false, log: true, block: true },
  EvidenceWriteError:   { retry: true,  escalate: true,  log: true, block: true },
  ExecutionBlocked:     { retry: false, escalate: true,  log: true, block: true },
  OutcomeLinkFailed:    { retry: true,  escalate: false, log: true, block: false },
  ReasoningInsufficient:{ retry: false, escalate: false, log: true, block: false },
  HypothesisConflict:   { retry: false, escalate: false, log: true, block: false },
};
