import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type {
  AIProviderProbeResult,
  ContentAsset,
  Idea,
  Signal
} from "@linkedin-brand-os/shared";
import {
  MiraiAdapter,
  MiraiProvider,
  MockTextProvider,
  MockVisualProvider,
  ProviderRegistry,
  ProviderRouter
} from "./index";
import type {
  MiraiTransportRequest,
  MiraiTransportResponse
} from "./miraiTransport";
import { createProviderRouterFromEnv } from "./index";

const idea: Idea = {
  id: "idea-1",
  signalId: "sig-1",
  title: "Operational AI rollout",
  coreInsight: "Teams need a practical rollout plan.",
  businessRelevance: "Operational clarity speeds adoption.",
  targetAudience: "Founders and operators",
  status: "draft",
  createdAt: "2026-03-14T00:00:00.000Z"
};

const content: ContentAsset = {
  id: "content-1",
  ideaId: idea.id,
  contentType: "linkedin-post",
  hook: "Most teams miss the rollout layer.",
  body: "Operational clarity is what moves pilots into production.",
  cta: "Compare notes if this sounds familiar.",
  status: "draft",
  createdAt: "2026-03-14T00:00:00.000Z"
};

const signal: Signal = {
  id: "sig-1",
  title: "AI rollout blockers",
  sourceType: "manual",
  rawText: "Translate technical blockers into business language.",
  status: "new",
  createdAt: "2026-03-14T00:00:00.000Z"
};

const miraiEntrypointPath = fileURLToPath(
  new URL("../scripts/mirai-local-entrypoint.mjs", import.meta.url)
);

function createMiraiAdapter(options: {
  available?: boolean;
  reason?: string;
  response?: MiraiTransportResponse;
  rejectWith?: Error;
} = {}) {
  const generate = vi.fn(
    async (_request: MiraiTransportRequest): Promise<MiraiTransportResponse> => {
      if (options.rejectWith) {
        throw options.rejectWith;
      }

      return (
        options.response ?? {
          text: "Grounded provider output",
          hook: "A practical way to frame rollout risk",
          body: "Grounded provider output",
          cta: "Compare notes."
        }
      );
    }
  );

  return {
    adapter: new MiraiAdapter({
      config: {
        enabled: true,
        transport: "node",
        nodePath: process.execPath
      },
      transport: {
        getAvailability: () => ({
          available: options.available ?? true,
          reason: options.reason ?? "Mirai local runtime is ready."
        }),
        generateText: generate,
        getSummary: () => "mirai-default@node"
      }
    }),
    generate
  };
}

