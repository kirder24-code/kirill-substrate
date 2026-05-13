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

const text = `🌙 NIGHT MODE ARMED

Substrate работает в фоне до утра. Что будет происходить:

⚙️ pulse-daemon тикает каждый час
   → выбирает 1 из 18 actions по Лаплас-весам
   → ~24 действия за ночь
   → budget cap $5 CAD/24h ($0.63 уже spent сегодня)

📡 4 канала подключены:
   ✓ Telegram (<operator_handle> agent) - listens 3 групп
   ✓ Threads/LinkedIn/X - draft only
   ✓ Site (launchsoloai.com) - audit + content gen
   ✓ Reddit - read public

🧠 18 actions активны:
   funding_hunter, deep_research, implementation_plan,
   dispatch_to_specialist (10 personas), channel_match,
   site_audit_live, site_content_generate, telegram_listener,
   draft_writing, growth_articulation, propose_outbound_send,
   web_research, seo_learning, competitor_analysis,
   pattern_extraction, wishlist_processor, ingest_research

🛡️ Защитные слои:
   armed=true, budget cap, approval-queue для outbound,
   read-only wallet, contract immutable, NEVER auto-send

📥 Что ты увидишь утром:
   - Telegram сообщения если substrate задрафтит outbound
   - .data/SYSTEM-STATE.md - live snapshot (обновляется каждый час)
   - .data/survival-opportunities/ - per-opp specialist outputs
   - .data/site-drafts/ - новые landing pages / blog posts
   - .data/cortex-alive-bus.jsonl - bus traffic 36 cortex модулей
   - .data/factory-audit.md - cleanup recommendations

📊 Чтобы проверить ночью:
   cat .data/SYSTEM-STATE.md
   cat .data/cortex-alive-heartbeat.json

Спокойной ночи. Утром посмотрим что substrate сделал.`;

const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: text.slice(0, 4090), disable_web_page_preview: true })
});
const j = await res.json();
console.log(j.ok ? `sent message_id=${j.result.message_id}` : `FAIL: ${j.description}`);
