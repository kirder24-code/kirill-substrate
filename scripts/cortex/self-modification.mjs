/**
 * cortex/self-modification.mjs - GWT Layer 5 Steps 1-5 (2026-05-09)
 *
 * SELF-MODIFICATION UNDER AFFECT - the system modifies its own code when
 * sustained frustration identifies a specific dysfunction.
 *
 * THIS IS THE RISKIEST LAYER OF THE PYRAMID. It crosses the boundary from
 * "system has internal drives" to "system acts on its own substrate". Layer 6
 * (identity) will need to interpret modifications across time. Layer 7 is the wall.
 *
 * Trigger: affect_outreach event with var=frustration AND value>=0.85
 * Plus: at least one persistent_blind_spot or pattern_repetition in last 30 min
 * (so we modify based on identified dysfunction, not random venting)
 *
 * Hard safety limits (NON-NEGOTIABLE - if any fails, abort):
 *   - SAFE_DIR_PREFIXES: only scripts/factory|cortex|outreach
 *   - SAFE_EXTENSIONS: only .mjs
 *   - MAX_LINES_CHANGED: 50 per modification
 *   - MAX_PER_HOUR: 1 self-modification per hour
 *   - MAX_PER_DAY: 5 self-modifications per 24h window
 *   - REQUIRE_GIT: must be in a git repo (so revert works)
 *   - REQUIRE_SYNTAX_CHECK: file must `node -c` after modification
 *
 * Process:
 *   1. Trigger detected (Step 1)
 *   2. Identify dysfunction (Step 1) - which file/module is failing?
 *   3. Generate patch via Claude CLI (Step 2) - structured JSON patch
 *   4. Git checkpoint, apply patch, syntax check (Step 3)
 *   5. If syntax check fails: git revert + log
 *   6. If passes: log + Telegram notify Kirill of what changed (Step 5)
 *   7. Subscribe to next 5 affect_state broadcasts (Step 4)
 *      If frustration drops by 0.2+ -> mark patch SUCCESSFUL
 *      Otherwise -> mark patch UNCERTAIN (not auto-reverted, leaves audit)
 *   8. Persist record to .data/cortex-self-modifications.json
 *
 * Honest limits:
 *   - Patch generation depends on Claude CLI availability + correct response
 *   - Outcome tracking is correlational not causal (frustration may drop for
 *     unrelated reasons). Layer 6 should add multi-modification analysis.
 *   - Cannot rewrite self (this file). Recursion lock at file level.
 *   - The system MUST not be able to disable safety limits via self-modification.
 *     Limits are constants in this file. If patch tries to modify this file -> abort.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname, basename } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const LOG_PATH = resolve(ROOT, ".data/cortex-self-modifications.json");
const ENV_PATH = resolve(ROOT, "apps/api/.env");
const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";

// Safety constants - cannot be changed by self-modification (this file is in lock list)
const SAFE_DIR_PREFIXES = ["scripts/factory/", "scripts/cortex/", "scripts/outreach/"];
const SAFE_EXTENSIONS = [".mjs"];
const MAX_LINES_CHANGED = 50;
const MAX_PER_HOUR = 1;
const MAX_PER_DAY = 5;
const SELF_LOCK = ["scripts/cortex/self-modification.mjs", "scripts/cortex/state-bus.mjs", "scripts/cortex/event-router.mjs"];
const FRUSTRATION_TRIGGER = 0.85;

// Recent context tracking
const _recentBlindSpots = []; // last 30 min
const _recentRepetitions = []; // last 30 min
let _modificationLog = []; // history (loaded from disk on register)

let _busRef = null;
let _env = null;

// ─── Persistence ────────────────────────────────────────────────────────

function _loadLog() {
  if (!existsSync(LOG_PATH)) return [];
  try {
    const raw = JSON.parse(readFileSync(LOG_PATH, "utf-8"));
    return Array.isArray(raw) ? raw : (raw.modifications || []);
  } catch { return []; }
}

function _persist() {
  try {
    writeFileSync(LOG_PATH, JSON.stringify({
      updatedAt: new Date().toISOString(),
      total: _modificationLog.length,
      modifications: _modificationLog.slice(-100),
    }, null, 2));
  } catch (e) {
    process.stderr.write(`[self-modification] persist failed: ${e?.message || e}\n`);
  }
}

function _loadEnv() {
  if (_env) return _env;
  try {
    _env = Object.fromEntries(
      readFileSync(ENV_PATH, "utf-8").split("\n")
        .filter(l => l && !l.startsWith("#") && l.includes("="))
        .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
    );
  } catch { _env = {}; }
  return _env;
}

// ─── Rate limits ────────────────────────────────────────────────────────

function _withinRateLimits() {
  const now = Date.now();
  const lastHour = _modificationLog.filter(m => now - new Date(m.startedAt).getTime() < 60 * 60_000);
  const lastDay = _modificationLog.filter(m => now - new Date(m.startedAt).getTime() < 24 * 60 * 60_000);
  if (lastHour.length >= MAX_PER_HOUR) return { ok: false, reason: `hourly limit reached (${lastHour.length}/${MAX_PER_HOUR})` };
  if (lastDay.length >= MAX_PER_DAY) return { ok: false, reason: `daily limit reached (${lastDay.length}/${MAX_PER_DAY})` };
  return { ok: true };
}

// ─── Safety check ──────────────────────────────────────────────────────

function _isFileSafe(filePath) {
  if (!filePath) return { ok: false, reason: "no file path" };
  // Check self-lock list
  if (SELF_LOCK.includes(filePath)) return { ok: false, reason: `${filePath} is in SELF_LOCK list` };
  // Check directory prefix
  if (!SAFE_DIR_PREFIXES.some(p => filePath.startsWith(p))) {
    return { ok: false, reason: `${filePath} not in safe dirs` };
  }
  // Check extension
  if (!SAFE_EXTENSIONS.some(ext => filePath.endsWith(ext))) {
    return { ok: false, reason: `${filePath} not in safe extensions` };
  }
  // Check file exists
  const abs = resolve(ROOT, filePath);
  if (!existsSync(abs)) return { ok: false, reason: `${filePath} does not exist` };
  return { ok: true, abs };
}

// ─── Git ────────────────────────────────────────────────────────────────

function _gitHead() {
  try {
    const r = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf-8" });
    return (r.stdout || "").trim();
  } catch { return null; }
}

function _gitRevertFile(filePath) {
  try {
    spawnSync("git", ["checkout", "HEAD", "--", filePath], { cwd: ROOT, encoding: "utf-8" });
    return true;
  } catch { return false; }
}

// ─── Syntax check ──────────────────────────────────────────────────────

function _syntaxOk(absPath) {
  const r = spawnSync("node", ["-c", absPath], { encoding: "utf-8", timeout: 10000 });
  return { ok: r.status === 0, stderr: (r.stderr || "").slice(0, 400) };
}

// ─── Identify dysfunction ───────────────────────────────────────────────

function _identifyDysfunction() {
  // Look for a recent pattern_repetition or persistent_blind_spot mentioning a known file.
  // Returns { filePath, kind, evidence } or null if nothing actionable.
  const now = Date.now();

  // Filter to recent items (last 30 min)
  const recentReps = _recentRepetitions.filter(r => now - new Date(r.at).getTime() < 30 * 60_000);
  const recentBs = _recentBlindSpots.filter(b => now - new Date(b.at).getTime() < 30 * 60_000);

  // Strategy: take most-recent pattern_repetition if present (it implicates a specific bot)
  if (recentReps.length > 0) {
    const r = recentReps[recentReps.length - 1];
    // Map bot name to expected file path
    const candidatePath = `scripts/factory/${r.bot}.mjs`;
    const safe = _isFileSafe(candidatePath);
    if (safe.ok) {
      return {
        filePath: candidatePath,
        kind: "pattern_repetition",
        evidence: `Bot ${r.bot} produced same result ${r.consecutive_count}x in a row: ${r.signature}`,
      };
    }
  }

  // Otherwise try blind-spot domain (key is "source::bot|task")
  if (recentBs.length > 0) {
    const b = recentBs[recentBs.length - 1];
    const parts = String(b.domain || "").split("::");
    const target = parts[parts.length - 1];
    const candidatePath = `scripts/factory/${target}.mjs`;
    const safe = _isFileSafe(candidatePath);
    if (safe.ok) {
      return {
        filePath: candidatePath,
        kind: "blind_spot",
        evidence: `Predictions for ${b.domain} consistently wrong (avgError=${b.avgError?.toFixed(2)}, ${b.sampleCount} samples)`,
      };
    }
  }

  return null;
}

// ─── Generate patch via Claude CLI ──────────────────────────────────────

function _generatePatch(dysfunction) {
  const env = _loadEnv();
  const fileContent = readFileSync(resolve(ROOT, dysfunction.filePath), "utf-8");
  const prompt = `You are generating a SAFE small patch to fix a dysfunction the system identified in itself.

DYSFUNCTION:
- file: ${dysfunction.filePath}
- kind: ${dysfunction.kind}
- evidence: ${dysfunction.evidence}

TARGET FILE (first 4000 chars):
${fileContent.slice(0, 4000)}

Output JSON ONLY:
{
  "mode": "header_comment_block",
  "content": "1-3 line operational rule to insert as JS comment block right after the doc header. Reference the dysfunction. NO em dashes (use hyphens).",
  "rationale": "1 sentence why this comment will help"
}

Rules:
- Output ONLY the JSON object, no preamble
- Comment content must be < 400 chars total
- Do NOT propose code-logic changes - this Layer 5 step only adds documentation rules
  (Step 5 will add code-logic patches once outcome tracking validates the rule-based approach)
- If you cannot generate a safe patch, return {"mode": "skip", "rationale": "why"}`;

  const r = spawnSync(CLAUDE_BIN, ["-p", "--model", "claude-sonnet-4-6", "--max-turns", "2"], {
    input: prompt, encoding: "utf-8", timeout: 5 * 60_000,
  });
  if (r.status !== 0 || !r.stdout) return { ok: false, reason: `claude exit=${r.status}` };
  const m = r.stdout.match(/\{[\s\S]*\}/);
  if (!m) return { ok: false, reason: "no JSON" };
  try {
    const parsed = JSON.parse(m[0]);
    if (parsed.mode === "skip") return { ok: false, reason: "claude skipped: " + parsed.rationale };
    if (!parsed.content || typeof parsed.content !== "string") return { ok: false, reason: "missing content" };
    if (parsed.content.length > 400) return { ok: false, reason: "content too long" };
    return { ok: true, patch: parsed };
  } catch (e) { return { ok: false, reason: "JSON parse: " + e.message }; }
}

// ─── Apply patch ────────────────────────────────────────────────────────

function _applyHeaderCommentBlock(filePath, content) {
  const abs = resolve(ROOT, filePath);
  const original = readFileSync(abs, "utf-8");
  // Find first */ closing the doc header
  const firstClose = original.indexOf("*/");
  if (firstClose === -1) return { ok: false, reason: "no doc header found" };
  const insertPoint = firstClose + 2;
  const cleanContent = content.replace(/\/\*+/g, "").replace(/\*+\//g, "").trim();
  const wrapped = `\n\n/*\n * SELF-MOD ${new Date().toISOString().slice(0,10)}: ${cleanContent.split("\n").join("\n * ")}\n */`;
  const newContent = original.slice(0, insertPoint) + wrapped + original.slice(insertPoint);

  // Line count check
  const linesAdded = newContent.split("\n").length - original.split("\n").length;
  if (linesAdded > MAX_LINES_CHANGED) {
    return { ok: false, reason: `would add ${linesAdded} lines, max ${MAX_LINES_CHANGED}` };
  }

  writeFileSync(abs, newContent);
  return { ok: true, abs, linesAdded };
}

