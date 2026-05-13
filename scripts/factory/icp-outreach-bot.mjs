/**
 * icp-outreach-bot.mjs
 *
 * Hourly autonomous ICP outreach loop.
 *
 * Built April 8 2026 after Kirill called out 2 weeks of zero clients. The
 * core problem: cold emails were going to Calgary roofers/plumbers, not
 * solo SaaS founders. fresh-pain-scout finds 300+ real ICP leads per day
 * but nothing was reaching out to them.
 *
 * What this bot does (every hour at :45 via sonnet-bots-daemon):
 *   1. Pulls top 10 fresh-pain leads from last 24h matching ICP keywords
 *   2. Skips any already enriched
 *   3. Enriches via lead-enrichment-bot
 *   4. For warming/ready_buyer: drafts a personalized Reddit DM via
 *      Sonnet 4.6 reply-drafter, signed "- Kirill, Calgary" + launchsoloai.com
 *   5. Quality-checks via draft-quality-checker
 *   6. Dispatches to Telegram via dispatch-reddit-drafts.mjs (Send/Skip buttons)
 *   7. Hard daily cap: max 30 dispatches per day to avoid spam patterns
 *
 * Kirill stays in control - every draft requires his Send button click.
 * The bot only finds + drafts + delivers. It never auto-sends.
 */
import Database from "better-sqlite3";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync, spawn } from "child_process";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { tgSendToKirill } from "./orchestrator.mjs";
import { getWikiContext, readWiki, readPurpose, appendLog } from "../../wiki/reader.mjs";
const _purpose = readPurpose();
// renderMissedCallDraft removed - voice agent discontinued 2026-04-22

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DB_PATH = resolve(ROOT, ".data/linkedin-brand-os.sqlite");
const NODE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/node";
const DAILY_DISPATCH_CAP = 30;
const DAILY_TG_CAP = 3;
const TG_COUNT_FILE = resolve(ROOT, ".data/icp-outreach-tg-count.json");

// DENTAL SPRINT - 24h single-ICP sprint: Calgary dental clinics only
const DENTAL_SPRINT_ACTIVE = true;
const DENTAL_SPRINT_EXPIRES_AT = "2026-05-07T01:18:00.000Z";
const DENTAL_SPRINT_MAX_SENDS = 15;
const DENTAL_SPRINT_COUNTER_FILE = resolve(ROOT, ".data/dental-sprint-count.json");

// Telegram throttle: max DAILY_TG_CAP messages per day. Skipped messages are logged only.
const _tgSkippedMessages = [];
function _readTgCount() {
  try {
    if (!existsSync(TG_COUNT_FILE)) return { date: "", count: 0 };
    return JSON.parse(readFileSync(TG_COUNT_FILE, "utf-8"));
  } catch { return { date: "", count: 0 }; }
}
function _writeTgCount(obj) {
  try { writeFileSync(TG_COUNT_FILE, JSON.stringify(obj, null, 2)); } catch {}
}
async function tgThrottled(msg) {
  const today = new Date().toISOString().slice(0, 10);
  const state = _readTgCount();
  if (state.date !== today) { state.date = today; state.count = 0; }
  state.count++;
  _writeTgCount(state);
  if (state.count > DAILY_TG_CAP) {
    console.log(`[icp-outreach] TG throttled (${state.count}/${DAILY_TG_CAP} today), skipping send`);
    _tgSkippedMessages.push(msg.slice(0, 120));
    return;
  }
  // If this is the last allowed message, append a note about future skips
  if (state.count === DAILY_TG_CAP) {
    msg += "\n\n(Daily TG limit reached - further batch notifications suppressed. Check logs.)";
  }
  return tgSendToKirill(msg).catch(() => {});
}


// ============================================================
// DEAD VOICE AGENT CONSTANTS REMOVED 2026-04-27
// Removed: EMERGENCY_MICRO_TEST_*, PRIORITY_EMERGENCY_*, EMERGENCY_AFTERHOURS_*,
// LOCAL_SERVICE_*, PILOT_OFFER, HVAC_MISSED_CALL_OFFER, NICHE_PILOT_OFFER_*,
// COMPETITOR_DISPLACEMENT_*, HVAC_FREE_SETUP_*, RECEPTIONIST_HIRING_*,
// HIRING_NOW_REC_*, GOOGLE_REVIEWS_*, PUBLIC_REVIEW_*, FB_EMERGENCY_REC_*,
// CALGARY_GEO_INTENT_*, CANADA_GEO_OFFER, FOUNDER_CALL_AUDIT_*,
// COMPETITOR_PRICING_INTERCEPT_*, SPANISH_BILINGUAL_*, LEGACY_ANSWERING_SWITCH_*,
// EXPANDED_HOURS_EVENT_*, PRICING_SHOCK_*, AI_RECEPTIONIST_SHOPPING_*,
// CALGARY_EMERGENCY_ADVERTISER_*, VETERINARY_PROBE_*, MISSED_CALL_REVIEW_*,
// GEO_COMPLAINT_*, MISSED_CALL_AUDIT_*
// ============================================================

const ICP_PATTERNS = [
  "%first%customer%", "%no traction%", "%no users%", "%first paying%",
  "%paying user%", "%vibe%cod%", "%just launched%", "%MVP%",
  "%solo founder%", "%solo saas%", "%first 10%", "%find demand%",
  "%get my first%", "%no one%using%", "%launched%week%", "%launched%month%",
  "%where%market%", "%how to find%customer%",
  // RCIC / immigration vertical - primary target: 4+hr manual workflow, zero AI competitors
  "%rcic%", "%immigration consultant%", "%immigration lawyer%",
  "%regulated canadian immigration%", "%work permit%",
  "%express entry%", "%permanent residence%", "%study permit%",
  "%case intake%", "%immigration file%", "%ircc%",
  "%h&c%", "%humanitarian and compassionate%", "%noc classification%",
  "%spousal open work permit%", "%cicc%",
  // Calgary construction / trades - implementation-intent buyers
  "%construction%ai%", "%trades%ai%", "%hvac%ai%",
  "%plumbing%ai%", "%electrical%ai%", "%oilfield%ai%",
  "%estimating%software%", "%quoting%software%", "%quote%automation%",
  "%job%costing%software%", "%field service%software%",
  "%construction%workflow%", "%trades%admin%",
  "%contractor%admin%", "%hvac%quote%", "%plumbing%estimate%",
  "%automate%invoice%", "%automate%quote%",
  "%electrician%admin%", "%oilfield%service%workflow%",
  // Canadian SMB automation intent - explicit tool + workflow ask
  "%zapier%small business%", "%zapier%canada%", "%zapier%automate%",
  "%make.com%business%", "%make.com%automate%",
  "%n8n%follow%up%", "%n8n%lead%", "%n8n%business%",
  "%crm%automation%owner%", "%crm%follow%up%automate%",
  "%intake%automate%", "%quoting%automate%contractor%",
  "%admin automation%small business%", "%owner%needs%automation%",
  // Migration pain - SMB owners replacing spreadsheets/disconnected tools with Jobber, HubSpot, QuickBooks, GoHighLevel, Make/Zapier
  "%spreadsheet%jobber%", "%jobber%setup%", "%replace%spreadsheet%crm%",
  "%quickbooks%automate%reminder%", "%quickbooks%follow%up%automate%",
  "%hubspot%setup%contractor%", "%hubspot%small business%setup%",
  "%gohighlevel%setup%", "%go high level%setup%", "%ghl%automate%",
  "%zapier%replace%manual%", "%make%replace%spreadsheet%",
  "%switching%spreadsheet%crm%", "%migrate%spreadsheet%", "%spreadsheet%automation%crm%",
  "%disconnected%tools%automate%", "%replace%manual%admin%tool%",
  // Calgary-local buyer-intent: owners asking for help choosing or implementing AI tools
  "%calgary%small business%ai%", "%calgary%business%ai%help%",
  "%calgary%ai%implement%", "%calgary%chatgpt%workflow%",
  "%alberta%small business%chatgpt%", "%alberta%chatgpt%workflow%",
  "%calgary%dental%ai%", "%calgary%entrepreneur%automate%admin%",
  // Phone system switching - Canada SMB owners discussing Grasshopper, Yeastar, voicemail overload, missed-call admin pain
  // Pitch: back-office workflow automation, NOT voice receptionist (discontinued 2026-04-22)
  "%grasshopper%small business%", "%grasshopper%missed%call%",
  "%yeastar%small business%", "%yeastar%phone%",
  "%voicemail%overload%small business%", "%missed%call%admin%",
  "%receptionist%too expensive%small business%", "%phone system%small business%canada%",
  "%after hours%voicemail%small business%", "%missed call%admin%overload%",
  "%grasshopper%canada%", "%replace%receptionist%small business%",
  // Calgary real estate - implementation-intent: agents, brokers, small teams asking to automate lead follow-up, CRM cleanup, listing/admin, transaction coordination
  "%real estate%crm%automate%", "%realtor%follow%up%automate%", "%realtor%lead%follow%up%",
  "%real estate%transaction%coordination%", "%realtor%admin%automate%", "%listing%admin%workflow%",
  "%real estate%agent%crm%", "%broker%crm%cleanup%", "%real estate%zapier%", "%realtor%make.com%",
  "%calgary%real estate%workflow%", "%calgary%realtor%crm%", "%real estate%n8n%",
  "%transaction coordinator%automate%", "%listing coordinator%workflow%",
  // Dental and physiotherapy clinics - front-desk overload, no-shows, intake/admin bottlenecks, manual booking
  "%dental%front desk%", "%dental%no-show%", "%dental%intake%manual%",
  "%dental%admin%overwhelm%", "%dental%scheduling%manual%",
  "%physiotherapy%admin%", "%physio%front desk%", "%physio%no-show%",
  "%physio%intake%", "%physio%scheduling%manual%",
  "%clinic%front desk%overwhelm%", "%clinic%admin%bottleneck%",
  "%clinic%booking%follow%up%", "%clinic manager%scheduling%",
  // Canada field-service ops - plumbers, HVAC, electricians, garage door: dispatch/quoting/invoicing/Jobber pain
  "%jobber%dispatch%", "%jobber%problem%", "%jobber%help%", "%jobber%automate%",
  "%housecall pro%", "%housecall%pro%problem%", "%servicetitan%", "%servicetitan%problem%",
  "%dispatch%chaos%", "%dispatch%manual%", "%dispatch%schedule%problem%",
  "%plumber%quoting%", "%plumber%invoice%manual%", "%plumber%admin%",
  "%hvac%dispatch%", "%hvac%quoting%manual%", "%hvac%invoice%backlog%",
  "%electrician%quoting%", "%electrician%dispatch%", "%electrician%admin%overhead%",
  "%garage door%invoice%", "%garage door%dispatch%", "%garage door%quoting%",
  "%field service%dispatch%", "%field service%quoting%manual%", "%field service%invoice%",
  "%trades%missed follow%up%", "%trades%quote%delay%", "%trades%invoice%backlog%",
  "%plumbing%admin%overload%", "%electrical%admin%overload%", "%hvac%admin%overload%",
  // Canada clinic software distress - Jane App, Dentrix, Open Dental user complaints
  "%jane app%", "%jane app%problem%", "%jane app%help%", "%jane app%hate%",
  "%dentrix%", "%dentrix%problem%", "%dentrix%slow%", "%dentrix%expensive%",
  "%open dental%", "%open dental%issue%", "%open dental%help%",
  "%clinic%insurance%paperwork%", "%dental%insurance%paperwork%",
  "%physio%insurance%billing%", "%medical%insurance%claim%manual%",
  "%patient%recall%manual%", "%manual%recall%dental%", "%recall%spreadsheet%",
  "%medical admin%overwhelm%", "%small medical%admin%", "%medical office%admin%manual%",
];


