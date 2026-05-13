/**
 * One-shot: draft a qualifying comment for the live real estate AI buyer post
 * on r/AI_Agents, log the lead, send draft to Kirill for approval.
 *
 * Post: https://reddit.com/r/AI_Agents/comments/1stevxo
 * Usage: node scripts/factory/reddit-real-estate-ai-comment.mjs
 */

import { randomUUID } from "crypto";
import { getDb, callAI, tgSendToKirill, MODEL_DEFAULT } from "./orchestrator.mjs";

const POST_URL = "https://reddit.com/r/AI_Agents/comments/1stevxo";
const POST_TITLE = "Real estate AI workflows - what's your biggest bottleneck?";
const POST_AUTHOR = "reddit_AI_Agents_user";
const SOURCE = "reddit_comments";

async function run() {
  const db = getDb();

  // ── 1. Draft qualifying comment ──────────────────────────────────────
  const draft = await callAI(
    `You are drafting a qualifying Reddit comment for Kirill D., AI automation consultant in Calgary.
The comment will go on a post about real estate AI workflows on r/AI_Agents.

GOAL: Start a conversation. Ask ONE specific question about their biggest workflow bottleneck.
This is NOT a pitch. It is NOT a sales message. It is a genuine question from a practitioner.

RULES:
- 1-3 sentences max.
- Sound like a practitioner who has worked in real estate AI, not a vendor.
- End with exactly one question about their specific bottleneck.
- Use short hyphens only (-), never em dashes or en dashes.
- No "I can help", "I specialize", "streamline", "leverage", "let me know".
- No URLs, no links, no self-promotion.
- No bullet lists. Plain prose.
- No greeting opener like "Hey" or "Hi there".

Return JSON: { "comment": "the comment text here" }`,
    `Post context: A user on r/AI_Agents is discussing real estate AI agent workflows and asking about pain points or bottlenecks in their automation setup.`,
    MODEL_DEFAULT,
    true
  );

  if (!draft || typeof draft !== "object" || !draft.comment || draft.comment.trim().length < 20) {
    console.error("[reddit-real-estate-ai] Draft generation failed or too short:", draft);
    process.exit(1);
  }

  const cleanDraft = draft.comment.trim();

  // ── 2. Quality gate ──────────────────────────────────────────────────
  const banned = [
    "i can help", "i specialize", "streamline", "leverage", "let me know",
    "feel free", "don't hesitate", "reach out", "i'd love to", "game-changer",
    "seamlessly", "as an ai", "hi there", "hello!"
  ];
  const lower = cleanDraft.toLowerCase();
  const hit = banned.find(p => lower.includes(p));
  if (hit) {
    console.error(`[reddit-real-estate-ai] Draft failed quality gate: banned phrase "${hit}"`);
    process.exit(1);
  }
  if (/\u2014/.test(cleanDraft)) {
    console.error("[reddit-real-estate-ai] Draft contains em dash - rejected");
    process.exit(1);
  }

  // ── 3. Log lead in DB ────────────────────────────────────────────────
  const existing = db.prepare("SELECT id FROM leads WHERE source_url = ?").get(POST_URL);
  let leadId = existing?.id;

  if (!leadId) {
    leadId = randomUUID();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO leads (id, name, source, source_platform, source_url,
        pain_description, service_match, score, stage, first_signal_at, created_at, updated_at)
      VALUES (?, ?, ?, 'reddit', ?, ?, 'ai_automation', 80, 'contacted', ?, ?, ?)
    `).run(
      leadId,
      POST_AUTHOR,
      SOURCE,
      POST_URL,
      "Real estate AI workflow automation - active buyer signal on r/AI_Agents",
      now, now, now
    );
    console.log(`[reddit-real-estate-ai] Lead logged: ${leadId}`);
  } else {
    db.prepare("UPDATE leads SET stage='contacted', updated_at=datetime('now') WHERE id=?").run(leadId);
    console.log(`[reddit-real-estate-ai] Existing lead updated to contacted: ${leadId}`);
  }

  // ── 4. Send draft to Kirill for approval ─────────────────────────────
  const msg =
    `🎯 <b>Reddit comment draft - real estate AI buyer</b>\n` +
    `Post: ${POST_URL}\n\n` +
    `<b>Draft (for your approval - do NOT post automatically):</b>\n\n` +
    `<i>${cleanDraft}</i>\n\n` +
    `If approved, post this manually as a comment on the thread.`;

  await tgSendToKirill(msg);
  console.log("[reddit-real-estate-ai] Draft sent to Kirill via Telegram.");
}

run().catch(err => {
  console.error("[reddit-real-estate-ai] Fatal:", err.message);
  process.exit(1);
});
