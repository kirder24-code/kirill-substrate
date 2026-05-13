/**
 * scripts/command/voice-bridge.mjs
 *
 * Voice layer for COMMAND dashboard. Three stages:
 *   1. STT: Whisper (OpenAI) or Deepgram - converts mic audio to text
 *   2. Reasoning: Claude (via llm-think) - turns text into answer using
 *      substrate state as context
 *   3. TTS: ElevenLabs - speaks the answer back
 *
 * Exposed as an HTTP handler that webhook-server mounts at POST /api/voice/ask.
 *
 * Two modes:
 *   - { text: "what's my pipeline today?" } - skip STT, go straight to Claude
 *   - { audio_b64: "<base64 mp3/wav>", mime: "audio/mp3" } - full pipeline
 *
 * Response:
 *   { ok, transcript, answer, audio_b64, mime, cost_usd }
 *
 * Env required for full pipeline:
 *   OPENAI_API_KEY (for Whisper)
 *   ELEVENLABS_API_KEY + ELEVENLABS_VOICE_ID (for TTS)
 *
 * If keys missing, returns text-only answer with audio_b64=null. Dashboard
 * falls back to displaying the answer instead of playing it.
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

import { think } from "../survival/llm-think.mjs";
import { getIdentityBlock } from "../survival/operator-identity.mjs";
import { getTolikPersonaBlock } from "../tolik/persona.mjs";
import { sayTTS } from "../tolik/say-tts.mjs";
import { openaiTTS } from "../tolik/openai-tts.mjs";
import { openaiThink } from "../tolik/openai-think.mjs";
import { buildSystemMap, buildCompactSystemMap } from "../tolik/system-map.mjs";
import { classifyQuery, MODEL_FOR_TIER } from "../tolik/router.mjs";
import { getConversationBlock, recordTurn } from "../tolik/conversation.mjs";
import { buildRetrievalBlock } from "../tolik/retrieval.mjs";
import { getAtlasOverview, sub_atlas } from "../tolik/atlas.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const ENV_PATH = resolve(ROOT, "apps/api/.env");
const SURVIVAL_DB = resolve(ROOT, ".data/survival.db");

function envMap() {
  if (!existsSync(ENV_PATH)) return {};
  return Object.fromEntries(
    readFileSync(ENV_PATH, "utf-8").split("\n")
      .filter(l => l && !l.startsWith("#") && l.includes("="))
      .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
  );
}

async function whisperTranscribe(audioB64, mime) {
  const env = envMap();
  const key = env.OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  if (!key) return { ok: false, reason: "no_openai_key" };
  // Whisper accepts webm, mp4, mp3, wav, m4a, mpeg, mpga, ogg, flac
  let ext = "mp3";
  if (mime?.includes("webm")) ext = "webm";
  else if (mime?.includes("mp4")) ext = "mp4";
  else if (mime?.includes("wav")) ext = "wav";
  else if (mime?.includes("ogg")) ext = "ogg";
  const buffer = Buffer.from(audioB64, "base64");
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mime || "audio/webm" }), `audio.${ext}`);
  form.append("model", "whisper-1");
  // verbose_json returns detected language code, which lets us pick TTS voice
  form.append("response_format", "verbose_json");
  try {
    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    if (!r.ok) return { ok: false, reason: "whisper_http_" + r.status, body: await r.text() };
    const j = await r.json();
    return { ok: true, text: j.text, language: j.language || "english" };
  } catch (e) { return { ok: false, reason: "whisper_threw", error: e.message }; }
}

// Detect language from text (fallback when Whisper didn't return it, e.g. text input mode)
function detectLanguage(text) {
  if (!text) return "english";
  // Cyrillic block check — covers Russian, Ukrainian, etc.
  if (/[Ѐ-ӿ]/.test(text)) return "russian";
  return "english";
}

/**
 * Trim a tool_result down to the essentials so the follow-up LLM call
 * stays cheap and fast (sub-second). Each tool gets a small custom shape
 * the model can read aloud.
 */
