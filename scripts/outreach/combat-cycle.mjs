/**
 * Combat Outreach Cycle
 *
 * Selected offer: Estimate follow-up automation for Calgary service businesses.
 * Angle: landscapers/plumbers/HVAC lose 65% of open quotes to slow follow-up.
 * A 2-touch AI sequence closes 30-40% of those. Setup in 3 days, $1,500 CAD flat.
 *
 * Steps:
 *   1. Send controlled first batch (default 5 emails) from kirill@launchsoloai.com
 *   2. Wait 60s then scan inbox for immediate bounces
 *   3. Log full run result to .data/combat-log.json
 *   4. Send Telegram summary
 *
 * Usage:
 *   node scripts/outreach/combat-cycle.mjs              # live, 5 emails
 *   node scripts/outreach/combat-cycle.mjs --limit 3    # live, 3 emails
 *   node scripts/outreach/combat-cycle.mjs --dry-run    # preview only
 */

import { spawnSync } from "child_process";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { checkForReplies } from "./monitor-replies.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const LOG_PATH = resolve(ROOT, ".data/combat-log.json");
const ENV_PATH = resolve(ROOT, "apps/api/.env");

// ---------------------------------------------------------------------------
// Load env
// ---------------------------------------------------------------------------
const env = Object.fromEntries(
  readFileSync(ENV_PATH, "utf-8")
    .split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const TG_TOKEN = env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = env.TELEGRAM_CHAT_ID;

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

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------
function loadLog() {
  if (existsSync(LOG_PATH)) {
    try { return JSON.parse(readFileSync(LOG_PATH, "utf-8")); } catch {}
  }
  return [];
}

function saveLog(entry) {
  const log = loadLog();
  log.push(entry);
  writeFileSync(LOG_PATH, JSON.stringify(log, null, 2));
}

// ---------------------------------------------------------------------------
// Run send-ready-batch as subprocess (captures stdout cleanly)
// ---------------------------------------------------------------------------
function runSendBatch(limit, dryRun) {
  const args = ["scripts/outreach/send-ready-batch.mjs"];
  if (dryRun) args.push("--dry-run");
  args.push("--limit", String(limit));

  console.log(`\n[CombatCycle] Running send-ready-batch (limit=${limit}, dry=${dryRun})...`);
  const r = spawnSync("node", args, { cwd: ROOT, encoding: "utf-8", timeout: 180_000 });

  if (r.stderr) {
    const err = r.stderr.trim();
    if (err) console.error("[CombatCycle] send-batch stderr:", err);
  }

  const output = r.stdout || "";
  console.log(output);

  // Parse sent count from output
  const match = output.match(/Done:\s*(\d+)\s*emails?\s*(sent|previewed)/i);
  const sentCount = match ? parseInt(match[1]) : 0;

  // Parse sent list from "Sent: BusinessName <email>" or "[DRY] To: email" lines
  const sentEmails = [];
  const sentLines = output.match(/(?:✉️\s*Sent:|(?:\[DRY\])\s*To:)\s*(.+)/g) || [];
  for (const line of sentLines) {
    const emailMatch = line.match(/<([^>]+)>/) || line.match(/To:\s*(\S+)/);
    const nameMatch = line.match(/Sent:\s*([^<]+)\s*</);
    if (emailMatch) {
      sentEmails.push({ email: emailMatch[1].trim(), name: nameMatch ? nameMatch[1].trim() : "" });
    }
  }

  return { sentCount, sentEmails, output, exitCode: r.status };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const limitArg = args.indexOf("--limit");
  const limit = limitArg !== -1 ? parseInt(args[limitArg + 1] || "5") : 5;

  console.log("=".repeat(60));
  console.log("[CombatCycle] OFFER: Estimate follow-up automation");
  console.log("[CombatCycle] TARGET: Calgary service businesses (landscaping, plumbers, HVAC)");
  console.log("[CombatCycle] DOMAIN: kirill@launchsoloai.com");
  console.log("[CombatCycle] BATCH SIZE:", limit);
  console.log("[CombatCycle] MODE:", dryRun ? "DRY RUN" : "LIVE");
  console.log("=".repeat(60));

  const runAt = new Date().toISOString();

  // STEP 1: Send batch
  const { sentCount, sentEmails, output: sendOutput, exitCode } = runSendBatch(limit, dryRun);

  if (exitCode !== 0 && exitCode !== null) {
    console.error(`[CombatCycle] send-ready-batch exited with code ${exitCode}`);
  }

  // STEP 2: Wait then check inbox (skip on dry-run since nothing was actually sent)
  let replies = [];
  let bounces = 0;
  if (!dryRun && sentCount > 0) {
    console.log("\n[CombatCycle] Waiting 60s before inbox check...");
    await new Promise(r => setTimeout(r, 60_000));

    console.log("[CombatCycle] Checking inbox for immediate bounces and replies...");
    try {
      replies = await checkForReplies();
    } catch (err) {
      console.warn("[CombatCycle] inbox check error:", err.message);
    }
    bounces = replies.filter(r => r.bounced).length;
  } else if (dryRun) {
    console.log("\n[CombatCycle] DRY RUN - skipping inbox check");
  }

  // STEP 3: Log result
  const logEntry = {
    run_at: runAt,
    offer: "estimate_followup_automation",
    target_categories: ["landscaping", "plumbers", "hvac", "auto-repair"],
    mode: dryRun ? "dry_run" : "live",
    batch_limit: limit,
    emails_sent: sentCount,
    sent_to: sentEmails,
    replies_found: replies.length,
    bounces,
    reply_details: replies,
    exit_code: exitCode,
  };
  saveLog(logEntry);
  console.log(`\n[CombatCycle] Logged to ${LOG_PATH}`);

  // STEP 4: Telegram summary
  if (!dryRun) {
    const replyLines = replies.length > 0
      ? replies.map(r => `  - ${r.name || r.from}`).join("\n")
      : "  - none yet";

    const sentLines = sentEmails.length > 0
      ? sentEmails.map(e => `  - ${e.name || ""} &lt;${e.email}&gt;`).join("\n")
      : "  - none";

    await tgNotify(
      `<b>Combat Outreach Cycle</b>\n\n` +
      `Offer: estimate follow-up automation\n` +
      `Sent: ${sentCount} emails\n${sentLines}\n\n` +
      `Inbox check: ${replies.length} reply/bounce signal(s)\n${replyLines}\n\n` +
      `Next: check inbox in 24h for real replies.`
    );
    console.log("[CombatCycle] Telegram summary sent.");
  }

  console.log(`\n[CombatCycle] Done. Sent: ${sentCount}, Replies/signals: ${replies.length}`);
}

main().catch(err => {
  console.error("[CombatCycle] Fatal error:", err);
  process.exit(1);
});
