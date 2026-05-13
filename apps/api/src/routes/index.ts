import { z } from "zod";
import type { FastifyInstance } from "fastify";
import {
  AnalysisBlockedError,
  InvalidDraftDocumentError,
  InvalidPromotionError,
  NotFoundError,
  OrchestratorService
} from "@linkedin-brand-os/orchestrator";
import type { BackgroundSchedulerRuntime } from "../backgroundSchedulerRuntime";
import {
  getBearerToken,
  getOperatorAuthConfigDiagnosticsFromEnv,
  type OperatorAuthService
} from "../auth";
import type {
  AIRuntimeHealthSummary,
  AIProviderProbeResult,
  LaunchSmokeArtifactsView,
  LaunchSmokeCleanupResult,
  LaunchSmokeRunResult,
  LaunchPreflightResult,
  CreateAutonomousWatchlistInput,
  AutonomousMatchedOpportunityReviewState,
  AutonomousDraftDocumentStatus,
  AudienceScoutInput,
  DiscoverySourceType,
  GrowthRhythmInput,
  OrchestratedRecommendationInput,
  ScoutMatchInput,
  ScoutFeedInput,
  SolutionScoutInput,
  StrategyAnalysisInput,
  UpdateAutonomousWatchlistInput,
  SourceType
} from "@linkedin-brand-os/shared";

// Shared with the non-API runtime scripts to keep launch diagnostics aligned.
// TypeScript cannot resolve declarations for this cross-package .mjs path cleanly
// under the current workspace setup, so the explicit alias preserves the contract here.
// @ts-expect-error Cross-package .mjs helper is intentionally shared with Node entry scripts.
import { buildAiRuntimeHealthSummary as buildAiRuntimeHealthSummaryScript } from "../../../../packages/ai-providers/scripts/ai-runtime-health.mjs";

const autonomousMatchedOpportunityReviewStateValues = [
  "new",
  "in_review",
  "saved",
  "dismissed",
  "archived"
] as const satisfies readonly AutonomousMatchedOpportunityReviewState[];

const createSignalSchema = z.object({
  title: z.string().min(1),
  sourceType: z.enum(["manual", "research", "crm", "social"]),
  rawText: z.string().min(1)
});

const canonicalSignalIngestionSchema = z
  .object({
    sourceUrl: z.string().url().optional(),
    manualNoteText: z.string().trim().min(1).optional(),
    title: z.string().trim().min(1).max(200).optional(),
    sourceType: z
      .enum(["github_repo", "article", "tool_launch", "manual_note"])
      .optional(),
    sourceAuthorOrOwner: z.string().trim().min(1).max(200).optional(),
    language: z.string().trim().min(2).max(32).optional(),
    topicTags: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
    noveltyHint: z.string().trim().min(1).max(400).optional(),
    sourceMetadataJson: z.record(z.string(), z.unknown()).optional()
  })
  .superRefine((value, ctx) => {
    if (!value.sourceUrl && !value.manualNoteText) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "sourceUrl or manualNoteText is required."
      });
    }
  });

const generateIdeaSchema = z.object({
  signalId: z.string().min(1)
});

const generateContentSchema = z.object({
  ideaId: z.string().min(1)
});

const candidateQueueOperatorActionSchema = z.object({
  action: z.enum(["approve_for_publication", "mark_needs_revision", "archive_candidate"]),
  operatorNote: z.string().trim().max(400).optional()
});

const autonomousMatchedOpportunityReviewStateSchema = z.object({
  reviewState: z.enum(autonomousMatchedOpportunityReviewStateValues),
  reviewNote: z.string().trim().max(400).optional()
});

const autonomousMatchedOpportunityFilterSchema = z.object({
  reviewState: z.enum(autonomousMatchedOpportunityReviewStateValues).optional()
});

const autonomousContentWorkItemKindValues = [
  "post",
  "comment",
  "reply",
  "deferred_note"
] as const;

const autonomousContentWorkflowStatusValues = [
  "draft",
  "parked",
  "ready_for_draft",
  "blocked",
  "archived"
] as const;

const autonomousDraftDocumentStatusValues = [
  "draft",
  "ready",
  "blocked",
  "archived"
] as const satisfies readonly AutonomousDraftDocumentStatus[];

const autonomousContentWorkItemFilterSchema = z.object({
  kind: z.enum(autonomousContentWorkItemKindValues).optional(),
  status: z.enum(autonomousContentWorkflowStatusValues).optional(),
  hasDraft: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  draftStatus: z.enum(autonomousDraftDocumentStatusValues).optional(),
  sort: z.enum(["updated_desc", "updated_asc", "status", "has_draft"]).optional()
});

const autonomousDraftDocumentUpdateSchema = z
  .object({
  title: z.string().trim().min(1).max(200).optional(),
  body: z.string().trim().min(1).max(20000).optional(),
  angle: z.string().trim().max(400).optional()
  })
  .strict();

const autonomousDraftDocumentStatusSchema = z.object({
  status: z.enum(autonomousDraftDocumentStatusValues)
});

const autonomousDraftDocumentFilterSchema = z.object({
  status: z.enum(autonomousDraftDocumentStatusValues).optional(),
  sort: z.enum(["updated_desc", "updated_asc", "status"]).optional()
});

const autonomousContentWorkItemStatusSchema = z.object({
  status: z.enum(autonomousContentWorkflowStatusValues),
  workNote: z.string().trim().max(400).optional()
});

const refineContentSchema = z.object({
  contentId: z.string().min(1)
});

const feedbackSummarySchema = z.object({
  strongPatterns: z.array(z.string()),
  weakPatterns: z.array(z.string()),
  suggestedRepeats: z.array(z.string()),
  suggestedAvoids: z.array(z.string()),
  reasoningSummary: z.string(),
  totalRecords: z.number().int().min(0)
});

const patternMemorySummarySchema = z.object({
  repeatPatterns: z.array(
    z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      kind: z.enum(["repeat", "avoid"]),
      artifactType: z.enum(["final_post", "comment", "reply"]).optional(),
      strength: z.number().int().min(0),
      occurrences: z.number().int().min(0),
      lastSeenAt: z.string().min(1),
      source: z.literal("feedback")
    })
  ),
  avoidPatterns: z.array(
    z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      kind: z.enum(["repeat", "avoid"]),
      artifactType: z.enum(["final_post", "comment", "reply"]).optional(),
      strength: z.number().int().min(0),
      occurrences: z.number().int().min(0),
      lastSeenAt: z.string().min(1),
      source: z.literal("feedback")
    })
  ),
  recurringThemes: z.array(z.string()),
  weakThemes: z.array(z.string()),
  notes: z.string(),
  totalPatterns: z.number().int().min(0)
});

const finalizeContentSchema = z.object({
  contentId: z.string().min(1),
  config: z
    .object({
      hookMode: z
        .enum([
          "sharp_observation",
          "operational_tension",
          "counterintuitive_claim",
          "execution_lesson",
          "field_pattern"
        ])
        .optional(),
      humanTextureLevel: z.number().int().min(1).max(5).optional(),
      businessSharpnessLevel: z.number().int().min(1).max(5).optional(),
      antiBlandness: z.boolean().optional(),
      outcomeAwareShaping: z.boolean().optional(),
      preserveBrandVoice: z.boolean().optional(),
      preservePublishabilityFocus: z.boolean().optional()
    })
    .optional(),
  outcomeContext: z
    .object({
      feedbackSummary: feedbackSummarySchema.optional(),
      patternMemorySummary: patternMemorySummarySchema.optional()
    })
    .optional()
});

const experimentalPostSchema = z.object({
  signalId: z.string().min(1).optional(),
  ideaId: z.string().min(1).optional(),
  contentId: z.string().min(1).optional(),
  brandVoice: z
    .object({
      name: z.string().min(1),
      tone: z.string().min(1),
      audience: z.string().min(1),
      writingRules: z.array(z.string().min(1)),
      bannedPatterns: z.array(z.string().min(1)),
      preferredPatterns: z.array(z.string().min(1)),
      styleNotes: z.string().min(1),
      isActive: z.boolean().default(true)
    })
    .optional()
});

const generateVisualSchema = z.object({
  contentId: z.string().min(1)
});

const generateCommentSchema = z.object({
  sourcePostText: z.string().min(1),
  positioningContext: z.string().optional(),
  relevanceScore: z.number().min(0).max(100).optional(),
  bestAngle: z
    .enum([
      "ownership_gap",
      "handoff_failure",
      "exception_handling",
      "workflow_accountability",
      "operational_roi",
      "low_fit"
    ])
    .optional(),
  recommendedAction: z
    .enum(["ignore", "comment", "reply", "save_for_later", "outreach_candidate"])
    .optional(),
  targetRole: z.string().optional(),
  companyContext: z.string().optional(),
  reasoningSummary: z.string().optional(),
  useRelevanceAdaptation: z.boolean().optional()
});

