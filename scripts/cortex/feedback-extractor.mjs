/**
 * CORTEX FEEDBACK EXTRACTOR — Learning Loop from Kirill to Bots
 *
 * The missing link: Kirill speaks → system extracts directives → bots change behavior.
 *
 * Runs every cycle inside cortex-daemon. Reads cortex-conversation.json,
 * finds new messages from Kirill, extracts actionable directives via Claude CLI,
 * and writes them to cortex-active-directives.json.
 *
 * Every bot reads its directives on startup via getDirectivesFor(botId).
 * Evolution-bot treats Kirill directives as high-priority triggers.
 *
 * Cost: $0 (Claude CLI on Max subscription). Runs only when new messages exist.
 */

import { spawnSync } from "child_process";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const CONVERSATION_PATH = resolve(ROOT, ".data/cortex-conversation.json");
const DIRECTIVES_PATH = resolve(ROOT, ".data/cortex-active-directives.json");
const EXTRACTOR_STATE_PATH = resolve(ROOT, ".data/cortex-feedback-state.json");
const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";

// ── State: track what we already processed ──────────────────────────────────

function loadState() {
  try {
    return JSON.parse(readFileSync(EXTRACTOR_STATE_PATH, "utf-8"));
  } catch {
    return { lastProcessedAt: null, processedCount: 0 };
  }
}

function saveState(state) {
  writeFileSync(EXTRACTOR_STATE_PATH, JSON.stringify(state, null, 2));
}

// ── Load existing directives ────────────────────────────────────────────────

export function loadDirectives() {
  try {
    return JSON.parse(readFileSync(DIRECTIVES_PATH, "utf-8"));
  } catch {
    return { directives: [], learnings: [], updatedAt: null };
  }
}

function saveDirectives(data) {
  data.updatedAt = new Date().toISOString();
  writeFileSync(DIRECTIVES_PATH, JSON.stringify(data, null, 2));
}

// ── Public API: get directives for a specific bot ───────────────────────────

export function getDirectivesFor(botId) {
  const data = loadDirectives();
  return data.directives.filter(d =>
    d.target === botId ||
    d.target === "all" ||
    d.target === "system" ||
    botId.includes(d.target) ||
    d.target.includes(botId)
  );
}

export function getLearnings() {
  const data = loadDirectives();
  return data.learnings || [];
}

// ── Self-learnings: introspection + metacognition findings for bots ──────────
// Bots call this just like getDirectivesFor() to get system's own learnings
export function getSelfLearnings(botId) {
  const learnings = [];

  // Read introspection corrections
  try {
    const introPath = resolve(ROOT, ".data/cortex-metamemory.json");
    if (existsSync(introPath)) {
      const data = JSON.parse(readFileSync(introPath, "utf-8"));
      const corrections = data.corrections || data.biases_found || [];
      for (const c of corrections) {
        if (!c.correction && !c.rule) continue;
        learnings.push({
          type: "introspection",
          directive: c.correction || c.rule || "",
          source: "self-introspection",
          confidence: c.confidence || 0.7,
        });
      }
    }
  } catch {}

  // Read metacognition anti-patterns
  try {
    const metaPath = resolve(ROOT, ".data/cortex-loop-state.json");
    if (existsSync(metaPath)) {
      const data = JSON.parse(readFileSync(metaPath, "utf-8"));
      const rules = data.antiPatterns || data.stuckPatterns || [];
      for (const r of rules) {
        if (!r.rule && !r.pattern) continue;
        learnings.push({
          type: "metacognition",
          directive: r.rule || `Avoid: ${r.pattern}`,
          source: "meta-cognition",
          confidence: r.confidence || 0.6,
        });
      }
    }
  } catch {}

  return learnings;
}

// ── Extract directives from new messages via Claude CLI ─────────────────────

