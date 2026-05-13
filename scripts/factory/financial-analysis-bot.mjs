/**
 * financial-analysis-bot.mjs - Niche financial analysis layer
 *
 * Takes a niche name, pulls market sizing data via Brave Search,
 * calculates TAM/SAM/SOM, analyzes competitor pricing,
 * outputs profitability score 0-100 with breakdown.
 *
 * CLI:
 *   node scripts/factory/financial-analysis-bot.mjs "AI voice agents for dental clinics"
 *   node scripts/factory/financial-analysis-bot.mjs "AI voice agents for dental clinics" --out .data/niche-analysis.json
 *
 * Called by ProjectExecutor as step type "analyze_niche_financial".
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");
const ENV_PATH = resolve(PROJECT_ROOT, "apps/api/.env");

const env = Object.fromEntries(
  readFileSync(ENV_PATH, "utf-8").split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const BRAVE_KEY = env.BRAVE_SEARCH_API_KEY;
const OPENAI_KEY = env.OPENAI_API_KEY;
const MODEL = "gpt-5.4-mini";

// ─── Brave search helper ──────────────────────────────────────────────────────
async function braveSearch(query, count = 5) {
  if (!BRAVE_KEY) return [];
  try {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}&freshness=py`;
    const r = await fetch(url, {
      headers: { "Accept": "application/json", "X-Subscription-Token": BRAVE_KEY },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return [];
    const data = await r.json();
    return (data.web?.results || []).map(item => ({
      title: item.title,
      description: item.description,
      url: item.url,
    }));
  } catch {
    return [];
  }
}

// ─── OpenAI call ──────────────────────────────────────────────────────────────
async function callAI(systemPrompt, userPrompt) {
  if (!OPENAI_KEY) throw new Error("OPENAI_API_KEY not set");
  const body = {
    model: MODEL,
    messages: [
      { role: "system", content: systemPrompt + "\n\nReturn your response as a valid JSON object." },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" },
    temperature: 0.3,
  };
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  const data = await r.json();
  if (!data.choices?.[0]?.message?.content) throw new Error(JSON.stringify(data).slice(0, 300));
  return JSON.parse(data.choices[0].message.content);
}

// ─── Main analysis ────────────────────────────────────────────────────────────
async function analyzeNiche(nicheName) {
  console.log(`[financial-analysis] Analyzing: ${nicheName}`);

  // Run 3 targeted searches in parallel
  const [marketResults, pricingResults, competitorResults] = await Promise.all([
    braveSearch(`${nicheName} market size TAM billion 2024 2025`, 5),
    braveSearch(`${nicheName} pricing plans monthly cost per month`, 5),
    braveSearch(`${nicheName} competitors tools software vendors`, 5),
  ]);

  const searchSummary = {
    market: marketResults.map(r => `${r.title}: ${r.description}`).join("\n").slice(0, 2000),
    pricing: pricingResults.map(r => `${r.title}: ${r.description}`).join("\n").slice(0, 2000),
    competitors: competitorResults.map(r => `${r.title}: ${r.description}`).join("\n").slice(0, 2000),
  };

  const systemPrompt = `You are a financial analyst specializing in SaaS and AI services market sizing.
Your job: analyze a niche and produce a structured financial assessment.
Be conservative and realistic. Use the search data as evidence, but fill gaps with industry knowledge.
Never invent specific company names that are not implied by the data.
All currency in USD unless specified.`;

  const userPrompt = `Niche: "${nicheName}"

MARKET SIZE SEARCH RESULTS:
${searchSummary.market || "(no results)"}

PRICING SEARCH RESULTS:
${searchSummary.pricing || "(no results)"}

COMPETITOR SEARCH RESULTS:
${searchSummary.competitors || "(no results)"}

Produce a JSON analysis with this exact structure:
{
  "niche": "<niche name>",
  "market": {
    "tam_usd": <total addressable market in USD, integer, e.g. 5000000000>,
    "tam_note": "<one sentence explaining TAM estimate>",
    "sam_usd": <serviceable addressable market - realistic subset, integer>,
    "sam_note": "<one sentence explaining SAM estimate>",
    "som_usd": <serviceable obtainable market for 1-3 person team in year 1, integer>,
    "som_note": "<one sentence explaining SOM estimate>",
    "growth_rate_pct": <annual market growth %, integer>,
    "maturity": "emerging|growing|mature|declining"
  },
  "pricing": {
    "avg_monthly_usd": <average price per customer per month, integer>,
    "range_low_usd": <lowest tier, integer>,
    "range_high_usd": <enterprise tier, integer>,
    "model": "subscription|one-time|usage-based|hybrid",
    "top_competitors": [
      { "name": "<name>", "price_usd": <monthly price>, "tier": "low|mid|high" }
    ]
  },
  "unit_economics": {
    "avg_deal_size_usd": <typical single deal value, integer>,
    "avg_ltv_usd": <lifetime value per customer, integer>,
    "avg_cac_usd": <estimated customer acquisition cost, integer>,
    "ltv_cac_ratio": <float, e.g. 3.5>,
    "payback_months": <integer>
  },
  "profitability": {
    "score": <0-100 integer. 0=terrible, 50=average, 80+=strong opportunity>,
    "grade": "F|D|C|B|A|A+",
    "verdict": "<one sentence overall verdict>",
    "strengths": ["<strength 1>", "<strength 2>"],
    "risks": ["<risk 1>", "<risk 2>"],
    "recommendation": "avoid|test|pursue|fast-track"
  },
  "kirill_fit": {
    "score": <0-100, fit for 1-person AI agency in Canada>,
    "why": "<two sentences on why or why not this fits Kirill's profile>",
    "entry_angle": "<specific first step to enter this niche>",
    "target_customer": "<one-line ICP description>"
  }
}`;

  console.log(`[financial-analysis] Calling AI for analysis...`);
  const analysis = await callAI(systemPrompt, userPrompt);

  // Add metadata
  analysis._meta = {
    niche: nicheName,
    analyzed_at: new Date().toISOString(),
    search_results_count: {
      market: marketResults.length,
      pricing: pricingResults.length,
      competitors: competitorResults.length,
    },
    model: MODEL,
  };

  return analysis;
}

// ─── Pretty print ─────────────────────────────────────────────────────────────
function prettyPrint(a) {
  const m = a.market || {};
  const p = a.pricing || {};
  const u = a.unit_economics || {};
  const pr = a.profitability || {};
  const kf = a.kirill_fit || {};

  const fmt = n => n ? `$${(n / 1e6).toFixed(1)}M` : "?";

  const lines = [
    `FINANCIAL ANALYSIS: ${a.niche}`,
    `Analyzed: ${a._meta?.analyzed_at?.slice(0, 10) || "?"}`,
    ``,
    `MARKET SIZE`,
    `  TAM: ${fmt(m.tam_usd)}  |  ${m.tam_note || ""}`,
    `  SAM: ${fmt(m.sam_usd)}  |  ${m.sam_note || ""}`,
    `  SOM: ${fmt(m.som_usd)}  |  ${m.som_note || ""}`,
    `  Growth: ${m.growth_rate_pct || "?"}%/yr  |  Stage: ${m.maturity || "?"}`,
    ``,
    `PRICING`,
    `  Avg monthly: $${p.avg_monthly_usd || "?"}  |  Range: $${p.range_low_usd || "?"} - $${p.range_high_usd || "?"}`,
    `  Model: ${p.model || "?"}`,
    p.top_competitors?.length
      ? `  Top competitors: ${p.top_competitors.map(c => `${c.name} ($${c.price_usd}/mo)`).join(", ")}`
      : "",
    ``,
    `UNIT ECONOMICS`,
    `  Deal: $${u.avg_deal_size_usd || "?"}  |  LTV: $${u.avg_ltv_usd || "?"}  |  CAC: $${u.avg_cac_usd || "?"}`,
    `  LTV:CAC: ${u.ltv_cac_ratio || "?"}x  |  Payback: ${u.payback_months || "?"} months`,
    ``,
    `PROFITABILITY SCORE: ${pr.score || 0}/100 (${pr.grade || "?"})`,
    `  ${pr.verdict || ""}`,
    `  Strengths: ${(pr.strengths || []).join("; ")}`,
    `  Risks: ${(pr.risks || []).join("; ")}`,
    `  Recommendation: ${pr.recommendation || "?"}`,
    ``,
    `KIRILL FIT: ${kf.score || 0}/100`,
    `  ${kf.why || ""}`,
    `  Entry angle: ${kf.entry_angle || "?"}`,
    `  Target: ${kf.target_customer || "?"}`,
  ].filter(l => l !== undefined);

  return lines.join("\n");
}

// ─── CLI ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const outFlag = args.indexOf("--out");
const outPath = outFlag !== -1 ? args[outFlag + 1] : null;
const nicheName = args.filter((a, i) => a !== "--out" && i !== outFlag + 1).join(" ").trim();

if (!nicheName) {
  console.error('Usage: node financial-analysis-bot.mjs "niche name" [--out path.json]');
  process.exit(1);
}

try {
  const result = await analyzeNiche(nicheName);
  const pretty = prettyPrint(result);

  console.log("\n" + pretty + "\n");
  console.log("[financial-analysis] JSON result:");
  console.log(JSON.stringify(result, null, 2));

  if (outPath) {
    const fullOut = outPath.startsWith("/") ? outPath : resolve(PROJECT_ROOT, outPath);
    const dir = fullOut.replace(/\/[^/]+$/, "");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(fullOut, JSON.stringify(result, null, 2));
    console.log(`[financial-analysis] Saved to ${outPath}`);
  }

  process.exit(0);
} catch (e) {
  console.error("[financial-analysis] Error:", e.message);
  process.exit(1);
}
