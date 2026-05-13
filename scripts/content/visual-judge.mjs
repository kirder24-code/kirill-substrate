/**
 * scripts/content/visual-judge.mjs
 *
 * Best-of-N picker. Receives 3 variants (safe / bold / contrarian) and
 * picks the winner using LLM-judge scoring on 4 axes:
 *   - hook strength
 *   - clarity
 *   - on-brand consistency
 *   - scroll-stop probability
 *
 * Judge is gpt-4o WITH IMAGE INPUT (multimodal) — actually looks at the
 * rendered PNGs, not just the brief JSON.
 *
 * Public API:
 *   judgeVariants({ variants, original_idea, audience })
 *     → { ok, winner_strategy, winner_index, scores, reasoning, cost_usd }
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const ENV_PATH = resolve(ROOT, "apps/api/.env");

function envMap() {
  try {
    return Object.fromEntries(
      readFileSync(ENV_PATH, "utf-8").split("\n")
        .filter(l => l && !l.startsWith("#") && l.includes("="))
        .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
    );
  } catch { return {}; }
}

const JUDGE_SYSTEM = `You are the **Visual Judge** — final selector picking the best variant of a substrate visual asset for LinkedIn B2B publication.

You will be shown:
- The original IDEA
- The AUDIENCE
- 2-3 VARIANTS (each = one rendered PNG + its strategy label: "safe" / "bold" / "contrarian")

You evaluate each variant on 4 axes (0-10 each):

1. **hook_strength** — does it stop a scroller within 0.3s? Real number anchor? Cyan accent on right word?
2. **clarity** — at 5 seconds of looking, does the viewer understand the message?
3. **on_brand** — fits Substrate identity: dark void + cyan + JetBrains Mono labels + technical-honest tone?
4. **scroll_stop_probability** — would a B2B LinkedIn scroller pause OR keep scrolling? Be honest.

Then you pick a WINNER and explain in 1-2 sentences why it beat the others.

OUTPUT FORMAT — strict JSON:

{
  "scores": [
    {
      "strategy": "safe|bold|contrarian",
      "hook_strength": 0-10,
      "clarity": 0-10,
      "on_brand": 0-10,
      "scroll_stop_probability": 0-10,
      "total": 0-40
    }
  ],
  "winner_strategy": "safe|bold|contrarian",
  "winner_index": 0|1|2,
  "winner_reason": "1-2 sentences why this variant wins",
  "loser_reasons": "1 sentence each why others lost"
}

Return ONLY the JSON. No markdown, no preamble.`;

async function imageToBase64DataUrl(absPath) {
  try {
    const { readFileSync } = await import("node:fs");
    const buf = readFileSync(absPath);
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch (e) {
    return null;
  }
}

export async function judgeVariants({ variants, original_idea, audience = "general" }) {
  if (!Array.isArray(variants) || variants.length === 0) return { ok: false, reason: "no_variants" };
  const usable = variants.filter(v => v.ok && v.png_path);
  if (usable.length === 0) return { ok: false, reason: "no_renderable_variants" };
  if (usable.length === 1) {
    // single variant — auto-winner, no LLM cost
    return {
      ok: true,
      winner_strategy: usable[0].strategy,
      winner_index: 0,
      scores: [{ strategy: usable[0].strategy, hook_strength: 7, clarity: 7, on_brand: 7, scroll_stop_probability: 7, total: 28 }],
      winner_reason: "only one variant rendered successfully",
      cost_usd: 0,
    };
  }

  const env = envMap();
  const key = env.OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key) return { ok: false, reason: "no_openai_key" };

  // Build multimodal user message
  const contentBlocks = [
    { type: "text", text: `ORIGINAL IDEA: ${original_idea}\nAUDIENCE: ${audience}\n\nEvaluate these ${usable.length} variants:` },
  ];
  for (let i = 0; i < usable.length; i++) {
    const v = usable[i];
    const absPath = resolve(ROOT, v.png_path);
    const dataUrl = await imageToBase64DataUrl(absPath);
    if (!dataUrl) {
      contentBlocks.push({ type: "text", text: `\n[Variant ${i}: ${v.strategy} — image failed to load]` });
      continue;
    }
    contentBlocks.push({ type: "text", text: `\n──── VARIANT ${i}: ${v.strategy} ────` });
    contentBlocks.push({ type: "image_url", image_url: { url: dataUrl, detail: "low" } });
  }
  contentBlocks.push({ type: "text", text: "\nNow judge. Return ONLY the JSON." });

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: JUDGE_SYSTEM },
          { role: "user", content: contentBlocks },
        ],
        temperature: 0.3,
        max_tokens: 800,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) {
      const body = await r.text();
      return { ok: false, reason: `openai_http_${r.status}`, body: body.slice(0, 300) };
    }
    const j = await r.json();
    const content = j.choices?.[0]?.message?.content;
    if (!content) return { ok: false, reason: "empty_completion" };

    let verdict;
    try { verdict = JSON.parse(content); }
    catch (e) { return { ok: false, reason: "json_parse", error: e.message, raw: content.slice(0, 300) }; }

    // Compute total if model didn't
    if (Array.isArray(verdict.scores)) {
      for (const s of verdict.scores) {
        if (!s.total) s.total = (s.hook_strength || 0) + (s.clarity || 0) + (s.on_brand || 0) + (s.scroll_stop_probability || 0);
      }
    }

    const cost = (j.usage?.total_tokens || 0) * 0.0000075;
    return {
      ok: true,
      winner_strategy: verdict.winner_strategy,
      winner_index: verdict.winner_index,
      winner_path: usable[verdict.winner_index]?.png_path,
      winner_brief: usable[verdict.winner_index]?.brief,
      scores: verdict.scores,
      winner_reason: verdict.winner_reason,
      loser_reasons: verdict.loser_reasons,
      cost_usd: cost,
    };
  } catch (e) {
    return { ok: false, reason: "fetch_failed", error: e.message };
  }
}

// CLI smoke: not directly invokable without variants JSON
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log("visual-judge: import { judgeVariants } and pass variant array");
}
