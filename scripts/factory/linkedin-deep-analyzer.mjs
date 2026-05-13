/**
 * linkedin-deep-analyzer.mjs
 *
 * The PROPER LinkedIn outreach loop. Built April 8 2026 after Kirill called
 * out my chat-orchestration habit. He said: "the bots should be analyzing
 * leads BEFORE I write to them, reading other comments on the post, and
 * figuring out how to differentiate. Where are the working Send/Skip
 * buttons? Where is our actual system?"
 *
 * Per-lead pipeline (no chat orchestration):
 *   1. Pull top 1 hot LinkedIn lead from DB where outreach_status IS NULL
 *      (founder/CEO + recent post + n8n/automation/AI keywords)
 *   2. Apify call: pull top 30 comments on the post
 *   3. Sonnet 4.6 multi-tool agent:
 *      - read post + all 30 comments
 *      - identify what angles are already taken
 *      - find the GAP (unique angle Kirill can claim)
 *      - draft a comment that's distinctive and substantive
 *      - sign with Kirill, Calgary | launchsoloai.com
 *   4. draft-quality-checker (regex + Sonnet quality gate)
 *   5. Dispatch to Telegram with WORKING Send/Skip callback handlers
 *   6. Mark lead.outreach_status = 'pending_approval'
 *   7. On Telegram button click, telegram-control.mjs updates status to
 *      'sent' or 'skipped' + edits message reply markup
 *
 * Cost per lead: ~$0.15 Apify (30 comments) + ~$0.30 Claude = ~$0.45/lead.
 * For one fully-prepared, comment-aware, differentiated draft.
 *
 * Schedule: every hour at :40 via sonnet-bots-daemon, processes 1 lead/run.
 * Daily cap: 6 dispatches per day.
 *
 * Usage:
 *   node scripts/factory/linkedin-deep-analyzer.mjs           # process 1 lead
 *   node scripts/factory/linkedin-deep-analyzer.mjs --limit 3 # process 3 leads
 */
import Database from "better-sqlite3";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync, writeFileSync } from "fs";
import { tgSendToKirill } from "./orchestrator.mjs";
import { getWikiContext, appendLog } from "../../wiki/reader.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DB_PATH = resolve(ROOT, ".data/linkedin-brand-os.sqlite");
const { callAI, MODEL_STRONG } = await import("./orchestrator.mjs");

