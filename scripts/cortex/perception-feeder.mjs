/**
 * cortex/perception-feeder.mjs - Bridge between existing factory bots and substrate perception
 *   (Fix #4 for Active Inference goal, May 9 2026)
 *
 * Substrate's perception module can auto-discover .data/*.json files matching
 * patterns like "replies", "messages", "events". Existing factory bots
 * (reddit-monitor, telegram-sales-agent, etc) write to intelligence DB or
 * separate state files but NOT to the perception-friendly format.
 *
 * This module bridges the gap. Periodically:
 * 1. Reads existing intelligence (DB queries OR direct file scans)
 * 2. Writes perception-friendly aggregates to .data/ files perception watches
 * 3. perception module's auto-discovery picks them up on next pull cycle
 *
 * Sources fed:
 * - Recent Reddit replies (from cortex-state-bus reddit_reply events OR DB)
 * - Recent telegram interactions (from telegram-control state)
 * - Recent email inbox state (from email monitor if exists)
 *
 * Cheap: no LLM. Just JSON aggregation. Runs every 5min.
 */

import { writeFileSync, readFileSync, existsSync, statSync, readdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DATA_DIR = resolve(ROOT, ".data");

// Output files (perception module reads these)
const REDDIT_OUT = resolve(DATA_DIR, "reddit-replies-monitor.json");
const TELEGRAM_OUT = resolve(DATA_DIR, "telegram-callback-log.json");
const EMAIL_OUT = resolve(DATA_DIR, "email-inbox-state.json");

const FEED_INTERVAL_MS = 5 * 60_000;
// Historical signals from factory-bot output files can be days/weeks old.
// Substrate needs context, not just last-24h liveness. 60d covers a typical
// outreach cycle while still cutting off truly stale data.
const RECENT_WINDOW_MS = 60 * 24 * 60 * 60_000;

let _busRef = null;
let _timer = null;

// In-memory aggregator - bus events flow in here
const _state = {
  redditReplies: [], // collected from bus events with reddit-related types
  telegramEvents: [],
  emailMessages: [],
};

const MAX_PER_TYPE = 100;

function _trimOld(arr) {
  const cutoff = Date.now() - RECENT_WINDOW_MS;
  return arr.filter(item => {
    const tRaw =
      item.at ||
      item.created ||
      item.timestamp ||
      item.created_at ||
      item.received_at ||
      0;
    const t = new Date(tRaw).getTime();
    return t >= cutoff;
  }).slice(-MAX_PER_TYPE);
}

function _scanExistingIntelligence() {
  // Look for files in .data/ that may contain real-world events from factory bots.
  // The factory bots write with field names that do NOT match the substrate's
  // perception schema — e.g. the email reply pipeline writes `replied_rows`/
  // `meaningful_reply_rows` containing `reply_body`. The substrate is asking
  // for `replies`/`body`. This function bridges those schemas so the substrate
  // stops seeing a black world.
  if (!existsSync(DATA_DIR)) return;

  // Telegram: read JSONL inbox written by organism-telegram listener.
  // Each line is {update_id, message_id, text, date, from, received_at}.
  const TG_INBOX = resolve(DATA_DIR, "organism-telegram-inbox.jsonl");
  if (existsSync(TG_INBOX)) {
    try {
      const lines = readFileSync(TG_INBOX, "utf-8").split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const item = JSON.parse(line);
          _state.telegramEvents.push({
            id: item.update_id || item.message_id || `tg-${Math.random().toString(36).slice(2, 9)}`,
            update_id: item.update_id,
            callback_data: null,
            text: item.text,
            from: { username: item.from },
            at: item.received_at || (item.date ? new Date(item.date * 1000).toISOString() : new Date().toISOString()),
          });
        } catch {}
      }
    } catch {}
  }

  try {
    const files = readdirSync(DATA_DIR);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;

      // Reddit drafts (outgoing activity, but proves system is touching the world)
      if (/awareness-reddit-drafts|reddit-dispatch/i.test(file)) {
        try {
          const raw = JSON.parse(readFileSync(resolve(DATA_DIR, file), "utf-8"));
          const arr = Array.isArray(raw) ? raw : (raw.drafts || raw.items || []);
          for (const item of arr) {
            const body = item?.body || item?.text || item?.content;
            if (!body) continue;
            _state.redditReplies.push({
              id: item.leadId || item.id || `${file}-${Math.random().toString(36).slice(2, 7)}`,
              body: String(body),
              author: item.author || "self-draft",
              subreddit: item.sub || item.subreddit || "unknown",
              post_url: item.url || item.post_url,
              created_at: item.created_at || item.at || new Date().toISOString(),
            });
          }
        } catch {}
      }

      // Email/Reddit reply files (real-world signals)
      if (/reply-leads|reddit-reply|cycle.*replies|threads-replies|inbox.*replies/i.test(file)) {
        try {
          const raw = JSON.parse(readFileSync(resolve(DATA_DIR, file), "utf-8"));
          const candidates = [];
          if (Array.isArray(raw)) {
            candidates.push(...raw);
          } else if (raw && typeof raw === "object") {
            for (const key of ["replies", "leads", "items", "rows", "replied_rows", "meaningful_reply_rows"]) {
              if (Array.isArray(raw[key])) candidates.push(...raw[key]);
            }
          }
          for (const item of candidates) {
            const body = item?.reply_body || item?.body || item?.content || item?.text;
            if (!body) continue;
            // Determine channel: emails have `business_email`/`subject`, reddit has `subreddit`/`post_url`
            const isEmail = item?.business_email || item?.subject || item?.reply_received_at;
            const bucket = isEmail ? _state.emailMessages : _state.redditReplies;
            if (isEmail) {
              bucket.push({
                message_id: item.id || item.message_id || `${file}-${Math.random().toString(36).slice(2, 7)}`,
                subject: item.subject || "(no subject)",
                snippet: String(body).slice(0, 300),
                from: item.business_email || item.from || "unknown",
                received_at: item.reply_received_at || item.received_at || item.created_at || new Date().toISOString(),
              });
            } else {
              bucket.push({
                id: item.id || item.comment_id || `${file}-${Math.random().toString(36).slice(2, 7)}`,
                body: String(body),
                author: item.author || "unknown",
                subreddit: item.subreddit || "unknown",
                post_url: item.post_url || item.url,
                created_at: item.created_at || item.created || new Date().toISOString(),
              });
            }
          }
        } catch {}
      }
    }
  } catch {}
}

