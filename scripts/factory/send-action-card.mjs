/**
 * send-action-card.mjs — ONE function for ALL Telegram action cards
 *
 * Every bot that needs to send a card to Kirill uses this.
 * Guarantees: buttons always work, Reddit posts auto-registered,
 * conversations auto-tracked, cards auto-deleted on action.
 *
 * Usage:
 *   import { sendActionCard } from "./send-action-card.mjs";
 *
 *   // Reddit comment card
 *   await sendActionCard({
 *     type: "reddit_comment",
 *     threadUrl: "https://reddit.com/r/SaaS/comments/...",
 *     subreddit: "SaaS",
 *     title: "Thread title",
 *     draft: "Comment text here\n\n- Kirill, Calgary",
 *     pain: "prospect's pain signal",
 *   });
 *
 *   // Field kit card
 *   await sendActionCard({
 *     type: "field_kit",
 *     title: "ACCOUNTING FIRM FIELD KIT",
 *     body: "Target: firms hiring bookkeepers...",
 *   });
 *
 *   // Generic action card
 *   await sendActionCard({
 *     type: "action",
 *     title: "Something needs attention",
 *     body: "Details here",
 *   });
 */

import { tgSend, BOTS, CHAT_ID } from "./orchestrator.mjs";

const TOKEN = BOTS.content.token;

export async function sendActionCard(opts) {
  const { type = "action" } = opts;

  switch (type) {
    case "reddit_comment": {
      const { threadUrl, subreddit, title, draft, pain } = opts;
      const cleanDraft = (draft || "")
        .replace(/Live r\/.*$/gm, "")
        .replace(/score \d+.*$/gim, "")
        .replace(/Highest-weight.*$/gim, "")
        .replace(/Breaks \d+-cycle.*$/gim, "")
        .replace(/No direct pitch.*$/gim, "")
        .trim();

      const msg = `<b>POST NOW</b>${subreddit ? ` - r/${subreddit}` : ""}${title ? `\n${title.slice(0, 100)}` : ""}\n\n<code>${cleanDraft.slice(0, 1500)}</code>`;

      const keyboard = { inline_keyboard: [] };
      if (threadUrl) keyboard.inline_keyboard.push([{ text: "Open thread", url: threadUrl }]);
      keyboard.inline_keyboard.push([
        { text: "Posted", callback_data: `card_posted:${(subreddit || "reddit").slice(0, 20)}` },
        { text: "Skip", callback_data: "card_skip" },
      ]);

      await tgSend(TOKEN, CHAT_ID, msg, { parse_mode: "HTML", reply_markup: keyboard });
      return { sent: true, type: "reddit_comment" };
    }

    case "field_kit": {
      const { title, body } = opts;
      const msg = `<b>${(title || "FIELD KIT").slice(0, 100)}</b>\n\n${(body || "").slice(0, 1800)}`;
      await tgSend(TOKEN, CHAT_ID, msg, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [
          [{ text: "Activate kit", callback_data: "cortex_ack" }, { text: "Skip", callback_data: "card_skip" }],
        ]},
      });
      return { sent: true, type: "field_kit" };
    }

    case "action":
    default: {
      const { title, body } = opts;
      const msg = `<b>${(title || "Action needed").slice(0, 100)}</b>\n\n${(body || "").slice(0, 1800)}`;
      await tgSend(TOKEN, CHAT_ID, msg, {
        parse_mode: "HTML",
        reply_markup: { inline_keyboard: [
          [{ text: "OK", callback_data: "card_skip" }],
        ]},
      });
      return { sent: true, type: "action" };
    }
  }
}
