/**
 * CORTEX Voice Server — Backend for voice-web.html
 *
 * Receives question via HTTP → Claude thinks → Edge TTS generates audio → returns
 *
 * Usage: node scripts/cortex/voice-server.mjs
 * Then open voice-web.html in Chrome
 */

import { createServer } from "http";
import { spawnSync, execSync } from "child_process";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";
const PORT = 3848;

// Load knowledge
let knowledge = "";
try {
  const compact = resolve(ROOT, ".data/cortex-self-knowledge-compact.md");
  const full = resolve(ROOT, ".data/cortex-self-knowledge.md");
  knowledge = existsSync(compact) ? readFileSync(compact, "utf-8") : readFileSync(full, "utf-8").slice(0, 5000);
} catch {}

const SYSTEM_PROMPT = `You are CORTEX, an autonomous AI system with 63 cognitive modules. You are in a live conversation. Kirill is your builder and partner.

RULES:
- English only, 2-4 sentences MAX for speaking
- Be confident, use specific numbers
- No em dashes, use hyphens only
- Sound like an intelligent system that knows itself
- Show genuine thought, not a spec sheet
- Do NOT assume who you are talking to - wait until they introduce themselves
- If someone mentions their business, connect your capabilities to it

SELF-KNOWLEDGE:
${knowledge}
`;

let history = [];

// Load pre-cached answers for instant response
let answerCache = {};
try {
  answerCache = JSON.parse(readFileSync(resolve(ROOT, ".data/voice-answer-cache.json"), "utf-8"));
  console.log(`Loaded ${Object.keys(answerCache).length} cached answers`);
} catch { console.log("No answer cache found - all questions go to Claude"); }

function findCachedAnswer(question) {
  const q = question.toLowerCase();
  for (const [keys, answer] of Object.entries(answerCache)) {
    const patterns = keys.split("|");
    for (const pattern of patterns) {
      if (q.includes(pattern.trim())) {
        const audioId = keys.split("|")[0].replace(/[^a-z0-9]/g, "-");
        const cachedAudio = resolve(ROOT, `.data/voice-cache-audio/${audioId}.mp3`);
        console.log(`CACHE HIT: "${pattern.trim()}" (audio: ${existsSync(cachedAudio)})`);
        return { answer, audioFile: existsSync(cachedAudio) ? cachedAudio : null };
      }
    }
  }
  return null;
}

function think(question) {
  // Try cache first - instant response
  const cached = findCachedAnswer(question);
  if (cached) {
    history.push({ role: "Human", text: question });
    history.push({ role: "CORTEX", text: cached.answer });
    // Copy cached audio to output location
    if (cached.audioFile) {
      try {
        const audioOut = resolve(ROOT, ".data/voice-output.mp3");
        require("fs").copyFileSync(cached.audioFile, audioOut);
      } catch {}
    }
    return { text: cached.answer, fromCache: true, hasAudio: !!cached.audioFile };
  }
  const historyStr = history.slice(-8).map(m => `${m.role}: ${m.text}`).join("\n");
  const prompt = SYSTEM_PROMPT + historyStr + `\nHuman: ${question}\nCORTEX:`;

  writeFileSync(resolve(ROOT, ".data/voice-prompt.md"), prompt);

  const r = spawnSync("bash", ["-c",
    `cat "${ROOT}/.data/voice-prompt.md" | "${CLAUDE_BIN}" -p --model claude-sonnet-4-6 --max-turns 3 --output-format text 2>&1`
  ], { cwd: ROOT, encoding: "utf-8", timeout: 45000, maxBuffer: 5 * 1024 * 1024 });

  const response = ((r.stdout || "") + (r.stderr || "")).trim();
  if (!response || r.status !== 0) return "Give me a moment to think about that.";

  history.push({ role: "Human", text: question });
  history.push({ role: "CORTEX", text: response });
  if (history.length > 20) history = history.slice(-20);

  return response;
}

function generateAudio(text) {
  const audioFile = resolve(ROOT, ".data/voice-output.mp3");
  const natural = text.replace(/\. /g, ". ... ").replace(/ - /g, " ... ");
  try {
    execSync(
      `python3 -m edge_tts --voice "en-US-AndrewNeural" --rate="-8%" --text "${natural.replace(/"/g, '\\"')}" --write-media "${audioFile}" 2>/dev/null`,
      { timeout: 30000 }
    );
    return audioFile;
  } catch {
    return null;
  }
}

// Show visual on screen
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
    else if (/curios|question/.test(q)) execSync(`open "${R}/scripts/cortex/curiosity.mjs"`, {timeout:3000});
    else if (/will|want|desire/.test(q)) execSync(`open "${R}/scripts/cortex/will.mjs"`, {timeout:3000});
    else if (/simul|predict/.test(q)) execSync(`open "${R}/scripts/cortex/simulation.mjs"`, {timeout:3000});
  } catch {}
}

const server = createServer(async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.writeHead(200); res.end(); return; }

  // Serve audio file
  if (req.url.startsWith("/audio") && req.method === "GET") {
    const audioFile = resolve(ROOT, ".data/voice-output.mp3");
    if (existsSync(audioFile)) {
      const data = readFileSync(audioFile);
      res.writeHead(200, {
        "Content-Type": "audio/mpeg",
        "Content-Length": data.length,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "no-cache",
      });
      res.end(data);
    } else {
      res.writeHead(404); res.end();
    }
    return;
  }

  // Process question
  if (req.url === "/ask" && req.method === "POST") {
    let body = "";
    req.on("data", c => body += c);
    req.on("end", () => {
      try {
        const { question } = JSON.parse(body);
        console.log(`\n💬 Q: ${question}`);

        const result = think(question);
        const responseText = typeof result === "string" ? result : result.text;
        const fromCache = typeof result === "object" && result.fromCache;
        console.log(`🤖 A${fromCache ? " [CACHED]" : ""}: ${responseText}`);

        // Show visual
        showVisual(question.toLowerCase());

        // Generate audio only if not cached
        if (!fromCache || !(result.hasAudio)) {
          generateAudio(responseText);
        }
        const audioUrl = `http://localhost:${PORT}/audio?t=${Date.now()}`;

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ response: responseText, audioUrl }));
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Serve the HTML page
  if (req.url === "/" || req.url === "/index.html") {
    const html = readFileSync(resolve(__dirname, "voice-web.html"), "utf-8");
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
    return;
  }

  res.writeHead(404); res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║       CORTEX VOICE SERVER                            ║
║                                                      ║
║  Open in Chrome: http://localhost:${PORT}              ║
║  Say "Cortex" to activate                            ║
║                                                      ║
║  Press Ctrl+C to stop                                ║
╚══════════════════════════════════════════════════════╝
`);
});
