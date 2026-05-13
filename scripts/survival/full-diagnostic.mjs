/**
 * scripts/survival/full-diagnostic.mjs
 *
 * Comprehensive health/integration check across all subsystems built
 * tonight. Produces .data/FULL-DIAGNOSTIC.md.
 *
 * Categories:
 *   A. Processes      — daemons alive and uptime
 *   B. Code           — every .mjs in scripts/survival/ imports without error
 *   C. Action catalog — every registered action has run() and metadata
 *   D. Database       — survival.db tables present and queryable
 *   E. Files          — expected dirs/files exist
 *   F. Bridges        — each integration point produces something
 *   G. Conflicts      — duplicate processes, getUpdates collisions
 *   H. Recent activity — pulse-daemon recently ticked the new steps
 *   I. Budget         — spend and remaining cap
 *   J. Memory         — auto-memory and frozen files readable
 *
 * Each check returns one of: PASS | WARN | FAIL with detail.
 */

import { readFileSync, readdirSync, existsSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const OUT = resolve(ROOT, ".data/FULL-DIAGNOSTIC.md");

const checks = [];
function record(category, name, status, detail) {
  checks.push({ category, name, status, detail });
}

// ─── A. Processes ──────────────────────────────────────────────────────────

const DAEMONS = [
  { name: "cortex-alive", pid_file: ".data/cortex-alive.pid", expected_min_uptime_min: 30 },
  { name: "cortex-daemon", pid_file: ".data/cortex-daemon.pid", expected_min_uptime_min: 30 },
  { name: "pulse-daemon", pid_file: ".data/pulse-daemon.pid", expected_min_uptime_min: 30 },
  { name: "obsidian-sync", pid_file: ".data/obsidian-sync.pid", expected_min_uptime_min: 30 },
  { name: "organism-respond", pid_file: ".data/organism-respond.pid", expected_min_uptime_min: 0 },
  { name: "sonnet-bots-daemon", pid_file: ".data/sonnet-bots-daemon.pid", expected_min_uptime_min: 0 },
];

function pidAlive(pid) {
  try { execSync(`ps -p ${pid}`, { stdio: "ignore" }); return true; }
  catch { return false; }
}
function pidEtimeMin(pid) {
  try {
    const out = execSync(`ps -p ${pid} -o etime=`, { encoding: "utf-8" }).trim();
    // formats: MM:SS | HH:MM:SS | DD-HH:MM:SS
    const parts = out.split("-");
    const days = parts.length > 1 ? Number(parts[0]) : 0;
    const time = parts[parts.length - 1].split(":").map(Number);
    let hours = 0, minutes = 0;
    if (time.length === 3) [hours, minutes] = time;
    else if (time.length === 2) [minutes] = time;
    return days * 24 * 60 + hours * 60 + minutes;
  } catch { return null; }
}

for (const d of DAEMONS) {
  const pidPath = resolve(ROOT, d.pid_file);
  if (!existsSync(pidPath)) {
    record("A. Processes", d.name, "WARN", `no pid file`);
    continue;
  }
  const pid = Number(readFileSync(pidPath, "utf-8").trim());
  if (!pid || !pidAlive(pid)) {
    record("A. Processes", d.name, "FAIL", `pid ${pid} not running`);
    continue;
  }
  const et = pidEtimeMin(pid);
  if (et !== null && d.expected_min_uptime_min && et < d.expected_min_uptime_min) {
    record("A. Processes", d.name, "WARN", `pid ${pid} alive but only ${et}min uptime`);
  } else {
    record("A. Processes", d.name, "PASS", `pid ${pid} uptime ${et}min`);
  }
}

// ─── B. Code: every survival module imports ────────────────────────────────

const SURVIVAL_DIR = resolve(__dirname);
// Skip CLI runners that have side-effect top-level await (would cause real
// daemon launches just from import). Their syntax is checked via syntaxCheck.
const SKIP_IMPORT = new Set([
  "full-diagnostic.mjs",
  "boot-cortex-bounded.mjs",  // top-level await launch()
  "cortex-alive.mjs",          // top-level keepAlive interval
  "tick-once.mjs",              // top-level tick
]);
const survivalFiles = readdirSync(SURVIVAL_DIR).filter(f => f.endsWith(".mjs"));
for (const f of survivalFiles) {
  if (SKIP_IMPORT.has(f)) {
    // Syntax-only check via node --check
    try {
      execSync(`node --check "${resolve(SURVIVAL_DIR, f)}"`, { stdio: "pipe" });
      record("B. Code", f, "PASS", "syntax ok (import skipped — has side effects)");
    } catch (e) {
      record("B. Code", f, "FAIL", `syntax error: ${String(e.message).slice(0, 200)}`);
    }
    continue;
  }
  const full = resolve(SURVIVAL_DIR, f);
  try {
    await import(full);
    record("B. Code", f, "PASS", "imports clean");
  } catch (e) {
    record("B. Code", f, "FAIL", `import error: ${String(e.message).slice(0, 200)}`);
  }
}

// ─── C. Action catalog ─────────────────────────────────────────────────────

try {
  const catalogMod = await import(resolve(SURVIVAL_DIR, "action-catalog.mjs"));
  const actions = catalogMod.listActions();
  record("C. Action catalog", "total_actions", "PASS", `${actions.length} actions registered`);
  for (const a of actions) {
    if (!a.action_id || !a.description) {
      record("C. Action catalog", a.action_id || "(unknown)", "FAIL", "missing id or description");
      continue;
    }
    const meta = catalogMod.getActionMetadata(a.action_id);
    if (!meta || typeof meta.run !== "function") {
      record("C. Action catalog", a.action_id, "FAIL", "no run() function");
    } else {
      record("C. Action catalog", a.action_id, "PASS", `cost~$${(meta.estimated_cost_usd || 0).toFixed(2)} side=${meta.side_effect_class || "?"}`);
    }
  }
} catch (e) {
  record("C. Action catalog", "load", "FAIL", `cannot load catalog: ${e.message}`);
}

// ─── D. Database ───────────────────────────────────────────────────────────

// survival.db hosts the survival_loop tables. The older policy_weights /
// policy_outcome_ledger live in organism.db (separate scripts/policy/ stack)
// and are checked separately.
try {
  const db = new Database(resolve(ROOT, ".data/survival.db"), { readonly: true });
  const expectedTables = ["policy_strategies", "llm_call_log", "wallet_snapshots", "opportunities"];
  const actual = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map(r => r.name);
  for (const t of expectedTables) {
    if (actual.includes(t)) {
      const count = db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get();
      record("D. Database", `survival.db:${t}`, "PASS", `${count.n} rows`);
    } else {
      record("D. Database", `survival.db:${t}`, "FAIL", "missing");
    }
  }
  db.close();
} catch (e) {
  record("D. Database", "open survival.db", "FAIL", `cannot open: ${e.message}`);
}

// Check the legacy scripts/policy/ tables in organism.db. WARN if missing
// (they belong to the older synthetic-test stack and are not required for
// the survival_loop runtime).
try {
  const db = new Database(resolve(ROOT, ".data/organism.db"), { readonly: true });
  const legacyTables = ["policy_weights", "policy_outcome_ledger"];
  const actual = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map(r => r.name);
  for (const t of legacyTables) {
    if (actual.includes(t)) {
      const count = db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get();
      record("D. Database", `organism.db legacy:${t}`, "PASS", `${count.n} rows (used by scripts/policy/ ablation tests)`);
    } else {
      record("D. Database", `organism.db legacy:${t}`, "WARN", "missing — only used by scripts/policy/ ablation gate, not by runtime");
    }
  }
  db.close();
} catch (e) { record("D. Database", "open organism.db", "WARN", `cannot open: ${e.message}`); }

// ─── E. Files ──────────────────────────────────────────────────────────────

const EXPECTED_FILES = [
  ".data/survival-armed.flag",
  ".data/SYSTEM-STATE.md",
  ".data/SYSTEM-MAP.md",
  ".data/factory-status.json",
  ".data/cortex-alive-heartbeat.json",
  ".data/cortex-alive-bus.jsonl",
  "scripts/survival/contract.md",
  "scripts/survival/operator-identity.md",
  "scripts/survival/channel-registry.md",
  "scripts/survival/factory-registry.md",
];
for (const p of EXPECTED_FILES) {
  const full = resolve(ROOT, p);
  if (!existsSync(full)) {
    record("E. Files", p, "FAIL", "missing");
    continue;
  }
  const ageHours = (Date.now() - statSync(full).mtimeMs) / 3600_000;
  const size = statSync(full).size;
  if (size === 0) record("E. Files", p, "WARN", `empty file`);
  else if (p.endsWith(".md") && ageHours > 72) record("E. Files", p, "WARN", `stale (${ageHours.toFixed(1)}h)`);
  else record("E. Files", p, "PASS", `${(size / 1024).toFixed(1)} KB, age ${ageHours.toFixed(1)}h`);
}

const EXPECTED_DIRS = [
  ".data/survival-opportunities",
  ".data/survival-drafts",
  ".data/site-drafts",
  ".data/survival-funding-scans",
  ".data/wiki-archive",
  "scripts/survival/personas",
];
for (const p of EXPECTED_DIRS) {
  const full = resolve(ROOT, p);
  if (!existsSync(full)) record("E. Files", p, "WARN", "dir missing (may not have content yet)");
  else {
    const items = readdirSync(full);
    record("E. Files", p, "PASS", `${items.length} items`);
  }
}

// ─── F. Bridges ────────────────────────────────────────────────────────────

// F1: wiki brain returns matches
try {
  const wb = await import(resolve(SURVIVAL_DIR, "wiki-brain.mjs"));
  const matches = wb.queryWiki("Canadian SMB", { limit: 3 });
  record("F. Bridges", "wiki-brain query", matches.length > 0 ? "PASS" : "WARN", `${matches.length} matches`);
} catch (e) { record("F. Bridges", "wiki-brain query", "FAIL", e.message); }

// F2: lead-database stats
try {
  const ld = await import(resolve(SURVIVAL_DIR, "lead-database.mjs"));
  const stats = ld.getOutreachStats();
  if (stats && stats.totals.total > 0) {
    record("F. Bridges", "lead-database stats", "PASS", `${stats.totals.total} outreach, ${stats.totals.replied} replied`);
  } else {
    record("F. Bridges", "lead-database stats", "WARN", "no outreach data");
  }
} catch (e) { record("F. Bridges", "lead-database stats", "FAIL", e.message); }

// F3: resource-ledger projection
try {
  const rl = await import(resolve(SURVIVAL_DIR, "resource-ledger.mjs"));
  const proj = await rl.survivalProjection({ address: process.env.SURVIVAL_WALLET_ADDRESS });
  record("F. Bridges", "resource-ledger projection", "PASS", `state=${proj.state} burn_24h=$${proj.burn_last_24h_usd.toFixed(3)} budget_remaining=$${proj.llm_budget_remaining_usd.toFixed(3)}`);
} catch (e) { record("F. Bridges", "resource-ledger projection", "FAIL", e.message); }

// F4: operator identity fit check
try {
  const oi = await import(resolve(SURVIVAL_DIR, "operator-identity.mjs"));
  const fit = oi.audienceFitCheck({ title: "Canadian SMB grants" });
  if (fit.voice_mode && fit.engagement_strategies && fit.engagement_strategies.length > 0) {
    record("F. Bridges", "operator-identity fit check", "PASS", `voice_mode=${fit.voice_mode} ${fit.engagement_strategies.length} strategies`);
  } else {
    record("F. Bridges", "operator-identity fit check", "FAIL", "missing voice_mode or strategies");
  }
} catch (e) { record("F. Bridges", "operator-identity fit check", "FAIL", e.message); }

// F5: factory-bridge status
try {
  const fb = await import(resolve(SURVIVAL_DIR, "factory-bridge.mjs"));
  const r = await fb.runFactoryStatus({ strategy: { id: "diag" } });
  if (r.ok) {
    record("F. Bridges", "factory-bridge status", "PASS", `${r.summary.total_bots} bots, ${r.summary.healthy} healthy, ${r.summary.dead} dead`);
  } else {
    record("F. Bridges", "factory-bridge status", "FAIL", r.reason);
  }
} catch (e) { record("F. Bridges", "factory-bridge status", "FAIL", e.message); }

// F6: factory-dispatcher list
try {
  const fd = await import(resolve(SURVIVAL_DIR, "factory-dispatcher.mjs"));
  const list = fd.listDispatchable();
  record("F. Bridges", "factory-dispatcher allow-list", "PASS", `${list.length} bots dispatchable: ${list.map(l => l.name).join(",")}`);
} catch (e) { record("F. Bridges", "factory-dispatcher allow-list", "FAIL", e.message); }

// F7: channel-registry recommendation
try {
  const cr = await import(resolve(SURVIVAL_DIR, "channel-registry.mjs"));
  const rec = cr.recommendChannelsForMarket("Canada");
  record("F. Bridges", "channel-registry CA recommendation", rec.length > 0 ? "PASS" : "WARN", rec.join(" / "));
} catch (e) { record("F. Bridges", "channel-registry CA recommendation", "FAIL", e.message); }

// F8: specialist-agents persona loading
try {
  const sa = await import(resolve(SURVIVAL_DIR, "specialist-agents.mjs"));
  const list = sa.listSpecialists();
  let loadFailures = 0;
  for (const s of list) {
    try { sa.loadPersona(s.id); }
    catch { loadFailures++; }
  }
  if (loadFailures === 0) record("F. Bridges", "specialist personas", "PASS", `${list.length} personas all load`);
  else record("F. Bridges", "specialist personas", "FAIL", `${loadFailures}/${list.length} personas fail to load`);
} catch (e) { record("F. Bridges", "specialist personas", "FAIL", e.message); }

// ─── G. Conflicts ──────────────────────────────────────────────────────────

// G1: duplicate process names
try {
  const ps = execSync(`ps aux | grep -E "scripts/(survival|cortex|organism|factory)/[A-Za-z0-9_-]+\\.mjs" | grep -v grep`, { encoding: "utf-8" });
  const byScript = {};
  for (const line of ps.split("\n").filter(Boolean)) {
    const m = line.match(/scripts\/[^\s]+\.mjs/);
    if (!m) continue;
    byScript[m[0]] = (byScript[m[0]] || 0) + 1;
  }
  const dupes = Object.entries(byScript).filter(([_, n]) => n > 1);
  if (dupes.length === 0) record("G. Conflicts", "duplicate scripts running", "PASS", "no dupes");
  else {
    for (const [s, n] of dupes) record("G. Conflicts", `duplicate:${s}`, "WARN", `${n} instances`);
  }
} catch (e) { record("G. Conflicts", "process list", "WARN", e.message); }

// G2: Telegram getUpdates conflict
try {
  const env = readFileSync(resolve(ROOT, "apps/api/.env"), "utf-8");
  const tok = env.match(/TELEGRAM_BOT_TOKEN=(.+)/)?.[1]?.trim();
  if (tok) {
    const res = await fetch(`https://api.telegram.org/bot${tok}/getUpdates?timeout=1`, { signal: AbortSignal.timeout(5000) });
    const j = await res.json();
    if (j.ok) {
      record("G. Conflicts", "telegram getUpdates", "WARN", `accessible — risk: substrate callback poller will conflict with whoever else polls (telegram-control)`);
    } else if (j.description?.includes("Conflict")) {
      record("G. Conflicts", "telegram getUpdates", "WARN", `confirmed conflict — another consumer is polling`);
    } else {
      record("G. Conflicts", "telegram getUpdates", "WARN", j.description || "unknown");
    }
  } else {
    record("G. Conflicts", "telegram getUpdates", "WARN", "no bot token in env");
  }
} catch (e) { record("G. Conflicts", "telegram getUpdates", "WARN", e.message); }

// G3: two cortex daemons (cortex-alive vs cortex-daemon)
try {
  const aPid = Number(readFileSync(resolve(ROOT, ".data/cortex-alive.pid"), "utf-8").trim());
  const bPid = Number(readFileSync(resolve(ROOT, ".data/cortex-daemon.pid"), "utf-8").trim());
  if (pidAlive(aPid) && pidAlive(bPid)) {
    record("G. Conflicts", "two cortex daemons", "WARN", `cortex-alive (${aPid}) and cortex-daemon (${bPid}) both alive. Different processes, different buses; not directly conflicting but redundant.`);
  }
} catch {}

// ─── H. Recent activity ────────────────────────────────────────────────────

try {
  const pulseLog = readFileSync(resolve(ROOT, ".data/organism-pulse.log"), "utf-8");
  const tail = pulseLog.slice(-30_000);
  const tickedRecently = /\[pulse\] step 0c\/7: survival-tick/.test(tail);
  if (tickedRecently) record("H. Recent activity", "survival_tick fired in recent pulse log", "PASS", "yes");
  else record("H. Recent activity", "survival_tick fired in recent pulse log", "WARN", "no recent survival_tick in pulse log");
  const newStepsPresent = /step 0e[2-3]/.test(tail);
  if (newStepsPresent) record("H. Recent activity", "new pulse steps (0e2/0e3) executed", "PASS", "yes");
  else record("H. Recent activity", "new pulse steps (0e2/0e3) executed", "WARN", "not yet seen — will fire on next pulse");
} catch (e) { record("H. Recent activity", "pulse log read", "FAIL", e.message); }

// ─── I. Budget ─────────────────────────────────────────────────────────────

try {
  const db = new Database(resolve(ROOT, ".data/survival.db"), { readonly: true });
  const r = db.prepare(`SELECT COALESCE(SUM(cost_usd),0) AS s FROM llm_call_log WHERE ts >= datetime('now','-24 hours')`).get();
  const calls = db.prepare(`SELECT COUNT(*) AS n FROM llm_call_log WHERE ts >= datetime('now','-24 hours')`).get();
  db.close();
  const spent = r.s;
  const cap_usd = 5.00 * 0.73;
  const remaining = cap_usd - spent;
  if (remaining > 0.5) record("I. Budget", "24h LLM spend vs cap", "PASS", `spent=$${spent.toFixed(3)}, remaining=$${remaining.toFixed(3)} (${calls.n} calls)`);
  else if (remaining > 0) record("I. Budget", "24h LLM spend vs cap", "WARN", `low remaining=$${remaining.toFixed(3)}`);
  else record("I. Budget", "24h LLM spend vs cap", "FAIL", "budget exhausted");
} catch (e) { record("I. Budget", "spend lookup", "FAIL", e.message); }

// ─── J. Memory (auto-memory + frozen files) ────────────────────────────────

const MEMORY_FILES = [
  "scripts/survival/contract.md",
  "scripts/survival/operator-identity.md",
  "scripts/survival/channel-registry.md",
  "scripts/survival/factory-registry.md",
];
for (const m of MEMORY_FILES) {
  const full = resolve(ROOT, m);
  if (!existsSync(full)) record("J. Memory", m, "FAIL", "missing");
  else {
    const size = statSync(full).size;
    record("J. Memory", m, size >= 500 ? "PASS" : "WARN", `${(size / 1024).toFixed(1)} KB`);
  }
}

// ─── Build report ──────────────────────────────────────────────────────────

const cats = [...new Set(checks.map(c => c.category))].sort();
const lines = [];
lines.push("# FULL DIAGNOSTIC\n");
lines.push(`generated: ${new Date().toISOString()}\n`);
const totals = { PASS: 0, WARN: 0, FAIL: 0 };
for (const c of checks) totals[c.status]++;
lines.push(`## Summary\n`);
lines.push(`- ✅ PASS: ${totals.PASS}`);
lines.push(`- ⚠️ WARN: ${totals.WARN}`);
lines.push(`- ❌ FAIL: ${totals.FAIL}`);
lines.push(`- TOTAL: ${checks.length} checks\n`);

if (totals.FAIL > 0) {
  lines.push(`## ❌ Failures (action items)\n`);
  for (const c of checks.filter(c => c.status === "FAIL")) {
    lines.push(`- [${c.category}] **${c.name}** — ${c.detail}`);
  }
  lines.push("");
}
if (totals.WARN > 0) {
  lines.push(`## ⚠️ Warnings\n`);
  for (const c of checks.filter(c => c.status === "WARN")) {
    lines.push(`- [${c.category}] **${c.name}** — ${c.detail}`);
  }
  lines.push("");
}

for (const cat of cats) {
  lines.push(`## ${cat}\n`);
  lines.push(`| check | status | detail |`);
  lines.push(`|---|---|---|`);
  for (const c of checks.filter(c => c.category === cat)) {
    const icon = c.status === "PASS" ? "✅" : c.status === "WARN" ? "⚠️" : "❌";
    lines.push(`| ${c.name} | ${icon} ${c.status} | ${String(c.detail).slice(0, 180)} |`);
  }
  lines.push("");
}

if (!existsSync(dirname(OUT))) mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, lines.join("\n"));
console.log(`FULL-DIAGNOSTIC.md written: ${OUT}`);
console.log(`Summary: ${totals.PASS} PASS, ${totals.WARN} WARN, ${totals.FAIL} FAIL of ${checks.length} checks`);
process.exit(totals.FAIL > 0 ? 1 : 0);
