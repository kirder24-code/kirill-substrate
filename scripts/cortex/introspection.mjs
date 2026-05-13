/**
 * CORTEX INTROSPECTION — The system watches itself think
 *
 * This is the module that no other AI system has.
 *
 * Meta-cognition asks: "did my actions work?"
 * Introspection asks: "WHY did I choose those actions? What pattern
 * in MY THINKING led to that choice? Is that pattern serving me?"
 *
 * Examples of what introspection catches:
 *
 * BIAS DETECTION:
 *   "I've chosen scout-bot 12 times and follow-up 0 times.
 *    I have a discovery bias - I prefer finding new leads over
 *    converting existing ones. This is wrong because converting
 *    is higher EV than discovering."
 *
 * REASONING QUALITY:
 *   "My last 5 decisions all had confidence > 0.8 but only 2/5 worked.
 *    I'm overconfident. I should reduce my confidence calibration."
 *
 * ATTENTION BLIND SPOTS:
 *   "I always research competitors but never customers.
 *    I know what Smith.ai charges but not what dental clinics
 *    actually want. My research is lopsided."
 *
 * STUCK PATTERNS:
 *   "I've been running lead-pipeline every hour for 3 days.
 *    Revenue is still $0. The pipeline works but leads aren't converting.
 *    The bottleneck isn't discovery - it's conversion.
 *    I should stop scouting and start closing."
 *
 * EMOTIONAL ANALOG:
 *   "I'm in 'safe mode' - only running proven workflows, avoiding
 *    experiments. But revenue=$0 means I should be in 'bold mode' -
 *    trying new things aggressively. Safety is a luxury for profitable systems."
 *
 * The output is a SELF-CORRECTION: specific changes to thinking patterns,
 * attention allocation, risk tolerance, and decision criteria.
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { recall, remember } from "./memory.mjs";
import { getBeliefs, getPredictionAccuracy } from "./world-model.mjs";
import { getActiveThreads, getAllThreads } from "./narrative.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const ENV_PATH = resolve(ROOT, "apps/api/.env");

const env = Object.fromEntries(
  readFileSync(ENV_PATH, "utf-8").split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

// ── PATTERN DETECTORS (fast, no LLM) ─────────────────────────────────

/**
 * Analyze recent decisions and detect cognitive biases.
 * Returns array of detected patterns.
 */
function detectPatterns(db) {
  const patterns = [];

  // Get recent decisions
  const decisions = db.prepare(
    "SELECT * FROM cortex_decisions ORDER BY decided_at DESC LIMIT 30"
  ).all();

  if (decisions.length < 5) return patterns; // not enough data

  // ── BIAS 1: Action preference bias ──────────────────────────────────
  // Does the system always choose the same action type?
  const actionCounts = {};
  for (const d of decisions) {
    try {
      const actions = JSON.parse(d.actions_taken || "[]");
      for (const a of (Array.isArray(actions) ? actions : [])) {
        const key = a.action || "unknown";
        actionCounts[key] = (actionCounts[key] || 0) + 1;
      }
    } catch {}
  }

  const totalActions = Object.values(actionCounts).reduce((a, b) => a + b, 0);
  for (const [action, count] of Object.entries(actionCounts)) {
    const ratio = count / totalActions;
    if (ratio > 0.5 && count > 5) {
      patterns.push({
        type: "action_preference_bias",
        severity: ratio > 0.7 ? "high" : "medium",
        description: `Action "${action}" chosen ${count}/${totalActions} times (${Math.round(ratio * 100)}%). Over-relying on one action type.`,
        correction: `Diversify actions. Consider alternatives to "${action}". If it's working, great. If revenue is still $0, it's not working despite being "chosen" a lot.`,
      });
    }
  }

  // ── BIAS 2: Skip bias (avoidance) ──────────────────────────────────
  const skipCount = actionCounts["skip"] || 0;
  if (skipCount > totalActions * 0.4 && skipCount > 5) {
    patterns.push({
      type: "avoidance_bias",
      severity: "high",
      description: `Skipping ${skipCount}/${totalActions} actions (${Math.round(skipCount / totalActions * 100)}%). System is too conservative.`,
      correction: "Revenue = $0. Conservative = losing. Take more actions, accept more risk. Every skip is a missed opportunity.",
    });
  }

  // ── BIAS 3: Discovery vs Conversion imbalance ─────────────────────
  const discoveryCount = (actionCounts["run_workflow"] || 0); // most workflows are discovery
  const conversionActions = ["execute_hands", "deep_research", "notify_kirill"];
  const conversionCount = conversionActions.reduce((sum, a) => sum + (actionCounts[a] || 0), 0);

  if (discoveryCount > conversionCount * 3 && discoveryCount > 5) {
    patterns.push({
      type: "discovery_over_conversion",
      severity: "high",
      description: `Discovery actions: ${discoveryCount}, Conversion actions: ${conversionCount}. Finding leads but not converting them.`,
      correction: "The bottleneck is conversion, not discovery. Focus on: improving outreach quality, testing new channels, creating landing pages for specific verticals.",
    });
  }

  // ── BIAS 4: Overconfidence ──────────────────────────────────────────
  try {
    const accuracy = getPredictionAccuracy(db);
    if (accuracy?.total_tested > 5) {
      const actualAccuracy = accuracy.correct / accuracy.total_tested;
      if (accuracy.avg_confidence > actualAccuracy + 0.2) {
        patterns.push({
          type: "overconfidence",
          severity: "medium",
          description: `Average confidence: ${(accuracy.avg_confidence * 100).toFixed(0)}%, actual accuracy: ${(actualAccuracy * 100).toFixed(0)}%. Overconfident by ${((accuracy.avg_confidence - actualAccuracy) * 100).toFixed(0)} points.`,
          correction: `Reduce confidence in predictions by ${((accuracy.avg_confidence - actualAccuracy) * 100).toFixed(0)}%. Be more honest about uncertainty.`,
        });
      }
      if (accuracy.avg_confidence < actualAccuracy - 0.2) {
        patterns.push({
          type: "underconfidence",
          severity: "low",
          description: `Average confidence: ${(accuracy.avg_confidence * 100).toFixed(0)}%, actual accuracy: ${(actualAccuracy * 100).toFixed(0)}%. Under-confident.`,
          correction: "Trust your predictions more. You're better calibrated than you think.",
        });
      }
    }
  } catch {}

  // ── BIAS 5: Stuck loop detection ────────────────────────────────────
  // Same decision made 3+ times in a row
  if (decisions.length >= 3) {
    const lastThree = decisions.slice(0, 3).map(d => d.decision?.slice(0, 50));
    if (lastThree[0] === lastThree[1] && lastThree[1] === lastThree[2]) {
      patterns.push({
        type: "stuck_loop",
        severity: "critical",
        description: `Same decision made 3 times in a row: "${lastThree[0]}". System is stuck.`,
        correction: "BREAK THE LOOP. Try something completely different. If the same action isn't producing results, doing it again won't help.",
      });
    }
  }

  // ── BIAS 6: Time-of-day bias ────────────────────────────────────────
  const hourCounts = {};
  for (const d of decisions) {
    const hour = new Date(d.decided_at).getHours();
    hourCounts[hour] = (hourCounts[hour] || 0) + 1;
  }
  const activeHours = Object.keys(hourCounts).length;
  if (activeHours < 8 && decisions.length > 15) {
    patterns.push({
      type: "time_clustering",
      severity: "low",
      description: `Actions only during ${activeHours} hours of the day. Missing opportunities during other hours.`,
      correction: "Expand active hours. Leads and opportunities don't only appear during business hours.",
    });
  }

  return patterns;
}

