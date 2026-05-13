import Database from 'better-sqlite3';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, '../../.data/linkedin-brand-os.sqlite');

const db = new Database(DB_PATH);

// Inspect columns first
const cols = db.prepare("PRAGMA table_info(leads)").all();
console.log('Leads columns:', cols.map(c => c.name).join(', '));

// Find leads with emails not yet sent
const colNames = cols.map(c => c.name);
const hasCategory = colNames.includes('category');
const hasOwner = colNames.includes('owner_name');
const hasStatus = colNames.includes('status');
const hasWebsite = colNames.includes('website');

const selectCols = ['l.id', 'l.name', 'l.email'];
if (hasCategory) selectCols.push('l.category');
if (hasOwner) selectCols.push('l.owner_name');
if (hasStatus) selectCols.push('l.status');
if (hasWebsite) selectCols.push('l.website');

const statusFilter = hasStatus ? "AND (l.status IS NULL OR l.status NOT IN ('contacted', 'sent', 'replied', 'bounced'))" : '';

const leads = db.prepare(`
  SELECT ${selectCols.join(', ')}
  FROM leads l
  WHERE l.email IS NOT NULL AND l.email != ''
  ${statusFilter}
  ORDER BY l.rowid DESC
  LIMIT 20
`).all();

console.log('Leads with email (not contacted):', leads.length);
leads.forEach(l => console.log(JSON.stringify(l)));

// Also check outreach_emails for recent sends
const recentSends = db.prepare(`
  SELECT business_email, business_name, sent_at, status
  FROM outreach_emails
  WHERE sent_at IS NOT NULL
  ORDER BY sent_at DESC
  LIMIT 5
`).all();
console.log('\nRecent email sends:', recentSends.length);
recentSends.forEach(r => console.log(JSON.stringify(r)));

db.close();
