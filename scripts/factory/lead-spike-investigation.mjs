import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const OUT_PATH = path.resolve('.data/lead-spike-investigation.json');

// Try multiple DB paths - find the one with a leads table
const DB_CANDIDATES = [
  '.data/linkedin-brand-os.sqlite',
  'apps/api/.data/linkedin-brand-os.sqlite',
  'db.sqlite',
  '.data/leads.db',
  'db/leads.db',
  '.data/pipeline.db',
  '.data/outreach.db',
  '.data/factory.db',
];

// Also check for outreach_emails as the leads table equivalent
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
  } catch (_) {
    // not found or not a valid db
  }
}

if (!db) {
  const result = {
    error: 'No database with leads/outreach_emails table found',
    candidates_checked: DB_CANDIDATES,
    generated_at: new Date().toISOString(),
  };
  fs.writeFileSync(OUT_PATH, JSON.stringify(result, null, 2));
  console.error('ERROR: No leads table found in any candidate DB');
  process.exit(1);
}

console.log(`Using DB: ${usedDb}, table: ${leadsTable}`);

// Detect column names to handle both 'leads' and 'outreach_emails' schemas
const cols = db.prepare(`PRAGMA table_info(${leadsTable})`).all().map(c => c.name);
const hasStage = cols.includes('stage');
const hasSource = cols.includes('source');
const hasStatus = cols.includes('status');

// Use 'status' as stage equivalent if no stage column
const stageCol = hasStage ? 'stage' : (hasStatus ? 'status' : 'NULL');
const sourceCol = hasSource ? 'source' : 'NULL';

// Q1: source breakdown for last 6h
const q1 = db.prepare(`
  SELECT ${sourceCol} as source, COUNT(*) as count, MAX(created_at) as latest_created
  FROM ${leadsTable}
  WHERE created_at > datetime('now', '-6 hours')
  GROUP BY ${sourceCol}
  ORDER BY count DESC
`).all();

// Q2: stage breakdown for last 6h
const q2 = db.prepare(`
  SELECT ${stageCol} as stage, COUNT(*) as count
  FROM ${leadsTable}
  WHERE created_at > datetime('now', '-6 hours')
  GROUP BY ${stageCol}
`).all();

// Q3: time range of last 6h spike
const q3 = db.prepare(`
  SELECT MIN(created_at) as earliest, MAX(created_at) as latest
  FROM ${leadsTable}
  WHERE created_at > datetime('now', '-6 hours')
`).get();

// Q4: total lead count for context
const totalRow = db.prepare(`SELECT COUNT(*) as total FROM ${leadsTable}`).get();

// Q5: wider 24h window in case 6h shows nothing
const q5 = db.prepare(`
  SELECT ${sourceCol} as source, COUNT(*) as count, MAX(created_at) as latest_created
  FROM ${leadsTable}
  WHERE created_at > datetime('now', '-24 hours')
  GROUP BY ${sourceCol}
  ORDER BY count DESC
`).all();

// Q6: all-time source breakdown (spike diagnostic)
const q6 = db.prepare(`
  SELECT ${sourceCol} as source, COUNT(*) as cnt, MIN(created_at) as first_seen, MAX(created_at) as last_seen
  FROM ${leadsTable}
  GROUP BY ${sourceCol}
  ORDER BY cnt DESC
  LIMIT 20
`).all();

// Q7: daily counts last 7 days
const q7 = db.prepare(`
  SELECT DATE(created_at) as day, COUNT(*) as cnt
  FROM ${leadsTable}
  WHERE created_at > datetime('now', '-7 days')
  GROUP BY day
  ORDER BY day DESC
`).all();

// Q8: 48h source attribution - channel/url/query breakdown for spike diagnosis
const hasSourceChannel = cols.includes('source_channel');
const hasSourceUrl = cols.includes('source_url');
const hasSearchQuery = cols.includes('search_query');

const scCol = hasSourceChannel ? 'source_channel' : 'NULL';
const suCol = hasSourceUrl ? 'source_url' : 'NULL';
const sqCol = hasSearchQuery ? 'search_query' : 'NULL';

