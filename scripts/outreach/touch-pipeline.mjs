/**
 * touch-pipeline.mjs
 * Revenue pipeline view across all market touch channels.
 * Shows hot prospects (replied), active (sent, no reply), and signal history.
 * Optionally sends summary to Telegram.
 *
 * Run: node scripts/outreach/touch-pipeline.mjs [--tg]
 *   --tg  also send summary to Telegram
 */

import Database from 'better-sqlite3';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, '../../.data/touches.db');

function openDb() {
  if (!existsSync(DB_PATH)) {
    console.log('[TouchPipeline] No touches DB yet. Log your first touch:');
    console.log('  node scripts/outreach/touch-log.mjs email prospect_name --email addr@co.com --subject "..."');
    process.exit(0);
  }
  return new Database(DB_PATH, { readonly: true });
}

function formatAge(isoDate) {
  const ms = Date.now() - new Date(isoDate).getTime();
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  return 'just now';
}

function main() {
  const sendTg = process.argv.includes('--tg');
  const db = openDb();

  // Counts by status
  const stats = db.prepare(`
    SELECT status, COUNT(*) as cnt FROM touches GROUP BY status
  `).all();

  const totalTouches = stats.reduce((s, r) => s + r.cnt, 0);
  const replied = stats.find(r => r.status === 'replied')?.cnt || 0;
  const sent = stats.find(r => r.status === 'sent')?.cnt || 0;

  // Hot prospects: have signals (replies)
  const hot = db.prepare(`
    SELECT t.prospect_id, t.channel, t.email, t.sent_at, t.status,
           s.signal_type, s.from_addr, s.subject as reply_subject, s.received_at
    FROM touches t
    JOIN signals s ON s.touch_id = t.id
    WHERE s.signal_type = 'reply'
    ORDER BY s.received_at DESC
    LIMIT 10
  `).all();

  // Active (sent, no reply yet), oldest first for urgency
  const active = db.prepare(`
    SELECT prospect_id, channel, email, subject, sent_at, notes
    FROM touches
    WHERE status = 'sent'
    ORDER BY sent_at ASC
    LIMIT 15
  `).all();

  // Channel breakdown
  const byChannel = db.prepare(`
    SELECT channel, COUNT(*) as cnt FROM touches GROUP BY channel ORDER BY cnt DESC
  `).all();

  // Recent signals (all types)
  const recentSignals = db.prepare(`
    SELECT signal_type, prospect_id, from_addr, subject, received_at
    FROM signals
    ORDER BY received_at DESC
    LIMIT 8
  `).all();

  // Unmatched inbound (potential cold inbound)
  const unmatched = db.prepare(`
    SELECT from_addr, subject, received_at
    FROM signals
    WHERE prospect_id = '_unmatched'
    ORDER BY received_at DESC
    LIMIT 5
  `).all();

  // --- Console output ---
  console.log('\n====== TOUCH PIPELINE ======');
  console.log(`Total touches: ${totalTouches}  |  Replied: ${replied}  |  Waiting: ${sent}`);
  console.log('');

  if (byChannel.length) {
    console.log('Channels:');
    byChannel.forEach(r => console.log(`  ${r.channel.padEnd(20)} ${r.cnt}`));
    console.log('');
  }

  if (hot.length) {
    console.log('--- HOT (replied) ---');
    hot.forEach(r => {
      console.log(`  [${r.channel}] ${r.prospect_id}`);
      if (r.reply_subject) console.log(`    reply: "${r.reply_subject}"`);
      console.log(`    replied ${formatAge(r.received_at)}`);
    });
    console.log('');
  }

  if (active.length) {
    console.log('--- ACTIVE (no reply yet) ---');
    active.forEach(r => {
      const age = formatAge(r.sent_at);
      const detail = r.subject ? ` "${r.subject}"` : r.notes ? ` - ${r.notes}` : '';
      console.log(`  [${r.channel}] ${r.prospect_id}${detail} (${age})`);
    });
    console.log('');
  }

  if (unmatched.length) {
    console.log('--- UNMATCHED INBOUND ---');
    unmatched.forEach(r => {
      console.log(`  ${r.from_addr} - "${r.subject}" (${formatAge(r.received_at)})`);
    });
    console.log('');
  }

  if (recentSignals.length) {
    console.log('--- RECENT SIGNALS ---');
    recentSignals.forEach(r => {
      console.log(`  [${r.signal_type}] ${r.prospect_id} - ${r.from_addr || r.subject || ''} (${formatAge(r.received_at)})`);
    });
    console.log('');
  }

  // --- Telegram output (optional) ---
  if (sendTg) {
    import('../factory/orchestrator.mjs').then(({ tgSendToKirill }) => {
      const hotLines = hot.slice(0, 5).map(r =>
        `  - ${r.prospect_id} [${r.channel}] replied ${formatAge(r.received_at)}`
      ).join('\n');

      const activeLines = active.slice(0, 8).map(r =>
        `  - ${r.prospect_id} [${r.channel}] (${formatAge(r.sent_at)})`
      ).join('\n');

      const channelLines = byChannel.map(r => `  ${r.channel}: ${r.cnt}`).join('\n');

      let msg = `📊 <b>Touch Pipeline</b>\n`;
      msg += `Всего: ${totalTouches} | Ответили: ${replied} | Ждут: ${sent}\n\n`;

      if (byChannel.length) msg += `<b>По каналам:</b>\n${channelLines}\n\n`;

      if (hot.length) {
        msg += `<b>🔥 Горячие (ответили):</b>\n${hotLines}\n\n`;
      }
      if (active.length) {
        msg += `<b>⏳ Активные (нет ответа):</b>\n${activeLines}\n`;
      }

      if (!hot.length && !active.length) {
        msg += 'Нет активных касаний. Логируй первое: touch-log.mjs';
      }

      tgSendToKirill(msg).then(() => {
        console.log('[TouchPipeline] Telegram sent');
        db.close();
      }).catch(e => {
        console.error('[TouchPipeline] Telegram error:', e.message);
        db.close();
      });
    });
  } else {
    db.close();
  }
}

main();
