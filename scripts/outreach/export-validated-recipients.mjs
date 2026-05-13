/**
 * export-validated-recipients.mjs
 *
 * Reads the SQLite lead DB, runs the voice-agent contactability checklist,
 * and writes two output files for manual sending:
 *
 *   sandbox-review/validated-recipients-YYYY-MM-DD.csv
 *     Fields: name, business, email, phone, language_preference, segment
 *     One row per recipient. Ready to copy into Gmail or Outlook BCC.
 *
 *   sandbox-review/validated-recipients-YYYY-MM-DD.json
 *     Full artifact per recipient: contact fields + subject lines + email
 *     bodies + follow-up copy. No sending required.
 *
 * No emails are sent. Manual review and dispatch only.
 *
 * Usage:
 *   node scripts/outreach/export-validated-recipients.mjs
 *   node scripts/outreach/export-validated-recipients.mjs --hours 72 --limit 25
 *   node scripts/outreach/export-validated-recipients.mjs --dry-run
 */

import Database from 'better-sqlite3';
import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// DISCONTINUED - voice agent product killed April 22, 2026
// import {
//   buildSubjects,
//   buildEmailBody,
//   buildShortVariant,
//   DEMO_NUMBER,
//   CALENDAR_LINK,
// } from './templates/voice-receptionist-email.mjs';
//
// import {
//   buildFollowUp,
//   buildFollowUpRu,
//   buildFinalNote,
//   buildFinalNoteRu,
// } from './templates/voice-receptionist-followup.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT    = resolve(__dirname, '../..');
const DB_PATH = resolve(ROOT, '.data/linkedin-brand-os.sqlite');
const OUT_DIR = resolve(ROOT, 'sandbox-review');

// Primary ICP: trades and service that book via phone
const VOICE_ICP_PRIMARY = new Set([
  'hvac', 'plumbers', 'roofing', 'landscaping', 'cleaning-services',
  'auto-repair', 'moving-companies', 'electricians', 'garage-door',
  'dental-clinics', 'physiotherapy', 'optometrists', 'veterinarians',
  'property-management', 'chiropractors', 'painting', 'fencing',
]);

// Secondary ICP: good fit, lower urgency
const VOICE_ICP_SECONDARY = new Set([
  'daycare-centres', 'fitness-centres', 'pet-grooming',
  'home-builders', 'staffing-agencies',
]);

const GENERIC_PREFIXES = new Set([
  'info', 'contact', 'office', 'hello', 'admin', 'support',
  'sales', 'team', 'general', 'reception', 'booking', 'service',
  'mail', 'enquiries', 'enquiry', 'billing', 'help', 'orders',
]);

const FREEMAIL = new Set([
  'gmail.com', 'hotmail.com', 'yahoo.com', 'outlook.com', 'live.com', 'icloud.com',
]);

const BLOCKED_STATUSES = new Set([
  'sent', 'bounced', 'blocked', 'replied', 'unsubscribed', 'meeting', 'refused',
  'invalid_email', 'invalid_no_email',
]);

// ── Validation helpers ────────────────────────────────────────────────────────

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

function isValidPhone(phone) {
  if (!phone) return false;
  const d = (phone || '').replace(/\D/g, '');
  return d.length >= 10 && d.length <= 15;
}

function detectRu(lead) {
  if (/[а-яёА-ЯЁ]/.test(lead.company || '')) return true;
  if ((lead.email || '').toLowerCase().endsWith('.ru')) return true;
  const name = (lead.owner_name || '').toLowerCase();
  return ['evg', 'alex', 'mikh', 'vlad', 'yuri', 'serg', 'andr', 'dmi', 'nik'].some(t => name.includes(t));
}

function classifySegment(category) {
  if (VOICE_ICP_PRIMARY.has(category)) return 'primary';
  if (VOICE_ICP_SECONDARY.has(category)) return 'secondary';
  return 'off-icp';
}

/**
 * Strict contactability check.
 *
 * Hard requirements (any fail = discard):
 *   - Has valid email OR valid phone
 *   - Has business name (>2 chars)
 *   - Not already sent/bounced/blocked
 *
 * Score (max 120):
 *   email valid  +30
 *   personal prefix  +20
 *   business domain  +5
 *   phone valid  +35
 *   primary ICP  +25  /  secondary ICP  +10
 *   website present  +5
 *
 * Pass threshold: score >= 30 AND has at least one contact channel.
 */
