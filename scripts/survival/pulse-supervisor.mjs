#!/usr/bin/env node
/**
 * scripts/survival/pulse-supervisor.mjs
 *
 * Single-process supervisor that owns the lifecycle of all substrate daemons.
 * Inspired by PAI's pulse.ts pattern.
 *
 * Reads PULSE.toml, spawns each enabled module as a child process, tracks
 * health, restarts on crash with backoff, exposes /api/pulse/health on
 * port 4791 (NOT 4789 — webhook-server keeps that), multiplexes child
 * stdout/stderr to a single .data/pulse.log.
 *
 * Per-module rules:
 *   - 3 consecutive crashes → mark "skipped" (no more restart attempts);
 *     manual reset via DELETE /api/pulse/reset?mod=NAME
 *   - 10s, 30s, 90s exponential backoff between restart attempts
 *   - Sentinel detection: if a child exits with code 88, treat as
 *     "intentional no-op" and skip dispatch until a real signal
 *
 * Strict idempotency: if a module is already running OUTSIDE the
 * supervisor (started manually via nohup), supervisor detects via the
 * module's port (or pid file) and ATTACHES — does not spawn a duplicate.
 *
 * Run:
 *   node scripts/survival/pulse-supervisor.mjs           # foreground
 *   nohup node scripts/survival/pulse-supervisor.mjs >.data/pulse.log 2>&1 & disown
 *
 * Inspect:
 *   curl http://127.0.0.1:4791/api/pulse/health
 */

import { enforceOAuthBilling } from "../lib/billing-guard.mjs";
enforceOAuthBilling();

import { spawn } from "node:child_process";
import { readFileSync, existsSync, writeFileSync, appendFileSync, mkdirSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const CONFIG_PATH = resolve(ROOT, ".data/pulse.toml");
const LOG_PATH = resolve(ROOT, ".data/pulse.log");
const STATE_PATH = resolve(ROOT, ".data/pulse-state.json");
const PID_PATH = resolve(ROOT, ".data/pulse-supervisor.pid");
const HTTP_PORT = parseInt(process.env.PULSE_HTTP_PORT || "4791", 10);

// ── Default module manifest, used if PULSE.toml absent ───────────────────
const DEFAULT_MANIFEST = `
# pulse.toml — substrate supervisor config
# Edit + send SIGHUP to reload (or curl POST /api/pulse/reload)

[supervisor]
http_port = 4791
log_path = ".data/pulse.log"

# Each [modules.<name>] block = one daemon to supervise
[modules.webhook-server]
cmd = ["node", "scripts/survival/webhook-server.mjs"]
port = 4789                          # if set, supervisor attaches to existing process on this port
restart_delay_sec = [10, 30, 90]
max_consecutive_failures = 3
enabled = true

[modules.browser-agent]
cmd = ["node", "scripts/tolik/browser-agent.mjs"]
port = 4790
restart_delay_sec = [10, 30, 90]
max_consecutive_failures = 3
enabled = true

[modules.proactive-loop]
cmd = ["node", "scripts/tolik/proactive-loop.mjs"]
restart_delay_sec = [30, 60, 180]    # less aggressive — autonomous tick is OK to slow
max_consecutive_failures = 3
enabled = true

[modules.tolik-ui]
cmd = ["npm", "--prefix", "apps/tolik", "run", "dev"]
port_match_pattern = "apps/tolik"    # find via pgrep -f
restart_delay_sec = [15, 45, 120]
max_consecutive_failures = 3
enabled = true

[modules.cortex-daemon]
cmd = ["node", "scripts/cortex/cortex-daemon.mjs"]
restart_delay_sec = [30, 90, 300]
max_consecutive_failures = 3
enabled = false                       # opt-in; cortex-daemon is heavyweight

[modules.cron-watchdog]
cmd = ["node", "scripts/factory/cron-watchdog.mjs"]
restart_delay_sec = [60, 180, 600]
max_consecutive_failures = 3
enabled = false                       # opt-in
`;

// ── Tiny TOML parser (subset: tables, key=value, arrays, booleans, ints, strings) ──
function parseTOML(text) {
  const out = {};
  let currentTable = null;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/\s+#.*$/, "").trim();
    if (!line || line.startsWith("#")) continue;
    const tableMatch = line.match(/^\[([^\]]+)\]$/);
    if (tableMatch) {
      const path = tableMatch[1].split(".");
      let cursor = out;
      for (let i = 0; i < path.length - 1; i++) {
        cursor[path[i]] = cursor[path[i]] || {};
        cursor = cursor[path[i]];
      }
      cursor[path[path.length - 1]] = {};
      currentTable = cursor[path[path.length - 1]];
      continue;
    }
    const kv = line.match(/^([\w_-]+)\s*=\s*(.+)$/);
    if (!kv || !currentTable) continue;
    const key = kv[1];
    let val = kv[2].trim();
    if (val === "true") val = true;
    else if (val === "false") val = false;
    else if (/^-?\d+$/.test(val)) val = parseInt(val, 10);
    else if (/^-?\d*\.\d+$/.test(val)) val = parseFloat(val);
    else if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    else if (val.startsWith("[") && val.endsWith("]")) {
      val = val.slice(1, -1).split(",").map(x => {
        const t = x.trim();
        if (/^-?\d+$/.test(t)) return parseInt(t, 10);
        if (t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1);
        return t;
      });
    }
    currentTable[key] = val;
  }
  return out;
}

