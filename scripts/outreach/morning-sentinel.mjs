/**
 * Morning sentinel: runs at 9:30 AM Calgary (after 9:00 outreach cron),
 * verifies the batch fired, summarizes what went out, and Telegrams Kirill.
 *
 * Replaces "wake up and ask Kirill if it worked" with "Kirill wakes up to a result".
 *
 * Triggered by cron: 30 9 * * 1-5
 */

import Database from "better-sqlite3";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, "../../.data/linkedin-brand-os.sqlite");
const ENV_PATH = resolve(__dirname, "../../apps/api/.env");

const env = Object.fromEntries(
  readFileSync(ENV_PATH, "utf-8").split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const TG_TOKEN = env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = env.TELEGRAM_CHAT_ID;

async function tg(msg) {
  if (!TG_TOKEN || !CHAT_ID) { console.log("[sentinel] no TG creds, skip"); return; }
  try {
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, text: msg, parse_mode: "HTML" }),
    });
  } catch (e) { console.error("[sentinel] tg failed:", e.message); }
}

const db = new Database(DB_PATH, { readonly: true });

// Today's sends (since midnight Calgary)
const today = db.prepare(`
  SELECT
    business_category AS cat,
    COALESCE(template_version, 'v3') AS arm,
    COUNT(*) AS sent,
    SUM(CASE WHEN status = 'bounced' THEN 1 ELSE 0 END) AS bounced
  FROM outreach_emails
  WHERE date(sent_at) = date('now', 'localtime')
  GROUP BY business_category, arm
  ORDER BY business_category, arm
`).all();

// New meaningful replies in last 24h
const newReplies = db.prepare(`
  SELECT business_name, business_category, COALESCE(template_version, 'v3') AS arm, sent_at, reply_received_at
  FROM outreach_emails
  WHERE reply_received_at IS NOT NULL
    AND date(reply_received_at) >= date('now', '-1 day', 'localtime')
    AND IFNULL(reply_body, '') NOT LIKE '%AUTO-REPLY%'
    AND IFNULL(reply_body, '') NOT LIKE '%out of office%'
    AND IFNULL(reply_body, '') NOT LIKE '%unsubscribe%'
    AND IFNULL(reply_body, '') NOT LIKE '%delivery has failed%'
  ORDER BY reply_received_at DESC
`).all();

db.close();

const totalSent = today.reduce((s, r) => s + r.sent, 0);
const totalBounced = today.reduce((s, r) => s + r.bounced, 0);
const v4Sent = today.filter(r => r.arm === "v4-icp").reduce((s, r) => s + r.sent, 0);
const v3Sent = totalSent - v4Sent;

let msg = `<b>🌅 Morning Sentinel</b>\n`;
msg += `<i>${new Date().toLocaleString("en-US", { timeZone: "America/Edmonton" })}</i>\n\n`;

if (totalSent === 0) {
  msg += `⚠️ <b>NO outreach today</b>\n`;
  msg += `Cron may have failed. Check /tmp/lbo-outreach.log\n`;
} else {
  msg += `✅ <b>${totalSent} emails sent today</b>\n`;
  msg += `Split: v3=${v3Sent}, v4=${v4Sent}\n`;
  if (totalBounced > 0) msg += `⚠️ Bounced: ${totalBounced}\n`;
  msg += `\n<b>By category:</b>\n`;
  // Group by cat for cleaner display
  const byCat = {};
  for (const r of today) {
    if (!byCat[r.cat]) byCat[r.cat] = { v3: 0, v4: 0 };
    if (r.arm === "v4-icp") byCat[r.cat].v4 += r.sent;
    else byCat[r.cat].v3 += r.sent;
  }
  for (const [cat, arms] of Object.entries(byCat)) {
    const tag = (arms.v3 > 0 && arms.v4 > 0) ? ` <i>(A/B)</i>` : "";
    msg += `  • ${cat}: ${arms.v3 + arms.v4}${tag}\n`;
  }
}

if (newReplies.length > 0) {
  msg += `\n<b>📨 ${newReplies.length} new reply(ies) in 24h:</b>\n`;
  for (const r of newReplies.slice(0, 5)) {
    msg += `  • ${r.business_name} (${r.business_category}, ${r.arm})\n`;
  }
} else {
  msg += `\n<i>No new replies in last 24h.</i>\n`;
}

console.log(msg.replace(/<[^>]+>/g, ""));
await tg(msg);
