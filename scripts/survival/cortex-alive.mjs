/**
 * scripts/survival/cortex-alive.mjs
 *
 * Long-running process that holds all 36 cortex modules registered on
 * a single shared state-bus, kept alive indefinitely.
 *
 * Per ARCHITECTURE.md, no process before today actually held the full
 * launcher-registered module graph alive. cortex-daemon.mjs is a
 * separate higher-level orchestrator with its own concerns. This file
 * is the explicit bus carrier: boot all phases, subscribe to bus
 * traffic, write heartbeat + bus log so Kirill can verify activity.
 *
 * Run: nohup node scripts/survival/cortex-alive.mjs > .data/cortex-alive.log 2>&1 &
 *      echo $! > .data/cortex-alive.pid
 * Stop: kill $(cat .data/cortex-alive.pid)
 */

import { writeFileSync, appendFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import * as bus from "../cortex/state-bus.mjs";
import { launch } from "../cortex/cortex-launcher.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const HEARTBEAT_PATH = resolve(ROOT, ".data/cortex-alive-heartbeat.json");
const BUS_LOG_PATH = resolve(ROOT, ".data/cortex-alive-bus.jsonl");
const PID_PATH = resolve(ROOT, ".data/cortex-alive.pid");

function ensureDir(p) { const d = dirname(p); if (!existsSync(d)) mkdirSync(d, { recursive: true }); }

writeFileSync(PID_PATH, String(process.pid));
ensureDir(BUS_LOG_PATH);

const startedAt = new Date().toISOString();
let busEventCount = 0;
let bySource = new Map();
let byType = new Map();

console.log(`[cortex-alive] starting at ${startedAt} pid=${process.pid}`);

// Subscribe to ALL bus events via wildcard before booting.
bus.subscribe("*", (entry) => {
  busEventCount++;
  bySource.set(entry.source, (bySource.get(entry.source) || 0) + 1);
  byType.set(entry.type, (byType.get(entry.type) || 0) + 1);
  try {
    appendFileSync(BUS_LOG_PATH, JSON.stringify({
      at: new Date().toISOString(),
      source: entry.source,
      type: entry.type,
      data_keys: entry.data ? Object.keys(entry.data).slice(0, 8) : [],
    }) + "\n");
  } catch {}
});

console.log(`[cortex-alive] booting cortex-launcher...`);
let bootResult;
try {
  bootResult = await launch({ verbose: false, abort_on_phase_fail: false });
} catch (e) {
  console.error(`[cortex-alive] FATAL boot: ${e.message}`);
  process.exit(1);
}

console.log(`[cortex-alive] boot complete: ${bootResult.total_modules_registered} modules, ${bootResult.total_failures} failures`);

// Heartbeat every minute so Kirill / external monitors can verify aliveness.
function heartbeat() {
  const top10Sources = [...bySource.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const top10Types = [...byType.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  writeFileSync(HEARTBEAT_PATH, JSON.stringify({
    at: new Date().toISOString(),
    started_at: startedAt,
    pid: process.pid,
    uptime_seconds: Math.round((Date.now() - new Date(startedAt).getTime()) / 1000),
    modules_registered: bootResult.total_modules_registered,
    boot_failures: bootResult.total_failures,
    bus_event_count_total: busEventCount,
    top_sources: Object.fromEntries(top10Sources),
    top_types: Object.fromEntries(top10Types),
  }, null, 2));
}
heartbeat();
const hbTimer = setInterval(heartbeat, 60_000);
hbTimer.unref?.();

// Keep process alive forever — modules use setInterval with unref() so they
// would let process exit. We hold a strong reference to keep alive.
const keepAlive = setInterval(() => {}, 1 << 30);

process.on("SIGTERM", () => {
  console.log(`[cortex-alive] SIGTERM received, exiting`);
  clearInterval(keepAlive);
  clearInterval(hbTimer);
  heartbeat();
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log(`[cortex-alive] SIGINT received, exiting`);
  clearInterval(keepAlive);
  clearInterval(hbTimer);
  heartbeat();
  process.exit(0);
});
