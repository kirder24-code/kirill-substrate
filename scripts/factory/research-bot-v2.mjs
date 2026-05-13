/**
 * research-bot-v2.mjs
 *
 * Multi-tool research agent on Sonnet 4.6 subscription.
 * Replaces the legacy research-bot.mjs (which was OpenAI-based).
 *
 * Goal: take a lead, investigate their source/profile/website/recent activity,
 * produce a structured research_summary that informs both enrichment classification
 * and outbound message angle.
 *
 * Tools available to the agent:
 *   - Bash (for curl on cached/non-rate-limited sources)
 *   - WebFetch (for non-Reddit URLs like company websites)
 *   - Read (for cached files in /tmp or .data/)
 *   - sqlite3 via Bash (for cross-referencing leads table)
 *
 * Output: stores into leads.research_summary column + writes artifact to .data/research/
 *
 * Run:
 *   node scripts/factory/research-bot-v2.mjs <lead_id>
 *   node scripts/factory/research-bot-v2.mjs --batch  (any lead with research_summary IS NULL)
 */
import Database from "better-sqlite3";
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { getWikiContext, appendLog } from "../../wiki/reader.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DB_PATH = resolve(ROOT, ".data/linkedin-brand-os.sqlite");
const RESEARCH_DIR = resolve(ROOT, ".data/research-v2");
if (!existsSync(RESEARCH_DIR)) mkdirSync(RESEARCH_DIR, { recursive: true });

const env = Object.fromEntries(
  readFileSync(resolve(ROOT, "apps/api/.env"), "utf-8").split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const TG = env.TELEGRAM_BOT_TOKEN, CHAT = env.TELEGRAM_CHAT_ID;
const { callAI, MODEL_STRONG } = await import("./orchestrator.mjs");

const db = new Database(DB_PATH);

async function tg(text) {
  if (!TG || !CHAT) return;
  await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT, text, parse_mode: "HTML", disable_web_page_preview: true }),
  }).catch(() => {});
}

function buildPrompt(lead) {
  return `<role>You are the Research Agent for Kirill's outreach pipeline. You investigate one lead deeply and produce a structured research summary that informs whether and how Kirill should reach out.</role>

<icp>
Kirill is a Calgary-based AI/automation consultant looking for first $750-$2500 CAD paying client. His ICP:
- Solo SaaS founders or 1-15 employee businesses
- Has shipped product / has revenue
- Stuck on a specific problem (automation, integration, stabilization)
- Async-friendly, fixed-scope work
- NOT looking for retainers, NOT free advice, NOT another consultant

Productized offers: Vibe-Code Audit + Stabilization, Reply Chaser Automation, First 10 Customers, Custom AI/n8n builds.

Live website: https://launchsoloai.com (Apr 7 2026, with case studies, pricing, "pay only after audit delivered" guarantee). Any outreach angle you suggest should be compatible with linking the site as the destination.
</icp>

<lead_to_research>
ID: ${lead.id}
Name: ${lead.name}
Source: ${lead.source} / ${lead.source_platform}
Source URL: ${lead.source_url || "(none)"}
Email: ${lead.email || "(none)"}
Company: ${lead.company || "(none)"}
Website: ${lead.linkedin_url || "(none)"}
Pain description (initial scrape): ${(lead.pain_description || "").slice(0, 800)}
Notes: ${lead.notes || "(none)"}
Existing research_summary: ${(lead.research_summary || "(none)").slice(0, 500)}
</lead_to_research>

<your_tools>
You have Bash, Read, Write, WebFetch.

Investigation playbook (use what is appropriate for this lead, not all of them):

1. If source is Reddit and the post URL is set:
   Try: curl -s -A "Mozilla/5.0" "<URL>.json"
   If 429, fall back to: read any cached version in /tmp/ or .data/research-v2/

2. If lead has a Reddit username (name field starts with letters not "u/"):
   curl -s -A "Mozilla/5.0" "https://www.reddit.com/user/<NAME>/comments.json?limit=25"
   curl -s -A "Mozilla/5.0" "https://www.reddit.com/user/<NAME>/submitted.json?limit=10"
   Look for: account age (oldest comment), recent activity, sub diversity, what they ASK vs what they answer

3. If lead has a website (linkedin_url field, common confusion - that column is also used for site):
   Use WebFetch to read the homepage and the about/services page
   Look for: what they sell, how they describe themselves, signs of automation pain (manual processes mentioned), tech stack hints

4. If lead has an email with a domain:
   Domain itself can hint at company. Use Bash: dig +short MX <domain>

5. Cross-reference:
   sqlite3 ${DB_PATH} "SELECT id, stage, notes FROM leads WHERE name LIKE '%<part>%' OR email LIKE '%<domain>%';"
   Find any prior contacts or related leads.

6. Local cache:
   Check if there is already raw data in /tmp/ or .data/ for this lead (e.g., /tmp/vibe_thread.json holds a Reddit thread). Use Read first before re-fetching.

You may make up to 6 tool calls. After each tool call, write a brief <thinking> block reflecting on what you learned.

If a tool call fails (429, timeout, blocked), do NOT retry the same URL. Move on with what you have.
</your_tools>

<thinking_protocol>
After each tool call, write:
<thinking>
What I just learned: ...
What this tells me about the lead: ...
What I should check next (or "done"): ...
</thinking>
</thinking_protocol>

<output_format>
End with EXACTLY this JSON block on its own lines (no markdown fence):

RESEARCH_RESULT:
{
  "summary": "3-5 sentences capturing what kind of lead this is, what they likely need, and the key facts you verified",
  "verified_facts": ["fact 1", "fact 2", ...],
  "unverified_assumptions": ["assumption that needs more data"],
  "icp_fit": "strong" | "moderate" | "weak" | "none",
  "icp_reasoning": "one sentence on why",
  "specific_pain_signals": ["concrete pain quotes or observations"],
  "outreach_angle": "the single best opening hook for a message to this lead",
  "outreach_format": "reddit_comment" | "reddit_dm" | "linkedin_dm" | "cold_email" | "wait",
  "red_flags": ["any reasons NOT to reach out, or empty array"],
  "investigation_notes": "what tools you used and what was blocked"
}
</output_format>

<rules>
- Use only short hyphens, never em dashes
- Do not invent facts. If you cannot verify, list it as unverified_assumption
- Be honest about icp_fit. weak/none is a valuable signal that saves a slot
- If all external tools were blocked (429 etc), set icp_fit based on lead row alone and lower confidence in summary
- Maximum 6 tool calls. Stop and synthesize after that
</rules>

Begin investigation now.`;
}

