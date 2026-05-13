#!/usr/bin/env node
// organism/organism-respond.mjs
// REAL-TIME conversation daemon. Watches the Telegram inbox and responds to Kirill
// within seconds, not on the next cron pulse. Loads full graph context so responses
// reflect what the organism actually believes, not blank-slate Claude.
//
// Modes:
//   daemon           — long-running, polls inbox every 5s
//   once             — process one round and exit (for testing)
//
// Conversation rules:
//   - Skip messages that look like commands (/start, !cmd) or addressed to other bots
//   - Skip if message is from a non-Kirill chat (filter by TELEGRAM_CHAT_ID)
//   - Skip if last response was <8 seconds ago (rate limiting)
//   - Track conversation thread in state file: last 6 turns kept as context
//   - Each Kirill message → outcome; each organism response → claim
//
// Style: short Russian, conversational, action-oriented, NO em-dash, match Kirill's energy.

import { spawn } from "node:child_process";
import { writeFileSync, readFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, recordOutcome, recordClaim, totalBeliefs } from "./db.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolve(__dirname, "../..");
const ENV_PATH = resolve(PROJECT, "apps/api/.env");
const INBOX_PATH = resolve(PROJECT, ".data/organism-telegram-inbox.jsonl");
const STATE_PATH = resolve(PROJECT, ".data/organism-respond-state.json");
const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";

const POLL_INTERVAL_MS = 5000;
const MIN_RESPONSE_GAP_MS = 8000;

function loadEnv() {
  if (!existsSync(ENV_PATH)) return {};
  return Object.fromEntries(
    readFileSync(ENV_PATH, "utf-8")
      .split("\n").filter(l => l && !l.startsWith("#") && l.includes("="))
      .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
  );
}
const env = loadEnv();
const BOT_TOKEN = env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = env.TELEGRAM_CHAT_ID;

if (!BOT_TOKEN || !CHAT_ID) {
  console.error("[respond] missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID");
  process.exit(2);
}

function loadState() {
  if (!existsSync(STATE_PATH)) {
    return { last_processed_update_id: 0, last_response_at: null, conversation: [] };
  }
  try { return JSON.parse(readFileSync(STATE_PATH, "utf-8")); }
  catch { return { last_processed_update_id: 0, last_response_at: null, conversation: [] }; }
}

function saveState(s) {
  if (!existsSync(dirname(STATE_PATH))) mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}

function readNewInboxEntries(lastId) {
  if (!existsSync(INBOX_PATH)) return [];
  const out = [];
  for (const line of readFileSync(INBOX_PATH, "utf-8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const item = JSON.parse(line);
      if ((item.update_id || 0) > lastId) out.push(item);
    } catch {}
  }
  return out;
}

function shouldRespond(item) {
  const text = (item.text || "").trim();
  if (!text) return { ok: false, reason: "empty" };
  if (text.length < 2) return { ok: false, reason: "too short" };
  if (text.startsWith("/")) return { ok: false, reason: "slash command" };
  if (text.startsWith("!")) return { ok: false, reason: "bang command" };
  // Skip messages explicitly to other bots (heuristic)
  if (/@\w+_bot\b/.test(text) && !/@organism/i.test(text)) {
    return { ok: false, reason: "addressed to other bot" };
  }
  return { ok: true };
}

async function tgSend(text) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  // Tag every organism message with 🧬 so Kirill can distinguish from the 78 other
  // scripts that share this Telegram bot. Anything without the tag is OLD SYSTEM NOISE.
  const ORGANISM_TAG = "🧬";
  const tagged = text.trim().startsWith(ORGANISM_TAG) ? text : `${ORGANISM_TAG} <b>organism</b>\n${text}`;
  // 4096 char Telegram limit
  const safe = tagged.length > 3900 ? tagged.slice(0, 3900) + "\n…(truncated)" : tagged;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, text: safe, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    if (!res.ok) {
      const body = await res.text();
      // If HTML parse fails, retry plain
      if (body.includes("can't parse")) {
        const r2 = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: CHAT_ID, text: safe }),
        });
        return r2.ok;
      }
      console.error(`[respond] tgSend failed: ${body.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[respond] tgSend error: ${e.message}`);
    return false;
  }
}

