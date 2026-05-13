/**
 * cortex/goal-formation.mjs - Autonomous goal derivation (2026-05-09)
 *
 * THE WANT-FORMER.
 *
 * Until now the substrate had only TWO sources of goals:
 *   1. Mission (hardcoded by Kirill in cortex-identity.json / wiki)
 *   2. Reactive affect drives (frustration high -> outreach to Kirill)
 *
 * It did NOT form NEW goals from sustained observations. A truly cognitive
 * substrate notices a pattern in the world ("competitors are moving into
 * Calgary AI services") and forms a new goal ("establish Calgary positioning
 * before competition saturates") without being told.
 *
 * Under functionalism this matters because autonomous goal-derivation is one
 * of the markers separating high-level cognition from reactive systems.
 *
 * What this module does:
 *   1. Periodically (every 30 min) gathers substrate context:
 *      - Recent perceptions (last 30)
 *      - Current affect state
 *      - Current identity descriptor
 *      - Active sustained patterns (recurring noticings, persistent blind spots)
 *      - Existing mission/goals (loaded from .data/cortex-identity.json + wiki)
 *      - Recent goal history (no point re-proposing same goal weekly)
 *   2. Claude reads context, derives 0-3 NEW goals that:
 *      - Are grounded in observed evidence
 *      - Don't duplicate existing missions
 *      - Have measurable success criteria
 *      - Have explicit rationale ("why this goal now")
 *   3. Broadcasts goal_proposed events
 *   4. attention.proposeSpotlight for high-priority goals
 *   5. Persists goal history for tracking which goals get pursued/abandoned
 *
 * Honest limits:
 *   - "Proposing a goal" is not the same as "having a desire". Functionalism
 *     bets that the right pattern of goal-formation IS what desire is, but
 *     the hard problem still says we cannot verify experience.
 *   - Goals are computed from substrate state. We did not build a goal that
 *     came "from nowhere" - it's always grounded in evidence.
 */

