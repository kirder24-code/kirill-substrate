/**
 * LEARN BOT — Autonomous Self-Improvement Engine
 *
 * Runs daily at 3 AM (after ResearchBot finishes).
 * GPT-5.4 analyzes ALL feedback accumulated in the system and generates
 * updated rules that every other bot reads at runtime.
 *
 * What it learns:
 * 1. Lead scoring rules — what patterns predict rejection vs. success
 * 2. ICP refinement — which platforms/industries/roles convert
 * 3. Outreach style rules — what message patterns get ignored
 * 4. Content style rules — what post angles/hooks Kirill approves
 *
 * Output: bot_intelligence rows with key "learned_rules"
 * Every bot reads these rules BEFORE making any decision.
 */

import {
  getDb, callAI, tgSendToKirill, heartbeat, setIntelligence, getIntelligenceKey,
  logActivity, MODEL_STRONG, MODEL_MINI, sendMessage, reportError, clearError
} from "./orchestrator.mjs";
import { fileURLToPath } from "url";

const BOT_ID = "learn-bot";

// ── Collect all feedback from the system ─────────────────────────────
function collectFeedback(db) {
  const data = {};

  // Lead rejection reasons (from Kirill pressing "Не подходит")
  data.leadRejections = (() => {
    try { return getIntelligenceKey(db, "lead_feedback", "rejections", "reasons") || []; }
    catch { return []; }
  })();

  // Content post rejection reasons
  data.postRejections = (() => {
    try { return getIntelligenceKey(db, "content_feedback", "rejections", "reasons") || []; }
    catch { return []; }
  })();

  // Content post good examples (approved posts)
  data.goodPosts = (() => {
    try { return getIntelligenceKey(db, "content_feedback", "examples", "good") || []; }
    catch { return []; }
  })();

  // Lead stage outcomes — which leads moved forward vs got stuck
  data.leadOutcomes = db.prepare(`
    SELECT source_platform, stage, score, service_match, industry,
           CASE WHEN stage IN ('contacted','qualified','replied','closed') THEN 'progressed'
                WHEN stage IN ('skipped','rejected') THEN 'rejected'
                ELSE 'stalled' END as outcome
    FROM leads
    WHERE created_at >= datetime('now', '-30 days')
    ORDER BY created_at DESC
    LIMIT 100
  `).all();

  // Current learned rules (if any exist — for evolution not reset)
  data.existingRules = (() => {
    try { return getIntelligenceKey(db, BOT_ID, "learned_rules", "lead_scoring") || null; }
    catch { return null; }
  })();

  data.existingOutreachRules = (() => {
    try { return getIntelligenceKey(db, BOT_ID, "learned_rules", "outreach_style") || null; }
    catch { return null; }
  })();

  data.existingContentRules = (() => {
    try { return getIntelligenceKey(db, BOT_ID, "learned_rules", "content_style") || null; }
    catch { return null; }
  })();

  return data;
}

// ── Generate updated lead scoring rules ──────────────────────────────
async function generateLeadScoringRules(feedback) {
  const { leadRejections, leadOutcomes, existingRules } = feedback;

  if (leadRejections.length === 0 && leadOutcomes.length === 0) {
    console.log(`[LearnBot] Not enough lead feedback to learn from yet`);
    return null;
  }

  const rejectionSummary = leadRejections.slice(-20).map(r =>
    `- ${r.reason} (${r.platform || "?"}, score ${r.score || "?"})`
  ).join("\n");

  const outcomeSummary = leadOutcomes.map(l =>
    `${l.outcome}: ${l.source_platform}, score ${l.score}, service ${l.service_match || "?"}, industry: ${l.industry || "?"}`
  ).join("\n");

  const existing = existingRules
    ? `\nCurrent rules (evolve these, don't reset):\n${JSON.stringify(existingRules, null, 2)}`
    : "";

  return callAI(
    `You are the learning engine for Kirill's AI automation business system.
Analyze the feedback and generate SPECIFIC, ACTIONABLE scoring rules.
Return JSON with these exact fields:
{
  "score_threshold_by_platform": { "reddit": 65, "n8n_community": 70, "hackernews": 65, "linkedin": 60, "workingnomads": 70, "remotive": 75 },
  "hard_reject_patterns": ["pattern1", "pattern2"],
  "hard_accept_patterns": ["pattern1", "pattern2"],
  "icp_refinement": "one paragraph describing ideal client based on what's been converting",
  "top_insight": "the single most important pattern discovered",
  "confidence": 0-100
}
Be specific. Use the actual data. If a pattern appears 3+ times in rejections → add to hard_reject_patterns.`,
    `Lead rejection reasons (last 20):\n${rejectionSummary || "none yet"}\n\nLead outcomes (last 30 days):\n${outcomeSummary || "none yet"}${existing}`,
    MODEL_STRONG,
    true
  );
}

