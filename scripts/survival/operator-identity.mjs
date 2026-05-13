/**
 * scripts/survival/operator-identity.mjs
 *
 * Loads operator-identity.md and provides:
 *   - getIdentityBlock() — full text for inclusion in LLM prompts
 *   - audienceFitCheck(opportunity) — { fit_level, reframe_suggestion }
 *
 * fit_level:
 *   "primary"   — opportunity is in Canada (or Canadian SMB analog)
 *   "secondary" — opportunity is in US (with caveats)
 *   "research_only" — foreign market; substrate may research but NOT
 *                     generate Kirill-voice outbound for it
 *   "referral_only" — substrate may generate referral-partner drafts,
 *                     not direct-to-foreign-audience drafts
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const IDENTITY_PATH = resolve(__dirname, "operator-identity.md");

let _cached = null;
export function getIdentityBlock() {
  if (_cached !== null) return _cached;
  if (!existsSync(IDENTITY_PATH)) {
    _cached = "(operator identity file missing — substrate cannot ground voice)";
    return _cached;
  }
  _cached = readFileSync(IDENTITY_PATH, "utf-8");
  return _cached;
}

const PRIMARY_KEYWORDS = ["canada", "canadian", "calgary", "alberta", "ontario", "toronto", "vancouver", "british columbia", "quebec", "manitoba", "saskatchewan"];
const SECONDARY_KEYWORDS = ["united states", "us ", "usa", "american", "u.s."];
const FOREIGN_MARKETS = ["australia", "australian", "uk ", "united kingdom", "british", "england", "new zealand", "singapore", "hong kong", "ireland", "south africa"];

/**
 * Returns a STRATEGIST output, never a gate. Online consulting work has
 * no geographic restriction on delivery. fit_level only shapes VOICE and
 * channel mix, not whether to engage.
 *
 * Returned shape:
 *   voice_mode: "local_canadian" | "cross_border_canadian_to_us" |
 *               "remote_canadian_to_foreign" | "geo_agnostic_content"
 *   market: human-readable market name
 *   engagement_strategies: array of channels operator can credibly use
 *   voice_guidance: how to honestly frame operator in this market
 */
export function audienceFitCheck({ title = "", seed_text = "", source = "" }) {
  const blob = `${title} ${seed_text} ${source}`.toLowerCase();
  const isPrimary = PRIMARY_KEYWORDS.some(k => blob.includes(k));
  const isSecondary = SECONDARY_KEYWORDS.some(k => blob.includes(k));
  const foreignMatch = FOREIGN_MARKETS.find(k => blob.includes(k));

  if (isPrimary) {
    return {
      voice_mode: "local_canadian",
      fit_level: "primary",
      market: "Canada",
      voice_guidance: "Speak as a local Calgary/Canadian operator. References to Canadian programs, tax law, SMB patterns are credible. Direct LinkedIn DM/post/comment all work.",
      engagement_strategies: [
        "Direct LinkedIn post in Kirill voice (525 Canadian followers)",
        "LinkedIn DM to Canadian SMB owners from lead db",
        "Comment-first on Canadian SMB owner posts before any DM",
        "Local Calgary partner outreach (accountants, BIA, coaches)",
      ],
      asset_suggestions: [
        "Direct LinkedIn educational post about the program",
        "Calgary/Western Canada SMB-focused outreach drafts",
      ],
    };
  }
  if (isSecondary) {
    return {
      voice_mode: "cross_border_canadian_to_us",
      fit_level: "secondary",
      market: "United States",
      voice_guidance: "Speak as a Canadian who works with US clients. No claim of US local expertise. Cross-border consulting is normal in 2026. US SMBs hire remote consultants every day.",
      engagement_strategies: [
        "LinkedIn post in Kirill voice with explicit Canadian framing (cross-border consulting normal)",
        "X/Twitter thread (geo-agnostic, more US reach than LinkedIn at current scale)",
        "Direct LinkedIn DM to US prospects with honest 'Canadian consultant' framing",
        "Partner outreach to US AI consultants for referrals",
        "Comparative content (US program vs Canadian SR&ED) for both audiences",
      ],
      asset_suggestions: [
        "Comparative content (US vs Canadian programs)",
        "Joint webinar proposal with US partner",
      ],
    };
  }
  if (foreignMatch) {
    const m = foreignMatch.trim();
    const cap = m.charAt(0).toUpperCase() + m.slice(1);
    return {
      voice_mode: "remote_canadian_to_foreign",
      fit_level: "foreign_engageable",
      market: cap,
      voice_guidance: `Speak honestly as a remote Canadian AI consultant working with online businesses worldwide. Do NOT pretend to be a ${cap} local insider on local tax law. DO engage on the value layer (AI implementation, workflow automation) — geography is irrelevant for online delivery. Remote work norm in 2026 makes cross-border consulting credible.`,
      engagement_strategies: [
        `Direct LinkedIn DM to ${cap} prospects with HONEST "remote Canadian consultant" framing — frames foreign location as a feature (online delivery, no travel time)`,
        `LinkedIn post in operator voice noting the ${cap} program as a value the operator can implement for ${cap} businesses (cross-border work normalized)`,
        `X/Twitter thread about the ${cap} program (less geo-bound than LinkedIn, brings ${cap} readers organically)`,
        `Asset-first: deep research report on the ${cap} program as a door-opener gift, shared to ${cap} LinkedIn groups and X`,
        `Partner outreach to ${cap}-based consultants/agencies — they bring local relationships, operator brings AI implementation`,
        `Community participation: join ${cap} founder communities (Slack, Discord, X), contribute value, then natural inbound`,
        `Cross-border content for own audience: "Here is the ${cap} program — if you have ${cap} contacts, here is the angle"`,
      ],
      asset_suggestions: [
        `1-page program summary PDF Kirill can share with anyone with ${cap} contacts`,
        `Outreach drafts to 3 ${cap} consultants offering partnership`,
        `${cap}-targeted LinkedIn post in honest remote-Canadian voice`,
      ],
    };
  }
  return {
    voice_mode: "geo_agnostic_content",
    fit_level: "ambiguous",
    market: "global",
    voice_guidance: "Geography ambiguous (program may apply globally or to multiple markets). Default to operator voice with no geographic claims. Use channels that work cross-market.",
    engagement_strategies: [
      "Operator-voice content with no geo claims",
      "Cross-border content angle (any AI consultant could leverage)",
      "X/Twitter (geo-agnostic) preferred over LinkedIn at current scale",
      "Direct outbound via email or LinkedIn with honest remote framing",
    ],
    asset_suggestions: [
      "Geo-neutral research artifact",
      "Cross-market comparative content",
    ],
  };
}

export function formatStrategiesForPrompt(fit) {
  let s = `voice_mode: ${fit.voice_mode}\nmarket: ${fit.market}\nfit_level: ${fit.fit_level}\n\n`;
  s += `voice_guidance: ${fit.voice_guidance}\n\n`;
  s += `engagement_strategies (use AT LEAST 2 distinct channels in your plan):\n`;
  for (const e of fit.engagement_strategies) s += `- ${e}\n`;
  s += `\nasset_suggestions:\n`;
  for (const a of fit.asset_suggestions) s += `- ${a}\n`;
  return s;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const title = process.argv.slice(2).join(" ") || "Australia: R&D Tax Incentive";
  console.log(JSON.stringify(audienceFitCheck({ title }), null, 2));
}
