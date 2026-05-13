/**
 * experiment-portfolio.mjs
 *
 * Lightweight experiment orchestration for outreach.
 * Sits on top of dispatch guardrails. Allows paused segments
 * to receive small bounded test traffic through experiment rows.
 *
 * Built Apr 14 2026 after guardrails correctly paused cold_email (0/18 meaningful).
 * Without this, the system cannot test replacement hypotheses.
 *
 * Usage:
 *   import { getNextExperiment, recordSend, recordReplyOutcome } from "./experiment-portfolio.mjs";
 *   const exp = getNextExperiment(db, { channel: "cold_email", vertical: "Plumber", city: "Calgary" });
 *   if (exp) { // send using exp.template_version }
 *   recordSend(db, exp.id);
 *   recordReplyOutcome(db, exp.id, "meaningful"); // or "noise" or "negative"
 */

function log(msg) { console.log(`${new Date().toISOString()} [experiment] ${msg}`); }

/**
 * Get next eligible experiment matching filters.
 * Returns experiment row or null.
 */
export function getNextExperiment(db, filters = {}) {
  let where = "state = 'active_experiment' AND sends < send_cap";
  const params = [];

  if (filters.channel) { where += " AND channel = ?"; params.push(filters.channel); }
  if (filters.vertical) { where += " AND vertical = ?"; params.push(filters.vertical); }
  if (filters.city) { where += " AND city = ?"; params.push(filters.city); }

  const exp = db.prepare(`
    SELECT * FROM dispatch_experiments
    WHERE ${where}
    ORDER BY priority ASC, last_sent_at ASC NULLS FIRST, created_at ASC
    LIMIT 1
  `).get(...params);

  return exp || null;
}

/**
 * Get ANY next eligible experiment (no filters).
 * Used when we want to find any test to run.
 */
export function getAnyEligibleExperiment(db) {
  return db.prepare(`
    SELECT * FROM dispatch_experiments
    WHERE state = 'active_experiment' AND sends < send_cap
    ORDER BY priority ASC, last_sent_at ASC NULLS FIRST
    LIMIT 1
  `).get() || null;
}

/**
 * Get all active experiments.
 */
export function getActiveExperiments(db) {
  return db.prepare(`
    SELECT * FROM dispatch_experiments
    WHERE state = 'active_experiment'
    ORDER BY priority ASC
  `).all();
}

/**
 * Record a send for an experiment. Increments counter, updates timestamp.
 * Auto-transitions state if cap reached with 0 meaningful.
 */
