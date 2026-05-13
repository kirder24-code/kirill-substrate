/**
 * LinkedIn Account Creator — автономный
 * Создаёт LinkedIn аккаунт для скрейпинга без риска для основного.
 *
 * Требования:
 * - TWOCAPTCHA_API_KEY в .env (2captcha.com, ~$2)
 * - Playwright (уже установлен)
 *
 * Запуск: node scripts/automation/linkedin-account-creator.mjs
 */

import { chromium } from "@playwright/test";
import { createTempEmail, waitForEmail, extractVerificationLink } from "./temp-email.mjs";
import { solveRecaptchaV2, checkBalance } from "./captcha-solver.mjs";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ACCOUNTS_FILE = resolve(__dirname, "../../.data/linkedin-accounts.json");

// Случайные имена для аккаунтов
const FIRST_NAMES = ["Alex", "Jordan", "Morgan", "Taylor", "Casey", "Riley", "Drew", "Quinn"];
const LAST_NAMES = ["Miller", "Davis", "Johnson", "Wilson", "Anderson", "Thompson", "Martinez"];

function randomName() {
  const first = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
  const last = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
  return { first, last };
}

// Случайная пауза — имитирует живого пользователя
async function humanDelay(min = 1000, max = 3000) {
  await new Promise(r => setTimeout(r, min + Math.random() * (max - min)));
}

