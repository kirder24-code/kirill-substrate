/**
 * Warm Reply Dispatch
 *
 * Finds warm replies with followup_draft set, queues them as dry_run entries,
 * then calls send-ready-batch.mjs to dispatch via SMTP.
 *
 * Usage:
 *   node scripts/outreach/warm-reply-dispatch.mjs --dry-run
 *   node scripts/outreach/warm-reply-dispatch.mjs
 */

import Database from "better-sqlite3";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { writeFileSync } from "fs";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, "../../.data/linkedin-brand-os.sqlite");
const RESULT_PATH = resolve(__dirname, "../../.data/warm-reply-dispatch-result.json");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");

async function main() {
  const db = new Database(DB_PATH);

  // Warm replies: resend_to_owner with draft, or any meaningful reply with draft
  const warmReplies = db.prepare(`
    SELECT id, business_name, business_email, business_category, followup_draft, action_required, status
    FROM outreach_emails
    WHERE (action_required = 'resend_to_owner' OR action_required = 'send_followup')
    AND followup_draft IS NOT NULL
    AND followup_draft != ''
    AND status != 'suppressed'
  `).all();

  console.log(`\n📬 Warm Reply Dispatch - ${dryRun ? "DRY RUN" : "LIVE"} mode`);
  console.log(`   Found ${warmReplies.length} warm replies with draft`);

  const dispatched = [];
  const errors = [];
  const newIds = [];

  for (const reply of warmReplies) {
    let draft;
    try {
      draft = JSON.parse(reply.followup_draft);
    } catch {
      errors.push({ id: reply.id, name: reply.business_name, error: "Invalid followup_draft JSON" });
      continue;
    }

    const sendTo = draft.send_to || reply.business_email;
    const subject = draft.subject;
    const body = draft.body;

    if (!sendTo || !subject || !body) {
      errors.push({ id: reply.id, name: reply.business_name, error: "Draft missing send_to/subject/body" });
      continue;
    }

    // Idempotency: skip if already queued or sent to this target
    const existing = db.prepare(`
      SELECT id, status FROM outreach_emails
      WHERE business_email = ? AND subject = ? AND status IN ('dry_run', 'sent')
    `).get(sendTo, subject);

    if (existing) {
      console.log(`   ⏭  Already queued/sent: ${reply.business_name} → ${sendTo} (${existing.status})`);
      dispatched.push({
        original_id: reply.id,
        new_id: existing.id,
        business_name: reply.business_name,
        email: sendTo,
        status: "already_exists",
      });
      continue;
    }

    const newId = `wr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    if (!dryRun) {
      db.prepare(`
        INSERT INTO outreach_emails (
          id, business_name, business_email, business_category,
          subject, body, status, template_version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'dry_run', 'deep-personal-v1', ?, ?)
      `).run(
        newId,
        reply.business_name,
        sendTo,
        reply.business_category,
        subject,
        body,
        new Date().toISOString(),
        new Date().toISOString()
      );
      newIds.push(newId);
    }

    dispatched.push({
      original_id: reply.id,
      new_id: dryRun ? "(dry-run)" : newId,
      business_name: reply.business_name,
      email: sendTo,
      subject,
      status: dryRun ? "dry_run_preview" : "queued",
    });

    console.log(`   ✅ ${dryRun ? "[DRY] Would queue" : "Queued"}: ${reply.business_name} → ${sendTo}`);
    console.log(`      Subject: ${subject}`);
    console.log(`      Body: ${body.slice(0, 120)}...`);
  }

  db.close();

  let sendResult = null;

  if (newIds.length > 0 && !dryRun) {
    console.log(`\n🚀 Calling send-ready-batch.mjs for ${newIds.length} entry(ies)...`);
    const batchScript = resolve(__dirname, "send-ready-batch.mjs");
    const proc = spawnSync("node", [batchScript, "--limit", String(newIds.length)], {
      encoding: "utf-8",
      cwd: resolve(__dirname, "../.."),
      timeout: 120000,
    });

    const output = (proc.stdout || "") + (proc.stderr || "");
    console.log(output);

    if (proc.status !== 0) {
      sendResult = { success: false, exit_code: proc.status, output: output.slice(0, 3000) };
      errors.push({ error: `send-ready-batch.mjs exited ${proc.status}` });
    } else {
      sendResult = { success: true, output: output.slice(0, 3000) };
    }
  } else if (dryRun) {
    sendResult = { success: true, output: "dry-run: send-ready-batch.mjs not called" };
  } else {
    sendResult = { success: true, output: "No new entries to send" };
    console.log("\n   No new entries queued - send-ready-batch.mjs not called.");
  }

  const result = {
    timestamp: new Date().toISOString(),
    mode: dryRun ? "dry_run" : "live",
    warm_replies_found: warmReplies.length,
    queued_count: newIds.length,
    dispatched,
    errors,
    send_result: sendResult,
  };

  writeFileSync(RESULT_PATH, JSON.stringify(result, null, 2));
  console.log(`\n📋 Result written to .data/warm-reply-dispatch-result.json`);
  console.log(`   Queued: ${newIds.length}  |  Already sent: ${dispatched.filter(d => d.status === "already_exists").length}  |  Errors: ${errors.length}`);
}

main().catch(console.error);
