#!/usr/bin/env node
// organism/regenerate-verdict.mjs
// Re-runs the verdict synthesis using the current full graph state.
// Call this after bootstrap-ingest.mjs (e.g., after retry) so the verdict
// reflects ALL successful waves, not just the ones available at first run.

import { spawn } from "node:child_process";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, upsertBelief, logOp } from "./db.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolve(__dirname, "../..");
const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";

function buildBriefFromDb(db) {
  // Group market beliefs by country
  const markets = db.prepare(`
    SELECT claim, domain, weight
    FROM beliefs
    WHERE domain LIKE 'market.%'
    ORDER BY domain, weight DESC
  `).all();

  const byCountry = new Map();
  for (const m of markets) {
    const parts = m.domain.split(".");
    const country = parts[1] || "unknown";
    if (!byCountry.has(country)) byCountry.set(country, []);
    byCountry.get(country).push(m);
  }

  const programs = db.prepare(`
    SELECT claim, weight FROM beliefs
    WHERE domain LIKE 'program.%'
    ORDER BY weight DESC LIMIT 30
  `).all();

  const operational = db.prepare(`
    SELECT claim, weight FROM beliefs
    WHERE domain LIKE 'operational.%'
    ORDER BY weight DESC LIMIT 25
  `).all();

  const lines = [];
  lines.push("=== MARKETS BY COUNTRY ===");
  for (const [country, claims] of byCountry) {
    const top = claims.slice(0, 4);
    lines.push(`\n[${country.toUpperCase()}]`);
    for (const c of top) lines.push(`  (w=${c.weight.toFixed(2)}) ${c.claim}`);
  }
  lines.push("\n\n=== KEY PROGRAMS ===");
  for (const p of programs) lines.push(`  (w=${p.weight.toFixed(2)}) ${p.claim}`);
  lines.push("\n\n=== KEY OPERATIONAL PRIORS ===");
  for (const o of operational) lines.push(`  (w=${o.weight.toFixed(2)}) ${o.claim}`);

  return lines.join("\n").slice(0, 10000);
}

const KIRILL = `Solo operator, AI workflows / automation systems for SMBs and small teams.
Strong in Claude/GPT API, multi-agent orchestration, Reddit/LinkedIn outreach automation,
vibe-code rescue. Online business, currently in Calgary but irrelevant.
Price: $1.5K-10K CAD per project. Russian + English fluent.
Goal: highest expected revenue per hour of effort, accounting for competition density,
willingness to pay, payment friction, grants, and access to decision-makers.`;

function verdictPrompt(brief) {
  return `Synthesize a strategic verdict from this set of claims about global markets, programs, and operational realities.

Operator profile:
${KIRILL}

ALL available claims (current state of organism's belief graph):
${brief}

Produce a verdict picking the top-3 markets for this operator NOW, with concrete reasoning.

Output JSON:
{
  "verdict": {
    "top_3_markets": ["X", "Y", "Z"],
    "rationale": "Three to five sentence rationale grounded in the claims above. Name the specific factors that elevated these three over the alternatives. Be contrarian where evidence supports it.",
    "claim": "Verdict <YYYY-MM-DD>: <X> + <Y> + <Z> are the highest-EV markets for this solo operator's AI workflow capability, given <factors>",
    "weight": 0.7
  }
}

Be concrete. Name specific named programs or factors that elevated each pick. Call out one contrarian rejection (a market that might seem obvious but isn't right).

CRITICAL: Output ONLY the JSON object. Pure JSON. No prose. No markdown fences.`;
}

function callClaudeAsync(prompt, label) {
  return new Promise((resolveDone) => {
    const promptFile = resolve(PROJECT, `.data/organism-${label}-prompt.md`);
    writeFileSync(promptFile, prompt);
    const t0 = Date.now();
    console.log(`[${label}] starting...`);

    const proc = spawn("bash", ["-c",
      `cat "${promptFile}" | "${CLAUDE_BIN}" -p --model claude-sonnet-4-6 --max-turns 4 --output-format text 2>&1`
    ], { cwd: PROJECT });

    let stdout = "";
    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stdout += d.toString(); });
    const timer = setTimeout(() => proc.kill("SIGKILL"), 240000);
    proc.on("close", (code) => {
      clearTimeout(timer);
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      writeFileSync(resolve(PROJECT, `.data/organism-${label}-raw.txt`), stdout);
      if (code !== 0) {
        console.error(`[${label}] FAILED in ${dt}s, exit=${code}`);
        resolveDone(null);
      } else {
        console.log(`[${label}] OK in ${dt}s, ${stdout.length} chars`);
        resolveDone(stdout.trim());
      }
    });
  });
}

function extractJson(raw) {
  let text = raw;
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) text = fenceMatch[1];
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first < 0) throw new Error("no JSON");
  const candidate = text.slice(first, last + 1);
  try { return JSON.parse(candidate); }
  catch { return JSON.parse(candidate.replace(/,\s*([\]}])/g, "$1")); }
}

async function main() {
  const db = openDb();
  const brief = buildBriefFromDb(db);
  console.log(`[regen] Built brief from full graph state, ${brief.length} chars`);

  const raw = await callClaudeAsync(verdictPrompt(brief), "regen-verdict");
  if (!raw) { db.close(); process.exit(1); }

  const parsed = extractJson(raw);
  const v = parsed.verdict || parsed;
  if (!v?.claim) {
    console.error("[regen] no verdict claim in response");
    db.close();
    process.exit(1);
  }

  const id = upsertBelief(db, {
    claim: v.claim,
    domain: "verdict.global.regen",
    weight: typeof v.weight === "number" ? v.weight : 0.65,
    origin: "regenerate.verdict",
    source_type: "claude_regen",
    source_ref: "claude-sonnet-4-6/verdict-regen/v1",
    signal: "regenerated verdict from full graph",
    signal_strength: typeof v.weight === "number" ? v.weight : 0.65,
    reason: v.rationale || "regenerated verdict",
  });
  logOp(db, {
    belief_id: id,
    op: "verdict",
    after: v,
    reason: "regenerated verdict from full graph state",
    source_type: "claude_regen",
    source_ref: "claude-sonnet-4-6/verdict-regen/v1",
  });

  console.log(`\n=== REGENERATED VERDICT ===`);
  console.log(`Top 3: ${(v.top_3_markets || []).join(", ")}`);
  console.log(`\n${v.rationale || ""}`);
  db.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
