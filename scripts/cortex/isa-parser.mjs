/**
 * scripts/cortex/isa-parser.mjs
 *
 * Port of PAI hooks/lib/isa-utils.ts (the parts we need).
 * Reads + parses Ideal State Artifact files (.md with YAML frontmatter and
 * a `## ISC Criteria` section of `- [ ] ISC-N: description` lines).
 *
 * Public API:
 *   parseFrontmatter(content)        → { task, slug, effort, phase, progress, ... } | null
 *   extractCriteriaSection(content)  → string | null  (body of the criteria section)
 *   parseCriteriaList(content)       → CriterionEntry[]
 *   countCriteria(content)           → { checked, total }
 *   diagnoseCriteria(content)        → 'missing-section' | 'empty-section' | 'all-dropped' | null
 *   writeFrontmatterField(content, field, value) → string  (rewrites one frontmatter field)
 *   findISAByGlob(rootDir)           → string[]  (absolute paths of all ISA.md files)
 *   readISA(absPath)                 → { fm, content, criteria, count, warning }
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

export const ARTIFACT_FILENAME = "ISA.md";

// Match every historical heading variant: "## Criteria", "## ISC Criteria",
// "## IDEAL STATE CRITERIA", or "### Criteria" sub-heading. Case-insensitive.
export const CRITERIA_HEADING_RE =
  /^(?:##\s+(?:ISC\s+)?Criteria\b[^\n]*|##\s+IDEAL\s+STATE\s+CRITERIA\b[^\n]*|###\s+Criteria\b[^\n]*)$/im;

export const CANONICAL_CRITERIA_HEADING = "## ISC Criteria";

export function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const fm = {};
  for (const line of match[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) {
      const k = line.slice(0, idx).trim();
      const v = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
      fm[k] = v;
    }
  }
  return fm;
}

export function writeFrontmatterField(content, field, value) {
  const fmMatch = content.match(/^(---\n)([\s\S]*?)(\n---)/);
  if (!fmMatch) return content;
  const lines = fmMatch[2].split("\n");
  let found = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(`${field}:`)) {
      lines[i] = `${field}: ${value}`;
      found = true;
      break;
    }
  }
  if (!found) lines.push(`${field}: ${value}`);
  return fmMatch[1] + lines.join("\n") + fmMatch[3] + content.slice(fmMatch[0].length);
}

export function extractCriteriaSection(content) {
  const m = CRITERIA_HEADING_RE.exec(content);
  if (!m || m.index === undefined) return null;
  const startOfBody = m.index + m[0].length;
  const rest = content.slice(startOfBody);
  // End at next H2 (## but not ###), YAML doc terminator, or EOF.
  const endMatch = rest.match(/\n##\s+(?!#)|\n---\s*\n/);
  return endMatch ? rest.slice(0, endMatch.index) : rest;
}

export function countCriteria(content) {
  const body = extractCriteriaSection(content);
  if (body === null) return { checked: 0, total: 0 };
  const lines = body.split("\n").filter(l => l.match(/^- \[[ x]\]/));
  const checked = lines.filter(l => l.startsWith("- [x]")).length;
  return { checked, total: lines.length };
}

export function parseCriteriaList(content) {
  const body = extractCriteriaSection(content);
  if (body === null) return [];
  return body.split("\n")
    .filter(l => l.match(/^- \[[ x]\]/))
    .map((line) => {
      const checked = line.startsWith("- [x]");
      // Primary parse: "- [x] ISC-N: description"
      let m = line.match(/^- \[[ x]\]\s*(ISC-[\w-]+):\s*(.*)/);
      if (!m) {
        // Loose fallback: no colon — "- [x] ISC-N description"
        const loose = line.match(/^- \[[ x]\]\s*(ISC-[\w-]+)\s+(.*)/);
        if (loose && loose[2].trim().length > 0) {
          m = [line, loose[1], loose[2]];
        }
      }
      if (!m) return null;
      const id = m[1];
      const description = m[2].trim();
      const isAnti = /^Anti:\s/i.test(description) || id.includes("-A-");
      return {
        id,
        description,
        type: isAnti ? "anti-criterion" : "criterion",
        status: checked ? "completed" : "pending",
      };
    })
    .filter(c => c !== null);
}

export function diagnoseCriteria(content) {
  const body = extractCriteriaSection(content);
  if (body === null) return "missing-section";
  const checkboxLines = body.split("\n").filter(l => l.match(/^- \[[ x]\]/));
  if (checkboxLines.length === 0) return "empty-section";
  const parsed = parseCriteriaList(content);
  if (parsed.length === 0) return "all-dropped";
  return null;
}

export function findISAByGlob(rootDir) {
  const found = [];
  function walk(dir, depth = 0) {
    if (depth > 6) return;
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries) {
      if (name.startsWith(".") && name !== ".data") continue;
      if (name === "node_modules" || name === "dist") continue;
      const full = join(dir, name);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) walk(full, depth + 1);
      else if (name === ARTIFACT_FILENAME) found.push(full);
    }
  }
  walk(rootDir);
  return found;
}

export function readISA(absPath) {
  const content = readFileSync(absPath, "utf-8");
  return {
    path: absPath,
    fm: parseFrontmatter(content) || {},
    content,
    criteria: parseCriteriaList(content),
    count: countCriteria(content),
    warning: diagnoseCriteria(content),
  };
}
