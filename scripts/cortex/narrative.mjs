/**
 * CORTEX NARRATIVE MEMORY — Story, not database
 *
 * The problem with flat memory:
 *   episodic: "Sent 103 cold emails. 0 replies."
 *   episodic: "Pivoted to 4 productized services."
 *   episodic: "Email with new offer not tested yet."
 *
 * The brain sees 3 disconnected facts. It can't reason about causality.
 *
 * Narrative memory compiles these into THREADS:
 *
 *   THREAD: cold-outreach
 *   "We sent 103 cold emails with 'AI automation' pitch over 2 weeks (Apr 1-14).
 *    Zero replies. The messaging was too generic - no specific pain point.
 *    On Apr 16 we pivoted to productized services. We haven't retested cold email
 *    with the new offer yet - this is an untested opportunity."
 *
 * Each thread has:
 *   - topic: what this is about (outreach, product, channel, etc.)
 *   - arc: the narrative (compiled from episodic + procedural memories)
 *   - status: active | paused | dead | untested
 *   - last_event: when the last thing happened
 *   - open_questions: what we still don't know
 *
 * The narrative compiler runs periodically (every 6 hours or on-demand)
 * and uses GPT to synthesize flat memories into coherent threads.
 *
 * The brain reads narrative threads INSTEAD of raw episodic lists.
 * This gives it causal reasoning and prevents repeating failed experiments.
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { recall, remember } from "./memory.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const ENV_PATH = resolve(ROOT, "apps/api/.env");

const env = Object.fromEntries(
  readFileSync(ENV_PATH, "utf-8").split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

// ── SCHEMA ────────────────────────────────────────────────────────────

export function initNarrative(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cortex_narrative (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic TEXT NOT NULL,
      arc TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','dead','untested','won')),
      open_questions TEXT,
      key_numbers TEXT,
      first_event_at TEXT,
      last_event_at TEXT,
      compiled_at TEXT DEFAULT (datetime('now')),
      source_memory_ids TEXT,
      generation INTEGER DEFAULT 1
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_narrative_topic ON cortex_narrative(topic)
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_narrative_status ON cortex_narrative(status)
  `);
}

// ── THREAD OPERATIONS ─────────────────────────────────────────────────

export function getActiveThreads(db, limit = 10) {
  return db.prepare(`
    SELECT * FROM cortex_narrative
    WHERE status IN ('active', 'untested')
    ORDER BY last_event_at DESC
    LIMIT ?
  `).all(limit);
}

export function getAllThreads(db, limit = 20) {
  return db.prepare(`
    SELECT * FROM cortex_narrative
    ORDER BY
      CASE status
        WHEN 'active' THEN 1
        WHEN 'untested' THEN 2
        WHEN 'paused' THEN 3
        WHEN 'dead' THEN 4
        WHEN 'won' THEN 5
      END,
      last_event_at DESC
    LIMIT ?
  `).all(limit);
}

function upsertThread(db, topic, arc, status, openQuestions, keyNumbers, firstEventAt, lastEventAt, sourceIds, generation) {
  // Check if thread for this topic already exists
  const existing = db.prepare("SELECT id, generation FROM cortex_narrative WHERE topic = ?").get(topic);

  if (existing) {
    db.prepare(`
      UPDATE cortex_narrative
      SET arc = ?, status = ?, open_questions = ?, key_numbers = ?,
          last_event_at = ?, compiled_at = datetime('now'),
          source_memory_ids = ?, generation = ?
      WHERE id = ?
    `).run(arc, status, openQuestions, keyNumbers, lastEventAt, sourceIds, generation, existing.id);
    return existing.id;
  } else {
    const result = db.prepare(`
      INSERT INTO cortex_narrative (topic, arc, status, open_questions, key_numbers,
        first_event_at, last_event_at, source_memory_ids, generation)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(topic, arc, status, openQuestions, keyNumbers, firstEventAt, lastEventAt, sourceIds, generation);
    return result.lastInsertRowid;
  }
}

// ── NARRATIVE COMPILER ────────────────────────────────────────────────

/**
 * Compiles flat episodic + procedural memories into narrative threads.
 * Uses GPT to synthesize. Runs every 6 hours or on-demand.
 */
