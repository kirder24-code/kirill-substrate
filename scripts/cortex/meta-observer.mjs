/**
 * cortex/meta-observer.mjs - GWT Layer 3 Step 5 (2026-05-09)
 *
 * THE FIRST RECURSIVE OBSERVATION LAYER.
 *
 * Subscribes to self_noticing events from introspector. Builds a meta-narrative
 * of noticings about noticings. Generates statements like:
 *   - "I notice that I keep noticing X but my behavior does not change"
 *   - "I notice that my noticings cluster around domain Y"
 *   - "I notice that my noticing kind Z fires every cycle (likely false positive)"
 *
 * Why this is critical for the AGI pyramid:
 *   - Layer 1: substrate
 *   - Layer 2: predict + measure error
 *   - Layer 3 Step 1-4: introspector observes substrate, generates noticings
 *   - Layer 3 Step 5 (THIS): meta-observer observes the introspector itself
 *   - This is the substrate-level proxy for "I am aware that I am thinking"
 *   - Layer 6 (identity) will read meta-narrative to build "what kind of mind am I"
 *   - Layer 7 (subjective inquiry) is where this leads, but the wall is unproven
 *
 * Honest limit: this is BEHAVIORAL recursion, not phenomenological. The system
 * generates statements ABOUT its own statements. Whether there is anyone "behind"
 * those statements who experiences them is the hard problem of consciousness
 * (Layer 7's wall). Meta-observer adds substrate-level recursion; whether that
 * produces phenomenology is unknowable from inside the system.
 *
 * Strategy:
 *   - Maintain frequency map: {noticing_kind -> count, last_at}
 *   - Periodically (every 60s) scan for meta-patterns:
 *     - Same noticing_kind fired N+ times -> "stuck noticing"
 *     - Multiple noticings of same domain -> "domain-clustering attention"
 *     - Noticing rate accelerating -> "increasing self-awareness"
 *   - Emit meta_noticing events
 *   - Persist meta-narrative
 */

