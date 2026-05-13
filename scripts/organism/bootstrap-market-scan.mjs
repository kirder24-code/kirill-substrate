#!/usr/bin/env node
// organism/bootstrap-market-scan.mjs
// First breath of the organism. Generates strategic priors from Claude (the larynx)
// and writes them to the belief graph (the body). One-shot: run once, populates 300-500 beliefs.
//
// What it produces:
//   - Market beliefs (50+ countries x dimensions)
//   - Grant/program beliefs (named global AI funding programs)
//   - Operational priors (cross-cutting truths about AI services market)
//   - Verdict beliefs (top markets for Kirill's specific capability)
//
// After this runs once, `node inspect.mjs` shows the first strategic verdict.

import { spawnSync, spawn } from "node:child_process";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, upsertBelief, addLink, getBeliefByClaim, totalBeliefs, logOp } from "./db.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolve(__dirname, "../..");
const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";
const PROMPT_FILE = resolve(PROJECT, ".data/organism-bootstrap-prompt.md");
const RAW_OUTPUT_FILE = resolve(PROJECT, ".data/organism-bootstrap-raw.txt");

const KIRILL_CAPABILITY = `
SOLO OPERATOR PROFILE:
- Builder of AI workflows / automation systems for SMBs and small teams.
- Strong in: Claude/GPT API integration, agent orchestration, multi-bot systems,
  Reddit/LinkedIn outreach automation, vibe-code rescue (fixing broken AI-generated code),
  workflow design across CRM/email/social channels.
- Online business, no physical location anchor (currently in Calgary but irrelevant).
- Solo, so price point $1.5K-10K CAD per project.
- Speaks Russian and English fluently. Has European/Eastern-European cultural fluency.
- Has zero existing brand outside small LinkedIn presence (~525 followers).
- Goal: find the global pockets where his capability has the highest expected revenue per hour
  of effort, accounting for competition density, willingness to pay, payment friction, grants,
  and access to decision-makers.
`;

function makePrompt(region, countries) {
  return `Bootstrap scan: generate strategic priors as compact JSON for an autonomous business organism.

Context — who the organism serves:
${KIRILL_CAPABILITY}

Region for this call: ${region}.
Cover these countries: ${countries.join(", ")}.

Output schema:
{
  "markets": [
    {"country": "Singapore", "score": 0.8, "claims": [
      {"claim": "Singapore: MAS gives AI integrator grants up to $50K SGD via Financial Sector Tech & Innovation Scheme", "weight": 0.75, "domain": "market.singapore.grants"}
    ]}
  ]
}

For each country generate 3-4 SPECIFIC claims spanning these dimensions (rotate, don't repeat the same dimension):
grants/incentives, competition density, willingness-to-pay, payment friction, language fit, decision-maker access, fiscal cycle, AI adoption stage.

Weight semantics: 0.85+ near-certain, 0.65-0.85 strong, 0.45-0.65 moderate, <0.45 weak. Be honest about uncertainty.

Use specific named programs where you know them. Be skeptical of round generalities — prefer concrete claims.

Domain format: market.<country_lowercase>.<dimension> (e.g., market.singapore.grants).

CRITICAL: Output ONLY the JSON object. No prose. No markdown fences. Pure JSON.`;
}

function makeOperationalPrompt() {
  return `Generate 25-35 operational priors for a solo AI-workflow consultant doing global outbound.

Context: ${KIRILL_CAPABILITY}

Cover dimensions: outreach channels (cold email, LinkedIn, Reddit, X, Slack/Discord communities), pricing patterns by market segment, deal-cycle length, trust-building, positioning, common objections, payment terms, contract structures, time-zone dynamics, conversion rates.

Output JSON:
{
  "operational": [
    {"claim": "Cold email reply rate <1% in saturated Anglosphere B2B markets in 2026", "weight": 0.75, "domain": "operational.outreach.coldemail"},
    {"claim": "Comments on relevant practitioner posts convert 5-10x better than cold DMs for trust-first selling", "weight": 0.7, "domain": "operational.outreach.organic"}
  ]
}

Be concrete. Avoid round generalities. Include specific reply-rate ranges, dollar bands, percentages where credible.

CRITICAL: Output ONLY the JSON object. Pure JSON.`;
}

