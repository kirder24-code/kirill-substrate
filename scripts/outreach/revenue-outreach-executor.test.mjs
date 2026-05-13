import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  createApprovedOutreachArtifact,
  executeApprovedOutreachArtifact,
} from "./revenue-outreach-executor.mjs";

function tempDataDir() {
  return mkdtempSync(join(tmpdir(), "revenue-outreach-"));
}

test("approved artifact -> manual confirm execute -> logged external outcome", () => {
  const dataDir = tempDataDir();
  try {
    const artifact = createApprovedOutreachArtifact({
      artifact_id: "artifact-1",
      lead_id: "lead-1",
      channel: "email",
      approved_at: "2026-05-10T18:00:00.000Z",
      recipient: "owner@example.com",
      subject: "Missed-call coverage",
      body: "Short approved outreach body.",
      business_signal: "Owner says missed calls are expensive.",
    }, { dataDir });

    const entry = executeApprovedOutreachArtifact(artifact.artifact_id, {
      dataDir,
      manualConfirmation: "Kirill sent this email from Gmail.",
    });

    assert.equal(entry.action_type, "approved_outreach_artifact");
    assert.equal(entry.lead_id, "lead-1");
    assert.equal(entry.channel, "email");
    assert.equal(entry.approved_at, "2026-05-10T18:00:00.000Z");
    assert.equal(entry.delivery_status, "manual_confirmed");
    assert.ok(entry.sent_at);
    assert.ok(entry.message_id.startsWith("manual-"));
    assert.equal(entry.provider_response.ok, true);
    assert.equal(entry.manual_confirmation, "Kirill sent this email from Gmail.");
    assert.ok(entry.next_followup_at);

    const log = JSON.parse(readFileSync(join(dataDir, "outreach-log.json"), "utf-8"));
    assert.equal(log.length, 1);
    assert.equal(log[0].artifact_id, "artifact-1");
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("execute can load an approved artifact by id from the data dir", () => {
  const dataDir = tempDataDir();
  try {
    createApprovedOutreachArtifact({
      artifact_id: "artifact-from-file",
      lead_id: "lead-from-file",
      channel: "email",
      approved_at: "2026-05-10T19:00:00.000Z",
      body: "Approved body loaded from artifact store.",
    }, { dataDir });

    const entry = executeApprovedOutreachArtifact("artifact-from-file", {
      dataDir,
      manualConfirmation: "Operator sent it and confirmed delivery.",
    });

    assert.equal(entry.artifact_id, "artifact-from-file");
    assert.equal(entry.lead_id, "lead-from-file");
    assert.equal(entry.delivery_status, "manual_confirmed");
    assert.ok(entry.sent_at);
    assert.ok(entry.message_id);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("approved artifact dry-run logs machine-readable delivery failure", () => {
  const dataDir = tempDataDir();
  try {
    const entry = executeApprovedOutreachArtifact({
      artifact_id: "artifact-2",
      candidate_id: "candidate-2",
      channel: "linkedin_comment",
      approved_at: "2026-05-10T18:05:00.000Z",
      body: "Approved comment draft.",
      delivery_mode: "dry_run",
    }, { dataDir });

    assert.equal(entry.action_type, "approved_outreach_artifact");
    assert.equal(entry.candidate_id, "candidate-2");
    assert.equal(entry.delivery_status, "delivery_failed");
    assert.equal(entry.sent_at, null);
    assert.equal(entry.message_id, null);
    assert.equal(entry.provider_response.ok, false);
    assert.equal(entry.provider_response.error_code, "DRY_RUN_NO_EXTERNAL_SEND");
    assert.ok(entry.next_followup_at);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
