/**
 * dispatch-guardrails.mjs
 *
 * Stops the system from scaling unproven outreach paths.
 * Reads real performance data from DB, computes segment states,
 * persists to dispatch_guardrails table.
 *
 * Called by:
 *   - calgary-email-outreach.mjs before sending
 *   - icp-outreach-bot.mjs before dispatching
 *   - heartbeat as data source
 *
 * Rules:
 *   A: sends >= 10 AND meaningful = 0 → paused_unproven (block)
 *   B: sends 5-9 AND meaningful = 0 → warning_unproven (max 2/day)
 *   C: meaningful > 0 AND best rate → currently_strongest (prioritize)
 *
 * Usage:
 *   import { refreshGuardrails, isSegmentBlocked, getSegmentState } from "./dispatch-guardrails.mjs";
 *   refreshGuardrails(db);              // recalc all segments
 *   isSegmentBlocked(db, "template", "v5-quote-followup");  // true/false
 *   getSegmentState(db, "vertical", "HVAC contractor");     // { state, sends, meaningful_replies }
 */
import { randomUUID } from "crypto";

const OVERRIDE_ENV = "GUARDRAIL_OVERRIDE"; // set to "1" to bypass

/**
 * Refresh all guardrail states from outreach_emails truth.
 */
export function refreshGuardrails(db) {
  const now = new Date().toISOString();

  // Collect segments: template, vertical, channel, city
  const segments = [];

  // By template_version
  const templates = db.prepare(`
    SELECT template_version as key, COUNT(*) as sent,
      SUM(CASE WHEN is_meaningful_reply=1 THEN 1 ELSE 0 END) as meaningful
    FROM outreach_emails WHERE status IN ('sent','replied','bounced') AND template_version IS NOT NULL
    GROUP BY template_version
  `).all();
  for (const t of templates) segments.push({ type: "template", key: t.key, sent: t.sent, meaningful: t.meaningful });

  // By vertical (business_category)
  const verticals = db.prepare(`
    SELECT business_category as key, COUNT(*) as sent,
      SUM(CASE WHEN is_meaningful_reply=1 THEN 1 ELSE 0 END) as meaningful
    FROM outreach_emails WHERE status IN ('sent','replied','bounced') AND business_category IS NOT NULL
    GROUP BY business_category
  `).all();
  for (const v of verticals) segments.push({ type: "vertical", key: v.key, sent: v.sent, meaningful: v.meaningful });

  // By channel (cold_email is default, reddit/linkedin from lead_interactions)
  segments.push({
    type: "channel", key: "cold_email",
    sent: db.prepare(`SELECT COUNT(*) as n FROM outreach_emails WHERE status IN ('sent','replied','bounced')`).get().n || 0,
    meaningful: db.prepare(`SELECT COUNT(*) as n FROM outreach_emails WHERE is_meaningful_reply=1`).get().n || 0,
  });

  try {
    const redditSent = db.prepare(`SELECT COUNT(*) as n FROM lead_interactions WHERE channel LIKE 'reddit%' AND direction='outbound'`).get().n || 0;
    const redditMeaningful = db.prepare(`SELECT COUNT(*) as n FROM lead_interactions WHERE channel LIKE 'reddit%' AND outcome='replied'`).get().n || 0;
    if (redditSent > 0) segments.push({ type: "channel", key: "reddit", sent: redditSent, meaningful: redditMeaningful });
  } catch {}

  // Apply rules and upsert
  const upsert = db.prepare(`
    INSERT INTO dispatch_guardrails (id, segment_type, segment_key, sends, meaningful_replies, state, reason, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(segment_type, segment_key) DO UPDATE SET
      sends=excluded.sends, meaningful_replies=excluded.meaningful_replies,
      state=excluded.state, reason=excluded.reason, updated_at=excluded.updated_at
  `);

  let bestRate = -1;
  let bestSegment = null;

  for (const s of segments) {
    let state, reason;
    const rate = s.sent > 0 ? s.meaningful / s.sent : 0;

    if (s.sent >= 30 && s.meaningful === 0) {
      state = "paused_unproven";
      reason = `${s.sent} sends, 0 meaningful replies - paused`;
    } else if (s.sent >= 15 && s.meaningful === 0) {
      state = "warning_unproven";
      reason = `${s.sent} sends, 0 meaningful - warning (max 2/day)`;
    } else if (s.meaningful > 0 && rate > bestRate) {
      bestRate = rate;
      bestSegment = s;
      state = "active";
      reason = `${s.meaningful} meaningful from ${s.sent} (${(rate*100).toFixed(1)}%)`;
    } else {
      state = "active";
      reason = `${s.sent} sends, ${s.meaningful} meaningful`;
    }

    upsert.run(
      `${s.type}:${s.key}`, s.type, s.key,
      s.sent, s.meaningful, state, reason, now
    );
  }

  // Mark strongest
  if (bestSegment) {
    db.prepare(`UPDATE dispatch_guardrails SET state='currently_strongest' WHERE segment_type=? AND segment_key=?`)
      .run(bestSegment.type, bestSegment.key);
  }

  return segments.length;
}

/**
 * Check if a segment is blocked from dispatch.
 * Returns { blocked: boolean, state: string, reason: string }
 */
export function isSegmentBlocked(db, segmentType, segmentKey) {
  if (process.env[OVERRIDE_ENV] === "1") {
    return { blocked: false, state: "override", reason: "GUARDRAIL_OVERRIDE=1" };
  }

  const row = db.prepare(`SELECT state, reason, sends FROM dispatch_guardrails WHERE segment_type=? AND segment_key=?`)
    .get(segmentType, segmentKey);

  if (!row) return { blocked: false, state: "unknown", reason: "no data yet" };

  if (row.state === "paused_unproven") {
    return { blocked: true, state: row.state, reason: row.reason };
  }

  if (row.state === "warning_unproven") {
    // Allow max 2 per day for warning segments
    const todaySent = db.prepare(`
      SELECT COUNT(*) as n FROM outreach_emails
      WHERE date(sent_at)=date('now') AND (business_category=? OR template_version=?)
    `).get(segmentKey, segmentKey)?.n || 0;

    if (todaySent >= 2) {
      return { blocked: true, state: row.state, reason: `warning segment, daily limit 2 reached (${todaySent})` };
    }
    return { blocked: false, state: row.state, reason: `warning but under daily limit (${todaySent}/2)` };
  }

  return { blocked: false, state: row.state, reason: row.reason };
}

/**
 * Get segment state for display/logging.
 */
export function getSegmentState(db, segmentType, segmentKey) {
  return db.prepare(`SELECT * FROM dispatch_guardrails WHERE segment_type=? AND segment_key=?`)
    .get(segmentType, segmentKey) || null;
}
