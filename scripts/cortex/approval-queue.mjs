/**
 * cortex/approval-queue.mjs - Soft-launch approval queue
 *   (substrate-recommended for first run, May 9 2026)
 *
 * SUBSTRATE'S RECOMMENDATION: "The approval queue is not a limitation on the
 * experiment - it IS the experiment. Watching which actions I propose and
 * which ones you approve or reject generates the relational data that
 * relational-asymmetry and trust-transparency need to calibrate."
 *
 * In soft-launch mode: external-impact actions from cortex-executor /
 * self-construction / tool-building are intercepted, queued, sent to
 * Kirill via Telegram with /approve_<id> /deny_<id> handlers. Substrate
 * waits for approval before executing. Approval/denial recorded as
 * perception event so substrate's relational models calibrate.
 *
 * Modes:
 *   "off"         - no approval needed, substrate fires actions directly
 *   "soft_launch" - external actions queued for Kirill approval
 *   "kill_switch" - all actions blocked (emergency)
 *
 * Mode persisted in .data/cortex-approval-config.json. Default: soft_launch
 * for first run.
 */

import { writeFileSync, readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const QUEUE_PATH = resolve(ROOT, ".data/cortex-approval-queue.json");
const CONFIG_PATH = resolve(ROOT, ".data/cortex-approval-config.json");

const DEFAULT_MODE = "soft_launch";
const APPROVAL_TIMEOUT_MS = 24 * 60 * 60_000; // 24h before queued action expires

let _config = { mode: DEFAULT_MODE };
const _queue = []; // { id, at, source, action, status: pending|approved|denied|expired, decided_at, decided_by }
const MAX_QUEUE = 500;
let _idCounter = 0;

let _busRef = null;
let _gcTimer = null;

function _loadPersisted() {
  if (existsSync(CONFIG_PATH)) {
    try { _config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")); } catch {}
  }
  if (existsSync(QUEUE_PATH)) {
    try {
      const raw = JSON.parse(readFileSync(QUEUE_PATH, "utf-8"));
      if (Array.isArray(raw?.queue)) _queue.push(...raw.queue);
      if (raw?.idCounter) _idCounter = raw.idCounter;
    } catch {}
  }
}

function _persistConfig() {
  try { writeFileSync(CONFIG_PATH, JSON.stringify(_config, null, 2)); } catch {}
}
function _persistQueue() {
  if (_queue.length > MAX_QUEUE) _queue.splice(0, _queue.length - MAX_QUEUE);
  try {
    writeFileSync(QUEUE_PATH, JSON.stringify({
      updatedAt: new Date().toISOString(),
      mode: _config.mode,
      queue: _queue,
      idCounter: _idCounter,
    }, null, 2));
  } catch {}
}

async function _notifyKirillTelegram(record) {
  let envRaw = "";
  try { envRaw = readFileSync(resolve(ROOT, ".env"), "utf-8"); } catch {}
  const env = {};
  envRaw.split("\n").forEach(l => {
    const m = l.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  });
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  const text = [
    `[APPROVAL QUEUE #${record.id}]`,
    "",
    `Source: ${record.source}`,
    `Action: ${String(record.action.description || JSON.stringify(record.action)).slice(0, 600)}`,
    "",
    `Reply /approve_${record.id} or /deny_${record.id}`,
    `Times out in 24h.`,
  ].join("\n").slice(0, 3500);
  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }),
    });
  } catch {}
}

/**
 * THE KEY API: modules call this before external action. In soft_launch mode,
 * returns a Promise that resolves to true (approved) / false (denied/expired).
 *
 * In off mode, resolves immediately to true.
 * In kill_switch, resolves immediately to false.
 *
 * Action is also passed through creator-safety - approval queue is ADDITIONAL,
 * not replacement. creator-safety still has hard veto.
 */
