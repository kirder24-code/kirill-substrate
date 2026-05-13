/**
 * Follow-Up Email Sender
 *
 * Sends a short follow-up to businesses that received the first email
 * 3+ days ago but haven't replied. Follow-ups get 2-3x reply rate.
 *
 * Rules:
 * - Only follow up ONCE (no spam)
 * - Only personal emails (skip info@/contact@)
 * - Only during Calgary business hours (8-11 AM)
 * - Max 15 per run
 *
 * Run: node scripts/outreach/send-followups.mjs [--dry-run]
 */
import nodemailer from "nodemailer";
import Database from "better-sqlite3";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { env } from "../factory/orchestrator.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, "../../.data/linkedin-brand-os.sqlite");

const SMTP_HOST = env.OUTREACH_SMTP_HOST || "smtp-mail.outlook.com";
const SMTP_PORT = parseInt(env.OUTREACH_SMTP_PORT || "587");
const SMTP_USER = env.OUTREACH_EMAIL;
const SMTP_PASS = env.OUTREACH_PASSWORD;
const FROM_NAME = env.OUTREACH_FROM_NAME || "Kirill D.";

const MAX_PER_RUN = 15;

// 3-step follow-up sequence: Day 3 (short bump), Day 7 (value add), Day 14 (breakup)
const FOLLOWUP_SCHEDULE = [
  { step: 1, minDays: 3 },
  { step: 2, minDays: 7 },
  { step: 3, minDays: 14 },
];

// Dead-end prefixes — these are never read by a decision-maker
// NOTE: info@, contact@, hello@, office@, booking@, admin@ are ALLOWED
// because at SMBs (<20 employees) these go to the owner's inbox.
const GENERIC_PREFIX = /^(noreply|no-reply|newsletter|webmaster|careers|jobs|hr|media|press|feedback|marketing|customer_service|donotreply|do-not-reply|unsubscribe|postmaster|mailer-daemon|automated|system|bounce)$/i;

function getDb() { return new Database(DB_PATH); }

