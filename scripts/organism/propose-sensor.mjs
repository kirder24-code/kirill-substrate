#!/usr/bin/env node
// organism/propose-sensor.mjs
// The organism analyzes its own coverage and proposes new sensors (data sources)
// it would benefit from. Kirill reviews; if approved, organism asks Claude CLI to
// generate the adapter code into a proposals/ folder for manual review and merge.
//
// Subcommands:
//   analyze            — find blind spots, write proposals to sensor_proposals table
//   notify             — send the highest-priority pending proposal to Kirill
//   approve <id>       — generate adapter code stub for proposal id (writes to scripts/organism/proposed/)
//   list               — show pending proposals

import { spawn, spawnSync } from "node:child_process";
import { writeFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, recordSensorProposal, listPendingSensorProposals } from "./db.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolve(__dirname, "../..");
const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";

function callClaudeAsync(prompt, label) {
  return new Promise((resolveDone) => {
    const tmp = resolve(PROJECT, `.data/organism-sensor-${label}.tmp`);
    if (!existsSync(dirname(tmp))) mkdirSync(dirname(tmp), { recursive: true });
    writeFileSync(tmp, prompt);
    const proc = spawn("bash", ["-c", `cat "${tmp}" | "${CLAUDE_BIN}" -p --model claude-sonnet-4-6 --max-turns 4 --output-format text 2>&1`], { cwd: PROJECT });
    let stdout = "";
    proc.stdout.on("data", d => stdout += d.toString());
    proc.stderr.on("data", d => stdout += d.toString());
    const timer = setTimeout(() => proc.kill("SIGKILL"), 120000);
    proc.on("close", (code) => { clearTimeout(timer); resolveDone(code === 0 ? stdout.trim() : null); });
  });
}

function extractJson(raw) {
  let text = raw;
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (m) text = m[1];
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first < 0) throw new Error("no JSON");
  const c = text.slice(first, last + 1);
  try { return JSON.parse(c); }
  catch { return JSON.parse(c.replace(/,\s*([\]}])/g, "$1")); }
}

function buildCoverageSummary(db) {
  const sources = db.prepare(`
    SELECT source_type, COUNT(*) AS outcomes_count, MIN(observed_at) AS earliest, MAX(observed_at) AS latest
    FROM outcomes GROUP BY source_type ORDER BY outcomes_count DESC
  `).all();
  const domains = db.prepare(`
    SELECT
      SUBSTR(domain, 1, INSTR(domain || '.', '.') - 1) AS top_domain,
      COUNT(*) AS belief_count,
      AVG(weight) AS avg_weight,
      AVG(sources_count) AS avg_sources
    FROM beliefs WHERE domain IS NOT NULL
    GROUP BY top_domain
    ORDER BY belief_count DESC
  `).all();
  const verdict = db.prepare(`SELECT claim FROM beliefs WHERE domain LIKE 'verdict.%' ORDER BY last_updated DESC LIMIT 1`).get();
  return { sources, domains, verdict: verdict?.claim };
}

