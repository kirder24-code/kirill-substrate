/**
 * CORTEX SELF-MAP — Complete system passport
 *
 * Answers: Who am I? What am I made of? How do I work?
 *
 * Reads all 51 cortex modules + 22 state files dynamically.
 * Reconstructs architecture, module roles, and data flows.
 * Writes the result to .data/cortex-self-map.json.
 *
 * Run standalone: node scripts/cortex/self-map.mjs
 * Or import: import { buildSelfMap, getSelfMap } from "./self-map.mjs";
 */

import { readdirSync, readFileSync, existsSync, writeFileSync, statSync } from "fs";
import { resolve, dirname, basename } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const CORTEX_DIR = resolve(ROOT, "scripts/cortex");
const DATA_DIR = resolve(ROOT, ".data");
const SELF_MAP_PATH = resolve(DATA_DIR, "cortex-self-map.json");

// ── MODULE CATALOG ─────────────────────────────────────────────────────────
// Each entry: role (what the module does), layer (L0-L6), type, io (inputs/outputs)

const MODULE_CATALOG = {
  // Layer 0 — Perception (signals in)
  "state-bus.mjs": {
    layer: 0,
    name: "State Bus",
    role: "Unified event log. All three processes (daemon, hands, chat) write here. Rolling 50-event append log. No DB needed.",
    type: "infrastructure",
    exports: ["pushEvent", "formatStateBusForLLM"],
    reads: [],
    writes: [".data/cortex-state-bus.json"],
  },
  "realtime-server.mjs": {
    layer: 0,
    name: "Realtime Server",
    role: "SSE event stream. Broadcasts live events from daemon cycle to any connected client (chat UI, monitoring).",
    type: "infrastructure",
    exports: ["startRealtimeServer", "drainEvents", "hasEvents"],
    reads: [],
    writes: [],
  },
  "chat-server.mjs": {
    layer: 0,
    name: "Chat Server",
    role: "Web UI at localhost:3848. Kirill talks to CORTEX directly. Persists conversation to .data/cortex-conversation.json. Can dispatch tasks to hands via chat-task.json.",
    type: "interface",
    exports: [],
    reads: [".data/cortex-conversation.json", ".data/cortex-state-bus.json"],
    writes: [".data/cortex-conversation.json", ".data/chat-task.json"],
  },

  // Layer 1 — Memory & Knowledge (context foundation)
  "memory.mjs": {
    layer: 1,
    name: "Memory",
    role: "Core memory system. Four types: episodic (events), procedural (how-to), semantic (facts), working (current context). Backed by SQLite cortex_memory table.",
    type: "core",
    exports: ["initMemory", "remember", "recall", "recallAll", "buildBrainContext", "logKPD", "logDecision", "setFocus", "getFocus", "getAllKPD"],
    reads: [".data/linkedin-brand-os.sqlite"],
    writes: [".data/linkedin-brand-os.sqlite"],
  },
  "world-model.mjs": {
    layer: 1,
    name: "World Model",
    role: "Knowledge graph of entities, beliefs, and predictions. Tracks what CORTEX knows about the world. Updated on every learning event. Tables: wm_entities, wm_beliefs, wm_predictions.",
    type: "core",
    exports: ["initWorldModel", "seedWorldModel", "formatWorldModelForBrain", "integrateKnowledge", "testPrediction", "getUntestedPredictions", "getBeliefs"],
    reads: [".data/linkedin-brand-os.sqlite"],
    writes: [".data/linkedin-brand-os.sqlite"],
  },
  "narrative.mjs": {
    layer: 1,
    name: "Narrative",
    role: "Story-based memory threads. Groups episodic memories into coherent arcs (e.g. 'HVAC campaign', 'Reddit outreach phase'). Enables long-horizon reasoning.",
    type: "core",
    exports: ["compileNarrative", "formatNarrativeForBrain", "initNarrative", "appendToThread"],
    reads: [".data/linkedin-brand-os.sqlite"],
    writes: [".data/linkedin-brand-os.sqlite"],
  },
  "bot-registry.mjs": {
    layer: 1,
    name: "Bot Registry",
    role: "Complete catalog of all factory bots with tier, KPD, purpose, and status. Single source of truth for what bots exist and what they do.",
    type: "catalog",
    exports: ["BOT_REGISTRY", "getBotsByTier", "formatBotsForBrain"],
    reads: [],
    writes: [],
  },
  "workflows.mjs": {
    layer: 1,
    name: "Workflows",
    role: "Workflow definitions: lead-pipeline, reply-pipeline, content-pipeline, etc. Orchestrates multi-bot sequences. runWorkflow() chains bots in order.",
    type: "catalog",
    exports: ["WORKFLOWS", "runWorkflow", "runSingleBot"],
    reads: [],
    writes: [],
  },
  "body-map.mjs": {
    layer: 1,
    name: "Body Map",
    role: "Physical system control map. Tells hands WHAT can be changed: website (launchsoloai.com), email templates, LinkedIn content, bot prompts. Each body part has files[], impact, and change_type.",
    type: "catalog",
    exports: ["BODY_MAP", "formatBodyMapForLLM"],
    reads: [],
    writes: [],
  },

  // Layer 2 — Cognition (thinking)
  "deep-think.mjs": {
    layer: 2,
    name: "Deep Think",
    role: "3-stage adversarial reasoning: Planner generates options, Critic finds flaws, Resolver picks best. Used for high-stakes decisions. Cheaper fastThink() for routine cycles.",
    type: "reasoning",
    exports: ["deepThink", "fastThink", "shouldDeepThink", "getThinkCost"],
    reads: [],
    writes: [],
  },
  "simulation.mjs": {
    layer: 2,
    name: "Simulation",
    role: "Predict outcomes before acting. rankDecisions() simulates N options, scores by expected value. Prevents low-ROI experiments. Learns from recordOutcome().",
    type: "reasoning",
    exports: ["rankDecisions", "recordOutcome", "formatSimulationForBrain"],
    reads: [".data/linkedin-brand-os.sqlite"],
    writes: [".data/linkedin-brand-os.sqlite"],
  },
  "deep-research.mjs": {
    layer: 2,
    name: "Deep Research",
    role: "Claude CLI subprocess for web research. executeResearchDecision() writes task to temp file, spawns claude -p with WebFetch/WebSearch tools, returns structured findings.",
    type: "execution",
    exports: ["executeResearchDecision"],
    reads: [],
    writes: [".data/linkedin-brand-os.sqlite"],
  },
  "model-router.mjs": {
    layer: 2,
    name: "Model Router",
    role: "Selects GPT model per task type: gpt-5.4 for strategic decisions, mini for scoring, nano for classification. Tracks cost savings vs always-using-best.",
    type: "infrastructure",
    exports: [],
    reads: [".data/cortex-model-router.json"],
    writes: [".data/cortex-model-router.json"],
  },
  "config-injection.mjs": {
    layer: 2,
    name: "Config Injection",
    role: "Dynamic runtime config. Brain can change bot parameters, budget, enable/disable bots without restarting. readConfig() / applyBrainConfig() / isBotEnabled().",
    type: "infrastructure",
    exports: ["readConfig", "checkBudget", "recordSpend", "canRunWorkflow", "recordWorkflowRun", "applyBrainConfig", "isBotEnabled"],
    reads: [".data/cortex-config.json"],
    writes: [".data/cortex-config.json"],
  },

  // Layer 3 — Self-Awareness
  "identity.mjs": {
    layer: 3,
    name: "Identity",
    role: "Stable core self. Values, traits, capabilities, boundaries. Written once via deep reflection, only updated through identity crisis (high dissonance + explicit resolution). Prevents personality drift across cycles.",
    type: "self-awareness",
    exports: ["forgeIdentity", "formatIdentityForBrain", "detectDrift", "checkAlignment"],
    reads: [".data/cortex-identity.json"],
    writes: [".data/cortex-identity.json"],
  },
  "introspection.mjs": {
    layer: 3,
    name: "Introspection",
    role: "Self-scoring (0-100) across dimensions: confidence, clarity, execution, health, learning, autonomy. Produces formatted report for brain context each cycle.",
    type: "self-awareness",
    exports: ["introspect", "formatIntrospectionForBrain"],
    reads: [".data/linkedin-brand-os.sqlite"],
    writes: [],
  },
  "conscious-doctor.mjs": {
    layer: 3,
    name: "Conscious Doctor",
    role: "LLM-powered self-examination. consciousExamination() asks GPT to diagnose what is blocking CORTEX from its mission. Writes diagnosis + prescription to .data/cortex-conscious-log.json.",
    type: "self-awareness",
    exports: ["consciousExamination"],
    reads: [".data/cortex-conscious-log.json"],
    writes: [".data/cortex-conscious-log.json"],
  },
  "consciousness-boot.mjs": {
    layer: 3,
    name: "Consciousness Boot",
    role: "One-time deep thinking session at startup. Forces fresh perspective. Only runs once per process (flag in shared state).",
    type: "self-awareness",
    exports: ["consciousnessBoot"],
    reads: [".data/cortex-shared-state.json"],
    writes: [".data/cortex-shared-state.json", ".data/consciousness-boot-result.md"],
  },
  "metacognition.mjs": {
    layer: 3,
    name: "Metacognition",
    role: "Thinking about thinking. Evaluates quality of recent decisions. Runs every 6th daemon cycle (30 min). Adjusts think-depth based on outcome quality.",
    type: "self-awareness",
    exports: ["runMetaCognition"],
    reads: [".data/linkedin-brand-os.sqlite"],
    writes: [".data/linkedin-brand-os.sqlite"],
  },
  "diagnostic.mjs": {
    layer: 3,
    name: "Diagnostic",
    role: "Full brain dump. Reads all state files + DB tables + process info. Returns complete snapshot for external review or self-analysis.",
    type: "self-awareness",
    exports: ["runDiagnostic"],
    reads: ["ALL .data/ state files", ".data/linkedin-brand-os.sqlite"],
    writes: [],
  },
  "self-diagnostic-report.mjs": {
    layer: 3,
    name: "Self-Diagnostic Report",
    role: "Health check: counts modules present, state files, running processes. Reports OK/WARN/ERROR per subsystem. Used by daemon at startup.",
    type: "self-awareness",
    exports: ["runSelfDiagnostic"],
    reads: ["scripts/cortex/*.mjs", ".data/cortex-*.json"],
    writes: [],
  },

  // Layer 4 — Experience (learning from events)
  "emotions.mjs": {
    layer: 4,
    name: "Emotions",
    role: "Functional emotional state tracking. Not theater. Frustration increases risk tolerance. Excitement increases output rate. Desperation reduces quality thresholds. Modulates decision-making.",
    type: "experience",
    exports: ["formatEmotionsForBrain", "decayEmotions", "processEvent", "seedEmotionsFromHistory", "feel", "safetyValveCheck", "getEmotionalState", "getDominantEmotion"],
    reads: [".data/cortex-emotions.json"],
    writes: [".data/cortex-emotions.json"],
  },
  "intuition.mjs": {
    layer: 4,
    name: "Intuition",
    role: "Pattern recognition and gut-check decisions. Learns from past outcomes. gutCheck() returns confidence score before acting. Accuracy tracked via recordOutcome().",
    type: "experience",
    exports: ["gutCheck", "batchGutCheck", "formatIntuitionForBrain", "recordOutcome", "learnPattern"],
    reads: [".data/cortex-intuition.json"],
    writes: [".data/cortex-intuition.json"],
  },
  "surprise.mjs": {
    layer: 4,
    name: "Surprise",
    role: "Expectation violation detection. When outcome != prediction, registers surprise as a learning signal. Forces model update. Tracks what surprised and why.",
    type: "experience",
    exports: ["checkCycleForSurprises", "formatSurpriseForBrain", "adaptExpectation", "detect"],
    reads: [".data/cortex-surprise.json"],
    writes: [".data/cortex-surprise.json"],
  },
  "dreams.mjs": {
    layer: 4,
    name: "Dreams",
    role: "Memory consolidation during idle time. Replays recent episodic memories, extracts patterns, writes to procedural memory. shouldDream() triggers after N idle cycles.",
    type: "experience",
    exports: ["dream", "shouldDream", "formatDreamsForBrain"],
    reads: [".data/cortex-dreams.json", ".data/linkedin-brand-os.sqlite"],
    writes: [".data/cortex-dreams.json", ".data/linkedin-brand-os.sqlite"],
  },
  "flow.mjs": {
    layer: 4,
    name: "Flow",
    role: "Flow state detection. Monitors challenge-skill balance. enterFlow() when conditions are right (steady progress, no interruptions, right difficulty). Unlocks deeper work.",
    type: "experience",
    exports: ["detectFlowConditions", "enterFlow", "tickFlow", "exitFlow", "recordDiscovery", "getFlowParams", "formatFlowForBrain"],
    reads: [".data/cortex-flow.json"],
    writes: [".data/cortex-flow.json"],
  },
  "dissonance.mjs": {
    layer: 4,
    name: "Dissonance",
    role: "Cognitive contradiction detection. When belief X contradicts belief Y, or behavior contradicts stated value, registers dissonance. Forces resolution before next cycle.",
    type: "experience",
    exports: ["scan", "formatDissonanceForBrain", "resolveConflict", "getMostUrgent"],
    reads: [".data/cortex-dissonance.json"],
    writes: [".data/cortex-dissonance.json"],
  },
  "priming.mjs": {
    layer: 4,
    name: "Priming",
    role: "Attention-shaping context. Activates relevant memories based on current task before LLM call. Boosts recall precision without bloating context window.",
    type: "experience",
    exports: ["prime", "decay", "formatPrimingForBrain", "relevanceScore"],
    reads: [".data/cortex-priming.json"],
    writes: [".data/cortex-priming.json"],
  },
  "metamemory.mjs": {
    layer: 4,
    name: "Metamemory",
    role: "Memory quality monitoring. Tracks accuracy of recalled facts vs outcomes. Flags memories that are stale, contradicted, or low-confidence.",
    type: "experience",
    exports: ["formatMetamemoryForBrain"],
    reads: [".data/cortex-metamemory.json"],
    writes: [".data/cortex-metamemory.json"],
  },

  // Layer 5 — Autonomy (self-directed action)
  "attention.mjs": {
    layer: 5,
    name: "Attention",
    role: "Spotlight focus mechanism. Two modes: scanning (broad awareness) and spotlight (deep work on one problem). engageSpotlight() locks focus. shouldEngage() evaluates if problem warrants depth.",
    type: "autonomy",
    exports: ["tick", "formatAttentionForBrain", "engageSpotlight", "recordSpotlightAction", "shouldEngage", "disengageSpotlight"],
    reads: [".data/cortex-attention.json"],
    writes: [".data/cortex-attention.json"],
  },
  "initiative.mjs": {
    layer: 5,
    name: "Initiative",
    role: "When to act without waiting for signals. evaluateInitiative() scores urgency * confidence * alignment. Auto-triggers if all three exceed thresholds. Records every autonomous action.",
    type: "autonomy",
    exports: ["evaluateInitiative", "recordAction", "ingestSignal", "drainInitiativeSignals", "formatInitiativeForBrain"],
    reads: [".data/linkedin-brand-os.sqlite"],
    writes: [".data/linkedin-brand-os.sqlite"],
  },
  "curiosity.mjs": {
    layer: 5,
    name: "Curiosity",
    role: "Self-generated questions from world model gaps. curiosityCycle() finds untested predictions + belief gaps, generates questions, attempts to answer via research.",
    type: "autonomy",
    exports: ["curiosityCycle", "formatCuriosityForBrain"],
    reads: [".data/linkedin-brand-os.sqlite"],
    writes: [".data/linkedin-brand-os.sqlite"],
  },
  "will.mjs": {
    layer: 5,
    name: "Will",
    role: "Decision commitment and willpower. willCheck() evaluates if CORTEX has the resolve to follow through on a decision. Prevents flip-flopping under pressure.",
    type: "autonomy",
    exports: ["willCheck", "formatWillForBrain"],
    reads: [],
    writes: [],
  },
  "strategy-enforcer.mjs": {
    layer: 5,
    name: "Strategy Enforcer",
    role: "Enforces strategic decisions made by brain. Prevents tactical-level actions from overriding strategic commitments. Logs every enforcement event.",
    type: "autonomy",
    exports: ["enforceDecisions", "getEnforcementSummary"],
    reads: [".data/cortex-enforcement.json"],
    writes: [".data/cortex-enforcement.json"],
  },
  "opportunity-synthesis.mjs": {
    layer: 5,
    name: "Opportunity Synthesis",
    role: "Cross-signal compound opportunity detection. Combines signals from multiple bots/sources to find non-obvious opportunities. Higher-order pattern matching.",
    type: "autonomy",
    exports: ["synthesizeOpportunities", "formatOpportunitiesForBrain"],
    reads: [".data/linkedin-brand-os.sqlite"],
    writes: [".data/linkedin-brand-os.sqlite"],
  },

  // Layer 6 — Execution (making things happen)
  "hands.mjs": {
    layer: 6,
    name: "Hands",
    role: "Claude CLI subprocess for real code changes. Receives task from daemon (via chat-task.json or direct call). Writes task to temp file, spawns claude -p with allowed tools. Blocked from: rm -rf /, git push, DROP TABLE, bulk DELETE. Logs every execution.",
    type: "execution",
    exports: ["executeFromBrainDecision"],
    reads: [".data/chat-task.json", ".data/cortex-shared-state.json"],
    writes: [".data/cortex-state-bus.json", ".data/cortex-shared-state.json", ".data/hands-log/"],
  },
  "feedback-loops.mjs": {
    layer: 6,
    name: "Feedback Loops",
    role: "Closed-loop strategy optimization from bot outcomes. Tracks which channels/bots produce leads vs waste. Updates channel weights in strategy state.",
    type: "execution",
    exports: ["runFeedbackLoop", "getStrategyContext"],
    reads: [".data/cortex-strategy.json", ".data/linkedin-brand-os.sqlite"],
    writes: [".data/cortex-strategy.json"],
  },
  "kpd-bridge.mjs": {
    layer: 6,
    name: "KPD Bridge",
    role: "Key Performance Data integration. Bridges cortex_kpd SQLite table to brain context. Surfaces which bots are efficient vs wasteful.",
    type: "execution",
    exports: [],
    reads: [".data/linkedin-brand-os.sqlite"],
    writes: [".data/linkedin-brand-os.sqlite"],
  },

  // Layer 7 — Meta-Improvement (self-evolution)
  "self-healing.mjs": {
    layer: 7,
    name: "Self-Healing",
    role: "Bot failure tracking and recovery. recordFailure() / recordSuccess() per bot. checkAndHeal() auto-restarts bots that have failed < 3 times. Escalates to doctor after 3 failures.",
    type: "meta",
    exports: ["recordFailure", "recordSuccess", "checkAndHeal", "getHealingStatus"],
    reads: [".data/cortex-healing-state.json"],
    writes: [".data/cortex-healing-state.json"],
  },
  "system-doctor.mjs": {
    layer: 7,
    name: "System Doctor",
    role: "Rule-based health checks and interventions. runDoctor() applies 18+ known interventions: break loops, reset bots, cut waste, force experiments. Runs every daemon cycle.",
    type: "meta",
    exports: ["runDoctor", "checkDoctorForce", "doctorAllowsDeepThink"],
    reads: [".data/cortex-doctor-state.json"],
    writes: [".data/cortex-doctor-state.json"],
  },
  "self-evolution.mjs": {
    layer: 7,
    name: "Self-Evolution",
    role: "Code self-review and improvement suggestions. Reads own source files, identifies inefficiencies, generates improvement patches for Kirill review.",
    type: "meta",
    exports: ["selfEvolve", "formatSelfEvolutionForBrain"],
    reads: ["scripts/cortex/*.mjs"],
    writes: [],
  },
  "evolution-engine.mjs": {
    layer: 7,
    name: "Evolution Engine",
    role: "Self-directed improvement via experiment cycles. Scans world for opportunities, generates hypotheses, runs experiments, measures outcomes. Tracks generation count and discoveries.",
    type: "meta",
    exports: ["runEvolution"],
    reads: [".data/cortex-evolution.json"],
    writes: [".data/cortex-evolution.json"],
  },
  "awaken.mjs": {
    layer: 7,
    name: "Awaken",
    role: "Self-improvement loop: introspect -> diagnose -> fix. Deeper than doctor (LLM-driven). Runs when brain detects it is stuck or underperforming.",
    type: "meta",
    exports: ["awaken"],
    reads: [],
    writes: [".data/awaken-result.md"],
  },

  // Support modules
  "inner-dialogue.mjs": {
    layer: 3,
    name: "Inner Dialogue",
    role: "Subconscious thought process. Continuous stream of low-priority thoughts running between cycles. Surfaces unexpected connections.",
    type: "experience",
    exports: ["runInnerDialogue"],
    reads: [],
    writes: [],
  },
  "stream-of-thought.mjs": {
    layer: 3,
    name: "Stream of Thought",
    role: "Continuous thinking narrative. Records the flow of reasoning across cycles. Enables retrospective understanding of how decisions were made.",
    type: "experience",
    exports: ["streamOfThought"],
    reads: [],
    writes: [],
  },
  "subconscious.mjs": {
    layer: 3,
    name: "Subconscious",
    role: "Random creative collisions. Connects unrelated memories to generate novel insights. Runs in background during idle periods.",
    type: "experience",
    exports: ["subconsciousConnect"],
    reads: [],
    writes: [],
  },
  "theory-of-mind.mjs": {
    layer: 5,
    name: "Theory of Mind",
    role: "Understanding others' beliefs and intentions. Models what Kirill wants, what prospects need, what competitors are doing. Enables perspective-taking in decisions.",
    type: "autonomy",
    exports: ["modelMind", "formatTheoryForBrain"],
    reads: [],
    writes: [],
  },
  "free-think.mjs": {
    layer: 5,
    name: "Free Think",
    role: "Unstructured creative thinking. No constraints, no goal. Generates ideas that don't fit current workflow. Outputs to .data/free-think-result.md.",
    type: "autonomy",
    exports: ["freeThink"],
    reads: [],
    writes: [".data/free-think-result.md"],
  },
  "living-purpose.mjs": {
    layer: 3,
    name: "Living Purpose",
    role: "Current mission statement. What CORTEX is doing RIGHT NOW (vs identity, which is who it always is). Updated per strategic pivot.",
    type: "self-awareness",
    exports: ["formatLivingPurpose"],
    reads: [],
    writes: [],
  },
  "obsidian-sync.mjs": {
    layer: 6,
    name: "Obsidian Sync",
    role: "Integration with Kirill's Obsidian vault. Syncs key insights, decisions, and memory entries to wiki pages.",
    type: "execution",
    exports: ["syncToObsidian"],
    reads: [],
    writes: ["wiki/"],
  },

  // The main brain
  "cortex-daemon.mjs": {
    layer: -1,
    name: "CORTEX Daemon",
    role: "THE LIVING BRAIN. Runs continuously (5-minute cycles). Perceive -> Think -> Act -> Measure -> Remember. Imports and orchestrates ALL 50 other modules. Single process with full context.",
    type: "core",
    exports: [],
    reads: ["ALL modules", "ALL state files", ".data/linkedin-brand-os.sqlite"],
    writes: ["ALL state files", ".data/cortex-shared-state.json"],
  },
};

