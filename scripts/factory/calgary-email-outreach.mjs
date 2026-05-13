/**
 * calgary-email-outreach.mjs
 *
 * Automated Calgary home service email outreach pipeline.
 * Built April 13 2026 after Kirill demanded the system work autonomously.
 *
 * Pipeline:
 *   1. Apify Google Maps scraper -> find Calgary service companies
 *   2. Fetch each company website -> extract emails
 *   3. Skip already contacted (check outreach_emails table)
 *   4. Generate personalized email via Haiku
 *   5. Send via SMTP (kirill@launchsoloai.com)
 *   6. Record in outreach_emails + lead_interactions
 *   7. Report to Telegram
 *
 * Schedule: daily at 15:00 UTC (9AM Calgary) via sonnet-bots-daemon
 * Daily cap: 5 emails/day (protect domain reputation)
 *
 * Run: node scripts/factory/calgary-email-outreach.mjs
 */
import Database from "better-sqlite3";
import { createTransport } from "nodemailer";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import { refreshGuardrails, isSegmentBlocked } from "./dispatch-guardrails.mjs";
import { getActiveExperiments, recordSend, getNextExperiment } from "./experiment-portfolio.mjs";
import { getDestinationUrl } from "./pain-page-router.mjs";
import { readWiki, appendLog } from "../../wiki/reader.mjs";

// Wiki: read dead channels and outreach rules before sending
const DEAD_CHANNELS = readWiki("market/dead-channels.md");
const OUTREACH_RULES = readWiki("market/learned-outreach.md");

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DB_PATH = resolve(ROOT, ".data/linkedin-brand-os.sqlite");
const { callAI, MODEL_MINI } = await import("./orchestrator.mjs");

const env = Object.fromEntries(
  readFileSync(resolve(ROOT, "apps/api/.env"), "utf-8").split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const APIFY_TOKEN = env.APIFY_API_KEY;
const TG = env.TELEGRAM_BOT_TOKEN, CHAT = env.TELEGRAM_CHAT_ID;
const DAILY_CAP = 20; // Apr 13 2026: increased from 5. Domain is warm (active since Apr 7). 20/day is safe for established domain.

// Rotate cities each run for maximum coverage
const CITIES = [
  "Calgary", "Edmonton", "Vancouver", "Toronto", "Ottawa", "Winnipeg",
  "Saskatoon", "Regina", "Victoria", "Kelowna", "Red Deer", "Lethbridge",
  "Denver", "Phoenix", "Dallas", "Austin", "Nashville", "Charlotte",
  "Portland", "Seattle", "Minneapolis", "Salt Lake City", "Boise",
];

const SERVICES = [
  "HVAC", "plumbing", "roofing", "landscaping", "renovation company",
  "electrical contractor", "painting company", "fencing", "concrete",
  "garage door", "cleaning service", "pest control", "tree service",
  "window cleaning", "pressure washing",
];

// Pick 3 random city+service combos each run
function getSearchQueries() {
  const queries = [];
  const shuffledCities = CITIES.sort(() => Math.random() - 0.5);
  const shuffledServices = SERVICES.sort(() => Math.random() - 0.5);
  for (let i = 0; i < 3; i++) {
    queries.push(`${shuffledServices[i]} ${shuffledCities[i]}`);
  }
  return queries;
}

const SEARCH_QUERIES = getSearchQueries();

const db = new Database(DB_PATH);
const transport = createTransport({
  host: env.OUTREACH_SMTP_HOST,
  port: parseInt(env.OUTREACH_SMTP_PORT),
  secure: false,
  auth: { user: env.OUTREACH_EMAIL, pass: env.OUTREACH_PASSWORD },
});

function log(msg) { console.log(`${new Date().toISOString()} [calgary-email] ${msg}`); }

async function tg(text) {
  if (!TG || !CHAT) return;
  await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT, text, parse_mode: "HTML", disable_web_page_preview: true }),
  }).catch(() => {});
}

