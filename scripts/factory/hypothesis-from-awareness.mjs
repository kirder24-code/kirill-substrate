/**
 * hypothesis-from-awareness.mjs
 *
 * Closes the awareness -> hypothesis -> test loop.
 *
 * Problem: case_study items in awareness_items (e.g. "small business owner with
 * missed-calls pain", "agent drift in production") are valuable signals about
 * real ICP behavior, but currently sit unused at status='new' or 'integrated'.
 * Discovery-engine generates hypotheses from its own brave-search + db-analysis
 * passes but never reads awareness case_study findings.
 *
 * This bot bridges that gap: scans high-score case_study items, generates a
 * hypothesis JSON for each, appends to .data/cortex-discovery-state.json
 * queuedHypotheses array. hypothesis-executor then picks them up on its next run.
 *
 * Marks source items as 'integrated' once they've been turned into a hypothesis
 * so the same case_study doesn't spawn duplicate tests.
 *
 * Schedule: daily at 09:45 UTC (15min after awareness-apply, gives fresh
 * just-promoted case_study items a chance to be processed).
 *
 * Run: node scripts/factory/hypothesis-from-awareness.mjs [N]   (default top 3)
 *
 * Built 2026-05-09 as item #11 of the autonomous-learning-loop work.
 */

import Database from "better-sqlite3";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, "../../.data/linkedin-brand-os.sqlite");
const STATE_PATH = resolve(__dirname, "../../.data/cortex-discovery-state.json");
const ENV_PATH = resolve(__dirname, "../../apps/api/.env");

const env = Object.fromEntries(
  readFileSync(ENV_PATH, "utf-8").split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const TOP_N = Math.max(1, Math.min(5, parseInt(process.argv[2] || "3", 10)));
const MIN_SCORE = 12;

// Cap on queue depth - if we already have N+ queued hypotheses, don't pile on more.
// hypothesis-executor processes one active hypothesis at a time.
const MAX_QUEUE_DEPTH = 6;

async function generateHypothesisJson(item) {
  const systemPrompt = `You are CORTEX. Convert a Reddit/blog case study finding into a TESTABLE business hypothesis for Kirill (solo AI/automation consultant in Calgary). Output a hypothesis matching this schema:
{
  "market": "specific ICP segment (1 sentence, who exactly)",
  "pain": "the specific operational pain to test (with concrete signal)",
  "channel": "subreddit/platform + specific search angle",
  "test_action": "exact action to take (e.g. post 5 expert comments on r/X about Y, framed as Z, with offer of free 30-min audit)",
  "success_metric": "concrete measurable outcome (e.g. 2+ DM requests in 5 days)",
  "duration_days": 5,
  "confidence": "high|medium|low",
  "reasoning": "why this case study points to a real testable opportunity, what evidence supports it"
}

Rules:
- The hypothesis must be ACTIONABLE within 5-7 days (not strategic abstractions)
- Pull specifics from the case study, do not invent numbers
- ICP must match Kirill's positioning: solo SaaS founders post-launch, professional services with workflow pain, franchises/chains
- NO em dashes, hyphens only`;

  const userPrompt = `CASE STUDY:
Title: ${item.title}
Score: ${item.score}/${item.confidence}
Category: ${item.category}
Summary: ${item.summary || "(none)"}
Why matters: ${item.why_matters || "(none)"}
URL: ${item.url || "(none)"}

Convert into hypothesis JSON.`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-5.4-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_completion_tokens: 1200,
      temperature: 0.5,
      response_format: { type: "json_object" },
    }),
  });
  const data = await res.json();
  if (!data.choices?.[0]?.message?.content) {
    throw new Error("LLM no content: " + JSON.stringify(data).slice(0, 200));
  }
  return JSON.parse(data.choices[0].message.content);
}

async function main() {
  const db = new Database(DB_PATH);

  // Load discovery state
  if (!existsSync(STATE_PATH)) {
    console.error("[hyp-from-aware] discovery state file missing, abort");
    process.exit(1);
  }
  const state = JSON.parse(readFileSync(STATE_PATH, "utf-8"));
  state.queuedHypotheses = state.queuedHypotheses || [];

  if (state.queuedHypotheses.length >= MAX_QUEUE_DEPTH) {
    console.log(`[hyp-from-aware] queue depth ${state.queuedHypotheses.length} >= cap ${MAX_QUEUE_DEPTH}, skipping`);
    db.close();
    return;
  }

  // Pull top N case_study items not yet converted
  const rows = db.prepare(`
    SELECT id, score, title, category, summary, why_matters, action_type, action_target, url, confidence, status
    FROM awareness_items
    WHERE category = 'case_study'
      AND status IN ('new', 'apply_now')
      AND score >= ?
    ORDER BY score DESC, created_at DESC
    LIMIT ?
  `).all(MIN_SCORE, TOP_N);

  if (rows.length === 0) {
    console.log("[hyp-from-aware] no case_study items >= score 12 in 'new'/'apply_now', skipping");
    db.close();
    return;
  }

  console.log(`[hyp-from-aware] processing ${rows.length} case_study items (queue currently ${state.queuedHypotheses.length})`);

  let added = 0;
  for (const item of rows) {
    try {
      console.log(`  generating hypothesis for: "${item.title?.slice(0, 70)}"`);
      const hyp = await generateHypothesisJson(item);

      // Validate required fields
      if (!hyp.market || !hyp.pain || !hyp.test_action) {
        console.warn(`    skipped: missing required field (market/pain/test_action)`);
        continue;
      }

      // Append to queue with provenance trail
      state.queuedHypotheses.push({
        ...hyp,
        status: "queued",
        startedAt: null,
        analyzedAt: null,
        verdict: null,
        results: null,
        sourceAwarenessItem: item.id,
        sourceAwarenessTitle: item.title,
        sourceAwarenessUrl: item.url,
        createdAt: new Date().toISOString(),
        createdBy: "hypothesis-from-awareness",
      });
      added++;

      // Mark source item as integrated so we don't re-spawn from same case study
      db.prepare(`UPDATE awareness_items SET status = 'integrated', updated_at = ? WHERE id = ?`)
        .run(new Date().toISOString(), item.id);

      console.log(`    added: ${hyp.market.slice(0, 80)}`);

      // Stop if queue cap reached mid-loop
      if (state.queuedHypotheses.length >= MAX_QUEUE_DEPTH) {
        console.log(`  queue cap ${MAX_QUEUE_DEPTH} reached, stopping`);
        break;
      }
    } catch (e) {
      console.error(`  failed: ${e.message}`);
    }
  }

  if (added > 0) {
    state.updatedAt = new Date().toISOString();
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
    console.log(`[hyp-from-aware] queued ${added} new hypotheses (total queue: ${state.queuedHypotheses.length})`);
  } else {
    console.log(`[hyp-from-aware] 0 new hypotheses queued (all generations failed or filtered)`);
  }

  db.close();
}

main().catch(e => {
  console.error("[hyp-from-aware] FATAL:", e.message);
  process.exit(1);
});
