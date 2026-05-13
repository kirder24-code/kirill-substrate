/**
 * Memory linter - read-only health check on Claude memory files.
 *
 * What it checks:
 *   1. Stale absolute dates (>30 days old, mentioned in body)
 *   2. Relative date phrases that go stale ("yesterday", "this week", "tomorrow")
 *   3. Broken file/path references (paths to files that no longer exist)
 *   4. Duplicate `name:` frontmatter fields across files
 *   5. Topic overlap candidates (same keyword cluster - manual review)
 *   6. Old file mtime (>60 days, hint that content may be stale)
 *   7. Missing or broken frontmatter (no name/description/type)
 *   8. Files in MEMORY.md index but missing on disk (and vice versa)
 *
 * What it does NOT do:
 *   - No auto-fix. Reports only.
 *   - No LLM calls. Pure regex / file checks.
 *   - No cron. Triggered manually: `node scripts/factory/memory-lint.mjs`
 *
 * Output:
 *   - Console summary
 *   - Full report to sandbox-review/memory-lint-<date>.md
 *
 * Approved as small low-risk infra exception (Karpathy linting idea, scaled down).
 */

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { resolve, join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");
const MEMORY_DIR = "$HOME/.claude/projects/-Users-kirder-Desktop-linkedin-brand-os/memory";
const REPORT_DIR = resolve(PROJECT_ROOT, "sandbox-review");

if (!existsSync(MEMORY_DIR)) {
  console.error(`Memory dir not found: ${MEMORY_DIR}`);
  process.exit(1);
}

const NOW = Date.now();
const DAY = 86400000;
const STALE_DAYS = 30;
const VERY_STALE_DAYS = 60;

// ─── Load all memory files ──────────────────────────────────────────────────

const files = readdirSync(MEMORY_DIR).filter(f => f.endsWith(".md") && f !== "MEMORY.md");
const memories = [];

for (const fname of files) {
  const path = join(MEMORY_DIR, fname);
  const stat = statSync(path);
  const content = readFileSync(path, "utf-8");

  // Parse frontmatter
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  let frontmatter = {};
  let body = content;
  if (fmMatch) {
    body = fmMatch[2];
    for (const line of fmMatch[1].split("\n")) {
      const m = line.match(/^([a-z_]+):\s*(.+)$/);
      if (m) frontmatter[m[1]] = m[2].trim();
    }
  }

  memories.push({
    fname,
    path,
    mtime: stat.mtime.getTime(),
    age_days: Math.floor((NOW - stat.mtime.getTime()) / DAY),
    content,
    body,
    frontmatter,
  });
}

// Load MEMORY.md index
let indexFiles = [];
const memoryIndexPath = join(MEMORY_DIR, "MEMORY.md");
if (existsSync(memoryIndexPath)) {
  const indexContent = readFileSync(memoryIndexPath, "utf-8");
  const linkMatches = indexContent.matchAll(/\(([^)]+\.md)\)/g);
  for (const m of linkMatches) indexFiles.push(m[1]);
}

// ─── Checks ─────────────────────────────────────────────────────────────────

const issues = {
  missing_frontmatter: [],
  missing_provenance: [],
  duplicate_names: [],
  broken_refs: [],
  stale_absolute_dates: [],
  relative_date_phrases: [],
  very_old_files: [],
  index_missing_file: [],
  file_missing_index: [],
  topic_overlap: [],
};

// Check 1: missing frontmatter fields
for (const m of memories) {
  const missing = [];
  for (const field of ["name", "description", "type"]) {
    if (!m.frontmatter[field]) missing.push(field);
  }
  if (missing.length > 0) {
    issues.missing_frontmatter.push({ file: m.fname, missing });
  }
}

// Check 1b: provenance field (forward-going only - files newer than April 6 2026)
// Convention: every new memory rule must have either auto_proposed_from or manual_session
// to track WHERE the rule came from. Older files are grandfathered.
const PROVENANCE_REQUIRED_AFTER = new Date("2026-04-06T22:00:00Z").getTime();
for (const m of memories) {
  if (m.mtime < PROVENANCE_REQUIRED_AFTER) continue; // grandfathered
  const hasAuto = "auto_proposed_from" in m.frontmatter;
  const hasManual = "manual_session" in m.frontmatter;
  if (!hasAuto && !hasManual) {
    issues.missing_provenance.push({ file: m.fname, age_days: m.age_days });
  }
}

