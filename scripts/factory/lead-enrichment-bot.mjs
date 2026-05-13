/**
 * lead-enrichment-bot.mjs
 *
 * First multi-tool agent in the system. Built April 7 2026 on Claude Sonnet 4.6.
 *
 * Goal: take a lead, give Claude tool access to investigate it (fetch Reddit
 * profile, read related posts, query DB), and produce a structured classification
 * + recommendation for next outreach action.
 *
 * Categories:
 *   - ready_buyer: explicit pain + asked for help, fits ICP, recent activity
 *   - warming: shows pain in posts but hasn't asked, ICP fit
 *   - peer: another consultant, potential collab/referral source
 *   - lurker: account exists, low engagement, hard to reach
 *   - not_fit: outside ICP or off-topic
 *
 * Architecture:
 *   - Spawns Claude CLI as subprocess with --model claude-sonnet-4-6
 *   - Provides Bash tool for Reddit fetches + Read for DB
 *   - Uses explicit <thinking> block (think tool pattern)
 *   - Max turns 8 to allow chained investigation
 *   - Parses structured output back into DB columns
 *
 * Run:
 *   node scripts/factory/lead-enrichment-bot.mjs <lead_id>
 *   node scripts/factory/lead-enrichment-bot.mjs --batch  (enriches all stage='new' leads with reddit source)
 */
import Database from "better-sqlite3";
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { getWikiContext, appendLog, updatePage } from "../../wiki/reader.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DB_PATH = resolve(ROOT, ".data/linkedin-brand-os.sqlite");
const ENRICH_DIR = resolve(ROOT, ".data/enrichment");
if (!existsSync(ENRICH_DIR)) mkdirSync(ENRICH_DIR, { recursive: true });

const env = Object.fromEntries(
  readFileSync(resolve(ROOT, "apps/api/.env"), "utf-8").split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const TG = env.TELEGRAM_BOT_TOKEN, CHAT = env.TELEGRAM_CHAT_ID;
const { callAI, MODEL_STRONG, MODEL_MINI } = await import("./orchestrator.mjs");

const db = new Database(DB_PATH);

// Add enrichment columns if missing (idempotent)
db.exec(`
  CREATE TABLE IF NOT EXISTS lead_enrichment (
    lead_id TEXT PRIMARY KEY,
    classification TEXT,
    confidence TEXT,
    reasoning TEXT,
    recommended_action TEXT,
    next_message_angle TEXT,
    enriched_at TEXT,
    model TEXT,
    raw_output TEXT
  );
`);

async function tg(text) {
  if (!TG || !CHAT) return;
  await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT, text, parse_mode: "HTML", disable_web_page_preview: true }),
  }).catch(() => {});
}

// Wiki context injected into every enrichment prompt so the model knows scoring rules
const WIKI_CTX = getWikiContext(["market/learned-scoring.md", "market/icp-profile.md", "leads/patterns.md"]);

