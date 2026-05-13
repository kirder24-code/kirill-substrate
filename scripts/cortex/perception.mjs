/**
 * cortex/perception.mjs - Sensory grounding (2026-05-09)
 *
 * THE EYES AND EARS.
 *
 * Until now the substrate's only "input" was its own internal metrics
 * (free_energy, gwt_health, prediction errors, affect deltas). It introspected
 * on its own accounting. It did NOT perceive the external world.
 *
 * Under functionalism + GWT, sensory grounding matters because phenomenal
 * content (in any theory that allows it) is tied to perception of a world.
 * A system that only contemplates its own metrics is conceptually closer to
 * a thermostat watching itself than to an embodied cognitive agent.
 *
 * What this module does:
 *   1. Provides perceive() API for external pollers / scripts to push real-world
 *      events into substrate
 *   2. Optionally polls known data files for new entries (reddit replies,
 *      email inbox, telegram clicks) - configurable via PULL_SOURCES
 *   3. For each perception, uses Claude (haiku) to interpret valence + meaning
 *   4. Broadcasts perception_event with raw + interpreted + valence
 *   5. Maintains rolling window of perceptions for downstream synthesis
 *
 * Honest constraints:
 *   - This does NOT solve the symbol grounding problem. We map JSON events
 *     to LLM interpretations. Real grounding (Harnad) requires sensorimotor
 *     coupling we don't have.
 *   - Pull mode is optional and only fires for files that exist - no hard
 *     dependency on specific data layouts.
 *   - Cost-controlled: haiku model, 60s polling interval, dedup by content hash.
 */