// Check 2: duplicate name fields
const namesSeen = {};
for (const m of memories) {
  const name = m.frontmatter.name;
  if (!name) continue;
  if (namesSeen[name]) {
    issues.duplicate_names.push({ name, files: [namesSeen[name], m.fname] });
  } else {
    namesSeen[name] = m.fname;
  }
}

// Check 3: broken file references
// Look for paths like scripts/.../foo.mjs or .data/foo or sandbox-review/...
const PATH_RX = /(?:^|\s|`|\()((?:scripts|\.data|apps|sandbox-review|packages|services)\/[\w\-./]+\.[a-z]{1,5})/g;
for (const m of memories) {
  const found = new Set();
  let match;
  while ((match = PATH_RX.exec(m.body)) !== null) {
    found.add(match[1]);
  }
  for (const ref of found) {
    const fullPath = resolve(PROJECT_ROOT, ref);
    if (!existsSync(fullPath)) {
      issues.broken_refs.push({ file: m.fname, ref });
    }
  }
}

// Check 4: stale absolute dates (Apr 6 2026, March 15 2026, 2026-03-15, etc)
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const DATE_PATTERNS = [
  /(\d{4})-(\d{2})-(\d{2})/g,                                    // 2026-04-06
  new RegExp(`\\b(${MONTH_NAMES.join("|")})\\s+(\\d{1,2})(?:[,]?\\s+(\\d{4}))?`, "gi"), // April 6 2026
];
function parseDate(s) {
  const t = Date.parse(s);
  return isNaN(t) ? null : t;
}
for (const m of memories) {
  const found = new Set();
  for (const rx of DATE_PATTERNS) {
    let match;
    while ((match = rx.exec(m.body)) !== null) {
      const ts = parseDate(match[0]);
      if (ts && (NOW - ts) > STALE_DAYS * DAY) {
        found.add(`${match[0]} (${Math.floor((NOW - ts) / DAY)} days ago)`);
      }
    }
  }
  for (const d of found) {
    issues.stale_absolute_dates.push({ file: m.fname, date: d });
  }
}

// Check 5: relative date phrases (these go stale silently)
const RELATIVE_PHRASES = [
  /\byesterday\b/i,
  /\btomorrow\b/i,
  /\bthis week\b/i,
  /\bnext week\b/i,
  /\bthis month\b/i,
  /\bnext month\b/i,
  /\b(today|tonight)\b/i,
  /\blast week\b/i,
];
for (const m of memories) {
  // Skip if file itself is recent (mtime < 7 days) - relative phrases are still valid
  if (m.age_days < 7) continue;
  const hits = [];
  for (const rx of RELATIVE_PHRASES) {
    if (rx.test(m.body)) hits.push(m.body.match(rx)[0]);
  }
  if (hits.length > 0) {
    issues.relative_date_phrases.push({ file: m.fname, age_days: m.age_days, phrases: hits });
  }
}

// Check 6: very old files (mtime > 60 days)
for (const m of memories) {
  if (m.age_days > VERY_STALE_DAYS) {
    issues.very_old_files.push({ file: m.fname, age_days: m.age_days });
  }
}

// Check 7: index <-> files mismatch
const fileSet = new Set(files);
const indexSet = new Set(indexFiles);
for (const f of indexFiles) {
  if (!fileSet.has(f)) issues.index_missing_file.push(f);
}
for (const f of files) {
  if (!indexSet.has(f)) issues.file_missing_index.push(f);
}

// Check 8: topic overlap (heuristic - shared significant keywords in name/description)
const STOP = new Set(["the","a","an","is","are","of","to","for","with","and","or","not","in","on","at","by","be","do","does","this","that","my","my","your","kirill","claude","memory","rule","feedback"]);
function tokens(s) {
  return (s || "").toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 3 && !STOP.has(t));
}
const docTokens = memories.map(m => ({
  fname: m.fname,
  tokens: new Set([...tokens(m.frontmatter.name || ""), ...tokens(m.frontmatter.description || "")]),
}));
for (let i = 0; i < docTokens.length; i++) {
  for (let j = i+1; j < docTokens.length; j++) {
    const a = docTokens[i].tokens;
    const b = docTokens[j].tokens;
    const shared = [...a].filter(t => b.has(t));
    if (shared.length >= 3) {
      issues.topic_overlap.push({
        files: [docTokens[i].fname, docTokens[j].fname],
        shared,
      });
    }
  }
}

// ─── Build report ───────────────────────────────────────────────────────────

const totalIssues = Object.values(issues).reduce((s, arr) => s + arr.length, 0);

let report = `# Memory Lint Report\n\n`;
report += `**Date:** ${new Date().toISOString().slice(0,10)}\n`;
report += `**Files scanned:** ${memories.length} (+ MEMORY.md index)\n`;
report += `**Total issues:** ${totalIssues}\n\n`;
report += `**This is a read-only report. No auto-fix. Review and decide what to act on.**\n\n`;

function section(title, items, formatter) {
  if (items.length === 0) return "";
  let s = `## ${title} (${items.length})\n\n`;
  for (const item of items) s += formatter(item);
  s += "\n";
  return s;
}

report += section("🔴 Missing frontmatter fields", issues.missing_frontmatter,
  i => `- **${i.file}** — missing: ${i.missing.join(", ")}\n`);

report += section("🔴 Missing provenance (new files only)", issues.missing_provenance,
  i => `- **${i.file}** (${i.age_days}d old) — needs auto_proposed_from or manual_session in frontmatter\n`);

report += section("🔴 Duplicate name fields", issues.duplicate_names,
  i => `- **${i.name}** appears in: ${i.files.join(" and ")}\n`);

report += section("🔴 Broken file references", issues.broken_refs,
  i => `- **${i.file}** references **${i.ref}** which does not exist\n`);

report += section("🟡 Stale absolute dates", issues.stale_absolute_dates,
  i => `- **${i.file}** mentions ${i.date}\n`);

report += section("🟡 Relative date phrases (file >7 days old)", issues.relative_date_phrases,
  i => `- **${i.file}** (${i.age_days}d old) contains: ${i.phrases.join(", ")}\n`);

report += section("🟡 Files older than 60 days", issues.very_old_files,
  i => `- **${i.file}** (${i.age_days}d old)\n`);

report += section("🟡 Files not in MEMORY.md index", issues.file_missing_index,
  i => `- ${i}\n`);

report += section("🟡 MEMORY.md references missing files", issues.index_missing_file,
  i => `- ${i}\n`);

report += section("🔵 Topic overlap candidates (manual review for duplication)", issues.topic_overlap,
  i => `- ${i.files[0]} ↔ ${i.files[1]} — shared: ${i.shared.join(", ")}\n`);

if (totalIssues === 0) {
  report += `## ✅ No issues found\n\nMemory is clean.\n`;
}

// ─── Write report + console summary ─────────────────────────────────────────

if (!existsSync(REPORT_DIR)) mkdirSync(REPORT_DIR, { recursive: true });
const reportPath = join(REPORT_DIR, `memory-lint-${new Date().toISOString().slice(0,10)}.md`);
writeFileSync(reportPath, report);

console.log(`\n═══════════════════════════════════════════════════════════`);
console.log(`MEMORY LINT - ${memories.length} files scanned`);
console.log(`═══════════════════════════════════════════════════════════`);
const colors = { red: "🔴", yellow: "🟡", blue: "🔵" };
console.log(`${colors.red} Missing frontmatter:        ${issues.missing_frontmatter.length}`);
console.log(`${colors.red} Missing provenance (new):   ${issues.missing_provenance.length}`);
console.log(`${colors.red} Duplicate names:            ${issues.duplicate_names.length}`);
console.log(`${colors.red} Broken file refs:           ${issues.broken_refs.length}`);
console.log(`${colors.yellow} Stale absolute dates:      ${issues.stale_absolute_dates.length}`);
console.log(`${colors.yellow} Relative date phrases:     ${issues.relative_date_phrases.length}`);
console.log(`${colors.yellow} Files >60 days old:        ${issues.very_old_files.length}`);
console.log(`${colors.yellow} File not in index:         ${issues.file_missing_index.length}`);
console.log(`${colors.yellow} Index ref missing:         ${issues.index_missing_file.length}`);
console.log(`${colors.blue} Topic overlap candidates:  ${issues.topic_overlap.length}`);
console.log(`───────────────────────────────────────────────────────────`);
console.log(`Total: ${totalIssues}`);
console.log(`Full report: ${reportPath}`);
console.log(`═══════════════════════════════════════════════════════════\n`);