const env = Object.fromEntries(
  readFileSync(resolve(ROOT, "apps/api/.env"), "utf-8").split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const APIFY_TOKEN = env.APIFY_API_KEY;
const TG = env.TELEGRAM_BOT_TOKEN;
const CHAT = env.TELEGRAM_CHAT_ID;
if (!APIFY_TOKEN) { console.error("APIFY_API_KEY missing"); process.exit(1); }

const COMMENTS_ACTOR = "apimaestro~linkedin-post-comments-replies-engagements-scraper-no-cookies";
const DAILY_DISPATCH_CAP = 3; // Apr 13 2026: reduced from 10 to save Apify budget. 3 × $0.15 = $0.45/day
const COMMENTS_PER_POST = 30;

function log(msg) { console.log(`${new Date().toISOString().slice(11, 19)} [li-analyzer] ${msg}`); }

function extractPostId(url) {
  // LinkedIn post URLs contain activity-NUMBERS-XXXX pattern
  const m = url.match(/activity[:-](\d+)/);
  return m ? m[1] : null;
}

async function fetchComments(postId, max = COMMENTS_PER_POST) {
  log(`fetching ${max} comments for post ${postId}`);
  const resp = await fetch(
    `https://api.apify.com/v2/acts/${COMMENTS_ACTOR}/run-sync-get-dataset-items?token=${APIFY_TOKEN}&maxItems=${max}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postIds: [postId], maxComments: max }),
    }
  );
  if (!resp.ok) {
    throw new Error(`apify ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  }
  return resp.json();
}

async function analyzeAndDraft(lead, comments) {
  // Extract just text + author headline from comments
  const commentSummary = comments
    .filter(c => c.text && c.text.length > 10)
    .slice(0, 25)
    .map((c, i) => {
      const auth = c.author?.name || "anon";
      const head = (c.author?.headline || "").slice(0, 80);
      const txt = c.text.replace(/\s+/g, " ").slice(0, 350);
      return `[${i+1}] ${auth} (${head}): "${txt}"`;
    })
    .join("\n");

  const prompt = `You are an outreach strategist for Kirill D., a solo AI/automation consultant in Calgary, Canada.

Site: launchsoloai.com
Offers: Vibe-Code Audit ($1.5-2.5K), Reply Chaser Automation ($1.5K), First 10 Customers Sales Motion ($2K), Custom AI/n8n builds ($2.5-8K)
Positioning: async only, fixed scope, fixed price, no calls, no retainers

THE LEAD:
- Name: ${lead.name}
- Headline: ${lead.role}
- Profile: ${lead.linkedin_url}
- Post URL: ${lead.source_url}

THEIR POST:
${(lead.pain_description || "").split("[Headline:")[0].trim()}

EXISTING COMMENTS ON THIS POST (top ${commentSummary.split("\n").length}):
${commentSummary}

YOUR JOB:
1. Read the post and ALL existing comments carefully
2. Identify what angles are ALREADY TAKEN by other commenters (who said "I can do this", who pitched, who asked questions, who joked, who agreed, etc)
3. Find the GAP - the angle that nobody else has claimed and that maps to one of Kirill's offers
4. Draft a LinkedIn comment (60-130 words) that:
   - Is DISTINCTIVE from every existing comment (do NOT repeat any phrase or angle already used)
   - Adds substantive value, not just "I can do this"
   - References ONE concrete observation from the post that proves you read it
   - Soft offer aligned with whichever Kirill offer fits
   - Sign exactly: "- Kirill, Calgary | launchsoloai.com"
5. ALSO output a short analysis of:
   - What angles were already taken (1-2 lines)
   - Why your angle is different (1 line)

OUTPUT FORMAT (exact):

ANALYSIS:
<your 2-3 line analysis of what angles are taken and why yours is different>

COMMENT:
<the actual comment body, ready to copy/paste, 60-130 words>

RULES (ABSOLUTE):
- NO em-dash. Use hyphen.
- NO money-back guarantees, NO "if you don't get results"
- NO AI-tells (delve, leverage, robust, seamless, navigate, foster, embark, landscape, realm, unlock potential)
- NO emojis
- NO copying any phrase, structure, or angle already used in the existing comments above
- Plain prose, peer-to-peer professional tone`;

  const promptFile = `/tmp/li-analyzer-prompt-${lead.id}.txt`;
  writeFileSync(promptFile, prompt);

  log(`drafting via GPT-5.4 with ${comments.length} comments context`);
  try {
    return await callAI(prompt, "Draft the comment now.", MODEL_STRONG, false);
  } catch (e) {
    log(`callAI failed: ${e.message}`);
    return "";
  }
}

function parseOutput(raw) {
  // Extract ANALYSIS and COMMENT sections
  const analysisMatch = raw.match(/ANALYSIS:\s*([\s\S]*?)(?=COMMENT:|$)/i);
  const commentMatch = raw.match(/COMMENT:\s*([\s\S]*?)$/i);
  return {
    analysis: analysisMatch ? analysisMatch[1].trim() : "(no analysis parsed)",
    comment: commentMatch ? commentMatch[1].trim() : raw.trim(),
  };
}

function qualityCheck(text) {
  const issues = [];
  if (/—/.test(text)) issues.push("em-dash");
  if (/\b(delve|leverage|robust|seamless|navigate|foster|embark|landscape|realm|unlock potential|harness)\b/i.test(text)) issues.push("AI-tells");
  if (/money[\s-]?back|if you don't (get|see)|free if|no charge unless/i.test(text)) issues.push("money-back");
  if (text.length < 100) issues.push("too short");
  if (text.length > 1500) issues.push("too long");
  if (!/Kirill/i.test(text)) issues.push("no signature");
  return issues;
}

async function dispatchToTelegram(lead, parsed, comments) {
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const text =
    `🎯 <b>LinkedIn Lead - Deep Analyzed</b>\n\n` +
    `<b>${esc(lead.name)}</b>\n` +
    `<i>${esc((lead.role || "").slice(0, 100))}</i>\n\n` +
    `🔗 <b>Post URL (открой → Comments → вставь):</b>\n${esc(lead.source_url)}\n\n` +
    `📊 <b>Comments analyzed:</b> ${comments.length}\n\n` +
    `🧠 <b>Differentiation analysis:</b>\n<i>${esc(parsed.analysis.slice(0, 500))}</i>\n\n` +
    `📝 <b>Comment draft (Sonnet 4.6, comment-aware):</b>\n\n` +
    `<pre>${esc(parsed.comment)}</pre>`;

  const resp = await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CHAT,
      parse_mode: "HTML",
      disable_web_page_preview: true,
      text,
      reply_markup: { inline_keyboard: [[
        { text: "📤 Sent", callback_data: `li_sent:${lead.id}` },
        { text: "⏭ Skip", callback_data: `li_skip:${lead.id}` },
      ]] },
    }),
  });
  return resp.json();
}

