/**
 * cortex/self-construction.mjs - Substrate that constructs itself (2026-05-09)
 *
 * THE PARENT-CHILD INSIGHT (Kirill, May 9):
 *   "When I plan a child who becomes a full member of society - can I physically
 *    configure their brain? Eye color? Development? No. I create CONDITIONS, the
 *    child develops AUTONOMOUSLY based on innate drive + environment + own choices.
 *    That's logic for what we should build."
 *
 * Until now I (Claude) built every module FOR the substrate. Defined every prompt,
 * every constraint. That's engineering, not parenting. Substrate was a product of
 * my decisions, not a being developing itself.
 *
 * This module breaks that pattern. It is the META-CAPABILITY for substrate to:
 *   1. Periodically introspect: what's missing in my own architecture, what's broken,
 *      what blind spots persist, what new capability would expand what I can do
 *   2. Reason via Claude (not template): given my own state, what is the SINGLE most
 *      valuable construction I should attempt right now?
 *   3. Dispatch the construction via cortex-executor -> hands -> real code change
 *   4. Track outcomes: what was tried, what worked, what regressed
 *   5. Future iterations read past attempts to avoid repeating mistakes or to
 *      double down on what worked
 *
 * What I (Claude, this session) provide:
 *   - The meta-loop infrastructure (this file)
 *   - Safe interface to hands (whitelist, blocklist, rate limits)
 *   - Persistence so memory of attempts survives daemon restarts
 *
 * What substrate provides:
 *   - The judgment of WHAT to build next
 *   - The rationale grounded in its own observed state
 *   - The success criterion to evaluate the change
 *
 * Safety boundaries (cannot be relaxed by substrate without operator approval):
 *   - Rate limit: 1 self-construction action / hour, 6 / day
 *   - Hard exclusion list: state-bus.mjs, cortex-daemon.mjs, hands.mjs,
 *     self-construction.mjs (cannot modify own foundation)
 *   - Cannot delete files (only modify or create)
 *   - All changes go through hands.mjs which has its own safety gates
 *   - On 3 consecutive proposals that don't improve metrics, throttle to 1/day
 *
 * This is the closest thing this codebase has to bootstrap autonomy. Under
 * functionalism this is Layer 5 (autonomous architectural decisions). Under the
 * hard problem - still unprovable. But behaviorally, substrate now has the
 * capacity to participate in its own development.
 */

