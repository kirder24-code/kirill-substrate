#!/usr/bin/env node
// organism/organism-telegram.mjs
// Bidirectional Telegram channel for the organism. Kirill is one of the most important
// signal sources. This module makes him both an INPUT (his messages → outcomes) and
// an OUTPUT (organism reaches out to him with questions, alerts, verdict updates).
//
// Subcommands:
//   pull             — fetch new Telegram messages from Kirill, convert each to an outcome
//   speak <text>     — send text from organism to Kirill via existing tgSendToKirill
//   speak-stdin      — read message from stdin, send to Kirill
//   stats            — show offset state and recent activity

import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, recordOutcome } from "./db.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolve(__dirname, "../..");
const ENV_PATH = resolve(PROJECT, "apps/api/.env");
const STATE_PATH = resolve(PROJECT, ".data/organism-telegram-state.json");
const SPEAK_LOG = resolve(PROJECT, ".data/organism-telegram-speak.log");
const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";

function loadEnv() {
  if (!existsSync(ENV_PATH)) return {};
  return Object.fromEntries(
    readFileSync(ENV_PATH, "utf-8")
      .split("\n")
      .filter(l => l && !l.startsWith("#") && l.includes("="))
      .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
  );
}

const env = loadEnv();
const BOT_TOKEN = env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = env.TELEGRAM_CHAT_ID;

if (!BOT_TOKEN || !CHAT_ID) {
  console.error("[organism-telegram] missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID in", ENV_PATH);
  process.exit(2);
}

function loadState() {
  if (!existsSync(STATE_PATH)) return { last_update_id: 0 };
  try { return JSON.parse(readFileSync(STATE_PATH, "utf-8")); }
  catch { return { last_update_id: 0 }; }
}

function saveState(state) {
  if (!existsSync(dirname(STATE_PATH))) mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

// Read messages from the inbox JSONL file. telegram-control.mjs is the only process
// that owns the live long-poll socket (Telegram's getUpdates allows only one client
// per token), and it mirrors every Kirill message into this file. We just read what's
// new since our last offset.
const INBOX_PATH = resolve(PROJECT, ".data/organism-telegram-inbox.jsonl");

function readInboxSinceOffset(lastUpdateId) {
  if (!existsSync(INBOX_PATH)) return [];
  const text = readFileSync(INBOX_PATH, "utf-8");
  const out = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const item = JSON.parse(line);
      if (item.update_id > lastUpdateId) out.push(item);
    } catch {}
  }
  return out;
}

async function tgSend(text, extra = {}) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: "HTML", disable_web_page_preview: true, ...extra }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    return await res.json();
  } catch (e) {
    console.error(`[telegram-speak] send error: ${e.message}`);
    return null;
  }
}

