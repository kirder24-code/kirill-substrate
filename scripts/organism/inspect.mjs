#!/usr/bin/env node
// organism/inspect.mjs — window into the organism's mind.
// Usage: node scripts/organism/inspect.mjs [--domain=market.singapore.*] [--top=20] [--verdict] [--changes] [--risky]
// No args = full overview.

import { openDb, topBeliefs, recentChanges, activeContradictions, singleSourceRiskyBeliefs, listDomains, totalBeliefs } from "./db.mjs";

function parseArgs(argv) {
  const args = { domain: null, top: 20, mode: "overview" };
  for (const a of argv.slice(2)) {
    if (a.startsWith("--domain=")) args.domain = a.slice(9);
    else if (a.startsWith("--top=")) args.top = parseInt(a.slice(6), 10) || 20;
    else if (a === "--verdict") args.mode = "verdict";
    else if (a === "--changes") args.mode = "changes";
    else if (a === "--risky") args.mode = "risky";
    else if (a === "--contradictions") args.mode = "contradictions";
    else if (a === "--domains") args.mode = "domains";
    else if (a === "--full") args.mode = "full";
  }
  return args;
}

function fmtBelief(b) {
  const w = b.weight.toFixed(2);
  const s = `[${w}|src=${b.sources_count}${b.contradictions_count ? `|x${b.contradictions_count}` : ""}]`;
  const dom = b.domain ? `(${b.domain})` : "";
  return `  ${s} ${b.claim} ${dom}`;
}

function showVerdict(db) {
  const verdicts = db.prepare(`
    SELECT * FROM beliefs
    WHERE domain LIKE 'verdict.%'
    ORDER BY last_updated DESC, weight DESC
    LIMIT 5
  `).all();

  console.log("\n=== STRATEGIC VERDICTS ===");
  if (verdicts.length === 0) {
    console.log("  (none yet — run bootstrap-market-scan.mjs)");
    return;
  }
  for (const v of verdicts) {
    console.log(fmtBelief(v));
    console.log(`     updated: ${v.last_updated}`);
  }

  // Pull the most recent verdict's rationale from the log
  const latestVerdictLog = db.prepare(`
    SELECT * FROM belief_log
    WHERE op = 'verdict'
    ORDER BY ts DESC
    LIMIT 1
  `).get();

  if (latestVerdictLog?.after_json) {
    try {
      const parsed = JSON.parse(latestVerdictLog.after_json);
      console.log("\n--- VERDICT DETAIL ---");
      if (parsed.top_3_markets) console.log(`Top 3 markets: ${parsed.top_3_markets.join(", ")}`);
      if (parsed.rationale) console.log(`\nRationale:\n${parsed.rationale}`);
    } catch {}
  }
}

function showOverview(db) {
  const total = totalBeliefs(db);
  console.log(`\n=== ORGANISM STATE ===`);
  console.log(`Total beliefs: ${total}`);

  if (total === 0) {
    console.log("\n  Graph is empty. Run: node scripts/organism/bootstrap-market-scan.mjs");
    return;
  }

  showVerdict(db);

  console.log("\n=== TOP 15 BELIEFS BY WEIGHT ===");
  for (const b of topBeliefs(db, { limit: 15 })) console.log(fmtBelief(b));

  const domains = listDomains(db);
  console.log("\n=== DOMAIN SUMMARY (top 12) ===");
  for (const d of domains.slice(0, 12)) {
    console.log(`  ${d.domain.padEnd(40)} count=${String(d.count).padEnd(4)} avg=${d.avg_weight.toFixed(2)} max=${d.max_weight.toFixed(2)}`);
  }

  const risky = singleSourceRiskyBeliefs(db, { minWeight: 0.65, limit: 8 });
  if (risky.length > 0) {
    console.log("\n=== HIGH-WEIGHT BELIEFS WITH SINGLE SOURCE (verify with reality) ===");
    for (const b of risky) console.log(fmtBelief(b));
  }

  const contradictions = activeContradictions(db, { limit: 8 });
  if (contradictions.length > 0) {
    console.log("\n=== ACTIVE CONTRADICTIONS ===");
    for (const b of contradictions) console.log(fmtBelief(b));
  }

  console.log("\n--- More views: --changes | --risky | --contradictions | --domains | --domain=market.singapore.* | --full ---");
}

function showDomain(db, pattern) {
  const sql = pattern.includes("*")
    ? `SELECT * FROM beliefs WHERE domain LIKE ? ORDER BY weight DESC`
    : `SELECT * FROM beliefs WHERE domain = ? ORDER BY weight DESC`;
  const arg = pattern.replace(/\*/g, "%");
  const rows = db.prepare(sql).all(arg);
  console.log(`\n=== DOMAIN ${pattern} (${rows.length} beliefs) ===`);
  for (const b of rows) console.log(fmtBelief(b));
}

function showChanges(db, limit) {
  console.log(`\n=== LAST ${limit} CHANGES ===`);
  for (const c of recentChanges(db, { limit })) {
    const ref = c.source_ref ? ` ← ${c.source_ref}` : "";
    console.log(`  [${c.ts}] ${c.op.padEnd(15)} ${c.claim || `(belief #${c.belief_id})`}${ref}`);
    if (c.reason) console.log(`      reason: ${c.reason}`);
  }
}

function showFull(db) {
  showOverview(db);
  showChanges(db, 20);
}

function main() {
  const args = parseArgs(process.argv);
  const db = openDb();

  try {
    if (args.domain) {
      showDomain(db, args.domain);
    } else if (args.mode === "verdict") {
      showVerdict(db);
    } else if (args.mode === "changes") {
      showChanges(db, args.top);
    } else if (args.mode === "risky") {
      const risky = singleSourceRiskyBeliefs(db, { minWeight: 0.6, limit: args.top });
      console.log(`\n=== RISKY (single-source, weight≥0.6) — ${risky.length} ===`);
      for (const b of risky) console.log(fmtBelief(b));
    } else if (args.mode === "contradictions") {
      const c = activeContradictions(db, { limit: args.top });
      console.log(`\n=== CONTRADICTIONS — ${c.length} ===`);
      for (const b of c) console.log(fmtBelief(b));
    } else if (args.mode === "domains") {
      const d = listDomains(db);
      console.log(`\n=== ALL DOMAINS — ${d.length} ===`);
      for (const x of d) console.log(`  ${x.domain.padEnd(50)} count=${String(x.count).padEnd(4)} avg=${x.avg_weight.toFixed(2)}`);
    } else if (args.mode === "full") {
      showFull(db);
    } else {
      showOverview(db);
    }
  } finally {
    db.close();
  }
}

main();