import { writeFileSync, readFileSync, existsSync, statSync, readdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { createHash } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const PERCEPTION_PATH = resolve(ROOT, ".data/cortex-perceptions.json");
const DATA_DIR = resolve(ROOT, ".data");

const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";
const CLAUDE_MODEL = "claude-haiku-4-5-20251001";
const CLAUDE_TIMEOUT_MS = 30_000;
const WEB_TIMEOUT_MS = 90_000;

/**
 * The world is huge. Perception is NOT bounded by this static list.
 * Three open channels feed perception:
 *   1. Static known sources (below) - well-understood internal data files
 *   2. Auto-discovered sources - .data files matching event-like patterns
 *   3. Web perception - web_perceive(query) uses Claude+WebSearch for OUTSIDE world
 *   4. Runtime registration - registerSource(spec) for any new source dynamically
 *   5. Push API - perceive(item) for any code in the codebase to inject perception
 *
 * The cortex can also PROPOSE new perception sources through introspection,
 * which a future module (perception-discovery) will turn into runtime registrations.
 */
const STATIC_PULL_SOURCES = [
  {
    source: "reddit_replies",
    path: ".data/reddit-replies-monitor.json",
    extractor: (raw) => Array.isArray(raw?.replies) ? raw.replies.map(r => ({
      id: r.comment_id || r.id,
      content: r.body || r.text || "(no body)",
      at: r.created_at || r.at || new Date().toISOString(),
      meta: { author: r.author, subreddit: r.subreddit, post_url: r.post_url },
    })) : [],
  },
  {
    source: "email_inbox",
    path: ".data/email-inbox-state.json",
    extractor: (raw) => Array.isArray(raw?.recent) ? raw.recent.map(m => ({
      id: m.message_id || m.id,
      content: `${m.subject || "(no subject)"} - ${m.snippet || m.body?.slice(0, 200) || ""}`,
      at: m.received_at || m.at || new Date().toISOString(),
      meta: { from: m.from },
    })) : [],
  },
  {
    source: "telegram_interactions",
    path: ".data/telegram-callback-log.json",
    extractor: (raw) => Array.isArray(raw?.events) ? raw.events.map(e => ({
      id: e.update_id || e.id,
      content: `User clicked: ${e.callback_data || e.text || "(no data)"}`,
      at: e.at || new Date().toISOString(),
      meta: { user: e.from?.username },
    })) : [],
  },
  {
    source: "linkedin_notifications",
    path: ".data/linkedin-notifications.json",
    extractor: (raw) => Array.isArray(raw?.items) ? raw.items.map(n => ({
      id: n.id, content: n.summary || n.text || "(linkedin notification)",
      at: n.at, meta: { type: n.type, actor: n.actor },
    })) : [],
  },
  {
    source: "threads_notifications",
    path: ".data/threads-notifications.json",
    extractor: (raw) => Array.isArray(raw?.items) ? raw.items.map(n => ({
      id: n.id, content: n.text || n.summary || "(threads activity)",
      at: n.at, meta: { type: n.type, actor: n.actor },
    })) : [],
  },
  {
    source: "dashboard_interactions",
    path: ".data/dashboard-events.json",
    extractor: (raw) => Array.isArray(raw?.events) ? raw.events.map(e => ({
      id: e.id, content: `${e.event_type}: ${e.target || e.path}`,
      at: e.at, meta: { user_agent: e.user_agent, session: e.session },
    })) : [],
  },
  {
    source: "git_activity",
    path: ".data/git-activity.json",
    extractor: (raw) => Array.isArray(raw?.commits) ? raw.commits.map(c => ({
      id: c.sha, content: `Commit by ${c.author}: ${c.subject}`,
      at: c.at, meta: { files_changed: c.files_changed },
    })) : [],
  },
  {
    source: "system_health",
    path: ".data/system-health.json",
    extractor: (raw) => raw ? [{
      id: `health-${raw.checked_at || Date.now()}`,
      content: `System health: ${raw.summary || JSON.stringify(raw).slice(0, 200)}`,
      at: raw.checked_at, meta: raw,
    }] : [],
  },
  {
    source: "calendar_signals",
    path: ".data/calendar-context.json",
    extractor: (raw) => Array.isArray(raw?.context_items) ? raw.context_items.map(c => ({
      id: c.id, content: c.note || c.event,
      at: c.at, meta: c.meta,
    })) : [],
  },
];

// Runtime-registered sources (added via registerSource API by other modules)
const _runtimeSources = [];

/**
 * Auto-discover .data files that look like event streams.
 * Patterns: contains "replies", "messages", "events", "inbox", "notifications",
 * "activity", "log", "feed" in filename + valid JSON with array under any key.
 * Only fires if file is small enough (< 1MB) and recently modified (within 1 day).
 */
function _discoverDynamicSources() {
  const discovered = [];
  if (!existsSync(DATA_DIR)) return discovered;
  const eventLikePattern = /(replies|messages|events|inbox|notifications|activity|log|feed|signals)/i;
  const knownStatic = new Set(STATIC_PULL_SOURCES.map(s => s.path));
  try {
    const files = readdirSync(DATA_DIR);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      if (!eventLikePattern.test(file)) continue;
      const rel = `.data/${file}`;
      if (knownStatic.has(rel)) continue;
      if (rel.includes("cortex-")) continue; // skip cortex internals
      const abs = resolve(DATA_DIR, file);
      try {
        const stat = statSync(abs);
        if (stat.size > 1_000_000) continue; // skip huge files
        if (Date.now() - stat.mtimeMs > 86400_000) continue; // only fresh
        discovered.push({
          source: `auto::${file.replace(/\.json$/, "")}`,
          path: rel,
          extractor: (raw) => {
            // Heuristic extractor: find first array in JSON, treat each item as event
            const findArr = (o) => {
              if (Array.isArray(o)) return o;
              if (o && typeof o === "object") {
                for (const k of Object.keys(o)) {
                  const r = findArr(o[k]);
                  if (r) return r;
                }
              }
              return null;
            };
            const arr = findArr(raw);
            if (!arr) return [];
            return arr.slice(-10).map((item, i) => ({
              id: item?.id || item?.uuid || `${file}-${i}-${item?.at || Date.now()}`,
              content: typeof item === "string" ? item : (item?.content || item?.text || item?.summary || item?.body || JSON.stringify(item).slice(0, 300)),
              at: item?.at || item?.created_at || new Date().toISOString(),
              meta: { auto_discovered: true },
            }));
          },
          autoDiscovered: true,
        });
      } catch {}
    }
  } catch {}
  return discovered;
}

/**
 * Public API for runtime registration.
 * Other modules (or cortex itself via cortex-executor) can dynamically add new
 * perception sources without modifying this file.
 *
 * Spec: { source: "name", path: ".data/file.json", extractor: (json) -> [items] }
 * OR for HTTP/API: { source: "name", fetcher: async () -> [items] }
 */
export function registerSource(spec) {
  if (!spec || !spec.source) return false;
  if (_runtimeSources.find(s => s.source === spec.source)) return false; // dedup
  _runtimeSources.push(spec);
  return true;
}

// Pull interval - 60s for fresh events without spamming Claude
const PULL_INTERVAL_MS = 60_000;
// Max items per source per pull (avoid token blowup if a file is huge)
const MAX_ITEMS_PER_PULL = 5;

const _seenHashes = new Set(); // dedup by content hash
const MAX_SEEN = 5000;

const _perceptions = []; // rolling window of recent perceptions
const MAX_PERCEPTIONS = 200;

let _busRef = null;
let _pullTimer = null;
let _llmStats = { calls: 0, successes: 0, failures: 0, deduped: 0 };

function _hash(content) {
  return createHash("sha1").update(String(content)).digest("hex").slice(0, 16);
}

