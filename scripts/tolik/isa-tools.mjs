/**
 * scripts/tolik/isa-tools.mjs
 *
 * ISA-aware tools for Tolik. Lets him answer "что у нас по AU opportunity"
 * by reading the opportunity's ISA.md, reporting checked/total ISCs,
 * recent verifications, and gaps from isa-check.
 *
 * Public actions (registered in browser-agent ACTIONS):
 *   list_isas()              — all ISA.md files in repo with progress
 *   read_isa({path})         — full read of one ISA: fm, criteria, gaps
 *   isa_status({slug})       — by slug match: progress + verification + next ISC
 *   isa_run_check({path})    — run isa-check, return pass/fail + gaps
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseFrontmatter,
  parseCriteriaList,
  countCriteria,
  diagnoseCriteria,
  findISAByGlob,
} from "../cortex/isa-parser.mjs";
import { checkISA } from "../cortex/isa-check.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");

export async function list_isas() {
  const paths = findISAByGlob(ROOT);
  const out = [];
  for (const p of paths) {
    try {
      const c = readFileSync(p, "utf-8");
      const fm = parseFrontmatter(c) || {};
      const counts = countCriteria(c);
      out.push({
        path: p.replace(ROOT + "/", ""),
        slug: fm.slug || "?",
        task: fm.task || "?",
        effort: fm.effort || "?",
        phase: fm.phase || "?",
        progress: `${counts.checked}/${counts.total}`,
        progress_pct: counts.total ? Math.round(counts.checked / counts.total * 100) : 0,
      });
    } catch (e) {
      out.push({ path: p, error: e.message });
    }
  }
  return { ok: true, count: out.length, isas: out };
}

export async function read_isa({ path }) {
  if (!path) return { ok: false, reason: "no_path" };
  const abs = path.startsWith("/") ? path : resolve(ROOT, path);
  if (!existsSync(abs)) return { ok: false, reason: "not_found", path: abs };
  try {
    const content = readFileSync(abs, "utf-8");
    const fm = parseFrontmatter(content) || {};
    const criteria = parseCriteriaList(content);
    const counts = countCriteria(content);
    const warning = diagnoseCriteria(content);

    // Pull section bodies for the high-value sections
    const grabSection = (name) => {
      const re = new RegExp(`^##\\s+${name}\\s*$`, "im");
      const m = re.exec(content);
      if (!m) return null;
      const start = m.index + m[0].length;
      const rest = content.slice(start);
      const end = rest.match(/\n##\s+(?!#)|\n---\s*\n/);
      return (end ? rest.slice(0, end.index) : rest).trim();
    };

    return {
      ok: true,
      path: abs.replace(ROOT + "/", ""),
      fm,
      progress: `${counts.checked}/${counts.total}`,
      criteria_summary: criteria.map(c => ({
        id: c.id,
        status: c.status,
        type: c.type,
        description: c.description.slice(0, 200),
      })),
      problem: grabSection("Problem")?.slice(0, 600),
      goal: grabSection("Goal")?.slice(0, 600),
      verification: grabSection("Verification")?.slice(0, 800),
      warning,
    };
  } catch (e) {
    return { ok: false, reason: "read_failed", error: e.message };
  }
}

export async function isa_status({ slug }) {
  // Find ISA whose frontmatter slug or filename slug matches
  const all = (await list_isas()).isas;
  if (!slug) {
    return { ok: false, reason: "no_slug", available: all.map(i => i.slug || i.path) };
  }
  const lower = slug.toLowerCase();
  const match = all.find(i =>
    (i.slug || "").toLowerCase().includes(lower) ||
    (i.path || "").toLowerCase().includes(lower) ||
    (i.task || "").toLowerCase().includes(lower)
  );
  if (!match) {
    return { ok: false, reason: "no_match", query: slug, available: all.map(i => i.slug) };
  }
  const full = await read_isa({ path: match.path });
  if (!full.ok) return full;
  // Find next pending ISC
  const next = full.criteria_summary.find(c => c.status === "pending" && c.type === "criterion");
  return {
    ok: true,
    slug: match.slug,
    path: match.path,
    task: match.task,
    progress: full.progress,
    progress_pct: match.progress_pct,
    phase: match.phase,
    next_isc: next ? { id: next.id, description: next.description.slice(0, 200) } : null,
    pending_count: full.criteria_summary.filter(c => c.status === "pending").length,
    completed_count: full.criteria_summary.filter(c => c.status === "completed").length,
    has_verification: !!(full.verification && full.verification.length > 5),
  };
}

export async function isa_run_check({ path }) {
  if (!path) return { ok: false, reason: "no_path" };
  const abs = path.startsWith("/") ? path : resolve(ROOT, path);
  try {
    const result = await checkISA(abs, { strict: true });
    return {
      ok: true,
      check_status: result.status,
      tier: result.tier,
      progress: result.progress,
      hard_gaps_count: result.hard_gaps,
      soft_gaps_count: result.soft_gaps,
      gaps: (result.gaps || []).map(g => ({
        section: g.section,
        severity: g.severity,
        reason: g.reason?.slice(0, 200),
      })),
    };
  } catch (e) {
    return { ok: false, reason: "check_threw", error: e.message };
  }
}
