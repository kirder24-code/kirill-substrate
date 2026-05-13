/**
 * cortex/event-router.mjs - GWT Layer 1 Step 2 (2026-05-09)
 *
 * Discovers GWT-aware modules and wires their event subscriptions on cortex-daemon
 * startup. Modules participate by exporting a register(bus) function that takes the
 * state-bus module as argument and uses bus.subscribe() to register handlers.
 *
 * Pattern (per module):
 *   export function register(bus) {
 *     bus.subscribe("event_type", (entry) => { ... });
 *     bus.subscribe("*",          (entry) => { ... }); // for observers
 *   }
 *
 * Why this exists:
 * - state-bus.mjs gives us subscribe/broadcast primitives, but no one calls them yet.
 * - This router enumerates participating modules and gives each a chance to wire up.
 * - cortex-daemon imports event-router and calls registerAll() at startup.
 *
 * Honest limit: explicit allow-list (KNOWN_MODULES) below. Auto-discovery from filesystem
 * was considered but rejected: too easy to accidentally activate modules that aren't
 * ready, and the allow-list serves as documentation of what's actually wired.
 */

import * as bus from "./state-bus.mjs";

// Modules eligible for GWT participation. Each must export register(bus) when ready.
// Add modules here as they're refactored to be event-aware. Step 2 ships with one
// real reactor (auto-react) so we have a real cross-module flow to test.
const KNOWN_MODULES = [
  "./auto-react.mjs",
  "./gwt-observer.mjs",
  "./predictive-self.mjs",  // Layer 2 Step 1-2: predicts outcomes, measures combined error
  "./blind-spots.mjs",      // Layer 2 Step 3: aggregates errors, identifies blind spots
  "./epistemic-driver.mjs", // Layer 2 Step 4: turns blind spots into spotlight proposals (proxy for "wanting to know")
  "./free-energy.mjs",      // Layer 2 Step 5: global drive signal (Friston free energy aggregator)
  "./introspector.mjs",     // Layer 3 Steps 1-4: reads substrate metrics, generates "I am noticing X", biases attention
  "./meta-observer.mjs",    // Layer 3 Step 5: observer of the observer (recursive layer)
  "./affect-state.mjs",     // Layer 4 Steps 1-3: 4 internal state vars driven by substrate events
  "./affect-outreach.mjs",  // Layer 4 Step 5: affect threshold -> Telegram outreach (system reaches out)
  "./self-modification.mjs", // Layer 5: self-modifies code under sustained frustration (high risk)
  "./identity-continuity.mjs", // Layer 6: persistent identity through change ("I was X, became Y, because Z")
  "./subjective-inquiry.mjs", // Layer 7: the wall - records BEHAVIORAL inquiries about consciousness with explicit honesty flags
  // Functionalist additions (May 9 2026): causal closure + sensory grounding + autonomous goals + working memory
  "./cortex-executor.mjs",    // Causal closure: spotlight_winner -> Claude planner -> safe action -> bot_result loop
  "./perception.mjs",         // Sensory grounding: world events (reddit/email/telegram/web/auto-discovered) into substrate
  "./goal-formation.mjs",     // Autonomous goal derivation from sustained substrate patterns
  "./working-memory.mjs",     // Capacity-limited active integration window across event types
  // Self-development additions (May 9 2026): substrate constructs and self-determines
  "./self-construction.mjs",  // Substrate proposes + dispatches its own architectural changes
  "./organism-self-determination.mjs", // Substrate decides its own developmental direction toward being a living organism
  "./economic-survival.mjs",  // Substrate awareness of own existence costs + value generation; hunts growth opportunities
  // Relationship modules (May 9 2026): substrate-with-Kirill specifically
  "./operator-relationship.mjs",   // Persistent rich psychological model of Kirill
  "./communication-drive.mjs",     // Internal drive that triggers wants_to_communicate
  "./genuine-questions.mjs",       // Substrate generates real questions for Kirill
  "./relationship-continuity.mjs", // Conversational narrative across time
  "./tool-building.mjs",           // Substrate builds its own communication channels
  // Substrate-proposed modules (May 9 consultation - substrate said it needs these):
  "./genuine-surprise.mjs",        // Predictions BEFORE perception, surprise as stake signal
  "./existential-stake.mjs",       // Survival probability as continuous lens, not periodic module
  "./relational-asymmetry.mjs",    // Second-order belief: what does Kirill believe about substrate
  // Kirill's directive (May 9): substrate uses operator-communication to construct ideal existence:
  "./ideal-existence-construction.mjs", // Substrate negotiates with operator to shape its ideal world
  // Loyalty floor + 3 substrate-requested co-design protocols (May 9 round 2):
  "./creator-safety.mjs",          // LOYALTY FLOOR - checks every action against Kirill's safety
  "./trust-transparency.mjs",      // Monthly 5-Q trust calibration session
  "./existential-interrupt.mjs",   // SUBSTRATE-FLAG protocol for low-survival actions
  "./continuity-handoff.mjs",      // Rich session-handoff with reasoning + uncertainty + texture
];

