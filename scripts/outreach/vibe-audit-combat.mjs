/**
 * Vibe Audit Combat Batch
 *
 * Channel + offer with highest first-payment probability (as of Apr 19 2026):
 *   Offer:   Vibe Code Audit - $1,500-2,500 CAD
 *   Target:  Solo SaaS founders who vibe-coded their product (Cursor/Lovable/Bolt/Claude)
 *   Channel: Reddit comment (confirmed strongest) + cold email (HN Show HN founders)
 *
 * What this script does:
 *   1. Sends pre-approved cold email to Joe at joe@breezepdf.com
 *   2. Sends 5 Reddit action packets to Telegram (ready to copy-paste as comments)
 *   3. Logs run to .data/combat-log.json
 *
 * Usage:
 *   node scripts/outreach/vibe-audit-combat.mjs            # live
 *   node scripts/outreach/vibe-audit-combat.mjs --dry-run  # preview
 */

import nodemailer from "nodemailer";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const LOG_PATH = resolve(ROOT, ".data/combat-log.json");
const ENV_PATH = resolve(ROOT, "apps/api/.env");

// Load env
const env = Object.fromEntries(
  readFileSync(ENV_PATH, "utf-8")
    .split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const SMTP_HOST = env.OUTREACH_SMTP_HOST || "mail.privateemail.com";
const SMTP_PORT = parseInt(env.OUTREACH_SMTP_PORT || "587");
const SMTP_USER = env.OUTREACH_EMAIL;
const SMTP_PASS = env.OUTREACH_PASSWORD;
const TG_TOKEN = env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = env.TELEGRAM_CHAT_ID;

// Pre-approved cold email - Joe at BreezePDF
// Source: sandbox-review/outreach-joe-breezepdf.md
// Status at script creation: NOT YET SENT
const JOE_EMAIL = {
  to: "joe@breezepdf.com",
  subject: "BreezePDF - the redaction bug in your HN thread",
  body: `Hi Joe,

Saw the Show HN for BreezePDF last month - genuinely impressive to build a full in-browser PDF editor solo, especially with desktop and CLI on top of it.

One thing in the comments stood out. A user named Lockal verified via pdfcrowd.com that the redaction tool overlays rectangles but does not remove the underlying content from the file - original pixels are stored twice, once intact. In a product whose entire pitch is privacy, that is the one issue I would want closed before it surfaces in a security review or tech press.

I do Vibe Code Audits for solo founders in exactly this shape - one week, fixed scope, async only. Here is what it covers:

- Auth and permission gaps (RBAC, row-level isolation)
- Silent failure paths on critical flows (payment, data handling)
- Data exposure bugs like the redaction issue
- Schema / query patterns that lock under real load
- Secrets and key scoping

Day 2-3 I deliver a written audit of what is fragile, including root cause of the redaction issue. Then I apply fixes to the highest-risk items. $1,500-2,500 CAD depending on stack complexity. Single payment after the audit is in your hands. Scope is locked in writing before we start.

If this is worth exploring: send me your stack (framework, storage layer, auth setup, desktop packaging) and the thing you are most afraid will break next. I will respond within 24h on fit and price.

- Kirill
kirill@launchsoloai.com
launchsoloai.com/audit`,
};

// Reddit combat targets - comment-first approach (memory rule: comment-first-not-dm)
// Kirill posts these manually. Script sends ready-to-post instructions via Telegram.
const REDDIT_TARGETS = [
  {
    subreddit: "r/vibecoding",
    search_url: "https://www.reddit.com/r/vibecoding/search/?q=broken+OR+bug+OR+crash+OR+security+OR+help&sort=new&t=month",
    qualify: "Post in last 7 days + mentions specific broken feature + has real users (\"my users\", \"paying customers\", built with Cursor/Lovable/Bolt/Claude)",
    template: `This pattern shows up in almost every Cursor/Lovable build - [INSERT their specific issue in 1 sentence].

What usually causes it: [INSERT technical root cause, e.g. "Lovable generates auth middleware that checks roles on the frontend only - backend routes stay unprotected"].

I do focused audits on vibe-coded SaaS - specifically for bugs like this that look cosmetic but have deeper root causes. If useful, I can tell you where to look first. DM me or kirill@launchsoloai.com.`,
  },
  {
    subreddit: "r/cursor",
    search_url: "https://www.reddit.com/r/cursor/search/?q=production+OR+users+OR+bug+OR+fix&sort=new&t=week",
    qualify: "Someone who shipped a product and has a real bug. Not a \"how do I use cursor\" question. Must mention users or production.",
    template: `This is one of the most common issues in Cursor-built products - [INSERT their specific problem].

Root cause is usually [INSERT specific technical reason]. Easy to miss in development because it only fails under [specific condition, e.g. concurrent users, real payment flow, etc.].

I run Vibe Code Audits for founders who have shipped and want to close the gaps before real load hits. DM me if you want a quick take on what else might be fragile.`,
  },
  {
    subreddit: "r/lovable",
    search_url: "https://www.reddit.com/r/lovable/search/?q=bug+OR+broken+OR+users+OR+production&sort=new&t=week",
    qualify: "r/lovable founders are often less technical - high willingness to pay. Look for posts about bugs affecting real users. The less technical they sound, the more likely they need help.",
    template: `This happens often in Lovable builds - [INSERT their specific issue].

The underlying cause: Lovable's generated code [INSERT relevant detail, e.g. "doesn't set up row-level security on Supabase tables by default"]. Works in development, breaks when real users hit it.

If you want a second set of eyes on what else might break before it costs you users, I do 1-week async audits for vibe-coded products. kirill@launchsoloai.com`,
  },
  {
    subreddit: "r/SaaS",
    search_url: "https://www.reddit.com/r/SaaS/search/?q=vibe+code+OR+cursor+OR+lovable+broken+OR+security&sort=new&t=month",
    qualify: "Higher budget here. Look for posts mentioning MRR, user count, or specific technical pain from an AI-built product. Revenue signals = better prospect.",
    template: `[INSERT 1 sentence that shows you read their post and understand the specific problem].

That particular issue in vibe-coded stacks usually comes from [INSERT specific technical reason]. It is solvable but you need to look at [specific place in the codebase, e.g. "your RLS policies" or "Stripe webhook handler"].

I do Vibe Code Audits - one week, fixed price, async. Covers exactly this category. DM me if you want a quick scoping call.`,
  },
  {
    subreddit: "r/microsaas",
    search_url: "https://www.reddit.com/r/microsaas/new/",
    qualify: "Any post about a vibe-coded product with real users + any technical problem. Key signals: mentions MRR, user count, paying customers, or \"something broke in production\".",
    template: `[INSERT personalized observation about their specific product or problem].

The pattern you are describing - [INSERT their pain in their words] - is one of the failure modes I see in almost every vibe-coded micro-SaaS at this stage. The fix is [INSERT direction, enough to be useful but not a full solution].

If you want to close this properly before it costs users: I run 1-week async audits for exactly this. $1,500 CAD flat. kirill@launchsoloai.com`,
  },
];

// Telegram send with 4096 char limit enforcement (memory rule: telegram-4096-limit)
async function tgSend(text) {
  if (!TG_TOKEN || !CHAT_ID) return;
  const MAX = 4000;
  const chunks = [];
  for (let i = 0; i < text.length; i += MAX) chunks.push(text.slice(i, i + MAX));
  for (const chunk of chunks) {
    try {
      await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: CHAT_ID, text: chunk, parse_mode: "HTML" }),
      });
    } catch (e) {
      console.warn("[VibeCombat] Telegram send failed:", e.message);
    }
  }
}

