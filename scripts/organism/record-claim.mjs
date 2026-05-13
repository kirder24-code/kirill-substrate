#!/usr/bin/env node
// organism/record-claim.mjs
// Claude logs an assertion here when it states something with confidence in conversation.
// Later-Claude reads its own track record at session start and sees whether past assertions
// panned out. This is how the larynx learns about its own reliability across sessions.
//
// Usage:
//   node scripts/organism/record-claim.mjs \
//     --claim="Cold email US SaaS will yield ~0% reply" \
//     --context="said in conversation 2026-04-29 while planning outreach strategy" \
//     --domain="operational.outreach.coldemail" \
//     --weight=0.75
//
//   echo '{"claim_text":"X","context":"Y"}' | node scripts/organism/record-claim.mjs --stdin
//
// To list unresolved:
//   node scripts/organism/record-claim.mjs --list
//
// To resolve a specific claim manually:
//   node scripts/organism/record-claim.mjs --resolve=42 --as=confirmed --reason="real outcome matched"

import { openDb, recordClaim, listUnresolvedClaims, resolveClaim, recentResolvedClaims, claimAccuracyStats } from "./db.mjs";

function parseFlags(argv) {
  const out = {};
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
    else if (a.startsWith("--")) out[a.slice(2)] = true;
  }
  return out;
}

async function readStdin() {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data.trim();
}

async function main() {
  const flags = parseFlags(process.argv);
  const db = openDb();

  if (flags.list) {
    const stats = claimAccuracyStats(db);
    const unresolved = listUnresolvedClaims(db, { limit: 100 });
    const resolved = recentResolvedClaims(db, { limit: 10 });

    console.log(`\n=== CLAUDE'S TRACK RECORD ===`);
    console.log(`Total: ${stats.total} | Resolved: ${stats.resolved} | Confirmed: ${stats.confirmed} | Contradicted: ${stats.contradicted}`);
    if (stats.confirmed + stats.contradicted > 0) {
      const rate = (stats.confirmed / (stats.confirmed + stats.contradicted) * 100).toFixed(1);
      console.log(`Confirmation rate: ${rate}%`);
    }

    if (unresolved.length > 0) {
      console.log(`\n--- Unresolved (${unresolved.length}) ---`);
      for (const c of unresolved.slice(0, 20)) {
        console.log(`  #${c.id} [${c.recorded_at}] ${c.claim_text.slice(0, 120)}`);
        if (c.context) console.log(`     ctx: ${c.context.slice(0, 80)}`);
      }
    }

    if (resolved.length > 0) {
      console.log(`\n--- Recently resolved ---`);
      for (const c of resolved) {
        const tag = c.resolution === "confirmed" ? "✓" : c.resolution === "contradicted" ? "✗" : "?";
        console.log(`  ${tag} #${c.id} ${c.claim_text.slice(0, 100)}`);
        if (c.resolution_reason) console.log(`     ${c.resolution_reason.slice(0, 120)}`);
      }
    }
    db.close();
    return;
  }

  if (flags.resolve) {
    const id = parseInt(flags.resolve, 10);
    if (!flags.as) {
      console.error("--resolve requires --as=confirmed|contradicted|inconclusive");
      process.exit(1);
    }
    resolveClaim(db, id, {
      resolution: flags.as,
      reason: flags.reason || null,
      outcome_id: flags.outcome ? parseInt(flags.outcome, 10) : null,
    });
    console.log(`[record-claim] resolved #${id} as ${flags.as}`);
    db.close();
    return;
  }

  let claims = [];
  if (flags.stdin) {
    const raw = await readStdin();
    if (!raw) { console.error("--stdin given but no input"); process.exit(1); }
    const parsed = JSON.parse(raw);
    claims = Array.isArray(parsed) ? parsed : [parsed];
  } else {
    if (!flags.claim) {
      console.error("Usage: --claim='...' [--context='...'] [--domain='...'] [--weight=N]");
      console.error("Or:    --list  |  --resolve=ID --as=confirmed|contradicted [--reason='...']");
      process.exit(1);
    }
    claims.push({
      claim_text: flags.claim,
      context: flags.context,
      domain: flags.domain,
      asserted_weight: flags.weight ? Number(flags.weight) : null,
      session_marker: flags.session || null,
    });
  }

  for (const c of claims) {
    if (!c.claim_text) continue;
    const id = recordClaim(db, c);
    console.log(`[record-claim] #${id} <- ${c.claim_text.slice(0, 100)}`);
  }
  db.close();
}

main().catch((e) => { console.error("[record-claim] FAILED:", e.message); process.exit(1); });