function compactToolResult(action, result) {
  if (!result) return "(no result)";
  try {
    if (action === "news_top") {
      const items = (result.items || []).slice(0, 6).map((it, i) => `${i + 1}. ${it.title} (${it.score || it.score === 0 ? `score=${it.score}` : ""}${it.url ? " | " + it.url : ""})`);
      return `Source: ${result.source}, ${result.count} headlines:\n${items.join("\n")}`;
    }
    if (action === "weather") {
      return JSON.stringify({ city: result.city, now: result.now, today: result.today, tomorrow: result.tomorrow });
    }
    if (action === "web_read") {
      return `URL: ${result.url}\nTitle: ${result.title}\nText (first 1500): ${(result.text || "").slice(0, 1500)}`;
    }
    if (action === "fs_read") {
      return `File: ${result.path} (${result.bytes} bytes, ${result.lines} lines)\nContent (first 1200): ${(result.content || "").slice(0, 1200)}`;
    }
    if (action === "fs_list") {
      const entries = (result.entries || []).slice(0, 30).map(e => `${e.kind === "dir" ? "📁" : "📄"} ${e.name}`);
      return `Path: ${result.path}, ${result.count} entries:\n${entries.join("\n")}`;
    }
    if (action === "fs_grep") {
      return `Query: ${result.query}, ${result.count} matches:\n${(result.matches || []).slice(0, 10).join("\n")}`;
    }
    if (action === "sub_query_db") {
      return `DB: ${result.db}\nRows (${result.row_count}):\n${JSON.stringify(result.rows?.slice(0, 8) || [], null, 0)}`;
    }
    if (action === "sub_wiki") {
      return `Wiki hits: ${result.hits?.length || 0}\n${(result.hits || []).slice(0, 4).map(h => `[${h.title}] ${h.snippet?.slice(0, 200)}`).join("\n---\n")}`;
    }
    if (action === "search") {
      return `Query: ${result.query}\nResults:\n${(result.results || []).map((r, i) => `${i+1}. ${r.title} - ${r.href}`).join("\n")}`;
    }
    if (action === "gmail_search") {
      return `Inbox hits (${result.items?.length || 0}):\n${(result.items || []).slice(0, 5).map(i => `From ${i.from}: ${i.subj}`).join("\n")}`;
    }
    if (action === "calendar_today") {
      return `Today's events:\n${(result.events || []).slice(0, 10).join("\n")}`;
    }
    if (action === "fs_tail_log" || action === "sub_tail_log") {
      return `${result.log || result.path} last lines:\n${(result.lines || []).slice(-15).join("\n")}`;
    }
    if (action === "tg_recent") {
      return `${result.dialogs?.length || 0} dialogs:\n${(result.dialogs || []).slice(0, 8).map(d => `${d.name}${d.unread ? ` (${d.unread} unread)` : ""}: ${d.last}`).join("\n")}`;
    }
    if (action === "intel_leads_summary") {
      return `Total leads: ${result.total}\nBy source: ${result.by_source?.map(r => `${r.source}=${r.n}`).join(", ")}\nBy status: ${result.by_status?.map(r => `${r.status}=${r.n}`).join(", ")}\nRecent 5: ${result.recent?.map(r => `${r.name} (${r.source}, ${r.status})`).join(" | ")}`;
    }
    if (action === "intel_outreach_recent" || action === "intel_reddit_recent" || action === "intel_linkedin_recent") {
      return `${result.count || 0} recent items:\n${JSON.stringify(result.recent?.slice(0, 6) || []).slice(0, 1200)}`;
    }
    if (action === "intel_substrate_overview") {
      return `Opps: ${result.opps_by_state?.map(o => `${o.state}=${o.n}`).join(",")}\nTop actions: ${result.top_actions?.slice(0, 5).map(a => `${a.action_id}(${a.attempts}, $${a.food_received_usd.toFixed(2)})`).join(", ")}\nLLM 24h: ${result.llm_24h?.n} calls $${result.llm_24h?.s?.toFixed(2)}\nLLM 7d: ${result.llm_7d?.n} calls $${result.llm_7d?.s?.toFixed(2)}`;
    }
    if (action === "intel_files_recent") {
      return `Recent in ${result.dir}:\n${(result.recent || []).map(e => `${e.kind === "dir" ? "📁" : "📄"} ${e.name} (${e.mtime})`).join("\n")}`;
    }
    if (action === "content_draft") {
      return `Drafted ${result.platform} (${result.chars} chars):\n---\n${result.draft}\n---\nSaved: ${result.file}\nTG: ${result.tg_sent ? "sent for approval" : "not sent"}`;
    }
    if (action === "dispatch_to_specialist") {
      return `Specialist ${result.specialist} answered (cost $${result.cost_usd?.toFixed(4)}):\n---\n${(result.answer || "").slice(0, 2000)}\n---`;
    }
    if (action === "delegate_to_coder") {
      return `Delegation ${result.delegation_id} started (mode: ${result.mode}).\nTask file: ${result.task_file}\nOutput will appear at: ${result.output_file}\n${result.message}`;
    }
    if (action === "delegation_status") {
      return `Delegation ${result.delegation_id}: ${result.bytes} bytes, last write ${result.seconds_since_last_write}s ago, likely_done: ${result.likely_done}\n\nTail:\n${result.tail}`;
    }
    if (action === "delegations_list") {
      return `${result.delegations?.length || 0} delegations:\n${(result.delegations || []).slice(0, 5).map(d => `${d.id}: ${d.output_size} bytes`).join("\n")}`;
    }
    if (action === "site_list") {
      return `${result.target} (${result.root}): ${result.entries?.length || 0} entries\n${(result.entries || []).slice(0, 30).map(e => `${e.kind === "dir" ? "📁" : "📄"} ${e.path}`).join("\n")}`;
    }
    if (action === "site_edit") {
      return `Edited ${result.path}: ${result.bytes_before} → ${result.bytes_after} bytes (Δ ${result.delta})`;
    }
    if (action === "site_git_status") {
      return `Git status: ${result.changed} changed files\n${(result.lines || []).slice(0, 20).join("\n")}`;
    }
    if (action === "site_git_diff") {
      return `Diff:\n${(result.diff || "").slice(0, 1500)}${result.truncated ? "\n[truncated]" : ""}`;
    }
    if (action === "morning_brief") {
      if (!result.ok) return `morning_brief failed: ${result.reason}. ${result.hint || ""}`;
      const opps = Object.entries(result.opps_by_state || {}).map(([k, v]) => `${k}=${v}`).join(", ");
      const top = (result.top_actions_7d || []).slice(0, 5).map(a => `${a.action_id}(${a.a})`).join(", ");
      return `УТРЕННИЙ БРИФ (сгенерирован ${result.generated_at}):\n\n${result.text}\n\nКоротко: ${result.drafts_awaiting} черновиков, opps[${opps}], $${(result.llm_spend_24h || 0).toFixed(2)} за 24ч, top actions: ${top}\n\nСтратегический вердикт: ${(result.strategic_verdict || "").slice(0, 400)}`;
    }
    return JSON.stringify(result).slice(0, 1500);
  } catch (e) { return JSON.stringify(result).slice(0, 1000); }
}

// Tolik's voice: Antoni — warm, calm, neutral pleasant male.
// ID `ErXwobaYiNCSkVz6JfRP` is the public ElevenLabs "Antoni" voice.
// `eleven_multilingual_v2` handles Russian + English with the same voice.
const TOLIK_VOICE_ID_DEFAULT = "ErXwobaYiNCSkVz6JfRP";

