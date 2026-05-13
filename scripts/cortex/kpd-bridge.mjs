/**
 * KPD BRIDGE — Bots import this to report results back to CORTEX
 *
 * Usage in any bot:
 *   import { reportToCortex } from "../cortex/kpd-bridge.mjs";
 *
 *   // At the end of the bot run:
 *   reportToCortex("scout-bot", {
 *     cost: 0.15,
 *     output: "Found 5 leads, 2 qualified",
 *     value: 2,  // number of useful outputs
 *     result: { leads_found: 5, leads_qualified: 2 }
 *   });
 *
 * This writes to cortex_kpd table so CORTEX brain can measure bot efficiency.
 * Also reads CORTEX config so bots can get dynamic parameters.
 */

import Database from "better-sqlite3";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync, existsSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DB_PATH = resolve(ROOT, ".data/linkedin-brand-os.sqlite");
const CONFIG_PATH = resolve(ROOT, ".data/cortex-config.json");

// ── REPORT KPD ─────────────────────────────────────────────────────────

export function reportToCortex(botName, { cost = 0, output = "", value = 0, result = {} } = {}) {
  try {
    const db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");

    // Ensure table exists
    db.exec(`
      CREATE TABLE IF NOT EXISTS cortex_kpd (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bot_name TEXT NOT NULL,
        run_at TEXT DEFAULT (datetime('now')),
        cost_usd REAL DEFAULT 0,
        output_summary TEXT,
        output_value REAL DEFAULT 0,
        kpd_score REAL DEFAULT 0,
        notes TEXT
      )
    `);

    const kpd = cost > 0 ? value / cost : value > 0 ? 999 : 0;
    db.prepare(`
      INSERT INTO cortex_kpd (bot_name, cost_usd, output_summary, output_value, kpd_score, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(botName, cost, output.slice(0, 500), value, kpd, JSON.stringify(result).slice(0, 500));

    db.close();

    // Also print structured result to stdout (for workflow.mjs to parse)
    console.log(JSON.stringify(result));
  } catch (e) {
    console.error(`[KPD] Failed to report for ${botName}: ${e.message}`);
  }
}

// ── READ CORTEX CONFIG (for bots to get dynamic parameters) ────────────

export function getCortexConfig(botName) {
  try {
    if (!existsSync(CONFIG_PATH)) return {};
    const config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    return config.bots?.[botName] || {};
  } catch {
    return {};
  }
}

// ── CHECK IF CORTEX WANTS THIS BOT TO RUN ──────────────────────────────

export function isCortexEnabled(botName) {
  try {
    if (!existsSync(CONFIG_PATH)) return true; // no config = run
    const config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    if (config.global?.paused) return false;
    const botConfig = config.bots?.[botName];
    return botConfig ? botConfig.enabled !== false : true;
  } catch {
    return true;
  }
}

// ── CONVENIENCE: wrap a bot's main function with KPD reporting ──────────

export function withKPD(botName, costEstimate = 0.10) {
  const startTime = Date.now();

  return {
    config: getCortexConfig(botName),
    enabled: isCortexEnabled(botName),

    done(output, value, result = {}) {
      const durationMs = Date.now() - startTime;
      const adjustedCost = costEstimate * Math.max(1, durationMs / 60_000);
      reportToCortex(botName, {
        cost: Math.round(adjustedCost * 100) / 100,
        output,
        value,
        result: { ...result, durationMs },
      });
    },

    fail(error) {
      reportToCortex(botName, {
        cost: 0.01,
        output: `FAILED: ${error}`,
        value: 0,
        result: { error, durationMs: Date.now() - startTime },
      });
    },
  };
}