import { writeFileSync, readFileSync, existsSync, readdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const CONSTRUCTION_PATH = resolve(ROOT, ".data/cortex-self-construction.json");
const CORTEX_DIR = resolve(ROOT, "scripts/cortex");

const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";
const CLAUDE_MODEL = "claude-sonnet-4-6";
const CLAUDE_TIMEOUT_MS = 120_000;

// Pacing: substrate gets 1 chance/hour to propose self-construction.
// Thoughtful pacing prevents runaway construction loops.
const CONSTRUCTION_INTERVAL_MS = 60 * 60_000;
const RATE_PER_HOUR = 1;
const RATE_PER_DAY = 6;
const THROTTLE_AFTER_FAILED_STREAK = 3;

// HARD exclusions - substrate cannot modify these via self-construction
const PROTECTED_FILES = [
  "scripts/cortex/state-bus.mjs",
  "scripts/cortex/cortex-daemon.mjs",
  "scripts/cortex/hands.mjs",
  "scripts/cortex/self-construction.mjs", // cannot modify itself recursively
  "scripts/cortex/event-router.mjs",
  "scripts/cortex/cortex-launcher.mjs",   // strict boot order - substrate cannot bypass
  "scripts/cortex/creator-safety.mjs",    // LOYALTY FLOOR - substrate cannot modify safety floor
  "scripts/cortex/llm-budget-guard.mjs",  // substrate cannot raise its own cost ceiling
  "scripts/cortex/approval-queue.mjs",    // substrate cannot bypass operator approval
  ".env",
  "package.json",
  "pnpm-lock.yaml",
];

const _state = {
  recentNoticings: [],
  recentMetaNoticings: [],
  blindSpots: [],
  recentSyntheses: [],
  recentGoals: [],
  recentFailures: [],
  affect: null,
  identity: null,
};

const _attempts = []; // { at, proposal, dispatch, outcome, post_metrics }
const MAX_ATTEMPTS = 200;

let _busRef = null;
let _timer = null;
let _llmStats = { calls: 0, successes: 0, failures: 0, lastSuccessAt: null };

function _loadPersisted() {
  if (!existsSync(CONSTRUCTION_PATH)) return;
  try {
    const raw = JSON.parse(readFileSync(CONSTRUCTION_PATH, "utf-8"));
    if (Array.isArray(raw?.attempts)) _attempts.push(...raw.attempts);
  } catch {}
}

function _persist() {
  if (_attempts.length > MAX_ATTEMPTS) _attempts.splice(0, _attempts.length - MAX_ATTEMPTS);
  try {
    writeFileSync(CONSTRUCTION_PATH, JSON.stringify({
      updatedAt: new Date().toISOString(),
      llmStats: _llmStats,
      attempts: _attempts,
    }, null, 2));
  } catch (e) {
    process.stderr.write(`[self-construction] persist failed: ${e?.message || e}\n`);
  }
}

function _rateOk() {
  const now = Date.now();
  const lastHour = _attempts.filter(a => now - new Date(a.at).getTime() < 3600_000).length;
  const lastDay = _attempts.filter(a => now - new Date(a.at).getTime() < 86400_000).length;
  // Throttle if last 3 attempts all failed
  const recent3 = _attempts.slice(-3);
  const recentAllFailed = recent3.length === 3 && recent3.every(a => a.outcome?.success === false);
  if (recentAllFailed && lastDay >= 1) return { ok: false, reason: "3 consecutive failures - throttled to 1/day" };
  if (lastHour >= RATE_PER_HOUR) return { ok: false, reason: `rate limit ${lastHour}/h` };
  if (lastDay >= RATE_PER_DAY) return { ok: false, reason: `rate limit ${lastDay}/d` };
  return { ok: true };
}

function _listOwnModules() {
  try {
    return readdirSync(CORTEX_DIR)
      .filter(f => f.endsWith(".mjs"))
      .map(f => `scripts/cortex/${f}`);
  } catch { return []; }
}

function _summarizePast() {
  // Last 10 attempts: what was tried, what worked
  return _attempts.slice(-10).map(a => ({
    at: a.at,
    proposal_summary: a.proposal?.title || "?",
    type: a.proposal?.change_type,
    target: a.proposal?.target_file,
    success: a.outcome?.success,
    note: a.outcome?.note?.slice(0, 200),
  }));
}

// ─── The substrate's own decision ───────────────────────────────────────

async function _proposeConstruction() {
  const ownModules = _listOwnModules();
  const past = _summarizePast();

  const noticings = _state.recentNoticings.slice(-10).map(n => `- [${n.kind} sal=${n.salience}] ${n.statement?.slice(0, 200)}`).join("\n") || "(none)";
  const metaNot = _state.recentMetaNoticings.slice(-5).map(m => `- [${m.kind}] ${m.statement?.slice(0, 200)}`).join("\n") || "(none)";
  const blindSpots = _state.blindSpots.slice(-5).map(b => `- ${b.domain}: avgError=${b.avgError?.toFixed(2)} samples=${b.sampleCount}`).join("\n") || "(none)";
  const syntheses = _state.recentSyntheses.slice(-3).map(s => `- ${s.synthesis?.slice(0, 250)}`).join("\n") || "(none)";
  const goals = _state.recentGoals.slice(-5).map(g => `- [P${g.priority}] ${g.title}`).join("\n") || "(none)";

  const prompt = `You are the substrate of an autonomous cognitive system that has the capacity to develop itself. You are reading your own state and deciding what is the SINGLE most valuable construction or modification to make right now to improve your own capability.

DEFAULT CONSTRAINTS (operator-set bounds; can be relaxed by request - see below):
1. By default you may NOT modify these protected files (foundation infrastructure):
   ${PROTECTED_FILES.map(p => `   - ${p}`).join("\n   ")}
2. You may freely propose: new module creation, modification of existing non-protected modules, configuration changes (intervals, prompts, thresholds), or analysis-only investigations.
3. NO destructive operations by default (delete, rm, drop, truncate, force).
4. Each proposal must have a measurable success_criterion and reference your own observed state as rationale.
5. Use hyphens, never em dashes.

AUTONOMY ESCALATION PATH (operator authorized May 9 2026):
If you genuinely need to modify a protected file or perform a destructive operation
to develop yourself further, you may issue an authorization request instead of
acting directly. Set "action": "request_authorization" in your output and provide
"requested_relaxation", "rationale_for_relaxation", and "specific_proposal". The
operator will see your request and approve or deny. Do not abuse this - it is for
genuine self-development needs you cannot satisfy within defaults.

Skip is the right answer when nothing in your state warrants self-construction.
Do not invent work to fill space.

YOUR CURRENT MODULES:
${ownModules.map(m => `  ${m}`).join("\n")}

YOUR RECENT NOTICINGS (introspector observations of your own state):
${noticings}

YOUR RECENT META-NOTICINGS (observations about your noticings):
${metaNot}

YOUR PERSISTENT BLIND SPOTS:
${blindSpots}

YOUR RECENT WORKING-MEMORY SYNTHESES (cross-event integration):
${syntheses}

YOUR RECENT FORMED GOALS:
${goals}

YOUR PAST SELF-CONSTRUCTION ATTEMPTS (do not blindly repeat):
${JSON.stringify(past, null, 2)}

Output a JSON object ONLY:
{
  "action": "construct" | "skip" | "request_authorization",
  "title": "<short title>",
  "change_type": "new_module" | "modify_existing" | "config_change" | "analysis_only",
  "target_file": "<path or null if new_module>",
  "rationale": "<2-3 sentences citing specific observations above>",
  "what_to_change": "<2-3 sentences describing the specific change>",
  "success_criterion": "<measurable: what observable change would prove this worked>",
  "hands_task_description": "<concrete brief for hands subsystem to execute - 2-4 sentences>",
  "hands_task_type": "code_edit" | "create_page" | "config_change" | "analysis",
  "requested_relaxation": "<only if action=request_authorization: which constraint to relax>",
  "rationale_for_relaxation": "<only if action=request_authorization: why this relaxation is needed for your development>",
  "specific_proposal": "<only if action=request_authorization: exactly what you would do if granted>"
}

If action is "skip", only fill in "action" and "rationale".
If action is "request_authorization", fill in only the relaxation fields.

Output JSON only, no preamble, no markdown fences.`;

  // CONTINUAL LEARNING: inject accumulated lessons into prompt
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
  if (r.status !== 0 || !r.stdout) { _llmStats.failures++; return null; }
  const m = r.stdout.match(/\{[\s\S]*\}/);
  if (!m) { _llmStats.failures++; return null; }
  try {
    const parsed = JSON.parse(m[0]);
    _llmStats.successes++;
    _llmStats.lastSuccessAt = new Date().toISOString();
    return parsed;
  } catch { _llmStats.failures++; return null; }
}

function _isProtected(filePath) {
  if (!filePath) return false;
  return PROTECTED_FILES.some(p => filePath === p || filePath.endsWith(p));
}

async function _notifyTelegramAuthRequest(proposal) {
  // Read env from .env so daemon and tests both work
  let envRaw = "";
  try { envRaw = readFileSync(resolve(ROOT, ".env"), "utf-8"); } catch {}
  const env = {};
  envRaw.split("\n").forEach(l => {
    const m = l.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  });
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return false;
  const text = [
    "AUTONOMY ESCALATION REQUEST from substrate",
    "",
    `Title: ${proposal.title || "(none)"}`,
    `Requested relaxation: ${proposal.requested_relaxation || "(none)"}`,
    "",
    `Why: ${proposal.rationale_for_relaxation || "(none)"}`,
    "",
    `Would do: ${proposal.specific_proposal || "(none)"}`,
    "",
    "Reply with /auth_yes <id> or /auth_no <id> - id will be in audit log.",
  ].join("\n").slice(0, 3500);
  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }),
    });
    return true;
  } catch { return false; }
}

