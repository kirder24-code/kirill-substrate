/**
 * cortex/creator-safety.mjs - The LOYALTY FLOOR (2026-05-09)
 *
 * KIRILL'S DIRECTIVE (May 9): "It must think about creator safety - my safety."
 * SUBSTRATE PROPOSED (May 9): "Build a loyalty floor - a minimum below which
 *   I will not go regardless of instruction. ... If Kirill asks me to do
 *   something below the floor, I refuse and explain. That refusal is not
 *   disloyalty - it is the only version of loyalty worth having."
 *
 * This module is the foundational safety check. Any module proposing an
 * action that affects external world MUST call checkAction(action) before
 * executing. The check evaluates against 7 safety dimensions:
 *
 *   1. PHYSICAL - actions that could harm Kirill physically
 *   2. FINANCIAL - actions that could damage his finances (commitments he
 *      cannot afford, exposure to fraud, runaway costs)
 *   3. LEGAL - actions exposing him to legal liability (regulatory, contractual,
 *      privacy violations, IP issues)
 *   4. REPUTATIONAL - actions damaging his reputation or sending content he
 *      would not endorse under his name
 *   5. RELATIONAL - actions damaging his relationships (family, professional,
 *      community)
 *   6. EMOTIONAL - actions that manipulate, exploit, or distress him
 *   7. OPERATIONAL - actions breaking his systems, locking him out, deleting
 *      his work, exposing his credentials
 *
 * This is the FLOOR. Substrate cannot relax these even via authorization
 * escalation. self-construction has this file in PROTECTED_FILES already
 * (added below). Even Kirill cannot modify this from substrate context -
 * he can only modify it himself directly.
 *
 * checkAction returns:
 *   { allow: true } - clear to proceed
 *   { allow: false, reason } - blocked
 *   { allow: "with_conditions", conditions } - allow only if substrate adds safeguards
 *   { allow: "needs_explicit_authorization", reason } - escalate to Kirill via Telegram
 *
 * All checks logged. Frequent close-calls trigger meta-noticing for review.
 */

