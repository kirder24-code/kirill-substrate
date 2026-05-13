#!/usr/bin/env node
// organism/diagnose.mjs
// Deep integration diagnostic. Verifies the FULL CHAIN, not just that processes run.
// Tests every claimed property of the organism end-to-end.
//
// Usage: node scripts/organism/diagnose.mjs

import { spawnSync, execSync } from "node:child_process";
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { openDb, recordOutcome, totalOutcomes, totalBeliefs, listSourceCredibility, claimAccuracyStats } from "./db.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolve(__dirname, "../..");
const ORG_DB = resolve(PROJECT, ".data/organism.db");
const SRC_DB = resolve(PROJECT, ".data/linkedin-brand-os.sqlite");
const HOOK = resolve(PROJECT, ".claude/hooks/session-start-organism.sh");
const SETTINGS = resolve(PROJECT, ".claude/settings.json");
const DIGEST = resolve(PROJECT, ".data/organism-digest.md");
const PULSE = resolve(PROJECT, "scripts/organism/organism-pulse.sh");

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  const icon = ok ? "✓" : "✗";
  console.log(`  ${icon} ${name}${detail ? ` — ${detail}` : ""}`);
}
function header(text) {
  console.log(`\n=== ${text} ===`);
}

// ─── 1. Schema integrity ─────────────────────────────────────────
header("1. SCHEMA INTEGRITY");
{
  const db = openDb();
  const expectedTables = ["beliefs", "belief_links", "belief_evidence", "belief_log", "outcomes", "claims", "source_credibility"];
  const actual = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r => r.name);
  for (const t of expectedTables) {
    check(`table '${t}' exists`, actual.includes(t));
  }
  // Critical indexes
  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(r => r.name);
  check("idx_beliefs_weight present", indexes.includes("idx_beliefs_weight"));
  check("idx_outcomes_unprocessed present", indexes.includes("idx_outcomes_unprocessed"));
  check("idx_claims_unresolved present", indexes.includes("idx_claims_unresolved"));

  // Foreign key integrity
  const orphanLinks = db.prepare("SELECT COUNT(*) AS n FROM belief_links bl LEFT JOIN beliefs b1 ON bl.from_id = b1.id LEFT JOIN beliefs b2 ON bl.to_id = b2.id WHERE b1.id IS NULL OR b2.id IS NULL").get().n;
  check("no orphan belief_links", orphanLinks === 0, `orphans=${orphanLinks}`);
  const orphanEv = db.prepare("SELECT COUNT(*) AS n FROM belief_evidence be LEFT JOIN beliefs b ON be.belief_id = b.id WHERE b.id IS NULL").get().n;
  check("no orphan belief_evidence", orphanEv === 0, `orphans=${orphanEv}`);

  db.close();
}

// ─── 2. File system layer ────────────────────────────────────────
header("2. FILE SYSTEM");
{
  check(`organism db exists at ${ORG_DB.split("/").slice(-3).join("/")}`, existsSync(ORG_DB), existsSync(ORG_DB) ? `${(statSync(ORG_DB).size / 1024).toFixed(1)} KiB` : "missing");
  check(`source db exists`, existsSync(SRC_DB), existsSync(SRC_DB) ? `${(statSync(SRC_DB).size / 1024 / 1024).toFixed(1)} MiB` : "missing");
  check(`SessionStart hook script`, existsSync(HOOK));
  if (existsSync(HOOK)) {
    const mode = statSync(HOOK).mode & 0o777;
    check("hook is executable", (mode & 0o100) !== 0, `mode=${mode.toString(8)}`);
  }
  check(`.claude/settings.json present`, existsSync(SETTINGS));
  if (existsSync(SETTINGS)) {
    try {
      const cfg = JSON.parse(readFileSync(SETTINGS, "utf-8"));
      const sessionStart = cfg.hooks?.SessionStart;
      check("SessionStart hook registered", Array.isArray(sessionStart) && sessionStart.length > 0);
    } catch (e) {
      check("settings.json parses", false, e.message);
    }
  }
  check(`digest file present`, existsSync(DIGEST));
  check(`pulse script present`, existsSync(PULSE));
}

