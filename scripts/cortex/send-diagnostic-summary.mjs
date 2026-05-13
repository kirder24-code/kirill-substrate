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

const text = `🩺 ПОЛНАЯ ДИАГНОСТИКА — 103 PASS / 8 WARN / 0 FAIL из 111

✅ Что работает:
  - 6 daemons alive (cortex-alive, cortex-daemon, pulse, obsidian-sync, organism-respond, sonnet-bots)
  - Все 27 .mjs модулей в scripts/survival/ загружаются чисто
  - Все 25 actions в catalog имеют run() + metadata
  - survival.db: все 4 таблицы (policy_strategies, llm_call_log, wallet_snapshots, opportunities)
  - 10 specialist personas все loadable
  - Все 8 bridges работают (wiki, lead-db, resource-ledger, identity, factory, dispatcher, channels, specialists)
  - 22 frozen .md файлов (contract, identity, channel-registry, factory-registry, 10 personas, etc.)

⚠️ ПРОБЛЕМЫ ДЛЯ УТРА (8 warnings):

КРИТИЧНО — duplicate factory процессы (race conditions!):
  • reddit-monitor.mjs — 2 экземпляра (pid 73305 + 73396)
  • telegram-control.mjs — 2 экземпляра (pid 29520 + 46912)
  • telegram-sales-agent.mjs — 2 экземпляра (pid 11752 + 46202)
  → Возможная причина "telegram пишет про группы но не отправляет"
  → Решение утром: kill старшие PID после ревью что в state-files

Известные:
  • Telegram getUpdates conflict (substrate callback poller отключён)
  • Two cortex daemons (cortex-alive + cortex-daemon — redundant)
  • Pulse new steps (0e2/0e3) ещё не сработали — сработают на следующем pulse

Не критично:
  • organism.db legacy таблицы missing — старый scripts/policy/ stack, не используется runtime'ом

📊 Бюджет: $0.79 spent / $3.65 cap = $2.86 remaining
📁 Полный отчёт: .data/FULL-DIAGNOSTIC.md (открой утром)

Substrate работает в команде. Утром начнём с убийства duplicate факторных процессов.`;

const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: text.slice(0, 4090), disable_web_page_preview: true })
});
const j = await res.json();
console.log(j.ok ? `sent message_id=${j.result.message_id}` : `FAIL: ${j.description}`);
