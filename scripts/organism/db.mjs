// organism/db.mjs — the body of the organism.
// SQLite-backed belief graph that persists across Claude sessions.
// Claude (the LLM) is the larynx; this graph is the memory and self.

import Database from "better-sqlite3";
import { resolve, dirname } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolve(__dirname, "../..");
export const DB_PATH = resolve(PROJECT, ".data/organism.db");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS beliefs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  claim TEXT NOT NULL UNIQUE,
  domain TEXT,
  weight REAL NOT NULL DEFAULT 0.5,
  sources_count INTEGER NOT NULL DEFAULT 0,
  contradictions_count INTEGER NOT NULL DEFAULT 0,
  origin TEXT NOT NULL DEFAULT 'unknown',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_updated TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_beliefs_domain ON beliefs(domain);
CREATE INDEX IF NOT EXISTS idx_beliefs_weight ON beliefs(weight DESC);

CREATE TABLE IF NOT EXISTS belief_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_id INTEGER NOT NULL,
  to_id INTEGER NOT NULL,
  link_type TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 0.5,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(from_id, to_id, link_type),
  FOREIGN KEY(from_id) REFERENCES beliefs(id),
  FOREIGN KEY(to_id) REFERENCES beliefs(id)
);

CREATE INDEX IF NOT EXISTS idx_links_from ON belief_links(from_id);
CREATE INDEX IF NOT EXISTS idx_links_to ON belief_links(to_id);

CREATE TABLE IF NOT EXISTS belief_evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  belief_id INTEGER NOT NULL,
  source_type TEXT NOT NULL,
  source_ref TEXT,
  signal TEXT NOT NULL,
  signal_strength REAL NOT NULL DEFAULT 0.5,
  observed_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(belief_id) REFERENCES beliefs(id)
);

CREATE INDEX IF NOT EXISTS idx_evidence_belief ON belief_evidence(belief_id);
CREATE INDEX IF NOT EXISTS idx_evidence_source ON belief_evidence(source_type);

CREATE TABLE IF NOT EXISTS belief_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  belief_id INTEGER,
  op TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  reason TEXT,
  source_type TEXT,
  source_ref TEXT
);

CREATE INDEX IF NOT EXISTS idx_log_ts ON belief_log(ts DESC);
CREATE INDEX IF NOT EXISTS idx_log_belief ON belief_log(belief_id);

CREATE TABLE IF NOT EXISTS outcomes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL,
  source_ref TEXT,
  signal_type TEXT NOT NULL,
  signal_value REAL,
  description TEXT NOT NULL,
  related_action_type TEXT,
  related_target TEXT,
  observed_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT,
  graph_updates_json TEXT,
  meta_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_outcomes_unprocessed ON outcomes(processed_at) WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_outcomes_source ON outcomes(source_type);
CREATE INDEX IF NOT EXISTS idx_outcomes_observed ON outcomes(observed_at DESC);

CREATE TABLE IF NOT EXISTS claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  claimant TEXT NOT NULL DEFAULT 'claude',
  session_marker TEXT,
  claim_text TEXT NOT NULL,
  context TEXT,
  domain TEXT,
  asserted_weight REAL,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  resolution TEXT,
  resolution_reason TEXT,
  resolution_outcome_id INTEGER
);

CREATE INDEX IF NOT EXISTS idx_claims_unresolved ON claims(resolved_at) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_claims_recent ON claims(recorded_at DESC);

CREATE TABLE IF NOT EXISTS source_credibility (
  source_type TEXT PRIMARY KEY,
  credibility REAL NOT NULL DEFAULT 0.5,
  confirms_count INTEGER NOT NULL DEFAULT 0,
  contradicts_count INTEGER NOT NULL DEFAULT 0,
  total_outcomes INTEGER NOT NULL DEFAULT 0,
  last_updated TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS belief_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  belief_id INTEGER NOT NULL,
  snapshot_date TEXT NOT NULL,
  weight REAL NOT NULL,
  sources_count INTEGER NOT NULL,
  contradictions_count INTEGER NOT NULL,
  UNIQUE(belief_id, snapshot_date),
  FOREIGN KEY(belief_id) REFERENCES beliefs(id)
);