const q8 = db.prepare(`
  SELECT ${scCol} as source_channel, ${suCol} as source_url, ${sqCol} as search_query, COUNT(*) as cnt
  FROM ${leadsTable}
  WHERE created_at > datetime('now', '-48 hours')
  GROUP BY ${scCol}, ${suCol}, ${sqCol}
  ORDER BY cnt DESC
  LIMIT 10
`).all();

const total48h = q8.reduce((s, r) => s + r.cnt, 0);
const top48h = q8[0] ?? null;
const uniqueCombos = q8.length;
const topShare = total48h > 0 && top48h ? (top48h.cnt / total48h) : 0;

let spikeVerdict;
if (total48h === 0) {
  spikeVerdict = 'no_data';
} else if (uniqueCombos <= 2 || topShare >= 0.7) {
  spikeVerdict = 'artifact';
} else {
  spikeVerdict = 'genuine';
}

const spotCheck = {
  generated_at: new Date().toISOString(),
  cycle: 742,
  db_used: usedDb,
  table_used: leadsTable,
  total_48h: total48h,
  unique_source_combos: uniqueCombos,
  top_source_share: Math.round(topShare * 100) + '%',
  verdict: spikeVerdict,
  verdict_reason: spikeVerdict === 'artifact'
    ? `Top combo (${top48h?.source_channel}/${top48h?.source_url}) accounts for ${Math.round(topShare * 100)}% of 48h inflow - same source repeated`
    : spikeVerdict === 'genuine'
    ? `${uniqueCombos} distinct source combos in 48h - diversified inflow`
    : 'No leads found in 48h window',
  rows: q8,
};

fs.writeFileSync(
  path.resolve('.data/spike-spot-check-cycle742.json'),
  JSON.stringify(spotCheck, null, 2)
);

// Cycle 744 audit - identify single source/query combination driving 54/cycle spike
const audit744 = {
  generated_at: new Date().toISOString(),
  cycle: 744,
  db_used: usedDb,
  table_used: leadsTable,
  total_48h: total48h,
  unique_source_combos: uniqueCombos,
  top_source_share: Math.round(topShare * 100) + '%',
  verdict: spikeVerdict,
  verdict_reason: spikeVerdict === 'artifact'
    ? `Top combo (${top48h?.source_channel}/${top48h?.source_url}/${top48h?.search_query}) accounts for ${Math.round(topShare * 100)}% of 48h inflow - single repeated source driving spike`
    : spikeVerdict === 'genuine'
    ? `${uniqueCombos} distinct source combos in 48h - diversified inflow, not a single-source artifact`
    : 'No leads found in 48h window - spike may be DB artifact or stale data',
  spike_source: top48h ? {
    source_channel: top48h.source_channel,
    source_url: top48h.source_url,
    search_query: top48h.search_query,
    count_48h: top48h.cnt,
    share_of_48h: Math.round(topShare * 100) + '%',
  } : null,
  all_sources_48h: q8,
  conclusion: top48h
    ? `Primary spike source: channel=${top48h.source_channel} url=${top48h.source_url} query=${top48h.search_query} (${top48h.cnt} leads, ${Math.round(topShare * 100)}% of 48h total)`
    : 'No spike source identified - no leads in 48h window',
};

fs.writeFileSync(
  path.resolve('.data/spike-source-audit-cycle744.json'),
  JSON.stringify(audit744, null, 2)
);

console.log(`Cycle 744 audit written to: .data/spike-source-audit-cycle744.json`);

// Cycle 746 audit - 2-hour window source attribution for 54-lead spike
const q9 = db.prepare(`
  SELECT ${scCol} as source_channel, ${sqCol} as search_query, ${suCol} as source_url, COUNT(*) as cnt, MAX(created_at) as latest
  FROM ${leadsTable}
  WHERE created_at > datetime('now', '-2 hours')
  GROUP BY ${scCol}, ${sqCol}
  ORDER BY cnt DESC
  LIMIT 20
`).all();

const total2h = q9.reduce((s, r) => s + r.cnt, 0);
const top2h = q9[0] ?? null;
const topShare2h = total2h > 0 && top2h ? (top2h.cnt / total2h) : 0;

