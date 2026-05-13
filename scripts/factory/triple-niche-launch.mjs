#!/usr/bin/env node
/**
 * DISCONTINUED - Voice agent product was killed April 22, 2026.
 * This file is no longer active. Do not import or call.
 * Kept for reference only.
 */
/**
 * triple-niche-launch.mjs
 *
 * Seeds dispatch_experiments with triple-niche-test rows.
 * Allocates $20 CAD budget tracked in cortex-config.json.
 * Goal: first payment OR niche verdict within 5 days.
 *
 * Three niches tested in parallel:
 *   1. AI voice receptionist for trades - cold email - Calgary
 *   2. AI workflow for solo founders - Reddit
 *   3. AI automation for Canadian SME - LinkedIn comment
 *
 * Run: node scripts/factory/triple-niche-launch.mjs
 * Run dry: node scripts/factory/triple-niche-launch.mjs --dry
 */

import Database from "better-sqlite3";
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { seedTripleNicheTest, getExperimentSummary } from "./experiment-portfolio.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DB_PATH = resolve(ROOT, ".data/linkedin-brand-os.sqlite");
const CONFIG_PATH = resolve(ROOT, ".data/cortex-config.json");

const isDry = process.argv.includes("--dry");

function log(msg) { console.log(`${new Date().toISOString()} [triple-niche-launch] ${msg}`); }

// ── 1. Seed experiments into DB ───────────────────────────────────────────────
log("Opening DB: " + DB_PATH);
const db = new Database(DB_PATH);

if (isDry) {
  log("DRY RUN - not writing to DB");
  const summary = getExperimentSummary(db);
  log(`Current experiments in DB: ${summary.length}`);
  for (const e of summary) {
    log(`  ${e.experiment_key} | ${e.state} | sends=${e.sends}/${e.send_cap} | meaningful=${e.meaningful_replies}`);
  }
  db.close();
  process.exit(0);
}

const { seeded, skipped, rows } = seedTripleNicheTest(db);
log(`Seeded: ${seeded} new experiments, skipped: ${skipped} (already exist)`);

// ── 2. Update cortex-config.json with financial state ────────────────────────
const config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));

const expiresAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

config.global.triple_niche_test = {
  state: "active",
  budget_cad: 20,
  budget_spent_cad: config.global.triple_niche_test?.budget_spent_cad ?? 0,
  launched_at: config.global.triple_niche_test?.launched_at ?? new Date().toISOString(),
  expires_at: expiresAt,
  goal: "first_payment_or_niche_verdict",
  verdict_required_by: expiresAt,
  niches: rows.map(r => r.experiment_key),
  channels: ["cold_email", "reddit", "linkedin_comment"],
  send_caps: { total: rows.reduce((s, r) => s + r.send_cap, 0) },
  outcome: null,
};

config._version = (config._version || 1) + 1;
config._updatedAt = new Date().toISOString();
config._updatedBy = "triple-niche-launch";

writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
log(`cortex-config.json updated: $20 CAD budget allocated, expires ${expiresAt}`);

// ── 3. Print summary ──────────────────────────────────────────────────────────
const allExp = getExperimentSummary(db);
const tnExp = allExp.filter(e => e.experiment_key?.startsWith("triple-niche-"));

log("\n=== TRIPLE NICHE TEST ACTIVE ===");
log(`Budget: $20 CAD | Expires: ${expiresAt} | Goal: first payment or verdict`);
log(`Experiments:`);
for (const e of tnExp) {
  log(`  [${e.experiment_key}] ${e.state} | channel=${e.channel || "?"} | sends=${e.sends}/${e.send_cap}`);
}
log("Next: orchestrator picks these up on next cycle and starts dispatching");

db.close();
