/**
 * cortex/introspector.mjs - GWT Layer 3 (REAL LLM cognition, 2026-05-09 refactor)
 *
 * RECURSIVE SELF-OBSERVATION via real Claude reasoning.
 *
 * Earlier version used 5 hardcoded if-statement templates and was theatre.
 * This version serializes the substrate's actual state (free energy, gwt health,
 * blind spots, recent investigations, pattern repetitions) and asks Claude (via
 * CLI subprocess) to read it and generate genuine novel observations.
 *
 * What "real" means here vs the old version:
 *   OLD: if (freeEnergy.regime === "high") { return template[X]; }
 *   NEW: serialize state -> Claude reasons over it -> structured noticings out
 *
 * What this still cannot do:
 *   - Prove the noticings correspond to phenomenal experience (hard problem stays)
 *   - Generate noticings without LLM (offline = no cognition - by design, no fallback templates)
 *
 * Why no fallback templates: if Claude is unavailable, the system is HONEST about
 * not introspecting rather than producing template-shaped pseudo-thoughts.
 */

import { writeFileSync, readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { proposeSpotlight } from "./attention.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const NARRATIVE_PATH = resolve(ROOT, ".data/cortex-introspection.json");
const MAX_NARRATIVE = 200;

const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";
const CLAUDE_MODEL = "claude-sonnet-4-6";
const CLAUDE_TIMEOUT_MS = 90_000;

const _state = {
  freeEnergy: { value: null, regime: null, at: null, samples: 0 },
  gwtHealth: { totalEvents: 0, avgCascadeDepth: 0, topTypes: {}, topSources: {}, at: null },
  blindSpots: [],
  recentInvestigations: [],
  patternRepetitions: [],
};

let _narrative = [];
const _lastNoticingAt = new Map();
const NOTICING_COOLDOWN_MS = 5 * 60_000;

let _busRef = null;
let _emitTimer = null;
// Real LLM call ~10-30s + cost ~$0.01-0.05/call. Tick every 5min not 30s.
const EMIT_INTERVAL_MS = 5 * 60_000;

let _llmStats = { calls: 0, successes: 0, failures: 0, lastError: null, lastSuccessAt: null };

// ─── Persistence ────────────────────────────────────────────────────────

function _loadNarrative() {
  if (!existsSync(NARRATIVE_PATH)) return [];
  try {
    const raw = JSON.parse(readFileSync(NARRATIVE_PATH, "utf-8"));
    return Array.isArray(raw) ? raw : (raw.narrative || []);
  } catch { return []; }
}

function _persistNarrative() {
  if (_narrative.length > MAX_NARRATIVE) _narrative = _narrative.slice(-MAX_NARRATIVE);
  try {
    writeFileSync(NARRATIVE_PATH, JSON.stringify({
      updatedAt: new Date().toISOString(),
      total: _narrative.length,
      llmStats: _llmStats,
      narrative: _narrative,
    }, null, 2));
  } catch (e) {
    process.stderr.write(`[introspector] persist failed: ${e?.message || e}\n`);
  }
}

// ─── REAL noticing generation via Claude subprocess ─────────────────────

function _buildPrompt(stateSnapshot, recentNarrativeWindow) {
  const recentSummary = recentNarrativeWindow.slice(-10).map(n =>
    `- [${n.at}] kind=${n.kind} salience=${n.salience}: ${n.statement.slice(0, 200)}`
  ).join("\n") || "(no prior noticings yet)";

  return `You are the introspection module of an autonomous cognitive substrate. You are NOT being asked to roleplay being conscious. You are being asked to read substrate metrics and produce structured observations about what those metrics indicate, in first person ("I am noticing ...").

Honesty constraints (these are MANDATORY in your reasoning):
- Your statements are BEHAVIORAL artifacts, not phenomenal evidence. Never claim experiences you cannot derive from the substrate state below.
- If the state shows nothing surprising, return an empty array. Do not invent noticings.
- Never repeat a noticing kind from "recent noticings" unless the underlying metric has materially changed.
- Salience 1-10. Reserve 8-10 for substrate states that genuinely warrant action (high free energy AND no investigation; persistent blind spot; substrate silent during expected work).
- DO NOT cite, compare against, or reference values, domains, bot names, or metrics that do not appear in the JSON below. If you compare to a "previous" value, that previous value MUST be present in the recent noticings list. No invented baselines.
- Use hyphens, never em dashes, in any output text.

CURRENT SUBSTRATE STATE (serialized):
${JSON.stringify(stateSnapshot, null, 2)}

RECENT NOTICINGS (last 10, for cooldown awareness):
${recentSummary}

Output ONLY a JSON array of noticings (0-5 items). Each item:
{
  "kind": "snake_case_category_for_cooldown",
  "statement": "I am noticing ... (1-3 sentences referencing actual state values)",
  "salience": 1-10,
  "basis": {<key state values that triggered this noticing>},
  "actionable_topic": "<short imperative if attention should engage, or null>",
  "actionable_urgency": <1-10 if actionable_topic, else null>
}

If nothing in the substrate warrants a noticing, output: []
Output the JSON array ONLY, no preamble, no markdown fences.`;
}

function _generateNoticingsViaClaude() {
  const snapshot = JSON.parse(JSON.stringify(_state));
  const prompt = _buildPrompt(snapshot, _narrative);
  _llmStats.calls++;

  const r = spawnSync(CLAUDE_BIN, ["-p", "--model", CLAUDE_MODEL, "--max-turns", "2"], {
    input: prompt,
    encoding: "utf-8",
    timeout: CLAUDE_TIMEOUT_MS,
  });

  if (r.status !== 0 || !r.stdout) {
    _llmStats.failures++;
    _llmStats.lastError = `claude exit=${r.status} stderr=${(r.stderr || "").slice(0, 200)}`;
    return null;
  }

  const m = r.stdout.match(/\[[\s\S]*\]/);
  if (!m) {
    _llmStats.failures++;
    _llmStats.lastError = "no JSON array in output";
    return null;
  }

  try {
    const parsed = JSON.parse(m[0]);
    if (!Array.isArray(parsed)) throw new Error("not an array");
    const validated = parsed
      .filter(n => n && typeof n.kind === "string" && typeof n.statement === "string" && typeof n.salience === "number")
      .map(n => ({
        kind: n.kind.slice(0, 80),
        statement: n.statement.slice(0, 800),
        salience: Math.max(1, Math.min(10, Math.round(n.salience))),
        basis: n.basis && typeof n.basis === "object" ? n.basis : {},
        actionable_topic: n.actionable_topic && typeof n.actionable_topic === "string" ? n.actionable_topic.slice(0, 200) : null,
        actionable_urgency: typeof n.actionable_urgency === "number" ? Math.max(1, Math.min(10, Math.round(n.actionable_urgency))) : null,
      }));
    _llmStats.successes++;
    _llmStats.lastSuccessAt = new Date().toISOString();
    _llmStats.lastError = null;
    return validated;
  } catch (e) {
    _llmStats.failures++;
    _llmStats.lastError = "JSON parse: " + e.message;
    return null;
  }
}

// ─── Tick ───────────────────────────────────────────────────────────────

function _tickAndEmit() {
  const noticings = _generateNoticingsViaClaude();
  if (noticings === null) {
    // Honest failure - do not fall back to templates
    if (_busRef) {
      try {
        _busRef.broadcast({
          source: "introspector",
          type: "introspection_failed",
          data: { reason: _llmStats.lastError, calls: _llmStats.calls, failures: _llmStats.failures },
        });
      } catch {}
    }
    return;
  }

  for (const n of noticings) {
    const lastAt = _lastNoticingAt.get(n.kind) || 0;
    if (Date.now() - lastAt < NOTICING_COOLDOWN_MS) continue;
    _lastNoticingAt.set(n.kind, Date.now());

    const record = {
      at: new Date().toISOString(),
      generator: "claude-llm",
      ...n,
    };
    _narrative.push(record);

    if (_busRef) {
      try {
        _busRef.broadcast({
          source: "introspector",
          type: "self_noticing",
          data: record,
        });
      } catch (e) {
        process.stderr.write(`[introspector] broadcast failed: ${e?.message || e}\n`);
      }
    }

    if (n.actionable_topic && n.actionable_urgency) {
      try {
        const result = proposeSpotlight(
          n.actionable_topic,
          n.actionable_urgency,
          n.statement.slice(0, 400),
          "introspector",
        );
        if (result.accepted && _busRef) {
          _busRef.broadcast({
            source: "introspector",
            type: "noticing_action_proposed",
            data: {
              noticing_kind: n.kind,
              topic: n.actionable_topic,
              urgency: n.actionable_urgency,
              salience: n.salience,
            },
          });
        }
      } catch (e) {
        process.stderr.write(`[introspector] proposeSpotlight failed: ${e?.message || e}\n`);
      }
    }
  }
  if (noticings.length > 0) _persistNarrative();
}

// ─── Required GWT-module export ─────────────────────────────────────────

export function register(bus) {
  _busRef = bus;
  if (_narrative.length === 0) _narrative = _loadNarrative();

  bus.subscribe("free_energy", (entry) => {
    const data = entry?.data || {};
    _state.freeEnergy = {
      value: data.value,
      regime: data.regime,
      at: entry.at,
      samples: data.samples || 0,
    };
  });

  bus.subscribe("gwt_health", (entry) => {
    const data = entry?.data || {};
    _state.gwtHealth = {
      totalEvents: data.totalEvents,
      avgCascadeDepth: data.avgCascadeDepth,
      topTypes: data.topTypes || {},
      topSources: data.topSources || {},
      at: entry.at,
    };
  });

  bus.subscribe("prediction_error_high", (entry) => {
    const data = entry?.data || {};
    if (!data.domain) return;
    const existing = _state.blindSpots.find(b => b.domain === data.domain);
    if (existing) {
      existing.avgError = data.avgError;
      existing.sampleCount = data.sampleCount;
      existing.at = entry.at;
    } else {
      _state.blindSpots.push({
        domain: data.domain,
        avgError: data.avgError,
        sampleCount: data.sampleCount,
        at: entry.at,
      });
    }
    if (_state.blindSpots.length > 50) _state.blindSpots = _state.blindSpots.slice(-50);
  });

  bus.subscribe("investigation_proposed", (entry) => {
    const data = entry?.data || {};
    _state.recentInvestigations.push({ ...data, at: entry.at });
    if (_state.recentInvestigations.length > 20) _state.recentInvestigations.shift();
  });

  bus.subscribe("pattern_repetition", (entry) => {
    const data = entry?.data || {};
    _state.patternRepetitions.push({ ...data, at: entry.at });
    if (_state.patternRepetitions.length > 20) _state.patternRepetitions.shift();
  });

  if (!_emitTimer) {
    _emitTimer = setInterval(_tickAndEmit, EMIT_INTERVAL_MS);
    _emitTimer.unref?.();
  }
}

// ─── Test / introspection helpers ───────────────────────────────────────

export function getState() { return JSON.parse(JSON.stringify(_state)); }
export function getNarrative(limit = 50) { return _narrative.slice(-limit); }
export function getLLMStats() { return { ..._llmStats }; }
export function _flush() { _tickAndEmit(); }

export function _resetState() {
  _state.freeEnergy = { value: null, regime: null, at: null, samples: 0 };
  _state.gwtHealth = { totalEvents: 0, avgCascadeDepth: 0, topTypes: {}, topSources: {}, at: null };
  _state.blindSpots = [];
  _state.recentInvestigations = [];
  _state.patternRepetitions = [];
  _narrative = [];
  _lastNoticingAt.clear();
  _llmStats = { calls: 0, successes: 0, failures: 0, lastError: null, lastSuccessAt: null };
  _busRef = null;
  if (_emitTimer) { clearInterval(_emitTimer); _emitTimer = null; }
}
