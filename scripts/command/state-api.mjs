/**
 * scripts/command/state-api.mjs
 *
 * GET /api/state/* — read-only endpoints powering the COMMAND dashboard.
 * Mounted into webhook-server.mjs. All endpoints read from existing
 * substrate sources (no new tables, no caching layer):
 *   - survival.db: opportunities, policy_strategies, llm_call_log
 *   - organism.db: outcome_ledger, beliefs (when present)
 *   - .data/command/morning-brief.json (synth output)
 *   - scripts/command/tenants/<id>.json (multi-tenant config)
 *
 * Pure data layer — no LLM calls here. Brief synthesis happens in
 * scripts/command/morning-brief.mjs and writes the JSON file this reads.
 *
 * Response shape per endpoint:
 *   /metrics       { pipeline_usd, pipeline_delta_pct, decisions_due, active_builds }
 *   /departments   [ { name, status, message } ]   six fixed departments
 *   /health        [ { label, pct, gradient } ]    five fixed dimensions
 *   /brief         { generated_at, text, pills }   from morning-brief.json
 *   /opportunities { opportunities, pipeline, automation }   row tabs
 *   /tenant?id=x   { name, logo_word, logo_accent, color_arc, color_gold }
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const SURVIVAL_DB = resolve(ROOT, ".data/survival.db");
const ORGANISM_DB = resolve(ROOT, ".data/organism.db");
const OUTBOUND_QUEUE = resolve(ROOT, ".data/survival-outbound-queue.jsonl");
const BRIEF_PATH = resolve(ROOT, ".data/command/morning-brief.json");
const TENANTS_DIR = resolve(ROOT, "scripts/command/tenants");

function countOutboundAwaiting() {
  if (!existsSync(OUTBOUND_QUEUE)) return 0;
  try {
    let n = 0;
    for (const line of readFileSync(OUTBOUND_QUEUE, "utf-8").split("\n")) {
      if (!line) continue;
      try { const e = JSON.parse(line); if (e.status === "pending") n++; } catch {}
    }
    return n;
  } catch { return 0; }
}

function openReadOnly(path) {
  if (!existsSync(path)) return null;
  try { return new Database(path, { readonly: true, fileMustExist: true }); }
  catch { return null; }
}

function safeRow(db, sql, fallback = null) {
  try { return db.prepare(sql).get() ?? fallback; }
  catch { return fallback; }
}
function safeAll(db, sql, fallback = []) {
  try { return db.prepare(sql).all() ?? fallback; }
  catch { return fallback; }
}

export function getMetrics() {
  const db = openReadOnly(SURVIVAL_DB);
  if (!db) return { pipeline_usd: 0, pipeline_delta_pct: 0, decisions_due: 0, active_builds: 0 };
  const opps = safeRow(db,
    `SELECT COUNT(*) AS n, COALESCE(SUM(money_potential_usd),0) AS total_usd FROM opportunities WHERE state IN ('qualified','researched','planned')`,
    { n: 0, total_usd: 0 });
  const builds = safeRow(db,
    `SELECT COUNT(*) AS n FROM policy_strategies WHERE status='active' AND attempts > 0`,
    { n: 0 });
  // pipeline value: real money_potential_usd if substrate filled it; fallback to count × $5K
  const pipeline_usd = opps.total_usd > 0 ? opps.total_usd : opps.n * 5000;
  // delta % = recent attempts (status changes) last 7 days vs prior 7
  const recent = safeRow(db,
    `SELECT COUNT(*) AS n FROM policy_strategies WHERE status_changed_at > datetime('now','-7 days')`,
    { n: 0 });
  const prior = safeRow(db,
    `SELECT COUNT(*) AS n FROM policy_strategies WHERE status_changed_at > datetime('now','-14 days') AND status_changed_at <= datetime('now','-7 days')`,
    { n: 0 });
  let pipeline_delta_pct = 0;
  if (prior.n > 0) pipeline_delta_pct = Math.round(((recent.n - prior.n) / prior.n) * 100);
  else if (recent.n > 0) pipeline_delta_pct = 100;
  db.close();
  return {
    pipeline_usd,
    pipeline_delta_pct,
    decisions_due: countOutboundAwaiting(),
    active_builds: builds.n,
  };
}

export function getDepartments() {
  const db = openReadOnly(SURVIVAL_DB);
  const out = [];
  // FINANCE: LLM spend last 24h
  const cost = db ? safeRow(db, `SELECT COALESCE(SUM(cost_usd),0) AS s FROM llm_call_log WHERE ts > datetime('now','-24 hours')`, { s: 0 }) : { s: 0 };
  out.push({
    name: "FINANCE",
    status: cost.s > 5 ? "amber" : "green",
    message: `LLM spend 24h: $${cost.s.toFixed(2)}`,
  });
  // SALES: outbound JSONL pending count
  const drafts = countOutboundAwaiting();
  out.push({
    name: "SALES",
    status: drafts > 0 ? "cyan" : "green",
    message: drafts > 0 ? `${drafts} drafts awaiting approval` : "All drafts cleared",
  });
  // OPERATIONS: opps stalled in researched > 3 days
  const blocked = db ? safeRow(db, `SELECT COUNT(*) AS n FROM opportunities WHERE state='researched' AND state_changed_at < datetime('now','-3 days')`, { n: 0 }) : { n: 0 };
  out.push({
    name: "OPERATIONS",
    status: blocked.n > 2 ? "amber" : "green",
    message: blocked.n > 0 ? `${blocked.n} opps stalled > 3 days` : "Pipeline flowing",
  });
  // MARKETING: site_content_generate attempts last 7d
  const content = db ? safeRow(db, `SELECT SUM(attempts) AS n FROM policy_strategies WHERE action_id='site_content_generate' AND status_changed_at > datetime('now','-7 days')`, { n: 0 }) : { n: 0 };
  out.push({
    name: "MARKETING",
    status: content.n > 0 ? "green" : "amber",
    message: `${content.n || 0} content pieces generated this week`,
  });
  // TECHNOLOGY: substrate heartbeat — strategies modified in last 2h
  const heartbeat = db ? safeRow(db, `SELECT COUNT(*) AS n FROM policy_strategies WHERE status_changed_at > datetime('now','-2 hours')`, { n: 0 }) : { n: 0 };
  out.push({
    name: "TECHNOLOGY",
    status: heartbeat.n > 0 ? "green" : "red",
    message: heartbeat.n > 0 ? `Substrate active: ${heartbeat.n} ticks/2h` : "No recent ticks",
  });
  // STRATEGY: top organism belief (by weight)
  const odb = openReadOnly(ORGANISM_DB);
  let strategy_msg = "Verdict pending";
  let strategy_status = "amber";
  if (odb) {
    const verdict = safeRow(odb, `SELECT claim FROM beliefs WHERE weight > 0.7 ORDER BY weight DESC, last_updated DESC LIMIT 1`, null);
    if (verdict?.claim) {
      strategy_msg = String(verdict.claim).slice(0, 80).replace(/\n/g, " ");
      strategy_status = "cyan";
    }
    odb.close();
  }
  out.push({ name: "STRATEGY", status: strategy_status, message: strategy_msg });
  if (db) db.close();
  return out;
}

export function getHealth() {
  const db = openReadOnly(SURVIVAL_DB);
  const buckets = {
    revenue: { attempts: 0, food: 0 },
    pipeline: { attempts: 0, food: 0 },
    marketing: { attempts: 0, food: 0 },
    operations: { attempts: 0, food: 0 },
    tech: { attempts: 0, food: 0 },
  };
  if (db) {
    const rows = safeAll(db, `SELECT action_id, SUM(attempts) AS attempts, SUM(food_received_usd) AS food FROM policy_strategies GROUP BY action_id`);
    for (const r of rows) {
      const id = r.action_id;
      if (["propose_outbound_send","dispatch_to_specialist","telegram_listener"].includes(id)) buckets.revenue.attempts += r.attempts || 0;
      if (["opportunity_deep_research","opportunity_implementation_plan","wishlist_processor"].includes(id)) buckets.pipeline.attempts += r.attempts || 0;
      if (["site_content_generate","site_audit_live","channel_match"].includes(id)) buckets.marketing.attempts += r.attempts || 0;
      if (["factory_status","factory_output_ingest","dispatch_to_factory"].includes(id)) buckets.operations.attempts += r.attempts || 0;
      if (["letta_sleep_bridge","memory_consolidation","prompt_optimizer","internal_feedback"].includes(id)) buckets.tech.attempts += r.attempts || 0;
    }
    db.close();
  }
  const pct = (n, max) => Math.min(100, Math.round((n / max) * 100));
  return [
    { label: "Revenue",    pct: pct(buckets.revenue.attempts, 50),    gradient: "linear-gradient(90deg,#00c8ff,#00e676)" },
    { label: "Pipeline",   pct: pct(buckets.pipeline.attempts, 100),  gradient: "linear-gradient(90deg,#ffab00,#ff8800)" },
    { label: "Marketing",  pct: pct(buckets.marketing.attempts, 30),  gradient: "linear-gradient(90deg,#ff69b4,#ff3d5a)" },
    { label: "Operations", pct: pct(buckets.operations.attempts, 40), gradient: "linear-gradient(90deg,#00c8ff,#00aaff)" },
    { label: "Tech Build", pct: pct(buckets.tech.attempts, 30),       gradient: "linear-gradient(90deg,#c9a84c,#e6c466)" },
  ];
}

export function getBrief() {
  if (!existsSync(BRIEF_PATH)) {
    return {
      generated_at: null,
      text: "Substrate has not yet synthesized today's brief. The morning-brief job runs at 07:00 daily, or manually via `node scripts/command/morning-brief.mjs`.",
      pills: ["AWAITING SYNTH"],
    };
  }
  try {
    const j = JSON.parse(readFileSync(BRIEF_PATH, "utf-8"));
    return { generated_at: j.generated_at, text: j.text, pills: j.pills || [] };
  } catch (e) {
    return { generated_at: null, text: `Brief file unreadable: ${e.message}`, pills: ["ERROR"] };
  }
}

export function getOpportunities() {
  const db = openReadOnly(SURVIVAL_DB);
  if (!db) return { opportunities: [], pipeline: [], automation: [] };
  // OPPORTUNITIES tab: most recently changed regardless of state
  const opportunities = safeAll(db,
    `SELECT id, title, source, state FROM opportunities ORDER BY state_changed_at DESC LIMIT 12`
  ).map(o => ({
    id: o.id,
    title: (o.title || "").slice(0, 80),
    source: o.source || "unknown",
    state: ["qualified","researched","planned","draft"].includes(o.state) ? o.state : "qualified",
  }));
  // PIPELINE tab: only states qualified+
  const pipeline = safeAll(db,
    `SELECT id, title, source, state FROM opportunities WHERE state IN ('qualified','researched','planned','draft') ORDER BY state_changed_at DESC LIMIT 12`
  ).map(o => ({
    id: o.id,
    title: (o.title || "").slice(0, 80),
    source: o.source || "unknown",
    state: o.state,
  }));
  // AUTOMATION tab: top action strategies by attempts
  const automation = safeAll(db,
    `SELECT id, action_id, attempts FROM policy_strategies WHERE status='active' ORDER BY attempts DESC LIMIT 12`
  ).map(s => ({
    id: s.id,
    title: `${s.action_id} (${s.attempts} attempts)`,
    source: "substrate",
    state: "qualified",
  }));
  db.close();
  return { opportunities, pipeline, automation };
}

export function getTenant(id = "default") {
  const path = resolve(TENANTS_DIR, `${(id || "default").replace(/[^a-z0-9_-]/gi, "")}.json`);
  if (existsSync(path)) {
    try { return JSON.parse(readFileSync(path, "utf-8")); }
    catch {}
  }
  // Default Brand OS branding
  return {
    name: "Brand OS",
    logo_word: "BRAND",
    logo_accent: "OS",
    color_arc: "#00c8ff",
    color_gold: "#c9a84c",
    departments: ["FINANCE","SALES","OPERATIONS","MARKETING","TECHNOLOGY","STRATEGY"],
  };
}

export function handleStateRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const path = url.pathname.replace(/^\/api\/state\/?/, "");
  let body;
  try {
    if (path === "metrics") body = getMetrics();
    else if (path === "departments") body = getDepartments();
    else if (path === "health") body = getHealth();
    else if (path === "brief") body = getBrief();
    else if (path === "opportunities") body = getOpportunities();
    else if (path === "tenant") body = getTenant(url.searchParams.get("id") || "default");
    else { res.writeHead(404); res.end(); return; }
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(body));
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: e.message }));
  }
}
