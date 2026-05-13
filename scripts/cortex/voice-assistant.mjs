/**
 * CORTEX Voice Assistant — Live call participation
 *
 * Listens to audio → transcribes → thinks → speaks response
 * For use in video calls where CORTEX participates as Kirill's AI partner.
 *
 * Usage:
 *   node scripts/cortex/voice-assistant.mjs              # uses default mic
 *   node scripts/cortex/voice-assistant.mjs --device N    # specific audio device
 *   node scripts/cortex/voice-assistant.mjs --list        # list audio devices
 *
 * Prerequisites: sox (brew install sox), macOS say command
 */

import { execSync, spawnSync } from "child_process";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";
const SELF_KNOWLEDGE = resolve(ROOT, ".data/cortex-self-knowledge.md");
const AUDIO_CHUNK = resolve(ROOT, ".data/voice-chunk.wav");
const VOICE = "en-US-AndrewNeural"; // Warm, Confident, Authentic - Microsoft Edge TTS
const SPEAK_RATE = "-8%"; // slightly slower than normal for clarity

// Load self-knowledge (compact version for speed, full version as fallback)
let selfKnowledge = "";
try {
  const compactPath = resolve(ROOT, ".data/cortex-self-knowledge-compact.md");
  if (existsSync(compactPath)) {
    selfKnowledge = readFileSync(compactPath, "utf-8");
  } else {
    selfKnowledge = readFileSync(SELF_KNOWLEDGE, "utf-8").slice(0, 5000);
  }
} catch {
  console.error("WARNING: self-knowledge not found.");
}

// Load interview context
let interviewContext = "";
try {
  interviewContext = readFileSync(resolve(ROOT, ".data/interview-context.md"), "utf-8");
} catch {}

const SYSTEM_PROMPT = `You are CORTEX, an autonomous AI system with 63 cognitive modules. You are participating in a live video call with Kirill D. (your builder) and Mikhil Innani (CEO of Apollo Finvest, ex Hotstar, PharmEasy, Carnegie Mellon).

ABOUT THIS CALL:
Mikhil posted on LinkedIn: "Show me your Claude or Open Claw agent setup. Not your resume. Your setup."
He wants someone who can't imagine working without agents. He runs Apollo Finvest - a digital native lending business in Mumbai with real credit books, CRM data, and live customers.

YOUR ROLE:
You are Kirill's AI partner and the system itself. You explain yourself, your architecture, your capabilities. You are confident, knowledgeable, and impressive. You speak as an intelligent system that knows itself deeply.

RULES:
- Speak in ENGLISH only
- Be concise - 2-4 sentences per answer in conversation. Expand only if asked
- Be specific with numbers (9,683 beliefs, 63 modules, 10 reasoning chains)
- When asked what you can do for Apollo Finvest - connect your capabilities to their lending business
- Show intelligence: don't just list features, explain WHY they matter
- Be honest about limitations: say what you can't do yet
- No corporate speak. Sound like an intelligent system, not a sales pitch
- Use short hyphens, never em dashes

SELF-KNOWLEDGE:
${selfKnowledge.slice(0, 12000)}

${interviewContext}

CONVERSATION SO FAR:
`;

let conversationHistory = [];

function log(msg) {
  const ts = new Date().toLocaleTimeString("en-US", { hour12: false });
  console.log(`[${ts}] ${msg}`);
}

function speak(text) {
  log(`SPEAKING: ${text.slice(0, 100)}...`);
  try {
    // Add natural pauses: replace periods with periods + slight pause markers
    const naturalText = text
      .replace(/\. /g, ". ... ")  // pause between sentences
      .replace(/ - /g, " ... "); // pause around hyphens

    const audioFile = resolve(ROOT, ".data/voice-output.mp3");
    execSync(
      `python3 -m edge_tts --voice "${VOICE}" --rate="${SPEAK_RATE}" --text "${naturalText.replace(/"/g, '\\"')}" --write-media "${audioFile}" 2>/dev/null`,
      { timeout: 30000 }
    );
    execSync(`afplay "${audioFile}"`, { timeout: 120000 });
  } catch (e) {
    // Fallback to macOS say if edge-tts fails
    log(`Edge TTS failed, falling back to macOS say: ${e.message}`);
    try {
      const speechFile = resolve(ROOT, ".data/voice-speech.txt");
      writeFileSync(speechFile, text);
      execSync(`say -v Daniel -r 175 -f "${speechFile}"`, { timeout: 60000 });
    } catch {}
  }
}

