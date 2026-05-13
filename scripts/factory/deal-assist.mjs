/**
 * deal-assist.mjs
 *
 * Drafts a personalized reply to an incoming customer email and sends
 * the draft to Telegram for Kirill's review. Never auto-sends.
 *
 * Usage:
 *   node scripts/factory/deal-assist.mjs <email_id>   - draft reply for one email
 *   node scripts/factory/deal-assist.mjs --pending    - draft replies for all unprocessed meaningful replies
 */
import Database from "better-sqlite3";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { callAI, MODEL_STRONG, tgSendToKirill } from "./orchestrator.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DB_PATH = resolve(ROOT, ".data/linkedin-brand-os.sqlite");

function getDb() { return new Database(DB_PATH); }

function ensureColumn(db) {
  try { db.exec("ALTER TABLE outreach_emails ADD COLUMN deal_assist_sent_at TEXT"); } catch {}
}

async function draftReply(row) {
  const prompt = `You are helping Kirill D., a Calgary-based AI automation consultant (launchsoloai.com), draft a short reply to an incoming customer email.

Kirill's services (pick the most relevant one):
- Vibe-Code Audit + Stabilization: $1.5-2.5K CAD - for post-launch SaaS with shaky foundations
- Reply Chaser Automation: $1.5K - for any business losing leads to slow follow-up
- First 10 Customers Sales Motion: $2K - for solo SaaS founders pre-PMF
- Custom AI/automation builds: $2.5-8K CAD

BUSINESS: ${row.business_name}
EMAIL: ${row.business_email}
THEIR REPLY:
${(row.reply_body || "").slice(0, 1500)}

Reply type: ${row.reply_type || "unknown"}
Revenue signal: ${row.revenue_signal_type || "unknown"} (score ${row.revenue_signal_score || 0})

Write a short reply (3-6 sentences). Match their tone. Be direct. If they asked about pricing, give a specific range. If they want to talk, offer a 15-min call. If unclear next step, ask one clarifying question. Never use em dashes. Never use hyphens as em dashes. Never promise guarantees.`;

  return await callAI(prompt, "Draft the reply now.", MODEL_STRONG, false);
}

async function processOne(db, emailId) {
  const row = db.prepare("SELECT * FROM outreach_emails WHERE id=?").get(emailId);
  if (!row) { console.error(`[deal-assist] no email found: ${emailId}`); return; }
  if (!row.reply_body) { console.error(`[deal-assist] no reply body for id=${emailId}`); return; }

  console.log(`[deal-assist] drafting for ${row.business_name} (${row.business_email})`);

  let draft;
  try {
    draft = await draftReply(row);
  } catch (e) {
    console.error(`[deal-assist] AI error for ${row.business_name}: ${e.message}`);
    await tgSendToKirill(`<b>deal-assist FAILED: ${row.business_name}</b>\nError: ${e.message}`).catch(() => {});
    return;
  }

  const s = (t) => (t || "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const replySnippet = s((row.reply_body || "").slice(0, 300));
  const draftSnippet = s(draft.slice(0, 800));

  const tgMsg = `<b>Reply draft: ${s(row.business_name)}</b>\n\n` +
    `<b>Their reply:</b>\n<i>${replySnippet}</i>\n\n` +
    `<b>Draft reply:</b>\n${draftSnippet}\n\n` +
    `<i>Send from kirill@launchsoloai.com after review</i>`;

  await tgSendToKirill(tgMsg).catch((e) => console.error("[deal-assist] Telegram error:", e.message));

  db.prepare("UPDATE outreach_emails SET deal_assist_sent_at=datetime('now') WHERE id=?").run(emailId);
  console.log(`[deal-assist] draft sent to Telegram for ${row.business_name}`);
}

async function processPending(db) {
  const rows = db.prepare(
    "SELECT id, business_name FROM outreach_emails " +
    "WHERE is_meaningful_reply=1 AND (deal_assist_sent_at IS NULL OR deal_assist_sent_at='') " +
    "AND status='replied' ORDER BY reply_received_at ASC"
  ).all();
  console.log(`[deal-assist] ${rows.length} unprocessed meaningful replies`);
  for (const row of rows) {
    await processOne(db, row.id);
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (rows.length === 0) console.log("[deal-assist] nothing to process");
}

const db = getDb();
ensureColumn(db);

const arg = process.argv[2];
if (!arg) { console.error("usage: deal-assist.mjs <email_id|--pending>"); process.exit(1); }

if (arg === "--pending") {
  await processPending(db);
} else {
  await processOne(db, arg);
}

db.close();
