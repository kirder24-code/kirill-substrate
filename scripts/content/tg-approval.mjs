/**
 * scripts/content/tg-approval.mjs
 *
 * Telegram approval flow for visual assets.
 *
 *   sendAssetForApproval({ asset_id })
 *     → sends PNG + caption to Kirill's TG with inline buttons:
 *        ✅ Publish · ✏️ Edit · ❌ Skip · 🎲 Re-generate
 *
 * Webhook endpoint `/api/content/decision` (in webhook-server) receives
 * Telegram callback_query, updates content_visual_assets.status accordingly,
 * and triggers actions.
 *
 * For now, "Publish" updates status to "approved" — operator manually
 * uploads to LinkedIn. Phase 3 will integrate LinkedIn API for auto-publish.
 *
 * Public API:
 *   sendAssetForApproval({ asset_id })
 *   handleCallback({ callback_query })  — called by webhook-server
 */

import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getAsset, updateAsset, getByCallbackToken } from "./content-store.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const ENV_PATH = resolve(ROOT, "apps/api/.env");

function envMap() {
  try {
    return Object.fromEntries(
      readFileSync(ENV_PATH, "utf-8").split("\n")
        .filter(l => l && !l.startsWith("#") && l.includes("="))
        .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
    );
  } catch { return {}; }
}

async function tgSendPhoto({ chat_id, photo_path, caption, reply_markup, token }) {
  const fs = await import("node:fs");
  const photoBuffer = fs.readFileSync(photo_path);
  const blob = new Blob([photoBuffer], { type: "image/png" });
  const form = new FormData();
  form.append("chat_id", String(chat_id));
  form.append("photo", blob, "asset.png");
  if (caption) form.append("caption", caption);
  form.append("parse_mode", "HTML");
  if (reply_markup) form.append("reply_markup", JSON.stringify(reply_markup));
  const r = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: "POST", body: form, signal: AbortSignal.timeout(30_000) });
  return await r.json();
}

async function tgSendVideo({ chat_id, video_path, caption, reply_markup, token }) {
  const fs = await import("node:fs");
  const buf = fs.readFileSync(video_path);
  const blob = new Blob([buf], { type: "video/mp4" });
  const form = new FormData();
  form.append("chat_id", String(chat_id));
  form.append("video", blob, "motion.mp4");
  form.append("supports_streaming", "true");
  if (caption) form.append("caption", caption);
  form.append("parse_mode", "HTML");
  if (reply_markup) form.append("reply_markup", JSON.stringify(reply_markup));
  const r = await fetch(`https://api.telegram.org/bot${token}/sendVideo`, { method: "POST", body: form, signal: AbortSignal.timeout(60_000) });
  return await r.json();
}

async function tgAnswerCallback({ callback_query_id, text, token }) {
  const r = await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id, text, show_alert: false }),
    signal: AbortSignal.timeout(8_000),
  });
  return await r.json();
}

