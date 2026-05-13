/**
 * Send corrected LinkedIn drafts (substrate-generated) to Kirill.
 */

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

const PLAN = readFileSync(resolve(ROOT, ".data/survival-opportunities/opp-canadian-government-ai-adoption-grants-f-3ceb42/plan.md"), "utf-8");

// Extract the LinkedIn drafts section
const linkedinSection = PLAN.split(/### LinkedIn post drafts/i)[1].split(/### Outreach drafts/i)[0];

async function send(text) {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: env.TELEGRAM_CHAT_ID,
      text: text.slice(0, 4090),
      disable_web_page_preview: true,
    })
  });
  const j = await res.json();
  if (!j.ok) throw new Error(j.description);
  return j.result.message_id;
}

const correction = `⚠️ CORRECTION: мой ранее отправленный пост (msg 8904) основан на устаревшей информации.

Substrate сам провёл deep research и нашёл что:
- CDAP CLOSED с Feb 2024 (оба stream'а)
- BDC LIFT — replaced it, запущен 24 April 2026
- $25K-$2M loans at 2.25% interest for AI/digital transformation
- SR&ED — основной налоговый механизм (35% refundable ITC)
- IRAP — для genuine R&D, стандартные n8n/Claude не подходят

Substrate сгенерировал 3 различных угла LinkedIn-пост, все fact-corrected. Отправляю их следующими сообщениями.`;

const id1 = await send(correction);

const angles = linkedinSection.split(/\*\*ANGLE_/);
for (let i = 1; i < angles.length; i++) {
  const text = `📝 LINKEDIN ANGLE_${angles[i].slice(0, 1)}\n━━━━━━━━\n${angles[i].slice(2).split(/^---/m)[0].trim()}\n━━━━━━━━`;
  await send(text);
}

console.log(`Sent correction + 3 angles starting at message_id ${id1}`);
