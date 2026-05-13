/**
 * content-curator-bot.mjs
 *
 * Sixth multi-tool agent on Sonnet 4.6 subscription. Built April 7 2026.
 *
 * Single purpose: read REAL system data (leads, awareness_items, lead_enrichment),
 * find one signal worth writing about, draft a single insights post in the locked
 * format, save to drafts/, push Telegram with approve/reject buttons.
 *
 * Strict rules locked into prompt:
 *   - Audience: service-business owners/operators ONLY (not SaaS founders, not devs)
 *   - Format: observed pattern → why it matters → what usually breaks → one practical takeaway → CTA
 *   - Source: ONLY real data from system tables, no generic AI advice, no "what is AI" content
 *   - Output: single Markdown file in sandbox-review/site/insights/drafts/
 *   - Manual approve only, never auto-publishes
 *
 * Run:
 *   node scripts/factory/content-curator-bot.mjs
 */
import Database from "better-sqlite3";
import { writeFileSync, readFileSync, mkdirSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import { getWikiContext, appendLog } from "../../wiki/reader.mjs";

// Wiki context for content creation
const WIKI_CTX = getWikiContext(["content/learned-content-style.md", "content/voice-guide.md", "content/what-resonates.md"]);

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DB_PATH = resolve(ROOT, ".data/linkedin-brand-os.sqlite");
const DRAFTS_DIR = resolve(ROOT, "sandbox-review/site/insights/drafts");
const CURATOR_DIR = resolve(ROOT, ".data/content-curator");
if (!existsSync(DRAFTS_DIR)) mkdirSync(DRAFTS_DIR, { recursive: true });
if (!existsSync(CURATOR_DIR)) mkdirSync(CURATOR_DIR, { recursive: true });

const env = Object.fromEntries(
  readFileSync(resolve(ROOT, "apps/api/.env"), "utf-8").split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const TG = env.TELEGRAM_BOT_TOKEN, CHAT = env.TELEGRAM_CHAT_ID;
const { callAI, MODEL_STRONG } = await import("./orchestrator.mjs");

const db = new Database(DB_PATH, { readonly: true });

async function tg(text, reply_markup) {
  if (!TG || !CHAT) return null;
  const body = { chat_id: CHAT, text, parse_mode: "HTML", disable_web_page_preview: true };
  if (reply_markup) body.reply_markup = reply_markup;
  return (await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  })).json();
}

function gatherSignal() {
  // Service-business focused subs only
  const SERVICE_SUBS = ["reddit_r_smallbusiness", "reddit_r_Bookkeeping", "reddit_r_Construction", "reddit_r_PropertyManagement", "reddit_r_CleaningTips", "reddit_r_msp", "reddit_r_consulting", "reddit_r_realestateinvesting"];
  const placeholders = SERVICE_SUBS.map(() => "?").join(",");
  const recent = db.prepare(`
    SELECT name, source_platform, source_url, score, pain_description
    FROM leads
    WHERE source_platform IN (${placeholders})
      AND created_at > datetime('now','-7 days')
      AND length(pain_description) > 80
    ORDER BY score DESC, created_at DESC
    LIMIT 25
  `).all(...SERVICE_SUBS);

  const recentEnriched = db.prepare(`
    SELECT l.name, l.source_platform, le.classification, le.reasoning
    FROM lead_enrichment le
    JOIN leads l ON l.id = le.lead_id
    WHERE le.enriched_at > datetime('now','-7 days')
    LIMIT 10
  `).all();

  return { recent, recentEnriched };
}

function buildPrompt(signal) {
  return `<role>You are the Content Curator for Kirill's launchsoloai.com. Your single job: read recent SIGNALS from the system and produce ONE short insights post for service-business owners and operators. Not for SaaS founders. Not for developers. Not for AI beginners. Service-business operators - the people who run trades, cleaning, bookkeeping, property management, MSP, consulting, construction.</role>

<rules_locked>
1. Audience: service-business owners/operators ONLY
2. Format MUST be exactly:
   - Headline (one line, 6-12 words, specific)
   - Observed pattern (1-2 sentences, what is happening, grounded in real signal data below)
   - Why it matters (1-2 sentences, the cost or stakes for the operator)
   - What usually breaks (2-3 sentences, the technical/operational reason)
   - One practical takeaway (1-2 sentences, what to actually do, specific)
   - CTA (1 sentence, link to email)
3. Length: 350-500 words total. Not longer.
4. Voice: direct, operator-to-operator. No marketing language. No "leverage AI to". No "in today's fast-paced". No "moreover". No buzzwords.
5. Forbidden:
   - "AI can help you" generic statements
   - Em dashes (use short hyphens)
   - Money-back guarantees
   - Numbered lists (1. 2. 3.) - use prose
   - Polished CTAs ("feel free to reach out", "happy to chat")
   - Made-up statistics
6. Required:
   - Reference at least one real pain pattern from the signal data (do NOT name specific authors or URLs)
   - Use short hyphens only
   - End with EXACTLY: "If this is your situation, email me at kirill@launchsoloai.com with three things: what is breaking, what you have already tried, what your stack looks like. I respond within 24 hours with a fixed price or a straight no. You can also see [my productized offers and pricing here](https://launchsoloai.com/#offers)."
</rules_locked>

<signal_data>
Recent service-business pain posts (anonymized via patterns):
${JSON.stringify(signal.recent.map(r => ({
  sub: r.source_platform.replace(/^reddit_r_/, ""),
  score: r.score,
  pain_excerpt: (r.pain_description || "").slice(0, 300),
})), null, 2)}

Recent enriched lead classifications:
${JSON.stringify(signal.recentEnriched, null, 2)}
</signal_data>

<your_task>
1. Read the signal data carefully. Find ONE pattern that shows up in 2+ posts. Not "I read about cleaning businesses" - an actual recurring shape.
2. Draft ONE post in the locked format above.
3. The headline should make a service-biz operator stop scrolling. Specific. Concrete.
4. Output the post as Markdown with this exact structure:

---
title: <headline>
slug: <kebab-case-slug>
date: 2026-04-07
audience: service-business-operators
source_signal: <2-3 word description of the pattern>
---

# <headline>

<observed pattern paragraph>

## Why it matters

<why it matters paragraph>

## What usually breaks

<what breaks paragraph>

## What to actually do

<takeaway paragraph>

---

If this is your situation, email me at kirill@launchsoloai.com with three things: what is breaking, what you have already tried, what your stack looks like. I respond within 24 hours with a fixed price or a straight no.

Then OUTSIDE the markdown, after a clear "BOT_NOTES:" line, give me:
- Which signals from the data informed this post (2-3 line summary)
- Confidence (high/medium/low) that this post is grounded vs invented
- One thing you would change if you had more data
</your_task>

<rules>
- Use only short hyphens, never em dashes. Triple-check before output.
- No fabricated numbers.
- Maximum 2 tool calls (you should not need any - the data is in the prompt)
</rules>

Begin drafting now.`;
}

