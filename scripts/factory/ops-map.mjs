/**
 * ops-map.mjs
 *
 * Operational map of all agents: roles, health requirements,
 * escalation rules, and task launch gate.
 *
 * Usage:
 *   import { assertSystemReady, checkSystemHealth, AGENT_REGISTRY } from "./ops-map.mjs";
 *
 *   // Before ANY outreach/dispatch task:
 *   await assertSystemReady(db, "outreach");
 *
 *   // Full system health snapshot:
 *   const health = checkSystemHealth(db);
 *   if (!health.ready) { ... }
 */

import { readFileSync, existsSync, statSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");

// ─────────────────────────────────────────────────────────
// AGENT REGISTRY
// Every bot in the system. layer = logical group.
// critical = if broken, blocks the whole layer's tasks.
// ─────────────────────────────────────────────────────────
export const AGENT_REGISTRY = {
  // ── ORCHESTRATION ──────────────────────────────────────
  "orchestrator": {
    layer: "orchestration",
    role: "Master controller. Single voice to Kirill. Routes tasks to bots.",
    critical: true,
    escalate_to: null,
    log_path: "/tmp/lbo-orchestrator.log",
    heartbeat_id: "orchestrator",
    max_silence_min: 40,
  },
  "orchestrator-loop": {
    layer: "orchestration",
    role: "30-min loop runner. Builds prompt, calls Claude CLI, logs cycle.",
    critical: true,
    escalate_to: "orchestrator",
    log_path: "/tmp/lbo-orchestrator-loop.log",
    heartbeat_id: "orchestrator-loop",
    max_silence_min: 45,
  },
  "dispatch-guardrails": {
    layer: "orchestration",
    role: "Pre-dispatch gate. Blocks unproven outreach segments. Must run before every send.",
    critical: true,
    escalate_to: "orchestrator",
    log_path: null,
    heartbeat_id: "dispatch-guardrails",
    max_silence_min: 120,
  },
  "cron-watchdog": {
    layer: "orchestration",
    role: "Monitors cron jobs. Alerts if bots stop running.",
    critical: false,
    escalate_to: "orchestrator",
    log_path: "/tmp/lbo-watchdog.log",
    heartbeat_id: "cron-watchdog",
    max_silence_min: 90,
  },

  // ── OUTREACH ───────────────────────────────────────────
  "calgary-email-outreach": {
    layer: "outreach",
    role: "Sends cold email to Calgary SMBs. Reads from leads DB. Checks guardrails first.",
    critical: false,
    escalate_to: "dispatch-guardrails",
    log_path: "/tmp/lbo-calgary-email-outreach.log",
    heartbeat_id: "calgary-email-outreach",
    max_silence_min: 1440,
  },
  "icp-outreach-bot": {
    layer: "outreach",
    role: "ICP-targeted outreach. Locale-aware (EN/RU). Reads enriched leads only.",
    critical: false,
    escalate_to: "dispatch-guardrails",
    log_path: "/tmp/lbo-icp-outreach-bot.log",
    heartbeat_id: "icp-outreach-bot",
    max_silence_min: 1440,
  },
  "monitor-replies": {
    layer: "outreach",
    role: "Polls IMAP for replies to outreach. Feeds reply-classifier.",
    critical: false,
    escalate_to: "reply-classifier",
    log_path: "/tmp/lbo-monitor-replies.log",
    heartbeat_id: "monitor-replies",
    max_silence_min: 180,
  },
  "reply-classifier": {
    layer: "outreach",
    role: "Classifies inbound replies: intent, sentiment, action required.",
    critical: false,
    escalate_to: "orchestrator",
    log_path: "/tmp/lbo-reply-classifier.log",
    heartbeat_id: "reply-classifier",
    max_silence_min: 360,
  },
  "telegram-sales-agent": {
    layer: "outreach",
    role: "Telegram-based sales interface. Identifies as CORTEX AI partner (not human).",
    critical: false,
    escalate_to: "orchestrator",
    log_path: null,
    heartbeat_id: "telegram-sales-agent",
    max_silence_min: 720,
  },

  // ── SCOUT ──────────────────────────────────────────────
  "scout-bot": {
    layer: "scout",
    role: "Scans LinkedIn, Threads, Reddit, HN, r/forhire for real customers.",
    critical: false,
    escalate_to: "orchestrator",
    log_path: "/tmp/lbo-scout-bot.log",
    heartbeat_id: "scout-bot",
    max_silence_min: 180,
  },
  "fresh-pain-scout": {
    layer: "scout",
    role: "Finds fresh pain signals across channels. Feeds lead pipeline.",
    critical: false,
    escalate_to: "orchestrator",
    log_path: "/tmp/lbo-fresh-pain-scout.log",
    heartbeat_id: "fresh-pain-scout",
    max_silence_min: 120,
  },
  "reddit-monitor": {
    layer: "scout",
    role: "Monitors Reddit discussions. Max 15 posts, 5s delay, retry on 429.",
    critical: false,
    escalate_to: "scout-bot",
    log_path: "/tmp/lbo-reddit-monitor.log",
    heartbeat_id: "reddit-monitor",
    max_silence_min: 120,
  },
  "buying-signal-hunt": {
    layer: "scout",
    role: "Hunts buying intent signals. Feeds priority queue for outreach.",
    critical: false,
    escalate_to: "scout-bot",
    log_path: "/tmp/lbo-buying-signal-hunt.log",
    heartbeat_id: "buying-signal-hunt",
    max_silence_min: 180,
  },
  "calgary-local-pain-scout": {
    layer: "scout",
    role: "Calgary-specific pain point finder. Local SMB focus.",
    critical: false,
    escalate_to: "scout-bot",
    log_path: "/tmp/lbo-calgary-local-pain-scout.log",
    heartbeat_id: "calgary-local-pain-scout",
    max_silence_min: 360,
  },
  "job-post-intent-scout": {
    layer: "scout",
    role: "Intent signals from job postings. Finds companies scaling ops = automation buyers.",
    critical: false,
    escalate_to: "scout-bot",
    log_path: null,
    heartbeat_id: "job-post-intent-scout",
    max_silence_min: 720,
  },
  "hn-show-hn-scout": {
    layer: "scout",
    role: "HN Show HN scanner. Finds solo founders for First 10 Customers pitch.",
    critical: false,
    escalate_to: "scout-bot",
    log_path: "/tmp/lbo-hn-show-hn-scout.log",
    heartbeat_id: "hn-show-hn-scout",
    max_silence_min: 360,
  },
  "hn-whoshiring-scout": {
    layer: "scout",
    role: "HN Who's Hiring scanner. Companies hiring = growth signal.",
    critical: false,
    escalate_to: "scout-bot",
    log_path: "/tmp/lbo-hn-whoshiring-scout.log",
    heartbeat_id: "hn-whoshiring-scout",
    max_silence_min: 720,
  },

  // ── ENRICHMENT ─────────────────────────────────────────
  "lead-enrichment-bot": {
    layer: "enrichment",
    role: "Enriches leads with company/contact data. 180s timeout. Must complete before dispatch.",
    critical: false,
    escalate_to: "orchestrator",
    log_path: "/tmp/lbo-lead-enrichment-bot.log",
    heartbeat_id: "lead-enrichment-bot",
    max_silence_min: 360,
  },
  "draft-quality-checker": {
    layer: "enrichment",
    role: "Quality gate on outbound drafts. Blocks AI-tell messages from sending.",
    critical: true,
    escalate_to: "orchestrator",
    log_path: "/tmp/lbo-draft-quality-checker.log",
    heartbeat_id: "draft-quality-checker",
    max_silence_min: 360,
  },
  "purge-garbage-leads": {
    layer: "enrichment",
    role: "Removes false positives (job postings, product listings) from lead DB.",
    critical: false,
    escalate_to: "lead-enrichment-bot",
    log_path: null,
    heartbeat_id: "purge-garbage-leads",
    max_silence_min: 1440,
  },

  // ── CONTENT ────────────────────────────────────────────
  "content-bot": {
    layer: "content",
    role: "Writes LinkedIn posts. Only on Kirill's explicit request.",
    critical: false,
    escalate_to: "orchestrator",
    log_path: null,
    heartbeat_id: "content-bot",
    max_silence_min: 2880,
  },
  "dispatch-reddit-drafts": {
    layer: "content",
    role: "Batch dispatch of Reddit drafts. ALL Reddit batches must go through this wrapper.",
    critical: false,
    escalate_to: "orchestrator",
    log_path: null,
    heartbeat_id: "dispatch-reddit-drafts",
    max_silence_min: 360,
  },
  "content-curator-bot": {
    layer: "content",
    role: "Curates external content feed for awareness signals.",
    critical: false,
    escalate_to: "orchestrator",
    log_path: "/tmp/lbo-content-curator-bot.log",
    heartbeat_id: "content-curator-bot",
    max_silence_min: 720,
  },

  // ── INTELLIGENCE ───────────────────────────────────────
  "awareness-bot": {
    layer: "intelligence",
    role: "Broad market awareness. Scans wide. Feeds daily observations.",
    critical: false,
    escalate_to: "orchestrator",
    log_path: "/tmp/lbo-awareness-bot.log",
    heartbeat_id: "awareness-bot",
    max_silence_min: 180,
  },
  "competitor-agent": {
    layer: "intelligence",
    role: "Competitive intelligence. Tracks what others are doing.",
    critical: false,
    escalate_to: "orchestrator",
    log_path: null,
    heartbeat_id: "competitor-agent",
    max_silence_min: 1440,
  },
  "analytics-bot": {
    layer: "intelligence",
    role: "KPI and metrics tracking. Reports to Orchestrator.",
    critical: false,
    escalate_to: "orchestrator",
    log_path: null,
    heartbeat_id: "analytics-bot",
    max_silence_min: 1440,
  },
  "daily-heartbeat-report": {
    layer: "intelligence",
    role: "Daily status summary. Aggregates all bot health into one report.",
    critical: false,
    escalate_to: "orchestrator",
    log_path: "/tmp/lbo-daily-heartbeat-report.log",
    heartbeat_id: "daily-heartbeat-report",
    max_silence_min: 1500,
  },
  "system-brain": {
    layer: "intelligence",
    role: "Meta-monitor for brain health. Synthesizes system-level observations.",
    critical: false,
    escalate_to: "orchestrator",
    log_path: "/tmp/lbo-system-brain.log",
    heartbeat_id: "system-brain",
    max_silence_min: 360,
  },

  // ── CORTEX ─────────────────────────────────────────────
  "cortex-daemon": {
    layer: "cortex",
    role: "Long-running CORTEX process. Polls for tasks, manages all cortex modules.",
    critical: true,
    escalate_to: null,
    pid_path: resolve(ROOT, ".data/cortex-daemon.pid"),
    heartbeat_id: "cortex-daemon",
    max_silence_min: 30,
  },
  "hands": {
    layer: "cortex",
    role: "Execution layer. Receives code-change tasks from CORTEX, spawns Claude CLI.",
    critical: true,
    escalate_to: "cortex-daemon",
    heartbeat_id: "hands",
    max_silence_min: 60,
  },
  "project-executor": {
    layer: "cortex",
    role: "Multi-step project runner. Executes task sequences end-to-end.",
    critical: false,
    escalate_to: "cortex-daemon",
    heartbeat_id: "project-executor",
    max_silence_min: 120,
  },
};

// ─────────────────────────────────────────────────────────
// TASK LAYER MAP
// Which agents must be healthy before a task type can launch.
// required_agents: ALL must be non-error.
// soft_agents: warnings only, don't block.
// ─────────────────────────────────────────────────────────
export const TASK_LAYERS = {
  outreach: {
    description: "Cold email / Reddit / Telegram outreach",
    required_agents: ["dispatch-guardrails", "draft-quality-checker"],
    soft_agents: ["lead-enrichment-bot", "monitor-replies"],
    blocks_if_db_broken: true,
  },
  scout: {
    description: "Lead discovery and pain signal collection",
    required_agents: [],
    soft_agents: ["reddit-monitor", "fresh-pain-scout"],
    blocks_if_db_broken: true,
  },
  enrichment: {
    description: "Lead enrichment and quality gating",
    required_agents: [],
    soft_agents: ["lead-enrichment-bot", "purge-garbage-leads"],
    blocks_if_db_broken: true,
  },
  content: {
    description: "Content drafting and publishing",
    required_agents: ["draft-quality-checker"],
    soft_agents: ["content-bot"],
    blocks_if_db_broken: false,
  },
  intelligence: {
    description: "Market awareness and analytics",
    required_agents: [],
    soft_agents: [],
    blocks_if_db_broken: false,
  },
  cortex: {
    description: "Internal brain tasks and code execution",
    required_agents: ["cortex-daemon"],
    soft_agents: [],
    blocks_if_db_broken: false,
  },
};

// ─────────────────────────────────────────────────────────
// ESCALATION RULES
// What to do when an agent is broken.
// ─────────────────────────────────────────────────────────
export const ESCALATION_RULES = [
  {
    trigger: "critical_agent_down",
    description: "A critical agent has not reported in beyond max_silence_min",
    action: "block_layer",
    notify: true,
    auto_recover: false,
    message: (agent) => `BLOCKED: ${agent} is critical and silent. Fix before launching tasks.`,
  },
  {
    trigger: "db_unreachable",
    description: "SQLite DB cannot be read",
    action: "block_all_db_tasks",
    notify: true,
    auto_recover: false,
    message: () => "BLOCKED: Database unreachable. All outreach/scout/enrichment tasks halted.",
  },
  {
    trigger: "dispatch_guardrails_broken",
    description: "dispatch-guardrails has no recent data or is in error state",
    action: "block_outreach",
    notify: true,
    auto_recover: false,
    message: () => "BLOCKED: Dispatch guardrails not initialized. Cannot send outreach safely.",
  },
  {
    trigger: "draft_quality_broken",
    description: "draft-quality-checker is broken or erroring",
    action: "block_outreach_and_content",
    notify: true,
    auto_recover: false,
    message: () => "BLOCKED: Draft quality checker broken. Cannot dispatch unreviewed drafts.",
  },
  {
    trigger: "agent_error_state",
    description: "Non-critical agent is in error state",
    action: "warn_and_continue",
    notify: true,
    auto_recover: true,
    message: (agent) => `WARNING: ${agent} is in error state. Continuing with degraded capacity.`,
  },
  {
    trigger: "log_stale",
    description: "Agent log has not been updated beyond max_silence_min",
    action: "warn",
    notify: false,
    auto_recover: false,
    message: (agent) => `WARNING: ${agent} log is stale. May be stuck or stopped.`,
  },
];

// ─────────────────────────────────────────────────────────
// SYSTEM HEALTH CHECK
// Reads DB heartbeats + log mtimes to determine agent states.
// Returns { ready, blockers, warnings, agents }
// ─────────────────────────────────────────────────────────
export function checkSystemHealth(db) {
  const now = Date.now();
  const blockers = [];
  const warnings = [];
  const agents = {};

  // Check DB connectivity first
  let dbOk = false;
  try {
    db.prepare("SELECT 1").get();
    dbOk = true;
  } catch (e) {
    blockers.push({ code: "db_unreachable", message: `Database error: ${e.message}` });
    return { ready: false, blockers, warnings, agents, dbOk: false };
  }

  // Load all heartbeats from DB
  let heartbeats = {};
  try {
    const rows = db.prepare(`
      SELECT bot_id, health_status, last_success_at, error, pinged_at
      FROM bot_heartbeats
    `).all();
    for (const r of rows) heartbeats[r.bot_id] = r;
  } catch {
    // heartbeats table may not exist yet - non-fatal
  }

  // Evaluate each registered agent
  for (const [agentId, def] of Object.entries(AGENT_REGISTRY)) {
    const hb = heartbeats[def.heartbeat_id];
    const maxSilenceMs = def.max_silence_min * 60 * 1000;

    let state = "unknown";
    let lastSeenMin = null;
    let detail = null;

    // Check heartbeat from DB
    if (hb) {
      const pingAge = hb.pinged_at ? now - new Date(hb.pinged_at).getTime() : Infinity;
      lastSeenMin = Math.floor(pingAge / 60000);

      if (hb.health_status === "error") {
        state = "error";
        detail = hb.error || "error state";
      } else if (pingAge > maxSilenceMs) {
        state = "stale";
        detail = `silent ${lastSeenMin}m (max ${def.max_silence_min}m)`;
      } else {
        state = hb.health_status === "ok" ? "ok" : hb.health_status || "active";
      }
    } else if (def.log_path) {
      // Fallback: check log file mtime
      try {
        const st = statSync(def.log_path);
        const logAge = now - st.mtimeMs;
        lastSeenMin = Math.floor(logAge / 60000);
        state = logAge > maxSilenceMs ? "stale" : "active";
        detail = `log age ${lastSeenMin}m`;
      } catch {
        state = "unknown";
        detail = "no log";
      }
    } else if (def.pid_path) {
      // Fallback: check PID file
      try {
        const pid = parseInt(readFileSync(def.pid_path, "utf-8").trim(), 10);
        try {
          process.kill(pid, 0); // 0 = check existence only
          state = "ok";
          detail = `pid ${pid} alive`;
        } catch {
          state = "error";
          detail = `pid ${pid} not found`;
        }
      } catch {
        state = "unknown";
        detail = "no pid file";
      }
    }

    agents[agentId] = { state, lastSeenMin, detail, layer: def.layer, critical: def.critical };

    // Apply escalation rules
    if (def.critical && (state === "error" || state === "stale")) {
      blockers.push({
        agent: agentId,
        code: "critical_agent_down",
        message: ESCALATION_RULES.find(r => r.trigger === "critical_agent_down").message(agentId),
        detail,
      });
    } else if (!def.critical && (state === "error" || state === "stale")) {
      warnings.push({
        agent: agentId,
        code: "agent_error_state",
        message: ESCALATION_RULES.find(r => r.trigger === "agent_error_state").message(agentId),
        detail,
      });
    }
  }

  // Check guardrails table for outreach safety
  try {
    const guardrailCount = db.prepare("SELECT COUNT(*) c FROM dispatch_guardrails").get().c;
    if (guardrailCount === 0) {
      blockers.push({
        agent: "dispatch-guardrails",
        code: "dispatch_guardrails_broken",
        message: ESCALATION_RULES.find(r => r.trigger === "dispatch_guardrails_broken").message(),
      });
    }
  } catch {
    // table doesn't exist yet - warn, not block
    warnings.push({
      agent: "dispatch-guardrails",
      code: "dispatch_guardrails_broken",
      message: "dispatch_guardrails table missing - run refreshGuardrails first",
    });
  }

  return {
    ready: blockers.length === 0,
    blockers,
    warnings,
    agents,
    dbOk,
    summary: `${Object.values(agents).filter(a => a.state === "ok" || a.state === "active").length}/${Object.keys(agents).length} agents healthy`,
  };
}

// ─────────────────────────────────────────────────────────
// TASK LAUNCH GATE
// Call before executing any significant task.
// Throws SystemNotReadyError if the system is broken.
// ─────────────────────────────────────────────────────────
export class SystemNotReadyError extends Error {
  constructor(blockers) {
    super(`System not ready - ${blockers.length} blocker(s):\n${blockers.map(b => `  - ${b.message}`).join("\n")}`);
    this.name = "SystemNotReadyError";
    this.blockers = blockers;
  }
}

/**
 * Asserts the system is healthy enough to launch a task of the given type.
 * Throws SystemNotReadyError if blocked.
 *
 * @param {Database} db
 * @param {string} taskType - key from TASK_LAYERS
 * @param {object} [opts]
 * @param {boolean} [opts.dryRun] - log result but don't throw
 */
export function assertSystemReady(db, taskType, opts = {}) {
  const layer = TASK_LAYERS[taskType];
  if (!layer) {
    throw new Error(`Unknown task type: "${taskType}". Valid types: ${Object.keys(TASK_LAYERS).join(", ")}`);
  }

  const health = checkSystemHealth(db);
  const taskBlockers = [];

  // DB required for some layers
  if (!health.dbOk && layer.blocks_if_db_broken) {
    taskBlockers.push({ code: "db_unreachable", message: "Database unreachable - task blocked" });
  }

  // Any global blockers (critical agents down)
  for (const blocker of health.blockers) {
    // Only apply if this blocker's agent is required for this layer
    const agentDef = AGENT_REGISTRY[blocker.agent];
    if (!agentDef) continue;

    // Critical agents always block regardless of layer
    if (agentDef.critical) {
      taskBlockers.push(blocker);
      continue;
    }

    // Layer-required agents block their specific layer
    if (layer.required_agents.includes(blocker.agent)) {
      taskBlockers.push(blocker);
    }
  }

  // Check layer-specific required agents directly
  for (const agentId of layer.required_agents) {
    const agentState = health.agents[agentId];
    if (!agentState) continue;
    if (agentState.state === "error" || agentState.state === "stale") {
      const isDuplicate = taskBlockers.some(b => b.agent === agentId);
      if (!isDuplicate) {
        taskBlockers.push({
          agent: agentId,
          code: "required_agent_broken",
          message: `Required agent ${agentId} is ${agentState.state}: ${agentState.detail || "no detail"}`,
        });
      }
    }
  }

  if (opts.dryRun) {
    return {
      allowed: taskBlockers.length === 0,
      blockers: taskBlockers,
      warnings: health.warnings,
      health,
    };
  }

  if (taskBlockers.length > 0) {
    throw new SystemNotReadyError(taskBlockers);
  }

  return { allowed: true, blockers: [], warnings: health.warnings, health };
}

// ─────────────────────────────────────────────────────────
// HUMAN-READABLE STATUS REPORT
// ─────────────────────────────────────────────────────────
export function formatStatusReport(db) {
  const health = checkSystemHealth(db);
  const lines = [];

  lines.push("SYSTEM OPERATIONAL MAP");
  lines.push(`${health.summary}`);
  lines.push("");

  const byLayer = {};
  for (const [agentId, state] of Object.entries(health.agents)) {
    const layer = state.layer;
    if (!byLayer[layer]) byLayer[layer] = [];
    const icon = state.state === "ok" || state.state === "active" ? "+" :
                 state.state === "error" ? "X" :
                 state.state === "stale" ? "~" : "?";
    byLayer[layer].push(`  [${icon}] ${agentId.padEnd(30)} ${state.state}${state.detail ? ` (${state.detail})` : ""}`);
  }

  for (const [layer, rows] of Object.entries(byLayer)) {
    lines.push(`[${layer.toUpperCase()}]`);
    lines.push(...rows);
    lines.push("");
  }

  if (health.blockers.length > 0) {
    lines.push("BLOCKERS:");
    for (const b of health.blockers) lines.push(`  BLOCKED: ${b.message}`);
    lines.push("");
  }

  if (health.warnings.length > 0) {
    lines.push("WARNINGS:");
    for (const w of health.warnings) lines.push(`  WARN: ${w.message}`);
  }

  return lines.join("\n");
}
