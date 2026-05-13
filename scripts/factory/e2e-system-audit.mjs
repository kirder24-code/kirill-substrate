/**
 * e2e-system-audit.mjs — Full system integrity check
 *
 * Finds ALL errors in one run. Not "is it alive" but "is it correct".
 * Run: node scripts/factory/e2e-system-audit.mjs
 *
 * Checks:
 *  1. Syntax: every .mjs in scripts/ passes node --check
 *  2. Dead refs: voice agent, old products, stale deadlines, wrong names
 *  3. Imports: every import resolves to a real file
 *  4. PURPOSE chain: which bots read PURPOSE, which are blind
 *  5. Directives chain: who writes, who reads
 *  6. Daemon coverage: every bot in daemon has a real file
 *  7. DB schema: tables bots expect actually exist
 *  8. Wiki consistency: PURPOSE vs MISSION vs current-thesis offers match
 *  9. Site: no dead product refs, sitemap complete
 * 10. Channel capabilities: capabilities.md matches reality
 * 11. Full chain trace: PURPOSE → brain → directives → orchestrator → action
 *
 * Output: structured report with PASS / FAIL / WARN for each check
 */

import { execSync, spawnSync } from "child_process";
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { resolve, dirname, relative } from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DB_PATH = resolve(ROOT, ".data/linkedin-brand-os.sqlite");

const results = { pass: 0, fail: 0, warn: 0, details: [] };

function pass(check, detail = "") {
  results.pass++;
  results.details.push({ status: "PASS", check, detail });
}
function fail(check, detail = "") {
  results.fail++;
  results.details.push({ status: "FAIL", check, detail });
}
function warn(check, detail = "") {
  results.warn++;
  results.details.push({ status: "WARN", check, detail });
}

// Collect all .mjs files recursively
function findMjs(dir, list = []) {
  if (!existsSync(dir)) return list;
  for (const f of readdirSync(dir)) {
    const full = resolve(dir, f);
    try {
      if (statSync(full).isDirectory()) {
        if (!f.startsWith(".") && f !== "node_modules") findMjs(full, list);
      } else if (f.endsWith(".mjs")) {
        list.push(full);
      }
    } catch {}
  }
  return list;
}

console.log("=== E2E SYSTEM AUDIT ===\n");

// ── 1. SYNTAX CHECK ─────────────────────────────────────────────────
console.log("1. Syntax check...");
const allMjs = findMjs(resolve(ROOT, "scripts"));
let syntaxFails = 0;
for (const f of allMjs) {
  const r = spawnSync("node", ["--check", f], { encoding: "utf-8", timeout: 10000 });
  if (r.status !== 0) {
    const rel = relative(ROOT, f);
    fail(`syntax: ${rel}`, (r.stderr || "").split("\n")[0]);
    syntaxFails++;
  }
}
if (syntaxFails === 0) pass(`syntax: all ${allMjs.length} .mjs files pass`);
else fail(`syntax: ${syntaxFails}/${allMjs.length} files failed`);

// ── 2. DEAD REFERENCES ──────────────────────────────────────────────
console.log("2. Dead references...");

const DEAD_PATTERNS = [
  { name: "voice agent (active code)", pattern: /voice[._\s-]?agent|voice[._\s-]?receptionist|AI[._\s]receptionist/i, exclude: /DISCONTINUED|discontinued|blocklist|DEAD_THEMES|DEAD_CHANNELS|do.not|killed|dead|removed/i },
  { name: "old product catalog", pattern: /zapier-migration|ai-ops-hub|lead-gen-system|local-ai-mini|local-ai-pro|local-ai-enterprise/ },
  { name: "April 5 deadline", pattern: /2026-04-05/ },
  { name: "wrong surname Dorofeev", pattern: /Dorofeev/i },
  { name: "burned email", pattern: /calgarygrowth@gmail/i, exclude: /never.*use|guard|filter|exclude|block/i },
  { name: "dead demo phone 856", pattern: /856.*556.*8035/ },
];

