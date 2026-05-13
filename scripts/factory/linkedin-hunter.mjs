/**
 * LINKEDIN HUNTER — Google CSE Edition
 *
 * No Voyager API (blocked). Uses Google Custom Search to find
 * Calgary SMB owner/founder LinkedIn profiles, then fetches
 * public profile pages with li_at cookie for details.
 *
 * Schedule: every 6 hours via cron
 */
import { getDb, callAI, tgSendToKirill, heartbeat, emitEvent, getIntelligenceKey, env, MODEL_MINI, sendMessage, reportError, clearError } from "./orchestrator.mjs";
import { sendLeadCard } from "./telegram-control.mjs";
import { webSearch } from "../search-client.mjs";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const BOT_NAME = "linkedin-hunter";
const LI_AT = env.LINKEDIN_LI_AT;

// Targeted searches for Calgary/Alberta SMB BUYERS — business owners who NEED automation
// NOT agencies/consultants/IT providers (those are competitors, not clients)
const ALL_PROFILE_QUERIES = [
  // Batch A — Calgary/Alberta service businesses (PRIMARY TARGET)
  `site:linkedin.com/in "Calgary" "owner" "dental" OR "dentist" OR "clinic"`,
  `site:linkedin.com/in "Calgary" "owner" "property management" OR "real estate" OR "rentals"`,
  `site:linkedin.com/in "Calgary" "owner" "cleaning" OR "janitorial" OR "maid service"`,
  `site:linkedin.com/in "Calgary" "owner" "HVAC" OR "plumbing" OR "electrical" OR "roofing"`,
  `site:linkedin.com/in "Calgary" "owner" "landscaping" OR "lawn care" OR "snow removal"`,
  `site:linkedin.com/in "Alberta" "founder" "accounting" OR "bookkeeping" OR "tax preparation"`,
  `site:linkedin.com/in "Edmonton" "owner" "construction" OR "contracting" OR "renovation"`,
  `site:linkedin.com/in "Calgary" "owner" "restaurant" OR "catering" OR "food service"`,
  `site:linkedin.com/in "Alberta" "owner" "physiotherapy" OR "chiropractic" OR "massage therapy"`,
  // Batch B — Broader Alberta + coordination-heavy businesses
  `site:linkedin.com/in "Alberta" "owner" "trucking" OR "logistics" OR "courier" OR "dispatch"`,
  `site:linkedin.com/in "Alberta" "owner" "insurance" OR "broker" OR "financial advisor"`,
  `site:linkedin.com/in "Calgary" "owner" "auto repair" OR "mechanic" OR "body shop"`,
  `site:linkedin.com/in "Alberta" "founder" "staffing" OR "recruiting" OR "temp agency"`,
  `site:linkedin.com/in "Calgary" "owner" "salon" OR "spa" OR "barbershop" OR "beauty"`,
  `site:linkedin.com/in "Alberta" "owner" "veterinary" OR "pet" OR "animal clinic"`,
  `site:linkedin.com/in "Alberta" "owner" "funeral" OR "storage" OR "moving company"`,
  `site:linkedin.com/in "Edmonton" "owner" "plumbing" OR "HVAC" OR "electrical" OR "painting"`,
  `site:linkedin.com/in "Red Deer" OR "Lethbridge" "owner" "business"`,
  // Batch C — Canada-wide service businesses
  `site:linkedin.com/in "Canada" "owner" "dental" OR "physiotherapy" OR "optometry"`,
  `site:linkedin.com/in "Canada" "owner" "property management" OR "building maintenance"`,
  `site:linkedin.com/in "Toronto" "owner" "cleaning" OR "restoration" OR "janitorial"`,
  `site:linkedin.com/in "Vancouver" "owner" "construction" OR "contracting" OR "renovation"`,
  `site:linkedin.com/in "Canada" "owner" "field service" OR "home service" OR "repair"`,
  `site:linkedin.com/in "Canada" "owner" "accounting firm" OR "law firm" OR "legal"`,
];