// ── Generate updated outreach style rules ─────────────────────────────
async function generateOutreachRules(feedback) {
  const { leadRejections, leadOutcomes, existingOutreachRules } = feedback;

  const rejected = leadRejections.filter(r =>
    r.reason && (r.reason.includes("сообщени") || r.reason.includes("AI") || r.reason.includes("шаблон"))
  );

  const progressed = leadOutcomes.filter(l => l.outcome === "progressed");

  const existing = existingOutreachRules
    ? `\nCurrent rules:\n${JSON.stringify(existingOutreachRules, null, 2)}`
    : "";

  return callAI(
    `You are improving outreach message quality for Kirill's business system.
Return JSON:
{
  "banned_openers": ["phrase1", "phrase2"],
  "banned_phrases": ["phrase1", "phrase2"],
  "required_elements": ["what every message must include"],
  "tone_rules": ["specific tone instructions"],
  "platform_rules": {
    "reddit": "specific rules for Reddit comments",
    "job_posting": "specific rules for job posting replies",
    "linkedin": "specific rules for LinkedIn notes"
  },
  "top_insight": "most important pattern discovered"
}`,
    `Messages that caused rejections or were marked as "looks like AI":\n${rejected.map(r => `- ${r.reason}`).join("\n") || "none yet"}\n\nPlatforms where leads progressed:\n${progressed.map(l => l.source_platform).join(", ") || "none yet"}${existing}`,
    MODEL_STRONG,
    true
  );
}

// ── Generate updated content style rules ──────────────────────────────
async function generateContentRules(feedback) {
  const { postRejections, goodPosts, existingContentRules } = feedback;

  if (postRejections.length === 0 && goodPosts.length === 0) {
    console.log(`[LearnBot] Not enough content feedback yet`);
    return null;
  }

  const rejections = postRejections.slice(-10).map(r =>
    `- Rejected: "${r.reason || r}" (post about: ${r.topic || "?"})`
  ).join("\n");

  const approved = goodPosts.slice(-5).map(p =>
    `- Approved post: "${(p.content || p.text || "").slice(0, 100)}..."`
  ).join("\n");

  const existing = existingContentRules
    ? `\nCurrent rules:\n${JSON.stringify(existingContentRules, null, 2)}`
    : "";

  return callAI(
    `You are improving LinkedIn post quality for Kirill's personal brand system.
Analyze what he approved vs rejected and generate style rules.
Return JSON:
{
  "preferred_hooks": ["hook type 1", "hook type 2"],
  "avoided_angles": ["angle to avoid"],
  "tone": "description of preferred tone",
  "structure_rules": ["rule 1", "rule 2"],
  "topics_to_prioritize": ["topic1", "topic2"],
  "topics_to_avoid": ["topic1"],
  "top_insight": "most important pattern"
}`,
    `Post rejections (with reasons):\n${rejections || "none yet"}\n\nApproved posts:\n${approved || "none yet"}${existing}`,
    MODEL_STRONG,
    true
  );
}

// ── Send learning report to Kirill ────────────────────────────────────
async function sendLearningReport(scoringRules, outreachRules, contentRules) {
  const parts = [`🧠 <b>СИСТЕМА ОБУЧИЛАСЬ</b>\n`];

  if (scoringRules?.top_insight) {
    parts.push(`<b>📊 Лиды:</b> ${scoringRules.top_insight}`);
    if (scoringRules.hard_reject_patterns?.length) {
      parts.push(`Новые фильтры: ${scoringRules.hard_reject_patterns.slice(0, 3).join(", ")}`);
    }
  }

  if (outreachRules?.top_insight) {
    parts.push(`\n<b>✉️ Аутрич:</b> ${outreachRules.top_insight}`);
  }

  if (contentRules?.top_insight) {
    parts.push(`\n<b>📝 Контент:</b> ${contentRules.top_insight}`);
  }

  parts.push(`\n<i>Все боты обновили правила. Следующий скоринг лидов будет точнее.</i>`);

  await tgSendToKirill(parts.join("\n"));
}