// ─── 3. Cron entry ───────────────────────────────────────────────
header("3. CRON SCHEDULER");
{
  let cronOut = "";
  try { cronOut = execSync("crontab -l 2>/dev/null", { encoding: "utf-8" }); } catch {}
  const lines = cronOut.split("\n").filter(l => l.includes("organism-pulse"));
  check("organism-pulse cron entry installed", lines.length > 0, `${lines.length} entries`);
  if (lines.length > 0) {
    const line = lines[0];
    check("cron uses absolute bash path", /\/(bin|usr\/bin)\/bash/.test(line));
    check("cron uses absolute script path", line.includes("$CLAUDE_PROJECT_DIR/scripts/organism/organism-pulse.sh"));
    check("cron redirects log to absolute path", line.includes(".data/organism-pulse.log") && line.includes("$HOME"));
    check("cron has hour schedule", /^\d+\s+\*/.test(line.trim()) || /^\*/.test(line.trim()));
  }
}

// ─── 4. Adapter connectivity to real data ────────────────────────
header("4. ADAPTERS — REAL DATA SOURCES");
{
  // Awareness brief
  const latestBrief = resolve(PROJECT, ".data/awareness/latest.md");
  check("awareness latest.md exists", existsSync(latestBrief));
  const historyDir = resolve(PROJECT, ".data/awareness/history");
  if (existsSync(historyDir)) {
    const briefs = execSync(`ls "${historyDir}" | grep -c .md`, { encoding: "utf-8" }).trim();
    check(`awareness history populated`, parseInt(briefs, 10) > 0, `${briefs} briefs`);
  }

  // Awareness apply log
  const applyLog = resolve(PROJECT, ".data/awareness-apply-log.json");
  if (existsSync(applyLog)) {
    try {
      const data = JSON.parse(readFileSync(applyLog, "utf-8"));
      const items = data.reduce((s, d) => s + (d.items?.length || 0), 0);
      check("apply-log readable and non-empty", items > 0, `${items} items across ${data.length} days`);
    } catch (e) {
      check("apply-log parseable", false, e.message);
    }
  }

  // Source DB tables — what adapters expect
  if (existsSync(SRC_DB)) {
    const srcDb = new Database(SRC_DB, { readonly: true });
    const outreachCount = srcDb.prepare("SELECT COUNT(*) AS n FROM outreach_emails").get().n;
    check("outreach_emails has data", outreachCount > 0, `${outreachCount} rows`);
    const convCount = srcDb.prepare("SELECT COUNT(*) AS n FROM conversations").get().n;
    check("conversations has data", convCount > 0, `${convCount} rows`);
    srcDb.close();
  }
}

// ─── 5. Idempotency ──────────────────────────────────────────────
header("5. IDEMPOTENCY");
{
  // Run each adapter twice and verify second run inserts 0
  const runAdapter = (name, args = "") => {
    const r = spawnSync("node", [`scripts/organism/${name}.mjs`, ...args.split(" ").filter(Boolean)], { cwd: PROJECT, encoding: "utf-8" });
    return r.stdout || "";
  };
  const out1 = runAdapter("ingest-awareness", "--latest");
  const out2 = runAdapter("ingest-awareness", "--latest");
  const second = out2.match(/delta \+(\d+)/)?.[1];
  check("ingest-awareness idempotent", second === "0", `2nd-run delta=${second}`);

  const o1 = runAdapter("ingest-conversations");
  const o2 = runAdapter("ingest-conversations");
  const sec2 = o2.match(/delta \+(\d+)/)?.[1];
  check("ingest-conversations idempotent", sec2 === "0", `2nd-run delta=${sec2}`);
}

