/**
 * CORTEX → OBSIDIAN LIVE SYNC
 *
 * Watches the world model (SQLite) and writes Obsidian-compatible
 * markdown files with [[wikilinks]] so the Graph View shows
 * the brain growing in real-time.
 *
 * Every entity → a node. Every relationship → a [[link]].
 * Every belief → a note. Every narrative thread → a story.
 *
 * Run: node scripts/cortex/obsidian-sync.mjs
 * Then open Obsidian Graph View and watch.
 */

import Database from "better-sqlite3";
import { writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DB_PATH = resolve(ROOT, ".data/linkedin-brand-os.sqlite");
const WIKI = resolve(ROOT, "wiki");
const BRAIN_DIR = resolve(WIKI, "brain");

// Ensure directories
const DIRS = ["entities", "beliefs", "predictions", "narrative", "curiosity", "decisions", "self"];
for (const d of DIRS) {
  const dir = resolve(BRAIN_DIR, d);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

let lastSync = 0;
let syncCount = 0;

function log(msg) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] [SYNC] ${msg}`);
}

// ── SYNC ENTITIES ─────────────────────────────────────────────────────

function syncEntities(db) {
  let count = 0;
  const entities = db.prepare("SELECT * FROM wm_entities ORDER BY updated_at DESC").all();

  for (const e of entities) {
    const props = JSON.parse(e.properties || "{}");
    const slug = slugify(e.name);
    const file = resolve(BRAIN_DIR, "entities", `${slug}.md`);

    // Get relationships FROM this entity
    const relsFrom = db.prepare(`
      SELECT r.relation, r.confidence, e2.name as target_name, e2.type as target_type
      FROM wm_relationships r
      JOIN wm_entities e2 ON r.to_entity_id = e2.id
      WHERE r.from_entity_id = ?
    `).all(e.id);

    // Get relationships TO this entity
    const relsTo = db.prepare(`
      SELECT r.relation, r.confidence, e2.name as source_name, e2.type as source_type
      FROM wm_relationships r
      JOIN wm_entities e2 ON r.from_entity_id = e2.id
      WHERE r.to_entity_id = ?
    `).all(e.id);

    const links = [];
    const sections = [];

    sections.push(`---`);
    sections.push(`type: ${e.type}`);
    sections.push(`updated: ${e.updated_at}`);
    sections.push(`source: ${e.source || "unknown"}`);
    sections.push(`---`);
    sections.push(``);
    sections.push(`# ${e.name}`);
    sections.push(`**Type:** ${e.type}`);
    sections.push(``);

    // Properties
    if (Object.keys(props).length > 0) {
      sections.push(`## Properties`);
      for (const [k, v] of Object.entries(props)) {
        sections.push(`- **${k}:** ${v}`);
      }
      sections.push(``);
    }

    // Relationships
    if (relsFrom.length > 0 || relsTo.length > 0) {
      sections.push(`## Connections`);
      for (const r of relsFrom) {
        const targetSlug = slugify(r.target_name);
        sections.push(`- ${r.relation} → [[${targetSlug}|${r.target_name}]] (${(r.confidence * 100).toFixed(0)}%)`);
        links.push(targetSlug);
      }
      for (const r of relsTo) {
        const sourceSlug = slugify(r.source_name);
        sections.push(`- ← ${r.relation} [[${sourceSlug}|${r.source_name}]] (${(r.confidence * 100).toFixed(0)}%)`);
        links.push(sourceSlug);
      }
      sections.push(``);
    }

    // Link to type index
    sections.push(`**Category:** [[${e.type}-index|${e.type}]]`);

    writeFileSync(file, sections.join("\n"));
    count++;
  }

  // Write type index files
  const types = [...new Set(entities.map(e => e.type))];
  for (const type of types) {
    const typeEntities = entities.filter(e => e.type === type);
    const indexFile = resolve(BRAIN_DIR, "entities", `${type}-index.md`);
    const content = [
      `# ${type.charAt(0).toUpperCase() + type.slice(1)}s`,
      ``,
      ...typeEntities.map(e => `- [[${slugify(e.name)}|${e.name}]]`),
    ].join("\n");
    writeFileSync(indexFile, content);
  }

  return count;
}

