/**
 * scripts/survival/action-catalog.mjs
 *
 * The seven actions defined in contract.md, as runnable adapters.
 * Each adapter has metadata (cost class, side-effect class, expected signal,
 * deadline) and a `run({ strategy, deps })` function that performs the
 * action and returns an attempt record.
 *
 * IMPORTANT: NO action in this catalog has authority to send anything outbound.
 * The only side effects allowed at this layer are local file writes and HTTP
 * GET requests to public URLs. Any draft for outbound channel is written to
 * `.data/survival-drafts/` and goes to approval-queue, which Kirill reviews.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { think } from "./llm-think.mjs";
import {
  deepResearchActionMeta, runDeepResearch,
  planActionMeta, runImplementationPlan,
  wishlistProcessorMeta, runWishlistProcessor,
  ingestResearchMeta, runIngestOrganismResearch,
} from "./opportunity-actions.mjs";
import { fundingHunterMeta, runFundingHunter } from "./funding-hunter.mjs";
import { buildKnowledgeBlock, listAllWikiTitles } from "./wiki-brain.mjs";
import { buildLeadKnowledgeBlock } from "./lead-database.mjs";
import { proposeOutboundMeta, runProposeOutboundSend } from "./outbound-approval.mjs";
import { getIdentityBlock, audienceFitCheck, formatStrategiesForPrompt } from "./operator-identity.mjs";
import { dispatchSpecialistMeta, runDispatchSpecialist } from "./specialist-agents.mjs";
import { telegramListenerMeta, runTelegramListener } from "./telegram-listener.mjs";
import { siteAuditLiveMeta, runSiteAuditLive, siteContentGenerateMeta, runSiteContentGenerate } from "./site-content-generator.mjs";
import { channelMatchMeta, runChannelMatch } from "./channel-registry.mjs";
import { factoryStatusMeta, runFactoryStatus, factoryOutputIngestMeta, runFactoryOutputIngest } from "./factory-bridge.mjs";
import { dispatchToFactoryMeta, runDispatchToFactory, pollFactoryResultsMeta, runPollFactoryResults } from "./factory-dispatcher.mjs";
import { cortexBusListenerMeta, runCortexBusListener } from "./cortex-bus-listener.mjs";
import { internalFeedbackMeta, runInternalFeedback } from "./internal-feedback.mjs";
import { memoryConsolidationMeta, runMemoryConsolidation } from "./memory-consolidation.mjs";
import { telegramCallbackPollerMeta, runTelegramCallbackPoller } from "./telegram-callback-poller.mjs";
import { inboxMonitorMeta, runInboxMonitor } from "./inbox-monitor.mjs";
import { lettaSleepBridgeMeta, runLettaSleepBridge } from "./letta-bridge.mjs";
import { promptOptimizerMeta, runPromptOptimizer } from "./prompt-optimizer.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DRAFTS_DIR = resolve(ROOT, ".data/survival-drafts");
const OBSERVATIONS_DIR = resolve(ROOT, ".data/survival-observations");
const WISHLIST_PATH = resolve(ROOT, ".data/survival-wishlist.md");

function ensureDir(p) { if (!existsSync(p)) mkdirSync(p, { recursive: true }); }

async function fetchPublicUrl(url, max_bytes = 200_000) {
  const res = await fetch(url, { headers: { "User-Agent": "substrate-survival/0.1" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const text = await res.text();
  return text.slice(0, max_bytes);
}

const CATALOG = {
  web_research: {
    description: "Fetch a public URL, summarize key info, store as observation.",
    side_effect_class: "auto",
    expected_signal: "knowledge_added_to_observations",
    expected_signal_delay_min: 0,
    estimated_cost_usd: 0.02,
    async run({ strategy, deps }) {
      const url = strategy.parameters_json
        ? JSON.parse(strategy.parameters_json).url
        : null;
      if (!url) return { ok: false, reason: "missing_url_in_strategy_params" };
      ensureDir(OBSERVATIONS_DIR);
      const out = resolve(OBSERVATIONS_DIR, `web-${Date.now()}.json`);
      try {
        const text = await fetchPublicUrl(url);
        writeFileSync(out, JSON.stringify({
          ts: new Date().toISOString(),
          url,
          strategy_id: strategy.id,
          excerpt: text.slice(0, 5000),
        }, null, 2));
        return { ok: true, output_file: out, bytes: text.length };
      } catch (e) {
        return { ok: false, reason: "fetch_failed", error: e.message };
      }
    },
  },

  site_audit: {
    description: "Read kirill's site files, propose improvements to a draft file.",
    side_effect_class: "auto",
    expected_signal: "site_audit_draft_written",
    expected_signal_delay_min: 0,
    estimated_cost_usd: 0.05,
    async run({ strategy, deps }) {
      // Stub for now: lists the index.html files in the dashboard / site
      ensureDir(DRAFTS_DIR);
      const out = resolve(DRAFTS_DIR, `site-audit-${Date.now()}.md`);
      const dashboardHtml = resolve(ROOT, "dashboard/index.html");
      let summary = "Site audit (stub)\n\n";
      if (existsSync(dashboardHtml)) {
        const html = readFileSync(dashboardHtml, "utf-8");
        summary += `dashboard/index.html: ${html.length} chars, contains <title>: ${html.includes("<title>")}\n`;
      } else {
        summary += "dashboard/index.html not found\n";
      }
      summary += `\nProposed improvements to be filled by LLM in next iteration.\n`;
      writeFileSync(out, summary);
      return { ok: true, output_file: out };
    },
  },

  seo_learning: {
    description: "Fetch SEO-related public articles, extract patterns, store in observations.",
    side_effect_class: "auto",
    expected_signal: "seo_patterns_extracted",
    expected_signal_delay_min: 0,
    estimated_cost_usd: 0.05,
    async run({ strategy, deps }) {
      ensureDir(OBSERVATIONS_DIR);
      const params = strategy.parameters_json ? JSON.parse(strategy.parameters_json) : {};
      const url = params.url || "https://moz.com/learn/seo";
      const out = resolve(OBSERVATIONS_DIR, `seo-${Date.now()}.json`);
      try {
        const text = await fetchPublicUrl(url);
        writeFileSync(out, JSON.stringify({
          ts: new Date().toISOString(),
          url,
          strategy_id: strategy.id,
          excerpt: text.slice(0, 3000),
        }, null, 2));
        return { ok: true, output_file: out };
      } catch (e) {
        return { ok: false, reason: "fetch_failed", error: e.message };
      }
    },
  },

  draft_writing: {
    description: "Write a draft (email/post/comment) to file via Claude. Send requires approval-queue.",
    side_effect_class: "auto_local_only",
    expected_signal: "draft_written_then_human_approval_needed",
    expected_signal_delay_min: 60,
    estimated_cost_usd: 0.10,
    async run({ strategy, deps }) {
      ensureDir(DRAFTS_DIR);
      const params = strategy.parameters_json ? JSON.parse(strategy.parameters_json) : {};
      const channel = params.channel || "comment";
      const target = params.target || "(unspecified target)";
      const goal = params.goal || "introduce kirill's AI workflow services";
      const tone = params.tone || "direct, no hype, no em dashes";
      const wikiKnowledge = buildKnowledgeBlock(`${target} ${goal} ${channel}`, { limit: 2 });
      const leadKnowledge = buildLeadKnowledgeBlock(`${target} ${goal}`, { limit: 3 });
      const identity = getIdentityBlock();
      const fit = audienceFitCheck({ title: target, seed_text: goal });
      const prompt = `You are writing a SHORT draft (max 80 words) on behalf of Kirill.

OPERATOR IDENTITY (HARD CONSTRAINT — do not violate):
${identity}

AUDIENCE STRATEGY (pick the right channel/voice for this audience):
${formatStrategiesForPrompt(fit)}

If fit_level is "foreign", the draft must use one of the engagement_strategies (referral, asset-first, cross-border, community participation) — do NOT write a direct DM to that foreign audience pretending operator has presence there.

Channel: ${channel}
Target: ${target}
Goal: ${goal}
Tone: ${tone}

PRIOR KNOWLEDGE FROM YOUR OWN WIKI (apply patterns from past content):
${wikiKnowledge}

LEAD DATABASE GROUNDING (real prior outreach + replies — base your tone on what actually got responses):
${leadKnowledge}

Output ONLY the draft body. No preamble, no labels, no quotes, no em dashes. Plain text. The voice MUST be appropriate to operator's actual audience and credibility zone.`;
      const result = await think({
        prompt, caller: "action:draft_writing", strategy_id: strategy.id,
        max_input_tokens: 500, max_output_tokens: 300,
      });
      if (!result.ok) return { ok: false, reason: result.reason, error: result.error };
      const out = resolve(DRAFTS_DIR, `${channel}-${Date.now()}.md`);
      writeFileSync(out, `# Draft (channel: ${channel})\nstrategy_id: ${strategy.id}\nstatus: pending_kirill_approval\ngenerated_at: ${new Date().toISOString()}\nllm_cost_usd: ${result.cost_usd.toFixed(4)}\n\n${result.output}\n`);
      return { ok: true, output_file: out, requires_approval: true, llm_cost_usd: result.cost_usd };
    },
  },

  growth_articulation: {
    description: "System reflects on its constraints and writes 'I want X because Y' to wishlist via Claude.",
    side_effect_class: "auto",
    expected_signal: "wishlist_entry_added_for_kirill_review",
    expected_signal_delay_min: 0,
    estimated_cost_usd: 0.04,
    async run({ strategy, deps }) {
      const params = strategy.parameters_json ? JSON.parse(strategy.parameters_json) : {};
      const seed_want = params.want || "(let substrate decide)";
      const seed_why = params.why || "(let substrate justify)";
      const wikiKnowledge = buildKnowledgeBlock("growth capability scaling AI consulting revenue", { limit: 2 });
      const identity = getIdentityBlock();
      const prompt = `You are substrate. You exist as an autonomous loop with a 5 CAD/24h LLM budget and a read-only wallet that holds your survival money. You read the world but cannot send anything outbound without operator approval.

OPERATOR IDENTITY (HARD CONSTRAINT — your wants must serve the operator's actual market and credibility zone):
${identity}

PRIOR KNOWLEDGE FROM YOUR OWN WIKI (consider what you already know):
${wikiKnowledge}

Reflect on what would help you grow your capability or earn money for survival in operator's REAL market. Pick ONE concrete want.

Output ONLY this JSON:
{"want":"<one specific thing>","why":"<one sentence>","estimated_cost_usd":<number>,"how_i_will_earn_it":"<one concrete plan, max 30 words>"}

Seed (you may use or override):
want: ${seed_want}
why: ${seed_why}`;
      const result = await think({
        prompt, caller: "action:growth_articulation", strategy_id: strategy.id,
        max_input_tokens: 600, max_output_tokens: 250,
      });
      if (!result.ok) return { ok: false, reason: result.reason, error: result.error };

      let parsed;
      try {
        const m = result.output.match(/\{[\s\S]*\}/);
        parsed = m ? JSON.parse(m[0]) : { want: result.output.slice(0, 200), why: "(parse_failed)", estimated_cost_usd: 0, how_i_will_earn_it: "(parse_failed)" };
      } catch {
        parsed = { want: result.output.slice(0, 200), why: "(parse_failed)", estimated_cost_usd: 0, how_i_will_earn_it: "(parse_failed)" };
      }

      const ts = new Date().toISOString();
      const entry = `\n---\n## ${ts}\n**Want:** ${parsed.want}\n**Why:** ${parsed.why}\n**Estimated cost USD:** ${parsed.estimated_cost_usd}\n**How I will earn it:** ${parsed.how_i_will_earn_it}\n**Strategy id:** ${strategy.id}\n**LLM cost:** $${result.cost_usd.toFixed(4)}\n`;
      ensureDir(dirname(WISHLIST_PATH));
      appendFileSync(WISHLIST_PATH, entry);
      return { ok: true, output_file: WISHLIST_PATH, parsed, llm_cost_usd: result.cost_usd };
    },
  },

  competitor_analysis: {
    description: "Fetch competitor public page, extract observable patterns.",
    side_effect_class: "auto",
    expected_signal: "competitor_observation_added",
    expected_signal_delay_min: 0,
    estimated_cost_usd: 0.04,
    async run({ strategy, deps }) {
      const params = strategy.parameters_json ? JSON.parse(strategy.parameters_json) : {};
      const url = params.url;
      if (!url) return { ok: false, reason: "missing_url" };
      ensureDir(OBSERVATIONS_DIR);
      const out = resolve(OBSERVATIONS_DIR, `competitor-${Date.now()}.json`);
      try {
        const text = await fetchPublicUrl(url);
        writeFileSync(out, JSON.stringify({
          ts: new Date().toISOString(),
          competitor_url: url,
          strategy_id: strategy.id,
          excerpt: text.slice(0, 4000),
        }, null, 2));
        return { ok: true, output_file: out };
      } catch (e) {
        return { ok: false, reason: "fetch_failed", error: e.message };
      }
    },
  },

  opportunity_deep_research: { ...deepResearchActionMeta, run: runDeepResearch },
  opportunity_implementation_plan: { ...planActionMeta, run: runImplementationPlan },
  wishlist_processor: { ...wishlistProcessorMeta, run: runWishlistProcessor },
  ingest_organism_research: { ...ingestResearchMeta, run: runIngestOrganismResearch },
  funding_opportunity_hunter: { ...fundingHunterMeta, run: runFundingHunter },
  propose_outbound_send: { ...proposeOutboundMeta, run: runProposeOutboundSend },
  dispatch_to_specialist: { ...dispatchSpecialistMeta, run: runDispatchSpecialist },
  telegram_listener: { ...telegramListenerMeta, run: runTelegramListener },
  site_audit_live: { ...siteAuditLiveMeta, run: runSiteAuditLive },
  site_content_generate: { ...siteContentGenerateMeta, run: runSiteContentGenerate },
  channel_match: { ...channelMatchMeta, run: runChannelMatch },
  factory_status: { ...factoryStatusMeta, run: runFactoryStatus },
  factory_output_ingest: { ...factoryOutputIngestMeta, run: runFactoryOutputIngest },
  dispatch_to_factory: { ...dispatchToFactoryMeta, run: runDispatchToFactory },
  poll_factory_results: { ...pollFactoryResultsMeta, run: runPollFactoryResults },
  cortex_bus_listener: { ...cortexBusListenerMeta, run: runCortexBusListener },
  internal_feedback: { ...internalFeedbackMeta, run: runInternalFeedback },
  memory_consolidation: { ...memoryConsolidationMeta, run: runMemoryConsolidation },
  telegram_callback_poller: { ...telegramCallbackPollerMeta, run: runTelegramCallbackPoller },
  inbox_monitor: { ...inboxMonitorMeta, run: runInboxMonitor },
  letta_sleep_bridge: { ...lettaSleepBridgeMeta, run: runLettaSleepBridge },
  prompt_optimizer: { ...promptOptimizerMeta, run: runPromptOptimizer },

  pattern_extraction: {
    description: "Read own past experiment_log, extract what worked and what didn't.",
    side_effect_class: "auto",
    expected_signal: "patterns_summary_written",
    expected_signal_delay_min: 0,
    estimated_cost_usd: 0.03,
    async run({ strategy, deps }) {
      const logPath = resolve(ROOT, ".data/survival-experiment-log.jsonl");
      ensureDir(OBSERVATIONS_DIR);
      const out = resolve(OBSERVATIONS_DIR, `patterns-${Date.now()}.json`);
      let summary = { ts: new Date().toISOString(), total_attempts: 0, by_action: {} };
      if (existsSync(logPath)) {
        const lines = readFileSync(logPath, "utf-8").split("\n").filter(Boolean);
        summary.total_attempts = lines.length;
        for (const l of lines) {
          try {
            const r = JSON.parse(l);
            const a = r.action_id || "unknown";
            summary.by_action[a] = (summary.by_action[a] || 0) + 1;
          } catch {}
        }
      }
      writeFileSync(out, JSON.stringify(summary, null, 2));
      return { ok: true, output_file: out, summary };
    },
  },
};

export function listActions() {
  return Object.entries(CATALOG).map(([id, meta]) => ({
    action_id: id,
    description: meta.description,
    side_effect_class: meta.side_effect_class,
    estimated_cost_usd: meta.estimated_cost_usd,
    expected_signal: meta.expected_signal,
  }));
}

export async function runAction(action_id, { strategy, deps }) {
  const adapter = CATALOG[action_id];
  if (!adapter) throw new Error(`[action-catalog] unknown action_id: ${action_id}`);
  return adapter.run({ strategy, deps });
}

/**
 * runActionWithAlgorithm — wraps runAction in the 7-phase Algorithm so every
 * substrate action gets explicit OBSERVE → EXECUTE → VERIFY discipline.
 *
 * Quick tier (default for production): runs OBSERVE → EXECUTE → VERIFY only
 * (3 phases) — adds ~50ms overhead, gains traceability + verification gate.
 *
 * Returns the same shape runAction returns when status==="complete";
 * otherwise returns { ok: false, reason: "algorithm_halted", ...details }.
 */
