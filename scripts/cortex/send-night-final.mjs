import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const env = Object.fromEntries(
  readFileSync(resolve(ROOT, "apps/api/.env"), "utf-8")
    .split("\n").filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const text = `🌙 NIGHT MODE FINAL — bridge добавлен

Substrate теперь ВИДИТ и ИНГЕСТИТ factory output:
  • factory_status — health check 22 ботов (8 healthy, 2 stale, 1 dead, 11 без heartbeat)
  • factory_output_ingest — Claude классифицирует свежие outputs

Уже сработало в тесте ($0.02 LLM):
  → "chain/franchise operators: 3 simultaneous inbound signals"
  → "EU AI Act: SME exemptions extended to small mid-caps (may 2026)"

Эти 2 opportunities попали в substrate's pipeline. Ночью пройдут:
  research → plan → specialists → channels → drafts

📊 ИТОГО: substrate имеет 20 actions, 4 канала подключено,
   22 factory бота под мониторингом, 5+ opportunities в pipeline,
   $0.65 spent / $3.65 budget today

🛏️ Что будет ночью (~6-8 тиков):
  - Каждый tick = 1 действие из 20
  - Возможно ingest новых opportunities из factory
  - Возможно research/plan на existing
  - Возможно specialist outputs
  - Возможно site content drafts
  - Telegram listener на <operator_handle> (правильный аккаунт)
  - Возможно draft → propose_outbound_send → ты получишь Telegram

📂 Утром проверь:
  cat .data/SYSTEM-STATE.md
  cat .data/factory-status.json
  ls .data/survival-opportunities/
  ls .data/site-drafts/

Всё. Спокойной ночи.`;

const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: text.slice(0, 4090), disable_web_page_preview: true })
});
const j = await res.json();
console.log(j.ok ? `sent message_id=${j.result.message_id}` : `FAIL: ${j.description}`);
