/**
 * CORTEX OPPORTUNITY SYNTHESIS — Cross-signal pattern detection
 *
 * Individual signals are noise. Combined signals are opportunity.
 *
 * Signal A: "Reddit user in r/dental complains about missed after-hours calls"
 * Signal B: "Smith.ai just raised prices by 20%"
 * Signal C: "World model: dental is our highest-confidence vertical (0.7)"
 * Signal D: "Narrative: we haven't tested dental outreach yet (untested thread)"
 *
 * Any ONE of these is interesting. ALL FOUR TOGETHER = urgent opportunity.
 *
 * The Opportunity Synthesizer:
 * 1. Gathers signals from ALL sources (world model, narrative, leads, events)
 * 2. Finds INTERSECTIONS - signals that reinforce each other
 * 3. Scores compound opportunities by strength of intersection
 * 4. Outputs specific, actionable opportunity briefs
 *
 * An opportunity brief is NOT "dental looks good".
 * It IS: "Dental vertical score: 8.5/10. Three reinforcing signals:
 *         (a) 23% call loss after hours, (b) Smith.ai price increase,
 *         (c) 3 Reddit threads this week about phone frustration.
 *         Action: create dental landing page + scout r/dentistry + email blast.
 *         Expected conversion: 5-8% (based on specific offer + pain match).
 *         Time-sensitive: competitor price increase is fresh news."
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { getBeliefs, getEntitiesByType, getRelationships, getUntestedPredictions, addBelief } from "./world-model.mjs";
import { getActiveThreads, getAllThreads } from "./narrative.mjs";
import { remember, recall, markOutdated } from "./memory.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const ENV_PATH = resolve(ROOT, "apps/api/.env");

const env = Object.fromEntries(
  readFileSync(ENV_PATH, "utf-8").split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

// ── SIGNAL GATHERING ──────────────────────────────────────────────────

function gatherSignals(db) {
  const signals = {
    beliefs: [],
    threads: [],
    leads: [],
    predictions: [],
    industries: [],
    competitors: [],
    channels: [],
  };

  // World model beliefs
  signals.beliefs = getBeliefs(db, null, 0.3, 30);

  // Narrative threads
  signals.threads = getAllThreads(db, 15);

  // Untested predictions
  signals.predictions = getUntestedPredictions(db, 10);

  // Industries
  signals.industries = getEntitiesByType(db, "industry", 10);

  // Competitors
  signals.competitors = getEntitiesByType(db, "competitor", 10);

  // Channels
  signals.channels = getEntitiesByType(db, "channel", 10);

  // Recent leads by stage
  try {
    signals.leads = db.prepare(`
      SELECT stage, COUNT(*) as cnt,
        GROUP_CONCAT(DISTINCT source) as sources
      FROM leads
      WHERE created_at > datetime('now', '-7 days')
      GROUP BY stage
    `).all();
  } catch {}

  return signals;
}

// ── INTERSECTION FINDER ───────────────────────────────────────────────

/**
 * Find intersections between signals that create compound opportunities.
 * Pure logic - no LLM needed for basic pattern matching.
 */
