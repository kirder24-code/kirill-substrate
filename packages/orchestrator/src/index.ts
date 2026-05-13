import {
  analyticsAgent,
  buildScoutFeedInputFromAutonomousWatchlist,
  mapAutonomousReviewQueueToMatchedOpportunities,
  mapScoutFeedResultToReviewQueueItems,
  brandVoiceAgent,
  buildAudienceScoutResult,
  buildDecisionPlan,
  computeNextAutonomousWatchlistRunAt,
  buildGrowthRhythmPlan,
  buildOrchestratedRecommendation,
  buildScoutMatchResult,
  buildScoutFeedResult,
  buildSolutionScoutResult,
  providerBackedCommentService,
  providerBackedContentService,
  enrichAudienceScoutResult,
  enrichScoutMatchResult,
  enrichSolutionScoutResult,
  experimentalLinkedInPostWriterV2,
  marketIntelligenceAgent,
  providerBackedFinalPostService,
  providerBackedBusinessTranslatorService,
  providerBackedContentCriticService,
  providerBackedSignalContentService,
  providerBackedPositioningService,
  providerBackedHumanWritingService,
  providerBackedMatchContentService,
  providerBackedReplyService,
  providerBackedVisualService,
  providerBackedVoiceEditorService,
  queuePlannerAgent,
  relevanceAnalyzer,
  relevanceAgent,
  isAutonomousWatchlistDue,
  ingestWatchlistSources,
  ingestCanonicalSignalSource,
  normalizeSourceIntake,
  signalBusinessTranslatorAgent,
  signalContentAgent,
  positioningAgent,
  sourceNormalizerAgent,
  supportsAutomatedUrlIngestion,
  strategyAgent,
  topicScoringAgent,
  writingQualityAgent
} from "@linkedin-brand-os/agent-services";
import {
  buildAgentRunCreateInputFromExecutionDecision,
  createExecutionPolicyRouterFromEnv,
  createProviderRouterFromEnv,
  type ExecutionPolicyRouter,
  type ProviderRouter
} from "@linkedin-brand-os/ai-providers";
import { SqliteDatabase, type WorkflowRepository } from "@linkedin-brand-os/db";
import type {
  AIContentGeneration,
  AnalyticsMemoryUpdateResult,
  AIProviderProbeResult,
  CanonicalSignalIngestionInput,
  LaunchSmokeCleanupResult,
  OrchestratorDecision,
  AudienceScoutInput,
  AudienceScoutResult,
  AnalyticsSnapshot,
  AutonomousDraftDocument,
  AutonomousRun,
  AutonomousIngestionArtifact,
  AutonomousContentWorkItem,
  AutonomousContentDraftSeed,
  AutonomousMatchedOpportunity,
  AutonomousReviewQueueItem,
  AutonomousSchedulerTickResult,
  AutonomousWatchlist,
  BrandVoiceProfile,
  CandidateQueueItem,
  CandidateQueueItemDetail,
  CandidateQueueOperatorAction,
  ContentAsset,
  CriticReview,
  ContentQueueItem,
  CreateAutonomousWatchlistInput,
  CreateAgentRunInput,
  DecisionLayerInput,
  DecisionPlan,
  GrowthRhythmInput,
  GrowthRhythmPlan,
  CreateAnalyticsSnapshotInput,
  AnalyzeRelevanceInput,
  CreateBrandVoiceProfileInput,
  CreateSignalAnalysisInput,
  GenerateCommentInput,
  GeneratedComment,
  GeneratedReply,
  FinalPostGenerationConfig,
  FinalPostOutcomeContext,
  FactoryPriorityDecision,
  FactoryPrioritySelectionResult,
  GenerateReplyInput,
  CreateMarketProfileInput,
  NormalizedSourceSignal,
  CreateSignalInput,
  OrchestratedRecommendation,
  OrchestratedRecommendationInput,
  PersistedMatchedOpportunity,
  SourceIntakeInput,
  CreateSourceItemInput,
  Idea,
  MarketProfile,
  MemoryPattern,
  RelevanceAnalysis,
  PerformanceOutcomeClassification,
  ScoutMatchInput,
  ScoutMatchResult,
  ScoutFeedInput,
  ScoutFeedResult,
  Signal,
  SignalAnalysis,
  SignalPositioningAgentOutput,
  SourceItem,
  StrategyAnalysisInput,
  StrategyRecommendation,
  SolutionScoutInput,
  SolutionScoutResult,
  SolutionMemory,
  TopicScore,
  UpdateAutonomousContentWorkItemStatusInput,
  UpdateAutonomousMatchedOpportunityReviewInput,
  UpdateAutonomousDraftDocumentInput,
  UpdateAutonomousDraftDocumentStatusInput,
  UpdateAutonomousWatchlistInput,
  VisualAsset,
  WritingQualityAssessment
} from "@linkedin-brand-os/shared";

export class NotFoundError extends Error {}
export class InvalidPromotionError extends Error {}
export class InvalidDraftDocumentError extends Error {}
export class AnalysisBlockedError extends Error {}

export interface OrchestratorDependencies {
  db?: WorkflowRepository;
  providerRouter?: ProviderRouter;
  executionPolicyRouter?: ExecutionPolicyRouter;
  watchlistFetch?: typeof fetch;
  enableAutonomousAiDrafts?: boolean;
}

export interface AutonomousSignalPipelineRunResult {
  run: AutonomousRun;
  analysis?: SignalAnalysis;
  solutionMemory?: SolutionMemory;
  decision?: OrchestratorDecision;
  contentAsset?: ContentAsset;
  criticReview?: CriticReview;
  candidateQueueItem?: CandidateQueueItem;
}

export class OrchestratorService {
  private readonly db: WorkflowRepository;
  private readonly providerRouter: ProviderRouter;
  private readonly executionPolicyRouter: ExecutionPolicyRouter;
  private readonly watchlistFetch?: typeof fetch;
  private readonly enableAutonomousAiDrafts: boolean;

  constructor(dependencies: OrchestratorDependencies = {}) {
    this.db = dependencies.db ?? new SqliteDatabase();
    this.providerRouter = dependencies.providerRouter ?? createProviderRouterFromEnv();
    this.executionPolicyRouter =
      dependencies.executionPolicyRouter ?? createExecutionPolicyRouterFromEnv();
    this.watchlistFetch = dependencies.watchlistFetch;
    this.enableAutonomousAiDrafts = dependencies.enableAutonomousAiDrafts ?? false;

    // Debug provider configuration
    const summary = this.providerRouter.getSummary();
    console.log('[DEBUG] Provider router config:', {
      mode: summary.mode,
      textProvider: summary.textProvider,
      textProviderStatus: summary.textProviderStatus,
      fallbackEnabled: summary.fallbackEnabled
    });
  }

  private shouldAutoPromote(
    opportunity: AutonomousMatchedOpportunity,
    rules: NonNullable<AutonomousWatchlist["autoPromotionRules"]>
  ): boolean {
    // Check minimum priority score
    if (rules.minPriorityScore !== undefined && opportunity.priorityScore < rules.minPriorityScore) {
      return false;
    }

    // Check minimum confidence
    if (rules.minConfidence) {
      const confidenceLevels = { low: 1, medium: 2, high: 3 };
      const opportunityLevel = confidenceLevels[opportunity.confidence];
      const requiredLevel = confidenceLevels[rules.minConfidence];
      if (opportunityLevel < requiredLevel) {
        return false;
      }
    }

    // Check minimum opportunity strength
    if (rules.minOpportunityStrength && opportunity.opportunityStrength) {
      const strengthLevels = { weak: 1, medium: 2, strong: 3 };
      const opportunityLevel = strengthLevels[opportunity.opportunityStrength];
      const requiredLevel = strengthLevels[rules.minOpportunityStrength];
      if (opportunityLevel < requiredLevel) {
        return false;
      }
    }

    // Check memory alignment (if required)
    if (rules.requireMemoryAlignment) {
      // Memory alignment is already factored into priorityScore by calculateMemoryAdjustedPriority
      // So if we've passed the priority check, memory alignment is implicitly satisfied
      // Could add explicit memory pattern check here if needed
    }

    return true;
  }

  async ingestSignal(input: CreateSignalInput): Promise<Signal> {
    return this.db.createSignal(input);
  }

  async ingestCanonicalSignal(
    input: CanonicalSignalIngestionInput
  ): Promise<Signal> {
    const draft = await ingestCanonicalSignalSource(input, {
      fetchImpl: this.watchlistFetch
    });
    return this.db.createSignal(draft);
  }

  async listSignals(): Promise<Signal[]> {
    return this.db.listSignals();
  }

  async analyzeSignal(signalId: string): Promise<{
    analysis: import("@linkedin-brand-os/shared").SignalAnalysis;
    agentRuns: import("@linkedin-brand-os/shared").AgentRun[];
  }> {
    const signal = await this.db.getSignalById(signalId);
    if (!signal) {
      throw new NotFoundError(`Signal '${signalId}' was not found.`);
    }

    const relevanceDecision = this.executionPolicyRouter.route({
      taskType: "relevance_reasoning",
      signalId,
      agentName: "relevance-agent"
    });

    if (relevanceDecision.outcome === "blocked") {
      const blockedRun = await this.db.createAgentRun(
        buildAgentRunCreateInputFromExecutionDecision({
          signalId,
          agentName: "relevance-agent",
          decision: relevanceDecision
        })
      );
      throw new AnalysisBlockedError(blockedRun.errorMessage ?? relevanceDecision.selectionReason);
    }

    const relevanceStartedAt = new Date().toISOString();
    const relevanceOutput = await relevanceAgent({ signal });
    const relevanceRun = await this.db.createAgentRun(
      finalizeAgentRunRecord(
        buildAgentRunCreateInputFromExecutionDecision({
          signalId,
          agentName: "relevance-agent",
          decision: relevanceDecision,
          startedAt: relevanceStartedAt,
          inputSummary: summarizeSignalForAgentRun(signal)
        }),
        {
          status: "completed",
          completedAt: new Date().toISOString(),
          outputSummary: relevanceOutput.whyRelevant
        }
      )
    );

    const businessDecision = this.executionPolicyRouter.route({
      taskType: "business_translation",
      signalId,
      agentName: "business-translator-agent"
    });

    if (businessDecision.outcome === "blocked") {
      const blockedRun = await this.db.createAgentRun(
        buildAgentRunCreateInputFromExecutionDecision({
          signalId,
          agentName: "business-translator-agent",
          decision: businessDecision
        })
      );
      throw new AnalysisBlockedError(blockedRun.errorMessage ?? businessDecision.selectionReason);
    }

    const businessStartedAt = new Date().toISOString();
    const providerTranslation = await maybeTranslateSignalWithProvider(
      signal,
      businessDecision,
      this.providerRouter
    );
    const businessOutput = await signalBusinessTranslatorAgent({
      signal,
      providerTranslation: providerTranslation
        ? {
            businessRelevance: providerTranslation.businessRelevance,
            targetAudience: providerTranslation.targetAudience,
            coreInsight: providerTranslation.coreInsight
          }
        : undefined
    });
    const businessRun = await this.db.createAgentRun(
      finalizeAgentRunRecord(
        buildAgentRunCreateInputFromExecutionDecision({
          signalId,
          agentName: "business-translator-agent",
          decision: businessDecision,
          startedAt: businessStartedAt,
          inputSummary: summarizeSignalForAgentRun(signal)
        }),
        {
          status: "completed",
          completedAt: new Date().toISOString(),
          outputSummary: businessOutput.businessValueSummary
        }
      )
    );

    const analysisInput = mergeSignalAnalysis(signal.id, relevanceOutput, businessOutput);
    const analysis = await this.db.createSignalAnalysis(analysisInput);

    return {
      analysis,
      agentRuns: [relevanceRun, businessRun]
    };
  }

  async positionSignalAndDecide(signalId: string): Promise<{
    analysis: SignalAnalysis;
    solutionMemory: SolutionMemory;
    decision: OrchestratorDecision;
    agentRuns: import("@linkedin-brand-os/shared").AgentRun[];
  }> {
    const signal = await this.db.getSignalById(signalId);
    if (!signal) {
      throw new NotFoundError(`Signal '${signalId}' was not found.`);
    }

    const analysis = (await this.db.listSignalAnalysesBySignalId(signalId))[0];
    if (!analysis) {
      throw new NotFoundError(`Signal '${signalId}' does not have a persisted analysis yet.`);
    }

    const positioningDecision = this.executionPolicyRouter.route({
      taskType: "positioning",
      signalId,
      agentName: "positioning-agent"
    });

    if (positioningDecision.outcome === "blocked") {
      const blockedRun = await this.db.createAgentRun(
        buildAgentRunCreateInputFromExecutionDecision({
          signalId,
          agentName: "positioning-agent",
          decision: positioningDecision
        })
      );
      throw new AnalysisBlockedError(blockedRun.errorMessage ?? positioningDecision.selectionReason);
    }

    const positioningStartedAt = new Date().toISOString();
    const positioningOutput = await maybePositionSignalWithProvider(
      signal,
      analysis,
      positioningDecision,
      this.providerRouter
    );
    const updatedAnalysis = await this.db.updateSignalAnalysis(analysis.id, {
      bestAngle: positioningOutput.bestAngle,
      alternativeAnglesJson: positioningOutput.alternativeAnglesJson,
      recommendedFormat: positioningOutput.recommendedFormat,
      audienceEmphasis: positioningOutput.audienceEmphasis,
      toneGuidance: positioningOutput.toneGuidance,
      recommendedPillarFinal: positioningOutput.recommendedPillarFinal,
      reasoningJson: mergeReasoningJson(analysis.reasoningJson, {
        positioning: positioningOutput.reasoningJson
      })
    });
    const positioningRun = await this.db.createAgentRun(
      finalizeAgentRunRecord(
        buildAgentRunCreateInputFromExecutionDecision({
          signalId,
          agentName: "positioning-agent",
          decision: positioningDecision,
          startedAt: positioningStartedAt,
          inputSummary: summarizeSignalForAgentRun(signal)
        }),
        {
          status: "completed",
          completedAt: new Date().toISOString(),
          outputSummary: `${positioningOutput.bestAngle} -> ${positioningOutput.recommendedFormat}`
        }
      )
    );

    const solutionMemoryDecision = this.executionPolicyRouter.route({
      taskType: "solution_memory_enrichment",
      signalId,
      agentName: "solution-memory-enrichment"
    });
    const solutionMemory = await this.db.createSolutionMemory(
      buildSolutionMemoryFromSignal(signal, updatedAnalysis ?? analysis, positioningOutput)
    );
    const solutionMemoryRun = await this.db.createAgentRun(
      finalizeAgentRunRecord(
        buildAgentRunCreateInputFromExecutionDecision({
          signalId,
          agentName: "solution-memory-enrichment",
          decision: solutionMemoryDecision,
          startedAt: new Date().toISOString(),
          inputSummary: summarizeSignalForAgentRun(signal)
        }),
        {
          status: "completed",
          completedAt: new Date().toISOString(),
          outputSummary: solutionMemory.implementationPotential
        }
      )
    );

    const decision = await this.db.createOrchestratorDecision(
      buildOrchestratorDecisionFromAnalysis(
        signal,
        updatedAnalysis ?? analysis,
        solutionMemory,
        positioningOutput
      )
    );

    return {
      analysis: updatedAnalysis ?? analysis,
      solutionMemory,
      decision,
      agentRuns: [positioningRun, solutionMemoryRun]
    };
  }

  async listIdeas(): Promise<Idea[]> {
    return this.db.listIdeas();
  }

  async listContentAssets(): Promise<ContentAsset[]> {
    return this.db.listContentAssets();
  }

  async listAutonomousContentAssets(): Promise<ContentAsset[]> {
    const allAssets = await this.db.listContentAssets();
    return allAssets.filter((asset) => asset.sourceContentWorkItemId !== undefined);
  }

  async updateAutonomousContentAssetStatus(
    id: string,
    status: "draft" | "review" | "ready" | "published" | "archived"
  ): Promise<ContentAsset | null> {
    return this.db.updateContentAssetCriticState(id, {
      contentStatus: status,
      publishReadyFlag: status === "ready",
      qualityStatus: undefined,
      overallQualityScore: undefined
    });
  }

