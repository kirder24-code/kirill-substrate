/**
 * Purge garbage records from leads table.
 *
 * Garbage = records that are NOT actual people/prospects:
 *   - hn-whoshiring: HN job listing posts (companies hiring engineers, not buyers)
 *   - ih-products: IndieHackers product listings (product pages, not founder pain posts)
 *   - r/slavelabour + r/forhire: people OFFERING services, not buying
 *   - brave_search content entries where name is a URL slug / article title (no linkedin_url)
 *
 * Run with --dry-run to preview counts without deleting.
 * Run with --execute to actually delete.
 */

import Database from 'better-sqlite3';

const DRY_RUN = !process.argv.includes('--execute');

const db = new Database('.data/linkedin-brand-os.sqlite');

const before = db.prepare('SELECT COUNT(*) as n FROM leads').get().n;

const garbageSources = ['hn-whoshiring', 'ih-products'];
const garbagePlatforms = ['reddit_r_slavelabour', 'reddit_r_forhire'];

// Count each garbage category
const counts = {};

counts.hn_whoshiring = db.prepare(
  "SELECT COUNT(*) as n FROM leads WHERE source = 'hn-whoshiring'"
).get().n;

counts.ih_products = db.prepare(
  "SELECT COUNT(*) as n FROM leads WHERE source = 'ih-products'"
).get().n;

counts.slavelabour_forhire = db.prepare(
  "SELECT COUNT(*) as n FROM leads WHERE source_platform IN ('reddit_r_slavelabour','reddit_r_forhire')"
).get().n;

// Brave search content entries - name looks like an article slug (no linkedin_url, name > 40 chars, contains spaces = article title)
counts.brave_content = db.prepare(
  "SELECT COUNT(*) as n FROM leads WHERE source_platform = 'brave_search' AND linkedin_url IS NULL AND length(name) > 60"
).get().n;

const totalGarbage = counts.hn_whoshiring + counts.ih_products + counts.slavelabour_forhire + counts.brave_content;

console.log('=== GARBAGE PURGE AUDIT ===');
console.log(`Total leads before: ${before}`);
console.log('');
console.log('Records to remove:');
console.log(`  hn-whoshiring (job postings):        ${counts.hn_whoshiring}`);
console.log(`  ih-products (product listings):      ${counts.ih_products}`);
console.log(`  r/slavelabour + r/forhire (sellers): ${counts.slavelabour_forhire}`);
console.log(`  brave_search article titles:         ${counts.brave_content}`);
console.log(`  TOTAL TO REMOVE:                     ${totalGarbage}`);
console.log(`  Remaining after purge:               ${before - totalGarbage}`);
console.log('');

if (DRY_RUN) {
  console.log('DRY RUN - no changes made.');
  console.log('Run with --execute to delete.');
  db.close();
  process.exit(0);
}

// Execute deletes in a transaction
const purge = db.transaction(() => {
  const r1 = db.prepare("DELETE FROM leads WHERE source = 'hn-whoshiring'").run();
  const r2 = db.prepare("DELETE FROM leads WHERE source = 'ih-products'").run();
  const r3 = db.prepare("DELETE FROM leads WHERE source_platform IN ('reddit_r_slavelabour','reddit_r_forhire')").run();
  const r4 = db.prepare(
    "DELETE FROM leads WHERE source_platform = 'brave_search' AND linkedin_url IS NULL AND length(name) > 60"
  ).run();

  // Also clean orphaned enrichment rows for deleted leads
  db.prepare("DELETE FROM lead_enrichment WHERE lead_id NOT IN (SELECT id FROM leads)").run();
  db.prepare("DELETE FROM lead_interactions WHERE lead_id NOT IN (SELECT id FROM leads)").run();

  return r1.changes + r2.changes + r3.changes + r4.changes;
});

const deleted = purge();
const after = db.prepare('SELECT COUNT(*) as n FROM leads').get().n;

console.log(`PURGED: ${deleted} records`);
console.log(`Leads remaining: ${after}`);
console.log('Orphaned enrichment + interactions cleaned.');

db.close();
