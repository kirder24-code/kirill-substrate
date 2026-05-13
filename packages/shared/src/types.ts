export type SignalStatus = "new" | "processed" | "archived";
export type IdeaStatus = "draft" | "approved" | "rejected";
export type ContentStatus = "draft" | "review" | "published";
export type LegacySignalSourceType = "manual" | "research" | "crm" | "social";
export type CanonicalSignalSourceType =
  | LegacySignalSourceType
  | "github_repo"
  | "article"
  | "tool_launch"
  | "manual_note";
export type SourceType = CanonicalSignalSourceType;
export type ContentType = "linkedin-post" | "carousel" | "commentary";
export type DiscoverySourceType = "github" | "article" | "trend" | "manual";
export type RefinementStatus = "pending" | "refined" | "failed";
export type VisualType = "single-image" | "carousel" | "diagram";
export type VisualStatus = "ready" | "failed";
export type StrategyType = "audience" | "format" | "messaging" | "cadence";
export type StrategyPriority = "high" | "medium" | "low";
export type SourceItemStatus = "normalized" | "archived";
export type QueueAction =
  | "write_post"
  | "refine_post"
  | "make_visual"
  | "analyze_market";
export type QueuePriority = "high" | "medium" | "low";
export type QueueStatus = "queued" | "in_progress" | "done";
export type ProviderTaskType =
  | "translateToBusiness"
  | "generatePostFromIdea"
  | "refinePostDraft"
  | "summarizeSource"
  | "generateVisualBrief";
export type ProviderExecutionMode =
  | "deterministic"
  | "mock"
  | "local"
  | "external";
export type ExecutionTaskType =
  | "scout_preprocess"
  | "source_tagging"
  | "novelty_hinting"
  | "clustering"
  | "relevance_reasoning"
  | "business_translation"
  | "positioning"
  | "solution_memory_enrichment"
  | "content_generation"
  | "critic_review"
  | "lead_intelligence_first_pass"
  | "lead_message_generation"
  | "analytics_synthesis";
export type ProviderTier = "deterministic" | "local_mirai" | "openai";
export type ExecutionQualityRequirement = "low" | "medium" | "high";
export type ExecutionCostSensitivity = "low" | "medium" | "high";
export type ExecutionPolicyOutcome = "selected" | "fallback" | "blocked";
export type ContentQualityStatus = "unreviewed" | "reviewed";
export type FinalPostStatus = "pending" | "ready" | "failed";
export type FinalPostHookMode =
  | "sharp_observation"
  | "operational_tension"
  | "counterintuitive_claim"
  | "execution_lesson"
  | "field_pattern";
export type DecisionSourceType =
  | "manual"
  | "github"
  | "article"
  | "note"
  | "commentary"
  | "other";
export type DecisionRecommendedNextAction =
  | "generate_post_candidate"
  | "generate_comment"
  | "generate_reply"
  | "save_for_later"
  | "ignore";
export type DecisionSuggestedFlow =
  | "post_only"
  | "engagement_only"
  | "post_then_engagement"
  | "research_later"
  | "ignore";
export type DecisionPriority = "high" | "medium" | "low";
export type DecisionPublishability = "high" | "medium" | "low";
export type SourceIntakeType = "article" | "manual_research" | "github";
export type GrowthRhythmStatus = "new" | "sent" | "queued" | "in_progress" | "done" | "archived";
export type ManualOutcomeArtifactType = "final_post" | "comment" | "reply";
export type ManualOutcomeStatus = "posted" | "not_posted" | "used";
export type ManualOutcomeResponseLevel = "strong" | "medium" | "weak" | "unknown";
export type AudienceScoutSuggestedActionType =
  | "post_candidate"
  | "comment_opportunity"
  | "reply_opportunity"
  | "later";

export interface CreateSignalInput {
  title: string;
  sourceType: SourceType;
  rawText: string;
  sourceUrl?: string;
  sourceDomain?: string;
  sourceTitle?: string;
  sourceAuthorOrOwner?: string;
  fetchedAt?: string;
  language?: string;
  normalizedContent?: string;
  contentHash?: string;
  topicTags?: string[];
  noveltyHint?: string;
  sourceMetadataJson?: Record<string, unknown>;
}

export interface ProviderSelectionInput {
  taskType: ExecutionTaskType;
  signalId?: string;
  agentName?: string;
  qualityRequirement?: ExecutionQualityRequirement;
  costSensitivity?: ExecutionCostSensitivity;
  allowOpenAIEscalation?: boolean;
}

export interface ModelAssignmentConfig {
  deterministic: {
    providerName: null;
    model: string;
  };
  localMirai: {
    providerName: string;
    model: string;
    modelRepo?: string;
  };
  openAI: {
    providerName: string;
    model: string;
  };
}

export interface ExecutionTaskPolicy {
  taskType: ExecutionTaskType;
  defaultTier: ProviderTier;
  fallbackTier?: ProviderTier | null;
  deterministicFallbackAllowed: boolean;
  openAIEscalationAllowed: boolean;
  qualityRequirement: ExecutionQualityRequirement;
  costSensitivity: ExecutionCostSensitivity;
  notes: string;
}

export interface ExecutionPolicyResult {
  taskType: ExecutionTaskType;
  defaultTier: ProviderTier;
  chosenTier: ProviderTier | null;
  chosenProvider: string | null;
  chosenModel: string | null;
  fallbackTier?: ProviderTier | null;
  fallbackUsed: boolean;
  outcome: ExecutionPolicyOutcome;
  selectionReason: string;
  qualityRequirement: ExecutionQualityRequirement;
  costSensitivity: ExecutionCostSensitivity;
  deterministicFallbackAllowed: boolean;
  openAIEscalationAllowed: boolean;
}

export interface CanonicalSignalIngestionInput {
  sourceUrl?: string;
  manualNoteText?: string;
  title?: string;
  sourceType?: Extract<
    CanonicalSignalSourceType,
    "github_repo" | "article" | "tool_launch" | "manual_note"
  >;
  sourceAuthorOrOwner?: string;
  language?: string;
  topicTags?: string[];
  noveltyHint?: string;
  sourceMetadataJson?: Record<string, unknown>;
}

export interface CanonicalSignalDraft extends CreateSignalInput {
  sourceType: Extract<
    CanonicalSignalSourceType,
    "github_repo" | "article" | "tool_launch" | "manual_note"
  >;
}

export interface GenerateIdeaInput {
  signalId: string;
}

export interface GenerateContentInput {
  ideaId: string;
}

export interface RefineContentInput {
  contentId: string;
}

export interface GenerateVisualInput {
  contentId: string;
}

export interface GenerateFinalPostInput {
  contentId: string;
  config?: FinalPostGenerationConfig;
  outcomeContext?: FinalPostOutcomeContext;
}

export interface FinalPostGenerationConfig {
  hookMode?: FinalPostHookMode;
  humanTextureLevel?: number;
  businessSharpnessLevel?: number;
  antiBlandness?: boolean;
  outcomeAwareShaping?: boolean;
  preserveBrandVoice?: boolean;
  preservePublishabilityFocus?: boolean;
}

export interface FinalPostOutcomeContext {
  feedbackSummary?: FeedbackSummary;
  patternMemorySummary?: PatternMemorySummary;
}

export interface FinalPostQualityMetadata {
  hookStrengthScore: number;
  humanFeelScore: number;
  specificityScore: number;
  publishabilityScore: number;
  notes: string[];
  outcomePatternBiasNotes?: string[];
  appliedOutcomeBias?: "repeat" | "avoid" | "neutral";
}

export interface CreateAnalyticsSnapshotInput {
  contentAssetId: string;
  postUrl?: string;
  platform?: "linkedin";
  publishedAt?: string;
  audienceGeoHint?: string;
  audienceSegment?: string;
  impressions: number;
  likes: number;
  comments: number;
  saves: number;
  reactions?: number;
  reposts?: number;
  profileViews: number;
  followersGained: number;
  inboundLeads?: number;
  qualitativeNotes?: string;
}

export interface CreateSourceItemInput {
  title: string;
  sourceType: DiscoverySourceType;
  sourceUrl?: string;
  rawText: string;
}

export interface SourceIntakeInput {
  sourceType: SourceIntakeType;
  title: string;
  sourceUrl?: string;
  summaryText: string;
  operatorNotes?: string;
  githubSubtype?: "release" | "issue" | "repo_change";
  repoName?: string;
  repoContext?: string;
  releaseOrChangeType?: string;
  targetRole?: string;
  companyContext?: string;
}

