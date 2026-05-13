import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const OUT_PATH = path.resolve('.data/lead-spike-attribution-2026-04-28.json');

const DB_CANDIDATES = [
  '.data/leads.db',
  'db/leads.db',
  '.data/pipeline.db',
  '.data/factory.db',
  '.data/linkedin-brand-os.sqlite',
  '.data/outreach.db',
];

const LEADS_TABLE_ALIASES = ['leads', 'outreach_emails', 'lead', 'prospects'];

let db = null;
let usedDb = null;
let leadsTable = null;

for (const candidate of DB_CANDIDATES) {
  try {
    const d = new Database(path.resolve(candidate), { readonly: true });
    const tables = d.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
    const match = LEADS_TABLE_ALIASES.find(t => tables.includes(t));
    if (match) {
      db = d;
      usedDb = candidate;
      leadsTable = match;
      break;
    }
    d.close();
  } catch (_) {}
}

if (!db) {
  const result = {
    error: 'No database with leads table found',
    candidates_checked: DB_CANDIDATES,
    generated_at: new Date().toISOString(),
  };
  fs.writeFileSync(OUT_PATH, JSON.stringify(result, null, 2));
  console.error('ERROR: No leads table found');
  process.exit(1);
}

console.log(`Using DB: ${usedDb}, table: ${leadsTable}`);

const cols = db.prepare(`PRAGMA table_info(${leadsTable})`).all().map(c => c.name);

const hasSourceChannel = cols.includes('source_channel');
const hasSourceUrl = cols.includes('source_url');
const hasSearchQuery = cols.includes('search_query');
const hasStage = cols.includes('stage');
const hasStatus = cols.includes('status');
const hasSource = cols.includes('source');

const scCol = hasSourceChannel ? 'source_channel' : 'NULL';
const suCol = hasSourceUrl ? 'source_url' : 'NULL';
const sqCol = hasSearchQuery ? 'search_query' : 'NULL';
const stageCol = hasStage ? 'stage' : (hasStatus ? 'status' : 'NULL');
const sourceCol = hasSource ? 'source' : 'NULL';

// Q1: per source_channel breakdown - 24h
const byChannel = db.prepare(`
  SELECT ${scCol} as source_channel, COUNT(*) as cnt
  FROM ${leadsTable}
  WHERE created_at > datetime('now', '-24 hours')
  GROUP BY ${scCol}
  ORDER BY cnt DESC
`).all();

// Q2: per source_url breakdown - 24h (top 30)
const byUrl = db.prepare(`
  SELECT ${suCol} as source_url, COUNT(*) as cnt
  FROM ${leadsTable}
  WHERE created_at > datetime('now', '-24 hours')
  GROUP BY ${suCol}
  ORDER BY cnt DESC
  LIMIT 30
`).all();

// Q3: per search_query breakdown - 24h
const byQuery = db.prepare(`
  SELECT ${sqCol} as search_query, COUNT(*) as cnt
  FROM ${leadsTable}
  WHERE created_at > datetime('now', '-24 hours')
  GROUP BY ${sqCol}
  ORDER BY cnt DESC
  LIMIT 30
`).all();

// Q4: combined channel+url+query - 24h
const combined = db.prepare(`
  SELECT ${scCol} as source_channel, ${suCol} as source_url, ${sqCol} as search_query, COUNT(*) as cnt, MAX(created_at) as latest
  FROM ${leadsTable}
  WHERE created_at > datetime('now', '-24 hours')
  GROUP BY ${scCol}, ${suCol}, ${sqCol}
  ORDER BY cnt DESC
  LIMIT 50
`).all();

// Q5: stage breakdown for 24h leads
const byStage = db.prepare(`
  SELECT ${stageCol} as stage, COUNT(*) as cnt
  FROM ${leadsTable}
  WHERE created_at > datetime('now', '-24 hours')
  GROUP BY ${stageCol}
  ORDER BY cnt DESC
`).all();

// Q6: source script breakdown - 24h
const bySourceScript = db.prepare(`
  SELECT ${sourceCol} as source_script, COUNT(*) as cnt
  FROM ${leadsTable}
  WHERE created_at > datetime('now', '-24 hours')
  GROUP BY ${sourceCol}
  ORDER BY cnt DESC
  LIMIT 20
`).all();