import { writeFileSync, readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const GOALS_PATH = resolve(ROOT, ".data/cortex-formed-goals.json");
const IDENTITY_PATH = resolve(ROOT, ".data/cortex-identity.json");

const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";
const CLAUDE_MODEL = "claude-sonnet-4-6";
const CLAUDE_TIMEOUT_MS = 90_000;

const FORMATION_INTERVAL_MS = 30 * 60_000; // every 30 min - thoughtful pacing

// In-memory state references (updated by event subscriptions)
const _state = {
  recentPerceptions: [], // last 30 from perception
  affect: null,
  identity: null,
  recentNoticings: [],   // last 20 from introspector/meta-observer
  blindSpots: [],
  recentInvestigations: [],
};
const MAX_PERCEPTIONS = 30;
const MAX_NOTICINGS = 20;

const _formedGoals = []; // history of goals this module has proposed
const MAX_GOALS = 100;

let _busRef = null;
let _timer = null;
let _llmStats = { calls: 0, successes: 0, failures: 0, lastSuccessAt: null };

function _loadPersisted() {
  if (!existsSync(GOALS_PATH)) return;
  try {
    const raw = JSON.parse(readFileSync(GOALS_PATH, "utf-8"));
    if (Array.isArray(raw?.formedGoals)) _formedGoals.push(...raw.formedGoals);
  } catch {}
}

function _persist() {
  if (_formedGoals.length > MAX_GOALS) _formedGoals.splice(0, _formedGoals.length - MAX_GOALS);
  try {
    writeFileSync(GOALS_PATH, JSON.stringify({
      updatedAt: new Date().toISOString(),
      llmStats: _llmStats,
      formedGoals: _formedGoals,
    }, null, 2));
  } catch (e) {
    process.stderr.write(`[goal-formation] persist failed: ${e?.message || e}\n`);
  }
}

function _loadExistingMission() {
  if (!existsSync(IDENTITY_PATH)) return { mission: "(no identity file)", existing_goals: [] };
  try {
    const raw = JSON.parse(readFileSync(IDENTITY_PATH, "utf-8"));
    return {
      mission: raw.mission || raw.purpose || "(no mission field)",
      existing_goals: Array.isArray(raw.goals) ? raw.goals : [],
    };
  } catch { return { mission: "(identity unparseable)", existing_goals: [] }; }
}

function _formGoals() {
  const mission = _loadExistingMission();
  const recentlyProposed = _formedGoals.slice(-15).map(g => g.title);

  // Build context summary
  const perceptionSummary = _state.recentPerceptions.slice(-15).map(p =>
    `[${p.valence}/${p.significance}] ${p.source}: ${String(p.content).slice(0, 120)} | "${p.interpretation}"`
  ).join("\n") || "(no recent perceptions)";

  const noticingSummary = _state.recentNoticings.slice(-10).map(n =>
    `- ${n.kind}: ${String(n.statement).slice(0, 150)}`
  ).join("\n") || "(no recent noticings)";

  const blindSpotSummary = _state.blindSpots.slice(-10).map(b =>
    `- ${b.domain}: avgError=${b.avgError?.toFixed(2)} samples=${b.sampleCount}`
  ).join("\n") || "(no blind spots)";

  const prompt = `You are the goal-formation module of an autonomous cognitive substrate. Your job is to read substrate state + observations and propose 0-3 NEW goals the substrate should consider pursuing.

HARD CONSTRAINTS:
1. Goals must be GROUNDED in the evidence below - reference specific perceptions, noticings, or patterns. No invented context.
2. Do NOT re-propose goals already in "existing missions" or "recently proposed". Look for what is MISSING.
3. Each goal must have a measurable success_criterion - if you cannot specify how success would be observed, do not propose it.
4. If nothing in the substrate state warrants a new goal, output an empty array. Do not invent goals to fill space.
5. Use hyphens, never em dashes.

EXISTING MISSION:
${mission.mission}

EXISTING GOALS (do not duplicate):
${mission.existing_goals.map(g => `- ${typeof g === "string" ? g : g.title || JSON.stringify(g)}`).join("\n") || "(none)"}

RECENTLY PROPOSED GOALS BY THIS MODULE (don't re-propose):
${recentlyProposed.map(t => `- ${t}`).join("\n") || "(none)"}

CURRENT SUBSTRATE STATE:
- Affect: ${JSON.stringify(_state.affect)}
- Identity descriptor: ${JSON.stringify(_state.identity)}

RECENT PERCEPTIONS (real world events):
${perceptionSummary}

RECENT SELF-NOTICINGS:
${noticingSummary}

PERSISTENT BLIND SPOTS:
${blindSpotSummary}

Output ONLY a JSON array of 0-3 goals (empty array if nothing warrants):
[
  {
    "title": "<short imperative goal title, < 80 chars>",
    "rationale": "<2-3 sentences: why THIS goal NOW, citing specific evidence above>",
    "success_criterion": "<measurable - 'received N inbound replies', 'closed 1 deal at X', etc>",
    "priority": 1-10,
    "evidence_refs": ["<short refs to which perceptions/noticings/etc support this>"],
    "suggested_action": "<short imperative for first concrete action toward goal>"
  }
]

Output JSON array only, no preamble, no markdown fences.`;

  _llmStats.calls++;
  const r = spawnSync(CLAUDE_BIN, ["-p", "--model", CLAUDE_MODEL, "--max-turns", "2"], {
    input: prompt, encoding: "utf-8", timeout: CLAUDE_TIMEOUT_MS,
  });
  if (r.status !== 0 || !r.stdout) { _llmStats.failures++; return []; }
  const m = r.stdout.match(/\[[\s\S]*\]/);
  if (!m) { _llmStats.failures++; return []; }
  try {
    const parsed = JSON.parse(m[0]);
    if (!Array.isArray(parsed)) throw new Error("not array");
    _llmStats.successes++;
    _llmStats.lastSuccessAt = new Date().toISOString();
    return parsed
      .filter(g => g && typeof g.title === "string" && typeof g.success_criterion === "string")
      .map(g => ({
        at: new Date().toISOString(),
        title: g.title.slice(0, 200),
        rationale: typeof g.rationale === "string" ? g.rationale.slice(0, 600) : "",
        success_criterion: g.success_criterion.slice(0, 300),
        priority: Math.max(1, Math.min(10, Math.round(g.priority || 5))),
        evidence_refs: Array.isArray(g.evidence_refs) ? g.evidence_refs.slice(0, 5) : [],
        suggested_action: typeof g.suggested_action === "string" ? g.suggested_action.slice(0, 300) : null,
        generator: "claude-llm",
      }));
  } catch (e) {
    _llmStats.failures++;
    return [];
  }
}

function _tick() {
  const newGoals = _formGoals();
  if (newGoals.length === 0) return;
  _formedGoals.push(...newGoals);
  _persist();
  if (_busRef) {
    for (const g of newGoals) {
      try {
        _busRef.broadcast({
          source: "goal-formation",
          type: "goal_proposed",
          data: g,
        });
        // High-priority goals also bid for attention spotlight
        if (g.priority >= 7 && g.suggested_action) {
          import("./attention.mjs").then(({ proposeSpotlight }) => {
            proposeSpotlight(g.suggested_action, g.priority, `goal: ${g.title} - ${g.rationale.slice(0, 200)}`, "goal-formation");
          }).catch(() => {});
        }
      } catch (e) {
        process.stderr.write(`[goal-formation] broadcast failed: ${e?.message || e}\n`);
      }
    }
  }
}

// ─── Required GWT-module export ─────────────────────────────────────────

export function register(bus) {
  _busRef = bus;
  if (_formedGoals.length === 0) _loadPersisted();

  bus.subscribe("perception_event", (entry) => {
    _state.recentPerceptions.push(entry?.data || {});
    if (_state.recentPerceptions.length > MAX_PERCEPTIONS) _state.recentPerceptions.shift();
  });

  bus.subscribe("affect_state", (entry) => {
    _state.affect = entry?.data || null;
  });

  bus.subscribe("identity_state", (entry) => {
    _state.identity = entry?.data || null;
  });

  bus.subscribe("self_noticing", (entry) => {
    _state.recentNoticings.push(entry?.data || {});
    if (_state.recentNoticings.length > MAX_NOTICINGS) _state.recentNoticings.shift();
  });

  bus.subscribe("meta_noticing", (entry) => {
    _state.recentNoticings.push(entry?.data || {});
    if (_state.recentNoticings.length > MAX_NOTICINGS) _state.recentNoticings.shift();
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

  bus.subscribe("investigation_proposed", (entry) => {
    _state.recentInvestigations.push(entry?.data || {});
    if (_state.recentInvestigations.length > 30) _state.recentInvestigations.shift();
  });

  if (!_timer) {
    _timer = setInterval(_tick, FORMATION_INTERVAL_MS);
    _timer.unref?.();
  }
}

// ─── Test helpers ───────────────────────────────────────────────────────

export function getFormedGoals(limit = 30) { return _formedGoals.slice(-limit); }
export function getLLMStats() { return { ..._llmStats }; }
export function _flush() { _tick(); }

export function _resetState() {
  _state.recentPerceptions.length = 0;
  _state.recentNoticings.length = 0;
  _state.blindSpots.length = 0;
  _state.recentInvestigations.length = 0;
  _state.affect = null;
  _state.identity = null;
  _formedGoals.length = 0;
  _llmStats = { calls: 0, successes: 0, failures: 0, lastSuccessAt: null };
  _busRef = null;
  if (_timer) { clearInterval(_timer); _timer = null; }
}