// ── SYNC BELIEFS ──────────────────────────────────────────────────────

function syncBeliefs(db) {
  let count = 0;
  const beliefs = db.prepare("SELECT * FROM wm_beliefs ORDER BY confidence DESC").all();

  for (const b of beliefs) {
    const evidence = JSON.parse(b.evidence || "[]");
    const contradictions = JSON.parse(b.contradictions || "[]");
    const slug = `belief-${b.id}`;
    const file = resolve(BRAIN_DIR, "beliefs", `${slug}.md`);

    const confidenceBar = "█".repeat(Math.round(b.confidence * 10)) + "░".repeat(10 - Math.round(b.confidence * 10));

    const sections = [
      `---`,
      `domain: ${b.domain}`,
      `confidence: ${b.confidence}`,
      `revision: ${b.revision}`,
      `source: ${b.source || "unknown"}`,
      `---`,
      ``,
      `# ${b.belief}`,
      ``,
      `**Domain:** [[${b.domain}-beliefs|${b.domain}]]`,
      `**Confidence:** ${confidenceBar} ${(b.confidence * 100).toFixed(0)}%`,
      `**Revision:** ${b.revision}`,
      ``,
    ];

    if (evidence.length > 0) {
      sections.push(`## Evidence`);
      for (const e of evidence) {
        sections.push(`- ${typeof e === "string" ? e : e.text || JSON.stringify(e)}`);
      }
      sections.push(``);
    }

    if (contradictions.length > 0) {
      sections.push(`## Contradictions`);
      for (const c of contradictions) {
        sections.push(`- ${typeof c === "string" ? c : c.text || JSON.stringify(c)}`);
      }
      sections.push(``);
    }

    writeFileSync(file, sections.join("\n"));
    count++;
  }

  // Domain index
  const domains = [...new Set(beliefs.map(b => b.domain))];
  for (const domain of domains) {
    const domainBeliefs = beliefs.filter(b => b.domain === domain);
    const indexFile = resolve(BRAIN_DIR, "beliefs", `${domain}-beliefs.md`);
    const content = [
      `# Beliefs: ${domain}`,
      ``,
      ...domainBeliefs.map(b => {
        const bar = "█".repeat(Math.round(b.confidence * 10)) + "░".repeat(10 - Math.round(b.confidence * 10));
        return `- ${bar} [[belief-${b.id}|${b.belief.slice(0, 60)}]]`;
      }),
    ].join("\n");
    writeFileSync(indexFile, content);
  }

  return count;
}

// ── SYNC PREDICTIONS ──────────────────────────────────────────────────

function syncPredictions(db) {
  let count = 0;
  const predictions = db.prepare("SELECT * FROM wm_predictions ORDER BY created_at DESC").all();

  for (const p of predictions) {
    const slug = `prediction-${p.id}`;
    const file = resolve(BRAIN_DIR, "predictions", `${slug}.md`);
    const tested = p.tested_at ? "TESTED" : "UNTESTED";
    const result = p.was_correct === 1 ? "CORRECT" : p.was_correct === 0 ? "WRONG" : "pending";

    const sections = [
      `---`,
      `status: ${tested}`,
      `result: ${result}`,
      `confidence: ${p.confidence}`,
      `domain: ${p.domain}`,
      `---`,
      ``,
      `# ${p.prediction}`,
      ``,
      `**Status:** ${tested} ${result !== "pending" ? `(${result})` : ""}`,
      `**Confidence:** ${(p.confidence * 100).toFixed(0)}%`,
      `**Domain:** [[${p.domain}-predictions|${p.domain}]]`,
      ``,
      `## Basis`,
      p.basis || "No basis recorded.",
      ``,
    ];

    if (p.tested_at) {
      sections.push(`## Result`);
      sections.push(`Tested: ${p.tested_at}`);
      sections.push(`Outcome: ${p.actual_result || "unknown"}`);
      sections.push(`Error: ${p.prediction_error || "N/A"}`);
    }

    writeFileSync(file, sections.join("\n"));
    count++;
  }

  return count;
}

// ── SYNC NARRATIVE ────────────────────────────────────────────────────

