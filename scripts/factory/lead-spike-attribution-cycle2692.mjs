import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

const OUT_PATH = resolve(ROOT, '.data/LEAD-SPIKE-ATTRIBUTION-CYCLE2692.json');
const FLAG_PATH = resolve(ROOT, '.data/RUN-ENRICHMENT-NOW.flag');

// Primary DB where scout bots actually write leads
const DB_PATH = resolve(ROOT, '.data/linkedin-brand-os.sqlite');

let db;
try {
  db = new Database(DB_PATH, { readonly: true });
} catch (e) {
  const result = {
    total_leads_last_2h: 0,
    by_source_channel: {},
    top_source_urls: [],
    top_search_queries: [],
    spike_is_real: false,
    spike_assessment: `no_data - DB open failed: ${e.message}`,
    recommendation: 'HOLD: cannot attribute spike - DB not accessible',
    generated_at: new Date().toISOString(),
  };
  fs.writeFileSync(OUT_PATH, JSON.stringify(result, null, 2));
  process.exit(1);
}

const cols = db.prepare('PRAGMA table_info(leads)').all().map(c => c.name);

// Map to actual column names present in this schema
const scCol = cols.includes('source_channel') ? 'source_channel'
  : cols.includes('source_platform') ? 'source_platform'
  : cols.includes('source') ? 'source'
  : 'NULL';

const suCol = cols.includes('source_url') ? 'source_url' : 'NULL';
const sqCol = cols.includes('search_query') ? 'search_query' : 'NULL';

const total2h = db.prepare(`SELECT COUNT(*) as n FROM leads WHERE created_at > datetime('now', '-2 hours')`).get().n ?? 0;

const byChannelRows = db.prepare(`
  SELECT ${scCol} as source_channel, COUNT(*) as cnt
  FROM leads
  WHERE created_at > datetime('now', '-2 hours')
  GROUP BY ${scCol}
  ORDER BY cnt DESC
`).all();

const topUrlRows = db.prepare(`
  SELECT ${suCol} as source_url, COUNT(*) as cnt
  FROM leads
  WHERE created_at > datetime('now', '-2 hours')
  GROUP BY ${suCol}
  ORDER BY cnt DESC
  LIMIT 5
`).all();

const topQueryRows = sqCol !== 'NULL' ? db.prepare(`
  SELECT ${sqCol} as search_query, COUNT(*) as cnt
  FROM leads
  WHERE created_at > datetime('now', '-2 hours')
  GROUP BY ${sqCol}
  ORDER BY cnt DESC
  LIMIT 5
`).all() : [];

db.close();

// Build by_source_channel object
const bySourceChannel = {};
for (const row of byChannelRows) {
  bySourceChannel[row.source_channel ?? 'unknown'] = row.cnt;
}

const extractDomain = (url) => {
  if (!url) return null;
  try { return new URL(url).hostname; } catch { return url; }
};

// Spike assessment
let spikeIsReal = false;
let spikeAssessment = '';
let recommendation = '';

if (total2h === 0) {
  spikeAssessment = 'no_data - zero leads in last 2 hours';
  recommendation = 'HOLD: no recent leads to attribute. Spike may be older than 2h window.';
} else {
  const topUrl = topUrlRows[0] ?? null;
  const topQuery = topQueryRows[0] ?? null;
  const topUrlShare = topUrl ? topUrl.cnt / total2h : 0;
  const topQueryShare = topQuery ? topQuery.cnt / total2h : 0;

  const channelCount = Object.keys(bySourceChannel).filter(k => k !== 'unknown' && k !== 'null' && k !== 'NULL').length;
  // Count total distinct URLs in the 2h window (not just top 5) to check for looping
  const topUrlIsDuplicated = topUrl && topUrl.cnt > 1;

  if (topUrlShare > 0.8) {
    spikeIsReal = false;
    spikeAssessment = `looped artifact - ${Math.round(topUrlShare * 100)}% of leads share source_url "${topUrl?.source_url}"`;
    recommendation = `HOLD: spike is a loop artifact. Top URL accounts for ${Math.round(topUrlShare * 100)}% of 2h inflow. Do NOT enrich - deduplicate and audit write-path first.`;
  } else if (topQueryShare > 0.8) {
    spikeIsReal = false;
    spikeAssessment = `looped artifact - ${Math.round(topQueryShare * 100)}% of leads share search_query "${topQuery?.search_query}"`;
    recommendation = `HOLD: spike is a loop artifact. Top query accounts for ${Math.round(topQueryShare * 100)}% of 2h inflow. Do NOT enrich - deduplicate and audit write-path first.`;
  } else if (channelCount >= 2 && !topUrlIsDuplicated) {
    // Diverse channels + each URL appears only once = genuine external inflow
    spikeIsReal = true;
    spikeAssessment = `genuine - ${channelCount} distinct channels, top URL share ${Math.round(topUrlShare * 100)}% (each URL unique = no looping detected)`;
    recommendation = `PROCEED: diverse sources confirm real demand. ${total2h} leads from ${channelCount} channels with no repeated URLs. Enrichment flag written - proceed with enrichment pipeline.`;
  } else if (channelCount < 2) {
    spikeIsReal = false;
    spikeAssessment = `ambiguous - only ${channelCount} distinct channel(s). Single source not sufficient to confirm genuine spike.`;
    recommendation = `HOLD: insufficient channel diversity (${channelCount} channel(s)). Investigate write-path before enriching.`;
  } else {
    spikeIsReal = false;
    spikeAssessment = `ambiguous - top URL appears ${topUrl?.cnt} times, channels=${channelCount}. Possible partial loop.`;
    recommendation = `HOLD: repeated URL entries detected. Deduplicate and recheck before enriching.`;
  }
}

const output = {
  total_leads_last_2h: total2h,
  by_source_channel: bySourceChannel,
  top_source_urls: topUrlRows.map(r => ({ url: r.source_url, count: r.cnt })),
  top_search_queries: topQueryRows.map(r => ({ query: r.search_query, count: r.cnt })),
  spike_is_real: spikeIsReal,
  spike_assessment: spikeAssessment,
  recommendation,
  generated_at: new Date().toISOString(),
  cycle: 2692,
  db_used: DB_PATH,
  columns_detected: { source_channel: scCol, source_url: suCol !== 'NULL', search_query: sqCol !== 'NULL', channel_count: Object.keys(bySourceChannel).length },
};

fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2));

if (spikeIsReal) {
  fs.writeFileSync(FLAG_PATH, '');
  console.log('FLAG written:', FLAG_PATH);
}

console.log('=== LEAD SPIKE ATTRIBUTION CYCLE2692 (2h window) ===');
console.log(`DB: ${DB_PATH}`);
console.log(`Leads in last 2h: ${total2h}`);
console.log(`spike_is_real: ${spikeIsReal}`);
console.log(`Assessment: ${spikeAssessment}`);
console.log(`Recommendation: ${recommendation}`);
console.log(`Output: ${OUT_PATH}`);