function findIntersections(signals) {
  const opportunities = [];

  // PATTERN 1: Industry + Pain + Channel alignment
  for (const industry of signals.industries) {
    const props = industry.properties;
    const industryName = industry.name.toLowerCase();

    // Find beliefs about this industry (check name, domain, and properties)
    // Exclude "opportunity" domain beliefs - those are stored by this same function and
    // create a circular feedback loop where past winners keep re-winning indefinitely.
    const industryKeywords = [industryName, ...(props.keywords || [])].map(k => k.toLowerCase());
    const industryBeliefs = signals.beliefs.filter(b => {
      if (b.domain === "opportunity") return false;
      const text = (b.belief + " " + b.domain).toLowerCase();
      return industryKeywords.some(kw => text.includes(kw));
    });

    // Also count industry-specific properties as signals
    const propScore = Object.keys(props).length; // more data = more confidence

    // Find narrative threads about this industry
    const industryThreads = signals.threads.filter(t =>
      t.topic.toLowerCase().includes(industryName)
    );

    // Find untested predictions about this industry
    const industryPredictions = signals.predictions.filter(p =>
      p.prediction.toLowerCase().includes(industryName) ||
      p.domain.toLowerCase().includes(industryName)
    );

    // Calculate intersection score
    const signalCount = industryBeliefs.length + industryThreads.length + industryPredictions.length;
    const hasHighConfidenceBelief = industryBeliefs.some(b => b.confidence > 0.6);
    const hasUntestedThread = industryThreads.some(t => t.status === "untested");
    const hasTestablePrediction = industryPredictions.length > 0;

    // Lower threshold: even 1 signal + rich properties = opportunity
    if (signalCount >= 1 || propScore >= 2) {
      const score = (
        signalCount * 1.5 +
        propScore * 0.5 +
        (hasHighConfidenceBelief ? 2 : 0) +
        (hasUntestedThread ? 1.5 : 0) +
        (hasTestablePrediction ? 1 : 0) +
        (props.calls_per_month ? 1.5 : 0) +
        (props.after_hours_loss ? 2 : 0) +
        (props.buying_trigger ? 1 : 0) +
        (props.avg_deal_size ? 1 : 0)
      );

      opportunities.push({
        type: "vertical_opportunity",
        target: industry.name,
        score: Math.min(10, score),
        signals: {
          beliefs: industryBeliefs.map(b => b.belief.slice(0, 80)),
          threads: industryThreads.map(t => `[${t.status}] ${t.topic}`),
          predictions: industryPredictions.map(p => p.prediction.slice(0, 80)),
        },
        timeSensitive: false,
        actions: generateVerticalActions(industry, industryBeliefs, industryThreads),
      });
    }
  }

  // PATTERN 2: Competitor weakness + Our strength
  for (const comp of signals.competitors) {
    const weaknessBeliefs = signals.beliefs.filter(b =>
      b.belief.toLowerCase().includes(comp.name.toLowerCase()) &&
      (b.belief.includes("expensive") || b.belief.includes("weakness") || b.belief.includes("complaint"))
    );

    if (weaknessBeliefs.length > 0 && comp.properties.pricing) {
      opportunities.push({
        type: "competitive_opportunity",
        target: comp.name,
        score: 5 + weaknessBeliefs.length * 1.5,
        signals: {
          weaknesses: weaknessBeliefs.map(b => b.belief.slice(0, 80)),
          their_price: comp.properties.pricing,
        },
        timeSensitive: comp.properties.pricing_changed_recently || false,
        actions: [
          `Create comparison page: "LaunchSoloAI vs ${comp.name}"`,
          `Target "${comp.name} alternative" keywords in Google Ads`,
          `Reddit comments where people discuss ${comp.name} pricing`,
        ],
      });
    }
  }

  // PATTERN 3: Channel + Untested combination
  for (const channel of signals.channels) {
    if (channel.properties.effectiveness === "untested") {
      const relatedThreads = signals.threads.filter(t =>
        t.topic.toLowerCase().includes(channel.name.toLowerCase())
      );

      if (relatedThreads.length === 0) {
        // Completely untested channel with no narrative = exploration opportunity
        opportunities.push({
          type: "channel_exploration",
          target: channel.name,
          score: 4,
          signals: { status: "untested, no narrative thread" },
          timeSensitive: false,
          actions: [
            `Research: "How to sell AI services via ${channel.name} in 2026"`,
            `Test with 1 small experiment before committing`,
          ],
        });
      }
    }
  }

  // PATTERN 4: High lead volume + low conversion = bottleneck opportunity
  const warmingLeads = signals.leads.find(l => l.stage === "warming");
  const readyBuyers = signals.leads.find(l => l.stage === "ready_buyer");
  if (warmingLeads?.cnt > 5 && (!readyBuyers || readyBuyers.cnt === 0)) {
    opportunities.push({
      type: "conversion_bottleneck",
      target: "lead conversion",
      score: 8, // high because this directly blocks revenue
      signals: {
        warming: warmingLeads.cnt,
        ready: readyBuyers?.cnt || 0,
        sources: warmingLeads.sources,
      },
      timeSensitive: true,
      actions: [
        "Analyze WHY warming leads aren't converting to ready_buyer",
        "Improve outreach templates with specific pain points",
        "Add follow-up sequence for warming leads",
        "Test direct demo offer instead of educational approach",
      ],
    });
  }

  // Sort by score
  opportunities.sort((a, b) => b.score - a.score);
  return opportunities;
}

function generateVerticalActions(industry, beliefs, threads) {
  const name = industry.name;
  const actions = [];

  const hasLandingPage = false; // TODO: check if page exists
  if (!hasLandingPage) {
    actions.push(`Create dedicated ${name} landing page via HANDS`);
  }

  const hasOutreach = threads.some(t => t.status === "active" && t.topic.includes("outreach"));
  if (!hasOutreach) {
    actions.push(`Draft ${name}-specific outreach with industry pain points`);
  }

  actions.push(`Scout Reddit for ${name} conversations about phone/call issues`);
  actions.push(`Research ${name} buying triggers and decision makers`);

  return actions;
}

// ── MAIN SYNTHESIS CYCLE ──────────────────────────────────────────────

/**
 * Run opportunity synthesis:
 * 1. Gather all signals
 * 2. Find intersections
 * 3. Score and rank opportunities
 * 4. Report top opportunities
 */
