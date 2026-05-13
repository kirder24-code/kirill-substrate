/**
 * scripts/survival/boot-cortex-bounded.mjs
 *
 * First end-to-end boot of cortex-launcher. Per ARCHITECTURE.md the
 * launcher has never run the full 11 phases together with verification.
 * This wrapper:
 *   - Sets verbose logging
 *   - Sets abort_on_phase_fail = false so we get a full per-phase report
 *     instead of stopping at the first crash
 *   - Captures everything to .data/cortex-boot-attempt-<ts>.md
 *   - Times out after 5 minutes total
 *   - Does NOT keep modules running after — exits process
 *
 * Run: node scripts/survival/boot-cortex-bounded.mjs
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const REPORT_DIR = resolve(ROOT, ".data");
const REPORT_PATH = resolve(REPORT_DIR, `cortex-boot-attempt-${Date.now()}.md`);

const TIMEOUT_MS = 5 * 60_000;

let lines = [];
function out(s) { lines.push(String(s)); console.log(String(s)); }

const start = Date.now();
const timeoutId = setTimeout(() => {
  out(`\n=== TIMEOUT after ${TIMEOUT_MS / 1000}s ===`);
  saveReport({ aborted_by_timeout: true });
  process.exit(2);
}, TIMEOUT_MS);
timeoutId.unref?.();

function saveReport(extra = {}) {
  if (!existsSync(REPORT_DIR)) mkdirSync(REPORT_DIR, { recursive: true });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const header = [
    `# Cortex Launcher Boot Attempt`,
    ``,
    `started: ${new Date(start).toISOString()}`,
    `elapsed_seconds: ${elapsed}`,
    `extra: ${JSON.stringify(extra)}`,
    ``,
    `---`,
    ``,
  ].join("\n");
  writeFileSync(REPORT_PATH, header + lines.join("\n"));
  console.error(`\nReport saved: ${REPORT_PATH}`);
}

out(`Booting cortex-launcher in bounded mode (timeout ${TIMEOUT_MS / 1000}s, abort_on_phase_fail=false)`);
out(`Time: ${new Date().toISOString()}\n`);

let result;
try {
  const launcher = await import("../cortex/cortex-launcher.mjs");
  result = await launcher.launch({ verbose: true, abort_on_phase_fail: false });
} catch (e) {
  out(`\nFATAL launcher import/launch: ${e?.message || e}`);
  out(`stack: ${e?.stack?.slice(0, 2000) || "(no stack)"}`);
  saveReport({ fatal_top_level: true });
  process.exit(1);
}

clearTimeout(timeoutId);

out(`\n=== BOOT FINISHED ===`);
out(`modules_registered: ${result.total_modules_registered}`);
out(`failures: ${result.total_failures}`);
out(`phases_attempted: ${result.phases.length}`);
out(`aborted: ${result.aborted ? "YES at phase " + result.aborted_at_phase : "no"}`);
out(`inherited_session: ${result.inherited_session}`);

out(`\n## Per-phase summary\n`);
for (const p of result.phases) {
  const failed = p.modules.filter(m => !m.ok);
  const verifyStatus = p.verify
    ? (p.verify.verified === false ? `VERIFY FAIL: ${p.verify.error || "unknown"}` : "verify ok")
    : "no verify step";
  out(`- Phase ${p.phase} (${p.name}): ${p.modules.length} modules, ${failed.length} failed, ${verifyStatus}`);
  for (const f of failed) out(`  - FAIL: ${f.module} — ${(f.error || "").slice(0, 200)}`);
}

saveReport({ summary: { modules_registered: result.total_modules_registered, failures: result.total_failures } });
process.exit(0);
