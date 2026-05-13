/**
 * OUTCOME COLLECTOR — Contracted Module
 *
 * Collects real outcomes from all channels:
 * - Email replies (IMAP)
 * - Reddit replies (monitoring)
 * - LinkedIn connection accepts (manual input)
 * - Evidence records without responses
 *
 * Feeds back into: hypothesis resolution, behavior changes, score calibration.
 * This is the module that CLOSES the learning loop.
 */

import { ValidationError, OutcomeLinkFailed } from "../error-types.mjs";

// ═══ CONTRACT ═══
export const CONTRACT = {
  module_name: "outcome-collector",
  version: "1.0.0",
  purpose: "Collect real outcomes from all channels, link to evidence, feed learning loop",
  owner_layer: "truth",

  inputs: {
    schema: { time_window_hours: "number?" },
    required: [],
  },
  outputs: {
    schema: {
      total_evidence: "number",
      with_responses: "number",
      reply_rate: "number",
      platform_rates: "object",
      calibration: "object",
      hypotheses_triggered: "number",
      behavior_changes: "number",
    },
    guaranteed: ["total_evidence", "reply_rate"],
  },

  reads_from: ["execution_evidence", "outreach_emails", "leads", "hypotheses", "behavior_changes"],
  writes_to: ["execution_evidence", "bot_intelligence", "hypotheses", "behavior_changes"],
  depends_on_modules: [],
  downstream_modules: ["hypothesis-generator", "behavior-adapter"],
  emits_events: ["outcomes_collected", "angle_change_needed", "hypothesis_triggered"],
  consumes_events: ["evidence_recorded"],

  preconditions: [],
  postconditions: [
    { check: "output.total_evidence >= 0", severity: "warn" },
  ],

  hooks_before: ["load_current_hypotheses"],
  hooks_after: [
    "check_hypothesis_resolution",
    "check_behavior_triggers",
    "update_world_state",
    "write_run_log",
  ],

  autonomy: {
    level: "automatic",
    risk_class: "low",
    approval_required_from: null,
    escalation_on_failure: "log_and_continue",
  },

  error_types: ["ValidationError", "OutcomeLinkFailed"],
  retry_policy: { max_retries: 1, backoff_ms: 5000 },
  timeout_ms: 30000,
};

