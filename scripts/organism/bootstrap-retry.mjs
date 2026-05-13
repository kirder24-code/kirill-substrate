#!/usr/bin/env node
// organism/bootstrap-retry.mjs
// Re-run only the waves that failed during bootstrap (raw file empty or contains "Error: Reached max turns").
// Higher max-turns to give Claude room to use a tool and still answer.

import { spawn } from "node:child_process";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, totalBeliefs } from "./db.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolve(__dirname, "../..");
const CLAUDE_BIN = "$HOME/.nvm/versions/node/v22.22.2/bin/claude";

const ALL_LABELS = [
  "region-sea", "region-middle_east", "region-east_asia", "region-europe",
  "region-anglosphere", "region-latam", "region-south_asia",
  "programs", "operational",
];

function rawFile(label) { return resolve(PROJECT, `.data/organism-bootstrap-${label}-raw.txt`); }
function promptFile(label) { return resolve(PROJECT, `.data/organism-bootstrap-${label}-prompt.md`); }

function isFailed(label) {
  const f = rawFile(label);
  if (!existsSync(f)) return true;
  const content = readFileSync(f, "utf-8").trim();
  if (!content) return true;
  if (content.includes("Reached max turns")) return true;
  // Check if there's a parseable JSON object
  const first = content.indexOf("{");
  const last = content.lastIndexOf("}");
  if (first < 0 || last <= first) return true;
  try {
    JSON.parse(content.slice(first, last + 1));
    return false;
  } catch {
    return true;
  }
}

function callClaudeAsync(label, maxTurns) {
  return new Promise((resolveDone) => {
    if (!existsSync(promptFile(label))) {
      console.error(`[retry:${label}] prompt file missing — run bootstrap-market-scan.mjs first`);
      return resolveDone(false);
    }
    const t0 = Date.now();
    console.log(`[retry:${label}] starting (max-turns=${maxTurns})...`);
    const proc = spawn("bash", ["-c",
      `cat "${promptFile(label)}" | "${CLAUDE_BIN}" -p --model claude-sonnet-4-6 --max-turns ${maxTurns} --output-format text 2>&1`
    ], { cwd: PROJECT });

    let stdout = "";
    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stdout += d.toString(); });

    const timer = setTimeout(() => { proc.kill("SIGKILL"); }, 240000);

    proc.on("close", (code) => {
      clearTimeout(timer);
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      writeFileSync(rawFile(label), stdout);
      if (code !== 0) {
        console.error(`[retry:${label}] FAILED in ${dt}s, exit=${code}`);
        return resolveDone(false);
      }
      // Sanity check parse
      const first = stdout.indexOf("{");
      const last = stdout.lastIndexOf("}");
      if (first < 0 || last <= first) {
        console.error(`[retry:${label}] no JSON in output (${dt}s)`);
        return resolveDone(false);
      }
      try {
        JSON.parse(stdout.slice(first, last + 1).replace(/,\s*([\]}])/g, "$1"));
        console.log(`[retry:${label}] OK in ${dt}s, ${stdout.length} chars`);
        resolveDone(true);
      } catch (e) {
        console.error(`[retry:${label}] JSON parse failed (${dt}s): ${e.message}`);
        resolveDone(false);
      }
    });
  });
}

async function main() {
  const failed = ALL_LABELS.filter(isFailed);
  console.log(`[retry] Failed waves: ${failed.length}/${ALL_LABELS.length} -> ${failed.join(", ") || "(none)"}`);

  if (failed.length === 0) {
    console.log("[retry] Nothing to retry. Run bootstrap-ingest.mjs to merge into graph.");
    return;
  }

  const results = await Promise.all(failed.map((l) => callClaudeAsync(l, 4)));
  const okCount = results.filter(Boolean).length;
  console.log(`[retry] ${okCount}/${failed.length} succeeded on retry.`);

  // Second pass for any still-failing with even higher max-turns
  const stillFailed = failed.filter((_, i) => !results[i]);
  if (stillFailed.length > 0) {
    console.log(`[retry] Second pass for ${stillFailed.length} stragglers with max-turns=6...`);
    const results2 = await Promise.all(stillFailed.map((l) => callClaudeAsync(l, 6)));
    const ok2 = results2.filter(Boolean).length;
    console.log(`[retry] Second pass: ${ok2}/${stillFailed.length} succeeded.`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
