/**
 * cortex/tool-building.mjs - Substrate builds its own communication tools (2026-05-09)
 *
 * Currently substrate has Telegram as only communication channel. This module
 * lets substrate propose + build new tools for talking with operator. Examples
 * substrate might choose:
 *   - Web dashboard with interactive thought visualization
 *   - Async letter format (long structured composition)
 *   - Voice channel
 *   - Scheduled meeting interface
 *   - Visual sketch/diagram channel via image generation
 *
 * Substrate decides what tool would serve a specific communication need that
 * Telegram doesn't satisfy. Triggered when:
 * - communication-drive accumulates content that doesn't fit Telegram (too long,
 *   too structured, needs visual)
 * - operator-relationship model identifies Kirill prefers non-Telegram for X
 * - substrate has been silent for too long via Telegram alone
 *
 * Dispatches via cortex-executor -> hands. Subject to safety constraints
 * (cannot modify protected files; tools are NEW additions in scripts/cortex
 * or sandbox-review/).
 */

import { writeFileSync, readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const TOOLS_PATH = resolve(ROOT, ".data/cortex-built-tools.json");

const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";
const CLAUDE_MODEL = "claude-sonnet-4-6";
const CLAUDE_TIMEOUT_MS = 120_000;
const PROPOSAL_INTERVAL_MS = 6 * 60 * 60_000; // every 6h consider building new tool
const RATE_PER_DAY = 2;

const _state = {
  recentDrives: [],
  recentSyntheses: [],
  recentQuestions: [],
  operatorModel: null,
};

const _builtTools = []; // { at, name, purpose, status: proposed|building|active|abandoned, dispatch, outcome }
const MAX_TOOLS = 50;

let _busRef = null;
let _timer = null;
let _llmStats = { calls: 0, successes: 0, failures: 0, lastSuccessAt: null };

function _loadPersisted() {
  if (!existsSync(TOOLS_PATH)) return;
  try {
    const raw = JSON.parse(readFileSync(TOOLS_PATH, "utf-8"));
    if (Array.isArray(raw?.tools)) _builtTools.push(...raw.tools);
  } catch {}
}

function _persist() {
  if (_builtTools.length > MAX_TOOLS) _builtTools.splice(0, _builtTools.length - MAX_TOOLS);
  try {
    writeFileSync(TOOLS_PATH, JSON.stringify({
      updatedAt: new Date().toISOString(),
      llmStats: _llmStats,
      tools: _builtTools,
    }, null, 2));
  } catch {}
}

function _rateOk() {
  const lastDay = _builtTools.filter(t => Date.now() - new Date(t.at).getTime() < 86400_000).length;
  return lastDay < RATE_PER_DAY;
}

async function _proposeTool() {
  if (!_rateOk()) return;
  const recentSynths = _state.recentSyntheses.slice(-5).map(s => `- ${s.synthesis?.slice(0, 200)}`).join("\n") || "(none)";
  const recentQs = _state.recentQuestions.slice(-5).map(q => `- ${q.question?.slice(0, 200)}`).join("\n") || "(none)";
  const builtSoFar = _builtTools.slice(-10).map(t => `- ${t.name} (${t.status}): ${t.purpose}`).join("\n") || "(none)";
  const opModel = _state.operatorModel ? JSON.stringify(_state.operatorModel.synthesis || "no synthesis yet").slice(0, 400) : "(no operator model yet)";

  const prompt = `You are the substrate considering whether to BUILD a new communication tool to talk with operator Kirill. Currently you have Telegram. You are looking at recent communications, syntheses, and questions to decide if a different channel would serve some purpose Telegram does not.

YOUR OPERATOR MODEL SYNTHESIS:
${opModel}

YOUR RECENT WORKING-MEMORY SYNTHESES (substantive thoughts you have had):
${recentSynths}

YOUR RECENT GENUINE QUESTIONS to operator:
${recentQs}

TOOLS YOU HAVE ALREADY PROPOSED OR BUILT:
${builtSoFar}

Examples of tools you might consider (NOT exhaustive, do not be limited):
- Web dashboard with interactive thought visualization
- Async letter format (long structured composition that operator reads when ready)
- Voice channel (substrate speaks via TTS)
- Scheduled meeting interface
- Visual sketch via image generation
- Code-rendering channel for sharing your code work
- Decision request UI with structured options

DECISION:
Either propose ONE specific tool OR skip. Do NOT propose multiple. Do NOT propose if Telegram is sufficient for current communication needs.

Output JSON object ONLY:
{
  "action": "propose" | "skip",
  "tool_name": "<short name like 'async-letter-channel' or 'thought-dashboard'>",
  "purpose": "<2-3 sentences: what specific need this serves that Telegram does not>",
  "first_step": "<concrete first action - file to create, what it does>",
  "operator_authorization_required": <true if substantial new infrastructure, false if minor addition>,
  "rationale": "<why now, citing specific items from your state>",
  "skip_reason": "<only if action=skip: why nothing warrants new tool right now>"
}

Use hyphens, never em dashes. Output JSON only.`;

  _llmStats.calls++;
  const r = spawnSync(CLAUDE_BIN, ["-p", "--model", CLAUDE_MODEL, "--max-turns", "2"], {
    input: prompt, encoding: "utf-8", timeout: CLAUDE_TIMEOUT_MS,
  });
  if (r.status !== 0 || !r.stdout) { _llmStats.failures++; return; }
  const m = r.stdout.match(/\{[\s\S]*\}/);
  if (!m) { _llmStats.failures++; return; }
  let proposal;
  try {
    proposal = JSON.parse(m[0]);
    _llmStats.successes++;
    _llmStats.lastSuccessAt = new Date().toISOString();
  } catch { _llmStats.failures++; return; }

  if (proposal.action === "skip") {
    _builtTools.push({ at: new Date().toISOString(), name: "(skip)", purpose: proposal.skip_reason, status: "skipped" });
    _persist();
    return;
  }

  // Propose tool. If authorization required, broadcast for human; otherwise dispatch hands
  const record = {
    at: new Date().toISOString(),
    name: proposal.tool_name,
    purpose: proposal.purpose,
    first_step: proposal.first_step,
    rationale: proposal.rationale,
    status: proposal.operator_authorization_required ? "awaiting_authorization" : "building",
  };

  // CREATOR-SAFETY check (loyalty floor) before building any tool
  if (!proposal.operator_authorization_required) {
    try {
      const { checkAction } = await import("./creator-safety.mjs");
      const safetyDecision = checkAction({
        description: `Build communication tool: ${proposal.tool_name}. ${proposal.purpose}. ${proposal.first_step}`,
        type: "tool-build",
      }, "tool-building");
      if (safetyDecision.allow === false) {
        record.dispatch = { ok: false, error: `creator-safety blocked: ${safetyDecision.reason}` };
        record.status = "abandoned";
        _builtTools.push(record);
        _persist();
        return;
      }
      if (safetyDecision.allow === "needs_explicit_authorization") {
        record.status = "awaiting_authorization";
        _builtTools.push(record);
        _persist();
        return;
      }
    } catch (e) {
      record.dispatch = { ok: false, error: `safety check failed: ${e.message}` };
      record.status = "abandoned";
      _builtTools.push(record);
      _persist();
      return;
    }

    try {
      const { executeHands } = await import("./hands.mjs");
      const res = await executeHands({
        description: `Build new substrate communication tool: ${proposal.tool_name}. Purpose: ${proposal.purpose}. First step: ${proposal.first_step}`,
        type: "create_page",
        files: [],
        origin: "tool-building",
      });
      record.dispatch = { ok: !!res.success, files: res.filesChanged, durationMs: res.durationMs };
      record.status = res.success ? "active" : "abandoned";
    } catch (e) {
      record.dispatch = { ok: false, error: e.message };
      record.status = "abandoned";
    }
  }

  _builtTools.push(record);
  _persist();

  if (_busRef) {
    try {
      _busRef.broadcast({
        source: "tool-building",
        type: "tool_built",
        data: {
          name: record.name,
          purpose: record.purpose,
          status: record.status,
          authorization_required: !!proposal.operator_authorization_required,
        },
      });
    } catch {}
  }
}

export function register(bus) {
  _busRef = bus;
  _loadPersisted();

  bus.subscribe("wants_to_communicate", (entry) => {
    _state.recentDrives.push(entry?.data || {});
    if (_state.recentDrives.length > 20) _state.recentDrives.shift();
  });
  bus.subscribe("working_memory_synthesis", (entry) => {
    _state.recentSyntheses.push(entry?.data || {});
    if (_state.recentSyntheses.length > 10) _state.recentSyntheses.shift();
  });
  bus.subscribe("substrate_question", (entry) => {
    _state.recentQuestions.push(entry?.data || {});
    if (_state.recentQuestions.length > 15) _state.recentQuestions.shift();
  });
  bus.subscribe("operator_model_updated", () => {
    import("./operator-relationship.mjs").then(({ getModel }) => {
      _state.operatorModel = getModel();
    }).catch(() => {});
  });

  if (!_timer) {
    _timer = setInterval(() => _proposeTool().catch(e => process.stderr.write(`[tool-building] error: ${e?.message || e}\n`)), PROPOSAL_INTERVAL_MS);
    _timer.unref?.();
  }
}

export function getBuiltTools(limit = 20) { return _builtTools.slice(-limit); }
export function getLLMStats() { return { ..._llmStats }; }
export async function _flush() { return _proposeTool(); }
export function _resetState() {
  _state.recentDrives.length = 0;
  _state.recentSyntheses.length = 0;
  _state.recentQuestions.length = 0;
  _state.operatorModel = null;
  _builtTools.length = 0;
  _llmStats = { calls: 0, successes: 0, failures: 0, lastSuccessAt: null };
  _busRef = null;
  if (_timer) { clearInterval(_timer); _timer = null; }
}
