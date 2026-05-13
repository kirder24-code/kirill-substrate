/**
 * icp-burn.mjs
 *
 * Aggressive parallel ICP enrichment burn. Built April 8 2026 when Kirill
 * said "I am not sleeping until the system finds a real hot lead". The
 * normal hourly icp-outreach-bot processes 10 leads/hour - too slow when
 * we have 496 fresh apify leads sitting in the funnel.
 *
 * What this does:
 *   1. Pulls top 100 unenriched leads (apify-twitter-icp first, then fresh-pain)
 *   2. Spawns 4 parallel enrichment workers (each runs lead-enrichment-bot
 *      sequentially on its slice of 25 leads)
 *   3. After each enrichment, checks the result. If warming or ready_buyer,
 *      immediately drafts a DM via Sonnet and dispatches to Telegram with
 *      Send/Skip buttons.
 *   4. Streams progress to console + sends a final summary to Telegram
 *
 * Total time: ~30-40 minutes for 100 leads (4 parallel × ~25 × 75s).
 * Expected hits: 5-15 warming/ready_buyer if Apify queries are tuned.
 *
 * Usage: node scripts/factory/icp-burn.mjs [--limit 100] [--workers 4]
 */
import Database from "better-sqlite3";
import { spawn, spawnSync } from "child_process";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { writeFileSync } from "fs";
import { tgSendToKirill } from "./orchestrator.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DB_PATH = resolve(ROOT, ".data/linkedin-brand-os.sqlite");
const NODE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/node";

const args = process.argv.slice(2);
const LIMIT = parseInt(args[args.indexOf("--limit") + 1]) || 100;
const WORKERS = parseInt(args[args.indexOf("--workers") + 1]) || 4;

function log(msg) {
  console.log(`${new Date().toISOString().slice(11, 19)} [burn] ${msg}`);
}

