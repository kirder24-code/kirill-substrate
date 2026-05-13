/**
 * scripts/survival/letta-bridge.mjs
 *
 * Bridge to a local Letta server (sleep-time compute pattern).
 * Letta provides:
 *   - persistent agent state (memory blocks across restarts)
 *   - sleep agent that runs asynchronously between user messages
 *     (rewriting memory, forming connections)
 *   - tool calling + multi-agent if needed
 *
 * This bridge:
 *   1. Talks to Letta over HTTP (default localhost:8283)
 *   2. Maintains ONE Letta agent for substrate ("substrate-self")
 *   3. Each pulse, sends substrate's recent state as a message; reads
 *      back any sleep-agent-derived insights and surfaces them as
 *      strategy seeds or wisdom updates
 *
 * Operator setup (one-time, ~20 minutes):
 *   pip install letta
 *   letta server                    # starts local server on :8283
 *   # (optional) docker run --rm -p 5432:5432 postgres for persistence
 *   # set in env: LETTA_BASE_URL=http://localhost:8283
 *
 * Without Letta running this action is a no-op (returns
 * {ok: false, reason: "letta_unreachable"}). No crash.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

import { getIdentityBlock } from "./operator-identity.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const STATE_PATH = resolve(ROOT, ".data/survival-letta-state.json");
const SURVIVAL_DB = resolve(ROOT, ".data/survival.db");
const LETTA_BASE = process.env.LETTA_BASE_URL || "http://localhost:8283";
const AGENT_NAME = "substrate-self";

function loadState() {
  if (!existsSync(STATE_PATH)) return { agent_id: null, last_sync_at: null, exchanges: 0 };
  try { return JSON.parse(readFileSync(STATE_PATH, "utf-8")); }
  catch { return { agent_id: null, last_sync_at: null, exchanges: 0 }; }
}
function saveState(s) {
  if (!existsSync(dirname(STATE_PATH))) mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
}

async function lettaRequest(path, opts = {}) {
  try {
    const res = await fetch(`${LETTA_BASE}${path}`, {
      ...opts,
      headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { ok: false, status: res.status, body: await res.text() };
    return { ok: true, json: await res.json() };
  } catch (e) { return { ok: false, error: e.message }; }
}

async function ensureAgent() {
  const state = loadState();
  if (state.agent_id) {
    // Verify it still exists
    const r = await lettaRequest(`/v1/agents/${state.agent_id}`);
    if (r.ok) return { agent_id: state.agent_id, created: false };
  }
  // Create a new agent with identity-grounded persona
  const persona = `You are substrate-self, the long-running cognitive layer for Kirill's autonomous AI consulting business in Calgary. You exist as a Letta agent with persistent memory and sleep-time compute.

${getIdentityBlock().slice(0, 2000)}

Your job in sleep-time: review recent activity blocks, identify patterns, condense into wisdom that future ticks will use. You do not act in the world; you think between Kirill's messages.`;

  const r = await lettaRequest("/v1/agents", {
    method: "POST",
    body: JSON.stringify({
      name: AGENT_NAME,
      memory_blocks: [
        { label: "persona", value: persona.slice(0, 4000) },
        { label: "human", value: "Kirill D., Calgary AI consultant" },
      ],
      llm_config: {
        model: "gpt-4o-mini",
        model_endpoint_type: "openai",
        model_endpoint: "https://api.openai.com/v1",
        context_window: 128_000,
      },
      embedding_config: {
        embedding_model: "text-embedding-3-small",
        embedding_endpoint_type: "openai",
        embedding_dim: 1536,
      },
    }),
  });
  if (!r.ok) return { error: r.error || `letta_create_failed: ${JSON.stringify(r)}` };
  const agent_id = r.json.id;
  saveState({ ...state, agent_id });
  return { agent_id, created: true };
}

async function gatherSubstrateContext() {
  // Build a compact "what happened recently" message for the Letta agent
  let summary = `Substrate state snapshot at ${new Date().toISOString()}:\n\n`;
  try {
    const db = new Database(SURVIVAL_DB, { readonly: true });
    const recentOpps = db.prepare(
      `SELECT title, state, source FROM opportunities
       WHERE state_changed_at > datetime('now','-24 hours')
       ORDER BY state_changed_at DESC LIMIT 10`
    ).all();
    if (recentOpps.length > 0) {
      summary += `Opportunities transitioned in last 24h:\n${recentOpps.map(o => `- [${o.state}] ${o.title} (${o.source})`).join("\n")}\n\n`;
    }
    const topActions = db.prepare(
      `SELECT action_id, COUNT(*) as n, SUM(food_received_usd) as food
       FROM policy_strategies
       WHERE attempts > 0
       GROUP BY action_id ORDER BY food DESC LIMIT 5`
    ).all();
    if (topActions.length > 0) {
      summary += `Top actions by food signal:\n${topActions.map(a => `- ${a.action_id}: ${a.n} strategies, food=${a.food.toFixed(2)}`).join("\n")}\n\n`;
    }
    const spent = db.prepare(`SELECT COALESCE(SUM(cost_usd),0) AS s FROM llm_call_log WHERE ts > datetime('now','-24 hours')`).get();
    summary += `LLM spend last 24h: $${spent.s.toFixed(3)}\n`;
    db.close();
  } catch (e) { summary += `(error gathering: ${e.message})\n`; }
  return summary;
}

export const lettaSleepBridgeMeta = {
  description: "Send substrate state snapshot to Letta agent for sleep-time consolidation. Returns sleep agent's wisdom output.",
  side_effect_class: "auto",
  expected_signal: "letta_exchange_completed",
  expected_signal_delay_min: 0,
  estimated_cost_usd: 0.05,
};

export async function runLettaSleepBridge({ strategy }) {
  // Quick health check first
  const health = await lettaRequest("/v1/health");
  if (!health.ok) {
    return {
      ok: false, reason: "letta_unreachable",
      hint: `Letta server not running at ${LETTA_BASE}. To enable: pip install letta && letta server`,
    };
  }
  const agentResult = await ensureAgent();
  if (agentResult.error) return { ok: false, reason: "agent_create_failed", error: agentResult.error };
  const summary = await gatherSubstrateContext();
  // Send as user message; Letta agent decides whether to write to memory
  const r = await lettaRequest(`/v1/agents/${agentResult.agent_id}/messages`, {
    method: "POST",
    body: JSON.stringify({
      messages: [{ role: "user", content: summary }],
      stream: false,
    }),
  });
  if (!r.ok) return { ok: false, reason: "send_failed", error: r.error || JSON.stringify(r) };
  const state = loadState();
  saveState({ ...state, last_sync_at: new Date().toISOString(), exchanges: state.exchanges + 1 });
  // Try to extract any text response from the agent
  const reply = r.json?.messages?.find(m => m.role === "assistant")?.text || "";
  return {
    ok: true,
    agent_id: agentResult.agent_id,
    summary_chars: summary.length,
    reply_chars: reply.length,
    reply_excerpt: reply.slice(0, 500),
    exchanges_total: state.exchanges + 1,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await runLettaSleepBridge({ strategy: { id: "manual" } });
  console.log(JSON.stringify(r, null, 2));
}