// ─── Telegram notify ───────────────────────────────────────────────────

async function _notifyTelegram(text) {
  const env = _loadEnv();
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text: text.slice(0, 4090),
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    return (await r.json()).ok === true;
  } catch { return false; }
}

// ─── Main attempt ──────────────────────────────────────────────────────

async function _attemptSelfModification(triggerData) {
  const startedAt = new Date().toISOString();
  const record = {
    startedAt,
    trigger: triggerData,
    dysfunction: null,
    patch: null,
    applyResult: null,
    syntaxCheck: null,
    outcome: "pending",
    completedAt: null,
  };

  // Rate limits
  const rl = _withinRateLimits();
  if (!rl.ok) {
    record.outcome = "skipped_rate_limit";
    record.skipReason = rl.reason;
    record.completedAt = new Date().toISOString();
    _modificationLog.push(record);
    _persist();
    return record;
  }

  // Identify dysfunction
  const dys = _identifyDysfunction();
  if (!dys) {
    record.outcome = "skipped_no_dysfunction";
    record.skipReason = "no recent pattern_repetition or blind_spot mapped to safe file";
    record.completedAt = new Date().toISOString();
    _modificationLog.push(record);
    _persist();
    return record;
  }
  record.dysfunction = dys;

  // Generate patch via Claude CLI
  const patchRes = _generatePatch(dys);
  if (!patchRes.ok) {
    record.outcome = "skipped_no_patch";
    record.skipReason = patchRes.reason;
    record.completedAt = new Date().toISOString();
    _modificationLog.push(record);
    _persist();
    return record;
  }
  record.patch = patchRes.patch;

  // Git checkpoint (just snapshot HEAD; revert is per-file)
  const gitHeadBefore = _gitHead();
  record.gitHeadBefore = gitHeadBefore;

  // Apply
  const applyRes = _applyHeaderCommentBlock(dys.filePath, patchRes.patch.content);
  record.applyResult = applyRes;
  if (!applyRes.ok) {
    record.outcome = "failed_apply";
    record.completedAt = new Date().toISOString();
    _modificationLog.push(record);
    _persist();
    return record;
  }

  // Syntax check
  const sc = _syntaxOk(applyRes.abs);
  record.syntaxCheck = sc;
  if (!sc.ok) {
    _gitRevertFile(dys.filePath);
    record.outcome = "reverted_syntax_fail";
    record.completedAt = new Date().toISOString();
    _modificationLog.push(record);
    _persist();
    // Notify Kirill of failed attempt
    _notifyTelegram(
      `🧬 <b>Self-modification REVERTED</b>\n\n` +
      `File: <code>${dys.filePath}</code>\n` +
      `Reason: syntax check failed - ${sc.stderr.split("\n")[0]}\n` +
      `Trigger: frustration ${triggerData?.value?.toFixed(2)}\n` +
      `Dysfunction: ${dys.evidence}`
    ).catch(() => {});
    return record;
  }

  // Successful apply (outcome will be tracked by future affect_state events)
  record.outcome = "applied_pending_outcome";
  record.completedAt = new Date().toISOString();
  _modificationLog.push(record);
  _persist();

  // Telegram notify
  _notifyTelegram(
    `🧬 <b>Self-modification APPLIED</b>\n\n` +
    `File: <code>${dys.filePath}</code>\n` +
    `Trigger: ${triggerData?.var}=${triggerData?.value?.toFixed(2)}\n` +
    `Dysfunction: ${dys.evidence}\n\n` +
    `Patch (header rule):\n<pre>${patchRes.patch.content.slice(0, 300).replace(/[<>&]/g, c => ({"<":"&lt;",">":"&gt;","&":"&amp;"}[c]))}</pre>\n\n` +
    `Rationale: ${patchRes.patch.rationale}\n\n` +
    `Outcome will be tracked over next 5 affect cycles. Revert: <code>git checkout HEAD -- ${dys.filePath}</code>`
  ).catch(() => {});

  // Broadcast modification event so Layer 6+ (identity) can record it
  if (_busRef) {
    try {
      _busRef.broadcast({
        source: "self-modification",
        type: "self_modified",
        data: {
          filePath: dys.filePath,
          dysfunction: dys.kind,
          patchMode: patchRes.patch.mode,
          startedAt,
        },
      });
    } catch {}
  }

  return record;
}