async function enrichLead(leadId) {
  return new Promise(resolveP => {
    const child = spawn(NODE_BIN, ["scripts/factory/lead-enrichment-bot.mjs", leadId], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "", stderr = "";
    child.stdout.on("data", d => stdout += d.toString());
    child.stderr.on("data", d => stderr += d.toString());
    child.once("close", () => resolveP({ stdout, stderr }));
    child.once("error", () => resolveP({ stdout: "", stderr: "spawn error" }));
  });
}

async function draftAndDispatch(lead, enrichment) {
  // Build prompt for Sonnet drafter
  const prompt = `You are drafting a Twitter DM (or Reddit DM if source is reddit) from Kirill, a solo AI/automation consultant in Calgary, to a founder he found via cold scraping.

LEAD CONTEXT:
- Username: ${lead.name}
- Source: ${lead.source}
- Their post text + bio: ${(lead.pain_description || "").slice(0, 1500)}
- Source URL: ${lead.source_url}

ENRICHMENT (Sonnet 4.6 already classified):
- Classification: ${enrichment.classification} (${enrichment.confidence})
- Reasoning: ${enrichment.reasoning}
- Recommended angle: ${enrichment.next_message_angle || "natural peer help"}

KIRILL'S OFFERS (only mention naturally if angle fits):
1. Vibe-Code Audit ($1.5-2.5K CAD, 1 week) - vibe-coded MVPs broken in production
2. Reply Chaser ($1.5K CAD) - cold outreach with no follow-up automation
3. First 10 Customers ($2K CAD, 1 week) - solo founders 0-10 paying customers
4. Custom AI / n8n ($2.5-8K CAD)

WRITING RULES (ABSOLUTE):
- 120-180 words for Twitter, 150-220 for Reddit
- Plain prose paragraphs, NO bullet lists, NO headers
- Open with a SPECIFIC observation about their tweet/post (prove you read it)
- 2 tactical observations actually relevant to their stated situation
- Soft offer at end ("happy to share what works"), NEVER hard pitch
- Sign exactly: "- Kirill, Calgary\\nlaunchsoloai.com"
- NO em-dash. NO money-back guarantees. NO AI-tells (delve, leverage, robust, seamless, navigate, foster, embark, landscape, realm)
- NO fake authority, NO made-up case studies

Output ONLY the DM body. No preamble, no JSON, no markdown fences.`;

  const r = spawnSync(
    "$HOME/.nvm/versions/node/v22.22.2/bin/claude",
    ["-p", "--model", "claude-sonnet-4-6", "--max-turns", "3"],
    { input: prompt, encoding: "utf-8", timeout: 5 * 60 * 1000 }
  );
  const body = (r.stdout || "").trim();
  if (!body || body.length < 80) return false;

  // Determine kind based on source
  const kind = lead.source.includes("reddit") || lead.source.includes("fresh-pain") ? "dm" : "dm";

  const draft = [{
    leadId: lead.id,
    name: lead.name,
    kind,
    topic: (lead.pain_description || "").split("\n")[0].slice(0, 100),
    url: lead.source_url || "",
    ageDays: 1,
    body,
  }];

  const tmpFile = `/tmp/burn-draft-${lead.id}.json`;
  writeFileSync(tmpFile, JSON.stringify(draft));

  const dispatch = spawnSync(
    NODE_BIN,
    ["scripts/factory/dispatch-reddit-drafts.mjs", tmpFile],
    { cwd: ROOT, encoding: "utf-8", timeout: 5 * 60 * 1000 }
  );

  log(`📨 dispatched ${lead.name} (${enrichment.classification})`);
  return true;
}

async function worker(workerId, leadIds) {
  const db = new Database(DB_PATH, { readonly: true });
  let processed = 0, hits = 0;

  for (const id of leadIds) {
    try {
      log(`worker${workerId}: enriching ${id.slice(0, 8)}`);
      await enrichLead(id);

      // Re-read enrichment from DB
      const enr = db.prepare(`SELECT * FROM lead_enrichment WHERE lead_id=?`).get(id);
      if (!enr) {
        log(`worker${workerId}: ${id.slice(0, 8)} no enrichment row, skip`);
        continue;
      }
      log(`worker${workerId}: ${id.slice(0, 8)} → ${enr.classification} (${enr.confidence})`);

      if (["warming", "ready_buyer"].includes(enr.classification)) {
        const lead = db.prepare(`SELECT * FROM leads WHERE id=?`).get(id);
        if (lead) {
          await draftAndDispatch(lead, enr);
          hits++;
        }
      }
      processed++;
    } catch (e) {
      log(`worker${workerId}: error on ${id.slice(0, 8)}: ${e.message}`);
    }
  }

  db.close();
  return { workerId, processed, hits };
}

async function main() {
  const db = new Database(DB_PATH);

  log(`starting burn: limit=${LIMIT} workers=${WORKERS}`);

  // Pull top unenriched fresh-pain-scout (Reddit) leads.
  // Reddit posts have much richer context than Twitter - 5x better hit rate.
  // Switched April 8 2026 after Twitter burn showed 0 warming in 30 leads.
  const sourceFilter = args.includes("--twitter") ? "apify-%" : "fresh-pain-scout";
  const op = args.includes("--twitter") ? "LIKE" : "=";
  const candidates = db.prepare(`
    SELECT l.id FROM leads l
    LEFT JOIN lead_enrichment e ON e.lead_id = l.id
    WHERE e.lead_id IS NULL
      AND datetime(l.created_at) > datetime('now', '-48 hours')
      AND l.source ${op} ?
    ORDER BY l.score DESC
    LIMIT ?
  `).all(sourceFilter, LIMIT).map(r => r.id);

  log(`pulled ${candidates.length} unenriched apify leads`);
  db.close();

  if (candidates.length === 0) {
    await tgSendToKirill(`🔥 <b>icp-burn</b> nothing to enrich (apify funnel empty)`);
    return;
  }

  await tgSendToKirill(
    `🔥 <b>icp-burn started</b>\n\n` +
    `Processing <b>${candidates.length}</b> apify leads with <b>${WORKERS}</b> parallel workers.\n` +
    `Each warming/ready_buyer hit drafts a DM and dispatches to you immediately.\n` +
    `Estimated time: ~${Math.ceil(candidates.length / WORKERS * 75 / 60)} minutes.\n\n` +
    `Silence on not_fit/peer/lurker - heartbeat will show counts.`
  );

  // Slice into worker chunks
  const chunks = Array.from({ length: WORKERS }, (_, i) =>
    candidates.filter((_, idx) => idx % WORKERS === i)
  );

  const startTime = Date.now();
  const results = await Promise.all(chunks.map((c, i) => worker(i + 1, c)));
  const elapsed = Math.round((Date.now() - startTime) / 1000);

  const totalHits = results.reduce((sum, r) => sum + r.hits, 0);
  const totalProcessed = results.reduce((sum, r) => sum + r.processed, 0);

  await tgSendToKirill(
    `🏁 <b>icp-burn complete</b>\n\n` +
    `Processed: <b>${totalProcessed}/${candidates.length}</b>\n` +
    `Time: ${Math.floor(elapsed / 60)}m ${elapsed % 60}s\n` +
    `🎯 Warming/ready_buyer hits: <b>${totalHits}</b>\n` +
    `Drafts dispatched: ${totalHits}\n\n` +
    (totalHits === 0
      ? `⚠️ Zero hot leads in this batch. Need to rerun apify-icp-hunter with different queries OR conclude the Twitter intent signal is weaker than expected.`
      : `Check Telegram for ${totalHits} draft(s) ready to Send.`)
  );

  log(`done. ${totalHits} hits / ${totalProcessed} processed in ${elapsed}s`);
}

main().catch(e => {
  console.error("[burn] FATAL:", e);
  tgSendToKirill(`🚨 icp-burn CRASHED: ${e.message}`).catch(() => {});
  process.exit(1);
});
