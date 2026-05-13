/**
 * Telegram Setup — get your Chat ID automatically
 *
 * Steps:
 * 1. Open Telegram, find your bot: @<bot_username>
 * 2. Send /start to the bot
 * 3. Run: node scripts/telegram-setup.mjs
 * 4. The script will print your Chat ID and save it to .env
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const envPath = resolve(__dirname, "../apps/api/.env");
const env = Object.fromEntries(
  readFileSync(envPath, "utf-8")
    .split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => {
      const idx = l.indexOf("=");
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
    })
);

const BOT_TOKEN = env.TELEGRAM_BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error("❌ TELEGRAM_BOT_TOKEN not found in .env");
  process.exit(1);
}

console.log("\n🔍 Looking for messages sent to your bot...");
console.log("   (Make sure you sent /start to the bot first)\n");

const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getUpdates`);
const data = await res.json();

if (!data.ok) {
  console.error("❌ Telegram API error:", data.description);
  process.exit(1);
}

if (!data.result || data.result.length === 0) {
  console.log("⚠️  No messages found.");
  console.log("   Please open Telegram, find your bot, and send /start");
  console.log("   Then run this script again.");
  process.exit(0);
}

// Find the chat ID from most recent message
const update = data.result[data.result.length - 1];
const chat = update.message?.chat || update.channel_post?.chat;

if (!chat) {
  console.log("⚠️  Could not find chat info in updates.");
  console.log("   Raw update:", JSON.stringify(update, null, 2));
  process.exit(1);
}

const chatId = String(chat.id);
const chatName = chat.title || chat.first_name || chat.username || "Unknown";

console.log(`✅ Found chat!`);
console.log(`   Chat ID: ${chatId}`);
console.log(`   Chat name: ${chatName}`);
console.log(`   Type: ${chat.type}\n`);

// Save to .env
const envContent = readFileSync(envPath, "utf-8");
const updated = envContent.replace(
  /^TELEGRAM_CHAT_ID=.*$/m,
  `TELEGRAM_CHAT_ID=${chatId}`
);
writeFileSync(envPath, updated);

console.log(`💾 Saved TELEGRAM_CHAT_ID=${chatId} to apps/api/.env`);
console.log(`\n✅ Setup complete! Now run:`);
console.log(`   node scripts/telegram-deliver.mjs`);
