/**
 * scripts/survival/funding-hunter.mjs
 *
 * Hunter for "money already flowing" opportunities. Scans a curated list
 * of public URLs across priority markets and feeds discoveries into the
 * opportunity pipeline.
 *
 * Pattern (per Kirill's insight from CDAP/LIFT discovery):
 *   It is more effective to find where money is ALREADY allocated by a
 *   third party (governments, regulators, insurers, VCs, RFPs) and
 *   position client + Kirill as the implementation vehicle, than to
 *   convince a client to allocate new budget.
 *
 * Source taxonomy (each tick scans ONE URL chosen weighted-random):
 *   - government_grants (programs, application portals, news of launches)
 *   - tax_credits (R&D programs, eligibility databases)
 *   - compliance_mandates (regulatory pages causing forced spending)
 *   - insurance_reimbursements (digital adoption / cyber rebates)
 *   - vc_announcements (fund deployments to specific themes)
 *   - government_rfps (published budgeted tenders)
 *
 * Output: each scan produces structured Claude analysis of the URL,
 * extracted programs become new opportunity records (state=detected) so
 * the existing opportunity_deep_research action picks them up next tick.
 */

import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

import { think } from "./llm-think.mjs";
import { createOpportunity, listAll } from "./opportunity-store.mjs";
import { audienceFitCheck } from "./operator-identity.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const SCAN_LOG_DIR = resolve(ROOT, ".data/survival-funding-scans");

function ensureDir(p) { if (!existsSync(p)) mkdirSync(p, { recursive: true }); }

// Seed sources, prioritized by Kirill's market verdict (Canada > Australia > HK)
// + Portugal/EU expansion track. Add/remove with manual edits.
const SOURCES = [
  // Canada
  { id: "ca-bdc-news", country: "Canada", category: "government_loans", url: "https://www.bdc.ca/en/about/mediaroom/news-releases" },
  { id: "ca-nrc-irap", country: "Canada", category: "government_grants", url: "https://nrc.canada.ca/en/support-technology-innovation" },
  { id: "ca-innovation-fund-db", country: "Canada", category: "government_grants", url: "https://innovation.ised-isde.canada.ca/innovation/s/list-liste?token=&language=en_CA" },
  // Australia
  { id: "au-business-grants", country: "Australia", category: "government_grants", url: "https://business.gov.au/grants-and-programs" },
  { id: "au-rd-tax", country: "Australia", category: "tax_credits", url: "https://business.gov.au/grants-and-programs/research-and-development-tax-incentive" },
  // Hong Kong
  { id: "hk-bud", country: "Hong Kong", category: "government_grants", url: "https://www.bud.hkpc.org/en/" },
  { id: "hk-itf", country: "Hong Kong", category: "government_grants", url: "https://www.itf.gov.hk/en/funding-schemes/index.html" },
  // EU
  { id: "eu-horizon", country: "EU", category: "government_grants", url: "https://commission.europa.eu/funding-tenders/find-funding/eu-funding-programmes/horizon-europe_en" },
  { id: "pt-iapmei", country: "Portugal", category: "government_grants", url: "https://www.iapmei.pt/Paginas/SI-Inovacao-Empresarial.aspx" },
  // US (broader market for benchmark)
  { id: "us-sbir", country: "United States", category: "government_grants", url: "https://www.sbir.gov/" },
];

function pickSource(rng = Math.random) {
  // Weight by recency: sources that haven't been scanned recently get higher weight.
  // For v1, simple uniform.
  return SOURCES[Math.floor(rng() * SOURCES.length)];
}

export const fundingHunterMeta = {
  description: "Scan one funding-flow source URL (gov grants, tax credits, mandates, RFPs) for new opportunities.",
  side_effect_class: "auto",
  expected_signal: "new_opportunities_detected",
  expected_signal_delay_min: 0,
  estimated_cost_usd: 0.15,
};

