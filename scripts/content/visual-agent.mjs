#!/usr/bin/env node
/**
 * scripts/content/visual-agent.mjs
 *
 * TOP-LEVEL ORCHESTRATOR — runs the full Visual Agent pipeline:
 *
 *   idea → consultPanel (5-7 specialists in parallel)
 *        → synthesize (unified brief from panel)
 *        → generateVariants (safe + bold + contrarian)
 *        → judgeVariants (multimodal LLM picks winner)
 *        → save winner to content-store DB
 *        → output winner PNG path
 *
 * Modes:
 *   FAST mode (default): single render from synthesized brief, no variants/judge.
 *     ~$0.005, ~8 sec. Same as Phase A.
 *
 *   FULL mode (--full): full team-of-designers pipeline.
 *     ~$0.03, ~30-45 sec. Use for important posts.
 *
 *   BRIEF-ONLY mode (--brief-json): skip LLM, use provided brief directly. ~$0, ~3 sec.
 *
 * Usage:
 *   node scripts/content/visual-agent.mjs "How Substrate turns signals into sales"
 *   node scripts/content/visual-agent.mjs "BDC launched LIFT $500M" --full --post-type news --audience ca-lift
 *   node scripts/content/visual-agent.mjs --brief-json /tmp/brief.json
 */

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generateBrief } from "./visual-brief.mjs";
import { renderVisual } from "./visual-render.mjs";
import { renderMotion } from "./motion-render.mjs";
import { renderScroll } from "./scroll-render.mjs";
import { applyRecipe } from "./scroll-recipes.mjs";
import { consultPanel } from "./visual-orchestrator.mjs";
import { synthesize } from "./visual-synthesizer.mjs";
import { generateVariants } from "./variant-generator.mjs";
import { judgeVariants } from "./visual-judge.mjs";
import { saveAsset, updateAsset } from "./content-store.mjs";
import { getStyleContextBlock, enforceTemplateVariety } from "./visual-history.mjs";
import { sendAssetForApproval } from "./tg-approval.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");