// Rotate queries per run — 3 batches of 8, every 6h
const runIndex = Math.floor(Date.now() / (6 * 3600 * 1000)) % 3;
const PROFILE_QUERIES = runIndex === 0
  ? ALL_PROFILE_QUERIES.slice(0, 8)   // Batch A — Calgary/Alberta service businesses
  : runIndex === 1
  ? ALL_PROFILE_QUERIES.slice(8, 18)  // Batch B — Broader Alberta + coordination-heavy
  : ALL_PROFILE_QUERIES.slice(18, 24); // Batch C — Canada-wide service businesses

// Pain signals in LinkedIn bio/headline
const PAIN_SIGNALS = [
  "wearing many hats", "doing it all", "small team", "growing fast",
  "manually", "spreadsheet", "overwhelmed", "scaling", "hiring",
  "no time", "streamline", "efficiency", "automate", "workflow",
  "operations", "processes", "busy", "expanding",
];

async function googleSearchProfiles(query) {
  try {
    const results = await webSearch(query, 5);
    return results
      .filter(r => r.url?.includes("linkedin.com/in/"))
      .map(r => ({
        url: r.url,
        title: r.title?.replace(/ - LinkedIn$/, "").replace(/ \| LinkedIn$/, "").trim(),
        snippet: r.snippet || "",
      }));
  } catch {
    return [];
  }
}