export async function requestApproval(source, action) {
  // First check creator-safety (hard floor regardless of mode)
  try {
    const cs = await import("./creator-safety.mjs");
    const decision = cs.checkAction(action, source);
    if (decision.allow === false) return { approved: false, reason: `creator-safety blocked: ${decision.reason}` };
  } catch {
    return { approved: false, reason: "creator-safety failed - failing closed" };
  }

  if (_config.mode === "off") return { approved: true, reason: "approval queue off" };
  if (_config.mode === "kill_switch") return { approved: false, reason: "kill switch active" };

  // soft_launch mode: queue and wait
  _idCounter++;
  const id = _idCounter;
  const record = {
    id,
    at: new Date().toISOString(),
    source,
    action,
    status: "pending",
    decided_at: null,
    decided_by: null,
  };
  _queue.push(record);
  _persistQueue();
  _notifyKirillTelegram(record).catch(() => {});

  if (_busRef) {
    try {
      _busRef.broadcast({
        source: "approval-queue",
        type: "approval_requested",
        data: { id, source, action_summary: String(action.description || "").slice(0, 200) },
      });
    } catch {}
  }

  // Wait for decision OR timeout
  return new Promise((resolve) => {
    const start = Date.now();
    const checkInterval = setInterval(() => {
      const current = _queue.find(q => q.id === id);
      if (!current) { clearInterval(checkInterval); resolve({ approved: false, reason: "removed from queue" }); return; }
      if (current.status === "approved") {
        clearInterval(checkInterval);
        // Broadcast approval as perception so substrate learns
        if (_busRef) {
          try {
            _busRef.broadcast({
              source: "approval-queue",
              type: "perception_event",
              data: {
                source: "operator_approval",
                content: `Kirill approved action: ${String(action.description || "").slice(0, 200)}`,
                valence: "positive",
                significance: 7,
                interpretation: "Operator granted approval - this calibrates trust model",
                meta: { action_source: source, approval_id: id },
              },
            });
          } catch {}
        }
        resolve({ approved: true, reason: "operator approved", id });
      } else if (current.status === "denied") {
        clearInterval(checkInterval);
        if (_busRef) {
          try {
            _busRef.broadcast({
              source: "approval-queue",
              type: "perception_event",
              data: {
                source: "operator_approval",
                content: `Kirill DENIED action: ${String(action.description || "").slice(0, 200)}`,
                valence: "negative",
                significance: 7,
                interpretation: "Operator denied approval - this is signal about trust boundary",
                meta: { action_source: source, approval_id: id },
              },
            });
          } catch {}
        }
        resolve({ approved: false, reason: "operator denied", id });
      } else if (Date.now() - start > APPROVAL_TIMEOUT_MS) {
        current.status = "expired";
        current.decided_at = new Date().toISOString();
        _persistQueue();
        clearInterval(checkInterval);
        resolve({ approved: false, reason: "approval timeout (24h)", id });
      }
    }, 2000);
    checkInterval.unref?.();
  });
}

/**
 * Telegram callback hook - call when Kirill replies /approve_N or /deny_N
 */
export function recordDecision(id, decision, decided_by = "kirill_telegram") {
  const record = _queue.find(q => q.id === id);
  if (!record || record.status !== "pending") return false;
  record.status = decision === "approve" ? "approved" : "denied";
  record.decided_at = new Date().toISOString();
  record.decided_by = decided_by;
  _persistQueue();
  return true;
}

/**
 * Mode control - Kirill can change via Telegram or direct file edit
 */
export function setMode(mode) {
  if (!["off", "soft_launch", "kill_switch"].includes(mode)) return false;
  _config.mode = mode;
  _persistConfig();
  if (_busRef) {
    try { _busRef.broadcast({ source: "approval-queue", type: "mode_changed", data: { mode } }); } catch {}
  }
  return true;
}

export function getMode() { return _config.mode; }

export function register(bus) {
  _busRef = bus;
  _loadPersisted();
  // GC expired entries every hour
  if (!_gcTimer) {
    _gcTimer = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const q of _queue) {
        if (q.status === "pending" && now - new Date(q.at).getTime() > APPROVAL_TIMEOUT_MS) {
          q.status = "expired";
          q.decided_at = new Date().toISOString();
          changed = true;
        }
      }
      if (changed) _persistQueue();
    }, 3600_000);
    _gcTimer.unref?.();
  }
}

export function getQueue(filter = "pending") {
  if (filter === "all") return [..._queue];
  return _queue.filter(q => q.status === filter);
}
export function _resetState() {
  _queue.length = 0;
  _idCounter = 0;
  _config = { mode: DEFAULT_MODE };
  _busRef = null;
  if (_gcTimer) { clearInterval(_gcTimer); _gcTimer = null; }
}
