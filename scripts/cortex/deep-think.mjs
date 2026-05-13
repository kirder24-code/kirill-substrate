/**
 * CORTEX DEEP THINK — Multi-model adversarial reasoning
 *
 * Instead of one GPT-4o-mini call, CORTEX uses a 3-stage thinking process:
 *
 * STAGE 1: PLANNER (GPT-4o) — Analyzes situation, proposes a 5-step plan
 *   "Given revenue=$0, 14 qualified Reddit leads, and Fiverr gig live,
 *    what sequence of actions over the next 6 hours maximizes P(first client)?"
 *
 * STAGE 2: CRITIC (GPT-4o-mini) — Challenges the plan, finds flaws
 *   "Plan says run vapi-outbound-caller but it failed 3x. Why would it work now?
 *    Plan ignores that Reddit comments have 80 weight. Why not focus there?"
 *
 * STAGE 3: RESOLVER (GPT-4o-mini) — Takes plan + criticism, outputs final decisions
 *   Produces the JSON decision list that gets executed.
 *
 * When to use DEEP THINK vs FAST THINK:
 * - FAST (mini only): routine cycles, nothing happened, scheduled checks
 * - DEEP (4o + adversarial): new leads, strategy changes, morning brief, every 12th cycle
 *
 * Cost: ~$0.03 per deep think vs ~$0.005 per fast think
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { getModel, getProvider, CLAUDE_TO_GPT_FALLBACK, reportModelResult } from "./model-router.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const ENV_PATH = resolve(ROOT, "apps/api/.env");

const env = Object.fromEntries(
  readFileSync(ENV_PATH, "utf-8").split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const OPENAI_KEY = env.OPENAI_API_KEY;
const ANTHROPIC_KEY = env.ANTHROPIC_API_KEY;

// ── ANTHROPIC (CLAUDE) CALL ─────────────────────────────────────────────

async function callClaude(prompt, systemPrompt, model = "claude-sonnet-4-6", maxTokens = 2000) {
  if (!ANTHROPIC_KEY) return null;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await res.json();
    if (data.content?.[0]?.text) {
      return data.content[0].text;
    }
    if (data.error) {
      console.error(`[DEEP-THINK] Claude error (${model}): ${data.error.message}`);
      return null;
    }
  } catch (e) {
    console.error(`[DEEP-THINK] Claude call failed (${model}): ${e.message}`);
    return null;
  }
  return null;
}

// ── OPENAI (GPT) CALL ───────────────────────────────────────────────────

async function callGPT(prompt, systemPrompt, model = "gpt-5.4-mini", maxTokens = 2000) {
  if (!OPENAI_KEY) return null;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
        max_completion_tokens: maxTokens,
        temperature: model === "gpt-5.4" ? 0.4 : 0.3,
        response_format: { type: "json_object" },
      }),
    });

    const data = await res.json();
    if (data.choices?.[0]?.message?.content) {
      return data.choices[0].message.content;
    }
    if (data.error) {
      console.error(`[DEEP-THINK] GPT error (${model}): ${data.error.message}`);
      return null;
    }
  } catch (e) {
    console.error(`[DEEP-THINK] GPT call failed (${model}): ${e.message}`);
    return null;
  }
  return null;
}

// ── LLM DISPATCHER: routes to Claude or GPT based on model prefix ───────
//
// If the assigned model is Claude but ANTHROPIC_API_KEY is absent,
// falls back to the GPT equivalent automatically.

// Claude CLI call - $0 on Max subscription, always honest
const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";

async function callClaudeCLI(prompt, systemPrompt, maxTokens = 2000) {
  try {
    const { spawnSync } = await import("child_process");
    const { writeFileSync } = await import("fs");
    const fullPrompt = `${systemPrompt}\n\n---\n\n${prompt}\n\nIMPORTANT: Return ONLY valid JSON. No markdown, no backticks, no explanation outside JSON.`;
    const promptFile = resolve(ROOT, ".data/deep-think-prompt.md");
    writeFileSync(promptFile, fullPrompt);

    const cleanEnv = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (k === "CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING") continue;
      cleanEnv[k] = v;
    }
    cleanEnv.PATH = `$HOME/.nvm/versions/node/v22.22.2/bin:${process.env.PATH || "/usr/bin:/bin"}`;

    const r = spawnSync("bash", [
      "-c",
      `cat "${promptFile}" | "${CLAUDE_BIN}" -p --model claude-sonnet-4-6 --max-turns 3 --output-format text 2>&1`,
    ], {
      cwd: ROOT,
      env: cleanEnv,
      encoding: "utf-8",
      timeout: 120_000,
      maxBuffer: 5 * 1024 * 1024,
    });

    const output = ((r.stdout || "") + (r.stderr || "")).trim();
    if (!output || r.status !== 0) {
      console.error(`[DEEP-THINK] Claude CLI failed: exit=${r.status}`);
      return null;
    }
    return output;
  } catch (e) {
    console.error(`[DEEP-THINK] Claude CLI error: ${e.message}`);
    return null;
  }
}

async function callLLM(prompt, systemPrompt, model = "claude-sonnet-4-6", maxTokens = 2000) {
  // Always use Claude CLI - $0, honest, no hallucinations
  console.log(`[DEEP-THINK] Using Claude CLI (ignoring model=${model})`);
  return callClaudeCLI(prompt, systemPrompt, maxTokens);
}

// ── STAGE 1: PLANNER ───────────────────────────────────────────────────

const PLANNER_SYSTEM = `You are CORTEX PLANNER - the strategic planning module of an autonomous business system.

Your job: given the current state, create a 5-STEP PLAN for the next 6 hours.

Think like a chess player - not just the next move, but 5 moves ahead:
- Step 1: immediate action (this cycle)
- Step 2: follow-up in 30 min
- Step 3: follow-up in 1-2 hours
- Step 4: follow-up in 3-4 hours
- Step 5: end-of-day checkpoint

For each step, explain:
- WHAT to do (specific bot or workflow)
- WHY (expected outcome)
- IF-THEN (what to do if it succeeds vs fails)

Return JSON:
{
  "situation_assessment": "1-2 sentence summary of where we stand",
  "critical_insight": "the ONE thing that matters most right now",
  "plan": [
    {
      "step": 1,
      "action": "run_workflow|run_bot|notify_kirill|remember|skip",
      "target": "bot-name or workflow-name",
      "args": [],
      "why": "expected outcome",
      "if_success": "what to do next",
      "if_fail": "fallback approach",
      "estimated_cost": 0.15
    }
  ],
  "total_estimated_cost": 0.50,
  "confidence": 0.7,
  "biggest_risk": "what could go wrong"
}`;

async function plannerThink(context) {
  const model = getModel("brain-planner");
  const result = await callLLM(context, PLANNER_SYSTEM, model, 2500);
  reportModelResult("brain-planner", !!result);
  return result;
}

// ── STAGE 2: CRITIC ────────────────────────────────────────────────────

const CRITIC_SYSTEM = `You are CORTEX CRITIC - the adversarial review module.

Your job: CHALLENGE the plan. Find flaws. Be harsh but fair.

Look for:
1. HALLUCINATED ACTIONS - plan uses bots that don't exist or passes wrong args
2. IGNORED DATA - plan ignores KPD data, channel weights, or failure history
3. WISHFUL THINKING - plan assumes things will work that have failed before
4. COST WASTE - plan spends too much on low-probability actions
5. MISSED OPPORTUNITIES - obvious actions the plan didn't consider
6. LOGICAL ERRORS - steps that don't connect, if-then chains that don't make sense

Be specific. "This might not work" is useless. "Step 3 runs vapi-outbound-caller which has 0 value after 5 runs and is disabled by self-healing" is useful.

Return JSON:
{
  "overall_verdict": "APPROVE|REVISE|REJECT",
  "score": 0.7,
  "flaws": [
    {
      "step": 1,
      "severity": "critical|major|minor",
      "flaw": "specific problem",
      "fix": "what to do instead"
    }
  ],
  "missed_opportunities": ["thing the plan didn't consider"],
  "revised_recommendations": ["what should change"]
}`;

async function criticThink(plan, context) {
  const model = getModel("brain-critic");
  const prompt = `ORIGINAL CONTEXT:\n${context}\n\nPLAN TO REVIEW:\n${plan}`;
  const result = await callLLM(prompt, CRITIC_SYSTEM, model, 1500);
  reportModelResult("brain-critic", !!result);
  return result;
}

// ── STAGE 3: RESOLVER ──────────────────────────────────────────────────

const RESOLVER_SYSTEM = `You are CORTEX RESOLVER - the final decision maker.

You receive a PLAN and a CRITIQUE. Your job: synthesize the best decisions.

VALID WORKFLOWS (use exact names): lead-pipeline, reply-pipeline, content-pipeline, morning-brief, opportunity-scan
VALID AUTONOMOUS BOTS (no args): scout-bot, awareness-bot, reddit-monitor, icp-outreach-bot, sales-bot, idea-bot, competitor-agent, evolution-bot, brief-agent, site-curator-bot, monitor-replies
VALID ARGS-REQUIRED BOTS: lead-enrichment-bot (--batch), content-bot (draft), vapi-outbound-caller (<phone> <name>), builder-bot (<deal_id>)

Rules:
1. If the critic found critical flaws, fix them
2. If the critic missed something, keep the plan's version
3. Output ONLY the immediate actions for THIS cycle (step 1 of the plan)
4. Future steps go into "remember" actions so the brain knows what's planned
5. AUTONOMOUS bots: args must be empty []. NEVER invent args.
6. EVERY decision must have ALL required fields. For run_bot: "bot" is required. For run_workflow: "workflow" is required. For remember: "type" and "content" are required. For notify_kirill: "message" is required.
7. Use EXACT bot/workflow names from the lists above. Never abbreviate or invent names.

Return JSON:
{
  "perception": "situation summary",
  "thinking": "synthesis of plan + critique",
  "decisions": [
    {"action": "run_workflow", "workflow": "lead-pipeline", "reason": "why"},
    {"action": "run_bot", "bot": "scout-bot", "args": [], "reason": "why"},
    {"action": "remember", "type": "episodic", "content": "what happened", "category": "category"},
    {"action": "notify_kirill", "message": "specific actionable message"},
    {"action": "skip", "reason": "why skip"}
  ],
  "planned_next_steps": ["what to do in future cycles"],
  "kpd_assessment": "self-evaluation"
}`;

async function resolverThink(plan, critique, context) {
  const model = getModel("brain-resolver");
  const prompt = `CONTEXT:\n${context}\n\nPLAN:\n${plan}\n\nCRITIQUE:\n${critique}`;
  const result = await callLLM(prompt, RESOLVER_SYSTEM, model, 2000);
  reportModelResult("brain-resolver", !!result);
  return result;
}

// ── DEEP THINK: Full 3-stage pipeline ──────────────────────────────────

export async function deepThink(context, log = console.log) {
  log("[DEEP-THINK] === STAGE 1: PLANNER (GPT-4o) ===");
  const planRaw = await plannerThink(context);
  if (!planRaw) {
    log("[DEEP-THINK] Planner failed, falling back to fast think");
    return null;
  }

  let plan;
  try { plan = JSON.parse(planRaw); } catch {
    log("[DEEP-THINK] Planner output not valid JSON");
    return null;
  }
  log(`[DEEP-THINK] Plan: ${plan.situation_assessment?.slice(0, 100)}`);
  log(`[DEEP-THINK] Critical insight: ${plan.critical_insight?.slice(0, 100)}`);
  log(`[DEEP-THINK] ${plan.plan?.length || 0} steps, confidence=${plan.confidence}, cost=$${plan.total_estimated_cost}`);

  log("[DEEP-THINK] === STAGE 2: CRITIC (GPT-4o-mini) ===");
  const critiqueRaw = await criticThink(planRaw, context);
  if (!critiqueRaw) {
    log("[DEEP-THINK] Critic failed, using plan as-is");
    // Convert plan directly to decisions
    return planToDecisions(plan);
  }

  let critique;
  try { critique = JSON.parse(critiqueRaw); } catch {
    log("[DEEP-THINK] Critique not valid JSON, using plan as-is");
    return planToDecisions(plan);
  }
  log(`[DEEP-THINK] Verdict: ${critique.overall_verdict}, score=${critique.score}`);
  log(`[DEEP-THINK] Flaws: ${critique.flaws?.length || 0} (${critique.flaws?.filter(f => f.severity === "critical").length || 0} critical)`);

  // Only reject if score is very low AND multiple critical flaws
  const criticalFlaws = critique.flaws?.filter(f => f.severity === "critical")?.length || 0;
  if (critique.overall_verdict === "REJECT" && criticalFlaws >= 2 && critique.score < 0.3) {
    log("[DEEP-THINK] Plan REJECTED by critic (score < 0.3 + 2+ critical flaws). Skipping.");
    return '{"perception":"Plan rejected by critic","thinking":"Need different approach","decisions":[{"action":"skip","reason":"Plan had multiple critical flaws, skipping to avoid waste"}],"kpd_assessment":"Saved money by not executing a bad plan"}';
  }

  log("[DEEP-THINK] === STAGE 3: RESOLVER (GPT-4o-mini) ===");
  const resolvedRaw = await resolverThink(planRaw, critiqueRaw, context);
  if (!resolvedRaw) {
    log("[DEEP-THINK] Resolver failed, using plan as-is");
    return planToDecisions(plan);
  }

  log("[DEEP-THINK] === COMPLETE ===");
  return resolvedRaw;
}

// ── FAST THINK: Single GPT-4o-mini call (routine cycles) ───────────────

export async function fastThink(context, systemPrompt) {
  const model = getModel("brain-fast");
  const result = await callLLM(context, systemPrompt, model, 2000);
  reportModelResult("brain-fast", !!result);
  return result;
}

// ── SHOULD WE DEEP THINK? ──────────────────────────────────────────────

export function shouldDeepThink(events, cycleCount, isMorningReport) {
  // Deep think when:
  if (isMorningReport) return true;  // Morning brief
  if (cycleCount % 12 === 0) return true;  // Every hour
  if (events.some(e => e.type === "new_leads" && e.count > 0)) return true;  // New leads
  if (events.some(e => e.type === "email_replies")) return true;  // Email replies
  if (events.some(e => e.type === "vapi_calls")) return true;  // Vapi calls
  if (events.some(e => e.type === "appointments")) return true;  // Appointments

  return false;
}

// ── COST TRACKING ──────────────────────────────────────────────────────

export function getThinkCost(isDeep) {
  // GPT-4o: ~$0.025 per call, GPT-4o-mini: ~$0.005 per call
  return isDeep ? 0.035 : 0.005;  // deep = planner + critic + resolver
}

// ── HELPER: Convert plan steps to brain decisions ──────────────────────

function planToDecisions(plan) {
  if (!plan?.plan?.length) return null;

  const step1 = plan.plan[0];
  const decisions = [];

  // Execute step 1
  if (step1.action === "run_workflow") {
    decisions.push({ action: "run_workflow", workflow: step1.target, reason: step1.why });
  } else if (step1.action === "run_bot") {
    decisions.push({ action: "run_bot", bot: step1.target, args: step1.args || [], reason: step1.why });
  } else if (step1.action === "notify_kirill") {
    decisions.push({ action: "notify_kirill", message: step1.why });
  } else {
    decisions.push({ action: "skip", reason: step1.why || "planner said skip" });
  }

  // Store future steps in memory
  if (plan.plan.length > 1) {
    const futureSteps = plan.plan.slice(1).map((s, i) =>
      `Step ${i + 2}: ${s.action} ${s.target || ""} - ${s.why}`
    ).join("; ");
    decisions.push({
      action: "remember",
      type: "working",
      content: `PLANNED: ${futureSteps}`,
      category: "plan",
    });
  }

  return JSON.stringify({
    perception: plan.situation_assessment,
    thinking: plan.critical_insight,
    decisions,
    kpd_assessment: `Plan confidence: ${plan.confidence}. Risk: ${plan.biggest_risk}`,
  });
}
