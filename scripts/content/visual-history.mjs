/**
 * scripts/content/visual-history.mjs
 *
 * Anti-repeat layer. Before rendering a new visual, checks recent history
 * and forces variety: no same template 3 times in a row, rotate accent
 * colors, avoid same layout variant for 5+ consecutive posts.
 *
 * Public API:
 *   pickAccent({ channel })       → next accent (rotates through cyan/gold/red/green/amber)
 *   pickLayout({ channel })       → top|center|bottom (rotates)
 *   enforceTemplateVariety({ proposed_template, channel })
 *     → { ok, reason, alternative_suggestion }
 *
 * Reads from content-store.getStyleHistory().
 */

import { getStyleHistory } from "./content-store.mjs";

const ACCENTS = ["cyan", "gold", "red", "green", "amber"];
const LAYOUTS = ["top", "center", "bottom"];

function recent(channel) {
  try { return getStyleHistory({ days: 14, channel }); } catch { return []; }
}

export function pickAccent({ channel = null } = {}) {
  const hist = recent(channel);
  const last3 = hist.slice(0, 3).map(r => r.accent_color).filter(Boolean);
  // Pick first accent not in last 3
  for (const a of ACCENTS) {
    if (!last3.includes(a)) return a;
  }
  // All 3 most recent are different accents — just pick the one used longest ago
  const counts = Object.fromEntries(ACCENTS.map(a => [a, 0]));
  for (const r of hist.slice(0, 10)) {
    if (r.accent_color && counts[r.accent_color] !== undefined) counts[r.accent_color]++;
  }
  return Object.entries(counts).sort((a, b) => a[1] - b[1])[0][0];
}

export function pickLayout({ channel = null } = {}) {
  const hist = recent(channel);
  const last2 = hist.slice(0, 2).map(r => r.layout_variant).filter(Boolean);
  for (const l of LAYOUTS) {
    if (!last2.includes(l)) return l;
  }
  return LAYOUTS[Math.floor(Math.random() * LAYOUTS.length)];
}

/**
 * Enforce template variety. Returns:
 *   { ok: true }                                          — proposed is fine
 *   { ok: false, reason, alternative_suggestion }         — too similar to history
 */
export function enforceTemplateVariety({ proposed_template, channel = null }) {
  if (!proposed_template) return { ok: true };
  const hist = recent(channel);
  const last2 = hist.slice(0, 2).map(r => r.template_type);

  // If proposed template was used in 2 of last 2 posts → reject
  if (last2.length === 2 && last2[0] === proposed_template && last2[1] === proposed_template) {
    // Suggest something different
    const counts = {};
    for (const r of hist.slice(0, 30)) {
      counts[r.template_type] = (counts[r.template_type] || 0) + 1;
    }
    // Pick the type used LEAST recently
    const allTypes = ["idea-card", "carousel-slide", "news-card", "stat-hero", "quote-card", "before-after", "system-diagram", "proof-frame"];
    const ranked = allTypes
      .filter(t => t !== proposed_template)
      .map(t => ({ t, c: counts[t] || 0 }))
      .sort((a, b) => a.c - b.c);
    return {
      ok: false,
      reason: `template '${proposed_template}' used in 2 of last 2 posts on channel='${channel || "any"}'`,
      alternative_suggestion: ranked[0]?.t,
      history_counts: counts,
    };
  }
  return { ok: true };
}

/**
 * Build a "style context block" for synthesizer to include in its prompt
 * so the LLM specialists understand current rotation state.
 */
export function getStyleContextBlock({ channel = null } = {}) {
  const hist = recent(channel);
  if (hist.length === 0) return "No recent posts in history — first-asset mode, full creative freedom.";
  const lines = [`Last ${Math.min(hist.length, 10)} assets:`];
  for (const r of hist.slice(0, 10)) {
    lines.push(`  ${r.created_at?.slice(0, 16) || "?"} [${r.template_type || "?"}/${r.accent_color || "?"}/${r.layout_variant || "?"}]`);
  }
  return lines.join("\n");
}

// ─── Template selection by post_type + history ──────────────────────────
//
// Each post_type has a primary template (best fit) and alternates. pickFreshTemplate
// picks the primary IF it's not in the last 2; otherwise highest-affinity alternate
// that's not in the last 2.

const TEMPLATE_AFFINITY = {
  news:        ["news-card", "stat-hero", "proof-frame"],
  sales:       ["stat-hero", "before-after", "proof-frame", "idea-card"],
  educational: ["idea-card", "system-diagram", "before-after", "carousel-slide"],
  provocation: ["quote-card", "proof-frame", "stat-hero"],
  carousel:    ["carousel-slide", "idea-card"],
  case_study:  ["proof-frame", "before-after", "system-diagram", "stat-hero"],
  general:     ["idea-card", "stat-hero", "quote-card", "system-diagram", "before-after", "proof-frame"],
};

export function pickFreshTemplate({ post_type = "general", channel = null, avoid = [] } = {}) {
  const hist = recent(channel);
  const last2 = hist.slice(0, 2).map(r => r.template_type).filter(Boolean);
  const forbidden = new Set([...last2, ...avoid]);

  const affinity = TEMPLATE_AFFINITY[post_type] || TEMPLATE_AFFINITY.general;
  for (const t of affinity) {
    if (!forbidden.has(t)) return { template: t, reason: `affinity[${post_type}] + not in last 2` };
  }
  const ALL = ["idea-card", "stat-hero", "quote-card", "system-diagram", "before-after", "proof-frame", "news-card", "carousel-slide"];
  for (const t of ALL) {
    if (!forbidden.has(t)) return { template: t, reason: "fallback: any unused" };
  }
  return { template: affinity[0], reason: "all_recently_used" };
}

/**
 * Combined fresh-style picker. Call BEFORE generating brief so the LLM
 * receives variety constraints, not soft suggestions.
 */
export function pickFreshStyle({ post_type = "general", channel = null, avoid_templates = [], avoid_accents = [] } = {}) {
  const tpl = pickFreshTemplate({ post_type, channel, avoid: avoid_templates });
  const hist = recent(channel);
  const lastAccents = hist.slice(0, 3).map(r => r.accent_color).filter(Boolean);
  const forbiddenAccents = new Set([...lastAccents, ...avoid_accents]);
  const accentAffinity =
    post_type === "news"        ? ["red", "amber", "gold", "cyan"]
  : post_type === "case_study"  ? ["green", "gold", "cyan", "amber"]
  : post_type === "provocation" ? ["amber", "red", "cyan", "gold"]
  : post_type === "sales"       ? ["gold", "cyan", "amber"]
  :                                ["cyan", "gold", "amber", "green"];
  let accent = accentAffinity.find(a => !forbiddenAccents.has(a));
  if (!accent) accent = pickAccent({ channel });
  return {
    template: tpl.template,
    template_reason: tpl.reason,
    accent_color: accent,
    layout_variant: pickLayout({ channel }),
  };
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2];
  if (cmd === "fresh") {
    const post_type = process.argv[3] || "general";
    console.log(`Fresh style for post_type=${post_type}:`);
    console.log(JSON.stringify(pickFreshStyle({ post_type }), null, 2));
    process.exit(0);
  }
  console.log("Next accent:", pickAccent());
  console.log("Next layout:", pickLayout());
  console.log("");
  console.log("Style context:");
  console.log(getStyleContextBlock());
}
