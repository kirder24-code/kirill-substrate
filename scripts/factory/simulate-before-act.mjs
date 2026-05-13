/**
 * simulate-before-act.mjs — World Model lite
 *
 * Before any outbound action (email, Reddit comment, Threads post),
 * simulate the outcome. Pick the action with the best predicted result.
 *
 * Usage:
 *   import { simulate } from "./simulate-before-act.mjs";
 *
 *   const result = await simulate({
 *     action: "send_email",
 *     target: { name: "Bold Property Management", pain: "cross-location reporting" },
 *     variants: [
 *       { subject: "Variant A", body: "..." },
 *       { subject: "Variant B", body: "..." },
 *     ],
 *     context: { channel_history: "194 sent, 1 meaningful reply", offer: "$2,500 CAD" },
 *   });
 *
 *   // result = {
 *   //   best_variant: 0,
 *   //   predictions: [
 *   //     { variant: 0, predicted_outcome: "reply_with_interest", confidence: 0.35, reasoning: "..." },
 *   //     { variant: 1, predicted_outcome: "ignore", confidence: 0.70, reasoning: "..." },
 *   //   ],
 *   //   recommendation: "Send variant A - higher chance of reply because...",
 *   //   should_act: true,  // false if ALL variants predict failure
 *   //   alternative: null,  // if should_act=false, suggests different approach
 *   // }
 */

import { callAI, MODEL_STRONG, MODEL_MINI } from "./orchestrator.mjs";
import { readPurpose } from "../../wiki/reader.mjs";
import Database from "better-sqlite3";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, "../../.data/linkedin-brand-os.sqlite");

/**
 * Load past outcomes for this action type to ground predictions
 */
function loadHistoricalOutcomes(actionType) {
  try {
    const db = new Database(DB_PATH, { readonly: true });
    let history = "";

    if (actionType === "send_email") {
      const stats = db.prepare(`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN is_meaningful_reply=1 THEN 1 ELSE 0 END) as meaningful,
          SUM(CASE WHEN reply_body LIKE '%remove%' OR reply_body LIKE '%unsubscribe%' THEN 1 ELSE 0 END) as unsubscribes,
          SUM(CASE WHEN reply_body LIKE '%AUTO-REPLY%' OR reply_body LIKE '%auto-reply%' THEN 1 ELSE 0 END) as autoreplies
        FROM outreach_emails WHERE status='sent'
      `).get();
      history = `Email history: ${stats.total} sent, ${stats.meaningful} meaningful replies, ${stats.unsubscribes} unsubscribes, ${stats.autoreplies} auto-replies. Reply rate: ${stats.total > 0 ? ((stats.meaningful / stats.total) * 100).toFixed(1) : 0}%`;
    }

    if (actionType === "reddit_comment") {
      const convos = db.prepare(`SELECT COUNT(*) as c FROM conversations WHERE platform='reddit'`).get()?.c || 0;
      const replied = db.prepare(`SELECT COUNT(*) as c FROM conversations WHERE platform='reddit' AND stage != 'first_contact'`).get()?.c || 0;
      history = `Reddit history: ${convos} comments posted, ${replied} got replies. Reply rate: ${convos > 0 ? ((replied / convos) * 100).toFixed(1) : 0}%`;
    }

    db.close();
    return history;
  } catch { return "No historical data available."; }
}

/**
 * Simulate outcomes for action variants
 */
