/**
 * CORTEX HANDS — Claude CLI subprocess for real code changes
 *
 * The brain thinks "website needs dental landing page".
 * The body map says WHAT to change.
 * HANDS actually DO the change.
 *
 * Uses Claude CLI (Max subscription, no API key needed) via subprocess.
 * Pattern: write task to temp file -> pipe to claude -p -> parse result.
 *
 * Safety:
 * - All changes scoped to project directory only
 * - Dangerous ops (rm -rf, git push) blocked in allowedTools
 * - Every execution logged to cortex_hands table + memory
 * - Kirill notified on Telegram for significant changes
 * - Dry-run mode available (--dry-run flag in task)
 *
 * Cost: $0 (Max subscription). Time: 30-180s per task.
 */

import { spawnSync } from "child_process";
import { writeFileSync, readFileSync, existsSync, mkdirSync, statSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { remember } from "./memory.mjs";
import { logKPD } from "./memory.mjs";
import { formatBodyMapForLLM, BODY_MAP } from "./body-map.mjs";
import { updateLiveStatus } from "./observability.mjs";
import { buildBootContext, verifyBirthSync } from "./persistence-layer.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const HANDS_LOG_DIR = resolve(ROOT, ".data/hands-log");
const CLAUDE_BIN_HARDCODED = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";
const CLAUDE_BIN = (() => {
  if (existsSync(CLAUDE_BIN_HARDCODED)) return CLAUDE_BIN_HARDCODED;
  try {
    const found = spawnSync("which", ["claude"], { encoding: "utf-8" }).stdout?.trim();
    if (found && existsSync(found)) return found;
  } catch {}
  return CLAUDE_BIN_HARDCODED;
})();

// Ensure log dir exists
if (!existsSync(HANDS_LOG_DIR)) mkdirSync(HANDS_LOG_DIR, { recursive: true });

// ── SAFETY GATES ──────────────────────────────────────────────────────

const BLOCKED_PATTERNS = [
  /rm\s+-rf\s+\//,        // no rm -rf /
  /git\s+push/,            // no pushing (Kirill does that)
  /git\s+reset\s+--hard/,  // no destructive git
  /DROP\s+TABLE/i,         // no dropping tables
  /DELETE\s+FROM/i,        // no bulk deletes
  /npm\s+publish/,         // no publishing packages
  /curl.*-X\s+DELETE/,     // no API deletes
];

const ALLOWED_TOOLS = "Read,Write,Edit,Glob,Grep,Bash(ls;cat;node;npx)";

// Max turns per task type
// History: code_edit 20 -> 30 (April 18 2026) - cortex-shared-state showed repeated
// "Reached max turns (20)" failures causing HANDS retries and 30-min cooldowns.
const TURN_LIMITS = {
  "code_edit": 25,       // edit existing file
  "create_page": 20,    // create new page/component
  "rewrite_prompt": 25,  // rewrite a prompt in a bot (was 15, too low for large files)
  "config_change": 10,   // modify config files
  "analysis": 20,        // analyze and report (no changes)
  "default": 20,
};

// ── CORE EXECUTOR ─────────────────────────────────────────────────────

/**
 * Execute a code change task via Claude CLI subprocess.
 *
 * @param {object} task
 * @param {string} task.description - What to do (natural language)
 * @param {string} task.type - Task type: code_edit | create_page | rewrite_prompt | config_change | analysis
 * @param {string[]} task.files - Target files to read/modify (paths relative to project root)
 * @param {string} task.context - Additional context (e.g., body map info, strategy rationale)
 * @param {boolean} [task.dryRun] - If true, analyze and report but don't modify
 * @param {string} [task.origin] - Who requested this (cortex-daemon | evolution-engine | doctor)
 * @param {object} [options]
 * @param {number} [options.timeoutMs] - Timeout in ms (default: 8 min)
 * @param {function} [options.log] - Logger function
 * @returns {object} { success, output, filesChanged, error, durationMs }
 */
export async function executeHands(task, options = {}) {
  const log = options.log || console.log;
  const timeoutMs = options.timeoutMs || 8 * 60 * 1000;
  const startTime = Date.now();

  log(`[HANDS] Task: ${task.description?.slice(0, 100)}`);
  log(`[HANDS] Type: ${task.type || "default"} | Files: ${(task.files || []).join(", ") || "auto"}`);

  // 1. SAFETY CHECK - scan description for blocked patterns
  const fullText = `${task.description} ${(task.files || []).join(" ")}`;
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(fullText)) {
      const error = `BLOCKED: task matches safety pattern ${pattern}`;
      log(`[HANDS] ${error}`);
      return { success: false, output: "", filesChanged: [], error, durationMs: 0 };
    }
  }

  // 1.5. BIRTH CHECK - verify core is initialized before executing
  try {
    const birth = verifyBirthSync();
    const coreChecks = ["IDENTITY", "DOCTRINE", "HANDS"];
    const coreFailed = birth.checks.filter(c => coreChecks.includes(c.name) && !c.pass);
    if (coreFailed.length > 0) {
      log(`[HANDS] BIRTH WARN: core layers not initialized: ${coreFailed.map(c => c.name).join(", ")} - continuing anyway`);
    } else {
      log(`[HANDS] Birth check: ${birth.born ? "BORN" : "PARTIAL"} (${Math.round(birth.score * 100)}%)`);
    }
  } catch {}

  // 2. BUILD PROMPT
  const maxTurns = TURN_LIMITS[task.type] || TURN_LIMITS.default;
  const bootContext = (() => { try { return buildBootContext(); } catch { return ""; } })();
  const prompt = buildPrompt(task, bootContext);

  // 3. WRITE PROMPT TO TEMP FILE
  const ts = Date.now();
  const promptFile = resolve(HANDS_LOG_DIR, `task-${ts}.md`);
  writeFileSync(promptFile, prompt, "utf-8");

  // 4. SPAWN CLAUDE CLI
  try { updateLiveStatus("executing_hands", task); } catch {}
  log(`[HANDS] Spawning Claude CLI (max-turns: ${maxTurns}, timeout: ${timeoutMs / 1000}s)`);

  const cleanEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k === "CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING") continue;
    cleanEnv[k] = v;
  }
  cleanEnv.PATH = `${dirname(CLAUDE_BIN)}:${process.env.PATH || "/usr/bin:/bin"}`;

  const r = spawnSync("bash", [
    "-c",
    `cat "${promptFile}" | "${CLAUDE_BIN}" -p --model claude-sonnet-4-6 --max-turns ${maxTurns} --allowedTools "${ALLOWED_TOOLS}" --output-format text 2>&1`,
  ], {
    cwd: ROOT,
    env: cleanEnv,
    encoding: "utf-8",
    timeout: timeoutMs,
    maxBuffer: 20 * 1024 * 1024,
  });

  const durationMs = Date.now() - startTime;
  const output = (r.stdout || "") + (r.stderr || "");

  // 5. PARSE RESULT
  let result;
  try {
    result = parseHandsOutput(output);
  } catch (e) {
    result = { success: false, filesChanged: [], summary: output.slice(-500), error: e.message };
  }

  // 5.5. POST-HANDS VERIFIER: confirm changed files actually exist and were modified recently
  const verification = verifyChangedFiles(result.filesChanged || [], startTime);
  result.verified = verification.verified;
  result.verificationNote = verification.note;
  if (!verification.verified && (result.filesChanged || []).length > 0) {
    log(`[HANDS] VERIFY FAIL: ${verification.note}`);
  } else if (verification.verified) {
    log(`[HANDS] VERIFIED: ${verification.note}`);
  }

  // 6. LOG EXECUTION
  const logEntry = {
    ts: new Date().toISOString(),
    task: { description: task.description?.slice(0, 200), type: task.type, files: task.files, origin: task.origin },
    durationMs,
    exitCode: r.status,
    success: r.status === 0 && !result.error,
    filesChanged: result.filesChanged || [],
    summary: result.summary?.slice(0, 500) || "",
    error: result.error || null,
    verified: result.verified ?? null,
    verificationNote: result.verificationNote || null,
  };

  const logFile = resolve(HANDS_LOG_DIR, `result-${ts}.json`);
  writeFileSync(logFile, JSON.stringify(logEntry, null, 2));

  // Update live observability status after every execution
  try { updateLiveStatus("idle"); } catch {}

  // Detect "max turns" as a soft failure - task was too complex, not a system error
  const maxTurnsHit = /max turns|Reached max/i.test(result.error || "") || /max turns|Reached max/i.test(output);
  if (maxTurnsHit) {
    log(`[HANDS] MAX TURNS HIT - task too complex for ${maxTurns} turns. Will not retry.`);
    result.error = `Task too complex (needed more than ${maxTurns} turns). Skipping - not a system error.`;
    result.noRetry = true;
  }

  log(`[HANDS] Done in ${(durationMs / 1000).toFixed(1)}s | exit=${r.status} | files=${(result.filesChanged || []).length}`);

  if (result.error && !maxTurnsHit) {
    log(`[HANDS] ERROR: ${result.error}`);
  }

  return {
    success: r.status === 0 && !result.error,
    output: result.summary || output.slice(-1000),
    filesChanged: result.filesChanged || [],
    error: result.error || null,
    noRetry: result.noRetry || false,
    durationMs,
    verified: result.verified ?? null,
    verificationNote: result.verificationNote || null,
  };
}

