/**
 * DISCONTINUED - Voice agent product was killed April 22, 2026.
 * This file is no longer active. Do not import or call.
 * Kept for reference only.
 */
import { readFileSync } from 'fs';
import Database from 'better-sqlite3';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, '../../.data/linkedin-brand-os.sqlite');

const data = JSON.parse(readFileSync(resolve(__dirname, '../../.data/calgary-businesses.json'), 'utf8'));
const businesses = Array.isArray(data) ? data : (data.businesses || []);

const db = new Database(DB_PATH);
const alreadySent = new Set(
  db.prepare('SELECT business_email FROM outreach_emails').all().map(r => r.business_email)
);
db.close();

const withEmail = businesses.filter(b => {
  if (!b.email) return false;
  if (b.email.includes('noreply')) return false;
  if (alreadySent.has(b.email)) return false;
  return true;
});

console.log('Not yet contacted with email:', withEmail.length);

// Priority: dental + cleaning (best AI voice receptionist fit)
const PRIORITY = ['dental-clinics', 'physiotherapy', 'cleaning-services', 'hvac', 'auto-repair', 'roofing', 'landscaping', 'plumbers', 'veterinarians'];
const priority = withEmail.filter(b => PRIORITY.includes(b.category));
console.log('Priority leads:', priority.length);

// Filter garbage: wix sites (not real emails), resumes@, info@, generic owners
const NON_PERSON = /\b(contact|info|admin|office|team|staff|clinic|dental|physio|optim|eyewear|solutions|services|realty|group|corp|inc|ltd|llp|associates|company|management|consulting|enterprises|capital|financial|medical|health|wellness|repair|auto|home|care|clean|cleaning|landscape|landscaping|moving|travel|fitness|day|pet|roofing|hvac|plumb|plumbing|electric|electrical|insurance|insuring|mortgage|marketing|legal|law|account|accounting|book|booking|notary|staffing|print|veterinar|lenses|learning|centre|center|scheduling|billing|dispatch|maintenance|property|construction|advisory|advisor|wealth|invest|broker|banner|car|us\s)/i;

function isRealPersonName(name) {
  if (!name) return false;
  const words = name.trim().split(/\s+/);
  if (words.length < 1 || words.length > 3) return false;
  if (NON_PERSON.test(name)) return false;
  return words.every(w => /^[A-Z][a-z]{1,15}$/.test(w));
}

function isGoodEmail(email) {
  if (!email) return false;
  const e = email.toLowerCase();
  if (e.includes('wixsite') || e.includes('noreply') || e.includes('resumes@')) return false;
  if (e.startsWith('info@') || e.startsWith('admin@') || e.startsWith('office@')) return false;
  // Hosting/generic service emails
  if (e.includes('webador') || e.includes('google.com') || e.includes('yahoo.com') || e.includes('hotmail') || e.includes('outlook.com')) return false;
  // Must have a real domain (not gmail for business - skip, those are personal)
  // Actually allow gmail as many small biz use it
  return true;
}

const goodPriority = priority.filter(b => isGoodEmail(b.email));
console.log('Priority leads with good emails:', goodPriority.length);

const withRealOwner = goodPriority.filter(b => isRealPersonName(b.ownerName));
const withoutOwner = goodPriority.filter(b => !isRealPersonName(b.ownerName));
const top3 = [...withRealOwner.slice(0, 3), ...withoutOwner].slice(0, 3);

console.log('\n=== TOP 3 LEADS FOR SPRINT ===');
top3.forEach((b, i) => {
  const name = String(b.name).replace(/^\d+\n/, '').trim();
  console.log(`\n[${i + 1}] ${name}`);
  console.log(`    Email:    ${b.email}`);
  console.log(`    Category: ${b.category}`);
  console.log(`    Owner:    ${b.ownerName || '(unknown)'}`);
  console.log(`    Website:  ${b.website || '(none)'}`);
});

// Export as JSON for use by sender
const output = top3.map(b => ({
  ...b,
  name: String(b.name).replace(/^\d+\n/, '').trim(),
}));
import { writeFileSync } from 'fs';
writeFileSync(resolve(__dirname, '../../.data/sprint-leads.json'), JSON.stringify(output, null, 2));
console.log('\nSaved to .data/sprint-leads.json');