// ============================================================
// CURRENT OFFER CATALOG (active as of 2026-04-27)
// ============================================================
const CURRENT_OFFERS = {
  vibe_code_audit: "48-hour codebase audit - reads your stack, identifies bottlenecks and scale risks, delivers written report with fixes. $1,500-$2,500 CAD.",
  reply_chaser: "Reply Chaser Automation - automated follow-up system that catches leads going cold. $1,500 CAD.",
  first_10_customers: "30-day sales motion build - ICP targeting, outreach copy, lead pipeline setup for founders with 0 consistent leads. $2,000 CAD.",
  custom_ai_build: "Custom AI / n8n workflow build - end-to-end automation for your specific ops bottleneck. $2,500-$8,000 CAD.",
  workflow_audit: "$1,500 AI Workflow Audit - identify the single highest-ROI workflow to automate and deliver a build plan within 72 hours. $1,500 CAD.",
};

function log(msg) {
  console.log(`${new Date().toISOString()} [icp-outreach] ${msg}`);
}

const RCIC_KEYWORDS = [
  'rcic', 'regulated canadian immigration consultant',
  'immigration consultant', 'immigration lawyer',
  'immigration law', 'work permit', 'express entry',
  'permanent residence', 'pr application', 'study permit',
  'case intake', 'client intake', 'immigration file',
  'h&c', 'humanitarian and compassionate', 'noc classification',
  'spousal open work permit', 'ircc portal', 'cicc',
];

function isRcicLead(lead, enrichment) {
  const haystack = [
    lead.pain_description || '',
    enrichment?.pain_category || '',
    lead.source_url || '',
    enrichment?.pain_evidence || '',
    lead.industry || '',
    lead.name || '',
  ].join(' ').toLowerCase();
  return RCIC_KEYWORDS.some(k => haystack.includes(k));
}

const OUTPLACEMENT_KEYWORDS = [
  'outplacement', 'career transition', 'workforce transition',
  'executive transition', 'outplacement firm',
];

function isOutplacementLead(lead, enrichment) {
  const haystack = [
    lead.pain_description || '',
    enrichment?.pain_category || '',
    lead.source_url || '',
    enrichment?.pain_evidence || '',
    lead.industry || '',
  ].join(' ').toLowerCase();
  return OUTPLACEMENT_KEYWORDS.some(k => haystack.includes(k));
}

const DENTAL_KEYWORDS = [
  'dental', 'dentist', 'orthodontist', 'orthodontic', 'dental clinic',
  'teeth whitening', 'tooth extraction', 'root canal', 'dental office',
  'family dentistry', 'pediatric dentist', 'cosmetic dentist',
];

function isDentalCalgaryLead(lead, enrichment) {
  const haystack = [
    lead.pain_description || '',
    lead.name || '',
    lead.source_url || '',
    enrichment?.industry || '',
    lead.industry || '',
    enrichment?.pain_category || '',
  ].join(' ').toLowerCase();
  const hasDental = DENTAL_KEYWORDS.some(k => haystack.includes(k));
  const hasCalgary = haystack.includes('calgary') || haystack.includes('alberta');
  return hasDental && hasCalgary;
}

const CALGARY_CONSTRUCTION_KEYWORDS = [
  'general contractor', 'construction', 'trades', 'hvac', 'plumbing', 'plumber',
  'electrical', 'electrician', 'oilfield', 'oil field', 'roofing', 'framing',
  'drywall', 'mechanical contractor', 'field service',
];

const CALGARY_CONSTRUCTION_INTENT_SIGNALS = [
  ' ai ', 'automation', 'automate', 'workflow', 'software', 'admin', 'overhead',
  'paperwork', 'quoting', 'quote', 'estimate', 'estimating', 'job costing',
  'invoice', 'billing', 'scheduling', 'dispatch', 'overwhelm', 'manual', 'bottleneck',
];

function isCalgaryConstructionLead(lead, enrichment) {
  const haystack = [
    lead.pain_description || '',
    enrichment?.pain_category || '',
    lead.source_url || '',
    enrichment?.pain_evidence || '',
    lead.industry || '',
    lead.name || '',
  ].join(' ').toLowerCase();
  const hasTrades = CALGARY_CONSTRUCTION_KEYWORDS.some(k => haystack.includes(k));
  const hasIntent = CALGARY_CONSTRUCTION_INTENT_SIGNALS.some(k => haystack.includes(k));
  return hasTrades && hasIntent;
}

const MIGRATION_PAIN_TOOLS = [
  'jobber', 'hubspot', 'quickbooks', 'quick books', 'gohighlevel', 'go high level', 'ghl',
];

const MIGRATION_PAIN_SIGNALS = [
  'spreadsheet', 'replace', 'switch', 'migrate', 'disconnected', 'manual admin',
  'automate reminders', 'automate follow', 'setup', 'set up',
];

const CALGARY_SERVICE_KEYWORDS = [
  'accounting', 'bookkeeping', 'accountant', 'bookkeeper',
  'law firm', 'lawyer', 'notary', 'legal services',
  'real estate', 'realtor', 'mortgage broker', 'mortgage agent',
  'insurance broker', 'financial advisor', 'financial planner',
  'marketing agency', 'digital agency', 'digital marketing',
  'physiotherapy', 'physiotherapist', 'chiropractic', 'chiropractor',
  'optometry', 'optometrist', 'medical clinic',
  'veterinary', 'vet clinic', 'animal clinic',
  'restaurant', 'catering', 'food service',
  'hair salon', 'barbershop', 'salon', 'spa', 'aesthetics',
  'property management', 'property manager',
  'staffing agency', 'recruitment agency',
  'consulting firm', 'advisory firm',
];

const CALGARY_SERVICE_INTENT_SIGNALS = [
  'admin', 'manual', 'automate', 'automation', 'workflow',
  'spreadsheet', 'overhead', 'intake', 'onboarding',
  'follow up', 'follow-up', 'bottleneck', 'repetitive',
  'paperwork', 'data entry', 'too much time', 'time consuming',
];

function isCalgaryServiceBusiness(lead, enrichment) {
  const haystack = [
    lead.pain_description || '',
    enrichment?.pain_category || '',
    lead.source_url || '',
    enrichment?.pain_evidence || '',
    lead.industry || '',
    lead.name || '',
  ].join(' ').toLowerCase();
  const hasCalgary = haystack.includes('calgary') || haystack.includes('alberta');
  const hasService = CALGARY_SERVICE_KEYWORDS.some(k => haystack.includes(k));
  const hasIntent = CALGARY_SERVICE_INTENT_SIGNALS.some(k => haystack.includes(k));
  return hasCalgary && hasService && hasIntent;
}

function isMigrationPainLead(lead, enrichment) {
  const haystack = [
    lead.pain_description || '',
    enrichment?.pain_category || '',
    lead.source_url || '',
    enrichment?.pain_evidence || '',
    lead.industry || '',
  ].join(' ').toLowerCase();
  const hasTool = MIGRATION_PAIN_TOOLS.some(k => haystack.includes(k));
  const hasSignal = MIGRATION_PAIN_SIGNALS.some(k => haystack.includes(k));
  return hasTool && hasSignal;
}

const CALGARY_REAL_ESTATE_KEYWORDS = [
  'real estate agent', 'realtor', 'real estate broker', 'real estate broker',
  'real estate team', 'real estate brokerage', 'listing coordinator',
  'transaction coordinator', 'buyer agent', 'seller agent',
];

const CALGARY_REAL_ESTATE_INTENT_SIGNALS = [
  'lead follow-up', 'lead follow up', 'followup', 'follow-up automation',
  'crm cleanup', 'crm setup', 'crm automation', 'crm',
  'listing admin', 'listing workflow', 'transaction coordination',
  'automate', 'automation', 'zapier', 'make.com', 'n8n',
  'spreadsheet', 'manual admin', 'admin overhead', 'workflow',
];

function isCalgaryRealEstateLead(lead, enrichment) {
  const haystack = [
    lead.pain_description || '',
    enrichment?.pain_category || '',
    lead.source_url || '',
    enrichment?.pain_evidence || '',
    lead.industry || '',
    lead.name || '',
  ].join(' ').toLowerCase();
  const hasRealEstate = CALGARY_REAL_ESTATE_KEYWORDS.some(k => haystack.includes(k));
  const hasIntent = CALGARY_REAL_ESTATE_INTENT_SIGNALS.some(k => haystack.includes(k));
  return hasRealEstate && hasIntent;
}

const PHONE_SYSTEM_SWITCHING_KEYWORDS = [
  'grasshopper', 'yeastar', 'virtual phone', 'business phone system',
  'phone system', 'voicemail', 'missed call', 'after hours call',
  'receptionist', 'front desk', 'answering service',
];

const PHONE_SYSTEM_SWITCHING_SIGNALS = [
  'too expensive', 'overload', 'admin', 'small business', 'canada',
  'missed call', 'voicemail', 'after hours', 'replacing', 'switching from',
  'can\'t afford', 'overwhelmed', 'back office', 'workflow',
];

function isPhoneSystemSwitchingLead(lead, enrichment) {
  const haystack = [
    lead.pain_description || '',
    enrichment?.pain_category || '',
    lead.source_url || '',
    enrichment?.pain_evidence || '',
    lead.industry || '',
    lead.name || '',
  ].join(' ').toLowerCase();
  const hasPhone = PHONE_SYSTEM_SWITCHING_KEYWORDS.some(k => haystack.includes(k));
  const hasSignal = PHONE_SYSTEM_SWITCHING_SIGNALS.some(k => haystack.includes(k));
  return hasPhone && hasSignal;
}

const CLINIC_ADMIN_KEYWORDS = [
  'dental office', 'dental clinic', 'dentist', 'dental practice',
  'physiotherapy', 'physiotherapist', 'physio clinic', 'physio practice',
  'clinic manager', 'dental front desk', 'physio front desk',
];

const CLINIC_ADMIN_INTENT_SIGNALS = [
  'front desk', 'overwhelmed', 'no-show', 'no show', 'noshows', 'intake',
  'manual booking', 'booking follow', 'admin bottleneck', 'scheduling',
  'manual', 'admin', 'overload', 'bottleneck', 'automate',
];

function isClinicAdminPainLead(lead, enrichment) {
  const haystack = [
    lead.pain_description || '',
    enrichment?.pain_category || '',
    lead.source_url || '',
    enrichment?.pain_evidence || '',
    lead.industry || '',
    lead.name || '',
  ].join(' ').toLowerCase();
  const hasClinic = CLINIC_ADMIN_KEYWORDS.some(k => haystack.includes(k));
  const hasIntent = CLINIC_ADMIN_INTENT_SIGNALS.some(k => haystack.includes(k));
  return hasClinic && hasIntent;
}

const CLINIC_SOFTWARE_DISTRESS_CLINIC_TYPES = [
  'dental office', 'dental clinic', 'dentist', 'dental practice',
  'physiotherapy', 'physiotherapist', 'physio clinic', 'physio practice',
  'medical admin', 'medical office admin', 'clinic admin', 'clinic manager',
  'small medical clinic', 'medical receptionist',
];

const CLINIC_SOFTWARE_DISTRESS_SIGNALS = [
  'jane app', 'dentrix', 'open dental',
  'insurance paperwork', 'insurance billing', 'insurance claim',
  'manual recall', 'patient recall', 'recall list', 'recall spreadsheet',
  'no-show', 'no show', 'intake form',
];