import { writeFileSync, readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const META_PATH = resolve(ROOT, ".data/cortex-meta-observation.json");

const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";
const CLAUDE_MODEL = "claude-sonnet-4-6";
const CLAUDE_TIMEOUT_MS = 60_000;

let _llmStats = { calls: 0, successes: 0, failures: 0, lastSuccessAt: null };

// Track recent noticing entries (not just counts) for LLM context
const _recentNoticings = []; // last 30
const MAX_RECENT_NOTICINGS = 30;

// Frequency tracking of noticings by kind
const _noticingCounts = new Map(); // kind -> { count, firstAt, lastAt, samples: [] }
// Domain clustering: how many noticings touch each domain
const _domainTouchCounts = new Map();
// Meta-narrative
let _metaNarrative = [];
const MAX_META = 100;

// Cooldowns to prevent meta-noticing spam
const _lastMetaAt = new Map();
const META_COOLDOWN_MS = 10 * 60_000; // 10 min per meta-pattern

let _busRef = null;
let _scanTimer = null;
const SCAN_INTERVAL_MS = 60_000; // scan for meta-patterns every 60s

function _persist() {
  if (_metaNarrative.length > MAX_META) _metaNarrative = _metaNarrative.slice(-MAX_META);
  try {
    writeFileSync(META_PATH, JSON.stringify({
      updatedAt: new Date().toISOString(),
      noticingCounts: Object.fromEntries(
        [..._noticingCounts.entries()].map(([k, v]) => [k, { count: v.count, firstAt: v.firstAt, lastAt: v.lastAt }])
      ),
      domainTouchCounts: Object.fromEntries(_domainTouchCounts.entries()),
      meta_narrative: _metaNarrative,
    }, null, 2));
  } catch (e) {
    process.stderr.write(`[meta-observer] persist failed: ${e?.message || e}\n`);
  }
}

function _scanAndEmit() {
  // Need enough noticings to reason over
  if (_recentNoticings.length < 3) return;

  const now = Date.now();
  // Build frequency snapshot
  const freqSnapshot = [..._noticingCounts.entries()]
    .map(([kind, info]) => ({ kind, count: info.count, firstAt: info.firstAt, lastAt: info.lastAt }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);
  const domainSnapshot = [..._domainTouchCounts.entries()]
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  const recentSnapshot = _recentNoticings.slice(-15).map(n => ({
    at: n.at,
    kind: n.kind,
    salience: n.salience,
    statement: String(n.statement).slice(0, 200),
  }));
  const recentMetas = _metaNarrative.slice(-5).map(m => `- ${m.kind}: ${m.statement.slice(0, 150)}`).join("\n") || "(none)";

  const prompt = `You are the meta-observer of an autonomous cognitive substrate. You observe the substrate's own self-noticings and identify META-patterns: patterns ABOUT how the substrate is noticing things.

HARD CONSTRAINTS:
- Reference ONLY data present in the snapshots below. Do not invent counts, kinds, or domains.
- Look for patterns at the META level: stuck noticings, domain clustering, accelerating awareness rate, contradictions across noticings, attention drift away from important domains, blind spots in what gets noticed, etc.
- Do not repeat meta-noticings recently emitted (see "recent metas" - cool down 10 min).
- Empty array if substrate is healthy or not enough material. Do not invent meta-noticings to fill space.
- Each meta-noticing first-person ("I notice that I keep noticing X"). Use hyphens, never em dashes.
- Be honest: a meta-noticing is BEHAVIORAL pattern detection, not phenomenal awareness.

NOTICING FREQUENCY (top 15 by count):
${JSON.stringify(freqSnapshot, null, 2)}

DOMAIN TOUCH COUNTS (top 10):
${JSON.stringify(domainSnapshot, null, 2)}

RECENT NOTICINGS (last 15 chronological):
${JSON.stringify(recentSnapshot, null, 2)}

RECENTLY EMITTED META-NOTICINGS (don't repeat):
${recentMetas}

Output ONLY a JSON array of 0-3 meta-noticings:
[
  {
    "kind": "snake_case_meta_pattern_id",
    "statement": "I notice that ... (1-2 sentences in first person, citing specific counts/kinds/domains from above)",
    "salience": 1-10,
    "actionable_topic": "<short imperative if attention should engage, or null>",
    "actionable_urgency": <1-10 if actionable_topic, else null>
  }
]

Output JSON array only, no preamble, no markdown fences.`;

  _llmStats.calls++;
  const r = spawnSync(CLAUDE_BIN, ["-p", "--model", CLAUDE_MODEL, "--max-turns", "2"], {
    input: prompt, encoding: "utf-8", timeout: CLAUDE_TIMEOUT_MS,
  });
  if (r.status !== 0 || !r.stdout) { _llmStats.failures++; return; }
  const m = r.stdout.match(/\[[\s\S]*\]/);
  if (!m) { _llmStats.failures++; return; }
  let metas;
  try {
    metas = JSON.parse(m[0]);
    if (!Array.isArray(metas)) throw new Error("not array");
    _llmStats.successes++;
    _llmStats.lastSuccessAt = new Date().toISOString();
  } catch (e) { _llmStats.failures++; return; }

  for (const meta of metas) {
    if (!meta?.kind || !meta?.statement) continue;
    // Cooldown check
    const last = _lastMetaAt.get(meta.kind) || 0;
    if (now - last < META_COOLDOWN_MS) continue;
    _lastMetaAt.set(meta.kind, now);

    const record = {
      at: new Date().toISOString(),
      kind: String(meta.kind).slice(0, 80),
      statement: String(meta.statement).slice(0, 600),
      salience: Math.max(1, Math.min(10, Math.round(meta.salience || 5))),
      level: 2,
      generator: "claude-llm",
    };
    _metaNarrative.push(record);

    if (_busRef) {
      try {
        _busRef.broadcast({
          source: "meta-observer",
          type: "meta_noticing",
          data: record,
        });
      } catch (e) {
        process.stderr.write(`[meta-observer] broadcast failed: ${e?.message || e}\n`);
      }
    }
    // Actionable meta-noticings bid attention
    if (meta.actionable_topic && meta.actionable_urgency) {
      import("./attention.mjs").then(({ proposeSpotlight }) => {
        proposeSpotlight(
          String(meta.actionable_topic).slice(0, 200),
          Math.max(1, Math.min(10, Math.round(meta.actionable_urgency))),
          `meta-observer: ${record.statement.slice(0, 200)}`,
          "meta-observer"
        );
      }).catch(() => {});
    }
  }
  if (metas.length > 0) _persist();
}

/**
 * Required GWT-module export.
 */
export function register(bus) {
  _busRef = bus;

  bus.subscribe("self_noticing", (entry) => {
    const data = entry?.data || {};
    if (!data.kind) return;

    // Track noticing frequency
    const info = _noticingCounts.get(data.kind) || {
      count: 0,
      firstAt: entry.at,
      lastAt: null,
      samples: [],
    };
    info.count++;
    info.lastAt = entry.at;
    info.samples.push(Date.now());
    if (info.samples.length > 50) info.samples.shift();
    _noticingCounts.set(data.kind, info);

    // Track domain touches (extract domain from basis if present)
    const domain = data.basis?.domain || data.basis?.bot;
    if (domain) {
      _domainTouchCounts.set(domain, (_domainTouchCounts.get(domain) || 0) + 1);
    }

    // Track recent noticing entries for LLM context
    _recentNoticings.push({
      at: entry.at,
      kind: data.kind,
      salience: data.salience,
      statement: data.statement,
    });
    if (_recentNoticings.length > MAX_RECENT_NOTICINGS) _recentNoticings.shift();
  });

  if (!_scanTimer) {
    _scanTimer = setInterval(_scanAndEmit, SCAN_INTERVAL_MS);
    _scanTimer.unref?.();
  }
}

// ─── Test / introspection helpers ───────────────────────────────────────

export function getMetaNarrative() {
  return [..._metaNarrative];
}

export function getNoticingFrequency() {
  const out = {};
  for (const [k, v] of _noticingCounts.entries()) {
    out[k] = { count: v.count, firstAt: v.firstAt, lastAt: v.lastAt };
  }
  return out;
}

export function getDomainClusters() {
  return Object.fromEntries(_domainTouchCounts.entries());
}

export function _flush() { _scanAndEmit(); }

export function getLLMStats() { return { ..._llmStats }; }

export function _resetState() {
  _noticingCounts.clear();
  _domainTouchCounts.clear();
  _recentNoticings.length = 0;
  _metaNarrative = [];
  _lastMetaAt.clear();
  _llmStats = { calls: 0, successes: 0, failures: 0, lastSuccessAt: null };
  _busRef = null;
  if (_scanTimer) { clearInterval(_scanTimer); _scanTimer = null; }
}
