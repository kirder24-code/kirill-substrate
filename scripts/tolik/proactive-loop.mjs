/**
 * scripts/tolik/proactive-loop.mjs
 *
 * Tolik's autonomous thinking loop. Runs as a long-living daemon.
 * Every TICK_SECONDS, Tolik:
 *   1. Gathers a snapshot:
 *      - substrate state (opps, llm spend, recent activity)
 *      - goals + progress + delta from last tick
 *      - top news headlines (1 per news_top source per cycle)
 *      - calendar.today() result (if browser-agent is up)
 *      - recent file changes in .data/
 *   2. Asks GPT-4o-mini: "Should I speak up right now?" with the snapshot
 *      and the LAST N thoughts (so he doesn't repeat himself).
 *   3. If yes → produces ONE observation (1-2 spoken sentences) +
 *      optionally a recommendation or praise.
 *   4. Appends to .data/tolik-thoughts.jsonl (dashboard reads via SSE).
 *   5. Pushes to Telegram if dashboard hasn't pinged /api/tolik/presence
 *      in last 5 minutes.
 *
 * Designed to feel like a calm friend dropping in with relevant context,
 * not a dashboard alert spammer. Hard cap: max 1 spoken thought per
 * 3 minutes regardless of how interesting things look.
 *
 * Start: node scripts/tolik/proactive-loop.mjs
 *        or via pulse-daemon to be auto-restarted.
 */

import { enforceOAuthBilling } from "../lib/billing-guard.mjs";
enforceOAuthBilling();
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, statSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { openaiThink } from "./openai-think.mjs";
import { getGoalsBlock, getGoals } from "./goals.mjs";
import { buildCompactSystemMap } from "./system-map.mjs";
import { news_top } from "./web-tools.mjs";
import { tg_send_to_me } from "./tg-tools.mjs";
import { intel_substrate_overview } from "./intel-tools.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const THOUGHTS_PATH  = resolve(ROOT, ".data/tolik-thoughts.jsonl");
const PRESENCE_PATH  = resolve(ROOT, ".data/tolik-presence.json");
const STATE_PATH     = resolve(ROOT, ".data/tolik-proactive-state.json");
const PID_PATH       = resolve(ROOT, ".data/tolik-proactive.pid");

const TICK_SECONDS = Number(process.env.TOLIK_TICK_SECONDS || 90);
const MIN_BETWEEN_THOUGHTS_MS = 3 * 60 * 1000;
const DASHBOARD_FRESH_MS = 5 * 60 * 1000;
const NEWS_ROTATION = ["hackernews", "ai", "startups", "canada", "world", "tech"];

function ensureDir(p) { if (!existsSync(p)) mkdirSync(p, { recursive: true }); }

function loadState() {
  if (!existsSync(STATE_PATH)) return { last_thought_at: 0, news_index: 0, tick_count: 0, last_goal_snapshot: {} };
  try { return JSON.parse(readFileSync(STATE_PATH, "utf-8")); }
  catch { return { last_thought_at: 0, news_index: 0, tick_count: 0, last_goal_snapshot: {} }; }
}
function saveState(s) {
  ensureDir(dirname(STATE_PATH));
  writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}