function syncNarrative(db) {
  let count = 0;
  try {
    const threads = db.prepare("SELECT * FROM cortex_narrative ORDER BY last_event_at DESC").all();

    for (const t of threads) {
      const slug = slugify(t.topic);
      const file = resolve(BRAIN_DIR, "narrative", `${slug}.md`);
      const statusEmoji = { active: "🟢", paused: "⏸️", dead: "💀", untested: "❓", won: "🏆" }[t.status] || "?";

      const sections = [
        `---`,
        `status: ${t.status}`,
        `generation: ${t.generation}`,
        `first_event: ${t.first_event_at || "unknown"}`,
        `last_event: ${t.last_event_at || "unknown"}`,
        `---`,
        ``,
        `# ${statusEmoji} ${t.topic}`,
        ``,
        `**Status:** ${t.status} | **Generation:** ${t.generation}`,
        ``,
        `## Story`,
        t.arc || "No narrative compiled.",
        ``,
      ];

      if (t.open_questions) {
        sections.push(`## Open Questions`);
        sections.push(t.open_questions);
        sections.push(``);
      }

      if (t.key_numbers) {
        sections.push(`## Key Numbers`);
        sections.push(t.key_numbers);
      }

      writeFileSync(file, sections.join("\n"));
      count++;
    }
  } catch {}

  return count;
}

// ── SYNC SELF-AWARENESS ───────────────────────────────────────────────

function syncSelf(db) {
  // Self-discovered knowledge
  try {
    const discoveries = db.prepare(
      "SELECT * FROM cortex_memory WHERE category IN ('self-discovery', 'self-reasoning', 'self-correction') AND outdated = 0 ORDER BY created_at DESC LIMIT 20"
    ).all();

    if (discoveries.length > 0) {
      const file = resolve(BRAIN_DIR, "self", "discoveries.md");
      const sections = [
        `# Self-Discovered Knowledge`,
        `*Things the brain learned on its own*`,
        ``,
        ...discoveries.map(d => `### ${d.created_at}\n**[${d.category}]** ${d.content}\n`),
      ];
      writeFileSync(file, sections.join("\n"));
    }
  } catch {}

  // Introspection results
  try {
    const corrections = db.prepare(
      "SELECT * FROM cortex_memory WHERE category = 'self-correction' AND outdated = 0 ORDER BY created_at DESC LIMIT 10"
    ).all();

    const modeMemory = db.prepare(
      "SELECT * FROM cortex_memory WHERE category = 'mode' AND outdated = 0 ORDER BY created_at DESC LIMIT 1"
    ).get();

    const file = resolve(BRAIN_DIR, "self", "introspection.md");
    const sections = [
      `# Introspection`,
      `*How the brain sees itself*`,
      ``,
      modeMemory ? `## Current Mode\n${modeMemory.content}\n` : "",
      `## Self-Corrections`,
      ...corrections.map(c => `- ${c.content.slice(0, 120)}`),
    ];
    writeFileSync(file, sections.join("\n"));
  } catch {}

  return 1;
}

// ── BLACK BOX: DECISION LOG WITH EMOTIONS ─────────────────────────

