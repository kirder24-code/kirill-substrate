/**
 * CONVERSATION TRACKER
 *
 * Tracks every interaction from first comment to client close.
 * Provides full conversation context for AI follow-up generation
 * so responses are strategic, not generic.
 *
 * Used by: reddit-monitor, hypothesis-executor, monitor-replies
 *
 * Usage:
 *   import { recordFirstContact, recordReply, recordEmailReply,
 *            getConversationContext, generateNextAction, getActiveConversations
 *          } from "./conversation-tracker.mjs";
 */

import Database from "better-sqlite3";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import { callAI, MODEL_STRONG } from "./orchestrator.mjs";
import { readPurpose } from "../../wiki/reader.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, "../../.data/linkedin-brand-os.sqlite");

// ── Schema ───────────────────────────────────────────────────────────
function ensureTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      prospect_name TEXT,
      platform TEXT,
      channel TEXT,
      first_contact_at TEXT,
      last_interaction_at TEXT,
      stage TEXT CHECK(stage IN (
        'first_contact','replied','engaged','qualifying',
        'proposing','closing','won','lost','dormant'
      )) DEFAULT 'first_contact',
      prospect_pain TEXT,
      prospect_context TEXT,
      our_offer TEXT,
      conversation_history TEXT DEFAULT '[]',
      next_action TEXT,
      next_action_reason TEXT,
      hypothesis_id TEXT,
      created_at TEXT,
      updated_at TEXT
    )
  `);
  // Index for lookups by prospect + platform
  db.exec(`CREATE INDEX IF NOT EXISTS idx_conv_prospect_platform ON conversations(prospect_name, platform)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_conv_stage ON conversations(stage)`);
}

function getDb() {
  const db = new Database(DB_PATH);
  ensureTable(db);
  return db;
}

// ── Helpers ──────────────────────────────────────────────────────────

function parseHistory(raw) {
  try { return JSON.parse(raw || "[]"); } catch { return []; }
}

function findConversation(db, prospectName, platform, channel) {
  // Try exact match first
  let row = db.prepare(
    `SELECT * FROM conversations WHERE prospect_name = ? AND platform = ? AND channel = ? ORDER BY last_interaction_at DESC LIMIT 1`
  ).get(prospectName, platform, channel);
  if (row) return row;

  // Fallback: same prospect + platform, any channel
  row = db.prepare(
    `SELECT * FROM conversations WHERE prospect_name = ? AND platform = ? ORDER BY last_interaction_at DESC LIMIT 1`
  ).get(prospectName, platform);
  return row || null;
}

function advanceStage(currentStage, messageCount) {
  // Auto-advance based on interaction count
  if (currentStage === "first_contact" && messageCount >= 2) return "replied";
  if (currentStage === "replied" && messageCount >= 4) return "engaged";
  return currentStage;
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Called by hypothesis-executor when a comment is posted.
 * Starts tracking a new conversation.
 */
export function recordFirstContact(prospect, platform, channel, commentText, prospectPain, postUrl) {
  const db = getDb();
  try {
    const existing = findConversation(db, prospect, platform, channel);
    if (existing) {
      // Already tracking - add to history
      const history = parseHistory(existing.conversation_history);
      history.push({
        who: "kirill",
        text: commentText?.slice(0, 2000) || "",
        timestamp: new Date().toISOString(),
        platform,
        url: postUrl || null,
      });
      db.prepare(`
        UPDATE conversations
        SET conversation_history = ?, last_interaction_at = ?, updated_at = ?,
            prospect_pain = COALESCE(?, prospect_pain)
        WHERE id = ?
      `).run(JSON.stringify(history), new Date().toISOString(), new Date().toISOString(), prospectPain || null, existing.id);
      return existing.id;
    }

    const id = `conv-${randomUUID().slice(0, 12)}`;
    const now = new Date().toISOString();
    const history = [{
      who: "kirill",
      text: commentText?.slice(0, 2000) || "",
      timestamp: now,
      platform,
      url: postUrl || null,
    }];

    db.prepare(`
      INSERT INTO conversations (id, prospect_name, platform, channel, first_contact_at, last_interaction_at,
        stage, prospect_pain, conversation_history, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'first_contact', ?, ?, ?, ?)
    `).run(id, prospect, platform, channel, now, now, prospectPain || null, JSON.stringify(history), now, now);

    return id;
  } finally {
    db.close();
  }
}

/**
 * Called by reddit-monitor when a reply comes in.
 * Records the reply and returns the conversation context.
 */
export function recordReply(prospect, platform, channel, replyText, originalComment) {
  const db = getDb();
  try {
    let conv = findConversation(db, prospect, platform, channel);
    const now = new Date().toISOString();

    if (!conv) {
      // First time seeing this prospect - create conversation with original comment as context
      const id = `conv-${randomUUID().slice(0, 12)}`;
      const history = [];
      if (originalComment) {
        history.push({
          who: "kirill",
          text: originalComment?.slice(0, 2000) || "",
          timestamp: now,
          platform,
        });
      }
      history.push({
        who: "prospect",
        text: replyText?.slice(0, 2000) || "",
        timestamp: now,
        platform,
      });

      db.prepare(`
        INSERT INTO conversations (id, prospect_name, platform, channel, first_contact_at, last_interaction_at,
          stage, conversation_history, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'replied', ?, ?, ?)
      `).run(id, prospect, platform, channel, now, now, JSON.stringify(history), now, now);

      return { id, history, stage: "replied", isNew: true };
    }

    // Existing conversation - append reply
    const history = parseHistory(conv.conversation_history);
    history.push({
      who: "prospect",
      text: replyText?.slice(0, 2000) || "",
      timestamp: now,
      platform,
    });

    const newStage = advanceStage(conv.stage, history.length);

    db.prepare(`
      UPDATE conversations
      SET conversation_history = ?, last_interaction_at = ?, stage = ?, updated_at = ?
      WHERE id = ?
    `).run(JSON.stringify(history), now, newStage, now, conv.id);

    return {
      id: conv.id,
      history,
      stage: newStage,
      prospect_pain: conv.prospect_pain,
      prospect_context: conv.prospect_context,
      our_offer: conv.our_offer,
      isNew: false,
    };
  } finally {
    db.close();
  }
}

/**
 * Called by monitor-replies for email replies.
 */
export function recordEmailReply(prospect, replyText, originalEmail) {
  const db = getDb();
  try {
    const channel = "kirill@launchsoloai.com";
    let conv = findConversation(db, prospect, "email", channel);
    const now = new Date().toISOString();

    if (!conv) {
      const id = `conv-${randomUUID().slice(0, 12)}`;
      const history = [];
      if (originalEmail) {
        history.push({
          who: "kirill",
          text: originalEmail?.slice(0, 2000) || "",
          timestamp: now,
          platform: "email",
        });
      }
      history.push({
        who: "prospect",
        text: replyText?.slice(0, 2000) || "",
        timestamp: now,
        platform: "email",
      });

      db.prepare(`
        INSERT INTO conversations (id, prospect_name, platform, channel, first_contact_at, last_interaction_at,
          stage, conversation_history, created_at, updated_at)
        VALUES (?, ?, 'email', ?, ?, ?, 'replied', ?, ?, ?)
      `).run(id, prospect, channel, now, now, JSON.stringify(history), now, now);

      return id;
    }

    const history = parseHistory(conv.conversation_history);
    history.push({
      who: "prospect",
      text: replyText?.slice(0, 2000) || "",
      timestamp: now,
      platform: "email",
    });

    const newStage = advanceStage(conv.stage, history.length);

    db.prepare(`
      UPDATE conversations
      SET conversation_history = ?, last_interaction_at = ?, stage = ?, updated_at = ?
      WHERE id = ?
    `).run(JSON.stringify(history), now, newStage, now, conv.id);

    return conv.id;
  } finally {
    db.close();
  }
}

/**
 * Get full conversation context for AI follow-up generation.
 */
export function getConversationContext(prospectName, platform) {
  const db = getDb();
  try {
    const conv = db.prepare(
      `SELECT * FROM conversations WHERE prospect_name = ? AND platform = ? ORDER BY last_interaction_at DESC LIMIT 1`
    ).get(prospectName, platform);

    if (!conv) return null;

    return {
      id: conv.id,
      prospect_name: conv.prospect_name,
      platform: conv.platform,
      channel: conv.channel,
      stage: conv.stage,
      prospect_pain: conv.prospect_pain,
      prospect_context: conv.prospect_context,
      our_offer: conv.our_offer,
      history: parseHistory(conv.conversation_history),
      next_action: conv.next_action,
      next_action_reason: conv.next_action_reason,
      first_contact_at: conv.first_contact_at,
      last_interaction_at: conv.last_interaction_at,
      messageCount: parseHistory(conv.conversation_history).length,
    };
  } finally {
    db.close();
  }
}

/**
 * Generate strategic next action using AI.
 * Reads full conversation history + PURPOSE.md to craft the right move.
 */
export async function generateNextAction(conversationId) {
  const db = getDb();
  try {
    const conv = db.prepare(`SELECT * FROM conversations WHERE id = ?`).get(conversationId);
    if (!conv) return null;

    const history = parseHistory(conv.conversation_history);
    if (!history.length) return null;

    const purpose = readPurpose();

    const historyFormatted = history.map(m =>
      `[${m.timestamp}] ${m.who === "kirill" ? "KIRILL" : "PROSPECT"}: ${m.text}`
    ).join("\n\n");

    const systemPrompt = `You are a sales strategist helping Kirill D. - AI automation consultant in Calgary.