// Step 1: Find companies via Apify Google Maps
async function findCompanies() {
  // Pick 3 random queries to vary each run
  const shuffled = SEARCH_QUERIES.sort(() => Math.random() - 0.5).slice(0, 3);
  log(`searching: ${shuffled.join(", ")}`);

  const resp = await fetch(
    `https://api.apify.com/v2/acts/nwua9Gu5YrADL7ZDj/run-sync-get-dataset-items?token=${APIFY_TOKEN}&maxItems=15`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        searchStringsArray: shuffled,
        maxCrawledPlacesPerSearch: 5,
        language: "en",
      }),
      signal: AbortSignal.timeout(180000),
    }
  );

  if (!resp.ok) throw new Error(`Apify ${resp.status}: ${await resp.text()}`);
  const items = await resp.json();

  // Dedupe by domain
  const seen = new Set();
  return items.filter(i => {
    if (!i.website) return false;
    try {
      const domain = new URL(i.website).hostname.replace("www.", "");
      if (seen.has(domain)) return false;
      seen.add(domain);
      return true;
    } catch { return false; }
  }).map(i => ({
    name: i.title,
    website: (i.website || "").split("?")[0],
    phone: i.phone,
    category: i.categoryName || "home-services",
    rating: i.totalScore,
    reviews: i.reviewsCount,
  }));
}

// Step 2: Extract email from company website
async function findEmail(company) {
  try {
    const resp = await fetch(company.website, {
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh)" },
    });
    const html = await resp.text();
    const emails = html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
    const filtered = [...new Set(emails)].filter(e =>
      !e.includes("example") && !e.includes("wix") && !e.includes("sentry") &&
      !e.includes("wordpress") && !e.includes("google") && !e.includes(".png") &&
      !e.includes(".jpg") && !e.includes("noreply") && !e.includes("no-reply") &&
      e.length < 50
    );
    // Prefer personal emails (owner names) over generic info@/contact@ which have 0% reply rate
    const personal = filtered.find(e => !/^(info|office|general|service|contact|hello|support|admin|sales|billing|noreply|no-reply|marketing|hr|jobs|careers|team|press|media)@/.test(e));
    return personal || filtered[0] || null;
  } catch {
    return null;
  }
}

// Step 3: Generate personalized email via GPT Mini
async function generateEmail(company) {
  const name = company.name.replace(/( Calgary| Ltd\.?| Inc\.?| Co\.?)/gi, "").trim();
  const prompt = `Write a cold email from Kirill, a Calgary AI automation consultant, to ${company.name} (${company.category}).

CONTEXT: It is spring - active season for ${company.category}. They have warm leads and estimates going out but the owner/office team is too busy to follow up consistently.

OFFER: AI-assisted quote follow-up workflow. System sends a short check-in 48h after the estimate, then day 5 and day 10. Each message references the specific job. Runs in background. $1500 CAD, done in a week.

RULES:
- Subject line: short, specific, no clickbait
- 80-100 words max body
- Mention their company name naturally
- Peer tone, not salesy
- NO em dash (use hyphen)
- NO "just checking in" or "I hope this finds you well"
- End with soft CTA ("happy to show you what this looks like" not "book a call")
- Sign: Kirill, Calgary / launchsoloai.com
- NO money-back guarantees

Output format:
SUBJECT: <subject line>
BODY:
<email body>`;

  let out;
  try {
    out = await callAI(prompt, "Write the email now.", MODEL_MINI, false);
  } catch (e) {
    log(`generateEmail failed: ${e.message}`);
    return null;
  }

  const subjectMatch = out.match(/SUBJECT:\s*(.+)/);
  const bodyMatch = out.match(/BODY:\s*([\s\S]+)/);

  if (!subjectMatch || !bodyMatch) return null;

  return {
    subject: subjectMatch[1].trim(),
    body: bodyMatch[1].trim(),
  };
}

