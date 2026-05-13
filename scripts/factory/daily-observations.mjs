/**
 * daily-observations.mjs
 *
 * Write-only daily observer. Reads DB metrics, writes plain-language observations
 * + top 3 hypotheses. NO actions. NO production behavior change.
 *
 * Output:
 *   - .logs/observations.jsonl (append-only structured)
 *   - .data/observations/<date>.md (human-readable for sentinel and review)
 *
 * Hypotheses are DRAFTS only. Kirill / Claude in chat decide what to act on.
 *
 * Run: node scripts/factory/daily-observations.mjs
 * Cron: daily 8:00 AM Calgary (before sentinel at 9:30, after orchestrator stabilizes overnight)
 */

import Database from "better-sqlite3";
import { writeFileSync, appendFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readPurpose, getWikiContext, appendLog } from "../../wiki/reader.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");
const DB_PATH = resolve(PROJECT_ROOT, ".data/linkedin-brand-os.sqlite");
const JSONL_LOG = resolve(PROJECT_ROOT, ".logs/observations.jsonl");
const MD_DIR = resolve(PROJECT_ROOT, ".data/observations");
// Use Calgary local date so daily reports align with Kirill's day, not UTC
const TODAY = new Date().toLocaleDateString("en-CA", { timeZone: "America/Edmonton" });
const MD_PATH = resolve(MD_DIR, `${TODAY}.md`);

if (!existsSync(MD_DIR)) mkdirSync(MD_DIR, { recursive: true });
if (!existsSync(dirname(JSONL_LOG))) mkdirSync(dirname(JSONL_LOG), { recursive: true });

const db = new Database(DB_PATH, { readonly: true });

// ─── Section 1: Outreach metrics (cumulative + 24h delta) ───────────────────

// IMPORTANT: cold email metrics must exclude rows that are not actual cold email
// (Reddit threads are sometimes inserted into outreach_emails table for tracking,
// they should not be counted as cold-email sends or cold-email replies).
// Also: filter customer-support / help-desk auto-acknowledge patterns that the
// simple "AUTO" / "out of office" filter misses.
const NOT_COLD_EMAIL_CATEGORIES = "'reddit','linkedin','linkedin_united_states','linkedin_global','linkedin_ph'";
const totals = db.prepare(`
  SELECT
    COUNT(*) AS total_sent,
    SUM(CASE WHEN reply_received_at IS NOT NULL THEN 1 ELSE 0 END) AS any_reply,
    SUM(CASE WHEN status='bounced' THEN 1 ELSE 0 END) AS bounced,
    SUM(CASE WHEN reply_body LIKE '%AUTO%' OR reply_body LIKE '%out of office%' OR reply_body LIKE '%customer support%' OR reply_body LIKE '%Thank you for reaching out%' OR reply_body LIKE '%help desk%' THEN 1 ELSE 0 END) AS autoreplies,
    SUM(CASE WHEN reply_body IS NOT NULL
              AND reply_body NOT LIKE '%AUTO%'
              AND reply_body NOT LIKE '%out of office%'
              AND reply_body NOT LIKE '%unsubscribe%'
              AND reply_body NOT LIKE '%remove me%'
              AND reply_body NOT LIKE '%delivery has failed%'
              AND reply_body NOT LIKE '%mailer-daemon%'
              AND reply_body NOT LIKE '%customer support%'
              AND reply_body NOT LIKE '%Thank you for reaching out%'
              AND reply_body NOT LIKE '%help desk%'
              AND reply_body NOT LIKE '%support team%'
         THEN 1 ELSE 0 END) AS meaningful_replies
  FROM outreach_emails
  WHERE status IN ('sent','replied','bounced')
    AND business_category NOT IN (${NOT_COLD_EMAIL_CATEGORIES})
`).get();

const last24h = db.prepare(`
  SELECT
    COUNT(*) AS sent_24h,
    SUM(CASE WHEN reply_received_at IS NOT NULL THEN 1 ELSE 0 END) AS any_reply_24h
  FROM outreach_emails
  WHERE status IN ('sent','replied','bounced')
    AND date(sent_at) >= date('now','-1 day','localtime')
`).get();

// ─── Section 2: A/B v3 vs v4 (if any v4 exists yet) ─────────────────────────

const ab = db.prepare(`
  SELECT COALESCE(template_version,'v3') AS arm, COUNT(*) AS sent,
    SUM(CASE WHEN reply_received_at IS NOT NULL
              AND reply_body NOT LIKE '%AUTO%'
              AND reply_body NOT LIKE '%out of office%'
              AND reply_body NOT LIKE '%unsubscribe%'
         THEN 1 ELSE 0 END) AS meaningful
  FROM outreach_emails
  WHERE status IN ('sent','replied')
    AND business_category IN ('plumbers','hvac','landscaping')
  GROUP BY arm
`).all();

// ─── Section 3: Channel comparison (Reddit vs cold email) ───────────────────

const reddit = db.prepare(`
  SELECT COUNT(*) AS contacted,
    SUM(CASE WHEN stage='replied' THEN 1 ELSE 0 END) AS replied
  FROM leads
  WHERE source_platform LIKE 'reddit%'
    AND stage IN ('contacted','replied')
`).get();