function analyzePrompt(coverage) {
  return `You are the organism analyzing its own sensor coverage. Identify blind spots
where the organism lacks a sensor (data source) it would benefit from.

CURRENT SOURCES IN USE:
${coverage.sources.map(s => `- ${s.source_type}: ${s.outcomes_count} outcomes (earliest ${s.earliest})`).join("\n")}

CURRENT DOMAIN COVERAGE:
${coverage.domains.map(d => `- ${d.top_domain}: ${d.belief_count} beliefs, avg weight ${d.avg_weight.toFixed(2)}, avg sources ${d.avg_sources.toFixed(1)}`).join("\n")}

CURRENT VERDICT:
${coverage.verdict || "(none)"}

Your task: Identify 2-3 BLIND SPOTS — data sources or sensor types that would meaningfully
improve the organism's grounding in reality but are not currently feeding it.

Examples of valid blind-spot proposals:
- A LinkedIn DM read-monitor sensor (LinkedIn replies / engagement patterns are not currently sensed)
- A Stripe payment events sensor (real revenue signals, currently no sensor)
- A web-search-on-grants sensor (current grant data is from training cutoff, not live)
- A reddit-DM-read sensor (we send DMs but don't track read receipts vs replies)
- A LinkedIn-post-performance sensor (we draft posts but no sensor reports their engagement back)

Each proposal must include:
- sensor_name: one-line identifier
- data_source: where the data lives (URL pattern, API name, DB path, file location)
- blind_spot_description: why the organism currently can't see this and what it costs
- expected_signals: what kind of outcomes this sensor would generate
- example_outcomes: 2-3 concrete example outcomes the sensor might produce in a typical week

Output JSON:
{
  "proposals": [
    {
      "sensor_name": "...",
      "data_source": "...",
      "blind_spot_description": "...",
      "expected_signals": "...",
      "example_outcomes": "..."
    }
  ]
}

Be honest. Don't propose sensors for things already well-covered (e.g., outreach_emails has 600+ rows already).
CRITICAL: Output ONLY JSON.`;
}

async function analyzeCmd() {
  const db = openDb();
  const coverage = buildCoverageSummary(db);
  console.log("[propose-sensor] analyzing coverage gaps...");
  const raw = await callClaudeAsync(analyzePrompt(coverage), "analyze");
  if (!raw) { console.error("[propose-sensor] no output"); db.close(); return; }
  let parsed;
  try { parsed = extractJson(raw); }
  catch (e) { console.error(`[propose-sensor] parse failed: ${e.message}`); db.close(); return; }
  const props = parsed.proposals || [];
  console.log(`[propose-sensor] Claude proposed ${props.length} sensors`);
  for (const p of props) {
    if (!p.sensor_name || !p.data_source) continue;
    const exists = db.prepare("SELECT id FROM sensor_proposals WHERE sensor_name = ? AND status = 'pending'").get(p.sensor_name);
    if (exists) { console.log(`  skip duplicate: ${p.sensor_name}`); continue; }
    const id = recordSensorProposal(db, {
      sensor_name: p.sensor_name,
      data_source: p.data_source,
      blind_spot_description: p.blind_spot_description || "(no description)",
      expected_signals: p.expected_signals || null,
      example_outcomes: p.example_outcomes || null,
    });
    console.log(`  recorded #${id}: ${p.sensor_name}`);
  }
  db.close();
}

async function notifyCmd() {
  const db = openDb();
  const pending = listPendingSensorProposals(db, { limit: 1 });
  if (pending.length === 0) { console.log("[propose-sensor-notify] no pending"); db.close(); return; }
  const p = pending[0];

  // Don't re-notify
  const stateFile = resolve(PROJECT, ".data/organism-propose-sensor-state.json");
  let state = {};
  try { if (existsSync(stateFile)) state = JSON.parse(readFileSync(stateFile, "utf-8")); } catch {}
  if (state[`s${p.id}`]) { console.log(`[propose-sensor-notify] #${p.id} already notified`); db.close(); return; }

  const text = `🛰️ <b>Предлагаю новый сенсор #${p.id}</b>\n\n<b>Имя:</b> <code>${p.sensor_name}</code>\n<b>Источник:</b> ${p.data_source.slice(0, 200)}\n\n<b>Слепое пятно:</b> ${p.blind_spot_description.slice(0, 400)}\n\n<b>Что будем видеть:</b> ${(p.expected_signals || "n/a").slice(0, 250)}\n\nОтветь "approve sensor ${p.id}" для генерации стаба адаптера в proposed/, или "reject sensor ${p.id} причина".`;
  const speakScript = resolve(__dirname, "organism-telegram.mjs");
  const r = spawnSync("node", [speakScript, "speak-stdin"], { input: text, encoding: "utf-8" });
  if (r.status === 0) {
    console.log(`[propose-sensor-notify] sent #${p.id}`);
    state[`s${p.id}`] = new Date().toISOString();
    writeFileSync(stateFile, JSON.stringify(state, null, 2));
  } else {
    console.error(`[propose-sensor-notify] send failed: ${r.stdout || r.stderr}`);
  }
  db.close();
}

