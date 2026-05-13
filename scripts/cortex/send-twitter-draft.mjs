/**
 * scripts/cortex/send-twitter-draft.mjs
 *
 * One-off: send two Twitter/X draft variants to Kirill on Telegram for
 * his copy/paste. Does not post to Twitter directly.
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
const BOT = env.TELEGRAM_BOT_TOKEN;
const CHAT = env.TELEGRAM_CHAT_ID;

const EN_DRAFT = `I'm watching a system predict, fail, and adjust right now without me touching code.

I built a council of 4 AIs (Claude, GPT-5, Gemini, DeepSeek) that argue with me about architecture. Today they stopped me from spending $60 on an email experiment that would have been theater. They forced me into ONE concrete falsifiable loop.

What's running right now:
- System predicts the next 10-minute growth of HackerNews maxitem. It said 50.
- In 10 min reality will return its number.
- The error updates Laplace weights in a policy table.
- The next prediction reads those weights.

This is not consciousness, not AGI, not a "living system."

It is the minimum mechanism by which future behavior depends on past errors against a real external signal, with no code edits.

This mechanism did not exist in the project until today.

It exists now. Small, but first.`;

const RU_DRAFT = `Прямо сейчас наблюдаю как система предсказывает, ошибается и подстраивается без моего вмешательства.

Я собрал совет из 4 ИИ (Claude, GPT-5, Gemini, DeepSeek), которые спорят со мной об архитектуре. Сегодня они остановили меня от траты $60 на email эксперимент, который был бы театром. И заставили построить ОДИН конкретный фальсифицируемый цикл вместо очередной философии.

Что работает прямо сейчас:
- Substrate предсказывает рост HackerNews maxitem за 10 минут. Сказал 50.
- Через 10 минут реальность скажет своё число.
- Ошибка обновит Laplace-веса в policy таблице.
- Следующее предсказание прочитает эти веса.

Это не сознание. Не AGI. Не "живая система".

Это минимальный механизм, при котором будущее поведение системы зависит от прошлых ошибок на реальном внешнем сигнале, без правки кода.

До сегодняшнего дня этого механизма в проекте не существовало.

Сейчас существует. Малый, но первый.`;

const message = [
  "📝 Twitter/X drafts (два варианта, выбирай и копируй)",
  "",
  "━━━ EN ━━━",
  EN_DRAFT,
  "",
  "━━━ RU ━━━",
  RU_DRAFT,
  "",
  `EN length: ${EN_DRAFT.length} chars · RU length: ${RU_DRAFT.length} chars`,
].join("\n");

async function send(text) {
  const res = await fetch(`https://api.telegram.org/bot${BOT}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CHAT,
      text: text.slice(0, 4090),
      disable_web_page_preview: true,
    })
  });
  const j = await res.json();
  if (!j.ok) throw new Error(`Telegram error: ${j.description}`);
  return j;
}

const result = await send(message);
console.log("sent. message_id:", result.result?.message_id);
