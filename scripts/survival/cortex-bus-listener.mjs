/**
 * scripts/survival/cortex-bus-listener.mjs
 *
 * Substrate consumer of cortex-alive bus events. Reads recent
 * .data/cortex-alive-bus.jsonl and converts high-signal cortex
 * events into substrate strategy seeds.
 *
 * Cortex emits ~14 event types from 36 modules. This module turns
 * the most actionable ones into substrate-side strategy proposals:
 *
 *   free_energy regime=high  -> seed strategy: web_research on
 *                                that domain (substrate goes find
 *                                what cortex was uncertain about)
 *   prediction_error_high    -> seed strategy: pattern_extraction
 *                                (substrate analyzes its own past
 *                                actions for the pattern that misfired)
 *   stake_update + low score -> seed strategy: growth_articulation
 *                                (substrate articulates what survival
 *                                needs)
 *   genuine_surprise         -> seed strategy: opportunity_deep_research
 *                                if a new opportunity is implied
 *
 * Pure-read of bus log. No LLM. Cheap, runs every tick.
 */

import { readFileSync, existsSync, statSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

import { registerStrategy, openRegistry } from "./policy-registry.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const BUS_LOG = resolve(ROOT, ".data/cortex-alive-bus.jsonl");
const STATE_PATH = resolve(ROOT, ".data/survival-cortex-listener-state.json");

function loadState() {
  if (!existsSync(STATE_PATH)) return { last_seen_line: 0 };
  try { return JSON.parse(readFileSync(STATE_PATH, "utf-8")); }
  catch { return { last_seen_line: 0 }; }
}

function saveState(s) {
  writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}

export const cortexBusListenerMeta = {
  description: "Read cortex-alive bus log, convert high-signal cortex events into substrate strategy seeds.",
  side_effect_class: "auto",
  expected_signal: "cortex_seeds_registered",
  expected_signal_delay_min: 0,
  estimated_cost_usd: 0.0,
};

export async function runCortexBusListener({ strategy }) {
  if (!existsSync(BUS_LOG)) return { ok: true, reason: "no_bus_log" };
  const text = readFileSync(BUS_LOG, "utf-8");
  const lines = text.split("\n").filter(Boolean);
  const state = loadState();
  const newLines = lines.slice(state.last_seen_line);
  if (newLines.length === 0) return { ok: true, processed: 0 };

  const seeds = [];
  for (const line of newLines) {
    let evt;
    try { evt = JSON.parse(line); } catch { continue; }
    const seed = mapEventToSeed(evt);
    if (seed) seeds.push({ ...seed, source_event: evt });
  }

  // Dedupe by action_id+context to avoid runaway seed creation.
  const seen = new Set();
  const uniqueSeeds = [];
  for (const s of seeds) {
    const key = `${s.action_id}:${s.context_hash}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueSeeds.push(s);
  }

  const created = [];
  for (const s of uniqueSeeds) {
    const id = `cortex-seed-${s.action_id}-${s.context_hash}-${Date.now().toString(36)}`;
    registerStrategy({
      id,
      action_id: s.action_id,
      context_hash: s.context_hash,
      parameters: s.parameters,
    });
    created.push({ id, action_id: s.action_id, trigger: s.trigger });
  }

  // advance state
  saveState({ last_seen_line: lines.length });

  return { ok: true, processed: newLines.length, seeds_created: created.length, created };
}

function mapEventToSeed(evt) {
  if (!evt || !evt.type) return null;
  const ctxHash = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 8);

  if (evt.type === "free_energy" && evt.data_keys?.includes("regime")) {
    // Cortex saw its world model fail or had blind spot. Substrate
    // should investigate by reading public sources.
    return {
      action_id: "web_research",
      context_hash: ctxHash("cortex_free_energy_high"),
      trigger: "cortex:free_energy",
      parameters: {
        url: "https://news.ycombinator.com",
        _from_cortex_event: "free_energy",
        _reason: "cortex flagged high free energy — gather fresh world data",
      },
    };
  }
  if (evt.type === "prediction_error_high" || (evt.type === "free_energy" && evt.data_keys?.includes("prediction_error"))) {
    return {
      action_id: "pattern_extraction",
      context_hash: ctxHash("cortex_prediction_error"),
      trigger: "cortex:prediction_error",
      parameters: {
        _from_cortex_event: evt.type,
        _reason: "analyze own past actions for the pattern that misfired",
      },
    };
  }
  if (evt.type === "stake_update") {
    // Cortex observed survival stake change. Trigger growth articulation.
    return {
      action_id: "growth_articulation",
      context_hash: ctxHash("cortex_stake_update"),
      trigger: "cortex:stake_update",
      parameters: {
        _from_cortex_event: "stake_update",
        _reason: "cortex flagged survival stake — articulate what would help",
      },
    };
  }
  if (evt.type === "genuine_surprise" || evt.type === "world_prediction") {
    return {
      action_id: "ingest_organism_research",
      context_hash: ctxHash("cortex_surprise"),
      trigger: "cortex:" + evt.type,
      parameters: {
        _from_cortex_event: evt.type,
        _reason: "cortex saw something unexpected — ingest fresh intel",
      },
    };
  }
  if (evt.type === "perception_feed_updated") {
    return {
      action_id: "factory_output_ingest",
      context_hash: ctxHash("cortex_perception_updated"),
      trigger: "cortex:perception_feed_updated",
      parameters: {
        _from_cortex_event: "perception_feed_updated",
        _reason: "perception files refreshed — scan for novel items",
      },
    };
  }
  return null;
}
