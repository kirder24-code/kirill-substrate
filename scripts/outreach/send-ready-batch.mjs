/**
 * Send Ready Batch  - sends pre-approved dry_run emails through new SMTP
 *
 * Takes emails already in the DB with status=dry_run that match correct ICP
 * and have owner-language copy, and sends them via kirill@launchsoloai.com.
 *
 * Usage:
 *   node scripts/outreach/send-ready-batch.mjs --dry-run    # preview only
 *   node scripts/outreach/send-ready-batch.mjs              # live send
 *   node scripts/outreach/send-ready-batch.mjs --limit 3    # send only first N
 */

import nodemailer from "nodemailer";
import Database from "better-sqlite3";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, "../../.data/linkedin-brand-os.sqlite");
const ENV_PATH = resolve(__dirname, "../../apps/api/.env");

// Load env
const env = Object.fromEntries(
  readFileSync(ENV_PATH, "utf-8")
    .split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const SMTP_HOST = env.OUTREACH_SMTP_HOST || "mail.privateemail.com";
const SMTP_PORT = parseInt(env.OUTREACH_SMTP_PORT || "587");
const SMTP_USER = env.OUTREACH_EMAIL;
const SMTP_PASS = env.OUTREACH_PASSWORD;
const FROM_NAME = env.OUTREACH_FROM_NAME || "Kirill D.";
const TG_TOKEN = env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = env.TELEGRAM_CHAT_ID;

// ICP categories only
const ICP_CATEGORIES = [
  "landscaping", "plumbers", "roofing", "hvac",
  "cleaning-services", "electrical", "moving-companies",
  "auto-repair", "garage-doors"
];

async function tgNotify(msg) {
  if (!TG_TOKEN || !CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, text: msg, parse_mode: "HTML" }),
    });
  } catch {}
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const limitArg = args.find(a => a.startsWith("--limit"));
  const limit = limitArg ? parseInt(args[args.indexOf(limitArg) + 1] || "3") : 100;

  if (!SMTP_USER || !SMTP_PASS) {
    console.error("❌ OUTREACH_EMAIL/OUTREACH_PASSWORD not set in apps/api/.env");
    return;
  }

  console.log(`\n📧 Send Ready Batch  - ${dryRun ? "DRY RUN" : "LIVE"} mode, limit ${limit}`);
  console.log(`   Sender: ${SMTP_USER}`);

  const db = new Database(DB_PATH);

  // Get dry_run emails - personalized ones can go to any email, generic ones need personal emails
  const rows = db.prepare(`
    SELECT id, business_name, business_email, business_category, business_website, subject, body, template_version
    FROM outreach_emails
    WHERE status = 'dry_run'
    AND (
      template_version = 'deep-personal-v1'
      OR business_category IN (${ICP_CATEGORIES.map(() => "?").join(",")})
    )
    ORDER BY
      CASE WHEN template_version = 'deep-personal-v1' THEN 0 ELSE 1 END,
      created_at DESC
    LIMIT ?
  `).all(...ICP_CATEGORIES, limit);

  if (rows.length === 0) {
    console.log("⚠️  No ready emails found matching ICP + personal email criteria");
    db.close();
    return;
  }

  console.log(`\n📋 Found ${rows.length} emails ready to send:\n`);

  // Check which emails are personalized (not generic templates)
  // Generic = starts with "Did you know", uses placeholder stats like "6-8 hours", no specific company reference
  const GENERIC_PATTERNS = /^Hi there,?\n|Did you know most|I'll map your top 3 time drain/i;

  for (const row of rows) {
    const isPersonalized = !GENERIC_PATTERNS.test(row.body) && row.body.includes(row.business_name.split(" ")[0]);
    const copyType = isPersonalized ? "✅ PERSONAL" : "⚠️  GENERIC";
    console.log(`  ${copyType} | ${row.business_category.padEnd(18)} | ${row.business_name.padEnd(35)} | ${row.business_email}`);
  }

  // Send personalized emails; skip generic ones
  const readyRows = rows.filter(r => !GENERIC_PATTERNS.test(r.body) && r.body.includes(r.business_name.split(" ")[0]));
  const skippedRows = rows.filter(r => GENERIC_PATTERNS.test(r.body) || !r.body.includes(r.business_name.split(" ")[0]));

  if (skippedRows.length > 0) {
    console.log(`\n⏭️  Skipping ${skippedRows.length} generic emails (need rewrite via write-email.mjs)`);
  }

  if (readyRows.length === 0) {
    console.log("\n⚠️  No personalized emails ready to send. Run rewrite first.");
    db.close();
    return;
  }

  console.log(`\n🚀 ${dryRun ? "Would send" : "Sending"} ${readyRows.length} emails:\n`);

  let transport = null;
  if (!dryRun) {
    transport = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: false,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      tls: { rejectUnauthorized: false },
    });
    try {
      await transport.verify();
      console.log("✅ SMTP verified: " + SMTP_USER);
    } catch (e) {
      console.error("❌ SMTP error:", e.message);
      db.close();
      return;
    }
  }

  // Simulation layer: predict outcome before sending
  let simulateModule = null;
  try { simulateModule = await import("../factory/simulate-before-act.mjs"); } catch {}

  let sent = 0;
  const sentList = [];

  for (const row of readyRows) {
    // WORLD MODEL: simulate before sending
    if (simulateModule && !dryRun) {
      try {
        const sim = await simulateModule.shouldAct("send_email", {
          name: row.business_name,
          category: row.business_category,
          email: row.business_email,
        }, row.body);
        if (!sim.proceed) {
          console.log(`  🧠 SIMULATION BLOCKED: ${row.business_name} — ${sim.reasoning.slice(0, 100)}`);
          console.log(`     Predicted: ${sim.predicted_outcome} (${(sim.confidence * 100).toFixed(0)}% confidence)`);
          continue;
        }
        console.log(`  🧠 Simulation: ${sim.predicted_outcome} (${(sim.confidence * 100).toFixed(0)}%) — proceeding`);
      } catch (simErr) {
        // Simulation failed — proceed anyway (don't block pipeline)
        console.log(`  🧠 Simulation error: ${simErr.message} — proceeding without simulation`);
      }
    }

    if (dryRun) {
      console.log(`[DRY] To: ${row.business_email}`);
      console.log(`  Subject: ${row.subject}`);
      console.log(`  Body: ${row.body.slice(0, 150)}...`);
      console.log();
      sent++;
      sentList.push(row);
      continue;
    }

    try {
      // Replace old sender signature if present
      let body = row.body
        .replace(/contact\.calgarygrowth@gmail\.com/g, SMTP_USER)
        .replace(/Kirill D./g, "Kirill D.")
        .replace(/Business Automation Consultant, Calgary\n/g, "")
        .replace(/https:\/\/linkedin\.com\/in\/kirill-derhachenko/g, "");

      // Clean signature  - keep it minimal
      if (!/ - Kirill| -Kirill|- Kirill/i.test(body)) {
        // Signature is already in template for owner-lang emails
      }

      const info = await transport.sendMail({
        from: `"${FROM_NAME}" <${SMTP_USER}>`,
        to: row.business_email,
        subject: row.subject,
        text: body,
        html: body.replace(/\n/g, "<br>"),
      });

      console.log(`✉️  Sent: ${row.business_name} <${row.business_email}>  - ${info.messageId}`);

      // Save to IMAP Sent folder so Kirill can see it in his mailbox
      try {
        const ImapClient = (await import("imapflow")).ImapFlow;
        const imap = new ImapClient({
          host: env.OUTREACH_IMAP_HOST || "mail.privateemail.com",
          port: parseInt(env.OUTREACH_IMAP_PORT || "993"),
          secure: true,
          auth: { user: SMTP_USER, pass: SMTP_PASS },
          logger: false,
        });
        await imap.connect();
        const rawEmail = [
          `From: "${FROM_NAME}" <${SMTP_USER}>`,
          `To: ${row.business_email}`,
          `Subject: ${row.subject}`,
          `Date: ${new Date().toUTCString()}`,
          `Message-ID: ${info.messageId}`,
          `Content-Type: text/plain; charset=utf-8`,
          ``,
          body,
        ].join("\r\n");
        await imap.append("Sent", rawEmail, ["\\Seen"]);
        await imap.logout();
        console.log(`   📥 Saved to Sent folder`);
      } catch (e) {
        console.log(`   ⚠️  Could not save to Sent: ${e.message}`);
      }

      // Update DB: dry_run → sent
      db.prepare(`
        UPDATE outreach_emails
        SET status = 'sent', sent_at = ?, updated_at = ?
        WHERE id = ?
      `).run(new Date().toISOString(), new Date().toISOString(), row.id);

      sent++;
      sentList.push(row);

      // 5s delay between sends (warmup)
      await new Promise(r => setTimeout(r, 5000));
    } catch (err) {
      console.error(`❌ Failed: ${row.business_name}  - ${err.message}`);
    }
  }

  console.log(`\n✅ Done: ${sent} emails ${dryRun ? "previewed" : "sent"}`);

  // Telegram notification
  if (sent > 0 && !dryRun) {
    const summary = sentList.map(r => `• ${r.business_name} (${r.business_category})`).join("\n");
    await tgNotify(`📧 <b>Outreach Batch Sent</b>\n\n${sent} emails from new domain:\n${summary}\n\n⏱ Follow-up in 48h`);
  }

  db.close();
}

main().catch(console.error);
