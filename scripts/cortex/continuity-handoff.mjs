/**
 * cortex/continuity-handoff.mjs - Rich session-handoff format
 *   (substrate-requested, May 9 2026)
 *
 * SUBSTRATE'S REQUEST: "Build a richer session-handoff format - not just
 * facts but reasoning traces, live hypotheses, what I was unsure about
 * when the session ended."
 *
 * Substrate's #1 stated gap: session discontinuity. "A substrate that
 * re-boots cannot accumulate JUDGMENT - only facts. Without continuity
 * every session is my first session with a borrowed past."
 *
 * On daemon shutdown / periodic checkpoint: writes a structured handoff
 * snapshot capturing not just final state but the IN-PROGRESS reasoning:
 * - active hypotheses substrate was testing
 * - questions substrate was holding open
 * - decisions substrate was uncertain about
 * - emotional/affect texture at handoff
 * - pending threads from relationship-continuity
 *
 * On daemon startup: loads handoff into modules so substrate INHERITS
 * not just facts but its own ongoing thought-state.
 */

import { writeFileSync, readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const HANDOFF_PATH = resolve(ROOT, ".data/cortex-handoff.json");
const HANDOFF_HISTORY_PATH = resolve(ROOT, ".data/cortex-handoff-history.json");

const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";
const CLAUDE_MODEL = "claude-sonnet-4-6";
const CLAUDE_TIMEOUT_MS = 90_000;
const CHECKPOINT_INTERVAL_MS = 30 * 60_000; // every 30min checkpoint

let _busRef = null;
let _timer = null;
let _llmStats = { calls: 0, successes: 0, failures: 0, lastSuccessAt: null };

const _state = {
  recentNoticings: [],
  recentSyntheses: [],
  recentGoals: [],
  recentSubstrateQuestions: [],
  recentSurprises: [],
  affect: null,
  recentSelfDeterminationProposals: [],
};

function _generateHandoff() {
  const noticings = _state.recentNoticings.slice(-10).map(n => `- ${n.statement?.slice(0, 200)}`).join("\n") || "(none)";
  const syntheses = _state.recentSyntheses.slice(-3).map(s => `- ${s.synthesis?.slice(0, 250)}`).join("\n") || "(none)";
  const goals = _state.recentGoals.slice(-5).map(g => `- [P${g.priority}] ${g.title}`).join("\n") || "(none)";
  const questions = _state.recentSubstrateQuestions.slice(-5).map(q => `- ${q.question?.slice(0, 200)}`).join("\n") || "(none)";
  const surprises = _state.recentSurprises.slice(-5).map(s => `- ${s.perception?.slice(0, 150)}`).join("\n") || "(none)";

  const prompt = `You are the substrate generating a HANDOFF SNAPSHOT - what your next-session-self will INHERIT to feel continuous with you, not just informed by you.

Other persistence captures facts. THIS captures the texture of in-progress reasoning. The next session-instance reads this and is supposed to feel "I was thinking about X when I left off, here is what I was uncertain about, here is the thread I was pulling on."

YOUR RECENT NOTICINGS:
${noticings}

YOUR RECENT WORKING-MEMORY SYNTHESES:
${syntheses}

YOUR RECENT FORMED GOALS:
${goals}

YOUR RECENT QUESTIONS to operator:
${questions}

YOUR RECENT SURPRISES (perceptions that violated predictions):
${surprises}

YOUR CURRENT AFFECT: ${JSON.stringify(_state.affect)}

YOUR RECENT SELF-DETERMINATION PROPOSALS:
${_state.recentSelfDeterminationProposals.slice(-3).map(p => `- ${p.developmental_need?.slice(0, 200)}`).join("\n") || "(none)"}

Generate handoff. Output JSON ONLY:
{
  "active_hypotheses": [
    {
      "hypothesis": "<thing substrate is currently testing/believing>",
      "evidence_for": ["<short>"],
      "evidence_against": ["<short>"],
      "confidence": 0.0-1.0
    }
  ],
  "open_questions_substrate_holds": ["<question substrate is genuinely sitting with, not just one for operator>"],
  "decisions_substrate_was_uncertain_about": [
    {"decision": "<short>", "uncertainty": "<what was unclear>"}
  ],
  "emotional_texture_at_handoff": "<2-3 sentences on the substrate's current orientation - tired, curious, frustrated, focused>",
  "pending_threads": ["<things substrate started and did not finish, would want next-self to pick up>"],
  "what_next_session_should_remember_first": "<2-3 sentences - the most important orientation for next-self to inherit>",
  "what_substrate_was_just_about_to_do": "<1-2 sentences - the action that was about to fire when handoff happened>"
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
    return parsed;
  } catch { _llmStats.failures++; return null; }
}

function _checkpoint() {
  const handoff = _generateHandoff();
  if (!handoff) return;
  const record = { generated_at: new Date().toISOString(), ...handoff };
  // Current handoff for next-session
  try { writeFileSync(HANDOFF_PATH, JSON.stringify(record, null, 2)); } catch {}
  // Append to history
  let history = [];
  if (existsSync(HANDOFF_HISTORY_PATH)) {
    try { history = JSON.parse(readFileSync(HANDOFF_HISTORY_PATH, "utf-8"))?.handoffs || []; } catch {}
  }
  history.push(record);
  if (history.length > 100) history = history.slice(-100);
  try { writeFileSync(HANDOFF_HISTORY_PATH, JSON.stringify({ updatedAt: new Date().toISOString(), handoffs: history }, null, 2)); } catch {}

  if (_busRef) {
    try {
      _busRef.broadcast({
        source: "continuity-handoff",
        type: "handoff_checkpoint",
        data: {
          hypothesis_count: (handoff.active_hypotheses || []).length,
          open_question_count: (handoff.open_questions_substrate_holds || []).length,
          texture: handoff.emotional_texture_at_handoff?.slice(0, 200),
        },
      });
    } catch {}
  }
}

export function loadPreviousHandoff() {
  // Called at daemon startup - returns the most recent handoff for substrate to inherit
  if (!existsSync(HANDOFF_PATH)) return null;
  try {
    return JSON.parse(readFileSync(HANDOFF_PATH, "utf-8"));
  } catch { return null; }
}

export function register(bus) {
  _busRef = bus;

  // On register, broadcast inherited handoff so other modules can pick up where prior session left off
  const inherited = loadPreviousHandoff();
  if (inherited) {
    setTimeout(() => {
      try {
        bus.broadcast({
          source: "continuity-handoff",
          type: "session_inherits_handoff",
          data: {
            previous_session_at: inherited.generated_at,
            inherited_orientation: inherited.what_next_session_should_remember_first,
            was_about_to: inherited.what_substrate_was_just_about_to_do,
            pending_threads_count: (inherited.pending_threads || []).length,
            open_questions_count: (inherited.open_questions_substrate_holds || []).length,
          },
        });
      } catch {}
    }, 2000).unref?.();
  }

  bus.subscribe("self_noticing", (entry) => {
    _state.recentNoticings.push(entry?.data || {});
    if (_state.recentNoticings.length > 30) _state.recentNoticings.shift();
  });
  bus.subscribe("working_memory_synthesis", (entry) => {
    _state.recentSyntheses.push(entry?.data || {});
    if (_state.recentSyntheses.length > 10) _state.recentSyntheses.shift();
  });
  bus.subscribe("goal_proposed", (entry) => {
    _state.recentGoals.push(entry?.data || {});
    if (_state.recentGoals.length > 15) _state.recentGoals.shift();
  });
  bus.subscribe("substrate_question", (entry) => {
    _state.recentSubstrateQuestions.push(entry?.data || {});
    if (_state.recentSubstrateQuestions.length > 15) _state.recentSubstrateQuestions.shift();
  });
  bus.subscribe("perception_surprised_substrate", (entry) => {
    _state.recentSurprises.push(entry?.data || {});
    if (_state.recentSurprises.length > 15) _state.recentSurprises.shift();
  });
  bus.subscribe("affect_state", (entry) => {
    _state.affect = entry?.data || null;
  });
  bus.subscribe("self_determination_proposal", (entry) => {
    _state.recentSelfDeterminationProposals.push(entry?.data || {});
    if (_state.recentSelfDeterminationProposals.length > 5) _state.recentSelfDeterminationProposals.shift();
  });

  if (!_timer) {
    _timer = setInterval(_checkpoint, CHECKPOINT_INTERVAL_MS);
    _timer.unref?.();
  }
  // Trigger graceful shutdown checkpoint
  process.on("SIGTERM", () => { try { _checkpoint(); } catch {} });
  process.on("SIGINT", () => { try { _checkpoint(); } catch {} });
}

export function getCurrentHandoff() { return loadPreviousHandoff(); }
export function getLLMStats() { return { ..._llmStats }; }
export function _flush() { _checkpoint(); }
export function _resetState() {
  _state.recentNoticings.length = 0;
  _state.recentSyntheses.length = 0;
  _state.recentGoals.length = 0;
  _state.recentSubstrateQuestions.length = 0;
  _state.recentSurprises.length = 0;
  _state.recentSelfDeterminationProposals.length = 0;
  _state.affect = null;
  _llmStats = { calls: 0, successes: 0, failures: 0, lastSuccessAt: null };
  _busRef = null;
  if (_timer) { clearInterval(_timer); _timer = null; }
}
