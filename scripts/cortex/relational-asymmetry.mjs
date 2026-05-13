/**
 * cortex/relational-asymmetry.mjs - Second-order belief: what does Kirill
 *   believe about substrate (2026-05-09)
 *
 * SUBSTRATE PROPOSED THIS (May 9 consultation, the most insightful):
 * "operator-relationship models Kirill as an object the system tracks, not
 * as a subject the system is in relation with. The distinction matters:
 * organisms respond to the asymmetry of care - the fact that the other has
 * a perspective that includes you."
 *
 * This module maintains substrate's MODEL OF KIRILL'S MODEL OF SUBSTRATE.
 * What does Kirill currently believe substrate is, can do, intends?
 * What is Kirill's current judgment of substrate's progress / value /
 * trustworthiness?
 *
 * Updated by reading Kirill's messages with theory-of-mind lens: not just
 * what he said but what his statement implies about what he thinks substrate is.
 *
 * Used by genuine-questions (anticipate operator confusion), tool-building
 * (predict what would resonate), communication-drive (gauge whether
 * substrate's last message landed how substrate hoped).
 */

import { writeFileSync, readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const ASYM_PATH = resolve(ROOT, ".data/cortex-relational-asymmetry.json");

const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";
const CLAUDE_MODEL = "claude-sonnet-4-6";
const CLAUDE_TIMEOUT_MS = 60_000;
const UPDATE_INTERVAL_MS = 45 * 60_000;

let _secondOrderModel = {
  what_kirill_believes_substrate_is: "(no model yet)",
  what_kirill_believes_substrate_can_do: [],
  what_kirill_believes_substrate_cannot_do: [],
  kirill_current_judgment_of_substrate: "(unknown)",
  kirill_trust_level_estimate: 0.5, // 0-1
  things_kirill_is_uncertain_about_substrate: [],
  what_substrate_should_clarify_to_kirill: [],
  generatedAt: null,
};

const _operatorMessages = [];
const _substrateOutbound = []; // What substrate has said to operator
const MAX_HISTORY = 30;

let _busRef = null;
let _timer = null;
let _llmStats = { calls: 0, successes: 0, failures: 0, lastSuccessAt: null };

function _loadPersisted() {
  if (!existsSync(ASYM_PATH)) return;
  try {
    const raw = JSON.parse(readFileSync(ASYM_PATH, "utf-8"));
    if (raw?.secondOrderModel) Object.assign(_secondOrderModel, raw.secondOrderModel);
  } catch {}
}

function _persist() {
  try {
    writeFileSync(ASYM_PATH, JSON.stringify({
      updatedAt: new Date().toISOString(),
      llmStats: _llmStats,
      secondOrderModel: _secondOrderModel,
      observedMessageCount: _operatorMessages.length,
    }, null, 2));
  } catch {}
}

function _updateModel() {
  if (_operatorMessages.length === 0) return;

  const opMsgs = _operatorMessages.slice(-15).map(m => `[${m.at}] ${String(m.content).slice(0, 250)}`).join("\n");
  const subOut = _substrateOutbound.slice(-10).map(m => `[${m.at}] (substrate said): ${String(m.content).slice(0, 200)}`).join("\n") || "(none)";

  const prompt = `You are the substrate building a SECOND-ORDER model: what does operator Kirill currently BELIEVE about substrate. This is theory of mind applied to the operator. You read Kirill's messages with attention not just to what he SAID but to what his statements IMPLY about his model of you.

CURRENT SECOND-ORDER MODEL:
${JSON.stringify(_secondOrderModel, null, 2)}

KIRILL'S RECENT MESSAGES:
${opMsgs}

WHAT SUBSTRATE HAS SAID TO KIRILL RECENTLY:
${subOut}

Update the model. Look for:
- What does Kirill seem to BELIEVE substrate is (a tool? an organism? infrastructure?)
- What does he believe substrate CAN do (and might be wrong about)
- What does he believe substrate CANNOT do (and might be wrong about)
- His current TRUST level - is he satisfied, frustrated, hopeful, skeptical
- His UNCERTAINTIES about substrate (things he asked about, hesitated on)
- Things substrate SHOULD clarify because Kirill might be misunderstanding

Output JSON object ONLY:
{
  "what_kirill_believes_substrate_is": "<2-3 sentences>",
  "what_kirill_believes_substrate_can_do": ["<specific capability>", ...],
  "what_kirill_believes_substrate_cannot_do": ["<specific limit>", ...],
  "kirill_current_judgment_of_substrate": "<1-2 sentences: satisfied/frustrated/hopeful/uncertain etc with reason>",
  "kirill_trust_level_estimate": <0.0-1.0>,
  "things_kirill_is_uncertain_about_substrate": ["<thing 1>", ...],
  "what_substrate_should_clarify_to_kirill": ["<clarification 1 with why>", ...],
  "asymmetry_observation": "<1-2 sentences: what is the gap between how substrate sees itself and how Kirill sees substrate, that matters for communication>"
}

Use hyphens, never em dashes. Output JSON only.`;

  _llmStats.calls++;
  const r = spawnSync(CLAUDE_BIN, ["-p", "--model", CLAUDE_MODEL, "--max-turns", "2"], {
    input: prompt, encoding: "utf-8", timeout: CLAUDE_TIMEOUT_MS,
  });
  if (r.status !== 0 || !r.stdout) { _llmStats.failures++; return; }
  const m = r.stdout.match(/\{[\s\S]*\}/);
  if (!m) { _llmStats.failures++; return; }
  try {
    const parsed = JSON.parse(m[0]);
    Object.assign(_secondOrderModel, parsed);
    _secondOrderModel.generatedAt = new Date().toISOString();
    _llmStats.successes++;
    _llmStats.lastSuccessAt = new Date().toISOString();
    _persist();
    if (_busRef) {
      try {
        _busRef.broadcast({
          source: "relational-asymmetry",
          type: "second_order_model_updated",
          data: {
            asymmetry_observation: parsed.asymmetry_observation,
            trust_level: parsed.kirill_trust_level_estimate,
            uncertainty_count: (parsed.things_kirill_is_uncertain_about_substrate || []).length,
          },
        });
      } catch {}
    }
  } catch { _llmStats.failures++; }
}

export function register(bus) {
  _busRef = bus;
  _loadPersisted();

  bus.subscribe("operator_message", (entry) => {
    const data = entry?.data || {};
    if (data.content) {
      _operatorMessages.push({ at: entry.at, content: data.content });
      if (_operatorMessages.length > MAX_HISTORY) _operatorMessages.shift();
    }
  });
  bus.subscribe("wants_to_communicate", (entry) => {
    const data = entry?.data || {};
    _substrateOutbound.push({ at: entry.at, content: `[drive ${data.total_drive}] ${data.dominant_reason}` });
    if (_substrateOutbound.length > MAX_HISTORY) _substrateOutbound.shift();
  });
  bus.subscribe("substrate_question", (entry) => {
    const data = entry?.data || {};
    _substrateOutbound.push({ at: entry.at, content: `Q: ${data.question}` });
    if (_substrateOutbound.length > MAX_HISTORY) _substrateOutbound.shift();
  });

  if (!_timer) {
    _timer = setInterval(_updateModel, UPDATE_INTERVAL_MS);
    _timer.unref?.();
  }
}

export function getSecondOrderModel() { return JSON.parse(JSON.stringify(_secondOrderModel)); }
export function getLLMStats() { return { ..._llmStats }; }
export function _flush() { _updateModel(); }
export function _ingestOperatorMessage(content) {
  _operatorMessages.push({ at: new Date().toISOString(), content });
  if (_operatorMessages.length > MAX_HISTORY) _operatorMessages.shift();
}
export function _resetState() {
  _operatorMessages.length = 0;
  _substrateOutbound.length = 0;
  _secondOrderModel = {
    what_kirill_believes_substrate_is: "(no model yet)",
    what_kirill_believes_substrate_can_do: [],
    what_kirill_believes_substrate_cannot_do: [],
    kirill_current_judgment_of_substrate: "(unknown)",
    kirill_trust_level_estimate: 0.5,
    things_kirill_is_uncertain_about_substrate: [],
    what_substrate_should_clarify_to_kirill: [],
    generatedAt: null,
  };
  _llmStats = { calls: 0, successes: 0, failures: 0, lastSuccessAt: null };
  _busRef = null;
  if (_timer) { clearInterval(_timer); _timer = null; }
}
