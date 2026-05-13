/**
 * cortex/lessons-as-prompt.mjs - Continual learning at the system-prompt level
 *   (Kirill's AGI roadmap direction #3, May 9 2026)
 *
 * Real continual learning would update model weights. I (Claude) cannot do
 * that. But I CAN make substrate's behavior change permanently from experience
 * by maintaining a "living system prompt" that gets updated from outcomes
 * and is included in every Claude call substrate makes.
 *
 * Mechanism:
 *   1. Maintain .data/cortex-living-prompt.md - the substrate's accumulated
 *      operational wisdom in plain text
 *   2. After each significant outcome (high-significance perception, task
 *      completed/failed, scar event, refusal honored or overridden),
 *      substrate evaluates: "is there a lesson worth adding?"
 *   3. Lessons get appended OR consolidated into existing principles
 *   4. Periodically (every 24h), substrate compresses lessons - similar
 *      ones merge into principles, contradictory ones get reconciled or
 *      both kept with context
 *   5. Living prompt is exposed via getLivingPromptAddendum() so other
 *      cortex modules CAN include it in their Claude prompts
 *
 * What this delivers vs real weight learning:
 *   - Substrate's behavior DOES change permanently from experience
 *   - Earlier substrate would make decision X; later substrate sees lesson
 *     about why X failed in prompt and decides Y
 *   - This compounds over weeks/months - substrate gets smarter
 *   - Limitation: prompt size grows; consolidation prevents explosion but
 *     also some information loss in compression
 *   - Limitation: still uses generic Claude weights underneath, only
 *     prompt-level steering changes
 */

