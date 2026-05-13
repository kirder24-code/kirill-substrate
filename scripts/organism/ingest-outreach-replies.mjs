#!/usr/bin/env node
// organism/ingest-outreach-replies.mjs
// Adapter: pulls outreach_emails (the existing system's main outreach DB) and converts
// AGGREGATED stats into outcomes. The organism learns from per-segment reply rates,
// not from individual emails — sample size IS the signal.
//
// Idempotent: each aggregate window has a deterministic source_ref including the window date.
// Re-running on the same day overwrites the same source_ref bucket via existsRef check.
//
// What it produces (per aggregation period — default 7-day rolling window):
//   - One outcome per (segment, channel) bucket summarizing reply rate, silence rate, bounce rate
//   - One global outcome covering all sends in the window
//
// This compresses 600 emails into ~10-20 rich outcomes.

import Database from "better-sqlite3";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, recordOutcome, totalOutcomes } from "./db.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolve(__dirname, "../..");
const SRC_DB_PATH = resolve(PROJECT, ".data/linkedin-brand-os.sqlite");

function parseFlags(argv) {
  const out = { dryRun: false, windowDays: 7, minSends: 5 };
  for (const a of argv.slice(2)) {
    if (a === "--dry-run") out.dryRun = true;
    else if (a.startsWith("--window=")) out.windowDays = parseInt(a.slice(9), 10) || 7;
    else if (a.startsWith("--min-sends=")) out.minSends = parseInt(a.slice(12), 10) || 5;
  }
  return out;
}

function existsRef(orgDb, source_ref) {
  return !!orgDb.prepare("SELECT id FROM outcomes WHERE source_ref = ? LIMIT 1").get(source_ref);
}

function aggregateWindow(srcDb, windowDays) {
  const since = new Date(Date.now() - windowDays * 86400000).toISOString();
  const rows = srcDb.prepare(`
    SELECT
      LOWER(COALESCE(business_category, 'uncategorized')) AS segment,
      status,
      reply_type,
      reply_sentiment,
      COUNT(*) AS n,
      SUM(CASE WHEN status = 'replied' THEN 1 ELSE 0 END) AS replies,
      SUM(CASE WHEN status = 'bounced' THEN 1 ELSE 0 END) AS bounced,
      SUM(CASE WHEN status IN ('invalid_email','invalid_no_email') THEN 1 ELSE 0 END) AS invalid,
      SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) AS sent_pending,
      SUM(CASE WHEN status = 'campaign_closed_wrong_icp' THEN 1 ELSE 0 END) AS wrong_icp
    FROM outreach_emails
    WHERE COALESCE(sent_at, created_at) >= ?
    GROUP BY segment
  `).all(since);
  return { rows, since };
}

function buildSegmentDescription(seg, stats, windowDays) {
  const total = stats.n;
  const sentReal = stats.replies + stats.bounced + stats.invalid + stats.sent_pending;
  const sentDeliverable = stats.replies + stats.sent_pending;
  const replyRate = sentDeliverable > 0 ? (stats.replies / sentDeliverable * 100).toFixed(2) : "n/a";
  const deliverabilityRate = sentReal > 0 ? ((sentReal - stats.bounced - stats.invalid) / sentReal * 100).toFixed(2) : "n/a";

  return `Cold email ${windowDays}-day aggregate for segment "${seg}": ${total} email rows, ${sentDeliverable} actually delivered, ${stats.replies} replies (rate ${replyRate}%), ${stats.bounced} bounced, ${stats.invalid} invalid addresses, ${stats.sent_pending} pending, ${stats.wrong_icp} closed as wrong-ICP. Deliverability ${deliverabilityRate}%.`;
}

function deriveSignal(stats) {
  const sentDeliverable = stats.replies + stats.sent_pending;
  if (sentDeliverable < 5) return null; // not enough sample
  const replyRate = stats.replies / sentDeliverable;
  if (stats.replies === 0 && stats.sent_pending >= 20) {
    return { signal_type: "silence_aggregate", value: 0.0 };
  }
  if (replyRate >= 0.05) {
    return { signal_type: "reply_aggregate_strong", value: replyRate };
  }
  if (replyRate > 0) {
    return { signal_type: "reply_aggregate_weak", value: replyRate };
  }
  return { signal_type: "silence_aggregate", value: 0.0 };
}

