/**
 * MARKET SELECTOR — Contracted Module
 *
 * Compares ALL available markets and selects the best one.
 * Not "which market has signals" but "which market is fastest path to revenue".
 *
 * 6 scoring criteria:
 * 1. Signal volume — how many pain signals detected
 * 2. Reply rate — do people from this market respond
 * 3. Channel access — can we actually reach them
 * 4. Skill fit — can Kirill deliver
 * 5. Revenue proximity — how fast to money
 * 6. Delivery fit — how fast to result + testimonial
 */

import { ValidationError } from "../error-types.mjs";

export const CONTRACT = {
  module_name: "market-selector",
  version: "1.0.0",
  purpose: "Compare all markets and select best path to revenue with justification",
  owner_layer: "reasoning",

  inputs: { schema: {}, required: [] },
  outputs: {
    schema: { markets: "MarketScore[]", selected: "MarketScore", reasoning: "string" },
    guaranteed: ["markets", "selected"],
  },

  reads_from: ["leads", "outreach_emails", "execution_evidence", "constraints", "opportunities", "projects"],
  writes_to: ["bot_intelligence"],
  depends_on_modules: ["world-state-compiler"],
  downstream_modules: ["qualification-engine", "decision-engine"],
  emits_events: ["market_selected"],
  consumes_events: [],

  preconditions: [],
  postconditions: [
    { check: "output.markets.length > 0", severity: "warn" },
    { check: "output.selected", severity: "block" },
  ],

  hooks_before: ["load_constraints", "load_outcomes"],
  hooks_after: ["write_evidence", "write_run_log"],

  autonomy: {
    level: "automatic",
    risk_class: "medium",
    escalation_on_failure: "log_and_continue",
  },

  error_types: ["ValidationError"],
  retry_policy: { max_retries: 0 },
  timeout_ms: 60000,
};