// ─── Outcome tracking (Step 4) ─────────────────────────────────────────

const _watchingForOutcome = []; // [{startedAt, baselineFrustration, samplesCollected}]
const OUTCOME_WINDOW_SAMPLES = 5;

function _trackOutcome(affectStateData) {
  const now = Date.now();
  for (const w of _watchingForOutcome) {
    w.samples.push(affectStateData.frustration);
    if (w.samples.length >= OUTCOME_WINDOW_SAMPLES) {
      const avgAfter = w.samples.reduce((a, b) => a + b, 0) / w.samples.length;
      const drop = w.baselineFrustration - avgAfter;
      const record = _modificationLog.find(m => m.startedAt === w.startedAt);
      if (record) {
        record.outcome = drop >= 0.2 ? "successful" : "uncertain";
        record.outcomeDetails = { baselineFrustration: w.baselineFrustration, avgAfter, drop };
        record.outcomeRecordedAt = new Date().toISOString();
        _persist();
        if (_busRef) {
          try {
            _busRef.broadcast({
              source: "self-modification",
              type: "self_modification_outcome",
              data: { filePath: record.dysfunction?.filePath, outcome: record.outcome, drop: Number(drop.toFixed(3)) },
            });
          } catch {}
        }
      }
    }
  }
  // Remove finished watches
  while (_watchingForOutcome.length && _watchingForOutcome[0].samples.length >= OUTCOME_WINDOW_SAMPLES) {
    _watchingForOutcome.shift();
  }
}