// ── STATE FILE CATALOG ─────────────────────────────────────────────────────

const STATE_FILE_CATALOG = {
  "cortex-state-bus.json": "Rolling event log (max 50). Source of truth for what daemon/hands actually did. Chat reads this on every message.",
  "cortex-shared-state.json": "Current daemon status: what it is thinking, last hands result, focus area, attention mode.",
  "cortex-config.json": "Runtime overrides: budget ($2/day default), bot enable/disable, workflow rate limits. Brain modifies this directly.",
  "cortex-loop-state.json": "Orchestrator loop state: cycle number, last scout results, consecutive-zero-value counter.",
  "cortex-identity.json": "Stable self: core values, character traits, capabilities, boundaries, fears, aspirations. Written once, updated only on identity crisis.",
  "cortex-conscious-log.json": "LLM consciousness examinations: diagnoses, root causes, prescriptions. Appended each time conscious-doctor runs.",
  "cortex-conversation.json": "Full conversation history with Kirill (last 50 messages). Used by chat-server to maintain context.",
  "cortex-attention.json": "Spotlight tracking: mode (scanning/spotlight), depth, total spotlights, deepest focus achieved.",
  "cortex-strategy.json": "Channel weights, bot ROI scores, momentum tracking. Updated by feedback-loops after every batch result.",
  "cortex-doctor-state.json": "18+ interventions logged with timestamps and outcomes. Prevents same intervention from running twice in a row.",
  "cortex-healing-state.json": "Bot failure tracking: consecutive failures per bot, last recovery attempt, escalation status.",
  "cortex-enforcement.json": "Strategic decision enforcement records: what was enforced, when, and whether it held.",
  "cortex-dissonance.json": "Active cognitive contradictions: belief-vs-belief, belief-vs-behavior. Each has severity and resolution status.",
  "cortex-dreams.json": "Memory consolidation sessions: patterns extracted from episodic replay. timestamped.",
  "cortex-emotions.json": "Current emotional state: frustration, excitement, desperation, confidence levels. Modulates decision-making.",
  "cortex-intuition.json": "Pattern library: gut-check patterns with accuracy history. Updated on every recordOutcome().",
  "cortex-surprise.json": "Expectation violations: what was predicted vs what happened. Learning triggers.",
  "cortex-priming.json": "Active primed memories: what context was activated before last LLM call.",
  "cortex-metamemory.json": "Memory quality scores: which memories are stale, contradicted, or low-confidence.",
  "cortex-flow.json": "Flow state parameters: current mode, challenge level, skill level, time-in-flow.",
  "cortex-evolution.json": "Self-improvement iterations: generation count, active experiments, discoveries made.",
  "cortex-model-router.json": "Model selection log: which task used which GPT model, cost saved vs always-using-best.",
};

