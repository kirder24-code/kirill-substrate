/**
 * BOT REGISTRY - Every bot the brain can control
 *
 * Each bot is registered with:
 * - what it does (purpose)
 * - what it needs (input)
 * - what it produces (output)
 * - how to measure its KPD (efficiency)
 * - invocation mode: autonomous (no args) or args-required
 */

export const BOT_REGISTRY = {
  // ── LAYER 1: LEAD DISCOVERY ──────────────────────────────────────────────
  "scout-bot": {
    layer: "discovery",
    purpose: "Finds potential clients across Reddit, Brave Search, HN, LinkedIn",
    script: "scripts/factory/scout-bot.mjs",
    autonomous: true, // runs on its own, no args needed
    args_spec: null,
    output: { leads_found: "number", leads_qualified: "number" },
    kpd_metric: "leads_qualified per dollar spent",
    cost_per_run: 0.15,
    tier: 1,
  },

  "awareness-bot": {
    layer: "discovery",
    purpose: "Scans market for trends, competitors, opportunities, new channels",
    script: "scripts/factory/awareness-bot.mjs",
    autonomous: true,
    args_spec: null,
    output: { findings: "object" },
    kpd_metric: "actionable findings per dollar spent",
    cost_per_run: 0.30,
    tier: 2,
  },

  "reddit-monitor": {
    layer: "discovery",
    purpose: "Tracks replies to Kirill's Reddit comments and posts",
    script: "scripts/factory/reddit-monitor.mjs",
    autonomous: true,
    args_spec: null,
    output: { replies_found: "number", hot_replies: "number" },
    kpd_metric: "hot replies found per run",
    cost_per_run: 0.05,
    tier: 1,
  },

  // ── LAYER 2: LEAD PROCESSING ────────────────────────────────────────────
  "lead-enrichment-bot": {
    layer: "processing",
    purpose: "Classifies leads as ready_buyer/warming/not_fit with detailed analysis",
    script: "scripts/factory/lead-enrichment-bot.mjs",
    autonomous: false,
    args_spec: "<lead_id> or --batch (enriches all stage='new' leads)",
    output: { enriched: "number", ready_buyers: "number" },
    kpd_metric: "ready_buyers found per dollar spent",
    cost_per_run: 0.50,
    tier: 1,
  },

  "icp-outreach-bot": {
    layer: "processing",
    purpose: "Drafts personalized outreach messages for qualified leads. Self-contained - finds own candidates from DB.",
    script: "scripts/factory/icp-outreach-bot.mjs",
    autonomous: true, // finds its own leads from DB, no args
    args_spec: null,
    output: { drafts_produced: "number", dispatched: "number" },
    kpd_metric: "dispatched drafts per dollar spent",
    cost_per_run: 0.40,
    tier: 1,
  },

  "draft-quality-checker": {
    layer: "processing",
    purpose: "Quality gate for all outbound text - catches AI-tells, em-dashes, bad patterns",
    script: "scripts/factory/draft-quality-checker.mjs",
    autonomous: false,
    args_spec: "--batch (checks all pending drafts)",
    output: { verdict: "PASS|FAIL", violations: "array" },
    kpd_metric: "always useful (inline tool)",
    cost_per_run: 0.02,
    tier: 1,
  },

  // ── LAYER 3: SALES & DELIVERY ───────────────────────────────────────────
  "sales-bot": {
    layer: "sales",
    purpose: "Manages sales funnel - qualification, proposals, follow-ups",
    script: "scripts/factory/sales-bot.mjs",
    autonomous: true,
    args_spec: null,
    output: { proposals_sent: "number", follow_ups: "number" },
    kpd_metric: "conversations started per dollar spent",
    cost_per_run: 0.20,
    tier: 1,
  },

  "content-bot": {
    layer: "sales",
    purpose: "Drafts LinkedIn posts and content in Kirill's voice",
    script: "scripts/factory/content-bot.mjs",
    autonomous: false,
    args_spec: "draft | schedule (first arg = task type)",
    output: { drafts: "number" },
    kpd_metric: "approved posts per dollar spent",
    cost_per_run: 0.15,
    tier: 2,
  },

  "builder-bot": {
    layer: "sales",
    purpose: "Builds real client deliverables when deal is approved",
    script: "scripts/factory/builder-bot.mjs",
    autonomous: false,
    args_spec: "<deal_id>",
    output: { deliverable_ready: "boolean" },
    kpd_metric: "deliverables completed (only runs on real deals)",
    cost_per_run: 1.00,
    tier: 3,
  },

  // ── LAYER 4: STRATEGY & INTELLIGENCE ─────────────────────────────────────
  "idea-bot": {
    layer: "strategy",
    purpose: "Generates revenue ideas from cross-system signal synthesis",
    script: "scripts/factory/idea-bot.mjs",
    autonomous: true,
    args_spec: null,
    output: { ideas: "number", high_score_ideas: "number" },
    kpd_metric: "actionable ideas per dollar spent",
    cost_per_run: 0.30,
    tier: 2,
  },

  "competitor-agent": {
    layer: "strategy",
    purpose: "Validates ideas by checking market competition and gaps",
    script: "scripts/factory/competitor-agent.mjs",
    autonomous: true,
    args_spec: null,
    output: { gap_score: "number", verdict: "build|reject" },
    kpd_metric: "validated ideas per dollar spent",
    cost_per_run: 0.20,
    tier: 2,
  },

  "evolution-bot": {
    layer: "strategy",
    purpose: "Reads 7-day KPIs, diagnoses problems, mutates bot strategies",
    script: "scripts/factory/evolution-bot.mjs",
    autonomous: true,
    args_spec: null,
    output: { strategies_evolved: "number" },
    kpd_metric: "strategy improvements that increased KPIs",
    cost_per_run: 0.30,
    tier: 3,
  },

  "brief-agent": {
    layer: "strategy",
    purpose: "Generates morning briefing with priorities and opportunities",
    script: "scripts/factory/brief-agent.mjs",
    autonomous: true,
    args_spec: null,
    output: { brief_sent: "boolean" },
    kpd_metric: "always useful (daily report)",
    cost_per_run: 0.25,
    tier: 2,
  },

  // ── LAYER 5: VOICE AGENT PRODUCT — DISCONTINUED 2026-04-22 ───────────────
  "vapi-voice-agent": {
    layer: "product",
    purpose: "DISCONTINUED 2026-04-22. AI receptionist product - no longer offered.",
    script: null,
    autonomous: false,
    args_spec: null,
    output: {},
    kpd_metric: "N/A - discontinued",
    cost_per_run: 0,
    tier: 0,
    status: "discontinued",
    discontinued_at: "2026-04-22",
  },

  "vapi-outbound-caller": {
    layer: "product",
    purpose: "DISCONTINUED 2026-04-22. Outbound AI caller - no longer offered.",
    script: null,
    autonomous: false,
    args_spec: null,
    output: {},
    kpd_metric: "N/A - discontinued",
    cost_per_run: 0,
    tier: 0,
    status: "discontinued",
    discontinued_at: "2026-04-22",
  },

  // ── LAYER 6: INFRASTRUCTURE ──────────────────────────────────────────────
  "site-curator-bot": {
    layer: "infrastructure",
    purpose: "Monitors and maintains launchsoloai.com",
    script: "scripts/factory/site-curator-bot.mjs",
    autonomous: true,
    args_spec: null,
    output: { suggestions: "number" },
    kpd_metric: "site improvements deployed",
    cost_per_run: 0.15,
    tier: 3,
  },

  "monitor-replies": {
    layer: "infrastructure",
    purpose: "Watches email inbox and Reddit for responses to outreach",
    script: "scripts/outreach/monitor-replies.mjs",
    autonomous: true,
    args_spec: null,
    output: { replies_found: "number", hot_replies: "number" },
    kpd_metric: "hot replies detected",
    cost_per_run: 0.05,
    tier: 1,
  },

  // ── LAYER 7: HANDS (Claude CLI code execution) ─────────────────────────
  "cortex-hands": {
    layer: "hands",
    purpose: "Executes real code changes via Claude CLI subprocess - creates pages, rewrites prompts, edits configs",
    script: "scripts/cortex/hands.mjs",
    autonomous: false,
    args_spec: "<task_json_file> — JSON with {description, type, files, context}",
    output: { success: "boolean", filesChanged: "array" },
    kpd_metric: "successful code changes per execution",
    cost_per_run: 0, // Max subscription, no API cost
    tier: 1,
  },
};

// Helper: get bots by tier
export function getBotsByTier(tier) {
  return Object.entries(BOT_REGISTRY)
    .filter(([_, bot]) => bot.tier === tier)
    .map(([name, bot]) => ({ name, ...bot }));
}

// Helper: get bots by layer
export function getBotsByLayer(layer) {
  return Object.entries(BOT_REGISTRY)
    .filter(([_, bot]) => bot.layer === layer)
    .map(([name, bot]) => ({ name, ...bot }));
}

// Helper: format bot list for brain prompt
export function formatBotsForBrain() {
  return Object.entries(BOT_REGISTRY).map(([name, b]) => {
    const mode = b.autonomous ? "AUTONOMOUS (no args)" : `ARGS: ${b.args_spec}`;
    return `- ${name}: ${b.purpose} [${mode}] (~$${b.cost_per_run}/run)`;
  }).join("\n");
}
