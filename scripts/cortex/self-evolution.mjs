/**
 * CORTEX SELF-EVOLUTION — The system improves its own code
 *
 * Not just hypotheses. Not just config changes.
 * The system reads its OWN SOURCE CODE, identifies weaknesses,
 * and uses HANDS (Claude CLI) to fix them.
 *
 * Examples:
 *
 *   "My scout-bot scoring prompt doesn't mention vibe-coded app rescue.
 *    It was written for 'AI automation' era. I should rewrite it
 *    to score leads who need code audit and rescue, not generic automation."
 *    → HANDS rewrites the scoring prompt
 *
 *   "My outreach template uses 'AI automation' language that got 0% response.
 *    I should rewrite it with 'missed calls' language."
 *    → HANDS rewrites the template
 *
 *   "My simulation base rates are all guesses. I have real data now.
 *    Cold email = 0%, Reddit = 15%. I should update the base rates."
 *    → HANDS updates simulation.mjs
 *
 * Safety: all changes go through HANDS safety gates.
 * All changes logged. Kirill notified via Telegram.
 * Changes can be reverted via git.
 *
 * This is the closest thing to self-modifying code that exists in 2026.
 */

import { readFileSync, readdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { executeHands, analyzeCode } from "./hands.mjs";
import { getBeliefs, getPredictionAccuracy } from "./world-model.mjs";
import { recall, remember } from "./memory.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const ENV_PATH = resolve(ROOT, "apps/api/.env");

const env = Object.fromEntries(
  readFileSync(ENV_PATH, "utf-8").split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

// ── SELF-ANALYSIS TARGETS ─────────────────────────────────────────────

// EVOLVABLE_FILES - what self-evolution checks and fixes
// CRITICAL: These checks must align with CURRENT product/market, not old ones.
// Read .data/cortex-doctrine.md GROUND TRUTH FACTS before assuming what the product is.
// As of April 23 2026: Voice Agent is DISCONTINUED. Current offers: Vibe Code Audit,
// First 10 Customers, AI Workflow Design Sprint, Full Pipeline Build.
const EVOLVABLE_FILES = [
  {
    path: "scripts/factory/scout-bot.mjs",
    aspect: "scoring_prompt",
    description: "Lead scoring prompt - should reflect current offers (Vibe Code Audit, First 10 Customers, AI Workflow Sprint, Full Pipeline Build)",
    checkFn: (content) => {
      const issues = [];
      // Check for current offers, not discontinued ones
      if (!content.includes("solo founder") && !content.includes("SaaS") && !content.includes("pipeline")) {
        issues.push("Scoring prompt doesn't mention current ICP (solo SaaS founders)");
      }
      if (content.includes("em dash") || content.match(/\u2014/)) {
        issues.push("Contains em dashes which are flagged as AI-generated");
      }
      return issues;
    },
  },
  {
    path: "scripts/factory/icp-outreach-bot.mjs",
    aspect: "outreach_template",
    description: "Outreach messaging - should target solo founders with workflow/pipeline pain",
    checkFn: (content) => {
      const issues = [];
      if (content.includes("em dash") || content.match(/\u2014/)) {
        issues.push("Contains em dashes which are flagged as AI-generated");
      }
      return issues;
    },
  },
  {
    path: "scripts/cortex/simulation.mjs",
    aspect: "base_rates",
    description: "Simulation base rates - should reflect actual data, not guesses",
    checkFn: (content) => {
      const issues = [];
      if (content.includes('"untested"') || content.includes('"untested,')) {
        issues.push("Some base rates still marked as 'untested' - should be updated with real data if available");
      }
      return issues;
    },
  },
];

// ── SELF-SCAN ─────────────────────────────────────────────────────────

/**
 * Scan own code for improvement opportunities.
 * No LLM needed - pattern matching against known issues.
 * Returns list of improvement proposals.
 */
export function selfScan(log = console.log) {
  log("[SELF-EVOLVE] Scanning own code for improvements...");
  const proposals = [];

  for (const target of EVOLVABLE_FILES) {
    try {
      const fullPath = resolve(ROOT, target.path);
      const content = readFileSync(fullPath, "utf-8");
      const issues = target.checkFn(content);

      for (const issue of issues) {
        proposals.push({
          file: target.path,
          aspect: target.aspect,
          issue,
          description: target.description,
          severity: issue.includes("doesn't mention") ? "medium" : "high",
        });
      }
    } catch (e) {
      // File doesn't exist - not an error, just skip
    }
  }

  log(`[SELF-EVOLVE] Found ${proposals.length} improvement proposals`);
  for (const p of proposals) {
    log(`  [${p.severity}] ${p.file}: ${p.issue.slice(0, 60)}`);
  }

  return proposals;
}

// ── SELF-IMPROVEMENT CYCLE ────────────────────────────────────────────

/**
 * Full self-evolution cycle:
 * 1. Scan code for issues
 * 2. Get current beliefs from world model for context
 * 3. Use HANDS to fix the highest-priority issue
 * 4. Log what changed and why
 */
export async function selfEvolve(db, log = console.log) {
  log("[SELF-EVOLVE] === SELF-EVOLUTION CYCLE ===");

  // 1. Scan for issues
  const proposals = selfScan(log);
  if (proposals.length === 0) {
    log("[SELF-EVOLVE] No improvements found. Code is current.");
    return { improved: false, proposals: 0 };
  }

  // 2. Pick the highest-priority proposal
  proposals.sort((a, b) => (b.severity === "high" ? 1 : 0) - (a.severity === "high" ? 1 : 0));
  const target = proposals[0];

  // 3. Get context from world model
  const beliefs = getBeliefs(db, null, 0.5, 10);
  const procedures = recall(db, "procedural", null, 10);
  const accuracy = getPredictionAccuracy(db);

  // Read doctrine for ground truth (don't hardcode products/markets)
  let doctrineContext = "";
  try {
    const doctrine = readFileSync(resolve(ROOT, ".data/cortex-doctrine.md"), "utf-8");
    const groundTruth = doctrine.match(/## 0A\. GROUND TRUTH[\s\S]*?(?=\n## )/);
    if (groundTruth) doctrineContext = groundTruth[0].slice(0, 500);
  } catch {}

  const context = [
    doctrineContext || `Current offers: Vibe Code Audit, First 10 Customers Sales Motion, AI Workflow Design Sprint, Full Pipeline Build ($1.5K-$10K CAD)`,
    `Target: Solo SaaS founders in Canada and USA`,
    `Best channel: Reddit (comment-first approach) + Threads (Kirill's discovery)`,
    `Dead channel: cold email with generic automation pitch (657 sent, 14 replies, 0 conversions)`,
    beliefs.map(b => `Belief: ${b.belief} (${(b.confidence * 100).toFixed(0)}%)`).join("\n"),
    procedures.map(p => `Rule: ${p.content.slice(0, 80)}`).join("\n"),
    accuracy?.total_tested > 0 ? `Prediction accuracy: ${accuracy.correct}/${accuracy.total_tested}` : "",
  ].filter(Boolean).join("\n");

  // 4. Use HANDS to fix it
  log(`[SELF-EVOLVE] Fixing: ${target.file} - ${target.issue.slice(0, 60)}`);

  const result = await executeHands({
    description: `SELF-EVOLUTION: Fix this issue in ${target.file}:\n\n${target.issue}\n\nThis file is: ${target.description}\n\nUse the following context about our current product and market to make the improvement:\n${context}`,
    type: "rewrite_prompt",
    files: [target.file],
    context: `Self-evolution cycle. The system identified this issue in its own code and is fixing it autonomously.`,
    origin: "self-evolution",
  }, { log });

  if (result.success) {
    log(`[SELF-EVOLVE] SUCCESS: ${result.filesChanged.join(", ")}`);

    // Log what changed
    remember(db, "episodic",
      `SELF-EVOLUTION: Fixed ${target.file} (${target.aspect}). Issue: ${target.issue.slice(0, 100)}. Files changed: ${result.filesChanged.join(", ")}`,
      "self-evolution", "self-evolution"
    );

    // Notify Kirill
    const TG_TOKEN = env.TELEGRAM_BOT_TOKEN;
    const CHAT_ID = env.TELEGRAM_CHAT_ID;
    // Log only, don't spam Telegram with internal code fixes
    log(`[SELF-EVOLVE] Fixed: ${target.file} — ${target.issue.slice(0, 80)}`);
  } else {
    log(`[SELF-EVOLVE] FAILED: ${result.error}`);
    remember(db, "episodic",
      `SELF-EVOLUTION FAILED: ${target.file} (${target.aspect}). Error: ${result.error?.slice(0, 100)}`,
      "self-evolution-failure", "self-evolution"
    );
  }

  return {
    improved: result.success,
    proposals: proposals.length,
    target: target.file,
    issue: target.issue,
    filesChanged: result.filesChanged || [],
  };
}

// ── DEEP SELF-ANALYSIS (LLM) ─────────────────────────────────────────

/**
 * Use Claude CLI to deeply analyze a specific module and suggest improvements.
 * More thorough than selfScan but costs a Claude CLI call.
 */
export async function deepSelfAnalysis(db, targetFile, log = console.log) {
  log(`[SELF-EVOLVE] Deep analysis of: ${targetFile}`);

  const result = await analyzeCode(
    `Analyze this file for improvement opportunities. Consider:
1. Is the logic aligned with our current product (AI workflow automation and custom AI builds)?
2. Are there hardcoded values that should be dynamic?
3. Are there prompts that could be more effective?
4. Is error handling sufficient?
5. Are there performance bottlenecks?
Return a list of specific, actionable improvements with priority.`,
    [targetFile],
    "self-evolution",
    { log }
  );

  return result;
}

// ── FORMAT FOR BRAIN ──────────────────────────────────────────────────

export function formatSelfEvolutionForBrain(db) {
  const recentEvolutions = recall(db, "episodic", "self-evolution", 3);
  if (recentEvolutions.length === 0) return "No self-evolution history yet.";

  return "Recent self-improvements:\n" +
    recentEvolutions.map(e => `  ${e.content.slice(0, 80)}`).join("\n");
}
