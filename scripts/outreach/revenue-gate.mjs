/**
 * 72-hour revenue gate.
 *
 * Success means at least one approved outreach outcome has an external proof:
 * sent_at plus message_id, or explicit manual_confirmation.
 */

import { existsSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DEFAULT_LOG_PATH = resolve(ROOT, ".data/outreach-log.json");
const ACTION_TYPE = "approved_outreach_artifact";

function parseArgs(argv) {
  const args = { hours: 72, logPath: process.env.OUTREACH_LOG_PATH || DEFAULT_LOG_PATH };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--hours") {
      args.hours = Number(argv[i + 1]);
      i += 1;
    } else if (argv[i] === "--log-path") {
      args.logPath = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function loadLog(logPath) {
  if (!existsSync(logPath)) return [];
  const parsed = JSON.parse(readFileSync(logPath, "utf-8"));
  if (!Array.isArray(parsed)) throw new Error(`Expected outreach log array: ${logPath}`);
  return parsed;
}

export function evaluateRevenueGate({ logPath = DEFAULT_LOG_PATH, hours = 72, now = new Date() } = {}) {
  const log = loadLog(logPath);
  const cutoff = now.getTime() - hours * 60 * 60 * 1000;
  const approvedEntries = log.filter((entry) => entry.action_type === ACTION_TYPE);
  const recentApproved = approvedEntries.filter((entry) => {
    const t = new Date(entry.sent_at || entry.logged_at || entry.approved_at || 0).getTime();
    return Number.isFinite(t) && t >= cutoff;
  });
  const success = recentApproved.find((entry) => (
    (entry.sent_at && entry.message_id) || entry.manual_confirmation
  ));
  const latestFailure = recentApproved.findLast?.((entry) => entry.delivery_status === "delivery_failed")
    || [...recentApproved].reverse().find((entry) => entry.delivery_status === "delivery_failed")
    || null;

  return {
    ok: Boolean(success),
    window_hours: hours,
    checked_at: now.toISOString(),
    approved_entries: approvedEntries.length,
    recent_approved_entries: recentApproved.length,
    success_log_id: success?.log_id || null,
    latest_failure: latestFailure ? {
      log_id: latestFailure.log_id,
      delivery_status: latestFailure.delivery_status,
      provider_response: latestFailure.provider_response || null,
    } : null,
    reason: success
      ? "approved outreach outcome found"
      : "no approved outreach with sent_at/message_id or manual_confirmation in gate window",
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = evaluateRevenueGate(args);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main();
}