async function tgEditMessageReplyMarkup({ chat_id, message_id, reply_markup, token }) {
  const r = await fetch(`https://api.telegram.org/bot${token}/editMessageReplyMarkup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id, message_id, reply_markup }),
    signal: AbortSignal.timeout(8_000),
  });
  return await r.json();
}

export async function sendAssetForApproval({ asset_id }) {
  const env = envMap();
  const token = env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  const chat_id = env.TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat_id) return { ok: false, reason: "no_tg_credentials" };

  const asset = getAsset(asset_id);
  if (!asset) return { ok: false, reason: "asset_not_found" };
  const asset_level = asset.asset_level || "static";
  const pathsJSON = asset.paths ? (typeof asset.paths === "string" ? JSON.parse(asset.paths) : asset.paths) : {};
  // Resolve which file to upload by level
  let uploadPath = null, uploadKind = null;
  if (asset_level === "motion") {
    uploadPath = pathsJSON.mp4_path || null;
    uploadKind = "video";
  } else if (asset_level === "scroll") {
    uploadPath = pathsJSON.scroll_mp4_path || null;
    uploadKind = "video";
  } else {
    uploadPath = asset.png_path ? resolve(ROOT, asset.png_path) : (pathsJSON.png_path || null);
    uploadKind = "photo";
  }
  if (!uploadPath) return { ok: false, reason: `no_${uploadKind}_path` };
  if (!existsSync(uploadPath)) return { ok: false, reason: `${uploadKind}_missing_on_disk`, path: uploadPath };

  const brief = asset.brief || {};
  const caption =
    `<b>🎨 ${asset_level === "motion" ? "Motion" : "Visual"} asset ready for approval</b>\n` +
    `\n` +
    `<b>${(brief.big_title || asset.idea_text || "(no title)").slice(0, 200)}</b>\n` +
    `\n` +
    `level: <code>${asset_level}</code>\n` +
    `template: <code>${asset.template_type}</code>\n` +
    `accent: <code>${asset.accent_color}</code>\n` +
    `channel: <code>${asset.channel}</code> · audience: <code>${asset.audience}</code>\n` +
    (asset.judge_score ? `judge score: <code>${(asset.judge_score * 40).toFixed(0)}/40</code>\n` : "") +
    (asset.judge_reason ? `\n<i>${asset.judge_reason.slice(0, 200)}</i>\n` : "") +
    `\nasset_id: <code>${asset.id}</code>`;

  // callback_data is capped at 64 bytes by Telegram. Use short callback_token, not full asset.id.
  const tok = asset.callback_token;
  if (!tok) return { ok: false, reason: "missing_callback_token" };
  const reply_markup = {
    inline_keyboard: [
      [
        { text: "✅ Publish", callback_data: `c:a:${tok}` },
        { text: "✏️ Edit",    callback_data: `c:e:${tok}` },
      ],
      [
        { text: "❌ Skip",       callback_data: `c:r:${tok}` },
        { text: "🎲 Re-generate", callback_data: `c:g:${tok}` },
      ],
    ],
  };

  const result = uploadKind === "video"
    ? await tgSendVideo({ chat_id, video_path: uploadPath, caption, reply_markup, token })
    : await tgSendPhoto({ chat_id, photo_path: uploadPath, caption, reply_markup, token });
  if (!result.ok) return { ok: false, reason: "tg_send_failed", description: result.description, upload_kind: uploadKind };

  updateAsset(asset.id, { status: "pending_approval" });
  return { ok: true, message_id: result.result?.message_id, chat_id, upload_kind: uploadKind };
}

/**
 * Department-grade unified card. Single TG message contains:
 *   PURPOSE / POST TEXT / HASHTAGS / SUGGESTED TIME / ASSET META
 *   + 6 buttons (Publish / Edit text / Edit visual / Schedule / Skip / Regen)
 *
 * Used by content-orchestrator after both visual and post text are ready.
 * Falls back to sendAssetForApproval-style minimal caption if post_text missing.
 */
export async function sendUnifiedCard({ asset_id }) {
  const env = envMap();
  const token = env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  const chat_id = env.TELEGRAM_CHAT_ID || process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat_id) return { ok: false, reason: "no_tg_credentials" };

  const asset = getAsset(asset_id);
  if (!asset) return { ok: false, reason: "asset_not_found" };
  const tok = asset.callback_token;
  if (!tok) return { ok: false, reason: "missing_callback_token" };

  // If asset has no post_text yet, fall back to legacy minimal card so we never silently lose work
  if (!asset.post_text) return await sendAssetForApproval({ asset_id });

  const asset_level = asset.asset_level || "static";
  const pathsJSON = asset.paths ? (typeof asset.paths === "string" ? JSON.parse(asset.paths) : asset.paths) : {};
  let uploadPath = null, uploadKind = null;
  if (asset_level === "motion") { uploadPath = pathsJSON.mp4_path; uploadKind = "video"; }
  else if (asset_level === "scroll") { uploadPath = pathsJSON.scroll_mp4_path; uploadKind = "video"; }
  else { uploadPath = asset.png_path ? resolve(ROOT, asset.png_path) : pathsJSON.png_path; uploadKind = "photo"; }
  if (!uploadPath) return { ok: false, reason: `no_${uploadKind}_path` };
  if (!existsSync(uploadPath)) return { ok: false, reason: `${uploadKind}_missing_on_disk`, path: uploadPath };

  const hashtags = asset.hashtags ? (typeof asset.hashtags === "string" ? JSON.parse(asset.hashtags) : asset.hashtags) : [];
  const purpose = asset.purpose || "(no purpose set)";
  const suggestedAt = asset.suggested_post_at;
  const suggestedHuman = suggestedAt ? new Date(suggestedAt).toLocaleString("en-CA", { weekday: "short", hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" }) : "(unscheduled)";

  // Telegram caption limit is 1024 chars for media. We exceed easily — strategy:
  // caption holds the META block (purpose + meta + asset_id + hint), and post_text
  // is sent as a follow-up text message (linked by replying to the media message).
  // This way the user sees the visual + 1-line purpose immediately, then the full text below.

  const escapeHtml = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const captionHeader =
    `<b>📦 Content Department · ${asset_level.toUpperCase()}</b>\n` +
    `\n` +
    `🎯 <b>${escapeHtml(purpose).slice(0, 200)}</b>\n` +
    `\n` +
    `⏰ ${escapeHtml(suggestedHuman)}\n` +
    `🎨 ${escapeHtml(asset.template_type || "?")} · ${escapeHtml(asset.accent_color || "cyan")}\n` +
    (asset.judge_score ? `🏆 judge ${(asset.judge_score * 40).toFixed(0)}/40\n` : "") +
    `\n📝 Post text follows ↓\n` +
    `🆔 <code>${asset.id}</code>`;

  const reply_markup = {
    inline_keyboard: [
      [{ text: "✅ Publish", callback_data: `c:a:${tok}` }, { text: "✏️ Edit text", callback_data: `c:t:${tok}` }],
      [{ text: "🖼️ Edit visual", callback_data: `c:v:${tok}` }, { text: "⏰ Schedule", callback_data: `c:s:${tok}` }],
      [{ text: "❌ Skip", callback_data: `c:r:${tok}` }, { text: "🎲 Regen", callback_data: `c:g:${tok}` }],
    ],
  };

  // Step 1: send media with header caption + buttons
  const mediaResult = uploadKind === "video"
    ? await tgSendVideo({ chat_id, video_path: uploadPath, caption: captionHeader, reply_markup, token })
    : await tgSendPhoto({ chat_id, photo_path: uploadPath, caption: captionHeader, reply_markup, token });
  if (!mediaResult.ok) return { ok: false, reason: "tg_media_send_failed", description: mediaResult.description };

  const mediaMsgId = mediaResult.result?.message_id;

  // Step 2: send the full post text + hashtags as follow-up reply (no buttons, just text)
  const postBody =
    `<b>📝 LinkedIn copy</b> (ready to paste)\n\n` +
    `<pre>${escapeHtml(asset.post_text)}</pre>\n\n` +
    `<b>🏷️</b> ${hashtags.join(" ")}`;

  // Telegram message limit is 4096; truncate post text portion safely if needed
  const safeBody = postBody.length > 4000 ? postBody.slice(0, 3990) + "\n…[truncated]" : postBody;

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id,
        text: safeBody,
        parse_mode: "HTML",
        reply_to_message_id: mediaMsgId,
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    // Don't fail the whole dispatch on follow-up send error; media + buttons already delivered
    console.error("[unified-card] follow-up text send failed:", e.message);
  }

  updateAsset(asset.id, { status: "pending_approval", telegram_message_id: mediaMsgId });
  return { ok: true, message_id: mediaMsgId, chat_id, upload_kind: uploadKind, follow_up_sent: true };
}

/**
 * Called from webhook-server when Telegram sends callback_query.
 * Handles 6 actions: approve | edit_text | edit_visual | schedule | reject | regen.
 */
export async function handleCallback({ callback_query }) {
  const env = envMap();
  const token = env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
  if (!token || !callback_query?.data) return { ok: false, reason: "invalid_callback" };

  // Support both legacy (content:approve:<full_id>) and new compact (c:<a|t|v|s|r|g>:<token>).
  let action, asset;
  const parts = callback_query.data.split(":");
  if (parts[0] === "c" && parts.length === 3) {
    const shortAction = parts[1];
    const map = { a: "approve", t: "edit_text", v: "edit_visual", s: "schedule", r: "reject", g: "regen", e: "edit" };
    action = map[shortAction] || shortAction;
    asset = getByCallbackToken(parts[2]);
  } else if (parts[0] === "content" && parts.length === 3) {
    action = parts[1];
    asset = getAsset(parts[2]);
  } else {
    return { ok: false, reason: "unrecognized_callback_shape" };
  }

  const callback_query_id = callback_query.id;
  const chat_id = callback_query.message?.chat?.id;
  const message_id = callback_query.message?.message_id;

  if (!asset) {
    await tgAnswerCallback({ callback_query_id, text: "Asset not found (deleted?)", token });
    return { ok: false, reason: "asset_not_found" };
  }
  const asset_id = asset.id;

  let toast = "";
  let newStatus = null;

  switch (action) {
    case "approve":
      newStatus = "approved";
      toast = "✅ Approved — ready to publish to " + (asset.channel || "LinkedIn");
      break;
    case "reject":
      newStatus = "rejected";
      toast = "❌ Rejected — won't be published";
      break;
    case "edit":
      newStatus = "edit_requested";
      toast = "✏️ Edit requested — open " + (asset.asset_dir || "asset dir") + "/brief.json";
      break;
    case "edit_text":
      newStatus = "edit_text_requested";
      toast = "✏️ Edit text — open " + (asset.asset_dir || "asset dir") + "/brief.json (post_text in DB)";
      break;
    case "edit_visual":
      newStatus = "regen_visual_requested";
      toast = "🖼️ Will regenerate visual on next tick";
      break;
    case "schedule":
      newStatus = "schedule_requested";
      toast = "⏰ Schedule requested — reply with ISO time or 'tomorrow 9am'";
      break;
    case "regen":
      newStatus = "regen_requested";
      toast = "🎲 Regen requested — run visual-agent again on same idea";
      break;
    default:
      await tgAnswerCallback({ callback_query_id, text: "Unknown action", token });
      return { ok: false, reason: "unknown_action" };
  }

  updateAsset(asset_id, { status: newStatus });
  await tgAnswerCallback({ callback_query_id, text: toast, token });
  // Remove buttons after decision so they can't be clicked twice
  await tgEditMessageReplyMarkup({ chat_id, message_id, reply_markup: { inline_keyboard: [[{ text: `Decided: ${action}`, callback_data: "content:noop" }]] }, token });

  return { ok: true, action, asset_id, new_status: newStatus };
}

// CLI: `node tg-approval.mjs send <asset_id>`
if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2];
  const arg = process.argv[3];
  if (cmd === "send" && arg) {
    sendAssetForApproval({ asset_id: arg }).then(r => {
      console.log(JSON.stringify(r, null, 2));
      process.exit(r.ok ? 0 : 1);
    });
  } else {
    console.error("Usage: tg-approval.mjs send <asset_id>");
    process.exit(2);
  }
}
