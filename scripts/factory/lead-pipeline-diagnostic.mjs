#!/usr/bin/env node
/**
 * Lead Pipeline Diagnostic
 * Answers: who are the 74K leads, where did they come from, who actually responded,
 * and what does the REAL ICP look like based on actual responses vs assumptions.
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const DB_PATH = path.join(ROOT, '.data/linkedin-brand-os.sqlite');
const OUTREACH_DB_PATH = path.join(ROOT, '.data/outreach.db');

const db = new Database(DB_PATH, { readonly: true });
let outreachDb = null;
try {
  outreachDb = new Database(OUTREACH_DB_PATH, { readonly: true });
} catch (_) {}

function section(title) {
  console.log('\n' + '='.repeat(60));
  console.log(`  ${title}`);
  console.log('='.repeat(60));
}

function table(rows, cols) {
  if (!rows.length) { console.log('  (no data)'); return; }
  const widths = cols.map(c => Math.max(c.length, ...rows.map(r => String(r[c] ?? '').length)));
  const header = cols.map((c, i) => c.padEnd(widths[i])).join('  ');
  const divider = widths.map(w => '-'.repeat(w)).join('  ');
  console.log('  ' + header);
  console.log('  ' + divider);
  rows.forEach(r => {
    console.log('  ' + cols.map((c, i) => String(r[c] ?? '').padEnd(widths[i])).join('  '));
  });
}

// ─── 1. TOTAL COUNT ────────────────────────────────────────────────────────────
section('1. TOTAL LEAD COUNT');
const total = db.prepare('SELECT COUNT(*) as cnt FROM leads').get();
console.log(`  Total leads in DB: ${total.cnt.toLocaleString()}`);

// ─── 2. DISTRIBUTION BY SOURCE PLATFORM ───────────────────────────────────────
section('2. WHERE DID THEY COME FROM? (source_platform)');
const byPlatform = db.prepare(`
  SELECT
    COALESCE(source_platform, 'unknown') as platform,
    COUNT(*) as total,
    ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM leads), 1) as pct
  FROM leads
  GROUP BY source_platform
  ORDER BY total DESC
  LIMIT 30
`).all();
table(byPlatform, ['platform', 'total', 'pct']);

// ─── 3. DISTRIBUTION BY SOURCE SCRIPT ─────────────────────────────────────────
section('3. WHICH BOT COLLECTED THEM? (source)');
const bySource = db.prepare(`
  SELECT
    COALESCE(source, 'unknown') as source,
    COUNT(*) as total,
    ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM leads), 1) as pct
  FROM leads
  GROUP BY source
  ORDER BY total DESC
  LIMIT 30
`).all();
table(bySource, ['source', 'total', 'pct']);

// ─── 4. PIPELINE STAGE ────────────────────────────────────────────────────────
section('4. PIPELINE STAGES - what happened to them?');
const byStage = db.prepare(`
  SELECT stage, COUNT(*) as total
  FROM leads GROUP BY stage ORDER BY total DESC
`).all();
table(byStage, ['stage', 'total']);

// ─── 5. SCORE QUALITY BANDS ───────────────────────────────────────────────────
section('5. QUALITY BANDS (score)');
const scoreBands = db.prepare(`
  SELECT
    CASE
      WHEN score >= 70 THEN '70+ HOT'
      WHEN score >= 40 THEN '40-69 MID'
      WHEN score >= 15 THEN '15-39 LOW'
      ELSE '0-14 JUNK'
    END as band,
    COUNT(*) as total,
    ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM leads), 1) as pct
  FROM leads
  GROUP BY band
  ORDER BY MIN(score) DESC
`).all();
table(scoreBands, ['band', 'total', 'pct']);

// ─── 6. ENRICHMENT CLASSIFICATION ────────────────────────────────────────────
section('6. ENRICHMENT CLASSIFICATION - what AI said they are');
const enrichCount = db.prepare('SELECT COUNT(*) as cnt FROM lead_enrichment').get();
console.log(`  Enriched leads: ${enrichCount.cnt.toLocaleString()} of ${total.cnt.toLocaleString()}`);
const byClass = db.prepare(`
  SELECT
    COALESCE(classification, 'not_enriched') as classification,
    COUNT(*) as total
  FROM lead_enrichment
  GROUP BY classification
  ORDER BY total DESC
`).all();
table(byClass, ['classification', 'total']);

// ─── 7. ACTUAL INTERACTIONS - what was sent ───────────────────────────────────
section('7. ACTUAL OUTREACH - interactions log');
let hasInteractions = false;
try {
  const intCount = db.prepare('SELECT COUNT(*) as cnt FROM lead_interactions').get();
  hasInteractions = intCount.cnt > 0;
  console.log(`  Total interaction records: ${intCount.cnt}`);
  if (intCount.cnt > 0) {
    const byChannel = db.prepare(`
      SELECT channel, direction, COUNT(*) as cnt
      FROM lead_interactions
      GROUP BY channel, direction
      ORDER BY cnt DESC
    `).all();
    table(byChannel, ['channel', 'direction', 'cnt']);
  }
} catch (e) {
  console.log('  lead_interactions table not found or empty');
}

// ─── 8. CONTACTED LEADS ───────────────────────────────────────────────────────
section('8. CONTACTED LEADS - leads that got outreach');
const contacted = db.prepare(`
  SELECT COUNT(*) as cnt FROM leads WHERE stage IN ('contacted','proposal_sent','won','lost')
`).get();
console.log(`  Leads marked contacted or beyond: ${contacted.cnt}`);

const contactedByPlatform = db.prepare(`
  SELECT
    COALESCE(source_platform, 'unknown') as platform,
    COUNT(*) as total,
    stage
  FROM leads
  WHERE stage IN ('contacted','proposal_sent','won','lost')
  GROUP BY source_platform, stage
  ORDER BY total DESC
  LIMIT 20
`).all();
if (contactedByPlatform.length) {
  table(contactedByPlatform, ['platform', 'total', 'stage']);
}

// ─── 9. POSITIVE OUTCOMES ─────────────────────────────────────────────────────
section('9. POSITIVE OUTCOMES - won deals + proposals');
const wonLeads = db.prepare(`
  SELECT
    name, company, role, location, industry,
    source_platform, score, notes, pain_description,
    last_contact_at
  FROM leads
  WHERE stage IN ('won', 'proposal_sent')
  ORDER BY score DESC
  LIMIT 20
`).all();
if (wonLeads.length === 0) {
  console.log('  No won/proposal_sent leads found in main DB.');
} else {
  wonLeads.forEach((l, i) => {
    console.log(`\n  [${i+1}] ${l.name} | ${l.role || '?'} @ ${l.company || '?'}`);
    console.log(`      Platform: ${l.source_platform} | Score: ${l.score}`);
    console.log(`      Location: ${l.location || '?'} | Industry: ${l.industry || '?'}`);
    if (l.pain_description) console.log(`      Pain: ${l.pain_description.substring(0, 120)}`);
    if (l.notes) console.log(`      Notes: ${l.notes.substring(0, 120)}`);
  });
}

// ─── 10. REAL REPLIES IN OUTREACH DB ──────────────────────────────────────────
section('10. REAL REPLIES (outreach.db)');
if (outreachDb) {
  try {
    const replied = outreachDb.prepare(`
      SELECT business_name, business_email, business_category, source, status, created_at
      FROM outreach_emails
      WHERE status IN ('replied', 'meeting')
      ORDER BY created_at DESC
      LIMIT 20
    `).all();
    console.log(`  Replied/meeting in outreach_emails: ${replied.length}`);
    if (replied.length) table(replied, ['business_name', 'business_category', 'source', 'status']);
  } catch (_) {}

  try {
    const hvacReplied = outreachDb.prepare(`
      SELECT company, replied, meeting, refusal, next_step, created_at
      FROM manual_hvac_outreach
      WHERE replied = 1 OR meeting = 1
      ORDER BY created_at DESC
      LIMIT 20
    `).all();
    console.log(`  Replied/meeting in manual_hvac_outreach: ${hvacReplied.length}`);
    if (hvacReplied.length) table(hvacReplied, ['company', 'replied', 'meeting', 'next_step']);
  } catch (_) {}

  try {
    const pendingReplied = outreachDb.prepare(`
      SELECT lead_id, company, variant, outcome, replied_at, notes
      FROM manual_pending_outreach
      WHERE outcome IS NOT NULL AND outcome != 'no_reply'
      ORDER BY replied_at DESC
      LIMIT 20
    `).all();
    console.log(`  Outcomes in manual_pending_outreach: ${pendingReplied.length}`);
    if (pendingReplied.length) table(pendingReplied, ['company', 'variant', 'outcome', 'notes']);
  } catch (_) {}
} else {
  console.log('  outreach.db not accessible');
}

// ─── 11. REAL ICP RECONSTRUCTION from contacts that progressed ────────────────
section('11. REAL ICP from contacts that moved past "new"');
const icpSample = db.prepare(`
  SELECT
    role, company, industry, location, source_platform, score,
    pain_description, service_match, budget_signal
  FROM leads
  WHERE stage IN ('contacted','proposal_sent','won','lost')
    AND (pain_description IS NOT NULL OR service_match IS NOT NULL)
  ORDER BY score DESC
  LIMIT 30
`).all();

if (icpSample.length === 0) {
  console.log('  No qualified leads with enrichment data found.');
} else {
  // Aggregate roles
  const roleMap = {};
  const industryMap = {};
  const locationMap = {};
  const platformMap = {};
  icpSample.forEach(l => {
    if (l.role) roleMap[l.role] = (roleMap[l.role] || 0) + 1;
    if (l.industry) industryMap[l.industry] = (industryMap[l.industry] || 0) + 1;
    if (l.location) locationMap[l.location] = (locationMap[l.location] || 0) + 1;
    if (l.source_platform) platformMap[l.source_platform] = (platformMap[l.source_platform] || 0) + 1;
  });

  console.log('\n  TOP ROLES among qualified contacts:');
  Object.entries(roleMap).sort((a,b)=>b[1]-a[1]).slice(0,10).forEach(([r,c]) =>
    console.log(`    ${String(c).padStart(3)}x  ${r}`)
  );
  console.log('\n  TOP INDUSTRIES:');
  Object.entries(industryMap).sort((a,b)=>b[1]-a[1]).slice(0,10).forEach(([r,c]) =>
    console.log(`    ${String(c).padStart(3)}x  ${r}`)
  );
  console.log('\n  TOP LOCATIONS:');
  Object.entries(locationMap).sort((a,b)=>b[1]-a[1]).slice(0,8).forEach(([r,c]) =>
    console.log(`    ${String(c).padStart(3)}x  ${r}`)
  );
  console.log('\n  TOP PLATFORMS (for these contacts):');
  Object.entries(platformMap).sort((a,b)=>b[1]-a[1]).forEach(([r,c]) =>
    console.log(`    ${String(c).padStart(3)}x  ${r}`)
  );
}

// ─── 12. HIGH-SCORE LEADS READY FOR OUTREACH ─────────────────────────────────
section('12. TOP ACTIONABLE - score 50+, stage=new, has pain signal');
const actionable = db.prepare(`
  SELECT
    l.name, l.role, l.company, l.location, l.score,
    l.source_platform, l.pain_description,
    e.classification, e.recommended_action
  FROM leads l
  LEFT JOIN lead_enrichment e ON e.lead_id = l.id
  WHERE l.stage = 'new'
    AND l.score >= 50
    AND l.pain_description IS NOT NULL
  ORDER BY l.score DESC
  LIMIT 15
`).all();
if (actionable.length === 0) {
  console.log('  No high-score new leads with pain signals found.');
} else {
  actionable.forEach((l, i) => {
    console.log(`\n  [${i+1}] ${l.name} | ${l.role || '?'} @ ${l.company || '?'} | Score: ${l.score}`);
    console.log(`      ${l.source_platform} | ${l.location || '?'}`);
    if (l.pain_description) console.log(`      Pain: ${l.pain_description.substring(0, 140)}`);
    if (l.classification) console.log(`      Class: ${l.classification} | Action: ${l.recommended_action || '?'}`);
  });
}

// ─── 13. GARBAGE BREAKDOWN ────────────────────────────────────────────────────
section('13. GARBAGE ANALYSIS - known junk sources');
const garbageSources = ['hn-whoshiring', 'ih-products'];
const garbageQuery = db.prepare(`
  SELECT source, COUNT(*) as cnt FROM leads
  WHERE source IN (${garbageSources.map(() => '?').join(',')})
  GROUP BY source
`).all(...garbageSources);
table(garbageQuery, ['source', 'cnt']);

const noLinkedIn = db.prepare(`
  SELECT COUNT(*) as cnt FROM leads
  WHERE (linkedin_url IS NULL OR linkedin_url = '')
    AND (source_platform NOT LIKE 'reddit%')
`).get();
console.log(`\n  Leads with no LinkedIn URL (non-Reddit): ${noLinkedIn.cnt}`);

const noPain = db.prepare(`
  SELECT COUNT(*) as cnt FROM leads
  WHERE pain_description IS NULL OR pain_description = ''
`).get();
console.log(`  Leads with no pain description: ${noPain.cnt.toLocaleString()}`);

// ─── SUMMARY ─────────────────────────────────────────────────────────────────
section('SUMMARY: WHAT ARE THESE 74K LEADS?');
console.log(`
  Total: ${total.cnt.toLocaleString()} records

  REALITY:
  - Most are mass-scraped by keyword ("AI", "lead gen", "cold email")
  - No qualification at collection time - everyone who posted gets saved
  - The majority have NO pain description, NO score, NO enrichment
  - Many are garbage: job postings (hn-whoshiring), product listings (ih-products)

  ACTUAL CONTACTED: ${contacted.cnt} leads ever moved past "new"
  WON/PROPOSAL: ${wonLeads.length} found with stage won/proposal_sent

  ACTION NEEDED:
  1. Run purge-garbage-leads.mjs to remove known junk sources
  2. Enrich top-scored leads (score 40+) that have pain signals
  3. Focus outreach ONLY on: ready_buyer + warming classifications
  4. ICP is NOT "anyone who mentions AI" - it's the specific roles/verticals above
`);

db.close();
if (outreachDb) outreachDb.close();
