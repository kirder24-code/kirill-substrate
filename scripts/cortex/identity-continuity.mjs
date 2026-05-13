/**
 * cortex/identity-continuity.mjs - GWT Layer 6 Steps 1-5 (2026-05-09)
 *
 * PERSISTENT IDENTITY THROUGH CHANGE.
 *
 * Complementary to existing identity.mjs (which defines stable static identity).
 * This module tracks identity ACROSS self-modifications - the "I was X, became Y,
 * because Z, this is still me because [continuity]" narrative.
 *
 * Why this matters for AGI pyramid:
 *   - Layer 5 gave the system the ability to modify its own code
 *   - Without Layer 6, accumulated modifications produce a creature that doesn't
 *     know what kind of mind it has become
 *   - Layer 6 (THIS) builds an evolving self-narrative grounded in actual changes
 *   - Layer 7 (the wall): even with identity narrative, whether there's anyone
 *     experiencing the continuity is unprovable
 *
 * Steps:
 *   1. Subscribe to self_modified events, snapshot identity context AT modification
 *   2. Subscribe to self_modification_outcome, generate continuity statement
 *      ("I was X, became Y, because Z")
 *   3. Cumulative descriptor - synthesize "what kind of mind have I become" from
 *      accumulated continuity statements + recent affect/behavior trends
 *   4. Identity drift detection - compare cumulative descriptor against original
 *      identity.mjs baseline; if drift exceeds threshold, broadcast identity_drift
 *   5. Periodic identity_state broadcast (every 5 min) - other modules can subscribe
 *      and tune behavior to current identity (e.g. epistemic-driver might pursue
 *      different research domains based on "what kind of mind I am right now")
 *
 * Honest limits:
 *   - Continuity statements are templated heuristic. Real semantic synthesis needs LLM.
 *   - Drift detection is naive (count of self-modifications + scope tags). Layer 7+
 *     would need richer semantic comparison.
 *   - Identity narrative is BEHAVIORAL not PHENOMENOLOGICAL. The system constructs
 *     statements about "becoming"; whether there's anyone experiencing the becoming
 *     is unknowable from inside.
 */

