/**
 * CORTEX SELF-REBUILD PACKAGE
 *
 * Builds a complete snapshot of the CORTEX system state that could be used
 * to reconstruct or audit the entire brain from scratch.
 *
 * Collects:
 *   - All 55+ scripts/cortex modules (name, size, exports, layer)
 *   - All .data/cortex-*.json state files (full content snapshot)
 *   - Process status (daemon, chat, orchestrator)
 *   - DB table summary
 *   - Git log (last 10 commits)
 *   - Config + model router snapshot
 *   - Broken module list if any
 *
 * Writes to: .data/cortex-rebuild-package.json
 * Sends summary to Telegram.
 *
 * Run: node scripts/cortex/self-rebuild-package.mjs
 */

import { spawnSync, execSync } from "child_process";
import {
  readdirSync, readFileSync, existsSync, writeFileSync, statSync, mkdirSync,
} from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT       = resolve(__dirname, "../..");
const CORTEX_DIR = __dirname;
const DATA_DIR   = resolve(ROOT, ".data");
const ENV_PATH   = resolve(ROOT, "apps/api/.env");
const OUT_PATH   = resolve(DATA_DIR, "cortex-rebuild-package.json");
const DEADLINE_MS = 23 * 60 * 1000; // 23-min hard cut (leaves 2 min to send)

const startedAt = Date.now();

// ── ENV ───────────────────────────────────────────────────────────────────────

function loadEnv() {
  try {
    return Object.fromEntries(
      readFileSync(ENV_PATH, "utf-8").split("\n")
        .filter(l => l && !l.startsWith("#") && l.includes("="))
        .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
    );
  } catch { return {}; }
}

const env = loadEnv();
const TG_TOKEN = env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID  = env.TELEGRAM_CHAT_ID   || process.env.TELEGRAM_CHAT_ID;

// ── HELPERS ───────────────────────────────────────────────────────────────────

function elapsed() {
  return ((Date.now() - startedAt) / 1000).toFixed(1) + "s";
}

function log(msg) {
  console.log(`[${elapsed()}] ${msg}`);
}

async function tg(text) {
  if (!TG_TOKEN || !CHAT_ID) { log("[TG] No token/chat - skip"); return false; }
  try {
    const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, text: text.slice(0, 4096), parse_mode: "Markdown" }),
    });
    const body = await res.json();
    if (!body.ok) { log(`[TG] API error: ${body.description}`); return false; }
    return true;
  } catch (e) {
    log(`[TG] Fetch error: ${e.message}`);
    return false;
  }
}

function safeJson(p) {
  try { return JSON.parse(readFileSync(p, "utf-8")); } catch { return null; }
}

// ── 1. MODULE SCAN ────────────────────────────────────────────────────────────

log("Step 1: scanning cortex modules...");

const allModules = readdirSync(CORTEX_DIR).filter(f => f.endsWith(".mjs")).sort();
const moduleDetails = [];
const brokenModules = [];

for (const file of allModules) {
  const fullPath = resolve(CORTEX_DIR, file);
  const stat = statSync(fullPath);
  const raw = readFileSync(fullPath, "utf-8");

  // Check syntax
  const syntaxCheck = spawnSync("node", ["--check", fullPath], { encoding: "utf-8" });
  const syntaxOk = syntaxCheck.status === 0;

  // Extract exports
  const exportMatches = [...raw.matchAll(/export\s+(?:async\s+)?function\s+(\w+)|export\s+const\s+(\w+)/g)]
    .map(m => m[1] || m[2])
    .filter(Boolean);

  // Extract first JSDoc comment as role description
  const docMatch = raw.match(/\/\*\*\s*\n\s*\*\s*(.+?)(?:\n|$)/);
  const role = docMatch ? docMatch[1].replace(/^\*\s*/, "").trim().slice(0, 120) : "";

  const entry = {
    file,
    sizeBytes: stat.size,
    sizeKb: (stat.size / 1024).toFixed(1),
    mtime: stat.mtime.toISOString(),
    syntaxOk,
    exports: exportMatches,
    role,
  };

  if (!syntaxOk) {
    brokenModules.push({ file, error: (syntaxCheck.stderr || "").trim().slice(0, 200) });
  }
  moduleDetails.push(entry);
}

