import Database from "better-sqlite3";
import type {
  AgentRun,
  AutonomousDraftDocument,
  AutonomousIngestionArtifact,
  AutonomousContentWorkItem,
  AutonomousMatchedOpportunity,
  AutonomousReviewQueueItem,
  AutonomousRun,
  AutonomousWatchlist,
  AnalyticsSnapshot,
  BrandVoiceProfile,
  CandidateQueueItem,
  CreateAgentRunInput,
  CreateCandidateQueueItemInput,
  UpdateCandidateQueueItemInput,
  ContentAsset,
  ContentQueueItem,
  CreateAutonomousRunInput,
  CreateAutonomousWatchlistInput,
  CreateAutonomousIngestionArtifactInput,
  CreateMemoryPatternInput,
  CreateOrchestratorDecisionInput,
  CreateSignalAnalysisInput,
  UpdateSignalAnalysisInput,
  CreateAutonomousDraftDocumentInput,
  CreateAutonomousContentWorkItemInput,
  CreateAutonomousMatchedOpportunityInput,
  CreateSolutionMemoryInput,
  UpdateAutonomousDraftDocumentInput,
  UpdateAutonomousDraftDocumentStatusInput,
  UpdateAutonomousMatchedOpportunityReviewInput,
  UpdateAutonomousContentWorkItemStatusInput,
  CreateAutonomousReviewQueueItemInput,
  CreateAnalyticsSnapshotInput,
  CreateBrandVoiceProfileInput,
  CreateMarketProfileInput,
  CreateSignalInput,
  CreateSourceItemInput,
  Idea,
  MarketProfile,
  MemoryPattern,
  OrchestratorDecision,
  SignalAnalysis,
  Signal,
  SignalSourceToOutputTrail,
  SourceItem,
  SolutionMemory,
  StrategyRecommendation,
  TopicScore,
  UpdateAutonomousRunInput,
  UpdateAutonomousWatchlistInput,
  VisualAsset,
  WritingQualityAssessment
} from "@linkedin-brand-os/shared";
import { createSqliteClient, getDefaultDatabasePath, type SqliteClientOptions } from "./client";
import type {
  ContentAssetsRepository,
  CreateContentAssetRecord,
  CreateStrategyRecommendationRecord,
  CreateVisualAssetRecord
} from "./repositories/contentAssets";
import type { CreateIdeaRecord, IdeasRepository } from "./repositories/ideas";
import type { SignalsRepository } from "./repositories/signals";
import { schemaStatements, tables } from "./schema";

export * from "./client";
export * from "./schema";
export * from "./repositories/signals";
export * from "./repositories/ideas";
export * from "./repositories/contentAssets";
export * from "./repositories/leadProfiles";
export * from "./repositories/analyticsSnapshots";
export * from "./repositories/content_assets";
export * from "./repositories/lead_profiles";
export * from "./repositories/analytics_snapshots";

type CreateSourceItemRecord = Omit<SourceItem, "id" | "createdAt">;
type CreateMarketProfileRecord = Omit<MarketProfile, "id" | "createdAt">;
type CreateTopicScoreRecord = Omit<TopicScore, "id" | "createdAt">;
type CreateContentQueueItemRecord = Omit<ContentQueueItem, "id" | "createdAt">;
type CreateCandidateQueueItemRecord = CreateCandidateQueueItemInput;
type CreateWritingQualityAssessmentRecord = Omit<
  WritingQualityAssessment,
  "id" | "createdAt"
>;
type CreateSignalAnalysisRecord = CreateSignalAnalysisInput;
type CreateSolutionMemoryRecord = CreateSolutionMemoryInput;

export interface SqliteDatabaseOptions extends SqliteClientOptions {}

type SignalRow = {
  id: string;
  title: string;
  source_type: Signal["sourceType"];
  raw_text: string;
  source_url: string | null;
  source_domain: string | null;
  source_title: string | null;
  source_author_or_owner: string | null;
  fetched_at: string | null;
  language: string | null;
  normalized_content: string | null;
  content_hash: string | null;
  topic_tags_json: string | null;
  novelty_hint: string | null;
  source_metadata_json: string | null;
  status: Signal["status"];
  created_at: string;
};

type IdeaRow = {
  id: string;
  signal_id: string;
  title: string;
  core_insight: string;
  business_relevance: string;
  target_audience: string;
  status: Idea["status"];
  source_content_work_item_id: string | null;
  source_matched_opportunity_id: string | null;
  created_at: string;
};

type ContentAssetRow = {
  id: string;
  idea_id: string;
  orchestrator_decision_id: string | null;
  signal_id: string | null;
  signal_analysis_id: string | null;
  source_content_work_item_id: string | null;
  source_matched_opportunity_id: string | null;
  content_type: ContentAsset["contentType"];
  hook: string;
  body: string;
  cta: string;
  best_angle: string | null;
  alternative_angles_json: string | null;
  recommended_format: string | null;
  long_post_draft: string | null;
  short_post_draft: string | null;
  hooks_json: string | null;
  comment_angles_json: string | null;
  cta_variants_json: string | null;
  carousel_outline: string | null;
  content_status: string | null;
  publish_ready_flag: number | null;
  status: ContentAsset["status"];
  refined_hook: string | null;
  refined_body: string | null;
  refined_cta: string | null;
  refinement_status: ContentAsset["refinementStatus"] | null;
  final_hook: string | null;
  final_body: string | null;
  final_closing: string | null;
  final_status: ContentAsset["finalStatus"] | null;
  final_quality_score: number | null;
  quality_status: ContentAsset["qualityStatus"] | null;
  overall_quality_score: number | null;
  brand_voice_profile_id: string | null;
  created_at: string;
};

type VisualAssetRow = {
  id: string;
  content_asset_id: string;
  title: string;
  visual_type: VisualAsset["visualType"];
  prompt: string;
  status: VisualAsset["status"];
  created_at: string;
};

type AnalyticsSnapshotRow = {
  id: string;
  content_asset_id: string;
  post_url: string | null;
  platform: string | null;
  published_at: string | null;
  audience_geo_hint: string | null;
  audience_segment: string | null;
  impressions: number;
  likes: number;
  comments: number;
  saves: number;
  reactions: number | null;
  reposts: number | null;
  profile_views: number;
  followers_gained: number;
  inbound_leads: number | null;
  qualitative_notes: string | null;
  created_at: string;
};

type StrategyRecommendationRow = {
  id: string;
  type: StrategyRecommendation["type"];
  title: string;
  description: string;
  priority: StrategyRecommendation["priority"];
  created_at: string;
};

type SourceItemRow = {
  id: string;
  title: string;
  source_type: SourceItem["sourceType"];
  source_url: string | null;
  raw_text: string;
  normalized_summary: string;
  tags_json: string;
  status: SourceItem["status"];
  created_at: string;
};

type MarketProfileRow = {
  id: string;
  country: string;
  region: string;
  primary_language: string;
  market_note: string;
  linkedin_priority: MarketProfile["linkedinPriority"];
  service_fit_score: number;
  created_at: string;
};

type TopicScoreRow = {
  id: string;
  topic_label: string;
  source_item_id: string | null;
  idea_id: string | null;
  market_profile_id: string | null;
  brand_relevance_score: number;
  market_relevance_score: number;
  novelty_score: number;
  priority_score: number;
  rationale: string;
  created_at: string;
};

type CandidateQueueItemRow = {
  id: string;
  signal_id: string;
  signal_analysis_id: string;
  content_asset_id: string | null;
  critic_review_id: string | null;
  solution_memory_id: string | null;
  orchestrator_decision_id: string;
  candidate_type: CandidateQueueItem["candidateType"];
  queue_state: CandidateQueueItem["queueState"];
  priority_score: number | null;
  priority_label: CandidateQueueItem["priorityLabel"];
  why_queued: string;
  next_action: string;
  requires_human_review: number;
  operator_note: string | null;
  created_at: string;
  updated_at: string;
};

type ContentQueueItemRow = {
  id: string;
  topic_score_id: string;
  recommended_action: ContentQueueItem["recommendedAction"];
  priority: ContentQueueItem["priority"];
  reason: string;
  status: ContentQueueItem["status"];
  created_at: string;
};

type BrandVoiceProfileRow = {
  id: string;
  name: string;
  tone: string;
  audience: string;
  writing_rules_json: string;
  banned_patterns_json: string;
  preferred_patterns_json: string;
  style_notes: string;
  is_active: number;
  created_at: string;
  updated_at: string;
};

type WritingQualityAssessmentRow = {
  id: string;
  content_asset_id: string;
  human_tone_score: number;
  clarity_score: number;
  groundedness_score: number;
  anti_robot_score: number;
  overall_score: number;
  notes_json: string;
  quality_score: number | null;
  genericness_score: number | null;
  business_value_score: number | null;
  differentiation_score: number | null;
  publish_ready_flag: number | null;
  rewrite_suggestions_json: string | null;
  critic_notes: string | null;
  created_at: string;
};

type SignalAnalysisRow = {
  id: string;
  signal_id: string;
  relevance_score: number;
  why_relevant: string;
  target_audience: string;
  business_value_summary: string;
  pains_solved_json: string;
  practical_implications_json: string;
  overhype_notes: string | null;
  recommended_pillar: string | null;
  uniqueness_score: number;
  uniqueness_reason: string;
  buildability_score: number;
  buildability_reason: string;
  popularity_potential_score: number;
  brand_growth_potential_score: number;
  best_angle: string | null;
  alternative_angles_json: string | null;
  recommended_format: SignalAnalysis["recommendedFormat"] | null;
  audience_emphasis: string | null;
  tone_guidance: string | null;
  recommended_pillar_final: string | null;
  reasoning_json: string | null;
  created_at: string;
};

type SolutionMemoryRow = {
  id: string;
  signal_id: string;
  source_type: SolutionMemory["sourceType"];
  implementation_potential: SolutionMemory["implementationPotential"];
  implementation_complexity: SolutionMemory["implementationComplexity"];
  detected_stack_json: string;
  key_features_json: string;
  architecture_clues_json: string;
  deployment_hints_json: string;
  client_fit_types_json: string;
  possible_use_cases_json: string;
  adaptation_notes: string | null;
  repo_reference: string | null;
  readme_snapshot: string | null;
  implementation_notes: string | null;
  created_at: string;
  updated_at: string;
};

type MemoryPatternRow = {
  id: string;
  pattern_type: MemoryPattern["patternType"];
  pattern_key: string;
  strength_score: number;
  supporting_evidence_json: string | null;
  recommended_action: string;
  last_updated_at: string;
};

type OrchestratorDecisionRow = {
  id: string;
  signal_id: string;
  decision_type: string;
  decision_reason: string;
  confidence_score: number;
  next_action: string;
  requires_human_review: number;
  created_at: string;
};

type AgentRunRow = {
  id: string;
  signal_id: string;
  agent_name: string;
  model_tier: string | null;
  provider_name: string | null;
  status: AgentRun["status"];
  started_at: string;
  completed_at: string | null;
  input_summary: string | null;
  output_summary: string | null;
  error_message: string | null;
};

type AutonomousWatchlistRow = {
  id: string;
  source_kind: AutonomousWatchlist["sourceKind"];
  label: string;
  source_url: string | null;
  notes: string | null;
  seed_excerpt: string;
  target_problem: string | null;
  refresh_cadence: AutonomousWatchlist["refreshCadence"];
  priority: NonNullable<AutonomousWatchlist["priority"]> | null;
  is_active: number;
  auto_promotion_rules_json: string | null;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
};

type AutonomousRunRow = {
  id: string;
  watchlist_id: string | null;
  signal_id: string | null;
  trigger_type: AutonomousRun["triggerType"];
  run_type: AutonomousRun["runType"];
  status: AutonomousRun["status"];
  started_at: string | null;
  completed_at: string | null;
  error_summary: string | null;
  result_summary: string | null;
  result_metadata_json: string | null;
  created_at: string;
  updated_at: string;
};

type AutonomousIngestionArtifactRow = {
  id: string;
  watchlist_id: string;
  autonomous_run_id: string;
  source_type: AutonomousIngestionArtifact["sourceType"];
  source_url: string | null;
  title: string;
  raw_text: string;
  normalized_signal_text: string | null;
  suggested_angle: NonNullable<AutonomousIngestionArtifact["suggestedAngle"]> | null;
  reasoning_summary: string | null;
  status: AutonomousIngestionArtifact["status"];
  error_summary: string | null;
  created_at: string;
  updated_at: string;
};

type AutonomousReviewQueueItemRow = {
  id: string;
  watchlist_id: string;
  autonomous_run_id: string;
  source_artifact_id: string | null;
  source_kind: AutonomousReviewQueueItem["sourceKind"];
  dedupe_key: string;
  title: string;
  summary: string;
  rationale: string;
  recommended_action: AutonomousReviewQueueItem["recommendedAction"];
  status: AutonomousReviewQueueItem["status"];
  ai_enrichment_json: string | null;
  ai_content_json: string | null;
  created_at: string;
  updated_at: string;
};

type AutonomousMatchedOpportunityRow = {
  id: string;
  watchlist_id: string;
  autonomous_run_id: string;
  audience_queue_item_id: string;
  solution_queue_item_id: string;
  dedupe_key: string;
  title: string;
  matched_pain: string;
  matched_solution_pattern: string;
  match_rationale: string;
  suggested_angle: AutonomousMatchedOpportunity["suggestedAngle"];
  recommended_action: AutonomousMatchedOpportunity["recommendedAction"];
  priority_score: number;
  priority_band: AutonomousMatchedOpportunity["priorityBand"];
  reason_lines_json: string;
  confidence: AutonomousMatchedOpportunity["confidence"];
  opportunity_strength: NonNullable<AutonomousMatchedOpportunity["opportunityStrength"]> | null;
  score_notes_json: string | null;
  status: AutonomousMatchedOpportunity["status"];
  review_state: AutonomousMatchedOpportunity["reviewState"];
  reviewed_at: string | null;
  review_note: string | null;
  ai_enrichment_json: string | null;
  ai_content_json: string | null;
  created_at: string;
  updated_at: string;
};

type AutonomousContentWorkItemRow = {
  id: string;
  source_matched_opportunity_id: string;
  watchlist_id: string;
  autonomous_run_id: string;
  work_item_kind: AutonomousContentWorkItem["workItemKind"];
  title: string;
  summary: string;
  rationale: string;
  recommended_action: AutonomousContentWorkItem["recommendedAction"];
  priority_score: number;
  priority_band: AutonomousContentWorkItem["priorityBand"];
  review_state: AutonomousContentWorkItem["reviewState"];
  status: AutonomousContentWorkItem["status"];
  state_changed_at: string | null;
  work_note: string | null;
  ai_content_json: string | null;
  draft_seed_json: string | null;
  created_at: string;
  updated_at: string;
};

type AutonomousDraftDocumentRow = {
  id: string;
  source_content_work_item_id: string;
  title: string;
  body: string;
  angle: string | null;
  source_summary: string;
  recommended_action: AutonomousDraftDocument["recommendedAction"];
  status: AutonomousDraftDocument["status"];
  created_at: string;
  updated_at: string;
};

function parseTags(value: string | null): string[] {
  if (!value) {
    return [];
  }
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed)
    ? parsed.filter((tag): tag is string => typeof tag === "string")
    : [];
}

function parseJsonRecord<T>(value: string | null): T | undefined {
  if (!value) {
    return undefined;
  }

  const parsed: unknown = JSON.parse(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as T)
    : undefined;
}

function mapSignal(row: SignalRow): Signal {
  return {
    id: row.id,
    title: row.title,
    sourceType: row.source_type,
    rawText: row.raw_text,
    ...(row.source_url ? { sourceUrl: row.source_url } : {}),
    ...(row.source_domain ? { sourceDomain: row.source_domain } : {}),
    ...(row.source_title ? { sourceTitle: row.source_title } : {}),
    ...(row.source_author_or_owner ? { sourceAuthorOrOwner: row.source_author_or_owner } : {}),
    ...(row.fetched_at ? { fetchedAt: row.fetched_at } : {}),
    ...(row.language ? { language: row.language } : {}),
    ...(row.normalized_content ? { normalizedContent: row.normalized_content } : {}),
    ...(row.content_hash ? { contentHash: row.content_hash } : {}),
    ...(row.topic_tags_json ? { topicTags: parseTags(row.topic_tags_json) } : {}),
    ...(row.novelty_hint ? { noveltyHint: row.novelty_hint } : {}),
    ...(parseJsonRecord<Record<string, unknown>>(row.source_metadata_json)
      ? {
          sourceMetadataJson: parseJsonRecord<Record<string, unknown>>(
            row.source_metadata_json
          )
        }
      : {}),
    status: row.status,
    createdAt: row.created_at
  };
}