  async generateContentAssetForSignal(signalId: string): Promise<{
    contentAsset: ContentAsset;
    agentRuns: import("@linkedin-brand-os/shared").AgentRun[];
  }> {
    const signal = await this.db.getSignalById(signalId);
    if (!signal) {
      throw new NotFoundError(`Signal '${signalId}' was not found.`);
    }

    const analysis = (await this.db.listSignalAnalysesBySignalId(signalId))[0];
    if (!analysis) {
      throw new NotFoundError(`Signal '${signalId}' does not have a persisted analysis yet.`);
    }

    const decision = getLatestOrchestratorDecisionForSignal(
      await this.db.listOrchestratorDecisions(),
      signalId
    );
    if (!decision) {
      throw new NotFoundError(`Signal '${signalId}' does not have a persisted orchestrator decision yet.`);
    }

    if (decision.decisionType === "discard" || decision.decisionType === "archive") {
      throw new AnalysisBlockedError(
        `Latest decision '${decision.decisionType}' does not permit content generation.`
      );
    }

    const contentDecision = this.executionPolicyRouter.route({
      taskType: "content_generation",
      signalId,
      agentName: "content-agent"
    });

    if (contentDecision.outcome === "blocked") {
      const blockedRun = await this.db.createAgentRun(
        buildAgentRunCreateInputFromExecutionDecision({
          signalId,
          agentName: "content-agent",
          decision: contentDecision
        })
      );
      throw new AnalysisBlockedError(blockedRun.errorMessage ?? contentDecision.selectionReason);
    }

    const startedAt = new Date().toISOString();
    const providerDraft = await maybeGenerateSignalContentWithProvider(
      signal,
      analysis,
      decision,
      contentDecision,
      this.providerRouter
    );
    const generated = await signalContentAgent({
      signal,
      analysis,
      decision,
      providerDraft
    });
    const idea = await this.db.createIdea(
      buildIdeaFromContentContext(signal, analysis, decision)
    );
    const contentAsset = await this.db.createContentAsset({
      ideaId: idea.id,
      signalId: signal.id,
      signalAnalysisId: analysis.id,
      orchestratorDecisionId: decision.id,
      contentType: generated.contentType,
      hook: generated.hook,
      body: generated.body,
      cta: generated.cta,
      bestAngle: generated.bestAngle,
      alternativeAnglesJson: generated.alternativeAnglesJson,
      recommendedFormat: generated.recommendedFormat,
      longPostDraft: generated.longPostDraft,
      shortPostDraft: generated.shortPostDraft,
      hooksJson: generated.hooksJson,
      commentAnglesJson: generated.commentAnglesJson,
      ctaVariantsJson: generated.ctaVariantsJson,
      carouselOutline: generated.carouselOutline,
      contentStatus: generated.contentStatus,
      publishReadyFlag: generated.publishReadyFlag,
      status: generated.status
    });
    const contentRun = await this.db.createAgentRun(
      finalizeAgentRunRecord(
        buildAgentRunCreateInputFromExecutionDecision({
          signalId,
          agentName: "content-agent",
          decision: contentDecision,
          startedAt,
          inputSummary: summarizeSignalForAgentRun(signal)
        }),
        {
          status: "completed",
          completedAt: new Date().toISOString(),
          outputSummary: generated.hook
        }
      )
    );

    return {
      contentAsset,
      agentRuns: [contentRun]
    };
  }

  async reviewContentAsset(contentId: string): Promise<{
    criticReview: CriticReview;
    contentAsset: ContentAsset;
    agentRuns: import("@linkedin-brand-os/shared").AgentRun[];
  }> {
    const content = await this.db.getContentAssetById(contentId);
    if (!content) {
      throw new NotFoundError(`Content asset '${contentId}' was not found.`);
    }

    const signalId = content.signalId;
    if (!signalId) {
      throw new NotFoundError(`Content asset '${contentId}' is missing canonical signal linkage.`);
    }

    const signal = await this.db.getSignalById(signalId);
    if (!signal) {
      throw new NotFoundError(`Signal '${signalId}' was not found.`);
    }

    const analysis = content.signalAnalysisId
      ? (await this.db.listSignalAnalysesBySignalId(signalId)).find(
          (candidate) => candidate.id === content.signalAnalysisId
        )
      : (await this.db.listSignalAnalysesBySignalId(signalId))[0];
    if (!analysis) {
      throw new NotFoundError(`Content asset '${contentId}' is missing persisted signal analysis context.`);
    }

    const decision = content.orchestratorDecisionId
      ? (await this.db.listOrchestratorDecisions()).find(
          (candidate) => candidate.id === content.orchestratorDecisionId
        )
      : getLatestOrchestratorDecisionForSignal(await this.db.listOrchestratorDecisions(), signalId);

    const reviewDecision = this.executionPolicyRouter.route({
      taskType: "critic_review",
      signalId,
      agentName: "critic-agent"
    });

    if (reviewDecision.outcome === "blocked") {
      const blockedRun = await this.db.createAgentRun(
        buildAgentRunCreateInputFromExecutionDecision({
          signalId,
          agentName: "critic-agent",
          decision: reviewDecision
        })
      );
      throw new AnalysisBlockedError(blockedRun.errorMessage ?? reviewDecision.selectionReason);
    }

    const startedAt = new Date().toISOString();
    const providerReview = await maybeReviewContentWithProvider(
      content,
      reviewDecision,
      this.providerRouter
    );

    // Convert provider review signals to numerical scores for database storage
    const qualityScore = providerReview.qualitySignal === "strong" ? 84 : providerReview.qualitySignal === "mixed" ? 66 : 44;
    const businessValueScore = providerReview.businessValueSignal === "strong" ? 84 : providerReview.businessValueSignal === "mixed" ? 66 : 44;
    const differentiationScore = providerReview.differentiationSignal === "strong" ? 84 : providerReview.differentiationSignal === "mixed" ? 66 : 44;
    const genericnessScore = providerReview.genericnessRisk === "low" ? 18 : providerReview.genericnessRisk === "medium" ? 44 : 72;
    const overallScore = Math.round(qualityScore * 0.4 + businessValueScore * 0.3 + differentiationScore * 0.2 + (100 - genericnessScore) * 0.1);
    const publishReadyFlag = providerReview.publishReadyHint && overallScore >= 75;

    const criticReview = await this.db.createWritingQualityAssessment({
      contentAssetId: content.id,
      humanToneScore: Math.max(45, overallScore - 8),
      clarityScore: Math.max(50, overallScore - 4),
      groundednessScore: Math.min(100, businessValueScore + 4),
      antiRobotScore: Math.max(40, 100 - genericnessScore),
      overallScore,
      notes: [
        `Best angle: ${content.bestAngle ?? analysis.bestAngle ?? signal.title}`,
        `Audience: ${analysis.targetAudience}`
      ],
      qualityScore,
      genericnessScore,
      businessValueScore,
      differentiationScore,
      publishReadyFlag,
      rewriteSuggestions: providerReview.rewriteSuggestions,
      criticNotes: providerReview.criticNotes
    });
    const updatedContent = await this.db.updateContentAssetCriticState(content.id, {
      publishReadyFlag: criticReview.publishReadyFlag,
      contentStatus: criticReview.publishReadyFlag ? "ready" : "review",
      qualityStatus: "reviewed",
      overallQualityScore: criticReview.qualityScore ?? criticReview.overallScore
    });
    const criticRun = await this.db.createAgentRun(
      finalizeAgentRunRecord(
        buildAgentRunCreateInputFromExecutionDecision({
          signalId,
          agentName: "critic-agent",
          decision: reviewDecision,
          startedAt,
          inputSummary: summarizeSignalForAgentRun(signal)
        }),
        {
          status: "completed",
          completedAt: new Date().toISOString(),
          outputSummary: `${criticReview.qualityScore ?? criticReview.overallScore} / publish=${criticReview.publishReadyFlag ? "yes" : "no"}`
        }
      )
    );

    return {
      criticReview,
      contentAsset: updatedContent ?? content,
      agentRuns: [criticRun]
    };
  }

  async enqueueCandidateForSignal(signalId: string): Promise<CandidateQueueItem> {
    const signal = await this.db.getSignalById(signalId);
    if (!signal) {
      throw new NotFoundError(`Signal '${signalId}' was not found.`);
    }

    const analysis = (await this.db.listSignalAnalysesBySignalId(signalId))[0];
    if (!analysis) {
      throw new NotFoundError(`Signal '${signalId}' does not have a persisted analysis yet.`);
    }

    const decisions = await this.db.listOrchestratorDecisions();
    const decision = getLatestOrchestratorDecisionForSignal(decisions, signalId);
    if (!decision) {
      throw new NotFoundError(`Signal '${signalId}' does not have a persisted orchestrator decision yet.`);
    }

    if (decision.decisionType === "discard" || decision.decisionType === "archive") {
      throw new AnalysisBlockedError(
        `Decision '${decision.decisionType}' does not permit candidate queueing.`
      );
    }

    const contentAssets = await this.db.listContentAssets();
    const contentAsset = getLatestContentAssetForSignal(contentAssets, signalId, decision.id);

    const criticReviews = await this.db.listWritingQualityAssessments();
    const criticReview = contentAsset
      ? getLatestCriticReviewForContent(criticReviews, contentAsset.id)
      : undefined;

    const solutionMemories = await this.db.listSolutionMemoriesBySignalId(signalId);
    const solutionMemory = solutionMemories.at(-1);

    const candidate = await this.db.createCandidateQueueItem(
      buildCandidateQueueInput({
        signal,
        analysis,
        decision,
        contentAsset,
        criticReview,
        solutionMemory
      })
    );

    return candidate;
  }

  async runAutonomousSignalPipeline(
    signalId: string,
    options: {
      triggerType?: AutonomousRun["triggerType"];
      startedAt?: string;
    } = {}
  ): Promise<AutonomousSignalPipelineRunResult> {
    const signal = await this.db.getSignalById(signalId);
    if (!signal) {
      throw new NotFoundError(`Signal '${signalId}' was not found.`);
    }

    const activeRun = await this.db.findActiveAutonomousRunForSignal(signalId);
    if (activeRun) {
      return { run: activeRun };
    }

    const queuedRun = await this.db.createAutonomousRun({
      signalId,
      triggerType: options.triggerType ?? "manual",
      runType: "signal_pipeline",
      status: "queued"
    });
    const startedAt = options.startedAt ?? new Date().toISOString();
    const runningRun =
      (await this.db.updateAutonomousRun(queuedRun.id, {
        status: "running",
        startedAt
      })) ?? queuedRun;
    const metadata = createAutonomousSignalPipelineMetadata();
    const result: AutonomousSignalPipelineRunResult = {
      run: runningRun
    };
    let currentStage: AutonomousPipelineStage = "analyze_signal";

    try {
      metadata.stagesAttempted.push(currentStage);
      const analyzed = await this.analyzeSignal(signalId);
      metadata.stagesCompleted.push(currentStage);
      metadata.usedAi = true;
      metadata.producedSignalAnalysisId = analyzed.analysis.id;
      result.analysis = analyzed.analysis;

      currentStage = "position_signal_and_decide";
      metadata.stagesAttempted.push(currentStage);
      const positioned = await this.positionSignalAndDecide(signalId);
      metadata.stagesCompleted.push(currentStage);
      metadata.producedSignalAnalysisId = positioned.analysis.id;
      metadata.producedSolutionMemoryId = positioned.solutionMemory.id;
      metadata.producedOrchestratorDecisionId = positioned.decision.id;
      result.analysis = positioned.analysis;
      result.solutionMemory = positioned.solutionMemory;
      result.decision = positioned.decision;

      if (!shouldGenerateContentForDecision(positioned.decision.decisionType)) {
        if (shouldEnqueueDecision(positioned.decision.decisionType)) {
          currentStage = "enqueue_candidate";
          metadata.stagesAttempted.push(currentStage);
          const candidateQueueItem = await this.enqueueCandidateForSignal(signalId);
          metadata.stagesCompleted.push(currentStage);
          metadata.producedCandidateQueueItemId = candidateQueueItem.id;
          result.candidateQueueItem = candidateQueueItem;

          return finalizeAutonomousSignalPipelineRun(this.db, queuedRun.id, result, {
            status: "completed",
            completedAt: new Date().toISOString(),
            resultSummary: `Decision '${positioned.decision.decisionType}' queued without content generation.`,
            resultMetadata: metadata
          });
        }

        return finalizeAutonomousSignalPipelineRun(this.db, queuedRun.id, result, {
          status: "partial",
          completedAt: new Date().toISOString(),
          resultSummary: `Decision '${positioned.decision.decisionType}' intentionally stopped downstream content stages.`,
          resultMetadata: metadata
        });
      }

      currentStage = "generate_content_asset";
      metadata.stagesAttempted.push(currentStage);
      const generated = await this.generateContentAssetForSignal(signalId);
      metadata.stagesCompleted.push(currentStage);
      metadata.producedContentAssetId = generated.contentAsset.id;
      result.contentAsset = generated.contentAsset;

      currentStage = "review_content_asset";
      metadata.stagesAttempted.push(currentStage);
      const reviewed = await this.reviewContentAsset(generated.contentAsset.id);
      metadata.stagesCompleted.push(currentStage);
      metadata.producedCriticReviewId = reviewed.criticReview.id;
      result.contentAsset = reviewed.contentAsset;
      result.criticReview = reviewed.criticReview;

      if (shouldEnqueueDecision(positioned.decision.decisionType)) {
        currentStage = "enqueue_candidate";
        metadata.stagesAttempted.push(currentStage);
        const candidateQueueItem = await this.enqueueCandidateForSignal(signalId);
        metadata.stagesCompleted.push(currentStage);
        metadata.producedCandidateQueueItemId = candidateQueueItem.id;
        result.candidateQueueItem = candidateQueueItem;
      }

      return finalizeAutonomousSignalPipelineRun(this.db, queuedRun.id, result, {
        status: result.candidateQueueItem ? "completed" : "partial",
        completedAt: new Date().toISOString(),
        resultSummary: result.candidateQueueItem
          ? "Autonomous signal pipeline completed and handed off to the candidate queue."
          : "Autonomous signal pipeline completed without a queue handoff.",
        resultMetadata: metadata
      });
    } catch (error) {
      if (error instanceof AnalysisBlockedError) {
        metadata.stagesBlocked.push(currentStage);
        if (
          currentStage === "review_content_asset" &&
          result.contentAsset &&
          result.decision &&
          shouldEnqueueDecision(result.decision.decisionType)
        ) {
          currentStage = "enqueue_candidate";
          metadata.stagesAttempted.push(currentStage);
          const candidateQueueItem = await this.enqueueCandidateForSignal(signalId);
          metadata.stagesCompleted.push(currentStage);
          metadata.producedCandidateQueueItemId = candidateQueueItem.id;
          result.candidateQueueItem = candidateQueueItem;
        }
        return finalizeAutonomousSignalPipelineRun(this.db, queuedRun.id, result, {
          status:
            isBlockingAutonomousStage(currentStage) && !result.contentAsset ? "blocked" : "partial",
          completedAt: new Date().toISOString(),
          errorSummary: error.message,
          resultSummary: `Pipeline stopped at '${currentStage}'.`,
          resultMetadata: metadata
        });
      }

      if (
        currentStage === "review_content_asset" &&
        result.contentAsset &&
        result.decision &&
        shouldEnqueueDecision(result.decision.decisionType)
      ) {
        currentStage = "enqueue_candidate";
        metadata.stagesAttempted.push(currentStage);
        const candidateQueueItem = await this.enqueueCandidateForSignal(signalId);
        metadata.stagesCompleted.push(currentStage);
        metadata.producedCandidateQueueItemId = candidateQueueItem.id;
        result.candidateQueueItem = candidateQueueItem;

        return finalizeAutonomousSignalPipelineRun(this.db, queuedRun.id, result, {
          status: "partial",
          completedAt: new Date().toISOString(),
          errorSummary: error instanceof Error ? error.message : "Autonomous signal pipeline failed.",
          resultSummary: "Pipeline stopped after content generation and queued the candidate for human review.",
          resultMetadata: metadata
        });
      }

      metadata.stagesFailed.push(currentStage);
      return finalizeAutonomousSignalPipelineRun(this.db, queuedRun.id, result, {
        status: "failed",
        completedAt: new Date().toISOString(),
        errorSummary: error instanceof Error ? error.message : "Autonomous signal pipeline failed.",
        resultSummary: `Pipeline failed at '${currentStage}'.`,
        resultMetadata: metadata
      });
    }
  }

  async listVisualAssets(): Promise<VisualAsset[]> {
    return this.db.listVisualAssets();
  }

  async listAnalyticsSnapshots(): Promise<AnalyticsSnapshot[]> {
    return this.db.listAnalyticsSnapshots();
  }

  async listMemoryPatterns(): Promise<MemoryPattern[]> {
    return this.db.listMemoryPatterns();
  }

  async listSolutionMemories(): Promise<SolutionMemory[]> {
    return this.db.listSolutionMemories();
  }

  async listStrategyRecommendations(): Promise<StrategyRecommendation[]> {
    return this.db.listStrategyRecommendations();
  }

  async listWritingQualityAssessments(): Promise<WritingQualityAssessment[]> {
    return this.db.listWritingQualityAssessments();
  }

  async listAutonomousWatchlists(): Promise<AutonomousWatchlist[]> {
    return this.db.listAutonomousWatchlists();
  }

  async createAutonomousWatchlist(
    input: CreateAutonomousWatchlistInput
  ): Promise<AutonomousWatchlist> {
    const created = await this.db.createAutonomousWatchlist(input);
    const nextRunAt =
      created.refreshCadence === "manual_only"
        ? undefined
        : computeNextAutonomousWatchlistRunAt(
            created.refreshCadence,
            created.createdAt
          );

    return nextRunAt
      ? (await this.db.updateAutonomousWatchlist(created.id, { nextRunAt })) ?? created
      : created;
  }

  async updateAutonomousWatchlist(
    id: string,
    input: UpdateAutonomousWatchlistInput
  ): Promise<AutonomousWatchlist | null> {
    const current = await this.db.getAutonomousWatchlistById(id);
    if (!current) {
      return null;
    }

    const updated = await this.db.updateAutonomousWatchlist(id, input);
    if (!updated) {
      return null;
    }

    if (
      input.refreshCadence !== undefined ||
      input.isActive !== undefined ||
      input.lastRunAt !== undefined
    ) {
      const nextRunAt =
        updated.isActive && updated.refreshCadence !== "manual_only"
          ? computeNextAutonomousWatchlistRunAt(
              updated.refreshCadence,
              updated.lastRunAt ?? updated.updatedAt
            )
          : undefined;

      return (
        (await this.db.updateAutonomousWatchlist(id, {
          nextRunAt: nextRunAt ?? undefined
        })) ?? updated
      );
    }

    return updated;
  }

  async listAutonomousRuns(): Promise<AutonomousRun[]> {
    return this.db.listAutonomousRuns();
  }

  async listAutonomousIngestionArtifacts(): Promise<AutonomousIngestionArtifact[]> {
    return this.db.listAutonomousIngestionArtifacts();
  }

  async listAutonomousReviewQueueItems(): Promise<AutonomousReviewQueueItem[]> {
    return this.db.listAutonomousReviewQueueItems();
  }

