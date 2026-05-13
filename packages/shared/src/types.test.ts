import { describe, expect, it } from "vitest";
import type {
  AIContentGeneration,
  AIProviderProbeResult,
  AgentRun,
  AutonomousDraftDocument,
  AutonomousContentWorkItem,
  AIRuntimeHealthSummary,
  LaunchPreflightResult,
  LaunchSmokeRunResult,
  LaunchSmokeArtifactsView,
  LaunchSmokeCleanupResult,
  UpdateAutonomousDraftDocumentStatusInput,
  UpdateAutonomousDraftDocumentInput,
  AutonomousIngestionArtifact,
  AutonomousMatchedOpportunity,
  AutonomousReviewQueueItem,
  AutonomousRun,
  AutonomousSchedulerTickResult,
  AutonomousWatchlist,
  AudienceScoutInput,
  AudienceScoutItem,
  AudienceScoutResult,
  AnalyticsSnapshot,
  BrandVoiceProfile,
  CriticReview,
  ContentQueueItem,
  ContentAsset,
  CreateAgentRunInput,
  CreateMemoryPatternInput,
  CreateOrchestratorDecisionInput,
  CreateSignalAnalysisInput,
  CreateSolutionMemoryInput,
  FeedbackAwareThemeTag,
  FeedbackSummary,
  FinalPostGenerationConfig,
  FinalPostQualityMetadata,
  GrowthRhythmInput,
  GrowthRhythmPlan,
  EngagementAdaptationPlan,
  LiveIngestionBuffer,
  LiveIngestionItem,
  MarketProfile,
  MemoryPattern,
  ManualOutcomeFeedback,
  NormalizedSourceSignal,
  OrchestratorDecision,
  PatternMemorySummary,
  PerformanceSnapshot,
  PersistedMatchedOpportunity,
  ProviderConfigSummary,
  ScoutOpportunityContext,
  ScoutFeedInput,
  ScoutFeedResult,
  SignalAnalysis,
  SignalSourceToOutputTrail,
  SourceIntakeInput,
  SolutionScoutInput,
  SolutionScoutItem,
  SolutionScoutResult,
  ScoutMatchInput,
  MatchedOpportunityStore,
  ScoutMatchResult,
  SourceItem,
  SolutionMemory,
  StrategyRecommendation,
  TopicScore,
  WatchlistItem,
  WatchlistStore,
  VisualAsset,
  WritingQualityAssessment
} from "./types";
import {
  buildFeedbackSummary,
  buildPatternMemorySummary,
  extractFeedbackAwareThemeTags
} from "./types";

