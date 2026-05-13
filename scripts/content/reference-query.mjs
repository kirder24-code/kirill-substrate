/**
 * scripts/content/reference-query.mjs
 *
 * Filters and ranks references-seed.json entries for a given brief.
 * Used by visual-orchestrator.mjs to inject a curated reference set
 * into the userMsg when visual-researcher is on the panel.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const REF_PATH = resolve(ROOT, ".data/content/references-seed.json");

export function loadReferences() {
  if (!existsSync(REF_PATH)) return { references: [], schema_version: 0 };
  return JSON.parse(readFileSync(REF_PATH, "utf8"));
}

export function findReferencesForBrief({ goal, asset_level = "static", limit = 6 } = {}) {
  const lib = loadReferences();
  const candidates = (lib.references || []).filter(r => {
    if (asset_level && Array.isArray(r.asset_level) && r.asset_level.length > 0 && !r.asset_level.includes(asset_level)) return false;
    if (goal && Array.isArray(r.goal_fit) && r.goal_fit.length > 0 && !r.goal_fit.includes(goal)) return false;
    if (r.brand_fit === "low") return false;  // exclude low-fit by default
    return true;
  });

  const ranked = candidates.map(r => {
    let score = 50;
    if (r.brand_fit === "high") score += 25;
    else if (r.brand_fit === "medium") score += 10;
    if (r.freshness === "current") score += 10;
    else if (r.freshness === "timeless") score += 15;
    else if (r.freshness === "dated") score -= 20;
    if (r.technical_difficulty === "low") score += 5;
    else if (r.technical_difficulty === "high") score -= 5;
    return { ...r, _score: score };
  }).sort((a, b) => b._score - a._score).slice(0, limit);

  return {
    ok: true,
    brief: { goal, asset_level },
    matched_count: ranked.length,
    references: ranked,
  };
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = Object.fromEntries(process.argv.slice(2).map(a => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
  }));
  const r = findReferencesForBrief({
    goal: args.goal,
    asset_level: args.level || "static",
    limit: args.limit ? parseInt(args.limit) : 6,
  });
  console.log(JSON.stringify(r, null, 2));
}