  async listAutonomousMatchedOpportunities(filter?: {
    reviewState?: AutonomousMatchedOpportunity["reviewState"];
  }): Promise<AutonomousMatchedOpportunity[]> {
    return this.db.listAutonomousMatchedOpportunities(filter);
  }

  async listAutonomousPrioritizedOpportunities(filter?: {
    reviewState?: AutonomousMatchedOpportunity["reviewState"];
  }): Promise<AutonomousMatchedOpportunity[]> {
    return this.db.listAutonomousMatchedOpportunities(filter);
  }

  async listAutonomousContentWorkItems(): Promise<AutonomousContentWorkItem[]> {
    const [items, drafts] = await Promise.all([
      this.db.listAutonomousContentWorkItems(),
      this.db.listAutonomousDraftDocuments()
    ]);
    return attachDraftProgressToContentWorkItems(items, drafts);
  }

  async listAutonomousDraftDocuments(filter?: {
    status?: AutonomousDraftDocument["status"];
    sort?: "updated_desc" | "updated_asc" | "status";
  }): Promise<AutonomousDraftDocument[]> {
    const [drafts, workItems] = await Promise.all([
      this.db.listAutonomousDraftDocuments(filter),
      this.db.listAutonomousContentWorkItems()
    ]);
    const workItemsById = new Map(workItems.map((item) => [item.id, item] as const));

    return drafts.map((draft) => {
      const sourceWorkItem = workItemsById.get(draft.sourceContentWorkItemId);
      return {
        ...draft,
        sourceWorkItemTitle: sourceWorkItem?.title,
        sourceWorkItemStatus: sourceWorkItem?.status,
        sourceWorkItemRecommendedAction: sourceWorkItem?.recommendedAction,
        sourceWorkItemSummary: sourceWorkItem?.summary
      };
    });
  }

  async getAutonomousDraftDocumentById(
    id: string
  ): Promise<AutonomousDraftDocument | null> {
    return this.db.getAutonomousDraftDocumentById(id);
  }

  async updateAutonomousDraftDocument(
    id: string,
    input: UpdateAutonomousDraftDocumentInput
  ): Promise<AutonomousDraftDocument | null> {
    return this.db.updateAutonomousDraftDocument(id, input);
  }

  async updateAutonomousDraftDocumentStatus(
    id: string,
    input: UpdateAutonomousDraftDocumentStatusInput
  ): Promise<AutonomousDraftDocument | null> {
    return this.db.updateAutonomousDraftDocumentStatus(id, input);
  }

  async getAutonomousContentWorkItemById(
    id: string
  ): Promise<AutonomousContentWorkItem | null> {
    const item = await this.db.getAutonomousContentWorkItemById(id);
    if (!item) {
      return null;
    }

    const draft = await this.db.getAutonomousDraftDocumentBySourceContentWorkItemId(id);
    return attachDraftProgressToContentWorkItem(item, draft ?? undefined);
  }

  async listAutonomousContentWorkspaceFeed(filter?: {
    workItemKind?: AutonomousContentWorkItem["workItemKind"];
    status?: AutonomousContentWorkItem["status"];
    hasDraft?: boolean;
    draftStatus?: AutonomousDraftDocument["status"];
    sort?: "updated_desc" | "updated_asc" | "status" | "has_draft";
  }): Promise<AutonomousContentWorkItem[]> {
    const [items, drafts] = await Promise.all([
      this.db.listAutonomousContentWorkItems({
        workItemKind: filter?.workItemKind,
        status: filter?.status,
        sort: filter?.sort === "updated_asc" ? "updated_asc" : "updated_desc"
      }),
      this.db.listAutonomousDraftDocuments()
    ]);
    return sortAutonomousContentWorkspaceFeed(
      filterAutonomousContentWorkspaceFeed(attachDraftProgressToContentWorkItems(items, drafts), filter),
      filter?.sort
    );
  }

  async updateAutonomousContentWorkItemStatus(
    id: string,
    input: UpdateAutonomousContentWorkItemStatusInput
  ): Promise<AutonomousContentWorkItem | null> {
    return this.db.updateAutonomousContentWorkItemStatus(id, input);
  }

  async createContentAssetFromAutonomousWorkItem(
    id: string,
    aiGeneratedContent: {
      hook: string;
      body: string;
      cta: string;
      finalHook?: string;
      finalBody?: string;
      finalClosing?: string;
      finalQualityScore?: number;
      finalStatus?: import("@linkedin-brand-os/shared").FinalPostStatus;
    }
  ): Promise<ContentAsset | null> {
    const workItem = await this.db.getAutonomousContentWorkItemById(id);
    if (!workItem) {
      return null;
    }

    if (!workItem.draftSeed) {
      throw new InvalidDraftDocumentError(
        "Autonomous content work item does not have a draft seed snapshot."
      );
    }

    const opportunity = await this.db.getAutonomousMatchedOpportunityById(
      workItem.sourceMatchedOpportunityId
    );

    const enrichment = opportunity?.aiEnrichment;

    const idea = await this.db.createIdea({
      signalId: workItem.watchlistId,
      title: workItem.draftSeed.title || workItem.title || opportunity?.title || "Autonomous draft",
      coreInsight: enrichment?.improvedSummary || enrichment?.whyItMatters || workItem.draftSeed.sourceSummary,
      businessRelevance: enrichment?.businessConsequence || enrichment?.operatorAngle || opportunity?.matchedSolutionPattern || "Autonomous opportunity",
      targetAudience: enrichment?.operatorAngle || enrichment?.whyItMatters || opportunity?.matchedPain || "Professional audience",
      status: "approved",
      sourceContentWorkItemId: workItem.id,
      sourceMatchedOpportunityId: opportunity?.id
    });

    return this.db.createContentAsset({
      ideaId: idea.id,
      contentType: "linkedin-post",
      hook: aiGeneratedContent.hook,
      body: aiGeneratedContent.body,
      cta: aiGeneratedContent.cta,
      finalHook: aiGeneratedContent.finalHook,
      finalBody: aiGeneratedContent.finalBody,
      finalClosing: aiGeneratedContent.finalClosing,
      finalQualityScore: aiGeneratedContent.finalQualityScore,
      finalStatus: aiGeneratedContent.finalStatus,
      bestAngle: workItem.draftSeed.angle,
      recommendedFormat: workItem.draftSeed.recommendedAction === "write_post" ? "long_linkedin_post" : undefined,
      contentStatus: aiGeneratedContent.finalStatus === "ready" ? "ready" : "draft",
      publishReadyFlag: aiGeneratedContent.finalStatus === "ready",
      status: "draft",
      sourceContentWorkItemId: workItem.id,
      sourceMatchedOpportunityId: opportunity?.id
    });
  }

  async createAutonomousDraftDocumentFromWorkItem(
    id: string,
    aiGeneratedContent?: {
      hook: string;
      body: string;
      cta: string;
    }
  ): Promise<AutonomousDraftDocument | null> {
    const workItem = await this.db.getAutonomousContentWorkItemById(id);
    if (!workItem) {
      return null;
    }

    if (!workItem.draftSeed) {
      throw new InvalidDraftDocumentError(
        "Autonomous content work item does not have a draft seed snapshot."
      );
    }

    const draftBody = aiGeneratedContent
      ? `${aiGeneratedContent.hook}\n\n${aiGeneratedContent.body}\n\n${aiGeneratedContent.cta}`
      : workItem.draftSeed.seedText;

    return this.db.upsertAutonomousDraftDocument({
      sourceContentWorkItemId: workItem.id,
      title: workItem.draftSeed.title || workItem.title || "Autonomous draft",
      body: draftBody,
      angle: workItem.draftSeed.angle,
      sourceSummary: workItem.draftSeed.sourceSummary,
      recommendedAction: workItem.draftSeed.recommendedAction
    });
  }

  async createAutonomousDraftWithAiGeneration(
    workItemId: string
  ): Promise<AutonomousDraftDocument | null> {
    const workItem = await this.db.getAutonomousContentWorkItemById(workItemId);
    if (!workItem) {
      return null;
    }

    if (!this.enableAutonomousAiDrafts) {
      console.log(`[DEBUG] AI drafts disabled, using placeholder`);
      return this.createAutonomousDraftDocumentFromWorkItem(workItemId);
    }

    const opportunity = await this.db.getAutonomousMatchedOpportunityById(
      workItem.sourceMatchedOpportunityId
    );
    if (!opportunity) {
      console.log(`[DEBUG] No opportunity found, using placeholder`);
      return this.createAutonomousDraftDocumentFromWorkItem(workItemId);
    }

    try {
      console.log(`[DEBUG] Calling convertOpportunityToIdea...`);
      const idea = convertOpportunityToIdea(opportunity);
      const brandVoice = await this.db.getActiveBrandVoiceProfile();

      console.log(`[DEBUG] providerRouter exists:`, !!this.providerRouter);
      console.log(`[DEBUG] Calling providerBackedHumanWritingService...`);
      const humanWritingResult = await providerBackedHumanWritingService({
        idea,
        router: this.providerRouter,
        brandVoice
      });
      console.log(`[DEBUG] Human writing generated, body length: ${humanWritingResult.content.body.length}`);

      // Apply voice refinement to human-written content
      console.log(`[DEBUG] Calling providerBackedVoiceEditorService...`);
      const refinedContent = await providerBackedVoiceEditorService({
        content: {
          id: "autonomous-draft-preview",
          ideaId: idea.id,
          hook: humanWritingResult.content.hook,
          body: humanWritingResult.content.body,
          cta: humanWritingResult.content.cta,
          contentType: humanWritingResult.content.contentType,
          status: humanWritingResult.content.status,
          createdAt: new Date().toISOString()
        } as any,
        router: this.providerRouter
      });
      console.log(`[DEBUG] Voice refinement applied`);

      // Generate final LinkedIn-ready post
      console.log(`[DEBUG] Calling providerBackedFinalPostService...`);
      const finalPost = await providerBackedFinalPostService({
        content: {
          id: "autonomous-draft-preview",
          ideaId: idea.id,
          hook: humanWritingResult.content.hook,
          body: humanWritingResult.content.body,
          cta: humanWritingResult.content.cta,
          refinedHook: refinedContent.refinedHook,
          refinedBody: refinedContent.refinedBody,
          refinedCta: refinedContent.refinedCta,
          contentType: humanWritingResult.content.contentType,
          status: humanWritingResult.content.status,
          createdAt: new Date().toISOString()
        } as any,
        router: this.providerRouter,
        brandVoice,
        config: { hookMode: "sharp_observation", antiBlandness: true }
      });
      console.log(`[DEBUG] Final post generated`);

      const finalHook = finalPost.finalization.finalHook;
      const finalBody = finalPost.finalization.finalBody;
      const finalCta = finalPost.finalization.finalClosing;

      await this.createContentAssetFromAutonomousWorkItem(workItemId, {
        hook: refinedContent.refinedHook || humanWritingResult.content.hook,
        body: refinedContent.refinedBody || humanWritingResult.content.body,
        cta: refinedContent.refinedCta || humanWritingResult.content.cta,
        finalHook,
        finalBody,
        finalClosing: finalCta,
        finalQualityScore: finalPost.finalization.finalQualityScore,
        finalStatus: finalPost.finalization.finalStatus
      });

      return this.createAutonomousDraftDocumentFromWorkItem(workItemId, {
        hook: finalHook,
        body: finalBody,
        cta: finalCta || ""
      });
    } catch (aiError) {
      console.log(`[DEBUG] AI generation failed:`, aiError);
      return this.createAutonomousDraftDocumentFromWorkItem(workItemId);
    }
  }

  async generateAutonomousDraft(
    workItemId: string
  ): Promise<AutonomousDraftDocument | null> {
    return this.createAutonomousDraftWithAiGeneration(workItemId);
  }

  async updateAutonomousMatchedOpportunityReviewState(
    id: string,
    input: UpdateAutonomousMatchedOpportunityReviewInput
  ): Promise<AutonomousMatchedOpportunity | null> {
    return this.db.updateAutonomousMatchedOpportunityReviewState(id, input);
  }

  async promoteAutonomousMatchedOpportunity(
    id: string
  ): Promise<AutonomousContentWorkItem | null> {
    const opportunity = await this.db.getAutonomousMatchedOpportunityById(id);
    if (!opportunity) {
      return null;
    }

    if (opportunity.reviewState !== "in_review" && opportunity.reviewState !== "saved") {
      throw new InvalidPromotionError(
        "Only in_review or saved matched opportunities can be promoted."
      );
    }

    const memoryPatterns = await this.db.listMemoryPatterns();
    const adjustedPriorityScore = calculateMemoryAdjustedPriority(
      opportunity,
      memoryPatterns
    );

    return this.db.upsertAutonomousContentWorkItem({
      sourceMatchedOpportunityId: opportunity.id,
      watchlistId: opportunity.watchlistId,
      autonomousRunId: opportunity.autonomousRunId,
      workItemKind: toAutonomousContentWorkItemKind(opportunity.recommendedAction),
      title: opportunity.title,
      summary: buildAutonomousContentWorkItemSummary(opportunity),
      rationale: opportunity.matchRationale,
      recommendedAction: opportunity.recommendedAction,
      priorityScore: adjustedPriorityScore,
      priorityBand: opportunity.priorityBand,
      reviewState: opportunity.reviewState,
      aiContent: opportunity.aiContent,
      draftSeed: buildAutonomousContentDraftSeed(opportunity)
    });
  }

  async listSourceItems(): Promise<SourceItem[]> {
    return this.db.listSourceItems();
  }

  async listMarketProfiles(): Promise<MarketProfile[]> {
    return this.db.listMarketProfiles();
  }

  async listTopicScores(): Promise<TopicScore[]> {
    return this.db.listTopicScores();
  }

  async listContentQueueItems(): Promise<ContentQueueItem[]> {
    return this.db.listContentQueueItems();
  }

  async listCandidateQueueItems(): Promise<CandidateQueueItem[]> {
    return this.db.listCandidateQueueItems();
  }

  async getCandidateQueueItemDetail(candidateId: string): Promise<CandidateQueueItemDetail> {
    const candidate = await this.db.getCandidateQueueItemById(candidateId);
    if (!candidate) {
      throw new NotFoundError(`Candidate queue item '${candidateId}' was not found.`);
    }

    const signal = await this.db.getSignalById(candidate.signalId);
    if (!signal) {
      throw new NotFoundError(`Signal '${candidate.signalId}' was not found.`);
    }

    const analysis = (await this.db.listSignalAnalysesBySignalId(candidate.signalId)).find(
      (item) => item.id === candidate.signalAnalysisId
    );
    if (!analysis) {
      throw new NotFoundError(
        `Signal analysis '${candidate.signalAnalysisId}' was not found for candidate '${candidateId}'.`
      );
    }

    const decision = (await this.db.listOrchestratorDecisions()).find(
      (item) => item.id === candidate.orchestratorDecisionId
    );
    if (!decision) {
      throw new NotFoundError(
        `Orchestrator decision '${candidate.orchestratorDecisionId}' was not found for candidate '${candidateId}'.`
      );
    }

    const contentAsset = candidate.contentAssetId
      ? await this.db.getContentAssetById(candidate.contentAssetId)
      : null;
    const criticReview = contentAsset
      ? getLatestCriticReviewForContent(await this.db.listWritingQualityAssessments(), contentAsset.id)
      : undefined;

    return {
      candidate,
      signal,
      signalAnalysis: analysis,
      ...(contentAsset ? { contentAsset } : {}),
      ...(criticReview ? { criticReview } : {}),
      orchestratorDecision: decision
    };
  }

  async applyCandidateQueueOperatorAction(
    candidateId: string,
    input: {
      action: CandidateQueueOperatorAction;
      operatorNote?: string;
    }
  ): Promise<CandidateQueueItemDetail> {
    const detail = await this.getCandidateQueueItemDetail(candidateId);
    const { candidate, contentAsset, criticReview } = detail;

    switch (input.action) {
      case "approve_for_publication": {
        const updatedCandidate = await this.db.updateCandidateQueueItem(candidateId, {
          queueState: "ready_to_publish",
          whyQueued: "Approved by the operator and ready for publication handling.",
          nextAction: "approved_for_publication",
          requiresHumanReview: false,
          operatorNote: input.operatorNote
        });

        if (!updatedCandidate) {
          throw new NotFoundError(`Candidate queue item '${candidateId}' was not found.`);
        }

        const updatedContent = contentAsset
          ? await this.db.updateContentAssetCriticState(contentAsset.id, {
              contentStatus: "ready",
              publishReadyFlag: true,
              qualityStatus: contentAsset.qualityStatus,
              overallQualityScore: contentAsset.overallQualityScore
            })
          : null;

        return {
          ...detail,
          candidate: updatedCandidate,
          ...(updatedContent ? { contentAsset: updatedContent } : {})
        };
      }
      case "mark_needs_revision": {
        const updatedCandidate = await this.db.updateCandidateQueueItem(candidateId, {
          queueState: "revision_requested",
          whyQueued:
            "Revision was requested by the operator before publication review can continue.",
          nextAction: "revise_content_candidate",
          requiresHumanReview: true,
          operatorNote: input.operatorNote
        });

        if (!updatedCandidate) {
          throw new NotFoundError(`Candidate queue item '${candidateId}' was not found.`);
        }

        const updatedContent = contentAsset
          ? await this.db.updateContentAssetCriticState(contentAsset.id, {
              contentStatus: "review",
              publishReadyFlag: false,
              qualityStatus: contentAsset.qualityStatus,
              overallQualityScore: contentAsset.overallQualityScore
            })
          : null;

        return {
          ...detail,
          candidate: updatedCandidate,
          ...(updatedContent ? { contentAsset: updatedContent } : {})
        };
      }
      case "archive_candidate": {
        const updatedCandidate = await this.db.updateCandidateQueueItem(candidateId, {
          queueState: "archived",
          whyQueued: "Archived by the operator and removed from the active Day-1 review lane.",
          nextAction: "archived",
          requiresHumanReview: false,
          operatorNote: input.operatorNote
        });

        if (!updatedCandidate) {
          throw new NotFoundError(`Candidate queue item '${candidateId}' was not found.`);
        }

        const updatedContent = contentAsset
          ? await this.db.updateContentAssetCriticState(contentAsset.id, {
              contentStatus: "archived",
              publishReadyFlag: false,
              qualityStatus: contentAsset.qualityStatus,
              overallQualityScore: contentAsset.overallQualityScore
            })
          : null;

        return {
          ...detail,
          candidate: updatedCandidate,
          ...(updatedContent ? { contentAsset: updatedContent } : {})
        };
      }
      default:
        throw new AnalysisBlockedError(`Unsupported candidate action '${input.action}'.`);
    }
  }

