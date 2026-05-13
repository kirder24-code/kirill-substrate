/**
 * scripts/survival/telegram-callback-poller.mjs
 *
 * Polls Telegram bot getUpdates for callback_query events triggered by
 * inline-keyboard buttons (Approve/Deny) on outbound draft messages.
 * Maps each callback to outbound-approval.markDecision().
 *
 * Designed to be invoked by pulse-daemon every hour. Uses long-polling
 * with offset persisted to .data/survival-tg-callback-state.json so we
 * never re-process the same callback twice.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { markDecision } from "./outbound-approval.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const STATE_PATH = resolve(ROOT, ".data/survival-tg-callback-state.json");
const ENV_PATH = resolve(ROOT, "apps/api/.env");

function envMap() {
  if (!existsSync(ENV_PATH)) return {};
  return Object.fromEntries(
    readFileSync(ENV_PATH, "utf-8").split("\n").filter(l => l && !l.startsWith("#") && l.includes("="))
      .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
  );
}

function loadState() {
  if (!existsSync(STATE_PATH)) return { last_update_id: 0 };
  try { return JSON.parse(readFileSync(STATE_PATH, "utf-8")); }
  catch { return { last_update_id: 0 }; }
}
function saveState(s) { writeFileSync(STATE_PATH, JSON.stringify(s, null, 2)); }

export const telegramCallbackPollerMeta = {
  description: "Poll Telegram bot getUpdates for inline-keyboard approve/deny clicks; mark decisions in outbound queue.",
  side_effect_class: "auto",
  expected_signal: "outbound_decisions_marked",
  expected_signal_delay_min: 0,
  estimated_cost_usd: 0.0,
};

export async function runTelegramCallbackPoller({ strategy }) {
  const env = envMap();
  if (!env.TELEGRAM_BOT_TOKEN) return { ok: false, reason: "no_bot_token" };
  const state = loadState();
  const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getUpdates?offset=${state.last_update_id + 1}&timeout=2&allowed_updates=["callback_query"]`;
  let updates;
  try {
    const res = await fetch(url);
    const j = await res.json();
    if (!j.ok) return { ok: false, reason: "telegram_api_error", description: j.description };
    updates = j.result || [];
  } catch (e) {
    return { ok: false, reason: "fetch_failed", error: e.message };
  }
  if (updates.length === 0) return { ok: true, processed: 0 };

  const decisions = [];
  let maxId = state.last_update_id;
  for (const u of updates) {
    if (u.update_id > maxId) maxId = u.update_id;
    const cb = u.callback_query;
    if (!cb || !cb.data) continue;
    // data formats: approve_<id> | deny_<id>
    const m = cb.data.match(/^(approve|deny)_(.+)$/);
    if (!m) continue;
    const decision = m[1] === "approve" ? "approved" : "denied";
    const queue_id = m[2];
    let result;
    try { result = markDecision(queue_id, decision); }
    catch (e) { result = { ok: false, reason: "exception", error: e.message }; }
    decisions.push({ queue_id, decision, result });
    // Acknowledge the callback click in TG (removes "loading" spinner)
    try {
      await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          callback_query_id: cb.id,
          text: result?.ok ? `Marked ${decision}` : `Failed: ${result?.reason || "?"}`,
        }),
      });
    } catch {}
  }

  saveState({ last_update_id: maxId });
  return { ok: true, processed: decisions.length, decisions };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await runTelegramCallbackPoller({ strategy: { id: "manual" } });
  console.log(JSON.stringify(r, null, 2));
}