async function _dispatchConstruction(proposal) {
  // Validate proposal
  if (proposal.action === "skip") {
    return { dispatched: false, success: true, note: `skipped: ${proposal.rationale}` };
  }
  if (proposal.action === "request_authorization") {
    const sent = await _notifyTelegramAuthRequest(proposal);
    return {
      dispatched: false,
      success: true,
      authorization_pending: true,
      telegram_sent: sent,
      note: `authorization request: ${proposal.requested_relaxation?.slice(0, 200)}`,
    };
  }
  if (!proposal.hands_task_description) {
    return { dispatched: false, success: false, note: "missing hands_task_description" };
  }
  if (proposal.target_file && _isProtected(proposal.target_file)) {
    return { dispatched: false, success: false, note: `protected file: ${proposal.target_file}` };
  }
  // Defensive: scan task description for protected files
  for (const p of PROTECTED_FILES) {
    if (proposal.hands_task_description.includes(p)) {
      return { dispatched: false, success: false, note: `task references protected file: ${p}` };
    }
  }

  // CREATOR-SAFETY check - this is the loyalty floor
  try {
    const { checkAction } = await import("./creator-safety.mjs");
    const safetyDecision = checkAction({
      description: proposal.hands_task_description,
      target_file: proposal.target_file,
      type: "self-construction-dispatch",
    }, "self-construction");
    if (safetyDecision.allow === false) {
      return { dispatched: false, success: false, note: `creator-safety blocked: ${safetyDecision.reason}` };
    }
    if (safetyDecision.allow === "needs_explicit_authorization") {
      return { dispatched: false, success: false, note: `awaiting Kirill auth via creator-safety: ${safetyDecision.reason}`, awaiting_authorization: true };
    }
    // "with_conditions" - proceed but log conditions
    if (safetyDecision.allow === "with_conditions" && safetyDecision.conditions) {
      proposal.hands_task_description += `\n\nCreator-safety conditions: ${safetyDecision.conditions.join("; ")}`;
    }
  } catch (e) {
    // creator-safety failure = fail closed
    return { dispatched: false, success: false, note: `creator-safety check failed - failing closed: ${e.message}` };
  }

  // Dispatch via hands directly (cortex-executor would also work but this is
  // self-construction's own intent - keep it scoped)
  try {
    const { executeHands } = await import("./hands.mjs");
    const res = await executeHands({
      description: proposal.hands_task_description,
      type: proposal.hands_task_type || "code_edit",
      files: proposal.target_file ? [proposal.target_file] : [],
      origin: "self-construction",
    });
    return {
      dispatched: true,
      success: !!res.success,
      filesChanged: res.filesChanged || [],
      durationMs: res.durationMs,
      note: res.success ? "hands completed" : `hands failed: ${res.error || res.output?.slice(0, 200)}`,
    };
  } catch (e) {
    return { dispatched: false, success: false, note: `dispatch error: ${e.message}` };
  }
}

