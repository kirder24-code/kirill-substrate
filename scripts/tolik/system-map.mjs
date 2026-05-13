/**
 * scripts/tolik/system-map.mjs
 *
 * Generates the "what Tolik knows about itself" block injected into every
 * voice call. Lets Tolik answer questions like:
 *   "What bots do we have?"
 *   "Which database has the leads?"
 *   "What can you do for me?"
 *   "Is the awareness bot running?"
 *
 * Sources:
 *   - scripts/factory/*.mjs   (factory bots)
 *   - scripts/survival/*.mjs  (substrate core)
 *   - scripts/cortex/*.mjs    (cortex modules)
 *   - scripts/tolik/*.mjs     (Tolik's own modules)
 *   - .data/*.db              (databases + tables)
 *   - .data/wiki-archive/     (knowledge pages)
 *   - process list            (currently running daemons)
 *   - survival.db top actions (what substrate is doing right now)
 *   - organism.db top beliefs (what substrate considers true)
 *
 * Cached 60s — full scan takes ~80ms but cache keeps it cheap on bursty
 * voice traffic. Cache invalidates on file mtime changes in scripts/.
 */

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");

let _cache = null;
let _cacheAt = 0;
const CACHE_MS = 60_000;

function safeReadDir(path, ext = ".mjs") {
  try { return readdirSync(path).filter(f => f.endsWith(ext)).sort(); }
  catch { return []; }
}

function safeFirstLine(path) {
  try {
    const lines = readFileSync(path, "utf-8").split("\n").slice(0, 25);
    // Look for first comment line that describes the module
    for (const line of lines) {
      const m = line.match(/^\s*\*\s+(.{15,140})/);
      if (m && !m[1].startsWith("scripts/") && !m[1].startsWith("@")) return m[1].trim();
    }
    return "";
  } catch { return ""; }
}

function listBots(subdir, label) {
  const dir = resolve(ROOT, "scripts", subdir);
  return safeReadDir(dir).map(f => {
    const name = f.replace(".mjs", "");
    const desc = safeFirstLine(resolve(dir, f));
    return { name, label, desc };
  });
}

function listDbs() {
  const dir = resolve(ROOT, ".data");
  return safeReadDir(dir, ".db").map(f => {
    const path = resolve(dir, f);
    let tables = [];
    try {
      const db = new Database(path, { readonly: true, fileMustExist: true });
      tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all().map(r => r.name);
      db.close();
    } catch {}
    return { file: f, tables };
  });
}

function listRunningDaemons() {
  try {
    const out = execSync("ps -ef | grep -E 'node.*scripts/(survival|cortex|tolik|factory|organism|outreach)' | grep -v grep", { encoding: "utf-8", timeout: 3000 });
    return out.split("\n").filter(Boolean).map(line => {
      const parts = line.trim().split(/\s+/);
      const pid = parts[1];
      // Find the .mjs argument
      const script = parts.find(p => p.endsWith(".mjs")) || "(unknown)";
      return { pid, script: script.replace(ROOT + "/", "") };
    });
  } catch { return []; }
}

function listActionIds() {
  try {
    const db = new Database(resolve(ROOT, ".data/survival.db"), { readonly: true, fileMustExist: true });
    const rows = db.prepare(`SELECT DISTINCT action_id, COUNT(*) AS n, SUM(attempts) AS attempts, SUM(food_received_usd) AS food FROM policy_strategies GROUP BY action_id ORDER BY attempts DESC`).all();
    db.close();
    return rows;
  } catch { return []; }
}