Analyze this conversation and decide the ONE best next message.

RULES (non-negotiable):
- Comment-first approach: no pitch in first 2 interactions
- Qualify pain before proposing anything
- Use "I" not "we" - Kirill is a solo consultant
- Be human: contractions, casual tone, specific examples
- No bullet points in DMs - plain conversational text
- No em dashes - use hyphens only
- Never invent URLs or links
- If prospect is skeptical: acknowledge it, lead with concrete before/after example
- is_lead detection: ONLY true if prospect has a SPECIFIC business problem needing PAID help

CURRENT OFFERS (from PURPOSE.md):
${purpose?.slice(0, 1500) || "AI automation consulting - workflow audits, custom AI tools, process automation"}

Output ONLY valid JSON:
{
  "next_message": "the exact message to send",
  "reason": "why this is the right move now",
  "new_stage": "one of: first_contact, replied, engaged, qualifying, proposing, closing",
  "is_ready_for_proposal": false,
  "detected_pain": "what pain the prospect expressed (or null)",
  "detected_context": "what we know about prospect's business (or null)"
}`;

    const userPrompt = `PROSPECT: ${conv.prospect_name}
PLATFORM: ${conv.platform}
CHANNEL: ${conv.channel}
CURRENT STAGE: ${conv.stage}
KNOWN PAIN: ${conv.prospect_pain || "unknown"}
KNOWN CONTEXT: ${conv.prospect_context || "unknown"}
OUR OFFER: ${conv.our_offer || "not yet determined"}
MESSAGE COUNT: ${history.length}

