/**
 * scripts/survival/channel-registry.mjs
 *
 * Loads channel-registry.md, exposes:
 *   getRegistryBlock() — full text for inclusion in LLM prompts
 *   recommendChannelsForMarket(market) — quick lookup for top 3 channels
 *
 * Plus action `channel_match` which substrate can pick: takes the latest
 * in_progress opportunity, runs Claude with channel-registry as context
 * + opportunity context, returns ranked channel list with concrete
 * deliverables for top 2.
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { think } from "./llm-think.mjs";
import { getOpportunity, listByState } from "./opportunity-store.mjs";
import { getIdentityBlock, audienceFitCheck } from "./operator-identity.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const REGISTRY_PATH = resolve(__dirname, "channel-registry.md");
const OPP_DIR = resolve(ROOT, ".data/survival-opportunities");

let _cached = null;
export function getRegistryBlock() {
  if (_cached !== null) return _cached;
  if (!existsSync(REGISTRY_PATH)) {
    _cached = "(channel-registry.md missing — substrate cannot pick channels)";
    return _cached;
  }
  _cached = readFileSync(REGISTRY_PATH, "utf-8");
  return _cached;
}

// Parse the lookup table for fast non-LLM market->channel suggestion
const MARKET_LOOKUP = {
  canada: ["LinkedIn", "Local Calgary meetups", "Reddit (r/CanadaSmallBusiness, vertical subs)"],
  united_states: ["LinkedIn", "Reddit", "X/Twitter", "YouTube ads"],
  united_kingdom: ["LinkedIn", "YouTube", "X/Twitter"],
  australia: ["LinkedIn", "Partnerships (R&D advisors)", "Local podcasts"],
  eu: ["LinkedIn", "Substack", "X/Twitter"],
  portugal: ["LinkedIn", "Local Slack communities", "Partnerships"],
  russia: ["Telegram (dominant)", "VK (declining)"],
  mena: ["LinkedIn", "Telegram", "WhatsApp Business"],
  india: ["LinkedIn", "WhatsApp", "Telegram"],
  latam: ["WhatsApp Business", "LinkedIn", "Telegram"],
  china: ["WeChat (only)"],
  japan: ["LinkedIn (limited)", "Line", "Local meetups"],
  korea: ["KakaoTalk", "LinkedIn (limited)"],
  hong_kong: ["LinkedIn", "Telegram", "WhatsApp"],
  singapore: ["LinkedIn", "Telegram"],
};

export function recommendChannelsForMarket(market) {
  const key = String(market || "").toLowerCase().trim();
  const norm = key
    .replace(/[\s-]/g, "_")
    .replace("united_states_of_america", "united_states")
    .replace("uk", "united_kingdom")
    .replace("us", "united_states")
    .replace("usa", "united_states");
  return MARKET_LOOKUP[norm] || ["LinkedIn", "X/Twitter", "Substack (research first)"];
}

export const channelMatchMeta = {
  description: "Run channel-matcher LLM call: pick best channels for the most recent in_progress opportunity, with concrete deliverables (URLs, company names, search queries).",
  side_effect_class: "auto",
  expected_signal: "channel_recommendation_written",
  expected_signal_delay_min: 0,
  estimated_cost_usd: 0.20,
};

export async function runChannelMatch({ strategy }) {
  const params = strategy.parameters_json ? JSON.parse(strategy.parameters_json) : {};
  let opp;
  if (params.opportunity_id) {
    opp = getOpportunity(params.opportunity_id);
  } else {
    const candidates = listByState("in_progress").concat(listByState("researched"));
    opp = candidates[candidates.length - 1];
  }
  if (!opp) return { ok: false, reason: "no_eligible_opportunity" };

  const registry = getRegistryBlock();
  const identity = getIdentityBlock();
  const fit = audienceFitCheck({ title: opp.title, seed_text: opp.seed_text || "", source: opp.source || "" });

  const prompt = `You are substrate's channel matcher. Given an opportunity and the operator's channel registry, pick the BEST 3 channels and produce CONCRETE actionable next-step deliverables for the top 2.

## OPERATOR IDENTITY
${identity}

## CHANNEL REGISTRY (full)
${registry}

## OPPORTUNITY
title: ${opp.title}
source: ${opp.source}
seed_text: ${opp.seed_text || "(none)"}
audience_fit: ${fit.fit_level} / market: ${fit.market} / voice_mode: ${fit.voice_mode}

## TASK

1. Identify the EXACT geographic market for this opportunity (one sentence).
2. Identify the buyer persona (1-2 sentences).
3. Pick TOP 3 channels from the registry, ranked. For each: name, why this
   channel for this opportunity, expected reach in that market, cost.
4. For top 2 channels, produce CONCRETE DELIVERABLES Kirill can act on
   immediately. NO "search LinkedIn for X" — instead: actual specific items.

   For LinkedIn: 5-10 named companies (real, verifiable) WITH their LinkedIn
   URL pattern (linkedin.com/company/<slug>). If you cannot name real
   companies confidently, output 3 LinkedIn search URLs with full filter
   parameters that return real targets.

   For Telegram: 3-7 specific group names with @handle if you know them, or
   3 invite-link search queries (e.g. "site:t.me Calgary AI" or
   "@AIAgentsRu") + one approach for joining.

   For Reddit: 3-5 specific subreddit names (r/X format) + 2 specific
   search queries to surface pain-signal threads + 1 example thread URL
   if recent activity is known.

   For Twitter/X: 5 specific accounts to engage (real handles) + 2 hashtags
   that index the audience.

   For Threads: 5 specific accounts + 2 hashtags.

   For YouTube/TikTok: specific channel names of competitors or thought
   leaders + 2 keyword research queries operator can run.

   For WhatsApp/Line/KakaoTalk/WeChat: explain setup pre-requisites + cost
   + 2 concrete activation steps.

   For partnerships: 5 named potential partner organizations with their
   websites + 1-line pitch.

5. Output 1 secondary channel as "watchlist" — worth setting up if first
   experiments show traction.

Output ONLY this markdown structure (no preamble):

# Channel Match: <opportunity title>

## Target market
...

## Buyer persona
...

## Top 3 channels (ranked)

### 1. <Channel name>
- Why for this opportunity: ...
- Expected reach: ...
- Cost: ...

### 2. <Channel name>
- ...

### 3. <Channel name>
- ...

## Concrete deliverables — Channel 1
<actionable URLs / company names / handles / search queries>

## Concrete deliverables — Channel 2
<actionable URLs / company names / handles / search queries>

## Watchlist channel
- Name + why + setup cost + when to consider

## Hard rules check
- Geography matched to channel: yes/no
- 2+ different channels: yes/no
- Email NOT proposed: yes/no
- Cost stated: yes/no

NO em dashes anywhere. Hyphens only.`;

  const result = await think({
    prompt,
    model: "claude-sonnet-4-6",
    caller: "channel_match",
    strategy_id: strategy.id,
    max_input_tokens: 14_000,
    max_output_tokens: 3000,
  });
  if (!result.ok) return { ok: false, reason: result.reason, error: result.error };

  const dir = resolve(OPP_DIR, opp.id, "channels");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const out = resolve(dir, `channel-match-${Date.now()}.md`);
  const header = `# Channel Match for: ${opp.title}\n\nopportunity_id: ${opp.id}\ngenerated_at: ${new Date().toISOString()}\nstrategy_id: ${strategy.id}\nllm_cost_usd: ${result.cost_usd.toFixed(4)}\n\n---\n\n`;
  writeFileSync(out, header + result.output);
  return { ok: true, opportunity_id: opp.id, output_file: out, llm_cost_usd: result.cost_usd };
}