export async function runVisualAgent({
  idea,
  slug,
  context = "",
  post_type = "general",
  channel = "linkedin",
  audience = "general",
  mode = "fast",  // "fast" | "full" | "brief-only"
  briefOverride = null,
  asset_level = "static",          // "static" | "motion" | "scroll" — per Variant C spec
  auto_telegram = true,            // dispatch to TG after save; false disables (e.g. CI)
  recipe = null,                   // for asset_level=scroll: which predefined recipe to use
  template_hint = null,            // force a specific template (anti-repeat / regen flow)
  accent_hint = null,              // force a specific accent color
}) {
  const started = Date.now();
  console.log(`\n━━━ VISUAL AGENT (${mode.toUpperCase()}) ━━━`);
  console.log(`idea: ${idea?.slice(0, 100) || "(brief-override)"}`);
  console.log(`channel=${channel} audience=${audience} post_type=${post_type}`);

  let brief;
  let total_cost = 0;
  let synthesis_reasoning = null;
  let judgeVerdict = null;

  // ─── SCROLL PATH (recipe-driven OR panel-driven) ─────────────────────────
  // If --recipe given, use hardcoded sections. Else (--full mode) the panel must produce them.
  // Recipe is fast/deterministic; --full is slower but lets web-experience-designer compose.
  if (asset_level === "scroll" && recipe) {
    const r = applyRecipe(recipe, { slug });
    if (!r.ok) return { ok: false, stage: "scroll_recipe", ...r };
    const scrollBrief = r.brief;
    console.log(`[1/3] Recipe '${recipe}' loaded · ${scrollBrief.sections.length} sections`);
    console.log(`[2/3] Rendering scroll experience (1920×1080 viewport, programmatic scroll)…`);
    const scroll = await renderScroll({ brief: scrollBrief });
    if (!scroll.ok) return { ok: false, stage: "scroll_render", brief: scrollBrief, ...scroll };
    console.log(`  HTML: ${scroll.html_path} (${(scroll.html_bytes/1024).toFixed(0)}KB)`);
    console.log(`  MP4:  ${scroll.scroll_mp4_path} (${(scroll.mp4_bytes/1024).toFixed(0)}KB)`);
    console.log(`  PDF:  ${scroll.pdf_path} (${(scroll.pdf_bytes/1024).toFixed(0)}KB)`);

    scrollBrief.big_title = scrollBrief.sections[0]?.headline || scrollBrief.page_title;
    scrollBrief.type = "landing-page";
    scrollBrief.accent_color = scrollBrief.accent_color || "cyan";

    return await finalize({
      mode, brief: scrollBrief,
      primary_path: scroll.html_path, png_path: null,
      manifest_path: scroll.manifest_path, asset_level: "scroll",
      level_paths: {
        html_path: scroll.html_path, scroll_mp4_path: scroll.scroll_mp4_path,
        pdf_path: scroll.pdf_path, webm_path: scroll.webm_path,
      },
      idea: idea || `[recipe:${recipe}]`, channel, audience,
      extras: { variant_count: 1, recipe, section_count: scroll.section_count, cta_url: scroll.cta_url },
      cost_usd: total_cost, started, auto_telegram,
    });
  }
  if (asset_level === "scroll" && !recipe && mode !== "full") {
    return { ok: false, stage: "scroll_input", reason: "scroll_requires_recipe_or_full", hint: "pass --recipe=launchsoloai-landing OR --full to let panel compose sections" };
  }

  // ─── BRIEF generation ────────────────────────────────────────────────────
  if (briefOverride) {
    brief = briefOverride;
    console.log(`[1/4] Using provided brief, slug=${brief.slug}`);
  } else if (mode === "fast") {
    console.log(`[1/4] Single-LLM brief (fast mode)…`);
    const r = await generateBrief({ idea, context, template_hint, accent_hint, post_type });
    if (!r.ok) return { ok: false, stage: "brief", ...r };
    brief = r.brief;
    if (slug) brief.slug = slug;
    total_cost += r.cost_estimate_usd || 0;
    console.log(`      brief OK · type=${brief.type} accent=${brief.accent_color} · "${(brief.big_title || brief.quote || brief.stat_value || "").slice(0, 60)}"`);
  } else if (mode === "full") {
    console.log(`[1/4] Consulting design panel (${post_type})…`);
    const history_context = getStyleContextBlock({ channel });
    const panelResult = await consultPanel({ idea, context, channel, audience, post_type, asset_level, history_summary: history_context });
    if (!panelResult.ok) return { ok: false, stage: "panel", ...panelResult };
    total_cost += panelResult.total_cost_usd || 0;
    console.log(`      ${panelResult.specialists_consulted.length} specialists in ${panelResult.parallel_latency_ms}ms · $${panelResult.total_cost_usd.toFixed(4)}`);

    console.log(`[2/4] Synthesizing unified brief…`);
    const synthResult = await synthesize({ idea, context, post_type, channel, audience, asset_level, panel: panelResult.panel, history_context });
    if (!synthResult.ok) return { ok: false, stage: "synthesize", ...synthResult };
    brief = synthResult.brief;
    if (slug) brief.slug = slug;
    total_cost += synthResult.cost_usd || 0;
    synthesis_reasoning = brief.synthesis_reasoning;
    console.log(`      synthesized · "${brief.big_title?.slice(0, 80)}" · $${synthResult.cost_usd.toFixed(4)}`);
  }

  if (!brief) return { ok: false, stage: "brief", reason: "no_brief_after_generation" };

  // ─── SCROLL PATH (panel-composed; --full + asset_level=scroll, no recipe) ─
  if (asset_level === "scroll") {
    if (!Array.isArray(brief.sections) || brief.sections.length < 4) {
      return { ok: false, stage: "scroll_brief_invalid", reason: "panel_did_not_produce_sections", brief, hint: "synthesizer needs web-experience-designer's sections" };
    }
    if (slug) brief.slug = slug;
    brief.accent_color = brief.accent_color || "cyan";
    console.log(`[3/4] Rendering scroll experience from panel (${brief.sections.length} sections)…`);
    const scroll = await renderScroll({ brief });
    if (!scroll.ok) return { ok: false, stage: "scroll_render", brief, ...scroll };
    console.log(`  HTML: ${scroll.html_path} (${(scroll.html_bytes/1024).toFixed(0)}KB)`);
    console.log(`  MP4:  ${scroll.scroll_mp4_path} (${(scroll.mp4_bytes/1024).toFixed(0)}KB)`);
    console.log(`  PDF:  ${scroll.pdf_path} (${(scroll.pdf_bytes/1024).toFixed(0)}KB)`);

    brief.big_title = brief.sections[0]?.headline || brief.page_title;
    brief.type = "landing-page";

    return await finalize({
      mode, brief,
      primary_path: scroll.html_path, png_path: null,
      manifest_path: scroll.manifest_path, asset_level: "scroll",
      level_paths: {
        html_path: scroll.html_path, scroll_mp4_path: scroll.scroll_mp4_path,
        pdf_path: scroll.pdf_path, webm_path: scroll.webm_path,
      },
      idea, channel, audience,
      extras: { variant_count: 1, recipe: "panel-composed", section_count: scroll.section_count, cta_url: scroll.cta_url },
      cost_usd: total_cost, started, auto_telegram,
    });
  }

  // ─── MOTION PATH (asset_level=motion bypasses static render) ─────────────
  if (asset_level === "motion") {
    if (!brief.slug && slug) brief.slug = slug;
    // Template dispatch: if brief carries flow_steps, use animated-flow; else kinetic-text-loop.
    // Synthesizer or creative-director may have chosen a specific motion_template already.
    if (brief.motion_template) brief.type = brief.motion_template;
    else if (Array.isArray(brief.flow_steps) && brief.flow_steps.length >= 3) brief.type = "animated-flow";
    else brief.type = "kinetic-text-loop";
    brief.accent_color = brief.accent_color || "cyan";
    // Animated-flow needs more time to play through steps
    brief.duration_sec = brief.duration_sec || (brief.type === "animated-flow" ? 8 : 5);
    brief.kicker = brief.kicker || "SUBSTRATE";
    brief.kicker_tag = brief.kicker_tag || (post_type || "principle").toUpperCase();

    console.log(`[2/3] Rendering motion (${brief.type}, ${brief.duration_sec}s)…`);
    const motion = await renderMotion({ brief });
    if (!motion.ok) return { ok: false, stage: "motion_render", brief, ...motion };
    console.log(`  MP4: ${motion.mp4_path} (${(motion.mp4_bytes/1024).toFixed(0)}KB) · GIF: ${motion.gif_path} (${(motion.gif_bytes/1024).toFixed(0)}KB)`);

    return await finalize({
      mode,
      brief,
      // For motion, "primary path" is MP4. We store png_path as null and use paths{}.
      primary_path: motion.mp4_path,
      png_path: null,
      manifest_path: motion.manifest_path,
      asset_level: "motion",
      level_paths: { mp4_path: motion.mp4_path, gif_path: motion.gif_path, webm_path: motion.webm_path, html_path: motion.html_path },
      idea, channel, audience,
      extras: { variant_count: 1, motion_template: motion.motion_template, duration_sec: motion.duration_sec },
      cost_usd: total_cost,
      started,
      auto_telegram,
    });
  }

  // ─── Variety check (static path) ─────────────────────────────────────────
  const variety = enforceTemplateVariety({ proposed_template: brief.type, channel });
  if (!variety.ok) {
    console.log(`      ⚠️  history says: ${variety.reason} (suggesting ${variety.alternative_suggestion})`);
  }

  // ─── RENDER ──────────────────────────────────────────────────────────────
  if (mode === "full") {
    console.log(`[3/4] Generating 3 variants (safe / bold / contrarian)…`);
    const variantResult = await generateVariants({ baseBrief: brief });
    if (!variantResult.ok) return { ok: false, stage: "variants", ...variantResult, brief };
    console.log(`      ${variantResult.variant_count} variants rendered`);

    console.log(`[4/4] Judge picking winner (multimodal)…`);
    judgeVerdict = await judgeVariants({ variants: variantResult.variants, original_idea: idea, audience });
    if (!judgeVerdict.ok) return { ok: false, stage: "judge", ...judgeVerdict, brief, variants: variantResult.variants };
    total_cost += judgeVerdict.cost_usd || 0;
    const winner = variantResult.variants[judgeVerdict.winner_index];
    console.log(`      winner: ${judgeVerdict.winner_strategy} (score ${judgeVerdict.scores[judgeVerdict.winner_index]?.total}/40)`);
    console.log(`      reason: ${judgeVerdict.winner_reason}`);

    return await finalize({
      mode: "full",
      brief: winner.brief,
      primary_path: winner.png_path,
      png_path: winner.png_path,
      manifest_path: winner.manifest_path,
      idea, channel, audience,
      asset_level,
      level_paths: { png_path: winner.png_path },
      extras: {
        variants: variantResult.variants,
        verdict: judgeVerdict,
        variant_count: variantResult.variant_count,
        judge_score: judgeVerdict.scores[judgeVerdict.winner_index]?.total / 40,
        judge_reason: judgeVerdict.winner_reason,
      },
      cost_usd: total_cost,
      started,
      auto_telegram,
    });
  }

  // FAST or BRIEF-ONLY modes: single static render
  console.log(`[2/3] Rendering single asset…`);
  const renderResult = await renderVisual({ brief, template: brief.type || "idea-card" });
  if (!renderResult.ok) return { ok: false, stage: "render", brief, ...renderResult };
  console.log(`  PNG:      ${renderResult.png_path} (${(renderResult.bytes / 1024).toFixed(0)}KB)`);

  return await finalize({
    mode,
    brief,
    primary_path: renderResult.png_path,
    png_path: renderResult.png_path,
    manifest_path: renderResult.manifest_path,
    idea, channel, audience,
    asset_level,
    level_paths: { png_path: renderResult.png_path },
    extras: { variant_count: 1 },
    cost_usd: total_cost,
    started,
    auto_telegram,
  });
}

