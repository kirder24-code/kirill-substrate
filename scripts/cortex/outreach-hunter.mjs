/**
 * cortex/outreach-hunter.mjs - Substrate hunts real-world opportunities and drafts outreach
 *   (Kirill's directive May 11 2026 - "build outreach-hunter")
 *
 * What this does CONCRETELY:
 * 1. Every 6h, substrate reads operator's current ICP from memory
 * 2. Generates 2-3 search queries via Claude (varying angles on ICP pain)
 * 3. Uses WebSearch through Claude to find recent (last 7 days) Reddit threads
 * 4. For each candidate: fetches full post, judges relevance
 * 5. If relevant: drafts personalized response that MUST cite >=2 specific details
 *    from the post (quality gate - rejects generic responses)
 * 6. Writes draft to .data/outreach-drafts/YYYY-MM-DD-slug.json
 * 7. Notifies operator via Telegram with summary
 * 8. Listens for /good_<id> /bad_<id> Telegram callbacks (feedback loop)
 *
 * What this is NOT:
 * - Not sending DMs/replies automatically (just drafts for review)
 * - Not voice agent / email optimization (banned topics)
 * - Not generic mass outreach (quality gate enforces specificity)
 *
 * Cost: ~$0.50-1.50 per cycle (4 cycles/day = $2-6/day)
 * Output: real drafts citing real public posts that operator can manually send
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DRAFTS_DIR = resolve(ROOT, ".data/outreach-drafts");
const STATE_PATH = resolve(ROOT, ".data/cortex-outreach-hunter.json");
const MEMORY_DIR = resolve("$HOME/.claude/projects/-Users-kirder-Desktop-linkedin-brand-os/memory");

const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";
const CLAUDE_MODEL = "claude-sonnet-4-6";
const CLAUDE_TIMEOUT_MS = 240_000;

const HUNT_INTERVAL_MS = 6 * 60 * 60_000; // 6 hours
const MAX_DRAFTS_PER_CYCLE = 5;

const _state = {
  cycles: 0,
  drafts_generated: 0,
  drafts_marked_good: 0,
  drafts_marked_bad: 0,
  last_cycle_at: null,
  recent_drafts: [], // { id, at, slug, source_url, marked }
};

let _busRef = null;
let _timer = null;
let _llmStats = { calls: 0, successes: 0, failures: 0, lastSuccessAt: null };

if (!existsSync(DRAFTS_DIR)) {
  try { mkdirSync(DRAFTS_DIR, { recursive: true }); } catch {}
}

function _loadPersisted() {
  if (!existsSync(STATE_PATH)) return;
  try {
    const raw = JSON.parse(readFileSync(STATE_PATH, "utf-8"));
    Object.assign(_state, raw.state || {});
  } catch {}
}

function _persist() {
  if (_state.recent_drafts.length > 200) _state.recent_drafts.splice(0, _state.recent_drafts.length - 200);
  try {
    writeFileSync(STATE_PATH, JSON.stringify({
      updatedAt: new Date().toISOString(),
      llmStats: _llmStats,
      state: _state,
    }, null, 2));
  } catch {}
}

// ─── Read operator's ICP from memory ────────────────────────────────────

function _readICPContext() {
  // Pull the key memory files that define operator's current ICP and services
  const relevant = [
    "user_kirill_profile.md",
    "user_kirill_services.md",
    "project_chain_business_icp.md",
    "feedback_linkedin_content_strategy.md",
    "feedback_no_voice_agent.md",
    "feedback_no_em_dash.md",
    "feedback_never_invent_urls.md",
    "feedback_verify_post_date_before_draft.md",
    "feedback_writer_agent_spec.md",
    "project_apollo_finvest_case.md",
    "project_where_clients_are.md",
  ];
  const parts = [];
  if (!existsSync(MEMORY_DIR)) return "(memory directory not accessible)";
  for (const name of relevant) {
    const p = resolve(MEMORY_DIR, name);
    if (existsSync(p)) {
      try {
        const content = readFileSync(p, "utf-8").slice(0, 2000);
        parts.push(`=== ${name} ===\n${content}`);
      } catch {}
    }
  }
  // Also pull living-prompt if accumulated lessons exist
  const lp = resolve(ROOT, ".data/cortex-living-prompt.md");
  if (existsSync(lp)) {
    try {
      const content = readFileSync(lp, "utf-8").slice(0, 3000);
      parts.push(`=== ACCUMULATED LESSONS ===\n${content}`);
    } catch {}
  }
  return parts.join("\n\n");
}

// ─── Hunt cycle ────────────────────────────────────────────────────────

async function _runHuntCycle() {
  // Budget check
  try {
    const budget = await import("./llm-budget-guard.mjs");
    const guard = budget.canCall("outreach-hunter", CLAUDE_MODEL);
    if (!guard.allow) {
      process.stderr.write(`[outreach-hunter] skipping cycle: ${guard.reason}\n`);
      return;
    }
  } catch {}

  const icp = _readICPContext();
  const recentSlugs = _state.recent_drafts.slice(-30).map(d => d.slug);

  const prompt = `You are the outreach-hunter for an autonomous AI workflow consultant. Your job: find REAL public Reddit posts from business owners describing automation pain, and draft thoughtful responses that could lead to a real conversation.

OPERATOR'S CURRENT ICP AND CONTEXT (from memory files):
${icp}

RECENT DRAFTS YOU HAVE ALREADY GENERATED (do not duplicate):
${recentSlugs.join("\n") || "(none yet)"}

YOUR TASK THIS CYCLE:
1. Use WebSearch to find 5-10 recent Reddit posts (last 14 days) from business owners describing automation pain that matches operator's ICP. Focus areas: multi-location operations, franchise scheduling, dental/restaurant/retail chains, missed calls, manual workflows breaking at scale, AI tool selection paralysis. AVOID: voice agent / phone receptionist (operator does NOT do voice work).
2. For each candidate post: fetch it with WebFetch to read the full content + top comments
3. Judge relevance HONESTLY - skip generic complaints, skip posts where commenter already got good answer, skip if Kirill's username (Ok-Serve4908) already commented
4. For each TRULY RELEVANT post, draft a response that MUST:
   - Cite at least 2 specific details from the post (their location count / tool / specific pain mentioned)
   - Reference operator's actual case study (Apollo Finvest - 3-day NBFC multi-vendor AI build) if relevant
   - Be < 200 words, conversational, not sales-pitchy
   - Offer 30-min audit or specific insight, not "buy my service"
   - Use hyphens never em dashes
   - NEVER mention voice agents, AI phone receptionists, missed-call SMS
   - Match operator's tone (direct, technical, no marketing fluff)

QUALITY GATE: if you cannot find ANY truly relevant posts this cycle, output empty drafts array. Better to ship 0 quality drafts than 5 generic ones.

For each draft you generate, also write a JSON file to disk:
  cd "${DRAFTS_DIR}" - already your working directory
  Write to: YYYY-MM-DD-slug.json (where slug is short kebab-case from post topic)
  File content schema:
  {
    "id": "<timestamp-slug>",
    "generated_at": "<ISO>",
    "source": { "platform": "reddit", "subreddit": "...", "post_url": "...", "post_title": "...", "author": "...", "post_date": "...", "post_summary": "..." },
    "match_reasoning": "<2-3 sentences: why this post matches ICP, what specific pain>",
    "draft_response": "<the response text - markdown if reddit-flavored>",
    "specifics_cited": ["...", "..."],
    "case_study_referenced": "<which operator case study, or null>",
    "estimated_quality": "high|medium|low",
    "review_id": "outreach-<short-uuid>"
  }

After writing files, output a summary as plain text describing what you found and wrote. List each draft's review_id for operator reference.

Use your WebSearch, WebFetch, and Write tools NOW. Do not just describe what you would do.`;

  _llmStats.calls++;
  const r = spawnSync(CLAUDE_BIN, [
    "-p",
    "--model", CLAUDE_MODEL,
    "--max-turns", "30",
    "--allowedTools", "WebSearch,WebFetch,Write,Read,Bash(ls;cat;date;mkdir)",
    "--output-format", "text",
  ], {
    input: prompt,
    encoding: "utf-8",
    timeout: CLAUDE_TIMEOUT_MS,
    cwd: DRAFTS_DIR,
  });

  try {
    const budget = await import("./llm-budget-guard.mjs");
    budget.recordCall("outreach-hunter", CLAUDE_MODEL);
  } catch {}

  if (r.status !== 0) {
    _llmStats.failures++;
    process.stderr.write(`[outreach-hunter] cycle failed: exit ${r.status} stderr: ${(r.stderr || "").slice(0, 300)}\n`);
    return;
  }

  _llmStats.successes++;
  _llmStats.lastSuccessAt = new Date().toISOString();
  _state.cycles++;
  _state.last_cycle_at = new Date().toISOString();

  // Scan drafts directory for new files created this cycle
  const newDrafts = [];
  try {
    const cutoff = Date.now() - 5 * 60_000;
    for (const f of readdirSync(DRAFTS_DIR)) {
      if (!f.endsWith(".json")) continue;
      const abs = resolve(DRAFTS_DIR, f);
      try {
        const content = JSON.parse(readFileSync(abs, "utf-8"));
        const generatedAt = new Date(content.generated_at || 0).getTime();
        if (generatedAt > cutoff) {
          newDrafts.push({ file: f, content });
        }
      } catch {}
    }
  } catch {}

  if (newDrafts.length === 0) {
    process.stderr.write(`[outreach-hunter] cycle ${_state.cycles}: no new drafts generated (quality gate or no matches)\n`);
    _persist();
    return;
  }

  _state.drafts_generated += newDrafts.length;
  const summary = r.stdout?.trim().slice(0, 1500) || "";

  for (const d of newDrafts) {
    _state.recent_drafts.push({
      id: d.content.id || d.file,
      review_id: d.content.review_id,
      at: d.content.generated_at || new Date().toISOString(),
      slug: d.file.replace(".json", ""),
      source_url: d.content.source?.post_url,
      marked: null,
    });
  }
  _persist();

  // Broadcast event
  if (_busRef) {
    try {
      _busRef.broadcast({
        source: "outreach-hunter",
        type: "drafts_generated",
        data: {
          cycle: _state.cycles,
          count: newDrafts.length,
          review_ids: newDrafts.map(d => d.content.review_id).filter(Boolean),
        },
      });
    } catch {}
  }

  // Telegram notify
  await _notifyOperator(newDrafts, summary).catch(() => {});
}

async function _notifyOperator(drafts, summary) {
  let envRaw = "";
  try { envRaw = readFileSync(resolve(ROOT, ".env"), "utf-8"); } catch {}
  const env = {};
  envRaw.split("\n").forEach(l => {
    const m = l.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  });
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;

  const lines = [
    `[OUTREACH-HUNTER cycle ${_state.cycles}]`,
    `${drafts.length} new drafts in .data/outreach-drafts/`,
    "",
  ];
  for (const d of drafts.slice(0, 5)) {
    lines.push(`• ${d.content.review_id}: ${d.content.source?.subreddit || "?"} - ${(d.content.source?.post_title || "").slice(0, 80)}`);
    lines.push(`  ${d.content.source?.post_url || ""}`);
  }
  lines.push("");
  lines.push("Reply /good_<review_id> or /bad_<review_id> after reviewing each draft.");
  const text = lines.join("\n").slice(0, 3500);

  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }),
    });
  } catch {}
}

// ─── Feedback handling ─────────────────────────────────────────────────

export function markDraft(review_id, verdict) {
  // verdict: "good" or "bad"
  const draft = _state.recent_drafts.find(d => d.review_id === review_id || d.id === review_id);
  if (!draft) return false;
  draft.marked = verdict;
  draft.marked_at = new Date().toISOString();
  if (verdict === "good") _state.drafts_marked_good++;
  else _state.drafts_marked_bad++;
  _persist();
  if (_busRef) {
    try {
      _busRef.broadcast({
        source: "outreach-hunter",
        type: "draft_feedback",
        data: { review_id, verdict, slug: draft.slug },
      });
      // Forward to lessons-as-prompt so substrate learns
      _busRef.broadcast({
        source: "outreach-hunter",
        type: "perception_event",
        data: {
          source: "operator_draft_feedback",
          content: `Operator marked outreach draft ${verdict}: ${draft.slug}`,
          valence: verdict === "good" ? "positive" : "negative",
          significance: 8,
          interpretation: verdict === "good"
            ? "Operator approved draft - this pattern resonates, repeat similar"
            : "Operator rejected draft - avoid this pattern, identify what was off",
        },
      });
    } catch {}
  }
  return true;
}

// ─── Required GWT-module export ─────────────────────────────────────────

export function register(bus) {
  _busRef = bus;
  _loadPersisted();

  // Listen for Telegram callback messages from operator with /good_ /bad_ commands
  bus.subscribe("operator_message", (entry) => {
    const content = entry?.data?.content || "";
    const goodMatch = content.match(/\/good_([\w-]+)/);
    const badMatch = content.match(/\/bad_([\w-]+)/);
    if (goodMatch) markDraft(goodMatch[1], "good");
    if (badMatch) markDraft(badMatch[1], "bad");
  });

  // Periodic hunt cycle
  if (!_timer) {
    _timer = setInterval(() => _runHuntCycle().catch(e => {
      process.stderr.write(`[outreach-hunter] tick error: ${e?.message || e}\n`);
    }), HUNT_INTERVAL_MS);
    _timer.unref?.();
  }

  // First cycle 60s after boot
  setTimeout(() => _runHuntCycle().catch(e => {
    process.stderr.write(`[outreach-hunter] initial cycle error: ${e?.message || e}\n`);
  }), 60_000).unref?.();
}

export function getState() { return JSON.parse(JSON.stringify(_state)); }
export function getRecentDrafts(limit = 20) { return _state.recent_drafts.slice(-limit); }
export function getLLMStats() { return { ..._llmStats }; }
export async function _flush() { return _runHuntCycle(); }
export function _resetState() {
  _state.cycles = 0;
  _state.drafts_generated = 0;
  _state.drafts_marked_good = 0;
  _state.drafts_marked_bad = 0;
  _state.last_cycle_at = null;
  _state.recent_drafts.length = 0;
  _llmStats = { calls: 0, successes: 0, failures: 0, lastSuccessAt: null };
  _busRef = null;
  if (_timer) { clearInterval(_timer); _timer = null; }
}
