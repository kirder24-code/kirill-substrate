/**
 * CORTEX INITIATIVE — The system decides WHEN to act
 *
 * Old model: 5-minute timer -> think -> act -> wait 5 min
 * Problem: hot lead sits for 5 min. Untested opportunity sits for days.
 *          System wastes cycles on "nothing happened" and misses urgency.
 *
 * New model: Initiative Engine evaluates SHOULD I ACT NOW?
 *
 * Three types of initiative:
 *
 * 1. SIGNAL-DRIVEN (immediate)
 *    - New lead detected -> enrich + outreach NOW
 *    - Reply received -> classify + respond NOW
 *    - Error detected -> heal NOW
 *    - Hot lead cooling (>2h since last touch) -> follow up NOW
 *
 * 2. CURIOSITY-DRIVEN (proactive)
 *    - Narrative thread has "untested" status -> try it
 *    - No research done in 24h -> research something
 *    - Evolution hasn't run in 6h -> evolve
 *    - A channel hasn't been tested in 7 days -> test it
 *
 * 3. URGENCY-DRIVEN (time-sensitive)
 *    - Morning (7 AM) -> morning brief
 *    - Hot lead hasn't been contacted in 4h -> escalate
 *    - Kirill asked something via Telegram -> respond immediately
 *    - Budget reset at midnight -> plan next day
 *
 * The Initiative Engine runs every 30 seconds (lightweight, no LLM).
 * It outputs: { shouldAct: bool, reason: string, priority: 1-10, suggestedAction: {...} }
 * When shouldAct=true, cortex-daemon runs an immediate cycle with the suggestion.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");

// ── STATE TRACKING ────────────────────────────────────────────────────

let lastActAt = Date.now();
let lastResearchAt = 0;
let lastEvolutionAt = 0;
let lastNarrativeCompileAt = 0;
let lastUrgencyAt = 0;
let pendingSignals = [];

// NEURAL CONNECTION 4: Signal dedup — don't fire same signal type more than once per 5 min
let lastSignalFired = {};  // type -> timestamp
const SIGNAL_COOLDOWN_MS = 5 * 60_000; // 5 minutes between same signal type

// ── SIGNAL INGESTION ──────────────────────────────────────────────────

/**
 * Feed a signal to the initiative engine.
 * Called by realtime-server, perception, or external webhooks.
 */
export function ingestSignal(signal) {
  pendingSignals.push({
    ...signal,
    receivedAt: Date.now(),
  });
  // Keep max 50 pending signals
  if (pendingSignals.length > 50) pendingSignals = pendingSignals.slice(-50);
}

/**
 * Drain all pending signals (consumed by the cycle).
 */
export function drainInitiativeSignals() {
  const signals = [...pendingSignals];
  pendingSignals = [];
  return signals;
}

// ── CORE EVALUATION ───────────────────────────────────────────────────

/**
 * Evaluate whether the system should act RIGHT NOW.
 * This is the main function called every 30 seconds.
 * No LLM call - pure logic. Must be fast (<10ms).
 *
 * @param {object} db - SQLite database
 * @param {object} [options]
 * @returns {{ shouldAct: boolean, reason: string, priority: number, type: string, suggestedAction: object|null }}
 */