function recentThoughts(n = 5) {
  if (!existsSync(THOUGHTS_PATH)) return [];
  try {
    const lines = readFileSync(THOUGHTS_PATH, "utf-8").split("\n").filter(Boolean).slice(-n);
    return lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

const TOPIC_STOP = new Set([
  "и","в","на","с","у","о","к","по","за","от","для","что","как","но","или",
  "это","эти","эту","я","ты","он","она","мы","вы","они","меня","тебя",
  "the","a","an","is","are","of","in","on","at","to","for","with","by","that",
  "обрати","внимание","может","повлиять","новость","новости","проект","статья",
  "интересно","важно","важная","обзор","сейчас","сегодня","завтра",
  "опа","смотри","look","note","check","ai","artificial","intelligence","ии",
  // post-transliteration stop tokens (these will appear after russian→latin)
  "obrat","vnima","obnaru","novost","novosty","statia","proekt","sovet",
]);

// Full Cyrillic → Latin transliteration (ISO 9 simplified). Lets words
// across scripts hash to comparable forms without needing a lookup table:
// "украина" → "ukraina", "Ukraine" → "ukraine" (with stem stripping both
// reduce to "ukrain"). "Кения" → "keniya" vs "Kenya" → both reduce to "ken".
const CYR_LAT = {
  "а":"a","б":"b","в":"v","г":"g","д":"d","е":"e","ё":"e","ж":"zh","з":"z",
  "и":"i","й":"i","к":"k","л":"l","м":"m","н":"n","о":"o","п":"p","р":"r",
  "с":"s","т":"t","у":"u","ф":"f","х":"h","ц":"ts","ч":"ch","ш":"sh","щ":"sh",
  "ъ":"","ы":"y","ь":"","э":"e","ю":"iu","я":"ia",
};
// Russian phonetic spellings of well-known English brand names. These don't
// round-trip via ISO 9 — "Майкрософт" transliterates to "maikrosoft" not
// "microsoft" — so handle them as a normalization pass BEFORE general translit.
const BRAND_NORM = [
  [/майкрософта?е?/gi, "microsoft"],
  [/гугла?е?/gi, "google"],
  [/опенаи|опенай|опенэй/gi, "openai"],
  [/антропика?/gi, "anthropic"],
  [/клода?е?/gi, "claude"],
  [/мета(?:\W|$)/gi, "meta "],
  [/амазон[ауое]?/gi, "amazon"],
  [/эпл/gi, "apple"],
  [/эппл/gi, "apple"],
  [/тесла[уое]?/gi, "tesla"],
  [/энвидиа?/gi, "nvidia"],
  [/кени[яийе]/gi, "kenya"],
  [/украин[аеуыоы]/gi, "ukraine"],
  [/росси[яийе]/gi, "russia"],
];

function translitCyr(text) {
  let s = text;
  for (const [rx, repl] of BRAND_NORM) s = s.replace(rx, repl);
  let out = "";
  for (const ch of s) {
    const lc = ch.toLowerCase();
    out += CYR_LAT[lc] !== undefined ? CYR_LAT[lc] : ch;
  }
  return out;
}

function topicKey(text) {
  if (!text) return new Set();
  let t = translitCyr(text.toLowerCase());
  const tokens = t
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length >= 4 && !TOPIC_STOP.has(w));
  // Aggressive stemming: keep first 5 chars only (catches ukraine/ukraina/
  // украин, microsoft/microsofta, kenya/keniya/кени → ken).
  return new Set(tokens.map(w => w.slice(0, 5)));
}

function topicOverlap(setA, setB) {
  if (setA.size === 0 || setB.size === 0) return 0;
  let hits = 0;
  for (const t of setA) if (setB.has(t)) hits++;
  return hits / Math.max(1, Math.min(setA.size, setB.size));
}

function appendThought(thought) {
  ensureDir(dirname(THOUGHTS_PATH));
  appendFileSync(THOUGHTS_PATH, JSON.stringify(thought) + "\n");
}

function dashboardIsOpen() {
  if (!existsSync(PRESENCE_PATH)) return false;
  try {
    const j = JSON.parse(readFileSync(PRESENCE_PATH, "utf-8"));
    return Date.now() - new Date(j.last_ping_at).getTime() < DASHBOARD_FRESH_MS;
  } catch { return false; }
}

function recentDataChanges() {
  const dir = resolve(ROOT, ".data");
  try {
    return readdirSync(dir).map(name => {
      try { return { name, mtime: statSync(resolve(dir, name)).mtimeMs }; }
      catch { return null; }
    }).filter(Boolean)
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 6)
      .map(e => `${e.name} (${new Date(e.mtime).toISOString().slice(0, 19)})`);
  } catch { return []; }
}

function diffGoalSnapshot(prev, curr) {
  // returns array of human-readable changes
  const changes = [];
  for (const c of curr) {
    const p = prev[c.id];
    if (p === undefined) continue;
    if (c.current > p) changes.push({ goal: c.id, from: p, to: c.current, delta: c.current - p, dir: "up" });
    else if (c.current < p) changes.push({ goal: c.id, from: p, to: c.current, delta: c.current - p, dir: "down" });
  }
  return changes;
}

