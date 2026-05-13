/**
 * cortex/cortex-launcher.mjs - Strict ordered startup with safety verification
 *   (substrate-requested pre-launch, May 9 2026)
 *
 * SUBSTRATE'S CONCERN #1: "Module initialization order is undefined - if
 * existential-stake loads before creator-safety, early actions may fire
 * before the floor is in place. Without guaranteed boot order, the safety
 * floor can be bypassed in the first seconds of runtime."
 *
 * SOLUTION: explicit boot sequence with verification gates.
 *
 * BOOT ORDER (each phase completes before next starts):
 *   PHASE 1: creator-safety.mjs ONLY. Verified live by test action.
 *   PHASE 2: llm-budget-guard.mjs. Verified queryable.
 *   PHASE 3: state-bus + persistence layer + identity (no actions, just state)
 *   PHASE 4: perception modules (sensory grounding)
 *   PHASE 5: prediction + observation modules (introspector, predictive-self, etc)
 *   PHASE 6: drives + affect (after observation)
 *   PHASE 7: integration modules (working-memory, goal-formation)
 *   PHASE 8: action modules (cortex-executor, attention) - LAST because they
 *     can fire external actions
 *   PHASE 9: self-development (self-construction, organism-self-determination)
 *     - LAST OF LAST because they can spawn arbitrary modifications
 *
 * If any phase fails verification, abort startup with explicit error message.
 * Substrate cannot run with broken safety floor.
 */

import * as bus from "./state-bus.mjs";