function buildPrompt(lead) {
  return `<role>You are a lead-enrichment agent for Kirill, a Calgary-based AI/automation consultant looking for his first $750-$2500 CAD paying client. You investigate one lead at a time and produce a structured classification + recommended next action.</role>

${WIKI_CTX}

Use the wiki context above to inform your scoring. The learned scoring rules contain hard accept/reject patterns trained from real data. Follow them.

<icp>
Kirill's ideal customer:
- Solo founder, small business owner, freelancer, or agency owner (1-50 employees)
- Running a real business (pre-revenue with shipped product counts)
- Stuck on automation, integration, sales, workflow, AI, or stabilization problems
- Async-friendly preferred but not required
- Budget $1500-$10000 CAD for fixed-scope work
- NOT looking for retainers, NOT looking for free advice, NOT another consultant

Recent productized offers:
1. Vibe-Code Audit + Stabilization - for post-launch SaaS founders with shaky foundations ($1.5-2.5K CAD)
2. Reply Chaser Automation - for any business losing leads to slow follow up ($1.5K)
3. First 10 Customers Sales Motion - for solo SaaS founders pre-PMF ($2K)
4. Custom AI / n8n / automation builds ($2.5-8K)

Live website: https://launchsoloai.com (deployed Apr 7 2026, dark theme, 3 case studies, contact via kirill@launchsoloai.com). Any outreach you draft should consider linking to it.
</icp>

<lead_to_investigate>
ID: ${lead.id}
Name/handle: ${lead.name}
Source: ${lead.source} / ${lead.source_platform}
Source URL: ${lead.source_url || "(none)"}
Score: ${lead.score}
Stage: ${lead.stage}
Pain description (from initial scrape): ${(lead.pain_description || "").slice(0, 800)}
Notes: ${lead.notes || "(none)"}
</lead_to_investigate>

<your_tools>
You have Bash, Read, and Write available. Use them to investigate this lead.

Recommended investigation steps (not all required, use judgment):
1. If lead has a Reddit handle, fetch their recent comments to see what they actually post about:
   curl -s -A "Mozilla/5.0" "https://www.reddit.com/user/<USERNAME>/comments.json?limit=25"
   Look for: pain mentions, technical depth, account age, engagement patterns
2. Fetch their submitted posts to see what they ASK about (vs what they comment on):
   curl -s -A "Mozilla/5.0" "https://www.reddit.com/user/<USERNAME>/submitted.json?limit=10"
3. If the lead's source URL points to a specific thread, fetch the full thread to see context:
   curl -s -A "Mozilla/5.0" "<SOURCE_URL>.json?limit=200"
4. Query the leads table for any prior contact with this person or similar handles:
   sqlite3 ${DB_PATH} "SELECT id,stage,notes FROM leads WHERE name LIKE '%<username>%';"

Note: Reddit may rate-limit (429). If a fetch fails with 429, do NOT retry the same URL. Move on with the data you have. Failing closed is correct.
</your_tools>

<thinking_protocol>
After EACH tool call, write a brief <thinking> block reflecting on what you learned and what to investigate next. This is required for chained tool use. Format:

<thinking>
What I just learned: ...
What this tells me about the lead: ...
What I should check next (if anything): ...
</thinking>

After 3-4 investigations, stop investigating and write your final classification.
</thinking_protocol>

<output_format>
End your work with EXACTLY this JSON block (no markdown fence, just the raw JSON on its own lines):

ENRICHMENT_RESULT:
{
  "classification": "ready_buyer" | "warming" | "peer" | "lurker" | "not_fit",
  "confidence": "high" | "medium" | "low",
  "reasoning": "2-4 sentences explaining the classification based on what you observed",
  "recommended_action": "dm_now" | "comment_first" | "wait" | "skip",
  "next_message_angle": "one sentence suggesting the angle for outreach (or 'N/A' if skipping)",
  "investigation_summary": "what you actually did (3-5 bullet equivalents in one paragraph)",
  "pain_category": "lead_response_delay" | "missed_followups" | "manual_admin_overload" | "crm_chaos" | "inbox_chaos" | "manual_scheduling" | "quoting_intake_friction" | "reporting_manual" | "owner_bottleneck" | "unclear",
  "pain_evidence": "1-2 sentences: the exact evidence of operational pain you found (quote their words if possible)",
  "best_micro_offer": "missed_lead_recovery" | "followup_automation" | "inbox_to_crm" | "admin_workflow_cleanup" | "quote_request_intake" | "do_not_pitch",
  "offer_fit_reason": "1 sentence: why this specific offer matches their pain",
  "pain_score": 0-5,
  "urgency_score": 0-5,
  "budget_score": 0-5,
  "access_score": 0-5,
  "roi_score": 0-5
}

SCORING RUBRIC (use this, do not improvise):
pain_score: 0=no visible pain, 1=vague interest only, 3=specific operational pain implied, 5=strong costly pain clearly evidenced
urgency_score: 0=no urgency, 1=weak growth signal, 3=hiring/change/growth/complaint present, 5=immediate operational strain or clear trigger
budget_score: 0=hobby/unclear, 1=weak commercial signal, 3=real business with signs of spend, 5=strong ability to pay likely
access_score: 0=no contact path, 1=weak path only, 3=usable contact path exists, 5=clear reachable decision-maker path
roi_score: 0=impossible to prove, 1=abstract value only, 3=somewhat measurable, 5=directly measurable time/revenue recovery

pain_category: pick the CLOSEST match to the operational pain you observed. Use "unclear" only if genuinely ambiguous.
best_micro_offer: pick the offer that best matches their pain. Use "do_not_pitch" for peers, lurkers, or leads with no actionable pain.
</output_format>

<rules>
- Use only short hyphens, never em dashes
- Do not invent facts about the lead. If you cannot verify, say "unverified" in reasoning
- If Reddit rate-limits, work with what is in the lead row alone and lower confidence accordingly
- Maximum 5 tool calls. After 5, stop and classify with what you have
- Be honest. If the lead is weak, say so. Kirill needs accurate signals not optimistic guesses
- This is your first run as a multi-tool agent. Quality matters more than speed. Take the time to think between tools
</rules>

Begin investigation now.`;
}

