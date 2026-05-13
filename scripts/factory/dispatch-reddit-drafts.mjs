// GUARDRAIL GAP: dispatch-guardrails.isSegmentBlocked() must be called before any send. Verify this is wired before enabling production dispatch.

/**
 * dispatch-reddit-drafts.mjs
 *
 * Single point of entry for sending Reddit comment/DM drafts to Telegram.
 * ALL future dispatches MUST go through this script — never roll a new
 * /tmp/dispatch_X.mjs script. The whole point is one place to enforce safety.
 *
 * Built April 7 2026 after I dispatched 4 drafts past the daily cap because
 * I was rolling a new dispatch script each time and skipping the guard.
 *
 * What it does (in order):
 *   1. Reads draft batch from JSON file or stdin
 *   2. Filters via reddit-rate-guard (queries real Reddit user API)
 *   3. Auto-creates leads in DB for any drafts without an existing lead row
 *   4. Sends each allowed draft to Telegram with rcm_posted/rcm_skip buttons
 *   5. Reports a summary message with allowed/blocked counts and reasons
 *
 * Input JSON format (array of):
 *   {
 *     leadId: "vibe-momo-yeg" (optional - auto-created if missing),
 *     name: "u/Momo_Studio_yeg" (required),
 *     sub: "SaaS" (required for comment, optional for DM),
 *     kind: "comment" | "dm" (required),
 *     topic: "short topic line",
 *     url: "https://reddit.com/...",
 *     body: "full draft text",
 *     ageDays: 4 (optional, for display only),
 *   }
 *
 * Usage:
 *   node scripts/factory/dispatch-reddit-drafts.mjs <path-to-json>
 *   echo '[...]' | node scripts/factory/dispatch-reddit-drafts.mjs -
 */
