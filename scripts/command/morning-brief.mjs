/**
 * scripts/command/morning-brief.mjs
 *
 * Synthesizes the AI Morning Brief that COMMAND dashboard reads at the
 * top of the screen. Runs daily (cron) at 07:00 local time, plus on-demand
 * via the dashboard "REFRESH BRIEF" button (which shells out to this file).
 *
 * Output: .data/command/morning-brief.json
 *   { generated_at, text, pills, source_stats }
 *
 * Sources gathered before Claude is called (substrate state only — no
 * external APIs, so this never breaks when offline):
 *   - opportunities by state (qualified / researched / planned / draft)
 *   - outbound_queue awaiting approval
 *   - LLM spend last 24h
 *   - top-attempt actions last 7 days
 *   - cortex/strategic verdict if organism.db has it
 *
 * Cost cap: ~$0.04 per run (sonnet, ~3000 in / ~800 out).
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

import { think } from "../survival/llm-think.mjs";
import { getIdentityBlock } from "../survival/operator-identity.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const SURVIVAL_DB = resolve(ROOT, ".data/survival.db");
const ORGANISM_DB = resolve(ROOT, ".data/organism.db");
const OUT_DIR = resolve(ROOT, ".data/command");
const OUT_PATH = resolve(OUT_DIR, "morning-brief.json");

function safeOpen(path) {
  if (!existsSync(path)) return null;
  try { return new Database(path, { readonly: true, fileMustExist: true }); }
  catch { return null; }
}
function safeAll(db, sql) { try { return db.prepare(sql).all(); } catch { return []; } }
function safeGet(db, sql, fb) { try { return db.prepare(sql).get() ?? fb; } catch { return fb; } }

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

function gatherStats() {
  const stats = {
    opps_by_state: {},
    drafts_awaiting: 0,
    llm_spend_24h: 0,
    top_actions_7d: [],
    strategic_verdict: null,
  };
  const sdb = safeOpen(SURVIVAL_DB);
  if (sdb) {
    const oppRows = safeAll(sdb, `SELECT state, COUNT(*) AS n FROM opportunities GROUP BY state`);
    for (const r of oppRows) stats.opps_by_state[r.state] = r.n;
    stats.llm_spend_24h = safeGet(sdb, `SELECT COALESCE(SUM(cost_usd),0) AS s FROM llm_call_log WHERE ts > datetime('now','-24 hours')`, { s: 0 }).s;
    stats.top_actions_7d = safeAll(sdb, `SELECT action_id, SUM(attempts) AS a FROM policy_strategies WHERE status_changed_at > datetime('now','-7 days') GROUP BY action_id ORDER BY a DESC LIMIT 5`);
    sdb.close();
  }
  stats.drafts_awaiting = countOutboundAwaiting();
  const odb = safeOpen(ORGANISM_DB);
  if (odb) {
    const v = safeGet(odb, `SELECT claim FROM beliefs WHERE weight > 0.7 ORDER BY weight DESC, last_updated DESC LIMIT 1`, null);
    if (v?.claim) stats.strategic_verdict = String(v.claim).slice(0, 400);
    odb.close();
  }
  // Recent operator-feedback log if substrate has it
  const feedbackPath = resolve(ROOT, ".data/operator-feedback-log.jsonl");
  if (existsSync(feedbackPath)) {
    try {
      const lines = readFileSync(feedbackPath, "utf-8").split("\n").filter(Boolean).slice(-5);
      stats.recent_feedback = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    } catch {}
  }
  return stats;
}

function buildPrompt(stats) {
  const identity = getIdentityBlock();
  const oppSummary = Object.entries(stats.opps_by_state).map(([s, n]) => `${s}: ${n}`).join(", ") || "(none)";
  const actionSummary = stats.top_actions_7d.map(a => `${a.action_id}(${a.a})`).join(", ") || "(none)";
  const feedbackSummary = stats.recent_feedback ? stats.recent_feedback.map(f => `- ${f.message?.slice(0, 100) || JSON.stringify(f).slice(0, 100)}`).join("\n") : "(no recent feedback)";

  return `Ты — Толик, личный голосовой AI Кирилла. Утром Кирилл откроет окно с твоей светящейся сферой и услышит твой брифинг через ElevenLabs. Пиши КАК будто ты сейчас вслух говоришь Кириллу 3-5 предложений.

OPERATOR IDENTITY:
${identity.slice(0, 1200)}

CURRENT SUBSTRATE STATE:
Opportunities by state: ${oppSummary}
Outbound drafts awaiting approval: ${stats.drafts_awaiting}
LLM spend last 24h: $${stats.llm_spend_24h.toFixed(2)}
Top actions last 7 days (by attempts): ${actionSummary}
Strategic verdict: ${stats.strategic_verdict || "(none)"}

Recent operator feedback to substrate:
${feedbackSummary}

ЗАДАЧА: верни ТОЛЬКО JSON в формате:
{
  "text": "<3-5 предложений по-русски, как ты бы сказал вслух. Первое — самое важное на сегодня. Затем 2-3 конкретные цифры из состояния выше. Заверши ОДНИМ конкретным решением которое Кирилл должен принять сегодня.>",
  "pills": ["<3-6 коротких тэгов ЗАГЛАВНЫМИ, < 18 символов каждый. Пример: '14 ЧЕРНОВИКОВ', 'PIPELINE +12%', 'РЕШЕНИЕ: PORTUGAL'>"]
}

Жёсткие правила:
- НЕТ длинных тире (—). Только дефис (-).
- Используй "ты", не "вы". Звучи спокойно и уверенно, без хайпа.
- Никаких слов типа "incredible", "amazing", "момент", "леверидж".
- Никаких обещаний результата, никаких money-back.
- Если число = 0 — назови что это блокирует.
- Текст должен звучать в озвучке. Никаких списков, никакого markdown, только связная речь.
- Только JSON. Без обёрток, без кодовых блоков.`;
}

export async function generateBrief() {
  const stats = gatherStats();
  const prompt = buildPrompt(stats);
  const r = await think({
    prompt,
    caller: "command_morning_brief",
    strategy_id: "morning-brief-cron",
    max_input_tokens: 3000,
    max_output_tokens: 800,
  });
  if (!r.ok) return { ok: false, reason: r.reason, error: r.error, stats };

  let parsed;
  const text = r.output || "";
  try {
    // Strip code fences if Claude included them
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    // Fallback: use raw text, no pills
    parsed = { text: text.slice(0, 600), pills: [] };
  }

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
  const out = {
    generated_at: new Date().toISOString(),
    text: parsed.text || "",
    pills: Array.isArray(parsed.pills) ? parsed.pills.slice(0, 8) : [],
    source_stats: stats,
    cost_usd: r.cost_usd ?? null,
  };
  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));

  // Generate Tolik voice file (TTS) alongside the JSON. Best-effort: if
  // ElevenLabs key is missing or call fails, the dashboard still has the
  // text brief; the audio is just an extra channel.
  let tts_result = null;
  if (out.text) {
    try {
      const { default: ttsModule } = await import("../tolik/brief-tts.mjs");
      tts_result = await ttsModule.generate(out.text, resolve(OUT_DIR, "morning-brief.mp3"));
    } catch (e) {
      tts_result = { ok: false, reason: "tts_module_threw", error: e.message };
    }
  }

  return { ok: true, output_file: OUT_PATH, audio_result: tts_result, cost_usd: r.cost_usd, brief: out };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await generateBrief();
  console.log(JSON.stringify(r, null, 2));
}