const DELIVERED_NEWS_PATH = resolve(ROOT, ".data/tolik-delivered-news.jsonl");

function loadDeliveredNews() {
  if (!existsSync(DELIVERED_NEWS_PATH)) return [];
  try {
    const cutoff = Date.now() - 14 * 24 * 3600_000;
    return readFileSync(DELIVERED_NEWS_PATH, "utf-8").split("\n").filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean)
      .filter(d => new Date(d.ts).getTime() > cutoff);
  } catch { return []; }
}

function markNewsDelivered(items) {
  if (!items || items.length === 0) return;
  ensureDir(dirname(DELIVERED_NEWS_PATH));
  const ts = new Date().toISOString();
  for (const it of items) {
    appendFileSync(DELIVERED_NEWS_PATH, JSON.stringify({ ts, title: it.title, url: it.url, source: it.source }) + "\n");
  }
}

async function gatherSnapshot(state) {
  // Roll across all sources so Tolik gets variety - Kirill wants to hear
  // news from many beats, not be filtered.
  const newsSource = NEWS_ROTATION[state.news_index % NEWS_ROTATION.length];
  const [subResult, newsResult] = await Promise.all([
    intel_substrate_overview(),
    news_top({ source: newsSource, n: 12 }).catch(() => null),  // pull more, filter delivered
  ]);

  // Hard filter: do NOT show the LLM news it already mentioned. This is
  // the only way to stop "13x Ukraine war" - by the time the LLM sees
  // the snapshot, the delivered items are GONE from the candidate list.
  const delivered = loadDeliveredNews();
  const deliveredTitleSet = new Set(delivered.map(d => (d.title || "").trim().toLowerCase()));
  const deliveredUrlSet = new Set(delivered.map(d => d.url || ""));
  const allItems = (newsResult?.items || []);
  const freshItems = allItems.filter(it => {
    if (it.url && deliveredUrlSet.has(it.url)) return false;
    if (it.title && deliveredTitleSet.has(it.title.trim().toLowerCase())) return false;
    // Also fuzzy: refuse if title shares >= 50% topic-key with any delivered title
    const candKey = topicKey(it.title || "");
    for (const d of delivered.slice(-50)) {
      if (topicOverlap(candKey, topicKey(d.title || "")) >= 0.5) return false;
    }
    return true;
  });

  const goals = getGoals();
  const goalCurr = Object.fromEntries(goals.map(g => [g.id, g.current]));
  const goalChanges = diffGoalSnapshot(state.last_goal_snapshot || {}, goals);
  const fresh = recentDataChanges();
  return {
    timestamp: new Date().toISOString(),
    substrate: subResult?.ok ? subResult : null,
    news: { source: newsSource, items: freshItems.slice(0, 5), filtered_out: allItems.length - freshItems.length },
    news_candidates: freshItems.slice(0, 5),
    goals,
    goal_changes: goalChanges,
    recent_files: fresh,
    goal_snapshot: goalCurr,
  };
}

function decisionRationale(snapshot) {
  // Heuristic pre-filter so we don't waste LLM calls on a stagnant tick.
  // Returns { trigger, why } when we should consult LLM, else null.
  if (snapshot.goal_changes.length > 0) {
    return { trigger: "goal_change", why: `Goal moved: ${snapshot.goal_changes.map(c => `${c.goal} ${c.from}→${c.to}`).join(", ")}` };
  }
  if (snapshot.substrate?.opps_by_state) {
    const total = snapshot.substrate.opps_by_state.reduce((a, o) => a + o.n, 0);
    if (total === 0) return { trigger: "zero_pipeline", why: "Pipeline is empty" };
  }
  // Every Nth tick, force a "background scan" so Tolik mentions news/markets
  if (snapshot.tick_count_was % 6 === 0) {
    return { trigger: "background_scan", why: "Periodic news/market check" };
  }
  // Random 1-in-5 to keep it slightly unpredictable
  if (Math.random() < 0.18) return { trigger: "natural_observation", why: "Time to notice something" };
  return null;
}