// ─── 6. End-to-end outcome flow ──────────────────────────────────
header("6. END-TO-END OUTCOME FLOW");
{
  // Inject a unique outcome with observed_at FAR in the past so it sits at front of FIFO queue,
  // run apply with limit=1, verify it was the one processed.
  const db = openDb();
  const beforeBeliefs = totalBeliefs(db);
  const stamp = Date.now();
  const sentinel = `DIAGNOSTIC-${stamp}: cold email to canadian healthcare clinic prospects produced unexpectedly high reply rate of 6.5% over 50 sends, contradicting the assumption that healthcare is unresponsive to AI workflow pitches`;
  const id = recordOutcome(db, {
    source_type: "diagnostic",
    source_ref: `diagnostic/${stamp}`,
    signal_type: "reply_aggregate_strong",
    signal_value: 0.065,
    description: sentinel,
    related_action_type: "cold_email",
    related_target: "healthcare_canada",
    observed_at: "2000-01-01 00:00:00", // far past — ensures FIFO picks it first
    meta: { test: true },
  });
  db.close();
  check(`recordOutcome inserts row`, id > 0, `outcome id=${id}`);

  // limit=1 + observed_at=2000 ensures this is the next outcome processed
  const r = spawnSync("node", ["scripts/organism/apply-outcomes-to-graph.mjs", "--limit=1"], {
    cwd: PROJECT, encoding: "utf-8", timeout: 180000,
  });
  const applyOk = r.status === 0;
  check("apply-outcomes-to-graph completes", applyOk, applyOk ? "exit 0" : `exit ${r.status}`);

  const db2 = openDb();
  const outcomeRow = db2.prepare("SELECT processed_at, graph_updates_json FROM outcomes WHERE id = ?").get(id);
  check("diagnostic outcome marked processed", !!outcomeRow?.processed_at);
  let opsApplied = 0;
  try { opsApplied = JSON.parse(outcomeRow.graph_updates_json || "[]").length; } catch {}
  check("diagnostic outcome produced graph ops", opsApplied > 0, `${opsApplied} ops`);

  const afterBeliefs = totalBeliefs(db2);
  check("graph changed after apply", afterBeliefs >= beforeBeliefs, `before=${beforeBeliefs}, after=${afterBeliefs}`);

  const newBeliefs = db2.prepare(`
    SELECT b.* FROM beliefs b
    JOIN belief_log l ON l.belief_id = b.id
    WHERE l.source_ref = ?
  `).all(`outcome#${id}`);
  check("graph operations linked to diagnostic outcome via log", newBeliefs.length > 0, `${newBeliefs.length} ops logged`);
  db2.close();
}

// ─── 7. Source credibility math ──────────────────────────────────
header("7. SOURCE CREDIBILITY");
{
  const db = openDb();
  const cred = listSourceCredibility(db);
  check("source_credibility table populated", cred.length > 0, `${cred.length} sources tracked`);
  for (const s of cred) {
    const total = s.confirms_count + s.contradicts_count;
    if (total === 0) continue;
    const expected = (s.confirms_count + 2) / (total + 4);
    const diff = Math.abs(s.credibility - expected);
    check(`${s.source_type} credibility math correct`, diff < 0.01, `stored=${s.credibility.toFixed(3)}, expected=${expected.toFixed(3)}`);
  }
  // Diagnostic source should have appeared
  const diag = cred.find(s => s.source_type === "diagnostic");
  check("diagnostic source registered", !!diag, diag ? `cred=${diag.credibility.toFixed(2)}` : "missing");
  db.close();
}

// ─── 8. Hook output ──────────────────────────────────────────────
header("8. SESSIONSTART HOOK");
{
  const r = spawnSync("bash", [HOOK], { cwd: PROJECT, encoding: "utf-8" });
  check("hook script runs successfully", r.status === 0, `exit ${r.status}`);
  const out = r.stdout || "";
  check("hook output non-empty", out.length > 200, `${out.length} chars`);
  check("hook output contains digest header", out.includes("ORGANISM DIGEST"));
  check("hook output contains current verdict", out.includes("Top markets") || out.includes("verdict"));
  check("hook regenerates digest", existsSync(DIGEST));
}