  async evaluateFactoryPriority(input?: {
    now?: string;
  }): Promise<FactoryPrioritySelectionResult> {
    const now = input?.now ?? new Date().toISOString();
    const signals = await this.db.listSignals();
    const [
      analyses,
      candidateQueueItems,
      contentAssets,
      criticReviews,
      decisions,
      solutionMemories,
      autonomousRuns,
      memoryPatterns
    ] = await Promise.all([
      Promise.all(signals.map((signal) => this.db.listSignalAnalysesBySignalId(signal.id))),
      this.db.listCandidateQueueItems(),
      this.db.listContentAssets(),
      this.db.listWritingQualityAssessments(),
      this.db.listOrchestratorDecisions(),
      this.db.listSolutionMemories(),
      this.db.listAutonomousRuns(),
      this.db.listMemoryPatterns()
    ]);

    const flattenedAnalyses = analyses.flat();
    const signalsWithQueuedCandidates = new Set(candidateQueueItems.map((item) => item.signalId));

    const signalDecisions = signals
      .map((signal) =>
        buildSignalPriorityDecision({
          signal,
          analysis: getLatestSignalAnalysisForSignal(flattenedAnalyses, signal.id),
          runs: autonomousRuns,
          memoryPatterns,
          now,
          alreadyQueued: signalsWithQueuedCandidates.has(signal.id)
        })
      )
      .sort(compareFactoryPriorityDecision);

    const candidateDecisions = candidateQueueItems
      .map((candidate) => {
        const analysis = flattenedAnalyses.find((item) => item.id === candidate.signalAnalysisId);
        const signal = signals.find((item) => item.id === candidate.signalId);
        const contentAsset = candidate.contentAssetId
          ? contentAssets.find((item) => item.id === candidate.contentAssetId)
          : undefined;
        const criticReview = candidate.criticReviewId
          ? criticReviews.find((item) => item.id === candidate.criticReviewId)
          : undefined;
        const solutionMemory = candidate.solutionMemoryId
          ? solutionMemories.find((item) => item.id === candidate.solutionMemoryId)
          : solutionMemories.find((item) => item.signalId === candidate.signalId);
        const decision = decisions.find((item) => item.id === candidate.orchestratorDecisionId);

        if (!signal) {
          return undefined;
        }

        return buildCandidatePriorityDecision({
          candidate,
          signal,
          analysis,
          contentAsset,
          criticReview,
          solutionMemory,
          decision,
          memoryPatterns,
          now
        });
      })
      .filter((item): item is FactoryPriorityDecision => Boolean(item))
      .sort(compareFactoryPriorityDecision);

    return {
      evaluatedAt: now,
      signals: signalDecisions,
      candidateQueueItems: candidateDecisions
    };
  }

  async listBrandVoiceProfiles(): Promise<BrandVoiceProfile[]> {
    return this.db.listBrandVoiceProfiles();
  }

  getProviderConfigSummary() {
    return this.providerRouter.getSummary();
  }

  async probeTextProvider(): Promise<AIProviderProbeResult> {
    return this.providerRouter.probeTextProvider();
  }

  async cleanupLaunchSmokeArtifacts(
    smokeTag: string
  ): Promise<LaunchSmokeCleanupResult> {
    const [watchlists, matchedOpportunities, contentWorkItems] = await Promise.all([
      this.db.listAutonomousWatchlists(),
      this.db.listAutonomousMatchedOpportunities(),
      this.db.listAutonomousContentWorkItems()
    ]);

    const taggedWatchlists = watchlists.filter((item) => item.notes === smokeTag);
    const taggedMatchedOpportunities = matchedOpportunities.filter((item) =>
      item.reviewNote?.includes(smokeTag)
    );
    const taggedContentWorkItems = contentWorkItems.filter(
      (item) => item.workNote === smokeTag
    );

    const watchlistIds = taggedWatchlists.map((item) => item.id);
    const matchedOpportunityIds = taggedMatchedOpportunities.map((item) => item.id);
    const contentWorkItemIds = taggedContentWorkItems.map((item) => item.id);

    await this.db.deleteAutonomousDraftDocumentsBySourceContentWorkItemIds(
      contentWorkItemIds
    );
    await this.db.deleteAutonomousContentWorkItemsByIds(contentWorkItemIds);
    await this.db.deleteAutonomousMatchedOpportunitiesByIds(matchedOpportunityIds);
    await this.db.deleteAutonomousReviewQueueItemsByWatchlistIds(watchlistIds);
    await this.db.deleteAutonomousIngestionArtifactsByWatchlistIds(watchlistIds);
    await this.db.deleteAutonomousRunsByWatchlistIds(watchlistIds);
    await this.db.deleteAutonomousWatchlistsByIds(watchlistIds);

    return {
      smokeTag,
      deletedWatchlistCount: taggedWatchlists.length,
      deletedMatchedOpportunityCount: taggedMatchedOpportunities.length,
      deletedContentWorkItemCount: taggedContentWorkItems.length,
      totalDeleted:
        taggedWatchlists.length +
        taggedMatchedOpportunities.length +
        taggedContentWorkItems.length
    };
  }

  async createBrandVoiceProfile(
    input: CreateBrandVoiceProfileInput
  ): Promise<BrandVoiceProfile> {
    const normalized = await brandVoiceAgent(input);
    return this.db.createBrandVoiceProfile(normalized);
  }

  async getActiveBrandVoiceProfile(): Promise<BrandVoiceProfile | null> {
    return this.db.getActiveBrandVoiceProfile();
  }

  async generateIdeaFromSignal(signalId: string): Promise<Idea> {
    const signal = await this.db.getSignalById(signalId);
    if (!signal) throw new NotFoundError(`Signal ${signalId} not found`);

    const draft = await providerBackedBusinessTranslatorService({
      signal,
      router: this.providerRouter
    });
    return this.db.createIdea({
      signalId: signal.id,
      title: draft.title,
      coreInsight: draft.coreInsight,
      businessRelevance: draft.businessRelevance,
      targetAudience: draft.targetAudience,
      status: draft.status
    });
  }

  async generateContentFromIdea(ideaId: string): Promise<ContentAsset> {
    const idea = await this.db.getIdeaById(ideaId);
    if (!idea) throw new NotFoundError(`Idea ${ideaId} not found`);
    const brandVoice = await this.db.getActiveBrandVoiceProfile();
    const draft = await providerBackedHumanWritingService({
      idea,
      router: this.providerRouter,
      brandVoice
    });
    const storedDraft = await this.db.createContentAsset({
      ideaId: idea.id,
      contentType: draft.content.contentType,
      hook: draft.content.hook.trim(),
      body: draft.content.body.replace(/\s+/g, " ").trim(),
      cta: draft.content.cta.trim(),
      status: draft.content.status,
      qualityStatus: draft.content.qualityStatus,
      overallQualityScore: draft.content.overallQualityScore,
      brandVoiceProfileId: draft.content.brandVoiceProfileId
    });
    return storedDraft;
  }

  async refineContentDraft(contentId: string): Promise<ContentAsset> {
    const content = await this.db.getContentAssetById(contentId);
    if (!content) throw new NotFoundError(`Content ${contentId} not found`);
    const brandVoice = await this.db.getActiveBrandVoiceProfile();

    const refinement = await providerBackedVoiceEditorService({
      content,
      router: this.providerRouter
    });
    const quality = await writingQualityAgent({
      content: {
        id: content.id,
        hook: refinement.refinedHook,
        body: refinement.refinedBody,
        cta: refinement.refinedCta
      },
      brandVoice
    });
    const updated = await this.db.updateContentAssetRefinement(contentId, {
      refinedHook: quality.refinement.refinedHook,
      refinedBody: quality.refinement.refinedBody,
      refinedCta: quality.refinement.refinedCta,
      refinementStatus: refinement.refinementStatus,
      qualityStatus: quality.refinement.qualityStatus,
      overallQualityScore: quality.refinement.overallQualityScore,
      brandVoiceProfileId:
        quality.refinement.brandVoiceProfileId ?? content.brandVoiceProfileId
    });
    if (!updated) throw new NotFoundError(`Content ${contentId} not found`);
    await this.db.createWritingQualityAssessment(quality.assessment);
    return updated;
  }

  async generateFinalPost(
    contentId: string,
    config?: FinalPostGenerationConfig,
    outcomeContext?: FinalPostOutcomeContext
  ): Promise<ContentAsset> {
    const content = await this.db.getContentAssetById(contentId);
    if (!content) throw new NotFoundError(`Content ${contentId} not found`);

    const brandVoice = await this.db.getActiveBrandVoiceProfile();
    const finalPost = await providerBackedFinalPostService({
      content,
      router: this.providerRouter,
      brandVoice,
      config,
      outcomeContext
    });

    const updated = await this.db.updateContentAssetFinalPost(contentId, {
      finalHook: finalPost.finalization.finalHook,
      finalBody: finalPost.finalization.finalBody,
      finalClosing: finalPost.finalization.finalClosing,
      finalStatus: finalPost.finalization.finalStatus,
      finalQualityScore: finalPost.finalization.finalQualityScore
    });
    if (!updated) throw new NotFoundError(`Content ${contentId} not found`);
    return {
      ...updated,
      finalQualityMetadata: finalPost.finalization.finalQualityMetadata
    };
  }

  async generateExperimentalPostV2(input: {
    signalId?: string;
    ideaId?: string;
    contentId?: string;
    brandVoice?: CreateBrandVoiceProfileInput;
  }): Promise<{
    signalId: string;
    ideaId: string | null;
    contentId: string | null;
    hook: string;
    post: string;
    mode: "provider" | "deterministic";
    generatorVersion: "v2";
  }> {
    const content = input.contentId
      ? await this.db.getContentAssetById(input.contentId)
      : null;
    if (input.contentId && !content) {
      throw new NotFoundError(`Content ${input.contentId} not found`);
    }

    const explicitIdea = input.ideaId ? await this.db.getIdeaById(input.ideaId) : null;
    if (input.ideaId && !explicitIdea) {
      throw new NotFoundError(`Idea ${input.ideaId} not found`);
    }

    const derivedIdea = content ? await this.db.getIdeaById(content.ideaId) : null;
    const idea = explicitIdea ?? derivedIdea;

    const signalId = input.signalId ?? idea?.signalId;
    if (!signalId) {
      throw new NotFoundError("Signal id is required when no linked content or idea is provided");
    }

    const signal = await this.db.getSignalById(signalId);
    if (!signal) throw new NotFoundError(`Signal ${signalId} not found`);

    const result = await experimentalLinkedInPostWriterV2({
      signal,
      idea,
      content,
      brandVoice: input.brandVoice ?? (await this.db.getActiveBrandVoiceProfile()),
      router: this.providerRouter
    });

    return {
      signalId: signal.id,
      ideaId: idea?.id ?? null,
      contentId: content?.id ?? null,
      hook: result.hook,
      post: result.post,
      mode: result.mode,
      generatorVersion: "v2"
    };
  }

  async generateComment(input: GenerateCommentInput): Promise<GeneratedComment> {
    return providerBackedCommentService({
      ...input,
      router: this.providerRouter
    });
  }

  async generateReply(input: GenerateReplyInput): Promise<GeneratedReply> {
    return providerBackedReplyService({
      ...input,
      router: this.providerRouter
    });
  }

  async analyzeRelevance(input: AnalyzeRelevanceInput): Promise<RelevanceAnalysis> {
    return relevanceAnalyzer(input);
  }

  async planDecision(input: DecisionLayerInput): Promise<DecisionPlan> {
    return buildDecisionPlan(input);
  }

  async planGrowthRhythm(input: GrowthRhythmInput): Promise<GrowthRhythmPlan> {
    return buildGrowthRhythmPlan(input);
  }

  async scoutAudience(input: AudienceScoutInput): Promise<AudienceScoutResult> {
    return enrichAudienceScoutResult(buildAudienceScoutResult(input), this.providerRouter);
  }

  async scoutSolutions(input: SolutionScoutInput): Promise<SolutionScoutResult> {
    return enrichSolutionScoutResult(buildSolutionScoutResult(input), this.providerRouter);
  }

  async matchScoutOpportunities(input: ScoutMatchInput): Promise<ScoutMatchResult> {
    return enrichScoutMatchResult(buildScoutMatchResult(input), this.providerRouter);
  }

  async runScoutFeed(input: ScoutFeedInput): Promise<ScoutFeedResult> {
    const result = buildScoutFeedResult(input);
    const enrichedAudience = result.audienceItems
      ? await enrichAudienceScoutResult(
          {
            items: result.audienceItems,
            summary: result.summary,
            notes: result.notes
          },
          this.providerRouter
        )
      : null;
    const enrichedSolutions = result.solutionItems
      ? await enrichSolutionScoutResult(
          {
            items: result.solutionItems,
            summary: result.summary,
            notes: result.notes
          },
          this.providerRouter
        )
      : null;

    return {
      ...result,
      audienceItems: enrichedAudience?.items ?? result.audienceItems,
      solutionItems: enrichedSolutions?.items ?? result.solutionItems
    };
  }

  async recommendNextMove(
    input: OrchestratedRecommendationInput
  ): Promise<OrchestratedRecommendation> {
    return buildOrchestratedRecommendation(input);
  }

  async generateMatchContent(
    savedMatch: PersistedMatchedOpportunity
  ): Promise<PersistedMatchedOpportunity> {
    const memoryPatterns = await this.db.listMemoryPatterns();
    const aiContent = await providerBackedMatchContentService({
      savedMatch,
      router: this.providerRouter,
      memoryPatterns
    });

    if (!aiContent) {
      return savedMatch;
    }

    return {
      ...savedMatch,
      match: {
        ...savedMatch.match,
        aiContent
      }
    };
  }

