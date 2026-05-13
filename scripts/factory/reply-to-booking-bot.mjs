/**
 * reply-to-booking-bot.mjs
 * Auto follow-up within 6h on any email reply that has not booked a call.
 * Sends directly via SMTP. Caps at 2 follow-ups per lead.
 * Run every 6h via orchestrator-daemon.
 */

import nodemailer from "nodemailer";
import Database from "better-sqlite3";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { env, callAI, MODEL_MINI } from "./orchestrator.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH   = resolve(__dirname, "../../.data/linkedin-brand-os.sqlite");

const SMTP_HOST     = env.OUTREACH_SMTP_HOST  || "mail.privateemail.com";
const SMTP_PORT     = parseInt(env.OUTREACH_SMTP_PORT || "587");
const SMTP_USER     = env.OUTREACH_EMAIL;
const SMTP_PASS     = env.OUTREACH_PASSWORD;
const FROM_NAME     = env.OUTREACH_FROM_NAME  || "Kirill D.";
const CAL_LINK      = env.CAL_LINK            || "https://cal.com/kirill";
const MAX_FOLLOWUPS = 2;

function ensureColumns(db) {
  const cols = db.prepare("PRAGMA table_info(outreach_emails)").all().map(c => c.name);
  if (!cols.includes("reply_followup_count"))
    db.exec("ALTER TABLE outreach_emails ADD COLUMN reply_followup_count INTEGER DEFAULT 0");
  if (!cols.includes("last_reply_followup_at"))
    db.exec("ALTER TABLE outreach_emails ADD COLUMN last_reply_followup_at TEXT");
  if (!cols.includes("booked_at"))
    db.exec("ALTER TABLE outreach_emails ADD COLUMN booked_at TEXT");
}

function getCandidates(db) {
  return db.prepare(`
    SELECT * FROM outreach_emails
    WHERE status = 'replied'
      AND booked_at IS NULL
      AND (reply_followup_count IS NULL OR reply_followup_count < ?)
      AND (
        last_reply_followup_at IS NULL
        OR last_reply_followup_at < datetime('now', '-6 hours')
      )
    ORDER BY updated_at ASC
    LIMIT 20
  `).all(MAX_FOLLOWUPS);
}

async function generateFollowup(name) {
  const firstName = (name || "").split(/\s+/)[0] || "there";
  const raw = await callAI(
    `You write short reply follow-ups from Kirill D., an AI automation consultant in Calgary.
Rules: 1-2 sentences max. Direct, warm, not pushy. No em dashes. No corporate phrases.
No "Hi there", no "I hope this", no "streamline", no "leverage".
Include the exact booking link: ${CAL_LINK}
Return JSON: { "text": "..." }`,
    `Write a follow-up to ${firstName} who replied to an outreach email but has not booked a call. Ask if 20 min this week works and include the booking link.`,
    MODEL_MINI,
    true
  );
  if (raw && raw.text) return raw.text.trim();
  return `Hey ${firstName} - still happy to jump on a 20-min call this week. Here is my link: ${CAL_LINK}. What works for you?`;
}

function createTransport() {
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: false,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    tls: { rejectUnauthorized: false },
  });
}

async function run() {
  if (!SMTP_USER || !SMTP_PASS) {
    console.error("[reply-to-booking] OUTREACH_EMAIL/OUTREACH_PASSWORD not set");
    process.exit(1);
  }

  const db = new Database(DB_PATH);
  ensureColumns(db);

  const candidates = getCandidates(db);
  console.log(`[reply-to-booking] ${candidates.length} candidate(s) found`);

  if (candidates.length === 0) {
    db.close();
    return;
  }

  const transport = createTransport();
  try {
    await transport.verify();
  } catch (e) {
    console.error("[reply-to-booking] SMTP error:", e.message);
    db.close();
    return;
  }

  let sent = 0;
  for (const lead of candidates) {
    const email = lead.business_email;
    if (!email) continue;
    try {
      const name    = lead.owner_name || lead.business_name || "";
      const body    = await generateFollowup(name);
      const subject = `Re: ${lead.subject || "Quick question"}`;

      await transport.sendMail({
        from: `"${FROM_NAME}" <${SMTP_USER}>`,
        to: email,
        subject,
        text: body,
      });

      const nextCount = (lead.reply_followup_count || 0) + 1;
      db.prepare(`
        UPDATE outreach_emails
        SET reply_followup_count = ?,
            last_reply_followup_at = datetime('now'),
            updated_at = datetime('now')
        WHERE id = ?
      `).run(nextCount, lead.id);

      console.log(`[reply-to-booking] sent follow-up #${nextCount} to ${email}`);
      sent++;

      await new Promise(r => setTimeout(r, 2000));
    } catch (e) {
      console.error(`[reply-to-booking] error for lead ${lead.id}:`, e.message);
    }
  }

  console.log(`[reply-to-booking] done - ${sent}/${candidates.length} sent`);
  db.close();
  transport.close();
}

run().catch(e => {
  console.error("[reply-to-booking] fatal:", e.message);
  process.exit(1);
});