function makeProgramsPrompt() {
  return `Generate 15-25 named global program/grant claims relevant to a solo AI-workflow consultant. Specific names only.

Context: ${KIRILL_CAPABILITY}

Examples of named programs to consider: MAS (Singapore), Horizon Europe SME, Estonia e-Residency, UAE MOE-ICAi, Saudi Vision 2030 NEOM AI tracks, Thailand BOI, IMDA programs, NSERC IRAP (Canada), Innovate UK, BPI France, JETRO/J-Startup Japan, MITAQ Mexico, Korean K-Startup, India Startup India, Singapore EDP, Australia R&D Tax Incentive, SBIR-style schemes globally, corporate AI innovation funds.

Output JSON:
{
  "programs": [
    {"claim": "Singapore IMDA: Productivity Solutions Grant covers up to 50% of pre-approved digital tools for SMEs", "weight": 0.7, "domain": "program.singapore.psg"}
  ]
}

Be honest about weights — 0.7 = strong prior, 0.5 = moderate, 0.3 = vague recall. Include named programs even at lower weights if useful as starting points.

CRITICAL: Output ONLY the JSON object. Pure JSON.`;
}

function makeVerdictPrompt(allClaimsBrief) {
  return `Synthesize a strategic verdict from this set of claims about global markets and operational realities.

Context: ${KIRILL_CAPABILITY}

Available claims (compact form):
${allClaimsBrief}

Produce a verdict picking the top-3 markets for this operator NOW, with concrete reasoning.

Output JSON:
{
  "verdict": {
    "top_3_markets": ["Singapore", "UAE", "Brazil"],
    "rationale": "Three to five sentence rationale grounded in the claims above. Name the specific factors that elevated these three over the alternatives.",
    "claim": "Verdict 2026-04-28: Singapore + UAE + Brazil are the highest-EV markets for this solo operator's AI workflow capability, given grant access, competition density, and price elasticity",
    "weight": 0.7
  }
}

Be concrete and contrarian where evidence supports it. If Anglosphere is saturated, say so. If a specific named program looks underexploited, name it.

CRITICAL: Output ONLY the JSON object. Pure JSON.`;
}

const REGIONS = [
  ["SEA", ["Singapore", "Malaysia", "Indonesia", "Vietnam", "Thailand", "Philippines"]],
  ["Middle East", ["UAE", "Saudi Arabia", "Israel", "Qatar"]],
  ["East Asia", ["Japan", "South Korea", "Taiwan", "Hong Kong"]],
  ["Europe", ["UK", "Germany", "Netherlands", "Estonia", "Portugal", "Cyprus", "Ireland"]],
  ["Anglosphere", ["United States", "Canada", "Australia", "New Zealand"]],
  ["LatAm", ["Brazil", "Mexico", "Argentina", "Chile", "Colombia"]],
  ["South Asia", ["India"]],
];

function ensureDataDir() {
  const dir = resolve(PROJECT, ".data");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function callClaudeAsync(prompt, label) {
  return new Promise((resolveDone) => {
    ensureDataDir();
    const promptFile = resolve(PROJECT, `.data/organism-bootstrap-${label}-prompt.md`);
    writeFileSync(promptFile, prompt);

    const t0 = Date.now();
    console.log(`[bootstrap:${label}] starting...`);

    const proc = spawn("bash", ["-c",
      `cat "${promptFile}" | "${CLAUDE_BIN}" -p --model claude-sonnet-4-6 --max-turns 4 --output-format text 2>&1`
    ], { cwd: PROJECT });

    let stdout = "";
    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stdout += d.toString(); }); // 2>&1 already merges, this is belt+suspenders

    const timer = setTimeout(() => {
      console.error(`[bootstrap:${label}] TIMEOUT after 240s, killing`);
      proc.kill("SIGKILL");
    }, 240000);

    proc.on("close", (code) => {
      clearTimeout(timer);
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      const rawFile = resolve(PROJECT, `.data/organism-bootstrap-${label}-raw.txt`);
      writeFileSync(rawFile, stdout);

      if (code !== 0) {
        console.error(`[bootstrap:${label}] FAILED in ${dt}s, exit=${code}`);
        resolveDone(null);
        return;
      }
      console.log(`[bootstrap:${label}] OK in ${dt}s, ${stdout.length} chars`);
      resolveDone(stdout.trim());
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      console.error(`[bootstrap:${label}] spawn error: ${err.message}`);
      resolveDone(null);
    });
  });
}

