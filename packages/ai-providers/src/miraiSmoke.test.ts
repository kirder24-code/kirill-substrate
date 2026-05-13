import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const smokeModule = new URL(
  "../scripts/mirai-smoke.mjs",
  import.meta.url
);

describe("mirai smoke diagnostics", () => {
  it("builds fixture-friendly defaults", async () => {
    const { buildSmokeEnvironment } = await import(smokeModule.href);

    const result = buildSmokeEnvironment(
      {
        LBO_PROVIDER_MODE: undefined,
        LBO_TEXT_PROVIDER: undefined,
        LBO_PROVIDER_FALLBACK: undefined,
        MIRAI_ENABLED: undefined,
        MIRAI_TRANSPORT: undefined,
        MIRAI_NODE_PATH: undefined,
        MIRAI_LOCAL_MODE: undefined,
        MIRAI_MODEL: undefined
      },
      { fixture: true }
    );

    expect(result.providerMode).toBe("local");
    expect(result.textProvider).toBe("mirai");
    expect(result.fallbackEnabled).toBe(true);
    expect(result.miraiEnabled).toBe(true);
    expect(result.miraiLocalMode).toBe("fixture");
    expect(result.miraiNodePath).toContain("mirai-local-entrypoint.mjs");
  });

  it("reports provider path when probe is healthy", async () => {
    const { determineProviderPath } = await import(smokeModule.href);

    expect(
      determineProviderPath({
        providerMode: "local",
        textProvider: "mirai",
        fallbackEnabled: true,
        probeAvailable: true
      })
    ).toEqual({
      selectedPath: "provider",
      reason: "Mirai is configured and the local entry script probe succeeded."
    });
  });

  it("reports fallback path when probe fails and fallback is enabled", async () => {
    const { determineProviderPath } = await import(smokeModule.href);

    expect(
      determineProviderPath({
        providerMode: "local",
        textProvider: "mirai",
        fallbackEnabled: true,
        probeAvailable: false
      })
    ).toEqual({
      selectedPath: "fallback",
      reason: "Mirai is selected but unavailable, so deterministic fallback would run."
    });
  });

  it("keeps module-mode smoke defaults explicit", async () => {
    const { buildSmokeEnvironment } = await import(smokeModule.href);

    const result = buildSmokeEnvironment(
      {
        LBO_PROVIDER_MODE: "local",
        LBO_TEXT_PROVIDER: "mirai",
        LBO_PROVIDER_FALLBACK: "true",
        MIRAI_ENABLED: "true",
        MIRAI_TRANSPORT: "node",
        MIRAI_LOCAL_MODE: "module",
        MIRAI_RUNTIME_MODULE: "./my-local-mirai-bridge.mjs",
        MIRAI_MODEL: "Qwen3-4B-AWQ"
      },
      { fixture: false }
    );

    expect(result.miraiLocalMode).toBe("module");
    expect(result.miraiRuntimeModule).toBe("./my-local-mirai-bridge.mjs");
    expect(result.miraiModel).toBe("Qwen3-4B-AWQ");
  });

  it("builds an AI-active readiness summary when the probe succeeds", async () => {
    const { buildSmokeReadinessSummary } = await import(smokeModule.href);

    const summary = buildSmokeReadinessSummary(
      {
        providerMode: "local",
        textProvider: "mirai",
        fallbackEnabled: true
      },
      {
        stdout: {
          available: true,
          reason: "Mirai local runtime is ready."
        }
      }
    );

    expect(summary).toEqual(
      expect.objectContaining({
        providerMode: "local",
        textProvider: "mirai",
        aiActive: true,
        fallbackActive: false,
        configStatus: "ai_active",
        schedulerRuntimeEnabled: false
      })
    );
  });

  it("builds a fallback readiness summary when the probe fails and fallback is enabled", async () => {
    const { buildSmokeReadinessSummary } = await import(smokeModule.href);

    const summary = buildSmokeReadinessSummary(
      {
        providerMode: "local",
        textProvider: "mirai",
        fallbackEnabled: true
      },
      {
        stdout: {
          available: false,
          reason: "Mirai local runtime is unavailable."
        }
      }
    );

    expect(summary).toEqual(
      expect.objectContaining({
        aiActive: false,
        fallbackActive: true,
        configStatus: "fallback_active"
      })
    );
  });

  it("builds an invalid readiness summary when the probe fails and fallback is disabled", async () => {
    const { buildSmokeReadinessSummary } = await import(smokeModule.href);

    const summary = buildSmokeReadinessSummary(
      {
        providerMode: "local",
        textProvider: "mirai",
        fallbackEnabled: false
      },
      {
        stdout: {
          available: false,
          reason: "Mirai local runtime is unavailable."
        }
      }
    );

    expect(summary).toEqual(
      expect.objectContaining({
        aiActive: false,
        fallbackActive: false,
        configStatus: "invalid"
      })
    );
  });

  it("emits one startup readiness summary section from the smoke entrypoint", () => {
    const result = spawnSync(
      process.execPath,
      [new URL("../scripts/mirai-smoke.mjs", import.meta.url).pathname, "--fixture", "--providers-only"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          LBO_PROVIDER_MODE: "local",
          LBO_TEXT_PROVIDER: "mirai",
          LBO_PROVIDER_FALLBACK: "true",
          MIRAI_ENABLED: "true",
          MIRAI_TRANSPORT: "node",
          MIRAI_LOCAL_MODE: "fixture",
          MIRAI_MODEL: "fixture-model"
        }
      }
    );

    expect(result.status).toBe(0);
    expect(result.stdout.match(/Startup Readiness Summary/g)).toHaveLength(1);
  });
});