function isClinicSoftwareDistressLead(lead, enrichment) {
  const haystack = [
    lead.pain_description || '',
    enrichment?.pain_category || '',
    lead.source_url || '',
    enrichment?.pain_evidence || '',
    lead.industry || '',
    lead.name || '',
  ].join(' ').toLowerCase();
  const hasSoftwareMention = ['jane app', 'dentrix', 'open dental'].some(k => haystack.includes(k));
  const hasClinicType = CLINIC_SOFTWARE_DISTRESS_CLINIC_TYPES.some(k => haystack.includes(k));
  const hasDistressSignal = CLINIC_SOFTWARE_DISTRESS_SIGNALS.some(k => haystack.includes(k));
  return (hasSoftwareMention || hasClinicType) && hasDistressSignal;
}

async function draftClinicAdminPainReply(lead, enrichment) {
  const prompt = `You are drafting a short outreach DM from Kirill, who builds AI workflow automation, to a dental or physiotherapy clinic manager or owner he found via Reddit, Facebook, or LinkedIn.

LEAD CONTEXT:
- Name/Username: ${lead.name}
- Post/context: ${lead.pain_description?.split("\n")[0] || ""}
- URL: ${lead.source_url || ""}

WRITING BRIEF:
- Context: dental and physio clinics in Canada lose 2-4 hours per day to manual front-desk admin - patient intake forms processed by hand, no-show follow-up done by phone, and booking reminders sent one by one. No AI vendor is building specifically for this vertical.
- Pain: front desk staff spend most of their time on tasks that have a direct automation fix - intake form routing, no-show follow-up calls, appointment reminder sequences, and manual rebooking after cancellations. Each no-show at a dental clinic costs $150-400 CAD in lost chair time.
- Offer: a clinic admin automation that handles intake form routing to the right staff member, automated no-show follow-up and rebooking prompts, and appointment reminder sequences - built in one week, no new software to buy.
- SR&ED angle: SR&ED grant covers 35-45% of the build cost - immediate ROI, no capital risk.
- CTA: 15-minute call to walk through the exact workflow for their clinic size and booking volume.

WRITING RULES (ABSOLUTE):
- Under 150 words total
- Bullet-point format (not prose paragraphs) - this is a DM
- Peer-to-peer tone, NOT vendor tone
- Reference the specific pain from their post - prove you read it
- NO em-dashes - use hyphens only
- NO money-back guarantees
- NO AI-tells: delve, leverage, robust, seamless, navigate, foster, embark
- Sign exactly: "- Kirill, Calgary\\nlaunchsoloai.com"

Output ONLY the DM body. No preamble, no JSON, no markdown fences. Just the message.`;

  const r = spawnSync(NODE_BIN, ["--input-type=module", "-e", `
    import { spawnSync } from "child_process";
    const r = spawnSync("$HOME/.nvm/versions/node/v22.22.2/bin/claude",
      ["-p", "--model", "claude-sonnet-4-6", "--max-turns", "3"],
      { input: ${JSON.stringify(prompt)}, encoding: "utf-8", timeout: 5*60*1000 });
    process.stdout.write(r.stdout || "");
    if (r.stderr) process.stderr.write(r.stderr);
  `], { encoding: "utf-8", timeout: 6 * 60 * 1000 });

  return (r.stdout || "").trim();
}

async function draftClinicSoftwareDistressReply(lead, enrichment) {
  const prompt = `You are drafting a short outreach DM from Kirill, who builds AI workflow automation, to a Canadian dental, physio, or small medical admin or clinic manager he found via Reddit, Facebook, or LinkedIn.

LEAD CONTEXT:
- Name/Username: ${lead.name}
- Post/context: ${lead.pain_description?.split("\n")[0] || ""}
- URL: ${lead.source_url || ""}

WRITING BRIEF:
- Context: this person uses Jane App, Dentrix, or Open Dental and is still drowning in manual work the software was supposed to eliminate - insurance paperwork done by hand, patient recalls managed on a spreadsheet, no-show follow-up done by phone call.
- Pain: clinic management software covers scheduling and billing basics but leaves insurance claim paperwork, patient recall lists, and no-show rebooking as entirely manual steps. Each no-show costs $150-400 CAD in lost chair time. Insurance paperwork alone runs 1-2 hours per front-desk shift.
- Offer: a clinic workflow automation layer that runs on top of their existing software - no replacement needed. Automated no-show follow-up and rebooking sequences, insurance claim pre-fill from patient file data, automated patient recall reminders. Built in one week.
- SR&ED angle: SR&ED grant covers 35-45% of the build cost - immediate ROI, no capital risk.
- CTA: 15-minute call to map the exact workflow gaps in their current setup.

WRITING RULES (ABSOLUTE):
- Under 150 words total
- Bullet-point format (not prose paragraphs) - this is a DM
- Peer-to-peer tone, NOT vendor tone
- Reference the specific software or pain from their post - prove you read it
- NO em-dashes - use hyphens only
- NO money-back guarantees
- NO AI-tells: delve, leverage, robust, seamless, navigate, foster, embark
- Sign exactly: "- Kirill, Calgary\\nlaunchsoloai.com"

Output ONLY the DM body. No preamble, no JSON, no markdown fences. Just the message.`;

  const r = spawnSync(NODE_BIN, ["--input-type=module", "-e", `
    import { spawnSync } from "child_process";
    const r = spawnSync("$HOME/.nvm/versions/node/v22.22.2/bin/claude",
      ["-p", "--model", "claude-sonnet-4-6", "--max-turns", "3"],
      { input: ${JSON.stringify(prompt)}, encoding: "utf-8", timeout: 5*60*1000 });
    process.stdout.write(r.stdout || "");
    if (r.stderr) process.stderr.write(r.stderr);
  `], { encoding: "utf-8", timeout: 6 * 60 * 1000 });

  return (r.stdout || "").trim();
}

function readDentalSprintCount() {
  try {
    if (!existsSync(DENTAL_SPRINT_COUNTER_FILE)) return { date: '', count: 0 };
    return JSON.parse(readFileSync(DENTAL_SPRINT_COUNTER_FILE, 'utf-8'));
  } catch { return { date: '', count: 0 }; }
}
function writeDentalSprintCount(obj) {
  try { writeFileSync(DENTAL_SPRINT_COUNTER_FILE, JSON.stringify(obj, null, 2)); } catch {}
}

