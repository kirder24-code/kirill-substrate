/**
 * scripts/content/content-store.mjs
 *
 * Persistence layer for content assets. Tracks every visual + post from idea
 * through publication. One row per asset.
 *
 * Lives in linkedin-brand-os.sqlite (the primary DB).
 *
 * Schema:
 *   id              TEXT PRIMARY KEY    e.g. "asset-1778695000-substrate-flow"
 *   slug            TEXT NOT NULL       e.g. "substrate-flow-card"
 *   created_at      TEXT NOT NULL       ISO timestamp
 *   updated_at      TEXT NOT NULL
 *   idea_source     TEXT                "awareness" | "scout" | "opp-transition" | "manual" | "proactive"
 *   idea_source_ref TEXT                source row id / file path
 *   idea_text       TEXT                the original idea
 *   brief_json      TEXT                full visual brief JSON
 *   post_text       TEXT                LinkedIn post copy
 *   template_type   TEXT                "idea-card" | "carousel-slide" | "news-card" | "stat-hero" | "quote-card" | "before-after" | "system-diagram" | "proof-frame"
 *   accent_color    TEXT                "cyan" | "gold" | "red" | "green" | "amber"
 *   layout_variant  TEXT                e.g. "top" | "center" | "bottom"
 *   channel         TEXT                "linkedin" | "threads" | "reddit" | "internal"
 *   audience        TEXT                "au-rdti" | "ca-lift" | "intel-upwork" | "calgary-smb" | "general"
 *   linked_opp_id   TEXT                FK to opportunities.id (optional)
 *   linked_isc_id   TEXT                ISC-N reference (optional)
 *   asset_dir       TEXT                ".data/content-assets/<slug>"
 *   png_path        TEXT                relative to repo root
 *   variant_count   INTEGER             how many variants were rendered
 *   judge_score     REAL                final variant score (0..1)
 *   judge_reason    TEXT                why this variant won
 *   status          TEXT                "draft" | "approved" | "published" | "rejected" | "scheduled"
 *   scheduled_for   TEXT                ISO if status=scheduled
 *   published_at    TEXT                ISO when published
 *   published_url   TEXT                LinkedIn/Threads/Reddit post URL
 *   metrics_json    TEXT                {impressions, reactions, comments, shares}
 *   metrics_at      TEXT                last metrics refresh
 *
 * Public API:
 *   ensureSchema()                       — idempotent create
 *   saveAsset(row)                       — insert
 *   updateAsset(id, patch)               — partial update
 *   getAsset(id)                         — by id
 *   getBySlug(slug)                      — by slug
 *   listRecent({ days, channel, audience, status })   — filtered list
 *   countByTemplate({ days })            — for variety enforcement
 *   getStyleHistory({ days, channel })   — what styles ran recently
 */

