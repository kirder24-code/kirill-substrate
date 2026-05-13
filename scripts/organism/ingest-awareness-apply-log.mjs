#!/usr/bin/env node
// organism/ingest-awareness-apply-log.mjs
// Adapter: turns .data/awareness-apply-log.json into outcomes.
// Each "applied" entry is an outcome — the system tried to act on a piece of intel,
// and the result tells us whether automated awareness application is producing
// real changes or just noise (e.g., "Reached max turns" is a failure signal).
//
// Idempotent via deterministic source_ref derived from timestamp + title.

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { openDb, recordOutcome, totalOutcomes } from "./db.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolve(__dirname, "../..");
const LOG_PATH = resolve(PROJECT, ".data/awareness-apply-log.json");

function parseFlags(argv) {
  const out = { dryRun: false };
  for (const a of argv.slice(2)) {
    if (a === "--dry-run") out.dryRun = true;
  }
  return out;
}

function existsOutcomeWithRef(db, source_ref) {
  return !!db.prepare("SELECT id FROM outcomes WHERE source_ref = ? LIMIT 1").get(source_ref);
}

function makeRef(item) {
  const h = createHash("sha1")
    .update(`${item.timestamp || ""}|${item.title || ""}|${item.action_target || ""}`)
    .digest("hex")
    .slice(0, 12);
  return `awareness_apply/${h}`;
}

function classifyResult(result) {
  if (!result || typeof result !== "string") return { signal_type: "unknown", value: 0.0 };
  const r = result.toLowerCase();
  if (r.includes("reached max turns")) return { signal_type: "exec_failure_max_turns", value: 0.0 };
  if (r.startsWith("error") || r.includes("failed") || r.includes("error:")) return { signal_type: "exec_failure", value: 0.1 };
  if (r.includes("added") || r.includes("updated") || r.includes("changed") || r.includes("modified")) return { signal_type: "exec_success", value: 0.7 };
  if (r.includes("nothing") || r.includes("no changes")) return { signal_type: "exec_noop", value: 0.3 };
  return { signal_type: "exec_unknown", value: 0.4 };
}

function ingest(db, dryRun) {
  if (!existsSync(LOG_PATH)) {
    console.error(`[apply-log] not found: ${LOG_PATH}`);
    process.exit(1);
  }
  const raw = readFileSync(LOG_PATH, "utf-8");
  const log = JSON.parse(raw);
  if (!Array.isArray(log)) {
    console.error("[apply-log] expected an array");
    process.exit(1);
  }

  let inserted = 0, skipped = 0;
  for (const day of log) {
    const items = day.items || [];
    for (const item of items) {
      const ref = makeRef(item);
      if (existsOutcomeWithRef(db, ref)) { skipped++; continue; }

      const cls = classifyResult(item.result);
      const desc = `Awareness auto-apply attempt: "${(item.title || "untitled").slice(0, 100)}" -> action_type=${item.action_type || "n/a"}, target=${item.action_target || "n/a"}. Result: ${(item.result || "(no result)").slice(0, 400)}`;

      if (!dryRun) {
        recordOutcome(db, {
          source_type: "awareness_apply_log",
          source_ref: ref,
          signal_type: cls.signal_type,
          signal_value: cls.value,
          description: desc,
          related_action_type: item.action_type || "awareness_auto_apply",
          related_target: item.action_target || "global",
          observed_at: item.timestamp || day.date,
          meta: { day_date: day.date, raw_result: item.result?.slice(0, 1000) },
        });
      }
      inserted++;
    }
  }

  return { inserted, skipped };
}

function main() {
  const flags = parseFlags(process.argv);
  const db = openDb();
  const before = totalOutcomes(db);

  const r = db.transaction(() => ingest(db, flags.dryRun))();
  const after = totalOutcomes(db);

  console.log(`[apply-log] inserted ${r.inserted} outcomes (skipped existing: ${r.skipped})`);
  console.log(`[apply-log] outcomes: ${before} -> ${after} (delta +${after - before})`);
  console.log(`[apply-log] run 'node scripts/organism/apply-outcomes-to-graph.mjs' to apply them.`);
  db.close();
}

main();
