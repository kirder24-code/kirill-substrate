/**
 * scripts/cortex/algorithm.mjs
 *
 * Port of PAI Algorithm v6.3 (the 7-phase task discipline).
 * Wraps any non-trivial action in OBSERVE → THINK → PLAN → BUILD → EXECUTE →
 * VERIFY → LEARN with explicit phase boundaries, evidence requirements, and
 * tier-gated phase skipping.
 *
 * NOT a continuous brain loop (that's cortex-daemon's job). This is a
 * per-task quality protocol used by orchestrator-loop, cortex-executor, and
 * Tolik when the task is non-trivial.
 *
 * Usage:
 *   import { runAlgorithm } from "./algorithm.mjs";
 *   const result = await runAlgorithm({
 *     task: "draft + send LinkedIn DM to lead 1234",
 *     tier: "project",                       // "quick" | "project" | "comprehensive"
 *     isaPath: ".data/survival-opportunities/opp-au.../ISA.md",
 *     iscId: "ISC-3",                        // optional — bind to a specific ISC
 *     handlers: {
 *       observe: async (ctx) => ({ intent, prereqs, isaSummary }),
 *       think:   async (ctx) => ({ assumptions, premortem, prereqs }),
 *       plan:    async (ctx) => ({ scope, deliverables, capabilities }),
 *       build:   async (ctx) => ({ artifacts }),
 *       execute: async (ctx) => ({ result, evidence }),
 *       verify:  async (ctx) => ({ probes, ok, evidence }),
 *       learn:   async (ctx) => ({ insights, memoryUpdates }),
 *     },
 *   });
 *
 * Tier gating:
 *   quick:         OBSERVE + EXECUTE + VERIFY only            (3 phases)
 *   project:       all 7 except THINK and LEARN can be brief  (light THINK/LEARN)
 *   comprehensive: all 7 phases mandatory + cross-vendor audit
 *
 * Output: { ok, status, phasesRun, evidence, insights, finalState }
 *   - ok=false if any mandatory phase fails verification
 *   - status = "complete" | "blocked" | "incomplete"
 */

import { readFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { checkISA } from "./isa-check.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../..");
const TRACE_PATH = resolve(REPO_ROOT, ".data/algorithm-trace.jsonl");

const PHASES = ["observe", "think", "plan", "build", "execute", "verify", "learn"];
const PHASE_BANNERS = {
  observe: "👁️  OBSERVE",
  think:   "🧠 THINK",
  plan:    "🗺️  PLAN",
  build:   "🔨 BUILD",
  execute: "⚡ EXECUTE",
  verify:  "✓  VERIFY",
  learn:   "📚 LEARN",
};

const TIER_REQUIRED_PHASES = {
  quick:         new Set(["observe", "execute", "verify"]),
  project:       new Set(["observe", "think", "plan", "build", "execute", "verify", "learn"]),
  comprehensive: new Set(["observe", "think", "plan", "build", "execute", "verify", "learn"]),
};

const TIER_MANDATORY_GATES = {
  quick:         new Set(["execute", "verify"]),
  project:       new Set(["execute", "verify"]),
  comprehensive: new Set(["execute", "verify", "learn"]),
};

