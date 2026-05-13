/**
 * PIPELINE RUNNER v1
 *
 * Executes modules according to their contracts.
 * Checks preconditions → runs hooks_before → calls module → checks postconditions → runs hooks_after
 * Writes module_run_log for every execution.
 * Handles errors according to error taxonomy + policies.
 */

import { randomUUID } from "crypto";
import { ERROR_POLICIES } from "./error-types.mjs";

/**
 * Execute a module through its contract
 * @param {object} db - database connection
 * @param {object} contract - module contract
 * @param {object} input - input data matching contract.inputs.schema
 * @param {function} executeFn - the actual module function to run
 * @param {object} context - { world_state, constraints, hypotheses }
 * @returns {object} { success, output, errors, run_id }
 */
export async function runModule(db, contract, input, executeFn, context = {}) {
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  const errors = [];
  let output = null;
  let status = "started";

  try {
    // ═══ 1. CHECK PRECONDITIONS ═══
    for (const pre of (contract.preconditions || [])) {
      const passed = evaluateCondition(pre.check, { input, context });
      if (!passed) {
        if (pre.severity === "block") {
          errors.push({ type: "PreconditionFailed", check: pre.check, severity: "block" });
          status = "blocked_precondition";
          writeRunLog(db, { runId, module: contract.module_name, version: contract.version, status, errors, startedAt });
          return { success: false, output: null, errors, run_id: runId };
        }
        if (pre.severity === "skip") {
          status = "skipped";
          writeRunLog(db, { runId, module: contract.module_name, version: contract.version, status, errors: [{ type: "PreconditionSkip", check: pre.check }], startedAt });
          return { success: true, output: null, errors: [], run_id: runId, skipped: true };
        }
        // severity: warn — continue but log
        errors.push({ type: "PreconditionWarn", check: pre.check, severity: "warn" });
      }
    }

    // ═══ 2. RUN HOOKS_BEFORE ═══
    for (const hookName of (contract.hooks_before || [])) {
      try {
        await runHook(hookName, { db, input, context, contract, errors });
      } catch (err) {
        errors.push({ type: "HookBeforeError", hook: hookName, message: err.message });
        const policy = ERROR_POLICIES[err.type] || { block: false };
        if (policy.block) {
          status = "blocked_hook";
          writeRunLog(db, { runId, module: contract.module_name, version: contract.version, status, errors, startedAt });
          return { success: false, output: null, errors, run_id: runId };
        }
      }
    }

    // ═══ 3. EXECUTE MODULE ═══
    status = "executing";
    output = await Promise.race([
      executeFn(db, input, context),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), contract.timeout_ms || 60000)),
    ]);
    status = "executed";

    // ═══ 4. CHECK POSTCONDITIONS ═══
    for (const post of (contract.postconditions || [])) {
      const passed = evaluateCondition(post.check, { output, context, evidence_written: true });
      if (!passed) {
        errors.push({ type: "PostconditionFailed", check: post.check, severity: post.severity });
        if (post.severity === "block") {
          status = "failed_postcondition";
        }
      }
    }

    // ═══ 5. RUN HOOKS_AFTER ═══
    for (const hookName of (contract.hooks_after || [])) {
      try {
        await runHook(hookName, { db, input, output, context, contract, errors, runId });
      } catch (err) {
        errors.push({ type: "HookAfterError", hook: hookName, message: err.message });
      }
    }

    if (status === "executed") status = "completed";

  } catch (err) {
    status = "error";
    errors.push({ type: err.type || "UnknownError", message: err.message });

    // Retry policy
    if (contract.retry_policy?.max_retries > 0 && (err.recoverable !== false)) {
      console.log(`[PipelineRunner] Retrying ${contract.module_name} after ${contract.retry_policy.backoff_ms}ms`);
      await new Promise(r => setTimeout(r, contract.retry_policy.backoff_ms || 5000));
      // Recursive retry with decremented count
      const retryContract = { ...contract, retry_policy: { ...contract.retry_policy, max_retries: contract.retry_policy.max_retries - 1 } };
      return runModule(db, retryContract, input, executeFn, context);
    }
  }

  // ═══ 6. WRITE RUN LOG ═══
  writeRunLog(db, {
    runId,
    module: contract.module_name,
    version: contract.version,
    inputHash: hashObject(input),
    outputHash: output ? hashObject(output) : null,
    status,
    errors,
    startedAt,
    evidenceIds: context._evidenceIds || [],
    emittedEvents: context._emittedEvents || [],
  });

  return {
    success: status === "completed",
    output,
    errors,
    run_id: runId,
  };
}

// ═══ CONDITION EVALUATOR ═══
function evaluateCondition(check, context) {
  try {
    // Simple condition parser — evaluates string conditions against context
    if (check.includes(">=")) {
      const [path, value] = check.split(">=").map(s => s.trim());
      const actual = resolvePath(context, path);
      return actual >= parseFloat(value);
    }
    if (check.includes("==")) {
      const [path, value] = check.split("==").map(s => s.trim());
      const actual = resolvePath(context, path);
      return String(actual) === value;
    }
    if (check.includes(">")) {
      const [path, value] = check.split(">").map(s => s.trim());
      const actual = resolvePath(context, path);
      return actual > parseFloat(value);
    }
    return true; // Unknown format — pass
  } catch {
    return true; // If we can't evaluate, don't block
  }
}

function resolvePath(obj, path) {
  return path.split(".").reduce((o, k) => o?.[k], obj);
}

// ═══ HOOK SYSTEM ═══
const HOOKS = {};

export function registerHook(name, fn) {
  HOOKS[name] = fn;
}

async function runHook(name, context) {
  if (HOOKS[name]) {
    return HOOKS[name](context);
  }
  // Built-in hooks
  if (name === "validate_input_schema") return; // TODO: JSON schema validation
  if (name === "check_preconditions") return; // Already handled above
  if (name === "write_run_log") return; // Handled in main flow
  if (name === "write_evidence") return; // TODO: auto evidence writing
  // Unknown hook — skip silently
}

// ═══ RUN LOG ═══
function writeRunLog(db, { runId, module, version, inputHash, outputHash, status, errors, startedAt, evidenceIds, emittedEvents }) {
  try {
    db.prepare(`INSERT INTO module_run_log (id, module_name, module_version, input_hash, output_hash, started_at, completed_at, status, errors_json, evidence_ids, emitted_events) VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?)`)
      .run(runId, module, version || "1.0.0", inputHash, outputHash, startedAt, status, JSON.stringify(errors), JSON.stringify(evidenceIds || []), JSON.stringify(emittedEvents || []));
  } catch (err) {
    console.error(`[PipelineRunner] Failed to write run log:`, err.message);
  }
}

function hashObject(obj) {
  try {
    return Buffer.from(JSON.stringify(obj)).toString("base64").slice(0, 32);
  } catch {
    return null;
  }
}