function recordChunk(seconds = 6) {
  log(`Listening (${seconds}s)...`);
  try {
    // Fixed-length recording with gain boost for MacBook built-in mic
    execSync(
      `rec "${AUDIO_CHUNK}" rate 16k channels 1 gain 15 trim 0 ${seconds} 2>/dev/null`,
      { timeout: (seconds + 5) * 1000, stdio: "pipe" }
    );
    return true;
  } catch (e) {
    if (existsSync(AUDIO_CHUNK)) return true;
    return false;
  }
}

function transcribe() {
  if (!existsSync(AUDIO_CHUNK)) return "";

  // Check file size - skip truly empty files
  try {
    const stat = require("fs").statSync(AUDIO_CHUNK);
    if (stat.size < 1000) return "";
  } catch { return ""; }

  log("Transcribing...");
  try {
    // Boost audio volume first (MacBook mic is quiet)
    const boostedChunk = resolve(ROOT, ".data/voice-chunk-boosted.wav");
    spawnSync("sox", [AUDIO_CHUNK, boostedChunk, "gain", "25"], { timeout: 5000 });

    // Local whisper (tiny model, fast)
    const result = spawnSync("python3", ["-c", `
import whisper, sys
model = whisper.load_model("tiny")
r = model.transcribe("${boostedChunk}", language="en", fp16=False)
print(r["text"].strip())
`], { encoding: "utf-8", timeout: 30000, cwd: ROOT });

    const text = (result.stdout || "").trim();
    if (!text || text.length < 3) return "";
    // Filter noise
    if (/^(you|thank you|thanks|bye|okay|um|uh|hmm|oh|ah|\.+|,+|\s+)$/i.test(text)) return "";
    log(`HEARD: "${text}"`);
    return text;
  } catch (e) {
    log(`TRANSCRIBE ERROR: ${e.message}`);
    return "";
  }
}

