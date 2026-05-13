/**
 * scripts/survival/specialist-agents.mjs
 *
 * Specialist personas as actions. Each specialist has:
 *   - persona file (long-form expert priming, frozen md in personas/)
 *   - dispatch function that loads persona + opportunity context +
 *     wiki + lead db, calls Claude with HIGH max_output_tokens to
 *     produce publishable-quality work
 *   - output saved to opportunity workspace under specialists/
 *
 * Substrate's existing actions (deep_research, implementation_plan)
 * still work for broad coverage. Specialists are for going DEEP on
 * one slice — market sizing, marketing strategy, copywriting.
 *
 * Each specialist run costs ~$0.10-0.30 (longer outputs). Budget-guard
 * already enforces $5 CAD/24h cap so substrate cannot blow through.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { think } from "./llm-think.mjs";
import { getOpportunity, listByState, transition } from "./opportunity-store.mjs";
import { buildKnowledgeBlock } from "./wiki-brain.mjs";
import { buildLeadKnowledgeBlock } from "./lead-database.mjs";
import { getIdentityBlock, audienceFitCheck, formatStrategiesForPrompt } from "./operator-identity.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const PERSONAS_DIR = resolve(__dirname, "personas");
const OPP_DIR = resolve(ROOT, ".data/survival-opportunities");

function ensureDir(p) { if (!existsSync(p)) mkdirSync(p, { recursive: true }); }

const SPECIALISTS = {
  market_researcher: {
    persona_file: "market-researcher.md",
    description: "Senior B2B market researcher. Sizes a market, identifies buyers, recommends GO/HOLD/DROP.",
    estimated_cost_usd: 0.20,
    output_filename: "market-research.md",
  },
  marketing_strategist: {
    persona_file: "marketing-strategist.md",
    description: "Senior B2B services marketing strategist. Produces 6-week phased channel strategy.",
    estimated_cost_usd: 0.25,
    output_filename: "marketing-strategy.md",
  },
  copywriter: {
    persona_file: "copywriter.md",
    description: "Senior B2B copywriter. Produces publish-ready outbound + LinkedIn copy.",
    estimated_cost_usd: 0.20,
    output_filename: "copy.md",
  },
  web_strategist: {
    persona_file: "web-strategist.md",
    description: "Senior conversion-focused web strategist. Site/landing improvement brief with concrete copy.",
    estimated_cost_usd: 0.20,
    output_filename: "web-strategy.md",
  },
  telegram_strategist: {
    persona_file: "telegram-strategist.md",
    description: "Senior Telegram-channel strategist. Group discovery, lurking-week plan, DM templates.",
    estimated_cost_usd: 0.20,
    output_filename: "telegram-strategy.md",
  },
  reddit_strategist: {
    persona_file: "reddit-strategist.md",
    description: "Senior Reddit strategist. Subreddit targeting, pain-signal scans, comment templates, karma plan.",
    estimated_cost_usd: 0.20,
    output_filename: "reddit-strategy.md",
  },
  prospecting_specialist: {
    persona_file: "prospecting-specialist.md",
    description: "Senior B2B prospect researcher. Turns opportunity into named prospect list with contact paths.",
    estimated_cost_usd: 0.25,
    output_filename: "prospect-list.md",
  },
  sales_strategist: {
    persona_file: "sales-strategist.md",
    description: "Senior B2B sales strategist. Discovery agenda, proposal template, objection scripts.",
    estimated_cost_usd: 0.20,
    output_filename: "sales-plan.md",
  },
  pricing_strategist: {
    persona_file: "pricing-strategist.md",
    description: "Senior productized-services pricing strategist. Anchor analysis, package contents, upsells.",
    estimated_cost_usd: 0.18,
    output_filename: "pricing.md",
  },
  partnership_strategist: {
    persona_file: "partnership-strategist.md",
    description: "Senior partnership strategist. Partner archetypes, named candidates, outreach templates, mechanics.",
    estimated_cost_usd: 0.22,
    output_filename: "partnerships.md",
  },
};

export function listSpecialists() {
  return Object.entries(SPECIALISTS).map(([id, s]) => ({ id, ...s }));
}

export function loadPersona(specialist_id) {
  const spec = SPECIALISTS[specialist_id];
  if (!spec) throw new Error(`unknown specialist: ${specialist_id}`);
  return readFileSync(resolve(PERSONAS_DIR, spec.persona_file), "utf-8");
}

/**
 * Dispatch a task to a specialist. Returns { ok, output_file, llm_cost_usd }.
 * Caller provides specialist_id + opportunity_id + task description.
 */
