/**
 * scripts/content/variant-generator.mjs
 *
 * Given a synthesized brief, produces N variants (default 3) with different
 * style choices: safe / bold / contrarian. Each rendered, returned as set
 * of paths. The judge (next round) picks the winner.
 *
 * Variant strategies:
 *   - safe       — use synthesized brief as-is, accent from history rotation
 *   - bold       — push typography 20% larger, accent on different word, different layout_variant
 *   - contrarian — invert: if synth said horizontal-flow → try stat-hero; if cyan → try gold/red
 *
 * Public API:
 *   generateVariants({ baseBrief, count = 3 })
 *     → { ok, variants: [{ strategy, brief, png_path, html_path }] }
 */

import { renderVisual } from "./visual-render.mjs";
import { pickAccent, pickLayout } from "./visual-history.mjs";

function deepClone(obj) { return JSON.parse(JSON.stringify(obj)); }

function findAccentWord(title) {
  const m = title?.match(/\[accent\](.*?)\[\/accent\]/);
  return m ? m[1] : null;
}

function setAccentWord(title, newWord) {
  if (!title) return title;
  return title.replace(/\[accent\](.*?)\[\/accent\]/, `[accent]${newWord}[/accent]`);
}

function getSignificantWords(title) {
  // Skip [accent]...[/accent] markup, get words 4+ chars
  const stripped = title.replace(/\[accent\]|\[\/accent\]/g, "");
  const words = stripped.split(/\s+/).filter(w => w.replace(/[^a-zа-яё]/gi, "").length >= 4);
  return words.map(w => w.replace(/[^a-zа-яё-]/gi, ""));
}

/**
 * SAFE: as-is, accent rotates per history
 */
function makeSafe(brief, slug_suffix) {
  const v = deepClone(brief);
  v.slug = `${brief.slug}-safe`;
  v.accent_color = brief.accent_color || pickAccent({ channel: brief.channel });
  v.layout_variant = brief.layout_variant || pickLayout({ channel: brief.channel });
  v._variant_strategy = "safe";
  return v;
}

/**
 * BOLD: bigger, different accent word, different layout
 */
function makeBold(brief, slug_suffix) {
  const v = deepClone(brief);
  v.slug = `${brief.slug}-bold`;

  // Try to find a different significant word for accent
  const words = getSignificantWords(v.big_title);
  const current = findAccentWord(v.big_title);
  const candidates = words.filter(w => w.toLowerCase() !== (current || "").toLowerCase());
  if (candidates.length > 0) {
    // Pick the rarer/punchier word — usually last significant word
    const newWord = candidates[candidates.length - 1];
    v.big_title = v.big_title.replace(/\[accent\](.*?)\[\/accent\]/, "$1");  // strip
    v.big_title = v.big_title.replace(new RegExp(`\\b${newWord}\\b`, "i"), `[accent]${newWord}[/accent]`);
  }

  // Swap layout
  const cur = v.layout_variant || "center";
  v.layout_variant = cur === "center" ? "top" : (cur === "top" ? "bottom" : "center");

  // Keep accent color same — bold = same brand, different emphasis word
  v._variant_strategy = "bold";
  return v;
}

/**
 * CONTRARIAN: invert palette + change layout intent (alt_layout_hint suggests different template)
 */
function makeContrarian(brief, slug_suffix) {
  const v = deepClone(brief);
  v.slug = `${brief.slug}-contrarian`;

  // Invert accent
  const swap = { cyan: "gold", gold: "cyan", red: "amber", amber: "red", green: "cyan" };
  v.accent_color = swap[brief.accent_color] || "gold";

  // Compress diagram (drop middle steps if 6+, keep first and last)
  if (v.diagram?.steps?.length >= 5) {
    v.diagram.steps = [v.diagram.steps[0], ...v.diagram.steps.slice(-2)];
  }

  // Force different layout
  v.layout_variant = "bottom";

  v._variant_strategy = "contrarian";
  return v;
}

const STRATEGIES = {
  safe: makeSafe,
  bold: makeBold,
  contrarian: makeContrarian,
};

export async function generateVariants({ baseBrief, strategies = ["safe", "bold", "contrarian"], template = "idea-card" }) {
  if (!baseBrief) return { ok: false, reason: "no_base_brief" };

  const variants = [];
  for (const strat of strategies) {
    if (!STRATEGIES[strat]) continue;
    const variantBrief = STRATEGIES[strat](baseBrief);
    const renderResult = await renderVisual({ brief: variantBrief, template });
    if (!renderResult.ok) {
      variants.push({ strategy: strat, ok: false, reason: renderResult.reason, brief: variantBrief });
      continue;
    }
    variants.push({
      strategy: strat,
      ok: true,
      brief: variantBrief,
      png_path: renderResult.png_path,
      html_path: renderResult.html_path,
      manifest_path: renderResult.manifest_path,
      bytes: renderResult.bytes,
    });
  }

  const successful = variants.filter(v => v.ok);
  return {
    ok: successful.length > 0,
    variant_count: successful.length,
    variants,
  };
}

// CLI: cat brief.json | node variant-generator.mjs
if (import.meta.url === `file://${process.argv[1]}`) {
  let stdin = "";
  process.stdin.on("data", c => stdin += c);
  process.stdin.on("end", async () => {
    let baseBrief;
    try { baseBrief = JSON.parse(stdin); }
    catch (e) { console.error("brief must be valid JSON on stdin"); process.exit(2); }
    const r = await generateVariants({ baseBrief });
    console.log(JSON.stringify(r, null, 2));
  });
}