// ─── finalize: persist + dispatch + write spec-shape output.json ─────────
async function finalize({ mode, brief, primary_path, png_path, manifest_path, idea, channel, audience, asset_level, level_paths = {}, extras = {}, cost_usd, started, auto_telegram }) {
  const elapsed_ms = Date.now() - started;
  const elapsed_sec = (elapsed_ms / 1000).toFixed(1);

  const primary_abs = resolve(ROOT, primary_path);
  const asset_dir_rel = primary_path.split("/").slice(0, -1).join("/");
  const asset_dir_abs = resolve(ROOT, asset_dir_rel);
  const brief_json_path_abs = resolve(asset_dir_abs, "brief.json");

  // Resolve all level_paths to absolute for harness & TG dispatch
  const paths_obj_abs = {};
  for (const [k, v] of Object.entries(level_paths)) {
    if (v) paths_obj_abs[k] = resolve(ROOT, v);
  }

  const saveResult = saveAsset({
    slug: brief.slug,
    idea_source: "manual",
    idea_text: idea,
    brief_json: brief,
    template_type: brief.type,
    accent_color: brief.accent_color || "cyan",
    layout_variant: brief.layout_variant || "center",
    channel, audience,
    asset_dir: asset_dir_rel,
    png_path,                  // null for motion
    variant_count: extras.variant_count || 1,
    judge_score: extras.judge_score,
    judge_reason: extras.judge_reason,
    status: "draft",
    asset_level,
    paths: paths_obj_abs,
    brief_json_path: brief_json_path_abs,
    elapsed_ms,
  });
  if (!saveResult.ok) return { ok: false, stage: "db_save", reason: saveResult.reason, error: saveResult.error };

  // Telegram dispatch — REQUIRED by spec check S4. If creds missing or send fails, surface it.
  let telegram_message_id = null;
  let telegram_skipped_reason = null;
  if (auto_telegram) {
    try {
      const tg = await sendAssetForApproval({ asset_id: saveResult.id });
      if (tg.ok) {
        telegram_message_id = tg.message_id;
        updateAsset(saveResult.id, { telegram_message_id });
      } else {
        telegram_skipped_reason = tg.reason || "tg_send_failed";
        console.log(`  ⚠️  Telegram dispatch skipped: ${telegram_skipped_reason}`);
      }
    } catch (e) {
      telegram_skipped_reason = `tg_exception:${e.message?.slice(0, 80)}`;
      console.log(`  ⚠️  Telegram dispatch error: ${telegram_skipped_reason}`);
    }
  } else {
    telegram_skipped_reason = "auto_telegram=false";
  }

  const output = {
    ok: true,
    mode,
    asset_level,
    db_id: saveResult.id,
    asset_id: saveResult.id,
    primary_path: primary_abs,
    png_path: png_path ? resolve(ROOT, png_path) : null,
    mp4_path: paths_obj_abs.mp4_path || null,
    gif_path: paths_obj_abs.gif_path || null,
    html_path: paths_obj_abs.html_path || null,
    scroll_mp4_path: paths_obj_abs.scroll_mp4_path || null,
    pdf_path: paths_obj_abs.pdf_path || null,
    manifest_path: manifest_path ? resolve(ROOT, manifest_path) : null,
    brief_json_path: brief_json_path_abs,
    telegram_message_id,
    telegram_skipped_reason,
    elapsed_ms,
    elapsed_sec,
    cost_usd,
    brief_summary: { slug: brief.slug, template: brief.type, big_title: brief.big_title?.slice(0, 120) },
    ...(extras.motion_template ? { motion_template: extras.motion_template, duration_sec: extras.duration_sec } : {}),
    ...(extras.recipe ? { recipe: extras.recipe, section_count: extras.section_count, cta_url: extras.cta_url } : {}),
    ...(extras.verdict ? { verdict: extras.verdict } : {}),
  };

  const output_path = resolve(asset_dir_abs, "output.json");
  writeFileSync(output_path, JSON.stringify(output, null, 2));
  output.output_path = output_path;

  console.log(`\n━━━ DONE in ${elapsed_sec}s · cost ~$${cost_usd.toFixed(4)} ━━━`);
  console.log(`  asset_id:     ${saveResult.id}`);
  console.log(`  primary:      ${primary_abs}`);
  console.log(`  brief_json:   ${brief_json_path_abs}`);
  console.log(`  telegram_msg: ${telegram_message_id || `(skipped: ${telegram_skipped_reason})`}`);
  console.log(`  output.json:  ${output_path}`);

  return output;
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  let idea = "", slug = null, briefPath = null, context = "";
  let post_type = "general", channel = "linkedin", audience = "general", mode = "fast";
  let asset_level = "static", auto_telegram = true, recipe = null;
  let template_hint = null, accent_hint = null;
  // Normalize --flag=value into --flag, value pairs
  const norm = [];
  for (const raw of args) {
    const eq = raw.indexOf("=");
    if (raw.startsWith("--") && eq > 0) { norm.push(raw.slice(0, eq), raw.slice(eq + 1)); }
    else norm.push(raw);
  }
  for (let i = 0; i < norm.length; i++) {
    const a = norm[i];
    if (a === "--idea")        idea = norm[++i];
    else if (a === "--slug")        slug = norm[++i];
    else if (a === "--brief-json")  briefPath = norm[++i];
    else if (a === "--context")     context = norm[++i];
    else if (a === "--post-type")   post_type = norm[++i];
    else if (a === "--channel")     channel = norm[++i];
    else if (a === "--audience")    audience = norm[++i];
    else if (a === "--full")        mode = "full";
    else if (a === "--fast")        mode = "fast";
    else if (a === "--level")       asset_level = norm[++i];
    else if (a === "--recipe")      recipe = norm[++i];
    else if (a === "--template")    template_hint = norm[++i];
    else if (a === "--accent")      accent_hint = norm[++i];
    else if (a === "--no-telegram") auto_telegram = false;
    else if (!idea) idea = a;
  }
  let briefOverride = null;
  if (briefPath) {
    if (!existsSync(briefPath)) { console.error(`brief file not found: ${briefPath}`); process.exit(2); }
    briefOverride = JSON.parse(readFileSync(briefPath, "utf-8"));
    mode = "brief-only";
  }
  if (!idea && !briefOverride && !(asset_level === "scroll" && recipe)) {
    console.error(`Usage:
  visual-agent.mjs "<idea>"                                                # fast mode (single LLM)
  visual-agent.mjs "<idea>" --full --post-type news                        # full pipeline (panel+judge)
  visual-agent.mjs --brief-json path/to/brief.json                         # render only
  visual-agent.mjs "<idea>" --level=motion                                 # 5s kinetic-text mp4+gif
  visual-agent.mjs --level=scroll --recipe=launchsoloai-landing            # multi-section landing page
Flags:
  --level       static | motion | scroll
  --recipe      (scroll only) launchsoloai-landing | apollo-case
  --post-type   news | sales | educational | provocation | carousel | case_study | general
  --audience    au-rdti | ca-lift | calgary-smb | intel-upwork | russian | general
  --channel     linkedin | threads | reddit
  --slug        override slug
  --no-telegram skip Telegram dispatch`);
    process.exit(2);
  }
  runVisualAgent({ idea, slug, context, post_type, channel, audience, mode, briefOverride, asset_level, auto_telegram, recipe, template_hint, accent_hint }).then(r => {
    if (!r.ok) {
      console.error("FAILED:", JSON.stringify(r, null, 2).slice(0, 1500));
      process.exit(1);
    }
    process.exit(0);
  });
}
