/**
 * CAPTCHA Solver — 2captcha API
 * Решает reCAPTCHA v2/v3, hCaptcha, image CAPTCHAs.
 * Требует API ключ от 2captcha.com (~$2 за 1000 CAPTCHAs)
 *
 * Настройка:
 * 1. Зарегистрируйся на 2captcha.com
 * 2. Пополни баланс ($2-5)
 * 3. Скопируй API ключ
 * 4. Добавь в .env: TWOCAPTCHA_API_KEY=твой_ключ
 */

import { env } from "../factory/orchestrator.mjs";

const BASE = "https://2captcha.com";
const API_KEY = env.TWOCAPTCHA_API_KEY;

// Решить reCAPTCHA v2 (самый распространённый тип)
export async function solveRecaptchaV2(siteKey, pageUrl, timeoutMs = 120000) {
  if (!API_KEY) throw new Error("TWOCAPTCHA_API_KEY not set in .env");

  // Отправить задачу
  const submitRes = await fetch(`${BASE}/in.php`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      key: API_KEY,
      method: "userrecaptcha",
      googlekey: siteKey,
      pageurl: pageUrl,
      json: "1"
    })
  });
  const submitData = await submitRes.json();
  if (submitData.status !== 1) throw new Error(`2captcha submit failed: ${submitData.request}`);

  const taskId = submitData.request;
  console.log(`[CaptchaSolver] Task submitted: ${taskId}`);

  // Ждём решения (обычно 15-30 секунд)
  const deadline = Date.now() + timeoutMs;
  await new Promise(r => setTimeout(r, 15000)); // Первая пауза 15 сек

  while (Date.now() < deadline) {
    const resultRes = await fetch(`${BASE}/res.php?key=${API_KEY}&action=get&id=${taskId}&json=1`);
    const resultData = await resultRes.json();

    if (resultData.status === 1) {
      console.log(`[CaptchaSolver] ✅ Solved`);
      return resultData.request; // Токен reCAPTCHA
    }

    if (resultData.request !== "CAPCHA_NOT_READY") {
      throw new Error(`2captcha error: ${resultData.request}`);
    }

    await new Promise(r => setTimeout(r, 5000));
  }

  throw new Error("CAPTCHA solving timed out");
}

// Решить hCaptcha
export async function solveHCaptcha(siteKey, pageUrl, timeoutMs = 120000) {
  if (!API_KEY) throw new Error("TWOCAPTCHA_API_KEY not set in .env");

  const submitRes = await fetch(`${BASE}/in.php`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      key: API_KEY,
      method: "hcaptcha",
      sitekey: siteKey,
      pageurl: pageUrl,
      json: "1"
    })
  });
  const submitData = await submitRes.json();
  if (submitData.status !== 1) throw new Error(`2captcha submit failed: ${submitData.request}`);

  const taskId = submitData.request;
  await new Promise(r => setTimeout(r, 20000));

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const resultRes = await fetch(`${BASE}/res.php?key=${API_KEY}&action=get&id=${taskId}&json=1`);
    const resultData = await resultRes.json();
    if (resultData.status === 1) return resultData.request;
    if (resultData.request !== "CAPCHA_NOT_READY") throw new Error(`2captcha error: ${resultData.request}`);
    await new Promise(r => setTimeout(r, 5000));
  }
  throw new Error("hCaptcha solving timed out");
}

// Проверить баланс
export async function checkBalance() {
  if (!API_KEY) return null;
  const res = await fetch(`${BASE}/res.php?key=${API_KEY}&action=getbalance&json=1`);
  const data = await res.json();
  return data.status === 1 ? parseFloat(data.request) : null;
}