export async function compileNarrative(db, log = console.log) {
  log("[NARRATIVE] Compiling narrative threads...");

  initNarrative(db);

  // Gather raw memories
  const episodic = recall(db, "episodic", null, 100);
  const procedural = recall(db, "procedural", null, 50);
  const decisions = db.prepare(`
    SELECT * FROM cortex_decisions
    ORDER BY decided_at DESC LIMIT 30
  `).all();

  if (episodic.length === 0 && procedural.length === 0) {
    log("[NARRATIVE] No memories to compile");
    return { threads: 0 };
  }

  // Get existing threads for context
  const existingThreads = getAllThreads(db, 20);

  // Build the compilation prompt
  const prompt = buildCompilationPrompt(episodic, procedural, decisions, existingThreads);

  // Call LLM to compile
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5.4-mini",
        messages: [{ role: "user", content: prompt }],
        max_completion_tokens: 3000,
        temperature: 0.2,
        response_format: { type: "json_object" },
      }),
    });

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      log("[NARRATIVE] LLM returned empty");
      return { threads: 0 };
    }

    let result;
    try {
      result = JSON.parse(content);
    } catch (parseErr) {
      // LLM sometimes returns truncated JSON. Try to repair.
      log(`[NARRATIVE] JSON parse failed, attempting repair...`);
      try {
        // Extract just the threads array if possible
        const threadsMatch = content.match(/"threads"\s*:\s*\[([\s\S]*)\]/);
        if (threadsMatch) {
          // Find complete thread objects (each ends with })
          const threadStr = threadsMatch[1];
          const threadObjects = [];
          let depth = 0, start = -1;
          for (let i = 0; i < threadStr.length; i++) {
            if (threadStr[i] === "{" && depth === 0) start = i;
            if (threadStr[i] === "{") depth++;
            if (threadStr[i] === "}") depth--;
            if (depth === 0 && start >= 0) {
              try {
                threadObjects.push(JSON.parse(threadStr.slice(start, i + 1)));
              } catch {}
              start = -1;
            }
          }
          result = { threads: threadObjects };
          log(`[NARRATIVE] Repaired: extracted ${threadObjects.length} threads`);
        } else {
          throw parseErr;
        }
      } catch {
        log(`[NARRATIVE] JSON repair failed: ${parseErr.message}`);
        return { threads: 0 };
      }
    }
    const threads = result.threads || [];

    // Write threads to DB
    for (const thread of threads) {
      upsertThread(db,
        thread.topic,
        thread.arc,
        thread.status || "active",
        thread.open_questions || null,
        thread.key_numbers || null,
        thread.first_event || null,
        thread.last_event || null,
        JSON.stringify(thread.source_ids || []),
        (existingThreads.find(t => t.topic === thread.topic)?.generation || 0) + 1
      );
    }

    log(`[NARRATIVE] Compiled ${threads.length} threads`);
    for (const t of threads) {
      log(`[NARRATIVE]   [${t.status}] ${t.topic}: ${t.arc.slice(0, 80)}...`);
    }

    return { threads: threads.length, topics: threads.map(t => t.topic) };
  } catch (e) {
    log(`[NARRATIVE] Compilation failed: ${e.message}`);
    return { threads: 0, error: e.message };
  }
}