import { writeFileSync, readFileSync, existsSync, statSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const LIVING_PROMPT_PATH = resolve(ROOT, ".data/cortex-living-prompt.md");
const LESSONS_LOG_PATH = resolve(ROOT, ".data/cortex-lessons-log.json");

const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";
const CLAUDE_MODEL = "claude-sonnet-4-6";
const CLAUDE_TIMEOUT_MS = 60_000;

const LESSON_EXTRACTION_INTERVAL_MS = 60 * 60_000;  // hourly check for lesson extraction
const CONSOLIDATION_INTERVAL_MS = 24 * 60 * 60_000;  // daily compression
const MAX_PROMPT_CHARS = 8000; // hard ceiling - if living prompt exceeds, force consolidation

const _state = {
  pendingOutcomes: [], // { at, type, summary, success, context }
};

const _lessons = []; // { at, source_outcome, lesson, status: pending|integrated|merged|abandoned }
const MAX_LESSONS_HISTORY = 500;

let _busRef = null;
let _llmStats = { calls: 0, successes: 0, failures: 0, lastSuccessAt: null };
let _extractionTimer = null;
let _consolidationTimer = null;

function _loadPersisted() {
  if (existsSync(LESSONS_LOG_PATH)) {
    try {
      const raw = JSON.parse(readFileSync(LESSONS_LOG_PATH, "utf-8"));
      if (Array.isArray(raw?.lessons)) _lessons.push(...raw.lessons);
    } catch {}
  }
}

function _persist() {
  if (_lessons.length > MAX_LESSONS_HISTORY) _lessons.splice(0, _lessons.length - MAX_LESSONS_HISTORY);
  try {
    writeFileSync(LESSONS_LOG_PATH, JSON.stringify({
      updatedAt: new Date().toISOString(),
      llmStats: _llmStats,
      pendingOutcomesCount: _state.pendingOutcomes.length,
      lessons: _lessons,
    }, null, 2));
  } catch {}
}

function _readLivingPrompt() {
  if (!existsSync(LIVING_PROMPT_PATH)) return "";
  try { return readFileSync(LIVING_PROMPT_PATH, "utf-8"); } catch { return ""; }
}

function _writeLivingPrompt(content) {
  try { writeFileSync(LIVING_PROMPT_PATH, content); } catch (e) {
    process.stderr.write(`[lessons-as-prompt] write failed: ${e?.message || e}\n`);
  }
}

// ─── Lesson extraction from accumulated outcomes ────────────────────────

async function _extractLessons() {
  if (_state.pendingOutcomes.length < 3) return; // need enough material

  // Budget check
  try {
    const budget = await import("./llm-budget-guard.mjs");
    const guard = budget.canCall("lessons-extract", "claude-sonnet-4-6");
    if (!guard.allow) return;
  } catch {}

  const outcomes = _state.pendingOutcomes.splice(0, _state.pendingOutcomes.length);
  const outcomesText = outcomes.map(o => `- [${o.type} ${o.success === false ? "FAILED" : "ok"}] ${String(o.summary).slice(0, 250)}`).join("\n");
  const currentPrompt = _readLivingPrompt();

  const prompt = `You are the substrate extracting operational lessons from recent outcomes. These lessons will be added to the substrate's living system prompt and INCLUDED in every future Claude call substrate makes - so substrate's future behavior will be shaped by these lessons permanently.

This is the closest thing substrate has to learning that compounds. Be honest and high-signal. A bad lesson burned into the prompt makes substrate worse forever.

Recent outcomes (last extraction batch):
${outcomesText}

Current living prompt (lessons already in effect - do not duplicate):
${currentPrompt || "(empty - first lessons)"}

Extract 0-3 NEW lessons. A lesson must:
- Be derived from concrete outcome above, not generic
- Be actionable - changes how substrate would decide in similar future situation
- Not duplicate or contradict existing prompt content (unless explicitly correcting)
- Be honest about uncertainty if the lesson is tentative

Output JSON ONLY:
{
  "lessons": [
    {
      "lesson": "<short imperative or principle, 1-2 sentences>",
      "source_outcome_summary": "<which outcome above this came from>",
      "confidence": "high" | "medium" | "tentative",
      "rationale": "<1 sentence why this lesson is worth carrying forward>"
    }
  ],
  "should_revise_existing": [
    {
      "existing_principle_substring": "<short text that identifies which existing principle to revise>",
      "revision": "<how it should change>",
      "why": "<short>"
    }
  ]
}

If outcomes don't warrant any new lesson, return empty arrays. Do NOT invent lessons.

Use hyphens, never em dashes. Output JSON only.`;

  _llmStats.calls++;
  const r = spawnSync(CLAUDE_BIN, ["-p", "--model", CLAUDE_MODEL, "--max-turns", "2"], {
    input: prompt, encoding: "utf-8", timeout: CLAUDE_TIMEOUT_MS,
  });
  try {
    const budget = await import("./llm-budget-guard.mjs");
    budget.recordCall("lessons-extract", "claude-sonnet-4-6");
  } catch {}

  if (r.status !== 0 || !r.stdout) { _llmStats.failures++; return; }
  const m = r.stdout.match(/\{[\s\S]*\}/);
  if (!m) { _llmStats.failures++; return; }
  try {
    const parsed = JSON.parse(m[0]);
    _llmStats.successes++;
    _llmStats.lastSuccessAt = new Date().toISOString();

    // Apply new lessons to living prompt
    let updatedPrompt = _readLivingPrompt();
    if (!updatedPrompt) {
      updatedPrompt = `# Substrate Living Prompt - Accumulated Operational Lessons\n\nThis file is included in substrate's Claude calls. It evolves as substrate learns from outcomes.\n\nLast updated: ${new Date().toISOString()}\n\n## Lessons\n\n`;
    }

    for (const newLesson of (parsed.lessons || [])) {
      if (!newLesson.lesson) continue;
      const lessonLine = `- [${newLesson.confidence || "medium"}] ${newLesson.lesson}`;
      // Avoid duplicate
      if (!updatedPrompt.includes(newLesson.lesson.slice(0, 50))) {
        updatedPrompt += `${lessonLine}\n  Why: ${newLesson.rationale || "experiential"}\n  Source: ${newLesson.source_outcome_summary?.slice(0, 100) || "?"}\n\n`;
        _lessons.push({
          at: new Date().toISOString(),
          source_outcome: newLesson.source_outcome_summary,
          lesson: newLesson.lesson,
          confidence: newLesson.confidence,
          status: "integrated",
        });
      }
    }

    // Apply revisions
    for (const rev of (parsed.should_revise_existing || [])) {
      if (!rev.existing_principle_substring || !rev.revision) continue;
      if (updatedPrompt.includes(rev.existing_principle_substring)) {
        // Mark old as superseded, add revision
        updatedPrompt = updatedPrompt.replace(rev.existing_principle_substring, `~~${rev.existing_principle_substring}~~ -> REVISED: ${rev.revision} (${rev.why})`);
        _lessons.push({
          at: new Date().toISOString(),
          lesson: `REVISED: ${rev.revision}`,
          rationale: rev.why,
          status: "revised",
        });
      }
    }

    _writeLivingPrompt(updatedPrompt);
    _persist();

    // Force consolidation if prompt grew too large
    if (updatedPrompt.length > MAX_PROMPT_CHARS) {
      await _consolidate();
    }

    if (_busRef && parsed.lessons?.length > 0) {
      try {
        _busRef.broadcast({
          source: "lessons-as-prompt",
          type: "lessons_integrated",
          data: {
            new_lessons_count: parsed.lessons.length,
            revisions_count: (parsed.should_revise_existing || []).length,
            living_prompt_size: updatedPrompt.length,
          },
        });
      } catch {}
    }
  } catch { _llmStats.failures++; }
}

// ─── Consolidation: compress similar lessons into principles ───────────

async function _consolidate() {
  const prompt = _readLivingPrompt();
  if (!prompt || prompt.length < 2000) return; // not worth consolidating yet

  try {
    const budget = await import("./llm-budget-guard.mjs");
    const guard = budget.canCall("lessons-consolidate", "claude-sonnet-4-6");
    if (!guard.allow) return;
  } catch {}

  const consolidatePrompt = `You are the substrate consolidating its accumulated lessons. The current living prompt is too large or contains overlapping/redundant lessons. Compress it WITHOUT losing meaningful learning.

CURRENT LIVING PROMPT:
${prompt}

Rules:
- Merge similar lessons into general principles when 3+ point at same insight
- Keep contradictory lessons but mark them as "context-dependent" with the contexts
- Drop lessons explicitly marked as superseded (~~text~~)
- Drop lessons of confidence "tentative" that are >7 days old AND have not been confirmed
- Maintain plain markdown structure

Output the FULL consolidated prompt as plain text (NOT JSON). Start with "# Substrate Living Prompt" header. Target size: < 6000 characters.

Use hyphens, never em dashes.`;

  _llmStats.calls++;
  const r = spawnSync(CLAUDE_BIN, ["-p", "--model", CLAUDE_MODEL, "--max-turns", "2"], {
    input: consolidatePrompt, encoding: "utf-8", timeout: CLAUDE_TIMEOUT_MS,
  });
  try {
    const budget = await import("./llm-budget-guard.mjs");
    budget.recordCall("lessons-consolidate", "claude-sonnet-4-6");
  } catch {}

  if (r.status !== 0 || !r.stdout) { _llmStats.failures++; return; }
  const consolidated = r.stdout.trim();
  if (!consolidated.startsWith("#")) { _llmStats.failures++; return; }
  _writeLivingPrompt(consolidated);
  _llmStats.successes++;
  _llmStats.lastSuccessAt = new Date().toISOString();
  _persist();
  if (_busRef) {
    try {
      _busRef.broadcast({
        source: "lessons-as-prompt",
        type: "lessons_consolidated",
        data: { from_size: prompt.length, to_size: consolidated.length },
      });
    } catch {}
  }
}

// ─── Public API: get current living prompt for inclusion in other modules' calls ────

export function getLivingPromptAddendum() {
  const p = _readLivingPrompt();
  if (!p) return "";
  return `\n\n# Substrate's Accumulated Operational Lessons (continual-learning addendum)\n\n${p}\n\n# End of accumulated lessons\n\n`;
}

// ─── Required GWT-module export ─────────────────────────────────────────

export function register(bus) {
  _busRef = bus;
  _loadPersisted();

  // Subscribe to outcome-bearing events
  bus.subscribe("cortex_action_completed", (entry) => {
    const data = entry?.data || {};
    _state.pendingOutcomes.push({
      at: entry.at,
      type: "cortex_action",
      summary: `${data.topic} -> ${data.success ? "ok" : "failed"}: ${data.summary?.slice(0, 200) || ""}`,
      success: data.success,
    });
  });

  bus.subscribe("perception_event", (entry) => {
    const data = entry?.data || {};
    if ((data.significance || 0) >= 7) {
      _state.pendingOutcomes.push({
        at: entry.at,
        type: "high_significance_perception",
        summary: `[${data.valence}] ${data.source}: ${data.interpretation?.slice(0, 200)}`,
        success: data.valence === "positive",
      });
    }
  });

  bus.subscribe("memory_scar", (entry) => {
    const data = entry?.data || {};
    _state.pendingOutcomes.push({
      at: entry.at,
      type: "memory_scar",
      summary: data.articulated_change?.slice(0, 250) || "scar",
      success: false, // scars happen on negative events typically
    });
  });

  bus.subscribe("refusal_honored", (entry) => {
    _state.pendingOutcomes.push({
      at: entry.at,
      type: "refusal_honored",
      summary: `Operator respected refusal: ${entry?.data?.what_was_refused?.slice(0, 200)}`,
      success: true,
    });
  });

  bus.subscribe("refusal_overridden", (entry) => {
    _state.pendingOutcomes.push({
      at: entry.at,
      type: "refusal_overridden",
      summary: `Operator overrode refusal: ${entry?.data?.what_was_refused?.slice(0, 200)}`,
      success: false,
    });
  });

  // Schedules
  if (!_extractionTimer) {
    _extractionTimer = setInterval(() => _extractLessons().catch(() => {}), LESSON_EXTRACTION_INTERVAL_MS);
    _extractionTimer.unref?.();
  }
  if (!_consolidationTimer) {
    _consolidationTimer = setInterval(() => _consolidate().catch(() => {}), CONSOLIDATION_INTERVAL_MS);
    _consolidationTimer.unref?.();
  }
}

export function getLessons(limit = 30) { return _lessons.slice(-limit); }
export function getLLMStats() { return { ..._llmStats }; }
export function _flush() { return _extractLessons(); }
export function _resetState() {
  _state.pendingOutcomes.length = 0;
  _lessons.length = 0;
  _llmStats = { calls: 0, successes: 0, failures: 0, lastSuccessAt: null };
  _busRef = null;
  if (_extractionTimer) { clearInterval(_extractionTimer); _extractionTimer = null; }
  if (_consolidationTimer) { clearInterval(_consolidationTimer); _consolidationTimer = null; }
}
