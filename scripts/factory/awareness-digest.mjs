/**
 * awareness-digest.mjs
 *
 * Daily Telegram digest of top unread awareness findings.
 *
 * Problem this solves: awareness-bot collects ~10-50 items/day. Most useful ones
 * (score 12-18) sit at status='new' until someone manually clicks them. Without a
 * digest, Kirill has to remember to query the DB. With a digest, the most valuable
 * findings come to him as ONE Telegram card with apply/later/skip buttons per row,
 * routed through the existing telegram-control awd_apply/awd_later/awd_skip handlers.
 *
 * Schedule: daily at 08:00 UTC (1h before awareness-bot runs again, so we show
 * yesterday's bounty before it gets buried under fresh items).
 *
 * Run: node scripts/factory/awareness-digest.mjs [N]   (default top 5)
 *
 * Built 2026-05-09 as part of "close the awareness->action loop" work.
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

const TG = env.TELEGRAM_BOT_TOKEN;
const CHAT = env.TELEGRAM_CHAT_ID;

const TOP_N = Math.max(1, Math.min(10, parseInt(process.argv[2] || "5", 10)));

import { safeSend } from "../lib/safe-send.mjs";

async function tg(text, replyMarkup) {
  if (!TG || !CHAT) {
    console.error("[awareness-digest] missing Telegram credentials");
    process.exit(1);
  }
  // Egress guard
  const guard = await safeSend({ channel: "telegram", text, meta: { source: "awareness-digest" } });
  if (!guard.ok) {
    console.error(`[awareness-digest] BLOCKED by egress-guard: ${guard.egress_reason || guard.reason}`);
    return;
  }
  const r = await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CHAT,
      text: text.slice(0, 4090),
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup: replyMarkup,
    }),
  });
  const j = await r.json();
  if (!j.ok) {
    console.error("[awareness-digest] Telegram send failed:", JSON.stringify(j).slice(0, 300));
    return false;
  }
  return true;
}

function escapeHtml(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function main() {
  const db = new Database(DB_PATH);

  // Pull top N unread items, score >= 12, prefer high-confidence + concrete action_target
  const rows = db.prepare(`
    SELECT id, score, title, category, why_matters, action_type, action_target, url, confidence
    FROM awareness_items
    WHERE status = 'new'
      AND score >= 12
    ORDER BY score DESC, created_at DESC
    LIMIT ?
  `).all(TOP_N);

  if (rows.length === 0) {
    console.log("[awareness-digest] no items >= score 12 in 'new' status, skipping send");
    db.close();
    return;
  }

  // Build one consolidated message with all N items + inline buttons per row.
  const header = `🧬 <b>Awareness Digest — top ${rows.length} unread</b>\n<i>${new Date().toISOString().slice(0, 10)} | telegram-control routes apply/later/skip</i>\n`;

  const itemBlocks = rows.map((r, idx) => {
    const num = idx + 1;
    const target = r.action_target ? ` → <code>${escapeHtml(r.action_target.slice(0, 60))}</code>` : "";
    const why = r.why_matters ? `<i>${escapeHtml(r.why_matters.slice(0, 220))}</i>` : "";
    return [
      `\n<b>${num}. [${r.score}/${r.confidence || "?"}] ${escapeHtml(r.title?.slice(0, 110) || "(no title)")}</b>`,
      `<b>${escapeHtml(r.category || "?")}</b> · ${escapeHtml(r.action_type || "?")}${target}`,
      why,
      r.url ? `<a href="${escapeHtml(r.url)}">source</a>` : "",
    ].filter(Boolean).join("\n");
  }).join("\n");

  const text = header + itemBlocks + `\n\n<i>Tap a row's buttons below to apply / defer / skip.</i>`;

  // Build inline keyboard - one row per item with 3 buttons: apply, later, skip
  // Callback handlers already exist in telegram-control: awd_apply, awd_later, awd_skip
  const inline_keyboard = rows.map((r, idx) => {
    const num = idx + 1;
    return [
      { text: `${num}. ✅ Apply`, callback_data: `awd_apply:${r.id}` },
      { text: `${num}. ⏰ Later`, callback_data: `awd_later:${r.id}` },
      { text: `${num}. ⏭ Skip`, callback_data: `awd_skip:${r.id}` },
    ];
  });

  const ok = await tg(text, { inline_keyboard });
  console.log(`[awareness-digest] sent ${rows.length} items, ok=${ok}`);

  db.close();
}

main().catch(e => {
  console.error("[awareness-digest] FATAL:", e.message);
  process.exit(1);
});
