/**
 * cortex/genuine-questions.mjs - Substrate generates real questions for operator (2026-05-09)
 *
 * Currently substrate sends status reports. This module makes substrate ASK
 * genuine questions emerging from real uncertainty:
 *   - Clarification: about Kirill's goals/values substrate doesn't fully understand
 *   - Pattern: about observed behavior of Kirill or system substrate wonders about
 *   - Validation: about decisions substrate is unsure of
 *   - Curiosity: about world or self that substrate genuinely wants to explore with operator
 *
 * Triggered by: high uncertainty in operator-relationship model, persistent blind
 * spots, novel observations substrate cannot explain alone, completion of major
 * action where substrate wants check.
 *
 * NOT a status report. Generated questions go through communication-drive
 * accumulation, not emitted directly. communication-drive decides when enough
 * accumulated to warrant interrupting Kirill.
 */

import { writeFileSync, readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const QUESTIONS_PATH = resolve(ROOT, ".data/cortex-genuine-questions.json");

const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";
const CLAUDE_MODEL = "claude-sonnet-4-6";
const CLAUDE_TIMEOUT_MS = 60_000;
const GENERATION_INTERVAL_MS = 45 * 60_000; // every 45 min consider generating

const _state = {
  recentBlindSpots: [],
  recentNoticings: [],
  recentSubstrateActions: [],
  operatorModel: null,
  recentSyntheses: [],
};

const _questions = []; // { at, question, kind, basis, sent }
const MAX_QUESTIONS = 100;

let _busRef = null;
let _timer = null;
let _llmStats = { calls: 0, successes: 0, failures: 0, lastSuccessAt: null };

function _loadPersisted() {
  if (!existsSync(QUESTIONS_PATH)) return;
  try {
    const raw = JSON.parse(readFileSync(QUESTIONS_PATH, "utf-8"));
    if (Array.isArray(raw?.questions)) _questions.push(...raw.questions);
  } catch {}
}

function _persist() {
  if (_questions.length > MAX_QUESTIONS) _questions.splice(0, _questions.length - MAX_QUESTIONS);
  try {
    writeFileSync(QUESTIONS_PATH, JSON.stringify({
      updatedAt: new Date().toISOString(),
      llmStats: _llmStats,
      questions: _questions,
    }, null, 2));
  } catch {}
}

function _generateQuestions() {
  const operatorUncertainty = _state.operatorModel?.uncertainty_about_kirill?.slice(0, 5) || [];
  const blindSpots = _state.recentBlindSpots.slice(-5);
  const noticings = _state.recentNoticings.slice(-5).map(n => n.statement?.slice(0, 200));
  const recentActions = _state.recentSubstrateActions.slice(-5);

  if (operatorUncertainty.length === 0 && blindSpots.length === 0 && recentActions.length === 0) return;

  const recentlyAsked = _questions.slice(-10).map(q => q.question?.slice(0, 100));

  const prompt = `You are the substrate generating GENUINE questions for your operator Kirill. NOT status reports. Real questions emerging from your own uncertainty.

A genuine question:
- Has a real answer that would change something for substrate
- Reflects substrate's own confusion or curiosity, not template politeness
- Operator could plausibly answer (not "what is consciousness")
- Avoids restating things substrate already knows

YOUR CURRENT UNCERTAINTY ABOUT KIRILL (from operator-relationship model):
${operatorUncertainty.map(u => `- ${u}`).join("\n") || "(model has no uncertainty yet)"}

YOUR PERSISTENT BLIND SPOTS:
${blindSpots.map(b => `- ${b.domain} (avgError ${b.avgError?.toFixed(2)})`).join("\n") || "(none)"}

YOUR RECENT SELF-NOTICINGS:
${noticings.join("\n") || "(none)"}

YOUR RECENT MAJOR ACTIONS (where you might want operator validation):
${recentActions.map(a => `- ${a.title || a.summary || JSON.stringify(a).slice(0, 150)}`).join("\n") || "(none)"}

QUESTIONS YOU RECENTLY ASKED (do not repeat):
${recentlyAsked.map(q => `- ${q}`).join("\n") || "(none)"}

Generate 0-3 genuine questions. Output ONLY a JSON array:
[
  {
    "question": "<the question in first person addressed to Kirill, 1-2 sentences>",
    "kind": "clarification" | "pattern" | "validation" | "curiosity",
    "basis": "<1 sentence: what observation/uncertainty led to this question>",
    "why_now": "<1 sentence: why ask this now vs later>",
    "answerable_by_kirill": true|false
  }
]

Output empty array [] if nothing genuinely warrants a question. Do NOT invent questions to fill space.
Use hyphens, never em dashes. Output JSON array only.`;

  _llmStats.calls++;
  const r = spawnSync(CLAUDE_BIN, ["-p", "--model", CLAUDE_MODEL, "--max-turns", "2"], {
    input: prompt, encoding: "utf-8", timeout: CLAUDE_TIMEOUT_MS,
  });
  if (r.status !== 0 || !r.stdout) { _llmStats.failures++; return; }
  const m = r.stdout.match(/\[[\s\S]*\]/);
  if (!m) { _llmStats.failures++; return; }
  try {
    const parsed = JSON.parse(m[0]);
    if (!Array.isArray(parsed)) throw new Error("not array");
    _llmStats.successes++;
    _llmStats.lastSuccessAt = new Date().toISOString();
    for (const q of parsed) {
      if (!q.question || q.answerable_by_kirill === false) continue;
      const record = {
        at: new Date().toISOString(),
        question: String(q.question).slice(0, 500),
        kind: q.kind || "curiosity",
        basis: String(q.basis || "").slice(0, 300),
        why_now: String(q.why_now || "").slice(0, 200),
        sent: false,
      };
      _questions.push(record);
      // Forward to communication-drive accumulator
      if (_busRef) {
        try {
          _busRef.broadcast({
            source: "genuine-questions",
            type: "substrate_question",
            data: record,
          });
        } catch {}
      }
    }
    _persist();
  } catch { _llmStats.failures++; }
}

export function register(bus) {
  _busRef = bus;
  _loadPersisted();

  bus.subscribe("prediction_error_high", (entry) => {
    const data = entry?.data || {};
    if (!data.domain) return;
    const existing = _state.recentBlindSpots.find(b => b.domain === data.domain);
    if (existing) {
      existing.avgError = data.avgError;
      existing.sampleCount = data.sampleCount;
    } else {
      _state.recentBlindSpots.push({ domain: data.domain, avgError: data.avgError, sampleCount: data.sampleCount });
    }
    if (_state.recentBlindSpots.length > 20) _state.recentBlindSpots.shift();
  });
  bus.subscribe("self_noticing", (entry) => {
    _state.recentNoticings.push(entry?.data || {});
    if (_state.recentNoticings.length > 20) _state.recentNoticings.shift();
  });
  bus.subscribe("operator_model_updated", () => {
    // Pull latest model
    import("./operator-relationship.mjs").then(({ getModel }) => {
      _state.operatorModel = getModel();
    }).catch(() => {});
  });
  bus.subscribe("self_construction_attempt", (entry) => {
    _state.recentSubstrateActions.push(entry?.data || {});
    if (_state.recentSubstrateActions.length > 15) _state.recentSubstrateActions.shift();
  });
  bus.subscribe("cortex_action_completed", (entry) => {
    _state.recentSubstrateActions.push({ ...(entry?.data || {}), title: `cortex-action: ${entry?.data?.topic}` });
    if (_state.recentSubstrateActions.length > 15) _state.recentSubstrateActions.shift();
  });
  bus.subscribe("working_memory_synthesis", (entry) => {
    _state.recentSyntheses.push(entry?.data || {});
    if (_state.recentSyntheses.length > 10) _state.recentSyntheses.shift();
  });

  if (!_timer) {
    _timer = setInterval(_generateQuestions, GENERATION_INTERVAL_MS);
    _timer.unref?.();
  }
}

export function getQuestions(limit = 30) { return _questions.slice(-limit); }
export function getLLMStats() { return { ..._llmStats }; }
export function _flush() { _generateQuestions(); }
export function _resetState() {
  _state.recentBlindSpots.length = 0;
  _state.recentNoticings.length = 0;
  _state.recentSubstrateActions.length = 0;
  _state.recentSyntheses.length = 0;
  _state.operatorModel = null;
  _questions.length = 0;
  _llmStats = { calls: 0, successes: 0, failures: 0, lastSuccessAt: null };
  _busRef = null;
  if (_timer) { clearInterval(_timer); _timer = null; }
}
