/**
 * scripts/survival/factory-bridge.mjs
 *
 * Read-only bridge between substrate and the federation of factory bots.
 * Two actions:
 *
 *   factory_status — pure stat. For each documented factory bot:
 *     process running? heartbeat file mtime? Aggregate into a report
 *     written to .data/factory-status.json + summary in SYSTEM-STATE
 *     section. NO LLM.
 *
 *   factory_output_ingest — scans recent factory outputs for items that
 *     could be opportunities or pain signals. Uses Claude (cheap) to
 *     classify. Surfaces interesting items into substrate's
 *     opportunity_store as state=detected (so the existing pipeline
 *     picks them up).
 *
 * Source of truth for which bots exist + where they write =
 * factory-registry.md.
 */

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

import { think } from "./llm-think.mjs";
import { createOpportunity, listAll as listOpportunities } from "./opportunity-store.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const REGISTRY_PATH = resolve(__dirname, "factory-registry.md");
const STATUS_OUT = resolve(ROOT, ".data/factory-status.json");

// Curated mapping (matches factory-registry.md). Keep this list manually
// in sync with the registry — substrate cannot rewrite this file either.
const FACTORY_BOTS = [
  { name: "research-bot-v2",       process_grep: "factory/research-bot-v2.mjs",   heartbeat: ".data/awareness/latest.md",          consumed_by: "ingest_organism_research" },
  { name: "research-bot",          process_grep: "factory/research-bot.mjs",      heartbeat: ".data/INTEL.md",                      consumed_by: "ingest_organism_research" },
  { name: "scout-bot",             process_grep: "factory/scout-bot.mjs",         heartbeat: ".data/scout-bot-diagnosis-summary.md", consumed_by: null },
  { name: "idea-bot",              process_grep: "factory/idea-bot.mjs",          heartbeat: ".data/idea-bot-last-run.json",        consumed_by: null },
  { name: "content-bot",           process_grep: "factory/content-bot.mjs",       heartbeat: ".data/content-bot-last-run.json",     consumed_by: null },
  { name: "sales-bot",             process_grep: "factory/sales-bot.mjs",         heartbeat: ".data/linkedin-brand-os.sqlite",      consumed_by: "lead_database" },
  { name: "linkedin-hunter",       process_grep: "factory/linkedin-hunter.mjs",   heartbeat: ".data/linkedin-brand-os.sqlite",      consumed_by: "lead_database" },
  { name: "telegram-sales-agent",  process_grep: "factory/telegram-sales-agent.mjs", heartbeat: ".data/linkedin-brand-os.sqlite",   consumed_by: "lead_database" },
  { name: "reddit-monitor",        process_grep: "factory/reddit-monitor.mjs",    heartbeat: ".data/reddit-replies-monitor.json",   consumed_by: "perception_feeder" },
  { name: "telegram-control",      process_grep: "factory/telegram-control.mjs",  heartbeat: ".data/organism-telegram-inbox.jsonl", consumed_by: "perception_feeder" },
  { name: "community-bot",         process_grep: "factory/community-bot.mjs",     heartbeat: null, consumed_by: null },
  { name: "service-bot",           process_grep: "factory/service-bot.mjs",       heartbeat: null, consumed_by: null },
  { name: "build-bot",             process_grep: "factory/build-bot.mjs",         heartbeat: null, consumed_by: null },
  { name: "learn-bot",             process_grep: "factory/learn-bot.mjs",         heartbeat: null, consumed_by: null },
  { name: "brief-agent",           process_grep: "factory/brief-agent.mjs",       heartbeat: null, consumed_by: null },
  { name: "evolution-bot",         process_grep: "factory/evolution-bot.mjs",     heartbeat: ".data/cortex-evolution.json", consumed_by: null },
  { name: "trend-bot",             process_grep: "factory/trend-bot.mjs",         heartbeat: null, consumed_by: null },
  { name: "pr-bot",                process_grep: "factory/pr-bot.mjs",            heartbeat: null, consumed_by: null },
  { name: "analytics-bot",         process_grep: "factory/analytics-bot.mjs",     heartbeat: null, consumed_by: null },
  { name: "healthcheck",           process_grep: "factory/healthcheck.mjs",       heartbeat: null, consumed_by: null },
  { name: "sonnet-bots-daemon",    process_grep: "factory/sonnet-bots-daemon.mjs", heartbeat: null, consumed_by: null },
  { name: "supervisor",            process_grep: "factory/supervisor.mjs",        heartbeat: null, consumed_by: null },
];

function processAlive(grep_pattern) {
  try {
    const out = execSync(`ps aux | grep -F '${grep_pattern}' | grep -v grep || true`, { encoding: "utf-8" });
    return out.trim().length > 0;
  } catch { return false; }
}

function fileMtimeAgeMin(relPath) {
  if (!relPath) return null;
  const full = resolve(ROOT, relPath);
  if (!existsSync(full)) return null;
  try { return Math.round((Date.now() - statSync(full).mtimeMs) / 60000); }
  catch { return null; }
}

function classifyHealth(alive, ageMin) {
  if (!alive) return "DEAD";
  if (ageMin === null) return "RUNNING_NO_HEARTBEAT";
  if (ageMin <= 1440) return "HEALTHY"; // within 24h
  return "STALE";
}

// --- ACTION: factory_status ---

export const factoryStatusMeta = {
  description: "Pure-stat health check on every factory bot in registry. NO LLM. Writes .data/factory-status.json.",
  side_effect_class: "auto",
  expected_signal: "factory_status_written",
  expected_signal_delay_min: 0,
  estimated_cost_usd: 0.0,
};

