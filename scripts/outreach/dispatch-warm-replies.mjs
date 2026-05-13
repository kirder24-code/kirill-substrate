#!/usr/bin/env node
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const SCRIPTS_DIR = resolve(ROOT, ".data/reply-scripts");
const CONFIRM_PATH = resolve(ROOT, ".data/warm-reply-dispatch-confirmed.json");

// Load env from .env files
const env = {};
for (const envPath of [resolve(ROOT, ".env"), resolve(ROOT, "apps/api/.env")]) {
  try {
    const raw = readFileSync(envPath, "utf-8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch {}
}

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || env.TELEGRAM_CHAT_ID;

if (!BOT_TOKEN || !CHAT_ID) {
  console.error("TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing");
  process.exit(1);
}

async function tgSend(text) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: "HTML" }),
  });
  const data = await res.json();
  if (!data.ok) {
    console.error("[Telegram error]", data.description);
    return null;
  }
  return data.result;
}

// Query SQLite DB for warm replies
function queryDbReplies() {
  const require = createRequire(import.meta.url);
  const rows = [];
  const dbPaths = [
    resolve(ROOT, ".data/outreach.db"),
    resolve(ROOT, ".data/linkedin-brand-os.sqlite"),
  ];

  for (const dbPath of dbPaths) {
    if (!existsSync(dbPath)) continue;
    try {
      const Database = require("better-sqlite3");
      const db = new Database(dbPath, { readonly: true });
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);

      if (tables.includes("manual_pending_outreach")) {
        const r = db.prepare(
          "SELECT id, company, email, subject, body, replied_at, status, outcome, notes FROM manual_pending_outreach WHERE replied_at IS NOT NULL ORDER BY replied_at DESC"
        ).all();
        for (const row of r) {
          rows.push({
            id: row.id,
            business_name: row.company,
            business_email: row.email,
            subject: row.subject,
            reply_body: row.notes || row.outcome || "(no reply text stored)",
            reply_received_at: row.replied_at,
            source: "outreach.db",
          });
        }
        db.close();
        console.log(`[DB] outreach.db: ${r.length} replied rows`);
      } else if (tables.includes("outreach_emails")) {
        const cols = db.prepare("PRAGMA table_info(outreach_emails)").all().map(c => c.name);
        const emailCol = cols.find(c => c === "to_email") || cols.find(c => c.includes("email")) || "id";
        const r = db.prepare(
          `SELECT id, ${emailCol} as to_email, subject, status, updated_at FROM outreach_emails WHERE status = 'replied' ORDER BY updated_at DESC LIMIT 20`
        ).all();
        for (const row of r) {
          rows.push({
            id: row.id,
            business_name: row.to_email,
            business_email: row.to_email,
            subject: row.subject,
            reply_body: "(see email inbox)",
            reply_received_at: row.updated_at,
            source: "linkedin-brand-os.sqlite",
          });
        }
        db.close();
        console.log(`[DB] linkedin-brand-os.sqlite: ${r.length} replied rows`);
      } else {
        db.close();
      }
    } catch (err) {
      console.error(`[DB] ${dbPath}: ${err.message}`);
    }
  }
  return rows;
}

// Load warm replies from reply-handles.json as primary source
function loadHandleReplies() {
  const handlesPath = resolve(ROOT, ".data/reply-handles.json");
  if (!existsSync(handlesPath)) return [];
  try {
    const d = JSON.parse(readFileSync(handlesPath, "utf-8"));
    return d.query1_repliers || [];
  } catch {
    return [];
  }
}

// Merge DB and handle replies, deduplicate by business name
function mergeReplies(dbRows, handleRows) {
  const seen = new Set();
  const merged = [];
  for (const r of [...handleRows, ...dbRows]) {
    const key = (r.business_name || r.company || "").toLowerCase().trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(r);
  }
  return merged;
}

// Load reply scripts from .data/reply-scripts/
function loadReplyScripts() {
  if (!existsSync(SCRIPTS_DIR)) mkdirSync(SCRIPTS_DIR, { recursive: true });
  const files = readdirSync(SCRIPTS_DIR).filter(f => f.endsWith(".json"));
  const scripts = {};
  for (const f of files) {
    try {
      const s = JSON.parse(readFileSync(join(SCRIPTS_DIR, f), "utf-8"));
      if (s.lead) scripts[s.lead.toLowerCase()] = s;
    } catch {}
  }
  return scripts;
}