function _loadPersisted() {
  if (!existsSync(PERCEPTION_PATH)) return;
  try {
    const raw = JSON.parse(readFileSync(PERCEPTION_PATH, "utf-8"));
    if (Array.isArray(raw?.perceptions)) _perceptions.push(...raw.perceptions);
    if (Array.isArray(raw?.seenHashes)) raw.seenHashes.forEach(h => _seenHashes.add(h));
  } catch {}
}

function _persist() {
  if (_perceptions.length > MAX_PERCEPTIONS) _perceptions.splice(0, _perceptions.length - MAX_PERCEPTIONS);
  if (_seenHashes.size > MAX_SEEN) {
    const arr = [..._seenHashes].slice(-MAX_SEEN);
    _seenHashes.clear();
    arr.forEach(h => _seenHashes.add(h));
  }
  try {
    writeFileSync(PERCEPTION_PATH, JSON.stringify({
      updatedAt: new Date().toISOString(),
      llmStats: _llmStats,
      seenHashes: [..._seenHashes].slice(-200), // only keep recent in persistence
      perceptions: _perceptions,
    }, null, 2));
  } catch (e) {
    process.stderr.write(`[perception] persist failed: ${e?.message || e}\n`);
  }
}

// ─── LLM interpretation ─────────────────────────────────────────────────

function _interpret(item) {
  const prompt = `You are the perception interpreter. You read a real-world event and return its valence + meaning for an autonomous business system whose mission is finding paying clients via outreach + relationships.

EVENT:
- Source: ${item.source}
- Content: ${String(item.content).slice(0, 800)}
- Metadata: ${JSON.stringify(item.meta || {})}

Output a JSON object ONLY:
{
  "valence": "positive" | "negative" | "neutral" | "mixed",
  "significance": 1-10,
  "interpretation": "<1-2 sentences: what this event means for the system's goals>",
  "suggested_attention_topic": "<short imperative if this should pull spotlight, or null>"
}

Valence guide:
- positive: real client signal, real reply, real progress (8-10 significance for buyer interest)
- negative: rejection, broken pipeline signal, complaint, pattern of silence (high sig for sustained patterns)
- neutral: routine update, info-only event
- mixed: contains both, e.g. polite no with referral

Output JSON only, no preamble. Use hyphens, never em dashes.`;

  _llmStats.calls++;
  const r = spawnSync(CLAUDE_BIN, ["-p", "--model", CLAUDE_MODEL, "--max-turns", "1"], {
    input: prompt, encoding: "utf-8", timeout: CLAUDE_TIMEOUT_MS,
  });
  if (r.status !== 0 || !r.stdout) {
    _llmStats.failures++;
    return null;
  }
  const m = r.stdout.match(/\{[\s\S]*\}/);
  if (!m) { _llmStats.failures++; return null; }
  try {
    const parsed = JSON.parse(m[0]);
    _llmStats.successes++;
    return {
      valence: ["positive", "negative", "neutral", "mixed"].includes(parsed.valence) ? parsed.valence : "neutral",
      significance: Math.max(1, Math.min(10, Math.round(parsed.significance || 1))),
      interpretation: typeof parsed.interpretation === "string" ? parsed.interpretation.slice(0, 400) : "",
      suggested_attention_topic: typeof parsed.suggested_attention_topic === "string" ? parsed.suggested_attention_topic.slice(0, 200) : null,
    };
  } catch { _llmStats.failures++; return null; }
}

// ─── Push API ───────────────────────────────────────────────────────────

/**
 * External callers push a perception. Returns the broadcast record or null if deduped.
 * Synchronous wrapper; Claude call happens inline (~5s latency).
 */
export function perceive(item) {
  if (!item || !item.content) return null;
  const h = _hash(`${item.source || "?"}::${item.content}`);
  if (_seenHashes.has(h)) {
    _llmStats.deduped++;
    return null;
  }
  _seenHashes.add(h);

  const interp = _interpret(item);
  if (!interp) {
    // Honest failure: still record the raw perception so we know we saw it
    const rec = {
      at: new Date().toISOString(),
      source: item.source,
      content: String(item.content).slice(0, 500),
      meta: item.meta || {},
      interpretation: null,
      generator: "interpreter-failed",
    };
    _perceptions.push(rec);
    _persist();
    if (_busRef) {
      try { _busRef.broadcast({ source: "perception", type: "perception_event", data: rec }); } catch {}
    }
    return rec;
  }

  const rec = {
    at: new Date().toISOString(),
    source: item.source,
    content: String(item.content).slice(0, 500),
    meta: item.meta || {},
    valence: interp.valence,
    significance: interp.significance,
    interpretation: interp.interpretation,
    suggested_attention_topic: interp.suggested_attention_topic,
    generator: "claude-llm",
  };
  _perceptions.push(rec);
  _persist();

  if (_busRef) {
    try {
      _busRef.broadcast({ source: "perception", type: "perception_event", data: rec });
      // High-significance perceptions also propose attention spotlight
      if (rec.suggested_attention_topic && rec.significance >= 7) {
        // Bridge to attention via direct import - cleaner than re-broadcast
        import("./attention.mjs").then(({ proposeSpotlight }) => {
          proposeSpotlight(rec.suggested_attention_topic, Math.min(10, rec.significance), `perception:${rec.source} - ${rec.interpretation}`, "perception");
        }).catch(() => {});
      }
    } catch (e) {
      process.stderr.write(`[perception] broadcast failed: ${e?.message || e}\n`);
    }
  }
  return rec;
}