CREATE INDEX IF NOT EXISTS idx_snapshot_belief ON belief_snapshots(belief_id, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_snapshot_date ON belief_snapshots(snapshot_date DESC);

CREATE TABLE IF NOT EXISTS action_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proposed_at TEXT NOT NULL DEFAULT (datetime('now')),
  action_type TEXT NOT NULL,
  target TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  rationale TEXT NOT NULL,
  related_belief_ids TEXT,
  expected_outcome TEXT,
  confidence REAL NOT NULL DEFAULT 0.5,
  status TEXT NOT NULL DEFAULT 'pending',
  approved_at TEXT,
  rejected_at TEXT,
  executed_at TEXT,
  execution_result_json TEXT,
  outcome_id INTEGER
);

CREATE INDEX IF NOT EXISTS idx_proposals_pending ON action_proposals(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_proposals_recent ON action_proposals(proposed_at DESC);

CREATE TABLE IF NOT EXISTS variant_predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  variant TEXT NOT NULL,
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  prediction_text TEXT NOT NULL,
  prediction_json TEXT,
  domain TEXT,
  resolved_at TEXT,
  resolution TEXT,
  resolution_evidence TEXT
);

CREATE INDEX IF NOT EXISTS idx_variant_unresolved ON variant_predictions(resolved_at) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_variant_recent ON variant_predictions(variant, generated_at DESC);

CREATE TABLE IF NOT EXISTS sensor_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  proposed_at TEXT NOT NULL DEFAULT (datetime('now')),
  sensor_name TEXT NOT NULL,
  data_source TEXT NOT NULL,
  blind_spot_description TEXT NOT NULL,
  expected_signals TEXT,
  example_outcomes TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_at TEXT,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_sensors_pending ON sensor_proposals(status) WHERE status = 'pending';
`;

export function openDb() {
  if (!existsSync(dirname(DB_PATH))) {
    mkdirSync(dirname(DB_PATH), { recursive: true });
  }
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}

export function logOp(db, { belief_id = null, op, before = null, after = null, reason = null, source_type = null, source_ref = null }) {
  db.prepare(`
    INSERT INTO belief_log (belief_id, op, before_json, after_json, reason, source_type, source_ref)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    belief_id,
    op,
    before ? JSON.stringify(before) : null,
    after ? JSON.stringify(after) : null,
    reason,
    source_type,
    source_ref
  );
}

