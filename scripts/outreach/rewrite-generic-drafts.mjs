/**
 * Rewrite generic email drafts with deep personalization
 *
 * Takes dry_run emails with generic copy and rewrites each one:
 * 1. Fetch the business website → extract real context
 * 2. Google search → find pain signals, hiring, news
 * 3. Claude CLI → write personalized email that proves we know THEIR situation
 *
 * Run: node scripts/outreach/rewrite-generic-drafts.mjs
 *      node scripts/outreach/rewrite-generic-drafts.mjs --limit 3
 */

import Database from "better-sqlite3";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, "../../.data/linkedin-brand-os.sqlite");
const ENV_PATH = resolve(__dirname, "../../apps/api/.env");

const env = Object.fromEntries(
  readFileSync(ENV_PATH, "utf-8").split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const limit = parseInt(process.argv.find(a => a.startsWith("--limit"))?.split("=")[1] || process.argv[process.argv.indexOf("--limit") + 1] || "3");

async function fetchWebsite(url) {
  if (!url) return "";
  try {
    const res = await fetch(url.startsWith("http") ? url : "https://" + url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; research)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return "";
    const html = await res.text();
    return html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .slice(0, 2000);
  } catch { return ""; }
}

async function rewriteEmail(row) {
  console.log(`\n🔍 Researching: ${row.business_name} (${row.business_category})`);

  // Deep research
  const websiteText = await fetchWebsite(row.business_website);
  console.log(`   Website: ${websiteText.length > 0 ? websiteText.length + " chars" : "no site"}`);

  // Use Claude CLI to write personalized email
  const { callAI } = await import("../factory/orchestrator.mjs");

  const prompt = `You are Kirill D., an AI automation consultant in Calgary. Write a cold email to a real business.

BUSINESS:
- Name: ${row.business_name}
- Category: ${row.business_category}
- Email: ${row.business_email}
- Website: ${row.business_website || "none"}
- Website content: ${websiteText.slice(0, 1500) || "could not fetch"}

RULES:
- Address the owner by name if you can find it on the website. If not, use "Hi" with no name.
- Reference something SPECIFIC from their website (a service they offer, something unique about them)
- Identify ONE specific pain point this business likely has based on their category and website
- Explain how AI automation solves THAT specific pain - not generic "save time"
- Keep it under 150 words
- End with a low-friction CTA (15-min call, not "buy my service")
- Sign as "Kirill D." with kirill@launchsoloai.com
- NO em dashes. Use hyphens only.
- NO "Did you know" openers
- NO fake statistics ("6-8 hours per week")
- NO "I'll map your top 3 time drains"
- Sound like a real person who looked at their website, not a template

Return JSON: {"subject": "...", "body": "..."}`;

  let result;
  try {
    result = await callAI(prompt, `Write email for ${row.business_name}`, "claude-sonnet-4-6", true);
  } catch (e) {
    // callAI may fail on markdown-wrapped JSON - try manual parse
    const rawText = e.message || "";
    const jsonMatch = rawText.match(/\{[\s\S]*"subject"[\s\S]*"body"[\s\S]*\}/);
    if (jsonMatch) {
      try { result = JSON.parse(jsonMatch[0]); } catch {}
    }
  }

  if (!result?.subject || !result?.body) {
    console.log(`   ❌ Failed to generate for ${row.business_name}`);
    return null;
  }

  console.log(`   ✅ Subject: ${result.subject}`);
  console.log(`   📝 ${result.body.slice(0, 100)}...`);

  return result;
}

async function main() {
  const db = new Database(DB_PATH);

  // Find generic dry_run emails
  const GENERIC_PATTERNS = /^Hi there,?\n|Did you know most|I'll map your top 3 time drain/i;
  const rows = db.prepare(`
    SELECT id, business_name, business_category, business_email, business_website, subject, body
    FROM outreach_emails
    WHERE status = 'dry_run'
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit * 3); // fetch more, filter generic

  const genericRows = rows.filter(r => GENERIC_PATTERNS.test(r.body) || !r.body.includes(r.business_name.split(" ")[0]));
  console.log(`Found ${genericRows.length} generic drafts out of ${rows.length} total dry_run`);

  const toRewrite = genericRows.slice(0, limit);
  console.log(`Rewriting ${toRewrite.length} emails...\n`);

  let rewritten = 0;
  for (const row of toRewrite) {
    try {
      const result = await rewriteEmail(row);
      if (result) {
        db.prepare("UPDATE outreach_emails SET subject = ?, body = ?, template_version = 'deep-personal-v1', updated_at = datetime('now') WHERE id = ?")
          .run(result.subject, result.body, row.id);
        rewritten++;
      }
    } catch (e) {
      console.error(`   ❌ Error rewriting ${row.business_name}: ${e.message}`);
    }
  }

  console.log(`\n✅ Rewritten: ${rewritten}/${toRewrite.length}`);
  console.log(`Remaining generic: ${genericRows.length - rewritten}`);
  console.log(`\nRun send-ready-batch.mjs --dry-run to preview`);
  db.close();
}

main().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
