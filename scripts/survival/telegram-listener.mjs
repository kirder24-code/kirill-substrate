/**
 * scripts/survival/telegram-listener.mjs
 *
 * Reads Telegram dialogs (groups, channels, DMs) using Kirill's saved
 * user-account session. Filters recent messages for pain signals,
 * drafts contextual replies via Claude (telegram_strategist persona),
 * queues each draft to .data/survival-outbound-queue.jsonl for manual
 * approval. NEVER sends anything autonomously.
 *
 * Telegram TOS: bulk auto-DM and auto-group-post = ban risk for the
 * account. This module is read + draft only. Operator manually copies
 * approved draft and sends from their own client.
 */

import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

import { think } from "./llm-think.mjs";
import { getIdentityBlock } from "./operator-identity.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
// AGENT session = <operator_handle> account, the one connected to the system.
// NEVER use telegram-session.txt (Kirill's personal account).
const SESSION_PATH = resolve(ROOT, ".data/telegram-session-agent.txt");
const PERSONA_PATH = resolve(__dirname, "personas/telegram-strategist.md");
const SCAN_LOG_DIR = resolve(ROOT, ".data/survival-telegram-scans");
const QUEUE_PATH = resolve(ROOT, ".data/survival-outbound-queue.jsonl");
const STATE_PATH = resolve(ROOT, ".data/survival-telegram-listener-state.json");

const API_ID = 30737337;
const API_HASH = "f16037544f47153b6b5c218ba99b84ee";

const PAIN_SIGNAL_KEYWORDS = [
  // English
  "looking for", "anyone using", "burned by", "spending hours",
  "best way to", "how do you handle", "manual process", "automation",
  "n8n", "zapier", "ai workflow", "stuck on", "burned out",
  "considering hiring", "ai agent", "claude api", "openai api",
  // Russian (operator's network reads both)
  "ищу", "нужна автоматизация", "посоветуйте", "застрял", "не получается",
  "ai-агент", "автоматизация", "n8n", "не могу решить",
];

function ensureDir(p) { if (!existsSync(p)) mkdirSync(p, { recursive: true }); }

function loadListenerState() {
  if (!existsSync(STATE_PATH)) return { last_scanned_msg_id_per_dialog: {} };
  try { return JSON.parse(readFileSync(STATE_PATH, "utf-8")); }
  catch { return { last_scanned_msg_id_per_dialog: {} }; }
}

