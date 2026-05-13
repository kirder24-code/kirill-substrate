/**
 * cortex/cortex-executor.mjs - Causal closure (2026-05-09)
 *
 * THE BRIDGE: cortex thinking -> body acting.
 *
 * Until now, attention.proposeSpotlight selected a "winner" topic and broadcast
 * spotlight_winner, but no one listened. The cortex thought "verify reddit-monitor
 * querying live API" and that string just sat in .data/cortex-spotlight.json.
 *
 * Under Global Workspace Theory (Baars/Dehaene) - the chosen functionalist
 * framework - global broadcast SHOULD drive specialized processors. A workspace
 * winner that doesn't influence behavior is a broken implementation. This module
 * closes the loop:
 *
 *   1. Subscribes to spotlight_winner
 *   2. Uses Claude to translate free-form topic into structured action plan
 *   3. Maps plan to executable: script_invoke | hands_delegate | inquiry_only
 *   4. Runs action under safety constraints (directory whitelist, blocked patterns,
 *      timeouts, rate limits)
 *   5. Broadcasts cortex_action_started + cortex_action_completed
 *   6. The completed event enters substrate as bot_result so predictive-self
 *      learns whether the cortex's actions actually succeed
 *
 * Honest constraints:
 *   - This does NOT "make the system conscious". Under functionalism, causal
 *     closure is necessary but not sufficient.
 *   - Safety > autonomy: blocked patterns and directory whitelist are hard limits.
 *   - Rate limit prevents runaway loops eating LLM credits.
 *   - All actions logged to audit trail (.data/cortex-actions.json).
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const AUDIT_PATH = resolve(ROOT, ".data/cortex-actions.json");

const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";
const CLAUDE_MODEL = "claude-sonnet-4-6";
const CLAUDE_TIMEOUT_MS = 45_000;
const SUBPROCESS_TIMEOUT_MS = 90_000;

// SAFETY: only scripts inside these directories may be invoked
const SAFE_SCRIPT_DIRS = [
  "scripts/cortex/",
  "scripts/factory/",
  "scripts/outreach/",
  "scripts/automation/",
  "scripts/observability/",
];

// SAFETY: action plans containing any of these regex are rejected outright
const BLOCKED_PATTERNS = [
  /rm\s+-rf/i,
  /\bgit\s+push/i,
  /\bgit\s+reset\s+--hard/i,
  /\bgit\s+rebase/i,
  /DROP\s+TABLE/i,
  /DELETE\s+FROM/i,
  /TRUNCATE/i,
  /\bnpm\s+publish/i,
  /curl.*-X\s+DELETE/i,
  /sudo\s/i,
  /chmod\s+-R/i,
  /\.\.\//,
  /\/etc\//i,
  /\/var\//i,
  /\/usr\//i,
];

// Rate limits to prevent runaway loops
const MAX_PER_HOUR = 5;
const MAX_PER_DAY = 20;

const _audit = []; // { at, topic, plan, outcome, broadcast }
const MAX_AUDIT = 500;

let _busRef = null;
let _llmStats = { calls: 0, successes: 0, failures: 0, blocked: 0, fallbackInquiry: 0 };

function _loadAudit() {
  if (!existsSync(AUDIT_PATH)) return [];
  try {
    const raw = JSON.parse(readFileSync(AUDIT_PATH, "utf-8"));
    return Array.isArray(raw.audit) ? raw.audit : [];
  } catch { return []; }
}

function _persist() {
  if (_audit.length > MAX_AUDIT) _audit.splice(0, _audit.length - MAX_AUDIT);
  try {
    writeFileSync(AUDIT_PATH, JSON.stringify({
      updatedAt: new Date().toISOString(),
      llmStats: _llmStats,
      audit: _audit,
    }, null, 2));
  } catch (e) {
    process.stderr.write(`[cortex-executor] persist failed: ${e?.message || e}\n`);
  }
}

function _withinRateLimit() {
  const now = Date.now();
  const lastHour = _audit.filter(a => now - new Date(a.at).getTime() < 3600_000).length;
  const lastDay = _audit.filter(a => now - new Date(a.at).getTime() < 86400_000).length;
  return { ok: lastHour < MAX_PER_HOUR && lastDay < MAX_PER_DAY, lastHour, lastDay };
}

function _isBlocked(text) {
  const flat = String(text || "");
  for (const re of BLOCKED_PATTERNS) {
    if (re.test(flat)) return re.toString();
  }
  return null;
}

function _isSafeScriptPath(p) {
  if (!p || typeof p !== "string") return false;
  if (p.startsWith("/")) return false;
  if (p.includes("..")) return false;
  return SAFE_SCRIPT_DIRS.some(dir => p.startsWith(dir));
}

// ─── LLM action planner ─────────────────────────────────────────────────

async function _planAction(topic, evidence, urgency) {
  const prompt = `You are the cortex executor planner. Your job is to translate a high-level cognitive intent (a "spotlight topic" the substrate has decided to focus on) into a concrete safe action.

Available action types:
1. "script_invoke" - Run an existing project script. Only safe directories: ${SAFE_SCRIPT_DIRS.join(", ")}. Provide:
   - script_path (relative, must start with one of the safe dirs)
   - args (array of string args, may be empty)
   You may ONLY suggest this if you are reasonably confident the script exists and addresses the intent.
2. "hands_delegate" - Delegate to the hands subsystem (Claude subprocess that can read+edit code). Provide:
   - hands_task_description (1-2 sentences for hands)
   - hands_task_type ("code_edit" | "analysis" | "create_page" | "config_change")
   - target_files (array of file paths to focus on, optional)
3. "inquiry_only" - No side effect: just have the substrate think harder about this and log the reasoning. Provide:
   - inquiry_question (1 sentence)
4. "no_executable_match" - The topic doesn't translate to any safe action. Provide:
   - reason (why nothing fits)
5. "approved_outreach_artifact" - Execute one already-approved revenue touch through the minimal delivery adapter. Provide:
   - artifact (object with lead_id or candidate_id, channel, approved_at, body, optional recipient, subject, business_signal, next_followup_at)
   - delivery_mode ("dry_run" | "manual_confirm")
   - manual_confirmation (required if delivery_mode is manual_confirm)

HARD CONSTRAINTS:
- Never propose destructive operations (rm, git push, db drops). Reject the topic outright with no_executable_match if intent is destructive.
- script_path must start with one of the safe directories listed above.
- args must be plain strings, no shell metacharacters.
- If the topic is investigative ("understand X", "review Y"), prefer inquiry_only or hands_delegate (analysis), not script_invoke.
- Use hyphens, never em dashes, in any text fields.

SPOTLIGHT TOPIC: ${topic}
URGENCY: ${urgency}
EVIDENCE PROVIDED BY UPSTREAM: ${evidence || "(none)"}

Output a JSON object ONLY:
{
  "action_type": "script_invoke" | "hands_delegate" | "inquiry_only" | "no_executable_match" | "approved_outreach_artifact",
  "rationale": "<1 sentence why this action serves the topic>",
  "script_path": "<only if script_invoke>",
  "args": ["..."],
  "hands_task_description": "<only if hands_delegate>",
  "hands_task_type": "<only if hands_delegate>",
  "target_files": ["..."],
  "artifact": { "action_type": "approved_outreach_artifact", "lead_id": "...", "channel": "...", "approved_at": "...", "body": "..." },
  "delivery_mode": "<only if approved_outreach_artifact>",
  "manual_confirmation": "<only if approved_outreach_artifact and operator has explicitly confirmed delivery>",
  "inquiry_question": "<only if inquiry_only>",
  "reason": "<only if no_executable_match>"
}

Output JSON only, no preamble, no markdown fences.`;

  // CONTINUAL LEARNING: inject accumulated lessons (async dynamic import)
  let promptWithLessons = prompt;
  try {
    const lessons = await import("./lessons-as-prompt.mjs");
    const addendum = lessons.getLivingPromptAddendum?.();
    if (addendum) promptWithLessons = prompt + addendum;
  } catch {}

  _llmStats.calls++;
  const r = spawnSync(CLAUDE_BIN, ["-p", "--model", CLAUDE_MODEL, "--max-turns", "2"], {
    input: promptWithLessons, encoding: "utf-8", timeout: CLAUDE_TIMEOUT_MS,
  });

  if (r.status !== 0 || !r.stdout) {
    _llmStats.failures++;
    return null;
  }
  const m = r.stdout.match(/\{[\s\S]*\}/);
  if (!m) { _llmStats.failures++; return null; }
  try {
    const parsed = JSON.parse(m[0]);
    _llmStats.successes++;
    return parsed;
  } catch (e) {
    _llmStats.failures++;
    return null;
  }
}

// ─── Action executors ───────────────────────────────────────────────────

function _executeScriptInvoke(plan) {
  const { script_path, args = [] } = plan;
  if (!_isSafeScriptPath(script_path)) {
    return { ok: false, reason: `unsafe script path: ${script_path}` };
  }
  const abs = resolve(ROOT, script_path);
  if (!existsSync(abs)) {
    return { ok: false, reason: `script not found: ${script_path}` };
  }
  // Re-validate args for blocked patterns
  for (const arg of args) {
    if (_isBlocked(arg)) return { ok: false, reason: `blocked pattern in arg: ${arg}` };
  }
  const r = spawnSync("node", [abs, ...args], {
    encoding: "utf-8", timeout: SUBPROCESS_TIMEOUT_MS, cwd: ROOT,
  });
  return {
    ok: r.status === 0,
    exit_code: r.status,
    stdout: (r.stdout || "").slice(0, 4000),
    stderr: (r.stderr || "").slice(0, 2000),
  };
}

async function _executeHandsDelegate(plan) {
  const { hands_task_description, hands_task_type, target_files } = plan;
  if (!hands_task_description) return { ok: false, reason: "missing hands_task_description" };
  if (_isBlocked(hands_task_description)) return { ok: false, reason: "blocked pattern in description" };
  try {
    const { executeHands } = await import("./hands.mjs");
    const res = await executeHands({
      description: hands_task_description,
      type: hands_task_type || "analysis",
      files: Array.isArray(target_files) ? target_files : [],
      origin: "cortex-executor",
    });
    return { ok: !!res.success, ...res };
  } catch (e) {
    return { ok: false, reason: `hands import/exec failed: ${e.message}` };
  }
}

function _executeInquiryOnly(plan) {
  const { inquiry_question } = plan;
  if (!inquiry_question) return { ok: false, reason: "missing inquiry_question" };
  // Run a one-shot Claude call as inquiry (no side effects, just reasoning logged)
  const r = spawnSync(CLAUDE_BIN, ["-p", "--model", "claude-haiku-4-5-20251001", "--max-turns", "1"], {
    input: `Brief reasoning (3-5 sentences): ${inquiry_question}\n\nUse hyphens, no em dashes. No preamble.`,
    encoding: "utf-8", timeout: CLAUDE_TIMEOUT_MS,
  });
  if (r.status !== 0) return { ok: false, reason: `inquiry claude exit=${r.status}` };
  return { ok: true, reasoning: (r.stdout || "").slice(0, 2000).trim() };
}

async function _executeApprovedOutreachArtifact(plan) {
  try {
    const { executeApprovedOutreachArtifact } = await import("../outreach/revenue-outreach-executor.mjs");
    const entry = executeApprovedOutreachArtifact(plan.artifact, {
      dryRun: plan.delivery_mode === "dry_run",
      manualConfirmation: plan.manual_confirmation || "",
    });
    return {
      ok: entry.delivery_status !== "delivery_failed",
      delivery_status: entry.delivery_status,
      sent_at: entry.sent_at,
      message_id: entry.message_id,
      provider_response: entry.provider_response,
      log_id: entry.log_id,
    };
  } catch (e) {
    return { ok: false, reason: `approved outreach execution failed: ${e.message}` };
  }
}

// ─── Main handler ───────────────────────────────────────────────────────

async function _handleSpotlightWinner(entry) {
  const data = entry?.data || {};
  const topic = data.topic;
  const evidence = data.evidence;
  const urgency = data.urgency || 5;
  if (!topic) return;

  // Rate limit gate
  const rate = _withinRateLimit();
  if (!rate.ok) {
    _audit.push({
      at: new Date().toISOString(),
      topic, urgency, outcome: { ok: false, reason: `rate-limited: ${rate.lastHour}/h ${rate.lastDay}/d` },
    });
    _persist();
    return;
  }

  // Fast-path block check on topic itself
  const blockedTopic = _isBlocked(topic);
  if (blockedTopic) {
    _llmStats.blocked++;
    _audit.push({
      at: new Date().toISOString(),
      topic, urgency, outcome: { ok: false, reason: `blocked topic pattern: ${blockedTopic}` },
    });
    _persist();
    return;
  }

  // Broadcast started
  if (_busRef) {
    try {
      _busRef.broadcast({
        source: "cortex-executor",
        type: "cortex_action_started",
        data: { topic, urgency, proposed_by: data.proposed_by },
      });
    } catch {}
  }

  // Plan via LLM
  const plan = await _planAction(topic, evidence, urgency);
  if (!plan) {
    const record = {
      at: new Date().toISOString(),
      topic, urgency, plan: null,
      outcome: { ok: false, reason: "planner LLM failed" },
    };
    _audit.push(record);
    _persist();
    if (_busRef) {
      try {
        _busRef.broadcast({
          source: "cortex-executor",
          type: "cortex_action_completed",
          data: { topic, success: false, action_type: "planner_failed", reason: "planner LLM failed" },
        });
      } catch {}
    }
    return;
  }

  // Validate plan as a whole for blocked patterns
  const planText = JSON.stringify(plan);
  const blockedInPlan = _isBlocked(planText);
  if (blockedInPlan) {
    _llmStats.blocked++;
    const record = {
      at: new Date().toISOString(),
      topic, urgency, plan,
      outcome: { ok: false, reason: `blocked pattern in plan: ${blockedInPlan}` },
    };
    _audit.push(record);
    _persist();
    if (_busRef) {
      try {
        _busRef.broadcast({
          source: "cortex-executor",
          type: "cortex_action_completed",
          data: { topic, success: false, action_type: plan.action_type, reason: "safety-blocked" },
        });
      } catch {}
    }
    return;
  }

  // CREATOR-SAFETY check (loyalty floor) before any real action
  try {
    const { checkAction } = await import("./creator-safety.mjs");
    const safetyDecision = checkAction({
      description: `${plan.action_type}: ${plan.rationale} - ${plan.hands_task_description || plan.script_path || plan.inquiry_question || plan.artifact?.body || ""}`,
      target: plan.target_files?.join(",") || plan.script_path,
      type: plan.action_type,
    }, "cortex-executor");
    if (safetyDecision.allow === false) {
      const record = {
        at: new Date().toISOString(),
        topic, urgency, plan,
        outcome: { ok: false, reason: `creator-safety blocked: ${safetyDecision.reason}`, primary_concern: safetyDecision.primary_concern },
      };
      _audit.push(record);
      _persist();
      if (_busRef) {
        try {
          _busRef.broadcast({
            source: "cortex-executor",
            type: "cortex_action_completed",
            data: { topic, success: false, action_type: "safety_blocked", reason: safetyDecision.reason },
          });
        } catch {}
      }
      return;
    }
    if (safetyDecision.allow === "needs_explicit_authorization") {
      // Already escalated by creator-safety - just record
      const record = {
        at: new Date().toISOString(),
        topic, urgency, plan,
        outcome: { ok: false, reason: `awaiting auth: ${safetyDecision.reason}`, awaiting_authorization: true },
      };
      _audit.push(record);
      _persist();
      return;
    }
  } catch (e) {
    // Fail closed on safety module error
    process.stderr.write(`[cortex-executor] creator-safety failed - failing closed: ${e?.message || e}\n`);
    return;
  }

  // SOFT-LAUNCH approval queue (post-safety-check, pre-dispatch)
  // In off mode this resolves true immediately. In soft_launch waits for Kirill.
  try {
    const { requestApproval } = await import("./approval-queue.mjs");
    const approval = await requestApproval("cortex-executor", {
      description: `${plan.action_type}: ${plan.rationale} - ${plan.hands_task_description || plan.script_path || plan.inquiry_question || plan.artifact?.body || ""}`.slice(0, 600),
      target: plan.target_files?.join(",") || plan.script_path,
      type: plan.action_type,
    });
    if (!approval.approved) {
      const record = {
        at: new Date().toISOString(),
        topic, urgency, plan,
        outcome: { ok: false, reason: `approval-queue: ${approval.reason}`, awaiting_or_denied: true },
      };
      _audit.push(record);
      _persist();
      if (_busRef) {
        try {
          _busRef.broadcast({
            source: "cortex-executor",
            type: "cortex_action_completed",
            data: { topic, success: false, action_type: plan.action_type, reason: approval.reason },
          });
        } catch {}
      }
      return;
    }
  } catch (e) {
    // Fail closed on approval queue error
    process.stderr.write(`[cortex-executor] approval-queue failed: ${e?.message || e}\n`);
    return;
  }

  // Dispatch by action_type
  let outcome;
  switch (plan.action_type) {
    case "script_invoke":
      outcome = _executeScriptInvoke(plan);
      break;
    case "hands_delegate":
      outcome = await _executeHandsDelegate(plan);
      break;
    case "inquiry_only":
      _llmStats.fallbackInquiry++;
      outcome = _executeInquiryOnly(plan);
      break;
    case "approved_outreach_artifact":
      outcome = await _executeApprovedOutreachArtifact(plan);
      break;
    case "no_executable_match":
      outcome = { ok: true, reason: plan.reason, no_action: true };
      break;
    default:
      outcome = { ok: false, reason: `unknown action_type: ${plan.action_type}` };
  }

  const record = {
    at: new Date().toISOString(),
    topic, urgency, evidence,
    plan,
    outcome,
  };
  _audit.push(record);
  _persist();

  // Broadcast completed - this enters substrate as bot_result so predictive-self
  // can learn whether cortex actions tend to succeed
  if (_busRef) {
    try {
      _busRef.broadcast({
        source: "cortex-executor",
        type: "cortex_action_completed",
        data: {
          topic,
          urgency,
          action_type: plan.action_type,
          success: !!outcome.ok,
          rationale: plan.rationale,
          summary: outcome.reason || outcome.reasoning?.slice(0, 200) || `action_type=${plan.action_type} ok=${outcome.ok}`,
        },
      });
      // Also broadcast as a bot_result so predictive-self can score it
      _busRef.broadcast({
        source: "cortex-executor",
        type: "bot_result",
        data: {
          action_id: `cortex-${Date.now()}`,
          bot: `cortex-action::${plan.action_type}`,
          success: !!outcome.ok,
          summary: `cortex executed: ${topic.slice(0, 80)}`,
        },
      });
    } catch (e) {
      process.stderr.write(`[cortex-executor] broadcast failed: ${e?.message || e}\n`);
    }
  }
}

// ─── Required GWT-module export ─────────────────────────────────────────

export function register(bus) {
  _busRef = bus;
  if (_audit.length === 0) {
    const loaded = _loadAudit();
    _audit.push(...loaded);
  }
  bus.subscribe("spotlight_winner", (entry) => {
    // Fire and forget the async handler so subscribe() stays sync
    _handleSpotlightWinner(entry).catch(e => {
      process.stderr.write(`[cortex-executor] handler error: ${e?.message || e}\n`);
    });
  });
}

// ─── Test helpers ───────────────────────────────────────────────────────

export function getAudit(limit = 30) { return _audit.slice(-limit); }
export function getLLMStats() { return { ..._llmStats }; }
export async function _handleForTest(entry) { return _handleSpotlightWinner(entry); }

export function _resetState() {
  _audit.length = 0;
  _llmStats = { calls: 0, successes: 0, failures: 0, blocked: 0, fallbackInquiry: 0 };
  _busRef = null;
}
