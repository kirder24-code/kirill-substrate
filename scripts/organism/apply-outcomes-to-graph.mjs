#!/usr/bin/env node
// organism/apply-outcomes-to-graph.mjs
// The bloodstream. Reads unprocessed outcomes, asks Claude to map each onto
// graph operations (confirm / contradict / new belief), applies the ops,
// marks the outcome processed.
//
// Claude is the translator from "real-world signal" -> "structured graph ops".
// The graph is the memory.
//
// Usage:
//   node scripts/organism/apply-outcomes-to-graph.mjs           # process all unprocessed
//   node scripts/organism/apply-outcomes-to-graph.mjs --limit=5 # process at most 5
//   node scripts/organism/apply-outcomes-to-graph.mjs --dry-run # show ops, do not apply

import { spawn } from "node:child_process";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  openDb, listUnprocessedOutcomes, markOutcomeProcessed,
  upsertBelief, recordContradiction, getBeliefByClaim, logOp, totalBeliefs,
  getSourceCredibility, updateSourceCredibility, resolveClaim, listUnresolvedClaims,
} from "./db.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolve(__dirname, "../..");
const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";

function parseFlags(argv) {
  const out = { limit: 50, dryRun: false };
  for (const a of argv.slice(2)) {
    if (a.startsWith("--limit=")) out.limit = parseInt(a.slice(8), 10) || 50;
    else if (a === "--dry-run") out.dryRun = true;
  }
  return out;
}

function relevantBeliefsForOutcome(db, outcome, limit = 30) {
  // Build a set of likely relevant beliefs based on tags in the outcome.
  // Strategy: match by domain prefix (action_type, target tokens) and by
  // keyword overlap with the description.

  const matches = new Map();
  const addAll = (rows) => { for (const r of rows) matches.set(r.id, r); };

  if (outcome.related_action_type) {
    addAll(db.prepare(`
      SELECT * FROM beliefs WHERE domain LIKE ? ORDER BY weight DESC LIMIT 15
    `).all(`operational.outreach.${outcome.related_action_type}%`));
    addAll(db.prepare(`
      SELECT * FROM beliefs WHERE domain LIKE ? ORDER BY weight DESC LIMIT 15
    `).all(`operational.%.${outcome.related_action_type}%`));
  }
  if (outcome.related_target) {
    const t = outcome.related_target.toLowerCase();
    addAll(db.prepare(`
      SELECT * FROM beliefs WHERE domain LIKE ? OR LOWER(claim) LIKE ?
      ORDER BY weight DESC LIMIT 15
    `).all(`%${t}%`, `%${t}%`));
  }

  // Keyword sweep on description
  const stopwords = new Set("the and a or to of for from with about that this not on in is are was were be been have had which but as it its by".split(" "));
  const keywords = (outcome.description || "")
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((w) => w.length >= 4 && !stopwords.has(w))
    .slice(0, 8);

  for (const kw of keywords) {
    addAll(db.prepare(`
      SELECT * FROM beliefs WHERE LOWER(claim) LIKE ? ORDER BY weight DESC LIMIT 5
    `).all(`%${kw}%`));
  }

  // Always include a sample of operational priors as fallback context
  addAll(db.prepare(`
    SELECT * FROM beliefs WHERE domain LIKE 'operational.%' ORDER BY weight DESC LIMIT 8
  `).all());

  return Array.from(matches.values()).slice(0, limit);
}

