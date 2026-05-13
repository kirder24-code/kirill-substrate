/**
 * cortex/epistemic-driver.mjs - GWT Layer 2 Step 4 (2026-05-09)
 *
 * THE FIRST PROXY FOR "WANTING TO KNOW" in the AGI pyramid.
 *
 * What it does:
 *   - Subscribes to prediction_error_high (emitted by blind-spots aggregator)
 *   - Maps each blind spot to an investigation spotlight proposal
 *   - Submits to attention.proposeSpotlight with urgency derived from avgError
 *   - Modules in the GWT bus that subscribe to spotlight_winner can react
 *     (e.g. curiosity module would deepResearch the topic)
 *
 * Why this matters for AGI:
 *   - Layer 1: substrate (events flow)
 *   - Layer 2 Step 1-3: system can predict, measure error, identify blind spots
 *   - Layer 2 Step 4 (THIS): system AUTOMATICALLY ACTS to reduce uncertainty
 *   - This is the substrate for "epistemic curiosity" - system biases attention
 *     toward things it doesn't understand, without being told to
 *   - Combined with Layer 4 (affect), this becomes "frustration when stuck" + "satisfaction when learned"
 *   - Without this step, blind-spots map sits unused
 *
 * Honest limit: the urgency mapping is simple linear (avgError * 10 + 1, capped 1-10).
 * Future Layer 3+ might bias by recency, salience to current goal, etc.
 */

import { proposeSpotlight } from "./attention.mjs";

// Track which domains we've already proposed for, to avoid re-proposing every cycle
const _proposedRecently = new Map(); // domain -> timestamp
const REPROPOSE_COOLDOWN_MS = 60 * 60_000; // 1 hour: don't re-propose same blind spot for 1h

function _urgencyFromError(avgError) {
  // Map avgError [0.4 (threshold) ... 1.0] to urgency [4 ... 10]
  // Below threshold (0.4) shouldn't trigger this (filter happens upstream),
  // but defensive clamp anyway.
  const clamped = Math.max(0.4, Math.min(1.0, avgError));
  // Linear: 0.4 -> 4, 1.0 -> 10
  return Math.round(4 + (clamped - 0.4) * 10);
}

/**
 * Required GWT-module export.
 */
export function register(bus) {
  bus.subscribe("prediction_error_high", (entry) => {
    const data = entry?.data || {};
    if (!data.domain) return;
    // Cooldown: if this domain was proposed within last hour, skip
    const last = _proposedRecently.get(data.domain) || 0;
    if (Date.now() - last < REPROPOSE_COOLDOWN_MS) return;
    _proposedRecently.set(data.domain, Date.now());

    const urgency = _urgencyFromError(data.avgError);
    const topic = `investigate blind spot: ${data.domain}`;
    const evidence = `predictions wrong ${(data.avgError * 100).toFixed(0)}% of time over ${data.sampleCount} samples - model needs new data on this domain`;
    const result = proposeSpotlight(topic, urgency, evidence, "epistemic-driver");

    // Notify the bus that we actively decided to investigate
    if (result.accepted) {
      bus.broadcast({
        source: "epistemic-driver",
        type: "investigation_proposed",
        data: {
          domain: data.domain,
          topic,
          urgency,
          avgError: data.avgError,
          sampleCount: data.sampleCount,
          queueDepth: result.queueDepth,
        },
      });
    }
  });
}

/**
 * Test helpers
 */
export function _resetState() {
  _proposedRecently.clear();
}

export function getProposedDomains() {
  return [..._proposedRecently.entries()].map(([domain, ts]) => ({
    domain,
    proposedAt: new Date(ts).toISOString(),
  }));
}
