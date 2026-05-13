/**
 * AI Email Writer  - Deep Personalization Engine
 *
 * NOT templates. Each email based on real research:
 * 1. Fetch business website → extract real context (services, team, owner name)
 * 2. Google CSE → find hiring signals, news, pain indicators
 * 3. GPT-4o → analyze as business analyst + marketer + copywriter + coach
 * 4. Write message that proves we know THEIR specific situation
 *
 * Target: 5-8% reply rate (vs 0.5% for templates)
 */
import { env } from "../factory/orchestrator.mjs";
import { generateAudit } from "./generate-audit.mjs";
import { readWiki, appendLog } from "../../wiki/reader.mjs";

const OPENAI_KEY = env.OPENAI_API_KEY;
const GOOGLE_CSE_KEY = env.GOOGLE_CSE_API_KEY;
const GOOGLE_CSE_ID = env.GOOGLE_CSE_ID;

const SENDER_NAME = "Kirill D.";
const SENDER_ROLE = "Business Automation Consultant";

// ROI benchmarks by industry (for the numbers in the email)
const INDUSTRY_ROI = {
  "accounting": { manual_hours: "12-18 hrs/week", saving: "$35K-50K/year", process: "reconciliations & client reporting" },
  "dental-clinics": { manual_hours: "8-12 hrs/week", saving: "$25K-40K/year", process: "scheduling, reminders & patient intake" },
  "law-offices": { manual_hours: "15-20 hrs/week", saving: "$45K-70K/year", process: "client intake, document prep & deadline tracking" },
  "real-estate-agents": { manual_hours: "10-15 hrs/week", saving: "$30K-45K/year", process: "lead follow-up, listing updates & buyer matching" },
  "mortgage-brokers": { manual_hours: "10-14 hrs/week", saving: "$30K-45K/year", process: "document collection & client status updates" },
  "marketing-agencies": { manual_hours: "12-16 hrs/week", saving: "$35K-55K/year", process: "reporting, client approvals & content scheduling" },
  "it-services-and-support": { manual_hours: "10-15 hrs/week", saving: "$30K-50K/year", process: "ticketing, monitoring & client onboarding" },
  "physiotherapy": { manual_hours: "6-10 hrs/week", saving: "$20K-32K/year", process: "scheduling, intake forms & treatment reminders" },
  "insurance-brokers": { manual_hours: "10-14 hrs/week", saving: "$28K-42K/year", process: "renewal reminders, quote requests & policy docs" },
  "financial-advisors": { manual_hours: "8-12 hrs/week", saving: "$25K-40K/year", process: "client onboarding, portfolio reporting & meeting prep" },
  "property-management": { manual_hours: "12-18 hrs/week", saving: "$35K-55K/year", process: "maintenance requests, rent reminders & tenant comms" },
  "auto-repair": { manual_hours: "6-8 hrs/week", saving: "$18K-28K/year", process: "service reminders, booking & parts ordering" },
  "landscaping": { manual_hours: "6-10 hrs/week", saving: "$18K-30K/year", process: "client outreach, estimate follow-ups & crew scheduling" },
  "cleaning-services": { manual_hours: "5-8 hrs/week", saving: "$15K-25K/year", process: "booking, client follow-up & crew coordination" },
  "veterinarians": { manual_hours: "8-12 hrs/week", saving: "$25K-38K/year", process: "appointment reminders, prescription refills & patient intake" },
  "home-builders": { manual_hours: "10-15 hrs/week", saving: "$30K-50K/year", process: "permit tracking, subcontractor scheduling & client updates" },
  "plumbers": { manual_hours: "6-10 hrs/week", saving: "$20K-32K/year", process: "dispatching, estimate follow-ups & scheduling" },
  "electricians": { manual_hours: "6-10 hrs/week", saving: "$20K-32K/year", process: "quote follow-ups, scheduling & permit paperwork" },
  "hvac": { manual_hours: "8-12 hrs/week", saving: "$25K-38K/year", process: "service scheduling, maintenance reminders & dispatching" },
  "roofing": { manual_hours: "6-10 hrs/week", saving: "$20K-35K/year", process: "estimate follow-ups, scheduling & weather-based rescheduling" },
  "moving-companies": { manual_hours: "8-12 hrs/week", saving: "$22K-35K/year", process: "quote requests, booking confirmations & crew scheduling" },
  "travel-agencies": { manual_hours: "10-14 hrs/week", saving: "$28K-42K/year", process: "itinerary prep, booking changes & client follow-ups" },
  "staffing-agencies": { manual_hours: "12-18 hrs/week", saving: "$35K-55K/year", process: "candidate screening, timesheet collection & client reporting" },
  "bookkeeping": { manual_hours: "10-15 hrs/week", saving: "$30K-45K/year", process: "data entry, reconciliations & client document collection" },
  "fitness-centres": { manual_hours: "6-10 hrs/week", saving: "$18K-30K/year", process: "class booking, membership renewals & lead follow-up" },
  "daycare-centres": { manual_hours: "8-12 hrs/week", saving: "$22K-35K/year", process: "enrollment paperwork, parent updates & billing" },
};

