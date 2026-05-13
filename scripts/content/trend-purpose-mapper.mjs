/**
 * scripts/content/trend-purpose-mapper.mjs
 *
 * Maps brief intent → relevant active trends from trend-memory.json.
 *
 * Brief intent = { goal, asset_level, post_type }
 *   goal: attention | clarity | trust | premium | conversion | provocation
 *   asset_level: static | motion | scroll
 *   post_type: news | sales | educational | provocation | carousel | case_study | general
 *
 * Output: filtered, ranked list of trends suitable for THIS brief.
 * Used by visual-creative-director to choose at most ONE trend per asset.
 *
 * Public API:
 *   loadTrendMemory()                                 → full JSON
 *   findTrendsForBrief({ goal, asset_level, post_type })  → ranked active trends
 *   getDeadOrAvoidTrends()                            → for "must_avoid" lists
 *
 * CLI:
 *   node scripts/content/trend-purpose-mapper.mjs --goal=premium --level=scroll
 *   node scripts/content/trend-purpose-mapper.mjs --avoid
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const TREND_MEMORY_PATH = resolve(ROOT, ".data/content/trend-memory.json");

export function loadTrendMemory() {
  if (!existsSync(TREND_MEMORY_PATH)) return { trends: [], schema_version: 0 };
  return JSON.parse(readFileSync(TREND_MEMORY_PATH, "utf8"));
}

export function findTrendsForBrief({ goal, asset_level = "static", post_type = "general", min_confidence = 0.7, limit = 5 } = {}) {
  const mem = loadTrendMemory();
  const candidates = (mem.trends || []).filter(t => {
    if (t.status !== "active" && t.status !== "watching") return false;
    if (t.confidence != null && t.confidence < min_confidence) return false;
    if (asset_level && Array.isArray(t.asset_level) && t.asset_level.length > 0 && !t.asset_level.includes(asset_level)) return false;
    if (goal && Array.isArray(t.purpose_fit) && t.purpose_fit.length > 0 && !t.purpose_fit.includes(goal)) return false;
    return true;
  });

  const ranked = candidates.map(t => {
    let score = (t.confidence || 0.5) * 100;
    if (t.saturation === "low" || t.saturation === "low-for-b2b") score += 15;
    else if (t.saturation === "medium") score += 5;
    else if (t.saturation === "high") score -= 5;
    else if (t.saturation === "very-high" || t.saturation === "extreme") score -= 30;
    if (t.status === "watching") score -= 10;
    if (t.freshness === "timeless") score += 10;
    if (t.freshness === "dated") score -= 15;
    return { ...t, _score: score };
  }).sort((a, b) => b._score - a._score).slice(0, limit);

  return {
    ok: true,
    brief: { goal, asset_level, post_type },
    matched_count: ranked.length,
    trends: ranked,
    primary: ranked[0] || null,
  };
}

export function getDeadOrAvoidTrends() {
  const mem = loadTrendMemory();
  return (mem.trends || []).filter(t => t.status === "dead" || t.status === "avoid")
    .map(t => ({ slug: t.slug, trend: t.trend, avoid: t.avoid, status: t.status }));
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = Object.fromEntries(process.argv.slice(2).map(a => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true];
  }));
  if (args.avoid) {
    console.log(JSON.stringify(getDeadOrAvoidTrends(), null, 2));
    process.exit(0);
  }
  const r = findTrendsForBrief({
    goal: args.goal,
    asset_level: args.level || "static",
    post_type: args["post-type"] || "general",
    min_confidence: args["min-conf"] ? parseFloat(args["min-conf"]) : 0.7,
  });
  console.log(JSON.stringify(r, null, 2));
}
