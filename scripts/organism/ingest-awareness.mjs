#!/usr/bin/env node
// organism/ingest-awareness.mjs
// Adapter: turns awareness-bot daily briefs into outcomes the organism can learn from.
//
// What it ingests from .data/awareness/history/*.md:
//   - Per-day stats (fetched / accepted / flagged / rejected) -> outcomes about market intel signal density
//   - Each ACCEPTED item -> an outcome (organic signal that something was deemed actionable)
//   - Each FLAGGED item -> a softer outcome (something interesting but not urgent)
//
// Idempotent: each outcome includes a deterministic source_ref like "awareness/2026-04-28/accepted-1"
// and we skip if an outcome with that ref already exists.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, recordOutcome, totalOutcomes } from "./db.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolve(__dirname, "../..");
const HISTORY_DIR = resolve(PROJECT, ".data/awareness/history");
const LATEST_PATH = resolve(PROJECT, ".data/awareness/latest.md");

function parseFlags(argv) {
  const out = { since: null, limit: 0, dryRun: false };
  for (const a of argv.slice(2)) {
    if (a.startsWith("--since=")) out.since = a.slice(8);
    else if (a.startsWith("--limit=")) out.limit = parseInt(a.slice(8), 10) || 0;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--latest") out.latestOnly = true;
  }
  return out;
}

function existsOutcomeWithRef(db, source_ref) {
  const r = db.prepare("SELECT id FROM outcomes WHERE source_ref = ? LIMIT 1").get(source_ref);
  return !!r;
}

function parseBriefStats(text) {
  // From "## Summary" block:
  //   - Fetched: 777
  //   - ACCEPTED: 2
  //   - FLAGGED: 11
  //   - REJECTED: 140
  const grab = (k) => {
    const m = text.match(new RegExp(`-\\s+${k}[^:]*:\\s*(\\d+)`, "i"));
    return m ? parseInt(m[1], 10) : null;
  };
  return {
    fetched: grab("Fetched"),
    poisoned: grab("Poisoned"),
    relevance_passed: grab("Passed relevance"),
    deduped: grab("Already seen"),
    evaluated: grab("Evaluated by Claude"),
    accepted: grab("ACCEPTED"),
    flagged: grab("FLAGGED"),
    rejected: grab("REJECTED"),
  };
}

