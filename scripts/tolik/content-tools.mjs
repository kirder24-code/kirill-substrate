/**
 * scripts/tolik/content-tools.mjs
 *
 * Tolik can WRITE content (posts, drafts, emails) using OpenAI, then
 * choose to: deliver via Telegram to Kirill for approval, draft into
 * Gmail compose, or save as file for later editing.
 *
 * Tools:
 *   content_draft({platform, topic, ...}) - generates post + optionally
 *                                            sends to Telegram for review
 *   content_save({path, content})          - save to file (sandboxed)
 *
 * Tolik already knows the operator's voice rules (no em dashes, no hype,
 * Russian "ты", bullets only for human DMs) from his persona block.
 * content_draft passes those rules into the OpenAI call.
 */

import { writeFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { openaiThink } from "./openai-think.mjs";
import { tg_send_to_me } from "./tg-tools.mjs";
import { getTolikPersonaBlock } from "./persona.mjs";
import { buildRetrievalBlock } from "./retrieval.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DRAFTS_DIR = resolve(ROOT, ".data/tolik-drafts");
const PERSONAS_DIR = resolve(ROOT, "scripts/survival/personas");
const CHANNEL_REGISTRY = resolve(ROOT, "scripts/survival/channel-registry.md");
const OPERATOR_IDENTITY = resolve(ROOT, "scripts/survival/operator-identity.md");

function readSubstrateFile(path, maxChars = 4000) {
  try {
    if (!existsSync(path)) return "";
    return readFileSync(path, "utf-8").slice(0, maxChars);
  } catch { return ""; }
}

const PLATFORM_RULES = {
  linkedin: "LinkedIn post. 800-1500 chars. Hook in first 2 lines (mobile preview). Concrete numbers > adjectives. No hashtag spam: 2-3 max at the very end. Plain text - no markdown bold/headers. Authentic voice of Kirill (AI architect, ex-Parliament, Calgary, building autonomous AI substrate).",
  threads:  "Threads post. 300-500 chars. Casual, voice-y. Short paragraphs. No corporate tone. No hashtags unless specifically relevant. Can use 1 emoji at most, only if it earns its place.",
  telegram_channel: "Telegram channel post for AI/tech audience. 400-800 chars. HTML formatting allowed (<b>, <i>, <a>). Hook, body, takeaway. No hype.",
  twitter_x: "X/Twitter post. Single tweet under 280 chars, or thread of 3-5 tweets. Each tweet stands alone. No threads unless content earns it. No hashtags.",
  reddit:   "Reddit comment or post. Match the subreddit's tone (research first). Lead with the substance, not the credentials. Markdown allowed.",
  email:    "Cold email. 80-130 words. Specific pain reference > generic intro. ONE clear CTA. No 'Hope this finds you well'. Sign-off: Kirill.",
};

export async function content_draft({ platform = "linkedin", topic, audience, style_notes, send_to_tg = true }) {
  if (!topic) return { ok: false, reason: "no_topic" };
  const platformRule = PLATFORM_RULES[platform] || PLATFORM_RULES.linkedin;
  const persona = getTolikPersonaBlock();

  // SUBSTRATE-AWARE CONTEXT: pull what substrate already knows about this
  // topic so the draft is grounded, not generic. Without this, content_draft
  // produces "вот пост про AI автоматизацию" — the same thing any LLM would
  // write for any consultant on Earth. With this, the draft cites Kirill's
  // actual ICP beliefs, his Apollo proof, his Calgary positioning.
  const retrieval = buildRetrievalBlock(topic);
  const marketingStrategist = readSubstrateFile(resolve(PERSONAS_DIR, "marketing-strategist.md"), 5000);
  const copywriter = readSubstrateFile(resolve(PERSONAS_DIR, "copywriter.md"), 3000);
  const channelRegistry = readSubstrateFile(CHANNEL_REGISTRY, 4000);
  const identity = readSubstrateFile(OPERATOR_IDENTITY, 2500);

  const system = `You are operating in two layers at once:

LAYER 1 — Senior B2B services marketing strategist (the persona from substrate, applied to THIS draft):
${marketingStrategist}

LAYER 2 — Senior B2B copywriter for Kirill's voice (applied to actual wording):
${copywriter || "(use Kirill's voice: calm, concrete, no em dashes, no hype words, writes from real experience)"}

OPERATOR IDENTITY (who is publishing this):
${identity}

CHANNEL REGISTRY (real channels Kirill operates, with market+audience+voice rules):
${channelRegistry}

${persona}

${retrieval}

PLATFORM RULES for THIS draft (${platform}):
${platformRule}

NON-NEGOTIABLE:
- Ground the post in Kirill's ACTUAL world from the GROUNDED FACTS above: cite his ICP beliefs (production AI agent operations gap, agent cost blowout, tool chain collapse, fintech AI signal), his Apollo Finvest proof, his Calgary SR&ED positioning. NEVER write generic "AI automation tips".
- Pick ONE specific angle from the GROUNDED FACTS. Do NOT do "intro to AI automation" or "case studies of automation" — those are filler.
- If platform requires multilingual or specific market positioning per channel-registry, follow that.
- One concrete claim with a number > five abstract benefits.
- Output ONLY the post body. No preamble. No "Here's the draft:". Just the text Kirill would copy-paste.`;
  const user = `Topic: ${topic}
${audience ? `Audience: ${audience}\n` : ""}${style_notes ? `Style notes: ${style_notes}\n` : ""}
Write the ${platform} post in Kirill's voice, grounded in his real positioning and the substrate beliefs above. Single specific angle, not a generic overview.`;

  const r = await openaiThink({
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    tools: [],
    tool_choice: "none",
    model: "gpt-4o",       // marketing copy quality > latency
    max_tokens: 900,
    caller: "content_draft",
  });
  if (!r.ok) return { ok: false, reason: "draft_failed", error: r.error };

  const draft = (r.content || "").trim();

  // Save to file regardless of TG choice
  if (!existsSync(DRAFTS_DIR)) mkdirSync(DRAFTS_DIR, { recursive: true });
  const slug = topic.toLowerCase().replace(/[^a-z0-9а-яё]+/gi, "-").slice(0, 60);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:.]/g, "-");
  const filePath = resolve(DRAFTS_DIR, `${platform}-${stamp}-${slug || "draft"}.md`);
  writeFileSync(filePath, `---\nplatform: ${platform}\ntopic: ${topic}\ndrafted_at: ${new Date().toISOString()}\n---\n\n${draft}\n`);

  let tg_result = null;
  if (send_to_tg) {
    const preview = draft.length > 3500 ? draft.slice(0, 3500) + "\n…(truncated, full в файле)" : draft;
    const tgText = `📝 <b>Черновик ${platform.toUpperCase()}</b>\n<i>Тема: ${topic}</i>\n\n${preview}\n\n📁 ${filePath.replace(ROOT + "/", "")}`;
    tg_result = await tg_send_to_me({ text: tgText });
  }
  return {
    ok: true,
    platform,
    topic,
    draft,
    chars: draft.length,
    file: filePath.replace(ROOT + "/", ""),
    tg_sent: tg_result?.ok || false,
    tg_message_id: tg_result?.message_id || null,
    cost_usd: r.cost_usd,
  };
}