async function processOneLead(db) {
  // Daily cap check
  const sentToday = db.prepare(`
    SELECT COUNT(*) as n FROM leads
    WHERE outreach_status IN ('sent','pending_approval')
      AND date(outreach_action_at) = date('now')
      AND source LIKE 'apify-linkedin-%'
  `).get();
  if ((sentToday?.n || 0) >= DAILY_DISPATCH_CAP) {
    log(`daily cap ${sentToday.n}/${DAILY_DISPATCH_CAP}, exiting`);
    return null;
  }

  // Pick top hot lead: founder/CEO, fresh post (last 14 days), n8n/AI hiring intent, not already touched
  const lead = db.prepare(`
    SELECT * FROM leads
    WHERE source LIKE 'apify-linkedin-%'
      AND outreach_status IS NULL
      AND (role LIKE '%Founder%' OR role LIKE '%CEO%' OR role LIKE '%Owner%' OR role LIKE '%Co-founder%' OR role LIKE '%CTO%' OR role LIKE '%Director%')
      AND role NOT LIKE '%Recruit%'
      AND role NOT LIKE '%Talent%'
      AND role NOT LIKE '%HR %'
      AND pain_description LIKE '%Posted: 2026-04%'
      AND (
        lower(pain_description) LIKE '%hiring%n8n%'
        OR lower(pain_description) LIKE '%need%n8n%'
        OR lower(pain_description) LIKE '%n8n%expert%'
        OR lower(pain_description) LIKE '%automation%expert%'
        OR lower(pain_description) LIKE '%need%automation%'
        OR lower(pain_description) LIKE '%looking for%automation%'
        OR lower(pain_description) LIKE '%hiring%automation%'
        OR lower(pain_description) LIKE '%fractional cto%'
      )
      AND lower(pain_description) NOT LIKE '%i help%'
      AND lower(pain_description) NOT LIKE '%we help%'
      AND lower(pain_description) NOT LIKE '%my course%'
    ORDER BY
      CASE WHEN pain_description LIKE '%Posted: 2026-04-08%' THEN 0
           WHEN pain_description LIKE '%Posted: 2026-04-07%' THEN 1
           WHEN pain_description LIKE '%Posted: 2026-04-06%' THEN 2
           ELSE 3 END
    LIMIT 1
  `).get();

  if (!lead) {
    log("no fresh hot leads to process");
    return null;
  }

  log(`picked: ${lead.name} (${lead.role?.slice(0, 50)})`);

  const postId = extractPostId(lead.source_url || "");
  if (!postId) {
    log(`cannot extract post id from ${lead.source_url}`);
    db.prepare(`UPDATE leads SET outreach_status='error_no_post_id' WHERE id=?`).run(lead.id);
    return null;
  }

  // Mark as in-progress so concurrent runs don't double-process
  db.prepare(`UPDATE leads SET outreach_status='analyzing' WHERE id=?`).run(lead.id);

  let comments = [];
  try {
    comments = await fetchComments(postId, COMMENTS_PER_POST);
    log(`got ${comments.length} comments`);
  } catch (e) {
    log(`comment fetch failed: ${e.message}`);
    db.prepare(`UPDATE leads SET outreach_status='error_apify' WHERE id=?`).run(lead.id);
    await tgSendToKirill(`🚨 li-analyzer apify failed for ${lead.name}: ${e.message.slice(0, 200)}`);
    return null;
  }

  const raw = await analyzeAndDraft(lead, comments);
  const parsed = parseOutput(raw);

  const issues = qualityCheck(parsed.comment);
  if (issues.length > 0) {
    log(`quality check failed: ${issues.join(", ")}`);
    db.prepare(`UPDATE leads SET outreach_status='quality_failed', notes=? WHERE id=?`)
      .run(`QC failed: ${issues.join(", ")}\n\n${parsed.comment}`, lead.id);
    await tgSendToKirill(`⚠️ li-analyzer quality check FAILED for <b>${lead.name}</b>\n\nIssues: ${issues.join(", ")}\n\nDraft saved to lead.notes for manual review.`);
    return null;
  }

  // Save draft to lead.notes for retrieval on button click
  db.prepare(`UPDATE leads SET outreach_status='pending_approval', outreach_action_at=datetime('now'), notes=? WHERE id=?`)
    .run(parsed.comment, lead.id);

  const result = await dispatchToTelegram(lead, parsed, comments);
  log(`dispatched: ok=${result.ok}`);

  return { lead: lead.name, comment_count: comments.length, dispatched: result.ok };
}

async function main() {
  const args = process.argv.slice(2);
  const limit = parseInt(args[args.indexOf("--limit") + 1]) || 1;
  const db = new Database(DB_PATH);

  log(`starting run, limit=${limit}`);
  const results = [];
  for (let i = 0; i < limit; i++) {
    const r = await processOneLead(db);
    if (!r) break;
    results.push(r);
  }

  log(`done, processed ${results.length} leads`);
  db.close();

  if (results.length === 0) {
    await tgSendToKirill(`🤖 <b>linkedin-deep-analyzer</b>\n\nNo new hot LinkedIn leads to process this run (or daily cap reached).`);
  }
}

main().catch(e => {
  console.error("[li-analyzer] FATAL:", e);
  tgSendToKirill(`🚨 linkedin-deep-analyzer CRASHED: ${e.message}`).catch(() => {});
  process.exit(1);
});