let verdict2h;
if (total2h === 0) {
  verdict2h = 'no_data';
} else if (q9.length <= 2 || topShare2h >= 0.7) {
  verdict2h = 'artifact';
} else {
  verdict2h = 'genuine';
}

const audit746 = {
  generated_at: new Date().toISOString(),
  cycle: 746,
  db_used: usedDb,
  table_used: leadsTable,
  window: '2 hours',
  total_2h: total2h,
  unique_source_combos: q9.length,
  top_source_share: Math.round(topShare2h * 100) + '%',
  verdict: verdict2h,
  verdict_reason: verdict2h === 'artifact'
    ? `Top combo (${top2h?.source_channel}/${top2h?.search_query}) accounts for ${Math.round(topShare2h * 100)}% of 2h inflow - single repeated source driving spike`
    : verdict2h === 'genuine'
    ? `${q9.length} distinct source combos in 2h - diversified inflow`
    : 'No leads found in 2h window',
  spike_source: top2h ? {
    source_channel: top2h.source_channel,
    search_query: top2h.search_query,
    source_url: top2h.source_url,
    count_2h: top2h.cnt,
    latest: top2h.latest,
    share_of_2h: Math.round(topShare2h * 100) + '%',
  } : null,
  all_sources_2h: q9,
  conclusion: top2h
    ? `Primary spike source: channel=${top2h.source_channel} query=${top2h.search_query} url=${top2h.source_url} (${top2h.cnt} leads, ${Math.round(topShare2h * 100)}% of 2h total)`
    : 'No spike source identified - no leads in 2h window',
};

fs.writeFileSync(
  path.resolve('.data/spike-source-audit-cycle746.json'),
  JSON.stringify(audit746, null, 2)
);

console.log(`Cycle 746 audit written to: .data/spike-source-audit-cycle746.json`);

db.close();

const totalFresh6h = q1.reduce((s, r) => s + r.count, 0);
const totalFresh24h = q5.reduce((s, r) => s + r.count, 0);
const topSource = q1[0]?.source || 'none';
const topCount = q1[0]?.count || 0;

let diagnosis;
if (totalFresh6h === 0 && totalFresh24h === 0) {
  diagnosis = 'No leads ingested in last 24h - spike may be DB artifact or older data. Check all-time count and source distribution.';
} else if (totalFresh6h === 0) {
  diagnosis = `No leads in 6h window but ${totalFresh24h} in 24h window - spike occurred 6-24h ago. Check 24h breakdown.`;
} else if (q1.length === 1) {
  diagnosis = `Single-source spike (${topSource}: ${topCount}) - check for duplicate ingestion or bulk scraper run`;
} else {
  diagnosis = `Multi-source: top is ${topSource} with ${topCount}/${totalFresh6h} leads in 6h window`;
}

const result = {
  generated_at: new Date().toISOString(),
  db_used: usedDb,
  table_used: leadsTable,
  total_leads_all_time: totalRow?.total ?? 'unknown',
  fresh_6h: totalFresh6h,
  fresh_24h: totalFresh24h,
  q1_source_breakdown_6h: q1,
  q2_stage_breakdown_6h: q2,
  q3_time_range_6h: q3,
  q5_source_breakdown_24h: q5,
  q6_source_breakdown_alltime: q6,
  q7_daily_counts_7days: q7,
  diagnosis,
};

fs.writeFileSync(OUT_PATH, JSON.stringify(result, null, 2));

console.log('=== LEAD SPIKE INVESTIGATION ===');
console.log(`DB: ${usedDb} (table: ${leadsTable})`);
console.log(`Total leads (all time): ${totalRow?.total}`);
console.log(`Fresh leads (6h): ${totalFresh6h} | (24h): ${totalFresh24h}`);
console.log(`Time range 6h: ${q3?.earliest} -> ${q3?.latest}`);
console.log(`Top source (6h): ${topSource} (${topCount})`);
console.log(`Diagnosis: ${diagnosis}`);
console.log(`Results written to: ${OUT_PATH}`);