// ── Main LearnBot run ─────────────────────────────────────────────────
export async function runLearnBot() {
  const db = getDb();
  heartbeat(db, BOT_ID, "LearnBot", "starting");
  console.log(`[LearnBot] Starting analysis...`);

  const feedback = collectFeedback(db);

  console.log(`[LearnBot] Feedback collected:
  - Lead rejections: ${feedback.leadRejections.length}
  - Post rejections: ${feedback.postRejections.length}
  - Good posts: ${feedback.goodPosts.length}
  - Lead outcomes: ${feedback.leadOutcomes.length}`);

  let scoringRules = null;
  let outreachRules = null;
  let contentRules = null;

  // Generate all rule sets in parallel
  try {
    [scoringRules, outreachRules, contentRules] = await Promise.all([
      generateLeadScoringRules(feedback),
      generateOutreachRules(feedback),
      generateContentRules(feedback)
    ]);
  } catch (err) {
    console.error(`[LearnBot] Rule generation error: ${err.message}`);
  }

  // Save to bot_intelligence — all bots read these at runtime
  if (scoringRules) {
    setIntelligence(db, BOT_ID, "learned_rules", "lead_scoring", scoringRules, 90);
    console.log(`[LearnBot] ✅ Lead scoring rules saved`);
  }

  if (outreachRules) {
    setIntelligence(db, BOT_ID, "learned_rules", "outreach_style", outreachRules, 90);
    console.log(`[LearnBot] ✅ Outreach style rules saved`);
  }

  if (contentRules) {
    setIntelligence(db, BOT_ID, "learned_rules", "content_style", contentRules, 90);
    console.log(`[LearnBot] ✅ Content style rules saved`);
  }

  // Save run timestamp
  setIntelligence(db, BOT_ID, "meta", "last_run", new Date().toISOString(), 100);

  // Notify Kirill if anything changed
  if (scoringRules || outreachRules || contentRules) {
    await sendLearningReport(scoringRules, outreachRules, contentRules);
    await logActivity(db, BOT_ID, `LearnBot обновил правила: scoring=${!!scoringRules}, outreach=${!!outreachRules}, content=${!!contentRules}`);

    // Отправить обновлённые правила в EvolutionBot
    sendMessage(db, {
      fromBot: BOT_ID,
      toBot: "evolution-bot",
      messageType: "learned_rules_update",
      payload: {
        scoringRules: scoringRules || null,
        outreachRules: outreachRules || null,
        contentRules: contentRules || null,
        updatedAt: new Date().toISOString()
      },
      priority: 8
    });
  } else {
    console.log(`[LearnBot] No rules generated — not enough feedback yet`);
  }

  const rulesGenerated = !!(scoringRules || outreachRules || contentRules);
  heartbeat(db, BOT_ID, "LearnBot", "complete", {}, {
    status: rulesGenerated ? "ok" : "degraded",
    last_success_at: rulesGenerated ? new Date().toISOString() : null,
    error: null
  });
  try { clearError(db, BOT_ID); } catch {}
  db.close();
  console.log(`[LearnBot] Done.`);
}

// ── LIVE MODE (24/7 процесс) ──────────────────────────────────────────────────
async function liveMode() {
  console.log(`[LearnBot] Starting in LIVE mode (runs every day at 3 AM)...`);

  while (true) {
    try {
      const now = new Date();
      const hour = now.getHours();

      // Run every 8 hours
      if (hour === 3 || hour === 11 || hour === 19) {
        console.log(`[LearnBot] Running learning cycle...`);
        await runLearnBot();
        await new Promise(r => setTimeout(r, 7 * 60 * 60 * 1000));
      } else {
        // Проверять каждый час
        await new Promise(r => setTimeout(r, 60 * 60 * 1000));
      }
    } catch (err) {
      console.error(`[LearnBot] Error in live mode:`, err.message);
      try { const edb = getDb(); heartbeat(edb, BOT_ID, "LearnBot", "error", {}, { status: "error", last_success_at: null, error: err.message }); reportError(edb, BOT_ID, "LearnBot", err.message, "crash", "liveMode"); edb.close(); } catch {}
      await new Promise(r => setTimeout(r, 60 * 60 * 1000)); // retry in 1 hour
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const isLive = process.argv.includes("live");
  if (isLive) {
    liveMode().catch(err => {
      console.error(`[LearnBot] Fatal error:`, err);
      process.exit(1);
    });
  } else {
    runLearnBot().catch(console.error);
  }
}
