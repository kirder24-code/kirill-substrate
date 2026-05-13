/**
 * inbound-buyer-intent-bot.mjs
 *
 * Watches for posts matching 'looking for AI [help|freelancer|expert|consultant]'
 * patterns on r/AI_Agents, r/SaaS, r/entrepreneur, r/startups.
 *
 * Pipeline:
 *   1. Fetch new posts (last 2h) from target subs
 *   2. Filter by buyer-intent regex
 *   3. Score each match against ICP (solo founder, workflow pain, Canada/US)
 *   4. If score >= 12: call Claude to draft 3-bullet comment from Kirill's POV
 *   5. Send to Telegram with post URL + draft + action line
 *
 * Cron: every 10 min - schedule: star/10 star star star star
 *   bash scripts/factory/add-cron-entry.sh "star/10 * * * *" scripts/factory/inbound-buyer-intent-bot.mjs inbound-buyer-intent
 */
import Database from "better-sqlite3";
import { readFileSync, existsSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");

const env = Object.fromEntries(
  readFileSync(resolve(ROOT, "apps/api/.env"), "utf-8").split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const TG = env.TELEGRAM_BOT_TOKEN;
const CHAT = env.TELEGRAM_CHAT_ID;
const UA = "KirillBot/1.0 (inbound-buyer-intent)";
const BOT_NAME = "inbound-buyer-intent-bot";

const SUBS = ["AI_Agents", "SaaS", "entrepreneur", "startups"];
const WINDOW_SECS = 2 * 60 * 60; // 2h

// Buyer intent: must have 'looking for' + (AI|automation) + (help|freelancer|expert|hire|consultant)
const BUYER_INTENT = /looking for.{0,60}(AI|automation|automati)/i;
const QUALIFIER = /\b(help|freelancer|expert|hire|consultant|agency|developer|build|someone)\b/i;

// ICP scoring signals
const ICP_SOLO    = /\b(solo founder|indie|bootstrapped|side project|building alone|just me|single founder|one person|solopreneur)\b/i;
const ICP_PAIN    = /\b(workflow|automat|manual|hours|tedious|repetitive|integrate|zapier|make\.com|n8n|api|no.?code|low.?code|airtable|crm)\b/i;
const ICP_GEO     = /\b(canada|canadian|calgary|toronto|vancouver|US|united states|north america)\b/i;
const ICP_BUDGET  = /\b(budget|pay|hire|paid|invoice|contractor|freelancer|rate|cost|price)\b/i;
const ICP_URGENT  = /\b(asap|urgent|quickly|today|this week|immediately|right now)\b/i;
const ICP_SAAS    = /\b(saas|app|product|startup|mvp|launched|shipped|customers?|users?)\b/i;

// Seen-posts dedup file to avoid re-alerting same post across runs
const SEEN_FILE = resolve(ROOT, ".data/inbound-buyer-intent-seen.json");

function loadSeen() {
  if (!existsSync(SEEN_FILE)) return new Set();
  try { return new Set(JSON.parse(readFileSync(SEEN_FILE, "utf-8"))); }
  catch { return new Set(); }
}

function saveSeen(seen) {
  // Keep only last 2000 IDs to prevent unbounded growth
  const arr = [...seen].slice(-2000);
  writeFileSync(SEEN_FILE, JSON.stringify(arr));
}

async function fetchRedditJSON(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, "Accept": "application/json" },
        signal: AbortSignal.timeout(15000),
      });
      if (res.status === 429) {
        const wait = (attempt + 1) * 10000;
        console.log(`[${BOT_NAME}] 429 rate limited, waiting ${wait / 1000}s...`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    } catch (e) {
      if (attempt === 2) throw e;
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

function scoreICP(text) {
  let score = 0;
  if (ICP_SOLO.test(text))   score += 4;
  if (ICP_PAIN.test(text))   score += 4;
  if (ICP_GEO.test(text))    score += 3;
  if (ICP_BUDGET.test(text)) score += 3;
  if (ICP_URGENT.test(text)) score += 2;
  if (ICP_SAAS.test(text))   score += 2;
  return score;
}

async function callClaudeForDraft(post) {
  const { spawnSync } = await import("child_process");
  const promptFile = resolve(ROOT, ".data/callai-prompt.md");

  const prompt = `You are helping Kirill Kireyev respond to a Reddit post where someone is looking for AI automation help.

Kirill offers: custom AI workflow automation for SaaS founders and small businesses. Services from $1,500-$10,000 CAD. Real deliverables: automated lead pipelines, AI assistants, workflow integrations.

POST TITLE: ${post.title}
POST BODY: ${(post.body || "").slice(0, 800)}
SUBREDDIT: r/${post.sub}

Write a 3-bullet Reddit comment from Kirill's POV. Rules:
- First bullet: acknowledge their specific pain point directly (no flattery)
- Second bullet: one concrete relevant thing Kirill has built/shipped (be specific)
- Third bullet: low-friction next step (e.g. "Happy to share what worked - DM or drop a comment")
- NO em dashes, NO buzzwords like "game-changer" or "revolutionary"
- NO money-back guarantees or results-based promises
- Sound like a practitioner, not a vendor
- Max 150 words total
- Output ONLY the comment text, nothing else`;

  writeFileSync(promptFile, prompt);

  const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";
  const cleanEnv = { ...process.env };
  delete cleanEnv.CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING;
  cleanEnv.PATH = `$HOME/.nvm/versions/node/v22.22.2/bin:${process.env.PATH || "/usr/bin:/bin"}`;

  const r = spawnSync("bash", ["-c",
    `cat "${promptFile}" | "${CLAUDE_BIN}" -p --model claude-haiku-4-5-20251001 --max-turns 1 --output-format text 2>&1`,
  ], {
    cwd: ROOT,
    env: cleanEnv,
    encoding: "utf-8",
    timeout: 30000,
    maxBuffer: 2 * 1024 * 1024,
  });

  const out = ((r.stdout || "") + (r.stderr || "")).trim();
  if (!out || r.status !== 0) throw new Error(`Claude failed: exit=${r.status} output=${out?.slice(0, 200)}`);
  // Strip em dashes from output
  return out.replace(/\u2014/g, "-").replace(/\u2013/g, "-");
}

async function tg(text) {
  if (!TG || !CHAT) { console.log("[tg]", text.slice(0, 200)); return; }
  try {
    await fetch(`https://api.telegram.org/bot${TG}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHAT,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
  } catch (e) {
    console.error(`[${BOT_NAME}] tg error: ${e.message}`);
  }
}

async function processSub(sub, seen, nowSecs) {
  const url = `https://www.reddit.com/r/${sub}/new.json?limit=50&raw_json=1`;
  let data;
  try {
    data = await fetchRedditJSON(url);
  } catch (e) {
    console.log(`[${BOT_NAME}] r/${sub} fetch error: ${e.message}`);
    return [];
  }

  const posts = (data?.data?.children || []).map(c => c.data);
  const matches = [];

  for (const p of posts) {
    if (!p || !p.id) continue;
    const ageSecs = nowSecs - (p.created_utc || 0);
    if (ageSecs > WINDOW_SECS) continue;
    if (seen.has(p.id)) continue;

    const text = `${p.title || ""}\n${p.selftext || ""}`;
    if (!BUYER_INTENT.test(text)) continue;
    if (!QUALIFIER.test(text)) continue;

    const score = scoreICP(text);
    const postUrl = `https://reddit.com${p.permalink}`;
    console.log(`[${BOT_NAME}] match r/${sub} score=${score} age=${Math.floor(ageSecs / 60)}m: ${p.title?.slice(0, 80)}`);

    matches.push({ id: p.id, sub, title: p.title, body: p.selftext, url: postUrl, score, ageMins: Math.floor(ageSecs / 60) });
  }

  return matches;
}

(async () => {
  const seen = loadSeen();
  const nowSecs = Math.floor(Date.now() / 1000);
  const allMatches = [];

  for (const sub of SUBS) {
    const matches = await processSub(sub, seen, nowSecs);
    allMatches.push(...matches);
    await new Promise(r => setTimeout(r, 2000)); // 2s between subs to avoid rate limiting
  }

  // Check for the specific post mentioned in the task brief
  const PRIORITY_POST = "1stevxo";
  if (!seen.has(PRIORITY_POST)) {
    const priorityUrl = `https://www.reddit.com/r/AI_Agents/comments/${PRIORITY_POST}.json?raw_json=1`;
    try {
      const data = await fetchRedditJSON(priorityUrl);
      if (Array.isArray(data) && data[0]?.data?.children?.[0]?.data) {
        const p = data[0].data.children[0].data;
        const text = `${p.title || ""}\n${p.selftext || ""}`;
        const score = scoreICP(text);
        allMatches.unshift({
          id: PRIORITY_POST,
          sub: "AI_Agents",
          title: p.title,
          body: p.selftext,
          url: `https://reddit.com/r/AI_Agents/comments/${PRIORITY_POST}/`,
          score: Math.max(score, 12), // priority route - treat as qualifying
          ageMins: Math.floor((nowSecs - (p.created_utc || nowSecs)) / 60),
          priority: true,
        });
        console.log(`[${BOT_NAME}] priority post loaded: score=${score} title=${p.title?.slice(0, 60)}`);
      }
    } catch (e) {
      console.log(`[${BOT_NAME}] priority post fetch error: ${e.message}`);
    }
  }

  const qualifying = allMatches.filter(m => m.score >= 12);
  console.log(`[${BOT_NAME}] total matches=${allMatches.length} qualifying=${qualifying.length}`);

  if (qualifying.length === 0) {
    console.log(`[${BOT_NAME}] no qualifying posts this run`);
    // Mark seen so we don't re-process below-threshold matches every cycle
    for (const m of allMatches) seen.add(m.id);
    saveSeen(seen);
    return;
  }

  for (const match of qualifying) {
    let draft = "(draft generation failed)";
    try {
      draft = await callClaudeForDraft(match);
    } catch (e) {
      console.error(`[${BOT_NAME}] draft error for ${match.id}: ${e.message}`);
    }

    const label = match.priority ? "PRIORITY" : `score ${match.score}`;
    const msg = `<b>[BUYER INTENT] r/${match.sub} - ${label}</b>\n` +
      `Age: ${match.ageMins}min\n` +
      `Post: ${match.url}\n\n` +
      `<b>Title:</b> ${(match.title || "").slice(0, 200)}\n\n` +
      `<b>Draft comment:</b>\n${draft}\n\n` +
      `Reply Y to dispatch`;

    await tg(msg);
    seen.add(match.id);
    console.log(`[${BOT_NAME}] sent alert for ${match.id}`);
    await new Promise(r => setTimeout(r, 1000));
  }

  saveSeen(seen);
  console.log(`[${BOT_NAME}] done. alerted=${qualifying.length}`);
})();