/**
 * Direct call to one of the 10 specialist personas in scripts/survival/personas/.
 * Tolik can use this when the question is in a specialist's domain:
 *   - marketing-strategist  for content/positioning/channel strategy
 *   - copywriter            for actual writing
 *   - reddit-strategist     for Reddit DM/comment approach
 *   - telegram-strategist   for Telegram audience growth
 *   - sales-strategist      for closing strategy
 *   - pricing-strategist    for offer/rate decisions
 *   - prospecting-specialist for lead-list build
 *   - market-researcher     for market sizing/validation
 *   - partnership-strategist for partnership/affiliate plays
 *   - web-strategist        for site/SEO/conversion
 *
 * Adds substrate grounding (beliefs + identity) so the specialist answers
 * for KIRILL's actual world, not generic 2026 consultant.
 */
const VALID_SPECIALISTS = ["copywriter","market-researcher","marketing-strategist","partnership-strategist","pricing-strategist","prospecting-specialist","reddit-strategist","sales-strategist","telegram-strategist","web-strategist"];

export async function dispatch_to_specialist({ specialist, question, context }) {
  if (!specialist || !VALID_SPECIALISTS.includes(specialist)) {
    return { ok: false, reason: "unknown_specialist", available: VALID_SPECIALISTS };
  }
  if (!question) return { ok: false, reason: "no_question" };

  const personaText = readSubstrateFile(resolve(PERSONAS_DIR, `${specialist}.md`), 6000);
  const identity = readSubstrateFile(OPERATOR_IDENTITY, 2000);
  const retrieval = buildRetrievalBlock(question);
  const channelRegistry = (specialist === "marketing-strategist" || specialist === "reddit-strategist" || specialist === "telegram-strategist")
    ? readSubstrateFile(CHANNEL_REGISTRY, 3000)
    : "";

  const system = `You are now operating as the ${specialist.replace("-", " ").toUpperCase()} from substrate. The full persona instructions below ARE who you are.

${personaText}

OPERATOR IDENTITY (who you are advising):
${identity}

${channelRegistry ? `CHANNEL REGISTRY:\n${channelRegistry}\n\n` : ""}
${retrieval}

OUTPUT FORMAT:
- A concrete, executable answer Kirill can act on TODAY
- Ground every recommendation in the substrate beliefs above
- Use numbers where you have them
- NO em dashes, hyphens only
- NO generic platitudes ("focus on customer value", "leverage your strengths")
- If you reference a specific belief or opp, cite it briefly
- Maximum 600 words`;

  const r = await openaiThink({
    messages: [{ role: "system", content: system }, { role: "user", content: question + (context ? `\n\nAdditional context:\n${context}` : "") }],
    tools: [],
    tool_choice: "none",
    model: "gpt-4o",
    max_tokens: 1200,
    caller: `specialist_${specialist}`,
  });
  if (!r.ok) return { ok: false, reason: "specialist_failed", error: r.error };

  return {
    ok: true,
    specialist,
    question,
    answer: r.content,
    cost_usd: r.cost_usd,
  };
}

