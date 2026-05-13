/**
 * scripts/cortex/outcome-ledger.mjs
 *
 * Append-only JSONL store for prediction→observation→error→update cycles.
 * Council-mandated structure: every prediction substrate makes is recorded
 * BEFORE the observation. Once the deadline passes, a deterministic
 * observer reads the real value, computes |predicted - observed|, and
 * updates a Laplace bucket in policy_weights. ZERO LLM calls in the error
 * function or update path.
 *
 * Schema per row:
 *   predicted_at, source, predicted_value, deadline,
 *   observed_at, observed_value, error, policy_applied_at, notes
 */

import { readFileSync, appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const LEDGER_PATH = resolve(ROOT, ".data/cortex-outcomes.jsonl");

function ensureFile() {
  const dir = dirname(LEDGER_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (!existsSync(LEDGER_PATH)) writeFileSync(LEDGER_PATH, "");
}

export function appendPrediction({ source, predicted_value, deadline_minutes, notes }) {
  ensureFile();
  const now = new Date();
  const row = {
    id: `pred-${now.getTime()}`,
    predicted_at: now.toISOString(),
    source,
    predicted_value,
    deadline: new Date(now.getTime() + deadline_minutes * 60_000).toISOString(),
    observed_at: null,
    observed_value: null,
    error: null,
    policy_applied_at: null,
    notes: notes || null,
  };
  appendFileSync(LEDGER_PATH, JSON.stringify(row) + "\n");
  return row;
}

export function appendObservation({ id, observed_value, error, policy_applied_at, error_bucket }) {
  ensureFile();
  const rows = readAll();
  const target = rows.find(r => r.id === id);
  if (!target) throw new Error(`[outcome-ledger] no row id=${id}`);
  target.observed_at = new Date().toISOString();
  target.observed_value = observed_value;
  target.error = error;
  target.policy_applied_at = policy_applied_at || null;
  target.error_bucket = error_bucket || null;
  writeFileSync(LEDGER_PATH, rows.map(r => JSON.stringify(r)).join("\n") + "\n");
  return target;
}

export function readAll() {
  ensureFile();
  const raw = readFileSync(LEDGER_PATH, "utf-8");
  if (!raw.trim()) return [];
  return raw.trim().split("\n").map(line => JSON.parse(line));
}

export function pendingPastDeadline() {
  const now = Date.now();
  return readAll().filter(r => r.observed_at === null && Date.parse(r.deadline) <= now);
}

export const LEDGER_FILE = LEDGER_PATH;
