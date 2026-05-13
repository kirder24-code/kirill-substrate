import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { evaluateRevenueGate } from "./revenue-gate.mjs";

function tempLog(entries) {
  const dir = mkdtempSync(join(tmpdir(), "revenue-gate-"));
  const logPath = join(dir, "outreach-log.json");
  writeFileSync(logPath, JSON.stringify(entries, null, 2), "utf-8");
  return { dir, logPath };
}

test("revenue gate fails when only dry-run delivery failure exists", () => {
  const { dir, logPath } = tempLog([{
    log_id: "failed-1",
    action_type: "approved_outreach_artifact",
    approved_at: "2026-05-10T18:00:00.000Z",
    logged_at: "2026-05-10T18:01:00.000Z",
    delivery_status: "delivery_failed",
    provider_response: { ok: false, error_code: "DRY_RUN_NO_EXTERNAL_SEND" },
  }]);
  try {
    const result = evaluateRevenueGate({
      logPath,
      now: new Date("2026-05-11T18:00:00.000Z"),
    });
    assert.equal(result.ok, false);
    assert.equal(result.latest_failure.provider_response.error_code, "DRY_RUN_NO_EXTERNAL_SEND");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("revenue gate passes on recent manual confirmed approved outreach", () => {
  const { dir, logPath } = tempLog([{
    log_id: "sent-1",
    action_type: "approved_outreach_artifact",
    approved_at: "2026-05-10T18:00:00.000Z",
    sent_at: "2026-05-10T18:03:00.000Z",
    message_id: "manual-1",
    delivery_status: "manual_confirmed",
    manual_confirmation: "Kirill sent it.",
  }]);
  try {
    const result = evaluateRevenueGate({
      logPath,
      now: new Date("2026-05-11T18:00:00.000Z"),
    });
    assert.equal(result.ok, true);
    assert.equal(result.success_log_id, "sent-1");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