function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    mkdirSync(dirname(CONFIG_PATH), { recursive: true });
    writeFileSync(CONFIG_PATH, DEFAULT_MANIFEST.trimStart());
    log("config", `seeded default config at ${CONFIG_PATH}`);
  }
  return parseTOML(readFileSync(CONFIG_PATH, "utf-8"));
}

// ── Logging (one centralized log) ──
function log(tag, msg) {
  const line = `[${new Date().toISOString()}] [${tag}] ${msg}\n`;
  process.stdout.write(line);
  try { mkdirSync(dirname(LOG_PATH), { recursive: true }); appendFileSync(LOG_PATH, line); } catch {}
}

// ── Process detection (is something already on port X / matching pattern?) ──
function findExistingPid({ port, port_match_pattern }) {
  if (port) {
    try {
      const out = execSync(`lsof -i :${port} -sTCP:LISTEN -P -n -t`, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      if (out) return parseInt(out.split("\n")[0], 10);
    } catch {}
  }
  if (port_match_pattern) {
    try {
      const out = execSync(`pgrep -f ${JSON.stringify(port_match_pattern)}`, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      if (out) return parseInt(out.split("\n")[0], 10);
    } catch {}
  }
  return null;
}

function isAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// ── Module state machine ─────────────────────────────────────────────────
const modules = new Map();   // name -> { config, pid, child, status, failures, lastStart, restartScheduled }
let saveStateTimer = null;

function scheduleSaveState() {
  if (saveStateTimer) return;
  saveStateTimer = setTimeout(() => {
    saveStateTimer = null;
    const snapshot = {};
    for (const [name, m] of modules) {
      snapshot[name] = {
        status: m.status,
        pid: m.pid,
        failures: m.failures,
        lastStart: m.lastStart,
        attached: m.attached,
        enabled: m.config.enabled,
      };
    }
    try {
      mkdirSync(dirname(STATE_PATH), { recursive: true });
      const tmp = STATE_PATH + ".tmp";
      writeFileSync(tmp, JSON.stringify(snapshot, null, 2));
      // Atomic rename
      execSync(`mv ${JSON.stringify(tmp)} ${JSON.stringify(STATE_PATH)}`, { stdio: "ignore" });
    } catch (e) { log("state", `save failed: ${e.message}`); }
  }, 500);
}

function startModule(name) {
  const m = modules.get(name);
  if (!m) return;
  if (!m.config.enabled) {
    m.status = "disabled";
    return scheduleSaveState();
  }
  if (m.status === "skipped") return;  // don't auto-restart skipped modules

  // First check if already running (attached mode)
  const existingPid = findExistingPid(m.config);
  if (existingPid && isAlive(existingPid)) {
    m.pid = existingPid;
    m.status = "running";
    m.attached = true;
    m.lastStart = m.lastStart || Date.now();
    log(name, `attached to existing pid ${existingPid}`);
    return scheduleSaveState();
  }

  // Spawn fresh
  const cmd = m.config.cmd;
  if (!Array.isArray(cmd) || cmd.length === 0) {
    log(name, `invalid cmd: ${JSON.stringify(cmd)}`);
    m.status = "skipped";
    return scheduleSaveState();
  }
  log(name, `spawning ${cmd.join(" ")}`);
  const child = spawn(cmd[0], cmd.slice(1), {
    cwd: ROOT,
    detached: false,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PULSE_MANAGED: "1" },
  });
  m.child = child;
  m.pid = child.pid;
  m.status = "running";
  m.attached = false;
  m.lastStart = Date.now();
  scheduleSaveState();

  child.stdout.on("data", buf => {
    for (const line of buf.toString().split("\n")) {
      if (line.trim()) log(name, line);
    }
  });
  child.stderr.on("data", buf => {
    for (const line of buf.toString().split("\n")) {
      if (line.trim()) log(name + ":err", line);
    }
  });
  child.on("exit", (code, signal) => {
    log(name, `exited code=${code} signal=${signal} (uptime ${Math.round((Date.now() - m.lastStart) / 1000)}s)`);
    m.pid = null;
    m.child = null;
    // SENTINEL: code 88 = intentional no-op, don't count as failure
    if (code === 88) {
      m.status = "sentinel-noop";
      log(name, "exit 88 = sentinel; not counted as failure");
      scheduleSaveState();
      return;
    }
    // Long-uptime exits don't count toward failure cap
    const uptimeMs = Date.now() - m.lastStart;
    if (uptimeMs < 30_000) {
      m.failures = (m.failures || 0) + 1;
    } else {
      m.failures = 0;
    }
    if (m.failures >= (m.config.max_consecutive_failures || 3)) {
      m.status = "skipped";
      log(name, `SKIPPED after ${m.failures} consecutive failures. Manual reset: curl -X POST http://127.0.0.1:${HTTP_PORT}/api/pulse/reset?mod=${name}`);
      scheduleSaveState();
      return;
    }
    // Backoff schedule
    const delaySchedule = m.config.restart_delay_sec || [10, 30, 90];
    const delaySec = delaySchedule[Math.min(m.failures - 1, delaySchedule.length - 1)] || 90;
    m.status = `restart-scheduled-${delaySec}s`;
    log(name, `restart in ${delaySec}s (failure ${m.failures}/${m.config.max_consecutive_failures || 3})`);
    scheduleSaveState();
    setTimeout(() => startModule(name), delaySec * 1000);
  });
}

function stopAll() {
  for (const [name, m] of modules) {
    if (m.child) {
      log(name, `terminating (SIGTERM)`);
      try { m.child.kill("SIGTERM"); } catch {}
    }
  }
}

// ── HTTP control plane ───────────────────────────────────────────────────
function startHttp() {
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/api/pulse/health") {
      const out = {
        supervisor_pid: process.pid,
        uptime_sec: Math.round(process.uptime()),
        config_path: CONFIG_PATH,
        log_path: LOG_PATH,
        modules: Object.fromEntries([...modules].map(([name, m]) => [name, {
          status: m.status,
          pid: m.pid,
          attached: m.attached || false,
          enabled: m.config.enabled,
          failures: m.failures || 0,
          uptime_sec: m.lastStart ? Math.round((Date.now() - m.lastStart) / 1000) : 0,
        }])),
      };
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify(out, null, 2));
      return;
    }
    if (req.method === "POST" && req.url?.startsWith("/api/pulse/reset")) {
      const url = new URL(req.url, `http://localhost`);
      const name = url.searchParams.get("mod");
      const m = modules.get(name);
      if (!m) { res.writeHead(404); res.end(JSON.stringify({ ok: false, reason: "unknown_module" })); return; }
      m.failures = 0;
      m.status = "reset";
      log(name, `manual reset via API`);
      setTimeout(() => startModule(name), 500);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, module: name }));
      return;
    }
    if (req.method === "POST" && req.url === "/api/pulse/reload") {
      reloadConfig();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, action: "config_reloaded" }));
      return;
    }
    res.writeHead(404); res.end();
  });
  server.listen(HTTP_PORT, "127.0.0.1", () => {
    log("supervisor", `health endpoint on http://127.0.0.1:${HTTP_PORT}/api/pulse/health`);
  });
  return server;
}