const generateReplySchema = z.object({
  ourPostText: z.string().min(1),
  incomingCommentText: z.string().min(1),
  context: z.string().optional(),
  relevanceScore: z.number().min(0).max(100).optional(),
  bestAngle: z
    .enum([
      "ownership_gap",
      "handoff_failure",
      "exception_handling",
      "workflow_accountability",
      "operational_roi",
      "low_fit"
    ])
    .optional(),
  recommendedAction: z
    .enum(["ignore", "comment", "reply", "save_for_later", "outreach_candidate"])
    .optional(),
  targetRole: z.string().optional(),
  companyContext: z.string().optional(),
  reasoningSummary: z.string().optional(),
  useRelevanceAdaptation: z.boolean().optional()
});

const analyzeRelevanceSchema = z.object({
  companyText: z.string().optional(),
  roleTitle: z.string().optional(),
  postText: z.string().optional(),
  websiteAboutText: z.string().optional(),
  hasCommentContext: z.boolean().optional()
});

const decisionPlanSchema = z.object({
  signalText: z.string().min(1),
  sourceType: z
    .enum(["manual", "github", "article", "note", "commentary", "other"])
    .optional(),
  signalCategory: z.string().optional(),
  authorRole: z.string().optional(),
  targetRole: z.string().optional(),
  companyContext: z.string().optional(),
  postContext: z.string().optional(),
  relevanceScore: z.number().min(0).max(100).optional(),
  bestAngle: z
    .enum([
      "ownership_gap",
      "handoff_failure",
      "exception_handling",
      "workflow_accountability",
      "operational_roi",
      "low_fit"
    ])
    .optional(),
  recommendedAction: z
    .enum(["ignore", "comment", "reply", "save_for_later", "outreach_candidate"])
    .optional(),
  reasoningSummary: z.string().optional(),
  brandVoiceHints: z.string().optional(),
  recentAnalyticsHints: z.string().optional(),
  hasCommentContext: z.boolean().optional(),
  hasReplyContext: z.boolean().optional()
});

const growthRhythmSchema = z.object({
  queueItems: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      suggestedAction: z.string().min(1),
      priority: z.enum(["high", "medium", "low"]),
      status: z.enum(["new", "sent", "queued", "in_progress", "done", "archived"]),
      bestAngle: z
        .enum([
          "ownership_gap",
          "handoff_failure",
          "exception_handling",
          "workflow_accountability",
          "operational_roi",
          "low_fit"
        ])
        .optional(),
      reasoningSummary: z.string().optional(),
      sourceType: z.string().optional()
    })
  ),
  savedCandidates: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        suggestedAction: z.string().min(1),
        priority: z.enum(["high", "medium", "low"]),
        status: z.enum(["new", "sent", "queued", "in_progress", "done", "archived"]),
        bestAngle: z
          .enum([
            "ownership_gap",
            "handoff_failure",
            "exception_handling",
            "workflow_accountability",
            "operational_roi",
            "low_fit"
          ])
          .optional(),
        reasoningSummary: z.string().optional(),
        sourceType: z.string().optional()
      })
    )
    .optional(),
  feedbackSummary: z
    .object({
      strongPatterns: z.array(z.string()),
      weakPatterns: z.array(z.string()),
      suggestedRepeats: z.array(z.string()),
      suggestedAvoids: z.array(z.string()),
      reasoningSummary: z.string(),
      totalRecords: z.number().int().min(0)
    })
    .optional(),
  patternMemorySummary: z
    .object({
      repeatPatterns: z.array(
        z.object({
          id: z.string().min(1),
          label: z.string().min(1),
          kind: z.enum(["repeat", "avoid"]),
          artifactType: z.enum(["final_post", "comment", "reply"]).optional(),
          strength: z.number().int().min(0),
          occurrences: z.number().int().min(0),
          lastSeenAt: z.string().min(1),
          source: z.literal("feedback")
        })
      ),
      avoidPatterns: z.array(
        z.object({
          id: z.string().min(1),
          label: z.string().min(1),
          kind: z.enum(["repeat", "avoid"]),
          artifactType: z.enum(["final_post", "comment", "reply"]).optional(),
          strength: z.number().int().min(0),
          occurrences: z.number().int().min(0),
          lastSeenAt: z.string().min(1),
          source: z.literal("feedback")
        })
      ),
      recurringThemes: z.array(z.string()),
      weakThemes: z.array(z.string()),
      notes: z.string(),
      totalPatterns: z.number().int().min(0)
    })
    .optional(),
  recentSignals: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        sourceType: z.enum(["manual", "research", "crm", "social"]),
        status: z.enum(["new", "processed", "archived"])
      })
    )
    .optional(),
  recentStrategyRecommendations: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        priority: z.enum(["high", "medium", "low"]),
        description: z.string().min(1)
      })
    )
    .optional()
});

const createAnalyticsSchema = z.object({
  contentAssetId: z.string().min(1),
  postUrl: z.string().url().optional(),
  platform: z.literal("linkedin").optional(),
  publishedAt: z.string().min(1).optional(),
  audienceGeoHint: z.string().min(1).optional(),
  audienceSegment: z.string().min(1).optional(),
  impressions: z.number().int().nonnegative(),
  likes: z.number().int().nonnegative(),
  comments: z.number().int().nonnegative(),
  saves: z.number().int().nonnegative(),
  reactions: z.number().int().nonnegative().optional(),
  reposts: z.number().int().nonnegative().optional(),
  profileViews: z.number().int().nonnegative(),
  followersGained: z.number().int().nonnegative(),
  inboundLeads: z.number().int().nonnegative().optional(),
  qualitativeNotes: z.string().min(1).optional()
});

const strategyAnalyzeSchema = z.object({
  feedbackSummary: z
    .object({
      strongPatterns: z.array(z.string()),
      weakPatterns: z.array(z.string()),
      suggestedRepeats: z.array(z.string()),
      suggestedAvoids: z.array(z.string()),
      reasoningSummary: z.string(),
      totalRecords: z.number().int().min(0)
    })
    .optional(),
  patternMemorySummary: z
    .object({
      repeatPatterns: z.array(
        z.object({
          id: z.string().min(1),
          label: z.string().min(1),
          kind: z.enum(["repeat", "avoid"]),
          artifactType: z.enum(["final_post", "comment", "reply"]).optional(),
          strength: z.number().int().min(0),
          occurrences: z.number().int().min(0),
          lastSeenAt: z.string().min(1),
          source: z.literal("feedback")
        })
      ),
      avoidPatterns: z.array(
        z.object({
          id: z.string().min(1),
          label: z.string().min(1),
          kind: z.enum(["repeat", "avoid"]),
          artifactType: z.enum(["final_post", "comment", "reply"]).optional(),
          strength: z.number().int().min(0),
          occurrences: z.number().int().min(0),
          lastSeenAt: z.string().min(1),
          source: z.literal("feedback")
        })
      ),
      recurringThemes: z.array(z.string()),
      weakThemes: z.array(z.string()),
      notes: z.string(),
      totalPatterns: z.number().int().min(0)
    })
    .optional()
});

const audienceScoutSchema = z.object({
  targetTopics: z.array(z.string().min(1)).default([]),
  targetRoles: z.array(z.string().min(1)).optional(),
  targetKeywords: z.array(z.string().min(1)).optional(),
  publicInputs: z
    .array(
      z.object({
        sourceLabel: z.string().min(1).optional(),
        sourceUrl: z.string().url().optional(),
        excerpt: z.string().min(1)
      })
    )
    .optional(),
  maxResults: z.number().int().min(1).max(10).optional()
});

const solutionScoutSchema = z.object({
  sourceType: z.enum(["github", "article", "manual_research", "mixed"]).optional(),
  targetProblem: z.string().min(1).optional(),
  sourceLabel: z.string().min(1).optional(),
  sourceUrl: z.string().url().optional(),
  sourceExcerpt: z.string().min(1),
  operatorNotes: z.string().min(1).optional()
});

const scoutFeedSchema = z.object({
  mode: z.enum(["audience", "solution", "mixed"]),
  items: z.array(
    z.object({
      sourceType: z.enum(["github", "article", "manual_research", "public_web", "mixed"]).optional(),
      sourceLabel: z.string().min(1).optional(),
      sourceUrl: z.string().url().optional(),
      excerpt: z.string().min(1),
      targetProblem: z.string().min(1).optional()
    })
  ).min(1)
});