function logTrace(entry) {
  try {
    mkdirSync(dirname(TRACE_PATH), { recursive: true });
    appendFileSync(TRACE_PATH, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
  } catch {}
}

function defaultHandler(phase) {
  // Default handlers are no-op stubs that return ok-ish empty payloads.
  // Callers override the ones they care about.
  return async (ctx) => {
    return { phase, skipped: true, reason: "no_handler_provided" };
  };
}

export async function runAlgorithm({ task, tier = "project", isaPath = null, iscId = null, handlers = {}, ctx: extraCtx = {} } = {}) {
  if (!task) return { ok: false, status: "blocked", reason: "no_task" };
  if (!TIER_REQUIRED_PHASES[tier]) return { ok: false, status: "blocked", reason: "unknown_tier", tier };

  const runId = `algo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const required = TIER_REQUIRED_PHASES[tier];
  const mandatory = TIER_MANDATORY_GATES[tier];

  // Pre-flight: if isaPath given, verify ISA structure before doing anything
  let isaCheck = null;
  if (isaPath) {
    try {
      isaCheck = await checkISA(isaPath, { strict: false });
      if (isaCheck.status !== "pass") {
        // Soft warning — don't block, but record. The algorithm proceeds
        // assuming caller knows ISA may be incomplete.
        logTrace({ runId, event: "isa_check_warning", isaPath, hard_gaps: isaCheck.hard_gaps, soft_gaps: isaCheck.soft_gaps });
      }
    } catch (e) {
      logTrace({ runId, event: "isa_check_threw", error: e.message });
    }
  }

  const ctx = {
    runId, task, tier, isaPath, iscId, isaCheck,
    history: [],          // accumulated phase outputs
    evidence: [],         // verification artifacts
    insights: [],         // learning capture
    ...extraCtx,
  };

  const phasesRun = [];
  let finalStatus = "complete";

  console.error(`\n━━━ ALGORITHM ${runId} | tier=${tier} | task="${task.slice(0, 80)}" ━━━`);
  if (isaPath) console.error(`    ISA: ${isaPath}${iscId ? ` | ISC: ${iscId}` : ""}`);

  for (let i = 0; i < PHASES.length; i++) {
    const phase = PHASES[i];
    if (!required.has(phase)) {
      logTrace({ runId, phase, event: "skipped_by_tier" });
      continue;
    }

    const handler = handlers[phase] || defaultHandler(phase);
    const banner = PHASE_BANNERS[phase];
    console.error(`━━━ ${banner} ━━━ ${i + 1}/7  (${phase})`);
    logTrace({ runId, phase, event: "start" });

    let phaseResult;
    try {
      phaseResult = await handler(ctx);
    } catch (e) {
      phaseResult = { ok: false, error: e.message, stack: e.stack?.slice(0, 1000) };
    }

    phasesRun.push(phase);
    ctx.history.push({ phase, result: phaseResult });
    if (phaseResult?.evidence) ctx.evidence.push(...(Array.isArray(phaseResult.evidence) ? phaseResult.evidence : [phaseResult.evidence]));
    if (phaseResult?.insights) ctx.insights.push(...(Array.isArray(phaseResult.insights) ? phaseResult.insights : [phaseResult.insights]));

    logTrace({ runId, phase, event: "end", ok: phaseResult?.ok !== false, summary: summarize(phaseResult) });

    // VERIFY is the gate. If this is a mandatory phase and it returned ok:false,
    // the algorithm halts.
    if (mandatory.has(phase) && phaseResult?.ok === false) {
      console.error(`    ✗ ${phase.toUpperCase()} failed: ${phaseResult.reason || phaseResult.error || "no reason given"}`);
      finalStatus = "blocked";
      logTrace({ runId, event: "halt", reason: `${phase}_failed`, detail: phaseResult });
      break;
    }
  }

  // Post-flight: if we ran VERIFY and it succeeded, note evidence count
  const verifyResult = ctx.history.find(h => h.phase === "verify")?.result;
  if (finalStatus === "complete" && (!verifyResult || verifyResult.ok === false)) {
    finalStatus = "incomplete";
  }

  const result = {
    ok: finalStatus === "complete",
    status: finalStatus,
    runId,
    tier,
    task,
    isaPath,
    iscId,
    phasesRun,
    evidence: ctx.evidence,
    insights: ctx.insights,
    isaCheck,
    history: ctx.history,
  };

  console.error(`━━━ END ${runId} | status=${finalStatus} | phases=${phasesRun.length}/7 | evidence=${ctx.evidence.length} ━━━\n`);
  logTrace({ runId, event: "complete", status: finalStatus, phases: phasesRun.length, evidence: ctx.evidence.length });

  return result;
}

function summarize(payload) {
  if (!payload) return null;
  if (typeof payload === "string") return payload.slice(0, 200);
  const keys = Object.keys(payload);
  const out = {};
  for (const k of keys.slice(0, 8)) {
    const v = payload[k];
    if (typeof v === "string") out[k] = v.slice(0, 120);
    else if (typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (Array.isArray(v)) out[k] = `[array len=${v.length}]`;
    else if (typeof v === "object") out[k] = `[object keys=${Object.keys(v || {}).length}]`;
    else out[k] = String(v).slice(0, 120);
  }
  return out;
}

/**
 * Convenience: build a "verify" handler that runs a list of probe functions.
 * Each probe is `async () => { ok, name, evidence }`. ALL must pass.
 *
 *   const verify = makeVerifyHandler([
 *     async () => ({ ok: existsSync('.data/sent.json'), name: 'file_exists' }),
 *     async () => { const r = await fetch(url); return { ok: r.status === 200, name: 'http_200', evidence: r.status }; },
 *   ]);
 */
export function makeVerifyHandler(probes) {
  return async (ctx) => {
    const results = [];
    for (const probe of probes) {
      try {
        const r = await probe(ctx);
        results.push(r);
      } catch (e) {
        results.push({ ok: false, name: probe.name || "anon", error: e.message });
      }
    }
    const allOk = results.every(r => r.ok);
    return { ok: allOk, probes: results, evidence: results.filter(r => r.ok).map(r => ({ name: r.name, evidence: r.evidence })) };
  };
}
