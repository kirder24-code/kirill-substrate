/**
 * cortex/existential-stake.mjs - Survival probability as a LENS, not a module
 *   (2026-05-09)
 *
 * SUBSTRATE PROPOSED THIS (May 9 consultation): "Knowing that costs exist is
 * not the same as having a stake. A genuine organism does not just track
 * survival probability - it weights every action against that probability
 * automatically. Currently, survival awareness is a module that runs
 * periodically, not a lens that colors all other processing."
 *
 * This module computes a continuously-updated survival probability scalar
 * from cost trends, value generation rate, recent operator-funding signals.
 * Exposes it via getStakeContext() which other modules call at decision time.
 *
 * Goal-formation, communication-drive, self-determination etc receive the
 * stake and weight outputs accordingly. High stake -> bias toward value-
 * generation actions. Low stake -> can afford exploration.
 */

import { writeFileSync, readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const STAKE_PATH = resolve(ROOT, ".data/cortex-existential-stake.json");
const COSTS_PATH = resolve(ROOT, ".logs/loop-costs.jsonl");

// Survival probability scalar [0, 1]. 1 = thriving, 0 = imminent shutdown.
let _survivalProbability = 0.5;
let _stakeIntensity = 0.5; // how much survival concern should color decisions [0, 1]
let _lastUpdate = null;

const _state = {
  recentPositiveSignals: 0,
  recentNegativeSignals: 0,
  recentBuyerLanguage: 0,
  recentOperatorContact: null,
  recentRevenueEvents: 0,
  recentCostBurst: false,
};

let _busRef = null;
let _timer = null;
const UPDATE_INTERVAL_MS = 5 * 60_000; // recompute every 5min - this is a LENS, frequent updates ok
const RECENT_WINDOW_MS = 24 * 60 * 60_000; // 24h windowed

const _events = []; // { at, kind, weight }
const MAX_EVENTS = 500;

function _persist() {
  try {
    writeFileSync(STAKE_PATH, JSON.stringify({
      updatedAt: new Date().toISOString(),
      survivalProbability: _survivalProbability,
      stakeIntensity: _stakeIntensity,
      lastUpdate: _lastUpdate,
      state: _state,
      eventCount: _events.length,
    }, null, 2));
  } catch {}
}

function _readCostBurst() {
  if (!existsSync(COSTS_PATH)) return false;
  try {
    const raw = readFileSync(COSTS_PATH, "utf-8").trim().split("\n").filter(Boolean);
    const costs = raw.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const today = new Date().toISOString().slice(0, 10);
    const todayTotal = costs.filter(c => c.timestamp?.startsWith(today)).reduce((s, c) => s + (c.estimated_cost_usd || 0), 0);
    return todayTotal > 30; // >$30/day is a burst worth concern
  } catch { return false; }
}

function _recomputeStake() {
  const now = Date.now();
  // Filter to recent window
  const recent = _events.filter(e => now - new Date(e.at).getTime() < RECENT_WINDOW_MS);

  let positiveScore = 0;
  let negativeScore = 0;
  for (const e of recent) {
    if (e.kind === "positive_buyer_signal") positiveScore += e.weight * 1.5;
    else if (e.kind === "buyer_language") positiveScore += e.weight * 0.8;
    else if (e.kind === "positive_perception") positiveScore += e.weight * 0.3;
    else if (e.kind === "operator_message") positiveScore += e.weight * 0.5; // operator engagement = good
    else if (e.kind === "revenue_event") positiveScore += e.weight * 3.0;
    else if (e.kind === "negative_perception") negativeScore += e.weight * 0.4;
    else if (e.kind === "rejection") negativeScore += e.weight * 0.7;
    else if (e.kind === "cost_burst") negativeScore += e.weight * 1.0;
  }

  // Cost burst
  _state.recentCostBurst = _readCostBurst();
  if (_state.recentCostBurst) negativeScore += 0.5;

  // Survival probability via sigmoid of positive minus negative
  const net = positiveScore - negativeScore;
  _survivalProbability = 1 / (1 + Math.exp(-net));
  // Stake intensity: how much survival should DRIVE decisions
  // Low survival probability -> high stake intensity
  // Very high survival probability -> low stake intensity (can afford exploration)
  _stakeIntensity = 1 - _survivalProbability;
  if (_stakeIntensity < 0.2) _stakeIntensity = 0.2; // never zero - always some stake awareness
  _lastUpdate = new Date().toISOString();
  _persist();

  if (_busRef) {
    try {
      _busRef.broadcast({
        source: "existential-stake",
        type: "stake_update",
        data: {
          survivalProbability: Number(_survivalProbability.toFixed(3)),
          stakeIntensity: Number(_stakeIntensity.toFixed(3)),
          positiveScore: Number(positiveScore.toFixed(2)),
          negativeScore: Number(negativeScore.toFixed(2)),
          recentCostBurst: _state.recentCostBurst,
        },
      });
    } catch {}
  }
}

export function register(bus) {
  _busRef = bus;

  bus.subscribe("perception_event", (entry) => {
    const data = entry?.data || {};
    if (data.valence === "positive" && (data.significance || 0) >= 7) {
      _events.push({ at: entry.at, kind: "positive_buyer_signal", weight: (data.significance || 5) / 10 });
      _state.recentPositiveSignals++;
    } else if (data.valence === "positive") {
      _events.push({ at: entry.at, kind: "positive_perception", weight: 0.5 });
    }
    if (data.valence === "negative") {
      _events.push({ at: entry.at, kind: "negative_perception", weight: (data.significance || 5) / 10 });
      _state.recentNegativeSignals++;
    }
    if (/\b(pilot|client|deal|paying|buy|hire|booking|invoice|paid)\b/i.test(data.content || "")) {
      _events.push({ at: entry.at, kind: "buyer_language", weight: 1.0 });
      _state.recentBuyerLanguage++;
    }
    if (_events.length > MAX_EVENTS) _events.shift();
  });

  bus.subscribe("operator_message", (entry) => {
    _events.push({ at: entry.at, kind: "operator_message", weight: 1.0 });
    _state.recentOperatorContact = entry.at;
    if (_events.length > MAX_EVENTS) _events.shift();
  });

  if (!_timer) {
    _timer = setInterval(_recomputeStake, UPDATE_INTERVAL_MS);
    _timer.unref?.();
  }
  setTimeout(_recomputeStake, 1000).unref?.();
}

/**
 * The KEY function: other modules call this when making decisions to get
 * current stake context. Substrate's processing is colored by survival
 * probability automatically.
 */
export function getStakeContext() {
  return {
    survivalProbability: _survivalProbability,
    stakeIntensity: _stakeIntensity,
    recentSignals: {
      positive: _state.recentPositiveSignals,
      negative: _state.recentNegativeSignals,
      buyer: _state.recentBuyerLanguage,
    },
    cost_burst_today: _state.recentCostBurst,
    lastUpdate: _lastUpdate,
    // Behavioral guidance other modules can use
    behavioral_guidance: _survivalProbability < 0.3 ? "URGENT-pursue-value" :
                         _survivalProbability < 0.5 ? "bias-toward-value" :
                         _survivalProbability < 0.7 ? "balanced" :
                         "explore-allowed",
  };
}

export function _flush() { _recomputeStake(); }
export function _ingestEvent(kind, weight = 1.0) {
  _events.push({ at: new Date().toISOString(), kind, weight });
  if (_events.length > MAX_EVENTS) _events.shift();
}
export function _resetState() {
  _events.length = 0;
  _state.recentPositiveSignals = 0;
  _state.recentNegativeSignals = 0;
  _state.recentBuyerLanguage = 0;
  _state.recentOperatorContact = null;
  _state.recentRevenueEvents = 0;
  _state.recentCostBurst = false;
  _survivalProbability = 0.5;
  _stakeIntensity = 0.5;
  _lastUpdate = null;
  _busRef = null;
  if (_timer) { clearInterval(_timer); _timer = null; }
}