log(`Modules: ${moduleDetails.length} total, ${brokenModules.length} broken`);

// ── 2. STATE FILE SNAPSHOT ────────────────────────────────────────────────────

log("Step 2: snapshotting state files...");

const cortexStateFiles = readdirSync(DATA_DIR)
  .filter(f => f.startsWith("cortex-") && f.endsWith(".json"))
  .sort();

const stateSnapshot = {};
const stateMeta = [];

for (const sf of cortexStateFiles) {
  const p = resolve(DATA_DIR, sf);
  const stat = statSync(p);
  const content = safeJson(p);
  const raw = readFileSync(p, "utf-8");

  stateSnapshot[sf] = content;
  stateMeta.push({
    file: sf,
    sizeBytes: stat.size,
    mtime: stat.mtime.toISOString(),
    valid: content !== null,
    topKeys: content && typeof content === "object" ? Object.keys(content).slice(0, 8) : [],
  });
}

log(`State files: ${cortexStateFiles.length} snapshotted`);

// ── 3. PROCESS STATUS ─────────────────────────────────────────────────────────

log("Step 3: checking processes...");

const processes = {};
try {
  const ps = execSync("ps aux", { encoding: "utf-8" });
  processes.daemon       = ps.includes("cortex-daemon.mjs")   ? "running" : "stopped";
  processes.chat         = ps.includes("chat-server.mjs")      ? "running" : "stopped";
  processes.orchestrator = ps.includes("orchestrator-loop.mjs") ? "running" : "stopped";
  processes.telegram     = ps.includes("telegram-control.mjs")  ? "running" : "stopped";
  processes.sonnet_bots  = ps.includes("sonnet-bots-daemon.mjs") ? "running" : "stopped";
} catch (e) {
  processes.error = e.message;
}

// ── 4. GIT LOG ────────────────────────────────────────────────────────────────

log("Step 4: reading git history...");

let gitLog = [];
try {
  const raw = execSync("git -C . log --oneline -15 2>/dev/null", { cwd: ROOT, encoding: "utf-8" });
  gitLog = raw.trim().split("\n").filter(Boolean);
} catch {}

// ── 5. DB SUMMARY ─────────────────────────────────────────────────────────────

log("Step 5: DB table summary...");

const DB_PATH = resolve(DATA_DIR, "linkedin-brand-os.sqlite");
let dbSummary = null;

if (existsSync(DB_PATH)) {
  try {
    // Use sqlite3 CLI if available
    const tablesRaw = execSync(`sqlite3 "${DB_PATH}" ".tables"`, { encoding: "utf-8" }).trim();
    const tables = tablesRaw.split(/\s+/).filter(Boolean);
    const tableCounts = {};
    for (const t of tables) {
      try {
        const count = execSync(`sqlite3 "${DB_PATH}" "SELECT COUNT(*) FROM ${t};"`, { encoding: "utf-8" }).trim();
        tableCounts[t] = parseInt(count, 10);
      } catch { tableCounts[t] = -1; }
    }
    dbSummary = { tables, tableCounts, path: DB_PATH };
  } catch {
    dbSummary = { error: "sqlite3 CLI not available or failed", path: DB_PATH, exists: true };
  }
} else {
  dbSummary = { exists: false };
}

// ── 6. LOOP STATE SNAPSHOT ────────────────────────────────────────────────────

const loopState   = safeJson(resolve(DATA_DIR, "cortex-loop-state.json"));
const sharedState = safeJson(resolve(DATA_DIR, "cortex-shared-state.json"));
const config      = safeJson(resolve(DATA_DIR, "cortex-config.json"));
const heartbeat   = safeJson(resolve(DATA_DIR, "cortex-heartbeat.json"));
const modelRouter = safeJson(resolve(DATA_DIR, "cortex-model-router.json"));

