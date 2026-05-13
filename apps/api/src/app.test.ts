import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  MiraiAdapter,
  MiraiProvider,
  MockTextProvider,
  ProviderRegistry,
  ProviderRouter
} from "@linkedin-brand-os/ai-providers";
import { SqliteDatabase } from "@linkedin-brand-os/db";
import { OrchestratorService } from "@linkedin-brand-os/orchestrator";
import { OperatorAuthService } from "./auth";
import { BackgroundSchedulerRuntime } from "./backgroundSchedulerRuntime";
import { buildApp } from "./app";

describe("API app bootstrap", () => {
  let db: SqliteDatabase;
  let dbDir: string;
  let webDistDir: string;
  const createTestOperatorAuthService = () =>
    new OperatorAuthService({
      username: "operator",
      password: "operator-pass",
      sessionTtlMs: 10 * 365 * 24 * 60 * 60 * 1000
    });

  beforeEach(async () => {
    vi.stubEnv("OPERATOR_USERNAME", "operator");
    vi.stubEnv("OPERATOR_PASSWORD", "operator-pass");
    dbDir = mkdtempSync(join(tmpdir(), "linkedin-brand-os-app-"));
    webDistDir = join(dbDir, "web-dist");
    mkdirSync(join(webDistDir, "assets"), { recursive: true });
    writeFileSync(join(webDistDir, "index.html"), "<!doctype html><html><body><div id=\"root\">Factory</div></body></html>");
    writeFileSync(join(webDistDir, "assets", "app.js"), "console.log('factory');");
    db = new SqliteDatabase({ databasePath: join(dbDir, "test.sqlite") });
    await db.initDatabase();
    await db.resetDatabase();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    db.close();
    rmSync(dbDir, { recursive: true, force: true });
  });

  it("fails startup clearly when required operator auth env config is missing", async () => {
    vi.stubEnv("OPERATOR_USERNAME", "");
    vi.stubEnv("OPERATOR_PASSWORD", "");

    await expect(buildApp({ logger: false })).rejects.toThrow(
      "Missing required operator auth config: OPERATOR_USERNAME, OPERATOR_PASSWORD"
    );
  });

  it("starts and stops the background scheduler runtime with the server lifecycle", async () => {
    vi.useFakeTimers();
    const tickAutonomousScheduler = vi.fn().mockResolvedValue({
      evaluatedAt: "2026-03-16T00:00:00.000Z",
      dueWatchlistIds: [],
      skippedWatchlistIds: [],
      runs: []
    });
    const backgroundSchedulerRuntime = new BackgroundSchedulerRuntime({
      orchestrator: { tickAutonomousScheduler },
      enabled: true,
      intervalMs: 1_000
    });

    const app = await buildApp({
      logger: false,
      orchestrator: new OrchestratorService({ db }),
      backgroundSchedulerRuntime,
      operatorAuthService: createTestOperatorAuthService()
    });

    expect(backgroundSchedulerRuntime.getStatus()).toEqual(
      expect.objectContaining({
        enabled: true,
        running: true
      })
    );

    await vi.advanceTimersByTimeAsync(1_000);
    expect(tickAutonomousScheduler).toHaveBeenCalledTimes(1);

    await app.close();
    expect(backgroundSchedulerRuntime.getStatus().running).toBe(false);
    vi.useRealTimers();
  });

  it("serves the built web app shell and static assets from the API runtime", async () => {
    const app = await buildApp({
      logger: false,
      orchestrator: new OrchestratorService({ db }),
      operatorAuthService: createTestOperatorAuthService(),
      webDistDir
    });

    const shellResponse = await app.inject({
      method: "GET",
      url: "/"
    });
    expect(shellResponse.statusCode).toBe(200);
    expect(shellResponse.headers["content-type"]).toContain("text/html");
    expect(shellResponse.body).toContain("Factory");

    const assetResponse = await app.inject({
      method: "GET",
      url: "/assets/app.js"
    });
    expect(assetResponse.statusCode).toBe(200);
    expect(assetResponse.headers["content-type"]).toContain("application/javascript");
    expect(assetResponse.body).toContain("factory");

    await app.close();
  });

  it("emits one startup readiness summary in deterministic fallback mode", async () => {
    const readinessSummarySink = vi.fn();

    const app = await buildApp({
      logger: false,
      orchestrator: new OrchestratorService({ db }),
      readinessSummarySink,
      operatorAuthService: createTestOperatorAuthService()
    });

    expect(readinessSummarySink).toHaveBeenCalledTimes(1);
    expect(readinessSummarySink).toHaveBeenCalledWith({
      providerMode: "deterministic",
      textProvider: null,
      visualProvider: null,
      aiActive: false,
      fallbackActive: true,
      runtimeEnabled: true,
      schedulerRuntimeEnabled: false,
      fallbackEnabled: true,
      configStatus: "fallback_active",
      issues: [],
      textProviderStatus: null,
      visualProviderStatus: null,
      operatorAuthConfig: {
        configured: true,
        missingConfigKeys: []
      }
    });
    expect(JSON.stringify(readinessSummarySink.mock.calls[0][0])).not.toContain("operator-pass");

    await app.close();
  });

  it("emits one startup readiness summary in AI-active mode", async () => {
    const readinessSummarySink = vi.fn();
    const registry = new ProviderRegistry();
    registry.registerTextProvider(new MockTextProvider());
    const orchestrator = new OrchestratorService({
      db,
      providerRouter: new ProviderRouter(registry, {
        mode: "mock",
        textProvider: "mock-text",
        fallbackEnabled: true
      })
    });
    const backgroundSchedulerRuntime = new BackgroundSchedulerRuntime({
      orchestrator,
      enabled: true,
      intervalMs: 60_000
    });

    const app = await buildApp({
      logger: false,
      orchestrator,
      backgroundSchedulerRuntime,
      readinessSummarySink,
      operatorAuthService: createTestOperatorAuthService()
    });

    expect(readinessSummarySink).toHaveBeenCalledTimes(1);
    expect(readinessSummarySink).toHaveBeenCalledWith(
      expect.objectContaining({
        providerMode: "mock",
        textProvider: "mock-text",
        aiActive: true,
        fallbackActive: false,
        schedulerRuntimeEnabled: true,
        configStatus: "ai_active",
        operatorAuthConfig: {
          configured: true,
          missingConfigKeys: []
        }
      })
    );

    await app.close();
  });

  it("emits one startup readiness summary for invalid provider config without blocking startup", async () => {
    const readinessSummarySink = vi.fn();
    const registry = new ProviderRegistry();
    registry.registerTextProvider(
      new MiraiProvider(
        {
          enabled: true,
          transport: "node",
          nodePath: process.execPath
        },
        {
          adapter: new MiraiAdapter({
            config: {
              enabled: true,
              transport: "node",
              nodePath: process.execPath
            },
            transport: {
              getAvailability: () => ({
                available: false,
                reason: "Mirai runtime not responding."
              }),
              generateText: async () => ({
                text: "unused"
              }),
              getSummary: () => "mirai-default@node"
            }
          })
        }
      )
    );
    const orchestrator = new OrchestratorService({
      db,
      providerRouter: new ProviderRouter(registry, {
        mode: "local",
        textProvider: "mirai",
        fallbackEnabled: false
      })
    });

    const app = await buildApp({
      logger: false,
      orchestrator,
      readinessSummarySink,
      operatorAuthService: createTestOperatorAuthService()
    });

    expect(readinessSummarySink).toHaveBeenCalledTimes(1);
    expect(readinessSummarySink).toHaveBeenCalledWith(
      expect.objectContaining({
        providerMode: "local",
        textProvider: "mirai",
        aiActive: false,
        fallbackActive: false,
        configStatus: "invalid",
        issues: ["mirai: Mirai runtime not responding."],
        operatorAuthConfig: {
          configured: true,
          missingConfigKeys: []
        }
      })
    );

    await app.close();
  });
});
