#!/usr/bin/env node
// organism/morning-report.mjs
// Produces a "what happened overnight" summary and sends to Kirill via Telegram.
// Compares state now vs N hours ago.

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, totalBeliefs, totalOutcomes, listSourceCredibility, claimAccuracyStats, variantScoreboard } from "./db.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolve(__dirname, "../..");
const STATE_FILE = resolve(PROJECT, ".data/organism-morning-report-state.json");

function loadPrev() {
  if (!existsSync(STATE_FILE)) return null;
  try { return JSON.parse(readFileSync(STATE_FILE, "utf-8")); } catch { return null; }
}

function saveCurrent(snap) {
  writeFileSync(STATE_FILE, JSON.stringify(snap, null, 2));
}

function buildSnap(db) {
  return {
    at: new Date().toISOString(),
    beliefs: totalBeliefs(db),
    outcomes: totalOutcomes(db),
    unprocessed: db.prepare("SELECT COUNT(*) AS n FROM outcomes WHERE processed_at IS NULL").get().n,
    pending_proposals: db.prepare("SELECT COUNT(*) AS n FROM action_proposals WHERE status = 'pending'").get().n,
    pending_sensors: db.prepare("SELECT COUNT(*) AS n FROM sensor_proposals WHERE status = 'pending'").get().n,
    variant_predictions: db.prepare("SELECT COUNT(*) AS n FROM variant_predictions").get().n,
    snapshots: db.prepare("SELECT COUNT(*) AS n FROM belief_snapshots").get().n,
    log_entries: db.prepare("SELECT COUNT(*) AS n FROM belief_log").get().n,
  };
}

