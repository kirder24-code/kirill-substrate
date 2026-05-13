/**
 * scripts/factory/tool-failure-tracker.mjs
 *
 * Port of PAI ToolFailureTracker hook.
 * Append-only log of every tool/bot failure with structured fields, so the
 * cron-watchdog (and downstream LLM diagnostics) can reason over WHICH tool
 * keeps failing rather than just "log file went stale".
 *
 * Storage: .data/tool-failures.jsonl (append-only, one JSON per line)
 *
 * Public API:
 *   trackFailure({ tool, error, action_id, opp_id, ... })
 *   recentFailures({ tool, sinceMinutes, limit })
 *   failureSummary({ sinceMinutes })  → { byTool: {tool: count}, byReason: {...}, total }
 */

import { appendFileSync, readFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_PATH = resolve(__dirname, "../../.data/tool-failures.jsonl");

function ensureLogDir() {
  try { mkdirSync(dirname(LOG_PATH), { recursive: true }); } catch {}
}

/**
 * Record a failure event. Required: tool. Everything else is optional.
 */
export function trackFailure({ tool, error, action_id, opp_id, lead_id, channel, http_status, latency_ms, retry_count, ...rest } = {}) {
  if (!tool) return { ok: false, reason: "no_tool" };
  ensureLogDir();
  const entry = {
    ts: new Date().toISOString(),
    tool,
    error: typeof error === "string" ? error.slice(0, 600) : (error?.message || error?.code || JSON.stringify(error)?.slice(0, 600)),
    action_id, opp_id, lead_id, channel, http_status, latency_ms, retry_count,
    ...rest,
  };
  // Strip undefined values to keep lines compact
  for (const k of Object.keys(entry)) if (entry[k] === undefined) delete entry[k];
  try {
    appendFileSync(LOG_PATH, JSON.stringify(entry) + "\n");
    return { ok: true };
  } catch (e) { return { ok: false, reason: "write_failed", error: e.message }; }
}

function readEntries(maxLines = 5000) {
  if (!existsSync(LOG_PATH)) return [];
  try {
    const stat = statSync(LOG_PATH);
    if (stat.size === 0) return [];
    // Read whole file - it's append-only, expected to be small
    const lines = readFileSync(LOG_PATH, "utf-8").split("\n").filter(Boolean);
    const tail = lines.slice(-maxLines);
    return tail.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

/**
 * Most recent failures, optionally filtered by tool name and time window.
 */
export function recentFailures({ tool = null, sinceMinutes = 60 * 24, limit = 50 } = {}) {
  const cutoff = Date.now() - sinceMinutes * 60 * 1000;
  const entries = readEntries(5000)
    .filter(e => new Date(e.ts).getTime() >= cutoff)
    .filter(e => !tool || e.tool === tool);
  return entries.slice(-limit);
}

/**
 * Aggregated summary over a time window. Useful for cron-watchdog dashboards.
 */
export function failureSummary({ sinceMinutes = 60 * 24 } = {}) {
  const entries = recentFailures({ sinceMinutes, limit: 5000 });
  const byTool = {};
  const byReason = {};
  const byChannel = {};
  for (const e of entries) {
    byTool[e.tool] = (byTool[e.tool] || 0) + 1;
    const reason = (e.error || "unknown").slice(0, 60);
    byReason[reason] = (byReason[reason] || 0) + 1;
    if (e.channel) byChannel[e.channel] = (byChannel[e.channel] || 0) + 1;
  }
  return {
    total: entries.length,
    sinceMinutes,
    byTool: Object.entries(byTool).sort((a, b) => b[1] - a[1]).slice(0, 20),
    byReason: Object.entries(byReason).sort((a, b) => b[1] - a[1]).slice(0, 15),
    byChannel: Object.entries(byChannel).sort((a, b) => b[1] - a[1]),
    top_offender: Object.entries(byTool).sort((a, b) => b[1] - a[1])[0] || null,
  };
}

/**
 * Convenience: wrap an async fn so any throw is auto-tracked.
 */
export function withFailureTracking(toolName, fn, extraMeta = {}) {
  return async (...args) => {
    const start = Date.now();
    try {
      return await fn(...args);
    } catch (e) {
      trackFailure({ tool: toolName, error: e, latency_ms: Date.now() - start, ...extraMeta });
      throw e;
    }
  };
}

// CLI: `node scripts/factory/tool-failure-tracker.mjs summary`
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const cmd = process.argv[2] || "summary";
  if (cmd === "summary") {
    const since = parseInt(process.argv[3] || "1440");  // default 24h
    const s = failureSummary({ sinceMinutes: since });
    console.log(`Tool failures (last ${since} min):`);
    console.log(`  Total: ${s.total}`);
    if (s.top_offender) console.log(`  Top offender: ${s.top_offender[0]} (${s.top_offender[1]})`);
    console.log(`  By tool:`);
    for (const [tool, n] of s.byTool) console.log(`    ${n.toString().padStart(4)} | ${tool}`);
    console.log(`  Top reasons:`);
    for (const [reason, n] of s.byReason.slice(0, 8)) console.log(`    ${n.toString().padStart(4)} | ${reason}`);
  } else if (cmd === "tail") {
    const limit = parseInt(process.argv[3] || "20");
    for (const e of recentFailures({ sinceMinutes: 60 * 24 * 7, limit })) {
      console.log(`${e.ts} [${e.tool}] ${e.error?.slice(0, 80) || "(no error msg)"}`);
    }
  } else {
    console.error("Usage: node scripts/factory/tool-failure-tracker.mjs summary [minutes]");
    console.error("       node scripts/factory/tool-failure-tracker.mjs tail [limit]");
    process.exit(2);
  }
}
