/**
 * Calgary Business Finder
 * Scrapes Yellow Pages Canada for SMBs with websites + emails.
 * Targets industries that benefit from AI automation.
 */
import * as cheerio from "cheerio";
import { writeFileSync, existsSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_FILE = resolve(__dirname, "../../.data/calgary-businesses.json");

// ICP ONLY — Pack 5 doctrine: service businesses that lose jobs to slow follow-up
// DISABLED categories remain in calgary-businesses.json historically but NEW scrapes only hit ICP
const CATEGORIES = [
  "auto-repair",
  "landscaping",
  "cleaning-services",
  "plumbers",
  "electricians",
  "hvac",
  "roofing",
  "moving-companies",
  // ICP-adjacent service businesses that also match (Pack 5 secondary verticals)
  "fencing-contractors",
  "flooring",
  "garage-door",
  "appliance-repair",
  "tree-service",
  "concrete-contractors",
  "window-cleaning",
  "painting-contractors",
  "pest-control",
  "towing",
  "auto-detailing",
];

async function fetchPage(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "en-CA,en;q=0.9",
    },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

const GENERIC_PREFIXES = new Set(["info", "contact", "hello", "admin", "office", "support", "help", "enquiries", "inquiries", "reception", "general", "mail", "team"]);
const JUNK_PATTERNS = ["example.", "@2x", ".png", ".jpg", "sentry", "wix", "wordpress", "schema", "noreply", "no-reply", "unsubscribe", "mailer-daemon"];
const FAKE_EMAILS = new Set(["your@email.com", "name@email.com", "email@email.com", "info@example.com", "test@test.com", "user@domain.com", "you@email.com", "you@youremail.com", "example@mysite.com", "email@yoursite.com", "your@domain.com", "name@yoursite.com", "email@domain.com", "yourname@email.com", "name@domain.com", "email@mysite.com", "you@yoursite.com"]);

// Prefixes that are clearly scraped from page text, not real email addresses
const SCRAPED_TEXT_PREFIXES = new Set(["our", "your", "my", "the", "this", "that", "its", "his", "her", "we", "us", "get", "see", "view", "click", "google", "facebook", "twitter", "linkedin", "instagram", "yelp", "review", "reviews", "read", "more", "learn", "about", "home", "welcome", "here", "new", "free", "best", "top", "all", "any", "how", "why", "what", "when", "where", "who"]);

function isJunkEmail(e) {
  const lower = e.toLowerCase();
  if (FAKE_EMAILS.has(lower)) return true;
  if (JUNK_PATTERNS.some(p => lower.includes(p))) return true;
  if (/\.(png|jpg|gif|svg|css|js)/.test(lower)) return true;
  // Catch placeholder patterns: you@your*, example@*, *@mysite.*, *@yoursite.*
  if (/^(you|your|name|email|example|user|test)@/.test(lower)) return true;
  if (/@(example|mysite|yoursite|youremail|yourmail|domain|email)\b/.test(lower)) return true;
  // Catch scraped text that looks like email (our@domain, google@domain, etc.)
  const prefix = lower.split("@")[0];
  if (SCRAPED_TEXT_PREFIXES.has(prefix)) return true;
  return false;
}

function scoreEmail(e) {
  const prefix = e.split("@")[0].toLowerCase();
  if (GENERIC_PREFIXES.has(prefix)) return 1; // generic — last resort
  if (/^[a-z]+\.[a-z]+$/.test(prefix)) return 3; // firstname.lastname — best
  if (/^[a-z]{2,}$/.test(prefix) && prefix.length > 3) return 2; // single name — good
  return 2; // other personal-looking
}

const NOT_NAMES = new Set(["our approach", "our team", "our staff", "our dentists", "our lawyers", "our doctors", "your orthodontists", "your dentist", "google reviews", "read more", "learn more", "gum graft", "root canal", "teeth whitening", "dental implants", "our services", "our practice", "meet our", "about us", "contact us"]);

function extractContactName(html) {
  // Look for "Owner", "Founder", "Principal", "Dr." near a name pattern
  const patterns = [
    /(?:Owner|Founder|Principal|President|Director|Manager)[:\s—–-]*([A-Z][a-z]+ [A-Z][a-z]+)/g,
    /(?:Dr\.?\s+)([A-Z][a-z]+ [A-Z][a-z]+)/g,
    /(?:Meet|About)\s+([A-Z][a-z]+ [A-Z][a-z]+)/g,
  ];
  for (const rx of patterns) {
    const m = rx.exec(html);
    if (m && m[1] && m[1].length < 40) {
      const candidate = m[1].trim();
      // Filter out non-name matches
      if (NOT_NAMES.has(candidate.toLowerCase())) continue;
      // Names shouldn't contain common words
      if (/\b(Our|Your|The|This|And|For|With|From|About|Meet|More|Read|View|Team|Staff|Google|Review|Graft|Canal|Implant|Service|Practice)\b/i.test(candidate)) continue;
      return candidate;
    }
  }
  return null;
}

async function extractEmailFromWebsite(url) {
  if (!url) return { email: null, ownerName: null };
  try {
    const normalUrl = url.startsWith("http") ? url : "https://" + url;
    const base = new URL(normalUrl).origin;
    const emailRx = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
    let allEmails = [];
    let ownerName = null;

    // Check homepage + inner pages where owner info typically lives
    const pages = [normalUrl, "/about", "/about-us", "/our-team", "/team", "/contact", "/staff", "/people", "/our-dentists", "/dentists", "/lawyers", "/our-lawyers", "/meet-the-team", "/meet-us"];
    for (const pg of pages) {
      try {
        const pageUrl = pg.startsWith("http") ? pg : base + pg;
        const html = await fetchPage(pageUrl);
        const found = [...new Set(html.match(emailRx) || [])].filter(e => !isJunkEmail(e));
        allEmails.push(...found);
        if (!ownerName) ownerName = extractContactName(html);
        // Stop early if we found a personal email + owner name
        const bestSoFar = [...new Set(allEmails)].sort((a, b) => scoreEmail(b) - scoreEmail(a));
        if (bestSoFar.length > 0 && scoreEmail(bestSoFar[0]) >= 3 && ownerName) break;
        await new Promise(r => setTimeout(r, 400));
      } catch {
        // Page doesn't exist, skip
      }
    }

    const unique = [...new Set(allEmails)].filter(e => !isJunkEmail(e));
    unique.sort((a, b) => scoreEmail(b) - scoreEmail(a));

    let bestEmail = unique[0] || null;

    // If we found an owner name but only generic emails, try to construct personal email
    // e.g., Dr. John Smith at domain.ca → john@domain.ca, john.smith@domain.ca
    if (ownerName && (!bestEmail || scoreEmail(bestEmail) <= 1)) {
      const domain = new URL(normalUrl).hostname.replace(/^www\./, "");
      const parts = ownerName.toLowerCase().split(/\s+/).filter(p => p.length > 1);
      if (parts.length >= 2) {
        // Add as candidates — will be tried alongside found emails
        const candidates = [
          `${parts[0]}@${domain}`,                    // john@domain.ca
          `${parts[0]}.${parts[parts.length-1]}@${domain}`, // john.smith@domain.ca
          `${parts[0][0]}${parts[parts.length-1]}@${domain}`, // jsmith@domain.ca
        ];
        // Mark these as constructed (lower confidence) but better than info@
        bestEmail = candidates[0]; // firstname@domain is most common for small biz
      }
    }

    return { email: bestEmail, ownerName };
  } catch {
    return { email: null, ownerName: null };
  }
}

function extractWebsiteFromYPUrl(href) {
  if (!href) return null;
  // YP wraps external links as /gourl/HASH?redirect=URL
  const redirectMatch = href.match(/[?&]redirect=([^&]+)/);
  if (redirectMatch) {
    return decodeURIComponent(redirectMatch[1]);
  }
  if (href.startsWith("http")) return href;
  return null;
}

async function scrapeCategoryPage(category, page = 1) {
  const url = `https://www.yellowpages.ca/search/si/${page}/${encodeURIComponent(category)}/Calgary+AB`;
  console.log(`[Finder] Scraping: ${category} p${page}`);
  const html = await fetchPage(url);
  const $ = cheerio.load(html);
  const businesses = [];

  // Each listing block
  $(".listing").each((_, el) => {
    const name = $(el).find(".jsListingName, .listing__name--link, h3.listing__name").first().text().trim();
    if (!name || name.length < 3) return;

    // Website link via /gourl/ redirect
    const websiteHref = $(el).find("a[href*='/gourl/']").attr("href");
    const website = extractWebsiteFromYPUrl(websiteHref);

    // Phone
    const phone = $(el).find("[class*='phone'], .listing__phone").first().text().trim().replace(/\s+/g, " ") || null;

    // Address
    const address = $(el).find(".listing__address, [class*='address']").first().text().trim() || "Calgary, AB";

    businesses.push({ name, website, phone, address, category, source: "yellowpages.ca" });
  });

  console.log(`[Finder] Found ${businesses.length} listings for ${category}`);
  return businesses;
}

export async function findCalgaryBusinesses({ maxPerCategory = 25, maxTotal = 1500, extractEmails = true } = {}) {
  let all = [];

  // Load existing to avoid duplicates
  if (existsSync(OUT_FILE)) {
    try { all = JSON.parse(readFileSync(OUT_FILE, "utf-8")); } catch {}
    console.log(`[Finder] Loaded ${all.length} existing businesses`);
  }

  const existingNames = new Set(all.map(b => b.name.toLowerCase()));

  for (const cat of CATEGORIES) {
    if (all.length >= maxTotal) break;
    try {
      // Scrape pages 1-3 to get more leads
      let results = [];
      for (let page = 1; page <= 3; page++) {
        try {
          const pageResults = await scrapeCategoryPage(cat, page);
          if (pageResults.length === 0) break; // no more pages
          results.push(...pageResults);
          if (page < 3) await new Promise(r => setTimeout(r, 1500));
        } catch { break; }
      }
      const newOnes = results
        .filter(b => !existingNames.has(b.name.toLowerCase()))
        .slice(0, maxPerCategory);

      // Try to extract email + owner name from website
      if (extractEmails) {
        for (const biz of newOnes) {
          if (biz.website && !biz.email) {
            const { email, ownerName } = await extractEmailFromWebsite(biz.website);
            biz.email = email;
            if (ownerName) biz.ownerName = ownerName;
            if (biz.email) {
              const isPersonal = !GENERIC_PREFIXES.has(biz.email.split("@")[0].toLowerCase());
              console.log(`[Finder]   ✉️ ${biz.name}: ${biz.email}${isPersonal ? " (personal)" : " (generic)"}${ownerName ? ` [${ownerName}]` : ""}`);
            }
            await new Promise(r => setTimeout(r, 800));
          }
        }
      }

      all.push(...newOnes);
      newOnes.forEach(b => existingNames.add(b.name.toLowerCase()));
      console.log(`[Finder] ${cat}: +${newOnes.length} (total: ${all.length})`);
      await new Promise(r => setTimeout(r, 1200));
    } catch (err) {
      console.warn(`[Finder] Failed ${cat}: ${err.message}`);
    }
  }

  const withDate = all.map(b => ({
    ...b,
    discoveredAt: b.discoveredAt || new Date().toISOString(),
    outreachStatus: b.outreachStatus || "pending",
  }));

  writeFileSync(OUT_FILE, JSON.stringify(withDate, null, 2));
  const withEmail = withDate.filter(b => b.email);
  console.log(`[Finder] Done: ${withDate.length} total, ${withEmail.length} with email`);
  return withDate;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  findCalgaryBusinesses()
    .then(r => console.log(`\n✅ ${r.length} businesses, ${r.filter(b=>b.email).length} with email`))
    .catch(console.error);
}