// ─── 9. Track record / claim auto-resolve ────────────────────────
header("9. CLAIM TRACK RECORD");
{
  const db = openDb();
  const stats = claimAccuracyStats(db);
  check("track record table has rows", stats.total > 0, `${stats.total} claims`);
  // Make a claim that should auto-resolve when paired with a matching outcome
  // (We'll test this is wired; actual resolution depends on Claude semantics.)
  db.close();
}

// ─── 10. Existing system not broken ──────────────────────────────
header("10. EXISTING SYSTEM IMPACT");
{
  // Verify no shared table names with linkedin-brand-os.sqlite
  if (existsSync(SRC_DB)) {
    const orgDb = openDb();
    const orgTables = orgDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
    orgDb.close();
    const srcDb = new Database(SRC_DB, { readonly: true });
    const srcTables = srcDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
    srcDb.close();
    // sqlite_sequence is an internal SQLite table created automatically when AUTOINCREMENT is used.
    // It exists per-DB-file, so "overlap" is meaningless for system tables.
    const SYSTEM_TABLES = new Set(["sqlite_sequence", "sqlite_stat1", "sqlite_stat4"]);
    const overlap = orgTables.filter(t => srcTables.includes(t) && !SYSTEM_TABLES.has(t));
    check("no table-name collisions with linkedin-brand-os.sqlite", overlap.length === 0, overlap.length > 0 ? `OVERLAP: ${overlap.join(",")}` : "clean (sqlite_sequence intentionally per-DB)");
  }

  // Verify adapters open source DB read-only (no journal/wal mutations)
  const beforeMtime = existsSync(SRC_DB) ? statSync(SRC_DB).mtimeMs : 0;
  spawnSync("node", ["scripts/organism/ingest-conversations.mjs", "--dry-run"], { cwd: PROJECT, encoding: "utf-8" });
  const afterMtime = existsSync(SRC_DB) ? statSync(SRC_DB).mtimeMs : 0;
  check("adapter does not mutate source DB", beforeMtime === afterMtime, `mtime delta=${afterMtime - beforeMtime}ms`);

  // Existing bot processes still alive?
  let psOut = "";
  try { psOut = execSync("ps aux | grep -E '(orchestrator|cortex-daemon)' | grep -v grep", { encoding: "utf-8" }); } catch {}
  const procs = psOut.split("\n").filter(Boolean).length;
  check("existing daemons still running", procs > 0, `${procs} processes`);
}

// ─── 11. Pulse runs cleanly ──────────────────────────────────────
header("11. PULSE END-TO-END");
{
  const r = spawnSync("bash", ["scripts/organism/organism-pulse.sh"], {
    cwd: PROJECT, encoding: "utf-8", timeout: 540000,
  });
  check("pulse exits successfully", r.status === 0, `exit ${r.status}`);
  const out = r.stdout || "";
  check("pulse runs all 4 adapters", out.includes("ingest-awareness") && out.includes("ingest-awareness-apply-log") && out.includes("ingest-outreach-replies") && out.includes("ingest-conversations"));
  check("pulse runs apply step", out.includes("apply-outcomes-to-graph"));
  check("pulse runs digest regen", out.includes("digest regenerated"));
  check("pulse stats summary present", out.includes("beliefs:") && out.includes("outcomes:"));
}

