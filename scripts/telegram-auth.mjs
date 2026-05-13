import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import readline from "readline";
import { writeFileSync } from "fs";

const apiId = 30737337;
const apiHash = "f16037544f47153b6b5c218ba99b84ee";
const stringSession = new StringSession("");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(resolve => rl.question(q, resolve));

(async () => {
  console.log("Connecting to Telegram...");
  const client = new TelegramClient(stringSession, apiId, apiHash, { connectionRetries: 5 });

  await client.start({
    phoneNumber: async () => await ask("Введи номер телефона (с +): "),
    password: async () => await ask("Введи 2FA пароль (если есть): "),
    phoneCode: async () => await ask("Введи код из Telegram: "),
    onError: (err) => console.log("Error:", err),
  });

  console.log("Авторизация успешна!");
  const session = client.session.save();

  // Save session to .env
  writeFileSync("$CLAUDE_PROJECT_DIR/.data/telegram-session.txt", session);
  console.log("Session сохранена в .data/telegram-session.txt");
  console.log("Теперь бот может работать автономно без повторной авторизации.");

  await client.disconnect();
  rl.close();
})();