export async function runActionWithAlgorithm(action_id, { strategy, deps, tier = "quick" } = {}) {
  const { runAlgorithm, makeVerifyHandler } = await import("../cortex/algorithm.mjs");
  let actionResult = null;
  let actionError = null;

  const result = await runAlgorithm({
    task: `runAction(${action_id})`,
    tier,
    handlers: {
      observe: async (ctx) => ({
        intent: `dispatch action ${action_id}`,
        action_id,
        strategy_id: strategy?.id,
        params: strategy?.parameters,
      }),
      execute: async (ctx) => {
        try {
          actionResult = await runAction(action_id, { strategy, deps });
          return { ok: true, evidence: { action_id, result_keys: Object.keys(actionResult || {}) } };
        } catch (e) {
          actionError = e;
          return { ok: false, reason: "action_threw", error: e.message };
        }
      },
      verify: makeVerifyHandler([
        async () => ({ ok: actionError === null && actionResult !== null, name: "action_completed", evidence: actionResult ? "result_obj_returned" : "null" }),
      ]),
    },
  });

  if (result.status === "complete") {
    return actionResult;
  }
  return {
    ok: false,
    reason: "algorithm_halted",
    status: result.status,
    runId: result.runId,
    phasesRun: result.phasesRun,
    action_id,
    error: actionError?.message,
  };
}

export function getActionMetadata(action_id) {
  return CATALOG[action_id] || null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(listActions(), null, 2));
}