export interface AudienceScoutInput {
  targetTopics: string[];
  targetRoles?: string[];
  targetKeywords?: string[];
  publicInputs?: Array<{
    sourceLabel?: string;
    sourceUrl?: string;
    excerpt: string;
  }>;
  maxResults?: number;
}

export interface AIScoutEnrichment {
  improvedSummary?: string;
  whyItMatters?: string;
  businessConsequence?: string;
  operatorAngle?: string;
  uncertaintyNote?: string;
}

export interface AIContentGeneration {
  contentIdea?: string;
  draftAngle?: string;
  postSeed?: string;
  commentSeed?: string;
  angleStub?: string;
  warnings?: string[];
  provider?: string;
}

export interface GenerateMatchContentInput {
  itemType: "match";
  recommendedAction: "write_post" | "write_comment" | "write_reply" | "save_for_later";
  title?: string;
  audienceSummary?: string;
  solutionSummary?: string;
  painSummary?: string;
  whyItMatters?: string;
  operatorAngle?: string;
  businessConsequence?: string;
  supportSummary?: string;
  learnedPatterns?: string[];
}

export interface AudienceScoutItem {
  id: string;
  sourcePlatform: "public_web";
  sourceLabel?: string;
  sourceUrl?: string;
  authorName?: string;
  authorRole?: string;
  rawExcerpt: string;
  painSignalSummary: string;
  whyItMatters: string;
  suggestedActionType: AudienceScoutSuggestedActionType;
  topicCluster?: string;
  confidence: "high" | "medium" | "low";
  adapterSummary?: ScoutItemAdapterSummary;
  signalStrength?: "weak" | "medium" | "strong";
  scoreNotes?: string[];
  aiEnrichment?: AIScoutEnrichment;
  createdAt: string;
}

export interface AudienceScoutResult {
  items: AudienceScoutItem[];
  summary: string;
  notes: string;
}

export interface SolutionScoutInput {
  sourceType?: "github" | "article" | "manual_research" | "mixed";
  targetProblem?: string;
  sourceLabel?: string;
  sourceUrl?: string;
  sourceExcerpt: string;
  operatorNotes?: string;
}

export interface SolutionScoutItem {
  id: string;
  sourceType: "github" | "article" | "manual_research" | "mixed";
  sourceLabel?: string;
  sourceUrl?: string;
  rawExcerpt: string;
  solutionPattern: string;
  implementationLesson: string;
  tradeoffOrConstraint: string;
  whyItMatters: string;
  suggestedAngle: RelevanceAnalysis["bestAngle"];
  suggestedActionType: AudienceScoutSuggestedActionType;
  confidence: "high" | "medium" | "low";
  adapterSummary?: ScoutItemAdapterSummary;
  signalStrength?: "weak" | "medium" | "strong";
  scoreNotes?: string[];
  aiEnrichment?: AIScoutEnrichment;
  createdAt: string;
}

export interface SolutionScoutResult {
  items: SolutionScoutItem[];
  summary: string;
  notes: string;
}

export interface ScoutMatchInput {
  audienceItems: AudienceScoutItem[];
  solutionItems: SolutionScoutItem[];
  feedbackSummary?: FeedbackSummary;
  patternMemorySummary?: PatternMemorySummary;
}

export interface MatchedOpportunity {
  id: string;
  audienceItemId: string;
  solutionItemId: string;
  matchedPain: string;
  matchedSolutionPattern: string;
  whyThisMatchWorks: string;
  suggestedAngle: RelevanceAnalysis["bestAngle"];
  recommendedAction: "write_post" | "write_comment" | "write_reply" | "save_for_later";
  confidence: "high" | "medium" | "low";
  opportunityStrength?: "weak" | "medium" | "strong";
  scoreNotes?: string[];
  aiEnrichment?: AIScoutEnrichment;
  aiContent?: AIContentGeneration;
  createdAt: string;
}

export interface ScoutMatchResult {
  items: MatchedOpportunity[];
  summary: string;
  notes: string;
}

export interface PersistedMatchedOpportunity {
  id: string;
  match: MatchedOpportunity;
  status: "new" | "reviewed" | "converted" | "archived";
  createdAt: string;
  lastActionAt?: string;
}

export interface MatchedOpportunityStore {
  items: PersistedMatchedOpportunity[];
}

export interface ScoutOpportunityContext {
  matchedOpportunities: MatchedOpportunity[];
  savedMatches?: PersistedMatchedOpportunity[];
}

export interface ScoutFeedInput {
  mode: "audience" | "solution" | "mixed";
  items: Array<{
    sourceType?: "github" | "article" | "manual_research" | "public_web" | "mixed";
    sourceLabel?: string;
    sourceUrl?: string;
    excerpt: string;
    targetProblem?: string;
  }>;
}

export type ScoutFeedAdapterFamily =
  | "public_discussion"
  | "github_snapshot"
  | "article_snapshot"
  | "watched_url_snapshot"
  | "manual_feed";

export interface ScoutFeedAdapterSummary {
  families: ScoutFeedAdapterFamily[];
  usedDeterministicFallback: boolean;
  compactLabel?: string;
}

export interface ScoutFeedGroupAdapterSummary {
  families: ScoutFeedAdapterFamily[];
  usedDeterministicFallback: boolean;
  compactLabel?: string;
}

export interface ScoutItemAdapterSummary {
  family: ScoutFeedAdapterFamily;
  usedDeterministicFallback: boolean;
  compactLabel?: string;
}

export interface ScoutFeedResult {
  audienceItems?: AudienceScoutItem[];
  solutionItems?: SolutionScoutItem[];
  adapterSummary?: ScoutFeedAdapterSummary;
  audienceAdapterSummary?: ScoutFeedGroupAdapterSummary;
  solutionAdapterSummary?: ScoutFeedGroupAdapterSummary;
  notes: string;
  summary: string;
}

export interface LiveIngestionItem {
  id: string;
  sourceKind:
    | "public_excerpt"
    | "watched_url_snapshot"
    | "github_watch_snapshot"
    | "article_watch_snapshot"
    | "manual_feed_snapshot";
  sourceLabel?: string;
  sourceUrl?: string;
  rawExcerpt: string;
  capturedAt: string;
  fingerprint: string;
  status: "draft" | "new" | "sent_to_feed" | "archived" | "discarded";
  origin?: "manual" | "watchlist_refresh";
  watchlistItemId?: string;
  refreshRunId?: string;
  refreshRunLabel?: string;
  notes?: string;
}

export interface LiveIngestionBuffer {
  items: LiveIngestionItem[];
}

export interface WatchlistItem {
  id: string;
  sourceKind:
    | "watched_url"
    | "github_repo"
    | "github_release"
    | "github_issue"
    | "article_source"
    | "public_discussion_source";
  label: string;
  sourceUrl?: string;
  notes?: string;
  refreshCadence: "manual_only" | "daily_candidate" | "weekly_candidate";
  priority?: "normal" | "high";
  isActive: boolean;
  createdAt: string;
  lastUsedAt?: string;
  lastRefreshedAt?: string;
}

export interface WatchlistStore {
  items: WatchlistItem[];
}

export type AutonomousWatchlistSourceKind = WatchlistItem["sourceKind"];

export type AutonomousWatchlistRefreshCadence =
  WatchlistItem["refreshCadence"];

export interface AutoPromotionRules {
  enabled: boolean;
  minPriorityScore?: number;
  minConfidence?: "high" | "medium" | "low";
  minOpportunityStrength?: "strong" | "medium" | "weak";
  requireMemoryAlignment?: boolean;
  autoDraftGeneration?: boolean;
}