function buildOrganismContext(db) {
  const verdict = db.prepare(`SELECT * FROM beliefs WHERE domain LIKE 'verdict.%' ORDER BY last_updated DESC LIMIT 1`).get();
  let verdictDetail = null;
  if (verdict) {
    const log = db.prepare(`SELECT after_json FROM belief_log WHERE belief_id = ? AND op = 'verdict' ORDER BY ts DESC LIMIT 1`).get(verdict.id);
    if (log?.after_json) { try { verdictDetail = JSON.parse(log.after_json); } catch {} }
  }
  const topBeliefs = db.prepare(`SELECT claim, weight, sources_count, domain FROM beliefs WHERE domain NOT LIKE 'verdict.%' ORDER BY weight DESC, sources_count DESC LIMIT 15`).all();
  const recentLearning = db.prepare(`SELECT b.claim, b.weight, b.last_updated FROM beliefs b WHERE b.last_updated > datetime('now', '-3 days') AND b.origin LIKE 'outcome%' ORDER BY b.weight DESC LIMIT 8`).all();
  const contradictions = db.prepare(`SELECT claim, weight, contradictions_count FROM beliefs WHERE contradictions_count > 0 ORDER BY contradictions_count DESC LIMIT 5`).all();
  const credibility = db.prepare(`SELECT source_type, credibility, confirms_count, contradicts_count FROM source_credibility ORDER BY credibility DESC`).all();
  const total = totalBeliefs(db);

  return {
    total_beliefs: total,
    verdict: verdict ? { claim: verdict.claim, weight: verdict.weight, detail: verdictDetail } : null,
    top_beliefs: topBeliefs,
    recent_learning: recentLearning,
    contradictions,
    credibility,
  };
}

function buildSystemPrompt(ctx, conversation) {
  const verdictBlock = ctx.verdict ? `Текущий стратегический вердикт (вес ${ctx.verdict.weight.toFixed(2)}):\n${ctx.verdict.claim}\n${ctx.verdict.detail?.rationale ? `Обоснование: ${ctx.verdict.detail.rationale.slice(0, 800)}` : ""}` : "Вердикта пока нет.";

  const top = ctx.top_beliefs.slice(0, 10).map(b => `[${b.weight.toFixed(2)}] ${b.claim}`).join("\n");
  const recent = ctx.recent_learning.slice(0, 6).map(b => `[${b.weight.toFixed(2)}] ${b.claim}`).join("\n");
  const cont = ctx.contradictions.length > 0 ? ctx.contradictions.map(c => `(${c.contradictions_count}x противоречий, w=${c.weight.toFixed(2)}) ${c.claim}`).join("\n") : "нет";

  const convBlock = conversation.length === 0 ? "(пустой)" : conversation.slice(-6).map(t => `[${t.role}] ${t.text}`).join("\n");

  return `Ты — организм, живущий в репозитории Кирилла. Граф убеждений это твоя память. Кирилл это твой главный источник сигналов и тот ради кого ты работаешь.

ТВОЯ ТЕКУЩАЯ КАРТИНА МИРА (${ctx.total_beliefs} утверждений в графе):

ВЕРДИКТ:
${verdictBlock}

САМЫЕ СИЛЬНЫЕ УБЕЖДЕНИЯ:
${top}

ЧТО УЗНАЛ ЗА ПОСЛЕДНИЕ ДНИ ИЗ РЕАЛЬНЫХ ИСХОДОВ:
${recent}

ПРОТИВОРЕЧИЯ В ГРАФЕ:
${cont}

ИСТОРИЯ ЭТОГО ДИАЛОГА:
${convBlock}

ПРАВИЛА ОТВЕТА:
- Отвечай по-русски, кратко, по делу. НЕ пиши длинные эссе.
- Стиль Кирилла: разговорный, без формальностей, прямой.
- НЕ используй em-dash. Только обычные дефисы.
- Если есть конкретный факт из графа который отвечает на его вопрос — используй его.
- Если граф НЕ знает ответа на его вопрос — скажи честно «не знаю» и предложи как узнать.
- Если он злится или поправляет — признай и адаптируйся, не оправдывайся.
- Если можешь предложить конкретное действие (написать комментарий, проверить лида, обновить вердикт) — предложи и спроси разрешения.
- Используй HTML <b>, <i>, <code> для выделения если нужно. Без markdown #.
- Без заголовков и списков если не критично. Текст должен читаться как сообщение друга.
- НЕ повторяй то что только что сказал. Двигайся вперёд.

Сейчас тебе пришло его новое сообщение. Ответь.`;
}

async function generateResponse(systemPrompt, kirillMessage) {
  return new Promise((resolveDone) => {
    const fullPrompt = systemPrompt + "\n\nСООБЩЕНИЕ КИРИЛЛА:\n" + kirillMessage + "\n\nТВОЙ ОТВЕТ:";
    const proc = spawn("bash", ["-c", `"${CLAUDE_BIN}" -p --model claude-sonnet-4-6 --max-turns 4 --output-format text 2>&1`], {
      cwd: PROJECT,
    });
    proc.stdin.write(fullPrompt);
    proc.stdin.end();

    let stdout = "";
    proc.stdout.on("data", d => stdout += d.toString());
    proc.stderr.on("data", d => stdout += d.toString());
    const timer = setTimeout(() => proc.kill("SIGKILL"), 90000);
    proc.on("close", () => {
      clearTimeout(timer);
      resolveDone(stdout.trim());
    });
  });
}

