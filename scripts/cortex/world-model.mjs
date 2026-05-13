/**
 * CORTEX WORLD MODEL — The system's understanding of reality
 *
 * Every other AI agent in 2026 is blind. It has a prompt, tools, and memory.
 * But it doesn't UNDERSTAND the world. It doesn't have a MAP.
 *
 * The World Model is a living knowledge graph:
 *
 * ENTITIES:
 *   { type: "business", name: "Calgary Dental Group", industry: "dental",
 *     size: "small", location: "Calgary", calls_per_month: 200 }
 *
 * RELATIONSHIPS:
 *   Calgary Dental Group --[potential_client]--> LaunchSoloAI
 *   Smith.ai --[competes_with]--> LaunchSoloAI
 *   Reddit/r/dentistry --[source_of]--> dental leads
 *
 * BELIEFS (things the system believes with confidence):
 *   { belief: "Dental clinics lose 23% of calls after hours",
 *     confidence: 0.7, source: "DentistryIQ article", updatedAt: "2026-04-17",
 *     contradictions: ["Some already use n8n/Zapier for automation"] }
 *
 * PREDICTIONS (what the system expects to happen):
 *   { prediction: "Reddit comment-first with vibe-code audit offer -> 2-5% conversion",
 *     basis: "Comment-first approach confirmed best channel. Vibe-code audit is specific and timely.",
 *     confidence: 0.4, testable: true, testedAt: null, actualResult: null }
 *
 * The brain reads the world model before deciding.
 * Every action result updates the model.
 * Predictions that are tested update confidence.
 *
 * This is what makes CORTEX different: it has a structured UNDERSTANDING
 * of the world, not just a bag of facts.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const ENV_PATH = resolve(ROOT, "apps/api/.env");

const env = Object.fromEntries(
  readFileSync(ENV_PATH, "utf-8").split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

// ── SCHEMA ────────────────────────────────────────────────────────────

export function initWorldModel(db) {
  // Entities: things that exist in the world
  db.exec(`
    CREATE TABLE IF NOT EXISTS wm_entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      properties TEXT DEFAULT '{}',
      first_seen_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      source TEXT,
      UNIQUE(type, name)
    )
  `);

  // Relationships: how entities connect
  db.exec(`
    CREATE TABLE IF NOT EXISTS wm_relationships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_entity_id INTEGER NOT NULL,
      relation TEXT NOT NULL,
      to_entity_id INTEGER NOT NULL,
      properties TEXT DEFAULT '{}',
      confidence REAL DEFAULT 0.5,
      created_at TEXT DEFAULT (datetime('now')),
      source TEXT,
      FOREIGN KEY(from_entity_id) REFERENCES wm_entities(id),
      FOREIGN KEY(to_entity_id) REFERENCES wm_entities(id)
    )
  `);

  // Beliefs: things the system believes about the world
  db.exec(`
    CREATE TABLE IF NOT EXISTS wm_beliefs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT NOT NULL,
      belief TEXT NOT NULL,
      confidence REAL DEFAULT 0.5,
      evidence TEXT DEFAULT '[]',
      contradictions TEXT DEFAULT '[]',
      source TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      revision INTEGER DEFAULT 1
    )
  `);

  // Predictions: what the system expects to happen
  db.exec(`
    CREATE TABLE IF NOT EXISTS wm_predictions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prediction TEXT NOT NULL,
      basis TEXT,
      confidence REAL DEFAULT 0.5,
      domain TEXT,
      testable INTEGER DEFAULT 1,
      tested_at TEXT,
      actual_result TEXT,
      was_correct INTEGER,
      prediction_error REAL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Indexes
  db.exec(`CREATE INDEX IF NOT EXISTS idx_wm_entities_type ON wm_entities(type)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_wm_beliefs_domain ON wm_beliefs(domain)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_wm_predictions_domain ON wm_predictions(domain)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_wm_predictions_untested ON wm_predictions(tested_at) WHERE tested_at IS NULL`);
}

// ── ENTITY OPERATIONS ─────────────────────────────────────────────────

export function upsertEntity(db, type, name, properties = {}, source = "cortex") {
  const existing = db.prepare("SELECT id, properties FROM wm_entities WHERE type = ? AND name = ?").get(type, name);

  if (existing) {
    const merged = { ...JSON.parse(existing.properties || "{}"), ...properties };
    db.prepare("UPDATE wm_entities SET properties = ?, updated_at = datetime('now'), source = ? WHERE id = ?")
      .run(JSON.stringify(merged), source, existing.id);
    return existing.id;
  }

  const result = db.prepare("INSERT INTO wm_entities (type, name, properties, source) VALUES (?, ?, ?, ?)")
    .run(type, name, JSON.stringify(properties), source);
  return result.lastInsertRowid;
}

export function getEntity(db, type, name) {
  const row = db.prepare("SELECT * FROM wm_entities WHERE type = ? AND name = ?").get(type, name);
  if (row) row.properties = JSON.parse(row.properties || "{}");
  return row;
}

export function getEntitiesByType(db, type, limit = 50) {
  return db.prepare("SELECT * FROM wm_entities WHERE type = ? ORDER BY updated_at DESC LIMIT ?")
    .all(type, limit)
    .map(r => ({ ...r, properties: JSON.parse(r.properties || "{}") }));
}

export function queryEntities(db, type, propertyFilter) {
  // propertyFilter is a function that takes properties object and returns true/false
  return getEntitiesByType(db, type, 200).filter(e => propertyFilter(e.properties));
}

// ── RELATIONSHIP OPERATIONS ───────────────────────────────────────────

export function addRelationship(db, fromType, fromName, relation, toType, toName, properties = {}, confidence = 0.5, source = "cortex") {
  const fromId = upsertEntity(db, fromType, fromName, {}, source);
  const toId = upsertEntity(db, toType, toName, {}, source);

  // Check if relationship already exists
  const existing = db.prepare(
    "SELECT id FROM wm_relationships WHERE from_entity_id = ? AND relation = ? AND to_entity_id = ?"
  ).get(fromId, relation, toId);

  if (existing) {
    db.prepare("UPDATE wm_relationships SET properties = ?, confidence = ?, source = ? WHERE id = ?")
      .run(JSON.stringify(properties), confidence, source, existing.id);
    return existing.id;
  }

  const result = db.prepare(
    "INSERT INTO wm_relationships (from_entity_id, relation, to_entity_id, properties, confidence, source) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(fromId, relation, toId, JSON.stringify(properties), confidence, source);
  return result.lastInsertRowid;
}

export function getRelationships(db, entityType, entityName, direction = "from") {
  const entity = getEntity(db, entityType, entityName);
  if (!entity) return [];

  if (direction === "from") {
    return db.prepare(`
      SELECT r.*, e.type as target_type, e.name as target_name, e.properties as target_properties
      FROM wm_relationships r JOIN wm_entities e ON r.to_entity_id = e.id
      WHERE r.from_entity_id = ?
    `).all(entity.id).map(r => ({
      ...r,
      properties: JSON.parse(r.properties || "{}"),
      target_properties: JSON.parse(r.target_properties || "{}"),
    }));
  }

  return db.prepare(`
    SELECT r.*, e.type as source_type, e.name as source_name, e.properties as source_properties
    FROM wm_relationships r JOIN wm_entities e ON r.from_entity_id = e.id
    WHERE r.to_entity_id = ?
  `).all(entity.id).map(r => ({
    ...r,
    properties: JSON.parse(r.properties || "{}"),
    source_properties: JSON.parse(r.source_properties || "{}"),
  }));
}

// ── BELIEF OPERATIONS ─────────────────────────────────────────────────

export function addBelief(db, domain, belief, confidence = 0.5, evidence = [], source = "cortex") {
  // Check if similar belief exists (same domain, similar text)
  const existing = db.prepare("SELECT * FROM wm_beliefs WHERE domain = ? AND belief = ?").get(domain, belief);

  if (existing) {
    const mergedEvidence = [...JSON.parse(existing.evidence || "[]"), ...evidence];
    const newConfidence = Math.min(1.0, (existing.confidence + confidence) / 2 + 0.05 * evidence.length);
    db.prepare(
      "UPDATE wm_beliefs SET confidence = ?, evidence = ?, updated_at = datetime('now'), revision = revision + 1 WHERE id = ?"
    ).run(newConfidence, JSON.stringify(mergedEvidence.slice(-10)), existing.id);
    return existing.id;
  }

  const result = db.prepare(
    "INSERT INTO wm_beliefs (domain, belief, confidence, evidence, source) VALUES (?, ?, ?, ?, ?)"
  ).run(domain, belief, confidence, JSON.stringify(evidence), source);
  return result.lastInsertRowid;
}

export function contradictBelief(db, beliefId, contradiction, source = "cortex") {
  const belief = db.prepare("SELECT * FROM wm_beliefs WHERE id = ?").get(beliefId);
  if (!belief) return;

  const contradictions = [...JSON.parse(belief.contradictions || "[]"), { text: contradiction, source, at: new Date().toISOString() }];
  const newConfidence = Math.max(0.1, belief.confidence - 0.15);

  db.prepare(
    "UPDATE wm_beliefs SET contradictions = ?, confidence = ?, updated_at = datetime('now'), revision = revision + 1 WHERE id = ?"
  ).run(JSON.stringify(contradictions.slice(-5)), newConfidence, beliefId);
}

export function getBeliefs(db, domain = null, minConfidence = 0.0, limit = 20) {
  if (domain) {
    return db.prepare(
      "SELECT * FROM wm_beliefs WHERE domain = ? AND confidence >= ? ORDER BY confidence DESC LIMIT ?"
    ).all(domain, minConfidence, limit).map(b => ({
      ...b,
      evidence: JSON.parse(b.evidence || "[]"),
      contradictions: JSON.parse(b.contradictions || "[]"),
    }));
  }
  return db.prepare(
    "SELECT * FROM wm_beliefs WHERE confidence >= ? ORDER BY confidence DESC LIMIT ?"
  ).all(minConfidence, limit).map(b => ({
    ...b,
    evidence: JSON.parse(b.evidence || "[]"),
    contradictions: JSON.parse(b.contradictions || "[]"),
  }));
}

// ── PREDICTION OPERATIONS ─────────────────────────────────────────────

export function makePrediction(db, prediction, basis, confidence = 0.5, domain = "general") {
  const result = db.prepare(
    "INSERT INTO wm_predictions (prediction, basis, confidence, domain) VALUES (?, ?, ?, ?)"
  ).run(prediction, basis, confidence, domain);
  return result.lastInsertRowid;
}

export function testPrediction(db, predictionId, actualResult, wasCorrect) {
  const pred = db.prepare("SELECT * FROM wm_predictions WHERE id = ?").get(predictionId);
  if (!pred) return;

  const error = wasCorrect ? 0 : Math.abs(pred.confidence - (wasCorrect ? 1 : 0));

  db.prepare(
    "UPDATE wm_predictions SET tested_at = datetime('now'), actual_result = ?, was_correct = ?, prediction_error = ? WHERE id = ?"
  ).run(actualResult, wasCorrect ? 1 : 0, error, predictionId);

  return { prediction: pred.prediction, wasCorrect, error, confidence: pred.confidence };
}

export function getUntestedPredictions(db, limit = 10) {
  return db.prepare(
    "SELECT * FROM wm_predictions WHERE tested_at IS NULL ORDER BY created_at ASC LIMIT ?"
  ).all(limit);
}

export function getPredictionAccuracy(db, domain = null, days = 30) {
  const where = domain ? "AND domain = ?" : "";
  const params = domain
    ? [days, domain]
    : [days];

  return db.prepare(`
    SELECT
      COUNT(*) as total_tested,
      SUM(CASE WHEN was_correct = 1 THEN 1 ELSE 0 END) as correct,
      ROUND(AVG(prediction_error), 3) as avg_error,
      ROUND(AVG(confidence), 3) as avg_confidence
    FROM wm_predictions
    WHERE tested_at IS NOT NULL
    AND tested_at > datetime('now', '-' || ? || ' days')
    ${where}
  `).get(...params);
}

// ── WORLD MODEL COMPILER ──────────────────────────────────────────────

/**
 * Use LLM to extract entities, relationships, and beliefs from new data.
 * Called after deep research, lead enrichment, or manual input.
 */