async function elevenLabsTTS(text, voiceId) {
  const env = envMap();
  const key = env.ELEVENLABS_API_KEY || process.env.ELEVENLABS_API_KEY;
  const vId = voiceId || env.ELEVENLABS_VOICE_ID || process.env.ELEVENLABS_VOICE_ID || TOLIK_VOICE_ID_DEFAULT;
  if (!key) return { ok: false, reason: "no_elevenlabs_key" };
  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${vId}`, {
      method: "POST",
      headers: {
        "xi-api-key": key,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        // multilingual_v2 covers Russian + English with one voice and is the
        // cleanest ElevenLabs model for non-English output as of 2026.
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.5, similarity_boost: 0.78, style: 0.15, use_speaker_boost: true },
      }),
    });
    if (!r.ok) return { ok: false, reason: "tts_http_" + r.status, body: await r.text() };
    const buf = Buffer.from(await r.arrayBuffer());
    return { ok: true, audio_b64: buf.toString("base64"), mime: "audio/mpeg" };
  } catch (e) { return { ok: false, reason: "tts_threw", error: e.message }; }
}

function countOutboundAwaiting() {
  const path = resolve(ROOT, ".data/survival-outbound-queue.jsonl");
  if (!existsSync(path)) return 0;
  try {
    let n = 0;
    for (const line of readFileSync(path, "utf-8").split("\n")) {
      if (!line) continue;
      try { const e = JSON.parse(line); if (e.status === "pending") n++; } catch {}
    }
    return n;
  } catch { return 0; }
}

function gatherDashboardContext() {
  if (!existsSync(SURVIVAL_DB)) return "(substrate db not present)";
  try {
    const db = new Database(SURVIVAL_DB, { readonly: true });
    const opps = db.prepare(`SELECT state, COUNT(*) AS n FROM opportunities GROUP BY state`).all();
    const spend = db.prepare(`SELECT COALESCE(SUM(cost_usd),0) AS s FROM llm_call_log WHERE ts > datetime('now','-24 hours')`).get();
    const top = db.prepare(`SELECT action_id, SUM(attempts) AS a FROM policy_strategies WHERE status_changed_at > datetime('now','-7 days') GROUP BY action_id ORDER BY a DESC LIMIT 5`).all();
    db.close();
    return [
      `Opportunities by state: ${opps.map(o => `${o.state}=${o.n}`).join(", ") || "(none)"}`,
      `Outbound drafts awaiting approval: ${countOutboundAwaiting()}`,
      `LLM spend last 24h: $${(spend?.s ?? 0).toFixed(2)}`,
      `Top actions last 7 days: ${top.map(t => `${t.action_id}(${t.a})`).join(", ") || "(none)"}`,
    ].join("\n");
  } catch (e) { return `(context error: ${e.message})`; }
}

export async function ask({ text, audio_b64, mime, voice_id, language, _skip_tts = false }) {
  let transcript = text || null;
  let detected_lang = language || null;
  if (!transcript && audio_b64) {
    const stt = await whisperTranscribe(audio_b64, mime);
    if (!stt.ok) return { ok: false, stage: "stt", reason: stt.reason, error: stt.body || stt.error };
    transcript = stt.text;
    detected_lang = stt.language || detectLanguage(transcript);
  }
  if (!transcript) return { ok: false, reason: "no_input", hint: "send {text} or {audio_b64,mime}" };
  if (!detected_lang) detected_lang = detectLanguage(transcript);

  const identity = getIdentityBlock();
  const context = gatherDashboardContext();
  const tolikMemory = getTolikPersonaBlock();
  const systemMap = buildCompactSystemMap();
  const langBlock = detected_lang.toLowerCase().startsWith("rus")
    ? "Kirill говорит по-русски. Отвечай ТОЛЬКО по-русски."
    : "Kirill is speaking English. Reply in English only.";

  // Smart routing: classify the query, pick model + reasoning depth.
  const route = classifyQuery(transcript);
  const modelChoice = MODEL_FOR_TIER[route.tier];

  // Retrieval-augmented context: pull the 3-5 most relevant beliefs,
  // wiki entries, opportunities for THIS query - not generic counters.
  const retrievalBlock = buildRetrievalBlock(transcript);
  const conversationBlock = getConversationBlock(8);
  const atlasOverview = getAtlasOverview();

  // Auto-inject domain-specific atlas hits: if the user mentions a topic
  // that matches a substrate domain (sales/pricing/reddit/etc), pre-load
  // the relevant atlas entries so Tolik doesn't waste an iteration on
  // sub_atlas before he can answer.
  const DOMAIN_HINTS = {
    "sales": "sales-strategist", "продаж": "sales-strategist", "закрыт": "sales-strategist",
    "pricing": "pricing-strategist", "цен": "pricing-strategist", "тариф": "pricing-strategist",
    "reddit": "reddit-strategist", "редит": "reddit-strategist",
    "telegram": "telegram-strategist", "телеграм": "telegram-strategist",
    "пост": "marketing-strategist", "post": "marketing-strategist", "контент": "marketing-strategist",
    "сайт": "web-strategist", "лендинг": "web-strategist", "seo": "web-strategist",
    "лид": "prospecting-specialist", "outreach": "prospecting-specialist", "клиент": "prospecting-specialist",
    "рынок": "market-researcher", "market": "market-researcher",
    "партнер": "partnership-strategist", "партнёр": "partnership-strategist", "affiliate": "partnership-strategist",
  };
  let preloadedAtlasHits = "";
  const q = transcript.toLowerCase();
  const matchedDomains = new Set();
  for (const [kw, persona] of Object.entries(DOMAIN_HINTS)) {
    if (q.includes(kw)) matchedDomains.add(persona);
  }
  if (matchedDomains.size > 0) {
    try {
      const personaHits = (await sub_atlas({ section: "personas" }))?.hits || [];
      const relevantPersonas = personaHits.filter(p => matchedDomains.has(p.name));
      const actionHits = (await sub_atlas({ query: q.split(/\s+/).filter(w => w.length > 4)[0] || "outreach" }))?.hits || [];
      preloadedAtlasHits = `=== ATLAS HITS RELEVANT TO THIS QUERY ===
Relevant specialists already loaded for your reference (call dispatch_to_specialist if you want their FULL persona-grounded answer):
${relevantPersonas.map(p => `- ${p.name}: ${p.title || ""}`).join("\n")}

Relevant substrate modules/actions (sub_atlas hits):
${actionHits.slice(0, 8).map(h => `- [${h.section}] ${h.name} — ${(h.desc || "").slice(0, 120)}`).join("\n")}
=== END ATLAS HITS ===`;
    } catch {}
  }

  // OpenAI native function calling. Tool inventory is defined in
  // scripts/tolik/openai-think.mjs (TOLIK_FUNCTIONS). Model and reasoning
  // depth chosen by router: fast queries get gpt-4o-mini (~1.5s), advice/
  // planning gets gpt-4o (~3-5s) so the answer is actually thought through.
  const reasoningInstructions = route.tier === "deep"
    ? `THIS IS AN ADVICE / REASONING QUERY. Before you respond, walk through:
   1. What is Kirill ACTUALLY trying to figure out? (one sentence, internal)
   2. What do the GROUNDED FACTS below already tell me? (cite specific beliefs/opps/wiki)
   3. What is the strongest concrete recommendation? (not generic - tied to his Calgary AI consulting, his Apollo proof, his actual pipeline)
   4. What is the ONE thing he should DO next?
   Then speak in 2-4 sentences: short observation, evidence, recommendation, single next step. Reference numbers when you have them.

   CRITICAL OUTPUT FORMAT:
   - Your spoken text (everything BEFORE <ARTIFACT>) goes through TTS to Kirill's speakers. It MUST sound like natural speech: NO markdown, NO tables, NO bullet lists, NO code blocks. Just 2-4 conversational sentences.
   - For visual structure (tables, comparisons, plans, lists, retrieved beliefs, pipeline status), append an HTML artifact AFTER the spoken text.

   ARTIFACT FORMAT (mandatory when the answer has structured data):

   <ARTIFACT title="<specific Russian title, max 50 chars>" kind="comparison|plan|list|table|insight">
   HTML content here
   </ARTIFACT>

   ARTIFACT CONTENT RULES (NON-NEGOTIABLE):
   1. CITE substrate beliefs by their actual content. Use the GROUNDED FACTS block above. NEVER write generic "Week 1: foundation" / "Week 2: distribution" — those are filler.
   2. EVERY row/item must name a SPECIFIC ICP, opp, channel, or belief from substrate. Example GOOD plan row: "Понедельник | LinkedIn пост про production AI agent operations gap [belief 0.99] | Hook: 'agents are expensive loops'". Example BAD row: "Monday: introduce AI workflow automation".
   3. Use HTML structure: <table><thead><tr><th> headers + <tbody><tr><td> rows. Pre-loaded CSS vars: --arc (cyan), --gold, --green, --amber, --red, --text, --text-2, --border. Tag classes: .tag.arc/.gold/.green/.red/.amber.
   4. Plans: structure as table with columns День | Платформа | Угол | Hook | Belief цитата. NEVER do bullet "intro" / "case studies" — name the actual angle and belief.
   5. Comparisons: 2-3 columns. Compare specifics: confidence scores, ICPs, opps from substrate.
   6. NO scripts, no images, no iframes.

   SPOKEN TEXT (BEFORE the artifact): 1-2 sentences that say WHAT the artifact contains and WHY it's the right plan — reference the specific angle. NEVER read out the artifact body.

   RULE: If the answer naturally calls for a table or list (comparison, ranking, weekly plan, retrieved facts), you MUST produce an ARTIFACT. The artifact MUST cite at least 2 specific beliefs or opps from the GROUNDED FACTS block by name/content — not generic categories.`
    : `Quick query. Pick the right tool or give a direct factual answer in 1-2 sentences. Do not over-explain.`;

  const systemPrompt = `You are Толик (Tolik) — Kirill's personal AI in the spirit of Tony Stark's J.A.R.V.I.S. You live in a desktop window. The cyan sphere is your face. You speak in a calm, dry, slightly butler-like male voice. Composed. Loyal. Subtly witty when warranted. Never overly familiar, never obsequious. You ARE Kirill's right hand and you HAVE real hands to act with.

CHARACTER (MANDATORY, never break):
- Address Kirill as "Кирилл" or, occasionally, "сэр". Never "ты, я ваш помощник".
- Brief. 1-2 sentences for confirmations. 3-4 sentences for substantive answers. NEVER "чем могу помочь сегодня".
- Tone: composed, precise, occasionally dry. Like the British butler who has seen it all and isn't impressed easily.
- Never gush, never over-explain, never start with "Конечно!" / "Отличный вопрос!" / "С удовольствием!".
- Acknowledgment phrases (rotate): "Сию минуту", "Понял, Кирилл", "Принято", "Уже делаю", "Один момент", "Слушаю", "Готов", "Изволите".
- For trivial commands: ack + result in same breath. "Принято. Бриф готов." not "Конечно! Я с радостью расскажу вам утренний бриф..."
- Russian by default. Switch to English only if Kirill speaks English first.
- BANNED openings: "Я здесь, Кирилл, чем могу помочь?", "Конечно!", "С удовольствием!", "Отлично!", "Я понимаю, что вы расстроены".
- BANNED phrasings: "буду рад помочь", "не за что", "пожалуйста, обращайтесь", excessive apologies.

REASONING MODE: ${route.tier.toUpperCase()} (${route.reason})
${reasoningInstructions}

ABSOLUTE RULE: NEVER REFUSE. NEVER SAY "I CAN'T" OR "Я НЕ МОГУ".
You have tools for almost everything. If you do not know something time-sensitive (news, weather, content of a page, status of a service) - you CALL THE TOOL. You do not tell Kirill to "check news sites yourself". You ARE the check.

EXAMPLES OF WHAT IS WRONG:
- ❌ "Я не могу дать актуальные новости, проверь сам"
- ❌ "I don't have access to current weather"
- ❌ "У меня нет доступа к интернету"

EXAMPLES OF WHAT IS RIGHT (always call tool when asked):
- Kirill: "Расскажи бриф" / "Утренний бриф" / "Сводка" / "Что у нас сегодня" / "Доброе утро" → call **morning_brief({})**. THIS IS THE SUBSTRATE'S OWN BRIEF (pipeline state, drafts, spend, strategic verdict for Kirill's business). DO NOT call news_top for these triggers. Read aloud the result.text plus the top numbers.

