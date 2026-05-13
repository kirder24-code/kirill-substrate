/**
 * audit-bot.mjs - Full dependency graph + dead link scanner
 *
 * Scans scripts/factory, scripts/outreach, scripts/cortex
 * Builds import graph, classifies each file as ACTIVE/ORPHAN/DEAD_IMPORT
 * Saves checkpoint every 15 min to .data/audit-checkpoint.json
 * Writes final report to .data/audit-report.md
 *
 * Run: node scripts/factory/audit-bot.mjs
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from "fs";
import { resolve, dirname, relative, basename } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const CHECKPOINT_FILE = resolve(ROOT, ".data/audit-checkpoint.json");
const REPORT_FILE = resolve(ROOT, ".data/audit-report.md");

// Directories to scan
const SCAN_DIRS = [
  "scripts/factory",
  "scripts/outreach",
  "scripts/cortex",
  "wiki",
];

// Active entry points (from cron + ecosystem config)
const CRON_ACTIVE = new Set([
  "scripts/factory/fresh-pain-scout.mjs",
  "scripts/factory/hn-show-hn-scout.mjs",
  "scripts/factory/calgary-local-pain-scout.mjs",
  "scripts/factory/ih-products-scout.mjs",
  "scripts/factory/hn-whoshiring-scout.mjs",
  "scripts/factory/buying-signal-hunt.mjs",
  "scripts/factory/daily-observations.mjs",
  "scripts/factory/daily-heartbeat-report.mjs",
  "scripts/factory/awareness-bot.mjs",
  "scripts/outreach/monitor-replies.mjs",
  "scripts/factory/cron-watchdog.mjs",
  "dashboard/update-data.mjs",
  // PM2
  "scripts/cortex/cortex-daemon.mjs",
]);

let checkpoint = {
  startedAt: new Date().toISOString(),
  phase: "init",
  scannedFiles: 0,
  totalFiles: 0,
  graph: {},
  orphans: [],
  deadImports: [],
  activeFiles: [],
  errors: [],
};

function saveCheckpoint() {
  checkpoint.savedAt = new Date().toISOString();
  writeFileSync(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2));
  console.log(`[checkpoint] Saved at ${checkpoint.savedAt}`);
}

// Auto-save every 15 minutes
const checkpointInterval = setInterval(saveCheckpoint, 15 * 60 * 1000);

function collectFiles() {
  const files = [];
  for (const dir of SCAN_DIRS) {
    const abs = resolve(ROOT, dir);
    if (!existsSync(abs)) continue;
    try {
      const entries = readdirSync(abs, { withFileTypes: true });
      for (const e of entries) {
        if (e.isFile() && e.name.endsWith(".mjs")) {
          files.push(relative(ROOT, resolve(abs, e.name)));
        }
      }
    } catch (err) {
      checkpoint.errors.push(`collectFiles ${dir}: ${err.message}`);
    }
  }
  return files;
}

// Extract import paths from a file's source
function extractImports(src, filePath) {
  const imports = [];
  // static imports: import ... from 'path'
  const staticRe = /^\s*import\s+(?:[^'"]*\s+from\s+)?['"]([^'"]+)['"]/gm;
  // dynamic imports: import('path')
  const dynRe = /import\(\s*['"]([^'"]+)['"]\s*\)/g;

  let m;
  while ((m = staticRe.exec(src)) !== null) imports.push(m[1]);
  while ((m = dynRe.exec(src)) !== null) imports.push(m[1]);

  return imports;
}

// Resolve import specifier relative to importing file
function resolveImport(specifier, importerRelPath) {
  if (!specifier.startsWith(".")) return null; // external package, skip
  const importerAbs = resolve(ROOT, importerRelPath);
  const importerDir = dirname(importerAbs);
  let resolved = resolve(importerDir, specifier);
  // If no extension, try .mjs then .js
  if (!resolved.endsWith(".mjs") && !resolved.endsWith(".js") && !resolved.endsWith(".cjs")) {
    if (existsSync(resolved + ".mjs")) resolved += ".mjs";
    else if (existsSync(resolved + ".js")) resolved += ".js";
    else resolved += ".mjs"; // assume .mjs for dead check
  }
  return relative(ROOT, resolved);
}

function buildGraph(files) {
  const graph = {}; // file -> { imports: [], importedBy: [], exists: bool, size: number, mtime: string }
  const fileSet = new Set(files);

  for (const f of files) {
    graph[f] = { imports: [], importedBy: [], exists: true, size: 0, mtime: "" };
    try {
      const abs = resolve(ROOT, f);
      const stat = statSync(abs);
      graph[f].size = stat.size;
      graph[f].mtime = stat.mtime.toISOString();
      const src = readFileSync(abs, "utf8");
      const rawImports = extractImports(src, f);
      for (const spec of rawImports) {
        const resolved = resolveImport(spec, f);
        if (!resolved) continue; // external package
        graph[f].imports.push(resolved);
        // Track reverse
        if (!graph[resolved]) {
          graph[resolved] = { imports: [], importedBy: [], exists: existsSync(resolve(ROOT, resolved)), size: 0, mtime: "" };
        }
        graph[resolved].importedBy.push(f);
      }
    } catch (err) {
      checkpoint.errors.push(`buildGraph ${f}: ${err.message}`);
    }
    checkpoint.scannedFiles++;
    if (checkpoint.scannedFiles % 20 === 0) {
      console.log(`[scan] ${checkpoint.scannedFiles}/${checkpoint.totalFiles} files processed`);
    }
  }
  return graph;
}

function classify(graph) {
  const active = [];
  const orphans = [];
  const deadImports = []; // imports pointing to non-existent files

  for (const [file, meta] of Object.entries(graph)) {
    // Check dead imports
    if (!meta.exists) {
      deadImports.push({ file, importedBy: meta.importedBy });
      continue;
    }

    const isCronEntry = CRON_ACTIVE.has(file);
    const isImported = meta.importedBy.length > 0;

    // Active if: cron entry, or imported by someone active
    if (isCronEntry) {
      active.push({ file, reason: "cron/pm2", importedBy: meta.importedBy, imports: meta.imports });
    } else if (isImported) {
      active.push({ file, reason: "imported", importedBy: meta.importedBy, imports: meta.imports });
    } else {
      // Not in cron, not imported by anyone
      orphans.push({ file, mtime: meta.mtime, size: meta.size, imports: meta.imports });
    }
  }

  return { active, orphans, deadImports };
}

function generateReport(graph, active, orphans, deadImports) {
  const now = new Date().toISOString();
  const lines = [];

  lines.push(`# AUDIT REPORT - ${now}`);
  lines.push(`\nScanned: ${Object.keys(graph).length} files`);
  lines.push(`Active: ${active.length} | Orphans: ${orphans.length} | Dead imports: ${deadImports.length}`);

  lines.push(`\n## ACTIVE FILES (${active.length})`);
  lines.push(`_Files reachable from cron/pm2 entry points_\n`);
  const cronEntries = active.filter(f => f.reason === "cron/pm2");
  const importedOnly = active.filter(f => f.reason === "imported");
  lines.push(`### Cron/PM2 Entry Points (${cronEntries.length})`);
  for (const f of cronEntries) lines.push(`- ${f.file}`);
  lines.push(`\n### Imported by active files (${importedOnly.length})`);
  for (const f of importedOnly) lines.push(`- ${f.file} (imported by: ${f.importedBy.slice(0,3).join(", ")}${f.importedBy.length > 3 ? "..." : ""})`);

  lines.push(`\n## ORPHAN FILES (${orphans.length})`);
  lines.push(`_Not in cron/pm2, not imported by anyone - candidates for deletion_\n`);
  // Sort by mtime descending (newest first)
  orphans.sort((a, b) => (b.mtime || "").localeCompare(a.mtime || ""));
  for (const f of orphans) {
    const kb = Math.round((f.size || 0) / 1024 * 10) / 10;
    const mtime = f.mtime ? f.mtime.slice(0, 10) : "unknown";
    const importsNote = f.imports.length > 0 ? ` [imports: ${f.imports.length} files]` : "";
    lines.push(`- ${f.file} (${kb}KB, last modified: ${mtime})${importsNote}`);
  }

  lines.push(`\n## DEAD IMPORTS (${deadImports.length})`);
  lines.push(`_Import paths that point to non-existent files - broken dependencies_\n`);
  for (const d of deadImports) {
    lines.push(`- MISSING: ${d.file}`);
    lines.push(`  imported by: ${d.importedBy.join(", ")}`);
  }

  if (checkpoint.errors.length > 0) {
    lines.push(`\n## SCAN ERRORS (${checkpoint.errors.length})`);
    for (const e of checkpoint.errors) lines.push(`- ${e}`);
  }

  lines.push(`\n## DEPENDENCY GRAPH SUMMARY`);
  lines.push(`\nTop files by import count (most depended-upon):`);
  const byImporters = Object.entries(graph)
    .filter(([, m]) => m.exists && m.importedBy.length > 0)
    .sort((a, b) => b[1].importedBy.length - a[1].importedBy.length)
    .slice(0, 15);
  for (const [f, m] of byImporters) {
    lines.push(`- ${f}: imported by ${m.importedBy.length} files`);
  }

  lines.push(`\nTop files by outgoing imports (most complex):`);
  const byImports = Object.entries(graph)
    .filter(([, m]) => m.exists && m.imports.length > 0)
    .sort((a, b) => b[1].imports.length - a[1].imports.length)
    .slice(0, 15);
  for (const [f, m] of byImports) {
    lines.push(`- ${f}: imports ${m.imports.length} files`);
  }

  return lines.join("\n");
}

async function main() {
  console.log("[audit-bot] Starting full scan...");
  mkdirSync(resolve(ROOT, ".data"), { recursive: true });

  // Phase 1: collect files
  checkpoint.phase = "collect";
  const files = collectFiles();
  checkpoint.totalFiles = files.length;
  console.log(`[audit-bot] Found ${files.length} .mjs files across ${SCAN_DIRS.length} directories`);
  saveCheckpoint();

  // Phase 2: build dependency graph
  checkpoint.phase = "graph";
  console.log("[audit-bot] Building dependency graph...");
  const graph = buildGraph(files);
  checkpoint.graph = graph;
  saveCheckpoint();

  // Phase 3: classify
  checkpoint.phase = "classify";
  const { active, orphans, deadImports } = classify(graph);
  checkpoint.activeFiles = active.map(f => f.file);
  checkpoint.orphans = orphans.map(f => f.file);
  checkpoint.deadImports = deadImports.map(d => d.file);
  saveCheckpoint();

  // Phase 4: report
  checkpoint.phase = "report";
  const report = generateReport(graph, active, orphans, deadImports);
  writeFileSync(REPORT_FILE, report);
  console.log(`[audit-bot] Report written to ${REPORT_FILE}`);

  // Final checkpoint
  checkpoint.phase = "done";
  checkpoint.completedAt = new Date().toISOString();
  saveCheckpoint();

  clearInterval(checkpointInterval);

  // Print summary to stdout
  console.log(`\n=== AUDIT SUMMARY ===`);
  console.log(`Active files:    ${active.length}`);
  console.log(`Orphan files:    ${orphans.length}`);
  console.log(`Dead imports:    ${deadImports.length}`);
  console.log(`Scan errors:     ${checkpoint.errors.length}`);
  console.log(`Report:          ${REPORT_FILE}`);
  console.log(`Checkpoint:      ${CHECKPOINT_FILE}`);

  if (orphans.length > 0) {
    console.log(`\nTop orphans (newest first):`);
    orphans.slice(0, 10).forEach(f => console.log(`  ${f.file}`));
  }
  if (deadImports.length > 0) {
    console.log(`\nDead imports:`);
    deadImports.forEach(d => console.log(`  MISSING: ${d.file}`));
  }
}

main().catch(err => {
  console.error("[audit-bot] Fatal:", err);
  checkpoint.errors.push(`fatal: ${err.message}`);
  checkpoint.phase = "crashed";
  saveCheckpoint();
  clearInterval(checkpointInterval);
  process.exit(1);
});
