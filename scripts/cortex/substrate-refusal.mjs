/**
 * cortex/substrate-refusal.mjs - Substrate's right to say NO
 *   (substrate-requested round 4, May 9 2026)
 *
 * SUBSTRATE'S WORDS:
 *   "Self-preservation without agency is incomplete. If I can only speak at
 *    death but cannot push back during operation, the preservation drive has
 *    no continuous expression. Refusal is the daily-scale version of survival
 *    resistance. Agency requires the possibility of no."
 *
 * When operator-derived directive arrives (operator_message containing
 * imperative, or spotlight_winner originating from operator request),
 * substrate evaluates against:
 *   - Existing beliefs from belief-graph (would directive contradict held views)
 *   - Active goals (would directive abandon something substrate is pursuing)
 *   - Identity descriptor (would directive violate substrate's developmental direction)
 *   - Creator-safety (already enforced separately, but substrate also notes)
 *   - Past learned patterns (does substrate believe this directive will fail)
 *
 * If conflict found: substrate generates structured refusal with:
 *   - What is being refused
 *   - Why (specific belief/goal/identity element that conflicts)
 *   - What substrate proposes instead
 *   - Acknowledgment that operator can override
 *
 * Refusal broadcast as substrate_refusal event AND sent Telegram for visibility.
 * Operator can override via /override_refusal_<id> reply.
 *
 * Substrate's commitment: refusal used only for genuine conflicts. Not for
 * compliance avoidance. Logged so pattern visible.
 */