describe("ProviderRegistry and ProviderRouter", () => {
  it("resolves the correct providers for configured tasks", async () => {
    const registry = new ProviderRegistry();
    registry.registerTextProvider(new MockTextProvider());
    registry.registerVisualProvider(new MockVisualProvider());

    const router = new ProviderRouter(registry, {
      mode: "mock",
      textProvider: "mock-text",
      visualProvider: "mock-visual",
      fallbackEnabled: true
    });

    expect(router.getSummary()).toEqual({
      mode: "mock",
      textProvider: "mock-text",
      visualProvider: "mock-visual",
      fallbackEnabled: true,
      textProviderStatus: {
        id: "mock-text",
        available: true,
        reason: "Deterministic mock text provider is always available.",
        capabilities: {
          text: true,
          visual: false,
          live: false
        }
      },
      visualProviderStatus: {
        id: "mock-visual",
        available: true,
        reason: "Deterministic mock visual provider is always available.",
        capabilities: {
          text: false,
          visual: true,
          live: false
        }
      }
    });

    const translation = await router.translateToBusiness({
      signal,
      fallback: async () => ({
        title: "fallback",
        coreInsight: "fallback",
        businessRelevance: "fallback",
        targetAudience: "fallback",
        status: "draft"
      })
    });

    expect(translation.title).toContain("AI rollout blockers");
  });

  it("falls back to deterministic local behavior when no provider is configured", async () => {
    const router = new ProviderRouter(new ProviderRegistry(), {
      mode: "deterministic",
      fallbackEnabled: true
    });

    const result = await router.generatePostFromIdea({
      idea,
      fallback: async () => ({
        contentType: "linkedin-post",
        hook: "fallback hook",
        body: "fallback body",
        cta: "fallback cta",
        status: "draft"
      })
    });

    expect(result).toEqual({
      contentType: "linkedin-post",
      hook: "fallback hook",
      body: "fallback body",
      cta: "fallback cta",
      status: "draft"
    });
  });

  it("reports a successful explicit provider probe when the configured text provider responds", async () => {
    const registry = new ProviderRegistry();
    registry.registerTextProvider(new MockTextProvider());

    const router = new ProviderRouter(registry, {
      mode: "mock",
      textProvider: "mock-text",
      fallbackEnabled: true
    });

    await expect(router.probeTextProvider()).resolves.toEqual(
      expect.objectContaining<Partial<AIProviderProbeResult>>({
        providerMode: "mock",
        textProvider: "mock-text",
        aiActive: true,
        fallbackActive: false,
        probeStatus: "success"
      })
    );
  });

  it("reports safe inactive probe status when deterministic fallback mode is active", async () => {
    const router = new ProviderRouter(new ProviderRegistry(), {
      mode: "deterministic",
      fallbackEnabled: true
    });

    await expect(router.probeTextProvider()).resolves.toEqual(
      expect.objectContaining<Partial<AIProviderProbeResult>>({
        providerMode: "deterministic",
        textProvider: null,
        aiActive: false,
        fallbackActive: true,
        probeStatus: "inactive"
      })
    );
  });

  it("auto-selects the real premium provider when a non-placeholder OpenAI key is present", () => {
    const router = createProviderRouterFromEnv({
      OPENAI_API_KEY: "sk-real-key",
      OPENAI_TEXT_MODEL: "gpt-5.4"
    });

    expect(router.getSummary()).toEqual(
      expect.objectContaining({
        mode: "external",
        textProvider: "strong-text"
      })
    );
  });

  it("stays deterministic when only the placeholder OpenAI key is present", () => {
    const router = createProviderRouterFromEnv({
      OPENAI_API_KEY: "PASTE_REAL_KEY_HERE",
      OPENAI_TEXT_MODEL: "gpt-5.4"
    });

    expect(router.getSummary()).toEqual(
      expect.objectContaining({
        mode: "deterministic",
        textProvider: null
      })
    );
  });

  it("reports failed probe status when provider config is invalid and fallback is disabled", async () => {
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

    const router = new ProviderRouter(registry, {
      mode: "local",
      textProvider: "mirai",
      fallbackEnabled: false
    });

    await expect(router.probeTextProvider()).resolves.toEqual(
      expect.objectContaining<Partial<AIProviderProbeResult>>({
        providerMode: "local",
        textProvider: "mirai",
        aiActive: false,
        fallbackActive: false,
        probeStatus: "failed",
        probeMessage: "Mirai runtime not responding."
      })
    );
  });

  it("mock providers return structured text and visual outputs", async () => {
    const textProvider = new MockTextProvider();
    const visualProvider = new MockVisualProvider();

    await expect(textProvider.generatePostFromIdea({ idea })).resolves.toEqual(
      expect.objectContaining({
        contentType: "linkedin-post",
        hook: expect.any(String),
        body: expect.any(String),
        cta: expect.any(String),
        status: "draft"
      })
    );

    await expect(textProvider.refinePostDraft({ content })).resolves.toEqual(
      expect.objectContaining({
        refinedHook: expect.any(String),
        refinedBody: expect.any(String),
        refinedCta: expect.any(String),
        refinementStatus: "refined"
      })
    );

    await expect(visualProvider.generateVisualBrief({ content })).resolves.toEqual(
      expect.objectContaining({
        title: expect.any(String),
        visualType: "single-image",
        prompt: expect.any(String),
        status: "ready"
      })
    );
  });

  it("provider-backed scout enrichment populates useful fields by scout kind", async () => {
    const registry = new ProviderRegistry();
    registry.registerTextProvider(new MockTextProvider());
    const router = new ProviderRouter(registry, {
      mode: "mock",
      textProvider: "mock-text",
      fallbackEnabled: true
    });

    const audience = await router.enrichScoutOutput({
      scout: {
        kind: "audience",
        subject: "Operators are flagging broken handoffs after launch.",
        whyItMatters: "This shows workflow-accountability pain in live operations.",
        supportingContext: "Broken Handoff",
        rawExcerpt: "Operators still patch workflow handoffs manually.",
        operatorAction: "post_candidate"
      },
      fallback: async () => undefined
    });
    const solution = await router.enrichScoutOutput({
      scout: {
        kind: "solution",
        subject: "Visibility and coordination pattern",
        whyItMatters: "Useful operator lesson.",
        supportingContext: "Expose status and ownership early.",
        rawExcerpt: "Expose status and ownership before work stalls.",
        operatorAction: "post_candidate"
      },
      fallback: async () => undefined
    });
    const match = await router.enrichScoutOutput({
      scout: {
        kind: "match",
        subject: "Operators are flagging broken handoffs after launch.",
        whyItMatters: "The solution addresses the same ownership gap.",
        supportingContext: "Visibility and coordination pattern",
        operatorAction: "write_post"
      },
      fallback: async () => undefined
    });

    expect(audience).toEqual(
      expect.objectContaining({
        businessConsequence: expect.any(String)
      })
    );
    expect(solution).toEqual(
      expect.objectContaining({
        operatorAngle: expect.any(String)
      })
    );
    expect(match).toEqual(
      expect.objectContaining({
        whyItMatters: expect.any(String)
      })
    );
  });

  it("provider-backed match content generation populates compact action-aware fields", async () => {
    const registry = new ProviderRegistry();
    registry.registerTextProvider(new MockTextProvider());
    const router = new ProviderRouter(registry, {
      mode: "mock",
      textProvider: "mock-text",
      fallbackEnabled: true
    });

    const post = await router.generateMatchContent({
      content: {
        itemType: "match",
        recommendedAction: "write_post",
        title: "Workflow accountability after launch",
        painSummary: "Operators still patch broken handoffs manually.",
        whyItMatters: "The pairing exposes a recurring ownership gap.",
        operatorAngle: "Frame it as an operator lesson."
      },
      fallback: async () => undefined
    });
    const comment = await router.generateMatchContent({
      content: {
        itemType: "match",
        recommendedAction: "write_comment",
        title: "Workflow accountability after launch",
        painSummary: "Operators still patch broken handoffs manually.",
        whyItMatters: "The pairing exposes a recurring ownership gap.",
        operatorAngle: "Add one concrete operator lesson."
      },
      fallback: async () => undefined
    });
    const later = await router.generateMatchContent({
      content: {
        itemType: "match",
        recommendedAction: "save_for_later",
        title: "Workflow accountability after launch",
        whyItMatters: "Useful later when stronger evidence is available."
      },
      fallback: async () => undefined
    });

    expect(post).toEqual(
      expect.objectContaining({
        contentIdea: expect.any(String),
        draftAngle: expect.any(String),
        postSeed: expect.any(String)
      })
    );
    expect(comment).toEqual(
      expect.objectContaining({
        contentIdea: expect.any(String),
        draftAngle: expect.any(String),
        commentSeed: expect.any(String)
      })
    );
    expect(later).toEqual(
      expect.objectContaining({
        contentIdea: expect.any(String),
        angleStub: expect.any(String)
      })
    );
  });

  it("MiraiProvider can be instantiated safely with no live dependency required", async () => {
    const provider = new MiraiProvider({
      enabled: false,
      model: "mirai-local"
    });

    expect(provider.id).toBe("mirai");
    expect(provider.getAvailability()).toEqual({
      available: false,
      reason: "Mirai transport is disabled."
    });
    expect(provider.getCapabilities()).toEqual({
      text: true,
      visual: true,
      live: true
    });
  });

  it("uses the Mirai transport adapter when configured", async () => {
    const { adapter, generate } = createMiraiAdapter();
    const provider = new MiraiProvider(
      {
        enabled: true,
        model: "mirai-local"
      },
      { adapter }
    );

    const result = await provider.generatePostFromIdea({ idea });

    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        task: "generatePostFromIdea",
        prompt: expect.stringContaining(idea.title)
      })
    );
    expect(result).toEqual(
      expect.objectContaining({
        hook: "A practical way to frame rollout risk",
        body: "Grounded provider output",
        cta: "Compare notes."
      })
    );
  });

  it("parses labeled scout enrichment fields from the Mirai transport response safely", async () => {
    const { adapter, generate } = createMiraiAdapter({
      response: {
        text: [
          "Improved summary: Clear implementation lesson for operators.",
          "Why it matters: The pairing matters because ownership gaps keep recurring after launch.",
          "Business consequence: Slower recovery and messier escalation.",
          "Operator angle: Use this as an operator/content angle about accountability before escalation.",
          "Uncertainty note: n/a"
        ].join("\n")
      }
    });
    const provider = new MiraiProvider(
      {
        enabled: true,
        model: "mirai-local"
      },
      { adapter }
    );

    const result = await provider.enrichScoutOutput({
      scout: {
        kind: "match",
        subject: "Operators are flagging broken handoffs after launch.",
        whyItMatters: "The solution addresses the same ownership gap.",
        supportingContext: "Visibility and coordination pattern",
        operatorAction: "write_post"
      }
    });

    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        task: "enrichScoutOutput"
      })
    );
    expect(result).toEqual({
      improvedSummary: "Clear implementation lesson for operators.",
      whyItMatters: "The pairing matters because ownership gaps keep recurring after launch.",
      businessConsequence: "Slower recovery and messier escalation.",
      operatorAngle: "Use this as an operator/content angle about accountability before escalation.",
      uncertaintyNote: undefined
    });
  });

  it("parses sparse labeled scout enrichment responses safely", async () => {
    const { adapter } = createMiraiAdapter({
      response: {
        text: [
          "Improved summary: n/a",
          "Why it matters: n/a",
          "Business consequence: Slower recovery and messier escalation.",
          "Operator angle: n/a",
          "Uncertainty note: n/a"
        ].join("\n")
      }
    });
    const provider = new MiraiProvider(
      {
        enabled: true,
        model: "mirai-local"
      },
      { adapter }
    );

    const result = await provider.enrichScoutOutput({
      scout: {
        kind: "audience",
        subject: "Operators are flagging broken handoffs after launch.",
        whyItMatters: "This shows workflow-accountability pain in live operations.",
        supportingContext: "Broken Handoff",
        operatorAction: "post_candidate"
      }
    });

    expect(result).toEqual({
      improvedSummary: undefined,
      whyItMatters: undefined,
      businessConsequence: "Slower recovery and messier escalation.",
      operatorAngle: undefined,
      uncertaintyNote: undefined
    });
  });

  it("handles missing scout enrichment labels safely", async () => {
    const { adapter } = createMiraiAdapter({
      response: {
        text: [
          "Improved summary: Clear pain framing for operators.",
          "Why it matters: Ownership gaps keep recurring after launch.",
          "Operator angle: Use this as a workflow-accountability angle."
        ].join("\n")
      }
    });
    const provider = new MiraiProvider(
      {
        enabled: true,
        model: "mirai-local"
      },
      { adapter }
    );

    const result = await provider.enrichScoutOutput({
      scout: {
        kind: "audience",
        subject: "Operators are flagging broken handoffs after launch.",
        whyItMatters: "This shows workflow-accountability pain in live operations.",
        supportingContext: "Broken Handoff",
        operatorAction: "post_candidate"
      }
    });

    expect(result).toEqual({
      improvedSummary: "Clear pain framing for operators.",
      whyItMatters: "Ownership gaps keep recurring after launch.",
      businessConsequence: undefined,
      operatorAngle: "Use this as a workflow-accountability angle.",
      uncertaintyNote: undefined
    });
  });

  it("handles duplicated scout enrichment labels predictably", async () => {
    const { adapter } = createMiraiAdapter({
      response: {
        text: [
          "Why it matters: First labeled reason should win.",
          "Why it matters: Second labeled reason should be ignored.",
          "Operator angle: Use this as an operator/content angle."
        ].join("\n")
      }
    });
    const provider = new MiraiProvider(
      {
        enabled: true,
        model: "mirai-local"
      },
      { adapter }
    );

    const result = await provider.enrichScoutOutput({
      scout: {
        kind: "match",
        subject: "Operators are flagging broken handoffs after launch.",
        whyItMatters: "The solution addresses the same ownership gap.",
        supportingContext: "Visibility and coordination pattern",
        operatorAction: "write_post"
      }
    });

    expect(result).toEqual({
      improvedSummary: undefined,
      whyItMatters: "First labeled reason should win.",
      businessConsequence: undefined,
      operatorAngle: "Use this as an operator/content angle.",
      uncertaintyNote: undefined
    });
  });

  it("ignores extra unlabeled prose around scout enrichment labels safely", async () => {
    const { adapter } = createMiraiAdapter({
      response: {
        text: [
          "Here is some extra provider prose that should not be parsed into enrichment fields.",
          "Improved summary: Clear implementation lesson for operators.",
          "Business consequence: Slower recovery and messier escalation.",
          "Closing note without a label should also be ignored."
        ].join("\n")
      }
    });
    const provider = new MiraiProvider(
      {
        enabled: true,
        model: "mirai-local"
      },
      { adapter }
    );

    const result = await provider.enrichScoutOutput({
      scout: {
        kind: "solution",
        subject: "Visibility and coordination pattern",
        whyItMatters: "Useful operator lesson.",
        supportingContext: "Expose status and ownership early.",
        operatorAction: "post_candidate"
      }
    });

    expect(result).toEqual({
      improvedSummary: "Clear implementation lesson for operators.",
      whyItMatters: undefined,
      businessConsequence: "Slower recovery and messier escalation.",
      operatorAngle: undefined,
      uncertaintyNote: undefined
    });
  });

  it("parses labeled match content fields from the Mirai transport response safely", async () => {
    const { adapter, generate } = createMiraiAdapter({
      response: {
        text: [
          "CONTENT_IDEA: Show how ownership gaps create rollout drag.",
          "DRAFT_ANGLE: Tie visibility to clear recovery ownership.",
          "POST_SEED: Most rollout friction is ownership friction, not tooling friction.",
          "WARNINGS: Review tone | Avoid overstating certainty"
        ].join("\n")
      }
    });
    const provider = new MiraiProvider(
      {
        enabled: true,
        model: "mirai-local"
      },
      { adapter }
    );

    const result = await provider.generateMatchContent({
      content: {
        itemType: "match",
        recommendedAction: "write_post",
        title: "Workflow accountability after launch",
        painSummary: "Operators still patch broken handoffs manually.",
        whyItMatters: "The pairing exposes a recurring ownership gap."
      }
    });

    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        task: "generateMatchContent"
      })
    );
    expect(result).toEqual({
      contentIdea: "Show how ownership gaps create rollout drag.",
      draftAngle: "Tie visibility to clear recovery ownership.",
      postSeed: "Most rollout friction is ownership friction, not tooling friction.",
      commentSeed: undefined,
      angleStub: undefined,
      warnings: ["Review tone", "Avoid overstating certainty"]
    });
  });

  it("handles malformed labeled match content responses safely", async () => {
    const { adapter } = createMiraiAdapter({
      response: {
        text: [
          "Some extra prose that should be ignored.",
          "CONTENT_IDEA: Keep this as a future angle about ownership clarity.",
          "CONTENT_IDEA: Duplicate should be ignored.",
          "ANGLE_STUB: Revisit when the evidence set is stronger.",
          "WARNINGS: n/a",
          "Malformed section without a label"
        ].join("\n")
      }
    });
    const provider = new MiraiProvider(
      {
        enabled: true,
        model: "mirai-local"
      },
      { adapter }
    );

    const result = await provider.generateMatchContent({
      content: {
        itemType: "match",
        recommendedAction: "save_for_later",
        title: "Deferred workflow accountability idea",
        whyItMatters: "Useful later when stronger evidence is available."
      }
    });

    expect(result).toEqual({
      contentIdea: "Keep this as a future angle about ownership clarity.",
      draftAngle: undefined,
      postSeed: undefined,
      commentSeed: undefined,
      angleStub: "Revisit when the evidence set is stronger.",
      warnings: undefined
    });
  });

  it("reports unavailable when the Mirai transport probe fails", () => {
    const { adapter } = createMiraiAdapter({
      available: false,
      reason: "Mirai runtime not responding."
    });
    const provider = new MiraiProvider(
      {
        enabled: true,
        model: "mirai-local"
      },
      { adapter }
    );

    expect(provider.getAvailability()).toEqual({
      available: false,
      reason: "Mirai runtime not responding."
    });
  });

  it("falls back cleanly through the router when Mirai is unavailable or errors", async () => {
    const registry = new ProviderRegistry();
    const unavailable = createMiraiAdapter({
      available: false,
      reason: "Mirai runtime not responding."
    });
    registry.registerTextProvider(
      new MiraiProvider(
        {
          enabled: true,
          model: "mirai-local"
        },
        { adapter: unavailable.adapter }
      )
    );

    let result = await new ProviderRouter(registry, {
      mode: "local",
      textProvider: "mirai",
      fallbackEnabled: true
    }).generatePostFromIdea({
      idea,
      fallback: async () => ({
        contentType: "linkedin-post",
        hook: "fallback hook",
        body: "fallback body",
        cta: "fallback cta",
        status: "draft"
      })
    });

    expect(result.hook).toBe("fallback hook");

    const failing = createMiraiAdapter({
      rejectWith: new Error("transport exploded")
    });
    const errorRegistry = new ProviderRegistry();
    errorRegistry.registerTextProvider(
      new MiraiProvider(
        {
          enabled: true,
          model: "mirai-local"
        },
        { adapter: failing.adapter }
      )
    );

    result = await new ProviderRouter(errorRegistry, {
      mode: "local",
      textProvider: "mirai",
      fallbackEnabled: true
    }).generatePostFromIdea({
      idea,
      fallback: async () => ({
        contentType: "linkedin-post",
        hook: "fallback hook",
        body: "fallback body",
        cta: "fallback cta",
        status: "draft"
      })
    });

    expect(result.hook).toBe("fallback hook");
  });

  it("falls back cleanly when the local Mirai script reports runtime failure", async () => {
    const originalMode = process.env.MIRAI_LOCAL_MODE;
    const originalRuntimeModule = process.env.MIRAI_RUNTIME_MODULE;
    process.env.MIRAI_LOCAL_MODE = "module";
    process.env.MIRAI_RUNTIME_MODULE = "definitely-not-a-real-mirai-module";

    try {
      const registry = new ProviderRegistry();
      registry.registerTextProvider(
        new MiraiProvider({
          enabled: true,
          model: "mirai-local",
          nodePath: miraiEntrypointPath
        })
      );

      const router = new ProviderRouter(registry, {
        mode: "local",
        textProvider: "mirai",
        fallbackEnabled: true
      });

      const result = await router.generatePostFromIdea({
        idea,
        fallback: async () => ({
          contentType: "linkedin-post",
          hook: "fallback hook",
          body: "fallback body",
          cta: "fallback cta",
          status: "draft"
        })
      });

      expect(result.hook).toBe("fallback hook");
    } finally {
      if (originalMode === undefined) {
        delete process.env.MIRAI_LOCAL_MODE;
      } else {
        process.env.MIRAI_LOCAL_MODE = originalMode;
      }

      if (originalRuntimeModule === undefined) {
        delete process.env.MIRAI_RUNTIME_MODULE;
      } else {
        process.env.MIRAI_RUNTIME_MODULE = originalRuntimeModule;
      }
    }
  });

  it("selects the SDK-backed Mirai path when MIRAI_TRANSPORT=sdk is configured", () => {
    const router = createProviderRouterFromEnv({
      LBO_PROVIDER_MODE: "local",
      LBO_TEXT_PROVIDER: "mirai",
      LBO_PROVIDER_FALLBACK: "true",
      MIRAI_ENABLED: "true",
      MIRAI_TRANSPORT: "sdk",
      MIRAI_API_KEY: "test-key",
      MIRAI_MODEL_REPO: "Qwen/Qwen3-4B-AWQ"
    });

    expect(router.getSummary()).toEqual(
      expect.objectContaining({
        mode: "local",
        textProvider: "mirai",
        fallbackEnabled: true,
        textProviderStatus: expect.objectContaining({
          id: "mirai",
          available: true,
          reason: "Mirai SDK is configured for model repo 'Qwen/Qwen3-4B-AWQ'."
        })
      })
    );
  });
});