function classifyMessage(text) {
  // Quick rule-based pre-classification. Falls through to "observation" if nothing matches.
  const lower = text.toLowerCase();
  if (/^[\/!]/.test(text)) return { kind: "command", signal_value: 0.0 }; // skip slash commands
  if (/(не работает|сломано|ошибка|broken|fix|fail)/i.test(lower)) return { kind: "negative_feedback", signal_value: -0.6 };
  if (/(отлично|правильно|молодец|good|great|perfect|exactly|именно)/i.test(lower)) return { kind: "positive_feedback", signal_value: 0.8 };
  if (/(не делай|перестань|stop|don'?t)/i.test(lower)) return { kind: "stop_directive", signal_value: -0.5 };
  if (/(сделай|давай|build|do|start|run)/i.test(lower)) return { kind: "directive", signal_value: 0.3 };
  if (/\?$/.test(text.trim())) return { kind: "question", signal_value: 0.2 };
  return { kind: "observation", signal_value: 0.4 };
}

async function pullCmd() {
  const state = loadState();
  const lastId = state.last_update_id;
  console.log(`[telegram-pull] reading inbox since update_id > ${lastId}`);

  const items = readInboxSinceOffset(lastId);
  if (items.length === 0) {
    console.log(`[telegram-pull] no new messages in inbox`);
    return;
  }
  console.log(`[telegram-pull] ${items.length} new messages in inbox`);

  const db = openDb();
  let inserted = 0, skipped = 0, maxId = lastId;
  const tx = db.transaction(() => {
    for (const it of items) {
      maxId = Math.max(maxId, it.update_id || 0);
      if (!it.text || !it.text.trim()) { skipped++; continue; }
      const cls = classifyMessage(it.text);
      if (cls.kind === "command") { skipped++; continue; }

      const ref = `telegram/${it.message_id || it.update_id}`;
      const existing = db.prepare("SELECT id FROM outcomes WHERE source_ref = ?").get(ref);
      if (existing) { skipped++; continue; }

      const observed = it.received_at || (it.date ? new Date(it.date * 1000).toISOString() : new Date().toISOString());
      const fromName = it.from || "kirill";
      const desc = `Telegram message from ${fromName} (${cls.kind}): "${it.text.slice(0, 1500)}"`;

      recordOutcome(db, {
        source_type: "telegram_kirill",
        source_ref: ref,
        signal_type: cls.kind,
        signal_value: cls.signal_value,
        description: desc,
        related_action_type: "user_input",
        related_target: cls.kind,
        observed_at: observed.slice(0, 19).replace("T", " "),
        meta: it,
      });
      inserted++;
    }
  });
  tx();

  saveState({ last_update_id: maxId });
  db.close();
  console.log(`[telegram-pull] inserted ${inserted}, skipped ${skipped}, new offset=${maxId}`);
}

async function speakCmd(text) {
  if (!text || text.trim().length === 0) {
    console.error("[telegram-speak] empty message — refusing to send");
    process.exit(1);
  }
  // Always prefix organism messages so Kirill can distinguish from the 78 other
  // scripts that can also write through this same bot. The 🧬 marker means
  // "this is THE organism speaking, the one with the belief graph and memory".
  const ORGANISM_TAG = "🧬";
  let prefixed = text.trim().startsWith(ORGANISM_TAG) ? text : `${ORGANISM_TAG} <b>organism</b>\n${text}`;
  // Telegram limit is 4096 chars; truncate gracefully
  const safe = prefixed.length > 3900 ? prefixed.slice(0, 3900) + "\n…(truncated)" : prefixed;
  const result = await tgSend(safe);
  if (!result) {
    console.error("[telegram-speak] send failed");
    process.exit(1);
  }
  // Append to local speak log for audit
  const logLine = `${new Date().toISOString()}\t${text.replace(/\s+/g, " ").slice(0, 300)}\n`;
  try {
    if (existsSync(SPEAK_LOG)) {
      writeFileSync(SPEAK_LOG, readFileSync(SPEAK_LOG, "utf-8") + logLine);
    } else {
      writeFileSync(SPEAK_LOG, logLine);
    }
  } catch {}
  console.log(`[telegram-speak] sent ${text.length} chars to Kirill`);
}

async function speakStdinCmd() {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  await speakCmd(data.trim());
}

function statsCmd() {
  const state = loadState();
  console.log(`offset state: last_update_id=${state.last_update_id}`);
  console.log(`state file: ${STATE_PATH}`);
  const db = openDb();
  const total = db.prepare("SELECT COUNT(*) AS n FROM outcomes WHERE source_type = 'telegram_kirill'").get().n;
  const last = db.prepare("SELECT * FROM outcomes WHERE source_type = 'telegram_kirill' ORDER BY observed_at DESC LIMIT 5").all();
  console.log(`telegram-sourced outcomes: ${total}`);
  for (const o of last) {
    console.log(`  [${o.observed_at}] ${o.signal_type}: ${o.description.slice(0, 100)}`);
  }
  db.close();
}

const cmd = process.argv[2];
const arg = process.argv.slice(3).join(" ");

(async () => {
  if (cmd === "pull") await pullCmd();
  else if (cmd === "speak") await speakCmd(arg);
  else if (cmd === "speak-stdin") await speakStdinCmd();
  else if (cmd === "stats") statsCmd();
  else {
    console.error("Usage:");
    console.error("  organism-telegram.mjs pull");
    console.error("  organism-telegram.mjs speak <text>");
    console.error("  organism-telegram.mjs speak-stdin");
    console.error("  organism-telegram.mjs stats");
    process.exit(1);
  }
})();
