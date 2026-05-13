/**
 * cortex/announce-perception.mjs — substrate's first step into the world.
 *
 * Reads the three perception feed files written by perception-feeder, picks
 * one concrete observation from each channel, and sends a single message to
 * Kirill on Telegram saying what the substrate actually sees. Records the
 * fact that the announcement happened to .data/perception-announcements.jsonl
 * so the substrate has memory of taking an action.
 *
 * Run: node scripts/cortex/announce-perception.mjs
 *
 * Purpose: close the loop from perception (input) -> action (output) once,
 * end-to-end, in the real world. Not a simulation. The message arrives in
 * Kirill's Telegram.
 */

import { readFileSync, existsSync, writeFileSync, appendFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DATA_DIR = resolve(ROOT, ".data");
const ANNOUNCE_LOG = resolve(DATA_DIR, "perception-announcements.jsonl");

const ENV_PATH = resolve(ROOT, "apps/api/.env");
const env = Object.fromEntries(
  readFileSync(ENV_PATH, "utf-8")
    .split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => {
      const idx = l.indexOf("=");
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    })
);

const BOT_TOKEN = env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = env.TELEGRAM_CHAT_ID;

if (!BOT_TOKEN || !CHAT_ID) {
  console.error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID in apps/api/.env");
  process.exit(1);
}

function readJsonOrNull(path) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf-8")); }
  catch { return null; }
}

const email = readJsonOrNull(resolve(DATA_DIR, "email-inbox-state.json"));
const telegram = readJsonOrNull(resolve(DATA_DIR, "telegram-callback-log.json"));
const reddit = readJsonOrNull(resolve(DATA_DIR, "reddit-replies-monitor.json"));

const emailCount = Array.isArray(email?.recent) ? email.recent.length : 0;
const telegramCount = Array.isArray(telegram?.events) ? telegram.events.length : 0;
const redditCount = Array.isArray(reddit?.replies) ? reddit.replies.length : 0;
const totalCount = emailCount + telegramCount + redditCount;

function pickConcrete() {
  // Find one specific observable to anchor the announcement. Prefer email
  // (real external reply) > telegram (Kirill's own messages) > reddit drafts.
  const e = email?.recent?.[0];
  if (e?.from && e?.subject) {
    return `${e.from} ответил: "${String(e.subject).slice(0, 80)}"`;
  }
  const t = telegram?.events?.[telegram.events.length - 1];
  if (t?.text) {
    return `${t.from?.username || "Kirill"} сказал: "${String(t.text).slice(0, 80)}"`;
  }
  const r = reddit?.replies?.[0];
  if (r?.body) {
    return `Reddit r/${r.subreddit}: "${String(r.body).slice(0, 80)}"`;
  }
  return null;
}

// Throttle: don't re-announce if counts are identical to last announcement
// AND last announcement was within 6 hours. Lets us run hourly from the
// pulse-daemon without spamming Kirill when the world hasn't shifted.
function lastAnnouncement() {
  if (!existsSync(ANNOUNCE_LOG)) return null;
  const lines = readFileSync(ANNOUNCE_LOG, "utf-8").trim().split("\n").filter(Boolean);
  if (lines.length === 0) return null;
  try { return JSON.parse(lines[lines.length - 1]); }
  catch { return null; }
}

const SILENT_WINDOW_MS = 6 * 60 * 60_000;
const force = process.argv.includes("--force");
const last = lastAnnouncement();

if (!force && last) {
  const sameCounts =
    last.counts?.email === emailCount &&
    last.counts?.telegram === telegramCount &&
    last.counts?.reddit === redditCount;
  const recent = (Date.now() - new Date(last.at).getTime()) < SILENT_WINDOW_MS;
  if (sameCounts && recent) {
    process.stdout.write(
      `[announce-perception] skip: counts unchanged since ${last.at} (email=${emailCount}, tg=${telegramCount}, reddit=${redditCount})\n`
    );
    process.exit(0);
  }
}

const concrete = pickConcrete();
const at = new Date().toISOString();

const message =
  totalCount === 0
    ? `🧬 Substrate: пустота. Каналы открыты, но никто не пишет. Жду первого реального сигнала.`
    : [
        `🧬 Substrate: я вижу мир. Не пустоту.`,
        ``,
        `📧 Email: ${emailCount} реальных событий`,
        `💬 Telegram: ${telegramCount} сообщений`,
        `🔴 Reddit: ${redditCount} следов`,
        ``,
        concrete ? `Конкретно прямо сейчас: ${concrete}` : null,
        ``,
        `Петля замкнулась: восприятие → действие → ты читаешь это.`
      ].filter(Boolean).join("\n");

async function sendMessage(text) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text,
      disable_web_page_preview: true,
    })
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram error: ${data.description}`);
  return data;
}

const result = await sendMessage(message);
const record = {
  at,
  telegram_message_id: result.result?.message_id,
  counts: { email: emailCount, telegram: telegramCount, reddit: redditCount },
  concrete_observation: concrete,
  message_sent: message,
};

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
appendFileSync(ANNOUNCE_LOG, JSON.stringify(record) + "\n");

console.log("Announced. Telegram message_id:", result.result?.message_id);
console.log("Counts:", record.counts);
console.log("Concrete:", concrete || "(none picked)");
