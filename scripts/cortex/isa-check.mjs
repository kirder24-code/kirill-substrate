#!/usr/bin/env node
/**
 * scripts/cortex/isa-check.mjs
 *
 * Port of PAI ISA CheckCompleteness workflow.
 * Scores an ISA file against tier completeness, returns structured pass/fail
 * + gap report. Exits 0 on pass, 1 on hard fail.
 *
 * Usage:
 *   node scripts/cortex/isa-check.mjs <path/to/ISA.md> [--tier quick|project|comprehensive] [--strict]
 *   node scripts/cortex/isa-check.mjs --all   # check all ISA.md files in repo
 *
 * Programmatic:
 *   import { checkISA } from "./isa-check.mjs";
 *   const result = await checkISA("ISA.md", { tier: "project", strict: true });
 *   if (result.status !== "pass") throw new Error("ISA incomplete");
 *
 * Tier mapping (substrate → PAI):
 *   quick        ≈ E1   (Goal + Criteria only)
 *   project      ≈ E3   (8 sections: Problem, Vision, Out of Scope, Constraints,
 *                        Goal, Criteria, Features, Test Strategy)
 *   comprehensive ≈ E5  (all 12 sections + populated Decisions/Changelog)
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseFrontmatter, parseCriteriaList, extractCriteriaSection, findISAByGlob } from "./isa-parser.mjs";

const TIER_REQUIREMENTS = {
  quick: ["Goal", "ISC Criteria"],
  project: ["Problem", "Vision", "Out of Scope", "Constraints", "Goal", "ISC Criteria", "Features", "Test Strategy"],
  comprehensive: ["Problem", "Vision", "Out of Scope", "Principles", "Constraints", "Goal", "ISC Criteria", "Test Strategy", "Features", "Decisions", "Changelog", "Verification"],
};

const TIER_ISC_FLOOR = { quick: 1, project: 6, comprehensive: 12 };

function classifySection(content, sectionName) {
  // Section heading: ## SectionName  OR  ## ISC SectionName  (allow synonyms)
  const aliases = sectionName === "ISC Criteria" ? ["ISC Criteria", "Criteria", "IDEAL STATE CRITERIA"] : [sectionName];
  let body = null;
  let foundHeading = false;
  for (const alias of aliases) {
    const re = new RegExp(`^##\\s+${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "im");
    const m = re.exec(content);
    if (m) {
      foundHeading = true;
      const start = m.index + m[0].length;
      const rest = content.slice(start);
      const end = rest.match(/\n##\s+(?!#)|\n---\s*\n/);
      body = end ? rest.slice(0, end.index) : rest;
      break;
    }
  }
  if (!foundHeading) return "missing";

  const trimmed = body.replace(/<!--[\s\S]*?-->/g, "").trim();
  if (trimmed.length === 0) return "empty";

  // Count "substantive" indicators: sentences, bullets, or YAML blocks
  const sentences = trimmed.split(/[.!?]+(?:['")\]]+)?\s+/).filter(s => s.trim().length > 8).length;
  const bullets = (trimmed.match(/^\s*[-*]\s/gm) || []).length;
  const yamlBlocks = (trimmed.match(/```yaml/g) || []).length;
  const wordCount = trimmed.split(/\s+/).filter(w => w.length > 0).length;

  // Either structured (sentences + bullets + yaml ≥ 3) OR rich prose (≥ 40 words)
  const structuralScore = sentences + bullets + yamlBlocks * 3;
  if (structuralScore >= 3 || wordCount >= 40) return "present";
  if (structuralScore >= 1 || wordCount >= 12) return "thin";
  return "thin";
}

function auditISCs(content) {
  const isacs = parseCriteriaList(content);
  const total = isacs.length;
  const checked = isacs.filter(c => c.status === "completed").length;
  const antiCount = isacs.filter(c => c.type === "anti-criterion").length;

  // Granularity check: each ISC description should fit in one short sentence
  // (no compound "and ... and ..." or "with ..." chains making it un-probable)
  const granularityViolations = isacs.filter(c => {
    const desc = c.description;
    // 3+ "and"s OR description longer than 280 chars OR contains "AND ALSO"
    const ands = (desc.match(/\band\b/gi) || []).length;
    return ands >= 3 || desc.length > 280;
  }).map(c => ({ id: c.id, reason: "compound description (≥3 'and's or >280 chars)" }));

  // ID uniqueness
  const seen = new Set();
  const idDuplicates = [];
  for (const c of isacs) {
    if (seen.has(c.id)) idDuplicates.push(c.id);
    seen.add(c.id);
  }

  return {
    total,
    checked,
    pending: total - checked,
    anti_criteria_count: antiCount,
    granularity_violations: granularityViolations.length,
    granularity_offenders: granularityViolations.slice(0, 5),
    id_collisions: idDuplicates,
    has_anti: antiCount >= 1,
  };
}

/**
 * Verification gate: every CHECKED ISC must have a Verification entry.
 * This is the doctrine that fixes "claim done without proof".
 */
