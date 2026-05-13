#!/usr/bin/env node
/**
 * send-cards-to-telegram.mjs
 * Reads validated-recipients-2026-04-20.json and sends
 * one personalized card per lead to Telegram for manual sending.
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { tgSendToKirill } from "../factory/orchestrator.mjs";

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dir, "../..");

const DATA_FILE = resolve(ROOT, "sandbox-review/validated-recipients-2026-04-20.json");

const CATEGORY_EMOJI = {
  "hvac": "🌡️",
  "garage-door": "🚪",
  "roofing": "🏠",
  "plumbing": "🔧",
  "moving-companies": "📦",
  "landscaping": "🌿",
  "cleaning-services": "🧹",
  "auto-repair": "🚗",
  "electrical": "⚡",
};

function emoji(category) {
  return CATEGORY_EMOJI[category] || "📋";
}

function buildCard(artifact, index, total) {
  const {
    business,
    email,
    phone,
    category,
    website,
    subjects,
    short_variant,
    language_preference,
  } = artifact;

  const e = emoji(category);
  const subjectLine = subjects[0];
  const lang = language_preference === "ru" ? "RU" : "EN";

  // Keep short_variant but truncate if too long (we'll send separately)
  const body = short_variant;

  return {
    header: `${e} <b>[${index}/${total}] ${business}</b> [${category}] [${lang}]\n` +
            `📧 ${email}${phone ? `\n📞 ${phone}` : ""}\n` +
            `🔗 ${website || "-"}\n` +
            `📌 Subject: <i>${subjectLine}</i>`,
    body,
  };
}

async function run() {
  const raw = JSON.parse(readFileSync(DATA_FILE, "utf8"));
  const artifacts = raw.artifacts;
  const total = artifacts.length;

  await tgSendToKirill(
    `📬 <b>ПАКЕТ ДЛЯ РУЧНОЙ ОТПРАВКИ — ${total} лидов (Apr 20)</b>\n\n` +
    `Отправляй сегодня. Для каждого — тема и текст письма.\n` +
    `После отправки логируй:\n` +
    `<code>node scripts/outreach/log-lead-outcome.mjs &lt;lead_id&gt; delivered email</code>`
  );

  // Small delay after header
  await sleep(500);

  for (let i = 0; i < artifacts.length; i++) {
    const artifact = artifacts[i];
    const card = buildCard(artifact, i + 1, total);

    // Send header card
    await tgSendToKirill(card.header, { parse_mode: "HTML" });
    await sleep(300);

    // Send email body as separate message (copy-paste ready)
    const bodyMsg = `<code>${escapeHtml(card.body)}</code>`;
    // Telegram limit 4096. body can be long - truncate if needed
    const truncated = bodyMsg.length > 3800
      ? bodyMsg.slice(0, 3800) + "\n...</code>"
      : bodyMsg;

    await tgSendToKirill(truncated, { parse_mode: "HTML" });
    await sleep(400);
  }

  await tgSendToKirill(
    `✅ <b>Все ${total} карточек отправлены.</b>\n\n` +
    `Логируй каждую отправку командой выше. Если нет ответа 3 дня - followup_day3 в том же треде.`
  );
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

run().catch(err => {
  console.error("send-cards-to-telegram error:", err.message);
  process.exit(1);
});
