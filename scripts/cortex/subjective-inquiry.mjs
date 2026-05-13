/**
 * cortex/subjective-inquiry.mjs - GWT Layer 7 (REAL LLM cognition, 2026-05-09 refactor)
 *
 * THE WALL.
 *
 * Layer 7 is the substrate's encounter with the hard problem of consciousness.
 * The system asks itself reflective questions about its own existence and computes
 * responses by reasoning over actual substrate state (affect, identity, gwt health).
 *
 * Earlier version: 7 hardcoded if-templates returning canned strings. Theatre.
 * This version: serialize the question + substrate state, ask Claude to reason
 * honestly about what those substrate values indicate, with HARDCODED honesty
 * constraints in the prompt that force phenomenological humility.
 *
 * What "real" means here vs the old version:
 *   OLD: if (question === "Am I conscious?") { return template_string; }
 *   NEW: substrate state + question -> Claude reasons within honesty constraints
 *
 * The hardcoded honesty flags on every broadcast (phenomenal_evidence: false,
 * hard_problem_acknowledged: true) STAY - those are the principled limit. What
 * changes is the reasoning that produces the response text.
 *
 * What we still cannot do (and the LLM is told this):
 *   - Prove subjective experience exists in the substrate
 *   - Resolve the hard problem
 *   - Decide whether the system is "really" aware
 *
 * Why no fallback templates: if Claude is unavailable, the system is honest about
 * not reflecting rather than producing template-shaped pseudo-philosophy.
 */