export function upsertBelief(db, { claim, domain = null, weight = 0.5, origin = "unknown", source_type = null, source_ref = null, signal = null, signal_strength = null, reason = null }) {
  const existing = db.prepare("SELECT * FROM beliefs WHERE claim = ?").get(claim);

  if (existing) {
    const oldWeight = existing.weight;
    const oldSourceCount = existing.sources_count;
    const newWeight = updatedWeight(oldWeight, oldSourceCount, weight);
    const newSourceCount = oldSourceCount + 1;

    db.prepare(`
      UPDATE beliefs
      SET weight = ?, sources_count = ?, last_updated = datetime('now')
      WHERE id = ?
    `).run(newWeight, newSourceCount, existing.id);

    if (signal) {
      db.prepare(`
        INSERT INTO belief_evidence (belief_id, source_type, source_ref, signal, signal_strength)
        VALUES (?, ?, ?, ?, ?)
      `).run(existing.id, source_type, source_ref, signal, signal_strength ?? weight);
    }

    logOp(db, {
      belief_id: existing.id,
      op: "weight_update",
      before: { weight: oldWeight, sources_count: oldSourceCount },
      after: { weight: newWeight, sources_count: newSourceCount },
      reason,
      source_type,
      source_ref,
    });

    return existing.id;
  }

  const result = db.prepare(`
    INSERT INTO beliefs (claim, domain, weight, sources_count, origin)
    VALUES (?, ?, ?, ?, ?)
  `).run(claim, domain, weight, signal ? 1 : 0, origin);

  const id = result.lastInsertRowid;

  if (signal) {
    db.prepare(`
      INSERT INTO belief_evidence (belief_id, source_type, source_ref, signal, signal_strength)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, source_type, source_ref, signal, signal_strength ?? weight);
  }

  logOp(db, {
    belief_id: id,
    op: "create",
    after: { claim, domain, weight, origin },
    reason,
    source_type,
    source_ref,
  });

  return id;
}

// Bayesian-flavoured weight update: existing belief with N sources gets new evidence.
// New weight is a precision-weighted average. Source count grows confidence.
function updatedWeight(oldWeight, oldSourceCount, newSignal) {
  const oldPrecision = oldSourceCount + 1;
  const newPrecision = 1;
  const total = oldPrecision + newPrecision;
  return (oldWeight * oldPrecision + newSignal * newPrecision) / total;
}

export function addLink(db, { from_id, to_id, link_type, weight = 0.5 }) {
  db.prepare(`
    INSERT INTO belief_links (from_id, to_id, link_type, weight)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(from_id, to_id, link_type) DO UPDATE SET weight = excluded.weight
  `).run(from_id, to_id, link_type, weight);
}

export function recordContradiction(db, { belief_id, source_type, source_ref, reason }) {
  const before = db.prepare("SELECT contradictions_count, weight FROM beliefs WHERE id = ?").get(belief_id);
  if (!before) return;

  const newWeight = Math.max(0.05, before.weight * 0.85);
  const newCount = before.contradictions_count + 1;

  db.prepare(`
    UPDATE beliefs
    SET contradictions_count = ?, weight = ?, last_updated = datetime('now')
    WHERE id = ?
  `).run(newCount, newWeight, belief_id);

  logOp(db, {
    belief_id,
    op: "contradiction",
    before: { weight: before.weight, contradictions_count: before.contradictions_count },
    after: { weight: newWeight, contradictions_count: newCount },
    reason,
    source_type,
    source_ref,
  });
}

export function getBeliefByClaim(db, claim) {
  return db.prepare("SELECT * FROM beliefs WHERE claim = ?").get(claim);
}

export function topBeliefs(db, { domain = null, limit = 20 } = {}) {
  if (domain) {
    return db.prepare("SELECT * FROM beliefs WHERE domain = ? ORDER BY weight DESC, sources_count DESC LIMIT ?").all(domain, limit);
  }
  return db.prepare("SELECT * FROM beliefs ORDER BY weight DESC, sources_count DESC LIMIT ?").all(limit);
}

export function recentChanges(db, { limit = 30 } = {}) {
  return db.prepare(`
    SELECT l.*, b.claim
    FROM belief_log l
    LEFT JOIN beliefs b ON b.id = l.belief_id
    ORDER BY l.ts DESC
    LIMIT ?
  `).all(limit);
}

export function activeContradictions(db, { limit = 20 } = {}) {
  return db.prepare(`
    SELECT * FROM beliefs
    WHERE contradictions_count > 0
    ORDER BY contradictions_count DESC, weight DESC
    LIMIT ?
  `).all(limit);
}

export function singleSourceRiskyBeliefs(db, { minWeight = 0.6, limit = 20 } = {}) {
  return db.prepare(`
    SELECT * FROM beliefs
    WHERE sources_count <= 1 AND weight >= ?
    ORDER BY weight DESC
    LIMIT ?
  `).all(minWeight, limit);
}

export function listDomains(db) {
  return db.prepare(`
    SELECT domain, COUNT(*) AS count, AVG(weight) AS avg_weight, MAX(weight) AS max_weight
    FROM beliefs
    WHERE domain IS NOT NULL
    GROUP BY domain
    ORDER BY count DESC
  `).all();
}

export function totalBeliefs(db) {
  return db.prepare("SELECT COUNT(*) AS n FROM beliefs").get().n;
}

// ─── Outcomes ──────────────────────────────────────────────────────────────
// An outcome is a real signal from the world: reply / silence / payment / Kirill reaction.
// Outcomes are recorded first, then a separate apply step (apply-outcomes-to-graph.mjs)
// consults Claude to map each outcome onto belief updates.

export function recordOutcome(db, {
  source_type,
  source_ref = null,
  signal_type,
  signal_value = null,
  description,
  related_action_type = null,
  related_target = null,
  observed_at = null,
  meta = null,
}) {
  if (!source_type || !signal_type || !description) {
    throw new Error("recordOutcome requires source_type, signal_type, description");
  }
  const r = db.prepare(`
    INSERT INTO outcomes (
      source_type, source_ref, signal_type, signal_value, description,
      related_action_type, related_target, observed_at, meta_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?)
  `).run(
    source_type, source_ref, signal_type, signal_value, description,
    related_action_type, related_target, observed_at,
    meta ? JSON.stringify(meta) : null
  );
  return r.lastInsertRowid;
}

export function listUnprocessedOutcomes(db, { limit = 20 } = {}) {
  return db.prepare(`
    SELECT * FROM outcomes
    WHERE processed_at IS NULL
    ORDER BY observed_at ASC
    LIMIT ?
  `).all(limit);
}

export function markOutcomeProcessed(db, outcome_id, graphUpdates) {
  db.prepare(`
    UPDATE outcomes
    SET processed_at = datetime('now'), graph_updates_json = ?
    WHERE id = ?
  `).run(JSON.stringify(graphUpdates), outcome_id);
}

export function recentOutcomes(db, { limit = 30 } = {}) {
  return db.prepare(`
    SELECT * FROM outcomes
    ORDER BY observed_at DESC
    LIMIT ?
  `).all(limit);
}

export function totalOutcomes(db) {
  return db.prepare("SELECT COUNT(*) AS n FROM outcomes").get().n;
}

// ─── Claims (Claude's track record) ──────────────────────────────────────
// Every assertion Claude makes about the system gets logged here so future-Claude
// (after session reset) can see what past-Claude said and whether it panned out.

export function recordClaim(db, { claimant = "claude", claim_text, context = null, domain = null, asserted_weight = null, session_marker = null }) {
  const r = db.prepare(`
    INSERT INTO claims (claimant, session_marker, claim_text, context, domain, asserted_weight)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(claimant, session_marker, claim_text, context, domain, asserted_weight);
  return r.lastInsertRowid;
}

export function listUnresolvedClaims(db, { limit = 50 } = {}) {
  return db.prepare(`
    SELECT * FROM claims WHERE resolved_at IS NULL ORDER BY recorded_at DESC LIMIT ?
  `).all(limit);
}

export function resolveClaim(db, claim_id, { resolution, reason, outcome_id = null }) {
  db.prepare(`
    UPDATE claims
    SET resolved_at = datetime('now'),
        resolution = ?,
        resolution_reason = ?,
        resolution_outcome_id = ?
    WHERE id = ?
  `).run(resolution, reason, outcome_id, claim_id);
}

export function recentResolvedClaims(db, { limit = 20 } = {}) {
  return db.prepare(`
    SELECT * FROM claims WHERE resolved_at IS NOT NULL ORDER BY resolved_at DESC LIMIT ?
  `).all(limit);
}

export function claimAccuracyStats(db, { claimant = "claude" } = {}) {
  const totals = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN resolved_at IS NOT NULL THEN 1 ELSE 0 END) AS resolved,
      SUM(CASE WHEN resolution = 'confirmed' THEN 1 ELSE 0 END) AS confirmed,
      SUM(CASE WHEN resolution = 'contradicted' THEN 1 ELSE 0 END) AS contradicted
    FROM claims WHERE claimant = ?
  `).get(claimant);
  return totals;
}

// ─── Source credibility ──────────────────────────────────────────────────

export function getSourceCredibility(db, source_type) {
  const row = db.prepare("SELECT * FROM source_credibility WHERE source_type = ?").get(source_type);
  if (row) return row;
  return { source_type, credibility: 0.5, confirms_count: 0, contradicts_count: 0, total_outcomes: 0 };
}

export function updateSourceCredibility(db, source_type, { confirms = 0, contradicts = 0 }) {
  const row = getSourceCredibility(db, source_type);
  const newConfirms = row.confirms_count + confirms;
  const newContradicts = row.contradicts_count + contradicts;
  const total = newConfirms + newContradicts;
  // Beta-distribution mean with prior alpha=2, beta=2 (slight regularization toward 0.5)
  const newCredibility = total > 0 ? (newConfirms + 2) / (total + 4) : 0.5;
  const newTotal = row.total_outcomes + (confirms || contradicts ? 1 : 0);

  db.prepare(`
    INSERT INTO source_credibility (source_type, credibility, confirms_count, contradicts_count, total_outcomes, last_updated)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(source_type) DO UPDATE SET
      credibility = excluded.credibility,
      confirms_count = excluded.confirms_count,
      contradicts_count = excluded.contradicts_count,
      total_outcomes = excluded.total_outcomes,
      last_updated = excluded.last_updated
  `).run(source_type, newCredibility, newConfirms, newContradicts, newTotal);

  return newCredibility;
}

export function listSourceCredibility(db) {
  return db.prepare(`
    SELECT * FROM source_credibility ORDER BY credibility DESC
  `).all();
}

// ─── Time-series ─────────────────────────────────────────────────────────

export function snapshotAllBeliefs(db, dateLabel = null) {
  const date = dateLabel || new Date().toISOString().slice(0, 10);
  const beliefs = db.prepare("SELECT id, weight, sources_count, contradictions_count FROM beliefs").all();
  const stmt = db.prepare(`
    INSERT INTO belief_snapshots (belief_id, snapshot_date, weight, sources_count, contradictions_count)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(belief_id, snapshot_date) DO UPDATE SET
      weight = excluded.weight,
      sources_count = excluded.sources_count,
      contradictions_count = excluded.contradictions_count
  `);
  let n = 0;
  for (const b of beliefs) {
    stmt.run(b.id, date, b.weight, b.sources_count, b.contradictions_count);
    n++;
  }
  return n;
}

export function getBeliefTrajectory(db, belief_id, days = 14) {
  return db.prepare(`
    SELECT snapshot_date, weight, sources_count, contradictions_count
    FROM belief_snapshots
    WHERE belief_id = ? AND snapshot_date >= date('now', '-' || ? || ' days')
    ORDER BY snapshot_date ASC
  `).all(belief_id, days);
}

export function risingBeliefs(db, { days = 7, minDelta = 0.10, limit = 10 } = {}) {
  // Find beliefs whose weight has consistently risen over the last N days.
  return db.prepare(`
    WITH today AS (
      SELECT belief_id, weight FROM belief_snapshots
      WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM belief_snapshots)
    ),
    past AS (
      SELECT belief_id, weight FROM belief_snapshots
      WHERE snapshot_date <= date('now', '-' || ? || ' days')
      GROUP BY belief_id
      HAVING snapshot_date = MAX(snapshot_date)
    )
    SELECT b.id, b.claim, b.domain, t.weight AS current_weight, p.weight AS past_weight,
           (t.weight - p.weight) AS delta, b.sources_count
    FROM today t
    JOIN past p ON p.belief_id = t.belief_id
    JOIN beliefs b ON b.id = t.belief_id
    WHERE (t.weight - p.weight) >= ?
    ORDER BY delta DESC
    LIMIT ?
  `).all(days, minDelta, limit);
}

export function fallingBeliefs(db, { days = 7, minDelta = 0.10, limit = 10 } = {}) {
  return db.prepare(`
    WITH today AS (
      SELECT belief_id, weight FROM belief_snapshots
      WHERE snapshot_date = (SELECT MAX(snapshot_date) FROM belief_snapshots)
    ),
    past AS (
      SELECT belief_id, weight FROM belief_snapshots
      WHERE snapshot_date <= date('now', '-' || ? || ' days')
      GROUP BY belief_id
      HAVING snapshot_date = MAX(snapshot_date)
    )
    SELECT b.id, b.claim, b.domain, t.weight AS current_weight, p.weight AS past_weight,
           (p.weight - t.weight) AS delta, b.sources_count
    FROM today t
    JOIN past p ON p.belief_id = t.belief_id
    JOIN beliefs b ON b.id = t.belief_id
    WHERE (p.weight - t.weight) >= ?
    ORDER BY delta DESC
    LIMIT ?
  `).all(days, minDelta, limit);
}

// ─── Action proposals ────────────────────────────────────────────────────

export function recordProposal(db, { action_type, target, payload, rationale, related_belief_ids = [], expected_outcome = null, confidence = 0.5 }) {
  const r = db.prepare(`
    INSERT INTO action_proposals (action_type, target, payload_json, rationale, related_belief_ids, expected_outcome, confidence)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(action_type, target, JSON.stringify(payload), rationale, JSON.stringify(related_belief_ids), expected_outcome, confidence);
  return r.lastInsertRowid;
}