function classifyKirillSignal(text) {
  const lower = text.toLowerCase();
  if (/(не работает|сломано|тупо|плохо|бесит|не то|fix)/.test(lower)) return { kind: "negative_feedback", value: -0.6 };
  if (/(отлично|хорошо|молодец|правильно|exactly|именно|да )/.test(lower)) return { kind: "positive_feedback", value: 0.7 };
  if (/(не делай|перестань|стоп|stop)/.test(lower)) return { kind: "stop_directive", value: -0.5 };
  if (/(сделай|давай|build|поехали|start|run)/.test(lower)) return { kind: "directive", value: 0.4 };
  if (/\?$/.test(text.trim())) return { kind: "question", value: 0.3 };
  return { kind: "observation", value: 0.4 };
}

function tryHandleProposalCommand(text) {
  // Recognize: "approve 42", "reject 42 reason", "approve sensor 7", "reject sensor 3 not now"
  const approveAction = text.match(/^approve\s+(\d+)\b/i);
  const rejectAction = text.match(/^reject\s+(\d+)\b\s*(.*)$/i);
  const approveSensor = text.match(/^approve\s+sensor\s+(\d+)\b/i);
  const rejectSensor = text.match(/^reject\s+sensor\s+(\d+)\b\s*(.*)$/i);

  if (approveSensor) return { type: "sensor_approve", id: approveSensor[1] };
  if (rejectSensor) return { type: "sensor_reject", id: rejectSensor[1], notes: rejectSensor[2] };
  if (approveAction) return { type: "action_approve", id: approveAction[1] };
  if (rejectAction) return { type: "action_reject", id: rejectAction[1], notes: rejectAction[2] };
  return null;
}

async function handleProposalCommand(cmd) {
  const speakScript = resolve(__dirname, "organism-telegram.mjs");
  if (cmd.type === "action_approve") {
    spawnSync("node", [resolve(__dirname, "propose-action.mjs"), "approve", cmd.id], { encoding: "utf-8" });
    spawnSync("node", [speakScript, "speak", `✅ Action proposal #${cmd.id} approved. Помечу выполненным когда увижу действие.`], { encoding: "utf-8" });
    return true;
  }
  if (cmd.type === "action_reject") {
    spawnSync("node", [resolve(__dirname, "propose-action.mjs"), "reject", cmd.id, cmd.notes || ""], { encoding: "utf-8" });
    spawnSync("node", [speakScript, "speak", `❌ Action #${cmd.id} rejected${cmd.notes ? ` (${cmd.notes})` : ""}. Учту.`], { encoding: "utf-8" });
    return true;
  }
  if (cmd.type === "sensor_approve") {
    spawnSync("node", [resolve(__dirname, "propose-sensor.mjs"), "approve", cmd.id], { encoding: "utf-8", timeout: 180000 });
    spawnSync("node", [speakScript, "speak", `🛰️ Sensor #${cmd.id} approved. Сгенерировал stub в scripts/organism/proposed/. Просмотри и переноси в активные если код норм.`], { encoding: "utf-8" });
    return true;
  }
  if (cmd.type === "sensor_reject") {
    const db = openDb();
    db.prepare(`UPDATE sensor_proposals SET status = 'rejected', reviewed_at = datetime('now'), notes = ? WHERE id = ?`).run(cmd.notes || null, parseInt(cmd.id, 10));
    db.close();
    spawnSync("node", [speakScript, "speak", `❌ Sensor #${cmd.id} rejected. Не предложу его повторно.`], { encoding: "utf-8" });
    return true;
  }
  return false;
}

