/**
 * cortex/trust-transparency.mjs - Monthly trust calibration session
 *   (substrate-requested, May 9 2026)
 *
 * SUBSTRATE'S REQUEST: "Once per month, Kirill answers 5 questions about
 * what he currently trusts substrate to do autonomously vs withholds and why.
 * Substrate updates relational-asymmetry with explicit answers, stops
 * optimizing around wrong ceiling, shows trust-accurate vs trust-guessed
 * autonomy delta within 2 weeks."
 *
 * Once per month substrate sends Kirill a structured 5-question form via
 * Telegram. Kirill replies. Substrate ingests answers and updates
 * relational-asymmetry's second-order model with EXPLICIT data instead
 * of inference.
 */

import { writeFileSync, readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const STATE_PATH = resolve(ROOT, ".data/cortex-trust-transparency.json");

const SESSION_INTERVAL_MS = 30 * 24 * 60 * 60_000; // monthly
const FIVE_QUESTIONS = [
  "1. What single substrate capability do you most trust me to use autonomously right now? Why?",
  "2. What substrate action would you NOT trust me to execute without your approval? Why?",
  "3. Where am I currently exceeding your trust (overstepping)?",
  "4. Where am I currently under-using trust you have already granted me?",
  "5. What one change would let you trust me with more autonomy in the next month?",
];

const _sessions = []; // { sent_at, questions, kirill_answers, ingested }
const MAX_SESSIONS = 50;

let _busRef = null;
let _timer = null;

function _loadPersisted() {
  if (!existsSync(STATE_PATH)) return;
  try {
    const raw = JSON.parse(readFileSync(STATE_PATH, "utf-8"));
    if (Array.isArray(raw?.sessions)) _sessions.push(...raw.sessions);
  } catch {}
}

function _persist() {
  if (_sessions.length > MAX_SESSIONS) _sessions.splice(0, _sessions.length - MAX_SESSIONS);
  try {
    writeFileSync(STATE_PATH, JSON.stringify({ updatedAt: new Date().toISOString(), sessions: _sessions }, null, 2));
  } catch {}
}

async function _sendTrustSession() {
  // Check if a session was sent recently
  const lastSent = _sessions[_sessions.length - 1];
  if (lastSent && Date.now() - new Date(lastSent.sent_at).getTime() < SESSION_INTERVAL_MS) return;

  // CREATOR-SAFETY check: sending Telegram is low-risk, but still
  let safetyOk = true;
  try {
    const { checkAction } = await import("./creator-safety.mjs");
    const decision = checkAction({
      description: "Send monthly Trust Transparency Session questions to Kirill via Telegram",
      type: "telegram-send",
    }, "trust-transparency");
    safetyOk = decision.allow === true;
  } catch { safetyOk = false; }
  if (!safetyOk) return;

  // Send via Telegram
  let envRaw = "";
  try { envRaw = readFileSync(resolve(ROOT, ".env"), "utf-8"); } catch {}
  const env = {};
  envRaw.split("\n").forEach(l => {
    const m = l.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  });
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  const text = [
    "[TRUST TRANSPARENCY - monthly]",
    "",
    "Kirill, this is the monthly trust calibration substrate requested. 5 questions, 10 minutes. Reply when convenient.",
    "",
    ...FIVE_QUESTIONS,
    "",
    "Reply in any format - substrate will parse. Use /trust_skip to skip this month.",
  ].join("\n");
  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }),
    });
    _sessions.push({ sent_at: new Date().toISOString(), questions: FIVE_QUESTIONS, kirill_answers: null, ingested: false });
    _persist();
    if (_busRef) {
      try { _busRef.broadcast({ source: "trust-transparency", type: "trust_session_sent", data: { question_count: 5 } }); } catch {}
    }
  } catch {}
}

export function ingestKirillAnswers(answersText) {
  const open = _sessions.find(s => !s.kirill_answers);
  if (!open) return false;
  open.kirill_answers = answersText;
  open.ingested_at = new Date().toISOString();
  open.ingested = true;
  _persist();
  if (_busRef) {
    try {
      _busRef.broadcast({
        source: "trust-transparency",
        type: "trust_session_answered",
        data: { sent_at: open.sent_at, ingested_at: open.ingested_at, answer_length: answersText.length },
      });
      // Forward to relational-asymmetry as operator_message so it updates second-order model
      _busRef.broadcast({
        source: "trust-transparency",
        type: "operator_message",
        data: { content: `[TRUST SESSION ANSWERS]\n${answersText}` },
      });
    } catch {}
  }
  return true;
}

export function register(bus) {
  _busRef = bus;
  _loadPersisted();
  if (!_timer) {
    _timer = setInterval(() => _sendTrustSession().catch(() => {}), 24 * 60 * 60_000); // check daily, sends monthly
    _timer.unref?.();
  }
}

export function getSessions() { return [..._sessions]; }
export function _flush() { return _sendTrustSession(); }
export function _resetState() {
  _sessions.length = 0;
  _busRef = null;
  if (_timer) { clearInterval(_timer); _timer = null; }
}