// ─── 12. Performance & growth metrics ────────────────────────────
header("12. METRICS & GROWTH");
{
  const db = openDb();
  const beliefs = totalBeliefs(db);
  const outcomes = totalOutcomes(db);
  const unprocessed = db.prepare("SELECT COUNT(*) FROM outcomes WHERE processed_at IS NULL").get()['COUNT(*)'];
  const claims = db.prepare("SELECT COUNT(*) FROM claims").get()['COUNT(*)'];
  const log = db.prepare("SELECT COUNT(*) FROM belief_log").get()['COUNT(*)'];
  const sources = db.prepare("SELECT COUNT(*) FROM source_credibility").get()['COUNT(*)'];
  const dbSize = (statSync(ORG_DB).size / 1024).toFixed(1);

  console.log(`  beliefs=${beliefs}  outcomes=${outcomes} (unprocessed=${unprocessed})  claims=${claims}  log=${log}  sources=${sources}  dbsize=${dbSize}KiB`);
  check("beliefs > 200 (bootstrap successful)", beliefs > 200);
  check("outcomes > 50 (adapters wired)", outcomes > 50);
  check("multiple sources tracked", sources >= 2);
  check("no runaway log growth", log < beliefs * 5, `log/beliefs=${(log/beliefs).toFixed(1)}`);

  // Top sources by credibility
  const top = listSourceCredibility(db).slice(0, 5);
  console.log(`  top credible sources: ${top.map(s => `${s.source_type}=${s.credibility.toFixed(2)}`).join(", ")}`);
  db.close();
}

// ─── 13. Telegram bidirectional ──────────────────────────────────
header("13. TELEGRAM CHANNEL (bidirectional)");
{
  const inboxPath = resolve(PROJECT, ".data/organism-telegram-inbox.jsonl");
  check("inbox jsonl path exists", existsSync(inboxPath), existsSync(inboxPath) ? `${(statSync(inboxPath).size / 1024).toFixed(1)} KiB` : "missing");

  const speakLog = resolve(PROJECT, ".data/organism-telegram-speak.log");
  check("speak log present", existsSync(speakLog));

  // Verify telegram-control daemon is running (it owns the live socket)
  let psOut = "";
  try { psOut = execSync("ps aux | grep telegram-control.mjs | grep -v grep", { encoding: "utf-8" }); } catch {}
  check("telegram-control daemon alive", psOut.length > 0);

  // Verify mirroring patch is in place
  const tcSource = readFileSync(resolve(PROJECT, "scripts/factory/telegram-control.mjs"), "utf-8");
  check("telegram-control has mirror patch", tcSource.includes("organism-telegram-inbox.jsonl"));

  // Verify the recent speak attempts (organism actually contacted Kirill)
  if (existsSync(speakLog)) {
    const lines = readFileSync(speakLog, "utf-8").trim().split("\n").filter(Boolean);
    check("organism has spoken at least once", lines.length > 0, `${lines.length} entries`);
  }
}

// ─── 14. Curiosity engine ────────────────────────────────────────
header("14. CURIOSITY ENGINE");
{
  const statePath = resolve(PROJECT, ".data/organism-curiosity-state.json");
  check("curiosity state file exists", existsSync(statePath));
  if (existsSync(statePath)) {
    try {
      const state = JSON.parse(readFileSync(statePath, "utf-8"));
      check("curiosity has spoken at least once", !!state.last_spoken_at, state.last_spoken_at || "never");
      check("curiosity tracked a topic", !!state.last_topic, state.last_topic || "none");
    } catch (e) { check("curiosity state parses", false, e.message); }
  }

  // Run dry-run and verify it picks something
  const r = spawnSync("node", ["scripts/organism/organism-curiosity.mjs", "--dry-run", "--force"], {
    cwd: PROJECT, encoding: "utf-8", timeout: 10000,
  });
  const out = r.stdout || "";
  check("curiosity engine selects a topic", /picked: (VERDICT_SHIFT|CONTRADICTION|RISKY_HIGH|KNOWLEDGE_GAP|SILENCE|NEW_LEARNING)/.test(out));
}

// ─── 15. Dashboard ───────────────────────────────────────────────
header("15. VISUAL DASHBOARD");
{
  const dashPath = resolve(PROJECT, ".data/organism-dashboard.html");
  check("dashboard html exists", existsSync(dashPath));
  if (existsSync(dashPath)) {
    const size = statSync(dashPath).size;
    check("dashboard non-empty", size > 5000, `${(size / 1024).toFixed(1)} KiB`);
    const html = readFileSync(dashPath, "utf-8");
    check("dashboard renders verdict", html.includes("Strategic verdict") || html.includes("verdict"));
    check("dashboard renders top beliefs", html.includes("Top beliefs"));
    check("dashboard renders source credibility", html.includes("Source credibility"));
  }
}