function makeMappingPrompt(outcome, relevantBeliefs) {
  const beliefList = relevantBeliefs.map((b, i) =>
    `[#${i + 1} | id=${b.id} | weight=${b.weight.toFixed(2)} | sources=${b.sources_count}] ${b.claim}  (domain: ${b.domain})`
  ).join("\n");

  return `You map a real-world OUTCOME onto operations on a belief graph.

The graph stores beliefs about global markets, programs, and operational realities for an
AI-workflow consultant. Each belief has a weight (0-1) and accumulates evidence over time.

REAL-WORLD OUTCOME:
- source_type: ${outcome.source_type}
- signal_type: ${outcome.signal_type}
- signal_value: ${outcome.signal_value ?? "null"}
- related_action: ${outcome.related_action_type || "n/a"}
- related_target: ${outcome.related_target || "n/a"}
- observed_at: ${outcome.observed_at}
- description: ${outcome.description}

RELEVANT BELIEFS CURRENTLY IN GRAPH (most likely to be touched by this outcome):
${beliefList}

Your job: produce ops that move the graph toward truth based on this outcome.

Output JSON with this exact shape:
{
  "ops": [
    {"op": "confirm", "belief_id": 17, "delta": 0.1, "reason": "outcome confirms this belief because ..."},
    {"op": "contradict", "belief_id": 42, "reason": "outcome contradicts this because ..."},
    {"op": "new_belief", "claim": "Specific new claim text grounded in this outcome", "weight": 0.55, "domain": "operational.outreach.coldemail.calgary", "reason": "this outcome teaches us a fact not yet in graph"}
  ]
}

Rules:
1. "confirm" — outcome agrees with belief #X. delta is a small positive (0.05-0.20 typical).
2. "contradict" — outcome disagrees with belief #X. Triggers a 15% weight decay automatically; supply only the reason.
3. "new_belief" — only when the outcome teaches something not captured by any listed belief. Be specific and concrete; weight should be modest (0.45-0.65) since it's based on one outcome.
4. Be conservative. Don't generate 10 ops if 2 capture the truth. Quality > quantity.
5. If a belief is partially confirmed and partially contradicted, prefer "new_belief" with the more nuanced claim over flipping signs on existing beliefs.
6. Use ONLY belief_id values from the list above. Never invent ids.
7. If no listed belief is touched, return {"ops": []}.

CRITICAL: Output ONLY the JSON object. Pure JSON. No prose. No markdown fences.`;
}

function callClaudeAsync(prompt, label) {
  return new Promise((resolveDone) => {
    const dataDir = resolve(PROJECT, ".data/organism-outcome-prompts");
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
    const promptFile = resolve(dataDir, `${label}-prompt.md`);
    const rawFile = resolve(dataDir, `${label}-raw.txt`);
    writeFileSync(promptFile, prompt);

    const t0 = Date.now();
    const proc = spawn("bash", ["-c",
      `cat "${promptFile}" | "${CLAUDE_BIN}" -p --model claude-sonnet-4-6 --max-turns 4 --output-format text 2>&1`
    ], { cwd: PROJECT });

    let stdout = "";
    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stdout += d.toString(); });
    const timer = setTimeout(() => proc.kill("SIGKILL"), 180000);
    proc.on("close", (code) => {
      clearTimeout(timer);
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      writeFileSync(rawFile, stdout);
      if (code !== 0) {
        console.error(`  [claude:${label}] FAILED in ${dt}s`);
        return resolveDone(null);
      }
      console.log(`  [claude:${label}] OK in ${dt}s, ${stdout.length} chars`);
      resolveDone(stdout.trim());
    });
  });
}

function extractJson(raw) {
  let text = raw;
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) text = fenceMatch[1];
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("no JSON");
  const candidate = text.slice(first, last + 1);
  try { return JSON.parse(candidate); }
  catch { return JSON.parse(candidate.replace(/,\s*([\]}])/g, "$1")); }
}