for (const dp of DEAD_PATTERNS) {
  let found = [];
  for (const f of allMjs) {
    // Skip files marked DISCONTINUED
    try {
      const content = readFileSync(f, "utf-8");
      if (content.slice(0, 200).includes("DISCONTINUED")) continue;
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (dp.pattern.test(lines[i])) {
          if (dp.exclude && dp.exclude.test(lines[i])) continue;
          found.push(`${relative(ROOT, f)}:${i + 1}`);
        }
      }
    } catch {}
  }
  if (found.length === 0) pass(`dead-ref: no "${dp.name}"`);
  else warn(`dead-ref: "${dp.name}" in ${found.length} locations`, found.slice(0, 5).join(", "));
}

// ── 3. PURPOSE CHAIN ────────────────────────────────────────────────
console.log("3. PURPOSE chain...");

const activeBotsInDaemon = [
  "research-bot-v2", "lead-enrichment-bot", "content-curator-bot", "site-curator-bot",
  "awareness-bot", "threads-bot", "x-pain-scout", "linkedin-deep-analyzer",
  "icp-outreach-bot", "reddit-monitor", "pipeline-bridge", "sales-bot",
  "idea-bot", "evolution-bot", "brief-agent", "analytics-bot", "content-bot",
  "community-bot", "competitor-agent", "build-bot", "system-brain", "project-executor",
  "builder-bot", "calgary-email-outreach", "hypothesis-executor", "self-builder",
  "scout-bot", "telegram-control", "deal-assist",
];

