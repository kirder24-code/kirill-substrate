import { describe, expect, it } from "vitest";

const runtimeModule = new URL(
  "../scripts/mirai-local-runtime.mjs",
  import.meta.url
);

const compatModulePath = "./packages/ai-providers/scripts/mirai-module-compat.mjs";
const fixtureTargetModulePath =
  "./packages/ai-providers/scripts/test-mirai-chat-module.mjs";

describe("Mirai module-mode resolution", () => {
  it("resolves a configured runtime module file path or package name", async () => {
    const { resolveMiraiRuntimeModuleSpecifier } = await import(runtimeModule.href);

    const resolvedPath = resolveMiraiRuntimeModuleSpecifier({
      MIRAI_RUNTIME_MODULE: compatModulePath
    });
    const resolvedPackage = resolveMiraiRuntimeModuleSpecifier({
      MIRAI_RUNTIME_MODULE: "node:path"
    });

    expect(resolvedPath).toContain("/packages/ai-providers/scripts/mirai-module-compat.mjs");
    expect(resolvedPackage).toBe("node:path");
  });

  it("fails cleanly when the configured runtime module is missing and keeps fixture mode untouched", async () => {
    const { probeMiraiLocalRuntime } = await import(runtimeModule.href);

    await expect(
      probeMiraiLocalRuntime({
        MIRAI_LOCAL_MODE: "module",
        MIRAI_RUNTIME_MODULE: "./packages/ai-providers/scripts/does-not-exist.mjs"
      })
    ).resolves.toEqual({
      available: false,
      reason: expect.stringContaining("does-not-exist")
    });

    await expect(
      probeMiraiLocalRuntime({
        MIRAI_LOCAL_MODE: "fixture"
      })
    ).resolves.toEqual({
      available: true,
      reason: "Mirai fixture runtime is available."
    });
  });
});

describe("Mirai compatibility adapter", () => {
  it("maps generatePostFromIdea through the compatibility adapter contract", async () => {
    const { executeMiraiLocalTask } = await import(runtimeModule.href);

    const result = await executeMiraiLocalTask(
      {
        task: "generatePostFromIdea",
        prompt: [
          "Write a LinkedIn post for a B2B operator audience.",
          "Title: Operational AI rollout",
          "Core insight: Rollout work fails when nobody owns the process."
        ].join("\n")
      },
      {
        MIRAI_LOCAL_MODE: "module",
        MIRAI_RUNTIME_MODULE: compatModulePath,
        MIRAI_RUNTIME_TARGET_MODULE: fixtureTargetModulePath,
        MIRAI_MODEL: "Qwen3-4B-AWQ"
      }
    );

    expect(result).toEqual({
      ok: true,
      output: expect.objectContaining({
        text: expect.any(String),
        hook: expect.any(String),
        body: expect.any(String),
        cta: expect.any(String)
      })
    });
  });

  it("maps refinePostDraft through the compatibility adapter contract", async () => {
    const { executeMiraiLocalTask } = await import(runtimeModule.href);

    const result = await executeMiraiLocalTask(
      {
        task: "refinePostDraft",
        prompt: [
          "Refine this post to sound more human and grounded.",
          "Hook: AI is changing everything",
          "Body: Teams need clearer rollout ownership and less vague planning.",
          "CTA: Let me know what you think."
        ].join("\n")
      },
      {
        MIRAI_LOCAL_MODE: "module",
        MIRAI_RUNTIME_MODULE: compatModulePath,
        MIRAI_RUNTIME_TARGET_MODULE: fixtureTargetModulePath,
        MIRAI_MODEL: "Qwen3-4B-AWQ"
      }
    );

    expect(result).toEqual({
      ok: true,
      output: expect.objectContaining({
        text: expect.any(String),
        hook: expect.any(String),
        body: expect.stringContaining("clearer rollout"),
        cta: expect.any(String)
      })
    });
  });
});
