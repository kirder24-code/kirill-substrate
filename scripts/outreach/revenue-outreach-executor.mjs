/**
 * Minimal revenue-facing executor.
 *
 * Contract:
 * approved_outreach_artifact -> delivery adapter -> .data/outreach-log.json
 *
 * The fallback adapter never pretends to send. It either records an explicit
 * manual confirmation as sent, or records a machine-readable delivery failure.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const DEFAULT_DATA_DIR = resolve(ROOT, ".data");

const ARTIFACTS_FILE = "approved-outreach-artifacts.json";
const OUTREACH_LOG_FILE = "outreach-log.json";
const ACTION_TYPE = "approved_outreach_artifact";
const DEFAULT_FOLLOWUP_HOURS = 48;

function nowIso() {
  return new Date().toISOString();
}

function isoHoursFromNow(hours) {
  const d = new Date();
  d.setHours(d.getHours() + hours);
  return d.toISOString();
}

function dataDirFromOptions(options = {}) {
  return resolve(options.dataDir || process.env.OUTREACH_DATA_DIR || DEFAULT_DATA_DIR);
}

function filePath(dataDir, name) {
  return resolve(dataDir, name);
}

function readJsonArray(path) {
  if (!existsSync(path)) return [];
  const parsed = JSON.parse(readFileSync(path, "utf-8"));
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.items)) return parsed.items;
  if (Array.isArray(parsed.artifacts)) return parsed.artifacts;
  if (Array.isArray(parsed.entries)) return parsed.entries;
  throw new Error(`Expected JSON array or array wrapper in ${path}`);
}

function writeJson(path, value) {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", "utf-8");
}

function required(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing required field: ${name}`);
  }
  return value.trim();
}

function normalizeArtifact(input) {
  const artifact = { ...input };
  artifact.action_type = artifact.action_type || ACTION_TYPE;
  if (artifact.action_type !== ACTION_TYPE) {
    throw new Error(`Unsupported action_type: ${artifact.action_type}`);
  }

  const leadOrCandidate = artifact.lead_id || artifact.candidate_id;
  required(leadOrCandidate, "lead_id or candidate_id");
  artifact.lead_id = artifact.lead_id || null;
  artifact.candidate_id = artifact.candidate_id || null;
  artifact.channel = required(artifact.channel, "channel");
  artifact.approved_at = required(artifact.approved_at, "approved_at");
  artifact.artifact_id = artifact.artifact_id || `outreach-${Date.now()}`;
  artifact.body = required(artifact.body || artifact.message || artifact.draft_body, "body");
  artifact.subject = artifact.subject || null;
  artifact.recipient = artifact.recipient || artifact.to || null;
  artifact.business_signal = artifact.business_signal || null;
  artifact.next_followup_at = artifact.next_followup_at || isoHoursFromNow(DEFAULT_FOLLOWUP_HOURS);
  return artifact;
}

function loadArtifactById(dataDir, artifactId) {
  const artifacts = readJsonArray(filePath(dataDir, ARTIFACTS_FILE));
  const found = artifacts.find((item) => item.artifact_id === artifactId || item.id === artifactId);
  if (!found) throw new Error(`Artifact not found: ${artifactId}`);
  return found;
}

export function createApprovedOutreachArtifact(input, options = {}) {
  const dataDir = dataDirFromOptions(options);
  const artifact = normalizeArtifact(input);
  artifact.created_at = artifact.created_at || nowIso();

  const path = filePath(dataDir, ARTIFACTS_FILE);
  const artifacts = readJsonArray(path);
  artifacts.push(artifact);
  writeJson(path, artifacts);

  return artifact;
}

export function executeApprovedOutreachArtifact(input, options = {}) {
  const dataDir = dataDirFromOptions(options);
  const artifact = normalizeArtifact(
    typeof input === "string" ? loadArtifactById(dataDir, input) : input,
  );

  const manualConfirmation = options.manualConfirmation || artifact.manual_confirmation || "";
  const dryRun = options.dryRun === true || artifact.delivery_mode === "dry_run";
  const logPath = filePath(dataDir, OUTREACH_LOG_FILE);
  const log = readJsonArray(logPath);

  let deliveryStatus = "delivery_failed";
  let sentAt = null;
  let messageId = null;
  let providerResponse;

  if (manualConfirmation) {
    deliveryStatus = "manual_confirmed";
    sentAt = nowIso();
    messageId = `manual-${Date.now()}`;
    providerResponse = {
      adapter: "manual-confirm",
      ok: true,
      confirmation: manualConfirmation,
    };
  } else if (dryRun) {
    providerResponse = {
      adapter: "dry-run",
      ok: false,
      error_code: "DRY_RUN_NO_EXTERNAL_SEND",
      error: "Dry run executed. No external message was sent.",
    };
  } else {
    providerResponse = {
      adapter: "manual-confirm",
      ok: false,
      error_code: "DELIVERY_ADAPTER_NOT_CONFIGURED",
      error: "No live delivery adapter configured. Re-run with --manual-confirmation after operator sends it.",
    };
  }

  const entry = {
    log_id: `outreach-log-${Date.now()}-${log.length + 1}`,
    action_type: ACTION_TYPE,
    artifact_id: artifact.artifact_id,
    lead_id: artifact.lead_id,
    candidate_id: artifact.candidate_id,
    channel: artifact.channel,
    recipient: artifact.recipient,
    subject: artifact.subject,
    body: artifact.body,
    business_signal: artifact.business_signal,
    approved_at: artifact.approved_at,
    sent_at: sentAt,
    message_id: messageId,
    delivery_status: deliveryStatus,
    provider_response: providerResponse,
    manual_confirmation: manualConfirmation || null,
    next_followup_at: artifact.next_followup_at,
    logged_at: nowIso(),
  };

  log.push(entry);
  writeJson(logPath, log);
  return entry;
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      args._.push(arg);
      continue;
    }
    const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function usage() {
  console.error("Usage:");
  console.error("  node scripts/outreach/revenue-outreach-executor.mjs create --lead-id L --channel email --approved-at ISO --body BODY [--recipient x] [--subject s] [--data-dir .data]");
  console.error("  node scripts/outreach/revenue-outreach-executor.mjs execute --artifact-id ID --manual-confirmation TEXT [--data-dir .data]");
  console.error("  node scripts/outreach/revenue-outreach-executor.mjs execute --artifact-json JSON --dry-run [--data-dir .data]");
  process.exit(1);
}

function artifactFromArgs(args) {
  if (args.artifactJson) return JSON.parse(args.artifactJson);
  return {
    artifact_id: args.artifactId,
    lead_id: args.leadId,
    candidate_id: args.candidateId,
    channel: args.channel,
    approved_at: args.approvedAt,
    recipient: args.recipient || args.to,
    subject: args.subject,
    body: args.body,
    business_signal: args.businessSignal,
    next_followup_at: args.nextFollowupAt,
    delivery_mode: args.dryRun ? "dry_run" : undefined,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (!command) usage();

  if (command === "create") {
    const artifact = createApprovedOutreachArtifact(artifactFromArgs(args), {
      dataDir: typeof args.dataDir === "string" ? args.dataDir : undefined,
    });
    console.log(JSON.stringify({ ok: true, artifact }, null, 2));
    return;
  }

  if (command === "execute") {
    const input = args.artifactId && !args.artifactJson ? args.artifactId : artifactFromArgs(args);
    const entry = executeApprovedOutreachArtifact(input, {
      dataDir: typeof args.dataDir === "string" ? args.dataDir : undefined,
      dryRun: args.dryRun === true,
      manualConfirmation: typeof args.manualConfirmation === "string" ? args.manualConfirmation : "",
    });
    console.log(JSON.stringify({ ok: entry.delivery_status !== "delivery_failed", entry }, null, 2));
    return;
  }

  usage();
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main();
}