// ═══ EXECUTE ═══
export async function execute(db, input, context) {
  const windowHours = input.time_window_hours || 168; // default 7 days
  let hypothesesTriggered = 0;
  let behaviorChangesCount = 0;

  // ═══ A. Collect platform reply rates ═══
  const platforms = db.prepare(`
    SELECT l.source_platform, COUNT(*) as total,
      SUM(CASE WHEN oe.reply_received_at IS NOT NULL THEN 1 ELSE 0 END) as replies
    FROM outreach_emails oe
    LEFT JOIN leads l ON l.id = oe.lead_id
    WHERE oe.sent_at > datetime('now', '-${windowHours} hours')
    GROUP BY l.source_platform
  `).all();

  const platformRates = {};
  for (const p of platforms) {
    platformRates[p.source_platform || "email"] = {
      total: p.total,
      replies: p.replies,
      replyRate: p.total > 0 ? Math.round(p.replies / p.total * 100) : 0,
    };
  }

  // ═══ B. Evidence stats ═══
  const totalEvidence = db.prepare(
    `SELECT COUNT(*) as c FROM execution_evidence WHERE created_at > datetime('now', '-${windowHours} hours')`
  ).get()?.c || 0;

  const withResponses = db.prepare(
    `SELECT COUNT(*) as c FROM execution_evidence WHERE response_received = 1 AND created_at > datetime('now', '-${windowHours} hours')`
  ).get()?.c || 0;

  // ═══ C. Overall reply rate ═══
  const totalSent = db.prepare(
    `SELECT COUNT(*) as c FROM outreach_emails WHERE status = 'sent' AND sent_at > datetime('now', '-${windowHours} hours')`
  ).get()?.c || 0;

  const totalReplied = db.prepare(
    `SELECT COUNT(*) as c FROM outreach_emails WHERE reply_received_at IS NOT NULL AND reply_received_at > datetime('now', '-${windowHours} hours')`
  ).get()?.c || 0;

  const replyRate = totalSent > 0 ? Math.round(totalReplied / totalSent * 100) : 0;

  // ═══ D. Score calibration ═══
  const conversions = db.prepare(`
    SELECT score, stage, source_platform FROM leads
    WHERE stage IN ('contacted', 'replied', 'won') AND score IS NOT NULL
    AND updated_at > datetime('now', '-${windowHours} hours')
  `).all();

  const replied = conversions.filter(c => c.stage === "replied" || c.stage === "won");
  const avgScoreReplied = replied.length > 0 ? Math.round(replied.reduce((s, c) => s + c.score, 0) / replied.length) : 0;
  const avgScoreAll = conversions.length > 0 ? Math.round(conversions.reduce((s, c) => s + c.score, 0) / conversions.length) : 0;

  const calibration = {
    avgScoreReplied,
    avgScoreAll,
    sampleSize: conversions.length,
    repliedCount: replied.length,
  };

  // ═══ E. Save outcomes to bot_intelligence ═══
  const { setIntelligence, createHypothesis, recordBehaviorChange } = await import("../../orchestrator.mjs");

  setIntelligence(db, "orchestrator", "outcomes", "platform_reply_rates", platformRates, 90);
  setIntelligence(db, "orchestrator", "outcomes", "score_calibration", calibration, 85);

  // ═══ F. Check if hypotheses should be auto-generated ═══
  if (totalSent >= 10 && replyRate < 3) {
    const existingActive = db.prepare("SELECT COUNT(*) as c FROM hypotheses WHERE status = 'active'").get()?.c || 0;

    if (existingActive < 3) {
      const newHypotheses = [
        { category: "icp", hypothesis: "Current ICP mismatch — targets don't have the pain we solve", confidence: 40, impactScore: 90, testCostScore: 30, timeToSignal: "48h", cheapestTest: "Interview 3 leads who didn't respond", expectedSignal: "2+ say pain doesn't match" },
        { category: "message", hypothesis: "Opener too generic — not specific enough pain reference", confidence: 60, impactScore: 70, testCostScore: 10, timeToSignal: "24h", cheapestTest: "A/B test: current vs ultra-specific opener", expectedSignal: "Variant B gets 2+ replies" },
        { category: "channel", hypothesis: "Wrong channel for target market", confidence: 50, impactScore: 80, testCostScore: 20, timeToSignal: "48h", cheapestTest: "Try alternative channel (Facebook for PH, Reddit for global)", expectedSignal: "1+ engagement from new channel" },
      ];

      for (const h of newHypotheses) {
        createHypothesis(db, h);
        hypothesesTriggered++;
      }
    }

    // Record angle change needed
    setIntelligence(db, "orchestrator", "outcomes", "angle_change_needed", {
      totalSent, totalReplied, replyRate,
      diagnosis: `${totalSent} sent, ${totalReplied} replies (${replyRate}%). Approach not working.`,
      updatedAt: new Date().toISOString(),
    }, 95);
  }

  // ═══ G. Check for behavior change triggers ═══
  // If a specific platform has 0% after 10+ sends → record behavior change
  for (const [platform, data] of Object.entries(platformRates)) {
    if (data.total >= 5 && data.replyRate === 0) {
      const existingChange = db.prepare(
        "SELECT id FROM behavior_changes WHERE parameter_changed = ? AND created_at > datetime('now', '-7 days')"
      ).get(`${platform}_effectiveness`);

      if (!existingChange) {
        recordBehaviorChange(db, {
          triggerType: "zero_reply_rate",
          changeType: "channel_deprioritize",
          scope: "fast",
          parameterChanged: `${platform}_effectiveness`,
          beforeValue: "active",
          afterValue: "deprioritized",
          reason: `0% reply rate after ${data.total} sends on ${platform}`,
          impactExpected: "Shift effort to channels with proven engagement",
        });
        behaviorChangesCount++;
      }
    }
  }

  context._emittedEvents = [
    { type: "outcomes_collected", payload: { replyRate, totalSent, totalReplied, platforms: Object.keys(platformRates).length } },
  ];

  return {
    total_evidence: totalEvidence,
    with_responses: withResponses,
    reply_rate: replyRate,
    platform_rates: platformRates,
    calibration,
    hypotheses_triggered: hypothesesTriggered,
    behavior_changes: behaviorChangesCount,
  };
}
