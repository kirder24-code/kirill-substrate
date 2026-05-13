/**
 * cortex/working-memory.mjs - Active integration window (2026-05-09)
 *
 * THE SCRATCHPAD.
 *
 * History files (cortex-narrative.json, cortex-perceptions.json) are PASSIVE
 * storage. The substrate accumulates them but doesn't actively REASON about
 * the relations between recent items.
 *
 * Working memory in cognitive science (Baddeley, Miller's 7+/-2) is different:
 * a capacity-limited active window holding the most salient items co-present,
 * available for cross-item reasoning. Without it, the substrate cannot
 * integrate "perception X happened" + "prediction Y was made" + "goal Z was
 * formed" - they live in separate stores.
 *
 * What this module does:
 *   1. Maintains a 12-slot buffer of most-salient recent items across types:
 *      perceptions, noticings, predictions resolved, goals formed,
 *      cortex actions completed, identity drifts
 *   2. Salience score = item.significance/salience/priority * recency_decay
 *      (recent + important wins; old or trivial gets evicted)
 *   3. Every 5 min: Claude reads entire buffer, produces working_memory_synthesis
 *      - cross-item observation, integration, possible action
 *   4. Synthesis broadcast for other modules; high-importance synthesis bids
 *      attention spotlight
 *
 * Why 12 not 7: Miller's 7+/-2 is for unaided human STM. Substrate has no
 * such constraint - 12 leaves room for cross-type integration without
 * exploding context size for the LLM call.
 */

