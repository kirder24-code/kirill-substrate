/**
 * SELF-BUILDER BOT - Detects system gaps and creates what's missing
 *
 * Pipeline:
 * 1. Read gaps from: capabilities.md, hypothesis results, directives, bot_intelligence
 * 2. Prioritize by impact (HIGH/MEDIUM/LOW)
 * 3. Build solution via Claude CLI subprocess
 * 4. Validate (syntax, banned patterns)
 * 5. Send to Telegram for Kirill's approval before deployment
 *
 * Safety: NEVER auto-deploys. NEVER modifies existing bots. Max 1 new bot per day.
 *
 * Run: node scripts/factory/self-builder.mjs
 */

import { callAI, MODEL_STRONG, tgSend, BOTS, CHAT_ID, heartbeat, getDb, setIntelligence, getIntelligenceKey, preflight, emitEvent } from "./orchestrator.mjs";
import { readPurpose, readWiki } from "../../wiki/reader.mjs";
import Database from "better-sqlite3";
import { spawnSync } from "child_process";
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const LOG_FILE = "/tmp/lbo-self-builder.log";
const STATE_FILE = resolve(ROOT, ".data/self-builder-state.json");
const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";
const BOT_ID = "self-builder";
const BOT_NAME = "SelfBuilder";
const BOT_TOKEN = BOTS.build.token;

// ── Logging ──────────────────────────────────────────────────────────
function log(msg) {
  const line = `${new Date().toISOString()} [self-builder] ${msg}\n`;
  process.stdout.write(line);
  try { appendFileSync(LOG_FILE, line); } catch {}
}

// ── State persistence ────────────────────────────────────────────────
function loadState() {
  try {
    if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  } catch {}
  return { lastBuildDate: null, builds: [] };
}

function saveState(state) {
  try { writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); } catch (e) { log(`state save error: ${e.message}`); }
}

// ── Preflight ────────────────────────────────────────────────────────
preflight([
  { name: "TELEGRAM_BOT_TOKEN", value: BOT_TOKEN },
  { name: "CHAT_ID", value: CHAT_ID },
  { name: "CLAUDE_BIN", value: CLAUDE_BIN, file: true },
]);

// ═══════════════════════════════════════════════════════════════════════
// 1. GAP DETECTION - read from multiple sources
// ═══════════════════════════════════════════════════════════════════════