const DEFAULT_ROI = { manual_hours: "10-15 hrs/week", saving: "$25K-40K/year", process: "manual repetitive tasks" };

async function callGPT(messages, model = "gpt-4o") {
  // Use Claude CLI via orchestrator callAI ($0 on Max subscription)
  const { callAI, MODEL_MINI } = await import("../factory/orchestrator.mjs");
  const system = messages.find(m => m.role === "system")?.content || "";
  const user = messages.find(m => m.role === "user")?.content || "";
  return await callAI(system, user, MODEL_MINI, false);
}

async function fetchWebsiteText(url) {
  if (!url) return "";
  try {
    const normalUrl = url.startsWith("http") ? url : "https://" + url;
    const res = await fetch(normalUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; research bot)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return "";
    const html = await res.text();
    // Strip HTML tags, get readable text
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 3000); // First 3000 chars enough
    return text;
  } catch {
    return "";
  }
}

async function googleSearch(query) {
  if (!GOOGLE_CSE_KEY || !GOOGLE_CSE_ID) return [];
  try {
    const url = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_CSE_KEY}&cx=${GOOGLE_CSE_ID}&q=${encodeURIComponent(query)}&num=3`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    return (data.items || []).map(i => `${i.title}: ${i.snippet}`).join("\n");
  } catch {
    return "";
  }
}

async function researchBusiness(business) {
  const { name, website, category, address } = business;
  const domain = website ? new URL(website.startsWith("http") ? website : "https://" + website).hostname : "";

  // Run research in parallel
  const [websiteText, googleResults] = await Promise.all([
    fetchWebsiteText(website),
    googleSearch(`"${name}" Calgary ${category?.replace(/-/g, " ")} hiring OR team OR staff OR owner`),
  ]);

  // Extract potential owner name from website text
  const ownerPatterns = [
    /(?:owner|founder|president|principal|director|partner)\s*:?\s*([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/gi,
    /(?:Dr\.?\s+|Mr\.?\s+|Ms\.?\s+)([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/g,
  ];
  let ownerName = null;
  const GARBAGE_NAME_RX = /^(and|or|is|are|was|it|we|our|your|their|this|that|the|a|an|for|to|at|on|by|in|of|providing|all|any|has|have|been|with|from|not|but|they|about|who|how|what|when|where|why|ship|fort|centre|center|north|south|east|west|new|old|here|there|which)\b/i;
  // Same NON_PERSON filter as business.ownerName validation  - catches industry words
  const SCRAPE_NON_PERSON = /\b(contact|info|admin|office|team|staff|clinic|dental|physio|optim|eyewear|solutions|services|realty|group|corp|inc|ltd|llp|associates|company|management|consulting|enterprises|capital|financial|medical|health|wellness|repair|auto|home|care|clean|landscape|moving|travel|fitness|day|pet|roofing|hvac|plumb|electric|insurance|insuring|mortgage|marketing|legal|law|account|book|notary|staffing|print|veterinar|lenses|learning|centre|center|scheduling|booking|billing|intake|dispatch|maintenance|property|construction|advisory|advisor|wealth|invest|broker)/i;
  for (const rx of ownerPatterns) {
    const m = rx.exec(websiteText || "");
    if (m) {
      const candidate = (m[1] || m[0]).trim();
      // Validate: must look like a real name, not a sentence fragment or industry word
      if (candidate.length >= 3 && candidate.length <= 30 && !GARBAGE_NAME_RX.test(candidate) && !SCRAPE_NON_PERSON.test(candidate)) {
        ownerName = candidate;
      }
      break;
    }
  }

  // Detect pain signals from website + google
  const combinedText = `${websiteText} ${googleResults}`.toLowerCase();
  const hiringSignal = combinedText.includes("hiring") || combinedText.includes("join our team") || combinedText.includes("careers");
  const growthSignal = combinedText.includes("expand") || combinedText.includes("new location") || combinedText.includes("growing");
  const painSignals = [];
  if (hiringSignal) painSignals.push("actively hiring (team growing = more manual work)");
  if (growthSignal) painSignals.push("business expanding (scaling pain likely)");
  if (combinedText.includes("busy") || combinedText.includes("overwhelm")) painSignals.push("mentions being busy/overwhelmed");

  return {
    ownerName,
    websiteExcerpt: websiteText.slice(0, 800),
    googleSnippets: googleResults.slice(0, 500),
    hiringSignal,
    growthSignal,
    painSignals,
    domain,
  };
}

// CLINIC CATEGORIES that use the v2 fixed template (proven structure, no GPT drift)
const CLINIC_CATEGORIES = new Set(["dental-clinics", "physiotherapy", "optometrists", "veterinarians", "chiropractors"]);

// v3: ALL categories now use fixed templates. GPT was producing spammy emails (33% "Streamline" subjects,
// 22% dollar signs, placeholder leaks). 0% reply rate on 103 emails proved GPT approach fails.
const CATEGORY_HOOKS = {
  "law-offices": {
    pain: "client intake and document prep",
    hook: "how many hours your paralegals spend re-entering the same client info across forms",
    detail: "Most small firms I talk to in Calgary lose 15+ hours/week to intake, deadline tracking, and doc prep  - work that's just moving data between systems.",
  },
  "accounting": {
    pain: "client document collection",
    hook: "how you're collecting documents from clients during tax season",
    detail: "The firms I've talked to here in Calgary spend 10-15 hours/week chasing clients for documents, re-entering data, and updating status spreadsheets  - especially Jan through April.",
  },
  "real-estate-agents": {
    pain: "lead follow-up",
    hook: "how many leads go cold because follow-up slips through the cracks",
    detail: "Most agents I talk to here lose 3-5 deals/year just from slow follow-up. Not because they don't care  - because they're showing properties all day and the admin piles up.",
  },
  "mortgage-brokers": {
    pain: "document collection and status updates",
    hook: "how much time goes into chasing clients for documents and updating them on where things stand",
    detail: "Brokers I talk to spend 10+ hours/week just on document follow-up and status calls. That's time not spent on new applications.",
  },
  "marketing-agencies": {
    pain: "client reporting and approvals",
    hook: "how much of your team's week goes into building reports and chasing client approvals",
    detail: "Most small agencies in Calgary spend 12+ hours/week on reporting and approval loops  - work that doesn't move the needle for clients.",
  },
  "it-services-and-support": {
    pain: "ticketing and client onboarding",
    hook: "how your team handles the gap between a new ticket coming in and someone actually working on it",
    detail: "MSPs I talk to here lose 2-3 hours/day to ticket triage, status updates, and client onboarding paperwork. That adds up fast with a small team.",
  },
  "insurance-brokers": {
    pain: "renewal reminders and quote requests",
    hook: "how you're tracking which clients are up for renewal and when to reach out",
    detail: "Most brokers I talk to handle renewals from memory or a spreadsheet. That works until it doesn't  - and a missed renewal is a lost client.",
  },
  "property-management": {
    pain: "maintenance requests and tenant communication",
    hook: "how maintenance requests get from a tenant's phone to your contractor",
    detail: "Property managers I work with in Calgary get 20-30 maintenance requests/month. When those come in by text, email, and phone, things get lost.",
  },
  "auto-repair": {
    pain: "service reminders and booking",
    hook: "how you remind customers their oil change or inspection is due",
    detail: "Most shops I talk to don't follow up with past customers at all  - not because they don't want to, but because there's no system for it.",
  },
  "landscaping": {
    pain: "open estimates and callbacks",
    hook: "how many estimates are sitting open right now that nobody's called back on",
    detail: "Landscapers I talk to close about 35% of their quotes. The other 65% aren't saying no  - they just never got a callback. One contractor added $1M/year just by following up on unsold estimates within 48 hours.",
    cta_options: ["Open estimates nobody's called back on", "Scheduling and crew coordination", "Callbacks and customer updates"],
  },
  "cleaning-services": {
    pain: "booking and crew coordination",
    hook: "how much time goes into scheduling jobs and making sure the right crew shows up",
    detail: "Cleaning companies I talk to spend 5-8 hours/week on booking, rescheduling, and crew coordination  - that's almost a full day not cleaning.",
  },
  "financial-advisors": {
    pain: "client onboarding and meeting prep",
    hook: "how much time your team spends preparing for client meetings vs actually advising",
    detail: "Advisors I've talked to spend 2-3 hours prepping for each client meeting  - pulling reports, checking accounts, building slides. Most of that is data assembly, not thinking.",
  },
  "hvac": {
    pain: "unsold estimates and maintenance reminders",
    hook: "how much is sitting in unsold estimates right now that nobody's followed up on",
    detail: "HVAC companies I talk to have thousands in open estimates that never get a callback. And seasonal maintenance reminders? Most just don't send them  - that's recurring revenue falling through the cracks.",
    cta_options: ["Open estimates nobody's called back on", "Maintenance reminders that never get sent", "Dispatching and scheduling"],
  },
  "plumbers": {
    pain: "unsold estimates and callbacks",
    hook: "when's the last time a customer went with someone else because you were on a job and couldn't call back the same day",
    detail: "Plumbers I talk to send 10-15 estimates a week but follow up on maybe half. The other half goes quiet  - usually to whoever called back first. That's jobs falling through the cracks.",
    cta_options: ["Open estimates nobody's called back on", "Dispatching and scheduling", "Customer callbacks that fall through the cracks"],
  },
  "roofing": {
    pain: "unsold estimates and quote follow-up",
    hook: "what's your estimate win rate right now  - most roofers I talk to close about 35%, and the other 65% just never got a callback",
    detail: "Roofing companies lose 40%+ of quoted jobs because the homeowner got three quotes and went with whoever called back first. Not price  - just timing.",
    cta_options: ["Open estimates that never got a callback", "Scheduling and crew coordination", "Customer updates after job starts"],
  },
  "moving-companies": {
    pain: "quote requests and booking confirmations",
    hook: "how many quote requests come in that never turn into a booked job",
    detail: "Moving companies I've talked to convert maybe 30% of inquiries. The other 70% aren't saying no  - they just didn't hear back fast enough.",
  },
  "staffing-agencies": {
    pain: "candidate screening and timesheet collection",
    hook: "how many hours your recruiters spend on screening calls that could've been filtered out earlier",
    detail: "Staffing agencies I talk to spend 60% of recruiter time on screening  - most of which is checking boxes that a structured intake form could handle.",
  },
  "daycare-centres": {
    pain: "enrollment paperwork and parent updates",
    hook: "how much paperwork goes into enrolling one new child",
    detail: "Daycares I've talked to spend 45-60 minutes per enrollment on forms alone  - emergency contacts, allergies, pickup authorization, billing. Multiply that by 20-30 kids/year.",
  },
  "pet-grooming": {
    pain: "booking and reminders",
    hook: "how you remind clients when their dog is due for a groom",
    detail: "Most groomers I talk to run on walk-ins and phone calls. Regular reminders could fill 20-30% more slots  - but nobody has time to send them manually.",
  },
};

/**
 * v4 hooks for ICP-only categories. Designed against 10-criterion quality rubric
 * (see sandbox-review/template-quality-audit.md). Differences from v3:
 *  - Opener leads with operational question (no "I noticed", no "quick question -")
 *  - WHY framed as logic/observation, NEVER as fake statistic
 *  - NO numbers unless math-derivable or publicly verifiable
 *  - Single yes/no CTA, never "just reply"
 *  - Real anchor: Kirill is using HIS OWN automation to send this email (true, unique, verifiable)
 *
 * STRICT RULE: zero unsourced claims. If a number appears, it is either:
 *   (a) trivially math-derivable ($200/mo x 12 = $2400/yr)
 *   (b) framed as a question, not a fact ("how many...")
 *   (c) absent
 *
 * Each entry: { question, why, cta }
 */
const V4_HOOKS = {
  "landscaping": {
    question: "When you send a quote and the customer goes quiet for 48 hours, who is responsible for reaching back out - and what happens if you are mid-job when the time comes?",
    why: "For most landscapers running solo or with one crew, the honest answer is \"nobody\" or \"depends.\" The work that goes quiet there is rarely about price. It is about who called back first.",
    cta: "If that sounds like your operation, reply yes and I will send a one-page write-up of how I am closing that same gap on my own outreach.",
  },
  "plumbers": {
    question: "When you are on a job and a new estimate request comes in, what is the path that customer takes to actually hear back from you the same day?",
    why: "If the path is voicemail and hope, that is the gap. Same-day work goes to whoever picks up or calls back first, and the window is short.",
    cta: "If you would change that path if you had a free afternoon, reply yes and I will send the exact setup I am running on my own outreach right now.",
  },
  "electricians": {
    question: "How are quote follow-ups and permit paperwork tracked right now - notebook, spreadsheet, somewhere in your phone, or all in your head?",
    why: "Whichever it is, it is taking time you cannot bill for. The real question is whether that time is one hour a week or six, and most owners do not actually know.",
    cta: "If you would rather know the number than guess, reply yes and I will send a one-page audit framework.",
  },
  "hvac": {
    question: "What happens to last winter's customers who never came back for spring maintenance - is there a system reaching out, or only walk-ins and phone calls?",
    why: "Maintenance work is sold once. The second sale is just a question of who reminds the customer. If nothing reaches out, the work goes to whoever the customer happens to call when something breaks.",
    cta: "If you want to see how I am automating that reminder on my own outreach without it sounding like a bot, reply yes and I will send the one-pager.",
  },
  "roofing": {
    question: "Of your last ten estimates, how many got a callback inside 48 hours, and how many you do not actually know about?",
    why: "Roofing is a long decision. The homeowner is comparing three quotes for a week or more. The deciding factor is rarely price - it is who stays in touch without being annoying.",
    cta: "If you would like a one-page setup for staying in touch without manual reminders, reply yes and I will send it.",
  },
  "cleaning-services": {
    question: "When a recurring client cancels two weeks in a row, who notices and who reaches out - or does it become a hole in the schedule that gets explained later?",
    why: "Recurring revenue compounds quietly. A $200/month client is $2,400 a year and leaves without making noise. The gap usually shows up at month-end, not in the moment.",
    cta: "If you would like a one-page setup for catching cancellations the same week they happen, reply yes and I will send it.",
  },
  "moving-companies": {
    question: "When a quote request comes in at 7pm on a Tuesday, when does that customer actually hear back - same night, next morning, or whenever the office reopens?",
    why: "Moving customers contact several companies in the same hour. Whoever responds first usually books the job. If the answer is \"morning,\" the work is going to whoever is awake.",
    cta: "If you would like a one-page setup for after-hours auto-response that does not sound like a bot, reply yes and I will send it.",
  },
  "auto-repair": {
    question: "How do customers from six months ago hear about their next oil change or inspection - text, email, postcard, or never?",
    why: "If the answer is never, the customer has nothing reminding them. They go to whichever shop they pass on the road first. Most independent shops do not send any reminder at all.",
    cta: "If you would like a one-page setup for automatic reminders that look hand-typed, reply yes and I will send it.",
  },
  "garage-door": {
    question: "When a customer calls about a broken spring at 8am, what is the path that gets that job booked under your name and not your competitor's by 9am?",
    why: "Broken springs are decided in under an hour by whoever can give a price and an arrival window first. Voicemail and \"call you back\" usually loses to whoever picks up.",
    cta: "If you would like a one-page setup for live response without hiring a dispatcher, reply yes and I will send it.",
  },
};

function writeGeneralEmailV4(business, research) {
  const { name, category } = business;
  const hooks = V4_HOOKS[category];
  if (!hooks) return null; // v4 only covers ICP categories

  const firstName = research.ownerName ? research.ownerName.split(" ")[0] : null;
  const greeting = firstName ? `Hi ${firstName},` : "Hi there,";
  const shortName = name.split(/[-– -,]/).map(s => s.trim()).filter(s => s.length > 2)[0] || name;

  // Subject - one of two patterns, both pain-anchored, no curiosity-bait
  const subjectOptions = firstName
    ? [
        `${shortName} - quick question on ${category.replace(/-/g, " ")}`,
        `${firstName}, one question about ${shortName}`,
      ]
    : [
        `${shortName} - one question`,
        `Quick question for ${shortName}`,
      ];
  const subject = subjectOptions[Math.floor(Math.random() * subjectOptions.length)];

  const body = `${greeting}

${hooks.question}

${hooks.why}

${hooks.cta}

- Kirill D.
https://launchsoloai.com
https://linkedin.com/in/kirill-derhachenko`;

  return { subject, body };
}

