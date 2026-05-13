/**
 * CORTEX OUTGOING TRIGGER — Brain-initiated contact channel
 *
 * The brain can now CALL Kirill instead of waiting to be called.
 * When the system detects something urgent or has a question,
 * it fires this trigger directly - no LLM cycle required.
 *
 * Cooldowns prevent spam:
 * - Urgency 1-8: max 1 proactive call per 20 min
 * - Urgency 9-10: max 1 proactive call per 5 min
 *
 * The daemon checks canCallKirill() in the 30s heartbeat loop.
 * High-priority initiative actions (notify_kirill, priority >= 8)
 * fire through this channel immediately without waiting for LLM.
 */

import { writeFileSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { pushEvent } from "./state-bus.mjs";
import { sendToKirill } from "./cortex-output.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const TRIGGER_LOG_PATH = resolve(ROOT, ".data/cortex-outgoing-trigger.json");

const COOLDOWN_NORMAL_MS = 20 * 60_000; // 20 min
const COOLDOWN_URGENT_MS =  5 * 60_000; // 5 min for urgency >= 9

let lastCallAt = 0;
let callCount = 0;

/**
 * Check if the brain is allowed to call Kirill right now.
 * @param {number} urgency 1-10
 */
export function canCallKirill(urgency = 5) {
  const cooldown = urgency >= 9 ? COOLDOWN_URGENT_MS : COOLDOWN_NORMAL_MS;
  return Date.now() - lastCallAt >= cooldown;
}

/**
 * Brain calls Kirill proactively.
 * Use when the system has something to say, not waiting for Kirill to initiate.
 *
 * @param {string} reason - Short internal label (e.g. "temporal_urgency", "hot_lead_cooling")
 * @param {string} message - The message body to send
 * @param {number} urgency - 1-10 (9+ bypasses normal cooldown)
 * @returns {Promise<{sent: boolean, reason?: string}>}
 */
export async function callKirill(reason, message, urgency = 5) {
  if (!canCallKirill(urgency)) {
    const cooldown = urgency >= 9 ? COOLDOWN_URGENT_MS : COOLDOWN_NORMAL_MS;
    const waitMin = Math.ceil((cooldown - (Date.now() - lastCallAt)) / 60_000);
    return { sent: false, reason: `cooldown: ${waitMin}min remaining` };
  }

  const result = await sendToKirill("PING", reason, message, null);

  if (result.ok) {
    lastCallAt = Date.now();
    callCount++;

    try {
      let log = [];
      try { log = JSON.parse(readFileSync(TRIGGER_LOG_PATH, "utf-8")); } catch {}
      log.push({ at: new Date().toISOString(), reason, urgency, preview: message.slice(0, 200) });
      if (log.length > 50) log = log.slice(-50);
      writeFileSync(TRIGGER_LOG_PATH, JSON.stringify(log, null, 2));
    } catch {}

    pushEvent("daemon", "outgoing_trigger", { reason, urgency, sent: true });
  }

  return { sent: result.ok, reason: result.reason };
}

/**
 * How many proactive calls have been made this session.
 */
export function getCallStats() {
  return {
    count: callCount,
    lastCallAt: lastCallAt > 0 ? new Date(lastCallAt).toISOString() : null,
    cooldownRemaining: Math.max(0, COOLDOWN_NORMAL_MS - (Date.now() - lastCallAt)),
  };
}
