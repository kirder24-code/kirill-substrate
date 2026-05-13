/**
 * scripts/content/visual-synthesizer.mjs
 *
 * Takes the panel of specialist opinions from visual-orchestrator and
 * produces ONE unified brief JSON ready for the renderer.
 *
 * The synthesizer is itself an LLM call (gpt-4o) that reads:
 *   - The original idea
 *   - The panel of structured specialist opinions
 *   - Style tokens
 *
 * And returns the final brief with explicit trade-offs noted.
 *
 * Public API:
 *   synthesize({ idea, context, post_type, channel, audience, panel })
 *     → { ok, brief, synthesis_reasoning, cost_usd }
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const ENV_PATH = resolve(ROOT, "apps/api/.env");
const STYLE_PATH = resolve(__dirname, "visual-style.json");

function envMap() {
  try {
    return Object.fromEntries(
      readFileSync(ENV_PATH, "utf-8").split("\n")
        .filter(l => l && !l.startsWith("#") && l.includes("="))
        .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
    );
  } catch { return {}; }
}

function slugify(text) {
  return (text || "untitled")
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

const SYNTHESIZER_SYSTEM = `You are the **Synthesizer** — produce ONE unified visual brief from the design panel.

You will receive:
- An IDEA, POST TYPE, ASSET LEVEL (static | motion | scroll)
- A PANEL of specialist opinions (each structured JSON)

CRITICAL PROTOCOL:
- If \`visual-creative-director\` is in the panel and has approved:true, treat its \`chosen_template\`, \`asset_level\`, \`primary_message\`, and \`kill_decorations\` as AUTHORITATIVE. Copy them into the brief. Note its \`overrides_applied\` in synthesis_reasoning.specialists_overridden.
- If visual-psychologist hook_score < 6, address the issue.
- If brand-designer approved:false, address consistency.

TEMPLATES by asset_level:
  static: idea-card | carousel-slide | news-card | stat-hero | quote-card | before-after | system-diagram | proof-frame
  motion: kinetic-text-loop | animated-flow
  scroll: landing-page (sections come from web-experience-designer)

ACCENT colors: cyan (default) | gold | red (news) | green (success) | amber (caution)

OUTPUT — strict JSON, no markdown fences. Fields depend on asset_level:

STATIC:
{
  "slug": "<kebab, max 5 words>",
  "type": "<template name>",
  "asset_level": "static",
  "kicker": "<UPPERCASE 3-5 words>",
  "big_title": "<headline with one [accent]word[/accent]>",
  "subtitle": "<1 sentence | empty>",
  "diagram": { "type": "horizontal-flow", "steps": [{"label":"2-WORD","desc":"3-5 words"}] },
  "accent_color": "cyan|gold|red|green|amber",
  "layout_variant": "top|center|bottom",
  "hard_claims": [...], "soft_claims": [...],
  "synthesis_reasoning": { "hook_decision","color_decision","layout_decision","trade_offs":[...], "specialists_overridden":[{"specialist","reason"}] }
}

MOTION:
{
  "slug","asset_level":"motion","type":"kinetic-text-loop|animated-flow",
  "motion_template":"<same as type>",
  "big_title":"<with [accent]>",
  "kicker","accent_color","duration_sec":3..12,
  "flow_steps": [{"label":"UPPER","desc":"short"}] (REQUIRED if type=animated-flow, 4-6 steps),
  "hard_claims","soft_claims","synthesis_reasoning"
}

SCROLL:
{
  "slug","asset_level":"scroll","type":"landing-page",
  "page_purpose":"marketing-landing|case-study|product-explainer",
  "page_title","accent_color","cta_url":"<verbatim from web-experience-designer or context>",
  "sections": [
    {"type":"hero|problem|solution|system|proof|pricing|cta","kicker":"...","headline":"<[accent] ok>","body":"...","bullets":[...],"layers":[{"name","desc","highlight?"}],"terminal":{"title","lines":[{"kind":"prompt|ok|err|text","text"}]},"tiers":[{"tier","amount","unit","includes":[...],"featured?"}], "cta_text","cta_url"}
  ] (4-8 sections — pull directly from web-experience-designer.sections if present),
  "hard_claims","soft_claims","synthesis_reasoning"
}

Return ONLY the JSON. No backticks, no preamble.`;

export async function synthesize({ idea, context = "", post_type = "general", channel = "linkedin", audience = "general", asset_level = "static", panel = {}, history_context = "" }) {
  if (!idea) return { ok: false, reason: "no_idea" };
  if (!panel || Object.keys(panel).length === 0) return { ok: false, reason: "empty_panel" };

  const env = envMap();
  const key = env.OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key) return { ok: false, reason: "no_openai_key" };

  // Compact panel: drop nulls. Keep all opinions full — fragile string-truncation breaks
  // JSON shapes (arrays mid-truncate). Prompt size stays manageable (~10-20KB).
  const compactPanel = {};
  for (const [name, opinion] of Object.entries(panel)) {
    if (opinion) compactPanel[name] = opinion;
  }

  const cd = panel["visual-creative-director"];
  const cdNote = cd?.approved
    ? `\n\nDIRECTOR'S CALL (authoritative — copy these into the brief):\n` +
      `- chosen_template: ${cd.chosen_template}\n` +
      `- asset_level: ${cd.asset_level || asset_level}\n` +
      `- primary_message: ${cd.primary_message || "(use idea)"}\n` +
      `- chosen_trend: ${cd.chosen_trend || "(none)"}\n` +
      `- kill_decorations: ${JSON.stringify(cd.kill_decorations || [])}\n`
    : "";

  const userMsg = `IDEA: ${idea}
POST TYPE: ${post_type}
ASSET LEVEL: ${asset_level}
CHANNEL: ${channel}
AUDIENCE: ${audience}
${context ? `\nCONTEXT:\n${context.slice(0, 500)}\n` : ""}
${history_context ? `\nHISTORY (for variety):\n${history_context.slice(0, 300)}\n` : ""}${cdNote}

PANEL OPINIONS:
${JSON.stringify(compactPanel, null, 2)}

Synthesize into ONE unified brief per the format in your system prompt. Output must match the schema for asset_level=${asset_level}.`;

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: SYNTHESIZER_SYSTEM },
          { role: "user", content: userMsg },
        ],
        temperature: 0.5,
        max_tokens: asset_level === "scroll" ? 3000 : 1500,  // scroll needs section payload
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(40_000),
    });
    if (!r.ok) {
      const body = await r.text();
      return { ok: false, reason: `openai_http_${r.status}`, body: body.slice(0, 300) };
    }
    const j = await r.json();
    const content = j.choices?.[0]?.message?.content;
    if (!content) return { ok: false, reason: "empty_completion" };

    let brief;
    try { brief = JSON.parse(content); }
    catch (e) { return { ok: false, reason: "json_parse", error: e.message, raw: content.slice(0, 400) }; }

    if (!brief.slug) brief.slug = slugify(brief.big_title || brief.page_title || idea);
    // Asset-level-appropriate default type if synthesizer omitted it
    if (!brief.type) {
      brief.type = asset_level === "motion" ? "kinetic-text-loop"
                : asset_level === "scroll" ? "landing-page"
                : "idea-card";
    }
    brief.asset_level = brief.asset_level || asset_level;
    brief.hard_claims = brief.hard_claims || [];
    brief.soft_claims = brief.soft_claims || [];
    brief.accent_color = brief.accent_color || "cyan";
    brief.layout_variant = brief.layout_variant || "center";

    // Sanity: if creative-director chose a template and synth deviated, log + override
    if (cd?.approved && cd.chosen_template && cd.chosen_template !== brief.type) {
      brief.synthesis_reasoning = brief.synthesis_reasoning || {};
      brief.synthesis_reasoning.director_override = `director chose ${cd.chosen_template}, synth had ${brief.type} — using director's call`;
      brief.type = cd.chosen_template;
    }

    // Soft-claim filter
    let style;
    try { style = JSON.parse(readFileSync(STYLE_PATH, "utf-8")); }
    catch { style = { forbidden_phrases: [] }; }
    const check = (text) => {
      if (!text) return null;
      const lower = text.toLowerCase();
      for (const p of (style.forbidden_phrases || [])) {
        if (lower.includes(p.toLowerCase())) return p;
      }
      return null;
    };
    const titleHit = check(brief.big_title);
    const subHit = check(brief.subtitle);
    if (titleHit || subHit) {
      return {
        ok: false, reason: "forbidden_phrase",
        field: titleHit ? "big_title" : "subtitle",
        phrase: titleHit || subHit,
        brief,
      };
    }

    const tokens = j.usage?.total_tokens || 0;
    const cost = tokens * 0.0000075;  // gpt-4o approx
    return { ok: true, brief, cost_usd: cost };
  } catch (e) {
    return { ok: false, reason: "fetch_failed", error: e.message };
  }
}

// CLI: cat panel.json | node visual-synthesizer.mjs "<idea>"
if (import.meta.url === `file://${process.argv[1]}`) {
  let stdin = "";
  process.stdin.on("data", c => stdin += c);
  process.stdin.on("end", async () => {
    const idea = process.argv[2] || "How Substrate turns signals into sales";
    let panel = {};
    try { panel = JSON.parse(stdin); } catch {}
    const r = await synthesize({ idea, panel });
    console.log(JSON.stringify(r, null, 2));
  });
}
