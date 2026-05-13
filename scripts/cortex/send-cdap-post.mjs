/**
 * One-off: send LinkedIn post draft about CDAP/IRAP/BDC grants to Kirill.
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

const POST = `A $5K AI workflow project for a Canadian SMB lands closer to $500 out of pocket after the CDAP grant. Most owners I talk to don't know this exists.

CDAP (Canada Digital Adoption Program) gives up to $15K toward building a Digital Adoption Plan, plus up to $100K interest-free from BDC to implement it.

Eligibility is more accessible than people think:
- Incorporated Canadian SME, for-profit
- 1 to 499 employees
- $500K+ annual revenue in 1 of the last 3 years

An AI workflow build (invoice automation, intake routing, follow-up sequencing, custom Claude or GPT integrations) fits inside the "digital adoption plan" deliverable. The consulting fee becomes grantable.

For bigger R&D builds, IRAP offers $50K to $500K non-repayable. The bar is "technological uncertainty" - a standard n8n + Claude workflow does not qualify. You need genuinely novel system design.

If you are a Canadian SMB owner with a manual process you have been meaning to automate, this window is more open than you think. Drop a comment or DM and I will point you to the right program.`;

const message = [
  "📝 LinkedIn draft: CDAP/IRAP grants angle",
  "",
  "━━━━━━━━",
  POST,
  "━━━━━━━━",
  "",
  `Length: ${POST.length} chars (~${Math.round(POST.split(/\s+/).length)} words). No em dashes. Hyphens only.`,
  "",
  "Suggested next: paste as LinkedIn post. If a comment lands, reply with one specific operator's stuck workflow you can audit free."
].join("\n");

const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    chat_id: env.TELEGRAM_CHAT_ID,
    text: message.slice(0, 4090),
    disable_web_page_preview: true,
  })
});
const j = await res.json();
console.log(j.ok ? `sent message_id=${j.result.message_id}` : `FAIL: ${j.description}`);
