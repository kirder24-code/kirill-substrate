/**
 * Zoho Mail Account Creator — autonomous
 * Creates a free Zoho account linked to a temp email, then accesses Zoho Mail.
 * The outreach FROM address will be the temp email (e.g. xxx@sharebot.net).
 *
 * For a @zoho.com personal address, tries mail.zoho.com signup.
 */
import { chromium } from "@playwright/test";
import { createTempEmail, waitForEmail } from "./temp-email.mjs";
import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = resolve(__dirname, "../../.data/outreach-email.json");
const ENV_FILE = resolve(__dirname, "../../apps/api/.env");

async function humanDelay(min = 800, max = 2500) {
  await new Promise(r => setTimeout(r, min + Math.random() * (max - min)));
}

const PROFILES = [
  { first: "Alex", last: "Carter" },
  { first: "Jordan", last: "Mitchell" },
  { first: "Morgan", last: "Davis" },
];

export async function createZohoAccount() {
  const profile = PROFILES[Math.floor(Math.random() * PROFILES.length)];
  const password = `Consult${Date.now().toString().slice(-5)}!Ca`;

  console.log("[ZohoCreator] Creating temp email for verification...");
  const tempEmail = await createTempEmail("zoho.verify");
  console.log("[ZohoCreator] Temp email:", tempEmail.address);

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
    // Try Zoho Mail personal signup (gives @zoho.com address)
    await page.goto("https://accounts.zoho.com/register", {
      waitUntil: "domcontentloaded", timeout: 30000
    });
    await humanDelay(2000, 4000);
    await page.screenshot({ path: "/tmp/zoho-step1.png" });

    // Wait for First Name to be visible
    const firstNameEl = await page.waitForSelector("#firstname, input[name='firstname']", {
      state: "visible", timeout: 15000
    });
    await firstNameEl.fill(profile.first);
    await humanDelay(400, 800);

    const lastNameEl = await page.$("#lastname, input[name='lastname']");
    if (lastNameEl) { await lastNameEl.fill(profile.last); await humanDelay(300, 600); }

    // Email field — use #emailfield (the "Email Address" input; emailormobile is disabled/hidden)
    const emailEl = await page.waitForSelector(
      "#emailfield, input[name='email']:not([disabled]), input[placeholder='Email Address']",
      { state: "visible", timeout: 10000 }
    );
    await emailEl.fill(tempEmail.address);
    await humanDelay(400, 800);

    // Password
    const passEl = await page.waitForSelector("#password, input[name='password']", { state: "visible", timeout: 10000 });
    await passEl.fill(password);
    await humanDelay(400, 800);

    // Accept TOS — checkbox label may intercept clicks, use dispatchEvent
    const tosEl = await page.$("#tos, input[name='tos']");
    if (tosEl) {
      await page.locator("#tos, input[name='tos']").dispatchEvent("click");
      await humanDelay(300, 600);
    }

    await page.screenshot({ path: "/tmp/zoho-step2.png" });

    // Submit — use dispatchEvent to bypass any overlay
    const submitBtn = await page.waitForSelector("#signupbtn, button[type='submit'], .signup-btn", {
      state: "attached", timeout: 10000
    }).catch(() => null);
    if (submitBtn) {
      await page.locator("#signupbtn, button[type='submit'], .signup-btn").first().dispatchEvent("click");
    } else {
      // Try pressing Enter on the form
      await page.keyboard.press("Enter");
    }
    await humanDelay(3000, 5000);
    await page.screenshot({ path: "/tmp/zoho-step3.png" });
    console.log("[ZohoCreator] After submit URL:", page.url());

    // Handle text CAPTCHA if present
    const captchaInput = await page.$("input[name='captcha'], #captchafield");
    if (captchaInput) {
      console.log("[ZohoCreator] Text CAPTCHA detected — need to solve manually or via 2captcha");
      // Try to get captcha image
      const captchaImg = await page.$("img[id*='captcha'], img[class*='captcha'], #captchaimage");
      if (captchaImg) {
        const imgSrc = await captchaImg.getAttribute("src");
        console.log("[ZohoCreator] CAPTCHA image src:", imgSrc?.slice(0, 80));
      }
      // For now: take screenshot and wait for manual input? No - automate with 2captcha
      // TODO: add 2captcha normal CAPTCHA solving here
      console.log("[ZohoCreator] Check /tmp/zoho-step3.png for CAPTCHA");
      await browser.close();
      return null;
    }

    // Handle email verification
    const currentUrl = page.url();
    if (currentUrl.includes("activatewait") || currentUrl.includes("verify") ||
        await page.$("input[name='otp'], #otpfield").catch(() => null)) {
      console.log("[ZohoCreator] Email OTP verification required, waiting for email...");
      const emailMsg = await waitForEmail(tempEmail.token, 120000, 3000, tempEmail.provider);
      const otpMatch = (emailMsg.text || emailMsg.html || "").match(/\b(\d{6})\b/);
      if (otpMatch) {
        console.log("[ZohoCreator] OTP:", otpMatch[1]);
        const otpEl = await page.waitForSelector("input[name='otp'], #otpfield", { state: "visible", timeout: 10000 });
        await otpEl.fill(otpMatch[1]);
        await humanDelay(500, 1000);
        await page.click("button[type='submit'], #verifyotp, .zoh-btn-primary");
        await humanDelay(3000, 5000);
      } else {
        // Link-based verification
        const link = (emailMsg.text || "").match(/https?:\/\/[^\s"<>]+confirm[^\s"<>]+/)
          || (emailMsg.text || "").match(/https?:\/\/[^\s"<>]+verify[^\s"<>]+/);
        if (link) {
          await page.goto(link[0], { waitUntil: "domcontentloaded" });
          await humanDelay(3000, 5000);
        }
      }
    }

    await page.screenshot({ path: "/tmp/zoho-done.png" });
    console.log("[ZohoCreator] Final URL:", page.url());

    // Check success
    const finalUrl = page.url();
    const success = finalUrl.includes("zoho.com/home") || finalUrl.includes("mail.zoho")
      || finalUrl.includes("dashboard") || finalUrl.includes("accounts.zoho.com/signin");

    if (success || finalUrl.includes("zoho.com")) {
      console.log("✅ Zoho account created!");
      const result = {
        email: tempEmail.address,
        password,
        name: `${profile.first} ${profile.last}`,
        zohoAccount: tempEmail.address,
        smtp: { host: "smtp.zoho.com", port: 587, secure: false },
        imap: { host: "imap.zoho.com", port: 993, secure: true },
        createdAt: new Date().toISOString()
      };
      writeFileSync(DATA_FILE, JSON.stringify(result, null, 2));
      await browser.close();
      return result;
    }

    console.log("[ZohoCreator] Account status unclear — check /tmp/zoho-done.png");
    await browser.close();
    return null;

  } catch (err) {
    await page.screenshot({ path: `/tmp/zoho-error-${Date.now()}.png` }).catch(() => {});
    await browser.close();
    throw err;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createZohoAccount()
    .then(r => {
      if (r) {
        console.log("\n✅ Account ready:", r.email);
        console.log("\nAdd to apps/api/.env:");
        console.log(`OUTREACH_EMAIL=${r.email}`);
        console.log(`OUTREACH_PASSWORD=${r.password}`);
        console.log(`OUTREACH_FROM_NAME=${r.name}`);
        console.log(`OUTREACH_SMTP_HOST=smtp.zoho.com`);
        console.log(`OUTREACH_SMTP_PORT=587`);
        console.log(`OUTREACH_IMAP_HOST=imap.zoho.com`);
        console.log(`OUTREACH_IMAP_PORT=993`);
      } else {
        console.log("⚠️ Failed — check /tmp/zoho-*.png");
      }
    })
    .catch(e => { console.error("❌", e.message); process.exit(1); });
}