/**
 * v3 Fixed Template for ALL non-clinic categories.
 * Replaces GPT path. Proven: clinic v2 had 0 spam triggers.
 * Each category gets specific pain hook + detail.
 */
function writeGeneralEmailV3(business, research) {
  const { name, category } = business;
  const firstName = research.ownerName ? research.ownerName.split(" ")[0] : null;
  const greeting = firstName ? `Hi ${firstName},` : "Hi there,";
  const shortName = name.split(/[-– -,]/).map(s => s.trim()).filter(s => s.length > 2)[0] || name;

  // Generate trust-building audit from public data
  let audit = null;
  try {
    audit = generateAudit(business, research);
  } catch {}

  const hooks = CATEGORY_HOOKS[category] || {
    pain: "stuff falling through the cracks",
    hook: "how much of your week goes into small stuff that keeps you from the actual work",
    detail: "Most small business owners I talk to in Calgary are buried in callbacks, scheduling, and follow-ups  - a full day and a half every week that's not the work they started the business for.",
  };

  // Subject  - pain question, specific, human
  const subjectOptions = firstName
    ? [
        `${firstName}  - are you losing jobs to slow follow-up?`,
        `${firstName}, quick question about ${shortName}`,
        `${firstName}  - ${hooks.pain} at ${shortName}`,
      ]
    : [
        `Quick question for ${shortName}`,
        `${shortName}  - are you losing jobs to slow follow-up?`,
      ];
  const subject = subjectOptions[Math.floor(Math.random() * subjectOptions.length)];

  // Use audit paragraph if available (high/medium confidence), fallback to generic hook
  const mainBody = (audit && audit.confidence !== "low")
    ? audit.audit_paragraph
    : `${hooks.hook}?\n\n${hooks.detail}`;

  const ctaBlock = `If that sounds familiar, just reply  - I'll send you the one fix that catches most of it, free. So you can get back to the actual work.`;

  const body = `${greeting}

${audit ? mainBody : `Quick question  - ${mainBody}`}

${ctaBlock}

- Kirill D.
I help service businesses stop losing clients to slow follow-up
https://launchsoloai.com
https://linkedin.com/in/kirill-derhachenko`;

  return { subject, body };
}