function parseAcceptedItems(text) {
  // Each item is a "### N. [score/20] title" block under "## ACCEPTED"
  const acceptedBlock = text.split(/^## ACCEPTED.*$/m)[1];
  if (!acceptedBlock) return [];
  const flaggedSplit = acceptedBlock.split(/^## FLAGGED/m)[0];
  const items = [];
  const blocks = flaggedSplit.split(/^### \d+\.\s*/m).filter(Boolean);
  for (const block of blocks) {
    const titleMatch = block.match(/^\[(\d+)\/20\]\s+(.+?)$/m);
    const summaryMatch = block.match(/\*\*Summary:\*\*\s+(.+?)(?:\n|$)/);
    const urlMatch = block.match(/\*\*URL:\*\*\s+(\S+)/);
    const categoryMatch = block.match(/\*\*Category:\*\*\s+(.+?)(?:\n|$)/);
    if (!titleMatch) continue;
    items.push({
      score: parseInt(titleMatch[1], 10),
      title: titleMatch[2].trim(),
      summary: summaryMatch?.[1]?.trim(),
      url: urlMatch?.[1],
      category: categoryMatch?.[1]?.trim(),
    });
  }
  return items;
}

function parseFlaggedItems(text) {
  // FLAGGED items appear as "1. [score/20] title - description (url)"
  const flaggedBlock = text.split(/^## FLAGGED/m)[1];
  if (!flaggedBlock) return [];
  const items = [];
  const lines = flaggedBlock.split("\n");
  for (const line of lines) {
    const m = line.match(/^\d+\.\s*\[(\d+)\/20\]\s+(.+?)\s+-\s+(.+?)\s+\((https?:\/\/\S+)\)/);
    if (m) {
      items.push({
        score: parseInt(m[1], 10),
        title: m[2].trim(),
        summary: m[3].trim(),
        url: m[4],
      });
    }
  }
  return items;
}

function ingestBrief(db, filePath, dateLabel, dryRun) {
  const text = readFileSync(filePath, "utf-8");
  const stats = parseBriefStats(text);
  const accepted = parseAcceptedItems(text);
  const flagged = parseFlaggedItems(text);
  let inserted = 0;
  let skipped = 0;

  // Stats outcome — one per day
  if (stats.fetched != null && stats.evaluated != null) {
    const ref = `awareness/${dateLabel}/stats`;
    if (existsOutcomeWithRef(db, ref)) {
      skipped++;
    } else {
      const acceptanceRate = stats.evaluated > 0 ? (stats.accepted ?? 0) / stats.evaluated : 0;
      const desc = `Awareness brief ${dateLabel}: fetched ${stats.fetched}, evaluated ${stats.evaluated}, accepted ${stats.accepted ?? 0}, flagged ${stats.flagged ?? 0}, rejected ${stats.rejected ?? 0}. Acceptance rate ${(acceptanceRate * 100).toFixed(2)}%.`;
      if (!dryRun) {
        recordOutcome(db, {
          source_type: "awareness_brief",
          source_ref: ref,
          signal_type: "intel_density",
          signal_value: acceptanceRate,
          description: desc,
          related_action_type: "awareness_scan",
          related_target: "global_intel",
          observed_at: `${dateLabel} 23:59:00`,
          meta: stats,
        });
      }
      inserted++;
    }
  }

  // Each ACCEPTED item is its own outcome — actionable signal
  for (let i = 0; i < accepted.length; i++) {
    const item = accepted[i];
    const ref = `awareness/${dateLabel}/accepted-${i + 1}`;
    if (existsOutcomeWithRef(db, ref)) { skipped++; continue; }
    const desc = `Awareness ACCEPTED [${item.score}/20] (${dateLabel}, ${item.category || "uncategorized"}): ${item.title}. ${item.summary || ""}`.slice(0, 1500);
    if (!dryRun) {
      recordOutcome(db, {
        source_type: "awareness_accepted",
        source_ref: ref,
        signal_type: "actionable_signal",
        signal_value: item.score / 20,
        description: desc,
        related_action_type: "awareness_scan",
        related_target: item.category || "uncategorized",
        observed_at: `${dateLabel} 12:00:00`,
        meta: { url: item.url, score: item.score, category: item.category },
      });
    }
    inserted++;
  }

  // FLAGGED items — softer signal
  for (let i = 0; i < flagged.length; i++) {
    const item = flagged[i];
    const ref = `awareness/${dateLabel}/flagged-${i + 1}`;
    if (existsOutcomeWithRef(db, ref)) { skipped++; continue; }
    const desc = `Awareness FLAGGED [${item.score}/20] (${dateLabel}): ${item.title}. ${item.summary || ""}`.slice(0, 1200);
    if (!dryRun) {
      recordOutcome(db, {
        source_type: "awareness_flagged",
        source_ref: ref,
        signal_type: "soft_signal",
        signal_value: item.score / 20,
        description: desc,
        related_action_type: "awareness_scan",
        related_target: "manual_review_queue",
        observed_at: `${dateLabel} 12:00:00`,
        meta: { url: item.url, score: item.score },
      });
    }
    inserted++;
  }

  return { inserted, skipped, accepted: accepted.length, flagged: flagged.length };
}

function main() {
  const flags = parseFlags(process.argv);
  const db = openDb();
  const before = totalOutcomes(db);

  let files = [];
  if (flags.latestOnly) {
    if (existsSync(LATEST_PATH)) files = [{ path: LATEST_PATH, label: new Date().toISOString().slice(0, 10) }];
  } else {
    if (!existsSync(HISTORY_DIR)) {
      console.error(`[ingest-awareness] history dir not found: ${HISTORY_DIR}`);
      process.exit(1);
    }
    const all = readdirSync(HISTORY_DIR)
      .filter((n) => n.endsWith(".md"))
      .map((n) => ({ path: resolve(HISTORY_DIR, n), label: n.replace(/\.md$/, "") }))
      .sort((a, b) => a.label.localeCompare(b.label));

    files = flags.since
      ? all.filter((f) => f.label >= flags.since)
      : all;

    if (flags.limit) files = files.slice(-flags.limit);
  }

  console.log(`[ingest-awareness] processing ${files.length} brief(s)`);
  const tx = db.transaction(() => {
    for (const f of files) {
      const r = ingestBrief(db, f.path, f.label, flags.dryRun);
      console.log(`[ingest-awareness] ${f.label}: +${r.inserted} (skipped existing: ${r.skipped})  [accepted=${r.accepted}, flagged=${r.flagged}]`);
    }
  });
  tx();

  const after = totalOutcomes(db);
  console.log(`[ingest-awareness] outcomes: ${before} -> ${after} (delta +${after - before})`);
  console.log(`[ingest-awareness] run 'node scripts/organism/apply-outcomes-to-graph.mjs' to apply them.`);
  db.close();
}

main();