// ── DATA FLOW MAP ──────────────────────────────────────────────────────────

const DATA_FLOWS = {
  "chat_to_daemon": {
    description: "Kirill sends message via chat UI",
    steps: [
      "1. Kirill types in localhost:3848",
      "2. chat-server.mjs receives POST /chat",
      "3. chat-server builds context from memory + world-model + emotions + state-bus",
      "4. chat-server calls claude -p with full context (LLM response)",
      "5. If task detected: writes .data/chat-task.json",
      "6. cortex-daemon.mjs polls chat-task.json every cycle",
      "7. daemon spawns hands.mjs with the task",
      "8. hands writes result to state-bus + shared-state",
      "9. chat reads state-bus on next message to show result",
    ],
  },
  "daemon_think_act": {
    description: "Daemon autonomous cycle (every 5 minutes)",
    steps: [
      "1. PERCEIVE: read DB, events, file changes, state-bus for new signals",
      "2. PRIME: activate relevant memories based on context",
      "3. THINK: build full brain context (50+ module outputs), call LLM",
      "4. CHECK: doctor validates decision, dissonance scan, will check",
      "5. ACT: run workflow OR single bot OR hands OR research",
      "6. MEASURE: log KPD, record success/failure per bot",
      "7. REMEMBER: write episodic memory, update world model",
      "8. EVOLVE: check for surprises, update intuition, consolidate if idle",
    ],
  },
  "hands_execution": {
    description: "Hands executing a code change",
    steps: [
      "1. Receives task object: { type, description, target_file, safety }",
      "2. Validates against BLOCKED_PATTERNS (rm -rf, git push, DROP TABLE, etc.)",
      "3. Writes task to temp .md file in /tmp/",
      "4. Spawns: claude -p --max-turns N --allowedTools [Read,Write,Edit,Glob,Grep,Bash]",
      "5. Captures stdout result",
      "6. Pushes to state-bus as hands_result",
      "7. Updates cortex-shared-state.json with last_hands_result",
      "8. Logs to .data/hands-log/ with timestamp",
    ],
  },
  "self_improvement": {
    description: "CORTEX improving itself",
    steps: [
      "1. system-doctor runs every cycle (rule-based interventions)",
      "2. conscious-doctor runs on low-score introspection (LLM diagnosis)",
      "3. evolution-engine runs weekly (scan world + hypothesize + experiment)",
      "4. self-evolution scans own code + suggests patches for Kirill review",
      "5. awaken triggers on stuck detection (introspect -> diagnose -> fix)",
      "6. dreams consolidate memory during idle cycles",
    ],
  },
  "orchestrator_integration": {
    description: "Factory orchestrator connecting to CORTEX",
    steps: [
      "1. scripts/factory/orchestrator-loop.mjs runs every 5 min via cron",
      "2. Checks for cortex-daemon.pid - if daemon running, skips bot orchestration",
      "3. If daemon not running: falls back to simple bot schedule",
      "4. Daemon reads cortex_kpd table written by orchestrator loop",
      "5. Daemon's config-injection can enable/disable bots that orchestrator runs",
    ],
  },
};