export async function integrateKnowledge(db, newData, source = "observation", log = console.log) {
  log(`[WORLD-MODEL] Integrating knowledge from: ${source}`);

  const prompt = `You are the WORLD MODEL INTEGRATOR for an autonomous business system.

Given new information, extract structured knowledge.

NEW DATA:
${typeof newData === 'string' ? newData : JSON.stringify(newData, null, 2)}

SOURCE: ${source}

CURRENT CONTEXT:
- Our product: AI workflow automation and custom AI builds for solo SaaS founders and small businesses
- Business: LaunchSoloAI, Calgary, Canada
- Revenue: $0, looking for first client
- Channels: Reddit, Fiverr, Google Ads, cold email (failed)

Extract and return JSON:
{
  "entities": [
    {"type": "business|person|competitor|channel|industry|tool", "name": "specific name", "properties": {"key": "value"}}
  ],
  "relationships": [
    {"from_type": "competitor", "from_name": "Smith.ai", "relation": "competes_with|serves|sources_from|blocks|enables", "to_type": "product", "to_name": "LaunchSoloAI", "confidence": 0.8}
  ],
  "beliefs": [
    {"domain": "market|outreach|product|pricing|competition", "belief": "specific factual claim", "confidence": 0.7, "evidence": ["source or reasoning"]}
  ],
  "predictions": [
    {"prediction": "if we do X, Y will happen", "basis": "why we believe this", "confidence": 0.5, "domain": "outreach|sales|product"}
  ]
}

Rules:
- Only extract what the data actually supports. Don't invent.
- Beliefs must be specific and falsifiable.
- Predictions must be testable.
- Confidence reflects how sure the data makes us (0.3 = weak signal, 0.7 = solid evidence, 0.9 = proven).`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.4-mini",
        messages: [{ role: "user", content: prompt }],
        max_completion_tokens: 2000,
        temperature: 0.2,
        response_format: { type: "json_object" },
      }),
    });

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return { entities: 0, relationships: 0, beliefs: 0, predictions: 0 };

    const knowledge = JSON.parse(content);
    let counts = { entities: 0, relationships: 0, beliefs: 0, predictions: 0 };

    // Integrate entities
    for (const e of (knowledge.entities || [])) {
      upsertEntity(db, e.type, e.name, e.properties || {}, source);
      counts.entities++;
    }

    // Integrate relationships
    for (const r of (knowledge.relationships || [])) {
      addRelationship(db, r.from_type, r.from_name, r.relation, r.to_type, r.to_name, {}, r.confidence || 0.5, source);
      counts.relationships++;
    }

    // Integrate beliefs
    for (const b of (knowledge.beliefs || [])) {
      addBelief(db, b.domain, b.belief, b.confidence || 0.5, b.evidence || [], source);
      counts.beliefs++;
    }

    // Integrate predictions
    for (const p of (knowledge.predictions || [])) {
      makePrediction(db, p.prediction, p.basis, p.confidence || 0.5, p.domain || "general");
      counts.predictions++;
    }

    log(`[WORLD-MODEL] Integrated: ${counts.entities}E ${counts.relationships}R ${counts.beliefs}B ${counts.predictions}P`);
    return counts;

  } catch (e) {
    log(`[WORLD-MODEL] Integration failed: ${e.message}`);
    return { entities: 0, relationships: 0, beliefs: 0, predictions: 0, error: e.message };
  }
}