  async tickAutonomousScheduler(
    now = new Date().toISOString()
  ): Promise<AutonomousSchedulerTickResult> {
    const watchlists = await this.db.listAutonomousWatchlists();
    const dueWatchlists = watchlists.filter((watchlist) =>
      isAutonomousWatchlistDue(watchlist, now)
    );
    const skippedWatchlistIds = watchlists
      .filter((watchlist) => !dueWatchlists.some((candidate) => candidate.id === watchlist.id))
      .map((watchlist) => watchlist.id);
    const runs: AutonomousRun[] = [];

    for (const watchlist of dueWatchlists) {
      const activeRun = await this.db.findActiveAutonomousRunForWatchlist(watchlist.id);
      if (activeRun) {
        const staleThresholdMs = 10 * 60 * 1000;
        const runAge = activeRun.startedAt
          ? Date.now() - new Date(activeRun.startedAt).getTime()
          : Infinity;

        if (runAge > staleThresholdMs) {
          await this.db.updateAutonomousRun(activeRun.id, {
            status: "failed",
            completedAt: now,
            errorSummary: "Run timed out after 10 minutes (stale running state)."
          });
        } else {
          skippedWatchlistIds.push(watchlist.id);
          continue;
        }
      }

      const queuedRun = await this.db.createAutonomousRun({
        watchlistId: watchlist.id,
        triggerType: "scheduler",
        runType: "watchlist_scout_feed",
        status: "queued"
      });
      const runningRun =
        (await this.db.updateAutonomousRun(queuedRun.id, {
          status: "running",
          startedAt: now
        })) ?? queuedRun;

      try {
        let scoutFeedInput: ScoutFeedInput | undefined;
        let ingestionArtifactCount = 0;
        let persistedArtifacts: AutonomousIngestionArtifact[] = [];
        let ingestionStatus: NonNullable<
          NonNullable<AutonomousRun["resultMetadata"]>["ingestionStatus"]
        > = "not_applicable";

        if (supportsAutomatedUrlIngestion(watchlist)) {
          const ingestion = await ingestWatchlistSources(watchlist, queuedRun.id, {
            fetchImpl: this.watchlistFetch
          });
          ingestionArtifactCount = ingestion.artifacts.length;
          scoutFeedInput = ingestion.scoutFeedInput;

          for (const artifact of ingestion.artifacts) {
            persistedArtifacts.push(
              await this.db.createAutonomousIngestionArtifact(artifact)
            );
          }

          if (ingestion.artifacts.some((artifact) => artifact.status === "failed")) {
            ingestionStatus = "failed";
            const failedRun =
              (await this.db.updateAutonomousRun(queuedRun.id, {
                status: "failed",
                completedAt: new Date().toISOString(),
                errorSummary:
                  ingestion.artifacts.find((artifact) => artifact.status === "failed")
                    ?.errorSummary ?? "Automated ingestion failed.",
                resultMetadata: {
                  audienceItemCount: 0,
                  solutionItemCount: 0,
                  usedAi: false,
                  ingestionArtifactCount,
                  ingestionStatus
                }
              })) ?? runningRun;
            const nextRunAt = computeNextAutonomousWatchlistRunAt(
              watchlist.refreshCadence,
              now
            );
            await this.db.updateAutonomousWatchlist(watchlist.id, {
              lastRunAt: now,
              nextRunAt: nextRunAt ?? undefined
            });
            runs.push(failedRun);
            continue;
          }

          ingestionStatus = scoutFeedInput ? "completed" : "empty";
        }

        const result = await this.runScoutFeed(
          scoutFeedInput ?? buildScoutFeedInputFromAutonomousWatchlist(watchlist)
        );
        const queueItems = mapScoutFeedResultToReviewQueueItems({
          watchlistId: watchlist.id,
          autonomousRunId: queuedRun.id,
          sourceArtifactId: persistedArtifacts[0]?.id,
          audienceItems: result.audienceItems,
          solutionItems: result.solutionItems
        });

        for (const queueItem of queueItems) {
          await this.db.upsertAutonomousReviewQueueItem(queueItem);
        }
        const persistedQueueItems = (await this.db.listAutonomousReviewQueueItems()).filter(
          (item) => item.status !== "archived"
        );
        const activeQueueItems = persistedQueueItems.filter(
          (item) => item.watchlistId === watchlist.id
        );
        const matchedOpportunities = mapAutonomousReviewQueueToMatchedOpportunities({
          watchlistId: watchlist.id,
          autonomousRunId: queuedRun.id,
          queueItems: persistedQueueItems,
          activeQueueItems
        });

        for (const matchedOpportunity of matchedOpportunities) {
          await this.db.upsertAutonomousMatchedOpportunity(matchedOpportunity);
        }

        // Apply auto-promotion rules if configured
        if (watchlist.autoPromotionRules?.enabled) {
          const createdOpportunities = await this.db.listAutonomousMatchedOpportunities({
            reviewState: "new"
          });
          const watchlistOpportunities = createdOpportunities.filter(
            (opp) => opp.watchlistId === watchlist.id && opp.autonomousRunId === queuedRun.id
          );

          for (const opportunity of watchlistOpportunities) {
            if (this.shouldAutoPromote(opportunity, watchlist.autoPromotionRules)) {
              try {
                // Mark as saved first
                await this.db.updateAutonomousMatchedOpportunityReviewState(opportunity.id, {
                  reviewState: "saved",
                  reviewNote: "Auto-promoted by rule"
                });

                // Promote to work item
                const workItem = await this.promoteAutonomousMatchedOpportunity(opportunity.id);

                // Optionally auto-generate draft
                if (workItem && watchlist.autoPromotionRules.autoDraftGeneration) {
                  await this.createAutonomousDraftWithAiGeneration(workItem.id);
                }
              } catch (error) {
                console.log(
                  `[Auto-promotion] Failed to promote opportunity ${opportunity.id}:`,
                  error
                );
              }
            }
          }
        }

        const metadata = {
          audienceItemCount: result.audienceItems?.length ?? 0,
          solutionItemCount: result.solutionItems?.length ?? 0,
          usedAi:
            Boolean(result.audienceItems?.some((item) => item.aiEnrichment)) ||
            Boolean(result.solutionItems?.some((item) => item.aiEnrichment)),
          ingestionArtifactCount,
          ingestionStatus
        } as const;
        const completedRun =
          (await this.db.updateAutonomousRun(queuedRun.id, {
            status: "completed",
            completedAt: new Date().toISOString(),
            resultSummary: result.summary,
            resultMetadata: metadata
          })) ?? runningRun;

        const nextRunAt = computeNextAutonomousWatchlistRunAt(
          watchlist.refreshCadence,
          now
        );
        await this.db.updateAutonomousWatchlist(watchlist.id, {
          lastRunAt: now,
          nextRunAt: nextRunAt ?? undefined
        });
        runs.push(completedRun);
      } catch (error) {
        const failedRun =
          (await this.db.updateAutonomousRun(queuedRun.id, {
            status: "failed",
            completedAt: new Date().toISOString(),
            errorSummary:
              error instanceof Error ? error.message : "Autonomous run failed."
          })) ?? runningRun;
        const nextRunAt = computeNextAutonomousWatchlistRunAt(
          watchlist.refreshCadence,
          now
        );
        await this.db.updateAutonomousWatchlist(watchlist.id, {
          lastRunAt: now,
          nextRunAt: nextRunAt ?? undefined
        });
        runs.push(failedRun);
      }
    }

    const existingRuns = await this.db.listAutonomousRuns();
    const signalIdsWithPipelineRuns = new Set(
      existingRuns
        .filter((run) => run.runType === "signal_pipeline" && typeof run.signalId === "string")
        .map((run) => run.signalId as string)
    );
    const pendingSignals = (await this.db.listSignals())
      .filter((signal) => !signalIdsWithPipelineRuns.has(signal.id))
      .slice(0, 5);
    const processedSignalIds: string[] = [];
    const skippedSignalIds = (await this.db.listSignals())
      .filter((signal) => signalIdsWithPipelineRuns.has(signal.id))
      .map((signal) => signal.id);

    for (const signal of pendingSignals) {
      const runResult = await this.runAutonomousSignalPipeline(signal.id, {
        triggerType: "scheduler",
        startedAt: now
      });
      processedSignalIds.push(signal.id);
      runs.push(runResult.run);
    }

    const allOpportunities = await this.db.listAutonomousMatchedOpportunities();
    const eligibleForAutoPromotion = allOpportunities.filter((opp) => {
      return (
        opp.recommendedAction === "write_post" &&
        opp.reviewState === "new" &&
        (opp.confidence === "high" || opp.confidence === "medium") &&
        (opp.priorityBand === "high" || opp.priorityBand === "medium")
      );
    });

    for (const opportunity of eligibleForAutoPromotion) {
      try {
        await this.db.updateAutonomousMatchedOpportunityReviewState(opportunity.id, {
          reviewState: "saved",
          reviewNote: "Auto-promoted by scheduler: high-confidence write_post opportunity"
        });

        const workItem = await this.promoteAutonomousMatchedOpportunity(opportunity.id);
        if (workItem) {
          if (this.enableAutonomousAiDrafts) {
            try {
              // Use integrated generation path with refinement stack + final post service
              await this.createAutonomousDraftWithAiGeneration(workItem.id);
            } catch (aiError) {
              console.error(`Integrated generation failed for work item ${workItem.id}, falling back to basic draft:`, aiError);
              await this.createAutonomousDraftDocumentFromWorkItem(workItem.id);
            }
          } else {
            await this.createAutonomousDraftDocumentFromWorkItem(workItem.id);
          }
        }
      } catch (error) {
        console.error(`Auto-promotion failed for opportunity ${opportunity.id}:`, error);
        continue;
      }
    }

    return {
      evaluatedAt: now,
      dueWatchlistIds: dueWatchlists.map((watchlist) => watchlist.id),
      skippedWatchlistIds,
      processedSignalIds,
      skippedSignalIds,
      runs
    };
  }

  async normalizeSourceIntake(input: SourceIntakeInput): Promise<NormalizedSourceSignal> {
    return normalizeSourceIntake(input);
  }

  async runGitHubSolutionDiscovery(config?: {
    topics?: string[];
    minStars?: number;
    maxResults?: number;
  }): Promise<{
    discovered: number;
    created: number;
    skipped: number;
    watchlists: AutonomousWatchlist[];
    summary: string;
  }> {
    const { discoverGitHubSolutions, DEFAULT_SOLUTION_DISCOVERY_TOPICS } = await import(
      "@linkedin-brand-os/agent-services"
    );

    const result = await discoverGitHubSolutions({
      topics: config?.topics ?? DEFAULT_SOLUTION_DISCOVERY_TOPICS,
      minStars: config?.minStars ?? 50,
      maxResults: config?.maxResults ?? 5,
      fetchImpl: this.watchlistFetch
    });

    const existingWatchlists = await this.db.listAutonomousWatchlists();
    const existingUrls = new Set(
      existingWatchlists.map((w) => w.sourceUrl).filter((url): url is string => Boolean(url))
    );

    const created: AutonomousWatchlist[] = [];
    let skipped = 0;

    for (const candidate of result.watchlistCandidates) {
      if (candidate.sourceUrl && existingUrls.has(candidate.sourceUrl)) {
        skipped += 1;
        continue;
      }

      const watchlist = await this.db.createAutonomousWatchlist(candidate);
      created.push(watchlist);
    }

    return {
      discovered: result.repos.length,
      created: created.length,
      skipped,
      watchlists: created,
      summary: `Discovered ${result.repos.length} repos, created ${created.length} new watchlists, skipped ${skipped} duplicates.`
    };
  }

  async runHackerNewsAudienceDiscovery(config?: {
    painKeywords?: string[];
    minScore?: number;
    maxResults?: number;
  }): Promise<{
    discovered: number;
    created: number;
    skipped: number;
    watchlists: AutonomousWatchlist[];
    summary: string;
  }> {
    const { discoverHackerNewsAudience, DEFAULT_PAIN_KEYWORDS } = await import(
      "@linkedin-brand-os/agent-services"
    );

    const result = await discoverHackerNewsAudience({
      painKeywords: config?.painKeywords ?? DEFAULT_PAIN_KEYWORDS,
      minScore: config?.minScore ?? 5,
      maxResults: config?.maxResults ?? 10,
      fetchImpl: this.watchlistFetch
    });

    const existingWatchlists = await this.db.listAutonomousWatchlists();
    const existingUrls = new Set(
      existingWatchlists.map((w) => w.sourceUrl).filter((url): url is string => Boolean(url))
    );

    const created: AutonomousWatchlist[] = [];
    let skipped = 0;

    for (const candidate of result.watchlistCandidates) {
      if (candidate.sourceUrl && existingUrls.has(candidate.sourceUrl)) {
        skipped += 1;
        continue;
      }

      const watchlist = await this.db.createAutonomousWatchlist(candidate);
      created.push(watchlist);
    }

    return {
      discovered: result.stories.length,
      created: created.length,
      skipped,
      watchlists: created,
      summary: `Discovered ${result.stories.length} HN discussions, created ${created.length} new watchlists, skipped ${skipped} duplicates.`
    };
  }

  async generateVisualForContent(contentId: string): Promise<VisualAsset> {
    const content = await this.db.getContentAssetById(contentId);
    if (!content) throw new NotFoundError(`Content ${contentId} not found`);

    const draft = await providerBackedVisualService({
      content,
      router: this.providerRouter
    });
    return this.db.createVisualAsset({
      contentAssetId: content.id,
      title: draft.title,
      visualType: draft.visualType,
      prompt: draft.prompt,
      status: draft.status
    });
  }

  async recordAnalyticsSnapshot(
    input: CreateAnalyticsSnapshotInput
  ): Promise<AnalyticsSnapshot> {
    return this.db.createAnalyticsSnapshot(input);
  }

  async recordAnalyticsSnapshotAndUpdateMemory(
    input: CreateAnalyticsSnapshotInput
  ): Promise<AnalyticsMemoryUpdateResult> {
    const content = await this.db.getContentAssetById(input.contentAssetId);
    if (!content) {
      throw new NotFoundError(`Content asset '${input.contentAssetId}' was not found.`);
    }

    const signalId = await resolveSignalIdForContentAsset(this.db, content);
    if (!signalId) {
      throw new NotFoundError(
        `Content asset '${input.contentAssetId}' is missing signal linkage for analytics learning.`
      );
    }

    const signal = await this.db.getSignalById(signalId);
    if (!signal) {
      throw new NotFoundError(`Signal '${signalId}' was not found.`);
    }

    const snapshot = await this.db.createAnalyticsSnapshot(input);
    const analyses = await this.db.listSignalAnalysesBySignalId(signalId);
    const analysis = content.signalAnalysisId
      ? analyses.find((candidate) => candidate.id === content.signalAnalysisId) ?? analyses[0]
      : analyses[0];
    const decision = content.orchestratorDecisionId
      ? (await this.db.listOrchestratorDecisions()).find(
          (candidate) => candidate.id === content.orchestratorDecisionId
        )
      : getLatestOrchestratorDecisionForSignal(await this.db.listOrchestratorDecisions(), signalId);
    const criticReview = getLatestCriticReviewForContent(
      await this.db.listWritingQualityAssessments(),
      content.id
    );
    const existingPatterns = await this.db.listMemoryPatterns();
    const interpretation = interpretPerformanceSnapshot(snapshot);
    const learningInputs = buildMemoryPatternInputsFromSnapshot({
      signal,
      analysis,
      content,
      decision,
      criticReview,
      snapshot,
      outcomeClassification: interpretation.classification,
      existingPatterns
    });

    const memoryPatterns: MemoryPattern[] = [];
    for (const learningInput of learningInputs) {
      memoryPatterns.push(await this.db.upsertMemoryPattern(learningInput));
    }

    return {
      snapshot,
      outcomeClassification: interpretation.classification,
      memoryPatterns
    };
  }

  async analyzePerformance(input?: StrategyAnalysisInput): Promise<StrategyRecommendation[]> {
    const snapshots = await this.db.listAnalyticsSnapshots();
    const contentAssets = await this.db.listContentAssets();
    const findings = await analyticsAgent({ snapshots });
    const drafts = await strategyAgent({
      findings,
      contentAssets,
      feedbackSummary: input?.feedbackSummary,
      patternMemorySummary: input?.patternMemorySummary
    });
    return Promise.all(
      drafts.map((draft) => this.db.createStrategyRecommendation(draft))
    );
  }

  async ingestSourceItem(input: CreateSourceItemInput): Promise<SourceItem> {
    const normalized = await sourceNormalizerAgent(input);
    return this.db.createSourceItem({
      ...input,
      normalizedSummary: normalized.normalizedSummary,
      tags: normalized.tags,
      status: normalized.status
    });
  }

  async ingestMarketProfile(
    input: CreateMarketProfileInput
  ): Promise<MarketProfile> {
    const structured = await marketIntelligenceAgent(input);
    return this.db.createMarketProfile({
      ...input,
      marketNote: structured.marketNote,
      linkedinPriority: structured.linkedinPriority,
      serviceFitScore: structured.serviceFitScore
    });
  }

  async scoreTopics(): Promise<TopicScore[]> {
    const [sources, ideas, markets] = await Promise.all([
      this.db.listSourceItems(),
      this.db.listIdeas(),
      this.db.listMarketProfiles()
    ]);
    const drafts = await topicScoringAgent({ sources, ideas, markets });
    return Promise.all(drafts.map((draft) => this.db.createTopicScore(draft)));
  }

  async buildContentQueue(): Promise<ContentQueueItem[]> {
    const scores = await this.db.listTopicScores();
    const drafts = await queuePlannerAgent({ topicScores: scores });
    return Promise.all(drafts.map((draft) => this.db.createContentQueueItem(draft)));
  }
}

function getAutonomousContentWorkspaceStatusSortValue(
  status: AutonomousContentWorkItem["status"]
): number {
  switch (status) {
    case "ready_for_draft":
      return 0;
    case "draft":
      return 1;
    case "parked":
      return 2;
    case "blocked":
      return 3;
    case "archived":
      return 4;
    default:
      return 5;
  }
}