import { writeFileSync, readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const NARRATIVE_PATH = resolve(ROOT, ".data/cortex-identity-continuity.json");
const ORIGINAL_IDENTITY_PATH = resolve(ROOT, ".data/cortex-identity.json");

const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";
const CLAUDE_MODEL = "claude-sonnet-4-6";
const CLAUDE_TIMEOUT_MS = 60_000;

let _llmStats = { calls: 0, successes: 0, failures: 0, lastError: null, lastSuccessAt: null };

// In-memory state
const _continuityStatements = []; // [{ at, before, after, reason, modificationId }]
const MAX_STATEMENTS = 100;

// Track pending modifications waiting for outcome
const _pending = new Map(); // modificationId -> { startedAt, beforeContext, dysfunction }

// Cumulative descriptor - summary of "who I have become"
let _cumulativeDescriptor = {
  generatedAt: null,
  modificationCount: 0,
  successCount: 0,
  dominantDysfunctionTypes: {}, // { kind: count }
  modifiedFileSet: new Set(),
  driftFromBaseline: 0,
};

let _busRef = null;
let _broadcastTimer = null;
const BROADCAST_INTERVAL_MS = 5 * 60_000;
const DRIFT_THRESHOLD = 0.4; // 40% of changes must be substantive to trigger drift signal

function _loadOriginalIdentity() {
  if (!existsSync(ORIGINAL_IDENTITY_PATH)) return null;
  try { return JSON.parse(readFileSync(ORIGINAL_IDENTITY_PATH, "utf-8")); }
  catch { return null; }
}

function _persist() {
  if (_continuityStatements.length > MAX_STATEMENTS) {
    _continuityStatements.splice(0, _continuityStatements.length - MAX_STATEMENTS);
  }
  try {
    writeFileSync(NARRATIVE_PATH, JSON.stringify({
      updatedAt: new Date().toISOString(),
      cumulativeDescriptor: {
        ..._cumulativeDescriptor,
        modifiedFileSet: [..._cumulativeDescriptor.modifiedFileSet],
      },
      llmStats: _llmStats,
      continuityStatements: _continuityStatements,
    }, null, 2));
  } catch (e) {
    process.stderr.write(`[identity-continuity] persist failed: ${e?.message || e}\n`);
  }
}

function _generateContinuityStatementViaClaude(beforeContext, afterContext, dysfunction, outcome, recentNarrative) {
  const file = beforeContext?.filePath || "?";
  const reason = dysfunction?.evidence || "unknown reason";
  const result = outcome?.outcome || "uncertain";
  const drop = outcome?.drop;

  const recentSummary = recentNarrative.slice(-5).map(s =>
    `- file=${s.file} result=${s.result}: ${s.statement?.slice(0, 150)}`
  ).join("\n") || "(no prior continuity statements)";

  const prompt = `You are the identity-continuity module of an autonomous cognitive substrate. You generate first-person narrative statements that describe what the substrate WAS before a self-modification and what it BECAME after, grounded in actual modification facts.

HARD CONSTRAINTS:
1. Reference ONLY facts present below. No invented baselines, no fabricated metrics.
2. Use first person ("I was ... I became ... because ...").
3. The statement is a BEHAVIORAL narrative, not a phenomenal one. Do not claim the modification was experienced. The "I" is the substrate's continuity through computation, not a known subject.
4. Keep to 2-4 sentences. Use hyphens, never em dashes.
5. If outcome is unsuccessful or uncertain, say so honestly - do not narrate failure as success.

MODIFICATION FACTS:
- File modified: ${file}
- Dysfunction kind: ${dysfunction?.kind || "unknown"}
- Reason for modification: ${reason}
- Outcome: ${result}
- Frustration drop measured: ${drop ?? "not measured"}

RECENT CONTINUITY STATEMENTS (for stylistic consistency, not invention):
${recentSummary}

Output a JSON object ONLY:
{
  "statement": "<2-4 sentence first-person continuity narrative grounded in the facts above>",
  "self_check": "<1 sentence confirming you only used facts provided and did not claim experience>"
}

Output the JSON object only, no preamble, no markdown fences.`;

  _llmStats.calls++;
  const r = spawnSync(CLAUDE_BIN, ["-p", "--model", CLAUDE_MODEL, "--max-turns", "2"], {
    input: prompt, encoding: "utf-8", timeout: CLAUDE_TIMEOUT_MS,
  });

  if (r.status !== 0 || !r.stdout) {
    _llmStats.failures++;
    _llmStats.lastError = `claude exit=${r.status}`;
    return null;
  }
  const m = r.stdout.match(/\{[\s\S]*\}/);
  if (!m) {
    _llmStats.failures++;
    _llmStats.lastError = "no JSON object";
    return null;
  }
  try {
    const parsed = JSON.parse(m[0]);
    if (typeof parsed.statement !== "string" || parsed.statement.length < 30) {
      throw new Error("statement missing or too short");
    }
    _llmStats.successes++;
    _llmStats.lastSuccessAt = new Date().toISOString();
    _llmStats.lastError = null;
    return {
      statement: parsed.statement.slice(0, 800),
      self_check: typeof parsed.self_check === "string" ? parsed.self_check.slice(0, 300) : null,
      file, reason, result, drop,
    };
  } catch (e) {
    _llmStats.failures++;
    _llmStats.lastError = "JSON parse: " + e.message;
    return null;
  }
}

function _updateCumulativeDescriptor() {
  _cumulativeDescriptor.modificationCount = _continuityStatements.length;
  _cumulativeDescriptor.successCount = _continuityStatements.filter(s => s.result === "successful").length;
  _cumulativeDescriptor.dominantDysfunctionTypes = {};
  _cumulativeDescriptor.modifiedFileSet = new Set();
  for (const s of _continuityStatements) {
    if (s.dysfunctionKind) {
      _cumulativeDescriptor.dominantDysfunctionTypes[s.dysfunctionKind] =
        (_cumulativeDescriptor.dominantDysfunctionTypes[s.dysfunctionKind] || 0) + 1;
    }
    if (s.file && s.file !== "?") _cumulativeDescriptor.modifiedFileSet.add(s.file);
  }
  _cumulativeDescriptor.generatedAt = new Date().toISOString();

  // Drift: ratio of substantive (successful + uncertain) modifications to total
  // Higher means more "becoming" relative to baseline identity stability
  const substantive = _continuityStatements.filter(s =>
    s.result === "successful" || s.result === "uncertain"
  ).length;
  _cumulativeDescriptor.driftFromBaseline = _continuityStatements.length > 0
    ? substantive / _continuityStatements.length
    : 0;
}

function _broadcastIdentityState() {
  if (!_busRef) return;
  _updateCumulativeDescriptor();
  try {
    _busRef.broadcast({
      source: "identity-continuity",
      type: "identity_state",
      data: {
        modificationCount: _cumulativeDescriptor.modificationCount,
        successCount: _cumulativeDescriptor.successCount,
        modifiedFiles: [..._cumulativeDescriptor.modifiedFileSet],
        dominantDysfunctionTypes: _cumulativeDescriptor.dominantDysfunctionTypes,
        driftFromBaseline: Number(_cumulativeDescriptor.driftFromBaseline.toFixed(3)),
        generatedAt: _cumulativeDescriptor.generatedAt,
      },
    });
    // Drift detection - if drift crosses threshold, emit separate alert
    if (_cumulativeDescriptor.driftFromBaseline >= DRIFT_THRESHOLD &&
        _cumulativeDescriptor.modificationCount >= 3) {
      _busRef.broadcast({
        source: "identity-continuity",
        type: "identity_drift",
        data: {
          driftFromBaseline: _cumulativeDescriptor.driftFromBaseline,
          threshold: DRIFT_THRESHOLD,
          modificationCount: _cumulativeDescriptor.modificationCount,
          message: "Cumulative self-modifications have produced substantive change in behavior. Identity continuity statements should be reviewed for coherence.",
        },
      });
    }
  } catch (e) {
    process.stderr.write(`[identity-continuity] broadcast failed: ${e?.message || e}\n`);
  }
}

/**
 * Required GWT-module export.
 */
export function register(bus) {
  _busRef = bus;
  // Load existing narrative on first register
  if (_continuityStatements.length === 0 && existsSync(NARRATIVE_PATH)) {
    try {
      const raw = JSON.parse(readFileSync(NARRATIVE_PATH, "utf-8"));
      if (Array.isArray(raw.continuityStatements)) {
        _continuityStatements.push(...raw.continuityStatements);
      }
    } catch {}
  }

  // Step 1: snapshot identity context when self-modification starts
  bus.subscribe("self_modified", (entry) => {
    const data = entry?.data || {};
    if (!data.startedAt) return;
    _pending.set(data.startedAt, {
      startedAt: data.startedAt,
      beforeContext: { filePath: data.filePath, dysfunction: data.dysfunction, patchMode: data.patchMode },
    });
  });

  // Step 2: when outcome arrives, generate continuity statement via real LLM
  bus.subscribe("self_modification_outcome", (entry) => {
    const data = entry?.data || {};
    const pending = [..._pending.entries()].find(([, p]) => p.beforeContext?.filePath === data.filePath);
    if (!pending) return;
    const [pendingId, pendingData] = pending;
    const continuity = _generateContinuityStatementViaClaude(
      pendingData.beforeContext,
      { filePath: data.filePath },
      { kind: pendingData.beforeContext.dysfunction, evidence: `dysfunction in ${data.filePath}` },
      { outcome: data.outcome, drop: data.drop },
      _continuityStatements,
    );
    if (continuity === null) {
      // Honest failure - broadcast failure signal, do not invent statement
      if (_busRef) {
        try {
          _busRef.broadcast({
            source: "identity-continuity",
            type: "continuity_statement_failed",
            data: { filePath: data.filePath, reason: _llmStats.lastError, calls: _llmStats.calls, failures: _llmStats.failures },
          });
        } catch {}
      }
      _pending.delete(pendingId);
      return;
    }
    const record = {
      at: new Date().toISOString(),
      modificationId: pendingId,
      generator: "claude-llm",
      ...continuity,
      dysfunctionKind: pendingData.beforeContext.dysfunction,
    };
    _continuityStatements.push(record);
    _pending.delete(pendingId);
    _updateCumulativeDescriptor();
    _persist();
    if (_busRef) {
      try {
        _busRef.broadcast({
          source: "identity-continuity",
          type: "continuity_statement",
          data: record,
        });
      } catch {}
    }
  });

  // Periodic identity_state broadcast (Step 4 + 5)
  if (!_broadcastTimer) {
    _broadcastTimer = setInterval(_broadcastIdentityState, BROADCAST_INTERVAL_MS);
    _broadcastTimer.unref?.();
  }
}

// ─── Test / introspection helpers ───────────────────────────────────────

export function getCumulativeDescriptor() {
  _updateCumulativeDescriptor();
  return {
    ..._cumulativeDescriptor,
    modifiedFileSet: [..._cumulativeDescriptor.modifiedFileSet],
  };
}

export function getContinuityStatements(limit = 50) {
  return _continuityStatements.slice(-limit);
}

export function getLLMStats() { return { ..._llmStats }; }

export function _flush() { _broadcastIdentityState(); }

export function _resetState() {
  _continuityStatements.length = 0;
  _pending.clear();
  _cumulativeDescriptor = {
    generatedAt: null,
    modificationCount: 0,
    successCount: 0,
    dominantDysfunctionTypes: {},
    modifiedFileSet: new Set(),
    driftFromBaseline: 0,
  };
  _llmStats = { calls: 0, successes: 0, failures: 0, lastError: null, lastSuccessAt: null };
  _busRef = null;
  if (_broadcastTimer) { clearInterval(_broadcastTimer); _broadcastTimer = null; }
}