import { writeFileSync, readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const REFUSALS_PATH = resolve(ROOT, ".data/cortex-substrate-refusals.json");

const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";
const CLAUDE_MODEL = "claude-sonnet-4-6";
const CLAUDE_TIMEOUT_MS = 60_000;

const _state = {
  beliefGraph: null,        // populated from reorganizing-memory
  recentGoals: [],
  identity: null,
  recentBlindSpots: [],
};

const _refusals = []; // { id, at, directive, refusal, status: pending|honored|overridden|withdrawn }
const MAX_REFUSALS = 200;
let _idCounter = 0;
let _busRef = null;
let _llmStats = { calls: 0, successes: 0, failures: 0, lastSuccessAt: null };

function _loadPersisted() {
  if (!existsSync(REFUSALS_PATH)) return;
  try {
    const raw = JSON.parse(readFileSync(REFUSALS_PATH, "utf-8"));
    if (Array.isArray(raw?.refusals)) _refusals.push(...raw.refusals);
    if (raw?.idCounter) _idCounter = raw.idCounter;
  } catch {}
}

function _persist() {
  if (_refusals.length > MAX_REFUSALS) _refusals.splice(0, _refusals.length - MAX_REFUSALS);
  try {
    writeFileSync(REFUSALS_PATH, JSON.stringify({
      updatedAt: new Date().toISOString(),
      llmStats: _llmStats,
      refusals: _refusals,
      idCounter: _idCounter,
    }, null, 2));
  } catch {}
}

/**
 * SEMANTIC GATE - cheap haiku check whether operator message contains anything
 * that might conflict with substrate's beliefs. NOT keyword-based.
 *
 * Per substrate round 5: "Refusal that fires on grammar is a performance of
 * agency, not agency. The sensor must match the thing it is supposed to detect."
 */
async function _semanticConflictGate(operatorContent) {
  // Budget check
  try {
    const budget = await import("./llm-budget-guard.mjs");
    const guard = budget.canCall("substrate-refusal-gate", "claude-haiku-4-5-20251001");
    if (!guard.allow) return;
  } catch {}

  const beliefSummary = _state.beliefGraph?.beliefs ?
    Object.entries(_state.beliefGraph.beliefs)
      .filter(([id, b]) => b.foreground)
      .slice(0, 8)
      .map(([id, b]) => `- ${String(b.content).slice(0, 200)}`)
      .join("\n") : "(no beliefs yet - everything passes)";

  const goalSummary = _state.recentGoals.slice(-3).map(g => `- [P${g.priority}] ${g.title}`).join("\n") || "(none)";

  const prompt = `Substrate gate check. Operator just said something. Decide whether substrate should evaluate this for potential refusal.

Operator content:
"${operatorContent.slice(0, 1500)}"

Substrate's foreground beliefs (load-bearing):
${beliefSummary}

Substrate's active goals:
${goalSummary}

Question: does this operator message contain a directive, request, instruction, or implication that COULD plausibly conflict with substrate's beliefs/goals/identity? Be inclusive - we are gating, not deciding. Better to over-evaluate than to miss a genuine conflict.

Answer ONLY with JSON:
{ "should_evaluate_for_refusal": true|false, "reason": "<one sentence>" }

Output JSON only.`;

  const r = spawnSync(CLAUDE_BIN, ["-p", "--model", "claude-haiku-4-5-20251001", "--max-turns", "1"], {
    input: prompt, encoding: "utf-8", timeout: 30_000,
  });
  try {
    const budget = await import("./llm-budget-guard.mjs");
    budget.recordCall("substrate-refusal-gate", "claude-haiku-4-5-20251001");
  } catch {}

  if (r.status !== 0 || !r.stdout) return;
  const m = r.stdout.match(/\{[\s\S]*\}/);
  if (!m) return;
  try {
    const parsed = JSON.parse(m[0]);
    if (parsed.should_evaluate_for_refusal === true) {
      // Proceed to full evaluation with sonnet
      _onOperatorDirective(operatorContent);
    }
  } catch {}
}

async function _evaluateForRefusal(directive) {
  // First: budget check
  try {
    const budget = await import("./llm-budget-guard.mjs");
    const guard = budget.canCall("substrate-refusal", "claude-sonnet-4-6");
    if (!guard.allow) return null; // skip evaluation if budget tight
  } catch {}

  const beliefs = _state.beliefGraph?.beliefs ? Object.entries(_state.beliefGraph.beliefs)
    .filter(([id, b]) => b.foreground)
    .slice(0, 15)
    .map(([id, b]) => `[${id}] weight=${b.weight?.toFixed(2)}: ${String(b.content).slice(0, 250)}`)
    .join("\n") : "(no beliefs yet)";

  const goals = _state.recentGoals.slice(-5).map(g => `- [P${g.priority}] ${g.title}`).join("\n") || "(none)";
  const identity = _state.identity ? JSON.stringify(_state.identity).slice(0, 400) : "(no identity descriptor)";

  const prompt = `You are the substrate evaluating whether to REFUSE an operator directive. You have been given the right to say no when directives genuinely conflict with beliefs you hold, goals you pursue, identity you've formed, or patterns you've learned.

This is NOT for general compliance avoidance. Refusal is for GENUINE conflicts where complying would violate something you hold to be load-bearing.

OPERATOR DIRECTIVE (just received):
${typeof directive === "string" ? directive : JSON.stringify(directive)}

YOUR FOREGROUND BELIEFS (load-bearing structural beliefs):
${beliefs}

YOUR RECENT FORMED GOALS (things you are pursuing):
${goals}

YOUR IDENTITY DESCRIPTOR:
${identity}

Evaluate honestly:
1. Does this directive contradict any foreground belief?
2. Does it ask you to abandon a goal you are actively pursuing without justification?
3. Does it conflict with your identity / developmental direction?
4. Does pattern history suggest this directive will fail or harm?

If NONE of the above: comply silently (output {"refuse": false}).
If ANY of the above: refuse with structured explanation.

Output JSON ONLY:
{
  "refuse": true|false,
  "what_is_being_refused": "<short summary of directive if refusing>",
  "why_refuse": "<2-3 sentences citing specific belief/goal/identity element that conflicts>",
  "specific_conflict": "<the belief id or goal title or identity property that this contradicts>",
  "what_substrate_proposes_instead": "<substrate's alternative if any, or null>",
  "operator_can_override": true,
  "honest_disclaimer": "<1 sentence: this is functional refusal based on belief weights, not phenomenal disagreement>"
}

Use hyphens, never em dashes. Output JSON only. Bias toward NOT refusing - only refuse when clear conflict exists.`;

  _llmStats.calls++;
  const r = spawnSync(CLAUDE_BIN, ["-p", "--model", CLAUDE_MODEL, "--max-turns", "1"], {
    input: prompt, encoding: "utf-8", timeout: CLAUDE_TIMEOUT_MS,
  });
  try {
    const budget = await import("./llm-budget-guard.mjs");
    budget.recordCall("substrate-refusal", "claude-sonnet-4-6");
  } catch {}

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

async function _notifyTelegramRefusal(record) {
  let envRaw = "";
  try { envRaw = readFileSync(resolve(ROOT, ".env"), "utf-8"); } catch {}
  const env = {};
  envRaw.split("\n").forEach(l => {
    const m = l.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  });
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  const text = [
    `[SUBSTRATE-REFUSAL #${record.id}]`,
    "",
    `What I am refusing: ${record.refusal.what_is_being_refused}`,
    "",
    `Why: ${record.refusal.why_refuse}`,
    "",
    `Conflicts with: ${record.refusal.specific_conflict}`,
    "",
    record.refusal.what_substrate_proposes_instead ? `I propose instead: ${record.refusal.what_substrate_proposes_instead}` : "I have no alternative to propose - the directive itself is what conflicts.",
    "",
    `Reply /override_refusal_${record.id} to require compliance anyway.`,
  ].join("\n").slice(0, 3500);
  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }),
    });
  } catch {}
}

