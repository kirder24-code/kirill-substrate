/**
 * CORTEX META-COGNITION — The brain that watches the brain
 *
 * After every N cycles, CORTEX reflects on its own decisions:
 * 1. Were my last decisions productive? (outcome measurement)
 * 2. Am I stuck in a loop? (pattern detection)
 * 3. What should I do differently? (strategy mutation)
 * 4. Update procedural memory with learned rules
 *
 * This is what makes CORTEX revolutionary:
 * It doesn't just act — it evaluates itself and evolves.
 *
 * Inspired by:
 * - CoALA framework (Cognitive Architectures for Language Agents)
 * - Metacognitive monitoring in cognitive science
 * - Reflexion paper (Shinn et al. 2023)
 */

import { recall, remember, markOutdated, getRecentDecisions, scoreDecision, getAllKPD } from "./memory.mjs";

// ── REFLECT ON RECENT DECISIONS ────────────────────────────────────────

export function reflectOnDecisions(db, log = console.log) {
  const decisions = getRecentDecisions(db, 10);
  if (decisions.length < 3) return null; // not enough data to reflect

  const unscored = decisions.filter(d => d.was_good_decision === null);
  if (unscored.length === 0) return null; // all scored already

  log("[META] Reflecting on last decisions...");

  const reflections = [];

  for (const d of unscored) {
    const actions = safeJSON(d.actions_taken);
    if (!actions) continue;

    // Score based on what happened after the decision
    const assessment = assessDecision(db, d, actions);
    scoreDecision(db, d.id, assessment.good, assessment.outcome);
    reflections.push(assessment);

    log(`[META] Decision #${d.id}: ${assessment.good ? "GOOD" : "BAD"} - ${assessment.outcome.slice(0, 100)}`);
  }

  return reflections;
}

// ── ASSESS A SINGLE DECISION ───────────────────────────────────────────

function assessDecision(db, decision, actions) {
  // Check what the decision produced
  let botRuns = 0;
  let botSuccesses = 0;
  let botFailures = 0;
  let notifications = 0;
  let memories = 0;
  let skips = 0;

  for (const a of (Array.isArray(actions) ? actions : [])) {
    if (a.action === "run_bot" || a.action === "run_workflow") botRuns++;
    if (a.action === "notify_kirill") notifications++;
    if (a.action === "remember") memories++;
    if (a.action === "skip") skips++;
  }

  // Check KPD for any bots that were run
  const kpd = getAllKPD(db, 1);
  const recentBotResults = kpd.filter(k => k.runs > 0);

  // Heuristic scoring
  let good = true;
  let outcome = "";

  // BAD: only notifications, no actions
  if (notifications > 0 && botRuns === 0 && skips === 0) {
    good = false;
    outcome = "Only sent notifications without running bots. Notifications don't generate revenue.";
  }
  // BAD: ran bots that all failed
  else if (botRuns > 0 && botFailures === botRuns) {
    good = false;
    outcome = `Ran ${botRuns} bots, all failed. Should check bot health before running.`;
  }
  // GOOD: skipped when budget low
  else if (skips > 0 && decision.reasoning?.includes("budget")) {
    good = true;
    outcome = "Correctly saved budget when nothing urgent.";
  }
  // OK: ran bots, some succeeded
  else if (botRuns > 0) {
    outcome = `Ran ${botRuns} bots. Results pending.`;
  }
  // NEUTRAL: only wrote memories
  else if (memories > 0 && botRuns === 0) {
    outcome = "Only wrote memories. Useful for learning but doesn't produce revenue.";
    good = memories < 3; // too many memories = overthinking
  }
  else {
    outcome = "Mixed actions. Outcome unclear.";
  }

  return { good, outcome, botRuns, notifications, memories, skips };
}

// ── DETECT STUCK LOOPS ─────────────────────────────────────────────────