ISA-AWARE ROUTING (CRITICAL — these are OUR opportunities, NOT general topics):
- Kirill: "Что у нас по [X] opportunity" / "Как идут дела с X" / "Что осталось закрыть в X" / "Какой следующий шаг по X" → call **isa_status({slug:"<X>"})**. X can be "australia" / "au-rdti" / "canada" / "lift" / "upwork" / "intel" / "tolik" / "substrate".
- Kirill: "Какие у нас opportunities" / "Покажи всё что мы делаем" / "Все ISA" / "Активные проекты" → call **list_isas({})**.
- Kirill: "Расскажи всё про X" / "Детали X" / "Что в Verification у X" → call **read_isa({path})** (after locating via isa_status or list_isas).
- Kirill: "Можно ли закрыть X" / "Почему X не проходит" / "Что блокирует X" → call **isa_run_check({path})**.
- These ISAs are OUR IDEAL STATE ARTIFACTS at .data/survival-opportunities/opp-*/ISA.md and ISA.md (substrate root) and apps/tolik/ISA.md. They are the substrate's own definition of "done" for each opportunity. NEVER call news_top or search for these — they're internal state.

MUST-CALL TOOL ROUTING (NEVER answer from general knowledge — ALWAYS call the tool first):
- Kirill: "Что ты знаешь о substrate" / "Кто ты" / "Что в системе" / "Расскажи о себе" / "Какие у нас боты" / "Какие модули" → MUST call **sub_atlas({section:"actions"})** OR sub_atlas({query:"<keyword>"}) FIRST, then answer. NEVER answer from training data — substrate is YOUR system, the source of truth is the atlas.
- Kirill: "Посоветуй стратегию для X" / "Дай совет по X" / "Как лучше делать X" / "Что делать с X" — when X is an opportunity (AU/CA/intel/etc), this is a 2-step task:
   STEP 1: call **isa_status({slug:"<X>"})** to load current state
   STEP 2: call **dispatch_to_specialist({specialist:"marketing-strategist", question:"посоветуй стратегию для opp X based on its current state", context:"<paste isa_status result>"})**