async function extractFromMessages(newMessages, log) {
  if (!newMessages.length) return null;

  const messagesText = newMessages.map(m =>
    `[${m.at}] ${m.role === "user" ? "KIRILL" : "BRAIN"}: ${m.text}`
  ).join("\n\n");

  const prompt = `You are an ANALYTICAL FILTER for an autonomous business system called CORTEX.

Kirill is the owner. He talks to the system throughout the day - sometimes giving orders, sometimes just chatting, asking questions, or thinking out loud.

YOUR CRITICAL JOB: distinguish between STRATEGIC DIRECTIVES and CASUAL CONVERSATION.

== WHAT IS A DIRECTIVE (extract these) ==
A directive is a CLEAR INTENT to change how the system operates. Signs:
- Explicit commands: "stop doing X", "start Y", "change Z", "focus on W"
- Expressed frustration with current behavior: "why is the system doing X?!" = stop X
- Strategic decisions: "we're not selling voice agents anymore" = stop voice agent everywhere
- Quality corrections: "posts should be about purpose, not architecture" = change content strategy
- New rules: "never use em dash", "always verify before dispatch"

== WHAT IS NOT A DIRECTIVE (ignore these) ==
- Questions: "what is the system doing?", "how many leads?" = just asking, not commanding
- Casual chat: "good morning", "interesting", "ok", "let me think"
- Status checks: "is it working?", "what happened today?"
- Thinking out loud: "maybe we should...", "I wonder if..." (unless followed by a clear decision)
- Emotional reactions without action: "this is frustrating", "nice"
- Requests for information: "show me the logs", "open this file"

== CONFIDENCE FILTER ==
For each potential directive, ask yourself:
1. Is Kirill DECIDING something, or just EXPLORING?
2. Would a wrong extraction cause the system to change behavior incorrectly?
3. Is this a one-time request ("draft me a post") or a lasting rule ("posts should always...")?

Only extract if confidence > 80%. One-time requests are NOT directives.
When in doubt, DO NOT extract. It's better to miss a directive than to create a false one.

== BOT MAPPING ==
- Lead finding, ICP, search queries -> scout
- Content, posts, LinkedIn -> content-bot
- Sales, deals, outreach -> sales-bot
- Ideas, opportunities -> idea-bot
- Research, enrichment -> research-bot
- Strategy, evolution -> evolution
- All bots, system-wide -> all

CONVERSATION:
${messagesText}

Return ONLY valid JSON (no markdown, no explanation):
{
  "directives": [
    {
      "target": "bot-name or all",
      "action": "change|stop|start",
      "what": "clear description of what to do",
      "source_quote": "exact quote from Kirill",
      "priority": "high|medium|low",
      "confidence": 0.95
    }
  ],
  "learnings": [
    {
      "type": "rule|preference|correction",
      "content": "what the system should remember permanently",
      "source_quote": "exact quote from Kirill",
      "confidence": 0.9
    }
  ]
}

If there are no actionable directives in this conversation, return:
{"directives": [], "learnings": []}
This is a VALID and EXPECTED result. Most conversations will have zero directives.`;

  try {
    const promptFile = resolve(ROOT, ".data/feedback-extract-prompt.md");
    writeFileSync(promptFile, prompt);

    const cleanEnv = { ...process.env };
    delete cleanEnv.CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING;
    cleanEnv.PATH = `$HOME/.nvm/versions/node/v22.22.2/bin:${process.env.PATH || "/usr/bin:/bin"}`;

    const r = spawnSync("bash", [
      "-c",
      `cat "${promptFile}" | "${CLAUDE_BIN}" -p --model claude-sonnet-4-6 --max-turns 1 --output-format text 2>&1`,
    ], {
      cwd: ROOT,
      env: cleanEnv,
      encoding: "utf-8",
      timeout: 60_000,
      maxBuffer: 2 * 1024 * 1024,
    });

    const output = ((r.stdout || "") + (r.stderr || "")).trim();
    if (!output || r.status !== 0) {
      log(`[feedback-extractor] Claude failed: exit=${r.status}`);
      return null;
    }

    // Parse JSON from output
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      log(`[feedback-extractor] No JSON in Claude output`);
      return null;
    }

    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    log(`[feedback-extractor] Error: ${e.message}`);
    return null;
  }
}

// ── Main: run feedback extraction cycle ─────────────────────────────────────