async function curate() {
  const signal = gatherSignal();
  console.log(`[curator] gathered ${signal.recent.length} recent leads, ${signal.recentEnriched.length} enriched`);

  if (signal.recent.length < 3) {
    await tg(`<b>📰 content-curator: not enough signal</b>\n\nOnly ${signal.recent.length} service-biz leads in last 7 days. Need at least 3 to find a pattern. Run again tomorrow after fresh-pain-scout adds more.`);
    return;
  }

  const prompt = buildPrompt(signal);
  const id = `draft-${new Date().toISOString().slice(0, 10)}-${Date.now().toString(36).slice(-5)}`;
  const promptFile = resolve(CURATOR_DIR, `prompt-${id}.txt`);
  writeFileSync(promptFile, prompt);

  const startedAt = Date.now();
  let output;
  try {
    output = await callAI(prompt, "Begin drafting now.", MODEL_STRONG, false);
  } catch (e) {
    output = "";
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    writeFileSync(resolve(CURATOR_DIR, `output-${id}.txt`), `ERROR: ${e.message}`);
    await tg(`<b>⚠️ content-curator FAILED (${elapsed}s)</b>\n\n${e.message}. See .data/content-curator/output-${id}.txt`);
    return;
  }
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  writeFileSync(resolve(CURATOR_DIR, `output-${id}.txt`), output);

  // Extract markdown post (between first --- block and BOT_NOTES)
  const mdMatch = output.match(/(---\s*\ntitle:[\s\S]*?)\n\n?BOT_NOTES:/);
  if (!mdMatch) {
    await tg(`<b>⚠️ content-curator: no markdown parsed</b>\n\nOutput in .data/content-curator/output-${id}.txt`);
    return;
  }
  // Force-strip em/en dashes that may slip through despite prompt rules.
  // This is a safety net - the bot should not produce them, but we enforce.
  let markdown = mdMatch[1].trim().replace(/\u2014/g, " - ").replace(/\u2013/g, "-");
  const notesMatch = output.match(/BOT_NOTES:([\s\S]*)$/);
  const notes = notesMatch ? notesMatch[1].trim().slice(0, 600) : "(none)";

  // Extract slug from frontmatter
  const slugMatch = markdown.match(/^slug:\s*(.+)$/m);
  const slug = (slugMatch ? slugMatch[1].trim() : id).replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  const draftPath = resolve(DRAFTS_DIR, `${slug}.md`);
  writeFileSync(draftPath, markdown);
  console.log(`[curator] draft saved: ${draftPath}`);

  // Run quality check on the body text
  const bodyText = markdown.replace(/^---[\s\S]*?---/, "").trim().slice(0, 4000);
  let qualityVerdict = "skipped";
  try {
    const qc = spawnSync("node", [resolve(__dirname, "draft-quality-checker.mjs"), "-"], {
      input: JSON.stringify({ text: bodyText, context: "landing_page" }),
      encoding: "utf-8", timeout: 5 * 60 * 1000, cwd: ROOT,
    });
    if (qc.stdout) {
      const parsed = JSON.parse(qc.stdout);
      qualityVerdict = `${parsed.verdict}${parsed.violations?.length ? ` (${parsed.violations.length} issues)` : ""}`;
    }
  } catch {}

  // Telegram with approve/reject
  const headlineMatch = markdown.match(/^# (.+)$/m);
  const headline = headlineMatch ? headlineMatch[1] : "(no headline)";
  // Telegram has 4096 char message limit. Reserve ~800 for headers/notes/escaping.
  const preview = bodyText.slice(0, 3000);

  await tg(`<b>📝 New insights draft - awaiting approval</b>

<b>Headline:</b> ${headline}
<b>Slug:</b> ${slug}
<b>Quality check:</b> ${qualityVerdict}
<b>Time:</b> ${elapsed}s

<b>Preview:</b>
<pre>${preview.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>

<b>Bot notes:</b>
<i>${notes.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</i>

<i>File: sandbox-review/site/insights/drafts/${slug}.md</i>`, {
    inline_keyboard: [[
      { text: "✅ Approve & deploy", callback_data: `insight_approve:${slug}` },
      { text: "✏️ Edit first", callback_data: `insight_edit:${slug}` },
      { text: "❌ Reject", callback_data: `insight_reject:${slug}` },
    ]],
  });
  console.log(`[curator] telegram sent for ${slug}`);
}

await curate();
db.close();
