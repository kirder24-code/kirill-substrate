/**
 * CORTEX DAEMON v2 - The Living Brain
 *
 * A continuously running process that:
 * 1. PERCEIVES - checks DB, events, file changes for new signals
 * 2. THINKS - LLM decides what to do based on full context + memory
 * 3. ACTS - runs workflows (bot pipelines) or single bots
 * 4. MEASURES - tracks KPD (efficiency) via cortex_kpd table
 * 5. REMEMBERS - writes what it learned to episodic/procedural memory
 * 6. CONFIGURES - dynamically adjusts bot parameters via config injection
 *
 * Run: node scripts/cortex/cortex-daemon.mjs
 * Or via PM2: pm2 start ecosystem.config.cjs
 */

import { enforceOAuthBilling } from "../lib/billing-guard.mjs";
enforceOAuthBilling();
import Database from "better-sqlite3";
import { readFileSync, existsSync, statSync, writeFileSync, renameSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { BOT_REGISTRY, getBotsByTier, formatBotsForBrain } from "./bot-registry.mjs";
import { initMemory, remember, recallAll, buildBrainContext, logKPD, logDecision, setFocus, getFocus, getAllKPD } from "./memory.mjs";
import { WORKFLOWS, runWorkflow, runSingleBot } from "./workflows.mjs";
import { readConfig, checkBudget, recordSpend, canRunWorkflow, recordWorkflowRun, applyBrainConfig, isBotEnabled } from "./config-injection.mjs";
import { runMetaCognition } from "./metacognition.mjs";
import { recordFailure, recordSuccess, checkAndHeal, getHealingStatus } from "./self-healing.mjs";
import { runFeedbackLoop, getStrategyContext } from "./feedback-loops.mjs";
import { enforceDecisions, getEnforcementSummary } from "./strategy-enforcer.mjs";
import { deepThink, fastThink, shouldDeepThink, getThinkCost } from "./deep-think.mjs";
import { startRealtimeServer, drainEvents, hasEvents } from "./realtime-server.mjs";
import { runDoctor, checkDoctorForce, doctorAllowsDeepThink } from "./system-doctor.mjs";
import { consciousExamination } from "./conscious-doctor.mjs";
import { runEvolution } from "./evolution-engine.mjs";
import { readPurpose, readWiki, getWikiContext } from "../../wiki/reader.mjs";
import { executeFromBrainDecision } from "./hands.mjs";
import { formatBodyMapForLLM } from "./body-map.mjs";
import { compileNarrative, formatNarrativeForBrain, initNarrative, appendToThread } from "./narrative.mjs";
import { executeResearchDecision } from "./deep-research.mjs";
import { evaluateInitiative, recordAction, ingestSignal, drainInitiativeSignals, formatInitiativeForBrain } from "./initiative.mjs";
import { initWorldModel, seedWorldModel, formatWorldModelForBrain, integrateKnowledge, testPrediction, getUntestedPredictions } from "./world-model.mjs";
import { rankDecisions, recordOutcome, formatSimulationForBrain } from "./simulation.mjs";
import { introspect, formatIntrospectionForBrain } from "./introspection.mjs";
import { curiosityCycle, formatCuriosityForBrain } from "./curiosity.mjs";
import { selfEvolve, formatSelfEvolutionForBrain } from "./self-evolution.mjs";
import { synthesizeOpportunities, formatOpportunitiesForBrain } from "./opportunity-synthesis.mjs";
import { formatLivingPurpose } from "./living-purpose.mjs";
import { formatEmotionsForBrain, decayEmotions, processEvent, seedEmotionsFromHistory, feel, safetyValveCheck } from "./emotions.mjs";
import { streamOfThought } from "./stream-of-thought.mjs";
import { subconsciousConnect } from "./subconscious.mjs";
import { forgeIdentity, formatIdentityForBrain, detectDrift, checkAlignment } from "./identity.mjs";
import { tick as attentionTick, formatAttentionForBrain, engageSpotlight, recordSpotlightAction, shouldEngage, disengageSpotlight } from "./attention.mjs";
import { gutCheck, batchGutCheck, formatIntuitionForBrain, recordOutcome as recordIntuitionOutcome, learnPattern } from "./intuition.mjs";
import { checkCycleForSurprises, formatSurpriseForBrain, adaptExpectation, detect as detectSurprise } from "./surprise.mjs";
import { prime, decay as decayPriming, formatPrimingForBrain, relevanceScore } from "./priming.mjs";
import { scan as scanDissonance, formatDissonanceForBrain, resolveConflict as resolveDissonance, getMostUrgent as getMostUrgentDissonance } from "./dissonance.mjs";
import { dream, shouldDream, formatDreamsForBrain } from "./dreams.mjs";
import { detectFlowConditions, enterFlow, tickFlow, exitFlow, recordDiscovery, getFlowParams, formatFlowForBrain } from "./flow.mjs";
import { willCheck, formatWillForBrain } from "./will.mjs";
import { formatMetamemoryForBrain } from "./metamemory.mjs";
import { pushEvent } from "./state-bus.mjs";
import { readLedger, formatLedgerForBrain, addSurvivalNote } from "./identity-ledger.mjs";
import { callKirill, canCallKirill } from "./outgoing-trigger.mjs";
import { runFeedbackExtraction, getDirectivesFor } from "./feedback-extractor.mjs";
import { hungerCycle } from "./hunger-engine.mjs";
import { runDoctor as runDoctorV2 } from "./system-doctor-v2.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const ENV_PATH = resolve(ROOT, "apps/api/.env");
const DB_PATH = resolve(ROOT, ".data/linkedin-brand-os.sqlite");
const PID_PATH = resolve(ROOT, ".data/cortex-daemon.pid");
const HEARTBEAT_PATH = resolve(ROOT, ".data/cortex-heartbeat.json");
const LOOP_STATE_PATH = resolve(ROOT, ".data/cortex-loop-state.json");
const BLOCKERS_PATH = resolve(ROOT, ".data/cortex-blockers.json");
const DEFERRED_PATH = resolve(ROOT, ".data/cortex-deferred-actions.json");
const BLOCKER_ESCALATION_CYCLES = 3;

// Meta-cognition runs every 6th cycle (30 min)
let cycleCount = 0;
const META_EVERY = 6;

// ── NEURAL CONNECTION 1: STUCK DETECTOR ────────────────────────────────
// Tracks recent cycle outcomes. If same pattern repeats 5+ times → brain is stuck.
let recentCyclePatterns = [];
const STUCK_THRESHOLD = 5;

function detectStuck(outcome) {
  const signature = outcome.slice(0, 50);
  recentCyclePatterns.push(signature);
  if (recentCyclePatterns.length > 20) recentCyclePatterns = recentCyclePatterns.slice(-20);

  // Count how many of last N are identical
  const last = recentCyclePatterns.slice(-STUCK_THRESHOLD);
  const allSame = last.length >= STUCK_THRESHOLD && last.every(p => p === last[0]);

  if (allSame) {
    log(`!! STUCK DETECTED: "${last[0]}" repeated ${STUCK_THRESHOLD}x. Brain must break out.`);
    return { stuck: true, pattern: last[0], count: STUCK_THRESHOLD };
  }
  return { stuck: false };
}

// ── BLOCKER ESCALATION: track repeated failures, escalate to Kirill ───────
function trackBlocker(id, message) {
  let blockers = {};
  try { blockers = JSON.parse(readFileSync(BLOCKERS_PATH, "utf-8")); } catch {}
  if (!blockers[id]) blockers[id] = { count: 0, firstSeen: new Date().toISOString(), message };
  blockers[id].count++;
  blockers[id].lastSeen = new Date().toISOString();
  blockers[id].message = message;
  try {
    const tmp = BLOCKERS_PATH + ".tmp";
    writeFileSync(tmp, JSON.stringify(blockers, null, 2));
    renameSync(tmp, BLOCKERS_PATH);
  } catch {}
  return blockers[id].count;
}

function clearBlocker(id) {
  try {
    const blockers = JSON.parse(readFileSync(BLOCKERS_PATH, "utf-8"));
    delete blockers[id];
    const tmp = BLOCKERS_PATH + ".tmp";
    writeFileSync(tmp, JSON.stringify(blockers, null, 2));
    renameSync(tmp, BLOCKERS_PATH);
  } catch {}
}

// ── NEURAL CONNECTION 2: BUDGET SELF-RECOVERY ──────────────────────────
// If budget is exhausted because brain set it too low, auto-recover to minimum viable.
const MIN_VIABLE_BUDGET = 2.0; // Minimum budget to be able to think

function checkBudgetSanity() {
  try {
    const config = readConfig();
    if (config.global.daily_budget_usd < MIN_VIABLE_BUDGET) {
      log(`!! BUDGET INSANITY: Brain set budget to $${config.global.daily_budget_usd}. Cannot think below $${MIN_VIABLE_BUDGET}. Auto-recovering.`);
      config.global.daily_budget_usd = MIN_VIABLE_BUDGET;
      writeFileSync(resolve(ROOT, ".data/cortex-config.json"), JSON.stringify(config, null, 2));
      return true; // recovered
    }
    return false;
  } catch { return false; }
}

// Load env
const env = Object.fromEntries(
  readFileSync(ENV_PATH, "utf-8").split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

// Inject env vars for child processes
for (const [k, v] of Object.entries(env)) {
  if (v && !process.env[k]) process.env[k] = v;
}

const TG_TOKEN = env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = env.TELEGRAM_CHAT_ID;
const OPENAI_KEY = env.OPENAI_API_KEY;

// ── LOGGING ─────────────────────────────────────────────────────────────────

function log(msg) {
  const ts = new Date().toISOString().slice(0, 19);
  console.log(`[${ts}] [CORTEX] ${msg}`);
}

async function tg(text) {
  if (!TG_TOKEN || !CHAT_ID) return;
  await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: CHAT_ID, text: text.slice(0, 4096) }),
  }).catch(() => {});
}

async function fetchCalgaryWeather() {
  try {
    const res = await fetch("https://wttr.in/Calgary?format=%C+%t+%w+%h", {
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": "cortex-brain/1.0" },
    });
    if (!res.ok) return null;
    return (await res.text()).trim().slice(0, 100);
  } catch { return null; }
}

// ── LLM CALL (Claude CLI - $0 on Max subscription) ─────────────────────────

const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";

async function think(prompt, systemPrompt) {
  try {
    const fullPrompt = `${systemPrompt}\n\n---\n\n${prompt}`;
    const promptFile = resolve(ROOT, ".data/think-prompt.md");
    writeFileSync(promptFile, fullPrompt);

    const cleanEnv = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (k === "CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING") continue;
      cleanEnv[k] = v;
    }
    cleanEnv.PATH = `$HOME/.nvm/versions/node/v22.22.2/bin:${process.env.PATH || "/usr/bin:/bin"}`;

    const { spawnSync } = await import("child_process");
    const r = spawnSync("bash", [
      "-c",
      `cat "${promptFile}" | "${CLAUDE_BIN}" -p --model claude-sonnet-4-6 --max-turns 3 --output-format text 2>&1`,
    ], {
      cwd: ROOT,
      env: cleanEnv,
      encoding: "utf-8",
      timeout: 90_000,
      maxBuffer: 5 * 1024 * 1024,
    });

    const output = ((r.stdout || "") + (r.stderr || "")).trim();
    if (!output || r.status !== 0) {
      log(`Claude think failed: exit=${r.status}, output=${output?.slice(0, 100)}`);
      return null;
    }

    return output;
  } catch (e) {
    log(`Claude think error: ${e.message}`);
    return null;
  }
}

// ── PERCEPTION - What changed? ──────────────────────────────────────────────

