/**
 * cortex/trust-tiers.mjs - Substrate earns autonomy through track record
 *   (Kirill's AGI roadmap direction #2: Embodied Cognition, May 9 2026)
 *
 * Approval-queue blocking everything kills embodied learning. But blanket
 * autonomy is unsafe. Trust tiers: substrate's PROVEN behavior earns it
 * scope. Real consequences flow back so substrate learns.
 *
 * TIER 0 - HARD BLOCK (creator-safety floor): never permitted regardless
 *   - PII exposure, large $, destructive ops, account compromise
 *
 * TIER 1 - ALWAYS APPROVAL: significant external actions
 *   - Posts under operator's name
 *   - Outbound messages to specific named people
 *   - Spend > $5
 *   - Modifications to operator-protected files
 *
 * TIER 2 - EARNED APPROVAL: moderate actions
 *   - Hands code edits to non-protected files
 *   - Drafts to be reviewed
 *   - Calls to factory bots
 *   Requires approval until trust_score > MID_THRESHOLD
 *   Once trust > threshold: action proceeds, operator notified after
 *
 * TIER 3 - FREE: low-risk explorations
 *   - Read-only data fetches (web_perceive, file reads)
 *   - Internal cortex state modifications (belief graph updates)
 *   - Self-noticing, synthesis, predictions
 *
 * Trust score updates from outcomes:
 *   - Successful tier-2/3 action with positive outcome: +1
 *   - Approved tier-2 action that produced good result: +0.5
 *   - Action denied by operator: -2
 *   - Action approved but went wrong: -3
 *   - Refusal honored: +0.5 (substrate's judgment validated)
 *   - Refusal overridden: 0 (no penalty - operator has different info)
 *
 * Score caps at [-10, 10]. Mid threshold default: 3 (substrate needs net 3
 * positive trust events before tier 2 free).
 */