// ─── Section 4: Pipeline health ─────────────────────────────────────────────

const pipeline = db.prepare(`
  SELECT
    SUM(CASE WHEN stage='new' THEN 1 ELSE 0 END) AS new_leads,
    SUM(CASE WHEN stage='contacted' THEN 1 ELSE 0 END) AS contacted,
    SUM(CASE WHEN stage='replied' THEN 1 ELSE 0 END) AS replied,
    SUM(CASE WHEN stage='skipped' THEN 1 ELSE 0 END) AS skipped
  FROM leads
`).get();

// ─── Section 5: Awareness queue ─────────────────────────────────────────────

let awareness = { new_items: 0, apply_now: 0, applied: 0 };
try {
  const row = db.prepare(`
    SELECT
      SUM(CASE WHEN status='new' THEN 1 ELSE 0 END) AS new_items,
      SUM(CASE WHEN status='apply_now' THEN 1 ELSE 0 END) AS apply_now,
      SUM(CASE WHEN status='applied' THEN 1 ELSE 0 END) AS applied
    FROM awareness_items
  `).get();
  if (row) awareness = { new_items: row.new_items || 0, apply_now: row.apply_now || 0, applied: row.applied || 0 };
} catch {}

// ─── Section 6: Bot heartbeats (any unhealthy?) ─────────────────────────────

let unhealthy = [];
try {
  unhealthy = db.prepare(`
    SELECT bot_id, health_status, last_heartbeat
    FROM bot_heartbeats
    WHERE health_status IN ('error','degraded')
  `).all();
} catch {}

// ─── Hypothesis generation (heuristic, plain language) ──────────────────────

const hypotheses = [];

// Hypothesis A: 0 meaningful from cold email
if (totals.total_sent >= 50 && totals.meaningful_replies === 0) {
  hypotheses.push({
    rank: hypotheses.length + 1,
    title: "Cold email producing zero meaningful replies",
    observation: `${totals.total_sent} sent, ${totals.meaningful_replies} meaningful, ${totals.bounced} bounced`,
    candidates: [
      "Channel mismatch (cold email is wrong venue for service-business owners)",
      "Offer fit weakness (right people, wrong hook)",
      "List quality (we are emailing the wrong people)",
      "Deliverability already ruled out (Block 5 confirmed Inbox April 6)"
    ],
    confidence: "high",
    next_test: "Compare meaningful reply rate per channel over next 7 days; if Reddit >>cold, accept channel mismatch"
  });
}

// Hypothesis B: Reddit signal is strong vs cold
const redditRate = reddit.contacted > 0 ? (reddit.replied / reddit.contacted) : null;
const coldRate = totals.total_sent > 0 ? (totals.meaningful_replies / totals.total_sent) : null;
if (redditRate !== null && coldRate !== null && redditRate > 0.1 && coldRate < 0.02) {
  hypotheses.push({
    rank: hypotheses.length + 1,
    title: "Reddit channel is structurally stronger than cold email",
    observation: `Reddit reply rate ${(redditRate*100).toFixed(0)}% on ${reddit.contacted} contacts vs cold email ${(coldRate*100).toFixed(1)}% on ${totals.total_sent} sent`,
    candidates: [
      "Reddit warms via context, cold email starts cold by definition",
      "Owner pain expressed publicly = pre-qualified intent",
      "Cold email recipient has no prior signal of openness"
    ],
    confidence: "medium",
    next_test: "Hold for 2 more weeks, accumulate 20+ Reddit contacts to reduce noise. Then propose channel rebalance."
  });
}

// Hypothesis C: A/B v3 vs v4 split present?
const v3 = ab.find(r => r.arm === "v3");
const v4 = ab.find(r => r.arm === "v4-icp");
if (v3 && v4 && v3.sent + v4.sent >= 10) {
  const v3rate = v3.sent > 0 ? v3.meaningful / v3.sent : 0;
  const v4rate = v4.sent > 0 ? v4.meaningful / v4.sent : 0;
  hypotheses.push({
    rank: hypotheses.length + 1,
    title: `v3 vs v4 A/B early signal (${v3.sent + v4.sent} total in priority 3)`,
    observation: `v3: ${v3.sent} sent ${v3.meaningful} meaningful (${(v3rate*100).toFixed(1)}%); v4: ${v4.sent} sent ${v4.meaningful} meaningful (${(v4rate*100).toFixed(1)}%)`,
    candidates: [
      v4rate > v3rate ? "v4 leading, premature to declare" : "v3 holding or v4 not yet differentiated",
      "Too early at <30 sends per arm"
    ],
    confidence: "low",
    next_test: "Need 30+ sends per arm per category before any decision (ab-report.mjs win condition)"
  });
}

// Hypothesis D: Awareness queue has unprocessed apply_now items
if (awareness.apply_now > 0) {
  hypotheses.push({
    rank: hypotheses.length + 1,
    title: `${awareness.apply_now} awareness items marked apply_now but not processed`,
    observation: `These items have a research report pending. The new auto-research trigger should pick them up within 1 hour.`,
    candidates: ["Auto-research cron not yet fired", "Items just flagged today"],
    confidence: "high",
    next_test: "Check .logs/awareness-research-auto.log within 1 hour"
  });
}

