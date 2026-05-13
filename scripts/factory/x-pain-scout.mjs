/**
 * x-pain-scout.mjs
 *
 * X/Twitter lead discovery for Kirill.
 * Twitter API is 402 (credits depleted). Brave can't index tweets.
 * So this bot sends Kirill READY-TO-CLICK X search links via Telegram
 * every morning + afternoon. Kirill opens, scrolls, replies.
 *
 * Runs 2x/day via sonnet-bots-daemon (9AM + 3PM Calgary).
 * Built April 14 2026 after Kirill got X Premium.
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readWiki, readPurpose, appendLog } from "../../wiki/reader.mjs";
const _purpose = readPurpose();

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const env = Object.fromEntries(
  readFileSync(resolve(ROOT, "apps/api/.env"), "utf-8").split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const TG = env.TELEGRAM_BOT_TOKEN, CHAT = env.TELEGRAM_CHAT_ID;

// X search URLs - click to open in browser/app with results
// Each query targets ICP pain signals from the last week
const SEARCHES = [
  {
    label: "Founders looking for automation help",
    query: '"looking for" (automation OR n8n OR workflow) (expert OR developer OR consultant) -job -hiring -apply',
  },
  {
    label: "Solo SaaS stuck on first customers",
    query: '("solo founder" OR "indie hacker" OR "built my saas") ("no users" OR "no customers" OR "first customer" OR "no traction" OR stuck)',
  },
  {
    label: "Vibe coders who broke production",
    query: '("vibe coded" OR "vibe coding" OR "cursor" OR "lovable") (broke OR bug OR crash OR help OR "production issue" OR "need developer")',
  },
  {
    label: "DM me - automation/workflow paid gigs",
    query: '("dm me" OR "dm open" OR "paid" OR "hire") (automation OR workflow OR n8n OR "ai agent") -crypto -nft',
  },
  {
    label: "SaaS founders needing sales motion",
    query: '("just launched" OR "launched my" OR "shipped") saas ("how to get" OR "finding customers" OR "first 10" OR "no sales")',
  },
];

function buildSearchUrl(query) {
  // X advanced search with "Latest" tab and recent filter
  return `https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query&f=live`;
}

async function tg(text) {
  if (!TG || !CHAT) return;
  await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: CHAT, text, parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  }).catch(() => {});
}

(async () => {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Утренний" : "Дневной";

  const links = SEARCHES.map((s, i) =>
    `${i + 1}. <b>${s.label}</b>\n<a href="${buildSearchUrl(s.query)}">Открыть поиск X</a>`
  ).join("\n\n");

  const msg = [
    `🐦 <b>${greeting} X-скаутинг</b>`,
    ``,
    `Открой каждую ссылку, посмотри свежие посты, reply с позиции эксперта.`,
    ``,
    links,
    ``,
    `Цель: 3-5 reply за сессию. Текст от себя или попроси у меня драфт.`,
  ].join("\n");

  await tg(msg);
  console.log(`[x-scout] sent ${SEARCHES.length} search links to Telegram`);
})();
