/**
 * touch-monitor.mjs
 * Polls email inbox for replies to logged touches.
 * Matches incoming emails to touch records by sender address.
 * Sends Telegram alert and logs signal to touches.db.
 *
 * Run: node scripts/outreach/touch-monitor.mjs
 * Or add to cron / PM2 on 15-min interval.
 */

import Imap from 'imap';
import { simpleParser } from 'mailparser';
import Database from 'better-sqlite3';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, existsSync } from 'fs';
import { env, tgSendToKirill } from '../factory/orchestrator.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, '../../.data/touches.db');
const SEEN_KEY_PREFIX = 'touch_monitor_seen_';

const IMAP_HOST = env.OUTREACH_IMAP_HOST || 'outlook.office365.com';
const IMAP_PORT = parseInt(env.OUTREACH_IMAP_PORT || '993');
const IMAP_USER = env.OUTREACH_EMAIL;
const IMAP_PASS = env.OUTREACH_PASSWORD;

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

    CREATE TABLE IF NOT EXISTS monitor_seen (
      uid_key TEXT PRIMARY KEY,
      seen_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_touches_email ON touches(email);
    CREATE INDEX IF NOT EXISTS idx_signals_prospect ON signals(prospect_id);
  `);
  return db;
}

function hasSeen(db, uid) {
  return !!db.prepare('SELECT 1 FROM monitor_seen WHERE uid_key = ?').get(SEEN_KEY_PREFIX + uid);
}

function markSeen(db, uid) {
  db.prepare('INSERT OR IGNORE INTO monitor_seen (uid_key) VALUES (?)').run(SEEN_KEY_PREFIX + uid);
}

function findTouchByEmail(db, fromEmail) {
  return db.prepare(`
    SELECT * FROM touches WHERE LOWER(email) = LOWER(?) ORDER BY sent_at DESC LIMIT 1
  `).get(fromEmail);
}

function logSignal(db, { touch_id, prospect_id, channel, signal_type, from_addr, subject, body_snippet }) {
  return db.prepare(`
    INSERT INTO signals (touch_id, prospect_id, channel, signal_type, from_addr, subject, body_snippet)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(touch_id, prospect_id, channel, signal_type, from_addr, subject, body_snippet);
}

function updateTouchStatus(db, id, status) {
  db.prepare('UPDATE touches SET status = ? WHERE id = ?').run(status, id);
}

function fetchUnseenMessages(imap) {
  return new Promise((resolve, reject) => {
    imap.openBox('INBOX', false, (err) => {
      if (err) return reject(err);
      imap.search(['UNSEEN'], (err, uids) => {
        if (err) return reject(err);
        if (!uids || !uids.length) return resolve([]);
        const messages = [];
        const f = imap.fetch(uids, { bodies: '' });
        f.on('message', (msg) => {
          const m = { uid: null, raw: '' };
          msg.on('body', (stream) => {
            let buf = '';
            stream.on('data', (c) => buf += c.toString('utf8'));
            stream.once('end', () => { m.raw = buf; });
          });
          msg.once('attributes', (a) => { m.uid = a.uid; });
          msg.once('end', () => messages.push(m));
        });
        f.once('error', reject);
        f.once('end', () => resolve(messages));
      });
    });
  });
}

async function runImapScan(db) {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: IMAP_USER, password: IMAP_PASS,
      host: IMAP_HOST, port: IMAP_PORT, tls: true,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: 15000, authTimeout: 10000,
    });

    imap.once('ready', async () => {
      try {
        const messages = await fetchUnseenMessages(imap);
        console.log(`[TouchMonitor] ${messages.length} unseen messages`);

        const results = [];

        for (const msg of messages) {
          try {
            const parsed = await simpleParser(msg.raw);
            const uid = String(msg.uid || parsed.messageId || `${Date.now()}`);
            if (hasSeen(db, uid)) continue;
            markSeen(db, uid);

            const fromEmail = (parsed.from?.value?.[0]?.address || '').toLowerCase();
            const subject = parsed.subject || '(no subject)';
            const bodySnippet = (parsed.text || '').slice(0, 400).replace(/\s+/g, ' ').trim();

            const touch = fromEmail ? findTouchByEmail(db, fromEmail) : null;

            if (touch) {
              logSignal(db, {
                touch_id: touch.id,
                prospect_id: touch.prospect_id,
                channel: 'email',
                signal_type: 'reply',
                from_addr: fromEmail,
                subject,
                body_snippet: bodySnippet,
              });
              updateTouchStatus(db, touch.id, 'replied');

              const safe = (s) => String(s || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
              await tgSendToKirill(
                `📩 <b>Ответ на email-касание</b>\n\n` +
                `<b>Prospect:</b> ${safe(touch.prospect_id)}\n` +
                `<b>От:</b> ${safe(fromEmail)}\n` +
                `<b>Тема:</b> ${safe(subject)}\n\n` +
                `${safe(bodySnippet.slice(0, 300))}\n\n` +
                `<b>Касание #${touch.id}</b> отправлено ${touch.sent_at.slice(0, 10)} — <b>отметь следующий шаг!</b>`
              );
              console.log(`[TouchMonitor] Reply matched touch #${touch.id} (${touch.prospect_id})`);
              results.push({ prospect_id: touch.prospect_id, subject });
            } else {
              // Unknown sender - still log as unmatched signal for awareness
              const isNoise = /unsubscribe|noreply|no-reply|newsletter|notification|alert|do-not-reply/i.test(fromEmail);
              if (!isNoise && fromEmail) {
                logSignal(db, {
                  touch_id: null,
                  prospect_id: '_unmatched',
                  channel: 'email',
                  signal_type: 'inbound_unmatched',
                  from_addr: fromEmail,
                  subject,
                  body_snippet: bodySnippet,
                });
              }
            }
          } catch (e) {
            console.warn('[TouchMonitor] message parse error:', e.message);
          }
        }

        imap.end();
        resolve(results);
      } catch (e) {
        imap.end();
        reject(e);
      }
    });

    imap.once('error', reject);
    imap.connect();
  });
}

async function main() {
  if (!IMAP_USER || !IMAP_PASS) {
    console.log('[TouchMonitor] OUTREACH_EMAIL/PASSWORD not set - skipping email scan');
    return;
  }

  const db = openDb();

  try {
    const results = await runImapScan(db);
    console.log(`[TouchMonitor] Done. Matched ${results.length} new replies.`);
  } catch (e) {
    console.error('[TouchMonitor] IMAP error:', e.message);
  } finally {
    db.close();
  }
}

main();