function buildReport(db, prev, current) {
  const lines = [];
  lines.push(`<b>📊 Утренний отчёт</b>`);
  lines.push(`<i>${new Date().toISOString().slice(0, 19).replace("T", " ")}</i>\n`);

  if (prev) {
    const dh = ((new Date(current.at).getTime() - new Date(prev.at).getTime()) / 3600000).toFixed(1);
    lines.push(`<b>За последние ${dh}ч:</b>`);
    lines.push(`• beliefs: ${prev.beliefs} → ${current.beliefs} (+${current.beliefs - prev.beliefs})`);
    lines.push(`• outcomes: ${prev.outcomes} → ${current.outcomes} (+${current.outcomes - prev.outcomes}, обработано ${current.outcomes - current.unprocessed - (prev.outcomes - prev.unprocessed)})`);
    lines.push(`• graph changes (log): +${current.log_entries - prev.log_entries}`);
    lines.push(`• новых action-предложений: ${current.pending_proposals - prev.pending_proposals >= 0 ? "+" : ""}${current.pending_proposals - prev.pending_proposals}`);
    lines.push(``);
  } else {
    lines.push(`<b>Текущее состояние:</b>`);
    lines.push(`• beliefs: ${current.beliefs} • outcomes: ${current.outcomes} (${current.unprocessed} unprocessed)`);
    lines.push(`• pending action proposals: ${current.pending_proposals}`);
    lines.push(`• pending sensor proposals: ${current.pending_sensors}`);
    lines.push(``);
  }

  // New beliefs derived from outcomes overnight
  const newBeliefs = db.prepare(`
    SELECT b.claim, b.weight, b.domain
    FROM beliefs b
    WHERE b.created_at > datetime('now', '-12 hours')
      AND b.origin LIKE 'outcome%'
    ORDER BY b.weight DESC LIMIT 6
  `).all();
  if (newBeliefs.length > 0) {
    lines.push(`<b>Что новое узнал за ночь:</b>`);
    for (const b of newBeliefs) {
      lines.push(`• [${b.weight.toFixed(2)}] ${b.claim.slice(0, 200)}`);
    }
    lines.push(``);
  }

  // Top weight changes (rising / falling)
  const recentChanges = db.prepare(`
    SELECT b.claim, b.weight, l.before_json, l.after_json, l.op, l.ts
    FROM belief_log l
    JOIN beliefs b ON b.id = l.belief_id
    WHERE l.ts > datetime('now', '-12 hours') AND l.op IN ('weight_update', 'confirm', 'contradiction')
    ORDER BY l.ts DESC LIMIT 25
  `).all();
  if (recentChanges.length > 0) {
    // Aggregate biggest weight movers
    const movers = new Map();
    for (const c of recentChanges) {
      try {
        const before = c.before_json ? JSON.parse(c.before_json) : null;
        const after = c.after_json ? JSON.parse(c.after_json) : null;
        if (!before?.weight || !after?.weight) continue;
        const delta = Math.abs(after.weight - before.weight);
        if (!movers.has(c.claim) || movers.get(c.claim).delta < delta) {
          movers.set(c.claim, { delta, before: before.weight, after: after.weight, op: c.op });
        }
      } catch {}
    }
    const sorted = [...movers.entries()].sort((a, b) => b[1].delta - a[1].delta).slice(0, 5);
    if (sorted.length > 0) {
      lines.push(`<b>Самые большие сдвиги весов:</b>`);
      for (const [claim, m] of sorted) {
        const arrow = m.after > m.before ? "↑" : "↓";
        lines.push(`• ${arrow} ${m.before.toFixed(2)}→${m.after.toFixed(2)} ${claim.slice(0, 130)}`);
      }
      lines.push(``);
    }
  }

  // Source credibility leaders
  const sources = listSourceCredibility(db).slice(0, 5);
  if (sources.length > 0) {
    lines.push(`<b>Топ источников по доверию:</b>`);
    for (const s of sources) {
      const tag = s.credibility >= 0.7 ? "🟢" : s.credibility >= 0.5 ? "🟡" : "🔴";
      lines.push(`${tag} ${s.source_type} ${s.credibility.toFixed(2)} (${s.confirms_count}+ / ${s.contradicts_count}-)`);
    }
    lines.push(``);
  }

  // Pending action proposals
  const proposals = db.prepare(`SELECT id, action_type, target, confidence FROM action_proposals WHERE status = 'pending' ORDER BY confidence DESC LIMIT 5`).all();
  if (proposals.length > 0) {
    lines.push(`<b>Ждут твоего решения (${proposals.length} пред-ложений):</b>`);
    for (const p of proposals) {
      lines.push(`• #${p.id} [${p.confidence.toFixed(2)}] ${p.action_type}: ${p.target.slice(0, 100)}`);
    }
    lines.push(`<i>Ответь "approve N" или "reject N причина"</i>`);
    lines.push(``);
  }

  // Pending sensor proposals
  const sensors = db.prepare(`SELECT id, sensor_name FROM sensor_proposals WHERE status = 'pending' ORDER BY proposed_at DESC LIMIT 3`).all();
  if (sensors.length > 0) {
    lines.push(`<b>Слепые пятна — предлагаю сенсоры:</b>`);
    for (const s of sensors) {
      lines.push(`• #${s.id} ${s.sensor_name}`);
    }
    lines.push(``);
  }

  // Variant scoreboard (will be empty until predictions resolve)
  const board = variantScoreboard(db);
  if (board.length > 0 && board.some(v => v.resolved > 0)) {
    lines.push(`<b>Variants scoreboard:</b>`);
    for (const v of board) {
      const rate = v.resolved > 0 ? `${(v.confirmed / v.resolved * 100).toFixed(0)}%` : "—";
      lines.push(`• ${v.variant}: ${v.confirmed}/${v.resolved} resolved = ${rate}`);
    }
    lines.push(``);
  }

  lines.push(`<i>Полная картина: dashboard → file://$CLAUDE_PROJECT_DIR/.data/organism-dashboard.html</i>`);

  return lines.join("\n");
}

function main() {
  const db = openDb();
  const prev = loadPrev();
  const current = buildSnap(db);
  const report = buildReport(db, prev, current);

  const speakScript = resolve(__dirname, "organism-telegram.mjs");
  const r = spawnSync("node", [speakScript, "speak-stdin"], { input: report, encoding: "utf-8" });
  if (r.status === 0) {
    console.log(`[morning-report] sent ${report.length} chars to Kirill`);
    saveCurrent(current);
  } else {
    console.error(`[morning-report] send failed: ${r.stdout || r.stderr}`);
  }
  db.close();
}

main();