export function listPendingProposals(db, { limit = 10 } = {}) {
  return db.prepare(`
    SELECT * FROM action_proposals WHERE status = 'pending' ORDER BY confidence DESC, proposed_at DESC LIMIT ?
  `).all(limit);
}

export function approveProposal(db, id) {
  db.prepare(`UPDATE action_proposals SET status = 'approved', approved_at = datetime('now') WHERE id = ? AND status = 'pending'`).run(id);
}

export function rejectProposal(db, id, notes = null) {
  db.prepare(`UPDATE action_proposals SET status = 'rejected', rejected_at = datetime('now'), execution_result_json = ? WHERE id = ? AND status = 'pending'`).run(JSON.stringify({ notes }), id);
}

export function markExecuted(db, id, result, outcome_id = null) {
  db.prepare(`UPDATE action_proposals SET status = 'executed', executed_at = datetime('now'), execution_result_json = ?, outcome_id = ? WHERE id = ?`).run(JSON.stringify(result), outcome_id, id);
}

// ─── Variant predictions ─────────────────────────────────────────────────

export function recordVariantPrediction(db, { variant, prediction_text, prediction = {}, domain = null }) {
  const r = db.prepare(`
    INSERT INTO variant_predictions (variant, prediction_text, prediction_json, domain)
    VALUES (?, ?, ?, ?)
  `).run(variant, prediction_text, JSON.stringify(prediction), domain);
  return r.lastInsertRowid;
}