/**
 * Content Department interface — Tolik's way to interact with the new department.
 *
 * content_status()          — read .data/content/department-state.json
 * content_queue_add(args)   — enqueue an idea (any source: manual/voice/etc)
 * content_compose()         — force a tick (manual override)
 * content_recent({days})    — list recent assets with status + purpose
 */
export async function content_status() {
  try {
    const { readState, refreshState } = await import("../content/dept-state.mjs");
    // Always refresh on read so cached state matches reality
    const s = refreshState({ status_note: "tolik_status_query" }) || readState();
    if (!s) return { ok: false, reason: "state_unavailable" };
    return { ok: true, ...s };
  } catch (e) { return { ok: false, reason: "state_read_failed", error: e.message }; }
}

export async function content_queue_add({ idea, source = "manual", post_type = "general", asset_level = "static", recipe = null, priority = 3, context = null } = {}) {
  if (!idea) return { ok: false, reason: "no_idea" };
  try {
    const { enqueueContentIdea } = await import("../content/content-queue.mjs");
    return enqueueContentIdea({ source, idea, post_type, asset_level, recipe, priority, context });
  } catch (e) { return { ok: false, reason: "enqueue_failed", error: e.message }; }
}

export async function content_compose({ forceNow = true, autoDiscover = false } = {}) {
  try {
    const { tick } = await import("../content/content-orchestrator.mjs");
    return await tick({ forceNow, autoDiscover, dryRun: false });
  } catch (e) { return { ok: false, reason: "compose_failed", error: e.message }; }
}

export async function content_regen({ asset_id, force_template = null, force_accent = null } = {}) {
  if (!asset_id) {
    // No specific asset → process whole regen queue
    try {
      const { processRegenQueue } = await import("../content/content-orchestrator.mjs");
      return await processRegenQueue();
    } catch (e) { return { ok: false, reason: "process_queue_failed", error: e.message }; }
  }
  try {
    const { regenAsset } = await import("../content/content-orchestrator.mjs");
    return await regenAsset(asset_id, { force_template, force_accent });
  } catch (e) { return { ok: false, reason: "regen_failed", error: e.message }; }
}

export async function content_recent({ days = 7, limit = 10 } = {}) {
  try {
    const { listRecent } = await import("../content/content-store.mjs");
    const rows = listRecent({ days, limit });
    return {
      ok: true,
      count: rows.length,
      items: rows.map(r => ({
        id: r.id,
        slug: r.slug,
        created_at: r.created_at,
        asset_level: r.asset_level,
        template_type: r.template_type,
        status: r.status,
        purpose: r.purpose,
        idea_source: r.idea_source,
        suggested_post_at: r.suggested_post_at,
        big_title: (r.brief?.big_title || r.idea_text || "").slice(0, 100),
      })),
    };
  } catch (e) { return { ok: false, reason: "recent_read_failed", error: e.message }; }
}

export async function content_save({ path, content }) {
  if (!path || typeof content !== "string") return { ok: false, reason: "need_path_and_content" };
  // Sandbox: only allow saves under .data/, dashboard/, apps/, scripts/tolik/personal-facts.md
  const abs = resolve(ROOT, path);
  const ALLOWED_PREFIXES = [
    resolve(ROOT, ".data"),
    resolve(ROOT, "dashboard"),
    resolve(ROOT, "apps"),
    resolve(ROOT, "scripts/tolik"),
  ];
  if (!ALLOWED_PREFIXES.some(p => abs.startsWith(p + "/") || abs === p)) {
    return { ok: false, reason: "path_not_in_allowed_sandbox", allowed: ALLOWED_PREFIXES.map(p => p.replace(ROOT + "/", "")) };
  }
  try {
    if (!existsSync(dirname(abs))) mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
    return { ok: true, path: abs.replace(ROOT + "/", ""), bytes: Buffer.byteLength(content) };
  } catch (e) { return { ok: false, reason: "write_failed", error: e.message }; }
}