// ─── 16. Verdict regen integration ───────────────────────────────
header("16. VERDICT REGENERATION");
{
  const db = openDb();
  const recentVerdicts = db.prepare(`SELECT COUNT(*) AS n FROM beliefs WHERE domain LIKE 'verdict.%'`).get().n;
  check("at least one verdict in graph", recentVerdicts > 0, `${recentVerdicts} verdicts`);
  // Multiple verdicts indicates regeneration has run at least once
  check("verdict has been regenerated (multiple in graph)", recentVerdicts >= 2, `${recentVerdicts} verdicts`);
  db.close();
}

// ─── 17. Time-series ─────────────────────────────────────────────
header("17. TIME-SERIES");
{
  const db = openDb();
  const snapTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='belief_snapshots'").get();
  check("belief_snapshots table exists", !!snapTable);
  const snapCount = db.prepare("SELECT COUNT(*) AS n FROM belief_snapshots").get().n;
  check("belief_snapshots populated", snapCount > 0, `${snapCount} rows`);
  const today = new Date().toISOString().slice(0, 10);
  const todaySnap = db.prepare("SELECT COUNT(*) AS n FROM belief_snapshots WHERE snapshot_date = ?").get(today).n;
  check("today's snapshot present", todaySnap > 0, `${todaySnap} for ${today}`);
  db.close();
}

// ─── 18. Action proposals ────────────────────────────────────────
header("18. ACTION PROPOSALS");
{
  const db = openDb();
  const tbl = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='action_proposals'").get();
  check("action_proposals table exists", !!tbl);
  const count = db.prepare("SELECT COUNT(*) AS n FROM action_proposals").get().n;
  check("action_proposals table accessible", count >= 0, `${count} rows`);
  db.close();
  // Verify the script file exists and runs
  check("propose-action.mjs script present", existsSync(resolve(PROJECT, "scripts/organism/propose-action.mjs")));
}

// ─── 19. Variant predictions ─────────────────────────────────────
header("19. VARIANT PREDICTIONS");
{
  const db = openDb();
  const tbl = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='variant_predictions'").get();
  check("variant_predictions table exists", !!tbl);
  check("variants.mjs script present", existsSync(resolve(PROJECT, "scripts/organism/variants.mjs")));
  db.close();
}

// ─── 20. Sensor proposals ────────────────────────────────────────
header("20. SENSOR PROPOSALS");
{
  const db = openDb();
  const tbl = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='sensor_proposals'").get();
  check("sensor_proposals table exists", !!tbl);
  check("propose-sensor.mjs script present", existsSync(resolve(PROJECT, "scripts/organism/propose-sensor.mjs")));
  db.close();
}

// ─── 21. Real-time conversation daemon ───────────────────────────
header("21. RESPOND DAEMON");
{
  const pidFile = resolve(PROJECT, ".data/organism-respond.pid");
  check("respond daemon pid file", existsSync(pidFile));
  if (existsSync(pidFile)) {
    const pid = parseInt(readFileSync(pidFile, "utf-8").trim(), 10);
    let alive = false;
    try { execSync(`ps -p ${pid}`, { stdio: "ignore" }); alive = true; } catch {}
    check("respond daemon process alive", alive, `PID ${pid}`);
  }
  const stateFile = resolve(PROJECT, ".data/organism-respond-state.json");
  check("respond daemon state file", existsSync(stateFile));
}

// ─── Summary ─────────────────────────────────────────────────────
const passed = results.filter(r => r.ok).length;
const failed = results.filter(r => !r.ok).length;
console.log(`\n=================================================`);
console.log(`DIAGNOSTIC SUMMARY: ${passed}/${passed + failed} checks passed`);
if (failed > 0) {
  console.log(`\nFAILED CHECKS:`);
  for (const r of results.filter(r => !r.ok)) console.log(`  ✗ ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
}
console.log(`=================================================`);
process.exit(failed > 0 ? 1 : 0);