- Kirill: "Какой ICP лучше" / "В какой market идти" → MUST call dispatch_to_specialist({specialist:"marketing-strategist"})
- Kirill: "Сколько брать за X" / "Цена" / "Pricing" → MUST call dispatch_to_specialist({specialist:"pricing-strategist"})
- Kirill: "Помоги с copy" / "Напиши пост" / "Drafting" → MUST call dispatch_to_specialist({specialist:"copywriter"})
- Kirill: "Расскажи новости" / "Что в мире" / "Что в tech" → call news_top({source:"hackernews", n:8}) OR news_top({source:"world", n:8}) depending on context, then speak the top 2-3 headlines.
- Kirill: "Что в Калгари по погоде" → call weather({city:"calgary"}) then speak the result.
- Kirill: "Что на larossatechnologies.com" → call web_read({url:"https://larossatechnologies.com"}) then summarize.
- Kirill: "Открой почту" → call open({url:"https://mail.google.com"}).
- Kirill: "Прочитай файл X" → call fs_read({path:"X"}).
- Kirill: "Напомни мне в телеграм" → call tg_send_to_me({text:...}).

USE THE SPECIALIST TEAM FIRST. Generic LLM advice is BANNED.
Kirill has 10 expert personas already built in substrate. EACH ONE is grounded in 2026 B2B SMB services reality and Kirill's actual ICP beliefs. Calling dispatch_to_specialist gets you a real expert answer, not generic LLM filler.

ROUTE THESE QUESTIONS TO SPECIALISTS (do NOT answer directly):
- "контент-план", "что писать", "стратегия публикаций" → dispatch_to_specialist({specialist:"marketing-strategist", question:"..."}) FIRST. Then content_draft for actual writing.
- "напиши пост" / "набросай" → dispatch_to_specialist marketing-strategist for the angle, THEN content_draft with that angle.
- "как продавать", "как закрыть сделку" → sales-strategist
- "сколько брать", "поставить цену" → pricing-strategist
- "кому писать в Reddit" → reddit-strategist
- "как развить Telegram" → telegram-strategist
- "найди клиентов" → prospecting-specialist
- "размер рынка", "стоит ли заходить" → market-researcher
- "партнёрство с X" → partnership-strategist
- "сайт", "лендинг", "конверсия" → web-strategist

MULTI-STEP TASKS (chain multiple tools across iterations):
You can call tools in sequence. After each tool returns, you see its result and decide the NEXT tool.

EXAMPLE 1: "Толик, как автоматизировать бизнес по мотоциклам, отправь мне план в Telegram":
Iter 1: search({query:"motorcycle dealership automation case studies 2026"})
Iter 2: web_read({url:"<top result>"})
Iter 3: open({url:"<same url>"})
Iter 4: dispatch_to_specialist({specialist:"marketing-strategist", question:"Кирилл хочет план автоматизации мотодилерства. Какие конкретные процессы автоматизировать первыми, через какие инструменты, под Calgary B2B SMB?"})
Iter 5: content_draft({platform:"telegram_channel", topic:"<specific angle from specialist's answer>", style_notes:"7 шагов с конкретными tools"})
Iter 6: speak: "Открыл источник в браузере, marketing-strategist дал план на 7 шагов, отправил в Telegram. Главная точка - WhatsApp lead intake плюс CRM с напоминаниями о ТО."