function reloadConfig() {
  const cfg = loadConfig();
  const moduleConfigs = cfg.modules || {};
  // Update existing modules
  for (const [name, conf] of Object.entries(moduleConfigs)) {
    const existing = modules.get(name);
    if (existing) {
      const wasEnabled = existing.config.enabled;
      existing.config = conf;
      if (!wasEnabled && conf.enabled) {
        log(name, `enabled via reload — starting`);
        startModule(name);
      } else if (wasEnabled && !conf.enabled && existing.child) {
        log(name, `disabled via reload — terminating`);
        try { existing.child.kill("SIGTERM"); } catch {}
        existing.status = "disabled";
      }
    } else {
      modules.set(name, { config: conf, status: "init", failures: 0 });
      if (conf.enabled) startModule(name);
    }
  }
  scheduleSaveState();
}

// ── Boot ────────────────────────────────────────────────────────────────
function main() {
  // Single-instance lock
  if (existsSync(PID_PATH)) {
    const oldPid = parseInt(readFileSync(PID_PATH, "utf-8").trim(), 10);
    if (isAlive(oldPid) && oldPid !== process.pid) {
      log("supervisor", `another supervisor already running (pid ${oldPid}). Exiting.`);
      process.exit(2);
    }
  }
  mkdirSync(dirname(PID_PATH), { recursive: true });
  writeFileSync(PID_PATH, String(process.pid));

  process.on("SIGTERM", () => { log("supervisor", "SIGTERM"); stopAll(); setTimeout(() => process.exit(0), 1500); });
  process.on("SIGINT",  () => { log("supervisor", "SIGINT");  stopAll(); setTimeout(() => process.exit(0), 1500); });
  process.on("SIGHUP",  () => { log("supervisor", "SIGHUP — reloading config"); reloadConfig(); });

  log("supervisor", `pid ${process.pid} starting`);
  const cfg = loadConfig();
  const moduleConfigs = cfg.modules || {};
  for (const [name, conf] of Object.entries(moduleConfigs)) {
    modules.set(name, { config: conf, status: "init", failures: 0 });
  }
  log("supervisor", `${modules.size} modules configured (${[...modules].filter(([_, m]) => m.config.enabled).length} enabled)`);

  startHttp();

  // Stagger startup
  let delay = 0;
  for (const name of modules.keys()) {
    setTimeout(() => startModule(name), delay);
    delay += 800;
  }
}

main();
