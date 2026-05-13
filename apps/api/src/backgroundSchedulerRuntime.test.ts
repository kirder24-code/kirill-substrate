import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AutonomousSchedulerTickResult } from "@linkedin-brand-os/shared";
import {
  BackgroundSchedulerRuntime,
  createBackgroundSchedulerRuntimeFromEnv
} from "./backgroundSchedulerRuntime";

describe("BackgroundSchedulerRuntime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("can start and stop cleanly without browser dependencies", async () => {
    const tickAutonomousScheduler = vi.fn<
      (now?: string) => Promise<AutonomousSchedulerTickResult>
    >().mockResolvedValue({
      evaluatedAt: "2026-03-16T00:00:00.000Z",
      dueWatchlistIds: [],
      skippedWatchlistIds: [],
      runs: []
    });
    const runtime = new BackgroundSchedulerRuntime({
      orchestrator: { tickAutonomousScheduler },
      enabled: true,
      intervalMs: 1_000
    });

    runtime.start();
    expect(runtime.getStatus()).toEqual(
      expect.objectContaining({
        enabled: true,
        running: true,
        intervalMs: 1_000,
        isTickInFlight: false
      })
    );

    await runtime.stop();
    expect(runtime.getStatus().running).toBe(false);
  });

  it("invokes the scheduler seam on interval", async () => {
    const tickAutonomousScheduler = vi.fn<
      (now?: string) => Promise<AutonomousSchedulerTickResult>
    >().mockResolvedValue({
      evaluatedAt: "2026-03-16T00:00:00.000Z",
      dueWatchlistIds: ["auto-watch-1"],
      skippedWatchlistIds: [],
      runs: []
    });
    const runtime = new BackgroundSchedulerRuntime({
      orchestrator: { tickAutonomousScheduler },
      enabled: true,
      intervalMs: 1_000
    });

    runtime.start();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(tickAutonomousScheduler).toHaveBeenCalledTimes(1);
    expect(runtime.getStatus().lastTickOutcome).toEqual({
      status: "completed",
      runCount: 0,
      dueWatchlistCount: 1
    });
  });

  it("prevents overlapping ticks inside one process", async () => {
    let resolveTick: (() => void) | undefined;
    const tickAutonomousScheduler = vi.fn<
      (now?: string) => Promise<AutonomousSchedulerTickResult>
    >(
      () =>
        new Promise((resolve) => {
          resolveTick = () =>
            resolve({
              evaluatedAt: "2026-03-16T00:00:00.000Z",
              dueWatchlistIds: ["auto-watch-1"],
              skippedWatchlistIds: [],
              runs: []
            });
        })
    );
    const runtime = new BackgroundSchedulerRuntime({
      orchestrator: { tickAutonomousScheduler },
      enabled: true,
      intervalMs: 1_000
    });

    runtime.start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(runtime.getStatus().isTickInFlight).toBe(true);

    await vi.advanceTimersByTimeAsync(3_000);
    expect(tickAutonomousScheduler).toHaveBeenCalledTimes(1);

    resolveTick?.();
    await runtime.stop();
    await vi.runOnlyPendingTimersAsync();
    expect(runtime.getStatus().isTickInFlight).toBe(false);
  });

  it("can be disabled by config", async () => {
    const tickAutonomousScheduler = vi.fn<
      (now?: string) => Promise<AutonomousSchedulerTickResult>
    >();
    const runtime = createBackgroundSchedulerRuntimeFromEnv(
      { tickAutonomousScheduler },
      {
        LBO_AUTONOMY_RUNTIME_ENABLED: "false",
        LBO_AUTONOMY_RUNTIME_INTERVAL_MS: "2500"
      }
    );

    runtime.start();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(tickAutonomousScheduler).not.toHaveBeenCalled();
    expect(runtime.getStatus()).toEqual(
      expect.objectContaining({
        enabled: false,
        running: false,
        intervalMs: 2500
      })
    );
  });

  it("surfaces runtime failures safely in status", async () => {
    const tickAutonomousScheduler = vi.fn<
      (now?: string) => Promise<AutonomousSchedulerTickResult>
    >().mockRejectedValue(new Error("scheduler exploded"));
    const runtime = new BackgroundSchedulerRuntime({
      orchestrator: { tickAutonomousScheduler },
      enabled: true,
      intervalMs: 1_000
    });

    await expect(runtime.tick()).rejects.toThrow("scheduler exploded");
    expect(runtime.getStatus().lastTickOutcome).toEqual({
      status: "failed",
      errorSummary: "scheduler exploded"
    });
  });
});
