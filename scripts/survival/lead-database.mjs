/**
 * scripts/survival/lead-database.mjs
 *
 * Read-only access to .data/linkedin-brand-os.sqlite — substrate's
 * accumulated outreach + leads history. Substrate uses this to ground
 * draft generation in actual prior contact patterns instead of writing
 * generic templates.
 *
 * Three query primitives:
 *   getOutreachStats() — totals, status breakdown, reply rate
 *   findRepliedExamples(query, limit) — find past emails that got
 *     meaningful replies, optionally filtered by keyword
 *   findLeadsByCategory(category, limit) — find leads in a vertical
 */

import Database from "better-sqlite3";
import { resolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DB_PATH = resolve(ROOT, ".data/linkedin-brand-os.sqlite");

function readonly() {
  if (!existsSync(DB_PATH)) return null;
  return new Database(DB_PATH, { readonly: true });
}

export function getOutreachStats() {
  const db = readonly();
  if (!db) return null;
  try {
    const totals = db.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status='sent' OR status='replied' OR status='bounced' THEN 1 ELSE 0 END) AS delivered,
              SUM(CASE WHEN status='replied' THEN 1 ELSE 0 END) AS replied
       FROM outreach_emails`
    ).get();
    const byStatus = db.prepare(`SELECT status, COUNT(*) AS n FROM outreach_emails GROUP BY status ORDER BY 2 DESC`).all();
    const byCategory = db.prepare(
      `SELECT business_category AS category, COUNT(*) AS n,
              SUM(CASE WHEN status='replied' THEN 1 ELSE 0 END) AS replied
       FROM outreach_emails
       WHERE business_category IS NOT NULL
       GROUP BY business_category ORDER BY n DESC LIMIT 20`
    ).all();
    const replyRate = totals.delivered > 0 ? totals.replied / totals.delivered : 0;
    return { totals, by_status: byStatus, by_category: byCategory, reply_rate: replyRate };
  } finally { db.close(); }
}

export function findRepliedExamples(query, { limit = 5 } = {}) {
  const db = readonly();
  if (!db) return [];
  try {
    let rows;
    if (query) {
      const q = `%${String(query).toLowerCase()}%`;
      rows = db.prepare(
        `SELECT business_name, business_email, business_category, subject, body, reply_body, reply_received_at, reply_type, reply_sentiment
         FROM outreach_emails
         WHERE status='replied' AND is_meaningful_reply=1
           AND (LOWER(business_name) LIKE ? OR LOWER(business_category) LIKE ? OR LOWER(subject) LIKE ?)
         ORDER BY reply_received_at DESC LIMIT ?`
      ).all(q, q, q, limit);
    } else {
      rows = db.prepare(
        `SELECT business_name, business_email, business_category, subject, body, reply_body, reply_received_at, reply_type, reply_sentiment
         FROM outreach_emails
         WHERE status='replied' AND is_meaningful_reply=1
         ORDER BY reply_received_at DESC LIMIT ?`
      ).all(limit);
    }
    return rows;
  } finally { db.close(); }
}

export function findLeadsByCategory(category, { limit = 10 } = {}) {
  const db = readonly();
  if (!db) return [];
  try {
    const q = `%${String(category).toLowerCase()}%`;
    return db.prepare(
      `SELECT name, company, role, industry, location, source_platform, score, stage
       FROM leads
       WHERE LOWER(industry) LIKE ? OR LOWER(role) LIKE ? OR LOWER(company) LIKE ?
       ORDER BY score DESC LIMIT ?`
    ).all(q, q, q, limit);
  } finally { db.close(); }
}

/**
 * Build a compact prompt-ready knowledge block: stats + a few replied
 * examples + matching leads. Used by draft-generating actions.
 */
export function buildLeadKnowledgeBlock(query, { limit = 3 } = {}) {
  const stats = getOutreachStats();
  if (!stats) return "(lead database not present)";
  const examples = findRepliedExamples(query, { limit });
  const leads = findLeadsByCategory(query, { limit });

  let block = `LEAD DATABASE STATE:\n`;
  block += `- Total outreach attempts: ${stats.totals.total}\n`;
  block += `- Delivered (sent/bounced/replied): ${stats.totals.delivered}\n`;
  block += `- Got meaningful reply: ${stats.totals.replied}\n`;
  block += `- Reply rate: ${(stats.reply_rate * 100).toFixed(2)}%\n`;
  block += `- Top categories by volume: ${stats.by_category.slice(0, 5).map(c => `${c.category}(${c.n})`).join(", ")}\n\n`;

  if (examples.length > 0) {
    block += `PAST REPLIES MATCHING "${query}":\n`;
    for (const e of examples) {
      block += `- ${e.business_name} (${e.business_category || "unknown"}): "${(e.reply_body || "").slice(0, 200).replace(/\s+/g, " ")}" [${e.reply_sentiment || "n/a"}]\n`;
    }
    block += "\n";
  } else {
    block += `PAST REPLIES MATCHING "${query}": none\n\n`;
  }

  if (leads.length > 0) {
    block += `LEADS MATCHING "${query}" (top ${leads.length}):\n`;
    for (const l of leads) {
      block += `- ${l.name} @ ${l.company || "(no company)"} [${l.role || "?"}, ${l.industry || "?"}, ${l.location || "?"}], stage=${l.stage}, score=${l.score}\n`;
    }
  } else {
    block += `LEADS MATCHING "${query}": none\n`;
  }
  return block;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const q = process.argv.slice(2).join(" ") || "automation";
  console.log(buildLeadKnowledgeBlock(q));
}