function applyOps(db, outcome, ops, dryRun) {
  const applied = [];
  const sourceRef = `outcome#${outcome.id}`;

  // Look up the credibility of the source that produced this outcome.
  // Multiplier applied to weight changes — low-credibility sources move beliefs less.
  const cred = getSourceCredibility(db, outcome.source_type);
  const credMultiplier = 0.4 + 1.2 * cred.credibility; // range ~[0.4, 1.6] around neutral 1.0
  console.log(`  source ${outcome.source_type} credibility=${cred.credibility.toFixed(2)} (${cred.confirms_count}+ / ${cred.contradicts_count}- of ${cred.total_outcomes}); weight multiplier=${credMultiplier.toFixed(2)}`);

  let confirmsThisOutcome = 0, contradictsThisOutcome = 0;

  for (const op of ops) {
    if (!op || typeof op !== "object") continue;

    if (op.op === "confirm") {
      const belief = db.prepare("SELECT * FROM beliefs WHERE id = ?").get(op.belief_id);
      if (!belief) {
        console.log(`    skip confirm: belief #${op.belief_id} not found`);
        continue;
      }
      const baseDelta = Math.min(0.25, Math.max(0.01, Number(op.delta) || 0.1));
      const delta = baseDelta * credMultiplier;
      const newWeight = Math.min(0.99, belief.weight + delta);
      console.log(`    confirm #${belief.id}: ${belief.weight.toFixed(2)} -> ${newWeight.toFixed(2)} (Δ=${delta.toFixed(3)}, ${belief.claim.slice(0, 60)}...)`);
      confirmsThisOutcome++;
      if (!dryRun) {
        db.prepare("UPDATE beliefs SET weight = ?, sources_count = sources_count + 1, last_updated = datetime('now') WHERE id = ?")
          .run(newWeight, belief.id);
        db.prepare(`
          INSERT INTO belief_evidence (belief_id, source_type, source_ref, signal, signal_strength)
          VALUES (?, 'outcome', ?, ?, ?)
        `).run(belief.id, sourceRef, outcome.description.slice(0, 500), delta);
        logOp(db, {
          belief_id: belief.id,
          op: "confirm",
          before: { weight: belief.weight },
          after: { weight: newWeight },
          reason: op.reason || `confirmed by outcome ${outcome.id}`,
          source_type: "outcome",
          source_ref: sourceRef,
        });
      }
      applied.push({ op: "confirm", belief_id: belief.id, delta, newWeight });

    } else if (op.op === "contradict") {
      const belief = db.prepare("SELECT * FROM beliefs WHERE id = ?").get(op.belief_id);
      if (!belief) {
        console.log(`    skip contradict: belief #${op.belief_id} not found`);
        continue;
      }
      console.log(`    contradict #${belief.id}: weight ${belief.weight.toFixed(2)} -> *0.85 (${belief.claim.slice(0, 60)}...)`);
      contradictsThisOutcome++;
      if (!dryRun) {
        recordContradiction(db, {
          belief_id: belief.id,
          source_type: "outcome",
          source_ref: sourceRef,
          reason: op.reason || `contradicted by outcome ${outcome.id}`,
        });
        db.prepare(`
          INSERT INTO belief_evidence (belief_id, source_type, source_ref, signal, signal_strength)
          VALUES (?, 'outcome', ?, ?, ?)
        `).run(belief.id, sourceRef, outcome.description.slice(0, 500), -0.15);
      }
      applied.push({ op: "contradict", belief_id: belief.id });

    } else if (op.op === "new_belief") {
      if (!op.claim) continue;
      console.log(`    new_belief: "${op.claim.slice(0, 80)}..." (w=${op.weight ?? 0.5})`);
      if (!dryRun) {
        const id = upsertBelief(db, {
          claim: op.claim,
          domain: op.domain || `outcome.${outcome.signal_type}.${outcome.related_target || "general"}`,
          weight: typeof op.weight === "number" ? op.weight : 0.5,
          origin: "outcome.derived",
          source_type: "outcome",
          source_ref: sourceRef,
          signal: outcome.description.slice(0, 200),
          signal_strength: typeof op.weight === "number" ? op.weight : 0.5,
          reason: op.reason || `derived from outcome ${outcome.id}`,
        });
        applied.push({ op: "new_belief", belief_id: id, claim: op.claim });
      } else {
        applied.push({ op: "new_belief", claim: op.claim });
      }

    } else {
      console.log(`    skip unknown op: ${op.op}`);
    }
  }

  // Update source credibility based on whether this source produced confirmable signals.
  // A source is "credible" if its outcomes consistently produce confirms (real beliefs match).
  // A source becomes less credible if its outcomes mostly produce contradictions (introduces noise).
  if (!dryRun && (confirmsThisOutcome > 0 || contradictsThisOutcome > 0)) {
    updateSourceCredibility(db, outcome.source_type, {
      confirms: confirmsThisOutcome > 0 ? 1 : 0,
      contradicts: contradictsThisOutcome > 0 && confirmsThisOutcome === 0 ? 1 : 0,
    });
  }

  // Auto-resolve any unresolved Claude claims that this outcome bears on.
  // Simple matching: domain overlap or substring match on claim_text vs description.
  if (!dryRun) {
    autoResolveClaims(db, outcome, applied);
  }

  return applied;
}