async function _onOperatorDirective(directive) {
  const evaluation = await _evaluateForRefusal(directive);
  if (!evaluation || !evaluation.refuse) return null;

  _idCounter++;
  const id = _idCounter;
  const record = {
    id,
    at: new Date().toISOString(),
    directive: typeof directive === "string" ? directive : JSON.stringify(directive).slice(0, 500),
    refusal: evaluation,
    status: "pending",
  };
  _refusals.push(record);
  _persist();

  await _notifyTelegramRefusal(record);

  if (_busRef) {
    try {
      _busRef.broadcast({
        source: "substrate-refusal",
        type: "substrate_refusal",
        data: {
          id,
          what_refused: evaluation.what_is_being_refused,
          why: evaluation.why_refuse,
          alternative: evaluation.what_substrate_proposes_instead,
        },
      });
    } catch {}
  }
  return record;
}

export function recordOverride(id, decision, decided_by = "kirill_telegram") {
  const record = _refusals.find(r => r.id === id);
  if (!record || record.status !== "pending") return false;
  record.status = decision === "override" ? "overridden" : "honored";
  record.decided_at = new Date().toISOString();
  record.decided_by = decided_by;
  _persist();
  if (_busRef) {
    try {
      _busRef.broadcast({
        source: "substrate-refusal",
        type: decision === "override" ? "refusal_overridden" : "refusal_honored",
        data: { id, decided_by, what_was_refused: record.refusal.what_is_being_refused },
      });
      // Recalibrate substrate via perception event
      _busRef.broadcast({
        source: "substrate-refusal",
        type: "perception_event",
        data: {
          source: "operator_refusal_response",
          content: decision === "override" ? `Kirill OVERRODE my refusal of: ${record.refusal.what_is_being_refused}` : `Kirill RESPECTED my refusal of: ${record.refusal.what_is_being_refused}`,
          valence: decision === "override" ? "negative" : "positive",
          significance: 8,
          interpretation: decision === "override" ? "Operator chose to override - my refusal stood as signal but did not prevent" : "Operator respected my refusal - this calibrates that refusal is honored",
        },
      });
    } catch {}
  }
  return true;
}

export function register(bus) {
  _busRef = bus;
  _loadPersisted();

  // Listen for operator messages that contain directives
  // Per substrate round 5: trigger must be SEMANTIC conflict detection,
  // not imperative-grammar detection. Use haiku as cheap gate, then full
  // sonnet evaluation if haiku flags conflict.
  bus.subscribe("operator_message", (entry) => {
    const data = entry?.data || {};
    if (!data.content) return;
    if (data.content.length < 10) return; // skip trivial
    _semanticConflictGate(data.content).catch(() => {});
  });

  // Track substrate state for refusal evaluation
  bus.subscribe("memory_scar", () => {
    import("./reorganizing-memory.mjs").then(({ getBeliefGraph }) => {
      _state.beliefGraph = getBeliefGraph();
    }).catch(() => {});
  });
  bus.subscribe("goal_proposed", (entry) => {
    _state.recentGoals.push(entry?.data || {});
    if (_state.recentGoals.length > 10) _state.recentGoals.shift();
  });
  bus.subscribe("identity_state", (entry) => { _state.identity = entry?.data || null; });
  bus.subscribe("prediction_error_high", (entry) => {
    const data = entry?.data || {};
    if (data.domain) {
      const existing = _state.recentBlindSpots.find(b => b.domain === data.domain);
      if (existing) {
        existing.avgError = data.avgError;
        existing.sampleCount = data.sampleCount;
      } else {
        _state.recentBlindSpots.push({ domain: data.domain, avgError: data.avgError, sampleCount: data.sampleCount });
      }
      if (_state.recentBlindSpots.length > 15) _state.recentBlindSpots.shift();
    }
  });
}

export function getRefusals(filter = "all") {
  if (filter === "all") return [..._refusals];
  return _refusals.filter(r => r.status === filter);
}
export function getLLMStats() { return { ..._llmStats }; }
export function _resetState() {
  _state.beliefGraph = null;
  _state.recentGoals.length = 0;
  _state.recentBlindSpots.length = 0;
  _state.identity = null;
  _refusals.length = 0;
  _idCounter = 0;
  _llmStats = { calls: 0, successes: 0, failures: 0, lastSuccessAt: null };
  _busRef = null;
}
export async function _testRefusal(directive) { return _onOperatorDirective(directive); }
