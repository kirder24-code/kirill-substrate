/**
 * scripts/tolik/intel-tools.mjs
 *
 * Convenience wrappers around the substrate DBs so Tolik can answer
 * questions like "who did we DM on Reddit", "what's our outreach
 * pipeline", "how many leads" without needing to write SQL.
 *
 * Mounted as /action/intel_* on browser-agent.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const MAIN_DB = resolve(ROOT, ".data/linkedin-brand-os.sqlite");
const TOUCHES_DB = resolve(ROOT, ".data/touches.db");
const SURVIVAL_DB = resolve(ROOT, ".data/survival.db");

function safe(fn) { try { return fn(); } catch (e) { return { ok: false, reason: "query_failed", error: e.message }; } }

export async function intel_outreach_recent({ n = 10 } = {}) {
  if (!existsSync(MAIN_DB)) return { ok: false, reason: "no_db" };
  return safe(() => {
    const db = new Database(MAIN_DB, { readonly: true });
    const rows = db.prepare(`SELECT id, channel, recipient, status, created_at FROM outreach_emails ORDER BY created_at DESC LIMIT ?`).all(n);
    db.close();
    return { ok: true, count: rows.length, recent: rows };
  });
}

export async function intel_leads_summary() {
  if (!existsSync(MAIN_DB)) return { ok: false, reason: "no_db" };
  return safe(() => {
    const db = new Database(MAIN_DB, { readonly: true });
    const total = db.prepare(`SELECT COUNT(*) AS n FROM leads`).get();
    const by_source = db.prepare(`SELECT source, COUNT(*) AS n FROM leads GROUP BY source ORDER BY n DESC LIMIT 10`).all();
    // schema uses 'stage' not 'status'
    const by_status = db.prepare(`SELECT stage AS status, COUNT(*) AS n FROM leads GROUP BY stage ORDER BY n DESC LIMIT 10`).all();
    const recent = db.prepare(`SELECT name, source, stage AS status, created_at FROM leads ORDER BY created_at DESC LIMIT 5`).all();
    db.close();
    return { ok: true, total: total.n, by_source, by_status, recent };
  });
}

export async function intel_reddit_recent({ n = 10 } = {}) {
  // Look in touches.db (the wider activity log)
  if (!existsSync(TOUCHES_DB)) return { ok: false, reason: "no_touches_db" };
  return safe(() => {
    const db = new Database(TOUCHES_DB, { readonly: true });
    // Try common column shapes
    let rows;
    try {
      rows = db.prepare(`SELECT * FROM touches WHERE channel LIKE '%reddit%' OR source LIKE '%reddit%' ORDER BY rowid DESC LIMIT ?`).all(n);
    } catch {
      rows = db.prepare(`SELECT * FROM touches ORDER BY rowid DESC LIMIT ?`).all(n);
    }
    db.close();
    return { ok: true, count: rows.length, recent: rows };
  });
}

export async function intel_linkedin_recent({ n = 10 } = {}) {
  if (!existsSync(MAIN_DB)) return { ok: false, reason: "no_db" };
  return safe(() => {
    const db = new Database(MAIN_DB, { readonly: true });
    // published_posts is the LinkedIn output table
    const rows = db.prepare(`SELECT * FROM published_posts ORDER BY rowid DESC LIMIT ?`).all(n);
    db.close();
    return { ok: true, count: rows.length, recent: rows };
  });
}

export async function intel_substrate_overview() {
  if (!existsSync(SURVIVAL_DB)) return { ok: false, reason: "no_survival_db" };
  return safe(() => {
    const db = new Database(SURVIVAL_DB, { readonly: true });
    const opps = db.prepare(`SELECT state, COUNT(*) AS n FROM opportunities GROUP BY state`).all();
    const top_actions = db.prepare(`SELECT action_id, attempts, food_received_usd FROM policy_strategies WHERE attempts > 0 ORDER BY attempts DESC LIMIT 10`).all();
    const llm_24h = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(cost_usd),0) AS s FROM llm_call_log WHERE ts > datetime('now','-24 hours')`).get();
    const llm_7d = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(cost_usd),0) AS s FROM llm_call_log WHERE ts > datetime('now','-7 days')`).get();
    db.close();
    return { ok: true, opps_by_state: opps, top_actions, llm_24h, llm_7d };
  });
}

export async function intel_files_recent({ dir = ".data", n = 15 } = {}) {
  const abs = resolve(ROOT, dir);
  if (!existsSync(abs)) return { ok: false, reason: "no_dir" };
  return safe(() => {
    const entries = readdirSync(abs).map(name => {
      const sub = resolve(abs, name);
      try {
        const s = statSync(sub);
        return { name, kind: s.isDirectory() ? "dir" : "file", size: s.isFile() ? s.size : null, mtime: s.mtime.toISOString() };
      } catch { return null; }
    }).filter(Boolean).sort((a, b) => b.mtime.localeCompare(a.mtime)).slice(0, n);
    return { ok: true, dir, recent: entries };
  });
}