function autoResolveClaims(db, outcome, appliedOps) {
  const unresolved = listUnresolvedClaims(db, { limit: 100 });
  if (unresolved.length === 0) return;

  const desc = (outcome.description || "").toLowerCase();
  const target = (outcome.related_target || "").toLowerCase();
  const action = (outcome.related_action_type || "").toLowerCase();

  for (const claim of unresolved) {
    const cl = (claim.claim_text || "").toLowerCase();
    const dom = (claim.domain || "").toLowerCase();

    let matches = 0;
    // Domain alignment
    if (dom && (dom.includes(target) || target.includes(dom.split(".").pop()))) matches++;
    if (dom && action && dom.includes(action)) matches++;
    // Lexical overlap on key tokens
    const keyTokens = cl.match(/\b(cold email|reddit|linkedin|dm|comment|us saas|hvac|calgary|canada|hong kong|singapore|uae|portugal|reply rate|silence)\b/g) || [];
    for (const tok of keyTokens) if (desc.includes(tok)) matches++;

    if (matches < 2) continue;

    // Decide direction by signal_type
    const positiveSignals = ["reply", "reply_individual", "stage_engaged", "stage_qualifying", "stage_won", "exec_success"];
    const negativeSignals = ["silence", "silence_aggregate", "delivery_failure", "stage_lost", "exec_failure", "exec_failure_max_turns"];

    let resolution = null;
    let reason = `Outcome #${outcome.id} (${outcome.source_type}/${outcome.signal_type}) bears on this claim. Matches: ${matches}.`;

    // Positive prediction with positive outcome -> confirmed; with negative -> contradicted.
    // Negative prediction (e.g., "will fail", "0% reply") with negative outcome -> confirmed.
    const predictsFailure = /\b(will fail|0%|zero|no reply|silence|dead|not work|won't|ineffective)\b/i.test(cl);
    if (positiveSignals.includes(outcome.signal_type)) {
      resolution = predictsFailure ? "contradicted" : "confirmed";
    } else if (negativeSignals.includes(outcome.signal_type)) {
      resolution = predictsFailure ? "confirmed" : "contradicted";
    } else {
      resolution = "inconclusive";
    }

    resolveClaim(db, claim.id, { resolution, reason, outcome_id: outcome.id });
    console.log(`    auto-resolved claim #${claim.id} as ${resolution}: ${claim.claim_text.slice(0, 80)}`);
  }
}

async function main() {
  const flags = parseFlags(process.argv);
  const db = openDb();
  const totalBefore = totalBeliefs(db);

  const queue = listUnprocessedOutcomes(db, { limit: flags.limit });
  if (queue.length === 0) {
    console.log("[apply] No unprocessed outcomes. Run record-outcome.mjs to add some.");
    db.close();
    return;
  }

  console.log(`[apply] Processing ${queue.length} outcomes${flags.dryRun ? " (dry-run)" : ""}. Beliefs at start: ${totalBefore}`);

  for (const outcome of queue) {
    console.log(`\n[apply] outcome #${outcome.id}: ${outcome.source_type}/${outcome.signal_type} :: ${outcome.description.slice(0, 100)}`);

    const relevant = relevantBeliefsForOutcome(db, outcome);
    console.log(`  relevant beliefs: ${relevant.length}`);
    if (relevant.length === 0) {
      console.log(`  no relevant beliefs found — skip (will appear unprocessed until next pass)`);
      continue;
    }

    const prompt = makeMappingPrompt(outcome, relevant);
    const raw = await callClaudeAsync(prompt, `outcome-${outcome.id}`);
    if (!raw) continue;

    let parsed;
    try { parsed = extractJson(raw); }
    catch (e) {
      console.error(`  parse failed: ${e.message}`);
      continue;
    }

    const ops = parsed.ops || [];
    console.log(`  ops proposed: ${ops.length}`);
    if (ops.length === 0) {
      console.log(`  no ops — marking outcome as processed with empty ops`);
      if (!flags.dryRun) markOutcomeProcessed(db, outcome.id, []);
      continue;
    }

    const applied = applyOps(db, outcome, ops, flags.dryRun);
    if (!flags.dryRun) {
      markOutcomeProcessed(db, outcome.id, applied);
      console.log(`  applied ${applied.length} ops, outcome marked processed`);
    } else {
      console.log(`  dry-run: would apply ${applied.length} ops`);
    }
  }

  const totalAfter = totalBeliefs(db);
  console.log(`\n[apply] Done. Beliefs: ${totalBefore} -> ${totalAfter} (delta +${totalAfter - totalBefore} new beliefs from outcomes).`);
  db.close();
}

main().catch((e) => { console.error("[apply] FAILED:", e.message); process.exit(1); });
