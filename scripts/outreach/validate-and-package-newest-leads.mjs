/**
 * validate-and-package-newest-leads.mjs
 *
 * Queries SQLite for the newest leads (default: last 48h), runs a strict
 * contactability checklist, deduplicates, and writes two output files:
 *
 *   sandbox-review/validated-leads-YYYY-MM-DD.json
 *   sandbox-review/validated-leads-YYYY-MM-DD.csv
 *
 * These files are consumed by outbound-artifact-voice-receptionist.mjs.
 * No emails are sent. No artifacts are generated here.
 *
 * Usage:
 *   node scripts/outreach/validate-and-package-newest-leads.mjs
 *   node scripts/outreach/validate-and-package-newest-leads.mjs --hours 72 --limit 20
 *   node scripts/outreach/validate-and-package-newest-leads.mjs --dry-run
 */

import Database from 'better-sqlite3';
import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT    = resolve(__dirname, '../..');
const DB_PATH = resolve(ROOT, '.data/linkedin-brand-os.sqlite');
const OUT_DIR = resolve(ROOT, 'sandbox-review');

const ICP_CATEGORIES = new Set([
  'hvac', 'plumbers', 'roofing', 'landscaping', 'cleaning-services',
  'auto-repair', 'moving-companies', 'electricians', 'garage-door',
  'dental-clinics', 'physiotherapy', 'optometrists', 'veterinarians',
  'property-management', 'chiropractors', 'painting', 'fencing',
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
]);

// ── Checklist helpers ────────────────────────────────────────────────────────

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

function isPersonalPrefix(email) {
  const prefix = (email || '').split('@')[0].toLowerCase().trim();
  return !GENERIC_PREFIXES.has(prefix);
}

function isFreemail(email) {
  const domain = (email || '').split('@')[1]?.toLowerCase().trim() || '';
  return FREEMAIL.has(domain);
}

function isValidPhone(phone) {
  if (!phone) return false;
  const digits = (phone || '').replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15;
}

/**
 * Strict contactability checklist.
 *
 * Hard requirements (any fail = pass: false):
 *   1. Has email (valid format) or phone (10+ digits)
 *   2. Business name present and non-trivial (> 2 chars)
 *   3. Not already sent / bounced / blocked / replied
 *
 * Scored criteria (max 120 pts):
 *   email valid format    +30
 *   personal prefix       +20
 *   business domain       +5
 *   phone valid           +35
 *   ICP category match    +25
 *   website present       +5
 *
 * Minimum to pass: score >= 30
 */
function contactabilityCheck(lead) {
  const checklist = [];
  const flags = [];
  let score = 0;

  const emailOk = isValidEmail(lead.email);
  const phoneOk = isValidPhone(lead.phone);
  const nameOk  = typeof lead.company === 'string' && lead.company.trim().length > 2;
  const notSent  = !BLOCKED_STATUSES.has(lead.status);

  checklist.push({ criterion: 'has_email_or_phone', pass: emailOk || phoneOk });
  checklist.push({ criterion: 'has_business_name',  pass: nameOk });
  checklist.push({ criterion: 'not_already_sent',   pass: notSent });

  if (!nameOk)             flags.push('NO_COMPANY');
  if (!emailOk && !phoneOk) flags.push('NO_CONTACT');
  if (!notSent)            flags.push('ALREADY_SENT');

  if (flags.length > 0) {
    return { pass: false, score: 0, flags, checklist };
  }

  if (emailOk) {
    score += 30;
    checklist.push({ criterion: 'email_valid_format', pass: true });

    if (isPersonalPrefix(lead.email)) {
      score += 20;
      checklist.push({ criterion: 'email_personal_prefix', pass: true });
    } else {
      flags.push('GENERIC_EMAIL');
      checklist.push({ criterion: 'email_personal_prefix', pass: false });
    }

    if (!isFreemail(lead.email)) {
      score += 5;
      checklist.push({ criterion: 'email_business_domain', pass: true });
    } else {
      flags.push('FREEMAIL');
      checklist.push({ criterion: 'email_business_domain', pass: false });
    }
  } else {
    flags.push('NO_EMAIL');
    checklist.push({ criterion: 'email_valid_format', pass: false });
  }

  if (phoneOk) {
    score += 35;
    checklist.push({ criterion: 'phone_valid', pass: true });
  } else {
    checklist.push({ criterion: 'phone_valid', pass: false });
  }

  if (ICP_CATEGORIES.has(lead.category)) {
    score += 25;
    checklist.push({ criterion: 'icp_category_match', pass: true });
  } else {
    flags.push('OFF_ICP');
    checklist.push({ criterion: 'icp_category_match', pass: false });
  }

  if (typeof lead.website === 'string' && lead.website.trim().length > 5) {
    score += 5;
    checklist.push({ criterion: 'website_present', pass: true });
  } else {
    checklist.push({ criterion: 'website_present', pass: false });
  }

  const pass = score >= 30 && (emailOk || phoneOk);
  return { pass, score, flags, checklist };
}

// ── DB queries ───────────────────────────────────────────────────────────────

function queryOutreachEmails(db, hours) {
  try {
    return db.prepare(`
      SELECT
        'outreach_emails'  AS source_table,
        CAST(id AS TEXT)   AS lead_id,
        business_name      AS company,
        business_email     AS email,
        NULL               AS phone,
        business_category  AS category,
        business_website   AS website,
        NULL               AS owner_name,
        status,
        created_at
      FROM outreach_emails
      WHERE created_at >= datetime('now', ?)
        AND business_email IS NOT NULL
        AND business_email LIKE '%@%.%'
        AND length(trim(business_email)) >= 6
        AND status NOT IN ('sent','bounced','blocked','replied','unsubscribed')
        AND business_name IS NOT NULL
        AND length(trim(business_name)) > 2
      ORDER BY created_at DESC
      LIMIT 300
    `).all(`-${hours} hours`);
  } catch {
    return [];
  }
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
  } catch {
    return [];
  }
}

