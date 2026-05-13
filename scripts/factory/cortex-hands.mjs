import Database from "better-sqlite3";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DB_PATH = resolve(ROOT, ".data/linkedin-brand-os.sqlite");
const SANDBOX_DIR = resolve(ROOT, "sandbox-review");
const LOG_PATH = resolve(ROOT, ".data/reply-scripts-cycle3328.json");

const ENV_PATH = resolve(ROOT, "apps/api/.env");
const env = Object.fromEntries(
  readFileSync(ENV_PATH, "utf-8").split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const TG = env.TELEGRAM_BOT_TOKEN;
const CHAT = env.TELEGRAM_CHAT_ID;

if (!existsSync(SANDBOX_DIR)) mkdirSync(SANDBOX_DIR, { recursive: true });

const { callAI, MODEL_STRONG, tgSendToKirill } = await import("./orchestrator.mjs");

function getDb() { return new Database(DB_PATH); }

function pullUnactedReplies(db) {
  return db.prepare(`
    SELECT id, business_name, business_email, reply_body, body AS original_body,
           subject, reply_received_at, is_meaningful_reply
    FROM outreach_emails
    WHERE status = 'replied'
      AND (deal_assist_sent_at IS NULL OR deal_assist_sent_at = '')
      AND reply_body IS NOT NULL
      AND reply_body != ''
    ORDER BY is_meaningful_reply DESC, reply_received_at ASC
    LIMIT 7
  `).all();
}

async function draftReplyScript(row) {
  const system = `You are drafting a short reply script for Kirill D., a Calgary-based AI automation consultant (launchsoloai.com).
Services: Vibe-Code Audit $1.5-2.5K CAD, Reply Chaser Automation $1.5K, First 10 Customers Motion $2K, Custom AI builds $2.5-8K CAD.
Rules: 2-3 sentences only. Match the prospect's exact words and tone. Be direct. If they asked about pricing, give a range. If they want to meet, offer a 15-min call. No em dashes. No guarantees. No hyphens used as em dashes.`;

  const user = `Prospect: ${row.business_name || row.business_email}
Our original email subject: ${row.subject || "(no subject)"}
Our original email (first 500 chars): ${(row.original_body || "").slice(0, 500)}
Their reply: ${(row.reply_body || "").slice(0, 1000)}

Write the 2-3 sentence reply script now.`;

  return await callAI(system, user, MODEL_STRONG, false);
}

function truncate(text, max) {
  if (!text) return "";
  return text.length > max ? text.slice(0, max - 3) + "..." : text;
}

async function sendTelegram(entries) {
  const top3 = entries.slice(0, 3);
  for (const entry of top3) {
    const msg = `<b>Email reply needs action: ${entry.business_name}</b>\n\n` +
      `<b>Their reply:</b>\n<i>${truncate(entry.reply_body, 400)}</i>\n\n` +
      `<b>Draft reply script:</b>\n${truncate(entry.draft, 600)}\n\n` +
      `<i>Send from kirill@launchsoloai.com after review</i>`;
    await tgSendToKirill(msg).catch(e => console.error("[cortex-hands] TG error:", e.message));
  }
}

function buildMarkdown(entries) {
  const lines = [
    `# Email Reply Scripts - Unactioned Queue`,
    `_Generated: ${new Date().toISOString()}_`,
    `_Found: ${entries.length} unacted replies_`,
    ``,
  ];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    lines.push(`## ${i + 1}. ${e.business_name || e.business_email}`);
    lines.push(`**Email:** ${e.business_email}`);
    lines.push(`**Replied at:** ${e.reply_received_at || "unknown"}`);
    lines.push(`**Meaningful:** ${e.is_meaningful_reply ? "yes" : "no"}`);
    lines.push(``);
    lines.push(`**Their reply:**`);
    lines.push(`> ${(e.reply_body || "").replace(/\n/g, "\n> ")}`);
    lines.push(``);
    lines.push(`**Original email we sent (subject: ${e.subject || "n/a"}):**`);
    lines.push(`> ${(e.original_body || "").slice(0, 400).replace(/\n/g, "\n> ")}...`);
    lines.push(``);
    lines.push(`**Draft reply script:**`);
    lines.push(e.draft || "(draft failed)");
    lines.push(``);
    lines.push(`---`);
    lines.push(``);
  }
  return lines.join("\n");
}

async function main() {
  const db = getDb();

  const rows = pullUnactedReplies(db);
  console.log(`[cortex-hands] found ${rows.length} unacted replies`);

  if (rows.length === 0) {
    const msg = "cortex-hands: 0 unacted email replies found in DB.";
    writeFileSync(resolve(SANDBOX_DIR, "email-replies-NOW.md"), `# Email Reply Scripts\n\n${msg}\n`);
    writeFileSync(LOG_PATH, JSON.stringify({ timestamp: new Date().toISOString(), count: 0, entries: [] }, null, 2));
    db.close();
    console.log("[cortex-hands] nothing to process");
    return;
  }

  const entries = [];
  for (const row of rows) {
    console.log(`[cortex-hands] drafting reply for ${row.business_name || row.business_email}`);
    let draft = "";
    try {
      draft = await draftReplyScript(row);
    } catch (e) {
      console.error(`[cortex-hands] draft failed for ${row.business_name}: ${e.message}`);
      draft = "(AI draft unavailable - review manually)";
    }
    entries.push({ ...row, draft });
  }

  const md = buildMarkdown(entries);
  writeFileSync(resolve(SANDBOX_DIR, "email-replies-NOW.md"), md);
  console.log(`[cortex-hands] wrote sandbox-review/email-replies-NOW.md`);

  await sendTelegram(entries);
  console.log(`[cortex-hands] sent top ${Math.min(3, entries.length)} to Telegram`);

  const log = {
    timestamp: new Date().toISOString(),
    cycle: "3328",
    count: entries.length,
    entries: entries.map(e => ({
      id: e.id,
      business_name: e.business_name,
      business_email: e.business_email,
      reply_snippet: (e.reply_body || "").slice(0, 200),
      draft: e.draft,
      reply_received_at: e.reply_received_at,
    })),
  };
  writeFileSync(LOG_PATH, JSON.stringify(log, null, 2));
  console.log(`[cortex-hands] logged to .data/reply-scripts-cycle3328.json`);

  db.close();
}

await main();