FULL CONVERSATION HISTORY:
${historyFormatted}`;

    const result = await callAI(systemPrompt, userPrompt, MODEL_STRONG, true);

    if (!result) return null;

    // Update conversation record with AI-generated next action
    const now = new Date().toISOString();
    const updates = {
      next_action: result.next_message || null,
      next_action_reason: result.reason || null,
    };

    // Update stage if AI suggests advancement
    if (result.new_stage && result.new_stage !== conv.stage) {
      updates.stage = result.new_stage;
    }

    // Update pain/context if AI detected new info
    if (result.detected_pain && !conv.prospect_pain) {
      updates.prospect_pain = result.detected_pain;
    }
    if (result.detected_context && !conv.prospect_context) {
      updates.prospect_context = result.detected_context;
    }

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(", ");
    const values = Object.values(updates);

    db.prepare(`UPDATE conversations SET ${setClauses}, updated_at = ? WHERE id = ?`)
      .run(...values, now, conversationId);

    return {
      ...result,
      conversationId,
      stage: updates.stage || conv.stage,
      prospect_pain: updates.prospect_pain || conv.prospect_pain,
    };
  } finally {
    db.close();
  }
}

/**
 * Get all active conversations (not won/lost/dormant).
 */
export function getActiveConversations() {
  const db = getDb();
  try {
    const rows = db.prepare(
      `SELECT * FROM conversations WHERE stage NOT IN ('won', 'lost', 'dormant') ORDER BY last_interaction_at DESC`
    ).all();
    return rows.map(r => ({
      ...r,
      history: parseHistory(r.conversation_history),
    }));
  } finally {
    db.close();
  }
}

/**
 * Link a conversation to a hypothesis test.
 */
export function linkHypothesis(conversationId, hypothesisId) {
  const db = getDb();
  try {
    db.prepare(`UPDATE conversations SET hypothesis_id = ?, updated_at = ? WHERE id = ?`)
      .run(hypothesisId, new Date().toISOString(), conversationId);
  } finally {
    db.close();
  }
}

// ── CLI test mode ────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2];
  if (cmd === "active") {
    const convs = getActiveConversations();
    console.log(`Active conversations: ${convs.length}`);
    for (const c of convs) {
      console.log(`  ${c.prospect_name} [${c.platform}] stage=${c.stage} msgs=${c.history.length} last=${c.last_interaction_at}`);
    }
  } else if (cmd === "init") {
    const db = getDb();
    console.log("conversations table ensured.");
    db.close();
  } else {
    console.log("Usage: node conversation-tracker.mjs [active|init]");
  }
}