export async function createLinkedInAccount() {
  console.log("[LinkedIn Creator] Starting autonomous account creation...");

  // Проверить баланс 2captcha
  const balance = await checkBalance();
  if (balance !== null) {
    console.log(`[LinkedIn Creator] 2captcha balance: $${balance}`);
    if (balance < 0.1) throw new Error("2captcha balance too low — top up at 2captcha.com");
  } else {
    console.warn("[LinkedIn Creator] No TWOCAPTCHA_API_KEY — will attempt without CAPTCHA solving");
  }

  // Создать temp email
  console.log("[LinkedIn Creator] Creating temp email...");
  const email = await createTempEmail();
  console.log(`[LinkedIn Creator] Email: ${email.address}`);

  const name = randomName();
  const password = `Scout${Date.now()}!`;

  const browser = await chromium.launch({
    headless: false, // Видимый браузер — LinkedIn лучше реагирует
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-features=IsolateOrigins,site-per-process",
      "--no-sandbox"
    ]
  });

  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
    locale: "en-US",
    timezoneId: "America/Edmonton" // Calgary timezone
  });

  const page = await context.newPage();

  // Убрать Playwright fingerprint
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  try {
    console.log("[LinkedIn Creator] Opening LinkedIn registration...");
    await page.goto("https://www.linkedin.com/signup", {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });
    await humanDelay(3000, 5000);
    await page.screenshot({ path: "/tmp/li-step1.png" });
    console.log("[LinkedIn Creator] Step 1 screenshot: /tmp/li-step1.png");

    // Email поле — пробуем несколько селекторов
    const emailSel = await page.waitForSelector(
      "#email-address, input[name='session_key'], input[type='email'], input[autocomplete='email']",
      { timeout: 15000 }
    );
    await emailSel.fill(email.address);
    await humanDelay(500, 1500);

    // Password поле
    const passSel = await page.waitForSelector(
      "#password, input[name='session_password'], input[type='password']",
      { timeout: 10000 }
    );
    await passSel.fill(password);
    await humanDelay(500, 1500);

    // Нажать Submit
    await page.click(
      '[data-id="join-form-submit"], button[type="submit"], .join-form__submit-btn'
    );
    await humanDelay(3000, 5000);
    await page.screenshot({ path: "/tmp/li-step2.png" });
    console.log("[LinkedIn Creator] Step 2 screenshot: /tmp/li-step2.png | URL:", page.url());

    // Имя и Фамилия — LinkedIn может показать сразу или на новой странице
    const firstNameEl = await page.waitForSelector(
      "#first-name, input[name='firstName'], input[id*='first']",
      { timeout: 20000 }
    );
    await firstNameEl.fill(name.first);
    await humanDelay(300, 800);

    const lastNameEl = await page.$("#last-name, input[name='lastName'], input[id*='last']");
    if (lastNameEl) {
      await lastNameEl.fill(name.last);
      await humanDelay(500, 1500);
    }

    // Кнопка продолжить
    await page.click(
      '[data-id="sign-in-form__submit-btn"], button[type="submit"], .join-form__form-body__submit'
    );
    await humanDelay(3000, 5000);
    await page.screenshot({ path: "/tmp/li-step3.png" });
    console.log("[LinkedIn Creator] Step 3 screenshot: /tmp/li-step3.png | URL:", page.url());

    // Проверяем не появилась ли CAPTCHA (LinkedIn показывает в попапе "Security verification")
    const captchaFrame = await page.$("iframe[src*='recaptcha'], iframe[title*='reCAPTCHA']").catch(() => null);
    if (captchaFrame) {
      console.log("[LinkedIn Creator] reCAPTCHA popup detected — solving via 2captcha...");

      // Получаем sitekey из iframe src или из data-атрибутов страницы
      const frameSrc = await captchaFrame.getAttribute("src") || "";
      const siteKeyMatch = frameSrc.match(/[?&]k=([^&]+)/)
        || frameSrc.match(/[?&]sitekey=([^&]+)/);

      let siteKey = siteKeyMatch ? siteKeyMatch[1] : null;

      // Если не нашли в iframe, ищем в DOM
      if (!siteKey) {
        siteKey = await page.evaluate(() => {
          const el = document.querySelector(".g-recaptcha[data-sitekey], [data-sitekey]");
          return el ? el.getAttribute("data-sitekey") : null;
        });
      }

      // Step 1: Try clicking the checkbox directly in the iframe (cleanest approach)
      console.log("[LinkedIn Creator] Trying to click reCAPTCHA checkbox directly...");
      try {
        const frames = page.frames();
        const recaptchaFrame = frames.find(f => f.url().includes("recaptcha") || f.url().includes("google.com/recaptcha"));
        if (recaptchaFrame) {
          await recaptchaFrame.click(".recaptcha-checkbox-border", { timeout: 5000 });
          await humanDelay(4000, 7000); // Wait to see if Google passes it
          await page.screenshot({ path: "/tmp/li-after-click.png" });
        }
      } catch (e) {
        console.log("[LinkedIn Creator] Direct click failed:", e.message);
      }

      // Step 2: Use 2captcha token injection as backup
      if (siteKey) {
        console.log(`[LinkedIn Creator] Injecting 2captcha token (siteKey: ${siteKey.slice(0, 20)}...)`);
        const token = await solveRecaptchaV2(siteKey, page.url());

        // Inject token and fire all callbacks
        await page.evaluate(t => {
          // Set hidden textarea values
          document.querySelectorAll("textarea[name='g-recaptcha-response']").forEach(f => {
            f.value = t;
            f.innerHTML = t;
          });
          // Fire grecaptcha callbacks
          try {
            const cfgs = window.___grecaptcha_cfg?.clients || {};
            Object.values(cfgs).forEach(client => {
              const cb = Object.values(client).find(v => v?.callback);
              if (cb?.callback) cb.callback(t);
            });
          } catch {}
        }, token);

        await humanDelay(2000, 3000);
        await page.screenshot({ path: "/tmp/li-captcha-solved.png" });
        console.log("[LinkedIn Creator] Post-captcha screenshot: /tmp/li-captcha-solved.png | URL:", page.url());
      }
    }

    // Ждём email верификацию
    console.log("[LinkedIn Creator] Waiting for verification email...");
    const emailMsg = await waitForEmail(email.token, 120000);
    const verifyLink = extractVerificationLink(emailMsg);

    if (verifyLink) {
      console.log("[LinkedIn Creator] Verification link found, clicking...");
      await page.goto(verifyLink, { waitUntil: "networkidle" });
      await humanDelay(3000, 5000);
    } else {
      // LinkedIn иногда показывает код в UI вместо ссылки
      const codeMatch = (emailMsg.text || "").match(/\b(\d{6})\b/);
      if (codeMatch) {
        console.log(`[LinkedIn Creator] Verification code: ${codeMatch[1]}`);
        await page.fill("[id*='verification'], [placeholder*='code']", codeMatch[1]);
        await page.keyboard.press("Enter");
        await humanDelay(2000, 4000);
      }
    }

    // Получить li_at cookie
    const cookies = await context.cookies("https://www.linkedin.com");
    const liAt = cookies.find(c => c.name === "li_at");

    if (!liAt) throw new Error("li_at cookie not found — account may not be created properly");

    console.log("[LinkedIn Creator] ✅ Account created successfully!");
    console.log(`[LinkedIn Creator] Email: ${email.address}`);
    console.log(`[LinkedIn Creator] li_at: ${liAt.value.slice(0, 40)}...`);

    // Сохранить аккаунт
    let accounts = [];
    if (existsSync(ACCOUNTS_FILE)) {
      try { accounts = JSON.parse(readFileSync(ACCOUNTS_FILE, "utf-8")); } catch {}
    }
    accounts.push({
      email: email.address,
      emailPassword: email.password,
      linkedinPassword: password,
      name: `${name.first} ${name.last}`,
      li_at: liAt.value,
      createdAt: new Date().toISOString(),
      status: "active"
    });
    writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts, null, 2));
    console.log(`[LinkedIn Creator] Saved to ${ACCOUNTS_FILE}`);

    await browser.close();
    return { email: email.address, li_at: liAt.value };

  } catch (err) {
    await page.screenshot({ path: `/tmp/linkedin-creator-error-${Date.now()}.png` });
    await browser.close();
    throw err;
  }
}

// CLI запуск
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createLinkedInAccount()
    .then(result => {
      console.log("\n✅ Done!");
      console.log("Add to .env:");
      console.log(`LINKEDIN_LI_AT=${result.li_at}`);
    })
    .catch(err => {
      console.error("❌ Failed:", err.message);
      process.exit(1);
    });
}
