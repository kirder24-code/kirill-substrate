/**
 * scripts/lib/safe-send.mjs
 *
 * Single safety wrapper for ALL outbound dispatch. Every email/Telegram/
 * LinkedIn/Reddit send must pass through this module so egress-guard +
 * injection-scanner enforce the rules consistently.
 *
 * Usage:
 *   import { safeSend } from "../lib/safe-send.mjs";
 *   const verdict = await safeSend({
 *     channel: "email" | "telegram" | "linkedin" | "reddit" | "threads" | "x",
 *     text: "<message body>",
 *     meta: { recipient, opp_id, draft_id }       // optional, used only for log
 *   });
 *   if (!verdict.ok) {
 *     // refuse to send. verdict.reason explains why.
 *     return verdict;
 *   }
 *   // proceed with actual transport
 *
 * The wrapper does NOT actually send. It returns a verdict; the caller
 * performs the transport call only when ok:true. This keeps the wrapper
 * transport-agnostic and testable.
 */

import { inspectMessage, logEgressAlert } from "../factory/egress-guard.mjs";

export async function safeSend({ channel, text, meta = {} }) {
  if (!channel || !text) {
    return { ok: false, reason: "missing_channel_or_text", channel, text_len: text?.length || 0 };
  }
  if (typeof text !== "string") {
    return { ok: false, reason: "text_not_string", channel };
  }

  // Channel-specific length sanity (don't even attempt if obviously broken)
  const limits = { telegram: 4096, linkedin_dm: 1900, linkedin_post: 3000, twitter_x: 280, reddit: 10000, threads: 500, email: 50000 };
  const cap = limits[channel] || limits[channel?.split("_")[0]] || 50000;
  if (text.length > cap) {
    return { ok: false, reason: "exceeds_channel_limit", channel, len: text.length, cap };
  }

  // Egress inspection — credential leaks, internal paths, .env references
  const verdict = inspectMessage(text);
  if (verdict.action === "deny") {
    await logEgressAlert({
      channel,
      verdict_action: verdict.action,
      reason: verdict.reason,
      label: verdict.label,
      sample: text.slice(0, 200),
      ...meta,
    });
    return {
      ok: false,
      reason: "egress_guard_denied",
      egress_reason: verdict.reason,
      label: verdict.label,
      hint: "The message body contains a credential pattern, internal filesystem path, or env-var reference. Refuse to send. Investigate the source LLM prompt that produced this text.",
    };
  }

  return { ok: true, channel, len: text.length };
}

/**
 * Convenience: drop-in wrapper around an existing transport function.
 *
 *   import { withSafeSend } from "../lib/safe-send.mjs";
 *   const sendEmail = withSafeSend("email", rawSendEmailImpl);
 *   await sendEmail({ to, subject, text });   // egress-guarded
 *
 * `transport` receives the original payload IF and only IF safety passes.
 */
export function withSafeSend(channel, transport) {
  return async (payload) => {
    const text = payload?.text || payload?.body || payload?.message || payload?.content || "";
    const verdict = await safeSend({ channel, text, meta: { recipient: payload?.to || payload?.chat || payload?.subreddit } });
    if (!verdict.ok) return verdict;
    return await transport(payload);
  };
}