export interface AutonomousWatchlist {
  id: string;
  sourceKind: AutonomousWatchlistSourceKind;
  label: string;
  sourceUrl?: string;
  notes?: string;
  seedExcerpt: string;
  targetProblem?: string;
  refreshCadence: AutonomousWatchlistRefreshCadence;
  priority?: "normal" | "high";
  isActive: boolean;
  autoPromotionRules?: AutoPromotionRules;
  lastRunAt?: string;
  nextRunAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAutonomousWatchlistInput {
  sourceKind: AutonomousWatchlistSourceKind;
  label: string;
  sourceUrl?: string;
  notes?: string;
  seedExcerpt: string;
  targetProblem?: string;
  refreshCadence: AutonomousWatchlistRefreshCadence;
  priority?: "normal" | "high";
  isActive?: boolean;
  autoPromotionRules?: AutoPromotionRules;
}

export interface UpdateAutonomousWatchlistInput {
  label?: string;
  sourceUrl?: string;
  notes?: string;
  seedExcerpt?: string;
  targetProblem?: string;
  refreshCadence?: AutonomousWatchlistRefreshCadence;
  priority?: "normal" | "high";
  isActive?: boolean;
  autoPromotionRules?: AutoPromotionRules;
  lastRunAt?: string;
  nextRunAt?: string;
}

export type AutonomousRunTriggerType = "scheduler" | "manual";

export type AutonomousRunType = "watchlist_scout_feed" | "signal_pipeline";

export type AutonomousRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "blocked"
  | "partial";

export type AutonomousPipelineStageName =
  | "analyze_signal"
  | "position_signal_and_decide"
  | "generate_content_asset"
  | "review_content_asset"
  | "enqueue_candidate";

export interface AutonomousRunResultMetadata {
  audienceItemCount: number;
  solutionItemCount: number;
  usedAi: boolean;
  ingestionArtifactCount?: number;
  ingestionStatus?: "not_applicable" | "completed" | "empty" | "failed";
  stageOrder?: AutonomousPipelineStageName[];
  stagesAttempted?: AutonomousPipelineStageName[];
  stagesCompleted?: AutonomousPipelineStageName[];
  stagesBlocked?: AutonomousPipelineStageName[];
  stagesFailed?: AutonomousPipelineStageName[];
  producedSignalAnalysisId?: string;
  producedSolutionMemoryId?: string;
  producedOrchestratorDecisionId?: string;
  producedContentAssetId?: string;
  producedCriticReviewId?: string;
  producedCandidateQueueItemId?: string;
}

export interface AutonomousRun {
  id: string;
  watchlistId?: string;
  signalId?: string;
  triggerType: AutonomousRunTriggerType;
  runType: AutonomousRunType;
  status: AutonomousRunStatus;
  startedAt?: string;
  completedAt?: string;
  errorSummary?: string;
  resultSummary?: string;
  resultMetadata?: AutonomousRunResultMetadata;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAutonomousRunInput {
  watchlistId?: string;
  signalId?: string;
  triggerType: AutonomousRunTriggerType;
  runType: AutonomousRunType;
  status: AutonomousRunStatus;
  startedAt?: string;
  completedAt?: string;
  errorSummary?: string;
  resultSummary?: string;
  resultMetadata?: AutonomousRunResultMetadata;
}

export interface UpdateAutonomousRunInput {
  status?: AutonomousRunStatus;
  startedAt?: string;
  completedAt?: string;
  errorSummary?: string;
  resultSummary?: string;
  resultMetadata?: AutonomousRunResultMetadata;
}

export interface AutonomousSchedulerTickResult {
  evaluatedAt: string;
  dueWatchlistIds: string[];
  skippedWatchlistIds: string[];
  processedSignalIds?: string[];
  skippedSignalIds?: string[];
  runs: AutonomousRun[];
}

export interface AutonomousIngestionArtifact {
  id: string;
  watchlistId: string;
  autonomousRunId: string;
  sourceType: SourceIntakeType;
  sourceUrl?: string;
  title: string;
  rawText: string;
  normalizedSignalText?: string;
  suggestedAngle?: RelevanceAnalysis["bestAngle"];
  reasoningSummary?: string;
  status: "ingested" | "empty" | "failed";
  errorSummary?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAutonomousIngestionArtifactInput {
  watchlistId: string;
  autonomousRunId: string;
  sourceType: SourceIntakeType;
  sourceUrl?: string;
  title: string;
  rawText: string;
  normalizedSignalText?: string;
  suggestedAngle?: RelevanceAnalysis["bestAngle"];
  reasoningSummary?: string;
  status: "ingested" | "empty" | "failed";
  errorSummary?: string;
}

export type AutonomousReviewQueueSourceKind = "audience" | "solution";

export type AutonomousReviewQueueStatus = "new" | "reviewed" | "archived";

export interface AutonomousReviewQueueItem {
  id: string;
  watchlistId: string;
  autonomousRunId: string;
  sourceArtifactId?: string;
  sourceKind: AutonomousReviewQueueSourceKind;
  dedupeKey: string;
  title: string;
  summary: string;
  rationale: string;
  recommendedAction:
    | "write_post"
    | "write_comment"
    | "write_reply"
    | "save_for_later";
  status: AutonomousReviewQueueStatus;
  aiEnrichment?: AIScoutEnrichment;
  aiContent?: AIContentGeneration;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAutonomousReviewQueueItemInput {
  watchlistId: string;
  autonomousRunId: string;
  sourceArtifactId?: string;
  sourceKind: AutonomousReviewQueueSourceKind;
  dedupeKey: string;
  title: string;
  summary: string;
  rationale: string;
  recommendedAction:
    | "write_post"
    | "write_comment"
    | "write_reply"
    | "save_for_later";
  status?: AutonomousReviewQueueStatus;
  aiEnrichment?: AIScoutEnrichment;
  aiContent?: AIContentGeneration;
}

export type AutonomousMatchedOpportunityStatus = "new" | "reviewed" | "archived";

export type AutonomousMatchedOpportunityReviewState =
  | "new"
  | "in_review"
  | "saved"
  | "dismissed"
  | "archived";

export type AutonomousContentWorkItemKind =
  | "post"
  | "comment"
  | "reply"
  | "deferred_note";

export type AutonomousContentWorkItemStatus =
  | "draft"
  | "parked"
  | "ready_for_draft"
  | "blocked"
  | "archived";

export type AutonomousOpportunityPriorityBand = "high" | "medium" | "low";

export interface AutonomousContentDraftSeed {
  title: string;
  angle?: string;
  seedText: string;
  sourceSummary: string;
  rationale: string;
  recommendedAction: AutonomousMatchedOpportunity["recommendedAction"];
  priorityBand: AutonomousOpportunityPriorityBand;
}

export interface AutonomousContentDraftProgress {
  hasDraft: boolean;
  draftId?: string;
  draftStatus?: AutonomousDraftDocumentStatus;
  draftUpdatedAt?: string;
}

export interface AutonomousMatchedOpportunity {
  id: string;
  watchlistId: string;
  autonomousRunId: string;
  audienceQueueItemId: string;
  solutionQueueItemId: string;
  dedupeKey: string;
  title: string;
  matchedPain: string;
  matchedSolutionPattern: string;
  matchRationale: string;
  suggestedAngle: RelevanceAnalysis["bestAngle"];
  recommendedAction:
    | "write_post"
    | "write_comment"
    | "write_reply"
    | "save_for_later";
  priorityScore: number;
  priorityBand: AutonomousOpportunityPriorityBand;
  reasonLines: string[];
  confidence: "high" | "medium" | "low";
  opportunityStrength?: "weak" | "medium" | "strong";
  scoreNotes?: string[];
  status: AutonomousMatchedOpportunityStatus;
  reviewState: AutonomousMatchedOpportunityReviewState;
  reviewedAt?: string;
  reviewNote?: string;
  aiEnrichment?: AIScoutEnrichment;
  aiContent?: AIContentGeneration;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAutonomousMatchedOpportunityInput {
  watchlistId: string;
  autonomousRunId: string;
  audienceQueueItemId: string;
  solutionQueueItemId: string;
  dedupeKey: string;
  title: string;
  matchedPain: string;
  matchedSolutionPattern: string;
  matchRationale: string;
  suggestedAngle: RelevanceAnalysis["bestAngle"];
  recommendedAction:
    | "write_post"
    | "write_comment"
    | "write_reply"
    | "save_for_later";
  priorityScore: number;
  priorityBand: AutonomousOpportunityPriorityBand;
  reasonLines: string[];
  confidence: "high" | "medium" | "low";
  opportunityStrength?: "weak" | "medium" | "strong";
  scoreNotes?: string[];
  status?: AutonomousMatchedOpportunityStatus;
  reviewState?: AutonomousMatchedOpportunityReviewState;
  reviewedAt?: string;
  reviewNote?: string;
  aiEnrichment?: AIScoutEnrichment;
  aiContent?: AIContentGeneration;
}

export interface UpdateAutonomousMatchedOpportunityReviewInput {
  reviewState: AutonomousMatchedOpportunityReviewState;
  reviewNote?: string;
}

export interface AutonomousContentWorkItem {
  id: string;
  sourceMatchedOpportunityId: string;
  watchlistId: string;
  autonomousRunId: string;
  workItemKind: AutonomousContentWorkItemKind;
  title: string;
  summary: string;
  rationale: string;
  recommendedAction: AutonomousMatchedOpportunity["recommendedAction"];
  priorityScore: number;
  priorityBand: AutonomousOpportunityPriorityBand;
  reviewState: AutonomousMatchedOpportunityReviewState;
  status: AutonomousContentWorkItemStatus;
  stateChangedAt?: string;
  workNote?: string;
  aiContent?: AIContentGeneration;
  draftSeed?: AutonomousContentDraftSeed;
  draftProgress?: AutonomousContentDraftProgress;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAutonomousContentWorkItemInput {
  sourceMatchedOpportunityId: string;
  watchlistId: string;
  autonomousRunId: string;
  workItemKind: AutonomousContentWorkItemKind;
  title: string;
  summary: string;
  rationale: string;
  recommendedAction: AutonomousMatchedOpportunity["recommendedAction"];
  priorityScore: number;
  priorityBand: AutonomousOpportunityPriorityBand;
  reviewState: AutonomousMatchedOpportunityReviewState;
  status?: AutonomousContentWorkItemStatus;
  stateChangedAt?: string;
  workNote?: string;
  aiContent?: AIContentGeneration;
  draftSeed?: AutonomousContentDraftSeed;
}

export interface UpdateAutonomousContentWorkItemStatusInput {
  status: AutonomousContentWorkItemStatus;
  workNote?: string;
}

export type AutonomousDraftDocumentStatus = "draft" | "ready" | "blocked" | "archived";

export interface AutonomousDraftDocument {
  id: string;
  sourceContentWorkItemId: string;
  sourceWorkItemTitle?: string;
  sourceWorkItemStatus?: AutonomousContentWorkItemStatus;
  sourceWorkItemRecommendedAction?: AutonomousMatchedOpportunity["recommendedAction"];
  sourceWorkItemSummary?: string;
  title: string;
  body: string;
  angle?: string;
  sourceSummary: string;
  recommendedAction: AutonomousMatchedOpportunity["recommendedAction"];
  status: AutonomousDraftDocumentStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAutonomousDraftDocumentInput {
  sourceContentWorkItemId: string;
  title: string;
  body: string;
  angle?: string;
  sourceSummary: string;
  recommendedAction: AutonomousMatchedOpportunity["recommendedAction"];
  status?: AutonomousDraftDocumentStatus;
}

export interface UpdateAutonomousDraftDocumentInput {
  title?: string;
  body?: string;
  angle?: string;
}

export interface UpdateAutonomousDraftDocumentStatusInput {
  status: AutonomousDraftDocumentStatus;
}

export interface CreateMarketProfileInput {
  country: string;
  region: string;
  primaryLanguage: string;
  marketNote: string;
}

export interface ScoreTopicsInput {
  sourceItemIds?: string[];
  ideaIds?: string[];
  marketProfileIds?: string[];
}

export interface BuildQueueInput {
  topicScoreIds?: string[];
}

export interface CreateBrandVoiceProfileInput {
  name: string;
  tone: string;
  audience: string;
  writingRules: string[];
  bannedPatterns: string[];
  preferredPatterns: string[];
  styleNotes: string;
  isActive: boolean;
}

export interface GenerateCommentInput {
  sourcePostText: string;
  positioningContext?: string;
  relevanceScore?: number;
  bestAngle?: RelevanceAnalysis["bestAngle"];
  recommendedAction?: RelevanceAnalysis["recommendedAction"];
  targetRole?: string;
  companyContext?: string;
  reasoningSummary?: string;
  useRelevanceAdaptation?: boolean;
}

export interface GenerateReplyInput {
  ourPostText: string;
  incomingCommentText: string;
  context?: string;
  relevanceScore?: number;
  bestAngle?: RelevanceAnalysis["bestAngle"];
  recommendedAction?: RelevanceAnalysis["recommendedAction"];
  targetRole?: string;
  companyContext?: string;
  reasoningSummary?: string;
  useRelevanceAdaptation?: boolean;
}

export interface AnalyzeRelevanceInput {
  companyText?: string;
  roleTitle?: string;
  postText?: string;
  websiteAboutText?: string;
  hasCommentContext?: boolean;
}

export interface DecisionLayerInput {
  signalText: string;
  sourceType?: DecisionSourceType;
  signalCategory?: string;
  authorRole?: string;
  targetRole?: string;
  companyContext?: string;
  postContext?: string;
  relevanceScore?: number;
  bestAngle?: RelevanceAnalysis["bestAngle"];
  recommendedAction?: RelevanceAnalysis["recommendedAction"];
  reasoningSummary?: string;
  brandVoiceHints?: string;
  recentAnalyticsHints?: string;
  hasCommentContext?: boolean;
  hasReplyContext?: boolean;
}

export interface NormalizedSourceSignal {
  sourceType: SourceIntakeType;
  title: string;
  sourceUrl?: string;
  rawSummary: string;
  normalizedSignalText: string;
  suggestedAngle: RelevanceAnalysis["bestAngle"];
  reasoningSummary: string;
  githubSubtype?: "release" | "issue" | "repo_change";
  repoName?: string;
  repoContext?: string;
  releaseOrChangeType?: string;
  targetRole?: string;
  companyContext?: string;
  plannerReadyPayload: DecisionLayerInput;
}

export interface GrowthRhythmCandidate {
  id: string;
  title: string;
  suggestedAction:
    | DecisionRecommendedNextAction
    | "generate_reply"
    | "save_for_later"
    | "write_post"
    | "refine_post"
    | "make_visual"
    | "analyze_market";
  priority: DecisionPriority | QueuePriority;
  status: GrowthRhythmStatus;
  bestAngle?: RelevanceAnalysis["bestAngle"];
  reasoningSummary?: string;
  sourceType?: DecisionSourceType | SourceType;
  feedbackAlignment?: "positive" | "neutral" | "negative";
  feedbackReason?: string;
  feedbackHint?: string;
  feedbackHintKind?: "repeat" | "avoid" | "neutral";
  memoryBadge?: string;
  memoryBadgeKind?: "repeat" | "avoid" | "neutral";
}

export interface GrowthRhythmInput {
  queueItems: GrowthRhythmCandidate[];
  savedCandidates?: GrowthRhythmCandidate[];
  feedbackSummary?: FeedbackSummary;
  patternMemorySummary?: PatternMemorySummary;
  recentSignals?: Array<Pick<Signal, "id" | "title" | "sourceType" | "status">>;
  recentStrategyRecommendations?: Array<
    Pick<StrategyRecommendation, "id" | "title" | "priority" | "description">
  >;
}

export interface GrowthRhythmPlan {
  topPostCandidates: GrowthRhythmCandidate[];
  topCommentCandidates: GrowthRhythmCandidate[];
  keepForLater: GrowthRhythmCandidate[];
  weeklyFocus: string;
  suggestedCadence: string;
  reasoningSummary: string;
}

export interface ManualOutcomeFeedback {
  id: string;
  artifactType: ManualOutcomeArtifactType;
  artifactId: string;
  status: ManualOutcomeStatus;
  responseLevel: ManualOutcomeResponseLevel;
  gotReplies?: boolean;
  gotProfileViews?: boolean;
  gotLeadSignal?: boolean;
  repeatTopic?: boolean;
  notes?: string;
  createdAt: string;
}

export interface FeedbackSummary {
  strongPatterns: string[];
  weakPatterns: string[];
  suggestedRepeats: string[];
  suggestedAvoids: string[];
  reasoningSummary: string;
  totalRecords: number;
}

export interface PatternMemoryRecord {
  id: string;
  label: string;
  kind: "repeat" | "avoid";
  artifactType?: ManualOutcomeArtifactType;
  strength: number;
  occurrences: number;
  lastSeenAt: string;
  source: "feedback";
}

export interface PatternMemorySummary {
  repeatPatterns: PatternMemoryRecord[];
  avoidPatterns: PatternMemoryRecord[];
  recurringThemes: string[];
  weakThemes: string[];
  notes: string;
  totalPatterns: number;
}

export interface StrategyAnalysisInput {
  feedbackSummary?: FeedbackSummary;
  patternMemorySummary?: PatternMemorySummary;
}

export interface OrchestratedRecommendationInput {
  currentSourceSignal?: NormalizedSourceSignal;
  currentDecisionPlan?: DecisionPlan;
  growthRhythmPlan?: GrowthRhythmPlan;
  strategyRecommendations?: Array<
    Pick<StrategyRecommendation, "id" | "title" | "priority" | "description">
  >;
  feedbackSummary?: FeedbackSummary;
  patternMemorySummary?: PatternMemorySummary;
  scoutOpportunityContext?: ScoutOpportunityContext;
}

export interface OrchestratedRecommendation {
  recommendedAction:
    | "write_post"
    | "write_comment"
    | "write_reply"
    | "save_for_later"
    | "revisit_signal"
    | "reinforce_theme";
  recommendationReason: string;
  primaryTarget: string;
  supportingSignals: string[];
  confidence: "high" | "medium" | "low";
  coordinationNotes: string[];
  scoutSupport?: string[];
  scoutInfluence?: "strong" | "moderate" | "weak";
}

export interface FeedbackAwareThemeTag {
  label: string;
  kind: "repeat" | "avoid";
  source: "feedback";
  reason?: string;
}

export function buildFeedbackSummary(records: ManualOutcomeFeedback[]): FeedbackSummary {
  if (records.length === 0) {
    return {
      strongPatterns: [],
      weakPatterns: [],
      suggestedRepeats: [],
      suggestedAvoids: [],
      reasoningSummary: "No manual outcome feedback yet.",
      totalRecords: 0
    };
  }

  const finalPostStrong = records.filter(
    (record) => record.artifactType === "final_post" && record.responseLevel === "strong"
  ).length;
  const commentStrong = records.filter(
    (record) => record.artifactType === "comment" && record.responseLevel !== "weak"
  ).length;
  const replyStrong = records.filter(
    (record) => record.artifactType === "reply" && (record.gotReplies || record.responseLevel === "strong")
  ).length;
  const leadSignals = records.filter((record) => record.gotLeadSignal).length;
  const repeats = records.filter((record) => record.repeatTopic).length;
  const weakPosts = records.filter(
    (record) => record.artifactType === "final_post" && record.responseLevel === "weak"
  ).length;
  const weakEngagement = records.filter(
    (record) =>
      (record.artifactType === "comment" || record.artifactType === "reply") &&
      record.responseLevel === "weak"
  ).length;
  const notPosted = records.filter((record) => record.status === "not_posted").length;

  const strongPatterns: string[] = [];
  const weakPatterns: string[] = [];
  const suggestedRepeats: string[] = [];
  const suggestedAvoids: string[] = [];

  if (finalPostStrong > 0) {
    strongPatterns.push("Final posts are producing the strongest response signal.");
  }
  if (commentStrong > 0) {
    strongPatterns.push("Comments are earning enough response to stay in the weekly mix.");
  }
  if (replyStrong > 0) {
    strongPatterns.push("Replies with direct operator context are keeping conversations alive.");
  }
  if (leadSignals > 0) {
    strongPatterns.push("At least one recent artifact triggered lead signal interest.");
  }

  if (weakPosts > 0) {
    weakPatterns.push("Some final posts are landing weakly and need a sharper angle.");
  }
  if (weakEngagement > 0) {
    weakPatterns.push("Some comment or reply attempts are not adding enough traction.");
  }
  if (notPosted > 0) {
    weakPatterns.push("Several drafted items were not posted, which limits learning velocity.");
  }

  if (repeats > 0) {
    suggestedRepeats.push("Repeat topics that were explicitly marked worth revisiting.");
  }
  if (leadSignals > 0 || finalPostStrong > 0) {
    suggestedRepeats.push("Prioritize strong post angles and operator-heavy themes next week.");
  }
  if (replyStrong > 0) {
    suggestedRepeats.push("Keep one reply-oriented thread in the weekly rhythm.");
  }

  if (weakPosts > 0) {
    suggestedAvoids.push("Avoid recycling weak post angles without tightening the hook.");
  }
  if (weakEngagement > 0) {
    suggestedAvoids.push("Avoid generic engagement unless there is a concrete operator point.");
  }
  if (notPosted > 1) {
    suggestedAvoids.push("Avoid overloading the queue with ideas that are unlikely to be shipped.");
  }

  return {
    strongPatterns,
    weakPatterns,
    suggestedRepeats,
    suggestedAvoids,
    reasoningSummary:
      strongPatterns.length > 0
        ? "Use the strongest post and engagement patterns to shape next week's cadence."
        : "The feedback set is still thin, so treat these signals as directional only.",
    totalRecords: records.length
  };
}

interface PatternSeed {
  label: string;
  kind: PatternMemoryRecord["kind"];
  artifactType?: ManualOutcomeArtifactType;
  strength: number;
  seenAt: string;
}

function patternSeedsForRecord(record: ManualOutcomeFeedback): PatternSeed[] {
  const seeds: PatternSeed[] = [];
  const seenAt = record.createdAt;

  if (record.artifactType === "final_post" && record.responseLevel === "strong") {
    seeds.push({
      label: "final posts",
      kind: "repeat",
      artifactType: "final_post",
      strength: 2,
      seenAt
    });
  }

  if (
    record.artifactType === "comment" &&
    (record.responseLevel === "strong" || record.responseLevel === "medium")
  ) {
    seeds.push({
      label: "comments",
      kind: "repeat",
      artifactType: "comment",
      strength: record.responseLevel === "strong" ? 2 : 1,
      seenAt
    });
  }

  if (
    record.artifactType === "reply" &&
    (record.gotReplies || record.responseLevel === "strong" || record.responseLevel === "medium")
  ) {
    seeds.push({
      label: "replies",
      kind: "repeat",
      artifactType: "reply",
      strength: record.gotReplies || record.responseLevel === "strong" ? 2 : 1,
      seenAt
    });
  }

  if (record.repeatTopic) {
    seeds.push({
      label: "repeat-worthy topics",
      kind: "repeat",
      artifactType: record.artifactType,
      strength: 2,
      seenAt
    });
  }

  if (record.gotLeadSignal) {
    seeds.push({
      label: "lead-signal topics",
      kind: "repeat",
      artifactType: record.artifactType,
      strength: 2,
      seenAt
    });
  }

  if (record.gotProfileViews) {
    seeds.push({
      label: "profile-view curiosity",
      kind: "repeat",
      artifactType: record.artifactType,
      strength: 1,
      seenAt
    });
  }

  if (record.artifactType === "final_post" && record.responseLevel === "weak") {
    seeds.push({
      label: "weak post angles",
      kind: "avoid",
      artifactType: "final_post",
      strength: 2,
      seenAt
    });
  }

  if (
    (record.artifactType === "comment" || record.artifactType === "reply") &&
    record.responseLevel === "weak"
  ) {
    seeds.push({
      label: "generic engagement",
      kind: "avoid",
      artifactType: record.artifactType,
      strength: 2,
      seenAt
    });
  }

  if (record.status === "not_posted") {
    seeds.push({
      label: "low posting velocity",
      kind: "avoid",
      artifactType: record.artifactType,
      strength: 1,
      seenAt
    });
  }

  return seeds;
}

function sortPatternMemoryRecords(records: PatternMemoryRecord[]): PatternMemoryRecord[] {
  return [...records].sort(
    (left, right) =>
      right.strength - left.strength ||
      right.occurrences - left.occurrences ||
      right.lastSeenAt.localeCompare(left.lastSeenAt) ||
      left.label.localeCompare(right.label)
  );
}

export function buildPatternMemorySummary(
  records: ManualOutcomeFeedback[]
): PatternMemorySummary {
  if (records.length === 0) {
    return {
      repeatPatterns: [],
      avoidPatterns: [],
      recurringThemes: [],
      weakThemes: [],
      notes: "No long-term pattern memory yet.",
      totalPatterns: 0
    };
  }

  const aggregate = new Map<string, PatternMemoryRecord>();

  for (const record of records) {
    for (const seed of patternSeedsForRecord(record)) {
      const key = `${seed.kind}:${seed.artifactType ?? "all"}:${seed.label}`;
      const current = aggregate.get(key);

      if (!current) {
        aggregate.set(key, {
          id: key,
          label: seed.label,
          kind: seed.kind,
          artifactType: seed.artifactType,
          strength: seed.strength,
          occurrences: 1,
          lastSeenAt: seed.seenAt,
          source: "feedback"
        });
        continue;
      }

      current.strength += seed.strength;
      current.occurrences += 1;
      if (seed.seenAt > current.lastSeenAt) {
        current.lastSeenAt = seed.seenAt;
      }
    }
  }

  const repeatPatterns = sortPatternMemoryRecords(
    Array.from(aggregate.values()).filter((record) => record.kind === "repeat")
  );
  const avoidPatterns = sortPatternMemoryRecords(
    Array.from(aggregate.values()).filter((record) => record.kind === "avoid")
  );
  const recurringThemes = repeatPatterns.slice(0, 3).map((record) => record.label);
  const weakThemes = avoidPatterns.slice(0, 3).map((record) => record.label);
  const notes =
    recurringThemes.length > 0 || weakThemes.length > 0
      ? `Long-term memory is reinforcing ${
          recurringThemes.length > 0 ? recurringThemes.join(", ") : "no repeat patterns yet"
        }${weakThemes.length > 0 ? ` while cautioning on ${weakThemes.join(", ")}` : ""}.`
      : "Pattern memory is still thin. Keep recording outcomes to stabilize repeat and avoid motifs.";

  return {
    repeatPatterns,
    avoidPatterns,
    recurringThemes,
    weakThemes,
    notes,
    totalPatterns: repeatPatterns.length + avoidPatterns.length
  };
}

const FEEDBACK_THEME_VOCABULARY: Array<{ label: string; pattern: RegExp }> = [
  { label: "workflow accountability", pattern: /workflow accountability/i },
  { label: "ownership gap", pattern: /ownership gap/i },
  { label: "handoff failure", pattern: /handoff/i },
  { label: "exception handling", pattern: /exception/i },
  { label: "operational roi", pattern: /operational roi/i },
  { label: "operator execution", pattern: /operator-heavy|operator execution|operator/i },
  { label: "final posts", pattern: /final posts?/i },
  { label: "comments", pattern: /comments?/i },
  { label: "replies", pattern: /replies/i },
  { label: "generic ai commentary", pattern: /generic ai commentary/i },
  { label: "generic engagement", pattern: /generic engagement/i },
  { label: "low posting velocity", pattern: /not posted|learning velocity/i }
];

export function extractFeedbackAwareThemeTags(
  feedbackSummary?: FeedbackSummary
): FeedbackAwareThemeTag[] {
  if (!feedbackSummary || feedbackSummary.totalRecords === 0) {
    return [];
  }

  const output: FeedbackAwareThemeTag[] = [];
  const seen = new Set<string>();
  const groups: Array<{
    kind: FeedbackAwareThemeTag["kind"];
    lines: string[];
  }> = [
    {
      kind: "repeat",
      lines: [...feedbackSummary.strongPatterns, ...feedbackSummary.suggestedRepeats]
    },
    {
      kind: "avoid",
      lines: [...feedbackSummary.weakPatterns, ...feedbackSummary.suggestedAvoids]
    }
  ];

  for (const group of groups) {
    for (const line of group.lines) {
      for (const theme of FEEDBACK_THEME_VOCABULARY) {
        if (!theme.pattern.test(line)) {
          continue;
        }

        const key = `${group.kind}:${theme.label}`;
        if (seen.has(key)) {
          continue;
        }

        seen.add(key);
        output.push({
          label: theme.label,
          kind: group.kind,
          source: "feedback",
          reason: line
        });
      }
    }
  }

  return output;
}

export interface Signal {
  id: string;
  title: string;
  sourceType: SourceType;
  rawText: string;
  sourceUrl?: string;
  sourceDomain?: string;
  sourceTitle?: string;
  sourceAuthorOrOwner?: string;
  fetchedAt?: string;
  language?: string;
  normalizedContent?: string;
  contentHash?: string;
  topicTags?: string[];
  noveltyHint?: string;
  sourceMetadataJson?: Record<string, unknown>;
  status: SignalStatus;
  createdAt: string;
}

export interface SignalAnalysis {
  id: string;
  signalId: string;
  relevanceScore: number;
  whyRelevant: string;
  targetAudience: string;
  businessValueSummary: string;
  painsSolved: string[];
  practicalImplications: string[];
  overhypeNotes?: string;
  recommendedPillar?: string;
  uniquenessScore: number;
  uniquenessReason: string;
  buildabilityScore: number;
  buildabilityReason: string;
  popularityPotentialScore: number;
  brandGrowthPotentialScore: number;
  bestAngle?: string;
  alternativeAnglesJson?: string[];
  recommendedFormat?:
    | "long_linkedin_post"
    | "short_authority_post"
    | "comment_set"
    | "carousel";
  audienceEmphasis?: string;
  toneGuidance?: string;
  recommendedPillarFinal?: string;
  reasoningJson?: Record<string, unknown>;
  createdAt: string;
}

export interface SignalRelevanceAgentOutput {
  relevanceScore: number;
  whyRelevant: string;
  targetAudience: string;
  recommendedPillar?: string;
  popularityPotentialScore: number;
  brandGrowthPotentialScore: number;
  reasoningJson?: Record<string, unknown>;
}

export interface SignalBusinessTranslationAgentOutput {
  businessValueSummary: string;
  painsSolved: string[];
  practicalImplications: string[];
  overhypeNotes?: string;
  uniquenessScore: number;
  uniquenessReason: string;
  buildabilityScore: number;
  buildabilityReason: string;
  targetAudience?: string;
  reasoningJson?: Record<string, unknown>;
}

export interface SignalPositioningAgentOutput {
  bestAngle: string;
  alternativeAnglesJson: string[];
  recommendedFormat:
    | "long_linkedin_post"
    | "short_authority_post"
    | "comment_set"
    | "carousel";
  audienceEmphasis: string;
  toneGuidance: string;
  recommendedPillarFinal: string;
  reasoningJson?: Record<string, unknown>;
}

export interface CreateSignalAnalysisInput {
  signalId: string;
  relevanceScore: number;
  whyRelevant: string;
  targetAudience: string;
  businessValueSummary: string;
  painsSolved: string[];
  practicalImplications: string[];
  overhypeNotes?: string;
  recommendedPillar?: string;
  uniquenessScore: number;
  uniquenessReason: string;
  buildabilityScore: number;
  buildabilityReason: string;
  popularityPotentialScore: number;
  brandGrowthPotentialScore: number;
  bestAngle?: string;
  alternativeAnglesJson?: string[];
  recommendedFormat?: SignalAnalysis["recommendedFormat"];
  audienceEmphasis?: string;
  toneGuidance?: string;
  recommendedPillarFinal?: string;
  reasoningJson?: Record<string, unknown>;
}

export interface UpdateSignalAnalysisInput {
  relevanceScore?: number;
  whyRelevant?: string;
  targetAudience?: string;
  businessValueSummary?: string;
  painsSolved?: string[];
  practicalImplications?: string[];
  overhypeNotes?: string;
  recommendedPillar?: string;
  uniquenessScore?: number;
  uniquenessReason?: string;
  buildabilityScore?: number;
  buildabilityReason?: string;
  popularityPotentialScore?: number;
  brandGrowthPotentialScore?: number;
  bestAngle?: string;
  alternativeAnglesJson?: string[];
  recommendedFormat?: SignalAnalysis["recommendedFormat"];
  audienceEmphasis?: string;
  toneGuidance?: string;
  recommendedPillarFinal?: string;
  reasoningJson?: Record<string, unknown>;
}

export interface Idea {
  id: string;
  signalId: string;
  title: string;
  coreInsight: string;
  businessRelevance: string;
  targetAudience: string;
  status: IdeaStatus;
  sourceContentWorkItemId?: string;
  sourceMatchedOpportunityId?: string;
  createdAt: string;
}

export interface ContentAsset {
  id: string;
  ideaId: string;
  signalId?: string;
  signalAnalysisId?: string;
  orchestratorDecisionId?: string;
  sourceContentWorkItemId?: string;
  sourceMatchedOpportunityId?: string;
  contentType: ContentType;
  hook: string;
  body: string;
  cta: string;
  bestAngle?: string;
  alternativeAnglesJson?: string[];
  recommendedFormat?: "long_linkedin_post" | "short_authority_post" | "comment_set" | "carousel";
  longPostDraft?: string;
  shortPostDraft?: string;
  hooksJson?: string[];
  commentAnglesJson?: string[];
  ctaVariantsJson?: string[];
  carouselOutline?: string;
  contentStatus?: "draft" | "review" | "ready" | "published" | "archived";
  publishReadyFlag?: boolean;
  status: ContentStatus;
  refinedHook?: string;
  refinedBody?: string;
  refinedCta?: string;
  refinementStatus?: RefinementStatus;
  finalHook?: string;
  finalBody?: string;
  finalClosing?: string;
  finalStatus?: FinalPostStatus;
  finalQualityScore?: number;
  finalQualityMetadata?: FinalPostQualityMetadata;
  qualityStatus?: ContentQualityStatus;
  overallQualityScore?: number;
  brandVoiceProfileId?: string;
  createdAt: string;
}

export interface SolutionMemory {
  id: string;
  signalId: string;
  sourceType: CanonicalSignalSourceType;
  implementationPotential: "high" | "medium" | "low";
  implementationComplexity: "high" | "medium" | "low";
  detectedStack: string[];
  keyFeatures: string[];
  architectureClues: string[];
  deploymentHints: string[];
  clientFitTypes: string[];
  possibleUseCases: string[];
  adaptationNotes?: string;
  repoReference?: string;
  readmeSnapshot?: string;
  implementationNotes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSolutionMemoryInput {
  signalId: string;
  sourceType: CanonicalSignalSourceType;
  implementationPotential: SolutionMemory["implementationPotential"];
  implementationComplexity: SolutionMemory["implementationComplexity"];
  detectedStack?: string[];
  keyFeatures?: string[];
  architectureClues?: string[];
  deploymentHints?: string[];
  clientFitTypes?: string[];
  possibleUseCases?: string[];
  adaptationNotes?: string;
  repoReference?: string;
  readmeSnapshot?: string;
  implementationNotes?: string;
}

export interface VisualAsset {
  id: string;
  contentAssetId: string;
  title: string;
  visualType: VisualType;
  prompt: string;
  status: VisualStatus;
  createdAt: string;
}

export interface AnalyticsSnapshot {
  id: string;
  contentAssetId: string;
  postUrl?: string;
  platform?: "linkedin";
  publishedAt?: string;
  audienceGeoHint?: string;
  audienceSegment?: string;
  impressions: number;
  likes: number;
  comments: number;
  saves: number;
  reactions?: number;
  reposts?: number;
  profileViews: number;
  followersGained: number;
  inboundLeads?: number;
  qualitativeNotes?: string;
  createdAt: string;
}

export type PerformanceSnapshot = AnalyticsSnapshot;
export type PerformanceOutcomeClassification = "strong" | "neutral" | "weak";

export interface SourceItem {
  id: string;
  title: string;
  sourceType: DiscoverySourceType;
  sourceUrl?: string;
  rawText: string;
  normalizedSummary: string;
  tags: string[];
  status: SourceItemStatus;
  createdAt: string;
}

export interface MarketProfile {
  id: string;
  country: string;
  region: string;
  primaryLanguage: string;
  marketNote: string;
  linkedinPriority: StrategyPriority;
  serviceFitScore: number;
  createdAt: string;
}

export interface TopicScore {
  id: string;
  topicLabel: string;
  sourceItemId?: string;
  ideaId?: string;
  marketProfileId?: string;
  brandRelevanceScore: number;
  marketRelevanceScore: number;
  noveltyScore: number;
  priorityScore: number;
  rationale: string;
  createdAt: string;
}

export interface ContentQueueItem {
  id: string;
  topicScoreId: string;
  recommendedAction: QueueAction;
  priority: QueuePriority;
  reason: string;
  status: QueueStatus;
  createdAt: string;
}

export type CandidateQueueItemType =
  | "content_candidate"
  | "high_priority_candidate"
  | "solution_candidate"
  | "manual_review_required";

export type CandidateQueueState =
  | "queued"
  | "ready_for_review"
  | "ready_for_content"
  | "ready_for_solution_followup"
  | "manual_review_queue"
  | "blocked"
  | "ready_to_publish"
  | "revision_requested"
  | "archived";

export type CandidateQueueOperatorAction =
  | "approve_for_publication"
  | "mark_needs_revision"
  | "archive_candidate";

export interface CandidateQueueItem {
  id: string;
  signalId: string;
  signalAnalysisId: string;
  contentAssetId?: string;
  criticReviewId?: string;
  solutionMemoryId?: string;
  orchestratorDecisionId: string;
  candidateType: CandidateQueueItemType;
  queueState: CandidateQueueState;
  priorityScore?: number;
  priorityLabel: "high" | "medium" | "low";
  whyQueued: string;
  nextAction: string;
  requiresHumanReview: boolean;
  operatorNote?: string;
  createdAt: string;
  updatedAt: string;
}

export type FactoryPriorityItemType = "signal" | "candidate_queue_item";
export type FactoryPriorityRecommendedAction =
  | "run_now"
  | "queue_for_review"
  | "retry_later"
  | "rerun_when_window_matches"
  | "deprioritize"
  | "skip";
export type FactoryPriorityLabel = "high" | "medium" | "low";
export type FactoryPriorityMemoryInfluenceLabel = "positive" | "neutral" | "negative";

export interface FactoryPriorityDecision {
  itemType: FactoryPriorityItemType;
  itemId: string;
  signalId: string;
  candidateType?: CandidateQueueItemType;
  contentAssetId?: string;
  priorityScore: number;
  priorityLabel: FactoryPriorityLabel;
  recommendedAction: FactoryPriorityRecommendedAction;
  recommendedDelayMinutes?: number;
  timingHint?: string;
  reasonSummary: string;
  memoryInfluenceLabel: FactoryPriorityMemoryInfluenceLabel;
  supportingFactorsJson: Record<string, unknown>;
}

export interface FactoryPrioritySelectionResult {
  evaluatedAt: string;
  signals: FactoryPriorityDecision[];
  candidateQueueItems: FactoryPriorityDecision[];
}

export interface CreateCandidateQueueItemInput {
  signalId: string;
  signalAnalysisId: string;
  contentAssetId?: string;
  criticReviewId?: string;
  solutionMemoryId?: string;
  orchestratorDecisionId: string;
  candidateType: CandidateQueueItemType;
  queueState: CandidateQueueState;
  priorityScore?: number;
  priorityLabel: CandidateQueueItem["priorityLabel"];
  whyQueued: string;
  nextAction: string;
  requiresHumanReview: boolean;
  operatorNote?: string;
}

export interface UpdateCandidateQueueItemInput {
  queueState?: CandidateQueueState;
  nextAction?: string;
  requiresHumanReview?: boolean;
  whyQueued?: string;
  operatorNote?: string;
}

export interface CandidateQueueItemDetail {
  candidate: CandidateQueueItem;
  signal: Signal;
  signalAnalysis: SignalAnalysis;
  contentAsset?: ContentAsset;
  criticReview?: CriticReview;
  orchestratorDecision: OrchestratorDecision;
}

export interface StrategyRecommendation {
  id: string;
  type: StrategyType;
  title: string;
  description: string;
  priority: StrategyPriority;
  createdAt: string;
}

export interface LeadProfile {
  id: string;
  name: string;
  company: string;
  role: string;
  relevanceScore: number;
  notes: string;
}

export interface DashboardSummary {
  activeSignals: number;
  draftIdeas: number;
  contentInReview: number;
  matchedLeads: number;
  weeklyEngagementDelta: number;
}

export interface ProviderConfigSummary {
  mode: ProviderExecutionMode;
  textProvider: string | null;
  visualProvider: string | null;
  fallbackEnabled: boolean;
  textProviderStatus?: {
    id: string | null;
    available: boolean;
    reason: string;
    capabilities?: {
      text: boolean;
      visual: boolean;
      live: boolean;
    };
  } | null;
  visualProviderStatus?: {
    id: string | null;
    available: boolean;
    reason: string;
    capabilities?: {
      text: boolean;
      visual: boolean;
      live: boolean;
    };
  } | null;
}

export interface AIRuntimeHealthSummary {
  providerMode: ProviderExecutionMode;
  textProvider: string | null;
  visualProvider: string | null;
  aiActive: boolean;
  fallbackActive: boolean;
  runtimeEnabled: boolean;
  schedulerRuntimeEnabled: boolean;
  fallbackEnabled: boolean;
  configStatus: "ai_active" | "fallback_active" | "invalid";
  issues: string[];
  textProviderStatus?: ProviderConfigSummary["textProviderStatus"];
  visualProviderStatus?: ProviderConfigSummary["visualProviderStatus"];
  operatorAuthConfig: {
    configured: boolean;
    missingConfigKeys: Array<"OPERATOR_USERNAME" | "OPERATOR_PASSWORD">;
  };
}

export interface OperatorControlStatus {
  runtimeHealth: {
    schedulerEnabled: boolean;
    schedulerRunning: boolean;
    lastTickAt?: string;
    lastTickStatus?: "completed" | "failed";
    tickInFlight: boolean;
    failedRunsCount: number;
    staleRunsCount: number;
  };
  intakeHealth: {
    totalWatchlists: number;
    activeWatchlists: number;
    recentSuccessfulRuns: number;
    last10RunsTotal: number;
  };
  opportunityFlow: {
    reviewQueueSize: number;
    newMatchesCount: number;
    savedMatchesCount: number;
    workItemsCount: number;
  };
  draftFlow: {
    readyForReview: number;
    blocked: number;
    totalActive: number;
  };
  providerTruth: {
    mode: ProviderExecutionMode;
    textProvider: string | null;
    visualProvider: string | null;
    fallbackEnabled: boolean;
    aiActive: boolean;
  };
  learningTruth: {
    recentAnalyticsCount: number;
    totalMemoryPatterns: number;
    strongPatternsCount: number;
    strongestPatterns: Array<{
      type: string;
      key: string;
      score: number;
    }>;
  };
  operatorAttention: {
    needsReview: string[];
    degraded: string[];
    healthy: string[];
  };
}

export interface AIProviderProbeResult {
  providerMode: ProviderExecutionMode;
  textProvider: string | null;
  aiActive: boolean;
  fallbackActive: boolean;
  probeStatus: "success" | "inactive" | "failed";
  probeMessage: string;
}

export interface LaunchPreflightResult {
  launchStatus: "ai_ready" | "fallback_ready" | "blocked";
  aiReady: boolean;
  fallbackReady: boolean;
  providerMode: ProviderExecutionMode;
  textProvider: string | null;
  schedulerRuntimeEnabled: boolean;
  configStatus: AIRuntimeHealthSummary["configStatus"];
  issues: string[];
  operatorAuthConfig: AIRuntimeHealthSummary["operatorAuthConfig"];
}

export interface LaunchSmokeArtifactCounts {
  ingestionArtifacts: number;
  reviewQueueItems: number;
  matchedOpportunities: number;
  prioritizedOpportunities: number;
  contentWorkItems: number;
  draftDocuments: number;
}

export interface LaunchSmokeRunResult {
  launchStatus: LaunchPreflightResult["launchStatus"];
  runnable: boolean;
  smokeTag?: string;
  providerMode: ProviderExecutionMode;
  textProvider: string | null;
  schedulerRuntimeEnabled: boolean;
  configStatus: AIRuntimeHealthSummary["configStatus"];
  issues: string[];
  artifactCounts: LaunchSmokeArtifactCounts;
}

export interface LaunchSmokeArtifactsView {
  smokeTag: string;
  summary: {
    watchlistCount: number;
    matchedOpportunityCount: number;
    contentWorkItemCount: number;
    totalCount: number;
  };
  watchlists: AutonomousWatchlist[];
  matchedOpportunities: AutonomousMatchedOpportunity[];
  contentWorkItems: AutonomousContentWorkItem[];
}

export interface LaunchSmokeCleanupResult {
  smokeTag: string;
  deletedWatchlistCount: number;
  deletedMatchedOpportunityCount: number;
  deletedContentWorkItemCount: number;
  totalDeleted: number;
}

export interface BrandVoiceProfile {
  id: string;
  name: string;
  tone: string;
  audience: string;
  writingRules: string[];
  bannedPatterns: string[];
  preferredPatterns: string[];
  styleNotes: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WritingQualityAssessment {
  id: string;
  contentAssetId: string;
  humanToneScore: number;
  clarityScore: number;
  groundednessScore: number;
  antiRobotScore: number;
  overallScore: number;
  notes: string[];
  qualityScore?: number;
  genericnessScore?: number;
  businessValueScore?: number;
  differentiationScore?: number;
  publishReadyFlag?: boolean;
  rewriteSuggestions?: string[];
  criticNotes?: string;
  createdAt: string;
}

export type CriticReview = WritingQualityAssessment;

export interface MemoryPattern {
  id: string;
  patternType:
    | "content"
    | "solution"
    | "audience"
    | "distribution"
    | "implementation"
    | "topic"
    | "angle"
    | "pillar"
    | "audience_fit"
    | "publish_window"
    | "source_type"
    | "content_format";
  patternKey: string;
  strengthScore: number;
  supportingEvidenceJson?: Record<string, unknown>;
  recommendedAction: string;
  lastUpdatedAt: string;
}

export interface CreateMemoryPatternInput {
  patternType: MemoryPattern["patternType"];
  patternKey: string;
  strengthScore: number;
  supportingEvidenceJson?: Record<string, unknown>;
  recommendedAction: string;
}

export interface AnalyticsMemoryUpdateResult {
  snapshot: AnalyticsSnapshot;
  outcomeClassification: PerformanceOutcomeClassification;
  memoryPatterns: MemoryPattern[];
}

export interface OrchestratorDecision {
  id: string;
  signalId: string;
  decisionType: string;
  decisionReason: string;
  confidenceScore: number;
  nextAction: string;
  requiresHumanReview: boolean;
  createdAt: string;
}

export interface CreateOrchestratorDecisionInput {
  signalId: string;
  decisionType: string;
  decisionReason: string;
  confidenceScore: number;
  nextAction: string;
  requiresHumanReview: boolean;
}

export interface AgentRun {
  id: string;
  signalId: string;
  agentName: string;
  modelTier?: string;
  providerName?: string;
  status: "queued" | "running" | "completed" | "failed";
  startedAt: string;
  completedAt?: string;
  inputSummary?: string;
  outputSummary?: string;
  errorMessage?: string;
}

export interface CreateAgentRunInput {
  signalId: string;
  agentName: string;
  modelTier?: string;
  providerName?: string;
  status: AgentRun["status"];
  startedAt: string;
  completedAt?: string;
  inputSummary?: string;
  outputSummary?: string;
  errorMessage?: string;
}

export interface SignalSourceToOutputTrail {
  signal: Signal;
  analyses: SignalAnalysis[];
  contentAssets: ContentAsset[];
  solutionMemories: SolutionMemory[];
  criticReviews: CriticReview[];
  performanceSnapshots: PerformanceSnapshot[];
}

export interface EngagementAdaptationInput {
  relevanceScore: number;
  bestAngle: RelevanceAnalysis["bestAngle"];
  recommendedAction: RelevanceAnalysis["recommendedAction"];
  reasoningSummary?: string;
  targetRole?: string;
  hasCommentContext: boolean;
  generationType: "comment" | "reply";
}

export interface EngagementAdaptationPlan {
  engagementMode:
    | "strategic_execution"
    | "insight_light_positioning"
    | "bridge_outreach_aware"
    | "neutral_or_skip";
  toneDirectives: string[];
  angleDirective: RelevanceAnalysis["bestAngle"];
  depthDirective: "brief" | "medium";
  closingStyle: "none" | "soft_question" | "bridge";
  shouldGenerate: boolean;
  riskFlags: string[];
  metadata: {
    generationType: "comment" | "reply";
    recommendedAction: RelevanceAnalysis["recommendedAction"];
    targetRole?: string;
    reasoningSummary?: string;
  };
}

export interface GeneratedComment {
  text: string;
  mode: "provider" | "deterministic";
  adaptationPlan?: EngagementAdaptationPlan;
  engagementMode?: EngagementAdaptationPlan["engagementMode"];
  shouldGenerate?: boolean;
  appliedAngle?: RelevanceAnalysis["bestAngle"];
}

export interface GeneratedReply {
  text: string;
  mode: "provider" | "deterministic";
  adaptationPlan?: EngagementAdaptationPlan;
  engagementMode?: EngagementAdaptationPlan["engagementMode"];
  shouldGenerate?: boolean;
  appliedAngle?: RelevanceAnalysis["bestAngle"];
}

export interface RelevanceAnalysis {
  relevanceScore: number;
  targetType: "company" | "role" | "post" | "mixed";
  bestAngle:
    | "ownership_gap"
    | "handoff_failure"
    | "exception_handling"
    | "workflow_accountability"
    | "operational_roi"
    | "low_fit";
  recommendedAction:
    | "ignore"
    | "comment"
    | "reply"
    | "save_for_later"
    | "outreach_candidate";
  riskNotes: string[];
  reasoningSummary: string;
  mode: "provider" | "deterministic";
}

export interface DecisionPlan {
  recommendedNextAction: DecisionRecommendedNextAction;
  bestAngle: RelevanceAnalysis["bestAngle"];
  contentPriority: DecisionPriority;
  engagementPriority: DecisionPriority;
  publishability: DecisionPublishability;
  confidence: number;
  decisionMode: "deterministic";
  riskNotes: string[];
  reasoningSummary: string;
  suggestedFlow: DecisionSuggestedFlow;
  shouldEscalateToPost: boolean;
  shouldEscalateToEngagement: boolean;
  shouldStoreForLater: boolean;
}
