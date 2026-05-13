/**
 * scripts/survival/resource-ledger.mjs
 *
 * Reads the survival wallet balance via public RPC, tracks LLM call costs,
 * computes cost-of-life and survival projection. Read-only — system can
 * see but not spend.
 *
 * Wallet address is set via env SURVIVAL_WALLET_ADDRESS. If unset, the
 * ledger reports `wallet_address_missing` and treats balance as null
 * (system enters hibernation immediately, preventing any LLM spend until
 * Kirill provides an address).
 *
 * Token costs are looked up against a frozen-in-code price table — when
 * provider prices change, this file must be edited manually (no LLM
 * rewrites the cost-of-life).
 */

import Database from "better-sqlite3";
import { resolve, dirname } from "node:path";
import { mkdirSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DB_PATH = resolve(ROOT, ".data/survival.db");

// Frozen pricing snapshot (2026-05). USD per 1M tokens. Update by manual edit.
const MODEL_PRICES_USD_PER_MTOK = {
  "claude-opus-4-7": { input: 15.00, output: 75.00 },
  "claude-sonnet-4-6": { input: 3.00, output: 15.00 },
  "claude-haiku-4-5-20251001": { input: 0.80, output: 4.00 },
  "claude-haiku-4-5":          { input: 0.80, output: 4.00 },
};

const USD_PER_CAD = 0.73; // 2026-05 approx

const SCHEMA = `
CREATE TABLE IF NOT EXISTS llm_call_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            TEXT NOT NULL,
  model         TEXT NOT NULL,
  in_tokens     INTEGER NOT NULL,
  out_tokens    INTEGER NOT NULL,
  cost_usd      REAL NOT NULL,
  caller        TEXT,
  strategy_id   TEXT,
  notes         TEXT
);

CREATE TABLE IF NOT EXISTS wallet_snapshots (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            TEXT NOT NULL,
  address       TEXT NOT NULL,
  balance_usd   REAL,
  raw_response  TEXT,
  source        TEXT
);
`;

function ensureDir(p) {
  const d = dirname(p);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}

export function openLedger() {
  ensureDir(DB_PATH);
  const db = new Database(DB_PATH);
  db.exec(SCHEMA);
  return db;
}

export function costOfLife({ model, in_tokens, out_tokens }) {
  const price = MODEL_PRICES_USD_PER_MTOK[model];
  if (!price) throw new Error(`[resource-ledger] unknown model price: ${model}`);
  return (
    (in_tokens / 1_000_000) * price.input +
    (out_tokens / 1_000_000) * price.output
  );
}

export function recordLlmCall({ model, in_tokens, out_tokens, caller, strategy_id, notes }) {
  const cost_usd = costOfLife({ model, in_tokens, out_tokens });
  const db = openLedger();
  db.prepare(
    `INSERT INTO llm_call_log (ts, model, in_tokens, out_tokens, cost_usd, caller, strategy_id, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    new Date().toISOString(),
    model,
    in_tokens,
    out_tokens,
    cost_usd,
    caller || null,
    strategy_id || null,
    notes || null
  );
  db.close();
  return cost_usd;
}

export function spentLastNHours(hours = 24) {
  const db = openLedger();
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(cost_usd), 0) AS total
       FROM llm_call_log
       WHERE ts >= datetime('now', ?)`
    )
    .get(`-${hours} hours`);
  db.close();
  return row.total;
}

// --- Wallet read (USDC on Ethereum via public RPC) ---

const USDC_CONTRACT = "0xA0b86991c6218b36c1d19D4a2E9Eb0cE3606eB48";
const PUBLIC_RPC = process.env.SURVIVAL_RPC_URL || "https://ethereum-rpc.publicnode.com";

function pad32(hex) {
  const clean = hex.replace(/^0x/, "");
  return "0".repeat(64 - clean.length) + clean;
}

async function rpcCall(method, params) {
  const res = await fetch(PUBLIC_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`[resource-ledger] RPC ${res.status}`);
  const j = await res.json();
  if (j.error) throw new Error(`[resource-ledger] RPC error: ${JSON.stringify(j.error)}`);
  return j.result;
}

export async function readWalletBalanceUSD(address) {
  if (!address) {
    return { ok: false, reason: "wallet_address_missing", balance_usd: null };
  }
  // ERC-20 balanceOf(address) selector = 0x70a08231
  const data = "0x70a08231" + pad32(address.toLowerCase().replace(/^0x/, ""));
  try {
    const result = await rpcCall("eth_call", [
      { to: USDC_CONTRACT, data },
      "latest",
    ]);
    const raw = BigInt(result);
    // USDC has 6 decimals
    const balance_usd = Number(raw) / 1_000_000;
    const db = openLedger();
    db.prepare(
      `INSERT INTO wallet_snapshots (ts, address, balance_usd, raw_response, source)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      new Date().toISOString(),
      address,
      balance_usd,
      result,
      `usdc_eth_via_${PUBLIC_RPC}`
    );
    db.close();
    return { ok: true, balance_usd, raw_wei: result };
  } catch (e) {
    return { ok: false, reason: "rpc_failed", error: e.message, balance_usd: null };
  }
}

export async function survivalProjection({ address, planned_model = "claude-sonnet-4-6", planned_tokens = 6000 }) {
  // Two independent resources:
  //   - LLM budget (paid by Kirill's Max plan, capped at DAILY_LLM_BUDGET in USD by budget-guard)
  //   - Wallet balance (the food signal — money the world deposits when system earns)
  //
  // Substrate is "alive" as long as the LLM budget has room. Substrate is
  // "blind" if no wallet address — it can act but cannot observe food.
  // Hibernation = LLM budget exhausted OR wallet was set but is empty
  // below cost-of-next-call.
  const DAILY_LLM_BUDGET_USD = 5.00 * 0.73;  // 5 CAD
  const HIBERNATION_RESERVE = 0.10;

  const wallet = address ? await readWalletBalanceUSD(address) : { ok: false, reason: "no_wallet_configured", balance_usd: null };
  const burn_24h = spentLastNHours(24);
  const next_call_cost = costOfLife({
    model: planned_model,
    in_tokens: Math.floor(planned_tokens * 0.85),
    out_tokens: Math.floor(planned_tokens * 0.15),
  });

  const llm_budget_remaining_usd = DAILY_LLM_BUDGET_USD - burn_24h;
  const llm_budget_ok = llm_budget_remaining_usd >= next_call_cost;

  // Wallet only triggers hibernation when it's been configured AND empty.
  // No wallet at all = blind but alive (food signal unobservable).
  const wallet_starves = wallet.ok && wallet.balance_usd !== null
    ? wallet.balance_usd < HIBERNATION_RESERVE
    : false;

  const food_signal_available = wallet.ok && wallet.balance_usd !== null;

  let state;
  if (!llm_budget_ok) state = "hibernation_llm_budget_exhausted";
  else if (wallet_starves) state = "hibernation_wallet_empty";
  else if (!food_signal_available) state = "alive_blind";  // can act, cannot measure food
  else state = "alive";

  const calls_remaining_llm_budget = next_call_cost > 0
    ? Math.floor(llm_budget_remaining_usd / next_call_cost)
    : 0;

  return {
    wallet,
    burn_last_24h_usd: burn_24h,
    llm_budget_remaining_usd,
    next_planned_call_cost_usd: next_call_cost,
    calls_remaining_in_24h_budget: Math.max(0, calls_remaining_llm_budget),
    food_signal_available,
    state,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const addr = process.env.SURVIVAL_WALLET_ADDRESS;
  const proj = await survivalProjection({ address: addr });
  console.log(JSON.stringify(proj, null, 2));
}