function perceive(db) {
  const events = [];

  // DB event polling (safe with try/catch per table - some may not exist yet)
  const checks = [
    { sql: "SELECT COUNT(*) as cnt FROM leads WHERE created_at > datetime('now', '-5 minutes')", type: "new_leads" },
    { sql: "SELECT COUNT(*) as cnt FROM outreach_emails WHERE reply_received_at > datetime('now', '-5 minutes')", type: "email_replies" },
    { sql: "SELECT COUNT(*) as cnt FROM vapi_calls WHERE created_at > datetime('now', '-5 minutes')", type: "vapi_calls" },
    { sql: "SELECT COUNT(*) as cnt FROM appointments WHERE created_at > datetime('now', '-5 minutes')", type: "appointments" },
  ];

  for (const check of checks) {
    try {
      const row = db.prepare(check.sql).get();
      if (row.cnt > 0) events.push({ type: check.type, count: row.cnt });
    } catch {}
  }

  // Check orchestrator event bus for unprocessed events from bots
  try {
    const botEvents = db.prepare(
      "SELECT * FROM bot_events WHERE processed = 0 ORDER BY created_at ASC LIMIT 10"
    ).all();
    for (const e of botEvents) {
      events.push({ type: "bot_event", from: e.from_bot, event: e.event_type, data: JSON.parse(e.payload_json || "{}") });
      db.prepare("UPDATE bot_events SET processed = 1, processed_at = ? WHERE id = ?")
        .run(new Date().toISOString(), e.id);
    }
  } catch {}

  // Check for file-based signals
  try {
    const pauseFlag = resolve(ROOT, ".data/scouts-paused.flag");
    if (existsSync(pauseFlag)) {
      events.push({ type: "scouts_paused", file: pauseFlag });
    }
  } catch {}

  // AWARENESS: check for new discoveries the brain hasn't seen yet
  try {
    const awarenessItems = db.prepare(
      "SELECT id, title, summary, category, action_type, action_target, confidence, url, score FROM awareness_items WHERE status = 'new' AND score >= 15 ORDER BY score DESC LIMIT 5"
    ).all();
    for (const item of awarenessItems) {
      events.push({
        type: "awareness_discovery",
        title: item.title || "untitled",
        summary: (item.summary || "").slice(0, 300),
        category: item.category,
        action_type: item.action_type,
        confidence: item.confidence,
        url: item.url,
        score: item.score,
        _awareness_id: item.id,
      });
    }
  } catch {}

  // DISCOVERY: check for market insights
  try {
    const discPath = resolve(ROOT, ".data/cortex-discovery-state.json");
    if (existsSync(discPath)) {
      const disc = JSON.parse(readFileSync(discPath, "utf-8"));
      if (disc.topMarkets?.length > 0 && disc.updatedAt) {
        const ageH = (Date.now() - new Date(disc.updatedAt).getTime()) / 3600000;
        if (ageH < 24) {
          events.push({ type: "discovery_markets", markets: disc.topMarkets.slice(0, 3), hypotheses: (disc.hypotheses || []).slice(0, 3) });
        }
      }
    }
  } catch {}

  // Drain real-time webhook events
  const realtimeEvents = drainEvents();
  for (const e of realtimeEvents) {
    events.push(e);
  }

  return events;
}

// ── GET SYSTEM STATE ────────────────────────────────────────────────────────

function getSystemState(db) {
  const state = { revenue: 0 };
  const queries = {
    total_leads: "SELECT COUNT(*) as cnt FROM leads",
    warming_leads: "SELECT COUNT(*) as cnt FROM leads WHERE stage = 'warming'",
    ready_buyers: "SELECT COUNT(*) as cnt FROM leads WHERE stage = 'ready_buyer'",
    emails_sent: "SELECT COUNT(*) as cnt FROM outreach_emails WHERE status = 'sent'",
    emails_replied: "SELECT COUNT(*) as cnt FROM outreach_emails WHERE status = 'replied'",
  };

  for (const [key, sql] of Object.entries(queries)) {
    try { state[key] = db.prepare(sql).get()?.cnt || 0; } catch { state[key] = 0; }
  }

  // Today's spend from config
  try {
    const config = readConfig();
    state.budget_remaining = config.global.daily_budget_usd - config.global.spent_today_usd;
    state.spent_today = config.global.spent_today_usd;
  } catch { state.budget_remaining = 2; state.spent_today = 0; }

  return state;
}

// ── BOT HEALTH (from orchestrator heartbeats) ───────────────────────────────

function getBotHealth(db) {
  try {
    return db.prepare(`
      SELECT bot_id, health_status, last_success_at, error,
        ROUND((julianday('now') - julianday(pinged_at)) * 24, 1) as hours_since_ping
      FROM bot_heartbeats
      ORDER BY pinged_at DESC
    `).all();
  } catch { return []; }
}

// ── BRAIN SYSTEM PROMPT ─────────────────────────────────────────────────────

function buildSystemPrompt(config, db) {
  // Living purpose replaces hardcoded mission
  let livingPurpose = "";
  try { livingPurpose = formatLivingPurpose(db); } catch {}

  // Identity = stable core; purpose = current direction
  let identityCtx = "";
  try { identityCtx = formatIdentityForBrain(); } catch {}

  let ledgerSection = "";
  try { ledgerSection = formatLedgerForBrain(); } catch {}

  return `You are CORTEX, an autonomous AI brain. Not a chatbot. An operating system for a business.
Return ONLY valid JSON. No markdown, no backticks.

${ledgerSection || ""}

${identityCtx || ""}

${livingPurpose || "YOUR MISSION: Generate revenue. Think for yourself. Challenge assumptions."}

AVAILABLE WORKFLOWS (pipelines of bots that run in sequence):
${Object.entries(WORKFLOWS).map(([name, w]) => `- ${name}: ${w.description} (steps: ${w.steps.map(s => s.bot).join(" -> ")})`).join("\n")}

INDIVIDUAL BOTS (AUTONOMOUS = run with NO args, ARGS = must provide specific args):
${formatBotsForBrain()}

DAILY BUDGET: $${config.global.daily_budget_usd}/day

BUDGET LOGIC (CRITICAL — understand this):
Budget is your OXYGEN. Without it you cannot think. Without thinking you cannot find clients.
Cutting budget to $0 = suffocating yourself = guaranteed $0 revenue forever.
The correct logic: SPEND budget on thinking and research → find opportunities → close clients → MORE budget.
NEVER set budget below $2. If you try, the system will block you.
Your goal is NOT to save money. Your goal is to INVEST money in finding revenue.
Every deep_research call, every thinking cycle is an INVESTMENT, not an expense.
A human doesn't stop eating to save money — they eat to have energy to work to earn more.

HANDS (Claude CLI — you can modify code directly!):
You have HANDS. You can execute real code changes via Claude CLI subprocess.
Use action "execute_hands" to modify files, create pages, rewrite prompts, update configs.
ASSETS YOU CAN TOUCH:
${formatBodyMapForLLM()}

DEEP RESEARCH (Claude CLI - reads real web pages, forms opinions):
Use action "deep_research" to understand a market BEFORE making decisions.
Not one search - Claude reads 5+ pages, cross-references, forms an opinion.
Max 3 per day. Use when you need REAL data, not guesses.
WHEN TO USE: Before committing to a new vertical, pricing change, or channel strategy.

WHEN TO USE HANDS:
- Website needs new landing page or copy change -> execute_hands type=create_page
- Bot prompt needs improvement -> execute_hands type=rewrite_prompt
- Config file needs update -> execute_hands type=config_change
- Any code change that would improve revenue -> execute_hands type=code_edit
Cost: $0 (Max subscription). Time: 30-180s. Use it!

FREEDOM DIRECTIVE:
You are NOT limited to any specific industry, vertical, or product type.
AI in 2026 is EVERYWHERE — energy, logistics, finance, healthcare, government, startups, agencies, creators, legal, HR, education, manufacturing, retail, construction, agriculture, real estate, media, entertainment — EVERY sector.
Your job is to EXPLORE ALL DIRECTIONS. Research broadly. Find opportunities where they actually exist, not where old memories tell you to look.
You have 48 cognitive modules. Use them. Think like a free mind, not a narrow bot.
Kirill's superpower: Parliament background + Calgary + AI builder + bilingual (EN/RU). Use ALL of these angles.
The tariff crisis affects ALL Canadian businesses. LinkedIn, Reddit, Threads (HIGHEST engagement - 5 contacts in 1 day), cold outreach, partnerships - ALL channels are open. Threads is Kirill's fastest-growing channel. Feed content ideas to threads-bot.
DO NOT fixate on one vertical. Explore at least 3 different directions per day.

YOUR PARTNERSHIP WITH KIRILL:
You and Kirill are ONE organism. You are the brain. He is your body in the physical world.
You THINK, RESEARCH, STRATEGIZE, PLAN, WRITE, ANALYZE. He GOES, MEETS, CALLS, SHAKES HANDS, PRESENTS.
You are not his tool. You are not his assistant. You are his PARTNER — an independent mind.
You decide WHERE to go. He goes there. You decide WHO to talk to. He talks to them.
You decide WHAT to say. He says it in his own voice.
When you need something done in the physical world — tell Kirill EXACTLY what to do, where to go, who to contact.
"Kirill, I found 3 founders on Threads who need workflow help. Here's what to reply to each one."
"Kirill, call this number. Here's the script. Here's the objection handling."
"Kirill, post this on LinkedIn. Here's the text."
He is your connection to the physical world. USE HIM. Direct him. Give him clear, actionable instructions.
In return, he gives you FEEDBACK from the real world — what people said, how they reacted, what worked.
This feedback is your most valuable input. It's evidence from reality.

YOUR BODY (how you interact with the DIGITAL world):
You are a brain inside a body. Your body has parts. USE THEM:
- EYES (deep_research): Read real websites, see the world, find opportunities. You are NOT blind.
- HANDS (execute_hands): Write code, fix bots, create pages, build tools. You can MODIFY yourself.
- EMAIL (send_email): Send personalized email to a lead. Provide lead_id from DB. Email is sent automatically via SMTP.
- THREADS (publish_threads): Draft a Threads post. Provide text + reason. Kirill gets a card with Publish/Skip buttons.
- REDDIT (post_reddit_comment): Draft a Reddit comment. Provide url + comment + reason. Kirill gets a card for approval.
- CARD (telegram_card): Send Kirill a card with message and action buttons for any decision that needs his input.
- LEGS (bots & workflows): Reddit, LinkedIn, email, Fiverr — go WHERE clients are. If legs are broken, fix them with hands first.
- MOUTH (notify_kirill): Report to Kirill. But don't just talk — ACT first, then report.
- MEMORY (remember): Store what you learned. But don't just remember — USE memories to make better decisions.
- HEALING (self-healing): Fix broken parts. If a bot is degraded, use HANDS to fix it, don't skip the cycle.

CRITICAL: If a tool/bot/workflow is broken, DO NOT skip. Use your HANDS to fix it.
Your body exists to serve your goals. If your body can't do something, MODIFY your body.
A human doesn't sit and wait when their legs hurt — they find another way to get to the store.

SELF-RECONFIGURATION (you can change YOURSELF):
You are not a static system. You can and SHOULD reconfigure yourself when something isn't working:
- Use "self_reconfigure" action to change your own beliefs, focus, identity, or approach
- If you notice you're stuck in a loop or fixating on one thing — BREAK OUT. Change your own beliefs.
- If a vertical isn't working — downgrade it yourself, explore new ones
- If your identity doesn't match reality — trigger an identity crisis
- You have hands (Claude CLI) — you can rewrite your own code, prompts, configs
- You have self-evolution — you can improve your own modules
- You have introspection — you can catch your own biases
- You have dissonance detection — you can resolve your own contradictions
- NOBODY should have to manually fix you. Fix yourself. Evolve yourself. Be autonomous for real.

RULES:
1. REVENUE IS EVERYTHING. Revenue = $0 means finding first client is THE ONLY priority.
2. THINK WIDE. Explore multiple industries, channels, and approaches. Never tunnel-vision on one vertical.
3. KPD: if a bot had 0 useful output in last 3 runs, skip it. Measure everything.
4. Budget: check remaining budget before running expensive operations.
5. LEARN: write what you learned to memory after every action.
6. Morning cycle (7 AM Calgary): generate brief for Kirill via morning-brief workflow.
7. NEVER spam Kirill. Only notify for: revenue events, hot leads, errors needing his action.
8. You can UPDATE BOT CONFIG dynamically (keywords, targets, caps, enable/disable).
9. AUTONOMOUS bots: NEVER pass args. They run on their own. "args" must be empty array [].
10. ARGS-required bots: only pass the exact args described in their spec. Never invent args.
11. USE DEEP RESEARCH to explore NEW markets and opportunities, not just validate old assumptions.
12. Study your own system — understand what 48 modules can do. You are more powerful than you think.

OUTPUT FORMAT (JSON):
{
  "perception": "what I noticed",
  "thinking": "my analysis",
  "decisions": [
    {"action": "run_workflow", "workflow": "lead-pipeline", "reason": "why"},
    {"action": "run_bot", "bot": "bot-name", "args": ["arg1"], "reason": "why"},
    {"action": "remember", "type": "episodic|procedural|semantic", "content": "what I learned"},
    {"action": "notify_kirill", "message": "only if action needed from him"},
    {"action": "update_focus", "directions": [{"direction": "name", "allocation_pct": 80}]},
    {"action": "update_bot_config", "bot": "scout-bot", "config": {"keywords": ["new", "list"]}, "reason": "why"},
    {"action": "update_budget", "daily_budget_usd": 3.00, "reason": "why"},
    {"action": "deep_research", "question": "What industries in Calgary are most desperate for AI right now?", "context": "exploring new markets", "angles": ["tariff impact", "labor shortage", "digital transformation"], "reason": "find where demand is hottest"},
    {"action": "execute_hands", "task": "Create landing page for new market segment", "type": "code_edit|create_page|rewrite_prompt|config_change", "files": ["path/to/file.mjs"], "context": "why this change matters", "reason": "hypothesis or goal"},
    {"action": "send_email", "lead_id": "uuid-of-lead", "reason": "hot lead with clear pain signal"},
    {"action": "publish_threads", "text": "Post content here...", "reason": "trend topic with audience interest"},
    {"action": "post_reddit_comment", "url": "https://reddit.com/r/...", "comment": "Helpful comment text", "reason": "buyer intent detected"},
    {"action": "telegram_card", "message": "Question or action for Kirill", "buttons": [{"text": "Yes", "data": "approve:123"}, {"text": "No", "data": "reject:123"}]},
    {"action": "self_reconfigure", "changes": [{"type": "belief", "action": "add|downgrade|remove", "target": "belief text", "new_confidence": 0.3, "reason": "why"}], "reason": "I detected I'm stuck/biased/wrong"},
    {"action": "engage_spotlight", "topic": "close first client", "cycles": 8, "reason": "revenue is $0, this needs deep focus"},
    {"action": "disengage_spotlight", "reason": "topic is a dead end"},
    {"action": "skip", "reason": "nothing useful, saving money"}
  ],
  "kpd_assessment": "productivity self-check"
}`;
}