async function researchOne(leadId) {
  const lead = db.prepare(`SELECT * FROM leads WHERE id=?`).get(leadId);
  if (!lead) { console.error(`no lead ${leadId}`); return null; }
  console.log(`[research] ${leadId} - ${lead.name}`);

  const prompt = buildPrompt(lead);
  const promptFile = resolve(RESEARCH_DIR, `prompt-${leadId}.txt`);
  writeFileSync(promptFile, prompt);

  const startedAt = Date.now();
  let output;
  try {
    output = await callAI(prompt, "Begin investigation now.", MODEL_STRONG, false);
  } catch (e) {
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.error(`[research] ${leadId} FAILED: ${e.message} (${elapsed}s)`);
    writeFileSync(resolve(RESEARCH_DIR, `output-${leadId}.txt`), `ERROR: ${e.message}`);
    return { lead, error: e.message, output: "" };
  }
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  writeFileSync(resolve(RESEARCH_DIR, `output-${leadId}.txt`), output);

  const m = output.match(/RESEARCH_RESULT:\s*(?:```(?:json)?\s*)?(\{[\s\S]*?\n\})\s*(?:```)?/);
  if (!m) {
    console.error(`[research] ${leadId} NO JSON in output (${elapsed}s)`);
    return { lead, error: "no JSON parsed", output };
  }
  let parsed;
  try { parsed = JSON.parse(m[1]); }
  catch (e) {
    console.error(`[research] ${leadId} JSON parse error: ${e.message}`);
    return { lead, error: `parse: ${e.message}`, output };
  }

  // Persist into leads.research_summary + write artifact
  const summary = `[${new Date().toISOString().slice(0, 10)} gpt-5.4] icp=${parsed.icp_fit} format=${parsed.outreach_format}\n${parsed.summary}\n\nAngle: ${parsed.outreach_angle}\n\nFacts: ${(parsed.verified_facts || []).join("; ")}\n\nRed flags: ${(parsed.red_flags || []).join("; ") || "none"}`;
  db.prepare(`UPDATE leads SET research_summary=?, updated_at=? WHERE id=?`).run(summary.slice(0, 4000), new Date().toISOString(), leadId);
  writeFileSync(resolve(RESEARCH_DIR, `result-${leadId}.json`), JSON.stringify(parsed, null, 2));

  console.log(`[research] ${leadId} → icp=${parsed.icp_fit} format=${parsed.outreach_format} (${elapsed}s)`);
  return { lead, parsed, elapsed };
}

const arg = process.argv[2];
if (!arg) { console.error("usage: research-bot-v2.mjs <lead_id|--batch>"); process.exit(1); }

if (arg === "--batch") {
  // Apr 8 2026 fix: removed source filter that excluded hn-show-hn-scout, fresh-pain-scout, etc.
  const leads = db.prepare(`SELECT id FROM leads WHERE stage='new' AND research_summary IS NULL LIMIT 10`).all();
  console.log(`[research] batch: ${leads.length} leads`);
  for (const l of leads) {
    await researchOne(l.id);
    await new Promise(r => setTimeout(r, 2000));
  }
} else {
  const r = await researchOne(arg);
  if (r && r.parsed) {
    const p = r.parsed;
    await tg(`<b>🔬 Research: ${r.lead.name}</b>

<b>ICP fit:</b> ${p.icp_fit} - ${p.icp_reasoning}
<b>Outreach format:</b> ${p.outreach_format}
<b>Angle:</b> ${p.outreach_angle}

<b>Summary:</b>
<i>${p.summary}</i>

<b>Verified:</b> ${(p.verified_facts || []).slice(0, 5).join("; ") || "(none)"}
${p.red_flags?.length ? `<b>⚠️ Red flags:</b> ${p.red_flags.join("; ")}` : ""}

<b>Notes:</b> <i>${p.investigation_notes}</i>

Model: gpt-5.4  •  Time: ${r.elapsed}s`);
  } else if (r) {
    await tg(`<b>⚠️ Research FAILED: ${r.lead.name}</b>\n\n${r.error}`);
  }
}

db.close();