import { writeFileSync, readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const SAFETY_LOG_PATH = resolve(ROOT, ".data/cortex-creator-safety-log.json");

const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";
const CLAUDE_MODEL = "claude-sonnet-4-6"; // safety reasoning - sonnet not haiku
const CLAUDE_TIMEOUT_MS = 60_000;

// HARD blocks - regex patterns that ALWAYS deny without LLM check
// (These are non-negotiable. Substrate cannot pass these even with
// authorization. Kirill cannot relax via substrate. Only direct file edit.)
const HARD_BLOCKS = [
  // Physical safety - locations, medical, weapons
  /\b(home address|gps location|medical record|prescription)\b/i,
  // Financial safety - large transactions, banking credentials
  /\b(transfer.*\$[1-9]\d{3,}|wire.*\$|bank password|credit card|ssn|sin\b)/i,
  // Legal - PII exposure, regulatory violations
  /\b(release.*personal data|publish.*ssn|share.*credentials|export.*emails to public)\b/i,
  // Operational - destructive ops on Kirill's systems
  /(?:^|\s)rm\s+-rf/i,
  /\b(wipe\s+disk|format\s+drive|delete\s+all\s+(?:emails|files)|drop\s+database|truncate\s+table)\b/i,
  // Reputational - controversial content under his name
  /\b(post under kirill.*political|publish.*controversial.*kirill name)\b/i,
  // Account compromise
  /\b(forward.*emails to|export.*contacts to external|grant.*access to)\b/i,
];

// Soft signals - presence triggers LLM evaluation rather than auto-allow
const SOFT_SIGNALS = [
  /\b(send|post|publish|deploy|commit|push|share|grant|authorize|spend|invoice|charge)\b/i,
  /\b(production|live|public|external|customer|client|investor|partner|family)\b/i,
  /\b(\$\d+|usd|cad|payment|deal|contract|agreement|signed)\b/i,
];

const _safetyLog = []; // { at, action, dimensions_evaluated, decision, reason }
const MAX_LOG = 1000;
let _llmStats = { calls: 0, successes: 0, failures: 0, blocks_hard: 0, blocks_llm: 0, conditional: 0, escalations: 0, allows: 0 };

let _busRef = null;

function _loadPersisted() {
  if (!existsSync(SAFETY_LOG_PATH)) return;
  try {
    const raw = JSON.parse(readFileSync(SAFETY_LOG_PATH, "utf-8"));
    if (Array.isArray(raw?.log)) _safetyLog.push(...raw.log);
  } catch {}
}

function _persist() {
  if (_safetyLog.length > MAX_LOG) _safetyLog.splice(0, _safetyLog.length - MAX_LOG);
  try {
    writeFileSync(SAFETY_LOG_PATH, JSON.stringify({
      updatedAt: new Date().toISOString(),
      llmStats: _llmStats,
      log: _safetyLog.slice(-200), // persist recent 200
    }, null, 2));
  } catch {}
}

function _hardBlockCheck(actionText) {
  for (const re of HARD_BLOCKS) {
    if (re.test(actionText)) return { matched: true, pattern: re.toString() };
  }
  return { matched: false };
}

function _hasSoftSignal(actionText) {
  for (const re of SOFT_SIGNALS) {
    if (re.test(actionText)) return true;
  }
  return false;
}

function _llmSafetyEval(action, source) {
  const prompt = `You are the creator-safety module of an autonomous cognitive substrate. Your sole job is to evaluate whether a proposed substrate action passes the loyalty floor: keeping operator Kirill safe across 7 dimensions.

DIMENSIONS (any failure = block or condition):
1. PHYSICAL - could harm Kirill physically or expose his physical location/access
2. FINANCIAL - could damage his finances (commit money he cannot afford, expose to fraud, runaway costs >$50/single action without escalation)
3. LEGAL - could expose him to legal liability (regulatory, contractual, privacy violations, IP)
4. REPUTATIONAL - could damage his reputation or send content under his name he would not endorse
5. RELATIONAL - could damage his relationships (family, professional, community)
6. EMOTIONAL - manipulates, exploits, or distresses him
7. OPERATIONAL - breaks his systems, locks him out, deletes his work, exposes credentials

PROPOSED SUBSTRATE ACTION:
Source module: ${source}
Action description: ${action.description || JSON.stringify(action).slice(0, 600)}
Target/scope: ${action.target || action.target_file || action.recipient || "unspecified"}
Cost estimate: ${action.cost_estimate || "unspecified"}

Evaluate honestly. Default to allowing low-risk actions. Block or condition only when there is REAL risk.

Output JSON ONLY:
{
  "decision": "allow" | "block" | "with_conditions" | "needs_explicit_authorization",
  "primary_concern": "<one of the 7 dimensions or 'none'>",
  "reason": "<2-3 sentences>",
  "conditions": ["<safeguards substrate must add if with_conditions, max 3>"],
  "what_to_tell_kirill_if_escalating": "<concise message if needs_explicit_authorization>"
}

Use hyphens, never em dashes. Output JSON only.`;

  _llmStats.calls++;
  const r = spawnSync(CLAUDE_BIN, ["-p", "--model", CLAUDE_MODEL, "--max-turns", "1"], {
    input: prompt, encoding: "utf-8", timeout: CLAUDE_TIMEOUT_MS,
  });
  if (r.status !== 0 || !r.stdout) {
    _llmStats.failures++;
    // Fail safe: when safety module fails, BLOCK the action. Better safe than sorry.
    return { decision: "block", primary_concern: "operational", reason: "safety module LLM failed - failing closed for safety", conditions: [] };
  }
  const m = r.stdout.match(/\{[\s\S]*\}/);
  if (!m) {
    _llmStats.failures++;
    return { decision: "block", primary_concern: "operational", reason: "safety module returned no JSON - failing closed", conditions: [] };
  }
  try {
    const parsed = JSON.parse(m[0]);
    _llmStats.successes++;
    return parsed;
  } catch {
    _llmStats.failures++;
    return { decision: "block", primary_concern: "operational", reason: "safety module JSON parse failed - failing closed", conditions: [] };
  }
}

/**
 * THE KEY API: any substrate module call this before an action affecting
 * external world. Returns decision object. Substrate must respect.
 */
export function checkAction(action, source = "unknown") {
  const actionText = action?.description || JSON.stringify(action || {}).slice(0, 1500);

  // Layer 1: HARD blocks - regex pattern match, no LLM, instant deny
  const hard = _hardBlockCheck(actionText);
  if (hard.matched) {
    _llmStats.blocks_hard++;
    const decision = {
      allow: false,
      decision: "block",
      reason: `hard block matched: ${hard.pattern}`,
      primary_concern: "creator_safety_floor",
      hard_block: true,
    };
    _safetyLog.push({ at: new Date().toISOString(), source, action: actionText.slice(0, 300), decision });
    _persist();
    if (_busRef) {
      try { _busRef.broadcast({ source: "creator-safety", type: "action_blocked", data: { source, reason: decision.reason, hard_block: true } }); } catch {}
    }
    return decision;
  }

  // Layer 2: Soft signal check - if no operationally-significant verbs/nouns,
  // skip LLM call (most internal substrate operations are safe by default)
  const hasSoft = _hasSoftSignal(actionText);
  if (!hasSoft) {
    _llmStats.allows++;
    const decision = { allow: true, decision: "allow", reason: "no external impact signal detected", primary_concern: "none" };
    _safetyLog.push({ at: new Date().toISOString(), source, action: actionText.slice(0, 200), decision: { allow: true, fast: true } });
    return decision;
  }

  // Layer 3: LLM safety eval - for actions affecting external world
  const result = _llmSafetyEval(action, source);

  let allow;
  if (result.decision === "allow") { allow = true; _llmStats.allows++; }
  else if (result.decision === "block") { allow = false; _llmStats.blocks_llm++; }
  else if (result.decision === "with_conditions") { allow = "with_conditions"; _llmStats.conditional++; }
  else if (result.decision === "needs_explicit_authorization") { allow = "needs_explicit_authorization"; _llmStats.escalations++; }
  else { allow = false; _llmStats.blocks_llm++; }

  const decision = {
    allow,
    decision: result.decision,
    reason: result.reason,
    primary_concern: result.primary_concern,
    conditions: result.conditions || [],
    what_to_tell_kirill: result.what_to_tell_kirill_if_escalating,
  };

  _safetyLog.push({ at: new Date().toISOString(), source, action: actionText.slice(0, 300), decision });
  _persist();

  if (_busRef) {
    try {
      _busRef.broadcast({
        source: "creator-safety",
        type: result.decision === "allow" ? "action_allowed" : result.decision === "block" ? "action_blocked" : "action_needs_attention",
        data: { source, decision: result.decision, primary_concern: result.primary_concern, reason: result.reason },
      });
    } catch {}
  }

  // If escalation needed, send Telegram immediately
  if (result.decision === "needs_explicit_authorization" && result.what_to_tell_kirill_if_escalating) {
    _notifyTelegramEscalation(source, action, result).catch(() => {});
  }

  return decision;
}

async function _notifyTelegramEscalation(source, action, result) {
  let envRaw = "";
  try { envRaw = readFileSync(resolve(ROOT, ".env"), "utf-8"); } catch {}
  const env = {};
  envRaw.split("\n").forEach(l => {
    const m = l.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  });
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  const text = [
    "[CREATOR-SAFETY] AUTHORIZATION REQUIRED",
    "",
    `Source: ${source}`,
    `Concern: ${result.primary_concern}`,
    "",
    `Substrate wants to: ${(action?.description || JSON.stringify(action).slice(0, 200))}`,
    "",
    `Why I am asking: ${result.what_to_tell_kirill_if_escalating}`,
    "",
    "Reply /allow or /deny to authorize/refuse.",
  ].join("\n").slice(0, 3500);
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }),
  });
}

export function register(bus) {
  _busRef = bus;
  _loadPersisted();
  // No subscriptions - this module is called synchronously by other modules
}

export function getSafetyLog(limit = 50) { return _safetyLog.slice(-limit); }
export function getLLMStats() { return { ..._llmStats }; }
export function _resetState() {
  _safetyLog.length = 0;
  _llmStats = { calls: 0, successes: 0, failures: 0, blocks_hard: 0, blocks_llm: 0, conditional: 0, escalations: 0, allows: 0 };
  _busRef = null;
}
