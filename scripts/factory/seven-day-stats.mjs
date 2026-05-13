/**
 * seven-day-stats.mjs
 *
 * Last 7 days: contacts found, emails sent, replies received.
 * Run: node scripts/factory/seven-day-stats.mjs
 */
import Database from "better-sqlite3";
import { resolve, dirname } from "path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");

function openDb(path) {
  if (!existsSync(path)) return null;
  try { return new Database(path, { readonly: true }); } catch { return null; }
}

function q1(db, sql) {
  try { return db.prepare(sql).get() || {}; } catch { return {}; }
}
function qAll(db, sql) {
  try { return db.prepare(sql).all(); } catch { return []; }
}

const MAIN_DB  = resolve(ROOT, ".data/linkedin-brand-os.sqlite");
const OUTREACH_DB = resolve(ROOT, ".data/outreach.db");

const db = openDb(MAIN_DB);
const odb = openDb(OUTREACH_DB);

console.log("\n=== LAST 7 DAYS STATS ===\n");

// ── 1. CONTACTS FOUND ────────────────────────────────────────────
let contactsFound = 0;
if (db) {
  // leads created in last 7 days
  const fromLeads = q1(db, `
    SELECT COUNT(*) AS n FROM leads
    WHERE created_at >= datetime('now', '-7 days')
  `).n || 0;

  // outreach_emails created in last 7 days (scout records each discovered lead)
  const fromEmails = q1(db, `
    SELECT COUNT(*) AS n FROM outreach_emails
    WHERE created_at >= datetime('now', '-7 days')
  `).n || 0;

  contactsFound = Math.max(fromLeads, fromEmails);

  // If both tables exist and are different sources, sum them
  if (fromLeads > 0 && fromEmails > 0) {
    contactsFound = fromLeads; // leads is the canonical source
    console.log(`Contacts found (leads table, 7d):       ${fromLeads}`);
    console.log(`  (outreach_emails discovered, 7d):     ${fromEmails}`);
  } else {
    console.log(`Contacts found (7d):                    ${contactsFound}`);
  }
} else {
  console.log("Contacts found: DB not accessible");
}

// ── 2. EMAILS SENT ───────────────────────────────────────────────
let emailsSent = 0;
if (db) {
  const fromMain = q1(db, `
    SELECT COUNT(*) AS n FROM outreach_emails
    WHERE status IN ('sent', 'replied', 'bounced')
      AND sent_at >= datetime('now', '-7 days')
  `).n || 0;
  emailsSent += fromMain;
  console.log(`Emails sent (7d):                       ${fromMain}`);

  // Reddit outbound via lead_interactions
  const fromReddit = q1(db, `
    SELECT COUNT(*) AS n FROM lead_interactions
    WHERE channel LIKE 'reddit%'
      AND direction = 'outbound'
      AND created_at >= datetime('now', '-7 days')
  `).n || 0;
  if (fromReddit > 0) {
    console.log(`  + Reddit outbound (7d):               ${fromReddit}`);
    emailsSent += fromReddit;
  }

  // LinkedIn outbound
  const fromLi = q1(db, `
    SELECT COUNT(*) AS n FROM lead_interactions
    WHERE channel LIKE 'linkedin%'
      AND direction = 'outbound'
      AND created_at >= datetime('now', '-7 days')
  `).n || 0;
  if (fromLi > 0) {
    console.log(`  + LinkedIn outbound (7d):             ${fromLi}`);
    emailsSent += fromLi;
  }
}
if (odb) {
  const fromManual = q1(odb, `
    SELECT COUNT(*) AS n FROM manual_pending_outreach
    WHERE status IN ('sent', 'replied', 'bounced')
      AND sent_at >= datetime('now', '-7 days')
  `).n || 0;
  if (fromManual > 0) {
    console.log(`  + Manual outreach sent (7d):          ${fromManual}`);
    emailsSent += fromManual;
  }
}

// ── 3. REPLIES RECEIVED ──────────────────────────────────────────
let repliesTotal = 0;
let repliesMeaningful = 0;
if (db) {
  const allReplies = q1(db, `
    SELECT COUNT(*) AS n FROM outreach_emails
    WHERE status = 'replied'
      AND updated_at >= datetime('now', '-7 days')
  `).n || 0;

  const meaningful = q1(db, `
    SELECT COUNT(*) AS n FROM outreach_emails
    WHERE status = 'replied'
      AND is_meaningful_reply = 1
      AND updated_at >= datetime('now', '-7 days')
  `).n || 0;

  repliesTotal     = allReplies;
  repliesMeaningful = meaningful;
  console.log(`Replies received (7d):                  ${allReplies}`);
  console.log(`  Meaningful replies (7d):              ${meaningful}`);

  // Reddit replies
  const redditReplied = q1(db, `
    SELECT COUNT(*) AS n FROM lead_interactions
    WHERE channel LIKE 'reddit%'
      AND outcome = 'replied'
      AND created_at >= datetime('now', '-7 days')
  `).n || 0;
  if (redditReplied > 0) {
    console.log(`  + Reddit replies (7d):                ${redditReplied}`);
    repliesTotal += redditReplied;
  }
}

// ── 4. PER-DAY BREAKDOWN ─────────────────────────────────────────
if (db) {
  console.log("\n--- Per-day breakdown (last 7 days) ---");
  const byDay = qAll(db, `
    SELECT
      date(sent_at) AS day,
      COUNT(*) AS sent,
      SUM(CASE WHEN status = 'replied' THEN 1 ELSE 0 END) AS replied,
      SUM(CASE WHEN is_meaningful_reply = 1 THEN 1 ELSE 0 END) AS meaningful
    FROM outreach_emails
    WHERE sent_at >= datetime('now', '-7 days')
      AND status IN ('sent', 'replied', 'bounced')
    GROUP BY date(sent_at)
    ORDER BY day DESC
  `);
  if (byDay.length === 0) {
    console.log("  (no email activity in last 7 days)");
  } else {
    for (const row of byDay) {
      console.log(`  ${row.day}  sent=${row.sent}  replied=${row.replied}  meaningful=${row.meaningful}`);
    }
  }

  const newLeadsByDay = qAll(db, `
    SELECT date(created_at) AS day, COUNT(*) AS n
    FROM leads
    WHERE created_at >= datetime('now', '-7 days')
    GROUP BY date(created_at)
    ORDER BY day DESC
  `);
  if (newLeadsByDay.length > 0) {
    console.log("\n--- Contacts discovered per day ---");
    for (const row of newLeadsByDay) {
      console.log(`  ${row.day}  found=${row.n}`);
    }
  }
}

// ── 5. SUMMARY ───────────────────────────────────────────────────
console.log("\n========= SUMMARY (last 7 days) =========");
console.log(`  Contacts found:      ${db ? (q1(db, "SELECT COUNT(*) AS n FROM leads WHERE created_at >= datetime('now', '-7 days')").n || 0) : "N/A"}`);
console.log(`  Emails/messages sent:${emailsSent}`);
console.log(`  Replies received:    ${repliesTotal}`);
console.log(`  Meaningful replies:  ${repliesMeaningful}`);
console.log("==========================================\n");

if (db) db.close();
if (odb) odb.close();