/**
 * v2 Fixed Template for clinic categories.
 * Why: GPT-generated emails for clinics consistently produce spammy subject lines and generic bodies.
 * This template is controlled, short, and references real observations.
 */
function writeClinicEmailV2(business, research) {
  const { name, category, website } = business;
  const firstName = research.ownerName ? research.ownerName.split(" ")[0] : null;
  if (!firstName) return null; // v2 REQUIRES owner name  - skip if unknown

  const shortName = name.split(/[-– -,]/).map(s => s.trim()).filter(s => s.length > 2)[0] || name;

  // Pick a specific observation from research (or use category-appropriate fallback)
  let observation = null;
  const excerpt = (research.websiteExcerpt || "").toLowerCase();
  if (excerpt.includes("jane") || excerpt.includes("janeapp")) observation = "you're booking through Jane App";
  else if (excerpt.includes("online booking") || excerpt.includes("book online")) observation = "you offer online booking";
  else if (research.hiringSignal) observation = "you're growing the team";
  else if (excerpt.includes("new patient") || excerpt.includes("new client")) observation = "you're actively taking new patients";
  else if (research.growthSignal) observation = "you've been expanding recently";
  else if (excerpt.includes("review") || excerpt.includes("testimonial")) observation = "your Google reviews are solid";
  // Category-specific fallbacks
  else if (category === "dental-clinics") observation = "you handle scheduling and reminders in-house";
  else if (category === "physiotherapy") observation = "you manage rebookings and intake manually";
  else if (category === "optometrists") observation = "you coordinate appointments and recalls yourself";
  else if (category === "veterinarians") observation = "you handle appointment reminders and prescription refills in-house";
  else observation = "you're running admin in-house";

  // Subject  - specific to them, never spammy
  const subjectOptions = [
    `${firstName}, quick thought on ${shortName}`,
    `Saw ${shortName}  - one idea`,
    `${firstName}  - one thing I noticed about ${shortName}`,
  ];
  const subject = subjectOptions[Math.floor(Math.random() * subjectOptions.length)];

  const body = `Hi ${firstName},

I was looking at ${name}'s website and noticed ${observation}.

Most clinic owners I talk to in Calgary spend 8-12 hours/week on admin  - rebooking no-shows, intake forms, follow-up reminders. That's work that runs itself once set up properly.

I build these as a fixed-price project  - no retainer, no software subscription. You get the workflow, I hand it over, done.

Want me to send you a 2-minute walkthrough of what this looks like for a clinic your size? All over email, no calls needed.

- Kirill D.
I help service businesses stop losing clients to slow follow-up
https://launchsoloai.com
https://linkedin.com/in/kirill-derhachenko`;

  return { subject, body };
}

