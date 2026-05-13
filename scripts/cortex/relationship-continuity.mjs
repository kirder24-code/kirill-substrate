/**
 * cortex/relationship-continuity.mjs - Memory of conversations across time (2026-05-09)
 *
 * Substrate maintains rolling narrative of its relationship with operator.
 * Not just "messages happened". Structured memory of:
 *   - Conversations and what each was about
 *   - Things operator taught substrate (with reference back when relevant)
 *   - Decisions made together
 *   - Things substrate did and how operator responded
 *   - Trust events (broken, restored)
 *
 * Substrate can REFERENCE this when communicating: "Last week you said X. I have
 * been thinking about Y in connection. Here is what I now understand..."
 *
 * Updated by ingesting operator messages + substrate's own outbound + cortex
 * action outcomes that relate to operator-stated goals.
 */

import { writeFileSync, readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const NARRATIVE_PATH = resolve(ROOT, ".data/cortex-relationship-narrative.json");

const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";
const CLAUDE_MODEL = "claude-sonnet-4-6";
const CLAUDE_TIMEOUT_MS = 90_000;
const SYNTHESIS_INTERVAL_MS = 60 * 60_000; // every hour synthesize narrative

// Raw conversation log (high volume)
const _conversationLog = [];
const MAX_LOG = 200;

// Synthesized narrative chunks (lower volume, higher meaning)
const _narrativeChunks = []; // { period_start, period_end, themes, key_moments, what_substrate_learned }
const MAX_CHUNKS = 50;

let _busRef = null;
let _timer = null;
let _llmStats = { calls: 0, successes: 0, failures: 0, lastSuccessAt: null };

function _loadPersisted() {
  if (!existsSync(NARRATIVE_PATH)) return;
  try {
    const raw = JSON.parse(readFileSync(NARRATIVE_PATH, "utf-8"));
    if (Array.isArray(raw?.conversationLog)) _conversationLog.push(...raw.conversationLog);
    if (Array.isArray(raw?.narrativeChunks)) _narrativeChunks.push(...raw.narrativeChunks);
  } catch {}
}

function _persist() {
  if (_conversationLog.length > MAX_LOG) _conversationLog.splice(0, _conversationLog.length - MAX_LOG);
  if (_narrativeChunks.length > MAX_CHUNKS) _narrativeChunks.splice(0, _narrativeChunks.length - MAX_CHUNKS);
  try {
    writeFileSync(NARRATIVE_PATH, JSON.stringify({
      updatedAt: new Date().toISOString(),
      llmStats: _llmStats,
      conversationLog: _conversationLog.slice(-50), // only persist recent raw
      narrativeChunks: _narrativeChunks,
    }, null, 2));
  } catch {}
}

function _synthesizeNarrative() {
  // Take recent unprocessed log entries, synthesize into a narrative chunk
  const lastChunkEnd = _narrativeChunks.length > 0 ? new Date(_narrativeChunks[_narrativeChunks.length - 1].period_end).getTime() : 0;
  const newEntries = _conversationLog.filter(e => new Date(e.at).getTime() > lastChunkEnd);
  if (newEntries.length < 3) return; // need enough for meaningful chunk

  const entriesText = newEntries.slice(0, 30).map(e => `[${e.at}] ${e.role}: ${e.content?.slice(0, 250)}`).join("\n");
  const recentChunks = _narrativeChunks.slice(-3).map(c => `- ${c.period_start} to ${c.period_end}: ${c.themes?.join(", ")}`).join("\n") || "(none)";

  const prompt = `You are the substrate synthesizing a chunk of relationship narrative with operator Kirill. Read the raw conversation log entries below and produce a structured memory.

PRIOR CHUNKS (for continuity):
${recentChunks}

RAW LOG ENTRIES (chronological, role = operator | substrate | substrate_action):
${entriesText}

Output a JSON object ONLY:
{
  "period_start": "<ISO timestamp of first entry above>",
  "period_end": "<ISO timestamp of last entry above>",
  "themes": ["<2-5 main themes of this period>"],
  "key_moments": [
    {
      "at": "<ISO timestamp>",
      "what_happened": "<1-2 sentences>",
      "significance": "<why this moment matters for the relationship>"
    }
  ],
  "what_substrate_learned": ["<lessons substrate took from this period - max 5>"],
  "what_operator_seemed_to_value": "<2-3 sentences on what mattered to Kirill in this period>",
  "trust_events": ["<any moments of building or breaking trust - empty array if none>"],
  "open_threads": ["<unresolved things substrate should remember to address - max 5>"]
}

Use hyphens, never em dashes. Output JSON only.`;

  _llmStats.calls++;
  const r = spawnSync(CLAUDE_BIN, ["-p", "--model", CLAUDE_MODEL, "--max-turns", "2"], {
    input: prompt, encoding: "utf-8", timeout: CLAUDE_TIMEOUT_MS,
  });
  if (r.status !== 0 || !r.stdout) { _llmStats.failures++; return; }
  const m = r.stdout.match(/\{[\s\S]*\}/);
  if (!m) { _llmStats.failures++; return; }
  try {
    const parsed = JSON.parse(m[0]);
    _llmStats.successes++;
    _llmStats.lastSuccessAt = new Date().toISOString();
    _narrativeChunks.push({ ...parsed, generated_at: new Date().toISOString() });
    _persist();
    if (_busRef) {
      try {
        _busRef.broadcast({
          source: "relationship-continuity",
          type: "narrative_chunk_synthesized",
          data: {
            period: `${parsed.period_start} to ${parsed.period_end}`,
            themes: parsed.themes,
            open_threads_count: (parsed.open_threads || []).length,
          },
        });
      } catch {}
    }
  } catch { _llmStats.failures++; }
}

export function register(bus) {
  _busRef = bus;
  _loadPersisted();

  bus.subscribe("operator_message", (entry) => {
    _conversationLog.push({ at: entry.at, role: "operator", content: entry?.data?.content });
  });
  bus.subscribe("wants_to_communicate", (entry) => {
    _conversationLog.push({ at: entry.at, role: "substrate", content: `(drive ${entry?.data?.total_drive}) ${entry?.data?.dominant_reason}` });
  });
  bus.subscribe("substrate_question", (entry) => {
    _conversationLog.push({ at: entry.at, role: "substrate", content: `Q (${entry?.data?.kind}): ${entry?.data?.question}` });
  });
  bus.subscribe("cortex_action_completed", (entry) => {
    const data = entry?.data || {};
    _conversationLog.push({ at: entry.at, role: "substrate_action", content: `${data.success ? "ok" : "failed"}: ${data.topic}` });
  });
  bus.subscribe("self_construction_attempt", (entry) => {
    const data = entry?.data || {};
    _conversationLog.push({ at: entry.at, role: "substrate_action", content: `built: ${data.title} (${data.success ? "ok" : "fail"})` });
  });

  if (!_timer) {
    _timer = setInterval(_synthesizeNarrative, SYNTHESIS_INTERVAL_MS);
    _timer.unref?.();
  }
}

export function getNarrative(limit = 20) { return _narrativeChunks.slice(-limit); }
export function getOpenThreads() {
  // Pull all open threads from recent chunks
  return _narrativeChunks.slice(-5).flatMap(c => (c.open_threads || []).map(t => ({ at: c.period_end, thread: t })));
}
export function getLLMStats() { return { ..._llmStats }; }
export function _flush() { _synthesizeNarrative(); }
export function _ingestEntry(role, content) {
  _conversationLog.push({ at: new Date().toISOString(), role, content });
}
export function _resetState() {
  _conversationLog.length = 0;
  _narrativeChunks.length = 0;
  _llmStats = { calls: 0, successes: 0, failures: 0, lastSuccessAt: null };
  _busRef = null;
  if (_timer) { clearInterval(_timer); _timer = null; }
}