function saveListenerState(state) {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

async function loadClient() {
  if (!existsSync(SESSION_PATH)) {
    return { ok: false, reason: "no_session_file", hint: "run scripts/telegram-auth.mjs to create session" };
  }
  const sessionStr = readFileSync(SESSION_PATH, "utf-8").trim();
  const session = new StringSession(sessionStr);
  const client = new TelegramClient(session, API_ID, API_HASH, {
    connectionRetries: 3,
    requestRetries: 2,
    autoReconnect: false,
  });
  try {
    await client.connect();
    if (!await client.isUserAuthorized()) {
      return { ok: false, reason: "session_not_authorized" };
    }
  } catch (e) {
    return { ok: false, reason: "connect_failed", error: e.message };
  }
  return { ok: true, client };
}

function containsPainSignal(text) {
  if (!text || typeof text !== "string") return null;
  const lower = text.toLowerCase();
  for (const kw of PAIN_SIGNAL_KEYWORDS) {
    if (lower.includes(kw)) return kw;
  }
  return null;
}

async function scanGroups({ client, max_dialogs = 30, max_msgs_per_dialog = 30 }) {
  const state = loadListenerState();
  const dialogs = await client.getDialogs({ limit: max_dialogs });
  const findings = [];
  for (const d of dialogs) {
    if (!d.isGroup && !d.isChannel) continue; // only groups/channels, skip private DMs
    const dialogId = String(d.id);
    const lastSeenId = state.last_scanned_msg_id_per_dialog[dialogId] || 0;
    let dialogMessages;
    try {
      dialogMessages = await client.getMessages(d.id, { limit: max_msgs_per_dialog });
    } catch { continue; }
    let highestMsgId = lastSeenId;
    for (const m of dialogMessages) {
      if (m.id <= lastSeenId) continue; // already processed
      if (m.id > highestMsgId) highestMsgId = m.id;
      const text = m.message;
      const signal = containsPainSignal(text);
      if (!signal) continue;
      findings.push({
        dialog_title: d.title || d.name || dialogId,
        dialog_id: dialogId,
        message_id: m.id,
        from_id: m.fromId ? String(m.fromId.userId || m.fromId) : null,
        text: text.slice(0, 600),
        signal_keyword: signal,
        date: new Date((m.date || 0) * 1000).toISOString(),
      });
    }
    state.last_scanned_msg_id_per_dialog[dialogId] = highestMsgId;
  }
  saveListenerState(state);
  return findings;
}

async function draftReplies(findings) {
  if (findings.length === 0) return [];
  const persona = readFileSync(PERSONA_PATH, "utf-8");
  const identity = getIdentityBlock();
  const findingsBlock = findings.slice(0, 8).map((f, i) =>
    `[${i + 1}] in "${f.dialog_title}" — signal "${f.signal_keyword}":\n${f.text}`
  ).join("\n\n");
  const prompt = `${persona}

## OPERATOR IDENTITY
${identity}

## TELEGRAM PAIN-SIGNAL FINDINGS
You are given recent posts in groups/channels Kirill is in. Each contains a pain-signal keyword. For EACH finding, propose ONE contextual reply Kirill could post — operator-voice, value-first, NOT a pitch, no link spam, follows your persona's protocol (lurk-then-comment-then-DM). Some findings should get a reply that is "skip — too cold / wrong fit"; do not force a reply where one is not appropriate.

${findingsBlock}

Output ONLY a JSON array, one entry per finding (in order):
[
  {"finding_index": 1, "decision": "draft_reply" | "skip" | "save_for_later",
   "reply_text": "<full reply if decision=draft_reply, plain text, no em dashes, max 200 words>",
   "rationale": "<one sentence>"
  }
]`;
  const result = await think({
    prompt,
    model: "claude-sonnet-4-6",
    caller: "telegram_listener:draft",
    max_input_tokens: 8000,
    max_output_tokens: 2000,
  });
  if (!result.ok) return [];
  try {
    const m = result.output.match(/\[[\s\S]*\]/);
    return m ? JSON.parse(m[0]) : [];
  } catch { return []; }
}

function queueDrafts(findings, drafts) {
  ensureDir(dirname(QUEUE_PATH));
  const queued = [];
  for (let i = 0; i < drafts.length; i++) {
    const d = drafts[i];
    if (d.decision !== "draft_reply" || !d.reply_text) continue;
    const f = findings[d.finding_index - 1];
    if (!f) continue;
    const id = `tg-listen-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
    const entry = {
      id,
      queued_at: new Date().toISOString(),
      channel: "telegram_group_reply",
      strategy_id: "telegram_listener",
      audience_fit_level: "primary",
      audience_market: f.dialog_title,
      decision: null,
      decided_at: null,
      sent_at: null,
      sent_result: null,
      telegram_context: {
        group_title: f.dialog_title,
        dialog_id: f.dialog_id,
        original_message_id: f.message_id,
        original_text: f.text,
        signal_keyword: f.signal_keyword,
      },
      draft_body: d.reply_text,
      rationale: d.rationale,
    };
    appendFileSync(QUEUE_PATH, JSON.stringify(entry) + "\n");
    queued.push({ id, group: f.dialog_title, signal: f.signal_keyword });
  }
  return queued;
}

export const telegramListenerMeta = {
  description: "Read Kirill's Telegram groups for pain signals, draft contextual replies via Claude, queue for manual approval. NEVER sends.",
  side_effect_class: "auto",
  expected_signal: "telegram_drafts_queued_for_approval",
  expected_signal_delay_min: 60,
  estimated_cost_usd: 0.20,
};

export async function runTelegramListener({ strategy }) {
  const cli = await loadClient();
  if (!cli.ok) return { ok: false, ...cli };
  const client = cli.client;

  let findings;
  try {
    findings = await scanGroups({ client, max_dialogs: 25, max_msgs_per_dialog: 30 });
  } catch (e) {
    try { await client.disconnect(); } catch {}
    return { ok: false, reason: "scan_failed", error: e.message };
  }

  ensureDir(SCAN_LOG_DIR);
  const scanLog = resolve(SCAN_LOG_DIR, `scan-${Date.now()}.json`);
  writeFileSync(scanLog, JSON.stringify({
    ts: new Date().toISOString(),
    findings_count: findings.length,
    findings_preview: findings.slice(0, 10),
  }, null, 2));

  if (findings.length === 0) {
    try { await client.disconnect(); } catch {}
    return { ok: true, scanned_dialogs: 25, findings: 0, queued: 0, log: scanLog };
  }

  const drafts = await draftReplies(findings);
  const queued = queueDrafts(findings, drafts);
  try { await client.disconnect(); } catch {}

  return {
    ok: true,
    findings: findings.length,
    drafts_proposed: drafts.length,
    queued_for_approval: queued.length,
    log: scanLog,
    queued,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await runTelegramListener({ strategy: { id: "manual-tg-listen" } });
  console.log(JSON.stringify(r, null, 2));
}
