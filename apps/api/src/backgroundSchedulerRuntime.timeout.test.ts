import { describe, expect, it, vi } from "vitest";
import { BackgroundSchedulerRuntime } from "./backgroundSchedulerRuntime";
import type { OrchestratorService } from "@linkedin-brand-os/orchestrator";

describe("BackgroundSchedulerRuntime timeout behavior", () => {
  it("completes tick with error status when OpenAI provider times out instead of hanging indefinitely", async () => {
    const slowTick = vi.fn<OrchestratorService["tickAutonomousScheduler"]>().mockImplementation(() => {
      return new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error("OpenAI API request for enrichScoutOutput timed out after 30000ms."));
        }, 50);
      });
    });

    const runtime = new BackgroundSchedulerRuntime({
      orchestrator: { tickAutonomousScheduler: slowTick },
      enabled: true,
      intervalMs: 60000,
      now: () => Date.parse("2026-03-17T12:00:00.000Z")
    });

    await expect(runtime.tick()).rejects.toThrow(
      /OpenAI API request for enrichScoutOutput timed out after 30000ms/
    );

    const status = runtime.getStatus();
    expect(status.lastTickOutcome).toEqual({
      status: "failed",
      errorSummary: "OpenAI API request for enrichScoutOutput timed out after 30000ms."
    });
    expect(status.lastTickStartedAt).toBe("2026-03-17T12:00:00.000Z");
    expect(status.lastTickCompletedAt).toBe("2026-03-17T12:00:00.000Z");
    expect(status.isTickInFlight).toBe(false);
  });

  it("completes tick successfully when provider responds quickly", async () => {
    const fastTick = vi.fn<OrchestratorService["tickAutonomousScheduler"]>().mockResolvedValue({
      evaluatedAt: "2026-03-17T12:00:00.000Z",
      dueWatchlistIds: ["watch-1"],
      skippedWatchlistIds: [],
      processedSignalIds: [],
      skippedSignalIds: [],
      runs: [
        {
          id: "auto-run-1",
          watchlistId: "watch-1",
          triggerType: "scheduler" as const,
          runType: "watchlist_scout_feed" as const,
          status: "completed" as const,
          startedAt: "2026-03-17T12:00:00.000Z",
          completedAt: "2026-03-17T12:00:03.000Z",
          createdAt: "2026-03-17T12:00:00.000Z",
          updatedAt: "2026-03-17T12:00:03.000Z"
        }
      ]
    });

    const runtime = new BackgroundSchedulerRuntime({
      orchestrator: { tickAutonomousScheduler: fastTick },
      enabled: true,
      intervalMs: 60000,
      now: () => Date.parse("2026-03-17T12:00:00.000Z")
    });

    const result = await runtime.tick();

    expect(result).toMatchObject({
      runs: expect.arrayContaining([
        expect.objectContaining({ id: "auto-run-1", status: "completed" })
      ]),
      dueWatchlistIds: ["watch-1"]
    });

    const status = runtime.getStatus();
    expect(status.lastTickOutcome).toEqual({
      status: "completed",
      runCount: 1,
      dueWatchlistCount: 1
    });
    expect(status.isTickInFlight).toBe(false);
  });

  it("prevents concurrent ticks when a tick is in flight", async () => {
    let resolveFirstTick: ((value: any) => void) | undefined;
    const slowTick = vi.fn<OrchestratorService["tickAutonomousScheduler"]>().mockImplementation(() => {
      return new Promise((resolve) => {
        resolveFirstTick = resolve as any;
      });
    });

    const runtime = new BackgroundSchedulerRuntime({
      orchestrator: { tickAutonomousScheduler: slowTick },
      enabled: true,
      intervalMs: 60000
    });

    const firstTickPromise = runtime.tick();
    expect(runtime.getStatus().isTickInFlight).toBe(true);

    const secondTickResult = await runtime.tick();
    expect(secondTickResult).toBeUndefined();

    resolveFirstTick?.({ runs: [], dueWatchlistIds: [] });
    await firstTickPromise;
    expect(runtime.getStatus().isTickInFlight).toBe(false);
  });

  it("clears isTickInFlight flag even after timeout error", async () => {
    const timeoutTick = vi.fn<OrchestratorService["tickAutonomousScheduler"]>().mockRejectedValue(
      new Error("OpenAI API request for enrichScoutOutput timed out after 30000ms.")
    );

    const runtime = new BackgroundSchedulerRuntime({
      orchestrator: { tickAutonomousScheduler: timeoutTick },
      enabled: true,
      intervalMs: 60000
    });

    expect(runtime.getStatus().isTickInFlight).toBe(false);

    await expect(runtime.tick()).rejects.toThrow(/timed out/);

    expect(runtime.getStatus().isTickInFlight).toBe(false);
  });
});
