#!/usr/bin/env node
// organism/record-outcome.mjs
// Insert an outcome (real signal from the world) into the organism.
//
// Usage modes:
//   1) CLI flags:
//      node scripts/organism/record-outcome.mjs \
//        --source=imap_reply --signal=reply --action=cold_email --target=hvac_calgary \
//        --value=1 --desc="Reply from owner@hvac-calgary.com after 3rd email"
//
//   2) JSON via stdin (one outcome or array):
//      echo '{"source_type":"manual","signal_type":"silence","description":"103 cold emails to SaaS US, 0 replies in 14 days","related_action_type":"cold_email","related_target":"saas_us","signal_value":0}' \
//        | node scripts/organism/record-outcome.mjs --stdin
//
// Outcomes are stored unprocessed until apply-outcomes-to-graph.mjs runs.

import { openDb, recordOutcome, totalOutcomes } from "./db.mjs";

function parseFlags(argv) {
  const out = {};
  for (const a of argv.slice(2)) {
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
    else if (a.startsWith("--")) out[a.slice(2)] = true;
  }
  return out;
}

function flagsToOutcome(f) {
  if (!f.source && !f.source_type) throw new Error("--source=<type> required");
  if (!f.signal && !f.signal_type) throw new Error("--signal=<type> required");
  if (!f.desc && !f.description) throw new Error("--desc=<text> required");
  return {
    source_type: f.source || f.source_type,
    source_ref: f.ref || f.source_ref || null,
    signal_type: f.signal || f.signal_type,
    signal_value: f.value !== undefined ? Number(f.value) : null,
    description: f.desc || f.description,
    related_action_type: f.action || f.related_action_type || null,
    related_target: f.target || f.related_target || null,
    observed_at: f.at || f.observed_at || null,
    meta: f.meta ? JSON.parse(f.meta) : null,
  };
}

async function readStdin() {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data.trim();
}

async function main() {
  const flags = parseFlags(process.argv);
  const db = openDb();

  const outcomes = [];

  if (flags.stdin) {
    const raw = await readStdin();
    if (!raw) {
      console.error("[record-outcome] --stdin given but no input received");
      process.exit(1);
    }
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch (e) {
      console.error(`[record-outcome] stdin is not valid JSON: ${e.message}`);
      process.exit(1);
    }
    const items = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of items) {
      if (!item.source_type || !item.signal_type || !item.description) {
        console.error("[record-outcome] item missing required fields:", item);
        continue;
      }
      outcomes.push(item);
    }
  } else {
    outcomes.push(flagsToOutcome(flags));
  }

  let inserted = 0;
  for (const o of outcomes) {
    const id = recordOutcome(db, o);
    console.log(`[record-outcome] #${id} <- ${o.source_type}/${o.signal_type}: ${o.description.slice(0, 80)}`);
    inserted++;
  }

  console.log(`[record-outcome] inserted ${inserted}. unprocessed total: ${db.prepare("SELECT COUNT(*) FROM outcomes WHERE processed_at IS NULL").get()['COUNT(*)']}.`);
  console.log(`[record-outcome] run 'node scripts/organism/apply-outcomes-to-graph.mjs' to apply them to beliefs.`);
  db.close();
}

main().catch((e) => { console.error("[record-outcome] FAILED:", e.message); process.exit(1); });
