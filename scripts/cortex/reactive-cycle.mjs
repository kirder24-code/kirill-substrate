/**
 * cortex/reactive-cycle.mjs - GWT Layer 1 Step 4 (2026-05-09)
 *
 * Helper that gives cortex-daemon a way to run a "reactive segment" inside its
 * existing perceive-think-act loop without rewriting the whole daemon.
 *
 * What it does:
 *   - Emits a `cycle_start` event with the current daemon context summary
 *   - Listens for events emitted DURING a configurable window (default 2 sec)
 *   - Returns the trail of all events that fired in response
 *   - This trail can be embedded in the daemon's LLM prompt as "what the system
 *     reactively concluded" - giving the LLM a real broadcast cascade as input
 *     rather than just a static snapshot of module states.
 *
 * Why minimal:
 *   - cortex-daemon.mjs is 2000+ lines, refactoring whole loop is high risk.
 *   - This helper is a single function the daemon can opt into per cycle.
 *   - If reactive trail is empty (no GWT modules wired yet), daemon falls back
 *     to existing static context. Zero behavior change for unwired modules.
 *
 * Usage from daemon:
 *   const { runReactiveCycle } = await import("./reactive-cycle.mjs");
 *   const trail = await runReactiveCycle({ context: ctxSummary, durationMs: 2000 });
 *   // trail is an array of {at, source, type, data} events that fired in window
 *   const reactiveContext = formatTrailForPrompt(trail);
 */

import * as bus from "./state-bus.mjs";

/**
 * Run a reactive cycle: emit cycle_start, capture events for durationMs, return trail.
 *
 * @param {object} opts
 * @param {object} opts.context - daemon's current context (will be passed in cycle_start data)
 * @param {number} opts.durationMs - how long to listen (default 2000)
 * @param {number} opts.maxEvents - cap on captured events (default 50, prevents memory blow)
 * @returns {Promise<Array>} array of captured event entries newest-last
 */
export async function runReactiveCycle({ context = {}, durationMs = 2000, maxEvents = 50 } = {}) {
  const trail = [];
  let capturing = true;

  // Wildcard subscriber captures every event broadcast during the window.
  // We do NOT capture cycle_start itself (avoid trivial echo); skip it explicitly.
  const off = bus.subscribe("*", (entry) => {
    if (!capturing) return;
    if (entry?.type === "cycle_start") return;
    if (trail.length >= maxEvents) return;
    trail.push(entry);
  });

  try {
    // Trigger initial event - this is the "spark" that lets reactive modules engage
    bus.broadcast({
      source: "cortex",
      type: "cycle_start",
      data: {
        startedAt: new Date().toISOString(),
        contextSummary: typeof context === "string" ? context.slice(0, 500) : JSON.stringify(context).slice(0, 500),
      },
    });

    // Wait for cascade to play out
    await new Promise(r => setTimeout(r, durationMs));
  } finally {
    capturing = false;
    off(); // unsubscribe wildcard handler
  }

  return trail;
}

/**
 * Format a captured trail as a human-readable string for the LLM prompt.
 * Compact form: one line per event with timestamp + source + type + key data.
 */
export function formatTrailForPrompt(trail) {
  if (!Array.isArray(trail) || trail.length === 0) {
    return "(no reactive events captured this cycle - GWT modules silent)";
  }
  const lines = trail.map(e => {
    const ts = e.at ? e.at.slice(11, 19) : "?";
    const data = e.data || {};
    const keys = Object.keys(data).slice(0, 4);
    const summary = keys.map(k => `${k}=${String(data[k]).slice(0, 60)}`).join(" ");
    const depth = e._meta?.depth ?? 0;
    return `[${ts}] [d${depth}] ${e.source}/${e.type}: ${summary}`;
  });
  return lines.join("\n");
}

/**
 * Quick stats about a trail for observability.
 */
export function summarizeTrail(trail) {
  const byType = {};
  const bySource = {};
  let maxDepth = 0;
  for (const e of trail) {
    byType[e.type] = (byType[e.type] || 0) + 1;
    bySource[e.source] = (bySource[e.source] || 0) + 1;
    const d = e._meta?.depth ?? 0;
    if (d > maxDepth) maxDepth = d;
  }
  return { totalEvents: trail.length, byType, bySource, maxDepth };
}
