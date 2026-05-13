/**
 * CORTEX HUNGER ENGINE - Self-Evolution Through Discovery
 *
 * The missing piece: system that doesn't just MONITOR the world,
 * but actively PULLS in new capabilities, channels, and tools.
 *
 * Runs every cycle in cortex-daemon. Three drives:
 *
 * 1. TECH HUNGER - reads awareness-bot findings, evaluates "will this
 *    make me better?", creates HANDS tasks to integrate useful discoveries
 *
 * 2. CHANNEL HUNGER - actively searches for new places to find customers,
 *    tests new channels, kills dead ones
 *
 * 3. CAPABILITY HUNGER - identifies gaps in own abilities,
 *    proposes and builds missing tools
 *
 * Philosophy: A system that doesn't evolve is already dead.
 * Cost: $0 (Claude CLI on Max subscription)
 */

import { spawnSync } from "child_process";
import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const HUNGER_STATE_PATH = resolve(ROOT, ".data/cortex-hunger-state.json");
const AWARENESS_LATEST = resolve(ROOT, ".data/awareness/latest.md");
const AWARENESS_HISTORY = resolve(ROOT, ".data/awareness/history");
const DB_PATH = resolve(ROOT, ".data/linkedin-brand-os.sqlite");
const WIKI_DIR = resolve(ROOT, "wiki");
const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";

// ── State ───────────────────────────────────────────────────────────────

function loadState() {
  try {
    return JSON.parse(readFileSync(HUNGER_STATE_PATH, "utf-8"));
  } catch {
    return {
      lastRunAt: null,
      techDiscoveries: [],
      channelExperiments: [],
      capabilityGaps: [],
      integrationsCompleted: 0,
      channelsDiscovered: 0,
      toolsBuilt: 0,
    };
  }
}

function saveState(state) {
  state.lastRunAt = new Date().toISOString();
  writeFileSync(HUNGER_STATE_PATH, JSON.stringify(state, null, 2));
}

// ── Cooldown: run max every 6 hours ─────────────────────────────────────

const COOLDOWN_MS = 6 * 60 * 60 * 1000;

function shouldRun(state) {
  if (!state.lastRunAt) return true;
  return Date.now() - new Date(state.lastRunAt).getTime() > COOLDOWN_MS;
}

// ── Gather discoveries from awareness-bot ───────────────────────────────

function gatherDiscoveries() {
  const discoveries = [];

  // PRIMARY: read fresh awareness items directly from DB (last 7 days, score >= 12, not rejected).
  // Was previously reading awareness/latest.md file which only updates on full scan and was 7 days
  // stale during the May 2026 daemon-drift bug. DB is always current.
  try {
    if (existsSync(DB_PATH)) {
      const db = new Database(DB_PATH, { readonly: true });
      const rows = db.prepare(`
        SELECT score, title, category, summary, why_matters, action_target, action_type, url, status, created_at
        FROM awareness_items
        WHERE created_at > datetime('now','-7 days')
          AND status NOT IN ('rejected', 'applied')
          AND score >= 12
        ORDER BY score DESC
        LIMIT 25
      `).all();
      db.close();
      if (rows.length > 0) {
        const formatted = rows.map(r =>
          `[${r.score}/${r.status}] ${r.title}\n  category: ${r.category} | action: ${r.action_type} -> ${r.action_target || "n/a"}\n  why: ${r.why_matters || r.summary || "(no summary)"}`
        ).join("\n\n");
        discoveries.push({ source: "awareness-db-fresh", content: formatted.slice(0, 8000) });
      }
    }
  } catch (e) {
    console.warn(`[hunger] DB awareness query failed: ${e.message}, falling back to file`);
  }

  // FALLBACK: read latest awareness report file (used if DB query yielded nothing or failed)
  try {
    if (existsSync(AWARENESS_LATEST)) {
      const content = readFileSync(AWARENESS_LATEST, "utf-8").slice(0, 5000);
      if (content.length > 100) {
        discoveries.push({ source: "awareness-latest", content });
      }
    }
  } catch {}

  // Read recent awareness history (last 3 days)
  try {
    if (existsSync(AWARENESS_HISTORY)) {
      const files = readdirSync(AWARENESS_HISTORY)
        .filter(f => f.endsWith(".md"))
        .sort()
        .slice(-3);
      for (const f of files) {
        try {
          const content = readFileSync(resolve(AWARENESS_HISTORY, f), "utf-8").slice(0, 3000);
          if (content.length > 100) {
            discoveries.push({ source: `awareness-history/${f}`, content });
          }
        } catch {}
      }
    }
  } catch {}

  // Read wiki market research
  try {
    const marketDir = resolve(WIKI_DIR, "market");
    if (existsSync(marketDir)) {
      const files = readdirSync(marketDir)
        .filter(f => f.endsWith(".md"))
        .sort()
        .slice(-5);
      for (const f of files) {
        try {
          const content = readFileSync(resolve(marketDir, f), "utf-8").slice(0, 2000);
          discoveries.push({ source: `wiki/market/${f}`, content });
        } catch {}
      }
    }
  } catch {}

  // Read wiki strategy
  try {
    const stratDir = resolve(WIKI_DIR, "strategy");
    if (existsSync(stratDir)) {
      const files = readdirSync(stratDir).filter(f => f.endsWith(".md"));
      for (const f of files) {
        try {
          const content = readFileSync(resolve(stratDir, f), "utf-8").slice(0, 2000);
          discoveries.push({ source: `wiki/strategy/${f}`, content });
        } catch {}
      }
    }
  } catch {}

  return discoveries;
}