// ── PROMPT BUILDER ────────────────────────────────────────────────────

function buildPrompt(task, bootContext = "") {
  const filesList = (task.files || []).map(f => `- ${f}`).join("\n");
  const dryRunNote = task.dryRun
    ? "\nDRY RUN MODE: Analyze what you would change and report, but do NOT modify any files."
    : "";

  // Scope guard: if task lists multiple improvements, force first-only execution.
  // Root cause of max-turns failures: brain sends "3 improvements" as one task.
  const hasMultipleItems = /\b(?:[3-9]|three|три|несколько|multiple)\s+(?:\S+\s+)?(?:улучшени|обязательн|критичн|важн|improve|fix|change|шаг|step)/i.test(task.description)
    || /(?:^|\n)\s*(?:[2-9][\.\):])\s+.{10,}/m.test(task.description)
    // Comma-separated compound tasks: "создай X, выдели Y, дай Z" or "create X, then run Y"
    || /,\s*(?:выдели|дай|запусти|проверь|обнови|добавь|сделай|создай|запиши|установи|удали|измени|сохрани)/i.test(task.description)
    || /,\s*(?:then\s+)?(?:create|allocate|add|give|run|check|update|write|set|build|seed|launch|dispatch)\s+/i.test(task.description);
  const scopeGuard = hasMultipleItems
    ? `\n## SCOPE GUARD - MAX TURNS PREVENTION\nThis task lists multiple items. Implement ONLY the FIRST item. Mark remaining items as "DEFERRED" in your HANDS_RESULT summary. Do NOT attempt all items in one call.\n`
    : "";

  const bootSection = bootContext
    ? `${bootContext}\n\n---\n`
    : "";

  return `${bootSection}You are CORTEX HANDS - the execution layer of an autonomous business system.
Your job: make the exact code change described below. Nothing more, nothing less.

PROJECT ROOT: ${ROOT}
${dryRunNote}${scopeGuard}
## TASK
${task.description}

## TASK TYPE
${task.type || "code_edit"}

${filesList ? `## TARGET FILES\n${filesList}` : ""}

