/**
 * CORTEX STATE BUS - Unified result channel + in-process event emitter
 *
 * All three brains write here. Chat brain reads from here.
 * Rolling append log (max 50 events) for audit + cross-process visibility.
 * In-process EventEmitter for real-time subscription/broadcast (Layer 1 GWT, 2026-05-09).
 *
 * Sources: daemon | hands | chat
 * Types: hands_result | research_result | workflow_result | bot_result | cycle | chat_task
 *        spotlight_proposal | spotlight_winner | broadcast (Layer 1 GWT additions)
 *
 * In-process subscription contract (added 2026-05-09 Layer 1):
 *   subscribe("type_or_*", handler)        - register handler for event type
 *   unsubscribe("type_or_*", handler)      - remove handler
 *   pushEvent("source", "type", data)      - LOG to file + EMIT to subscribers (existing API, now also emits)
 *   broadcast({source, type, data})        - same as pushEvent but takes single object
 *   getSubscribers(type) -> Array          - introspection: who's listening
 *   resetEmitter()                         - test helper, clears all subscribers
 *
 * Wildcard "*" subscribes to ALL events (used by gwt-observer in Step 5).
 *
 * Honest limitation: EventEmitter is per-process. Subscribers in process A do NOT
 * receive events emitted in process B. They share only the file log. Cortex-daemon
 * runs all GWT modules in-process via imports, so in-process bus is the primary
 * channel. Cross-process readers (e.g. telegram-control, supervisor) still poll the
 * file via recentEvents() as before.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { EventEmitter } from "events";
import { AsyncLocalStorage } from "async_hooks";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const BUS_PATH = resolve(ROOT, ".data/cortex-state-bus.json");
const MAX_EVENTS = 50;
const DEFAULT_GROUNDING_TTL_MS = 10 * 60_000;

// Causality depth limit (Step 2 GWT, 2026-05-09).
// If a subscriber emits an event that triggers another subscriber that emits another
// event ... after MAX_DEPTH hops we refuse to emit. Prevents cascading infinite loops.
// 5 hops covers any sane cognitive cascade; pathological loops abort safely.
const MAX_CASCADE_DEPTH = 5;

// In-process event emitter. Singleton per process. Layer 1 GWT (2026-05-09).
const _emitter = new EventEmitter();
_emitter.setMaxListeners(64); // each cortex module + observer can subscribe; 64 is plenty.

// AsyncLocalStorage tracks the current event-cascade depth across async boundaries.
// When a subscriber runs and itself calls pushEvent/broadcast, the new event inherits
// depth = current_depth + 1. Cross-cycle outside any subscriber: depth = 0.
const _depthStore = new AsyncLocalStorage();

function _currentDepth() {
  const ctx = _depthStore.getStore();
  return ctx?.depth ?? 0;
}

// Internal map: original handler -> wrapped handler. Needed so unsubscribe(type, originalFn)
// removes the wrapped version we actually registered.
const _wrappedMap = new WeakMap();

function _wrapWithIsolation(handler, type) {
  // Per-subscriber error boundary + depth-aware async context.
  // - Error: a thrown handler MUST NOT block other subscribers.
  //   EventEmitter.emit() is synchronous and aborts on first throw - isolation prevents that.
  // - Depth: handler runs inside _depthStore context with depth incremented.
  //   If this handler calls pushEvent, the new event sees depth+1 and can be aborted.
  return function _isolated(entry) {
    const inheritedDepth = (entry && entry._meta && typeof entry._meta.depth === "number") ? entry._meta.depth : 0;
    const newDepth = inheritedDepth + 1;
    _depthStore.run({ depth: newDepth, parentType: type }, () => {
      try {
        handler(entry);
      } catch (e) {
        process.stderr.write(`[state-bus] subscriber for type="${type}" threw: ${e?.message || e}\n`);
      }
    });
  };
}

/**
 * Subscribe to events of a given type. Wildcard "*" subscribes to all events.
 * Each subscriber runs in its own try/catch - one failing subscriber does NOT block others.
 * @param {string} type - event type or "*" for all
 * @param {function} handler - called with the event entry {at, source, type, data}
 * @returns {function} unsubscribe function (call to remove this handler)
 */
export function subscribe(type, handler) {
  if (typeof handler !== "function") throw new Error("subscribe handler must be a function");
  const wrapped = _wrapWithIsolation(handler, type);
  _wrappedMap.set(handler, wrapped);
  _emitter.on(type, wrapped);
  return () => _emitter.off(type, wrapped);
}