function syncDecisionLog(db) {
  let count = 0;
  try {
    const decisions = db.prepare(
      "SELECT * FROM cortex_decisions ORDER BY decided_at DESC LIMIT 30"
    ).all();

    // Read current emotional state
    let emotions = {};
    try {
      const emotionPath = resolve(ROOT, ".data/cortex-emotions.json");
      if (existsSync(emotionPath)) {
        const eState = JSON.parse(readFileSync(emotionPath, "utf-8"));
        emotions = eState.current || {};
      }
    } catch {}

    const file = resolve(BRAIN_DIR, "decisions", "decision-log.md");
    const sections = [
      `# Decision Black Box`,
      `*Last sync: ${new Date().toISOString().slice(0, 19)}*`,
      ``,
      `## Current Emotional State`,
      ...Object.entries(emotions)
        .filter(([_, v]) => v > 0.1)
        .sort(([, a], [, b]) => b - a)
        .map(([e, v]) => {
          const bar = "█".repeat(Math.round(v * 10)) + "░".repeat(10 - Math.round(v * 10));
          return `- ${e}: ${bar} ${(v * 100).toFixed(0)}%`;
        }),
      ``,
      `## Decision History (newest first)`,
      ``,
    ];

    for (const d of decisions) {
      const good = d.was_good_decision === 1 ? "GOOD" : d.was_good_decision === 0 ? "BAD" : "?";
      sections.push(`### ${d.decided_at} [${good}]`);
      sections.push(`**Decision:** ${(d.decision || "").slice(0, 200)}`);
      if (d.reasoning) sections.push(`**Reasoning:** ${d.reasoning.slice(0, 150)}`);
      if (d.actions_taken) sections.push(`**Actions:** ${d.actions_taken.slice(0, 200)}`);
      sections.push(``);
      count++;
    }

    // Also log emotion history
    try {
      const emotionPath = resolve(ROOT, ".data/cortex-emotions.json");
      if (existsSync(emotionPath)) {
        const eState = JSON.parse(readFileSync(emotionPath, "utf-8"));
        const recent = (eState.history || []).slice(-20);
        if (recent.length > 0) {
          const emotionFile = resolve(BRAIN_DIR, "decisions", "emotion-history.md");
          const eSections = [
            `# Emotion History (Black Box)`,
            `*Forensic record - trace any decision back to its emotional trigger*`,
            ``,
            ...recent.reverse().map(h =>
              `- **${h.at?.slice(0, 19)}** ${h.emotion} (${(h.intensity * 100).toFixed(0)}%): ${h.cause}`
            ),
          ];
          writeFileSync(emotionFile, eSections.join("\n"));
        }
      }
    } catch {}

    writeFileSync(file, sections.join("\n"));
  } catch {}
  return count;
}

// ── BRAIN INDEX ───────────────────────────────────────────────────────

function writeBrainIndex(db, counts) {
  const file = resolve(BRAIN_DIR, "BRAIN.md");
  const now = new Date().toISOString().slice(0, 19);

  const sections = [
    `# CORTEX Brain — Live State`,
    `*Last sync: ${now} | Sync #${syncCount}*`,
    ``,
    `## Knowledge Graph`,
    `- [[entities/competitor-index|Competitors]] (${counts.entities} entities total)`,
    `- [[entities/channel-index|Channels]]`,
    `- [[entities/industry-index|Industries]]`,
    `- [[entities/product-index|Products]]`,
    ``,
    `## Beliefs`,
    `${counts.beliefs} beliefs across domains`,
    ``,
    `## Predictions`,
    `${counts.predictions} predictions (track record)`,
    ``,
    `## Narrative`,
    `${counts.narrative} story threads`,
    ``,
    `## Self-Awareness`,
    `- [[self/discoveries|Self-Discovered Knowledge]]`,
    `- [[self/introspection|Introspection]]`,
  ];

  writeFileSync(file, sections.join("\n"));
}

// ── MAIN SYNC LOOP ────────────────────────────────────────────────────

function sync() {
  const db = new Database(DB_PATH, { readonly: true });

  try {
    const counts = {
      entities: syncEntities(db),
      beliefs: syncBeliefs(db),
      predictions: syncPredictions(db),
      narrative: syncNarrative(db),
      self: syncSelf(db),
      decisions: syncDecisionLog(db),
    };

    syncCount++;
    writeBrainIndex(db, counts);

    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (syncCount === 1 || syncCount % 10 === 0) {
      log(`Sync #${syncCount}: ${total} files (${counts.entities}E ${counts.beliefs}B ${counts.predictions}P ${counts.narrative}N)`);
    }
  } catch (e) {
    log(`Sync error: ${e.message}`);
  } finally {
    db.close();
  }
}

function slugify(text) {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
}

// ── RUN ───────────────────────────────────────────────────────────────

log("CORTEX → Obsidian sync starting...");
log(`Wiki dir: ${BRAIN_DIR}`);
log("Syncing every 10 seconds. Open Obsidian Graph View to watch.\n");

// First sync immediately
sync();

// Then every 10 seconds
setInterval(sync, 10_000);

log("Running. Press Ctrl+C to stop.");