import Database from "better-sqlite3";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync } from "node:fs";
import crypto from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DB_PATH = resolve(ROOT, ".data/linkedin-brand-os.sqlite");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS content_visual_assets (
  id              TEXT PRIMARY KEY,
  slug            TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  idea_source     TEXT,
  idea_source_ref TEXT,
  idea_text       TEXT,
  brief_json      TEXT,
  post_text       TEXT,
  template_type   TEXT,
  accent_color    TEXT,
  layout_variant  TEXT,
  channel         TEXT,
  audience        TEXT,
  linked_opp_id   TEXT,
  linked_isc_id   TEXT,
  asset_dir       TEXT,
  png_path        TEXT,
  variant_count   INTEGER DEFAULT 1,
  judge_score     REAL,
  judge_reason    TEXT,
  status          TEXT DEFAULT 'draft',
  scheduled_for   TEXT,
  published_at    TEXT,
  published_url   TEXT,
  metrics_json    TEXT,
  metrics_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_assets_created ON content_visual_assets(created_at);
CREATE INDEX IF NOT EXISTS idx_assets_channel ON content_visual_assets(channel);
CREATE INDEX IF NOT EXISTS idx_assets_audience ON content_visual_assets(audience);
CREATE INDEX IF NOT EXISTS idx_assets_status ON content_visual_assets(status);
CREATE INDEX IF NOT EXISTS idx_assets_template ON content_visual_assets(template_type);
CREATE INDEX IF NOT EXISTS idx_assets_opp ON content_visual_assets(linked_opp_id);
`;

const ADDITIONAL_COLS = [
  // Variant C spec columns: asset_level static|motion|scroll, paths {mp4,gif,html,pdf,scroll_mp4},
  // telegram_message_id (proves dispatch happened), brief_json_path (absolute), elapsed_ms.
  // callback_token: 10-hex short id used in Telegram inline-button callback_data (asset_id exceeds 64-byte TG limit).
  ["asset_level",          "TEXT"],
  ["paths",                "TEXT"],
  ["telegram_message_id",  "INTEGER"],
  ["brief_json_path",      "TEXT"],
  ["elapsed_ms",           "INTEGER"],
  ["callback_token",       "TEXT"],
  // Department integration columns: full content payload travels with the asset.
  ["post_text",            "TEXT"],
  ["hashtags",             "TEXT"],   // JSON array
  ["purpose",              "TEXT"],
  ["suggested_post_at",    "TEXT"],
  ["source_signal_id",     "TEXT"],
];

function ensureDir(p) { const d = dirname(p); if (!existsSync(d)) mkdirSync(d, { recursive: true }); }

function db() {
  ensureDir(DB_PATH);
  const c = new Database(DB_PATH);
  c.exec(SCHEMA);
  for (const [name, type] of ADDITIONAL_COLS) {
    try { c.exec(`ALTER TABLE content_visual_assets ADD COLUMN ${name} ${type}`); }
    catch (e) { /* already exists */ }
  }
  return c;
}

export function ensureSchema() { const c = db(); c.close(); return { ok: true }; }

function makeId(slug) {
  const h = crypto.createHash("sha256").update(slug + Date.now()).digest("hex").slice(0, 6);
  return `asset-${Date.now()}-${slug.slice(0, 32)}-${h}`;
}

function makeCallbackToken(id) {
  return crypto.createHash("sha256").update(id).digest("hex").slice(0, 10);
}

export function getByCallbackToken(token) {
  if (!token) return null;
  const c = db();
  try { return parseJsonFields(c.prepare(`SELECT * FROM content_visual_assets WHERE callback_token = ?`).get(token)); }
  finally { c.close(); }
}

const COLS = [
  "slug", "idea_source", "idea_source_ref", "idea_text", "brief_json", "post_text",
  "template_type", "accent_color", "layout_variant", "channel", "audience",
  "linked_opp_id", "linked_isc_id", "asset_dir", "png_path",
  "variant_count", "judge_score", "judge_reason", "status",
  "scheduled_for", "published_at", "published_url", "metrics_json", "metrics_at",
  "asset_level", "paths", "telegram_message_id", "brief_json_path", "elapsed_ms",
  "callback_token",
  "hashtags", "purpose", "suggested_post_at", "source_signal_id",
];

export function saveAsset(row) {
  if (!row?.slug) return { ok: false, reason: "no_slug" };
  const id = row.id || makeId(row.slug);
  const callback_token = row.callback_token || makeCallbackToken(id);
  const now = new Date().toISOString();
  const c = db();
  try {
    const fields = ["id", "created_at", "updated_at", ...COLS];
    const placeholders = fields.map(() => "?").join(", ");
    const rowWithToken = { ...row, callback_token };
    const values = [id, now, now, ...COLS.map(k => {
      const v = rowWithToken[k];
      if (v == null) return null;
      if (typeof v === "object") return JSON.stringify(v);
      return v;
    })];
    c.prepare(`INSERT INTO content_visual_assets (${fields.join(", ")}) VALUES (${placeholders})`).run(...values);
    return { ok: true, id, callback_token };
  } catch (e) {
    return { ok: false, reason: "insert_failed", error: e.message };
  } finally { c.close(); }
}

export function updateAsset(id, patch) {
  if (!id) return { ok: false, reason: "no_id" };
  const allowed = COLS.filter(k => k in patch);
  if (allowed.length === 0) return { ok: false, reason: "empty_patch" };
  const c = db();
  try {
    const sets = allowed.map(k => `${k} = ?`).concat(["updated_at = ?"]);
    const values = allowed.map(k => {
      const v = patch[k];
      if (v == null) return null;
      if (typeof v === "object") return JSON.stringify(v);
      return v;
    }).concat([new Date().toISOString(), id]);
    c.prepare(`UPDATE content_visual_assets SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    return { ok: true, id };
  } catch (e) {
    return { ok: false, reason: "update_failed", error: e.message };
  } finally { c.close(); }
}