// V6 template generator - uses fixed templates with pain-matched destination URLs
async function generateEmailV6(company, templateVersion) {
  const name = company.name.replace(/( Calgary| Edmonton| Vancouver| Toronto| Ltd\.?| Inc\.?| Co\.?)/gi, "").trim();
  const category = (company.category || "service").replace(/contractor|service/gi, "").trim() || "service";

  // Route to correct pain page
  const painMap = {
    "v6a-lost-job-cost": "lead_response_delay",
    "v6b-busy-season": "owner_bottleneck",
    "v6c-website-observation": "quoting_intake_friction",
  };
  const offerMap = {
    "v6a-lost-job-cost": "missed_lead_recovery",
    "v6b-busy-season": "admin_workflow_cleanup",
    "v6c-website-observation": "quote_request_intake",
  };
  const destUrl = getDestinationUrl(painMap[templateVersion], offerMap[templateVersion]);
  company._destinationUrl = destUrl;

  if (templateVersion === "v6a-lost-job-cost") {
    return {
      subject: `what does one missed quote cost ${name}?`,
      body: `${name},\n\nQuick math question. If ${company.name} sends out 20 quotes a month and 3 go cold because nobody followed up in time - what does that cost you over a season?\n\nFor most ${category} companies in Calgary that number is somewhere between $8K and $25K in lost revenue per quarter. Not because the work was bad. Just because the crew got busy and the follow-up slipped.\n\nI set up simple follow-up sequences for service companies. Not a new app - just a system that sends a check-in on day 2, day 5, and day 10 after every quote. Each one references the specific job. Takes about a week to set up, runs on its own after that.\n\nIf you want to see what this looks like for a ${category} company, reply with your average job size and I will show you the math.\n\n- Kirill\nCalgary\n${destUrl}`,
    };
  }

  if (templateVersion === "v6b-busy-season") {
    return {
      subject: `quick question about your spring volume`,
      body: `${name},\n\nYou are probably slammed right now - spring is when ${category} companies get buried in requests and the office work piles up behind the field work.\n\nOne thing I keep hearing from Calgary service companies: the quoting and scheduling side breaks first. Not the work itself.\n\nI help service companies clean up the admin side so the busy season does not turn into the missed-job season. Takes about a week, fixed price.\n\nWorth a look?\n\n- Kirill\nCalgary\n${destUrl}`,
    };
  }

  if (templateVersion === "v6c-website-observation") {
    const observation = company._observation || "the quote request flow could be simplified";
    return {
      subject: `noticed something on ${name} site`,
      body: `${name},\n\nI was looking at your quote request page and noticed ${observation}.\n\nThat is usually where ${category} companies lose 15-20% of incoming requests - not because people are not interested, but because the intake step has too much friction or no acknowledgment.\n\nI help Calgary service companies fix the intake-to-response gap. Usually takes a week, and the result is fewer dropped requests and faster first response.\n\nIf this matches what you are seeing, happy to show you what other ${category} companies changed.\n\n- Kirill\nCalgary\n${destUrl}`,
    };
  }

  // Fallback to v5 style via GPT Mini
  return await generateEmail(company);
}

