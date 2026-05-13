/**
 * validate-and-package.mjs
 *
 * Single-step script: query SQLite for newest leads, run a strict
 * contactability checklist, then write one artifact package ready for
 * manual send - no automation required.
 *
 * Checklist criteria:
 *   - Email format validity
 *   - Phone validity (10+ digits)
 *   - Personal vs generic email prefix
 *   - Business domain vs freemail
 *   - Voice-agent ICP fit (trades/service that take inbound calls)
 *   - Not already sent/bounced/blocked
 *   - Business name present
 *
 * Output: sandbox-review/voice-outreach-package-YYYY-MM-DD.json
 *
 * Usage:
 *   node scripts/outreach/validate-and-package.mjs
 *   node scripts/outreach/validate-and-package.mjs --hours 72 --limit 15
 *   node scripts/outreach/validate-and-package.mjs --dry-run
 */

import Database from 'better-sqlite3';
import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// DISCONTINUED - voice agent product killed April 22, 2026
// import { buildSubjects, buildEmailBody, buildShortVariant, DEMO_NUMBER, CALENDAR_LINK } from './templates/voice-receptionist-email.mjs';
// import { buildFollowUp, buildFollowUpRu } from './templates/voice-receptionist-followup.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT    = resolve(__dirname, '../..');
const DB_PATH = resolve(ROOT, '.data/linkedin-brand-os.sqlite');
const OUT_DIR = resolve(ROOT, 'sandbox-review');

// Primary ICP: trades and service businesses that book via phone.
const VOICE_AGENT_ICP = new Set([
  'hvac', 'plumbers', 'roofing', 'landscaping', 'cleaning-services',
  'auto-repair', 'moving-companies', 'electricians', 'garage-door',
  'dental-clinics', 'physiotherapy', 'optometrists', 'veterinarians',
  'property-management', 'chiropractors', 'painting', 'fencing',
]);

// Secondary ICP: still good fit, lower priority.
const VOICE_AGENT_SECONDARY = new Set([
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
]);

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function detectRu(lead) {
  if (/[а-яёА-ЯЁ]/.test(lead.company || '')) return true;
  if ((lead.email || '').toLowerCase().endsWith('.ru')) return true;
  const name = (lead.owner_name || '').toLowerCase();
  return ['evg', 'alex', 'mikh', 'vlad', 'yuri', 'serg', 'andr', 'dmi', 'nik'].some(t => name.includes(t));
}

/**
 * Strict contactability checklist with voice-agent business fit.
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
 *   voice-agent ICP fit   +25 (primary) or +10 (secondary)
 *   website present       +5
 *
 * Minimum to pass: score >= 30 AND has at least one contact channel.
 */
