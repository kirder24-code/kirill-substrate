/**
 * CORTEX DEEP RESEARCH — Real understanding, not pattern matching
 *
 * The problem with one Brave search:
 *   "AI automation for SaaS founders" -> 3 results -> "SaaS is a good market"
 *
 * That's not understanding. That's guessing.
 *
 * Deep Research uses Claude CLI (with WebFetch + WebSearch) to:
 * 1. Search broadly (3-5 different angles)
 * 2. Read actual pages (competitor sites, forum threads, pricing pages)
 * 3. Cross-reference findings
 * 4. Form an OPINION with evidence
 * 5. Identify what's NOT known (gaps)
 *
 * Example output:
 *   "Dental clinics in Calgary: 847 practices (Alberta Dental Assoc directory).
 *    Average 180-250 calls/month (source: dental practice management blog).
 *    Main pain: after-hours calls go to voicemail - 23% of new patient calls
 *    are lost (DentistryIQ study). Competitors: Smith.ai ($140/mo for dental),
 *    Ruby ($349/mo). Gap: nobody offers bilingual (English/French) for
 *    Quebec-adjacent markets. Our angle: $99/mo beats both.
 *    UNKNOWN: actual conversion rate for vibe-code audit offers."
 *
 * Cost: $0 (Max subscription). Time: 60-180s.
 * Frequency: max 3 deep researches per day (to not hammer Claude CLI).
 */

import { spawnSync } from "child_process";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { remember } from "./memory.mjs";
import { appendToThread } from "./narrative.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const RESEARCH_DIR = resolve(ROOT, ".data/deep-research");
const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";

if (!existsSync(RESEARCH_DIR)) mkdirSync(RESEARCH_DIR, { recursive: true });

// Rate limit: max 3 deep researches per day
const DAILY_LIMIT = 3;

// ── MAIN RESEARCH FUNCTION ────────────────────────────────────────────

/**
 * Conduct deep research on a topic.
 *
 * @param {object} params
 * @param {string} params.question - The research question
 * @param {string} params.context - Why we need this research (e.g., "evaluating dental vertical")
 * @param {string[]} [params.angles] - Specific angles to research (auto-generated if omitted)
 * @param {string} [params.origin] - Who requested (cortex-brain | evolution-engine | manual)
 * @param {object} [options]
 * @param {number} [options.timeoutMs] - Timeout (default: 5 min)
 * @param {function} [options.log] - Logger
 * @returns {object} { success, insight, evidence, gaps, rawOutput, durationMs }
 */
export async function deepResearch(params, options = {}) {
  const log = options.log || console.log;
  const timeoutMs = options.timeoutMs || 5 * 60 * 1000;
  const startTime = Date.now();

  log(`[RESEARCH] Question: ${params.question}`);

  // Rate limit check
  const today = new Date().toISOString().slice(0, 10);
  let todayCount = 0;
  try {
    const fs = await import("fs");
    todayCount = fs.readdirSync(RESEARCH_DIR).filter(f => f.startsWith(`research-${today}`)).length;
  } catch {}

  if (todayCount >= DAILY_LIMIT) {
    log(`[RESEARCH] Daily limit reached (${DAILY_LIMIT}). Skipping.`);
    return { success: false, error: `Daily limit (${DAILY_LIMIT}) reached`, durationMs: 0 };
  }

  // Build research prompt
  const prompt = buildResearchPrompt(params);
  const ts = Date.now();
  const promptFile = resolve(RESEARCH_DIR, `prompt-${today}-${ts}.md`);
  writeFileSync(promptFile, prompt, "utf-8");

  // Spawn Claude CLI with WebFetch + WebSearch
  log(`[RESEARCH] Spawning Claude CLI for deep research...`);

  const cleanEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k === "CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING") continue;
    cleanEnv[k] = v;
  }
  cleanEnv.PATH = `$HOME/.nvm/versions/node/v22.22.2/bin:${process.env.PATH || "/usr/bin:/bin"}`;

  const r = spawnSync("bash", [
    "-c",
    `cat "${promptFile}" | "${CLAUDE_BIN}" -p --model claude-sonnet-4-6 --max-turns 12 --allowedTools "WebSearch,WebFetch,Read,Bash(ls;cat;node)" --output-format text 2>&1`,
  ], {
    cwd: ROOT,
    env: cleanEnv,
    encoding: "utf-8",
    timeout: timeoutMs,
    maxBuffer: 20 * 1024 * 1024,
  });

  const durationMs = Date.now() - startTime;
  const output = (r.stdout || "") + (r.stderr || "");

  // Parse result
  let result;
  try {
    result = parseResearchOutput(output);
  } catch (e) {
    result = { success: false, insight: output.slice(-500), evidence: [], gaps: [], error: e.message };
  }

  // Save research result
  const resultFile = resolve(RESEARCH_DIR, `research-${today}-${ts}.json`);
  writeFileSync(resultFile, JSON.stringify({
    question: params.question,
    context: params.context,
    origin: params.origin,
    durationMs,
    exitCode: r.status,
    result,
  }, null, 2));

  log(`[RESEARCH] Done in ${(durationMs / 1000).toFixed(1)}s | ${result.evidence?.length || 0} evidence points | ${result.gaps?.length || 0} gaps`);

  return {
    success: r.status === 0 && !!result.insight,
    insight: result.insight || "",
    evidence: result.evidence || [],
    gaps: result.gaps || [],
    opinion: result.opinion || "",
    rawOutput: output.slice(-2000),
    durationMs,
  };
}

