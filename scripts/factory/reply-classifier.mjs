/**
 * reply-classifier.mjs
 *
 * Fourth multi-tool agent on Sonnet 4.6 subscription.
 *
 * Purpose: when a reply comes back (Reddit DM, email, LinkedIn DM), classify
 * what kind of response it is and what should happen next. Replaces Kirill's
 * eyes for the routine cases.
 *
 * Categories:
 *   - hot_interest: explicit yes/let's talk/how much/when can we start
 *   - soft_interest: questions, curious, wants more info but no commitment
 *   - polite_no: declines politely, may circle back
 *   - hard_no: explicit no, do not contact, hostile
 *   - off_topic: replied but didn't engage with offer
 *   - spam: bot, irrelevant, scam attempt
 *   - need_more_context: cannot classify with available info
 *
 * Architecture: same pattern as other 3 bots. Subprocess Claude CLI.
 * Tools: Read (to read past lead context), Bash (sqlite for history).
 *
 * Usage:
 *   echo '{"reply_text": "...", "lead_id": "vibe-int-top35", "channel": "reddit_dm"}' | node scripts/factory/reply-classifier.mjs -
 *   node scripts/factory/reply-classifier.mjs <path.json>
 */
import Database from "better-sqlite3";
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import { readPurpose, appendLog } from "../../wiki/reader.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DB_PATH = resolve(ROOT, ".data/linkedin-brand-os.sqlite");
const CLASSIFY_DIR = resolve(ROOT, ".data/reply-classify");
if (!existsSync(CLASSIFY_DIR)) mkdirSync(CLASSIFY_DIR, { recursive: true });

const env = Object.fromEntries(
  readFileSync(resolve(ROOT, "apps/api/.env"), "utf-8").split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const TG = env.TELEGRAM_BOT_TOKEN, CHAT = env.TELEGRAM_CHAT_ID;
const { callAI, MODEL_STRONG } = await import("./orchestrator.mjs");

const db = new Database(DB_PATH);

async function tg(text, reply_markup) {
  if (!TG || !CHAT) return null;
  const body = { chat_id: CHAT, text, parse_mode: "HTML", disable_web_page_preview: true };
  if (reply_markup) body.reply_markup = reply_markup;
  return (await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  })).json();
}

function buildPrompt(input, lead, enrichment, research) {
  return `<role>You are the Reply Classifier for Kirill's outreach pipeline. A prospect has replied to one of his messages. Classify the reply and recommend the next move.</role>

<context>
Channel: ${input.channel}
Lead: ${lead?.name || "(unknown)"}
Lead source: ${lead?.source_platform || "(unknown)"}
Lead pain (initial): ${(lead?.pain_description || "").slice(0, 400)}
Original outreach angle (from research): ${research?.outreach_angle || "(no research)"}
Enrichment classification (pre-reply): ${enrichment?.classification || "(none)"} / ${enrichment?.confidence || ""}
Lead notes: ${(lead?.notes || "").slice(0, 300)}
Research summary: ${(lead?.research_summary || "").slice(0, 600)}
</context>

<reply_text>
${input.reply_text}
</reply_text>

<your_tools>
You have Bash and Read available.

Optional investigation if reply is ambiguous:
1. Look at past leads with similar reply patterns:
   sqlite3 ${DB_PATH} "SELECT id, name, stage, notes FROM leads WHERE notes LIKE '%reply%' AND stage IN ('replied','qualified','disqualified') LIMIT 5;"
2. Check the lead's full row for any signals you missed:
   sqlite3 ${DB_PATH} "SELECT * FROM leads WHERE id='${input.lead_id}';"

Maximum 3 tool calls. Most replies do not need any.
</your_tools>

<output_format>
End with EXACTLY this JSON block on its own lines:

REPLY_CLASSIFICATION:
{
  "classification": "hot_interest" | "soft_interest" | "polite_no" | "hard_no" | "off_topic" | "spam" | "need_more_context",
  "confidence": "high" | "medium" | "low",
  "sentiment": "positive" | "neutral" | "negative" | "hostile",
  "buying_signals": ["specific phrases that indicate intent"],
  "objections_or_concerns": ["if any"],
  "recommended_next_action": "draft_reply" | "send_offer" | "ask_question" | "wait" | "disqualify" | "kirill_handles",
  "next_message_angle": "one specific sentence on what the next message should accomplish (or 'N/A' if waiting/disqualifying)",
  "stage_update": "replied" | "qualified" | "negotiating" | "disqualified" | "no_change",
  "reasoning": "2-3 sentences on why this classification, what tells you saw in the reply"
}
</output_format>

<rules>
- Use only short hyphens, never em dashes
- Be honest about ambiguity. need_more_context is a valid answer when reply is too short or unclear
- "Sounds interesting tell me more" is soft_interest, NOT hot_interest. Hot requires explicit commitment language ("yes", "let's go", "send the contract", "how much", "when can you start")
- A reply that starts with a question (not commitment) is soft_interest at best
- Polite no often looks like "thanks but not right now / we already have someone / let me think about it"
- If reply is from a peer/consultant complimenting Kirill's work, that is off_topic for sales, possibly recommended_next_action='kirill_handles' for collab
- If reply mentions money/budget/timeline/scope - hot_interest with high confidence
</rules>

Begin classification.`;
}