const aiScoutEnrichmentSchema = z.object({
  improvedSummary: z.string().min(1).optional(),
  whyItMatters: z.string().min(1).optional(),
  businessConsequence: z.string().min(1).optional(),
  operatorAngle: z.string().min(1).optional(),
  uncertaintyNote: z.string().min(1).optional()
});

const aiContentGenerationSchema = z.object({
  contentIdea: z.string().min(1).optional(),
  draftAngle: z.string().min(1).optional(),
  postSeed: z.string().min(1).optional(),
  commentSeed: z.string().min(1).optional(),
  angleStub: z.string().min(1).optional(),
  warnings: z.array(z.string().min(1)).optional(),
  provider: z.string().min(1).optional()
});

const matchedOpportunitySchema = z.object({
  id: z.string().min(1),
  audienceItemId: z.string().min(1),
  solutionItemId: z.string().min(1),
  matchedPain: z.string().min(1),
  matchedSolutionPattern: z.string().min(1),
  whyThisMatchWorks: z.string().min(1),
  suggestedAngle: z.enum([
    "ownership_gap",
    "handoff_failure",
    "exception_handling",
    "workflow_accountability",
    "operational_roi",
    "low_fit"
  ]),
  recommendedAction: z.enum(["write_post", "write_comment", "write_reply", "save_for_later"]),
  confidence: z.enum(["high", "medium", "low"]),
  aiEnrichment: aiScoutEnrichmentSchema.optional(),
  aiContent: aiContentGenerationSchema.optional(),
  createdAt: z.string().min(1)
});

const persistedMatchedOpportunitySchema = z.object({
  id: z.string().min(1),
  match: matchedOpportunitySchema,
  status: z.enum(["new", "reviewed", "converted", "archived"]),
  createdAt: z.string().min(1),
  lastActionAt: z.string().min(1).optional()
});

const scoutMatchSchema = z.object({
  audienceItems: z.array(
    z.object({
      id: z.string().min(1),
      sourcePlatform: z.literal("public_web"),
      sourceLabel: z.string().min(1).optional(),
      sourceUrl: z.string().url().optional(),
      authorName: z.string().min(1).optional(),
      authorRole: z.string().min(1).optional(),
      rawExcerpt: z.string().min(1),
      painSignalSummary: z.string().min(1),
      whyItMatters: z.string().min(1),
      suggestedActionType: z.enum([
        "post_candidate",
        "comment_opportunity",
        "reply_opportunity",
        "later"
      ]),
      topicCluster: z.string().min(1).optional(),
      confidence: z.enum(["high", "medium", "low"]),
      createdAt: z.string().min(1)
    })
  ),
  solutionItems: z.array(
    z.object({
      id: z.string().min(1),
      sourceType: z.enum(["github", "article", "manual_research", "mixed"]),
      sourceLabel: z.string().min(1).optional(),
      sourceUrl: z.string().url().optional(),
      rawExcerpt: z.string().min(1),
      solutionPattern: z.string().min(1),
      implementationLesson: z.string().min(1),
      tradeoffOrConstraint: z.string().min(1),
      whyItMatters: z.string().min(1),
      suggestedAngle: z.enum([
        "ownership_gap",
        "handoff_failure",
        "exception_handling",
        "workflow_accountability",
        "operational_roi",
        "low_fit"
      ]),
      suggestedActionType: z.enum([
        "post_candidate",
        "comment_opportunity",
        "reply_opportunity",
        "later"
      ]),
      confidence: z.enum(["high", "medium", "low"]),
      createdAt: z.string().min(1)
    })
  ),
  feedbackSummary: feedbackSummarySchema.optional(),
  patternMemorySummary: patternMemorySummarySchema.optional()
});

const orchestratedRecommendationSchema = z.object({
  currentSourceSignal: z
    .object({
      sourceType: z.enum(["article", "manual_research", "github"]),
      title: z.string().min(1),
      rawSummary: z.string().min(1),
      normalizedSignalText: z.string().min(1),
      suggestedAngle: z.enum([
        "ownership_gap",
        "handoff_failure",
        "exception_handling",
        "workflow_accountability",
        "operational_roi",
        "low_fit"
      ]),
      reasoningSummary: z.string().min(1),
      plannerReadyPayload: z.object({
        signalText: z.string().min(1),
        sourceType: z
          .enum(["manual", "github", "article", "note", "commentary", "other"])
          .optional()
      }).passthrough()
    })
    .passthrough()
    .optional(),
  currentDecisionPlan: z
    .object({
      recommendedNextAction: z.enum([
        "generate_post_candidate",
        "generate_comment",
        "generate_reply",
        "save_for_later",
        "ignore"
      ]),
      bestAngle: z.enum([
        "ownership_gap",
        "handoff_failure",
        "exception_handling",
        "workflow_accountability",
        "operational_roi",
        "low_fit"
      ]),
      contentPriority: z.enum(["high", "medium", "low"]),
      engagementPriority: z.enum(["high", "medium", "low"]),
      publishability: z.enum(["high", "medium", "low"]),
      confidence: z.number().min(0).max(100),
      decisionMode: z.literal("deterministic"),
      riskNotes: z.array(z.string()),
      reasoningSummary: z.string(),
      suggestedFlow: z.enum([
        "post_only",
        "engagement_only",
        "post_then_engagement",
        "research_later",
        "ignore"
      ]),
      shouldEscalateToPost: z.boolean(),
      shouldEscalateToEngagement: z.boolean(),
      shouldStoreForLater: z.boolean()
    })
    .optional(),
  growthRhythmPlan: z
    .object({
      topPostCandidates: z.array(growthRhythmSchema.shape.queueItems.element),
      topCommentCandidates: z.array(growthRhythmSchema.shape.queueItems.element),
      keepForLater: z.array(growthRhythmSchema.shape.queueItems.element),
      weeklyFocus: z.string(),
      suggestedCadence: z.string(),
      reasoningSummary: z.string()
    })
    .optional(),
  strategyRecommendations: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        priority: z.enum(["high", "medium", "low"]),
        description: z.string().min(1)
      })
    )
    .optional(),
  feedbackSummary: strategyAnalyzeSchema.shape.feedbackSummary,
  patternMemorySummary: strategyAnalyzeSchema.shape.patternMemorySummary,
  scoutOpportunityContext: z
    .object({
      matchedOpportunities: z.array(matchedOpportunitySchema),
      savedMatches: z
        .array(persistedMatchedOpportunitySchema)
        .optional()
    })
    .optional()
});

const generateMatchContentSchema = z.object({
  savedMatch: persistedMatchedOpportunitySchema
});

const createSourceItemSchema = z.object({
  title: z.string().min(1),
  sourceType: z.enum(["github", "article", "trend", "manual"]),
  sourceUrl: z.string().url().optional(),
  rawText: z.string().min(1)
});

const sourceIntakeSchema = z.object({
  sourceType: z.enum(["article", "manual_research", "github"]),
  title: z.string().min(1),
  sourceUrl: z.string().url().optional(),
  summaryText: z.string().min(1),
  operatorNotes: z.string().optional(),
  githubSubtype: z.enum(["release", "issue", "repo_change"]).optional(),
  repoName: z.string().optional(),
  repoContext: z.string().optional(),
  releaseOrChangeType: z.string().optional(),
  targetRole: z.string().optional(),
  companyContext: z.string().optional()
});

const autoPromotionRulesSchema = z.object({
  enabled: z.boolean(),
  minPriorityScore: z.number().optional(),
  minConfidence: z.enum(["high", "medium", "low"]).optional(),
  minOpportunityStrength: z.enum(["strong", "medium", "weak"]).optional(),
  requireMemoryAlignment: z.boolean().optional(),
  autoDraftGeneration: z.boolean().optional()
});

const autonomousWatchlistBaseSchema = z.object({
  sourceKind: z.enum([
    "watched_url",
    "github_repo",
    "github_release",
    "github_issue",
    "article_source",
    "public_discussion_source"
  ]),
  label: z.string().min(1),
  sourceUrl: z.string().url().optional(),
  notes: z.string().optional(),
  seedExcerpt: z.string().min(1),
  targetProblem: z.string().optional(),
  refreshCadence: z.enum(["manual_only", "daily_candidate", "weekly_candidate"]),
  priority: z.enum(["normal", "high"]).optional(),
  isActive: z.boolean().optional(),
  autoPromotionRules: autoPromotionRulesSchema.optional()
});

const createAutonomousWatchlistSchema = autonomousWatchlistBaseSchema;