// GPT Mini first-pass filter (migrated Apr 15 2026 from Haiku CLI)
// Cuts enrichment cost ~6x by triaging obvious not_fit / peer / lurker before full enrichment.
// Only "potentially_warming" leads escalate to MODEL_STRONG.
async function miniPrefilter(lead) {
  const startedAt = Date.now();
  const haikuPrompt = `You are a fast triage filter for Kirill, a Calgary AI/automation consultant.

Kirill helps: solo founders, small business owners (1-50 employees), freelancers, agency owners, anyone running a real business who is stuck on automation, sales, integrations, AI, workflow problems. Budget $1.5K-10K CAD for fixed-scope work.

Look at this prospect ONLY using the data below (no tools, no investigation). Make a fast call.

LEAD:
Name: ${lead.name}
Source: ${lead.source}
Headline/role: ${(lead.role || "").slice(0, 200)}
Pain text: ${(lead.pain_description || "").slice(0, 1500)}

Output exactly one line in this format:
TRIAGE: <potentially_warming|likely_not_fit>
REASON: <one sentence why>

Rules:
- "potentially_warming" = ANY of these: has a business, mentions a problem, asks for help, discusses tools/automation, talks about growth/scaling, mentions hiring/team, asks about pricing, talks about operations. DEFAULT TO THIS if unclear.
- "likely_not_fit" = ONLY use for these exact cases: clearly a recruiter posting a job ad, clearly a student doing homework, clearly selling MLM/crypto scam, clearly a large enterprise (500+ employees), clearly a bot/spam account.

IMPORTANT: When in doubt, say potentially_warming. It is 10x worse to reject a real prospect than to let a bad one through.

Be fast. One line each. No preamble.`;

  const promptFile = resolve(ENRICH_DIR, `haiku-${lead.id}.txt`);
  writeFileSync(promptFile, haikuPrompt);

  let out;
  try {
    out = await callAI(haikuPrompt, "Triage this lead now.", MODEL_MINI, false);
  } catch (e) {
    out = `ERROR: ${e.message}`;
  }
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  const triage = /TRIAGE:\s*(potentially_warming|likely_not_fit)/i.exec(out);
  const reason = /REASON:\s*(.+)/i.exec(out);
  return {
    decision: triage ? triage[1].toLowerCase() : "potentially_warming", // fail open - escalate on parse error
    reason: reason ? reason[1].trim() : "(no reason parsed)",
    elapsed,
    raw: out.slice(0, 1000),
  };
}

