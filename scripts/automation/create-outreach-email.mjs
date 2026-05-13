/**
 * Creates a professional Outlook/Hotmail account for cold outreach
 * Outlook doesn't require phone for first account, handles SMTP well
 */
import { chromium } from "@playwright/test";
import { waitForEmail, extractVerificationLink } from "./temp-email.mjs";
import { solveRecaptchaV2, solveHCaptcha } from "./captcha-solver.mjs";
import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function humanDelay(min = 800, max = 2500) {
  await new Promise(r => setTimeout(r, min + Math.random() * (max - min)));
}

async function createOutlookAccount() {
  // Generic professional names — NOT the real owner's name
  const profiles = [
    { first: "Alex", last: "Carter", username: "alex.carter.consulting" },
    { first: "Jordan", last: "Mitchell", username: "jordan.mitchell.ca" },
    { first: "Morgan", last: "Davis", username: "morgan.davis.pro" },
    { first: "Taylor", last: "Brooks", username: "taylor.brooks.ops" },
  ];
  const profile = profiles[Math.floor(Math.random() * profiles.length)];
  const password = `Automate${Date.now().toString().slice(-6)}!Ca`;

  console.log(`[EmailCreator] Creating Outlook: ${profile.username}@outlook.com`);

  const browser = await chromium.launch({
    headless: false,
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"]
  });

  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
    locale: "en-CA",
    timezoneId: "America/Edmonton"
  });

  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });

  try {
    // Direct URL that lands on the @outlook.com creation flow
    await page.goto(
      "https://signup.live.com/signup?lic=1&mkt=en-US&uiflavor=web&wreply=https%3A%2F%2Foutlook.live.com%2Fowa%2F%3Fnlp%3D1%26signup%3D1&id=292841",
      { waitUntil: "domcontentloaded", timeout: 60000 }
    );
    await humanDelay(2000, 3000);
    await page.screenshot({ path: "/tmp/outlook-step1.png" });
    console.log("[EmailCreator] Step 1 URL:", page.url());

    // The URL already lands on @outlook.com creation mode — just find the username field
    // The page shows: [username input] @outlook.com [dropdown]
    const emailInput = await page.waitForSelector(
      "input[name='MemberName'], #MemberName, input[type='text'], input[type='email']",
      { timeout: 15000 }
    );
    await emailInput.fill(profile.username);
    await humanDelay(500, 1200);
    await page.click("input[type='submit'], button[type='submit'], #iSignupAction");
    await humanDelay(2000, 3000);
    await page.screenshot({ path: "/tmp/outlook-step2.png" });

    // Password
    const passInput = await page.waitForSelector(
      "input[type='password'], input[name='Password']",
      { timeout: 15000 }
    );
    await passInput.fill(password);
    await humanDelay(500, 1000);
    await page.click("input[type='submit'], button[type='submit'], #iSignupAction");
    await humanDelay(2000, 3000);

    // Birth date (required by Microsoft)
    // New Microsoft UI uses Fluent UI custom dropdowns for Month and Day
    // IDs: BirthMonthDropdown, BirthDayDropdown; Year: input[name='BirthYear']

    // Month dropdown — label intercepts pointer events, use dispatchEvent to bypass
    await page.locator("#BirthMonthDropdown").dispatchEvent("click");
    await humanDelay(500, 1000);
    // Options appear as [role='option'] in an open listbox — pick June
    const juneOpt = await page.waitForSelector(
      "[role='option'][data-value='6'], [role='listbox'] [role='option']:nth-child(6)",
      { timeout: 5000 }
    ).catch(() => null);
    if (juneOpt) await juneOpt.click();
    else await page.locator("[role='option']").filter({ hasText: "June" }).first().dispatchEvent("click");
    await humanDelay(400, 800);

    // Day dropdown
    await page.locator("#BirthDayDropdown").dispatchEvent("click");
    await humanDelay(500, 1000);
    const day15Opt = await page.waitForSelector(
      "[role='option'][data-value='15']",
      { timeout: 5000 }
    ).catch(() => null);
    if (day15Opt) await day15Opt.click();
    else await page.locator("[role='option']").filter({ hasText: /^15$/ }).first().dispatchEvent("click");
    await humanDelay(400, 800);

    // Year input
    const yearEl = await page.$("input[name='BirthYear'], input[aria-label*='year' i]");
    if (yearEl) { await yearEl.click({ clickCount: 3 }); await yearEl.fill("1988"); }
    await humanDelay(500, 1000);

    await page.screenshot({ path: "/tmp/outlook-birthdate.png" });
    await page.click("input[type='submit'], button[type='submit'], #iSignupAction");
    await humanDelay(2000, 4000);

    await page.screenshot({ path: "/tmp/outlook-step3.png" });
    console.log("[EmailCreator] Step 3 URL:", page.url());

    // Name step — Microsoft shows this AFTER birthdate in the new flow
    // Dump inputs to find actual selectors
    const nameInputs = await page.$$("input[type='text'], input:not([type])");
    console.log("[EmailCreator] Text inputs found:", nameInputs.length);
    if (nameInputs.length >= 1) {
      const inputDetails = await page.evaluate(() =>
        [...document.querySelectorAll("input[type='text'], input:not([type])")].map(i => ({
          id: i.id, name: i.name, placeholder: i.placeholder,
          ariaLabel: i.getAttribute("aria-label"), type: i.type
        }))
      );
      console.log("[EmailCreator] Input details:", JSON.stringify(inputDetails));
    }
    const firstInput = await page.$(
      "input[name='FirstName'], #FirstName, " +
      "input[aria-label='First name'], input[placeholder='First name'], " +
      "input[aria-label*='first' i]"
    );
    if (!firstInput && nameInputs.length >= 1) {
      // Fallback: use first two text inputs on page (they are First/Last name)
      console.log("[EmailCreator] Using positional fallback for name fields");
      await nameInputs[0].fill(profile.first);
      await humanDelay(300, 700);
      if (nameInputs.length >= 2) await nameInputs[1].fill(profile.last);
      await humanDelay(500, 1000);
      await page.screenshot({ path: "/tmp/outlook-name.png" });
      await page.click("input[type='submit'], button[type='submit'], #iSignupAction");
      await humanDelay(3000, 5000);
    } else if (firstInput) {
      console.log("[EmailCreator] Name step detected, filling...");
      await firstInput.fill(profile.first);
      await humanDelay(300, 700);
      const lastInput = await page.$("input[name='LastName'], #LastName, input[aria-label='Last name'], input[placeholder='Last name']");
      if (lastInput) await lastInput.fill(profile.last);
      await humanDelay(500, 1000);
      await page.screenshot({ path: "/tmp/outlook-name.png" });
      await page.click("input[type='submit'], button[type='submit'], #iSignupAction");
      await humanDelay(3000, 5000);
    }

    // Handle Microsoft "Let's prove you're human" — Arkose FunCaptcha (may be in iframe)
    await page.screenshot({ path: "/tmp/outlook-precaptcha.png" });
    const allFrames = page.frames();
    console.log("[EmailCreator] Total frames:", allFrames.length, allFrames.map(f => f.url().slice(0, 80)));

    // Find the Arkose/FunCaptcha frame
    const arkoseFrame = allFrames.find(f =>
      f.url().includes("arkoselabs") || f.url().includes("funcaptcha") ||
      f.url().includes("enforcement") || f.url().includes("fc/gc")
    );

    if (arkoseFrame) {
      console.log("[EmailCreator] Arkose frame found:", arkoseFrame.url());
      // Try press and hold inside the frame
      const holdBtn = await arkoseFrame.$("button:has-text('Press and hold'), button.challenge-btn, button[class*='hold']");
      if (holdBtn) {
        const btnBox = await holdBtn.boundingBox();
        if (btnBox) {
          console.log("[EmailCreator] Simulating press-and-hold inside Arkose frame...");
          await arkoseFrame.hover("button:has-text('Press and hold')");
          await page.mouse.down();
          await humanDelay(5000, 7000);
          await page.mouse.up();
          await humanDelay(2000, 3000);
          await page.screenshot({ path: "/tmp/outlook-after-hold.png" });
          console.log("[EmailCreator] After hold URL:", page.url());
        }
      }
    } else {
      // Challenge might be on main page or inside challenge iframe with different URL
      const pressHoldBtn = await page.$("button:has-text('Press and hold')");
      if (pressHoldBtn) {
        console.log("[EmailCreator] Press-and-hold button on main page");
        const btnBox = await pressHoldBtn.boundingBox();
        if (btnBox) {
          await page.mouse.move(btnBox.x + btnBox.width / 2, btnBox.y + btnBox.height / 2);
          await page.mouse.down();
          await humanDelay(5000, 7000);
          await page.mouse.up();
          await humanDelay(2000, 3000);
          await page.screenshot({ path: "/tmp/outlook-after-hold.png" });
        }
      } else {
        console.log("[EmailCreator] No press-and-hold button found on any frame");
      }
    }

    // Handle iframe-based CAPTCHA (reCAPTCHA)
    const captchaFrame = await page.$("iframe[src*='arkoselabs'], iframe[src*='funcaptcha'], iframe[src*='recaptcha']").catch(() => null);
    if (captchaFrame) {
      console.log("[EmailCreator] iframe CAPTCHA detected, solving...");
      const src = await captchaFrame.getAttribute("src") || "";
      const siteKeyMatch = src.match(/[?&](?:k|sitekey|pkey)=([^&]+)/);
      if (siteKeyMatch) {
        const token = await solveRecaptchaV2(siteKeyMatch[1], page.url());
        await page.evaluate(t => {
          document.querySelectorAll("textarea[name='g-recaptcha-response'], input[name='captcha']")
            .forEach(el => { el.value = t; });
        }, token);
        await page.click("input[type='submit'], button[type='submit']");
        await humanDelay(3000, 5000);
      }
    }

    await page.screenshot({ path: "/tmp/outlook-done.png" });
    console.log("[EmailCreator] Final URL:", page.url());

    // Check if account was created - look for inbox or welcome indicators
    const currentUrl = page.url();
    const success = currentUrl.includes("outlook.com") || currentUrl.includes("office.com")
      || await page.$(".icon-signout, [data-icon-name='SignOut']").catch(() => null);

    if (success) {
      console.log("✅ Outlook account created!");
      const result = {
        email: `${profile.username}@outlook.com`,
        password,
        name: `${profile.first} ${profile.last}`,
        smtp: { host: "smtp-mail.outlook.com", port: 587, secure: false },
        imap: { host: "outlook.office365.com", port: 993, secure: true },
        createdAt: new Date().toISOString()
      };
      writeFileSync(
        resolve(__dirname, "../../.data/outreach-email.json"),
        JSON.stringify(result, null, 2)
      );
      console.log("Saved to .data/outreach-email.json");
      await browser.close();
      return result;
    } else {
      console.log("[EmailCreator] Account creation status unclear — check screenshots");
      await browser.close();
      return null;
    }

  } catch (err) {
    await page.screenshot({ path: `/tmp/outlook-error-${Date.now()}.png` }).catch(() => {});
    await browser.close();
    throw err;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createOutlookAccount()
    .then(r => r ? console.log("\n✅ Email ready:", r.email) : console.log("⚠️ Check screenshots"))
    .catch(e => { console.error("❌", e.message); process.exit(1); });
}

export { createOutlookAccount };
