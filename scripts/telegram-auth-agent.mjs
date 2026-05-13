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
  console.log("Авторизация ВТОРОГО аккаунта для Sales Agent...");
  const client = new TelegramClient(stringSession, apiId, apiHash, { connectionRetries: 5 });

  await client.start({
    phoneNumber: async () => await ask("Номер телефона второго аккаунта (с +): "),
    password: async () => await ask("2FA пароль (если есть, иначе Enter): "),
    phoneCode: async () => await ask("Код из Telegram: "),
    onError: (err) => console.log("Error:", err),
  });

  console.log("Авторизация успешна!");
  const session = client.session.save();
  writeFileSync("$CLAUDE_PROJECT_DIR/.data/telegram-session-agent.txt", session);
  console.log("Session сохранена в .data/telegram-session-agent.txt");

  await client.disconnect();
  rl.close();
})();