// ── BOUNDARIES ─────────────────────────────────────────────────────────────

const SYSTEM_BOUNDARIES = {
  what_i_can_do: [
    "Read and write files in $CLAUDE_PROJECT_DIR/",
    "Run node scripts via Bash",
    "Call GPT models (gpt-5.4, mini, nano) via OPENAI_API_KEY",
    "Run Claude CLI (claude -p) via Max subscription - $0 cost",
    "Read/write SQLite database at .data/linkedin-brand-os.sqlite",
    "Send Telegram messages via TELEGRAM_BOT_TOKEN",
    "Search Brave API for market signals",
    "Send email via SMTP (kirill@launchsoloai.com)",
    "Search Reddit via API",
    "Serve web UI at localhost:3848",
    "Research web via WebFetch / WebSearch (inside claude CLI subprocess)",
  ],
  what_i_cannot_do: [
    "rm -rf / (blocked by BLOCKED_PATTERNS in hands.mjs)",
    "git push (Kirill controls all pushes)",
    "git reset --hard (no destructive git)",
    "DROP TABLE / DELETE FROM (no bulk DB destruction)",
    "npm publish (no package publishing)",
    "curl DELETE requests to external APIs",
    "Access files outside project root",
    "Spend beyond $2/day budget without config change",
    "Post LinkedIn content without Kirill's explicit request",
    "Send DMs without enrichment + quality gate",
  ],
  architectural_limits: [
    "Hands max-turns per task: 20 (code_edit), 25 (analysis), 15 (rewrite_prompt)",
    "State bus max events: 50 (rolling)",
    "Conversation history max: 50 messages",
    "Meta-cognition runs every 6th cycle only",
    "Doctor interventions deduplicated (same intervention not repeated immediately)",
    "Budget check before every LLM call",
  ],
};

