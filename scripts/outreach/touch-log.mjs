/**
 * touch-log.mjs
 * Manually log any market touch (Reddit, email, site) into unified touches DB.
 *
 * Usage:
 *   node scripts/outreach/touch-log.mjs <channel> <prospect_id> [--subject <s>] [--url <u>] [--notes <n>] [--email <e>]
 *
 * Channels: email | reddit_comment | reddit_dm | site_contact | linkedin_comment | linkedin_dm
 *
 * Examples:
 *   node scripts/outreach/touch-log.mjs reddit_comment r/entrepreneur_joe --url https://reddit.com/r/... --notes "offered audit"
 *   node scripts/outreach/touch-log.mjs email acme_corp --subject "AI workflow audit" --email ceo@acme.com
 *   node scripts/outreach/touch-log.mjs linkedin_comment saas_founder_anna --url https://linkedin.com/...
 */

import Database from 'better-sqlite3';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, '../../.data/touches.db');

const VALID_CHANNELS = [
  'email', 'reddit_comment', 'reddit_dm',
  'site_contact', 'linkedin_comment', 'linkedin_dm'
];

function openDb() {
  const dir = resolve(__dirname, '../../.data');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS touches (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      prospect_id TEXT    NOT NULL,
      channel     TEXT    NOT NULL,
      subject     TEXT,
      url         TEXT,
      email       TEXT,
      notes       TEXT,
      sent_at     TEXT    NOT NULL DEFAULT (datetime('now')),
      status      TEXT    NOT NULL DEFAULT 'sent'
    );

    CREATE TABLE IF NOT EXISTS signals (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      touch_id    INTEGER,
      prospect_id TEXT    NOT NULL,
      channel     TEXT    NOT NULL,
      signal_type TEXT    NOT NULL,
      from_addr   TEXT,
      subject     TEXT,
      body_snippet TEXT,
      url         TEXT,
      notes       TEXT,
      received_at TEXT    NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (touch_id) REFERENCES touches(id)
    );

    CREATE INDEX IF NOT EXISTS idx_touches_prospect ON touches(prospect_id);
    CREATE INDEX IF NOT EXISTS idx_touches_email ON touches(email);
    CREATE INDEX IF NOT EXISTS idx_signals_prospect ON signals(prospect_id);
  `);
  return db;
}

function parseArgs(argv) {
  const args = { channel: null, prospect_id: null, subject: null, url: null, notes: null, email: null };
  const positional = [];
  let i = 0;
  while (i < argv.length) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      args[key] = argv[i + 1] || '';
      i += 2;
    } else {
      positional.push(argv[i]);
      i++;
    }
  }
  args.channel = positional[0] || null;
  args.prospect_id = positional[1] || null;
  return args;
}

function usage() {
  console.error('Usage: node scripts/outreach/touch-log.mjs <channel> <prospect_id> [--subject s] [--url u] [--notes n] [--email e]');
  console.error(`Channels: ${VALID_CHANNELS.join(' | ')}`);
  process.exit(1);
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.channel || !args.prospect_id) usage();
  if (!VALID_CHANNELS.includes(args.channel)) {
    console.error(`Invalid channel: ${args.channel}`);
    usage();
  }

  const db = openDb();

  const result = db.prepare(`
    INSERT INTO touches (prospect_id, channel, subject, url, email, notes)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(args.prospect_id, args.channel, args.subject, args.url, args.email, args.notes);

  const touch = db.prepare('SELECT * FROM touches WHERE id = ?').get(result.lastInsertRowid);

  console.log(`[TouchLog] Logged touch #${touch.id}`);
  console.log(`  prospect: ${touch.prospect_id}`);
  console.log(`  channel:  ${touch.channel}`);
  if (touch.email)   console.log(`  email:    ${touch.email}`);
  if (touch.subject) console.log(`  subject:  ${touch.subject}`);
  if (touch.url)     console.log(`  url:      ${touch.url}`);
  if (touch.notes)   console.log(`  notes:    ${touch.notes}`);
  console.log(`  sent_at:  ${touch.sent_at}`);

  db.close();
}

main();