const updateAutonomousWatchlistSchema = autonomousWatchlistBaseSchema
  .partial()
  .extend({
    lastRunAt: z.string().optional(),
    nextRunAt: z.string().optional()
  });

const schedulerTickSchema = z.object({
  now: z.string().optional()
});

const createMarketProfileSchema = z.object({
  country: z.string().min(1),
  region: z.string().min(1),
  primaryLanguage: z.string().min(1),
  marketNote: z.string().min(1)
});

const createBrandVoiceSchema = z.object({
  name: z.string().min(1),
  tone: z.string().min(1),
  audience: z.string().min(1),
  writingRules: z.array(z.string().min(1)),
  bannedPatterns: z.array(z.string().min(1)),
  preferredPatterns: z.array(z.string().min(1)),
  styleNotes: z.string().min(1),
  isActive: z.boolean().default(true)
});

export interface RegisterRoutesOptions {
  orchestrator: OrchestratorService;
  backgroundSchedulerRuntime?: BackgroundSchedulerRuntime;
  operatorAuthService: OperatorAuthService;
}

export const buildAiRuntimeHealthSummary: (
  providerSummary: ReturnType<OrchestratorService["getProviderConfigSummary"]>,
  schedulerRuntimeEnabled: boolean
) => AIRuntimeHealthSummary = (providerSummary, schedulerRuntimeEnabled) => ({
  ...buildAiRuntimeHealthSummaryScript(providerSummary, schedulerRuntimeEnabled),
  operatorAuthConfig: getOperatorAuthConfigDiagnosticsFromEnv()
});

export function buildLaunchPreflightResult(
  health: AIRuntimeHealthSummary,
  probe: AIProviderProbeResult
): LaunchPreflightResult {
  const aiReady = health.aiActive && probe.probeStatus === "success";
  const fallbackReady =
    !aiReady &&
    health.fallbackActive &&
    (probe.probeStatus === "inactive" || probe.probeStatus === "failed");

  return {
    launchStatus: aiReady ? "ai_ready" : fallbackReady ? "fallback_ready" : "blocked",
    aiReady,
    fallbackReady,
    providerMode: health.providerMode,
    textProvider: health.textProvider,
    schedulerRuntimeEnabled: health.schedulerRuntimeEnabled,
    configStatus: health.configStatus,
    issues: health.issues,
    operatorAuthConfig: health.operatorAuthConfig
  };
}

export async function runLaunchSmokeRun(
  orchestrator: OrchestratorService,
  schedulerRuntimeEnabled: boolean
): Promise<LaunchSmokeRunResult> {
  const health = buildAiRuntimeHealthSummary(
    orchestrator.getProviderConfigSummary(),
    schedulerRuntimeEnabled
  );
  const probe = await orchestrator.probeTextProvider();
  const preflight = buildLaunchPreflightResult(health, probe);

  if (preflight.launchStatus === "blocked") {
    return {
      launchStatus: "blocked",
      runnable: false,
      providerMode: preflight.providerMode,
      textProvider: preflight.textProvider,
      schedulerRuntimeEnabled: preflight.schedulerRuntimeEnabled,
      configStatus: preflight.configStatus,
      issues: preflight.issues,
      artifactCounts: {
        ingestionArtifacts: 0,
        reviewQueueItems: 0,
        matchedOpportunities: 0,
        prioritizedOpportunities: 0,
        contentWorkItems: 0,
        draftDocuments: 0
      }
    };
  }

  const before = await captureLaunchSmokeArtifactIds(orchestrator);
  const token = new Date().toISOString();
  const smokeTag = buildLaunchSmokeTag(token);
  const audienceWatchlist = await orchestrator.createAutonomousWatchlist({
    sourceKind: "public_discussion_source",
    label: `Launch smoke audience ${token}`,
    sourceUrl: buildLaunchSmokeDataUrl(
      "Workflow handoff thread",
      "Operators still patch broken handoffs manually after rollout because approvals stay vague and ownership is unclear."
    ),
    notes: smokeTag,
    seedExcerpt:
      "Operators still patch broken handoffs manually after rollout because approvals stay vague and ownership is unclear.",
    targetProblem: "workflow handoff failures",
    refreshCadence: "daily_candidate",
    isActive: true
  });
  const solutionWatchlist = await orchestrator.createAutonomousWatchlist({
    sourceKind: "article_source",
    label: `Launch smoke solution ${token}`,
    sourceUrl: buildLaunchSmokeDataUrl(
      "Release adds retry ownership",
      "The update adds approval-state visibility and retry ownership so teams can recover stalled workflows faster."
    ),
    notes: smokeTag,
    seedExcerpt:
      "The update adds approval-state visibility and retry ownership so teams can recover stalled workflows faster.",
    targetProblem: "workflow handoff failures",
    refreshCadence: "daily_candidate",
    isActive: true
  });

  await orchestrator.updateAutonomousWatchlist(audienceWatchlist.id, {
    nextRunAt: "2026-03-16T00:00:00.000Z"
  });
  await orchestrator.updateAutonomousWatchlist(solutionWatchlist.id, {
    nextRunAt: "2026-03-16T00:00:00.000Z"
  });
  await orchestrator.tickAutonomousScheduler("2026-03-16T00:00:00.000Z");

  const matched = (await orchestrator.listAutonomousMatchedOpportunities()).find(
    (item) =>
      item.watchlistId === solutionWatchlist.id ||
      item.watchlistId === audienceWatchlist.id
  );

  if (!matched) {
    throw new Error("Launch smoke run did not produce a matched opportunity.");
  }

  await orchestrator.updateAutonomousMatchedOpportunityReviewState(matched.id, {
    reviewState: "saved",
    reviewNote: `${smokeTag} Launch smoke run promotion path.`
  });
  const workItem = await orchestrator.promoteAutonomousMatchedOpportunity(matched.id);
  if (!workItem) {
    throw new Error("Launch smoke run did not produce a content work item.");
  }
  await orchestrator.updateAutonomousContentWorkItemStatus(workItem.id, {
    status: workItem.status,
    workNote: smokeTag
  });
  const draft = await orchestrator.createAutonomousDraftDocumentFromWorkItem(workItem.id);
  if (!draft) {
    throw new Error("Launch smoke run did not produce a draft document.");
  }

  const after = await captureLaunchSmokeArtifactIds(orchestrator);

  return {
    launchStatus: preflight.launchStatus,
    runnable: true,
    smokeTag,
    providerMode: preflight.providerMode,
    textProvider: preflight.textProvider,
    schedulerRuntimeEnabled: preflight.schedulerRuntimeEnabled,
    configStatus: preflight.configStatus,
    issues: preflight.issues,
    artifactCounts: {
      ingestionArtifacts: countNewArtifactIds(before.ingestionArtifacts, after.ingestionArtifacts),
      reviewQueueItems: countNewArtifactIds(before.reviewQueueItems, after.reviewQueueItems),
      matchedOpportunities: countNewArtifactIds(
        before.matchedOpportunities,
        after.matchedOpportunities
      ),
      prioritizedOpportunities: countNewArtifactIds(
        before.prioritizedOpportunities,
        after.prioritizedOpportunities
      ),
      contentWorkItems: countNewArtifactIds(before.contentWorkItems, after.contentWorkItems),
      draftDocuments: countNewArtifactIds(before.draftDocuments, after.draftDocuments)
    }
  };
}

export async function listLaunchSmokeArtifacts(
  orchestrator: OrchestratorService,
  smokeTag: string
): Promise<LaunchSmokeArtifactsView> {
  const [watchlists, matchedOpportunities, contentWorkItems] = await Promise.all([
    orchestrator.listAutonomousWatchlists(),
    orchestrator.listAutonomousMatchedOpportunities(),
    orchestrator.listAutonomousContentWorkItems()
  ]);

  const filteredWatchlists = watchlists.filter((item) => item.notes === smokeTag);
  const filteredMatchedOpportunities = matchedOpportunities.filter((item) =>
    item.reviewNote?.includes(smokeTag)
  );
  const filteredContentWorkItems = contentWorkItems.filter(
    (item) => item.workNote === smokeTag
  );

  return {
    smokeTag,
    summary: {
      watchlistCount: filteredWatchlists.length,
      matchedOpportunityCount: filteredMatchedOpportunities.length,
      contentWorkItemCount: filteredContentWorkItems.length,
      totalCount:
        filteredWatchlists.length +
        filteredMatchedOpportunities.length +
        filteredContentWorkItems.length
    },
    watchlists: filteredWatchlists,
    matchedOpportunities: filteredMatchedOpportunities,
    contentWorkItems: filteredContentWorkItems
  };
}

