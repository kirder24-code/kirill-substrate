import { readFileSync, existsSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const ENV_PATH = resolve(ROOT, "apps/api/.env");
const LOG_PATH = resolve(ROOT, ".data/warm-reply-dispatch-log.json");

const env = Object.fromEntries(
  readFileSync(ENV_PATH, "utf-8")
    .split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const TOKEN = env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = env.TELEGRAM_CHAT_ID;

if (!TOKEN || !CHAT_ID) {
  console.error("FATAL: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing from .env");
  process.exit(1);
}

function esc(str) {
  return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function tgSend(text, replyMarkup) {
  const body = { chat_id: CHAT_ID, text, parse_mode: "HTML" };
  if (replyMarkup) body.reply_markup = replyMarkup;
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12000),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`Telegram error: ${JSON.stringify(json)}`);
  return json.result.message_id;
}

function loadDraftFiles() {
  const candidates = [
    resolve(ROOT, ".data/warm-reply-drafts-v5.json"),
    resolve(ROOT, ".data/warm-reply-drafts-v4.json"),
    resolve(ROOT, ".data/warm-reply-drafts-v3.json"),
    resolve(ROOT, ".data/warm-reply-drafts-v2.json"),
    resolve(ROOT, ".data/warm-reply-drafts-v1.json"),
    resolve(ROOT, ".data/warm-reply-drafts.json"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        const data = JSON.parse(readFileSync(p, "utf-8"));
        if (Array.isArray(data) && data.length > 0) {
          console.log(`Loaded drafts from: ${p} (${data.length} drafts)`);
          return data;
        }
      } catch {
        continue;
      }
    }
  }
  return null;
}

function loadFromDB() {
  const dbPath = resolve(ROOT, ".data/linkedin-brand-os.sqlite");
  if (!existsSync(dbPath)) return [];
  const db = new Database(dbPath, { readonly: true });

  const convs = db.prepare(`
    SELECT id, prospect_name, platform, channel, prospect_pain, conversation_history, next_action
    FROM conversations
    WHERE stage IN ('replied', 'warming')
    ORDER BY last_interaction_at DESC NULLS LAST
    LIMIT 10
  `).all();
  db.close();

  return convs.map(c => {
    let lastReply = "(no reply text)";
    if (c.conversation_history) {
      try {
        const hist = JSON.parse(c.conversation_history);
        const prospectMsgs = Array.isArray(hist)
          ? hist.filter(m => m.role === "prospect" || m.from === "prospect").slice(-1)
          : [];
        if (prospectMsgs.length > 0) {
          lastReply = (prospectMsgs[0].content || prospectMsgs[0].text || "").slice(0, 200);
        }
      } catch {
        lastReply = String(c.conversation_history).slice(0, 200);
      }
    } else if (c.prospect_pain) {
      lastReply = c.prospect_pain.slice(0, 200);
    }

    const draft = [
      `- Good to hear from you - what does your current process look like for that?`,
      `- I work with small teams to cut manual coordination time - sounds like that might be relevant.`,
      `- Worth a quick 15-min call to see if there is a fit?`,
    ].join("\n");

    return {
      lead_id: c.id,
      name: c.prospect_name || "Unknown",
      platform: c.platform || "reddit",
      last_reply_text: lastReply,
      draft,
    };
  });
}

async function main() {
  let drafts = loadDraftFiles();
  let source = "file";

  if (!drafts || drafts.length === 0) {
    console.log("No draft files found - falling back to DB query");
    drafts = loadFromDB();
    source = "db";
  }

  if (drafts.length === 0) {
    console.log("No warm reply drafts found in files or DB");
    writeFileSync(LOG_PATH, JSON.stringify({ dispatched_at: new Date().toISOString(), count: 0, source, message_ids: [] }, null, 2));
    process.exit(0);
  }

  console.log(`Dispatching ${drafts.length} warm reply card(s) to Telegram...`);

  const messageIds = [];

  for (const draft of drafts) {
    const name = esc(draft.name || "Unknown");
    const replyText = esc((draft.last_reply_text || draft.based_on || "").slice(0, 250));
    const followUp = esc(draft.draft || draft.next_action_suggestion || "(no draft)");
    const id = draft.lead_id || draft.id || name;

    const text =
      `<b>WARM REPLY - ${name}</b>\n\n` +
      `<b>Their reply:</b>\n${replyText}\n\n` +
      `<b>Proposed follow-up:</b>\n${followUp}`;

    const replyMarkup = {
      inline_keyboard: [[
        { text: "Send It", callback_data: `send_followup:${id}` },
        { text: "Skip", callback_data: `skip_followup:${id}` },
      ]],
    };

    try {
      const msgId = await tgSend(text, replyMarkup);
      messageIds.push(msgId);
      console.log(`Sent card for ${name} - message_id=${msgId}`);
    } catch (err) {
      console.error(`Failed to send card for ${name}: ${err.message}`);
    }
  }

  const log = {
    dispatched_at: new Date().toISOString(),
    count: messageIds.length,
    source,
    drafts_total: drafts.length,
    message_ids: messageIds,
  };
  writeFileSync(LOG_PATH, JSON.stringify(log, null, 2));
  console.log(`Done. ${messageIds.length}/${drafts.length} cards sent. Log: ${LOG_PATH}`);
}

main().catch(err => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
