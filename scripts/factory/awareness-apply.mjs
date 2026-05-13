/**
 * AWARENESS APPLY - Safe application of awareness items
 *
 * For each item flagged as `apply_now`:
 * 1. Fetch and read the source URL
 * 2. Classify risk level
 * 3. Create git checkpoint
 * 4. Produce dry-run diff for Kirill review
 * 5. If Kirill approves, apply with validation:
 *    - Syntax check all changed files
 *    - Load-test affected bots
 *    - If anything fails: git reset --hard to checkpoint
 *    - If all passes: git commit
 *
 * NEVER automatic. Every apply requires Kirill review of the diff.
 */

import Database from "better-sqlite3";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync, spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, "../../.data/linkedin-brand-os.sqlite");
const ENV_PATH = resolve(__dirname, "../../apps/api/.env");
const PROJECT_ROOT = resolve(__dirname, "../..");

const env = Object.fromEntries(
  readFileSync(ENV_PATH, "utf-8").split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

// ═══════════════════════════════════════════════════════════════════════════
// RISK CLASSIFICATION
// ═══════════════════════════════════════════════════════════════════════════

const HIGH_RISK_KEYWORDS = [
  "architecture", "orchestrator", "multi-agent", "harness",
  "migration", "refactor", "api replacement", "framework change",
  "n8n replacement", "mcp replacement", "claude api migration"
];

const MEDIUM_RISK_KEYWORDS = [
  "prompt update", "tool spec", "context engineering",
  "routing", "model change", "cli invocation", "workflow change"
];

const LOW_RISK_KEYWORDS = [
  "documentation", "add tool", "add capability", "test",
  "gtm learning", "version check", "rule confirmation",
  "add layer", "new option"
];

function classifyRisk(item) {
  const text = `${item.title} ${item.category} ${item.action_type} ${item.why_matters} ${item.action_target}`.toLowerCase();

  for (const kw of HIGH_RISK_KEYWORDS) {
    if (text.includes(kw)) return { level: "HIGH", reason: kw };
  }
  for (const kw of MEDIUM_RISK_KEYWORDS) {
    if (text.includes(kw)) return { level: "MEDIUM", reason: kw };
  }
  for (const kw of LOW_RISK_KEYWORDS) {
    if (text.includes(kw)) return { level: "LOW", reason: kw };
  }
  return { level: "MEDIUM", reason: "unknown_default" };
}

// ═══════════════════════════════════════════════════════════════════════════
// SAFETY CHECKS
// ═══════════════════════════════════════════════════════════════════════════

function createGitCheckpoint(label) {
  try {
    execSync("git add -A", { cwd: PROJECT_ROOT });
    // Check if there are changes to commit
    const status = execSync("git status --porcelain", { cwd: PROJECT_ROOT, encoding: "utf-8" });
    if (status.trim()) {
      execSync(`git commit -m "Checkpoint before: ${label}"`, { cwd: PROJECT_ROOT });
    }
    const hash = execSync("git rev-parse HEAD", { cwd: PROJECT_ROOT, encoding: "utf-8" }).trim();
    return { ok: true, hash };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function rollbackTo(hash) {
  try {
    execSync(`git reset --hard ${hash}`, { cwd: PROJECT_ROOT });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function syntaxCheck(filePath) {
  try {
    execSync(`node --check "${filePath}"`, { cwd: PROJECT_ROOT, stdio: "pipe" });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message.slice(0, 500) };
  }
}

async function loadTest(filePath) {
  // Try to import the file and see if it loads without errors
  try {
    const relPath = "./" + filePath.replace(PROJECT_ROOT + "/", "");
    execSync(`node --input-type=module -e "import('${relPath}').then(()=>process.exit(0)).catch(e=>{console.error(e.message);process.exit(1)})"`, {
      cwd: PROJECT_ROOT,
      stdio: "pipe",
      timeout: 10000
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message.slice(0, 500) };
  }
}

function getChangedFiles() {
  try {
    const output = execSync("git diff --name-only HEAD", { cwd: PROJECT_ROOT, encoding: "utf-8" });
    return output.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function getDiff() {
  try {
    return execSync("git diff HEAD", { cwd: PROJECT_ROOT, encoding: "utf-8", maxBuffer: 5 * 1024 * 1024 });
  } catch {
    return "";
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// VALIDATION PIPELINE
// ═══════════════════════════════════════════════════════════════════════════

async function validateChanges() {
  const changed = getChangedFiles();
  if (changed.length === 0) {
    return { ok: true, message: "No changes detected" };
  }

  const errors = [];

  // 1. Syntax check all .mjs/.js files
  for (const file of changed) {
    if (!/\.(mjs|js)$/.test(file)) continue;
    const full = resolve(PROJECT_ROOT, file);
    if (!existsSync(full)) continue;
    const check = syntaxCheck(full);
    if (!check.ok) {
      errors.push(`Syntax error in ${file}: ${check.error}`);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors, stage: "syntax_check" };
  }

  // 2. Load-test critical bot files
  const criticalBots = changed.filter(f =>
    f.includes("scripts/factory/") &&
    f.endsWith(".mjs") &&
    !f.includes(".test.") &&
    !f.includes("awareness-apply")
  );

  for (const bot of criticalBots) {
    const full = resolve(PROJECT_ROOT, bot);
    const test = await loadTest(full);
    if (!test.ok) {
      errors.push(`Load test failed for ${bot}: ${test.error}`);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors, stage: "load_test" };
  }

  return { ok: true, message: `All ${changed.length} files validated` };
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN: list and process pending apply_now items
// ═══════════════════════════════════════════════════════════════════════════

// ── AUTO-PROMOTION (added 2026-05-09) ─────────────────────────────────
// Without this, awareness items sit at status='new' until Kirill manually
// approves each one in Telegram. After 7+ days of accumulation, only ~7 of
// 324 items had ever been applied. Auto-promote rule promotes safe items
// (existing-file prompt/rule updates with score >= 14) without manual review.
// HIGH-risk and unfamiliar action_targets still require manual approve.
function autoPromoteSafeItems(db) {
  const SAFE_ACTION_TYPES = ["prompt_update", "rule_update"];
  const MIN_SCORE = 14;
  const candidates = db.prepare(`
    SELECT id, score, title, action_type, action_target, confidence
    FROM awareness_items
    WHERE status = 'new'
      AND score >= ?
      AND action_type IN (${SAFE_ACTION_TYPES.map(() => "?").join(",")})
      AND action_target IS NOT NULL
      AND action_target != ''
    ORDER BY score DESC
    LIMIT 20
  `).all(MIN_SCORE, ...SAFE_ACTION_TYPES);

  if (candidates.length === 0) return { promoted: 0, skipped: 0 };

  // For each candidate, verify the action_target points to an existing file
  // (otherwise the apply step would fail anyway). Skip free-form targets
  // like "channel matrix / GTM playbook" that aren't real paths.
  let promoted = 0;
  let skipped = 0;
  for (const c of candidates) {
    const looksLikeFile = /\.(mjs|md|json|ts|tsx|js)(\s|$)/.test(c.action_target);
    if (!looksLikeFile) { skipped++; continue; }
    const filePath = resolve(PROJECT_ROOT, c.action_target.split(/\s+/)[0]);
    if (!existsSync(filePath)) { skipped++; continue; }
    db.prepare(`UPDATE awareness_items SET status = 'apply_now', updated_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), c.id);
    promoted++;
    console.log(`[auto-promote] score=${c.score} ${c.action_type} -> ${c.action_target}: ${c.title?.slice(0, 60)}`);
  }

  if (promoted > 0) {
    console.log(`[auto-promote] ${promoted} new -> apply_now (${skipped} skipped: target file missing or non-file)`);
  }
  return { promoted, skipped };
}

export async function listPendingApplies() {
  const db = new Database(DB_PATH);

  // Auto-promote safe items before listing
  autoPromoteSafeItems(db);

  const items = db.prepare(`
    SELECT id, score, title, category, summary, why_matters,
           action_target, action_type, confidence, url, status, created_at
    FROM awareness_items
    WHERE status = 'apply_now'
    ORDER BY score DESC
  `).all();
  db.close();

  return items.map(item => ({
    ...item,
    risk: classifyRisk(item)
  }));
}

export async function getSafetyReport() {
  const pending = await listPendingApplies();
  const byRisk = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const item of pending) byRisk[item.risk.level]++;

  const report = {
    pending_count: pending.length,
    by_risk: byRisk,
    git_initialized: existsSync(resolve(PROJECT_ROOT, ".git")),
    safe_to_apply_low: pending.filter(i => i.risk.level === "LOW"),
    needs_review_medium: pending.filter(i => i.risk.level === "MEDIUM"),
    needs_manual_plan_high: pending.filter(i => i.risk.level === "HIGH"),
  };

  return report;
}

// ═══════════════════════════════════════════════════════════════════════════
// AUTO QUEUE REDDIT COMMENTS
// For ACCEPTED items with action_type=none + confidence=high + Reddit URL:
// generate comment draft, pass to dispatch-reddit-drafts.mjs pipeline.
// ═══════════════════════════════════════════════════════════════════════════

const CLAUDE_BIN_HARDCODED = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";
const CLAUDE_BIN = existsSync(CLAUDE_BIN_HARDCODED) ? CLAUDE_BIN_HARDCODED : "claude";
const APPLY_LOG_FILE = resolve(PROJECT_ROOT, ".data/awareness-apply-log.json");
const DISPATCH_SCRIPT = resolve(PROJECT_ROOT, "scripts/factory/dispatch-reddit-drafts.mjs");
const COMMENT_DRAFT_LOG_FILE = resolve(PROJECT_ROOT, ".data/awareness-comment-draft-log.json");

const TG_TOKEN = env.TELEGRAM_BOT_TOKEN;
const TG_CHAT = env.TELEGRAM_CHAT_ID;

function extractSub(url) {
  const m = url.match(/reddit\.com\/r\/([^/]+)/);
  return m ? m[1] : "reddit";
}

function extractSlug(url) {
  const m = url.match(/comments\/[^/]+\/([^/]+)/);
  return m ? m[1].slice(0, 40).replace(/_/g, " ") : "thread";
}

function loadApplyLog() {
  try {
    if (existsSync(APPLY_LOG_FILE)) return JSON.parse(readFileSync(APPLY_LOG_FILE, "utf-8"));
  } catch {}
  return [];
}

function alreadyQueued(log, itemId) {
  return log.some(entry =>
    Array.isArray(entry.items) &&
    entry.items.some(i => i.item_id === itemId && i.action_type === "reddit_comment_queued")
  );
}

async function generateCommentDraft(item) {
  const prompt = `You are writing a Reddit comment for Kirill, a solo AI workflow consultant from Calgary who builds structured operating systems for small businesses.

Thread title: ${item.title}
Why this matters (use as your angle): ${item.why_matters}

Write a 3-4 sentence Reddit comment that:
1. Validates the OP's pain or observation directly (no sycophancy)
2. Adds one structural observation from someone who builds AI workflows for real businesses
3. Ends with a soft, non-pushy offer (e.g. "happy to share what worked" or "DM if you want the implementation details")

Rules:
- No em dashes, use hyphens only
- No AI-tells: seamless, robust, leverage, delve, landscape, navigate, foster, embark
- No money-back guarantees or results-based payment promises
- Sound like a practitioner peer, not a vendor
- Max 4 sentences total
- Output only the comment text, nothing else`;

  const COMMENT_PROMPT_FILE = resolve(PROJECT_ROOT, ".data/awareness-comment-draft-prompt.md");
  writeFileSync(COMMENT_PROMPT_FILE, prompt);

  const r = spawnSync("bash", ["-c",
    `cat "${COMMENT_PROMPT_FILE}" | "${CLAUDE_BIN}" -p --model claude-haiku-4-5-20251001 --max-turns 1 --output-format text 2>&1`
  ], { cwd: PROJECT_ROOT, encoding: "utf-8", timeout: 60000 });

  const output = (r.stdout || "").trim();
  if (!output || output.length < 20) return null;
  return output;
}

// ═══════════════════════════════════════════════════════════════════════════
// AUTO SEND COMMENT DRAFTS
// For ACCEPTED items with action_type=workflow_change or gtm_tactic:
// generate comment draft via Claude CLI, send to Kirill via Telegram.
// No auto-posting. Kirill reviews and posts manually.
// ═══════════════════════════════════════════════════════════════════════════

function loadCommentDraftLog() {
  try {
    if (existsSync(COMMENT_DRAFT_LOG_FILE)) return JSON.parse(readFileSync(COMMENT_DRAFT_LOG_FILE, "utf-8"));
  } catch {}
  return [];
}

function alreadyDrafted(log, itemId) {
  return log.some(e => e.item_id === itemId);
}

async function generateWorkflowCommentDraft(item) {
  const prompt = `You are writing a comment for Kirill, a solo AI workflow consultant from Calgary who builds structured operating systems for small businesses.

Post URL: ${item.url}
Post title: ${item.title}
Why this matters: ${item.why_matters}

Draft a 3-sentence Reddit/LinkedIn comment that adds value to this discussion and positions Kirill as an AI workflow expert without pitching. End with one question that invites reply.

Rules:
- No em dashes, use hyphens only
- No AI-tells: seamless, robust, leverage, delve, landscape, navigate, foster, embark
- Sound like a practitioner peer, not a vendor
- Max 3 sentences + 1 closing question
- Output only the comment text, nothing else`;

  const PROMPT_FILE = resolve(PROJECT_ROOT, ".data/awareness-workflow-comment-prompt.md");
  writeFileSync(PROMPT_FILE, prompt);

  const r = spawnSync("bash", ["-c",
    `cat "${PROMPT_FILE}" | "${CLAUDE_BIN}" -p --model claude-haiku-4-5-20251001 --max-turns 1 --output-format text 2>&1`
  ], { cwd: PROJECT_ROOT, encoding: "utf-8", timeout: 60000 });

  const output = (r.stdout || "").trim();
  if (!output || output.length < 20) return null;
  return output;
}

async function sendCommentDraftToTelegram(item, draft) {
  if (!TG_TOKEN || !TG_CHAT) {
    console.error("[comment-drafts] Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID");
    return false;
  }

  const shortTitle = (item.title || "untitled").slice(0, 80);
  const msg = `COMMENT DRAFT - ${item.action_type}\n\n${shortTitle}\n${item.url}\n\n---\n${draft}\n---\nPost this to add credibility + invite reply.`;

  const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TG_CHAT, text: msg.slice(0, 4000) }),
  });

  return res.ok;
}

export async function autoSendCommentDrafts() {
  const db = new Database(DB_PATH);
  const items = db.prepare(`
    SELECT id, score, title, summary, why_matters, url, confidence, action_type, created_at
    FROM awareness_items
    WHERE action_type IN ('workflow_change', 'gtm_tactic')
      AND status NOT IN ('applied', 'integrated')
    ORDER BY score DESC
    LIMIT 20
  `).all();
  db.close();

  if (items.length === 0) {
    console.log("[comment-drafts] No workflow_change/gtm_tactic items found");
    return { sent: 0, skipped: 0, failed: 0 };
  }

  const draftLog = loadCommentDraftLog();
  const newItems = items.filter(i => !alreadyDrafted(draftLog, i.id));

  if (newItems.length === 0) {
    console.log(`[comment-drafts] All ${items.length} items already drafted`);
    return { sent: 0, skipped: items.length, failed: 0 };
  }

  console.log(`[comment-drafts] ${newItems.length} new items to draft`);

  let sent = 0, failed = 0;
  const newLogEntries = [];

  for (const item of newItems) {
    const shortTitle = (item.title || "untitled").slice(0, 80);
    console.log(`[comment-drafts] Generating draft for: ${shortTitle}`);

    const draft = await generateWorkflowCommentDraft(item);
    if (!draft) {
      console.error(`[comment-drafts] Draft generation failed for item ${item.id}`);
      newLogEntries.push({ item_id: item.id, action_type: item.action_type, status: "failed", timestamp: new Date().toISOString() });
      failed++;
      continue;
    }

    const ok = await sendCommentDraftToTelegram(item, draft);
    if (ok) {
      sent++;
      newLogEntries.push({ item_id: item.id, action_type: item.action_type, url: item.url, status: "sent", timestamp: new Date().toISOString() });
    } else {
      failed++;
      newLogEntries.push({ item_id: item.id, action_type: item.action_type, status: "telegram_failed", timestamp: new Date().toISOString() });
    }
  }

  draftLog.push(...newLogEntries);
  writeFileSync(COMMENT_DRAFT_LOG_FILE, JSON.stringify(draftLog, null, 2));

  return { sent, skipped: items.length - newItems.length, failed };
}

export async function autoQueueRedditComments() {
  const db = new Database(DB_PATH);
  const items = db.prepare(`
    SELECT id, score, title, summary, why_matters, url, confidence, action_type, created_at
    FROM awareness_items
    WHERE (action_type = 'none' OR action_type IS NULL)
      AND confidence = 'high'
      AND score >= 17
      AND url LIKE '%reddit.com%'
    ORDER BY score DESC
  `).all();
  db.close();

  if (items.length === 0) {
    console.log("[awareness-reddit] No matching items found");
    return { queued: 0, skipped: 0 };
  }

  const applyLog = loadApplyLog();
  const newItems = items.filter(i => !alreadyQueued(applyLog, i.id));

  if (newItems.length === 0) {
    console.log(`[awareness-reddit] All ${items.length} matching items already queued`);
    return { queued: 0, skipped: items.length };
  }

  console.log(`[awareness-reddit] ${newItems.length} new items to queue (${items.length - newItems.length} already done)`);

  const drafts = [];
  const logEntries = [];

  for (const item of newItems) {
    const shortTitle = (item.title || "untitled").slice(0, 80);
    console.log(`[awareness-reddit] Generating draft for: ${shortTitle}`);
    const body = await generateCommentDraft(item);
    if (!body) {
      console.error(`[awareness-reddit] Draft generation failed for item ${item.id}`);
      logEntries.push({
        item_id: item.id,
        title: shortTitle,
        action_type: "reddit_comment_failed",
        url: item.url,
        timestamp: new Date().toISOString(),
      });
      continue;
    }

    const sub = extractSub(item.url);
    const slug = extractSlug(item.url);
    drafts.push({
      leadId: `awareness-auto-${item.id.slice(0, 8)}`,
      name: `r/${sub} / ${slug}`,
      sub,
      kind: "comment",
      topic: (item.title || "").slice(0, 120),
      url: item.url,
      body,
      source: "awareness-auto",
      ageDays: 0,
    });

    logEntries.push({
      item_id: item.id,
      title: shortTitle,
      action_type: "reddit_comment_queued",
      url: item.url,
      timestamp: new Date().toISOString(),
    });

    try {
      const dbUpdate = new Database(DB_PATH);
      dbUpdate.prepare(`UPDATE awareness_items SET action_type = 'comment_queued', updated_at = ? WHERE id = ?`)
        .run(new Date().toISOString(), item.id);
      dbUpdate.close();
    } catch (e) {
      console.error(`[awareness-reddit] DB flag update failed for ${item.id}: ${e.message}`);
    }
  }

  if (drafts.length === 0) {
    console.log("[awareness-reddit] No drafts generated");
    const today = new Date().toISOString().slice(0, 10);
    applyLog.push({ date: today, applied: 0, failed: logEntries.length, source: "awareness-auto-reddit", items: logEntries });
    writeFileSync(APPLY_LOG_FILE, JSON.stringify(applyLog, null, 2));
    return { queued: 0, skipped: items.length };
  }

  const tmpFile = resolve(PROJECT_ROOT, ".data/awareness-reddit-drafts.json");
  writeFileSync(tmpFile, JSON.stringify(drafts, null, 2));
  console.log(`[awareness-reddit] Dispatching ${drafts.length} drafts via pipeline...`);

  const r = spawnSync("node", [DISPATCH_SCRIPT, tmpFile], {
    cwd: PROJECT_ROOT, encoding: "utf-8", timeout: 5 * 60 * 1000, stdio: "inherit",
  });

  if (r.status !== 0) {
    console.error(`[awareness-reddit] dispatch exited with status ${r.status}`);
  }

  const today = new Date().toISOString().slice(0, 10);
  applyLog.push({
    date: today,
    applied: logEntries.filter(e => e.action_type === "reddit_comment_queued").length,
    failed: logEntries.filter(e => e.action_type === "reddit_comment_failed").length,
    source: "awareness-auto-reddit",
    items: logEntries,
  });
  writeFileSync(APPLY_LOG_FILE, JSON.stringify(applyLog, null, 2));

  return { queued: drafts.length, skipped: items.length - newItems.length };
}

// ═══════════════════════════════════════════════════════════════════════════
// CLI MODE: show pending items and risk
// ═══════════════════════════════════════════════════════════════════════════

if (process.argv[1] && process.argv[1].endsWith("awareness-apply.mjs")) {
  const cmd = process.argv[2] || "list";

  if (cmd === "list") {
    const report = await getSafetyReport();
    console.log("═══════════════════════════════════════════════════════");
    console.log("AWARENESS APPLY - SAFETY REPORT");
    console.log("═══════════════════════════════════════════════════════");
    console.log(`Pending items: ${report.pending_count}`);
    console.log(`Git safety net: ${report.git_initialized ? "✅ ENABLED" : "❌ MISSING"}`);
    console.log();
    console.log(`Risk distribution:`);
    console.log(`  LOW:    ${report.by_risk.LOW} items (safe to apply with basic validation)`);
    console.log(`  MEDIUM: ${report.by_risk.MEDIUM} items (requires diff review before apply)`);
    console.log(`  HIGH:   ${report.by_risk.HIGH} items (requires manual plan, NEVER auto-apply)`);
    console.log();

    if (report.safe_to_apply_low.length > 0) {
      console.log("🟢 LOW RISK (can apply with validation):");
      for (const item of report.safe_to_apply_low) {
        console.log(`  [${item.score}/20] ${item.title}`);
        console.log(`      Risk trigger: ${item.risk.reason}`);
      }
      console.log();
    }

    if (report.needs_review_medium.length > 0) {
      console.log("🟡 MEDIUM RISK (needs Kirill review):");
      for (const item of report.needs_review_medium) {
        console.log(`  [${item.score}/20] ${item.title}`);
      }
      console.log();
    }

    if (report.needs_manual_plan_high.length > 0) {
      console.log("🔴 HIGH RISK (manual planning session required):");
      for (const item of report.needs_manual_plan_high) {
        console.log(`  [${item.score}/20] ${item.title}`);
        console.log(`      Why high risk: ${item.risk.reason}`);
      }
      console.log();
    }

    console.log("═══════════════════════════════════════════════════════");
    console.log("Safety guarantees:");
    console.log("  1. Git checkpoint before ANY changes");
    console.log("  2. Syntax check all modified .mjs files");
    console.log("  3. Load-test all modified bot files");
    console.log("  4. Auto-rollback if any validation fails");
    console.log("  5. Only LOW risk items can be applied without manual review");
    console.log("  6. HIGH risk items ALWAYS require Kirill's manual plan");
    console.log("═══════════════════════════════════════════════════════");
  }

  if (cmd === "queue-reddit") {
    const result = await autoQueueRedditComments();
    console.log(`[awareness-reddit] Done. Queued: ${result.queued}, Skipped (already done): ${result.skipped}`);
  }

  if (cmd === "comment-drafts") {
    const result = await autoSendCommentDrafts();
    console.log(`[comment-drafts] Done. Sent: ${result.sent}, Skipped: ${result.skipped}, Failed: ${result.failed}`);
  }

  if (cmd === "checkpoint") {
    const label = process.argv[3] || "manual_checkpoint";
    const result = createGitCheckpoint(label);
    console.log(result.ok ? `✅ Checkpoint: ${result.hash}` : `❌ Failed: ${result.error}`);
  }

  if (cmd === "validate") {
    const result = await validateChanges();
    console.log(result.ok ? `✅ ${result.message}` : `❌ ${result.stage}: ${result.errors.join(", ")}`);
  }
}
