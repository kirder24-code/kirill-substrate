/**
 * daily-buyer-signal-dispatch.mjs
 *
 * Daily automated pipeline: find budget-signal leads -> enrich -> draft -> dispatch.
 *
 * Steps:
 *   1. Run buyer-signal-analyzer.mjs to re-score DB leads and scan channels
 *   2. Pull top budget-signal leads not yet dispatched today
 *   3. For each lead: enrich via lead-enrichment-bot if not yet enriched
 *   4. Generate personalized outreach draft via AI
 *   5. Pipe batch through dispatch-reddit-drafts.mjs (rate guard + Kirill review)
 *   6. Send Telegram summary with action queue
 *
 * Cron: 0 7 * * * (07:00 daily)
 * Run: node scripts/factory/daily-buyer-signal-dispatch.mjs
 */
import Database from "better-sqlite3";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync, writeFileSync } from "fs";
import { spawnSync } from "child_process";
import { callAI, tgSendToKirill } from "./orchestrator.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DB_PATH = resolve(ROOT, ".data/linkedin-brand-os.sqlite");
const NODE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/node";
const TODAY = new Date().toISOString().slice(0, 10);
const DISPATCH_CAP = 15; // max drafts to pipe per day

const db = new Database(DB_PATH);

const env = Object.fromEntries(
  readFileSync(resolve(ROOT, "apps/api/.env"), "utf-8").split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

// Budget signal patterns (same as buyer-signal-analyzer for consistency)
const BUDGET_STRONG = /\b(we (use|pay for|subscribe to|bought)|paying for|subscri(be|ption)|hired (a|an|agency|developer|consultant|freelancer)|spent .{0,30}(on|for) (software|tools|dev|agency)|monthly (fee|cost|spend)|annual plan|annual contract|how much (do you|does it|is it) cost|what('s| is) (your|the) price|budget for|ready to pay|willing to pay|take my money|shut up and take|how do i (buy|purchase|sign up|get started))\b/i;
const BUDGET_MEDIUM = /\b(looking for (a|an) (tool|solution|software|service|consultant|developer|agency)|considering (switching|moving|trying|hiring)|comparing|alternatives to|vs\b|versus|recommend(ation)?s? for|best (way|tool|app|service|platform) for|anyone (used|tried|using)|review(s)? of|tried [A-Z][a-z]+\?|experience with|worth (it|the price|paying for)|is .{0,30} good|switched from|migrated from)\b/i;
const BUDGET_WEAK = /\b(zapier|make\.com|n8n|airtable|notion|hubspot|salesforce|pipedrive|stripe|lemon squeezy|gumroad|shopify|webflow|bubble|retool|framer|cursor|v0\.dev|lovable|bolt\.new|claude|openai|budget|revenue|mrr|arr|monthly|annually|startup|funded|vc|angel|grant)\b/i;
const HIRING_SIGNAL = /\b(hired|worked with|contracted|freelancer|agency|upwork|toptal|fiverr|99designs|we brought in|brought on|onboard(ed)?|part.?time (hire|help)|contractor|outsource[d]?|consultant)\b/i;

function scoreBudget(text) {
  if (!text) return 0;
  let score = 0;
  if (BUDGET_STRONG.test(text)) score += 40;
  if (BUDGET_MEDIUM.test(text)) score += 20;
  if (BUDGET_WEAK.test(text)) score += 5;
  if (HIRING_SIGNAL.test(text)) score += 25;
  return score;
}

// Step 1: run buyer-signal-analyzer in background (fire-and-forget, don't block)
function runAnalyzer() {
  console.log("[daily-buyer-signal-dispatch] running buyer-signal-analyzer...");
  const r = spawnSync(NODE_BIN, [resolve(__dirname, "buyer-signal-analyzer.mjs")], {
    cwd: ROOT, encoding: "utf-8", timeout: 5 * 60 * 1000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (r.status !== 0) {
    console.error(`[daily-buyer-signal-dispatch] analyzer exited ${r.status}: ${r.stderr?.slice(0, 300)}`);
  } else {
    console.log("[daily-buyer-signal-dispatch] analyzer done");
  }
}

// Step 2: pull top budget-signal leads not dispatched today
function pullBudgetLeads() {
  const leads = db.prepare(`
    SELECT l.id, l.name, l.pain_description, l.source_platform, l.source_url,
           l.stage, l.score,
           e.classification, e.reasoning, e.next_message_angle, e.raw_output,
           e.recommended_action
    FROM leads l
    LEFT JOIN lead_enrichment e ON e.lead_id = l.id
    WHERE l.stage NOT IN ('dead', 'closed', 'not_fit', 'dispatched_today')
      AND l.created_at >= date('now', '-30 days')
      AND l.id NOT IN (
        SELECT DISTINCT lead_id FROM lead_interactions
        WHERE created_at >= date('now', 'start of day')
          AND direction = 'outbound'
      )
    ORDER BY l.score DESC
    LIMIT 200
  `).all();

  const scored = leads.map(l => {
    const allText = [
      l.pain_description || "",
      l.reasoning || "",
      l.next_message_angle || "",
      l.raw_output || "",
    ].join(" ");
    return { ...l, budgetScore: scoreBudget(allText) };
  }).filter(l => l.budgetScore > 0);

  scored.sort((a, b) => b.budgetScore - a.budgetScore);
  return scored.slice(0, DISPATCH_CAP);
}

// Step 3: enrich lead if not already enriched
function enrichLead(leadId) {
  const existing = db.prepare(`SELECT * FROM lead_enrichment WHERE lead_id=?`).get(leadId);
  if (existing) return existing;
  console.log(`[daily-buyer-signal-dispatch] enriching ${leadId}...`);
  const r = spawnSync(NODE_BIN, [resolve(__dirname, "lead-enrichment-bot.mjs"), leadId], {
    cwd: ROOT, encoding: "utf-8", timeout: 4 * 60 * 1000, stdio: "inherit",
  });
  if (r.status !== 0) return null;
  return db.prepare(`SELECT * FROM lead_enrichment WHERE lead_id=?`).get(leadId);
}

// Step 4: generate outreach draft for a single lead
async function generateDraft(lead, enrichment) {
  const platform = (lead.source_platform || "").toLowerCase();
  const isReddit = platform.includes("reddit");
  const kind = isReddit ? "comment" : "dm";
  const angle = enrichment?.next_message_angle || lead.pain_description?.slice(0, 200) || "workflow automation pain";
  const classification = enrichment?.classification || "unknown";

  const system = `You write concise, human outreach drafts for Kirill, a Canadian AI workflow consultant.
Rules:
- No em dashes. Use hyphens only.
- No money-back guarantees or results-based payment promises.
- Sound like a real human, not a bot. No corporate phrases.
- Max 3 sentences for comments. Max 5 sentences for DMs.
- End with a soft open question, not a hard CTA.
- Sign off "-Kirill, Calgary" for DMs only.`;

  const user = `Lead: ${lead.name}
Platform: ${lead.source_platform}
Pain: ${(lead.pain_description || "").slice(0, 300)}
Enrichment: ${classification} - ${angle}
Kind: ${kind}

Write a ${kind === "comment" ? "Reddit comment reply" : "Reddit DM"} that opens a conversation. Output only the draft text, nothing else.`;

  try {
    const result = await callAI(system, user, undefined, false);
    return typeof result === "string" ? result.trim() : null;
  } catch (e) {
    console.error(`[daily-buyer-signal-dispatch] AI draft failed for ${lead.id}: ${e.message}`);
    return null;
  }
}

// Step 5: pipe drafts through dispatch-reddit-drafts.mjs
function dispatchBatch(drafts) {
  if (drafts.length === 0) return;
  const tmpFile = resolve(ROOT, `.data/daily-buyer-dispatch-${TODAY}.json`);
  writeFileSync(tmpFile, JSON.stringify(drafts, null, 2));
  console.log(`[daily-buyer-signal-dispatch] dispatching ${drafts.length} drafts via dispatch wrapper...`);
  const r = spawnSync(NODE_BIN, [resolve(__dirname, "dispatch-reddit-drafts.mjs"), tmpFile], {
    cwd: ROOT, encoding: "utf-8", timeout: 10 * 60 * 1000, stdio: "inherit",
    env: { ...process.env, SKIP_ENRICHMENT: "1" },
  });
  if (r.status !== 0) {
    console.error(`[daily-buyer-signal-dispatch] dispatch exited ${r.status}`);
  } else {
    console.log("[daily-buyer-signal-dispatch] dispatch complete");
  }
}

// Step 6: Telegram summary
async function sendSummary({ total, enriched, drafted, blocked, topLeads }) {
  const lines = [
    `<b>07:00 Buyer Signal Dispatch - ${TODAY}</b>`,
    ``,
    `Budget-signal leads found: ${total}`,
    `Enriched this run: ${enriched}`,
    `Drafts generated: ${drafted}`,
    `Blocked (no budget/enrichment fail): ${blocked}`,
    ``,
  ];

  if (topLeads.length > 0) {
    lines.push(`<b>Action queue (check Telegram for Send buttons):</b>`);
    for (const l of topLeads.slice(0, 5)) {
      lines.push(`- ${l.name} (score ${l.budgetScore}, ${l.source_platform})`);
    }
  } else {
    lines.push(`No budget-signal leads found today. Analyzer ran - check sandbox-review/ for channel report.`);
  }

  lines.push(``);
  lines.push(`Full report: sandbox-review/buyer-signal-report-${TODAY}.md`);

  await tgSendToKirill(lines.join("\n"));
}

// ── Main ───────────────────────────────────────────────────────────────────────
(async () => {
  console.log(`[daily-buyer-signal-dispatch] start ${TODAY}`);

  // Step 1: run analyzer (writes report + sends its own TG summary)
  runAnalyzer();

  // Step 2: pull budget leads
  const budgetLeads = pullBudgetLeads();
  console.log(`[daily-buyer-signal-dispatch] ${budgetLeads.length} budget-signal leads for dispatch`);

  if (budgetLeads.length === 0) {
    await sendSummary({ total: 0, enriched: 0, drafted: 0, blocked: 0, topLeads: [] });
    db.close();
    return;
  }

  // Steps 3+4: enrich and generate drafts
  const drafts = [];
  let enrichedCount = 0;
  let blockedCount = 0;

  for (const lead of budgetLeads) {
    // Step 3: enrich
    let enrichment = lead.classification ? lead : null; // already joined
    if (!enrichment || !enrichment.classification) {
      enrichment = enrichLead(lead.id);
      if (enrichment) enrichedCount++;
    }

    // Skip leads enrichment marked as skip or not_fit
    if (enrichment?.recommended_action === "skip" || enrichment?.classification === "not_fit") {
      blockedCount++;
      continue;
    }

    // Step 4: generate draft
    const body = await generateDraft(lead, enrichment);
    if (!body) {
      blockedCount++;
      continue;
    }

    const platform = (lead.source_platform || "").toLowerCase();
    const sub = platform.includes("reddit_r_") ? platform.replace("reddit_r_", "") : "SaaS";
    const kind = platform.includes("reddit") ? "comment" : "dm";

    drafts.push({
      leadId: lead.id,
      name: lead.name,
      sub,
      kind,
      topic: (lead.pain_description || "").slice(0, 100),
      url: lead.source_url || "",
      body,
    });
  }

  console.log(`[daily-buyer-signal-dispatch] ${drafts.length} drafts ready, ${blockedCount} blocked`);

  // Step 5: dispatch
  dispatchBatch(drafts);

  // Step 6: summary
  await sendSummary({
    total: budgetLeads.length,
    enriched: enrichedCount,
    drafted: drafts.length,
    blocked: blockedCount,
    topLeads: budgetLeads,
  });

  db.close();
  console.log("[daily-buyer-signal-dispatch] done");
})();