function parseJsonFields(row) {
  if (!row) return null;
  for (const f of ["brief_json", "metrics_json"]) {
    if (row[f]) try { row[f.replace("_json", "")] = JSON.parse(row[f]); } catch {}
  }
  return row;
}

export function getAsset(id) {
  const c = db();
  try { return parseJsonFields(c.prepare(`SELECT * FROM content_visual_assets WHERE id = ?`).get(id)); }
  finally { c.close(); }
}

export function getBySlug(slug) {
  const c = db();
  try {
    const rows = c.prepare(`SELECT * FROM content_visual_assets WHERE slug = ? ORDER BY created_at DESC`).all(slug);
    return rows.map(parseJsonFields);
  } finally { c.close(); }
}

export function listRecent({ days = 30, channel, audience, status, limit = 50 } = {}) {
  const c = db();
  try {
    const conds = [`created_at > datetime('now', '-' || ? || ' days')`];
    const args = [days];
    if (channel) { conds.push(`channel = ?`); args.push(channel); }
    if (audience) { conds.push(`audience = ?`); args.push(audience); }
    if (status) { conds.push(`status = ?`); args.push(status); }
    const rows = c.prepare(`SELECT * FROM content_visual_assets WHERE ${conds.join(" AND ")} ORDER BY created_at DESC LIMIT ?`).all(...args, limit);
    return rows.map(parseJsonFields);
  } finally { c.close(); }
}

export function countByTemplate({ days = 14 } = {}) {
  const c = db();
  try {
    return c.prepare(`SELECT template_type, COUNT(*) AS n FROM content_visual_assets WHERE created_at > datetime('now', '-' || ? || ' days') GROUP BY template_type ORDER BY n DESC`).all(days);
  } finally { c.close(); }
}

export function getStyleHistory({ days = 14, channel } = {}) {
  const c = db();
  try {
    const conds = [`created_at > datetime('now', '-' || ? || ' days')`];
    const args = [days];
    if (channel) { conds.push(`channel = ?`); args.push(channel); }
    return c.prepare(`SELECT template_type, accent_color, layout_variant, created_at FROM content_visual_assets WHERE ${conds.join(" AND ")} ORDER BY created_at DESC LIMIT 30`).all(...args);
  } finally { c.close(); }
}

// CLI: `node content-store.mjs init` | `node content-store.mjs list [days]`
if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2] || "list";
  if (cmd === "init") {
    console.log(ensureSchema());
  } else if (cmd === "list") {
    const days = parseInt(process.argv[3] || "30");
    const rows = listRecent({ days });
    console.log(`${rows.length} assets in last ${days}d:`);
    for (const r of rows) {
      console.log(`  ${r.created_at.slice(0, 16)} [${r.template_type}/${r.accent_color}] ${r.slug} (${r.status}) → ${(r.idea_text || "").slice(0, 60)}`);
    }
  } else if (cmd === "templates") {
    console.log(countByTemplate({ days: 14 }));
  } else if (cmd === "history") {
    console.log(getStyleHistory({ days: 14 }));
  } else {
    console.error("Usage: content-store.mjs init|list [days]|templates|history");
    process.exit(2);
  }
}