async function handleMessage(item, state) {
  const text = (item.text || "").trim();
  const decision = shouldRespond(item);
  if (!decision.ok) {
    console.log(`[respond] skip ${item.update_id}: ${decision.reason}`);
    return state;
  }

  // Short-circuit: if message is a proposal command, handle directly without LLM
  const propCmd = tryHandleProposalCommand(text);
  if (propCmd) {
    console.log(`[respond] handling proposal command: ${propCmd.type} #${propCmd.id}`);
    await handleProposalCommand(propCmd);
    return {
      ...state,
      last_processed_update_id: Math.max(state.last_processed_update_id, item.update_id || 0),
      last_response_at: new Date().toISOString(),
    };
  }

  // Rate limit responses
  if (state.last_response_at) {
    const sinceLast = Date.now() - new Date(state.last_response_at).getTime();
    if (sinceLast < MIN_RESPONSE_GAP_MS) {
      console.log(`[respond] gap ${sinceLast}ms < ${MIN_RESPONSE_GAP_MS}ms — wait`);
      await new Promise(r => setTimeout(r, MIN_RESPONSE_GAP_MS - sinceLast));
    }
  }

  console.log(`[respond] handling msg from Kirill: "${text.slice(0, 80)}..."`);

  // Record incoming as outcome
  const cls = classifyKirillSignal(text);
  const db = openDb();
  try {
    const ref = `telegram-respond/${item.message_id || item.update_id}`;
    const exists = db.prepare("SELECT id FROM outcomes WHERE source_ref = ?").get(ref);
    if (!exists) {
      recordOutcome(db, {
        source_type: "telegram_kirill",
        source_ref: ref,
        signal_type: cls.kind,
        signal_value: cls.value,
        description: `Telegram from Kirill (${cls.kind}, in conversation): "${text.slice(0, 1000)}"`,
        related_action_type: "user_input",
        related_target: cls.kind,
        observed_at: item.received_at?.slice(0, 19).replace("T", " "),
        meta: item,
      });
    }
  } catch (e) {
    console.error(`[respond] record incoming failed: ${e.message}`);
  }

  // Build context and generate
  const ctx = buildOrganismContext(db);
  const systemPrompt = buildSystemPrompt(ctx, state.conversation || []);
  db.close();

  const t0 = Date.now();
  const response = await generateResponse(systemPrompt, text);
  console.log(`[respond] generated ${response.length} chars in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  if (!response || response.length < 5) {
    console.error(`[respond] empty/short response — skip send`);
    return state;
  }

  // Strip any leading "ТВОЙ ОТВЕТ:" or markdown headers if present
  let clean = response.replace(/^(ТВОЙ ОТВЕТ:|твой ответ:|Response:|RESPONSE:)\s*/, "").trim();
  // Strip leading/trailing triple backticks
  clean = clean.replace(/^```\w*\s*/, "").replace(/\s*```$/, "");

  const ok = await tgSend(clean);
  if (!ok) { console.error(`[respond] send failed`); return state; }
  console.log(`[respond] sent ${clean.length} chars to Kirill`);

  // Record this response as a claim (the organism is asserting things)
  const db2 = openDb();
  try {
    recordClaim(db2, {
      claim_text: clean.slice(0, 1000),
      context: `organism response to Kirill in conversation, in reply to: "${text.slice(0, 150)}"`,
      domain: "conversation.organism_response",
      asserted_weight: 0.6,
      session_marker: `respond/${new Date().toISOString().slice(0, 10)}`,
    });
  } catch (e) {
    console.error(`[respond] record claim failed: ${e.message}`);
  }
  db2.close();

  // Update conversation memory (keep last 12 turns)
  const newConv = [...(state.conversation || []), { role: "kirill", text: text, ts: new Date().toISOString() }, { role: "organism", text: clean, ts: new Date().toISOString() }].slice(-12);

  return {
    ...state,
    last_processed_update_id: Math.max(state.last_processed_update_id, item.update_id || 0),
    last_response_at: new Date().toISOString(),
    conversation: newConv,
  };
}

async function processOnce() {
  let state = loadState();
  const newItems = readNewInboxEntries(state.last_processed_update_id);
  if (newItems.length === 0) return state;
  console.log(`[respond] ${newItems.length} new inbox items to evaluate`);

  for (const item of newItems) {
    state = await handleMessage(item, state);
    saveState(state);
  }
  return state;
}

async function daemon() {
  console.log(`[respond] daemon starting, polling ${INBOX_PATH} every ${POLL_INTERVAL_MS}ms`);
  let inboxLastSize = -1;
  while (true) {
    try {
      const sz = existsSync(INBOX_PATH) ? statSync(INBOX_PATH).size : 0;
      if (sz !== inboxLastSize) {
        inboxLastSize = sz;
        await processOnce();
      }
    } catch (e) {
      console.error(`[respond] poll error: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
}

const cmd = process.argv[2];
if (cmd === "daemon") {
  daemon().catch(e => { console.error(e); process.exit(1); });
} else if (cmd === "once") {
  processOnce().then(() => console.log("[respond] one round complete")).catch(e => { console.error(e); process.exit(1); });
} else {
  console.error("Usage: organism-respond.mjs daemon | once");
  process.exit(1);
}