function contactabilityCheck(lead) {
  const checklist = [];
  const flags = [];
  let score = 0;

  const emailOk = isValidEmail(lead.email);
  const phoneOk = isValidPhone(lead.phone);
  const nameOk  = typeof lead.company === 'string' && lead.company.trim().length > 2;
  const notSent = !BLOCKED_STATUSES.has(lead.status);

  checklist.push({ criterion: 'has_email_or_phone', pass: emailOk || phoneOk });
  checklist.push({ criterion: 'has_business_name',  pass: nameOk });
  checklist.push({ criterion: 'not_already_sent',   pass: notSent });

  if (!nameOk)              flags.push('NO_COMPANY');
  if (!emailOk && !phoneOk) flags.push('NO_CONTACT');
  if (!notSent)             flags.push('ALREADY_SENT');

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

  if (VOICE_AGENT_ICP.has(lead.category)) {
    score += 25;
    checklist.push({ criterion: 'voice_agent_fit', pass: true, detail: lead.category });
  } else if (VOICE_AGENT_SECONDARY.has(lead.category)) {
    score += 10;
    checklist.push({ criterion: 'voice_agent_fit', pass: true, detail: `${lead.category} (secondary)` });
  } else {
    flags.push('LOW_FIT');
    checklist.push({ criterion: 'voice_agent_fit', pass: false, detail: lead.category || 'unknown' });
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

// ── DB queries ────────────────────────────────────────────────────────────────

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
        owner_name,
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
  const company = (lead.company || '').replace(/^\d+\n/, '').trim();
  const ru = detectRu(lead);

  return {
    lead_id:        lead.lead_id,
    company,
    email:          lead.email       || null,
    phone:          lead.phone       || null,
    owner_name:     lead.owner_name  || null,
    category:       lead.category    || null,
    website:        lead.website     || null,
    source_table:   lead.source_table,
    contact_score:  lead.contact_score,
    contact_flags:  lead.contact_flags,
    lang_hint:      ru ? 'ru' : 'en',
    subjects:       buildSubjects(company),
    primary_email:  buildEmailBody(company),
    short_variant:  buildShortVariant(company),
    follow_up:      ru ? buildFollowUpRu(company) : buildFollowUp(company),
    follow_up_label: ru ? 'RU version (use as initial outreach if RU contact)' : 'Day-3 follow-up (same thread, Re: original)',
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args   = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  const hoursIdx = args.indexOf('--hours');
  const hours    = hoursIdx >= 0 ? parseInt(args[hoursIdx + 1] || '48', 10) : 48;

  const limIdx   = args.indexOf('--limit');
  const maxLeads = Math.min(limIdx >= 0 ? parseInt(args[limIdx + 1] || '20', 10) : 20, 50);

  if (!existsSync(DB_PATH)) {
    console.error(`[validate-pkg] DB not found: ${DB_PATH}`);
    process.exit(1);
  }

  const db         = new Database(DB_PATH, { readonly: true });
  const emailLeads = queryOutreachEmails(db, hours);
  const hvacLeads  = queryHvacLeads(db);
  db.close();

  const all = deduplicate([...emailLeads, ...hvacLeads]);
  console.log(`[validate-pkg] Raw unique candidates: ${all.length}  (email: ${emailLeads.length}, hvac: ${hvacLeads.length})`);

  const scored = all.map(lead => {
    const chk     = contactabilityCheck(lead);
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

  console.log('\n--- CONTACTABILITY CHECKLIST (voice-agent fit) ---');
  const W = { co: 36, em: 30, ph: 14, cat: 20, sc: 7 };
  console.log(
    'Company'.padEnd(W.co) + 'Email'.padEnd(W.em) + 'Phone'.padEnd(W.ph) +
    'Category'.padEnd(W.cat) + 'Score'.padEnd(W.sc) + 'Flags'
  );
  console.log('-'.repeat(115));
  for (const r of scored) {
    const flagStr = r.contact_flags.length ? r.contact_flags.join(' ') : (r.pass ? 'OK' : 'FAIL');
    console.log(
      r.company.slice(0, W.co - 1).padEnd(W.co) +
      (r.email  || '-').slice(0, W.em - 1).padEnd(W.em) +
      (r.phone  || '-').slice(0, W.ph - 1).padEnd(W.ph) +
      (r.category || '-').slice(0, W.cat - 1).padEnd(W.cat) +
      String(r.contact_score).padEnd(W.sc) +
      flagStr
    );
  }

  const validated = scored.filter(r => r.pass).slice(0, maxLeads);
  const failed    = scored.filter(r => !r.pass);

  console.log(`\n[validate-pkg] Passed: ${validated.length}  Failed: ${failed.length}  Total: ${scored.length}`);

  if (validated.length === 0) {
    console.log('[validate-pkg] No contactable leads. Try --hours 72 or check DB.');
    process.exit(0);
  }

  const recipients = validated.map(buildArtifact);

  const today   = new Date().toISOString().slice(0, 10);
  const outPath = resolve(OUT_DIR, `voice-outreach-package-${today}.json`);

  if (dryRun) {
    console.log('\n[validate-pkg] DRY RUN - would write:');
    console.log(`  ${outPath}`);
    for (const r of recipients) {
      console.log(`  -> ${r.company} | ${r.email || r.phone} | score: ${r.contact_score} | ${r.category}`);
    }
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });

  const payload = {
    generated_at:   new Date().toISOString(),
    source_window:  `last ${hours}h`,
    demo_number:    DEMO_NUMBER,
    calendar_link:  CALENDAR_LINK,
    total_leads:    recipients.length,
    send_checklist: [
      'Use subjects[0] or subjects[1]. Avoid subjects[2] if company name is generic.',
      'Send Tue-Thu, 8-10am Calgary time (MST/MDT). Avoid Mondays and Fridays.',
      'If you have a phone number, call first. Use email as follow-up.',
      'Day 3 no reply: send follow_up in same thread, subject: Re: [original].',
      'Day 7 still no reply: mark dead, stop contacting.',
      'Log each send: node scripts/outreach/log-lead-outcome.mjs <lead_id> delivered email',
    ],
    recipients,
  };

  writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');

  console.log(`\n[validate-pkg] Written: ${outPath}`);
  console.log(`[validate-pkg] ${recipients.length} send-ready leads.\n`);

  if (recipients.length > 0) {
    const first = recipients[0];
    console.log('--- FIRST LEAD PREVIEW ---');
    console.log(`Company:  ${first.company}`);
    console.log(`Email:    ${first.email || '(none)'}`);
    console.log(`Phone:    ${first.phone || '(none)'}`);
    console.log(`Score:    ${first.contact_score}  Category: ${first.category}`);
    console.log(`\nSubject options:`);
    first.subjects.forEach((s, i) => console.log(`  [${i + 1}] ${s}`));
    console.log('\nPrimary email (first 300 chars):');
    console.log(first.primary_email.slice(0, 300) + '...\n');
    console.log(`Follow-up label: ${first.follow_up_label}`);
    console.log(first.follow_up);
  }
}

main().catch(err => {
  console.error('[validate-pkg]', err.message);
  process.exit(1);
});