// Q7: time distribution - 24h (hourly buckets)
const byHour = db.prepare(`
  SELECT strftime('%Y-%m-%d %H:00', created_at) as hour_bucket, COUNT(*) as cnt
  FROM ${leadsTable}
  WHERE created_at > datetime('now', '-24 hours')
  GROUP BY hour_bucket
  ORDER BY hour_bucket DESC
`).all();

// Q8: totals
const total24h = db.prepare(`SELECT COUNT(*) as cnt FROM ${leadsTable} WHERE created_at > datetime('now', '-24 hours')`).get();
const totalAll = db.prepare(`SELECT COUNT(*) as cnt FROM ${leadsTable}`).get();
const timeRange = db.prepare(`SELECT MIN(created_at) as earliest, MAX(created_at) as latest FROM ${leadsTable} WHERE created_at > datetime('now', '-24 hours')`).get();

db.close();

// Spike analysis
const total = total24h?.cnt ?? 0;
const uniqueCombos = combined.length;
const topCombo = combined[0] ?? null;
const topShare = total > 0 && topCombo ? topCombo.cnt / total : 0;

let verdict;
let verdictReason;
if (total === 0) {
  verdict = 'no_data';
  verdictReason = 'Zero leads found in 24h window - spike data may be older than 24h or DB is wrong candidate';
} else if (uniqueCombos <= 2 || topShare >= 0.7) {
  verdict = 'artifact';
  verdictReason = `Top combo (${topCombo?.source_channel}/${topCombo?.source_url}) accounts for ${Math.round(topShare * 100)}% of 24h inflow - single repeated source, not diverse external signal`;
} else {
  verdict = 'genuine';
  verdictReason = `${uniqueCombos} distinct source+url+query combos in 24h window - diversified inflow suggests real external demand`;
}

const recommendation = verdict === 'genuine'
  ? 'PROCEED: diverse sources confirm real demand. Resume icp-outreach-bot against these 338 leads when pipeline reopens.'
  : verdict === 'artifact'
  ? `HOLD: spike is a loop artifact from one repeated source (${topCombo?.source_channel}). Do NOT send outreach - deduplicate and audit write-path first.`
  : 'HOLD: no 24h data found. Check if leads were created earlier or if wrong DB was used. Run with db/leads.db explicitly.';

const output = {
  generated_at: new Date().toISOString(),
  cycle: 743,
  db_used: usedDb,
  table_used: leadsTable,
  columns_detected: { source_channel: hasSourceChannel, source_url: hasSourceUrl, search_query: hasSearchQuery, stage: hasStage, source: hasSource },
  totals: {
    leads_24h: total,
    leads_all_time: totalAll?.cnt ?? 'unknown',
    unique_source_combos_24h: uniqueCombos,
    time_range_24h: timeRange,
  },
  verdict,
  verdict_reason: verdictReason,
  recommendation,
  top_combo: topCombo ? {
    source_channel: topCombo.source_channel,
    source_url: topCombo.source_url,
    search_query: topCombo.search_query,
    count: topCombo.cnt,
    share_of_24h: Math.round(topShare * 100) + '%',
    latest: topCombo.latest,
  } : null,
  by_source_channel: byChannel,
  by_source_url: byUrl,
  by_search_query: byQuery,
  by_stage: byStage,
  by_source_script: bySourceScript,
  by_hour: byHour,
  combined_breakdown: combined,
};

fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2));

console.log('=== LEAD SPIKE ATTRIBUTION 2026-04-28 ===');
console.log(`DB: ${usedDb} | table: ${leadsTable}`);
console.log(`Leads in last 24h: ${total} | all-time: ${totalAll?.cnt}`);
console.log(`Unique source combos (24h): ${uniqueCombos}`);
console.log(`Top combo share: ${Math.round(topShare * 100)}%`);
console.log(`Verdict: ${verdict.toUpperCase()}`);
console.log(`Reason: ${verdictReason}`);
console.log(`Recommendation: ${recommendation}`);
console.log(`Output: ${OUT_PATH}`);