// ── Deduplication ────────────────────────────────────────────────────────────

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

// ── CSV ──────────────────────────────────────────────────────────────────────

function esc(v) {
  if (v === null || v === undefined) return '';
  const s = String(v).replace(/"/g, '""');
  return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s}"` : s;
}

function toCSV(rows) {
  const headers = [
    'lead_id', 'company', 'email', 'phone', 'owner_name',
    'category', 'website', 'source_table', 'status',
    'contact_score', 'contact_flags',
  ];
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push([
      esc(r.lead_id),
      esc(r.company),
      esc(r.email),
      esc(r.phone),
      esc(r.owner_name),
      esc(r.category),
      esc(r.website),
      esc(r.source_table),
      esc(r.status),
      esc(r.contact_score),
      esc(r.contact_flags.join(' | ')),
    ].join(','));
  }
  return lines.join('\n');
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args   = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  const hoursIdx = args.indexOf('--hours');
  const hours    = hoursIdx >= 0 ? parseInt(args[hoursIdx + 1] || '48', 10) : 48;

  const limIdx   = args.indexOf('--limit');
  const maxLeads = Math.min(limIdx >= 0 ? parseInt(args[limIdx + 1] || '20', 10) : 20, 50);

  if (!existsSync(DB_PATH)) {
    console.error(`[validate-leads] DB not found: ${DB_PATH}`);
    process.exit(1);
  }

  const db         = new Database(DB_PATH, { readonly: true });
  const emailLeads = queryOutreachEmails(db, hours);
  const hvacLeads  = queryHvacLeads(db);
  db.close();

  const all = deduplicate([...emailLeads, ...hvacLeads]);
  console.log(`[validate-leads] Raw unique candidates: ${all.length}  (email: ${emailLeads.length}, hvac: ${hvacLeads.length})`);

  // Run checklist and sort by score desc
  const scored = all.map(lead => {
    const chk = contactabilityCheck(lead);
    const company = (lead.company || '').replace(/^\d+\n/, '').trim();
    return {
      lead_id:       lead.lead_id,
      company,
      email:         lead.email       || null,
      phone:         lead.phone       || null,
      owner_name:    lead.owner_name  || null,
      category:      lead.category    || null,
      website:       lead.website     || null,
      source_table:  lead.source_table,
      status:        lead.status,
      contact_score: chk.score,
      contact_flags: chk.flags,
      checklist:     chk.checklist,
      pass:          chk.pass,
    };
  }).sort((a, b) => b.contact_score - a.contact_score);

  // Print checklist table
  console.log('\n--- CONTACTABILITY CHECKLIST ---');
  const COL = { co: 38, em: 30, ph: 14, cat: 18, sc: 7 };
  console.log(
    'Company'.padEnd(COL.co) +
    'Email'.padEnd(COL.em) +
    'Phone'.padEnd(COL.ph) +
    'Category'.padEnd(COL.cat) +
    'Score'.padEnd(COL.sc) +
    'Flags'
  );
  console.log('-'.repeat(115));
  for (const r of scored) {
    const flagStr = r.contact_flags.length ? r.contact_flags.join(' ') : (r.pass ? 'OK' : 'FAIL');
    console.log(
      r.company.slice(0, COL.co - 1).padEnd(COL.co) +
      (r.email  || '-').slice(0, COL.em - 1).padEnd(COL.em) +
      (r.phone  || '-').slice(0, COL.ph - 1).padEnd(COL.ph) +
      (r.category || '-').slice(0, COL.cat - 1).padEnd(COL.cat) +
      String(r.contact_score).padEnd(COL.sc) +
      flagStr
    );
  }

  const validated = scored.filter(r => r.pass).slice(0, maxLeads);
  const failed    = scored.filter(r => !r.pass);

  console.log(`\n[validate-leads] Passed: ${validated.length}  Failed: ${failed.length}  Total: ${scored.length}`);

  if (validated.length === 0) {
    console.log('[validate-leads] No contactable leads. Try --hours 72 or check DB.');
    process.exit(0);
  }

  const today = new Date().toISOString().slice(0, 10);
  const jsonPath = resolve(OUT_DIR, `validated-leads-${today}.json`);
  const csvPath  = resolve(OUT_DIR, `validated-leads-${today}.csv`);

  if (dryRun) {
    console.log('\n[validate-leads] DRY RUN - would write:');
    console.log(`  ${jsonPath}`);
    console.log(`  ${csvPath}`);
    for (const r of validated) {
      console.log(`  -> ${r.company} | ${r.email || r.phone} | score: ${r.contact_score}`);
    }
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });

  const payload = {
    generated_at:  new Date().toISOString(),
    source_window: `last ${hours}h`,
    total_passed:  validated.length,
    total_failed:  failed.length,
    leads:         validated,
  };

  writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');
  writeFileSync(csvPath,  toCSV(validated), 'utf8');

  console.log('\n[validate-leads] Written:');
  console.log(`  JSON: ${jsonPath}`);
  console.log(`  CSV:  ${csvPath}`);
  console.log('\nNext step: node scripts/outreach/outbound-artifact-voice-receptionist.mjs');
}

main().catch(err => {
  console.error('[validate-leads]', err.message);
  process.exit(1);
});
