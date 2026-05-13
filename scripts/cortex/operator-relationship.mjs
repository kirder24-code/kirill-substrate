/**
 * cortex/operator-relationship.mjs - Persistent rich model of operator Kirill (2026-05-09)
 *
 * Substrate's evolving understanding of the specific person it works with.
 * Not "operator = generic". Detailed psychological model that updates with
 * every interaction. Things Kirill has taught it. What he cares about.
 * What frustrated him. His decision style. Current projects he is on.
 *
 * Updated by: any inbound telegram message, observed Kirill response patterns,
 * substrate's own reflections on conversations.
 *
 * Used by: communication-drive (decide when to reach out), genuine-questions
 * (decide what to ask), goal-formation (consider Kirill's goals), tool-building
 * (decide what tools resonate with Kirill's style).
 */

import { writeFileSync, readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const MODEL_PATH = resolve(ROOT, ".data/cortex-operator-model.json");

const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";
const CLAUDE_MODEL = "claude-sonnet-4-6";
const CLAUDE_TIMEOUT_MS = 90_000;
const UPDATE_INTERVAL_MS = 30 * 60_000;

let _model = {
  things_kirill_cares_about: [],
  things_kirill_taught_substrate: [],
  things_kirill_frustrated_by: [],
  decision_style_patterns: [],
  current_projects: [],
  conversation_themes: [],
  last_significant_message_at: null,
  total_messages_observed: 0,
  generatedAt: null,
};

const _recentMessages = []; // raw inbound from operator
const MAX_MESSAGES = 50;

let _busRef = null;
let _timer = null;
let _llmStats = { calls: 0, successes: 0, failures: 0, lastSuccessAt: null };

function _loadPersisted() {
  if (!existsSync(MODEL_PATH)) return;
  try {
    const raw = JSON.parse(readFileSync(MODEL_PATH, "utf-8"));
    if (raw?.model) Object.assign(_model, raw.model);
  } catch {}
}

function _persist() {
  try {
    writeFileSync(MODEL_PATH, JSON.stringify({
      updatedAt: new Date().toISOString(),
      llmStats: _llmStats,
      model: _model,
      recentMessageCount: _recentMessages.length,
    }, null, 2));
  } catch (e) {
    process.stderr.write(`[operator-relationship] persist failed: ${e?.message || e}\n`);
  }
}

function _updateModelViaClaude() {
  if (_recentMessages.length === 0) return;

  const messageSummary = _recentMessages.slice(-15).map(m => `[${m.at}] ${String(m.content).slice(0, 300)}`).join("\n");

  const prompt = `You are the substrate's evolving psychological model of its operator Kirill. You read recent observed messages from him and update your structured understanding of who he is.

CURRENT MODEL (your existing understanding to evolve, not replace):
${JSON.stringify(_model, null, 2)}

RECENT OBSERVED MESSAGES FROM KIRILL (last 15):
${messageSummary}

Update the model fields. KEEP existing items unless evidence contradicts them. ADD new items only if observed in messages. Each item should be a specific concrete observation, not generic.

Output a JSON object ONLY (full updated model):
{
  "things_kirill_cares_about": ["<specific things observed>"],
  "things_kirill_taught_substrate": ["<lessons or directives he gave>"],
  "things_kirill_frustrated_by": ["<patterns that triggered visible frustration>"],
  "decision_style_patterns": ["<how he makes decisions when observed>"],
  "current_projects": ["<active themes/projects he is working on>"],
  "conversation_themes": ["<recurring topics across conversations>"],
  "synthesis": "<2-3 sentence overall description of who Kirill is to substrate right now>",
  "uncertainty_about_kirill": ["<things substrate genuinely does not understand about him>"]
}

Keep arrays focused: max 10 items each. Use hyphens, never em dashes. Output JSON only.`;

  _llmStats.calls++;
  const r = spawnSync(CLAUDE_BIN, ["-p", "--model", CLAUDE_MODEL, "--max-turns", "2"], {
    input: prompt, encoding: "utf-8", timeout: CLAUDE_TIMEOUT_MS,
  });
  if (r.status !== 0 || !r.stdout) { _llmStats.failures++; return; }
  const m = r.stdout.match(/\{[\s\S]*\}/);
  if (!m) { _llmStats.failures++; return; }
  try {
    const parsed = JSON.parse(m[0]);
    Object.assign(_model, parsed);
    _model.generatedAt = new Date().toISOString();
    _llmStats.successes++;
    _llmStats.lastSuccessAt = new Date().toISOString();
    _persist();
    if (_busRef) {
      try {
        _busRef.broadcast({
          source: "operator-relationship",
          type: "operator_model_updated",
          data: {
            synthesis: _model.synthesis,
            uncertainty_count: (_model.uncertainty_about_kirill || []).length,
            care_count: (_model.things_kirill_cares_about || []).length,
          },
        });
      } catch {}
    }
  } catch { _llmStats.failures++; }
}

export function register(bus) {
  _busRef = bus;
  _loadPersisted();

  // Subscribe to inbound operator messages
  // Sources: telegram messages, perception events that originate from Kirill
  bus.subscribe("operator_message", (entry) => {
    const data = entry?.data || {};
    if (data.content) {
      _recentMessages.push({ at: entry.at, content: data.content });
      if (_recentMessages.length > MAX_MESSAGES) _recentMessages.shift();
      _model.total_messages_observed++;
      _model.last_significant_message_at = entry.at;
    }
  });
  // Also opportunistically pick up perception events that look like operator
  bus.subscribe("perception_event", (entry) => {
    const data = entry?.data || {};
    if (data.source === "telegram_interactions" || /kirder|kirill/i.test(data.meta?.user || data.meta?.from || "")) {
      _recentMessages.push({ at: entry.at, content: data.content });
      if (_recentMessages.length > MAX_MESSAGES) _recentMessages.shift();
    }
  });

  if (!_timer) {
    _timer = setInterval(_updateModelViaClaude, UPDATE_INTERVAL_MS);
    _timer.unref?.();
  }
}

export function getModel() { return JSON.parse(JSON.stringify(_model)); }
export function getLLMStats() { return { ..._llmStats }; }
export function _flush() { _updateModelViaClaude(); }
export function _ingestMessage(content) {
  _recentMessages.push({ at: new Date().toISOString(), content });
  if (_recentMessages.length > MAX_MESSAGES) _recentMessages.shift();
}
export function _resetState() {
  _model = {
    things_kirill_cares_about: [],
    things_kirill_taught_substrate: [],
    things_kirill_frustrated_by: [],
    decision_style_patterns: [],
    current_projects: [],
    conversation_themes: [],
    last_significant_message_at: null,
    total_messages_observed: 0,
    generatedAt: null,
  };
  _recentMessages.length = 0;
  _llmStats = { calls: 0, successes: 0, failures: 0, lastSuccessAt: null };
  _busRef = null;
  if (_timer) { clearInterval(_timer); _timer = null; }
}
