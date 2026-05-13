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

const STRATEGY = readFileSync(
  resolve(ROOT, ".data/survival-opportunities/opp-australia-r-d-tax-incentive-6dc9a1/specialists/marketing_strategist/marketing-strategy.md"),
  "utf-8"
);

async function send(text) {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: text.slice(0, 4090), disable_web_page_preview: true })
  });
  const j = await res.json();
  if (!j.ok) throw new Error(j.description);
  return j.result.message_id;
}

const intro = `🧠 SPECIALIST AGENTS — substrate теперь умеет dispatch'ить узким экспертам

Построил 3 specialist persona (~3KB каждая, distilled expert knowledge):
- market_researcher — sizing, ICP, GO/HOLD/DROP recommendation
- marketing_strategist — 6-week phased channel strategy
- copywriter — publish-ready outbound + LinkedIn copy

Substrate теперь имеет action dispatch_to_specialist которое маршрутизирует кусок работы по opportunity к нужному эксперту. Стоимость одного dispatch ~$0.20.

DEMO: запустил marketing_strategist на AU R&D Tax Incentive opportunity. Substrate как senior marketing strategist написал реальную strategy с тем что общий research пропустил:

⚡ Catch: AU RDTI имеет Overseas Finding requirement — overseas contractor нужен pre-approval. Это меняет positioning кардинально. Канал не founders, а R&D tax advisors которые уже сидят между SMB и программой.

Ниже — Recommended channel + Messaging Frame из strategy. Полный документ (86 строк) лежит:
.data/survival-opportunities/opp-australia-r-d-tax-incentive-6dc9a1/specialists/marketing_strategist/marketing-strategy.md`;

const id1 = await send(intro);

const recommended = STRATEGY.split(/### Recommended primary/i)[1].split(/### Phased/i)[0];
await send(`📊 RECOMMENDED CHANNEL\n━━━━━━━━\n### Recommended primary${recommended}\n━━━━━━━━`);

const messaging = STRATEGY.split(/### Messaging frame/i)[1].split(/### Risks/i)[0];
await send(`🎯 MESSAGING FRAME\n━━━━━━━━\n### Messaging frame${messaging}\n━━━━━━━━`);

const risks = STRATEGY.split(/### Risks and how to detect/i)[1].split(/### What success/i)[0];
await send(`⚠️ RISKS + DETECTION\n━━━━━━━━\n### Risks${risks.slice(0, 3000)}\n━━━━━━━━`);

console.log(`Sent specialist demo starting at message_id ${id1}`);