function mapIdea(row: IdeaRow): Idea {
  return {
    id: row.id,
    signalId: row.signal_id,
    title: row.title,
    coreInsight: row.core_insight,
    businessRelevance: row.business_relevance,
    targetAudience: row.target_audience,
    status: row.status,
    ...(row.source_content_work_item_id
      ? { sourceContentWorkItemId: row.source_content_work_item_id }
      : {}),
    ...(row.source_matched_opportunity_id
      ? { sourceMatchedOpportunityId: row.source_matched_opportunity_id }
      : {}),
    createdAt: row.created_at
  };
}

function mapContentAsset(row: ContentAssetRow): ContentAsset {
  return {
    id: row.id,
    ideaId: row.idea_id,
    ...(row.orchestrator_decision_id
      ? { orchestratorDecisionId: row.orchestrator_decision_id }
      : {}),
    ...(row.signal_id ? { signalId: row.signal_id } : {}),
    ...(row.signal_analysis_id ? { signalAnalysisId: row.signal_analysis_id } : {}),
    ...(row.source_content_work_item_id
      ? { sourceContentWorkItemId: row.source_content_work_item_id }
      : {}),
    ...(row.source_matched_opportunity_id
      ? { sourceMatchedOpportunityId: row.source_matched_opportunity_id }
      : {}),
    contentType: row.content_type,
    hook: row.hook,
    body: row.body,
    cta: row.cta,
    ...(row.best_angle ? { bestAngle: row.best_angle } : {}),
    ...(row.alternative_angles_json
      ? { alternativeAnglesJson: parseTags(row.alternative_angles_json) }
      : {}),
    ...(row.recommended_format
      ? { recommendedFormat: row.recommended_format as ContentAsset["recommendedFormat"] }
      : {}),
    ...(row.long_post_draft ? { longPostDraft: row.long_post_draft } : {}),
    ...(row.short_post_draft ? { shortPostDraft: row.short_post_draft } : {}),
    ...(row.hooks_json ? { hooksJson: parseTags(row.hooks_json) } : {}),
    ...(row.comment_angles_json
      ? { commentAnglesJson: parseTags(row.comment_angles_json) }
      : {}),
    ...(row.cta_variants_json ? { ctaVariantsJson: parseTags(row.cta_variants_json) } : {}),
    ...(row.carousel_outline ? { carouselOutline: row.carousel_outline } : {}),
    ...(row.content_status
      ? { contentStatus: row.content_status as ContentAsset["contentStatus"] }
      : {}),
    ...(row.publish_ready_flag === null
      ? {}
      : { publishReadyFlag: row.publish_ready_flag === 1 }),
    status: row.status,
    refinedHook: row.refined_hook ?? undefined,
    refinedBody: row.refined_body ?? undefined,
    refinedCta: row.refined_cta ?? undefined,
    refinementStatus: row.refinement_status ?? undefined,
    finalHook: row.final_hook ?? undefined,
    finalBody: row.final_body ?? undefined,
    finalClosing: row.final_closing ?? undefined,
    finalStatus: row.final_status ?? undefined,
    finalQualityScore: row.final_quality_score ?? undefined,
    qualityStatus: row.quality_status ?? undefined,
    overallQualityScore: row.overall_quality_score ?? undefined,
    brandVoiceProfileId: row.brand_voice_profile_id ?? undefined,
    createdAt: row.created_at
  };
}

function mapVisualAsset(row: VisualAssetRow): VisualAsset {
  return {
    id: row.id,
    contentAssetId: row.content_asset_id,
    title: row.title,
    visualType: row.visual_type,
    prompt: row.prompt,
    status: row.status,
    createdAt: row.created_at
  };
}

function mapAnalyticsSnapshot(row: AnalyticsSnapshotRow): AnalyticsSnapshot {
  return {
    id: row.id,
    contentAssetId: row.content_asset_id,
    ...(row.post_url ? { postUrl: row.post_url } : {}),
    ...(row.platform ? { platform: row.platform as AnalyticsSnapshot["platform"] } : {}),
    ...(row.published_at ? { publishedAt: row.published_at } : {}),
    ...(row.audience_geo_hint ? { audienceGeoHint: row.audience_geo_hint } : {}),
    ...(row.audience_segment ? { audienceSegment: row.audience_segment } : {}),
    impressions: row.impressions,
    likes: row.likes,
    comments: row.comments,
    saves: row.saves,
    ...(row.reactions !== null ? { reactions: row.reactions } : {}),
    ...(row.reposts !== null ? { reposts: row.reposts } : {}),
    profileViews: row.profile_views,
    followersGained: row.followers_gained,
    ...(row.inbound_leads !== null ? { inboundLeads: row.inbound_leads } : {}),
    ...(row.qualitative_notes ? { qualitativeNotes: row.qualitative_notes } : {}),
    createdAt: row.created_at
  };
}

function mapStrategyRecommendation(
  row: StrategyRecommendationRow
): StrategyRecommendation {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    description: row.description,
    priority: row.priority,
    createdAt: row.created_at
  };
}

function mapSourceItem(row: SourceItemRow): SourceItem {
  return {
    id: row.id,
    title: row.title,
    sourceType: row.source_type,
    sourceUrl: row.source_url ?? undefined,
    rawText: row.raw_text,
    normalizedSummary: row.normalized_summary,
    tags: parseTags(row.tags_json),
    status: row.status,
    createdAt: row.created_at
  };
}

function mapMarketProfile(row: MarketProfileRow): MarketProfile {
  return {
    id: row.id,
    country: row.country,
    region: row.region,
    primaryLanguage: row.primary_language,
    marketNote: row.market_note,
    linkedinPriority: row.linkedin_priority,
    serviceFitScore: row.service_fit_score,
    createdAt: row.created_at
  };
}

function mapTopicScore(row: TopicScoreRow): TopicScore {
  return {
    id: row.id,
    topicLabel: row.topic_label,
    sourceItemId: row.source_item_id ?? undefined,
    ideaId: row.idea_id ?? undefined,
    marketProfileId: row.market_profile_id ?? undefined,
    brandRelevanceScore: row.brand_relevance_score,
    marketRelevanceScore: row.market_relevance_score,
    noveltyScore: row.novelty_score,
    priorityScore: row.priority_score,
    rationale: row.rationale,
    createdAt: row.created_at
  };
}

function mapContentQueueItem(row: ContentQueueItemRow): ContentQueueItem {
  return {
    id: row.id,
    topicScoreId: row.topic_score_id,
    recommendedAction: row.recommended_action,
    priority: row.priority,
    reason: row.reason,
    status: row.status,
    createdAt: row.created_at
  };
}

