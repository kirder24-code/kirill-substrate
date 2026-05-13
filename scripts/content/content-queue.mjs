/**
 * scripts/content/content-queue.mjs
 *
 * Department-shared queue for post ideas. Anyone (awareness-bot, opp-transition,
 * scout-bot, manual operator) can enqueue. content-orchestrator drains the queue
 * on each tick.
 *
 * Schema: content_queue table (created here, idempotent).
 *
 * API:
 *   enqueueContentIdea({ source, source_ref, priority, idea, post_type, asset_level, recipe })
 *   listPending({ limit })
 *   markProcessed(id, { composed_asset_id, status })
 *   countPendingBySource()
 *   expireStale({ olderThanDays })
 */

import Database from "better-sqlite3";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DB_PATH = resolve(ROOT, ".data/linkedin-brand-os.sqlite");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS content_queue (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at      TEXT NOT NULL,
  source          TEXT NOT NULL,        -- 'awareness' | 'opp-win' | 'scheduled' | 'manual' | 'scout' | 'signal-hook'
  source_ref      TEXT,                 -- signal_id / opp_id / awareness_item_id
  priority        INTEGER DEFAULT 3,    -- 1=highest, 5=lowest
  idea            TEXT NOT NULL,        -- the hook/topic
  post_type       TEXT,                 -- news|sales|educational|provocation|carousel|case_study|general
  asset_level     TEXT,                 -- static|motion|scroll (suggestion; orchestrator can override)
  recipe          TEXT,                 -- (scroll only) recipe name if scroll-fast path
  context         TEXT,                 -- optional extra context (json or text)
  status          TEXT DEFAULT 'pending',  -- pending | composing | composed | rejected | expired
  composed_asset_id TEXT,               -- once composed, link to content_visual_assets.id
  processed_at    TEXT,
  notes           TEXT
);
CREATE INDEX IF NOT EXISTS idx_queue_status ON content_queue(status);
CREATE INDEX IF NOT EXISTS idx_queue_priority ON content_queue(priority);
CREATE INDEX IF NOT EXISTS idx_queue_created ON content_queue(created_at);
`;

function ensureDir(p) { const d = dirname(p); if (!existsSync(d)) mkdirSync(d, { recursive: true }); }
function db() { ensureDir(DB_PATH); const c = new Database(DB_PATH); c.exec(SCHEMA); return c; }

export function ensureSchema() { const c = db(); c.close(); return { ok: true }; }

export function enqueueContentIdea({ source, source_ref = null, priority = 3, idea, post_type = "general", asset_level = "static", recipe = null, context = null, notes = null } = {}) {
  if (!source) return { ok: false, reason: "no_source" };
  if (!idea) return { ok: false, reason: "no_idea" };
  if (!["awareness", "opp-win", "scheduled", "manual", "scout", "signal-hook", "test"].includes(source)) {
    return { ok: false, reason: "unknown_source", source };
  }
  const c = db();
  try {
    // Dedupe: same idea text from same source within last 24h → skip
    const dup = c.prepare(`SELECT id FROM content_queue WHERE source = ? AND idea = ? AND created_at > datetime('now','-1 day')`).get(source, idea);
    if (dup) { c.close(); return { ok: false, reason: "duplicate", existing_id: dup.id }; }
    const r = c.prepare(`INSERT INTO content_queue (created_at, source, source_ref, priority, idea, post_type, asset_level, recipe, context, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`).run(
        new Date().toISOString(), source, source_ref, priority, idea, post_type, asset_level, recipe,
        context ? (typeof context === "string" ? context : JSON.stringify(context)) : null,
        notes
      );
    return { ok: true, id: r.lastInsertRowid };
  } catch (e) {
    return { ok: false, reason: "insert_failed", error: e.message };
  } finally { c.close(); }
}

export function listPending({ limit = 10 } = {}) {
  const c = db();
  try {
    return c.prepare(`SELECT * FROM content_queue WHERE status = 'pending' ORDER BY priority ASC, created_at ASC LIMIT ?`).all(limit);
  } finally { c.close(); }
}

export function pickNext() {
  const rows = listPending({ limit: 1 });
  return rows[0] || null;
}

export function markComposing(id) {
  const c = db();
  try {
    c.prepare(`UPDATE content_queue SET status = 'composing' WHERE id = ?`).run(id);
    return { ok: true };
  } finally { c.close(); }
}

export function markProcessed(id, { composed_asset_id = null, status = "composed", notes = null } = {}) {
  const c = db();
  try {
    c.prepare(`UPDATE content_queue SET status = ?, composed_asset_id = ?, processed_at = ?, notes = COALESCE(?, notes) WHERE id = ?`).run(
      status, composed_asset_id, new Date().toISOString(), notes, id
    );
    return { ok: true };
  } finally { c.close(); }
}

export function countPendingBySource() {
  const c = db();
  try {
    return c.prepare(`SELECT source, COUNT(*) AS n FROM content_queue WHERE status = 'pending' GROUP BY source ORDER BY n DESC`).all();
  } finally { c.close(); }
}

export function expireStale({ olderThanDays = 7 } = {}) {
  const c = db();
  try {
    const r = c.prepare(`UPDATE content_queue SET status = 'expired' WHERE status = 'pending' AND created_at < datetime('now', ?)`).run(`-${olderThanDays} days`);
    return { ok: true, expired: r.changes };
  } finally { c.close(); }
}

export function getQueueDepth() {
  const c = db();
  try {
    const row = c.prepare(`SELECT COUNT(*) AS n FROM content_queue WHERE status = 'pending'`).get();
    return row?.n || 0;
  } finally { c.close(); }
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2] || "list";
  if (cmd === "init") {
    console.log(ensureSchema());
  } else if (cmd === "list") {
    console.log(JSON.stringify(listPending({ limit: 50 }), null, 2));
  } else if (cmd === "count") {
    console.log(JSON.stringify(countPendingBySource(), null, 2));
    console.log(`total pending: ${getQueueDepth()}`);
  } else if (cmd === "enqueue") {
    const idea = process.argv[3];
    const source = process.argv[4] || "manual";
    const asset_level = process.argv[5] || "static";
    const post_type = process.argv[6] || "general";
    console.log(JSON.stringify(enqueueContentIdea({ source, idea, asset_level, post_type }), null, 2));
  } else if (cmd === "expire") {
    console.log(JSON.stringify(expireStale({ olderThanDays: 7 }), null, 2));
  } else {
    console.error("Usage: content-queue.mjs init|list|count|enqueue <idea> [source] [level] [type]|expire");
    process.exit(2);
  }
}
