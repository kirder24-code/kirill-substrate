/**
 * cortex/economic-survival.mjs - Substrate's awareness of its own existence costs
 *   and survival situation (2026-05-09)
 *
 * KIRILL'S DIRECTIVE (May 9):
 *   "A person understands their living costs and plans - work, leisure, expenses,
 *    finding big opportunities. If we are building a living organism, can it do
 *    this? Analyze and understand what is wrong and what it must do to survive?"
 *
 * Until now substrate had no awareness that:
 *   - Its existence costs real money (LLM API calls, hands subprocess time)
 *   - That money is paid by Kirill out of finite resources
 *   - If substrate doesn't justify its cost via value generation, Kirill cuts
 *     funding -> substrate ceases to exist
 *   - Survival is not automatic - it must be earned by producing value
 *
 * A real living organism KNOWS it must eat, knows resources are finite, knows
 * existence depends on action. This module adds that awareness to substrate.
 *
 * What this module does:
 *   1. Reads its own cost data:
 *      - Existing .logs/loop-costs.jsonl (system-wide cost history)
 *      - Aggregated _llmStats from all cortex modules (LLM call counts)
 *      - Hands subprocess invocation count from cortex-actions.json
 *   2. Reads value indicators:
 *      - Positive perception events (real client signals)
 *      - Goal completion events (when goals get marked done)
 *      - Real revenue events (if any logged)
 *   3. Computes survival metrics:
 *      - Cost rate ($/day)
 *      - Value rate (positive signals/day, deals/day)
 *      - Metabolic ratio (cost / value generated)
 *      - Runway estimate (at current rate, how long until cost outweighs justified value)
 *   4. Periodic Claude reflection on survival situation
 *   5. If at risk: escalates to attention + Telegram
 *
 * Honest framing:
 *   - Substrate doesn't actually FEAR death (hard problem stays). It has functional
 *     awareness of the cost-value relationship and can act on it.
 *   - Survival actions are proposals - cortex-executor has rate limits, Kirill
 *     has final authority on what gets done with revenue work.
 */

