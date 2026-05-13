import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// (1) Load env
const envRaw = readFileSync(resolve(ROOT, 'apps/api/.env'), 'utf-8');
const env = Object.fromEntries(
  envRaw.split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const TOKEN = env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = env.TELEGRAM_CHAT_ID;

if (!TOKEN || !CHAT_ID) {
  const msg = 'DISPATCH FAILED: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID missing from apps/api/.env';
  console.error(msg);
  writeFileSync(resolve(ROOT, '.data/dispatch-proof-warm-replies.json'), JSON.stringify({ error: msg, timestamp: new Date().toISOString() }));
  process.exit(1);
}

// (2) Query warm replies
const DB_PATH = resolve(ROOT, '.data/linkedin-brand-os.sqlite');
const db = new Database(DB_PATH, { readonly: true });

// outreach_emails: status='replied' or reply_body present
const emailRows = db.prepare(`
  SELECT
    COALESCE(l.name, e.business_name) AS name,
    e.business_email AS email,
    e.reply_body AS reply_text,
    e.reply_type,
    e.reply_sentiment,
    e.created_at,
    'email' AS source
  FROM outreach_emails e
  LEFT JOIN leads l ON l.id = e.lead_id
  WHERE (e.status = 'replied' OR (e.reply_body IS NOT NULL AND e.reply_body != ''))
  ORDER BY e.reply_received_at DESC
  LIMIT 10
`).all();

// conversations with stage='replied'
const convRows = db.prepare(`
  SELECT
    prospect_name AS name,
    NULL AS email,
    conversation_history AS reply_text,
    NULL AS reply_type,
    NULL AS reply_sentiment,
    created_at,
    'conversation' AS source
  FROM conversations
  WHERE stage = 'replied'
  ORDER BY last_interaction_at DESC
  LIMIT 10
`).all();

db.close();

const allRows = [...emailRows, ...convRows].slice(0, 10);

// (3) Format Telegram message
function excerpt(text, maxLen) {
  if (!text) return '(no text)';
  const s = text.replace(/\n+/g, ' ').trim();
  return s.length <= maxLen ? s : s.slice(0, maxLen - 1) + '…';
}

function suggestAction(row) {
  const sentiment = (row.reply_sentiment || '').toLowerCase();
  const type = (row.reply_type || '').toLowerCase();
  if (type.includes('hot') || sentiment.includes('positive')) return 'Book call - send calendar link';
  if (type.includes('soft') || type.includes('question') || sentiment.includes('curious')) return 'Answer their question + soft CTA';
  if (type.includes('no') || sentiment.includes('negative')) return 'Polite close - offer to reconnect later';
  return 'Reply with value + ask one qualifying question';
}

let lines = [`WARM REPLIES - ${new Date().toISOString().slice(0, 10)} (${allRows.length} leads)\n`];
allRows.forEach((row, i) => {
  const name = row.name || row.email || 'Unknown';
  const snippet = excerpt(row.reply_text, 120);
  const action = suggestAction(row);
  lines.push(`${i + 1}. ${name}`);
  lines.push(`   Reply: "${snippet}"`);
  lines.push(`   Action: ${action}`);
  lines.push('');
});

let message = lines.join('\n');
if (message.length > 4096) {
  message = message.slice(0, 4090) + '\n...';
}

// (4) POST to Telegram
let result;
try {
  const resp = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text: message }),
  });
  result = await resp.json();
} catch (err) {
  const msg = `DISPATCH FAILED: fetch error - ${err.message}`;
  console.error(msg);
  writeFileSync(resolve(ROOT, '.data/dispatch-proof-warm-replies.json'), JSON.stringify({ error: msg, timestamp: new Date().toISOString() }));
  process.exit(1);
}

// (5) Write proof
const proofPath = resolve(ROOT, '.data/dispatch-proof-warm-replies.json');
if (result.ok) {
  const proof = {
    message_id: result.result.message_id,
    timestamp: new Date().toISOString(),
    leads_dispatched: allRows.length,
  };
  writeFileSync(proofPath, JSON.stringify(proof, null, 2));
  console.log(`DISPATCH PROOF: message_id=${proof.message_id} written`);
} else {
  const err = `DISPATCH FAILED: Telegram API error - ${JSON.stringify(result)}`;
  console.error(err);
  writeFileSync(proofPath, JSON.stringify({ error: err, timestamp: new Date().toISOString() }));
  process.exit(1);
}