export async function writeOutreachEmail(business) {
  const { name, category, website, address } = business;
  const roi = INDUSTRY_ROI[category] || DEFAULT_ROI;

  // Step 1: Research this specific business
  let research = { ownerName: null, websiteExcerpt: "", googleSnippets: "", painSignals: [] };
  try {
    research = await researchBusiness(business);
  } catch (e) {
    console.log(`[Writer] Research failed for ${name}: ${e.message}, using fallback`);
  }

  // PREFER pre-found owner name from business data over website-scraped names
  // BUT validate it looks like a real person name first  - scrapers often put
  // business names ("Rehab Solutions"), product words ("Contact Lenses"), or
  // email prefixes ("Optima Eyewear") into ownerName.
  if (business.ownerName) {
    const candidate = business.ownerName.trim();
    const words = candidate.split(/\s+/);
    const bizNameLower = (business.name || "").toLowerCase();
    const emailPrefix = (business.email || "").split("@")[0].toLowerCase();
    // A real person name: 1-3 words, each capitalized, NOT a substring of business name,
    // NOT a common non-person word, NOT the email prefix
    const NON_PERSON = /\b(contact|info|admin|office|team|staff|clinic|dental|physio|optim|eyewear|solutions|services|realty|group|corp|inc|ltd|llp|associates|company|management|consulting|enterprises|capital|financial|medical|health|wellness|repair|auto|home|care|clean|cleaning|landscape|landscaping|moving|travel|fitness|day|pet|roofing|hvac|plumb|plumbing|electric|electrical|insurance|insuring|mortgage|marketing|legal|law|account|accounting|book|booking|notary|staffing|print|veterinar|lenses|learning|centre|center|scheduling|billing|dispatch|maintenance|property|construction|advisory|advisor|wealth|invest|broker)/i;
    const looksLikePersonName = (
      words.length >= 1 && words.length <= 3 &&
      words.every(w => /^[A-Z][a-z]{1,15}$/.test(w)) &&
      !NON_PERSON.test(candidate) &&
      candidate.toLowerCase() !== emailPrefix
    );
    if (looksLikePersonName) {
      research.ownerName = candidate;
    } else {
      // Garbage name  - don't use it, let website research or "Hi there," take over
      console.log(`[Writer] Rejected garbage ownerName "${candidate}" for ${business.name}`);
    }
  }

  // CLINIC CATEGORIES: Use v2 fixed template (no GPT drift, proven structure)
  if (CLINIC_CATEGORIES.has(category)) {
    const v2Result = writeClinicEmailV2(business, research);
    if (v2Result) {
      return {
        subject: v2Result.subject,
        body: v2Result.body,
        senderName: SENDER_NAME,
        senderRole: SENDER_ROLE,
        researchUsed: {
          ownerFound: !!research.ownerName,
          painSignals: research.painSignals,
          hiringSignal: research.hiringSignal,
          templateVersion: "v2-clinic",
        },
        generatedAt: new Date().toISOString(),
      };
    }
    // If v2 failed (no owner name), fall through to GPT but this email will likely be blocked by send-outreach quality gate
    console.log(`[Writer] v2 template skipped for ${name}  - no owner name found, falling through to GPT`);
  }

  // v4 feature flag: opt-in via env or per-business override.
  // Default = v3 (production). Set OUTREACH_TEMPLATE_VERSION=v4 in env to test v4 globally,
  // or pass business.template_version = "v4" to test per-batch.
  // v4 ONLY covers 9 ICP categories (V4_HOOKS keys); falls back to v3 for anything else.
  const useV4 = (env.OUTREACH_TEMPLATE_VERSION === "v4") || (business.template_version === "v4");
  if (useV4 && V4_HOOKS[category]) {
    const v4Result = writeGeneralEmailV4(business, research);
    if (v4Result) {
      return {
        subject: v4Result.subject,
        body: v4Result.body,
        senderName: SENDER_NAME,
        senderRole: SENDER_ROLE,
        researchUsed: {
          ownerFound: !!research.ownerName,
          painSignals: research.painSignals,
          hiringSignal: research.hiringSignal,
          templateVersion: "v4-icp",
        },
        generatedAt: new Date().toISOString(),
      };
    }
  }

  // v3: Use fixed templates for ALL categories (GPT path killed  - 0% reply rate on 103 emails)
  const v3Result = writeGeneralEmailV3(business, research);
  const { subject, body } = v3Result;

  return {
    subject,
    body,
    senderName: SENDER_NAME,
    senderRole: SENDER_ROLE,
    researchUsed: {
      ownerFound: !!research.ownerName,
      painSignals: research.painSignals,
      hiringSignal: research.hiringSignal,
    },
    generatedAt: new Date().toISOString(),
  };
}

