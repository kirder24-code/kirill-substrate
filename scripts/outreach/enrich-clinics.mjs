/**
 * Clinic Enrichment Script
 * Scrapes clinic websites to find:
 * 1. Contact email (prefer personal, accept info@ as last resort)
 * 2. Owner/dentist name from About/Team pages
 * Updates calgary-businesses.json with findings.
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BIZ_FILE = resolve(__dirname, "../../.data/calgary-businesses.json");

async function fetchText(url, timeout = 10000) {
  try {
    const normalUrl = url.startsWith("http") ? url : "https://" + url;
    const res = await fetch(normalUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
      signal: AbortSignal.timeout(timeout),
      redirect: "follow",
    });
    if (!res.ok) return "";
    return await res.text();
  } catch {
    return "";
  }
}

function extractEmails(html) {
  // Match emails in mailto: links and plain text
  const emails = new Set();
  const mailtoRx = /mailto:([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/gi;
  const plainRx = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
  let m;
  while ((m = mailtoRx.exec(html)) !== null) emails.add(m[1].toLowerCase());
  while ((m = plainRx.exec(html)) !== null) {
    const e = m[0].toLowerCase();
    // Skip image files and CSS
    if (!/\.(png|jpg|jpeg|gif|svg|css|js)$/i.test(e)) emails.add(e);
  }
  return [...emails];
}

function extractOwnerName(html, businessName) {
  const text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");

  // Look for owner/founder/partner names
  const drPatterns = [
    /Dr\.?\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+){1,2})/g,
    /(?:owner|founder|principal|partner|president|ceo|managing\s+director|lead\s+dentist|principal\s+dentist)[:\s]+([A-Z][a-z]+(?:\s[A-Z][a-z]+){1,2})/gi,
    /(?:CPA|CA|CMA|MBA|JD|LLB|P\.Eng)[,.\s]+([A-Z][a-z]+(?:\s[A-Z][a-z]+){1,2})/g,
  ];

  const names = [];
  for (const rx of drPatterns) {
    let match;
    while ((match = rx.exec(text)) !== null) {
      const name = match[1].trim();
      // Filter out common false positives
      if (name.length > 3 && name.length < 40 && !/^(The|Our|Your|This|That|New|All)/i.test(name)) {
        names.push(name);
      }
    }
  }

  return names[0] || null;
}

function rankEmails(emails, websiteDomain) {
  // Prefer: firstname@ > name.name@ > office@ > clinic@ > info@
  // Exclude: noreply, support, marketing, careers, jobs
  const blocked = /^(noreply|no-reply|donotreply|support|marketing|newsletter|careers|jobs|hr|webmaster|postmaster|abuse|billing)@/i;
  const filtered = emails.filter(e => !blocked.test(e));

  // Prefer emails matching the website domain
  const domainRoot = websiteDomain?.replace(/^www\./, "").split("/")[0];
  const sameDomain = filtered.filter(e => {
    const emailDomain = e.split("@")[1];
    return emailDomain && domainRoot && emailDomain.includes(domainRoot.split(".").slice(-2, -1)[0]);
  });

  const pool = sameDomain.length > 0 ? sameDomain : filtered;

  // Score: personal > office > generic
  const scored = pool.map(e => {
    const local = e.split("@")[0];
    let score = 0;
    if (/^[a-z]+\.[a-z]+$/i.test(local)) score = 10; // firstname.lastname
    else if (/^[a-z]{2,15}$/i.test(local) && !/^(info|office|admin|contact|hello|clinic|dental|team)$/i.test(local)) score = 8; // single name
    else if (/^(office|admin|contact|hello|reception|front)$/i.test(local)) score = 5;
    else if (/^(clinic|dental|team)$/i.test(local)) score = 3;
    else if (/^info$/i.test(local)) score = 2;
    else score = 1;
    return { email: e, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.email || null;
}

async function enrichClinic(biz) {
  if (!biz.website || biz.website.includes("facebook.com")) {
    console.log(`  [SKIP] ${biz.name} — no usable website`);
    return null;
  }

  const domain = biz.website.replace(/^https?:\/\//, "").replace(/\/$/, "");
  console.log(`  [FETCH] ${biz.name} — ${biz.website}`);

  // Fetch main page + common subpages in parallel
  const baseUrl = biz.website.replace(/\/$/, "");
  const pages = [baseUrl, `${baseUrl}/about`, `${baseUrl}/about-us`, `${baseUrl}/contact`, `${baseUrl}/team`, `${baseUrl}/our-team`, `${baseUrl}/doctors`, `${baseUrl}/dentists`];

  const results = await Promise.all(pages.map(u => fetchText(u, 8000)));
  const allHtml = results.join("\n");

  if (!allHtml.trim()) {
    console.log(`  [FAIL] ${biz.name} — website unreachable`);
    return null;
  }

  const emails = extractEmails(allHtml);
  const bestEmail = rankEmails(emails, domain);
  const ownerName = extractOwnerName(allHtml, biz.name);

  console.log(`  [FOUND] ${biz.name} — email: ${bestEmail || "NONE"}, owner: ${ownerName || "NONE"}`);

  return { email: bestEmail, ownerName };
}

async function main() {
  const businesses = JSON.parse(readFileSync(BIZ_FILE, "utf-8"));
  // Enrich ALL categories — not just clinics
  const targets = businesses.filter(b =>
    b.outreachStatus === "pending" &&
    !b.email &&
    b.website &&
    !b.website.includes("facebook.com") &&
    !b.website.includes("mapquest.com") &&
    !b.website.includes("business.site")
  );

  console.log(`[Enrich] Found ${targets.length} clinics to enrich\n`);

  let enriched = 0;
  for (const biz of targets) {
    const result = await enrichClinic(biz);
    if (result) {
      if (result.email) { biz.email = result.email; enriched++; }
      if (result.ownerName) biz.ownerName = result.ownerName;
    }
    // Small delay to be polite
    await new Promise(r => setTimeout(r, 1500));
  }

  writeFileSync(BIZ_FILE, JSON.stringify(businesses, null, 2));
  console.log(`\n[Enrich] Done. Enriched ${enriched}/${targets.length} clinics with emails.`);

  // Summary of what's ready to send
  const ready = businesses.filter(b =>
    b.outreachStatus === "pending" &&
    b.email &&
    b.ownerName
  );
  console.log(`[Enrich] ${ready.length} clinics now ready for v2 outreach (have email + owner name):`);
  ready.forEach(r => console.log(`  ${r.name} | ${r.email} | ${r.ownerName}`));
}

main().catch(console.error);
