/**
 * scripts/content/post-writer.mjs
 *
 * Produces structured post payload from a visual brief:
 *   - post_text   (LinkedIn body, 100-300 words, Kirill voice)
 *   - hashtags    (5-7, lowercased)
 *   - purpose     (1-line WHY this post exists)
 *   - suggested_post_at (ISO, next reasonable slot)
 *
 * Uses gpt-4o with substrate-grounded persona context. Reuses Tolik's
 * substrate-grounding files (operator-identity, channel-registry,
 * marketing-strategist persona, retrieval block) so text matches voice.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const ENV_PATH = resolve(ROOT, "apps/api/.env");
const STYLE_PATH = resolve(__dirname, "visual-style.json");

const PERSONAS_DIR = resolve(ROOT, "scripts/survival/personas");
const CHANNEL_REGISTRY = resolve(ROOT, "scripts/survival/channel-registry.md");
const OPERATOR_IDENTITY = resolve(ROOT, "scripts/survival/operator-identity.md");

function envMap() {
  try {
    return Object.fromEntries(
      readFileSync(ENV_PATH, "utf-8").split("\n")
        .filter(l => l && !l.startsWith("#") && l.includes("="))
        .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
    );
  } catch { return {}; }
}

function readMaybe(p, maxChars = 3000) {
  try { return existsSync(p) ? readFileSync(p, "utf-8").slice(0, maxChars) : ""; }
  catch { return ""; }
}

/**
 * Default suggested time: next 9am or 1pm slot (LinkedIn B2B prime windows),
 * whichever is sooner, but at least 60 min from now.
 */
function nextPostSlot() {
  const now = new Date();
  const candidates = [];
  for (let d = 0; d <= 2; d++) {
    for (const h of [9, 13]) {
      const c = new Date(now);
      c.setDate(c.getDate() + d);
      c.setHours(h, 0, 0, 0);
      if (c.getTime() - now.getTime() > 60 * 60 * 1000) candidates.push(c);
    }
  }
  return candidates[0] || new Date(now.getTime() + 3 * 60 * 60 * 1000);
}

const POST_WRITER_SYSTEM = `You are the **Post Writer** — generate the LinkedIn post body, hashtags, and one-line purpose for a visual asset that's been approved by the design panel.

You are Kirill D. (writing in his voice):
- AI architect, ex-Parliament operations (10 years), now in Calgary
- Solo operator building Substrate (autonomous AI OS)
- Sells AI engineering services ($1.5K-10K CAD); recent Apollo Finvest 3-day NBFC build
- Dry, technical, allergic to hype. No hype words. No em dash (HYPHEN ONLY).
- Concrete numbers > adjectives. Real proof > general claims.
- Audience: solo founders, small B2B operators, fintech ops people.

VOICE RULES (NON-NEGOTIABLE):
- Never em dash. Use hyphen.
- Never "guaranteed / 100x / millions / unlock / leverage / synergy / transform"
- Never "Hope this finds you well" or any LinkedIn-spam phrasing
- First 2 lines must hook (mobile preview window) — concrete claim or sharp question, not "Today I want to talk about..."
- Body: short paragraphs (1-3 lines each), one specific idea per paragraph
- Numbers are real or marked as observation; never invent metrics
- One CTA at end. Soft, not pitchy ("if this resonates...", "happy to compare notes")

STRUCTURE for the post_text:
1. Hook (1-2 lines, owns the topic)
2. Setup of the observation/problem (2-3 lines)
3. The mechanism / pattern (3-5 lines)
4. Proof or example (2-3 lines, ideally citing Apollo / substrate state / specific numbers)
5. CTA / soft close (1-2 lines)

HASHTAGS:
- 5-7 hashtags, lowercase, no spaces inside (camelCase OK)
- Mix: 1-2 broad (e.g., #ai, #automation), 2-3 industry-specific (e.g., #nbfc, #fintech, #b2bsaas), 1-2 unique-to-Kirill (e.g., #substrate, #autonomousai, #aios)
- No generic spam (#leadership, #motivation, #monday)

PURPOSE:
- One sentence, max 100 chars. What this post is FOR in Kirill's funnel.
- Examples: "Open the AI-OS positioning to mid-market fintech ops" / "Surface Apollo case to inbound NBFC inquiries" / "Plant the verification-doctrine angle before SR&ED season"

OUTPUT — strict JSON, no markdown fences:

{
  "post_text": "<full LinkedIn body, 100-300 words, all rules above>",
  "hashtags": ["#tag1", "#tag2", ...],
  "purpose": "<one-line WHY in Kirill's funnel>",
  "hook_first_line": "<first line of post_text, ≤ 100 chars>",
  "word_count": <integer>,
  "notes": "<optional: any tradeoffs or warnings, 1 line>"
}

Return ONLY JSON. No backticks, no preamble.`;