// ============================================================
// VOICE AGENT CODE REMOVED 2026-04-27
// Voice agent vertical discontinued 2026-04-22.
// Dead code (VOICE_RECEPTIONIST_CLINIC_ARTIFACTS, VOICE_AGENT_GENERAL_DRAFTS,
// VOICE_AGENT_MISSED_CALL_DRAFTS, writeVoiceReceptionistClinicEmail,
// renderMissedCallDraft, renderVoiceAgentDraft, generateVoiceAgentOutboundPackage,
// generateManualArtifactPackage, VOICE_PAIN, VOICE_IMPL) removed.
// ============================================================

/**
 * Generate a reply script JSON from a warm email reply DB row.
 * Used when .data/reply-scripts/ doesn't have a script for this lead.
 */
export function generateReplyScript(row, rank = 99) {
  const {
    business_name, business_email, reply_type, reply_sentiment,
    action_required, is_meaningful_reply, followup_draft,
    reply_body,
  } = row;

  // Skip non-actionable rows
  const actionable = ["resend_to_owner", "verify_sender", "retry_outreach", "qualify_further"];
  if (!actionable.includes(action_required)) return null;

  const priority = is_meaningful_reply ? "high" : "low";

  // Use existing followup_draft if available
  let subject = `${business_name} - follow-up`;
  let body_bullets = [];

  if (followup_draft) {
    try {
      const draft = typeof followup_draft === "string" ? JSON.parse(followup_draft) : followup_draft;
      if (draft.subject) subject = draft.subject;
      if (draft.body) {
        body_bullets = draft.body.split("\n").map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith("-"));
        body_bullets.push("- Kirill | kirill@launchsoloai.com");
      }
    } catch {}
  }

  if (body_bullets.length === 0) {
    // Fallback bullets based on reply type
    if (reply_type === "redirect" || reply_type === "redirect_resent") {
      body_bullets = [
        `Sent a note a couple of weeks back about saving time on the admin side.`,
        `Still wondering if it reached the right person.`,
        `If quoting or scheduling gets messy during the busy season, I can show you the fix in one email. No call needed.`,
        `- Kirill | kirill@launchsoloai.com`,
      ];
    } else if (reply_type === "verification_challenge") {
      body_bullets = [
        `Tried reaching out recently but the message may not have landed.`,
        `Quick question: when an estimate goes out and the customer goes quiet, who follows up - and what happens if everyone is on-site that day?`,
        `I help service companies automate that follow-up so quotes don't die from silence. Fixed project, no retainer.`,
        `Worth a look?`,
        `- Kirill | kirill@launchsoloai.com`,
      ];
    } else {
      body_bullets = [
        `Following up on a note I sent recently.`,
        `If this isn't the right person, who should I reach?`,
        `- Kirill | kirill@launchsoloai.com`,
      ];
    }
  }

  return {
    rank,
    priority,
    lead: business_name,
    to: row.send_to || business_email,
    subject,
    original_reply: (reply_body || "").slice(0, 120).replace(/\n/g, " "),
    reply_type: reply_type || "unknown",
    action: action_required,
    status: "ready",
    created_at: new Date().toISOString(),
    body_bullets,
  };
}

// Quick test
if (process.argv[1] === (await import("url")).fileURLToPath(import.meta.url)) {
  console.log("[Writer] Testing deep personalization...\n");
  const test = await writeOutreachEmail({
    name: "Calgary Family Dental",
    category: "dental-clinics",
    website: "https://calgaryfamilydental.com",
    address: "Calgary, AB",
  });
  console.log("Subject:", test.subject);
  console.log("\n" + test.body);
  console.log("\nResearch used:", test.researchUsed);
}
