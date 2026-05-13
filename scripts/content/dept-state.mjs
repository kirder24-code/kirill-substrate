/**
 * scripts/content/dept-state.mjs
 *
 * Writes .data/content/department-state.json — a single-file live snapshot of
 * the Content Department state. Read by:
 *   - cortex-conversation (when asked "what is content dept doing")
 *   - orchestrator-loop / morning brief
 *   - Tolik's content_status() tool
 *   - any future bot that wants to coordinate
 *
 * Updated by content-orchestrator on every tick (success or skip).
 */

import Database from "better-sqlite3";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DB_PATH = resolve(ROOT, ".data/linkedin-brand-os.sqlite");
const STATE_PATH = resolve(ROOT, ".data/content/department-state.json");

function ensureDir(p) { const d = dirname(p); if (!existsSync(d)) mkdirSync(d, { recursive: true }); }

export function readState() {
  if (!existsSync(STATE_PATH)) return null;
  try { return JSON.parse(readFileSync(STATE_PATH, "utf-8")); }
  catch { return null; }
}

export function refreshState({ status_note = null } = {}) {
  ensureDir(STATE_PATH);
  const c = new Database(DB_PATH, { readonly: true });
  let snapshot = {};
  try {
    const queueDepth = c.prepare(`SELECT COUNT(*) AS n FROM content_queue WHERE status='pending'`).get()?.n || 0;
    const composingCount = c.prepare(`SELECT COUNT(*) AS n FROM content_queue WHERE status='composing'`).get()?.n || 0;
    const lastFire = c.prepare(`SELECT created_at, asset_level, template_type, status, slug FROM content_visual_assets ORDER BY created_at DESC LIMIT 1`).get();
    const lastPublished = c.prepare(`SELECT published_at, slug, published_url FROM content_visual_assets WHERE status='approved' OR status='published' OR published_at IS NOT NULL ORDER BY COALESCE(published_at, created_at) DESC LIMIT 1`).get();
    const postsThisWeek = c.prepare(`SELECT COUNT(*) AS n FROM content_visual_assets WHERE created_at > datetime('now','-7 days')`).get()?.n || 0;
    const postsApprovedThisWeek = c.prepare(`SELECT COUNT(*) AS n FROM content_visual_assets WHERE status IN ('approved','published') AND COALESCE(published_at, created_at) > datetime('now','-7 days')`).get()?.n || 0;
    const last24hCount = c.prepare(`SELECT COUNT(*) AS n FROM content_visual_assets WHERE created_at > datetime('now','-1 day')`).get()?.n || 0;
    const bySource = c.prepare(`SELECT source, COUNT(*) AS n FROM content_queue WHERE status='pending' GROUP BY source`).all();
    snapshot = {
      schema_version: 1,
      department: "content",
      generated_at: new Date().toISOString(),
      status_note,
      queue: {
        depth: queueDepth,
        composing: composingCount,
        by_source: Object.fromEntries(bySource.map(r => [r.source, r.n])),
      },
      last_fire: lastFire ? {
        at: lastFire.created_at,
        slug: lastFire.slug,
        asset_level: lastFire.asset_level,
        template_type: lastFire.template_type,
        status: lastFire.status,
      } : null,
      last_published: lastPublished ? {
        at: lastPublished.published_at || null,
        slug: lastPublished.slug,
        url: lastPublished.published_url,
      } : null,
      cadence: {
        posts_last_7d: postsThisWeek,
        approved_last_7d: postsApprovedThisWeek,
        composed_last_24h: last24hCount,
        weekly_cap: 2,           // per memory rule: 1-2 posts/week
        daily_autonomous_cap: 1, // per D7 anti-spam
      },
      next_action: queueDepth > 0 ? "drain_queue" : "wait_for_signal",
    };
  } catch (e) {
    snapshot = {
      schema_version: 1,
      department: "content",
      generated_at: new Date().toISOString(),
      status_note: `state_read_failed: ${e.message}`,
      error: true,
    };
  } finally { c.close(); }
  writeFileSync(STATE_PATH, JSON.stringify(snapshot, null, 2));
  return snapshot;
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const r = refreshState({ status_note: "cli_invocation" });
  console.log(JSON.stringify(r, null, 2));
}
