import { describe, expect, it } from "vitest";

const entrypointModule = new URL(
  "../scripts/mirai-local-entrypoint.mjs",
  import.meta.url
);

describe("mirai local entry script contract", () => {
  it("accepts generate input and returns structured output", async () => {
    const { handleMiraiLocalRequest } = await import(entrypointModule.href);

    const response = await handleMiraiLocalRequest(
      {
        action: "generate",
        task: "generatePostFromIdea",
        prompt: [
          "Write a LinkedIn post for a B2B operator audience.",
          "Title: Operational AI rollout",
          "Core insight: Rollout work fails without an operator owner."
        ].join("\n"),
        model: "fixture-model"
      },
      {
        env: {
          MIRAI_LOCAL_MODE: "fixture"
        }
      }
    );

    expect(response.exitCode).toBe(0);
    expect(JSON.parse(response.stdout)).toEqual({
      output: expect.objectContaining({
        text: expect.any(String),
        hook: expect.any(String),
        body: expect.any(String),
        cta: expect.any(String)
      })
    });
    expect(response.stderr).toBe("");
  });

  it("returns normalized error output for bad input", async () => {
    const { handleMiraiLocalRequest } = await import(entrypointModule.href);

    const response = await handleMiraiLocalRequest(
      {
        action: "generate",
        model: "fixture-model"
      },
      {
        env: {
          MIRAI_LOCAL_MODE: "fixture"
        }
      }
    );

    expect(response.exitCode).toBe(1);
    expect(JSON.parse(response.stderr)).toEqual({
      error: expect.objectContaining({
        code: "INVALID_REQUEST",
        message: expect.stringContaining("task")
      })
    });
  });

  it("returns normalized availability output when the runtime is unavailable", async () => {
    const { handleMiraiLocalRequest } = await import(entrypointModule.href);

    const response = await handleMiraiLocalRequest(
      {
        action: "probe"
      },
      {
        env: {
          MIRAI_LOCAL_MODE: "module",
          MIRAI_RUNTIME_MODULE: "definitely-not-a-real-mirai-module"
        }
      }
    );

    expect(response.exitCode).toBe(0);
    expect(JSON.parse(response.stdout)).toEqual({
      available: false,
      reason: expect.stringContaining("definitely-not-a-real-mirai-module")
    });
  });
});