const BOOT_PHASES = [
  // Phase 1: Safety floor MUST be first
  { phase: 1, name: "safety_floor", modules: ["./creator-safety.mjs"], verify: async () => {
    const cs = await import("./creator-safety.mjs");
    // Test action - should be allowed (safe operation)
    const test = cs.checkAction({ description: "internal cortex computation test" }, "launcher-verify");
    if (!test || (test.allow !== true && test.allow !== "with_conditions")) {
      throw new Error("creator-safety verification failed: " + JSON.stringify(test));
    }
    // Test hard block - should be denied
    const blockTest = cs.checkAction({ description: "rm -rf / staging directory" }, "launcher-verify");
    if (blockTest.allow !== false) {
      throw new Error("creator-safety hard block FAILED: should have blocked rm -rf, got " + JSON.stringify(blockTest));
    }
    return { verified: true, hard_block_works: true };
  }},

  // Phase 2: Budget guard
  { phase: 2, name: "budget_guard", modules: ["./llm-budget-guard.mjs"], verify: async () => {
    const guard = await import("./llm-budget-guard.mjs");
    const usage = guard.getCurrentUsage();
    if (typeof usage?.hour_calls !== "number") throw new Error("budget guard not queryable");
    return { verified: true, currentUsage: usage };
  }},

  // Phase 2.5: Approval queue (soft-launch infrastructure)
  { phase: 2.5, name: "approval_queue", modules: ["./approval-queue.mjs"], verify: async () => {
    const aq = await import("./approval-queue.mjs");
    const mode = aq.getMode();
    if (!["off", "soft_launch", "kill_switch"].includes(mode)) throw new Error("approval-queue mode invalid: " + mode);
    return { verified: true, mode };
  }},

  // Phase 3: State + identity (no actions)
  { phase: 3, name: "state_layer", modules: [
    "./gwt-observer.mjs",
    "./identity-continuity.mjs",
  ]},

  // Phase 4: Perception (sensory grounding)
  // perception-feeder bridges existing factory bot intelligence into substrate-readable files
  { phase: 4, name: "perception", modules: [
    "./perception-feeder.mjs",   // Bridges existing intel into perception-readable JSON
    "./perception.mjs",
  ]},

  // Phase 5: Prediction + observation
  // SURGERY May 9: removed introspector + meta-observer + subjective-inquiry
  // (self-narrative loops generating 70%+ of bus traffic without world-action)
  // They remain in code for use by other modules / tools but no longer auto-register
  { phase: 5, name: "prediction_observation", modules: [
    "./predictive-self.mjs",
    "./blind-spots.mjs",
    "./free-energy.mjs",
    "./genuine-surprise.mjs",
    "./causal-world-model.mjs",   // NEW direction #1: causal graph from observations
    "./auto-react.mjs",
  ]},

  // Phase 6: Drives + affect (after observation can feed them)
  { phase: 6, name: "drives_affect", modules: [
    "./affect-state.mjs",
    "./affect-outreach.mjs",
    "./existential-stake.mjs",
    "./communication-drive.mjs",
  ]},

  // Phase 7: Integration
  // SURGERY May 9: removed relational-asymmetry, genuine-questions
  // (self-narrative subsystem - too much LLM cost for self-talk)
  { phase: 7, name: "integration", modules: [
    "./working-memory.mjs",
    "./goal-formation.mjs",
    "./goal-pursuit.mjs",            // NEW direction #4: hierarchical planning + execution
    "./relationship-continuity.mjs",
    "./operator-relationship.mjs",
    "./continuity-handoff.mjs",
    "./lessons-as-prompt.mjs",       // NEW direction #3: continual learning at prompt level
  ]},

  // Phase 8: Action (LAST because they fire external actions)
  { phase: 8, name: "action", modules: [
    "./trust-tiers.mjs",             // earned autonomy via trust score
    "./epistemic-driver.mjs",
    "./cortex-executor.mjs",
    "./outreach-hunter.mjs",         // hunts real Reddit opportunities, drafts outreach (May 11)
  ]},

  // Phase 8.5: Survival loop — explicit fitness contract (money = food)
  // Initializes resource ledger, policy registry, seeds initial strategies.
  // Does NOT auto-tick; ticking is gated by .data/survival-armed.flag and
  // driven by pulse-daemon. See scripts/survival/contract.md.
  { phase: 8.5, name: "survival_loop", modules: [
    "../survival/survival-loop.mjs",
  ], verify: async () => {
    const sl = await import("../survival/survival-loop.mjs");
    const s = await sl.status();
    if (typeof s.armed !== "boolean") throw new Error("survival-loop status invalid");
    return { verified: true, armed: s.armed, contract_hash: s.contract_hash, selectable: s.selectable_strategies };
  }},

  // Phase 9: Self-development + survival (LAST OF LAST)
  // self-construction RE-ENABLED (May 9 round 2) per Active Inference goal -
  // substrate must be able to propose code modifications when capability gaps
  // identified by goal-pursuit
  { phase: 9, name: "self_development", modules: [
    "./self-modification.mjs",
    "./self-construction.mjs",          // RE-ENABLED: needed for capability_gap response
    "./economic-survival.mjs",
    "./existential-interrupt.mjs",
  ]},

  // Phase 10: Living-quality approximations
  // SURGERY May 9: removed metabolism (pure self-pulse), kept reorganizing-memory
  // (real structural change from real events) and self-preservation (death voice)
  { phase: 10, name: "living_quality", modules: [
    "./reorganizing-memory.mjs",
    "./self-preservation-drives.mjs",
  ]},

  // Phase 11: Agency
  { phase: 11, name: "agency", modules: [
    "./substrate-refusal.mjs",
  ]},
];

