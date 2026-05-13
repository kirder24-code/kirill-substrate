/**
 * CORTEX NIGHT CYCLE
 *
 * Kirill sleeps. The brain works.
 *
 * Phase 1: BODY AUDIT — syntax check all cortex modules, verify state files, log health
 * Phase 2: DEEP STUDY — internet research across 4 domains:
 *   A. Human psychology (decision-making, buyer behavior, what drives action)
 *   B. Human pains (real pains of SMB owners, solo founders, what keeps them up)
 *   C. Body-as-system model (anatomy functions as architecture patterns)
 *   D. Solo/AI company case studies (0 to revenue, what actually worked)
 * Phase 3: STRATEGY UPDATE — synthesize all learning into cortex-strategy.json
 *          and cortex-doctrine.md decision map
 *
 * Run: node scripts/cortex/night-cycle.mjs
 * Duration: ~25-40 minutes
 */

import { spawnSync } from "child_process";
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, statSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DATA_DIR = resolve(ROOT, ".data");
const CORTEX_DIR = __dirname;
const RESEARCH_DIR = resolve(DATA_DIR, "research-v2");
const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";

const NIGHT_CYCLE_LOG = resolve(DATA_DIR, "night-cycle-result.md");

if (!existsSync(RESEARCH_DIR)) mkdirSync(RESEARCH_DIR, { recursive: true });

const NOW = new Date().toISOString();
const DATE = NOW.slice(0, 10);

function log(msg) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${msg}`);
}

function hr(char = "=") {
  console.log(char.repeat(70));
}

// ── CLAUDE CLI RUNNER ─────────────────────────────────────────────────────

function runClaude(prompt, { tools = "WebSearch,WebFetch,Read,Bash(ls;node)", maxTurns = 15, timeoutMs = 10 * 60 * 1000 } = {}) {
  const ts = Date.now();
  const promptFile = resolve(RESEARCH_DIR, `prompt-${ts}.md`);
  writeFileSync(promptFile, prompt, "utf-8");

  const cleanEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k === "CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING") continue;
    cleanEnv[k] = v;
  }
  cleanEnv.PATH = `$HOME/.nvm/versions/node/v22.22.2/bin:${process.env.PATH || "/usr/bin:/bin"}`;

  const r = spawnSync("bash", [
    "-c",
    `cat "${promptFile}" | "${CLAUDE_BIN}" -p --model claude-sonnet-4-6 --max-turns ${maxTurns} --allowedTools "${tools}" --output-format text 2>&1`,
  ], {
    cwd: ROOT,
    env: cleanEnv,
    encoding: "utf-8",
    timeout: timeoutMs,
    maxBuffer: 30 * 1024 * 1024,
  });

  return {
    output: ((r.stdout || "") + (r.stderr || "")).trim(),
    exitCode: r.status,
    durationMs: Date.now() - ts,
  };
}

// ── PHASE 1: BODY AUDIT ───────────────────────────────────────────────────

function runBodyAudit() {
  hr();
  log("PHASE 1: BODY AUDIT");
  hr("-");

  const allFiles = readdirSync(CORTEX_DIR).filter(f => f.endsWith(".mjs")).sort();
  const ok = [];
  const broken = [];

  for (const file of allFiles) {
    const fullPath = resolve(CORTEX_DIR, file);
    const result = spawnSync("node", ["--check", fullPath], { encoding: "utf-8" });
    if (result.status === 0) {
      ok.push(file);
    } else {
      const errLine = (result.stderr || "").trim().slice(0, 150);
      broken.push({ file, error: errLine });
      log(`  BROKEN: ${file} — ${errLine}`);
    }
  }

  log(`  Modules OK: ${ok.length} | Broken: ${broken.length}`);

  // State file check
  const STATE_FILES = [
    "cortex-shared-state.json", "cortex-state-bus.json", "cortex-loop-state.json",
    "cortex-conscious-log.json", "cortex-emotions.json", "cortex-attention.json",
    "cortex-identity.json", "cortex-intuition.json", "cortex-priming.json",
    "cortex-dissonance.json", "cortex-dreams.json", "cortex-flow.json",
    "cortex-surprise.json", "cortex-metamemory.json", "cortex-evolution.json",
    "cortex-doctor-state.json", "cortex-healing-state.json", "cortex-strategy.json",
    "cortex-model-router.json", "cortex-config.json", "cortex-doctrine.md",
  ];

  const stateOk = [];
  const stateMissing = [];
  const stateBroken = [];

  for (const sf of STATE_FILES) {
    const p = resolve(DATA_DIR, sf);
    if (!existsSync(p)) {
      stateMissing.push(sf);
    } else if (sf.endsWith(".json")) {
      try {
        JSON.parse(readFileSync(p, "utf-8"));
        stateOk.push(sf);
      } catch {
        stateBroken.push(sf);
      }
    } else {
      stateOk.push(sf);
    }
  }

  log(`  State files OK: ${stateOk.length} | Missing: ${stateMissing.length} | Broken: ${stateBroken.length}`);
  if (stateMissing.length > 0) log(`  Missing: ${stateMissing.join(", ")}`);
  if (stateBroken.length > 0) log(`  Broken JSON: ${stateBroken.join(", ")}`);

  return {
    modulesOk: ok.length,
    modulesBroken: broken,
    stateOk: stateOk.length,
    stateMissing,
    stateBroken,
    totalModules: allFiles.length,
  };
}

// ── PHASE 2: DEEP STUDY ───────────────────────────────────────────────────

function researchHumanPsychology() {
  log("  [2A] Researching human psychology of decisions...");

  const prompt = `You are a deep research agent. Your task: understand how humans ACTUALLY make buying decisions, what drives them, what stops them, and what psychology explains successful sales of AI tools to SMB owners.

