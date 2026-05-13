/**
 * scripts/tolik/tg-tools.mjs
 *
 * Tolik's Telegram hands. Two layers:
 *   1. BOT API (default): send messages to Kirill (TELEGRAM_CHAT_ID) and
 *      to anyone who has DM'd the bot at least once. Cheap, instant,
 *      no session timeouts.
 *   2. MTPROTO USER (existing <operator_handle> session): for sending to chats
 *      and contacts that have not interacted with the bot - using
 *      .data/telegram-session-agent.txt. Loaded only when bot fails.
 *
 * Public actions (called from voice-bridge tool router):
 *   tg_send_to_me({text})              — Kirill's own chat via bot
 *   tg_send_to({chat, text})           — chat_id or @username via bot,
 *                                         falls back to MTProto if bot
 *                                         lacks access
 *   tg_recent({n})                     — read recent dialog headers via
 *                                         MTProto user session
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { safeSend } from "../lib/safe-send.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const ENV_PATH = resolve(ROOT, "apps/api/.env");
const SESSION_PATH = resolve(ROOT, ".data/telegram-session-agent.txt");

function envMap() {
  if (!existsSync(ENV_PATH)) return {};
  return Object.fromEntries(
    readFileSync(ENV_PATH, "utf-8").split("\n")
      .filter(l => l && !l.startsWith("#") && l.includes("="))
      .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
  );
}

// Detect "empty meta-message" pattern: Tolik claims he did work but the
// message has no actual content. Real work output (audit findings, draft
// text, plan steps, news headlines) must be IN the message body, not
// "let me know if you want details".
function isEmptyMetaMessage(text) {
  if (!text) return true;
  const lower = text.toLowerCase();
  // Pattern 1: under 350 chars AND contains "I prepared X" + "let me know"
  const claims = /(подготовил|готов |отправил|завершен|completed|prepared|ready|finished)/i;
  const passBack = /(если (?:тебе |захочешь )?(?:нужен|хочешь|интересно)|let me know|ask me|обсудить детали|получить полн|more details|дай знать)/i;
  if (text.length < 350 && claims.test(lower) && passBack.test(lower)) return true;
  // Pattern 2: under 200 chars AND contains a verb of doing without naming what
  if (text.length < 200) {
    const empty = /^[^а-яa-z]*(я |i )?(сделал|подготовил|написал|done|prepared|ready)[\s.,]/i;
    if (empty.test(text.trim())) return true;
  }
  return false;
}

async function botSend(chat_id, text) {
  const env = envMap();
  const token = env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, reason: "no_bot_token" };
  if (!text || !text.trim()) return { ok: false, reason: "empty_text" };

  // CRITICAL: refuse to send meta-messages with no substance. Tolik must
  // include the ACTUAL work in the body, not just a status update.
  if (isEmptyMetaMessage(text)) {
    return {
      ok: false,
      reason: "empty_meta_message_refused",
      hint: "Не отправляй сообщение типа 'я подготовил X, дай знать если нужны детали'. Сам контент работы (текст аудита, текст драфта, конкретные шаги) должен быть В САМОМ СООБЩЕНИИ. Если у тебя есть результат работы - вставь его в text. Если нет результата - не отправляй вообще.",
      preview: text.slice(0, 200),
    };
  }
  // Egress guard: refuse if body leaks credentials, internal paths, env refs
  const guard = await safeSend({ channel: "telegram", text, meta: { recipient: chat_id } });
  if (!guard.ok) {
    return { ok: false, reason: "egress_guard_denied", egress_reason: guard.egress_reason, hint: guard.hint, preview: text.slice(0, 200) };
  }
  // Telegram cap: 4096 chars
  const body = text.length > 4000 ? text.slice(0, 3990) + "…" : text;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id, text: body, parse_mode: "HTML", disable_web_page_preview: true }),
      signal: AbortSignal.timeout(15_000),
    });
    const j = await r.json();
    if (!j.ok) return { ok: false, reason: "bot_api_error", description: j.description };
    return { ok: true, message_id: j.result?.message_id, chat_id };
  } catch (e) { return { ok: false, reason: "fetch_failed", error: e.message }; }
}

export async function tg_send_to_me({ text }) {
  const env = envMap();
  const chat = env.TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
  if (!chat) return { ok: false, reason: "no_chat_id_in_env" };
  const result = await botSend(chat, `🧬 Толик: ${text}`);
  return { ...result, via: "bot", target: "kirill" };
}

export async function tg_send_to({ chat, text }) {
  if (!chat) return { ok: false, reason: "no_chat" };
  // Try bot API first. If chat looks like a numeric id or recognized username
  // that has chatted with the bot, this works.
  let r = await botSend(chat, text);
  if (r.ok) return { ...r, via: "bot" };
  // MTProto fallback - heavier; only attempt if session file exists
  if (existsSync(SESSION_PATH)) {
    try {
      const { sendViaMTProto } = await loadMTProtoSender();
      const mt = await sendViaMTProto(chat, text);
      return { ...mt, via: "mtproto" };
    } catch (e) {
      return { ok: false, reason: "both_bot_and_mtproto_failed", bot_error: r, mtproto_error: e.message };
    }
  }
  return { ok: false, reason: "bot_failed_no_mtproto_session", bot_error: r };
}

let _mtproto = null;
async function loadMTProtoSender() {
  if (_mtproto) return _mtproto;
  // Lazy import — only when needed, since gramjs is heavy
  const { TelegramClient } = await import("telegram");
  const { StringSession } = await import("telegram/sessions/index.js");
  const env = envMap();
  const api_id = Number(env.TG_API_ID || process.env.TG_API_ID);
  const api_hash = env.TG_API_HASH || process.env.TG_API_HASH;
  if (!api_id || !api_hash) throw new Error("missing TG_API_ID/TG_API_HASH");
  const sessionStr = readFileSync(SESSION_PATH, "utf-8").trim();
  const client = new TelegramClient(new StringSession(sessionStr), api_id, api_hash, { connectionRetries: 3 });
  await client.connect();
  _mtproto = {
    sendViaMTProto: async (chat, text) => {
      try {
        const msg = await client.sendMessage(chat, { message: text });
        return { ok: true, message_id: msg?.id };
      } catch (e) { return { ok: false, error: e.message }; }
    },
    recentDialogs: async (limit = 10) => {
      const dialogs = await client.getDialogs({ limit });
      return dialogs.map(d => ({
        name: d.name || d.title || d.entity?.username || "(unknown)",
        unread: d.unreadCount || 0,
        last: d.message?.message?.slice(0, 100) || "",
        date: d.date ? new Date(d.date * 1000).toISOString() : null,
      }));
    },
  };
  return _mtproto;
}

export async function tg_post_to_channel({ channel, text }) {
  // channel = @channel_name or numeric -100... id. Bot must be admin in the
  // channel. Same shape as botSend, just a wrapper for semantic clarity.
  if (!channel || !text) return { ok: false, reason: "need_channel_and_text" };
  const r = await botSend(channel, text);
  return { ...r, channel, via: "bot" };
}

export async function tg_recent({ n = 10 }) {
  if (!existsSync(SESSION_PATH)) return { ok: false, reason: "no_mtproto_session" };
  try {
    const { recentDialogs } = await loadMTProtoSender();
    const dialogs = await recentDialogs(Math.min(50, Math.max(1, n)));
    return { ok: true, dialogs };
  } catch (e) {
    return { ok: false, reason: "mtproto_failed", error: e.message };
  }
}
