#!/usr/bin/env node
// organism/bootstrap-ingest.mjs
// Read all raw bootstrap output files (whether from initial run or retry),
// parse what's parseable, and merge into the graph. Idempotent — running it
// multiple times just upserts (weight averaged in by Bayesian update).
//
// Usage:
//   node scripts/organism/bootstrap-ingest.mjs           # ingest from existing raw files
//   node scripts/organism/bootstrap-ingest.mjs --include-verdict
//
// Run this after bootstrap-market-scan.mjs and after each bootstrap-retry.mjs.

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, upsertBelief, addLink, totalBeliefs, logOp } from "./db.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolve(__dirname, "../..");

const REGION_LABELS = [
  "region-sea", "region-middle_east", "region-east_asia", "region-europe",
  "region-anglosphere", "region-latam", "region-south_asia",
];
const NON_MARKET_LABELS = ["programs", "operational", "verdict"];

function rawFile(label) { return resolve(PROJECT, `.data/organism-bootstrap-${label}-raw.txt`); }

function readAndParse(label) {
  const f = rawFile(label);
  if (!existsSync(f)) return null;
  let text = readFileSync(f, "utf-8").trim();
  if (!text || text.includes("Reached max turns")) return null;
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) text = fenceMatch[1];
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  const candidate = text.slice(first, last + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    try {
      return JSON.parse(candidate.replace(/,\s*([\]}])/g, "$1"));
    } catch (e) {
      console.error(`[ingest:${label}] parse failed: ${e.message}`);
      return null;
    }
  }
}

function ingestMarkets(db, label, parsed) {
  if (!Array.isArray(parsed.markets)) return 0;
  let n = 0;
  for (const market of parsed.markets) {
    const country = market.country || "unknown";
    const slug = country.toLowerCase().replace(/\s+/g, "_");
    const anchorClaim = `Market scan: ${country} score=${market.score ?? "n/a"}`;
    const anchorId = upsertBelief(db, {
      claim: anchorClaim,
      domain: `market.${slug}.anchor`,
      weight: typeof market.score === "number" ? market.score : 0.5,
      origin: `bootstrap.${label}`,
      source_type: "claude_bootstrap",
      source_ref: `claude-sonnet-4-6/${label}/v1`,
      signal: `bootstrap-anchor for ${country}`,
      signal_strength: typeof market.score === "number" ? market.score : 0.5,
      reason: `bootstrap market anchor for ${country}`,
    });
    n++;

    if (Array.isArray(market.claims)) {
      for (const c of market.claims) {
        if (!c?.claim) continue;
        const id = upsertBelief(db, {
          claim: c.claim,
          domain: c.domain || `market.${slug}.misc`,
          weight: typeof c.weight === "number" ? c.weight : 0.5,
          origin: `bootstrap.${label}`,
          source_type: "claude_bootstrap",
          source_ref: `claude-sonnet-4-6/${label}/v1`,
          signal: `bootstrap claim about ${country}`,
          signal_strength: typeof c.weight === "number" ? c.weight : 0.5,
          reason: `bootstrap market claim for ${country}`,
        });
        addLink(db, { from_id: id, to_id: anchorId, link_type: "supports", weight: 0.6 });
        n++;
      }
    }
  }
  return n;
}

function ingestPrograms(db, parsed) {
  if (!Array.isArray(parsed.programs)) return 0;
  let n = 0;
  for (const p of parsed.programs) {
    if (!p?.claim) continue;
    upsertBelief(db, {
      claim: p.claim,
      domain: p.domain || "program.global.unknown",
      weight: typeof p.weight === "number" ? p.weight : 0.5,
      origin: "bootstrap.programs",
      source_type: "claude_bootstrap",
      source_ref: "claude-sonnet-4-6/programs/v1",
      signal: "bootstrap program claim",
      signal_strength: typeof p.weight === "number" ? p.weight : 0.5,
      reason: "bootstrap program/grant",
    });
    n++;
  }
  return n;
}

function ingestOperational(db, parsed) {
  if (!Array.isArray(parsed.operational)) return 0;
  let n = 0;
  for (const o of parsed.operational) {
    if (!o?.claim) continue;
    upsertBelief(db, {
      claim: o.claim,
      domain: o.domain || "operational.global.unknown",
      weight: typeof o.weight === "number" ? o.weight : 0.5,
      origin: "bootstrap.operational",
      source_type: "claude_bootstrap",
      source_ref: "claude-sonnet-4-6/operational/v1",
      signal: "bootstrap operational claim",
      signal_strength: typeof o.weight === "number" ? o.weight : 0.5,
      reason: "bootstrap operational prior",
    });
    n++;
  }
  return n;
}

function ingestVerdict(db, parsed) {
  const v = parsed.verdict || parsed;
  if (!v?.claim) return 0;
  const id = upsertBelief(db, {
    claim: v.claim,
    domain: "verdict.global.bootstrap",
    weight: typeof v.weight === "number" ? v.weight : 0.6,
    origin: "bootstrap.verdict",
    source_type: "claude_bootstrap",
    source_ref: "claude-sonnet-4-6/verdict/v1",
    signal: "bootstrap verdict",
    signal_strength: typeof v.weight === "number" ? v.weight : 0.6,
    reason: v.rationale || "bootstrap verdict",
  });
  logOp(db, {
    belief_id: id,
    op: "verdict",
    after: v,
    reason: "bootstrap verdict ingested",
    source_type: "claude_bootstrap",
    source_ref: "claude-sonnet-4-6/verdict/v1",
  });
  return 1;
}

function main() {
  const db = openDb();
  const before = totalBeliefs(db);
  console.log(`[ingest] Graph has ${before} beliefs at start.`);

  const tx = db.transaction(() => {
    let totalAdded = 0;

    for (const label of REGION_LABELS) {
      const parsed = readAndParse(label);
      if (!parsed) {
        console.log(`[ingest:${label}] skip (no valid output)`);
        continue;
      }
      const n = ingestMarkets(db, label, parsed);
      console.log(`[ingest:${label}] processed ${n} entries`);
      totalAdded += n;
    }

    const programs = readAndParse("programs");
    if (programs) {
      const n = ingestPrograms(db, programs);
      console.log(`[ingest:programs] processed ${n} entries`);
      totalAdded += n;
    } else {
      console.log("[ingest:programs] skip (no valid output)");
    }

    const operational = readAndParse("operational");
    if (operational) {
      const n = ingestOperational(db, operational);
      console.log(`[ingest:operational] processed ${n} entries`);
      totalAdded += n;
    } else {
      console.log("[ingest:operational] skip (no valid output)");
    }

    const verdict = readAndParse("verdict");
    if (verdict) {
      const n = ingestVerdict(db, verdict);
      console.log(`[ingest:verdict] processed ${n} entries`);
      totalAdded += n;
    }

    console.log(`[ingest] processed ${totalAdded} entries (some are upserts of existing beliefs)`);
  });
  tx();

  const after = totalBeliefs(db);
  console.log(`[ingest] Graph now has ${after} beliefs (delta: +${after - before}).`);
  console.log(`[ingest] Run 'node scripts/organism/inspect.mjs' to view.`);
  db.close();
}

main();