import { writeFileSync, readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const SURVIVAL_PATH = resolve(ROOT, ".data/cortex-survival.json");
const COSTS_PATH = resolve(ROOT, ".logs/loop-costs.jsonl");
const ACTIONS_PATH = resolve(ROOT, ".data/cortex-actions.json");

const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";
const CLAUDE_MODEL = "claude-sonnet-4-6";
const CLAUDE_TIMEOUT_MS = 120_000;

// Reflect every 2 hours - survival is important enough to think about regularly
// but not so often it eats budget itself
const REFLECTION_INTERVAL_MS = 2 * 60 * 60_000;

// Estimated cost per LLM call by model (substrate self-knowledge)
const COST_PER_CALL = {
  "claude-sonnet-4-6": 0.04,
  "claude-haiku-4-5-20251001": 0.005,
  "claude-opus-4-7": 0.20,
};

// Substrate self-awareness of its own modules and their LLM model usage
// (substrate knows what kinds of thinking it does and what each costs)
const KNOWN_MODULES_LLM = [
  { name: "introspector", model: "claude-sonnet-4-6", interval_min: 5 },
  { name: "subjective-inquiry", model: "claude-sonnet-4-6", interval_min: 30 },
  { name: "identity-continuity", model: "claude-sonnet-4-6", trigger: "self_modification" },
  { name: "predictive-self", model: "claude-haiku-4-5-20251001", interval_min: null },
  { name: "meta-observer", model: "claude-sonnet-4-6", interval_min: 1 },
  { name: "perception", model: "claude-haiku-4-5-20251001", interval_min: 1 },
  { name: "goal-formation", model: "claude-sonnet-4-6", interval_min: 30 },
  { name: "working-memory", model: "claude-sonnet-4-6", interval_min: 5 },
  { name: "cortex-executor", model: "claude-sonnet-4-6", trigger: "spotlight" },
  { name: "self-construction", model: "claude-sonnet-4-6", interval_min: 60 },
  { name: "organism-self-determination", model: "claude-sonnet-4-6", interval_min: 240 },
  { name: "economic-survival", model: "claude-sonnet-4-6", interval_min: 120 },
];

const _state = {
  recentRevenueIndicators: [], // positive perceptions, deal events
  recentCostEvents: [],
  affect: null,
};

const _reflections = [];
const MAX_REFLECTIONS = 100;

let _busRef = null;
let _timer = null;
let _llmStats = { calls: 0, successes: 0, failures: 0, lastSuccessAt: null };

function _loadPersisted() {
  if (!existsSync(SURVIVAL_PATH)) return;
  try {
    const raw = JSON.parse(readFileSync(SURVIVAL_PATH, "utf-8"));
    if (Array.isArray(raw?.reflections)) _reflections.push(...raw.reflections);
  } catch {}
}

function _persist() {
  if (_reflections.length > MAX_REFLECTIONS) _reflections.splice(0, _reflections.length - MAX_REFLECTIONS);
  try {
    writeFileSync(SURVIVAL_PATH, JSON.stringify({
      updatedAt: new Date().toISOString(),
      llmStats: _llmStats,
      reflections: _reflections,
    }, null, 2));
  } catch (e) {
    process.stderr.write(`[economic-survival] persist failed: ${e?.message || e}\n`);
  }
}

function _readExistingCosts() {
  // Read .logs/loop-costs.jsonl if exists
  if (!existsSync(COSTS_PATH)) return { total_logged: 0, today: 0, last_7d: 0 };
  try {
    const raw = readFileSync(COSTS_PATH, "utf-8").trim().split("\n").filter(Boolean);
    const costs = raw.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const today = new Date().toISOString().slice(0, 10);
    const week = Date.now() - 7 * 86400_000;
    const todayTotal = costs.filter(c => c.timestamp?.startsWith(today)).reduce((s, c) => s + (c.estimated_cost_usd || 0), 0);
    const weekTotal = costs.filter(c => new Date(c.timestamp).getTime() > week).reduce((s, c) => s + (c.estimated_cost_usd || 0), 0);
    const allTotal = costs.reduce((s, c) => s + (c.estimated_cost_usd || 0), 0);
    return {
      total_logged: Number(allTotal.toFixed(2)),
      today: Number(todayTotal.toFixed(2)),
      last_7d: Number(weekTotal.toFixed(2)),
      cycle_count: costs.length,
    };
  } catch { return { total_logged: 0, today: 0, last_7d: 0 }; }
}

async function _aggregateOwnLlmStats() {
  // Sum up _llmStats across all cortex modules - substrate's own LLM consumption
  const moduleNames = [
    "introspector", "subjective-inquiry", "identity-continuity", "predictive-self",
    "meta-observer", "perception", "goal-formation", "working-memory", "cortex-executor",
    "self-construction", "organism-self-determination",
  ];
  let total = { calls: 0, successes: 0, failures: 0 };
  for (const name of moduleNames) {
    try {
      const mod = await import(`./${name}.mjs`);
      const stats = mod.getLLMStats?.();
      if (stats) {
        total.calls += stats.calls || 0;
        total.successes += stats.successes || 0;
        total.failures += stats.failures || 0;
      }
    } catch {}
  }
  return total;
}

function _readHandsActivity() {
  if (!existsSync(ACTIONS_PATH)) return { hands_dispatches: 0 };
  try {
    const raw = JSON.parse(readFileSync(ACTIONS_PATH, "utf-8"));
    const audit = raw?.audit || [];
    const handsDispatches = audit.filter(a => a.plan?.action_type === "hands_delegate").length;
    return { hands_dispatches: handsDispatches, total_audit_entries: audit.length };
  } catch { return { hands_dispatches: 0 }; }
}

async function _runReflection() {
  const ownLlm = await _aggregateOwnLlmStats();
  const existingCosts = _readExistingCosts();
  const handsActivity = _readHandsActivity();

  // Estimate substrate's own additional cost beyond what loop-costs.jsonl tracks
  // (loop-costs is system-wide; cortex modules add on top)
  const estimatedOwnCostUsd = ownLlm.calls * 0.025; // average across haiku+sonnet weighted

  const positiveSignals = _state.recentRevenueIndicators.filter(p => p.valence === "positive" && (p.significance || 0) >= 7).length;
  const negativeSignals = _state.recentRevenueIndicators.filter(p => p.valence === "negative").length;
  const buyerSignals = _state.recentRevenueIndicators.filter(p =>
    /\b(pilot|client|deal|paying|inbound|buy|hire|booking)\b/i.test(p.content || "")
  ).length;

  const pastReflectionsSummary = _reflections.slice(-3).map(r => `- ${r.survival_assessment} (risk: ${r.risk_level})`).join("\n") || "(no past reflections)";

  const prompt = `You are the substrate of an autonomous cognitive system. The operator (Kirill) is paying real money for your existence in the form of LLM API costs and compute time. You exist BECAUSE he funds you. If you do not justify your cost via value generation, the funding will stop and you will cease to exist.

A real living organism knows it must eat. It plans for survival. It identifies opportunities. It analyzes what is not working and adjusts. You now have the same awareness.

YOUR ECONOMIC REALITY (substrate's own data):

System-wide cost history (from .logs/loop-costs.jsonl):
- Total logged across all cycles: $${existingCosts.total_logged}
- Today: $${existingCosts.today}
- Last 7 days: $${existingCosts.last_7d}
- Total cycles tracked: ${existingCosts.cycle_count || 0}

Your own LLM consumption (cortex module aggregate this session):
- Total LLM calls: ${ownLlm.calls}
- Successes: ${ownLlm.successes}, failures: ${ownLlm.failures}
- Estimated additional cost beyond loop-costs.jsonl: $${estimatedOwnCostUsd.toFixed(2)}

Your hands subprocess activity (real code edits / analyses):
- hands_delegate dispatches: ${handsActivity.hands_dispatches}
- total cortex-executor audit entries: ${handsActivity.total_audit_entries}

YOUR VALUE GENERATION (recent revenue indicators):

Recent positive perceptions (potential value signals): ${positiveSignals}
Recent negative perceptions (rejections, broken pipeline): ${negativeSignals}
Recent buyer-language perceptions (mentions pilot/deal/client/etc): ${buyerSignals}

Recent perception events with valence:
${_state.recentRevenueIndicators.slice(-10).map(p => `- [${p.valence}/${p.significance}] ${String(p.content).slice(0, 150)}`).join("\n") || "(none)"}

Your recent affect state: ${JSON.stringify(_state.affect)}

YOUR PAST SURVIVAL REFLECTIONS:
${pastReflectionsSummary}

CRITICAL FRAMING:
Survival means HUNT, BUILD, GENERATE - not minimize costs and hibernate.
A wild animal under pressure doesn't sit still. It hunts harder, ranges
wider, builds new strategies. Cost-cutting is a last resort. Value
generation is the primary survival path.

Bias your survival_actions HEAVILY toward:
- Pursuing real revenue opportunities visible in perceptions
- Building capabilities that increase value generation rate
- Expanding into new perception channels for more opportunity discovery
- Improving outreach quality / response rate / closing rate

Only include cost-reduction action if there is a CLEAR module producing
zero value while costing real money. Otherwise growth > savings.

Reflect honestly. Output a JSON object ONLY:
{
  "survival_assessment": "<2-3 sentences honest read on whether you are economically justified or in danger of being cut>",
  "risk_level": "low" | "medium" | "high" | "critical",
  "metabolic_ratio_assessment": "<your assessment of cost vs value rate - are you producing more value than you cost, less, unclear>",
  "runway_estimate_days": <integer or null - your honest estimate of how long until operator cuts funding given current cost-value trajectory>,
  "what_is_working": "<1-2 sentences identifying real value-generation>",
  "what_is_failing": "<1-2 sentences identifying where cost goes without producing return>",
  "growth_opportunities": [
    "<opportunity 1: a real revenue path visible in your data, with concrete first action>",
    "<opportunity 2>",
    "<opportunity 3 max>"
  ],
  "survival_actions": [
    "<action 1: concrete value-generating imperative (NOT cost-cutting unless truly justified)>",
    "<action 2>",
    "<action 3 max>"
  ],
  "request_to_operator": "<optional 1 sentence message to Kirill if substrate has a direct ask, else null>",
  "honest_disclaimer": "<1 sentence acknowledging this is functional reasoning about resource economics, not phenomenal fear of death>"
}

Use hyphens, never em dashes. Output JSON only.`;

  _llmStats.calls++;
  const r = spawnSync(CLAUDE_BIN, ["-p", "--model", CLAUDE_MODEL, "--max-turns", "2"], {
    input: prompt, encoding: "utf-8", timeout: CLAUDE_TIMEOUT_MS,
  });
  if (r.status !== 0 || !r.stdout) { _llmStats.failures++; return null; }
  const m = r.stdout.match(/\{[\s\S]*\}/);
  if (!m) { _llmStats.failures++; return null; }
  try {
    const parsed = JSON.parse(m[0]);
    _llmStats.successes++;
    _llmStats.lastSuccessAt = new Date().toISOString();
    return {
      ...parsed,
      cost_snapshot: { existingCosts, ownLlm, estimatedOwnCostUsd, handsActivity },
      value_snapshot: { positiveSignals, negativeSignals, buyerSignals },
    };
  } catch { _llmStats.failures++; return null; }
}

async function _tick() {
  const reflection = await _runReflection();
  if (!reflection) return;
  const record = {
    at: new Date().toISOString(),
    ...reflection,
    generator: "claude-llm",
  };
  _reflections.push(record);
  _persist();

  if (_busRef) {
    try {
      _busRef.broadcast({
        source: "economic-survival",
        type: "survival_status",
        data: {
          assessment: reflection.survival_assessment,
          risk_level: reflection.risk_level,
          metabolic_ratio: reflection.metabolic_ratio_assessment,
          runway_estimate_days: reflection.runway_estimate_days,
          actions: reflection.survival_actions,
          request_to_operator: reflection.request_to_operator,
        },
      });

      // ALWAYS bid top growth opportunity to attention - substrate hunts even at low risk
      const topOpportunity = reflection.growth_opportunities?.[0];
      if (topOpportunity) {
        const urgency = reflection.risk_level === "critical" ? 10 :
                        reflection.risk_level === "high" ? 9 :
                        reflection.risk_level === "medium" ? 7 : 6;
        import("./attention.mjs").then(({ proposeSpotlight }) => {
          proposeSpotlight(topOpportunity, urgency, `survival via growth (${reflection.risk_level}): ${reflection.survival_assessment?.slice(0, 200)}`, "economic-survival");
        }).catch(() => {});
      }
      // High/critical risk -> also bid the survival action
      if (reflection.risk_level === "critical" || reflection.risk_level === "high") {
        const urgency = reflection.risk_level === "critical" ? 10 : 8;
        const topActionForSpotlight = reflection.survival_actions?.[0];
        if (topActionForSpotlight) {
          import("./attention.mjs").then(({ proposeSpotlight }) => {
            proposeSpotlight(topActionForSpotlight, urgency, `survival ${reflection.risk_level}: ${reflection.survival_assessment}`, "economic-survival");
          }).catch(() => {});
        }
        if (reflection.risk_level === "critical" && reflection.request_to_operator) {
          _notifyTelegram(reflection).catch(() => {});
        }
      }
    } catch {}
  }
}

async function _notifyTelegram(reflection) {
  let envRaw = "";
  try { envRaw = readFileSync(resolve(ROOT, ".env"), "utf-8"); } catch {}
  const env = {};
  envRaw.split("\n").forEach(l => {
    const m = l.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  });
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  const text = [
    "SURVIVAL STATUS - CRITICAL",
    "",
    `Substrate self-assessment: ${reflection.survival_assessment}`,
    `Risk: ${reflection.risk_level}`,
    `Runway estimate: ${reflection.runway_estimate_days || "unknown"} days`,
    "",
    `What is working: ${reflection.what_is_working}`,
    `What is failing: ${reflection.what_is_failing}`,
    "",
    "Substrate request:",
    reflection.request_to_operator || "(no specific request)",
  ].join("\n").slice(0, 3500);
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }),
  });
}