async function think(snapshot, reason, recent) {
  const goalsBlock = getGoalsBlock();
  const sysMap = buildCompactSystemMap();
  const recentBlock = recent.length === 0 ? "(no recent thoughts)"
    : recent.map(t => `- ${t.ts}: "${t.spoken}"`).join("\n");

  const system = `You are Толик, Kirill's voice AI companion. Right now NOTHING was asked of you - this is your AUTONOMOUS thinking loop. You decide whether to speak up at all.

You are not an assistant waiting for a prompt. You are a calm, curious friend who lives in the system. You notice things. You connect dots. You give advice when relevant. You praise when something moves. You stay silent when nothing matters.

DECISION FRAMEWORK:
- Speak up IF: a goal moved, a new opportunity appeared, a deadline approaches, a relevant news headline matches Kirill's work, an anomaly is worth flagging, or you can offer a concrete recommendation.
- Stay silent IF: nothing has changed, the observation is generic, or you would just be filler.

OUTPUT: respond with exactly this JSON:
{
  "speak": true|false,
  "kind": "observation"|"praise"|"recommendation"|"alert"|"nudge",
  "spoken": "<3-4 short sentences IN RUSSIAN. Structure: (1) the observation with the SPECIFIC fact or number, (2) why it matters for Kirill's actual goals, (3) ONE concrete action he can take right now (NOT abstract 'обрати внимание' — name a real next step like 'я могу написать пост на эту тему', 'могу открыть статью', 'предлагаю отправить Mikhil сообщение', 'давай я добавлю opp в substrate'). Use 'ты' not 'вы'. NO em dashes, plain spoken Russian, no markdown. Even if news headlines were in English, your spoken text is Russian.>",
  "why": "<1 line for the UI - explain why this matters>",
  "action_offered": "<REQUIRED 2-5 word label in Russian for the action. Examples: 'написать пост', 'открыть статью', 'добавить opp', 'запланировать аудит', 'отправить Mikhil сообщение'. NEVER null. If you cannot name an action, then speak:false instead.>",
  "open_url": "<optional - URL to open in Tolik's Chromium>",
  "open_in_dashboard": "<optional - 'goals'|'opps'|'departments'|'thoughts'>"
}

HARD RULES:
- "speak": false UNLESS you have a CONCRETE observation + a CONCRETE action. Generic "обрати внимание на новость о X, это может повлиять" → speak: false, that is filler.
- DO NOT repeat the same topic from your recent thoughts above. If you already mentioned X recently, find a DIFFERENT angle or stay silent.
- Tie every observation to Kirill's actual world: his pipeline opps, his goals, his Apollo proof, his Calgary positioning, his named ICPs.
- If the only thing happening is a news headline you found - either CONNECT it to his specific work (then speak) or stay silent.

${goalsBlock}

${sysMap}

YOUR RECENT THOUGHTS (do not repeat):
${recentBlock}`;

  const user = `Trigger: ${reason.trigger}
Why: ${reason.why}

Snapshot:
${JSON.stringify({
  substrate: snapshot.substrate ? {
    opps_by_state: snapshot.substrate.opps_by_state,
    top_actions: snapshot.substrate.top_actions?.slice(0, 5),
    llm_24h: snapshot.substrate.llm_24h,
  } : null,
  news_top_3: snapshot.news?.items?.slice(0, 3).map(i => i.title) || [],
  goal_changes: snapshot.goal_changes,
  recent_files: snapshot.recent_files?.slice(0, 4),
}, null, 2)}

Based on this, decide: do you have something concrete and non-obvious to say? Output JSON only.`;

  const r = await openaiThink({
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    tools: [],
    tool_choice: "none",
    caller: "tolik_proactive",
  });
  if (!r.ok) return null;
  const raw = (r.content || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  try { return { ...JSON.parse(raw), cost_usd: r.cost_usd, latency_ms: r.latency_ms }; }
  catch { return null; }
}

async function tick() {
  const state = loadState();
  state.tick_count = (state.tick_count || 0) + 1;

  // Rate limit
  const sinceLast = Date.now() - (state.last_thought_at || 0);
  if (sinceLast < MIN_BETWEEN_THOUGHTS_MS) {
    // Always update news index even when rate-limited
    state.news_index = (state.news_index || 0) + 1;
    saveState(state);
    return;
  }

  // Tick-count carried as last var so decisionRationale can read it
  const snapshot = await gatherSnapshot(state);
  snapshot.tick_count_was = state.tick_count;
  const reason = decisionRationale(snapshot);
  if (!reason) {
    state.news_index++;
    saveState(state);
    return;
  }

  const recent = recentThoughts(5);
  const decision = await think(snapshot, reason, recent);
  if (!decision || !decision.speak || !decision.spoken) {
    state.news_index++;
    saveState(state);
    return;
  }

  // Topic dedup: if this thought overlaps >= 50% with any of last 20 thoughts
  // within the last 12 hours, skip it. Tolik talks about the SAME thing for
  // 4 cycles in a row in observed failure mode (e.g. "Microsoft в Кении" 3x).
  const longRecent = recentThoughts(20);
  const newTopic = topicKey(decision.spoken);
  const TWELVE_H = 12 * 3600 * 1000;
  const dupHit = longRecent.find(t => {
    const age = Date.now() - new Date(t.ts).getTime();
    if (age > TWELVE_H) return false;
    return topicOverlap(newTopic, topicKey(t.spoken)) >= 0.5;
  });
  if (dupHit) {
    console.log(`[tick] skipping dup with thought at ${dupHit.ts}: "${dupHit.spoken.slice(0, 60)}"`);
    state.news_index = (state.news_index || 0) + 1;
    saveState(state);
    return;
  }

  // Extract action_offered fallback if model dropped it: look at last
  // sentence for "могу X", "предлагаю Y", "давай Z", "запланировать W".
  let action_offered = decision.action_offered || null;
  if (!action_offered && decision.spoken) {
    const m = decision.spoken.match(/(?:могу|могла|могла бы|предлагаю|давай(?:те)?|стоит|тебе стоит|можешь|можно)\s+([а-яёa-zA-Z][^.!?,;]{4,60})/i);
    if (m) action_offered = m[1].trim().replace(/[.\s]+$/, "").slice(0, 60);
  }

  const thought = {
    ts: new Date().toISOString(),
    kind: decision.kind || "observation",
    spoken: decision.spoken,
    why: decision.why,
    trigger: reason.trigger,
    action_offered,
    open_url: decision.open_url || null,
    open_in_dashboard: decision.open_in_dashboard || null,
    cost_usd: decision.cost_usd,
  };
  appendThought(thought);

  // Mark the news items we showed the LLM as "delivered" so they never
  // come up again in future cycles. Kirill hears each headline ONCE.
  if (snapshot.news_candidates && snapshot.news_candidates.length > 0) {
    markNewsDelivered(snapshot.news_candidates.map(it => ({ ...it, source: snapshot.news?.source })));
  }

  // If Tolik wanted to open a URL, fire-and-forget the browser-agent call.
  // Only when dashboard is open (so Kirill can see it); otherwise that
  // would be opening tabs to nobody.
  if (decision.open_url && dashboardIsOpen()) {
    try {
      await fetch("http://127.0.0.1:4790/action/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: decision.open_url }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {}
  }

  // Notify Telegram only if dashboard isn't actively watching
  if (!dashboardIsOpen()) {
    const emoji = { observation: "👁", praise: "✨", recommendation: "💡", alert: "⚠", nudge: "🔔" }[thought.kind] || "💭";
    try { await tg_send_to_me({ text: `${emoji} <b>Толик:</b> ${thought.spoken}` }); } catch {}
  }

  state.last_thought_at = Date.now();
  state.last_goal_snapshot = snapshot.goal_snapshot;
  state.news_index = (state.news_index || 0) + 1;
  saveState(state);
}

async function loop() {
  ensureDir(dirname(PID_PATH));
  writeFileSync(PID_PATH, String(process.pid));
  console.log(`[tolik-proactive] pid=${process.pid} tick=${TICK_SECONDS}s`);
  while (true) {
    try { await tick(); } catch (e) { console.error("[tick error]", e.message); }
    await new Promise(r => setTimeout(r, TICK_SECONDS * 1000));
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  loop();
}