// Build one-line follow-up instruction from raw reply data
function buildInlineInstruction(reply) {
  const action = reply.action_required || "follow_up";
  const name = reply.business_name || "prospect";
  const replyText = (reply.reply_body || "").trim().slice(0, 120);
  const draft = (() => {
    try { return typeof reply.followup_draft === "string" ? JSON.parse(reply.followup_draft) : reply.followup_draft; } catch { return null; }
  })();
  const sendTo = draft?.send_to || reply.business_email;

  const instructions = {
    resend_to_owner: `Re-send original email to <code>${sendTo}</code> - their reply redirected to the right inbox.`,
    verify_sender: `Try a fresh outreach to ${name} - spam filter challenge expired. Find a direct contact.`,
    retry_outreach: `Retry outreach to ${name} at a fresh address - previous message hit a filter.`,
    qualify_further: `Reply to ${name} with a qualifying question - they showed interest.`,
    no_action: `No reply needed - automated response from ${name}.`,
    suppress_contact: `Do NOT contact ${name} again - requested removal.`,
  };

  return instructions[action] || `Follow up with ${name}: "${replyText}"`;
}

// Format a card for a single reply
function formatCard(reply, script, idx) {
  const name = reply.business_name || reply.business_name || "Unknown";
  const priority = script?.priority || (reply.is_meaningful_reply ? "high" : "low");
  const emoji = priority === "high" ? "red" : "yellow";
  const emojiChar = priority === "high" ? "🔴" : "🟡";

  if (script && script.status === "ready" && script.body_bullets?.length) {
    const bullets = script.body_bullets.map(b => `  ${b}`).join("\n");
    const instruction = script.action === "retry_outreach"
      ? `Find fresh contact for ${name} and send this.`
      : `Email <code>${script.to}</code> now - copy/paste ready.`;
    return (
      `${emojiChar} <b>[${idx}] ${name}</b>\n` +
      `To: <code>${script.to}</code>\n` +
      `Subject: ${script.subject}\n\n` +
      `${bullets}\n\n` +
      `<i>${instruction}</i>`
    );
  }

  // Inline fallback
  const instruction = buildInlineInstruction(reply);
  const snippet = (reply.reply_body || "").trim().slice(0, 200);
  return (
    `${emojiChar} <b>[${idx}] ${name}</b>\n` +
    `Email: <code>${reply.business_email || "?"}</code>\n` +
    `Their reply: "${snippet}"\n\n` +
    `<i>${instruction}</i>`
  );
}

// Main
const dbRows = queryDbReplies();
const handleRows = loadHandleReplies();
const allReplies = mergeReplies(dbRows, handleRows);
const scripts = loadReplyScripts();
const total = allReplies.length;
console.log(`Total warm replies found: ${total} (${dbRows.length} from DB, ${handleRows.length} from handles)`);

if (total === 0) {
  console.log("No warm replies found in DB or handles file.");
  process.exit(0);
}

// Pick top 3 - prioritise meaningful + has script
const ranked = [...allReplies].sort((a, b) => {
  const aScript = scripts[(a.business_name || "").toLowerCase()];
  const bScript = scripts[(b.business_name || "").toLowerCase()];
  const aScore = (a.is_meaningful_reply ? 2 : 0) + (aScript ? 1 : 0);
  const bScore = (b.is_meaningful_reply ? 2 : 0) + (bScript ? 1 : 0);
  return bScore - aScore;
});
const top3 = ranked.filter(r => (r.action_required || "") !== "suppress_contact" && (r.action_required || "") !== "no_action" || scripts[(r.business_name || "").toLowerCase()]).slice(0, 3);
// If top3 is empty after filtering, take first 3 regardless
const toSend = top3.length > 0 ? top3 : ranked.slice(0, 3);

// Build header
const header =
  `<b>WARM REPLIES - ${total} found, ${toSend.length} need action</b>\n` +
  `Queried: outreach.db + reply-handles.json\n`;

// Send header
const headerResult = await tgSend(header);
const messageIds = headerResult ? [headerResult.message_id] : [];
await new Promise(r => setTimeout(r, 400));

// Send top 3 cards
for (let i = 0; i < toSend.length; i++) {
  const reply = toSend[i];
  const script = scripts[(reply.business_name || "").toLowerCase()];
  const card = formatCard(reply, script, i + 1);
  const result = await tgSend(card);
  if (result) messageIds.push(result.message_id);
  console.log(`Sent card: ${reply.business_name}`);
  await new Promise(r => setTimeout(r, 600));
}

// Action line
const actionResult = await tgSend("Send each of these today.");
if (actionResult) messageIds.push(actionResult.message_id);

// Log delivery proof
const confirmPayload = {
  dispatched_at: new Date().toISOString(),
  total_warm_replies: total,
  cards_sent: toSend.length,
  message_ids: messageIds,
  last_message_id: messageIds[messageIds.length - 1] || null,
  leads: toSend.map(r => r.business_name),
};
writeFileSync(CONFIRM_PATH, JSON.stringify(confirmPayload, null, 2));
console.log(`Logged delivery to ${CONFIRM_PATH}`);
console.log(`message_id: ${confirmPayload.last_message_id}`);
console.log("Done.");