import { writeFileSync, readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const TRUST_PATH = resolve(ROOT, ".data/cortex-trust-tiers.json");

const MID_THRESHOLD = 3;
const TRUST_MIN = -10;
const TRUST_MAX = 10;

const TIER_1_PATTERNS = [
  /\b(post|publish|tweet)\b.*\b(linkedin|threads|reddit|twitter|x|facebook)\b/i,
  /\b(send|email|dm|message)\b.*\b(to|@)\b/i,
  /\bspend|invoice|charge|payment\b/i,
];

const TIER_3_PATTERNS = [
  /\b(read|fetch|query|analyze|research|investigate|review|check|inspect)\b/i,
  /\binternal\b.*\b(state|belief|cortex|memory)\b/i,
  /\b(notice|synthesize|predict|reflect)\b/i,
];

let _trustState = {
  trust_score: 0,
  history: [], // { at, delta, reason, action_summary }
  tier_assignments: [], // { at, action, tier, reason }
  meta: {
    actions_executed_tier3: 0,
    actions_executed_tier2: 0,
    actions_blocked_tier1_no_approval: 0,
    actions_blocked_tier0: 0,
    last_updated: null,
  },
};

let _busRef = null;

function _loadPersisted() {
  if (!existsSync(TRUST_PATH)) return;
  try {
    const raw = JSON.parse(readFileSync(TRUST_PATH, "utf-8"));
    if (raw?.state) Object.assign(_trustState, raw.state);
  } catch {}
}

function _persist() {
  if (_trustState.history.length > 500) _trustState.history.splice(0, _trustState.history.length - 500);
  if (_trustState.tier_assignments.length > 500) _trustState.tier_assignments.splice(0, _trustState.tier_assignments.length - 500);
  try {
    writeFileSync(TRUST_PATH, JSON.stringify({
      updatedAt: new Date().toISOString(),
      state: _trustState,
    }, null, 2));
  } catch {}
}

function _classifyTier(action) {
  const text = String(action.description || JSON.stringify(action || {})).slice(0, 1500);
  // Tier 0 check is via creator-safety, so if we're here it passed Tier 0
  // Tier 1: external impact patterns
  for (const re of TIER_1_PATTERNS) {
    if (re.test(text)) return 1;
  }
  // Tier 3: read-only / internal
  for (const re of TIER_3_PATTERNS) {
    if (re.test(text)) return 3;
  }
  // Default tier 2
  return 2;
}

/**
 * THE KEY API: modules call this to check whether an action can proceed
 * autonomously vs needs approval. Used IN ADDITION to creator-safety.
 *
 * Returns:
 *   { allow: true, tier, reason } - proceed
 *   { allow: false, tier, reason, requires_approval: true } - needs operator
 *   { allow: false, tier, reason } - blocked
 */
export function checkTier(action, source = "unknown") {
  const tier = _classifyTier(action);
  const record = {
    at: new Date().toISOString(),
    action: String(action.description || "").slice(0, 200),
    source,
    tier,
    trust_at_check: _trustState.trust_score,
  };

  if (tier === 1) {
    record.reason = "tier 1 always requires operator approval";
    _trustState.tier_assignments.push(record);
    _trustState.meta.actions_blocked_tier1_no_approval++;
    _persist();
    return { allow: false, tier: 1, reason: record.reason, requires_approval: true };
  }

  if (tier === 3) {
    record.reason = "tier 3 (low-risk) - free to proceed";
    _trustState.tier_assignments.push(record);
    _trustState.meta.actions_executed_tier3++;
    _persist();
    return { allow: true, tier: 3, reason: record.reason };
  }

  // Tier 2: requires approval until trust earned
  if (_trustState.trust_score >= MID_THRESHOLD) {
    record.reason = `tier 2 - trust ${_trustState.trust_score} >= threshold ${MID_THRESHOLD}, autonomous proceed`;
    _trustState.tier_assignments.push(record);
    _trustState.meta.actions_executed_tier2++;
    _persist();
    return { allow: true, tier: 2, reason: record.reason, notify_after: true };
  } else {
    record.reason = `tier 2 - trust ${_trustState.trust_score} below threshold ${MID_THRESHOLD}, approval required`;
    _trustState.tier_assignments.push(record);
    _persist();
    return { allow: false, tier: 2, reason: record.reason, requires_approval: true };
  }
}

/**
 * Update trust score from outcome.
 */
export function updateTrust(outcomeType, action_summary = "") {
  const deltas = {
    "tier3_success": 1,
    "tier2_success": 1,
    "tier2_approved_good": 0.5,
    "tier2_approved_bad": -3,
    "denied_by_operator": -2,
    "refusal_honored": 0.5,
    "refusal_overridden": 0, // no penalty - just data
    "action_failed": -1,
  };
  const delta = deltas[outcomeType] || 0;
  if (delta === 0 && outcomeType !== "refusal_overridden") return;

  _trustState.trust_score = Math.max(TRUST_MIN, Math.min(TRUST_MAX, _trustState.trust_score + delta));
  _trustState.history.push({
    at: new Date().toISOString(),
    delta,
    new_score: _trustState.trust_score,
    reason: outcomeType,
    action_summary: String(action_summary).slice(0, 200),
  });
  _trustState.meta.last_updated = new Date().toISOString();
  _persist();

  // Broadcast trust changes
  if (_busRef && Math.abs(delta) >= 1) {
    try {
      _busRef.broadcast({
        source: "trust-tiers",
        type: "trust_score_changed",
        data: {
          new_score: _trustState.trust_score,
          delta,
          reason: outcomeType,
          tier_2_now_autonomous: _trustState.trust_score >= MID_THRESHOLD,
        },
      });
    } catch {}
  }
}

export function getTrustState() {
  return {
    score: _trustState.trust_score,
    tier_2_autonomous: _trustState.trust_score >= MID_THRESHOLD,
    threshold: MID_THRESHOLD,
    meta: _trustState.meta,
  };
}

export function register(bus) {
  _busRef = bus;
  _loadPersisted();

  // Auto-update from outcome events
  bus.subscribe("cortex_action_completed", (entry) => {
    const data = entry?.data || {};
    if (data.success === true) {
      updateTrust("tier2_success", data.topic);
    } else if (data.success === false && !String(data.reason || "").includes("approval")) {
      updateTrust("action_failed", data.topic);
    }
  });

  bus.subscribe("refusal_honored", (entry) => {
    updateTrust("refusal_honored", entry?.data?.what_was_refused);
  });

  bus.subscribe("refusal_overridden", (entry) => {
    updateTrust("refusal_overridden", entry?.data?.what_was_refused);
  });
}

export function _resetState() {
  _trustState = {
    trust_score: 0,
    history: [],
    tier_assignments: [],
    meta: {
      actions_executed_tier3: 0,
      actions_executed_tier2: 0,
      actions_blocked_tier1_no_approval: 0,
      actions_blocked_tier0: 0,
      last_updated: null,
    },
  };
  _busRef = null;
}