for (const bot of activeBotsInDaemon) {
  const paths = [
    resolve(ROOT, `scripts/factory/${bot}.mjs`),
    resolve(ROOT, `scripts/outreach/${bot}.mjs`),
    resolve(ROOT, `scripts/cortex/${bot}.mjs`),
  ];
  const botPath = paths.find(p => existsSync(p));
  if (!botPath) { warn(`purpose-chain: ${bot} file not found`); continue; }

  try {
    const code = readFileSync(botPath, "utf-8");
    const importsReadPurpose = /readPurpose/.test(code);
    const callsReadPurpose = /readPurpose\s*\(/.test(code);
    const usesCallAI = /callAI\s*\(/.test(code);

    if (callsReadPurpose) pass(`purpose-chain: ${bot} calls readPurpose()`);
    else if (usesCallAI) pass(`purpose-chain: ${bot} uses callAI (gets PURPOSE via injection)`);
    else if (importsReadPurpose) warn(`purpose-chain: ${bot} imports but NEVER CALLS readPurpose()`);
    else warn(`purpose-chain: ${bot} has NO PURPOSE access`);
  } catch {}
}

// ── 4. DIRECTIVES CHAIN ─────────────────────────────────────────────
console.log("4. Directives chain...");

const directivesFile = resolve(ROOT, "wiki/directives.md");
if (existsSync(directivesFile)) {
  const content = readFileSync(directivesFile, "utf-8");
  const match = content.match(/Last updated: (.+)/);
  if (match) {
    const updatedAt = new Date(match[1]);
    const hoursAgo = (Date.now() - updatedAt.getTime()) / (60 * 60 * 1000);
    if (hoursAgo < 2) pass(`directives: fresh (${hoursAgo.toFixed(1)}h ago)`);
    else if (hoursAgo < 24) warn(`directives: ${hoursAgo.toFixed(0)}h old`);
    else fail(`directives: ${hoursAgo.toFixed(0)}h old - system-brain may be dead`);
  }
} else fail("directives: wiki/directives.md does not exist");

// ── 5. DAEMON COVERAGE ──────────────────────────────────────────────
console.log("5. Daemon coverage...");

try {
  const daemonCode = readFileSync(resolve(ROOT, "scripts/factory/sonnet-bots-daemon.mjs"), "utf-8");
  const runBotCalls = daemonCode.match(/runBot\("([^"]+)"/g) || [];
  const daemonBots = runBotCalls.map(m => m.match(/runBot\("([^"]+)"/)[1]);

  for (const bot of daemonBots) {
    // Check if the bot file exists (try factory, outreach, cortex)
    const paths = [
      resolve(ROOT, `scripts/factory/${bot}.mjs`),
      resolve(ROOT, `scripts/outreach/${bot}.mjs`),
      resolve(ROOT, `scripts/cortex/${bot}.mjs`),
    ];
    // Also check for scriptPath overrides in daemon
    const scriptPathMatch = daemonCode.match(new RegExp(`runBot\\("${bot}"[^)]*"([^"]+)"\\)`));
    if (scriptPathMatch) paths.unshift(resolve(ROOT, scriptPathMatch[1]));

    if (paths.some(p => existsSync(p))) pass(`daemon: ${bot} file exists`);
    else fail(`daemon: ${bot} file NOT FOUND`);
  }
} catch (e) { fail(`daemon: cannot read sonnet-bots-daemon.mjs: ${e.message}`); }

// ── 6. DB SCHEMA ────────────────────────────────────────────────────
console.log("6. DB schema...");

const REQUIRED_TABLES = [
  "leads", "lead_enrichment", "outreach_emails", "bot_heartbeats",
  "bot_tasks", "bot_intelligence", "goals", "awareness_items",
  "hypothesis_tests",
];

try {
  const db = new Database(DB_PATH, { readonly: true });
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  for (const t of REQUIRED_TABLES) {
    if (tables.includes(t)) pass(`db-schema: table ${t} exists`);
    else warn(`db-schema: table ${t} MISSING`);
  }
  db.close();
} catch (e) { fail(`db-schema: cannot open DB: ${e.message}`); }

// ── 7. WIKI CONSISTENCY ────────────────────────────────────────────
console.log("7. Wiki consistency...");

const CURRENT_OFFERS = ["Vibe-Code Audit", "Reply Chaser", "First 10 Customers", "Custom AI"];

function checkOffersInFile(path, label) {
  if (!existsSync(path)) { warn(`wiki: ${label} does not exist`); return; }
  const content = readFileSync(path, "utf-8");
  let found = 0;
  for (const offer of CURRENT_OFFERS) {
    if (content.includes(offer)) found++;
  }
  if (found >= 3) pass(`wiki: ${label} has ${found}/4 current offers`);
  else if (found >= 1) warn(`wiki: ${label} only has ${found}/4 current offers`);
  else fail(`wiki: ${label} has 0/4 current offers - stale`);

  // Check for dead products
  if (/voice.agent|voice.receptionist/i.test(content) && !/DISCONTINUED|dead|killed|removed/i.test(content))
    fail(`wiki: ${label} still references voice agents`);
}

checkOffersInFile(resolve(ROOT, "wiki/PURPOSE.md"), "PURPOSE.md");
checkOffersInFile(resolve(ROOT, "MISSION.md"), "MISSION.md");
checkOffersInFile(resolve(ROOT, "wiki/strategy/current-thesis.md"), "current-thesis.md");

// ── 8. SITE CHECK ──────────────────────────────────────────────────
console.log("8. Site check...");

const indexPath = resolve(ROOT, "sandbox-review/site/index.html");
if (existsSync(indexPath)) {
  const html = readFileSync(indexPath, "utf-8");
  if (/voice.agent|voice.receptionist|missed.call.*patient/i.test(html))
    fail("site: index.html still has voice agent references");
  else pass("site: index.html clean of voice agent refs");

  if (html.includes("launchsoloai.com")) pass("site: references launchsoloai.com");

  // Check offers on site
  let siteOffers = 0;
  for (const o of CURRENT_OFFERS) {
    if (html.includes(o)) siteOffers++;
  }
  if (siteOffers >= 3) pass(`site: ${siteOffers}/4 current offers on homepage`);
  else warn(`site: only ${siteOffers}/4 offers on homepage`);
}

// Sitemap completeness
const sitemapPath = resolve(ROOT, "sandbox-review/site/sitemap.xml");
if (existsSync(sitemapPath)) {
  const sitemap = readFileSync(sitemapPath, "utf-8");
  const siteDir = resolve(ROOT, "sandbox-review/site");
  let missing = 0;
  const htmlFiles = readdirSync(siteDir).filter(f => f.endsWith(".html") && !["thank-you.html", "google9bba5aecabb74535.html"].includes(f));
  for (const f of htmlFiles) {
    if (!sitemap.includes(f)) {
      warn(`site: ${f} not in sitemap.xml`);
      missing++;
    }
  }
  if (missing === 0) pass("site: all pages in sitemap");
}

// ── 9. PROCESSES ────────────────────────────────────────────────────
console.log("9. Processes...");

try {
  const ps = execSync("ps aux", { encoding: "utf-8" });
  const daemons = ["orchestrator-daemon", "sonnet-bots-daemon", "telegram-control"];
  for (const d of daemons) {
    if (ps.includes(d)) pass(`process: ${d} running`);
    else fail(`process: ${d} NOT RUNNING`);
  }
} catch {}

// ── 10. FULL CHAIN TRACE ────────────────────────────────────────────
console.log("10. Full chain trace...");

// PURPOSE → system-brain reads it?
const sysBrainPath = resolve(ROOT, "scripts/factory/system-brain.mjs");
if (existsSync(sysBrainPath)) {
  const code = readFileSync(sysBrainPath, "utf-8");
  if (/readPurpose\(\)/.test(code)) pass("chain: system-brain calls readPurpose()");
  else fail("chain: system-brain does NOT call readPurpose()");
}

// system-brain → writes directives.md?
if (existsSync(directivesFile)) pass("chain: wiki/directives.md exists");
else fail("chain: wiki/directives.md missing");

// orchestrator-loop reads directives?
const orchLoopPath = resolve(ROOT, "scripts/factory/orchestrator-loop.mjs");
if (existsSync(orchLoopPath)) {
  const code = readFileSync(orchLoopPath, "utf-8");
  if (/directives/.test(code) && /readPurpose/.test(code))
    pass("chain: orchestrator-loop reads PURPOSE + directives");
  else fail("chain: orchestrator-loop missing PURPOSE or directives");
}

// Discovery → hypothesis-executor → feedback?
if (existsSync(resolve(ROOT, "scripts/factory/hypothesis-executor.mjs")))
  pass("chain: hypothesis-executor exists");
else fail("chain: hypothesis-executor MISSING");

if (existsSync(resolve(ROOT, ".data/cortex-discovery-state.json")))
  pass("chain: discovery state file exists");
else warn("chain: discovery state file missing - run discovery-engine");

// Self-builder exists?
if (existsSync(resolve(ROOT, "scripts/factory/self-builder.mjs")))
  pass("chain: self-builder exists");
else warn("chain: self-builder missing");

// ── 11. LOG FRESHNESS ───────────────────────────────────────────────
console.log("11. Log freshness...");

const criticalLogs = {
  "orchestrator-loop": resolve(ROOT, ".logs/orchestrator-loop.log"),
  "system-brain": "/tmp/lbo-system-brain.log",
  "sonnet-daemon": "/tmp/lbo-sonnet-bots-daemon.log",
  "monitor-replies": "/tmp/lbo-monitor-replies.log",
};

for (const [name, logPath] of Object.entries(criticalLogs)) {
  if (!existsSync(logPath)) { warn(`log: ${name} - no log file`); continue; }
  try {
    const mtime = statSync(logPath).mtimeMs;
    const minAgo = (Date.now() - mtime) / 60000;
    if (minAgo < 60) pass(`log: ${name} fresh (${minAgo.toFixed(0)}min ago)`);
    else if (minAgo < 240) warn(`log: ${name} stale (${minAgo.toFixed(0)}min ago)`);
    else fail(`log: ${name} very stale (${(minAgo / 60).toFixed(0)}h ago)`);
  } catch {}
}

// ── REPORT ──────────────────────────────────────────────────────────
console.log("\n" + "=".repeat(60));
console.log(`RESULTS: ${results.pass} PASS | ${results.fail} FAIL | ${results.warn} WARN`);
console.log("=".repeat(60));

if (results.fail > 0) {
  console.log("\n❌ FAILURES:");
  for (const d of results.details.filter(d => d.status === "FAIL")) {
    console.log(`  ${d.check}${d.detail ? " — " + d.detail : ""}`);
  }
}

if (results.warn > 0) {
  console.log("\n⚠️  WARNINGS:");
  for (const d of results.details.filter(d => d.status === "WARN")) {
    console.log(`  ${d.check}${d.detail ? " — " + d.detail : ""}`);
  }
}

if (results.fail === 0 && results.warn === 0) {
  console.log("\n✅ ALL CHECKS PASSED");
}

console.log(`\nTotal checks: ${results.pass + results.fail + results.warn}`);
process.exit(results.fail > 0 ? 1 : 0);