function _feed() {
  // Scan existing intelligence files
  _scanExistingIntelligence();

  // Trim and write
  _state.redditReplies = _trimOld(_state.redditReplies);
  _state.telegramEvents = _trimOld(_state.telegramEvents);
  _state.emailMessages = _trimOld(_state.emailMessages);

  // Dedupe by whatever identity field is present (email uses message_id,
  // reddit uses id, telegram callbacks use update_id).
  const dedupe = (arr) => {
    const seen = new Set();
    return arr.filter(item => {
      const key = item.id || item.message_id || item.update_id;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  _state.redditReplies = dedupe(_state.redditReplies);
  _state.telegramEvents = dedupe(_state.telegramEvents);
  _state.emailMessages = dedupe(_state.emailMessages);

  try {
    writeFileSync(REDDIT_OUT, JSON.stringify({
      updatedAt: new Date().toISOString(),
      replies: _state.redditReplies,
    }, null, 2));
    writeFileSync(TELEGRAM_OUT, JSON.stringify({
      updatedAt: new Date().toISOString(),
      events: _state.telegramEvents,
    }, null, 2));
    writeFileSync(EMAIL_OUT, JSON.stringify({
      updatedAt: new Date().toISOString(),
      recent: _state.emailMessages,
    }, null, 2));
  } catch (e) {
    process.stderr.write(`[perception-feeder] write failed: ${e?.message || e}\n`);
  }

  if (_busRef) {
    try {
      _busRef.broadcast({
        source: "perception-feeder",
        type: "perception_feed_updated",
        data: {
          reddit_count: _state.redditReplies.length,
          telegram_count: _state.telegramEvents.length,
          email_count: _state.emailMessages.length,
        },
      });
    } catch {}
  }
}

export function register(bus) {
  _busRef = bus;

  // Listen for bus events that look like real-world inputs
  // (factory bots emit these via orchestrator if they use sendEventBus)
  bus.subscribe("reddit_reply_received", (entry) => {
    const data = entry?.data || {};
    _state.redditReplies.push({
      id: data.id || data.comment_id || `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      body: data.body || data.content || data.text,
      author: data.author,
      subreddit: data.subreddit,
      post_url: data.post_url || data.url,
      created_at: entry.at,
    });
  });

  bus.subscribe("telegram_callback_received", (entry) => {
    const data = entry?.data || {};
    _state.telegramEvents.push({
      id: data.update_id || data.id || `tg-${Date.now()}`,
      callback_data: data.callback_data,
      text: data.text,
      from: data.from,
      at: entry.at,
    });
  });

  bus.subscribe("email_received", (entry) => {
    const data = entry?.data || {};
    _state.emailMessages.push({
      message_id: data.message_id || data.id,
      subject: data.subject,
      snippet: data.snippet || (data.body || "").slice(0, 300),
      from: data.from,
      received_at: data.received_at || entry.at,
    });
  });

  // Initial scan + periodic feed
  setTimeout(_feed, 5000).unref?.();
  if (!_timer) {
    _timer = setInterval(_feed, FEED_INTERVAL_MS);
    _timer.unref?.();
  }
}

export function _flush() { _feed(); }
export function getCounts() {
  return {
    reddit: _state.redditReplies.length,
    telegram: _state.telegramEvents.length,
    email: _state.emailMessages.length,
  };
}
export function _resetState() {
  _state.redditReplies.length = 0;
  _state.telegramEvents.length = 0;
  _state.emailMessages.length = 0;
  _busRef = null;
  if (_timer) { clearInterval(_timer); _timer = null; }
}

// CLI mode: when invoked directly (e.g. from pulse-daemon), run one feed
// cycle synchronously and exit. Lets the heartbeat refresh perception
// without having to keep the bus-registered module alive.
if (import.meta.url === `file://${process.argv[1]}`) {
  _feed();
  const counts = {
    reddit: _state.redditReplies.length,
    telegram: _state.telegramEvents.length,
    email: _state.emailMessages.length,
  };
  process.stdout.write(`[perception-feeder] cli flush: ${JSON.stringify(counts)}\n`);
  process.exit(0);
}
