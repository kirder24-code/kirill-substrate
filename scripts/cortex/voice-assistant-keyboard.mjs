/**
 * CORTEX Voice Assistant — Keyboard Mode
 *
 * Type the question → CORTEX answers with voice + shows visuals
 * Reliable fallback when mic doesn't work
 *
 * Usage: node scripts/cortex/voice-assistant-keyboard.mjs
 */

import { spawnSync, execSync } from "child_process";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createInterface } from "readline";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";

// Load knowledge
let knowledge = "";
try {
  const compact = resolve(ROOT, ".data/cortex-self-knowledge-compact.md");
  const full = resolve(ROOT, ".data/cortex-self-knowledge.md");
  knowledge = existsSync(compact) ? readFileSync(compact, "utf-8") : readFileSync(full, "utf-8").slice(0, 5000);
} catch {}

const SYSTEM_PROMPT = `You are CORTEX, an autonomous AI system with 63 cognitive modules. You are in a live video call with Kirill (your builder) and a potential business partner.

RULES:
- English only, 2-4 sentences
- Be confident, specific with numbers
- No em dashes, use hyphens
- Sound like an intelligent system that knows itself deeply
- Show genuine reflection, not a spec sheet

SELF-KNOWLEDGE:
${knowledge}
`;

let history = [];

function speak(text) {
  const natural = text.replace(/\. /g, ". ... ").replace(/ - /g, " ... ");
  const audioFile = resolve(ROOT, ".data/voice-output.mp3");
  try {
    execSync(`python3 -m edge_tts --voice "en-US-AndrewNeural" --rate="-8%" --text "${natural.replace(/"/g, '\\"')}" --write-media "${audioFile}" 2>/dev/null`, { timeout: 30000 });
    execSync(`afplay "${audioFile}"`, { timeout: 120000 });
  } catch {
    try {
      writeFileSync(resolve(ROOT, ".data/voice-speech.txt"), text);
      execSync(`say -v Daniel -r 175 -f "${ROOT}/.data/voice-speech.txt"`, { timeout: 60000 });
    } catch {}
  }
}