function contactabilityCheck(lead) {
  const emailOk  = isValidEmail(lead.email);
  const phoneOk  = isValidPhone(lead.phone);
  const nameOk   = typeof lead.company === 'string' && lead.company.trim().length > 2;
  const notSent  = !BLOCKED_STATUSES.has(lead.status);
  const flags    = [];

  if (!nameOk)              flags.push('NO_COMPANY');
  if (!emailOk && !phoneOk) flags.push('NO_CONTACT');
  if (!notSent)             flags.push('ALREADY_SENT');

  if (flags.length) return { pass: false, score: 0, flags };

  let score = 0;
  if (emailOk) {
    score += 30;
    const prefix = (lead.email || '').split('@')[0].toLowerCase().trim();
    if (!GENERIC_PREFIXES.has(prefix)) score += 20; else flags.push('GENERIC_EMAIL');
    const domain = (lead.email || '').split('@')[1]?.toLowerCase().trim() || '';
    if (!FREEMAIL.has(domain)) score += 5; else flags.push('FREEMAIL');
  } else {
    flags.push('NO_EMAIL');
  }
  if (phoneOk) score += 35;

  const cat = lead.category || '';
  if (VOICE_ICP_PRIMARY.has(cat)) score += 25;
  else if (VOICE_ICP_SECONDARY.has(cat)) { score += 10; flags.push('SECONDARY_ICP'); }
  else flags.push('OFF_ICP');

  if (typeof lead.website === 'string' && lead.website.trim().length > 5) score += 5;

  return { pass: score >= 30 && (emailOk || phoneOk), score, flags };
}

// ── DB queries ────────────────────────────────────────────────────────────────

function queryOutreachEmails(db, hours) {
  try {
    return db.prepare(`
      SELECT
        'outreach_emails' AS source_table,
        CAST(id AS TEXT)  AS lead_id,
        business_name     AS company,
        business_email    AS email,
        NULL              AS phone,
        business_category AS category,
        business_website  AS website,
        NULL              AS owner_name,
        status,
        created_at
      FROM outreach_emails
      WHERE created_at >= datetime('now', ?)
        AND business_email IS NOT NULL
        AND business_email LIKE '%@%.%'
        AND length(trim(business_email)) >= 6
        AND status NOT IN ('sent','bounced','blocked','replied','unsubscribed','invalid_email','invalid_no_email')
        AND business_name IS NOT NULL
        AND length(trim(business_name)) > 2
      ORDER BY created_at DESC
      LIMIT 400
    `).all(`-${hours} hours`);
  } catch { return []; }
}

function queryHvacLeads(db) {
  try {
    db.prepare('SELECT 1 FROM manual_hvac_outreach LIMIT 1').get();
    return db.prepare(`
      SELECT
        'manual_hvac_outreach' AS source_table,
        id                     AS lead_id,
        company,
        email,
        phone,
        'hvac'                 AS category,
        website,
        NULL                   AS owner_name,
        CASE
          WHEN meeting  = 1 THEN 'meeting'
          WHEN refusal  = 1 THEN 'refused'
          WHEN delivered = 1 THEN 'delivered'
          ELSE 'pending'
        END                    AS status,
        created_at
      FROM manual_hvac_outreach
      WHERE refusal  = 0
        AND meeting   = 0
        AND (
          (phone IS NOT NULL AND length(replace(replace(replace(phone,'-',''),'(',''),')','')) >= 10)
          OR (email IS NOT NULL AND email LIKE '%@%.%')
        )
      ORDER BY created_at DESC
    `).all();
  } catch { return []; }
}

// ── Deduplication ─────────────────────────────────────────────────────────────

