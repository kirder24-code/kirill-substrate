/**
 * pipeline-bridge.mjs
 *
 * Connects the NEW Claude-based pipeline (lead_enrichment) to the OLD
 * OpenAI-based task system (bot_tasks for sales-bot, content-bot).
 *
 * Without this bridge: enrichment finds warming leads, but sales-bot
 * sees 0 tasks and exits. Content-bot has no pain signals to write about.
 *
 * What it does:
 *   1. Finds warming/ready_buyer leads not yet pushed to task queue
 *   2. Creates "new_lead" tasks for sales-bot (qualification + proposals)
 *   3. Creates "draft_from_lead_pain" tasks for content-bot (LinkedIn posts)
 *   4. Marks bridged leads so they don't get re-pushed
 *
 * Schedule: every hour at :05 via sonnet-bots-daemon
 * Built: April 14 2026
 */
import Database from "better-sqlite3";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import { readWiki, readPurpose, appendLog } from "../../wiki/reader.mjs";
const _purpose = readPurpose();

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DB_PATH = resolve(ROOT, ".data/linkedin-brand-os.sqlite");

function log(msg) {
  console.log(`${new Date().toISOString()} [pipeline-bridge] ${msg}`);
}

const db = new Database(DB_PATH);

// Ensure bot_tasks table exists (it should, but be safe)
try {
  db.prepare("SELECT 1 FROM bot_tasks LIMIT 1").get();
} catch {
  log("bot_tasks table missing - cannot bridge");
  db.close();
  process.exit(0);
}

// Find warming/ready_buyer leads that haven't been bridged yet
// "bridged" = has a task in bot_tasks with their lead ID
const warmingLeads = db.prepare(`
  SELECT l.id, l.name, l.pain_description, l.source_url, l.score,
         l.service_match, l.source, l.created_at,
         e.classification, e.reasoning, e.recommended_action,
         e.pain_category, e.pain_evidence, e.best_micro_offer,
         e.buyer_score, e.pain_score
  FROM leads l
  JOIN lead_enrichment e ON e.lead_id = l.id
  WHERE e.classification IN ('warming', 'ready_buyer')
    AND e.buyer_score >= 2.5
    AND (e.best_micro_offer IS NULL OR e.best_micro_offer != 'do_not_pitch')
    AND datetime(l.created_at) > datetime('now', '-30 days')
    AND l.id NOT IN (
      SELECT DISTINCT json_extract(payload_json, '$.leadId')
      FROM bot_tasks
      WHERE to_bot = 'sales' AND json_extract(payload_json, '$.leadId') IS NOT NULL
    )
  ORDER BY
    CASE WHEN e.classification = 'ready_buyer' THEN 0 ELSE 1 END,
    e.buyer_score DESC
  LIMIT 10
`).all();

log(`found ${warmingLeads.length} warming/ready_buyer leads to bridge`);

let salesTasks = 0;
let contentTasks = 0;

const insertTask = db.prepare(`
  INSERT INTO bot_tasks (id, from_bot, to_bot, task_type, payload_json, priority, status, created_at)
  VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
`);

for (const lead of warmingLeads) {
  const now = new Date().toISOString();

  // Task for sales-bot: qualify and notify Kirill
  insertTask.run(
    randomUUID(), "pipeline-bridge", "sales", "new_lead",
    JSON.stringify({
      leadId: lead.id,
      leadName: lead.name,
      source: lead.source,
      classification: lead.classification,
      buyerScore: lead.buyer_score,
      painCategory: lead.pain_category,
      bestOffer: lead.best_micro_offer,
      reasoning: lead.reasoning?.slice(0, 500),
    }),
    lead.classification === "ready_buyer" ? 10 : 7,
    now
  );
  salesTasks++;

  // Task for content-bot: draft LinkedIn post from this lead's pain
  // Only if pain is clear enough to write about
  if (lead.pain_evidence && lead.pain_category && lead.pain_category !== "unclear") {
    // Check if we already have a content task for this pain category recently
    const recentContentTask = db.prepare(`
      SELECT id FROM bot_tasks
      WHERE to_bot = 'content_factory'
        AND task_type = 'draft_from_lead_pain'
        AND payload_json LIKE ?
        AND created_at > datetime('now', '-3 days')
    `).get(`%${lead.pain_category}%`);

    if (!recentContentTask) {
      insertTask.run(
        randomUUID(), "pipeline-bridge", "content_factory", "draft_from_lead_pain",
        JSON.stringify({
          // content-bot expects "pains" array with {category, evidence, url} objects
          pains: [{
            category: lead.pain_category,
            evidence: lead.pain_evidence || "operational pain from lead research",
            url: lead.source_url || "",
            name: lead.name,
          }],
          painCategory: lead.pain_category,
          bestOffer: lead.best_micro_offer,
        }),
        5,
        now
      );
      contentTasks++;
    }
  }

  log(`bridged: ${lead.name} (${lead.classification}, buyer=${lead.buyer_score}) → sales task + ${lead.pain_category ? "content task" : "no content"}`);
}

log(`done: ${salesTasks} sales tasks, ${contentTasks} content tasks created`);

db.close();