function mapCandidateQueueItem(row: CandidateQueueItemRow): CandidateQueueItem {
  return {
    id: row.id,
    signalId: row.signal_id,
    signalAnalysisId: row.signal_analysis_id,
    ...(row.content_asset_id ? { contentAssetId: row.content_asset_id } : {}),
    ...(row.critic_review_id ? { criticReviewId: row.critic_review_id } : {}),
    ...(row.solution_memory_id ? { solutionMemoryId: row.solution_memory_id } : {}),
    orchestratorDecisionId: row.orchestrator_decision_id,
    candidateType: row.candidate_type,
    queueState: row.queue_state,
    ...(row.priority_score !== null ? { priorityScore: row.priority_score } : {}),
    priorityLabel: row.priority_label,
    whyQueued: row.why_queued,
    nextAction: row.next_action,
    requiresHumanReview: row.requires_human_review === 1,
    ...(row.operator_note ? { operatorNote: row.operator_note } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapBrandVoiceProfile(row: BrandVoiceProfileRow): BrandVoiceProfile {
  return {
    id: row.id,
    name: row.name,
    tone: row.tone,
    audience: row.audience,
    writingRules: parseTags(row.writing_rules_json),
    bannedPatterns: parseTags(row.banned_patterns_json),
    preferredPatterns: parseTags(row.preferred_patterns_json),
    styleNotes: row.style_notes,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapWritingQualityAssessment(
  row: WritingQualityAssessmentRow
): WritingQualityAssessment {
  return {
    id: row.id,
    contentAssetId: row.content_asset_id,
    humanToneScore: row.human_tone_score,
    clarityScore: row.clarity_score,
    groundednessScore: row.groundedness_score,
    antiRobotScore: row.anti_robot_score,
    overallScore: row.overall_score,
    notes: parseTags(row.notes_json),
    ...(row.quality_score !== null ? { qualityScore: row.quality_score } : {}),
    ...(row.genericness_score !== null ? { genericnessScore: row.genericness_score } : {}),
    ...(row.business_value_score !== null
      ? { businessValueScore: row.business_value_score }
      : {}),
    ...(row.differentiation_score !== null
      ? { differentiationScore: row.differentiation_score }
      : {}),
    ...(row.publish_ready_flag === null
      ? {}
      : { publishReadyFlag: row.publish_ready_flag === 1 }),
    ...(row.rewrite_suggestions_json
      ? { rewriteSuggestions: parseTags(row.rewrite_suggestions_json) }
      : {}),
    ...(row.critic_notes ? { criticNotes: row.critic_notes } : {}),
    createdAt: row.created_at
  };
}

function mapSignalAnalysis(row: SignalAnalysisRow): SignalAnalysis {
  return {
    id: row.id,
    signalId: row.signal_id,
    relevanceScore: row.relevance_score,
    whyRelevant: row.why_relevant,
    targetAudience: row.target_audience,
    businessValueSummary: row.business_value_summary,
    painsSolved: parseTags(row.pains_solved_json),
    practicalImplications: parseTags(row.practical_implications_json),
    overhypeNotes: row.overhype_notes ?? undefined,
    recommendedPillar: row.recommended_pillar ?? undefined,
    uniquenessScore: row.uniqueness_score,
    uniquenessReason: row.uniqueness_reason,
    buildabilityScore: row.buildability_score,
    buildabilityReason: row.buildability_reason,
    popularityPotentialScore: row.popularity_potential_score,
    brandGrowthPotentialScore: row.brand_growth_potential_score,
    bestAngle: row.best_angle ?? undefined,
    alternativeAnglesJson: parseTags(row.alternative_angles_json),
    recommendedFormat: row.recommended_format ?? undefined,
    audienceEmphasis: row.audience_emphasis ?? undefined,
    toneGuidance: row.tone_guidance ?? undefined,
    recommendedPillarFinal: row.recommended_pillar_final ?? undefined,
    reasoningJson: parseJsonRecord<Record<string, unknown>>(row.reasoning_json),
    createdAt: row.created_at
  };
}

function mapSolutionMemory(row: SolutionMemoryRow): SolutionMemory {
  return {
    id: row.id,
    signalId: row.signal_id,
    sourceType: row.source_type,
    implementationPotential: row.implementation_potential,
    implementationComplexity: row.implementation_complexity,
    detectedStack: parseTags(row.detected_stack_json),
    keyFeatures: parseTags(row.key_features_json),
    architectureClues: parseTags(row.architecture_clues_json),
    deploymentHints: parseTags(row.deployment_hints_json),
    clientFitTypes: parseTags(row.client_fit_types_json),
    possibleUseCases: parseTags(row.possible_use_cases_json),
    adaptationNotes: row.adaptation_notes ?? undefined,
    repoReference: row.repo_reference ?? undefined,
    readmeSnapshot: row.readme_snapshot ?? undefined,
    implementationNotes: row.implementation_notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapMemoryPattern(row: MemoryPatternRow): MemoryPattern {
  return {
    id: row.id,
    patternType: row.pattern_type,
    patternKey: row.pattern_key,
    strengthScore: row.strength_score,
    supportingEvidenceJson: parseJsonRecord<Record<string, unknown>>(row.supporting_evidence_json),
    recommendedAction: row.recommended_action,
    lastUpdatedAt: row.last_updated_at
  };
}

function mapOrchestratorDecision(row: OrchestratorDecisionRow): OrchestratorDecision {
  return {
    id: row.id,
    signalId: row.signal_id,
    decisionType: row.decision_type,
    decisionReason: row.decision_reason,
    confidenceScore: row.confidence_score,
    nextAction: row.next_action,
    requiresHumanReview: row.requires_human_review === 1,
    createdAt: row.created_at
  };
}

function mapAgentRun(row: AgentRunRow): AgentRun {
  return {
    id: row.id,
    signalId: row.signal_id,
    agentName: row.agent_name,
    modelTier: row.model_tier ?? undefined,
    providerName: row.provider_name ?? undefined,
    status: row.status,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
    inputSummary: row.input_summary ?? undefined,
    outputSummary: row.output_summary ?? undefined,
    errorMessage: row.error_message ?? undefined
  };
}

function mapAutonomousWatchlist(row: AutonomousWatchlistRow): AutonomousWatchlist {
  return {
    id: row.id,
    sourceKind: row.source_kind,
    label: row.label,
    sourceUrl: row.source_url ?? undefined,
    notes: row.notes ?? undefined,
    seedExcerpt: row.seed_excerpt,
    targetProblem: row.target_problem ?? undefined,
    refreshCadence: row.refresh_cadence,
    priority: row.priority ?? undefined,
    isActive: row.is_active === 1,
    autoPromotionRules: row.auto_promotion_rules_json
      ? JSON.parse(row.auto_promotion_rules_json)
      : undefined,
    lastRunAt: row.last_run_at ?? undefined,
    nextRunAt: row.next_run_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapAutonomousRun(row: AutonomousRunRow): AutonomousRun {
  const compatibilityWatchlistId =
    row.run_type === "signal_pipeline" && row.watchlist_id === row.signal_id
      ? undefined
      : row.watchlist_id ?? undefined;
  return {
    id: row.id,
    watchlistId: compatibilityWatchlistId,
    signalId: row.signal_id ?? undefined,
    triggerType: row.trigger_type,
    runType: row.run_type,
    status: row.status,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    errorSummary: row.error_summary ?? undefined,
    resultSummary: row.result_summary ?? undefined,
    resultMetadata: parseJsonRecord<NonNullable<AutonomousRun["resultMetadata"]>>(
      row.result_metadata_json
    ),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapAutonomousIngestionArtifact(
  row: AutonomousIngestionArtifactRow
): AutonomousIngestionArtifact {
  return {
    id: row.id,
    watchlistId: row.watchlist_id,
    autonomousRunId: row.autonomous_run_id,
    sourceType: row.source_type,
    sourceUrl: row.source_url ?? undefined,
    title: row.title,
    rawText: row.raw_text,
    normalizedSignalText: row.normalized_signal_text ?? undefined,
    suggestedAngle: row.suggested_angle ?? undefined,
    reasoningSummary: row.reasoning_summary ?? undefined,
    status: row.status,
    errorSummary: row.error_summary ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapAutonomousReviewQueueItem(
  row: AutonomousReviewQueueItemRow
): AutonomousReviewQueueItem {
  return {
    id: row.id,
    watchlistId: row.watchlist_id,
    autonomousRunId: row.autonomous_run_id,
    sourceArtifactId: row.source_artifact_id ?? undefined,
    sourceKind: row.source_kind,
    dedupeKey: row.dedupe_key,
    title: row.title,
    summary: row.summary,
    rationale: row.rationale,
    recommendedAction: row.recommended_action,
    status: row.status,
    aiEnrichment: parseJsonRecord<NonNullable<AutonomousReviewQueueItem["aiEnrichment"]>>(
      row.ai_enrichment_json
    ),
    aiContent: parseJsonRecord<NonNullable<AutonomousReviewQueueItem["aiContent"]>>(
      row.ai_content_json
    ),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapAutonomousMatchedOpportunity(
  row: AutonomousMatchedOpportunityRow
): AutonomousMatchedOpportunity {
  return {
    id: row.id,
    watchlistId: row.watchlist_id,
    autonomousRunId: row.autonomous_run_id,
    audienceQueueItemId: row.audience_queue_item_id,
    solutionQueueItemId: row.solution_queue_item_id,
    dedupeKey: row.dedupe_key,
    title: row.title,
    matchedPain: row.matched_pain,
    matchedSolutionPattern: row.matched_solution_pattern,
    matchRationale: row.match_rationale,
    suggestedAngle: row.suggested_angle,
    recommendedAction: row.recommended_action,
    priorityScore: row.priority_score,
    priorityBand: row.priority_band,
    reasonLines: parseTags(row.reason_lines_json),
    confidence: row.confidence,
    opportunityStrength: row.opportunity_strength ?? undefined,
    scoreNotes: row.score_notes_json ? parseTags(row.score_notes_json) : undefined,
    status: row.status,
    reviewState: row.review_state,
    reviewedAt: row.reviewed_at ?? undefined,
    reviewNote: row.review_note ?? undefined,
    aiEnrichment: parseJsonRecord<NonNullable<AutonomousMatchedOpportunity["aiEnrichment"]>>(
      row.ai_enrichment_json
    ),
    aiContent: parseJsonRecord<NonNullable<AutonomousMatchedOpportunity["aiContent"]>>(
      row.ai_content_json
    ),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapAutonomousContentWorkItem(
  row: AutonomousContentWorkItemRow
): AutonomousContentWorkItem {
  return {
    id: row.id,
    sourceMatchedOpportunityId: row.source_matched_opportunity_id,
    watchlistId: row.watchlist_id,
    autonomousRunId: row.autonomous_run_id,
    workItemKind: row.work_item_kind,
    title: row.title,
    summary: row.summary,
    rationale: row.rationale,
    recommendedAction: row.recommended_action,
    priorityScore: row.priority_score,
    priorityBand: row.priority_band,
    reviewState: row.review_state,
    status: row.status,
    stateChangedAt: row.state_changed_at ?? undefined,
    workNote: row.work_note ?? undefined,
    aiContent: parseJsonRecord<NonNullable<AutonomousContentWorkItem["aiContent"]>>(
      row.ai_content_json
    ),
    draftSeed: parseJsonRecord<NonNullable<AutonomousContentWorkItem["draftSeed"]>>(
      row.draft_seed_json
    ),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapAutonomousDraftDocument(
  row: AutonomousDraftDocumentRow
): AutonomousDraftDocument {
  return {
    id: row.id,
    sourceContentWorkItemId: row.source_content_work_item_id,
    title: row.title,
    body: row.body,
    angle: row.angle ?? undefined,
    sourceSummary: row.source_summary,
    recommendedAction: row.recommended_action,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class SqliteDatabase
  implements SignalsRepository, IdeasRepository, ContentAssetsRepository
{
  private readonly client: Database.Database;
  readonly databasePath: string;

  constructor(options: SqliteDatabaseOptions = {}) {
    this.databasePath = options.databasePath ?? getDefaultDatabasePath();
    this.client = createSqliteClient({ databasePath: this.databasePath });
    this.initSync();
  }

  async initDatabase(): Promise<void> {
    this.initSync();
  }

  async resetDatabase(): Promise<void> {
    const orderedTables = [
      tables.autonomousDraftDocuments,
      tables.autonomousMatchedOpportunities,
      tables.autonomousContentWorkItems,
      tables.autonomousReviewQueueItems,
      tables.autonomousIngestionArtifacts,
      tables.autonomousRuns,
      tables.autonomousWatchlists,
      tables.agentRuns,
      tables.orchestratorDecisions,
      tables.memoryPatterns,
      tables.solutionMemories,
      tables.signalAnalyses,
      tables.writingQualityAssessments,
      tables.brandVoiceProfiles,
      tables.contentQueueItems,
      tables.topicScores,
      tables.marketProfiles,
      tables.sourceItems,
      tables.strategyRecommendations,
      tables.analyticsSnapshots,
      tables.visualAssets,
      tables.contentAssets,
      tables.ideas,
      tables.signals
    ];

    this.client.transaction(() => {
      for (const table of orderedTables) {
        this.client.prepare(`DELETE FROM ${table}`).run();
      }
    })();
  }

  async createSignal(input: CreateSignalInput): Promise<Signal> {
    if (input.contentHash) {
      const existing = this.client
        .prepare(`SELECT * FROM ${tables.signals} WHERE content_hash = ?`)
        .get(input.contentHash) as SignalRow | undefined;

      if (existing) {
        return mapSignal(existing);
      }
    }

    const signal = {
      id: this.nextId(tables.signals, "sig"),
      title: input.title,
      source_type: input.sourceType,
      raw_text: input.rawText,
      source_url: input.sourceUrl ?? null,
      source_domain: input.sourceDomain ?? null,
      source_title: input.sourceTitle ?? null,
      source_author_or_owner: input.sourceAuthorOrOwner ?? null,
      fetched_at: input.fetchedAt ?? null,
      language: input.language ?? null,
      normalized_content: input.normalizedContent ?? null,
      content_hash: input.contentHash ?? null,
      topic_tags_json: input.topicTags ? JSON.stringify(input.topicTags) : null,
      novelty_hint: input.noveltyHint ?? null,
      source_metadata_json: input.sourceMetadataJson
        ? JSON.stringify(input.sourceMetadataJson)
        : null,
      status: "new" as const,
      created_at: new Date().toISOString()
    };

    this.client
      .prepare(
        `INSERT INTO ${tables.signals} (
          id, title, source_type, raw_text, source_url, source_domain, source_title,
          source_author_or_owner, fetched_at, language, normalized_content, content_hash,
          topic_tags_json, novelty_hint, source_metadata_json, status, created_at
        )
         VALUES (
          @id, @title, @source_type, @raw_text, @source_url, @source_domain, @source_title,
          @source_author_or_owner, @fetched_at, @language, @normalized_content, @content_hash,
          @topic_tags_json, @novelty_hint, @source_metadata_json, @status, @created_at
         )`
      )
      .run(signal);

    return mapSignal(signal);
  }

  async listSignals(): Promise<Signal[]> {
    const rows = this.client
      .prepare(`SELECT * FROM ${tables.signals} ORDER BY created_at ASC`)
      .all() as SignalRow[];
    return rows.map(mapSignal);
  }

  async getSignalById(id: string): Promise<Signal | null> {
    const row = this.client
      .prepare(`SELECT * FROM ${tables.signals} WHERE id = ?`)
      .get(id) as SignalRow | undefined;
    return row ? mapSignal(row) : null;
  }

  async createSignalAnalysis(
    input: CreateSignalAnalysisRecord
  ): Promise<SignalAnalysis> {
    const analysis: SignalAnalysisRow = {
      id: this.nextId(tables.signalAnalyses, "signal-analysis"),
      signal_id: input.signalId,
      relevance_score: input.relevanceScore,
      why_relevant: input.whyRelevant,
      target_audience: input.targetAudience,
      business_value_summary: input.businessValueSummary,
      pains_solved_json: JSON.stringify(input.painsSolved),
      practical_implications_json: JSON.stringify(input.practicalImplications),
      overhype_notes: input.overhypeNotes ?? null,
      recommended_pillar: input.recommendedPillar ?? null,
      uniqueness_score: input.uniquenessScore,
      uniqueness_reason: input.uniquenessReason,
      buildability_score: input.buildabilityScore,
      buildability_reason: input.buildabilityReason,
      popularity_potential_score: input.popularityPotentialScore,
      brand_growth_potential_score: input.brandGrowthPotentialScore,
      best_angle: input.bestAngle ?? null,
      alternative_angles_json: input.alternativeAnglesJson
        ? JSON.stringify(input.alternativeAnglesJson)
        : null,
      recommended_format: input.recommendedFormat ?? null,
      audience_emphasis: input.audienceEmphasis ?? null,
      tone_guidance: input.toneGuidance ?? null,
      recommended_pillar_final: input.recommendedPillarFinal ?? null,
      reasoning_json: input.reasoningJson ? JSON.stringify(input.reasoningJson) : null,
      created_at: new Date().toISOString()
    };

    this.client
      .prepare(
        `INSERT INTO ${tables.signalAnalyses} (
          id, signal_id, relevance_score, why_relevant, target_audience,
          business_value_summary, pains_solved_json, practical_implications_json,
          overhype_notes, recommended_pillar, uniqueness_score, uniqueness_reason,
          buildability_score, buildability_reason, popularity_potential_score,
          brand_growth_potential_score, best_angle, alternative_angles_json, recommended_format,
          audience_emphasis, tone_guidance, recommended_pillar_final, reasoning_json, created_at
        ) VALUES (
          @id, @signal_id, @relevance_score, @why_relevant, @target_audience,
          @business_value_summary, @pains_solved_json, @practical_implications_json,
          @overhype_notes, @recommended_pillar, @uniqueness_score, @uniqueness_reason,
          @buildability_score, @buildability_reason, @popularity_potential_score,
          @brand_growth_potential_score, @best_angle, @alternative_angles_json, @recommended_format,
          @audience_emphasis, @tone_guidance, @recommended_pillar_final, @reasoning_json, @created_at
        )`
      )
      .run(analysis);

    return mapSignalAnalysis(analysis);
  }

  async updateSignalAnalysis(
    id: string,
    input: UpdateSignalAnalysisInput
  ): Promise<SignalAnalysis | null> {
    const existing = this.client
      .prepare(`SELECT * FROM ${tables.signalAnalyses} WHERE id = ?`)
      .get(id) as SignalAnalysisRow | undefined;

    if (!existing) {
      return null;
    }

    const updated: SignalAnalysisRow = {
      ...existing,
      relevance_score: input.relevanceScore ?? existing.relevance_score,
      why_relevant: input.whyRelevant ?? existing.why_relevant,
      target_audience: input.targetAudience ?? existing.target_audience,
      business_value_summary:
        input.businessValueSummary ?? existing.business_value_summary,
      pains_solved_json:
        input.painsSolved !== undefined
          ? JSON.stringify(input.painsSolved)
          : existing.pains_solved_json,
      practical_implications_json:
        input.practicalImplications !== undefined
          ? JSON.stringify(input.practicalImplications)
          : existing.practical_implications_json,
      overhype_notes:
        input.overhypeNotes !== undefined ? input.overhypeNotes : existing.overhype_notes,
      recommended_pillar:
        input.recommendedPillar !== undefined
          ? input.recommendedPillar
          : existing.recommended_pillar,
      uniqueness_score: input.uniquenessScore ?? existing.uniqueness_score,
      uniqueness_reason: input.uniquenessReason ?? existing.uniqueness_reason,
      buildability_score: input.buildabilityScore ?? existing.buildability_score,
      buildability_reason: input.buildabilityReason ?? existing.buildability_reason,
      popularity_potential_score:
        input.popularityPotentialScore ?? existing.popularity_potential_score,
      brand_growth_potential_score:
        input.brandGrowthPotentialScore ?? existing.brand_growth_potential_score,
      best_angle: input.bestAngle !== undefined ? input.bestAngle : existing.best_angle,
      alternative_angles_json:
        input.alternativeAnglesJson !== undefined
          ? JSON.stringify(input.alternativeAnglesJson)
          : existing.alternative_angles_json,
      recommended_format:
        input.recommendedFormat !== undefined
          ? input.recommendedFormat
          : existing.recommended_format,
      audience_emphasis:
        input.audienceEmphasis !== undefined
          ? input.audienceEmphasis
          : existing.audience_emphasis,
      tone_guidance:
        input.toneGuidance !== undefined ? input.toneGuidance : existing.tone_guidance,
      recommended_pillar_final:
        input.recommendedPillarFinal !== undefined
          ? input.recommendedPillarFinal
          : existing.recommended_pillar_final,
      reasoning_json:
        input.reasoningJson !== undefined
          ? JSON.stringify(input.reasoningJson)
          : existing.reasoning_json
    };

    this.client
      .prepare(
        `UPDATE ${tables.signalAnalyses}
         SET relevance_score = @relevance_score,
             why_relevant = @why_relevant,
             target_audience = @target_audience,
             business_value_summary = @business_value_summary,
             pains_solved_json = @pains_solved_json,
             practical_implications_json = @practical_implications_json,
             overhype_notes = @overhype_notes,
             recommended_pillar = @recommended_pillar,
             uniqueness_score = @uniqueness_score,
             uniqueness_reason = @uniqueness_reason,
             buildability_score = @buildability_score,
             buildability_reason = @buildability_reason,
             popularity_potential_score = @popularity_potential_score,
             brand_growth_potential_score = @brand_growth_potential_score,
             best_angle = @best_angle,
             alternative_angles_json = @alternative_angles_json,
             recommended_format = @recommended_format,
             audience_emphasis = @audience_emphasis,
             tone_guidance = @tone_guidance,
             recommended_pillar_final = @recommended_pillar_final,
             reasoning_json = @reasoning_json
         WHERE id = @id`
      )
      .run(updated);

    return mapSignalAnalysis(updated);
  }

  async listSignalAnalyses(): Promise<SignalAnalysis[]> {
    const rows = this.client
      .prepare(`SELECT * FROM ${tables.signalAnalyses} ORDER BY created_at ASC`)
      .all() as SignalAnalysisRow[];
    return rows.map(mapSignalAnalysis);
  }

  async listSignalAnalysesBySignalId(signalId: string): Promise<SignalAnalysis[]> {
    const rows = this.client
      .prepare(
        `SELECT * FROM ${tables.signalAnalyses}
         WHERE signal_id = ?
         ORDER BY created_at ASC`
      )
      .all(signalId) as SignalAnalysisRow[];
    return rows.map(mapSignalAnalysis);
  }

  async createIdea(input: CreateIdeaRecord): Promise<Idea> {
    const idea = {
      id: this.nextId(tables.ideas, "idea"),
      signal_id: input.signalId,
      title: input.title,
      core_insight: input.coreInsight,
      business_relevance: input.businessRelevance,
      target_audience: input.targetAudience,
      status: input.status,
      source_content_work_item_id: input.sourceContentWorkItemId ?? null,
      source_matched_opportunity_id: input.sourceMatchedOpportunityId ?? null,
      created_at: new Date().toISOString()
    };

    this.client
      .prepare(
        `INSERT INTO ${tables.ideas} (
          id, signal_id, title, core_insight, business_relevance, target_audience, status,
          source_content_work_item_id, source_matched_opportunity_id, created_at
        ) VALUES (
          @id, @signal_id, @title, @core_insight, @business_relevance, @target_audience, @status,
          @source_content_work_item_id, @source_matched_opportunity_id, @created_at
        )`
      )
      .run(idea);

    return mapIdea(idea);
  }

  async listIdeas(): Promise<Idea[]> {
    const rows = this.client
      .prepare(`SELECT * FROM ${tables.ideas} ORDER BY created_at ASC`)
      .all() as IdeaRow[];
    return rows.map(mapIdea);
  }

  async getIdeaById(id: string): Promise<Idea | null> {
    const row = this.client
      .prepare(`SELECT * FROM ${tables.ideas} WHERE id = ?`)
      .get(id) as IdeaRow | undefined;
    return row ? mapIdea(row) : null;
  }

  async createContentAsset(input: CreateContentAssetRecord): Promise<ContentAsset> {
    const linkedIdea = this.client
      .prepare(`SELECT * FROM ${tables.ideas} WHERE id = ?`)
      .get(input.ideaId) as IdeaRow | undefined;
    const asset = {
      id: this.nextId(tables.contentAssets, "content"),
      idea_id: input.ideaId,
      orchestrator_decision_id: input.orchestratorDecisionId ?? null,
      signal_id: input.signalId ?? linkedIdea?.signal_id ?? null,
      signal_analysis_id: input.signalAnalysisId ?? null,
      source_content_work_item_id: input.sourceContentWorkItemId ?? null,
      source_matched_opportunity_id: input.sourceMatchedOpportunityId ?? null,
      content_type: input.contentType,
      hook: input.hook,
      body: input.body,
      cta: input.cta,
      best_angle: input.bestAngle ?? null,
      alternative_angles_json: input.alternativeAnglesJson
        ? JSON.stringify(input.alternativeAnglesJson)
        : null,
      recommended_format: input.recommendedFormat ?? null,
      long_post_draft: input.longPostDraft ?? null,
      short_post_draft: input.shortPostDraft ?? null,
      hooks_json: input.hooksJson ? JSON.stringify(input.hooksJson) : null,
      comment_angles_json: input.commentAnglesJson
        ? JSON.stringify(input.commentAnglesJson)
        : null,
      cta_variants_json: input.ctaVariantsJson ? JSON.stringify(input.ctaVariantsJson) : null,
      carousel_outline: input.carouselOutline ?? null,
      content_status: input.contentStatus ?? null,
      publish_ready_flag:
        input.publishReadyFlag === undefined ? null : input.publishReadyFlag ? 1 : 0,
      status: input.status,
      refined_hook: null,
      refined_body: null,
      refined_cta: null,
      refinement_status: null,
      final_hook: input.finalHook ?? null,
      final_body: input.finalBody ?? null,
      final_closing: input.finalClosing ?? null,
      final_status: input.finalStatus ?? null,
      final_quality_score: input.finalQualityScore ?? null,
      quality_status: input.qualityStatus ?? null,
      overall_quality_score: input.overallQualityScore ?? null,
      brand_voice_profile_id: input.brandVoiceProfileId ?? null,
      created_at: new Date().toISOString()
    };

    this.client
      .prepare(
        `INSERT INTO ${tables.contentAssets} (
          id, idea_id, orchestrator_decision_id, signal_id, signal_analysis_id,
          source_content_work_item_id, source_matched_opportunity_id,
          content_type, hook, body, cta,
          best_angle, alternative_angles_json, recommended_format, long_post_draft, short_post_draft,
          hooks_json, comment_angles_json, cta_variants_json, carousel_outline, content_status,
          publish_ready_flag, status,
          refined_hook, refined_body, refined_cta, refinement_status,
          final_hook, final_body, final_closing, final_status, final_quality_score,
          quality_status, overall_quality_score, brand_voice_profile_id, created_at
        ) VALUES (
          @id, @idea_id, @orchestrator_decision_id, @signal_id, @signal_analysis_id,
          @source_content_work_item_id, @source_matched_opportunity_id,
          @content_type, @hook, @body, @cta,
          @best_angle, @alternative_angles_json, @recommended_format, @long_post_draft, @short_post_draft,
          @hooks_json, @comment_angles_json, @cta_variants_json, @carousel_outline, @content_status,
          @publish_ready_flag, @status,
          @refined_hook, @refined_body, @refined_cta, @refinement_status,
          @final_hook, @final_body, @final_closing, @final_status, @final_quality_score,
          @quality_status, @overall_quality_score, @brand_voice_profile_id, @created_at
        )`
      )
      .run(asset);

    return mapContentAsset(asset);
  }

  async listContentAssets(): Promise<ContentAsset[]> {
    const rows = this.client
      .prepare(`SELECT * FROM ${tables.contentAssets} ORDER BY created_at ASC`)
      .all() as ContentAssetRow[];
    return rows.map(mapContentAsset);
  }

  async getContentAssetById(id: string): Promise<ContentAsset | null> {
    const row = this.client
      .prepare(`SELECT * FROM ${tables.contentAssets} WHERE id = ?`)
      .get(id) as ContentAssetRow | undefined;
    return row ? mapContentAsset(row) : null;
  }

  async updateContentAssetCriticState(
    id: string,
    criticState: Pick<
      ContentAsset,
      "contentStatus" | "publishReadyFlag" | "qualityStatus" | "overallQualityScore"
    >
  ): Promise<ContentAsset | null> {
    this.client
      .prepare(
        `UPDATE ${tables.contentAssets}
         SET content_status = @content_status,
             publish_ready_flag = @publish_ready_flag,
             quality_status = @quality_status,
             overall_quality_score = @overall_quality_score
         WHERE id = @id`
      )
      .run({
        id,
        content_status: criticState.contentStatus ?? null,
        publish_ready_flag:
          criticState.publishReadyFlag === undefined
            ? null
            : criticState.publishReadyFlag
              ? 1
              : 0,
        quality_status: criticState.qualityStatus ?? null,
        overall_quality_score: criticState.overallQualityScore ?? null
      });

    return this.getContentAssetById(id);
  }

  async updateContentAssetRefinement(
    id: string,
    refinement: Pick<
      ContentAsset,
      | "refinedHook"
      | "refinedBody"
      | "refinedCta"
      | "refinementStatus"
      | "qualityStatus"
      | "overallQualityScore"
      | "brandVoiceProfileId"
    >
  ): Promise<ContentAsset | null> {
    const result = this.client
      .prepare(
        `UPDATE ${tables.contentAssets}
         SET refined_hook = @refined_hook,
             refined_body = @refined_body,
             refined_cta = @refined_cta,
             refinement_status = @refinement_status,
             quality_status = @quality_status,
             overall_quality_score = @overall_quality_score,
             brand_voice_profile_id = @brand_voice_profile_id
         WHERE id = @id`
      )
      .run({
        id,
        refined_hook: refinement.refinedHook ?? null,
        refined_body: refinement.refinedBody ?? null,
        refined_cta: refinement.refinedCta ?? null,
        refinement_status: refinement.refinementStatus ?? null,
        quality_status: refinement.qualityStatus ?? null,
        overall_quality_score: refinement.overallQualityScore ?? null,
        brand_voice_profile_id: refinement.brandVoiceProfileId ?? null
      });

    if (result.changes === 0) {
      return null;
    }

    return this.getContentAssetById(id);
  }

  async updateContentAssetFinalPost(
    id: string,
    finalPost: Pick<
      ContentAsset,
      "finalHook" | "finalBody" | "finalClosing" | "finalStatus" | "finalQualityScore"
    >
  ): Promise<ContentAsset | null> {
    const result = this.client
      .prepare(
        `UPDATE ${tables.contentAssets}
         SET final_hook = @final_hook,
             final_body = @final_body,
             final_closing = @final_closing,
             final_status = @final_status,
             final_quality_score = @final_quality_score
         WHERE id = @id`
      )
      .run({
        id,
        final_hook: finalPost.finalHook ?? null,
        final_body: finalPost.finalBody ?? null,
        final_closing: finalPost.finalClosing ?? null,
        final_status: finalPost.finalStatus ?? null,
        final_quality_score: finalPost.finalQualityScore ?? null
      });

    if (result.changes === 0) {
      return null;
    }

    return this.getContentAssetById(id);
  }

  async createVisualAsset(input: CreateVisualAssetRecord): Promise<VisualAsset> {
    const visual = {
      id: this.nextId(tables.visualAssets, "visual"),
      content_asset_id: input.contentAssetId,
      title: input.title,
      visual_type: input.visualType,
      prompt: input.prompt,
      status: input.status,
      created_at: new Date().toISOString()
    };

    this.client
      .prepare(
        `INSERT INTO ${tables.visualAssets} (
          id, content_asset_id, title, visual_type, prompt, status, created_at
        ) VALUES (
          @id, @content_asset_id, @title, @visual_type, @prompt, @status, @created_at
        )`
      )
      .run(visual);

    return mapVisualAsset(visual);
  }

  async listVisualAssets(): Promise<VisualAsset[]> {
    const rows = this.client
      .prepare(`SELECT * FROM ${tables.visualAssets} ORDER BY created_at ASC`)
      .all() as VisualAssetRow[];
    return rows.map(mapVisualAsset);
  }

  async createAnalyticsSnapshot(
    input: CreateAnalyticsSnapshotInput
  ): Promise<AnalyticsSnapshot> {
    const snapshot = {
      id: this.nextId(tables.analyticsSnapshots, "analytics"),
      content_asset_id: input.contentAssetId,
      post_url: input.postUrl ?? null,
      platform: input.platform ?? null,
      published_at: input.publishedAt ?? null,
      audience_geo_hint: input.audienceGeoHint ?? null,
      audience_segment: input.audienceSegment ?? null,
      impressions: input.impressions,
      likes: input.likes,
      comments: input.comments,
      saves: input.saves,
      reactions: input.reactions ?? null,
      reposts: input.reposts ?? null,
      profile_views: input.profileViews,
      followers_gained: input.followersGained,
      inbound_leads: input.inboundLeads ?? null,
      qualitative_notes: input.qualitativeNotes ?? null,
      created_at: new Date().toISOString()
    };

    this.client
      .prepare(
        `INSERT INTO ${tables.analyticsSnapshots} (
          id, content_asset_id, post_url, platform, published_at, audience_geo_hint,
          audience_segment, impressions, likes, comments, saves, reactions, reposts,
          profile_views, followers_gained, inbound_leads, qualitative_notes, created_at
        ) VALUES (
          @id, @content_asset_id, @post_url, @platform, @published_at, @audience_geo_hint,
          @audience_segment, @impressions, @likes, @comments, @saves, @reactions, @reposts,
          @profile_views, @followers_gained, @inbound_leads, @qualitative_notes, @created_at
        )`
      )
      .run(snapshot);

    return mapAnalyticsSnapshot(snapshot);
  }

  async listAnalyticsSnapshots(): Promise<AnalyticsSnapshot[]> {
    const rows = this.client
      .prepare(`SELECT * FROM ${tables.analyticsSnapshots} ORDER BY created_at ASC`)
      .all() as AnalyticsSnapshotRow[];
    return rows.map(mapAnalyticsSnapshot);
  }

  async createStrategyRecommendation(
    input: CreateStrategyRecommendationRecord
  ): Promise<StrategyRecommendation> {
    const recommendation = {
      id: this.nextId(tables.strategyRecommendations, "strategy"),
      type: input.type,
      title: input.title,
      description: input.description,
      priority: input.priority,
      created_at: new Date().toISOString()
    };

    this.client
      .prepare(
        `INSERT INTO ${tables.strategyRecommendations} (
          id, type, title, description, priority, created_at
        ) VALUES (
          @id, @type, @title, @description, @priority, @created_at
        )`
      )
      .run(recommendation);

    return mapStrategyRecommendation(recommendation);
  }

  async listStrategyRecommendations(): Promise<StrategyRecommendation[]> {
    const rows = this.client
      .prepare(
        `SELECT * FROM ${tables.strategyRecommendations} ORDER BY created_at ASC`
      )
      .all() as StrategyRecommendationRow[];
    return rows.map(mapStrategyRecommendation);
  }

  async createSourceItem(input: CreateSourceItemRecord): Promise<SourceItem> {
    const item = {
      id: this.nextId(tables.sourceItems, "source"),
      title: input.title,
      source_type: input.sourceType,
      source_url: input.sourceUrl ?? null,
      raw_text: input.rawText,
      normalized_summary: input.normalizedSummary,
      tags_json: JSON.stringify(input.tags),
      status: input.status,
      created_at: new Date().toISOString()
    };

    this.client
      .prepare(
        `INSERT INTO ${tables.sourceItems} (
          id, title, source_type, source_url, raw_text, normalized_summary, tags_json, status, created_at
        ) VALUES (
          @id, @title, @source_type, @source_url, @raw_text, @normalized_summary, @tags_json, @status, @created_at
        )`
      )
      .run(item);

    return mapSourceItem(item);
  }

  async listSourceItems(): Promise<SourceItem[]> {
    const rows = this.client
      .prepare(`SELECT * FROM ${tables.sourceItems} ORDER BY created_at ASC`)
      .all() as SourceItemRow[];
    return rows.map(mapSourceItem);
  }

  async createMarketProfile(
    input: CreateMarketProfileRecord
  ): Promise<MarketProfile> {
    const profile = {
      id: this.nextId(tables.marketProfiles, "market"),
      country: input.country,
      region: input.region,
      primary_language: input.primaryLanguage,
      market_note: input.marketNote,
      linkedin_priority: input.linkedinPriority,
      service_fit_score: input.serviceFitScore,
      created_at: new Date().toISOString()
    };

    this.client
      .prepare(
        `INSERT INTO ${tables.marketProfiles} (
          id, country, region, primary_language, market_note, linkedin_priority, service_fit_score, created_at
        ) VALUES (
          @id, @country, @region, @primary_language, @market_note, @linkedin_priority, @service_fit_score, @created_at
        )`
      )
      .run(profile);

    return mapMarketProfile(profile);
  }

  async listMarketProfiles(): Promise<MarketProfile[]> {
    const rows = this.client
      .prepare(`SELECT * FROM ${tables.marketProfiles} ORDER BY created_at ASC`)
      .all() as MarketProfileRow[];
    return rows.map(mapMarketProfile);
  }

  async createTopicScore(input: CreateTopicScoreRecord): Promise<TopicScore> {
    const score = {
      id: this.nextId(tables.topicScores, "topic"),
      topic_label: input.topicLabel,
      source_item_id: input.sourceItemId ?? null,
      idea_id: input.ideaId ?? null,
      market_profile_id: input.marketProfileId ?? null,
      brand_relevance_score: input.brandRelevanceScore,
      market_relevance_score: input.marketRelevanceScore,
      novelty_score: input.noveltyScore,
      priority_score: input.priorityScore,
      rationale: input.rationale,
      created_at: new Date().toISOString()
    };

    this.client
      .prepare(
        `INSERT INTO ${tables.topicScores} (
          id, topic_label, source_item_id, idea_id, market_profile_id,
          brand_relevance_score, market_relevance_score, novelty_score,
          priority_score, rationale, created_at
        ) VALUES (
          @id, @topic_label, @source_item_id, @idea_id, @market_profile_id,
          @brand_relevance_score, @market_relevance_score, @novelty_score,
          @priority_score, @rationale, @created_at
        )`
      )
      .run(score);

    return mapTopicScore(score);
  }

  async listTopicScores(): Promise<TopicScore[]> {
    const rows = this.client
      .prepare(`SELECT * FROM ${tables.topicScores} ORDER BY created_at ASC`)
      .all() as TopicScoreRow[];
    return rows.map(mapTopicScore);
  }

  async createContentQueueItem(
    input: CreateContentQueueItemRecord
  ): Promise<ContentQueueItem> {
    const queueItem = {
      id: this.nextId(tables.contentQueueItems, "queue"),
      topic_score_id: input.topicScoreId,
      recommended_action: input.recommendedAction,
      priority: input.priority,
      reason: input.reason,
      status: input.status,
      created_at: new Date().toISOString()
    };

    this.client
      .prepare(
        `INSERT INTO ${tables.contentQueueItems} (
          id, topic_score_id, recommended_action, priority, reason, status, created_at
        ) VALUES (
          @id, @topic_score_id, @recommended_action, @priority, @reason, @status, @created_at
        )`
      )
      .run(queueItem);

    return mapContentQueueItem(queueItem);
  }

  async listContentQueueItems(): Promise<ContentQueueItem[]> {
    const rows = this.client
      .prepare(
        `SELECT * FROM ${tables.contentQueueItems} ORDER BY created_at ASC`
      )
      .all() as ContentQueueItemRow[];
    return rows.map(mapContentQueueItem);
  }

  async createCandidateQueueItem(
    input: CreateCandidateQueueItemRecord
  ): Promise<CandidateQueueItem> {
    const now = new Date().toISOString();
    const candidate = {
      id: this.nextId(tables.candidateQueueItems, "candidate"),
      signal_id: input.signalId,
      signal_analysis_id: input.signalAnalysisId,
      content_asset_id: input.contentAssetId ?? null,
      critic_review_id: input.criticReviewId ?? null,
      solution_memory_id: input.solutionMemoryId ?? null,
      orchestrator_decision_id: input.orchestratorDecisionId,
      candidate_type: input.candidateType,
      queue_state: input.queueState,
      priority_score: input.priorityScore ?? null,
      priority_label: input.priorityLabel,
      why_queued: input.whyQueued,
      next_action: input.nextAction,
      requires_human_review: input.requiresHumanReview ? 1 : 0,
      operator_note: input.operatorNote ?? null,
      created_at: now,
      updated_at: now
    };

    this.client
      .prepare(
        `INSERT INTO ${tables.candidateQueueItems} (
          id, signal_id, signal_analysis_id, content_asset_id, critic_review_id, solution_memory_id,
          orchestrator_decision_id, candidate_type, queue_state, priority_score, priority_label,
          why_queued, next_action, requires_human_review, operator_note, created_at, updated_at
        ) VALUES (
          @id, @signal_id, @signal_analysis_id, @content_asset_id, @critic_review_id, @solution_memory_id,
          @orchestrator_decision_id, @candidate_type, @queue_state, @priority_score, @priority_label,
          @why_queued, @next_action, @requires_human_review, @operator_note, @created_at, @updated_at
        )`
      )
      .run(candidate);

    return mapCandidateQueueItem(candidate);
  }

  async listCandidateQueueItems(): Promise<CandidateQueueItem[]> {
    const rows = this.client
      .prepare(`SELECT * FROM ${tables.candidateQueueItems} ORDER BY created_at ASC`)
      .all() as CandidateQueueItemRow[];
    return rows.map(mapCandidateQueueItem);
  }

  async getCandidateQueueItemById(id: string): Promise<CandidateQueueItem | null> {
    const row = this.client
      .prepare(`SELECT * FROM ${tables.candidateQueueItems} WHERE id = ?`)
      .get(id) as CandidateQueueItemRow | undefined;
    return row ? mapCandidateQueueItem(row) : null;
  }

  async updateCandidateQueueItem(
    id: string,
    update: UpdateCandidateQueueItemInput
  ): Promise<CandidateQueueItem | null> {
    const existing = await this.getCandidateQueueItemById(id);
    if (!existing) {
      return null;
    }

    this.client
      .prepare(
        `UPDATE ${tables.candidateQueueItems}
         SET queue_state = @queue_state,
             why_queued = @why_queued,
             next_action = @next_action,
             requires_human_review = @requires_human_review,
             operator_note = @operator_note,
             updated_at = @updated_at
         WHERE id = @id`
      )
      .run({
        id,
        queue_state: update.queueState ?? existing.queueState,
        why_queued: update.whyQueued ?? existing.whyQueued,
        next_action: update.nextAction ?? existing.nextAction,
        requires_human_review:
          (update.requiresHumanReview ?? existing.requiresHumanReview) ? 1 : 0,
        operator_note:
          update.operatorNote === undefined ? existing.operatorNote ?? null : update.operatorNote,
        updated_at: new Date().toISOString()
      });

    return this.getCandidateQueueItemById(id);
  }

  async createBrandVoiceProfile(
    input: CreateBrandVoiceProfileInput
  ): Promise<BrandVoiceProfile> {
    if (input.isActive) {
      this.client
        .prepare(`UPDATE ${tables.brandVoiceProfiles} SET is_active = 0`)
        .run();
    }

    const now = new Date().toISOString();
    const profile = {
      id: this.nextId(tables.brandVoiceProfiles, "voice"),
      name: input.name,
      tone: input.tone,
      audience: input.audience,
      writing_rules_json: JSON.stringify(input.writingRules),
      banned_patterns_json: JSON.stringify(input.bannedPatterns),
      preferred_patterns_json: JSON.stringify(input.preferredPatterns),
      style_notes: input.styleNotes,
      is_active: input.isActive ? 1 : 0,
      created_at: now,
      updated_at: now
    };

    this.client
      .prepare(
        `INSERT INTO ${tables.brandVoiceProfiles} (
          id, name, tone, audience, writing_rules_json, banned_patterns_json,
          preferred_patterns_json, style_notes, is_active, created_at, updated_at
        ) VALUES (
          @id, @name, @tone, @audience, @writing_rules_json, @banned_patterns_json,
          @preferred_patterns_json, @style_notes, @is_active, @created_at, @updated_at
        )`
      )
      .run(profile);

    return mapBrandVoiceProfile(profile);
  }

  async listBrandVoiceProfiles(): Promise<BrandVoiceProfile[]> {
    const rows = this.client
      .prepare(`SELECT * FROM ${tables.brandVoiceProfiles} ORDER BY created_at ASC`)
      .all() as BrandVoiceProfileRow[];
    return rows.map(mapBrandVoiceProfile);
  }

  async getActiveBrandVoiceProfile(): Promise<BrandVoiceProfile | null> {
    const row = this.client
      .prepare(
        `SELECT * FROM ${tables.brandVoiceProfiles} WHERE is_active = 1 ORDER BY updated_at DESC LIMIT 1`
      )
      .get() as BrandVoiceProfileRow | undefined;
    return row ? mapBrandVoiceProfile(row) : null;
  }

  async updateBrandVoiceProfile(
    id: string,
    input: Partial<CreateBrandVoiceProfileInput>
  ): Promise<BrandVoiceProfile | null> {
    const existing = this.client
      .prepare(`SELECT * FROM ${tables.brandVoiceProfiles} WHERE id = ?`)
      .get(id) as BrandVoiceProfileRow | undefined;
    if (!existing) {
      return null;
    }
    if (input.isActive) {
      this.client
        .prepare(`UPDATE ${tables.brandVoiceProfiles} SET is_active = 0`)
        .run();
    }

    const updated = {
      ...existing,
      name: input.name ?? existing.name,
      tone: input.tone ?? existing.tone,
      audience: input.audience ?? existing.audience,
      writing_rules_json:
        input.writingRules !== undefined
          ? JSON.stringify(input.writingRules)
          : existing.writing_rules_json,
      banned_patterns_json:
        input.bannedPatterns !== undefined
          ? JSON.stringify(input.bannedPatterns)
          : existing.banned_patterns_json,
      preferred_patterns_json:
        input.preferredPatterns !== undefined
          ? JSON.stringify(input.preferredPatterns)
          : existing.preferred_patterns_json,
      style_notes: input.styleNotes ?? existing.style_notes,
      is_active:
        input.isActive !== undefined ? (input.isActive ? 1 : 0) : existing.is_active,
      updated_at: new Date().toISOString()
    };

    this.client
      .prepare(
        `UPDATE ${tables.brandVoiceProfiles}
         SET name = @name,
             tone = @tone,
             audience = @audience,
             writing_rules_json = @writing_rules_json,
             banned_patterns_json = @banned_patterns_json,
             preferred_patterns_json = @preferred_patterns_json,
             style_notes = @style_notes,
             is_active = @is_active,
             updated_at = @updated_at
         WHERE id = @id`
      )
      .run(updated);

    return mapBrandVoiceProfile(updated);
  }

  async createWritingQualityAssessment(
    input: CreateWritingQualityAssessmentRecord
  ): Promise<WritingQualityAssessment> {
    const assessment = {
      id: this.nextId(tables.writingQualityAssessments, "quality"),
      content_asset_id: input.contentAssetId,
      human_tone_score: input.humanToneScore,
      clarity_score: input.clarityScore,
      groundedness_score: input.groundednessScore,
      anti_robot_score: input.antiRobotScore,
      overall_score: input.overallScore,
      notes_json: JSON.stringify(input.notes),
      quality_score: input.qualityScore ?? null,
      genericness_score: input.genericnessScore ?? null,
      business_value_score: input.businessValueScore ?? null,
      differentiation_score: input.differentiationScore ?? null,
      publish_ready_flag:
        input.publishReadyFlag === undefined ? null : input.publishReadyFlag ? 1 : 0,
      rewrite_suggestions_json: input.rewriteSuggestions
        ? JSON.stringify(input.rewriteSuggestions)
        : null,
      critic_notes: input.criticNotes ?? null,
      created_at: new Date().toISOString()
    };

    this.client
      .prepare(
        `INSERT INTO ${tables.writingQualityAssessments} (
          id, content_asset_id, human_tone_score, clarity_score, groundedness_score,
          anti_robot_score, overall_score, notes_json, quality_score, genericness_score,
          business_value_score, differentiation_score, publish_ready_flag,
          rewrite_suggestions_json, critic_notes, created_at
        ) VALUES (
          @id, @content_asset_id, @human_tone_score, @clarity_score, @groundedness_score,
          @anti_robot_score, @overall_score, @notes_json, @quality_score, @genericness_score,
          @business_value_score, @differentiation_score, @publish_ready_flag,
          @rewrite_suggestions_json, @critic_notes, @created_at
        )`
      )
      .run(assessment);

    return mapWritingQualityAssessment(assessment);
  }

  async listWritingQualityAssessments(): Promise<WritingQualityAssessment[]> {
    const rows = this.client
      .prepare(
        `SELECT * FROM ${tables.writingQualityAssessments} ORDER BY created_at ASC`
      )
      .all() as WritingQualityAssessmentRow[];
    return rows.map(mapWritingQualityAssessment);
  }

  async createSolutionMemory(
    input: CreateSolutionMemoryRecord
  ): Promise<SolutionMemory> {
    const now = new Date().toISOString();
    const memory: SolutionMemoryRow = {
      id: this.nextId(tables.solutionMemories, "solution-memory"),
      signal_id: input.signalId,
      source_type: input.sourceType,
      implementation_potential: input.implementationPotential,
      implementation_complexity: input.implementationComplexity,
      detected_stack_json: JSON.stringify(input.detectedStack ?? []),
      key_features_json: JSON.stringify(input.keyFeatures ?? []),
      architecture_clues_json: JSON.stringify(input.architectureClues ?? []),
      deployment_hints_json: JSON.stringify(input.deploymentHints ?? []),
      client_fit_types_json: JSON.stringify(input.clientFitTypes ?? []),
      possible_use_cases_json: JSON.stringify(input.possibleUseCases ?? []),
      adaptation_notes: input.adaptationNotes ?? null,
      repo_reference: input.repoReference ?? null,
      readme_snapshot: input.readmeSnapshot ?? null,
      implementation_notes: input.implementationNotes ?? null,
      created_at: now,
      updated_at: now
    };

    this.client
      .prepare(
        `INSERT INTO ${tables.solutionMemories} (
          id, signal_id, source_type, implementation_potential, implementation_complexity,
          detected_stack_json, key_features_json, architecture_clues_json, deployment_hints_json,
          client_fit_types_json, possible_use_cases_json, adaptation_notes, repo_reference,
          readme_snapshot, implementation_notes, created_at, updated_at
        ) VALUES (
          @id, @signal_id, @source_type, @implementation_potential, @implementation_complexity,
          @detected_stack_json, @key_features_json, @architecture_clues_json, @deployment_hints_json,
          @client_fit_types_json, @possible_use_cases_json, @adaptation_notes, @repo_reference,
          @readme_snapshot, @implementation_notes, @created_at, @updated_at
        )`
      )
      .run(memory);

    return mapSolutionMemory(memory);
  }

  async listSolutionMemories(): Promise<SolutionMemory[]> {
    const rows = this.client
      .prepare(`SELECT * FROM ${tables.solutionMemories} ORDER BY updated_at DESC`)
      .all() as SolutionMemoryRow[];
    return rows.map(mapSolutionMemory);
  }

  async listSolutionMemoriesBySignalId(signalId: string): Promise<SolutionMemory[]> {
    const rows = this.client
      .prepare(
        `SELECT * FROM ${tables.solutionMemories}
         WHERE signal_id = ?
         ORDER BY updated_at DESC`
      )
      .all(signalId) as SolutionMemoryRow[];
    return rows.map(mapSolutionMemory);
  }

  async upsertMemoryPattern(input: CreateMemoryPatternInput): Promise<MemoryPattern> {
    const existing = this.client
      .prepare(`SELECT * FROM ${tables.memoryPatterns} WHERE pattern_key = ?`)
      .get(input.patternKey) as MemoryPatternRow | undefined;
    const now = new Date().toISOString();

    if (existing) {
      const updated: MemoryPatternRow = {
        ...existing,
        pattern_type: input.patternType,
        strength_score: input.strengthScore,
        supporting_evidence_json: input.supportingEvidenceJson
          ? JSON.stringify(input.supportingEvidenceJson)
          : existing.supporting_evidence_json,
        recommended_action: input.recommendedAction,
        last_updated_at: now
      };

      this.client
        .prepare(
          `UPDATE ${tables.memoryPatterns}
           SET pattern_type = @pattern_type,
               strength_score = @strength_score,
               supporting_evidence_json = @supporting_evidence_json,
               recommended_action = @recommended_action,
               last_updated_at = @last_updated_at
           WHERE id = @id`
        )
        .run(updated);

      return mapMemoryPattern(updated);
    }

    const created: MemoryPatternRow = {
      id: this.nextId(tables.memoryPatterns, "memory-pattern"),
      pattern_type: input.patternType,
      pattern_key: input.patternKey,
      strength_score: input.strengthScore,
      supporting_evidence_json: input.supportingEvidenceJson
        ? JSON.stringify(input.supportingEvidenceJson)
        : null,
      recommended_action: input.recommendedAction,
      last_updated_at: now
    };

    this.client
      .prepare(
        `INSERT INTO ${tables.memoryPatterns} (
          id, pattern_type, pattern_key, strength_score, supporting_evidence_json,
          recommended_action, last_updated_at
        ) VALUES (
          @id, @pattern_type, @pattern_key, @strength_score, @supporting_evidence_json,
          @recommended_action, @last_updated_at
        )`
      )
      .run(created);

    return mapMemoryPattern(created);
  }

  async listMemoryPatterns(): Promise<MemoryPattern[]> {
    const rows = this.client
      .prepare(
        `SELECT * FROM ${tables.memoryPatterns}
         ORDER BY strength_score DESC, last_updated_at DESC`
      )
      .all() as MemoryPatternRow[];
    return rows.map(mapMemoryPattern);
  }

  async createOrchestratorDecision(
    input: CreateOrchestratorDecisionInput
  ): Promise<OrchestratorDecision> {
    const decision: OrchestratorDecisionRow = {
      id: this.nextId(tables.orchestratorDecisions, "decision"),
      signal_id: input.signalId,
      decision_type: input.decisionType,
      decision_reason: input.decisionReason,
      confidence_score: input.confidenceScore,
      next_action: input.nextAction,
      requires_human_review: input.requiresHumanReview ? 1 : 0,
      created_at: new Date().toISOString()
    };

    this.client
      .prepare(
        `INSERT INTO ${tables.orchestratorDecisions} (
          id, signal_id, decision_type, decision_reason, confidence_score,
          next_action, requires_human_review, created_at
        ) VALUES (
          @id, @signal_id, @decision_type, @decision_reason, @confidence_score,
          @next_action, @requires_human_review, @created_at
        )`
      )
      .run(decision);

    return mapOrchestratorDecision(decision);
  }

  async listOrchestratorDecisions(): Promise<OrchestratorDecision[]> {
    const rows = this.client
      .prepare(
        `SELECT * FROM ${tables.orchestratorDecisions}
         ORDER BY created_at DESC`
      )
      .all() as OrchestratorDecisionRow[];
    return rows.map(mapOrchestratorDecision);
  }

  async createAgentRun(input: CreateAgentRunInput): Promise<AgentRun> {
    const run: AgentRunRow = {
      id: this.nextId(tables.agentRuns, "agent-run"),
      signal_id: input.signalId,
      agent_name: input.agentName,
      model_tier: input.modelTier ?? null,
      provider_name: input.providerName ?? null,
      status: input.status,
      started_at: input.startedAt,
      completed_at: input.completedAt ?? null,
      input_summary: input.inputSummary ?? null,
      output_summary: input.outputSummary ?? null,
      error_message: input.errorMessage ?? null
    };

    this.client
      .prepare(
        `INSERT INTO ${tables.agentRuns} (
          id, signal_id, agent_name, model_tier, provider_name, status,
          started_at, completed_at, input_summary, output_summary, error_message
        ) VALUES (
          @id, @signal_id, @agent_name, @model_tier, @provider_name, @status,
          @started_at, @completed_at, @input_summary, @output_summary, @error_message
        )`
      )
      .run(run);

    return mapAgentRun(run);
  }

  async listAgentRuns(): Promise<AgentRun[]> {
    const rows = this.client
      .prepare(`SELECT * FROM ${tables.agentRuns} ORDER BY started_at DESC`)
      .all() as AgentRunRow[];
    return rows.map(mapAgentRun);
  }

  async getSignalSourceToOutputTrail(
    signalId: string
  ): Promise<SignalSourceToOutputTrail | null> {
    const signal = await this.getSignalById(signalId);
    if (!signal) {
      return null;
    }

    const analyses = await this.listSignalAnalysesBySignalId(signalId);
    const solutionMemories = await this.listSolutionMemoriesBySignalId(signalId);
    const allContentAssets = await this.listContentAssets();
    const contentAssets = allContentAssets.filter((asset) => asset.signalId === signalId);
    const criticReviews = (await this.listWritingQualityAssessments()).filter((review) =>
      contentAssets.some((asset) => asset.id === review.contentAssetId)
    );
    const performanceSnapshots = (await this.listAnalyticsSnapshots()).filter((snapshot) =>
      contentAssets.some((asset) => asset.id === snapshot.contentAssetId)
    );

    return {
      signal,
      analyses,
      contentAssets,
      solutionMemories,
      criticReviews,
      performanceSnapshots
    };
  }

  async createAutonomousWatchlist(
    input: CreateAutonomousWatchlistInput
  ): Promise<AutonomousWatchlist> {
    const now = new Date().toISOString();
    const watchlist: AutonomousWatchlistRow = {
      id: this.nextId(tables.autonomousWatchlists, "auto-watch"),
      source_kind: input.sourceKind,
      label: input.label,
      source_url: input.sourceUrl ?? null,
      notes: input.notes ?? null,
      seed_excerpt: input.seedExcerpt,
      target_problem: input.targetProblem ?? null,
      refresh_cadence: input.refreshCadence,
      priority: input.priority ?? null,
      is_active: input.isActive === false ? 0 : 1,
      auto_promotion_rules_json: input.autoPromotionRules
        ? JSON.stringify(input.autoPromotionRules)
        : null,
      last_run_at: null,
      next_run_at: null,
      created_at: now,
      updated_at: now
    };

    this.client
      .prepare(
        `INSERT INTO ${tables.autonomousWatchlists} (
          id, source_kind, label, source_url, notes, seed_excerpt, target_problem,
          refresh_cadence, priority, is_active, auto_promotion_rules_json, last_run_at, next_run_at, created_at, updated_at
        ) VALUES (
          @id, @source_kind, @label, @source_url, @notes, @seed_excerpt, @target_problem,
          @refresh_cadence, @priority, @is_active, @auto_promotion_rules_json, @last_run_at, @next_run_at, @created_at, @updated_at
        )`
      )
      .run(watchlist);

    return mapAutonomousWatchlist(watchlist);
  }

  async listAutonomousWatchlists(): Promise<AutonomousWatchlist[]> {
    const rows = this.client
      .prepare(`SELECT * FROM ${tables.autonomousWatchlists} ORDER BY created_at ASC`)
      .all() as AutonomousWatchlistRow[];
    return rows.map(mapAutonomousWatchlist);
  }

  async getAutonomousWatchlistById(id: string): Promise<AutonomousWatchlist | null> {
    const row = this.client
      .prepare(`SELECT * FROM ${tables.autonomousWatchlists} WHERE id = ?`)
      .get(id) as AutonomousWatchlistRow | undefined;
    return row ? mapAutonomousWatchlist(row) : null;
  }

  async updateAutonomousWatchlist(
    id: string,
    input: UpdateAutonomousWatchlistInput
  ): Promise<AutonomousWatchlist | null> {
    const existing = this.client
      .prepare(`SELECT * FROM ${tables.autonomousWatchlists} WHERE id = ?`)
      .get(id) as AutonomousWatchlistRow | undefined;
    if (!existing) {
      return null;
    }

    const updated: AutonomousWatchlistRow = {
      ...existing,
      label: input.label ?? existing.label,
      source_url: input.sourceUrl !== undefined ? input.sourceUrl ?? null : existing.source_url,
      notes: input.notes !== undefined ? input.notes ?? null : existing.notes,
      seed_excerpt: input.seedExcerpt ?? existing.seed_excerpt,
      target_problem:
        input.targetProblem !== undefined
          ? input.targetProblem ?? null
          : existing.target_problem,
      refresh_cadence: input.refreshCadence ?? existing.refresh_cadence,
      priority: input.priority !== undefined ? input.priority ?? null : existing.priority,
      is_active:
        input.isActive !== undefined ? (input.isActive ? 1 : 0) : existing.is_active,
      auto_promotion_rules_json:
        input.autoPromotionRules !== undefined
          ? input.autoPromotionRules
            ? JSON.stringify(input.autoPromotionRules)
            : null
          : existing.auto_promotion_rules_json,
      last_run_at:
        input.lastRunAt !== undefined ? input.lastRunAt ?? null : existing.last_run_at,
      next_run_at:
        input.nextRunAt !== undefined ? input.nextRunAt ?? null : existing.next_run_at,
      updated_at: new Date().toISOString()
    };

    this.client
      .prepare(
        `UPDATE ${tables.autonomousWatchlists}
         SET label = @label,
             source_url = @source_url,
             notes = @notes,
             seed_excerpt = @seed_excerpt,
             target_problem = @target_problem,
             refresh_cadence = @refresh_cadence,
             priority = @priority,
             is_active = @is_active,
             auto_promotion_rules_json = @auto_promotion_rules_json,
             last_run_at = @last_run_at,
             next_run_at = @next_run_at,
             updated_at = @updated_at
         WHERE id = @id`
      )
      .run(updated);

    return mapAutonomousWatchlist(updated);
  }

  async createAutonomousRun(input: CreateAutonomousRunInput): Promise<AutonomousRun> {
    const now = new Date().toISOString();
    const run: AutonomousRunRow = {
      id: this.nextId(tables.autonomousRuns, "auto-run"),
      watchlist_id:
        input.watchlistId ??
        (input.runType === "signal_pipeline" ? input.signalId ?? null : null),
      signal_id: input.signalId ?? null,
      trigger_type: input.triggerType,
      run_type: input.runType,
      status: input.status,
      started_at: input.startedAt ?? null,
      completed_at: input.completedAt ?? null,
      error_summary: input.errorSummary ?? null,
      result_summary: input.resultSummary ?? null,
      result_metadata_json: input.resultMetadata
        ? JSON.stringify(input.resultMetadata)
        : null,
      created_at: now,
      updated_at: now
    };

    this.client
      .prepare(
        `INSERT INTO ${tables.autonomousRuns} (
          id, watchlist_id, signal_id, trigger_type, run_type, status, started_at, completed_at,
          error_summary, result_summary, result_metadata_json, created_at, updated_at
        ) VALUES (
          @id, @watchlist_id, @signal_id, @trigger_type, @run_type, @status, @started_at, @completed_at,
          @error_summary, @result_summary, @result_metadata_json, @created_at, @updated_at
        )`
      )
      .run(run);

    return mapAutonomousRun(run);
  }

  async listAutonomousRuns(): Promise<AutonomousRun[]> {
    const rows = this.client
      .prepare(`SELECT * FROM ${tables.autonomousRuns} ORDER BY created_at DESC`)
      .all() as AutonomousRunRow[];
    return rows.map(mapAutonomousRun);
  }

  async findActiveAutonomousRunForWatchlist(
    watchlistId: string
  ): Promise<AutonomousRun | null> {
    const row = this.client
      .prepare(
        `SELECT * FROM ${tables.autonomousRuns}
         WHERE watchlist_id = ? AND status IN ('queued', 'running')
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(watchlistId) as AutonomousRunRow | undefined;
    return row ? mapAutonomousRun(row) : null;
  }

  async findActiveAutonomousRunForSignal(signalId: string): Promise<AutonomousRun | null> {
    const row = this.client
      .prepare(
        `SELECT * FROM ${tables.autonomousRuns}
         WHERE signal_id = ? AND status IN ('queued', 'running')
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(signalId) as AutonomousRunRow | undefined;
    return row ? mapAutonomousRun(row) : null;
  }

  async updateAutonomousRun(
    id: string,
    input: UpdateAutonomousRunInput
  ): Promise<AutonomousRun | null> {
    const existing = this.client
      .prepare(`SELECT * FROM ${tables.autonomousRuns} WHERE id = ?`)
      .get(id) as AutonomousRunRow | undefined;
    if (!existing) {
      return null;
    }

    const updated: AutonomousRunRow = {
      ...existing,
      status: input.status ?? existing.status,
      started_at: input.startedAt !== undefined ? input.startedAt ?? null : existing.started_at,
      completed_at:
        input.completedAt !== undefined ? input.completedAt ?? null : existing.completed_at,
      error_summary:
        input.errorSummary !== undefined
          ? input.errorSummary ?? null
          : existing.error_summary,
      result_summary:
        input.resultSummary !== undefined
          ? input.resultSummary ?? null
          : existing.result_summary,
      result_metadata_json:
        input.resultMetadata !== undefined
          ? input.resultMetadata
            ? JSON.stringify(input.resultMetadata)
            : null
          : existing.result_metadata_json,
      updated_at: new Date().toISOString()
    };

    this.client
      .prepare(
        `UPDATE ${tables.autonomousRuns}
         SET status = @status,
             started_at = @started_at,
             completed_at = @completed_at,
             error_summary = @error_summary,
             result_summary = @result_summary,
             result_metadata_json = @result_metadata_json,
             updated_at = @updated_at
         WHERE id = @id`
      )
      .run(updated);

    return mapAutonomousRun(updated);
  }

  async createAutonomousIngestionArtifact(
    input: CreateAutonomousIngestionArtifactInput
  ): Promise<AutonomousIngestionArtifact> {
    const now = new Date().toISOString();
    const artifact: AutonomousIngestionArtifactRow = {
      id: this.nextId(tables.autonomousIngestionArtifacts, "ingest"),
      watchlist_id: input.watchlistId,
      autonomous_run_id: input.autonomousRunId,
      source_type: input.sourceType,
      source_url: input.sourceUrl ?? null,
      title: input.title,
      raw_text: input.rawText,
      normalized_signal_text: input.normalizedSignalText ?? null,
      suggested_angle: input.suggestedAngle ?? null,
      reasoning_summary: input.reasoningSummary ?? null,
      status: input.status,
      error_summary: input.errorSummary ?? null,
      created_at: now,
      updated_at: now
    };

    this.client
      .prepare(
        `INSERT INTO ${tables.autonomousIngestionArtifacts} (
          id, watchlist_id, autonomous_run_id, source_type, source_url, title, raw_text,
          normalized_signal_text, suggested_angle, reasoning_summary, status, error_summary,
          created_at, updated_at
        ) VALUES (
          @id, @watchlist_id, @autonomous_run_id, @source_type, @source_url, @title, @raw_text,
          @normalized_signal_text, @suggested_angle, @reasoning_summary, @status, @error_summary,
          @created_at, @updated_at
        )`
      )
      .run(artifact);

    return mapAutonomousIngestionArtifact(artifact);
  }

  async listAutonomousIngestionArtifacts(): Promise<AutonomousIngestionArtifact[]> {
    const rows = this.client
      .prepare(
        `SELECT * FROM ${tables.autonomousIngestionArtifacts} ORDER BY created_at DESC`
      )
      .all() as AutonomousIngestionArtifactRow[];
    return rows.map(mapAutonomousIngestionArtifact);
  }

  async upsertAutonomousReviewQueueItem(
    input: CreateAutonomousReviewQueueItemInput
  ): Promise<AutonomousReviewQueueItem> {
    const existing = this.client
      .prepare(
        `SELECT * FROM ${tables.autonomousReviewQueueItems} WHERE dedupe_key = ?`
      )
      .get(input.dedupeKey) as AutonomousReviewQueueItemRow | undefined;
    const now = new Date().toISOString();

    if (existing) {
      const updated: AutonomousReviewQueueItemRow = {
        ...existing,
        watchlist_id: input.watchlistId,
        autonomous_run_id: input.autonomousRunId,
        source_artifact_id: input.sourceArtifactId ?? existing.source_artifact_id,
        source_kind: input.sourceKind,
        title: input.title,
        summary: input.summary,
        rationale: input.rationale,
        recommended_action: input.recommendedAction,
        status: input.status ?? existing.status,
        ai_enrichment_json: input.aiEnrichment
          ? JSON.stringify(input.aiEnrichment)
          : existing.ai_enrichment_json,
        ai_content_json: input.aiContent
          ? JSON.stringify(input.aiContent)
          : existing.ai_content_json,
        updated_at: now
      };

      this.client
        .prepare(
          `UPDATE ${tables.autonomousReviewQueueItems}
           SET watchlist_id = @watchlist_id,
               autonomous_run_id = @autonomous_run_id,
               source_artifact_id = @source_artifact_id,
               source_kind = @source_kind,
               title = @title,
               summary = @summary,
               rationale = @rationale,
               recommended_action = @recommended_action,
               status = @status,
               ai_enrichment_json = @ai_enrichment_json,
               ai_content_json = @ai_content_json,
               updated_at = @updated_at
           WHERE id = @id`
        )
        .run(updated);

      return mapAutonomousReviewQueueItem(updated);
    }

    const created: AutonomousReviewQueueItemRow = {
      id: this.nextId(tables.autonomousReviewQueueItems, "review"),
      watchlist_id: input.watchlistId,
      autonomous_run_id: input.autonomousRunId,
      source_artifact_id: input.sourceArtifactId ?? null,
      source_kind: input.sourceKind,
      dedupe_key: input.dedupeKey,
      title: input.title,
      summary: input.summary,
      rationale: input.rationale,
      recommended_action: input.recommendedAction,
      status: input.status ?? "new",
      ai_enrichment_json: input.aiEnrichment ? JSON.stringify(input.aiEnrichment) : null,
      ai_content_json: input.aiContent ? JSON.stringify(input.aiContent) : null,
      created_at: now,
      updated_at: now
    };

    this.client
      .prepare(
        `INSERT INTO ${tables.autonomousReviewQueueItems} (
          id, watchlist_id, autonomous_run_id, source_artifact_id, source_kind, dedupe_key,
          title, summary, rationale, recommended_action, status, ai_enrichment_json,
          ai_content_json, created_at, updated_at
        ) VALUES (
          @id, @watchlist_id, @autonomous_run_id, @source_artifact_id, @source_kind, @dedupe_key,
          @title, @summary, @rationale, @recommended_action, @status, @ai_enrichment_json,
          @ai_content_json, @created_at, @updated_at
        )`
      )
      .run(created);

    return mapAutonomousReviewQueueItem(created);
  }

  async listAutonomousReviewQueueItems(): Promise<AutonomousReviewQueueItem[]> {
    const rows = this.client
      .prepare(
        `SELECT * FROM ${tables.autonomousReviewQueueItems} ORDER BY updated_at DESC`
      )
      .all() as AutonomousReviewQueueItemRow[];
    return rows.map(mapAutonomousReviewQueueItem);
  }

  async upsertAutonomousMatchedOpportunity(
    input: CreateAutonomousMatchedOpportunityInput
  ): Promise<AutonomousMatchedOpportunity> {
    const existing = this.client
      .prepare(
        `SELECT * FROM ${tables.autonomousMatchedOpportunities} WHERE dedupe_key = ?`
      )
      .get(input.dedupeKey) as AutonomousMatchedOpportunityRow | undefined;
    const now = new Date().toISOString();

    if (existing) {
      const updated: AutonomousMatchedOpportunityRow = {
        ...existing,
        watchlist_id: input.watchlistId,
        autonomous_run_id: input.autonomousRunId,
        audience_queue_item_id: input.audienceQueueItemId,
        solution_queue_item_id: input.solutionQueueItemId,
        title: input.title,
        matched_pain: input.matchedPain,
        matched_solution_pattern: input.matchedSolutionPattern,
        match_rationale: input.matchRationale,
        suggested_angle: input.suggestedAngle,
        recommended_action: input.recommendedAction,
        priority_score: input.priorityScore,
        priority_band: input.priorityBand,
        reason_lines_json: JSON.stringify(input.reasonLines),
        confidence: input.confidence,
        opportunity_strength: input.opportunityStrength ?? null,
        score_notes_json: input.scoreNotes ? JSON.stringify(input.scoreNotes) : null,
        status: input.status ?? existing.status,
        review_state: input.reviewState ?? existing.review_state,
        reviewed_at:
          input.reviewedAt !== undefined ? input.reviewedAt : existing.reviewed_at,
        review_note:
          input.reviewNote !== undefined ? input.reviewNote : existing.review_note,
        ai_enrichment_json: input.aiEnrichment
          ? JSON.stringify(input.aiEnrichment)
          : existing.ai_enrichment_json,
        ai_content_json: input.aiContent
          ? JSON.stringify(input.aiContent)
          : existing.ai_content_json,
        updated_at: now
      };

      this.client
        .prepare(
          `UPDATE ${tables.autonomousMatchedOpportunities}
           SET watchlist_id = @watchlist_id,
               autonomous_run_id = @autonomous_run_id,
               audience_queue_item_id = @audience_queue_item_id,
               solution_queue_item_id = @solution_queue_item_id,
               title = @title,
               matched_pain = @matched_pain,
               matched_solution_pattern = @matched_solution_pattern,
               match_rationale = @match_rationale,
               suggested_angle = @suggested_angle,
               recommended_action = @recommended_action,
               priority_score = @priority_score,
               priority_band = @priority_band,
               reason_lines_json = @reason_lines_json,
               confidence = @confidence,
               opportunity_strength = @opportunity_strength,
               score_notes_json = @score_notes_json,
               status = @status,
               review_state = @review_state,
               reviewed_at = @reviewed_at,
               review_note = @review_note,
               ai_enrichment_json = @ai_enrichment_json,
               ai_content_json = @ai_content_json,
               updated_at = @updated_at
           WHERE id = @id`
        )
        .run(updated);

      return mapAutonomousMatchedOpportunity(updated);
    }

    const created: AutonomousMatchedOpportunityRow = {
      id: this.nextId(tables.autonomousMatchedOpportunities, "matched"),
      watchlist_id: input.watchlistId,
      autonomous_run_id: input.autonomousRunId,
      audience_queue_item_id: input.audienceQueueItemId,
      solution_queue_item_id: input.solutionQueueItemId,
      dedupe_key: input.dedupeKey,
      title: input.title,
      matched_pain: input.matchedPain,
      matched_solution_pattern: input.matchedSolutionPattern,
      match_rationale: input.matchRationale,
      suggested_angle: input.suggestedAngle,
      recommended_action: input.recommendedAction,
      priority_score: input.priorityScore,
      priority_band: input.priorityBand,
      reason_lines_json: JSON.stringify(input.reasonLines),
      confidence: input.confidence,
      opportunity_strength: input.opportunityStrength ?? null,
      score_notes_json: input.scoreNotes ? JSON.stringify(input.scoreNotes) : null,
      status: input.status ?? "new",
      review_state: input.reviewState ?? "new",
      reviewed_at: input.reviewedAt ?? null,
      review_note: input.reviewNote ?? null,
      ai_enrichment_json: input.aiEnrichment ? JSON.stringify(input.aiEnrichment) : null,
      ai_content_json: input.aiContent ? JSON.stringify(input.aiContent) : null,
      created_at: now,
      updated_at: now
    };

    this.client
      .prepare(
        `INSERT INTO ${tables.autonomousMatchedOpportunities} (
          id, watchlist_id, autonomous_run_id, audience_queue_item_id, solution_queue_item_id,
          dedupe_key, title, matched_pain, matched_solution_pattern, match_rationale,
          suggested_angle, recommended_action, priority_score, priority_band, reason_lines_json,
          confidence, opportunity_strength, score_notes_json,
          status, review_state, reviewed_at, review_note,
          ai_enrichment_json, ai_content_json, created_at, updated_at
        ) VALUES (
          @id, @watchlist_id, @autonomous_run_id, @audience_queue_item_id, @solution_queue_item_id,
          @dedupe_key, @title, @matched_pain, @matched_solution_pattern, @match_rationale,
          @suggested_angle, @recommended_action, @priority_score, @priority_band, @reason_lines_json,
          @confidence, @opportunity_strength, @score_notes_json,
          @status, @review_state, @reviewed_at, @review_note,
          @ai_enrichment_json, @ai_content_json, @created_at, @updated_at
        )`
      )
      .run(created);

    return mapAutonomousMatchedOpportunity(created);
  }

  async getAutonomousMatchedOpportunityById(
    id: string
  ): Promise<AutonomousMatchedOpportunity | null> {
    const row = this.client
      .prepare(`SELECT * FROM ${tables.autonomousMatchedOpportunities} WHERE id = ?`)
      .get(id) as AutonomousMatchedOpportunityRow | undefined;
    return row ? mapAutonomousMatchedOpportunity(row) : null;
  }

  async updateAutonomousMatchedOpportunityReviewState(
    id: string,
    input: UpdateAutonomousMatchedOpportunityReviewInput
  ): Promise<AutonomousMatchedOpportunity | null> {
    const existing = this.client
      .prepare(`SELECT * FROM ${tables.autonomousMatchedOpportunities} WHERE id = ?`)
      .get(id) as AutonomousMatchedOpportunityRow | undefined;

    if (!existing) {
      return null;
    }

    const now = new Date().toISOString();
    const updated: AutonomousMatchedOpportunityRow = {
      ...existing,
      review_state: input.reviewState,
      review_note: input.reviewNote?.trim() ? input.reviewNote.trim() : null,
      reviewed_at: input.reviewState === "new" ? null : now,
      updated_at: now
    };

    this.client
      .prepare(
        `UPDATE ${tables.autonomousMatchedOpportunities}
         SET review_state = @review_state,
             review_note = @review_note,
             reviewed_at = @reviewed_at,
             updated_at = @updated_at
         WHERE id = @id`
      )
      .run(updated);

    return mapAutonomousMatchedOpportunity(updated);
  }

  async listAutonomousMatchedOpportunities(filter?: {
    reviewState?: AutonomousMatchedOpportunity["reviewState"];
  }): Promise<AutonomousMatchedOpportunity[]> {
    const rows = filter?.reviewState
      ? ((this.client
          .prepare(
            `SELECT * FROM ${tables.autonomousMatchedOpportunities}
             WHERE review_state = ?
             ORDER BY priority_score DESC, updated_at DESC`
          )
          .all(filter.reviewState) as AutonomousMatchedOpportunityRow[]))
      : ((this.client
          .prepare(
            `SELECT * FROM ${tables.autonomousMatchedOpportunities}
             ORDER BY priority_score DESC, updated_at DESC`
          )
          .all() as AutonomousMatchedOpportunityRow[]));
    return rows.map(mapAutonomousMatchedOpportunity);
  }

  async upsertAutonomousContentWorkItem(
    input: CreateAutonomousContentWorkItemInput
  ): Promise<AutonomousContentWorkItem> {
    const existing = this.client
      .prepare(
        `SELECT * FROM ${tables.autonomousContentWorkItems} WHERE source_matched_opportunity_id = ?`
      )
      .get(input.sourceMatchedOpportunityId) as AutonomousContentWorkItemRow | undefined;
    const now = new Date().toISOString();

    if (existing) {
      const updated: AutonomousContentWorkItemRow = {
        ...existing,
        watchlist_id: input.watchlistId,
        autonomous_run_id: input.autonomousRunId,
        work_item_kind: input.workItemKind,
        title: input.title,
        summary: input.summary,
        rationale: input.rationale,
        recommended_action: input.recommendedAction,
        priority_score: input.priorityScore,
        priority_band: input.priorityBand,
        review_state: input.reviewState,
        status: input.status ?? existing.status,
        state_changed_at:
          input.stateChangedAt !== undefined
            ? input.stateChangedAt
            : existing.state_changed_at,
        work_note: input.workNote !== undefined ? input.workNote : existing.work_note,
        ai_content_json: input.aiContent
          ? JSON.stringify(input.aiContent)
          : existing.ai_content_json,
        draft_seed_json: input.draftSeed
          ? JSON.stringify(input.draftSeed)
          : existing.draft_seed_json,
        updated_at: now
      };

      this.client
        .prepare(
          `UPDATE ${tables.autonomousContentWorkItems}
           SET watchlist_id = @watchlist_id,
               autonomous_run_id = @autonomous_run_id,
               work_item_kind = @work_item_kind,
               title = @title,
               summary = @summary,
               rationale = @rationale,
               recommended_action = @recommended_action,
               priority_score = @priority_score,
               priority_band = @priority_band,
               review_state = @review_state,
               status = @status,
               state_changed_at = @state_changed_at,
               work_note = @work_note,
               ai_content_json = @ai_content_json,
               draft_seed_json = @draft_seed_json,
               updated_at = @updated_at
           WHERE id = @id`
        )
        .run(updated);

      return mapAutonomousContentWorkItem(updated);
    }

    const created: AutonomousContentWorkItemRow = {
      id: this.nextId(tables.autonomousContentWorkItems, "content-work"),
      source_matched_opportunity_id: input.sourceMatchedOpportunityId,
      watchlist_id: input.watchlistId,
      autonomous_run_id: input.autonomousRunId,
      work_item_kind: input.workItemKind,
      title: input.title,
      summary: input.summary,
      rationale: input.rationale,
      recommended_action: input.recommendedAction,
      priority_score: input.priorityScore,
      priority_band: input.priorityBand,
      review_state: input.reviewState,
      status: input.status ?? (input.workItemKind === "deferred_note" ? "parked" : "draft"),
      state_changed_at: input.stateChangedAt ?? now,
      work_note: input.workNote ?? null,
      ai_content_json: input.aiContent ? JSON.stringify(input.aiContent) : null,
      draft_seed_json: input.draftSeed ? JSON.stringify(input.draftSeed) : null,
      created_at: now,
      updated_at: now
    };

    this.client
      .prepare(
        `INSERT INTO ${tables.autonomousContentWorkItems} (
          id, source_matched_opportunity_id, watchlist_id, autonomous_run_id, work_item_kind,
          title, summary, rationale, recommended_action, priority_score, priority_band,
          review_state, status, state_changed_at, work_note,
          ai_content_json, draft_seed_json, created_at, updated_at
        ) VALUES (
          @id, @source_matched_opportunity_id, @watchlist_id, @autonomous_run_id, @work_item_kind,
          @title, @summary, @rationale, @recommended_action, @priority_score, @priority_band,
          @review_state, @status, @state_changed_at, @work_note,
          @ai_content_json, @draft_seed_json, @created_at, @updated_at
        )`
      )
      .run(created);

    return mapAutonomousContentWorkItem(created);
  }

  async getAutonomousContentWorkItemById(
    id: string
  ): Promise<AutonomousContentWorkItem | null> {
    const row = this.client
      .prepare(`SELECT * FROM ${tables.autonomousContentWorkItems} WHERE id = ?`)
      .get(id) as AutonomousContentWorkItemRow | undefined;
    return row ? mapAutonomousContentWorkItem(row) : null;
  }

  async updateAutonomousContentWorkItemStatus(
    id: string,
    input: UpdateAutonomousContentWorkItemStatusInput
  ): Promise<AutonomousContentWorkItem | null> {
    const existing = this.client
      .prepare(`SELECT * FROM ${tables.autonomousContentWorkItems} WHERE id = ?`)
      .get(id) as AutonomousContentWorkItemRow | undefined;

    if (!existing) {
      return null;
    }

    const now = new Date().toISOString();
    const updated: AutonomousContentWorkItemRow = {
      ...existing,
      status: input.status,
      state_changed_at: now,
      work_note: input.workNote?.trim() ? input.workNote.trim() : null,
      updated_at: now
    };

    this.client
      .prepare(
        `UPDATE ${tables.autonomousContentWorkItems}
         SET status = @status,
             state_changed_at = @state_changed_at,
             work_note = @work_note,
             updated_at = @updated_at
         WHERE id = @id`
      )
      .run(updated);

    return mapAutonomousContentWorkItem(updated);
  }

  async listAutonomousContentWorkItems(filter?: {
    workItemKind?: AutonomousContentWorkItem["workItemKind"];
    status?: AutonomousContentWorkItem["status"];
    sort?: "updated_desc" | "updated_asc";
  }): Promise<AutonomousContentWorkItem[]> {
    const orderByClause =
      filter?.sort === "updated_asc"
        ? "ORDER BY updated_at ASC, created_at ASC, id ASC"
        : "ORDER BY updated_at DESC, created_at DESC, id DESC";
    const rows =
      filter?.workItemKind && filter?.status
        ? ((this.client
            .prepare(
              `SELECT * FROM ${tables.autonomousContentWorkItems}
               WHERE work_item_kind = ? AND status = ?
               ${orderByClause}`
            )
            .all(filter.workItemKind, filter.status) as AutonomousContentWorkItemRow[]))
        : filter?.workItemKind
          ? ((this.client
              .prepare(
                `SELECT * FROM ${tables.autonomousContentWorkItems}
                 WHERE work_item_kind = ?
                 ${orderByClause}`
              )
              .all(filter.workItemKind) as AutonomousContentWorkItemRow[]))
          : filter?.status
            ? ((this.client
                .prepare(
                  `SELECT * FROM ${tables.autonomousContentWorkItems}
                   WHERE status = ?
                   ${orderByClause}`
                )
                .all(filter.status) as AutonomousContentWorkItemRow[]))
            : ((this.client
                .prepare(
                  `SELECT * FROM ${tables.autonomousContentWorkItems}
                   ${orderByClause}`
                )
                .all() as AutonomousContentWorkItemRow[]));
    return rows.map(mapAutonomousContentWorkItem);
  }

  async deleteAutonomousDraftDocumentsBySourceContentWorkItemIds(
    sourceContentWorkItemIds: string[]
  ): Promise<number> {
    if (sourceContentWorkItemIds.length === 0) {
      return 0;
    }

    const placeholders = sourceContentWorkItemIds.map(() => "?").join(", ");
    const result = this.client
      .prepare(
        `DELETE FROM ${tables.autonomousDraftDocuments}
         WHERE source_content_work_item_id IN (${placeholders})`
      )
      .run(...sourceContentWorkItemIds);

    return result.changes;
  }

  async deleteAutonomousContentWorkItemsByIds(ids: string[]): Promise<number> {
    if (ids.length === 0) {
      return 0;
    }

    const placeholders = ids.map(() => "?").join(", ");
    const result = this.client
      .prepare(
        `DELETE FROM ${tables.autonomousContentWorkItems}
         WHERE id IN (${placeholders})`
      )
      .run(...ids);

    return result.changes;
  }

  async upsertAutonomousDraftDocument(
    input: CreateAutonomousDraftDocumentInput
  ): Promise<AutonomousDraftDocument> {
    const existing = this.client
      .prepare(
        `SELECT * FROM ${tables.autonomousDraftDocuments} WHERE source_content_work_item_id = ?`
      )
      .get(input.sourceContentWorkItemId) as AutonomousDraftDocumentRow | undefined;
    const now = new Date().toISOString();

    if (existing) {
      const updated: AutonomousDraftDocumentRow = {
        ...existing,
        title: input.title,
        body: input.body,
        angle: input.angle?.trim() ? input.angle.trim() : null,
        source_summary: input.sourceSummary,
        recommended_action: input.recommendedAction,
        status: input.status ?? existing.status,
        updated_at: now
      };

      this.client
        .prepare(
          `UPDATE ${tables.autonomousDraftDocuments}
           SET title = @title,
               body = @body,
               angle = @angle,
               source_summary = @source_summary,
               recommended_action = @recommended_action,
               status = @status,
               updated_at = @updated_at
           WHERE id = @id`
        )
        .run(updated);

      return mapAutonomousDraftDocument(updated);
    }

    const created: AutonomousDraftDocumentRow = {
      id: this.nextId(tables.autonomousDraftDocuments, "draft-doc"),
      source_content_work_item_id: input.sourceContentWorkItemId,
      title: input.title,
      body: input.body,
      angle: input.angle?.trim() ? input.angle.trim() : null,
      source_summary: input.sourceSummary,
      recommended_action: input.recommendedAction,
      status: input.status ?? "draft",
      created_at: now,
      updated_at: now
    };

    this.client
      .prepare(
        `INSERT INTO ${tables.autonomousDraftDocuments} (
          id, source_content_work_item_id, title, body, angle, source_summary,
          recommended_action, status, created_at, updated_at
        ) VALUES (
          @id, @source_content_work_item_id, @title, @body, @angle, @source_summary,
          @recommended_action, @status, @created_at, @updated_at
        )`
      )
      .run(created);

    return mapAutonomousDraftDocument(created);
  }

  async getAutonomousDraftDocumentById(
    id: string
  ): Promise<AutonomousDraftDocument | null> {
    const row = this.client
      .prepare(`SELECT * FROM ${tables.autonomousDraftDocuments} WHERE id = ?`)
      .get(id) as AutonomousDraftDocumentRow | undefined;
    return row ? mapAutonomousDraftDocument(row) : null;
  }

  async getAutonomousDraftDocumentBySourceContentWorkItemId(
    sourceContentWorkItemId: string
  ): Promise<AutonomousDraftDocument | null> {
    const row = this.client
      .prepare(
        `SELECT * FROM ${tables.autonomousDraftDocuments} WHERE source_content_work_item_id = ?`
      )
      .get(sourceContentWorkItemId) as AutonomousDraftDocumentRow | undefined;
    return row ? mapAutonomousDraftDocument(row) : null;
  }

  async updateAutonomousDraftDocument(
    id: string,
    input: UpdateAutonomousDraftDocumentInput
  ): Promise<AutonomousDraftDocument | null> {
    const existing = this.client
      .prepare(`SELECT * FROM ${tables.autonomousDraftDocuments} WHERE id = ?`)
      .get(id) as AutonomousDraftDocumentRow | undefined;

    if (!existing) {
      return null;
    }

    const now = new Date().toISOString();
    const updated: AutonomousDraftDocumentRow = {
      ...existing,
      title: input.title?.trim() ? input.title.trim() : existing.title,
      body: input.body?.trim() ? input.body.trim() : existing.body,
      angle:
        input.angle !== undefined
          ? input.angle.trim()
            ? input.angle.trim()
            : null
          : existing.angle,
      updated_at: now
    };

    this.client
      .prepare(
        `UPDATE ${tables.autonomousDraftDocuments}
         SET title = @title,
             body = @body,
             angle = @angle,
             updated_at = @updated_at
         WHERE id = @id`
      )
      .run(updated);

    return mapAutonomousDraftDocument(updated);
  }

  async updateAutonomousDraftDocumentStatus(
    id: string,
    input: UpdateAutonomousDraftDocumentStatusInput
  ): Promise<AutonomousDraftDocument | null> {
    const existing = this.client
      .prepare(`SELECT * FROM ${tables.autonomousDraftDocuments} WHERE id = ?`)
      .get(id) as AutonomousDraftDocumentRow | undefined;

    if (!existing) {
      return null;
    }

    const updated: AutonomousDraftDocumentRow = {
      ...existing,
      status: input.status,
      updated_at: new Date().toISOString()
    };

    this.client
      .prepare(
        `UPDATE ${tables.autonomousDraftDocuments}
         SET status = @status,
             updated_at = @updated_at
         WHERE id = @id`
      )
      .run(updated);

    return mapAutonomousDraftDocument(updated);
  }

  async listAutonomousDraftDocuments(filter?: {
    status?: AutonomousDraftDocument["status"];
    sort?: "updated_desc" | "updated_asc" | "status";
  }): Promise<AutonomousDraftDocument[]> {
    const orderBy =
      filter?.sort === "updated_asc"
        ? "ORDER BY updated_at ASC, created_at ASC, id ASC"
        : filter?.sort === "status"
          ? `ORDER BY CASE status
               WHEN 'draft' THEN 0
               WHEN 'ready' THEN 1
               WHEN 'blocked' THEN 2
               WHEN 'archived' THEN 3
               ELSE 99
             END ASC, updated_at DESC, created_at DESC, id DESC`
          : "ORDER BY updated_at DESC, created_at DESC, id DESC";
    const query =
      filter?.status === undefined
        ? this.client.prepare(
            `SELECT * FROM ${tables.autonomousDraftDocuments}
             ${orderBy}`
          )
        : this.client.prepare(
            `SELECT * FROM ${tables.autonomousDraftDocuments}
             WHERE status = ?
             ${orderBy}`
          );
    const rows =
      filter?.status === undefined
        ? (query.all() as AutonomousDraftDocumentRow[])
        : (query.all(filter.status) as AutonomousDraftDocumentRow[]);
    return rows.map(mapAutonomousDraftDocument);
  }

  async deleteAutonomousMatchedOpportunitiesByIds(ids: string[]): Promise<number> {
    if (ids.length === 0) {
      return 0;
    }

    const placeholders = ids.map(() => "?").join(", ");
    const result = this.client
      .prepare(
        `DELETE FROM ${tables.autonomousMatchedOpportunities}
         WHERE id IN (${placeholders})`
      )
      .run(...ids);

    return result.changes;
  }

  async deleteAutonomousReviewQueueItemsByWatchlistIds(
    watchlistIds: string[]
  ): Promise<number> {
    if (watchlistIds.length === 0) {
      return 0;
    }

    const placeholders = watchlistIds.map(() => "?").join(", ");
    const result = this.client
      .prepare(
        `DELETE FROM ${tables.autonomousReviewQueueItems}
         WHERE watchlist_id IN (${placeholders})`
      )
      .run(...watchlistIds);

    return result.changes;
  }

  async deleteAutonomousIngestionArtifactsByWatchlistIds(
    watchlistIds: string[]
  ): Promise<number> {
    if (watchlistIds.length === 0) {
      return 0;
    }

    const placeholders = watchlistIds.map(() => "?").join(", ");
    const result = this.client
      .prepare(
        `DELETE FROM ${tables.autonomousIngestionArtifacts}
         WHERE watchlist_id IN (${placeholders})`
      )
      .run(...watchlistIds);

    return result.changes;
  }

  async deleteAutonomousRunsByWatchlistIds(watchlistIds: string[]): Promise<number> {
    if (watchlistIds.length === 0) {
      return 0;
    }

    const placeholders = watchlistIds.map(() => "?").join(", ");
    const result = this.client
      .prepare(
        `DELETE FROM ${tables.autonomousRuns}
         WHERE watchlist_id IN (${placeholders})`
      )
      .run(...watchlistIds);

    return result.changes;
  }

  async deleteAutonomousWatchlistsByIds(ids: string[]): Promise<number> {
    if (ids.length === 0) {
      return 0;
    }

    const placeholders = ids.map(() => "?").join(", ");
    const result = this.client
      .prepare(
        `DELETE FROM ${tables.autonomousWatchlists}
         WHERE id IN (${placeholders})`
      )
      .run(...ids);

    return result.changes;
  }

  close(): void {
    this.client.close();
  }

  private initSync(): void {
    for (const statement of schemaStatements) {
      this.client.exec(statement);
    }
    this.ensureColumns(tables.signals, [
      ["source_url", "TEXT"],
      ["source_domain", "TEXT"],
      ["source_title", "TEXT"],
      ["source_author_or_owner", "TEXT"],
      ["fetched_at", "TEXT"],
      ["language", "TEXT"],
      ["normalized_content", "TEXT"],
      ["content_hash", "TEXT"],
      ["topic_tags_json", "TEXT"],
      ["novelty_hint", "TEXT"],
      ["source_metadata_json", "TEXT"]
    ]);
    this.client.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS signals_content_hash_unique
       ON ${tables.signals}(content_hash)
       WHERE content_hash IS NOT NULL`
    );
    this.ensureColumns(tables.contentAssets, [
      ["signal_id", "TEXT"],
      ["signal_analysis_id", "TEXT"],
      ["orchestrator_decision_id", "TEXT"],
      ["best_angle", "TEXT"],
      ["alternative_angles_json", "TEXT"],
      ["recommended_format", "TEXT"],
      ["long_post_draft", "TEXT"],
      ["short_post_draft", "TEXT"],
      ["hooks_json", "TEXT"],
      ["comment_angles_json", "TEXT"],
      ["cta_variants_json", "TEXT"],
      ["carousel_outline", "TEXT"],
      ["content_status", "TEXT"],
      ["publish_ready_flag", "INTEGER"],
      ["quality_status", "TEXT"],
      ["overall_quality_score", "REAL"],
      ["brand_voice_profile_id", "TEXT"],
      ["final_hook", "TEXT"],
      ["final_body", "TEXT"],
      ["final_closing", "TEXT"],
      ["final_status", "TEXT"],
      ["final_quality_score", "REAL"]
    ]);
    this.ensureColumns(tables.analyticsSnapshots, [
      ["post_url", "TEXT"],
      ["platform", "TEXT"],
      ["published_at", "TEXT"],
      ["audience_geo_hint", "TEXT"],
      ["audience_segment", "TEXT"],
      ["reactions", "INTEGER"],
      ["reposts", "INTEGER"],
      ["inbound_leads", "INTEGER"],
      ["qualitative_notes", "TEXT"]
    ]);
    this.ensureColumns(tables.writingQualityAssessments, [
      ["quality_score", "REAL"],
      ["genericness_score", "REAL"],
      ["business_value_score", "REAL"],
      ["differentiation_score", "REAL"],
      ["publish_ready_flag", "INTEGER"],
      ["rewrite_suggestions_json", "TEXT"],
      ["critic_notes", "TEXT"]
    ]);
    this.ensureColumns(tables.signalAnalyses, [
      ["overhype_notes", "TEXT"],
      ["recommended_pillar", "TEXT"],
      ["best_angle", "TEXT"],
      ["alternative_angles_json", "TEXT"],
      ["recommended_format", "TEXT"],
      ["audience_emphasis", "TEXT"],
      ["tone_guidance", "TEXT"],
      ["recommended_pillar_final", "TEXT"],
      ["reasoning_json", "TEXT"]
    ]);
    this.ensureColumns(tables.solutionMemories, [
      ["adaptation_notes", "TEXT"],
      ["repo_reference", "TEXT"],
      ["readme_snapshot", "TEXT"],
      ["implementation_notes", "TEXT"]
    ]);
    this.ensureColumns(tables.memoryPatterns, [["supporting_evidence_json", "TEXT"]]);
    this.ensureColumns(tables.orchestratorDecisions, [
      ["next_action", "TEXT DEFAULT ''"],
      ["requires_human_review", "INTEGER DEFAULT 0"]
    ]);
    this.ensureColumns(tables.agentRuns, [
      ["model_tier", "TEXT"],
      ["provider_name", "TEXT"],
      ["completed_at", "TEXT"],
      ["input_summary", "TEXT"],
      ["output_summary", "TEXT"],
      ["error_message", "TEXT"]
    ]);
    this.ensureColumns(tables.candidateQueueItems, [
      ["signal_id", "TEXT"],
      ["signal_analysis_id", "TEXT"],
      ["content_asset_id", "TEXT"],
      ["critic_review_id", "TEXT"],
      ["solution_memory_id", "TEXT"],
      ["orchestrator_decision_id", "TEXT"],
      ["candidate_type", "TEXT"],
      ["queue_state", "TEXT"],
      ["priority_score", "REAL"],
      ["priority_label", "TEXT"],
      ["why_queued", "TEXT"],
      ["next_action", "TEXT"],
      ["requires_human_review", "INTEGER"],
      ["operator_note", "TEXT"],
      ["updated_at", "TEXT"]
    ]);
    this.ensureColumns(tables.autonomousRuns, [["signal_id", "TEXT"]]);
    this.ensureColumns(tables.autonomousMatchedOpportunities, [
      ["priority_score", "REAL"],
      ["priority_band", "TEXT"],
      ["reason_lines_json", "TEXT DEFAULT '[]'"],
      ["review_state", "TEXT DEFAULT 'new'"],
      ["reviewed_at", "TEXT"],
      ["review_note", "TEXT"]
    ]);
    this.ensureColumns(tables.autonomousContentWorkItems, [
      ["state_changed_at", "TEXT"],
      ["work_note", "TEXT"],
      ["draft_seed_json", "TEXT"]
    ]);
  }

  private nextId(tableName: string, prefix: string): string {
    const row = this.client
      .prepare(`SELECT COUNT(*) AS count FROM ${tableName}`)
      .get() as { count: number };
    return `${prefix}-${row.count + 1}`;
  }

  private ensureColumn(tableName: string, columnName: string, definition: string): void {
    const rows = this.client
      .prepare(`PRAGMA table_info(${tableName})`)
      .all() as Array<{ name: string }>;
    const hasColumn = rows.some((row) => row.name === columnName);
    if (!hasColumn) {
      this.client.exec(
        `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`
      );
    }
  }

  private ensureColumns(
    tableName: string,
    columns: Array<readonly [columnName: string, definition: string]>
  ): void {
    for (const [columnName, definition] of columns) {
      this.ensureColumn(tableName, columnName, definition);
    }
  }
}

export type WorkflowRepository = Pick<
  SqliteDatabase,
  | "createSignal"
  | "listSignals"
  | "getSignalById"
  | "createSignalAnalysis"
  | "updateSignalAnalysis"
  | "listSignalAnalyses"
  | "listSignalAnalysesBySignalId"
  | "createIdea"
  | "listIdeas"
  | "getIdeaById"
  | "createContentAsset"
  | "listContentAssets"
  | "getContentAssetById"
  | "updateContentAssetCriticState"
  | "updateContentAssetRefinement"
  | "updateContentAssetFinalPost"
  | "createVisualAsset"
  | "listVisualAssets"
  | "createAnalyticsSnapshot"
  | "listAnalyticsSnapshots"
  | "createStrategyRecommendation"
  | "listStrategyRecommendations"
  | "createSolutionMemory"
  | "listSolutionMemories"
  | "listSolutionMemoriesBySignalId"
  | "upsertMemoryPattern"
  | "listMemoryPatterns"
  | "createOrchestratorDecision"
  | "listOrchestratorDecisions"
  | "createAgentRun"
  | "listAgentRuns"
  | "getSignalSourceToOutputTrail"
  | "createSourceItem"
  | "listSourceItems"
  | "createMarketProfile"
  | "listMarketProfiles"
  | "createTopicScore"
  | "listTopicScores"
  | "createContentQueueItem"
  | "listContentQueueItems"
  | "createCandidateQueueItem"
  | "getCandidateQueueItemById"
  | "listCandidateQueueItems"
  | "updateCandidateQueueItem"
  | "createBrandVoiceProfile"
  | "listBrandVoiceProfiles"
  | "getActiveBrandVoiceProfile"
  | "updateBrandVoiceProfile"
  | "createWritingQualityAssessment"
  | "listWritingQualityAssessments"
  | "createAutonomousWatchlist"
  | "listAutonomousWatchlists"
  | "getAutonomousWatchlistById"
  | "updateAutonomousWatchlist"
  | "createAutonomousRun"
  | "listAutonomousRuns"
  | "findActiveAutonomousRunForWatchlist"
  | "findActiveAutonomousRunForSignal"
  | "updateAutonomousRun"
  | "createAutonomousIngestionArtifact"
  | "listAutonomousIngestionArtifacts"
  | "upsertAutonomousReviewQueueItem"
  | "listAutonomousReviewQueueItems"
  | "upsertAutonomousMatchedOpportunity"
  | "getAutonomousMatchedOpportunityById"
  | "updateAutonomousMatchedOpportunityReviewState"
  | "listAutonomousMatchedOpportunities"
  | "upsertAutonomousContentWorkItem"
  | "getAutonomousContentWorkItemById"
  | "updateAutonomousContentWorkItemStatus"
  | "listAutonomousContentWorkItems"
  | "deleteAutonomousDraftDocumentsBySourceContentWorkItemIds"
  | "deleteAutonomousContentWorkItemsByIds"
  | "upsertAutonomousDraftDocument"
  | "getAutonomousDraftDocumentById"
  | "getAutonomousDraftDocumentBySourceContentWorkItemId"
  | "updateAutonomousDraftDocument"
  | "updateAutonomousDraftDocumentStatus"
  | "listAutonomousDraftDocuments"
  | "deleteAutonomousMatchedOpportunitiesByIds"
  | "deleteAutonomousReviewQueueItemsByWatchlistIds"
  | "deleteAutonomousIngestionArtifactsByWatchlistIds"
  | "deleteAutonomousRunsByWatchlistIds"
  | "deleteAutonomousWatchlistsByIds"
>;

export { SqliteDatabase as InMemoryDatabase };
