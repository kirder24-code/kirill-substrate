/**
 * CORTEX MEMORY SYSTEM
 *
 * Four types of memory (based on cognitive science - CoALA framework):
 *
 * 1. EPISODIC - "what happened" - specific events with outcomes
 *    "On April 16, I sent 103 cold emails about workflow automation. 0 replied."
 *    "On April 17, idea-bot found vibe-code rescue has strong demand on r/vibecoding."
 *
 * 2. SEMANTIC - "what I know" - facts about the world
 *    "Dental clinics in Calgary average 200 calls/month"
 *    "Vapi costs $0.13-0.33 per minute"
 *    "Competitor charges $2K for code audit services"
 *
 * 3. PROCEDURAL - "how to do things" - learned best practices
 *    "Reddit comment-first gets 10x more replies than DMs"
 *    "Emails with 'missed calls' in subject get 5% open rate"
 *    "Never use em-dashes in outreach text"
 *
 * 4. WORKING - "what I'm doing now" - current context
 *    "Current focus: SaaS founders (60%), service businesses (40%)"
 *    "Today's priority: draft 5 expert comments on r/vibecoding for vibe-code founders"
 *
 * The brain READS all memory before thinking.
 * The brain WRITES new memories after every action.
 * Memories are NEVER deleted - only marked as outdated with reason.
 */

import Database from "better-sqlite3";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = resolve(__dirname, "../../.data/linkedin-brand-os.sqlite");