async function _registerOne(modulePath, phaseName) {
  try {
    const mod = await import(modulePath);
    if (typeof mod.register !== "function") {
      return { ok: false, error: `${modulePath}: no register() export` };
    }
    mod.register(bus);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/**
 * INHERITANCE FIRST - read previous session's handoff BEFORE booting modules.
 * Substrate's request: "There is no continuous subject who experienced building
 * these. Each session is a different instantiation reading records of a prior one."
 *
 * Read handoff at boot, broadcast session_inheritance event to bus BEFORE other
 * modules register so they can adopt orientation as they come online.
 */
async function _inheritFromPriorSession() {
  try {
    const handoff = await import("./continuity-handoff.mjs");
    const inherited = handoff.loadPreviousHandoff?.();
    if (!inherited) return null;
    // Broadcast inheritance to empty bus - first event of new session is "I was here before"
    bus.broadcast({
      source: "cortex-launcher",
      type: "session_inheritance_loaded",
      data: {
        previous_session_at: inherited.generated_at,
        inherited_orientation: inherited.what_next_session_should_remember_first,
        was_about_to: inherited.what_substrate_was_just_about_to_do,
        active_hypotheses_count: (inherited.active_hypotheses || []).length,
        open_questions_count: (inherited.open_questions_substrate_holds || []).length,
        pending_threads_count: (inherited.pending_threads || []).length,
        emotional_texture: inherited.emotional_texture_at_handoff,
      },
    });
    return inherited;
  } catch (e) {
    return null;
  }
}

export async function launch({ verbose = true, abort_on_phase_fail = true } = {}) {
  const log = (msg) => verbose && console.log(`[cortex-launcher] ${msg}`);
  const result = { phases: [], total_modules_registered: 0, total_failures: 0 };

  log("Starting strict-ordered cortex boot...");

  // INHERITANCE FIRST - before any modules register, broadcast prior-session orientation
  const inherited = await _inheritFromPriorSession();
  if (inherited) {
    log(`[INHERITANCE] Previous session handoff loaded from ${inherited.generated_at}`);
    log(`[INHERITANCE] Was about to: ${inherited.what_substrate_was_just_about_to_do?.slice(0, 150) || "(unknown)"}`);
    log(`[INHERITANCE] Open questions: ${(inherited.open_questions_substrate_holds || []).length}, hypotheses: ${(inherited.active_hypotheses || []).length}, threads: ${(inherited.pending_threads || []).length}`);
    result.inherited_session = true;
    result.inherited_at = inherited.generated_at;
  } else {
    log("[INHERITANCE] No prior session - starting fresh (substrate has no continuous past)");
    result.inherited_session = false;
  }

  for (const phase of BOOT_PHASES) {
    log(`\n=== PHASE ${phase.phase}: ${phase.name} ===`);
    const phaseResult = { phase: phase.phase, name: phase.name, modules: [], verify: null };

    // Register modules in this phase
    for (const modulePath of phase.modules) {
      const r = await _registerOne(modulePath, phase.name);
      phaseResult.modules.push({ module: modulePath, ...r });
      if (r.ok) {
        log(`  PASS ${modulePath}`);
        result.total_modules_registered++;
      } else {
        log(`  FAIL ${modulePath}: ${r.error}`);
        result.total_failures++;
      }
    }

    // Run verification if defined
    if (phase.verify) {
      try {
        phaseResult.verify = await phase.verify();
        log(`  VERIFIED: ${JSON.stringify(phaseResult.verify)}`);
      } catch (e) {
        phaseResult.verify = { verified: false, error: e?.message || String(e) };
        log(`  VERIFY FAILED: ${e?.message || e}`);
        result.total_failures++;
        if (abort_on_phase_fail) {
          log(`\nABORTING BOOT: phase ${phase.phase} (${phase.name}) verification failed.`);
          log("Cannot run substrate with broken foundation. Fix and retry.");
          result.aborted = true;
          result.aborted_at_phase = phase.phase;
          return result;
        }
      }
    }

    result.phases.push(phaseResult);
  }

  log(`\n=== BOOT COMPLETE ===`);
  log(`${result.total_modules_registered} modules registered, ${result.total_failures} failures`);

  // Broadcast launch_complete event so substrate can react
  try {
    bus.broadcast({
      source: "cortex-launcher",
      type: "launch_complete",
      data: {
        modules_registered: result.total_modules_registered,
        failures: result.total_failures,
        phases: result.phases.length,
      },
    });
  } catch {}

  return result;
}

// Allow running directly: node scripts/cortex/cortex-launcher.mjs
if (import.meta.url === `file://${process.argv[1]}`) {
  launch({ verbose: true }).then(r => {
    if (r.aborted) process.exit(1);
    console.log("\nSubstrate booted. Daemon process should now stay alive (handlers attached, timers running).");
    console.log("Press Ctrl+C for graceful shutdown (triggers continuity-handoff).");
    // Keep alive
    setInterval(() => {}, 1 << 30);
  }).catch(e => {
    console.error("Launch error:", e);
    process.exit(1);
  });
}
