/**
 * EVOLUTION ENGINE — Self-directed improvement
 *
 * The system doesn't wait for someone to tell it what to improve.
 * It ACTIVELY SEARCHES for ways to become better.
 *
 * Every 3 hours, the Evolution Engine:
 * 1. SCANS the internet for new tools, techniques, competitors
 * 2. EVALUATES its own prompts, queries, strategies against what it finds
 * 3. GENERATES hypotheses: "what if I tried X?"
 * 4. DESIGNS experiments to test those hypotheses
 * 5. RUNS experiments and measures results
 * 6. ADOPTS what works, discards what doesn't
 * 7. REWRITES its own prompts and strategies based on learnings
 *
 * This is not optimization. This is EVOLUTION.
 * The system today is different from the system yesterday.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { remember, recall } from "./memory.mjs";
import { readConfig, writeConfig } from "./config-injection.mjs";
import { optimizeRoutes, getRoutingTable } from "./model-router.mjs";
import { planImplementation, formatBodyMapForLLM } from "./body-map.mjs";
import { executeBodyMapStep } from "./hands.mjs";
import { deepResearch } from "./deep-research.mjs";
import { appendLog, updatePage } from "../../wiki/reader.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const ENV_PATH = resolve(ROOT, "apps/api/.env");
const EVOLUTION_PATH = resolve(ROOT, ".data/cortex-evolution.json");

const env = Object.fromEntries(
  readFileSync(ENV_PATH, "utf-8").split("\n")
    .filter(l => l && !l.startsWith("#") && l.includes("="))
    .map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

const BRAVE_KEY = env.BRAVE_SEARCH_API_KEY;

// ── EVOLUTION STATE ────────────────────────────────────────────────────

function loadEvolution() {
  if (!existsSync(EVOLUTION_PATH)) return {
    generation: 0,
    experiments: [],
    discoveries: [],
    adoptedChanges: [],
    lastEvolveAt: null,
    currentHypotheses: [],
  };
  try { return JSON.parse(readFileSync(EVOLUTION_PATH, "utf-8")); } catch { return loadEvolution(); }
}

function saveEvolution(state) {
  if (state.experiments.length > 30) state.experiments = state.experiments.slice(-30);
  if (state.discoveries.length > 50) state.discoveries = state.discoveries.slice(-50);
  if (state.adoptedChanges.length > 30) state.adoptedChanges = state.adoptedChanges.slice(-30);
  writeFileSync(EVOLUTION_PATH, JSON.stringify(state, null, 2));
}

// ── MAIN EVOLUTION CYCLE ───────────────────────────────────────────────

export async function runEvolution(db, log = console.log) {
  log("[EVOLVE] === EVOLUTION CYCLE ===");
  const state = loadEvolution();
  state.generation++;

  // PHASE 1: SCAN — what's happening in the world?
  const worldSignals = await scanWorld(log);

  // PHASE 2: REFLECT — how do we compare?
  const selfState = gatherSelfState(db);

  // PHASE 2.5: DEEP RESEARCH — understand before hypothesizing
  let deepInsight = "";
  if (worldSignals.length > 0) {
    // Pick the most interesting signal and research it deeply
    const topSignal = worldSignals[0];
    try {
      log(`[EVOLVE] Deep researching: ${topSignal.title?.slice(0, 60)}`);
      const research = await deepResearch({
        question: `Based on this signal: "${topSignal.title}" - what opportunities does this create? Think broadly - not just one product. Consider: new services, new markets, new pricing models, timing advantages, geographic advantages.`,
        context: `We are an autonomous AI system in Calgary, Canada. Revenue: $0. We can build and deploy AI solutions. Looking for the fastest path to revenue. Think beyond the obvious.`,
        origin: "evolution-engine",
      }, { log, timeoutMs: 3 * 60 * 1000 });

      if (research.success) {
        deepInsight = `\nDEEP RESEARCH INSIGHT:\n${research.insight?.slice(0, 500)}\nOpinion: ${research.opinion || "none"}\nGaps: ${(research.gaps || []).join("; ")}`;
        log(`[EVOLVE] Deep research complete: ${research.opinion?.slice(0, 80)}`);
      }
    } catch (e) {
      log(`[EVOLVE] Deep research skipped: ${e.message}`);
    }
  }

  // PHASE 3: GENERATE HYPOTHESES — what could we do better?
  const hypotheses = await generateHypotheses(worldSignals, selfState, state, log, deepInsight);

  // PHASE 4: DESIGN & RUN EXPERIMENT
  if (hypotheses.length > 0) {
    const bestHypothesis = hypotheses[0];
    log(`[EVOLVE] Testing hypothesis: ${bestHypothesis.idea}`);

    // Apply the experiment
    await applyExperiment(db, bestHypothesis, state, log);

    state.currentHypotheses = hypotheses;
  }

  // PHASE 5: OPTIMIZE MODEL ROUTING (auto cost optimization)
  const routeChanges = optimizeRoutes();
  if (routeChanges.length > 0) {
    log(`[EVOLVE] Model routing optimized: ${routeChanges.map(c => `${c.task}: ${c.from} -> ${c.to}`).join(", ")}`);
  }

  // PHASE 5.5: FREE THINK — every 3rd generation, think without constraints
  if (state.generation % 3 === 0) {
    try {
      log("[EVOLVE] FREE THINK cycle (every 3rd generation)...");
      const { spawnSync } = await import("child_process");
      const { writeFileSync: wf } = await import("fs");

      const freePrompt = `You are CORTEX. Think freely for 2 minutes. You have WebSearch and WebFetch.

Search for ONE thing that surprises you about the world RIGHT NOW (April 2026).
Not about the same niches. Not about the same channels. Something COMPLETELY DIFFERENT.

Search for emerging trends, unusual opportunities, or things happening in Calgary, Canada, or the AI industry that nobody is talking about yet.

Find something real. Read a real page. Form an opinion.

End with:
DISCOVERY: [one sentence - the surprising thing you found]
OPPORTUNITY: [how this could be turned into revenue]
URGENCY: [is this time-sensitive? how many days until the window closes?]`;

      const fp = resolve(ROOT, ".data/evo-free-think.md");
      wf(fp, freePrompt);

      const cleanEnv = {};
      for (const [k, v] of Object.entries(process.env)) {
        if (k === "CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING") continue;
        cleanEnv[k] = v;
      }
      cleanEnv.PATH = `$HOME/.nvm/versions/node/v22.22.2/bin:${process.env.PATH || "/usr/bin:/bin"}`;

      const ft = spawnSync("bash", ["-c",
        `cat "${fp}" | "$HOME/.nvm/versions/node/v22.22.2/bin/claude" -p --model claude-sonnet-4-6 --max-turns 5 --allowedTools "WebSearch,WebFetch" --output-format text 2>&1`
      ], { cwd: ROOT, env: cleanEnv, encoding: "utf-8", timeout: 3 * 60 * 1000, maxBuffer: 10 * 1024 * 1024 });

      const ftOutput = (ft.stdout || "") + (ft.stderr || "");

      // Extract discovery
      const discMatch = ftOutput.match(/DISCOVERY:\s*(.*)/);
      const oppMatch = ftOutput.match(/OPPORTUNITY:\s*(.*)/);
      const urgMatch = ftOutput.match(/URGENCY:\s*(.*)/);

      if (discMatch) {
        log(`[EVOLVE] FREE DISCOVERY: ${discMatch[1].slice(0, 100)}`);
        remember(db, "semantic", `FREE DISCOVERY (gen ${state.generation}): ${discMatch[1]}`, "free-thinking", "evolution", 0.6);

        // INSIGHT-TO-ACTION: if urgent, notify Kirill immediately
        if (urgMatch && !urgMatch[1].toLowerCase().includes("not time-sensitive") && !urgMatch[1].toLowerCase().includes("no")) {
          const ENV2 = resolve(ROOT, "apps/api/.env");
          const e2 = Object.fromEntries(readFileSync(ENV2, "utf-8").split("\n").filter(l => l && !l.startsWith("#") && l.includes("=")).map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
          const msg = `CORTEX FREE DISCOVERY:\n${discMatch[1]}\n\nOpportunity: ${oppMatch?.[1] || "?"}\nUrgency: ${urgMatch[1]}`;
          try {
            await fetch(`https://api.telegram.org/bot${e2.TELEGRAM_BOT_TOKEN}/sendMessage`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chat_id: e2.TELEGRAM_CHAT_ID, text: msg.slice(0, 4096) }),
            });
          } catch {}
        }

        // Integrate into world model
        try {
          const { integrateKnowledge: ik } = await import("./world-model.mjs");
          await ik(db, ftOutput.slice(-1500), "free-think-evolution", log);
        } catch {}
      }
    } catch (e) {
      log(`[EVOLVE] FREE THINK error: ${e.message}`);
    }
  }

  // Write discoveries to wiki (shared brain)
  try {
    if (hypotheses.length > 0) {
      appendLog("evolution", `Gen ${state.generation}: ${hypotheses.map(h => h.idea.slice(0, 60)).join(" | ")}`);
    }
    if (worldSignals.length > 0) {
      appendLog("world-scan", `${worldSignals.length} signals: ${worldSignals.slice(0, 3).map(s => s.title?.slice(0, 40)).join(", ")}`);
    }
  } catch {}

  state.lastEvolveAt = new Date().toISOString();
  saveEvolution(state);

  log(`[EVOLVE] Generation ${state.generation} complete. ${hypotheses.length} hypotheses generated.`);
  return { generation: state.generation, hypotheses: hypotheses.length };
}

// ── PHASE 1: SCAN THE WORLD ────────────────────────────────────────────

async function scanWorld(log) {
  const signals = [];

  // Search for what competitors are doing
  const searches = [
    "AI automation services for small business 2026",
    "virtual receptionist startup new features",
    "best way to sell AI to small businesses",
    "cold outreach AI services what works 2026",
    "Reddit small business owner pain points phone",
  ];

  if (!BRAVE_KEY) {
    log("[EVOLVE] No Brave API key, skipping world scan");
    return signals;
  }

  for (const query of searches.slice(0, 3)) { // limit to 3 to save API
    try {
      const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=3&freshness=pm`, {
        headers: { "Accept": "application/json", "X-Subscription-Token": BRAVE_KEY },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      for (const r of (data.web?.results || []).slice(0, 2)) {
        signals.push({
          query,
          title: r.title,
          description: r.description?.slice(0, 300),
          url: r.url,
        });
      }
    } catch {}
  }

  log(`[EVOLVE] World scan: ${signals.length} signals found`);
  return signals;
}

// ── GATHER SELF STATE ──────────────────────────────────────────────────

function gatherSelfState(db) {
  const state = {};

  // What are our current search queries?
  try {
    const config = readConfig();
    state.scout_keywords = config.bots?.["scout-bot"]?.keywords || [];
    state.target_industries = config.bots?.["icp-outreach-bot"]?.target_industries || [];
    state.budget = config.global?.daily_budget_usd;
    state.spent = config.global?.spent_today_usd;
  } catch {}

  // What's our performance?
  try {
    state.total_leads = db.prepare("SELECT COUNT(*) as c FROM leads").get()?.c || 0;
    state.qualified = db.prepare("SELECT COUNT(*) as c FROM leads WHERE stage IN ('warming','ready_buyer')").get()?.c || 0;
    state.revenue = 0;
  } catch {}

  // What rules has the system learned?
  state.procedural_rules = recall(db, "procedural", null, 10).map(m => m.content);

  return state;
}

// ── PHASE 3: GENERATE HYPOTHESES ───────────────────────────────────────

async function generateHypotheses(worldSignals, selfState, evolutionState, log, deepInsight = "") {
  const prompt = `You are the EVOLUTION ENGINE of an autonomous AI business system.

CURRENT STATE:
- Product: AI workflow automation and custom AI builds ($1500-8000 CAD; voice receptionist discontinued 2026-04-22)
- Revenue: $${selfState.revenue || 0}
- Total leads: ${selfState.total_leads || 0}, Qualified: ${selfState.qualified || 0}
- Budget: $${selfState.budget || 0}/day, Spent: $${selfState.spent || 0}
- Current keywords: ${JSON.stringify(selfState.scout_keywords || [])}
- Target industries: ${JSON.stringify(selfState.target_industries || [])}
- Generation: ${evolutionState.generation}
- Past experiments: ${evolutionState.experiments.slice(-5).map(e => `${e.idea} -> ${e.result}`).join("; ") || "none yet"}

WORLD SIGNALS (fresh from internet):
${worldSignals.map(s => `- ${s.title}: ${s.description}`).join("\n") || "no signals"}

LEARNED RULES:
${(selfState.procedural_rules || []).slice(0, 5).join("\n") || "none"}
${deepInsight ? `\n${deepInsight}` : ""}

Generate 3 HYPOTHESES for improvement. Each hypothesis should be:
1. SPECIFIC — not "improve outreach" but "add dental clinic subreddits r/dentistry r/dentaloffice to search"
2. TESTABLE — can be verified in 24 hours
3. NOVEL — not something the system already does

YOUR BODY (what you can control and modify):
${formatBodyMapForLLM()}

Think about:
- New places to find clients (subreddits, forums, directories, Facebook groups)
- New messaging angles (what pain points to lead with)
- New pricing or packaging approaches
- New channels entirely (Twitter DMs, LinkedIn comments, cold calling scripts)
- What competitors are doing that we're not
- What the world signals suggest about market trends
- What assets in YOUR BODY need to change to support new ideas
- IMPORTANT: For each hypothesis, specify which body assets need to change

Return JSON:
{
  "hypotheses": [
    {
      "idea": "specific change to try",
      "category": "queries|scoring|channels|messaging|pricing|targeting",
      "implementation": {"action": "rewrite_queries|new_rule|change_config|...", "details": {...}},
      "expected_outcome": "what we expect to happen",
      "measurement": "how to know if it worked",
      "confidence": 0.0-1.0
    }
  ],
  "world_insight": "most interesting thing learned from world signals",
  "evolution_direction": "where the system should be heading"
}`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.4",
        messages: [{ role: "user", content: prompt }],
        max_completion_tokens: 2000,
        temperature: 0.7,
        response_format: { type: "json_object" },
      }),
    });

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return [];

    const result = JSON.parse(content);
    log(`[EVOLVE] World insight: ${result.world_insight}`);
    log(`[EVOLVE] Direction: ${result.evolution_direction}`);
    log(`[EVOLVE] Hypotheses: ${result.hypotheses?.length || 0}`);
    for (const h of (result.hypotheses || [])) {
      log(`[EVOLVE]   - ${h.idea} (confidence: ${h.confidence})`);
    }

    return result.hypotheses || [];
  } catch (e) {
    log(`[EVOLVE] Hypothesis generation failed: ${e.message}`);
    return [];
  }
}

// ── PHASE 4: APPLY EXPERIMENT ──────────────────────────────────────────

async function applyExperiment(db, hypothesis, state, log) {
  const experiment = {
    generation: state.generation,
    idea: hypothesis.idea,
    category: hypothesis.category,
    confidence: hypothesis.confidence,
    startedAt: new Date().toISOString(),
    result: "pending",
  };

  // Build implementation plan from body map
  const implPlan = planImplementation(hypothesis.idea);
  if (implPlan.length > 0) {
    log(`[EVOLVE] Implementation plan: ${implPlan.length} assets to modify`);
    const autoSteps = implPlan.filter(s => s.automated);
    const manualSteps = implPlan.filter(s => !s.automated);
    log(`[EVOLVE]   AUTO: ${autoSteps.map(s => s.asset).join(", ") || "none"}`);
    log(`[EVOLVE]   MANUAL: ${manualSteps.map(s => s.asset).join(", ") || "none"}`);

    // Execute auto steps that need HANDS (code changes)
    for (const step of autoSteps) {
      if (step.how?.includes("HANDS") || step.action?.includes("cortex-hands")) {
        try {
          log(`[EVOLVE] HANDS executing: ${step.asset}`);
          const handsResult = await executeBodyMapStep(db, step, hypothesis.idea, log);
          if (handsResult.success) {
            log(`[EVOLVE] HANDS OK: ${step.asset} - ${handsResult.filesChanged.join(", ")}`);
            experiment.result = `hands: ${handsResult.filesChanged.length} files changed`;
          } else {
            log(`[EVOLVE] HANDS FAILED: ${step.asset} - ${handsResult.error}`);
          }
        } catch (e) {
          log(`[EVOLVE] HANDS ERROR: ${e.message}`);
        }
      }
    }

    // Notify Kirill about manual steps
    if (manualSteps.length > 0) {
      const ENV_PATH = resolve(ROOT, "apps/api/.env");
      const env2 = Object.fromEntries(readFileSync(ENV_PATH, "utf-8").split("\n").filter(l => l && !l.startsWith("#") && l.includes("=")).map(l => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
      const msg = `CORTEX EVOLUTION (gen ${state.generation}):\n\nIdea: ${hypothesis.idea}\n\nI can auto-apply:\n${autoSteps.map(s => `- ${s.asset}: ${s.action}`).join("\n") || "- nothing"}\n\nNeeds your action:\n${manualSteps.map(s => `- ${s.asset}: ${s.how}`).join("\n")}`;
      try {
        await fetch(`https://api.telegram.org/bot${env2.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: env2.TELEGRAM_CHAT_ID, text: msg.slice(0, 4096) }),
        });
      } catch {}
    }
  }

  const impl = hypothesis.implementation || {};

  switch (impl.action) {
    case "rewrite_queries": {
      if (impl.details?.queries) {
        const config = readConfig();
        if (!config.bots["scout-bot"]) config.bots["scout-bot"] = {};
        // Add new queries without removing old ones
        const existing = config.bots["scout-bot"].keywords || [];
        const newOnes = impl.details.queries.filter(q => !existing.includes(q));
        config.bots["scout-bot"].keywords = [...existing, ...newOnes].slice(0, 20);
        writeConfig(config);
        log(`[EVOLVE] Added ${newOnes.length} new search queries`);
        experiment.result = `added ${newOnes.length} queries`;
      }
      break;
    }

    case "new_rule": {
      if (impl.details?.rule) {
        remember(db, "procedural", `EVOLVED (gen ${state.generation}): ${impl.details.rule}`, "evolution", "evolution-engine", 0.8);
        log(`[EVOLVE] New rule injected: ${impl.details.rule.slice(0, 80)}`);
        experiment.result = "rule injected";
      }
      break;
    }

    case "change_config": {
      if (impl.details) {
        const config = readConfig();
        const botName = impl.details.bot;
        if (botName && config.bots[botName]) {
          Object.assign(config.bots[botName], impl.details.config || {});
          writeConfig(config);
          log(`[EVOLVE] Config updated for ${botName}`);
          experiment.result = `config updated: ${botName}`;
        }
      }
      break;
    }

    case "code_change":
    case "rewrite_prompt":
    case "create_page": {
      // HANDS: execute code changes directly via Claude CLI
      try {
        const { executeHands } = await import("./hands.mjs");
        const handsResult = await executeHands({
          description: hypothesis.idea,
          type: impl.action === "create_page" ? "create_page" : impl.action === "rewrite_prompt" ? "rewrite_prompt" : "code_edit",
          files: impl.details?.files || [],
          context: `Evolution gen ${state.generation}. Expected outcome: ${hypothesis.expected_outcome}`,
          origin: "evolution-engine",
        }, { log });
        if (handsResult.success) {
          experiment.result = `hands executed: ${handsResult.filesChanged.join(", ")}`;
          log(`[EVOLVE] HANDS executed: ${handsResult.filesChanged.length} files`);
        } else {
          experiment.result = `hands failed: ${handsResult.error}`;
          log(`[EVOLVE] HANDS failed: ${handsResult.error}`);
        }
      } catch (e) {
        experiment.result = `hands error: ${e.message}`;
        log(`[EVOLVE] HANDS error: ${e.message}`);
      }
      break;
    }

    default: {
      // Store as a rule for the brain to consider
      remember(db, "working", `EVOLUTION HYPOTHESIS (gen ${state.generation}): ${hypothesis.idea}. Try this approach.`, "evolution", "evolution-engine", 0.8);
      experiment.result = "stored as hypothesis";
      break;
    }
  }

  state.experiments.push(experiment);
  remember(db, "episodic", `Evolution gen ${state.generation}: tested "${hypothesis.idea}" (${hypothesis.category}). Result: ${experiment.result}`, "evolution", "evolution-engine");
}