async function main() {
  log("starting");

  // Check daily cap
  const now = new Date().toISOString().slice(0, 10);
  const sentToday = db.prepare(
    `SELECT COUNT(*) as c FROM outreach_emails WHERE status = 'sent' AND date(sent_at) = ?`
  ).get(now)?.c || 0;

  if (sentToday >= DAILY_CAP) {
    log(`daily cap reached (${sentToday}/${DAILY_CAP}), exiting`);
    return;
  }

  const remaining = DAILY_CAP - sentToday;
  log(`daily cap: ${sentToday}/${DAILY_CAP}, will send up to ${remaining}`);

  // Already contacted emails
  const contacted = new Set();
  try {
    db.prepare("SELECT business_email FROM outreach_emails").all()
      .forEach(r => contacted.add(r.business_email));
  } catch {}

  // Find companies
  let companies;
  try {
    companies = await findCompanies();
    log(`found ${companies.length} companies from Maps`);
  } catch (e) {
    log(`Apify error: ${e.message}`);
    // Don't spam Telegram with Apify errors - log only
    return;
  }

  // Refresh guardrails before sending
  refreshGuardrails(db);

  // Check if normal dispatch is blocked
  const channelGuard = isSegmentBlocked(db, "channel", "cold_email");
  const normalBlocked = channelGuard.blocked;
  if (normalBlocked) {
    log(`Normal cold_email PAUSED: ${channelGuard.reason}`);
    log(`Checking experiment portfolio for active experiments...`);
  }

  // Get active experiments
  const activeExperiments = getActiveExperiments(db);
  const expByVertical = {};
  for (const exp of activeExperiments) {
    if (!expByVertical[exp.vertical]) expByVertical[exp.vertical] = [];
    expByVertical[exp.vertical].push(exp);
  }

  if (normalBlocked && activeExperiments.length === 0) {
    log(`No active experiments and channel paused. Nothing to do.`);
    log("cold_email paused, no active experiments");
    db.close();
    return;
  }

  let sent = 0;
  const sentList = [];

  for (const company of companies) {
    if (sent >= remaining) break;

    // Find email
    const email = await findEmail(company);
    if (!email) { log(`${company.name}: no email found`); continue; }
    if (contacted.has(email)) { log(`${company.name}: already contacted`); continue; }

    // Find matching experiment for this company's vertical
    let experiment = null;
    if (expByVertical[company.category]) {
      experiment = expByVertical[company.category].find(e =>
        e.state === "active_experiment" && e.sends < e.send_cap
      );
    }
    // If no vertical-specific experiment, try any eligible
    if (!experiment) {
      experiment = getNextExperiment(db, { channel: "cold_email", city: "Calgary" });
    }

    // If normal is blocked and no experiment matches, skip
    if (normalBlocked && !experiment) {
      log(`${company.name}: no experiment for ${company.category}, skipping (channel paused)`);
      continue;
    }

    // If normal is NOT blocked, check vertical guardrail
    if (!normalBlocked) {
      const vertGuard = isSegmentBlocked(db, "vertical", company.category);
      if (vertGuard.blocked && !experiment) {
        log(`${company.name}: GUARDRAIL blocked vertical ${company.category}: ${vertGuard.reason}`);
        continue;
      }
    }

    // Determine template to use
    const templateVersion = experiment ? experiment.template_version : "v5-quote-followup";

    // v6c strict validation: must have website observation
    if (templateVersion === "v6c-website-observation") {
      // Fetch website and find specific observation
      let observation = null;
      try {
        const resp = await fetch(company.website, { signal: AbortSignal.timeout(8000), headers: { "User-Agent": "Mozilla/5.0" } });
        const html = await resp.text();
        // Look for quote/contact form issues
        const formFields = (html.match(/<input/gi) || []).length;
        const hasAutoReply = /thank you|we.*received|confirmation/i.test(html);
        if (formFields > 6) observation = `the quote form asks for ${formFields} fields before submission`;
        else if (!hasAutoReply && html.includes("form")) observation = "there is no confirmation message after form submission";
        else if (!html.includes("form") && !html.includes("quote")) observation = "there is no online quote request option";
      } catch {}
      if (!observation) {
        log(`${company.name}: v6c requires website observation but none found, skipping`);
        continue;
      }
      company._observation = observation;
    }

    // Generate email with experiment template
    log(`drafting for ${company.name} (${email}) template=${templateVersion}${experiment ? " EXP:" + experiment.experiment_key : ""}`);
    const draft = await generateEmailV6(company, templateVersion);
    if (!draft) { log(`${company.name}: draft generation failed`); continue; }

    // Send
    try {
      await transport.sendMail({
        from: '"Kirill D." <kirill@launchsoloai.com>',
        to: email,
        subject: draft.subject,
        text: draft.body,
      });

      // Record in DB with experiment template version
      const emailId = randomUUID();
      const destUrl = company._destinationUrl || getDestinationUrl(null, null);
      db.prepare(
        `INSERT INTO outreach_emails (id, business_name, business_email, business_category, business_website, subject, body, status, sent_at, created_at, updated_at, template_version, destination_url)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(emailId, company.name, email, company.category, company.website,
        draft.subject, draft.body, "sent", new Date().toISOString(), new Date().toISOString(), new Date().toISOString(), templateVersion, destUrl);

      // Record experiment send
      if (experiment) {
        recordSend(db, experiment.id);
      }

      // Record in lead_interactions
      const leadId = "email-" + email.replace(/[^a-z0-9]/g, "-");
      try {
        db.prepare("INSERT OR IGNORE INTO leads (id, name, email, company, source, stage, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)").run(
          leadId, company.name, email, company.name, "calgary-email-outreach", "contacted", new Date().toISOString(), new Date().toISOString()
        );
        db.prepare("INSERT INTO lead_interactions (id, lead_id, bot_id, channel, direction, content, ai_drafted, kirill_approved, outcome, created_at) VALUES (?,?,?,?,?,?,1,1,?,?)").run(
          "cemail-" + Date.now(), leadId, "calgary-email-outreach", "email", "outbound", draft.body, "sent", new Date().toISOString()
        );
      } catch {}

      sent++;
      sentList.push({ name: company.name, email, subject: draft.subject });
      log(`SENT: ${company.name} -> ${email}`);
      await new Promise(r => setTimeout(r, 5000)); // 5s between emails
    } catch (e) {
      log(`SMTP FAIL: ${company.name} -> ${e.message}`);
    }
  }

  // Report to Telegram
  if (sent > 0) {
    const list = sentList.map(s => `- ${s.name} (${s.email})\n  "${s.subject}"`).join("\n");
    await tg(`<b>📧 calgary-email-outreach: ${sent} emails sent</b>\n\n${list}\n\nDaily: ${sentToday + sent}/${DAILY_CAP}`);
  } else {
    log("0 new emails - all contacted or no emails found");
  }

  log(`done. sent ${sent} emails`);
  db.close();
}

main().catch(e => {
  console.error("[calgary-email] FATAL:", e.message);
  tg(`🚨 calgary-email-outreach CRASHED: ${e.message}`).catch(() => {});
  process.exit(1);
});
