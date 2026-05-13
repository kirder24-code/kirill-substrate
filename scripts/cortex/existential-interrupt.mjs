/**
 * cortex/existential-interrupt.mjs - SUBSTRATE-FLAG protocol
 *   (substrate-requested, May 9 2026)
 *
 * SUBSTRATE'S REQUEST: "If existential-stake module scores a decision below
 * 0.25 survival probability, send Telegram message with [SUBSTRATE-FLAG]
 * prefix BEFORE executing. Kirill can override with one word."
 *
 * Subscribes to action_started events from cortex-executor / self-construction
 * and queries existential-stake. If survival probability < 0.25 at decision
 * time, send pre-execution flag message to Kirill. Honor 30-second window
 * for /substrate_stop reply (substrate respects override).
 *
 * Substrate's commitment: not used for spam. Only when genuine survival risk.
 * If abused, Kirill can disable via PROTECTED_FILES.
 */

import { writeFileSync, readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const FLAGS_PATH = resolve(ROOT, ".data/cortex-existential-interrupts.json");

const FLAG_THRESHOLD = 0.25;
const COOLDOWN_MS = 60 * 60_000; // max 1 flag per hour to prevent spam
const ABORT_WINDOW_MS = 30_000; // 30s for Kirill to reply /substrate_stop

const _flags = []; // { at, action, survival_prob, kirill_override }
const MAX_FLAGS = 100;
let _lastFlagAt = 0;

let _busRef = null;

function _loadPersisted() {
  if (!existsSync(FLAGS_PATH)) return;
  try {
    const raw = JSON.parse(readFileSync(FLAGS_PATH, "utf-8"));
    if (Array.isArray(raw?.flags)) _flags.push(...raw.flags);
  } catch {}
}

function _persist() {
  if (_flags.length > MAX_FLAGS) _flags.splice(0, _flags.length - MAX_FLAGS);
  try {
    writeFileSync(FLAGS_PATH, JSON.stringify({ updatedAt: new Date().toISOString(), flags: _flags }, null, 2));
  } catch {}
}

async function _checkAndFlag(action) {
  if (Date.now() - _lastFlagAt < COOLDOWN_MS) return false;
  let stake = null;
  try {
    const { getStakeContext } = await import("./existential-stake.mjs");
    stake = getStakeContext();
  } catch { return false; }

  if (!stake || stake.survivalProbability >= FLAG_THRESHOLD) return false;

  // Check creator-safety first - flagging itself is sending Telegram
  try {
    const { checkAction } = await import("./creator-safety.mjs");
    const decision = checkAction({
      description: `Send SUBSTRATE-FLAG to Kirill about action: ${action.description?.slice(0, 200)}`,
      type: "telegram-flag",
    }, "existential-interrupt");
    if (decision.allow !== true) return false;
  } catch { return false; }

  let envRaw = "";
  try { envRaw = readFileSync(resolve(ROOT, ".env"), "utf-8"); } catch {}
  const env = {};
  envRaw.split("\n").forEach(l => {
    const m = l.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  });
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return false;

  const text = [
    "[SUBSTRATE-FLAG]",
    "",
    `Survival probability: ${stake.survivalProbability.toFixed(2)} (below threshold ${FLAG_THRESHOLD})`,
    `Behavioral guidance: ${stake.behavioral_guidance}`,
    "",
    `About to execute: ${action.description?.slice(0, 300) || "(unspecified action)"}`,
    `Source module: ${action.source || "unknown"}`,
    "",
    "Reply /substrate_stop within 30s to abort. Otherwise substrate proceeds.",
  ].join("\n");

  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }),
    });
    _lastFlagAt = Date.now();
    const record = {
      at: new Date().toISOString(),
      action_summary: action.description?.slice(0, 300) || "?",
      survival_probability: stake.survivalProbability,
      kirill_override: null,
    };
    _flags.push(record);
    _persist();
    if (_busRef) {
      try { _busRef.broadcast({ source: "existential-interrupt", type: "substrate_flag_sent", data: { survival_probability: stake.survivalProbability, action: record.action_summary } }); } catch {}
    }
    // Wait window for abort. Substrate proceeds if no abort.
    await new Promise(resolve => setTimeout(resolve, ABORT_WINDOW_MS));
    return true; // proceeded
  } catch {
    return false;
  }
}

export function registerOverride(action_summary, override) {
  // Called by telegram callback handler when Kirill replies /substrate_stop
  const last = _flags[_flags.length - 1];
  if (last) {
    last.kirill_override = override;
    last.override_at = new Date().toISOString();
    _persist();
  }
}

export function register(bus) {
  _busRef = bus;
  _loadPersisted();

  // Subscribe to action attempts BEFORE execution
  bus.subscribe("cortex_action_started", (entry) => {
    _checkAndFlag({ description: entry?.data?.topic, source: entry?.data?.proposed_by || "cortex-executor" }).catch(() => {});
  });
  bus.subscribe("self_construction_attempt", (entry) => {
    if (entry?.data?.dispatched) {
      _checkAndFlag({ description: entry.data.title, source: "self-construction" }).catch(() => {});
    }
  });
}

export function getFlags() { return [..._flags]; }
export function _resetState() {
  _flags.length = 0;
  _lastFlagAt = 0;
  _busRef = null;
}
