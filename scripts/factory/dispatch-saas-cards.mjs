import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";

const ROOT = new URL("../../", import.meta.url).pathname;
const DATA_FILE = resolve(ROOT, ".data/saas-thread-urls.json");
const RESULT_FILE = resolve(ROOT, ".data/hands-card-dispatch-result.json");

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

async function tgSend(text, replyMarkup) {
  const body = { chat_id: CHAT_ID, text, parse_mode: "HTML", disable_web_page_preview: true };
  if (replyMarkup) body.reply_markup = replyMarkup;
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram error: ${data.description}`);
  return data;
}

async function main() {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID");
    process.exit(1);
  }

  let entries = [];
  if (existsSync(DATA_FILE)) {
    try {
      entries = JSON.parse(readFileSync(DATA_FILE, "utf8"));
    } catch (e) {
      entries = [];
    }
  }

  const result = { timestamp: new Date().toISOString(), cards_sent: 0, errors: [] };

  if (!Array.isArray(entries) || entries.length === 0) {
    await tgSend("saas-thread-urls.json is missing or empty - no comment cards to send. Investigate scout output.");
    result.cards_sent = 0;
    writeFileSync(RESULT_FILE, JSON.stringify(result, null, 2));
    console.log("No entries - sent fallback message.");
    return;
  }

  for (const entry of entries) {
    const url = entry.reddit_url || entry.url;
    const comment = entry.draft_comment || entry.comment_draft;
    if (!url || !comment) {
      result.errors.push({ entry, reason: "missing url or comment" });
      continue;
    }

    const text = `Reddit comment ready for approval:\n\nThread: ${url}\n\nDraft:\n${comment}`;
    const reply_markup = {
      inline_keyboard: [[
        { text: "Post it", callback_data: `approve_reddit:${url}` },
        { text: "Skip", callback_data: `skip_reddit:${url}` },
      ]],
    };

    try {
      await tgSend(text, reply_markup);
      result.cards_sent++;
    } catch (e) {
      result.errors.push({ url, reason: e.message });
    }
  }

  writeFileSync(RESULT_FILE, JSON.stringify(result, null, 2));
  console.log(`Done. Cards sent: ${result.cards_sent}. Errors: ${result.errors.length}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
