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
const PLAN = readFileSync(resolve(ROOT, ".data/survival-opportunities/opp-australia-r-d-tax-incentive-6dc9a1/plan.md"), "utf-8");
const linkedinSection = PLAN.split(/### LinkedIn post drafts/i)[1].split(/### Outreach drafts/i)[0];

async function send(text) {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: text.slice(0, 4090), disable_web_page_preview: true })
  });
  const j = await res.json();
  if (!j.ok) throw new Error(j.description);
  return j.result.message_id;
}

const intro = `🔧 ИСПРАВЛЕННЫЕ AU R&D drafts (substrate теперь знает кто ты)

Вчера вечером пришла карточка "Australian founders: you have 6 weeks..." — substrate генерил как будто ты местный AU. Это был bug: identity-контекст нигде в промпт не попадал.

Я добавил operator-identity.md (заморожённый файл с твоими hard facts: Calgary, online consulting, ALL markets in scope). Теперь substrate понимает что ты remote Canadian архитектор который работает с online businesses worldwide. Это feature, не bug — в 2026 cross-border consulting норма.

Перегенерил тот же AU R&D opportunity. Substrate выбрал 3 разных угла, ВСЕ с честным "remote Canadian, work delivered online" framing. Не притворяется AU local. Опирается на cross-border pattern (CA SR&ED + AU RDTI) который реально работает на твою существующую Canadian аудиторию И привлекает AU readers одновременно.

Ниже — 3 угла. Все можно постить от твоего имени без потери credibility.`;

const id1 = await send(intro);

const angles = linkedinSection.split(/\*\*ANGLE_/);
for (let i = 1; i < angles.length; i++) {
  const text = `📝 LINKEDIN ANGLE_${angles[i].slice(0, 1)} (corrected voice)\n━━━━━━━━\n${angles[i].slice(2).split(/^---/m)[0].trim()}\n━━━━━━━━`;
  await send(text);
}

console.log(`Sent corrected AU drafts starting at message_id ${id1}`);