export async function registerRoutes(
  app: FastifyInstance,
  options: RegisterRoutesOptions
) {
  const { orchestrator, backgroundSchedulerRuntime, operatorAuthService } = options;
  const publicRoutes = new Set(["/health", "/auth/login"]);

  app.addHook("preHandler", async (request, reply) => {
    const requestPath = request.url.split("?", 1)[0];

    if (publicRoutes.has(requestPath) || isPublicAppShellRequest(requestPath, request.method)) {
      return;
    }

    const token = getBearerToken(request.headers.authorization);
    if (!token) {
      app.log.warn(
        {
          event: "operator_auth_failed",
          reason: "missing_token",
          method: request.method,
          path: requestPath,
          ip: request.ip
        },
        "Operator auth failure"
      );
      return reply.code(401).send({ error: "Operator authentication required." });
    }

    const session = operatorAuthService.getSession(token);
    if (!session) {
      app.log.warn(
        {
          event: "operator_auth_failed",
          reason: "invalid_session",
          method: request.method,
          path: requestPath,
          ip: request.ip
        },
        "Operator auth failure"
      );
      return reply.code(401).send({ error: "Invalid or expired operator session." });
    }
  });

  app.get("/health", async () => ({ ok: true }));
  app.post("/auth/login", async (request, reply) => {
    const credentials = z
      .object({
        username: z.string().trim().min(1),
        password: z.string().min(1)
      })
      .safeParse(request.body);

    if (!credentials.success) {
      return reply.code(400).send({ error: credentials.error.flatten() });
    }

    const session = operatorAuthService.login(
      credentials.data.username,
      credentials.data.password
    );

    if (!session) {
      app.log.warn(
        {
          event: "operator_auth_login_failed",
          username: credentials.data.username,
          ip: request.ip
        },
        "Operator login rejected"
      );
      return reply.code(401).send({ error: "Invalid operator credentials." });
    }

    app.log.info(
      {
        event: "operator_auth_login_success",
        username: session.username,
        ip: request.ip
      },
      "Operator login accepted"
    );

    return {
      username: session.username,
      token: session.token,
      expiresAt: session.expiresAt
    };
  });
  app.get("/auth/session", async (request, reply) => {
    const token = getBearerToken(request.headers.authorization);
    const session = token ? operatorAuthService.getSession(token) : null;

    if (!session) {
      return reply.code(401).send({ error: "Invalid or expired operator session." });
    }

    return {
      username: session.username,
      expiresAt: session.expiresAt
    };
  });
  app.post("/auth/logout", async (request, reply) => {
    const token = getBearerToken(request.headers.authorization);
    if (!token) {
      return reply.code(401).send({ error: "Invalid or expired operator session." });
    }

    const session = operatorAuthService.getSession(token);
    operatorAuthService.logout(token);
    app.log.info(
      {
        event: "operator_auth_logout",
        username: session?.username ?? "unknown",
        ip: request.ip
      },
      "Operator logout"
    );
    return { ok: true };
  });
  app.get("/system/providers", async () => orchestrator.getProviderConfigSummary());
  app.get("/system/ai-runtime-health", async (): Promise<AIRuntimeHealthSummary> =>
    buildAiRuntimeHealthSummary(
      orchestrator.getProviderConfigSummary(),
      backgroundSchedulerRuntime?.getStatus().enabled ?? false
    )
  );
  app.post("/system/ai-probe", async (): Promise<AIProviderProbeResult> =>
    orchestrator.probeTextProvider()
  );
  app.get("/system/operator-control", async () => {
    const [
      aiRuntimeHealth,
      schedulerStatus,
      watchlists,
      recentRuns,
      reviewQueueItems,
      matchedOpportunities,
      contentWorkItems,
      draftDocuments,
      memoryPatterns,
      analyticsSnapshots
    ] = await Promise.all([
      buildAiRuntimeHealthSummary(
        orchestrator.getProviderConfigSummary(),
        backgroundSchedulerRuntime?.getStatus().enabled ?? false
      ),
      backgroundSchedulerRuntime?.getStatus() ?? {
        enabled: false,
        running: false,
        intervalMs: 0,
        isTickInFlight: false
      },
      orchestrator.listAutonomousWatchlists(),
      orchestrator.listAutonomousRuns(),
      orchestrator.listAutonomousReviewQueueItems(),
      orchestrator.listAutonomousMatchedOpportunities(),
      orchestrator.listAutonomousContentWorkItems(),
      orchestrator.listAutonomousDraftDocuments(),
      orchestrator.listMemoryPatterns(),
      orchestrator.listAnalyticsSnapshots()
    ]);

    const providerConfig = orchestrator.getProviderConfigSummary();
    const last10Runs = recentRuns
      .sort((a, b) => {
        const aTime = a.startedAt ? new Date(a.startedAt).getTime() : 0;
        const bTime = b.startedAt ? new Date(b.startedAt).getTime() : 0;
        return bTime - aTime;
      })
      .slice(0, 10);

    const failedRuns = last10Runs.filter((r) => r.status === "failed");
    const staleRuns = recentRuns.filter((r) => {
      if (r.status !== "running") return false;
      if (!r.startedAt) return false;
      const runAge = Date.now() - new Date(r.startedAt).getTime();
      return runAge > 10 * 60 * 1000;
    });

    const activeWatchlists = watchlists.filter((w) => w.isActive);
    const recentSuccessfulRuns = last10Runs.filter((r) => r.status === "completed").length;

    const newReviewItems = reviewQueueItems.filter((i) => i.status === "new").length;
    const newMatches = matchedOpportunities.filter((m) => m.reviewState === "new").length;
    const savedMatches = matchedOpportunities.filter((m) => m.reviewState === "saved").length;

    const readyDrafts = draftDocuments.filter((d) => d.status === "ready").length;
    const blockedDrafts = draftDocuments.filter((d) => d.status === "blocked").length;
    const draftQueueSize = draftDocuments.filter(
      (d) => d.status !== "archived"
    ).length;

    const strongPatterns = memoryPatterns
      .filter((p) => p.recommendedAction === "repeat" && p.strengthScore >= 2)
      .sort((a, b) => b.strengthScore - a.strengthScore)
      .slice(0, 5);

    const recentAnalytics = analyticsSnapshots.filter((a) => {
      const age = Date.now() - new Date(a.createdAt).getTime();
      return age < 30 * 24 * 60 * 60 * 1000; // last 30 days
    }).length;

    return {
      runtimeHealth: {
        schedulerEnabled: schedulerStatus.enabled,
        schedulerRunning: schedulerStatus.running,
        lastTickAt: schedulerStatus.lastTickCompletedAt,
        lastTickStatus: schedulerStatus.lastTickOutcome?.status,
        tickInFlight: schedulerStatus.isTickInFlight,
        failedRunsCount: failedRuns.length,
        staleRunsCount: staleRuns.length
      },
      intakeHealth: {
        totalWatchlists: watchlists.length,
        activeWatchlists: activeWatchlists.length,
        recentSuccessfulRuns: recentSuccessfulRuns,
        last10RunsTotal: last10Runs.length
      },
      opportunityFlow: {
        reviewQueueSize: reviewQueueItems.filter((i) => i.status === "new").length,
        newMatchesCount: newMatches,
        savedMatchesCount: savedMatches,
        workItemsCount: contentWorkItems.filter((w) => w.status !== "archived").length,
        autoPromotionActive: watchlists.some((w) => w.autoPromotionRules?.enabled),
        autoPromotionWatchlists: watchlists.filter((w) => w.autoPromotionRules?.enabled).length
      },
      draftFlow: {
        readyForReview: readyDrafts,
        blocked: blockedDrafts,
        totalActive: draftQueueSize
      },
      providerTruth: {
        mode: providerConfig.mode,
        textProvider: providerConfig.textProvider,
        visualProvider: providerConfig.visualProvider,
        fallbackEnabled: providerConfig.fallbackEnabled,
        aiActive: aiRuntimeHealth.aiActive
      },
      learningTruth: {
        recentAnalyticsCount: recentAnalytics,
        totalMemoryPatterns: memoryPatterns.length,
        strongPatternsCount: strongPatterns.length,
        strongestPatterns: strongPatterns.map((p) => ({
          type: p.patternType,
          key: p.patternKey,
          score: p.strengthScore
        }))
      },
      operatorAttention: {
        needsReview: [
          ...(failedRuns.length > 0 ? [`${failedRuns.length} failed runs`] : []),
          ...(staleRuns.length > 0 ? [`${staleRuns.length} stale runs`] : []),
          ...(newReviewItems > 0 ? [`${newReviewItems} review queue items`] : []),
          ...(newMatches > 0 ? [`${newMatches} new matches`] : []),
          ...(readyDrafts > 0 ? [`${readyDrafts} drafts ready`] : [])
        ],
        degraded: [
          ...(!schedulerStatus.enabled ? ["Scheduler disabled"] : []),
          ...(activeWatchlists.length === 0 ? ["No active watchlists"] : []),
          ...(blockedDrafts > 0 ? [`${blockedDrafts} blocked drafts`] : []),
          ...(!aiRuntimeHealth.aiActive ? ["AI providers unavailable"] : [])
        ],
        healthy: [
          ...(schedulerStatus.enabled ? ["Scheduler enabled"] : []),
          ...(activeWatchlists.length > 0
            ? [`${activeWatchlists.length} active watchlists`]
            : []),
          ...(recentSuccessfulRuns > 0
            ? [`${recentSuccessfulRuns} successful runs`]
            : []),
          ...(strongPatterns.length > 0
            ? [`${strongPatterns.length} strong patterns learned`]
            : [])
        ]
      }
    };
  });
  app.get("/system/launch-preflight", async (): Promise<LaunchPreflightResult> => {
    const health = buildAiRuntimeHealthSummary(
      orchestrator.getProviderConfigSummary(),
      backgroundSchedulerRuntime?.getStatus().enabled ?? false
    );
    const probe = await orchestrator.probeTextProvider();
    return buildLaunchPreflightResult(health, probe);
  });
  app.get("/system/launch-smoke-artifacts", async (request, reply) => {
    const smokeTag = z
      .object({
        smokeTag: z.string().trim().min(1)
      })
      .safeParse(request.query);

    if (!smokeTag.success) {
      return reply.code(400).send({ error: smokeTag.error.flatten() });
    }

    return listLaunchSmokeArtifacts(orchestrator, smokeTag.data.smokeTag);
  });
  app.delete("/system/launch-smoke-artifacts", async (request, reply) => {
    const smokeTag = z
      .object({
        smokeTag: z.string().trim().min(1)
      })
      .safeParse(request.query);

    if (!smokeTag.success) {
      return reply.code(400).send({ error: smokeTag.error.flatten() });
    }

    return orchestrator.cleanupLaunchSmokeArtifacts(smokeTag.data.smokeTag);
  });
  app.post("/system/launch-smoke-run", async (): Promise<LaunchSmokeRunResult> =>
    runLaunchSmokeRun(
      orchestrator,
      backgroundSchedulerRuntime?.getStatus().enabled ?? false
    )
  );
  app.get("/autonomy/runtime/status", async () =>
    backgroundSchedulerRuntime?.getStatus() ?? {
      enabled: false,
      running: false,
      intervalMs: 0,
      isTickInFlight: false
    }
  );
  app.get("/brand-voice", async () => ({
    active: await orchestrator.getActiveBrandVoiceProfile(),
    profiles: await orchestrator.listBrandVoiceProfiles()
  }));

  app.get("/signals", async () => orchestrator.listSignals());

  app.post("/brand-voice", async (request, reply) => {
    const parsed = createBrandVoiceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const profile = await orchestrator.createBrandVoiceProfile(parsed.data);
    return reply.code(201).send(profile);
  });

  app.post("/signals", async (request, reply) => {
    const parsed = createSignalSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const signal = await orchestrator.ingestSignal({
      title: parsed.data.title,
      sourceType: parsed.data.sourceType as SourceType,
      rawText: parsed.data.rawText
    });
    return reply.code(201).send(signal);
  });

  app.post("/signals/intake", async (request, reply) => {
    const parsed = canonicalSignalIngestionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const signal = await orchestrator.ingestCanonicalSignal(parsed.data);
    return reply.code(201).send(signal);
  });

  app.post("/signals/:id/analyze", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: params.error.flatten() });
    }

    try {
      const result = await orchestrator.analyzeSignal(params.data.id);
      return reply.code(201).send(result);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return reply.code(404).send({ error: error.message });
      }
      if (error instanceof AnalysisBlockedError) {
        return reply.code(409).send({ error: error.message });
      }
      throw error;
    }
  });

  app.post("/signals/:id/position", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: params.error.flatten() });
    }

    try {
      const result = await orchestrator.positionSignalAndDecide(params.data.id);
      return reply.code(201).send(result);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return reply.code(404).send({ error: error.message });
      }
      if (error instanceof AnalysisBlockedError) {
        return reply.code(409).send({ error: error.message });
      }
      throw error;
    }
  });

  app.post("/signals/:id/content", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: params.error.flatten() });
    }

    try {
      const result = await orchestrator.generateContentAssetForSignal(params.data.id);
      return reply.code(201).send(result);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return reply.code(404).send({ error: error.message });
      }
      if (error instanceof AnalysisBlockedError) {
        return reply.code(409).send({ error: error.message });
      }
      throw error;
    }
  });

  app.post("/signals/:id/run", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: params.error.flatten() });
    }

    try {
      const result = await orchestrator.runAutonomousSignalPipeline(params.data.id);
      return reply.code(201).send(result);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return reply.code(404).send({ error: error.message });
      }
      throw error;
    }
  });

  app.post("/content/:id/review", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: params.error.flatten() });
    }

    try {
      const result = await orchestrator.reviewContentAsset(params.data.id);
      return reply.code(201).send(result);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return reply.code(404).send({ error: error.message });
      }
      if (error instanceof AnalysisBlockedError) {
        return reply.code(409).send({ error: error.message });
      }
      throw error;
    }
  });

  app.get("/candidate-queue", async () => orchestrator.listCandidateQueueItems());

  app.get("/candidate-queue/:id", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: params.error.flatten() });
    }

    try {
      return await orchestrator.getCandidateQueueItemDetail(params.data.id);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return reply.code(404).send({ error: error.message });
      }
      throw error;
    }
  });

  app.patch("/candidate-queue/:id", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: params.error.flatten() });
    }

    const payload = candidateQueueOperatorActionSchema.safeParse(request.body);
    if (!payload.success) {
      return reply.code(400).send({ error: payload.error.flatten() });
    }

    try {
      const result = await orchestrator.applyCandidateQueueOperatorAction(params.data.id, payload.data);
      return reply.code(200).send(result);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return reply.code(404).send({ error: error.message });
      }
      throw error;
    }
  });

  app.get("/factory/priority", async (request, reply) => {
    const parsed = z
      .object({
        now: z.string().datetime().optional()
      })
      .safeParse(request.query);

    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    return orchestrator.evaluateFactoryPriority(parsed.data);
  });

  app.get("/factory/runs", async () => orchestrator.listAutonomousRuns());
  app.get("/factory/memory-patterns", async () => orchestrator.listMemoryPatterns());
  app.get("/factory/solution-memories", async () => orchestrator.listSolutionMemories());
  app.get("/factory/critic-reviews", async () => orchestrator.listWritingQualityAssessments());

  app.post("/signals/:id/enqueue-candidate", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: params.error.flatten() });
    }

    try {
      const result = await orchestrator.enqueueCandidateForSignal(params.data.id);
      return reply.code(201).send(result);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return reply.code(404).send({ error: error.message });
      }
      if (error instanceof AnalysisBlockedError) {
        return reply.code(409).send({ error: error.message });
      }
      throw error;
    }
  });

  app.get("/ideas", async () => orchestrator.listIdeas());

  app.post("/ideas/generate", async (request, reply) => {
    const parsed = generateIdeaSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    try {
      const idea = await orchestrator.generateIdeaFromSignal(parsed.data.signalId);
      return reply.code(201).send(idea);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return reply.code(404).send({ error: error.message });
      }

      throw error;
    }
  });

  app.get("/content", async () => orchestrator.listContentAssets());

  app.get("/autonomy/content-assets", async () => orchestrator.listAutonomousContentAssets());

  app.patch("/autonomy/content-assets/:id/status", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: params.error.flatten() });
    }

    const body = z.object({
      status: z.enum(["draft", "review", "ready", "published", "archived"])
    }).safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.flatten() });
    }

    const updated = await orchestrator.updateAutonomousContentAssetStatus(
      params.data.id,
      body.data.status
    );
    if (!updated) {
      return reply.code(404).send({ error: "Content asset not found." });
    }

    return reply.code(200).send(updated);
  });

  app.post("/content/generate", async (request, reply) => {
    const parsed = generateContentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    try {
      const content = await orchestrator.generateContentFromIdea(parsed.data.ideaId);
      return reply.code(201).send(content);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return reply.code(404).send({ error: error.message });
      }

      throw error;
    }
  });

  app.post("/content/refine", async (request, reply) => {
    const parsed = refineContentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    try {
      const content = await orchestrator.refineContentDraft(parsed.data.contentId);
      return reply.code(201).send(content);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return reply.code(404).send({ error: error.message });
      }

      throw error;
    }
  });

  app.post("/content/finalize", async (request, reply) => {
    const parsed = finalizeContentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    try {
      const content = await orchestrator.generateFinalPost(
        parsed.data.contentId,
        parsed.data.config,
        parsed.data.outcomeContext
      );
      return reply.code(201).send(content);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return reply.code(404).send({ error: error.message });
      }

      throw error;
    }
  });

  app.post("/content/experimental-v2", async (request, reply) => {
    const parsed = experimentalPostSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    try {
      const post = await orchestrator.generateExperimentalPostV2(parsed.data);
      return reply.code(201).send(post);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return reply.code(404).send({ error: error.message });
      }

      throw error;
    }
  });

  app.post("/content/finalize-v2", async (request, reply) => {
    const parsed = z
      .object({
        contentId: z.string().min(1)
      })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    try {
      const post = await orchestrator.generateExperimentalPostV2({
        contentId: parsed.data.contentId
      });
      return reply.code(201).send(post);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return reply.code(404).send({ error: error.message });
      }

      throw error;
    }
  });

  app.post("/comments/generate", async (request, reply) => {
    const parsed = generateCommentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const comment = await orchestrator.generateComment(parsed.data);
    return reply.code(201).send(comment);
  });

  app.post("/replies/generate", async (request, reply) => {
    const parsed = generateReplySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const replyDraft = await orchestrator.generateReply(parsed.data);
    return reply.code(201).send(replyDraft);
  });

  app.post("/relevance/analyze", async (request, reply) => {
    const parsed = analyzeRelevanceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const result = await orchestrator.analyzeRelevance(parsed.data);
    return reply.code(201).send(result);
  });

  app.post("/decision/plan", async (request, reply) => {
    const parsed = decisionPlanSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const result = await orchestrator.planDecision(parsed.data);
    return reply.code(201).send(result);
  });

  app.post("/growth/rhythm", async (request, reply) => {
    const parsed = growthRhythmSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const result = await orchestrator.planGrowthRhythm(parsed.data as GrowthRhythmInput);
    return reply.code(201).send(result);
  });

  app.get("/visuals", async () => orchestrator.listVisualAssets());

  app.post("/visuals/generate", async (request, reply) => {
    const parsed = generateVisualSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    try {
      const visual = await orchestrator.generateVisualForContent(parsed.data.contentId);
      return reply.code(201).send(visual);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return reply.code(404).send({ error: error.message });
      }

      throw error;
    }
  });

  app.get("/analytics", async () => orchestrator.listAnalyticsSnapshots());

  app.post("/analytics", async (request, reply) => {
    const parsed = createAnalyticsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const snapshot = await orchestrator.recordAnalyticsSnapshot(parsed.data);
    return reply.code(201).send(snapshot);
  });

  app.post("/analytics/learn", async (request, reply) => {
    const parsed = createAnalyticsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    try {
      const result = await orchestrator.recordAnalyticsSnapshotAndUpdateMemory(parsed.data);
      return reply.code(201).send(result);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return reply.code(404).send({ error: error.message });
      }

      throw error;
    }
  });

  app.get(
    "/strategy/recommendations",
    async () => orchestrator.listStrategyRecommendations()
  );

  app.post("/strategy/analyze", async (request, reply) => {
    const parsed = strategyAnalyzeSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const recommendations = await orchestrator.analyzePerformance(
      parsed.data as StrategyAnalysisInput
    );
    return reply.code(201).send(recommendations);
  });

  app.post("/orchestrator/recommend", async (request, reply) => {
    const parsed = orchestratedRecommendationSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const recommendation = await orchestrator.recommendNextMove(
      parsed.data as OrchestratedRecommendationInput
    );
    return reply.code(201).send(recommendation);
  });

  app.post("/audience/scout", async (request, reply) => {
    const parsed = audienceScoutSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const result = await orchestrator.scoutAudience(parsed.data as AudienceScoutInput);
    return reply.code(201).send(result);
  });

  app.post("/solutions/scout", async (request, reply) => {
    const parsed = solutionScoutSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const result = await orchestrator.scoutSolutions(parsed.data as SolutionScoutInput);
    return reply.code(201).send(result);
  });

  app.post("/scout/feed", async (request, reply) => {
    const parsed = scoutFeedSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const result = await orchestrator.runScoutFeed(parsed.data as ScoutFeedInput);
    return reply.code(201).send(result);
  });

  app.post("/scout/match", async (request, reply) => {
    const parsed = scoutMatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const result = await orchestrator.matchScoutOpportunities(parsed.data as ScoutMatchInput);
    return reply.code(201).send(result);
  });

  app.post("/matches/content/generate", async (request, reply) => {
    const parsed = generateMatchContentSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const result = await orchestrator.generateMatchContent(parsed.data.savedMatch);
    return reply.code(201).send(result);
  });

  app.get("/autonomy/watchlists", async () => orchestrator.listAutonomousWatchlists());

  app.post("/autonomy/watchlists", async (request, reply) => {
    const parsed = createAutonomousWatchlistSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const watchlist = await orchestrator.createAutonomousWatchlist(
      parsed.data as CreateAutonomousWatchlistInput
    );
    return reply.code(201).send(watchlist);
  });

  app.patch("/autonomy/watchlists/:watchlistId", async (request, reply) => {
    const watchlistId = z.string().min(1).safeParse(
      (request.params as { watchlistId?: string } | undefined)?.watchlistId
    );
    const parsed = updateAutonomousWatchlistSchema.safeParse(request.body ?? {});
    if (!watchlistId.success) {
      return reply.code(400).send({ error: watchlistId.error.flatten() });
    }
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const updated = await orchestrator.updateAutonomousWatchlist(
      watchlistId.data,
      parsed.data as UpdateAutonomousWatchlistInput
    );
    if (!updated) {
      return reply.code(404).send({ error: "Autonomous watchlist not found." });
    }

    return reply.code(200).send(updated);
  });

  app.get("/autonomy/runs", async () => orchestrator.listAutonomousRuns());

  app.get("/autonomy/ingestion-artifacts", async () =>
    orchestrator.listAutonomousIngestionArtifacts()
  );

  app.get("/autonomy/review-queue", async () =>
    orchestrator.listAutonomousReviewQueueItems()
  );

  app.get("/autonomy/matched-opportunities", async (request, reply) => {
    const parsed = autonomousMatchedOpportunityFilterSchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    return reply.code(200).send(
      await orchestrator.listAutonomousMatchedOpportunities(parsed.data)
    );
  });

  app.patch("/autonomy/matched-opportunities/:id/review-state", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: params.error.flatten() });
    }

    const parsed = autonomousMatchedOpportunityReviewStateSchema.safeParse(
      request.body ?? {}
    );
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const updated = await orchestrator.updateAutonomousMatchedOpportunityReviewState(
      params.data.id,
      parsed.data
    );
    if (!updated) {
      return reply.code(404).send({ error: "Autonomous matched opportunity not found." });
    }

    return reply.code(200).send(updated);
  });

  app.get("/autonomy/prioritized-opportunities", async (request, reply) => {
    const parsed = autonomousMatchedOpportunityFilterSchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    return reply.code(200).send(
      await orchestrator.listAutonomousPrioritizedOpportunities(parsed.data)
    );
  });

  app.post("/autonomy/matched-opportunities/:id/promote", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: params.error.flatten() });
    }

    try {
      const promoted = await orchestrator.promoteAutonomousMatchedOpportunity(
        params.data.id
      );

      if (!promoted) {
        return reply.code(404).send({ error: "Autonomous matched opportunity not found." });
      }

      return reply.code(201).send(promoted);
    } catch (error) {
      if (error instanceof InvalidPromotionError) {
        return reply.code(409).send({ error: error.message });
      }
      throw error;
    }
  });

  app.get("/autonomy/content-work-items", async (request, reply) => {
    const parsed = autonomousContentWorkItemFilterSchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    return reply.code(200).send(
      await orchestrator.listAutonomousContentWorkspaceFeed({
        workItemKind: parsed.data.kind,
        status: parsed.data.status,
        hasDraft: parsed.data.hasDraft,
        draftStatus: parsed.data.draftStatus,
        sort: parsed.data.sort
      })
    );
  });

  app.get("/autonomy/content-work-items/:id", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: params.error.flatten() });
    }

    const item = await orchestrator.getAutonomousContentWorkItemById(params.data.id);
    if (!item) {
      return reply.code(404).send({ error: "Autonomous content work item not found." });
    }

    return reply.code(200).send(item);
  });

  app.patch("/autonomy/content-work-items/:id/status", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: params.error.flatten() });
    }

    const parsed = autonomousContentWorkItemStatusSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const updated = await orchestrator.updateAutonomousContentWorkItemStatus(
      params.data.id,
      parsed.data
    );
    if (!updated) {
      return reply.code(404).send({ error: "Autonomous content work item not found." });
    }

    return reply.code(200).send(updated);
  });

  app.post("/autonomy/content-work-items/:id/draft", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: params.error.flatten() });
    }

    try {
      const draft = await orchestrator.createAutonomousDraftWithAiGeneration(
        params.data.id
      );
      if (!draft) {
        return reply.code(404).send({ error: "Autonomous content work item not found." });
      }

      return reply.code(201).send(draft);
    } catch (error) {
      if (error instanceof InvalidDraftDocumentError) {
        return reply.code(409).send({ error: error.message });
      }
      throw error;
    }
  });

  app.get("/autonomy/drafts", async (request, reply) => {
    const parsed = autonomousDraftDocumentFilterSchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    return reply
      .code(200)
      .send(
        await orchestrator.listAutonomousDraftDocuments({
          status: parsed.data.status,
          sort: parsed.data.sort
        })
      );
  });

  app.get("/autonomy/drafts/:id", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: params.error.flatten() });
    }

    const draft = await orchestrator.getAutonomousDraftDocumentById(params.data.id);
    if (!draft) {
      return reply.code(404).send({ error: "Autonomous draft document not found." });
    }

    return reply.code(200).send(draft);
  });

  app.patch("/autonomy/drafts/:id", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: params.error.flatten() });
    }

    const parsed = autonomousDraftDocumentUpdateSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const updated = await orchestrator.updateAutonomousDraftDocument(
      params.data.id,
      parsed.data
    );
    if (!updated) {
      return reply.code(404).send({ error: "Autonomous draft document not found." });
    }

    return reply.code(200).send(updated);
  });

  app.patch("/autonomy/drafts/:id/status", async (request, reply) => {
    const params = z.object({ id: z.string().min(1) }).safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: params.error.flatten() });
    }

    const parsed = autonomousDraftDocumentStatusSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const updated = await orchestrator.updateAutonomousDraftDocumentStatus(
      params.data.id,
      parsed.data
    );
    if (!updated) {
      return reply.code(404).send({ error: "Autonomous draft document not found." });
    }

    return reply.code(200).send(updated);
  });

  app.post("/autonomy/scheduler/tick", async (request, reply) => {
    const parsed = schedulerTickSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const result = await orchestrator.tickAutonomousScheduler(parsed.data.now);
    return reply.code(201).send(result);
  });

  app.get("/sources", async () => orchestrator.listSourceItems());

  app.post("/sources/intake", async (request, reply) => {
    const parsed = sourceIntakeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const normalized = await orchestrator.normalizeSourceIntake(parsed.data);
    return reply.code(201).send(normalized);
  });

  app.post("/sources", async (request, reply) => {
    const parsed = createSourceItemSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const source = await orchestrator.ingestSourceItem({
      title: parsed.data.title,
      sourceType: parsed.data.sourceType as DiscoverySourceType,
      sourceUrl: parsed.data.sourceUrl,
      rawText: parsed.data.rawText
    });
    return reply.code(201).send(source);
  });

  app.get("/markets", async () => orchestrator.listMarketProfiles());

  app.post("/markets", async (request, reply) => {
    const parsed = createMarketProfileSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const market = await orchestrator.ingestMarketProfile(parsed.data);
    return reply.code(201).send(market);
  });

  app.get("/topics/scores", async () => orchestrator.listTopicScores());

  app.post("/topics/score", async (_request, reply) => {
    const scores = await orchestrator.scoreTopics();
    return reply.code(201).send(scores);
  });

  app.get("/queue", async () => orchestrator.listContentQueueItems());

  app.post("/queue/build", async (_request, reply) => {
    const queue = await orchestrator.buildContentQueue();
    return reply.code(201).send(queue);
  });

  // ── Factory Dashboard Routes ─────────────────────────────────────────
  // Direct SQLite access for factory bot tables (leads, deals, heartbeats, posts)
  const { createSqliteClient } = await import("@linkedin-brand-os/db");
  const factoryDb = createSqliteClient();

  app.get("/factory/status", async () => {
    try {
      const leads = factoryDb.prepare(`SELECT * FROM leads WHERE stage NOT IN ('won','lost') ORDER BY score DESC LIMIT 20`).all();
      const deals = factoryDb.prepare(`SELECT * FROM deals WHERE status IN ('proposed','active','delivered') ORDER BY created_at DESC LIMIT 10`).all();
      const heartbeats = factoryDb.prepare(`SELECT * FROM bot_heartbeats WHERE bot_id NOT IN ('sales_cmd_offset','orchestrator_last_dead_alert') ORDER BY pinged_at DESC`).all();
      const posts = factoryDb.prepare(`SELECT * FROM published_posts ORDER BY created_at DESC LIMIT 10`).all();
      const totalClosed = (factoryDb.prepare(`SELECT COALESCE(SUM(amount),0) as total FROM deals WHERE status IN ('active','delivered')`).get() as { total: number }).total;
      const pipeline = (factoryDb.prepare(`SELECT COALESCE(SUM(amount),0) as total FROM deals WHERE status = 'proposed'`).get() as { total: number }).total;
      const mrr = (factoryDb.prepare(`SELECT COALESCE(SUM(recurring_monthly),0) as total FROM deals WHERE status = 'active'`).get() as { total: number }).total;

      let mode = "HUNT";
      if (totalClosed > 5000 || pipeline > 10000) mode = "GROW";
      if (totalClosed > 20000 || mrr > 2000) mode = "SCALE";

      return { leads, deals, heartbeats, posts, revenue: { totalClosed, pipeline, mrr, mode } };
    } catch {
      return { leads: [], deals: [], heartbeats: [], posts: [], revenue: { totalClosed: 0, pipeline: 0, mrr: 0, mode: "HUNT" } };
    }
  });

  app.get("/factory/leads", async () => {
    try {
      return factoryDb.prepare(`SELECT * FROM leads ORDER BY score DESC, created_at DESC LIMIT 50`).all();
    } catch { return []; }
  });

  app.get("/factory/tasks", async () => {
    try {
      return factoryDb.prepare(`SELECT * FROM bot_tasks ORDER BY created_at DESC LIMIT 30`).all();
    } catch { return []; }
  });
}

