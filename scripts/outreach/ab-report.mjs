/**
 * v3 vs v4 A/B reporting for outreach templates.
 *
 * Reads outreach_emails, groups by template_version + business_category,
 * computes meaningful reply rate per arm, applies the win metric:
 *   v4 wins if meaningful_reply_rate(v4) >= 2x v3, AND in >= 2 of 3 categories.
 *
 * Meaningful reply = reply_received_at IS NOT NULL AND reply_body NOT auto-reply,
 * NOT unsubscribe, NOT bounce, NOT "remove me".
 *
 * Run: node scripts/outreach/ab-report.mjs
 *      node scripts/outreach/ab-report.mjs --since 2026-04-07   (only sends after this date)
 */

import Database from "better-sqlite3";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, "../../.data/linkedin-brand-os.sqlite");

const PRIORITY_CATS = ["plumbers", "hvac", "landscaping"];

const sinceArg = process.argv.indexOf("--since");
const since = sinceArg >= 0 ? process.argv[sinceArg + 1] : null;

const db = new Database(DB_PATH, { readonly: true });

const sinceClause = since ? `AND date(sent_at) >= date('${since}')` : "";

// Per category x arm: total sent, meaningful replies, bounce/spam signals
const rows = db.prepare(`
  SELECT
    business_category AS cat,
    COALESCE(template_version, 'v3') AS arm,
    COUNT(*) AS sent,
    SUM(CASE WHEN reply_received_at IS NOT NULL
              AND IFNULL(reply_body, '') NOT LIKE '%AUTO-REPLY%'
              AND IFNULL(reply_body, '') NOT LIKE '%auto reply%'
              AND IFNULL(reply_body, '') NOT LIKE '%out of office%'
              AND IFNULL(reply_body, '') NOT LIKE '%unsubscribe%'
              AND IFNULL(reply_body, '') NOT LIKE '%remove me%'
              AND IFNULL(reply_body, '') NOT LIKE '%REMOVE FROM%'
              AND IFNULL(reply_body, '') NOT LIKE '%delivery has failed%'
              AND IFNULL(reply_body, '') NOT LIKE '%mailer-daemon%'
         THEN 1 ELSE 0 END) AS meaningful_replies,
    SUM(CASE WHEN status = 'bounced' THEN 1 ELSE 0 END) AS bounced
  FROM outreach_emails
  WHERE status IN ('sent', 'replied', 'bounced')
  ${sinceClause}
  GROUP BY business_category, arm
  ORDER BY business_category, arm
`).all();

console.log("\n═══════════════════════════════════════════════════════════════════");
console.log("v3 vs v4 OUTREACH A/B REPORT");
if (since) console.log(`Filter: sends since ${since}`);
console.log("═══════════════════════════════════════════════════════════════════\n");

// Build per-category v3/v4 maps
const byCategory = {};
for (const r of rows) {
  if (!byCategory[r.cat]) byCategory[r.cat] = {};
  byCategory[r.cat][r.arm] = r;
}

// Print priority categories first with side-by-side comparison
console.log("PRIORITY 3 CATEGORIES (v4 A/B active):\n");
const winSignals = [];
for (const cat of PRIORITY_CATS) {
  const v3 = byCategory[cat]?.v3 || { sent: 0, meaningful_replies: 0, bounced: 0 };
  const v4 = byCategory[cat]?.["v4-icp"] || { sent: 0, meaningful_replies: 0, bounced: 0 };
  const v3_rate = v3.sent > 0 ? (v3.meaningful_replies / v3.sent) : 0;
  const v4_rate = v4.sent > 0 ? (v4.meaningful_replies / v4.sent) : 0;
  const v3_bounce = v3.sent > 0 ? (v3.bounced / v3.sent) : 0;
  const v4_bounce = v4.sent > 0 ? (v4.bounced / v4.sent) : 0;

  console.log(`  ${cat}`);
  console.log(`    v3: ${v3.sent} sent, ${v3.meaningful_replies} meaningful (${(v3_rate*100).toFixed(1)}%), ${v3.bounced} bounce`);
  console.log(`    v4: ${v4.sent} sent, ${v4.meaningful_replies} meaningful (${(v4_rate*100).toFixed(1)}%), ${v4.bounced} bounce`);

  // Win check (only if both arms have >= 30 sends)
  let signal = "INSUFFICIENT_SAMPLE";
  if (v3.sent >= 30 && v4.sent >= 30) {
    if (v4_rate >= 2 * v3_rate && v4_rate > 0) signal = "v4_WIN";
    else if (v3_rate > v4_rate) signal = "v3_HOLDS";
    else signal = "INCONCLUSIVE";
  }
  // Deliverability stop check
  if ((v4_bounce - v3_bounce) > 0.02 && v4.sent >= 10) signal = "STOP_v4_BOUNCE";

  console.log(`    signal: ${signal}\n`);
  winSignals.push({ cat, signal, v3_rate, v4_rate });
}

// Final verdict on priority 3
const wins = winSignals.filter(s => s.signal === "v4_WIN").length;
const stops = winSignals.filter(s => s.signal === "STOP_v4_BOUNCE").length;
console.log("─────────────────────────────────────────────────────────────────");
if (stops > 0) {
  console.log("VERDICT: HALT v4 - deliverability regression detected");
} else if (wins >= 2) {
  console.log(`VERDICT: v4 WINS - ${wins}/3 priority categories show >= 2x meaningful reply rate`);
  console.log("Action: roll out v4 to remaining 6 categories with the same A/B");
} else if (winSignals.every(s => s.signal === "INSUFFICIENT_SAMPLE")) {
  console.log("VERDICT: not enough data yet (need 30 sends per arm per category)");
} else {
  console.log(`VERDICT: v4 not winning yet - ${wins}/3 priority categories show 2x lift`);
  console.log("Action: continue collecting; if 30+ sends per arm and still not winning, halt");
}
console.log("─────────────────────────────────────────────────────────────────\n");

// All other categories (v3 only, baseline)
console.log("OTHER CATEGORIES (v3 baseline only):\n");
for (const r of rows) {
  if (PRIORITY_CATS.includes(r.cat)) continue;
  if (r.arm !== "v3") continue;
  const rate = r.sent > 0 ? (r.meaningful_replies / r.sent) : 0;
  console.log(`  ${r.cat}: ${r.sent} sent, ${r.meaningful_replies} meaningful (${(rate*100).toFixed(1)}%)`);
}

db.close();