${task.context ? `## CONTEXT\n${task.context}` : ""}

## RULES
1. Make ONLY the changes described. Do not refactor surrounding code.
2. Do not add comments explaining what you changed unless the logic is non-obvious.
3. Do not create README files or documentation.
4. If you need to understand existing code, read it first.
5. Test your changes if possible (run the file with node to check for syntax errors).
6. Never use em dashes in any text content - use hyphens instead.
7. Never promise money-back guarantees or results-based payment in any copy.

## OUTPUT FORMAT
When done, output EXACTLY this block at the END of your response:

HANDS_RESULT:
\`\`\`json
{
  "success": true,
  "filesChanged": ["path/relative/to/root.mjs"],
  "fact": "One sentence: what verifiably happened (e.g. 'Added X to file Y at line Z')",
  "file": "The primary file changed, or 'none' if no files changed",
  "nextStep": "One concrete next action to validate or continue this work",
  "summary": "fact + file + nextStep combined in 1-2 sentences"
}
\`\`\`

RULES for the result block:
- "fact" must be checkable - reference line numbers, function names, or values actually changed
- "file" must be a real path that was modified, not a description
- "nextStep" must be a single concrete action (e.g. "Run node scripts/cortex/hands.mjs to verify" or "Check .data/cortex-config.json for new field X")
- If you cannot complete the task, set success to false and explain in "fact" why it failed
`;
}

