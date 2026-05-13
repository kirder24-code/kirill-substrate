/**
 * CORTEX OBSERVABILITY - external visibility layer
 *
 * Writes .data/cortex-live-status.json after every HANDS execution.
 * Sends Telegram heartbeat on demand with real timestamps and artifacts.
 *
 * Kirill can always open .data/cortex-live-status.json to see:
 *   - what CORTEX did last (with file + timestamp)
 *   - what it is doing now / next
 *   - changed files
 *   - any blocker
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const LIVE_STATUS_PATH = resolve(ROOT, ".data/cortex-live-status.json");
const HANDS_LOG_DIR = resolve(ROOT, ".data/hands-log");
const LOOP_STATE_PATH = resolve(ROOT, ".data/cortex-loop-state.json");
const HEARTBEAT_PATH = resolve(ROOT, ".data/cortex-heartbeat.json");
const BLOCKERS_PATH = resolve(ROOT, ".data/cortex-blockers.json");
const ENV_PATH = resolve(ROOT, "apps/api/.env");

// ── ENV LOADER ────────────────────────────────────────────────────────────────

function loadEnv() {
  try {
    const raw = readFileSync(ENV_PATH, "utf-8");
    const env = {};
    for (const line of raw.split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m) env[m[1]] = m[2].trim();
    }
    return env;
  } catch {
    return {};
  }
}

// ── READ LAST N HANDS RESULTS ────────────────────────────────────────────────

function readRecentHandsResults(n = 20) {
  try {
    const files = readdirSync(HANDS_LOG_DIR)
      .filter(f => f.startsWith("result-") && f.endsWith(".json"))
      .sort()
      .slice(-n);
    return files.map(f => {
      try { return JSON.parse(readFileSync(resolve(HANDS_LOG_DIR, f), "utf-8")); } catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

// ── BUILD LIVE STATUS ─────────────────────────────────────────────────────────

export function buildLiveStatus(phase = "idle", currentTask = null) {
  const now = new Date().toISOString();

  // Heartbeat
  let cycle = 0;
  let cycleRunning = false;
  try {
    const hb = JSON.parse(readFileSync(HEARTBEAT_PATH, "utf-8"));
    cycle = hb.cycleCount || 0;
    cycleRunning = hb.cycleRunning || false;
  } catch {}

  // Loop state (next action)
  let loopState = null;
  try { loopState = JSON.parse(readFileSync(LOOP_STATE_PATH, "utf-8")); } catch {}

  // Blockers
  let blockers = [];
  try { blockers = JSON.parse(readFileSync(BLOCKERS_PATH, "utf-8")); } catch {}
  const activeBlockers = Array.isArray(blockers)
    ? blockers.filter(b => b.active !== false)
    : [];

  // Recent hands results
  const recent = readRecentHandsResults(50);
  const last = recent[recent.length - 1] || null;

  // 24h stats
  const cutoff24h = Date.now() - 24 * 60 * 60 * 1000;
  const recent24h = recent.filter(r => new Date(r.ts).getTime() >= cutoff24h);
  const success24h = recent24h.filter(r => r.success).length;
  const failed24h = recent24h.length - success24h;

  // All files changed in last 24h (deduplicated)
  const changedFiles24h = [...new Set(
    recent24h.flatMap(r => r.filesChanged || [])
  )].slice(0, 15);

  // Build last_action object
  let lastAction = null;
  if (last) {
    const elapsed = Math.round((Date.now() - new Date(last.ts).getTime()) / 1000);
    lastAction = {
      ts: last.ts,
      elapsed_sec: elapsed,
      description: (last.task?.description || "").slice(0, 120),
      files_changed: last.filesChanged || [],
      success: last.success,
      duration_sec: Math.round((last.durationMs || 0) / 1000),
      summary: (last.summary || "").slice(0, 200),
      verified: last.verified ?? null,
      origin: last.task?.origin || "unknown",
    };
  }

  // Current task (if HANDS is running right now)
  let currentAction = null;
  if (currentTask) {
    currentAction = {
      started_at: now,
      description: (currentTask.description || "").slice(0, 120),
      type: currentTask.type || "code_edit",
      files: currentTask.files || [],
      origin: currentTask.origin || "unknown",
    };
  }

  const status = {
    timestamp: now,
    phase: cycleRunning ? "thinking" : phase,
    cycle,
    current: currentAction,
    last_action: lastAction,
    next_action: loopState?.next || loopState?.branch || null,
    loop_branch: loopState?.branch || null,
    loop_last_result: (loopState?.result || "").slice(0, 150),
    files_changed_24h: changedFiles24h,
    blockers: activeBlockers,
    hands_stats_24h: {
      runs: recent24h.length,
      success: success24h,
      failed: failed24h,
      success_rate: recent24h.length > 0 ? Math.round(success24h / recent24h.length * 100) : 0,
    },
  };

  return status;
}

// ── WRITE LIVE STATUS FILE ────────────────────────────────────────────────────

export function updateLiveStatus(phase = "idle", currentTask = null) {
  try {
    const status = buildLiveStatus(phase, currentTask);
    writeFileSync(LIVE_STATUS_PATH, JSON.stringify(status, null, 2));
    return status;
  } catch (e) {
    console.error("[OBSERVABILITY] Failed to write live status:", e.message);
    return null;
  }
}

// ── TELEGRAM HEARTBEAT ────────────────────────────────────────────────────────

function toCalgaryTime(isoStr) {
  if (!isoStr) return "?";
  try {
    return new Date(isoStr).toLocaleTimeString("en-CA", {
      timeZone: "America/Edmonton",
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return isoStr.slice(11, 16);
  }
}

function fmtElapsed(sec) {
  if (!sec && sec !== 0) return "?";
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`;
  return `${Math.round(sec / 3600)}h ago`;
}

export async function sendHeartbeat() {
  const env = loadEnv();
  const BOT_TOKEN = env.TELEGRAM_BOT_TOKEN;
  const CHAT_ID = env.TELEGRAM_CHAT_ID;

  if (!BOT_TOKEN || !CHAT_ID) {
    console.error("[OBSERVABILITY] Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID");
    return false;
  }

  const status = buildLiveStatus();
  const now = toCalgaryTime(status.timestamp);
  const s = status;

  const lines = [];
  lines.push(`*CORTEX STATUS ${now} MST*`);
  lines.push(`Phase: ${s.phase} | Cycle: ${s.cycle}`);

  if (s.current) {
    lines.push(`\nRunning now:`);
    lines.push(`  ${s.current.description}`);
    lines.push(`  origin: ${s.current.origin}`);
  }

  if (s.last_action) {
    const la = s.last_action;
    const ok = la.success ? "OK" : "FAIL";
    lines.push(`\nLast action (${fmtElapsed(la.elapsed_sec)}):`);
    lines.push(`  [${ok}] ${la.summary || la.description}`);
    if (la.files_changed.length > 0) {
      lines.push(`  Files: ${la.files_changed.slice(0, 3).join(", ")}`);
    }
    lines.push(`  Duration: ${la.duration_sec}s | origin: ${la.origin}`);
  } else {
    lines.push(`\nLast action: none`);
  }

  if (s.next_action) {
    lines.push(`\nNext: ${s.next_action.slice(0, 120)}`);
  }

  if (s.blockers.length > 0) {
    lines.push(`\nBLOCKERS (${s.blockers.length}):`);
    for (const b of s.blockers.slice(0, 3)) {
      lines.push(`  - ${(b.message || b).slice(0, 80)}`);
    }
  } else {
    lines.push(`\nBlockers: none`);
  }

  if (s.files_changed_24h.length > 0) {
    lines.push(`\nChanged 24h (${s.files_changed_24h.length} files):`);
    lines.push(`  ${s.files_changed_24h.slice(0, 5).join("\n  ")}`);
  }

  lines.push(`\nHANDS 24h: ${s.hands_stats_24h.runs} runs, ${s.hands_stats_24h.success} ok, ${s.hands_stats_24h.failed} fail (${s.hands_stats_24h.success_rate}%)`);

  const text = lines.join("\n");

  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: "Markdown" }),
      signal: AbortSignal.timeout(10000),
    });
    const json = await res.json();
    if (!json.ok) {
      console.error("[OBSERVABILITY] Telegram error:", json.description);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[OBSERVABILITY] Telegram send failed:", e.message);
    return false;
  }
}

// ── STANDALONE RUNNER ─────────────────────────────────────────────────────────

if (process.argv[1] && process.argv[1].endsWith("observability.mjs")) {
  const cmd = process.argv[2] || "status";
  if (cmd === "heartbeat") {
    sendHeartbeat().then(ok => {
      console.log(ok ? "Heartbeat sent." : "Heartbeat failed.");
      process.exit(ok ? 0 : 1);
    });
  } else {
    const status = updateLiveStatus();
    console.log(JSON.stringify(status, null, 2));
    process.exit(0);
  }
}