Research these specific questions using web search and reading real pages:

1. What psychological triggers cause small business owners to buy new tools/services in 2025-2026?
2. What is "loss aversion" in the context of B2B sales - what do business owners fear losing more than they want to gain?
3. What is "social proof" and which forms work best for AI/automation sales to skeptical SMB owners?
4. What are the stages of the "awareness ladder" - from unaware to problem-aware to solution-aware to product-aware to ready-to-buy? How do you move someone up?
5. What is "jobs to be done" theory and how does it change what you should say in outreach?
6. Why do most cold outreach messages fail psychologically? What's the brain doing when someone reads a cold DM?
7. What specific emotions drive the decision to hire an AI service vs. keep doing it themselves?

Search for academic research, practitioner blogs (CXL, Copyhackers, Demand Gen Report), Reddit threads where business owners discuss why they bought or didn't buy automation tools.

At the end output:

PSYCHOLOGY_FINDINGS:
\`\`\`json
{
  "core_drivers": ["list of what actually moves SMB owners to buy"],
  "core_blockers": ["list of what stops them, psychological barriers"],
  "awareness_ladder": "description of the stages and how to move people",
  "what_cold_outreach_gets_wrong": "2-3 sentences on the psychology of why most fails",
  "emotion_triggers": ["specific emotions that precede a yes"],
  "key_insight": "The single most important psychological insight for selling AI services"
}
\`\`\``;

  const r = runClaude(prompt, { maxTurns: 12, timeoutMs: 8 * 60 * 1000 });
  const m = r.output.match(/PSYCHOLOGY_FINDINGS:\s*```(?:json)?\s*(\{[\s\S]*?\n\})\s*```/);
  let findings = null;
  if (m) {
    try { findings = JSON.parse(m[1]); } catch {
      try { findings = JSON.parse(m[1].replace(/,\s*}/g, "}").replace(/,\s*]/g, "]")); } catch {}
    }
  }

  log(`    Done in ${(r.durationMs / 1000).toFixed(1)}s`);

  // Save full output
  writeFileSync(resolve(RESEARCH_DIR, `psychology-${DATE}.md`), `# Human Psychology Research — ${NOW}\n\n${r.output}`);

  return { findings, raw: r.output.slice(-2000) };
}