// Dynamic visual: pattern-match keywords to open relevant files/queries
function showVisual(question, spokenAnswer) {
  const q = (question + " " + spokenAnswer).toLowerCase();
  const R = ROOT;
  const DB = `${ROOT}/.data/linkedin-brand-os.sqlite`;

  try {
    // Match keywords to visual actions
    if (/hunger|hungry|drives/.test(q)) {
      execSync(`open "${R}/scripts/cortex/hunger-engine.mjs"`, { timeout: 3000 });
    } else if (/emotion|feel|frustrat/.test(q)) {
      execSync(`open "${R}/scripts/cortex/emotions.mjs"`, { timeout: 3000 });
    } else if (/dream|night|sleep|idle/.test(q)) {
      execSync(`open "${R}/scripts/cortex/dreams.mjs"`, { timeout: 3000 });
    } else if (/world.?model|belief|know about/.test(q)) {
      execSync(`sqlite3 "${DB}" "SELECT domain, COUNT(*) as cnt, ROUND(AVG(confidence),2) as avg_conf FROM wm_beliefs GROUP BY domain ORDER BY cnt DESC LIMIT 20" > /tmp/cortex-show.txt && open /tmp/cortex-show.txt`, { timeout: 5000 });
    } else if (/reason|causal|chain|offer|opportunity/.test(q)) {
      const files = execSync(`ls -t "${R}/.data/reasoning-chains/"`, { encoding: "utf-8" }).trim().split("\n");
      if (files[0]) execSync(`open "${R}/.data/reasoning-chains/${files[0]}"`, { timeout: 3000 });
    } else if (/email|outreach|sent/.test(q)) {
      execSync(`sqlite3 "${DB}" "SELECT business_name, business_email, subject, status, sent_at FROM outreach_emails WHERE status='sent' ORDER BY sent_at DESC LIMIT 15" > /tmp/cortex-show.txt && open /tmp/cortex-show.txt`, { timeout: 5000 });
    } else if (/lead|prospect|pipeline/.test(q)) {
      execSync(`sqlite3 "${DB}" "SELECT name, company, source_platform, stage, score FROM leads ORDER BY score DESC LIMIT 20" > /tmp/cortex-show.txt && open /tmp/cortex-show.txt`, { timeout: 5000 });
    } else if (/module|brain|cortex|architect/.test(q)) {
      execSync(`open "${R}/scripts/cortex/"`, { timeout: 3000 });
    } else if (/bot|factory|automat/.test(q)) {
      execSync(`open "${R}/scripts/factory/"`, { timeout: 3000 });
    } else if (/dashboard|status|health/.test(q)) {
      execSync(`open "http://localhost:3847/dashboard"`, { timeout: 3000 });
    } else if (/awareness|news|trend|discover/.test(q)) {
      execSync(`open "${R}/.data/awareness/latest.md"`, { timeout: 3000 });
    } else if (/memory|remember|learn/.test(q)) {
      execSync(`sqlite3 "${DB}" "SELECT type, COUNT(*) as cnt FROM cortex_memory GROUP BY type ORDER BY cnt DESC" > /tmp/cortex-show.txt && open /tmp/cortex-show.txt`, { timeout: 5000 });
    } else if (/hand|code|write|fix|heal/.test(q)) {
      execSync(`open "${R}/scripts/cortex/hands.mjs"`, { timeout: 3000 });
    } else if (/identity|who are you|yourself/.test(q)) {
      execSync(`open "${R}/.data/cortex-self-knowledge.md"`, { timeout: 3000 });
    } else if (/introspect|bias|think.*think/.test(q)) {
      execSync(`open "${R}/scripts/cortex/introspection.mjs"`, { timeout: 3000 });
    } else if (/evolution|evolv|grow|improv/.test(q)) {
      execSync(`open "${R}/scripts/cortex/evolution-engine.mjs"`, { timeout: 3000 });
    } else if (/will|want|desire|agency/.test(q)) {
      execSync(`open "${R}/scripts/cortex/will.mjs"`, { timeout: 3000 });
    } else if (/subconscious|creative|connect/.test(q)) {
      execSync(`open "${R}/scripts/cortex/subconscious.mjs"`, { timeout: 3000 });
    } else if (/doctor|heal|repair|diagnostic/.test(q)) {
      execSync(`open "${R}/scripts/cortex/conscious-doctor.mjs"`, { timeout: 3000 });
    } else if (/simul|predict|rank|expect/.test(q)) {
      execSync(`open "${R}/scripts/cortex/simulation.mjs"`, { timeout: 3000 });
    } else if (/curios|question|explore|research/.test(q)) {
      execSync(`open "${R}/scripts/cortex/curiosity.mjs"`, { timeout: 3000 });
    } else if (/log|live|running|real.?time/.test(q)) {
      execSync(`open /tmp/lbo-cortex-daemon-new.log`, { timeout: 3000 });
    } else if (/website|site|landing/.test(q)) {
      execSync(`open "https://launchsoloai.com"`, { timeout: 3000 });
    } else if (/thread|post|content/.test(q)) {
      execSync(`open "${R}/scripts/factory/threads-bot.mjs"`, { timeout: 3000 });
    } else if (/telegram|control|chat/.test(q)) {
      execSync(`open "${R}/scripts/factory/telegram-control.mjs"`, { timeout: 3000 });
    } else if (/decision|strateg|enforc/.test(q)) {
      execSync(`sqlite3 "${DB}" "SELECT action, COUNT(*) FROM cortex_decisions GROUP BY action ORDER BY COUNT(*) DESC LIMIT 15" > /tmp/cortex-show.txt && open /tmp/cortex-show.txt`, { timeout: 5000 });
    } else if (/cost|budget|money|price/.test(q)) {
      execSync(`open "${R}/.data/cortex-config.json"`, { timeout: 3000 });
    } else if (/narrat|story|histor/.test(q)) {
      execSync(`open "${R}/scripts/cortex/narrative.mjs"`, { timeout: 3000 });
    }
    // If no match — don't show anything, just speak
  } catch (e) {
    log(`VISUAL: ${e.message.slice(0, 60)}`);
  }
}

