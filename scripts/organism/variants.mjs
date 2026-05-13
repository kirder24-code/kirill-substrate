#!/usr/bin/env node
// organism/variants.mjs
// V0 evolution: 3 variant personalities each generate predictions from the same graph.
// Whichever variant's predictions match reality more often wins credibility over time.
//
// Variants:
//   skeptic   — discounts single-source claims, prefers high-evidence beliefs, conservative
//   optimist  — weights recent learning higher, willing to act on weaker priors, risk-tolerant
//   explorer  — actively biases toward under-explored domains and contradictions
//
// Each generates a "prediction set" daily: 3-5 falsifiable predictions about what will happen
// in the next 7 days based on current graph. Predictions get auto-resolved by matching outcomes.
// Scoreboard tracks confirm/contradict ratio per variant.

import { spawn, spawnSync } from "node:child_process";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, recordVariantPrediction, variantScoreboard } from "./db.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolve(__dirname, "../..");
const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";

const VARIANTS = {
  skeptic: {
    bias: `You are SKEPTIC. You discount any belief with sources_count <= 1, regardless of weight.
You prefer beliefs with sources_count >= 3 and weight >= 0.7. You doubt single-source claims even if Claude generated them.
You make conservative predictions that should reliably hold; you'd rather under-promise.`,
  },
  optimist: {
    bias: `You are OPTIMIST. You weight recent (last 7 days) learning highly because the world is changing.
You're willing to make predictions based on emerging signals even with weak source counts. You'd rather be right early than safe and late.`,
  },
  explorer: {
    bias: `You are EXPLORER. You actively look at under-explored domains: topics with few beliefs, contradictions that need resolving,
risky single-source beliefs that beg for verification. Your predictions probe the edges of the graph, not the center.`,
  },
};

function buildGraphSummary(db) {
  const verdict = db.prepare(`SELECT claim, weight FROM beliefs WHERE domain LIKE 'verdict.%' ORDER BY last_updated DESC LIMIT 1`).get();
  const top = db.prepare(`SELECT claim, weight, sources_count, domain FROM beliefs ORDER BY weight DESC LIMIT 30`).all();
  const recent = db.prepare(`SELECT claim, weight FROM beliefs WHERE last_updated > datetime('now', '-3 days') AND origin LIKE 'outcome%' ORDER BY weight DESC LIMIT 10`).all();
  const cont = db.prepare(`SELECT claim, weight, contradictions_count FROM beliefs WHERE contradictions_count > 0 ORDER BY contradictions_count DESC LIMIT 5`).all();

  return {
    verdict: verdict?.claim || "(none)",
    top: top.map(b => `[w=${b.weight.toFixed(2)} src=${b.sources_count}] ${b.claim} (${b.domain})`).join("\n"),
    recent: recent.map(b => `[w=${b.weight.toFixed(2)}] ${b.claim}`).join("\n"),
    contradictions: cont.map(c => `(${c.contradictions_count}x w=${c.weight.toFixed(2)}) ${c.claim}`).join("\n") || "(none)",
  };
}

function predictPrompt(variant, graph) {
  return `${VARIANTS[variant].bias}

You are reading the current state of an organism's belief graph and producing falsifiable predictions for the next 7 days.

Current graph:

VERDICT: ${graph.verdict}

TOP BELIEFS:
${graph.top}

RECENT LEARNING (last 3 days):
${graph.recent}

CONTRADICTIONS:
${graph.contradictions}

Your task: Produce 3-5 falsifiable predictions about what will or will not happen in the next 7 days, grounded in the graph state through your variant's lens.

Each prediction must be:
- Concrete and testable (a real outcome could confirm or contradict it)
- Tied to a specific belief or pattern
- Reflective of YOUR variant's bias (skeptic = conservative, optimist = aggressive, explorer = edgy)

Output JSON:
{
  "predictions": [
    {
      "prediction_text": "Cold email reply rate to US SaaS founders will remain at 0% over next 50 sends",
      "domain": "operational.outreach.coldemail",
      "horizon_days": 7,
      "verifiable_via": "next outreach_aggregate outcome for us_saas segment with sample >= 50"
    }
  ]
}

CRITICAL: Output ONLY JSON. Pure JSON.`;
}