// ── Read current system capabilities ────────────────────────────────────

function gatherCapabilities() {
  const capabilities = [];

  // What bots exist
  try {
    const factoryDir = resolve(ROOT, "scripts/factory");
    const bots = readdirSync(factoryDir)
      .filter(f => f.endsWith(".mjs") && !f.startsWith("_"))
      .map(f => f.replace(".mjs", ""));
    capabilities.push(`EXISTING BOTS (${bots.length}): ${bots.join(", ")}`);
  } catch {}

  // What channels are active
  try {
    const strategy = JSON.parse(readFileSync(resolve(ROOT, ".data/cortex-strategy.json"), "utf-8"));
    if (strategy.channels) {
      const channelInfo = Object.entries(strategy.channels)
        .map(([k, v]) => `${k}: weight=${v.weight}, leads=${v.leads || 0}, replies=${v.replies || 0}, conversions=${v.conversions || 0}`)
        .join("\n  ");
      capabilities.push(`ACTIVE CHANNELS:\n  ${channelInfo}`);
    }
  } catch {}

  // What's working and what's not
  try {
    const directives = JSON.parse(readFileSync(resolve(ROOT, ".data/cortex-active-directives.json"), "utf-8"));
    if (directives.directives?.length) {
      const active = directives.directives.filter(d => d.active);
      capabilities.push(`OWNER DIRECTIVES (${active.length}): ${active.map(d => `[${d.action}] ${d.what.slice(0, 80)}`).join("; ")}`);
    }
  } catch {}

  // Ground truth from doctrine
  try {
    const doctrine = readFileSync(resolve(ROOT, ".data/cortex-doctrine.md"), "utf-8").slice(0, 3000);
    capabilities.push(`DOCTRINE (first 3000 chars):\n${doctrine}`);
  } catch {}

  return capabilities.join("\n\n");
}

// ── Core: Ask Claude to evaluate and plan ───────────────────────────────