// ── PROMPT BUILDER ────────────────────────────────────────────────────

function buildResearchPrompt(params) {
  const angles = params.angles || [];
  const anglesSection = angles.length > 0
    ? `\n## SPECIFIC ANGLES TO INVESTIGATE\n${angles.map((a, i) => `${i + 1}. ${a}`).join("\n")}`
    : "";

  return `You are a DEEP RESEARCH agent for an autonomous business system.

## RESEARCH QUESTION
${params.question}

## CONTEXT
${params.context || "General market research for AI services business in Calgary, Canada. Offers: Vibe-Code Audit ($1,500-2,500 CAD), Reply Chaser Automation ($1,500 CAD), First 10 Customers Sales Motion ($2,000 CAD), Custom AI/n8n Build ($2,500-8,000 CAD)."}
${anglesSection}

## YOUR PROCESS
You must do REAL research, not guess. Follow these steps:

1. **SEARCH BROADLY** - Use WebSearch with 3-5 different queries to get diverse results.
   Don't just search the obvious. Search for:
   - Direct answer to the question
   - Competitor pricing and positioning
   - Customer complaints/pain points (Reddit, forums)
   - Market size data
   - What's NOT working in this space

2. **READ ACTUAL PAGES** - Use WebFetch to read at least 3-5 actual web pages.
   Don't just read search snippets. Read:
   - Competitor websites (pricing pages, feature lists)
   - Forum threads where real people discuss the problem
   - Industry reports or blog posts with data

3. **CROSS-REFERENCE** - Compare what different sources say.
   If one source says "dental clinics get 200 calls/month" and another says "50 calls/month",
   note the discrepancy and explain which is more credible.

4. **FORM AN OPINION** - Based on evidence, state what you believe and why.
   Not "it could work" but "this will/won't work because X, Y, Z".

5. **IDENTIFY GAPS** - What do you still NOT know? What would you need to verify?

## OUTPUT FORMAT
At the END of your research, output this block:

RESEARCH_RESULT:
\`\`\`json
{
  "insight": "2-3 paragraph synthesis of what you learned. Include specific numbers, sources, and conclusions.",
  "opinion": "Your formed opinion in 1-2 sentences. Be definitive, not wishy-washy.",
  "evidence": [
    {"fact": "specific finding", "source": "url or description", "confidence": 0.9},
    {"fact": "another finding", "source": "url", "confidence": 0.7}
  ],
  "gaps": [
    "What we still don't know #1",
    "What we still don't know #2"
  ],
  "actionable": [
    "Specific action the system should take based on this research"
  ]
}
\`\`\`

Be thorough. Read real pages. Don't hallucinate data.`;
}

// ── OUTPUT PARSER ─────────────────────────────────────────────────────