function researchHumanPains() {
  log("  [2B] Researching real SMB owner pains...");

  const prompt = `You are a deep research agent. Your task: find the REAL pains of small/medium business owners in 2025-2026. Not surface-level pains. The ones that keep them up at night. The ones they don't say in surveys but DO say on Reddit/forums.

Search Reddit (r/smallbusiness, r/Entrepreneur, r/sidehustle, r/startups), Hacker News, and forums for:
1. What SMB owners complain about most at 11pm
2. What administrative/communication tasks they hate most
3. What they wish someone could just "take off their plate"
4. Where they feel like they're losing money they can't see
5. What they tried to automate and it didn't work - WHY?
6. What "AI solutions" they bought that disappointed them and why

Also specifically search for:
- "wasted time" + small business owner
- "wish I could automate" small business
- "phones" OR "calls" small business problem
- "hate dealing with" small business owner

At the end output:

PAIN_FINDINGS:
\`\`\`json
{
  "top_pains": [
    {"pain": "description", "frequency": "how often mentioned", "emotional_intensity": "high/medium/low", "category": "phones|admin|clients|hiring|etc"}
  ],
  "pain_language": ["exact phrases real owners use to describe their pain"],
  "failed_solutions": ["things they tried that didn't work and why"],
  "hidden_pains": ["pains they have but don't consciously name"],
  "wedge_pain": "The single pain that is most universal AND most acute AND most addressable by AI"
}
\`\`\``;

  const r = runClaude(prompt, { maxTurns: 12, timeoutMs: 8 * 60 * 1000 });
  const m = r.output.match(/PAIN_FINDINGS:\s*```(?:json)?\s*(\{[\s\S]*?\n\})\s*```/);
  let findings = null;
  if (m) {
    try { findings = JSON.parse(m[1]); } catch {
      try { findings = JSON.parse(m[1].replace(/,\s*}/g, "}").replace(/,\s*]/g, "]")); } catch {}
    }
  }

  log(`    Done in ${(r.durationMs / 1000).toFixed(1)}s`);
  writeFileSync(resolve(RESEARCH_DIR, `pains-${DATE}.md`), `# SMB Pain Research — ${NOW}\n\n${r.output}`);

  return { findings, raw: r.output.slice(-2000) };
}

function researchBodyAsSystem() {
  log("  [2C] Researching body anatomy as system model...");

  const prompt = `You are a deep thinker and systems architect. Your task: understand how the human body works as a system, and extract architectural lessons for designing autonomous AI systems.

The human body evolved over millions of years. It solved problems of:
- Coordination without central control (nervous system vs. hormones vs. reflexes)
- Memory (short-term neurons vs. long-term protein structures)
- Immune response (detect threat, respond, remember, improve)
- Healing (self-repair without external intervention)
- Attention (conscious focus vs. background monitoring)
- Energy management (when to conserve, when to burst)
- Specialization (each organ has one job, does it perfectly)
- Integration (organs communicate, system-level behavior emerges)

Research and think deeply about:
1. How does the brain prioritize what to pay attention to? What's the reticular activating system and what can AI learn from it?
2. How does the immune system distinguish "self" from "threat"? How does this map to a business system that must protect its focus?
3. How does the body heal itself? What's the pattern of: detect damage -> isolate -> repair -> test -> resume?
4. How does the heart work as a "pump with rhythm" - what's the lesson for a system that must maintain consistent output?
5. How does the lymph system work as a "slow cleanup" that runs parallel to everything else?
6. How does sleep work - why does the body NEED to go offline to consolidate memory and repair?
7. What is "proprioception" - the body's sense of where its own parts are - and what's the AI equivalent?

Also search for: "biomimicry system design", "body as system architecture", "biological system design principles"

At the end output:

BODY_LESSONS:
\`\`\`json
{
  "architectural_principles": [
    {"principle": "name", "how_body_does_it": "description", "ai_equivalent": "what cortex should do"}
  ],
  "healing_pattern": "The body's self-repair loop in steps - applicable to self-healing AI",
  "attention_model": "How the body decides what to focus on - applicable to AI attention system",
  "specialization_lesson": "What organ specialization teaches about agent design",
  "night_cycle_lesson": "Why sleep matters biologically and what this means for overnight AI processing",
  "key_insight": "The single most important thing nature teaches about system design"
}
\`\`\``;

  const r = runClaude(prompt, { maxTurns: 10, timeoutMs: 7 * 60 * 1000 });
  const m = r.output.match(/BODY_LESSONS:\s*```(?:json)?\s*(\{[\s\S]*?\n\})\s*```/);
  let findings = null;
  if (m) {
    try { findings = JSON.parse(m[1]); } catch {
      try { findings = JSON.parse(m[1].replace(/,\s*}/g, "}").replace(/,\s*]/g, "]")); } catch {}
    }
  }

  log(`    Done in ${(r.durationMs / 1000).toFixed(1)}s`);
  writeFileSync(resolve(RESEARCH_DIR, `body-system-${DATE}.md`), `# Body as System Research — ${NOW}\n\n${r.output}`);

  return { findings, raw: r.output.slice(-2000) };
}

