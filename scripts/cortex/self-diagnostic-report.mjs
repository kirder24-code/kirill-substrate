/**
 * CORTEX SELF-DIAGNOSTIC REPORT
 *
 * Enumerates all scripts/cortex modules, checks syntax, verifies state files,
 * and writes a structured report to cortex-shared-state.json as lastHandsResult.
 *
 * Usage: node scripts/cortex/self-diagnostic-report.mjs
 */

import { spawnSync, execSync } from "child_process";
import { readdirSync, existsSync, readFileSync, writeFileSync, statSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const CORTEX_DIR = __dirname;
const DATA_DIR = resolve(ROOT, ".data");
const SHARED_STATE_PATH = resolve(DATA_DIR, "cortex-shared-state.json");

// ─── 1. Module scan ─────────────────────────────────────────────────────────

const allFiles = readdirSync(CORTEX_DIR).filter(f => f.endsWith(".mjs")).sort();
const modules = { ok: [], broken: [] };

for (const file of allFiles) {
  const fullPath = resolve(CORTEX_DIR, file);
  const result = spawnSync("node", ["--check", fullPath], { encoding: "utf-8" });
  if (result.status === 0) {
    modules.ok.push(file);
  } else {
    modules.broken.push({ file, error: (result.stderr || "unknown error").trim().slice(0, 200) });
  }
}

// ─── 2. State file scan ──────────────────────────────────────────────────────

const STATE_FILES = [
  "cortex-shared-state.json",
  "cortex-state-bus.json",
  "cortex-loop-state.json",
  "cortex-conscious-log.json",
  "cortex-emotions.json",
  "cortex-attention.json",
  "cortex-identity.json",
  "cortex-intuition.json",
  "cortex-priming.json",
  "cortex-dissonance.json",
  "cortex-dreams.json",
  "cortex-flow.json",
  "cortex-surprise.json",
  "cortex-metamemory.json",
  "cortex-evolution.json",
  "cortex-doctor-state.json",
  "cortex-healing-state.json",
  "cortex-strategy.json",
  "cortex-model-router.json",
  "cortex-enforcement.json",
  "cortex-config.json",
  "cortex-conversation.json",
];

const stateStatus = [];
for (const sf of STATE_FILES) {
  const p = resolve(DATA_DIR, sf);
  if (!existsSync(p)) {
    stateStatus.push({ file: sf, status: "missing" });
    continue;
  }
  try {
    const raw = readFileSync(p, "utf-8");
    const parsed = JSON.parse(raw);
    const size = raw.length;
    const mtime = statSync(p).mtime.toISOString();
    stateStatus.push({ file: sf, status: "ok", size, mtime });
  } catch (e) {
    stateStatus.push({ file: sf, status: "parse_error", error: e.message });
  }
}

// ─── 3. Process check ───────────────────────────────────────────────────────

const processes = {};
try {
  const ps = execSync("ps aux", { encoding: "utf-8" });
  processes.daemon = ps.includes("cortex-daemon.mjs") ? "running" : "stopped";
  processes.chat = ps.includes("chat-server.mjs") ? "running" : "stopped";
  processes.orchestrator = ps.includes("orchestrator-loop.mjs") ? "running" : "stopped";
} catch {
  processes.error = "ps failed";
}

// ─── 4. Key state snapshot ──────────────────────────────────────────────────

let sharedState = null;
let loopState = null;
try { sharedState = JSON.parse(readFileSync(SHARED_STATE_PATH, "utf-8")); } catch {}
try { loopState = JSON.parse(readFileSync(resolve(DATA_DIR, "cortex-loop-state.json"), "utf-8")); } catch {}

// ─── 5. Build report ────────────────────────────────────────────────────────

const report = {
  at: new Date().toISOString(),
  modules_total: allFiles.length,
  modules_ok: modules.ok.length,
  modules_broken: modules.broken.length,
  ok: modules.ok,
  broken: modules.broken,
  state_files_checked: STATE_FILES.length,
  state_files_ok: stateStatus.filter(s => s.status === "ok").length,
  state_files_missing: stateStatus.filter(s => s.status === "missing").map(s => s.file),
  state_files_errors: stateStatus.filter(s => s.status === "parse_error"),
  processes,
  last_cycle: loopState ? {
    at: loopState.lastCycleAt,
    cycle: loopState.cycleNum,
    branch: loopState.branch,
  } : null,
  last_hands: sharedState?.lastHandsResult ? {
    at: sharedState.lastHandsResult.at,
    task: sharedState.lastHandsResult.task,
    success: sharedState.lastHandsResult.success,
  } : null,
};

const summary = [
  `Modules: ${report.modules_ok}/${report.modules_total} OK${report.modules_broken > 0 ? `, BROKEN: ${modules.broken.map(b => b.file).join(", ")}` : ""}`,
  `State files: ${report.state_files_ok}/${STATE_FILES.length} present${report.state_files_missing.length ? `, missing: ${report.state_files_missing.join(", ")}` : ""}`,
  `Processes: daemon=${processes.daemon}, chat=${processes.chat}, orchestrator=${processes.orchestrator}`,
  loopState ? `Last cycle: #${loopState.cycleNum} at ${loopState.lastCycleAt} - ${loopState.branch?.slice(0, 80)}` : "Loop state: unavailable",
].join("\n");

console.log("\n=== CORTEX SELF-DIAGNOSTIC REPORT ===\n");
console.log(summary);
if (modules.broken.length > 0) {
  console.log("\nBROKEN MODULES:");
  for (const b of modules.broken) console.log(`  ${b.file}: ${b.error}`);
}
console.log("\nFull report:", JSON.stringify(report, null, 2));

// ─── 6. Write to shared state ────────────────────────────────────────────────

try {
  const existing = existsSync(SHARED_STATE_PATH)
    ? JSON.parse(readFileSync(SHARED_STATE_PATH, "utf-8"))
    : {};

  existing.lastHandsResult = {
    at: report.at,
    task: "self-diagnostic: enumerate scripts/cortex modules, state files, processes",
    success: true,
    filesChanged: [],
    output: summary,
    diagnosticReport: report,
    error: null,
  };

  writeFileSync(SHARED_STATE_PATH, JSON.stringify(existing, null, 2));
  console.log("\n[OK] Report written to cortex-shared-state.json");
} catch (e) {
  console.error("[FAIL] Could not write shared state:", e.message);
}
