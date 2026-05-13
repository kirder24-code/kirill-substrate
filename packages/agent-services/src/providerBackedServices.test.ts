import { describe, expect, it } from "vitest";
import type { AIContentGeneration, ContentAsset, Idea, Signal } from "@linkedin-brand-os/shared";
import {
  MockTextProvider,
  MockVisualProvider,
  ProviderRegistry,
  ProviderRouter,
  type TextProvider
} from "@linkedin-brand-os/ai-providers";
import {
  providerBackedBusinessTranslatorService,
  providerBackedPositioningService,
  providerBackedContentService,
  enrichAudienceScoutResult,
  buildGenerateMatchContentInput,
  enrichScoutMatchResult,
  enrichSolutionScoutResult,
  providerBackedMatchContentService,
  providerBackedVisualService,
  providerBackedVoiceEditorService
} from "./index";

const signal: Signal = {
  id: "sig-1",
  title: "AI rollout blockers",
  sourceType: "manual",
  rawText: "Translate technical blockers into business language.",
  status: "new",
  createdAt: "2026-03-14T00:00:00.000Z"
};

const idea: Idea = {
  id: "idea-1",
  signalId: signal.id,
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

describe("provider-backed agent services", () => {
  const createRouter = () => {
    const registry = new ProviderRegistry();
    registry.registerTextProvider(new MockTextProvider());
    registry.registerVisualProvider(new MockVisualProvider());

    return new ProviderRouter(registry, {
      mode: "mock",
      textProvider: "mock-text",
      visualProvider: "mock-visual",
      fallbackEnabled: true
    });
  };

  it("content generation can run through the provider-backed path", async () => {
    const output = await providerBackedContentService({
      idea,
      router: createRouter()
    });

    expect(output.body).toContain("Operational clarity");
    expect(output.hook).toContain("Operational AI rollout");
  });

  it("voice editing can run through the provider-backed path", async () => {
    const output = await providerBackedVoiceEditorService({
      content,
      router: createRouter()
    });

    expect(output.refinementStatus).toBe("refined");
    expect(output.refinedBody).toContain("clear, direct");
  });

  it("visual generation can run through the provider-backed path", async () => {
    const output = await providerBackedVisualService({
      content,
      router: createRouter()
    });

    expect(output.visualType).toBe("single-image");
    expect(output.prompt).toContain("structured visual brief");
  });

  it("scout enrichment can run through the provider-backed path for audience, solution, and matches", async () => {
    const router = createRouter();

    const audience = await enrichAudienceScoutResult(
      {
        items: [
          {
            id: "aud-1",
            sourcePlatform: "public_web",
            rawExcerpt: "Operators still patch workflow handoffs manually.",
            painSignalSummary: "Operators are still cleaning up broken workflow handoffs.",
            whyItMatters: "This shows unresolved execution pain after rollout.",
            suggestedActionType: "post_candidate",
            topicCluster: "Workflow Handoffs",
            confidence: "high",
            createdAt: "2026-03-14T00:00:00.000Z"
          }
        ],
        summary: "1 audience signal shortlisted.",
        notes: "Audience Scout is review-first."
      },
      router
    );
    const solution = await enrichSolutionScoutResult(
      {
        items: [
          {
            id: "sol-1",
            sourceType: "github",
            rawExcerpt: "Expose status and ownership before work stalls.",
            solutionPattern: "Visibility and coordination pattern",
            implementationLesson: "Expose status and ownership early.",
            tradeoffOrConstraint: "Visibility can add noise if ownership is vague.",
            whyItMatters: "Useful operator lesson.",
            suggestedAngle: "workflow_accountability",
            suggestedActionType: "post_candidate",
            confidence: "high",
            createdAt: "2026-03-14T00:00:00.000Z"
          }
        ],
        summary: "1 solution pattern shortlisted.",
        notes: "Solution Scout is review-first."
      },
      router
    );
    const match = await enrichScoutMatchResult(
      {
        items: [
          {
            id: "match-1",
            audienceItemId: "aud-1",
            solutionItemId: "sol-1",
            matchedPain: "Operators are still cleaning up broken workflow handoffs.",
            matchedSolutionPattern: "Visibility and coordination pattern",
            whyThisMatchWorks: "The solution addresses the same ownership gap.",
            suggestedAngle: "workflow_accountability",
            recommendedAction: "write_post",
            confidence: "high",
            createdAt: "2026-03-14T00:00:00.000Z"
          }
        ],
        summary: "1 matched opportunity shortlisted.",
        notes: "Scout matches stay review-first."
      },
      router
    );

    expect(audience.items[0]?.aiEnrichment).toEqual(
      expect.objectContaining({
        improvedSummary: expect.stringContaining("AI insight"),
        businessConsequence: expect.any(String)
      })
    );
    expect(audience.items[0]?.aiEnrichment?.operatorAngle).toBeUndefined();
    expect(solution.items[0]?.aiEnrichment).toEqual(
      expect.objectContaining({
        improvedSummary: expect.any(String),
        operatorAngle: expect.any(String)
      })
    );
    expect(solution.items[0]?.aiEnrichment?.businessConsequence).toBeUndefined();
    expect(match.items[0]?.aiEnrichment).toEqual(
      expect.objectContaining({
        whyItMatters: expect.any(String),
        operatorAngle: expect.any(String)
      })
    );
    expect(match.items[0]?.aiEnrichment?.improvedSummary).toBeUndefined();
  });

  it("deterministic fallback still works if no provider is available", async () => {
    const fallbackRouter = new ProviderRouter(new ProviderRegistry(), {
      mode: "deterministic",
      fallbackEnabled: true
    });

    const translated = await providerBackedBusinessTranslatorService({
      signal,
      router: fallbackRouter
    });
    const positioned = await providerBackedPositioningService({
      signal,
      analysis: {
        id: "analysis-1",
        signalId: signal.id,
        relevanceScore: 80,
        whyRelevant: "Strong operational lesson.",
        targetAudience: "Founders and operators",
        businessValueSummary: "Good brand candidate.",
        painsSolved: ["workflow fragility"],
        practicalImplications: ["clarify queue ownership"],
        uniquenessScore: 65,
        uniquenessReason: "Grounded implementation angle.",
        buildabilityScore: 70,
        buildabilityReason: "Enough implementation detail.",
        popularityPotentialScore: 62,
        brandGrowthPotentialScore: 78,
        createdAt: "2026-03-14T00:00:00.000Z"
      },
      router: fallbackRouter
    });
    const generated = await providerBackedContentService({
      idea,
      router: fallbackRouter
    });
    const enrichedAudience = await enrichAudienceScoutResult(
      {
        items: [
          {
            id: "aud-1",
            sourcePlatform: "public_web",
            rawExcerpt: "Operators still patch workflow handoffs manually.",
            painSignalSummary: "Operators are still cleaning up broken workflow handoffs.",
            whyItMatters: "This shows unresolved execution pain after rollout.",
            suggestedActionType: "post_candidate",
            confidence: "high",
            createdAt: "2026-03-14T00:00:00.000Z"
          }
        ],
        summary: "1 audience signal shortlisted.",
        notes: "Audience Scout is review-first."
      },
      fallbackRouter
    );

    expect(translated.title).toContain("AI rollout blockers");
    expect(positioned.bestAngle).toEqual(expect.any(String));
    expect(generated.hook).toContain("Most teams miss");
    expect(enrichedAudience.items[0]?.aiEnrichment).toBeUndefined();
  });

  it("builds compact reviewed-match content input only when deterministic gating passes", () => {
    const eligible = buildGenerateMatchContentInput({
      id: "saved-match-1",
      match: {
        id: "match-1",
        audienceItemId: "aud-1",
        solutionItemId: "sol-1",
        matchedPain: "Operators are still cleaning up broken workflow handoffs.",
        matchedSolutionPattern: "Visibility and coordination pattern",
        whyThisMatchWorks: "The solution addresses the same ownership gap.",
        suggestedAngle: "workflow_accountability",
        recommendedAction: "write_post",
        confidence: "high",
        aiEnrichment: {
          whyItMatters: "The pairing exposes a repeatable ownership gap.",
          operatorAngle: "Frame it as an operator lesson about recovery ownership."
        },
        createdAt: "2026-03-14T00:00:00.000Z"
      },
      status: "reviewed",
      createdAt: "2026-03-14T00:00:00.000Z"
    });
    const unsupported = buildGenerateMatchContentInput({
      id: "saved-match-2",
      match: {
        id: "match-2",
        audienceItemId: "aud-1",
        solutionItemId: "sol-1",
        matchedPain: "Operators are still cleaning up broken workflow handoffs.",
        matchedSolutionPattern: "Visibility and coordination pattern",
        whyThisMatchWorks: "The solution addresses the same ownership gap.",
        suggestedAngle: "workflow_accountability",
        recommendedAction: "write_reply",
        confidence: "high",
        aiEnrichment: {
          whyItMatters: "The pairing exposes a repeatable ownership gap.",
          operatorAngle: "Frame it as an operator lesson about recovery ownership."
        },
        createdAt: "2026-03-14T00:00:00.000Z"
      },
      status: "reviewed",
      createdAt: "2026-03-14T00:00:00.000Z"
    });
    const weakContext = buildGenerateMatchContentInput({
      id: "saved-match-3",
      match: {
        id: "match-3",
        audienceItemId: "aud-1",
        solutionItemId: "sol-1",
        matchedPain: "",
        matchedSolutionPattern: "Visibility and coordination pattern",
        whyThisMatchWorks: "",
        suggestedAngle: "workflow_accountability",
        recommendedAction: "write_post",
        confidence: "high",
        createdAt: "2026-03-14T00:00:00.000Z"
      },
      status: "reviewed",
      createdAt: "2026-03-14T00:00:00.000Z"
    });

    expect(eligible).toEqual(
      expect.objectContaining({
        itemType: "match",
        recommendedAction: "write_post",
        title: expect.stringContaining("Visibility and coordination pattern")
      })
    );
    expect(unsupported).toBeUndefined();
    expect(weakContext).toBeUndefined();
  });

  it("provider-backed match content generation keeps only action-appropriate fields", async () => {
    const router = createRouter();
    const buildSavedMatch = (
      recommendedAction: "write_post" | "write_comment" | "save_for_later"
    ) => ({
      id: `saved-${recommendedAction}`,
      match: {
        id: `match-${recommendedAction}`,
        audienceItemId: "aud-1",
        solutionItemId: "sol-1",
        matchedPain: "Operators are still cleaning up broken workflow handoffs.",
        matchedSolutionPattern: "Visibility and coordination pattern",
        whyThisMatchWorks: "The solution addresses the same ownership gap.",
        suggestedAngle: "workflow_accountability" as const,
        recommendedAction,
        confidence: "high" as const,
        aiEnrichment: {
          whyItMatters: "The pairing exposes a repeatable ownership gap.",
          operatorAngle: "Frame it as an operator lesson about recovery ownership."
        },
        createdAt: "2026-03-14T00:00:00.000Z"
      },
      status: "reviewed" as const,
      createdAt: "2026-03-14T00:00:00.000Z"
    });

    const post = await providerBackedMatchContentService({
      savedMatch: buildSavedMatch("write_post"),
      router
    });
    const comment = await providerBackedMatchContentService({
      savedMatch: buildSavedMatch("write_comment"),
      router
    });
    const later = await providerBackedMatchContentService({
      savedMatch: buildSavedMatch("save_for_later"),
      router
    });

    expect(post).toEqual(
      expect.objectContaining({
        contentIdea: expect.any(String),
        draftAngle: expect.any(String),
        postSeed: expect.any(String)
      })
    );
    expect(post?.commentSeed).toBeUndefined();
    expect(comment).toEqual(
      expect.objectContaining({
        contentIdea: expect.any(String),
        draftAngle: expect.any(String),
        commentSeed: expect.any(String)
      })
    );
    expect(comment?.postSeed).toBeUndefined();
    expect(later).toEqual(
      expect.objectContaining({
        contentIdea: expect.any(String),
        angleStub: expect.any(String)
      })
    );
    expect(later?.postSeed).toBeUndefined();
    expect(later?.commentSeed).toBeUndefined();
  });

  it("match content generation degrades safely on unsupported actions, empty output, and provider failure", async () => {
    const reviewedReply = {
      id: "saved-reply",
      match: {
        id: "match-reply",
        audienceItemId: "aud-1",
        solutionItemId: "sol-1",
        matchedPain: "Operators are still cleaning up broken workflow handoffs.",
        matchedSolutionPattern: "Visibility and coordination pattern",
        whyThisMatchWorks: "The solution addresses the same ownership gap.",
        suggestedAngle: "workflow_accountability" as const,
        recommendedAction: "write_reply" as const,
        confidence: "high" as const,
        createdAt: "2026-03-14T00:00:00.000Z"
      },
      status: "reviewed" as const,
      createdAt: "2026-03-14T00:00:00.000Z"
    };
    const eligible = {
      ...reviewedReply,
      id: "saved-post",
      match: {
        ...reviewedReply.match,
        id: "match-post",
        recommendedAction: "write_post" as const,
        aiEnrichment: {
          whyItMatters: "The pairing exposes a repeatable ownership gap.",
          operatorAngle: "Frame it as an operator lesson about recovery ownership."
        }
      }
    };

    class EmptyContentProvider implements TextProvider {
      readonly id = "mock-text";
      private readonly base = new MockTextProvider();

      getAvailability() {
        return this.base.getAvailability();
      }

      getCapabilities() {
        return this.base.getCapabilities();
      }

      translateToBusiness(input: Parameters<TextProvider["translateToBusiness"]>[0]) {
        return this.base.translateToBusiness(input);
      }

      generatePostFromIdea(input: Parameters<TextProvider["generatePostFromIdea"]>[0]) {
        return this.base.generatePostFromIdea(input);
      }

      refinePostDraft(input: Parameters<TextProvider["refinePostDraft"]>[0]) {
        return this.base.refinePostDraft(input);
      }

      summarizeSource(input: Parameters<TextProvider["summarizeSource"]>[0]) {
        return this.base.summarizeSource(input);
      }

      positionSignal(input: Parameters<TextProvider["positionSignal"]>[0]) {
        return this.base.positionSignal(input);
      }

      reviewContentAsset(input: Parameters<TextProvider["reviewContentAsset"]>[0]) {
        return this.base.reviewContentAsset(input);
      }

      enrichScoutOutput(input: Parameters<TextProvider["enrichScoutOutput"]>[0]) {
        return this.base.enrichScoutOutput(input);
      }

      async generateMatchContent(
        _input: Parameters<TextProvider["generateMatchContent"]>[0]
      ): Promise<AIContentGeneration | undefined> {
        return {
          contentIdea: "  ",
          draftAngle: "",
          postSeed: " ",
          warnings: [""],
          provider: this.id
        };
      }
    }

    class ThrowingContentProvider implements TextProvider {
      readonly id = "mock-text";
      private readonly base = new MockTextProvider();

      getAvailability() {
        return this.base.getAvailability();
      }

      getCapabilities() {
        return this.base.getCapabilities();
      }

      translateToBusiness(input: Parameters<TextProvider["translateToBusiness"]>[0]) {
        return this.base.translateToBusiness(input);
      }

      generatePostFromIdea(input: Parameters<TextProvider["generatePostFromIdea"]>[0]) {
        return this.base.generatePostFromIdea(input);
      }

      refinePostDraft(input: Parameters<TextProvider["refinePostDraft"]>[0]) {
        return this.base.refinePostDraft(input);
      }

      summarizeSource(input: Parameters<TextProvider["summarizeSource"]>[0]) {
        return this.base.summarizeSource(input);
      }

      positionSignal(input: Parameters<TextProvider["positionSignal"]>[0]) {
        return this.base.positionSignal(input);
      }

      reviewContentAsset(input: Parameters<TextProvider["reviewContentAsset"]>[0]) {
        return this.base.reviewContentAsset(input);
      }

      enrichScoutOutput(input: Parameters<TextProvider["enrichScoutOutput"]>[0]) {
        return this.base.enrichScoutOutput(input);
      }

      async generateMatchContent(
        _input: Parameters<TextProvider["generateMatchContent"]>[0]
      ): Promise<AIContentGeneration | undefined> {
        throw new Error("provider failed");
      }
    }

    const emptyRegistry = new ProviderRegistry();
    emptyRegistry.registerTextProvider(new EmptyContentProvider());
    const emptyRouter = new ProviderRouter(emptyRegistry, {
      mode: "mock",
      textProvider: "mock-text",
      fallbackEnabled: true
    });

    const throwingRegistry = new ProviderRegistry();
    throwingRegistry.registerTextProvider(new ThrowingContentProvider());
    const throwingRouter = new ProviderRouter(throwingRegistry, {
      mode: "mock",
      textProvider: "mock-text",
      fallbackEnabled: true
    });

    await expect(
      providerBackedMatchContentService({
        savedMatch: reviewedReply,
        router: createRouter()
      })
    ).resolves.toBeUndefined();
    await expect(
      providerBackedMatchContentService({
        savedMatch: eligible,
        router: emptyRouter
      })
    ).resolves.toBeUndefined();
    await expect(
      providerBackedMatchContentService({
        savedMatch: eligible,
        router: throwingRouter
      })
    ).resolves.toBeUndefined();
  });

  it("sparse scout enrichment degrades gracefully by kind without changing deterministic fields", async () => {
    class SparseScoutTextProvider extends MockTextProvider {
      override async enrichScoutOutput({
        scout
      }: Parameters<MockTextProvider["enrichScoutOutput"]>[0]) {
        if (scout.kind === "audience") {
          return {
            improvedSummary: "",
            whyItMatters: "",
            businessConsequence: "Slower recovery and messier escalation.",
            operatorAngle: "",
            uncertaintyNote: ""
          };
        }

        if (scout.kind === "solution") {
          return {
            improvedSummary: "",
            whyItMatters: "",
            businessConsequence: "",
            operatorAngle: "Use this as an operator angle about intervening before stalls.",
            uncertaintyNote: ""
          };
        }

        return {
          improvedSummary: "",
          whyItMatters: "This pairing matters because the same ownership gap keeps recurring.",
          businessConsequence: "",
          operatorAngle: "",
          uncertaintyNote: ""
        };
      }
    }

    const registry = new ProviderRegistry();
    registry.registerTextProvider(new SparseScoutTextProvider());
    const router = new ProviderRouter(registry, {
      mode: "mock",
      textProvider: "mock-text",
      fallbackEnabled: true
    });

    const audience = await enrichAudienceScoutResult(
      {
        items: [
          {
            id: "aud-sparse-1",
            sourcePlatform: "public_web",
            rawExcerpt: "Operators still patch workflow handoffs manually.",
            painSignalSummary: "Operators are still cleaning up broken workflow handoffs.",
            whyItMatters: "This shows unresolved execution pain after rollout.",
            suggestedActionType: "post_candidate",
            confidence: "high",
            createdAt: "2026-03-14T00:00:00.000Z"
          }
        ],
        summary: "1 audience signal shortlisted.",
        notes: "Audience Scout is review-first."
      },
      router
    );
    const solution = await enrichSolutionScoutResult(
      {
        items: [
          {
            id: "sol-sparse-1",
            sourceType: "github",
            rawExcerpt: "Expose status and ownership before work stalls.",
            solutionPattern: "Visibility and coordination pattern",
            implementationLesson: "Expose status and ownership early.",
            tradeoffOrConstraint: "Visibility can add noise if ownership is vague.",
            whyItMatters: "Useful operator lesson.",
            suggestedAngle: "workflow_accountability",
            suggestedActionType: "post_candidate",
            confidence: "high",
            createdAt: "2026-03-14T00:00:00.000Z"
          }
        ],
        summary: "1 solution pattern shortlisted.",
        notes: "Solution Scout is review-first."
      },
      router
    );
    const match = await enrichScoutMatchResult(
      {
        items: [
          {
            id: "match-sparse-1",
            audienceItemId: "aud-sparse-1",
            solutionItemId: "sol-sparse-1",
            matchedPain: "Operators are still cleaning up broken workflow handoffs.",
            matchedSolutionPattern: "Visibility and coordination pattern",
            whyThisMatchWorks: "The solution addresses the same ownership gap.",
            suggestedAngle: "workflow_accountability",
            recommendedAction: "write_post",
            confidence: "high",
            createdAt: "2026-03-14T00:00:00.000Z"
          }
        ],
        summary: "1 matched opportunity shortlisted.",
        notes: "Scout matches stay review-first."
      },
      router
    );

    expect(audience.items[0]).toEqual(
      expect.objectContaining({
        painSignalSummary: "Operators are still cleaning up broken workflow handoffs.",
        aiEnrichment: {
          improvedSummary: undefined,
          businessConsequence: "Slower recovery and messier escalation.",
          uncertaintyNote: undefined
        }
      })
    );
    expect(solution.items[0]).toEqual(
      expect.objectContaining({
        solutionPattern: "Visibility and coordination pattern",
        aiEnrichment: {
          improvedSummary: undefined,
          operatorAngle: "Use this as an operator angle about intervening before stalls.",
          uncertaintyNote: undefined
        }
      })
    );
    expect(match.items[0]).toEqual(
      expect.objectContaining({
        recommendedAction: "write_post",
        aiEnrichment: {
          whyItMatters: "This pairing matters because the same ownership gap keeps recurring.",
          operatorAngle: undefined,
          uncertaintyNote: undefined
        }
      })
    );
  });

  it("match enrichment promotes business relevance into why-it-matters when needed", async () => {
    class MatchBusinessRelevanceProvider extends MockTextProvider {
      override async enrichScoutOutput({
        scout
      }: Parameters<MockTextProvider["enrichScoutOutput"]>[0]) {
        if (scout.kind !== "match") {
          return super.enrichScoutOutput({ scout });
        }

        return {
          improvedSummary: "",
          whyItMatters: "",
          businessConsequence:
            "This pairing matters because unresolved ownership gaps slow recovery and raise escalation costs.",
          operatorAngle:
            "Frame it as an operator/content angle about accountability before support cleanup.",
          uncertaintyNote: ""
        };
      }
    }

    const registry = new ProviderRegistry();
    registry.registerTextProvider(new MatchBusinessRelevanceProvider());
    const router = new ProviderRouter(registry, {
      mode: "mock",
      textProvider: "mock-text",
      fallbackEnabled: true
    });

    const match = await enrichScoutMatchResult(
      {
        items: [
          {
            id: "match-business-1",
            audienceItemId: "aud-1",
            solutionItemId: "sol-1",
            matchedPain: "Operators are still cleaning up broken workflow handoffs.",
            matchedSolutionPattern: "Visibility and coordination pattern",
            whyThisMatchWorks: "The solution addresses the same ownership gap.",
            suggestedAngle: "workflow_accountability",
            recommendedAction: "write_post",
            confidence: "high",
            createdAt: "2026-03-14T00:00:00.000Z"
          }
        ],
        summary: "1 matched opportunity shortlisted.",
        notes: "Scout matches stay review-first."
      },
      router
    );

    expect(match.items[0]?.aiEnrichment).toEqual({
      whyItMatters:
        "This pairing matters because unresolved ownership gaps slow recovery and raise escalation costs.",
      operatorAngle:
        "Frame it as an operator/content angle about accountability before support cleanup.",
      uncertaintyNote: undefined
    });
  });

  it("match enrichment prefers pairing-specific business relevance over generic thematic overlap", async () => {
    class MatchQualityFixtureProvider extends MockTextProvider {
      override async enrichScoutOutput({
        scout
      }: Parameters<MockTextProvider["enrichScoutOutput"]>[0]) {
        if (scout.kind !== "match") {
          return super.enrichScoutOutput({ scout });
        }

        return {
          improvedSummary: "The audience pain and solution share a workflow theme.",
          whyItMatters: "",
          businessConsequence:
            "This pairing matters because unresolved ownership gaps keep slowing recovery and increasing support cleanup.",
          operatorAngle:
            "Frame it as an operator/content angle about accountability before support escalation.",
          uncertaintyNote: ""
        };
      }
    }

    const registry = new ProviderRegistry();
    registry.registerTextProvider(new MatchQualityFixtureProvider());
    const router = new ProviderRouter(registry, {
      mode: "mock",
      textProvider: "mock-text",
      fallbackEnabled: true
    });

    const match = await enrichScoutMatchResult(
      {
        items: [
          {
            id: "match-quality-1",
            audienceItemId: "aud-1",
            solutionItemId: "sol-1",
            matchedPain: "Operators are still cleaning up broken workflow handoffs.",
            matchedSolutionPattern: "Visibility and coordination pattern",
            whyThisMatchWorks: "The solution addresses the same ownership gap.",
            suggestedAngle: "workflow_accountability",
            recommendedAction: "write_post",
            confidence: "high",
            createdAt: "2026-03-14T00:00:00.000Z"
          }
        ],
        summary: "1 matched opportunity shortlisted.",
        notes: "Scout matches stay review-first."
      },
      router
    );

    expect(match.items[0]?.aiEnrichment).toEqual({
      whyItMatters:
        "This pairing matters because unresolved ownership gaps keep slowing recovery and increasing support cleanup.",
      operatorAngle:
        "Frame it as an operator/content angle about accountability before support escalation.",
      uncertaintyNote: undefined
    });
  });

  it("match enrichment preserves a strong operator/content angle as the second compact line", async () => {
    class MatchOperatorAngleProvider extends MockTextProvider {
      override async enrichScoutOutput({
        scout
      }: Parameters<MockTextProvider["enrichScoutOutput"]>[0]) {
        if (scout.kind !== "match") {
          return super.enrichScoutOutput({ scout });
        }

        return {
          improvedSummary: "",
          whyItMatters:
            "This pairing matters because the same ownership gap keeps delaying workflow recovery after launch.",
          businessConsequence: "",
          operatorAngle:
            "Use it as a post-ready operator/content angle about preventing support cleanup through clearer ownership.",
          uncertaintyNote: ""
        };
      }
    }

    const registry = new ProviderRegistry();
    registry.registerTextProvider(new MatchOperatorAngleProvider());
    const router = new ProviderRouter(registry, {
      mode: "mock",
      textProvider: "mock-text",
      fallbackEnabled: true
    });

    const match = await enrichScoutMatchResult(
      {
        items: [
          {
            id: "match-angle-1",
            audienceItemId: "aud-1",
            solutionItemId: "sol-1",
            matchedPain: "Operators are still cleaning up broken workflow handoffs.",
            matchedSolutionPattern: "Visibility and coordination pattern",
            whyThisMatchWorks: "The solution addresses the same ownership gap.",
            suggestedAngle: "workflow_accountability",
            recommendedAction: "write_post",
            confidence: "high",
            createdAt: "2026-03-14T00:00:00.000Z"
          }
        ],
        summary: "1 matched opportunity shortlisted.",
        notes: "Scout matches stay review-first."
      },
      router
    );

    expect(match.items[0]?.aiEnrichment).toEqual({
      whyItMatters:
        "This pairing matters because the same ownership gap keeps delaying workflow recovery after launch.",
      operatorAngle:
        "Use it as a post-ready operator/content angle about preventing support cleanup through clearer ownership.",
      uncertaintyNote: undefined
    });
  });

  it("match enrichment stays action-aware across post, comment, and defer fixtures", async () => {
    class MatchActionFixtureProvider extends MockTextProvider {
      override async enrichScoutOutput({
        scout
      }: Parameters<MockTextProvider["enrichScoutOutput"]>[0]) {
        if (scout.kind !== "match") {
          return super.enrichScoutOutput({ scout });
        }

        if (scout.operatorAction === "write_post") {
          return {
            improvedSummary: "",
            whyItMatters:
              "This pairing matters because ownership gaps are still slowing recovery after launch.",
            businessConsequence: "",
            operatorAngle:
              "Use it as a post-ready operator/content angle about accountability before support cleanup.",
            uncertaintyNote: ""
          };
        }

        if (scout.operatorAction === "write_comment") {
          return {
            improvedSummary: "",
            whyItMatters:
              "This pairing matters because the same pain shows up in live operator conversations.",
            businessConsequence: "",
            operatorAngle:
              "Use it as a comment-friendly operator/content angle that adds one practical takeaway.",
            uncertaintyNote: ""
          };
        }

        return {
          improvedSummary: "",
          whyItMatters:
            "This pairing is useful to keep on hand because the ownership gap is real but may need a later conversion moment.",
          businessConsequence: "",
          operatorAngle:
            "Keep the framing review-oriented rather than content-forward until a stronger publishing moment appears.",
          uncertaintyNote: ""
        };
      }
    }

    const registry = new ProviderRegistry();
    registry.registerTextProvider(new MatchActionFixtureProvider());
    const router = new ProviderRouter(registry, {
      mode: "mock",
      textProvider: "mock-text",
      fallbackEnabled: true
    });

    const buildMatch = (recommendedAction: "write_post" | "write_comment" | "save_for_later") =>
      enrichScoutMatchResult(
        {
          items: [
            {
              id: `match-action-${recommendedAction}`,
              audienceItemId: "aud-1",
              solutionItemId: "sol-1",
              matchedPain: "Operators are still cleaning up broken workflow handoffs.",
              matchedSolutionPattern: "Visibility and coordination pattern",
              whyThisMatchWorks: "The solution addresses the same ownership gap.",
              suggestedAngle: "workflow_accountability",
              recommendedAction,
              confidence: "high",
              createdAt: "2026-03-14T00:00:00.000Z"
            }
          ],
          summary: "1 matched opportunity shortlisted.",
          notes: "Scout matches stay review-first."
        },
        router
      );

    const post = await buildMatch("write_post");
    const comment = await buildMatch("write_comment");
    const later = await buildMatch("save_for_later");

    expect(post.items[0]?.recommendedAction).toBe("write_post");
    expect(post.items[0]?.aiEnrichment).toEqual({
      whyItMatters:
        "This pairing matters because ownership gaps are still slowing recovery after launch.",
      operatorAngle:
        "Use it as a post-ready operator/content angle about accountability before support cleanup.",
      uncertaintyNote: undefined
    });

    expect(comment.items[0]?.recommendedAction).toBe("write_comment");
    expect(comment.items[0]?.aiEnrichment).toEqual({
      whyItMatters:
        "This pairing matters because the same pain shows up in live operator conversations.",
      operatorAngle:
        "Use it as a comment-friendly operator/content angle that adds one practical takeaway.",
      uncertaintyNote: undefined
    });

    expect(later.items[0]?.recommendedAction).toBe("save_for_later");
    expect(later.items[0]?.aiEnrichment).toEqual({
      whyItMatters:
        "This pairing is useful to keep on hand because the ownership gap is real but may need a later conversion moment.",
      operatorAngle:
        "Keep the framing review-oriented rather than content-forward until a stronger publishing moment appears.",
      uncertaintyNote: undefined
    });
  });
});