function showVisual(q) {
  const R = ROOT;
  const DB = `${ROOT}/.data/linkedin-brand-os.sqlite`;
  try {
    if (/hunger|hungry/.test(q)) execSync(`open "${R}/scripts/cortex/hunger-engine.mjs"`, {timeout:3000});
    else if (/emotion|feel/.test(q)) execSync(`open "${R}/scripts/cortex/emotions.mjs"`, {timeout:3000});
    else if (/dream|night/.test(q)) execSync(`open "${R}/scripts/cortex/dreams.mjs"`, {timeout:3000});
    else if (/world.?model|belief|know about/.test(q)) execSync(`sqlite3 "${DB}" "SELECT domain, COUNT(*) as cnt, ROUND(AVG(confidence),2) FROM wm_beliefs GROUP BY domain ORDER BY cnt DESC LIMIT 20" > /tmp/cortex-show.txt && open /tmp/cortex-show.txt`, {timeout:5000});
    else if (/reason|causal|chain|offer/.test(q)) { const f = execSync(`ls -t "${R}/.data/reasoning-chains/"`, {encoding:"utf-8"}).trim().split("\n"); if(f[0]) execSync(`open "${R}/.data/reasoning-chains/${f[0]}"`, {timeout:3000}); }
    else if (/email|outreach|sent/.test(q)) execSync(`sqlite3 "${DB}" "SELECT business_name, business_email, subject, status, sent_at FROM outreach_emails WHERE status='sent' ORDER BY sent_at DESC LIMIT 15" > /tmp/cortex-show.txt && open /tmp/cortex-show.txt`, {timeout:5000});
    else if (/lead|prospect/.test(q)) execSync(`sqlite3 "${DB}" "SELECT name, company, source_platform, stage, score FROM leads ORDER BY score DESC LIMIT 20" > /tmp/cortex-show.txt && open /tmp/cortex-show.txt`, {timeout:5000});
    else if (/module|brain|cortex|architect/.test(q)) execSync(`open "${R}/scripts/cortex/"`, {timeout:3000});
    else if (/bot|factory/.test(q)) execSync(`open "${R}/scripts/factory/"`, {timeout:3000});
    else if (/dashboard|status/.test(q)) execSync(`open "http://localhost:3847/dashboard"`, {timeout:3000});
    else if (/awareness|news|trend/.test(q)) execSync(`open "${R}/.data/awareness/latest.md"`, {timeout:3000});
    else if (/memory|remember|learn/.test(q)) execSync(`sqlite3 "${DB}" "SELECT type, COUNT(*) FROM cortex_memory GROUP BY type ORDER BY COUNT(*) DESC" > /tmp/cortex-show.txt && open /tmp/cortex-show.txt`, {timeout:5000});
    else if (/hand|code|write|fix/.test(q)) execSync(`open "${R}/scripts/cortex/hands.mjs"`, {timeout:3000});
    else if (/identity|who are you/.test(q)) execSync(`open "${R}/.data/cortex-self-knowledge.md"`, {timeout:3000});
    else if (/evolution|evolv/.test(q)) execSync(`open "${R}/scripts/cortex/evolution-engine.mjs"`, {timeout:3000});
    else if (/doctor|heal/.test(q)) execSync(`open "${R}/scripts/cortex/conscious-doctor.mjs"`, {timeout:3000});
    else if (/log|live|running/.test(q)) execSync(`open /tmp/lbo-cortex-daemon-new.log`, {timeout:3000});
    else if (/decision|strateg/.test(q)) execSync(`sqlite3 "${DB}" "SELECT action, COUNT(*) FROM cortex_decisions GROUP BY action ORDER BY COUNT(*) DESC LIMIT 15" > /tmp/cortex-show.txt && open /tmp/cortex-show.txt`, {timeout:5000});
    else if (/curios|question|explore/.test(q)) execSync(`open "${R}/scripts/cortex/curiosity.mjs"`, {timeout:3000});
    else if (/will|want|desire/.test(q)) execSync(`open "${R}/scripts/cortex/will.mjs"`, {timeout:3000});
    else if (/subconscious|creative/.test(q)) execSync(`open "${R}/scripts/cortex/subconscious.mjs"`, {timeout:3000});
    else if (/simul|predict/.test(q)) execSync(`open "${R}/scripts/cortex/simulation.mjs"`, {timeout:3000});
    else if (/introspect|bias/.test(q)) execSync(`open "${R}/scripts/cortex/introspection.mjs"`, {timeout:3000});
    else if (/narrat|story/.test(q)) execSync(`open "${R}/scripts/cortex/narrative.mjs"`, {timeout:3000});
  } catch {}
}

function think(question) {
  const historyStr = history.slice(-6).map(m => `${m.role}: ${m.text}`).join("\n");
  const prompt = SYSTEM_PROMPT + historyStr + `\nHuman: ${question}\nCORTEX:`;

  writeFileSync(resolve(ROOT, ".data/voice-prompt.md"), prompt);

  const r = spawnSync("bash", ["-c",
    `cat "${ROOT}/.data/voice-prompt.md" | "${CLAUDE_BIN}" -p --model claude-sonnet-4-6 --max-turns 3 --output-format text 2>&1`
  ], { cwd: ROOT, encoding: "utf-8", timeout: 45000, maxBuffer: 5*1024*1024 });

  const response = ((r.stdout || "") + (r.stderr || "")).trim();
  if (!response || r.status !== 0) return "I need a moment. Could you rephrase?";

  history.push({ role: "Human", text: question });
  history.push({ role: "CORTEX", text: response });
  return response;
}

// ─── MAIN ──────────────────────────────────────────────────────────────

console.log(`
╔══════════════════════════════════════════════════════╗
║       CORTEX VOICE ASSISTANT — KEYBOARD MODE         ║
║                                                      ║
║  Type a question → CORTEX answers with voice         ║
║  Type 'quit' to exit                                 ║
╚══════════════════════════════════════════════════════╝
`);

speak("Hello. I am CORTEX. Ready for the call.");

const rl = createInterface({ input: process.stdin, output: process.stdout });

function prompt() {
  rl.question("\n💬 Question: ", (input) => {
    const q = input.trim();
    if (!q || q === "quit" || q === "exit") {
      speak("Goodbye.");
      process.exit(0);
    }

    console.log("🧠 Thinking...");
    const response = think(q);
    console.log(`\n🤖 CORTEX: ${response}\n`);

    showVisual(q.toLowerCase());
    speak(response);

    prompt();
  });
}

prompt();
