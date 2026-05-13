import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { MiraiNodeTransport } from "./miraiTransport";

const entrypointPath = fileURLToPath(
  new URL(
  "../scripts/mirai-local-entrypoint.mjs",
  import.meta.url
  )
);

describe("MiraiNodeTransport integration", () => {
  const originalEnv = {
    MIRAI_LOCAL_MODE: process.env.MIRAI_LOCAL_MODE,
    MIRAI_RUNTIME_MODULE: process.env.MIRAI_RUNTIME_MODULE
  };

  afterEach(() => {
    if (originalEnv.MIRAI_LOCAL_MODE === undefined) {
      delete process.env.MIRAI_LOCAL_MODE;
    } else {
      process.env.MIRAI_LOCAL_MODE = originalEnv.MIRAI_LOCAL_MODE;
    }

    if (originalEnv.MIRAI_RUNTIME_MODULE === undefined) {
      delete process.env.MIRAI_RUNTIME_MODULE;
    } else {
      process.env.MIRAI_RUNTIME_MODULE = originalEnv.MIRAI_RUNTIME_MODULE;
    }
  });

  it("executes the local entry script over the real stdin/stdout transport contract", async () => {
    process.env.MIRAI_LOCAL_MODE = "fixture";
    delete process.env.MIRAI_RUNTIME_MODULE;

    const transport = new MiraiNodeTransport({
      enabled: true,
      transport: "node",
      nodePath: entrypointPath,
      timeoutMs: 2_000,
      model: "fixture-model"
    });

    expect(transport.getAvailability()).toEqual({
      available: true,
      reason: expect.stringContaining("fixture runtime")
    });

    await expect(
      transport.generateText({
        task: "refinePostDraft",
        prompt: [
          "Refine this post to sound more human and grounded.",
          "Hook: AI is changing everything",
          "Body: Teams need clearer rollout language and practical delivery steps.",
          "CTA: Let me know what you think."
        ].join("\n")
      })
    ).resolves.toEqual(
      expect.objectContaining({
        text: expect.any(String),
        hook: expect.any(String),
        body: expect.stringContaining("practical"),
        cta: expect.any(String)
      })
    );
  });
});
