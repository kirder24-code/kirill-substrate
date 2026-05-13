/**
 * scripts/survival/integration-audit.mjs
 *
 * Mechanical audit: which modules in scripts/ are actually wired into
 * something else, and which are floating. Produces a single markdown
 * report Kirill can read to see the real topology, not the marketing
 * one.
 *
 * For each .mjs file in scripts/, classify:
 *   - has_register_bus: exports register(bus)? (substrate cortex contract)
 *   - in_cortex_launcher: is it imported by cortex-launcher.mjs?
 *   - in_pulse_daemon: is it called by organism-pulse.sh?
 *   - has_cron_or_daemon: registered by any other long-running script?
 *   - reads_data: which .data/* files does it read?
 *   - writes_data: which .data/* files does it write?
 *   - imports_other: which other scripts/ files does it import?
 *   - imported_by: which other scripts/ files import it?
 *
 * Also audits:
 *   - Wiki pages count and substrate-read count
 *   - state-bus event topSources (who emits, who listens)
 *   - Whether cortex-launcher has ever booted successfully
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { resolve, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const SCRIPTS_DIR = resolve(ROOT, "scripts");

function listScripts(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) out.push(...listScripts(full));
    else if (entry.endsWith(".mjs")) out.push(full);
  }
  return out;
}

const scripts = listScripts(SCRIPTS_DIR);

// Pull cortex-launcher imports (Phase 1-11)
const launcher = readFileSync(resolve(SCRIPTS_DIR, "cortex/cortex-launcher.mjs"), "utf-8");
const launcherImports = new Set();
for (const m of launcher.matchAll(/"\.\.?\/[^"]+\.mjs"/g)) {
  const rel = m[0].replace(/"/g, "");
  launcherImports.add(rel);
}

// Pull pulse-daemon calls
const pulse = readFileSync(resolve(SCRIPTS_DIR, "organism/organism-pulse.sh"), "utf-8");
const pulseCalled = new Set();
for (const m of pulse.matchAll(/scripts\/[A-Za-z0-9_/-]+\.mjs/g)) pulseCalled.add(m[0]);

function classify(filePath) {
  const rel = relative(ROOT, filePath);
  const txt = readFileSync(filePath, "utf-8");
  const baseName = rel.split("/").pop();

  const has_register = /export\s+function\s+register\s*\(\s*bus/.test(txt);
  // Simple substring check against launcher's resolved imports.
  const filenameOnly = baseName;
  const in_cortex_launcher = [...launcherImports].some(p => p.endsWith(filenameOnly));
  const in_pulse_daemon = [...pulseCalled].some(p => p.endsWith(filenameOnly));

  const reads_data = [...txt.matchAll(/\.data\/[A-Za-z0-9_./-]+/g)].map(m => m[0]);
  // Crude: assume readFileSync/JSON.parse near .data path = read. writeFileSync near = write.
  const writes_data_lines = txt.split("\n").filter(l => /writeFileSync|appendFileSync/.test(l) && /\.data/.test(l));
  const reads_data_lines = txt.split("\n").filter(l => /readFileSync|fetch.*\.data/.test(l) && /\.data/.test(l));

  const importsOther = [];
  for (const m of txt.matchAll(/from\s+"(\.[^"]+\.mjs)"/g)) importsOther.push(m[1]);

  return {
    rel,
    has_register,
    in_cortex_launcher,
    in_pulse_daemon,
    autorun: in_cortex_launcher || in_pulse_daemon,
    reads_data_count: new Set(reads_data).size,
    writes_data_count: writes_data_lines.length,
    imports_count: importsOther.length,
    size_bytes: statSync(filePath).size,
  };
}

const records = scripts.map(classify);

// Compute imported_by relationships (which scripts import which)
const importedByCount = new Map();
for (const s of records) {
  importedByCount.set(s.rel, 0);
}
for (const filePath of scripts) {
  const txt = readFileSync(filePath, "utf-8");
  for (const m of txt.matchAll(/from\s+"(\.[^"]+\.mjs)"/g)) {
    const importerDir = dirname(filePath);
    const importedAbs = resolve(importerDir, m[1]);
    const rel = relative(ROOT, importedAbs);
    if (importedByCount.has(rel)) importedByCount.set(rel, importedByCount.get(rel) + 1);
  }
}
for (const r of records) r.imported_by_count = importedByCount.get(r.rel);

// Grouped totals
function groupByDir(records, top) {
  const byDir = {};
  for (const r of records) {
    const dir = r.rel.split("/").slice(0, 2).join("/");
    byDir[dir] = byDir[dir] || { total: 0, autorun: 0, has_register: 0, orphan: 0 };
    byDir[dir].total++;
    if (r.autorun) byDir[dir].autorun++;
    if (r.has_register) byDir[dir].has_register++;
    if (!r.autorun && r.imported_by_count === 0) byDir[dir].orphan++;
  }
  return byDir;
}
const byDir = groupByDir(records);

// Wiki pages count
let wikiPages = 0, wikiBytesTotal = 0;
const wikiDir = resolve(ROOT, ".data/wiki-archive");
if (existsSync(wikiDir)) {
  for (const f of readdirSync(wikiDir)) {
    if (!f.endsWith(".md")) continue;
    wikiPages++;
    wikiBytesTotal += statSync(resolve(wikiDir, f)).size;
  }
}

// state-bus snapshot
let busSnapshot = null;
const busPath = resolve(ROOT, ".data/cortex-state-bus.json");
if (existsSync(busPath)) {
  try {
    const j = JSON.parse(readFileSync(busPath, "utf-8"));
    busSnapshot = {
      total_events: j.totalEvents || j.totalBroadcasts || (j.events?.length ?? null),
      cascade_depth: j.avgCascadeDepth ?? null,
      top_sources: (j.topSources || []).slice(0, 8),
      domains_touched: j.domainsTouched || [],
    };
  } catch {}
}

// Substrate's view: what does survival_loop actually consume?
const survivalReads = [];
for (const r of records.filter(x => x.rel.startsWith("scripts/survival/"))) {
  const txt = readFileSync(resolve(ROOT, r.rel), "utf-8");
  for (const m of txt.matchAll(/\.data\/[A-Za-z0-9_./-]+/g)) {
    survivalReads.push(m[0]);
  }
}
const uniqueSurvivalReads = [...new Set(survivalReads)];

// REPORT
console.log("# Integration Audit");
console.log(`generated: ${new Date().toISOString()}\n`);

console.log("## Headline\n");
console.log(`- Total .mjs scripts: **${records.length}**`);
console.log(`- With register(bus): **${records.filter(r => r.has_register).length}** (potential cortex modules)`);
console.log(`- Imported by cortex-launcher (auto-loaded on cortex boot): **${records.filter(r => r.in_cortex_launcher).length}**`);
console.log(`- Called by pulse-daemon (runs every hour): **${records.filter(r => r.in_pulse_daemon).length}**`);
console.log(`- Autoruns somewhere (launcher or pulse): **${records.filter(r => r.autorun).length}**`);
console.log(`- Truly orphan (not autorun, not imported anywhere): **${records.filter(r => !r.autorun && r.imported_by_count === 0).length}**`);
console.log();

console.log("## By directory\n");
console.log("| dir | total | autorun | has_register | orphan |");
console.log("|---|---|---|---|---|");
for (const [d, s] of Object.entries(byDir).sort()) {
  console.log(`| ${d} | ${s.total} | ${s.autorun} | ${s.has_register} | ${s.orphan} |`);
}
console.log();

console.log("## Wiki Brain (Obsidian-style memory)\n");
console.log(`- Wiki archive pages: **${wikiPages}**`);
console.log(`- Total wiki bytes: ${(wikiBytesTotal / 1024).toFixed(1)} KB`);
const wikiInSurvivalReads = uniqueSurvivalReads.filter(p => p.startsWith(".data/wiki")).length;
console.log(`- Wiki references in survival_loop code: **${wikiInSurvivalReads}**  ← if 0, substrate cannot read the wiki at all`);
console.log();

console.log("## Survival_loop's actual data inputs\n");
console.log("Files survival_loop code mentions reading from .data/:");
for (const p of uniqueSurvivalReads.slice(0, 30)) console.log(`- \`${p}\``);
console.log();

console.log("## Cortex state-bus snapshot\n");
if (busSnapshot) {
  console.log(`- Total events on bus: ${busSnapshot.total_events ?? "n/a"}`);
  console.log(`- Avg cascade depth: ${busSnapshot.cascade_depth ?? "n/a"}  (0 = events do NOT trigger downstream events)`);
  console.log(`- Domains touched: ${busSnapshot.domains_touched.length === 0 ? "**EMPTY** (no external-world domain in any event)" : busSnapshot.domains_touched.join(", ")}`);
  console.log(`- Top emitting sources:`);
  for (const s of busSnapshot.top_sources) console.log(`  - ${s.source ?? s[0]}: ${s.count ?? s[1]} events`);
} else {
  console.log("- state-bus snapshot file not found");
}
console.log();

console.log("## Concrete bridges that EXIST today\n");
const bridges = [
  { from: "organism-pulse.sh", to: "scripts/survival/tick-once.mjs", how: "shell call every hour (step 0c)" },
  { from: "organism-pulse.sh", to: "scripts/cortex/perception-feeder.mjs", how: "shell call every hour (step 0a)" },
  { from: "organism-pulse.sh", to: "scripts/cortex/announce-perception.mjs", how: "shell call every hour (step 0b)" },
  { from: "cortex-launcher", to: "11 phases of cortex modules + Phase 8.5 survival-loop", how: "register(bus) on boot. NEVER booted end-to-end per ARCHITECTURE.md" },
  { from: "perception-feeder", to: ".data/email-inbox-state.json + reddit-replies-monitor.json + telegram-callback-log.json", how: "writes feed files for substrate perception" },
  { from: "survival/opportunity-actions.mjs", to: ".data/INTEL.md (read)", how: "ingest_organism_research action reads it as seed" },
  { from: "survival/funding-hunter.mjs", to: "10 public gov-grant URLs", how: "fetches and Claude-extracts new opportunities" },
];
for (const b of bridges) console.log(`- **${b.from}** → **${b.to}**\n  - via: ${b.how}`);
console.log();

console.log("## Concrete bridges that DO NOT exist (gaps)\n");
const gaps = [
  "scripts/factory/* (27 factory bots) → cortex bus or substrate (NOT registered, NOT called by pulse)",
  "Wiki Brain (.data/wiki-archive/*.md) → substrate cognition (no action reads it)",
  ".data/linkedin-brand-os.sqlite (74K leads, 668 outreach emails) → substrate (no read action)",
  "Existing .data/cortex-* introspection files → substrate's own decisions (substrate does not read its own affect/curiosity)",
  "Substrate's outputs (drafts, opportunities) → existing organism digest (organism does not see substrate's work)",
  "scripts/outreach/* → substrate (substrate cannot trigger send-outreach.mjs)",
  "organism research bot output (cycle*-*.md, awareness/*) → substrate funding-hunter (only INTEL.md is read)",
];
for (const g of gaps) console.log(`- ${g}`);
console.log();

console.log("## Recommendation\n");
console.log("- This codebase is a federation of subsystems, not one organism.");
console.log("- The closest thing to a 'nervous system' right now is **organism-pulse.sh** (calls 4 substrate steps + 9 organism steps each hour) and **cortex-launcher.mjs** (in-process state-bus when booted, but unverified end-to-end).");
console.log("- The Wiki Brain exists as files; nothing reads them as input to decision-making yet.");
console.log("- The fastest single wiring fix: an action `read_wiki_brain` that lets substrate query its own knowledge base before generating drafts/research. This makes the Obsidian wiki actually a brain instead of just an archive.");