async function enrichOne(leadId) {
  const lead = db.prepare(`SELECT * FROM leads WHERE id=?`).get(leadId);
  if (!lead) { console.error(`no lead ${leadId}`); return null; }

  const alreadyEnriched = db.prepare(`SELECT lead_id FROM lead_enrichment WHERE lead_id=?`).get(leadId);
  if (alreadyEnriched) {
    console.warn(`[enrich] skipped: already enriched id=${leadId}`);
    return null;
  }
  if (lead.stage && lead.stage !== 'new') {
    console.warn(`[enrich] skipped: already enriched id=${leadId} stage=${lead.stage}`);
    return null;
  }

  console.log(`[enrich] ${leadId} - ${lead.name}`);

  // Mini triage first - skip full enrichment for obvious non-ICP
  const triage = await miniPrefilter(lead);
  console.log(`[enrich] ${leadId} mini → ${triage.decision} (${triage.elapsed}s) ${triage.reason.slice(0, 100)}`);

  if (triage.decision === "likely_not_fit") {
    // Write a stub enrichment row so we do not re-run on the same lead
    db.prepare(`
      INSERT OR REPLACE INTO lead_enrichment
        (lead_id, classification, confidence, reasoning, recommended_action, next_message_angle, enriched_at, model, raw_output)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      leadId, "not_fit", "high", `Mini triage: ${triage.reason}`,
      "skip", "N/A",
      new Date().toISOString(), "gpt-5.4-mini", triage.raw
    );
    return { lead, parsed: { classification: "not_fit", confidence: "high", reasoning: triage.reason, recommended_action: "skip", next_message_angle: "N/A", investigation_summary: "Mini triage only" }, elapsed: triage.elapsed, prefiltered: true };
  }

  // Escalate to MODEL_STRONG for full enrichment
  const prompt = buildPrompt(lead);
  const promptFile = resolve(ENRICH_DIR, `prompt-${leadId}.txt`);
  writeFileSync(promptFile, prompt);

  const startedAt = Date.now();
  let output;
  try {
    output = await callAI(prompt, "Begin investigation now.", MODEL_STRONG, false);
  } catch (e) {
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.error(`[enrich] ${leadId} FAILED: ${e.message} (${elapsed}s)`);
    writeFileSync(resolve(ENRICH_DIR, `output-${leadId}.txt`), `ERROR: ${e.message}`);
    return { lead, error: e.message, output: "" };
  }
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  writeFileSync(resolve(ENRICH_DIR, `output-${leadId}.txt`), output);

  // Parse ENRICHMENT_RESULT JSON block (tolerate optional markdown fence)
  const m = output.match(/ENRICHMENT_RESULT:\s*(?:```(?:json)?\s*)?(\{[\s\S]*?\n\})\s*(?:```)?/);
  if (!m) {
    console.error(`[enrich] ${leadId} NO JSON in output (${elapsed}s)`);
    return { lead, error: "no JSON parsed", output };
  }
  let parsed;
  try { parsed = JSON.parse(m[1]); }
  catch (e) {
    console.error(`[enrich] ${leadId} JSON parse error: ${e.message}`);
    return { lead, error: `parse: ${e.message}`, output };
  }

  // Compute buyer_score from 5 dimensions
  const ps = parseInt(parsed.pain_score) || 0;
  const us = parseInt(parsed.urgency_score) || 0;
  const bs = parseInt(parsed.budget_score) || 0;
  const as_ = parseInt(parsed.access_score) || 0;
  const rs = parseInt(parsed.roi_score) || 0;
  // Reweighted Apr 14 2026: pain + access matter most, budget is weakest signal
  // (bootstrapped founders can't signal budget upfront but still pay)
  const buyerScore = +(ps * 0.35 + us * 0.20 + bs * 0.10 + as_ * 0.25 + rs * 0.10).toFixed(2);

  db.prepare(`
    INSERT OR REPLACE INTO lead_enrichment
      (lead_id, classification, confidence, reasoning, recommended_action, next_message_angle,
       enriched_at, model, raw_output,
       pain_category, pain_evidence, best_micro_offer, offer_fit_reason,
       pain_score, urgency_score, budget_score, access_score, roi_score, buyer_score)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    leadId, parsed.classification, parsed.confidence, parsed.reasoning,
    parsed.recommended_action, parsed.next_message_angle,
    new Date().toISOString(), "gpt-5.4", output.slice(0, 50000),
    parsed.pain_category || "unclear",
    parsed.pain_evidence || null,
    parsed.best_micro_offer || "do_not_pitch",
    parsed.offer_fit_reason || null,
    ps, us, bs, as_, rs, buyerScore
  );

  // AU priority tagging: if source URL is a .au domain or pain text mentions AU signals
  const auSignals = ["com.au", "net.au", "org.au", "australia", "australian", "sydney", "melbourne", "brisbane", "perth", "adelaide", " aus ", "asx", "ato.gov"];
  const leadText = `${lead.source_url || ""} ${lead.pain_description || ""} ${lead.notes || ""}`.toLowerCase();
  if (auSignals.some(s => leadText.includes(s))) {
    db.prepare(`UPDATE leads SET notes = CASE WHEN notes IS NULL OR notes = '' THEN 'market:AU priority' ELSE notes || ' | market:AU priority' END WHERE id = ?`).run(leadId);
    console.log(`[enrich] ${leadId} tagged market:AU priority`);
  }

  console.log(`[enrich] ${leadId} → ${parsed.classification} (${parsed.confidence}) buyer=${buyerScore} pain=${ps} offer=${parsed.best_micro_offer || "?"} ${elapsed}s`);
  return { lead, parsed, output, elapsed, buyerScore };
}

// CLI
const arg = process.argv[2];
if (!arg) { console.error("usage: lead-enrichment-bot.mjs <lead_id|--batch>"); process.exit(1); }

if (arg === "--batch") {
  const BATCH_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes max for full batch
  const batchStart = Date.now();
  const leads = db.prepare(`SELECT id FROM leads WHERE stage='new' AND score >= 60 AND id NOT IN (SELECT lead_id FROM lead_enrichment) ORDER BY created_at DESC LIMIT 50`).all();
  console.log(`[enrich] batch: ${leads.length} leads (timeout: ${BATCH_TIMEOUT_MS / 60000}min)`);
  let warmingFound = 0;
  for (const l of leads) {
    if (Date.now() - batchStart > BATCH_TIMEOUT_MS) {
      console.log(`[enrich] batch timeout reached after ${((Date.now() - batchStart) / 60000).toFixed(1)}min, stopping`);
      break;
    }
    const r = await enrichOne(l.id);
    if (r?.parsed?.classification === "warming" || r?.parsed?.classification === "ready_buyer") warmingFound++;
    await new Promise(r => setTimeout(r, 2000));
  }
  // Update wiki after batch
  if (leads.length > 0) {
    const total = db.prepare("SELECT COUNT(*) as c FROM lead_enrichment").get()?.c || 0;
    const warming = db.prepare("SELECT COUNT(*) as c FROM lead_enrichment WHERE classification IN ('warming','ready_buyer')").get()?.c || 0;
    const rate = total > 0 ? (warming / total * 100).toFixed(1) : "0";
    appendLog("update", `enrichment batch: ${leads.length} processed, ${warmingFound} new warming. Total: ${total} enriched, ${warming} warming (${rate}%)`);
  }
} else {
  const r = await enrichOne(arg);
  // Only notify Telegram for warming/ready_buyer - the only actionable classifications.
  // not_fit/peer/lurker just generate noise. Apr 8 2026: Kirill flagged 40min of spam
  // when batch ran 10 not_fit results in a row.
  if (r && r.parsed && ["warming", "ready_buyer"].includes(r.parsed.classification)) {
    await tg(`<b>🧠 Lead enrichment: ${r.lead.name}</b>

<b>Classification:</b> ${r.parsed.classification} (${r.parsed.confidence})
<b>Recommended action:</b> ${r.parsed.recommended_action}
<b>Next angle:</b> ${r.parsed.next_message_angle}

<b>Reasoning:</b>
<i>${r.parsed.reasoning}</i>

Model: gpt-5.4  •  Time: ${r.elapsed}s`);
  } else if (r && !r.parsed) {
    await tg(`<b>⚠️ Lead enrichment FAILED: ${r.lead.name}</b>\n\nError: ${r.error}`);
  }
  // not_fit/peer/lurker: silent. They show up in heartbeat counts only.
}

db.close();