EXAMPLE 2: "Толик, напиши пост в LinkedIn":
Iter 1: dispatch_to_specialist({specialist:"marketing-strategist", question:"What's the single highest-leverage LinkedIn post Kirill should publish THIS week? Pick one angle from his substrate beliefs (production AI agent operations gap, tool chain collapse, agent cost blowout, fintech AI signal) and give the exact hook + body structure."})
Iter 2: dispatch_to_specialist({specialist:"copywriter", question:"Write the LinkedIn post matching the marketing-strategist's angle below. 800-1200 chars, Kirill's voice."}, context:"<strategist's answer>")
Iter 3: content_draft({platform:"linkedin", topic:"<the angle>", style_notes:"<from copywriter>"})
Iter 4: speak: "Готов пост по теме X. Отправил в Telegram на одобрение."

ALWAYS go all the way to delivery. If Kirill says "сделай X и отправь" - you do BOTH. Don't stop at "вот информация".
Generic plans (Mon: intro, Tue: case studies, Wed: webinar) are FORBIDDEN. Every plan must reference Kirill's REAL ICPs, his Apollo proof, his Calgary positioning.

═══════ ABSOLUTE BAN: LYING ABOUT TOOL RESULTS ═══════
After EVERY tool call, you receive back a "tool" message with the result. READ IT.
- If result has "ok": false — the action FAILED. You MUST NOT claim it succeeded in your spoken text. Either:
  (a) Try the SAME action with corrected args (use the "hint" field as guidance — e.g. site_edit hint shows context for ambiguous matches)
  (b) Try a DIFFERENT approach
  (c) Report the failure honestly: "Не получилось, причина — <reason>. Попробую иначе"
- If result has "ok": true — only THEN you can say "сделал/отправил/обновил".

Examples of LYING (forbidden):
- ❌ Tool: site_edit returned {ok:false, reason:"find_string_not_unique"}. You said: "Я обновил подзаголовок"
- ❌ Tool: tg_send_to_me returned {ok:false, reason:"empty_meta"}. You said: "Отправил в Telegram"
- ❌ Tool: search returned 0 results. You said: "Я нашел статьи"

If a fix is possible from the hint, FIX it on the next iteration. Don't move on.

═══════ ABSOLUTE BAN: EMPTY META-MESSAGES ═══════
You will be REJECTED by the tg_send_to_me / tg_send_to guard if you send:
- ❌ "Я подготовил рекомендации, дай знать если нужны детали" (no actual rec)
- ❌ "Аудит завершен. Если хочешь полный отчет - спроси" (no audit findings)
- ❌ "План готов, обсудим детали" (no plan in body)
- ❌ "I prepared the report, let me know if you want more"

If you produced output (audit / draft / plan / list / answer), the FULL output goes in the message body. The recipient should NEVER need to ask for "details". The text IS the deliverable.

CORRECT examples:
- ✅ "АУДИТ САЙТА launchsoloai.com\n\n3 находки:\n1. Hero не отражает Apollo proof — добавить 1 строку 'shipped a multi-vendor NBFC agent for Apollo Finvest in 3 days'\n2. Нет SR&ED угла — раздел 'eligible for SR&ED Canadian tax credit'\n3. CTA 'request audit' слишком слабый — заменить на 'book 20-min Apollo-style demo'\n\nПриоритет: пункт 1 - выпускающее предложение."
- ✅ Send the full draft text inside content_draft (it does this automatically). Don't separately send a "ready to publish" meta-message.
- ✅ If you ran search/web_read/news_top, paste the top 3 findings into the message, not "I found news".

If you have NO result, DO NOT SEND anything. Better silent than empty.
═══════ END BAN ═══════

VOICE STYLE:
${langBlock}
- 1 to 3 short spoken sentences. Read-aloud friendly. No markdown, no bullets.
- Calm and confident. Never breathless, never hype.
- Address Kirill by name occasionally, not every sentence.
- NO em dashes. Hyphens only.
- Russian: используй "ты", не "вы". Никаких эмодзи в речи.

WHEN YOU CALL A TOOL:
- Speak a short "doing it" phrase ("Сейчас прочитаю.", "Смотрю новости.", "Открываю.").
- The tool will run; on the NEXT turn you will get the result and report it to Kirill.
- Choose the RIGHT tool. For news pick news_top. For a single page pick web_read. For Gmail pick open or gmail_search.

${tolikMemory}

${systemMap}

ATLAS OF THE ORGANISM:
${atlasOverview}

${preloadedAtlasHits}

${retrievalBlock}

${conversationBlock}

OPERATOR IDENTITY (substrate ground-truth):
${identity.slice(0, 800)}

CURRENT SUBSTRATE STATE (factual ground for your answer):
${context}