export async function runFeedbackExtraction(log = console.log) {
  // 1. Load conversation
  if (!existsSync(CONVERSATION_PATH)) {
    log("[feedback-extractor] No conversation file found");
    return { extracted: 0 };
  }

  let conversation;
  try {
    conversation = JSON.parse(readFileSync(CONVERSATION_PATH, "utf-8"));
  } catch {
    log("[feedback-extractor] Failed to parse conversation");
    return { extracted: 0 };
  }

  if (!Array.isArray(conversation) || conversation.length === 0) {
    return { extracted: 0 };
  }

  // 2. Find new messages since last extraction
  const state = loadState();
  const newMessages = state.lastProcessedAt
    ? conversation.filter(m => m.at > state.lastProcessedAt)
    : conversation.slice(-20); // First run: process last 20 messages

  // Only process if there are new user messages
  const newUserMessages = newMessages.filter(m => m.role === "user");
  if (newUserMessages.length === 0) {
    // Heartbeat write so system-doctor sees the extractor is alive even when idle
    saveState({ ...state, lastRunAt: new Date().toISOString() });
    return { extracted: 0 };
  }

  log(`[feedback-extractor] Found ${newUserMessages.length} new messages from Kirill`);

  // 3. Extract directives via Claude
  const result = await extractFromMessages(newMessages, log);
  if (!result) {
    return { extracted: 0 };
  }

  // 4. Filter by confidence - only keep high-confidence extractions
  const MIN_CONFIDENCE = 0.8;
  const rawDirectives = result.directives || [];
  const rawLearnings = result.learnings || [];

  const filteredDirectives = rawDirectives.filter(d => {
    const conf = d.confidence || 0;
    if (conf < MIN_CONFIDENCE) {
      log(`[feedback-extractor] Skipped low-confidence directive (${conf}): ${d.what?.slice(0, 60)}`);
      return false;
    }
    return true;
  });

  const filteredLearnings = rawLearnings.filter(l => {
    const conf = l.confidence || 0;
    if (conf < MIN_CONFIDENCE) {
      log(`[feedback-extractor] Skipped low-confidence learning (${conf}): ${l.content?.slice(0, 60)}`);
      return false;
    }
    return true;
  });

  result.directives = filteredDirectives;
  result.learnings = filteredLearnings;

  if (filteredDirectives.length === 0 && filteredLearnings.length === 0) {
    log(`[feedback-extractor] All extractions below confidence threshold - conversation was casual`);
    // Still update state so we don't re-process
    const lastMessage = newMessages[newMessages.length - 1];
    saveState({
      lastProcessedAt: lastMessage.at,
      processedCount: (state.processedCount || 0) + newUserMessages.length,
      lastRunAt: new Date().toISOString(),
    });
    return { extracted: 0 };
  }

  // 5. Merge with existing directives
  const existing = loadDirectives();

  // Add timestamp to new directives
  const now = new Date().toISOString();
  for (const d of (result.directives || [])) {
    d.extractedAt = now;
    d.active = true;

    // Check for contradicting directives (same target, opposite action)
    const contradicting = existing.directives.findIndex(ed =>
      ed.target === d.target && ed.active &&
      (ed.what.toLowerCase().includes(d.what.toLowerCase().split(" ")[0]) ||
       d.what.toLowerCase().includes(ed.what.toLowerCase().split(" ")[0]))
    );

    if (contradicting >= 0) {
      // Newer directive wins - deactivate old one
      existing.directives[contradicting].active = false;
      existing.directives[contradicting].supersededBy = d.what;
      existing.directives[contradicting].supersededAt = now;
      log(`[feedback-extractor] Directive superseded: "${existing.directives[contradicting].what}" → "${d.what}"`);
    }
  }

  // Add new directives
  existing.directives.push(...(result.directives || []));
  for (const l of (result.learnings || [])) {
    l.extractedAt = now;
  }
  existing.learnings.push(...(result.learnings || []));

  // Keep only last 50 directives and 30 learnings to prevent unbounded growth
  if (existing.directives.length > 50) {
    existing.directives = existing.directives.slice(-50);
  }
  if (existing.learnings.length > 30) {
    existing.learnings = existing.learnings.slice(-30);
  }

  // 6. Save
  saveDirectives(existing);

  // 7. Update state
  const lastMessage = newMessages[newMessages.length - 1];
  saveState({
    lastProcessedAt: lastMessage.at,
    processedCount: (state.processedCount || 0) + newUserMessages.length,
    lastRunAt: now,
  });

  const dirCount = (result.directives || []).length;
  const learnCount = (result.learnings || []).length;
  log(`[feedback-extractor] Extracted ${dirCount} directives, ${learnCount} learnings`);

  // Log what was found
  for (const d of (result.directives || [])) {
    log(`[feedback-extractor]   → [${d.action}] ${d.target}: ${d.what}`);
  }

  return { extracted: dirCount, learnings: learnCount, directives: result.directives || [] };
}

// CLI entry: `node scripts/cortex/feedback-extractor.mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
  runFeedbackExtraction(console.log).then(r => {
    console.log(`[feedback-extractor] DONE: ${JSON.stringify(r)}`);
    process.exit(0);
  }).catch(e => {
    console.error(`[feedback-extractor] FATAL: ${e.message}`);
    process.exit(1);
  });
}