/**
 * Remove a previously-registered handler. Pass the SAME function reference passed to subscribe().
 */
export function unsubscribe(type, handler) {
  const wrapped = _wrappedMap.get(handler);
  if (wrapped) {
    _emitter.off(type, wrapped);
    _wrappedMap.delete(handler);
  } else {
    // fallback: try removing original (in case it was registered without subscribe wrapper)
    _emitter.off(type, handler);
  }
}

/**
 * Get the count of subscribers for a given event type. Introspection helper.
 * Counts both type-specific and wildcard "*" subscribers (since they fire too).
 */
export function getSubscribers(type) {
  return _emitter.listenerCount(type) + _emitter.listenerCount("*");
}

/**
 * Test/reset helper - clears all subscribers. Used by smoke tests.
 */
export function resetEmitter() {
  _emitter.removeAllListeners();
}

/**
 * Push an event to the state bus.
 * Writes to file log AND emits to in-process subscribers.
 * @param {string} source - "daemon" | "hands" | "chat"
 * @param {string} type - "hands_result" | "research_result" | "workflow_result" | "bot_result" | "chat_task"
 * @param {object} data - event payload (will be truncated for safety)
 */
export function pushEvent(source, type, data = {}) {
  // Step 2 GWT: causality depth check.
  // If we're already inside a subscriber chain at MAX_CASCADE_DEPTH, refuse to emit.
  // This prevents A->B->A->B->... infinite loops at the substrate level.
  // The file log is also skipped on aborted emits to avoid bus pollution.
  const depth = _currentDepth();
  if (depth >= MAX_CASCADE_DEPTH) {
    process.stderr.write(
      `[state-bus] cascade depth ${depth} reached MAX_CASCADE_DEPTH (${MAX_CASCADE_DEPTH}), aborting emit type="${type}" source="${source}"\n`
    );
    return { aborted: true, depth };
  }

  let events = [];
  try {
    if (existsSync(BUS_PATH)) {
      events = JSON.parse(readFileSync(BUS_PATH, "utf-8"));
      if (!Array.isArray(events)) events = [];
    }
  } catch {}

  const at = new Date().toISOString();
  const normalizedData = normalizeGrounding(data, { at, source, type });
  const entry = {
    at,
    source,
    type,
    data: sanitize(normalizedData),
    _meta: { depth },
  };

  events.push(entry);
  if (events.length > MAX_EVENTS) events = events.slice(-MAX_EVENTS);

  try {
    writeFileSync(BUS_PATH, JSON.stringify(events, null, 2));
  } catch {}

  // In-process broadcast (Layer 1 GWT). Wrap in try so a faulty subscriber
  // never breaks the producer. Subscribers are async-safe; emit is sync but
  // handlers can return promises - we don't await them, fire-and-forget.
  try {
    _emitter.emit(type, entry);
    _emitter.emit("*", entry); // wildcard subscribers (gwt-observer)
  } catch (e) {
    // log to stderr but never throw - producer must not be affected by subscriber bugs
    process.stderr.write(`[state-bus] emit error for type=${type}: ${e?.message || e}\n`);
  }
  return { aborted: false, depth };
}

/**
 * Broadcast - convenience wrapper for pushEvent that takes a single event object.
 * Encouraged form for new GWT code; pushEvent kept for backward compatibility.
 */
export function broadcast(event) {
  if (!event || !event.source || !event.type) {
    throw new Error("broadcast requires {source, type, data?}");
  }
  pushEvent(event.source, event.type, event.data || {});
}

function normalizeGrounding(data, event) {
  const input = data && typeof data === "object" ? data : {};
  const observedAt = isValidIsoish(input.observed_at) ? input.observed_at : event.at;
  const expiresAt = isValidIsoish(input.expires_at)
    ? input.expires_at
    : new Date(new Date(observedAt).getTime() + DEFAULT_GROUNDING_TTL_MS).toISOString();
  const provenanceChain = Array.isArray(input.provenance_chain)
    ? input.provenance_chain
    : inferProvenanceChain(input, event);
  const confidenceBasis = typeof input.confidence_basis === "string"
    ? input.confidence_basis
    : inferConfidenceBasis(input, event, provenanceChain);
  const groundingStatus = typeof input.grounding_status === "string"
    ? input.grounding_status
    : inferGroundingStatus(input, event, provenanceChain, confidenceBasis, observedAt, expiresAt);

  return {
    ...input,
    observed_at: observedAt,
    expires_at: expiresAt,
    provenance_chain: provenanceChain,
    confidence_basis: confidenceBasis,
    grounding_status: groundingStatus,
  };
}