export async function synthesizeOpportunities(db, log = console.log) {
  log("[SYNTHESIS] === OPPORTUNITY SYNTHESIS ===");

  // 0. Purge stale Voice Agent memory entries so they never surface via recall
  try {
    const staleEntries = recall(db, "working", "opportunity", 50);
    const VOICE_AGENT_PATTERNS = ["voice receptionist", "voice agent", "ai receptionist", "vapi"];
    for (const entry of staleEntries) {
      const lower = (entry.content || "").toLowerCase();
      if (VOICE_AGENT_PATTERNS.some(p => lower.includes(p))) {
        markOutdated(db, entry.id, "Voice Agent offer discontinued 2026-04-22 - purged by synthesis cleanup");
        log(`[SYNTHESIS] Marked stale Voice Agent memory entry #${entry.id} as outdated`);
      }
    }
  } catch (e) { log(`[SYNTHESIS] Cleanup error: ${e.message}`); }

  // 1. Gather signals
  const signals = gatherSignals(db);
  const signalCount = Object.values(signals).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
  log(`[SYNTHESIS] Gathered ${signalCount} signals across ${Object.keys(signals).length} sources`);

  // 2. Find intersections
  const rawOpportunities = findIntersections(signals);

  // 3. Filter out discontinued opportunities.
  // "AI Voice Receptionist" and variants were permanently discontinued 2026-04-22.
  // Block by name first (survives DB regeneration), then check entity-level discontinued flag,
  // then fall back to legacy props heuristic.
  const DISCONTINUED_TARGETS = ["voice receptionist", "voice agent", "ai receptionist"];
  const opportunities = rawOpportunities.filter(opp => {
    const targetLower = (opp.target || "").toLowerCase();
    if (DISCONTINUED_TARGETS.some(t => targetLower.includes(t))) return false;
    if (opp.type !== "vertical_opportunity") return true;
    const entity = signals.industries.find(i => i.name === opp.target);
    if (!entity) return true;
    if (entity.properties.discontinued === true) return false;
    const hasActiveBeliefs = (opp.signals?.beliefs?.length || 0) > 0;
    if (!hasActiveBeliefs && (entity.properties.calls_per_month || entity.properties.after_hours_loss)) return false;
    return true;
  });

  const filteredCount = rawOpportunities.length - opportunities.length;
  if (filteredCount > 0) {
    log(`[SYNTHESIS] Filtered ${filteredCount} discontinued/stale opportunity(s) (voice-agent-era verticals with no active beliefs)`);
  }
  log(`[SYNTHESIS] Found ${opportunities.length} compound opportunities`);

  // 4. Log top opportunities
  for (const opp of opportunities.slice(0, 5)) {
    log(`  [${opp.score.toFixed(1)}] ${opp.type}: ${opp.target}${opp.timeSensitive ? " (TIME-SENSITIVE)" : ""}`);
    for (const action of (opp.actions || []).slice(0, 2)) {
      log(`    -> ${action}`);
    }
  }

  // 4. Store top opportunity as working memory
  if (opportunities.length > 0) {
    const top = opportunities[0];
    remember(db, "working",
      `TOP OPPORTUNITY (score ${top.score.toFixed(1)}): ${top.type} - ${top.target}. Actions: ${(top.actions || []).slice(0, 2).join("; ")}${top.timeSensitive ? " [TIME-SENSITIVE]" : ""}`,
      "opportunity", "synthesis", 0.8
    );

    // Store as a belief
    addBelief(db, "opportunity",
      `Best current opportunity: ${top.target} (${top.type}, score ${top.score.toFixed(1)}/10)`,
      top.score / 10,
      Object.values(top.signals).flat().slice(0, 5).map(s => typeof s === 'string' ? s : JSON.stringify(s)),
      "synthesis"
    );
  }

  // 5. Notify if time-sensitive opportunity found
  const urgent = opportunities.filter(o => o.timeSensitive);
  if (urgent.length > 0) {
    const TG_TOKEN = env.TELEGRAM_BOT_TOKEN;
    const CHAT_ID = env.TELEGRAM_CHAT_ID;
    if (TG_TOKEN && CHAT_ID) {
      const msg = `OPPORTUNITY ALERT:\n${urgent.map(o => `[${o.score.toFixed(1)}] ${o.target}: ${(o.actions || [])[0] || "act now"}`).join("\n")}`;
      try {
        await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: CHAT_ID, text: msg.slice(0, 4096) }),
        });
      } catch {}
    }
  }

  return {
    totalSignals: signalCount,
    opportunities: opportunities.length,
    topOpportunity: opportunities[0] || null,
    urgent: urgent.length,
  };
}

// ── FORMAT FOR BRAIN ──────────────────────────────────────────────────

export function formatOpportunitiesForBrain(db) {
  // Get last synthesis from working memory
  const opp = recall(db, "working", "opportunity", 1);
  if (opp.length === 0) return "No opportunities synthesized yet.";
  return opp[0].content;
}
