#!/usr/bin/env node
// organism/digest.mjs
// Produces a compact markdown summary of the organism's current state.
// This file is the bridge between the persistent organism and the ephemeral Claude session:
// when injected at session start, it gives Claude the organism's "memory" before the conversation begins.
//
// Output:
//   - written to .data/organism-digest.md (for hook injection)
//   - also printed to stdout (for ad-hoc inspection)

import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, totalBeliefs, claimAccuracyStats, listUnresolvedClaims, recentResolvedClaims, listSourceCredibility } from "./db.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolve(__dirname, "../..");
const OUT_PATH = resolve(PROJECT, ".data/organism-digest.md");

function fmtBelief(b, maxLen = 140) {
  const claim = b.claim.length > maxLen ? b.claim.slice(0, maxLen - 1) + "…" : b.claim;
  const tag = b.contradictions_count > 0 ? `[w=${b.weight.toFixed(2)} ✗${b.contradictions_count}]` : `[w=${b.weight.toFixed(2)}]`;
  return `- ${tag} ${claim}`;
}

function buildDigest(db) {
  const total = totalBeliefs(db);
  const totalOutcomes = db.prepare("SELECT COUNT(*) AS n FROM outcomes").get().n;
  const unprocessed = db.prepare("SELECT COUNT(*) AS n FROM outcomes WHERE processed_at IS NULL").get().n;
  const last24h = db.prepare(`
    SELECT COUNT(*) AS n FROM belief_log
    WHERE ts > datetime('now', '-1 day')
  `).get().n;

  const lines = [];
  lines.push(`# ORGANISM DIGEST`);
  lines.push(`_Generated ${new Date().toISOString()}_`);
  lines.push(``);
  lines.push(`This is the persistent state of the organism. Read it before responding — these are the beliefs and contradictions that survived all prior sessions. The graph IS the organism; you are its temporary larynx.`);
  lines.push(``);
  lines.push(`**Stats:** ${total} beliefs · ${totalOutcomes} outcomes (${unprocessed} unprocessed) · ${last24h} graph changes in last 24h`);
  lines.push(``);

  // Latest verdict
  const verdict = db.prepare(`
    SELECT * FROM beliefs
    WHERE domain LIKE 'verdict.%'
    ORDER BY last_updated DESC, weight DESC
    LIMIT 1
  `).get();

  if (verdict) {
    lines.push(`## Current strategic verdict`);
    lines.push(``);
    lines.push(`> ${verdict.claim}`);
    lines.push(`_(weight ${verdict.weight.toFixed(2)}, last updated ${verdict.last_updated})_`);

    const verdictLog = db.prepare(`
      SELECT after_json FROM belief_log
      WHERE belief_id = ? AND op = 'verdict'
      ORDER BY ts DESC LIMIT 1
    `).get(verdict.id);
    if (verdictLog?.after_json) {
      try {
        const parsed = JSON.parse(verdictLog.after_json);
        if (parsed.top_3_markets) {
          lines.push(``);
          lines.push(`**Top markets:** ${parsed.top_3_markets.join(" · ")}`);
        }
        if (parsed.rationale) {
          lines.push(``);
          lines.push(`**Rationale:** ${parsed.rationale}`);
        }
      } catch {}
    }
    lines.push(``);
  }

  // Top beliefs by weight
  const top = db.prepare(`
    SELECT * FROM beliefs ORDER BY weight DESC, sources_count DESC LIMIT 12
  `).all();
  if (top.length > 0) {
    lines.push(`## Strongest beliefs (top 12)`);
    lines.push(``);
    for (const b of top) lines.push(fmtBelief(b));
    lines.push(``);
  }

  // Active contradictions — most important to surface
  const contradictions = db.prepare(`
    SELECT * FROM beliefs
    WHERE contradictions_count > 0
    ORDER BY contradictions_count DESC, weight DESC
    LIMIT 8
  `).all();
  if (contradictions.length > 0) {
    lines.push(`## Active contradictions (these are unresolved tensions in the organism's worldview)`);
    lines.push(``);
    for (const b of contradictions) lines.push(fmtBelief(b));
    lines.push(``);
  }

  // Recent outcome-driven changes
  const recentOutcomeChanges = db.prepare(`
    SELECT l.ts, l.op, b.claim, l.reason
    FROM belief_log l
    JOIN beliefs b ON b.id = l.belief_id
    WHERE l.source_type = 'outcome'
    ORDER BY l.ts DESC LIMIT 8
  `).all();
  if (recentOutcomeChanges.length > 0) {
    lines.push(`## Recent learning from real outcomes`);
    lines.push(``);
    for (const c of recentOutcomeChanges) {
      const claim = c.claim.length > 110 ? c.claim.slice(0, 109) + "…" : c.claim;
      lines.push(`- **${c.op}**: ${claim}`);
      if (c.reason) {
        const reason = c.reason.length > 200 ? c.reason.slice(0, 199) + "…" : c.reason;
        lines.push(`  - _${reason}_`);
      }
    }
    lines.push(``);
  }

  // Recent new beliefs (created in last 7 days)
  const newBeliefs = db.prepare(`
    SELECT * FROM beliefs
    WHERE created_at > datetime('now', '-7 days') AND origin LIKE 'outcome%'
    ORDER BY created_at DESC LIMIT 6
  `).all();
  if (newBeliefs.length > 0) {
    lines.push(`## New beliefs derived from outcomes this week`);
    lines.push(``);
    for (const b of newBeliefs) lines.push(fmtBelief(b, 180));
    lines.push(``);
  }

  // Risky single-source high-weight beliefs
  const risky = db.prepare(`
    SELECT * FROM beliefs
    WHERE sources_count <= 1 AND weight >= 0.7
    ORDER BY weight DESC LIMIT 6
  `).all();
  if (risky.length > 0) {
    lines.push(`## High-confidence beliefs based on a single source (treat with caution; verify against reality before acting)`);
    lines.push(``);
    for (const b of risky) lines.push(fmtBelief(b));
    lines.push(``);
  }

  // Pending unprocessed outcomes
  if (unprocessed > 0) {
    const pending = db.prepare(`
      SELECT * FROM outcomes WHERE processed_at IS NULL ORDER BY observed_at ASC LIMIT 5
    `).all();
    lines.push(`## Outcomes waiting to be applied (run apply-outcomes-to-graph.mjs)`);
    lines.push(``);
    for (const o of pending) {
      const desc = o.description.length > 140 ? o.description.slice(0, 139) + "…" : o.description;
      lines.push(`- [${o.source_type}/${o.signal_type}] ${desc}`);
    }
    lines.push(``);
  }

  // Claude track record — what past-Claude said and whether it panned out
  const stats = claimAccuracyStats(db);
  if (stats.total > 0) {
    lines.push(`## Your track record (claims you logged in past sessions)`);
    lines.push(``);
    const resolvedSum = stats.confirmed + stats.contradicted;
    if (resolvedSum > 0) {
      const rate = (stats.confirmed / resolvedSum * 100).toFixed(0);
      lines.push(`Logged ${stats.total} claims, ${stats.resolved} resolved. Confirmation rate: **${rate}%** (${stats.confirmed} confirmed / ${stats.contradicted} contradicted)`);
    } else {
      lines.push(`Logged ${stats.total} claims, ${stats.resolved} resolved.`);
    }
    lines.push(``);

    const recentResolved = recentResolvedClaims(db, { limit: 5 });
    if (recentResolved.length > 0) {
      lines.push(`**Recently resolved:**`);
      for (const c of recentResolved) {
        const tag = c.resolution === "confirmed" ? "✓" : c.resolution === "contradicted" ? "✗" : "?";
        lines.push(`- ${tag} ${c.claim_text.slice(0, 130)}`);
        if (c.resolution_reason) lines.push(`  - _${c.resolution_reason.slice(0, 200)}_`);
      }
      lines.push(``);
    }

    const unresolved = listUnresolvedClaims(db, { limit: 5 });
    if (unresolved.length > 0) {
      lines.push(`**Still unresolved (you said these — outcomes haven't decided yet):**`);
      for (const c of unresolved) {
        lines.push(`- #${c.id} [${c.recorded_at.slice(0, 10)}] ${c.claim_text.slice(0, 130)}`);
      }
      lines.push(``);
    }
  }

  // Source credibility — which sources have proven trustworthy
  const cred = listSourceCredibility(db);
  if (cred.length > 0) {
    lines.push(`## Source credibility (which signals to trust most)`);
    lines.push(``);
    for (const s of cred) {
      const total = s.confirms_count + s.contradicts_count;
      if (total === 0) continue;
      const tag = s.credibility >= 0.65 ? "🟢" : s.credibility >= 0.45 ? "🟡" : "🔴";
      lines.push(`- ${tag} **${s.source_type}** credibility ${s.credibility.toFixed(2)} (${s.confirms_count}+ / ${s.contradicts_count}-, total ${s.total_outcomes})`);
    }
    lines.push(``);
  }

  lines.push(`---`);
  lines.push(`_Inspect more: \`node scripts/organism/inspect.mjs\`_`);
  lines.push(`_Add outcome: \`node scripts/organism/record-outcome.mjs --stdin\`_`);
  lines.push(`_Log a claim: \`node scripts/organism/record-claim.mjs --claim="..." --domain="..."\`_`);
  lines.push(`_See your track record: \`node scripts/organism/record-claim.mjs --list\`_`);
  lines.push(`_Apply pending outcomes: \`node scripts/organism/apply-outcomes-to-graph.mjs\`_`);
  lines.push(`_Run full pulse (all adapters + apply + digest regen): \`bash scripts/organism/organism-pulse.sh\`_`);

  return lines.join("\n");
}

function main() {
  const db = openDb();
  const md = buildDigest(db);
  writeFileSync(OUT_PATH, md);
  console.log(md);
  console.error(`\n[digest] written to ${OUT_PATH}`);
  db.close();
}

main();