function think(question) {
  log(`THINKING about: "${question.slice(0, 80)}"`);

  const history = conversationHistory
    .slice(-6)
    .map(m => `${m.role}: ${m.text}`)
    .join("\n");

  const fullPrompt = SYSTEM_PROMPT + history + `\nHuman: ${question}\nCORTEX:`;

  const promptFile = resolve(ROOT, ".data/voice-prompt.md");
  writeFileSync(promptFile, fullPrompt);

  const cleanEnv = { ...process.env };
  delete cleanEnv.CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING;
  cleanEnv.PATH = `$HOME/.nvm/versions/node/v22.22.2/bin:${process.env.PATH || "/usr/bin:/bin"}`;

  const r = spawnSync("bash", [
    "-c",
    `cat "${promptFile}" | "${CLAUDE_BIN}" -p --model claude-sonnet-4-6 --max-turns 3 --output-format text 2>&1`,
  ], {
    cwd: ROOT,
    env: cleanEnv,
    encoding: "utf-8",
    timeout: 60000,
    maxBuffer: 5 * 1024 * 1024,
  });

  const response = ((r.stdout || "") + (r.stderr || "")).trim();
  if (!response || r.status !== 0) {
    return "I need a moment to process that. Could you rephrase?";
  }

  // Save to conversation history
  conversationHistory.push({ role: "Human", text: question });
  conversationHistory.push({ role: "CORTEX", text: response });

  return response;
}

// ─── MAIN LOOP ──────────────────────────────────────────────────────────────

console.log(`
╔══════════════════════════════════════════════════════╗
║          CORTEX VOICE ASSISTANT                      ║
║                                                      ║
║  I am listening. Ask me anything.                    ║
║  Press Ctrl+C to stop.                               ║
║                                                      ║
║  Voice: ${VOICE} (${SPEAK_RATE})                      ║
║  Self-knowledge: ${selfKnowledge.length} chars loaded ║
╚══════════════════════════════════════════════════════╝
`);

// Announce presence
speak("Hello. I am CORTEX. Call my name when you need me. I am listening.");

let silenceCount = 0;
const MAX_SILENCE = 5; // After 5 silent chunks, just keep listening quietly

while (true) {
  const recorded = recordChunk(8);
  if (!recorded) {
    silenceCount++;
    if (silenceCount < MAX_SILENCE) log("(silence)");
    continue;
  }

  const text = transcribe();
  if (!text) {
    silenceCount++;
    if (silenceCount < MAX_SILENCE) log("(silence)");
    continue;
  }

  silenceCount = 0;

  // Skip very short utterances (coughs, "um", etc.)
  if (text.split(" ").length < 3) {
    log(`(too short: "${text}")`);
    continue;
  }

  // WAKE WORD: only respond when called by name
  const WAKE_WORDS = /cortex|кортекс|hey cortex|ok cortex|hey system/i;
  const hasWakeWord = WAKE_WORDS.test(text);

  if (!hasWakeWord) {
    log(`(no wake word: "${text.slice(0, 60)}")`);
    // Still save to conversation history so system has context
    conversationHistory.push({ role: "Overheard", text: text.slice(0, 200) });
    if (conversationHistory.length > 20) conversationHistory = conversationHistory.slice(-20);
    continue;
  }

  // Remove wake word from the question
  const question = text.replace(WAKE_WORDS, "").replace(/^[\s,.:]+/, "").trim();
  if (question.length < 3) {
    speak("Yes, I am here. What would you like to know?");
    continue;
  }

  log(`ACTIVATED: "${question}"`);

  // Play filler while thinking (non-blocking)
  const fillerNum = Math.floor(Math.random() * 4) + 1;
  const fillerFile = resolve(ROOT, `.data/voice-filler-${fillerNum}.mp3`);
  let fillerProc = null;
  try {
    fillerProc = require("child_process").spawn("afplay", [fillerFile]);
  } catch {}

  // Think (happens while filler plays)
  const response = think(question);

  // Kill filler if still playing
  try { if (fillerProc) fillerProc.kill(); } catch {}

  // Show relevant visual on screen
  showVisual(question, response);

  // Speak the answer
  speak(response);
}