export async function runFundingHunter({ strategy }) {
  const params = strategy.parameters_json ? JSON.parse(strategy.parameters_json) : {};
  const source = params.source_id
    ? SOURCES.find(s => s.id === params.source_id)
    : pickSource();
  if (!source) return { ok: false, reason: "no_source_available" };

  // Fetch the page (best effort; some gov sites block).
  let html;
  try {
    const res = await fetch(source.url, { headers: { "User-Agent": "substrate-survival/0.1 (research bot for SMB grant discovery)" } });
    if (!res.ok) return { ok: false, reason: `http_${res.status}_on_${source.id}` };
    html = (await res.text()).slice(0, 80_000);
  } catch (e) {
    return { ok: false, reason: "fetch_failed", error: e.message };
  }

  // Strip markup heavily so we send Claude readable text, not noise.
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 25_000);

  // Existing opportunity titles (avoid Claude proposing dupes).
  const existing = listAll().map(o => o.title);
  const existingSummary = existing.length > 0
    ? `Existing opportunities (do NOT propose duplicates of these titles):\n${existing.slice(0, 30).map(t => `- ${t}`).join("\n")}`
    : "Existing opportunities: (none yet)";

  const prompt = `You are substrate scanning a funding-flow source. Extract any concrete programs / grants / loans / tax credits / mandates / RFPs that are CURRENTLY ACTIVE and could plausibly fund AI workflow automation work for SMBs.

SOURCE COUNTRY: ${source.country}
SOURCE CATEGORY: ${source.category}
SOURCE URL: ${source.url}

${existingSummary}

PAGE CONTENT (cleaned excerpt):
${cleaned}

Output ONLY a JSON array. Each entry is one DISCRETE opportunity:
[
  {
    "title": "<short title, country-prefixed, e.g. 'Australia: R&D Tax Incentive'>",
    "is_active_now": true|false,
    "summary": "<2-3 sentences, what it gives, eligibility, how it could fund AI workflow work for SMBs>",
    "estimated_value_to_smb_usd_range": "<low-high>",
    "evidence_snippet": "<short verbatim quote from the page proving it exists>"
  }
]

Rules:
- Only include opportunities you can show evidence for in the page content.
- Skip opportunities clearly closed/expired.
- Skip duplicates of existing titles above.
- If page has nothing relevant, output [].
- NO em dashes. JSON only, no preamble.`;

  const result = await think({
    prompt,
    model: "claude-sonnet-4-6",
    caller: "funding_hunter",
    strategy_id: strategy.id,
    max_input_tokens: 8000,
    max_output_tokens: 1500,
  });
  if (!result.ok) return { ok: false, reason: result.reason, error: result.error };

  // Parse JSON array.
  let candidates = [];
  try {
    const m = result.output.match(/\[[\s\S]*\]/);
    candidates = m ? JSON.parse(m[0]) : [];
  } catch {
    candidates = [];
  }

  // Persist scan log for audit.
  ensureDir(SCAN_LOG_DIR);
  const logFile = resolve(SCAN_LOG_DIR, `scan-${source.id}-${Date.now()}.json`);
  writeFileSync(logFile, JSON.stringify({
    ts: new Date().toISOString(),
    source,
    raw_output: result.output.slice(0, 5000),
    parsed_candidates: candidates,
    llm_cost_usd: result.cost_usd,
    strategy_id: strategy.id,
  }, null, 2));

  // Promote each active, novel candidate into the opportunity store.
  const created = [];
  const existingTitlesLower = new Set(existing.map(t => t.toLowerCase()));
  for (const c of candidates) {
    if (!c.title || c.is_active_now === false) continue;
    if (existingTitlesLower.has(String(c.title).toLowerCase())) continue;
    const fit = audienceFitCheck({ title: c.title, seed_text: c.summary || "", source: source.country });
    const id = createOpportunity({
      title: String(c.title).slice(0, 200),
      source: `funding_hunter:${source.id}`,
      source_provenance: source.url,
      seed_text: `${c.summary || ""}\n\nEvidence: ${c.evidence_snippet || ""}\n\nEstimated value range: ${c.estimated_value_to_smb_usd_range || "Unknown"}\n\nAudience fit: ${fit.fit_level}${fit.reframe_suggestion ? "\nReframe note: " + fit.reframe_suggestion : ""}`,
      parent_strategy_id: strategy.id,
      notes: `auto-detected by funding_hunter from ${source.country}/${source.category} | fit_level=${fit.fit_level}`,
    });
    created.push({ id, title: c.title, fit_level: fit.fit_level });
  }

  return {
    ok: true,
    source_id: source.id,
    candidates_found: candidates.length,
    opportunities_created: created.length,
    log_file: logFile,
    llm_cost_usd: result.cost_usd,
    created,
  };
}