async function fetchLinkedInProfile(profileUrl) {
  if (!LI_AT) return null;
  try {
    const res = await fetch(profileUrl, {
      headers: {
        "cookie": `li_at=${LI_AT}`,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const html = await res.text();

    // Extract JSON-LD structured data
    const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    let structuredData = null;
    if (jsonLdMatch) {
      try { structuredData = JSON.parse(jsonLdMatch[1]); } catch {}
    }

    // Extract meta description (contains headline + location)
    const metaDesc = html.match(/<meta name="description" content="([^"]+)"/)?.[1] || "";

    // Extract name from title
    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    const titleText = titleMatch?.[1] || "";
    const name = titleText.split("|")[0]?.split("-")[0]?.trim() || "";

    return {
      name: structuredData?.name || name,
      headline: structuredData?.jobTitle || metaDesc.split(".")[0] || "",
      description: metaDesc,
      location: structuredData?.address?.addressLocality || "",
    };
  } catch {
    return null;
  }
}

// Competitor/seller patterns — these are people who SELL automation, not BUY it
const COMPETITOR_PATTERNS = /\b(automation consultant|workflow specialist|digital agency|marketing agency|IT services|IT consulting|software developer|web developer|freelanc|n8n|zapier|make\.com|gohighlevel|GHL partner|saas|ai consultant|ai agency|chatbot|we help businesses|helping companies automate|digital transformation)\b/i;

function scorePain(title, snippet) {
  const text = `${title} ${snippet}`.toLowerCase();

  // HARD REJECT: competitors and automation sellers
  if (COMPETITOR_PATTERNS.test(text)) return 0;

  let score = 0;

  // Decision maker signals
  if (/\b(owner|founder|ceo|president|principal|partner|director)\b/.test(text)) score += 25;
  // Small business signals
  if (/\b(small|boutique|independent|my own|self.employed)\b/.test(text)) score += 10;
  // Location bonus — primary market
  if (text.includes("calgary") || text.includes("alberta") || text.includes("edmonton")) score += 15;
  if (text.includes("canada") || text.includes("toronto") || text.includes("vancouver")) score += 8;
  // Pain signals
  for (const s of PAIN_SIGNALS) {
    if (text.includes(s)) score += 8;
  }
  // BUYER industry bonus — service businesses that NEED automation
  const buyerIndustries = ["dental", "dentist", "clinic", "property management", "real estate", "cleaning", "janitorial",
    "hvac", "plumbing", "electrical", "construction", "contracting", "accounting", "bookkeeping",
    "law firm", "legal", "insurance", "landscaping", "restaurant", "catering", "physiotherapy",
    "chiropractic", "veterinary", "trucking", "logistics", "salon", "spa", "auto repair", "mechanic"];
  if (buyerIndustries.some(i => text.includes(i))) score += 15;
  // SELLER industry penalty — competitors
  const sellerIndustries = ["agency", "consulting firm", "technology", "software", "saas", "marketing agency", "digital"];
  if (sellerIndustries.some(i => text.includes(i))) score -= 20;

  return Math.max(0, Math.min(score, 100));
}

async function writeConnectionMessage(name, title, snippet, analysis) {
  const firstName = name?.split(" ")[0] || "there";
  const raw = await callAI(
    `You write LinkedIn connection request NOTES. HARD LIMIT: 200 characters MAX (LinkedIn's system limit).
Count every character. If over 200 chars it gets rejected.
BANNED: "I'd love to connect", "I came across your profile", "I can help you", "I specialize in", "I noticed", "Hi there", "streamline", "leverage", "game-changer", "seamlessly", "feel free", "don't hesitate"
Sound like a peer. ONE specific reference to their work. Direct: what Kirill does + why reaching out. That's it.`,
    `Write a connection note from Kirill (AI Automation Consultant, Calgary) to ${firstName}.
Their role: ${title}
Context: ${snippet?.slice(0, 150)}
Pain: ${analysis?.pain || "manual operations"}
MUST be under 200 characters total. Count carefully. Return plain text only.`,
    MODEL_MINI,
    false  // plain text, not JSON
  );
  // Hard enforce: truncate to 200 chars at word boundary
  if (!raw || raw.length <= 200) return raw;
  const trimmed = raw.slice(0, 197);
  const lastSpace = trimmed.lastIndexOf(" ");
  return (lastSpace > 150 ? trimmed.slice(0, lastSpace) : trimmed) + "...";
}

export async function runLinkedInHunter() {
  const db = getDb();
  heartbeat(db, BOT_NAME, "LinkedIn Hunter", "starting");

  if (!env.BRAVE_SEARCH_API_KEY && !env.GOOGLE_CSE_API_KEY) {
    console.log("[LinkedIn Hunter] No search API configured — skipping");
    db.close();
    return [];
  }

  // Check if PRBot has assigned a target market — if so, add global queries
  const prTarget = getIntelligenceKey(db, "pr-bot", "current_target_market", "market");
  const targetMarket = prTarget?.market && new Date(prTarget.expiresAt) > new Date()
    ? prTarget.market : null;

  if (targetMarket) {
    console.log(`[LinkedIn Hunter] PRBot target market active: ${targetMarket}`);
  }

  const activeQueries = [...PROFILE_QUERIES];
  if (targetMarket) {
    // Add market-specific queries to this run
    activeQueries.push(
      `site:linkedin.com/in "${targetMarket}" "founder" OR "owner" "business" OR "startup"`,
      `site:linkedin.com/in "${targetMarket}" "CEO" OR "managing director" "operations" OR "process"`,
      `site:linkedin.com/in "${targetMarket}" "owner" "accounting" OR "law" OR "logistics" OR "ecommerce"`
    );
  }

  console.log("[LinkedIn Hunter] Starting Google CSE profile search...");
  const allProfiles = [];

  for (const query of activeQueries) {
    const results = await googleSearchProfiles(query);
    console.log(`[LinkedIn Hunter] "${query.slice(0, 50)}..." → ${results.length} profiles`);
    allProfiles.push(...results);
    await new Promise(r => setTimeout(r, 500)); // CSE rate limit
  }

  // Deduplicate by URL
  const seen = new Set();
  const unique = allProfiles.filter(p => {
    if (seen.has(p.url)) return false;
    seen.add(p.url);
    return true;
  });

  console.log(`[LinkedIn Hunter] ${unique.length} unique profiles found via Google CSE`);

  const foundProspects = [];

  for (const profile of unique.slice(0, 15)) {
    try {
      // Quick score from Google snippet
      const quickScore = scorePain(profile.title, profile.snippet);
      if (quickScore < 15) {
        console.log(`[LinkedIn Hunter] Skip (score ${quickScore}): ${profile.title?.slice(0, 60)}`);
        continue;
      }

      // Check not already in DB
      const existing = db.prepare("SELECT id FROM leads WHERE source_url = ? OR linkedin_url = ?").get(profile.url, profile.url);
      if (existing) {
        console.log(`[LinkedIn Hunter] Already tracked: ${profile.title?.slice(0, 40)}`);
        continue;
      }

      // Try to get more details from public profile
      let details = null;
      if (LI_AT) {
        details = await fetchLinkedInProfile(profile.url);
        await new Promise(r => setTimeout(r, 2000));
      }

      const name = details?.name || profile.title?.split(" - ")[0] || "Unknown";
      const headline = details?.headline || profile.title || "";
      const context = `${headline} ${profile.snippet} ${details?.description || ""}`;

      // Load LearnBot rules for scoring
      let learnedRulesCtx = "";
      try {
        const learned = getIntelligenceKey(db, "learn-bot", "learned_rules", "lead_scoring");
        if (learned?.hard_reject_patterns?.length) {
          learnedRulesCtx = `\nAUTO-REJECT if profile matches: ${learned.hard_reject_patterns.join(", ")}`;
        }
        if (learned?.icp_refinement) learnedRulesCtx += `\nICP: ${learned.icp_refinement}`;
      } catch {}

      // AI analysis — "json" must appear in system prompt for OpenAI json_object mode
      const analysis = await callAI(
        `You are a B2B sales analyst scoring leads for an automation consultant in Calgary.
MANDATORY REJECT (score 0): automation consultants, IT service providers, digital/marketing agencies, freelancers, software developers, anyone who SELLS automation or tech services. These are COMPETITORS not clients.
MANDATORY REJECT (score 0): employees without decision-making power, job seekers, students.
IDEAL CLIENT: SMB owner/founder of a SERVICE business (dental, property management, cleaning, HVAC, plumbing, construction, accounting, law, restaurants, logistics, salons). They have manual processes, small teams, coordination headaches.
Score 0-100. Return json: {"score":number,"pain":"string","moment":"string","isCompetitor":boolean}${learnedRulesCtx}`,
        `Name: ${name}\nHeadline: ${headline}\nContext: ${context.slice(0, 400)}\nProfile: ${profile.url}\nReturn json only.`
      );

      let parsed = { score: quickScore, pain: "operational inefficiency", moment: "business growth" };
      try {
        const json = analysis.match(/\{[\s\S]*\}/)?.[0];
        if (json) parsed = JSON.parse(json);
      } catch {}

      const finalScore = Math.max(quickScore, parsed.score || 0);
      if (finalScore < 25) {
        console.log(`[LinkedIn Hunter] Low AI score ${finalScore} for ${name} — skip`);
        continue;
      }

      // Write personalized connection message
      const message = await writeConnectionMessage(name, headline, profile.snippet, parsed);

      // Extract company from headline
      const companyMatch = headline.match(/(?:at|@)\s+([^|,\n]+)/i);
      const company = companyMatch?.[1]?.trim() || "";

      // Extract title
      const titlePart = headline.split(/\s+(?:at|@)\s+/i)[0]?.split("|")[0]?.trim() || headline;

      // Store in leads
      const leadId = randomUUID();
      db.prepare(`
        INSERT INTO leads (
          id, source, source_platform, source_url, linkedin_url,
          name, company, role, location, score,
          pain_description, notes, stage, first_signal_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', datetime('now'), datetime('now'), datetime('now'))
      `).run(
        leadId,
        "linkedin_hunter", "linkedin",
        profile.url, profile.url,
        name, company, titlePart,
        "Calgary, AB", finalScore,
        parsed.pain, message,
      );

      emitEvent(db, { fromBot: BOT_NAME, eventType: "lead_found", payload: {
        name, company, score: finalScore, pain: parsed.pain,
        channel: "linkedin", profileUrl: profile.url,
      }});

      // Отправить лид в ScoutBot через event bus
      sendMessage(db, {
        fromBot: BOT_NAME,
        toBot: "scout-bot",
        messageType: "linkedin_lead",
        payload: {
          leadId,
          name,
          company,
          role: titlePart,
          location: details?.location || "Calgary, AB",
          score: finalScore,
          pain: parsed.pain,
          moment: parsed.moment,
          profileUrl: profile.url,
          connectionMessage: message
        },
        priority: finalScore >= 70 ? 10 : 7
      });

      foundProspects.push({ name, company, score: finalScore, pain: parsed.pain, message, profileUrl: profile.url });
      console.log(`[LinkedIn Hunter] ✅ ${name} — ${company} (score: ${finalScore})`);

      // Send lead card with inline buttons immediately
      const newLead = db.prepare("SELECT * FROM leads WHERE source_url = ?").get(profile.url);
      if (newLead) {
        await sendLeadCard(newLead, foundProspects.length).catch(() => {});
      }

      await new Promise(r => setTimeout(r, 2500));
    } catch (err) {
      console.log(`[LinkedIn Hunter] Error: ${err.message}`);
    }
  }

  // Telegram summary if found prospects
  if (foundProspects.length > 0) {
    const summary = foundProspects.slice(0, 3).map(p =>
      `• *${p.name}* (${p.company || "Calgary"}) — Score: ${p.score}/100\n  _${p.pain}_`
    ).join("\n\n");
    await tgSendToKirill(`🎯 *LinkedIn Hunter нашёл ${foundProspects.length} prospects:*\n\n${summary}\n\nПолные сообщения придут в утреннем брифе.`);
  }

  heartbeat(db, BOT_NAME, "LinkedIn Hunter", `done — ${foundProspects.length} prospects found`, {}, {
    status: foundProspects.length > 0 ? "ok" : "degraded",
    last_success_at: new Date().toISOString(),
    error: null
  });
  try { clearError(db, BOT_NAME); } catch {}
  db.close();
  return foundProspects;
}

// ── LIVE MODE (24/7 процесс) ──────────────────────────────────────────────────
async function processMessages() {
  const { getDb, pollMessages, markMessageActedOn } = await import("./orchestrator.mjs");
  const db = getDb();
  try {
    const messages = pollMessages(db, "linkedin-hunter", 5);
    for (const msg of messages) {
      if (msg.message_type === "hunt_profiles") {
        console.log(`[LinkedIn Hunter] Got hunt_profiles request: ${msg.payload?.niche || "unknown"}`);
        // Run a targeted scan with custom queries
        const customQueries = msg.payload?.queries || [];
        if (customQueries.length > 0) {
          // Temporarily override queries and run
          const origQueries = ALL_PROFILE_QUERIES.slice();
          ALL_PROFILE_QUERIES.length = 0;
          ALL_PROFILE_QUERIES.push(...customQueries.map(q => `site:linkedin.com/in ${q}`));
          await runLinkedInHunter();
          ALL_PROFILE_QUERIES.length = 0;
          ALL_PROFILE_QUERIES.push(...origQueries);
        } else {
          await runLinkedInHunter();
        }
        markMessageActedOn(db, msg.id, { processed: true });
      }
    }
  } finally {
    db.close();
  }
}

async function liveMode() {
  console.log(`[LinkedIn Hunter] Starting in LIVE mode (scan every 6h, check messages every 5min)...`);

  let lastFullScan = 0;

  while (true) {
    try {
      const now = Date.now();

      // Full scan every 6 hours
      if (now - lastFullScan > 6 * 60 * 60 * 1000) {
        console.log(`[LinkedIn Hunter] Running full LinkedIn profile scan...`);
        await runLinkedInHunter();
        lastFullScan = now;
      }

      // Check event bus every iteration (5 min)
      await processMessages();

      await new Promise(r => setTimeout(r, 5 * 60 * 1000));
    } catch (err) {
      console.error(`[LinkedIn Hunter] Error in live mode:`, err.message);
      try { const edb = getDb(); reportError(edb, BOT_NAME, "LinkedIn Hunter", err.message, "crash", "liveMode"); edb.close(); } catch {}
      await new Promise(r => setTimeout(r, 5 * 60 * 1000));
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const isLive = process.argv.includes("live");
  if (isLive) {
    liveMode().catch(err => {
      console.error(`[LinkedIn Hunter] Fatal error:`, err);
      process.exit(1);
    });
  } else {
    runLinkedInHunter().catch(console.error);
  }
}