function isPublicAppShellRequest(requestPath: string, method: string): boolean {
  if (method !== "GET") {
    return false;
  }

  return (
    requestPath === "/" ||
    requestPath === "/index.html" ||
    requestPath.startsWith("/assets/") ||
    requestPath === "/favicon.ico"
  );
}

async function captureLaunchSmokeArtifactIds(orchestrator: OrchestratorService) {
  const [
    ingestionArtifacts,
    reviewQueueItems,
    matchedOpportunities,
    prioritizedOpportunities,
    contentWorkItems,
    draftDocuments
  ] = await Promise.all([
    orchestrator.listAutonomousIngestionArtifacts(),
    orchestrator.listAutonomousReviewQueueItems(),
    orchestrator.listAutonomousMatchedOpportunities(),
    orchestrator.listAutonomousPrioritizedOpportunities(),
    orchestrator.listAutonomousContentWorkItems(),
    orchestrator.listAutonomousDraftDocuments()
  ]);

  return {
    ingestionArtifacts: new Set(ingestionArtifacts.map((item) => item.id)),
    reviewQueueItems: new Set(reviewQueueItems.map((item) => item.id)),
    matchedOpportunities: new Set(matchedOpportunities.map((item) => item.id)),
    prioritizedOpportunities: new Set(prioritizedOpportunities.map((item) => item.id)),
    contentWorkItems: new Set(contentWorkItems.map((item) => item.id)),
    draftDocuments: new Set(draftDocuments.map((item) => item.id))
  };
}

function countNewArtifactIds(before: Set<string>, after: Set<string>): number {
  let count = 0;
  for (const id of after) {
    if (!before.has(id)) {
      count += 1;
    }
  }
  return count;
}

function buildLaunchSmokeDataUrl(title: string, body: string): string {
  const html = `<html><title>${title}</title><body>${body}</body></html>`;
  return `data:text/html,${encodeURIComponent(html)}`;
}

function buildLaunchSmokeTag(token: string): string {
  return `launch-smoke:${token}`;
}
