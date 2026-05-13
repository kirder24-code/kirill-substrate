/**
 * Purge HN artifact leads from the spike confirmed in cycle764.
 * Marks (does NOT delete) leads matching the artifact pattern:
 *   - source_channel IS NULL (column may not exist - treated as all rows missing it)
 *   - OR source_url contains 'news.ycombinator.com'
 *   - AND created within the last 48 hours
 *
 * Sets stage='purged', notes='artifact-hn-spike', logs count to .data/purge-result.txt
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const DB_PATH = '.data/linkedin-brand-os.sqlite';
const LOG_PATH = '.data/purge-result.txt';

const db = new Database(path.resolve(DB_PATH));

// Check if source_channel column exists
const cols = db.prepare("PRAGMA table_info(leads)").all().map(r => r.name);
const hasSourceChannel = cols.includes('source_channel');

const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

let countQuery;
let updateQuery;

if (hasSourceChannel) {
  countQuery = db.prepare(`
    SELECT COUNT(*) as n FROM leads
    WHERE (source_channel IS NULL OR source_url LIKE '%news.ycombinator.com%')
      AND created_at >= ?
      AND stage != 'purged'
  `);
  updateQuery = db.prepare(`
    UPDATE leads
    SET stage = 'purged',
        notes = CASE WHEN notes IS NULL OR notes = '' THEN 'artifact-hn-spike' ELSE notes || ' | artifact-hn-spike' END,
        updated_at = datetime('now')
    WHERE (source_channel IS NULL OR source_url LIKE '%news.ycombinator.com%')
      AND created_at >= ?
      AND stage != 'purged'
  `);
} else {
  // source_channel column does not exist - target only source_url pattern
  // All rows effectively have source_channel=NULL; narrow to HN url to avoid mass purge
  countQuery = db.prepare(`
    SELECT COUNT(*) as n FROM leads
    WHERE source_url LIKE '%news.ycombinator.com%'
      AND created_at >= ?
      AND stage != 'purged'
  `);
  updateQuery = db.prepare(`
    UPDATE leads
    SET stage = 'purged',
        notes = CASE WHEN notes IS NULL OR notes = '' THEN 'artifact-hn-spike' ELSE notes || ' | artifact-hn-spike' END,
        updated_at = datetime('now')
    WHERE source_url LIKE '%news.ycombinator.com%'
      AND created_at >= ?
      AND stage != 'purged'
  `);
}

const { n: affected } = countQuery.get(cutoff);

console.log(`source_channel column exists: ${hasSourceChannel}`);
console.log(`Rows matching artifact pattern (last 48h): ${affected}`);

if (affected === 0) {
  const msg = `[${new Date().toISOString()}] purge-hn-artifact: 0 rows matched - nothing to mark\n`;
  fs.appendFileSync(path.resolve(LOG_PATH), msg);
  console.log('No rows to update. Logged to', LOG_PATH);
  db.close();
  process.exit(0);
}

const result = updateQuery.run(cutoff);

const logLine = `[${new Date().toISOString()}] purge-hn-artifact: marked ${result.changes} leads as purged (artifact-hn-spike) from last 48h. DB=${DB_PATH}\n`;
fs.appendFileSync(path.resolve(LOG_PATH), logLine);

console.log(`Updated: ${result.changes} rows set to stage='purged', notes='artifact-hn-spike'`);
console.log(`Logged to ${LOG_PATH}`);

db.close();