const ADAPTER_GEN_PROMPT = `You generate a Node.js adapter file for an organism sensor proposal.

The adapter MUST follow this template structure:
- Read-only access to the data source (never mutate)
- Idempotent via deterministic source_ref
- Skip if outcome with the same source_ref already exists
- Use openDb() and recordOutcome() from "./db.mjs"
- Output to scripts/organism/proposed/<sensor_name>.mjs (the user reviews before promoting to active)

Reference adapter (ingest-conversations.mjs):

\`\`\`js
import Database from "node:better-sqlite3";
import { openDb, recordOutcome } from "./db.mjs";

function existsRef(db, ref) {
  return !!db.prepare("SELECT id FROM outcomes WHERE source_ref = ?").get(ref);
}

function ingest(orgDb, ...) {
  // ... query the source ...
  for (const row of rows) {
    const ref = \`<sensor_name>/\${row.id}\`;
    if (existsRef(orgDb, ref)) continue;
    recordOutcome(orgDb, { source_type, source_ref, signal_type, signal_value, description, related_action_type, related_target, observed_at });
  }
}
\`\`\`

Now generate the adapter for:

PROPOSAL:
{{PROPOSAL}}

CRITICAL:
- Output ONLY the .mjs file content, no prose.
- Add a clear top comment block describing what it does.
- Include error handling but never crash on missing source.
- Provide --dry-run flag.
- The output goes into scripts/organism/proposed/ — clearly mark it as un-vetted.`;

async function approveCmd(id) {
  const db = openDb();
  const numId = parseInt(id, 10);
  const p = db.prepare("SELECT * FROM sensor_proposals WHERE id = ?").get(numId);
  if (!p) { console.error(`no proposal #${numId}`); db.close(); return; }

  const proposedDir = resolve(PROJECT, "scripts/organism/proposed");
  if (!existsSync(proposedDir)) mkdirSync(proposedDir, { recursive: true });

  const prompt = ADAPTER_GEN_PROMPT.replace("{{PROPOSAL}}", JSON.stringify(p, null, 2));
  console.log(`[propose-sensor-approve] generating adapter code for #${numId} (${p.sensor_name})...`);

  const code = await callClaudeAsync(prompt, `gen-${p.sensor_name}`);
  if (!code) { console.error(`code generation failed`); db.close(); return; }
  // Strip code fences
  let clean = code.replace(/^```(?:js|javascript|mjs)?\s*/, "").replace(/```$/, "").trim();
  const outFile = resolve(proposedDir, `${p.sensor_name.replace(/[^a-z0-9_]/gi, "_")}.mjs`);
  writeFileSync(outFile, clean);

  db.prepare(`UPDATE sensor_proposals SET status = 'code_generated', reviewed_at = datetime('now'), notes = ? WHERE id = ?`).run(`Generated to ${outFile}`, numId);
  console.log(`[propose-sensor-approve] wrote ${outFile} (${clean.length} chars). REVIEW BEFORE RUNNING.`);
  db.close();
}

function listCmd() {
  const db = openDb();
  const pending = listPendingSensorProposals(db, { limit: 20 });
  console.log(`=== ${pending.length} pending sensor proposals ===`);
  for (const p of pending) {
    console.log(`#${p.id}: ${p.sensor_name}`);
    console.log(`   source: ${p.data_source}`);
    console.log(`   gap: ${p.blind_spot_description.slice(0, 120)}`);
  }
  db.close();
}

const cmd = process.argv[2];
const arg = process.argv[3];
(async () => {
  if (cmd === "analyze") await analyzeCmd();
  else if (cmd === "notify") await notifyCmd();
  else if (cmd === "approve") await approveCmd(arg);
  else if (cmd === "list") listCmd();
  else { console.error("Usage: analyze | notify | approve <id> | list"); process.exit(1); }
})();