async function checkDentalWebsiteTriggers(websiteUrl) {
  if (!websiteUrl || websiteUrl.includes('reddit.com') || websiteUrl.includes('yelp.com')) return null;
  const prompt = `Fetch this dental clinic website and analyze the homepage and contact/booking pages. Return ONLY a JSON object with these exact fields:
- has_online_booking: true/false - is there an online booking form, button, or booking widget?
- has_afterhours_handling: true/false - is there mention of after-hours calls, 24/7 line, or emergency phone number?
- has_emergency_instruction: true/false - is there explicit emergency/after-hours guidance or a dedicated emergency page?
- has_sms_option: true/false - is there any SMS, text-to-book, or text messaging option?
- trigger_found: true/false - true if has_online_booking is true AND at least one of the other three is false

Website: ${websiteUrl}

Return ONLY valid JSON. No other text.`;

  const r = spawnSync(NODE_BIN, ['--input-type=module', '-e', `
    import { spawnSync } from "child_process";
    const r = spawnSync("$HOME/.nvm/versions/node/v22.22.2/bin/claude",
      ["-p", "--model", "claude-sonnet-4-6", "--max-turns", "3"],
      { input: ${JSON.stringify(prompt)}, encoding: "utf-8", timeout: 5*60*1000 });
    process.stdout.write(r.stdout || "");
    if (r.stderr) process.stderr.write(r.stderr);
  `], { encoding: 'utf-8', timeout: 6 * 60 * 1000 });

  try {
    const output = (r.stdout || '').trim();
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch {}
  return null;
}

async function draftDentalMissedCallAudit(lead, enrichment, triggers) {
  const missingItems = [];
  if (triggers) {
    if (!triggers.has_afterhours_handling) missingItems.push('no after-hours call handling');
    if (!triggers.has_emergency_instruction) missingItems.push('no emergency contact instruction');
    if (!triggers.has_sms_option) missingItems.push('no SMS/text option');
  }
  const triggerContext = missingItems.length > 0
    ? `Online booking is live on the site but ${missingItems.join(' and ')}.`
    : 'Dental clinic with online booking visible.';

  const prompt = `You are drafting a short cold outreach message from Kirill, a Calgary-based AI workflow consultant, to a Calgary dental clinic.

CLINIC CONTEXT:
- Clinic name / contact: ${lead.name}
- Website: ${lead.source_url || 'not available'}
- Website observation: ${triggerContext}

OFFER: Missed-Call Recovery Audit - fixed-scope, 48-hour turnaround, delivers:
1. A custom call-flow map showing exactly where calls are dropping (after-hours, overflow, no SMS)
2. An ROI estimate: estimated missed calls per week x new patient lifetime value ($800-$2,000 CAD per new patient in Calgary)
3. A 3-step fix recommendation specific to this clinic's setup
Audit price: CA$297

WRITING BRIEF:
- Opening: reference the specific gap found on their site - prove you looked at it
- Pain: a new patient calling after 5pm or on a weekend who hits voicemail calls the next clinic. Each missed new patient is $800-$2,000 CAD in lifetime value.
- Offer frame: this is a fixed audit, not a product pitch. Deliverable in 48 hours.
- CTA: 10-minute call to confirm audit scope

WRITING RULES (ABSOLUTE):
- Under 180 words total
- Bullet-point format for pain points, prose for opening and CTA
- Peer tone, NOT vendor tone
- Reference the SPECIFIC gap found - no generic AI automation pitch
- NO em-dashes - use hyphens only
- NO money-back guarantees
- NO AI-tells: delve, leverage, robust, seamless, navigate, foster, embark
- Sign exactly: "- Kirill, Calgary\\nlaunchsoloai.com"

Output ONLY the message body. No subject line, no preamble, no JSON, no markdown fences. Just the message.`;

  const r = spawnSync(NODE_BIN, ['--input-type=module', '-e', `
    import { spawnSync } from "child_process";
    const r = spawnSync("$HOME/.nvm/versions/node/v22.22.2/bin/claude",
      ["-p", "--model", "claude-sonnet-4-6", "--max-turns", "3"],
      { input: ${JSON.stringify(prompt)}, encoding: "utf-8", timeout: 5*60*1000 });
    process.stdout.write(r.stdout || "");
    if (r.stderr) process.stderr.write(r.stderr);
  `], { encoding: 'utf-8', timeout: 6 * 60 * 1000 });

  return (r.stdout || '').trim();
}

function runEnrichment(leadId) {
  const r = spawnSync(NODE_BIN, ["scripts/factory/lead-enrichment-bot.mjs", leadId], {
    cwd: ROOT, encoding: "utf-8", timeout: 3 * 60 * 1000,
  });
  return r.stdout + r.stderr;
}

// Wiki outreach rules - loaded once, injected into every draft prompt
const OUTREACH_RULES = readWiki("market/learned-outreach.md");
const DEAD_CHANNELS = readWiki("market/dead-channels.md");

async function draftOutplacementReply(lead, enrichment) {
  const prompt = `You are drafting a short outreach DM from Kirill, who builds AI workflow automation, to a contact at an outplacement or career transition firm he found via Reddit.

LEAD CONTEXT:
- Username: ${lead.name}
- Post/context: ${lead.pain_description?.split("\n")[0] || ""}
- URL: ${lead.source_url}

WRITING BRIEF:
- Opening: Q1-Q2 is surge season for outplacement - layoffs are up 40% YoY and firms are taking on more candidates than consultant capacity can handle.
- Pain: consultants spending 3-4 hours per day on manual candidate intake, job sourcing, and spreadsheet queue management across 50-100 active candidates - that is the capacity ceiling.
- Offer: a candidate intake plus job-match pipeline that cuts coordinator time by 60%, built in one week, no new software to buy.
- CTA: 15-minute call to show the exact workflow.

WRITING RULES (ABSOLUTE):
- Under 150 words total
- Bullet-point format (not prose paragraphs) - this is a DM
- Peer-to-peer tone, NOT vendor tone
- NO em-dashes - use hyphens only
- NO money-back guarantees
- NO AI-tells: delve, leverage, robust, seamless, navigate, foster, embark
- Sign exactly: "- Kirill, Calgary\\nlaunchsoloai.com"

Output ONLY the DM body. No preamble, no JSON, no markdown fences. Just the message.`;

  const r = spawnSync(NODE_BIN, ["--input-type=module", "-e", `
    import { spawnSync } from "child_process";
    const r = spawnSync("$HOME/.nvm/versions/node/v22.22.2/bin/claude",
      ["-p", "--model", "claude-sonnet-4-6", "--max-turns", "3"],
      { input: ${JSON.stringify(prompt)}, encoding: "utf-8", timeout: 5*60*1000 });
    process.stdout.write(r.stdout || "");
    if (r.stderr) process.stderr.write(r.stderr);
  `], { encoding: "utf-8", timeout: 6 * 60 * 1000 });

  return (r.stdout || "").trim();
}

async function draftCalgaryConstructionReply(lead, enrichment) {
  const prompt = `You are drafting a short outreach DM from Kirill, who builds AI workflow automation, to a Calgary construction or trades business owner he found via Reddit.

LEAD CONTEXT:
- Username: ${lead.name}
- Post/context: ${lead.pain_description?.split("\n")[0] || ""}
- URL: ${lead.source_url || ""}

WRITING BRIEF:
- Context: Calgary construction and trades owners are losing 3-5 hours per day to quoting, estimating, invoicing, and job costing admin that should take 30 minutes.
- Pain: manual quote generation runs 45-90 minutes per job when field data has to be re-entered in the office; job costing is done in spreadsheets 2-3 days after a job closes; invoicing backs up because the foreman is still in the field.
- Offer: a quoting and job admin automation built for their trade - pre-filled quote templates from field notes or site photos, auto-generated invoices on job completion, and a single-screen job status board. Built in one week, no new software to buy.
- SR&ED angle: SR&ED grant covers 35-45% of the build cost - immediate ROI, no capital risk.
- CTA: 15-minute call to show the exact workflow for their trade and job volume.

WRITING RULES (ABSOLUTE):
- Under 150 words total
- Bullet-point format (not prose paragraphs) - this is a DM
- Peer-to-peer tone, NOT vendor tone
- Reference the specific pain from their post - prove you read it
- NO em-dashes - use hyphens only
- NO money-back guarantees
- NO AI-tells: delve, leverage, robust, seamless, navigate, foster, embark
- Sign exactly: "- Kirill, Calgary\\nlaunchsoloai.com"

Output ONLY the DM body. No preamble, no JSON, no markdown fences. Just the message.`;

  const r = spawnSync(NODE_BIN, ["--input-type=module", "-e", `
    import { spawnSync } from "child_process";
    const r = spawnSync("$HOME/.nvm/versions/node/v22.22.2/bin/claude",
      ["-p", "--model", "claude-sonnet-4-6", "--max-turns", "3"],
      { input: ${JSON.stringify(prompt)}, encoding: "utf-8", timeout: 5*60*1000 });
    process.stdout.write(r.stdout || "");
    if (r.stderr) process.stderr.write(r.stderr);
  `], { encoding: "utf-8", timeout: 6 * 60 * 1000 });

  return (r.stdout || "").trim();
}

async function draftRcicReply(lead, enrichment) {
  const prompt = `You are drafting a short outreach DM from Kirill, who builds AI workflow automation, to a Regulated Canadian Immigration Consultant (RCIC) or immigration lawyer he found via Reddit or LinkedIn.

LEAD CONTEXT:
- Name/Username: ${lead.name}
- Post/context: ${lead.pain_description?.split("\n")[0] || ""}
- URL: ${lead.source_url || lead.linkedin_url || ""}

WRITING BRIEF:
- Context: June 30 IRCC deadline for several Express Entry and PR streams is driving a case volume surge right now. RCIC practices are managing more active files than ever with the same manual workflows.
- Market gap: no AI vendor is building tools specifically for RCIC practices - every automation tool targets generic legal or project management use cases, not immigration case workflows.
- Pain: consultants spend 4+ hours per case on manual document tracking checklists, IRCC portal status checks across 40-80 active files, and chasing clients for missing supporting documents - that overhead is hitting hard right now with the June 30 deadline pressure.
- Offer: an automated case intake pipeline - document request sequences, IRCC status tracking across all active files, and client update messages - that cuts per-case admin to under 45 minutes, built in one week, no new software to buy.
- SR&ED angle (use if context supports): SR&ED grant covers 35-45% of the automation build cost - immediate ROI with no capital risk.
- CTA: 15-minute call to walk through the exact workflow for their practice size.

WRITING RULES (ABSOLUTE):
- Under 150 words total
- Bullet-point format (not prose paragraphs) - this is a DM
- Peer-to-peer tone, NOT vendor tone
- Reference the June 30 deadline OR the zero-AI-vendor gap - prove you understand their specific situation
- NO em-dashes - use hyphens only
- NO money-back guarantees
- NO AI-tells: delve, leverage, robust, seamless, navigate, foster, embark
- Sign exactly: "- Kirill, Calgary\\nlaunchsoloai.com"

Output ONLY the DM body. No preamble, no JSON, no markdown fences. Just the message.`;

  const r = spawnSync(NODE_BIN, ["--input-type=module", "-e", `
    import { spawnSync } from "child_process";
    const r = spawnSync("$HOME/.nvm/versions/node/v22.22.2/bin/claude",
      ["-p", "--model", "claude-sonnet-4-6", "--max-turns", "3"],
      { input: ${JSON.stringify(prompt)}, encoding: "utf-8", timeout: 5*60*1000 });
    process.stdout.write(r.stdout || "");
    if (r.stderr) process.stderr.write(r.stderr);
  `], { encoding: "utf-8", timeout: 6 * 60 * 1000 });

  return (r.stdout || "").trim();
}

async function draftMigrationPainReply(lead, enrichment) {
  const prompt = `You are drafting a short outreach DM from Kirill, who builds AI workflow automation, to a Canadian SMB owner publicly trying to replace spreadsheets or disconnected tools with Jobber, HubSpot, QuickBooks, GoHighLevel, or Make/Zapier workflows.

LEAD CONTEXT:
- Username: ${lead.name}
- Post/context: ${lead.pain_description?.split("\n")[0] || ""}
- URL: ${lead.source_url || ""}

WRITING BRIEF:
- Context: the owner is mid-migration - they have committed to a new tool (Jobber, HubSpot, QuickBooks, GHL, or Make/Zapier) but the manual admin has not gone away yet. The connective tissue between their old and new workflows is still broken.
- Pain: data still has to be re-entered in two places; reminders and follow-ups still fire manually; intake from forms never routes to the right step automatically; the tool they bought does 40% of what they were promised.
- Offer: a 1-week build that closes the gaps in their specific stack - connects intake to CRM, automates follow-up sequences, and routes jobs or reminders without manual triggers. $2,500-$8,000 CAD depending on scope. SR&ED covers 35-45% of the build cost.
- CTA: 15-minute call to map the exact gaps in their current setup.

WRITING RULES (ABSOLUTE):
- Under 150 words total
- Bullet-point format (not prose paragraphs) - this is a DM
- Peer-to-peer tone, NOT vendor tone
- Reference the specific tool they mentioned - prove you read the post
- NO em-dashes - use hyphens only
- NO money-back guarantees
- NO AI-tells: delve, leverage, robust, seamless, navigate, foster, embark
- Sign exactly: "- Kirill, Calgary\\nlaunchsoloai.com"

Output ONLY the DM body. No preamble, no JSON, no markdown fences. Just the message.`;

  const r = spawnSync(NODE_BIN, ["--input-type=module", "-e", `
    import { spawnSync } from "child_process";
    const r = spawnSync("$HOME/.nvm/versions/node/v22.22.2/bin/claude",
      ["-p", "--model", "claude-sonnet-4-6", "--max-turns", "3"],
      { input: ${JSON.stringify(prompt)}, encoding: "utf-8", timeout: 5*60*1000 });
    process.stdout.write(r.stdout || "");
    if (r.stderr) process.stderr.write(r.stderr);
  `], { encoding: "utf-8", timeout: 6 * 60 * 1000 });

  return (r.stdout || "").trim();
}

async function draftCalgaryWorkflowAuditReply(lead, enrichment) {
  const prompt = `You are drafting a short outreach DM from Kirill, who builds AI workflow automation, to a Calgary service business owner he found via Reddit or LinkedIn.

LEAD CONTEXT:
- Username: ${lead.name}
- Post/context: ${lead.pain_description?.split("\n")[0] || ""}
- URL: ${lead.source_url || ""}

WRITING BRIEF:
- Context: Calgary service business owners spend 3-5 hours per day on manual admin that has an obvious automation fix - but they cannot see which one to tackle first.
- Offer: $1,500 AI Workflow Audit. Kirill reviews the business, identifies the single highest-ROI workflow to automate, and delivers a concrete build plan within 72 hours. One clear answer, not a list of tools.
- Promise to include verbatim: "I will identify the single highest-ROI workflow to automate and deliver a build plan within 72 hours."
- Pain: owners know they need automation but have paralysis from too many options. The audit removes that paralysis with a specific, analysis-backed answer.
- SR&ED angle: if the build gets approved, SR&ED covers 35-45% of the implementation cost.
- CTA: 20-minute scoping call to confirm whether the audit fits their situation.

WRITING RULES (ABSOLUTE):
- Under 150 words total
- Bullet-point format (not prose paragraphs) - this is a DM
- Peer-to-peer tone, NOT vendor tone
- Reference the specific pain from their post - prove you read it
- NO em-dashes - use hyphens only
- NO money-back guarantees
- NO AI-tells: delve, leverage, robust, seamless, navigate, foster, embark
- Sign exactly: "- Kirill, Calgary\\nlaunchsoloai.com"

Output ONLY the DM body. No preamble, no JSON, no markdown fences. Just the message.`;

  const r = spawnSync(NODE_BIN, ["--input-type=module", "-e", `
    import { spawnSync } from "child_process";
    const r = spawnSync("$HOME/.nvm/versions/node/v22.22.2/bin/claude",
      ["-p", "--model", "claude-sonnet-4-6", "--max-turns", "3"],
      { input: ${JSON.stringify(prompt)}, encoding: "utf-8", timeout: 5*60*1000 });
    process.stdout.write(r.stdout || "");
    if (r.stderr) process.stderr.write(r.stderr);
  `], { encoding: "utf-8", timeout: 6 * 60 * 1000 });

  return (r.stdout || "").trim();
}

async function draftCalgaryRealEstateReply(lead, enrichment) {
  const prompt = `You are drafting a short outreach DM from Kirill, who builds AI workflow automation, to a Calgary real estate agent, broker, or small real estate team he found via Reddit or LinkedIn.

LEAD CONTEXT:
- Username: ${lead.name}
- Post/context: ${lead.pain_description?.split("\n")[0] || ""}
- URL: ${lead.source_url || ""}

WRITING BRIEF:
- Context: Calgary agents and brokers spend 2-4 hours per day on manual lead follow-up, CRM data cleanup, listing admin tasks, and transaction coordination - work that has a direct automation fix but almost no local vendor is building for real estate specifically.
- Pain: new leads from property portals sit in a spreadsheet or email inbox until someone manually sequences follow-up; CRM records go stale because updating them is a manual step after every showing or call; transaction coordination requires chasing 6-8 parties by email with no single tracking board.
- Offer: a lead follow-up and transaction coordination automation built for their specific tools (Follow Up Boss, Salesforce, HubSpot, or Google Sheets) - automated follow-up sequences triggered by portal lead events, CRM auto-update after showings, and a single-screen transaction board tracking all active deals. Built in one week, no new software to buy.
- SR&ED angle: SR&ED grant covers 35-45% of the build cost - immediate ROI, no capital risk.
- CTA: 15-minute call to walk through the exact workflow for their team size and tool stack.

WRITING RULES (ABSOLUTE):
- Under 150 words total
- Bullet-point format (not prose paragraphs) - this is a DM
- Peer-to-peer tone, NOT vendor tone
- Reference the specific pain from their post - prove you read it
- NO em-dashes - use hyphens only
- NO money-back guarantees
- NO AI-tells: delve, leverage, robust, seamless, navigate, foster, embark
- Sign exactly: "- Kirill, Calgary\\nlaunchsoloai.com"

Output ONLY the DM body. No preamble, no JSON, no markdown fences. Just the message.`;

  const r = spawnSync(NODE_BIN, ["--input-type=module", "-e", `
    import { spawnSync } from "child_process";
    const r = spawnSync("$HOME/.nvm/versions/node/v22.22.2/bin/claude",
      ["-p", "--model", "claude-sonnet-4-6", "--max-turns", "3"],
      { input: ${JSON.stringify(prompt)}, encoding: "utf-8", timeout: 5*60*1000 });
    process.stdout.write(r.stdout || "");
    if (r.stderr) process.stderr.write(r.stderr);
  `], { encoding: "utf-8", timeout: 6 * 60 * 1000 });

  return (r.stdout || "").trim();
}

async function draftPhoneSystemSwitchingReply(lead, enrichment) {
  const prompt = `You are drafting a short outreach DM from Kirill, who builds AI workflow automation, to a Canadian SMB owner publicly discussing switching away from Grasshopper, Yeastar, or a physical receptionist due to cost or missed-call admin pain.

LEAD CONTEXT:
- Username: ${lead.name}
- Post/context: ${lead.pain_description?.split("\n")[0] || ""}
- URL: ${lead.source_url || ""}

WRITING BRIEF:
- Context: this owner is frustrated with phone system cost or voicemail admin - they are looking to cut receptionist overhead, NOT buy another phone tool.
- CRITICAL: DO NOT pitch voice agents or AI receptionists. The offer is back-office workflow automation that eliminates the admin work that was piling up alongside the phone system pain.
- Pain: missed calls and after-hours voicemails create a manual follow-up backlog - someone has to check messages, log them, call back, and update a record. That is 1-2 hours per day of untracked admin work that has nothing to do with the phone system itself.
- Offer: a back-office automation that auto-logs missed contacts from any source (voicemail, email, web form), routes them to the right follow-up queue, and triggers reminder sequences - no receptionist and no manual log required. Built in one week. $2,500-$5,000 CAD. SR&ED covers 35-45% of the build cost.
- CTA: 15-minute call to map the exact follow-up workflow they need.

WRITING RULES (ABSOLUTE):
- Under 150 words total
- Bullet-point format (not prose paragraphs) - this is a DM
- Peer-to-peer tone, NOT vendor tone
- Reference the specific pain from their post - prove you read it
- DO NOT mention AI receptionist, voice agent, or phone answering
- NO em-dashes - use hyphens only
- NO money-back guarantees
- NO AI-tells: delve, leverage, robust, seamless, navigate, foster, embark
- Sign exactly: "- Kirill, Calgary\\nlaunchsoloai.com"

Output ONLY the DM body. No preamble, no JSON, no markdown fences. Just the message.`;

  const r = spawnSync(NODE_BIN, ["--input-type=module", "-e", `
    import { spawnSync } from "child_process";
    const r = spawnSync("$HOME/.nvm/versions/node/v22.22.2/bin/claude",
      ["-p", "--model", "claude-sonnet-4-6", "--max-turns", "3"],
      { input: ${JSON.stringify(prompt)}, encoding: "utf-8", timeout: 5*60*1000 });
    process.stdout.write(r.stdout || "");
    if (r.stderr) process.stderr.write(r.stderr);
  `], { encoding: "utf-8", timeout: 6 * 60 * 1000 });

  return (r.stdout || "").trim();
}

async function draftReplyForLead(lead, enrichment) {
  if (DENTAL_SPRINT_ACTIVE && new Date() < new Date(DENTAL_SPRINT_EXPIRES_AT) && isDentalCalgaryLead(lead, enrichment)) {
    const triggers = await checkDentalWebsiteTriggers(lead.source_url);
    return draftDentalMissedCallAudit(lead, enrichment, triggers);
  }
  if (isRcicLead(lead, enrichment)) return draftRcicReply(lead, enrichment);
  if (isOutplacementLead(lead, enrichment)) return draftOutplacementReply(lead, enrichment);
  if (isCalgaryConstructionLead(lead, enrichment)) return draftCalgaryConstructionReply(lead, enrichment);
  if (isCalgaryRealEstateLead(lead, enrichment)) return draftCalgaryRealEstateReply(lead, enrichment);
  if (isPhoneSystemSwitchingLead(lead, enrichment)) return draftPhoneSystemSwitchingReply(lead, enrichment);
  if (isClinicSoftwareDistressLead(lead, enrichment)) return draftClinicSoftwareDistressReply(lead, enrichment);
  if (isClinicAdminPainLead(lead, enrichment)) return draftClinicAdminPainReply(lead, enrichment);
  if (isCalgaryServiceBusiness(lead, enrichment)) return draftCalgaryWorkflowAuditReply(lead, enrichment);
  if (isMigrationPainLead(lead, enrichment)) return draftMigrationPainReply(lead, enrichment);
  // Use Claude CLI subprocess - same pattern as other Sonnet bots
  const prompt = `You are drafting a Reddit DM from Kirill, who builds AI workflow automation systems for solo founders and small teams in Calgary, to a solo SaaS founder he found via Reddit.

<trained-outreach-rules>
${OUTREACH_RULES}
</trained-outreach-rules>

LEAD CONTEXT:
- Reddit username: ${lead.name}
- Their post title: ${lead.pain_description?.split("\n")[0] || ""}
- Full post body: ${lead.pain_description || ""}
- Subreddit / URL: ${lead.source_url}

ENRICHMENT:
- Classification: ${enrichment.classification}
- Reasoning: ${enrichment.reasoning}
- Recommended angle: ${enrichment.next_message_angle || "natural peer help"}
- Pain category: ${enrichment.pain_category || "unclear"}
- Pain evidence: ${enrichment.pain_evidence || "none"}
- Buyer score: ${enrichment.buyer_score || "?"}

SELECTED OFFER (use THIS offer, do not freestyle):
${enrichment.best_micro_offer && enrichment.best_micro_offer !== "do_not_pitch" ? `
Offer: ${enrichment.best_micro_offer}
Why it fits: ${enrichment.offer_fit_reason || "matches their pain"}

OFFER CATALOG (for reference only - use the selected offer above):` : `
No specific offer selected. Use the most natural fit from:`}
- vibe_code_audit: 48-hour codebase audit - reads your stack, identifies bottlenecks and scale risks, delivers written report with fixes. $1,500-$2,500 CAD.
- reply_chaser: Reply Chaser Automation - automated follow-up system that catches leads going cold. $1,500 CAD.
- first_10_customers: 30-day sales motion build - ICP targeting, outreach copy, lead pipeline setup for founders with 0 consistent leads. $2,000 CAD.
- custom_ai_build: Custom AI / n8n workflow build - end-to-end automation for your specific ops bottleneck. $2,500-$8,000 CAD.

WRITING RULES (ABSOLUTE):
- 150-220 words, prose paragraphs (no bullet lists, no headers)
- Peer-to-peer tone, NOT salesy
- Open with a SPECIFIC observation about THEIR post (prove you read it)
- 2-3 tactical observations that would actually help them at their stage
- Soft offer at the end, NOT a hard pitch ("happy to share what works", not "book a call")
- Sign exactly: "- Kirill, Calgary\\nlaunchsoloai.com"
- NO em-dash. Use - (hyphen) or rewrite.
- NO money-back guarantees. NO "if you don't get results you don't pay".
- NO AI-tells: delve, leverage, robust, seamless, navigate, foster, embark, landscape, realm
- NO fake authority, NO made-up case studies, NO "I worked with 50 founders"

Output ONLY the DM body text. No preamble, no JSON, no markdown fences. Just the message.`;

  const r = spawnSync(NODE_BIN, ["--input-type=module", "-e", `
    import { spawnSync } from "child_process";
    const r = spawnSync("$HOME/.nvm/versions/node/v22.22.2/bin/claude",
      ["-p", "--model", "claude-sonnet-4-6", "--max-turns", "3"],
      { input: ${JSON.stringify(prompt)}, encoding: "utf-8", timeout: 5*60*1000 });
    process.stdout.write(r.stdout || "");
    if (r.stderr) process.stderr.write(r.stderr);
  `], { encoding: "utf-8", timeout: 6 * 60 * 1000 });

  return (r.stdout || "").trim();
}

// ============================================================
// DEAD VOICE AGENT DRAFT FUNCTIONS REMOVED 2026-04-27
// Removed: draftEmailForLocalService, draftJobPostIntentMessage,
// draftCallScriptForEmergency, draftGoogleReviewsComplaintMessage,
// draftCompetitorPricingInterceptMessage, draftSpanishBilingualMessage,
// draftCalgaryGeoIntentMessage, draftFacebookEmergencyRecMessage,
// draftHvacFreeSetupEmail, draftCalgaryJobPostingMessage,
// draftReceptionistHiringMessage, draftHiringNowReceptionistMessage,
// draftLegacyAnsweringSwitchMessage, draftAiReceptionistShoppingMessage,
// draftExpandedHoursEventMessage, draftPricingShockMessage,
// draftPublicReviewPhoneComplaintMessage, draftCalgaryEmergencyAdvertiserMessage,
// draftMissedCallAuditMessage, draftVoiceAgentMissedCall,
// draftCompetitorDisplacementMessage, detectLang
// ============================================================

async function main() {
  log("starting ICP outreach run");
  const db = new Database(DB_PATH);

  // Daily cap check
  let dispatchedCount = 0;
  try {
    dispatchedCount = db.prepare(`
      SELECT COUNT(*) as n FROM bot_intelligence
      WHERE bot_id='icp-outreach' AND insight_type='dispatched' AND date(updated_at)=date('now')
    `).get()?.n || 0;
  } catch (e) { /* table may not exist */ }

  if (dispatchedCount >= DAILY_DISPATCH_CAP) {
    log(`daily cap reached (${dispatchedCount}/${DAILY_DISPATCH_CAP}), exiting`);
    db.close();
    return;
  }

  // Find candidates: Apify sources are pre-filtered (queries already targeted ICP)
  // Reddit/HN sources need extra keyword filter since they are general scrapes.
  // Apr 23 2026: removed e.lead_id IS NULL filter - now picks up enriched leads too
  // since we no longer enrich inline (enrichment-bot handles that separately).
  const whereClauses = ICP_PATTERNS.map(() => "lower(pain_description) LIKE ?").join(" OR ");
  const sql = `
    SELECT l.id, l.name, l.pain_description, l.source_url, l.source, l.score
    FROM leads l
    WHERE l.stage = 'new'
      AND l.outreach_status IS NULL
      AND (
        l.source LIKE 'apify-%'
        OR (
          l.source IN ('fresh-pain-scout', 'hn-show-hn-scout', 'reddit_buying_signal_hunt', 'calgary-local-pain-scout')
          AND (${whereClauses})
        )
      )
    ORDER BY
      CASE WHEN l.source LIKE 'apify-%' THEN 0 ELSE 1 END,
      l.created_at DESC,
      l.score DESC
    LIMIT 15
  `;
  const candidates = db.prepare(sql).all(...ICP_PATTERNS.map(p => p.toLowerCase()));

  log(`found ${candidates.length} ICP candidates to check`);

  const dispatched = [];
  const drafts = [];

  // PASS 1: Draft for already-enriched warming/ready_buyer candidates
  // Apr 23 2026: STOPPED inline enrichment - let lead-enrichment-bot handle it on schedule.
  // Inline enrichment caused 261 failures/day and wasted API calls.
  for (const lead of candidates) {
    if (dispatchedCount + dispatched.length >= DAILY_DISPATCH_CAP) {
      log("daily cap reached mid-run, stopping");
      break;
    }

    const enrichment = db.prepare(`SELECT * FROM lead_enrichment WHERE lead_id=?`).get(lead.id);
    if (!enrichment) {
      log(`${lead.name}: not yet enriched, skipping (enrichment-bot will handle)`);
      continue;
    }
    log(`${lead.name} → ${enrichment.classification} (${enrichment.confidence})`);

    if (!["warming", "ready_buyer"].includes(enrichment.classification)) {
      log(`${lead.name}: not warming/ready_buyer, skipping draft`);
      continue;
    }

    // V3 routing gate: lowered thresholds Apr 14 2026
    // V2 gate (3.4) blocked 90% of warming leads, producing 0 drafts/day
    // V3: buyer >= 2.5, comment_first bypasses do_not_pitch (low-risk engagement)
    const buyerScore = enrichment.buyer_score || 0;
    const painS = enrichment.pain_score || 0;
    const accessS = enrichment.access_score || 0;
    const roiS = enrichment.roi_score || 0;
    const offer = enrichment.best_micro_offer || "";
    const action = enrichment.recommended_action || "comment_first";

    // Apr 23 2026: re-enabled do_not_pitch block with softer gate.
    // Only block not_fit classification. warming/ready_buyer/peer all pass through.
    if (enrichment.classification === "not_fit") {
      log(`${lead.name}: ENRICHMENT BLOCKED - not_fit classification`);
      continue;
    }
    if (buyerScore > 0 && (buyerScore < 1.8 || painS < 1)) {
      log(`${lead.name}: GATE BLOCKED buyer=${buyerScore} pain=${painS}`);
      continue;
    }

    log(`drafting for ${lead.name} (buyer=${buyerScore} offer=${offer || "auto"})`);
    const body = await draftReplyForLead(lead, enrichment);
    if (!body || body.length < 100) {
      log(`${lead.name}: draft too short or empty, skipping`);
      continue;
    }

    // Twitter/X and LinkedIn leads go as DM (not subject to Reddit rate guard)
    // Reddit leads go as comment (subject to rate guard)
    const isReddit = (lead.source_url || "").includes("reddit.com");
    drafts.push({
      leadId: lead.id,
      name: lead.name,
      kind: isReddit ? "comment" : "dm",
      topic: lead.pain_description?.split("\n")[0]?.slice(0, 100) || "ICP outreach",
      url: lead.source_url,
      ageDays: 1,
      body,
    });
    dispatched.push(lead.name);
  }

  // PASS 2: Pick up already-enriched warming/ready_buyer leads that never got a draft
  // These accumulate when enrichment runs separately from this bot (e.g. sonnet-daemon batch)
  // Apr 12 2026 fix: 48 warming leads were sitting undrafted because this bot only looked at unenriched
  if (dispatchedCount + dispatched.length < DAILY_DISPATCH_CAP) {
    const alreadyDispatched = new Set();
    try {
      const rows = db.prepare(`SELECT key FROM bot_intelligence WHERE bot_id='icp-outreach' AND insight_type='dispatched'`).all();
      rows.forEach(r => alreadyDispatched.add(r.key));
    } catch {}

    const warmingLeads = db.prepare(`
      SELECT l.id, l.name, l.pain_description, l.source_url, l.source, l.score,
             e.classification, e.reasoning, e.next_message_angle, e.recommended_action,
             e.pain_category, e.pain_evidence, e.best_micro_offer, e.offer_fit_reason,
             e.pain_score, e.urgency_score, e.budget_score, e.access_score, e.roi_score, e.buyer_score
      FROM leads l
      JOIN lead_enrichment e ON e.lead_id = l.id
      WHERE e.classification IN ('warming', 'ready_buyer')
        AND l.outreach_status IS NULL
      ORDER BY
        CASE WHEN e.classification = 'ready_buyer' THEN 0 ELSE 1 END,
        e.buyer_score DESC NULLS LAST,
        l.score DESC
      LIMIT 30
    `).all();

    for (const lead of warmingLeads) {
      if (dispatchedCount + dispatched.length >= DAILY_DISPATCH_CAP) break;
      if (alreadyDispatched.has(lead.name)) continue;
      if (dispatched.includes(lead.name)) continue;

      // Apr 15 2026: simplified gate - if warming/ready_buyer, draft it
      const bs2 = lead.buyer_score || 0;
      if (bs2 > 0 && (bs2 < 1.8 || (lead.pain_score || 0) < 1)) {
        log(`[pass2] ${lead.name}: GATE BLOCKED buyer=${bs2}`);
        continue;
      }

      log(`[pass2] drafting for ${lead.name} (buyer=${bs2} offer=${lead.best_micro_offer || "auto"})`);
      const body = await draftReplyForLead(lead, lead);
      if (!body || body.length < 100) {
        log(`${lead.name}: draft too short or empty, skipping`);
        continue;
      }

      const isReddit2 = (lead.source_url || "").includes("reddit.com");
      drafts.push({
        leadId: lead.id,
        name: lead.name,
        kind: isReddit2 ? "comment" : "dm",
        topic: lead.pain_description?.split("\n")[0]?.slice(0, 100) || "ICP outreach",
        url: lead.source_url,
        ageDays: 1,
        body,
      });
      dispatched.push(lead.name);
    }
  }

  // DENTAL SPRINT PASS - 24h Calgary dental clinics only
  // Queries DB directly for dental+Calgary leads, checks website triggers, drafts Missed-Call Recovery Audit
  if (DENTAL_SPRINT_ACTIVE && new Date() < new Date(DENTAL_SPRINT_EXPIRES_AT)) {
    const dentalState = readDentalSprintCount();
    const today = new Date().toISOString().slice(0, 10);
    if (dentalState.date !== today) { dentalState.date = today; dentalState.count = 0; }

    if (dentalState.count < DENTAL_SPRINT_MAX_SENDS) {
      log('[dental-sprint] scanning for Calgary dental clinic leads');
      const dentalLeads = db.prepare(`
        SELECT l.id, l.name, l.pain_description, l.source_url, l.score,
               e.classification, e.best_micro_offer, e.buyer_score, e.pain_score
        FROM leads l
        LEFT JOIN lead_enrichment e ON e.lead_id = l.id
        WHERE l.outreach_status IS NULL
          AND (
            lower(l.name) LIKE '%dental%' OR lower(l.name) LIKE '%dentist%'
            OR lower(l.pain_description) LIKE '%dental%' OR lower(l.pain_description) LIKE '%dentist%'
            OR lower(l.source_url) LIKE '%dental%' OR lower(l.source_url) LIKE '%dentist%'
          )
          AND (
            lower(l.pain_description) LIKE '%calgary%' OR lower(l.source_url) LIKE '%calgary%'
            OR lower(l.name) LIKE '%calgary%' OR lower(l.pain_description) LIKE '%alberta%'
          )
        ORDER BY l.score DESC, l.created_at DESC
        LIMIT 10
      `).all();

      log(`[dental-sprint] found ${dentalLeads.length} Calgary dental leads`);

      for (const lead of dentalLeads) {
        if (dentalState.count >= DENTAL_SPRINT_MAX_SENDS) break;
        if (dispatched.includes(lead.name)) continue;
        if (dispatchedCount + dispatched.length >= DAILY_DISPATCH_CAP) break;

        log(`[dental-sprint] checking website triggers for ${lead.name}`);
        const triggers = await checkDentalWebsiteTriggers(lead.source_url);

        if (triggers && !triggers.trigger_found) {
          log(`[dental-sprint] ${lead.name}: no actionable gap found, skipping`);
          continue;
        }

        log(`[dental-sprint] drafting Missed-Call Recovery Audit for ${lead.name}`);
        const body = await draftDentalMissedCallAudit(lead, lead, triggers);
        if (!body || body.length < 80) {
          log(`[dental-sprint] ${lead.name}: draft too short, skipping`);
          continue;
        }

        drafts.push({
          leadId: lead.id,
          name: lead.name,
          kind: 'dm',
          topic: 'Missed-Call Recovery Audit - Calgary dental',
          url: lead.source_url,
          ageDays: 1,
          body,
        });
        dispatched.push(lead.name);
        dentalState.count++;
        writeDentalSprintCount(dentalState);
      }
    } else {
      log(`[dental-sprint] daily cap reached (${dentalState.count}/${DENTAL_SPRINT_MAX_SENDS})`);
    }
  }

  if (drafts.length > 0) {
    const tmpFile = `/tmp/icp-batch-${Date.now()}.json`;
    writeFileSync(tmpFile, JSON.stringify(drafts, null, 2));
    log(`dispatching ${drafts.length} drafts via wrapper`);
    const r = spawnSync(NODE_BIN, ["scripts/factory/dispatch-reddit-drafts.mjs", tmpFile], {
      cwd: ROOT, encoding: "utf-8", timeout: 5 * 60 * 1000, stdio: "inherit",
    });

    // Mark dispatched in intelligence so daily cap works tomorrow
    try {
      const upsert = db.prepare(`
        INSERT INTO bot_intelligence (id, bot_id, insight_type, key, value_json, confidence, created_at, updated_at)
        VALUES (?, 'icp-outreach', 'dispatched', ?, ?, 100, datetime('now'), datetime('now'))
      `);
      for (const name of dispatched) {
        try { upsert.run(`icp-${Date.now()}-${name}`, name, JSON.stringify({ name })); } catch {}
      }
    } catch (e) { log("intelligence write failed: " + e.message); }
  } else {
    log("no warming/ready_buyer drafts produced this run");
    // Silent when no results - don't spam Kirill with "0 drafts" every 30 min
    log(`no drafts produced. ${candidates.length} candidates checked.`);
  }

  // ============================================================
  // PASSES 3-22 REMOVED 2026-04-27
  // All voice agent vertical passes discontinued 2026-04-22.
  // Dead code for competitor displacement, local service email,
  // (Passes 3-22 removed Apr 27 2026 - voice agent product discontinued)
  // ============================================================

  // RCIC LinkedIn targeting block - primary acquisition channel
  // target: solo/small RCIC practices in Alberta/BC listed on CICC member directory
  // pain: H&C case manual prep, NOC classification burden, spousal OWP tracking, IRCC portal delays
  const RCIC_LINKEDIN_TARGET = {
    target_persona: 'RCIC immigration consultant solo or small practice Alberta BC',
    search_queries: [
      '"RCIC" "immigration consultant" Alberta "solo practice" OR "small practice"',
      '"RCIC" "immigration consultant" BC "H&C" OR "humanitarian" workload',
      'site:linkedin.com RCIC "case management" "NOC" OR "open work permit" overwhelmed',
      '"regulated canadian immigration consultant" CICC Alberta BC',
    ],
    pain_points: [
      'H&C application prep: 4+ hours manual document review per case',
      'NOC classification burden: manual occupational matching across 500+ NOC codes',
      'Spousal open work permit tracking: status updates lost in email, no central tracking',
      'IRCC portal delays: manual daily check-ins across 40-80 active files',
    ],
    cicc_target: 'solo and small practices (1-3 consultants) listed on CICC member directory in Alberta/BC',
    sred_angle: 'SR&ED grant covers 35-45% of AI automation cost - immediate ROI, no capital risk',
    no_competitors: true,
    primary_market: 'CANADA',
    outreach_channel: 'linkedin_comment',
    max_per_run: 5,
    connection_note: 'Running a workflow automation project for RCIC practices - cuts H&C case admin by 70%. Happy to share details.',
    message_template: `Hi [FirstName],

Noticed you are managing H&C files and work permits alongside your regular intake - the manual tracking across IRCC portal, document checklists, and client updates adds up fast.

- H&C case prep and NOC classification alone run 4+ hours per file when done manually
- Spousal OWP status tracking falls through the cracks when you are juggling 40+ active files
- IRCC portal delays mean more check-in cycles per case, not fewer

Built a workflow specifically for solo RCIC practices that automates document request sequences, tracks IRCC status across all active files, and sends client updates without manual drafting. Cuts per-case admin to under 30 minutes.

Happy to show you the exact setup for your practice size - 15 minutes.

Kirill
launchsoloai.com`,
  };
  appendLog('update', `icp-outreach: RCIC LinkedIn targeting updated - query: "${RCIC_LINKEDIN_TARGET.search_queries[0]}"`);

  // Calgary construction / trades LinkedIn targeting - implementation-intent buyers
  const CALGARY_CONSTRUCTION_LINKEDIN_TARGET = {
    target_persona: 'Calgary construction and trades business owner - general contractor, HVAC, plumbing, electrical, oilfield services',
    search_queries: [
      '"Calgary" "general contractor" OR "HVAC" OR "plumbing" OR "electrician" "quoting" OR "estimating" OR "admin"',
      '"Calgary" "construction" "office admin" OR "workflow" OR "AI" OR "automation"',
      '"Calgary" "trades" "quoting software" OR "job costing" OR "scheduling"',
      '"Calgary" "oilfield services" "admin" OR "workflow" OR "office"',
      '"Alberta" "construction" OR "HVAC" "admin overload" OR "quoting" OR "bottleneck"',
      'site:linkedin.com/posts Calgary Zapier real estate',
      'site:reddit.com small business automate quoting',
      'site:facebook.com/groups Calgary construction admin automation',
      'site:reddit.com/r/realtorscrm automation follow up',
      'site:linkedin.com/posts Calgary n8n automation operations',
      '"Calgary" "real estate" "Zapier" OR "Make" OR "n8n" OR "CRM" automation',
      '"Calgary" "energy services" "workflow automation" OR "admin automation"',
      '"Alberta" "realtor" OR "real estate agent" "CRM automation" OR "follow up automation"',
      '"Calgary" "property management" "n8n" OR "Make" OR "Zapier" OR "automation"',
    ],
    pain_points: [
      'Quote generation: 45-90 minutes per job when field data is re-entered manually',
      'Job costing: done in spreadsheets 2-3 days after job close - no real-time visibility',
      'Invoicing backlog: foreman still in field, office billing falls behind',
      'Scheduling chaos: dispatch and crew assignment managed by phone and texts',
    ],
    sred_angle: 'SR&ED grant covers 35-45% of AI automation cost - immediate ROI, no capital risk',
    primary_market: 'CANADA',
    outreach_channel: 'linkedin_comment',
    max_per_run: 5,
    message_template: `Hi [FirstName],

Noticed you are running a [trade] operation in Calgary - the quoting and job admin overhead in trades adds up to 3-5 hours per day when it is still manual.

- Manual quote generation runs 45-90 minutes per job when field data needs to be re-entered in the office
- Job costing is typically 2-3 days late because it is done from memory or spreadsheets post-close
- Invoicing backs up when the foreman is still on site and the office is waiting

Built a quoting and job admin automation for Calgary trades that pre-fills quotes from field notes, auto-generates invoices on job completion, and gives you a single-screen status board.

SR&ED covers 35-45% of the build cost. 15 minutes to show the exact setup for your trade volume.

Kirill
launchsoloai.com`,
  };
  appendLog('update', `icp-outreach: Calgary construction/trades LinkedIn targeting added - query: "${CALGARY_CONSTRUCTION_LINKEDIN_TARGET.search_queries[0]}"`);

  // Canadian SMB owners explicitly asking for Zapier / Make / n8n / CRM / admin automation help
  const CANADIAN_SMB_AUTOMATION_TARGET = {
    target_persona: 'Canadian SMB owner explicitly asking for help with Zapier, Make, n8n, CRM follow-up, intake, quoting, or admin automation',
    search_queries: [
      'site:reddit.com Zapier small business Canada',
      'site:linkedin.com/posts owner needs CRM automation',
      'site:facebook.com/groups Make.com automation small business',
      'site:reddit.com n8n lead follow up business',
      'site:linkedin.com/posts quoting automation contractor',
    ],
    pain_points: [
      'Owner manually following up leads in spreadsheets or email - CRM automation not set up',
      'Zapier/Make workflows breaking or missing - no one to maintain or extend them',
      'n8n self-hosted but under-used - owner built basics and hit a wall',
      'Intake forms sending data nowhere - quoting and onboarding still done by hand',
      'Admin overhead eating 2-4 hours per day that automation tools promised to eliminate',
    ],
    sred_angle: 'SR&ED grant covers 35-45% of AI automation cost - immediate ROI, no capital risk',
    primary_market: 'CANADA',
    outreach_channel: 'reddit_comment',
    max_per_run: 5,
    offer: 'custom_ai_build',
    message_template: `Hi [FirstName],

Saw your question about [Zapier/Make/n8n/CRM automation] - ran into the same wall with a few Canadian clients this year.

The gap is usually not the tool - it is the trigger logic. When intake, follow-up, and quoting are three separate workflows stitched together manually, any data mismatch breaks the chain.

Built a unified intake-to-close automation for a [trade/services] owner in Calgary last month - single pipeline from first contact through quote send and follow-up. Cut their admin from 3 hours to 20 minutes per day.

SR&ED covers 35-45% of the build if you are a Canadian business. Happy to show you the exact setup - 15 minutes.

- Kirill, Calgary
launchsoloai.com`,
  };
  appendLog('update', `icp-outreach: Canadian SMB automation scout cluster added - queries: ${CANADIAN_SMB_AUTOMATION_TARGET.search_queries.join(', ')}`);

  // Migration pain scout - Canadian SMB owners replacing spreadsheets/disconnected tools
  // with Jobber, HubSpot, QuickBooks, GoHighLevel, or Make/Zapier
  const MIGRATION_PAIN_TARGET = {
    target_persona: 'Canadian SMB owner mid-migration from spreadsheets or disconnected tools to Jobber, HubSpot, QuickBooks, GoHighLevel, or Make/Zapier',
    search_queries: [
      'site:reddit.com spreadsheet to Jobber',
      'site:reddit.com QuickBooks automate reminders small business',
      'site:linkedin.com/posts owner spreadsheet automation CRM',
      'site:facebook.com/groups HubSpot setup contractor',
      'site:reddit.com Zapier replace manual admin business',
    ],
    pain_points: [
      'Data re-entry across old and new tools - migration incomplete, double work remains',
      'Reminders and follow-ups still fire manually despite buying automation software',
      'Intake forms route to email, not the CRM or job management tool',
      'Bought Jobber/HubSpot/GHL but it only covers 40% of their actual workflow',
      'No one built the connective tissue between their stack components',
    ],
    sred_angle: 'SR&ED grant covers 35-45% of AI automation cost - immediate ROI, no capital risk',
    primary_market: 'CANADA',
    outreach_channel: 'reddit_comment',
    max_per_run: 5,
    offer: 'custom_ai_build',
    message_template: `Hi [FirstName],

Saw you are trying to get [Jobber/HubSpot/QuickBooks/GHL/Zapier] to replace the manual admin - ran into this exact situation with a few Canadian clients this year.

The tool usually does the job once set up, but the connective tissue between intake, follow-up, and the tool itself is where the manual work hides:
- Form submissions still route to email, not directly into the job or CRM record
- Reminders and follow-ups still need someone to trigger them
- Old spreadsheet data sits in parallel instead of syncing

Built a 1-week integration that closes those gaps for their specific stack. SR&ED covers 35-45% of the build cost if you are a Canadian business.

15 minutes to map the exact gaps in your setup.

- Kirill, Calgary
launchsoloai.com`,
  };
  appendLog('update', `icp-outreach: migration-pain scout cluster added - queries: ${MIGRATION_PAIN_TARGET.search_queries.join(', ')}`);

  // Calgary-local buyer-intent scout cluster - owners asking for help choosing or implementing AI tools
  const CALGARY_AI_BUYER_TARGET = {
    target_persona: 'Calgary small business owner asking for help choosing or implementing AI tools - buyer intent, not generic automation curiosity',
    search_queries: [
      'site:reddit.com Calgary small business AI help',
      'site:linkedin.com/posts Calgary business owner AI implementation',
      'site:facebook.com/groups Calgary entrepreneurs automate admin',
      'site:reddit.com Alberta small business ChatGPT workflow',
      'site:linkedin.com/posts Calgary dental AI automation',
    ],
    pain_points: [
      'Owner knows they need AI but does not know which tool to pick or how to start',
      'Evaluated ChatGPT or other tools but cannot connect them to actual business workflow',
      'Spent time on YouTube tutorials but has no working implementation',
      'Spending 2-4 hours per day on tasks they know AI could handle',
      'Local - Calgary or Alberta - makes them reachable and SR&ED-eligible',
    ],
    sred_angle: 'SR&ED grant covers 35-45% of AI automation cost - immediate ROI, no capital risk',
    primary_market: 'CANADA',
    outreach_channel: 'reddit_comment',
    max_per_run: 5,
    offer: 'custom_ai_build',
    message_template: `Hi [FirstName],

Saw your question about getting AI to work for your business - this is exactly where most Calgary owners get stuck.

The tool is rarely the problem. The gap is connecting it to the actual workflow: where does the data come from, what triggers the AI step, where does the output go.

- ChatGPT handles a task once but does not run automatically when a new lead comes in
- A workflow that runs on its own needs 3-4 connected pieces, not just the AI model
- Most Calgary SMBs that have this running cut 2-3 hours of daily admin in the first week

Happy to walk you through the exact setup for your situation - 15 minutes.

- Kirill, Calgary
launchsoloai.com`,
    added_at: '2026-05-10',
  };
  appendLog('update', `icp-outreach: Calgary AI buyer-intent scout cluster added - queries: ${CALGARY_AI_BUYER_TARGET.search_queries.join(', ')}`);

  // Calgary real estate implementation-intent scout cluster
  // targets agents, brokers, and small teams asking how to automate lead follow-up,
  // CRM cleanup, listing/admin workflows, or transaction coordination
  const CALGARY_REAL_ESTATE_SCOUT_TARGET = {
    target_persona: 'Calgary real estate agent, broker, or small real estate team asking how to automate lead follow-up, CRM cleanup, listing admin, or transaction coordination using tools they already have',
    search_queries: [
      'site:reddit.com realtor "lead follow up" automate OR CRM',
      'site:reddit.com "real estate agent" CRM automation OR cleanup',
      'site:linkedin.com/posts Calgary realtor Zapier OR Make OR n8n',
      'site:reddit.com "transaction coordinator" automate OR workflow',
      'site:linkedin.com/posts Calgary "real estate" "admin" OR "listing admin" automate',
      'site:reddit.com/r/realtors CRM follow-up automation',
      '"Calgary" "realtor" OR "real estate agent" "Follow Up Boss" OR "FUB" automate',
      '"Calgary" "real estate" "listing admin" OR "transaction coordination" workflow',
      'site:reddit.com real estate team "spreadsheet" CRM automate',
      'site:facebook.com/groups Calgary realtors CRM automation',
    ],
    pain_points: [
      'Lead follow-up sits in spreadsheet or email until someone manually sequences it - new portal leads go cold in 24-48 hours',
      'CRM records go stale because updating after showings and calls is a manual step no one has time for',
      'Transaction coordination requires chasing 6-8 parties by email with no single tracking board',
      'Listing admin - status updates, document requests, disclosure packages - all manual and scattered across email and text',
    ],
    offer: 'Lead follow-up and transaction coordination automation - automated sequences from portal lead events, CRM auto-update after showings, single-screen transaction board. One week build, tools they already have.',
    sred_angle: 'SR&ED covers 35-45% of the build cost - immediate ROI, no capital risk',
    primary_market: 'CANADA',
    geography: 'Calgary, Alberta',
    outreach_channel: 'reddit_comment',
    max_per_run: 5,
    sred_eligible: true,
    added_at: '2026-05-11',
    message_template: `Hi [FirstName],

Saw your question about [lead follow-up / CRM / transaction admin] - this is the exact gap most Calgary agents hit when they try to automate without rebuilding their whole stack.

- Portal leads need a follow-up sequence fired within 2 hours - manual outreach means most go cold before contact
- CRM records only stay accurate if updating them is automatic, not a manual step after every showing
- Transaction coordination across 6-8 parties needs one board, not 30 email threads

Built a lead-to-close automation for a Calgary agent last month using the tools they already had (Follow Up Boss + Google Sheets + Zapier) - cut their daily admin from 3 hours to 20 minutes.

SR&ED covers 35-45% of the build if you are a Canadian business. 15 minutes to map the exact gaps in your setup.

- Kirill, Calgary
launchsoloai.com`,
  };
  appendLog('update', `icp-outreach: Calgary real estate implementation-intent scout cluster added - queries: ${CALGARY_REAL_ESTATE_SCOUT_TARGET.search_queries.slice(0, 3).join(', ')}`);

  // Canada phone-system-switching scout cluster
  // Targets SMB owners publicly discussing Grasshopper, Yeastar, voicemail overload,
  // missed-call admin pain. Pitches back-office workflow automation, NOT voice receptionist.
  const PHONE_SYSTEM_SWITCHING_SCOUT_TARGET = {
    target_persona: 'Canadian SMB owner publicly discussing Grasshopper, Yeastar, receptionist cost, or voicemail/missed-call admin overload - looking to cut phone overhead, not buy another phone tool',
    search_queries: [
      'site:reddit.com Grasshopper missed calls small business',
      'site:reddit.com after hours voicemail small business help',
      'site:reddit.com receptionist too expensive small business canada',
      'site:facebook.com/groups Grasshopper small business help',
      'site:linkedin.com/posts small business owner missed calls admin overload',
    ],
    pain_points: [
      'Voicemail and missed-call log creates 1-2 hours per day of manual callback and CRM update work',
      'After-hours calls hit voicemail with no automated follow-up - leads go cold overnight',
      'Grasshopper or Yeastar cost rising but admin overhead not reduced - still manual',
      'Receptionist too expensive but no system to handle contact routing without one',
      'Missed calls never make it into CRM - only the ones someone remembers to log',
    ],
    offer: 'Back-office contact automation - auto-logs missed contacts from any source, routes to follow-up queue, triggers reminder sequences. No receptionist required. One week build, $2,500-$5,000 CAD. SR&ED covers 35-45%.',
    sred_angle: 'SR&ED covers 35-45% of build cost - immediate ROI, no capital risk',
    primary_market: 'CANADA',
    outreach_channel: 'reddit_comment',
    max_per_run: 5,
    sred_eligible: true,
    added_at: '2026-05-11',
    note: 'DO NOT pitch voice agents or AI receptionists - product discontinued 2026-04-22',
    message_template: `Hi [FirstName],

Saw your post about [Grasshopper cost / voicemail backlog / missed calls] - the phone system is rarely the actual problem.

The admin work that builds up around it is:
- Missed calls need someone to check voicemail, log the contact, and follow up manually
- After-hours contacts go cold because no system routes them to a queue
- Every missed contact that doesn't make it into your CRM is lost follow-up

Built a contact intake automation for a Calgary SMB last month that auto-logs every missed contact from voicemail, web form, or email into one queue, fires a follow-up reminder in under 2 minutes, and updates the CRM record automatically.

SR&ED covers 35-45% of the build if you are a Canadian business. 15 minutes to map the exact setup for your volume.

- Kirill, Calgary
launchsoloai.com`,
  };
  appendLog('update', `icp-outreach: Canada phone-system-switching scout cluster added - queries: ${PHONE_SYSTEM_SWITCHING_SCOUT_TARGET.search_queries.join(', ')}`);

  // Dental and physiotherapy clinic admin-pain scout cluster
  // Targets Canadian clinic managers/owners publicly describing front-desk overload,
  // no-shows, manual intake/admin, or manual booking follow-up
  const DENTAL_PHYSIO_CLINIC_SCOUT_TARGET = {
    target_persona: 'Canadian dental or physiotherapy clinic manager or owner publicly describing front-desk overload, no-shows, manual intake/admin, or manual booking follow-up',
    search_queries: [
      'site:reddit.com dental office front desk overwhelmed',
      'site:reddit.com physiotherapy clinic admin overwhelmed',
      'site:facebook.com/groups dental office manager scheduling help',
      'site:linkedin.com/posts clinic manager intake process manual',
      '"Calgary" (dental clinic OR physio clinic) (automation OR admin OR scheduling)',
    ],
    pain_points: [
      'Front-desk staff spend 2-4 hours per day on manual intake form processing and routing',
      'No-show follow-up done by phone - 15-20 minutes per no-show with no automation',
      'Appointment reminders sent one by one from a shared calendar or phone',
      'Rebooking after cancellations requires staff to call the waitlist manually',
      'Each no-show at a dental clinic costs $150-400 CAD in lost chair time',
    ],
    offer: 'Clinic admin automation - intake form routing, no-show follow-up and rebooking prompts, appointment reminder sequences. One week build, no new software.',
    sred_angle: 'SR&ED covers 35-45% of build cost - immediate ROI, no capital risk',
    primary_market: 'CANADA',
    outreach_channel: 'reddit_comment',
    max_per_run: 5,
    sred_eligible: true,
    added_at: '2026-05-12',
    message_template: `Hi [FirstName],

Saw your post about [front-desk workload / no-shows / intake admin] - this is the exact admin pattern I have seen at several Canadian clinics this year.

- Intake forms routed by hand add 20-30 minutes per new patient when staff has to re-enter data
- No-show follow-up by phone takes 15-20 minutes per patient with no guarantee of rebooking
- Appointment reminders sent one by one from a shared calendar are the first thing cut when the desk gets busy

Built a clinic intake and no-show recovery automation for a Calgary dental practice last month - cut their daily admin from 3 hours to under 30 minutes.

SR&ED covers 35-45% of the build if you are a Canadian business. 15 minutes to walk through the exact setup for your clinic.

- Kirill, Calgary
launchsoloai.com`,
  };
  appendLog('update', `icp-outreach: dental/physio clinic admin-pain scout cluster added - queries: ${DENTAL_PHYSIO_CLINIC_SCOUT_TARGET.search_queries.join(', ')}`);

  // Canada clinic software distress scout cluster
  // Targets dental, physio, and small medical admins publicly complaining about
  // Jane App, Dentrix, or Open Dental - or describing no-show, insurance paperwork, manual recall pain
  const CANADA_CLINIC_SOFTWARE_DISTRESS_SCOUT_TARGET = {
    target_persona: 'Canadian dental, physio, or small medical admin/manager publicly complaining about Jane App, Dentrix, or Open Dental, or describing no-show pain, insurance paperwork overhead, or manual patient recalls in public forums',
    search_queries: [
      'site:reddit.com "Jane App" problem OR issue OR hate OR slow',
      'site:reddit.com "Dentrix" problem OR slow OR expensive OR replacing',
      'site:reddit.com "Open Dental" issue OR help OR problem',
      'site:reddit.com dental office "insurance paperwork" manual',
      'site:reddit.com physio clinic "patient recall" manual OR spreadsheet',
      'site:reddit.com dental admin "no-show" follow-up manual',
      'site:facebook.com/groups dental office manager "Jane App" OR "Dentrix" problem',
      'site:linkedin.com/posts dental clinic admin insurance paperwork workflow',
      '"dental office" OR "physio clinic" "insurance paperwork" manual site:reddit.com',
      '"patient recall" manual spreadsheet dental OR physio site:reddit.com',
    ],
    intent_signals: [
      'jane app', 'dentrix', 'open dental',
      'insurance paperwork', 'insurance billing manual', 'insurance claim',
      'patient recall', 'manual recall', 'recall spreadsheet',
      'no-show follow-up', 'no show manual',
      'intake form manual', 'front desk overwhelmed',
    ],
    primary_market: 'CANADA',
    offer: 'custom_ai_build',
    outreach_channel: 'reddit_comment',
    max_per_run: 5,
    sred_eligible: true,
    added_at: '2026-05-12',
    message_template: `Hi [FirstName],

Saw your post about [Jane App / Dentrix / Open Dental / insurance paperwork / patient recalls] - this is the exact gap I have seen at several Canadian clinics using the same software.

- Insurance claim pre-fill still done by hand even with clinic software in place - runs 1-2 hours per front-desk shift
- Patient recall lists managed on a spreadsheet alongside the booking system - double work every week
- No-show follow-up still done by phone call - 15-20 minutes per patient with no rebooking automation

Built an automation layer that runs on top of existing clinic software - no replacement needed. SR&ED covers 35-45% of the build if you are a Canadian business.

15 minutes to walk through the exact gaps in your setup.

- Kirill, Calgary
launchsoloai.com`,
  };
  appendLog('update', `icp-outreach: Canada clinic software distress scout cluster added - Jane App, Dentrix, Open Dental targets - queries: ${CANADA_CLINIC_SOFTWARE_DISTRESS_SCOUT_TARGET.search_queries.slice(0, 3).join(', ')}`);

  db.close();
  log("done");

  // Wiki update
  if (dispatched.length > 0) {
    appendLog("update", `icp-outreach: dispatched ${dispatched.length} drafts (${dispatched.join(", ")})`);
  }
}

main().catch(e => {
  console.error("[icp-outreach] FATAL:", e.message);
  tgSendToKirill(`🚨 icp-outreach-bot CRASHED: ${e.message}`).catch(() => {});
  process.exit(1);
});
