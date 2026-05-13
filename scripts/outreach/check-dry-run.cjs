const Database = require('better-sqlite3');
const db = new Database('/Users/kirder/Desktop/linkedin-brand-os/.data/linkedin-brand-os.sqlite');

const ICP_CATEGORIES = ['landscaping', 'plumbers', 'roofing', 'hvac', 'cleaning-services', 'electrical', 'moving-companies', 'auto-repair', 'garage-doors'];
const placeholders = ICP_CATEGORIES.map(() => '?').join(',');

const rows = db.prepare(`
  SELECT id, business_name, business_email, business_category, subject, body
  FROM outreach_emails
  WHERE status = 'dry_run'
  AND business_category IN (${placeholders})
  AND business_email NOT LIKE 'info@%'
  AND business_email NOT LIKE 'contact@%'
  AND business_email NOT LIKE 'office@%'
  AND business_email NOT LIKE 'hello@%'
  AND business_email NOT LIKE 'admin@%'
  AND business_email NOT LIKE 'support@%'
  AND business_email NOT LIKE 'retail@%'
  AND business_email NOT LIKE 'general@%'
  ORDER BY
    CASE business_category
      WHEN 'landscaping' THEN 1
      WHEN 'plumbers' THEN 2
      WHEN 'roofing' THEN 3
      WHEN 'hvac' THEN 4
      WHEN 'cleaning-services' THEN 5
      WHEN 'auto-repair' THEN 6
      ELSE 7
    END
`).all(...ICP_CATEGORIES);

console.log('ICP + non-generic dry_run:', rows.length);
rows.forEach(r => {
  const hasOwnerLang = /estimates?.*sit|open quotes?|callback|follow.?up|losing jobs/i.test(r.body);
  console.log((hasOwnerLang ? 'OWNER-LANG' : 'OLD-GENERIC'), r.business_category.padEnd(18), r.business_name.padEnd(35), r.business_email);
  if (hasOwnerLang) {
    console.log('  Subject:', r.subject);
    console.log('  Body preview:', r.body.slice(0, 120));
  }
});

const ownerLang = rows.filter(r => /estimates?.*sit|open quotes?|callback|follow.?up|losing jobs/i.test(r.body));
console.log('\nOwner-lang ready:', ownerLang.length);
db.close();