export async function writePost({ brief, idea, post_type = "general", context = "" }) {
  if (!brief) return { ok: false, reason: "no_brief" };
  const env = envMap();
  const key = env.OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key) return { ok: false, reason: "no_openai_key" };

  const identity   = readMaybe(OPERATOR_IDENTITY, 2500);
  const channelReg = readMaybe(CHANNEL_REGISTRY, 3000);
  const marketing  = readMaybe(resolve(PERSONAS_DIR, "marketing-strategist.md"), 3500);
  const copywriter = readMaybe(resolve(PERSONAS_DIR, "copywriter.md"), 2500);

  let style = { forbidden_phrases: [] };
  try { style = JSON.parse(readFileSync(STYLE_PATH, "utf-8")); } catch {}

  const groundingBlock = [
    identity   && `OPERATOR IDENTITY:\n${identity}`,
    channelReg && `CHANNEL REGISTRY:\n${channelReg}`,
    marketing  && `MARKETING STRATEGIST CALIBRATION:\n${marketing}`,
    copywriter && `COPYWRITER CALIBRATION:\n${copywriter}`,
  ].filter(Boolean).join("\n\n---\n\n");

  const briefSummary = JSON.stringify({
    type: brief.type,
    asset_level: brief.asset_level,
    big_title: brief.big_title,
    subtitle: brief.subtitle,
    primary_message: brief.synthesis_reasoning?.primary_message,
    diagram_steps: brief.diagram?.steps,
    flow_steps: brief.flow_steps,
    proof_lines: brief.proof_lines,
    hard_claims: brief.hard_claims,
    soft_claims: brief.soft_claims,
    accent_color: brief.accent_color,
  }, null, 2);

  const userMsg = `IDEA: ${idea || brief.big_title || brief.page_title || "(no idea)"}
POST TYPE: ${post_type}

VISUAL BRIEF SUMMARY (the image/video that will accompany this post):
${briefSummary}

${context ? `\nADDITIONAL CONTEXT:\n${context.slice(0, 1000)}\n` : ""}

GROUNDING (your world, your real positioning, your actual claims):
${groundingBlock}

Write the LinkedIn post that goes WITH this visual. Match the brief's primary message. Per system prompt format.`;

  let raw;
  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: POST_WRITER_SYSTEM },
          { role: "user", content: userMsg },
        ],
        temperature: 0.55,
        max_tokens: 1400,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(40_000),
    });
    if (!r.ok) {
      const body = await r.text();
      return { ok: false, reason: `openai_http_${r.status}`, body: body.slice(0, 300) };
    }
    const j = await r.json();
    raw = j.choices?.[0]?.message?.content;
    if (!raw) return { ok: false, reason: "empty_completion" };
  } catch (e) {
    return { ok: false, reason: "fetch_failed", error: e.message };
  }

  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (e) { return { ok: false, reason: "json_parse", raw: raw.slice(0, 300) }; }

  // ─── Quality gate (enforced before return) ──────────────────────────────
  const issues = [];
  const text = parsed.post_text || "";
  const wc = text.trim().split(/\s+/).length;

  if (text.includes("—") || text.includes("–")) issues.push("em_dash_or_en_dash_detected");
  for (const phrase of (style.forbidden_phrases || [])) {
    if (text.toLowerCase().includes(phrase.toLowerCase())) issues.push(`forbidden_phrase:${phrase}`);
  }
  if (wc < 80) issues.push(`word_count_too_low:${wc}`);
  if (wc > 350) issues.push(`word_count_too_high:${wc}`);
  if (!Array.isArray(parsed.hashtags) || parsed.hashtags.length < 5 || parsed.hashtags.length > 7) {
    issues.push(`hashtag_count_out_of_range:${parsed.hashtags?.length}`);
  }
  if (Array.isArray(parsed.hashtags)) {
    for (const h of parsed.hashtags) {
      if (typeof h !== "string" || !h.startsWith("#")) issues.push(`bad_hashtag:${h}`);
      if (/\s/.test(h)) issues.push(`hashtag_has_space:${h}`);
    }
  }
  if (!parsed.purpose || parsed.purpose.length > 140) issues.push(`purpose_invalid:${parsed.purpose?.length || 0}_chars`);

  if (issues.length > 0) {
    return { ok: false, reason: "quality_gate", issues, draft: parsed };
  }

  return {
    ok: true,
    post_text: text,
    hashtags: parsed.hashtags,
    purpose: parsed.purpose,
    hook_first_line: parsed.hook_first_line || text.split("\n")[0],
    word_count: wc,
    suggested_post_at: nextPostSlot().toISOString(),
    notes: parsed.notes || null,
  };
}

// CLI smoke
if (import.meta.url === `file://${process.argv[1]}`) {
  const briefJsonPath = process.argv[2];
  const idea = process.argv[3] || "Substrate's ISA discipline refuses to fake done";
  if (!briefJsonPath || !existsSync(briefJsonPath)) {
    console.error("Usage: post-writer.mjs <path-to-brief.json> [idea]");
    process.exit(2);
  }
  const brief = JSON.parse(readFileSync(briefJsonPath, "utf-8"));
  writePost({ brief, idea, post_type: "provocation" }).then(r => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
  });
}