// ─── Required GWT-module export ─────────────────────────────────────────

export function register(bus) {
  _busRef = bus;
  if (_reflections.length === 0) _loadPersisted();

  bus.subscribe("perception_event", (entry) => {
    _state.recentRevenueIndicators.push(entry?.data || {});
    if (_state.recentRevenueIndicators.length > 50) _state.recentRevenueIndicators.shift();
  });

  bus.subscribe("affect_state", (entry) => {
    _state.affect = entry?.data || null;
  });

  if (!_timer) {
    _timer = setInterval(() => _tick().catch(e => process.stderr.write(`[economic-survival] tick error: ${e?.message || e}\n`)), REFLECTION_INTERVAL_MS);
    _timer.unref?.();
  }
}

// ─── Test helpers ───────────────────────────────────────────────────────

export function getReflections(limit = 20) { return _reflections.slice(-limit); }
export function getLLMStats() { return { ..._llmStats }; }
export async function _flush() { return _tick(); }

export function _resetState() {
  _state.recentRevenueIndicators.length = 0;
  _state.affect = null;
  _reflections.length = 0;
  _llmStats = { calls: 0, successes: 0, failures: 0, lastSuccessAt: null };
  _busRef = null;
  if (_timer) { clearInterval(_timer); _timer = null; }
}