export function evaluateInitiative(db, options = {}) {
  const now = Date.now();
  const hour = new Date().getHours();
  const minutesSinceLastAct = (now - lastActAt) / 60_000;

  // ── SIGNAL-DRIVEN (priority 8-10) ──────────────────────────────────

  // Check for pending signals
  if (pendingSignals.length > 0) {
    const hotSignals = pendingSignals.filter(s =>
      s.type === "email_reply" || s.type === "appointment" || s.type === "form_submission" ||
      s.type === "hot_lead" || s.type === "telegram_command"
    );

    if (hotSignals.length > 0) {
      return {
        shouldAct: true,
        reason: `Hot signal: ${hotSignals[0].type} (${hotSignals.length} total)`,
        priority: 10,
        type: "signal",
        suggestedAction: signalToAction(hotSignals[0]),
      };
    }

    // New leads are high priority but not emergency
    // NEURAL CONNECTION 4: dedup — don't repeat same signal within cooldown
    const leadSignals = pendingSignals.filter(s => s.type === "new_lead" || s.type === "new_leads");
    if (leadSignals.length > 0) {
      const lastFired = lastSignalFired["new_leads"] || 0;
      if (now - lastFired < SIGNAL_COOLDOWN_MS) {
        // Already processed this signal type recently — drain and skip
        pendingSignals = pendingSignals.filter(s => s.type !== "new_lead" && s.type !== "new_leads");
        // Don't return — fall through to other evaluations
      } else {
        lastSignalFired["new_leads"] = now;
        pendingSignals = pendingSignals.filter(s => s.type !== "new_lead" && s.type !== "new_leads");
        return {
          shouldAct: true,
          reason: `New leads detected (${leadSignals.length})`,
          priority: 8,
          type: "signal",
          suggestedAction: { action: "run_workflow", workflow: "lead-pipeline", reason: "New leads need enrichment" },
        };
      }
    }
  }

  // Check for hot leads cooling (DB query, but fast)
  try {
    const coolingLeads = db.prepare(`
      SELECT COUNT(*) as cnt FROM leads
      WHERE stage = 'ready_buyer'
      AND updated_at < datetime('now', '-2 hours')
      AND updated_at > datetime('now', '-24 hours')
    `).get();

    if (coolingLeads?.cnt > 0 && minutesSinceLastAct > 10) {
      return {
        shouldAct: true,
        reason: `${coolingLeads.cnt} hot leads cooling (>2h since last touch)`,
        priority: 9,
        type: "urgency",
        suggestedAction: { action: "run_workflow", workflow: "reply-pipeline", reason: "Hot leads need follow-up" },
      };
    }
  } catch {}

  // ── URGENCY-DRIVEN (priority 7-10) ─────────────────────────────────

  // Temporal urgency: scan beliefs for time-sensitive events (max once per hour)
  const hoursSinceLastUrgency = (now - (lastUrgencyAt || 0)) / 3_600_000;
  if (hoursSinceLastUrgency > 1) {
    try {
      const urgentBeliefs = db.prepare(`
        SELECT belief FROM wm_beliefs
        WHERE (belief LIKE '%days%' OR belief LIKE '%tomorrow%' OR belief LIKE '%this week%'
          OR belief LIKE '%deadline%' OR belief LIKE '%conference%')
        AND confidence > 0.4
        LIMIT 3
      `).all();

      for (const ub of urgentBeliefs) {
        const daysMatch = ub.belief.match(/(\d+)\s*days/);
        if (daysMatch && parseInt(daysMatch[1]) <= 7) {
          lastUrgencyAt = now;
          return {
            shouldAct: true,
            reason: `TEMPORAL URGENCY: ${ub.belief.slice(0, 80)}`,
            priority: 9,
            type: "urgency",
            suggestedAction: {
              action: "notify_kirill",
              message: `URGENT: ${ub.belief}\n\nAction needed - this has a deadline.`,
            },
          };
        }
      }
    } catch {}
  }

  // Morning brief
  if (hour === 7 && minutesSinceLastAct > 30) {
    return {
      shouldAct: true,
      reason: "Morning brief time (7 AM Calgary)",
      priority: 7,
      type: "urgency",
      suggestedAction: { action: "run_workflow", workflow: "morning-brief", reason: "Daily morning brief" },
    };
  }

  // ── CURIOSITY-DRIVEN (priority 3-6) ────────────────────────────────

  // No research in 24h - curiosity should kick in
  const hoursSinceResearch = (now - lastResearchAt) / 3_600_000;
  if (hoursSinceResearch > 24 && minutesSinceLastAct > 15 && hour >= 9 && hour <= 21) {
    return {
      shouldAct: true,
      reason: `No deep research in ${Math.round(hoursSinceResearch)}h - curiosity trigger`,
      priority: 4,
      type: "curiosity",
      suggestedAction: {
        action: "deep_research",
        question: pickCuriosityQuestion(db),
        context: "Curiosity-driven: system hasn't researched in 24h",
        reason: "Stay informed about market changes",
      },
    };
  }

  // Narrative has untested threads - should try something
  try {
    const untested = db.prepare(`
      SELECT topic, arc FROM cortex_narrative
      WHERE status = 'untested'
      ORDER BY compiled_at DESC LIMIT 1
    `).get();

    if (untested && minutesSinceLastAct > 20 && hour >= 9 && hour <= 20) {
      return {
        shouldAct: true,
        reason: `Untested opportunity: ${untested.topic}`,
        priority: 5,
        type: "curiosity",
        suggestedAction: null, // let the brain decide what to do with it
      };
    }
  } catch {}

  // Evolution hasn't run in 6h
  const hoursSinceEvolution = (now - lastEvolutionAt) / 3_600_000;
  if (hoursSinceEvolution > 6 && minutesSinceLastAct > 30 && hour >= 9 && hour <= 21) {
    return {
      shouldAct: true,
      reason: `Evolution hasn't run in ${Math.round(hoursSinceEvolution)}h`,
      priority: 3,
      type: "curiosity",
      suggestedAction: null, // handled by meta-cognition cycle
    };
  }

  // ── NOTHING TO DO ──────────────────────────────────────────────────

  // But still run scheduled cycle every 5 min for baseline monitoring
  if (minutesSinceLastAct >= 5) {
    return {
      shouldAct: true,
      reason: "Scheduled 5-min check",
      priority: 1,
      type: "scheduled",
      suggestedAction: null,
    };
  }

  return {
    shouldAct: false,
    reason: "Nothing to do",
    priority: 0,
    type: "idle",
    suggestedAction: null,
  };
}