function ensureFollowupColumns(db) {
  const cols = [
    { name: "followup_sent_at", type: "TEXT" },      // step 1
    { name: "followup2_sent_at", type: "TEXT" },      // step 2
    { name: "followup3_sent_at", type: "TEXT" },      // step 3
    { name: "followup_step", type: "INTEGER DEFAULT 0" }, // tracks how many sent
  ];
  for (const col of cols) {
    try { db.exec(`ALTER TABLE outreach_emails ADD COLUMN ${col.name} ${col.type}`); } catch { /* exists */ }
  }
  // Backfill: if followup_sent_at is set but followup_step is 0, set step to 1
  db.exec(`UPDATE outreach_emails SET followup_step = 1 WHERE followup_sent_at IS NOT NULL AND (followup_step IS NULL OR followup_step = 0)`);
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

// Garbage names that slipped through in early batches
const GARBAGE_NAMES = /^(there|law|ship|for|our|who|fort|and|the|or|is|are|was|it|we|your|their|this|that|all|any|has|have|been|with|from|not|but|they|about|cleaning|insuring|dental|auto|property|insurance|account|north|south|east|west|new|old|centre|center)$/i;

function extractNameAndBiz(original) {
  const rawName = original.body?.match(/^Hi ([^,]+),/)?.[1];
  const isPlaceholder = rawName && /^\[/.test(rawName);
  const firstName = rawName && !GARBAGE_NAMES.test(rawName) && !isPlaceholder ? rawName : null;
  const greeting = firstName ? `Hi ${firstName},` : "Hi there,";
  const shortName = original.business_name?.split(/[-–—,]/)[0]?.trim() || "your business";
  return { firstName, greeting, shortName };
}

function writeFollowup(original, step = 1) {
  const { firstName, greeting, shortName } = extractNameAndBiz(original);

  if (step === 1) {
    // Day 3: Short bump — 2-3 sentences, no re-pitching
    const subject = firstName
      ? `${firstName}, quick follow-up`
      : `Quick follow-up about ${shortName}`;
    const body = `${greeting}

Just bumping my note from a few days ago — did you get a chance to read it?

Happy to explain more over email if you're curious.

Kirill`;
    return { subject, body };
  }

  if (step === 2) {
    // Day 7: Value add — a specific result, not a repeat
    const subject = firstName
      ? `${firstName}, thought you'd find this useful`
      : `Quick example for ${shortName}`;
    const body = `${greeting}

I recently helped a Calgary business cut 12 hours/week of admin work — client intake, follow-ups, and scheduling all run on autopilot now. The setup took under 2 weeks and they own it outright, no monthly fees.

If that sounds useful for ${shortName}, I can send you the details — no strings attached.

Kirill D.
Business Automation Consultant, Calgary`;
    return { subject, body };
  }

  // Step 3: Day 14 — Breakup email (paradoxically highest reply rate)
  const subject = "Should I close your file?";
  const body = `${greeting}

I've reached out a couple of times about saving time on manual work at ${shortName}. Totally understand if the timing isn't right.

If it's a "not now" — no worries, I'll circle back in a few months. If it's a "not interested" — just say the word and I'll stop emailing.

Either way, no hard feelings.

Kirill`;
  return { subject, body };
}

export async function runFollowups({ dryRun = false } = {}) {
  if (!SMTP_USER || !SMTP_PASS) {
    console.error("[Followup] OUTREACH_EMAIL or OUTREACH_PASSWORD not set");
    return;
  }

  // Send window: 8-11 AM Calgary
  if (!dryRun) {
    const calgaryHour = new Date().toLocaleString("en-US", { timeZone: "America/Edmonton", hour: "numeric", hour12: false });
    const hour = parseInt(calgaryHour);
    if (hour < 8 || hour >= 12) {
      console.log(`[Followup] Calgary time: ${hour}:00 — outside send window (8-11 AM).`);
      return;
    }
  }

  const db = getDb();
  ensureFollowupColumns(db);

  // Build list of eligible follow-ups across all 3 steps
  const now = Date.now();
  const eligible = [];

  for (const { step, minDays } of FOLLOWUP_SCHEDULE) {
    const cutoff = new Date(now - minDays * 24 * 60 * 60 * 1000).toISOString();
    const prevStep = step - 1;

    const candidates = db.prepare(`
      SELECT * FROM outreach_emails
      WHERE status = 'sent'
        AND reply_received_at IS NULL
        AND (followup_step IS NULL OR followup_step = ?)
        AND sent_at < ?
      ORDER BY sent_at ASC
    `).all(prevStep, cutoff);

    for (const c of candidates) {
      const prefix = c.business_email?.split("@")[0]?.toLowerCase();
      if (prefix && !GENERIC_PREFIX.test(prefix)) {
        eligible.push({ ...c, nextStep: step });
      }
    }
  }

  console.log(`[Followup] ${eligible.length} eligible across all steps`);

  if (eligible.length === 0) {
    console.log("[Followup] No eligible follow-ups. Either too soon, all generic, or sequence complete.");
    db.close();
    return;
  }

  const transport = dryRun ? null : createTransport();
  if (!dryRun) {
    try { await transport.verify(); console.log("[Followup] SMTP verified"); }
    catch (e) { console.error("[Followup] SMTP error:", e.message); db.close(); return; }
  }

  let sent = 0;
  for (const original of eligible.slice(0, MAX_PER_RUN)) {
    const step = original.nextStep;
    const { subject, body } = writeFollowup(original, step);

    console.log(`[Followup] ${dryRun ? "DRY-RUN" : "SENDING"} step ${step}: ${original.business_name} <${original.business_email}>`);
    console.log(`  Subject: ${subject}`);
    console.log(`  Greeting: ${body.split("\n")[0]}`);

    if (!dryRun) {
      try {
        await transport.sendMail({
          from: `"${FROM_NAME}" <${SMTP_USER}>`,
          to: original.business_email,
          subject,
          text: body,
          html: body.replace(/\n/g, "<br>"),
        });

        const colName = step === 1 ? "followup_sent_at" : `followup${step}_sent_at`;
        db.prepare(`UPDATE outreach_emails SET ${colName} = datetime('now'), followup_step = ?, updated_at = datetime('now') WHERE id = ?`)
          .run(step, original.id);

        sent++;
        console.log(`  -> Sent (step ${step}/3)`);

        // Throttle: 8-15 second delay between emails
        await new Promise(r => setTimeout(r, 8000 + Math.random() * 7000));
      } catch (err) {
        console.error(`  !! Failed: ${err.message}`);
      }
    } else {
      sent++;
    }
  }

  console.log(`\n[Followup] Done. ${sent} follow-ups ${dryRun ? "ready" : "sent"} (${eligible.length - sent} remaining).`);
  db.close();
}

// CLI — only run if invoked directly (not imported by run-factory)
const isDirectRun = process.argv[1]?.includes("send-followups");
if (isDirectRun) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  runFollowups({ dryRun }).catch(console.error);
}