function deduplicate(rows) {
  const seenEmail = new Set();
  const seenPhone = new Set();
  const seenId    = new Set();
  const out = [];
  for (const row of rows) {
    const eKey = (row.email || '').toLowerCase().trim();
    const pKey = isValidPhone(row.phone) ? row.phone.replace(/\D/g, '') : '';
    if (eKey && seenEmail.has(eKey)) continue;
    if (pKey && seenPhone.has(pKey)) continue;
    if (seenId.has(row.lead_id))    continue;
    if (eKey) seenEmail.add(eKey);
    if (pKey) seenPhone.add(pKey);
    seenId.add(row.lead_id);
    out.push(row);
  }
  return out;
}

// ── Artifact builder ──────────────────────────────────────────────────────────

function buildArtifact(lead) {
  const company  = (lead.company || '').replace(/^\d+\n/, '').trim();
  const ru       = detectRu(lead);
  const segment  = classifySegment(lead.category || '');
  const ownerFirst = lead.owner_name
    ? lead.owner_name.trim().split(/\s+/)[0]
    : null;

  return {
    // recipient export fields (CSV columns)
    name:                ownerFirst || null,
    business:            company,
    email:               lead.email || null,
    phone:               lead.phone || null,
    language_preference: ru ? 'ru' : 'en',
    segment,

    // extended fields for JSON
    lead_id:       lead.lead_id,
    category:      lead.category    || null,
    website:       lead.website     || null,
    owner_name:    lead.owner_name  || null,
    source_table:  lead.source_table,
    contact_score: lead.contact_score,
    contact_flags: lead.contact_flags,

    // ready-to-send copy
    subjects:       buildSubjects(company),
    primary_email:  buildEmailBody(company, DEMO_NUMBER, CALENDAR_LINK),
    short_variant:  buildShortVariant(company, DEMO_NUMBER, CALENDAR_LINK),
    followup_day3:  ru ? buildFollowUpRu(company, DEMO_NUMBER, CALENDAR_LINK)
                       : buildFollowUp(company, DEMO_NUMBER, CALENDAR_LINK),
    followup_day7:  ru ? buildFinalNoteRu(company, CALENDAR_LINK)
                       : buildFinalNote(company, CALENDAR_LINK),
    followup_label: ru
      ? 'RU contact - use short_variant as initial, followup_day3/day7 in same thread'
      : 'EN contact - primary_email or short_variant first, then followup_day3 at day 3, followup_day7 at day 7',
  };
}

// ── CSV serialiser ────────────────────────────────────────────────────────────

const CSV_COLS = ['name', 'business', 'email', 'phone', 'language_preference', 'segment'];

function escapeCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function toCSV(artifacts) {
  const header = CSV_COLS.join(',');
  const rows   = artifacts.map(a =>
    CSV_COLS.map(col => escapeCell(a[col])).join(',')
  );
  return [header, ...rows].join('\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args     = process.argv.slice(2);
  const dryRun   = args.includes('--dry-run');
  const hoursIdx = args.indexOf('--hours');
  const hours    = hoursIdx >= 0 ? parseInt(args[hoursIdx + 1] || '48', 10) : 48;
  const limIdx   = args.indexOf('--limit');
  const maxLeads = Math.min(limIdx >= 0 ? parseInt(args[limIdx + 1] || '25', 10) : 25, 50);

  if (!existsSync(DB_PATH)) {
    console.error(`[export-recipients] DB not found: ${DB_PATH}`);
    process.exit(1);
  }

  const db         = new Database(DB_PATH, { readonly: true });
  const emailRows  = queryOutreachEmails(db, hours);
  const hvacRows   = queryHvacLeads(db);
  db.close();

  const all = deduplicate([...emailRows, ...hvacRows]);
  console.log(`[export-recipients] Raw unique candidates: ${all.length}  (email: ${emailRows.length}, hvac: ${hvacRows.length})`);

  const scored = all
    .map(lead => {
      const chk = contactabilityCheck(lead);
      return {
        ...lead,
        company:       (lead.company || '').replace(/^\d+\n/, '').trim(),
        contact_score: chk.score,
        contact_flags: chk.flags,
        pass:          chk.pass,
      };
    })
    .sort((a, b) => b.contact_score - a.contact_score);

  const validated = scored.filter(r => r.pass).slice(0, maxLeads);
  const failed    = scored.filter(r => !r.pass).length;

  console.log(`[export-recipients] Passed: ${validated.length}  Failed: ${failed}  Total: ${scored.length}`);

  if (validated.length === 0) {
    console.log('[export-recipients] No contactable leads. Try --hours 72 or check DB.');
    process.exit(0);
  }

  // Print checklist table
  const W = { co: 36, em: 28, ph: 14, cat: 20, sc: 6 };
  console.log('\n--- VALIDATED RECIPIENTS ---');
  console.log(
    'Business'.padEnd(W.co) + 'Email'.padEnd(W.em) + 'Phone'.padEnd(W.ph) +
    'Category'.padEnd(W.cat) + 'Sc'.padEnd(W.sc) + 'Lang  Flags'
  );
  console.log('-'.repeat(120));
  for (const r of validated) {
    const lang = detectRu(r) ? 'ru' : 'en';
    const flagStr = r.contact_flags.length ? r.contact_flags.join(' ') : 'OK';
    console.log(
      r.company.slice(0, W.co - 1).padEnd(W.co) +
      (r.email || '-').slice(0, W.em - 1).padEnd(W.em) +
      (r.phone || '-').slice(0, W.ph - 1).padEnd(W.ph) +
      (r.category || '-').slice(0, W.cat - 1).padEnd(W.cat) +
      String(r.contact_score).padEnd(W.sc) +
      lang.padEnd(6) + flagStr
    );
  }

  const artifacts = validated.map(buildArtifact);

  const today    = new Date().toISOString().slice(0, 10);
  const csvPath  = resolve(OUT_DIR, `validated-recipients-${today}.csv`);
  const jsonPath = resolve(OUT_DIR, `validated-recipients-${today}.json`);

  if (dryRun) {
    console.log('\n[export-recipients] DRY RUN - would write:');
    console.log(`  CSV:  ${csvPath}`);
    console.log(`  JSON: ${jsonPath}`);
    console.log('\nFirst recipient CSV row:');
    console.log(CSV_COLS.join(','));
    console.log(CSV_COLS.map(col => escapeCell(artifacts[0]?.[col])).join(','));
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });

  const payload = {
    generated_at:  new Date().toISOString(),
    source_window: `last ${hours}h`,
    demo_number:   DEMO_NUMBER,
    calendar_link: CALENDAR_LINK,
    total:         artifacts.length,
    send_checklist: [
      'Pick subjects[0] for named contacts, subjects[1] for generic.',
      'Send Tue-Thu, 8-10am Calgary time (MST/MDT).',
      'Call first if phone is present. Email as follow-up.',
      'Day 3 no reply: reply in same thread with followup_day3 copy.',
      'Day 7 still no reply: send followup_day7 then mark dead.',
      'Log each send: node scripts/outreach/log-lead-outcome.mjs <lead_id> delivered email',
    ],
    artifacts,
  };

  writeFileSync(csvPath,  toCSV(artifacts), 'utf8');
  writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');

  console.log('\n[export-recipients] Written:');
  console.log(`  CSV:  ${csvPath}`);
  console.log(`  JSON: ${jsonPath}`);
  console.log(`\n[export-recipients] ${artifacts.length} recipients ready. Manual send only.`);

  if (artifacts.length > 0) {
    const first = artifacts[0];
    console.log('\n--- FIRST RECIPIENT PREVIEW ---');
    console.log(`Business:  ${first.business}`);
    console.log(`Name:      ${first.name || '(unknown)'}`);
    console.log(`Email:     ${first.email || '(none)'}`);
    console.log(`Phone:     ${first.phone || '(none)'}`);
    console.log(`Language:  ${first.language_preference}`);
    console.log(`Segment:   ${first.segment}`);
    console.log(`Score:     ${first.contact_score}`);
    console.log('\nSubjects:');
    first.subjects.forEach((s, i) => console.log(`  [${i + 1}] ${s}`));
    console.log('\nPrimary email (first 300 chars):');
    console.log(first.primary_email.slice(0, 300) + '...');
    console.log('\nDay-3 follow-up label:', first.followup_label.split(' - ')[0]);
  }
}

main().catch(err => {
  console.error('[export-recipients]', err.message);
  process.exit(1);
});