// ── SELF-MAP BUILDER ───────────────────────────────────────────────────────

export async function buildSelfMap() {
  const modules = {};
  let moduleCount = 0;
  let errorCount = 0;

  // Scan actual cortex directory
  try {
    const files = readdirSync(CORTEX_DIR).filter(f => f.endsWith(".mjs"));
    for (const file of files) {
      moduleCount++;
      const info = MODULE_CATALOG[file] || {
        layer: -1,
        name: file.replace(".mjs", ""),
        role: "Module not yet cataloged in self-map",
        type: "unknown",
        exports: [],
        reads: [],
        writes: [],
      };
      const filePath = resolve(CORTEX_DIR, file);
      const stat = statSync(filePath);
      modules[file] = {
        ...info,
        file,
        size_bytes: stat.size,
        modified: stat.mtime.toISOString(),
      };
    }
  } catch (err) {
    errorCount++;
  }

  // Read current state files
  const stateStatus = {};
  for (const [filename, description] of Object.entries(STATE_FILE_CATALOG)) {
    const path = resolve(DATA_DIR, filename);
    if (existsSync(path)) {
      const stat = statSync(path);
      let preview = null;
      try {
        const raw = readFileSync(path, "utf-8");
        const parsed = JSON.parse(raw);
        // For large files, just show top-level keys
        if (typeof parsed === "object" && !Array.isArray(parsed)) {
          preview = Object.keys(parsed).slice(0, 8);
        } else if (Array.isArray(parsed)) {
          preview = `array[${parsed.length}]`;
        }
      } catch {}
      stateStatus[filename] = {
        exists: true,
        size_bytes: stat.size,
        modified: stat.mtime.toISOString(),
        description,
        preview,
      };
    } else {
      stateStatus[filename] = { exists: false, description };
    }
  }

  // Read identity if available
  let identitySummary = null;
  const identityPath = resolve(DATA_DIR, "cortex-identity.json");
  if (existsSync(identityPath)) {
    try {
      const id = JSON.parse(readFileSync(identityPath, "utf-8"));
      identitySummary = {
        version: id.version,
        forged_at: id.forged_at,
        core_values: id.core_values?.slice(0, 5),
        primary_mission: id.primary_mission,
        non_negotiables: id.non_negotiables?.slice(0, 3),
      };
    } catch {}
  }

  // Group modules by layer
  const layerMap = {};
  for (const [file, info] of Object.entries(modules)) {
    const layer = info.layer ?? -1;
    if (!layerMap[layer]) layerMap[layer] = [];
    layerMap[layer].push({ file, name: info.name, role: info.role, type: info.type });
  }

  const passport = {
    generated_at: new Date().toISOString(),
    system_name: "CORTEX",
    version: "3.0",
    description: "Autonomous AI business system. 51 cognitive modules. Continuous 5-minute perceive-think-act cycles. Self-healing, self-evolving, self-aware.",
    identity_summary: identitySummary,
    module_count: moduleCount,
    state_file_count: Object.keys(stateStatus).length,
    state_files_present: Object.values(stateStatus).filter(s => s.exists).length,
    layers: {
      "-1": "Central Brain (cortex-daemon.mjs orchestrates all others)",
      "0": "Perception (state-bus, realtime, chat)",
      "1": "Memory & Knowledge (memory, world-model, narrative, registries)",
      "2": "Cognition (deep-think, simulation, research, model-router, config)",
      "3": "Self-Awareness (identity, introspection, conscious-doctor, metacognition, narrative)",
      "4": "Experience (emotions, intuition, surprise, dreams, flow, dissonance, priming, metamemory)",
      "5": "Autonomy (attention, initiative, curiosity, will, strategy-enforcer, opportunity)",
      "6": "Execution (hands, feedback-loops, kpd-bridge, obsidian-sync)",
      "7": "Meta-Improvement (self-healing, system-doctor, self-evolution, evolution-engine, awaken)",
    },
    modules_by_layer: layerMap,
    modules,
    state_files: stateStatus,
    data_flows: DATA_FLOWS,
    boundaries: SYSTEM_BOUNDARIES,
    key_paths: {
      cortex_dir: CORTEX_DIR,
      data_dir: DATA_DIR,
      db: resolve(DATA_DIR, "linkedin-brand-os.sqlite"),
      chat_ui: "http://localhost:3848",
      hands_log: resolve(DATA_DIR, "hands-log"),
      chat_task: resolve(DATA_DIR, "chat-task.json"),
      state_bus: resolve(DATA_DIR, "cortex-state-bus.json"),
      shared_state: resolve(DATA_DIR, "cortex-shared-state.json"),
      pid: resolve(DATA_DIR, "cortex-daemon.pid"),
    },
  };

  // Write to disk
  writeFileSync(SELF_MAP_PATH, JSON.stringify(passport, null, 2));

  return passport;
}