export async function dispatchToSpecialist({ specialist_id, opportunity_id, task, strategy_id }) {
  const spec = SPECIALISTS[specialist_id];
  if (!spec) return { ok: false, reason: "unknown_specialist", specialist_id };
  const opp = getOpportunity(opportunity_id);
  if (!opp) return { ok: false, reason: "opportunity_not_found", opportunity_id };

  const persona = loadPersona(specialist_id);
  const identity = getIdentityBlock();
  const fit = audienceFitCheck({ title: opp.title, seed_text: opp.seed_text || "", source: opp.source || "" });
  const wiki = buildKnowledgeBlock(opp.title + " " + (task || ""), { limit: 3 });
  const leads = buildLeadKnowledgeBlock(opp.title, { limit: 3 });

  // Include research.md if available
  let researchExcerpt = "";
  if (opp.research_path && existsSync(opp.research_path)) {
    researchExcerpt = `\n\n## EXISTING RESEARCH ON THIS OPPORTUNITY\n${readFileSync(opp.research_path, "utf-8").slice(0, 6000)}`;
  }

  const prompt = `${persona}

## OPERATOR IDENTITY (HARD CONSTRAINT)
${identity}

## AUDIENCE STRATEGY FOR THIS OPPORTUNITY
${formatStrategiesForPrompt(fit)}

## OPPORTUNITY UNDER STUDY
title: ${opp.title}
source: ${opp.source}
seed_text: ${opp.seed_text || "(none)"}
${researchExcerpt}

## PRIOR KNOWLEDGE (your wiki)
${wiki}

## LEAD DATABASE GROUNDING
${leads}

## TASK FROM SUBSTRATE
${task || "Apply your specialist persona's full output specification to this opportunity."}

Produce ONLY the structured output specified in your persona. No preamble.`;

  const result = await think({
    prompt,
    model: "claude-sonnet-4-6",
    caller: `specialist:${specialist_id}`,
    strategy_id,
    max_input_tokens: 12_000,
    max_output_tokens: 4000,
  });
  if (!result.ok) return { ok: false, reason: result.reason, error: result.error };

  // Save output to opportunity workspace under specialists/<id>/
  const specDir = resolve(OPP_DIR, opp.id, "specialists", specialist_id);
  ensureDir(specDir);
  const out = resolve(specDir, spec.output_filename);
  const header = `# ${specialist_id.toUpperCase()} output\n\nopportunity_id: ${opp.id}\nopportunity_title: ${opp.title}\ngenerated_at: ${new Date().toISOString()}\nstrategy_id: ${strategy_id || "manual"}\nllm_cost_usd: ${result.cost_usd.toFixed(4)}\nspecialist: ${specialist_id}\ntask: ${task || "(default)"}\n\n---\n\n`;
  writeFileSync(out, header + result.output);

  return {
    ok: true,
    specialist_id,
    opportunity_id: opp.id,
    output_file: out,
    llm_cost_usd: result.cost_usd,
  };
}

// --- Action wrappers for action-catalog ---

export const dispatchSpecialistMeta = {
  description: "Dispatch one slice of work on the most-recent in_progress opportunity to a specialist agent (market_researcher, marketing_strategist, or copywriter).",
  side_effect_class: "auto",
  expected_signal: "specialist_output_written",
  expected_signal_delay_min: 0,
  estimated_cost_usd: 0.25,
};

export async function runDispatchSpecialist({ strategy }) {
  const params = strategy.parameters_json ? JSON.parse(strategy.parameters_json) : {};
  // Pick opportunity: explicit id from params, else most recent in_progress
  let opp;
  if (params.opportunity_id) {
    opp = getOpportunity(params.opportunity_id);
  } else {
    const candidates = listByState("in_progress").concat(listByState("researched"));
    opp = candidates[candidates.length - 1];
  }
  if (!opp) return { ok: false, reason: "no_eligible_opportunity" };

  // Pick specialist: explicit, else round-robin based on what already exists
  // for this opportunity
  let specialist_id = params.specialist_id;
  if (!specialist_id) {
    const specDir = resolve(OPP_DIR, opp.id, "specialists");
    const existing = existsSync(specDir) ? readdirSync(specDir) : [];
    // Round-robin through ALL registered specialists. The order matters:
    // research first, then strategy, then channels, then execution.
    const order = [
      "market_researcher",
      "marketing_strategist",
      "prospecting_specialist",
      "pricing_strategist",
      "copywriter",
      "web_strategist",
      "telegram_strategist",
      "reddit_strategist",
      "partnership_strategist",
      "sales_strategist",
    ];
    specialist_id = order.find(s => !existing.includes(s)) || "marketing_strategist";
  }

  const task = params.task || null;
  return dispatchToSpecialist({
    specialist_id,
    opportunity_id: opp.id,
    task,
    strategy_id: strategy.id,
  });
}
