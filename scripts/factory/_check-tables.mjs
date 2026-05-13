import Database from 'better-sqlite3';

const dbs = [
  '.data/leads.db',
  'db/leads.db',
  '.data/pipeline.db',
  '.data/outreach.db',
  '.data/factory.db',
  '.data/brand.db',
  '.data/brain.db',
  '.data/icp.db',
  '.data/touches.db',
];

for (const p of dbs) {
  try {
    const d = new Database(p, { readonly: true });
    const tables = d.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
    console.log(p, '->', tables.join(', '));
    d.close();
  } catch (e) {
    console.log(p, '-> ERROR:', e.message);
  }
}
