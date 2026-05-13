/**
 * scripts/survival/opportunity-actions.mjs
 *
 * Three actions for opportunity lifecycle. Each is registered into
 * action-catalog and selectable by the experiment-runner like any
 * other strategy.
 *
 *   opportunity_deep_research(opportunity_id)
 *     reads the opportunity seed + organism research notes if relevant,
 *     calls Claude for full structured research, writes research.md,
 *     transitions detected -> researched.
 *
 *   opportunity_implementation_plan(opportunity_id)
 *     reads research.md, calls Claude for full implementation plan
 *     (LinkedIn drafts, outreach drafts, application checklist),
 *     writes plan.md, creates sub-strategies in policy_registry,
 *     transitions researched -> in_progress.
 *
 *   wishlist_processor()
 *     reads .data/survival-wishlist.md for entries with [approved] marker,
 *     converts each into an opportunity record (state=detected) so the
 *     deep-research action can pick it up next tick.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

import { think } from "./llm-think.mjs";
import {
  createOpportunity, listByState, getOpportunity, transition,
} from "./opportunity-store.mjs";
import { registerStrategy } from "./policy-registry.mjs";
import { buildKnowledgeBlock } from "./wiki-brain.mjs";
import { buildLeadKnowledgeBlock } from "./lead-database.mjs";
import { getIdentityBlock, audienceFitCheck, formatStrategiesForPrompt } from "./operator-identity.mjs";
import { getRegistryBlock, recommendChannelsForMarket } from "./channel-registry.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const OPP_DIR = resolve(ROOT, ".data/survival-opportunities");
const WISHLIST = resolve(ROOT, ".data/survival-wishlist.md");
const INTEL = resolve(ROOT, ".data/INTEL.md");

function ensureDir(p) { if (!existsSync(p)) mkdirSync(p, { recursive: true }); }
function oppDir(id) { const d = resolve(OPP_DIR, id); ensureDir(d); return d; }

function readIntelExcerpt(maxChars = 4000) {
  if (!existsSync(INTEL)) return null;
  return readFileSync(INTEL, "utf-8").slice(0, maxChars);
}

// --------------------------------------------------------------------------
// ACTION: opportunity_deep_research
// --------------------------------------------------------------------------

export const deepResearchActionMeta = {
  description: "Deep-research one detected opportunity via Claude. Produces structured research.md.",
  side_effect_class: "auto",
  expected_signal: "research_md_written",
  expected_signal_delay_min: 0,
  estimated_cost_usd: 0.30,
};

export async function runDeepResearch({ strategy }) {
  // Pick first opportunity in state=detected, OR a specific id from strategy params.
  const params = strategy.parameters_json ? JSON.parse(strategy.parameters_json) : {};
  let opp;
  if (params.opportunity_id) {
    opp = getOpportunity(params.opportunity_id);
  } else {
    const queue = listByState("detected");
    opp = queue[0];
  }
  if (!opp) return { ok: false, reason: "no_detected_opportunity" };

  transition(opp.id, "researching");
  const intel = readIntelExcerpt();
  const wikiKnowledge = buildKnowledgeBlock(opp.title + " " + (opp.seed_text || ""), { limit: 3 });

  const prompt = `You are substrate, doing deep research on an opportunity. Output a STRUCTURED markdown document.

OPPORTUNITY TITLE: ${opp.title}

SEED CONTEXT (from initial detection):
${opp.seed_text || "(none)"}

PRIOR KNOWLEDGE FROM YOUR OWN WIKI:
${wikiKnowledge}

INTERNAL INTEL EXCERPT (for grounding, may be partially relevant):
${intel ? intel.slice(0, 2500) : "(no INTEL.md present)"}

Produce a markdown document with EXACTLY these sections (use ## headers):

## Summary
One paragraph, what this opportunity actually is in concrete terms.

## Sources of money / value
List every distinct program, channel, fund, partner, or mechanism that delivers value here. For each: name, what they give, dollar range, source URL or reference.

## Eligibility and conditions
Strict conditions. Who qualifies. Who does not.

## Best-fit ICP
Specific business profiles that benefit most. Industries, sizes, revenue bands, geography, stage.

## Application or activation steps
Numbered steps to claim/use the opportunity. From discovery to signed deal/grant/contract.

## Provenance
Where this information came from. URLs if known. Mark anything you are inferring vs anything you have direct evidence for.

## Risks and disqualifiers
What kills the deal. Common pitfalls. Hidden conditions. Things that look like fit but are not.

## Money potential
Realistic dollar value to Kirill personally if he capitalizes on this opportunity over the next 90 days. Show your math.

NO em dashes. Hyphens only. Be specific and grounded. If you don't know something, write "Unknown — needs verification" rather than fabricating.`;

  const result = await think({
    prompt,
    model: "claude-sonnet-4-6",
    caller: "opportunity:deep_research",
    strategy_id: strategy.id,
    max_input_tokens: 4000,
    max_output_tokens: 2500,
  });
  if (!result.ok) {
    transition(opp.id, "detected"); // revert
    return { ok: false, reason: result.reason, error: result.error };
  }

  const out = resolve(oppDir(opp.id), "research.md");
  const header = `# Research: ${opp.title}\n\nopportunity_id: ${opp.id}\nresearched_at: ${new Date().toISOString()}\nstrategy_id: ${strategy.id}\nllm_cost_usd: ${result.cost_usd.toFixed(4)}\nsource: ${opp.source}\n\n`;
  writeFileSync(out, header + result.output);
  transition(opp.id, "researched", { research_path: out });
  return { ok: true, opportunity_id: opp.id, output_file: out, llm_cost_usd: result.cost_usd };
}

// --------------------------------------------------------------------------
// ACTION: opportunity_implementation_plan
// --------------------------------------------------------------------------

export const planActionMeta = {
  description: "Build full implementation plan from research: LinkedIn drafts, outreach drafts, checklist. Creates sub-strategies.",
  side_effect_class: "auto",
  expected_signal: "plan_md_written_and_substrategies_created",
  expected_signal_delay_min: 0,
  estimated_cost_usd: 0.40,
};

export async function runImplementationPlan({ strategy }) {
  const params = strategy.parameters_json ? JSON.parse(strategy.parameters_json) : {};
  let opp;
  if (params.opportunity_id) {
    opp = getOpportunity(params.opportunity_id);
  } else {
    const queue = listByState("researched");
    opp = queue[0];
  }
  if (!opp) return { ok: false, reason: "no_researched_opportunity" };
  if (!opp.research_path || !existsSync(opp.research_path)) {
    return { ok: false, reason: "research_file_missing" };
  }

  transition(opp.id, "planning");
  const research = readFileSync(opp.research_path, "utf-8");
  const wikiKnowledge = buildKnowledgeBlock(opp.title + " outreach LinkedIn", { limit: 3 });
  const leadKnowledge = buildLeadKnowledgeBlock(opp.title, { limit: 3 });
  const identity = getIdentityBlock();
  const fit = audienceFitCheck({ title: opp.title, seed_text: opp.seed_text || "", source: opp.source || "" });

  const channelRegistry = getRegistryBlock();
  const quickChannels = recommendChannelsForMarket(fit.market);

  const prompt = `You are substrate, building a CONCRETE implementation plan for Kirill on an opportunity he wants to capitalize on.

OPERATOR IDENTITY (HARD CONSTRAINT — do not violate):
${identity}

AUDIENCE STRATEGY (operator CAN engage this market — your job is to propose HOW):
${formatStrategiesForPrompt(fit)}

CHANNEL REGISTRY (single source of truth for what channels operator has + which work where):
${channelRegistry}

QUICK CHANNEL HINT for market="${fit.market}": ${quickChannels.join(" | ")}

For EVERY outreach draft / channel mention you produce, you MUST:
- Match channel to the opportunity's geographic market using the registry
- Use ONLY channels marked "Connected" or "Discoverable"
- NEVER propose email outreach (operator declined cost gate)
- For LinkedIn / Telegram / Reddit / X / Threads recommendations: include
  CONCRETE deliverables — specific company names + LinkedIn URLs OR exact
  search queries with filters; specific subreddit names + thread URL
  examples; specific Telegram group @handles or invite-link search queries;
  specific Twitter accounts + hashtags. Operator must be able to act
  immediately without doing their own search.

PRIOR KNOWLEDGE FROM YOUR OWN WIKI (use these patterns when generating drafts):
${wikiKnowledge}

LEAD DATABASE GROUNDING (use this when picking ICPs and tone for outreach drafts):
${leadKnowledge}

You are given the full research below. Produce ONLY a markdown plan with EXACTLY these sections:

## Implementation Plan: ${opp.title}

### LinkedIn post drafts (3 distinct angles)
For each draft, write the FULL post body, ~150-220 words, no em dashes. Each angle should target a different audience or hook style. Label them ANGLE_1, ANGLE_2, ANGLE_3.

### Outreach drafts (5 ICPs)
For each, name the specific ICP segment and write the FULL outreach copy (~80-120 words, plain text, no em dashes, no fake personalization tokens).

### Kirill-personal application checklist
If Kirill himself can claim/apply for any value here (e.g. apply for a grant, register as a vendor, join a registry), give him a numbered checklist with specific URLs/forms/contacts. If not applicable, write "Not applicable — Kirill is not eligible directly".

### Partner outreach drafts (2)
Two short messages targeting people who already serve this ICP and could refer business (e.g. accountants, bookkeepers, business coaches for the SMB grants angle). Plain copy, no em dashes.

### Sub-tasks for substrate
List 5 concrete next-actions substrate should take to advance this opportunity in the next 7 days. Format each as JSON on its own line:
{"task":"<short name>","action_id":"<one of: web_research|draft_writing|competitor_analysis|growth_articulation>","parameters":{...}}

NO em dashes anywhere. NO hype. NO "revolutionary". Be specific and operator-grade.

RESEARCH BASELINE (use this as your evidence):
${research}`;

  const result = await think({
    prompt,
    model: "claude-sonnet-4-6",
    caller: "opportunity:implementation_plan",
    strategy_id: strategy.id,
    max_input_tokens: 6000,
    max_output_tokens: 4000,
  });
  if (!result.ok) {
    transition(opp.id, "researched"); // revert
    return { ok: false, reason: result.reason, error: result.error };
  }

  const out = resolve(oppDir(opp.id), "plan.md");
  const header = `# Implementation Plan: ${opp.title}\n\nopportunity_id: ${opp.id}\nplanned_at: ${new Date().toISOString()}\nstrategy_id: ${strategy.id}\nllm_cost_usd: ${result.cost_usd.toFixed(4)}\n\n`;
  writeFileSync(out, header + result.output);

  // Parse sub-tasks (JSON lines under "Sub-tasks for substrate")
  const subTasks = [];
  const subTasksMatch = result.output.split(/###\s+Sub-tasks for substrate/i)[1] || "";
  for (const line of subTasksMatch.split("\n")) {
    const m = line.match(/\{[\s\S]*\}/);
    if (!m) continue;
    try {
      const obj = JSON.parse(m[0]);
      if (obj.action_id && typeof obj.action_id === "string") subTasks.push(obj);
    } catch {}
  }

  // Register sub-strategies in policy_registry tagged to this opportunity.
  const created = [];
  for (const t of subTasks) {
    const ctx = crypto.createHash("sha256").update(JSON.stringify({ opp: opp.id, t })).digest("hex").slice(0, 12);
    const sid = `opp-${opp.id}-${ctx}`;
    registerStrategy({
      id: sid,
      action_id: t.action_id,
      context_hash: `opportunity:${opp.id}`,
      parameters: { ...t.parameters, _from_opportunity: opp.id, _task_label: t.task },
      parent_strategy_id: strategy.id,
    });
    created.push({ id: sid, action_id: t.action_id, task: t.task });
  }

  transition(opp.id, "in_progress", { plan_path: out });

  return {
    ok: true,
    opportunity_id: opp.id,
    output_file: out,
    sub_strategies_created: created,
    llm_cost_usd: result.cost_usd,
  };
}

// --------------------------------------------------------------------------
// ACTION: wishlist_processor
// --------------------------------------------------------------------------

export const wishlistProcessorMeta = {
  description: "Read .data/survival-wishlist.md for [approved] markers, convert into opportunity records.",
  side_effect_class: "auto",
  expected_signal: "wishlist_entries_promoted_to_opportunities",
  expected_signal_delay_min: 0,
  estimated_cost_usd: 0.01,
};

export async function runWishlistProcessor({ strategy }) {
  if (!existsSync(WISHLIST)) return { ok: true, processed: 0, reason: "no_wishlist" };
  const text = readFileSync(WISHLIST, "utf-8");
  // Parse entries separated by `---`
  const blocks = text.split(/\n---\n/).map(b => b.trim()).filter(Boolean);
  let promoted = 0;
  let updated_text = text;
  const created_ids = [];
  for (const block of blocks) {
    if (!/\[approved\]/i.test(block)) continue;
    if (/\[promoted_to_opportunity:/i.test(block)) continue; // already done
    const want_match = block.match(/\*\*Want:\*\*\s*(.+)/);
    if (!want_match) continue;
    const title = want_match[1].trim().slice(0, 200);
    const id = createOpportunity({
      title,
      source: "wishlist",
      source_provenance: "operator-approved wishlist entry",
      seed_text: block,
      parent_strategy_id: strategy.id,
    });
    created_ids.push(id);
    promoted++;
    // Mark in file so we don't re-process.
    updated_text = updated_text.replace(block, block + `\n\n[promoted_to_opportunity:${id}]`);
  }
  if (promoted > 0) writeFileSync(WISHLIST, updated_text);
  return { ok: true, processed: promoted, opportunity_ids: created_ids };
}

// --------------------------------------------------------------------------
// ACTION: ingest_organism_research
// --------------------------------------------------------------------------

export const ingestResearchMeta = {
  description: "Scan organism research outputs (INTEL.md + wiki-archive) for new opportunities.",
  side_effect_class: "auto",
  expected_signal: "external_research_ingested",
  expected_signal_delay_min: 0,
  estimated_cost_usd: 0.05,
};

export async function runIngestOrganismResearch({ strategy }) {
  // For now: read INTEL.md and propose its top section as a new opportunity
  // tagged for operator approval (state=detected, source=organism_intel).
  // In a future iteration this can scan wiki-archive too.
  if (!existsSync(INTEL)) return { ok: false, reason: "no_intel" };
  const text = readFileSync(INTEL, "utf-8");
  const headerLine = text.split("\n").find(l => l.startsWith("#")) || "Organism research signal";
  const title = headerLine.replace(/^#+\s*/, "").trim().slice(0, 200);
  const seed = text.slice(0, 3000);

  // Avoid duplicates: skip if there's an existing opportunity with same title.
  const existing = listByState("detected").concat(listByState("researching"))
    .concat(listByState("researched")).concat(listByState("in_progress"));
  if (existing.some(o => o.title === title)) {
    return { ok: true, reason: "already_present", title };
  }
  const id = createOpportunity({
    title,
    source: "organism_intel",
    source_provenance: ".data/INTEL.md",
    seed_text: seed,
    parent_strategy_id: strategy.id,
  });
  return { ok: true, opportunity_id: id, title };
}