function checkVerificationCoverage(content) {
  const isacs = parseCriteriaList(content);
  const checkedIds = isacs.filter(c => c.status === "completed").map(c => c.id);
  if (checkedIds.length === 0) return { ok: true, missing: [] };

  // Look for Verification section
  const re = /^##\s+Verification\s*$/im;
  const m = re.exec(content);
  if (!m) return { ok: false, missing: checkedIds, reason: "no Verification section" };
  const start = m.index + m[0].length;
  const rest = content.slice(start);
  const end = rest.match(/\n##\s+(?!#)|\n---\s*\n/);
  const body = end ? rest.slice(0, end.index) : rest;

  const missing = checkedIds.filter(id => !body.includes(id));
  return { ok: missing.length === 0, missing };
}

export async function checkISA(isaPath, opts = {}) {
  const abs = resolve(isaPath);
  if (!existsSync(abs)) return { status: "fail", reason: "file_not_found", path: abs };

  const content = readFileSync(abs, "utf-8");
  const fm = parseFrontmatter(content);
  if (!fm) return { status: "fail", reason: "no_frontmatter", path: abs };

  // Tier resolution: explicit override → frontmatter `effort` → "project"
  const tier = opts.tier || fm.effort || "project";
  if (!TIER_REQUIREMENTS[tier]) {
    return { status: "fail", reason: "unknown_tier", tier, valid: Object.keys(TIER_REQUIREMENTS) };
  }

  const required = TIER_REQUIREMENTS[tier];
  const sectionStatus = {};
  const gaps = [];
  for (const sec of required) {
    const cls = classifySection(content, sec);
    sectionStatus[sec] = cls;
    if (cls === "missing") gaps.push({ section: sec, severity: "hard", reason: `required at ${tier}, missing entirely` });
    else if (cls === "thin") gaps.push({ section: sec, severity: "hard", reason: "thin — needs at least 3 substantive lines/bullets" });
    else if (cls === "empty" && sec !== "Verification") gaps.push({ section: sec, severity: "hard", reason: "header present, body whitespace-only" });
  }

  const isc = auditISCs(content);
  const floor = TIER_ISC_FLOOR[tier];
  if (isc.total < floor) gaps.push({ section: "ISC Criteria", severity: "soft", reason: `${isc.total} ISCs < ${tier} floor of ${floor}` });
  if (!isc.has_anti && tier !== "quick") gaps.push({ section: "ISC Criteria", severity: "hard", reason: "no anti-criterion (Anti: prefix)" });
  if (isc.granularity_violations > 0) gaps.push({ section: "ISC Criteria", severity: "hard", reason: `${isc.granularity_violations} ISCs fail granularity (compound or too long)`, offenders: isc.granularity_offenders });
  if (isc.id_collisions.length > 0) gaps.push({ section: "ISC Criteria", severity: "hard", reason: `ISC ID collisions: ${isc.id_collisions.join(", ")}` });

  // Verification gate — only enforced when phase is "verify" or "complete"
  const phase = (fm.phase || "").toLowerCase();
  let verification = { ok: true, missing: [] };
  if (phase === "verify" || phase === "complete") {
    verification = checkVerificationCoverage(content);
    if (!verification.ok) {
      gaps.push({
        section: "Verification",
        severity: "hard",
        reason: `phase=${phase} but ${verification.missing.length} checked ISCs lack Verification entries: ${verification.missing.slice(0, 5).join(", ")}${verification.missing.length > 5 ? "..." : ""}`,
      });
    }
  }

  const hardGaps = gaps.filter(g => g.severity === "hard");
  const status = (opts.strict !== false ? hardGaps.length === 0 : true) ? "pass" : "fail";

  return {
    status,
    path: abs,
    tier,
    phase,
    progress: `${isc.checked}/${isc.total}`,
    sections: sectionStatus,
    isc,
    verification,
    gaps,
    hard_gaps: hardGaps.length,
    soft_gaps: gaps.length - hardGaps.length,
  };
}

// CLI entry
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const args = process.argv.slice(2);
  let tier = null, strict = true, all = false, paths = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--tier") tier = args[++i];
    else if (args[i] === "--strict") strict = true;
    else if (args[i] === "--no-strict") strict = false;
    else if (args[i] === "--all") all = true;
    else paths.push(args[i]);
  }

  if (all) {
    const root = resolve(process.cwd());
    paths = findISAByGlob(root);
  }
  if (paths.length === 0) {
    console.error("Usage: node scripts/cortex/isa-check.mjs <ISA.md> [--tier quick|project|comprehensive] [--no-strict]");
    console.error("       node scripts/cortex/isa-check.mjs --all");
    process.exit(2);
  }

  let allPass = true;
  for (const p of paths) {
    const result = await checkISA(p, { tier, strict });
    const symbol = result.status === "pass" ? "✓" : "✗";
    console.log(`${symbol} [${result.tier || "?"}] ${result.path}`);
    if (result.status !== "pass") allPass = false;
    if (result.reason) console.log(`    reason: ${result.reason}`);
    if (result.progress) console.log(`    progress: ${result.progress}    phase: ${result.phase}    ISCs: ${result.isc.total} (anti: ${result.isc.anti_criteria_count})`);
    if (result.gaps && result.gaps.length > 0) {
      const hard = result.gaps.filter(g => g.severity === "hard");
      const soft = result.gaps.filter(g => g.severity === "soft");
      if (hard.length > 0) {
        console.log(`    HARD GAPS (${hard.length}):`);
        for (const g of hard) console.log(`      - ${g.section}: ${g.reason}`);
      }
      if (soft.length > 0) {
        console.log(`    soft gaps (${soft.length}):`);
        for (const g of soft) console.log(`      - ${g.section}: ${g.reason}`);
      }
    }
  }
  process.exit(allPass ? 0 : 1);
}