describe("shared domain types usage", () => {
  it("supports refined content fields", () => {
    const finalConfig: FinalPostGenerationConfig = {
      hookMode: "operational_tension",
      humanTextureLevel: 3,
      businessSharpnessLevel: 3,
      antiBlandness: true,
      outcomeAwareShaping: true,
      preserveBrandVoice: true,
      preservePublishabilityFocus: true
    };

    const finalQualityMetadata: FinalPostQualityMetadata = {
      hookStrengthScore: 91,
      humanFeelScore: 88,
      specificityScore: 84,
      publishabilityScore: 90,
      notes: ["Hook mode: operational_tension", "Anti-blandness shaping applied."],
      outcomePatternBiasNotes: ["Outcome bias: lean into workflow accountability."],
      appliedOutcomeBias: "repeat"
    };

    const asset: ContentAsset = {
      id: "content-1",
      ideaId: "idea-1",
      contentType: "linkedin-post",
      hook: "Original hook",
      body: "Original body",
      cta: "Original cta",
      status: "draft",
      refinementStatus: "refined",
      refinedHook: "Refined hook",
      refinedBody: "Refined body",
      refinedCta: "Refined cta",
      finalHook: "Sharper hook",
      finalBody: "A publishable body with better rhythm.",
      finalClosing: "What are you seeing in your rollout?",
      finalStatus: "ready",
      finalQualityScore: 90,
      finalQualityMetadata,
      createdAt: "2026-03-14T00:00:00.000Z"
    };

    expect(finalConfig.hookMode).toBe("operational_tension");
    expect(finalConfig.antiBlandness).toBe(true);
    expect(finalConfig.outcomeAwareShaping).toBe(true);
    expect(asset.refinementStatus).toBe("refined");
    expect(asset.refinedBody).toBe("Refined body");
    expect(asset.finalStatus).toBe("ready");
    expect(asset.finalHook).toBe("Sharper hook");
    expect(asset.finalQualityMetadata?.hookStrengthScore).toBe(91);
    expect(asset.finalQualityMetadata?.appliedOutcomeBias).toBe("repeat");
  });

  it("supports visual, analytics, and strategy entities", () => {
    const visual: VisualAsset = {
      id: "visual-1",
      contentAssetId: "content-1",
      title: "Visual title",
      visualType: "single-image",
      prompt: "Prompt text",
      status: "ready",
      createdAt: "2026-03-14T00:00:00.000Z"
    };

    const snapshot: AnalyticsSnapshot = {
      id: "analytics-1",
      contentAssetId: "content-1",
      impressions: 1200,
      likes: 64,
      comments: 11,
      saves: 8,
      profileViews: 22,
      followersGained: 6,
      createdAt: "2026-03-14T00:00:00.000Z"
    };

    const recommendation: StrategyRecommendation = {
      id: "strategy-1",
      type: "audience",
      title: "Double down on founder-facing posts",
      description: "Founder-facing operational posts are generating the strongest engagement.",
      priority: "high",
      createdAt: "2026-03-14T00:00:00.000Z"
    };

    expect(visual.visualType).toBe("single-image");
    expect(snapshot.impressions).toBe(1200);
    expect(recommendation.priority).toBe("high");
  });

  it("supports source intake, market intelligence, topic scoring, and queue entities", () => {
    const source: SourceItem = {
      id: "source-1",
      title: "Open-source GTM trend",
      sourceType: "article",
      sourceUrl: "https://example.com/article",
      rawText: "Operators are asking for more grounded AI rollout guidance.",
      normalizedSummary: "Open-source note about grounded AI rollout guidance.",
      tags: ["ai", "operations"],
      status: "normalized",
      createdAt: "2026-03-14T00:00:00.000Z"
    };

    const market: MarketProfile = {
      id: "market-1",
      country: "Canada",
      region: "North America",
      primaryLanguage: "English",
      marketNote: "High concentration of B2B operator audiences.",
      linkedinPriority: "high",
      serviceFitScore: 82,
      createdAt: "2026-03-14T00:00:00.000Z"
    };

    const topicScore: TopicScore = {
      id: "topic-1",
      topicLabel: "AI rollout operations",
      sourceItemId: "source-1",
      marketProfileId: "market-1",
      brandRelevanceScore: 84,
      marketRelevanceScore: 78,
      noveltyScore: 61,
      priorityScore: 79,
      rationale: "Strong operator fit with a high-priority market profile.",
      createdAt: "2026-03-14T00:00:00.000Z"
    };

    const queueItem: ContentQueueItem = {
      id: "queue-1",
      topicScoreId: "topic-1",
      recommendedAction: "write_post",
      priority: "high",
      reason: "Highest priority topic score in the current backlog.",
      status: "queued",
      createdAt: "2026-03-14T00:00:00.000Z"
    };

    expect(source.status).toBe("normalized");
    expect(market.linkedinPriority).toBe("high");
    expect(topicScore.priorityScore).toBe(79);
    expect(queueItem.status).toBe("queued");
  });

  it("supports the canonical source-to-output foundation contracts", () => {
    const analysisInput: CreateSignalAnalysisInput = {
      signalId: "sig-1",
      relevanceScore: 88,
      whyRelevant: "Strong operational lesson with reusable implementation value.",
      targetAudience: "Operator-led B2B founders",
      businessValueSummary: "Useful for both thought leadership and client solution framing.",
      painsSolved: ["handoff ambiguity", "retry ownership"],
      practicalImplications: ["clear ownership", "visible recovery path"],
      overhypeNotes: "Do not frame as a full autonomous system yet.",
      recommendedPillar: "workflow accountability",
      uniquenessScore: 74,
      uniquenessReason: "Grounded implementation angle rather than generic AI commentary.",
      buildabilityScore: 81,
      buildabilityReason: "The implementation clues are concrete enough to adapt.",
      popularityPotentialScore: 69,
      brandGrowthPotentialScore: 83,
      reasoningJson: { mode: "deterministic" }
    };

    const analysis: SignalAnalysis = {
      id: "signal-analysis-1",
      createdAt: "2026-03-16T00:00:00.000Z",
      ...analysisInput
    };

    const content: ContentAsset = {
      id: "content-1",
      ideaId: "idea-1",
      signalId: "sig-1",
      signalAnalysisId: "signal-analysis-1",
      contentType: "linkedin-post",
      hook: "Execution breaks when ownership stays fuzzy.",
      body: "Teams need visible recovery paths after launch.",
      cta: "What does your handoff path look like?",
      bestAngle: "workflow_accountability",
      alternativeAnglesJson: ["ownership_gap"],
      recommendedFormat: "long_linkedin_post",
      longPostDraft: "Long draft",
      shortPostDraft: "Short draft",
      hooksJson: ["Hook A", "Hook B"],
      commentAnglesJson: ["Comment angle A"],
      ctaVariantsJson: ["CTA A"],
      carouselOutline: "Slide 1 -> Slide 2",
      contentStatus: "review",
      publishReadyFlag: false,
      status: "draft",
      createdAt: "2026-03-16T00:05:00.000Z"
    };

    const solutionMemoryInput: CreateSolutionMemoryInput = {
      signalId: "sig-1",
      sourceType: "github_repo",
      implementationPotential: "high",
      implementationComplexity: "medium",
      detectedStack: ["typescript", "fastify", "sqlite"],
      keyFeatures: ["scheduler", "review queue"],
      architectureClues: ["durable server-side workflow state"],
      deploymentHints: ["local sqlite is enough for MVP"],
      clientFitTypes: ["operator-led SaaS"],
      possibleUseCases: ["workflow accountability products"],
      adaptationNotes: "Client version needs stronger tenant isolation.",
      repoReference: "github.com/example/repo",
      readmeSnapshot: "README excerpt",
      implementationNotes: "Strong internal operations pattern."
    };

    const solutionMemory: SolutionMemory = {
      id: "solution-memory-1",
      signalId: "sig-1",
      sourceType: "github_repo",
      implementationPotential: "high",
      implementationComplexity: "medium",
      detectedStack: ["typescript", "fastify", "sqlite"],
      keyFeatures: ["scheduler", "review queue"],
      architectureClues: ["durable server-side workflow state"],
      deploymentHints: ["local sqlite is enough for MVP"],
      clientFitTypes: ["operator-led SaaS"],
      possibleUseCases: ["workflow accountability products"],
      adaptationNotes: solutionMemoryInput.adaptationNotes,
      repoReference: solutionMemoryInput.repoReference,
      readmeSnapshot: solutionMemoryInput.readmeSnapshot,
      implementationNotes: solutionMemoryInput.implementationNotes,
      createdAt: "2026-03-16T00:06:00.000Z",
      updatedAt: "2026-03-16T00:06:00.000Z"
    };

    const criticReview: CriticReview = {
      id: "critic-1",
      contentAssetId: "content-1",
      humanToneScore: 84,
      clarityScore: 86,
      groundednessScore: 90,
      antiRobotScore: 88,
      overallScore: 87,
      notes: ["Grounded and specific."],
      qualityScore: 87,
      genericnessScore: 18,
      businessValueScore: 85,
      differentiationScore: 82,
      publishReadyFlag: false,
      rewriteSuggestions: ["Make the hook sharper."],
      criticNotes: "Strong but could tighten the opening.",
      createdAt: "2026-03-16T00:07:00.000Z"
    };

    const performance: PerformanceSnapshot = {
      id: "analytics-1",
      contentAssetId: "content-1",
      postUrl: "https://linkedin.com/posts/example",
      platform: "linkedin",
      publishedAt: "2026-03-18T00:00:00.000Z",
      audienceGeoHint: "North America",
      audienceSegment: "B2B operators",
      impressions: 1200,
      likes: 64,
      comments: 11,
      saves: 8,
      reactions: 64,
      reposts: 4,
      profileViews: 22,
      followersGained: 6,
      inboundLeads: 2,
      qualitativeNotes: "Operators responded to the implementation detail.",
      createdAt: "2026-03-18T00:00:00.000Z"
    };

    const patternInput: CreateMemoryPatternInput = {
      patternType: "implementation",
      patternKey: "visible-retry-ownership",
      strengthScore: 8,
      supportingEvidenceJson: { contentAssetId: "content-1" },
      recommendedAction: "repeat"
    };

    const pattern: MemoryPattern = {
      id: "pattern-1",
      lastUpdatedAt: "2026-03-18T00:00:00.000Z",
      ...patternInput
    };

    const decisionInput: CreateOrchestratorDecisionInput = {
      signalId: "sig-1",
      decisionType: "promote_to_workspace",
      decisionReason: "High buildability and high brand growth potential.",
      confidenceScore: 82,
      nextAction: "create_draft_seed",
      requiresHumanReview: true
    };

    const decision: OrchestratorDecision = {
      id: "decision-1",
      createdAt: "2026-03-16T00:08:00.000Z",
      ...decisionInput
    };

    const agentRunInput: CreateAgentRunInput = {
      signalId: "sig-1",
      agentName: "signal-analysis",
      modelTier: "deterministic",
      providerName: "fallback",
      status: "completed",
      startedAt: "2026-03-16T00:00:00.000Z",
      completedAt: "2026-03-16T00:00:02.000Z",
      inputSummary: "GitHub repo snapshot",
      outputSummary: "High implementation potential",
      errorMessage: undefined
    };

    const agentRun: AgentRun = {
      id: "agent-run-1",
      ...agentRunInput
    };

    const trail: SignalSourceToOutputTrail = {
      signal: {
        id: "sig-1",
        title: "Repo adds retry ownership",
        sourceType: "github_repo",
        sourceUrl: "https://github.com/example/repo",
        sourceDomain: "github.com",
        sourceTitle: "Example Repo",
        sourceAuthorOrOwner: "example",
        fetchedAt: "2026-03-16T00:00:00.000Z",
        language: "en",
        rawText: "Raw README and release notes text",
        normalizedContent: "Retry ownership and visibility are explicit.",
        contentHash: "hash-1",
        topicTags: ["ops", "visibility"],
        noveltyHint: "Grounded operator angle",
        sourceMetadataJson: { repo: "example/repo" },
        status: "new",
        createdAt: "2026-03-16T00:00:00.000Z"
      },
      analyses: [analysis],
      contentAssets: [content],
      solutionMemories: [solutionMemory],
      criticReviews: [criticReview],
      performanceSnapshots: [performance]
    };

    expect(analysis.reasoningJson?.mode).toBe("deterministic");
    expect(content.signalAnalysisId).toBe("signal-analysis-1");
    expect(solutionMemory.detectedStack).toContain("fastify");
    expect(criticReview.publishReadyFlag).toBe(false);
    expect(performance.inboundLeads).toBe(2);
    expect(pattern.patternKey).toBe("visible-retry-ownership");
    expect(decision.nextAction).toBe("create_draft_seed");
    expect(agentRun.status).toBe("completed");
    expect(trail.solutionMemories).toHaveLength(1);
  });

  it("supports audience scout contracts", () => {
    const scoutInput: AudienceScoutInput = {
      targetTopics: ["AI automation", "workflow chaos"],
      targetRoles: ["COO", "RevOps lead"],
      targetKeywords: ["handoff", "manual work"],
      publicInputs: [
        {
          sourceLabel: "LinkedIn discussion",
          sourceUrl: "https://example.com/post/1",
          excerpt: "We are still patching handoffs manually after every rollout."
        }
      ],
      maxResults: 4
    };

    const item: AudienceScoutItem = {
      id: "scout-ai-automation-1",
      sourcePlatform: "public_web",
      sourceLabel: "LinkedIn discussion",
      sourceUrl: "https://example.com/discussion/ops-chaos",
      authorName: "Alex Operator",
      authorRole: "COO",
      rawExcerpt: "We're still stitching handoffs together in spreadsheets after every launch.",
      painSignalSummary: "Operators are still carrying launch handoffs manually after rollout.",
      whyItMatters: "This signals a public workflow-pain pattern that can support a practical post or comment angle.",
      suggestedActionType: "post_candidate",
      topicCluster: "workflow chaos",
      confidence: "high",
      signalStrength: "strong",
      scoreNotes: ["Clear operational pain", "Specific workflow consequence"],
      createdAt: "2026-03-15T00:00:00.000Z"
    };

    const result: AudienceScoutResult = {
      items: [item],
      summary: "1 audience pain signal surfaced for operator review.",
      notes: "Audience Scout stays review-first and does not execute externally."
    };

    expect(scoutInput.maxResults).toBe(4);
    expect(scoutInput.publicInputs?.[0]?.sourceLabel).toBe("LinkedIn discussion");
    expect(result.items[0]?.suggestedActionType).toBe("post_candidate");
    expect(result.items[0]?.signalStrength).toBe("strong");
    expect(result.summary).toContain("audience pain signal");
  });

  it("supports solution scout contracts", () => {
    const solutionInput: SolutionScoutInput = {
      sourceType: "github",
      targetProblem: "workflow handoff failures",
      sourceLabel: "GitHub release notes",
      sourceUrl: "https://github.com/example/repo/releases/tag/v1.2.0",
      sourceExcerpt:
        "The release adds approval-state visibility and retry ownership so teams can recover stalled workflows faster.",
      operatorNotes: "Useful for operators dealing with rollout gaps."
    };

    const item: SolutionScoutItem = {
      id: "solution-1",
      sourceType: "github",
      sourceLabel: "GitHub release notes",
      sourceUrl: "https://github.com/example/repo/releases/tag/v1.2.0",
      rawExcerpt: solutionInput.sourceExcerpt,
      solutionPattern: "Visibility and recovery ownership pattern",
      implementationLesson: "Give one owner a visible recovery path when workflows stall.",
      tradeoffOrConstraint: "Extra visibility adds coordination overhead if ownership is still unclear.",
      whyItMatters: "Operators can turn this into a practical lesson about resilient rollout design.",
      suggestedAngle: "workflow_accountability",
      suggestedActionType: "post_candidate",
      confidence: "high",
      signalStrength: "strong",
      scoreNotes: ["Concrete implementation lesson", "Tradeoff is explicit"],
      createdAt: "2026-03-15T00:00:00.000Z"
    };

    const result: SolutionScoutResult = {
      items: [item],
      summary: "1 solution pattern shortlisted for review.",
      notes: "Solution Scout stays review-first and deterministic."
    };

    expect(solutionInput.targetProblem).toBe("workflow handoff failures");
    expect(result.items[0]?.suggestedAngle).toBe("workflow_accountability");
    expect(result.items[0]?.signalStrength).toBe("strong");
    expect(result.summary).toContain("solution pattern");
  });

  it("supports scout match contracts", () => {
    const input: ScoutMatchInput = {
      audienceItems: [
        {
          id: "aud-1",
          sourcePlatform: "public_web",
          rawExcerpt: "The handoff breaks after launch.",
          painSignalSummary: "Operators are flagging broken handoffs.",
          whyItMatters: "This points to workflow-accountability pain.",
          suggestedActionType: "post_candidate",
          confidence: "high",
          signalStrength: "strong",
          scoreNotes: ["Clear ownership failure"],
          createdAt: "2026-03-15T00:00:00.000Z"
        }
      ],
      solutionItems: [
        {
          id: "sol-1",
          sourceType: "github",
          rawExcerpt: "Expose approval status and retry ownership.",
          solutionPattern: "Visibility and coordination pattern",
          implementationLesson: "Expose status and ownership early.",
          tradeoffOrConstraint: "Visibility can create noise if ownership is still unclear.",
          whyItMatters: "Useful operator lesson.",
          suggestedAngle: "workflow_accountability",
          suggestedActionType: "post_candidate",
          confidence: "high",
          signalStrength: "strong",
          scoreNotes: ["Implementation details are concrete"],
          createdAt: "2026-03-15T00:00:00.000Z"
        }
      ]
    };

    const result: ScoutMatchResult = {
      items: [
        {
          id: "match-1",
          audienceItemId: "aud-1",
          solutionItemId: "sol-1",
          matchedPain: "Operators are flagging broken handoffs.",
          matchedSolutionPattern: "Visibility and coordination pattern",
          whyThisMatchWorks: "The solution addresses the same ownership gap the audience item exposes.",
          suggestedAngle: "workflow_accountability",
          recommendedAction: "write_post",
          confidence: "high",
          opportunityStrength: "strong",
          scoreNotes: ["High keyword overlap", "Both sides are actionable"],
          createdAt: "2026-03-15T00:00:00.000Z"
        }
      ],
      summary: "1 matched opportunity shortlisted.",
      notes: "Scout matches stay review-first."
    };

    expect(input.audienceItems).toHaveLength(1);
    expect(result.items[0]?.recommendedAction).toBe("write_post");
    expect(result.items[0]?.opportunityStrength).toBe("strong");
  });

  it("supports persisted matched-opportunity contracts", () => {
    const persisted: PersistedMatchedOpportunity = {
      id: "persisted-match-1",
      match: {
        id: "match-1",
        audienceItemId: "aud-1",
        solutionItemId: "sol-1",
        matchedPain: "Operators are flagging broken handoffs.",
        matchedSolutionPattern: "Visibility and coordination pattern",
        whyThisMatchWorks:
          "The solution addresses the same ownership gap the audience item exposes.",
        suggestedAngle: "workflow_accountability",
        recommendedAction: "write_post",
        confidence: "high",
        opportunityStrength: "strong",
        scoreNotes: ["High keyword overlap"],
        aiContent: {
          contentIdea: "Post about the workflow gap behind launch friction.",
          draftAngle: "Tie rollout delays to ownership visibility.",
          postSeed: "Most rollout friction is ownership friction."
        },
        createdAt: "2026-03-15T00:00:00.000Z"
      },
      status: "reviewed",
      createdAt: "2026-03-15T00:00:00.000Z",
      lastActionAt: "2026-03-15T01:00:00.000Z"
    };

    const store: MatchedOpportunityStore = {
      items: [persisted]
    };

    expect(store.items[0]?.match.matchedSolutionPattern).toBe(
      "Visibility and coordination pattern"
    );
    expect(store.items[0]?.status).toBe("reviewed");
    expect(store.items[0]?.match.aiContent?.postSeed).toContain("ownership friction");
  });

  it("supports optional AI content generation contracts for reviewed match-level content prep", () => {
    const generated = {
      itemType: "match" as const,
      recommendedAction: "write_comment" as const,
      title: "Workflow accountability after launch",
      painSummary: "Operators are still patching broken handoffs manually.",
      whyItMatters: "The pairing exposes a repeatable rollout accountability gap.",
      operatorAngle: "Frame it as a practical comment about ownership visibility."
    };

    const content: AIContentGeneration = {
      contentIdea: "Comment on why visibility alone fails when ownership stays vague.",
      draftAngle: "Add one specific execution lesson instead of summarizing the whole problem.",
      commentSeed: "One thing that stands out here: visibility helps only when one owner is obvious.",
      warnings: ["Review the public tone before posting."],
      provider: "mock-text"
    };

    expect(generated.recommendedAction).toBe("write_comment");
    expect(content.commentSeed).toContain("One thing that stands out");
    expect(content.postSeed).toBeUndefined();
  });

  it("supports scout opportunity context for orchestration", () => {
    const context: ScoutOpportunityContext = {
      matchedOpportunities: [
        {
          id: "match-1",
          audienceItemId: "aud-1",
          solutionItemId: "sol-1",
          matchedPain: "Operators are flagging broken handoffs.",
          matchedSolutionPattern: "Visibility and coordination pattern",
          whyThisMatchWorks: "The solution addresses the same ownership gap.",
          suggestedAngle: "workflow_accountability",
          recommendedAction: "write_post",
          confidence: "high",
          opportunityStrength: "strong",
          scoreNotes: ["High keyword overlap"],
          createdAt: "2026-03-15T00:00:00.000Z"
        }
      ],
      savedMatches: [
        {
          id: "saved-match-1",
          match: {
            id: "match-1",
            audienceItemId: "aud-1",
            solutionItemId: "sol-1",
            matchedPain: "Operators are flagging broken handoffs.",
            matchedSolutionPattern: "Visibility and coordination pattern",
            whyThisMatchWorks: "The solution addresses the same ownership gap.",
            suggestedAngle: "workflow_accountability",
            recommendedAction: "write_post",
            confidence: "high",
            createdAt: "2026-03-15T00:00:00.000Z"
          },
          status: "reviewed",
          createdAt: "2026-03-15T00:00:00.000Z"
        }
      ]
    };

    expect(context.matchedOpportunities[0]?.recommendedAction).toBe("write_post");
    expect(context.savedMatches?.[0]?.status).toBe("reviewed");
  });

  it("supports scout feed contracts", () => {
    const input: ScoutFeedInput = {
      mode: "mixed",
      items: [
        {
          sourceType: "public_web",
          sourceLabel: "Ops thread",
          sourceUrl: "https://example.com/thread",
          excerpt: "We still patch the handoff manually after launch."
        },
        {
          sourceType: "github",
          sourceLabel: "Release notes",
          excerpt: "The release adds status visibility and retry ownership.",
          targetProblem: "workflow handoff failures"
        }
      ]
    };

    const result: ScoutFeedResult = {
      audienceItems: [
        {
          id: "aud-1",
          sourcePlatform: "public_web",
          rawExcerpt: "We still patch the handoff manually after launch.",
          painSignalSummary: "Operators are flagging broken handoffs after launch.",
          whyItMatters: "This exposes workflow-accountability pain.",
          suggestedActionType: "post_candidate",
          confidence: "high",
          adapterSummary: {
            family: "public_discussion",
            usedDeterministicFallback: false,
            compactLabel: "Routed as public discussion."
          },
          signalStrength: "strong",
          scoreNotes: ["Clear operational pain"],
          createdAt: "2026-03-15T00:00:00.000Z"
        }
      ],
      solutionItems: [
        {
          id: "sol-1",
          sourceType: "github",
          rawExcerpt: "The release adds status visibility and retry ownership.",
          solutionPattern: "Visibility and coordination pattern",
          implementationLesson: "Expose status and ownership early.",
          tradeoffOrConstraint: "Visibility helps coordination, but it can create noise.",
          whyItMatters: "Useful operator lesson.",
          suggestedAngle: "workflow_accountability",
          suggestedActionType: "post_candidate",
          confidence: "high",
          adapterSummary: {
            family: "github_snapshot",
            usedDeterministicFallback: false,
            compactLabel: "Routed as GitHub snapshot."
          },
          signalStrength: "strong",
          scoreNotes: ["Concrete implementation lesson"],
          createdAt: "2026-03-15T00:00:00.000Z"
        }
      ],
      adapterSummary: {
        families: ["public_discussion", "github_snapshot"],
        usedDeterministicFallback: false,
        compactLabel: "Routed through mixed source adapters."
      },
      audienceAdapterSummary: {
        families: ["public_discussion"],
        usedDeterministicFallback: false,
        compactLabel: "Routed as public discussion."
      },
      solutionAdapterSummary: {
        families: ["github_snapshot"],
        usedDeterministicFallback: false,
        compactLabel: "Routed as GitHub snapshot."
      },
      summary: "2 scout feed items processed.",
      notes: "Scout Feed stays review-first."
    };

    expect(input.mode).toBe("mixed");
    expect(result.audienceItems).toHaveLength(1);
    expect(result.solutionItems).toHaveLength(1);
  });

  it("supports live ingestion buffer contracts", () => {
    const item: LiveIngestionItem = {
      id: "ingestion-1",
      sourceKind: "watched_url_snapshot",
      sourceLabel: "Ops discussion snapshot",
      sourceUrl: "https://example.com/discussion/1",
      rawExcerpt: "Operators are still patching the rollout handoff manually after launch.",
      capturedAt: "2026-03-15T00:00:00.000Z",
      fingerprint: "watched-url-snapshot-ops-discussion-1",
      status: "draft",
      origin: "watchlist_refresh",
      watchlistItemId: "watch-1",
      notes: "Captured from a watched URL snapshot."
    };

    const buffer: LiveIngestionBuffer = {
      items: [item]
    };

    expect(buffer.items[0]?.sourceKind).toBe("watched_url_snapshot");
    expect(buffer.items[0]?.status).toBe("draft");
    expect(buffer.items[0]?.fingerprint).toContain("watched-url");
    expect(buffer.items[0]?.origin).toBe("watchlist_refresh");
  });

  it("supports operator watchlist contracts", () => {
    const item: WatchlistItem = {
      id: "watch-1",
      sourceKind: "github_release",
      label: "Release notes for workflow repo",
      sourceUrl: "https://github.com/example/repo/releases",
      notes: "Watch rollout and adoption changes.",
      refreshCadence: "weekly_candidate",
      priority: "high",
      isActive: true,
      createdAt: "2026-03-15T00:00:00.000Z"
    };

    const store: WatchlistStore = {
      items: [item]
    };

    expect(store.items[0]?.sourceKind).toBe("github_release");
    expect(store.items[0]?.isActive).toBe(true);
    expect(store.items[0]?.label).toContain("workflow repo");
    expect(store.items[0]?.refreshCadence).toBe("weekly_candidate");
    expect(store.items[0]?.priority).toBe("high");
    expect(store.items[0]?.lastRefreshedAt).toBeUndefined();
  });

  it("supports server-side autonomous watchlist contracts", () => {
    const watchlist: AutonomousWatchlist = {
      id: "auto-watch-1",
      sourceKind: "public_discussion_source",
      label: "Workflow pain discussions",
      sourceUrl: "https://example.com/discussions/workflow",
      notes: "Server-side deterministic watchlist for scheduler runs.",
      seedExcerpt: "Operators still patch launch handoffs manually after rollout.",
      targetProblem: "workflow handoff failures",
      refreshCadence: "daily_candidate",
      priority: "high",
      isActive: true,
      lastRunAt: "2026-03-15T00:00:00.000Z",
      nextRunAt: "2026-03-16T00:00:00.000Z",
      createdAt: "2026-03-15T00:00:00.000Z",
      updatedAt: "2026-03-15T00:05:00.000Z"
    };

    expect(watchlist.seedExcerpt).toContain("launch handoffs");
    expect(watchlist.refreshCadence).toBe("daily_candidate");
    expect(watchlist.nextRunAt).toBe("2026-03-16T00:00:00.000Z");
  });

  it("supports server-side autonomous run contracts", () => {
    const run: AutonomousRun = {
      id: "auto-run-1",
      watchlistId: "auto-watch-1",
      triggerType: "scheduler",
      runType: "watchlist_scout_feed",
      status: "completed",
      startedAt: "2026-03-16T00:00:00.000Z",
      completedAt: "2026-03-16T00:00:01.000Z",
      resultSummary: "1 audience item surfaced for operator review.",
      resultMetadata: {
        audienceItemCount: 1,
        solutionItemCount: 0,
        usedAi: false,
        ingestionArtifactCount: 1,
        ingestionStatus: "completed"
      },
      createdAt: "2026-03-16T00:00:00.000Z",
      updatedAt: "2026-03-16T00:00:01.000Z"
    };

    const tick: AutonomousSchedulerTickResult = {
      evaluatedAt: "2026-03-16T00:00:00.000Z",
      dueWatchlistIds: ["auto-watch-1"],
      skippedWatchlistIds: [],
      runs: [run]
    };

    expect(tick.runs[0]?.status).toBe("completed");
    expect(tick.runs[0]?.resultMetadata?.usedAi).toBe(false);
    expect(tick.dueWatchlistIds).toEqual(["auto-watch-1"]);
  });

  it("supports signal-pipeline autonomous run contracts", () => {
    const run: AutonomousRun = {
      id: "auto-run-2",
      signalId: "sig-1",
      triggerType: "manual",
      runType: "signal_pipeline",
      status: "partial",
      startedAt: "2026-03-16T00:00:00.000Z",
      completedAt: "2026-03-16T00:00:05.000Z",
      resultSummary: "Analysis and decision completed, but content generation was intentionally skipped.",
      resultMetadata: {
        audienceItemCount: 0,
        solutionItemCount: 0,
        usedAi: true,
        stageOrder: [
          "analyze_signal",
          "position_signal_and_decide",
          "generate_content_asset",
          "review_content_asset",
          "enqueue_candidate"
        ],
        stagesAttempted: ["analyze_signal", "position_signal_and_decide"],
        stagesCompleted: ["analyze_signal", "position_signal_and_decide"],
        stagesBlocked: [],
        stagesFailed: [],
        producedSignalAnalysisId: "signal-analysis-1",
        producedSolutionMemoryId: "solution-memory-1",
        producedOrchestratorDecisionId: "decision-1"
      },
      createdAt: "2026-03-16T00:00:00.000Z",
      updatedAt: "2026-03-16T00:00:05.000Z"
    };

    expect(run.runType).toBe("signal_pipeline");
    expect(run.signalId).toBe("sig-1");
    expect(run.status).toBe("partial");
    expect(run.resultMetadata?.producedSignalAnalysisId).toBe("signal-analysis-1");
    expect(run.resultMetadata?.stagesCompleted).toContain("position_signal_and_decide");
  });

  it("supports autonomous ingestion artifact contracts", () => {
    const artifact: AutonomousIngestionArtifact = {
      id: "artifact-1",
      watchlistId: "auto-watch-1",
      autonomousRunId: "auto-run-1",
      sourceType: "article",
      sourceUrl: "https://example.com/article",
      title: "Workflow failures after launch",
      rawText: "Teams still patch broken handoffs manually after launch.",
      normalizedSignalText:
        "Teams still patch broken handoffs manually after launch because ownership stays vague.",
      suggestedAngle: "ownership_gap",
      reasoningSummary: "The source points to a recurring ownership gap after rollout.",
      status: "ingested",
      createdAt: "2026-03-16T00:00:00.000Z",
      updatedAt: "2026-03-16T00:00:00.000Z"
    };

    expect(artifact.status).toBe("ingested");
    expect(artifact.normalizedSignalText).toContain("ownership");
    expect(artifact.autonomousRunId).toBe("auto-run-1");
  });

  it("supports autonomous review queue item contracts", () => {
    const item: AutonomousReviewQueueItem = {
      id: "queue-item-1",
      watchlistId: "auto-watch-1",
      autonomousRunId: "auto-run-1",
      sourceArtifactId: "ingest-1",
      sourceKind: "audience",
      dedupeKey: "auto-watch-1:audience:operators still patch broken handoffs manually:write_post",
      title: "Operators still patch broken handoffs manually",
      summary: "Operators are still carrying broken launch handoffs manually after rollout.",
      rationale: "This exposes a recurring workflow-accountability pain worth review.",
      recommendedAction: "write_post",
      status: "new",
      aiEnrichment: {
        whyItMatters: "The pain is visible and specific.",
        operatorAngle: "Frame it as an operator lesson."
      },
      createdAt: "2026-03-16T00:00:00.000Z",
      updatedAt: "2026-03-16T00:00:00.000Z"
    };

    expect(item.recommendedAction).toBe("write_post");
    expect(item.sourceKind).toBe("audience");
    expect(item.aiContent).toBeUndefined();
  });

  it("supports autonomous matched opportunity contracts", () => {
    const opportunity: AutonomousMatchedOpportunity = {
      id: "matched-1",
      watchlistId: "auto-watch-1",
      autonomousRunId: "auto-run-1",
      audienceQueueItemId: "review-1",
      solutionQueueItemId: "review-2",
      dedupeKey: "review-1:review-2",
      title: "Broken handoffs + visibility and recovery ownership",
      matchedPain: "Operators still patch broken handoffs manually",
      matchedSolutionPattern: "Visibility and recovery ownership pattern",
      matchRationale:
        "The solution directly addresses the same ownership gap surfaced by the audience pain.",
      suggestedAngle: "workflow_accountability",
      recommendedAction: "write_post",
      priorityScore: 91,
      priorityBand: "high",
      reasonLines: [
        "High-confidence match with strong opportunity strength.",
        "Write-post action bias lifts priority."
      ],
      confidence: "high",
      opportunityStrength: "strong",
      scoreNotes: ["High keyword overlap", "Both sides are actionable"],
      status: "new",
      reviewState: "new",
      createdAt: "2026-03-16T00:00:00.000Z",
      updatedAt: "2026-03-16T00:00:00.000Z"
    };

    expect(opportunity.recommendedAction).toBe("write_post");
    expect(opportunity.audienceQueueItemId).toBe("review-1");
    expect(opportunity.priorityBand).toBe("high");
    expect(opportunity.reviewState).toBe("new");
    expect(opportunity.aiEnrichment).toBeUndefined();
  });

  it("supports autonomous content work item contracts", () => {
    const workItem: AutonomousContentWorkItem = {
      id: "content-work-1",
      sourceMatchedOpportunityId: "matched-1",
      watchlistId: "auto-watch-1",
      autonomousRunId: "auto-run-1",
      workItemKind: "post",
      title: "Promoted workflow accountability angle",
      summary: "Promoted from a saved high-priority matched opportunity.",
      rationale: "The deterministic match and triage state justify content prep.",
      recommendedAction: "write_post",
      priorityScore: 91,
      priorityBand: "high",
      reviewState: "saved",
      status: "ready_for_draft",
      stateChangedAt: "2026-03-16T00:05:00.000Z",
      workNote: "Ready for a human draft pass.",
      aiContent: {
        contentIdea: "A post about workflow ownership after launch."
      },
      draftSeed: {
        title: "Workflow accountability after launch",
        angle: "Show the hidden ownership cost after rollout.",
        seedText:
          "Teams keep patching broken handoffs manually because no one owns recovery after launch.",
        sourceSummary:
          "Promoted from a saved matched opportunity about broken handoffs and ownership recovery.",
        rationale: "The deterministic match and triage state justify content prep.",
        recommendedAction: "write_post",
        priorityBand: "high"
      },
      draftProgress: {
        hasDraft: true,
        draftId: "draft-1",
        draftStatus: "ready",
        draftUpdatedAt: "2026-03-16T00:06:00.000Z"
      },
      createdAt: "2026-03-16T00:00:00.000Z",
      updatedAt: "2026-03-16T00:00:00.000Z"
    };

    expect(workItem.workItemKind).toBe("post");
    expect(workItem.reviewState).toBe("saved");
    expect(workItem.recommendedAction).toBe("write_post");
    expect(workItem.status).toBe("ready_for_draft");
    expect(workItem.draftSeed?.priorityBand).toBe("high");
    expect(workItem.draftProgress?.draftStatus).toBe("ready");
  });

  it("supports autonomous draft document contracts", () => {
    const draft: AutonomousDraftDocument = {
      id: "draft-1",
      sourceContentWorkItemId: "content-work-1",
      sourceWorkItemTitle: "Workflow recovery work item",
      sourceWorkItemStatus: "ready_for_draft",
      sourceWorkItemRecommendedAction: "write_post",
      sourceWorkItemSummary: "Show where recovery ownership breaks after rollout.",
      title: "Workflow accountability after launch",
      body:
        "Teams keep patching broken handoffs manually because no one owns recovery after launch.",
      angle: "Show the hidden ownership cost after rollout.",
      sourceSummary: "Broken handoffs -> visibility and recovery ownership",
      recommendedAction: "write_post",
      status: "draft",
      createdAt: "2026-03-16T00:00:00.000Z",
      updatedAt: "2026-03-16T00:00:00.000Z"
    };

    expect(draft.sourceContentWorkItemId).toBe("content-work-1");
    expect(draft.sourceWorkItemTitle).toBe("Workflow recovery work item");
    expect(draft.sourceWorkItemStatus).toBe("ready_for_draft");
    expect(draft.sourceWorkItemRecommendedAction).toBe("write_post");
    expect(draft.sourceWorkItemSummary).toContain("recovery ownership");
    expect(draft.status).toBe("draft");
    expect(draft.recommendedAction).toBe("write_post");
  });

  it("supports autonomous draft document update contracts", () => {
    const update: UpdateAutonomousDraftDocumentInput = {
      title: "Refined workflow accountability title",
      body: "A tighter operator-facing draft body.",
      angle: "Focus on recovery ownership after launch."
    };

    expect(update.title).toContain("workflow");
    expect(update.body).toContain("operator");
  });

  it("supports autonomous draft document status update contracts", () => {
    const update: UpdateAutonomousDraftDocumentStatusInput = {
      status: "ready"
    };

    expect(update.status).toBe("ready");
  });

  it("supports lightweight provider routing summary types", () => {
    const summary: ProviderConfigSummary = {
      mode: "mock",
      textProvider: "mock-text",
      visualProvider: "mock-visual",
      fallbackEnabled: true,
      textProviderStatus: {
        id: "mock-text",
        available: true,
        reason: "Ready",
        capabilities: {
          text: true,
          visual: false,
          live: false
        }
      },
      visualProviderStatus: {
        id: "mock-visual",
        available: true,
        reason: "Ready",
        capabilities: {
          text: false,
          visual: true,
          live: false
        }
      }
    };

    expect(summary.mode).toBe("mock");
    expect(summary.fallbackEnabled).toBe(true);
    expect(summary.textProviderStatus?.id).toBe("mock-text");
  });

  it("supports AI runtime health summary types", () => {
    const health: AIRuntimeHealthSummary = {
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
    };

    expect(health.providerMode).toBe("deterministic");
    expect(health.fallbackActive).toBe(true);
    expect(health.configStatus).toBe("fallback_active");
  });

  it("supports AI provider probe result types", () => {
    const probe: AIProviderProbeResult = {
      providerMode: "mock",
      textProvider: "mock-text",
      aiActive: true,
      fallbackActive: false,
      probeStatus: "success",
      probeMessage: "Provider 'mock-text' responded to the explicit probe."
    };

    expect(probe.providerMode).toBe("mock");
    expect(probe.probeStatus).toBe("success");
  });

  it("supports launch preflight result types", () => {
    const preflight: LaunchPreflightResult = {
      launchStatus: "fallback_ready",
      aiReady: false,
      fallbackReady: true,
      providerMode: "deterministic",
      textProvider: null,
      schedulerRuntimeEnabled: false,
      configStatus: "fallback_active",
      issues: [],
      operatorAuthConfig: {
        configured: true,
        missingConfigKeys: []
      }
    };

    expect(preflight.launchStatus).toBe("fallback_ready");
    expect(preflight.fallbackReady).toBe(true);
  });

  it("supports launch smoke run result types", () => {
    const smoke: LaunchSmokeRunResult = {
      launchStatus: "ai_ready",
      runnable: true,
      smokeTag: "launch-smoke:test-token",
      providerMode: "mock",
      textProvider: "mock-text",
      schedulerRuntimeEnabled: true,
      configStatus: "ai_active",
      issues: [],
      artifactCounts: {
        ingestionArtifacts: 2,
        reviewQueueItems: 2,
        matchedOpportunities: 1,
        prioritizedOpportunities: 1,
        contentWorkItems: 1,
        draftDocuments: 1
      }
    };

    expect(smoke.runnable).toBe(true);
    expect(smoke.smokeTag).toBe("launch-smoke:test-token");
    expect(smoke.artifactCounts.draftDocuments).toBe(1);
  });

  it("supports launch smoke artifact inspection view types", () => {
    const view: LaunchSmokeArtifactsView = {
      smokeTag: "launch-smoke:test-token",
      summary: {
        watchlistCount: 0,
        matchedOpportunityCount: 0,
        contentWorkItemCount: 0,
        totalCount: 0
      },
      watchlists: [],
      matchedOpportunities: [],
      contentWorkItems: []
    };

    expect(view.smokeTag).toBe("launch-smoke:test-token");
    expect(view.summary.totalCount).toBe(0);
    expect(view.watchlists).toEqual([]);
  });

  it("supports launch smoke cleanup result types", () => {
    const result: LaunchSmokeCleanupResult = {
      smokeTag: "launch-smoke:test-token",
      deletedWatchlistCount: 2,
      deletedMatchedOpportunityCount: 1,
      deletedContentWorkItemCount: 1,
      totalDeleted: 4
    };

    expect(result.smokeTag).toBe("launch-smoke:test-token");
    expect(result.totalDeleted).toBe(4);
  });

  it("supports brand voice and writing quality entities", () => {
    const voice: BrandVoiceProfile = {
      id: "voice-1",
      name: "Grounded Operator Voice",
      tone: "Direct, practical, calm",
      audience: "Founders and operator-led teams",
      writingRules: ["Use plain business language", "Lead with a concrete problem"],
      bannedPatterns: ["AI is changing everything", "game changer"],
      preferredPatterns: ["operational payoff", "practical rollout"],
      styleNotes: "Keep sentences varied and specific.",
      isActive: true,
      createdAt: "2026-03-14T00:00:00.000Z",
      updatedAt: "2026-03-14T00:00:00.000Z"
    };

    const assessment: WritingQualityAssessment = {
      id: "quality-1",
      contentAssetId: "content-1",
      humanToneScore: 82,
      clarityScore: 84,
      groundednessScore: 88,
      antiRobotScore: 79,
      overallScore: 83,
      notes: [
        "Grounded business language is strong.",
        "Hook avoids generic hype."
      ],
      createdAt: "2026-03-14T00:00:00.000Z"
    };

    expect(voice.isActive).toBe(true);
    expect(assessment.overallScore).toBe(83);
  });

  it("supports engagement adaptation metadata on generated engagement outputs", () => {
    const plan: EngagementAdaptationPlan = {
      engagementMode: "strategic_execution",
      toneDirectives: ["Lead with the execution risk."],
      angleDirective: "ownership_gap",
      depthDirective: "medium",
      closingStyle: "none",
      shouldGenerate: true,
      riskFlags: [],
      metadata: {
        generationType: "comment",
        recommendedAction: "comment",
        targetRole: "Founder"
      }
    };

    expect(plan.engagementMode).toBe("strategic_execution");
    expect(plan.angleDirective).toBe("ownership_gap");
    expect(plan.shouldGenerate).toBe(true);
  });

  it("supports source intake normalization payloads", () => {
    const input: SourceIntakeInput = {
      sourceType: "article",
      title: "Why AI copilots fail after the demo",
      sourceUrl: "https://example.com/copilots",
      summaryText:
        "Most AI copilots look impressive in a demo but fail in production because the surrounding process has no owner or exception path.",
      operatorNotes: "Useful for founder-facing workflow messaging.",
      targetRole: "Founder",
      companyContext: "B2B operator tooling"
    };

    const normalized: NormalizedSourceSignal = {
      sourceType: "article",
      title: input.title,
      sourceUrl: input.sourceUrl,
      rawSummary: input.summaryText,
      normalizedSignalText:
        "Most AI copilots fail after the demo because nobody owns the surrounding workflow or exception path.",
      suggestedAngle: "ownership_gap",
      reasoningSummary: "Article intake points to an ownership gap in a live workflow.",
      targetRole: input.targetRole,
      companyContext: input.companyContext,
      plannerReadyPayload: {
        signalText:
          "Most AI copilots fail after the demo because nobody owns the surrounding workflow or exception path.",
        sourceType: "article",
        targetRole: "Founder",
        companyContext: "B2B operator tooling",
        bestAngle: "ownership_gap",
        reasoningSummary: "Article intake points to an ownership gap in a live workflow."
      }
    };

    expect(normalized.sourceType).toBe("article");
    expect(normalized.plannerReadyPayload.sourceType).toBe("article");
    expect(normalized.suggestedAngle).toBe("ownership_gap");
  });

  it("supports growth rhythm planning payloads", () => {
    const input: GrowthRhythmInput = {
      queueItems: [
        {
          id: "queue-1",
          title: "AI rollout ownership gap",
          suggestedAction: "generate_post_candidate",
          priority: "high",
          status: "new",
          bestAngle: "ownership_gap",
          reasoningSummary: "Strong operator-fit post candidate.",
          sourceType: "manual"
        }
      ],
      savedCandidates: [
        {
          id: "saved-1",
          title: "Comment on workflow handoff post",
          suggestedAction: "generate_comment",
          priority: "medium",
          status: "sent",
          bestAngle: "handoff_failure",
          reasoningSummary: "Worth engaging with this week."
        }
      ],
      recentSignals: [
        {
          id: "sig-1",
          title: "Workflow memory breaks after launch",
          sourceType: "manual",
          status: "new"
        }
      ]
    };

    const plan: GrowthRhythmPlan = {
      topPostCandidates: input.queueItems,
      topCommentCandidates: input.savedCandidates ?? [],
      keepForLater: [],
      weeklyFocus: "Double down on workflow accountability and ownership gaps.",
      suggestedCadence: "2 post candidates, 1 engagement opportunity, 0 to revisit later.",
      reasoningSummary: "Strong post inventory with one clear engagement opportunity."
    };

    expect(plan.topPostCandidates[0]?.suggestedAction).toBe("generate_post_candidate");
    expect(plan.topCommentCandidates[0]?.suggestedAction).toBe("generate_comment");
    expect(plan.weeklyFocus).toContain("workflow");
  });

  it("builds a deterministic feedback summary", () => {
    const records: ManualOutcomeFeedback[] = [
      {
        id: "feedback-1",
        artifactType: "final_post",
        artifactId: "content-1",
        status: "posted",
        responseLevel: "strong",
        gotReplies: true,
        gotLeadSignal: true,
        repeatTopic: true,
        createdAt: "2026-03-14T00:00:00.000Z"
      },
      {
        id: "feedback-2",
        artifactType: "comment",
        artifactId: "comment-1",
        status: "used",
        responseLevel: "weak",
        createdAt: "2026-03-14T01:00:00.000Z"
      }
    ];

    const summary: FeedbackSummary = buildFeedbackSummary(records);

    expect(summary.totalRecords).toBe(2);
    expect(summary.strongPatterns).toContain(
      "Final posts are producing the strongest response signal."
    );
    expect(summary.strongPatterns).toContain(
      "At least one recent artifact triggered lead signal interest."
    );
    expect(summary.weakPatterns).toContain(
      "Some comment or reply attempts are not adding enough traction."
    );
    expect(summary.suggestedRepeats).toContain(
      "Repeat topics that were explicitly marked worth revisiting."
    );
    expect(summary.reasoningSummary).toContain("next week's cadence");
    expect(buildFeedbackSummary(records)).toEqual(summary);
  });

  it("extracts deterministic repeat and avoid theme tags from feedback summary", () => {
    const summary: FeedbackSummary = {
      strongPatterns: [
        "Final posts are producing the strongest response signal.",
        "Comments are earning enough response to stay in the weekly mix."
      ],
      weakPatterns: ["Some comment or reply attempts are not adding enough traction."],
      suggestedRepeats: [
        "Prioritize strong post angles and operator-heavy themes next week."
      ],
      suggestedAvoids: ["Avoid generic engagement unless there is a concrete operator point."],
      reasoningSummary: "Use the strongest patterns next week.",
      totalRecords: 4
    };

    const tags: FeedbackAwareThemeTag[] = extractFeedbackAwareThemeTags(summary);

    expect(tags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "final posts",
          kind: "repeat",
          source: "feedback"
        }),
        expect.objectContaining({
          label: "comments",
          kind: "repeat",
          source: "feedback"
        }),
        expect.objectContaining({
          label: "operator execution",
          kind: "repeat",
          source: "feedback"
        }),
        expect.objectContaining({
          label: "generic engagement",
          kind: "avoid",
          source: "feedback"
        })
      ])
    );
    expect(extractFeedbackAwareThemeTags(summary)).toEqual(tags);
  });

  it("accumulates repeat-worthy patterns over multiple feedback records", () => {
    const records: ManualOutcomeFeedback[] = [
      {
        id: "feedback-1",
        artifactType: "final_post",
        artifactId: "content-1",
        status: "posted",
        responseLevel: "strong",
        repeatTopic: true,
        gotLeadSignal: true,
        createdAt: "2026-03-14T00:00:00.000Z"
      },
      {
        id: "feedback-2",
        artifactType: "final_post",
        artifactId: "content-2",
        status: "posted",
        responseLevel: "strong",
        repeatTopic: true,
        createdAt: "2026-03-15T00:00:00.000Z"
      }
    ];

    const summary: PatternMemorySummary = buildPatternMemorySummary(records);

    expect(summary.repeatPatterns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "repeat-worthy topics",
          kind: "repeat",
          occurrences: 2,
          strength: 4
        })
      ])
    );
    expect(summary.recurringThemes).toContain("repeat-worthy topics");
    expect(summary.notes).toContain("Long-term memory");
  });

  it("accumulates avoid-worthy patterns deterministically", () => {
    const records: ManualOutcomeFeedback[] = [
      {
        id: "feedback-1",
        artifactType: "comment",
        artifactId: "comment-1",
        status: "used",
        responseLevel: "weak",
        createdAt: "2026-03-14T00:00:00.000Z"
      },
      {
        id: "feedback-2",
        artifactType: "comment",
        artifactId: "comment-2",
        status: "not_posted",
        responseLevel: "weak",
        createdAt: "2026-03-15T00:00:00.000Z"
      }
    ];

    const summary = buildPatternMemorySummary(records);

    expect(summary.avoidPatterns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "generic engagement",
          kind: "avoid",
          occurrences: 2
        }),
        expect.objectContaining({
          label: "low posting velocity",
          kind: "avoid"
        })
      ])
    );
    expect(summary.weakThemes).toContain("generic engagement");
    expect(buildPatternMemorySummary(records)).toEqual(summary);
  });
});