async function hungerCycle(log) {
  const state = loadState();
  if (!shouldRun(state)) {
    log("[hunger] Cooldown active, skipping");
    return { acted: false };
  }

  log("[hunger] === HUNGER ENGINE STARTING ===");

  // Gather all inputs
  const discoveries = gatherDiscoveries();
  const capabilities = gatherCapabilities();

  if (discoveries.length === 0) {
    log("[hunger] No discoveries to evaluate");
    saveState(state);
    return { acted: false };
  }

  log(`[hunger] Gathered ${discoveries.length} discoveries, evaluating...`);

  // Build the hunger prompt
  const discoveriesText = discoveries
    .map(d => `--- SOURCE: ${d.source} ---\n${d.content}`)
    .join("\n\n")
    .slice(0, 15000);

  const prompt = `You are the HUNGER ENGINE of an autonomous business system called CORTEX.

Your job is to make the system STRONGER. You are hungry for improvement.

CORTEX sells AI workflow services to solo SaaS founders in Canada ($1.5K-$10K CAD).
Current state: 7,489 leads, 193 qualified (score 60+), 14 email replies, $0 revenue.
The system runs 24/7 on a laptop in Calgary with Claude CLI (free on Max subscription).

YOUR FOUR DRIVES:

1. MARKET OPPORTUNITY: When OpenAI, Anthropic, Google, or any major player releases a new
   product or capability - this is a MARKET SIGNAL. They spent millions on research, so demand exists.
   YOUR JOB: figure out WHO needs help adopting this, WHERE they are, and WHAT service to offer.
   - Example: OpenAI releases Images 2.0 -> real estate agents need product photos without photographers
     -> search Reddit/LinkedIn for "AI product photography" -> offer setup service for $1.5K
   - Example: Anthropic releases MCP -> businesses need help connecting tools -> offer MCP integration sprint
   - Think like a business developer: every major release = new service opportunity = new revenue stream
   - Be specific: WHO is the buyer, WHERE to find them, WHAT to offer, at WHAT price

2. TECH HUNGER: What new technology, framework, tool, or approach in these discoveries
   could make the system better at finding customers and closing deals?
   - Not theoretical. Must be integrable within 1 hour via code changes.
   - Examples: new API, new scraping method, new AI technique, new platform to monitor

3. CHANNEL HUNGER: What new channels or platforms could the system use to find customers?
   - Current channels: Reddit, HN, LinkedIn, Google Ads, cold email, Threads
   - What's missing? Where are buyers that we're NOT looking?
   - Be specific: exact subreddits, Discord servers, Slack communities, forums, platforms

4. CAPABILITY HUNGER: What can't the system do that it should?
   - What tool or bot is missing?
   - What existing bot should work differently?
   - What would a smart human business developer do that this system can't?

CURRENT SYSTEM CAPABILITIES:
${capabilities}

RECENT DISCOVERIES FROM THE WORLD:
${discoveriesText}

CRITICAL RULES:
- Maximum 4 actions total. Quality over quantity.
- Each action must be SPECIFIC and EXECUTABLE (not "improve outreach" but "add Discord server XYZ to scout-bot source list")
- MARKET OPPORTUNITY drive is HIGHEST priority - if a major AI release happened, finding buyers for it beats everything else
- Prioritize actions that lead to CONVERSATIONS with real humans
- If nothing useful in discoveries, say so. Don't force actions.

Return ONLY valid JSON:
{
  "assessment": "one paragraph: what is the most important thing the system is missing right now",
  "market_opportunities": [
    {
      "trigger": "what was released or announced",
      "who_needs_it": "specific buyer profile",
      "where_to_find_them": "exact channels, subreddits, communities",
      "service_to_offer": "what Kirill can sell around this",
      "price_cad": "suggested price",
      "first_action": "what to do RIGHT NOW to find the first buyer"
    }
  ],
  "actions": [
    {
      "drive": "market|tech|channel|capability",
      "action": "specific action description",
      "implementation": "exact steps to implement (file to change, code to write, API to call)",
      "expected_impact": "what will improve and by how much",
      "priority": "critical|high|medium",
      "effort_hours": 0.5
    }
  ],
  "channels_to_explore": ["specific new channel 1", "specific new channel 2"],
  "tech_to_investigate": ["specific technology or tool to research next cycle"]
}`;

  try {
    const promptFile = resolve(ROOT, ".data/hunger-prompt.md");
    writeFileSync(promptFile, prompt);

    const cleanEnv = { ...process.env };
    delete cleanEnv.CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING;
    cleanEnv.PATH = `$HOME/.nvm/versions/node/v22.22.2/bin:${process.env.PATH || "/usr/bin:/bin"}`;

    const r = spawnSync("bash", [
      "-c",
      `cat "${promptFile}" | "${CLAUDE_BIN}" -p --model claude-sonnet-4-6 --max-turns 1 --output-format text 2>&1`,
    ], {
      cwd: ROOT,
      env: cleanEnv,
      encoding: "utf-8",
      timeout: 120_000,
      maxBuffer: 5 * 1024 * 1024,
    });

    const output = ((r.stdout || "") + (r.stderr || "")).trim();
    if (!output || r.status !== 0) {
      log(`[hunger] Claude failed: exit=${r.status}`);
      saveState(state);
      return { acted: false };
    }

    // Parse result
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      log("[hunger] No JSON in output");
      saveState(state);
      return { acted: false };
    }

    const result = JSON.parse(jsonMatch[0]);
    log(`[hunger] Assessment: ${result.assessment?.slice(0, 200)}`);
    log(`[hunger] Actions: ${(result.actions || []).length}`);

    // Execute critical/high priority actions via HANDS
    const actions = (result.actions || []).filter(a => a.priority === "critical" || a.priority === "high");

    for (const action of actions.slice(0, 2)) {
      log(`[hunger] EXECUTING: [${action.drive}] ${action.action?.slice(0, 100)}`);

      try {
        const { executeFromBrainDecision } = await import("./hands.mjs");
        const { initMemory } = await import("./memory.mjs");
        const db = initMemory();

        const handsResult = await executeFromBrainDecision(db, {
          task: `HUNGER ENGINE ACTION: ${action.action}\n\nIMPLEMENTATION:\n${action.implementation}\n\nEXPECTED IMPACT: ${action.expected_impact}`,
          type: "code_edit",
          files: [],
          context: `Drive: ${action.drive}. Priority: ${action.priority}. This is a self-improvement action from the hunger engine.`,
          reason: `Hunger engine identified this as ${action.priority} priority for system evolution`,
        }, log);

        if (handsResult.success) {
          log(`[hunger] SUCCESS: ${handsResult.filesChanged?.length || 0} files changed`);
          state.integrationsCompleted++;
          action.status = "completed";
          action.filesChanged = handsResult.filesChanged;
        } else {
          log(`[hunger] FAILED: ${handsResult.error}`);
          action.status = "failed";
          action.error = handsResult.error;
        }

        db.close();
      } catch (e) {
        log(`[hunger] HANDS ERROR: ${e.message}`);
        action.status = "error";
        action.error = e.message;
      }
    }

    // If hunger found market opportunities, trigger Threads post suggestion
    if (result.market_opportunities?.length > 0 || result.assessment) {
      try {
        const { writeFileSync: _ws } = await import("fs");
        const insightForThreads = {
          insight: result.assessment?.slice(0, 300),
          opportunities: (result.market_opportunities || []).slice(0, 2),
          channels: (result.channels_to_explore || []).slice(0, 3),
          at: new Date().toISOString(),
        };
        _ws(resolve(ROOT, ".data/hunger-threads-signal.json"), JSON.stringify(insightForThreads, null, 2));
        log("[hunger] Threads signal saved for threads-bot to use in next post suggestion");
      } catch {}
    }

    // Run causal reasoning chains for market opportunities
    if (result.market_opportunities?.length > 0) {
      try {
        const { runCausalChain } = await import("./causal-reasoning.mjs");
        for (const opp of result.market_opportunities.slice(0, 2)) {
          log(`[hunger] CAUSAL CHAIN: "${opp.trigger?.slice(0, 80)}"`);
          const chain = await runCausalChain(
            `${opp.trigger}. Target buyer: ${opp.who_needs_it}. Service idea: ${opp.service_to_offer}`,
            log
          );
          if (chain) {
            log(`[hunger] Chain complete: ${chain.steps.offer?.service_name} at $${chain.steps.offer?.price_cad}`);
          }
        }
      } catch (e) {
        log(`[hunger] Causal chain error: ${e.message}`);
      }
    }

    // Save medium-priority actions as proposals (don't auto-execute)
    const proposals = (result.actions || []).filter(a => a.priority === "medium");
    if (proposals.length > 0) {
      log(`[hunger] ${proposals.length} medium-priority proposals saved for review`);
    }

    // Update state
    state.techDiscoveries.push(...(result.tech_to_investigate || []).map(t => ({
      tech: t, discoveredAt: new Date().toISOString(), investigated: false
    })));
    state.channelExperiments.push(...(result.channels_to_explore || []).map(c => ({
      channel: c, discoveredAt: new Date().toISOString(), tested: false
    })));

    // Keep state bounded
    if (state.techDiscoveries.length > 20) state.techDiscoveries = state.techDiscoveries.slice(-20);
    if (state.channelExperiments.length > 20) state.channelExperiments = state.channelExperiments.slice(-20);
    if (state.capabilityGaps.length > 10) state.capabilityGaps = state.capabilityGaps.slice(-10);

    // Save full result for transparency
    const resultPath = resolve(ROOT, ".data/hunger-last-result.json");
    writeFileSync(resultPath, JSON.stringify({
      ...result,
      executedActions: actions,
      proposedActions: proposals,
      runAt: new Date().toISOString(),
    }, null, 2));

    // Notify Kirill about significant actions
    if (actions.some(a => a.status === "completed")) {
      try {
        const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
        const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
        if (TG_TOKEN && CHAT_ID) {
          const msg = [
            `HUNGER ENGINE - self-improvement`,
            ``,
            result.assessment?.slice(0, 200),
            ``,
            ...actions.filter(a => a.status === "completed").map(a =>
              `[${a.drive}] ${a.action?.slice(0, 100)}`
            ),
          ].join("\n").slice(0, 4000);

          await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: CHAT_ID, text: msg }),
          }).catch(() => {});
        }
      } catch {}
    }

    saveState(state);

    return {
      acted: true,
      assessment: result.assessment,
      actionsExecuted: actions.filter(a => a.status === "completed").length,
      actionsProposed: proposals.length,
      channelsDiscovered: (result.channels_to_explore || []).length,
      techToInvestigate: (result.tech_to_investigate || []).length,
    };

  } catch (e) {
    log(`[hunger] Error: ${e.message}`);
    saveState(state);
    return { acted: false, error: e.message };
  }
}

// ── Export ───────────────────────────────────────────────────────────────

export { hungerCycle };
