import Database from "better-sqlite3";
import { readFileSync, readdirSync, appendFileSync, existsSync } from "fs";
import { resolve, dirname, extname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

function loadEnv() {
  const paths = [
    resolve(ROOT, "apps/api/.env"),
    resolve(ROOT, ".env"),
  ];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    const lines = readFileSync(p, "utf-8").split("\n");
    for (const line of lines) {
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const i = line.indexOf("=");
      const key = line.slice(0, i).trim();
      const val = line.slice(i + 1).trim();
      if (val && !process.env[key]) process.env[key] = val;
    }
  }
}

loadEnv();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

if (!BOT_TOKEN || !CHAT_ID) {
  console.log("FAILED: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not found in env");
  process.exit(1);
}

const DB_PATH = resolve(ROOT, ".data/linkedin-brand-os.sqlite");
const LOG_PATH = resolve(ROOT, ".data/warm-reply-dispatch.log");
const REPLY_SCRIPTS_DIR = resolve(ROOT, ".data/reply-scripts");

const db = new Database(DB_PATH);

const leads = db.prepare(`
  SELECT id, name, company, stage, outreach_status, notes, updated_at
  FROM leads
  WHERE outreach_status LIKE '%repl%'
     OR stage = 'replied'
     OR notes LIKE '%replied%'
  ORDER BY updated_at DESC
  LIMIT 7
`).all();

db.close();

const replyScripts = [];
if (existsSync(REPLY_SCRIPTS_DIR)) {
  const files = readdirSync(REPLY_SCRIPTS_DIR).filter(f => [".txt", ".md"].includes(extname(f)));
  for (const f of files) {
    const content = readFileSync(resolve(REPLY_SCRIPTS_DIR, f), "utf-8").trim();
    replyScripts.push({ file: f, content });
  }
}

const top3 = leads.slice(0, 3);

function esc(s) {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildMessage() {
  let msg = "<b>WARM REPLIES - ACTION REQUIRED</b>\n\n";

  if (top3.length === 0) {
    msg += "No warm replies found in DB matching status/stage/notes criteria.\n";
  } else {
    top3.forEach((lead, i) => {
      const name = esc(lead.name || "Unknown");
      const company = lead.company ? esc(lead.company) : "no company";
      const excerpt = esc((lead.notes || "").slice(0, 200));
      const script = replyScripts[i]
        ? replyScripts[i].content.split("\n").find(l => l.trim()) || ""
        : "Review and draft a personal follow-up response";
      msg += `<b>${i + 1}. ${name}</b> (${company})\n`;
      msg += `Reply: ${excerpt || "no notes"}\n`;
      msg += `Reply with: ${esc(script.slice(0, 120))}\n\n`;
    });
  }

  if (replyScripts.length > 0) {
    msg += `<b>Reply scripts available:</b> ${replyScripts.map(r => r.file).join(", ")}\n`;
  }

  return msg;
}

const messageText = buildMessage();

const payload = {
  chat_id: CHAT_ID,
  text: messageText,
  parse_mode: "HTML",
};

const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

const res = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});

const data = await res.json();

if (data.ok) {
  const messageId = data.result.message_id;
  const ts = new Date().toISOString();
  const logLine = `${ts} message_id=${messageId} leads=${top3.length} scripts=${replyScripts.length}\n`;
  appendFileSync(LOG_PATH, logLine);
  console.log(`DISPATCHED message_id=${messageId}`);
} else {
  const reason = JSON.stringify(data);
  const ts = new Date().toISOString();
  appendFileSync(LOG_PATH, `${ts} FAILED: ${reason}\n`);
  console.log(`FAILED: ${reason}`);
  process.exit(1);
}