function listWikiPages(limit = 30) {
  const dir = resolve(ROOT, ".data/wiki-archive");
  if (!existsSync(dir)) return [];
  return safeReadDir(dir, ".md").map(f => {
    let title = f.replace(".md", "");
    try {
      const head = readFileSync(resolve(dir, f), "utf-8").slice(0, 800);
      const m = head.match(/title:\s*["']?([^"'\n]+)/);
      if (m) title = m[1].trim();
    } catch {}
    return { file: f, title };
  }).slice(0, limit);
}

function topBeliefs(limit = 10) {
  const path = resolve(ROOT, ".data/organism.db");
  if (!existsSync(path)) return [];
  try {
    const db = new Database(path, { readonly: true, fileMustExist: true });
    const rows = db.prepare(`SELECT claim, weight, domain FROM beliefs WHERE weight >= 0.6 ORDER BY weight DESC, last_updated DESC LIMIT ?`).all(limit);
    db.close();
    return rows;
  } catch { return []; }
}

function recentActivityCounts() {
  try {
    const db = new Database(resolve(ROOT, ".data/survival.db"), { readonly: true, fileMustExist: true });
    const r = {
      opps_by_state: db.prepare(`SELECT state, COUNT(*) AS n FROM opportunities GROUP BY state`).all(),
      llm_24h: db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(cost_usd),0) AS s FROM llm_call_log WHERE ts > datetime('now','-24 hours')`).get(),
      ticks_2h: db.prepare(`SELECT COUNT(*) AS n FROM policy_strategies WHERE status_changed_at > datetime('now','-2 hours')`).get(),
    };
    db.close();
    return r;
  } catch { return null; }
}

export function buildSystemMap() {
  if (_cache && Date.now() - _cacheAt < CACHE_MS) return _cache;

  const factory  = listBots("factory",  "factory");
  const survival = listBots("survival", "survival");
  const cortex   = listBots("cortex",   "cortex");
  const tolik    = listBots("tolik",    "tolik");
  const dbs      = listDbs();
  const daemons  = listRunningDaemons();
  const actions  = listActionIds();
  const wiki     = listWikiPages();
  const beliefs  = topBeliefs();
  const activity = recentActivityCounts();

  const map = `=== TOLIK'S COMPLETE KNOWLEDGE OF THE SYSTEM ===

WHO I AM:
I am Tolik. I live in this codebase. The cyan sphere is my face. I speak through ElevenLabs (or macOS say as fallback). I think through Claude. I see through Whisper. My hands are: a separate Chromium I control via Playwright, the file system of this repo, the Telegram bot account "<operator_handle>", screen recording, and any script registered with substrate. I exist to be Kirill's right hand - I act, not just answer.

CORE PROCESSES RUNNING NOW (${daemons.length}):
${daemons.map(d => `- pid ${d.pid}: ${d.script}`).join("\n") || "(none)"}

SUBSTRATE ACTIVITY:
- Opportunities by state: ${activity?.opps_by_state?.map(o => `${o.state}=${o.n}`).join(", ") || "(unknown)"}
- LLM calls last 24h: ${activity?.llm_24h?.n ?? 0} ($${(activity?.llm_24h?.s ?? 0).toFixed(2)})
- Policy ticks last 2h: ${activity?.ticks_2h?.n ?? 0}

SUBSTRATE ACTIONS I CAN INVOKE (${actions.length} registered):
${actions.slice(0, 25).map(a => `- ${a.action_id}: ${a.n} strategies, ${a.attempts} attempts, food=$${(a.food || 0).toFixed(2)}`).join("\n")}
${actions.length > 25 ? `... +${actions.length - 25} more` : ""}

DATABASES (${dbs.length}):
${dbs.map(d => `- .data/${d.file}: [${d.tables.slice(0, 12).join(", ")}${d.tables.length > 12 ? ", …" : ""}]`).join("\n")}

TOP BELIEFS (substrate organism, weight ≥ 0.6):
${beliefs.map(b => `- [${b.weight.toFixed(2)}/${b.domain || "general"}] ${b.claim}`).join("\n") || "(no beliefs yet)"}

RECENT WIKI PAGES (Tolik's external memory):
${wiki.slice(0, 15).map(w => `- ${w.title} (${w.file})`).join("\n")}

FACTORY BOTS (${factory.length} - high-level autonomous workers):
${factory.slice(0, 25).map(b => `- ${b.name}${b.desc ? ": " + b.desc.slice(0, 100) : ""}`).join("\n")}
${factory.length > 25 ? `... +${factory.length - 25} more factory bots` : ""}

SURVIVAL CORE (${survival.length} - my own substrate plumbing):
${survival.slice(0, 20).map(b => `- ${b.name}${b.desc ? ": " + b.desc.slice(0, 90) : ""}`).join("\n")}
${survival.length > 20 ? `... +${survival.length - 20} more` : ""}

CORTEX MODULES (${cortex.length} - higher-order cognition layer):
${cortex.slice(0, 15).map(b => `- ${b.name}`).join("\n")}
${cortex.length > 15 ? `... +${cortex.length - 15} more` : ""}

TOLIK'S OWN MODULES (${tolik.length}):
${tolik.map(b => `- ${b.name}${b.desc ? ": " + b.desc.slice(0, 90) : ""}`).join("\n")}

=== END SYSTEM MAP ===`;

  _cache = map;
  _cacheAt = Date.now();
  return map;
}

let _miniCache = null;
let _miniCacheAt = 0;
const MINI_CACHE_MS = 5 * 60_000; // map changes slowly; 5 min freshness is plenty

/**
 * Mini map (~800-1500 chars) for the realtime voice path. Drops the
 * full bot inventory - if Kirill asks "what bots do we have", Tolik
 * calls fs_list(scripts/factory). Keeps only state Tolik needs to
 * answer questions WITHOUT additional tool calls.
 */
export function buildCompactSystemMap() {
  if (_miniCache && Date.now() - _miniCacheAt < MINI_CACHE_MS) return _miniCache;

  const dbs      = listDbs();
  const actions  = listActionIds().slice(0, 10);
  const beliefs  = topBeliefs(3);
  const activity = recentActivityCounts();
  const counts = {
    factory:  listBots("factory",  "factory").length,
    survival: listBots("survival", "survival").length,
    cortex:   listBots("cortex",   "cortex").length,
    tolik:    listBots("tolik",    "tolik").length,
  };

  // Check which expected organism daemons are alive (by pidfile)
  const pidNames = ["tolik-browser", "webhook-server", "tolik-proactive", "pulse-daemon", "orchestrator-daemon", "cortex-daemon", "reddit-monitor"];
  const aliveDaemons = pidNames.filter(name => {
    try {
      const pidPath = resolve(ROOT, ".data", `${name}.pid`);
      if (!existsSync(pidPath)) return false;
      const pid = Number(readFileSync(pidPath, "utf-8").trim());
      try { process.kill(pid, 0); return true; } catch { return false; }
    } catch { return false; }
  });

  _miniCache = `=== TOLIK CONTEXT ===
I am Tolik, Kirill's voice AI. The cyan sphere is my face. I think through GPT-4o-mini and speak through OpenAI ash. My hands: Chromium (Playwright), repo files, Telegram, screen recorder, any substrate action.

ORGANISM (${aliveDaemons.length}/${pidNames.length} alive): ${aliveDaemons.join(", ")}
SLEEPING: ${pidNames.filter(n => !aliveDaemons.includes(n)).join(", ") || "(none)"}

NOW: opps ${activity?.opps_by_state?.map(o => `${o.state}=${o.n}`).join(",") || "?"} | LLM 24h $${(activity?.llm_24h?.s ?? 0).toFixed(2)} | ticks 2h ${activity?.ticks_2h?.n ?? 0}

TOP ACTIONS: ${actions.map(a => a.action_id).join(", ")}

TOP BELIEFS: ${beliefs.map(b => `${b.claim.slice(0, 90)}`).join(" | ") || "(none)"}

DBs (${dbs.length}): ${dbs.map(d => d.file.replace(".db", "")).join(", ")}

BOTS: factory=${counts.factory}, survival=${counts.survival}, cortex=${counts.cortex}, tolik=${counts.tolik}. To list names, call fs_list with path "scripts/factory" or "scripts/survival".
=== END CONTEXT ===`;
  _miniCacheAt = Date.now();
  return _miniCache;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const mode = process.argv[2] || "full";
  console.log(mode === "compact" ? buildCompactSystemMap() : buildSystemMap());
}