function getAutonomousContentWorkspaceTimestampValue(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function sortAutonomousContentWorkspaceFeed(
  items: AutonomousContentWorkItem[],
  sort?: "updated_desc" | "updated_asc" | "status" | "has_draft"
): AutonomousContentWorkItem[] {
  if (!sort || sort === "updated_desc") {
    return items;
  }

  const sorted = [...items];

  sorted.sort((left, right) => {
    if (sort === "updated_asc") {
      return (
        getAutonomousContentWorkspaceTimestampValue(left.updatedAt) -
          getAutonomousContentWorkspaceTimestampValue(right.updatedAt) ||
        getAutonomousContentWorkspaceTimestampValue(left.createdAt) -
          getAutonomousContentWorkspaceTimestampValue(right.createdAt) ||
        left.id.localeCompare(right.id)
      );
    }

    if (sort === "status") {
      return (
        getAutonomousContentWorkspaceStatusSortValue(left.status) -
          getAutonomousContentWorkspaceStatusSortValue(right.status) ||
        getAutonomousContentWorkspaceTimestampValue(right.updatedAt) -
          getAutonomousContentWorkspaceTimestampValue(left.updatedAt) ||
        getAutonomousContentWorkspaceTimestampValue(right.createdAt) -
          getAutonomousContentWorkspaceTimestampValue(left.createdAt) ||
        right.id.localeCompare(left.id)
      );
    }

    const leftHasDraft = left.draftProgress?.hasDraft ? 1 : 0;
    const rightHasDraft = right.draftProgress?.hasDraft ? 1 : 0;
    return (
      rightHasDraft - leftHasDraft ||
      getAutonomousContentWorkspaceTimestampValue(right.updatedAt) -
        getAutonomousContentWorkspaceTimestampValue(left.updatedAt) ||
      getAutonomousContentWorkspaceTimestampValue(right.createdAt) -
        getAutonomousContentWorkspaceTimestampValue(left.createdAt) ||
      right.id.localeCompare(left.id)
    );
  });

  return sorted;
}

function toAutonomousContentWorkItemKind(
  action: AutonomousMatchedOpportunity["recommendedAction"]
): AutonomousContentWorkItem["workItemKind"] {
  if (action === "write_comment") {
    return "comment";
  }
  if (action === "write_reply") {
    return "reply";
  }
  if (action === "save_for_later") {
    return "deferred_note";
  }
  return "post";
}

function calculateMemoryAdjustedPriority(
  opportunity: AutonomousMatchedOpportunity,
  memoryPatterns: MemoryPattern[]
): number {
  const basePriority = opportunity.priorityScore;

  const strongPatterns = memoryPatterns.filter(
    (pattern) => pattern.recommendedAction === "repeat" && pattern.strengthScore >= 2
  );

  if (strongPatterns.length === 0) {
    return basePriority;
  }

  let adjustment = 0;

  for (const pattern of strongPatterns) {
    const parts = pattern.patternKey.split(":");
    const value = parts.slice(2).join(":");
    const normalizedValue = value.replace(/-/g, "_");
    const normalizedAngle = opportunity.suggestedAngle?.replace(/-/g, "_") || "";

    if (pattern.patternType === "angle" && normalizedValue === normalizedAngle) {
      adjustment += pattern.strengthScore * 0.5;
    }

    if (pattern.patternType === "pillar") {
      const keywords = value.split("-");
      const searchText = `${opportunity.matchRationale} ${opportunity.title}`.toLowerCase();
      const matchedKeywords = keywords.filter((keyword) =>
        searchText.includes(keyword.toLowerCase())
      );

      if (matchedKeywords.length >= Math.ceil(keywords.length * 0.5)) {
        adjustment += pattern.strengthScore * 0.3;
      }
    }
  }

  return Math.min(100, basePriority + adjustment);
}

function buildAutonomousContentWorkItemSummary(
  opportunity: AutonomousMatchedOpportunity
): string {
  return `${opportunity.matchedPain} -> ${opportunity.matchedSolutionPattern}`;
}

function buildAutonomousContentDraftSeed(
  opportunity: AutonomousMatchedOpportunity
): AutonomousContentDraftSeed {
  const sourceSummary = buildAutonomousContentWorkItemSummary(opportunity);

  return {
    title: opportunity.title,
    angle: pickDraftSeedAngle(opportunity.aiContent),
    seedText: pickDraftSeedText(opportunity, sourceSummary),
    sourceSummary,
    rationale: opportunity.matchRationale,
    recommendedAction: opportunity.recommendedAction,
    priorityBand: opportunity.priorityBand
  };
}

function pickDraftSeedAngle(aiContent?: AIContentGeneration): string | undefined {
  const candidate = aiContent?.draftAngle ?? aiContent?.angleStub ?? aiContent?.contentIdea;
  return candidate?.trim() ? candidate.trim() : undefined;
}

function pickDraftSeedText(
  opportunity: AutonomousMatchedOpportunity,
  sourceSummary: string
): string {
  const aiSeed =
    opportunity.recommendedAction === "write_post"
      ? opportunity.aiContent?.postSeed
      : opportunity.recommendedAction === "write_comment"
        ? opportunity.aiContent?.commentSeed
        : undefined;

  if (aiSeed?.trim()) {
    return aiSeed.trim();
  }

  return `${sourceSummary}. ${opportunity.matchRationale}`.trim();
}

function convertOpportunityToIdea(opportunity: AutonomousMatchedOpportunity): Idea {
  const enrichment = opportunity.aiEnrichment;

  return {
    id: `auto-${opportunity.id}`,
    signalId: opportunity.watchlistId,
    title: opportunity.title,
    coreInsight:
      enrichment?.improvedSummary ||
      enrichment?.whyItMatters ||
      opportunity.matchRationale,
    businessRelevance:
      enrichment?.businessConsequence ||
      enrichment?.operatorAngle ||
      opportunity.matchedSolutionPattern,
    targetAudience:
      enrichment?.operatorAngle ||
      enrichment?.whyItMatters ||
      opportunity.matchedPain,
    status: "draft",
    createdAt: opportunity.createdAt
  };
}

function attachDraftProgressToContentWorkItems(
  items: AutonomousContentWorkItem[],
  drafts: AutonomousDraftDocument[]
): AutonomousContentWorkItem[] {
  const draftsByWorkItemId = new Map(
    drafts.map((draft) => [draft.sourceContentWorkItemId, draft] as const)
  );

  return items.map((item) =>
    attachDraftProgressToContentWorkItem(item, draftsByWorkItemId.get(item.id))
  );
}

function attachDraftProgressToContentWorkItem(
  item: AutonomousContentWorkItem,
  draft?: AutonomousDraftDocument
): AutonomousContentWorkItem {
  return {
    ...item,
    draftProgress: draft
      ? {
          hasDraft: true,
          draftId: draft.id,
          draftStatus: draft.status,
          draftUpdatedAt: draft.updatedAt
        }
      : {
          hasDraft: false
        }
  };
}

function filterAutonomousContentWorkspaceFeed(
  items: AutonomousContentWorkItem[],
  filter?: {
    hasDraft?: boolean;
    draftStatus?: AutonomousDraftDocument["status"];
  }
): AutonomousContentWorkItem[] {
  return items.filter((item) => {
    if (filter?.hasDraft !== undefined && item.draftProgress?.hasDraft !== filter.hasDraft) {
      return false;
    }

    if (
      filter?.draftStatus !== undefined &&
      item.draftProgress?.draftStatus !== filter.draftStatus
    ) {
      return false;
    }

    return true;
  });
}

function mergeSignalAnalysis(
  signalId: string,
  relevance: import("@linkedin-brand-os/shared").SignalRelevanceAgentOutput,
  business: import("@linkedin-brand-os/shared").SignalBusinessTranslationAgentOutput
): CreateSignalAnalysisInput {
  return {
    signalId,
    relevanceScore: relevance.relevanceScore,
    whyRelevant: relevance.whyRelevant,
    targetAudience: business.targetAudience ?? relevance.targetAudience,
    businessValueSummary: business.businessValueSummary,
    painsSolved: business.painsSolved,
    practicalImplications: business.practicalImplications,
    overhypeNotes: business.overhypeNotes,
    recommendedPillar: relevance.recommendedPillar,
    uniquenessScore: business.uniquenessScore,
    uniquenessReason: business.uniquenessReason,
    buildabilityScore: business.buildabilityScore,
    buildabilityReason: business.buildabilityReason,
    popularityPotentialScore: relevance.popularityPotentialScore,
    brandGrowthPotentialScore: relevance.brandGrowthPotentialScore,
    reasoningJson: {
      relevance: relevance.reasoningJson,
      business: business.reasoningJson
    }
  };
}

async function maybeTranslateSignalWithProvider(
  signal: Signal,
  decision: import("@linkedin-brand-os/shared").ExecutionPolicyResult,
  providerRouter: ProviderRouter
): Promise<
  | {
      businessRelevance: string;
      targetAudience: string;
      coreInsight: string;
    }
  | undefined
> {
  if (decision.chosenTier === "deterministic") {
    return undefined;
  }

  const summary = providerRouter.getSummary();
  if (summary.mode === "deterministic" || summary.textProviderStatus?.available === false) {
    throw new AnalysisBlockedError(
      `Business translation selected ${decision.chosenTier}, but no live text provider is available.`
    );
  }

  const translated = await providerBackedBusinessTranslatorService({
    signal,
    router: providerRouter
  });

  return {
    businessRelevance: translated.businessRelevance,
    targetAudience: translated.targetAudience,
    coreInsight: translated.coreInsight
  };
}

function summarizeSignalForAgentRun(signal: Signal): string {
  return [signal.sourceType, signal.title, signal.sourceDomain]
    .filter(Boolean)
    .join(" | ");
}

function finalizeAgentRunRecord(
  run: CreateAgentRunInput,
  input: Pick<CreateAgentRunInput, "status" | "completedAt" | "outputSummary" | "errorMessage">
): CreateAgentRunInput {
  return {
    ...run,
    status: input.status,
    completedAt: input.completedAt,
    outputSummary: input.outputSummary,
    errorMessage: input.errorMessage
  };
}

async function maybePositionSignalWithProvider(
  signal: Signal,
  analysis: SignalAnalysis,
  decision: import("@linkedin-brand-os/shared").ExecutionPolicyResult,
  providerRouter: ProviderRouter
): Promise<SignalPositioningAgentOutput> {
  if (decision.chosenTier === "deterministic") {
    return positioningAgent({ signal, analysis });
  }

  const summary = providerRouter.getSummary();
  if (summary.mode === "deterministic" || summary.textProviderStatus?.available === false) {
    throw new AnalysisBlockedError(
      `Positioning selected ${decision.chosenTier}, but no live text provider is available.`
    );
  }

  return providerBackedPositioningService({
    signal,
    analysis,
    router: providerRouter
  });
}

async function maybeGenerateSignalContentWithProvider(
  signal: Signal,
  analysis: SignalAnalysis,
  orchestratorDecision: OrchestratorDecision,
  decision: import("@linkedin-brand-os/shared").ExecutionPolicyResult,
  providerRouter: ProviderRouter
) {
  if (decision.chosenTier === "deterministic") {
    throw new AnalysisBlockedError("Premium content generation is required for this task.");
  }

  const summary = providerRouter.getSummary();
  if (summary.mode === "deterministic" || summary.textProviderStatus?.available === false) {
    throw new AnalysisBlockedError(
      `Content generation selected ${decision.chosenTier}, but no live text provider is available.`
    );
  }

  return providerBackedSignalContentService({
    signal,
    analysis,
    decision: orchestratorDecision,
    router: providerRouter
  });
}

async function maybeReviewContentWithProvider(
  content: ContentAsset,
  decision: import("@linkedin-brand-os/shared").ExecutionPolicyResult,
  providerRouter: ProviderRouter
) {
  if (decision.chosenTier === "deterministic") {
    throw new AnalysisBlockedError("Premium critic review is required for this task.");
  }

  const summary = providerRouter.getSummary();
  if (summary.mode === "deterministic" || summary.textProviderStatus?.available === false) {
    throw new AnalysisBlockedError(
      `Critic review selected ${decision.chosenTier}, but no live text provider is available.`
    );
  }
  try {
    return await providerBackedContentCriticService({
      content,
      router: providerRouter
    });
  } catch (error) {
    throw new AnalysisBlockedError(
      error instanceof Error
        ? `Critic review provider execution failed: ${error.message}`
        : "Critic review provider execution failed."
    );
  }
}

function buildIdeaFromContentContext(
  signal: Signal,
  analysis: SignalAnalysis,
  decision: OrchestratorDecision
): import("@linkedin-brand-os/db").CreateIdeaRecord {
  return {
    signalId: signal.id,
    title: analysis.bestAngle ?? signal.title,
    coreInsight: [analysis.whyRelevant, analysis.uniquenessReason].filter(Boolean).join(" "),
    businessRelevance: [
      analysis.businessValueSummary,
      analysis.practicalImplications[0],
      `Decision: ${decision.nextAction.replace(/_/g, " ")}`
    ]
      .filter(Boolean)
      .join(" "),
    targetAudience: analysis.targetAudience,
    status: "draft"
  };
}

function getLatestOrchestratorDecisionForSignal(
  decisions: OrchestratorDecision[],
  signalId: string
): OrchestratorDecision | undefined {
  return decisions.filter((decision) => decision.signalId === signalId).at(-1);
}

function getLatestContentAssetForSignal(
  assets: ContentAsset[],
  signalId: string,
  orchestratorDecisionId?: string
): ContentAsset | undefined {
  const filtered = assets.filter(
    (asset) =>
      asset.signalId === signalId &&
      (orchestratorDecisionId === undefined ||
        asset.orchestratorDecisionId === orchestratorDecisionId)
  );

  return filtered.at(-1);
}

function getLatestCriticReviewForContent(
  reviews: CriticReview[],
  contentAssetId: string
): CriticReview | undefined {
  return reviews.filter((review) => review.contentAssetId === contentAssetId).at(-1);
}

function getLatestSignalAnalysisForSignal(
  analyses: SignalAnalysis[],
  signalId: string
): SignalAnalysis | undefined {
  return analyses.filter((analysis) => analysis.signalId === signalId).at(-1);
}

function getLatestSignalPipelineRunForSignal(
  runs: AutonomousRun[],
  signalId: string
): AutonomousRun | undefined {
  return runs
    .filter((run) => run.runType === "signal_pipeline" && run.signalId === signalId)
    .at(-1);
}

function compareFactoryPriorityDecision(
  left: FactoryPriorityDecision,
  right: FactoryPriorityDecision
): number {
  if (right.priorityScore !== left.priorityScore) {
    return right.priorityScore - left.priorityScore;
  }

  return left.itemId.localeCompare(right.itemId);
}

function buildSignalPriorityDecision(input: {
  signal: Signal;
  analysis?: SignalAnalysis;
  runs: AutonomousRun[];
  memoryPatterns: MemoryPattern[];
  now: string;
  alreadyQueued: boolean;
}): FactoryPriorityDecision {
  const memorySupport = calculateMemoryInfluence({
    signal: input.signal,
    analysis: input.analysis,
    memoryPatterns: input.memoryPatterns,
    now: input.now
  });
  const currentWindow = derivePublishWindow(input.now);
  const timingHint = buildTimingHint(memorySupport, currentWindow);
  const baseScore = clampPriorityScore(
    Math.round(
      baseSignalPriorityScore(input.signal, input.analysis) + memorySupport.priorityDelta
    )
  );
  const latestRun = getLatestSignalPipelineRunForSignal(input.runs, input.signal.id);
  const runFactors = summarizeRunHistoryForSignal(input.runs, input.signal.id);
  const reasons: string[] = [];

  if (input.alreadyQueued) {
    reasons.push("A candidate queue handoff already exists.");
    return buildPriorityDecision({
      itemType: "signal",
      itemId: input.signal.id,
      signalId: input.signal.id,
      priorityScore: clampPriorityScore(baseScore - 20),
      recommendedAction: "skip",
      reasonSummary: reasons.join(" "),
      memorySupport,
      timingHint,
      supportingFactorsJson: {
        sourceType: input.signal.sourceType,
        runHistory: latestRun?.status,
        alreadyQueued: true,
        memoryMatches: memorySupport.matches
      }
    });
  }

  if (latestRun?.status === "running" || latestRun?.status === "queued") {
    reasons.push("The signal already has an active autonomous run.");
    return buildPriorityDecision({
      itemType: "signal",
      itemId: input.signal.id,
      signalId: input.signal.id,
      priorityScore: clampPriorityScore(baseScore - 25),
      recommendedAction: "skip",
      reasonSummary: reasons.join(" "),
      memorySupport,
      timingHint,
      supportingFactorsJson: {
        sourceType: input.signal.sourceType,
        runHistory: latestRun.status,
        memoryMatches: memorySupport.matches
      }
    });
  }

  if (memorySupport.negativeWeight >= 8 && baseScore < 60) {
    reasons.push("Weak memory evidence reduces the value of spending more work here.");
    return buildPriorityDecision({
      itemType: "signal",
      itemId: input.signal.id,
      signalId: input.signal.id,
      priorityScore: clampPriorityScore(baseScore - 18),
      recommendedAction: "deprioritize",
      reasonSummary: reasons.join(" "),
      memorySupport,
      timingHint,
      supportingFactorsJson: {
        sourceType: input.signal.sourceType,
        weakMemoryCount: memorySupport.negativeMatches.length,
        memoryMatches: memorySupport.matches
      }
    });
  }

  if (latestRun?.status === "blocked") {
    if (runFactors.retryEligible) {
      reasons.push("The last run was blocked by a retryable provider availability issue.");
      return buildPriorityDecision({
        itemType: "signal",
        itemId: input.signal.id,
        signalId: input.signal.id,
        priorityScore: Math.max(55, clampPriorityScore(baseScore - 5)),
        recommendedAction: "retry_later",
        recommendedDelayMinutes: 120,
        reasonSummary: reasons.join(" "),
        memorySupport,
        timingHint,
        supportingFactorsJson: {
          sourceType: input.signal.sourceType,
          latestRunStatus: latestRun.status,
          latestRunErrorSummary: latestRun.errorSummary,
          retryCount: runFactors.retryLikeCount,
          memoryMatches: memorySupport.matches
        }
      });
    }
  }

  if (latestRun?.status === "failed" && runFactors.failureCount >= 3) {
    reasons.push("Repeated failure history makes another retry likely wasteful.");
    return buildPriorityDecision({
      itemType: "signal",
      itemId: input.signal.id,
      signalId: input.signal.id,
      priorityScore: clampPriorityScore(baseScore - 25),
      recommendedAction: "skip",
      reasonSummary: reasons.join(" "),
      memorySupport,
      timingHint,
      supportingFactorsJson: {
        sourceType: input.signal.sourceType,
        latestRunStatus: latestRun.status,
        failureCount: runFactors.failureCount,
        latestRunErrorSummary: latestRun.errorSummary,
        memoryMatches: memorySupport.matches
      }
    });
  }

  if (
    latestRun &&
    (latestRun.status === "completed" || latestRun.status === "partial") &&
    memorySupport.materialChangeAfterRun
  ) {
    reasons.push("New memory evidence materially changed the timing or priority context.");
    const recommendedAction =
      timingHint && currentWindow !== memorySupport.preferredPublishWindow
        ? "rerun_when_window_matches"
        : "run_now";

    return buildPriorityDecision({
      itemType: "signal",
      itemId: input.signal.id,
      signalId: input.signal.id,
      priorityScore: clampPriorityScore(baseScore + 6),
      recommendedAction,
      reasonSummary: reasons.join(" "),
      memorySupport,
      timingHint,
      supportingFactorsJson: {
        sourceType: input.signal.sourceType,
        latestRunStatus: latestRun.status,
        completedAt: latestRun.completedAt,
        memoryMatches: memorySupport.matches
      }
    });
  }

  reasons.push(
    input.analysis
      ? "The signal has enough strategic strength to justify autonomous processing."
      : "The signal is still pending its first internal factory pass."
  );
  return buildPriorityDecision({
    itemType: "signal",
    itemId: input.signal.id,
    signalId: input.signal.id,
    priorityScore: baseScore,
    recommendedAction: baseScore >= 60 ? "run_now" : "deprioritize",
    reasonSummary: reasons.join(" "),
    memorySupport,
    timingHint,
    supportingFactorsJson: {
      sourceType: input.signal.sourceType,
      noveltyHint: input.signal.noveltyHint,
      analysis: input.analysis
        ? {
            relevanceScore: input.analysis.relevanceScore,
            brandGrowthPotentialScore: input.analysis.brandGrowthPotentialScore,
            popularityPotentialScore: input.analysis.popularityPotentialScore,
            buildabilityScore: input.analysis.buildabilityScore
          }
        : undefined,
      latestRunStatus: latestRun?.status,
      memoryMatches: memorySupport.matches
    }
  });
}

function buildCandidatePriorityDecision(input: {
  candidate: CandidateQueueItem;
  signal: Signal;
  analysis?: SignalAnalysis;
  contentAsset?: ContentAsset;
  criticReview?: CriticReview;
  solutionMemory?: SolutionMemory;
  decision?: OrchestratorDecision;
  memoryPatterns: MemoryPattern[];
  now: string;
}): FactoryPriorityDecision {
  const memorySupport = calculateMemoryInfluence({
    signal: input.signal,
    analysis: input.analysis,
    contentAsset: input.contentAsset,
    memoryPatterns: input.memoryPatterns,
    now: input.now
  });
  const currentWindow = derivePublishWindow(input.now);
  const timingHint = buildTimingHint(memorySupport, currentWindow);
  let score =
    Math.round((input.candidate.priorityScore ?? 0) * 0.55) +
    candidateTypePriorityBoost(input.candidate.candidateType) +
    candidateQueueStatePriorityBoost(input.candidate.queueState);

  if (input.criticReview?.qualityScore) {
    score += Math.round(input.criticReview.qualityScore * 0.1);
  }
  if (input.criticReview?.businessValueScore) {
    score += Math.round(input.criticReview.businessValueScore * 0.08);
  }
  if (input.criticReview?.differentiationScore) {
    score += Math.round(input.criticReview.differentiationScore * 0.06);
  }
  if (typeof input.criticReview?.genericnessScore === "number") {
    score -= Math.round(input.criticReview.genericnessScore * 0.05);
  }
  if (input.criticReview?.publishReadyFlag) {
    score += 8;
  }
  if (input.solutionMemory?.implementationPotential === "high") {
    score += 10;
  } else if (input.solutionMemory?.implementationPotential === "medium") {
    score += 5;
  }

  score = clampPriorityScore(Math.round(score + memorySupport.priorityDelta));
  const reasons = [
    input.candidate.candidateType === "high_priority_candidate"
      ? "High-priority candidate lane boosts review urgency."
      : "Candidate is ready for the next supervised lane.",
    input.criticReview?.publishReadyFlag
      ? "Critic review suggests the draft is close to publish-ready."
      : "Critic review still requires supervised judgment."
  ];

  return buildPriorityDecision({
    itemType: "candidate_queue_item",
    itemId: input.candidate.id,
    signalId: input.candidate.signalId,
    candidateType: input.candidate.candidateType,
    contentAssetId: input.candidate.contentAssetId,
    priorityScore: score,
    recommendedAction:
      input.candidate.queueState === "blocked"
        ? "skip"
        : score >= 45
          ? "queue_for_review"
          : "deprioritize",
    reasonSummary: reasons.join(" "),
    memorySupport,
    timingHint,
    supportingFactorsJson: {
      queueState: input.candidate.queueState,
      candidateType: input.candidate.candidateType,
      publishReadyFlag: input.criticReview?.publishReadyFlag,
      solutionPotential: input.solutionMemory?.implementationPotential,
      criticScores: input.criticReview
        ? {
            qualityScore: input.criticReview.qualityScore,
            genericnessScore: input.criticReview.genericnessScore,
            businessValueScore: input.criticReview.businessValueScore,
            differentiationScore: input.criticReview.differentiationScore
          }
        : undefined,
      memoryMatches: memorySupport.matches,
      decisionType: input.decision?.decisionType
    }
  });
}

function buildPriorityDecision(input: {
  itemType: FactoryPriorityDecision["itemType"];
  itemId: string;
  signalId: string;
  candidateType?: FactoryPriorityDecision["candidateType"];
  contentAssetId?: string;
  priorityScore: number;
  recommendedAction: FactoryPriorityDecision["recommendedAction"];
  recommendedDelayMinutes?: number;
  timingHint?: string;
  reasonSummary: string;
  memorySupport: ReturnType<typeof calculateMemoryInfluence>;
  supportingFactorsJson: Record<string, unknown>;
}): FactoryPriorityDecision {
  return {
    itemType: input.itemType,
    itemId: input.itemId,
    signalId: input.signalId,
    candidateType: input.candidateType,
    contentAssetId: input.contentAssetId,
    priorityScore: clampPriorityScore(input.priorityScore),
    priorityLabel: toPriorityLabel(input.priorityScore),
    recommendedAction: input.recommendedAction,
    recommendedDelayMinutes: input.recommendedDelayMinutes,
    timingHint: input.timingHint,
    reasonSummary: input.reasonSummary,
    memoryInfluenceLabel: input.memorySupport.influenceLabel,
    supportingFactorsJson: input.supportingFactorsJson
  };
}

function baseSignalPriorityScore(signal: Signal, analysis?: SignalAnalysis): number {
  let score = sourceTypePriorityBoost(signal.sourceType);
  const novelty = signal.noveltyHint?.toLowerCase() ?? "";

  if (/fresh|new|launch|release|novel|just shipped/i.test(novelty)) {
    score += 6;
  } else if (novelty.length > 0) {
    score += 2;
  }

  if (analysis) {
    score +=
      analysis.relevanceScore * 0.35 +
      analysis.brandGrowthPotentialScore * 0.25 +
      analysis.popularityPotentialScore * 0.15 +
      analysis.buildabilityScore * 0.15 +
      analysis.uniquenessScore * 0.1;
  } else {
    score += 28;
  }

  return score;
}

function sourceTypePriorityBoost(sourceType: Signal["sourceType"]): number {
  switch (sourceType) {
    case "github_repo":
      return 12;
    case "tool_launch":
      return 10;
    case "article":
      return 8;
    case "manual_note":
    case "manual":
      return 6;
    default:
      return 4;
  }
}

function candidateTypePriorityBoost(candidateType: CandidateQueueItem["candidateType"]): number {
  switch (candidateType) {
    case "high_priority_candidate":
      return 24;
    case "solution_candidate":
      return 18;
    case "content_candidate":
      return 14;
    case "manual_review_required":
      return 8;
  }
}

function candidateQueueStatePriorityBoost(queueState: CandidateQueueItem["queueState"]): number {
  switch (queueState) {
    case "ready_to_publish":
      return 20;
    case "ready_for_review":
      return 14;
    case "revision_requested":
      return 12;
    case "ready_for_solution_followup":
      return 14;
    case "manual_review_queue":
      return 8;
    case "ready_for_content":
      return 10;
    case "queued":
      return 4;
    case "blocked":
      return -18;
    case "archived":
      return -40;
  }
}

function toPriorityLabel(priorityScore: number): FactoryPriorityDecision["priorityLabel"] {
  if (priorityScore >= 80) {
    return "high";
  }
  if (priorityScore >= 55) {
    return "medium";
  }
  return "low";
}

function clampPriorityScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function summarizeRunHistoryForSignal(runs: AutonomousRun[], signalId: string): {
  retryEligible: boolean;
  failureCount: number;
  retryLikeCount: number;
} {
  const signalRuns = runs.filter(
    (run) => run.runType === "signal_pipeline" && run.signalId === signalId
  );
  const latestRun = signalRuns.at(-1);
  if (!latestRun) {
    return { retryEligible: false, failureCount: 0, retryLikeCount: 0 };
  }

  const error = latestRun.errorSummary?.toLowerCase() ?? "";
  return {
    retryEligible:
      latestRun.status === "blocked" &&
      /(provider|openai|required|unavailable|config)/i.test(error),
    failureCount: signalRuns.filter((run) => run.status === "failed").length,
    retryLikeCount: signalRuns.filter((run) => run.status === "blocked").length
  };
}

function calculateMemoryInfluence(input: {
  signal: Signal;
  analysis?: SignalAnalysis;
  contentAsset?: ContentAsset;
  memoryPatterns: MemoryPattern[];
  now: string;
}): {
  priorityDelta: number;
  positiveWeight: number;
  negativeWeight: number;
  influenceLabel: FactoryPriorityDecision["memoryInfluenceLabel"];
  preferredPublishWindow?: string;
  materialChangeAfterRun: boolean;
  matches: Array<{ patternKey: string; strengthScore: number }>;
  positiveMatches: Array<{ patternKey: string; strengthScore: number }>;
  negativeMatches: Array<{ patternKey: string; strengthScore: number }>;
} {
  const keys = new Set<string>();
  keys.add(`source_type:strong:${normalizePatternValue(input.signal.sourceType)}`);
  keys.add(`source_type:weak:${normalizePatternValue(input.signal.sourceType)}`);

  for (const tag of input.signal.topicTags ?? []) {
    const normalizedTag = normalizePatternValue(tag);
    keys.add(`topic:strong:${normalizedTag}`);
    keys.add(`topic:weak:${normalizedTag}`);
  }

  const angle = input.analysis?.bestAngle ?? input.contentAsset?.bestAngle;
  if (angle) {
    const normalizedAngle = normalizePatternValue(angle);
    keys.add(`angle:strong:${normalizedAngle}`);
    keys.add(`angle:weak:${normalizedAngle}`);
  }

  const pillar = input.analysis?.recommendedPillarFinal ?? input.analysis?.recommendedPillar;
  if (pillar) {
    const normalizedPillar = normalizePatternValue(pillar);
    keys.add(`pillar:strong:${normalizedPillar}`);
    keys.add(`pillar:weak:${normalizedPillar}`);
  }

  const audience =
    input.analysis?.audienceEmphasis ?? input.analysis?.targetAudience;
  if (audience) {
    const normalizedAudience = normalizePatternValue(audience);
    keys.add(`audience_fit:strong:${normalizedAudience}`);
    keys.add(`audience_fit:weak:${normalizedAudience}`);
  }

  const contentFormat = input.contentAsset?.recommendedFormat ?? input.analysis?.recommendedFormat;
  if (contentFormat) {
    const normalizedFormat = normalizePatternValue(contentFormat);
    keys.add(`content_format:strong:${normalizedFormat}`);
    keys.add(`content_format:weak:${normalizedFormat}`);
  }

  const preferredPublishWindow = input.memoryPatterns
    .filter((pattern) => pattern.patternType === "publish_window" && pattern.patternKey.includes(":strong:"))
    .sort((left, right) => right.strengthScore - left.strengthScore)[0]
    ?.patternKey.split(":")
    .at(-1);

  const matchedPatterns = input.memoryPatterns.filter((pattern) => keys.has(pattern.patternKey));
  const positiveMatches = matchedPatterns.filter((pattern) => pattern.patternKey.includes(":strong:"));
  const negativeMatches = matchedPatterns.filter((pattern) => pattern.patternKey.includes(":weak:"));
  const positiveWeight = positiveMatches.reduce(
    (sum, pattern) => sum + Math.min(8, Math.round(pattern.strengthScore / 4)),
    0
  );
  const negativeWeight = negativeMatches.reduce(
    (sum, pattern) => sum + Math.min(8, Math.round(pattern.strengthScore / 4)),
    0
  );
  const publishWindowWeight = preferredPublishWindow ? 4 : 0;

  return {
    priorityDelta: positiveWeight + publishWindowWeight - negativeWeight,
    positiveWeight: positiveWeight + publishWindowWeight,
    negativeWeight,
    influenceLabel:
      positiveWeight + publishWindowWeight > negativeWeight
        ? "positive"
        : negativeWeight > positiveWeight + publishWindowWeight
          ? "negative"
          : "neutral",
    preferredPublishWindow,
    materialChangeAfterRun:
      Boolean(preferredPublishWindow) || positiveWeight + publishWindowWeight >= 8,
    matches: matchedPatterns.map((pattern) => ({
      patternKey: pattern.patternKey,
      strengthScore: pattern.strengthScore
    })),
    positiveMatches: positiveMatches.map((pattern) => ({
      patternKey: pattern.patternKey,
      strengthScore: pattern.strengthScore
    })),
    negativeMatches: negativeMatches.map((pattern) => ({
      patternKey: pattern.patternKey,
      strengthScore: pattern.strengthScore
    }))
  };
}

function buildTimingHint(
  memorySupport: ReturnType<typeof calculateMemoryInfluence>,
  currentWindow: string | undefined
): string | undefined {
  if (!memorySupport.preferredPublishWindow) {
    return undefined;
  }

  return currentWindow === memorySupport.preferredPublishWindow
    ? `Preferred publish window is ${memorySupport.preferredPublishWindow} and the current window already matches.`
    : `Preferred publish window is ${memorySupport.preferredPublishWindow}; wait for that window before spending the next rerun or review cycle.`;
}

function buildCandidateQueueInput(input: {
  signal: Signal;
  analysis: SignalAnalysis;
  decision: OrchestratorDecision;
  contentAsset?: ContentAsset;
  criticReview?: CriticReview;
  solutionMemory?: SolutionMemory;
}): import("@linkedin-brand-os/shared").CreateCandidateQueueItemInput {
  const priorityScore = input.decision.confidenceScore;
  const priorityLabel =
    priorityScore >= 80 ? "high" : priorityScore >= 60 ? "medium" : "low";

  switch (input.decision.decisionType) {
    case "high_priority_candidate":
      if (!input.contentAsset) {
        throw new NotFoundError(
          "High-priority candidates require a generated content asset before queueing."
        );
      }
      return {
        signalId: input.signal.id,
        signalAnalysisId: input.analysis.id,
        contentAssetId: input.contentAsset.id,
        criticReviewId: input.criticReview?.id,
        solutionMemoryId: input.solutionMemory?.id,
        orchestratorDecisionId: input.decision.id,
        candidateType: "high_priority_candidate",
        queueState: "ready_for_review",
        priorityScore,
        priorityLabel: "high",
        whyQueued:
          input.criticReview
            ? input.criticReview.publishReadyFlag
              ? "Critic-reviewed content is strong and high priority for human publication review."
              : "Critic-reviewed content is strong enough for the high-priority review lane."
            : "Generated high-priority content is queued for human review because critic review is still needed.",
        nextAction:
          input.criticReview
            ? input.criticReview.publishReadyFlag
              ? "review_for_publication"
              : "review_high_priority_candidate"
            : "review_high_priority_candidate",
        requiresHumanReview: true
      };
    case "content_candidate":
      if (!input.contentAsset) {
        throw new NotFoundError(
          "Content candidates require a generated content asset before queueing."
        );
      }
      return {
        signalId: input.signal.id,
        signalAnalysisId: input.analysis.id,
        contentAssetId: input.contentAsset.id,
        criticReviewId: input.criticReview?.id,
        solutionMemoryId: input.solutionMemory?.id,
        orchestratorDecisionId: input.decision.id,
        candidateType: "content_candidate",
        queueState: "ready_for_review",
        priorityScore,
        priorityLabel,
        whyQueued:
          input.criticReview
            ? input.criticReview.publishReadyFlag
              ? "Critic-reviewed content is strong enough for publication review."
              : "Critic-reviewed content needs supervised review before promotion."
            : "Generated content is queued for supervised review because critic review is still pending.",
        nextAction:
          input.criticReview
            ? input.criticReview.publishReadyFlag
              ? "review_for_publication"
              : "review_content_candidate"
            : "review_content_candidate",
        requiresHumanReview: true
      };
    case "solution_candidate":
      if (!input.solutionMemory) {
        throw new NotFoundError(
          "Solution candidates require persisted solution memory before queueing."
        );
      }
      return {
        signalId: input.signal.id,
        signalAnalysisId: input.analysis.id,
        contentAssetId: input.contentAsset?.id,
        criticReviewId: input.criticReview?.id,
        solutionMemoryId: input.solutionMemory.id,
        orchestratorDecisionId: input.decision.id,
        candidateType: "solution_candidate",
        queueState: "ready_for_solution_followup",
        priorityScore,
        priorityLabel,
        whyQueued: "Implementation potential is strong enough to justify solution follow-up.",
        nextAction: "review_solution_followup",
        requiresHumanReview: true
      };
    case "manual_review_required":
      return {
        signalId: input.signal.id,
        signalAnalysisId: input.analysis.id,
        contentAssetId: input.contentAsset?.id,
        criticReviewId: input.criticReview?.id,
        solutionMemoryId: input.solutionMemory?.id,
        orchestratorDecisionId: input.decision.id,
        candidateType: "manual_review_required",
        queueState: "manual_review_queue",
        priorityScore,
        priorityLabel,
        whyQueued: "The upstream signals are mixed and require human judgment before the next move.",
        nextAction: "request_manual_review",
        requiresHumanReview: true
      };
    default:
      throw new AnalysisBlockedError(
        `Decision '${input.decision.decisionType}' does not map to a candidate queue handoff.`
      );
  }
}

function buildSolutionMemoryFromSignal(
  signal: Signal,
  analysis: SignalAnalysis,
  positioning: SignalPositioningAgentOutput
): import("@linkedin-brand-os/shared").CreateSolutionMemoryInput {
  const corpus = [
    signal.title,
    signal.sourceTitle,
    signal.normalizedContent,
    signal.rawText,
    analysis.businessValueSummary,
    analysis.practicalImplications.join(" "),
    analysis.painsSolved.join(" ")
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const detectedStack = Array.from(
    new Set([
      ...(signal.sourceType === "github_repo" ? inferStackFromCorpus(corpus) : []),
      ...(Array.isArray(signal.sourceMetadataJson?.detectedStack)
        ? (signal.sourceMetadataJson?.detectedStack as string[])
        : [])
    ])
  );

  return {
    signalId: signal.id,
    sourceType:
      signal.sourceType === "manual"
        ? "manual_note"
        : (signal.sourceType as SolutionMemory["sourceType"]),
    implementationPotential:
      analysis.buildabilityScore >= 75
        ? "high"
        : analysis.buildabilityScore >= 55
          ? "medium"
          : "low",
    implementationComplexity:
      signal.sourceType === "github_repo"
        ? "medium"
        : analysis.buildabilityScore >= 70
          ? "medium"
          : "low",
    detectedStack,
    keyFeatures: inferKeyFeatures(corpus, positioning),
    architectureClues: inferArchitectureClues(corpus),
    deploymentHints: inferDeploymentHints(corpus),
    clientFitTypes: inferClientFitTypes(analysis.targetAudience, signal.sourceType),
    possibleUseCases: inferPossibleUseCases(analysis, positioning),
    adaptationNotes:
      analysis.buildabilityScore >= 70
        ? "This source can be adapted into both brand narrative and implementation guidance."
        : "This source is better for directional guidance than direct implementation copying.",
    repoReference: deriveSignalSourceReference(signal),
    readmeSnapshot:
      signal.sourceType === "github_repo"
        ? truncateText(signal.normalizedContent ?? signal.rawText, 400)
        : truncateText(signal.sourceTitle ?? signal.title, 160),
    implementationNotes: analysis.businessValueSummary
  };
}

function deriveSignalSourceReference(signal: Signal): string | undefined {
  if (typeof signal.sourceMetadataJson?.repoReference === "string") {
    return signal.sourceMetadataJson.repoReference;
  }

  if (typeof signal.sourceUrl === "string" && signal.sourceUrl.length > 0) {
    return signal.sourceUrl;
  }

  if (typeof signal.sourceTitle === "string" && signal.sourceTitle.length > 0) {
    return signal.sourceTitle;
  }

  if (typeof signal.title === "string" && signal.title.length > 0) {
    return signal.title;
  }

  return undefined;
}

function buildOrchestratorDecisionFromAnalysis(
  signal: Signal,
  analysis: SignalAnalysis,
  solutionMemory: SolutionMemory,
  positioning: SignalPositioningAgentOutput
): import("@linkedin-brand-os/shared").CreateOrchestratorDecisionInput {
  const confidenceScore = clampDecisionScore(
    Math.round(
      analysis.relevanceScore * 0.35 +
        analysis.brandGrowthPotentialScore * 0.3 +
        analysis.popularityPotentialScore * 0.1 +
        analysis.uniquenessScore * 0.1 +
        analysis.buildabilityScore * 0.15
    )
  );

  if (analysis.relevanceScore < 30) {
    return {
      signalId: signal.id,
      decisionType: "discard",
      decisionReason: "Low relevance and weak brand fit make this source unworthy of further work.",
      confidenceScore,
      nextAction: "stop_processing",
      requiresHumanReview: false
    };
  }

  if (
    solutionMemory.implementationPotential === "high" &&
    (signal.sourceType === "github_repo" || analysis.buildabilityScore >= 75) &&
    analysis.relevanceScore >= 40
  ) {
    return {
      signalId: signal.id,
      decisionType:
        analysis.brandGrowthPotentialScore >= 80 ? "high_priority_candidate" : "solution_candidate",
      decisionReason:
        "The source has strong implementation reuse value and enough strategic fit to merit downstream solution or high-priority handling.",
      confidenceScore,
      nextAction:
        analysis.brandGrowthPotentialScore >= 80
          ? "promote_to_priority_queue"
          : "save_solution_memory",
      requiresHumanReview: true
    };
  }

  if (analysis.relevanceScore < 45 || positioning.bestAngle === "low_fit") {
    return {
      signalId: signal.id,
      decisionType: "archive",
      decisionReason: "The source is directionally interesting but too weak for active brand or solution work right now.",
      confidenceScore,
      nextAction: "archive_signal",
      requiresHumanReview: false
    };
  }

  if (analysis.relevanceScore >= 72 && analysis.brandGrowthPotentialScore >= 70) {
    return {
      signalId: signal.id,
      decisionType:
        analysis.popularityPotentialScore >= 75
          ? "high_priority_candidate"
          : "content_candidate",
      decisionReason:
        "The source has enough relevance, positioning strength, and brand growth potential to move into the content candidate path.",
      confidenceScore,
      nextAction:
        analysis.popularityPotentialScore >= 75
          ? "prioritize_for_content"
          : "queue_for_content_review",
      requiresHumanReview: true
    };
  }

  return {
    signalId: signal.id,
    decisionType: "manual_review_required",
    decisionReason:
      "The source has mixed brand, positioning, or implementation signals and needs operator judgment before the next move.",
    confidenceScore,
    nextAction: "request_manual_review",
    requiresHumanReview: true
  };
}

function inferStackFromCorpus(corpus: string): string[] {
  const stackPatterns: Array<[RegExp, string]> = [
    [/\btypescript\b/i, "typescript"],
    [/\bjavascript\b/i, "javascript"],
    [/\bfastify\b/i, "fastify"],
    [/\bnode\b/i, "node"],
    [/\bsqlite\b/i, "sqlite"],
    [/\breact\b/i, "react"],
    [/\bpostgres\b/i, "postgres"]
  ];

  return stackPatterns
    .filter(([pattern]) => pattern.test(corpus))
    .map(([, label]) => label);
}

function inferKeyFeatures(
  corpus: string,
  positioning: SignalPositioningAgentOutput
): string[] {
  const features: string[] = [];
  if (/queue|approval/i.test(corpus)) features.push("queue visibility");
  if (/retry|exception/i.test(corpus)) features.push("exception recovery");
  if (/ownership|owner/i.test(corpus)) features.push("explicit ownership");
  if (/handoff/i.test(corpus)) features.push("cross-team handoff clarity");
  if (features.length === 0) {
    features.push(positioning.bestAngle.replace(/_/g, " "));
  }
  return features;
}

function inferArchitectureClues(corpus: string): string[] {
  const clues: string[] = [];
  if (/queue|approval/i.test(corpus)) clues.push("durable queue state");
  if (/retry|exception/i.test(corpus)) clues.push("visible exception handling");
  if (/ownership|owner/i.test(corpus)) clues.push("explicit workflow ownership");
  if (/api|service|repo/i.test(corpus)) clues.push("service-backed workflow control");
  return clues.length > 0 ? clues : ["operator-reviewed workflow orchestration"];
}

function inferDeploymentHints(corpus: string): string[] {
  const hints: string[] = [];
  if (/sqlite|local/i.test(corpus)) hints.push("local-first MVP deployment is viable");
  if (/queue|approval/i.test(corpus)) hints.push("instrument queue state for operators");
  if (/retry|exception/i.test(corpus)) hints.push("expose failure and recovery state");
  return hints.length > 0 ? hints : ["keep deployment simple until workflow proof is stronger"];
}

function inferClientFitTypes(
  targetAudience: string,
  sourceType: Signal["sourceType"]
): string[] {
  const fits = [targetAudience];
  if (sourceType === "github_repo") {
    fits.push("implementation-aware B2B SaaS teams");
  }
  if (sourceType === "article" || sourceType === "tool_launch") {
    fits.push("operator-led growth teams");
  }
  return Array.from(new Set(fits));
}

function inferPossibleUseCases(
  analysis: SignalAnalysis,
  positioning: SignalPositioningAgentOutput
): string[] {
  return Array.from(
    new Set([
      `Brand content around ${positioning.bestAngle.replace(/_/g, " ")}`,
      ...analysis.practicalImplications.slice(0, 2),
      analysis.businessValueSummary
    ])
  );
}

async function resolveSignalIdForContentAsset(
  db: WorkflowRepository,
  content: ContentAsset
): Promise<string | undefined> {
  if (content.signalId) {
    return content.signalId;
  }

  const idea = await db.getIdeaById(content.ideaId);
  return idea?.signalId;
}

function interpretPerformanceSnapshot(
  snapshot: AnalyticsSnapshot
): {
  classification: PerformanceOutcomeClassification;
  weightedScore: number;
  reasons: string[];
} {
  const reasons: string[] = [];
  const impressions = Math.max(snapshot.impressions, 1);
  const reactions = snapshot.reactions ?? snapshot.likes;
  const engagementRate =
    (reactions + snapshot.comments * 2 + snapshot.saves * 2 + (snapshot.reposts ?? 0) * 3) /
    impressions;
  let score = 0;

  if (engagementRate >= 0.12) {
    score += 3;
    reasons.push("High weighted engagement rate.");
  } else if (engagementRate >= 0.06) {
    score += 2;
    reasons.push("Healthy weighted engagement rate.");
  } else if (engagementRate >= 0.03) {
    score += 1;
    reasons.push("Moderate weighted engagement rate.");
  } else {
    score -= 2;
    reasons.push("Weak weighted engagement rate.");
  }

  if ((snapshot.inboundLeads ?? 0) >= 2) {
    score += 3;
    reasons.push("Inbound leads were generated.");
  } else if ((snapshot.inboundLeads ?? 0) === 1) {
    score += 2;
    reasons.push("At least one inbound lead was generated.");
  }

  if (snapshot.profileViews >= 30) {
    score += 1;
    reasons.push("Profile-view lift suggests authority pull.");
  } else if (snapshot.profileViews <= 5) {
    score -= 1;
    reasons.push("Very low profile-view lift.");
  }

  if ((snapshot.reposts ?? 0) >= 3) {
    score += 1;
    reasons.push("Reposts suggest message portability.");
  }

  const notes = snapshot.qualitativeNotes?.toLowerCase() ?? "";
  if (/(resonat|specific|practical|useful|strong|concrete)/i.test(notes)) {
    score += 1;
    reasons.push("Qualitative notes indicate strong resonance.");
  }
  if (/(generic|vague|flat|weak|filler|slop|hype)/i.test(notes)) {
    score -= 2;
    reasons.push("Qualitative notes indicate weak or generic performance.");
  }

  if (score >= 5) {
    return { classification: "strong", weightedScore: score, reasons };
  }
  if (score <= 0) {
    return { classification: "weak", weightedScore: score, reasons };
  }
  return { classification: "neutral", weightedScore: score, reasons };
}

function buildMemoryPatternInputsFromSnapshot(input: {
  signal: Signal;
  analysis?: SignalAnalysis;
  content: ContentAsset;
  decision?: OrchestratorDecision;
  criticReview?: CriticReview;
  snapshot: AnalyticsSnapshot;
  outcomeClassification: PerformanceOutcomeClassification;
  existingPatterns: MemoryPattern[];
}): import("@linkedin-brand-os/shared").CreateMemoryPatternInput[] {
  const evidence = buildMemoryEvidence(input);
  const recommendedAction =
    input.outcomeClassification === "strong"
      ? "repeat"
      : input.outcomeClassification === "weak"
        ? "deprioritize"
        : "monitor";
  const delta =
    input.outcomeClassification === "strong"
      ? 2
      : input.outcomeClassification === "weak"
        ? 2
        : 1;

  const entries: Array<{
    patternType: MemoryPattern["patternType"];
    value: string | undefined;
  }> = [
    { patternType: "source_type", value: input.signal.sourceType },
    { patternType: "angle", value: input.analysis?.bestAngle ?? input.content.bestAngle },
    {
      patternType: "pillar",
      value:
        input.analysis?.recommendedPillarFinal ??
        input.analysis?.recommendedPillar ??
        undefined
    },
    {
      patternType: "audience_fit",
      value:
        input.snapshot.audienceSegment ??
        input.analysis?.audienceEmphasis ??
        input.analysis?.targetAudience
    },
    {
      patternType: "publish_window",
      value: derivePublishWindow(input.snapshot.publishedAt)
    },
    {
      patternType: "content_format",
      value: input.content.recommendedFormat ?? input.content.contentType
    },
    ...(input.signal.topicTags?.map((tag) => ({ patternType: "topic" as const, value: tag })) ??
      [])
  ];

  return entries
    .filter((entry): entry is { patternType: MemoryPattern["patternType"]; value: string } =>
      typeof entry.value === "string" && entry.value.trim().length > 0
    )
    .map((entry) => {
      const normalizedValue = normalizePatternValue(entry.value);
      const patternKey = `${entry.patternType}:${input.outcomeClassification}:${normalizedValue}`;
      const existing = input.existingPatterns.find((pattern) => pattern.patternKey === patternKey);

      return {
        patternType: entry.patternType,
        patternKey,
        strengthScore: clampPatternStrength((existing?.strengthScore ?? 0) + delta),
        supportingEvidenceJson: mergePatternEvidence(existing?.supportingEvidenceJson, {
          ...evidence,
          patternType: entry.patternType,
          patternValue: normalizedValue
        }),
        recommendedAction
      };
    });
}

function buildMemoryEvidence(input: {
  signal: Signal;
  analysis?: SignalAnalysis;
  content: ContentAsset;
  decision?: OrchestratorDecision;
  criticReview?: CriticReview;
  snapshot: AnalyticsSnapshot;
  outcomeClassification: PerformanceOutcomeClassification;
}): Record<string, unknown> {
  const interpretation = interpretPerformanceSnapshot(input.snapshot);
  return {
    contentAssetId: input.content.id,
    signalId: input.signal.id,
    signalAnalysisId: input.analysis?.id,
    orchestratorDecisionId: input.decision?.id,
    criticReviewId: input.criticReview?.id,
    analyticsSnapshotId: input.snapshot.id,
    outcomeClassification: input.outcomeClassification,
    publishReadyAtReview: input.criticReview?.publishReadyFlag ?? input.content.publishReadyFlag,
    sourceType: input.signal.sourceType,
    angle: input.analysis?.bestAngle ?? input.content.bestAngle,
    pillar:
      input.analysis?.recommendedPillarFinal ?? input.analysis?.recommendedPillar ?? undefined,
    audience:
      input.snapshot.audienceSegment ??
      input.analysis?.audienceEmphasis ??
      input.analysis?.targetAudience,
    publishWindow: derivePublishWindow(input.snapshot.publishedAt),
    audienceGeoHint: input.snapshot.audienceGeoHint,
    format: input.content.recommendedFormat ?? input.content.contentType,
    metrics: {
      impressions: input.snapshot.impressions,
      reactions: input.snapshot.reactions ?? input.snapshot.likes,
      comments: input.snapshot.comments,
      reposts: input.snapshot.reposts ?? 0,
      profileViews: input.snapshot.profileViews,
      inboundLeads: input.snapshot.inboundLeads ?? 0
    },
    interpretationReasons: interpretation.reasons
  };
}

function mergePatternEvidence(
  existing: Record<string, unknown> | undefined,
  latest: Record<string, unknown>
): Record<string, unknown> {
  const previousCount =
    typeof existing?.evidenceCount === "number" ? (existing.evidenceCount as number) : 0;
  const previousRecent = Array.isArray(existing?.recentEvidence)
    ? (existing?.recentEvidence as unknown[])
    : [];

  return {
    ...existing,
    lastEvidence: latest,
    evidenceCount: previousCount + 1,
    recentEvidence: [latest, ...previousRecent].slice(0, 5)
  };
}

function derivePublishWindow(publishedAt: string | undefined): string | undefined {
  if (!publishedAt) {
    return undefined;
  }

  const hour = new Date(publishedAt).getUTCHours();
  if (hour < 6) return "overnight";
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

function normalizePatternValue(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function clampPatternStrength(value: number): number {
  return Math.max(0, Math.min(100, value));
}

const AUTONOMOUS_SIGNAL_PIPELINE_STAGE_ORDER = [
  "analyze_signal",
  "position_signal_and_decide",
  "generate_content_asset",
  "review_content_asset",
  "enqueue_candidate"
] as const;

type AutonomousPipelineStage = (typeof AUTONOMOUS_SIGNAL_PIPELINE_STAGE_ORDER)[number];

function createAutonomousSignalPipelineMetadata(): NonNullable<AutonomousRun["resultMetadata"]> & {
  stageOrder: AutonomousPipelineStage[];
  stagesAttempted: AutonomousPipelineStage[];
  stagesCompleted: AutonomousPipelineStage[];
  stagesBlocked: AutonomousPipelineStage[];
  stagesFailed: AutonomousPipelineStage[];
} {
  return {
    audienceItemCount: 0,
    solutionItemCount: 0,
    usedAi: false,
    stageOrder: [...AUTONOMOUS_SIGNAL_PIPELINE_STAGE_ORDER],
    stagesAttempted: [],
    stagesCompleted: [],
    stagesBlocked: [],
    stagesFailed: []
  };
}

async function finalizeAutonomousSignalPipelineRun(
  db: WorkflowRepository,
  runId: string,
  result: AutonomousSignalPipelineRunResult,
  update: import("@linkedin-brand-os/shared").UpdateAutonomousRunInput
): Promise<AutonomousSignalPipelineRunResult> {
  result.run =
    (await db.updateAutonomousRun(runId, update)) ??
    ({
      ...result.run,
      ...update
    } as AutonomousRun);
  return result;
}

function shouldGenerateContentForDecision(
  decisionType: OrchestratorDecision["decisionType"]
): boolean {
  return decisionType === "content_candidate" || decisionType === "high_priority_candidate";
}

function shouldEnqueueDecision(
  decisionType: OrchestratorDecision["decisionType"]
): boolean {
  return (
    decisionType === "content_candidate" ||
    decisionType === "high_priority_candidate" ||
    decisionType === "solution_candidate" ||
    decisionType === "manual_review_required"
  );
}

function isBlockingAutonomousStage(stage: AutonomousPipelineStage): boolean {
  return (
    stage === "analyze_signal" ||
    stage === "position_signal_and_decide" ||
    stage === "generate_content_asset"
  );
}

function truncateText(value: string | undefined, maxLength: number): string | undefined {
  if (!value) {
    return undefined;
  }
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function mergeReasoningJson(
  existing: Record<string, unknown> | undefined,
  next: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...(existing ?? {}),
    ...next
  };
}

function clampDecisionScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export { bootstrapMasterAutonomy } from "./masterAutonomyBootstrap.js";
export type { MasterBootstrapResult } from "./masterAutonomyBootstrap.js";