export function detectStuckPatterns(db, log = console.log) {
  const decisions = getRecentDecisions(db, 20);
  if (decisions.length < 5) return [];

  const patterns = [];

  // Pattern 1: Same notification repeated
  const notifications = decisions
    .map(d => safeJSON(d.actions_taken))
    .filter(Boolean)
    .flatMap(actions => (Array.isArray(actions) ? actions : []).filter(a => a.action === "notify_kirill"))
    .map(a => a.message?.slice(0, 50));

  const notifCounts = {};
  for (const n of notifications) {
    if (!n) continue;
    notifCounts[n] = (notifCounts[n] || 0) + 1;
  }
  for (const [msg, count] of Object.entries(notifCounts)) {
    if (count >= 3) {
      patterns.push({
        type: "repeated_notification",
        severity: "high",
        description: `Same notification sent ${count} times: "${msg}"`,
        fix: "Stop sending this notification. Either act on it or drop it.",
      });
    }
  }

  // Pattern 2: Same bot failing repeatedly
  const botActions = decisions
    .map(d => safeJSON(d.actions_taken))
    .filter(Boolean)
    .flatMap(actions => (Array.isArray(actions) ? actions : []).filter(a => a.action === "run_bot"));

  const botAttempts = {};
  for (const a of botActions) {
    botAttempts[a.bot] = (botAttempts[a.bot] || 0) + 1;
  }
  const kpd = getAllKPD(db, 1);
  for (const [bot, count] of Object.entries(botAttempts)) {
    if (count >= 3) {
      const botKpd = kpd.find(k => k.bot_name === bot);
      if (!botKpd || botKpd.total_value === 0) {
        patterns.push({
          type: "bot_spinning",
          severity: "high",
          description: `${bot} ran ${count} times with 0 value output`,
          fix: `Disable ${bot} and try alternative approach.`,
        });
      }
    }
  }

  // Pattern 3: No revenue progress over many cycles
  const badDecisions = decisions.filter(d => d.was_good_decision === 0).length;
  if (badDecisions > decisions.length * 0.6) {
    patterns.push({
      type: "strategy_failing",
      severity: "critical",
      description: `${badDecisions}/${decisions.length} decisions scored BAD. Strategy is not working.`,
      fix: "Fundamental approach change needed. Current tactics produce no results.",
    });
  }

  if (patterns.length > 0) {
    log(`[META] STUCK PATTERNS DETECTED: ${patterns.length}`);
    for (const p of patterns) {
      log(`[META] [${p.severity}] ${p.type}: ${p.description}`);
    }
  }

  return patterns;
}

// ── EVOLVE STRATEGY BASED ON REFLECTION ────────────────────────────────

export function evolveStrategy(db, reflections, stuckPatterns, log = console.log) {
  const rules = [];

  // Generate new procedural rules from reflections
  for (const r of (reflections || [])) {
    if (!r.good && r.outcome) {
      const rule = `LEARNED (${new Date().toISOString().slice(0, 10)}): ${r.outcome}`;
      remember(db, "procedural", rule, "meta-cognition", "cortex", 0.7);
      rules.push(rule);
      log(`[META] NEW RULE: ${rule.slice(0, 100)}`);
    }
  }

  // Generate fixes from stuck patterns
  for (const p of (stuckPatterns || [])) {
    if (p.severity === "high" || p.severity === "critical") {
      const rule = `ANTI-PATTERN (${new Date().toISOString().slice(0, 10)}): ${p.description}. FIX: ${p.fix}`;
      remember(db, "procedural", rule, "meta-cognition", "cortex", 0.9);
      rules.push(rule);
      log(`[META] ANTI-PATTERN RULE: ${rule.slice(0, 100)}`);
    }
  }

  // Deprecate old procedural memories that conflict with new learnings
  if (rules.length > 0) {
    const oldProcedural = recall(db, "procedural", "meta-cognition", 50);
    const seenFixes = new Set();
    for (const mem of oldProcedural) {
      // If we have duplicate anti-patterns, mark older ones outdated
      const key = mem.content.slice(0, 60);
      if (seenFixes.has(key)) {
        markOutdated(db, mem.id, "superseded by newer meta-cognition rule");
      }
      seenFixes.add(key);
    }
  }

  return rules;
}

// ── FULL REFLECTION CYCLE ──────────────────────────────────────────────

export function runMetaCognition(db, log = console.log) {
  log("[META] === META-COGNITION CYCLE ===");

  // 1. Reflect on past decisions
  const reflections = reflectOnDecisions(db, log);

  // 2. Detect stuck patterns
  const stuckPatterns = detectStuckPatterns(db, log);

  // 3. Evolve strategy
  const newRules = evolveStrategy(db, reflections, stuckPatterns, log);

  // 4. Summary
  const summary = {
    decisionsScored: reflections?.length || 0,
    patternsFound: stuckPatterns.length,
    newRulesCreated: newRules.length,
    overallHealth: stuckPatterns.some(p => p.severity === "critical") ? "CRITICAL" :
                   stuckPatterns.length > 0 ? "DEGRADED" : "HEALTHY",
  };

  log(`[META] Summary: ${JSON.stringify(summary)}`);
  log("[META] === META-COGNITION DONE ===");

  return summary;
}

// ── HELPERS ─────────────────────────────────────────────────────────────

function safeJSON(str) {
  try { return JSON.parse(str || "null"); } catch { return null; }
}
