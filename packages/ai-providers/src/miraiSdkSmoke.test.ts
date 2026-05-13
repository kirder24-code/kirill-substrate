import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const sdkSmokeModule = new URL(
  "../scripts/mirai-sdk-smoke.mjs",
  import.meta.url
);

describe("mirai sdk smoke diagnostics", () => {
  it("builds an AI-active readiness summary when the sdk is available", async () => {
    const { buildSdkSmokeReadinessSummary } = await import(sdkSmokeModule.href);

    const summary = buildSdkSmokeReadinessSummary({
      providerMode: "local",
      textProvider: "mirai",
      fallbackEnabled: true,
      availability: {
        available: true,
        reason: "Mirai SDK is configured."
      }
    });

    expect(summary).toEqual(
      expect.objectContaining({
        providerMode: "local",
        textProvider: "mirai",
        aiActive: true,
        fallbackActive: false,
        configStatus: "ai_active"
      })
    );
  });

  it("builds a fallback readiness summary when sdk availability fails but fallback remains enabled", async () => {
    const { buildSdkSmokeReadinessSummary } = await import(sdkSmokeModule.href);

    const summary = buildSdkSmokeReadinessSummary({
      providerMode: "local",
      textProvider: "mirai",
      fallbackEnabled: true,
      availability: {
        available: false,
        reason: "MIRAI_API_KEY is not set."
      }
    });

    expect(summary).toEqual(
      expect.objectContaining({
        aiActive: false,
        fallbackActive: true,
        configStatus: "fallback_active"
      })
    );
  });

  it("builds an invalid readiness summary when sdk availability fails and fallback is disabled", async () => {
    const { buildSdkSmokeReadinessSummary } = await import(sdkSmokeModule.href);

    const summary = buildSdkSmokeReadinessSummary({
      providerMode: "local",
      textProvider: "mirai",
      fallbackEnabled: false,
      availability: {
        available: false,
        reason: "MIRAI_API_KEY is not set."
      }
    });

    expect(summary).toEqual(
      expect.objectContaining({
        aiActive: false,
        fallbackActive: false,
        configStatus: "invalid"
      })
    );
  });

  it("emits one startup readiness summary section from the sdk smoke entrypoint", () => {
    const result = spawnSync(
      process.execPath,
      [new URL("../scripts/mirai-sdk-smoke.mjs", import.meta.url).pathname],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          LBO_PROVIDER_MODE: "local",
          LBO_TEXT_PROVIDER: "mirai",
          LBO_PROVIDER_FALLBACK: "true",
          MIRAI_ENABLED: "false"
        }
      }
    );

    expect(result.status).toBe(0);
    expect(result.stdout.match(/Startup Readiness Summary/g)).toHaveLength(1);
  });
});