export async function runFactoryStatus({ strategy }) {
  const rows = FACTORY_BOTS.map(b => {
    const alive = processAlive(b.process_grep);
    const heartbeatAgeMin = fileMtimeAgeMin(b.heartbeat);
    return {
      name: b.name,
      process_alive: alive,
      heartbeat_path: b.heartbeat,
      heartbeat_age_min: heartbeatAgeMin,
      health: classifyHealth(alive, heartbeatAgeMin),
      consumed_by_substrate: b.consumed_by,
    };
  });
  const summary = {
    generated_at: new Date().toISOString(),
    total_bots: rows.length,
    healthy: rows.filter(r => r.health === "HEALTHY").length,
    stale: rows.filter(r => r.health === "STALE").length,
    dead: rows.filter(r => r.health === "DEAD").length,
    running_no_heartbeat: rows.filter(r => r.health === "RUNNING_NO_HEARTBEAT").length,
    bots: rows,
  };
  writeFileSync(STATUS_OUT, JSON.stringify(summary, null, 2));
  return {
    ok: true,
    summary: {
      total_bots: summary.total_bots,
      healthy: summary.healthy,
      stale: summary.stale,
      dead: summary.dead,
      running_no_heartbeat: summary.running_no_heartbeat,
    },
    output_file: STATUS_OUT,
  };
}

// --- ACTION: factory_output_ingest ---

const INGEST_TARGETS = [
  // path : description for LLM classifier
  { path: ".data/idea-bot-last-run.json", kind: "idea_bot_run", note: "Heartbeat-style. If contains 'ideas' field with content, propose as opportunities." },
  { path: ".data/scout-bot-diagnosis-summary.md", kind: "scout_diagnosis", note: "Scout bot's last diagnosis. May contain ICP signals worth surfacing." },
  { path: ".data/cortex-formed-goals.json", kind: "cortex_goals", note: "Goals formed by cortex modules. Substrate may want to align with them." },
  { path: ".data/INTEL.md", kind: "global_intel", note: "Hot markets and signals from research-bot. Already partially consumed." },
  { path: ".data/awareness/latest.md", kind: "awareness_brief", note: "Latest awareness brief — high-confidence research findings." },
];

export const factoryOutputIngestMeta = {
  description: "Scan recent factory bot outputs, use Claude to classify, surface novel items as opportunities in substrate.",
  side_effect_class: "auto",
  expected_signal: "factory_outputs_classified",
  expected_signal_delay_min: 0,
  estimated_cost_usd: 0.10,
};

export async function runFactoryOutputIngest({ strategy }) {
  const samples = [];
  for (const t of INGEST_TARGETS) {
    const full = resolve(ROOT, t.path);
    if (!existsSync(full)) continue;
    const ageMin = Math.round((Date.now() - statSync(full).mtimeMs) / 60000);
    if (ageMin > 60 * 24 * 7) continue; // skip > 7 days old
    let content;
    try { content = readFileSync(full, "utf-8").slice(0, 6000); }
    catch { continue; }
    samples.push({ ...t, age_min: ageMin, content });
  }
  if (samples.length === 0) return { ok: true, reason: "no_recent_factory_outputs" };

  const existingOpportunities = listOpportunities().map(o => o.title.toLowerCase());

  const sampleBlock = samples.map((s, i) =>
    `[${i + 1}] kind=${s.kind} path=${s.path} age=${s.age_min}min\n${s.note}\n--- CONTENT ---\n${s.content}\n--- END ---`
  ).join("\n\n");

  const prompt = `You are substrate scanning factory bot outputs for items worth promoting into opportunity store.

EXISTING OPPORTUNITY TITLES (do NOT propose duplicates):
${existingOpportunities.slice(0, 30).map(t => `- ${t}`).join("\n") || "(none)"}

FACTORY OUTPUT SAMPLES:
${sampleBlock}

For each sample, decide if it contains a NOVEL item worth creating an opportunity for. Only promote items that:
- Represent a concrete external signal (market, ICP, money flow, pain pattern)
- Are not already in the existing opportunity titles list above
- Have enough context to be researched further (not just 1-line heartbeat)

Output ONLY JSON array, one entry per promotion (zero entries if nothing worth promoting):
[
  {"source_kind": "<kind>", "source_path": "<path>", "title": "<short title>", "summary": "<1-3 sentences with concrete fact>"}
]
NO em dashes.`;

  const result = await think({
    prompt,
    model: "claude-sonnet-4-6",
    caller: "factory_output_ingest",
    strategy_id: strategy.id,
    max_input_tokens: 8000,
    max_output_tokens: 1500,
  });
  if (!result.ok) return { ok: false, reason: result.reason, error: result.error };

  let promotions = [];
  try {
    const m = result.output.match(/\[[\s\S]*\]/);
    promotions = m ? JSON.parse(m[0]) : [];
  } catch { promotions = []; }

  const created = [];
  for (const p of promotions) {
    if (!p.title) continue;
    const id = createOpportunity({
      title: p.title.slice(0, 200),
      source: `factory:${p.source_kind || "unknown"}`,
      source_provenance: p.source_path || "factory_output_ingest",
      seed_text: p.summary || "(no summary)",
      parent_strategy_id: strategy.id,
      notes: "auto-detected via factory_output_ingest",
    });
    created.push({ id, title: p.title });
  }

  return {
    ok: true,
    samples_scanned: samples.length,
    promotions_proposed: promotions.length,
    opportunities_created: created.length,
    created,
    llm_cost_usd: result.cost_usd,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2];
  if (cmd === "status") {
    console.log(JSON.stringify(await runFactoryStatus({ strategy: { id: "manual" } }), null, 2));
  } else if (cmd === "ingest") {
    console.log(JSON.stringify(await runFactoryOutputIngest({ strategy: { id: "manual" } }), null, 2));
  } else {
    console.log("commands: status | ingest");
  }
}