// Hypothesis E: Bot health
if (unhealthy.length > 0) {
  hypotheses.push({
    rank: hypotheses.length + 1,
    title: `${unhealthy.length} bot(s) unhealthy`,
    observation: unhealthy.map(b => `${b.bot_id}=${b.health_status}`).join(", "),
    candidates: ["Process died", "Last heartbeat stale", "Cron entry broken"],
    confidence: "high",
    next_test: "Investigate logs of each unhealthy bot"
  });
}

// Sort by confidence (high → medium → low)
const confOrder = { high: 0, medium: 1, low: 2 };
hypotheses.sort((a,b) => confOrder[a.confidence] - confOrder[b.confidence]);
const topHypotheses = hypotheses.slice(0, 3);

// ─── Build markdown report ──────────────────────────────────────────────────

let md = `# Daily Observations - ${TODAY}\n\n`;
md += `**Type:** write-only observation. No actions taken. Hypotheses are drafts for review.\n\n`;

md += `## Outreach metrics\n`;
md += `- Total sent (all-time): **${totals.total_sent}**\n`;
md += `- Any reply: ${totals.any_reply} (${totals.total_sent > 0 ? ((totals.any_reply/totals.total_sent)*100).toFixed(1) : 0}%)\n`;
md += `- Meaningful: **${totals.meaningful_replies}** ${totals.total_sent > 0 ? `(${((totals.meaningful_replies/totals.total_sent)*100).toFixed(1)}%)` : ""}\n`;
md += `- Bounced: ${totals.bounced} (${totals.total_sent > 0 ? ((totals.bounced/totals.total_sent)*100).toFixed(1) : 0}%)\n`;
md += `- Auto-replies: ${totals.autoreplies}\n`;
md += `- Last 24h sent: ${last24h.sent_24h}, any-reply: ${last24h.any_reply_24h}\n\n`;

md += `## v3 vs v4 A/B (priority 3 categories)\n`;
if (ab.length === 0) {
  md += `_No data yet. Plumbers/HVAC/landscaping have not been processed by send-outreach since v4 activation._\n\n`;
} else {
  for (const arm of ab) {
    const rate = arm.sent > 0 ? (arm.meaningful/arm.sent*100).toFixed(1) : "0.0";
    md += `- **${arm.arm}**: ${arm.sent} sent, ${arm.meaningful} meaningful (${rate}%)\n`;
  }
  md += `\n`;
}

md += `## Channel comparison\n`;
md += `- Reddit: ${reddit.contacted} contacted, ${reddit.replied} replied${redditRate !== null ? ` (${(redditRate*100).toFixed(0)}%)` : ""}\n`;
md += `- Cold email: ${totals.total_sent} sent, ${totals.meaningful_replies} meaningful${coldRate !== null ? ` (${(coldRate*100).toFixed(1)}%)` : ""}\n\n`;

md += `## Pipeline\n`;
md += `- new: ${pipeline.new_leads}, contacted: ${pipeline.contacted}, replied: ${pipeline.replied}, skipped: ${pipeline.skipped}\n\n`;

md += `## Awareness queue\n`;
md += `- new: ${awareness.new_items}, apply_now: ${awareness.apply_now}, applied: ${awareness.applied}\n\n`;

if (unhealthy.length > 0) {
  md += `## ⚠️ Unhealthy bots\n`;
  for (const b of unhealthy) md += `- **${b.bot_id}**: ${b.health_status} (last: ${b.last_heartbeat})\n`;
  md += `\n`;
}

md += `## Top hypotheses (drafts only, no action)\n`;
if (topHypotheses.length === 0) {
  md += `_No notable patterns. System running clean._\n\n`;
} else {
  for (const h of topHypotheses) {
    md += `### ${h.rank}. ${h.title}\n`;
    md += `**Observation:** ${h.observation}\n\n`;
    md += `**Candidates:**\n`;
    for (const c of h.candidates) md += `- ${c}\n`;
    md += `\n**Confidence:** ${h.confidence}\n`;
    md += `**Next test:** ${h.next_test}\n\n`;
  }
}

md += `---\n_Generated by daily-observations.mjs at ${new Date().toISOString()}_\n`;

writeFileSync(MD_PATH, md);

// JSONL append for time-series analysis
const jsonlEntry = {
  date: TODAY,
  ts: new Date().toISOString(),
  totals,
  last24h,
  ab,
  reddit,
  pipeline,
  awareness,
  unhealthy_count: unhealthy.length,
  hypothesis_count: hypotheses.length,
  top_hypotheses: topHypotheses.map(h => h.title),
};
appendFileSync(JSONL_LOG, JSON.stringify(jsonlEntry) + "\n");

db.close();

console.log(`[observations] ${TODAY} → ${MD_PATH}`);
console.log(`[observations] ${hypotheses.length} hypotheses generated, top 3 in report`);
console.log(`[observations] JSONL: ${JSONL_LOG}`);