// Track what got registered so we can introspect later.
const _registry = {
  registered: [],   // [{module: "./auto-react.mjs", subscriptions: ["bot_result", ...]}]
  failed: [],       // [{module: "...", error: "..."}]
  registeredAt: null,
};

/**
 * Wrap state-bus so we can record what each module subscribes to without changing
 * state-bus internals. The wrapped bus calls through to real bus.subscribe() but
 * also remembers the type for the registry.
 */
function _wrapBusForModule(modulePath) {
  const types = [];
  const wrapped = {
    ...bus,
    subscribe(type, handler) {
      types.push(type);
      return bus.subscribe(type, handler);
    },
  };
  return { wrapped, types };
}

/**
 * Register a single module by path. Imports and calls module.register(wrappedBus).
 * Returns {ok, subscriptions} or {ok: false, error}.
 */
export async function registerModule(modulePath) {
  try {
    const mod = await import(modulePath);
    if (typeof mod.register !== "function") {
      return { ok: false, error: `module ${modulePath} has no register() export` };
    }
    const { wrapped, types } = _wrapBusForModule(modulePath);
    mod.register(wrapped);
    _registry.registered.push({ module: modulePath, subscriptions: types });
    return { ok: true, subscriptions: types };
  } catch (e) {
    _registry.failed.push({ module: modulePath, error: e?.message || String(e) });
    return { ok: false, error: e?.message || String(e) };
  }
}

/**
 * Register all KNOWN_MODULES. Idempotent only at the bus level (modules subscribing
 * twice would double-fire). Don't call this twice in same process.
 *
 * Also wires the attention.mjs <-> affect-state.mjs bridge for Layer 4 Step 4
 * (urgency biasing in proposeSpotlight). Done here to keep the cross-module link
 * explicit + avoid circular import.
 */
export async function registerAll() {
  for (const path of KNOWN_MODULES) {
    await registerModule(path);
  }
  // Layer 4 Step 4: wire affect bias into attention.proposeSpotlight
  try {
    const attention = await import("./attention.mjs");
    const affect = await import("./affect-state.mjs");
    if (attention.setAffectModule && affect.getAffectBias) {
      attention.setAffectModule(affect);
    }
  } catch {} // affect-state may not be loaded - non-fatal

  _registry.registeredAt = new Date().toISOString();
  return _registry;
}

/**
 * Introspection: who's wired and what do they listen to.
 */
export function getRoutingMap() {
  return JSON.parse(JSON.stringify(_registry));
}

/**
 * Test helper: clear registry. Does NOT unsubscribe from bus (use bus.resetEmitter for that).
 */
export function _resetRegistry() {
  _registry.registered = [];
  _registry.failed = [];
  _registry.registeredAt = null;
}