export async function execute(db, input, context) {
  // ═══ GATHER DATA PER MARKET ═══

  // All leads by source_platform / location
  const leadsByMarket = db.prepare(`
    SELECT
      CASE
        WHEN source_platform LIKE '%ph%' OR location LIKE '%philipp%' THEN 'Philippines'
        WHEN location LIKE '%calgar%' OR location LIKE '%alberta%' OR location LIKE '%canada%' THEN 'Canada'
        WHEN source_platform LIKE '%linkedin_global%' THEN 'Global_LinkedIn'
        WHEN source_platform LIKE '%reddit%' OR source_platform LIKE '%r/%' THEN 'Global_Reddit'
        WHEN source_platform LIKE '%n8n%' THEN 'Global_n8n_Community'
        ELSE 'Global_Other'
      END as market,
      COUNT(*) as leads,
      AVG(score) as avg_score
    FROM leads
    GROUP BY market
    ORDER BY leads DESC
  `).all();

  // Reply rates per market
  const replysByMarket = db.prepare(`
    SELECT
      CASE
        WHEN l.source_platform LIKE '%ph%' OR l.location LIKE '%philipp%' THEN 'Philippines'
        WHEN l.location LIKE '%calgar%' OR l.location LIKE '%canada%' THEN 'Canada'
        WHEN l.source_platform LIKE '%reddit%' THEN 'Global_Reddit'
        WHEN l.source_platform LIKE '%n8n%' THEN 'Global_n8n_Community'
        ELSE 'Global_Other'
      END as market,
      COUNT(*) as sent,
      SUM(CASE WHEN oe.reply_received_at IS NOT NULL THEN 1 ELSE 0 END) as replies
    FROM outreach_emails oe
    LEFT JOIN leads l ON l.id = oe.lead_id
    WHERE oe.status = 'sent'
    GROUP BY market
  `).all();

  // Constraints per market
  const channelConstraints = db.prepare("SELECT scope, rule FROM constraints WHERE constraint_type = 'channel' AND active = 1").all();

  // Past projects per market
  const projectsByMarket = db.prepare(`
    SELECT linked_market, COUNT(*) as projects,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
    FROM projects
    WHERE linked_market IS NOT NULL
    GROUP BY linked_market
  `).all();

  // ═══ BUILD MARKET PROFILES ═══
  const marketData = {};

  for (const row of leadsByMarket) {
    marketData[row.market] = {
      name: row.market,
      signals: row.leads,
      avg_score: Math.round(row.avg_score || 0),
      sent: 0, replies: 0, reply_rate: 0,
      projects: 0, completed_projects: 0,
      channel_access: "unknown",
    };
  }

  for (const row of replysByMarket) {
    if (marketData[row.market]) {
      marketData[row.market].sent = row.sent;
      marketData[row.market].replies = row.replies;
      marketData[row.market].reply_rate = row.sent > 0 ? Math.round(row.replies / row.sent * 100) : 0;
    }
  }

  for (const row of projectsByMarket) {
    const key = Object.keys(marketData).find(k => k.toLowerCase().includes((row.linked_market || "").toLowerCase().slice(0, 5)));
    if (key) {
      marketData[key].projects = row.projects;
      marketData[key].completed_projects = row.completed;
    }
  }

  // Channel access from constraints
  for (const c of channelConstraints) {
    for (const key of Object.keys(marketData)) {
      if (key.toLowerCase().includes(c.scope.toLowerCase())) {
        marketData[key].channel_access = c.rule.slice(0, 100);
      }
    }
  }

  const marketProfiles = Object.values(marketData);
  const profileText = marketProfiles.map(m =>
    `${m.name}: ${m.signals} signals, avg_score ${m.avg_score}, ${m.sent} sent, ${m.replies} replies (${m.reply_rate}%), ${m.projects} projects (${m.completed_projects} done), channel: ${m.channel_access}`
  ).join("\n");

  // ═══ ASK GPT TO SCORE AND SELECT ═══
  const { callAI, MODEL_STRONG, getSystemMission } = await import("../../orchestrator.mjs");

  const result = await callAI(
    `${getSystemMission()}

You are the Market Selection Engine. Compare ALL markets below and select the BEST one for Kirill to focus on RIGHT NOW.

SCORING CRITERIA (each 0-100):
1. Signal volume — more signals = more opportunities to work
2. Reply rate — higher reply rate = proven engagement
3. Channel access — can Kirill actually reach these people with available channels
4. Skill fit — can Kirill build and deliver automation for this market
5. Revenue proximity — how quickly can this become a paid project ($1,500+)
6. Delivery fit — how fast can Kirill deliver, get results, get a testimonial

CRITICAL RULES:
- Do NOT default to the market with most signals
- Revenue proximity and delivery fit matter MORE than signal volume
- A market with 5 signals but 20% reply rate beats a market with 50 signals and 0% reply rate
- Consider: Kirill has NO LinkedIn Premium, low Reddit karma, email works best
- Global English-speaking markets may be better than Philippines if channel access is easier
- n8n Community is ON HOLD — account paused

MARKET DATA:
${profileText}

KIRILL'S SKILLS: n8n workflows, AI orchestration (GPT/Ollama), Notion systems, business process automation, local AI servers. Best at: operational workflows for service businesses.

Return JSON: {
  "markets": [
    {"name": "market", "signal_score": 0-100, "reply_score": 0-100, "channel_score": 0-100, "skill_score": 0-100, "revenue_proximity": 0-100, "delivery_fit": 0-100, "total": 0-100, "strengths": "why good", "weaknesses": "why bad"}
  ],
  "selected": "market name",
  "reasoning": "2-3 sentences why this market over others — tied to revenue, not just signals",
  "runner_up": "second best market",
  "avoid": "which market to avoid now and why"
}`,
    "Compare all markets. Select best path to revenue.",
    MODEL_STRONG
  );

  if (!result?.markets) {
    throw new ValidationError("No market analysis returned", { module: CONTRACT.module_name });
  }

  // Save result
  const { setIntelligence } = await import("../../orchestrator.mjs");
  setIntelligence(db, "market-selector", "analysis", "latest", {
    markets: result.markets,
    selected: result.selected,
    reasoning: result.reasoning,
    runner_up: result.runner_up,
    avoid: result.avoid,
    analyzedAt: new Date().toISOString(),
  }, 90);

  context._emittedEvents = [{
    type: "market_selected",
    payload: { selected: result.selected, reasoning: result.reasoning },
  }];

  return result;
}