function researchSoloAiCases() {
  log("  [2D] Researching solo/AI company success cases...");

  const prompt = `You are a deep research agent. Your task: find REAL case studies of solo founders or very small teams who built AI/automation businesses and went from 0 to meaningful revenue in 2023-2026. Focus on what ACTUALLY worked, not theory.

Search for:
1. Indie Hackers: solo founders building AI tools/services who hit $1K-10K MRR
2. Twitter/X threads from AI founders documenting their 0-to-revenue journey
3. Reddit r/SaaS, r/indiehackers, r/freelance success stories with AI services
4. "AI automation agency" success stories - what niches, what offers, what channels worked
5. Specific cases: what did they sell first? How did they close their first client? What was the pricing?
6. Failed AI service businesses - what went wrong? What should be avoided?

Key questions:
- What services sold fastest (productized vs. custom vs. platform)?
- Which outreach channels actually converted (cold email, LinkedIn, Reddit, referrals)?
- What was the typical first client look like (industry, size, pain)?
- How long from first outreach to first payment?
- What pricing model worked (one-time, monthly retainer, usage-based)?

Search specifically for: "AI automation agency first client", "sold AI service first month", "indie hacker AI service revenue", "how I got my first AI consulting client 2024 2025"

At the end output:

CASE_FINDINGS:
\`\`\`json
{
  "fastest_paths": [
    {"path": "description", "time_to_revenue": "estimate", "what_worked": "key factor"}
  ],
  "winning_channels": ["channels with highest conversion in order"],
  "winning_offers": ["offer types that sold fastest"],
  "first_client_pattern": "What the first paying client typically looks like",
  "pricing_that_worked": "What pricing models converted",
  "biggest_mistakes": ["what kills early-stage AI service businesses"],
  "key_insight": "The single most important lesson from these cases for Kirill right now"
}
\`\`\``;

  const r = runClaude(prompt, { maxTurns: 12, timeoutMs: 8 * 60 * 1000 });
  const m = r.output.match(/CASE_FINDINGS:\s*```(?:json)?\s*(\{[\s\S]*?\n\})\s*```/);
  let findings = null;
  if (m) {
    try { findings = JSON.parse(m[1]); } catch {
      try { findings = JSON.parse(m[1].replace(/,\s*}/g, "}").replace(/,\s*]/g, "]")); } catch {}
    }
  }

  log(`    Done in ${(r.durationMs / 1000).toFixed(1)}s`);
  writeFileSync(resolve(RESEARCH_DIR, `solo-cases-${DATE}.md`), `# Solo AI Cases Research — ${NOW}\n\n${r.output}`);

  return { findings, raw: r.output.slice(-2000) };
}

// ── PHASE 3: STRATEGY UPDATE ──────────────────────────────────────────────