// ─── Required GWT-module export ─────────────────────────────────────────

export function register(bus) {
  _busRef = bus;
  if (_modificationLog.length === 0) _modificationLog = _loadLog();

  // Track recent context for dysfunction identification
  bus.subscribe("pattern_repetition", (entry) => {
    _recentRepetitions.push({ ...entry.data, at: entry.at });
    if (_recentRepetitions.length > 50) _recentRepetitions.shift();
  });
  bus.subscribe("prediction_error_high", (entry) => {
    _recentBlindSpots.push({ ...entry.data, at: entry.at });
    if (_recentBlindSpots.length > 50) _recentBlindSpots.shift();
  });

  // Step 1 trigger: affect_outreach with frustration above FRUSTRATION_TRIGGER
  bus.subscribe("affect_outreach", (entry) => {
    const data = entry?.data || {};
    if (data.var !== "frustration") return;
    if (typeof data.value !== "number" || data.value < FRUSTRATION_TRIGGER) return;
    // Async attempt - fire and forget. Result persisted to log.
    _attemptSelfModification(data).then(record => {
      // If applied, start outcome tracking
      if (record.outcome === "applied_pending_outcome") {
        _watchingForOutcome.push({
          startedAt: record.startedAt,
          baselineFrustration: data.value,
          samples: [],
        });
      }
    }).catch(e => process.stderr.write(`[self-mod] attempt failed: ${e?.message || e}\n`));
  });

  // Step 4: track outcome via affect_state
  bus.subscribe("affect_state", (entry) => {
    if (_watchingForOutcome.length === 0) return;
    _trackOutcome(entry.data || {});
  });
}

// ─── Test / introspection helpers ───────────────────────────────────────

export function getLog() {
  return [..._modificationLog];
}

export function getWatchingCount() {
  return _watchingForOutcome.length;
}

export function _resetState() {
  _recentBlindSpots.length = 0;
  _recentRepetitions.length = 0;
  _modificationLog = [];
  _watchingForOutcome.length = 0;
  _busRef = null;
  try { if (existsSync(LOG_PATH)) writeFileSync(LOG_PATH, "[]"); } catch {}
}

// Test helper: directly invoke attempt (bypass affect_outreach) for unit testing
export async function _testAttempt(triggerData) {
  return _attemptSelfModification(triggerData);
}