function parseResearchOutput(output) {
  const m = output.match(/RESEARCH_RESULT:\s*(?:```(?:json)?\s*)?(\{[\s\S]*?\n\})\s*(?:```)?/);
  if (m) {
    try {
      return JSON.parse(m[1]);
    } catch {
      const fixed = m[1].replace(/,\s*}/g, "}").replace(/,\s*]/g, "]");
      try { return JSON.parse(fixed); } catch {}
    }
  }

  // Fallback: extract whatever we can
  return {
    insight: output.slice(-1000),
    evidence: [],
    gaps: [],
    opinion: "",
  };
}

// ── INTEGRATION: Called by cortex-daemon ───────────────────────────────

/**
 * Execute a deep research task from brain decision.
 *
 * Decision format:
 * {
 *   "action": "deep_research",
 *   "question": "What's the real market size for AI automation consulting in North America?",
 *   "context": "Evaluating dental vertical expansion",
 *   "angles": ["competitor pricing", "call volume data", "pain points"],
 *   "reason": "Need data before committing to dental landing page"
 * }
 */
export async function executeResearchDecision(db, decision, log = console.log) {
  const result = await deepResearch({
    question: decision.question,
    context: decision.context || decision.reason,
    angles: decision.angles || [],
    origin: "cortex-brain",
  }, { log });

  if (result.success) {
    // Store insight in semantic memory
    remember(db, "semantic",
      `DEEP RESEARCH: ${decision.question}\n${result.insight?.slice(0, 500)}`,
      "research", "deep-research", 0.8
    );

    // Store opinion in procedural memory (it's a learned understanding)
    if (result.opinion) {
      remember(db, "procedural",
        `RESEARCH CONCLUSION: ${result.opinion}`,
        "research", "deep-research", 0.7
      );
    }

    // Update narrative thread
    try {
      const topic = inferResearchTopic(decision.question);
      appendToThread(db, topic,
        `Deep research: ${result.opinion || result.insight?.slice(0, 100)}. Evidence: ${result.evidence?.length || 0} points. Gaps: ${(result.gaps || []).join("; ")}`,
        log
      );
    } catch {}
  } else {
    remember(db, "episodic",
      `Deep research FAILED: ${decision.question}. Error: ${result.error || "unknown"}`,
      "research-failure", "deep-research"
    );
  }

  return result;
}

function inferResearchTopic(question) {
  const q = question.toLowerCase();
  if (q.includes("dental")) return "dental-vertical";
  if (q.includes("hvac")) return "hvac-vertical";
  if (q.includes("competitor") || q.includes("pricing")) return "competitive-landscape";
  if (q.includes("reddit") || q.includes("channel")) return "channel-strategy";
  if (q.includes("email") || q.includes("outreach")) return "outreach-strategy";
  if (q.includes("audit") || q.includes("automation")) return "productized-services";
  return "market-research";
}

// ── PRE-BUILT RESEARCH TEMPLATES ──────────────────────────────────────

export const RESEARCH_TEMPLATES = {
  "vertical-analysis": (vertical) => ({
    question: `Deep analysis of ${vertical} as a target vertical for AI automation consulting service`,
    context: `Evaluating whether to create dedicated landing page and outreach for ${vertical}`,
    angles: [
      `How many ${vertical} businesses exist in Calgary and across Canada`,
      `Average call volume and after-hours call patterns for ${vertical}`,
      `What ${vertical} businesses currently pay for automation consultants`,
      `Common complaints from ${vertical} about phone management`,
      `Competitor offerings specifically for ${vertical}`,
    ],
  }),

  "competitor-deep-dive": (competitor) => ({
    question: `Deep competitive analysis of ${competitor} - pricing, features, weaknesses, customer sentiment`,
    context: `Understanding how we compare and where we can differentiate`,
    angles: [
      `${competitor} current pricing and packages`,
      `${competitor} customer reviews and complaints`,
      `${competitor} feature list and limitations`,
      `What customers switch away from ${competitor} for`,
    ],
  }),

  "channel-effectiveness": (channel) => ({
    question: `How effective is ${channel} for selling AI/automation services to small businesses in 2026?`,
    context: `Evaluating whether to invest more effort in ${channel}`,
    angles: [
      `Success stories of selling AI services via ${channel}`,
      `Common mistakes when using ${channel} for B2B outreach`,
      `Best practices and templates that work on ${channel}`,
      `Conversion rates and response rates for ${channel}`,
    ],
  }),
};