function extractJson(raw) {
  // Strip code fences if Claude added them despite instructions.
  let text = raw;
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) text = fenceMatch[1];

  // Find first { and last } — outer brace boundary.
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first < 0 || last <= first) {
    throw new Error("No JSON object found in Claude output");
  }
  const candidate = text.slice(first, last + 1);

  try {
    return JSON.parse(candidate);
  } catch (e) {
    console.error("[bootstrap] First parse failed, trying to repair...");
    // Best-effort cleanup of trailing commas
    const cleaned = candidate.replace(/,\s*([\]}])/g, "$1");
    return JSON.parse(cleaned);
  }
}

function ingestScan(db, scan) {
  let inserted = 0;
  let updated = 0;
  const startTotal = totalBeliefs(db);

  const tx = db.transaction(() => {
    // Markets
    if (Array.isArray(scan.markets)) {
      for (const market of scan.markets) {
        const country = market.country || "unknown";
        const marketAnchorClaim = `Market scan: ${country} score=${market.score ?? "n/a"}`;
        const anchorId = upsertBelief(db, {
          claim: marketAnchorClaim,
          domain: `market.${country.toLowerCase().replace(/\s+/g, "_")}.anchor`,
          weight: typeof market.score === "number" ? market.score : 0.5,
          origin: "bootstrap.market_scan",
          source_type: "claude_bootstrap",
          source_ref: "claude-sonnet-4-6/market_scan/v1",
          signal: `bootstrap-anchor for ${country}`,
          signal_strength: typeof market.score === "number" ? market.score : 0.5,
          reason: `bootstrap market anchor for ${country}`,
        });

        if (Array.isArray(market.claims)) {
          for (const c of market.claims) {
            if (!c?.claim) continue;
            const id = upsertBelief(db, {
              claim: c.claim,
              domain: c.domain || `market.${country.toLowerCase().replace(/\s+/g, "_")}.misc`,
              weight: typeof c.weight === "number" ? c.weight : 0.5,
              origin: "bootstrap.market_scan",
              source_type: "claude_bootstrap",
              source_ref: "claude-sonnet-4-6/market_scan/v1",
              signal: `bootstrap claim about ${country}`,
              signal_strength: typeof c.weight === "number" ? c.weight : 0.5,
              reason: `bootstrap market claim for ${country}`,
            });
            addLink(db, { from_id: id, to_id: anchorId, link_type: "supports", weight: 0.6 });
            inserted++;
          }
        }
      }
    }

    // Programs / grants
    if (Array.isArray(scan.programs)) {
      for (const p of scan.programs) {
        if (!p?.claim) continue;
        upsertBelief(db, {
          claim: p.claim,
          domain: p.domain || "program.global.unknown",
          weight: typeof p.weight === "number" ? p.weight : 0.5,
          origin: "bootstrap.programs",
          source_type: "claude_bootstrap",
          source_ref: "claude-sonnet-4-6/market_scan/v1",
          signal: "bootstrap program claim",
          signal_strength: typeof p.weight === "number" ? p.weight : 0.5,
          reason: "bootstrap program/grant",
        });
        inserted++;
      }
    }

    // Operational priors
    if (Array.isArray(scan.operational)) {
      for (const o of scan.operational) {
        if (!o?.claim) continue;
        upsertBelief(db, {
          claim: o.claim,
          domain: o.domain || "operational.global.unknown",
          weight: typeof o.weight === "number" ? o.weight : 0.5,
          origin: "bootstrap.operational",
          source_type: "claude_bootstrap",
          source_ref: "claude-sonnet-4-6/market_scan/v1",
          signal: "bootstrap operational claim",
          signal_strength: typeof o.weight === "number" ? o.weight : 0.5,
          reason: "bootstrap operational prior",
        });
        inserted++;
      }
    }

    // Verdict
    if (scan.verdict?.claim) {
      const verdictId = upsertBelief(db, {
        claim: scan.verdict.claim,
        domain: "verdict.global.bootstrap",
        weight: typeof scan.verdict.weight === "number" ? scan.verdict.weight : 0.6,
        origin: "bootstrap.verdict",
        source_type: "claude_bootstrap",
        source_ref: "claude-sonnet-4-6/market_scan/v1",
        signal: "bootstrap verdict",
        signal_strength: typeof scan.verdict.weight === "number" ? scan.verdict.weight : 0.6,
        reason: scan.verdict.rationale || "bootstrap verdict",
      });

      logOp(db, {
        belief_id: verdictId,
        op: "verdict",
        after: scan.verdict,
        reason: "bootstrap verdict produced",
        source_type: "claude_bootstrap",
        source_ref: "claude-sonnet-4-6/market_scan/v1",
      });
    }
  });

  tx();
  const endTotal = totalBeliefs(db);
  inserted = endTotal - startTotal;
  return { inserted, total: endTotal };
}