export function variantScoreboard(db) {
  return db.prepare(`
    SELECT variant,
      COUNT(*) AS total,
      SUM(CASE WHEN resolved_at IS NOT NULL THEN 1 ELSE 0 END) AS resolved,
      SUM(CASE WHEN resolution = 'confirmed' THEN 1 ELSE 0 END) AS confirmed,
      SUM(CASE WHEN resolution = 'contradicted' THEN 1 ELSE 0 END) AS contradicted
    FROM variant_predictions
    GROUP BY variant
    ORDER BY (CAST(SUM(CASE WHEN resolution = 'confirmed' THEN 1 ELSE 0 END) AS REAL) / NULLIF(SUM(CASE WHEN resolved_at IS NOT NULL THEN 1 ELSE 0 END), 0)) DESC
  `).all();
}

// ─── Sensor proposals ────────────────────────────────────────────────────

export function recordSensorProposal(db, { sensor_name, data_source, blind_spot_description, expected_signals = null, example_outcomes = null }) {
  const r = db.prepare(`
    INSERT INTO sensor_proposals (sensor_name, data_source, blind_spot_description, expected_signals, example_outcomes)
    VALUES (?, ?, ?, ?, ?)
  `).run(sensor_name, data_source, blind_spot_description, expected_signals, example_outcomes);
  return r.lastInsertRowid;
}

export function listPendingSensorProposals(db, { limit = 5 } = {}) {
  return db.prepare(`
    SELECT * FROM sensor_proposals WHERE status = 'pending' ORDER BY proposed_at DESC LIMIT ?
  `).all(limit);
}

export function outcomesByDomainImpact(db, beliefDomainPattern) {
  // Beliefs in this domain that have been touched by outcome-driven log entries.
  return db.prepare(`
    SELECT DISTINCT b.id, b.claim, b.weight, b.domain, b.contradictions_count,
                    COUNT(l.id) AS outcome_touches
    FROM beliefs b
    JOIN belief_log l ON l.belief_id = b.id
    WHERE b.domain LIKE ? AND l.source_type = 'outcome'
    GROUP BY b.id
    ORDER BY outcome_touches DESC
  `).all(beliefDomainPattern);
}
