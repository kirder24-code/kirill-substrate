#!/usr/bin/env node
// organism/dashboard.mjs
// Renders organism state as a static HTML page. Re-runs cheap (pure SQL).
// Output: .data/organism-dashboard.html — open in browser, refresh to see new state.
//
// Wired into pulse so it regenerates after each cycle.

import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, totalBeliefs, totalOutcomes, listSourceCredibility, claimAccuracyStats } from "./db.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolve(__dirname, "../..");
const OUT_PATH = resolve(PROJECT, ".data/organism-dashboard.html");

function escapeHtml(s) {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function buildHtml(db) {
  const beliefs = totalBeliefs(db);
  const outcomes = totalOutcomes(db);
  const unprocessed = db.prepare("SELECT COUNT(*) AS n FROM outcomes WHERE processed_at IS NULL").get().n;
  const claims = claimAccuracyStats(db);
  const sources = listSourceCredibility(db);

  const verdict = db.prepare(`SELECT * FROM beliefs WHERE domain LIKE 'verdict.%' ORDER BY last_updated DESC LIMIT 1`).get();
  let verdictDetail = null;
  if (verdict) {
    const log = db.prepare(`SELECT after_json FROM belief_log WHERE belief_id = ? AND op = 'verdict' ORDER BY ts DESC LIMIT 1`).get(verdict.id);
    if (log?.after_json) {
      try { verdictDetail = JSON.parse(log.after_json); } catch {}
    }
  }

  const topBeliefs = db.prepare(`
    SELECT * FROM beliefs ORDER BY weight DESC, sources_count DESC LIMIT 30
  `).all();

  const contradictions = db.prepare(`
    SELECT * FROM beliefs WHERE contradictions_count > 0 ORDER BY contradictions_count DESC LIMIT 10
  `).all();

  const newBeliefs = db.prepare(`
    SELECT * FROM beliefs WHERE created_at > datetime('now', '-7 days') AND origin LIKE 'outcome%' ORDER BY created_at DESC LIMIT 15
  `).all();

  const recentChanges = db.prepare(`
    SELECT l.*, b.claim FROM belief_log l LEFT JOIN beliefs b ON b.id = l.belief_id
    WHERE l.source_type = 'outcome'
    ORDER BY l.ts DESC LIMIT 25
  `).all();

  const unresolvedClaims = db.prepare(`SELECT * FROM claims WHERE resolved_at IS NULL ORDER BY recorded_at DESC LIMIT 10`).all();
  const resolvedClaims = db.prepare(`SELECT * FROM claims WHERE resolved_at IS NOT NULL ORDER BY resolved_at DESC LIMIT 10`).all();

  const generatedAt = new Date().toISOString();

  const verdictBlock = !verdict ? "<p>(no verdict yet — run bootstrap)</p>" : `
    <div class="verdict-box">
      <h3>Strategic verdict</h3>
      <p class="verdict-claim">${escapeHtml(verdict.claim)}</p>
      ${verdictDetail?.top_3_markets ? `<p><strong>Top 3:</strong> ${verdictDetail.top_3_markets.map(m => `<span class="badge">${escapeHtml(m)}</span>`).join(" ")}</p>` : ""}
      ${verdictDetail?.rationale ? `<p class="rationale">${escapeHtml(verdictDetail.rationale)}</p>` : ""}
      <p class="meta">weight ${verdict.weight.toFixed(2)} · last_updated ${verdict.last_updated}</p>
    </div>
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Organism — ${beliefs} beliefs · ${outcomes} outcomes</title>
  <meta http-equiv="refresh" content="120">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; line-height: 1.5; max-width: 1100px; margin: 0 auto; padding: 24px; background: #0d1117; color: #c9d1d9; }
    h1 { color: #58a6ff; border-bottom: 1px solid #30363d; padding-bottom: 8px; }
    h2 { color: #58a6ff; margin-top: 32px; border-bottom: 1px solid #21262d; padding-bottom: 4px; }
    h3 { color: #8b949e; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin: 16px 0; }
    .stat { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 12px; }
    .stat .label { font-size: 11px; color: #8b949e; text-transform: uppercase; letter-spacing: 0.5px; }
    .stat .value { font-size: 28px; font-weight: 600; color: #c9d1d9; margin-top: 4px; }
    .verdict-box { background: #161b22; border: 1px solid #30363d; border-left: 3px solid #58a6ff; padding: 16px; border-radius: 6px; margin: 16px 0; }
    .verdict-claim { font-weight: 500; color: #c9d1d9; }
    .badge { display: inline-block; background: #1f6feb; color: white; padding: 4px 10px; border-radius: 12px; margin-right: 6px; font-size: 13px; font-weight: 500; }
    .rationale { color: #8b949e; font-size: 14px; margin-top: 8px; line-height: 1.6; }
    .meta { font-size: 11px; color: #6e7681; margin-top: 6px; }
    table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 13px; }
    th { text-align: left; padding: 6px 8px; color: #8b949e; font-weight: 500; border-bottom: 1px solid #30363d; }
    td { padding: 6px 8px; border-bottom: 1px solid #21262d; vertical-align: top; }
    tr:hover td { background: #161b22; }
    .w-bar { display: inline-block; width: 50px; height: 8px; background: #30363d; border-radius: 2px; overflow: hidden; vertical-align: middle; margin-right: 6px; }
    .w-fill { height: 100%; background: #58a6ff; }
    .green { color: #3fb950; }
    .yellow { color: #d29922; }
    .red { color: #f85149; }
    .domain { color: #6e7681; font-size: 11px; }
    .claim-text { color: #c9d1d9; }
    .x { color: #f85149; }
    .updated { color: #6e7681; font-size: 11px; }
  </style>
</head>
<body>
  <h1>🧬 Organism</h1>
  <p class="updated">Generated ${generatedAt} · auto-refreshes every 2min · backed by .data/organism.db</p>

  <div class="stats">
    <div class="stat"><div class="label">Beliefs</div><div class="value">${beliefs}</div></div>
    <div class="stat"><div class="label">Outcomes</div><div class="value">${outcomes}</div></div>
    <div class="stat"><div class="label">Unprocessed</div><div class="value">${unprocessed}</div></div>
    <div class="stat"><div class="label">Claims logged</div><div class="value">${claims.total}</div></div>
    <div class="stat"><div class="label">Sources</div><div class="value">${sources.length}</div></div>
    <div class="stat"><div class="label">Active contradictions</div><div class="value">${contradictions.length}</div></div>
  </div>

  ${verdictBlock}

  <h2>Top beliefs by weight</h2>
  <table>
    <thead><tr><th>Weight</th><th>Sources</th><th>Claim</th></tr></thead>
    <tbody>
      ${topBeliefs.map(b => `
        <tr>
          <td><span class="w-bar"><span class="w-fill" style="width:${(b.weight * 100).toFixed(0)}%"></span></span>${b.weight.toFixed(2)}</td>
          <td>${b.sources_count}${b.contradictions_count ? `<span class="x"> ✗${b.contradictions_count}</span>` : ""}</td>
          <td><span class="claim-text">${escapeHtml(b.claim)}</span><br><span class="domain">${escapeHtml(b.domain || "—")}</span></td>
        </tr>
      `).join("")}
    </tbody>
  </table>

  <h2>Source credibility</h2>
  <table>
    <thead><tr><th>Source</th><th>Credibility</th><th>Confirms</th><th>Contradicts</th><th>Outcomes</th></tr></thead>
    <tbody>
      ${sources.map(s => {
        const cls = s.credibility >= 0.65 ? "green" : s.credibility >= 0.45 ? "yellow" : "red";
        return `<tr>
          <td>${escapeHtml(s.source_type)}</td>
          <td class="${cls}">${s.credibility.toFixed(2)}</td>
          <td>${s.confirms_count}</td>
          <td>${s.contradicts_count}</td>
          <td>${s.total_outcomes}</td>
        </tr>`;
      }).join("")}
    </tbody>
  </table>

  ${contradictions.length > 0 ? `
  <h2>Active contradictions</h2>
  <table>
    <thead><tr><th>Weight</th><th>Contradictions</th><th>Claim</th></tr></thead>
    <tbody>
      ${contradictions.map(b => `
        <tr>
          <td>${b.weight.toFixed(2)}</td>
          <td class="x">✗${b.contradictions_count}</td>
          <td><span class="claim-text">${escapeHtml(b.claim)}</span><br><span class="domain">${escapeHtml(b.domain || "—")}</span></td>
        </tr>
      `).join("")}
    </tbody>
  </table>
  ` : ""}

  ${newBeliefs.length > 0 ? `
  <h2>New beliefs this week (derived from outcomes)</h2>
  <table>
    <thead><tr><th>Weight</th><th>Created</th><th>Claim</th></tr></thead>
    <tbody>
      ${newBeliefs.map(b => `
        <tr>
          <td>${b.weight.toFixed(2)}</td>
          <td class="updated">${b.created_at?.slice(5, 16)}</td>
          <td><span class="claim-text">${escapeHtml(b.claim)}</span><br><span class="domain">${escapeHtml(b.domain || "—")}</span></td>
        </tr>
      `).join("")}
    </tbody>
  </table>
  ` : ""}

  <h2>Recent learning from real outcomes</h2>
  <table>
    <thead><tr><th>When</th><th>Op</th><th>Belief touched</th></tr></thead>
    <tbody>
      ${recentChanges.map(c => `
        <tr>
          <td class="updated">${c.ts?.slice(5, 16)}</td>
          <td>${escapeHtml(c.op)}</td>
          <td>${escapeHtml((c.claim || "").slice(0, 200))}</td>
        </tr>
      `).join("")}
    </tbody>
  </table>

  ${unresolvedClaims.length > 0 || resolvedClaims.length > 0 ? `
  <h2>Claude's track record</h2>
  <p>Confirmed: ${claims.confirmed} · Contradicted: ${claims.contradicted} · Resolved: ${claims.resolved} / ${claims.total}</p>
  ${resolvedClaims.length > 0 ? `
    <h3>Recently resolved</h3>
    <ul>
      ${resolvedClaims.map(c => `
        <li class="${c.resolution === 'confirmed' ? 'green' : c.resolution === 'contradicted' ? 'red' : ''}">
          ${c.resolution === 'confirmed' ? '✓' : c.resolution === 'contradicted' ? '✗' : '?'} ${escapeHtml(c.claim_text)}
          ${c.resolution_reason ? `<br><span class="updated">${escapeHtml(c.resolution_reason.slice(0, 200))}</span>` : ""}
        </li>
      `).join("")}
    </ul>
  ` : ""}
  ${unresolvedClaims.length > 0 ? `
    <h3>Still unresolved</h3>
    <ul>
      ${unresolvedClaims.map(c => `<li>${escapeHtml(c.claim_text)} <span class="updated">[${c.recorded_at?.slice(0, 16)}]</span></li>`).join("")}
    </ul>
  ` : ""}
  ` : ""}

</body>
</html>`;
}

function main() {
  const db = openDb();
  const html = buildHtml(db);
  writeFileSync(OUT_PATH, html);
  console.log(`[dashboard] wrote ${OUT_PATH} (${html.length} chars)`);
  console.log(`[dashboard] open in browser: file://${OUT_PATH}`);
  db.close();
}

main();