function callClaudeAsync(prompt, label) {
  return new Promise((resolveDone) => {
    const tmp = resolve(PROJECT, `.data/organism-variant-${label}.tmp`);
    if (!existsSync(dirname(tmp))) mkdirSync(dirname(tmp), { recursive: true });
    writeFileSync(tmp, prompt);
    const proc = spawn("bash", ["-c", `cat "${tmp}" | "${CLAUDE_BIN}" -p --model claude-sonnet-4-6 --max-turns 4 --output-format text 2>&1`], { cwd: PROJECT });
    let stdout = "";
    proc.stdout.on("data", d => stdout += d.toString());
    proc.stderr.on("data", d => stdout += d.toString());
    const timer = setTimeout(() => proc.kill("SIGKILL"), 90000);
    proc.on("close", (code) => { clearTimeout(timer); resolveDone(code === 0 ? stdout.trim() : null); });
  });
}

function extractJson(raw) {
  let text = raw;
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) text = m[1];
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first < 0) throw new Error("no JSON");
  const c = text.slice(first, last + 1);
  try { return JSON.parse(c); }
  catch { return JSON.parse(c.replace(/,\s*([\]}])/g, "$1")); }
}

async function generateAllVariantPredictions() {
  const db = openDb();
  const graph = buildGraphSummary(db);
  const today = new Date().toISOString().slice(0, 10);

  // Skip if predictions already generated today
  const todayCount = db.prepare(`SELECT COUNT(*) AS n FROM variant_predictions WHERE date(generated_at) = ?`).get(today).n;
  if (todayCount > 0) {
    console.log(`[variants] already generated ${todayCount} predictions today — skip`);
    db.close();
    return;
  }

  for (const variant of Object.keys(VARIANTS)) {
    console.log(`[variants] ${variant} predicting...`);
    const raw = await callClaudeAsync(predictPrompt(variant, graph), variant);
    if (!raw) { console.error(`[variants] ${variant} failed`); continue; }
    let parsed;
    try { parsed = extractJson(raw); }
    catch (e) { console.error(`[variants] ${variant} parse failed: ${e.message}`); continue; }
    const preds = parsed.predictions || [];
    for (const p of preds) {
      if (!p.prediction_text) continue;
      const id = recordVariantPrediction(db, {
        variant,
        prediction_text: p.prediction_text,
        prediction: p,
        domain: p.domain || null,
      });
      console.log(`  ${variant} #${id}: ${p.prediction_text.slice(0, 80)}`);
    }
  }
  db.close();
}

function scoreboardCmd() {
  const db = openDb();
  const board = variantScoreboard(db);
  console.log(`\n=== VARIANT SCOREBOARD ===`);
  console.log(`Variant     | Total | Resolved | Confirmed | Contradicted | Confirm-rate`);
  console.log(`--`.repeat(35));
  for (const v of board) {
    const rate = v.resolved > 0 ? (v.confirmed / v.resolved * 100).toFixed(0) + "%" : "—";
    console.log(`${v.variant.padEnd(11)} | ${String(v.total).padEnd(5)} | ${String(v.resolved).padEnd(8)} | ${String(v.confirmed).padEnd(9)} | ${String(v.contradicted).padEnd(12)} | ${rate}`);
  }
  db.close();
}

const cmd = process.argv[2];
(async () => {
  if (cmd === "generate") await generateAllVariantPredictions();
  else if (cmd === "scoreboard") scoreboardCmd();
  else { console.error("Usage: generate | scoreboard"); process.exit(1); }
})();
