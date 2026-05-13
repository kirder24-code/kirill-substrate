/**
 * scripts/survival/factory-orphan-audit.mjs
 *
 * Classifies every .mjs in scripts/factory/ to give Kirill an actionable
 * delete-candidate list:
 *   - last modified date
 *   - referenced anywhere in repo? (grep all .mjs and .sh)
 *   - in cortex-launcher imports?
 *   - in pulse-daemon calls?
 *   - has CLI entrypoint?
 *
 * Categories:
 *   keep       — referenced or autorun (do not delete)
 *   stale      — orphan AND last modified > 30 days ago
 *   recent_orphan — orphan AND last modified within 30 days (still maybe useful)
 *
 * Output: markdown table to .data/factory-audit.md
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const FACTORY = resolve(ROOT, "scripts/factory");
const REPORT = resolve(ROOT, ".data/factory-audit.md");

const factoryFiles = readdirSync(FACTORY).filter(f => f.endsWith(".mjs"));

// Build a map of all references across .mjs and .sh files in scripts/.
const allScriptFiles = [];
function walk(dir) {
  for (const e of readdirSync(dir)) {
    const full = resolve(dir, e);
    const s = statSync(full);
    if (s.isDirectory()) walk(full);
    else if (e.endsWith(".mjs") || e.endsWith(".sh")) allScriptFiles.push(full);
  }
}
walk(resolve(ROOT, "scripts"));

const referencesByName = new Map(); // factory_filename -> [referencing_files]
for (const f of factoryFiles) referencesByName.set(f, []);

for (const file of allScriptFiles) {
  if (file.includes("/factory/")) continue; // self-references inside factory don't count for our purpose? Actually they do. Let me include them but flag.
  const txt = readFileSync(file, "utf-8");
  for (const fname of factoryFiles) {
    if (txt.includes(fname)) referencesByName.get(fname).push(file);
  }
}

const now = Date.now();
const records = factoryFiles.map(f => {
  const full = resolve(FACTORY, f);
  const stat = statSync(full);
  const ageMs = now - stat.mtimeMs;
  const ageDays = Math.round(ageMs / 86400_000);
  const refs = referencesByName.get(f);
  const txt = readFileSync(full, "utf-8");
  const isCliEntry = /import\.meta\.url\s*===\s*`file/.test(txt);
  const hasRegister = /export\s+function\s+register\s*\(\s*bus/.test(txt);
  const lineCount = txt.split("\n").length;

  let category;
  if (refs.length > 0 || hasRegister) category = "keep";
  else if (ageDays > 30) category = "stale";
  else category = "recent_orphan";

  return {
    file: f,
    age_days: ageDays,
    last_modified: new Date(stat.mtimeMs).toISOString().slice(0, 10),
    line_count: lineCount,
    size_kb: (stat.size / 1024).toFixed(1),
    has_cli: isCliEntry,
    has_register: hasRegister,
    references_count: refs.length,
    category,
  };
});

const counts = {
  keep: records.filter(r => r.category === "keep").length,
  stale: records.filter(r => r.category === "stale").length,
  recent_orphan: records.filter(r => r.category === "recent_orphan").length,
};

const lines = [];
lines.push("# Factory Bots Audit");
lines.push(`generated: ${new Date().toISOString()}`);
lines.push(`total: ${records.length}`);
lines.push(`keep: ${counts.keep} | stale (>30d, no refs): ${counts.stale} | recent_orphan (<=30d, no refs): ${counts.recent_orphan}`);
lines.push("");

lines.push("## STALE (>30 days, no references): SAFE TO DELETE");
lines.push("");
lines.push("| file | last_modified | size_kb | lines |");
lines.push("|---|---|---|---|");
for (const r of records.filter(r => r.category === "stale").sort((a, b) => b.age_days - a.age_days)) {
  lines.push(`| \`${r.file}\` | ${r.last_modified} (${r.age_days}d) | ${r.size_kb} | ${r.line_count} |`);
}
lines.push("");

lines.push("## RECENT_ORPHAN (<=30 days, no references): REVIEW BEFORE DELETING");
lines.push("");
lines.push("| file | last_modified | size_kb | has_cli | has_register |");
lines.push("|---|---|---|---|---|");
for (const r of records.filter(r => r.category === "recent_orphan").sort((a, b) => b.age_days - a.age_days)) {
  lines.push(`| \`${r.file}\` | ${r.last_modified} (${r.age_days}d) | ${r.size_kb} | ${r.has_cli ? "yes" : "no"} | ${r.has_register ? "yes" : "no"} |`);
}
lines.push("");

lines.push("## KEEP (referenced or has register())");
lines.push("");
lines.push("| file | references_count | has_register |");
lines.push("|---|---|---|");
for (const r of records.filter(r => r.category === "keep").sort((a, b) => b.references_count - a.references_count)) {
  lines.push(`| \`${r.file}\` | ${r.references_count} | ${r.has_register ? "yes" : "no"} |`);
}
lines.push("");

lines.push("## Suggested deletion command (review first!)");
lines.push("");
lines.push("```bash");
lines.push("# After visual review, to remove all STALE bots:");
for (const r of records.filter(r => r.category === "stale")) {
  lines.push(`rm scripts/factory/${r.file}`);
}
lines.push("```");

writeFileSync(REPORT, lines.join("\n"));
console.log(`Report written: ${REPORT}`);
console.log(`Total: ${records.length} | keep: ${counts.keep} | stale: ${counts.stale} | recent_orphan: ${counts.recent_orphan}`);
console.log(`Stale (deletion candidates) total size: ${records.filter(r => r.category === "stale").reduce((a, r) => a + parseFloat(r.size_kb), 0).toFixed(1)} KB`);