export function recordSend(db, experimentId) {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE dispatch_experiments
    SET sends = sends + 1, last_sent_at = ?, updated_at = ?
    WHERE id = ?
  `).run(now, now, experimentId);

  // Check if cap reached
  const exp = db.prepare("SELECT * FROM dispatch_experiments WHERE id = ?").get(experimentId);
  if (exp && exp.sends >= exp.send_cap && exp.meaningful_replies === 0) {
    db.prepare("UPDATE dispatch_experiments SET state = 'failed', updated_at = ? WHERE id = ?").run(now, experimentId);
    log(`${exp.experiment_key}: FAILED (${exp.sends}/${exp.send_cap} sends, 0 meaningful)`);
  } else if (exp) {
    log(`${exp.experiment_key}: sent ${exp.sends}/${exp.send_cap}`);
  }
}

/**
 * Record reply outcome for an experiment.
 * type: "meaningful" | "noise" | "negative"
 * Auto-transitions: meaningful -> promising, cap+0 -> failed
 */
export function recordReplyOutcome(db, experimentId, type) {
  const now = new Date().toISOString();
  const col = type === "meaningful" ? "meaningful_replies"
    : type === "negative" ? "negative_replies"
    : "noise_replies";

  db.prepare(`UPDATE dispatch_experiments SET ${col} = ${col} + 1, updated_at = ? WHERE id = ?`).run(now, experimentId);

  const exp = db.prepare("SELECT * FROM dispatch_experiments WHERE id = ?").get(experimentId);
  if (!exp) return;

  // State transitions
  if (type === "meaningful" && exp.state === "active_experiment") {
    db.prepare("UPDATE dispatch_experiments SET state = 'promising', updated_at = ? WHERE id = ?").run(now, experimentId);
    log(`${exp.experiment_key}: PROMISING (got meaningful reply at send ${exp.sends})`);
  } else if (exp.sends >= exp.send_cap && exp.meaningful_replies === 0) {
    const newState = (exp.noise_replies + exp.negative_replies) > 0 ? "inconclusive" : "failed";
    db.prepare("UPDATE dispatch_experiments SET state = ?, updated_at = ? WHERE id = ?").run(newState, now, experimentId);
    log(`${exp.experiment_key}: ${newState} (cap reached, 0 meaningful, ${exp.noise_replies} noise, ${exp.negative_replies} negative)`);
  }
}

/**
 * Find experiment by template_version + business_email match.
 * Used by reply classifier to link incoming reply to experiment.
 */
export function findExperimentForEmail(db, templateVersion) {
  if (!templateVersion) return null;
  return db.prepare(`
    SELECT * FROM dispatch_experiments
    WHERE template_version = ? AND state IN ('active_experiment', 'promising')
    LIMIT 1
  `).get(templateVersion) || null;
}

/**
 * Get experiment status summary for heartbeat.
 */
export function getExperimentSummary(db) {
  return db.prepare(`
    SELECT experiment_key, state, template_version, vertical, city,
           sends, send_cap, meaningful_replies, noise_replies, negative_replies
    FROM dispatch_experiments
    ORDER BY state, priority
  `).all();
}

/**
 * Ensure dispatch_experiments table exists.
 */
export function ensureExperimentsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS dispatch_experiments (
      id                TEXT PRIMARY KEY,
      experiment_key    TEXT NOT NULL UNIQUE,
      state             TEXT NOT NULL DEFAULT 'active_experiment',
      channel           TEXT NOT NULL,
      vertical          TEXT,
      city              TEXT,
      template_version  TEXT,
      priority          INTEGER NOT NULL DEFAULT 5,
      send_cap          INTEGER NOT NULL DEFAULT 20,
      sends             INTEGER NOT NULL DEFAULT 0,
      meaningful_replies INTEGER NOT NULL DEFAULT 0,
      noise_replies     INTEGER NOT NULL DEFAULT 0,
      negative_replies  INTEGER NOT NULL DEFAULT 0,
      last_sent_at      TEXT,
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  // Add columns introduced after initial schema - safe to run repeatedly
  const cols = db.prepare("PRAGMA table_info(dispatch_experiments)").all().map(c => c.name);
  if (!cols.includes("budget_tag")) db.exec("ALTER TABLE dispatch_experiments ADD COLUMN budget_tag TEXT");
  if (!cols.includes("notes")) db.exec("ALTER TABLE dispatch_experiments ADD COLUMN notes TEXT");
}

/**
 * Seed the triple-niche-test experiments.
 * Goal: first payment OR niche verdict within 5 days on $20 CAD budget.
 * Three niches tested in parallel across different channels.
 * Returns { seeded: number, skipped: number, rows: Array }
 */
export function seedTripleNicheTest(db) {
  ensureExperimentsTable(db);

  const now = new Date().toISOString();

  const experiments = [
    {
      id: "tntest-001-trades-email",
      experiment_key: "triple-niche-1-voice-trades-email",
      state: "active_experiment",
      channel: "cold_email",
      vertical: "trades",
      city: "Calgary",
      template_version: "v-trades-voice-001",
      priority: 1,
      send_cap: 25,
      budget_tag: "triple_niche_test",
      notes: "AI voice receptionist for HVAC/plumbing/dental - Calgary local. Pain: missed after-hours calls. Offer: 7-day pilot CA$997. (DISCONTINUED Apr 22)",
    },
    {
      id: "tntest-002-founders-reddit",
      experiment_key: "triple-niche-2-solo-founders-reddit",
      state: "active_experiment",
      channel: "reddit",
      vertical: "solo_founders",
      city: null,
      template_version: "v-founders-workflow-001",
      priority: 2,
      send_cap: 20,
      budget_tag: "triple_niche_test",
      notes: "AI workflow automation for solo SaaS/service founders. Channels: r/SaaS r/Entrepreneur r/smallbusiness. Pain: ops overhead killing growth.",
    },
    {
      id: "tntest-003-sme-linkedin",
      experiment_key: "triple-niche-3-canadian-sme-linkedin",
      state: "active_experiment",
      channel: "linkedin_comment",
      vertical: "canadian_sme",
      city: null,
      template_version: "v-sme-automation-001",
      priority: 3,
      send_cap: 20,
      budget_tag: "triple_niche_test",
      notes: "AI automation for Canadian SME/manufacturing. Entry: comment on posts about hiring/ops pain. Offer: free 30-min audit.",
    },
  ];

  const insert = db.prepare(`
    INSERT OR IGNORE INTO dispatch_experiments
      (id, experiment_key, state, channel, vertical, city, template_version,
       priority, send_cap, sends, meaningful_replies, noise_replies, negative_replies,
       budget_tag, notes, created_at, updated_at)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?, ?, ?)
  `);

  let seeded = 0;
  let skipped = 0;
  for (const e of experiments) {
    const result = insert.run(
      e.id, e.experiment_key, e.state, e.channel, e.vertical ?? null, e.city ?? null,
      e.template_version, e.priority, e.send_cap, e.budget_tag, e.notes, now, now
    );
    if (result.changes > 0) seeded++;
    else skipped++;
  }

  return { seeded, skipped, rows: experiments };
}