export function initMemory() {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS cortex_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK(type IN ('episodic', 'semantic', 'procedural', 'working')),
      category TEXT,
      content TEXT NOT NULL,
      source TEXT,
      confidence REAL DEFAULT 0.5,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT,
      outdated INTEGER DEFAULT 0,
      outdated_reason TEXT,
      used_count INTEGER DEFAULT 0,
      last_used_at TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS cortex_kpd (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bot_name TEXT NOT NULL,
      run_at TEXT DEFAULT (datetime('now')),
      cost_usd REAL DEFAULT 0,
      output_summary TEXT,
      output_value REAL DEFAULT 0,
      kpd_score REAL DEFAULT 0,
      notes TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS cortex_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      decided_at TEXT DEFAULT (datetime('now')),
      context_summary TEXT,
      decision TEXT NOT NULL,
      reasoning TEXT,
      actions_taken TEXT,
      outcome TEXT,
      outcome_measured_at TEXT,
      was_good_decision INTEGER
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS cortex_focus (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      direction TEXT NOT NULL,
      allocation_pct INTEGER NOT NULL,
      status TEXT DEFAULT 'active',
      started_at TEXT DEFAULT (datetime('now')),
      revenue_generated REAL DEFAULT 0,
      notes TEXT
    )
  `);

  return db;
}

// ── MEMORY OPERATIONS ───────────────────────────────────────────────────────

export function remember(db, type, content, category = null, source = null, confidence = 0.5) {
  // Dedup: don't store exact same content in same type
  const existing = db.prepare(
    "SELECT id FROM cortex_memory WHERE type = ? AND content = ? AND outdated = 0 LIMIT 1"
  ).get(type, content);
  if (existing) return existing; // already exists

  return db.prepare(`
    INSERT INTO cortex_memory (type, category, content, source, confidence)
    VALUES (?, ?, ?, ?, ?)
  `).run(type, category, content, source, confidence);
}

export function recall(db, type, category = null, limit = 20) {
  if (category) {
    return db.prepare(`
      SELECT * FROM cortex_memory
      WHERE type = ? AND category = ? AND outdated = 0
      ORDER BY created_at DESC LIMIT ?
    `).all(type, category, limit);
  }
  return db.prepare(`
    SELECT * FROM cortex_memory
    WHERE type = ? AND outdated = 0
    ORDER BY created_at DESC LIMIT ?
  `).all(type, limit);
}

export function recallAll(db, limit = 50) {
  return db.prepare(`
    SELECT * FROM cortex_memory
    WHERE outdated = 0
    ORDER BY
      CASE type
        WHEN 'working' THEN 1
        WHEN 'procedural' THEN 2
        WHEN 'episodic' THEN 3
        WHEN 'semantic' THEN 4
      END,
      created_at DESC
    LIMIT ?
  `).all(limit);
}

export function markOutdated(db, id, reason) {
  return db.prepare(`
    UPDATE cortex_memory SET outdated = 1, outdated_reason = ? WHERE id = ?
  `).run(reason, id);
}

export function markUsed(db, id) {
  return db.prepare(`
    UPDATE cortex_memory SET used_count = used_count + 1, last_used_at = datetime('now') WHERE id = ?
  `).run(id);
}

// ── KPD TRACKING ────────────────────────────────────────────────────────────

export function logKPD(db, botName, costUsd, outputSummary, outputValue) {
  const kpd = costUsd > 0 ? outputValue / costUsd : 0;
  return db.prepare(`
    INSERT INTO cortex_kpd (bot_name, cost_usd, output_summary, output_value, kpd_score)
    VALUES (?, ?, ?, ?, ?)
  `).run(botName, costUsd, outputSummary, outputValue, kpd);
}

export function getKPD(db, botName, days = 7) {
  return db.prepare(`
    SELECT bot_name,
      COUNT(*) as runs,
      SUM(cost_usd) as total_cost,
      AVG(kpd_score) as avg_kpd,
      SUM(output_value) as total_value
    FROM cortex_kpd
    WHERE bot_name = ? AND run_at > datetime('now', '-' || ? || ' days')
    GROUP BY bot_name
  `).get(botName, days);
}

export function getAllKPD(db, days = 7) {
  return db.prepare(`
    SELECT bot_name,
      COUNT(*) as runs,
      ROUND(SUM(cost_usd), 2) as total_cost,
      ROUND(AVG(kpd_score), 2) as avg_kpd,
      ROUND(SUM(output_value), 2) as total_value
    FROM cortex_kpd
    WHERE run_at > datetime('now', '-' || ? || ' days')
    GROUP BY bot_name
    ORDER BY avg_kpd DESC
  `).all(days);
}

// ── DECISION LOG ────────────────────────────────────────────────────────────

export function logDecision(db, contextSummary, decision, reasoning, actionsTaken) {
  return db.prepare(`
    INSERT INTO cortex_decisions (context_summary, decision, reasoning, actions_taken)
    VALUES (?, ?, ?, ?)
  `).run(contextSummary, decision, reasoning, actionsTaken);
}

export function getRecentDecisions(db, limit = 10) {
  return db.prepare(`
    SELECT * FROM cortex_decisions ORDER BY decided_at DESC LIMIT ?
  `).all(limit);
}

export function scoreDecision(db, id, wasGood, outcome) {
  return db.prepare(`
    UPDATE cortex_decisions
    SET was_good_decision = ?, outcome = ?, outcome_measured_at = datetime('now')
    WHERE id = ?
  `).run(wasGood ? 1 : 0, outcome, id);
}

// ── FOCUS MANAGEMENT ────────────────────────────────────────────────────────

export function setFocus(db, directions) {
  // directions = [{ direction: "SaaS founders", allocation_pct: 60 }, ...]
  db.prepare("UPDATE cortex_focus SET status = 'archived' WHERE status = 'active'").run();

  const insert = db.prepare(`
    INSERT INTO cortex_focus (direction, allocation_pct, status)
    VALUES (?, ?, 'active')
  `);

  for (const d of directions) {
    insert.run(d.direction, d.allocation_pct);
  }
}

export function getFocus(db) {
  return db.prepare(
    "SELECT * FROM cortex_focus WHERE status = 'active' ORDER BY allocation_pct DESC"
  ).all();
}

// ── CONTEXT BUILDER (for LLM) ───────────────────────────────────────────────

export function buildBrainContext(db) {
  const working = recall(db, "working", null, 5);
  const procedural = recall(db, "procedural", null, 15);
  const episodic = recall(db, "episodic", null, 20);
  const semantic = recall(db, "semantic", null, 15);
  const focus = getFocus(db);
  const decisions = getRecentDecisions(db, 5);
  const kpd = getAllKPD(db, 3);

  return {
    current_focus: focus.map(f => `${f.direction}: ${f.allocation_pct}%`).join(", "),
    working_memory: working.map(m => m.content),
    procedural_memory: procedural.map(m => m.content),
    recent_events: episodic.map(m => `[${m.created_at}] ${m.content}`),
    known_facts: semantic.map(m => m.content),
    recent_decisions: decisions.map(d => `[${d.decided_at}] ${d.decision} (${d.was_good_decision === 1 ? 'GOOD' : d.was_good_decision === 0 ? 'BAD' : 'unknown'})`),
    bot_efficiency: kpd.map(k => `${k.bot_name}: KPD=${k.avg_kpd}, cost=$${k.total_cost}, runs=${k.runs}`),
  };
}