// ── RECORD THAT WE ACTED ─────────────────────────────────────────────

export function recordAction(type) {
  lastActAt = Date.now();
  if (type === "research") lastResearchAt = Date.now();
  if (type === "evolution") lastEvolutionAt = Date.now();
  if (type === "narrative") lastNarrativeCompileAt = Date.now();
}

// ── HELPERS ───────────────────────────────────────────────────────────

function signalToAction(signal) {
  switch (signal.type) {
    case "email_reply":
      return { action: "run_workflow", workflow: "reply-pipeline", reason: `Email reply from ${signal.from || "unknown"}` };
    case "appointment":
      return { action: "notify_kirill", message: `New appointment booked: ${JSON.stringify(signal.data || {})}` };
    case "form_submission":
      return { action: "notify_kirill", message: `Form submission received: ${JSON.stringify(signal.data || {})}` };
    case "hot_lead":
      return { action: "run_bot", bot: "lead-enrichment-bot", args: ["--batch"], reason: `Hot lead: ${signal.data?.name || "unknown"}` };
    case "telegram_command":
      return null; // brain will handle this via perception
    default:
      return null;
  }
}

function pickCuriosityQuestion(db) {
  // Pick a research question based on what we know least about
  const questions = [
    "What are solo SaaS founders struggling with most after launching their MVP in 2026?",
    "What are small business owners in Calgary complaining about on Reddit this week?",
    "What messaging works best for selling AI automation services to SMBs?",
    "What channels are other AI service sellers using successfully in 2026?",
    "What do solo founders pay for code audits or automation builds? What closes deals?",
  ];

  // Try to pick something related to active narrative threads
  try {
    const activeTopics = db.prepare(
      "SELECT topic FROM cortex_narrative WHERE status = 'active' ORDER BY last_event_at DESC LIMIT 3"
    ).all().map(t => t.topic);

    if (activeTopics.some(t => t.includes("vibe") || t.includes("founder"))) {
      return "What do solo founders do when their vibe-coded app breaks in production? Who do they hire?";
    }
    if (activeTopics.some(t => t.includes("outreach"))) {
      return "What cold outreach approaches for AI services actually get replies in 2026?";
    }
  } catch {}

  // Random pick
  return questions[Math.floor(Math.random() * questions.length)];
}

// ── FORMAT FOR BRAIN CONTEXT ──────────────────────────────────────────

export function formatInitiativeForBrain() {
  const now = Date.now();
  const parts = [];

  if (pendingSignals.length > 0) {
    parts.push(`PENDING SIGNALS: ${pendingSignals.length} (${pendingSignals.map(s => s.type).join(", ")})`);
  }

  const minSinceAct = Math.round((now - lastActAt) / 60_000);
  parts.push(`Last action: ${minSinceAct}m ago`);

  const hSinceResearch = Math.round((now - lastResearchAt) / 3_600_000);
  if (lastResearchAt > 0) parts.push(`Last research: ${hSinceResearch}h ago`);

  return parts.join(" | ") || "Initiative engine active";
}