// ─── Pull mode (periodic file polling) ──────────────────────────────────

async function _pullOnce() {
  const allSources = [
    ...STATIC_PULL_SOURCES,
    ..._discoverDynamicSources(),
    ..._runtimeSources,
  ];
  for (const src of allSources) {
    try {
      let items = [];
      if (src.fetcher) {
        items = await src.fetcher() || [];
      } else if (src.path) {
        const abs = resolve(ROOT, src.path);
        if (!existsSync(abs)) continue;
        const raw = JSON.parse(readFileSync(abs, "utf-8"));
        items = src.extractor(raw) || [];
      }
      const fresh = items.slice(-MAX_ITEMS_PER_PULL);
      for (const item of fresh) {
        perceive({ source: src.source, content: item.content, meta: item.meta });
      }
    } catch (e) {
      process.stderr.write(`[perception] pull ${src.source} failed: ${e?.message || e}\n`);
    }
  }
}

/**
 * web_perceive(query) - substrate "looks at" the outside world via web search.
 * Uses Claude with WebSearch tool to fetch + interpret. Each result becomes a
 * perception event with valence + significance.
 *
 * Use cases: "what's happening in AI consulting space this week", "Calgary
 * SaaS startups that just announced funding", "Reddit posts about workflow
 * automation pain points".
 *
 * Cost: 1 Claude call with WebSearch (~$0.05-0.20). Use sparingly.
 */
export async function web_perceive(query) {
  if (!query || typeof query !== "string") return null;
  const prompt = `Use web search to find 3-5 recent (within last 7 days when possible) real-world events / posts / news matching this query for an autonomous business system targeting AI workflow consulting clients:

QUERY: ${query}

For each result, output one JSON object on its own line in this format (jsonl, no markdown fences):
{"source": "web::<short_label>", "content": "<1-3 sentences summarizing what was found, including a real signal>", "url": "<source URL>", "meta": {"date": "<YYYY-MM-DD if known>"}}

Find REAL items. If nothing relevant exists, output a single line: {"source":"web::no_results","content":"no relevant items found","url":null,"meta":{}}

Use hyphens, never em dashes.`;

  _llmStats.calls++;
  const r = spawnSync(CLAUDE_BIN, ["-p", "--model", "claude-sonnet-4-6", "--max-turns", "5", "--allowedTools", "WebSearch,WebFetch", "--output-format", "text"], {
    input: prompt, encoding: "utf-8", timeout: WEB_TIMEOUT_MS,
  });
  if (r.status !== 0 || !r.stdout) {
    _llmStats.failures++;
    return [];
  }
  const lines = (r.stdout || "").split("\n").map(l => l.trim()).filter(l => l.startsWith("{"));
  const ingested = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (!obj.content || obj.source === "web::no_results") continue;
      const rec = perceive({ source: obj.source, content: obj.content, meta: { ...obj.meta, url: obj.url, query } });
      if (rec) ingested.push(rec);
    } catch {}
  }
  _llmStats.successes++;
  return ingested;
}

// ─── Required GWT-module export ─────────────────────────────────────────

export function register(bus) {
  _busRef = bus;
  if (_perceptions.length === 0) _loadPersisted();
  if (!_pullTimer) {
    _pullTimer = setInterval(_pullOnce, PULL_INTERVAL_MS);
    _pullTimer.unref?.();
  }
}

// ─── Test helpers ───────────────────────────────────────────────────────

export function getRecentPerceptions(limit = 30) { return _perceptions.slice(-limit); }
export function getLLMStats() { return { ..._llmStats }; }
export async function _flushPull() { await _pullOnce(); }
export function listConfiguredSources() {
  return {
    static: STATIC_PULL_SOURCES.map(s => s.source),
    autoDiscovered: _discoverDynamicSources().map(s => s.source),
    runtime: _runtimeSources.map(s => s.source),
  };
}
export function _resetState() {
  _perceptions.length = 0;
  _seenHashes.clear();
  _llmStats = { calls: 0, successes: 0, failures: 0, deduped: 0 };
  _busRef = null;
  if (_pullTimer) { clearInterval(_pullTimer); _pullTimer = null; }
}
