/**
 * scripts/survival/inbox-monitor.mjs
 *
 * Read-only IMAP poller. Connects to operator's email account, fetches
 * recent inbound messages, classifies for relevance (replies to outbound,
 * inbound prospect inquiries, autoresponders), surfaces signals back
 * to substrate.
 *
 * No Google OAuth required — uses IMAP App Password for Gmail or any
 * standard IMAP provider. Operator generates App Password once via
 * Gmail's 2FA settings, sets in env:
 *   IMAP_HOST=imap.gmail.com
 *   IMAP_PORT=993
 *   IMAP_USER=kirill@launchsoloai.com
 *   IMAP_PASSWORD=<16-char app password>
 *
 * Each tick:
 *   1. Connect, select INBOX
 *   2. Fetch unseen + recent (last 24h) messages
 *   3. Parse each: subject, from, body excerpt, in_reply_to header
 *   4. Classify via Claude: is this reply to outreach? prospect inquiry? noise?
 *   5. For replies linkable to outbound queue → mark queue entry as
 *      "got_reply" and bump originating strategy by +5 USD synthetic food
 *   6. For prospect inquiries → create opportunity in survival.db
 *   7. Append to .data/survival-inbox-events.jsonl
 *
 * NEVER marks messages as seen, never deletes, never responds.
 * Read-only paranoid mode.
 */

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { readFileSync, existsSync, appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

import { think } from "./llm-think.mjs";
import { createOpportunity } from "./opportunity-store.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const ENV_PATH = resolve(ROOT, "apps/api/.env");
const EVENTS_LOG = resolve(ROOT, ".data/survival-inbox-events.jsonl");
const STATE_PATH = resolve(ROOT, ".data/survival-inbox-state.json");
const SURVIVAL_DB = resolve(ROOT, ".data/survival.db");
const QUEUE_PATH = resolve(ROOT, ".data/survival-outbound-queue.jsonl");

function envMap() {
  if (!existsSync(ENV_PATH)) return {};
  return Object.fromEntries(
    readFileSync(ENV_PATH, "utf-8").split("\n").filter(l => l && !l.startsWith("#") && l.includes("="))
      .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
  );
}

function ensureDir(p) { if (!existsSync(p)) mkdirSync(p, { recursive: true }); }

function loadState() {
  if (!existsSync(STATE_PATH)) return { last_seen_uid: 0, last_run_at: null };
  try { return JSON.parse(readFileSync(STATE_PATH, "utf-8")); }
  catch { return { last_seen_uid: 0, last_run_at: null }; }
}
function saveState(s) {
  ensureDir(dirname(STATE_PATH));
  writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}

function readQueue() {
  if (!existsSync(QUEUE_PATH)) return [];
  return readFileSync(QUEUE_PATH, "utf-8").split("\n").filter(Boolean).map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

function findRelatedQueueEntry(messageHeaders) {
  // Match if In-Reply-To or References contains a queue entry's
  // sent message id pattern (substrate's drafts won't have this yet
  // since we don't auto-send — but when operator sends and replies
  // come, this will work).
  // For now: stub. Real linking requires substrate-sent emails to
  // include trackable Message-ID.
  return null;
}

function bumpStrategyFood(strategy_id, usd_amount) {
  if (!strategy_id) return false;
  try {
    const db = new Database(SURVIVAL_DB);
    db.prepare(
      `UPDATE policy_strategies SET food_received_usd = food_received_usd + ?
       WHERE id = ?`
    ).run(usd_amount, strategy_id);
    db.close();
    return true;
  } catch { return false; }
}

async function classifyMessage(msg) {
  const prompt = `You are substrate's inbox classifier. Given an inbound email, classify it as ONE of:

  reply_to_outreach    — looks like a reply to a cold outreach Kirill sent
  prospect_inquiry     — inbound prospect asking about services
  autoresponder        — out-of-office, vacation, automated reply
  newsletter_or_spam   — promotional, newsletter, mass-marketed
  personal             — personal correspondence, not business
  other_noise          — system mail, GitHub notification, etc.

Email:
  From: ${msg.from}
  Subject: ${msg.subject}
  Body excerpt (first 600 chars): ${msg.body?.slice(0, 600) || "(empty)"}

Output ONLY JSON: {"classification": "<one of above>", "confidence": 0.0-1.0, "fitness_value_usd": <number — see below>, "reason": "<one sentence>"}

fitness_value_usd guide:
  reply_to_outreach with positive intent: 8-15
  prospect_inquiry from real person: 5-12
  reply_to_outreach with rejection/decline: 2 (still real signal)
  autoresponder: 1
  newsletter_or_spam, personal, other_noise: 0`;

  const result = await think({
    prompt, caller: "inbox_monitor", max_input_tokens: 1500, max_output_tokens: 200,
  });
  if (!result.ok) return { classification: "unknown", confidence: 0, fitness_value_usd: 0, reason: result.reason };
  try {
    const m = result.output.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : { classification: "parse_failed", confidence: 0, fitness_value_usd: 0 };
  } catch {
    return { classification: "parse_failed", confidence: 0, fitness_value_usd: 0 };
  }
}

export const inboxMonitorMeta = {
  description: "Connect to IMAP inbox (read-only), classify recent inbound mail, surface real reply signals to substrate.",
  side_effect_class: "auto",
  expected_signal: "inbox_messages_classified",
  expected_signal_delay_min: 0,
  estimated_cost_usd: 0.10,
};

export async function runInboxMonitor({ strategy }) {
  const env = envMap();
  // Default to existing OUTREACH_* credentials (kirill@launchsoloai.com via
  // privateemail.com). Override via IMAP_* if a different account is needed.
  const host = env.IMAP_HOST || env.OUTREACH_IMAP_HOST;
  const port = Number(env.IMAP_PORT || env.OUTREACH_IMAP_PORT || 993);
  const user = env.IMAP_USER || env.OUTREACH_EMAIL;
  const pass = env.IMAP_PASSWORD || env.OUTREACH_PASSWORD;
  if (!host || !user || !pass) {
    return { ok: false, reason: "imap_not_configured", hint: "set IMAP_HOST/USER/PASSWORD or use OUTREACH_* env vars" };
  }
  const client = new ImapFlow({
    host, port, secure: true,
    auth: { user, pass },
    logger: false,
  });

  let messagesProcessed = 0;
  let highSignal = 0;
  const newEvents = [];
  const state = loadState();

  try {
    await client.connect();
    let lock = await client.getMailboxLock("INBOX");
    try {
      const mailbox = client.mailbox;
      // Fetch up to 25 most recent messages with UID > last seen
      const since = new Date(Date.now() - 7 * 24 * 3600 * 1000); // 7-day window
      const range = state.last_seen_uid > 0 ? `${state.last_seen_uid + 1}:*` : "1:*";
      let highestUid = state.last_seen_uid;
      const toClassify = [];
      for await (const msg of client.fetch(range, { envelope: true, source: false, bodyStructure: false }, { uid: true })) {
        if (msg.envelope.date && msg.envelope.date < since) continue;
        if (msg.uid <= state.last_seen_uid) continue;
        if (msg.uid > highestUid) highestUid = msg.uid;
        toClassify.push({ uid: msg.uid, envelope: msg.envelope });
        if (toClassify.length >= 25) break;
      }

      for (const m of toClassify) {
        // Fetch body for top candidates
        const fetched = await client.fetchOne(m.uid, { source: true }, { uid: true });
        if (!fetched || !fetched.source) continue;
        const parsed = await simpleParser(fetched.source);
        const msgInfo = {
          uid: m.uid,
          from: parsed.from?.text || "(unknown)",
          subject: parsed.subject || "(no subject)",
          date: parsed.date?.toISOString() || null,
          body: (parsed.text || parsed.html || "").slice(0, 1500),
        };
        const cls = await classifyMessage(msgInfo);
        const event = {
          ts: new Date().toISOString(),
          uid: m.uid,
          from: msgInfo.from,
          subject: msgInfo.subject,
          classification: cls.classification,
          confidence: cls.confidence,
          fitness_value_usd: cls.fitness_value_usd,
          reason: cls.reason,
        };
        newEvents.push(event);
        messagesProcessed++;

        // Try to attribute to a queue entry (if substrate's outbound was sent)
        const related = findRelatedQueueEntry(parsed.headers);
        if (related && related.strategy_id && cls.fitness_value_usd > 0) {
          bumpStrategyFood(related.strategy_id, cls.fitness_value_usd);
          event.attributed_to_strategy = related.strategy_id;
        }

        // Promote prospect inquiries to opportunities
        if (cls.classification === "prospect_inquiry" && cls.confidence > 0.6) {
          const id = createOpportunity({
            title: `inbound prospect: ${(msgInfo.subject || "(no subject)").slice(0, 80)}`,
            source: "inbox_monitor",
            source_provenance: `from=${msgInfo.from}`,
            seed_text: msgInfo.body?.slice(0, 1000) || "",
            parent_strategy_id: strategy.id,
            notes: "auto-detected from inbox",
          });
          event.opportunity_created = id;
          highSignal++;
        }
        if (cls.fitness_value_usd >= 5) highSignal++;
      }

      saveState({ last_seen_uid: highestUid, last_run_at: new Date().toISOString() });
    } finally { lock.release(); }
  } catch (e) {
    try { await client.logout(); } catch {}
    return { ok: false, reason: "imap_error", error: e.message };
  }
  try { await client.logout(); } catch {}

  ensureDir(dirname(EVENTS_LOG));
  for (const e of newEvents) appendFileSync(EVENTS_LOG, JSON.stringify(e) + "\n");

  return { ok: true, messages_processed: messagesProcessed, high_signal_messages: highSignal, events: newEvents.slice(0, 5) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await runInboxMonitor({ strategy: { id: "manual" } });
  console.log(JSON.stringify(r, null, 2));
}
