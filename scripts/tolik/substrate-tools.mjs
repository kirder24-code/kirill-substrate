/**
 * scripts/tolik/substrate-tools.mjs
 *
 * Tolik's substrate hands: invoke any registered action, query any
 * substrate database read-only, search wiki-archive. This is how Tolik
 * pulls levers in the system - not just answer questions, but DO things.
 *
 * Public actions:
 *   sub_run_action({action_id, params}) — invoke any action from
 *      action-catalog.mjs. Uses runAction() so budget-guard fires
 *      and the call is logged as a regular substrate tick.
 *   sub_query_db({db, sql, args}) — read-only SQL query.
 *      db ∈ {survival, organism, cortex, factory, leads, ...}
 *      Strips dangerous statements; only SELECT/EXPLAIN allowed.
 *   sub_wiki({query}) — full-text search across .data/wiki-archive/*.md
 *   sub_tail_log({name, n}) — log tail (alias to fs-tools)
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

import { runAction } from "../survival/action-catalog.mjs";
import { fs_tail_log } from "./fs-tools.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const WIKI_DIR = resolve(ROOT, ".data/wiki-archive");

// DBs Tolik can query. Audited 2026-05-12:
//   POPULATED (use these):
//     survival       (5 tables, opportunities/wishlist)
//     organism       (13 tables, 591 beliefs + outcomes)
//     factory        (1 table)
//     outreach       (2 tables)
//     touches        (3 tables)
//     linkedin-brand-os.sqlite — primary (78 tables, 5220 leads)
//   RESERVED (empty namespace; will return empty results, not error):
//     cortex, leads, brand, scout, pipeline, brain, icp
// Note: query "leads" namespace returns empty — the real leads table lives
// in linkedin-brand-os.sqlite. Use db: "linkedin-brand-os" or call
// intel_leads_summary() instead.
const DB_MAP = {
  survival:            ".data/survival.db",
  organism:            ".data/organism.db",
  cortex:              ".data/cortex.db",       // reserved, empty
  factory:             ".data/factory.db",
  leads:               ".data/leads.db",        // reserved, empty (real leads in linkedin-brand-os)
  brand:               ".data/brand.db",        // reserved, empty
  "brand-os":          ".data/brand-os.db",
  outreach:            ".data/outreach.db",
  scout:               ".data/scout.db",        // reserved, empty
  pipeline:            ".data/pipeline.db",     // reserved, empty
  business:            ".data/business.db",
  touches:             ".data/touches.db",
  brain:               ".data/brain.db",        // reserved, empty
  icp:                 ".data/icp.db",          // reserved, empty
  "linkedin-brand-os": ".data/linkedin-brand-os.sqlite", // PRIMARY: leads, llm_calls, posts, etc.
};

export async function sub_run_action({ action_id, params = {} }) {
  if (!action_id) return { ok: false, reason: "no_action_id" };
  try {
    const fake_strategy = {
      id: `tolik-direct-${Date.now()}`,
      action_id,
      parameters: params,
    };
    const result = await runAction(action_id, { strategy: fake_strategy, deps: {} });
    return { ok: true, action_id, result };
  } catch (e) {
    return { ok: false, reason: "action_threw", error: e.message };
  }
}

export async function sub_query_db({ db, sql, args = [] }) {
  if (!db || !sql) return { ok: false, reason: "need_db_and_sql" };
  const path = DB_MAP[db] || (db.startsWith(".data/") ? db : null);
  if (!path) return { ok: false, reason: "unknown_db", known: Object.keys(DB_MAP) };
  const abs = resolve(ROOT, path);
  if (!existsSync(abs)) return { ok: false, reason: "db_file_missing", path };
  // Guard rails: only SELECT/EXPLAIN/PRAGMA allowed
  const upper = sql.trim().toUpperCase();
  if (!/^(SELECT|EXPLAIN|PRAGMA|WITH)\b/.test(upper)) {
    return { ok: false, reason: "only_read_queries_allowed", hint: "use SELECT" };
  }
  try {
    const database = new Database(abs, { readonly: true, fileMustExist: true });
    const stmt = database.prepare(sql);
    const rows = stmt.all(...(Array.isArray(args) ? args : []));
    database.close();
    return { ok: true, db, sql, rows: rows.slice(0, 200), row_count: rows.length };
  } catch (e) { return { ok: false, reason: "query_failed", error: e.message }; }
}

export async function sub_wiki({ query, max_hits = 6 }) {
  if (!query) return { ok: false, reason: "no_query" };
  if (!existsSync(WIKI_DIR)) return { ok: false, reason: "wiki_dir_missing" };
  const q = query.toLowerCase();
  const hits = [];
  for (const f of readdirSync(WIKI_DIR)) {
    if (!f.endsWith(".md")) continue;
    try {
      const content = readFileSync(resolve(WIKI_DIR, f), "utf-8");
      const lower = content.toLowerCase();
      const idx = lower.indexOf(q);
      if (idx >= 0) {
        const start = Math.max(0, idx - 120);
        const snippet = content.slice(start, idx + 280).replace(/\n+/g, " ");
        let title = f;
        const m = content.match(/title:\s*["']?([^"'\n]+)/);
        if (m) title = m[1].trim();
        hits.push({ file: f, title, snippet });
      }
    } catch {}
    if (hits.length >= max_hits) break;
  }
  return { ok: true, query, hits };
}

export async function sub_tail_log(args) { return fs_tail_log(args); }

/**
 * morning_brief — read the substrate's morning brief synthesized for Kirill.
 * This is the SAME content shown in the dashboard's УТРЕННИЙ БРИФ panel:
 * pipeline state, drafts, spend, strategic verdict. Use this WHENEVER Kirill
 * asks "бриф", "утренний бриф", "сводка", "что у нас сегодня", "доброе утро".
 * It is NOT world news — it is substrate self-state.
 */
export async function morning_brief() {
  const briefPath = resolve(ROOT, ".data/command/morning-brief.json");
  if (!existsSync(briefPath)) {
    return { ok: false, reason: "no_brief_synthesized_yet", hint: "Бриф ещё не синтезирован сегодня. Подожди пока morning-brief.mjs его соберёт, или запусти вручную: node scripts/command/morning-brief.mjs" };
  }
  try {
    const j = JSON.parse(readFileSync(briefPath, "utf-8"));
    return {
      ok: true,
      generated_at: j.generated_at,
      text: j.text || "",
      pills: j.pills || [],
      drafts_awaiting: j.source_stats?.drafts_awaiting ?? null,
      opps_by_state: j.source_stats?.opps_by_state || {},
      llm_spend_24h: j.source_stats?.llm_spend_24h ?? null,
      top_actions_7d: j.source_stats?.top_actions_7d || [],
      strategic_verdict: j.source_stats?.strategic_verdict || "",
    };
  } catch (e) {
    return { ok: false, reason: "brief_parse_failed", error: e.message };
  }
}
