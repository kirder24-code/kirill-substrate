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

const PUBLIC_URL = "https://psychiatry-bikes-receive-latinas.trycloudflare.com";

const text = `🟢 LETTA + WEBHOOK SERVER LIVE (5:30 утра)

✅ LETTA SLEEP AGENT работает
  Server: http://localhost:8283
  Agent ID: agent-71452033-8577-47f3-958d-9bf7e722da58
  LLM: gpt-4o-mini (через твой OPENAI_API_KEY)
  Substrate каждый час шлёт snapshot, Letta sleep loop переписывает memory blocks между exchanges

✅ WEBHOOK SERVER работает
  Local: http://localhost:4789
  Public: ${PUBLIC_URL}
  Health: ${PUBLIC_URL}/health → 200 OK
  Tunnel: cloudflared quick tunnel (бесплатный)

⚠️ ЧТО НУЖНО ОТ ТЕБЯ ЧТОБЫ ПОЛУЧИТЬ REAL MONEY SIGNAL:

📊 STRIPE (5 минут):
  1. Stripe Dashboard → Developers → Webhooks → "Add endpoint"
  2. URL: ${PUBLIC_URL}/webhooks/stripe
  3. Events: payment_intent.succeeded, invoice.paid, charge.refunded
  4. Скопировать "Signing secret" (whsec_...)
  5. В apps/api/.env добавить строку:
     STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxx

📅 CAL.COM (5 минут):
  1. Cal.com → Settings → Developer → Webhooks → "New webhook"
  2. URL: ${PUBLIC_URL}/webhooks/calcom
  3. Events: BOOKING_CREATED, MEETING_ENDED, BOOKING_CANCELLED
  4. Скопировать Secret
  5. В apps/api/.env добавить:
     CALCOM_WEBHOOK_SECRET=xxxxxxxxxxxx

После этого каждый платёж в Stripe и каждый booked call в Cal.com будут REAL fitness signal в substrate (не synthetic Лаплас, а реальные деньги/звонки).

⚠️ ПРИМЕЧАНИЕ:
Tunnel URL (psychiatry-bikes-...) временный — пропадёт если перезапустишь cloudflared. Для постоянного: cloudflared tunnel login → named tunnel (бесплатно). На сегодня достаточно.

📂 PROCESSES ALIVE сейчас:
  letta server: pid $(cat .data/letta-server.pid 2>/dev/null || echo "?")
  webhook-server: pid $(cat .data/webhook-server.pid 2>/dev/null || echo "?")
  cloudflared tunnel: pid $(cat .data/cloudflared.pid 2>/dev/null || echo "?")

Утром добавь webhook-secret'ы в env — substrate СРАЗУ начнёт видеть реальные деньги/booking как fitness signal.`;

const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: text.slice(0, 4090), disable_web_page_preview: true })
});
const j = await res.json();
console.log(j.ok ? `sent message_id=${j.result.message_id}` : `FAIL: ${j.description}`);
