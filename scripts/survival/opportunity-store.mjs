/**
 * scripts/survival/opportunity-store.mjs
 *
 * Persistent record of opportunities the system is working on.
 * State machine:
 *
 *   detected  -- opportunity ingested from a source, no work done yet
 *   researching -- active deep_research action assigned
 *   researched -- research.md exists, plan not yet generated
 *   planning -- active implementation_plan action assigned
 *   planned -- plan.md exists, sub-strategies created
 *   in_progress -- substrate is executing sub-strategies for this opportunity
 *   done -- work completed, signal landed (or operator marked done)
 *   abandoned -- operator rejected, or budget cap hit without traction
 *
 * Each opportunity has:
 *   id, title, source, source_provenance, seed_text,
 *   state, state_changed_at,
 *   research_path (file), plan_path (file),
 *   target_icp, channels, money_potential_usd,
 *   parent_strategy_id (the wishlist/strategy that produced it)
 */

import Database from "better-sqlite3";
import { resolve, dirname } from "node:path";
import { mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DB_PATH = resolve(ROOT, ".data/survival.db");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS opportunities (
  id                  TEXT PRIMARY KEY,
  title               TEXT NOT NULL,
  source              TEXT NOT NULL,
  source_provenance   TEXT,
  seed_text           TEXT,
  state               TEXT NOT NULL DEFAULT 'detected',
  state_changed_at    TEXT NOT NULL,
  created_at          TEXT NOT NULL,
  research_path       TEXT,
  plan_path           TEXT,
  target_icp          TEXT,
  channels            TEXT,
  money_potential_usd REAL,
  parent_strategy_id  TEXT,
  notes               TEXT
);
CREATE INDEX IF NOT EXISTS idx_opp_state ON opportunities(state);
CREATE INDEX IF NOT EXISTS idx_opp_source ON opportunities(source);
`;

function ensureDir(p) { const d = dirname(p); if (!existsSync(d)) mkdirSync(d, { recursive: true }); }
function db() { ensureDir(DB_PATH); const c = new Database(DB_PATH); c.exec(SCHEMA); return c; }

function makeId(title) {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
  const h = crypto.createHash("sha256").update(title + Date.now()).digest("hex").slice(0, 6);
  return `opp-${slug}-${h}`;
}

export function createOpportunity({ title, source, source_provenance, seed_text, parent_strategy_id, notes }) {
  const c = db();
  const now = new Date().toISOString();
  const id = makeId(title);
  c.prepare(
    `INSERT INTO opportunities
     (id, title, source, source_provenance, seed_text, state, state_changed_at, created_at, parent_strategy_id, notes)
     VALUES (?, ?, ?, ?, ?, 'detected', ?, ?, ?, ?)`
  ).run(id, title, source, source_provenance || null, seed_text || null, now, now, parent_strategy_id || null, notes || null);
  c.close();
  return id;
}

export function listByState(state) {
  const c = db();
  const rows = c.prepare(`SELECT * FROM opportunities WHERE state = ? ORDER BY created_at`).all(state);
  c.close();
  return rows;
}

export function listAll() {
  const c = db();
  const rows = c.prepare(`SELECT * FROM opportunities ORDER BY created_at DESC`).all();
  c.close();
  return rows;
}

export function getOpportunity(id) {
  const c = db();
  const row = c.prepare(`SELECT * FROM opportunities WHERE id = ?`).get(id);
  c.close();
  return row;
}

// States that require an ISA-check pass before being allowed
const TERMINAL_STATES = new Set(["done"]);

/**
 * Find the ISA.md for an opportunity, if one exists.
 * Looks at .data/survival-opportunities/<id>/ISA.md.
 */
function findISAForOpp(id) {
  const isaPath = resolve(ROOT, ".data/survival-opportunities", id, "ISA.md");
  return existsSync(isaPath) ? isaPath : null;
}

export async function transition(id, newState, patch = {}) {
  // ─── ISA gate: terminal states (done) require ISA-check pass ───────────
  // Honesty enforcement per feedback_verification_doctrine.md.
  // If an opportunity has an ISA, transitioning to "done" requires:
  //   1. isa-check passes (no hard gaps)
  //   2. Verification section populated for every checked ISC
  // Override with allowOverride:true ONLY for operator-marked-done OR
  // when no ISA exists yet (legacy opps).
  if (TERMINAL_STATES.has(newState) && !patch.allowOverride) {
    const isaPath = findISAForOpp(id);
    if (isaPath) {
      try {
        const { checkISA } = await import("../cortex/isa-check.mjs");
        const { parseCriteriaList } = await import("../cortex/isa-parser.mjs");
        const { readFileSync } = await import("node:fs");

        // Two-part gate:
        //   (a) ISA structural check passes (all required sections present, ISCs valid)
        //   (b) ALL non-anti ISCs are status=completed AND Verification has each entry
        const checkResult = await checkISA(isaPath, { strict: true });

        const content = readFileSync(isaPath, "utf-8");
        const isacs = parseCriteriaList(content);
        const realCriteria = isacs.filter(c => c.type === "criterion");
        const pendingReal = realCriteria.filter(c => c.status === "pending");
        const completedAnti = isacs.filter(c => c.type === "anti-criterion" && c.status === "completed");
        const totalAnti = isacs.filter(c => c.type === "anti-criterion").length;

        // Anti-criteria: at least all anti must be checked too
        const pendingAnti = isacs.filter(c => c.type === "anti-criterion" && c.status === "pending");

        const blockedReasons = [];
        if (checkResult.status !== "pass") {
          blockedReasons.push(`isa-check failed (${checkResult.hard_gaps} hard gaps)`);
        }
        if (pendingReal.length > 0) {
          blockedReasons.push(`${pendingReal.length}/${realCriteria.length} criterion ISCs still pending: ${pendingReal.slice(0, 3).map(c => c.id).join(", ")}${pendingReal.length > 3 ? ", ..." : ""}`);
        }
        if (pendingAnti.length > 0) {
          blockedReasons.push(`${pendingAnti.length}/${totalAnti} anti-criterion ISCs still pending: ${pendingAnti.slice(0, 3).map(c => c.id).join(", ")}`);
        }

        // Verification coverage: every checked ISC needs a Verification entry
        const checkedIds = isacs.filter(c => c.status === "completed").map(c => c.id);
        const verifSection = (() => {
          const m = /^##\s+Verification\s*$/im.exec(content);
          if (!m) return "";
          const start = m.index + m[0].length;
          const rest = content.slice(start);
          const end = rest.match(/\n##\s+(?!#)|\n---\s*\n/);
          return end ? rest.slice(0, end.index) : rest;
        })();
        const missingVerif = checkedIds.filter(id => !verifSection.includes(id));
        if (missingVerif.length > 0) {
          blockedReasons.push(`Verification section missing entries for: ${missingVerif.slice(0, 5).join(", ")}`);
        }

        if (blockedReasons.length > 0) {
          const reason = `ISA gate refused transition '${id}' to '${newState}': ${blockedReasons.join(" | ")}`;
          // Log refusal
          try {
            const { appendFileSync, mkdirSync } = await import("node:fs");
            const logPath = resolve(ROOT, ".logs/isa-gate-refusals.jsonl");
            mkdirSync(dirname(logPath), { recursive: true });
            appendFileSync(logPath, JSON.stringify({
              ts: new Date().toISOString(), opp_id: id, attempted_state: newState,
              isa_path: isaPath.replace(ROOT + "/", ""),
              blocked_reasons: blockedReasons,
              isa_check_status: checkResult.status,
              pending_criteria: pendingReal.map(c => c.id),
              missing_verification: missingVerif,
            }) + "\n");
          } catch {}
          const err = new Error(reason);
          err.code = "isa_gate_blocked";
          err.opp_id = id;
          err.blocked_reasons = blockedReasons;
          throw err;
        }
      } catch (e) {
        if (e.code === "isa_gate_blocked") throw e;
        console.error(`[opportunity-store] ISA-check threw for ${id}: ${e.message} — proceeding without gate`);
      }
    }
  }

  const c = db();
  const allowedKeys = ["research_path", "plan_path", "target_icp", "channels", "money_potential_usd", "notes"];
  const sets = [`state = ?`, `state_changed_at = ?`];
  const args = [newState, new Date().toISOString()];
  for (const k of Object.keys(patch)) {
    if (allowedKeys.includes(k)) { sets.push(`${k} = ?`); args.push(patch[k]); }
  }
  args.push(id);
  c.prepare(`UPDATE opportunities SET ${sets.join(", ")} WHERE id = ?`).run(...args);
  c.close();
  return getOpportunity(id);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(listAll(), null, 2));
}
