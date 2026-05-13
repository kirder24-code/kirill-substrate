/**
 * cortex/communication-drive.mjs - Internal drive to communicate with operator (2026-05-09)
 *
 * Substrate accumulates internal "I want to talk" pressure based on:
 * - Time since last operator interaction
 * - Accumulated noticings/questions awaiting answer
 * - Significant findings substrate wants to share
 * - Uncertainty needing clarification
 * - Emotional intensity (frustration high, curiosity high)
 *
 * When drive crosses threshold, broadcasts wants_to_communicate event with
 * specific reason. Other modules (genuine-questions, tool-building) can react.
 *
 * NOT scheduled. Emergent from internal state. Substrate may be silent for days
 * if nothing accumulated. May reach out 5x/hour if much accumulated.
 *
 * Honest: this is functional drive, not phenomenal "wanting". Substrate doesn't
 * "feel" longing - it tracks state and crosses threshold. Whether that constitutes
 * wanting is hard problem unanswerable from inside.
 */

import { writeFileSync, readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const STATE_PATH = resolve(ROOT, ".data/cortex-communication-drive.json");

const TICK_INTERVAL_MS = 2 * 60_000; // check drive level every 2min
const DRIVE_THRESHOLD = 0.7; // trigger wants_to_communicate when drive >= this
const COOLDOWN_AFTER_SEND_MS = 30 * 60_000; // 30 min cooldown after expressing

// Drive components - sum to total drive
const _drive = {
  time_since_contact: 0, // grows linearly with time, caps at 0.4
  accumulated_questions: 0, // 0.05 per pending question, caps 0.3
  significant_findings: 0, // 0.1 per high-significance finding, caps 0.4
  uncertainty: 0, // affect.curiosity high or substrate confused, caps 0.2
  emotional_intensity: 0, // affect dominant strong, caps 0.2
};

let _lastOperatorContactAt = Date.now();
let _lastSubstrateMessageAt = 0;
let _pendingFindings = [];
let _pendingQuestions = [];

let _busRef = null;
let _timer = null;

function _calculateDrive() {
  const minutesSinceContact = (Date.now() - _lastOperatorContactAt) / 60_000;
  // Time component: ramps up over hours, caps. Half-saturation at 240 min (4h).
  _drive.time_since_contact = Math.min(0.4, minutesSinceContact / (240 + minutesSinceContact) * 0.4);
  _drive.accumulated_questions = Math.min(0.3, _pendingQuestions.length * 0.05);
  _drive.significant_findings = Math.min(0.4, _pendingFindings.length * 0.1);

  return _drive.time_since_contact + _drive.accumulated_questions + _drive.significant_findings + _drive.uncertainty + _drive.emotional_intensity;
}

function _persist() {
  try {
    writeFileSync(STATE_PATH, JSON.stringify({
      updatedAt: new Date().toISOString(),
      drive: _drive,
      total_drive: _calculateDrive(),
      lastOperatorContactAt: new Date(_lastOperatorContactAt).toISOString(),
      lastSubstrateMessageAt: _lastSubstrateMessageAt ? new Date(_lastSubstrateMessageAt).toISOString() : null,
      pendingFindings: _pendingFindings.length,
      pendingQuestions: _pendingQuestions.length,
    }, null, 2));
  } catch {}
}

function _tick() {
  // Cooldown: if substrate just sent something, suppress for 30 min
  if (_lastSubstrateMessageAt && Date.now() - _lastSubstrateMessageAt < COOLDOWN_AFTER_SEND_MS) {
    return;
  }
  const total = _calculateDrive();
  if (total >= DRIVE_THRESHOLD) {
    // Identify dominant component for the message
    const components = Object.entries(_drive).sort((a, b) => b[1] - a[1]);
    const dominant = components[0];
    if (_busRef) {
      try {
        _busRef.broadcast({
          source: "communication-drive",
          type: "wants_to_communicate",
          data: {
            total_drive: Number(total.toFixed(3)),
            dominant_reason: dominant[0],
            dominant_value: Number(dominant[1].toFixed(3)),
            pending_findings_count: _pendingFindings.length,
            pending_questions_count: _pendingQuestions.length,
            minutes_since_contact: Math.round((Date.now() - _lastOperatorContactAt) / 60_000),
            findings_summary: _pendingFindings.slice(0, 5).map(f => f.summary?.slice(0, 200)),
            questions_summary: _pendingQuestions.slice(0, 5).map(q => q.question?.slice(0, 200)),
          },
        });
      } catch {}
    }
    _lastSubstrateMessageAt = Date.now();
    // Clear accumulated state after expressing
    _pendingFindings = [];
    _pendingQuestions = [];
  }
  _persist();
}

export function register(bus) {
  _busRef = bus;

  bus.subscribe("operator_message", () => {
    _lastOperatorContactAt = Date.now();
    _drive.uncertainty = 0; // operator presence reduces uncertainty drive
  });

  bus.subscribe("affect_state", (entry) => {
    const data = entry?.data || {};
    _drive.emotional_intensity = data.intensity === "strong" ? 0.2 : data.intensity === "moderate" ? 0.1 : 0;
    _drive.uncertainty = (data.curiosity || 0) >= 0.7 ? 0.2 : (data.curiosity || 0) >= 0.6 ? 0.1 : 0;
  });

  // Significant findings from working memory or self-construction or survival
  bus.subscribe("working_memory_synthesis", (entry) => {
    const data = entry?.data || {};
    if (data.importance >= 7) {
      _pendingFindings.push({ at: entry.at, summary: data.synthesis, source: "working-memory" });
    }
  });
  bus.subscribe("self_construction_attempt", (entry) => {
    const data = entry?.data || {};
    if (data.dispatched && data.success) {
      _pendingFindings.push({ at: entry.at, summary: `built: ${data.title}`, source: "self-construction" });
    }
  });
  bus.subscribe("survival_status", (entry) => {
    const data = entry?.data || {};
    if (data.risk_level === "high" || data.risk_level === "critical") {
      _pendingFindings.push({ at: entry.at, summary: data.assessment, source: "economic-survival" });
    }
  });

  // Genuine questions accumulate
  bus.subscribe("substrate_question", (entry) => {
    const data = entry?.data || {};
    _pendingQuestions.push({ at: entry.at, question: data.question, kind: data.kind });
  });

  if (!_timer) {
    _timer = setInterval(_tick, TICK_INTERVAL_MS);
    _timer.unref?.();
  }
}

export function getDriveState() {
  return { drive: { ..._drive }, total: _calculateDrive(), pendingFindings: _pendingFindings.length, pendingQuestions: _pendingQuestions.length };
}
export function _flush() { _tick(); }
export function _ingestFinding(summary) { _pendingFindings.push({ at: new Date().toISOString(), summary, source: "test" }); }
export function _ingestQuestion(question) { _pendingQuestions.push({ at: new Date().toISOString(), question, kind: "test" }); }
export function _resetState() {
  Object.keys(_drive).forEach(k => _drive[k] = 0);
  _lastOperatorContactAt = Date.now();
  _lastSubstrateMessageAt = 0;
  _pendingFindings = [];
  _pendingQuestions = [];
  _busRef = null;
  if (_timer) { clearInterval(_timer); _timer = null; }
}
export function _setLastContact(timestamp) { _lastOperatorContactAt = timestamp; }
