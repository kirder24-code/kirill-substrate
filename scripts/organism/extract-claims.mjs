#!/usr/bin/env node
// organism/extract-claims.mjs
// Extracts confident claims from a blob of text (typically Claude's recent output).
// Uses Claude CLI as the parser. Recorded claims will later be auto-resolved by
// matching outcomes via apply-outcomes-to-graph.mjs.
//
// Usage:
//   echo "$(cat my-recent-response.txt)" | node scripts/organism/extract-claims.mjs --stdin
//   node scripts/organism/extract-claims.mjs --file=path/to/text.md
//
// Stop hook integration (in .claude/hooks/stop-extract-claims.sh):
//   tail -n 200 .claude/transcript.log | node scripts/organism/extract-claims.mjs --stdin

import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, recordClaim } from "./db.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolve(__dirname, "../..");
const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";

function parseFlags(argv) {
  const out = { file: null, stdin: false, sessionMarker: null, dryRun: false };
  for (const a of argv.slice(2)) {
    if (a.startsWith("--file=")) out.file = a.slice(7);
    else if (a === "--stdin") out.stdin = true;
    else if (a.startsWith("--session=")) out.sessionMarker = a.slice(10);
    else if (a === "--dry-run") out.dryRun = true;
  }
  return out;
}

async function readStdinText() {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

const EXTRACT_PROMPT = `Extract confident assertions about the world from the following text.
A "claim" is a falsifiable statement Claude (or the assistant author) made with confidence about
how something works (markets, channels, prospects, system behavior, future outcomes).

Examples of valid claims:
- "Cold email to US SaaS founders will yield ~0% reply rate"
- "Singapore is a higher-EV market than UK for solo AI consultants"
- "Reddit comment-first converts 5-10x better than cold DM"

Examples to SKIP:
- Questions, hedges ("maybe", "could be"), conditionals
- Code-level facts ("the schema has 7 tables")
- Process descriptions ("I will run the script")

Output JSON:
{
  "claims": [
    {"claim_text": "...", "domain": "operational.outreach.coldemail", "asserted_weight": 0.75},
    ...
  ]
}

Domain: dotted hierarchy like operational.<area>.<topic> or market.<country>.<dimension>.
Weight: how confident the assertion sounded (0.5 = hedged, 0.75 = clear, 0.9 = emphatic).

If no real claims, return {"claims": []}. CRITICAL: Output ONLY the JSON object.

TEXT TO ANALYZE:
---
`;

function callClaudeAsync(text) {
  return new Promise((resolve) => {
    const proc = spawn("bash", ["-c", `"${CLAUDE_BIN}" -p --model claude-sonnet-4-6 --max-turns 4 --output-format text 2>&1`], {
      cwd: PROJECT,
    });
    proc.stdin.write(EXTRACT_PROMPT + text.slice(0, 12000) + "\n---\nGenerate JSON now.");
    proc.stdin.end();

    let stdout = "";
    proc.stdout.on("data", d => stdout += d.toString());
    proc.stderr.on("data", d => stdout += d.toString());
    const timer = setTimeout(() => proc.kill("SIGKILL"), 90000);
    proc.on("close", () => {
      clearTimeout(timer);
      resolve(stdout.trim());
    });
  });
}

function extractJson(raw) {
  let text = raw;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1];
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first < 0) throw new Error("no JSON");
  const candidate = text.slice(first, last + 1);
  try { return JSON.parse(candidate); }
  catch { return JSON.parse(candidate.replace(/,\s*([\]}])/g, "$1")); }
}

async function main() {
  const flags = parseFlags(process.argv);
  let text;
  if (flags.stdin) text = await readStdinText();
  else if (flags.file) text = readFileSync(flags.file, "utf-8");
  else {
    console.error("Usage: --stdin | --file=path  [--session=marker] [--dry-run]");
    process.exit(1);
  }

  if (!text.trim()) {
    console.log("[extract-claims] empty text — nothing to do");
    return;
  }
  if (text.length < 200) {
    console.log("[extract-claims] text too short to contain meaningful claims (<200 chars)");
    return;
  }

  console.log(`[extract-claims] analyzing ${text.length} chars via Claude CLI...`);
  const raw = await callClaudeAsync(text);
  if (!raw) { console.error("[extract-claims] no output"); return; }

  let parsed;
  try { parsed = extractJson(raw); }
  catch (e) { console.error(`[extract-claims] parse error: ${e.message}`); return; }

  const claims = parsed.claims || [];
  if (claims.length === 0) { console.log("[extract-claims] no claims found"); return; }

  if (flags.dryRun) {
    for (const c of claims) {
      console.log(`  [dry] ${c.claim_text} (domain=${c.domain}, w=${c.asserted_weight})`);
    }
    return;
  }

  const db = openDb();
  let n = 0;
  for (const c of claims) {
    if (!c.claim_text) continue;
    const id = recordClaim(db, {
      claim_text: c.claim_text,
      domain: c.domain || null,
      asserted_weight: typeof c.asserted_weight === "number" ? c.asserted_weight : null,
      session_marker: flags.sessionMarker || null,
      context: `auto-extracted from response on ${new Date().toISOString().slice(0, 19)}`,
    });
    console.log(`  recorded #${id}: ${c.claim_text.slice(0, 100)}`);
    n++;
  }
  db.close();
  console.log(`[extract-claims] recorded ${n} claims`);
}

main().catch((e) => { console.error("[extract-claims] FAILED:", e.message); process.exit(1); });
