/**
 * chain-business-outreach.mjs — Finds and contacts chain businesses
 *
 * Reads market analysis + Brave Search to find chain business contacts.
 * Drafts personalized emails referencing their multi-location pain.
 * Sends via existing email pipeline.
 *
 * Run: node scripts/factory/chain-business-outreach.mjs
 */

import Database from "better-sqlite3";
import { readFileSync, existsSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DB_PATH = resolve(ROOT, ".data/linkedin-brand-os.sqlite");
const ENV_PATH = resolve(ROOT, "apps/api/.env");
const ANALYSIS_PATH = resolve(ROOT, ".data/chain-business-market-analysis.md");

const { callAI, MODEL_STRONG, MODEL_MINI, tgSend, BOTS, CHAT_ID, heartbeat } = await import("./orchestrator.mjs");
const { readPurpose } = await import("../../wiki/reader.mjs");

const env = Object.fromEntries(
  readFileSync(ENV_PATH, "utf-8").split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const BRAVE_KEY = env.BRAVE_SEARCH_API_KEY || env.BRAVE_API_KEY;

const db = new Database(DB_PATH);
const BOT_ID = "chain-business-outreach";

function log(msg) { console.log(`[${BOT_ID}] ${msg}`); }

// Already contacted
const contacted = new Set();
try {
  db.prepare("SELECT business_email FROM outreach_emails WHERE business_email IS NOT NULL").all()
    .forEach(r => contacted.add(r.business_email?.toLowerCase()));
} catch {}

async function braveSearch(query) {
  if (!BRAVE_KEY) return [];
  try {
    const r = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10`, {
      headers: { "Accept": "application/json", "X-Subscription-Token": BRAVE_KEY }
    });
    const d = await r.json();
    return (d.web?.results || []).map(r => ({ title: r.title, url: r.url, desc: r.description }));
  } catch { return []; }
}

async function findChainBusinesses() {
  log("Searching for chain businesses...");
  const businesses = [];

  // Search queries targeting multi-location businesses with findable emails
  const queries = [
    "Calgary franchise business contact email",
    "Calgary dental clinic chain locations contact",
    "Calgary property management company email",
    "Calgary auto repair franchise contact",
    "Calgary restaurant chain owner contact",
    "Calgary cleaning service franchise email",
    "Calgary veterinary clinic chain contact",
    "Calgary physiotherapy chain clinic email",
  ];

  for (const q of queries) {
    const results = await braveSearch(q);
    for (const r of results) {
      // Extract email from description or URL
      const emailMatch = (r.desc || "").match(/[\w.+-]+@[\w-]+\.[\w.]+/);
      if (emailMatch && !contacted.has(emailMatch[0].toLowerCase())) {
        // Extract real business name - not just page title
        let rawName = r.title?.replace(/ - .*$/, "").replace(/\|.*$/, "").replace(/,.*$/, "").slice(0, 100) || "";
        // Filter out generic page titles that aren't business names
        const JUNK_TITLES = /^(veterinarians|become a|contact|home|about|services|franchise|calgary|alberta|find|top \d|best \d|list of)/i;
        if (JUNK_TITLES.test(rawName)) {
          // Try to extract name from URL domain instead
          try {
            const domain = new URL(r.url).hostname.replace("www.", "").replace(/\.\w+$/, "");
            rawName = domain.split(/[-.]/).map(w => w[0]?.toUpperCase() + w.slice(1)).join(" ");
          } catch { rawName = "Unknown"; }
        }
        if (rawName === "Unknown" || rawName.length < 3) continue;
        businesses.push({
          name: rawName,
          email: emailMatch[0],
          website: r.url,
          source_query: q,
          category: q.includes("dental") ? "dental-chain" :
                    q.includes("property") ? "property-management" :
                    q.includes("auto") ? "auto-repair-chain" :
                    q.includes("restaurant") ? "restaurant-chain" :
                    q.includes("cleaning") ? "cleaning-chain" :
                    q.includes("vet") ? "veterinary-chain" :
                    q.includes("physio") ? "physio-chain" :
                    "franchise",
        });
      }
    }
    await new Promise(r => setTimeout(r, 1500));
  }

  // Dedup by email
  const seen = new Set();
  return businesses.filter(b => {
    if (seen.has(b.email.toLowerCase())) return false;
    seen.add(b.email.toLowerCase());
    return true;
  });
}

async function draftEmail(business) {
  const purpose = readPurpose().slice(0, 300);
  const analysis = existsSync(ANALYSIS_PATH) ? readFileSync(ANALYSIS_PATH, "utf-8").slice(0, 1000) : "";

  // Fetch their website for context
  let siteContent = "";
  if (business.website) {
    try {
      const r = await fetch(business.website, {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(8000),
      });
      const html = await r.text();
      siteContent = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .slice(0, 1500);
    } catch {}
  }

  const result = await callAI(
    `You write cold outreach emails for Kirill, an AI automation consultant in Calgary.
${purpose}

TARGET: Chain/multi-location business.
THEIR PAIN (from market analysis): ${analysis.slice(0, 500)}

Business: ${business.name}
Category: ${business.category}
Website content: ${siteContent.slice(0, 800)}

Write a SHORT cold email (max 150 words) that:
1. References something specific about THEIR business from the website
2. Names the multi-location pain they likely have (cross-location reporting, scheduling, manual coordination)
3. Offers a specific fix: "Multi-Location Ops Sprint - I map your workflows across locations and build one automation that saves X hours/week. $2,500 CAD, 1 week."
4. CTA: "Worth 15 minutes to see if it fits?"
5. Sign: Kirill D., launchsoloai.com

RULES: No em dashes (use hyphens). No "delve/leverage/robust/seamless". No money-back guarantee. Be specific to THEIR business.

Return JSON: { "subject": "...", "body": "..." }`,
    `Draft email for ${business.name}`,
    MODEL_STRONG,
    true
  );

  return result;
}

async function main() {
  log("Starting chain business outreach...");

  const businesses = await findChainBusinesses();
  log(`Found ${businesses.length} chain businesses with emails`);

  if (businesses.length === 0) {
    log("No new chain businesses found. Try different queries next time.");
    heartbeat(db, BOT_ID, "ChainOutreach", "No new businesses found", {}, { status: "ok", last_success_at: new Date().toISOString() });
    return;
  }

  // Draft and save emails (max 5 per run)
  const toProcess = businesses.slice(0, 5);
  let drafted = 0;

  for (const biz of toProcess) {
    try {
      const email = await draftEmail(biz);
      if (!email?.subject || !email?.body) { log(`  Skip ${biz.name}: no draft`); continue; }

      const emailId = randomUUID().replace(/-/g, "").slice(0, 16);
      db.prepare(`
        INSERT INTO outreach_emails (id, business_name, business_email, business_category, business_website, subject, body, status, template_version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'dry_run', 'chain-v1', datetime('now'), datetime('now'))
      `).run(emailId, biz.name, biz.email, biz.category, biz.website, email.subject, email.body);

      log(`  Drafted: ${biz.name} <${biz.email}> - ${email.subject}`);
      drafted++;
    } catch (e) {
      log(`  Error drafting for ${biz.name}: ${e.message}`);
    }
  }

  if (drafted > 0) {
    await tgSend(BOTS.content.token, CHAT_ID,
      `<b>Chain Business Outreach</b>\n\n${drafted} new emails drafted for multi-location businesses.\n\nNext send-ready-batch cycle will personalize and send them.\n\nBusinesses:\n${toProcess.slice(0, drafted).map(b => "- " + b.name + " (" + b.category + ")").join("\n")}`,
      { parse_mode: "HTML" }
    );
  }

  heartbeat(db, BOT_ID, "ChainOutreach", `Drafted ${drafted} chain business emails`, { drafted, found: businesses.length }, { status: "ok", last_success_at: new Date().toISOString() });
  log(`Done: ${drafted} drafted, ${businesses.length} found total`);
  db.close();
}

main().catch(e => {
  console.error(`[${BOT_ID}] FATAL:`, e.message);
  process.exit(1);
});
