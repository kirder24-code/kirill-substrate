/**
 * CORTEX OUTPUT — Unified external interface for all outgoing messages
 *
 * Every message from CORTEX to Kirill passes through here.
 * Enforces consistent format, 4096 char limit, and type labeling.
 *
 * Types:
 *   STATUS  - system state update, no action needed
 *   ALERT   - something important happened, may need attention
 *   ASK     - brain needs input from Kirill
 *   BRIEF   - morning/summary report
 *   RESULT  - action completed (hands, workflow, research)
 *   PING    - brain-initiated contact (proactive call)
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const ENV_PATH = resolve(ROOT, "apps/api/.env");

function loadEnv() {
  try {
    return Object.fromEntries(
      readFileSync(ENV_PATH, "utf-8").split("\n")
        .filter(l => l && !l.startsWith("#") && l.includes("="))
        .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
    );
  } catch { return {}; }
}

const TYPE_PREFIX = {
  STATUS: "[STATUS]",
  ALERT:  "[ALERT]",
  ASK:    "[ASK]",
  BRIEF:  "[BRIEF]",
  RESULT: "[RESULT]",
  PING:   "[CORTEX]",
};

const MAX_LEN = 4096;

/**
 * Format a message for Kirill. Body is trimmed to fit within 4096 total.
 * @param {string} type - STATUS | ALERT | ASK | BRIEF | RESULT | PING
 * @param {string} header - One-line summary (max 100 chars)
 * @param {string} [body] - Main content
 * @param {string} [actionLine] - Optional request or next step for Kirill
 * @returns {string} formatted message ready to send
 */
export function formatOutput(type, header, body, actionLine) {
  const prefix = TYPE_PREFIX[type] || `[${type}]`;
  const h = (header || "").slice(0, 100);
  const tail = actionLine ? `\n\n${actionLine.slice(0, 200)}` : "";
  const frame = `${prefix} ${h}${tail}`;
  const available = MAX_LEN - frame.length - 2;
  const b = body ? body.slice(0, Math.max(0, available)) : "";
  if (b) return `${prefix} ${h}\n\n${b}${tail}`;
  return frame;
}

/**
 * Send a formatted message to Kirill via Telegram.
 * This is the single authorized send path for all CORTEX outbound communication.
 *
 * @returns {Promise<{ok: boolean, text?: string, reason?: string}>}
 */
export async function sendToKirill(type, header, body, actionLine) {
  const env = loadEnv();
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return { ok: false, reason: "no_token" };

  const text = formatOutput(type, header, body, actionLine);

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json();
    return { ok: !!data.ok, text };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}
