import { describe, expect, it, vi } from "vitest";
import {
  MiraiSdkTransport,
  type MiraiSdkModule
} from "./miraiSdkTransport";

function createSdkModule() {
  const run = vi.fn((input: unknown) => ({
    text: {
      original: [
        "Hook: Operational AI rollout needs an owner",
        "Body: Teams move faster when rollout ownership is explicit and grounded.",
        "CTA: Compare notes if this is showing up in your team."
      ].join("\n")
    },
    raw: input
  }));

  const session = {
    run
  };

  const downloadChatModel = vi.fn(async () => undefined);
  const chatSession = vi.fn(() => session);
  const chatModel = vi.fn(async () => ({
    repoId: "Qwen/Qwen3-4B-AWQ"
  }));

  const engine = {
    chatModel,
    downloadChatModel,
    chatSession
  };

  const engineLoad = vi.fn(async () => engine);

  return {
    module: {
      default: {
        load: engineLoad
      },
      Input: {
        text: (text: string) => ({ type: "text", text })
      },
      RunConfig: {
        default: () => ({
          withTokensLimit: () => ({
            withEnableThinking: () => ({
              kind: "run-config"
            })
          })
        })
      }
    } satisfies MiraiSdkModule,
    engineLoad,
    chatModel,
    downloadChatModel,
    chatSession,
    run
  };
}

describe("MiraiSdkTransport", () => {
  it("constructs safely and reports unavailable when API key or model config is missing", () => {
    const transport = new MiraiSdkTransport({
      enabled: true,
      transport: "sdk"
    });

    expect(transport.getAvailability()).toEqual({
      available: false,
      reason: "MIRAI_API_KEY is not set for SDK transport."
    });

    const noModel = new MiraiSdkTransport({
      enabled: true,
      transport: "sdk",
      apiKey: "test-key"
    });

    expect(noModel.getAvailability()).toEqual({
      available: false,
      reason: "MIRAI_MODEL_REPO is not set for SDK transport."
    });
  });

  it("surfaces the configured model repo clearly in availability and summary", () => {
    const transport = new MiraiSdkTransport(
      {
        enabled: true,
        transport: "sdk",
        apiKey: "test-key",
        modelRepo: "Qwen/Qwen3-0.6B"
      },
      async () => {
        throw new Error("should not load");
      },
      () => true
    );

    expect(transport.getAvailability()).toEqual({
      available: true,
      reason: "Mirai SDK is configured for model repo 'Qwen/Qwen3-0.6B'."
    });
    expect(transport.getSummary()).toBe("Qwen/Qwen3-0.6B@sdk");
  });

  it("maps SDK-shaped output into the existing provider result shape", async () => {
    const sdk = createSdkModule();
    const transport = new MiraiSdkTransport(
      {
        enabled: true,
        transport: "sdk",
        apiKey: "test-key",
        modelRepo: "Qwen/Qwen3-4B-AWQ"
      },
      async () => sdk.module,
      () => true
    );

    await expect(
      transport.generateText({
        task: "generatePostFromIdea",
        prompt: "Write a grounded post."
      })
    ).resolves.toEqual({
      text: [
        "Hook: Operational AI rollout needs an owner",
        "Body: Teams move faster when rollout ownership is explicit and grounded.",
        "CTA: Compare notes if this is showing up in your team."
      ].join("\n"),
      hook: "Operational AI rollout needs an owner",
      body: "Teams move faster when rollout ownership is explicit and grounded.",
      cta: "Compare notes if this is showing up in your team.",
      title: undefined,
      summary: undefined
    });

    expect(sdk.engineLoad).toHaveBeenCalledWith("test-key");
    expect(sdk.chatModel).toHaveBeenCalledWith("Qwen/Qwen3-4B-AWQ");
    expect(sdk.downloadChatModel).toHaveBeenCalled();
    expect(sdk.chatSession).toHaveBeenCalled();
    expect(sdk.run).toHaveBeenCalled();
  });

  it("normalizes timeout and runtime failures", async () => {
    const timeoutTransport = new MiraiSdkTransport(
      {
        enabled: true,
        transport: "sdk",
        apiKey: "test-key",
        modelRepo: "Qwen/Qwen3-4B-AWQ",
        timeoutMs: 10
      },
      async () => ({
        default: {
          load: async () => ({
            chatModel: async () => ({}),
            downloadChatModel: async () => undefined,
            chatSession: () => ({
              run: async () =>
                new Promise((resolve) => {
                  setTimeout(() => resolve({ text: { original: "late" } }), 100);
                })
            })
          })
        }
      }),
      () => true
    );

    await expect(
      timeoutTransport.generateText({
        task: "generatePostFromIdea",
        prompt: "Write a grounded post."
      })
    ).rejects.toMatchObject({
      code: "MIRAI_TIMEOUT"
    });

    const failureTransport = new MiraiSdkTransport(
      {
        enabled: true,
        transport: "sdk",
        apiKey: "test-key",
        modelRepo: "Qwen/Qwen3-4B-AWQ"
      },
      async () => ({
        default: {
          load: async () => {
            throw new Error("SDK engine load failed.");
          }
        }
      }),
      () => true
    );

    await expect(
      failureTransport.generateText({
        task: "refinePostDraft",
        prompt: "Refine this post."
      })
    ).rejects.toMatchObject({
      code: "MIRAI_EXECUTION_FAILED",
      message: "SDK engine load failed."
    });
  });

  it("normalizes common SDK setup and model errors into clearer operator-facing messages", async () => {
    const setupTransport = new MiraiSdkTransport(
      {
        enabled: true,
        transport: "sdk",
        apiKey: "test-key",
        modelRepo: "Qwen/Qwen3-4B-AWQ"
      },
      async () => ({
        default: {
          load: async () => {
            throw new Error("project not active for this API key");
          }
        }
      }),
      () => true
    );

    await expect(
      setupTransport.generateText({
        task: "generatePostFromIdea",
        prompt: "Write a grounded post."
      })
    ).rejects.toMatchObject({
      code: "MIRAI_EXECUTION_FAILED",
      message:
        "Mirai SDK setup is incomplete or the project is not active for the supplied API key."
    });

    const modelTransport = new MiraiSdkTransport(
      {
        enabled: true,
        transport: "sdk",
        apiKey: "test-key",
        modelRepo: "Qwen/Qwen3-4B-AWQ"
      },
      async () => ({
        default: {
          load: async () => ({
            chatModel: async () => {
              throw new Error("model repo not found");
            }
          })
        }
      }),
      () => true
    );

    await expect(
      modelTransport.generateText({
        task: "generatePostFromIdea",
        prompt: "Write a grounded post."
      })
    ).rejects.toMatchObject({
      code: "MIRAI_EXECUTION_FAILED",
      message:
        "Mirai SDK could not find model repo 'Qwen/Qwen3-4B-AWQ'. Verify the official repo id format."
    });
  });

  it("reports unavailable when the SDK package is not installed", () => {
    const transport = new MiraiSdkTransport(
      {
        enabled: true,
        transport: "sdk",
        apiKey: "test-key",
        modelRepo: "Qwen/Qwen3-4B-AWQ"
      },
      async () => {
        throw new Error("should not load");
      },
      () => false
    );

    expect(transport.getAvailability()).toEqual({
      available: false,
      reason: "Mirai SDK package '@trymirai/uzu' is not installed."
    });
  });
});