function safeParse(raw, label) {
  if (!raw) return null;
  try {
    return extractJson(raw);
  } catch (e) {
    console.error(`[bootstrap:${label}] JSON parse failed: ${e.message}`);
    return null;
  }
}

async function runRegionalScansInParallel() {
  const tasks = [
    ...REGIONS.map(([region, countries]) => ({
      label: `region-${region.toLowerCase().replace(/\s+/g, "_")}`,
      prompt: makePrompt(region, countries),
      kind: "markets",
    })),
    { label: "programs", prompt: makeProgramsPrompt(), kind: "programs" },
    { label: "operational", prompt: makeOperationalPrompt(), kind: "operational" },
  ];

  const results = await Promise.all(
    tasks.map(async (task) => {
      const raw = await callClaudeAsync(task.prompt, task.label);
      return { task, raw };
    })
  );

  return results.map(({ task, raw }) => ({
    label: task.label,
    kind: task.kind,
    parsed: safeParse(raw, task.label),
  }));
}

function mergeScans(parts) {
  const scan = { markets: [], programs: [], operational: [] };
  for (const p of parts) {
    if (!p.parsed) continue;
    if (p.kind === "markets" && Array.isArray(p.parsed.markets)) {
      scan.markets.push(...p.parsed.markets);
    } else if (p.kind === "programs" && Array.isArray(p.parsed.programs)) {
      scan.programs.push(...p.parsed.programs);
    } else if (p.kind === "operational" && Array.isArray(p.parsed.operational)) {
      scan.operational.push(...p.parsed.operational);
    }
  }
  return scan;
}

function buildVerdictBrief(scan) {
  const lines = [];
  lines.push("=== MARKETS (top score per country) ===");
  for (const m of scan.markets) {
    lines.push(`- ${m.country} (score=${m.score ?? "?"}): ${(m.claims || []).map(c => c.claim).slice(0, 2).join(" | ")}`);
  }
  lines.push("\n=== KEY PROGRAMS ===");
  for (const p of scan.programs.slice(0, 20)) lines.push(`- ${p.claim}`);
  lines.push("\n=== KEY OPERATIONAL ===");
  for (const o of scan.operational.slice(0, 15)) lines.push(`- ${o.claim}`);
  return lines.join("\n").slice(0, 6000);
}

async function main() {
  const db = openDb();
  const before = totalBeliefs(db);
  console.log(`[bootstrap] Graph currently has ${before} beliefs.`);

  if (before > 0 && !process.argv.includes("--force")) {
    console.log("[bootstrap] Graph non-empty. Re-run with --force to bootstrap again.");
    db.close();
    return;
  }

  console.log(`[bootstrap] Starting wave scan: ${REGIONS.length} regions + programs + operational`);
  const t0 = Date.now();
  const parts = await runRegionalScansInParallel();
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[bootstrap] All waves done in ${dt}s. Parsed: ${parts.filter(p => p.parsed).length}/${parts.length}`);

  const scan = mergeScans(parts);
  console.log(`[bootstrap] Merged: ${scan.markets.length} market objects, ${scan.programs.length} programs, ${scan.operational.length} operational`);

  // Synthesize verdict from what we got
  if (scan.markets.length > 0 || scan.operational.length > 0) {
    const brief = buildVerdictBrief(scan);
    const verdictRaw = await callClaudeAsync(makeVerdictPrompt(brief), "verdict");
    const verdictParsed = safeParse(verdictRaw, "verdict");
    if (verdictParsed?.verdict) {
      scan.verdict = verdictParsed.verdict;
    }
  }

  if (scan.markets.length === 0 && scan.programs.length === 0 && scan.operational.length === 0) {
    console.error("[bootstrap] No data ingested — all waves failed. Check raw files in .data/");
    db.close();
    process.exit(1);
  }

  const { inserted, total } = ingestScan(db, scan);
  console.log(`[bootstrap] Inserted ${inserted} beliefs. Graph total: ${total}.`);
  console.log(`[bootstrap] Run 'node scripts/organism/inspect.mjs' to see the verdict.`);
  db.close();
}

main().catch((e) => {
  console.error("[bootstrap] FAILED:", e.message);
  process.exit(1);
});