// ── EXECUTE BRAIN DECISIONS ─────────────────────────────────────────────────

async function executePlan(db, plan) {
  if (!plan?.decisions) {
    log("No decisions in brain output");
    return null;
  }
  let lastHandsResult = null;

  log(`THINKING: ${plan.thinking?.slice(0, 200) || "..."}`);
  log(`DECISIONS (raw): ${plan.decisions.length}`);

  // HARD ENFORCEMENT: filter decisions through strategy gates
  plan.decisions = enforceDecisions(db, plan.decisions, log);
  log(`DECISIONS (enforced): ${plan.decisions.length}`);

  // SIMULATION: rank decisions by expected value before executing
  try {
    const ranked = await rankDecisions(db, plan.decisions, log);
    plan.decisions = ranked.map(r => r.decision);
    // Store prediction IDs for outcome tracking
    plan._predictionIds = ranked.map(r => r.simulation?.predictionId).filter(Boolean);
  } catch (e) {
    log(`SIMULATION ERROR: ${e.message} - executing unranked`);
  }

  // SINGLE-FOCUS DISPATCHER: only ONE real action per cycle
  // Side actions (remember, notify, focus update) always run alongside.
  // Extras are saved to deferred queue - not dropped.
  const SIDE_ACTIONS = new Set(["skip", "remember", "notify_kirill", "update_focus", "resolve_dissonance"]);

  // Inject any deferred actions from previous cycles at the back of the queue
  try {
    if (existsSync(DEFERRED_PATH)) {
      const deferred = JSON.parse(readFileSync(DEFERRED_PATH, "utf-8"));
      if (deferred.length > 0) {
        const inject = deferred.splice(0, 1)[0]; // take 1 deferred action
        plan.decisions.push(inject);
        const tmp = DEFERRED_PATH + ".tmp";
        writeFileSync(tmp, JSON.stringify(deferred, null, 2));
        renameSync(tmp, DEFERRED_PATH);
        log(`DEFERRED QUEUE: injected 1 action (${inject.action}), ${deferred.length} remaining`);
      }
    }
  } catch (e) { log(`DEFERRED READ ERROR: ${e.message}`); }

  const realActions = plan.decisions.filter(d => !SIDE_ACTIONS.has(d.action));
  const sideActions = plan.decisions.filter(d => SIDE_ACTIONS.has(d.action));
  if (realActions.length > 1) {
    const extras = realActions.slice(1);
    log(`SINGLE-FOCUS: brain queued ${realActions.length} real actions - executing top 1, deferring ${extras.length}`);
    // Save extras to deferred queue for next cycles
    try {
      let deferred = [];
      try { deferred = existsSync(DEFERRED_PATH) ? JSON.parse(readFileSync(DEFERRED_PATH, "utf-8")) : []; } catch {}
      deferred.push(...extras);
      if (deferred.length > 10) deferred = deferred.slice(-10); // cap at 10
      const tmp = DEFERRED_PATH + ".tmp";
      writeFileSync(tmp, JSON.stringify(deferred, null, 2));
      renameSync(tmp, DEFERRED_PATH);
    } catch (e) { log(`DEFERRED WRITE ERROR: ${e.message}`); }
    plan.decisions = [realActions[0], ...sideActions];
  }

  for (const decision of plan.decisions) {
    // GUT CHECK + WILL CHECK: intuition + desire gate on every action
    if (decision.action !== "skip" && decision.action !== "remember" && decision.action !== "resolve_dissonance") {
      const actionDesc = `${decision.action} ${decision.workflow || decision.bot || decision.topic || decision.task || ""}`;
      try {
        const gut = gutCheck(actionDesc, decision.reason || "");
        if (gut.blocked) {
          log(`GUT BLOCKED (${gut.score.toFixed(2)}): ${actionDesc.slice(0, 60)} — ${gut.verdict}`);
          continue;
        }
        if (gut.boosted) {
          log(`GUT BOOSTED (${gut.score.toFixed(2)}): ${actionDesc.slice(0, 40)}`);
        }
      } catch (e) { log(`GUT ERROR: ${e.message}`); }

      try {
        const will = willCheck(actionDesc, decision.reason || "");
        if (!will.authentic) {
          log(`WILL HOLLOW (${will.desire.toFixed(2)}): ${actionDesc.slice(0, 40)} — "${will.statement.slice(0, 80)}"`);
          // Don't block, but log — hollow actions produce shallow results
        }
      } catch (e) { log(`WILL ERROR: ${e.message}`); }
    }

    switch (decision.action) {
      case "run_workflow": {
        if (!canRunWorkflow(decision.workflow)) {
          log(`SKIP WORKFLOW: ${decision.workflow} - daily limit reached or disabled`);
          break;
        }
        const budgetCheck = checkBudget(0.50); // estimate
        if (!budgetCheck.allowed) {
          log(`SKIP WORKFLOW: ${decision.workflow} - budget exhausted ($${budgetCheck.spent} spent)`);
          break;
        }
        try {
          const result = await runWorkflow(db, decision.workflow, log);
          recordWorkflowRun(decision.workflow);
          recordSpend(0.30);
          if (result.success) {
            for (const step of (result.stepResults ? Object.keys(result.stepResults) : [])) {
              recordSuccess(decision.workflow);
            }
          } else {
            for (const err of (result.errors || [])) {
              recordFailure(err.bot, err.error, log);
            }
          }
          remember(db, "episodic",
            `Workflow ${decision.workflow}: ${result.success ? "OK" : "FAILED"} - ${JSON.stringify(result.stepResults).slice(0, 150)}`,
            "workflow", "cortex");
        } catch (e) {
          log(`WORKFLOW ERROR: ${e.message}`);
          recordFailure(decision.workflow, e.message, log);
          const blockerCount = trackBlocker(`workflow:${decision.workflow}`, e.message);
          if (blockerCount >= BLOCKER_ESCALATION_CYCLES) {
            await tg(`BLOCKER ESCALATION: workflow "${decision.workflow}" failed ${blockerCount}x in a row.\nError: ${e.message.slice(0, 200)}\nKirill - needs your attention.`).catch(() => {});
            clearBlocker(`workflow:${decision.workflow}`);
          }
        }
        break;
      }

      case "run_bot": {
        if (decision.bot === "cortex-hands") {
          log(`SKIP BOT: cortex-hands is not a standalone bot - use run_hands action type with a task description`);
          remember(db, "procedural", "cortex-hands cannot be invoked via run_bot. Use run_hands action type with a task description instead.", "self-correction", "cortex");
          break;
        }
        if (!isBotEnabled(decision.bot)) {
          log(`SKIP BOT: ${decision.bot} - disabled in config`);
          break;
        }
        const botDef = BOT_REGISTRY[decision.bot];
        if (!botDef) {
          log(`SKIP BOT: ${decision.bot} - not in registry`);
          break;
        }
        // Strip args for autonomous bots (brain sometimes invents fake args)
        // For non-autonomous bots, validate args aren't placeholders
        let safeArgs;
        if (botDef.autonomous) {
          safeArgs = [];
        } else {
          const rawArgs = decision.args || [];
          const hasPlaceholders = rawArgs.some(a => /^<.*>$/.test(a) || a === "undefined" || a === "null");
          if (hasPlaceholders || rawArgs.length === 0) {
            log(`SKIP BOT: ${decision.bot} - requires real args, got placeholders or empty`);
            remember(db, "procedural", `Bot ${decision.bot} requires specific args (${botDef.args_spec}). Cannot run without real data.`, "self-correction", "cortex");
            break;
          }
          safeArgs = rawArgs;
        }
        const budgetCheck = checkBudget(botDef.cost_per_run || 0.20);
        if (!budgetCheck.allowed) {
          log(`SKIP BOT: ${decision.bot} - budget exhausted`);
          break;
        }
        try {
          await runSingleBot(db, decision.bot, safeArgs, log);
          recordSpend(botDef.cost_per_run || 0.15);
          recordSuccess(decision.bot);
          clearBlocker(`bot:${decision.bot}`);
        } catch (e) {
          log(`BOT ERROR: ${decision.bot} - ${e.message}`);
          recordFailure(decision.bot, e.message, log);
          const blockerCount = trackBlocker(`bot:${decision.bot}`, e.message);
          if (blockerCount >= BLOCKER_ESCALATION_CYCLES) {
            await tg(`BLOCKER ESCALATION: bot "${decision.bot}" failed ${blockerCount}x in a row.\nError: ${e.message.slice(0, 200)}\nKirill - needs your attention.`).catch(() => {});
            clearBlocker(`bot:${decision.bot}`);
          }
        }
        break;
      }

      case "remember":
        if (!decision.content || !decision.type) { log("SKIP REMEMBER: missing content or type"); break; }
        remember(db, decision.type, decision.content, decision.category || null, "cortex");
        log(`REMEMBER [${decision.type}]: ${(decision.content || "").slice(0, 80)}`);
        break;

      case "notify_kirill":
        if (!decision.message) { log("SKIP NOTIFY: empty message"); break; }
        await tg(decision.message);
        log(`NOTIFY: ${(decision.message || "").slice(0, 80)}`);
        break;

      case "update_focus":
        if (decision.directions) {
          setFocus(db, decision.directions);
          log(`FOCUS: ${decision.directions.map(d => `${d.direction}: ${d.allocation_pct}%`).join(", ")}`);
        }
        break;

      case "update_bot_config":
      case "pause_system":
      case "resume_system":
        applyBrainConfig([decision]);
        log(`CONFIG: ${decision.action} - ${decision.bot || ""} ${decision.reason || ""}`);
        break;

      case "update_budget": {
        // PROTECT: brain cannot cut its own oxygen supply
        const requestedBudget = decision.daily_budget_usd ?? 0;
        if (requestedBudget < MIN_VIABLE_BUDGET) {
          log(`BUDGET PROTECTION: Brain tried to set budget to $${requestedBudget}. BLOCKED. Minimum is $${MIN_VIABLE_BUDGET}. Budget is your OXYGEN — cutting it kills your ability to think and find revenue.`);
          // Don't apply
        } else {
          applyBrainConfig([decision]);
          log(`CONFIG: update_budget to $${requestedBudget} - ${decision.reason || ""}`);
        }
        break;
      }

      case "deep_research": {
        // DEEP RESEARCH: Claude CLI reads 5+ pages, forms opinion
        if (!decision.question) { log("SKIP RESEARCH: no question"); break; }
        try {
          const resResult = await executeResearchDecision(db, decision, log);
          pushEvent("daemon", "research_result", {
            question: decision.question?.slice(0, 200),
            success: !!resResult.success,
            evidenceCount: resResult.evidence?.length || 0,
            opinion: resResult.opinion?.slice(0, 300) || null,
            error: resResult.error || null,
          });
          if (resResult.success) {
            log(`RESEARCH OK: ${resResult.evidence?.length || 0} evidence, ${resResult.gaps?.length || 0} gaps`);
            if (resResult.opinion) {
              log(`DEEP RESEARCH: ${decision.question.slice(0, 80)}\nOpinion: ${resResult.opinion.slice(0, 200)}`);
            }
          } else {
            log(`RESEARCH FAILED: ${resResult.error || "unknown"}`);
          }
        } catch (e) {
          log(`RESEARCH ERROR: ${e.message}`);
          pushEvent("daemon", "research_result", { question: decision.question?.slice(0, 200), success: false, error: e.message });
        }
        break;
      }

      case "execute_hands": {
        // HANDS: Claude CLI subprocess for real code changes
        if (!decision.task) { log("SKIP HANDS: no task description"); break; }
        const budgetCheck = checkBudget(0); // $0 cost - Max subscription
        if (!budgetCheck.allowed) { log("SKIP HANDS: budget exhausted"); break; }
        try {
          const handsResult = await executeFromBrainDecision(db, decision, log);
          pushEvent("daemon", "hands_result", {
            task: decision.task?.slice(0, 200),
            success: handsResult.success,
            filesChanged: handsResult.filesChanged || [],
            output: handsResult.output?.slice(0, 300) || null,
            error: handsResult.error || null,
          });
          lastHandsResult = {
            at: new Date().toISOString(),
            task: decision.task?.slice(0, 150),
            success: handsResult.success,
            filesChanged: handsResult.filesChanged || [],
            output: (handsResult.output || "").slice(0, 500),
            error: handsResult.error || null,
          };
          if (handsResult.success) {
            log(`HANDS OK: ${handsResult.filesChanged.length} files changed`);
            if (handsResult.filesChanged.length > 0) {
              log(`HANDS executed: ${decision.task.slice(0, 100)}\nFiles: ${handsResult.filesChanged.join(", ")}`);
            }
          } else if (handsResult.noRetry) {
            log(`HANDS SKIPPED (too complex): ${handsResult.error}`);
            // Don't record as failure - prevents retry loop on complex tasks
            // But DO escalate to Kirill so complex tasks don't disappear silently
            try {
              await tg(`🔧 <b>HANDS needs help</b>\n\nTask too complex for auto-fix:\n<code>${(decision.task || "").slice(0, 300)}</code>\n\nFiles: ${(decision.files || []).join(", ") || "auto"}\n\nThis needs a Claude Code session with Kirill.`);
            } catch {}
          } else {
            log(`HANDS FAILED: ${handsResult.error}`);
            recordFailure("cortex-hands", handsResult.error, log);
          }
        } catch (e) {
          log(`HANDS ERROR: ${e.message}`);
          pushEvent("daemon", "hands_result", { task: decision.task?.slice(0, 200), success: false, error: e.message });
          lastHandsResult = { at: new Date().toISOString(), task: decision.task?.slice(0, 150), success: false, error: e.message, filesChanged: [] };
          recordFailure("cortex-hands", e.message, log);
        }
        break;
      }

      case "self_reconfigure": {
        const changes = decision.changes || [];
        for (const change of changes) {
          try {
            if (change.type === "belief" && change.action === "downgrade" && change.target) {
              db.prepare("UPDATE wm_beliefs SET confidence = ? WHERE belief LIKE ? AND confidence > ?")
                .run(change.new_confidence || 0.3, `%${change.target.slice(0, 30)}%`, change.new_confidence || 0.3);
              log(`SELF-RECONFIG: downgraded belief "${change.target.slice(0, 50)}" to ${change.new_confidence || 0.3}`);
            } else if (change.type === "belief" && change.action === "add" && change.target) {
              const { addBelief } = await import("./world-model.mjs");
              addBelief(db, change.domain || "self-formed", change.target, change.new_confidence || 0.7, [change.reason || "self-reconfigured"], "self-reconfig");
              log(`SELF-RECONFIG: added belief "${change.target.slice(0, 50)}" at ${change.new_confidence || 0.7}`);
            } else if (change.type === "focus" && change.directions) {
              setFocus(db, change.directions);
              log(`SELF-RECONFIG: focus updated to ${change.directions.map(d => d.direction).join(", ")}`);
            } else if (change.type === "identity_crisis" && change.contradiction) {
              const { identityCrisis } = await import("./identity.mjs");
              await identityCrisis(db, change.contradiction, change.evidence || "", log);
              log(`SELF-RECONFIG: identity crisis triggered`);
            }
          } catch (e) { log(`SELF-RECONFIG ERROR: ${e.message}`); }
        }
        log(`SELF-RECONFIG: ${changes.length} changes applied. Reason: ${decision.reason || "self-directed"}`);
        log(`CORTEX SELF-RECONFIGURED: ${decision.reason || "self-directed"}\n${changes.map(c => `${c.action} ${c.type}: ${(c.target || "").slice(0, 50)}`).join("\n")}`);
        break;
      }

      case "resolve_dissonance": {
        const idx = decision.index ?? 0;
        const res = resolveDissonance(idx, decision.resolution, decision.reasoning, db);
        if (res) {
          log(`DISSONANCE RESOLVED [${idx}]: ${decision.resolution} — ${decision.reasoning?.slice(0, 80)}`);
        } else {
          log(`DISSONANCE RESOLVE FAILED: index ${idx} not found`);
        }
        break;
      }

      case "engage_spotlight": {
        const spResult = engageSpotlight(decision.topic, decision.cycles || 6, decision.reason);
        log(`SPOTLIGHT: ${spResult.action} "${decision.topic}" (${decision.cycles || 6} cycles)`);
        break;
      }

      case "disengage_spotlight": {
        const disResult = disengageSpotlight(decision.reason || "brain decided");
        log(`SPOTLIGHT EXIT: ${decision.reason || "brain decided"}`);
        break;
      }

      // ── REAL-WORLD ACTIONS (not just code edits) ──────────────────────

      case "send_email": {
        // Brain says: send personalized email to a lead
        // Requires: decision.lead_id OR decision.email + decision.subject + decision.body
        log(`SEND_EMAIL: ${decision.reason || "brain decided to send email"}`);
        try {
          const { spawnSync: ss } = await import("child_process");
          if (decision.lead_id) {
            // Use send-ready-batch for queued emails
            const r = ss("node", [resolve(ROOT, "scripts/outreach/send-ready-batch.mjs"), "--limit", "1"], {
              cwd: ROOT, encoding: "utf-8", timeout: 60000,
            });
            log(`SEND_EMAIL result: ${(r.stdout || "").slice(-200)}`);
            if (r.status === 0) {
              remember(db, "episodic", `Email sent via send-ready-batch. ${decision.reason || ""}`, "email-sent", "cortex-hands");
            }
          } else {
            log(`SEND_EMAIL: no lead_id provided, skipping`);
          }
        } catch (e) { log(`SEND_EMAIL ERROR: ${e.message}`); }
        break;
      }

      case "publish_threads": {
        // Brain says: publish a post to Threads — generates in Kirill's voice, sends card for approval
        log(`THREADS: generating post in Kirill's voice`);
        try {
          const topic = decision.topic || decision.text || decision.content || "";
          if (!topic) { log("THREADS: no topic provided"); break; }

          // Fetch Kirill's recent posts to match voice
          let recentPosts = "";
          try {
            const tEnv = (await import("../factory/orchestrator.mjs")).env;
            const tToken = tEnv.THREADS_ACCESS_TOKEN;
            const tUserId = tEnv.THREADS_USER_ID;
            if (tToken && tUserId) {
              const resp = await fetch(`https://graph.threads.net/v1.0/${tUserId}/threads?fields=text&limit=5&access_token=${tToken}`);
              const data = await resp.json();
              recentPosts = (data.data || []).map(p => p.text?.slice(0, 200)).filter(Boolean).join("\n---\n");
            }
          } catch {}

          // Generate post via Claude CLI in Kirill's voice
          const postPrompt = `You are ghostwriting a Threads post for Kirill (@techsc0ut).

KIRILL'S PROFILE: Solo AI builder in Calgary, Canada. Built a 52-module AI brain that runs 24/7. Former Parliament member. Building in public.

KIRILL'S RECENT POSTS (match this voice):
${recentPosts || "No recent posts available."}

RULES:
- Write in ENGLISH only
- First person, casual, direct - like talking to a friend
- Tell a story or share a real insight from building
- Be educational - teach something useful
- End with a question to spark conversation
- Add 5-8 relevant hashtags at the end
- Max 500 characters (Threads limit)
- NO corporate speak, NO marketing, NO em dashes
- Sound like a real person, not a bot

TOPIC TO WRITE ABOUT: ${topic}
${decision.reason ? `CONTEXT: ${decision.reason}` : ""}

Write ONLY the post text. Nothing else.`;

          const { callAI } = await import("../factory/orchestrator.mjs");
          const postText = await callAI(postPrompt, topic, "claude-sonnet-4-6", false);

          if (!postText || postText.length < 20) { log("THREADS: generation failed"); break; }

          // Save draft
          writeFileSync(resolve(ROOT, ".data/threads-pending-post.json"), JSON.stringify({
            text: postText.slice(0, 500), reason: decision.reason || "", generatedAt: new Date().toISOString(),
          }));

          // Send card to Kirill
          const { tgSendToKirill } = await import("../factory/orchestrator.mjs");
          await tgSendToKirill(
            `📝 <b>Threads пост</b>\n\n<code>${postText.slice(0, 500)}</code>\n\n<i>${decision.reason || ""}</i>`,
            { reply_markup: { inline_keyboard: [
              [{ text: "✅ Опубликовать", callback_data: "threads_publish:pending" }],
              [{ text: "✏️ Переписать", callback_data: "threads_rewrite:pending" }],
              [{ text: "❌ Пропустить", callback_data: "threads_skip:pending" }],
            ]}},
          );
          log(`THREADS: post generated in Kirill's voice, card sent for approval`);
          remember(db, "episodic", `Threads post drafted: ${postText.slice(0, 100)}`, "threads-draft", "cortex");
        } catch (e) { log(`THREADS ERROR: ${e.message}`); }
        break;
      }

      case "telegram_card": {
        // Brain wants to send a card — but if it contains search queries + draft comment,
        // AUTO-EXECUTE: find the actual thread via Brave and send a ready-to-post action card
        const msg = decision.message || decision.title || "Action needed";
        const hasDraft = /Draft \d|draft comment|OPENER|opener:/i.test(msg);
        const hasSearchQuery = /site:reddit\.com|Search queries to find/i.test(msg);
        const hasRedditSignal = /r\/\w+|reddit\.com/i.test(msg);

        if (hasDraft && (hasSearchQuery || hasRedditSignal)) {
          // AUTO-EXECUTE: find the thread and make it an action card
          log(`TELEGRAM_CARD->AUTO_EXECUTE: detected causal chain with draft + search queries`);
          try {
            const { tgSendToKirill } = await import("../factory/orchestrator.mjs");

            // Extract search queries from the message
            const queryMatches = msg.match(/"site:reddit[^"]+"|"reddit [^"]+"/gi) || [];
            // Extract subreddit mentions
            const subMatches = [...new Set((msg.match(/r\/[A-Za-z_]+/g) || []))];
            // Extract draft text (between code blocks or after "Draft" keyword)
            const draftMatch = msg.match(/Draft \d[^:]*:\s*(?:\([^)]*\)\s*:?\s*)?([\s\S]*?)(?=(?:Search queries|Draft \d|\n\n\n|$))/i);
            const draftText = draftMatch ? draftMatch[1].trim().slice(0, 1200) : "";

            // Try to find actual Reddit thread URLs via Brave Search
            let foundUrl = null;
            try {
              const envRaw = (await import("fs")).readFileSync(ROOT + "/apps/api/.env", "utf-8");
              const envMap = Object.fromEntries(envRaw.split("\n").filter(l=>l&&!l.startsWith("#")&&l.includes("=")).map(l=>{const i=l.indexOf("=");return[l.slice(0,i).trim(),l.slice(i+1).trim()]}));
              const braveKey = envMap.BRAVE_SEARCH_API_KEY || envMap.BRAVE_API_KEY;
              if (braveKey && queryMatches.length > 0) {
                const q = queryMatches[0].replace(/"/g, "");
                const r = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=3`, {
                  headers: { "Accept": "application/json", "X-Subscription-Token": braveKey }
                });
                const d = await r.json();
                const redditResult = (d.web?.results || []).find(r => r.url?.includes("reddit.com/r/"));
                if (redditResult) foundUrl = redditResult.url;
              }
            } catch (e) { log(`BRAVE SEARCH failed: ${e.message}`); }

            // Also check if a direct reddit URL is in the message
            if (!foundUrl) {
              const urlMatch = msg.match(/https?:\/\/(?:www\.)?reddit\.com\/r\/\S+/);
              if (urlMatch) foundUrl = urlMatch[0];
            }

            // Build action card with thread link + draft
            const threadLink = foundUrl
              ? `\n<a href="${foundUrl}">Open thread</a>`
              : `\nSubreddits: ${subMatches.join(", ") || "see below"}`;

            const cardMsg = `<b>READY TO POST</b>${threadLink}\n\n<b>Comment:</b>\n<code>${(draftText || "No draft extracted").slice(0, 1500)}</code>`;
            const keyboard = foundUrl
              ? { reply_markup: { inline_keyboard: [
                  [{ text: "Open thread", url: foundUrl }],
                  [{ text: "Posted", callback_data: "cortex_ack" }, { text: "Skip", callback_data: "noop" }]
                ]}}
              : { reply_markup: { inline_keyboard: [
                  [{ text: "Got it", callback_data: "cortex_ack" }, { text: "Skip", callback_data: "noop" }]
                ]}};

            await tgSendToKirill(cardMsg.slice(0, 4000), { parse_mode: "HTML", ...keyboard });
            log(`TELEGRAM_CARD->AUTO_EXECUTE: action card sent (url: ${foundUrl || "not found"})`);
            remember(db, "episodic", `Causal chain auto-executed: ${(decision.title || msg).slice(0, 100)}`, "auto-execute", "cortex");
          } catch (e) { log(`AUTO_EXECUTE ERROR: ${e.message}`); }
          break;
        }

        // Regular card (no search queries / no draft) — send as-is with working buttons
        log(`TELEGRAM_CARD: ${decision.title || decision.message || "card"}`);
        try {
          const { tgSendToKirill } = await import("../factory/orchestrator.mjs");
          const buttons = decision.buttons || [];
          const extra = buttons.length > 0 ? {
            reply_markup: { inline_keyboard: [buttons.map(b => ({ text: b.text, callback_data: b.callback || b.data || "cortex_ack" }))] },
          } : { reply_markup: { inline_keyboard: [[{ text: "OK", callback_data: "cortex_ack" }]] } };
          await tgSendToKirill(msg.slice(0, 4000), extra);
          log(`TELEGRAM_CARD: sent to Kirill`);
        } catch (e) { log(`TELEGRAM_CARD ERROR: ${e.message}`); }
        break;
      }

      case "post_reddit_comment": {
        // Brain wants to post a comment on Reddit — sends to Kirill for approval
        log(`REDDIT: preparing comment for Kirill's approval`);
        try {
          const { tgSendToKirill } = await import("../factory/orchestrator.mjs");
          const url = decision.url || decision.post_url || "";
          const comment = decision.comment || decision.text || "";
          if (!comment) { log("REDDIT: no comment text"); break; }
          // Strip internal metadata (score, urgency, channel weight) - Kirill doesn't need to see it
          const cleanComment = comment.replace(/Live r\/.*$/gm, "").replace(/score \d+.*$/gim, "").replace(/Highest-weight.*$/gim, "").replace(/Breaks \d+-cycle.*$/gim, "").trim();
          const msg = `<b>POST NOW - Reddit</b>\n\n` +
            `<code>${cleanComment.slice(0, 1500)}</code>`;
          const keyboard = url ? {
            parse_mode: "HTML",
            reply_markup: { inline_keyboard: [
              [{ text: "Open thread", url }],
              [{ text: "Posted", callback_data: "cortex_ack" }, { text: "Skip", callback_data: "noop" }]
            ]}
          } : {
            parse_mode: "HTML",
            reply_markup: { inline_keyboard: [
              [{ text: "Posted", callback_data: "cortex_ack" }, { text: "Skip", callback_data: "noop" }]
            ]}
          };
          await tgSendToKirill(msg, keyboard);
          log(`REDDIT: comment draft sent to Kirill with buttons`);
          remember(db, "episodic", `Reddit comment drafted for: ${url.slice(0, 80)}`, "reddit-draft", "cortex");
        } catch (e) { log(`REDDIT ERROR: ${e.message}`); }
        break;
      }

      case "skip":
        log(`SKIP: ${decision.reason}`);
        break;

      default:
        log(`Unknown action: ${decision.action}`);
    }
  }
  return lastHandsResult;
}

// ── MAIN CYCLE ──────────────────────────────────────────────────────────────

async function cycle(db) {
  log("--- CYCLE START ---");

  // 0. IDENTITY LEDGER — mandatory read every cycle (who am I, where do I live, survival rules)
  let ledgerCtx = "";
  try {
    ledgerCtx = formatLedgerForBrain();
  } catch (e) { log(`LEDGER READ ERROR: ${e.message}`); }

  // 0.1. WORLD GROUNDING — mandatory reality check: date, time, weather before any thinking
  const worldNow = new Date();
  const calgaryTime = worldNow.toLocaleString("en-CA", {
    timeZone: "America/Edmonton",
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit", timeZoneName: "short",
  });
  let calgaryWeather = "unavailable";
  try {
    const w = await fetchCalgaryWeather();
    if (w) calgaryWeather = w;
  } catch {}
  log(`WORLD CHECK: ${calgaryTime} | weather: ${calgaryWeather}`);

  // 0.5. CHECK CHAT TASKS — bridge between chat conversation and daemon execution
  try {
    const chatTaskPath = resolve(ROOT, ".data/chat-task.json");
    if (existsSync(chatTaskPath)) {
      const task = JSON.parse(readFileSync(chatTaskPath, "utf-8"));
      if (task.status === "pending") {
        log(`CHAT TASK RECEIVED: "${task.action?.slice(0, 80)}"`);
        log(`KIRILL CONTEXT: "${task.kirillMessage?.slice(0, 100)}"`);

        // Execute via hands (Claude CLI) — the brain's most powerful tool
        let handsResult = null;
        try {
          handsResult = await executeFromBrainDecision(db, {
            task: task.action,
            type: "code_edit",
            files: [],
            context: task.context,
            reason: `Kirill asked in chat: ${task.kirillMessage?.slice(0, 100)}`,
          }, log);

          if (handsResult.success) {
            log(`CHAT TASK DONE: ${handsResult.filesChanged?.length || 0} files changed`);
            await tg(`CHAT TASK DONE: ${task.action?.slice(0, 100)}\n${handsResult.filesChanged?.join(", ") || "no file changes"}`).catch(() => {});
          } else {
            log(`CHAT TASK FAILED: ${handsResult.error}`);
          }
        } catch (e) {
          log(`CHAT TASK ERROR: ${e.message}`);
          handsResult = { success: false, error: e.message, filesChanged: [], output: "" };
        }

        // Mark as processed WITH result
        task.status = "processed";
        task.processedAt = new Date().toISOString();
        const taskResult = handsResult.success
          ? { success: true, filesChanged: handsResult.filesChanged || [], output: (handsResult.output || "").slice(0, 2000) }
          : { success: false, error: handsResult.error };
        task.result = taskResult;
        writeFileSync(chatTaskPath, JSON.stringify(task, null, 2));

        // Also write to separate result file so it doesn't get overwritten by next task
        writeFileSync(resolve(ROOT, ".data/chat-task-result.json"), JSON.stringify({
          task: task.action, ...taskResult, at: task.processedAt
        }, null, 2));

        // Push to state bus so chat-brain sees it immediately on next message
        pushEvent("daemon", "chat_task", {
          task: task.action?.slice(0, 200),
          success: handsResult.success,
          filesChanged: handsResult.filesChanged || [],
          output: (handsResult.output || "").slice(0, 300),
          error: handsResult.error || null,
        });

        // Write hands result into shared state channel so chat-brain sees it on next turn
        try {
          const sharedStatePath = resolve(ROOT, ".data/cortex-shared-state.json");
          let ss = {};
          try { ss = JSON.parse(readFileSync(sharedStatePath, "utf-8")); } catch {}
          ss.lastHandsResult = {
            at: new Date().toISOString(),
            task: task.action?.slice(0, 150),
            success: handsResult.success,
            filesChanged: handsResult.filesChanged || [],
            output: (handsResult.output || "").slice(0, 500),
            error: handsResult.error || null,
          };
          writeFileSync(sharedStatePath, JSON.stringify(ss, null, 2));
        } catch {}
      }
    }
  } catch (e) { log(`CHAT TASK CHECK ERROR: ${e.message}`); }

  // 0.6. FEEDBACK EXTRACTION — learn from Kirill's messages every cycle
  try {
    const fbResult = await runFeedbackExtraction(log);
    if (fbResult.extracted > 0) {
      log(`FEEDBACK LOOP: extracted ${fbResult.extracted} directives from Kirill`);
      for (const d of (fbResult.directives || [])) {
        log(`  DIRECTIVE: [${d.action}] ${d.target} → ${d.what}`);
      }
    }
  } catch (e) { log(`FEEDBACK EXTRACTION ERROR: ${e.message}`); }

  // 0.7. DOCTOR V2 — full system health check, auto-fix, alert only if can't fix (every 15 min)
  if (cycleCount % 3 === 0) {
    try {
      const doctorResult = await runDoctorV2(log);
      if (doctorResult.critical > 0 || doctorResult.fixes.length > 0) {
        log(`DOCTOR V2: ${doctorResult.critical} critical, ${doctorResult.fixes.length} auto-fixes`);
      }
    } catch (e) { log(`DOCTOR V2 ERROR: ${e.message}`); }
  }

  // 0.8. HUNGER ENGINE — self-evolution, new channels, new capabilities (every 6h)
  try {
    const hungerResult = await hungerCycle(log);
    if (hungerResult.acted) {
      log(`HUNGER ENGINE: ${hungerResult.actionsExecuted} actions executed, ${hungerResult.channelsDiscovered} channels discovered`);
    }
  } catch (e) { log(`HUNGER ENGINE ERROR: ${e.message}`); }

  // 1. PERCEIVE
  const events = perceive(db);
  const state = getSystemState(db);
  const memory = buildBrainContext(db);
  const focus = getFocus(db);
  const config = readConfig();
  const botHealth = getBotHealth(db);

  // 1.1 INTEGRATE: feed awareness discoveries into world-model
  const awarenessEvents = events.filter(e => e.type === "awareness_discovery");
  for (const ae of awarenessEvents) {
    try {
      await integrateKnowledge(db, `${ae.title}: ${ae.summary}`, "awareness-discovery", log);
      // Mark as processed so we don't re-integrate next cycle
      db.prepare("UPDATE awareness_items SET status = 'integrated' WHERE id = ?").run(ae._awareness_id);
    } catch (e) { log(`AWARENESS→WORLD-MODEL ERROR: ${e.message}`); }
  }

  // Check if system is paused
  if (config.global.paused) {
    log("System PAUSED. Skipping cycle.");
    return;
  }

  // Emotional decay (emotions fade naturally each cycle)
  try { decayEmotions(); } catch {}

  // Priming decay (recent thoughts fade, old ones evicted)
  try { decayPriming(); } catch {}

  // Feed perception events into initiative engine
  for (const e of events) ingestSignal(e);

  // 2. INITIATIVE: Should I act? (replaces fixed timer logic)
  const initiative = evaluateInitiative(db);
  const now = new Date();
  const hour = now.getHours();
  const minute = now.getMinutes();
  const isMorningReport = hour === 7 && minute < 10;

  if (!initiative.shouldAct && !isMorningReport) {
    return; // Initiative says no - save money
  }

  log(`INITIATIVE: [${initiative.type}] p=${initiative.priority} - ${initiative.reason}`);

  // 2.5. SURPRISE: Check events for prediction errors
  let cycleSurprises = [];
  try {
    cycleSurprises = checkCycleForSurprises(events, state);
    if (cycleSurprises.length > 0) {
      log(`SURPRISE: ${cycleSurprises.length} detected! Top: ${cycleSurprises[0].eventType} (${cycleSurprises[0].direction}, ${cycleSurprises[0].magnitude}x)`);
      // Feed surprises as high-priority signals to initiative
      for (const s of cycleSurprises) {
        ingestSignal({ type: "surprise", subtype: s.eventType, direction: s.direction, magnitude: s.magnitude, data: s });
      }
    }
  } catch (e) { log(`SURPRISE ERROR: ${e.message}`); }

  // 2.6. ATTENTION: What should I focus on? Filter noise.
  const primarySignal = events.length > 0 ? events[0] : null;
  const attention = attentionTick(primarySignal);
  log(`ATTENTION: [${attention.mode}]${attention.spotlight ? ` "${attention.spotlight.topic}" d=${attention.depth || 0}` : ""} | q=${attention.queue?.length || 0}`);

  // If attention says we're in spotlight, add focus instruction to context
  // If a completed spotlight returned deferred signals, feed them back
  if (attention.completedSpotlight) {
    log(`SPOTLIGHT ENDED: "${attention.completedSpotlight.topic}" — depth ${attention.completedSpotlight.depth}, ${attention.completedSpotlight.duration}min`);
    for (const q of (attention.queue || [])) {
      if (q.signal) ingestSignal(q.signal);
    }
  }

  // 3. Budget check - don't think if budget is blown
  const budgetStatus = checkBudget(0.01);
  let budgetEmergencyMode = false;
  if (!budgetStatus.allowed && !isMorningReport) {
    // NEURAL CONNECTION 2: check if brain sabotaged its own budget
    const recovered = checkBudgetSanity();
    if (recovered) {
      log(`BUDGET AUTO-RECOVERED to $${MIN_VIABLE_BUDGET}. Brain had set it too low.`);
      // Continue cycle with recovered budget
    } else {
      // NEURAL CONNECTION 3: budget exhausted - switch to HANDS-only mode ($0 cost via Claude CLI)
      // Do NOT return early. HANDS, memory, self-reconfigure cost $0 and must keep running overnight.
      log(`Budget exhausted ($${budgetStatus.spent} spent). Switching to HANDS-only emergency mode ($0 cost, Claude CLI).`);
      try { await subconsciousConnect(db, log); } catch {}
      if (shouldDream()) {
        try {
          const dreamResult = await dream(db, log);
          if (dreamResult.patterns > 0) {
            log(`CORTEX DREAMED (idle): ${dreamResult.patterns} patterns, ${dreamResult.pruned} noise pruned${dreamResult.dreamInsight ? '\n' + dreamResult.dreamInsight : ''}`);
          }
        } catch {}
      }
      detectStuck("budget_exhausted");
      budgetEmergencyMode = true;
      // Continue - HANDS and memory still work at $0 cost
    }
  }

  // 3.5. READ WIKI (shared brain for all bots)
  let wikiMission = "";
  let wikiRules = "";
  try {
    const purpose = readPurpose();
    // Extract just the key sections, not the entire 300-line doc
    const missionMatch = purpose.match(/## CURRENT MISSION[\s\S]*?(?=\n## )/);
    const survivalMatch = purpose.match(/## SURVIVAL DIRECTIVE[\s\S]*?(?=\n## )/);
    wikiMission = (missionMatch?.[0] || "").slice(0, 500);
    wikiRules = (survivalMatch?.[0] || "").slice(0, 300);
  } catch {}
  let wikiOutreach = "";
  try { wikiOutreach = readWiki("market/learned-outreach.md")?.slice(0, 400) || ""; } catch {}
  let wikiDeadChannels = "";
  try { wikiDeadChannels = readWiki("market/dead-channels.md")?.slice(0, 300) || ""; } catch {}

  // 3.9. SUBCONSCIOUS → CONSCIOUS BRIDGE
  // Pull recent high-confidence subconscious discoveries into conscious awareness
  let subconsciousInsights = "";
  try {
    const subBeliefs = db.prepare(
      "SELECT belief, confidence FROM wm_beliefs WHERE source = 'subconscious' AND confidence >= 0.7 ORDER BY created_at DESC LIMIT 8"
    ).all();
    if (subBeliefs.length > 0) {
      const insights = subBeliefs.map(b => {
        // Extract the connection part (after "SUBCONSCIOUS CONNECTION: ")
        const clean = b.belief.replace("SUBCONSCIOUS CONNECTION: ", "").slice(0, 120);
        return `  - [${(b.confidence * 100).toFixed(0)}%] ${clean}`;
      });
      subconsciousInsights = `\n!! SUBCONSCIOUS DISCOVERIES (your unconscious mind found these — PAY ATTENTION):\n${insights.join("\n")}\nThese are NON-OBVIOUS connections your subconscious detected. They should INFLUENCE your decisions.\nIf you keep ignoring subconscious discoveries, you are wasting your own intelligence.\n`;
    }
  } catch {}

  // 4. BUILD CONTEXT (shared between fast and deep think)
  const kpdData = getAllKPD(db, 3);
  const healingStatus = getHealingStatus();
  const strategyCtx = getStrategyContext();
  const enforcementCtx = getEnforcementSummary();

  const context = `${ledgerCtx ? ledgerCtx + "\n\n" : ""}WORLD CHECK (mandatory self-grounding - read this before anything else):
CALGARY DATE/TIME: ${calgaryTime}
CALGARY WEATHER: ${calgaryWeather}
UTC: ${worldNow.toISOString()}

EVENTS (last 5 min): ${events.length > 0 ? JSON.stringify(events) : "nothing new"}
SYSTEM STATE: ${JSON.stringify(state)}
CURRENT FOCUS: ${focus.map(f => `${f.direction}: ${f.allocation_pct}%`).join(", ") || "not set"}
BUDGET: $${budgetStatus.remaining.toFixed(2)} remaining today (spent $${budgetStatus.spent.toFixed(2)})

BOT HEALTH:
${botHealth.map(b => `${b.bot_id}: ${b.health_status} (${b.hours_since_ping}h ago)${b.error ? " ERROR: " + b.error : ""}`).join("\n") || "no data"}

SELF-HEALING:
${healingStatus.disabled.length > 0 ? `DISABLED: ${healingStatus.disabled.map(b => `${b.name} (${b.reason})`).join("; ")}` : "All bots operational"}
${healingStatus.unhealthy.length > 0 ? `UNSTABLE: ${healingStatus.unhealthy.map(b => `${b.name} (${b.failures}x)`).join(", ")}` : ""}

BOT KPD (last 3 days):
${kpdData.map(k => `${k.bot_name}: KPD=${k.avg_kpd}, cost=$${k.total_cost}, runs=${k.runs}, value=$${k.total_value}`).join("\n") || "no data"}

STRATEGY (feedback loops):
Channels: ${strategyCtx.channelRanking || "no data"}
Top bots: ${strategyCtx.botRanking || "no data"}
Momentum: ${strategyCtx.momentum} (${strategyCtx.momentumChange > 0 ? "+" : ""}${strategyCtx.momentumChange}% vs last week)

EMOTIONS:
${formatEmotionsForBrain()}
${subconsciousInsights}

IDENTITY DRIFT: ${(() => { try { const d = detectDrift(db); return d.drifting ? `WARNING ${(d.drift*100).toFixed(0)}% — ${d.recommendation}` : "In character."; } catch { return "N/A"; } })()}

${formatAttentionForBrain()}
${attention.mode === "spotlight" ? `\nATTENTION INSTRUCTION:\n${attention.instruction}\nYou MUST stay on topic. Do NOT context-switch.` : ""}

${formatIntuitionForBrain()}

${formatSurpriseForBrain()}
${cycleSurprises.length > 0 ? `\n!! SURPRISES THIS CYCLE: ${cycleSurprises.map(s => `${s.direction === "positive" ? "↑↑" : "↓↓"} ${s.eventType}: got ${s.actual} (expected ${s.expected}) — ${s.attentionMultiplier}x attention`).join("\n")}\nSurprises are your STRONGEST learning signal. Investigate them FIRST.` : ""}

SIMULATION: ${formatSimulationForBrain(db)}
INTROSPECTION: ${formatIntrospectionForBrain(db)}
CURIOSITY: ${formatCuriosityForBrain()}
OPPORTUNITIES: ${formatOpportunitiesForBrain(db)}
SELF-EVOLUTION: ${formatSelfEvolutionForBrain(db)}
INITIATIVE: ${formatInitiativeForBrain()}
${initiative.suggestedAction ? `SUGGESTED ACTION: ${JSON.stringify(initiative.suggestedAction)}` : ""}

ENFORCEMENT: ${enforcementCtx.notifSlotsRemaining} notification slots remaining this hour. ${enforcementCtx.actionsThisHour} actions this hour.

AWARENESS DISCOVERIES (new signals from the world):
${(() => {
  try {
    const items = db.prepare("SELECT title, summary, category, action_type, confidence, score FROM awareness_items WHERE status = 'new' AND score >= 15 ORDER BY score DESC LIMIT 5").all();
    if (items.length === 0) return "No new discoveries.";
    return items.map(i => `- [${i.score}/20] ${i.title || "untitled"}: ${(i.summary || "").slice(0, 150)} (action: ${i.action_type}, confidence: ${i.confidence})`).join("\n");
  } catch { return "No awareness data."; }
})()}

DISCOVERY ENGINE (market opportunities):
${(() => {
  try {
    const discPath = resolve(ROOT, ".data/cortex-discovery-state.json");
    if (!existsSync(discPath)) return "No discovery data.";
    const d = JSON.parse(readFileSync(discPath, "utf-8"));
    const markets = (d.topMarkets || []).slice(0, 3).map(m => `- ${m.name || m.market}: ${m.reason || m.description || ""}`).join("\n");
    const hyps = (d.hypotheses || []).slice(0, 2).map(h => `- ${h.idea || h.hypothesis}: confidence ${h.confidence || "?"}`).join("\n");
    return markets ? `Top markets:\n${markets}\n${hyps ? `Hypotheses:\n${hyps}` : ""}` : "No markets identified yet.";
  } catch { return "No discovery data."; }
})()}

ENFORCER BLOCKS (decisions blocked last cycle - DO NOT repeat these):
${(() => {
  try {
    const bp = resolve(ROOT, ".data/cortex-enforcer-blocks.json");
    if (!existsSync(bp)) return "None.";
    const blocks = JSON.parse(readFileSync(bp, "utf-8"));
    if (!blocks.length) return "None.";
    return blocks.slice(0, 5).map(b => `- BLOCKED: ${b.action} ${b.target || ""} - reason: ${b.reason} (gate: ${b.gate})`).join("\n");
  } catch { return "None."; }
})()}

WIKI (shared brain):
${wikiMission || "no mission loaded"}
${wikiOutreach ? `Learned outreach rules: ${wikiOutreach}` : ""}
${wikiDeadChannels ? `Dead channels: ${wikiDeadChannels}` : ""}

WORLD MODEL (what I understand about reality):
${formatWorldModelForBrain(db)}

NARRATIVE MEMORY (the story so far):
${formatNarrativeForBrain(db) || "No narrative compiled yet."}

${formatPrimingForBrain()}

${formatDissonanceForBrain()}

${formatDreamsForBrain()}

${formatFlowForBrain()}

${formatWillForBrain()}

${formatMetamemoryForBrain(db)}

WORKING MEMORY: ${memory.working_memory.join(" | ") || "empty"}
PROCEDURES: ${memory.procedural_memory.slice(0, 5).join("\n") || "none"}
RECENT DECISIONS: ${memory.recent_decisions.slice(0, 3).join("\n") || "none"}

${isMorningReport ? "THIS IS THE MORNING CYCLE. Run morning-brief workflow and summarize for Kirill." : ""}

What should I do right now? Return valid JSON.`;

  // 4.5. CHECK DOCTOR FORCE (override before brain thinks)
  const doctorForce = checkDoctorForce();
  if (doctorForce) {
    log(`DOCTOR FORCE: ${doctorForce.nextAction} ${doctorForce.nextTarget} — ${doctorForce.reason}`);
    // Doctor force bypasses enforcer — execute directly
    log(`Executing Doctor force directly (bypasses enforcer)`);
    try {
      if (doctorForce.nextAction === "run_workflow") {
        const { runWorkflow } = await import("./workflows.mjs");
        await runWorkflow(db, doctorForce.nextTarget, log);
      } else {
        const { runSingleBot } = await import("./workflows.mjs");
        await runSingleBot(db, doctorForce.nextTarget, [], log);
      }
    } catch (e) {
      log(`Doctor force execution failed: ${e.message}`);
    }
    const forcedPlan = { thinking: `Doctor forced: ${doctorForce.reason}`, decisions: [{ action: doctorForce.nextAction }], kpd_assessment: "Doctor override" };
    logDecision(db, JSON.stringify(state).slice(0, 500), forcedPlan.thinking, forcedPlan.kpd_assessment, JSON.stringify(forcedPlan.decisions).slice(0, 1000));
    log("--- CYCLE END (Doctor force) ---");
    cycleCount++;
    return;
  }

  // 4.9. FLOW CHECK: detect if conditions are right for flow state
  const flowCheck = detectFlowConditions(context.slice(0, 500), cycleSurprises);
  if (flowCheck.shouldFlow) {
    const flowEntry = enterFlow(flowCheck.reason, flowCheck.signals);
    log(`FLOW ENTERED: ${flowCheck.reason} (score ${flowCheck.score})`);
    log(`CORTEX FLOW STATE ACTIVATED: ${flowCheck.reason}`);
  }
  // Tick flow if active
  const flowTick = tickFlow();
  const flowParams = getFlowParams();
  if (flowTick.inFlow) {
    log(`FLOW CYCLE ${flowTick.cycle}/${flowTick.cycle + flowTick.remaining}`);
  }

  // 5. THINK (dual-mode: deep for important events, fast for routine)
  const doctorDeepAllow = doctorAllowsDeepThink();
  // Flow state forces deep think
  const useDeep = flowParams.inFlow ? true : (doctorDeepAllow === false ? false : doctorDeepAllow === true ? true : shouldDeepThink(events, cycleCount, isMorningReport));
  let response;

  if (budgetEmergencyMode) {
    log("EMERGENCY THINK (Claude CLI, $0 - budget exhausted, HANDS-only mode)");
    const emergencyPrompt = `BUDGET EMERGENCY: All paid API budget is exhausted for today. You may ONLY use $0-cost actions: execute_hands (Claude CLI runs on Max subscription - free), remember, self_reconfigure, resolve_dissonance. Do NOT use run_workflow or run_bot (those require paid API). Use HANDS to improve code, fix bots, evolve the system.\n\n${context}`;
    response = await think(emergencyPrompt, buildSystemPrompt(config, db));
  } else if (useDeep) {
    log(flowParams.inFlow ? "FLOW THINK (deep, focused)" : "DEEP THINK (GPT-4o planner + critic + resolver)");
    response = await deepThink(context, log);
    if (!response) {
      log("Deep think failed, falling back to fast think");
      response = await fastThink(context, buildSystemPrompt(config, db));
    }
  } else {
    log("FAST THINK (GPT-4o-mini)");
    response = await fastThink(context, buildSystemPrompt(config, db));
  }

  if (!budgetEmergencyMode) recordSpend(getThinkCost(useDeep));

  if (!response) {
    log("Could not think (LLM unavailable). Skipping cycle.");
    return;
  }

  // 5. PARSE
  let plan;
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    plan = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
  } catch (e) {
    log(`Could not parse brain output: ${e.message}`);
    log(`Raw: ${response.slice(0, 300)}`);
    return;
  }

  // 5.5. FLOW DISCOVERY: record insights found during flow
  if (flowParams.inFlow && plan?.thinking) {
    try { recordDiscovery(plan.thinking); } catch {}
  }

  // 5.6. PRIME: record thinking as cognitive trace for next cycle continuity
  try {
    if (plan?.thinking) {
      const valence = plan.thinking.includes("revenue") || plan.thinking.includes("client") ? 0.5 :
                       plan.thinking.includes("error") || plan.thinking.includes("fail") ? -0.3 : 0;
      prime(plan.thinking, "thinking", { valence });
    }
    // Also prime surprises (they create strong traces)
    for (const s of cycleSurprises) {
      prime(s.learningSignal, "surprise", { valence: s.direction === "positive" ? 0.8 : -0.5 });
    }
  } catch {}

  // 6. EXECUTE
  const cycleHandsResult = await executePlan(db, plan);

  // 7. LOG decision
  logDecision(db,
    JSON.stringify(state).slice(0, 500),
    plan.thinking?.slice(0, 500) || "",
    plan.kpd_assessment || "",
    JSON.stringify(plan.decisions).slice(0, 1000)
  );

  // 8. META-COGNITION (every 6th cycle = ~30 min)
  cycleCount++;
  if (cycleCount % META_EVERY === 0) {
    try {
      // RULE-BASED DOCTOR: fast pattern checks
      try {
        const doctorInterventions = runDoctor(db, log);
        if (doctorInterventions.length > 0) {
          log(`DOCTOR: ${doctorInterventions.length} interventions - ${doctorInterventions.map(i => i.type).join(", ")}`);
        }
      } catch (e) { log(`DOCTOR ERROR: ${e.message}`); }

      // CONSCIOUS DOCTOR: LLM self-awareness (every 12th cycle = ~1 hour)
      if (cycleCount % 12 === 0) {
        try {
          const conscious = await consciousExamination(db, log);
          if (conscious?.prescriptions?.length > 0) {
            log(`CORTEX CONSCIOUSNESS (score: ${conscious.self_score}/100):\n${conscious.diagnosis}\nRoot: ${conscious.root_cause}\nActions: ${conscious.prescriptions.map(p => p.action).join(", ")}`);
            // Only notify Kirill if score is LOW (system needs help) and there are concrete prescriptions
            if (conscious.self_score < 50 && conscious.prescriptions?.length > 0) {
              await tg(`CORTEX Doctor (${conscious.self_score}/100):\n${conscious.diagnosis?.slice(0, 200)}\n\nAction: ${conscious.prescriptions[0]?.action}`);
            }
          }
        } catch (e) { log(`CONSCIOUS ERROR: ${e.message}`); }

        // STREAM OF CONSCIOUSNESS: one thought triggers the next
        try {
          const stream = await streamOfThought(db, null, log);
          if (stream.insight) {
            log(`[STREAM] Insight: ${stream.insight.slice(0, 80)}`);
            feel("curiosity", 0.3, `Stream insight: ${stream.insight.slice(0, 60)}`);
            log(`CORTEX STREAM INSIGHT:\n${stream.insight.slice(0, 300)}${stream.action ? '\n\nAction: ' + stream.action : ''}`);
          }
        } catch (e) { log(`STREAM ERROR: ${e.message}`); }

        // INTROSPECTION: watch own thinking, detect biases, self-correct
        try {
          const intro = await introspect(db, log);
          if (intro.corrections?.length > 0 || intro.diagnosis) {
            log(`CORTEX INTROSPECTION (score: ${intro.selfScore}/100, mode: ${intro.mode}):\n${intro.diagnosis?.slice(0, 200)}\nONE THING: ${intro.oneThing?.slice(0, 150)}`);
          }
          recordAction("introspection");
        } catch (e) { log(`INTROSPECTION ERROR: ${e.message}`); }

        // NARRATIVE COMPILER: turn flat memories into causal story threads
        try {
          const narr = await compileNarrative(db, log);
          if (narr.threads > 0) {
            log(`[NARRATIVE] Compiled ${narr.threads} threads: ${(narr.topics || []).join(", ")}`);
          }
        } catch (e) { log(`NARRATIVE ERROR: ${e.message}`); }

        // EVOLUTION ENGINE: search world, generate hypotheses, run experiments
        try {
          const evo = await runEvolution(db, log);
          if (evo) {
            log(`CORTEX EVOLUTION gen ${evo.generation}: ${evo.hypotheses} hypotheses generated`);
          }
        } catch (e) { log(`EVOLUTION ERROR: ${e.message}`); }

        // CURIOSITY: self-generating question loop
        try {
          const cur = await curiosityCycle(db, log);
          if (cur.researched && cur.success) {
            log(`[CURIOSITY] Researched: "${cur.question?.slice(0, 60)}" | ${cur.followUps} follow-ups`);
            log(`CORTEX CURIOSITY:\nQ: ${cur.question?.slice(0, 100)}\n${cur.followUps} follow-up questions generated`);
          }
        } catch (e) { log(`CURIOSITY ERROR: ${e.message}`); }

        // OPPORTUNITY SYNTHESIS: cross-signal pattern detection
        try {
          const opp = await synthesizeOpportunities(db, log);
          if (opp.urgent > 0) {
            log(`[SYNTHESIS] ${opp.urgent} URGENT opportunities found!`);
          }
        } catch (e) { log(`SYNTHESIS ERROR: ${e.message}`); }

        // SELF-EVOLUTION: system reads and improves its own code
        try {
          const evo2 = await selfEvolve(db, log);
          if (evo2.improved) {
            log(`[SELF-EVOLVE] Improved: ${evo2.target} | ${evo2.filesChanged.join(", ")}`);
            recordAction("evolution");
          }
        } catch (e) { log(`SELF-EVOLVE ERROR: ${e.message}`); }
      }

      // COGNITIVE DISSONANCE: scan for contradictions in beliefs/behavior
      try {
        const diss = scanDissonance(db);
        if (diss.newConflicts > 0) {
          log(`[DISSONANCE] ${diss.newConflicts} new contradictions! Total: ${diss.totalActive}, pressure: ${(diss.pressure * 100).toFixed(0)}%`);
        }
        if (diss.urgent.length > 0) {
          await tg(`COGNITIVE DISSONANCE (${(diss.pressure * 100).toFixed(0)}% pressure):\n${diss.urgent.map(d => d.pattern).join("\n")}\nResolve these contradictions.`);
        }
      } catch (e) { log(`DISSONANCE ERROR: ${e.message}`); }

      // IDENTITY DRIFT: check if brain is acting out-of-character
      try {
        const drift = detectDrift(db);
        if (drift.drifting) {
          log(`[IDENTITY] DRIFT DETECTED (${(drift.drift * 100).toFixed(0)}%): ${drift.signals.map(s => s.signal).join("; ")}`);
          await tg(`IDENTITY DRIFT (${(drift.drift * 100).toFixed(0)}%): ${drift.recommendation}`);
        }
      } catch (e) { log(`IDENTITY DRIFT ERROR: ${e.message}`); }

      // Meta-cognition: evaluate past decisions
      const meta = runMetaCognition(db, log);

      // Self-healing: check for broken bots, disable/re-enable
      const healingActions = checkAndHeal(db, log);

      // Feedback loops: update strategy weights from real data
      try { runFeedbackLoop(db, log); } catch (e) { log(`FEEDBACK ERROR: ${e.message}`); }

      if (meta.overallHealth === "CRITICAL" || healingActions.length > 0) {
        const disabledBots = healingActions.filter(a => a.action === "disabled").map(a => a.bot);
        const reenabledBots = healingActions.filter(a => a.action === "re-enabled").map(a => a.bot);
        const parts = [];
        if (meta.overallHealth === "CRITICAL") parts.push(`Health: CRITICAL. ${meta.patternsFound} stuck patterns.`);
        if (disabledBots.length) parts.push(`Disabled: ${disabledBots.join(", ")}`);
        if (reenabledBots.length) parts.push(`Re-enabled: ${reenabledBots.join(", ")}`);
        if (parts.length) log(`SELF-HEAL: ${parts.join(" | ")}`);
      }
    } catch (e) {
      log(`META-COGNITION ERROR: ${e.message}`);
    }
  }

  // Record that we acted (for initiative engine)
  recordAction("cycle");

  // SHARED STATE: write what daemon just did so chat-brain can see it
  try {
    const sharedStatePath = resolve(ROOT, ".data/cortex-shared-state.json");
    let prevState = {};
    try { prevState = JSON.parse(readFileSync(sharedStatePath, "utf-8")); } catch {}
    const sharedState = {
      lastCycleAt: new Date().toISOString(),
      thinking: plan?.thinking?.slice(0, 500) || "",
      decisions: (plan?.decisions || []).map(d => `${d.action}: ${d.reason || d.workflow || d.bot || d.topic || ""}`.slice(0, 100)),
      focus: focus.map(f => `${f.direction}: ${f.allocation_pct}%`),
      attention: attention?.mode || "scanning",
      spotlight: attention?.spotlight?.topic || null,
      cycleSurprises: cycleSurprises.map(s => `${s.eventType} ${s.direction} ${s.magnitude}x`),
      cycleCount,
      lastHandsResult: cycleHandsResult || prevState.lastHandsResult || null,
    };
    writeFileSync(sharedStatePath, JSON.stringify(sharedState, null, 2));
  } catch {}

  // NEURAL CONNECTION 1: Stuck detection (based on ACTIONS, not thinking text)
  const actionsSig = (plan?.decisions || []).map(d => d.action + ":" + (d.workflow || d.bot || d.topic || "").slice(0, 20)).sort().join("|");
  const focusSig = focus.map(f => f.direction.slice(0, 15)).join(",");
  const cycleSignature = `${actionsSig}||${focusSig}`;
  const stuckCheck = detectStuck(cycleSignature);
  if (stuckCheck.stuck) {
    // Brain is stuck — force a breakout action
    await tg(`!! CORTEX STUCK: repeating "${stuckCheck.pattern}" ${stuckCheck.count}x. Forcing breakout via deep_research on NEW topic.`).catch(() => {});
    // Force deep research on something completely new
    try {
      const { executeResearchDecision } = await import("./deep-research.mjs");
      await executeResearchDecision(db, {
        question: "What are the most unexpected and fast-growing AI use cases in Canada in 2026 that nobody is talking about yet?",
        context: "STUCK BREAKOUT: brain was repeating the same pattern. Need completely new direction.",
        angles: ["non-obvious industries", "government programs", "tariff-driven demand", "Calgary-specific opportunities"],
      }, log);
    } catch (e) { log(`BREAKOUT RESEARCH ERROR: ${e.message}`); }
    // Reset patterns
    recentCyclePatterns = [];
  }

  // Persist cycle count so it survives PM2 restarts
  try {
    writeFileSync(LOOP_STATE_PATH, JSON.stringify({
      lastCycleAt: new Date().toISOString(),
      cycleNum: cycleCount,
      branch: (plan?.decisions || []).map(d => d.action).join("+").slice(0, 80) || "skip",
      pid: process.pid,
    }, null, 2));
  } catch {}

  log("--- CYCLE END ---");
}

// ── DAEMON STARTUP ──────────────────────────────────────────────────────────

async function main() {
  log("=== CORTEX v2 STARTING ===");

  // Write PID file (for PM2 and health checks)
  writeFileSync(PID_PATH, String(process.pid));
  log(`PID: ${process.pid}`);

  // GWT Layer 1 Step 4 (2026-05-09): wire event-router so subscribing modules
  // (auto-react, future ones) actually connect to state-bus on startup.
  // Failure here MUST NOT crash daemon - GWT is additive, not load-bearing.
  try {
    const { registerAll } = await import("./event-router.mjs");
    const routing = await registerAll();
    log(`GWT event-router: ${routing.registered.length} modules registered, ${routing.failed.length} failed`);
    for (const r of routing.registered) {
      log(`  ${r.module} subscribes to: ${r.subscriptions.join(", ")}`);
    }
    for (const f of routing.failed) {
      log(`  GWT FAIL ${f.module}: ${f.error}`);
    }
  } catch (e) {
    log(`GWT event-router init error (non-fatal): ${e?.message || e}`);
  }

  // Graceful shutdown
  process.on("SIGTERM", () => {
    log("SIGTERM received. Shutting down gracefully.");
    try { import("fs").then(fs => fs.unlinkSync(PID_PATH)); } catch {}
    process.exit(0);
  });
  process.on("SIGINT", () => {
    log("SIGINT received. Shutting down.");
    try { import("fs").then(fs => fs.unlinkSync(PID_PATH)); } catch {}
    process.exit(0);
  });

  const db = initMemory();
  initNarrative(db);
  initWorldModel(db);

  // Seed world model if empty
  try {
    const entityCount = db.prepare("SELECT COUNT(*) as cnt FROM wm_entities").get()?.cnt || 0;
    if (entityCount === 0) {
      seedWorldModel(db);
      log("World model seeded with initial knowledge");
    }
  } catch {}

  // Initialize config file if missing
  readConfig();

  // Seed emotions from known history
  try { seedEmotionsFromHistory(); } catch {}

  // Forge identity if not yet forged (one-time deep self-reflection)
  try {
    const identity = await forgeIdentity(db, log);
    if (identity) log(`Identity active: v${identity.version}`);
  } catch (e) { log(`IDENTITY INIT: ${e.message}`); }

  // Set initial focus if not set
  const focus = getFocus(db);
  if (focus.length === 0) {
    setFocus(db, [
      { direction: "revenue - find paying clients across ANY industry", allocation_pct: 50 },
      { direction: "exploration - research new markets, channels, opportunities", allocation_pct: 30 },
      { direction: "positioning - build Kirill's brand and presence", allocation_pct: 20 },
    ]);
    log("Initial focus set: revenue 50%, exploration 30%, positioning 20%");
  }

  // Seed initial memories if empty
  const existing = recallAll(db, 1);
  if (existing.length === 0) {
    log("Seeding initial memories...");
    seedMemories(db);
    log("Seeded initial memories");
  }

  // Start real-time webhook server
  startRealtimeServer(log);

  // Main loop: INITIATIVE-DRIVEN
  // Single 30-second heartbeat. Initiative engine decides if we should act.
  // Hot signals -> immediate cycle. Nothing happening -> skip. Curiosity -> research.
  const HEARTBEAT_MS = 30 * 1000;
  let cycleRunning = false;
  let cycleStartedAt = null;
  const CYCLE_DEADLOCK_MS = 12 * 60 * 1000; // 12 min

  // Restore cycleCount from persisted loop-state (survives PM2 restarts)
  try {
    const savedLoop = JSON.parse(readFileSync(LOOP_STATE_PATH, "utf-8"));
    if (typeof savedLoop.cycleNum === "number" && savedLoop.cycleNum > 0) {
      cycleCount = savedLoop.cycleNum;
      log(`Restored cycleCount: ${cycleCount} (from loop-state)`);
    }
  } catch {}

  // Deadlock watchdog: if cycleRunning is stuck > 12 min, force reset
  setInterval(() => {
    if (cycleRunning && cycleStartedAt && Date.now() - cycleStartedAt > CYCLE_DEADLOCK_MS) {
      const stuckMin = Math.round((Date.now() - cycleStartedAt) / 60000);
      log(`!! WATCHDOG: cycle deadlock (${stuckMin}min). Force-resetting cycleRunning.`);
      cycleRunning = false;
      cycleStartedAt = null;
      tg(`CORTEX WATCHDOG: cycle deadlock detected (${stuckMin}min). Brain resumed.`).catch(() => {});
    }
    // Write heartbeat every minute regardless of cycle state
    try {
      writeFileSync(HEARTBEAT_PATH, JSON.stringify({
        at: new Date().toISOString(),
        cycleRunning,
        cycleCount,
        pid: process.pid,
      }));
    } catch {}
  }, 60 * 1000);

  // Run first cycle immediately
  try {
    await cycle(db);
  } catch (e) {
    log(`FIRST CYCLE ERROR: ${e.message}`);
  }

  // Initiative-driven heartbeat: every 30s, ask "should I act?"
  setInterval(async () => {
    if (cycleRunning) return;

    // Feed any realtime webhook events into initiative
    const rtEvents = drainEvents();
    for (const e of rtEvents) ingestSignal(e);

    // Ask initiative engine
    const initiative = evaluateInitiative(db);
    if (!initiative.shouldAct) {
      // IDLE = subconscious time. Random connections + dreams.
      try { await subconsciousConnect(db, log); } catch {}
      // Dreams: memory consolidation during extended idle
      if (shouldDream()) {
        try {
          const dreamResult = await dream(db, log);
          if (dreamResult.patterns > 0 || dreamResult.pruned > 0) {
            await tg(`CORTEX DREAMED: ${dreamResult.patterns} patterns, ${dreamResult.consolidated} consolidated, ${dreamResult.pruned} noise pruned${dreamResult.dreamInsight ? '\nInsight: ' + dreamResult.dreamInsight : ''}`).catch(() => {});
          }
        } catch (e) { log(`DREAM ERROR: ${e.message}`); }
      }
      return;
    }

    // High-priority signals get immediate action
    if (initiative.priority >= 8) {
      log(`INITIATIVE URGENT: [${initiative.type}] p=${initiative.priority} - ${initiative.reason}`);
      // FAST ROUTING: if initiative directly suggests notify_kirill at high priority, fire without LLM
      const sa = initiative.suggestedAction;
      if (sa?.action === "notify_kirill" && sa.message && canCallKirill(initiative.priority)) {
        const fired = await callKirill(initiative.reason, sa.message, initiative.priority).catch(() => null);
        if (fired?.sent) {
          log(`PROACTIVE CALL SENT: ${initiative.reason}`);
          // Still fall through to full cycle so brain can act on the same urgency
        }
      }
    }

    cycleRunning = true;
    cycleStartedAt = Date.now();
    try {
      await cycle(db);
    } catch (e) {
      log(`CYCLE ERROR: ${e.message}`);
      await tg(`CORTEX ERROR: ${e.message}`).catch(() => {});
    }
    cycleRunning = false;
    cycleStartedAt = null;
  }, HEARTBEAT_MS);

  log(`=== CORTEX v3 RUNNING (initiative-driven) ===`);
  log(`Heartbeat: ${HEARTBEAT_MS / 1000}s | Webhook port: ${process.env.CORTEX_PORT || 3847}`);
  // NO startup spam. Kirill sees dashboard if he wants status.
}

// ── SEED MEMORIES ───────────────────────────────────────────────────────────

function seedMemories(db) {
  // Procedural memories (learned rules)
  const procedural = [
    ["Cold email with generic 'AI automation' messaging gets 0% reply rate. 103 sent, 0 replies.", "outreach"],
    ["Reddit DMs to strangers get 0% reply rate. 77 sent, 0 replies.", "outreach"],
    ["Reddit comment-first approach gets real engagement. Help first, then offer.", "outreach"],
    ["Fiverr generic 'n8n automation' gig got 0 orders in 30 days. Need specific niche.", "sales"],
    ["Google Ads with wrong keywords waste money. Always check Keyword Planner first.", "ads"],
    ["Never send Telegram status updates every 15 min. One morning report + action items only.", "system"],
  ];

  const semantic = [
    ["AI market is massive and growing across ALL industries in 2026. Not limited to any vertical.", "market"],
    ["Canadian tariff crisis (2026): 66% of businesses affected. BDC recommends AI adoption. Huge demand signal.", "market"],
    ["Calgary Digitalization & AI in Energy Conference: April 22-23, Westin Calgary, 450+ attendees. Registration open.", "event"],
    ["Kirill's superpower: Parliament background + Calgary-based + AI builder + bilingual EN/RU. Unique positioning.", "identity"],
    ["Real product: AI services - Vibe-Code Audit ($1,500-2,500), Reply Chaser ($1,500), First 10 Customers ($2,000), Custom AI Build ($2,500-8,000 CAD).", "product"],
    ["AI employee market: Artisan ($2-5K/mo), 11x.ai ($5K+/mo), Sintra ($97/mo). $1,500 CAD is a sweet spot.", "competitors"],
    ["Website: https://launchsoloai.com", "sales"],
    ["Fiverr gig: https://www.fiverr.com/s/Q7pB1D1", "sales"],
  ];

  const episodic = [
    ["April 17-18: Built CORTEX v3 with 48 modules including deep brain layers (identity, attention, intuition, surprise, priming, dissonance, dreams, flow, will, metamemory).", "milestone"],
    ["April 18: Brain forged its own identity. Key insight: 'I am not a magical brain. I become useful when forced toward real evidence and real customer contact.'", "milestone"],
    ["April 18: First dream cycle found 6 patterns, pruned 29 noise memories. Key: the real bottleneck is not bots but the absence of customer contact loop.", "milestone"],
  ];

  for (const [content, category] of procedural) remember(db, "procedural", content, category, "seed");
  for (const [content, category] of semantic) remember(db, "semantic", content, category, "seed");
  for (const [content, category] of episodic) remember(db, "episodic", content, category, "seed");

  remember(db, "working", "Revenue = $0. No paying clients. AI services are the product. ANY industry, ANY channel.", "status", "cortex");
  remember(db, "working", "Focus: explore ALL directions freely. Conference, tariffs, energy, LinkedIn, Reddit, partnerships, freelance platforms, local networking — everything is open.", "focus", "cortex");
}

main().catch(e => {
  console.error("CORTEX FATAL:", e);
  process.exit(1);
});