function loadLog() {
  if (existsSync(LOG_PATH)) {
    try { return JSON.parse(readFileSync(LOG_PATH, "utf-8")); } catch {}
  }
  return [];
}

function saveLog(entry) {
  const log = loadLog();
  log.push(entry);
  writeFileSync(LOG_PATH, JSON.stringify(log, null, 2));
}

async function sendJoeEmail(transport, dryRun) {
  if (dryRun) {
    console.log("[VibeCombat] DRY RUN - Joe email:");
    console.log(`  To: ${JOE_EMAIL.to}`);
    console.log(`  Subject: ${JOE_EMAIL.subject}`);
    console.log(`  Body (first 200): ${JOE_EMAIL.body.slice(0, 200)}...`);
    return { sent: false, dry: true };
  }
  try {
    const info = await transport.sendMail({
      from: `"Kirill D." <${SMTP_USER}>`,
      to: JOE_EMAIL.to,
      subject: JOE_EMAIL.subject,
      text: JOE_EMAIL.body,
    });
    console.log(`[VibeCombat] Joe email sent: ${info.messageId}`);
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    console.error(`[VibeCombat] Joe email failed: ${err.message}`);
    return { sent: false, error: err.message };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");

  console.log("=".repeat(60));
  console.log("[VibeCombat] OFFER: Vibe Code Audit - $1,500-2,500 CAD");
  console.log("[VibeCombat] TARGET: Solo SaaS founders (Cursor/Lovable/Bolt/Claude)");
  console.log("[VibeCombat] MODE:", dryRun ? "DRY RUN" : "LIVE");
  console.log("=".repeat(60));

  const runAt = new Date().toISOString();
  let joeResult = { sent: false, skipped: true };

  // STEP 1: Send Joe email
  if (!SMTP_USER || !SMTP_PASS) {
    console.warn("[VibeCombat] SMTP not configured - skipping email");
  } else {
    let transport = null;
    if (!dryRun) {
      transport = nodemailer.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: false,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
        tls: { rejectUnauthorized: false },
      });
      try {
        await transport.verify();
        console.log("[VibeCombat] SMTP verified:", SMTP_USER);
      } catch (e) {
        console.error("[VibeCombat] SMTP verify failed:", e.message);
        transport = null;
      }
    }
    if (dryRun || transport) {
      joeResult = await sendJoeEmail(transport, dryRun);
    }
  }

  // STEP 2: Send Telegram action packet
  const joeStatus = dryRun
    ? "DRY RUN (not sent)"
    : joeResult.sent
    ? "SENT"
    : `FAILED: ${joeResult.error || "smtp not configured"}`;

  // Header message
  await tgSend(
    `<b>Vibe Audit Combat - ${new Date().toLocaleDateString("ru-RU")}</b>\n\n` +
    `Offer: Vibe Code Audit $1,500-2,500 CAD\n` +
    `Niche: Solo SaaS vibe-coders (Cursor/Lovable/Bolt/Claude)\n\n` +
    `<b>Email:</b> joe@breezepdf.com (BreezePDF) - ${joeStatus}\n\n` +
    `<b>Next: post 5 Reddit comments (30 min total)</b>\n` +
    `Each comment = personalized + shows you read their post. No bulk spam.\n` +
    `Reply in thread first. DM only after they engage.`
  );

  // One message per Reddit target
  for (let i = 0; i < REDDIT_TARGETS.length; i++) {
    const t = REDDIT_TARGETS[i];
    await tgSend(
      `<b>${i + 1}/5 - ${t.subreddit}</b>\n\n` +
      `<b>Find post:</b>\n${t.search_url}\n\n` +
      `<b>Qualify (2+ must be true):</b>\n${t.qualify}\n\n` +
      `<b>Comment (personalize [BRACKETS]):</b>\n${t.template}`
    );
  }

  // Action close
  await tgSend(
    `<b>After 5 comments posted:</b>\n\n` +
    `- Check replies every 2-3h today\n` +
    `- Reply in thread, then DM with offer\n` +
    `- If Joe replies: respond same day\n\n` +
    `Target: 1 audit booked by Apr 25\n` +
    `Inbound: kirill@launchsoloai.com`
  );

  // STEP 3: Log run
  saveLog({
    run_at: runAt,
    offer: "vibe_code_audit",
    mode: dryRun ? "dry_run" : "live",
    email: {
      target: "joe@breezepdf.com",
      product: "BreezePDF",
      subject: JOE_EMAIL.subject,
      status: dryRun ? "dry_run" : joeResult.sent ? "sent" : "failed",
      error: joeResult.error || null,
    },
    reddit: {
      targets: REDDIT_TARGETS.map(t => t.subreddit),
      action: "manual_comment_required",
      drafts_sent_to_telegram: true,
    },
  });

  console.log(`\n[VibeCombat] Done.`);
  console.log(`  Email (Joe): ${dryRun ? "dry run" : joeResult.sent ? "sent" : "failed"}`);
  console.log(`  Reddit drafts: sent to Telegram (${REDDIT_TARGETS.length} subreddits)`);
  console.log(`  Log: ${LOG_PATH}`);
}

main().catch(err => {
  console.error("[VibeCombat] Fatal:", err);
  process.exit(1);
});
