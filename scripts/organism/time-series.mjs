#!/usr/bin/env node
// organism/time-series.mjs
// Snapshots all beliefs daily and produces trend analysis: rising/falling/stable.
// Run hourly from pulse — first call of the day creates a snapshot, subsequent calls
// just update the same day's snapshot in place.

import { openDb, snapshotAllBeliefs, risingBeliefs, fallingBeliefs } from "./db.mjs";

function parseFlags(argv) {
  const out = { window: 7, minDelta: 0.10, summary: false, snapshotOnly: false };
  for (const a of argv.slice(2)) {
    if (a.startsWith("--window=")) out.window = parseInt(a.slice(9), 10) || 7;
    else if (a.startsWith("--min-delta=")) out.minDelta = parseFloat(a.slice(12)) || 0.10;
    else if (a === "--summary") out.summary = true;
    else if (a === "--snapshot-only") out.snapshotOnly = true;
  }
  return out;
}

function main() {
  const flags = parseFlags(process.argv);
  const db = openDb();

  const n = snapshotAllBeliefs(db);
  console.log(`[time-series] snapshotted ${n} beliefs for ${new Date().toISOString().slice(0, 10)}`);
  if (flags.snapshotOnly) { db.close(); return; }

  const rising = risingBeliefs(db, { days: flags.window, minDelta: flags.minDelta, limit: 10 });
  const falling = fallingBeliefs(db, { days: flags.window, minDelta: flags.minDelta, limit: 10 });

  console.log(`\n=== RISING (last ${flags.window} days, Δ ≥ ${flags.minDelta}) ===`);
  if (rising.length === 0) console.log("  (none yet — need ≥${flags.window} days of snapshots)");
  for (const b of rising) {
    console.log(`  +${b.delta.toFixed(2)} | ${b.past_weight.toFixed(2)} → ${b.current_weight.toFixed(2)} | ${b.claim.slice(0, 100)}`);
  }

  console.log(`\n=== FALLING (last ${flags.window} days, Δ ≥ ${flags.minDelta}) ===`);
  if (falling.length === 0) console.log("  (none)");
  for (const b of falling) {
    console.log(`  -${b.delta.toFixed(2)} | ${b.past_weight.toFixed(2)} → ${b.current_weight.toFixed(2)} | ${b.claim.slice(0, 100)}`);
  }

  if (flags.summary) {
    console.log(`\n=== SUMMARY ===`);
    console.log(`  rising: ${rising.length}, falling: ${falling.length}`);
  }

  db.close();
}

main();
