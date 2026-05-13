// Find top priority leads for manual first batch
const fs = require('fs');
const businesses = JSON.parse(fs.readFileSync('/Users/kirder/Desktop/linkedin-brand-os/.data/calgary-businesses.json', 'utf-8'));

const ICP_CATEGORIES = /^(landscaping|plumbers|electricians|hvac|roofing|moving-companies|auto-repair|cleaning-services|garage-door|fencing-contractors|towing|appliance-repair|flooring)/i;

const GENERIC = /^(info|contact|hello|office|admin|general|inquiries|enquiries|reception|support|noreply|no-reply|donotreply|marketing|newsletter|webmaster|postmaster|billing|careers|hr|media|feedback|sales|press|dispatch|concierge|help|team|service|services|staff|booking|bookings|appointments|mail|retail|lender|comments)$/i;

const PLACEHOLDER = /example\.|youremail\.|mysite\.|test@|placeholder|friend@|your@|you@|name@|user@|email@|someone@|sample@|noreply@|no-reply@|donotreply@/i;

const FREE_MAIL = /@(gmail|yahoo|hotmail|outlook|aol|icloud|live|msn|proton|zoho)\.(com|ca|net)/i;
const SERVICE_CATS = /^(plumbers|electricians|hvac|roofing|moving-companies|auto-repair|cleaning-services|landscaping)/i;

// Priority scoring: prefer personal business emails, owner-name emails, good categories
const PRIORITY_CATS = { 'landscaping': 10, 'plumbers': 9, 'hvac': 9, 'roofing': 8, 'cleaning-services': 7, 'auto-repair': 6, 'electricians': 9, 'moving-companies': 6 };

const pending = businesses.filter(b => b.email && b.outreachStatus === 'pending' && ICP_CATEGORIES.test(b.category));
console.log('Total ICP pending:', pending.length);

const qualified = pending.filter(b => {
  const local = b.email.split('@')[0].toLowerCase();
  if (PLACEHOLDER.test(b.email)) return false;
  if (GENERIC.test(local)) return false;
  if (local.length > 30) return false;
  if (FREE_MAIL.test(b.email) && !SERVICE_CATS.test(b.category)) return false;
  // Name artifact cleanup
  b.name = b.name.replace(/^\d+\s*\n?\s*/, '').trim();
  return true;
});

console.log('Qualified leads:', qualified.length);

// Score each lead
const scored = qualified.map(b => {
  let score = PRIORITY_CATS[b.category] || 5;
  const local = b.email.split('@')[0].toLowerCase();
  // Personal name in email = big boost
  if (/^[a-z]+\.[a-z]+$/.test(local)) score += 5; // firstname.lastname@
  if (/^[a-z]{3,10}@/.test(local) && !FREE_MAIL.test(b.email)) score += 3; // short personal prefix on biz domain
  if (FREE_MAIL.test(b.email)) score -= 2; // freemail penalty
  if (b.website) score += 1; // has website
  return { ...b, score };
});

scored.sort((a, b) => b.score - a.score);

console.log('\nTop 10 priority leads:\n');
scored.slice(0, 10).forEach((b, i) => {
  console.log(`${i+1}. [score=${b.score}] ${b.category.padEnd(18)} ${b.name.padEnd(35)} ${b.email}`);
  if (b.website) console.log(`   Website: ${b.website}`);
});