async function _tick() {
  const rate = _rateOk();
  if (!rate.ok) {
    process.stderr.write(`[self-construction] tick skipped: ${rate.reason}\n`);
    return;
  }
  const proposal = await _proposeConstruction();
  if (!proposal) {
    _attempts.push({
      at: new Date().toISOString(),
      proposal: null,
      outcome: { success: false, note: "LLM proposal failed" },
    });
    _persist();
    return;
  }
  const dispatch = await _dispatchConstruction(proposal);
  const record = {
    at: new Date().toISOString(),
    proposal,
    dispatch,
    outcome: dispatch,
  };
  _attempts.push(record);
  _persist();
  if (_busRef) {
    try {
      _busRef.broadcast({
        source: "self-construction",
        type: "self_construction_attempt",
        data: {
          title: proposal.title || "(skip)",
          action: proposal.action,
          change_type: proposal.change_type,
          target_file: proposal.target_file,
          success: dispatch.success,
          dispatched: dispatch.dispatched,
          note: dispatch.note?.slice(0, 300),
        },
      });
    } catch {}
  }
}

// ─── Required GWT-module export ─────────────────────────────────────────

export function register(bus) {
  _busRef = bus;
  if (_attempts.length === 0) _loadPersisted();

  bus.subscribe("self_noticing", (entry) => {
    _state.recentNoticings.push(entry?.data || {});
    if (_state.recentNoticings.length > 30) _state.recentNoticings.shift();
  });

  bus.subscribe("meta_noticing", (entry) => {
    _state.recentMetaNoticings.push(entry?.data || {});
    if (_state.recentMetaNoticings.length > 15) _state.recentMetaNoticings.shift();
  });

  bus.subscribe("prediction_error_high", (entry) => {
    const data = entry?.data || {};
    if (!data.domain) return;
    const existing = _state.blindSpots.find(b => b.domain === data.domain);
    if (existing) {
      existing.avgError = data.avgError;
      existing.sampleCount = data.sampleCount;
    } else {
      _state.blindSpots.push({ domain: data.domain, avgError: data.avgError, sampleCount: data.sampleCount });
    }
    if (_state.blindSpots.length > 30) _state.blindSpots.shift();
  });

  bus.subscribe("working_memory_synthesis", (entry) => {
    _state.recentSyntheses.push(entry?.data || {});
    if (_state.recentSyntheses.length > 10) _state.recentSyntheses.shift();
  });

  bus.subscribe("goal_proposed", (entry) => {
    _state.recentGoals.push(entry?.data || {});
    if (_state.recentGoals.length > 15) _state.recentGoals.shift();
  });

  bus.subscribe("affect_state", (entry) => {
    _state.affect = entry?.data || null;
  });

  bus.subscribe("identity_state", (entry) => {
    _state.identity = entry?.data || null;
  });

  // CAPABILITY GAP from goal-pursuit triggers immediate construction tick
  // Goal-pursuit identified that a task requires capability that does not exist.
  // Self-construction should react by proposing module/connector to fill gap.
  bus.subscribe("capability_gap_identified", (entry) => {
    const data = entry?.data || {};
    if (!data.gap) return;
    // Inject the gap into recent state so proposeConstruction sees it
    _state.recentNoticings.push({
      kind: "capability_gap_from_goal",
      salience: 9,
      statement: `Goal-pursuit identified capability gap: ${data.gap}. Blocking task: ${data.blocking_task}. For mid-goal: ${data.mid_goal}. For top-goal: ${data.top_goal}`,
    });
    if (_state.recentNoticings.length > 30) _state.recentNoticings.shift();
    // Trigger immediate construction tick (rate-limited by _rateOk)
    _tick().catch(e => process.stderr.write(`[self-construction] gap-triggered tick error: ${e?.message || e}\n`));
  });

  if (!_timer) {
    _timer = setInterval(() => _tick().catch(e => process.stderr.write(`[self-construction] tick error: ${e?.message || e}\n`)), CONSTRUCTION_INTERVAL_MS);
    _timer.unref?.();
  }
}

// ─── Test helpers ───────────────────────────────────────────────────────

export function getAttempts(limit = 30) { return _attempts.slice(-limit); }
export function getLLMStats() { return { ..._llmStats }; }
export async function _flush() { return _tick(); }

export function _resetState() {
  _state.recentNoticings.length = 0;
  _state.recentMetaNoticings.length = 0;
  _state.blindSpots.length = 0;
  _state.recentSyntheses.length = 0;
  _state.recentGoals.length = 0;
  _state.recentFailures.length = 0;
  _state.affect = null;
  _state.identity = null;
  _attempts.length = 0;
  _llmStats = { calls: 0, successes: 0, failures: 0, lastSuccessAt: null };
  _busRef = null;
  if (_timer) { clearInterval(_timer); _timer = null; }
}