// ── FORMAT FOR BRAIN CONTEXT ──────────────────────────────────────────

export function formatWorldModelForBrain(db, maxTokens = 1500) {
  const parts = [];

  // Key beliefs (high confidence)
  const beliefs = getBeliefs(db, null, 0.5, 10);
  if (beliefs.length > 0) {
    parts.push("BELIEFS (what I know and how sure I am):");
    for (const b of beliefs) {
      const contraCount = b.contradictions.length;
      parts.push(`  [${b.domain}] ${b.belief} (confidence: ${b.confidence}${contraCount > 0 ? `, ${contraCount} contradictions` : ""})`);
    }
  }

  // Untested predictions
  const predictions = getUntestedPredictions(db, 5);
  if (predictions.length > 0) {
    parts.push("\nUNTESTED PREDICTIONS (should I test these?):");
    for (const p of predictions) {
      parts.push(`  ${p.prediction} (confidence: ${p.confidence}, basis: ${p.basis?.slice(0, 80)})`);
    }
  }

  // Prediction accuracy
  const accuracy = getPredictionAccuracy(db);
  if (accuracy?.total_tested > 0) {
    parts.push(`\nPREDICTION TRACK RECORD: ${accuracy.correct}/${accuracy.total_tested} correct (${Math.round(accuracy.correct / accuracy.total_tested * 100)}%), avg error: ${accuracy.avg_error}`);
  }

  // Key entities
  const competitors = getEntitiesByType(db, "competitor", 5);
  if (competitors.length > 0) {
    parts.push("\nKNOWN COMPETITORS:");
    for (const c of competitors) {
      parts.push(`  ${c.name}: ${JSON.stringify(c.properties).slice(0, 100)}`);
    }
  }

  const channels = getEntitiesByType(db, "channel", 5);
  if (channels.length > 0) {
    parts.push("\nKNOWN CHANNELS:");
    for (const c of channels) {
      parts.push(`  ${c.name}: ${JSON.stringify(c.properties).slice(0, 80)}`);
    }
  }

  const result = parts.join("\n");
  return result.slice(0, maxTokens) || "World model empty - needs more data.";
}

