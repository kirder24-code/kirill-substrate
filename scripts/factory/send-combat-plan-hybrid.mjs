/**
 * send-combat-plan-hybrid.mjs
 * One-shot: отправить первый боевой план hybrid-routing в Telegram.
 * Run: node scripts/factory/send-combat-plan-hybrid.mjs
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");

const env = Object.fromEntries(
  readFileSync(resolve(ROOT, "apps/api/.env"), "utf-8").split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const TG_TOKEN = env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = env.TELEGRAM_CHAT_ID;

async function tg(text) {
  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text: text.slice(0, 4096),
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error("TG error: " + JSON.stringify(data));
  return data;
}

const plan = [
  `<b>COMBAT CYCLE 1 - Hybrid Routing</b>`,
  ``,
  `<b>Цель:</b> Доказать hybrid-routing на реальном бизнес-результате сегодня`,
  ``,
  `<b>Задача дня (1 deliverable):</b>`,
  `Отправить 10 персонализированных outreach-сообщений через Reddit`,
  `- Scout: найти 10 свежих постов (боль = автоматизация / no-code / AI tools)`,
  `- Router: GPT-mini классифицирует боль, Claude Sonnet пишет reply-драфт`,
  `- Dispatch: dispatch-reddit-drafts.mjs отправляет пакет в Telegram на апрув`,
  ``,
  `<b>Контур:</b>`,
  `reddit-monitor -> hybrid-router (GPT-mini score + Claude draft) -> dispatch -> Kirill`,
  ``,
  `<b>Checkpoint:</b>`,
  `До 18:00 - 10 драфтов в Telegram. Если нет - блокер на эскалацию.`,
  ``,
  `<b>Запуск:</b>`,
  `node scripts/factory/reddit-monitor.mjs`,
].join("\n");

console.log("Sending combat plan to Telegram...");
await tg(plan);
console.log("Done.");