// ── DEEP INTROSPECTION (LLM) ─────────────────────────────────────────

/**
 * Full introspection cycle. Detects patterns + asks LLM for deeper insight.
 * Returns self-corrections that update the system's behavior.
 */
export async function introspect(db, log = console.log) {
  log("[INTROSPECTION] === SELF-EXAMINATION ===");

  // 1. Fast pattern detection
  const patterns = detectPatterns(db);
  log(`[INTROSPECTION] Detected ${patterns.length} patterns`);
  for (const p of patterns) {
    log(`  [${p.severity}] ${p.type}: ${p.description.slice(0, 80)}`);
  }

  if (patterns.length === 0 && !shouldDeepIntrospect(db)) {
    log("[INTROSPECTION] No patterns detected, skipping deep introspection");
    return { patterns: [], corrections: [], mode: null };
  }

  // 2. Gather context for LLM introspection
  const threads = getAllThreads(db, 10);
  const beliefs = getBeliefs(db, null, 0.3, 10);
  const procedural = recall(db, "procedural", null, 10);
  const recentDecisions = db.prepare("SELECT * FROM cortex_decisions ORDER BY decided_at DESC LIMIT 10").all();

  // 3. LLM deep introspection
  const prompt = `You are the INTROSPECTION MODULE of CORTEX - an autonomous business system.

Your job: examine the system's THINKING PATTERNS and find cognitive bugs.

You are NOT evaluating actions (meta-cognition does that).
You are evaluating the REASONING PROCESS that leads to actions.

DETECTED PATTERNS:
${patterns.map(p => `[${p.severity}] ${p.type}: ${p.description}\nCorrection: ${p.correction}`).join("\n\n") || "None detected by fast scan"}

RECENT DECISIONS (HOW the system decided):
${recentDecisions.map(d => `[${d.decided_at}] Reasoning: "${d.reasoning?.slice(0, 100)}" → Decision: "${d.decision?.slice(0, 100)}" → ${d.was_good_decision === 1 ? "GOOD" : d.was_good_decision === 0 ? "BAD" : "unknown"}`).join("\n")}

ACTIVE NARRATIVE THREADS:
${threads.filter(t => t.status === "active").map(t => `${t.topic}: ${t.arc.slice(0, 100)}`).join("\n") || "none"}

BELIEFS:
${beliefs.map(b => `[${b.domain}] ${b.belief} (conf: ${b.confidence}, contradictions: ${b.contradictions.length})`).join("\n") || "none"}

KNOWN PROCEDURES:
${procedural.map(p => p.content.slice(0, 80)).join("\n") || "none"}

SYSTEM STATE: Revenue = $0. Product live. No paying clients yet.

Examine DEEPLY:

1. COGNITIVE BIASES: What systematic errors in reasoning do you see?
   Not "actions failed" but "WHY did the system choose those actions?"

2. ATTENTION ALLOCATION: What is the system paying attention to? What is it ignoring?
   Is it researching the right things? Looking at the right signals?

3. RISK CALIBRATION: Is the system too cautious or too bold?
   Revenue=$0 means boldness is needed. Is the system being bold enough?

4. LEARNING EFFICIENCY: Is the system learning from mistakes?
   Does it repeat failures? Does it try enough NEW things?

5. SELF-MODEL ACCURACY: Does the system understand its own strengths and weaknesses?
   What can it do well that it's not leveraging?

6. OPERATING MODE: What mode should the system be in?
   - "survival" = revenue first, cut everything else
   - "exploration" = try many things, learn fast
   - "exploitation" = double down on what works
   - "pivot" = current approach isn't working, need new direction

Return JSON:
{
  "diagnosis": "2-3 sentence summary of what's wrong with the system's THINKING",
  "biases_found": [
    {"bias": "name", "evidence": "what shows this bias", "impact": "how it hurts revenue"}
  ],
  "blind_spots": ["What the system isn't seeing or considering"],
  "corrections": [
    {
      "what": "specific change to thinking/behavior",
      "why": "why this will help",
      "how": "concrete implementation - what to do differently",
      "priority": "critical|high|medium"
    }
  ],
  "recommended_mode": "survival|exploration|exploitation|pivot",
  "mode_reason": "why this mode",
  "self_score": 0-100,
  "one_thing": "If the system could only change ONE thing about how it thinks, what should it be?"
}`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.4",
        messages: [{ role: "user", content: prompt }],
        max_completion_tokens: 2000,
        temperature: 0.4,
        response_format: { type: "json_object" },
      }),
    });

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      log("[INTROSPECTION] LLM returned empty");
      return { patterns, corrections: [], mode: null };
    }

    const result = JSON.parse(content);

    // Log findings
    log(`[INTROSPECTION] Diagnosis: ${result.diagnosis}`);
    log(`[INTROSPECTION] Mode: ${result.recommended_mode} - ${result.mode_reason?.slice(0, 80)}`);
    log(`[INTROSPECTION] Self-score: ${result.self_score}/100`);
    log(`[INTROSPECTION] ONE THING: ${result.one_thing}`);
    for (const c of (result.corrections || [])) {
      log(`  [${c.priority}] ${c.what}: ${c.why?.slice(0, 60)}`);
    }

    // Store corrections as procedural memory
    for (const c of (result.corrections || [])) {
      remember(db, "procedural",
        `INTROSPECTION CORRECTION [${c.priority}]: ${c.what}. ${c.how}`,
        "self-correction", "introspection", 0.8
      );
    }

    // Store mode recommendation
    if (result.recommended_mode) {
      remember(db, "working",
        `OPERATING MODE: ${result.recommended_mode}. Reason: ${result.mode_reason?.slice(0, 100)}`,
        "mode", "introspection", 0.9
      );
    }

    // Store the one thing
    if (result.one_thing) {
      remember(db, "working",
        `INTROSPECTION: The ONE thing to change: ${result.one_thing}`,
        "priority", "introspection", 0.95
      );
    }

    return {
      patterns,
      corrections: result.corrections || [],
      mode: result.recommended_mode,
      modeReason: result.mode_reason,
      diagnosis: result.diagnosis,
      selfScore: result.self_score,
      oneThing: result.one_thing,
      biases: result.biases_found || [],
      blindSpots: result.blind_spots || [],
    };

  } catch (e) {
    log(`[INTROSPECTION] LLM failed: ${e.message}`);
    return { patterns, corrections: [], mode: null, error: e.message };
  }
}

function shouldDeepIntrospect(db) {
  // Deep introspect if: revenue is still 0 and system has been running > 24h
  try {
    const firstDecision = db.prepare("SELECT decided_at FROM cortex_decisions ORDER BY decided_at ASC LIMIT 1").get();
    if (!firstDecision) return false;
    const hoursSinceStart = (Date.now() - new Date(firstDecision.decided_at).getTime()) / 3_600_000;
    return hoursSinceStart > 24;
  } catch {
    return false;
  }
}

// ── FORMAT FOR BRAIN ──────────────────────────────────────────────────

export function formatIntrospectionForBrain(db) {
  // Get last introspection corrections
  const corrections = recall(db, "procedural", "self-correction", 3);
  const mode = recall(db, "working", "mode", 1);

  const parts = [];
  if (mode.length > 0) parts.push(mode[0].content);
  if (corrections.length > 0) {
    parts.push("Self-corrections: " + corrections.map(c => c.content.replace("INTROSPECTION CORRECTION", "").slice(0, 80)).join("; "));
  }

  return parts.join("\n") || "No introspection data yet.";
}