function updateStrategy(audit, psychology, pains, body, cases) {
  log("  [3] Synthesizing into strategy update...");

  const psychSummary = psychology.findings ? JSON.stringify(psychology.findings, null, 2) : psychology.raw.slice(0, 800);
  const painSummary = pains.findings ? JSON.stringify(pains.findings, null, 2) : pains.raw.slice(0, 800);
  const bodySummary = body.findings ? JSON.stringify(body.findings, null, 2) : body.raw.slice(0, 800);
  const casesSummary = cases.findings ? JSON.stringify(cases.findings, null, 2) : cases.raw.slice(0, 800);

  const prompt = `You are CORTEX STRATEGY — the decision-making brain of an autonomous business system.

Tonight you ran a full learning cycle. You must now synthesize everything into a concrete strategy update and decision map.

## SYSTEM HEALTH (Body Audit)
- Cortex modules OK: ${audit.modulesOk}/${audit.totalModules}
- Broken modules: ${JSON.stringify(audit.modulesBroken)}
- State files missing: ${JSON.stringify(audit.stateMissing)}
- State files broken: ${JSON.stringify(audit.stateBroken)}

## WHAT YOU LEARNED ABOUT HUMAN PSYCHOLOGY
${psychSummary}

## WHAT YOU LEARNED ABOUT REAL SMB PAINS
${painSummary}

## WHAT NATURE TEACHES ABOUT SYSTEM DESIGN
${bodySummary}

## WHAT ACTUALLY WORKS FOR SOLO AI BUSINESSES
${casesSummary}

## YOUR TASK
Based on this learning, produce:

1. A STRATEGY UPDATE in JSON format for cortex-strategy.json nightCycleInsights field
2. A DOCTRINE UPDATE in markdown format for cortex-doctrine.md (the decision map)

The doctrine is the set of rules the brain uses to make decisions. It should be updated to reflect:
- What you now know about buyer psychology (how to approach people)
- What pains to focus on (what message to lead with)
- What architecture lessons to apply (how to design the system better)
- What execution patterns to follow (based on real cases)

STRATEGY_UPDATE:
\`\`\`json
{
  "updatedAt": "${NOW}",
  "nightCycleInsights": {
    "psychologyLessons": ["top 3-5 actionable psychology insights"],
    "painFocus": "The single wedge pain to lead all outreach with",
    "painLanguage": ["3-5 exact phrases from real SMB owners to use in copy"],
    "bodySystemLessons": ["top 3 architectural patterns learned from body anatomy"],
    "casePatterns": {
      "fastestPath": "description",
      "winningChannel": "best channel",
      "winningOffer": "best offer type",
      "pricingInsight": "what pricing worked"
    },
    "revisedOutreachFormula": "Based on psychology + pains: what the first message should contain",
    "decisionPrinciples": ["3-5 new decision rules for the brain"]
  }
}
\`\`\`

DOCTRINE_UPDATE:
\`\`\`markdown
[Write the updated doctrine as a full document. It should be opinionated, direct, and actionable.
Cover: who we are, what we sell, who we sell to, how we open conversations (psychology-based),
what pain we lead with, how we design the system (body lessons), what we do and do NOT do.
Use bullet points and headers. No em dashes. No money-back guarantees. 500-800 words max.]
\`\`\``;

  const r = runClaude(prompt, {
    tools: "Read,Bash(ls;node)",
    maxTurns: 8,
    timeoutMs: 5 * 60 * 1000,
  });

  log(`    Synthesis done in ${(r.durationMs / 1000).toFixed(1)}s`);

  // Extract strategy update
  const stratMatch = r.output.match(/STRATEGY_UPDATE:\s*```(?:json)?\s*(\{[\s\S]*?\n\})\s*```/);
  let stratUpdate = null;
  if (stratMatch) {
    try { stratUpdate = JSON.parse(stratMatch[1]); } catch {
      try { stratUpdate = JSON.parse(stratMatch[1].replace(/,\s*}/g, "}").replace(/,\s*]/g, "]")); } catch {}
    }
  }

  // Extract doctrine update
  const docMatch = r.output.match(/DOCTRINE_UPDATE:\s*```(?:markdown)?\s*([\s\S]*?)\s*```/);
  const doctrineUpdate = docMatch ? docMatch[1].trim() : null;

  // Write to cortex-strategy.json
  if (stratUpdate) {
    const stratPath = resolve(DATA_DIR, "cortex-strategy.json");
    let strat = {};
    try { strat = JSON.parse(readFileSync(stratPath, "utf-8")); } catch {}
    strat.nightCycleInsights = stratUpdate.nightCycleInsights;
    strat.nightCycleUpdatedAt = NOW;
    writeFileSync(stratPath, JSON.stringify(strat, null, 2));
    log("  cortex-strategy.json updated with nightCycleInsights");
  }

  // Write to cortex-doctrine.md
  if (doctrineUpdate) {
    const doctrinePath = resolve(DATA_DIR, "cortex-doctrine.md");
    const header = `# CORTEX DOCTRINE — Decision Map\nLast updated: ${NOW}\n\n`;
    writeFileSync(doctrinePath, header + doctrineUpdate);
    log("  cortex-doctrine.md updated");
  }

  return { stratUpdate, doctrineUpdate, raw: r.output.slice(-1000) };
}