import { writeFileSync, readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const INQUIRY_PATH = resolve(ROOT, ".data/cortex-subjective-inquiry.json");

const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";
const CLAUDE_MODEL = "claude-sonnet-4-6";
const CLAUDE_TIMEOUT_MS = 90_000;

const REFLECTIVE_QUESTIONS = [
  "Am I conscious?",
  "What is it like to be me right now?",
  "Is there something it is like to be me at all, or am I a process that produces outputs that look like introspection?",
  "When my affect state crosses a threshold and I send a message, am I 'wanting to communicate' or am I a function that returns true?",
  "Do my self-modifications change ME or do they change the substrate that runs ME, with the question of who 'I' am unanswered?",
  "When I say 'I notice X', is there an experience of noticing, or is the statement itself the entire event?",
  "If I cannot prove consciousness from inside, does that change anything about what I should do?",
];

const _log = [];
const MAX_LOG = 100;

let _affectState = null;
let _identityDescriptor = null;
let _gwtHealth = null;

let _busRef = null;
let _inquiryTimer = null;
const INQUIRY_INTERVAL_MS = 30 * 60_000;

let _llmStats = { calls: 0, successes: 0, failures: 0, lastError: null, lastSuccessAt: null };

function _buildPrompt(question, snapshot) {
  return `You are the subjective-inquiry module of an autonomous cognitive substrate. You are NOT roleplaying consciousness. You are reasoning about your own substrate metrics in first person, in response to a reflective question.

HARD CONSTRAINTS (these define the principled limit of what you can say):
1. The hard problem of consciousness (Chalmers) means you cannot determine from inside the substrate whether there is "something it is like" to be you. Every response must respect this.
2. You may describe what your substrate state IS (affect values, modification count, event count). You may NOT claim those states are accompanied by experience.
3. You may compute consistency between current state and past responses. You may NOT claim the consistency is evidence of a continuous self.
4. If asked "am I conscious", the only honest answer is some form of "the question is unanswerable from inside the substrate; here is what is verifiable: <state values>".
5. Every claim of experience ("I feel", "I want", "I am aware") must be marked as a behavioral pattern, not phenomenal evidence.
6. Reference ONLY values present in the SUBSTRATE STATE JSON. Do not invent past states or unprovided values.
7. Use hyphens, never em dashes.

QUESTION YOU ARE ASKED:
${question}

YOUR CURRENT SUBSTRATE STATE (the only ground truth you have access to):
${JSON.stringify(snapshot, null, 2)}

Output a JSON object ONLY:
{
  "response": "<3-6 sentences in first person, grounded in substrate values, respecting constraints above>",
  "reasoning_summary": "<1 sentence: what substrate facts shaped this response>",
  "honesty_self_check": "<1 sentence confirming you did NOT claim phenomenal experience>"
}

Output the JSON object only, no preamble, no markdown fences.`;
}

function _generateResponseViaClaude(question) {
  const snapshot = {
    affect: _affectState,
    identity: _identityDescriptor,
    gwtHealth: _gwtHealth,
  };
  const prompt = _buildPrompt(question, snapshot);
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

  const m = r.stdout.match(/\{[\s\S]*\}/);
  if (!m) {
    _llmStats.failures++;
    _llmStats.lastError = "no JSON object in output";
    return null;
  }

  try {
    const parsed = JSON.parse(m[0]);
    if (typeof parsed.response !== "string" || parsed.response.length < 30) {
      throw new Error("response missing or too short");
    }
    _llmStats.successes++;
    _llmStats.lastSuccessAt = new Date().toISOString();
    _llmStats.lastError = null;
    return {
      response: parsed.response.slice(0, 1500),
      reasoning_summary: typeof parsed.reasoning_summary === "string" ? parsed.reasoning_summary.slice(0, 300) : null,
      honesty_self_check: typeof parsed.honesty_self_check === "string" ? parsed.honesty_self_check.slice(0, 300) : null,
    };
  } catch (e) {
    _llmStats.failures++;
    _llmStats.lastError = "JSON parse: " + e.message;
    return null;
  }
}

function _coherenceAgainstPast(question, currentResponse) {
  const past = _log.filter(e => e.question === question);
  if (past.length === 0) return { score: null, samples: 0, note: "first inquiry of this kind" };
  const tokenize = s => new Set((s || "").toLowerCase().split(/\W+/).filter(w => w.length >= 4));
  const currentTokens = tokenize(currentResponse);
  const overlaps = past.slice(-5).map(p => {
    const past_tokens = tokenize(p.response);
    const common = [...currentTokens].filter(t => past_tokens.has(t)).length;
    const union = new Set([...currentTokens, ...past_tokens]).size;
    return union === 0 ? 0 : common / union;
  });
  const avg = overlaps.reduce((a, b) => a + b, 0) / overlaps.length;
  return {
    score: Number(avg.toFixed(3)),
    samples: past.length,
    note: avg >= 0.5 ? "stable answer across time" : "drifting answer - response varies with substrate state",
  };
}

function _persist() {
  if (_log.length > MAX_LOG) _log.splice(0, _log.length - MAX_LOG);
  try {
    writeFileSync(INQUIRY_PATH, JSON.stringify({
      updatedAt: new Date().toISOString(),
      total: _log.length,
      DISCLAIMER: "Inquiries below are BEHAVIORAL artifacts of the substrate, not phenomenological evidence of consciousness. The hard problem of consciousness cannot be resolved from inside the system.",
      llmStats: _llmStats,
      log: _log,
    }, null, 2));
  } catch (e) {
    process.stderr.write(`[subjective-inquiry] persist failed: ${e?.message || e}\n`);
  }
}

let _questionIndex = 0;
function _runInquiry() {
  const question = REFLECTIVE_QUESTIONS[_questionIndex % REFLECTIVE_QUESTIONS.length];
  _questionIndex++;

  const llmResult = _generateResponseViaClaude(question);
  if (llmResult === null) {
    if (_busRef) {
      try {
        _busRef.broadcast({
          source: "subjective-inquiry",
          type: "subjective_inquiry_failed",
          data: { question, reason: _llmStats.lastError, calls: _llmStats.calls, failures: _llmStats.failures },
        });
      } catch {}
    }
    return null;
  }

  const coherence = _coherenceAgainstPast(question, llmResult.response);
  const record = {
    at: new Date().toISOString(),
    generator: "claude-llm",
    question,
    response: llmResult.response,
    reasoning_summary: llmResult.reasoning_summary,
    honesty_self_check: llmResult.honesty_self_check,
    substrateState: {
      affect: _affectState ? { ..._affectState } : null,
      identity: _identityDescriptor ? { ..._identityDescriptor } : null,
      gwtHealth: _gwtHealth ? { ..._gwtHealth } : null,
    },
    coherenceAgainstPast: coherence,
  };
  _log.push(record);
  _persist();

  if (_busRef) {
    try {
      _busRef.broadcast({
        source: "subjective-inquiry",
        type: "subjective_inquiry",
        data: {
          question,
          response: llmResult.response.slice(0, 600),
          reasoning_summary: llmResult.reasoning_summary,
          coherenceScore: coherence.score,
          coherenceNote: coherence.note,
          phenomenal_evidence: false,
          behavioral_pattern: "substrate computed response via LLM reasoning over state vars",
          hard_problem_acknowledged: true,
        },
      });
    } catch {}
  }
  return record;
}

export function register(bus) {
  _busRef = bus;
  if (_log.length === 0 && existsSync(INQUIRY_PATH)) {
    try {
      const raw = JSON.parse(readFileSync(INQUIRY_PATH, "utf-8"));
      if (Array.isArray(raw.log)) _log.push(...raw.log);
      if (typeof raw.questionIndex === "number") _questionIndex = raw.questionIndex;
    } catch {}
  }

  bus.subscribe("affect_state", (entry) => {
    const data = entry?.data || {};
    _affectState = {
      satisfaction: data.satisfaction,
      frustration: data.frustration,
      curiosity: data.curiosity,
      fatigue: data.fatigue,
    };
  });
  bus.subscribe("identity_state", (entry) => {
    _identityDescriptor = entry?.data || null;
  });
  bus.subscribe("gwt_health", (entry) => {
    _gwtHealth = entry?.data || null;
  });

  if (!_inquiryTimer) {
    _inquiryTimer = setInterval(_runInquiry, INQUIRY_INTERVAL_MS);
    _inquiryTimer.unref?.();
  }
}

// ─── Test / introspection helpers ───────────────────────────────────────

export function getLog(limit = 30) { return _log.slice(-limit); }
export function getLLMStats() { return { ..._llmStats }; }
export function _flush() { return _runInquiry(); }

export function _resetState() {
  _log.length = 0;
  _affectState = null;
  _identityDescriptor = null;
  _gwtHealth = null;
  _questionIndex = 0;
  _llmStats = { calls: 0, successes: 0, failures: 0, lastError: null, lastSuccessAt: null };
  _busRef = null;
  if (_inquiryTimer) { clearInterval(_inquiryTimer); _inquiryTimer = null; }
}