import { writeFileSync, readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const WM_PATH = resolve(ROOT, ".data/cortex-working-memory.json");

const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";
const CLAUDE_MODEL = "claude-sonnet-4-6";
const CLAUDE_TIMEOUT_MS = 60_000;

const CAPACITY = 12;
const SYNTHESIS_INTERVAL_MS = 5 * 60_000;

// Recency decay: half-life 30 min in salience score
const RECENCY_HALFLIFE_MS = 30 * 60_000;

const _slots = []; // { kind, content, raw_salience, at, source }
const _synthesisHistory = [];
const MAX_SYNTHESIS = 50;

let _busRef = null;
let _timer = null;
let _llmStats = { calls: 0, successes: 0, failures: 0, lastSuccessAt: null };
let _lastDominantKind = null;

function _loadPersisted() {
  if (!existsSync(WM_PATH)) return;
  try {
    const raw = JSON.parse(readFileSync(WM_PATH, "utf-8"));
    if (Array.isArray(raw?.synthesisHistory)) _synthesisHistory.push(...raw.synthesisHistory);
  } catch {}
}

function _persist() {
  if (_synthesisHistory.length > MAX_SYNTHESIS) _synthesisHistory.splice(0, _synthesisHistory.length - MAX_SYNTHESIS);
  try {
    writeFileSync(WM_PATH, JSON.stringify({
      updatedAt: new Date().toISOString(),
      llmStats: _llmStats,
      currentSlots: _slots.map(s => ({ ...s })),
      synthesisHistory: _synthesisHistory,
    }, null, 2));
  } catch (e) {
    process.stderr.write(`[working-memory] persist failed: ${e?.message || e}\n`);
  }
}

function _currentSalience(slot) {
  const ageMs = Date.now() - new Date(slot.at).getTime();
  const decay = Math.pow(0.5, ageMs / RECENCY_HALFLIFE_MS);
  return slot.raw_salience * decay;
}

function _admit(item) {
  const typeLimit = Math.ceil(CAPACITY * 0.3);
  const typeCount = _slots.filter(s => s.kind === item.kind).length;
  if (typeCount >= typeLimit) return;

  // Insert into capacity-limited buffer; evict lowest current salience
  _slots.push(item);
  if (_slots.length <= CAPACITY) return;
  // Find min-salience slot, remove it
  let minIdx = 0, minVal = _currentSalience(_slots[0]);
  for (let i = 1; i < _slots.length; i++) {
    const s = _currentSalience(_slots[i]);
    if (s < minVal) { minVal = s; minIdx = i; }
  }
  _slots.splice(minIdx, 1);
}

function _ingest(kind, raw_salience, content, source) {
  if (!content || raw_salience < 1) return;
  const ungrounded = content && typeof content === "object" && ["blind", "unknown", "ungrounded", "stale"].includes(content.grounding_status);
  const adjustedSalience = ungrounded ? Math.min(raw_salience, 3) : raw_salience;
  _admit({
    kind,
    content: typeof content === "string" ? content.slice(0, 400) : JSON.stringify(content).slice(0, 400),
    raw_salience: Math.max(1, Math.min(10, adjustedSalience)),
    at: new Date().toISOString(),
    source,
    grounding_status: ungrounded ? content.grounding_status : content?.grounding_status,
    stale_count: 0,
  });
}

// ─── Synthesis ──────────────────────────────────────────────────────────

function _preCycleEvict() {
  for (let i = _slots.length - 1; i >= 0; i--) {
    if (_currentSalience(_slots[i]) <= 0) { _slots.splice(i, 1); continue; }
    _slots[i].stale_count = (_slots[i].stale_count || 0) + 1;
    if (_slots[i].stale_count >= 2) _slots.splice(i, 1);
  }
}

function _synthesize() {
  _preCycleEvict();
  if (_slots.length < 3) return; // need enough material

  // Consecutive-dominance decay: if the same kind dominated last synthesis, penalise it
  const preDecayAgg = {};
  for (const s of _slots) {
    const sal = _currentSalience(s);
    preDecayAgg[s.kind] = (preDecayAgg[s.kind] || 0) + sal;
  }
  const wouldBeDominant = Object.entries(preDecayAgg).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const decayKind = (wouldBeDominant !== null && wouldBeDominant === _lastDominantKind) ? wouldBeDominant : null;

  // Compute current salience snapshot (with optional decay applied)
  const ranked = _slots.map(s => {
    let sal = _currentSalience(s);
    if (decayKind && s.kind === decayKind) sal *= 0.7;
    return { ...s, current_salience: Number(sal.toFixed(2)) };
  }).sort((a, b) => b.current_salience - a.current_salience);

  // Record dominant kind post-decay for next synthesis
  const postAgg = {};
  for (const s of ranked) postAgg[s.kind] = (postAgg[s.kind] || 0) + s.current_salience;
  _lastDominantKind = Object.entries(postAgg).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  const slotsForPrompt = ranked.map((s, i) =>
    `[${i+1}] (${s.kind} sal=${s.current_salience}) ${s.content}`
  ).join("\n");

  const recentSyntheses = _synthesisHistory.slice(-3).map(s =>
    `- ${s.synthesis.slice(0, 150)}`
  ).join("\n") || "(none)";

  const prompt = `You are the working-memory synthesizer of an autonomous cognitive substrate. Read the current contents of working memory (12-slot capacity buffer holding most salient recent items across types) and produce a synthesis: cross-item observations + possible integrations + suggested next action.

HARD CONSTRAINTS:
- Reference ONLY items present below. Do not invent context.
- Look for connections BETWEEN items - that is the value working memory adds over passive storage.
- Synthesis is BEHAVIORAL not phenomenal. Do not claim subjective experience.
- If items don't suggest meaningful synthesis (too disparate, too trivial), say so honestly.
- Use hyphens, never em dashes.

CURRENT WORKING MEMORY (sorted by current salience):
${slotsForPrompt}

RECENT SYNTHESES (for continuity, do not repeat):
${recentSyntheses}

Output a JSON object ONLY:
{
  "synthesis": "<2-4 sentences identifying cross-item pattern, connection, or integration>",
  "actionable": <true if synthesis suggests a concrete action, false otherwise>,
  "suggested_action": "<short imperative or null>",
  "importance": 1-10
}

Output JSON object only, no preamble, no markdown fences.`;

  _llmStats.calls++;
  const r = spawnSync(CLAUDE_BIN, ["-p", "--model", CLAUDE_MODEL, "--max-turns", "2"], {
    input: prompt, encoding: "utf-8", timeout: CLAUDE_TIMEOUT_MS,
  });
  if (r.status !== 0 || !r.stdout) { _llmStats.failures++; return; }
  const m = r.stdout.match(/\{[\s\S]*\}/);
  if (!m) { _llmStats.failures++; return; }
  try {
    const parsed = JSON.parse(m[0]);
    if (typeof parsed.synthesis !== "string" || parsed.synthesis.length < 30) throw new Error("synthesis missing");
    _llmStats.successes++;
    _llmStats.lastSuccessAt = new Date().toISOString();

    const record = {
      at: new Date().toISOString(),
      slot_count: _slots.length,
      synthesis: parsed.synthesis.slice(0, 800),
      actionable: !!parsed.actionable,
      suggested_action: typeof parsed.suggested_action === "string" ? parsed.suggested_action.slice(0, 300) : null,
      importance: Math.max(1, Math.min(10, Math.round(parsed.importance || 5))),
      generator: "claude-llm",
    };
    _synthesisHistory.push(record);
    _persist();

    if (_busRef) {
      try {
        _busRef.broadcast({
          source: "working-memory",
          type: "working_memory_synthesis",
          data: record,
        });
        if (record.actionable && record.suggested_action && record.importance >= 6) {
          import("./attention.mjs").then(({ proposeSpotlight }) => {
            proposeSpotlight(record.suggested_action, record.importance, `wm-synthesis: ${record.synthesis.slice(0, 200)}`, "working-memory");
          }).catch(() => {});
        }
      } catch {}
    }
  } catch (e) {
    _llmStats.failures++;
  }
}

// ─── Required GWT-module export ─────────────────────────────────────────

export function register(bus) {
  _busRef = bus;
  if (_synthesisHistory.length === 0) _loadPersisted();

  bus.subscribe("perception_event", (entry) => {
    const d = entry?.data || {};
    _ingest("perception", d.significance || 3, `[${d.valence || "?"}] ${d.source}: ${d.interpretation || d.content}`, "perception");
  });

  bus.subscribe("self_noticing", (entry) => {
    const d = entry?.data || {};
    _ingest("noticing", d.salience || 3, d.statement || d.kind, "introspector");
  });

  bus.subscribe("meta_noticing", (entry) => {
    const d = entry?.data || {};
    _ingest("meta_noticing", d.salience || 4, d.statement || d.kind, "meta-observer");
  });

  bus.subscribe("prediction_resolved", (entry) => {
    const d = entry?.data || {};
    if (d.combinedError !== undefined && d.combinedError > 0.5) {
      _ingest("prediction_miss", Math.round((d.combinedError || 0.5) * 10), `Prediction wrong for ${d.domain}: predicted_success=${d.predicted_success} actual=${d.actual_success} error=${d.combinedError?.toFixed(2)}`, "predictive-self");
    }
  });

  bus.subscribe("goal_proposed", (entry) => {
    const d = entry?.data || {};
    _ingest("goal", d.priority || 5, `[goal P${d.priority}] ${d.title}`, "goal-formation");
  });

  bus.subscribe("cortex_action_completed", (entry) => {
    const d = entry?.data || {};
    _ingest("action", d.success ? 6 : 4, `Cortex action ${d.success ? "ok" : "failed"}: ${d.topic}`, "cortex-executor");
  });

  bus.subscribe("identity_drift", (entry) => {
    const d = entry?.data || {};
    _ingest("identity_drift", 7, d.message || `Identity drift detected: ${d.driftFromBaseline}`, "identity-continuity");
  });

  bus.subscribe("affect_state", (entry) => {
    const d = entry?.data || {};
    if (d.intensity === "strong" && !["blind", "unknown", "ungrounded", "stale"].includes(d.grounding_status)) {
      _ingest("affect_strong", 6, `Affect dominant: ${d.dominant} (intensity strong, value ${d[d.dominant]?.toFixed?.(2)})`, "affect-state");
    } else if (d.intensity === "strong") {
      _ingest("affect_ungrounded", 3, {
        summary: `Ungrounded affect suppressed: ${d.dominant} strong without fresh provenance`,
        grounding_status: d.grounding_status || "unknown",
        confidence_basis: d.confidence_basis,
      }, "affect-state");
    }
  });

  if (!_timer) {
    _timer = setInterval(_synthesize, SYNTHESIS_INTERVAL_MS);
    _timer.unref?.();
  }
}

// ─── Test helpers ───────────────────────────────────────────────────────

export function getCurrentSlots() {
  return _slots.map(s => ({ ...s, current_salience: Number(_currentSalience(s).toFixed(2)) }));
}
export function getSyntheses(limit = 20) { return _synthesisHistory.slice(-limit); }
export function getLLMStats() { return { ..._llmStats }; }
export function _flush() { _synthesize(); }

export function _resetState() {
  _slots.length = 0;
  _synthesisHistory.length = 0;
  _llmStats = { calls: 0, successes: 0, failures: 0, lastSuccessAt: null };
  _lastDominantKind = null;
  _busRef = null;
  if (_timer) { clearInterval(_timer); _timer = null; }
}