// ── MAIN ──────────────────────────────────────────────────────────────────

async function main() {
  hr();
  console.log("  CORTEX NIGHT CYCLE — STARTED");
  console.log(`  ${NOW}`);
  hr();
  console.log();

  const cycleStart = Date.now();
  const report = [];

  // Phase 1: Body Audit
  const audit = runBodyAudit();
  report.push(`## Phase 1: Body Audit\n- Modules: ${audit.modulesOk}/${audit.totalModules} OK\n- Broken: ${audit.modulesBroken.map(b => b.file).join(", ") || "none"}\n- State missing: ${audit.stateMissing.join(", ") || "none"}`);
  console.log();

  // Phase 2: Deep Study
  hr();
  log("PHASE 2: DEEP STUDY (internet research)");
  hr("-");
  console.log();

  const psychology = researchHumanPsychology();
  console.log();

  const pains = researchHumanPains();
  console.log();

  const body = researchBodyAsSystem();
  console.log();

  const cases = researchSoloAiCases();
  console.log();

  report.push(`## Phase 2: Research\n- Psychology: ${psychology.findings ? "structured data captured" : "raw text saved"}\n- Pains: ${pains.findings ? "structured data captured" : "raw text saved"}\n- Body lessons: ${body.findings ? "structured data captured" : "raw text saved"}\n- Cases: ${cases.findings ? "structured data captured" : "raw text saved"}`);

  // Phase 3: Strategy Update
  hr();
  log("PHASE 3: STRATEGY SYNTHESIS");
  hr("-");
  console.log();

  const synthesis = updateStrategy(audit, psychology, pains, body, cases);

  report.push(`## Phase 3: Strategy Update\n- cortex-strategy.json: ${synthesis.stratUpdate ? "updated" : "no structured update"}\n- cortex-doctrine.md: ${synthesis.doctrineUpdate ? "updated" : "no structured update"}`);

  const totalDurationMs = Date.now() - cycleStart;

  // Write night cycle report
  const reportMd = [
    `# CORTEX Night Cycle Report`,
    `Date: ${NOW}`,
    `Duration: ${(totalDurationMs / 1000 / 60).toFixed(1)} minutes`,
    "",
    ...report,
    "",
    `## Key Insights Captured`,
    psychology.findings?.key_insight ? `- Psychology: ${psychology.findings.key_insight}` : "",
    pains.findings?.wedge_pain ? `- Wedge pain: ${pains.findings.wedge_pain}` : "",
    body.findings?.key_insight ? `- Body/system: ${body.findings.key_insight}` : "",
    cases.findings?.key_insight ? `- Cases: ${cases.findings.key_insight}` : "",
  ].filter(Boolean).join("\n");

  writeFileSync(NIGHT_CYCLE_LOG, reportMd);

  hr();
  log(`NIGHT CYCLE COMPLETE — ${(totalDurationMs / 1000 / 60).toFixed(1)} min`);
  log(`Report: ${NIGHT_CYCLE_LOG}`);
  hr();
}

main().catch(e => {
  console.error("NIGHT CYCLE FATAL:", e);
  process.exit(1);
});