import Database from "better-sqlite3";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import { filterDraftsBySafety } from "./reddit-rate-guard.mjs";
import { spawnSync } from "child_process";
import { readPurpose, appendLog } from "../../wiki/reader.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const db = new Database(resolve(ROOT, ".data/linkedin-brand-os.sqlite"));
const env = Object.fromEntries(
  readFileSync(resolve(ROOT, "apps/api/.env"), "utf-8").split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const TG = env.TELEGRAM_BOT_TOKEN, CHAT = env.TELEGRAM_CHAT_ID;
const NOW = () => new Date().toISOString();

async function tg(text, reply_markup) {
  const body = { chat_id: CHAT, text, parse_mode: "HTML", disable_web_page_preview: true };
  if (reply_markup) body.reply_markup = reply_markup;
  const r = await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return r.json();
}

// Auto-gate via lead-enrichment-bot. Returns enrichment row or null on failure.
// SKIP_ENRICHMENT=1 env var bypasses (for retries / known leads).
function enrichIfNeeded(leadId) {
  if (process.env.SKIP_ENRICHMENT === "1") { console.warn(`[dispatch] SKIP_ENRICHMENT=1 active - enrichment gate bypassed for ${leadId}`); return null; }
  const existing = db.prepare(`SELECT * FROM lead_enrichment WHERE lead_id=?`).get(leadId);
  if (existing) return existing;
  console.log(`[dispatch] enriching ${leadId}...`);
  const r = spawnSync("node", [resolve(__dirname, "lead-enrichment-bot.mjs"), leadId], {
    cwd: ROOT, encoding: "utf-8", timeout: 6 * 60 * 1000, stdio: "inherit",
  });
  if (r.status !== 0) {
    console.error(`[dispatch] enrichment failed for ${leadId}, routing to review pile`);
    return { _failed: true };
  }
  return db.prepare(`SELECT * FROM lead_enrichment WHERE lead_id=?`).get(leadId);
}

// Returns true if enrichment says the dispatch should NOT happen automatically.
// Drafts blocked by enrichment go to a "needs Kirill review" pile, not auto-skip.
function isBlockedByEnrichment(enrichment, kind) {
  if (!enrichment) return false;
  if (enrichment._failed) return true; // enrichment subprocess failed - unknown lead, needs review
  if (enrichment.recommended_action === "skip") return true;
  // For DMs, only ready_buyer / warming should auto-pass. peer/lurker/not_fit need review.
  if (kind === "dm" && !["ready_buyer", "warming"].includes(enrichment.classification)) return true;
  return false;
}

// Quality check via draft-quality-checker. Returns {verdict, violations, ...}.
// Fail open on bot error (don't block dispatch on quality bot crash).
function qualityCheckDraft(d) {
  if (process.env.SKIP_QUALITY_CHECK === "1") { console.warn(`[dispatch] SKIP_QUALITY_CHECK=1 active - quality gate bypassed for ${d.name}`); return null; }
  const ctx = d.kind === "dm" ? "linkedin_dm" : "reddit_comment";
  const input = JSON.stringify({ text: d.body, context: ctx });
  const r = spawnSync("node", [resolve(__dirname, "draft-quality-checker.mjs"), "-"], {
    cwd: ROOT, input, encoding: "utf-8", timeout: 5 * 60 * 1000,
  });
  if (r.status === 2 || !r.stdout) {
    console.error(`[dispatch] quality check ERROR for ${d.name}, routing to review pile`);
    return { verdict: "ERROR", violations: [] };
  }
  try { return JSON.parse(r.stdout); }
  catch (e) { console.error(`[dispatch] quality parse fail: ${e.message}`); return { verdict: "ERROR", violations: [] }; }
}

function ensureLead(d) {
  if (d.leadId) {
    const existing = db.prepare(`SELECT id FROM leads WHERE id=?`).get(d.leadId);
    if (existing) return d.leadId;
  }
  const id = d.leadId || `auto-${randomUUID().slice(0, 8)}`;
  db.prepare(`
    INSERT OR IGNORE INTO leads (id, name, source, source_platform, source_url, pain_description, score, stage, first_signal_at, created_at, updated_at, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?)
  `).run(
    id, d.name, `reddit_${d.kind || "comment"}`, `reddit_r_${d.sub || "unknown"}`,
    d.url || "", (d.topic || "").slice(0, 1000), 10, NOW(), NOW(), NOW(),
    `Auto-created by dispatch-reddit-drafts ${NOW()}`
  );
  return id;
}

async function main() {
  if (process.env.SKIP_ENRICHMENT === '1') console.warn('[SAFETY WARNING] SKIP_ENRICHMENT=1 is set - enrichment gate bypassed');
  if (process.env.SKIP_QUALITY_CHECK === '1') console.warn('[SAFETY WARNING] SKIP_QUALITY_CHECK=1 is set - quality gate bypassed');
  const arg = process.argv[2];
  if (!arg) { console.error("usage: dispatch-reddit-drafts.mjs <path.json|->"); process.exit(1); }
  let raw;
  if (arg === "-") {
    raw = readFileSync(0, "utf-8");
  } else {
    raw = readFileSync(arg, "utf-8");
  }
  const drafts = JSON.parse(raw);
  if (!Array.isArray(drafts)) { console.error("expected array"); process.exit(1); }

  console.log(`[dispatch] loaded ${drafts.length} drafts`);

  // Filter out comments targeting posts older than 18 hours.
  // Old posts get buried and comments look spammy. DMs are exempt.
  const MAX_POST_AGE_HOURS = 18;
  const before = drafts.length;
  const tooOld = [];
  for (let i = drafts.length - 1; i >= 0; i--) {
    const d = drafts[i];
    if (d.kind === "dm") continue; // DMs are not time-sensitive
    const ageHours = d.ageDays != null ? d.ageDays * 24 : (d.ageHours != null ? d.ageHours : null);
    if (ageHours != null && ageHours > MAX_POST_AGE_HOURS) {
      tooOld.push(d);
      drafts.splice(i, 1);
    }
  }
  if (tooOld.length) {
    console.log(`[dispatch] rejected ${tooOld.length} drafts — target post older than ${MAX_POST_AGE_HOURS}h: ${tooOld.map(d => d.name).join(", ")}`);
  }

  // DMs are not subject to comment-per-sub limit; only comments are filtered.
  // Both still count toward burst protection but DMs use a separate informal cap.
  const comments = drafts.filter(d => d.kind === "comment");
  const dms = drafts.filter(d => d.kind === "dm");

  const { allowed: allowedComments, blocked } = await filterDraftsBySafety(comments);
  console.log(`[dispatch] comments: ${allowedComments.length} allowed, ${blocked.length} blocked by rate guard`);
  console.log(`[dispatch] dms: ${dms.length} (not subject to comment cap)`);

  // Run enrichment + quality gates on every draft.
  const autoPass = [];
  const needsReview = [];
  for (const d of [...allowedComments, ...dms]) {
    const leadId = ensureLead(d);
    d._leadId = leadId;
    const enrichment = enrichIfNeeded(leadId);
    d._enrichment = enrichment;
    console.log(`[dispatch] quality-checking ${d.name}...`);
    const quality = qualityCheckDraft(d);
    d._quality = quality;
    const enrichmentBlocks = isBlockedByEnrichment(enrichment, d.kind);
    const qualityBlocks = quality && (quality.verdict === "FAIL" || quality.verdict === "ERROR");
    if (enrichmentBlocks || qualityBlocks) {
      needsReview.push(d);
    } else {
      autoPass.push(d);
    }
  }
  console.log(`[dispatch] gates: ${autoPass.length} auto-pass, ${needsReview.length} need review`);

  // Summary message
  let summary = `<b>📨 Dispatch batch — ${autoPass.length} ready, ${needsReview.length} need review</b>\n\n`;
  if (autoPass.length) summary += `✅ ${autoPass.length} auto-pass (rate guard + enrichment OK)\n`;
  if (needsReview.length) {
    summary += `\n<b>🤔 ${needsReview.length} need your review (enrichment flagged):</b>\n`;
    for (const r of needsReview) {
      const e = r._enrichment;
      summary += `• ${r.name}: ${e ? (e._failed ? "enrichment-failed" : `${e.classification}/${e.recommended_action}`) : "no enrichment"}\n`;
    }
  }
  if (blocked.length) {
    summary += `\n<b>⛔ ${blocked.length} comments BLOCKED by rate guard:</b>\n`;
    for (const b of blocked) summary += `• ${b.name}: ${b.reason}\n`;
  }
  await tg(summary);
  await new Promise(r => setTimeout(r, 1500));

  let n = 0;
  const total = autoPass.length + needsReview.length;
  for (const d of [...autoPass, ...needsReview]) {
    n++;
    const leadId = d._leadId;
    const e = d._enrichment;
    const q = d._quality;
    const enrichLine = (e && !e._failed)
      ? `\n<i>🧠 ${e.classification} / ${e.confidence} → ${e.recommended_action}</i>\n<i>${(e.reasoning || "").slice(0, 200)}</i>\n`
      : (e?._failed ? `\n<i>⚠️ enrichment failed - needs manual review</i>\n` : "");
    const qualityLine = q
      ? `<i>✏️ quality: ${q.verdict}${q.violations?.length ? ` (${q.violations.length} issues)` : ""}</i>\n${q.verdict === "FAIL" && q.violations?.length ? `<i>${q.violations.slice(0, 3).map(v => `· ${v.rule}: ${v.quote?.slice(0, 60)}`).join("\n")}</i>\n` : ""}`
      : "";
    const isReview = isBlockedByEnrichment(e, d.kind) || (q && (q.verdict === "FAIL" || q.verdict === "ERROR"));
    const reviewBadge = isReview ? " ⚠️ NEEDS REVIEW" : "";
    const isDm = d.kind === "dm";
    const ageStr = d.ageDays != null ? ` (${d.ageDays}d old)` : "";
    const linkLine = isDm
      ? `Send via: https://www.reddit.com/message/compose/?to=${d.name.replace(/^u\//, "")}`
      : d.url;
    const msg = `<b>${n}/${total} ${isDm ? "📬 DM" : "💬 Comment"} — ${d.name}${reviewBadge}</b>\n` +
      (d.sub ? `<i>r/${d.sub}${ageStr}</i>\n` : "") +
      (d.topic ? `${d.topic}\n` : "") +
      `${linkLine}\n` +
      enrichLine +
      qualityLine +
      `\n<b>${isDm ? "Body" : "Reply"}:</b>\n` +
      `<pre>${d.body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`;

    const cb_send = isDm ? `vc_dm_sent:${leadId}` : `rcm_posted:${leadId}`;
    const cb_skip = isDm ? `vc_dm_skip:${leadId}` : `rcm_skip:${leadId}`;
    const reply_markup = {
      inline_keyboard: [[
        { text: isDm ? "📤 Sent" : "✅ Posted", callback_data: cb_send },
        { text: "⏭ Skip", callback_data: cb_skip },
      ]],
    };
    const r = await tg(msg, reply_markup);
    console.log(`[dispatch] ${n}/${total} ${d.name}: ok=${r.ok}`);

    // Save draft to lead_interactions for tracking chain of communication
    // Apr 13 2026 fix: drafts were lost after Telegram dispatch, no history for strategy
    try {
      db.prepare(`
        INSERT INTO lead_interactions (id, lead_id, bot_id, channel, direction, content, ai_drafted, kirill_approved, outcome, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        `dispatch-${Date.now()}-${d.name}`,
        leadId,
        isDm ? 'icp-outreach-bot' : 'dispatch-reddit',
        isDm ? 'reddit_dm' : 'reddit_comment',
        'outbound',
        d.body,
        1, // ai_drafted = true
        0, // kirill_approved = pending (updated by telegram callback)
        'pending', // outcome updated when Kirill clicks Send/Skip
      );
    } catch (e) { console.error(`[dispatch] interaction save failed: ${e.message}`); }

    await new Promise(r => setTimeout(r, 1200));
  }
  db.close();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e); process.exit(1); });
}

export async function dispatchFromAwareness(items) {
  if (!TG || !CHAT) {
    console.error("[dispatch-awareness] No Telegram credentials");
    return;
  }
  console.log(`[dispatch-awareness] Sending ${items.length} pain signal drafts to Telegram`);
  for (const item of items) {
    const sub = item.sub || "reddit";
    const score = item.score || 0;
    const category = item.category || "pain_signal";
    const cbId = `aw-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const msg =
      `<b>[LIVE PAIN] Reply ready - approve?</b>\n` +
      `<i>r/${sub} | ${score}/20 | ${category}</i>\n\n` +
      `<b>${(item.title || "").slice(0, 120)}</b>\n` +
      `${item.url}\n\n` +
      (item.summary ? `<i>${item.summary.slice(0, 200)}</i>\n\n` : "") +
      `<b>Draft reply:</b>\n` +
      `<pre>${(item.body || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre>`;
    const reply_markup = {
      inline_keyboard: [[
        { text: "Post it", callback_data: `rcm_posted:${cbId}` },
        { text: "Skip", callback_data: `rcm_skip:${cbId}` },
      ]],
    };
    try {
      const r = await tg(msg.slice(0, 4096), reply_markup);
      console.log(`[dispatch-awareness] ok=${r.ok}`);
    } catch (e) {
      console.error(`[dispatch-awareness] tg send failed: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 1200));
  }
}
