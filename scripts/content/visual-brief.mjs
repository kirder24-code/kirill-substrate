/**
 * scripts/content/visual-brief.mjs
 *
 * Takes an IDEA (free text) + optional context → calls gpt-4o → returns a
 * structured Brief JSON ready for the renderer.
 *
 * Schema returned (idea-card flavor):
 *   {
 *     slug, type:"idea-card", kicker, big_title, subtitle,
 *     diagram: { type:"horizontal-flow", steps:[{label,desc}, ...] },
 *     hard_claims: [],  // factual numbers/things — must be verified against substrate
 *     soft_claims: []   // general statements — must pass forbidden-phrase filter
 *   }
 *
 * Inline egress check after LLM response — refuse if leak.
 *
 * Usage:
 *   import { generateBrief } from "./visual-brief.mjs";
 *   const brief = await generateBrief({ idea: "How Substrate turns signals into sales" });
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

// Per-template schema fragments. Brief generator selects ONE based on template_hint.
const TEMPLATE_SCHEMAS = {
  "idea-card": `{
  "slug": "<kebab, max 5 words>", "type": "idea-card",
  "kicker": "<3-4 word UPPER>",
  "big_title": "<8-14 word headline with ONE [accent]word[/accent]>",
  "subtitle": "<short sentence, <100 chars>",
  "diagram": { "type": "horizontal-flow", "steps": [{"label":"<2-word UPPER>","desc":"<3-5 words>"}] } (4-6 steps),
  "hard_claims": [...], "soft_claims": [...]
}`,

  "stat-hero": `{
  "slug": "<kebab>", "type": "stat-hero",
  "kicker": "<3-4 word UPPER>",
  "stat_value": "<the headline number, e.g. '$5K' or '3 days' or '591'>",
  "stat_unit": "<short label, e.g. 'in revenue' or 'beliefs tracked'>",
  "big_title": "<8-14 word context sentence with one [accent]word[/accent]>",
  "context": "<optional 1-line subcontext, <140 chars>",
  "hard_claims": [the number you used], "soft_claims": [...]
}`,

  "quote-card": `{
  "slug": "<kebab>", "type": "quote-card",
  "kicker": "<UPPER, e.g. 'SUBSTRATE · PRINCIPLE'>",
  "quote": "<the quote, 1-3 sentences, may contain one [accent]word[/accent] or [em]emphasis[/em]>",
  "attribution": "<Kirill D. · Substrate>",
  "hard_claims": [], "soft_claims": [...]
}`,

  "news-card": `{
  "slug": "<kebab>", "type": "news-card",
  "kicker": "<COUNTRY · PROGRAM>", "timestamp_text": "<AS OF DD MON YYYY>",
  "deadline_framing": "<deadline or rolling-intake line>",
  "primary_number": "<big number e.g. '$500M' or '2.25%'>",
  "primary_number_context": "<short label below the number>",
  "big_title": "<8-14 words with one [accent]word[/accent]>",
  "source_line": "<source citation>",
  "accent_color": "red",
  "hard_claims": [numbers], "soft_claims": [...]
}`,

  "before-after": `{
  "slug": "<kebab>", "type": "before-after",
  "kicker": "<UPPER>",
  "big_title": "<8-14 word framing with one [accent]word[/accent]>",
  "before_label": "BEFORE", "before_title": "<short>",
  "before_items": [4-5 short phrases that show the OLD way's failures],
  "after_label": "AFTER", "after_title": "<short>",
  "after_items": [4-5 short phrases that show the NEW way's wins],
  "hard_claims": [...], "soft_claims": [...]
}`,

  "system-diagram": `{
  "slug": "<kebab>", "type": "system-diagram",
  "kicker": "<UPPER, e.g. 'SUBSTRATE · ARCHITECTURE'>",
  "big_title": "<8-14 word framing with one [accent]word[/accent]>",
  "subtitle": "<short explanatory line>",
  "layers": [{"label":"<short name>","desc":"<3-7 word desc>","highlight":<true for ONE layer>}] (4-6 layers),
  "hard_claims": [...], "soft_claims": [...]
}`,

  "proof-frame": `{
  "slug": "<kebab>", "type": "proof-frame",
  "kicker": "<UPPER, e.g. 'SUBSTRATE · PROOF'>",
  "big_title": "<8-14 words with one [accent]word[/accent]>",
  "proof_titlebar": "<command or 'terminal'>",
  "proof_lines": [{"kind":"prompt|output|success|label","text":"..."}] (5-9 lines simulating CLI output),
  "source_line": "<source citation>",
  "hard_claims": [...], "soft_claims": [...]
}`,
};

const TEMPLATE_USE_CASES = {
  "idea-card":      "best for: flows/sequences (signal→reply), step-by-step mechanisms",
  "stat-hero":      "best for: ONE big number ($0, 591, 3-day) + context. Anchors a claim.",
  "quote-card":     "best for: sharp principle, naval-style aphorism, provocation",
  "news-card":      "best for: dated announcement, grant/program with deadline, fast intake",
  "before-after":   "best for: transformation framing, contrast columns",
  "system-diagram": "best for: layered architecture, 4-6 components stacked",
  "proof-frame":    "best for: terminal output, real CLI proof, ISA gate response",
};

function buildSystemPrompt({ template = "idea-card", accent = "cyan" }) {
  const schema = TEMPLATE_SCHEMAS[template] || TEMPLATE_SCHEMAS["idea-card"];
  const useCase = TEMPLATE_USE_CASES[template] || "";
  return `You are a B2B LinkedIn visual brief writer for "Substrate" — Kirill D.'s autonomous AI OS.

Your job: turn ONE idea into a structured visual brief for a 1080-pixel asset using the **${template}** template (${useCase}).

OUTPUT FORMAT — strict JSON for THIS template, no markdown fences, no commentary:

${schema}

REQUIRED:
- The 'type' field MUST be exactly "${template}".
- The 'accent_color' field MUST be "${accent}" (caller chose this to avoid visual repetition).
- Tailor content to the chosen template — don't return idea-card fields for stat-hero, etc.

STYLE RULES:
- Concrete > abstract. "Scout sees pain" not "AI detects opportunity"
- One [accent]word[/accent] marker per headline only
- Avoid: "guaranteed", "millions", "100x", "10x", "secret sauce", "game-changing", "revolutionary", "world's first", "AI-powered"
- No filesystem paths, env refs, API keys, email, internal numbers Kirill hasn't said publicly
- Tone: technical, calm, confident — never hype

Return ONLY the JSON. No backticks, no preamble.`;
}

export async function generateBrief({ idea, context = "", model = "gpt-4o", template_hint = null, accent_hint = null, layout_hint = null, post_type = "general" }) {
  if (!idea) return { ok: false, reason: "no_idea" };

  const env = envMap();
  const key = env.OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key) return { ok: false, reason: "no_openai_key" };

  // If caller didn't pre-pick, pull fresh style from history (anti-repeat).
  let template = template_hint;
  let accent = accent_hint;
  let layout = layout_hint;
  if (!template || !accent) {
    try {
      const { pickFreshStyle } = await import("./visual-history.mjs");
      const fresh = pickFreshStyle({ post_type });
      template = template || fresh.template;
      accent = accent || fresh.accent_color;
      layout = layout || fresh.layout_variant;
    } catch { template = template || "idea-card"; accent = accent || "cyan"; layout = layout || "center"; }
  }

  const systemPrompt = buildSystemPrompt({ template, accent });
  const userMsg = `IDEA: ${idea}\n\n${context ? "CONTEXT:\n" + context.slice(0, 600) : ""}\n\nRender as template=${template}, accent=${accent}. Be specific to THIS idea, not generic.`;

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMsg },
        ],
        temperature: 0.65,
        max_tokens: 1100,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) {
      const body = await r.text();
      return { ok: false, reason: "openai_http_" + r.status, body: body.slice(0, 300) };
    }
    const j = await r.json();
    const content = j.choices?.[0]?.message?.content;
    if (!content) return { ok: false, reason: "empty_completion" };

    let brief;
    try { brief = JSON.parse(content); }
    catch (e) { return { ok: false, reason: "json_parse_failed", error: e.message, raw: content.slice(0, 300) }; }

    // Ensure type + accent match what we requested (in case LLM drifted)
    if (!brief.slug) brief.slug = slugify(brief.big_title || brief.quote || brief.stat_value || idea);
    brief.type = template;  // FORCE the requested template (no LLM drift to idea-card)
    brief.accent_color = brief.accent_color || accent;
    brief.layout_variant = brief.layout_variant || layout || "center";
    brief.hard_claims = brief.hard_claims || [];
    brief.soft_claims = brief.soft_claims || [];

    // Load style.json to get forbidden phrases
    let style;
    try { style = JSON.parse(readFileSync(STYLE_PATH, "utf-8")); }
    catch { style = { forbidden_phrases: [] }; }

    // Soft-claim check on title + subtitle
    const checkPhrase = (text) => {
      if (!text) return null;
      const lower = text.toLowerCase();
      for (const p of (style.forbidden_phrases || [])) {
        if (lower.includes(p.toLowerCase())) return p;
      }
      return null;
    };
    const titleHit = checkPhrase(brief.big_title);
    const subHit = checkPhrase(brief.subtitle);
    if (titleHit || subHit) {
      return {
        ok: false,
        reason: "forbidden_phrase",
        field: titleHit ? "big_title" : "subtitle",
        phrase: titleHit || subHit,
        brief, // include so caller can see + ask for re-draft
      };
    }

    return { ok: true, brief, cost_estimate_usd: (j.usage?.total_tokens || 0) * 0.000005 };
  } catch (e) {
    return { ok: false, reason: "fetch_failed", error: e.message };
  }
}

// CLI smoke
if (import.meta.url === `file://${process.argv[1]}`) {
  const idea = process.argv.slice(2).join(" ") || "How Substrate turns market signals into sales";
  generateBrief({ idea }).then(r => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
  });
}