function readCapabilitiesGaps() {
  const gaps = [];
  const capFile = resolve(ROOT, "wiki/channels/capabilities.md");
  if (!existsSync(capFile)) { log("capabilities.md not found"); return gaps; }

  const content = readFileSync(capFile, "utf-8");
  // Parse NOT CONNECTED section
  const notConnectedMatch = content.match(/## NOT CONNECTED[^\n]*\n\|[^\n]+\n\|[^\n]+\n([\s\S]*?)(?=\n##|\n$|$)/);
  if (notConnectedMatch) {
    const rows = notConnectedMatch[1].trim().split("\n").filter(r => r.startsWith("|"));
    for (const row of rows) {
      const cols = row.split("|").map(c => c.trim()).filter(Boolean);
      if (cols.length >= 4) {
        gaps.push({
          source: "capabilities.md",
          channel: cols[0],
          impact: cols[1],
          whatNeeded: cols[2],
          priority: cols[3],
          type: "channel_gap",
        });
      }
    }
  }

  // Parse BROKEN / DEPLETED section
  const brokenMatch = content.match(/## BROKEN \/ DEPLETED[^\n]*\n\|[^\n]+\n\|[^\n]+\n([\s\S]*?)(?=\n##|\n$|$)/);
  if (brokenMatch) {
    const rows = brokenMatch[1].trim().split("\n").filter(r => r.startsWith("|"));
    for (const row of rows) {
      const cols = row.split("|").map(c => c.trim()).filter(Boolean);
      if (cols.length >= 3) {
        gaps.push({
          source: "capabilities.md",
          channel: cols[0],
          impact: cols[1],
          whatNeeded: cols[2],
          priority: "LOW",
          type: "broken_channel",
        });
      }
    }
  }
  log(`capabilities gaps: ${gaps.length}`);
  return gaps;
}

function readHypothesisGaps() {
  const gaps = [];
  const hypoFile = resolve(ROOT, ".data/hypothesis-test-results.json");
  if (!existsSync(hypoFile)) { log("hypothesis-test-results.json not found"); return gaps; }

  try {
    const results = JSON.parse(readFileSync(hypoFile, "utf-8"));
    const arr = Array.isArray(results) ? results : [results];
    for (const r of arr) {
      if (r.blocked_by_missing_channel || r.missing_capability) {
        gaps.push({
          source: "hypothesis-test-results",
          channel: r.blocked_by_missing_channel || r.missing_capability,
          impact: `Hypothesis "${(r.hypothesis || r.title || "unknown").slice(0, 80)}" blocked`,
          whatNeeded: r.what_needed || r.fix || "Unknown",
          priority: "HIGH",
          type: "hypothesis_blocker",
        });
      }
    }
  } catch (e) { log(`hypothesis parse error: ${e.message}`); }
  log(`hypothesis gaps: ${gaps.length}`);
  return gaps;
}

function readDirectiveGaps() {
  const gaps = [];
  const dirFile = resolve(ROOT, "wiki/directives.md");
  if (!existsSync(dirFile)) { log("directives.md not found"); return gaps; }

  const content = readFileSync(dirFile, "utf-8");
  // Look for patterns like "need X but don't have it" or "missing capability"
  const needPatterns = [
    /need\s+(\w[\w\s-]+?)\s+but\s+(?:don't|do not)\s+have/gi,
    /missing\s+(?:capability|channel|bot|tool):\s*(.+?)(?:\.|$)/gim,
    /cannot\s+(?:access|reach|post to)\s+(.+?)(?:\s*[-.]|\s*$)/gim,
  ];
  for (const pat of needPatterns) {
    let m;
    while ((m = pat.exec(content)) !== null) {
      gaps.push({
        source: "directives.md",
        channel: m[1].trim().slice(0, 100),
        impact: "System-brain flagged this gap",
        whatNeeded: `Directive mentions need for: ${m[1].trim().slice(0, 100)}`,
        priority: "MEDIUM",
        type: "directive_gap",
      });
    }
  }
  log(`directive gaps: ${gaps.length}`);
  return gaps;
}

function readBotIntelligenceGaps() {
  const gaps = [];
  try {
    const db = getDb();
    const rows = db.prepare(`
      SELECT bot_id, key, value_json, updated_at
      FROM bot_intelligence
      WHERE insight_type = 'capability_gap'
      ORDER BY updated_at DESC
      LIMIT 20
    `).all();
    for (const row of rows) {
      try {
        const val = JSON.parse(row.value_json);
        gaps.push({
          source: `bot_intelligence:${row.bot_id}`,
          channel: val.channel || val.capability || row.key,
          impact: val.impact || `Bot ${row.bot_id} reported missing capability`,
          whatNeeded: val.what_needed || val.description || "Unknown",
          priority: val.priority === "high" ? "HIGH" : "MEDIUM",
          type: "bot_reported",
        });
      } catch {}
    }
    db.close();
  } catch (e) { log(`bot_intelligence query error: ${e.message}`); }
  log(`bot_intelligence gaps: ${gaps.length}`);
  return gaps;
}

// ═══════════════════════════════════════════════════════════════════════
// 2. PRIORITIZE
// ═══════════════════════════════════════════════════════════════════════

function prioritizeGaps(allGaps) {
  const priorityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  // Deduplicate by channel name (case-insensitive)
  const seen = new Map();
  for (const gap of allGaps) {
    const key = (gap.channel || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!seen.has(key) || priorityOrder[gap.priority] < priorityOrder[seen.get(key).priority]) {
      seen.set(key, gap);
    }
  }
  const deduped = [...seen.values()];
  deduped.sort((a, b) => (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2));
  return deduped;
}

// ═══════════════════════════════════════════════════════════════════════
// 3. AI ANALYSIS - decide what to build
// ═══════════════════════════════════════════════════════════════════════

async function analyzeAndDecide(gaps) {
  if (gaps.length === 0) return null;

  const purpose = readPurpose();
  const gapList = gaps.map((g, i) =>
    `${i + 1}. [${g.priority}] ${g.channel} (source: ${g.source})\n   Impact: ${g.impact}\n   Needed: ${g.whatNeeded}\n   Type: ${g.type}`
  ).join("\n\n");

  const systemPrompt = `You are the self-builder agent for an AI automation system. Your job is to analyze detected system gaps and decide which ONE gap to fill by creating a new bot or script.

${purpose}

Rules:
- Pick the gap that would have the HIGHEST real-world impact on revenue or pipeline
- Only pick gaps that CAN be solved with a new script (not gaps requiring API keys, external access, or manual setup)
- If no gap is buildable right now, return null
- A "buildable" gap means: the system has the tools/APIs needed, we just need the bot code
- Do NOT pick gaps that need: new API subscriptions, external account setup, manual OAuth flows
- Prefer gaps that connect to existing pipeline (orchestrator, Telegram, DB)`;

  const userPrompt = `Here are the detected system gaps:

${gapList}

Analyze each gap. Which ONE should we build a solution for right now?

Return JSON:
{
  "decision": "build" or "skip",
  "gap_index": <number, 1-based>,
  "gap_channel": "<name>",
  "reason": "<why this gap and not others>",
  "bot_name": "<proposed filename without .mjs>",
  "bot_purpose": "<1-2 sentence purpose>",
  "bot_capabilities": ["<what it will do>"],
  "skip_reason": "<if decision is skip, why>"
}`;

  try {
    const result = await callAI(systemPrompt, userPrompt, MODEL_STRONG, true);
    return result;
  } catch (e) {
    log(`analyzeAndDecide error: ${e.message}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 4. BUILD via Claude CLI subprocess
// ═══════════════════════════════════════════════════════════════════════

function buildBot(decision, gap) {
  const botFileName = `${decision.bot_name}.mjs`;
  const targetDir = botFileName.includes("outreach") ? "scripts/outreach" : "scripts/factory";
  const targetPath = resolve(ROOT, targetDir, botFileName);

  if (existsSync(targetPath)) {
    log(`SKIP: file already exists: ${targetPath}`);
    return { success: false, error: "File already exists - will not overwrite" };
  }

  // Read a reference bot for template
  let referenceBotContent = "";
  try {
    const refPath = resolve(ROOT, "scripts/factory/awareness-bot.mjs");
    referenceBotContent = readFileSync(refPath, "utf-8").slice(0, 3000);
  } catch {}

  const prompt = `You are building a new bot for the linkedin-brand-os system at ${ROOT}.

== TASK ==
Create file: ${targetPath}
Bot name: ${decision.bot_name}
Purpose: ${decision.bot_purpose}
Capabilities: ${(decision.bot_capabilities || []).join(", ")}

== GAP BEING FILLED ==
Channel: ${gap.channel}
Impact: ${gap.impact}
What's needed: ${gap.whatNeeded}

== ARCHITECTURE RULES ==
All bots in this system follow these patterns:

1. Imports MUST include:
   import { callAI, MODEL_STRONG, tgSend, BOTS, CHAT_ID, heartbeat, getDb } from "./orchestrator.mjs";
   import { readPurpose } from "../../wiki/reader.mjs";

2. File path setup:
   const __dirname = dirname(fileURLToPath(import.meta.url));
   const ROOT = resolve(__dirname, "../..");

3. Bot MUST call heartbeat() at the end of each run
4. Bot MUST send results to Telegram via tgSend(BOTS.build.token, CHAT_ID, message)
5. Bot MUST have a main() async function wrapped in main().catch()
6. Bot MUST log to console with [${decision.bot_name}] prefix
7. Bot MUST read purpose: const purpose = readPurpose();
8. Bot MUST use callAI() for any AI reasoning, NOT direct API calls
9. Bot MUST NOT use em dashes (use hyphens instead)
10. Bot MUST NOT reference voice agents or money-back guarantees
11. Bot MUST NOT send external messages (email, DM, posts) without Telegram approval flow
12. Bot MUST NOT hardcode fake data or placeholder URLs
13. Bot MUST be designed to run standalone: node ${targetDir}/${botFileName}

== REFERENCE BOT (first 3000 chars of awareness-bot.mjs) ==
${referenceBotContent}

== OUTPUT ==
Write ONLY the file ${targetPath}. No other files.
Make it production-ready, not a skeleton.
The bot should be useful on its first run.`;

  log(`Building ${botFileName} via Claude CLI...`);
  const result = spawnSync(CLAUDE_BIN, [
    "-p",
    "--output-format", "text",
    "--max-turns", "10",
    "--allowedTools", "Bash,Read,Write,Edit,Glob,Grep",
  ], {
    input: prompt,
    encoding: "utf-8",
    cwd: ROOT,
    timeout: 5 * 60 * 1000,
    maxBuffer: 20 * 1024 * 1024,
  });

  const output = (result.stdout || "").trim();
  const exitCode = result.status;

  log(`Claude CLI exit=${exitCode} output=${output.length}b`);

  if (exitCode !== 0 || output.length < 50) {
    log(`BUILD FAILED: exit=${exitCode} stderr=${(result.stderr || "").slice(0, 500)}`);
    return { success: false, error: `Claude CLI failed (exit ${exitCode})`, output: output.slice(0, 500) };
  }

  // Check if file was actually created
  if (!existsSync(targetPath)) {
    log(`BUILD FAILED: Claude CLI ran but file was not created at ${targetPath}`);
    return { success: false, error: "File was not created by Claude CLI" };
  }

  return { success: true, path: targetPath, output: output.slice(0, 1000) };
}

// ═══════════════════════════════════════════════════════════════════════
// 5. VALIDATE the built file
// ═══════════════════════════════════════════════════════════════════════

function validateBot(filePath) {
  const issues = [];

  // Syntax check
  const syntaxCheck = spawnSync("node", ["--check", filePath], {
    encoding: "utf-8",
    timeout: 15000,
  });
  if (syntaxCheck.status !== 0) {
    issues.push({ type: "syntax", message: (syntaxCheck.stderr || "").slice(0, 300) });
  }

  // Content checks
  let content;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch (e) {
    issues.push({ type: "read_error", message: e.message });
    return issues;
  }

  // Em dash check
  if (content.includes("\u2014")) {
    issues.push({ type: "em_dash", message: "File contains em dashes - must use hyphens" });
  }

  // Voice agent references
  if (/voice\s*agent/i.test(content) && !/\/\/.*voice\s*agent/i.test(content)) {
    issues.push({ type: "voice_agent", message: "File references voice agent (discontinued)" });
  }

  // Money-back guarantee
  if (/money.?back\s*guarantee/i.test(content)) {
    issues.push({ type: "money_back", message: "File contains money-back guarantee reference" });
  }

  // Hardcoded fake data
  if (/example\.com|test@test|fakeemail|placeholder\.com/i.test(content)) {
    issues.push({ type: "fake_data", message: "File contains hardcoded fake data" });
  }

  // Must have required imports
  if (!content.includes("orchestrator.mjs")) {
    issues.push({ type: "missing_import", message: "Missing orchestrator.mjs import" });
  }
  if (!content.includes("heartbeat")) {
    issues.push({ type: "missing_heartbeat", message: "Missing heartbeat call" });
  }

  return issues;
}

function attemptFix(filePath, issues, retryNum) {
  const issueDesc = issues.map(i => `- ${i.type}: ${i.message}`).join("\n");
  const prompt = `Fix the following issues in ${filePath}:

${issueDesc}

Rules:
- Fix ONLY the issues listed above
- Do NOT rewrite the entire file
- Do NOT add new features
- Em dashes (the long dash character) must be replaced with hyphens
- If syntax error, fix the specific syntax issue`;

  log(`Attempting fix #${retryNum} for ${issues.length} issues...`);
  const result = spawnSync(CLAUDE_BIN, [
    "-p",
    "--output-format", "text",
    "--max-turns", "5",
    "--allowedTools", "Read,Edit,Grep",
  ], {
    input: prompt,
    encoding: "utf-8",
    cwd: ROOT,
    timeout: 3 * 60 * 1000,
    maxBuffer: 10 * 1024 * 1024,
  });

  return result.status === 0;
}

// ═══════════════════════════════════════════════════════════════════════
// 6. TELEGRAM NOTIFICATION
// ═══════════════════════════════════════════════════════════════════════

async function notifyTelegram(decision, gap, filePath, buildOutput) {
  const shortPath = filePath.replace(ROOT + "/", "");
  const capabilities = (decision.bot_capabilities || []).map(c => `  - ${c}`).join("\n");

  const message = `<b>SELF-BUILDER: New bot created</b>

<b>Gap detected:</b> ${gap.channel}
<b>Priority:</b> ${gap.priority}
<b>Source:</b> ${gap.source}

<b>Built:</b> <code>${shortPath}</code>
<b>Purpose:</b> ${decision.bot_purpose}

<b>Capabilities:</b>
${capabilities}

<b>Next step:</b> Review the file and reply:
- "approve ${decision.bot_name}" to add to daemon schedule
- "reject ${decision.bot_name}" to delete
- Or review the file manually at ${shortPath}`;

  // Truncate to Telegram 4096 limit
  const truncated = message.slice(0, 4000);
  await tgSend(BOT_TOKEN, CHAT_ID, truncated);
  log("Telegram notification sent");
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════

async function main() {
  log("=== Self-Builder starting ===");
  const db = getDb();

  // Rate limit: max 1 build per day
  const state = loadState();
  const today = new Date().toISOString().slice(0, 10);
  if (state.lastBuildDate === today) {
    log("Already built today - skipping (max 1 per day)");
    heartbeat(db, BOT_ID, BOT_NAME, "Skipped - already built today", {}, { status: "ok" });
    db.close();
    return;
  }

  // Step 1: Detect gaps from all sources
  log("Step 1: Detecting gaps...");
  const capsGaps = readCapabilitiesGaps();
  const hypoGaps = readHypothesisGaps();
  const dirGaps = readDirectiveGaps();
  const botGaps = readBotIntelligenceGaps();

  const allGaps = [...capsGaps, ...hypoGaps, ...dirGaps, ...botGaps];
  log(`Total raw gaps: ${allGaps.length}`);

  if (allGaps.length === 0) {
    log("No gaps detected - nothing to build");
    heartbeat(db, BOT_ID, BOT_NAME, "No gaps detected", { gaps: 0 }, { status: "ok" });
    db.close();
    return;
  }

  // Step 2: Prioritize and deduplicate
  log("Step 2: Prioritizing gaps...");
  const ranked = prioritizeGaps(allGaps);
  log(`Ranked gaps: ${ranked.length} (after dedup)`);

  // Filter out gaps that were already built
  const alreadyBuilt = new Set(state.builds.map(b => (b.channel || "").toLowerCase()));
  const unbuit = ranked.filter(g => !alreadyBuilt.has((g.channel || "").toLowerCase()));
  log(`Unbuilt gaps: ${unbuit.length}`);

  if (unbuit.length === 0) {
    log("All detected gaps have been built already");
    heartbeat(db, BOT_ID, BOT_NAME, "All gaps already addressed", { gaps: ranked.length }, { status: "ok" });
    db.close();
    return;
  }

  // Step 3: AI decides what to build
  log("Step 3: AI analysis...");
  const decision = await analyzeAndDecide(unbuit);

  if (!decision || decision.decision === "skip") {
    const reason = decision?.skip_reason || "AI decided no buildable gap exists";
    log(`Skip: ${reason}`);
    heartbeat(db, BOT_ID, BOT_NAME, `Skipped: ${reason.slice(0, 100)}`, { gaps: unbuit.length }, { status: "ok" });
    db.close();
    return;
  }

  const gapIndex = (decision.gap_index || 1) - 1;
  const targetGap = unbuit[Math.min(gapIndex, unbuit.length - 1)];
  log(`Decision: build "${decision.bot_name}" for gap "${targetGap.channel}"`);

  // Step 4: Build via Claude CLI
  log("Step 4: Building...");
  const buildResult = buildBot(decision, targetGap);

  if (!buildResult.success) {
    log(`Build failed: ${buildResult.error}`);
    await tgSend(BOT_TOKEN, CHAT_ID, `<b>SELF-BUILDER: Build failed</b>\nGap: ${targetGap.channel}\nError: ${buildResult.error}`);
    heartbeat(db, BOT_ID, BOT_NAME, `Build failed: ${buildResult.error.slice(0, 80)}`, {}, { status: "error", error: buildResult.error });
    db.close();
    return;
  }

  // Step 5: Validate
  log("Step 5: Validating...");
  let issues = validateBot(buildResult.path);
  let retries = 0;
  const MAX_RETRIES = 2;

  while (issues.length > 0 && retries < MAX_RETRIES) {
    retries++;
    log(`Validation found ${issues.length} issues, retry ${retries}/${MAX_RETRIES}`);
    const fixed = attemptFix(buildResult.path, issues, retries);
    if (!fixed) break;
    issues = validateBot(buildResult.path);
  }

  if (issues.length > 0) {
    const issueList = issues.map(i => `${i.type}: ${i.message}`).join("; ");
    log(`Validation failed after ${retries} retries: ${issueList}`);
    // Clean up the bad file
    try { const { unlinkSync } = await import("fs"); unlinkSync(buildResult.path); } catch {}
    await tgSend(BOT_TOKEN, CHAT_ID, `<b>SELF-BUILDER: Validation failed</b>\nGap: ${targetGap.channel}\nBot: ${decision.bot_name}\nIssues: ${issueList.slice(0, 500)}`);
    heartbeat(db, BOT_ID, BOT_NAME, `Validation failed: ${issueList.slice(0, 80)}`, {}, { status: "error", error: issueList });
    db.close();
    return;
  }

  log("Validation passed");

  // Step 6: Notify Telegram
  log("Step 6: Sending to Telegram for approval...");
  await notifyTelegram(decision, targetGap, buildResult.path, buildResult.output);

  // Update state
  state.lastBuildDate = today;
  state.builds.push({
    date: today,
    channel: targetGap.channel,
    botName: decision.bot_name,
    filePath: buildResult.path,
    purpose: decision.bot_purpose,
    status: "pending_approval",
  });
  saveState(state);

  // Record in bot_intelligence
  setIntelligence(db, BOT_ID, "build_history", decision.bot_name, {
    gap: targetGap.channel,
    source: targetGap.source,
    priority: targetGap.priority,
    filePath: buildResult.path,
    status: "pending_approval",
    builtAt: new Date().toISOString(),
  });

  emitEvent(db, {
    fromBot: BOT_ID,
    eventType: "bot_created",
    payload: {
      botName: decision.bot_name,
      gap: targetGap.channel,
      filePath: buildResult.path,
    },
  });

  heartbeat(db, BOT_ID, BOT_NAME, `Built ${decision.bot_name} for ${targetGap.channel} - awaiting approval`, {
    gaps_detected: allGaps.length,
    gap_filled: targetGap.channel,
    bot_built: decision.bot_name,
  }, { status: "ok", last_success_at: new Date().toISOString() });

  db.close();
  log(`=== Self-Builder done. Built: ${decision.bot_name} ===`);
}

main().catch(err => {
  log(`FATAL: ${err.message}\n${err.stack}`);
  try {
    const db = getDb();
    heartbeat(db, BOT_ID, BOT_NAME, `Fatal: ${err.message.slice(0, 80)}`, {}, { status: "error", error: err.message });
    db.close();
  } catch {}
  process.exit(1);
});