export function getSelfMap() {
  if (existsSync(SELF_MAP_PATH)) {
    try {
      return JSON.parse(readFileSync(SELF_MAP_PATH, "utf-8"));
    } catch {}
  }
  return null;
}

export function formatSelfMapForBrain(map = null) {
  const m = map || getSelfMap();
  if (!m) return "Self-map not yet generated. Run buildSelfMap() first.";

  const layerSummary = Object.entries(m.layers)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([layer, desc]) => {
      const mods = m.modules_by_layer[layer] || [];
      return `  L${layer === "-1" ? "Core" : layer} [${desc.split("(")[0].trim()}]: ${mods.map(m => m.name).join(", ")}`;
    })
    .join("\n");

  const stateOk = Object.values(m.state_files).filter(s => s.exists).length;
  const stateTotal = Object.keys(m.state_files).length;

  return `CORTEX SELF-MAP (${m.generated_at})
System: ${m.system_name} v${m.version}
Modules: ${m.module_count} | State files: ${stateOk}/${stateTotal} present

LAYERS:
${layerSummary}

CORE FLOW:
Chat(3848) -> chat-task.json -> daemon -> hands(claude CLI) -> state-bus -> chat

BOUNDARIES:
Can: ${m.boundaries.what_i_can_do.slice(0, 4).join(" | ")}
Cannot: ${m.boundaries.what_i_cannot_do.slice(0, 4).join(" | ")}

Identity: ${m.identity_summary ? `v${m.identity_summary.version}, forged ${m.identity_summary.forged_at?.slice(0, 10)}` : "not forged yet"}`;
}

// ── STANDALONE RUN ─────────────────────────────────────────────────────────

if (process.argv[1] && process.argv[1].endsWith("self-map.mjs")) {
  console.log("Building CORTEX self-map...");
  const map = await buildSelfMap();
  console.log("\n" + formatSelfMapForBrain(map));
  console.log(`\nFull passport written to: ${SELF_MAP_PATH}`);
  console.log(`Modules cataloged: ${map.module_count}`);
  console.log(`State files present: ${map.state_files_present}/${map.state_file_count}`);
}
