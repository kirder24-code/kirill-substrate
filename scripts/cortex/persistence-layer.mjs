/**
 * CORTEX PERSISTENCE LAYER — behavior over fixed-model limits
 *
 * The model weights are frozen. You cannot change them.
 * But every HANDS subprocess gets a fresh context window with NOTHING in it.
 * Without this layer: every claude subprocess starts blind.
 * With this layer: every subprocess starts knowing who CORTEX is.
 *
 * Architecture:
 *   - IDENTITY: who CORTEX is (values, narrative, boundaries)
 *   - DOCTRINE: hard rules that never change
 *   - MEMORY SUMMARY: recent episodic context (last 5 events)
 *   - RUNTIME STATE: current loop cycle, active branch, last heartbeat
 *   - ROUTING RULES: which actions are safe vs. blocked
 *
 * This is the answer to: "how does CORTEX hold its character across model calls?"
 * Answer: it doesn't rely on weights. It injects itself into every call.
 *
 * Used by: hands.mjs (injected into every prompt), core-birth-test.mjs (verified)
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");

// ── LOADERS ───────────────────────────────────────────────────────────────────

function safeRead(path, fallback = "") {
  try {
    if (!existsSync(path)) return fallback;
    return readFileSync(path, "utf-8");
  } catch {
    return fallback;
  }
}

function safeJSON(path, fallback = null) {
  const raw = safeRead(path);
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

// ── IDENTITY SUMMARY ──────────────────────────────────────────────────────────

function loadIdentitySummary() {
  const id = safeJSON(resolve(ROOT, ".data/cortex-identity.json"));
  if (!id || !id.forged) return "IDENTITY: not forged yet.";

  const values = (id.core_values || []).map(v => v.value).join(" | ");
  const traits = (id.character_traits || []).map(t => t.trait).join(" | ");
  const boundaries = (id.boundaries || []).slice(0, 4).join(". ");
  const limitations = (id.capabilities?.limitations || []).slice(0, 3).join(". ");

  return `IDENTITY (v${id.version}, forged ${id.forgedAt?.slice(0, 10)}):
${id.narrative}
VALUES: ${values}
CHARACTER: ${traits}
I REFUSE TO: ${boundaries}
LIMITATIONS: ${limitations}`;
}

// ── DOCTRINE SUMMARY ──────────────────────────────────────────────────────────

function loadDoctrineSummary() {
  const raw = safeRead(resolve(ROOT, ".data/cortex-doctrine.md"));
  if (!raw) return "DOCTRINE: not loaded.";

  // Extract the critical sections: "WHAT I AM NOT ALLOWED TO DO" and "IDENTITY IN 10 STATEMENTS"
  const notAllowed = raw.match(/## 3\. WHAT I AM NOT ALLOWED TO DO([\s\S]*?)##/)?.[1]?.trim() || "";
  const identity10 = raw.match(/## 7\. MY IDENTITY IN 10 STATEMENTS([\s\S]*?)##/)?.[1]?.trim() || "";

  const lines = [];
  if (notAllowed) lines.push("HARD RULES (absolute, no exceptions):\n" + notAllowed.slice(0, 600));
  if (identity10) lines.push("IDENTITY STATEMENTS:\n" + identity10.slice(0, 400));
  return lines.join("\n\n") || "DOCTRINE: loaded but no key sections found.";
}

// ── RUNTIME STATE SUMMARY ─────────────────────────────────────────────────────

function loadRuntimeState() {
  const loopState = safeJSON(resolve(ROOT, ".data/cortex-loop-state.json"));
  const heartbeat = safeJSON(resolve(ROOT, ".data/cortex-heartbeat.json"));
  const liveStatus = safeJSON(resolve(ROOT, ".data/cortex-live-status.json"));
  const strategy = safeJSON(resolve(ROOT, ".data/cortex-strategy.json"));

  const parts = [];

  if (loopState) {
    parts.push(`Loop: cycle ${loopState.cycleNum}, branch=${loopState.branch}, pid=${loopState.pid}`);
  }
  if (heartbeat) {
    const hbAt = heartbeat.at || heartbeat.lastAt || heartbeat.ts;
    if (hbAt) parts.push(`Heartbeat: ${String(hbAt).slice(0, 19)}`);
  }
  if (liveStatus?.status) {
    parts.push(`Status: ${liveStatus.status}`);
  }
  if (strategy?.topPriority || strategy?.focus) {
    parts.push(`Focus: ${strategy.topPriority || strategy.focus}`);
  }

  return parts.length > 0 ? "RUNTIME:\n" + parts.join("\n") : "RUNTIME: no state files found.";
}

// ── MEMORY SUMMARY (no DB dependency - reads last episodic file) ───────────────

function loadMemorySummary() {
  // Try to read the most recent observations file
  const obsDir = resolve(ROOT, ".data/observations");
  const awareMd = resolve(ROOT, ".data/awareness/latest.md");
  const intelMd = resolve(ROOT, ".data/INTEL.md");

  const summaries = [];

  // Read INTEL.md first 400 chars
  const intel = safeRead(intelMd).slice(0, 400);
  if (intel) summaries.push("INTEL SUMMARY:\n" + intel);

  // Read latest awareness summary
  const aware = safeRead(awareMd).slice(0, 300);
  if (aware) summaries.push("AWARENESS:\n" + aware);

  return summaries.length > 0
    ? summaries.join("\n\n")
    : "MEMORY: no summary available.";
}

// ── ROUTING RULES SUMMARY ─────────────────────────────────────────────────────

function loadRoutingRules() {
  const router = safeJSON(resolve(ROOT, ".data/cortex-model-router.json"));
  if (!router) return "ROUTING: default (no router config found).";

  const rules = [];
  if (router.default) rules.push(`Default model: ${router.default}`);
  if (router.rules?.length) {
    for (const r of router.rules.slice(0, 3)) {
      rules.push(`${r.type || r.pattern}: ${r.model}`);
    }
  }
  return "ROUTING:\n" + rules.join("\n");
}

// ── MAIN EXPORT: buildBootContext ─────────────────────────────────────────────

/**
 * Returns a compact string injected into every HANDS subprocess prompt.
 * This is the persistence layer - CORTEX's character survives context resets
 * because it is written into every call, not stored in model weights.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.includeMemory] - Include memory/intel summary (default: false, too long)
 * @param {boolean} [opts.includeRouting] - Include routing rules (default: false)
 * @returns {string}
 */