async function classify(input) {
  if (!input.reply_text) throw new Error("reply_text required");
  if (!input.channel) throw new Error("channel required");

  const lead = input.lead_id ? db.prepare(`SELECT * FROM leads WHERE id=?`).get(input.lead_id) : null;
  const enrichment = input.lead_id ? db.prepare(`SELECT * FROM lead_enrichment WHERE lead_id=?`).get(input.lead_id) : null;
  let research = null;
  try {
    const rPath = resolve(ROOT, `.data/research-v2/result-${input.lead_id}.json`);
    if (existsSync(rPath)) research = JSON.parse(readFileSync(rPath, "utf-8"));
  } catch {}

  const prompt = buildPrompt(input, lead, enrichment, research);
  const id = randomUUID().slice(0, 8);
  const promptFile = resolve(CLASSIFY_DIR, `prompt-${id}.txt`);
  writeFileSync(promptFile, prompt);

  const startedAt = Date.now();
  let output;
  try {
    // Apr 23 2026: upgraded back to MODEL_STRONG — classification quality matters for pipeline.
    output = await callAI(prompt, "Begin classification.", MODEL_STRONG, false);
  } catch (e) {
    writeFileSync(resolve(CLASSIFY_DIR, `output-${id}.txt`), `ERROR: ${e.message}`);
    return { error: e.message, raw: "" };
  }
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  writeFileSync(resolve(CLASSIFY_DIR, `output-${id}.txt`), output);

  // Tolerate markdown code fence wrapping
  const m = output.match(/REPLY_CLASSIFICATION:\s*(?:```(?:json)?\s*)?(\{[\s\S]*?\n\})\s*(?:```)?/);
  if (!m) return { error: "no JSON parsed", raw: output.slice(0, 2000) };
  try {
    const parsed = JSON.parse(m[1]);
    return { ...parsed, elapsed, lead, model: "gpt-5.4" };
  } catch (e) {
    return { error: `parse: ${e.message}`, raw: m[1] };
  }
}

const arg = process.argv[2];
if (!arg) { console.error("usage: reply-classifier.mjs <path.json|->"); process.exit(2); }
const raw = arg === "-" ? readFileSync(0, "utf-8") : readFileSync(arg, "utf-8");
const input = JSON.parse(raw);

const result = await classify(input);
console.log(JSON.stringify(result, null, 2));

// Also send to Telegram so Kirill sees the classification immediately
if (!result.error) {
  const emoji = { hot_interest: "🔥", soft_interest: "👀", polite_no: "🙅", hard_no: "❌", off_topic: "🤷", spam: "🗑", need_more_context: "❓" }[result.classification] || "•";
  await tg(`<b>${emoji} Reply classified: ${input.channel}</b>
${result.lead ? `Lead: ${result.lead.name}` : ""}

<b>${result.classification}</b> (${result.confidence}, ${result.sentiment})
<b>Stage update:</b> ${result.stage_update}
<b>Next action:</b> ${result.recommended_next_action}
<b>Angle:</b> ${result.next_message_angle}

<b>Reasoning:</b>
<i>${result.reasoning}</i>

${result.buying_signals?.length ? `<b>Buying signals:</b> ${result.buying_signals.join("; ")}\n` : ""}${result.objections_or_concerns?.length ? `<b>Concerns:</b> ${result.objections_or_concerns.join("; ")}\n` : ""}
Time: ${result.elapsed}s`);

  // Auto-update lead.stage if classifier is high confidence and stage_update is set
  if (input.lead_id && result.confidence === "high" && result.stage_update !== "no_change") {
    db.prepare(`UPDATE leads SET stage=?, updated_at=? WHERE id=?`).run(result.stage_update, new Date().toISOString(), input.lead_id);
    console.log(`[reply-classifier] auto-updated ${input.lead_id} → stage=${result.stage_update}`);
  }
}
db.close();
process.exit(result.error ? 2 : 0);
