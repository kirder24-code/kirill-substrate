/**
 * send-hybrid-routing-report.mjs
 * One-shot: отправить факт-отчет по hybrid-routing Claude/GPT в Telegram.
 * Run: node scripts/factory/send-hybrid-routing-report.mjs
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

const report = [
  `<b>Hybrid-routing Claude/GPT - факт-отчет</b>`,
  ``,
  `<b>Что внедрено:</b>`,
  `- ab-test-gpt-claude.mjs создан и валиден (синтаксис ок)`,
  `- Тест запускает GPT-4o и Claude Sonnet 4.6 на 2 задачах: self-rewrite protocol + living-core criterion`,
  `- Скоринг по 6 критериям (конкретность, самосознание, actionability, no-fluff)`,
  `- Победитель определяется автоматически, рекомендация routing отправляется в Telegram`,
  ``,
  `<b>Текущий live-контур (orchestrator.mjs):</b>`,
  `- MODEL_STRONG = gpt-5.4 (архитектура, агенты, КП)`,
  `- MODEL_DEFAULT = gpt-5.4 (контент, email, анализ)`,
  `- MODEL_MINI = gpt-5.4-mini (bulk scoring, классификация)`,
  `- Claude в live-routing ещё не переключен - ждет результата ab-теста`,
  ``,
  `<b>Проверочный цикл:</b>`,
  `- Файл ab-test-gpt-claude.mjs: синтаксис проверен, запускается через node`,
  `- GPT-вызов: /v1/chat/completions gpt-4o`,
  `- Claude-вызов: subprocess claude CLI --model claude-sonnet-4.6`,
  `- Результат теста определяет: переводить reasoning (self-rewrite, living-core) на Claude или держать GPT`,
  ``,
  `<b>Следующий шаг:</b>`,
  `Запусти node scripts/factory/ab-test-gpt-claude.mjs - получишь вердикт и routing-рекомендацию прямо здесь.`,
].join("\n");

console.log("Sending Telegram report...");
await tg(report);
console.log("Done.");