function buildCompilationPrompt(episodic, procedural, decisions, existingThreads) {
  return `You are the NARRATIVE MEMORY COMPILER for an autonomous business system.

Your job: take raw memory entries and compile them into NARRATIVE THREADS.

A narrative thread is a STORY about one topic. Not facts - a causal chain.
BAD: "103 emails sent. 0 replies. Pivoted to productized services."
GOOD: "We spent two weeks (Apr 1-14) sending cold emails with a generic 'AI automation' pitch. After 103 sends and zero replies, we identified the problem: no specific pain point, too broad. On Apr 16 we pivoted to 4 productized services - concrete offers with clear ROI. We haven't retested cold email with the new offers. This is an untested opportunity with a refined pitch."

RULES FOR THREADS:
1. Each thread = one topic/initiative (e.g., "cold-email", "reddit-outreach", "productized-services", "fiverr-sales")
2. Write in first person plural ("we tried", "we learned", "we pivoted")
3. Include specific numbers and dates
4. End with what's UNRESOLVED or UNTESTED
5. Mark status: active (doing now), paused (stopped but could resume), dead (proven not to work), untested (haven't tried yet), won (achieved goal)
6. Include open_questions - things the system should investigate
7. Include key_numbers - the metrics that matter for this thread

EXISTING THREADS (update these, don't duplicate):
${existingThreads.map(t => `[${t.status}] ${t.topic}: ${t.arc.slice(0, 150)}`).join("\n") || "none yet"}

RAW EPISODIC MEMORIES (what happened):
${episodic.slice(0, 40).map(m => `[${m.created_at}] [${m.category || "?"}] ${m.content.slice(0, 150)}`).join("\n")}

PROCEDURAL MEMORIES (what we learned):
${procedural.slice(0, 20).map(m => `[${m.category || "?"}] ${m.content.slice(0, 120)}`).join("\n")}

RECENT DECISIONS:
${decisions.slice(0, 15).map(d => `[${d.decided_at}] ${(d.decision || "").slice(0, 100)} ${d.was_good_decision === 1 ? "(GOOD)" : d.was_good_decision === 0 ? "(BAD)" : ""}`).join("\n")}

Return JSON:
{
  "threads": [
    {
      "topic": "cold-email-outreach",
      "arc": "Full narrative paragraph. Causal chain. What happened, why, what we learned, what's next.",
      "status": "paused",
      "open_questions": "Should we retest with vibe-code audit pitch? What subject lines work for SaaS founders?",
      "key_numbers": "103 sent, 0 replies, 0% response rate",
      "first_event": "2026-04-01",
      "last_event": "2026-04-14",
      "source_ids": [1, 5, 12]
    }
  ]
}

Compile ALL relevant threads. Merge related memories into one thread. 5-15 threads expected.`;
}

// ── FORMAT FOR BRAIN ──────────────────────────────────────────────────

/**
 * Format narrative threads for the brain's context window.
 * This replaces raw episodic memory in the system prompt.
 */
export function formatNarrativeForBrain(db) {
  initNarrative(db);
  const threads = getAllThreads(db, 15);

  if (threads.length === 0) {
    return "No narrative threads compiled yet. Raw memories are available.";
  }

  const sections = {
    active: [],
    untested: [],
    paused: [],
    dead: [],
    won: [],
  };

  for (const t of threads) {
    const entry = `**${t.topic}** (gen ${t.generation}, last: ${t.last_event_at || "?"})\n${t.arc}${t.open_questions ? `\nOpen: ${t.open_questions}` : ""}${t.key_numbers ? `\nNumbers: ${t.key_numbers}` : ""}`;
    (sections[t.status] || sections.active).push(entry);
  }

  const parts = [];
  if (sections.active.length) parts.push(`ACTIVE INITIATIVES:\n${sections.active.join("\n\n")}`);
  if (sections.untested.length) parts.push(`UNTESTED OPPORTUNITIES:\n${sections.untested.join("\n\n")}`);
  if (sections.paused.length) parts.push(`PAUSED (could resume):\n${sections.paused.join("\n\n")}`);
  if (sections.won.length) parts.push(`WON:\n${sections.won.join("\n\n")}`);
  if (sections.dead.length) parts.push(`DEAD (proven failures):\n${sections.dead.join("\n\n")}`);

  return parts.join("\n\n---\n\n");
}

// ── QUICK THREAD UPDATE ───────────────────────────────────────────────

/**
 * Add a new event to an existing thread without full recompilation.
 * Fast path for cortex-daemon to update narrative in real-time.
 */
export function appendToThread(db, topic, event, log = console.log) {
  initNarrative(db);
  const thread = db.prepare("SELECT * FROM cortex_narrative WHERE topic = ?").get(topic);

  if (thread) {
    const updatedArc = `${thread.arc}\n[${new Date().toISOString().slice(0, 10)}] ${event}`;
    db.prepare(`
      UPDATE cortex_narrative
      SET arc = ?, last_event_at = datetime('now'), compiled_at = datetime('now')
      WHERE id = ?
    `).run(updatedArc, thread.id);
    log(`[NARRATIVE] Appended to thread: ${topic}`);
  } else {
    // Create new thread
    upsertThread(db, topic, event, "active", null, null,
      new Date().toISOString(), new Date().toISOString(), "[]", 1);
    log(`[NARRATIVE] New thread created: ${topic}`);
  }
}