// ── SEED INITIAL WORLD MODEL ──────────────────────────────────────────

export function seedWorldModel(db) {
  // Our product (voice receptionist discontinued 2026-04-22)
  upsertEntity(db, "product", "LaunchSoloAI AI Automation", {
    pricing: "$1500-8000 CAD",
    website: "https://launchsoloai.com",
    offers: ["Vibe-Code Audit", "Reply Chaser Automation", "First 10 Customers Sales Motion", "Custom AI Build"],
    discontinued: ["AI Voice Receptionist"],
  }, "seed");

  // Known competitors
  upsertEntity(db, "competitor", "Smith.ai", { pricing: "$140/mo", focus: "general", weakness: "expensive" }, "seed");
  upsertEntity(db, "competitor", "Callin.io", { pricing: "$119/mo", focus: "general" }, "seed");
  upsertEntity(db, "competitor", "Synthflow", { pricing: "$29/mo", focus: "low-end" }, "seed");

  // Known channels
  upsertEntity(db, "channel", "Reddit", { effectiveness: "high", weight: 80, method: "comment-first" }, "seed");
  upsertEntity(db, "channel", "Cold Email", { effectiveness: "dead", weight: 10, results: "103 sent, 0 replies" }, "seed");
  upsertEntity(db, "channel", "Fiverr", { effectiveness: "untested", status: "gig live" }, "seed");
  upsertEntity(db, "channel", "Google Ads", { effectiveness: "untested", budget: "$10/day" }, "seed");

  // Target industries (voice-agent-era call props removed; discontinued flag added)
  upsertEntity(db, "industry", "Dental", { discontinued: true }, "seed");
  upsertEntity(db, "industry", "HVAC", { discontinued: true }, "seed");
  upsertEntity(db, "industry", "Real Estate", { discontinued: true }, "seed");
  upsertEntity(db, "industry", "Law Firms", { discontinued: true }, "seed");

  // Target segments for current offers
  upsertEntity(db, "industry", "Solo SaaS Founders", { icp: true, pain: "0-10 customers, broken MVP, no sales motion", channels: ["Reddit", "IndieHackers", "HN"] }, "seed");
  upsertEntity(db, "industry", "Small Business Owners", { icp: true, pain: "manual workflows, missed leads, no automation", channels: ["Reddit", "Google Ads"] }, "seed");

  // Key beliefs
  addBelief(db, "outreach", "Cold email with generic AI automation pitch gets 0% response rate", 0.95,
    ["103 emails sent, 0 replies over 2 weeks"], "proven");
  addBelief(db, "outreach", "Reddit comment-first approach generates real engagement", 0.8,
    ["Multiple conversations started via comments", "Channel weight 80 in feedback loops"], "proven");
  addBelief(db, "product", "AI workflow automation and custom AI builds are the current core offer", 0.95,
    ["MISSION.md updated 2026-04-15", "Voice agent discontinued 2026-04-22"], "proven");
  addBelief(db, "product", "Fiverr AI agent demand increased 18,347% in 6 months", 0.75,
    ["Fiverr trend data"], "research");

  // Predictions to test
  makePrediction(db,
    "Solo SaaS founders with broken vibe-coded MVPs will respond to Vibe-Code Audit offer at 5-10% rate",
    "Specific pain (broken production code) + specific solution + clear fixed price = higher response than generic automation",
    0.4, "outreach"
  );
  makePrediction(db,
    "Reddit comment-first on r/SaaS and r/indiehackers will generate qualified leads for Vibe-Code Audit",
    "Proven channel (comment-first) + aligned ICP community = best current bet",
    0.5, "sales"
  );

  // Relationships
  addRelationship(db, "channel", "Reddit", "sources", "industry", "Solo SaaS Founders",
    { subreddits: ["r/SaaS", "r/indiehackers", "r/webdev"] }, 0.7, "seed");
  addRelationship(db, "channel", "Google Ads", "sources", "industry", "Solo SaaS Founders",
    { campaigns: ["vibe code audit"] }, 0.4, "seed");
}