// ── POST-HANDS VERIFIER ───────────────────────────────────────────────

/**
 * Confirms each filesChanged path exists on disk and was modified during or after
 * the HANDS execution window. Returns { verified, note } for the log entry.
 */
function verifyChangedFiles(filesChanged, executionStartMs) {
  if (!filesChanged || filesChanged.length === 0) {
    return { verified: null, note: "no files claimed changed" };
  }

  const missing = [];
  const stale = [];
  const fresh = [];

  for (const relPath of filesChanged) {
    const absPath = resolve(ROOT, relPath);
    if (!existsSync(absPath)) {
      missing.push(relPath);
      continue;
    }
    let mtime;
    try { mtime = statSync(absPath).mtimeMs; } catch { missing.push(relPath); continue; }
    // Allow 30s of clock skew
    if (mtime >= executionStartMs - 30_000) {
      fresh.push(`${relPath} (mtime ${new Date(mtime).toISOString().slice(11, 19)})`);
    } else {
      stale.push(`${relPath} (mtime ${new Date(mtime).toISOString().slice(0, 16)}, not modified)`);
    }
  }

  if (missing.length > 0) {
    return { verified: false, note: `missing files: ${missing.join(", ")}` };
  }
  if (stale.length > 0 && fresh.length === 0) {
    return { verified: false, note: `files not modified during execution: ${stale.join(", ")}` };
  }
  const allFresh = fresh.join(", ");
  const stalePart = stale.length > 0 ? ` | stale: ${stale.join(", ")}` : "";
  return { verified: true, note: `confirmed fresh: ${allFresh}${stalePart}` };
}

// ── OUTPUT PARSER ─────────────────────────────────────────────────────