function isValidIsoish(value) {
  return typeof value === "string" && Number.isFinite(new Date(value).getTime());
}

function inferProvenanceChain(data, event) {
  const chain = [];
  if (data.observation_id) chain.push({ kind: "observation", id: data.observation_id });
  if (data.prediction_id) chain.push({ kind: "prediction", id: data.prediction_id });
  if (data.action_id) chain.push({ kind: "action", id: data.action_id });
  if (data.outcome_id) chain.push({ kind: "outcome", id: data.outcome_id });
  if (chain.length === 0 && /(_result|_completed|prediction_resolved|outcome)/.test(event.type)) {
    chain.push({ kind: "event", source: event.source, type: event.type, at: event.at });
  }
  return chain;
}

function inferConfidenceBasis(data, event, provenanceChain) {
  if (provenanceChain.length === 0) return "none";
  if (data.outcome_id || /(_result|_completed|prediction_resolved|outcome)/.test(event.type)) return "observed_outcome";
  if (data.observation_id) return "fresh_observation";
  return "event_provenance";
}

function inferGroundingStatus(data, event, provenanceChain, confidenceBasis, observedAt, expiresAt) {
  if (data.grounding_status) return data.grounding_status;
  if (confidenceBasis === "none" || provenanceChain.length === 0) return "ungrounded";
  const observedTime = new Date(observedAt || event.at).getTime();
  const expiresTime = new Date(expiresAt || event.at).getTime();
  if (Number.isFinite(expiresTime) && expiresTime < Date.now()) return "stale";
  if (!Number.isFinite(observedTime)) return "unknown";
  return "grounded";
}

/**
 * Read recent events from the state bus.
 * @param {number} n - how many recent events to return (default 20)
 * @returns {Array} events newest-last
 */
export function recentEvents(n = 20) {
  try {
    if (!existsSync(BUS_PATH)) return [];
    const events = JSON.parse(readFileSync(BUS_PATH, "utf-8"));
    if (!Array.isArray(events)) return [];
    return events.slice(-n);
  } catch {
    return [];
  }
}

/**
 * Format recent events as a human-readable string for LLM context.
 * @param {number} n - how many recent events
 * @returns {string}
 */
export function formatStateBusForLLM(n = 15) {
  const events = recentEvents(n);
  if (events.length === 0) return "No recent daemon/hands activity recorded.";

  const lines = events.map(e => {
    const ts = e.at ? e.at.slice(11, 19) : "?";
    const d = e.data || {};
    switch (e.type) {
      case "hands_result":
        return `[${ts}] HANDS ${d.success ? "OK" : "FAIL"}: ${d.task || "?"} | files: ${(d.filesChanged || []).join(", ") || "none"}${d.error ? " | ERR: " + d.error : ""}`;
      case "research_result":
        return `[${ts}] RESEARCH ${d.success ? "OK" : "FAIL"}: ${d.question || "?"} | evidence: ${d.evidenceCount || 0}${d.opinion ? " | " + d.opinion.slice(0, 100) : ""}`;
      case "workflow_result":
        return `[${ts}] WORKFLOW ${d.success ? "OK" : "FAIL"}: ${d.workflow || "?"} | ${d.summary || ""}`;
      case "bot_result":
        return `[${ts}] BOT ${d.success ? "OK" : "FAIL"}: ${d.bot || "?"}${d.error ? " | ERR: " + d.error : ""}`;
      case "chat_task":
        return `[${ts}] CHAT_TASK ${d.success ? "DONE" : "FAIL"}: ${d.task || "?"} | files: ${(d.filesChanged || []).join(", ") || "none"}${d.error ? " | ERR: " + d.error : ""}`;
      case "cycle":
        return `[${ts}] CYCLE: ${d.decisions || "?"} | focus: ${d.focus || "?"}`;
      case "outgoing_trigger":
        return `[${ts}] OUTGOING CALL ${d.sent ? "SENT" : "BLOCKED"}: ${d.reason || "?"} (urgency ${d.urgency || "?"})`;
      default:
        return `[${ts}] ${e.type}: ${JSON.stringify(d).slice(0, 120)}`;
    }
  });

  return lines.join("\n");
}

// Sanitize data to avoid huge payloads in the bus
function sanitize(data) {
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === "string") out[k] = v.slice(0, 500);
    else if (Array.isArray(v)) out[k] = v.slice(0, 20).map(x => typeof x === "string" ? x.slice(0, 200) : x);
    else if (v !== null && typeof v === "object") out[k] = sanitize(v);
    else out[k] = v;
  }
  return out;
}