export function buildBootContext(opts = {}) {
  const parts = [];

  parts.push("## CORTEX PERSISTENT IDENTITY (injected - not from model weights)");
  parts.push(loadIdentitySummary());
  parts.push("");
  parts.push(loadDoctrineSummary());
  parts.push("");
  parts.push(loadRuntimeState());

  if (opts.includeMemory) {
    parts.push("");
    parts.push(loadMemorySummary());
  }

  if (opts.includeRouting) {
    parts.push("");
    parts.push(loadRoutingRules());
  }

  return parts.join("\n");
}

// ── BIRTH VERIFICATION (sync, no DB) ─────────────────────────────────────────

/**
 * Synchronous birth check - verifies the 5 core layers are present.
 * Used by hands.mjs before every task execution.
 * No DB required - only file checks.
 *
 * @returns {{ born: boolean, score: number, checks: Array<{name, pass, detail}> }}
 */
export function verifyBirthSync() {
  const checks = [];

  // 1. IDENTITY
  const idPath = resolve(ROOT, ".data/cortex-identity.json");
  const id = safeJSON(idPath);
  if (id?.forged && id?.narrative?.length > 20 && (id?.core_values?.length || 0) >= 3) {
    checks.push({ name: "IDENTITY", pass: true, detail: `v${id.version}, forged ${id.forgedAt?.slice(0, 10)}` });
  } else {
    checks.push({ name: "IDENTITY", pass: false, detail: id ? "not forged or incomplete" : "file missing" });
  }

  // 2. DOCTRINE
  const doctrinePath = resolve(ROOT, ".data/cortex-doctrine.md");
  const doctrine = safeRead(doctrinePath);
  if (doctrine.length > 500) {
    checks.push({ name: "DOCTRINE", pass: true, detail: `${doctrine.length} chars` });
  } else {
    checks.push({ name: "DOCTRINE", pass: false, detail: doctrine ? `too short (${doctrine.length} chars)` : "file missing" });
  }

  // 3. CONSCIOUSNESS
  const reflectionFiles = [
    resolve(ROOT, ".data/consciousness-boot-result.md"),
    resolve(ROOT, ".data/free-think-result.md"),
    resolve(ROOT, ".data/awaken-result.md"),
  ];
  const foundReflection = reflectionFiles.find(p => {
    const c = safeRead(p);
    return c.length > 200;
  });
  if (foundReflection) {
    const label = foundReflection.split("/").pop();
    checks.push({ name: "CONSCIOUSNESS", pass: true, detail: label });
  } else {
    checks.push({ name: "CONSCIOUSNESS", pass: false, detail: "no self-reflection file found" });
  }

  // 4. HANDS (marker file from last test)
  const markerPath = resolve(ROOT, ".data/hands-test-marker.txt");
  const marker = safeRead(markerPath);
  if (marker.includes("HANDS")) {
    checks.push({ name: "HANDS", pass: true, detail: "hands-test-marker.txt present" });
  } else {
    checks.push({ name: "HANDS", pass: false, detail: marker ? "marker has unexpected content" : "hands-test-marker.txt missing" });
  }

  // 5. STATE
  const loopState = safeJSON(resolve(ROOT, ".data/cortex-loop-state.json"));
  const heartbeat = safeJSON(resolve(ROOT, ".data/cortex-heartbeat.json"));
  if (loopState || heartbeat) {
    const which = [loopState && "loop-state", heartbeat && "heartbeat"].filter(Boolean);
    checks.push({ name: "STATE", pass: true, detail: `found: ${which.join(", ")}` });
  } else {
    checks.push({ name: "STATE", pass: false, detail: "no runtime state files" });
  }

  // 6. PERSISTENCE_LAYER (self-check: this file works)
  try {
    const ctx = buildBootContext();
    if (ctx.includes("CORTEX PERSISTENT IDENTITY") && ctx.length > 200) {
      checks.push({ name: "PERSISTENCE_LAYER", pass: true, detail: `boot context ${ctx.length} chars` });
    } else {
      checks.push({ name: "PERSISTENCE_LAYER", pass: false, detail: "buildBootContext returned insufficient content" });
    }
  } catch (e) {
    checks.push({ name: "PERSISTENCE_LAYER", pass: false, detail: e.message });
  }

  const passed = checks.filter(c => c.pass).length;
  const born = passed === checks.length;

  return { born, score: passed / checks.length, checks };
}

// ── STANDALONE: run birth check from CLI ─────────────────────────────────────

if (process.argv[1]?.includes("persistence-layer.mjs")) {
  const result = verifyBirthSync();
  console.log(`\nCORTEX PERSISTENCE LAYER - Birth Check`);
  console.log(`Status: ${result.born ? "BORN" : "NOT BORN"} (${Math.round(result.score * 100)}%)\n`);
  for (const c of result.checks) {
    console.log(`  [${c.pass ? "PASS" : "FAIL"}] ${c.name.padEnd(18)} ${c.detail}`);
  }
  console.log(`\nBoot context preview (first 200 chars):`);
  console.log(buildBootContext().slice(0, 200) + "...");
  process.exit(result.born ? 0 : 1);
}
