import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../../");

// Load env from apps/api/.env
const envLines = readFileSync(resolve(ROOT, "apps/api/.env"), "utf8").split("\n");
const env = Object.fromEntries(
  envLines
    .filter(l => l.includes("=") && !l.startsWith("#"))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const BOT_TOKEN = env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = env.TELEGRAM_CHAT_ID;

if (!BOT_TOKEN || !CHAT_ID) {
  console.error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID");
  process.exit(1);
}

async function sendCard(index, entry) {
  const text = [
    `<b>Reddit Comment Approval [${index + 1}/2]</b>`,
    ``,
    `<b>Thread:</b> ${entry.thread_title}`,
    `<b>URL:</b> ${entry.url}`,
    ``,
    `<b>Draft:</b>`,
    entry.comment_draft,
  ].join("\n");

  const reply_markup = {
    inline_keyboard: [[
      { text: "Post Comment", callback_data: `approve_reddit:${index}` },
      { text: "Skip", callback_data: `reject_reddit:${index}` },
    ]]
  };

  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      reply_markup,
    }),
  });

  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram error [${index}]: ${data.description}`);
  return data;
}

async function main() {
  const threads = JSON.parse(readFileSync(resolve(ROOT, ".data/saas-thread-urls.json"), "utf8"));

  const results = [];
  for (let i = 0; i < threads.length; i++) {
    const r = await sendCard(i, threads[i]);
    results.push({ index: i, message_id: r.result?.message_id, url: threads[i].url });
    console.log(`Sent card ${i + 1}/${threads.length}: message_id=${r.result?.message_id}`);
  }

  const confirmation = {
    sent_at: new Date().toISOString(),
    entry_count: threads.length,
    messages: results,
  };

  writeFileSync(resolve(ROOT, ".data/saas-cards-sent.json"), JSON.stringify(confirmation, null, 2));
  console.log(`Done. Confirmation written to .data/saas-cards-sent.json`);
}

main().catch(err => { console.error(err); process.exit(1); });