export async function simulate({ action, target, variants, context = {} }) {
  const purpose = readPurpose().slice(0, 300);
  const history = loadHistoricalOutcomes(action);

  const variantDescriptions = variants.map((v, i) => {
    if (action === "send_email") return `Variant ${i}: Subject: "${v.subject}" Body: "${(v.body || "").slice(0, 300)}"`;
    if (action === "reddit_comment") return `Variant ${i}: "${(v.text || v.comment || "").slice(0, 300)}"`;
    if (action === "threads_post") return `Variant ${i}: "${(v.text || "").slice(0, 300)}"`;
    return `Variant ${i}: ${JSON.stringify(v).slice(0, 300)}`;
  }).join("\n\n");

  const prompt = `You are a WORLD MODEL - you predict outcomes BEFORE actions happen.

SYSTEM: ${purpose}

ACTION TYPE: ${action}
TARGET: ${JSON.stringify(target).slice(0, 500)}

HISTORICAL OUTCOMES (ground truth - use this to calibrate predictions):
${history}

ADDITIONAL CONTEXT: ${JSON.stringify(context).slice(0, 500)}

VARIANTS TO SIMULATE:
${variantDescriptions}

For EACH variant, predict:
1. Most likely outcome: reply_with_interest | reply_with_objection | polite_no | ignore | unsubscribe | auto_reply
2. Confidence (0.0-1.0) - calibrate against historical rates above
3. Why this outcome - specific reasoning based on the target's situation
4. If reply_with_interest or reply_with_objection: what will they likely say?

Then decide:
- best_variant: which index (0-based) has the highest chance of positive outcome?
- should_act: should we send ANY variant, or is this target unlikely to respond regardless?
- if should_act is false: what alternative approach would work better?

IMPORTANT: Be PESSIMISTIC. History shows ${history}. Don't predict 80% reply rate when real rate is 0.5%.

Return JSON:
{
  "predictions": [
    {"variant": 0, "predicted_outcome": "...", "confidence": 0.0, "reasoning": "...", "predicted_reply": "..."},
    ...
  ],
  "best_variant": 0,
  "should_act": true,
  "recommendation": "...",
  "alternative": null
}`;

  try {
    const result = await callAI(
      prompt,
      `Simulate outcomes for ${action} to ${target.name || "prospect"}`,
      MODEL_MINI, // Fast + cheap for simulation
      true
    );

    if (!result || !result.predictions) {
      return { best_variant: 0, predictions: [], should_act: true, recommendation: "Simulation failed - proceed with first variant", alternative: null };
    }

    // Log simulation to DB for learning
    try {
      const db = new Database(DB_PATH);
      db.prepare(`
        CREATE TABLE IF NOT EXISTS simulations (
          id TEXT PRIMARY KEY,
          action_type TEXT,
          target_name TEXT,
          variants_count INTEGER,
          best_variant INTEGER,
          should_act INTEGER,
          predicted_outcome TEXT,
          confidence REAL,
          actual_outcome TEXT,
          created_at TEXT
        )
      `).run();
      db.prepare(`
        INSERT INTO simulations (id, action_type, target_name, variants_count, best_variant, should_act, predicted_outcome, confidence, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(
        Math.random().toString(36).slice(2, 14),
        action,
        (target.name || "unknown").slice(0, 100),
        variants.length,
        result.best_variant || 0,
        result.should_act ? 1 : 0,
        result.predictions?.[result.best_variant || 0]?.predicted_outcome || "unknown",
        result.predictions?.[result.best_variant || 0]?.confidence || 0,
      );
      db.close();
    } catch {}

    return result;
  } catch (e) {
    return { best_variant: 0, predictions: [], should_act: true, recommendation: `Simulation error: ${e.message}`, alternative: null };
  }
}

/**
 * Quick check: should we even try this action?
 * Returns true/false with reasoning
 */
export async function shouldAct(action, target, draftText) {
  const result = await simulate({
    action,
    target,
    variants: [{ text: draftText, body: draftText, comment: draftText, subject: "outreach" }],
  });
  return {
    proceed: result.should_act,
    confidence: result.predictions?.[0]?.confidence || 0,
    reasoning: result.recommendation || "No simulation data",
    predicted_outcome: result.predictions?.[0]?.predicted_outcome || "unknown",
  };
}

/**
 * After action completed - record actual outcome for learning
 */
export function recordOutcome(simulationId, actualOutcome) {
  try {
    const db = new Database(DB_PATH);
    db.prepare("UPDATE simulations SET actual_outcome = ? WHERE id = ?").run(actualOutcome, simulationId);
    db.close();
  } catch {}
}