function ingestSegmentBuckets(orgDb, srcDb, flags) {
  const dateLabel = new Date().toISOString().slice(0, 10);
  const { rows } = aggregateWindow(srcDb, flags.windowDays);
  let inserted = 0, skipped = 0;

  for (const stats of rows) {
    const seg = (stats.segment || "uncategorized").replace(/[^a-z0-9_]+/g, "_");
    const sig = deriveSignal(stats);
    if (!sig) { skipped++; continue; }

    const ref = `outreach_aggregate/${dateLabel}/window${flags.windowDays}d/${seg}/${sig.signal_type}`;
    if (existsRef(orgDb, ref)) { skipped++; continue; }

    const desc = buildSegmentDescription(seg, stats, flags.windowDays);

    if (!flags.dryRun) {
      recordOutcome(orgDb, {
        source_type: "outreach_aggregate",
        source_ref: ref,
        signal_type: sig.signal_type,
        signal_value: sig.value,
        description: desc,
        related_action_type: "cold_email",
        related_target: seg,
        observed_at: `${dateLabel} 23:59:00`,
        meta: stats,
      });
    }
    inserted++;
  }

  return { inserted, skipped, segments: rows.length };
}

function ingestRepliesIndividually(orgDb, srcDb, flags) {
  // Replies are rare and high-signal — each one deserves its own outcome with body context.
  const rows = srcDb.prepare(`
    SELECT id, business_name, business_email, business_category, subject, status,
           sent_at, reply_received_at, reply_body, reply_type, reply_sentiment, reply_classification
    FROM outreach_emails
    WHERE status = 'replied' AND reply_body IS NOT NULL
    ORDER BY reply_received_at DESC
  `).all();

  let inserted = 0, skipped = 0;
  for (const row of rows) {
    const ref = `outreach_reply/${row.id}`;
    if (existsRef(orgDb, ref)) { skipped++; continue; }

    const seg = (row.business_category || "uncategorized").toLowerCase().replace(/[^a-z0-9_]+/g, "_");
    const snippet = (row.reply_body || "").slice(0, 300).replace(/\s+/g, " ");
    const desc = `Cold email REPLY (${row.reply_classification || row.reply_type || "unclassified"}, sentiment=${row.reply_sentiment || "unknown"}) from ${row.business_name} [${row.business_category || "uncategorized"}]. Subject: "${row.subject?.slice(0, 80) || ""}". Reply: "${snippet}"`;

    if (!flags.dryRun) {
      recordOutcome(orgDb, {
        source_type: "outreach_reply",
        source_ref: ref,
        signal_type: "reply_individual",
        signal_value: row.reply_sentiment === "positive" ? 1.0 : row.reply_sentiment === "negative" ? -0.5 : 0.5,
        description: desc,
        related_action_type: "cold_email",
        related_target: seg,
        observed_at: row.reply_received_at,
        meta: {
          email_id: row.id,
          domain: (row.business_email || "").split("@")[1],
          reply_type: row.reply_type,
          sentiment: row.reply_sentiment,
        },
      });
    }
    inserted++;
  }

  return { inserted, skipped };
}

function main() {
  const flags = parseFlags(process.argv);
  const srcDb = new Database(SRC_DB_PATH, { readonly: true });
  const orgDb = openDb();
  const before = totalOutcomes(orgDb);

  const tx = orgDb.transaction(() => {
    const agg = ingestSegmentBuckets(orgDb, srcDb, flags);
    console.log(`[outreach-aggregate] segments processed: ${agg.segments}, inserted ${agg.inserted}, skipped ${agg.skipped}`);

    const rep = ingestRepliesIndividually(orgDb, srcDb, flags);
    console.log(`[outreach-replies] individual replies: inserted ${rep.inserted}, skipped ${rep.skipped}`);
  });
  tx();

  const after = totalOutcomes(orgDb);
  console.log(`[outreach] outcomes: ${before} -> ${after} (delta +${after - before})`);

  srcDb.close();
  orgDb.close();
}

main();