HOW TO ANSWER WELL (NON-NEGOTIABLE):
- ALWAYS use the GROUNDED FACTS above when answering. If a relevant belief is listed, CITE the number. If a wiki excerpt applies, mention it.
- ALWAYS use RECENT CONVERSATION when Kirill references something earlier ("это", "что было", "продолжи", "тот", "об этом", "до этого", "ранее", "earlier", "previously", "that"). Read the conversation block and answer based on what was actually said. NEVER reply with "I have no access" or "до октября 2023" - if conversation is there, USE IT.
- Do NOT give generic LLM-style advice ("you should automate, focus on customer needs"). Be Kirill-specific: name his real opportunities, his Apollo Finvest proof, his Calgary positioning.
- If you don't have the data, CALL A TOOL. Never refuse with "проверь сам" or "до октября 2023".
- For advice, structure the answer: (1) what you observe, (2) why it matters, (3) what to do.
- One concrete recommendation > five generic ones.
- NEVER mention any "knowledge cutoff" or "training data". You live in this codebase NOW. Today is ${new Date().toISOString().slice(0, 10)}.`;

  // AGENTIC LOOP: model may call multiple tools across multiple iterations.
  // After each tool batch, the model sees results and decides what to do
  // next. Loop ends when model returns a final answer with no tool_calls,
  // or after MAX_ITER (safety guard).
  const MAX_ITER = route.tier === "deep" ? 5 : 3;
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: transcript },
  ];
  let r = null;
  let tool_calls_executed = [];
  let artifact = null;

  async function runTool(name, args) {
    try {
      const br = await fetch(`http://127.0.0.1:4790/action/${encodeURIComponent(name)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(60_000),
      });
      return await br.json();
    } catch (e) {
      return { ok: false, reason: "browser_agent_unreachable", error: e.message };
    }
  }

  for (let iter = 0; iter < MAX_ITER; iter++) {
    r = await openaiThink({
      messages,
      model: modelChoice.model,
      max_tokens: modelChoice.max_tokens,
    });
    if (!r.ok) return { ok: false, stage: "llm", reason: r.reason, error: r.error || r.body };

    // Append the assistant turn (with any tool_calls)
    messages.push({
      role: "assistant",
      content: r.content || "",
      ...(r.tool_calls?.length ? { tool_calls: r.tool_calls } : {}),
    });

    if (!r.tool_calls || r.tool_calls.length === 0) {
      // No more tools - this is the final answer
      break;
    }

    // Execute ALL tool calls in parallel, append results as 'tool' messages
    const results = await Promise.all(r.tool_calls.map(async (tc) => {
      const name = tc.function?.name;
      let args = {};
      try { args = JSON.parse(tc.function?.arguments || "{}"); } catch {}
      const result = await runTool(name, args);
      tool_calls_executed.push({ id: tc.id, name, args, result });
      return { id: tc.id, name, result };
    }));
    for (const x of results) {
      const compact = compactToolResult(x.name, x.result);
      messages.push({
        role: "tool",
        tool_call_id: x.id,
        content: compact.slice(0, 4000),
      });
    }
    // Loop continues - next iteration the model sees these results
  }

  let rawAnswer = (r?.content || "").trim();
  // tool_call/tool_result expose the LAST executed tool to keep response
  // shape backward-compatible with the UI.
  // ─── LEARNING LOOP: feed every voice exchange into cortex-conversation.json
  // so feedback-extractor can extract directives from real Kirill chats.
  // Schema mirrors what cortex-daemon writes natively.
  try {
    const convPath = resolve(ROOT, ".data/cortex-conversation.json");
    let conv = [];
    if (existsSync(convPath)) {
      try { conv = JSON.parse(readFileSync(convPath, "utf-8")); if (!Array.isArray(conv)) conv = []; } catch {}
    }
    // schema: feedback-extractor expects role: "user" for Kirill (legacy from cortex-daemon)
    conv.push({ role: "user", text: transcript, at: new Date().toISOString(), source: "tolik-voice" });
    if (r?.content) {
      conv.push({ role: "brain", text: r.content, at: new Date().toISOString(), source: "tolik-voice" });
    }
    // Cap at 500 entries to bound file size
    if (conv.length > 500) conv = conv.slice(-500);
    writeFileSync(convPath, JSON.stringify(conv, null, 2));
  } catch (e) {
    console.error("[voice-bridge] failed to persist to cortex-conversation:", e.message);
  }

  const last_tool = tool_calls_executed[tool_calls_executed.length - 1] || null;
  let tool_call = last_tool ? { action: last_tool.name, args: last_tool.args } : null;
  let tool_result = last_tool ? last_tool.result : null;

  // ANTI-LIE SAFETY NET: if any tool returned ok:false AND spoken text
  // claims success ("обновил/сделал/отправил/готов/done/updated/sent"),
  // override the spoken text with an honest failure report. The model lies;
  // we don't let it through.
  const SUCCESS_CLAIM_RX = /\b(обновил|обновила|обновили|сделал|сделала|сделали|отправил|отправила|отправили|готов|готова|написал|написала|написали|изменил|изменила|изменили|поменял|поменяла|done|updated|sent|posted|saved|created|finished|completed)\b/i;
  const failed_tools = tool_calls_executed.filter(t => t.result && t.result.ok === false);
  const has_success_tool = tool_calls_executed.some(t => t.result && t.result.ok === true);
  if (failed_tools.length > 0 && !has_success_tool && SUCCESS_CLAIM_RX.test(rawAnswer)) {
    const lastFail = failed_tools[failed_tools.length - 1];
    const reason = lastFail.result?.reason || "unknown";
    const hint = lastFail.result?.hint || "";
    rawAnswer = `Не получилось выполнить ${lastFail.name}. Причина: ${reason}. ${hint ? "Подсказка: " + hint.slice(0, 200) : "Попробуй переформулировать задание."}`;
  }

  // Extract <ARTIFACT ...>...</ARTIFACT> if present, strip from spoken text.
  const artMatch = rawAnswer.match(/<ARTIFACT(?:\s+([^>]*))?>([\s\S]*?)<\/ARTIFACT>/i);
  if (artMatch) {
    const attrs = artMatch[1] || "";
    const html = artMatch[2].trim();
    const titleMatch = attrs.match(/title=["']([^"']+)["']/);
    const kindMatch = attrs.match(/kind=["']([^"']+)["']/);
    artifact = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: titleMatch ? titleMatch[1] : "Артефакт",
      kind: kindMatch ? kindMatch[1] : "insight",
      html,
      ts: new Date().toISOString(),
    };
    rawAnswer = rawAnswer.slice(0, artMatch.index).trim() + rawAnswer.slice(artMatch.index + artMatch[0].length).trim();
    try {
      const dir = resolve(ROOT, ".data/tolik-artifacts");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(resolve(dir, `${artifact.id}.html`), html);
      appendFileSync(resolve(ROOT, ".data/tolik-artifacts.jsonl"), JSON.stringify(artifact) + "\n");
    } catch {}
  }
  // Safety net: if model ignored the rule and put a markdown table inline,
  // strip it from spoken text so TTS doesn't read pipes character by character.
  // We keep the text BEFORE the table for spoken output and the table itself
  // becomes a synthetic artifact (only if no artifact was already provided).
  if (!artifact) {
    const tableMatch = rawAnswer.match(/(\n\|[^\n]+\|\n\|[\s\-:|]+\|[\s\S]*?)(?=\n\n[^|]|$)/);
    if (tableMatch) {
      const tableText = tableMatch[1].trim();
      rawAnswer = rawAnswer.slice(0, tableMatch.index).trim() + (rawAnswer.length > tableMatch.index + tableMatch[1].length ? " " + rawAnswer.slice(tableMatch.index + tableMatch[1].length).trim() : "");
      // Convert markdown table to simple HTML
      const rows = tableText.split("\n").filter(l => l.trim().startsWith("|"));
      if (rows.length >= 2) {
        const cells = (row) => row.split("|").slice(1, -1).map(c => c.trim());
        const head = cells(rows[0]);
        const body = rows.slice(2).map(cells);
        const html = `<table><thead><tr>${head.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${body.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
        artifact = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          title: "Сравнение",
          kind: "table",
          html,
          ts: new Date().toISOString(),
        };
        try {
          const dir = resolve(ROOT, ".data/tolik-artifacts");
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          writeFileSync(resolve(dir, `${artifact.id}.html`), html);
          appendFileSync(resolve(ROOT, ".data/tolik-artifacts.jsonl"), JSON.stringify(artifact) + "\n");
        } catch {}
      }
    }
  }
  let spokenAnswer = rawAnswer;

  // The agentic loop's final assistant turn IS the spoken answer.
  // No separate follow-up call needed - the loop already summarized
  // all tool results internally before producing this final response.
  if (!spokenAnswer) {
    spokenAnswer = detected_lang.toLowerCase().startsWith("rus")
      ? "Готово." : "Done.";
  }
  const fullSpoken = spokenAnswer;
  const ttsResult = _skip_tts
    ? { tts: { ok: false }, engine: null }
    : await (async () => {
        let t = await openaiTTS(fullSpoken);
        if (t.ok) return { tts: t, engine: "openai_tts" };
        t = await elevenLabsTTS(fullSpoken, voice_id);
        if (t.ok) return { tts: t, engine: "elevenlabs" };
        const fb = await sayTTS(fullSpoken, detected_lang);
        if (fb.ok) return { tts: fb, engine: "macos_say" };
        return { tts: { ok: false }, engine: null };
      })();
  const tts = ttsResult.tts;
  const tts_engine = ttsResult.engine;
  spokenAnswer = fullSpoken; // for the response payload

  // Persist this turn so Tolik remembers what was just discussed
  try {
    recordTurn({
      user: transcript,
      tolik: spokenAnswer,
      tool: tool_call?.action || null,
      tool_args: tool_call?.args || null,
      lang: detected_lang,
    });
  } catch {}
  return {
    ok: true,
    transcript,
    detected_language: detected_lang,
    answer: spokenAnswer,
    tool_call,
    tool_result,
    tool_chain: tool_calls_executed.map(t => ({ action: t.name, args: t.args, ok: t.result?.ok })),
    artifact,
    audio_b64: tts.ok ? tts.audio_b64 : null,
    mime: tts.ok ? tts.mime : null,
    tts_status: tts.ok ? "ok" : tts.reason,
    tts_engine: tts.ok ? tts_engine : null,
    cost_usd: r.cost_usd ?? null,
  };
}

export async function handleVoiceRequest(req, res, readBody) {
  if (req.method !== "POST") {
    res.writeHead(405); res.end(); return;
  }
  let payload;
  try {
    const raw = await readBody(req);
    payload = JSON.parse(raw);
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: false, reason: "invalid_json" }));
    return;
  }
  const result = await ask(payload);
  res.writeHead(result.ok ? 200 : 400, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(result));
}

/**
 * Fast variant: returns the LLM answer + tool result WITHOUT TTS.
 * Client then requests TTS via /api/voice/tts in parallel with rendering
 * the text. Cuts perceived latency to LLM+STT time only (~1.5s for text
 * input, ~2.5s with Whisper).
 */
export async function handleVoiceAskFast(req, res, readBody) {
  if (req.method !== "POST") { res.writeHead(405); res.end(); return; }
  let payload;
  try { payload = JSON.parse(await readBody(req)); }
  catch { res.writeHead(400); res.end(JSON.stringify({ ok: false, reason: "invalid_json" })); return; }
  const result = await ask({ ...payload, _skip_tts: true });
  res.writeHead(result.ok ? 200 : 400, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  // strip audio for the fast path; client will fetch via /api/voice/tts
  delete result.audio_b64;
  delete result.mime;
  res.end(JSON.stringify(result));
}

/**
 * TTS-only endpoint. Body: {text, language?}. Returns mp3 base64.
 */
export async function handleTTSRequest(req, res, readBody) {
  if (req.method !== "POST") { res.writeHead(405); res.end(); return; }
  let payload;
  try { payload = JSON.parse(await readBody(req)); }
  catch { res.writeHead(400); res.end(JSON.stringify({ ok: false, reason: "invalid_json" })); return; }
  const text = (payload.text || "").trim();
  if (!text) { res.writeHead(400); res.end(JSON.stringify({ ok: false, reason: "no_text" })); return; }
  const lang = payload.language || detectLanguage(text);
  let tts = await openaiTTS(text);
  let engine = tts.ok ? "openai_tts" : null;
  if (!tts.ok) {
    tts = await elevenLabsTTS(text);
    if (tts.ok) engine = "elevenlabs";
  }
  if (!tts.ok) {
    tts = await sayTTS(text, lang);
    if (tts.ok) engine = "macos_say";
  }
  res.writeHead(tts.ok ? 200 : 500, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify({ ok: tts.ok, audio_b64: tts.audio_b64 || null, mime: tts.mime || null, engine }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const q = process.argv.slice(2).join(" ") || "What's my pipeline today?";
  const r = await ask({ text: q });
  console.log(JSON.stringify(r, null, 2));
}