function parseHandsOutput(output) {
  // Look for HANDS_RESULT block
  const m = output.match(/HANDS_RESULT:\s*(?:```(?:json)?\s*)?(\{[\s\S]*?\n\})\s*(?:```)?/);
  if (m) {
    let parsed;
    try {
      parsed = JSON.parse(m[1]);
    } catch (e) {
      const fixed = m[1].replace(/,\s*}/g, "}").replace(/,\s*]/g, "]");
      try { parsed = JSON.parse(fixed); } catch {}
    }
    if (parsed) {
      // Enforce fact-file-nextStep protocol - fill missing fields from summary
      if (!parsed.fact) parsed.fact = parsed.summary?.slice(0, 150) || "(no fact provided)";
      if (!parsed.file) parsed.file = (parsed.filesChanged || [])[0] || "none";
      if (!parsed.nextStep) parsed.nextStep = "(no next step provided)";
      return parsed;
    }
  }

  // Fallback: check if output mentions file modifications
  const editMentions = output.match(/(?:edited|wrote|created|modified)\s+[`"']?([^\s`"']+\.\w+)/gi) || [];
  const filesChanged = [...new Set(editMentions.map(m => m.replace(/^(?:edited|wrote|created|modified)\s+[`"']?/i, "")))];

  // Check for obvious errors
  if (output.includes("Error:") || output.includes("FATAL") || output.includes("spawn error")) {
    const errorLine = output.split("\n").find(l => /error|fatal/i.test(l)) || "Unknown error";
    return { success: false, filesChanged, summary: output.slice(-500), error: errorLine.trim() };
  }

  return {
    success: filesChanged.length > 0 || output.length > 100,
    filesChanged,
    summary: output.slice(-500),
  };
}

// ── CONVENIENCE WRAPPERS ──────────────────────────────────────────────

/**
 * Edit an existing file with a specific change.
 */
export async function editFile(filePath, changeDescription, origin = "cortex", options = {}) {
  return executeHands({
    description: changeDescription,
    type: "code_edit",
    files: [filePath],
    origin,
  }, options);
}

/**
 * Create a new page/component.
 */
export async function createPage(pagePath, pageSpec, origin = "cortex", options = {}) {
  return executeHands({
    description: pageSpec,
    type: "create_page",
    files: [pagePath],
    origin,
  }, options);
}

/**
 * Rewrite a prompt inside a bot file.
 */
export async function rewritePrompt(botFile, newPromptSpec, origin = "cortex", options = {}) {
  return executeHands({
    description: `Rewrite the LLM prompt in ${botFile}: ${newPromptSpec}`,
    type: "rewrite_prompt",
    files: [botFile],
    origin,
  }, options);
}

/**
 * Analyze code and report findings (no changes).
 */
export async function analyzeCode(question, files, origin = "cortex", options = {}) {
  return executeHands({
    description: question,
    type: "analysis",
    files,
    dryRun: true,
    origin,
  }, options);
}

// ── CORTEX INTEGRATION: execute from brain decision ───────────────────

/**
 * Called by cortex-daemon executePlan when action = "execute_hands"
 *
 * Decision format from brain:
 * {
 *   "action": "execute_hands",
 *   "task": "Add new case study section for SaaS founder vibe-code rescue",
 *   "type": "create_page",
 *   "files": ["apps/web/app/insights/page.tsx"],
 *   "context": "Discovery hypothesis: solo founders with broken MVPs convert well",
 *   "reason": "Testing vibe-code audit vertical expansion"
 * }
 */
export async function executeFromBrainDecision(db, decision, log = console.log) {
  const task = {
    description: decision.task || decision.description,
    type: decision.type || "code_edit",
    files: decision.files || [],
    context: decision.context || decision.reason || "",
    dryRun: decision.dryRun || false,
    origin: "cortex-brain",
  };

  const result = await executeHands(task, { log });

  // Log to memory
  if (result.success) {
    remember(db, "episodic",
      `HANDS executed: ${task.description?.slice(0, 100)}. Files: ${result.filesChanged.join(", ")}. ${result.output?.slice(0, 100)}`,
      "hands-execution", "cortex-hands"
    );
  } else {
    remember(db, "episodic",
      `HANDS FAILED: ${task.description?.slice(0, 100)}. Error: ${result.error?.slice(0, 150)}`,
      "hands-failure", "cortex-hands"
    );
  }

  // Log KPD
  logKPD(db, "cortex-hands", 0, // $0 cost - Max subscription
    JSON.stringify({ task: task.description?.slice(0, 100), files: result.filesChanged }).slice(0, 200),
    result.success ? result.filesChanged.length : 0
  );

  return result;
}

// ── BODY MAP INTEGRATION ──────────────────────────────────────────────

/**
 * Given a body map implementation plan step, execute it via hands.
 * Called by evolution-engine when it has a hypothesis to test.
 */
export async function executeBodyMapStep(db, step, hypothesis, log = console.log) {
  const task = {
    description: `${step.action}: ${hypothesis}`,
    type: inferTaskType(step),
    files: inferFiles(step),
    context: `Body map asset: ${step.asset}\nHow: ${step.how}\nHypothesis: ${hypothesis}`,
    origin: "evolution-engine",
  };

  return executeHands(task, { log });
}

function inferTaskType(step) {
  if (step.action?.includes("page") || step.action?.includes("Create")) return "create_page";
  if (step.action?.includes("prompt") || step.action?.includes("Rewrite")) return "rewrite_prompt";
  if (step.action?.includes("config")) return "config_change";
  return "code_edit";
}

function inferFiles(step) {
  // Extract file paths from the step description
  const matches = (step.how || "").match(/[\w./\-]+\.(?:mjs|tsx?|jsx?|json|md)/g) || [];
  return matches;
}