// ── 7. ASSEMBLE PACKAGE ───────────────────────────────────────────────────────

log("Step 7: assembling rebuild package...");

const pkg = {
  meta: {
    builtAt: new Date().toISOString(),
    builtBy: "scripts/cortex/self-rebuild-package.mjs",
    elapsedSec: ((Date.now() - startedAt) / 1000).toFixed(1),
    version: "1.0",
  },
  summary: {
    modulesTotal: moduleDetails.length,
    modulesOk: moduleDetails.filter(m => m.syntaxOk).length,
    modulesBroken: brokenModules.length,
    stateFilesTotal: cortexStateFiles.length,
    processes,
    daemonRunning: processes.daemon === "running",
    lastCycle: loopState ? { at: loopState.lastCycleAt, num: loopState.cycleNum, branch: loopState.branch?.slice(0, 80) } : null,
    lastHandsTask: sharedState?.lastHandsResult?.task || null,
  },
  modules: moduleDetails,
  brokenModules,
  stateFiles: stateMeta,
  stateSnapshot,
  processes,
  gitLog,
  db: dbSummary,
  loopState,
  config,
  heartbeat,
  modelRouter,
};

// ── 8. WRITE TO DISK ──────────────────────────────────────────────────────────

log("Step 8: writing package to disk...");
writeFileSync(OUT_PATH, JSON.stringify(pkg, null, 2));
const pkgSizeKb = (statSync(OUT_PATH).size / 1024).toFixed(0);
log(`Package written: ${OUT_PATH} (${pkgSizeKb} KB)`);

// ── 9. BUILD TELEGRAM REPORT ──────────────────────────────────────────────────

log("Step 9: building Telegram report...");

const totalElapsed = ((Date.now() - startedAt) / 1000).toFixed(0);

const brokenLine = brokenModules.length > 0
  ? `*Broken:* ${brokenModules.map(b => b.file).join(", ")}`
  : `*Modules:* all ${moduleDetails.length} pass syntax check`;

const missingState = stateMeta.filter(s => !s.valid).map(s => s.file);
const stateLine = missingState.length > 0
  ? `*State issues:* ${missingState.join(", ")}`
  : `*State files:* ${cortexStateFiles.length} / ${cortexStateFiles.length} valid`;

const processLines = Object.entries(processes)
  .filter(([k]) => k !== "error")
  .map(([k, v]) => `  ${v === "running" ? "OK" : "XX"} ${k}: ${v}`)
  .join("\n");

const cycleInfo = loopState
  ? `Cycle #${loopState.cycleNum} at ${(loopState.lastCycleAt || "").slice(11, 19)} UTC`
  : "Loop state unavailable";

const lastGit = gitLog[0] || "unknown";

const dbInfo = dbSummary?.tables
  ? `Tables: ${dbSummary.tables.join(", ")} | Rows: ${Object.entries(dbSummary.tableCounts).map(([t,c]) => `${t}=${c}`).join(", ")}`
  : (dbSummary?.error || "DB not found");

const report = [
  `*CORTEX SELF-REBUILD PACKAGE - DONE*`,
  `Built in ${totalElapsed}s | Size: ${pkgSizeKb} KB`,
  ``,
  brokenLine,
  stateLine,
  ``,
  `*Processes:*`,
  processLines,
  ``,
  `*Loop:* ${cycleInfo}`,
  `*Last commit:* ${lastGit}`,
  `*DB:* ${dbInfo.slice(0, 200)}`,
  ``,
  `*Package path:* .data/cortex-rebuild-package.json`,
].join("\n");

// ── 10. SEND TO TELEGRAM ──────────────────────────────────────────────────────

log("Step 10: sending to Telegram...");

const sent = await tg(report);
if (sent) {
  log("Telegram: sent OK");
} else {
  log("Telegram: FAILED - printing report to stdout instead:");
  console.log("\n" + report);
}

log(`Done. Total elapsed: ${totalElapsed}s`);
process.exit(0);
