/**
 * scripts/survival/outbound-approval.mjs
 *
 * Bridges substrate's drafts to actual outbound action. Substrate cannot
 * send anything to the world without explicit Kirill approval. This module:
 *
 *   propose_outbound_send action
 *     - Picks a draft from .data/survival-drafts/ (oldest pending first)
 *     - Sends Telegram message to Kirill with the full draft + approval
 *       command (/approve_outbound_<id> or /deny_outbound_<id>)
 *     - Writes pending entry to .data/survival-outbound-queue.jsonl
 *
 *   processApproved (separate cli, called from pulse)
 *     - Scans queue for entries marked approved
 *     - For each: locates the relevant outreach script and runs it
 *       with the draft body
 *     - Marks entry as sent or failed
 *
 *   markDecision (from telegram callback or manual cli)
 *     - Updates queue entry with kirill's decision
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync, statSync, renameSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { audienceFitCheck } from "./operator-identity.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DRAFTS_DIR = resolve(ROOT, ".data/survival-drafts");
const QUEUE_PATH = resolve(ROOT, ".data/survival-outbound-queue.jsonl");
const ENV_PATH = resolve(ROOT, "apps/api/.env");

function envMap() {
  if (!existsSync(ENV_PATH)) return {};
  return Object.fromEntries(
    readFileSync(ENV_PATH, "utf-8").split("\n")
      .filter(l => l && !l.startsWith("#") && l.includes("="))
      .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
  );
}

function ensureDir(p) { const d = dirname(p); if (!existsSync(d)) mkdirSync(d, { recursive: true }); }

function readQueue() {
  if (!existsSync(QUEUE_PATH)) return [];
  return readFileSync(QUEUE_PATH, "utf-8").split("\n").filter(Boolean).map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

function rewriteQueue(rows) {
  ensureDir(QUEUE_PATH);
  writeFileSync(QUEUE_PATH, rows.map(r => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
}

async function tgSend(text, reply_markup = null) {
  const env = envMap();
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return null;
  const body = {
    chat_id: env.TELEGRAM_CHAT_ID,
    text: text.slice(0, 4090),
    disable_web_page_preview: true,
  };
  if (reply_markup) body.reply_markup = reply_markup;
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await res.json();
  return j.ok ? j.result.message_id : null;
}

// ---------- ACTION: propose_outbound_send ----------

export const proposeOutboundMeta = {
  description: "Pick oldest pending draft from survival-drafts/, queue it for Kirill approval via Telegram.",
  side_effect_class: "auto_local_only",
  expected_signal: "draft_queued_for_human_approval",
  expected_signal_delay_min: 60,
  estimated_cost_usd: 0.005,
};

export async function runProposeOutboundSend({ strategy }) {
  if (!existsSync(DRAFTS_DIR)) return { ok: false, reason: "no_drafts_dir" };
  const queue = readQueue();
  const queuedFiles = new Set(queue.map(q => q.draft_path));

  // Find oldest draft not already in queue.
  const drafts = readdirSync(DRAFTS_DIR)
    .filter(f => f.endsWith(".md"))
    .map(f => ({ path: resolve(DRAFTS_DIR, f), mtime: statSync(resolve(DRAFTS_DIR, f)).mtimeMs }))
    .filter(d => !queuedFiles.has(d.path))
    .sort((a, b) => a.mtime - b.mtime);

  if (drafts.length === 0) return { ok: true, reason: "no_unqueued_drafts" };

  const draft = drafts[0];
  const body = readFileSync(draft.path, "utf-8");

  // Audience fit annotation: tag the queue entry with fit_level so Kirill
  // can see if the draft targets the right audience for the proposed
  // channel. Does not block — operator may still want foreign-targeted
  // referral/asset content.
  const fit = audienceFitCheck({ title: draft.path.split("/").pop(), seed_text: body });
  const id = `outbound-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;

  // Heuristic: detect channel from filename (e.g. linkedin-XXX.md, comment-XXX.md)
  const filename = draft.path.split("/").pop();
  const channelMatch = filename.match(/^([a-z]+)/);
  const channel = channelMatch ? channelMatch[1] : "unknown";

  const queueEntry = {
    id,
    queued_at: new Date().toISOString(),
    draft_path: draft.path,
    channel,
    strategy_id: strategy.id,
    audience_fit_level: fit.fit_level,
    audience_market: fit.market,
    decision: null,         // null | "approved" | "denied"
    decided_at: null,
    sent_at: null,
    sent_result: null,
  };
  ensureDir(QUEUE_PATH);
  appendFileSync(QUEUE_PATH, JSON.stringify(queueEntry) + "\n");

  const fitWarning = fit.fit_level === "foreign"
    ? `\n⚠️ AUDIENCE FIT: foreign market (${fit.market}). Operator has no direct audience there. Recommended channels: ${fit.engagement_strategies.slice(0, 2).join(" OR ")}\n`
    : fit.fit_level === "secondary"
    ? `\n⚠️ AUDIENCE FIT: secondary market (${fit.market}). Frame as Canadian outsider, no claim of US local expertise.\n`
    : "";

  const tgText = [
    `📨 OUTBOUND DRAFT — needs approval`,
    ``,
    `id: ${id}`,
    `channel: ${channel}`,
    `strategy: ${strategy.id}`,
    `draft: ${filename}`,
    `audience_fit: ${fit.fit_level} (${fit.market})`,
    fitWarning,
    `━━━━ DRAFT BODY ━━━━`,
    body.length > 3500 ? body.slice(0, 3500) + "...(truncated)" : body,
    `━━━━━━━━━━━━━━━━`,
    ``,
    `Approve via CLI: node scripts/survival/outbound-approval.mjs approve ${id}`,
    `Deny via CLI: node scripts/survival/outbound-approval.mjs deny ${id}`,
  ].join("\n");

  const reply_markup = {
    inline_keyboard: [[
      { text: "✅ Approve", callback_data: `approve_${id}` },
      { text: "❌ Deny", callback_data: `deny_${id}` },
    ]],
  };
  const tgMsgId = await tgSend(tgText, reply_markup);
  return {
    ok: true,
    queue_id: id,
    draft_path: draft.path,
    channel,
    telegram_message_id: tgMsgId,
  };
}

// ---------- CLI: mark approve/deny ----------

export function markDecision(id, decision) {
  const queue = readQueue();
  const target = queue.find(q => q.id === id);
  if (!target) return { ok: false, reason: "not_found", id };
  if (target.decision) return { ok: false, reason: "already_decided", current: target.decision };
  if (decision !== "approved" && decision !== "denied") return { ok: false, reason: "invalid_decision" };
  target.decision = decision;
  target.decided_at = new Date().toISOString();
  rewriteQueue(queue);
  return { ok: true, id, decision };
}

// ---------- Process approved entries ----------

export async function processApproved() {
  const queue = readQueue();
  const pending = queue.filter(q => q.decision === "approved" && q.sent_at === null);
  const results = [];
  for (const entry of pending) {
    // For v1: do not auto-execute outreach scripts. Mark as "ready to send by Kirill"
    // and notify. Once outreach pipeline trust is restored we can auto-fire here.
    entry.sent_at = new Date().toISOString();
    entry.sent_result = "pending_kirill_manual_send";
    results.push({ id: entry.id, action: "marked_ready", draft: entry.draft_path });
    await tgSend([
      `✅ APPROVED outbound (${entry.id}) marked ready.`,
      ``,
      `Draft: ${entry.draft_path.split("/").pop()}`,
      `Channel: ${entry.channel}`,
      ``,
      `Manual send still required by you (auto-send disabled until pipeline verified). Open the draft, copy, paste, send.`,
    ].join("\n"));
  }
  rewriteQueue(queue);
  return { processed: results.length, results };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2];
  if (cmd === "approve" || cmd === "deny") {
    const id = process.argv[3];
    if (!id) { console.error("usage: approve|deny <id>"); process.exit(1); }
    console.log(JSON.stringify(markDecision(id, cmd === "approve" ? "approved" : "denied")));
  } else if (cmd === "process") {
    console.log(JSON.stringify(await processApproved(), null, 2));
  } else if (cmd === "queue") {
    console.log(JSON.stringify(readQueue(), null, 2));
  } else {
    console.log("Commands: approve <id> | deny <id> | process | queue");
  }
}
