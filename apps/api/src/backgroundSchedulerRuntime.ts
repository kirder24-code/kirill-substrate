import type {
  AutonomousRun,
  AutonomousSchedulerTickResult
} from "@linkedin-brand-os/shared";
import type { OrchestratorService } from "@linkedin-brand-os/orchestrator";

export interface BackgroundSchedulerRuntimeStatus {
  enabled: boolean;
  running: boolean;
  intervalMs: number;
  isTickInFlight: boolean;
  lastTickStartedAt?: string;
  lastTickCompletedAt?: string;
  lastTickOutcome?:
    | {
        status: "completed";
        runCount: number;
        dueWatchlistCount: number;
      }
    | {
        status: "failed";
        errorSummary: string;
      };
}

export interface BackgroundSchedulerRuntimeOptions {
  orchestrator: Pick<OrchestratorService, "tickAutonomousScheduler">;
  enabled: boolean;
  intervalMs: number;
  now?: () => number;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}

export class BackgroundSchedulerRuntime {
  private readonly orchestrator: Pick<OrchestratorService, "tickAutonomousScheduler">;
  private readonly enabled: boolean;
  private readonly intervalMs: number;
  private readonly now: () => number;
  private readonly setIntervalFn: typeof setInterval;
  private readonly clearIntervalFn: typeof clearInterval;
  private timer: ReturnType<typeof setInterval> | null = null;
  private isTickInFlight = false;
  private lastTickStartedAt?: string;
  private lastTickCompletedAt?: string;
  private lastTickOutcome?: BackgroundSchedulerRuntimeStatus["lastTickOutcome"];

  constructor(options: BackgroundSchedulerRuntimeOptions) {
    this.orchestrator = options.orchestrator;
    this.enabled = options.enabled;
    this.intervalMs = options.intervalMs;
    this.now = options.now ?? Date.now;
    this.setIntervalFn = options.setIntervalFn ?? setInterval;
    this.clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  }

  start(): void {
    if (!this.enabled || this.timer) {
      return;
    }

    this.timer = this.setIntervalFn(() => {
      void this.tick();
    }, this.intervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      this.clearIntervalFn(this.timer);
      this.timer = null;
    }
  }

  async tick(): Promise<AutonomousSchedulerTickResult | undefined> {
    if (!this.enabled || this.isTickInFlight) {
      return undefined;
    }

    this.isTickInFlight = true;
    this.lastTickStartedAt = new Date(this.now()).toISOString();

    try {
      const result = await this.orchestrator.tickAutonomousScheduler(
        this.lastTickStartedAt
      );
      this.lastTickCompletedAt = new Date(this.now()).toISOString();
      this.lastTickOutcome = {
        status: "completed",
        runCount: result.runs.length,
        dueWatchlistCount: result.dueWatchlistIds.length
      };
      return result;
    } catch (error) {
      this.lastTickCompletedAt = new Date(this.now()).toISOString();
      this.lastTickOutcome = {
        status: "failed",
        errorSummary: error instanceof Error ? error.message : "Scheduler tick failed."
      };
      throw error;
    } finally {
      this.isTickInFlight = false;
    }
  }

  getStatus(): BackgroundSchedulerRuntimeStatus {
    return {
      enabled: this.enabled,
      running: this.timer !== null,
      intervalMs: this.intervalMs,
      isTickInFlight: this.isTickInFlight,
      lastTickStartedAt: this.lastTickStartedAt,
      lastTickCompletedAt: this.lastTickCompletedAt,
      lastTickOutcome: this.lastTickOutcome
    };
  }
}

export interface BackgroundSchedulerRuntimeEnv {
  LBO_AUTONOMY_RUNTIME_ENABLED?: string;
  LBO_AUTONOMY_RUNTIME_INTERVAL_MS?: string;
}

export function createBackgroundSchedulerRuntimeFromEnv(
  orchestrator: Pick<OrchestratorService, "tickAutonomousScheduler">,
  env: BackgroundSchedulerRuntimeEnv = process.env
): BackgroundSchedulerRuntime {
  return new BackgroundSchedulerRuntime({
    orchestrator,
    enabled: env.LBO_AUTONOMY_RUNTIME_ENABLED === "true",
    intervalMs: parsePositiveNumber(env.LBO_AUTONOMY_RUNTIME_INTERVAL_MS) ?? 60_000
  });
}

function parsePositiveNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
