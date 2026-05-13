import { useEffect, useMemo, useState, type FormEvent } from "react";
import { FactoryDashboard } from "./FactoryDashboard";
import {
  BarChart3,
  Bookmark,
  Globe2,
  ImagePlus,
  Layers3,
  LoaderCircle,
  PenSquare,
  Plus,
  Radar,
  Sparkles,
  WandSparkles
} from "lucide-react";
import { Card } from "@/components/ui/card";
import type {
  AIContentGeneration,
  AIRuntimeHealthSummary,
  AIProviderProbeResult,
  AIScoutEnrichment,
  AudienceScoutItem,
  AudienceScoutResult,
  AnalyticsSnapshot,
  AutonomousRun,
  AutonomousMatchedOpportunity,
  AutonomousMatchedOpportunityReviewState,
  AutonomousReviewQueueItem,
  AutonomousContentWorkItem,
  AutonomousDraftDocument,
  AutonomousDraftDocumentStatus,
  AutonomousWatchlist,
  DecisionLayerInput,
  DecisionPlan,
  BrandVoiceProfile,
  FeedbackSummary,
  ContentAsset,
  CandidateQueueItem,
  CandidateQueueItemDetail,
  CandidateQueueOperatorAction,
  ContentQueueItem,
  CreateAnalyticsSnapshotInput,
  CreateBrandVoiceProfileInput,
  AnalyzeRelevanceInput,
  CreateMarketProfileInput,
  GenerateCommentInput,
  GeneratedComment,
  GeneratedReply,
  GenerateReplyInput,
  NormalizedSourceSignal,
  OperatorControlStatus,
  OrchestratedRecommendation,
  CreateSignalInput,
  CreateSourceItemInput,
  FinalPostGenerationConfig,
  GrowthRhythmCandidate,
  GrowthRhythmPlan,
  Idea,
  LiveIngestionBuffer,
  LiveIngestionItem,
  LaunchPreflightResult,
  LaunchSmokeRunResult,
  ManualOutcomeFeedback,
  MarketProfile,
  MatchedOpportunity,
  PersistedMatchedOpportunity,
  PatternMemorySummary,
  FactoryPrioritySelectionResult,
  MemoryPattern,
  ScoutMatchResult,
  ScoutFeedAdapterSummary,
  ScoutFeedGroupAdapterSummary,
  ScoutFeedInput,
  ScoutItemAdapterSummary,
  ScoutFeedResult,
  SourceIntakeInput,
  Signal,
  SourceItem,
  SourceType,
  StrategyRecommendation,
  SolutionScoutInput,
  SolutionScoutItem,
  SolutionScoutResult,
  SolutionMemory,
  TopicScore,
  RelevanceAnalysis,
  VisualAsset,
  WatchlistItem,
  WatchlistStore,
  WritingQualityAssessment
} from "@linkedin-brand-os/shared";
import {
  buildFeedbackSummary,
  buildPatternMemorySummary,
  extractFeedbackAwareThemeTags
} from "@linkedin-brand-os/shared";

interface AppProps {
  apiBaseUrl?: string;
}

interface OperatorSession {
  username: string;
  expiresAt: string;
}

interface OperatorLoginResponse extends OperatorSession {
  token: string;
}

interface DraftEditFormState {
  title: string;
  body: string;
  angle: string;
}

type DraftStatusOption = AutonomousDraftDocument["status"];
type DraftQueueStatusFilter = "all" | AutonomousDraftDocument["status"];
type DraftQueueSortOption = "updated_desc" | "updated_asc" | "status";
type MatchedOpportunityReviewStateOption = AutonomousMatchedOpportunityReviewState;
type ReviewTriageReviewStateFilter = "all" | AutonomousMatchedOpportunityReviewState;
type WorkItemStatusOption = AutonomousContentWorkItem["status"];
type ContentWorkspaceStatusFilter = "all" | AutonomousContentWorkItem["status"];
type ContentWorkspaceKindFilter = "all" | AutonomousContentWorkItem["workItemKind"];
type ContentWorkspaceHasDraftFilter = "all" | "true" | "false";
type ContentWorkspaceDraftStatusFilter = "all" | AutonomousDraftDocument["status"];
type ContentWorkspaceSortOption = "updated_desc" | "updated_asc" | "status" | "has_draft";

interface ExperimentalFinalPost {
  signalId: string;
  ideaId: string | null;
  contentId: string | null;
  hook: string;
  post: string;
  mode: "provider" | "deterministic";
  generatorVersion: "v2";
}

interface FinalPostComparisonVariant {
  label: "Legacy default" | "Legacy + V3" | "V2 experimental";
  hook: string;
  body: string;
  closing?: string;
  qualityMetadata?: ContentAsset["finalQualityMetadata"];
  qualityScore?: number;
  mode?: "provider" | "deterministic";
  notesFallback?: string;
}

interface FinalPostComparisonState {
  contentId: string;
  variants: FinalPostComparisonVariant[];
}

type FinalPostComparisonViewMode = "hook" | "firstParagraph" | "full";

interface RecommendedActionPayload {
  plannerResult: DecisionPlan;
  signalText: string;
  sourceType?: DecisionLayerInput["sourceType"];
  targetRole?: string;
  companyContext?: string;
  postContext?: string;
  relevanceScore?: number;
  bestAngle?: DecisionLayerInput["bestAngle"];
  recommendedAction?: DecisionLayerInput["recommendedAction"];
  reasoningSummary?: string;
  hasCommentContext?: boolean;
  hasReplyContext?: boolean;
}

interface AudienceScoutFormState {
  targetTopics: string;
  targetRoles: string;
  targetKeywords: string;
  publicSourceLabel: string;
  publicSourceUrl: string;
  publicExcerpt: string;
  maxResults: number;
}

interface SolutionScoutFormState {
  sourceType: SolutionScoutInput["sourceType"];
  targetProblem: string;
  sourceLabel: string;
  sourceUrl: string;
  sourceExcerpt: string;
  operatorNotes: string;
}

interface ScoutFeedFormState {
  mode: ScoutFeedInput["mode"];
  solutionSourceType: SolutionScoutInput["sourceType"];
  targetProblem: string;
  batchInput: string;
}

interface LiveIngestionBufferFormState {
  sourceKind: LiveIngestionItem["sourceKind"];
  sourceLabel: string;
  sourceUrl: string;
  batchInput: string;
  notes: string;
}

interface WatchlistFormState {
  sourceKind: WatchlistItem["sourceKind"];
  label: string;
  sourceUrl: string;
  notes: string;
  refreshCadence: WatchlistItem["refreshCadence"];
  priority: "normal" | "high";
  enableAutoPromotion: boolean;
  enableAutoDraft: boolean;
}

interface SavedDecisionItem {
  id: string;
  signalText: string;
  bestAngle: DecisionPlan["bestAngle"];
  reasoningSummary: string;
  priority: DecisionPlan["contentPriority"] | DecisionPlan["engagementPriority"];
  recommendedAction: DecisionPlan["recommendedNextAction"];
  createdAt: string;
  status: "new" | "sent" | "done" | "archived";
  lastActionAt?: string;
  sourceType?: DecisionLayerInput["sourceType"];
  targetRole?: string;
  companyContext?: string;
  postContext?: string;
  relevanceScore?: number;
}

type QueueFilter = "all" | "active" | "done" | "archived";
type QueueSort = "newest" | "oldest" | "lastAction";
type SavedMatchStatusFilter = "all" | PersistedMatchedOpportunity["status"];
type LiveIngestionFilter = "all" | LiveIngestionItem["status"];
type LiveIngestionOriginFilter = "all" | "manual" | "watchlist_refresh";
type LiveIngestionSourceKindFilter = "all" | LiveIngestionItem["sourceKind"];
type WatchlistActiveFilter = "all" | "active" | "inactive";
type WatchlistCadenceFilter = "all" | WatchlistItem["refreshCadence"];
type WatchlistPriorityFilter = "all" | "high" | "normal";
type WatchlistSourceKindFilter = "all" | WatchlistItem["sourceKind"];
type ManualFeedbackStatus = ManualOutcomeFeedback["status"];
type ManualFeedbackResponseLevel = ManualOutcomeFeedback["responseLevel"];

interface ManualFeedbackDraft {
  status: ManualFeedbackStatus;
  responseLevel: ManualFeedbackResponseLevel;
  gotReplies: boolean;
  gotProfileViews: boolean;
  gotLeadSignal: boolean;
  repeatTopic: boolean;
  notes: string;
}

interface SavedMatchesStoreState {
  items: PersistedMatchedOpportunity[];
}

interface WatchlistStoreState extends WatchlistStore {}

interface LiveIngestionBufferState extends LiveIngestionBuffer {}

interface LiveIngestionRefreshRun {
  id: string;
  label: string;
  triggerType: "single_watchlist" | "active_watchlists" | "daily_candidate" | "weekly_candidate";
  triggeredAt: string;
  createdCount: number;
  skippedCount: number;
  watchlistIds: string[];
  watchlistLabels: string[];
  reviewStatus: "open" | "completed" | "archived";
}

interface LiveIngestionRefreshRunStoreState {
  items: LiveIngestionRefreshRun[];
}

function parseScoutFeedBatchInput(
  mode: ScoutFeedInput["mode"],
  solutionSourceType: SolutionScoutInput["sourceType"],
  targetProblem: string,
  batchInput: string
): ScoutFeedInput["items"] {
  return batchInput
    .split(/\n\s*\n+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((excerpt) => ({
      sourceType:
        mode === "audience"
          ? ("public_web" as const)
          : mode === "solution"
            ? solutionSourceType
            : undefined,
      excerpt,
      targetProblem: targetProblem.trim() || undefined
    }));
}

function parseLiveIngestionBatchInput(batchInput: string): string[] {
  return batchInput
    .split(/\n\s*\n+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function normalizeLiveIngestionFingerprint(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildLiveIngestionFingerprint(
  sourceKind: LiveIngestionItem["sourceKind"],
  sourceUrl: string,
  rawExcerpt: string
) {
  return normalizeLiveIngestionFingerprint([sourceKind, sourceUrl, rawExcerpt].join(" "));
}

function createLiveIngestionItems(
  form: LiveIngestionBufferFormState,
  now = new Date().toISOString()
): LiveIngestionItem[] {
  return parseLiveIngestionBatchInput(form.batchInput).map((rawExcerpt, index) => ({
    id: `ingestion-${now}-${index}`,
    sourceKind: form.sourceKind,
    sourceLabel: form.sourceLabel.trim() || undefined,
    sourceUrl: form.sourceUrl.trim() || undefined,
    rawExcerpt,
    capturedAt: now,
    fingerprint: buildLiveIngestionFingerprint(form.sourceKind, form.sourceUrl.trim(), rawExcerpt),
    status: "new",
    origin: "manual",
    notes: form.notes.trim() || undefined
  }));
}

function buildWatchlistSnapshotFingerprint(
  sourceKind: LiveIngestionItem["sourceKind"],
  sourceUrl: string,
  label: string,
  watchlistItemId: string
) {
  return normalizeLiveIngestionFingerprint([sourceKind, sourceUrl, label, watchlistItemId].join(" "));
}

function createLiveIngestionRefreshRunId(
  triggerType: LiveIngestionRefreshRun["triggerType"],
  triggeredAt: string,
  watchlistIds: string[]
) {
  const watchlistKey = watchlistIds.join("-");
  return `refresh-run-${triggerType}-${triggeredAt}-${watchlistKey || "none"}`;
}

function formatLiveIngestionRefreshRunLabel(
  triggerType: LiveIngestionRefreshRun["triggerType"],
  watchlistLabels: string[]
) {
  if (triggerType === "single_watchlist") {
    return `Refresh: ${watchlistLabels[0] ?? "Watchlist item"}`;
  }

  if (triggerType === "active_watchlists") {
    return "Refresh active watchlists";
  }

  if (triggerType === "daily_candidate") {
    return "Refresh daily candidates";
  }

  return "Refresh weekly candidates";
}

function getLiveIngestionRefreshRunReviewStatusRank(
  status: LiveIngestionRefreshRun["reviewStatus"]
) {
  switch (status) {
    case "open":
      return 0;
    case "completed":
      return 1;
    case "archived":
      return 2;
    default:
      return 3;
  }
}

function getLiveIngestionRefreshRunReviewStatusTone(
  status: LiveIngestionRefreshRun["reviewStatus"]
): "support" | "neutral" | "avoid" {
  switch (status) {
    case "open":
      return "support";
    case "completed":
      return "neutral";
    case "archived":
      return "avoid";
    default:
      return "neutral";
  }
}

function createDraftLiveIngestionItemFromWatchlist(
  item: WatchlistItem,
  now = new Date().toISOString()
): LiveIngestionItem {
  const sourceKind = watchlistKindToLiveIngestionSourceKind(item.sourceKind);
  return {
    id: `ingestion-draft-${now}`,
    sourceKind,
    sourceLabel: item.label,
    sourceUrl: item.sourceUrl,
    rawExcerpt: "",
    capturedAt: now,
    fingerprint: buildWatchlistSnapshotFingerprint(
      sourceKind,
      item.sourceUrl ?? "",
      item.label,
      item.id
    ),
    status: "draft",
    origin: "manual",
    watchlistItemId: item.id,
    notes: item.notes
  };
}

function createRefreshLiveIngestionItemFromWatchlist(
  item: WatchlistItem,
  now = new Date().toISOString(),
  refreshRun?: Pick<LiveIngestionRefreshRun, "id" | "label">
): LiveIngestionItem {
  const sourceKind = watchlistKindToLiveIngestionSourceKind(item.sourceKind);
  return {
    id: `ingestion-refresh-${now}-${item.id}`,
    sourceKind,
    sourceLabel: item.label,
    sourceUrl: item.sourceUrl,
    rawExcerpt: "",
    capturedAt: now,
    fingerprint: buildWatchlistSnapshotFingerprint(
      sourceKind,
      item.sourceUrl ?? "",
      item.label,
      item.id
    ),
    status: "draft",
    origin: "watchlist_refresh",
    watchlistItemId: item.id,
    refreshRunId: refreshRun?.id,
    refreshRunLabel: refreshRun?.label,
    notes: item.notes
  };
}

function sourceKindToScoutFeedSourceType(
  sourceKind: LiveIngestionItem["sourceKind"]
): ScoutFeedInput["items"][number]["sourceType"] {
  if (sourceKind === "github_watch_snapshot") {
    return "github";
  }

  if (sourceKind === "article_watch_snapshot") {
    return "article";
  }

  if (sourceKind === "manual_feed_snapshot") {
    return "mixed";
  }

  return "public_web";
}

function liveIngestionItemToScoutFeedItem(
  item: LiveIngestionItem
): ScoutFeedInput["items"][number] {
  return {
    sourceType: sourceKindToScoutFeedSourceType(item.sourceKind),
    sourceLabel: item.sourceLabel,
    sourceUrl: item.sourceUrl,
    excerpt: item.rawExcerpt
  };
}

function watchlistKindToLiveIngestionSourceKind(
  sourceKind: WatchlistItem["sourceKind"]
): LiveIngestionItem["sourceKind"] {
  if (sourceKind === "github_repo" || sourceKind === "github_release" || sourceKind === "github_issue") {
    return "github_watch_snapshot";
  }

  if (sourceKind === "article_source") {
    return "article_watch_snapshot";
  }

  if (sourceKind === "public_discussion_source") {
    return "public_excerpt";
  }

  return "watched_url_snapshot";
}

function mergeById<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  return Array.from(new Map([...incoming, ...current].map((item) => [item.id, item])).values());
}

const SAVED_FOR_LATER_STORAGE_KEY = "linkedin-brand-os:saved-for-later";
const QUEUE_FILTER_STORAGE_KEY = "linkedin-brand-os:queue-filter";
const QUEUE_SORT_STORAGE_KEY = "linkedin-brand-os:queue-sort";
const MANUAL_FEEDBACK_STORAGE_KEY = "linkedin-brand-os:manual-feedback";
const PATTERN_MEMORY_STORAGE_KEY = "linkedin-brand-os:pattern-memory";
const SAVED_MATCHES_STORAGE_KEY = "linkedin-brand-os:saved-matches";
const LIVE_INGESTION_BUFFER_STORAGE_KEY = "linkedin-brand-os:live-ingestion-buffer";
const LIVE_INGESTION_REFRESH_RUNS_STORAGE_KEY = "linkedin-brand-os:live-ingestion-refresh-runs";
const WATCHLISTS_STORAGE_KEY = "linkedin-brand-os:watchlists";
const OPERATOR_AUTH_TOKEN_STORAGE_KEY = "linkedin-brand-os:operator-auth-token";

const initialAudienceScoutForm: AudienceScoutFormState = {
  targetTopics: "",
  targetRoles: "",
  targetKeywords: "",
  publicSourceLabel: "",
  publicSourceUrl: "",
  publicExcerpt: "",
  maxResults: 4
};

const initialSolutionScoutForm: SolutionScoutFormState = {
  sourceType: "mixed",
  targetProblem: "",
  sourceLabel: "",
  sourceUrl: "",
  sourceExcerpt: "",
  operatorNotes: ""
};

const initialScoutFeedForm: ScoutFeedFormState = {
  mode: "mixed",
  solutionSourceType: "mixed",
  targetProblem: "",
  batchInput: ""
};

const initialLiveIngestionBufferForm: LiveIngestionBufferFormState = {
  sourceKind: "public_excerpt",
  sourceLabel: "",
  sourceUrl: "",
  batchInput: "",
  notes: ""
};

const initialWatchlistForm: WatchlistFormState = {
  sourceKind: "watched_url",
  label: "",
  sourceUrl: "",
  notes: "",
  refreshCadence: "manual_only",
  priority: "normal",
  enableAutoPromotion: false,
  enableAutoDraft: false
};

function isQueueFilter(value: string): value is QueueFilter {
  return value === "all" || value === "active" || value === "done" || value === "archived";
}

function isQueueSort(value: string): value is QueueSort {
  return value === "newest" || value === "oldest" || value === "lastAction";
}

function isManualFeedbackStatus(value: string): value is ManualFeedbackStatus {
  return value === "posted" || value === "not_posted" || value === "used";
}

function isManualFeedbackResponseLevel(value: string): value is ManualFeedbackResponseLevel {
  return value === "strong" || value === "medium" || value === "weak" || value === "unknown";
}

function createDefaultManualFeedbackDraft(): ManualFeedbackDraft {
  return {
    status: "used",
    responseLevel: "unknown",
    gotReplies: false,
    gotProfileViews: false,
    gotLeadSignal: false,
    repeatTopic: false,
    notes: ""
  };
}

function feedbackStorageKey(
  artifactType: ManualOutcomeFeedback["artifactType"],
  artifactId: string
): string {
  return `${artifactType}:${artifactId}`;
}

function normalizeManualOutcomeFeedback(value: unknown): ManualOutcomeFeedback | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const raw = value as Record<string, unknown>;
  if (
    typeof raw.id !== "string" ||
    typeof raw.artifactId !== "string" ||
    typeof raw.artifactType !== "string" ||
    !isManualFeedbackStatus(String(raw.status)) ||
    !isManualFeedbackResponseLevel(String(raw.responseLevel)) ||
    typeof raw.createdAt !== "string"
  ) {
    return null;
  }

  if (
    raw.artifactType !== "final_post" &&
    raw.artifactType !== "comment" &&
    raw.artifactType !== "reply"
  ) {
    return null;
  }

  return {
    id: raw.id,
    artifactType: raw.artifactType,
    artifactId: raw.artifactId,
    status: raw.status as ManualFeedbackStatus,
    responseLevel: raw.responseLevel as ManualFeedbackResponseLevel,
    gotReplies: Boolean(raw.gotReplies),
    gotProfileViews: Boolean(raw.gotProfileViews),
    gotLeadSignal: Boolean(raw.gotLeadSignal),
    repeatTopic: Boolean(raw.repeatTopic),
    notes: typeof raw.notes === "string" ? raw.notes : undefined,
    createdAt: raw.createdAt
  };
}

function readManualOutcomeFeedback(): ManualOutcomeFeedback[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(MANUAL_FEEDBACK_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map(normalizeManualOutcomeFeedback)
      .filter((item): item is ManualOutcomeFeedback => item !== null);
  } catch {
    return [];
  }
}

function normalizePatternMemorySummary(value: unknown): PatternMemorySummary | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const raw = value as Record<string, unknown>;
  if (
    !Array.isArray(raw.repeatPatterns) ||
    !Array.isArray(raw.avoidPatterns) ||
    !Array.isArray(raw.recurringThemes) ||
    !Array.isArray(raw.weakThemes) ||
    typeof raw.notes !== "string" ||
    typeof raw.totalPatterns !== "number"
  ) {
    return null;
  }

  return {
    repeatPatterns: raw.repeatPatterns.filter(
      (item): item is PatternMemorySummary["repeatPatterns"][number] =>
        Boolean(item) &&
        typeof item === "object" &&
        typeof (item as { id?: unknown }).id === "string" &&
        typeof (item as { label?: unknown }).label === "string" &&
        ((item as { kind?: unknown }).kind === "repeat" ||
          (item as { kind?: unknown }).kind === "avoid") &&
        typeof (item as { strength?: unknown }).strength === "number" &&
        typeof (item as { occurrences?: unknown }).occurrences === "number" &&
        typeof (item as { lastSeenAt?: unknown }).lastSeenAt === "string" &&
        (item as { source?: unknown }).source === "feedback"
    ),
    avoidPatterns: raw.avoidPatterns.filter(
      (item): item is PatternMemorySummary["avoidPatterns"][number] =>
        Boolean(item) &&
        typeof item === "object" &&
        typeof (item as { id?: unknown }).id === "string" &&
        typeof (item as { label?: unknown }).label === "string" &&
        ((item as { kind?: unknown }).kind === "repeat" ||
          (item as { kind?: unknown }).kind === "avoid") &&
        typeof (item as { strength?: unknown }).strength === "number" &&
        typeof (item as { occurrences?: unknown }).occurrences === "number" &&
        typeof (item as { lastSeenAt?: unknown }).lastSeenAt === "string" &&
        (item as { source?: unknown }).source === "feedback"
    ),
    recurringThemes: raw.recurringThemes.filter((item): item is string => typeof item === "string"),
    weakThemes: raw.weakThemes.filter((item): item is string => typeof item === "string"),
    notes: raw.notes,
    totalPatterns: raw.totalPatterns
  };
}

function readPatternMemorySummary(): PatternMemorySummary {
  if (typeof window === "undefined") {
    return buildPatternMemorySummary([]);
  }

  try {
    const raw = window.localStorage.getItem(PATTERN_MEMORY_STORAGE_KEY);
    if (!raw) {
      return buildPatternMemorySummary([]);
    }

    const parsed = normalizePatternMemorySummary(JSON.parse(raw));
    return parsed ?? buildPatternMemorySummary([]);
  } catch {
    return buildPatternMemorySummary([]);
  }
}

function normalizeOrchestratedMatchText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeScoutSupportText(value: string) {
  return normalizeOrchestratedMatchText(value)
    .split(" ")
    .filter((token) => token.length >= 4);
}

function scoutSupportOverlapScore(left: string, right: string) {
  const leftTokens = new Set(tokenizeScoutSupportText(left));
  const rightTokens = new Set(tokenizeScoutSupportText(right));

  let score = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      score += 1;
    }
  }

  return score;
}

function actionPlanActionForScoutMatch(action: GrowthRhythmCandidate["suggestedAction"]) {
  if (action === "generate_comment") {
    return "write_comment";
  }

  if (action === "generate_reply") {
    return "write_reply";
  }

  if (action === "save_for_later") {
    return "save_for_later";
  }

  return "write_post";
}

function candidateScoutSupportScore(
  candidate: GrowthRhythmCandidate,
  match: MatchedOpportunity
) {
  const candidateCorpus = [
    candidate.title,
    candidate.reasoningSummary,
    candidate.bestAngle,
    candidate.suggestedAction
  ]
    .filter(Boolean)
    .join(" ");
  const scoutCorpus = [
    match.matchedPain,
    match.matchedSolutionPattern,
    match.whyThisMatchWorks,
    match.suggestedAngle
  ].join(" ");

  let score = scoutSupportOverlapScore(candidateCorpus, scoutCorpus);

  if (
    candidate.bestAngle &&
    normalizeOrchestratedMatchText(candidate.bestAngle) ===
      normalizeOrchestratedMatchText(match.suggestedAngle)
  ) {
    score += 2;
  }

  if (actionPlanActionForScoutMatch(candidate.suggestedAction) === match.recommendedAction) {
    score += 2;
  }

  const normalizedCandidate = normalizeOrchestratedMatchText(candidateCorpus);
  const normalizedPain = normalizeOrchestratedMatchText(match.matchedPain);
  const normalizedSolution = normalizeOrchestratedMatchText(match.matchedSolutionPattern);

  if (
    normalizedCandidate.includes(normalizedPain) ||
    normalizedPain.includes(normalizedCandidate)
  ) {
    score += 2;
  }

  if (
    normalizedCandidate.includes(normalizedSolution) ||
    normalizedSolution.includes(normalizedCandidate)
  ) {
    score += 1;
  }

  return score;
}

interface ActionPlanScoutSupport {
  badge: string;
  badgeKind: "support";
  note: string;
  strengthLabel?: string;
  scoreNote?: string;
  originLabel?: string;
  supportGroupLabel?: string;
  priorityBias?: "none" | "light" | "strong";
  priorityBiasScore?: number;
  priorityReason?: string;
}

function formatScoutStrengthDisplayLabel(
  strength: "strong" | "medium" | "weak" | undefined
): string | null {
  if (strength === "strong") {
    return "Strong";
  }

  if (strength === "medium") {
    return "Medium";
  }

  if (strength === "weak") {
    return "Weak";
  }

  return null;
}

function scoutStrengthSortValue(label: string | null): number {
  if (label === "Strong") {
    return 3;
  }

  if (label === "Medium") {
    return 2;
  }

  if (label === "Weak") {
    return 1;
  }

  return 0;
}

function getMatchStrengthLabel(match: { opportunityStrength?: "strong" | "medium" | "weak" }): string | null {
  return formatScoutStrengthDisplayLabel(match.opportunityStrength);
}

function getFirstScoutScoreNoteValue(notes: string[] | undefined): string | null {
  return notes?.find((note) => typeof note === "string" && note.trim().length > 0) ?? null;
}

function candidatePrioritySortValue(priority: GrowthRhythmCandidate["priority"]): number {
  if (priority === "high") {
    return 3;
  }

  if (priority === "medium") {
    return 2;
  }

  return 1;
}

function savedMatchStatusSortValue(status: PersistedMatchedOpportunity["status"]): number {
  if (status === "new") {
    return 4;
  }

  if (status === "reviewed") {
    return 3;
  }

  if (status === "converted") {
    return 2;
  }

  if (status === "archived") {
    return 1;
  }

  return 0;
}

function savedMatchConfidenceSortValue(confidence: PersistedMatchedOpportunity["match"]["confidence"]): number {
  if (confidence === "high") {
    return 3;
  }

  if (confidence === "medium") {
    return 2;
  }

  return 1;
}

function isSameLocalCalendarDay(left: string | undefined, right: Date): boolean {
  if (!left) {
    return false;
  }

  const leftDate = new Date(left);
  if (Number.isNaN(leftDate.getTime())) {
    return false;
  }

  return leftDate.toDateString() === right.toDateString();
}

function getSavedMatchPrimaryConvertAction(
  status: PersistedMatchedOpportunity["status"]
): "source_intake" | "decision_planner" | null {
  if (status === "new") {
    return "source_intake";
  }

  if (status === "reviewed") {
    return "decision_planner";
  }

  return null;
}

function getSavedMatchConvertActionClass(
  status: PersistedMatchedOpportunity["status"],
  action: "source_intake" | "save_for_later" | "decision_planner"
): string {
  const primaryAction = getSavedMatchPrimaryConvertAction(status);

  if (primaryAction === action) {
    return "rounded-lg border border-slate-900 bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white";
  }

  return "rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-slate-700";
}

function getSavedMatchConvertHint(status: PersistedMatchedOpportunity["status"]): string | null {
  if (status === "new") {
    return "Best for fresh opportunity intake";
  }

  if (status === "reviewed") {
    return "Best for planner-ready review";
  }

  return null;
}

function getSavedMatchSearchEmptyStateCopy(
  activeStatusFilter: PersistedMatchedOpportunity["status"] | "all"
): string {
  if (activeStatusFilter === "all") {
    return "No saved matches match this search.";
  }

  return `No ${activeStatusFilter} saved matches match this search.`;
}

function getSavedMatchSearchContextHint(
  activeStatusFilter: PersistedMatchedOpportunity["status"] | "all"
): string {
  if (activeStatusFilter === "all") {
    return "Searching across all saved matches";
  }

  return `Searching within ${activeStatusFilter} saved matches. Clear search keeps this filter.`;
}

function getSavedMatchSearchCountLabel(
  activeStatusFilter: PersistedMatchedOpportunity["status"] | "all",
  count: number
): string {
  const noun = count === 1 ? "match" : "matches";

  if (activeStatusFilter === "all") {
    return `${count} ${noun}`;
  }

  return `${count} ${activeStatusFilter} ${noun}`;
}

function actionPlanScoutPriorityBias(
  supportScore: number,
  strengthLabel: string | undefined,
  supportGroupLabel: string | undefined,
  originLabel: string | undefined
): { label: "none" | "light" | "strong"; score: number; reason?: string } {
  if (supportScore < 5) {
    return { label: "none", score: 0 };
  }

  let score = 0;

  if (supportScore >= 8) {
    score += 2;
  } else if (supportScore >= 6) {
    score += 1;
  }

  if (strengthLabel === "Strong") {
    score += 3;
  } else if (strengthLabel === "Medium") {
    score += 1;
  }

  if (supportGroupLabel === "Mixed support") {
    score += 2;
  } else if (originLabel === "Reviewed saved match") {
    score += 1;
  }

  if (score >= 5) {
    return {
      label: "strong",
      score,
      reason: supportGroupLabel === "Mixed support"
        ? "Strong corroborated scout support"
        : "Strong scout support"
    };
  }

  if (score >= 2) {
    return {
      label: "light",
      score,
      reason: "Scout-supported tie-break lift"
    };
  }

  return { label: "none", score: 0 };
}

function prioritizeGrowthRhythmCandidates(
  candidates: GrowthRhythmCandidate[],
  scoutSupportByCandidateId: Map<string, ActionPlanScoutSupport>
): GrowthRhythmCandidate[] {
  return [...candidates]
    .map((candidate, index) => ({
      candidate,
      index,
      scoutPriorityBiasScore: scoutSupportByCandidateId.get(candidate.id)?.priorityBiasScore ?? 0
    }))
    .sort((left, right) => {
      const priorityDelta =
        candidatePrioritySortValue(right.candidate.priority) -
        candidatePrioritySortValue(left.candidate.priority);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }

      const biasDelta = right.scoutPriorityBiasScore - left.scoutPriorityBiasScore;
      if (biasDelta !== 0) {
        return biasDelta;
      }

      return left.index - right.index;
    })
    .map((entry) => entry.candidate);
}

function deriveScoutFeedAdapterNote(
  adapterSummary: ScoutFeedAdapterSummary | null | undefined
): string | null {
  if (!adapterSummary) {
    return null;
  }

  const compactLabel = adapterSummary.compactLabel?.trim() || null;

  if (compactLabel && adapterSummary.usedDeterministicFallback) {
    if (compactLabel === "Used deterministic fallback.") {
      return compactLabel;
    }

    return `${compactLabel} Used deterministic fallback.`;
  }

  if (compactLabel) {
    return compactLabel;
  }

  if (adapterSummary.usedDeterministicFallback) {
    return "Used deterministic fallback.";
  }

  return null;
}

function deriveScoutFeedGroupAdapterNote(
  groupLabel: "Audience" | "Solution",
  adapterSummary: ScoutFeedGroupAdapterSummary | null | undefined
): string | null {
  const runLevelNote = deriveScoutFeedAdapterNote(adapterSummary);

  if (!runLevelNote) {
    return null;
  }

  if (runLevelNote.startsWith("Routed as ")) {
    return `${groupLabel} routed as ${runLevelNote.slice("Routed as ".length)}`;
  }

  if (runLevelNote.startsWith("Routed through ")) {
    return `${groupLabel} routed through ${runLevelNote.slice("Routed through ".length)}`;
  }

  if (runLevelNote === "Used deterministic fallback.") {
    return runLevelNote;
  }

  if (runLevelNote.includes(" Used deterministic fallback.")) {
    const [routingLabel] = runLevelNote.split(" Used deterministic fallback.");

    if (routingLabel?.startsWith("Routed as ")) {
      return `${groupLabel} routed as ${routingLabel.slice("Routed as ".length)} Used deterministic fallback.`;
    }

    if (routingLabel?.startsWith("Routed through ")) {
      return `${groupLabel} routed through ${routingLabel.slice("Routed through ".length)} Used deterministic fallback.`;
    }
  }

  return runLevelNote;
}

function deriveScoutFeedItemAdapterNote(
  adapterSummary: ScoutItemAdapterSummary | null | undefined
): string | null {
  if (!adapterSummary) {
    return null;
  }

  let familyLabel: string | null = null;
  if (adapterSummary.family === "public_discussion") {
    familyLabel = "Public discussion";
  } else if (adapterSummary.family === "github_snapshot") {
    familyLabel = "GitHub snapshot";
  } else if (adapterSummary.family === "article_snapshot") {
    familyLabel = "Article snapshot";
  } else if (adapterSummary.family === "watched_url_snapshot") {
    familyLabel = "Watched URL snapshot";
  } else if (adapterSummary.family === "manual_feed") {
    familyLabel = "Manual feed";
  }

  if (familyLabel && adapterSummary.usedDeterministicFallback) {
    return `${familyLabel} · Deterministic fallback`;
  }

  if (familyLabel) {
    return familyLabel;
  }

  if (adapterSummary.usedDeterministicFallback) {
    return "Deterministic fallback";
  }

  return null;
}

function getActionPlanPrioritizationLiftHint(
  scoutSupport: Pick<ActionPlanScoutSupport, "priorityBias" | "priorityReason" | "supportGroupLabel"> | null | undefined
): string | null {
  if (!scoutSupport || scoutSupport.priorityBias === "none") {
    return null;
  }

  if (scoutSupport.supportGroupLabel === "Mixed support") {
    return "Strong corroborated support";
  }

  return "Scout-priority lift";
}

function getOrchestratedPrioritizationLiftHint(
  scoutInfluence: OrchestratedRecommendation["scoutInfluence"] | undefined,
  supportGroupLabel: string | null | undefined
): string | null {
  if (scoutInfluence !== "strong") {
    return null;
  }

  if (supportGroupLabel === "Mixed support") {
    return "Strong corroborated support";
  }

  return "Scout-priority lift";
}

function renderDownstreamPrioritizationLiftHint(hint: string | null | undefined) {
  if (!hint) {
    return null;
  }

  return <p className="mt-2 text-xs font-medium text-emerald-700">{hint}</p>;
}

function getActionPlanPrioritizationLiftReasonLine(
  scoutSupport: Pick<ActionPlanScoutSupport, "priorityBias" | "supportGroupLabel" | "originLabel"> | null | undefined
): string | null {
  if (!scoutSupport || scoutSupport.priorityBias === "none") {
    return null;
  }

  if (scoutSupport.supportGroupLabel === "Mixed support") {
    return "Lifted by corroborated direct + reviewed support";
  }

  if (scoutSupport.originLabel === "Reviewed saved match") {
    return "Lifted by reviewed scout support";
  }

  return "Lifted by strong direct scout support";
}

function getOrchestratedPrioritizationLiftReasonLine(
  scoutInfluence: OrchestratedRecommendation["scoutInfluence"] | undefined,
  supportGroupLabel: string | null | undefined,
  originLabel: string | null | undefined
): string | null {
  if (scoutInfluence !== "strong") {
    return null;
  }

  if (supportGroupLabel === "Mixed support") {
    return "Lifted by corroborated direct + reviewed support";
  }

  if (originLabel === "Reviewed saved match") {
    return "Lifted by reviewed scout support";
  }

  return "Lifted by strong direct scout support";
}

function renderDownstreamPrioritizationLiftReasonLine(reason: string | null | undefined) {
  if (!reason) {
    return null;
  }

  return <p className="mt-1 text-xs text-slate-500">{reason}</p>;
}

function formatWatchlistCadenceLabel(
  value: WatchlistItem["refreshCadence"] | "all"
): string {
  if (value === "all") {
    return "All cadence";
  }

  if (value === "manual_only") {
    return "Manual only";
  }

  if (value === "daily_candidate") {
    return "Daily candidate";
  }

  return "Weekly candidate";
}

function formatWatchlistPriorityLabel(value: WatchlistPriorityFilter): string {
  if (value === "all") {
    return "All priority";
  }

  if (value === "high") {
    return "High priority";
  }

  return "Normal priority";
}

function formatTimeAgo(date: Date): string {
  const now = Date.now();
  const past = date.getTime();
  const diffMs = now - past;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) {
    return "just now";
  }
  if (diffMins < 60) {
    return `${diffMins}m ago`;
  }
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  if (diffDays < 7) {
    return `${diffDays}d ago`;
  }
  return date.toLocaleDateString();
}

function formatWatchlistSourceKindLabel(
  value: WatchlistItem["sourceKind"] | "all"
): string {
  if (value === "all") {
    return "All source kinds";
  }

  return value.replace(/_/g, " ");
}

function shouldRenderDownstreamScoutScoreNote(strengthLabel: string | null | undefined): boolean {
  return strengthLabel === "Strong" || strengthLabel === "Medium";
}

function shouldRenderDownstreamScoutSupportGrouping(strengthLabel: string | null | undefined): boolean {
  return strengthLabel === "Strong" || strengthLabel === "Medium";
}

function formatScoutSupportOriginLabel(origin: "direct_match" | "reviewed_saved_match" | null | undefined) {
  if (origin === "direct_match") {
    return "Direct scout match";
  }

  if (origin === "reviewed_saved_match") {
    return "Reviewed saved match";
  }

  return null;
}

function formatScoutSupportGroupLabel(
  group: "direct_only" | "reviewed_only" | "mixed" | null | undefined
): string | null {
  if (group === "direct_only") {
    return "Direct support";
  }

  if (group === "reviewed_only") {
    return "Reviewed support";
  }

  if (group === "mixed") {
    return "Mixed support";
  }

  return null;
}

function deriveActionPlanScoutSupport(
  candidate: GrowthRhythmCandidate,
  directMatches: MatchedOpportunity[],
  savedMatches: PersistedMatchedOpportunity[]
): ActionPlanScoutSupport | null {
  const strongestDirectMatch = directMatches
    .filter((match) => match.confidence === "high")
    .map((match) => ({ match, score: candidateScoutSupportScore(candidate, match) }))
    .sort((left, right) => right.score - left.score)[0];

  const strongestSavedMatch = savedMatches
    .filter(
      (item) =>
        (item.status === "reviewed" || item.status === "converted") &&
        (item.match.confidence === "high" || item.match.confidence === "medium")
    )
    .map((item) => ({ item, score: candidateScoutSupportScore(candidate, item.match) }))
    .sort((left, right) => right.score - left.score)[0];

  const hasStrongDirectSupport = Boolean(strongestDirectMatch && strongestDirectMatch.score >= 4);
  const hasStrongReviewedSupport = Boolean(strongestSavedMatch && strongestSavedMatch.score >= 4);
  const supportGroupLabel =
    hasStrongDirectSupport && hasStrongReviewedSupport
      ? formatScoutSupportGroupLabel("mixed") ?? undefined
      : hasStrongDirectSupport
        ? formatScoutSupportGroupLabel("direct_only") ?? undefined
        : hasStrongReviewedSupport
          ? formatScoutSupportGroupLabel("reviewed_only") ?? undefined
          : strongestDirectMatch && strongestDirectMatch.score >= 3
            ? formatScoutSupportGroupLabel("direct_only") ?? undefined
            : undefined;

  if (strongestDirectMatch && strongestDirectMatch.score >= 4) {
    const strengthLabel = getMatchStrengthLabel(strongestDirectMatch.match) ?? undefined;
    const priorityBias = actionPlanScoutPriorityBias(
      strongestDirectMatch.score,
      strengthLabel,
      shouldRenderDownstreamScoutSupportGrouping(strengthLabel) ? supportGroupLabel : undefined,
      formatScoutSupportOriginLabel("direct_match") ?? undefined
    );
    return {
      badge: "Pain + solution match",
      badgeKind: "support",
      note: `Scout support: ${strongestDirectMatch.match.matchedSolutionPattern}`,
      strengthLabel,
      originLabel: formatScoutSupportOriginLabel("direct_match") ?? undefined,
      supportGroupLabel: shouldRenderDownstreamScoutSupportGrouping(strengthLabel)
        ? supportGroupLabel
        : undefined,
      scoreNote: shouldRenderDownstreamScoutScoreNote(strengthLabel)
        ? getFirstScoutScoreNoteValue(strongestDirectMatch.match.scoreNotes) ?? undefined
        : undefined,
      priorityBias: priorityBias.label,
      priorityBiasScore: priorityBias.score,
      priorityReason: priorityBias.reason
    };
  }

  if (strongestSavedMatch && strongestSavedMatch.score >= 4) {
    const strengthLabel = getMatchStrengthLabel(strongestSavedMatch.item.match) ?? undefined;
    const priorityBias = actionPlanScoutPriorityBias(
      strongestSavedMatch.score,
      strengthLabel,
      shouldRenderDownstreamScoutSupportGrouping(strengthLabel) ? supportGroupLabel : undefined,
      formatScoutSupportOriginLabel("reviewed_saved_match") ?? undefined
    );
    return {
      badge: "Reviewed scout match",
      badgeKind: "support",
      note: `Scout support: ${strongestSavedMatch.item.match.matchedSolutionPattern}`,
      strengthLabel,
      originLabel: formatScoutSupportOriginLabel("reviewed_saved_match") ?? undefined,
      supportGroupLabel: shouldRenderDownstreamScoutSupportGrouping(strengthLabel)
        ? supportGroupLabel
        : undefined,
      scoreNote: shouldRenderDownstreamScoutScoreNote(strengthLabel)
        ? getFirstScoutScoreNoteValue(strongestSavedMatch.item.match.scoreNotes) ?? undefined
        : undefined,
      priorityBias: priorityBias.label,
      priorityBiasScore: priorityBias.score,
      priorityReason: priorityBias.reason
    };
  }

  if (strongestDirectMatch && strongestDirectMatch.score >= 3) {
    const strengthLabel = getMatchStrengthLabel(strongestDirectMatch.match) ?? undefined;
    const priorityBias = actionPlanScoutPriorityBias(
      strongestDirectMatch.score,
      strengthLabel,
      shouldRenderDownstreamScoutSupportGrouping(strengthLabel) ? supportGroupLabel : undefined,
      formatScoutSupportOriginLabel("direct_match") ?? undefined
    );
    return {
      badge: "Scout-supported",
      badgeKind: "support",
      note: `Scout support: ${strongestDirectMatch.match.matchedSolutionPattern}`,
      strengthLabel,
      originLabel: formatScoutSupportOriginLabel("direct_match") ?? undefined,
      supportGroupLabel: shouldRenderDownstreamScoutSupportGrouping(strengthLabel)
        ? supportGroupLabel
        : undefined,
      scoreNote: shouldRenderDownstreamScoutScoreNote(strengthLabel)
        ? getFirstScoutScoreNoteValue(strongestDirectMatch.match.scoreNotes) ?? undefined
        : undefined,
      priorityBias: priorityBias.label,
      priorityBiasScore: priorityBias.score,
      priorityReason: priorityBias.reason
    };
  }

  return null;
}

function draftFromFeedback(feedback?: ManualOutcomeFeedback): ManualFeedbackDraft {
  if (!feedback) {
    return createDefaultManualFeedbackDraft();
  }

  return {
    status: feedback.status,
    responseLevel: feedback.responseLevel,
    gotReplies: feedback.gotReplies ?? false,
    gotProfileViews: feedback.gotProfileViews ?? false,
    gotLeadSignal: feedback.gotLeadSignal ?? false,
    repeatTopic: feedback.repeatTopic ?? false,
    notes: feedback.notes ?? ""
  };
}

type DashboardSectionKey =
  | "operatorControl"
  | "signals"
  | "ideas"
  | "content"
  | "launchConsole"
  | "reviewTriage"
  | "contentWorkspace"
  | "draftQueue"
  | "autonomousContentAssets"
  | "autonomousWatchlists"
  | "schedulerRuntimeStatus"
  | "factoryCandidates"
  | "factoryRuns"
  | "factoryMemory"
  | "factorySolutions"
  | "factoryCriticReviews"
  | "factoryPriority"
  | "visuals"
  | "analytics"
  | "strategy"
  | "sources"
  | "markets"
  | "topics"
  | "queue"
  | "brandVoice";

interface ApiRequestErrorDetails {
  endpoint: string;
  method: string;
  status?: number;
  responseBody?: string;
  message: string;
}

type SectionErrors = Partial<Record<DashboardSectionKey, ApiRequestErrorDetails>>;

interface InitialLoadRequest {
  key: DashboardSectionKey;
  label: string;
  request: () => Promise<unknown>;
  onSuccess: (value: unknown) => void;
}

function getDefaultApiBaseUrl(): string {
  const configured = import.meta.env.VITE_API_BASE_URL?.trim();
  if (configured && configured.length > 0) {
    return configured;
  }

  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }

  return "http://127.0.0.1:4000";
}

function getFirstParagraph(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }

  const paragraph = trimmed.split(/\n\s*\n/)[0]?.trim();
  if (paragraph) {
    return paragraph;
  }

  const firstLine = trimmed
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  return firstLine ?? trimmed;
}

function truncateText(text: string, maxLength: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function normalizeGroupingKey(value: string | null | undefined): string {
  const normalized = value?.trim().toLowerCase().replace(/\s+/g, " ");
  return normalized && normalized.length > 0 ? normalized : "unknown";
}

function getComparisonDisplayText(
  variant: FinalPostComparisonVariant,
  viewMode: FinalPostComparisonViewMode
): string {
  if (viewMode === "hook") {
    return variant.hook;
  }

  if (viewMode === "firstParagraph") {
    return getFirstParagraph(variant.body);
  }

  return variant.body;
}

function summarizeSignalTitle(signalText: string): string {
  const firstSentence = signalText
    .trim()
    .split(/(?<=[.!?])\s+/)[0]
    ?.replace(/[.!?]+$/, "")
    .trim();
  if (!firstSentence) {
    return "Decision candidate";
  }

  const compact = firstSentence.length > 72
    ? `${firstSentence.slice(0, 69).trim()}...`
    : firstSentence;
  return compact || "Decision candidate";
}

function mapDecisionSourceToSignalSource(
  sourceType: DecisionLayerInput["sourceType"] | undefined
): SourceType {
  if (sourceType === "github" || sourceType === "article") {
    return "research";
  }
  if (sourceType === "commentary") {
    return "social";
  }
  return "manual";
}

function parseScoutInputList(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function mapScoutActionToSavedAction(
  suggestedActionType: AudienceScoutItem["suggestedActionType"]
): SavedDecisionItem["recommendedAction"] {
  if (suggestedActionType === "comment_opportunity") {
    return "generate_comment";
  }

  if (suggestedActionType === "reply_opportunity") {
    return "generate_reply";
  }

  if (suggestedActionType === "later") {
    return "save_for_later";
  }

  return "generate_post_candidate";
}

function mapScoutActionToBestAngle(
  suggestedActionType: AudienceScoutItem["suggestedActionType"]
): SavedDecisionItem["bestAngle"] {
  if (suggestedActionType === "comment_opportunity") {
    return "handoff_failure";
  }

  if (suggestedActionType === "reply_opportunity") {
    return "exception_handling";
  }

  if (suggestedActionType === "later") {
    return "low_fit";
  }

  return "workflow_accountability";
}

function createSavedAudienceScoutItem(item: AudienceScoutItem): SavedDecisionItem {
  return {
    id: `saved-${Date.now()}`,
    signalText: item.painSignalSummary,
    bestAngle: mapScoutActionToBestAngle(item.suggestedActionType),
    reasoningSummary: item.whyItMatters,
    priority: item.confidence === "high" ? "high" : item.confidence === "medium" ? "medium" : "low",
    recommendedAction: mapScoutActionToSavedAction(item.suggestedActionType),
    createdAt: new Date().toISOString(),
    status: "new",
    sourceType: "commentary",
    targetRole: item.authorRole,
    companyContext: item.topicCluster,
    postContext: item.rawExcerpt,
    relevanceScore: item.confidence === "high" ? 78 : item.confidence === "medium" ? 64 : 42
  };
}

function mapSolutionScoutActionToSavedAction(
  suggestedActionType: SolutionScoutItem["suggestedActionType"]
): SavedDecisionItem["recommendedAction"] {
  if (suggestedActionType === "comment_opportunity") {
    return "generate_comment";
  }

  if (suggestedActionType === "reply_opportunity") {
    return "generate_reply";
  }

  if (suggestedActionType === "later") {
    return "save_for_later";
  }

  return "generate_post_candidate";
}

function createSavedSolutionScoutItem(item: SolutionScoutItem): SavedDecisionItem {
  return {
    id: `saved-${Date.now()}`,
    signalText: item.implementationLesson,
    bestAngle: item.suggestedAngle,
    reasoningSummary: `${item.whyItMatters} Tradeoff: ${item.tradeoffOrConstraint}`,
    priority: item.confidence === "high" ? "high" : item.confidence === "medium" ? "medium" : "low",
    recommendedAction: mapSolutionScoutActionToSavedAction(item.suggestedActionType),
    createdAt: new Date().toISOString(),
    status: "new",
    sourceType:
      item.sourceType === "github"
        ? "github"
        : item.sourceType === "article"
          ? "article"
          : "manual",
    companyContext: item.solutionPattern,
    postContext: item.rawExcerpt,
    relevanceScore: item.confidence === "high" ? 80 : item.confidence === "medium" ? 66 : 44
  };
}

function mapMatchedActionToSavedAction(
  action: ScoutMatchResult["items"][number]["recommendedAction"]
): SavedDecisionItem["recommendedAction"] {
  if (action === "write_comment") {
    return "generate_comment";
  }

  if (action === "write_reply") {
    return "generate_reply";
  }

  if (action === "save_for_later") {
    return "save_for_later";
  }

  return "generate_post_candidate";
}

function createSavedMatchedOpportunityItem(
  item: ScoutMatchResult["items"][number]
): SavedDecisionItem {
  return {
    id: `saved-${Date.now()}`,
    signalText: item.matchedPain,
    bestAngle: item.suggestedAngle,
    reasoningSummary: item.whyThisMatchWorks,
    priority: item.confidence === "high" ? "high" : item.confidence === "medium" ? "medium" : "low",
    recommendedAction: mapMatchedActionToSavedAction(item.recommendedAction),
    createdAt: new Date().toISOString(),
    status: "new",
    sourceType: "manual",
    companyContext: item.matchedSolutionPattern
  };
}

function createPersistedMatchedOpportunity(
  item: ScoutMatchResult["items"][number]
): PersistedMatchedOpportunity {
  return {
    id: `saved-match-${Date.now()}`,
    match: item,
    status: "new",
    createdAt: new Date().toISOString()
  };
}

function normalizePersistedMatchedOpportunity(
  value: unknown
): PersistedMatchedOpportunity | null {
  const raw = value as Record<string, unknown> | null;
  const match = raw?.match as Record<string, unknown> | undefined;

  if (
    !(
      typeof raw === "object" &&
      raw !== null &&
      typeof raw.id === "string" &&
      typeof raw.status === "string" &&
      typeof raw.createdAt === "string" &&
      typeof match === "object" &&
      match !== null &&
      typeof match.id === "string" &&
      typeof match.audienceItemId === "string" &&
      typeof match.solutionItemId === "string" &&
      typeof match.matchedPain === "string" &&
      typeof match.matchedSolutionPattern === "string" &&
      typeof match.whyThisMatchWorks === "string" &&
      typeof match.suggestedAngle === "string" &&
      typeof match.recommendedAction === "string" &&
      typeof match.confidence === "string" &&
      typeof match.createdAt === "string"
    )
  ) {
    return null;
  }

  if (!["new", "reviewed", "converted", "archived"].includes(raw.status)) {
    return null;
  }

  if (
    !["write_post", "write_comment", "write_reply", "save_for_later"].includes(
      String(match.recommendedAction)
    ) ||
    !["high", "medium", "low"].includes(String(match.confidence))
  ) {
    return null;
  }

  return {
    id: raw.id,
    match: {
      id: match.id,
      audienceItemId: match.audienceItemId,
      solutionItemId: match.solutionItemId,
      matchedPain: match.matchedPain,
      matchedSolutionPattern: match.matchedSolutionPattern,
      whyThisMatchWorks: match.whyThisMatchWorks,
      suggestedAngle: match.suggestedAngle as ScoutMatchResult["items"][number]["suggestedAngle"],
      recommendedAction:
        match.recommendedAction as ScoutMatchResult["items"][number]["recommendedAction"],
      confidence: match.confidence as ScoutMatchResult["items"][number]["confidence"],
      opportunityStrength:
        match.opportunityStrength === "strong" ||
        match.opportunityStrength === "medium" ||
        match.opportunityStrength === "weak"
          ? (match.opportunityStrength as ScoutMatchResult["items"][number]["opportunityStrength"])
          : undefined,
      scoreNotes: Array.isArray(match.scoreNotes)
        ? match.scoreNotes.filter((note): note is string => typeof note === "string")
        : undefined,
      aiEnrichment: normalizeAIScoutEnrichment(match.aiEnrichment),
      aiContent: normalizeAIContent(match.aiContent),
      createdAt: match.createdAt
    },
    status: raw.status as PersistedMatchedOpportunity["status"],
    createdAt: raw.createdAt,
    lastActionAt: typeof raw.lastActionAt === "string" ? raw.lastActionAt : undefined
  };
}

function normalizeAIScoutEnrichment(value: unknown): AIScoutEnrichment | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const raw = value as Record<string, unknown>;
  const aiEnrichment: AIScoutEnrichment = {
    improvedSummary:
      typeof raw.improvedSummary === "string" ? raw.improvedSummary : undefined,
    whyItMatters: typeof raw.whyItMatters === "string" ? raw.whyItMatters : undefined,
    businessConsequence:
      typeof raw.businessConsequence === "string" ? raw.businessConsequence : undefined,
    operatorAngle: typeof raw.operatorAngle === "string" ? raw.operatorAngle : undefined,
    uncertaintyNote:
      typeof raw.uncertaintyNote === "string" ? raw.uncertaintyNote : undefined
  };

  return Object.values(aiEnrichment).some(Boolean) ? aiEnrichment : undefined;
}

function normalizeAIContent(value: unknown): AIContentGeneration | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const raw = value as Record<string, unknown>;
  const warnings = Array.isArray(raw.warnings)
    ? raw.warnings.filter(
        (warning): warning is string =>
          typeof warning === "string" && warning.trim().length > 0
      )
    : undefined;
  const aiContent: AIContentGeneration = {
    contentIdea: typeof raw.contentIdea === "string" ? raw.contentIdea : undefined,
    draftAngle: typeof raw.draftAngle === "string" ? raw.draftAngle : undefined,
    postSeed: typeof raw.postSeed === "string" ? raw.postSeed : undefined,
    commentSeed: typeof raw.commentSeed === "string" ? raw.commentSeed : undefined,
    angleStub: typeof raw.angleStub === "string" ? raw.angleStub : undefined,
    warnings: warnings && warnings.length > 0 ? warnings : undefined,
    provider: typeof raw.provider === "string" ? raw.provider : undefined
  };

  return Object.entries(aiContent).some(([key, value]) =>
    key === "warnings"
      ? Array.isArray(value) && value.length > 0
      : typeof value === "string" && value.trim().length > 0
  )
    ? aiContent
    : undefined;
}

function normalizeLiveIngestionItem(value: unknown): LiveIngestionItem | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const raw = value as Record<string, unknown>;
  if (
    typeof raw.id !== "string" ||
    typeof raw.sourceKind !== "string" ||
    ![
      "public_excerpt",
      "watched_url_snapshot",
      "github_watch_snapshot",
      "article_watch_snapshot",
      "manual_feed_snapshot"
    ].includes(raw.sourceKind) ||
    typeof raw.rawExcerpt !== "string" ||
    typeof raw.capturedAt !== "string" ||
    typeof raw.fingerprint !== "string" ||
    typeof raw.status !== "string" ||
    !["draft", "new", "sent_to_feed", "archived", "discarded"].includes(raw.status)
  ) {
    return null;
  }

  return {
    id: raw.id,
    sourceKind: raw.sourceKind as LiveIngestionItem["sourceKind"],
    sourceLabel: typeof raw.sourceLabel === "string" ? raw.sourceLabel : undefined,
    sourceUrl: typeof raw.sourceUrl === "string" ? raw.sourceUrl : undefined,
    rawExcerpt: raw.rawExcerpt,
    capturedAt: raw.capturedAt,
    fingerprint: raw.fingerprint,
    status: raw.status as LiveIngestionItem["status"],
    origin:
      raw.origin === "manual" || raw.origin === "watchlist_refresh"
        ? raw.origin
        : undefined,
    watchlistItemId: typeof raw.watchlistItemId === "string" ? raw.watchlistItemId : undefined,
    refreshRunId: typeof raw.refreshRunId === "string" ? raw.refreshRunId : undefined,
    refreshRunLabel: typeof raw.refreshRunLabel === "string" ? raw.refreshRunLabel : undefined,
    notes: typeof raw.notes === "string" ? raw.notes : undefined
  };
}

function normalizeLiveIngestionRefreshRun(value: unknown): LiveIngestionRefreshRun | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const raw = value as Record<string, unknown>;
  if (
    typeof raw.id !== "string" ||
    typeof raw.label !== "string" ||
    typeof raw.triggeredAt !== "string" ||
    typeof raw.createdCount !== "number" ||
    typeof raw.skippedCount !== "number" ||
    typeof raw.triggerType !== "string" ||
    ![
      "single_watchlist",
      "active_watchlists",
      "daily_candidate",
      "weekly_candidate"
    ].includes(raw.triggerType) ||
    !Array.isArray(raw.watchlistIds) ||
    !Array.isArray(raw.watchlistLabels)
  ) {
    return null;
  }

  return {
    id: raw.id,
    label: raw.label,
    triggerType: raw.triggerType as LiveIngestionRefreshRun["triggerType"],
    triggeredAt: raw.triggeredAt,
    createdCount: raw.createdCount,
    skippedCount: raw.skippedCount,
    watchlistIds: raw.watchlistIds.filter((entry): entry is string => typeof entry === "string"),
    watchlistLabels: raw.watchlistLabels.filter((entry): entry is string => typeof entry === "string"),
    reviewStatus:
      typeof raw.reviewStatus === "string" &&
      ["open", "completed", "archived"].includes(raw.reviewStatus)
        ? (raw.reviewStatus as LiveIngestionRefreshRun["reviewStatus"])
        : "open"
  };
}

function normalizeSavedDecisionItem(value: unknown): SavedDecisionItem | null {
  const raw = value as Record<string, unknown> | null;
  if (
    !(
      typeof raw === "object" &&
      raw !== null &&
      typeof raw.id === "string" &&
      typeof raw.signalText === "string" &&
      typeof raw.bestAngle === "string" &&
      typeof raw.reasoningSummary === "string" &&
      typeof raw.priority === "string" &&
      typeof raw.recommendedAction === "string" &&
      typeof raw.createdAt === "string"
    )
  ) {
    return null;
  }

  const status =
    typeof raw.status === "string" &&
    ["new", "sent", "done", "archived"].includes(raw.status)
      ? (raw.status as SavedDecisionItem["status"])
      : "new";

  const lastActionAt =
    typeof raw.lastActionAt === "string"
      ? raw.lastActionAt
      : undefined;

  if (
    (typeof raw.sourceType === "string" || raw.sourceType === undefined) &&
    (typeof raw.targetRole === "string" || raw.targetRole === undefined) &&
    (typeof raw.companyContext === "string" || raw.companyContext === undefined) &&
    (typeof raw.postContext === "string" || raw.postContext === undefined) &&
    (typeof raw.relevanceScore === "number" || raw.relevanceScore === undefined)
  ) {
    return {
      id: raw.id,
      signalText: raw.signalText,
      bestAngle: raw.bestAngle as SavedDecisionItem["bestAngle"],
      reasoningSummary: raw.reasoningSummary,
      priority: raw.priority as SavedDecisionItem["priority"],
      recommendedAction: raw.recommendedAction as SavedDecisionItem["recommendedAction"],
      createdAt: raw.createdAt,
      status,
      lastActionAt,
      sourceType: raw.sourceType as SavedDecisionItem["sourceType"],
      targetRole: raw.targetRole,
      companyContext: raw.companyContext,
      postContext: raw.postContext,
      relevanceScore: raw.relevanceScore
    };
  }

  return null;
}

function mapSavedDecisionItemToGrowthCandidate(item: SavedDecisionItem): GrowthRhythmCandidate {
  return {
    id: item.id,
    title: item.signalText,
    suggestedAction: item.recommendedAction,
    priority: item.priority,
    status: item.status,
    bestAngle: item.bestAngle,
    reasoningSummary: item.reasoningSummary,
    sourceType: item.sourceType === "commentary" ? "social" : item.sourceType
  };
}

function mapQueueItemToGrowthCandidate(item: ContentQueueItem): GrowthRhythmCandidate {
  return {
    id: item.id,
    title: `Queue item: ${item.recommendedAction}`,
    suggestedAction: item.recommendedAction,
    priority: item.priority,
    status: item.status === "queued" ? "queued" : item.status,
    reasoningSummary: item.reason
  };
}

function readSavedDecisionItems(): SavedDecisionItem[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(SAVED_FOR_LATER_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map(normalizeSavedDecisionItem)
      .filter((item): item is SavedDecisionItem => item !== null);
  } catch {
    return [];
  }
}

function readSavedMatchesStore(): PersistedMatchedOpportunity[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(SAVED_MATCHES_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return [];
    }

    const items = (parsed as SavedMatchesStoreState).items;
    if (!Array.isArray(items)) {
      return [];
    }

    return items
      .map(normalizePersistedMatchedOpportunity)
      .filter((item): item is PersistedMatchedOpportunity => item !== null);
  } catch {
    return [];
  }
}

function readLiveIngestionBuffer(): LiveIngestionItem[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(LIVE_INGESTION_BUFFER_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return [];
    }

    const items = (parsed as LiveIngestionBufferState).items;
    if (!Array.isArray(items)) {
      return [];
    }

    return items
      .map(normalizeLiveIngestionItem)
      .filter((item): item is LiveIngestionItem => item !== null);
  } catch {
    return [];
  }
}

function readLiveIngestionRefreshRuns(): LiveIngestionRefreshRun[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(LIVE_INGESTION_REFRESH_RUNS_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return [];
    }

    const items = (parsed as LiveIngestionRefreshRunStoreState).items;
    if (!Array.isArray(items)) {
      return [];
    }

    return items
      .map(normalizeLiveIngestionRefreshRun)
      .filter((item): item is LiveIngestionRefreshRun => item !== null);
  } catch {
    return [];
  }
}

function normalizeWatchlistItem(value: unknown): WatchlistItem | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const raw = value as Record<string, unknown>;
  if (
    typeof raw.id !== "string" ||
    typeof raw.sourceKind !== "string" ||
    ![
      "watched_url",
      "github_repo",
      "github_release",
      "github_issue",
      "article_source",
      "public_discussion_source"
    ].includes(raw.sourceKind) ||
    typeof raw.label !== "string" ||
    typeof raw.isActive !== "boolean" ||
    typeof raw.createdAt !== "string"
  ) {
    return null;
  }

  return {
    id: raw.id,
    sourceKind: raw.sourceKind as WatchlistItem["sourceKind"],
    label: raw.label,
    sourceUrl: typeof raw.sourceUrl === "string" ? raw.sourceUrl : undefined,
    notes: typeof raw.notes === "string" ? raw.notes : undefined,
    refreshCadence:
      raw.refreshCadence === "daily_candidate" || raw.refreshCadence === "weekly_candidate"
        ? raw.refreshCadence
        : "manual_only",
    priority: raw.priority === "high" || raw.priority === "normal" ? raw.priority : undefined,
    isActive: raw.isActive,
    createdAt: raw.createdAt,
    lastUsedAt: typeof raw.lastUsedAt === "string" ? raw.lastUsedAt : undefined,
    lastRefreshedAt: typeof raw.lastRefreshedAt === "string" ? raw.lastRefreshedAt : undefined
  };
}

function readWatchlistStore(): WatchlistItem[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(WATCHLISTS_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return [];
    }

    const items = (parsed as WatchlistStoreState).items;
    if (!Array.isArray(items)) {
      return [];
    }

    return items
      .map(normalizeWatchlistItem)
      .filter((item): item is WatchlistItem => item !== null);
  } catch {
    return [];
  }
}

function readQueueFilterPreference(): QueueFilter {
  if (typeof window === "undefined") {
    return "all";
  }

  const raw = window.localStorage.getItem(QUEUE_FILTER_STORAGE_KEY);
  return raw && isQueueFilter(raw) ? raw : "all";
}

function readQueueSortPreference(): QueueSort {
  if (typeof window === "undefined") {
    return "newest";
  }

  const raw = window.localStorage.getItem(QUEUE_SORT_STORAGE_KEY);
  return raw && isQueueSort(raw) ? raw : "newest";
}

function createSavedDecisionItem(
  payload: RecommendedActionPayload,
  decisionPlan: DecisionPlan
): SavedDecisionItem {
  const priority =
    decisionPlan.contentPriority === "high" || decisionPlan.engagementPriority !== "low"
      ? decisionPlan.contentPriority
      : decisionPlan.engagementPriority;

  return {
    id: `saved-${Date.now()}`,
    signalText: payload.signalText,
    bestAngle: decisionPlan.bestAngle,
    reasoningSummary: decisionPlan.reasoningSummary,
    priority,
    recommendedAction: decisionPlan.recommendedNextAction,
    createdAt: new Date().toISOString(),
    status: "new",
    sourceType: payload.sourceType,
    targetRole: payload.targetRole,
    companyContext: payload.companyContext,
    postContext: payload.postContext,
    relevanceScore: payload.relevanceScore
  };
}

function createSavedSourceIntakeItem(normalized: NormalizedSourceSignal): SavedDecisionItem {
  return {
    id: `saved-${Date.now()}`,
    signalText: normalized.normalizedSignalText,
    bestAngle: normalized.suggestedAngle,
    reasoningSummary: normalized.reasoningSummary,
    priority: "medium",
    recommendedAction: "save_for_later",
    createdAt: new Date().toISOString(),
    status: "new",
    sourceType: normalized.plannerReadyPayload.sourceType,
    targetRole: normalized.targetRole,
    companyContext: normalized.companyContext
  };
}

const initialSignalForm: CreateSignalInput = {
  title: "",
  sourceType: "manual",
  rawText: ""
};

const initialSourceForm: CreateSourceItemInput = {
  title: "",
  sourceType: "manual",
  sourceUrl: "",
  rawText: ""
};

const initialSourceIntakeForm: SourceIntakeInput = {
  sourceType: "article",
  title: "",
  sourceUrl: "",
  summaryText: "",
  operatorNotes: "",
  githubSubtype: undefined,
  repoName: "",
  repoContext: "",
  releaseOrChangeType: "",
  targetRole: "",
  companyContext: ""
};

const initialMarketForm: CreateMarketProfileInput = {
  country: "",
  region: "",
  primaryLanguage: "",
  marketNote: ""
};

const initialAnalyticsForm: CreateAnalyticsSnapshotInput = {
  contentAssetId: "",
  impressions: 0,
  likes: 0,
  comments: 0,
  saves: 0,
  profileViews: 0,
  followersGained: 0,
  reactions: 0,
  reposts: 0,
  inboundLeads: 0,
  postUrl: "",
  platform: "linkedin",
  publishedAt: "",
  qualitativeNotes: ""
};

const initialBrandVoiceForm: CreateBrandVoiceProfileInput = {
  name: "",
  tone: "",
  audience: "",
  writingRules: [],
  bannedPatterns: [],
  preferredPatterns: [],
  styleNotes: "",
  isActive: true
};

const initialCommentForm: GenerateCommentInput = {
  sourcePostText: "",
  positioningContext: "",
  targetRole: "",
  companyContext: "",
  reasoningSummary: "",
  useRelevanceAdaptation: false
};

const initialReplyForm: GenerateReplyInput = {
  ourPostText: "",
  incomingCommentText: "",
  context: "",
  targetRole: "",
  companyContext: "",
  reasoningSummary: "",
  useRelevanceAdaptation: false
};

const initialRelevanceForm: AnalyzeRelevanceInput = {
  companyText: "",
  roleTitle: "",
  postText: "",
  websiteAboutText: "",
  hasCommentContext: false
};

const initialDecisionForm: DecisionLayerInput = {
  signalText: "",
  sourceType: "manual",
  signalCategory: "",
  authorRole: "",
  targetRole: "",
  companyContext: "",
  postContext: "",
  reasoningSummary: "",
  brandVoiceHints: "",
  recentAnalyticsHints: "",
  hasCommentContext: false,
  hasReplyContext: false
};

const initialFinalPostConfig: FinalPostGenerationConfig = {
  hookMode: "sharp_observation",
  antiBlandness: false,
  outcomeAwareShaping: false,
  preserveBrandVoice: true,
  preservePublishabilityFocus: true
};

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`);
  }

  return (await response.json()) as T;
}

function withRelevanceAssist<T extends GenerateCommentInput | GenerateReplyInput>(
  form: T,
  relevanceResult: RelevanceAnalysis | null
): T {
  if (!form.useRelevanceAdaptation || !relevanceResult) {
    return form;
  }

  return {
    ...form,
    relevanceScore: form.relevanceScore ?? relevanceResult.relevanceScore,
    bestAngle: form.bestAngle ?? relevanceResult.bestAngle,
    recommendedAction: form.recommendedAction ?? relevanceResult.recommendedAction,
    reasoningSummary: form.reasoningSummary || relevanceResult.reasoningSummary
  };
}

async function createApiRequestError(
  response: Response,
  endpoint: string,
  method: string
): Promise<ApiRequestErrorDetails> {
  const contentType = response.headers.get("content-type") ?? "";
  let responseBody = "";

  if (contentType.includes("application/json")) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: string; message?: string }
      | null;
    responseBody = payload?.error ?? payload?.message ?? "";
  } else {
    responseBody = (await response.text().catch(() => "")) || "";
  }

  return {
    endpoint,
    method,
    status: response.status,
    responseBody: responseBody || undefined,
    message: responseBody || `Request failed with ${response.status}`
  };
}

async function requestJson<T>(
  apiBaseUrl: string,
  endpoint: string,
  method = "GET",
  init?: RequestInit
): Promise<T> {
  const authToken =
    typeof window === "undefined"
      ? null
      : window.localStorage.getItem(OPERATOR_AUTH_TOKEN_STORAGE_KEY);
  const headers = new Headers(init?.headers);

  if (authToken) {
    headers.set("Authorization", `Bearer ${authToken}`);
  }

  let response: Response;

  try {
    response = await fetch(`${apiBaseUrl}${endpoint}`, {
      ...init,
      method,
      headers
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Network request failed";
    throw {
      endpoint,
      method,
      message,
      responseBody: message
    } satisfies ApiRequestErrorDetails;
  }

  if (!response.ok) {
    throw await createApiRequestError(response, endpoint, method);
  }

  return parseResponse<T>(response);
}

function formatApiRequestError(error: ApiRequestErrorDetails): string {
  const parts = [`${error.method} ${error.endpoint}`];

  if (error.status) {
    parts.push(`Status: ${error.status}`);
  }

  if (error.responseBody) {
    parts.push(error.responseBody);
  } else if (error.message) {
    parts.push(error.message);
  }

  return parts.join(" | ");
}

function isApiRequestError(error: unknown): error is ApiRequestErrorDetails {
  return (
    typeof error === "object" &&
    error !== null &&
    "endpoint" in error &&
    "method" in error &&
    "message" in error
  );
}

function persistOperatorAuthToken(token: string): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(OPERATOR_AUTH_TOKEN_STORAGE_KEY, token);
}

function clearOperatorAuthToken(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(OPERATOR_AUTH_TOKEN_STORAGE_KEY);
}

function readOperatorAuthToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(OPERATOR_AUTH_TOKEN_STORAGE_KEY);
}

function getSectionLabel(sectionKey: DashboardSectionKey): string {
  switch (sectionKey) {
    case "operatorControl":
      return "Operator Control";
    case "signals":
      return "Signals";
    case "ideas":
      return "Ideas";
    case "content":
      return "Content drafts";
    case "launchConsole":
      return "Launch console";
    case "reviewTriage":
      return "Review and triage console";
    case "contentWorkspace":
      return "Server content workspace";
    case "draftQueue":
      return "Server draft queue";
    case "factoryCandidates":
      return "Factory candidate queue";
    case "factoryRuns":
      return "Factory runs";
    case "factoryMemory":
      return "Factory memory insights";
    case "factorySolutions":
      return "Factory solution memories";
    case "factoryCriticReviews":
      return "Factory critic reviews";
    case "factoryPriority":
      return "Factory priority";
    case "visuals":
      return "Visual briefs";
    case "analytics":
      return "Analytics";
    case "strategy":
      return "Strategy recommendations";
    case "sources":
      return "Sources";
    case "markets":
      return "Markets";
    case "topics":
      return "Topic scores";
    case "queue":
      return "Content queue";
    case "brandVoice":
      return "Brand voice";
    default:
      return sectionKey;
  }
}

function SectionErrorMessage({
  error,
  label
}: {
  error?: ApiRequestErrorDetails;
  label: string;
}) {
  if (!error) {
    return null;
  }

  return (
    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
      <p className="font-medium">{label} failed: {error.method} {error.endpoint}</p>
      <p className="mt-1 text-xs">Status: {error.status ?? "network error"}</p>
      <p className="mt-1 text-xs">{error.responseBody ?? error.message}</p>
      <p className="mt-2 text-xs font-medium">Section unavailable.</p>
    </div>
  );
}

function formatOperationalLabel(value: string | null | undefined): string {
  if (!value) {
    return "unknown";
  }

  return value.replace(/_/g, " ");
}

function getWorkspaceStatusBadgeKind(
  status: AutonomousContentWorkItem["status"]
): "repeat" | "avoid" | "support" | "neutral" {
  if (status === "ready_for_draft") {
    return "repeat";
  }

  if (status === "blocked" || status === "archived") {
    return "avoid";
  }

  if (status === "draft") {
    return "support";
  }

  return "neutral";
}

function getMatchedOpportunityReviewStateBadgeKind(
  reviewState: AutonomousMatchedOpportunity["reviewState"]
): "repeat" | "avoid" | "support" | "current" | "neutral" {
  if (reviewState === "saved") {
    return "repeat";
  }

  if (reviewState === "in_review") {
    return "current";
  }

  if (reviewState === "dismissed" || reviewState === "archived") {
    return "avoid";
  }

  return "neutral";
}

function getPriorityBandBadgeKind(
  priorityBand: AutonomousMatchedOpportunity["priorityBand"]
): "repeat" | "support" | "neutral" {
  if (priorityBand === "high") {
    return "repeat";
  }

  if (priorityBand === "medium") {
    return "support";
  }

  return "neutral";
}

function getFactoryPriorityBadgeKind(
  priorityLabel: "high" | "medium" | "low"
): "repeat" | "support" | "neutral" {
  if (priorityLabel === "high") {
    return "repeat";
  }

  if (priorityLabel === "medium") {
    return "support";
  }

  return "neutral";
}

function getFactoryActionBadgeKind(
  action: FactoryPrioritySelectionResult["signals"][number]["recommendedAction"]
): "repeat" | "support" | "avoid" | "neutral" {
  if (action === "run_now" || action === "queue_for_review") {
    return "repeat";
  }

  if (action === "retry_later" || action === "rerun_when_window_matches") {
    return "support";
  }

  if (action === "deprioritize" || action === "skip") {
    return "avoid";
  }

  return "neutral";
}

function getCandidateReviewBadgeKind(
  state: CandidateQueueItem["queueState"]
): "repeat" | "support" | "avoid" | "neutral" {
  if (state === "ready_to_publish") {
    return "repeat";
  }

  if (state === "revision_requested" || state === "ready_for_review") {
    return "support";
  }

  if (state === "archived" || state === "blocked") {
    return "avoid";
  }

  return "neutral";
}

function formatCandidateQueueStateLabel(state: CandidateQueueItem["queueState"]): string {
  switch (state) {
    case "ready_to_publish":
      return "ready to publish";
    case "revision_requested":
      return "needs revision";
    case "ready_for_review":
      return "needs review";
    case "archived":
      return "archived";
    default:
      return formatOperationalLabel(state);
  }
}

function summarizeCriticOutcome(
  criticReview: WritingQualityAssessment | undefined,
  contentAsset: ContentAsset | undefined
): string {
  if (criticReview?.criticNotes) {
    return truncateText(criticReview.criticNotes, 140);
  }

  if (criticReview?.publishReadyFlag || contentAsset?.publishReadyFlag) {
    return "The draft is strong enough to move into publication handling.";
  }

  if (criticReview?.rewriteSuggestions?.length) {
    return `Main risk: ${truncateText(criticReview.rewriteSuggestions[0] ?? "", 112)}`;
  }

  return "This draft still needs operator review before it moves forward.";
}

function formatCandidatePrimaryReason(
  candidate: CandidateQueueItem,
  priorityDecision: FactoryPrioritySelectionResult["candidateQueueItems"][number] | undefined,
  content: ContentAsset | undefined
): string {
  return truncateText(
    priorityDecision?.reasonSummary ??
      candidate.whyQueued ??
      content?.bestAngle ??
      "Ready for review.",
    96
  );
}

function getFactoryRunStatusBadgeKind(
  status: AutonomousRun["status"]
): "repeat" | "support" | "avoid" | "neutral" {
  if (status === "completed") {
    return "repeat";
  }

  if (status === "partial") {
    return "support";
  }

  if (status === "blocked" || status === "failed") {
    return "avoid";
  }

  return "neutral";
}

function formatFactoryRunArtifacts(run: AutonomousRun): string {
  const produced = [
    run.resultMetadata?.producedSignalAnalysisId ? "analysis" : null,
    run.resultMetadata?.producedSolutionMemoryId ? "solution memory" : null,
    run.resultMetadata?.producedOrchestratorDecisionId ? "decision" : null,
    run.resultMetadata?.producedContentAssetId ? "content" : null,
    run.resultMetadata?.producedCriticReviewId ? "critic review" : null,
    run.resultMetadata?.producedCandidateQueueItemId ? "queue handoff" : null
  ].filter(Boolean);

  return produced.length > 0 ? produced.join(" · ") : "No downstream artifacts persisted";
}

function getWorkspaceDraftProgressDisplay(
  item: AutonomousContentWorkItem
): {
  badge: string;
  badgeKind: "repeat" | "avoid" | "support" | "neutral";
  detail: string;
} {
  const progress = item.draftProgress;

  if (!progress?.hasDraft) {
    return {
      badge: "no draft",
      badgeKind: "neutral",
      detail: "No server draft yet"
    };
  }

  if (progress.draftStatus === "ready") {
    return {
      badge: "draft ready",
      badgeKind: "repeat",
      detail: "Linked server draft is ready"
    };
  }

  if (progress.draftStatus === "blocked") {
    return {
      badge: "draft blocked",
      badgeKind: "avoid",
      detail: "Linked server draft is blocked"
    };
  }

  if (progress.draftStatus === "archived") {
    return {
      badge: "draft archived",
      badgeKind: "neutral",
      detail: "Linked server draft is archived"
    };
  }

  return {
    badge: "draft in progress",
    badgeKind: "support",
    detail: "Linked server draft exists"
  };
}

function buildContentWorkspaceEndpoint(filters: {
  status: ContentWorkspaceStatusFilter;
  kind: ContentWorkspaceKindFilter;
  hasDraft: ContentWorkspaceHasDraftFilter;
  draftStatus: ContentWorkspaceDraftStatusFilter;
  sort: ContentWorkspaceSortOption;
}) {
  const params = new URLSearchParams();

  if (filters.status !== "all") {
    params.set("status", filters.status);
  }

  if (filters.kind !== "all") {
    params.set("kind", filters.kind);
  }

  if (filters.hasDraft !== "all") {
    params.set("hasDraft", filters.hasDraft);
  }

  if (filters.draftStatus !== "all") {
    params.set("draftStatus", filters.draftStatus);
  }

  if (filters.sort !== "updated_desc") {
    params.set("sort", filters.sort);
  }

  const query = params.toString();
  return query.length > 0 ? `/autonomy/content-work-items?${query}` : "/autonomy/content-work-items";
}

function buildDraftQueueEndpoint(status: DraftQueueStatusFilter, sort: DraftQueueSortOption) {
  const params = new URLSearchParams();
  if (status !== "all") {
    params.set("status", status);
  }
  if (sort !== "updated_desc") {
    params.set("sort", sort);
  }

  if (params.size === 0) {
    return "/autonomy/drafts";
  }

  return `/autonomy/drafts?${params.toString()}`;
}

function buildPrioritizedOpportunitiesEndpoint(reviewState: ReviewTriageReviewStateFilter) {
  if (reviewState === "all") {
    return "/autonomy/prioritized-opportunities";
  }

  const params = new URLSearchParams();
  params.set("reviewState", reviewState);
  return `/autonomy/prioritized-opportunities?${params.toString()}`;
}

const SUPERVISED_MVP_IN_SCOPE = [
  "Operator auth",
  "Launch diagnostics",
  "Review & triage",
  "Content workspace",
  "Draft queue"
] as const;

const SUPERVISED_MVP_OUT_OF_SCOPE = [
  "No publish or schedule UI in this launch package.",
  "No unattended promotion, posting, or external execution.",
  "No RBAC, OAuth, or multi-tenant workspace model in this step."
] as const;

const SUPERVISED_MVP_REQUIRED_CONFIG = [
  "OPERATOR_USERNAME",
  "OPERATOR_PASSWORD",
  "CORS_ORIGINS"
] as const;

type CompactBadgeKind = "repeat" | "avoid" | "current" | "neutral" | "support";

export default function App({ apiBaseUrl = getDefaultApiBaseUrl() }: AppProps) {
  const [operatorSession, setOperatorSession] = useState<OperatorSession | null>(null);
  const [authBooting, setAuthBooting] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [operatorUsername, setOperatorUsername] = useState("operator");
  const [operatorPassword, setOperatorPassword] = useState("");
  const [loggingInOperator, setLoggingInOperator] = useState(false);
  const [loggingOutOperator, setLoggingOutOperator] = useState(false);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [contentAssets, setContentAssets] = useState<ContentAsset[]>([]);
  const [aiRuntimeHealth, setAiRuntimeHealth] = useState<AIRuntimeHealthSummary | null>(null);
  const [schedulerRuntimeStatus, setSchedulerRuntimeStatus] = useState<{
    enabled: boolean;
    running: boolean;
    intervalMs: number;
    isTickInFlight: boolean;
    lastTickStartedAt?: string;
    lastTickCompletedAt?: string;
    lastTickOutcome?: { status: "completed"; runCount: number; dueWatchlistCount: number } | { status: "failed"; errorSummary: string };
  } | null>(null);
  const [launchPreflight, setLaunchPreflight] = useState<LaunchPreflightResult | null>(null);
  const [providerProbeResult, setProviderProbeResult] = useState<AIProviderProbeResult | null>(null);
  const [providerProbeError, setProviderProbeError] = useState<ApiRequestErrorDetails | null>(null);
  const [launchSmokeRunResult, setLaunchSmokeRunResult] = useState<LaunchSmokeRunResult | null>(null);
  const [launchSmokeRunError, setLaunchSmokeRunError] = useState<ApiRequestErrorDetails | null>(
    null
  );
  const [reviewQueueItems, setReviewQueueItems] = useState<AutonomousReviewQueueItem[]>([]);
  const [matchedOpportunities, setMatchedOpportunities] = useState<AutonomousMatchedOpportunity[]>(
    []
  );
  const [reviewTriageReviewStateFilter, setReviewTriageReviewStateFilter] =
    useState<ReviewTriageReviewStateFilter>("all");
  const [selectedMatchedOpportunityId, setSelectedMatchedOpportunityId] = useState<string | null>(
    null
  );
  const [matchedOpportunityReviewStateSelection, setMatchedOpportunityReviewStateSelection] =
    useState<MatchedOpportunityReviewStateOption>("new");
  const [matchedOpportunityActionError, setMatchedOpportunityActionError] =
    useState<ApiRequestErrorDetails | null>(null);
  const [contentWorkspaceItems, setContentWorkspaceItems] = useState<AutonomousContentWorkItem[]>(
    []
  );
  const [draftQueueItems, setDraftQueueItems] = useState<AutonomousDraftDocument[]>([]);
  const [autonomousContentAssets, setAutonomousContentAssets] = useState<ContentAsset[]>([]);
  const [autonomousWatchlists, setAutonomousWatchlists] = useState<AutonomousWatchlist[]>([]);
  const [reviewingDraftId, setReviewingDraftId] = useState<string | null>(null);
  const [reviewingDraftDocument, setReviewingDraftDocument] = useState<ContentAsset | null>(null);
  const [draftReviewActionInProgress, setDraftReviewActionInProgress] = useState(false);
  const [draftReviewError, setDraftReviewError] = useState<string | null>(null);
  const [factoryCandidateQueueItems, setFactoryCandidateQueueItems] = useState<CandidateQueueItem[]>(
    []
  );
  const [factoryRuns, setFactoryRuns] = useState<AutonomousRun[]>([]);
  const [factoryMemoryPatterns, setFactoryMemoryPatterns] = useState<MemoryPattern[]>([]);
  const [factorySolutionMemories, setFactorySolutionMemories] = useState<SolutionMemory[]>([]);
  const [factoryCriticReviews, setFactoryCriticReviews] = useState<WritingQualityAssessment[]>(
    []
  );
  const [factoryPrioritySelection, setFactoryPrioritySelection] =
    useState<FactoryPrioritySelectionResult | null>(null);
  const [operatorControlStatus, setOperatorControlStatus] = useState<OperatorControlStatus | null>(null);
  const [selectedFactoryCandidateId, setSelectedFactoryCandidateId] = useState<string | null>(null);
  const [selectedFactoryCandidateDetail, setSelectedFactoryCandidateDetail] =
    useState<CandidateQueueItemDetail | null>(null);
  const [selectedFactoryCandidateLoading, setSelectedFactoryCandidateLoading] = useState(false);
  const [selectedFactoryCandidateError, setSelectedFactoryCandidateError] =
    useState<ApiRequestErrorDetails | null>(null);
  const [candidateReviewNote, setCandidateReviewNote] = useState("");
  const [candidateReviewActionPending, setCandidateReviewActionPending] = useState(false);
  const [candidateReviewActionError, setCandidateReviewActionError] =
    useState<ApiRequestErrorDetails | null>(null);
  const [draftQueueStatusFilter, setDraftQueueStatusFilter] =
    useState<DraftQueueStatusFilter>("all");
  const [draftQueueSort, setDraftQueueSort] = useState<DraftQueueSortOption>("updated_desc");
  const [contentWorkspaceStatusFilter, setContentWorkspaceStatusFilter] =
    useState<ContentWorkspaceStatusFilter>("all");
  const [contentWorkspaceKindFilter, setContentWorkspaceKindFilter] =
    useState<ContentWorkspaceKindFilter>("all");
  const [contentWorkspaceHasDraftFilter, setContentWorkspaceHasDraftFilter] =
    useState<ContentWorkspaceHasDraftFilter>("all");
  const [contentWorkspaceDraftStatusFilter, setContentWorkspaceDraftStatusFilter] =
    useState<ContentWorkspaceDraftStatusFilter>("all");
  const [contentWorkspaceSort, setContentWorkspaceSort] =
    useState<ContentWorkspaceSortOption>("updated_desc");
  const [selectedContentWorkspaceItemId, setSelectedContentWorkspaceItemId] = useState<
    string | null
  >(null);
  const [selectedContentWorkspaceItem, setSelectedContentWorkspaceItem] =
    useState<AutonomousContentWorkItem | null>(null);
  const [selectedContentWorkspaceItemError, setSelectedContentWorkspaceItemError] =
    useState<ApiRequestErrorDetails | null>(null);
  const [workItemStatusSelection, setWorkItemStatusSelection] =
    useState<WorkItemStatusOption>("draft");
  const [workItemStatusSaveError, setWorkItemStatusSaveError] =
    useState<ApiRequestErrorDetails | null>(null);
  const [selectedDraftDocument, setSelectedDraftDocument] =
    useState<AutonomousDraftDocument | null>(null);
  const [selectedDraftDocumentId, setSelectedDraftDocumentId] = useState<string | null>(null);
  const [selectedDraftDocumentError, setSelectedDraftDocumentError] =
    useState<ApiRequestErrorDetails | null>(null);
  const [isEditingDraftDocument, setIsEditingDraftDocument] = useState(false);
  const [draftEditForm, setDraftEditForm] = useState<DraftEditFormState>({
    title: "",
    body: "",
    angle: ""
  });
  const [operatorDashboardMode, setOperatorDashboardMode] = useState<"day_1" | "control" | "lab" | "legacy" | "factory">(
    "day_1"
  );
  const [draftStatusSelection, setDraftStatusSelection] = useState<DraftStatusOption>("draft");
  const [draftSaveError, setDraftSaveError] = useState<ApiRequestErrorDetails | null>(null);
  const [draftStatusSaveError, setDraftStatusSaveError] = useState<ApiRequestErrorDetails | null>(
    null
  );
  const [draftCreationError, setDraftCreationError] = useState<ApiRequestErrorDetails | null>(null);
  const isOperatorDayOneMode = operatorDashboardMode === "day_1";
  const [visualAssets, setVisualAssets] = useState<VisualAsset[]>([]);
  const [analyticsSnapshots, setAnalyticsSnapshots] = useState<AnalyticsSnapshot[]>([]);
  const [recommendations, setRecommendations] = useState<StrategyRecommendation[]>([]);
  const [sourceItems, setSourceItems] = useState<SourceItem[]>([]);
  const [marketProfiles, setMarketProfiles] = useState<MarketProfile[]>([]);
  const [topicScores, setTopicScores] = useState<TopicScore[]>([]);
  const [contentQueue, setContentQueue] = useState<ContentQueueItem[]>([]);
  const [brandVoice, setBrandVoice] = useState<BrandVoiceProfile | null>(null);
  const [experimentalFinalPosts, setExperimentalFinalPosts] = useState<
    ExperimentalFinalPost[]
  >([]);
  const [finalPostComparison, setFinalPostComparison] =
    useState<FinalPostComparisonState | null>(null);
  const [finalPostComparisonViewMode, setFinalPostComparisonViewMode] =
    useState<FinalPostComparisonViewMode>("full");
  const [signalForm, setSignalForm] = useState<CreateSignalInput>(initialSignalForm);
  const [sourceForm, setSourceForm] = useState<CreateSourceItemInput>(initialSourceForm);
  const [sourceIntakeForm, setSourceIntakeForm] =
    useState<SourceIntakeInput>(initialSourceIntakeForm);
  const [audienceScoutForm, setAudienceScoutForm] =
    useState<AudienceScoutFormState>(initialAudienceScoutForm);
  const [solutionScoutForm, setSolutionScoutForm] =
    useState<SolutionScoutFormState>(initialSolutionScoutForm);
  const [scoutFeedForm, setScoutFeedForm] =
    useState<ScoutFeedFormState>(initialScoutFeedForm);
  const [liveIngestionBufferForm, setLiveIngestionBufferForm] =
    useState<LiveIngestionBufferFormState>(initialLiveIngestionBufferForm);
  const [watchlistForm, setWatchlistForm] = useState<WatchlistFormState>(initialWatchlistForm);
  const [marketForm, setMarketForm] = useState<CreateMarketProfileInput>(initialMarketForm);
  const [brandVoiceForm, setBrandVoiceForm] =
    useState<CreateBrandVoiceProfileInput>(initialBrandVoiceForm);
  const [commentForm, setCommentForm] = useState<GenerateCommentInput>(initialCommentForm);
  const [replyForm, setReplyForm] = useState<GenerateReplyInput>(initialReplyForm);
  const [relevanceForm, setRelevanceForm] = useState<AnalyzeRelevanceInput>(initialRelevanceForm);
  const [decisionForm, setDecisionForm] = useState<DecisionLayerInput>(initialDecisionForm);
  const [analyticsForm, setAnalyticsForm] =
    useState<CreateAnalyticsSnapshotInput>(initialAnalyticsForm);
  const [generatedComment, setGeneratedComment] = useState<GeneratedComment | null>(null);
  const [generatedReply, setGeneratedReply] = useState<GeneratedReply | null>(null);
  const [relevanceResult, setRelevanceResult] = useState<RelevanceAnalysis | null>(null);
  const [decisionPlan, setDecisionPlan] = useState<DecisionPlan | null>(null);
  const [growthRhythmPlan, setGrowthRhythmPlan] = useState<GrowthRhythmPlan | null>(null);
  const [orchestratedRecommendation, setOrchestratedRecommendation] =
    useState<OrchestratedRecommendation | null>(null);
  const [normalizedSourceSignal, setNormalizedSourceSignal] =
    useState<NormalizedSourceSignal | null>(null);
  const [audienceScoutResult, setAudienceScoutResult] =
    useState<AudienceScoutResult | null>(null);
  const [solutionScoutResult, setSolutionScoutResult] =
    useState<SolutionScoutResult | null>(null);
  const [scoutFeedResult, setScoutFeedResult] = useState<ScoutFeedResult | null>(null);
  const [liveIngestionBuffer, setLiveIngestionBuffer] = useState<LiveIngestionItem[]>([]);
  const [liveIngestionRefreshRuns, setLiveIngestionRefreshRuns] = useState<LiveIngestionRefreshRun[]>([]);
  const [watchlistItems, setWatchlistItems] = useState<WatchlistItem[]>([]);
  const [selectedLiveIngestionItemIds, setSelectedLiveIngestionItemIds] = useState<string[]>([]);
  const [liveIngestionDraftEdits, setLiveIngestionDraftEdits] = useState<Record<string, string>>(
    {}
  );
  const [activeLiveIngestionFilter, setActiveLiveIngestionFilter] =
    useState<LiveIngestionFilter>("all");
  const [activeLiveIngestionOriginFilter, setActiveLiveIngestionOriginFilter] =
    useState<LiveIngestionOriginFilter>("all");
  const [activeLiveIngestionSourceKindFilter, setActiveLiveIngestionSourceKindFilter] =
    useState<LiveIngestionSourceKindFilter>("all");
  const [activeLiveIngestionRefreshRunFilter, setActiveLiveIngestionRefreshRunFilter] =
    useState<string>("all");
  const [liveIngestionSearchQuery, setLiveIngestionSearchQuery] = useState("");
  const [activeWatchlistFilter, setActiveWatchlistFilter] = useState<WatchlistActiveFilter>("all");
  const [activeWatchlistCadenceFilter, setActiveWatchlistCadenceFilter] =
    useState<WatchlistCadenceFilter>("all");
  const [activeWatchlistPriorityFilter, setActiveWatchlistPriorityFilter] =
    useState<WatchlistPriorityFilter>("all");
  const [activeWatchlistSourceKindFilter, setActiveWatchlistSourceKindFilter] =
    useState<WatchlistSourceKindFilter>("all");
  const [scoutMatchResult, setScoutMatchResult] = useState<ScoutMatchResult | null>(null);
  const [createdSignalFromIntake, setCreatedSignalFromIntake] = useState<Signal | null>(null);
  const [createdIdeaFromIntake, setCreatedIdeaFromIntake] = useState<Idea | null>(null);
  const [recommendedActionPayload, setRecommendedActionPayload] =
    useState<RecommendedActionPayload | null>(null);
  const [savedDecisionItems, setSavedDecisionItems] = useState<SavedDecisionItem[]>([]);
  const [savedMatchedOpportunities, setSavedMatchedOpportunities] = useState<
    PersistedMatchedOpportunity[]
  >([]);
  const [activeSavedMatchStatusFilter, setActiveSavedMatchStatusFilter] =
    useState<SavedMatchStatusFilter>("all");
  const [savedMatchSearchQuery, setSavedMatchSearchQuery] = useState("");
  const [manualOutcomeFeedback, setManualOutcomeFeedback] = useState<ManualOutcomeFeedback[]>([]);
  const [patternMemorySummary, setPatternMemorySummary] = useState<PatternMemorySummary>(() =>
    readPatternMemorySummary()
  );
  const [manualFeedbackDrafts, setManualFeedbackDrafts] = useState<
    Record<string, ManualFeedbackDraft>
  >({});
  const [activeQueueFilter, setActiveQueueFilter] = useState<QueueFilter>(() =>
    readQueueFilterPreference()
  );
  const [activeQueueSort, setActiveQueueSort] = useState<QueueSort>(() =>
    readQueueSortPreference()
  );
  const [queueSearchQuery, setQueueSearchQuery] = useState("");
  const [finalPostConfig, setFinalPostConfig] =
    useState<FinalPostGenerationConfig>(initialFinalPostConfig);
  const [decisionActionMessage, setDecisionActionMessage] = useState<string | null>(null);
  const [sourceIntakeActionMessage, setSourceIntakeActionMessage] = useState<string | null>(null);
  const [audienceScoutActionMessage, setAudienceScoutActionMessage] = useState<string | null>(null);
  const [solutionScoutActionMessage, setSolutionScoutActionMessage] = useState<string | null>(null);
  const [scoutFeedActionMessage, setScoutFeedActionMessage] = useState<string | null>(null);
  const [liveIngestionActionMessage, setLiveIngestionActionMessage] = useState<string | null>(null);
  const [watchlistActionMessage, setWatchlistActionMessage] = useState<string | null>(null);
  const [scoutMatchActionMessage, setScoutMatchActionMessage] = useState<string | null>(null);
  const [savedMatchesActionMessage, setSavedMatchesActionMessage] = useState<string | null>(null);
  const [growthRhythmActionMessage, setGrowthRhythmActionMessage] = useState<string | null>(null);
  const [orchestratedActionMessage, setOrchestratedActionMessage] = useState<string | null>(null);
  const [manualFeedbackMessage, setManualFeedbackMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadErrors, setLoadErrors] = useState<SectionErrors>({});
  const [loadingReviewTriage, setLoadingReviewTriage] = useState(false);
  const [savingMatchedOpportunityReviewState, setSavingMatchedOpportunityReviewState] =
    useState(false);
  const [promotingMatchedOpportunity, setPromotingMatchedOpportunity] = useState(false);
  const [loadingContentWorkspace, setLoadingContentWorkspace] = useState(false);
  const [loadingContentWorkspaceItem, setLoadingContentWorkspaceItem] = useState(false);
  const [savingContentWorkspaceItemStatus, setSavingContentWorkspaceItemStatus] = useState(false);
  const [loadingDraftDocument, setLoadingDraftDocument] = useState(false);
  const [savingDraftDocument, setSavingDraftDocument] = useState(false);
  const [savingDraftStatus, setSavingDraftStatus] = useState(false);
  const [creatingDraftDocument, setCreatingDraftDocument] = useState(false);
  const [probingProvider, setProbingProvider] = useState(false);
  const [runningLaunchSmokeRun, setRunningLaunchSmokeRun] = useState(false);
  const [submittingSignal, setSubmittingSignal] = useState(false);
  const [submittingSource, setSubmittingSource] = useState(false);
  const [submittingMarket, setSubmittingMarket] = useState(false);
  const [submittingAnalytics, setSubmittingAnalytics] = useState(false);
  const [submittingBrandVoice, setSubmittingBrandVoice] = useState(false);
  const [submittingComment, setSubmittingComment] = useState(false);
  const [submittingReply, setSubmittingReply] = useState(false);
  const [submittingRelevance, setSubmittingRelevance] = useState(false);
  const [submittingDecision, setSubmittingDecision] = useState(false);
  const [planningGrowthRhythm, setPlanningGrowthRhythm] = useState(false);
  const [submittingSourceIntake, setSubmittingSourceIntake] = useState(false);
  const [scoutingAudience, setScoutingAudience] = useState(false);
  const [scoutingSolutions, setScoutingSolutions] = useState(false);
  const [runningScoutFeed, setRunningScoutFeed] = useState(false);
  const [matchingScoutOpportunities, setMatchingScoutOpportunities] = useState(false);
  const [generatingSavedMatchContentId, setGeneratingSavedMatchContentId] = useState<string | null>(
    null
  );
  const [creatingSignalFromIntake, setCreatingSignalFromIntake] = useState(false);
  const [highlightedSignalId, setHighlightedSignalId] = useState<string | null>(null);
  const [highlightedSavedDecisionItemId, setHighlightedSavedDecisionItemId] = useState<
    string | null
  >(null);
  const [workingSignalId, setWorkingSignalId] = useState<string | null>(null);
  const [workingIdeaId, setWorkingIdeaId] = useState<string | null>(null);
  const [refiningContentId, setRefiningContentId] = useState<string | null>(null);
  const [finalizingContentId, setFinalizingContentId] = useState<string | null>(null);
  const [finalizingV2ContentId, setFinalizingV2ContentId] = useState<string | null>(null);
  const [comparingContentId, setComparingContentId] = useState<string | null>(null);
  const [visualizingContentId, setVisualizingContentId] = useState<string | null>(null);
  const [analyzingStrategy, setAnalyzingStrategy] = useState(false);
  const [recommendingNextMove, setRecommendingNextMove] = useState(false);
  const [scoringTopics, setScoringTopics] = useState(false);
  const [buildingQueue, setBuildingQueue] = useState(false);

  useEffect(() => {
    setSavedDecisionItems(readSavedDecisionItems());
    setSavedMatchedOpportunities(readSavedMatchesStore());
    setLiveIngestionBuffer(readLiveIngestionBuffer());
    setLiveIngestionRefreshRuns(readLiveIngestionRefreshRuns());
    setWatchlistItems(readWatchlistStore());
    setManualOutcomeFeedback(readManualOutcomeFeedback());
    setPatternMemorySummary(readPatternMemorySummary());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      SAVED_FOR_LATER_STORAGE_KEY,
      JSON.stringify(savedDecisionItems)
    );
  }, [savedDecisionItems]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      SAVED_MATCHES_STORAGE_KEY,
      JSON.stringify({ items: savedMatchedOpportunities } satisfies SavedMatchesStoreState)
    );
  }, [savedMatchedOpportunities]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      LIVE_INGESTION_BUFFER_STORAGE_KEY,
      JSON.stringify({ items: liveIngestionBuffer } satisfies LiveIngestionBufferState)
    );
  }, [liveIngestionBuffer]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      LIVE_INGESTION_REFRESH_RUNS_STORAGE_KEY,
      JSON.stringify({ items: liveIngestionRefreshRuns } satisfies LiveIngestionRefreshRunStoreState)
    );
  }, [liveIngestionRefreshRuns]);

  useEffect(() => {
    if (
      activeLiveIngestionRefreshRunFilter !== "all" &&
      !liveIngestionRefreshRuns.some((run) => run.id === activeLiveIngestionRefreshRunFilter)
    ) {
      setActiveLiveIngestionRefreshRunFilter("all");
    }
  }, [activeLiveIngestionRefreshRunFilter, liveIngestionRefreshRuns]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      WATCHLISTS_STORAGE_KEY,
      JSON.stringify({ items: watchlistItems } satisfies WatchlistStoreState)
    );
  }, [watchlistItems]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      MANUAL_FEEDBACK_STORAGE_KEY,
      JSON.stringify(manualOutcomeFeedback)
    );
  }, [manualOutcomeFeedback]);

  useEffect(() => {
    if (manualOutcomeFeedback.length === 0) {
      return;
    }

    setPatternMemorySummary(buildPatternMemorySummary(manualOutcomeFeedback));
  }, [manualOutcomeFeedback]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      PATTERN_MEMORY_STORAGE_KEY,
      JSON.stringify(patternMemorySummary)
    );
  }, [patternMemorySummary]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(QUEUE_FILTER_STORAGE_KEY, activeQueueFilter);
  }, [activeQueueFilter]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(QUEUE_SORT_STORAGE_KEY, activeQueueSort);
  }, [activeQueueSort]);

  const counts = useMemo(
    () => ({
      signals: `${signals.length} total`,
      ideas: `${ideas.length} total`,
      content: `${contentAssets.length} total`,
      contentWorkspace: `${contentWorkspaceItems.filter(w => w.status !== "archived").length} active`,
      draftQueue: `${draftQueueItems.filter(d => d.status === "draft" || d.status === "ready").length} for review`,
      finalPosts: `${contentAssets.filter((asset) => asset.finalStatus === "ready").length + experimentalFinalPosts.length} ready`,
      visuals: `${visualAssets.length} total`,
      analytics: `${analyticsSnapshots.length} snapshots`,
      strategy: `${recommendations.length} total`,
      sources: `${sourceItems.length} total`,
      markets: `${marketProfiles.length} total`,
      topics: `${topicScores.length} scores`,
      queue: `${contentQueue.length} total`
    }),
    [
      signals.length,
      ideas.length,
      contentAssets,
      contentWorkspaceItems.length,
      draftQueueItems.length,
      experimentalFinalPosts.length,
      visualAssets.length,
      analyticsSnapshots.length,
      recommendations.length,
      sourceItems.length,
      marketProfiles.length,
      topicScores.length,
      contentQueue.length
    ]
  );

  const filteredSavedDecisionItems = useMemo(() => {
    if (activeQueueFilter === "all") {
      return savedDecisionItems;
    }

    if (activeQueueFilter === "active") {
      return savedDecisionItems.filter(
        (item) => item.status === "new" || item.status === "sent"
      );
    }

    return savedDecisionItems.filter((item) => item.status === activeQueueFilter);
  }, [activeQueueFilter, savedDecisionItems]);

  const searchedSavedDecisionItems = useMemo(() => {
    const normalizedQuery = queueSearchQuery.trim().toLowerCase();

    if (!normalizedQuery) {
      return filteredSavedDecisionItems;
    }

    return filteredSavedDecisionItems.filter((item) => {
      const searchableValues = [item.signalText, item.bestAngle, item.reasoningSummary];

      return searchableValues.some((value) =>
        value ? value.toLowerCase().includes(normalizedQuery) : false
      );
    });
  }, [filteredSavedDecisionItems, queueSearchQuery]);

  const queueFilterCounts = useMemo(
    () => ({
      all: savedDecisionItems.length,
      active: savedDecisionItems.filter(
        (item) => item.status === "new" || item.status === "sent"
      ).length,
      done: savedDecisionItems.filter((item) => item.status === "done").length,
      archived: savedDecisionItems.filter((item) => item.status === "archived").length
    }),
    [savedDecisionItems]
  );

  const filteredAndSortedSavedDecisionItems = useMemo(() => {
    const items = [...searchedSavedDecisionItems];

    const getTimestampValue = (value: string) => {
      const parsed = Date.parse(value);
      return Number.isNaN(parsed) ? 0 : parsed;
    };

    items.sort((left, right) => {
      const leftCreatedAt = getTimestampValue(left.createdAt);
      const rightCreatedAt = getTimestampValue(right.createdAt);

      if (activeQueueSort === "oldest") {
        return leftCreatedAt - rightCreatedAt;
      }

      if (activeQueueSort === "lastAction") {
        const leftLastAction = left.lastActionAt
          ? getTimestampValue(left.lastActionAt)
          : leftCreatedAt;
        const rightLastAction = right.lastActionAt
          ? getTimestampValue(right.lastActionAt)
          : rightCreatedAt;

        return rightLastAction - leftLastAction;
      }

      return rightCreatedAt - leftCreatedAt;
    });

    return items;
  }, [activeQueueSort, searchedSavedDecisionItems]);

  const sortedSavedMatchedOpportunities = useMemo(() => {
    const items = [...savedMatchedOpportunities];

    items.sort((left, right) => {
      const statusDelta = savedMatchStatusSortValue(right.status) - savedMatchStatusSortValue(left.status);
      if (statusDelta !== 0) {
        return statusDelta;
      }

      const strengthDelta =
        scoutStrengthSortValue(getMatchStrengthLabel(right.match)) -
        scoutStrengthSortValue(getMatchStrengthLabel(left.match));
      if (strengthDelta !== 0) {
        return strengthDelta;
      }

      const confidenceDelta =
        savedMatchConfidenceSortValue(right.match.confidence) -
        savedMatchConfidenceSortValue(left.match.confidence);
      if (confidenceDelta !== 0) {
        return confidenceDelta;
      }

      const leftTimestamp = Date.parse(left.lastActionAt ?? left.createdAt);
      const rightTimestamp = Date.parse(right.lastActionAt ?? right.createdAt);
      return (Number.isNaN(rightTimestamp) ? 0 : rightTimestamp) -
        (Number.isNaN(leftTimestamp) ? 0 : leftTimestamp);
    });

    return items;
  }, [savedMatchedOpportunities]);

  const savedMatchFilterCounts = useMemo(
    () => ({
      all: savedMatchedOpportunities.length,
      new: savedMatchedOpportunities.filter((item) => item.status === "new").length,
      reviewed: savedMatchedOpportunities.filter((item) => item.status === "reviewed").length,
      converted: savedMatchedOpportunities.filter((item) => item.status === "converted").length,
      archived: savedMatchedOpportunities.filter((item) => item.status === "archived").length
    }),
    [savedMatchedOpportunities]
  );

  const savedMatchReviewSummary = useMemo(() => {
    const today = new Date();

    return {
      strongActive: savedMatchedOpportunities.filter(
        (item) =>
          (item.status === "new" || item.status === "reviewed") &&
          item.match.opportunityStrength === "strong"
      ).length,
      needsReview: savedMatchedOpportunities.filter((item) => item.status === "new").length,
      convertedToday: savedMatchedOpportunities.filter(
        (item) => item.status === "converted" && isSameLocalCalendarDay(item.lastActionAt, today)
      ).length
    };
  }, [savedMatchedOpportunities]);

  const filteredSavedMatchedOpportunities = useMemo(
    () =>
      activeSavedMatchStatusFilter === "all"
        ? sortedSavedMatchedOpportunities
        : sortedSavedMatchedOpportunities.filter((item) => item.status === activeSavedMatchStatusFilter),
    [activeSavedMatchStatusFilter, sortedSavedMatchedOpportunities]
  );

  const searchedSavedMatchedOpportunities = useMemo(() => {
    const normalizedQuery = savedMatchSearchQuery.trim().toLowerCase();

    if (!normalizedQuery) {
      return filteredSavedMatchedOpportunities;
    }

    return filteredSavedMatchedOpportunities.filter((item) => {
      const searchableValues = [
        item.match.matchedPain,
        item.match.matchedSolutionPattern,
        item.match.whyThisMatchWorks,
        item.match.suggestedAngle,
        item.match.recommendedAction
      ];

      return searchableValues.some((value) => value.toLowerCase().includes(normalizedQuery));
    });
  }, [filteredSavedMatchedOpportunities, savedMatchSearchQuery]);
  const hasActiveSavedMatchSearch = savedMatchSearchQuery.trim().length > 0;
  const showInlineSavedMatchSearchRecovery =
    hasActiveSavedMatchSearch && searchedSavedMatchedOpportunities.length === 0;

  const sortedLiveIngestionBuffer = useMemo(() => {
    const items = [...liveIngestionBuffer];

    items.sort((left, right) => {
      const leftTimestamp = Date.parse(left.capturedAt);
      const rightTimestamp = Date.parse(right.capturedAt);
      return (Number.isNaN(rightTimestamp) ? 0 : rightTimestamp) -
        (Number.isNaN(leftTimestamp) ? 0 : leftTimestamp);
    });

    return items;
  }, [liveIngestionBuffer]);

  const sortedWatchlistItems = useMemo(() => {
    const items = [...watchlistItems];

    items.sort((left, right) => {
      const leftTimestamp = Date.parse(left.createdAt);
      const rightTimestamp = Date.parse(right.createdAt);
      return (Number.isNaN(rightTimestamp) ? 0 : rightTimestamp) -
        (Number.isNaN(leftTimestamp) ? 0 : leftTimestamp);
    });

    return items;
  }, [watchlistItems]);

  const sortedLiveIngestionRefreshRuns = useMemo(() => {
    const items = [...liveIngestionRefreshRuns];

    items.sort((left, right) => {
      const statusDifference =
        getLiveIngestionRefreshRunReviewStatusRank(left.reviewStatus) -
        getLiveIngestionRefreshRunReviewStatusRank(right.reviewStatus);
      if (statusDifference !== 0) {
        return statusDifference;
      }

      const leftTimestamp = Date.parse(left.triggeredAt);
      const rightTimestamp = Date.parse(right.triggeredAt);
      return (Number.isNaN(rightTimestamp) ? 0 : rightTimestamp) -
        (Number.isNaN(leftTimestamp) ? 0 : leftTimestamp);
    });

    return items;
  }, [liveIngestionRefreshRuns]);

  const recentLiveIngestionRefreshRuns = useMemo(
    () => sortedLiveIngestionRefreshRuns.slice(0, 6),
    [sortedLiveIngestionRefreshRuns]
  );

  const watchlistFilterCounts = useMemo(
    () => ({
      all: watchlistItems.length,
      active: watchlistItems.filter((item) => item.isActive).length,
      inactive: watchlistItems.filter((item) => !item.isActive).length
    }),
    [watchlistItems]
  );

  const watchlistCadenceFilterCounts = useMemo(
    () => ({
      all: watchlistItems.length,
      manual_only: watchlistItems.filter((item) => item.refreshCadence === "manual_only").length,
      daily_candidate: watchlistItems.filter((item) => item.refreshCadence === "daily_candidate")
        .length,
      weekly_candidate: watchlistItems.filter((item) => item.refreshCadence === "weekly_candidate")
        .length
    }),
    [watchlistItems]
  );

  const watchlistPriorityFilterCounts = useMemo(
    () => ({
      all: watchlistItems.length,
      high: watchlistItems.filter((item) => item.priority === "high").length,
      normal: watchlistItems.filter((item) => (item.priority ?? "normal") !== "high").length
    }),
    [watchlistItems]
  );

  const watchlistSourceKindFilterCounts = useMemo(
    () => ({
      all: watchlistItems.length,
      watched_url: watchlistItems.filter((item) => item.sourceKind === "watched_url").length,
      github_repo: watchlistItems.filter((item) => item.sourceKind === "github_repo").length,
      github_release: watchlistItems.filter((item) => item.sourceKind === "github_release").length,
      github_issue: watchlistItems.filter((item) => item.sourceKind === "github_issue").length,
      article_source: watchlistItems.filter((item) => item.sourceKind === "article_source").length,
      public_discussion_source: watchlistItems.filter(
        (item) => item.sourceKind === "public_discussion_source"
      ).length
    }),
    [watchlistItems]
  );

  const filteredWatchlistItems = useMemo(
    () =>
      sortedWatchlistItems.filter((item) => {
        const matchesActive =
          activeWatchlistFilter === "all" ||
          (activeWatchlistFilter === "active" ? item.isActive : !item.isActive);
        const matchesCadence =
          activeWatchlistCadenceFilter === "all" ||
          item.refreshCadence === activeWatchlistCadenceFilter;
        const matchesPriority =
          activeWatchlistPriorityFilter === "all" ||
          (activeWatchlistPriorityFilter === "high"
            ? item.priority === "high"
            : (item.priority ?? "normal") !== "high");
        const matchesSourceKind =
          activeWatchlistSourceKindFilter === "all" ||
          item.sourceKind === activeWatchlistSourceKindFilter;

        return matchesActive && matchesCadence && matchesPriority && matchesSourceKind;
      }),
    [
      activeWatchlistCadenceFilter,
      activeWatchlistFilter,
      activeWatchlistPriorityFilter,
      activeWatchlistSourceKindFilter,
      sortedWatchlistItems
    ]
  );

  const liveIngestionFilterCounts = useMemo(
    () => ({
      all: liveIngestionBuffer.length,
      draft: liveIngestionBuffer.filter((item) => item.status === "draft").length,
      new: liveIngestionBuffer.filter((item) => item.status === "new").length,
      sent_to_feed: liveIngestionBuffer.filter((item) => item.status === "sent_to_feed").length,
      archived: liveIngestionBuffer.filter((item) => item.status === "archived").length,
      discarded: liveIngestionBuffer.filter((item) => item.status === "discarded").length
    }),
    [liveIngestionBuffer]
  );

  const liveIngestionOriginFilterCounts = useMemo(
    () => ({
      all: liveIngestionBuffer.length,
      manual: liveIngestionBuffer.filter((item) => (item.origin ?? "manual") === "manual").length,
      watchlist_refresh: liveIngestionBuffer.filter((item) => item.origin === "watchlist_refresh")
        .length
    }),
    [liveIngestionBuffer]
  );

  const liveIngestionSourceKindFilterCounts = useMemo(
    () => ({
      all: liveIngestionBuffer.length,
      public_excerpt: liveIngestionBuffer.filter((item) => item.sourceKind === "public_excerpt")
        .length,
      watched_url_snapshot: liveIngestionBuffer.filter(
        (item) => item.sourceKind === "watched_url_snapshot"
      ).length,
      github_watch_snapshot: liveIngestionBuffer.filter(
        (item) => item.sourceKind === "github_watch_snapshot"
      ).length,
      article_watch_snapshot: liveIngestionBuffer.filter(
        (item) => item.sourceKind === "article_watch_snapshot"
      ).length,
      manual_feed_snapshot: liveIngestionBuffer.filter(
        (item) => item.sourceKind === "manual_feed_snapshot"
      ).length
    }),
    [liveIngestionBuffer]
  );

  const filteredLiveIngestionBuffer = useMemo(() => {
    const normalizedQuery = liveIngestionSearchQuery.trim().toLowerCase();

    return sortedLiveIngestionBuffer.filter((item) => {
      const matchesStatus =
        activeLiveIngestionFilter === "all" || item.status === activeLiveIngestionFilter;
      const itemOrigin = item.origin ?? "manual";
      const matchesOrigin =
        activeLiveIngestionOriginFilter === "all" || itemOrigin === activeLiveIngestionOriginFilter;
      const matchesSourceKind =
        activeLiveIngestionSourceKindFilter === "all" ||
        item.sourceKind === activeLiveIngestionSourceKindFilter;
      const matchesRefreshRun =
        activeLiveIngestionRefreshRunFilter === "all" ||
        item.refreshRunId === activeLiveIngestionRefreshRunFilter;
      const matchesSearch =
        normalizedQuery.length === 0
          ? true
          : [item.sourceLabel, item.sourceUrl, item.rawExcerpt, item.notes].some((value) =>
              value ? value.toLowerCase().includes(normalizedQuery) : false
            );

      return matchesStatus && matchesOrigin && matchesSourceKind && matchesRefreshRun && matchesSearch;
    });
  }, [
    activeLiveIngestionFilter,
    activeLiveIngestionOriginFilter,
    activeLiveIngestionRefreshRunFilter,
    activeLiveIngestionSourceKindFilter,
    liveIngestionSearchQuery,
    sortedLiveIngestionBuffer
  ]);

  const activeLiveIngestionRefreshRun = useMemo(
    () =>
      activeLiveIngestionRefreshRunFilter === "all"
        ? null
        : sortedLiveIngestionRefreshRuns.find((run) => run.id === activeLiveIngestionRefreshRunFilter) ??
          null,
    [activeLiveIngestionRefreshRunFilter, sortedLiveIngestionRefreshRuns]
  );

  const activeRunLiveIngestionItemIds = useMemo(
    () =>
      activeLiveIngestionRefreshRun
        ? liveIngestionBuffer
            .filter((item) => item.refreshRunId === activeLiveIngestionRefreshRun.id)
            .map((item) => item.id)
        : [],
    [activeLiveIngestionRefreshRun, liveIngestionBuffer]
  );

  const activeEligibleRunLiveIngestionItemIds = useMemo(
    () =>
      activeLiveIngestionRefreshRun
        ? liveIngestionBuffer
            .filter(
              (item) =>
                item.refreshRunId === activeLiveIngestionRefreshRun.id && item.status === "new"
            )
            .map((item) => item.id)
        : [],
    [activeLiveIngestionRefreshRun, liveIngestionBuffer]
  );

  const activeVisibleRunLiveIngestionItemIds = useMemo(
    () =>
      activeLiveIngestionRefreshRun
        ? filteredLiveIngestionBuffer
            .filter((item) => item.refreshRunId === activeLiveIngestionRefreshRun.id)
            .map((item) => item.id)
        : [],
    [activeLiveIngestionRefreshRun, filteredLiveIngestionBuffer]
  );

  const activeEligibleVisibleRunLiveIngestionItemIds = useMemo(
    () =>
      activeLiveIngestionRefreshRun
        ? filteredLiveIngestionBuffer
            .filter(
              (item) =>
                item.refreshRunId === activeLiveIngestionRefreshRun.id && item.status === "new"
            )
            .map((item) => item.id)
        : [],
    [activeLiveIngestionRefreshRun, filteredLiveIngestionBuffer]
  );

  const activeRunEligibleCount = activeEligibleRunLiveIngestionItemIds.length;
  const activeRunIneligibleCount = activeRunLiveIngestionItemIds.length - activeRunEligibleCount;
  const activeRunSentCount = useMemo(
    () =>
      activeLiveIngestionRefreshRun
        ? liveIngestionBuffer.filter(
            (item) =>
              item.refreshRunId === activeLiveIngestionRefreshRun.id &&
              item.status === "sent_to_feed"
          ).length
        : 0,
    [activeLiveIngestionRefreshRun, liveIngestionBuffer]
  );
  const activeRunBlockedCount = useMemo(
    () =>
      activeLiveIngestionRefreshRun
        ? liveIngestionBuffer.filter(
            (item) =>
              item.refreshRunId === activeLiveIngestionRefreshRun.id &&
              ["draft", "archived", "discarded"].includes(item.status)
          ).length
        : 0,
    [activeLiveIngestionRefreshRun, liveIngestionBuffer]
  );
  const activeRunUnresolvedCount = useMemo(
    () =>
      activeLiveIngestionRefreshRun
        ? liveIngestionBuffer.filter(
            (item) =>
              item.refreshRunId === activeLiveIngestionRefreshRun.id &&
              (item.status === "draft" || item.status === "new")
          ).length
        : 0,
    [activeLiveIngestionRefreshRun, liveIngestionBuffer]
  );
  const activeRunResolvedCount = activeRunLiveIngestionItemIds.length - activeRunUnresolvedCount;

  const selectedEligibleLiveIngestionItemCount = useMemo(
    () =>
      liveIngestionBuffer.filter(
        (item) => item.status === "new" && selectedLiveIngestionItemIds.includes(item.id)
      ).length,
    [liveIngestionBuffer, selectedLiveIngestionItemIds]
  );

  const visibleLiveIngestionItemIds = useMemo(
    () => filteredLiveIngestionBuffer.map((item) => item.id),
    [filteredLiveIngestionBuffer]
  );

  const selectedVisibleLiveIngestionItemCount = useMemo(
    () =>
      filteredLiveIngestionBuffer.filter((item) => selectedLiveIngestionItemIds.includes(item.id))
        .length,
    [filteredLiveIngestionBuffer, selectedLiveIngestionItemIds]
  );

  const eligibleVisibleLiveIngestionItemIds = useMemo(
    () => filteredLiveIngestionBuffer.filter((item) => item.status === "new").map((item) => item.id),
    [filteredLiveIngestionBuffer]
  );

  const actionPlanScoutSupportByCandidateId = useMemo(() => {
    if (!growthRhythmPlan) {
      return new Map<string, ActionPlanScoutSupport>();
    }

    const directMatches = scoutMatchResult?.items ?? [];
    const savedMatches = savedMatchedOpportunities;
    const supportById = new Map<string, ActionPlanScoutSupport>();

    for (const candidate of [
      ...growthRhythmPlan.topPostCandidates,
      ...growthRhythmPlan.topCommentCandidates,
      ...growthRhythmPlan.keepForLater
    ]) {
      const support = deriveActionPlanScoutSupport(candidate, directMatches, savedMatches);
      if (support) {
        supportById.set(candidate.id, support);
      }
    }

    return supportById;
  }, [growthRhythmPlan, savedMatchedOpportunities, scoutMatchResult]);

  const prioritizedGrowthRhythmPlan = useMemo(() => {
    if (!growthRhythmPlan) {
      return null;
    }

    return {
      ...growthRhythmPlan,
      topPostCandidates: prioritizeGrowthRhythmCandidates(
        growthRhythmPlan.topPostCandidates,
        actionPlanScoutSupportByCandidateId
      ),
      topCommentCandidates: prioritizeGrowthRhythmCandidates(
        growthRhythmPlan.topCommentCandidates,
        actionPlanScoutSupportByCandidateId
      ),
      keepForLater: prioritizeGrowthRhythmCandidates(
        growthRhythmPlan.keepForLater,
        actionPlanScoutSupportByCandidateId
      )
    };
  }, [actionPlanScoutSupportByCandidateId, growthRhythmPlan]);

  const savedDecisionItemsById = useMemo(
    () => new Map(savedDecisionItems.map((item) => [item.id, item])),
    [savedDecisionItems]
  );
  const manualOutcomeFeedbackByKey = useMemo(
    () =>
      new Map(
        manualOutcomeFeedback.map((item) => [feedbackStorageKey(item.artifactType, item.artifactId), item])
      ),
    [manualOutcomeFeedback]
  );
  const feedbackSummary = useMemo<FeedbackSummary>(
    () => buildFeedbackSummary(manualOutcomeFeedback),
    [manualOutcomeFeedback]
  );
  const feedbackThemeTags = useMemo(
    () => extractFeedbackAwareThemeTags(feedbackSummary),
    [feedbackSummary]
  );
  const selectedMatchedOpportunity = useMemo(
    () =>
      selectedMatchedOpportunityId
        ? matchedOpportunities.find((item) => item.id === selectedMatchedOpportunityId) ?? null
        : null,
    [matchedOpportunities, selectedMatchedOpportunityId]
  );
  const activeFocusWorkItem = useMemo(
    () =>
      selectedContentWorkspaceItem ??
      (selectedDraftDocument
        ? contentWorkspaceItems.find(
            (item) => item.id === selectedDraftDocument.sourceContentWorkItemId
          ) ?? null
        : null),
    [contentWorkspaceItems, selectedContentWorkspaceItem, selectedDraftDocument]
  );
  const activeFocusMatchedOpportunity = useMemo(
    () =>
      selectedMatchedOpportunity ??
      (activeFocusWorkItem
        ? matchedOpportunities.find(
            (item) => item.id === activeFocusWorkItem.sourceMatchedOpportunityId
          ) ?? null
        : null),
    [activeFocusWorkItem, matchedOpportunities, selectedMatchedOpportunity]
  );
  const activeFocusDraft = useMemo(
    () =>
      selectedDraftDocument ??
      (activeFocusWorkItem?.draftProgress?.draftId
        ? draftQueueItems.find((draft) => draft.id === activeFocusWorkItem.draftProgress?.draftId) ?? null
        : null),
    [activeFocusWorkItem, draftQueueItems, selectedDraftDocument]
  );
  const signalsById = useMemo(() => new Map(signals.map((item) => [item.id, item] as const)), [signals]);
  const contentAssetsById = useMemo(
    () => new Map(contentAssets.map((item) => [item.id, item] as const)),
    [contentAssets]
  );
  const factoryCriticReviewsByContentId = useMemo(
    () =>
      new Map(factoryCriticReviews.map((item) => [item.contentAssetId, item] as const)),
    [factoryCriticReviews]
  );
  const factorySolutionMemoriesById = useMemo(
    () => new Map(factorySolutionMemories.map((item) => [item.id, item] as const)),
    [factorySolutionMemories]
  );
  const factoryPriorityByKey = useMemo(() => {
    const items = [
      ...(factoryPrioritySelection?.signals ?? []),
      ...(factoryPrioritySelection?.candidateQueueItems ?? [])
    ];
    return new Map(items.map((item) => [`${item.itemType}:${item.itemId}`, item] as const));
  }, [factoryPrioritySelection]);
  const topFactoryOpportunityItems = useMemo(() => {
    const grouped = new Map<
      string,
      {
        item: FactoryPrioritySelectionResult["signals"][number];
        signal: Signal | undefined;
        relatedCount: number;
      }
    >();

    for (const item of [...(factoryPrioritySelection?.signals ?? [])].sort(
      (left, right) => right.priorityScore - left.priorityScore
    )) {
      const key = item.signalId;
      const existing = grouped.get(key);
      if (existing) {
        existing.relatedCount += 1;
        continue;
      }

      grouped.set(key, {
        item,
        signal: signalsById.get(item.signalId),
        relatedCount: 1
      });
    }

    return Array.from(grouped.values()).slice(0, 4);
  }, [factoryPrioritySelection, signalsById]);
  const topFactoryContentCandidates = useMemo(() => {
    const grouped = new Map<
      string,
      {
        candidate: CandidateQueueItem;
        signal: Signal | undefined;
        content: ContentAsset | undefined;
        criticReview: WritingQualityAssessment | undefined;
        priorityDecision:
          | FactoryPrioritySelectionResult["candidateQueueItems"][number]
          | undefined;
        relatedCount: number;
        relatedTitles: string[];
      }
    >();

    for (const candidate of [...factoryCandidateQueueItems]
      .filter(
        (item) =>
          (item.candidateType === "content_candidate" ||
            item.candidateType === "high_priority_candidate") &&
          item.queueState !== "archived"
      )
      .sort((left, right) => (right.priorityScore ?? 0) - (left.priorityScore ?? 0))) {
      const signal = signalsById.get(candidate.signalId);
      const content = candidate.contentAssetId
        ? contentAssetsById.get(candidate.contentAssetId)
        : undefined;
      const criticReview = candidate.contentAssetId
        ? factoryCriticReviewsByContentId.get(candidate.contentAssetId)
        : undefined;
      const priorityDecision = factoryPriorityByKey.get(`candidate_queue_item:${candidate.id}`);
      const groupingKey = [
        candidate.signalId,
        normalizeGroupingKey(content?.bestAngle ?? signal?.title),
        candidate.candidateType
      ].join(":");
      const existing = grouped.get(groupingKey);
      const relatedTitle = signal?.title ?? content?.bestAngle ?? candidate.id;

      if (existing) {
        existing.relatedCount += 1;
        if (!existing.relatedTitles.includes(relatedTitle)) {
          existing.relatedTitles.push(relatedTitle);
        }
        continue;
      }

      grouped.set(groupingKey, {
        candidate,
        signal,
        content,
        criticReview,
        priorityDecision,
        relatedCount: 1,
        relatedTitles: [relatedTitle]
      });
    }

    return Array.from(grouped.values()).slice(0, 4);
  }, [
    contentAssetsById,
    factoryCandidateQueueItems,
    factoryCriticReviewsByContentId,
    factoryPriorityByKey,
    signalsById
  ]);
  const topFactorySolutionCandidates = useMemo(() => {
    const grouped = new Map<
      string,
      {
        candidate: CandidateQueueItem;
        signal: Signal | undefined;
        solutionMemory: SolutionMemory | undefined;
        priorityDecision:
          | FactoryPrioritySelectionResult["candidateQueueItems"][number]
          | undefined;
        relatedCount: number;
        relatedTitles: string[];
      }
    >();

    for (const candidate of [...factoryCandidateQueueItems]
      .filter((item) => item.candidateType === "solution_candidate")
      .sort((left, right) => (right.priorityScore ?? 0) - (left.priorityScore ?? 0))) {
      const signal = signalsById.get(candidate.signalId);
      const solutionMemory = candidate.solutionMemoryId
        ? factorySolutionMemoriesById.get(candidate.solutionMemoryId)
        : undefined;
      const priorityDecision = factoryPriorityByKey.get(`candidate_queue_item:${candidate.id}`);
      const groupingKey = [
        candidate.signalId,
        normalizeGroupingKey(solutionMemory?.repoReference ?? solutionMemory?.possibleUseCases?.[0])
      ].join(":");
      const existing = grouped.get(groupingKey);
      const relatedTitle = signal?.title ?? solutionMemory?.repoReference ?? candidate.id;

      if (existing) {
        existing.relatedCount += 1;
        if (!existing.relatedTitles.includes(relatedTitle)) {
          existing.relatedTitles.push(relatedTitle);
        }
        continue;
      }

      grouped.set(groupingKey, {
        candidate,
        signal,
        solutionMemory,
        priorityDecision,
        relatedCount: 1,
        relatedTitles: [relatedTitle]
      });
    }

    return Array.from(grouped.values()).slice(0, 4);
  }, [
    factoryCandidateQueueItems,
    factoryPriorityByKey,
    factorySolutionMemoriesById,
    signalsById
  ]);
  const recentFactoryRuns = useMemo(() => {
    const grouped = new Map<
      string,
      {
        run: AutonomousRun;
        signal: Signal | undefined;
        relatedCount: number;
      }
    >();

    for (const run of [...factoryRuns]
      .filter((item) => item.runType === "signal_pipeline")
      .sort(
        (left, right) =>
          new Date(right.completedAt ?? right.createdAt).getTime() -
          new Date(left.completedAt ?? left.createdAt).getTime()
      )) {
      const key = run.signalId ?? run.id;
      const existing = grouped.get(key);
      if (existing) {
        existing.relatedCount += 1;
        continue;
      }

      grouped.set(key, {
        run,
        signal: run.signalId ? signalsById.get(run.signalId) : undefined,
        relatedCount: 1
      });
    }

    return Array.from(grouped.values()).slice(0, 4);
  }, [factoryRuns, signalsById]);
  const topFactoryPriorityRecommendations = useMemo(() => {
    const grouped = new Map<
      string,
      {
        item:
          | FactoryPrioritySelectionResult["candidateQueueItems"][number]
          | FactoryPrioritySelectionResult["signals"][number];
        signal: Signal | undefined;
        relatedCount: number;
      }
    >();

    for (const item of [
      ...(factoryPrioritySelection?.candidateQueueItems ?? []),
      ...(factoryPrioritySelection?.signals ?? [])
    ].sort((left, right) => right.priorityScore - left.priorityScore)) {
      const key = `${item.signalId}:${item.recommendedAction}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.relatedCount += 1;
        continue;
      }

      grouped.set(key, {
        item,
        signal: signalsById.get(item.signalId),
        relatedCount: 1
      });
    }

    return Array.from(grouped.values()).slice(0, 6);
  }, [factoryPrioritySelection, signalsById]);
  const factoryActionCounts = useMemo(() => {
    return topFactoryPriorityRecommendations.reduce<Record<string, number>>((counts, item) => {
      counts[item.item.recommendedAction] = (counts[item.item.recommendedAction] ?? 0) + 1;
      return counts;
    }, {});
  }, [topFactoryPriorityRecommendations]);

  const closeFactoryCandidateDetail = (): void => {
    setSelectedFactoryCandidateId(null);
    setSelectedFactoryCandidateDetail(null);
    setSelectedFactoryCandidateError(null);
    setCandidateReviewActionError(null);
    setCandidateReviewActionPending(false);
    setCandidateReviewNote("");
  };

  const applyCandidateDetailToLocalState = (detail: CandidateQueueItemDetail): void => {
    setFactoryCandidateQueueItems((current) =>
      current.map((item) => (item.id === detail.candidate.id ? detail.candidate : item))
    );

    if (detail.contentAsset) {
      const nextContentAsset = detail.contentAsset;
      setContentAssets((current) => {
        const next = current.filter((item) => item.id !== nextContentAsset.id);
        return [...next, nextContentAsset].sort((left, right) =>
          left.createdAt.localeCompare(right.createdAt)
        );
      });
    }

    setFactoryCriticReviews((current) => {
      if (!detail.criticReview) {
        return current;
      }

      const nextCriticReview = detail.criticReview;
      const next = current.filter((item) => item.id !== nextCriticReview.id);
      return [...next, nextCriticReview].sort((left, right) =>
        left.createdAt.localeCompare(right.createdAt)
      );
    });
  };

  const openFactoryCandidateDetail = async (candidateId: string): Promise<void> => {
    setSelectedFactoryCandidateId(candidateId);
    setSelectedFactoryCandidateLoading(true);
    setSelectedFactoryCandidateError(null);
    setCandidateReviewActionError(null);

    try {
      const detail = await requestJson<CandidateQueueItemDetail>(
        apiBaseUrl,
        `/candidate-queue/${candidateId}`
      );
      setSelectedFactoryCandidateDetail(detail);
      setCandidateReviewNote(detail.candidate.operatorNote ?? "");
    } catch (error) {
      setSelectedFactoryCandidateDetail(null);
      setSelectedFactoryCandidateError(
        isApiRequestError(error)
          ? error
          : {
              endpoint: `/candidate-queue/${candidateId}`,
              method: "GET",
              message: error instanceof Error ? error.message : "Failed to load candidate detail."
            }
      );
    } finally {
      setSelectedFactoryCandidateLoading(false);
    }
  };

  const applyFactoryCandidateAction = async (
    action: CandidateQueueOperatorAction
  ): Promise<void> => {
    if (!selectedFactoryCandidateId) {
      return;
    }

    setCandidateReviewActionPending(true);
    setCandidateReviewActionError(null);

    try {
      const detail = await requestJson<CandidateQueueItemDetail>(
        apiBaseUrl,
        `/candidate-queue/${selectedFactoryCandidateId}`,
        "PATCH",
        {
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            action,
            operatorNote: candidateReviewNote.trim() || undefined
          })
        }
      );

      applyCandidateDetailToLocalState(detail);
      setSelectedFactoryCandidateDetail(detail);
      setCandidateReviewNote(detail.candidate.operatorNote ?? "");

      if (action === "archive_candidate") {
        closeFactoryCandidateDetail();
      }
    } catch (error) {
      setCandidateReviewActionError(
        isApiRequestError(error)
          ? error
          : {
              endpoint: `/candidate-queue/${selectedFactoryCandidateId}`,
              method: "PATCH",
              message: error instanceof Error ? error.message : "Failed to update candidate state."
            }
      );
    } finally {
      setCandidateReviewActionPending(false);
    }
  };

  const launchConsoleOperatorAuthConfig =
    aiRuntimeHealth?.operatorAuthConfig ?? launchPreflight?.operatorAuthConfig ?? null;
  const supervisedMvpGoLiveChecklist = useMemo(() => {
    const requiredItems: Array<{
      label: string;
      statusLabel: string;
      statusKind: CompactBadgeKind;
    }> = [
      {
        label: "Operator auth secrets configured",
        statusLabel: launchConsoleOperatorAuthConfig?.configured ? "Ready" : "Blocked",
        statusKind: launchConsoleOperatorAuthConfig?.configured ? "repeat" : "avoid"
      },
      {
        label: "Launch diagnostics visible",
        statusLabel: aiRuntimeHealth && launchPreflight ? "Visible" : "Pending",
        statusKind: aiRuntimeHealth && launchPreflight ? "repeat" : "neutral"
      },
      {
        label: "Launch preflight understood",
        statusLabel: launchPreflight
          ? formatOperationalLabel(launchPreflight.launchStatus)
          : "Pending",
        statusKind:
          launchPreflight?.launchStatus === "blocked"
            ? "avoid"
            : launchPreflight
              ? "repeat"
              : "neutral"
      },
      {
        label: "Review & triage console available",
        statusLabel: "In scope",
        statusKind: "support"
      },
      {
        label: "Content workspace available",
        statusLabel: "In scope",
        statusKind: "support"
      },
      {
        label: "Draft queue and draft flows available",
        statusLabel: "In scope",
        statusKind: "support"
      }
    ];
    const recommendedItems: Array<{
      label: string;
      statusLabel: string;
      statusKind: CompactBadgeKind;
    }> = [
      {
        label: "Scheduler runtime enabled",
        statusLabel:
          aiRuntimeHealth?.schedulerRuntimeEnabled === undefined
            ? "Unknown"
            : aiRuntimeHealth.schedulerRuntimeEnabled
              ? "Enabled"
              : "Disabled for now",
        statusKind:
          aiRuntimeHealth?.schedulerRuntimeEnabled === undefined
            ? "neutral"
            : aiRuntimeHealth.schedulerRuntimeEnabled
              ? "repeat"
              : "support"
      },
      {
        label: "Run provider probe if AI-backed mode is expected",
        statusLabel: "Recommended",
        statusKind: "support"
      },
      {
        label: "Run one launch smoke run before first real use",
        statusLabel: "Recommended",
        statusKind: "support"
      }
    ];

    const blockers: string[] = [];
    const warnings: string[] = [];

    if (!launchConsoleOperatorAuthConfig?.configured) {
      blockers.push("Operator auth config is missing.");
    }

    if (!aiRuntimeHealth || !launchPreflight) {
      blockers.push("Launch diagnostics are not fully visible yet.");
    }

    if (launchPreflight?.launchStatus === "blocked") {
      blockers.push("Launch preflight is blocked.");
    }

    if (launchPreflight?.launchStatus === "fallback_ready") {
      warnings.push("AI is optional here; supervised fallback mode is acceptable for MVP go-live.");
    }

    if (aiRuntimeHealth && !aiRuntimeHealth.schedulerRuntimeEnabled) {
      warnings.push(
        "Scheduler runtime is disabled, so continuous autonomous intake is not active."
      );
    }

    const verdict =
      blockers.length > 0
        ? {
            label: "Blocked",
            kind: "avoid" as const,
            summary: "Do not start real supervised use until the launch blockers are cleared."
          }
        : launchPreflight?.launchStatus === "ai_ready"
          ? {
              label: "Launch-ready",
              kind: "repeat" as const,
              summary: "Core supervised MVP surfaces are available with AI-backed launch readiness."
            }
          : {
              label: "Fallback-ready",
              kind: "support" as const,
              summary:
                "Core supervised MVP surfaces are available and safe to operate in fallback mode."
            };

    return {
      requiredItems,
      recommendedItems,
      blockers,
      warnings,
      verdict
    };
  }, [aiRuntimeHealth, launchConsoleOperatorAuthConfig, launchPreflight]);

  useEffect(() => {
    if (!selectedMatchedOpportunityId) {
      return;
    }

    if (!matchedOpportunities.some((item) => item.id === selectedMatchedOpportunityId)) {
      setSelectedMatchedOpportunityId(null);
      setMatchedOpportunityActionError(null);
    }
  }, [matchedOpportunities, selectedMatchedOpportunityId]);

  useEffect(() => {
    if (!selectedMatchedOpportunity) {
      return;
    }

    setMatchedOpportunityReviewStateSelection(selectedMatchedOpportunity.reviewState);
  }, [selectedMatchedOpportunity]);

  useEffect(() => {
    void restoreOperatorSession();
  }, []);

  useEffect(() => {
    if (!operatorSession) {
      return;
    }

    void loadAll();
  }, [operatorSession, operatorDashboardMode]);

  useEffect(() => {
    if (!isOperatorDayOneMode) {
      return;
    }

    setReviewQueueItems([]);
    setMatchedOpportunities([]);
    setContentWorkspaceItems([]);
    setDraftQueueItems([]);
    setSelectedMatchedOpportunityId(null);
    setSelectedContentWorkspaceItemId(null);
    setSelectedContentWorkspaceItem(null);
    setSelectedDraftDocumentId(null);
    setSelectedDraftDocument(null);
  }, [isOperatorDayOneMode]);

  async function restoreOperatorSession() {
    const token = readOperatorAuthToken();

    if (!token) {
      setOperatorSession(null);
      setAuthBooting(false);
      return;
    }

    try {
      const session = await requestJson<OperatorSession>(apiBaseUrl, "/auth/session");
      setOperatorSession(session);
      setAuthError(null);
    } catch (error) {
      clearOperatorAuthToken();
      setOperatorSession(null);
      setAuthError(
        isApiRequestError(error) ? error.responseBody ?? error.message : "Operator session expired."
      );
    } finally {
      setAuthBooting(false);
    }
  }

  async function loadAll() {
    setLoading(true);
    setError(null);
    setLoadErrors({});
    const isFullDashboardMode = operatorDashboardMode !== "day_1";

    const day1MvpRequests: InitialLoadRequest[] = [
      {
        key: "launchConsole",
        label: "Launch console",
        request: async () => ({
          runtimeHealth: await requestJson<AIRuntimeHealthSummary>(
            apiBaseUrl,
            "/system/ai-runtime-health"
          ),
          launchPreflight: await requestJson<LaunchPreflightResult>(
            apiBaseUrl,
            "/system/launch-preflight"
          )
        }),
        onSuccess: (value) => {
          const launchConsole = value as {
            runtimeHealth: AIRuntimeHealthSummary;
            launchPreflight: LaunchPreflightResult;
          };
          setAiRuntimeHealth(launchConsole.runtimeHealth);
          setLaunchPreflight(launchConsole.launchPreflight);
        }
      },
      {
        key: "draftQueue",
        label: "Server draft queue",
        request: () =>
          requestJson<AutonomousDraftDocument[]>(
            apiBaseUrl,
            buildDraftQueueEndpoint(draftQueueStatusFilter, draftQueueSort)
          ),
        onSuccess: (value) => setDraftQueueItems(value as AutonomousDraftDocument[])
      },
      {
        key: "autonomousContentAssets",
        label: "Autonomous content assets",
        request: () =>
          requestJson<ContentAsset[]>(
            apiBaseUrl,
            "/autonomy/content-assets"
          ),
        onSuccess: (value) => setAutonomousContentAssets(value as ContentAsset[])
      },
      {
        key: "autonomousWatchlists",
        label: "Autonomous watchlists",
        request: () => requestJson<AutonomousWatchlist[]>(apiBaseUrl, "/autonomy/watchlists"),
        onSuccess: (value) => setAutonomousWatchlists(value as AutonomousWatchlist[])
      },
      {
        key: "schedulerRuntimeStatus",
        label: "Scheduler runtime status",
        request: () => requestJson<{
          enabled: boolean;
          running: boolean;
          intervalMs: number;
          isTickInFlight: boolean;
          lastTickStartedAt?: string;
          lastTickCompletedAt?: string;
          lastTickOutcome?: { status: "completed"; runCount: number; dueWatchlistCount: number } | { status: "failed"; errorSummary: string };
        }>(apiBaseUrl, "/autonomy/runtime/status"),
        onSuccess: (value) => setSchedulerRuntimeStatus(value as typeof schedulerRuntimeStatus)
      },
      {
        key: "operatorControl",
        label: "Operator control status",
        request: () => requestJson<OperatorControlStatus>(apiBaseUrl, "/system/operator-control"),
        onSuccess: (value) => setOperatorControlStatus(value as OperatorControlStatus)
      }
    ];

    const factoryRequests: InitialLoadRequest[] = [
      {
        key: "signals",
        label: "Signals",
        request: () => requestJson<Signal[]>(apiBaseUrl, "/signals"),
        onSuccess: (value) => setSignals(value as Signal[])
      },
      {
        key: "ideas",
        label: "Ideas",
        request: () => requestJson<Idea[]>(apiBaseUrl, "/ideas"),
        onSuccess: (value) => setIdeas(value as Idea[])
      },
      {
        key: "content",
        label: "Content drafts",
        request: () => requestJson<ContentAsset[]>(apiBaseUrl, "/content"),
        onSuccess: (value) => {
          const content = value as ContentAsset[];
          setContentAssets(content);
          setAnalyticsForm((current) => ({
            ...current,
            contentAssetId: current.contentAssetId || content[0]?.id || ""
          }));
        }
      },
      {
        key: "factoryCandidates",
        label: "Factory candidate queue",
        request: () => requestJson<CandidateQueueItem[]>(apiBaseUrl, "/candidate-queue"),
        onSuccess: (value) => setFactoryCandidateQueueItems(value as CandidateQueueItem[])
      },
      {
        key: "factoryRuns",
        label: "Factory runs",
        request: () => requestJson<AutonomousRun[]>(apiBaseUrl, "/factory/runs"),
        onSuccess: (value) => setFactoryRuns(value as AutonomousRun[])
      },
      {
        key: "factorySolutions",
        label: "Factory solution memories",
        request: () => requestJson<SolutionMemory[]>(apiBaseUrl, "/factory/solution-memories"),
        onSuccess: (value) => setFactorySolutionMemories(value as SolutionMemory[])
      },
      {
        key: "factoryCriticReviews",
        label: "Factory critic reviews",
        request: () =>
          requestJson<WritingQualityAssessment[]>(apiBaseUrl, "/factory/critic-reviews"),
        onSuccess: (value) => setFactoryCriticReviews(value as WritingQualityAssessment[])
      },
      {
        key: "factoryPriority",
        label: "Factory priority",
        request: () => requestJson<FactoryPrioritySelectionResult>(apiBaseUrl, "/factory/priority"),
        onSuccess: (value) => setFactoryPrioritySelection(value as FactoryPrioritySelectionResult)
      }
    ];

    const legacyRequests: InitialLoadRequest[] = [
      {
        key: "reviewTriage",
        label: "Review and triage console",
        request: async () => ({
          reviewQueue: await requestJson<AutonomousReviewQueueItem[]>(
            apiBaseUrl,
            "/autonomy/review-queue"
          ),
          matchedOpportunities: await requestJson<AutonomousMatchedOpportunity[]>(
            apiBaseUrl,
            buildPrioritizedOpportunitiesEndpoint(reviewTriageReviewStateFilter)
          )
        }),
        onSuccess: (value) => {
          const reviewTriage = value as {
            reviewQueue: AutonomousReviewQueueItem[];
            matchedOpportunities: AutonomousMatchedOpportunity[];
          };
          setReviewQueueItems(reviewTriage.reviewQueue);
          setMatchedOpportunities(reviewTriage.matchedOpportunities);
        }
      },
      {
        key: "contentWorkspace",
        label: "Server content workspace",
        request: () =>
          requestJson<AutonomousContentWorkItem[]>(
            apiBaseUrl,
            buildContentWorkspaceEndpoint({
              status: contentWorkspaceStatusFilter,
              kind: contentWorkspaceKindFilter,
              hasDraft: contentWorkspaceHasDraftFilter,
              draftStatus: contentWorkspaceDraftStatusFilter,
              sort: contentWorkspaceSort
            })
          ),
        onSuccess: (value) => setContentWorkspaceItems(value as AutonomousContentWorkItem[])
      },
      {
        key: "factoryMemory",
        label: "Factory memory insights",
        request: () => requestJson<MemoryPattern[]>(apiBaseUrl, "/factory/memory-patterns"),
        onSuccess: (value) => setFactoryMemoryPatterns(value as MemoryPattern[])
      },
      {
        key: "visuals",
        label: "Visual briefs",
        request: () => requestJson<VisualAsset[]>(apiBaseUrl, "/visuals"),
        onSuccess: (value) => setVisualAssets(value as VisualAsset[])
      },
      {
        key: "analytics",
        label: "Analytics",
        request: () => requestJson<AnalyticsSnapshot[]>(apiBaseUrl, "/analytics"),
        onSuccess: (value) => setAnalyticsSnapshots(value as AnalyticsSnapshot[])
      },
      {
        key: "strategy",
        label: "Strategy recommendations",
        request: () =>
          requestJson<StrategyRecommendation[]>(apiBaseUrl, "/strategy/recommendations"),
        onSuccess: (value) => setRecommendations(value as StrategyRecommendation[])
      },
      {
        key: "sources",
        label: "Sources",
        request: () => requestJson<SourceItem[]>(apiBaseUrl, "/sources"),
        onSuccess: (value) => setSourceItems(value as SourceItem[])
      },
      {
        key: "markets",
        label: "Markets",
        request: () => requestJson<MarketProfile[]>(apiBaseUrl, "/markets"),
        onSuccess: (value) => setMarketProfiles(value as MarketProfile[])
      },
      {
        key: "topics",
        label: "Topic scores",
        request: () => requestJson<TopicScore[]>(apiBaseUrl, "/topics/scores"),
        onSuccess: (value) => setTopicScores(value as TopicScore[])
      },
      {
        key: "queue",
        label: "Content queue",
        request: () => requestJson<ContentQueueItem[]>(apiBaseUrl, "/queue"),
        onSuccess: (value) => setContentQueue(value as ContentQueueItem[])
      },
      {
        key: "brandVoice",
        label: "Brand voice",
        request: () =>
          requestJson<{ active: BrandVoiceProfile | null }>(apiBaseUrl, "/brand-voice"),
        onSuccess: (value) =>
          setBrandVoice((value as { active: BrandVoiceProfile | null }).active)
      }
    ];

    const requests: InitialLoadRequest[] = isFullDashboardMode
      ? [...factoryRequests, ...legacyRequests]
      : day1MvpRequests;

    const results = await Promise.allSettled(
      requests.map(async (requestConfig) => ({
        ...requestConfig,
        value: await requestConfig.request()
      }))
    );

    const nextLoadErrors: SectionErrors = {};

    results.forEach((result, index) => {
      const requestConfig = requests[index];

      if (result.status === "fulfilled") {
        requestConfig.onSuccess(result.value.value);
        return;
      }

      const reason = result.reason;
      const requestError = isApiRequestError(reason)
        ? reason
        : {
            endpoint: "unknown",
            method: "GET",
            message: reason instanceof Error ? reason.message : "Failed to load section"
          };

      nextLoadErrors[requestConfig.key] = requestError;
    });

    setLoadErrors(nextLoadErrors);
    setLoading(false);
  }

  async function handleOperatorLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoggingInOperator(true);
    setAuthError(null);

    try {
      const session = await requestJson<OperatorLoginResponse>(apiBaseUrl, "/auth/login", "POST", {
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          username: operatorUsername,
          password: operatorPassword
        })
      });

      persistOperatorAuthToken(session.token);
      setOperatorSession({
        username: session.username,
        expiresAt: session.expiresAt
      });
      setOperatorPassword("");
    } catch (error) {
      setAuthError(
        isApiRequestError(error)
          ? error.responseBody ?? error.message
          : "Operator sign-in failed."
      );
    } finally {
      setLoggingInOperator(false);
      setAuthBooting(false);
    }
  }

  async function handleOperatorLogout() {
    setLoggingOutOperator(true);
    setAuthError(null);

    try {
      await requestJson<{ ok: true }>(apiBaseUrl, "/auth/logout", "POST");
    } catch {
      // Clear the local session even if the remote session is already gone.
    } finally {
      clearOperatorAuthToken();
      setOperatorSession(null);
      setOperatorPassword("");
      setLoading(false);
      setLoggingOutOperator(false);
    }
  }

  async function reloadReviewTriageConsole(
    next?: {
      reviewState?: ReviewTriageReviewStateFilter;
    }
  ) {
    const reviewState = next?.reviewState ?? reviewTriageReviewStateFilter;
    setLoadingReviewTriage(true);

    try {
      const [nextReviewQueueItems, nextMatchedOpportunities] = await Promise.all([
        requestJson<AutonomousReviewQueueItem[]>(apiBaseUrl, "/autonomy/review-queue"),
        requestJson<AutonomousMatchedOpportunity[]>(
          apiBaseUrl,
          buildPrioritizedOpportunitiesEndpoint(reviewState)
        )
      ]);

      setReviewQueueItems(nextReviewQueueItems);
      setMatchedOpportunities(nextMatchedOpportunities);
      setLoadErrors((current) => {
        const next = { ...current };
        delete next.reviewTriage;
        return next;
      });
    } catch (reviewTriageError) {
      const requestError = isApiRequestError(reviewTriageError)
        ? reviewTriageError
        : {
            endpoint: buildPrioritizedOpportunitiesEndpoint(reviewState),
            method: "GET",
            message:
              reviewTriageError instanceof Error
                ? reviewTriageError.message
                : "Failed to load review and triage console"
          };

      setLoadErrors((current) => ({
        ...current,
        reviewTriage: requestError
      }));
      setReviewQueueItems([]);
      setMatchedOpportunities([]);
    } finally {
      setLoadingReviewTriage(false);
    }
  }

  function handleOpenMatchedOpportunityDetails(id: string) {
    setSelectedMatchedOpportunityId(id);
    setMatchedOpportunityActionError(null);
  }

  async function handleChangeReviewTriageReviewStateFilter(
    reviewState: ReviewTriageReviewStateFilter
  ) {
    setReviewTriageReviewStateFilter(reviewState);
    await reloadReviewTriageConsole({ reviewState });
  }

  async function handleApplyMatchedOpportunityReviewState() {
    if (!selectedMatchedOpportunity) {
      return;
    }

    setSavingMatchedOpportunityReviewState(true);
    setMatchedOpportunityActionError(null);

    try {
      const updated = await requestJson<AutonomousMatchedOpportunity>(
        apiBaseUrl,
        `/autonomy/matched-opportunities/${selectedMatchedOpportunity.id}/review-state`,
        "PATCH",
        {
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            reviewState: matchedOpportunityReviewStateSelection
          })
        }
      );

      setMatchedOpportunities((current) =>
        current.map((item) => (item.id === updated.id ? updated : item))
      );
      await reloadReviewTriageConsole();
    } catch (reviewStateError) {
      setMatchedOpportunityActionError(
        isApiRequestError(reviewStateError)
          ? reviewStateError
          : {
              endpoint: `/autonomy/matched-opportunities/${selectedMatchedOpportunity.id}/review-state`,
              method: "PATCH",
              message:
                reviewStateError instanceof Error
                  ? reviewStateError.message
                  : "Failed to update matched opportunity review state"
            }
      );
    } finally {
      setSavingMatchedOpportunityReviewState(false);
    }
  }

  async function handlePromoteMatchedOpportunity() {
    if (!selectedMatchedOpportunity) {
      return;
    }

    setPromotingMatchedOpportunity(true);
    setMatchedOpportunityActionError(null);

    try {
      const promoted = await requestJson<AutonomousContentWorkItem>(
        apiBaseUrl,
        `/autonomy/matched-opportunities/${selectedMatchedOpportunity.id}/promote`,
        "POST"
      );

      setSelectedContentWorkspaceItemId(promoted.id);
      setSelectedContentWorkspaceItem(promoted);
      setSelectedContentWorkspaceItemError(null);
      setWorkItemStatusSelection(promoted.status);
      setSelectedDraftDocument(null);
      setSelectedDraftDocumentId(null);
      setSelectedDraftDocumentError(null);
      setDraftSaveError(null);
      setDraftStatusSaveError(null);
      setDraftCreationError(null);
      setIsEditingDraftDocument(false);
      setDraftEditForm({ title: "", body: "", angle: "" });
      setDraftStatusSelection(promoted.draftProgress?.draftStatus ?? "draft");
      await Promise.all([reloadReviewTriageConsole(), reloadContentWorkspace()]);
    } catch (promotionError) {
      setMatchedOpportunityActionError(
        isApiRequestError(promotionError)
          ? promotionError
          : {
              endpoint: `/autonomy/matched-opportunities/${selectedMatchedOpportunity.id}/promote`,
              method: "POST",
              message:
                promotionError instanceof Error
                  ? promotionError.message
                  : "Failed to promote matched opportunity"
            }
      );
    } finally {
      setPromotingMatchedOpportunity(false);
    }
  }

  async function reloadContentWorkspace(nextFilters?: {
    status?: ContentWorkspaceStatusFilter;
    kind?: ContentWorkspaceKindFilter;
    hasDraft?: ContentWorkspaceHasDraftFilter;
    draftStatus?: ContentWorkspaceDraftStatusFilter;
    sort?: ContentWorkspaceSortOption;
  }) {
    const filters = {
      status: nextFilters?.status ?? contentWorkspaceStatusFilter,
      kind: nextFilters?.kind ?? contentWorkspaceKindFilter,
      hasDraft: nextFilters?.hasDraft ?? contentWorkspaceHasDraftFilter,
      draftStatus: nextFilters?.draftStatus ?? contentWorkspaceDraftStatusFilter,
      sort: nextFilters?.sort ?? contentWorkspaceSort
    };

    setLoadingContentWorkspace(true);

    try {
      const items = await requestJson<AutonomousContentWorkItem[]>(
        apiBaseUrl,
        buildContentWorkspaceEndpoint(filters)
      );
      setContentWorkspaceItems(items);
      setLoadErrors((current) => {
        const next = { ...current };
        delete next.contentWorkspace;
        return next;
      });

      if (
        selectedContentWorkspaceItemId &&
        !items.some((item) => item.id === selectedContentWorkspaceItemId)
      ) {
        setSelectedContentWorkspaceItemId(null);
        setSelectedContentWorkspaceItem(null);
        setSelectedContentWorkspaceItemError(null);
        setSelectedDraftDocument(null);
        setSelectedDraftDocumentId(null);
        setSelectedDraftDocumentError(null);
        setWorkItemStatusSaveError(null);
        setDraftSaveError(null);
        setDraftStatusSaveError(null);
        setDraftCreationError(null);
        setIsEditingDraftDocument(false);
      }
    } catch (workspaceError) {
      const requestError = isApiRequestError(workspaceError)
        ? workspaceError
        : {
            endpoint: buildContentWorkspaceEndpoint(filters),
            method: "GET",
            message:
              workspaceError instanceof Error
                ? workspaceError.message
                : "Failed to load server content workspace"
          };

      setLoadErrors((current) => ({
        ...current,
        contentWorkspace: requestError
      }));
      setContentWorkspaceItems([]);
    } finally {
      setLoadingContentWorkspace(false);
    }
  }

  async function reloadDraftQueue(next?: {
    status?: DraftQueueStatusFilter;
    sort?: DraftQueueSortOption;
  }) {
    const status = next?.status ?? draftQueueStatusFilter;
    const sort = next?.sort ?? draftQueueSort;

    try {
      const endpoint = buildDraftQueueEndpoint(status, sort);
      const drafts = await requestJson<AutonomousDraftDocument[]>(apiBaseUrl, endpoint);
      setDraftQueueItems(drafts);
      setLoadErrors((current) => {
        const next = { ...current };
        delete next.draftQueue;
        return next;
      });
    } catch (draftQueueError) {
      const requestError = isApiRequestError(draftQueueError)
        ? draftQueueError
        : {
            endpoint: buildDraftQueueEndpoint(status, sort),
            method: "GET",
            message:
              draftQueueError instanceof Error
                ? draftQueueError.message
                : "Failed to load server draft queue"
          };

      setLoadErrors((current) => ({
        ...current,
        draftQueue: requestError
      }));
      setDraftQueueItems([]);
    }
  }

  async function reloadAutonomousWatchlists() {
    try {
      const watchlists = await requestJson<AutonomousWatchlist[]>(apiBaseUrl, "/autonomy/watchlists");
      setAutonomousWatchlists(watchlists);
      setLoadErrors((current) => {
        const next = { ...current };
        delete next.autonomousWatchlists;
        return next;
      });
    } catch (watchlistError) {
      const requestError = isApiRequestError(watchlistError)
        ? watchlistError
        : {
            endpoint: "/autonomy/watchlists",
            method: "GET",
            message:
              watchlistError instanceof Error
                ? watchlistError.message
                : "Failed to load autonomous watchlists"
          };

      setLoadErrors((current) => ({
        ...current,
        autonomousWatchlists: requestError
      }));
      setAutonomousWatchlists([]);
    }
  }

  function handleOpenDraftReview(draft: ContentAsset) {
    setReviewingDraftId(draft.id);
    setReviewingDraftDocument(draft);
    setDraftReviewError(null);
  }

  function handleCloseDraftReview() {
    setReviewingDraftId(null);
    setReviewingDraftDocument(null);
    setDraftReviewError(null);
  }

  async function handleDraftReviewAction(draftId: string, status: "draft" | "review" | "ready" | "published" | "archived") {
    setDraftReviewActionInProgress(true);
    setDraftReviewError(null);

    try {
      await requestJson<ContentAsset>(
        apiBaseUrl,
        `/autonomy/content-assets/${draftId}/status`,
        "PATCH",
        {
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ status })
        }
      );

      // Reload autonomous content assets for Day-1
      try {
        const assets = await requestJson<ContentAsset[]>(apiBaseUrl, "/autonomy/content-assets");
        setAutonomousContentAssets(assets);
      } catch {
        // Ignore reload error
      }
      handleCloseDraftReview();
    } catch (actionError) {
      setDraftReviewError(
        isApiRequestError(actionError)
          ? actionError.message
          : actionError instanceof Error
            ? actionError.message
            : "Failed to update content status"
      );
    } finally {
      setDraftReviewActionInProgress(false);
    }
  }

  async function handleRunProviderProbe() {
    setProbingProvider(true);
    setProviderProbeError(null);

    try {
      const result = await requestJson<AIProviderProbeResult>(apiBaseUrl, "/system/ai-probe", "POST");
      setProviderProbeResult(result);
    } catch (probeError) {
      setProviderProbeError(
        isApiRequestError(probeError)
          ? probeError
          : {
              endpoint: "/system/ai-probe",
              method: "POST",
              message:
                probeError instanceof Error ? probeError.message : "Failed to run provider probe"
            }
      );
    } finally {
      setProbingProvider(false);
    }
  }

  async function handleRunLaunchSmokeRun() {
    setRunningLaunchSmokeRun(true);
    setLaunchSmokeRunError(null);

    try {
      const result = await requestJson<LaunchSmokeRunResult>(
        apiBaseUrl,
        "/system/launch-smoke-run",
        "POST"
      );
      setLaunchSmokeRunResult(result);
    } catch (smokeRunError) {
      setLaunchSmokeRunError(
        isApiRequestError(smokeRunError)
          ? smokeRunError
          : {
              endpoint: "/system/launch-smoke-run",
              method: "POST",
              message:
                smokeRunError instanceof Error
                  ? smokeRunError.message
                  : "Failed to run launch smoke run"
            }
      );
    } finally {
      setRunningLaunchSmokeRun(false);
    }
  }

  async function handleChangeDraftQueueControls(next: {
    status?: DraftQueueStatusFilter;
    sort?: DraftQueueSortOption;
  }) {
    const status = next.status ?? draftQueueStatusFilter;
    const sort = next.sort ?? draftQueueSort;

    setDraftQueueStatusFilter(status);
    setDraftQueueSort(sort);
    await reloadDraftQueue({ status, sort });
  }

  async function handleChangeContentWorkspaceFilter(
    nextFilters: Partial<{
      status: ContentWorkspaceStatusFilter;
      kind: ContentWorkspaceKindFilter;
      hasDraft: ContentWorkspaceHasDraftFilter;
      draftStatus: ContentWorkspaceDraftStatusFilter;
      sort: ContentWorkspaceSortOption;
    }>
  ) {
    const mergedFilters = {
      status: nextFilters.status ?? contentWorkspaceStatusFilter,
      kind: nextFilters.kind ?? contentWorkspaceKindFilter,
      hasDraft: nextFilters.hasDraft ?? contentWorkspaceHasDraftFilter,
      draftStatus: nextFilters.draftStatus ?? contentWorkspaceDraftStatusFilter,
      sort: nextFilters.sort ?? contentWorkspaceSort
    };

    if (nextFilters.status !== undefined) {
      setContentWorkspaceStatusFilter(nextFilters.status);
    }
    if (nextFilters.kind !== undefined) {
      setContentWorkspaceKindFilter(nextFilters.kind);
    }
    if (nextFilters.hasDraft !== undefined) {
      setContentWorkspaceHasDraftFilter(nextFilters.hasDraft);
    }
    if (nextFilters.draftStatus !== undefined) {
      setContentWorkspaceDraftStatusFilter(nextFilters.draftStatus);
    }
    if (nextFilters.sort !== undefined) {
      setContentWorkspaceSort(nextFilters.sort);
    }

    await reloadContentWorkspace(mergedFilters);
  }

  async function handleOpenContentWorkspaceItem(itemId: string) {
    setSelectedContentWorkspaceItemId(itemId);
    setSelectedContentWorkspaceItem(null);
    setSelectedContentWorkspaceItemError(null);
    setWorkItemStatusSelection("draft");
    setWorkItemStatusSaveError(null);
    setSelectedDraftDocument(null);
    setSelectedDraftDocumentId(null);
    setSelectedDraftDocumentError(null);
    setDraftSaveError(null);
    setDraftStatusSaveError(null);
    setDraftCreationError(null);
    setIsEditingDraftDocument(false);
    setDraftEditForm({ title: "", body: "", angle: "" });
    setDraftStatusSelection("draft");
    setLoadingContentWorkspaceItem(true);

    try {
      const item = await requestJson<AutonomousContentWorkItem>(
        apiBaseUrl,
        `/autonomy/content-work-items/${itemId}`
      );
      setSelectedContentWorkspaceItem(item);
      setWorkItemStatusSelection(item.status);
    } catch (inspectionError) {
      setSelectedContentWorkspaceItemError(
        isApiRequestError(inspectionError)
          ? inspectionError
          : {
              endpoint: `/autonomy/content-work-items/${itemId}`,
              method: "GET",
              message:
                inspectionError instanceof Error
                  ? inspectionError.message
                  : "Failed to load workspace item"
            }
      );
    } finally {
      setLoadingContentWorkspaceItem(false);
    }
  }

  async function handleSaveContentWorkspaceItemStatus() {
    if (!selectedContentWorkspaceItemId) {
      return;
    }

    setSavingContentWorkspaceItemStatus(true);
    setWorkItemStatusSaveError(null);

    try {
      const updated = await requestJson<AutonomousContentWorkItem>(
        apiBaseUrl,
        `/autonomy/content-work-items/${selectedContentWorkspaceItemId}/status`,
        "PATCH",
        {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: workItemStatusSelection })
        }
      );

      setSelectedContentWorkspaceItem(updated);
      setWorkItemStatusSelection(updated.status);
      setContentWorkspaceItems((current) =>
        current.map((item) => (item.id === updated.id ? updated : item))
      );
      await reloadContentWorkspace();
    } catch (workItemStatusError) {
      setWorkItemStatusSaveError(
        isApiRequestError(workItemStatusError)
          ? workItemStatusError
          : {
              endpoint: `/autonomy/content-work-items/${selectedContentWorkspaceItemId}/status`,
              method: "PATCH",
              message:
                workItemStatusError instanceof Error
                  ? workItemStatusError.message
                  : "Failed to update work item status"
            }
      );
    } finally {
      setSavingContentWorkspaceItemStatus(false);
    }
  }

  async function handleOpenDraftDocument(draftId: string) {
    setSelectedDraftDocumentId(draftId);
    setSelectedDraftDocument(null);
    setSelectedDraftDocumentError(null);
    setDraftSaveError(null);
    setDraftStatusSaveError(null);
    setDraftCreationError(null);
    setIsEditingDraftDocument(false);
    setLoadingDraftDocument(true);

    try {
      const draft = await requestJson<AutonomousDraftDocument>(apiBaseUrl, `/autonomy/drafts/${draftId}`);
      setSelectedDraftDocument(draft);
      setDraftEditForm({
        title: draft.title,
        body: draft.body,
        angle: draft.angle ?? ""
      });
      setDraftStatusSelection(draft.status);
    } catch (draftError) {
      setSelectedDraftDocumentError(
        isApiRequestError(draftError)
          ? draftError
          : {
              endpoint: `/autonomy/drafts/${draftId}`,
              method: "GET",
              message:
                draftError instanceof Error ? draftError.message : "Failed to load linked draft"
            }
      );
    } finally {
      setLoadingDraftDocument(false);
    }
  }

  function handleStartDraftEdit() {
    if (!selectedDraftDocument) {
      return;
    }

    setDraftEditForm({
      title: selectedDraftDocument.title,
      body: selectedDraftDocument.body,
      angle: selectedDraftDocument.angle ?? ""
    });
    setDraftSaveError(null);
    setIsEditingDraftDocument(true);
  }

  function handleCancelDraftEdit() {
    if (selectedDraftDocument) {
      setDraftEditForm({
        title: selectedDraftDocument.title,
        body: selectedDraftDocument.body,
        angle: selectedDraftDocument.angle ?? ""
      });
    }
    setDraftSaveError(null);
    setIsEditingDraftDocument(false);
  }

  function updateWorkspaceItemDraftProgress(
    itemId: string,
    draft: AutonomousDraftDocument
  ) {
    const nextDraftProgress = {
      hasDraft: true as const,
      draftId: draft.id,
      draftStatus: draft.status,
      draftUpdatedAt: draft.updatedAt
    };

    setContentWorkspaceItems((current) =>
      current.map((item) =>
        item.id === itemId
          ? {
              ...item,
              draftProgress: nextDraftProgress
            }
          : item
      )
    );
    setSelectedContentWorkspaceItem((current) =>
      current && current.id === itemId
        ? {
            ...current,
            draftProgress: nextDraftProgress
          }
        : current
    );
  }

  async function handleCreateDraftDocument() {
    if (!selectedContentWorkspaceItem) {
      return;
    }

    setCreatingDraftDocument(true);
    setDraftCreationError(null);

    try {
      const created = await requestJson<AutonomousDraftDocument>(
        apiBaseUrl,
        `/autonomy/content-work-items/${selectedContentWorkspaceItem.id}/draft`,
        "POST"
      );

      updateWorkspaceItemDraftProgress(selectedContentWorkspaceItem.id, created);
      setSelectedDraftDocumentId(created.id);
      setSelectedDraftDocument(created);
      setSelectedDraftDocumentError(null);
      setDraftEditForm({
        title: created.title,
        body: created.body,
        angle: created.angle ?? ""
      });
      setDraftStatusSelection(created.status);
      setIsEditingDraftDocument(false);
      await reloadContentWorkspace();
      await reloadDraftQueue();
    } catch (draftCreateError) {
      setDraftCreationError(
        isApiRequestError(draftCreateError)
          ? draftCreateError
          : {
              endpoint: `/autonomy/content-work-items/${selectedContentWorkspaceItem.id}/draft`,
              method: "POST",
              message:
                draftCreateError instanceof Error
                  ? draftCreateError.message
                  : "Failed to create draft"
            }
      );
    } finally {
      setCreatingDraftDocument(false);
    }
  }

  async function handleSaveDraftDocument() {
    if (!selectedDraftDocumentId) {
      return;
    }

    setSavingDraftDocument(true);
    setDraftSaveError(null);

    try {
      const updated = await requestJson<AutonomousDraftDocument>(
        apiBaseUrl,
        `/autonomy/drafts/${selectedDraftDocumentId}`,
        "PATCH",
        {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: draftEditForm.title,
            body: draftEditForm.body,
            angle: draftEditForm.angle
          })
        }
      );

      setSelectedDraftDocument(updated);
      setDraftEditForm({
        title: updated.title,
        body: updated.body,
        angle: updated.angle ?? ""
      });
      setDraftStatusSelection(updated.status);
      if (
        selectedContentWorkspaceItem &&
        selectedContentWorkspaceItem.id === updated.sourceContentWorkItemId
      ) {
        updateWorkspaceItemDraftProgress(selectedContentWorkspaceItem.id, updated);
      }
      setIsEditingDraftDocument(false);
      await reloadContentWorkspace();
      await reloadDraftQueue();
    } catch (draftSaveRequestError) {
      setDraftSaveError(
        isApiRequestError(draftSaveRequestError)
          ? draftSaveRequestError
          : {
              endpoint: `/autonomy/drafts/${selectedDraftDocumentId}`,
              method: "PATCH",
              message:
                draftSaveRequestError instanceof Error
                  ? draftSaveRequestError.message
                  : "Failed to save draft"
            }
      );
    } finally {
      setSavingDraftDocument(false);
    }
  }

  async function handleSaveDraftStatus() {
    if (!selectedDraftDocumentId) {
      return;
    }

    setSavingDraftStatus(true);
    setDraftStatusSaveError(null);

    try {
      const updated = await requestJson<AutonomousDraftDocument>(
        apiBaseUrl,
        `/autonomy/drafts/${selectedDraftDocumentId}/status`,
        "PATCH",
        {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: draftStatusSelection })
        }
      );

      setSelectedDraftDocument(updated);
      setDraftStatusSelection(updated.status);
      if (
        selectedContentWorkspaceItem &&
        selectedContentWorkspaceItem.id === updated.sourceContentWorkItemId
      ) {
        updateWorkspaceItemDraftProgress(selectedContentWorkspaceItem.id, updated);
      }
      await reloadContentWorkspace();
      await reloadDraftQueue();
    } catch (draftStatusError) {
      setDraftStatusSaveError(
        isApiRequestError(draftStatusError)
          ? draftStatusError
          : {
              endpoint: `/autonomy/drafts/${selectedDraftDocumentId}/status`,
              method: "PATCH",
              message:
                draftStatusError instanceof Error
                  ? draftStatusError.message
                  : "Failed to update draft status"
            }
      );
    } finally {
      setSavingDraftStatus(false);
    }
  }

  function renderSelectedDraftDocumentPanel(loadingLabel: string) {
    return (
      <div
        className="rounded-lg border border-slate-200 bg-white p-3"
        data-testid={
          selectedDraftDocument ? `draft-document-panel-${selectedDraftDocument.id}` : undefined
        }
      >
        {loadingDraftDocument ? (
          <p className="text-sm text-slate-600">{loadingLabel}</p>
        ) : selectedDraftDocumentError ? (
          <div className="text-sm text-amber-800">
            <p className="font-medium">
              Draft inspection failed: {selectedDraftDocumentError.method}{" "}
              {selectedDraftDocumentError.endpoint}
            </p>
            <p className="mt-1 text-xs">
              Status: {selectedDraftDocumentError.status ?? "network error"}
            </p>
            <p className="mt-1 text-xs">
              {selectedDraftDocumentError.responseBody ?? selectedDraftDocumentError.message}
            </p>
          </div>
        ) : selectedDraftDocument ? (
          <div className="space-y-2 text-sm text-slate-700">
            <div className="flex flex-wrap gap-2">
              <button
                aria-label={`Edit draft ${selectedDraftDocument.id}`}
                className="rounded-lg border border-border px-3 py-2 text-sm font-medium"
                data-testid={`edit-draft-${selectedDraftDocument.id}`}
                disabled={savingDraftDocument}
                onClick={handleStartDraftEdit}
                type="button"
              >
                Edit draft
              </button>
            </div>
            <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <label className="block text-sm text-slate-700">
                <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Draft workflow status
                </span>
                <select
                  aria-label="Draft status select"
                  className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                  disabled={savingDraftStatus}
                  onChange={(event) =>
                    setDraftStatusSelection(event.target.value as DraftStatusOption)
                  }
                  value={draftStatusSelection}
                >
                  <option value="draft">draft</option>
                  <option value="ready">ready</option>
                  <option value="blocked">blocked</option>
                  <option value="archived">archived</option>
                </select>
              </label>
              {draftStatusSaveError ? (
                <div className="text-sm text-amber-800">
                  <p className="font-medium">
                    Draft status update failed: {draftStatusSaveError.method}{" "}
                    {draftStatusSaveError.endpoint}
                  </p>
                  <p className="mt-1 text-xs">
                    Status: {draftStatusSaveError.status ?? "network error"}
                  </p>
                  <p className="mt-1 text-xs">
                    {draftStatusSaveError.responseBody ?? draftStatusSaveError.message}
                  </p>
                </div>
              ) : null}
              <button
                className="rounded-lg border border-border px-3 py-2 text-sm font-medium"
                disabled={savingDraftStatus}
                onClick={() => void handleSaveDraftStatus()}
                type="button"
              >
                {savingDraftStatus ? "Applying..." : "Apply draft status"}
              </button>
            </div>
            {isEditingDraftDocument ? (
              <div className="space-y-3">
                <label className="block text-sm text-slate-700">
                  <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Draft title
                  </span>
                  <input
                    aria-label="Draft title input"
                    className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                    onChange={(event) =>
                      setDraftEditForm((current) => ({
                        ...current,
                        title: event.target.value
                      }))
                    }
                    value={draftEditForm.title}
                  />
                </label>
                <label className="block text-sm text-slate-700">
                  <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Draft angle
                  </span>
                  <input
                    aria-label="Draft angle input"
                    className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                    onChange={(event) =>
                      setDraftEditForm((current) => ({
                        ...current,
                        angle: event.target.value
                      }))
                    }
                    value={draftEditForm.angle}
                  />
                </label>
                <label className="block text-sm text-slate-700">
                  <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Draft body
                  </span>
                  <textarea
                    aria-label="Draft body input"
                    className="mt-1 min-h-28 w-full rounded-lg border border-border px-3 py-2 text-sm"
                    onChange={(event) =>
                      setDraftEditForm((current) => ({
                        ...current,
                        body: event.target.value
                      }))
                    }
                    value={draftEditForm.body}
                  />
                </label>
                {draftSaveError ? (
                  <div className="text-sm text-amber-800">
                    <p className="font-medium">
                      Draft save failed: {draftSaveError.method} {draftSaveError.endpoint}
                    </p>
                    <p className="mt-1 text-xs">
                      Status: {draftSaveError.status ?? "network error"}
                    </p>
                    <p className="mt-1 text-xs">
                      {draftSaveError.responseBody ?? draftSaveError.message}
                    </p>
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <button
                    className="rounded-lg border border-border px-3 py-2 text-sm font-medium"
                    disabled={savingDraftDocument}
                    onClick={() => void handleSaveDraftDocument()}
                    type="button"
                  >
                    {savingDraftDocument ? "Saving..." : "Save draft changes"}
                  </button>
                  <button
                    aria-label="Cancel draft edit"
                    className="rounded-lg border border-border px-3 py-2 text-sm font-medium"
                    disabled={savingDraftDocument}
                    onClick={handleCancelDraftEdit}
                    type="button"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Draft title
                  </p>
                  <p className="mt-1">{selectedDraftDocument.title}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Draft status
                  </p>
                  <p className="mt-1">{selectedDraftDocument.status}</p>
                </div>
                {selectedDraftDocument.angle ? (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                      Draft angle
                    </p>
                    <p className="mt-1">{selectedDraftDocument.angle}</p>
                  </div>
                ) : null}
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Draft body preview
                  </p>
                  <p className="mt-1 whitespace-pre-line">
                    {getFirstParagraph(selectedDraftDocument.body)}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    Updated
                  </p>
                  <p className="mt-1">
                    {new Date(selectedDraftDocument.updatedAt).toLocaleString()}
                  </p>
                </div>
              </>
            )}
          </div>
        ) : null}
      </div>
    );
  }

  async function handleCreateSignal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmittingSignal(true);
    setError(null);
    try {
      const created = await parseResponse<Signal>(
        await fetch(`${apiBaseUrl}/signals`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(signalForm)
        })
      );
      setSignals((current) => [...current, created]);
      setSignalForm(initialSignalForm);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create signal");
    } finally {
      setSubmittingSignal(false);
    }
  }

  async function handleCreateSource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmittingSource(true);
    setError(null);
    try {
      const payload = {
        ...sourceForm,
        sourceUrl: sourceForm.sourceUrl?.trim() ? sourceForm.sourceUrl : undefined
      };
      const created = await parseResponse<SourceItem>(
        await fetch(`${apiBaseUrl}/sources`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        })
      );
      setSourceItems((current) => [...current, created]);
      setSourceForm(initialSourceForm);
    } catch (sourceError) {
      setError(sourceError instanceof Error ? sourceError.message : "Failed to add source");
    } finally {
      setSubmittingSource(false);
    }
  }

  async function handleNormalizeSourceIntake(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmittingSourceIntake(true);
    setError(null);
    setSourceIntakeActionMessage(null);
    setCreatedSignalFromIntake(null);
    setCreatedIdeaFromIntake(null);
    try {
      const normalized = await parseResponse<NormalizedSourceSignal>(
        await fetch(`${apiBaseUrl}/sources/intake`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...sourceIntakeForm,
            sourceUrl: sourceIntakeForm.sourceUrl || undefined,
            operatorNotes: sourceIntakeForm.operatorNotes || undefined,
            githubSubtype: sourceIntakeForm.githubSubtype || undefined,
            repoName: sourceIntakeForm.repoName || undefined,
            repoContext: sourceIntakeForm.repoContext || undefined,
            releaseOrChangeType: sourceIntakeForm.releaseOrChangeType || undefined,
            targetRole: sourceIntakeForm.targetRole || undefined,
            companyContext: sourceIntakeForm.companyContext || undefined
          })
        })
      );
      setNormalizedSourceSignal(normalized);
    } catch (sourceIntakeError) {
      setError(
        sourceIntakeError instanceof Error
          ? sourceIntakeError.message
          : "Failed to normalize source intake"
      );
    } finally {
      setSubmittingSourceIntake(false);
    }
  }

  async function handleCreateSignalFromIntake() {
    if (!normalizedSourceSignal) {
      return;
    }

    setCreatingSignalFromIntake(true);
    setError(null);
    setSourceIntakeActionMessage(null);

    try {
      const created = await parseResponse<Signal>(
        await fetch(`${apiBaseUrl}/signals`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: normalizedSourceSignal.title.trim() || summarizeSignalTitle(normalizedSourceSignal.normalizedSignalText),
            sourceType: mapDecisionSourceToSignalSource(
              normalizedSourceSignal.plannerReadyPayload.sourceType
            ),
            rawText: normalizedSourceSignal.normalizedSignalText
          })
        })
      );

      setSignals((current) => [...current, created]);
      setCreatedSignalFromIntake(created);
      setCreatedIdeaFromIntake(null);
      setHighlightedSignalId(created.id);
      setSourceIntakeActionMessage("Created signal from intake.");
    } catch (createError) {
      setError(
        createError instanceof Error ? createError.message : "Failed to create signal from intake"
      );
    } finally {
      setCreatingSignalFromIntake(false);
    }
  }

  async function handleCreateMarket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmittingMarket(true);
    setError(null);
    try {
      const created = await parseResponse<MarketProfile>(
        await fetch(`${apiBaseUrl}/markets`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(marketForm)
        })
      );
      setMarketProfiles((current) => [...current, created]);
      setMarketForm(initialMarketForm);
    } catch (marketError) {
      setError(marketError instanceof Error ? marketError.message : "Failed to add market");
    } finally {
      setSubmittingMarket(false);
    }
  }

  async function handleSaveBrandVoice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmittingBrandVoice(true);
    setError(null);
    try {
      const payload = {
        ...brandVoiceForm,
        writingRules: brandVoiceForm.writingRules,
        bannedPatterns: brandVoiceForm.bannedPatterns,
        preferredPatterns: brandVoiceForm.preferredPatterns
      };
      const created = await parseResponse<BrandVoiceProfile>(
        await fetch(`${apiBaseUrl}/brand-voice`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        })
      );
      setBrandVoice(created);
      setBrandVoiceForm({
        ...initialBrandVoiceForm,
        isActive: true
      });
    } catch (brandVoiceError) {
      setError(
        brandVoiceError instanceof Error
          ? brandVoiceError.message
          : "Failed to save brand voice"
      );
    } finally {
      setSubmittingBrandVoice(false);
    }
  }

  async function handleGenerateIdea(signalId: string) {
    setWorkingSignalId(signalId);
    setError(null);
    try {
      const created = await parseResponse<Idea>(
        await fetch(`${apiBaseUrl}/ideas/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signalId })
        })
      );
      setIdeas((current) => [...current, created]);
    } catch (ideaError) {
      setError(ideaError instanceof Error ? ideaError.message : "Failed to generate idea");
    } finally {
      setWorkingSignalId(null);
    }
  }

  async function handleGenerateContent(ideaId: string) {
    setWorkingIdeaId(ideaId);
    setError(null);
    try {
      const created = await parseResponse<ContentAsset>(
        await fetch(`${apiBaseUrl}/content/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ideaId })
        })
      );
      setContentAssets((current) => [...current, created]);
      setAnalyticsForm((current) => ({
        ...current,
        contentAssetId: current.contentAssetId || created.id
      }));
    } catch (contentError) {
      setError(contentError instanceof Error ? contentError.message : "Failed to generate content");
    } finally {
      setWorkingIdeaId(null);
    }
  }

  async function handleRefineContent(contentId: string) {
    setRefiningContentId(contentId);
    setError(null);
    try {
      const refined = await parseResponse<ContentAsset>(
        await fetch(`${apiBaseUrl}/content/refine`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contentId })
        })
      );
      setContentAssets((current) =>
        current.map((asset) => (asset.id === refined.id ? refined : asset))
      );
    } catch (refineError) {
      setError(refineError instanceof Error ? refineError.message : "Failed to refine content");
    } finally {
      setRefiningContentId(null);
    }
  }

  async function handleGenerateVisual(contentId: string) {
    setVisualizingContentId(contentId);
    setError(null);
    try {
      const visual = await parseResponse<VisualAsset>(
        await fetch(`${apiBaseUrl}/visuals/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contentId })
        })
      );
      setVisualAssets((current) => [...current, visual]);
    } catch (visualError) {
      setError(visualError instanceof Error ? visualError.message : "Failed to generate visual");
    } finally {
      setVisualizingContentId(null);
    }
  }

  async function handleGenerateFinalPost(contentId: string) {
    setFinalizingContentId(contentId);
    setError(null);
    try {
      const outcomeContext =
        finalPostConfig.outcomeAwareShaping &&
        (feedbackSummary.totalRecords > 0 || patternMemorySummary.totalPatterns > 0)
          ? {
              feedbackSummary:
                feedbackSummary.totalRecords > 0 ? feedbackSummary : undefined,
              patternMemorySummary:
                patternMemorySummary.totalPatterns > 0 ? patternMemorySummary : undefined
            }
          : undefined;
      const finalized = await parseResponse<ContentAsset>(
        await fetch(`${apiBaseUrl}/content/finalize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contentId,
            config: {
              hookMode: finalPostConfig.hookMode,
              antiBlandness: finalPostConfig.antiBlandness,
              outcomeAwareShaping: finalPostConfig.outcomeAwareShaping
            },
            outcomeContext
          })
        })
      );
      setContentAssets((current) =>
        current.map((asset) => (asset.id === finalized.id ? finalized : asset))
      );
    } catch (finalizeError) {
      setError(
        finalizeError instanceof Error ? finalizeError.message : "Failed to generate final post"
      );
    } finally {
      setFinalizingContentId(null);
    }
  }

  async function handleGenerateFinalPostV2(contentId: string) {
    setFinalizingV2ContentId(contentId);
    setError(null);
    try {
      const finalized = await parseResponse<ExperimentalFinalPost>(
        await fetch(`${apiBaseUrl}/content/finalize-v2`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contentId })
        })
      );
      setExperimentalFinalPosts((current) => {
        const next = current.filter((asset) => asset.contentId !== finalized.contentId);
        return [...next, finalized];
      });
    } catch (finalizeError) {
      setError(
        finalizeError instanceof Error ? finalizeError.message : "Failed to generate final post v2"
      );
    } finally {
      setFinalizingV2ContentId(null);
    }
  }

  async function handleCompareFinalPostVariants(contentId: string) {
    setComparingContentId(contentId);
    setError(null);
    try {
      const outcomeContext =
        finalPostConfig.outcomeAwareShaping &&
        (feedbackSummary.totalRecords > 0 || patternMemorySummary.totalPatterns > 0)
          ? {
              feedbackSummary:
                feedbackSummary.totalRecords > 0 ? feedbackSummary : undefined,
              patternMemorySummary:
                patternMemorySummary.totalPatterns > 0 ? patternMemorySummary : undefined
            }
          : undefined;
      const legacyDefault = await parseResponse<ContentAsset>(
        await fetch(`${apiBaseUrl}/content/finalize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contentId })
        })
      );

      const legacyV3 = await parseResponse<ContentAsset>(
        await fetch(`${apiBaseUrl}/content/finalize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contentId,
            config: {
              hookMode: finalPostConfig.hookMode,
              antiBlandness: finalPostConfig.antiBlandness,
              outcomeAwareShaping: finalPostConfig.outcomeAwareShaping
            },
            outcomeContext
          })
        })
      );

      const experimental = await parseResponse<ExperimentalFinalPost>(
        await fetch(`${apiBaseUrl}/content/finalize-v2`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contentId })
        })
      );

      setContentAssets((current) =>
        current.map((asset) => (asset.id === legacyV3.id ? legacyV3 : asset))
      );
      setExperimentalFinalPosts((current) => {
        const next = current.filter((asset) => asset.contentId !== experimental.contentId);
        return [...next, experimental];
      });
      setFinalPostComparisonViewMode("full");
      setFinalPostComparison({
        contentId,
        variants: [
          {
            label: "Legacy default",
            hook: legacyDefault.finalHook ?? "",
            body: legacyDefault.finalBody ?? "",
            closing: legacyDefault.finalClosing,
            qualityMetadata: legacyDefault.finalQualityMetadata,
            qualityScore: legacyDefault.finalQualityScore
          },
          {
            label: "Legacy + V3",
            hook: legacyV3.finalHook ?? "",
            body: legacyV3.finalBody ?? "",
            closing: legacyV3.finalClosing,
            qualityMetadata: legacyV3.finalQualityMetadata,
            qualityScore: legacyV3.finalQualityScore
          },
          {
            label: "V2 experimental",
            hook: experimental.hook,
            body: experimental.post,
            mode: experimental.mode,
            notesFallback: "Metadata unavailable for this variant."
          }
        ]
      });
    } catch (comparisonError) {
      setError(
        comparisonError instanceof Error
          ? comparisonError.message
          : "Failed to compare final post variants"
      );
    } finally {
      setComparingContentId(null);
    }
  }

  async function handleGenerateComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmittingComment(true);
    setError(null);
    try {
      const payload = withRelevanceAssist(commentForm, relevanceResult);
      const generated = await parseResponse<GeneratedComment>(
        await fetch(`${apiBaseUrl}/comments/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        })
      );
      setGeneratedComment(generated);
    } catch (commentError) {
      setError(commentError instanceof Error ? commentError.message : "Failed to generate comment");
    } finally {
      setSubmittingComment(false);
    }
  }

  async function handleGenerateReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmittingReply(true);
    setError(null);
    try {
      const payload = withRelevanceAssist(replyForm, relevanceResult);
      const generated = await parseResponse<GeneratedReply>(
        await fetch(`${apiBaseUrl}/replies/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        })
      );
      setGeneratedReply(generated);
    } catch (replyError) {
      setError(replyError instanceof Error ? replyError.message : "Failed to generate reply");
    } finally {
      setSubmittingReply(false);
    }
  }

  async function handleAnalyzeRelevance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmittingRelevance(true);
    setError(null);
    try {
      const generated = await parseResponse<RelevanceAnalysis>(
        await fetch(`${apiBaseUrl}/relevance/analyze`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(relevanceForm)
        })
      );
      setRelevanceResult(generated);
    } catch (relevanceError) {
      setError(
        relevanceError instanceof Error ? relevanceError.message : "Failed to analyze relevance"
      );
    } finally {
      setSubmittingRelevance(false);
    }
  }

  async function handlePlanDecision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmittingDecision(true);
    setError(null);
    setDecisionActionMessage(null);
    try {
      const generated = await parseResponse<DecisionPlan>(
        await fetch(`${apiBaseUrl}/decision/plan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(decisionForm)
        })
      );
      setDecisionPlan(generated);
      setRecommendedActionPayload({
        plannerResult: generated,
        signalText: decisionForm.signalText,
        sourceType: decisionForm.sourceType,
        targetRole: decisionForm.targetRole,
        companyContext: decisionForm.companyContext,
        postContext: decisionForm.postContext,
        relevanceScore: decisionForm.relevanceScore,
        bestAngle: decisionForm.bestAngle ?? generated.bestAngle,
        recommendedAction: decisionForm.recommendedAction,
        reasoningSummary: decisionForm.reasoningSummary || generated.reasoningSummary,
        hasCommentContext: decisionForm.hasCommentContext,
        hasReplyContext: decisionForm.hasReplyContext
      });
    } catch (decisionError) {
      setError(
        decisionError instanceof Error ? decisionError.message : "Failed to plan decision"
      );
    } finally {
      setSubmittingDecision(false);
    }
  }

  async function handleRunAudienceScout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setScoutingAudience(true);
    setAudienceScoutActionMessage(null);
    setError(null);
    try {
      const result = await parseResponse<AudienceScoutResult>(
        await fetch(`${apiBaseUrl}/audience/scout`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetTopics: parseScoutInputList(audienceScoutForm.targetTopics),
            targetRoles: parseScoutInputList(audienceScoutForm.targetRoles),
            targetKeywords: parseScoutInputList(audienceScoutForm.targetKeywords),
            publicInputs: audienceScoutForm.publicExcerpt.trim()
              ? [
                  {
                    sourceLabel: audienceScoutForm.publicSourceLabel.trim() || undefined,
                    sourceUrl: audienceScoutForm.publicSourceUrl.trim() || undefined,
                    excerpt: audienceScoutForm.publicExcerpt.trim()
                  }
                ]
              : undefined,
            maxResults: audienceScoutForm.maxResults
          })
        })
      );
      setAudienceScoutResult(result);
    } catch (scoutError) {
      setError(scoutError instanceof Error ? scoutError.message : "Failed to run audience scout");
    } finally {
      setScoutingAudience(false);
    }
  }

  function handleSendScoutItemToSourceIntake(item: AudienceScoutItem) {
    setSourceIntakeForm({
      ...initialSourceIntakeForm,
      sourceType: "manual_research",
      title: summarizeSignalTitle(item.painSignalSummary),
      sourceUrl: item.sourceUrl ?? "",
      summaryText: item.rawExcerpt,
      operatorNotes: `${item.whyItMatters}${item.authorRole ? ` Target role: ${item.authorRole}.` : ""}${
        item.sourceLabel ? ` Source label: ${item.sourceLabel}.` : ""
      }`,
      targetRole: item.authorRole ?? "",
      companyContext: item.topicCluster ?? ""
    });
    setAudienceScoutActionMessage("Sent scout item to Source Intake.");
  }

  function handleSaveScoutItemForLater(item: AudienceScoutItem) {
    setSavedDecisionItems((current) => [createSavedAudienceScoutItem(item), ...current]);
    setAudienceScoutActionMessage("Saved scout item for later.");
  }

  function handleSendScoutItemToDecisionPlanner(item: AudienceScoutItem) {
    setDecisionForm({
      ...initialDecisionForm,
      signalText: item.painSignalSummary,
      sourceType: "commentary",
      signalCategory: item.topicCluster ?? "audience_scout",
      authorRole: item.authorRole ?? "",
      targetRole: item.authorRole ?? "",
      companyContext: item.topicCluster ?? "",
      postContext: item.rawExcerpt,
      reasoningSummary: item.whyItMatters,
      bestAngle: mapScoutActionToBestAngle(item.suggestedActionType),
      hasCommentContext: item.suggestedActionType === "comment_opportunity",
      hasReplyContext: item.suggestedActionType === "reply_opportunity"
    });
    setDecisionPlan(null);
    setRecommendedActionPayload(null);
    setAudienceScoutActionMessage("Sent scout item to Decision Planner.");
  }

  async function handleRunSolutionScout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setScoutingSolutions(true);
    setSolutionScoutActionMessage(null);
    setError(null);
    try {
      const result = await parseResponse<SolutionScoutResult>(
        await fetch(`${apiBaseUrl}/solutions/scout`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceType: solutionScoutForm.sourceType,
            targetProblem: solutionScoutForm.targetProblem.trim() || undefined,
            sourceLabel: solutionScoutForm.sourceLabel.trim() || undefined,
            sourceUrl: solutionScoutForm.sourceUrl.trim() || undefined,
            sourceExcerpt: solutionScoutForm.sourceExcerpt,
            operatorNotes: solutionScoutForm.operatorNotes.trim() || undefined
          })
        })
      );
      setSolutionScoutResult(result);
    } catch (solutionError) {
      setError(
        solutionError instanceof Error ? solutionError.message : "Failed to run solution scout"
      );
    } finally {
      setScoutingSolutions(false);
    }
  }

  async function runScoutFeedItems(input: ScoutFeedInput, successMessage: string) {
    const result = await parseResponse<ScoutFeedResult>(
      await fetch(`${apiBaseUrl}/scout/feed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input)
      })
    );

    setScoutFeedResult(result);

    if (result.audienceItems && result.audienceItems.length > 0) {
      const audienceItems = result.audienceItems;
      setAudienceScoutResult((current) => ({
        items: mergeById(current?.items ?? [], audienceItems),
        summary:
          current?.items && current.items.length > 0
            ? `${mergeById(current.items, audienceItems).length} audience signals available for review.`
            : `${audienceItems.length} audience signals available for review.`,
        notes: "Audience Scout stays review-first."
      }));
    }

    if (result.solutionItems && result.solutionItems.length > 0) {
      const solutionItems = result.solutionItems;
      setSolutionScoutResult((current) => ({
        items: mergeById(current?.items ?? [], solutionItems),
        summary:
          current?.items && current.items.length > 0
            ? `${mergeById(current.items, solutionItems).length} solution patterns available for review.`
            : `${solutionItems.length} solution patterns available for review.`,
        notes: "Solution Scout stays review-first."
      }));
    }

    setScoutFeedActionMessage(successMessage);
  }

  async function handleRunScoutFeed(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRunningScoutFeed(true);
    setScoutFeedActionMessage(null);
    setError(null);

    try {
      await runScoutFeedItems(
        {
          mode: scoutFeedForm.mode,
          items: parseScoutFeedBatchInput(
            scoutFeedForm.mode,
            scoutFeedForm.solutionSourceType,
            scoutFeedForm.targetProblem,
            scoutFeedForm.batchInput
          )
        } satisfies ScoutFeedInput,
        "Added feed results to the scout review layers."
      );
    } catch (feedError) {
      setError(feedError instanceof Error ? feedError.message : "Failed to run scout feed");
    } finally {
      setRunningScoutFeed(false);
    }
  }

  function handleAddLiveIngestionItems(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLiveIngestionActionMessage(null);
    setError(null);

    const nextItems = createLiveIngestionItems(liveIngestionBufferForm);
    if (nextItems.length === 0) {
      setLiveIngestionActionMessage("No live ingestion items were added.");
      return;
    }

    setLiveIngestionBuffer((current) => {
      const existingFingerprints = new Set(current.map((item) => item.fingerprint));
      const uniqueItems = nextItems.filter((item) => {
        if (existingFingerprints.has(item.fingerprint)) {
          return false;
        }

        existingFingerprints.add(item.fingerprint);
        return true;
      });

      if (uniqueItems.length === 0) {
        setLiveIngestionActionMessage("Skipped duplicate live ingestion items.");
        return current;
      }

      const duplicateCount = nextItems.length - uniqueItems.length;
      setLiveIngestionActionMessage(
        duplicateCount > 0
          ? `Added ${uniqueItems.length} live ingestion item${uniqueItems.length === 1 ? "" : "s"} and skipped ${duplicateCount} duplicate${duplicateCount === 1 ? "" : "s"}.`
          : `Added ${uniqueItems.length} live ingestion item${uniqueItems.length === 1 ? "" : "s"}.`
      );

      return [...uniqueItems, ...current];
    });

    setLiveIngestionBufferForm((current) => ({
      ...current,
      batchInput: "",
      notes: ""
    }));
  }

  async function handleSendLiveIngestionItemToScoutFeed(item: LiveIngestionItem) {
    setRunningScoutFeed(true);
    setLiveIngestionActionMessage(null);
    setError(null);

    try {
      await runScoutFeedItems(
        {
          mode: "mixed",
          items: [liveIngestionItemToScoutFeedItem(item)]
        },
        "Added feed results to the scout review layers."
      );

      setLiveIngestionBuffer((current) =>
        current.map((entry) =>
          entry.id === item.id ? { ...entry, status: "sent_to_feed" as const } : entry
        )
      );
      setSelectedLiveIngestionItemIds((current) => current.filter((id) => id !== item.id));
      setLiveIngestionActionMessage("Sent live ingestion item to Scout Feed.");
    } catch (feedError) {
      setError(feedError instanceof Error ? feedError.message : "Failed to send live ingestion item");
    } finally {
      setRunningScoutFeed(false);
    }
  }

  function handleUpdateLiveIngestionItemStatus(
    id: string,
    status: LiveIngestionItem["status"],
    message: string
  ) {
    setLiveIngestionBuffer((current) =>
      current.map((item) => (item.id === id ? { ...item, status } : item))
    );
    setSelectedLiveIngestionItemIds((current) => current.filter((itemId) => itemId !== id));
    setLiveIngestionActionMessage(message);
  }

  function handleToggleLiveIngestionSelection(id: string) {
    setSelectedLiveIngestionItemIds((current) =>
      current.includes(id) ? current.filter((itemId) => itemId !== id) : [...current, id]
    );
  }

  function handleSelectVisibleLiveIngestionItems() {
    setSelectedLiveIngestionItemIds((current) => {
      const selected = new Set(current);
      for (const id of visibleLiveIngestionItemIds) {
        selected.add(id);
      }
      return [...selected];
    });
  }

  function handleSelectEligibleVisibleLiveIngestionItems() {
    setSelectedLiveIngestionItemIds((current) => {
      const selected = new Set(current);
      for (const id of eligibleVisibleLiveIngestionItemIds) {
        selected.add(id);
      }
      return [...selected];
    });
  }

  function handleClearVisibleLiveIngestionSelection() {
    const visibleIds = new Set(visibleLiveIngestionItemIds);
    setSelectedLiveIngestionItemIds((current) =>
      current.filter((itemId) => !visibleIds.has(itemId))
    );
  }

  function handleSelectActiveRunLiveIngestionItems() {
    if (!activeLiveIngestionRefreshRun) {
      return;
    }

    setSelectedLiveIngestionItemIds((current) => {
      const selected = new Set(current);
      for (const id of activeRunLiveIngestionItemIds) {
        selected.add(id);
      }
      return [...selected];
    });
  }

  function handleSelectEligibleActiveRunLiveIngestionItems() {
    if (!activeLiveIngestionRefreshRun) {
      return;
    }

    setSelectedLiveIngestionItemIds((current) => {
      const selected = new Set(current);
      for (const id of activeEligibleRunLiveIngestionItemIds) {
        selected.add(id);
      }
      return [...selected];
    });
  }

  function handleClearActiveRunLiveIngestionSelection() {
    if (!activeLiveIngestionRefreshRun) {
      return;
    }

    const runIds = new Set(activeRunLiveIngestionItemIds);
    setSelectedLiveIngestionItemIds((current) =>
      current.filter((itemId) => !runIds.has(itemId))
    );
  }

  function handleSelectVisibleActiveRunLiveIngestionItems() {
    if (!activeLiveIngestionRefreshRun) {
      return;
    }

    setSelectedLiveIngestionItemIds((current) => {
      const selected = new Set(current);
      for (const id of activeVisibleRunLiveIngestionItemIds) {
        selected.add(id);
      }
      return [...selected];
    });
  }

  function handleSelectEligibleVisibleActiveRunLiveIngestionItems() {
    if (!activeLiveIngestionRefreshRun) {
      return;
    }

    setSelectedLiveIngestionItemIds((current) => {
      const selected = new Set(current);
      for (const id of activeEligibleVisibleRunLiveIngestionItemIds) {
        selected.add(id);
      }
      return [...selected];
    });
  }

  function handleClearVisibleActiveRunLiveIngestionSelection() {
    if (!activeLiveIngestionRefreshRun) {
      return;
    }

    const visibleRunIds = new Set(activeVisibleRunLiveIngestionItemIds);
    setSelectedLiveIngestionItemIds((current) =>
      current.filter((itemId) => !visibleRunIds.has(itemId))
    );
  }

  async function handleSendSelectedLiveIngestionItemsToScoutFeed() {
    setRunningScoutFeed(true);
    setLiveIngestionActionMessage(null);
    setError(null);

    const selectedItems = liveIngestionBuffer.filter((item) =>
      selectedLiveIngestionItemIds.includes(item.id)
    );
    const eligibleItems = selectedItems.filter((item) => item.status === "new");
    const skippedCount = selectedItems.length - eligibleItems.length;

    if (eligibleItems.length === 0) {
      setRunningScoutFeed(false);
      setLiveIngestionActionMessage(
        skippedCount > 0
          ? `Skipped ${skippedCount} ineligible item${skippedCount === 1 ? "" : "s"}.`
          : "No eligible live ingestion items selected."
      );
      return;
    }

    try {
      await runScoutFeedItems(
        {
          mode: "mixed",
          items: eligibleItems.map(liveIngestionItemToScoutFeedItem)
        },
        "Added feed results to the scout review layers."
      );

      const eligibleIds = new Set(eligibleItems.map((item) => item.id));
      setLiveIngestionBuffer((current) =>
        current.map((item) =>
          eligibleIds.has(item.id) ? { ...item, status: "sent_to_feed" as const } : item
        )
      );
      setSelectedLiveIngestionItemIds((current) =>
        current.filter((id) => !eligibleIds.has(id))
      );
      setLiveIngestionActionMessage(
        skippedCount > 0
          ? `Sent ${eligibleItems.length} selected live ingestion item${eligibleItems.length === 1 ? "" : "s"} to Scout Feed. Skipped ${skippedCount} ineligible item${skippedCount === 1 ? "" : "s"}.`
          : `Sent ${eligibleItems.length} selected live ingestion item${eligibleItems.length === 1 ? "" : "s"} to Scout Feed.`
      );
    } catch (feedError) {
      setError(feedError instanceof Error ? feedError.message : "Failed to send selected live ingestion items");
    } finally {
      setRunningScoutFeed(false);
    }
  }

  async function handleAddWatchlistItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWatchlistActionMessage(null);
    setError(null);

    const label = watchlistForm.label.trim();
    if (!label) {
      setWatchlistActionMessage("Watchlist label is required.");
      return;
    }

    const seedExcerpt = watchlistForm.notes.trim() || `Track ${label}`;

    // If auto-promotion is enabled, create autonomous watchlist via API
    if (watchlistForm.enableAutoPromotion || watchlistForm.enableAutoDraft) {
      try {
        await requestJson<AutonomousWatchlist>(
          apiBaseUrl,
          "/autonomy/watchlists",
          "POST",
          {
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              sourceKind: watchlistForm.sourceKind,
              label,
              sourceUrl: watchlistForm.sourceUrl.trim() || undefined,
              notes: watchlistForm.notes.trim() || undefined,
              seedExcerpt,
              refreshCadence: watchlistForm.refreshCadence,
              priority: watchlistForm.priority === "high" ? "high" : undefined,
              isActive: true,
              autoPromotionRules: {
                enabled: watchlistForm.enableAutoPromotion,
                autoDraftGeneration: watchlistForm.enableAutoDraft
              }
            })
          }
        );
        setWatchlistForm(initialWatchlistForm);
        setWatchlistActionMessage("Added autonomous watchlist with auto-promotion enabled.");
        await reloadAutonomousWatchlists();
        return;
      } catch (error) {
        setWatchlistActionMessage(
          `Failed to create autonomous watchlist: ${error instanceof Error ? error.message : "Unknown error"}`
        );
        return;
      }
    }

    // Otherwise, create local watchlist item
    setWatchlistItems((current) => [
      {
        id: `watch-${new Date().toISOString()}`,
        sourceKind: watchlistForm.sourceKind,
        label,
        sourceUrl: watchlistForm.sourceUrl.trim() || undefined,
        notes: watchlistForm.notes.trim() || undefined,
        refreshCadence: watchlistForm.refreshCadence,
        priority: watchlistForm.priority === "high" ? "high" : undefined,
        isActive: true,
        createdAt: new Date().toISOString()
      },
      ...current
    ]);
    setWatchlistForm(initialWatchlistForm);
    setWatchlistActionMessage("Added watchlist item.");
  }

  function handleSetWatchlistActive(id: string, isActive: boolean) {
    setWatchlistItems((current) =>
      current.map((item) => (item.id === id ? { ...item, isActive } : item))
    );
    setWatchlistActionMessage(isActive ? "Activated watchlist item." : "Deactivated watchlist item.");
  }

  function handleRemoveWatchlistItem(id: string) {
    setWatchlistItems((current) => current.filter((item) => item.id !== id));
    setWatchlistActionMessage("Removed watchlist item.");
  }

  function recordLiveIngestionRefreshRun(run: LiveIngestionRefreshRun) {
    setLiveIngestionRefreshRuns((current) => [run, ...current].slice(0, 12));
  }

  function handleSetLiveIngestionRefreshRunReviewStatus(
    runId: string,
    reviewStatus: LiveIngestionRefreshRun["reviewStatus"]
  ) {
    setLiveIngestionRefreshRuns((current) =>
      current.map((run) => (run.id === runId ? { ...run, reviewStatus } : run))
    );
  }

  function handleRefreshWatchlistsByCadence(
    cadence: Extract<WatchlistItem["refreshCadence"], "daily_candidate" | "weekly_candidate">
  ) {
    setLiveIngestionActionMessage(null);
    setWatchlistActionMessage(null);
    setError(null);

    const matchingItems = watchlistItems.filter(
      (item) => item.isActive && item.refreshCadence === cadence
    );

    if (matchingItems.length === 0) {
      setWatchlistActionMessage(
        `No active ${cadence === "daily_candidate" ? "daily" : "weekly"} candidate watchlists to refresh.`
      );
      return;
    }

    const refreshNow = new Date().toISOString();
    const refreshRun: LiveIngestionRefreshRun = {
      id: createLiveIngestionRefreshRunId(
        cadence,
        refreshNow,
        matchingItems.map((item) => item.id)
      ),
      label: formatLiveIngestionRefreshRunLabel(
        cadence,
        matchingItems.map((item) => item.label)
      ),
      triggerType: cadence,
      triggeredAt: refreshNow,
      createdCount: 0,
      skippedCount: 0,
      watchlistIds: matchingItems.map((item) => item.id),
      watchlistLabels: matchingItems.map((item) => item.label),
      reviewStatus: "open"
    };
    const refreshItems = matchingItems.map((item) => ({
      watchlistId: item.id,
      snapshot: createRefreshLiveIngestionItemFromWatchlist(item, refreshNow, refreshRun)
    }));
    const existingFingerprints = new Set(liveIngestionBuffer.map((entry) => entry.fingerprint));
    const uniqueRefreshItems = refreshItems.filter((item) => {
      if (existingFingerprints.has(item.snapshot.fingerprint)) {
        return false;
      }

      existingFingerprints.add(item.snapshot.fingerprint);
      return true;
    });
    const createdCount = uniqueRefreshItems.length;
    const skippedCount = refreshItems.length - createdCount;

    setLiveIngestionBuffer((current) =>
      uniqueRefreshItems.length > 0
        ? [...uniqueRefreshItems.map((item) => item.snapshot), ...current]
        : current
    );

    const createdIds = new Set(
      refreshItems
        .filter((item) =>
          !liveIngestionBuffer.some((entry) => entry.fingerprint === item.snapshot.fingerprint)
        )
        .map((item) => item.watchlistId)
    );

    if (createdIds.size > 0) {
      setWatchlistItems((current) =>
        current.map((entry) =>
          createdIds.has(entry.id) ? { ...entry, lastRefreshedAt: refreshNow } : entry
        )
      );
    }

    recordLiveIngestionRefreshRun({
      ...refreshRun,
      createdCount,
      skippedCount
    });

    const cadenceLabel = cadence === "daily_candidate" ? "daily candidate" : "weekly candidate";
    setWatchlistActionMessage(
      createdCount > 0
        ? skippedCount > 0
          ? `Refreshed ${createdCount} ${cadenceLabel} watchlist${createdCount === 1 ? "" : "s"} and skipped ${skippedCount} duplicate${skippedCount === 1 ? "" : "s"}.`
          : `Refreshed ${createdCount} ${cadenceLabel} watchlist${createdCount === 1 ? "" : "s"}.`
        : `Skipped ${skippedCount} duplicate ${cadenceLabel} refresh snapshot${skippedCount === 1 ? "" : "s"}.`
    );
  }

  function handleUseWatchlistForSnapshot(item: WatchlistItem) {
    setLiveIngestionBufferForm((current) => ({
      ...current,
      sourceKind: watchlistKindToLiveIngestionSourceKind(item.sourceKind),
      sourceLabel: item.label,
      sourceUrl: item.sourceUrl ?? "",
      notes: item.notes ?? ""
    }));
    setWatchlistItems((current) =>
      current.map((entry) =>
        entry.id === item.id ? { ...entry, lastUsedAt: new Date().toISOString() } : entry
      )
    );
    setWatchlistActionMessage("Prefilled live ingestion buffer from watchlist item.");
  }

  function handleCreateWatchlistSnapshot(item: WatchlistItem) {
    setLiveIngestionActionMessage(null);
    setError(null);

    const draftItem = createDraftLiveIngestionItemFromWatchlist(item);

    setLiveIngestionBuffer((current) => {
      if (current.some((entry) => entry.fingerprint === draftItem.fingerprint)) {
        setLiveIngestionActionMessage("Skipped duplicate draft live ingestion snapshot.");
        return current;
      }

      setLiveIngestionActionMessage("Created draft live ingestion snapshot from watchlist item.");
      return [draftItem, ...current];
    });

    setWatchlistItems((current) =>
      current.map((entry) =>
        entry.id === item.id ? { ...entry, lastUsedAt: new Date().toISOString() } : entry
      )
    );
  }

  function handleRefreshWatchlistItem(item: WatchlistItem) {
    setLiveIngestionActionMessage(null);
    setWatchlistActionMessage(null);
    setError(null);

    if (!item.isActive) {
      setWatchlistActionMessage("Inactive watchlist items cannot be refreshed.");
      return;
    }

    const refreshNow = new Date().toISOString();
    const refreshRun: LiveIngestionRefreshRun = {
      id: createLiveIngestionRefreshRunId("single_watchlist", refreshNow, [item.id]),
      label: formatLiveIngestionRefreshRunLabel("single_watchlist", [item.label]),
      triggerType: "single_watchlist",
      triggeredAt: refreshNow,
      createdCount: 0,
      skippedCount: 0,
      watchlistIds: [item.id],
      watchlistLabels: [item.label],
      reviewStatus: "open"
    };
    const refreshItem = createRefreshLiveIngestionItemFromWatchlist(item, refreshNow, refreshRun);
    const isDuplicate = liveIngestionBuffer.some((entry) => entry.fingerprint === refreshItem.fingerprint);
    const createdCount = isDuplicate ? 0 : 1;
    const skippedCount = isDuplicate ? 1 : 0;

    setLiveIngestionBuffer((current) => {
      if (isDuplicate) {
        setWatchlistActionMessage("Skipped duplicate watchlist refresh snapshot.");
        return current;
      }

      setWatchlistActionMessage("Refreshed watchlist item into Live Ingestion Buffer.");
      return [refreshItem, ...current];
    });

    recordLiveIngestionRefreshRun({
      ...refreshRun,
      createdCount,
      skippedCount
    });

    setWatchlistItems((current) =>
      current.map((entry) =>
        entry.id === item.id ? { ...entry, lastRefreshedAt: refreshNow } : entry
      )
    );
  }

  function handleRefreshActiveWatchlists() {
    setLiveIngestionActionMessage(null);
    setWatchlistActionMessage(null);
    setError(null);

    const activeItems = watchlistItems.filter((item) => item.isActive);
    if (activeItems.length === 0) {
      setWatchlistActionMessage("No active watchlist items available for refresh.");
      return;
    }

    const refreshNow = new Date().toISOString();
    const refreshRun: LiveIngestionRefreshRun = {
      id: createLiveIngestionRefreshRunId(
        "active_watchlists",
        refreshNow,
        activeItems.map((item) => item.id)
      ),
      label: formatLiveIngestionRefreshRunLabel(
        "active_watchlists",
        activeItems.map((item) => item.label)
      ),
      triggerType: "active_watchlists",
      triggeredAt: refreshNow,
      createdCount: 0,
      skippedCount: 0,
      watchlistIds: activeItems.map((item) => item.id),
      watchlistLabels: activeItems.map((item) => item.label),
      reviewStatus: "open"
    };
    const refreshItems = activeItems.map((item) =>
      createRefreshLiveIngestionItemFromWatchlist(item, refreshNow, refreshRun)
    );

    const createdIds = new Set<string>();
    const existingFingerprints = new Set(liveIngestionBuffer.map((item) => item.fingerprint));
    const nextItems = refreshItems.filter((item) => {
      if (existingFingerprints.has(item.fingerprint)) {
        return false;
      }

      existingFingerprints.add(item.fingerprint);
      createdIds.add(item.watchlistItemId ?? "");
      return true;
    });
    const createdCount = nextItems.length;
    const skippedCount = refreshItems.length - createdCount;

    setLiveIngestionBuffer((current) =>
      nextItems.length > 0 ? [...nextItems, ...current] : current
    );

    if (createdCount > 0) {
      setWatchlistItems((current) =>
        current.map((entry) =>
          createdIds.has(entry.id) ? { ...entry, lastRefreshedAt: refreshNow } : entry
        )
      );
    }

    recordLiveIngestionRefreshRun({
      ...refreshRun,
      createdCount,
      skippedCount
    });

    setWatchlistActionMessage(
      createdCount > 0
        ? skippedCount > 0
          ? `Refreshed ${createdCount} active watchlist${createdCount === 1 ? "" : "s"} into Live Ingestion Buffer and skipped ${skippedCount} duplicate${skippedCount === 1 ? "" : "s"}.`
          : `Refreshed ${createdCount} active watchlist${createdCount === 1 ? "" : "s"} into Live Ingestion Buffer.`
        : skippedCount > 0
          ? `Skipped ${skippedCount} duplicate watchlist refresh snapshot${skippedCount === 1 ? "" : "s"}.`
          : "No active watchlist items available for refresh."
    );
  }

  function handleUseDraftLiveIngestionItem(item: LiveIngestionItem) {
    setLiveIngestionBufferForm((current) => ({
      ...current,
      sourceKind: item.sourceKind,
      sourceLabel: item.sourceLabel ?? "",
      sourceUrl: item.sourceUrl ?? "",
      batchInput: item.rawExcerpt,
      notes: item.notes ?? ""
    }));
    setLiveIngestionActionMessage("Loaded draft live ingestion snapshot into the buffer form.");
  }

  function getLiveIngestionDraftText(item: LiveIngestionItem) {
    return liveIngestionDraftEdits[item.id] ?? item.rawExcerpt;
  }

  function handleEditLiveIngestionDraft(itemId: string, value: string) {
    setLiveIngestionDraftEdits((current) => ({
      ...current,
      [itemId]: value
    }));
  }

  function handleSaveLiveIngestionDraft(item: LiveIngestionItem) {
    const nextExcerpt = getLiveIngestionDraftText(item);

    setLiveIngestionBuffer((current) =>
      current.map((entry) =>
        entry.id === item.id
          ? {
              ...entry,
              rawExcerpt: nextExcerpt
            }
          : entry
      )
    );
    setLiveIngestionActionMessage("Saved draft live ingestion item.");
  }

  function handleCompleteLiveIngestionDraft(item: LiveIngestionItem) {
    const nextExcerpt = getLiveIngestionDraftText(item).trim();

    if (!nextExcerpt) {
      setLiveIngestionActionMessage(
        "Draft remains blocked. Add excerpt text before sending to Scout Feed."
      );
      return;
    }

    const nextFingerprint = buildLiveIngestionFingerprint(
      item.sourceKind,
      item.sourceUrl ?? "",
      nextExcerpt
    );

    if (
      liveIngestionBuffer.some(
        (entry) =>
          entry.id !== item.id &&
          entry.fingerprint === nextFingerprint &&
          entry.status !== "discarded" &&
          entry.status !== "archived"
      )
    ) {
      setLiveIngestionActionMessage(
        "Draft remains blocked. A matching live ingestion item already exists."
      );
      return;
    }

    setLiveIngestionBuffer((current) =>
      current.map((entry) =>
        entry.id === item.id
          ? {
              ...entry,
              rawExcerpt: nextExcerpt,
              fingerprint: nextFingerprint,
              status: "new" as const
            }
          : entry
      )
    );
    setLiveIngestionDraftEdits((current) => {
      const next = { ...current };
      delete next[item.id];
      return next;
    });
    setLiveIngestionActionMessage("Completed draft live ingestion item.");
  }

  function handleSendSolutionItemToSourceIntake(item: SolutionScoutItem) {
    setSourceIntakeForm({
      ...initialSourceIntakeForm,
      sourceType:
        item.sourceType === "github"
          ? "github"
          : item.sourceType === "article"
            ? "article"
            : "manual_research",
      title: summarizeSignalTitle(item.implementationLesson),
      sourceUrl: item.sourceUrl ?? "",
      summaryText: item.rawExcerpt,
      operatorNotes: `${item.implementationLesson} ${item.tradeoffOrConstraint}`.trim(),
      companyContext: item.solutionPattern
    });
    setSolutionScoutActionMessage("Sent solution item to Source Intake.");
  }

  function handleSaveSolutionItemForLater(item: SolutionScoutItem) {
    setSavedDecisionItems((current) => [createSavedSolutionScoutItem(item), ...current]);
    setSolutionScoutActionMessage("Saved solution item for later.");
  }

  function handleSendSolutionItemToDecisionPlanner(item: SolutionScoutItem) {
    setDecisionForm({
      ...initialDecisionForm,
      signalText: item.implementationLesson,
      sourceType:
        item.sourceType === "github"
          ? "github"
          : item.sourceType === "article"
            ? "article"
            : "manual",
      signalCategory: item.solutionPattern,
      companyContext: item.solutionPattern,
      postContext: item.rawExcerpt,
      reasoningSummary: `${item.whyItMatters} Tradeoff: ${item.tradeoffOrConstraint}`,
      bestAngle: item.suggestedAngle,
      hasCommentContext: item.suggestedActionType === "comment_opportunity",
      hasReplyContext: item.suggestedActionType === "reply_opportunity"
    });
    setDecisionPlan(null);
    setRecommendedActionPayload(null);
    setSolutionScoutActionMessage("Sent solution item to Decision Planner.");
  }

  async function handleRunScoutMatch() {
    if (!audienceScoutResult || !solutionScoutResult) {
      return;
    }

    setMatchingScoutOpportunities(true);
    setScoutMatchActionMessage(null);
    setError(null);
    try {
      const result = await parseResponse<ScoutMatchResult>(
        await fetch(`${apiBaseUrl}/scout/match`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            audienceItems: audienceScoutResult.items,
            solutionItems: solutionScoutResult.items,
            feedbackSummary: feedbackSummary.totalRecords > 0 ? feedbackSummary : undefined,
            patternMemorySummary:
              patternMemorySummary.totalPatterns > 0 ? patternMemorySummary : undefined
          })
        })
      );
      setScoutMatchResult(result);
    } catch (matchError) {
      setError(matchError instanceof Error ? matchError.message : "Failed to match scout items");
    } finally {
      setMatchingScoutOpportunities(false);
    }
  }

  function handleSendMatchedOpportunityToSourceIntake(
    item: ScoutMatchResult["items"][number]
  ) {
    setSourceIntakeForm({
      ...initialSourceIntakeForm,
      sourceType: "manual_research",
      title: summarizeSignalTitle(item.matchedPain),
      summaryText: item.matchedPain,
      operatorNotes: `${item.whyThisMatchWorks} Solution pattern: ${item.matchedSolutionPattern}.`,
      companyContext: item.matchedSolutionPattern
    });
    setScoutMatchActionMessage("Sent matched opportunity to Source Intake.");
  }

  function handleSaveMatchedOpportunity(item: ScoutMatchResult["items"][number]) {
    setSavedMatchedOpportunities((current) => [
      createPersistedMatchedOpportunity(item),
      ...current
    ]);
    setSavedMatchesActionMessage("Saved matched opportunity for review.");
  }

  function handleSaveMatchedOpportunityForLater(
    item: ScoutMatchResult["items"][number]
  ) {
    setSavedDecisionItems((current) => [createSavedMatchedOpportunityItem(item), ...current]);
    setScoutMatchActionMessage("Saved matched opportunity for later.");
  }

  function handleSendMatchedOpportunityToDecisionPlanner(
    item: ScoutMatchResult["items"][number]
  ) {
    setDecisionForm({
      ...initialDecisionForm,
      signalText: item.matchedPain,
      sourceType: "manual",
      signalCategory: item.matchedSolutionPattern,
      companyContext: item.matchedSolutionPattern,
      reasoningSummary: item.whyThisMatchWorks,
      bestAngle: item.suggestedAngle,
      hasCommentContext: item.recommendedAction === "write_comment",
      hasReplyContext: item.recommendedAction === "write_reply"
    });
    setDecisionPlan(null);
    setRecommendedActionPayload(null);
    setScoutMatchActionMessage("Sent matched opportunity to Decision Planner.");
  }

  function updateSavedMatchStatus(
    id: string,
    status: PersistedMatchedOpportunity["status"],
    options?: { touchLastActionAt?: boolean }
  ) {
    setSavedMatchedOpportunities((current) =>
      current.map((item) =>
        item.id === id
          ? {
              ...item,
              status,
              lastActionAt: options?.touchLastActionAt ? new Date().toISOString() : item.lastActionAt
            }
          : item
      )
    );
  }

  function handleMarkSavedMatchReviewed(id: string) {
    updateSavedMatchStatus(id, "reviewed");
    setSavedMatchesActionMessage("Marked saved match as reviewed.");
  }

  function handleArchiveSavedMatch(id: string) {
    updateSavedMatchStatus(id, "archived", { touchLastActionAt: true });
    setSavedMatchesActionMessage("Archived saved match.");
  }

  function handleSendSavedMatchToSourceIntake(item: PersistedMatchedOpportunity) {
    handleSendMatchedOpportunityToSourceIntake(item.match);
    updateSavedMatchStatus(item.id, "converted", { touchLastActionAt: true });
    setSavedMatchesActionMessage("Sent saved match to Source Intake.");
  }

  function handleSaveSavedMatchForLater(item: PersistedMatchedOpportunity) {
    handleSaveMatchedOpportunityForLater(item.match);
    updateSavedMatchStatus(item.id, "converted", { touchLastActionAt: true });
    setSavedMatchesActionMessage("Saved match to queue for later.");
  }

  function handleSendSavedMatchToDecisionPlanner(item: PersistedMatchedOpportunity) {
    handleSendMatchedOpportunityToDecisionPlanner(item.match);
    updateSavedMatchStatus(item.id, "converted", { touchLastActionAt: true });
    setSavedMatchesActionMessage("Sent saved match to Decision Planner.");
  }

  async function handleGenerateSavedMatchContent(item: PersistedMatchedOpportunity) {
    if (!supportsMatchContentGeneration(item)) {
      return;
    }

    try {
      setGeneratingSavedMatchContentId(item.id);
      const updated = await requestJson<PersistedMatchedOpportunity>(
        apiBaseUrl,
        "/matches/content/generate",
        "POST",
        {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ savedMatch: item })
        }
      );

      setSavedMatchedOpportunities((current) =>
        current.map((entry) => (entry.id === updated.id ? updated : entry))
      );
      setSavedMatchesActionMessage(
        updated.match.aiContent
          ? "Generated compact AI content prep for the reviewed saved match."
          : "No compact AI content was generated for this reviewed saved match."
      );
    } catch (requestError) {
      const message = isApiRequestError(requestError)
        ? formatApiRequestError(requestError)
        : requestError instanceof Error
          ? requestError.message
          : "Failed to generate saved-match content prep";
      setSavedMatchesActionMessage(message);
    } finally {
      setGeneratingSavedMatchContentId(null);
    }
  }

  function handleSendIntakeToDecisionPlanner() {
    if (!normalizedSourceSignal) {
      return;
    }

    setDecisionForm({
      ...initialDecisionForm,
      ...normalizedSourceSignal.plannerReadyPayload
    });
    setDecisionPlan(null);
    setRecommendedActionPayload(null);
    setSourceIntakeActionMessage("Sent normalized source to Decision Planner.");
  }

  function handleSaveIntakeForLater() {
    if (!normalizedSourceSignal) {
      return;
    }

    setSavedDecisionItems((current) => [
      createSavedSourceIntakeItem(normalizedSourceSignal),
      ...current
    ]);
    setSourceIntakeActionMessage("Saved normalized source for later.");
  }

  function handleOpenCreatedSignal() {
    if (!createdSignalFromIntake) {
      return;
    }

    setHighlightedSignalId(createdSignalFromIntake.id);
    setSourceIntakeActionMessage("Opened created signal.");
  }

  async function handleGenerateIdeaFromCreatedSignal() {
    if (!createdSignalFromIntake) {
      return;
    }

    setHighlightedSignalId(createdSignalFromIntake.id);
    setSourceIntakeActionMessage("Generating idea from created signal...");
    setWorkingSignalId(createdSignalFromIntake.id);
    setError(null);
    try {
      const created = await parseResponse<Idea>(
        await fetch(`${apiBaseUrl}/ideas/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signalId: createdSignalFromIntake.id })
        })
      );
      setIdeas((current) => [...current, created]);
      setCreatedIdeaFromIntake(created);
      setSourceIntakeActionMessage("Generated idea from created signal.");
    } catch (ideaError) {
      setError(ideaError instanceof Error ? ideaError.message : "Failed to generate idea");
    } finally {
      setWorkingSignalId(null);
    }
  }

  async function handleGenerateDraftFromCreatedSignal() {
    if (!createdIdeaFromIntake) {
      return;
    }

    setSourceIntakeActionMessage("Generating draft from created signal...");
    setWorkingIdeaId(createdIdeaFromIntake.id);
    setError(null);
    try {
      const created = await parseResponse<ContentAsset>(
        await fetch(`${apiBaseUrl}/content/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ideaId: createdIdeaFromIntake.id })
        })
      );
      setContentAssets((current) => [...current, created]);
      setAnalyticsForm((current) => ({
        ...current,
        contentAssetId: current.contentAssetId || created.id
      }));
      setSourceIntakeActionMessage("Generated draft from created signal.");
    } catch (contentError) {
      setError(contentError instanceof Error ? contentError.message : "Failed to generate content");
    } finally {
      setWorkingIdeaId(null);
    }
  }

  function sendPayloadToCommentWriter(payload: RecommendedActionPayload, plan: DecisionPlan) {
    setCommentForm((current) => ({
      ...current,
      sourcePostText: payload.postContext || payload.signalText,
      positioningContext: payload.reasoningSummary ?? current.positioningContext,
      targetRole: payload.targetRole ?? current.targetRole,
      companyContext: payload.companyContext ?? current.companyContext,
      relevanceScore: payload.relevanceScore,
      bestAngle: plan.bestAngle,
      recommendedAction: "comment",
      reasoningSummary: payload.reasoningSummary,
      useRelevanceAdaptation: true
    }));
  }

  function sendPayloadToReplyWriter(payload: RecommendedActionPayload, plan: DecisionPlan) {
    setReplyForm((current) => ({
      ...current,
      ourPostText: payload.signalText,
      incomingCommentText: payload.postContext || current.incomingCommentText,
      context: payload.reasoningSummary ?? current.context,
      targetRole: payload.targetRole ?? current.targetRole,
      companyContext: payload.companyContext ?? current.companyContext,
      relevanceScore: payload.relevanceScore,
      bestAngle: plan.bestAngle,
      recommendedAction: "reply",
      reasoningSummary: payload.reasoningSummary,
      useRelevanceAdaptation: true
    }));
  }

  function sendPayloadToPostGenerator(payload: RecommendedActionPayload) {
    setSignalForm({
      title: summarizeSignalTitle(payload.signalText),
      sourceType: mapDecisionSourceToSignalSource(payload.sourceType),
      rawText: payload.signalText
    });
  }

  function buildQueuePayload(item: SavedDecisionItem): RecommendedActionPayload {
    return {
      plannerResult: {
        recommendedNextAction: item.recommendedAction,
        bestAngle: item.bestAngle,
        contentPriority: item.priority,
        engagementPriority: item.priority,
        publishability: "medium",
        confidence: 50,
        decisionMode: "deterministic",
        riskNotes: [],
        reasoningSummary: item.reasoningSummary,
        suggestedFlow: "research_later",
        shouldEscalateToPost: item.recommendedAction === "generate_post_candidate",
        shouldEscalateToEngagement:
          item.recommendedAction === "generate_comment" ||
          item.recommendedAction === "generate_reply",
        shouldStoreForLater: true
      },
      signalText: item.signalText,
      sourceType: item.sourceType,
      targetRole: item.targetRole,
      companyContext: item.companyContext,
      postContext: item.postContext,
      relevanceScore: item.relevanceScore,
      bestAngle: item.bestAngle,
      reasoningSummary: item.reasoningSummary
    };
  }

  function handleQueueAction(
    action: "post" | "comment" | "reply",
    item: SavedDecisionItem
  ) {
    const payload = buildQueuePayload(item);
    setSavedDecisionItems((current) =>
      current.map((currentItem) =>
        currentItem.id === item.id
          ? {
              ...currentItem,
              status: "sent",
              lastActionAt: new Date().toISOString()
            }
          : currentItem
      )
    );

    if (action === "post") {
      sendPayloadToPostGenerator(payload);
      setDecisionActionMessage(
        formatOperatorActionMessage({
          verb: "Sent",
          subject: "saved item",
          connector: "to",
          target: "Post Generator"
        })
      );
      return;
    }

    if (action === "comment") {
      sendPayloadToCommentWriter(payload, payload.plannerResult);
      setDecisionActionMessage(
        formatOperatorActionMessage({
          verb: "Sent",
          subject: "saved item",
          connector: "to",
          target: "Comment Writer"
        })
      );
      return;
    }

    sendPayloadToReplyWriter(payload, payload.plannerResult);
    setDecisionActionMessage(
      formatOperatorActionMessage({
        verb: "Sent",
        subject: "saved item",
        connector: "to",
        target: "Reply Writer"
      })
    );
  }

  function handleRemoveSavedDecisionItem(itemId: string) {
    setSavedDecisionItems((current) => current.filter((item) => item.id !== itemId));
  }

  function handleUpdateSavedDecisionStatus(
    itemId: string,
    status: SavedDecisionItem["status"]
  ) {
    setSavedDecisionItems((current) =>
      current.map((item) =>
        item.id === itemId
          ? {
              ...item,
              status,
              lastActionAt: new Date().toISOString()
            }
          : item
      )
    );
  }

  function handleClearSavedDecisionItems() {
    setSavedDecisionItems([]);
  }

  function handleRunRecommendedAction() {
    if (!decisionPlan || !recommendedActionPayload) {
      return;
    }

    const payload = recommendedActionPayload;
    const action = decisionPlan.recommendedNextAction;
    setDecisionActionMessage(null);

    if (action === "generate_comment") {
      sendPayloadToCommentWriter(payload, decisionPlan);
      setDecisionActionMessage(
        formatOperatorActionMessage({
          verb: "Sent",
          subject: "current recommendation",
          connector: "to",
          target: "Comment Writer"
        })
      );
      return;
    }

    if (action === "generate_reply") {
      sendPayloadToReplyWriter(payload, decisionPlan);
      setDecisionActionMessage(
        formatOperatorActionMessage({
          verb: "Sent",
          subject: "current recommendation",
          connector: "to",
          target: "Reply Writer"
        })
      );
      return;
    }

    if (action === "generate_post_candidate") {
      sendPayloadToPostGenerator(payload);
      setDecisionActionMessage(
        formatOperatorActionMessage({
          verb: "Sent",
          subject: "current recommendation",
          connector: "to",
          target: "Post Generator"
        })
      );
      return;
    }

    if (action === "save_for_later") {
      setSavedDecisionItems((current) => [
        createSavedDecisionItem(payload, decisionPlan),
        ...current
      ]);
      setDecisionActionMessage("Saved for later.");
      return;
    }

    setDecisionActionMessage(`No action launched. ${decisionPlan.reasoningSummary}`);
  }

  async function handleRecordAnalytics(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmittingAnalytics(true);
    setError(null);
    try {
      const result = await parseResponse<{
        snapshot: AnalyticsSnapshot;
        outcomeClassification: "strong" | "neutral" | "weak";
        memoryPatterns: Array<{ id: string; patternType: string; patternKey: string }>;
      }>(
        await fetch(`${apiBaseUrl}/analytics/learn`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(analyticsForm)
        })
      );
      setAnalyticsSnapshots((current) => [...current, result.snapshot]);
      setAnalyticsForm({
        ...initialAnalyticsForm,
        contentAssetId: analyticsForm.contentAssetId
      });
      setError(
        `✅ Analytics recorded and learning updated: ${result.outcomeClassification} outcome, ${result.memoryPatterns.length} patterns derived`
      );
    } catch (analyticsError) {
      setError(
        analyticsError instanceof Error ? analyticsError.message : "Failed to record analytics"
      );
    } finally {
      setSubmittingAnalytics(false);
    }
  }

  async function handleAnalyzeStrategy() {
    setAnalyzingStrategy(true);
    setError(null);
    try {
      const generated = await parseResponse<StrategyRecommendation[]>(
        await fetch(`${apiBaseUrl}/strategy/analyze`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            feedbackSummary:
              feedbackSummary.totalRecords > 0 ? feedbackSummary : undefined,
            patternMemorySummary:
              patternMemorySummary.totalPatterns > 0 ? patternMemorySummary : undefined,
            scoutOpportunityContext:
              (scoutMatchResult?.items.length ?? 0) > 0 || savedMatchedOpportunities.length > 0
                ? {
                    matchedOpportunities: scoutMatchResult?.items ?? [],
                    savedMatches:
                      savedMatchedOpportunities.length > 0
                        ? savedMatchedOpportunities
                        : undefined
                  }
                : undefined
          })
        })
      );
      setRecommendations(generated);
    } catch (strategyError) {
      setError(
        strategyError instanceof Error ? strategyError.message : "Failed to analyze strategy"
      );
    } finally {
      setAnalyzingStrategy(false);
    }
  }

  async function handleScoreTopics() {
    setScoringTopics(true);
    setError(null);
    try {
      const scored = await parseResponse<TopicScore[]>(
        await fetch(`${apiBaseUrl}/topics/score`, { method: "POST" })
      );
      setTopicScores(scored);
    } catch (scoreError) {
      setError(scoreError instanceof Error ? scoreError.message : "Failed to score topics");
    } finally {
      setScoringTopics(false);
    }
  }

  async function handleBuildQueue() {
    setBuildingQueue(true);
    setError(null);
    try {
      const built = await parseResponse<ContentQueueItem[]>(
        await fetch(`${apiBaseUrl}/queue/build`, { method: "POST" })
      );
      setContentQueue(built);
    } catch (queueError) {
      setError(queueError instanceof Error ? queueError.message : "Failed to build queue");
    } finally {
      setBuildingQueue(false);
    }
  }

  async function handlePlanGrowthRhythm() {
    setPlanningGrowthRhythm(true);
    setGrowthRhythmActionMessage(null);
    setError(null);
    try {
      const planned = await parseResponse<GrowthRhythmPlan>(
        await fetch(`${apiBaseUrl}/growth/rhythm`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            queueItems: contentQueue.map(mapQueueItemToGrowthCandidate),
            savedCandidates: savedDecisionItems.map(mapSavedDecisionItemToGrowthCandidate),
            feedbackSummary:
              feedbackSummary.totalRecords > 0 ? feedbackSummary : undefined,
            patternMemorySummary:
              patternMemorySummary.totalPatterns > 0 ? patternMemorySummary : undefined,
            recentSignals: signals.slice(0, 5).map((signal) => ({
              id: signal.id,
              title: signal.title,
              sourceType: signal.sourceType,
              status: signal.status
            })),
            recentStrategyRecommendations: recommendations.slice(0, 5).map((recommendation) => ({
              id: recommendation.id,
              title: recommendation.title,
              priority: recommendation.priority,
              description: recommendation.description
            }))
          })
        })
      );
      setGrowthRhythmPlan(planned);
    } catch (growthError) {
      setError(
        growthError instanceof Error ? growthError.message : "Failed to build action plan"
      );
    } finally {
      setPlanningGrowthRhythm(false);
    }
  }

  async function handleRecommendNextMove() {
    setRecommendingNextMove(true);
    setOrchestratedActionMessage(null);
    setError(null);
    try {
      const recommended = await parseResponse<OrchestratedRecommendation>(
        await fetch(`${apiBaseUrl}/orchestrator/recommend`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            currentSourceSignal: normalizedSourceSignal ?? undefined,
            currentDecisionPlan: decisionPlan ?? undefined,
            growthRhythmPlan: growthRhythmPlan ?? undefined,
            strategyRecommendations:
              recommendations.length > 0
                ? recommendations.map((recommendation) => ({
                    id: recommendation.id,
                    title: recommendation.title,
                    priority: recommendation.priority,
                    description: recommendation.description
                  }))
                : undefined,
            feedbackSummary:
              feedbackSummary.totalRecords > 0 ? feedbackSummary : undefined,
            patternMemorySummary:
              patternMemorySummary.totalPatterns > 0 ? patternMemorySummary : undefined,
            scoutOpportunityContext:
              (scoutMatchResult?.items.length ?? 0) > 0 || savedMatchedOpportunities.length > 0
                ? {
                    matchedOpportunities: scoutMatchResult?.items ?? [],
                    savedMatches:
                      savedMatchedOpportunities.length > 0
                        ? savedMatchedOpportunities
                        : undefined
                  }
                : undefined
          })
        })
      );
      setOrchestratedRecommendation(recommended);
    } catch (recommendationError) {
      setError(
        recommendationError instanceof Error
          ? recommendationError.message
          : "Failed to recommend the next move"
      );
    } finally {
      setRecommendingNextMove(false);
    }
  }

  function handleOpenSavedDecisionItem(itemId: string, source: "queue" | "growth_rhythm" = "queue") {
    setHighlightedSavedDecisionItemId(itemId);

    if (source === "growth_rhythm") {
      setGrowthRhythmActionMessage(
        formatOperatorActionMessage({
          verb: "Opened",
          subject: "saved item",
          connector: "from",
          target: "LinkedIn Action Plan"
        })
      );
      return;
    }

    setDecisionActionMessage(formatOperatorActionMessage({ verb: "Opened", subject: "saved item" }));
  }

  function handleOpenSignal(signalId: string, source: "queue" | "orchestrator" = "queue") {
    setHighlightedSignalId(signalId);

    if (source === "orchestrator") {
      setOrchestratedActionMessage(
        formatOperatorActionMessage({ verb: "Opened", subject: "supporting signal" })
      );
      return;
    }
  }

  function handleGrowthRhythmPostCandidate(candidate: GrowthRhythmCandidate) {
    const savedItem = savedDecisionItemsById.get(candidate.id);
    if (!savedItem) {
      return;
    }

    handleQueueAction("post", savedItem);
    setHighlightedSavedDecisionItemId(savedItem.id);
    setGrowthRhythmActionMessage(
      formatOperatorActionMessage({
        verb: "Sent",
        subject: "action-plan candidate",
        connector: "to",
        target: "Post Generator"
      })
    );
  }

  function handleGrowthRhythmCommentCandidate(candidate: GrowthRhythmCandidate) {
    const savedItem = savedDecisionItemsById.get(candidate.id);
    if (!savedItem) {
      return;
    }

    handleQueueAction("comment", savedItem);
    setHighlightedSavedDecisionItemId(savedItem.id);
    setGrowthRhythmActionMessage(
      formatOperatorActionMessage({
        verb: "Sent",
        subject: "action-plan candidate",
        connector: "to",
        target: "Comment Writer"
      })
    );
  }

  function handleGrowthRhythmReplyCandidate(candidate: GrowthRhythmCandidate) {
    const savedItem = savedDecisionItemsById.get(candidate.id);
    if (!savedItem || savedItem.recommendedAction !== "generate_reply" || !savedItem.postContext) {
      return;
    }

    handleQueueAction("reply", savedItem);
    setHighlightedSavedDecisionItemId(savedItem.id);
    setGrowthRhythmActionMessage(
      formatOperatorActionMessage({
        verb: "Sent",
        subject: "action-plan candidate",
        connector: "to",
        target: "Reply Writer"
      })
    );
  }

  function getOrchestratedGrowthRhythmPostCandidate() {
    return (
      growthRhythmPlan?.topPostCandidates.find((candidate) => savedDecisionItemsById.has(candidate.id)) ??
      null
    );
  }

  function getOrchestratedGrowthRhythmCommentCandidate() {
    return (
      growthRhythmPlan?.topCommentCandidates.find(
        (candidate) =>
          candidate.suggestedAction === "generate_comment" && savedDecisionItemsById.has(candidate.id)
      ) ?? null
    );
  }

  function getOrchestratedGrowthRhythmReplyCandidate() {
    return (
      growthRhythmPlan?.topCommentCandidates.find((candidate) => {
        const savedItem = savedDecisionItemsById.get(candidate.id);
        return (
          candidate.suggestedAction === "generate_reply" &&
          savedItem?.recommendedAction === "generate_reply" &&
          Boolean(savedItem.postContext)
        );
      }) ?? null
    );
  }

  function getOrchestratedSupportingMatchTerms() {
    if (!orchestratedRecommendation) {
      return [];
    }

    return [orchestratedRecommendation.primaryTarget, ...orchestratedRecommendation.supportingSignals]
      .map(normalizeOrchestratedMatchText)
      .filter((term) => term.length >= 6);
  }

  function matchesOrchestratedSupportingContext(values: Array<string | undefined>) {
    const haystack = normalizeOrchestratedMatchText(values.filter(Boolean).join(" "));
    if (!haystack) {
      return false;
    }

    return getOrchestratedSupportingMatchTerms().some(
      (term) => haystack.includes(term) || term.includes(haystack)
    );
  }

  function getOrchestratedSupportingSavedItem() {
    if (!orchestratedRecommendation) {
      return null;
    }

    if (growthRhythmPlan?.keepForLater.length) {
      const rhythmMatch = growthRhythmPlan.keepForLater.find((candidate) => {
        const savedItem = savedDecisionItemsById.get(candidate.id);
        return (
          Boolean(savedItem) &&
          matchesOrchestratedSupportingContext([
            candidate.title,
            candidate.reasoningSummary,
            savedItem?.signalText,
            savedItem?.reasoningSummary
          ])
        );
      });

      if (rhythmMatch) {
        return savedDecisionItemsById.get(rhythmMatch.id) ?? null;
      }
    }

    return (
      savedDecisionItems.find((item) =>
        matchesOrchestratedSupportingContext([item.signalText, item.reasoningSummary])
      ) ?? null
    );
  }

  function getOrchestratedSupportingSignal() {
    return (
      signals.find((signal) =>
        matchesOrchestratedSupportingContext([signal.title, signal.rawText])
      ) ?? null
    );
  }

  function getOrchestratedSupportingContextTarget() {
    if (!orchestratedRecommendation) {
      return null;
    }

    const savedItem = getOrchestratedSupportingSavedItem();
    const signal = getOrchestratedSupportingSignal();

    if (orchestratedRecommendation.recommendedAction === "save_for_later") {
      if (savedItem) {
        return { kind: "saved_item" as const, id: savedItem.id };
      }

      if (signal) {
        return { kind: "signal" as const, id: signal.id };
      }
    }

    if (orchestratedRecommendation.recommendedAction === "revisit_signal") {
      if (signal) {
        return { kind: "signal" as const, id: signal.id };
      }

      if (savedItem) {
        return { kind: "saved_item" as const, id: savedItem.id };
      }
    }

    return null;
  }

  function handleOrchestratedQuickAction() {
    if (!orchestratedRecommendation) {
      return;
    }

    if (
      orchestratedRecommendation.recommendedAction === "write_post" &&
      decisionPlan?.recommendedNextAction === "generate_post_candidate" &&
      recommendedActionPayload
    ) {
      sendPayloadToPostGenerator(recommendedActionPayload);
      setOrchestratedActionMessage(
        formatOperatorActionMessage({
          verb: "Sent",
          subject: "orchestrated recommendation",
          connector: "to",
          target: "Post Generator"
        })
      );
      return;
    }

    if (
      orchestratedRecommendation.recommendedAction === "write_comment" &&
      decisionPlan?.recommendedNextAction === "generate_comment" &&
      recommendedActionPayload
    ) {
      sendPayloadToCommentWriter(recommendedActionPayload, decisionPlan);
      setOrchestratedActionMessage(
        formatOperatorActionMessage({
          verb: "Sent",
          subject: "orchestrated recommendation",
          connector: "to",
          target: "Comment Writer"
        })
      );
      return;
    }

    if (
      orchestratedRecommendation.recommendedAction === "write_reply" &&
      decisionPlan?.recommendedNextAction === "generate_reply" &&
      recommendedActionPayload
    ) {
      sendPayloadToReplyWriter(recommendedActionPayload, decisionPlan);
      setOrchestratedActionMessage(
        formatOperatorActionMessage({
          verb: "Sent",
          subject: "orchestrated recommendation",
          connector: "to",
          target: "Reply Writer"
        })
      );
      return;
    }

    if (orchestratedRecommendation.recommendedAction === "write_post") {
      const candidate = getOrchestratedGrowthRhythmPostCandidate();
      if (!candidate) {
        return;
      }

      handleGrowthRhythmPostCandidate(candidate);
      setOrchestratedActionMessage(
        formatOperatorActionMessage({
          verb: "Sent",
          subject: "orchestrated recommendation",
          connector: "to",
          target: "Post Generator"
        })
      );
      return;
    }

    if (orchestratedRecommendation.recommendedAction === "write_comment") {
      const candidate = getOrchestratedGrowthRhythmCommentCandidate();
      if (!candidate) {
        return;
      }

      handleGrowthRhythmCommentCandidate(candidate);
      setOrchestratedActionMessage(
        formatOperatorActionMessage({
          verb: "Sent",
          subject: "orchestrated recommendation",
          connector: "to",
          target: "Comment Writer"
        })
      );
      return;
    }

    if (orchestratedRecommendation.recommendedAction === "write_reply") {
      const candidate = getOrchestratedGrowthRhythmReplyCandidate();
      if (!candidate) {
        return;
      }

      handleGrowthRhythmReplyCandidate(candidate);
      setOrchestratedActionMessage(
        formatOperatorActionMessage({
          verb: "Sent",
          subject: "orchestrated recommendation",
          connector: "to",
          target: "Reply Writer"
        })
      );
    }
  }

  function getOrchestratedQuickActionLabel() {
    if (!orchestratedRecommendation) {
      return null;
    }

    if (
      orchestratedRecommendation.recommendedAction === "write_post" &&
      ((decisionPlan?.recommendedNextAction === "generate_post_candidate" &&
        Boolean(recommendedActionPayload)) ||
        Boolean(getOrchestratedGrowthRhythmPostCandidate()))
    ) {
      return "Send to Post Generator";
    }

    if (
      orchestratedRecommendation.recommendedAction === "write_comment" &&
      ((decisionPlan?.recommendedNextAction === "generate_comment" &&
        Boolean(recommendedActionPayload)) ||
        Boolean(getOrchestratedGrowthRhythmCommentCandidate()))
    ) {
      return "Send to Comment Writer";
    }

    if (
      orchestratedRecommendation.recommendedAction === "write_reply" &&
      ((decisionPlan?.recommendedNextAction === "generate_reply" &&
        Boolean(recommendedActionPayload)) ||
        Boolean(getOrchestratedGrowthRhythmReplyCandidate()))
    ) {
      return "Send to Reply Writer";
    }

    return null;
  }

  function handleOrchestratedSupportingContextAction() {
    const target = getOrchestratedSupportingContextTarget();
    if (!target) {
      return;
    }

    if (target.kind === "saved_item") {
      setOrchestratedActionMessage(
        formatOperatorActionMessage({ verb: "Opened", subject: "supporting saved item" })
      );
      handleOpenSavedDecisionItem(target.id);
      return;
    }

    handleOpenSignal(target.id, "orchestrator");
  }

  function getManualFeedbackDraft(
    artifactType: ManualOutcomeFeedback["artifactType"],
    artifactId: string
  ): ManualFeedbackDraft {
    const key = feedbackStorageKey(artifactType, artifactId);
    return (
      manualFeedbackDrafts[key] ??
      draftFromFeedback(manualOutcomeFeedbackByKey.get(key))
    );
  }

  function updateManualFeedbackDraft(
    artifactType: ManualOutcomeFeedback["artifactType"],
    artifactId: string,
    update: Partial<ManualFeedbackDraft>
  ) {
    const key = feedbackStorageKey(artifactType, artifactId);
    setManualFeedbackDrafts((current) => ({
      ...current,
      [key]: {
        ...getManualFeedbackDraft(artifactType, artifactId),
        ...update
      }
    }));
  }

  function handleSaveManualFeedback(
    artifactType: ManualOutcomeFeedback["artifactType"],
    artifactId: string
  ) {
    const key = feedbackStorageKey(artifactType, artifactId);
    const draft = getManualFeedbackDraft(artifactType, artifactId);
    const record: ManualOutcomeFeedback = {
      id: key,
      artifactType,
      artifactId,
      status: draft.status,
      responseLevel: draft.responseLevel,
      gotReplies: draft.gotReplies,
      gotProfileViews: draft.gotProfileViews,
      gotLeadSignal: draft.gotLeadSignal,
      repeatTopic: draft.repeatTopic,
      notes: draft.notes.trim() || undefined,
      createdAt: new Date().toISOString()
    };

    setManualOutcomeFeedback((current) => [
      record,
      ...current.filter(
        (item) => !(item.artifactType === artifactType && item.artifactId === artifactId)
      )
    ]);
    setManualFeedbackDrafts((current) => ({
      ...current,
      [key]: draft
    }));
    setManualFeedbackMessage(`Saved feedback for ${artifactType.replace("_", " ")}.`);
  }

  function renderManualFeedbackControls(
    artifactType: ManualOutcomeFeedback["artifactType"],
    artifactId: string
  ) {
    const draft = getManualFeedbackDraft(artifactType, artifactId);

    return (
      <div className="mt-4 rounded-lg border border-dashed border-border bg-slate-50 p-3">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
          Outcome feedback
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-xs font-medium" htmlFor={`feedback-status-${artifactId}`}>
              Status
            </label>
            <select
              id={`feedback-status-${artifactId}`}
              aria-label={`Feedback status ${artifactId}`}
              className="mt-1 w-full rounded-lg border border-border px-2 py-2 text-sm"
              value={draft.status}
              onChange={(event) =>
                updateManualFeedbackDraft(artifactType, artifactId, {
                  status: event.target.value as ManualFeedbackStatus
                })
              }
            >
              <option value="used">used</option>
              <option value="posted">posted</option>
              <option value="not_posted">not posted</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-medium" htmlFor={`feedback-response-${artifactId}`}>
              Response
            </label>
            <select
              id={`feedback-response-${artifactId}`}
              aria-label={`Feedback response ${artifactId}`}
              className="mt-1 w-full rounded-lg border border-border px-2 py-2 text-sm"
              value={draft.responseLevel}
              onChange={(event) =>
                updateManualFeedbackDraft(artifactType, artifactId, {
                  responseLevel: event.target.value as ManualFeedbackResponseLevel
                })
              }
            >
              <option value="unknown">unknown</option>
              <option value="strong">strong</option>
              <option value="medium">medium</option>
              <option value="weak">weak</option>
            </select>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-600">
          <label className="flex items-center gap-2">
            <input
              aria-label={`Feedback got replies ${artifactId}`}
              checked={draft.gotReplies}
              onChange={(event) =>
                updateManualFeedbackDraft(artifactType, artifactId, {
                  gotReplies: event.target.checked
                })
              }
              type="checkbox"
            />
            Got replies
          </label>
          <label className="flex items-center gap-2">
            <input
              aria-label={`Feedback got profile views ${artifactId}`}
              checked={draft.gotProfileViews}
              onChange={(event) =>
                updateManualFeedbackDraft(artifactType, artifactId, {
                  gotProfileViews: event.target.checked
                })
              }
              type="checkbox"
            />
            Got profile views
          </label>
          <label className="flex items-center gap-2">
            <input
              aria-label={`Feedback got lead signal ${artifactId}`}
              checked={draft.gotLeadSignal}
              onChange={(event) =>
                updateManualFeedbackDraft(artifactType, artifactId, {
                  gotLeadSignal: event.target.checked
                })
              }
              type="checkbox"
            />
            Got lead signal
          </label>
          <label className="flex items-center gap-2">
            <input
              aria-label={`Feedback repeat topic ${artifactId}`}
              checked={draft.repeatTopic}
              onChange={(event) =>
                updateManualFeedbackDraft(artifactType, artifactId, {
                  repeatTopic: event.target.checked
                })
              }
              type="checkbox"
            />
            Repeat this topic
          </label>
        </div>
        <div className="mt-3">
          <label className="text-xs font-medium" htmlFor={`feedback-notes-${artifactId}`}>
            Notes
          </label>
          <input
            id={`feedback-notes-${artifactId}`}
            aria-label={`Feedback notes ${artifactId}`}
            className="mt-1 w-full rounded-lg border border-border px-2 py-2 text-sm"
            value={draft.notes}
            onChange={(event) =>
              updateManualFeedbackDraft(artifactType, artifactId, {
                notes: event.target.value
              })
            }
          />
        </div>
        <button
          aria-label={`Save feedback ${artifactId}`}
          className="mt-3 rounded-lg border border-border px-3 py-2 text-sm font-medium"
          onClick={() => handleSaveManualFeedback(artifactType, artifactId)}
          type="button"
        >
          Save feedback
        </button>
      </div>
    );
  }

  function renderFeedbackThemeTags() {
    if (feedbackThemeTags.length === 0) {
      return null;
    }

    return (
      <div className="mt-3 flex flex-wrap gap-2">
        {feedbackThemeTags.map((tag) => (
          <span
            key={`${tag.kind}-${tag.label}`}
            className={`rounded-full px-2 py-1 text-xs font-medium ${
              tag.kind === "repeat"
                ? "bg-emerald-50 text-emerald-700"
                : "bg-amber-50 text-amber-700"
            }`}
          >
            {tag.kind}: {tag.label}
          </span>
        ))}
      </div>
    );
  }

  function renderPatternMemoryBlock() {
    if (patternMemorySummary.totalPatterns === 0) {
      return null;
    }

    return (
      <div className="mt-4 rounded-lg border border-slate-200 bg-white px-3 py-3">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
          Pattern memory
        </p>
        <div className="mt-2 space-y-2 text-sm text-slate-700">
          <p>{patternMemorySummary.notes}</p>
          {patternMemorySummary.recurringThemes.length > 0 ? (
            <p>
              <span className="font-medium">Repeat patterns:</span>{" "}
              {patternMemorySummary.recurringThemes.join(", ")}
            </p>
          ) : null}
          {patternMemorySummary.weakThemes.length > 0 ? (
            <p>
              <span className="font-medium">Avoid patterns:</span>{" "}
              {patternMemorySummary.weakThemes.join(", ")}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  function getStrategyMemoryBadge(
    recommendation: StrategyRecommendation
  ): { label: string; kind: "repeat" | "avoid" } | null {
    if (patternMemorySummary.totalPatterns === 0) {
      return null;
    }

    const text = `${recommendation.title} ${recommendation.description}`.toLowerCase();
    if (
      recommendation.title === "Reinforce recurring long-term themes" ||
      patternMemorySummary.recurringThemes.some((theme) => text.includes(theme.toLowerCase()))
    ) {
      return { label: "Long-term repeat", kind: "repeat" };
    }

    if (
      recommendation.title === "Keep recurring weak themes deprioritized" ||
      patternMemorySummary.weakThemes.some((theme) => text.includes(theme.toLowerCase()))
    ) {
      return { label: "Recurring weak pattern", kind: "avoid" };
    }

    return null;
  }

  function formatOperatorActionMessage(input: {
    verb: "Sent" | "Opened";
    subject: string;
    connector?: "to" | "from";
    target?: string;
  }) {
    return `${input.verb} ${input.subject}${
      input.connector && input.target ? ` ${input.connector} ${input.target}` : ""
    }.`;
  }

  function renderCompactBadge(
    label: string,
    kind: "repeat" | "avoid" | "current" | "neutral" | "support" = "neutral"
  ) {
    const toneClass =
      kind === "avoid"
        ? "bg-amber-50 text-amber-700"
        : kind === "current"
          ? "bg-slate-900 text-white"
          : kind === "support"
            ? "bg-sky-50 text-sky-700"
          : kind === "repeat"
            ? "bg-emerald-50 text-emerald-700"
            : "bg-slate-100 text-slate-600";

    return (
      <span className={`rounded-full px-2 py-1 text-[11px] font-medium ${toneClass}`}>
        {label}
      </span>
    );
  }

  function formatScoutStrengthLabel(
    strength: "strong" | "medium" | "weak" | undefined
  ): string | null {
    return formatScoutStrengthDisplayLabel(strength);
  }

function renderScoutScoreNote(notes: string[] | undefined) {
    const firstNote = getFirstScoutScoreNoteValue(notes);

    if (!firstNote) {
      return null;
    }

    return (
      <p className="mt-2 text-xs text-slate-500">Why this scored well: {firstNote}</p>
    );
  }

  function renderDownstreamScoutScoreNote(note: string | null | undefined) {
    if (!note) {
      return null;
    }

    return <p className="mt-2 text-xs text-slate-500">Why this scored well: {note}</p>;
  }

  function renderDownstreamMixedSupportDrillIn(supportGroupLabel: string | null | undefined) {
    if (supportGroupLabel !== "Mixed support") {
      return null;
    }

    return (
      <p className="mt-2 text-xs text-slate-500">Backed by current and reviewed scout evidence</p>
    );
  }

  const orchestratedScoutSupportDetails = useMemo(() => {
    if (!orchestratedRecommendation?.scoutSupport?.length) {
      return { strengthLabel: null, scoreNote: null, originLabel: null, supportGroupLabel: null };
    }

    const supportCorpus = orchestratedRecommendation.scoutSupport
      .map((item) => normalizeOrchestratedMatchText(item))
      .join(" ");

    const directMatches = (scoutMatchResult?.items ?? [])
      .filter((match) => {
        const pain = normalizeOrchestratedMatchText(match.matchedPain);
        const solution = normalizeOrchestratedMatchText(match.matchedSolutionPattern);
        return (
          (pain.length >= 6 && supportCorpus.includes(pain)) ||
          (solution.length >= 6 && supportCorpus.includes(solution))
        );
      })
      .map((match) => ({
        origin: "direct_match" as const,
        strengthLabel: getMatchStrengthLabel(match),
        scoreNote: getFirstScoutScoreNoteValue(match.scoreNotes)
      }));

    const savedMatches = savedMatchedOpportunities
      .filter((item) => {
        const pain = normalizeOrchestratedMatchText(item.match.matchedPain);
        const solution = normalizeOrchestratedMatchText(item.match.matchedSolutionPattern);
        return (
          (pain.length >= 6 && supportCorpus.includes(pain)) ||
          (solution.length >= 6 && supportCorpus.includes(solution))
        );
      })
      .map((item) => ({
        origin: "reviewed_saved_match" as const,
        strengthLabel: getMatchStrengthLabel(item.match),
        scoreNote: getFirstScoutScoreNoteValue(item.match.scoreNotes)
      }));

    const meaningfulDirectMatches = directMatches.filter((item) =>
      shouldRenderDownstreamScoutSupportGrouping(item.strengthLabel)
    );
    const meaningfulSavedMatches = savedMatches.filter((item) =>
      shouldRenderDownstreamScoutSupportGrouping(item.strengthLabel)
    );

    const strongestSupport = [...directMatches, ...savedMatches]
      .filter(
        (item): item is {
          origin: "direct_match" | "reviewed_saved_match";
          strengthLabel: string;
          scoreNote: string | null;
        } => Boolean(item.strengthLabel)
      )
      .sort((left, right) => {
        const strengthDelta =
          scoutStrengthSortValue(right.strengthLabel) - scoutStrengthSortValue(left.strengthLabel);
        if (strengthDelta !== 0) {
          return strengthDelta;
        }

        return Number(Boolean(right.scoreNote)) - Number(Boolean(left.scoreNote));
      })[0];

    if (!strongestSupport) {
      return { strengthLabel: null, scoreNote: null, originLabel: null, supportGroupLabel: null };
    }

    const strongestSupportStrength = scoutStrengthSortValue(strongestSupport.strengthLabel);
    const strongestSupportHasNote = Number(Boolean(strongestSupport.scoreNote));
    const ambiguousOrigin = [...directMatches, ...savedMatches]
      .filter(
        (item): item is {
          origin: "direct_match" | "reviewed_saved_match";
          strengthLabel: string;
          scoreNote: string | null;
        } => Boolean(item.strengthLabel)
      )
      .some(
        (item) =>
          item.origin !== strongestSupport.origin &&
          scoutStrengthSortValue(item.strengthLabel) === strongestSupportStrength &&
          Number(Boolean(item.scoreNote)) === strongestSupportHasNote
      );

    const supportGroupLabel =
      meaningfulDirectMatches.length > 0 && meaningfulSavedMatches.length > 0
        ? formatScoutSupportGroupLabel("mixed")
        : meaningfulDirectMatches.length > 0
          ? formatScoutSupportGroupLabel("direct_only")
          : meaningfulSavedMatches.length > 0
            ? formatScoutSupportGroupLabel("reviewed_only")
            : null;

    return {
      strengthLabel: strongestSupport.strengthLabel,
      originLabel: ambiguousOrigin ? null : formatScoutSupportOriginLabel(strongestSupport.origin),
      supportGroupLabel,
      scoreNote: shouldRenderDownstreamScoutScoreNote(strongestSupport.strengthLabel)
        ? strongestSupport.scoreNote
        : null
    };
  }, [orchestratedRecommendation, savedMatchedOpportunities, scoutMatchResult]);

  if (authBooting) {
    return (
      <div className="min-h-screen bg-background px-6 py-12 text-foreground">
        <div className="mx-auto max-w-xl rounded-xl border border-border bg-white p-6">
          <p className="text-sm font-medium text-slate-600">Checking operator session...</p>
        </div>
      </div>
    );
  }

  if (!operatorSession) {
    return (
      <div className="min-h-screen bg-background px-6 py-12 text-foreground">
        <div className="mx-auto max-w-xl rounded-xl border border-border bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
            Operator access
          </p>
          <h1 className="mt-3 text-2xl font-semibold">Operator sign in</h1>
          <p className="mt-2 text-sm text-slate-600">
            Authenticate before using launch, autonomy, content workspace, and draft controls.
          </p>
          <form className="mt-6 space-y-4" onSubmit={handleOperatorLogin}>
            <div>
              <label className="text-sm font-medium" htmlFor="operator-username">
                Operator username
              </label>
              <input
                id="operator-username"
                className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                onChange={(event) => setOperatorUsername(event.target.value)}
                value={operatorUsername}
              />
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor="operator-password">
                Operator password
              </label>
              <input
                id="operator-password"
                className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                onChange={(event) => setOperatorPassword(event.target.value)}
                type="password"
                value={operatorPassword}
              />
            </div>
            {authError ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {authError}
              </div>
            ) : null}
            <button
              className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              disabled={loggingInOperator}
              type="submit"
            >
              {loggingInOperator ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Sign in
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Render helper for Lab surface
  // Contains Scout tools, experiments, and manual analysis workflows

  // Render helper for Lab surface
  // Contains Scout tools, experiments, and manual analysis workflows
  function renderLabSurface() {
    return (
      <>
              <section className="mb-6 space-y-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-bold">⚗️ Lab & Advanced Tools</h2>
                  <p className="text-sm text-slate-600">Scout tools, experiments, manual analysis workflows</p>
                </div>
                <div className="rounded-lg border border-purple-200 bg-purple-50 px-4 py-3">
                  <p className="text-sm text-purple-700">
                    Lab tools are for internal engineering, debugging, and manual workflows. They are NOT part of the autonomous operator workflow.
                  </p>
                </div>

              <div className="mt-8 mb-4 rounded-lg border border-purple-200 bg-purple-50 px-4 py-3">
                <p className="text-sm font-medium text-purple-900">⚗️ Scout Tools (Review-First, Manual)</p>
                <p className="mt-1 text-sm text-purple-700">
                  Live Ingestion, Scout Feed, Audience Scout, and Solution Scout are manual review-first tools for internal analysis. They do NOT run autonomously. Use these only for debugging or manual opportunity discovery workflows.
                </p>
              </div>

              <Card className="mt-6">
                <div className="flex items-center gap-2">
                  <Globe2 className="h-5 w-5 text-slate-600" />
                  <div>
                    <p className="text-sm text-muted">Live Ingestion Buffer</p>
                    <h3 className="text-lg font-semibold">
                      Store raw public inputs before they enter Scout Feed
                    </h3>
                  </div>
                </div>
                <form
                  className="mt-4 grid gap-4 xl:grid-cols-2"
                  onSubmit={handleAddLiveIngestionItems}
                >
                  <div>
                    <label className="text-sm font-medium" htmlFor="live-ingestion-source-kind">
                      Buffer source kind
                    </label>
                    <select
                      id="live-ingestion-source-kind"
                      className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      value={liveIngestionBufferForm.sourceKind}
                      onChange={(event) =>
                        setLiveIngestionBufferForm((current) => ({
                          ...current,
                          sourceKind: event.target.value as LiveIngestionItem["sourceKind"]
                        }))
                      }
                    >
                      <option value="public_excerpt">public_excerpt</option>
                      <option value="watched_url_snapshot">watched_url_snapshot</option>
                      <option value="github_watch_snapshot">github_watch_snapshot</option>
                      <option value="article_watch_snapshot">article_watch_snapshot</option>
                      <option value="manual_feed_snapshot">manual_feed_snapshot</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-medium" htmlFor="live-ingestion-source-label">
                      Buffer source label
                    </label>
                    <input
                      id="live-ingestion-source-label"
                      className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      placeholder="Optional source label"
                      value={liveIngestionBufferForm.sourceLabel}
                      onChange={(event) =>
                        setLiveIngestionBufferForm((current) => ({
                          ...current,
                          sourceLabel: event.target.value
                        }))
                      }
                    />
                  </div>
                  <div className="xl:col-span-2">
                    <label className="text-sm font-medium" htmlFor="live-ingestion-source-url">
                      Buffer source URL
                    </label>
                    <input
                      id="live-ingestion-source-url"
                      className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      placeholder="Optional source URL"
                      value={liveIngestionBufferForm.sourceUrl}
                      onChange={(event) =>
                        setLiveIngestionBufferForm((current) => ({
                          ...current,
                          sourceUrl: event.target.value
                        }))
                      }
                    />
                  </div>
                  <div className="xl:col-span-2">
                    <label className="text-sm font-medium" htmlFor="live-ingestion-batch-input">
                      Raw live inputs
                    </label>
                    <textarea
                      id="live-ingestion-batch-input"
                      className="mt-1 min-h-32 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      placeholder="Paste raw public inputs separated by a blank line."
                      value={liveIngestionBufferForm.batchInput}
                      onChange={(event) =>
                        setLiveIngestionBufferForm((current) => ({
                          ...current,
                          batchInput: event.target.value
                        }))
                      }
                    />
                  </div>
                  <div className="xl:col-span-2">
                    <label className="text-sm font-medium" htmlFor="live-ingestion-notes">
                      Buffer notes
                    </label>
                    <textarea
                      id="live-ingestion-notes"
                      className="mt-1 min-h-20 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      placeholder="Optional operator notes for this raw batch."
                      value={liveIngestionBufferForm.notes}
                      onChange={(event) =>
                        setLiveIngestionBufferForm((current) => ({
                          ...current,
                          notes: event.target.value
                        }))
                      }
                    />
                  </div>
                  <button
                    className="w-fit rounded-lg border border-border px-3 py-2 text-sm font-medium xl:col-span-2"
                    type="submit"
                  >
                    Add to Live Buffer
                  </button>
                </form>
                {liveIngestionActionMessage ? (
                  <p className="mt-4 text-sm text-slate-600">{liveIngestionActionMessage}</p>
                ) : null}
                {sortedLiveIngestionBuffer.length > 0 ? (
                  <div className="mt-4 rounded-lg border border-border bg-white p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      {renderCompactBadge(`${sortedLiveIngestionBuffer.length} buffered`, "neutral")}
                      {selectedLiveIngestionItemIds.length > 0
                        ? renderCompactBadge(
                            `${selectedLiveIngestionItemIds.length} selected`,
                            "neutral"
                          )
                        : null}
                      {filteredLiveIngestionBuffer.length > 0
                        ? renderCompactBadge(
                            `${selectedVisibleLiveIngestionItemCount}/${filteredLiveIngestionBuffer.length} visible selected`,
                            "neutral"
                          )
                        : null}
                      <button
                        className="rounded-lg border border-border px-2 py-1 text-xs font-medium"
                        disabled={filteredLiveIngestionBuffer.length === 0}
                        onClick={handleSelectVisibleLiveIngestionItems}
                        type="button"
                      >
                        Select visible
                      </button>
                      <button
                        className="rounded-lg border border-border px-2 py-1 text-xs font-medium"
                        disabled={eligibleVisibleLiveIngestionItemIds.length === 0}
                        onClick={handleSelectEligibleVisibleLiveIngestionItems}
                        type="button"
                      >
                        Select eligible visible
                      </button>
                      <button
                        className="rounded-lg border border-border px-2 py-1 text-xs font-medium"
                        disabled={selectedVisibleLiveIngestionItemCount === 0}
                        onClick={handleClearVisibleLiveIngestionSelection}
                        type="button"
                      >
                        Clear visible selection
                      </button>
                      {activeLiveIngestionRefreshRun ? (
                        <>
                          <button
                            className="rounded-lg border border-border px-2 py-1 text-xs font-medium"
                            disabled={activeRunLiveIngestionItemIds.length === 0}
                            onClick={handleSelectActiveRunLiveIngestionItems}
                            type="button"
                          >
                            Select run
                          </button>
                          <button
                            className="rounded-lg border border-border px-2 py-1 text-xs font-medium"
                            disabled={activeEligibleRunLiveIngestionItemIds.length === 0}
                            onClick={handleSelectEligibleActiveRunLiveIngestionItems}
                            type="button"
                          >
                            Select eligible in run
                          </button>
                          <button
                            className="rounded-lg border border-border px-2 py-1 text-xs font-medium"
                            disabled={activeRunLiveIngestionItemIds.every(
                              (id) => !selectedLiveIngestionItemIds.includes(id)
                            )}
                            onClick={handleClearActiveRunLiveIngestionSelection}
                            type="button"
                          >
                            Clear run selection
                          </button>
                          <button
                            className="rounded-lg border border-border px-2 py-1 text-xs font-medium"
                            disabled={activeVisibleRunLiveIngestionItemIds.length === 0}
                            onClick={handleSelectVisibleActiveRunLiveIngestionItems}
                            type="button"
                          >
                            Select visible in run
                          </button>
                          <button
                            className="rounded-lg border border-border px-2 py-1 text-xs font-medium"
                            disabled={activeEligibleVisibleRunLiveIngestionItemIds.length === 0}
                            onClick={handleSelectEligibleVisibleActiveRunLiveIngestionItems}
                            type="button"
                          >
                            Select eligible visible in run
                          </button>
                          <button
                            className="rounded-lg border border-border px-2 py-1 text-xs font-medium"
                            disabled={activeVisibleRunLiveIngestionItemIds.every(
                              (id) => !selectedLiveIngestionItemIds.includes(id)
                            )}
                            onClick={handleClearVisibleActiveRunLiveIngestionSelection}
                            type="button"
                          >
                            Clear visible run selection
                          </button>
                        </>
                      ) : null}
                      <button
                        className="rounded-lg border border-border px-2 py-1 text-xs font-medium"
                        disabled={runningScoutFeed || selectedEligibleLiveIngestionItemCount === 0}
                        onClick={() => void handleSendSelectedLiveIngestionItemsToScoutFeed()}
                        type="button"
                      >
                        Send selected to Scout Feed
                      </button>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {[
                        ["all", "All"],
                        ["draft", "Draft"],
                        ["new", "New"],
                        ["sent_to_feed", "Sent"],
                        ["archived", "Archived"],
                        ["discarded", "Discarded"]
                      ].map(([value, label]) => (
                        <button
                          key={value}
                          aria-pressed={activeLiveIngestionFilter === value}
                          className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
                            activeLiveIngestionFilter === value
                              ? "border-slate-900 bg-slate-900 text-white"
                              : "border-border bg-white text-slate-700"
                          }`}
                          onClick={() =>
                            setActiveLiveIngestionFilter(value as LiveIngestionFilter)
                          }
                          type="button"
                        >
                          {label} ({liveIngestionFilterCounts[value as keyof typeof liveIngestionFilterCounts]})
                        </button>
                      ))}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {[
                        ["all", "All origins"],
                        ["manual", "Manual"],
                        ["watchlist_refresh", "Watchlist refresh"]
                      ].map(([value, label]) => (
                        <button
                          key={value}
                          aria-pressed={activeLiveIngestionOriginFilter === value}
                          className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
                            activeLiveIngestionOriginFilter === value
                              ? "border-slate-900 bg-slate-900 text-white"
                              : "border-border bg-white text-slate-700"
                          }`}
                          onClick={() =>
                            setActiveLiveIngestionOriginFilter(value as LiveIngestionOriginFilter)
                          }
                          type="button"
                        >
                          {label} (
                          {
                            liveIngestionOriginFilterCounts[
                              value as keyof typeof liveIngestionOriginFilterCounts
                            ]
                          }
                          )
                        </button>
                      ))}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {[
                        ["all", "All kinds"],
                        ["public_excerpt", "Public excerpt"],
                        ["watched_url_snapshot", "Watched URL"],
                        ["github_watch_snapshot", "GitHub snapshot"],
                        ["article_watch_snapshot", "Article snapshot"],
                        ["manual_feed_snapshot", "Manual feed"]
                      ].map(([value, label]) => (
                        <button
                          key={value}
                          aria-pressed={activeLiveIngestionSourceKindFilter === value}
                          className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
                            activeLiveIngestionSourceKindFilter === value
                              ? "border-slate-900 bg-slate-900 text-white"
                              : "border-border bg-white text-slate-700"
                          }`}
                          onClick={() =>
                            setActiveLiveIngestionSourceKindFilter(
                              value as LiveIngestionSourceKindFilter
                            )
                          }
                          type="button"
                        >
                          {label} (
                          {
                            liveIngestionSourceKindFilterCounts[
                              value as keyof typeof liveIngestionSourceKindFilterCounts
                            ]
                          }
                          )
                        </button>
                      ))}
                    </div>
                    {recentLiveIngestionRefreshRuns.length > 0 ? (
                      <div className="mt-3">
                        <p className="text-xs font-medium text-slate-600">Recent refresh runs</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button
                            aria-pressed={activeLiveIngestionRefreshRunFilter === "all"}
                            className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
                              activeLiveIngestionRefreshRunFilter === "all"
                                ? "border-slate-900 bg-slate-900 text-white"
                                : "border-border bg-white text-slate-700"
                            }`}
                            onClick={() => setActiveLiveIngestionRefreshRunFilter("all")}
                            type="button"
                          >
                            All refresh runs
                          </button>
                          {recentLiveIngestionRefreshRuns.map((run) => (
                            <div key={run.id} className="flex items-center gap-2">
                              <button
                                aria-pressed={activeLiveIngestionRefreshRunFilter === run.id}
                                className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
                                  activeLiveIngestionRefreshRunFilter === run.id
                                    ? "border-slate-900 bg-slate-900 text-white"
                                    : "border-border bg-white text-slate-700"
                                }`}
                                onClick={() => setActiveLiveIngestionRefreshRunFilter(run.id)}
                                type="button"
                              >
                                {run.label} ({run.createdCount})
                              </button>
                              {activeLiveIngestionRefreshRunFilter !== run.id
                                ? renderCompactBadge(
                                    run.reviewStatus,
                                    getLiveIngestionRefreshRunReviewStatusTone(run.reviewStatus)
                                  )
                                : null}
                            </div>
                          ))}
                        </div>
                        {activeLiveIngestionRefreshRun ? (
                          <p className="mt-2 text-xs text-slate-500">
                            Run scope: {activeLiveIngestionRefreshRun.label} · {activeLiveIngestionRefreshRun.createdCount} added
                            {activeLiveIngestionRefreshRun.skippedCount > 0
                              ? ` · ${activeLiveIngestionRefreshRun.skippedCount} skipped`
                              : ""}
                          </p>
                        ) : null}
                        {activeLiveIngestionRefreshRun ? (
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            {renderCompactBadge(
                              activeLiveIngestionRefreshRun.reviewStatus,
                              getLiveIngestionRefreshRunReviewStatusTone(
                                activeLiveIngestionRefreshRun.reviewStatus
                              )
                            )}
                            {renderCompactBadge(`${activeRunEligibleCount} eligible in run`, "support")}
                            {renderCompactBadge(
                              `${activeRunIneligibleCount} drafts/ineligible in run`,
                              "neutral"
                            )}
                            {renderCompactBadge(`${activeRunBlockedCount} blocked in run`, "avoid")}
                            {renderCompactBadge(`${activeRunSentCount} already sent from run`, "current")}
                            {activeRunEligibleCount > 0 ? (
                              <p className="text-xs text-emerald-700">
                                Run has ready Scout Feed candidates.
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                        {activeLiveIngestionRefreshRun ? (
                          <p className="mt-2 text-xs text-slate-500">
                            {activeRunUnresolvedCount} unresolved · {activeRunResolvedCount} resolved in run.
                          </p>
                        ) : null}
                        {activeLiveIngestionRefreshRun ? (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {activeLiveIngestionRefreshRun.reviewStatus === "open" ? (
                              <button
                                className="rounded-lg border border-border px-2 py-1 text-xs font-medium"
                                onClick={() =>
                                  handleSetLiveIngestionRefreshRunReviewStatus(
                                    activeLiveIngestionRefreshRun.id,
                                    "completed"
                                  )
                                }
                                type="button"
                              >
                                Mark run completed
                              </button>
                            ) : (
                              <button
                                className="rounded-lg border border-border px-2 py-1 text-xs font-medium"
                                onClick={() =>
                                  handleSetLiveIngestionRefreshRunReviewStatus(
                                    activeLiveIngestionRefreshRun.id,
                                    "open"
                                  )
                                }
                                type="button"
                              >
                                Reopen run
                              </button>
                            )}
                            {activeLiveIngestionRefreshRun.reviewStatus !== "archived" ? (
                              <button
                                className="rounded-lg border border-border px-2 py-1 text-xs font-medium"
                                onClick={() =>
                                  handleSetLiveIngestionRefreshRunReviewStatus(
                                    activeLiveIngestionRefreshRun.id,
                                    "archived"
                                  )
                                }
                                type="button"
                              >
                                Archive run
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="mt-3">
                      <label className="text-xs font-medium text-slate-600" htmlFor="live-ingestion-search">
                        Search buffer
                      </label>
                      <input
                        id="live-ingestion-search"
                        className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                        onChange={(event) => setLiveIngestionSearchQuery(event.target.value)}
                        placeholder="Search source label, URL, excerpt, or notes"
                        value={liveIngestionSearchQuery}
                      />
                    </div>
                    {filteredLiveIngestionBuffer.length > 0 ? (
                      <div className="mt-4 space-y-3">
                        {filteredLiveIngestionBuffer.map((item) => (
                        <div key={item.id} className="rounded-lg border border-border p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <label className="flex items-center gap-2 text-xs text-slate-600">
                              <input
                                aria-label={`Select live ingestion item ${item.id}`}
                                checked={selectedLiveIngestionItemIds.includes(item.id)}
                                onChange={() => handleToggleLiveIngestionSelection(item.id)}
                                type="checkbox"
                              />
                              <span>Select</span>
                            </label>
                            <p className="text-sm font-medium">
                              {item.sourceLabel || item.sourceKind}
                            </p>
                            {renderCompactBadge(item.status, "neutral")}
                            {item.origin === "watchlist_refresh"
                              ? renderCompactBadge("watchlist refresh", "support")
                              : null}
                            {item.refreshRunLabel
                              ? renderCompactBadge(item.refreshRunLabel, "neutral")
                              : null}
                          </div>
                          {item.sourceUrl ? (
                            <p className="mt-1 text-xs text-slate-500">{item.sourceUrl}</p>
                          ) : null}
                          <p className="mt-2 text-sm text-slate-700">{item.rawExcerpt}</p>
                          <p className="mt-2 text-xs text-slate-500">
                            Captured: {new Date(item.capturedAt).toLocaleString()}
                          </p>
                          {item.notes ? (
                            <p className="mt-1 text-xs text-slate-500">Notes: {item.notes}</p>
                          ) : null}
                          {item.status === "draft" ? (
                            <div className="mt-2 space-y-2">
                              <p className="text-xs text-slate-500">
                                Add excerpt text to make this item ready for Scout Feed.
                              </p>
                              <textarea
                                aria-label={`Draft excerpt ${item.id}`}
                                className="min-h-24 w-full rounded-lg border border-border px-3 py-2 text-sm"
                                placeholder="Add excerpt text to make this item ready for Scout Feed."
                                value={getLiveIngestionDraftText(item)}
                                onChange={(event) =>
                                  handleEditLiveIngestionDraft(item.id, event.target.value)
                                }
                              />
                            </div>
                          ) : null}
                          <div className="mt-3 flex flex-wrap gap-2">
                            {item.status === "draft" ? (
                              <button
                                className="rounded-lg border border-border px-2 py-1 text-xs font-medium"
                                onClick={() => handleUseDraftLiveIngestionItem(item)}
                                type="button"
                              >
                                Use draft in form
                              </button>
                            ) : null}
                            {item.status === "draft" ? (
                              <button
                                className="rounded-lg border border-border px-2 py-1 text-xs font-medium"
                                onClick={() => handleSaveLiveIngestionDraft(item)}
                                type="button"
                              >
                                Save draft
                              </button>
                            ) : null}
                            {item.status === "draft" ? (
                              <button
                                className="rounded-lg border border-border px-2 py-1 text-xs font-medium"
                                onClick={() => handleCompleteLiveIngestionDraft(item)}
                                type="button"
                              >
                                Complete draft
                              </button>
                            ) : null}
                            {item.status === "new" ? (
                              <button
                                className="rounded-lg border border-border px-2 py-1 text-xs font-medium"
                                disabled={runningScoutFeed}
                                onClick={() => void handleSendLiveIngestionItemToScoutFeed(item)}
                                type="button"
                              >
                                Send to Scout Feed
                              </button>
                            ) : null}
                            {item.status !== "archived" ? (
                              <button
                                className="rounded-lg border border-border px-2 py-1 text-xs font-medium text-slate-600"
                                onClick={() =>
                                  handleUpdateLiveIngestionItemStatus(
                                    item.id,
                                    "archived",
                                    "Archived live ingestion item."
                                  )
                                }
                                type="button"
                              >
                                Archive
                              </button>
                            ) : null}
                            {item.status !== "discarded" ? (
                              <button
                                className="rounded-lg border border-border px-2 py-1 text-xs font-medium text-slate-600"
                                onClick={() =>
                                  handleUpdateLiveIngestionItemStatus(
                                    item.id,
                                    "discarded",
                                    "Discarded live ingestion item."
                                  )
                                }
                                type="button"
                              >
                                Discard
                              </button>
                            ) : null}
                          </div>
                        </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-4 text-sm text-slate-500">
                        No buffer items match these filters.
                      </p>
                    )}
                    <p className="mt-3 text-sm text-slate-500">
                      Raw items stay upstream until you explicitly send them into Scout Feed.
                    </p>
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-slate-500">
                    Buffer raw excerpts here before they enter the scout layers.
                  </p>
                )}
              </Card>
            </section>

            <section className="mt-6">
              <Card>
                <div className="flex items-center gap-2">
                  <Radar className="h-5 w-5 text-slate-600" />
                  <div>
                    <p className="text-sm text-muted">Scout Feed</p>
                    <h3 className="text-lg font-semibold">
                      Batch small public inputs through the existing scout layers
                    </h3>
                  </div>
                </div>
                <form className="mt-4 grid gap-4 xl:grid-cols-2" onSubmit={handleRunScoutFeed}>
                  <div>
                    <label className="text-sm font-medium" htmlFor="scout-feed-mode">
                      Feed mode
                    </label>
                    <select
                      id="scout-feed-mode"
                      className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      value={scoutFeedForm.mode}
                      onChange={(event) =>
                        setScoutFeedForm((current) => ({
                          ...current,
                          mode: event.target.value as ScoutFeedInput["mode"]
                        }))
                      }
                    >
                      <option value="audience">audience</option>
                      <option value="solution">solution</option>
                      <option value="mixed">mixed</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-medium" htmlFor="scout-feed-source-type">
                      Feed solution source type
                    </label>
                    <select
                      id="scout-feed-source-type"
                      className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      value={scoutFeedForm.solutionSourceType ?? "mixed"}
                      onChange={(event) =>
                        setScoutFeedForm((current) => ({
                          ...current,
                          solutionSourceType: event.target.value as SolutionScoutInput["sourceType"]
                        }))
                      }
                    >
                      <option value="mixed">mixed</option>
                      <option value="github">github</option>
                      <option value="article">article</option>
                      <option value="manual_research">manual_research</option>
                    </select>
                  </div>
                  <div className="xl:col-span-2">
                    <label className="text-sm font-medium" htmlFor="scout-feed-target-problem">
                      Feed target problem
                    </label>
                    <input
                      id="scout-feed-target-problem"
                      className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      placeholder="Optional shared problem for solution or mixed feeds"
                      value={scoutFeedForm.targetProblem}
                      onChange={(event) =>
                        setScoutFeedForm((current) => ({
                          ...current,
                          targetProblem: event.target.value
                        }))
                      }
                    />
                  </div>
                  <div className="xl:col-span-2">
                    <label className="text-sm font-medium" htmlFor="scout-feed-batch-input">
                      Batch feed entries
                    </label>
                    <textarea
                      id="scout-feed-batch-input"
                      className="mt-1 min-h-32 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      placeholder={"Paste 3-5 excerpts or notes, separated by a blank line."}
                      value={scoutFeedForm.batchInput}
                      onChange={(event) =>
                        setScoutFeedForm((current) => ({
                          ...current,
                          batchInput: event.target.value
                        }))
                      }
                    />
                  </div>
                  <button
                    className="w-fit rounded-lg border border-border px-3 py-2 text-sm font-medium xl:col-span-2"
                    disabled={runningScoutFeed}
                    type="submit"
                  >
                    {runningScoutFeed ? "Running Feed..." : "Run Scout Feed"}
                  </button>
                </form>
                {scoutFeedResult ? (
                  <div className="mt-4 rounded-lg border border-border bg-white p-4">
                    <p className="text-sm text-slate-700">{scoutFeedResult.summary}</p>
                    {deriveScoutFeedAdapterNote(scoutFeedResult.adapterSummary) ? (
                      <p className="mt-1 text-xs text-slate-600">
                        {deriveScoutFeedAdapterNote(scoutFeedResult.adapterSummary)}
                      </p>
                    ) : null}
                    <p className="mt-1 text-xs text-slate-500">{scoutFeedResult.notes}</p>
                    {scoutFeedActionMessage ? (
                      <p className="mt-3 text-sm text-slate-600">{scoutFeedActionMessage}</p>
                    ) : null}
                    <div className="mt-4 flex flex-wrap gap-2">
                      {scoutFeedResult.audienceItems?.length ? (
                        renderCompactBadge(
                          `${scoutFeedResult.audienceItems.length} audience`,
                          "neutral"
                        )
                      ) : null}
                      {scoutFeedResult.solutionItems?.length ? (
                        renderCompactBadge(
                          `${scoutFeedResult.solutionItems.length} solution`,
                          "neutral"
                        )
                      ) : null}
                    </div>
                    <p className="mt-3 text-sm text-slate-500">
                      Feed results were added to the existing Audience Scout and Solution Scout review sections below.
                    </p>
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-slate-500">
                    Use a small batch of excerpts to populate the scout layers faster without leaving review-first mode.
                  </p>
                )}
              </Card>
            </section>

            <section className="mt-6">
              <Card>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Radar className="h-5 w-5 text-slate-600" />
                    <div>
                      <p className="text-sm text-muted">Pain-to-Solution Matches</p>
                      <h3 className="text-lg font-semibold">
                        Bridge audience pain with solution intelligence before planning
                      </h3>
                    </div>
                  </div>
                  <button
                    className="rounded-lg border border-border px-3 py-2 text-sm font-medium"
                    disabled={
                      matchingScoutOpportunities || !audienceScoutResult || !solutionScoutResult
                    }
                    onClick={() => void handleRunScoutMatch()}
                    type="button"
                  >
                    {matchingScoutOpportunities ? "Matching..." : "Build Scout Matches"}
                  </button>
                </div>
                {scoutMatchResult ? (
                  <div className="mt-4 rounded-lg border border-border bg-white p-4">
                    <p className="text-sm text-slate-700">{scoutMatchResult.summary}</p>
                    <p className="mt-1 text-xs text-slate-500">{scoutMatchResult.notes}</p>
                    {scoutMatchActionMessage ? (
                      <p className="mt-3 text-sm text-slate-600">{scoutMatchActionMessage}</p>
                    ) : null}
                    <div className="mt-4 space-y-3">
                      {scoutMatchResult.items.length > 0 ? (
                        scoutMatchResult.items.map((item) => (
                          <div key={item.id} className="rounded-lg border border-border p-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-medium">{item.matchedPain}</p>
                              {formatScoutStrengthLabel(item.opportunityStrength)
                                ? renderCompactBadge(
                                    formatScoutStrengthLabel(item.opportunityStrength) as string,
                                    "support"
                                  )
                                : null}
                              {renderCompactBadge(item.confidence, "neutral")}
                            </div>
                            <p className="mt-1 text-xs text-slate-500">
                              {item.matchedSolutionPattern} · {item.suggestedAngle} · {item.recommendedAction}
                            </p>
                            {renderScoutScoreNote(item.scoreNotes)}
                            <p className="mt-2 text-sm text-slate-700">{item.whyThisMatchWorks}</p>
                            {renderAIScoutEnrichment("match", item.aiEnrichment)}
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                className="rounded-lg border border-border px-2 py-1 text-xs font-medium"
                                onClick={() => handleSaveMatchedOpportunity(item)}
                                type="button"
                              >
                                Save match
                              </button>
                              <button
                                className="rounded-lg border border-border px-2 py-1 text-xs font-medium"
                                onClick={() => handleSendMatchedOpportunityToSourceIntake(item)}
                                type="button"
                              >
                                Send to Source Intake
                              </button>
                              <button
                                className="rounded-lg border border-border px-2 py-1 text-xs font-medium"
                                onClick={() => handleSaveMatchedOpportunityForLater(item)}
                                type="button"
                              >
                                Save for later
                              </button>
                              <button
                                className="rounded-lg border border-border px-2 py-1 text-xs font-medium"
                                onClick={() => handleSendMatchedOpportunityToDecisionPlanner(item)}
                                type="button"
                              >
                                Send to Decision Planner
                              </button>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-slate-500">
                          No strong matches yet. Build both scout layers first, then match them.
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-slate-500">
                    Run Audience Scout and Solution Scout first, then build a compact shortlist of matched opportunities.
                  </p>
                )}
              </Card>
            </section>

            {savedMatchedOpportunities.length > 0 ? (
              <section className="mt-6">
                <Card>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Layers3 className="h-5 w-5 text-slate-600" />
                      <div>
                        <p className="text-sm text-muted">Saved Matches</p>
                        <h3 className="text-lg font-semibold">
                          Review persisted pain-to-solution opportunities before conversion
                        </h3>
                      </div>
                    </div>
                    {renderCompactBadge(`${savedMatchedOpportunities.length} saved`, "neutral")}
                  </div>
                  {savedMatchesActionMessage ? (
                    <p className="mt-4 text-sm text-slate-600">{savedMatchesActionMessage}</p>
                  ) : null}
                  <div className="mt-4 flex flex-wrap gap-2">
                    {renderCompactBadge(
                      `Strong active (${savedMatchReviewSummary.strongActive})`,
                      "support"
                    )}
                    <button
                      aria-pressed={activeSavedMatchStatusFilter === "new"}
                      className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                        activeSavedMatchStatusFilter === "new"
                          ? "border-slate-900 bg-slate-900 text-white"
                          : "border-slate-200 bg-white text-slate-700"
                      }`}
                      onClick={() => setActiveSavedMatchStatusFilter("new")}
                      type="button"
                    >
                      {`Needs review (${savedMatchReviewSummary.needsReview})`}
                    </button>
                    {renderCompactBadge(
                      `Converted today (${savedMatchReviewSummary.convertedToday})`,
                      "current"
                    )}
                  </div>
                  {activeSavedMatchStatusFilter === "new" && !hasActiveSavedMatchSearch ? (
                    <p className="mt-2 text-xs text-slate-500">Showing new saved matches</p>
                  ) : null}
                  <div className="mt-4 flex flex-wrap gap-2">
                    {[
                      ["all", "All"],
                      ["new", "New"],
                      ["reviewed", "Reviewed"],
                      ["converted", "Converted"],
                      ["archived", "Archived"]
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        aria-pressed={activeSavedMatchStatusFilter === value}
                        className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
                          activeSavedMatchStatusFilter === value
                            ? "border-slate-900 bg-slate-900 text-white"
                            : "border-border bg-white text-slate-700"
                        }`}
                        onClick={() => setActiveSavedMatchStatusFilter(value as SavedMatchStatusFilter)}
                        type="button"
                      >
                        {label} ({savedMatchFilterCounts[value as keyof typeof savedMatchFilterCounts]})
                      </button>
                    ))}
                  </div>
                  <div className="mt-4">
                    <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border/70 bg-slate-50/60 p-2">
                      <input
                        className="min-w-[220px] flex-1 rounded-md border border-border bg-white px-3 py-1.5 text-sm"
                        onChange={(event) => setSavedMatchSearchQuery(event.target.value)}
                        placeholder="Search saved matches"
                        type="search"
                        value={savedMatchSearchQuery}
                      />
                      {hasActiveSavedMatchSearch ? (
                        <>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {renderCompactBadge(
                              getSavedMatchSearchCountLabel(
                                activeSavedMatchStatusFilter,
                                searchedSavedMatchedOpportunities.length
                              ),
                              "neutral"
                            )}
                            {!showInlineSavedMatchSearchRecovery ? (
                              <button
                                className="rounded-md border border-border bg-white px-2.5 py-1.5 text-[11px] font-medium text-slate-700"
                                onClick={() => setSavedMatchSearchQuery("")}
                                type="button"
                              >
                                Clear search
                              </button>
                            ) : null}
                          </div>
                        </>
                      ) : null}
                    </div>
                    {hasActiveSavedMatchSearch ? (
                      <p className="mt-2 text-xs text-slate-500">
                        {getSavedMatchSearchContextHint(activeSavedMatchStatusFilter)}
                      </p>
                    ) : null}
                  </div>
                  <div className="mt-4 space-y-3">
                    {searchedSavedMatchedOpportunities.length > 0 ? searchedSavedMatchedOpportunities.map((item) => (
                      <div
                        key={item.id}
                        className="rounded-lg border border-border p-3"
                        data-testid={`workspace-item-${item.id}`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium">{item.match.matchedPain}</p>
                          {renderCompactBadge(item.status, "neutral")}
                          {formatScoutStrengthLabel(item.match.opportunityStrength)
                            ? renderCompactBadge(
                                formatScoutStrengthLabel(item.match.opportunityStrength) as string,
                                "support"
                              )
                            : null}
                          {renderCompactBadge(item.match.confidence, "neutral")}
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          {item.match.matchedSolutionPattern} · {item.match.suggestedAngle} ·{" "}
                          {item.match.recommendedAction}
                        </p>
                        {renderScoutScoreNote(item.match.scoreNotes)}
                        <p className="mt-2 text-sm text-slate-700">{item.match.whyThisMatchWorks}</p>
                        {renderAIScoutEnrichment("match", item.match.aiEnrichment)}
                        {renderAIContentGeneration(
                          item.match.recommendedAction,
                          item.match.aiContent
                        )}
                        <div className="mt-3 space-y-3">
                          {supportsMatchContentGeneration(item) ? (
                            <div>
                              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                                Content prep
                              </p>
                              <button
                                className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-slate-700"
                                disabled={generatingSavedMatchContentId === item.id}
                                onClick={() => void handleGenerateSavedMatchContent(item)}
                                type="button"
                              >
                                {generatingSavedMatchContentId === item.id
                                  ? "Generating..."
                                  : "Generate content prep"}
                              </button>
                            </div>
                          ) : null}
                          <div>
                            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                              Convert
                            </p>
                            {getSavedMatchConvertHint(item.status) ? (
                              <p className="mb-2 text-[11px] text-slate-500">
                                {getSavedMatchConvertHint(item.status)}
                              </p>
                            ) : null}
                            <div className="flex flex-wrap gap-2">
                              <button
                                className={getSavedMatchConvertActionClass(item.status, "source_intake")}
                                onClick={() => handleSendSavedMatchToSourceIntake(item)}
                                type="button"
                              >
                                Send to Source Intake
                              </button>
                              <button
                                className={getSavedMatchConvertActionClass(item.status, "save_for_later")}
                                onClick={() => handleSaveSavedMatchForLater(item)}
                                type="button"
                              >
                                Save for later
                              </button>
                              <button
                                className={getSavedMatchConvertActionClass(
                                  item.status,
                                  "decision_planner"
                                )}
                                onClick={() => handleSendSavedMatchToDecisionPlanner(item)}
                                type="button"
                              >
                                Send to Decision Planner
                              </button>
                            </div>
                          </div>
                          <div>
                            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                              Review
                            </p>
                            <div className="flex flex-wrap gap-2">
                              <button
                                className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-slate-600"
                                onClick={() => handleMarkSavedMatchReviewed(item.id)}
                                type="button"
                              >
                                Mark reviewed
                              </button>
                              <button
                                className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-slate-600"
                                onClick={() => handleArchiveSavedMatch(item.id)}
                                type="button"
                              >
                                Archive
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )) : hasActiveSavedMatchSearch ? (
                      <div className="space-y-2">
                        <p className="text-sm text-slate-500">
                          {getSavedMatchSearchEmptyStateCopy(activeSavedMatchStatusFilter)}
                        </p>
                        <button
                          className="rounded-lg border border-border px-3 py-2 text-xs font-medium text-slate-700"
                          onClick={() => setSavedMatchSearchQuery("")}
                          type="button"
                        >
                          Clear search
                        </button>
                      </div>
                    ) : (
                      <p className="text-sm text-slate-500">
                        {activeSavedMatchStatusFilter === "new"
                          ? "No new saved matches to review."
                          : "No saved matches match this filter."}
                      </p>
                    )}
                  </div>
                </Card>
              </section>
            ) : null}

            <section className="mt-6">
              <Card>
                <div className="flex items-center gap-2">
                  <WandSparkles className="h-5 w-5 text-slate-600" />
                  <div>
                    <p className="text-sm text-muted">Solution Scout</p>
                    <h3 className="text-lg font-semibold">
                      Structure implementation lessons and tradeoffs from solution material
                    </h3>
                  </div>
                </div>
                <form className="mt-4 grid gap-4 xl:grid-cols-2" onSubmit={handleRunSolutionScout}>
                  <div>
                    <label className="text-sm font-medium" htmlFor="solution-scout-source-type">
                      Solution source type
                    </label>
                    <select
                      id="solution-scout-source-type"
                      className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      value={solutionScoutForm.sourceType ?? "mixed"}
                      onChange={(event) =>
                        setSolutionScoutForm((current) => ({
                          ...current,
                          sourceType: event.target.value as SolutionScoutInput["sourceType"]
                        }))
                      }
                    >
                      <option value="mixed">mixed</option>
                      <option value="github">github</option>
                      <option value="article">article</option>
                      <option value="manual_research">manual_research</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-medium" htmlFor="solution-scout-target-problem">
                      Solution target problem
                    </label>
                    <input
                      id="solution-scout-target-problem"
                      className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      placeholder="workflow handoff failures"
                      value={solutionScoutForm.targetProblem}
                      onChange={(event) =>
                        setSolutionScoutForm((current) => ({
                          ...current,
                          targetProblem: event.target.value
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium" htmlFor="solution-scout-source-label">
                      Solution source label
                    </label>
                    <input
                      id="solution-scout-source-label"
                      className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      placeholder="GitHub release, case study, operator note"
                      value={solutionScoutForm.sourceLabel}
                      onChange={(event) =>
                        setSolutionScoutForm((current) => ({
                          ...current,
                          sourceLabel: event.target.value
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium" htmlFor="solution-scout-source-url">
                      Solution source URL
                    </label>
                    <input
                      id="solution-scout-source-url"
                      className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      placeholder="https://example.com/source"
                      value={solutionScoutForm.sourceUrl}
                      onChange={(event) =>
                        setSolutionScoutForm((current) => ({
                          ...current,
                          sourceUrl: event.target.value
                        }))
                      }
                    />
                  </div>
                  <div className="xl:col-span-2">
                    <label className="text-sm font-medium" htmlFor="solution-scout-source-excerpt">
                      Solution source excerpt
                    </label>
                    <textarea
                      id="solution-scout-source-excerpt"
                      className="mt-1 min-h-24 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      placeholder="Paste release notes, case-study text, or manual operator research here."
                      value={solutionScoutForm.sourceExcerpt}
                      onChange={(event) =>
                        setSolutionScoutForm((current) => ({
                          ...current,
                          sourceExcerpt: event.target.value
                        }))
                      }
                    />
                  </div>
                  <div className="xl:col-span-2">
                    <label className="text-sm font-medium" htmlFor="solution-scout-operator-notes">
                      Solution operator notes
                    </label>
                    <textarea
                      id="solution-scout-operator-notes"
                      className="mt-1 min-h-20 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      placeholder="Optional relevance note or operator interpretation."
                      value={solutionScoutForm.operatorNotes}
                      onChange={(event) =>
                        setSolutionScoutForm((current) => ({
                          ...current,
                          operatorNotes: event.target.value
                        }))
                      }
                    />
                  </div>
                  <button
                    className="w-fit rounded-lg border border-border px-3 py-2 text-sm font-medium xl:col-span-2"
                    disabled={scoutingSolutions}
                    type="submit"
                  >
                    {scoutingSolutions ? "Scouting..." : "Run Solution Scout"}
                  </button>
                </form>
                {solutionScoutResult ? (
                  <div className="mt-4 rounded-lg border border-border bg-white p-4">
                    <p className="text-sm text-slate-700">{solutionScoutResult.summary}</p>
                    {deriveScoutFeedGroupAdapterNote(
                      "Solution",
                      scoutFeedResult?.solutionAdapterSummary
                    ) ? (
                      <p className="mt-1 text-xs text-slate-600">
                        {deriveScoutFeedGroupAdapterNote(
                          "Solution",
                          scoutFeedResult?.solutionAdapterSummary
                        )}
                      </p>
                    ) : null}
                    <p className="mt-1 text-xs text-slate-500">{solutionScoutResult.notes}</p>
                    {solutionScoutActionMessage ? (
                      <p className="mt-3 text-sm text-slate-600">{solutionScoutActionMessage}</p>
                    ) : null}
                    <div className="mt-4 space-y-3">
                      {solutionScoutResult.items.length > 0 ? (
                        solutionScoutResult.items.map((item) => (
                          <div key={item.id} className="rounded-lg border border-border p-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-medium">{item.solutionPattern}</p>
                              {formatScoutStrengthLabel(item.signalStrength)
                                ? renderCompactBadge(
                                    formatScoutStrengthLabel(item.signalStrength) as string,
                                    "support"
                                  )
                                : null}
                              {renderCompactBadge(item.confidence, "neutral")}
                            </div>
                            <p className="mt-1 text-xs text-slate-500">
                              {item.sourceType}
                              {item.sourceLabel ? ` · ${item.sourceLabel}` : ""}
                              {` · ${item.suggestedActionType}`}
                              {` · ${item.suggestedAngle}`}
                            </p>
                            {deriveScoutFeedItemAdapterNote(item.adapterSummary) ? (
                              <p className="mt-1 text-xs text-slate-600">
                                {deriveScoutFeedItemAdapterNote(item.adapterSummary)}
                              </p>
                            ) : null}
                            {item.sourceUrl ? (
                              <p className="mt-1 text-xs text-slate-500">{item.sourceUrl}</p>
                            ) : null}
                            {renderScoutScoreNote(item.scoreNotes)}
                            <p className="mt-2 text-sm text-slate-700">
                              <span className="font-medium">Lesson:</span> {item.implementationLesson}
                            </p>
                            <p className="mt-1 text-sm text-slate-700">
                              <span className="font-medium">Tradeoff:</span> {item.tradeoffOrConstraint}
                            </p>
                            <p className="mt-1 text-sm text-slate-700">{item.whyItMatters}</p>
                            {renderAIScoutEnrichment("solution", item.aiEnrichment)}
                            <p className="mt-2 text-xs text-slate-500">{item.rawExcerpt}</p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                className="rounded-lg border border-border px-2 py-1 text-xs font-medium"
                                onClick={() => handleSendSolutionItemToSourceIntake(item)}
                                type="button"
                              >
                                Send to Source Intake
                              </button>
                              <button
                                className="rounded-lg border border-border px-2 py-1 text-xs font-medium"
                                onClick={() => handleSaveSolutionItemForLater(item)}
                                type="button"
                              >
                                Save for later
                              </button>
                              <button
                                className="rounded-lg border border-border px-2 py-1 text-xs font-medium"
                                onClick={() => handleSendSolutionItemToDecisionPlanner(item)}
                                type="button"
                              >
                                Send to Decision Planner
                              </button>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-slate-500">
                          No strong solution items yet. Tighten the excerpt or add clearer implementation detail and rerun.
                        </p>
                      )}
                    </div>
                  </div>
                ) : null}
              </Card>
            </section>

            <section className="mt-6">
              <Card>
                <div className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-slate-600" />
                  <div>
                    <p className="text-sm text-muted">Audience Scout</p>
                    <h3 className="text-lg font-semibold">
                      Find public audience pain and discussion opportunities before planning
                    </h3>
                  </div>
                </div>
                <form className="mt-4 grid gap-4 xl:grid-cols-2" onSubmit={handleRunAudienceScout}>
                  <div>
                    <label className="text-sm font-medium" htmlFor="audience-scout-topics">
                      Target topics
                    </label>
                    <input
                      id="audience-scout-topics"
                      className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      placeholder="AI automation, ops bottlenecks, workflow chaos"
                      value={audienceScoutForm.targetTopics}
                      onChange={(event) =>
                        setAudienceScoutForm((current) => ({
                          ...current,
                          targetTopics: event.target.value
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium" htmlFor="audience-scout-roles">
                      Target roles
                    </label>
                    <input
                      id="audience-scout-roles"
                      className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      placeholder="COO, RevOps lead, operator"
                      value={audienceScoutForm.targetRoles}
                      onChange={(event) =>
                        setAudienceScoutForm((current) => ({
                          ...current,
                          targetRoles: event.target.value
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium" htmlFor="audience-scout-keywords">
                      Target keywords
                    </label>
                    <input
                      id="audience-scout-keywords"
                      className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      placeholder="handoff, manual work, support friction"
                      value={audienceScoutForm.targetKeywords}
                      onChange={(event) =>
                        setAudienceScoutForm((current) => ({
                          ...current,
                          targetKeywords: event.target.value
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium" htmlFor="audience-scout-max-results">
                      Max results
                    </label>
                    <input
                      id="audience-scout-max-results"
                      className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      min={1}
                      max={10}
                      type="number"
                      value={audienceScoutForm.maxResults}
                      onChange={(event) =>
                        setAudienceScoutForm((current) => ({
                          ...current,
                          maxResults: Number(event.target.value || 1)
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium" htmlFor="audience-scout-source-label">
                      Public source label
                    </label>
                    <input
                      id="audience-scout-source-label"
                      className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      placeholder="LinkedIn thread, Reddit post, community note"
                      value={audienceScoutForm.publicSourceLabel}
                      onChange={(event) =>
                        setAudienceScoutForm((current) => ({
                          ...current,
                          publicSourceLabel: event.target.value
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium" htmlFor="audience-scout-source-url">
                      Public source URL
                    </label>
                    <input
                      id="audience-scout-source-url"
                      className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      placeholder="https://example.com/discussion"
                      value={audienceScoutForm.publicSourceUrl}
                      onChange={(event) =>
                        setAudienceScoutForm((current) => ({
                          ...current,
                          publicSourceUrl: event.target.value
                        }))
                      }
                    />
                  </div>
                  <div className="xl:col-span-2">
                    <label className="text-sm font-medium" htmlFor="audience-scout-public-excerpt">
                      Public excerpt
                    </label>
                    <textarea
                      id="audience-scout-public-excerpt"
                      className="mt-1 min-h-24 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      placeholder="Paste a public discussion excerpt, post snippet, or note here."
                      value={audienceScoutForm.publicExcerpt}
                      onChange={(event) =>
                        setAudienceScoutForm((current) => ({
                          ...current,
                          publicExcerpt: event.target.value
                        }))
                      }
                    />
                  </div>
                  <button
                    className="w-fit rounded-lg border border-border px-3 py-2 text-sm font-medium xl:col-span-2"
                    disabled={scoutingAudience}
                    type="submit"
                  >
                    {scoutingAudience ? "Scouting..." : "Run Audience Scout"}
                  </button>
                </form>
                {audienceScoutResult ? (
                  <div className="mt-4 rounded-lg border border-border bg-white p-4">
                    <p className="text-sm text-slate-700">{audienceScoutResult.summary}</p>
                    {deriveScoutFeedGroupAdapterNote(
                      "Audience",
                      scoutFeedResult?.audienceAdapterSummary
                    ) ? (
                      <p className="mt-1 text-xs text-slate-600">
                        {deriveScoutFeedGroupAdapterNote(
                          "Audience",
                          scoutFeedResult?.audienceAdapterSummary
                        )}
                      </p>
                    ) : null}
                    <p className="mt-1 text-xs text-slate-500">{audienceScoutResult.notes}</p>
                    {audienceScoutActionMessage ? (
                      <p className="mt-3 text-sm text-slate-600">{audienceScoutActionMessage}</p>
                    ) : null}
                    <div className="mt-4 space-y-3">
                      {audienceScoutResult.items.length > 0 ? (
                        audienceScoutResult.items.map((item) => (
                          <div key={item.id} className="rounded-lg border border-border p-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-medium">{item.painSignalSummary}</p>
                              {formatScoutStrengthLabel(item.signalStrength)
                                ? renderCompactBadge(
                                    formatScoutStrengthLabel(item.signalStrength) as string,
                                    "support"
                                  )
                                : null}
                              {renderCompactBadge(item.confidence, "neutral")}
                            </div>
                            <p className="mt-1 text-xs text-slate-500">
                              {item.sourcePlatform}
                              {item.sourceLabel ? ` · ${item.sourceLabel}` : ""}
                              {item.authorRole ? ` · ${item.authorRole}` : ""}
                              {item.topicCluster ? ` · ${item.topicCluster}` : ""}
                              {` · ${item.suggestedActionType}`}
                            </p>
                            {deriveScoutFeedItemAdapterNote(item.adapterSummary) ? (
                              <p className="mt-1 text-xs text-slate-600">
                                {deriveScoutFeedItemAdapterNote(item.adapterSummary)}
                              </p>
                            ) : null}
                            {item.sourceUrl ? (
                              <p className="mt-1 text-xs text-slate-500">{item.sourceUrl}</p>
                            ) : null}
                            {renderScoutScoreNote(item.scoreNotes)}
                            <p className="mt-2 text-sm text-slate-700">{item.whyItMatters}</p>
                            {renderAIScoutEnrichment("audience", item.aiEnrichment)}
                            <p className="mt-2 text-xs text-slate-500">{item.rawExcerpt}</p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                className="rounded-lg border border-border px-2 py-1 text-xs font-medium"
                                onClick={() => handleSendScoutItemToSourceIntake(item)}
                                type="button"
                              >
                                Send to Source Intake
                              </button>
                              <button
                                className="rounded-lg border border-border px-2 py-1 text-xs font-medium"
                                onClick={() => handleSaveScoutItemForLater(item)}
                                type="button"
                              >
                                Save for later
                              </button>
                              <button
                                className="rounded-lg border border-border px-2 py-1 text-xs font-medium"
                                onClick={() => handleSendScoutItemToDecisionPlanner(item)}
                                type="button"
                              >
                                Send to Decision Planner
                              </button>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-slate-500">
                          No strong scout items yet. Tighten the topic or keyword inputs and rerun.
                        </p>
                      )}
                    </div>
                  </div>
                ) : null}
              </Card>
            </section>

            {/* Lab & Internal Tools section - continues Lab conditional */}
            <div className="mb-8 mt-16 rounded-lg border-l-4 border-purple-600 bg-purple-50 px-6 py-4">
              <p className="font-medium text-purple-900">⚗️ Lab & Internal Tools</p>
              <p className="mt-2 text-sm text-purple-800">
                These tools are for internal engineering workflows, manual analysis, and experiments. They are NOT part of the primary autonomous operator workflow. Use only when needed for specific debugging or manual content creation.
              </p>
            </div>

            <div className="mb-4 mt-8 border-b border-purple-600 pb-2">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-purple-700">Lab & Advanced Tools</h2>
              <p className="mt-1 text-sm text-slate-600">Scout tools (Live Ingestion, Scout Feed, Audience/Solution Scout), manual signal intake, relevance analyzer, and other internal engineering tools. Review-first workflows for specialized analysis and experiments.</p>
            </div>

            <section className="mt-6">
              <Card>
                <div className="flex items-center gap-2">
                  <Layers3 className="h-5 w-5 text-slate-600" />
                  <div>
                    <p className="text-sm text-muted">Relevance Analyzer</p>
                    <h3 className="text-lg font-semibold">Judge whether this is worth engaging</h3>
                  </div>
                </div>
                <form className="mt-4 grid gap-4 xl:grid-cols-2" onSubmit={handleAnalyzeRelevance}>
                  <div>
                    <label className="text-sm font-medium" htmlFor="relevance-role-title">
                      Role/title
                    </label>
                    <input
                      id="relevance-role-title"
                      className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      value={relevanceForm.roleTitle ?? ""}
                      onChange={(event) =>
                        setRelevanceForm((current) => ({
                          ...current,
                          roleTitle: event.target.value
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium" htmlFor="relevance-company-text">
                      Company/about text
                    </label>
                    <textarea
                      id="relevance-company-text"
                      className="mt-1 min-h-24 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      value={relevanceForm.companyText ?? ""}
                      onChange={(event) =>
                        setRelevanceForm((current) => ({
                          ...current,
                          companyText: event.target.value
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium" htmlFor="relevance-post-text">
                      Post text
                    </label>
                    <textarea
                      id="relevance-post-text"
                      className="mt-1 min-h-28 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      value={relevanceForm.postText ?? ""}
                      onChange={(event) =>
                        setRelevanceForm((current) => ({
                          ...current,
                          postText: event.target.value
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium" htmlFor="relevance-website-about">
                      Website/about text
                    </label>
                    <textarea
                      id="relevance-website-about"
                      className="mt-1 min-h-28 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      value={relevanceForm.websiteAboutText ?? ""}
                      onChange={(event) =>
                        setRelevanceForm((current) => ({
                          ...current,
                          websiteAboutText: event.target.value
                        }))
                      }
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm font-medium xl:col-span-2">
                    <input
                      checked={relevanceForm.hasCommentContext ?? false}
                      onChange={(event) =>
                        setRelevanceForm((current) => ({
                          ...current,
                          hasCommentContext: event.target.checked
                        }))
                      }
                      type="checkbox"
                    />
                    There is already a comment context
                  </label>
                  <button
                    className="w-fit rounded-lg border border-border px-3 py-2 text-sm font-medium xl:col-span-2"
                    disabled={submittingRelevance}
                    type="submit"
                  >
                    {submittingRelevance ? "Analyzing..." : "Analyze Relevance"}
                  </button>
                </form>
                {relevanceResult ? (
                  <div className="mt-4 rounded-lg border border-border bg-white p-4">
                    <div className="flex flex-wrap gap-4 text-sm">
                      <p>
                        <span className="font-medium">Score:</span> {relevanceResult.relevanceScore}
                      </p>
                      <p>
                        <span className="font-medium">Angle:</span> {relevanceResult.bestAngle}
                      </p>
                      <p>
                        <span className="font-medium">Action:</span> {relevanceResult.recommendedAction}
                      </p>
                    </div>
                    <p className="mt-3 text-sm text-slate-700">{relevanceResult.reasoningSummary}</p>
                    {relevanceResult.riskNotes.length > 0 ? (
                      <p className="mt-2 text-xs text-slate-500">
                        Risks: {relevanceResult.riskNotes.join(" | ")}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </Card>
            </section>

            <section className="mt-6">
              <Card>
                <div className="flex items-center gap-2">
                  <Layers3 className="h-5 w-5 text-slate-600" />
                  <div>
                    <p className="text-sm text-muted">Source Intake</p>
                    <h3 className="text-lg font-semibold">
                      Normalize article, GitHub, or research notes into a reusable signal
                    </h3>
                  </div>
                </div>
                <form className="mt-4 grid gap-4 xl:grid-cols-2" onSubmit={handleNormalizeSourceIntake}>
                  <div>
                    <label className="text-sm font-medium" htmlFor="intake-source-type">
                      Intake source type
                    </label>
                    <select
                      id="intake-source-type"
                      className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      value={sourceIntakeForm.sourceType}
                      onChange={(event) =>
                        setSourceIntakeForm((current) => ({
                          ...current,
                          sourceType: event.target.value as SourceIntakeInput["sourceType"],
                          githubSubtype:
                            event.target.value === "github" ? current.githubSubtype : undefined
                        }))
                      }
                    >
                      <option value="article">article</option>
                      <option value="manual_research">manual_research</option>
                      <option value="github">github</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-medium" htmlFor="intake-title">
                      Intake title
                    </label>
                    <input
                      id="intake-title"
                      className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      value={sourceIntakeForm.title}
                      onChange={(event) =>
                        setSourceIntakeForm((current) => ({
                          ...current,
                          title: event.target.value
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium" htmlFor="intake-source-url">
                      Intake source URL
                    </label>
                    <input
                      id="intake-source-url"
                      className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      value={sourceIntakeForm.sourceUrl ?? ""}
                      onChange={(event) =>
                        setSourceIntakeForm((current) => ({
                          ...current,
                          sourceUrl: event.target.value
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium" htmlFor="intake-target-role">
                      Intake target role/title
                    </label>
                    <input
                      id="intake-target-role"
                      className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      value={sourceIntakeForm.targetRole ?? ""}
                      onChange={(event) =>
                        setSourceIntakeForm((current) => ({
                          ...current,
                          targetRole: event.target.value
                        }))
                      }
                    />
                  </div>
                  {sourceIntakeForm.sourceType === "github" ? (
                    <>
                      <div>
                        <label className="text-sm font-medium" htmlFor="intake-github-subtype">
                          GitHub subtype
                        </label>
                        <select
                          id="intake-github-subtype"
                          className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                          value={sourceIntakeForm.githubSubtype ?? ""}
                          onChange={(event) =>
                            setSourceIntakeForm((current) => ({
                              ...current,
                              githubSubtype:
                                event.target.value === ""
                                  ? undefined
                                  : (event.target.value as "release" | "issue" | "repo_change")
                            }))
                          }
                        >
                          <option value="">optional</option>
                          <option value="release">Release</option>
                          <option value="issue">Issue</option>
                          <option value="repo_change">Repo change</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-sm font-medium" htmlFor="intake-repo-name">
                          Repo name
                        </label>
                        <input
                          id="intake-repo-name"
                          className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                          value={sourceIntakeForm.repoName ?? ""}
                          onChange={(event) =>
                            setSourceIntakeForm((current) => ({
                              ...current,
                              repoName: event.target.value
                            }))
                          }
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium" htmlFor="intake-repo-context">
                          Repo / release context
                        </label>
                        <input
                          id="intake-repo-context"
                          className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                          value={sourceIntakeForm.repoContext ?? ""}
                          onChange={(event) =>
                            setSourceIntakeForm((current) => ({
                              ...current,
                              repoContext: event.target.value
                            }))
                          }
                        />
                      </div>
                    </>
                  ) : null}
                  <div className="xl:col-span-2">
                    <label className="text-sm font-medium" htmlFor="intake-summary-text">
                      Intake summary / notes
                    </label>
                    <textarea
                      id="intake-summary-text"
                      className="mt-1 min-h-28 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      value={sourceIntakeForm.summaryText}
                      onChange={(event) =>
                        setSourceIntakeForm((current) => ({
                          ...current,
                          summaryText: event.target.value
                        }))
                      }
                    />
                  </div>
                  {sourceIntakeForm.sourceType === "github" ? (
                    <div>
                      <label className="text-sm font-medium" htmlFor="intake-release-change-type">
                        Release / change type
                      </label>
                      <input
                        id="intake-release-change-type"
                        className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                        value={sourceIntakeForm.releaseOrChangeType ?? ""}
                        onChange={(event) =>
                          setSourceIntakeForm((current) => ({
                            ...current,
                            releaseOrChangeType: event.target.value
                          }))
                        }
                      />
                    </div>
                  ) : null}
                  <div>
                    <label className="text-sm font-medium" htmlFor="intake-operator-notes">
                      Intake operator notes
                    </label>
                    <textarea
                      id="intake-operator-notes"
                      className="mt-1 min-h-24 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      value={sourceIntakeForm.operatorNotes ?? ""}
                      onChange={(event) =>
                        setSourceIntakeForm((current) => ({
                          ...current,
                          operatorNotes: event.target.value
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium" htmlFor="intake-company-context">
                      Intake company/about context
                    </label>
                    <textarea
                      id="intake-company-context"
                      className="mt-1 min-h-24 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      value={sourceIntakeForm.companyContext ?? ""}
                      onChange={(event) =>
                        setSourceIntakeForm((current) => ({
                          ...current,
                          companyContext: event.target.value
                        }))
                      }
                    />
                  </div>
                  <button
                    className="w-fit rounded-lg border border-border px-3 py-2 text-sm font-medium xl:col-span-2"
                    disabled={submittingSourceIntake}
                    type="submit"
                  >
                    {submittingSourceIntake ? "Normalizing..." : "Normalize Source"}
                  </button>
                </form>
                {normalizedSourceSignal ? (
                  <div className="mt-4 rounded-lg border border-border bg-white p-4">
                    <div className="flex flex-wrap gap-4 text-sm">
                      <p>
                        <span className="font-medium">Suggested angle:</span>{" "}
                        {normalizedSourceSignal.suggestedAngle}
                      </p>
                      <p>
                        <span className="font-medium">Source type:</span>{" "}
                        {normalizedSourceSignal.sourceType}
                      </p>
                    </div>
                    <p className="mt-3 text-sm text-slate-700">
                      {normalizedSourceSignal.normalizedSignalText}
                    </p>
                    <p className="mt-2 text-xs text-slate-500">
                      {normalizedSourceSignal.reasoningSummary}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-3">
                      <button
                        className="rounded-lg border border-border px-3 py-2 text-sm font-medium"
                        disabled={creatingSignalFromIntake}
                        onClick={handleCreateSignalFromIntake}
                        type="button"
                      >
                        {creatingSignalFromIntake ? "Creating..." : "Create Signal from Intake"}
                      </button>
                      <button
                        className="rounded-lg border border-border px-3 py-2 text-sm font-medium"
                        onClick={handleSendIntakeToDecisionPlanner}
                        type="button"
                      >
                        Send to Decision Planner
                      </button>
                      <button
                        className="rounded-lg border border-border px-3 py-2 text-sm font-medium"
                        onClick={handleSaveIntakeForLater}
                        type="button"
                      >
                        Save for later
                      </button>
                    </div>
                    {createdSignalFromIntake ? (
                      <div className="mt-3 flex flex-wrap gap-3">
                        <button
                          aria-label="Open created signal"
                          className="rounded-lg border border-border px-3 py-2 text-sm font-medium"
                          onClick={handleOpenCreatedSignal}
                          type="button"
                        >
                          Open created signal
                        </button>
                        <button
                          aria-label="Generate idea from created signal"
                          className="rounded-lg border border-border px-3 py-2 text-sm font-medium"
                          disabled={workingSignalId === createdSignalFromIntake.id}
                          onClick={() => void handleGenerateIdeaFromCreatedSignal()}
                          type="button"
                        >
                          {workingSignalId === createdSignalFromIntake.id
                            ? "Generating..."
                            : "Generate Idea"}
                        </button>
                        <button
                          aria-label="Generate draft from created signal"
                          className="rounded-lg border border-border px-3 py-2 text-sm font-medium"
                          disabled={
                            !createdIdeaFromIntake ||
                            workingIdeaId === createdIdeaFromIntake.id
                          }
                          onClick={() => void handleGenerateDraftFromCreatedSignal()}
                          type="button"
                        >
                          {createdIdeaFromIntake && workingIdeaId === createdIdeaFromIntake.id
                            ? "Generating..."
                            : "Generate Draft"}
                        </button>
                      </div>
                    ) : null}
                    {createdSignalFromIntake && !createdIdeaFromIntake ? (
                      <p className="mt-2 text-xs text-slate-500">
                        Generate an idea first to unlock draft generation.
                      </p>
                    ) : null}
                    {sourceIntakeActionMessage ? (
                      <p className="mt-3 text-sm text-slate-700">{sourceIntakeActionMessage}</p>
                    ) : null}
                  </div>
                ) : null}
              </Card>

              <Card>
                <div className="flex items-center gap-2">
                  <Radar className="h-5 w-5 text-slate-600" />
                  <div>
                    <p className="text-sm text-muted">Decision Planner</p>
                    <h3 className="text-lg font-semibold">Plan the next best operator action</h3>
                  </div>
                </div>
                <form className="mt-4 grid gap-4 xl:grid-cols-2" onSubmit={handlePlanDecision}>
                  <div className="xl:col-span-2">
                    <label className="text-sm font-medium" htmlFor="decision-signal-text">
                      Decision signal text
                    </label>
                    <textarea
                      id="decision-signal-text"
                      className="mt-1 min-h-24 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      value={decisionForm.signalText}
                      onChange={(event) =>
                        setDecisionForm((current) => ({
                          ...current,
                          signalText: event.target.value
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium" htmlFor="decision-source-type">
                      Decision source type
                    </label>
                    <select
                      id="decision-source-type"
                      className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      value={decisionForm.sourceType ?? "manual"}
                      onChange={(event) =>
                        setDecisionForm((current) => ({
                          ...current,
                          sourceType: event.target.value as DecisionLayerInput["sourceType"]
                        }))
                      }
                    >
                      {["manual", "github", "article", "note", "commentary", "other"].map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-medium" htmlFor="decision-target-role">
                      Decision target role/title
                    </label>
                    <input
                      id="decision-target-role"
                      className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      value={decisionForm.targetRole ?? ""}
                      onChange={(event) =>
                        setDecisionForm((current) => ({
                          ...current,
                          targetRole: event.target.value
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium" htmlFor="decision-company-context">
                      Decision company/about text
                    </label>
                    <textarea
                      id="decision-company-context"
                      className="mt-1 min-h-20 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      value={decisionForm.companyContext ?? ""}
                      onChange={(event) =>
                        setDecisionForm((current) => ({
                          ...current,
                          companyContext: event.target.value
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium" htmlFor="decision-post-context">
                      Decision post/comment context
                    </label>
                    <textarea
                      id="decision-post-context"
                      className="mt-1 min-h-20 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      value={decisionForm.postContext ?? ""}
                      onChange={(event) =>
                        setDecisionForm((current) => ({
                          ...current,
                          postContext: event.target.value
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium" htmlFor="decision-relevance-score">
                      Optional relevance score
                    </label>
                    <input
                      id="decision-relevance-score"
                      className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      inputMode="numeric"
                      type="number"
                      value={decisionForm.relevanceScore ?? ""}
                      onChange={(event) =>
                        setDecisionForm((current) => ({
                          ...current,
                          relevanceScore:
                            event.target.value === "" ? undefined : Number(event.target.value)
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium" htmlFor="decision-best-angle">
                      Optional best angle
                    </label>
                    <select
                      id="decision-best-angle"
                      className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      value={decisionForm.bestAngle ?? ""}
                      onChange={(event) =>
                        setDecisionForm((current) => ({
                          ...current,
                          bestAngle:
                            event.target.value === ""
                              ? undefined
                              : (event.target.value as DecisionLayerInput["bestAngle"])
                        }))
                      }
                    >
                      <option value="">infer</option>
                      {[
                        "ownership_gap",
                        "handoff_failure",
                        "exception_handling",
                        "workflow_accountability",
                        "operational_roi",
                        "low_fit"
                      ].map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-medium" htmlFor="decision-recommended-action">
                      Optional relevance action
                    </label>
                    <select
                      id="decision-recommended-action"
                      className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      value={decisionForm.recommendedAction ?? ""}
                      onChange={(event) =>
                        setDecisionForm((current) => ({
                          ...current,
                          recommendedAction:
                            event.target.value === ""
                              ? undefined
                              : (event.target.value as DecisionLayerInput["recommendedAction"])
                        }))
                      }
                    >
                      <option value="">infer</option>
                      {["ignore", "comment", "reply", "save_for_later", "outreach_candidate"].map(
                        (value) => (
                          <option key={value} value={value}>
                            {value}
                          </option>
                        )
                      )}
                    </select>
                  </div>
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input
                      checked={decisionForm.hasCommentContext ?? false}
                      onChange={(event) =>
                        setDecisionForm((current) => ({
                          ...current,
                          hasCommentContext: event.target.checked
                        }))
                      }
                      type="checkbox"
                    />
                    There is a comment context
                  </label>
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input
                      checked={decisionForm.hasReplyContext ?? false}
                      onChange={(event) =>
                        setDecisionForm((current) => ({
                          ...current,
                          hasReplyContext: event.target.checked
                        }))
                      }
                      type="checkbox"
                    />
                    There is a reply context
                  </label>
                  <button
                    className="w-fit rounded-lg border border-border px-3 py-2 text-sm font-medium xl:col-span-2"
                    disabled={submittingDecision}
                    type="submit"
                  >
                    {submittingDecision ? "Planning..." : "Plan Decision"}
                  </button>
                </form>
                {decisionPlan ? (
                  <div className="mt-4 rounded-lg border border-border bg-white p-4">
                    <div className="flex flex-wrap gap-4 text-sm">
                      <p>
                        <span className="font-medium">Recommended action:</span>{" "}
                        {decisionPlan.recommendedNextAction}
                      </p>
                      <p>
                        <span className="font-medium">Angle:</span> {decisionPlan.bestAngle}
                      </p>
                      <p>
                        <span className="font-medium">Suggested flow:</span>{" "}
                        {decisionPlan.suggestedFlow}
                      </p>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-4 text-sm text-slate-700">
                      <p>
                        <span className="font-medium">Content priority:</span>{" "}
                        {decisionPlan.contentPriority}
                      </p>
                      <p>
                        <span className="font-medium">Engagement priority:</span>{" "}
                        {decisionPlan.engagementPriority}
                      </p>
                      <p>
                        <span className="font-medium">Confidence:</span> {decisionPlan.confidence}
                      </p>
                    </div>
                    <p className="mt-3 text-sm text-slate-700">{decisionPlan.reasoningSummary}</p>
                    {decisionPlan.riskNotes.length > 0 ? (
                      <p className="mt-2 text-xs text-slate-500">
                        Risks: {decisionPlan.riskNotes.join(" | ")}
                      </p>
                    ) : null}
                    <div className="mt-4 flex flex-wrap gap-3">
                      <button
                        className="rounded-lg border border-border px-3 py-2 text-sm font-medium"
                        onClick={handleRunRecommendedAction}
                        type="button"
                      >
                        Run Recommended Action
                      </button>
                    </div>
                    {decisionActionMessage ? (
                      <p className="mt-3 text-sm text-slate-700">{decisionActionMessage}</p>
                    ) : null}
                  </div>
                ) : null}
                {savedDecisionItems.length > 0 ? (
                  <div className="mt-4 rounded-lg border border-border bg-slate-50 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                        Saved for later
                      </p>
                      <button
                        aria-label="Clear all saved items"
                        className="rounded-lg border border-border px-2 py-1 text-xs font-medium"
                        onClick={handleClearSavedDecisionItems}
                        type="button"
                      >
                        Clear all
                      </button>
                    </div>
                    {feedbackThemeTags.length > 0 ? (
                      <div>
                        <p className="mt-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                          Shared motifs
                        </p>
                        {renderFeedbackThemeTags()}
                      </div>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(
                        [
                          ["all", "All"],
                          ["active", "Active"],
                          ["done", "Done"],
                          ["archived", "Archived"]
                        ] as const
                      ).map(([value, label]) => (
                        <button
                          key={value}
                          className={`rounded-lg border px-2 py-1 text-xs font-medium ${
                            activeQueueFilter === value
                              ? "border-slate-900 bg-slate-900 text-white"
                              : "border-border bg-white text-slate-600"
                          }`}
                          onClick={() => setActiveQueueFilter(value)}
                          type="button"
                        >
                          {label} ({queueFilterCounts[value]})
                        </button>
                      ))}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {(
                        [
                          ["newest", "Newest"],
                          ["oldest", "Oldest"],
                          ["lastAction", "Last action"]
                        ] as const
                      ).map(([value, label]) => (
                        <button
                          key={value}
                          className={`rounded-lg border px-2 py-1 text-xs font-medium ${
                            activeQueueSort === value
                              ? "border-slate-900 bg-slate-900 text-white"
                              : "border-border bg-white text-slate-600"
                          }`}
                          onClick={() => setActiveQueueSort(value)}
                          type="button"
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <div className="mt-3">
                      <label className="sr-only" htmlFor="queue-search">
                        Search saved items
                      </label>
                      <input
                        id="queue-search"
                        className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm"
                        onChange={(event) => setQueueSearchQuery(event.target.value)}
                        placeholder="Search saved items"
                        type="text"
                        value={queueSearchQuery}
                      />
                    </div>
                    {filteredAndSortedSavedDecisionItems.length === 0 ? (
                      <p className="mt-3 text-sm text-slate-500">
                        {queueSearchQuery.trim()
                          ? "No saved items match this search."
                          : activeQueueFilter === "archived"
                            ? "No archived items yet."
                            : activeQueueFilter === "done"
                              ? "No done items yet."
                              : activeQueueFilter === "active"
                                ? "No active items right now."
                                : "No saved items yet."}
                      </p>
                    ) : (
                      <div className="mt-3 space-y-3">
                        {filteredAndSortedSavedDecisionItems.map((item) => (
                          <div
                            key={item.id}
                            className={`rounded-lg border bg-white p-3 ${
                              highlightedSavedDecisionItemId === item.id
                                ? "border-slate-900 bg-slate-50"
                                : "border-border"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-sm font-medium">{item.recommendedAction}</p>
                              <div className="flex items-center gap-2">
                                {highlightedSavedDecisionItemId === item.id ? (
                                  renderCompactBadge("Current", "current")
                                ) : null}
                                {renderCompactBadge(item.status, "neutral")}
                                <p className="text-xs uppercase tracking-[0.16em] text-slate-500">
                                  {item.priority}
                                </p>
                              </div>
                            </div>
                            <p className="mt-2 text-sm text-slate-700">{item.signalText}</p>
                            <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
                              <p>Angle: {item.bestAngle}</p>
                              <p>{new Date(item.createdAt).toLocaleString()}</p>
                              {item.lastActionAt ? (
                                <p>Last action: {new Date(item.lastActionAt).toLocaleString()}</p>
                              ) : null}
                            </div>
                            <p className="mt-2 text-xs text-slate-500">{item.reasoningSummary}</p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                aria-label={`Send ${item.id} to post generator`}
                                className="rounded-lg border border-border px-2 py-1 text-xs font-medium"
                                onClick={() => handleQueueAction("post", item)}
                                type="button"
                              >
                                Send to Post Generator
                              </button>
                              <button
                                aria-label={`Send ${item.id} to comment writer`}
                                className="rounded-lg border border-border px-2 py-1 text-xs font-medium"
                                onClick={() => handleQueueAction("comment", item)}
                                type="button"
                              >
                                Send to Comment Writer
                              </button>
                              <button
                                aria-label={`Send ${item.id} to reply writer`}
                                className="rounded-lg border border-border px-2 py-1 text-xs font-medium"
                                onClick={() => handleQueueAction("reply", item)}
                                type="button"
                              >
                                Send to Reply Writer
                              </button>
                              <button
                                aria-label={`Remove ${item.id}`}
                                className="rounded-lg border border-border px-2 py-1 text-xs font-medium text-slate-600"
                                onClick={() => handleRemoveSavedDecisionItem(item.id)}
                                type="button"
                              >
                                Remove
                              </button>
                              <button
                                aria-label={`Mark ${item.id} done`}
                                className="rounded-lg border border-border px-2 py-1 text-xs font-medium text-slate-600"
                                onClick={() => handleUpdateSavedDecisionStatus(item.id, "done")}
                                type="button"
                              >
                                Mark done
                              </button>
                              <button
                                aria-label={`Archive ${item.id}`}
                                className="rounded-lg border border-border px-2 py-1 text-xs font-medium text-slate-600"
                                onClick={() => handleUpdateSavedDecisionStatus(item.id, "archived")}
                                type="button"
                              >
                                Archive
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
              </Card>
            </section>

            <section className="mt-6">
              <Card>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-slate-600" />
                    <div>
                      <p className="text-sm text-muted">Orchestrated Next Move</p>
                      <h3 className="text-lg font-semibold">
                        Unified recommendation from planner, rhythm, strategy, feedback, and memory
                      </h3>
                    </div>
                  </div>
                  <button
                    className="rounded-lg border border-border px-3 py-2 text-sm font-medium"
                    disabled={recommendingNextMove}
                    onClick={() => void handleRecommendNextMove()}
                    type="button"
                  >
                    {recommendingNextMove ? "Recommending..." : "Recommend Next Move"}
                  </button>
                </div>
                {orchestratedRecommendation ? (
                  <div className="mt-4 rounded-lg border border-border bg-white p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                        Recommended next move
                      </p>
                      {renderCompactBadge(
                        orchestratedRecommendation.recommendedAction,
                        orchestratedRecommendation.recommendedAction === "save_for_later" ||
                          orchestratedRecommendation.recommendedAction === "revisit_signal"
                          ? "avoid"
                          : "repeat"
                      )}
                    </div>
                    <p className="mt-3 text-sm font-medium text-slate-800">
                      {orchestratedRecommendation.primaryTarget}
                    </p>
                    <p className="mt-2 text-sm text-slate-700">
                      {orchestratedRecommendation.recommendationReason}
                    </p>
                    <p className="mt-2 text-xs text-slate-500">
                      Confidence: {orchestratedRecommendation.confidence}
                    </p>
                    {orchestratedRecommendation.scoutSupport &&
                    orchestratedRecommendation.scoutSupport.length > 0 ? (
                      <div className="mt-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                            Scout support
                          </p>
                          {orchestratedScoutSupportDetails.supportGroupLabel
                            ? renderCompactBadge(orchestratedScoutSupportDetails.supportGroupLabel, "neutral")
                            : null}
                          {orchestratedScoutSupportDetails.originLabel
                            ? renderCompactBadge(orchestratedScoutSupportDetails.originLabel, "neutral")
                            : null}
                          {orchestratedScoutSupportDetails.strengthLabel
                            ? renderCompactBadge(orchestratedScoutSupportDetails.strengthLabel, "support")
                            : null}
                        </div>
                        <div className="mt-2 space-y-1 text-sm text-slate-700">
                          {orchestratedRecommendation.scoutSupport.map((item) => (
                            <p key={item}>{item}</p>
                          ))}
                        </div>
                        {renderDownstreamMixedSupportDrillIn(
                          orchestratedScoutSupportDetails.supportGroupLabel
                        )}
                        {renderDownstreamPrioritizationLiftHint(
                          getOrchestratedPrioritizationLiftHint(
                            orchestratedRecommendation.scoutInfluence,
                            orchestratedScoutSupportDetails.supportGroupLabel
                          )
                        )}
                        {renderDownstreamPrioritizationLiftReasonLine(
                          getOrchestratedPrioritizationLiftReasonLine(
                            orchestratedRecommendation.scoutInfluence,
                            orchestratedScoutSupportDetails.supportGroupLabel,
                            orchestratedScoutSupportDetails.originLabel
                          )
                        )}
                        {renderDownstreamScoutScoreNote(orchestratedScoutSupportDetails.scoreNote)}
                        {orchestratedRecommendation.scoutInfluence ? (
                          <p className="mt-2 text-xs text-slate-500">
                            Scout influence: {orchestratedRecommendation.scoutInfluence}
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                    {orchestratedRecommendation.supportingSignals.length > 0 ? (
                      <div className="mt-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                          What it is based on
                        </p>
                        <div className="mt-2 space-y-1 text-sm text-slate-700">
                          {orchestratedRecommendation.supportingSignals.map((signal) => (
                            <p key={signal}>{signal}</p>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {orchestratedRecommendation.coordinationNotes.length > 0 ? (
                      <div className="mt-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                          Coordination notes
                        </p>
                        <div className="mt-2 space-y-1 text-sm text-slate-600">
                          {orchestratedRecommendation.coordinationNotes.map((note) => (
                            <p key={note}>{note}</p>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {getOrchestratedQuickActionLabel() ? (
                      <div className="mt-4 flex flex-wrap items-center gap-3">
                        <button
                          className="rounded-lg border border-border px-3 py-2 text-sm font-medium"
                          onClick={handleOrchestratedQuickAction}
                          type="button"
                        >
                          {getOrchestratedQuickActionLabel()}
                        </button>
                        {orchestratedActionMessage ? (
                          <p className="text-sm text-slate-600">{orchestratedActionMessage}</p>
                        ) : null}
                      </div>
                    ) : null}
                    {!getOrchestratedQuickActionLabel() && getOrchestratedSupportingContextTarget() ? (
                      <div className="mt-4 flex flex-wrap items-center gap-3">
                        <button
                          className="rounded-lg border border-border px-3 py-2 text-sm font-medium"
                          onClick={handleOrchestratedSupportingContextAction}
                          type="button"
                        >
                          Open supporting context
                        </button>
                        {orchestratedActionMessage ? (
                          <p className="text-sm text-slate-600">{orchestratedActionMessage}</p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-slate-500">
                    No unified recommendation yet. Use the current planner, rhythm, strategy, feedback, and memory context to request one compact next move.
                  </p>
                )}
              </Card>
            </section>

            <section className="mt-6">
              <Card>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Radar className="h-5 w-5 text-slate-600" />
                    <div>
                      <p className="text-sm text-muted">LinkedIn Action Plan</p>
                      <h3 className="text-lg font-semibold">
                        Weekly operator guidance from queue and planner context
                      </h3>
                    </div>
                  </div>
                  <button
                    className="rounded-lg border border-border px-3 py-2 text-sm font-medium"
                    disabled={planningGrowthRhythm}
                    onClick={() => void handlePlanGrowthRhythm()}
                    type="button"
                  >
                    {planningGrowthRhythm ? "Building..." : "Build Action Plan"}
                  </button>
                </div>
                {prioritizedGrowthRhythmPlan ? (
                  <div className="mt-4 grid gap-4 xl:grid-cols-3">
                    <div className="rounded-lg border border-border bg-white p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                        Top post candidates
                      </p>
                      <div className="mt-3 space-y-3">
                        {prioritizedGrowthRhythmPlan.topPostCandidates.length > 0 ? (
                          prioritizedGrowthRhythmPlan.topPostCandidates.map((candidate) => {
                            const scoutSupport = actionPlanScoutSupportByCandidateId.get(candidate.id);

                            return (
                              <div key={candidate.id} className="rounded-lg border border-border p-3">
                                <p className="text-sm font-medium">{candidate.title}</p>
                                <p className="mt-1 text-xs text-slate-500">
                                  {candidate.suggestedAction} · {candidate.priority} · {candidate.status}
                                </p>
                                {candidate.reasoningSummary ? (
                                  <p className="mt-2 text-xs text-slate-600">
                                    {candidate.reasoningSummary}
                                  </p>
                                ) : null}
                                {candidate.memoryBadge ? (
                                  <div className="mt-2">
                                    {renderCompactBadge(
                                      candidate.memoryBadge,
                                      candidate.memoryBadgeKind === "avoid" ? "avoid" : "repeat"
                                    )}
                                  </div>
                                ) : null}
                                {scoutSupport ? (
                                  <div className="mt-2">
                                    <div className="flex flex-wrap items-center gap-2">
                                      {renderCompactBadge(scoutSupport.badge, scoutSupport.badgeKind)}
                                      {scoutSupport.supportGroupLabel
                                        ? renderCompactBadge(scoutSupport.supportGroupLabel, "neutral")
                                        : null}
                                      {scoutSupport.originLabel
                                        ? renderCompactBadge(scoutSupport.originLabel, "neutral")
                                        : null}
                                      {scoutSupport.strengthLabel
                                        ? renderCompactBadge(scoutSupport.strengthLabel, "support")
                                        : null}
                                    </div>
                                    <p className="mt-2 text-[11px] font-medium text-sky-700">
                                      {scoutSupport.note}
                                    </p>
                                    {renderDownstreamPrioritizationLiftHint(
                                      getActionPlanPrioritizationLiftHint(scoutSupport)
                                    )}
                                    {renderDownstreamPrioritizationLiftReasonLine(
                                      getActionPlanPrioritizationLiftReasonLine(scoutSupport)
                                    )}
                                    {renderDownstreamMixedSupportDrillIn(scoutSupport.supportGroupLabel)}
                                    {renderDownstreamScoutScoreNote(scoutSupport.scoreNote)}
                                  </div>
                                ) : null}
                                {candidate.feedbackHint ? (
                                  <p
                                    className={`mt-2 text-[11px] font-medium ${
                                      candidate.feedbackHintKind === "avoid"
                                        ? "text-amber-700"
                                        : "text-emerald-700"
                                    }`}
                                  >
                                    {candidate.feedbackHint}
                                  </p>
                                ) : null}
                                {savedDecisionItemsById.has(candidate.id) &&
                                candidate.suggestedAction === "generate_post_candidate" ? (
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    <button
                                      aria-label={`Send growth candidate ${candidate.id} to post generator`}
                                      className="rounded-lg border border-border px-2 py-1 text-xs font-medium"
                                      onClick={() => handleGrowthRhythmPostCandidate(candidate)}
                                      type="button"
                                    >
                                      Send to Post Generator
                                    </button>
                                    <button
                                      aria-label={`Open saved item ${candidate.id} from action plan`}
                                      className="rounded-lg border border-border px-2 py-1 text-xs font-medium text-slate-600"
                                      onClick={() =>
                                        handleOpenSavedDecisionItem(candidate.id, "growth_rhythm")
                                      }
                                      type="button"
                                    >
                                      Open saved item
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            );
                          })
                        ) : (
                          <p className="text-sm text-slate-500">No strong post candidates yet.</p>
                        )}
                      </div>
                    </div>
                    <div className="rounded-lg border border-border bg-white p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                        Top comment opportunities
                      </p>
                      <div className="mt-3 space-y-3">
                        {prioritizedGrowthRhythmPlan.topCommentCandidates.length > 0 ? (
                          prioritizedGrowthRhythmPlan.topCommentCandidates.map((candidate) => {
                            const scoutSupport = actionPlanScoutSupportByCandidateId.get(candidate.id);

                            return (
                              <div key={candidate.id} className="rounded-lg border border-border p-3">
                                <p className="text-sm font-medium">{candidate.title}</p>
                                <p className="mt-1 text-xs text-slate-500">
                                  {candidate.suggestedAction} · {candidate.priority} · {candidate.status}
                                </p>
                                {candidate.reasoningSummary ? (
                                  <p className="mt-2 text-xs text-slate-600">
                                    {candidate.reasoningSummary}
                                  </p>
                                ) : null}
                                {candidate.memoryBadge ? (
                                  <div className="mt-2">
                                    {renderCompactBadge(
                                      candidate.memoryBadge,
                                      candidate.memoryBadgeKind === "avoid" ? "avoid" : "repeat"
                                    )}
                                  </div>
                                ) : null}
                                {scoutSupport ? (
                                  <div className="mt-2">
                                    <div className="flex flex-wrap items-center gap-2">
                                      {renderCompactBadge(scoutSupport.badge, scoutSupport.badgeKind)}
                                      {scoutSupport.supportGroupLabel
                                        ? renderCompactBadge(scoutSupport.supportGroupLabel, "neutral")
                                        : null}
                                      {scoutSupport.originLabel
                                        ? renderCompactBadge(scoutSupport.originLabel, "neutral")
                                        : null}
                                      {scoutSupport.strengthLabel
                                        ? renderCompactBadge(scoutSupport.strengthLabel, "support")
                                        : null}
                                    </div>
                                    <p className="mt-2 text-[11px] font-medium text-sky-700">
                                      {scoutSupport.note}
                                    </p>
                                    {renderDownstreamPrioritizationLiftHint(
                                      getActionPlanPrioritizationLiftHint(scoutSupport)
                                    )}
                                    {renderDownstreamPrioritizationLiftReasonLine(
                                      getActionPlanPrioritizationLiftReasonLine(scoutSupport)
                                    )}
                                    {renderDownstreamMixedSupportDrillIn(scoutSupport.supportGroupLabel)}
                                    {renderDownstreamScoutScoreNote(scoutSupport.scoreNote)}
                                  </div>
                                ) : null}
                                {candidate.feedbackHint ? (
                                  <p
                                    className={`mt-2 text-[11px] font-medium ${
                                      candidate.feedbackHintKind === "avoid"
                                        ? "text-amber-700"
                                        : "text-emerald-700"
                                    }`}
                                  >
                                    {candidate.feedbackHint}
                                  </p>
                                ) : null}
                                {savedDecisionItemsById.has(candidate.id) ? (
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    {candidate.suggestedAction === "generate_comment" ? (
                                      <button
                                        aria-label={`Send growth candidate ${candidate.id} to comment writer`}
                                        className="rounded-lg border border-border px-2 py-1 text-xs font-medium"
                                        onClick={() => handleGrowthRhythmCommentCandidate(candidate)}
                                        type="button"
                                      >
                                        Send to Comment Writer
                                      </button>
                                    ) : null}
                                    {candidate.suggestedAction === "generate_reply" &&
                                    savedDecisionItemsById.get(candidate.id)?.postContext ? (
                                      <button
                                        aria-label={`Send growth candidate ${candidate.id} to reply writer`}
                                        className="rounded-lg border border-border px-2 py-1 text-xs font-medium"
                                        onClick={() => handleGrowthRhythmReplyCandidate(candidate)}
                                        type="button"
                                      >
                                        Send to Reply Writer
                                      </button>
                                    ) : null}
                                    <button
                                      aria-label={`Open saved item ${candidate.id} from action plan`}
                                      className="rounded-lg border border-border px-2 py-1 text-xs font-medium text-slate-600"
                                      onClick={() =>
                                        handleOpenSavedDecisionItem(candidate.id, "growth_rhythm")
                                      }
                                      type="button"
                                    >
                                      Open saved item
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            );
                          })
                        ) : (
                          <p className="text-sm text-slate-500">
                            No strong comment opportunities yet.
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="rounded-lg border border-border bg-white p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                        Keep for later
                      </p>
                      <div className="mt-3 space-y-3">
                        {prioritizedGrowthRhythmPlan.keepForLater.length > 0 ? (
                          prioritizedGrowthRhythmPlan.keepForLater.map((candidate) => {
                            const scoutSupport = actionPlanScoutSupportByCandidateId.get(candidate.id);

                            return (
                              <div key={candidate.id} className="rounded-lg border border-border p-3">
                                <p className="text-sm font-medium">{candidate.title}</p>
                                <p className="mt-1 text-xs text-slate-500">
                                  {candidate.suggestedAction} · {candidate.priority} · {candidate.status}
                                </p>
                                {candidate.reasoningSummary ? (
                                  <p className="mt-2 text-xs text-slate-600">
                                    {candidate.reasoningSummary}
                                  </p>
                                ) : null}
                                {candidate.memoryBadge ? (
                                  <div className="mt-2">
                                    {renderCompactBadge(
                                      candidate.memoryBadge,
                                      candidate.memoryBadgeKind === "avoid" ? "avoid" : "repeat"
                                    )}
                                  </div>
                                ) : null}
                                {scoutSupport ? (
                                  <div className="mt-2">
                                    <div className="flex flex-wrap items-center gap-2">
                                      {renderCompactBadge(scoutSupport.badge, scoutSupport.badgeKind)}
                                      {scoutSupport.supportGroupLabel
                                        ? renderCompactBadge(scoutSupport.supportGroupLabel, "neutral")
                                        : null}
                                      {scoutSupport.originLabel
                                        ? renderCompactBadge(scoutSupport.originLabel, "neutral")
                                        : null}
                                      {scoutSupport.strengthLabel
                                        ? renderCompactBadge(scoutSupport.strengthLabel, "support")
                                        : null}
                                    </div>
                                    <p className="mt-2 text-[11px] font-medium text-sky-700">
                                      {scoutSupport.note}
                                    </p>
                                    {renderDownstreamPrioritizationLiftHint(
                                      getActionPlanPrioritizationLiftHint(scoutSupport)
                                    )}
                                    {renderDownstreamPrioritizationLiftReasonLine(
                                      getActionPlanPrioritizationLiftReasonLine(scoutSupport)
                                    )}
                                    {renderDownstreamMixedSupportDrillIn(scoutSupport.supportGroupLabel)}
                                    {renderDownstreamScoutScoreNote(scoutSupport.scoreNote)}
                                  </div>
                                ) : null}
                                {candidate.feedbackHint ? (
                                  <p
                                    className={`mt-2 text-[11px] font-medium ${
                                      candidate.feedbackHintKind === "avoid"
                                        ? "text-amber-700"
                                        : "text-emerald-700"
                                    }`}
                                  >
                                    {candidate.feedbackHint}
                                  </p>
                                ) : null}
                                {savedDecisionItemsById.has(candidate.id) ? (
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    <button
                                      aria-label={`Open saved item ${candidate.id} from action plan`}
                                      className="rounded-lg border border-border px-2 py-1 text-xs font-medium text-slate-600"
                                      onClick={() =>
                                        handleOpenSavedDecisionItem(candidate.id, "growth_rhythm")
                                      }
                                      type="button"
                                    >
                                      Open saved item
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            );
                          })
                        ) : (
                          <p className="text-sm text-slate-500">Nothing urgent to revisit later.</p>
                        )}
                      </div>
                    </div>
                    <div className="rounded-lg border border-border bg-slate-50 p-4 xl:col-span-3">
                      <div className="grid gap-3 xl:grid-cols-2">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                            Weekly focus
                          </p>
                          <p className="mt-2 text-sm text-slate-700">
                            {prioritizedGrowthRhythmPlan.weeklyFocus}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                            Suggested cadence
                          </p>
                          <p className="mt-2 text-sm text-slate-700">
                            {prioritizedGrowthRhythmPlan.suggestedCadence}
                          </p>
                        </div>
                      </div>
                      <p className="mt-3 text-sm text-slate-600">
                        {prioritizedGrowthRhythmPlan.reasoningSummary}
                      </p>
                    <div className="mt-4 rounded-lg border border-slate-200 bg-white px-3 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                          Feedback loop
                      </p>
                      {renderFeedbackThemeTags()}
                      {feedbackSummary.totalRecords > 0 ? (
                        <div className="mt-2 space-y-2 text-sm text-slate-700">
                          <p>{feedbackSummary.reasoningSummary}</p>
                            {feedbackSummary.strongPatterns.length > 0 ? (
                              <p>
                                <span className="font-medium">What seems to work:</span>{" "}
                                {feedbackSummary.strongPatterns.join(" ")}
                              </p>
                            ) : null}
                            {feedbackSummary.weakPatterns.length > 0 ? (
                              <p>
                                <span className="font-medium">What seems weaker:</span>{" "}
                                {feedbackSummary.weakPatterns.join(" ")}
                              </p>
                            ) : null}
                            {feedbackSummary.suggestedRepeats.length > 0 ? (
                              <p>
                                <span className="font-medium">What to repeat next week:</span>{" "}
                                {feedbackSummary.suggestedRepeats.join(" ")}
                              </p>
                            ) : null}
                            {feedbackSummary.suggestedAvoids.length > 0 ? (
                              <p>
                                <span className="font-medium">What to avoid:</span>{" "}
                                {feedbackSummary.suggestedAvoids.join(" ")}
                              </p>
                            ) : null}
                          </div>
                        ) : (
                          <p className="mt-2 text-sm text-slate-600">
                            No manual outcome feedback yet.
                          </p>
                        )}
                      </div>
                      {renderPatternMemoryBlock()}
                      {growthRhythmActionMessage ? (
                        <p className="mt-3 text-sm text-slate-700">{growthRhythmActionMessage}</p>
                      ) : null}
                      {manualFeedbackMessage ? (
                        <p className="mt-2 text-sm text-slate-700">{manualFeedbackMessage}</p>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-slate-500">
                    No rhythm plan yet. Use current queue and saved planner items to generate a compact weekly plan.
                  </p>
                )}
              </Card>
            </section>

            <section className="mt-6">
              <Card role="region" aria-label="Review and triage console">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Layers3 className="h-5 w-5 text-slate-600" />
                    <div>
                      <p className="text-sm text-muted">Review & Triage Console</p>
                      <h3 className="text-lg font-semibold">
                        {matchedOpportunities.length} matched · {reviewQueueItems.length} review items
                      </h3>
                    </div>
                  </div>
                </div>
                <div className="mt-4 space-y-3">
                  <SectionErrorMessage
                    error={loadErrors.reviewTriage}
                    label="Review and triage console"
                  />
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <label className="block text-sm text-slate-700">
                      <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        Review state
                      </span>
                      <select
                        aria-label="Review and triage review state filter"
                        className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                        disabled={loadingReviewTriage}
                        onChange={(event) =>
                          void handleChangeReviewTriageReviewStateFilter(
                            event.target.value as ReviewTriageReviewStateFilter
                          )
                        }
                        value={reviewTriageReviewStateFilter}
                      >
                        <option value="all">all</option>
                        <option value="new">new</option>
                        <option value="in_review">in_review</option>
                        <option value="saved">saved</option>
                        <option value="dismissed">dismissed</option>
                        <option value="archived">archived</option>
                      </select>
                    </label>
                  </div>
                  {loadingReviewTriage ? (
                    <p className="text-sm text-slate-600">Refreshing review and triage console...</p>
                  ) : null}
                  {!loadErrors.reviewTriage &&
                  reviewQueueItems.length === 0 &&
                  matchedOpportunities.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-slate-600">
                      {reviewTriageReviewStateFilter === "all"
                        ? "No server-side review backlog or matched opportunities yet."
                        : "No prioritized matched opportunities match the current review state filter."}
                    </div>
                  ) : null}
                  {reviewQueueItems.length > 0 ? (
                    <div className="rounded-lg border border-border p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        Review queue
                      </p>
                      <div className="mt-3 space-y-3">
                        {reviewQueueItems.map((item) => (
                          <div key={item.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                            <div className="flex flex-wrap gap-2">
                              {renderCompactBadge(
                                formatOperationalLabel(item.recommendedAction),
                                "support"
                              )}
                              {renderCompactBadge(formatOperationalLabel(item.status), "neutral")}
                            </div>
                            <h4 className="mt-3 font-medium">{item.title}</h4>
                            <p className="mt-1 text-sm text-slate-600">{item.summary}</p>
                            <p className="mt-2 text-xs text-slate-500">
                              Source kind: {formatOperationalLabel(item.sourceKind)} · Watchlist:{" "}
                              {item.watchlistId}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">{item.rationale}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {matchedOpportunities.length > 0 ? (
                    <div className="rounded-lg border border-border p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        Matched opportunities
                      </p>
                      <div className="mt-3 space-y-3">
                        {matchedOpportunities.map((item) => {
                          const isSelected = selectedMatchedOpportunityId === item.id;
                          const canPromote =
                            item.reviewState === "in_review" || item.reviewState === "saved";

                          return (
                            <div
                              key={item.id}
                              className="rounded-lg border border-slate-200 bg-slate-50 p-3"
                              data-testid={`matched-opportunity-${item.id}`}
                            >
                              <div className="flex flex-wrap gap-2">
                                {renderCompactBadge(
                                  formatOperationalLabel(item.recommendedAction),
                                  "support"
                                )}
                                {renderCompactBadge(
                                  formatOperationalLabel(item.reviewState),
                                  getMatchedOpportunityReviewStateBadgeKind(item.reviewState)
                                )}
                                {renderCompactBadge(
                                  formatOperationalLabel(item.priorityBand),
                                  getPriorityBandBadgeKind(item.priorityBand)
                                )}
                              </div>
                              <h4 className="mt-3 font-medium">{item.title}</h4>
                              <p className="mt-1 text-sm text-slate-600">{item.matchedPain}</p>
                              <p className="mt-1 text-xs text-slate-500">
                                {item.matchedSolutionPattern}
                              </p>
                              <p className="mt-2 text-xs text-slate-500">
                                Priority score: {item.priorityScore} · Watchlist: {item.watchlistId}
                              </p>
                              <button
                                aria-label={`View details for matched opportunity ${item.title}`}
                                className="mt-3 rounded-lg border border-border px-3 py-2 text-sm font-medium"
                                data-testid={`matched-opportunity-details-${item.id}`}
                                onClick={() => handleOpenMatchedOpportunityDetails(item.id)}
                                type="button"
                              >
                                View details
                              </button>
                              {isSelected ? (
                                <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                                  <div className="space-y-2 text-sm text-slate-700">
                                    <div className="flex flex-wrap gap-2">
                                      {renderCompactBadge(
                                        formatOperationalLabel(item.reviewState),
                                        getMatchedOpportunityReviewStateBadgeKind(item.reviewState)
                                      )}
                                      {item.opportunityStrength
                                        ? renderCompactBadge(
                                            formatOperationalLabel(item.opportunityStrength),
                                            getPriorityBandBadgeKind(item.priorityBand)
                                          )
                                        : null}
                                    </div>
                                    <div>
                                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                                        Match rationale
                                      </p>
                                      <p className="mt-1">{item.matchRationale}</p>
                                    </div>
                                    <div>
                                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                                        Reason lines
                                      </p>
                                      <div className="mt-1 space-y-1">
                                        {item.reasonLines.map((reasonLine) => (
                                          <p key={reasonLine}>{reasonLine}</p>
                                        ))}
                                      </div>
                                    </div>
                                    <div>
                                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                                        Source linkage
                                      </p>
                                      <p className="mt-1">
                                        Watchlist: {item.watchlistId} · Audience queue:{" "}
                                        {item.audienceQueueItemId} · Solution queue:{" "}
                                        {item.solutionQueueItemId}
                                      </p>
                                    </div>
                                    <label className="block text-sm text-slate-700">
                                      <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                                        Matched opportunity review state
                                      </span>
                                      <select
                                        aria-label="Matched opportunity review state"
                                        className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                                        disabled={savingMatchedOpportunityReviewState}
                                        onChange={(event) =>
                                          setMatchedOpportunityReviewStateSelection(
                                            event.target.value as MatchedOpportunityReviewStateOption
                                          )
                                        }
                                        value={matchedOpportunityReviewStateSelection}
                                      >
                                        <option value="new">new</option>
                                        <option value="in_review">in_review</option>
                                        <option value="saved">saved</option>
                                        <option value="dismissed">dismissed</option>
                                        <option value="archived">archived</option>
                                      </select>
                                    </label>
                                    <div className="flex flex-wrap gap-2">
                                      <button
                                        className="rounded-lg border border-border px-3 py-2 text-sm font-medium"
                                        disabled={savingMatchedOpportunityReviewState}
                                        onClick={() => void handleApplyMatchedOpportunityReviewState()}
                                        type="button"
                                      >
                                        {savingMatchedOpportunityReviewState
                                          ? "Applying..."
                                          : "Apply review state"}
                                      </button>
                                      <button
                                        className="rounded-lg border border-border px-3 py-2 text-sm font-medium"
                                        disabled={promotingMatchedOpportunity || !canPromote}
                                        onClick={() => void handlePromoteMatchedOpportunity()}
                                        type="button"
                                      >
                                        {promotingMatchedOpportunity
                                          ? "Promoting..."
                                          : "Promote to content workspace"}
                                      </button>
                                    </div>
                                    {matchedOpportunityActionError ? (
                                      <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                                        <p className="font-medium">
                                          {matchedOpportunityActionError.method === "PATCH"
                                            ? "Triage update failed"
                                            : "Promotion failed"}
                                          : {matchedOpportunityActionError.method}{" "}
                                          {matchedOpportunityActionError.endpoint}
                                        </p>
                                        <p className="mt-1 text-xs">
                                          Status: {matchedOpportunityActionError.status ?? "network error"}
                                        </p>
                                        <p className="mt-1 text-xs">
                                          {matchedOpportunityActionError.responseBody ??
                                            matchedOpportunityActionError.message}
                                        </p>
                                      </div>
                                    ) : null}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
              </Card>
            </section>

            <section
              className={`mt-6 grid gap-6 ${
                isOperatorDayOneMode
                  ? "xl:grid-cols-[0.95fr_1.05fr_1.1fr]"
                  : "xl:grid-cols-[1.05fr_0.95fr_1.2fr]"
              }`}
            >
              <Card role="region" aria-label="Supervised MVP launch package">
                <div className="flex items-center gap-2">
                  <Bookmark className="h-5 w-5 text-slate-600" />
                  <div>
                    <p className="text-sm text-muted">Launch Boundary</p>
                    <h3 className="text-lg font-semibold">Supervised MVP Launch Package</h3>
                  </div>
                </div>
                <div className="mt-4 space-y-3">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        Go-live verdict
                      </p>
                      {renderCompactBadge(
                        supervisedMvpGoLiveChecklist.verdict.label,
                        supervisedMvpGoLiveChecklist.verdict.kind
                      )}
                    </div>
                    <p className="mt-3 text-sm text-slate-700">
                      {supervisedMvpGoLiveChecklist.verdict.summary}
                    </p>
                    {supervisedMvpGoLiveChecklist.blockers.length > 0 ? (
                      <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700">
                          Launch blockers
                        </p>
                        <div className="mt-2 space-y-2 text-sm text-amber-800">
                          {supervisedMvpGoLiveChecklist.blockers.map((item) => (
                            <p key={item}>{item}</p>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {supervisedMvpGoLiveChecklist.warnings.length > 0 ? (
                      <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                          Launch warnings
                        </p>
                        <div className="mt-2 space-y-2 text-sm text-slate-700">
                          {supervisedMvpGoLiveChecklist.warnings.map((item) => (
                            <p key={item}>{item}</p>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                      Required before first real use
                    </p>
                    <div className="mt-3 space-y-2">
                      {supervisedMvpGoLiveChecklist.requiredItems.map((item) => (
                        <div
                          key={item.label}
                          className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2"
                        >
                          <p className="text-sm text-slate-700">{item.label}</p>
                          {renderCompactBadge(item.statusLabel, item.statusKind)}
                        </div>
                      ))}
                    </div>
                    {launchConsoleOperatorAuthConfig &&
                    !launchConsoleOperatorAuthConfig.configured ? (
                      <p className="mt-3 text-xs text-amber-700">
                        Missing auth config:{" "}
                        {launchConsoleOperatorAuthConfig.missingConfigKeys.join(", ")}
                      </p>
                    ) : null}
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                      Recommended before launch
                    </p>
                    <div className="mt-3 space-y-2">
                      {supervisedMvpGoLiveChecklist.recommendedItems.map((item) => (
                        <div
                          key={item.label}
                          className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2"
                        >
                          <p className="text-sm text-slate-700">{item.label}</p>
                          {renderCompactBadge(item.statusLabel, item.statusKind)}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                      Fallback-safe operation
                    </p>
                    <div className="mt-3 space-y-2 text-sm text-slate-700">
                      <p>
                        Fallback-ready is acceptable for the supervised MVP if operator auth is
                        configured, launch preflight is not blocked, and all review, workspace, and
                        draft actions remain operator-driven.
                      </p>
                      <p>No unattended promotion, posting, or external execution is part of go-live.</p>
                    </div>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        In scope now
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                      {SUPERVISED_MVP_IN_SCOPE.map((item) => (
                        <div key={item}>{renderCompactBadge(item, "support")}</div>
                      ))}
                      </div>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        Required runtime config
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                      {SUPERVISED_MVP_REQUIRED_CONFIG.map((item) => (
                        <div key={item}>{renderCompactBadge(item, "neutral")}</div>
                      ))}
                      </div>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                      Out of scope for launch
                    </p>
                    <div className="mt-3 space-y-2 text-sm text-slate-700">
                      {SUPERVISED_MVP_OUT_OF_SCOPE.map((item) => (
                        <p key={item}>{item}</p>
                      ))}
                    </div>
                  </div>
                </div>
              </Card>

              <Card role="region" aria-label="Launch console">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Radar className="h-5 w-5 text-slate-600" />
                    <div>
                      <p className="text-sm text-muted">Launch Console</p>
                      <h3 className="text-lg font-semibold">
                        {launchPreflight ? formatOperationalLabel(launchPreflight.launchStatus) : "status"}
                      </h3>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="rounded-lg border border-border px-3 py-2 text-sm font-medium"
                      disabled={probingProvider}
                      onClick={() => void handleRunProviderProbe()}
                      type="button"
                    >
                      {probingProvider ? "Probing..." : "Run provider probe"}
                    </button>
                    <button
                      className="rounded-lg border border-border px-3 py-2 text-sm font-medium"
                      disabled={runningLaunchSmokeRun}
                      onClick={() => void handleRunLaunchSmokeRun()}
                      type="button"
                    >
                      {runningLaunchSmokeRun ? "Running smoke..." : "Run launch smoke run"}
                    </button>
                  </div>
                </div>
                <div className="mt-4 space-y-3">
                  <SectionErrorMessage error={loadErrors.launchConsole} label="Launch console" />
                  <div className="rounded-lg border border-border p-3 text-sm text-slate-700">
                    <div className="grid gap-2 md:grid-cols-2">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                          Provider mode
                        </p>
                        <p className="mt-1">{aiRuntimeHealth?.providerMode ?? "unavailable"}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                          Config status
                        </p>
                        <p className="mt-1">
                          {aiRuntimeHealth ? formatOperationalLabel(aiRuntimeHealth.configStatus) : "unavailable"}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                          AI active
                        </p>
                        <p className="mt-1">{aiRuntimeHealth ? (aiRuntimeHealth.aiActive ? "yes" : "no") : "unknown"}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                          Fallback active
                        </p>
                        <p className="mt-1">
                          {aiRuntimeHealth ? (aiRuntimeHealth.fallbackActive ? "yes" : "no") : "unknown"}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                          Scheduler runtime
                        </p>
                        <p className="mt-1">
                          {aiRuntimeHealth
                            ? aiRuntimeHealth.schedulerRuntimeEnabled
                              ? "enabled"
                              : "disabled"
                            : "unknown"}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                          Text provider
                        </p>
                        <p className="mt-1">{aiRuntimeHealth?.textProvider ?? "none"}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                          Operator auth config
                        </p>
                        <p className="mt-1">
                          {aiRuntimeHealth?.operatorAuthConfig
                            ? aiRuntimeHealth.operatorAuthConfig.configured
                              ? "present"
                              : "missing"
                            : "unknown"}
                        </p>
                      </div>
                    </div>
                  </div>
                  {launchConsoleOperatorAuthConfig && !launchConsoleOperatorAuthConfig.configured ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                      <p className="font-medium">
                        Missing auth config: {launchConsoleOperatorAuthConfig.missingConfigKeys.join(", ")}
                      </p>
                    </div>
                  ) : null}
                  {launchPreflight ? (
                    <div className="rounded-lg border border-border p-3 text-sm text-slate-700">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        Launch status
                      </p>
                      <p className="mt-1">{formatOperationalLabel(launchPreflight.launchStatus)}</p>
                    </div>
                  ) : null}
                  {!aiRuntimeHealth && !launchPreflight && !loadErrors.launchConsole ? (
                    <p className="text-sm text-slate-600">Launch status unavailable.</p>
                  ) : null}
                  {providerProbeResult ? (
                    <div className="rounded-lg border border-border p-3 text-sm text-slate-700">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        Probe status
                      </p>
                      <p className="mt-1">{providerProbeResult.probeStatus}</p>
                      <p className="mt-1">{providerProbeResult.probeMessage}</p>
                    </div>
                  ) : null}
                  {providerProbeError ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                      <p className="font-medium">
                        Provider probe failed: {providerProbeError.method} {providerProbeError.endpoint}
                      </p>
                      <p className="mt-1 text-xs">
                        Status: {providerProbeError.status ?? "network error"}
                      </p>
                      <p className="mt-1 text-xs">
                        {providerProbeError.responseBody ?? providerProbeError.message}
                      </p>
                    </div>
                  ) : null}
                  {launchSmokeRunResult ? (
                    <div className="rounded-lg border border-border p-3 text-sm text-slate-700">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        Smoke run verdict
                      </p>
                      <p className="mt-1">
                        {formatOperationalLabel(launchSmokeRunResult.launchStatus)}
                      </p>
                      <p className="mt-1">
                        Runnable: {launchSmokeRunResult.runnable ? "yes" : "no"}
                      </p>
                      <p className="mt-1">
                        Artifacts: {launchSmokeRunResult.artifactCounts.ingestionArtifacts} ingestion,{" "}
                        {launchSmokeRunResult.artifactCounts.reviewQueueItems} review,{" "}
                        {launchSmokeRunResult.artifactCounts.matchedOpportunities} matched,{" "}
                        {launchSmokeRunResult.artifactCounts.prioritizedOpportunities} prioritized,{" "}
                        {launchSmokeRunResult.artifactCounts.contentWorkItems} work items,{" "}
                        {launchSmokeRunResult.artifactCounts.draftDocuments} drafts
                      </p>
                    </div>
                  ) : null}
                  {launchSmokeRunError ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                      <p className="font-medium">
                        Launch smoke run failed: {launchSmokeRunError.method}{" "}
                        {launchSmokeRunError.endpoint}
                      </p>
                      <p className="mt-1 text-xs">
                        Status: {launchSmokeRunError.status ?? "network error"}
                      </p>
                      <p className="mt-1 text-xs">
                        {launchSmokeRunError.responseBody ?? launchSmokeRunError.message}
                      </p>
                    </div>
                  ) : null}
                </div>
              </Card>

              <Card>
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-slate-600" />
                  <div>
                    <p className="text-sm text-muted">Analytics</p>
                    <h3 className="text-lg font-semibold">{counts.analytics}</h3>
                  </div>
                </div>
                <form className="mt-4 space-y-3" onSubmit={handleRecordAnalytics}>
                  <div>
                    <label className="text-sm font-medium" htmlFor="analytics-content">
                      Analytics content
                    </label>
                    <select
                      id="analytics-content"
                      className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      value={analyticsForm.contentAssetId}
                      onChange={(event) =>
                        setAnalyticsForm((current) => ({
                          ...current,
                          contentAssetId: event.target.value
                        }))
                      }
                    >
                      <option value="">select content</option>
                      {contentAssets.map((asset) => (
                        <option key={asset.id} value={asset.id}>
                          {asset.id}
                        </option>
                      ))}
                    </select>
                  </div>
                  {(
                    [
                      ["Impressions", "impressions"],
                      ["Likes", "likes"],
                      ["Comments", "comments"],
                      ["Saves", "saves"],
                      ["Profile views", "profileViews"],
                      ["Followers gained", "followersGained"],
                      ["Reactions", "reactions"],
                      ["Reposts", "reposts"],
                      ["Inbound leads", "inboundLeads"]
                    ] as const
                  ).map(([label, field]) => (
                    <div key={field}>
                      <label className="text-sm font-medium" htmlFor={field}>
                        {label}
                      </label>
                      <input
                        id={field}
                        className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                        inputMode="numeric"
                        type="number"
                        value={analyticsForm[field]}
                        onChange={(event) =>
                          setAnalyticsForm((current) => ({
                            ...current,
                            [field]: Number(event.target.value)
                          }))
                        }
                      />
                    </div>
                  ))}
                  <div>
                    <label className="text-sm font-medium" htmlFor="postUrl">
                      Post URL
                    </label>
                    <input
                      id="postUrl"
                      className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      type="text"
                      value={analyticsForm.postUrl}
                      onChange={(event) =>
                        setAnalyticsForm((current) => ({
                          ...current,
                          postUrl: event.target.value
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium" htmlFor="publishedAt">
                      Published At (ISO date)
                    </label>
                    <input
                      id="publishedAt"
                      className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      type="datetime-local"
                      value={analyticsForm.publishedAt?.replace("Z", "").slice(0, 16)}
                      onChange={(event) =>
                        setAnalyticsForm((current) => ({
                          ...current,
                          publishedAt: event.target.value ? new Date(event.target.value).toISOString() : ""
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium" htmlFor="qualitativeNotes">
                      Qualitative Notes (what worked? what didn't?)
                    </label>
                    <textarea
                      id="qualitativeNotes"
                      className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      rows={3}
                      value={analyticsForm.qualitativeNotes}
                      onChange={(event) =>
                        setAnalyticsForm((current) => ({
                          ...current,
                          qualitativeNotes: event.target.value
                        }))
                      }
                      placeholder="e.g., Strong resonance with founder audience. Concrete operational examples landed well."
                    />
                  </div>
                  <button
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                    disabled={submittingAnalytics}
                    type="submit"
                  >
                    {submittingAnalytics ? "Saving..." : "Record Analytics"}
                  </button>
                </form>
                <div className="mt-4 space-y-3">
                  <SectionErrorMessage error={loadErrors.analytics} label="Analytics" />
                  {analyticsSnapshots.map((snapshot) => (
                    <div key={snapshot.id} className="rounded-lg border border-border p-3">
                      <h4 className="font-medium">{snapshot.contentAssetId}</h4>
                      <p className="mt-1 text-sm text-slate-600">
                        {snapshot.impressions} impressions
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {snapshot.likes} likes, {snapshot.comments} comments, {snapshot.saves} saves
                      </p>
                    </div>
                  ))}
                </div>
              </Card>

              <Card role="region" aria-label="Server draft queue">
                <div className="flex items-center gap-2">
                  <PenSquare className="h-5 w-5 text-slate-600" />
                  <div>
                    <p className="text-sm text-muted">Server Draft Queue</p>
                    <h3 className="text-lg font-semibold">{counts.draftQueue}</h3>
                  </div>
                </div>
                <div className="mt-4 space-y-3">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="block text-sm text-slate-700">
                        <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                          Draft status
                        </span>
                        <select
                          aria-label="Draft queue status filter"
                          className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                          disabled={autonomousContentAssets.length === 0 && Boolean(loadErrors.autonomousContentAssets)}
                          onChange={(event) =>
                            void handleChangeDraftQueueControls({
                              status: event.target.value as DraftQueueStatusFilter
                            })
                          }
                          value={draftQueueStatusFilter}
                        >
                          <option value="all">all</option>
                          <option value="draft">draft</option>
                          <option value="ready">ready</option>
                          <option value="blocked">blocked</option>
                          <option value="archived">archived</option>
                        </select>
                      </label>
                      <label className="block text-sm text-slate-700">
                        <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                          Sort
                        </span>
                        <select
                          aria-label="Draft queue sort"
                          className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                          disabled={autonomousContentAssets.length === 0 && Boolean(loadErrors.autonomousContentAssets)}
                          onChange={(event) =>
                            void handleChangeDraftQueueControls({
                              sort: event.target.value as DraftQueueSortOption
                            })
                          }
                          value={draftQueueSort}
                        >
                          <option value="updated_desc">updated_desc</option>
                          <option value="updated_asc">updated_asc</option>
                          <option value="status">status</option>
                        </select>
                      </label>
                    </div>
                  </div>
                  <SectionErrorMessage error={loadErrors.autonomousContentAssets} label="Server draft queue" />
                  {!loadErrors.autonomousContentAssets && autonomousContentAssets.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-slate-600">
                      {draftQueueStatusFilter === "all"
                        ? "No server-side drafts yet."
                        : "No server-side drafts match the current filter."}
                    </div>
                  ) : null}
                  {(() => {
                    // Apply client-side filtering and sorting
                    let filtered = autonomousContentAssets;
                    if (draftQueueStatusFilter !== "all") {
                      filtered = filtered.filter(d => {
                        const status = d.contentStatus;
                        if (draftQueueStatusFilter === "blocked") return status === "review";
                        return status === draftQueueStatusFilter;
                      });
                    }

                    const sorted = [...filtered].sort((a, b) => {
                      if (draftQueueSort === "updated_desc") {
                        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
                      } else if (draftQueueSort === "updated_asc") {
                        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
                      } else {
                        return (a.contentStatus || "").localeCompare(b.contentStatus || "");
                      }
                    });

                    return sorted.map((draft) => {
                    const isSelected = selectedDraftDocumentId === draft.id;
                    const isSelectedSourceWorkItem =
                      selectedContentWorkspaceItemId === draft.sourceContentWorkItemId;

                    return (
                      <div
                        key={draft.id}
                        className="rounded-lg border border-border p-3"
                        data-testid={`draft-queue-item-${draft.id}`}
                      >
                        <div className="flex flex-wrap gap-2">
                          {renderCompactBadge(formatOperationalLabel(draft.contentStatus || "draft"), "support")}
                          {draft.bestAngle ? renderCompactBadge("Angle set", "neutral") : null}
                        </div>
                        <h4 className="mt-3 font-medium">{draft.hook}</h4>
                        {draft.bestAngle ? (
                          <p className="mt-1 text-sm text-slate-600">Angle: {draft.bestAngle}</p>
                        ) : null}
                        {draft.body ? (
                          <p className="mt-1 text-sm text-slate-600">{draft.body.slice(0, 120)}{draft.body.length > 120 ? "..." : ""}</p>
                        ) : null}
                        <p className="mt-1 text-xs text-slate-500">
                          Source work item: {draft.sourceContentWorkItemId}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          Created: {new Date(draft.createdAt).toLocaleString()}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            aria-label={`View draft queue item ${draft.id}`}
                            className="rounded-lg border border-border px-3 py-2 text-sm font-medium"
                            disabled={loadingDraftDocument && isSelected}
                            onClick={() => void handleOpenDraftDocument(draft.id)}
                            type="button"
                          >
                            {loadingDraftDocument && isSelected ? "Loading..." : "View draft"}
                          </button>
                          {draft.sourceContentWorkItemId && (
                            <button
                              aria-label={`View source work item ${draft.sourceContentWorkItemId} from draft ${draft.id}`}
                              className="rounded-lg border border-border px-3 py-2 text-sm font-medium"
                              disabled={loadingContentWorkspaceItem && isSelectedSourceWorkItem}
                              onClick={() =>
                                void handleOpenContentWorkspaceItem(draft.sourceContentWorkItemId!)
                              }
                              type="button"
                            >
                              {loadingContentWorkspaceItem && isSelectedSourceWorkItem
                                ? "Loading source..."
                                : "View source work item"}
                            </button>
                          )}
                        </div>
                        {isSelected ? (
                          <div className="mt-3">
                            {renderSelectedDraftDocumentPanel("Loading draft queue item...")}
                          </div>
                        ) : null}
                        {isSelectedSourceWorkItem ? (
                          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                            {loadingContentWorkspaceItem ? (
                              <p className="text-sm text-slate-600">Loading source work item...</p>
                            ) : selectedContentWorkspaceItemError ? (
                              <div className="text-sm text-amber-800">
                                <p className="font-medium">
                                  Source work item inspection failed:{" "}
                                  {selectedContentWorkspaceItemError.method}{" "}
                                  {selectedContentWorkspaceItemError.endpoint}
                                </p>
                                <p className="mt-1 text-xs">
                                  Status: {selectedContentWorkspaceItemError.status ?? "network error"}
                                </p>
                                <p className="mt-1 text-xs">
                                  {selectedContentWorkspaceItemError.responseBody ??
                                    selectedContentWorkspaceItemError.message}
                                </p>
                              </div>
                            ) : selectedContentWorkspaceItem ? (
                              <div className="space-y-2 text-sm text-slate-700">
                                <div>
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                                    Source work item title
                                  </p>
                                  <p className="mt-1">{selectedContentWorkspaceItem.title}</p>
                                </div>
                                <div>
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                                    Source work item status
                                  </p>
                                  <p className="mt-1">{selectedContentWorkspaceItem.status}</p>
                                </div>
                                <div>
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                                    Source summary
                                  </p>
                                  <p className="mt-1">{selectedContentWorkspaceItem.summary}</p>
                                </div>
                                <div>
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                                    Source recommended action
                                  </p>
                                  <p className="mt-1">{selectedContentWorkspaceItem.recommendedAction}</p>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  });
                })()}
                </div>
              </Card>

              <Card>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-slate-600" />
                    <div>
                      <p className="text-sm text-muted">Strategy Recommendations</p>
                      <h3 className="text-lg font-semibold">{counts.strategy}</h3>
                    </div>
                  </div>
                  <button
                    className="rounded-lg border border-border px-3 py-2 text-sm font-medium"
                    disabled={analyzingStrategy}
                    onClick={() => void handleAnalyzeStrategy()}
                    type="button"
                  >
                    {analyzingStrategy ? "Analyzing..." : "Analyze Strategy"}
                  </button>
                </div>
                <div className="mt-4 space-y-3">
                  <SectionErrorMessage
                    error={loadErrors.strategy}
                    label="Strategy recommendations"
                  />
                  {feedbackThemeTags.length > 0 ? (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                        Shared motifs
                      </p>
                      {renderFeedbackThemeTags()}
                    </div>
                  ) : null}
                  {renderPatternMemoryBlock()}
                  {recommendations.map((recommendation) => (
                    <div key={recommendation.id} className="rounded-lg border border-border p-3">
                      {(() => {
                        const badge = getStrategyMemoryBadge(recommendation);

                        if (!badge) {
                          return null;
                        }

                        return (
                          <div className="mb-2">{renderCompactBadge(badge.label, badge.kind)}</div>
                        );
                      })()}
                      <div className="flex items-center justify-between gap-3">
                        <h4 className="font-medium">{recommendation.title}</h4>
                        <span className="text-xs uppercase tracking-[0.16em] text-slate-500">
                          {recommendation.priority}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-slate-600">
                        {recommendation.description}
                      </p>
                    </div>
                  ))}
                </div>
              </Card>
            </section>

            <section className="mt-6 grid gap-6 xl:grid-cols-2">
              <Card>
                <div className="flex items-center gap-2">
                  <PenSquare className="h-5 w-5 text-slate-600" />
                  <div>
                    <p className="text-sm text-muted">Comment Writer</p>
                    <h3 className="text-lg font-semibold">Write a useful comment</h3>
                  </div>
                </div>
                <form className="mt-4 space-y-3" onSubmit={handleGenerateComment}>
                  <div>
                    <label className="text-sm font-medium" htmlFor="comment-source-post">
                      Source post text
                    </label>
                    <textarea
                      id="comment-source-post"
                      className="mt-1 min-h-28 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      value={commentForm.sourcePostText}
                      onChange={(event) =>
                        setCommentForm((current) => ({
                          ...current,
                          sourcePostText: event.target.value
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium" htmlFor="comment-context">
                      Comment positioning context
                    </label>
                    <textarea
                      id="comment-context"
                      className="mt-1 min-h-20 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      value={commentForm.positioningContext ?? ""}
                      onChange={(event) =>
                        setCommentForm((current) => ({
                          ...current,
                          positioningContext: event.target.value
                        }))
                      }
                    />
                  </div>
                  <div className="rounded-lg border border-dashed border-border p-3">
                    <label className="flex items-center gap-2 text-sm font-medium" htmlFor="comment-use-relevance">
                      <input
                        id="comment-use-relevance"
                        checked={commentForm.useRelevanceAdaptation ?? false}
                        onChange={(event) =>
                          setCommentForm((current) => ({
                            ...current,
                            useRelevanceAdaptation: event.target.checked
                          }))
                        }
                        type="checkbox"
                      />
                      Use relevance adaptation for comment
                    </label>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="text-sm font-medium" htmlFor="comment-target-role">
                          Comment target role/title
                        </label>
                        <input
                          id="comment-target-role"
                          className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                          value={commentForm.targetRole ?? ""}
                          onChange={(event) =>
                            setCommentForm((current) => ({
                              ...current,
                              targetRole: event.target.value
                            }))
                          }
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium" htmlFor="comment-company-context">
                          Comment company context
                        </label>
                        <input
                          id="comment-company-context"
                          className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                          value={commentForm.companyContext ?? ""}
                          onChange={(event) =>
                            setCommentForm((current) => ({
                              ...current,
                              companyContext: event.target.value
                            }))
                          }
                        />
                      </div>
                    </div>
                  </div>
                  <button
                    className="rounded-lg border border-border px-3 py-2 text-sm font-medium"
                    disabled={submittingComment}
                    type="submit"
                  >
                    {submittingComment ? "Generating..." : "Generate Comment"}
                  </button>
                </form>
                {generatedComment ? (
                  <div className="mt-4 rounded-lg border border-border bg-white p-3">
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-500">
                      Comment output · {generatedComment.mode}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-slate-700">{generatedComment.text}</p>
                    {generatedComment.engagementMode ? (
                      <div className="mt-3 space-y-1 text-xs text-slate-500">
                        <p>Adaptation: {generatedComment.engagementMode}</p>
                        {generatedComment.appliedAngle ? (
                          <p>Angle: {generatedComment.appliedAngle}</p>
                        ) : null}
                        {generatedComment.shouldGenerate !== undefined ? (
                          <p>Should generate: {generatedComment.shouldGenerate ? "yes" : "no"}</p>
                        ) : null}
                      </div>
                    ) : null}
                    {renderManualFeedbackControls("comment", "generated-comment-latest")}
                  </div>
                ) : null}
              </Card>

              <Card>
                <div className="flex items-center gap-2">
                  <WandSparkles className="h-5 w-5 text-slate-600" />
                  <div>
                    <p className="text-sm text-muted">Reply Writer</p>
                    <h3 className="text-lg font-semibold">Reply in operator voice</h3>
                  </div>
                </div>
                <form className="mt-4 space-y-3" onSubmit={handleGenerateReply}>
                  <div>
                    <label className="text-sm font-medium" htmlFor="reply-our-post">
                      Our post text
                    </label>
                    <textarea
                      id="reply-our-post"
                      className="mt-1 min-h-24 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      value={replyForm.ourPostText}
                      onChange={(event) =>
                        setReplyForm((current) => ({
                          ...current,
                          ourPostText: event.target.value
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium" htmlFor="reply-incoming-comment">
                      Incoming comment text
                    </label>
                    <textarea
                      id="reply-incoming-comment"
                      className="mt-1 min-h-24 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      value={replyForm.incomingCommentText}
                      onChange={(event) =>
                        setReplyForm((current) => ({
                          ...current,
                          incomingCommentText: event.target.value
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium" htmlFor="reply-context">
                      Reply context
                    </label>
                    <textarea
                      id="reply-context"
                      className="mt-1 min-h-20 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      value={replyForm.context ?? ""}
                      onChange={(event) =>
                        setReplyForm((current) => ({
                          ...current,
                          context: event.target.value
                        }))
                      }
                    />
                  </div>
                  <div className="rounded-lg border border-dashed border-border p-3">
                    <label className="flex items-center gap-2 text-sm font-medium" htmlFor="reply-use-relevance">
                      <input
                        id="reply-use-relevance"
                        checked={replyForm.useRelevanceAdaptation ?? false}
                        onChange={(event) =>
                          setReplyForm((current) => ({
                            ...current,
                            useRelevanceAdaptation: event.target.checked
                          }))
                        }
                        type="checkbox"
                      />
                      Use relevance adaptation for reply
                    </label>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="text-sm font-medium" htmlFor="reply-target-role">
                          Reply target role/title
                        </label>
                        <input
                          id="reply-target-role"
                          className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                          value={replyForm.targetRole ?? ""}
                          onChange={(event) =>
                            setReplyForm((current) => ({
                              ...current,
                              targetRole: event.target.value
                            }))
                          }
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium" htmlFor="reply-company-context">
                          Reply company context
                        </label>
                        <input
                          id="reply-company-context"
                          className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                          value={replyForm.companyContext ?? ""}
                          onChange={(event) =>
                            setReplyForm((current) => ({
                              ...current,
                              companyContext: event.target.value
                            }))
                          }
                        />
                      </div>
                    </div>
                  </div>
                  <button
                    className="rounded-lg border border-border px-3 py-2 text-sm font-medium"
                    disabled={submittingReply}
                    type="submit"
                  >
                    {submittingReply ? "Generating..." : "Generate Reply"}
                  </button>
                </form>
                {generatedReply ? (
                  <div className="mt-4 rounded-lg border border-border bg-white p-3">
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-500">
                      Reply output · {generatedReply.mode}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-slate-700">{generatedReply.text}</p>
                    {generatedReply.engagementMode ? (
                      <div className="mt-3 space-y-1 text-xs text-slate-500">
                        <p>Adaptation: {generatedReply.engagementMode}</p>
                        {generatedReply.appliedAngle ? (
                          <p>Angle: {generatedReply.appliedAngle}</p>
                        ) : null}
                        {generatedReply.shouldGenerate !== undefined ? (
                          <p>Should generate: {generatedReply.shouldGenerate ? "yes" : "no"}</p>
                        ) : null}
                      </div>
                    ) : null}
                    {renderManualFeedbackControls("reply", "generated-reply-latest")}
                  </div>
                ) : null}
              </Card>
            </section>

            <section className="mt-6 grid gap-6 xl:grid-cols-2">
              <Card>
                <div className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-slate-600" />
                  <div>
                    <p className="text-sm text-muted">Brand Voice</p>
                    <h3 className="text-lg font-semibold">
                      {brandVoice ? brandVoice.name : "No active profile"}
                    </h3>
                  </div>
                </div>
                <form className="mt-4 space-y-3" onSubmit={handleSaveBrandVoice}>
                  <div>
                    <label className="text-sm font-medium" htmlFor="voice-profile-name">
                      Voice profile name
                    </label>
                    <input
                      id="voice-profile-name"
                      className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      value={brandVoiceForm.name}
                      onChange={(event) =>
                        setBrandVoiceForm((current) => ({
                          ...current,
                          name: event.target.value
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium" htmlFor="voice-tone">
                      Voice tone
                    </label>
                    <input
                      id="voice-tone"
                      className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      value={brandVoiceForm.tone}
                      onChange={(event) =>
                        setBrandVoiceForm((current) => ({
                          ...current,
                          tone: event.target.value
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium" htmlFor="voice-audience">
                      Voice audience
                    </label>
                    <input
                      id="voice-audience"
                      className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      value={brandVoiceForm.audience}
                      onChange={(event) =>
                        setBrandVoiceForm((current) => ({
                          ...current,
                          audience: event.target.value
                        }))
                      }
                    />
                  </div>
                  {(
                    [
                      ["Writing rules", "writingRules"],
                      ["Banned patterns", "bannedPatterns"],
                      ["Preferred patterns", "preferredPatterns"]
                    ] as const
                  ).map(([label, field]) => (
                    <div key={field}>
                      <label className="text-sm font-medium" htmlFor={field}>
                        {label}
                      </label>
                      <input
                        id={field}
                        className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                        value={brandVoiceForm[field].join(", ")}
                        onChange={(event) =>
                          setBrandVoiceForm((current) => ({
                            ...current,
                            [field]: event.target.value
                              .split(",")
                              .map((value) => value.trim())
                              .filter((value) => value.length > 0)
                          }))
                        }
                      />
                    </div>
                  ))}
                  <div>
                    <label className="text-sm font-medium" htmlFor="style-notes">
                      Style notes
                    </label>
                    <textarea
                      id="style-notes"
                      className="mt-1 min-h-24 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      value={brandVoiceForm.styleNotes}
                      onChange={(event) =>
                        setBrandVoiceForm((current) => ({
                          ...current,
                          styleNotes: event.target.value
                        }))
                      }
                    />
                  </div>
                  <button
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                    disabled={submittingBrandVoice}
                    type="submit"
                  >
                    {submittingBrandVoice ? "Saving..." : "Save Brand Voice"}
                  </button>
                </form>
                {brandVoice ? (
                  <div className="mt-4 rounded-lg border border-border p-3">
                    <h4 className="font-medium">{brandVoice.name}</h4>
                    <p className="mt-1 text-sm text-slate-600">{brandVoice.tone}</p>
                    <p className="mt-2 text-xs text-slate-500">
                      Preferred: {brandVoice.preferredPatterns.join(", ")}
                    </p>
                  </div>
                ) : null}
                <SectionErrorMessage error={loadErrors.brandVoice} label="Brand voice" />
              </Card>

              <Card>
                <div className="flex items-center gap-2">
                  <Layers3 className="h-5 w-5 text-slate-600" />
                  <div>
                    <p className="text-sm text-muted">Sources</p>
                    <h3 className="text-lg font-semibold">{counts.sources}</h3>
                  </div>
                </div>
                <form className="mt-4 space-y-3" onSubmit={handleCreateSource}>
                  <div>
                    <label className="text-sm font-medium" htmlFor="source-title">
                      Source title
                    </label>
                    <input
                      id="source-title"
                      className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      value={sourceForm.title}
                      onChange={(event) =>
                        setSourceForm((current) => ({ ...current, title: event.target.value }))
                      }
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium" htmlFor="discovery-source-type">
                      Discovery source type
                    </label>
                    <select
                      id="discovery-source-type"
                      className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      value={sourceForm.sourceType}
                      onChange={(event) =>
                        setSourceForm((current) => ({
                          ...current,
                          sourceType: event.target.value as CreateSourceItemInput["sourceType"]
                        }))
                      }
                    >
                      <option value="manual">manual</option>
                      <option value="article">article</option>
                      <option value="trend">trend</option>
                      <option value="github">github</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-medium" htmlFor="source-url">
                      Source URL
                    </label>
                    <input
                      id="source-url"
                      className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      value={sourceForm.sourceUrl ?? ""}
                      onChange={(event) =>
                        setSourceForm((current) => ({
                          ...current,
                          sourceUrl: event.target.value
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium" htmlFor="source-raw-text">
                      Source raw text
                    </label>
                    <textarea
                      id="source-raw-text"
                      className="mt-1 min-h-24 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      value={sourceForm.rawText}
                      onChange={(event) =>
                        setSourceForm((current) => ({
                          ...current,
                          rawText: event.target.value
                        }))
                      }
                    />
                  </div>
                  <button
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                    disabled={submittingSource}
                    type="submit"
                  >
                    {submittingSource ? "Saving..." : "Add Source"}
                  </button>
                </form>
                <div className="mt-4 space-y-3">
                  <SectionErrorMessage error={loadErrors.sources} label="Sources" />
                  {sourceItems.map((source) => (
                    <div key={source.id} className="rounded-lg border border-border p-3">
                      <h4 className="font-medium">{source.title}</h4>
                      <p className="mt-1 text-sm text-slate-600">{source.normalizedSummary}</p>
                      <p className="mt-2 text-xs text-slate-500">{source.tags.join(", ")}</p>
                    </div>
                  ))}
                </div>
              </Card>

              <Card>
                <div className="flex items-center gap-2">
                  <Globe2 className="h-5 w-5 text-slate-600" />
                  <div>
                    <p className="text-sm text-muted">Markets</p>
                    <h3 className="text-lg font-semibold">{counts.markets}</h3>
                  </div>
                </div>
                <form className="mt-4 space-y-3" onSubmit={handleCreateMarket}>
                  <div>
                    <label className="text-sm font-medium" htmlFor="country">
                      Country
                    </label>
                    <input
                      id="country"
                      className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      value={marketForm.country}
                      onChange={(event) =>
                        setMarketForm((current) => ({ ...current, country: event.target.value }))
                      }
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium" htmlFor="region">
                      Region
                    </label>
                    <input
                      id="region"
                      className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      value={marketForm.region}
                      onChange={(event) =>
                        setMarketForm((current) => ({ ...current, region: event.target.value }))
                      }
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium" htmlFor="primary-language">
                      Primary language
                    </label>
                    <input
                      id="primary-language"
                      className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      value={marketForm.primaryLanguage}
                      onChange={(event) =>
                        setMarketForm((current) => ({
                          ...current,
                          primaryLanguage: event.target.value
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium" htmlFor="market-note">
                      Market note
                    </label>
                    <textarea
                      id="market-note"
                      className="mt-1 min-h-24 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      value={marketForm.marketNote}
                      onChange={(event) =>
                        setMarketForm((current) => ({
                          ...current,
                          marketNote: event.target.value
                        }))
                      }
                    />
                  </div>
                  <button
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                    disabled={submittingMarket}
                    type="submit"
                  >
                    {submittingMarket ? "Saving..." : "Add Market Profile"}
                  </button>
                </form>
                <div className="mt-4 space-y-3">
                  <SectionErrorMessage error={loadErrors.markets} label="Markets" />
                  {marketProfiles.map((market) => (
                    <div key={market.id} className="rounded-lg border border-border p-3">
                      <div className="flex items-center justify-between gap-3">
                        <h4 className="font-medium">{market.country}</h4>
                        <span className="text-xs uppercase tracking-[0.16em] text-slate-500">
                          {market.linkedinPriority}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-slate-600">{market.marketNote}</p>
                      <p className="mt-2 text-xs text-slate-500">
                        Fit score: {market.serviceFitScore}
                      </p>
                    </div>
                  ))}
                </div>
              </Card>
            </section>

            <section
              className={`mt-6 grid gap-6 ${
                isOperatorDayOneMode ? "xl:grid-cols-[1.35fr_0.65fr]" : "xl:grid-cols-3"
              }`}
            >
              <Card>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-slate-600" />
                    <div>
                      <p className="text-sm text-muted">Topic Scores</p>
                      <h3 className="text-lg font-semibold">{counts.topics}</h3>
                    </div>
                  </div>
                  <button
                    className="rounded-lg border border-border px-3 py-2 text-sm font-medium"
                    disabled={scoringTopics}
                    onClick={() => void handleScoreTopics()}
                    type="button"
                  >
                    {scoringTopics ? "Scoring..." : "Score Topics"}
                  </button>
                </div>
                <div className="mt-4 space-y-3">
                  <SectionErrorMessage error={loadErrors.topics} label="Topic scores" />
                  {topicScores.map((score) => (
                    <div key={score.id} className="rounded-lg border border-border p-3">
                      <div className="flex items-center justify-between gap-3">
                        <h4 className="font-medium">{score.topicLabel}</h4>
                        <span className="text-xs uppercase tracking-[0.16em] text-slate-500">
                          {score.priorityScore}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-slate-600">{score.rationale}</p>
                    </div>
                  ))}
                </div>
              </Card>

              <Card role="region" aria-label="Server content workspace">
                <div className="flex items-center gap-2">
                  <Bookmark className="h-5 w-5 text-slate-600" />
                  <div>
                    <p className="text-sm text-muted">Server Content Workspace</p>
                    <h3 className="text-lg font-semibold">{counts.contentWorkspace}</h3>
                  </div>
                </div>
                <div className="mt-4 space-y-3">
                  <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 md:grid-cols-2 xl:grid-cols-4">
                    <label className="block text-sm text-slate-700">
                      <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        Status
                      </span>
                      <select
                        aria-label="Workspace status filter"
                        className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                        disabled={loadingContentWorkspace}
                        onChange={(event) =>
                          void handleChangeContentWorkspaceFilter({
                            status: event.target.value as ContentWorkspaceStatusFilter
                          })
                        }
                        value={contentWorkspaceStatusFilter}
                      >
                        <option value="all">all</option>
                        <option value="draft">draft</option>
                        <option value="parked">parked</option>
                        <option value="ready_for_draft">ready_for_draft</option>
                        <option value="blocked">blocked</option>
                        <option value="archived">archived</option>
                      </select>
                    </label>
                    <label className="block text-sm text-slate-700">
                      <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        Kind
                      </span>
                      <select
                        aria-label="Workspace kind filter"
                        className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                        disabled={loadingContentWorkspace}
                        onChange={(event) =>
                          void handleChangeContentWorkspaceFilter({
                            kind: event.target.value as ContentWorkspaceKindFilter
                          })
                        }
                        value={contentWorkspaceKindFilter}
                      >
                        <option value="all">all</option>
                        <option value="post">post</option>
                        <option value="comment">comment</option>
                        <option value="reply">reply</option>
                        <option value="deferred_note">deferred_note</option>
                      </select>
                    </label>
                    <label className="block text-sm text-slate-700">
                      <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        Has draft
                      </span>
                      <select
                        aria-label="Workspace draft presence filter"
                        className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                        disabled={loadingContentWorkspace}
                        onChange={(event) =>
                          void handleChangeContentWorkspaceFilter({
                            hasDraft: event.target.value as ContentWorkspaceHasDraftFilter
                          })
                        }
                        value={contentWorkspaceHasDraftFilter}
                      >
                        <option value="all">all</option>
                        <option value="true">true</option>
                        <option value="false">false</option>
                      </select>
                    </label>
                    <label className="block text-sm text-slate-700">
                      <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        Sort
                      </span>
                      <select
                        aria-label="Workspace sort"
                        className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                        disabled={loadingContentWorkspace}
                        onChange={(event) =>
                          void handleChangeContentWorkspaceFilter({
                            sort: event.target.value as ContentWorkspaceSortOption
                          })
                        }
                        value={contentWorkspaceSort}
                      >
                        <option value="updated_desc">updated_desc</option>
                        <option value="updated_asc">updated_asc</option>
                        <option value="status">status</option>
                        <option value="has_draft">has_draft</option>
                      </select>
                    </label>
                    <label className="block text-sm text-slate-700">
                      <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                        Draft status
                      </span>
                      <select
                        aria-label="Workspace draft status filter"
                        className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                        disabled={loadingContentWorkspace}
                        onChange={(event) =>
                          void handleChangeContentWorkspaceFilter({
                            draftStatus: event.target.value as ContentWorkspaceDraftStatusFilter
                          })
                        }
                        value={contentWorkspaceDraftStatusFilter}
                      >
                        <option value="all">all</option>
                        <option value="draft">draft</option>
                        <option value="ready">ready</option>
                        <option value="blocked">blocked</option>
                        <option value="archived">archived</option>
                      </select>
                    </label>
                  </div>
                  <SectionErrorMessage
                    error={loadErrors.contentWorkspace}
                    label="Server content workspace"
                  />
                  {loadingContentWorkspace ? (
                    <p className="text-sm text-slate-600">Refreshing server content workspace...</p>
                  ) : null}
                  {!loadErrors.contentWorkspace && contentWorkspaceItems.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border px-3 py-4 text-sm text-slate-600">
                      {contentWorkspaceStatusFilter !== "all" ||
                      contentWorkspaceKindFilter !== "all" ||
                      contentWorkspaceHasDraftFilter !== "all" ||
                      contentWorkspaceDraftStatusFilter !== "all"
                        ? "No server-side content work items match the current filters."
                        : "No server-side content work items yet."}
                    </div>
                  ) : null}
                  {contentWorkspaceItems.map((item) => {
                    const draftProgress = getWorkspaceDraftProgressDisplay(item);
                    const isSelected = selectedContentWorkspaceItemId === item.id;
                    const selectedDraftProgress =
                      selectedContentWorkspaceItem &&
                      selectedContentWorkspaceItemId === item.id
                        ? getWorkspaceDraftProgressDisplay(selectedContentWorkspaceItem)
                        : null;

                    return (
                      <div key={item.id} className="rounded-lg border border-border p-3">
                        <div className="flex flex-wrap gap-2">
                          {renderCompactBadge(item.workItemKind, "neutral")}
                          {renderCompactBadge(
                            formatOperationalLabel(item.status),
                            getWorkspaceStatusBadgeKind(item.status)
                          )}
                          {renderCompactBadge(draftProgress.badge, draftProgress.badgeKind)}
                        </div>
                        <h4 className="mt-3 font-medium">{item.title}</h4>
                        <p className="mt-1 text-sm text-slate-600">{item.summary}</p>
                        <p className="mt-2 text-xs text-slate-500">{draftProgress.detail}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          Updated: {new Date(item.updatedAt).toLocaleString()}
                        </p>
                        <button
                          aria-label={`View details for workspace item ${item.title}`}
                          className="mt-3 rounded-lg border border-border px-3 py-2 text-sm font-medium"
                          data-testid={`workspace-item-details-${item.id}`}
                          disabled={loadingContentWorkspaceItem && isSelected}
                          onClick={() => void handleOpenContentWorkspaceItem(item.id)}
                          type="button"
                        >
                          {loadingContentWorkspaceItem && isSelected ? "Loading..." : "View details"}
                        </button>
                        {isSelected ? (
                          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                            {loadingContentWorkspaceItem ? (
                              <p className="text-sm text-slate-600">Loading item details...</p>
                            ) : selectedContentWorkspaceItemError ? (
                              <div className="text-sm text-amber-800">
                                <p className="font-medium">
                                  Item inspection failed:{" "}
                                  {selectedContentWorkspaceItemError.method}{" "}
                                  {selectedContentWorkspaceItemError.endpoint}
                                </p>
                                <p className="mt-1 text-xs">
                                  Status: {selectedContentWorkspaceItemError.status ?? "network error"}
                                </p>
                                <p className="mt-1 text-xs">
                                  {selectedContentWorkspaceItemError.responseBody ??
                                    selectedContentWorkspaceItemError.message}
                                </p>
                              </div>
                            ) : selectedContentWorkspaceItem ? (
                              <div className="space-y-2 text-sm text-slate-700">
                                <div className="flex flex-wrap gap-2">
                                  {renderCompactBadge(
                                    formatOperationalLabel(selectedContentWorkspaceItem.recommendedAction),
                                    "support"
                                  )}
                                  {selectedDraftProgress
                                    ? renderCompactBadge(
                                        selectedDraftProgress.badge,
                                        selectedDraftProgress.badgeKind
                                      )
                                    : null}
                                </div>
                                <div>
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                                    Recommended action
                                  </p>
                                  <p className="mt-1">{selectedContentWorkspaceItem.recommendedAction}</p>
                                </div>
                                <div>
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                                    Rationale
                                  </p>
                                  <p className="mt-1">{selectedContentWorkspaceItem.rationale}</p>
                                </div>
                                <div>
                                  <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                                    <label className="block text-sm text-slate-700">
                                      <span className="block text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                                        Work item status
                                      </span>
                                      <select
                                        aria-label="Work item status select"
                                        className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                                        disabled={savingContentWorkspaceItemStatus}
                                        onChange={(event) =>
                                          setWorkItemStatusSelection(
                                            event.target.value as WorkItemStatusOption
                                          )
                                        }
                                        value={workItemStatusSelection}
                                      >
                                        <option value="draft">draft</option>
                                        <option value="parked">parked</option>
                                        <option value="ready_for_draft">ready_for_draft</option>
                                        <option value="blocked">blocked</option>
                                        <option value="archived">archived</option>
                                      </select>
                                    </label>
                                    {workItemStatusSaveError ? (
                                      <div className="text-sm text-amber-800">
                                        <p className="font-medium">
                                          Work item status update failed:{" "}
                                          {workItemStatusSaveError.method}{" "}
                                          {workItemStatusSaveError.endpoint}
                                        </p>
                                        <p className="mt-1 text-xs">
                                          Status: {workItemStatusSaveError.status ?? "network error"}
                                        </p>
                                        <p className="mt-1 text-xs">
                                          {workItemStatusSaveError.responseBody ??
                                            workItemStatusSaveError.message}
                                        </p>
                                      </div>
                                    ) : null}
                                    <button
                                      className="rounded-lg border border-border px-3 py-2 text-sm font-medium"
                                      disabled={savingContentWorkspaceItemStatus}
                                      onClick={() => void handleSaveContentWorkspaceItemStatus()}
                                      type="button"
                                    >
                                      {savingContentWorkspaceItemStatus
                                        ? "Applying..."
                                        : "Apply work item status"}
                                    </button>
                                  </div>
                                </div>
                                <div>
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                                    Linked draft
                                  </p>
                                  {selectedContentWorkspaceItem.draftProgress?.hasDraft ? (
                                    <>
                                      <p className="mt-1">
                                        {selectedContentWorkspaceItem.draftProgress.draftId ?? "Linked draft"}
                                      </p>
                                      <p className="mt-1 text-xs text-slate-500">
                                        Draft status:{" "}
                                        {selectedContentWorkspaceItem.draftProgress.draftStatus ?? "unknown"}
                                      </p>
                                      {selectedContentWorkspaceItem.draftProgress.draftId ? (
                                        <button
                                          aria-label={`View linked draft ${selectedContentWorkspaceItem.draftProgress.draftId}`}
                                          className="mt-2 rounded-lg border border-border px-3 py-2 text-sm font-medium"
                                          disabled={
                                            loadingDraftDocument &&
                                            selectedDraftDocumentId ===
                                              selectedContentWorkspaceItem.draftProgress.draftId
                                          }
                                          onClick={() =>
                                            void handleOpenDraftDocument(
                                              selectedContentWorkspaceItem.draftProgress?.draftId ?? ""
                                            )
                                          }
                                          type="button"
                                        >
                                          {loadingDraftDocument &&
                                          selectedDraftDocumentId ===
                                            selectedContentWorkspaceItem.draftProgress.draftId
                                            ? "Loading draft..."
                                            : "View linked draft"}
                                        </button>
                                      ) : null}
                                    </>
                                  ) : (
                                    <>
                                      <p className="mt-1">No server draft linked yet.</p>
                                      {draftCreationError ? (
                                        <div className="mt-2 text-sm text-amber-800">
                                          <p className="font-medium">
                                            Draft creation failed: {draftCreationError.method}{" "}
                                            {draftCreationError.endpoint}
                                          </p>
                                          <p className="mt-1 text-xs">
                                            Status: {draftCreationError.status ?? "network error"}
                                          </p>
                                          <p className="mt-1 text-xs">
                                            {draftCreationError.responseBody ??
                                              draftCreationError.message}
                                          </p>
                                        </div>
                                      ) : null}
                                      <button
                                        aria-label={`Create draft for workspace item ${selectedContentWorkspaceItem.title}`}
                                        className="mt-2 rounded-lg border border-border px-3 py-2 text-sm font-medium"
                                        disabled={creatingDraftDocument}
                                        onClick={() => void handleCreateDraftDocument()}
                                        type="button"
                                      >
                                        {creatingDraftDocument ? "Creating draft..." : "Create draft"}
                                      </button>
                                    </>
                                  )}
                                </div>
                                {selectedContentWorkspaceItem.draftProgress?.draftId &&
                                selectedDraftDocumentId ===
                                  selectedContentWorkspaceItem.draftProgress.draftId
                                  ? renderSelectedDraftDocumentPanel("Loading linked draft...")
                                  : null}
                                <div>
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                                    Updated
                                  </p>
                                  <p className="mt-1">
                                    {new Date(selectedContentWorkspaceItem.updatedAt).toLocaleString()}
                                  </p>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </Card>

              <Card>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Layers3 className="h-5 w-5 text-slate-600" />
                    <div>
                      <p className="text-sm text-muted">Content Queue</p>
                      <h3 className="text-lg font-semibold">{counts.queue}</h3>
                    </div>
                  </div>
                  <button
                    className="rounded-lg border border-border px-3 py-2 text-sm font-medium"
                    disabled={buildingQueue}
                    onClick={() => void handleBuildQueue()}
                    type="button"
                  >
                    {buildingQueue ? "Building..." : "Build Queue"}
                  </button>
                </div>
                <div className="mt-4 space-y-3">
                  <SectionErrorMessage error={loadErrors.queue} label="Content queue" />
                  {contentQueue.map((item) => (
                    <div key={item.id} className="rounded-lg border border-border p-3">
                      <div className="flex items-center justify-between gap-3">
                        <h4 className="font-medium">{item.recommendedAction}</h4>
                        <span className="text-xs uppercase tracking-[0.16em] text-slate-500">
                          {item.priority}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-slate-600">{item.reason}</p>
                    </div>
                  ))}
                </div>
              </Card>
            </section>
      </>
    );
  }

  // Render helper for Legacy manual workflow
  // Renders in Legacy surface only (no longer in Lab)
  function renderLegacyManualWorkflow() {
    return (
      <>
        {/* Legacy manual workflow: Signal → Idea → Content → Visual pipeline */}
        <div className="mb-4 mt-12 border-b border-slate-200 pb-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Manual Content Creation (Legacy)</h2>
          <p className="mt-1 text-sm text-slate-600">Fallback for edge cases. Step-by-step manual workflow: Signal → Idea → Draft → Post</p>
        </div>

        <section className="grid gap-6 xl:grid-cols-3">
          <Card>
            <div className="flex items-center gap-2">
              <Radar className="h-5 w-5 text-slate-600" />
              <div>
                <p className="text-sm text-muted">Manual Signals</p>
                <h3 className="text-lg font-semibold">{counts.signals}</h3>
              </div>
            </div>
            <form className="mt-4 space-y-3" onSubmit={handleCreateSignal}>
              <div>
                <label className="text-sm font-medium" htmlFor="signal-title">
                  Signal title
                </label>
                <input
                  id="signal-title"
                  className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                  value={signalForm.title}
                  onChange={(event) =>
                    setSignalForm((current) => ({ ...current, title: event.target.value }))
                  }
                />
              </div>
              <div>
                <label className="text-sm font-medium" htmlFor="signal-source-type">
                  Source type
                </label>
                <select
                  id="signal-source-type"
                  className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                  value={signalForm.sourceType}
                  onChange={(event) =>
                    setSignalForm((current) => ({
                      ...current,
                      sourceType: event.target.value as SourceType
                    }))
                  }
                >
                  <option value="manual">manual</option>
                  <option value="research">research</option>
                  <option value="crm">crm</option>
                  <option value="social">social</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium" htmlFor="signal-raw-text">
                  Raw text
                </label>
                <textarea
                  id="signal-raw-text"
                  className="mt-1 min-h-28 w-full rounded-lg border border-border px-3 py-2 text-sm"
                  value={signalForm.rawText}
                  onChange={(event) =>
                    setSignalForm((current) => ({ ...current, rawText: event.target.value }))
                  }
                />
              </div>
              <button
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                disabled={submittingSignal}
                type="submit"
              >
                {submittingSignal ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Create Signal
              </button>
            </form>
          </Card>
        </section>

        {error ? (
          <div className="mt-6 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        {Object.keys(loadErrors).length > 0 ? (
          <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <p className="font-medium">Some sections failed to load.</p>
            <ul className="mt-2 space-y-1">
              {Object.entries(loadErrors).map(([sectionKey, sectionError]) => (
                <li key={sectionKey}>
                  {sectionError
                    ? `${getSectionLabel(sectionKey as DashboardSectionKey)} failed: ${formatApiRequestError(sectionError)}`
                    : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {loading ? (
          <div className="mt-6 rounded-lg border border-border bg-white px-4 py-6 text-sm text-slate-600">
            Loading dashboard...
          </div>
        ) : null}

        <section className="mt-6 grid gap-6 xl:grid-cols-3">
          <Card>
            <div className="flex items-center gap-2">
              <Radar className="h-5 w-5 text-slate-600" />
              <div>
                <p className="text-sm text-muted">Signals</p>
                <h3 className="text-lg font-semibold">{counts.signals}</h3>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              <SectionErrorMessage error={loadErrors.signals} label="Signals" />
              {signals.map((signal) => (
                <div
                  key={signal.id}
                  className={`rounded-lg border p-3 ${
                    highlightedSignalId === signal.id
                      ? "border-slate-900 bg-slate-50"
                      : "border-border"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <h4 className="font-medium">{signal.title}</h4>
                    {highlightedSignalId === signal.id ? (
                      renderCompactBadge("Current", "current")
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{signal.rawText}</p>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="text-xs uppercase tracking-[0.16em] text-slate-500">
                      {signal.sourceType}
                    </span>
                    <button
                      className="rounded-lg border border-border px-3 py-2 text-sm font-medium"
                      disabled={workingSignalId === signal.id}
                      onClick={() => void handleGenerateIdea(signal.id)}
                      type="button"
                    >
                      {workingSignalId === signal.id ? "Generating..." : "Generate Idea"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-slate-600" />
              <div>
                <p className="text-sm text-muted">Ideas</p>
                <h3 className="text-lg font-semibold">{counts.ideas}</h3>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              <SectionErrorMessage error={loadErrors.ideas} label="Ideas" />
              {ideas.map((idea) => (
                <div key={idea.id} className="rounded-lg border border-border p-3">
                  <h4 className="font-medium">{idea.title}</h4>
                  <p className="mt-1 text-sm text-slate-600">{idea.coreInsight}</p>
                  <p className="mt-2 text-xs text-slate-500">{idea.businessRelevance}</p>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="text-xs uppercase tracking-[0.16em] text-slate-500">
                      {idea.targetAudience}
                    </span>
                    <button
                      className="rounded-lg border border-border px-3 py-2 text-sm font-medium"
                      disabled={workingIdeaId === idea.id}
                      onClick={() => void handleGenerateContent(idea.id)}
                      type="button"
                    >
                      {workingIdeaId === idea.id ? "Generating..." : "Generate Content"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <div className="flex items-center gap-2">
              <PenSquare className="h-5 w-5 text-slate-600" />
              <div>
                <p className="text-sm text-muted">Content Drafts</p>
                <h3 className="text-lg font-semibold">{counts.content}</h3>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              <SectionErrorMessage error={loadErrors.content} label="Content drafts" />
              {contentAssets.map((asset) => (
                <div key={asset.id} className="rounded-lg border border-border p-3">
                  <h4 className="font-medium">{asset.hook}</h4>
                  <p className="mt-1 text-sm text-slate-600">{asset.body}</p>
                  <p className="mt-2 text-xs text-slate-500">{asset.cta}</p>
                  {asset.overallQualityScore ? (
                    <p className="mt-2 text-xs text-slate-500">
                      Quality: {asset.overallQualityScore} ({asset.qualityStatus})
                    </p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      className="rounded-lg border border-border px-3 py-2 text-sm font-medium"
                      disabled={refiningContentId === asset.id}
                      onClick={() => void handleRefineContent(asset.id)}
                      type="button"
                    >
                      {refiningContentId === asset.id ? "Refining..." : "Refine Content"}
                    </button>
                    <button
                      className="rounded-lg border border-border px-3 py-2 text-sm font-medium"
                      disabled={visualizingContentId === asset.id}
                      onClick={() => void handleGenerateVisual(asset.id)}
                      type="button"
                    >
                      {visualizingContentId === asset.id ? "Generating..." : "Generate Visual"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </section>

        <section className="mt-6 grid gap-6 xl:grid-cols-2">
          <Card>
            <div className="flex items-center gap-2">
              <WandSparkles className="h-5 w-5 text-slate-600" />
              <div>
                <p className="text-sm text-muted">Refined Content</p>
                <h3 className="text-lg font-semibold">
                  {contentAssets.filter((asset) => asset.refinementStatus === "refined").length} refined
                </h3>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              <SectionErrorMessage error={loadErrors.content} label="Refined content" />
              <div className="rounded-lg border border-border bg-slate-50 p-3">
                <div className="grid gap-3 md:grid-cols-3">
                  <label className="text-sm text-slate-700">
                    <span className="block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
                      Final post hook mode
                    </span>
                    <select
                      aria-label="Final post hook mode"
                      className="mt-2 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm"
                      onChange={(event) =>
                        setFinalPostConfig((current) => ({
                          ...current,
                          hookMode: event.target.value as FinalPostGenerationConfig["hookMode"]
                        }))
                      }
                      value={finalPostConfig.hookMode ?? "sharp_observation"}
                    >
                      <option value="sharp_observation">Sharp observation</option>
                      <option value="operational_tension">Operational tension</option>
                      <option value="counterintuitive_claim">Counterintuitive claim</option>
                      <option value="execution_lesson">Execution lesson</option>
                      <option value="field_pattern">Field pattern</option>
                    </select>
                  </label>
                  <label className="flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-sm text-slate-700">
                    <input
                      aria-label="Enable anti-blandness shaping"
                      checked={finalPostConfig.antiBlandness ?? false}
                      onChange={(event) =>
                        setFinalPostConfig((current) => ({
                          ...current,
                          antiBlandness: event.target.checked
                        }))
                      }
                      type="checkbox"
                    />
                    <span>Enable anti-blandness shaping</span>
                  </label>
                  <label className="flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-sm text-slate-700">
                    <input
                      aria-label="Enable outcome-aware shaping"
                      checked={finalPostConfig.outcomeAwareShaping ?? false}
                      onChange={(event) =>
                        setFinalPostConfig((current) => ({
                          ...current,
                          outcomeAwareShaping: event.target.checked
                        }))
                      }
                      type="checkbox"
                    />
                    <span>Enable outcome-aware shaping</span>
                  </label>
                </div>
              </div>
              {contentAssets
                .filter((asset) => asset.refinementStatus === "refined")
                .map((asset) => (
                  <div key={asset.id} className="rounded-lg border border-border p-3">
                    <h4 className="font-medium">{asset.refinedHook}</h4>
                    <p className="mt-1 text-sm text-slate-600">{asset.refinedBody}</p>
                    <p className="mt-2 text-xs text-slate-500">{asset.refinedCta}</p>
                    {asset.overallQualityScore ? (
                      <p className="mt-2 text-xs text-slate-500">
                        Quality score: {asset.overallQualityScore}
                      </p>
                    ) : null}
                    <button
                      className="mt-3 rounded-lg border border-border px-3 py-2 text-sm font-medium"
                      disabled={finalizingContentId === asset.id}
                      onClick={() => void handleGenerateFinalPost(asset.id)}
                      type="button"
                    >
                      {finalizingContentId === asset.id
                        ? "Finalizing..."
                        : "Generate Final Post (Legacy)"}
                    </button>
                    <button
                      className="mt-2 rounded-lg border border-border px-3 py-2 text-sm font-medium"
                      disabled={finalizingV2ContentId === asset.id}
                      onClick={() => void handleGenerateFinalPostV2(asset.id)}
                      type="button"
                    >
                      {finalizingV2ContentId === asset.id
                        ? "Finalizing V2..."
                        : "Generate Final Post V2 (Experimental)"}
                    </button>
                    <button
                      className="mt-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium"
                      disabled={comparingContentId === asset.id}
                      onClick={() => void handleCompareFinalPostVariants(asset.id)}
                      type="button"
                    >
                      {comparingContentId === asset.id
                        ? "Comparing..."
                        : "Compare Variants (Experimental)"}
                    </button>
                  </div>
                ))}
            </div>
          </Card>

          <Card>
            <div className="flex items-center gap-2">
              <PenSquare className="h-5 w-5 text-slate-600" />
              <div>
                <p className="text-sm text-muted">Final Posts</p>
                <h3 className="text-lg font-semibold">{counts.finalPosts}</h3>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              <SectionErrorMessage error={loadErrors.content} label="Final posts" />
              {contentAssets
                .filter((asset) => asset.finalStatus === "ready")
                .map((asset) => (
                  <article
                    key={`legacy-${asset.id}`}
                    className="rounded-lg border border-border bg-white p-4"
                  >
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                      Legacy Final Post
                    </p>
                    <h4 className="font-medium text-slate-950">{asset.finalHook}</h4>
                    <div className="mt-3 space-y-3 text-sm leading-6 text-slate-700">
                      {asset.finalBody?.split("\n\n").map((paragraph, index) => (
                        <p key={`${asset.id}-paragraph-${index}`}>{paragraph}</p>
                      ))}
                    </div>
                    <p className="mt-3 text-sm font-medium text-slate-800">
                      {asset.finalClosing}
                    </p>
                    {asset.finalQualityScore ? (
                      <p className="mt-2 text-xs text-slate-500">
                        Final quality: {asset.finalQualityScore}
                      </p>
                    ) : null}
                    {asset.finalQualityMetadata ? (
                      <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                        <p>Hook strength: {asset.finalQualityMetadata.hookStrengthScore}</p>
                        <p>Human feel: {asset.finalQualityMetadata.humanFeelScore}</p>
                        <p>Specificity: {asset.finalQualityMetadata.specificityScore}</p>
                        <p>Publishability: {asset.finalQualityMetadata.publishabilityScore}</p>
                        {asset.finalQualityMetadata.appliedOutcomeBias ? (
                          <p>Outcome bias: {asset.finalQualityMetadata.appliedOutcomeBias}</p>
                        ) : null}
                        {asset.finalQualityMetadata.notes.map((note) => (
                          <p key={`${asset.id}-${note}`}>{note}</p>
                        ))}
                      </div>
                    ) : null}
                    {renderManualFeedbackControls("final_post", asset.id)}
                  </article>
                ))}
              {experimentalFinalPosts.map((asset) => (
                <article
                  key={`v2-${asset.contentId ?? asset.signalId}`}
                  className="rounded-lg border border-sky-200 bg-sky-50 p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">
                      V2 Final Post
                    </p>
                    <p className="text-xs text-sky-700">
                      {asset.generatorVersion} · {asset.mode}
                    </p>
                  </div>
                  <h4 className="mt-2 font-medium text-slate-950">{asset.hook}</h4>
                  <div className="mt-3 space-y-3 text-sm leading-6 text-slate-700">
                    {asset.post.split("\n\n").map((paragraph, index) => (
                      <p key={`${asset.contentId ?? asset.signalId}-v2-paragraph-${index}`}>
                        {paragraph}
                      </p>
                    ))}
                  </div>
                </article>
              ))}
              {finalPostComparison ? (
                <article className="rounded-lg border border-slate-300 bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                        Final Post Comparison
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Content: {finalPostComparison.contentId}
                      </p>
                    </div>
                    <p className="text-xs text-slate-500">
                      Hook mode: {finalPostConfig.hookMode ?? "sharp_observation"} ·{" "}
                      {finalPostConfig.antiBlandness ? "anti-blandness on" : "anti-blandness off"} ·{" "}
                      {finalPostConfig.outcomeAwareShaping ? "outcome-aware on" : "outcome-aware off"}
                    </p>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {[
                      { label: "Hook only", value: "hook" },
                      { label: "First paragraph", value: "firstParagraph" },
                      { label: "Full post", value: "full" }
                    ].map((option) => (
                      <button
                        key={option.value}
                        className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
                          finalPostComparisonViewMode === option.value
                            ? "border-slate-900 bg-slate-900 text-white"
                            : "border-border bg-white text-slate-700"
                        }`}
                        onClick={() =>
                          setFinalPostComparisonViewMode(
                            option.value as FinalPostComparisonViewMode
                          )
                        }
                        type="button"
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <div className="mt-4 grid gap-3 xl:grid-cols-3">
                    {finalPostComparison.variants.map((variant) => (
                      <section
                        key={`${finalPostComparison.contentId}-${variant.label}`}
                        className="rounded-lg border border-border bg-white p-4"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                            {variant.label}
                          </p>
                          {variant.mode ? (
                            <p className="text-xs text-slate-500">{variant.mode}</p>
                          ) : null}
                        </div>
                        <h4 className="mt-2 font-medium text-slate-950">{variant.hook}</h4>
                        <div className="mt-3 space-y-3 text-sm leading-6 text-slate-700">
                          {finalPostComparisonViewMode === "full" ? (
                            variant.body.split("\n\n").map((paragraph, index) => (
                              <p key={`${variant.label}-paragraph-${index}`}>{paragraph}</p>
                            ))
                          ) : (
                            <p
                              className={
                                finalPostComparisonViewMode === "hook"
                                  ? "font-medium text-slate-900"
                                  : undefined
                              }
                            >
                              {getComparisonDisplayText(
                                variant,
                                finalPostComparisonViewMode
                              )}
                            </p>
                          )}
                        </div>
                        {variant.closing && finalPostComparisonViewMode === "full" ? (
                          <p className="mt-3 text-sm font-medium text-slate-800">
                            {variant.closing}
                          </p>
                        ) : null}
                        {variant.qualityScore ? (
                          <p className="mt-2 text-xs text-slate-500">
                            Final quality: {variant.qualityScore}
                          </p>
                        ) : null}
                        {variant.qualityMetadata ? (
                          <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                            <p>Hook strength: {variant.qualityMetadata.hookStrengthScore}</p>
                            <p>Human feel: {variant.qualityMetadata.humanFeelScore}</p>
                            <p>Specificity: {variant.qualityMetadata.specificityScore}</p>
                            <p>Publishability: {variant.qualityMetadata.publishabilityScore}</p>
                            {variant.qualityMetadata.appliedOutcomeBias ? (
                              <p>Outcome bias: {variant.qualityMetadata.appliedOutcomeBias}</p>
                            ) : null}
                            {variant.qualityMetadata.notes.map((note) => (
                              <p key={`${variant.label}-${note}`}>{note}</p>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-2 text-xs text-slate-500">
                            {variant.notesFallback ?? "Metadata unavailable for this variant."}
                          </p>
                        )}
                      </section>
                    ))}
                  </div>
                </article>
              ) : null}
            </div>
          </Card>

          <Card>
            <div className="flex items-center gap-2">
              <ImagePlus className="h-5 w-5 text-slate-600" />
              <div>
                <p className="text-sm text-muted">Visual Briefs</p>
                <h3 className="text-lg font-semibold">{counts.visuals}</h3>
              </div>
            </div>
            <div className="mt-4 space-y-3">
              <SectionErrorMessage error={loadErrors.visuals} label="Visual briefs" />
              {visualAssets.map((visual) => (
                <div key={visual.id} className="rounded-lg border border-border p-3">
                  <h4 className="font-medium">{visual.title}</h4>
                  <p className="mt-1 text-sm text-slate-600">{visual.prompt}</p>
                  <p className="mt-2 text-xs text-slate-500">{visual.visualType}</p>
                </div>
              ))}
            </div>
          </Card>
        </section>
      </>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="grid min-h-screen lg:grid-cols-[240px_1fr]">
        <aside className="border-r border-border bg-slate-950 px-6 py-8 text-slate-100">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
            Workspace
          </p>
          <h1 className="mt-3 text-2xl font-semibold">LinkedIn Brand OS</h1>
          <p className="mt-4 text-sm text-slate-400">
            Manual and open-source intake only. Queue planning only. No scraping or
            auto-posting.
          </p>
        </aside>

        <div className="flex min-h-screen flex-col">
          <header className="border-b border-border bg-white/80 px-6 py-4 backdrop-blur">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm text-muted">
                  Signal -&gt; Idea -&gt; Draft -&gt; Refined Draft -&gt; Visual Brief -&gt;
                  Market Intelligence -&gt; Queue
                </p>
                <h2 className="text-xl font-semibold">Operator surfaces</h2>
                <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Operator surface mode">
                  <button
                    aria-pressed={operatorDashboardMode === "day_1"}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                      operatorDashboardMode === "day_1"
                        ? "border-emerald-900 bg-emerald-900 text-white"
                        : "border-border bg-white text-slate-700"
                    }`}
                    onClick={() => setOperatorDashboardMode("day_1")}
                    type="button"
                  >
                    📝 Day-1
                  </button>
                  <button
                    aria-pressed={operatorDashboardMode === "control"}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                      operatorDashboardMode === "control"
                        ? "border-blue-900 bg-blue-900 text-white"
                        : "border-border bg-white text-slate-700"
                    }`}
                    onClick={() => setOperatorDashboardMode("control")}
                    type="button"
                  >
                    🎛️ Control
                  </button>
                  <button
                    aria-pressed={operatorDashboardMode === "lab"}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                      operatorDashboardMode === "lab"
                        ? "border-purple-900 bg-purple-900 text-white"
                        : "border-border bg-white text-slate-700"
                    }`}
                    onClick={() => setOperatorDashboardMode("lab")}
                    type="button"
                  >
                    ⚗️ Lab
                  </button>
                  <button
                    aria-pressed={operatorDashboardMode === "legacy"}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                      operatorDashboardMode === "legacy"
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-border bg-white text-slate-700"
                    }`}
                    onClick={() => setOperatorDashboardMode("legacy")}
                    type="button"
                  >
                    📋 Legacy
                  </button>
                  <button
                    aria-pressed={operatorDashboardMode === "factory"}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                      operatorDashboardMode === "factory"
                        ? "border-indigo-900 bg-indigo-900 text-white"
                        : "border-border bg-white text-slate-700"
                    }`}
                    onClick={() => setOperatorDashboardMode("factory")}
                    type="button"
                  >
                    🏭 Factory
                  </button>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs uppercase tracking-[0.16em] text-slate-500">
                  Signed in as
                </p>
                <p className="text-sm font-medium text-slate-700">{operatorSession.username}</p>
                <button
                  className="mt-2 rounded-lg border border-border px-3 py-2 text-sm font-medium"
                  disabled={loggingOutOperator}
                  onClick={() => void handleOperatorLogout()}
                  type="button"
                >
                  {loggingOutOperator ? "Signing out..." : "Sign out"}
                </button>
              </div>
            </div>
          </header>

          <main className="flex-1 px-6 py-6">
            {operatorDashboardMode === "day_1" ? (
              <section className="mb-6 space-y-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-bold">📝 Your Content Day-1</h2>
                  <p className="text-sm text-slate-600">Primary operator workflow: review drafts, record outcomes</p>
                </div>

                <Card role="region" aria-label="Autonomy summary">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold">Your autonomous content system</h3>
                    {aiRuntimeHealth ? renderCompactBadge(
                      aiRuntimeHealth.schedulerRuntimeEnabled ? "active" : "inactive",
                      aiRuntimeHealth.schedulerRuntimeEnabled ? "repeat" : "neutral"
                    ) : null}
                  </div>
                  <div className="mt-4 grid gap-4 sm:grid-cols-3">
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <span className="text-xs font-medium uppercase tracking-wider text-slate-500">Ready to review</span>
                      <p className="mt-2 text-3xl font-bold text-emerald-600">
                        {(() => {
                          const reviewableDrafts = autonomousContentAssets.filter(d => d.contentStatus === "draft" || d.contentStatus === "ready");
                          return reviewableDrafts.length;
                        })()}
                      </p>
                      <p className="mt-1 text-xs text-slate-600">
                        {(() => {
                          const reviewableDrafts = autonomousContentAssets.filter(d => d.contentStatus === "draft" || d.contentStatus === "ready");
                          if (reviewableDrafts.length > 0) {
                            return `${reviewableDrafts.length} ${reviewableDrafts.length === 1 ? 'draft needs' : 'drafts need'} your review`;
                          } else {
                            return "No drafts pending";
                          }
                        })()}
                      </p>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <span className="text-xs font-medium uppercase tracking-wider text-slate-500">Active sources</span>
                      <p className="mt-2 text-3xl font-bold text-slate-900">
                        {autonomousWatchlists.filter(w => w.isActive).length}
                      </p>
                      <p className="mt-1 text-xs text-slate-600">
                        watchlists monitoring for opportunities
                      </p>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <span className="text-xs font-medium uppercase tracking-wider text-slate-500">Last activity</span>
                      {schedulerRuntimeStatus?.lastTickCompletedAt ? (
                        <>
                          <p className="mt-2 text-sm font-semibold text-slate-900">
                            {formatTimeAgo(new Date(schedulerRuntimeStatus.lastTickCompletedAt))}
                          </p>
                          <p className="mt-1 text-xs text-slate-600">
                            {schedulerRuntimeStatus.lastTickOutcome?.status === "completed" && schedulerRuntimeStatus.lastTickOutcome.runCount > 0 ? (
                              `${schedulerRuntimeStatus.lastTickOutcome.runCount} task${schedulerRuntimeStatus.lastTickOutcome.runCount !== 1 ? 's' : ''} completed`
                            ) : schedulerRuntimeStatus.lastTickOutcome?.status === "failed" ? (
                              "Run failed - check Control"
                            ) : "System idle"}
                          </p>
                        </>
                      ) : aiRuntimeHealth?.schedulerRuntimeEnabled ? (
                        <>
                          <p className="mt-2 text-sm font-semibold text-slate-900">Starting...</p>
                          <p className="mt-1 text-xs text-slate-600">First run pending</p>
                        </>
                      ) : (
                        <>
                          <p className="mt-2 text-sm font-semibold text-slate-900">Not active</p>
                          <p className="mt-1 text-xs text-slate-600">Enable in Control surface</p>
                        </>
                      )}
                    </div>
                  </div>
                  {schedulerRuntimeStatus?.lastTickOutcome?.status === "failed" ? (
                    <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3">
                      <p className="text-sm font-medium text-red-900">⚠️ Attention needed</p>
                      <p className="mt-1 text-sm text-red-700">{schedulerRuntimeStatus.lastTickOutcome.errorSummary}</p>
                      <p className="mt-1 text-xs text-red-600">Check the Control surface for details</p>
                    </div>
                  ) : null}
                  {!aiRuntimeHealth?.schedulerRuntimeEnabled && autonomousContentAssets.length === 0 ? (
                    <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3">
                      <p className="text-sm font-medium text-blue-900">👋 Get started</p>
                      <p className="mt-1 text-sm text-blue-700">
                        Switch to Control surface to activate your autonomous system and add watchlist sources.
                      </p>
                    </div>
                  ) : null}
                </Card>

                {loadErrors.autonomousContentAssets ? (
                  <SectionErrorMessage error={loadErrors.autonomousContentAssets} label="Drafts" />
                ) : autonomousContentAssets.length === 0 ? (
                  <Card>
                    <p className="text-sm text-slate-600">
                      No drafts yet. The autonomous system will create content as it finds opportunities.
                    </p>
                  </Card>
                ) : (() => {
                  const reviewFirstDrafts = autonomousContentAssets.filter(d => d.contentStatus === "draft" || d.contentStatus === "ready");
                  const needsEditDrafts = autonomousContentAssets.filter(d => d.contentStatus === "review");
                  const archivedDrafts = autonomousContentAssets.filter(d => d.contentStatus === "archived");

                  const scoreDraft = (draft: typeof autonomousContentAssets[0]) => {
                    const createdAt = new Date(draft.createdAt).getTime();
                    const ageScore = createdAt;
                    const statusScore = draft.contentStatus === "ready" ? 3 : draft.contentStatus === "draft" ? 2 : 1;
                    return ageScore + (statusScore * 1000000000000);
                  };

                  // Day-1 diversity gate: only show best draft from each opportunity
                  const applyDiversityGate = (drafts: typeof autonomousContentAssets) => {
                    // Group by sourceMatchedOpportunityId - drafts from same opportunity are near-identical
                    const groups = new Map<string | undefined, typeof autonomousContentAssets>();

                    for (const draft of drafts) {
                      const key = draft.sourceMatchedOpportunityId || `unique-${draft.id}`;
                      if (!groups.has(key)) {
                        groups.set(key, []);
                      }
                      groups.get(key)!.push(draft);
                    }

                    // Pick best from each group
                    const bestFromEachGroup = Array.from(groups.values()).map(group => {
                      return group.sort((a, b) => {
                        // First: finalQualityScore (if available)
                        if (a.finalQualityScore !== undefined && b.finalQualityScore !== undefined) {
                          if (a.finalQualityScore !== b.finalQualityScore) {
                            return b.finalQualityScore - a.finalQualityScore;
                          }
                        }
                        // Second: finalStatus priority (ready > needs_review > needs_work)
                        const finalStatusScore = (fs?: string) => fs === "ready" ? 3 : fs === "needs_review" ? 2 : fs === "needs_work" ? 1 : 0;
                        const aFinalScore = finalStatusScore(a.finalStatus);
                        const bFinalScore = finalStatusScore(b.finalStatus);
                        if (aFinalScore !== bFinalScore) {
                          return bFinalScore - aFinalScore;
                        }
                        // Third: existing scoreDraft logic (contentStatus + recency)
                        return scoreDraft(b) - scoreDraft(a);
                      })[0];
                    });

                    return bestFromEachGroup;
                  };

                  const diverseReviewDrafts = applyDiversityGate(reviewFirstDrafts);
                  const topDraft = diverseReviewDrafts.sort((a, b) => scoreDraft(b) - scoreDraft(a))[0];

                  const renderDraftCard = (draft: typeof autonomousContentAssets[0], showSummary = false, isBestDraft = false) => {
                    const createdAt = new Date(draft.createdAt).getTime();
                    const now = Date.now();
                    const isNew = (now - createdAt) < 24 * 60 * 60 * 1000;
                    const statusLabel = draft.contentStatus === "ready" ? "Ready to publish" : draft.contentStatus === "draft" ? "Ready to review" : draft.contentStatus === "review" ? "Needs revision" : draft.contentStatus;
                    const timeAgo = formatTimeAgo(new Date(draft.createdAt));
                    const nextAction = "Review";

                    const displayHook = draft.finalHook || draft.hook;
                    const displayBody = draft.finalBody || draft.body;

                    // Find source opportunity context
                    const sourceOpportunity = draft.sourceMatchedOpportunityId
                      ? matchedOpportunities.find(opp => opp.id === draft.sourceMatchedOpportunityId)
                      : null;

                    // Determine selection reasoning
                    const selectionReason = (() => {
                      if (draft.finalStatus === "ready") return "Auto-approved based on quality score";
                      if (draft.finalQualityScore !== undefined && draft.finalQualityScore >= 7) return "High quality score from critic";
                      if (draft.contentStatus === "ready") return "Previously approved by you";
                      if (isNew) return "Recently created";
                      return "Awaiting review";
                    })();

                    return (
                      <div key={draft.id} data-testid={`draft-card-${draft.id}`} className="rounded-lg border border-slate-200 bg-white p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-semibold text-slate-900">{displayHook}</p>
                              {isNew && (
                                <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-700">New</span>
                              )}
                              {draft.finalStatus === "ready" && (
                                <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-700">Auto-approved</span>
                              )}
                              {draft.finalQualityScore !== undefined && draft.finalQualityScore >= 7 && (
                                <span className="rounded bg-purple-100 px-1.5 py-0.5 text-xs font-medium text-purple-700">High quality</span>
                              )}
                            </div>
                            {showSummary && displayBody ? (
                              <p className="mt-2 text-sm text-slate-700 leading-relaxed">{displayBody.slice(0, 180)}{displayBody.length > 180 ? "..." : ""}</p>
                            ) : draft.bestAngle ? (
                              <p className="mt-2 text-sm text-slate-600 italic">"{draft.bestAngle}"</p>
                            ) : null}
                            {isBestDraft && sourceOpportunity ? (
                              <div className="mt-3 rounded border border-slate-200 bg-slate-50 px-3 py-2">
                                <p className="text-xs font-medium text-slate-700">📍 Source context</p>
                                <p className="mt-1 text-xs text-slate-600">
                                  {sourceOpportunity.title || "Matched opportunity"}
                                </p>
                                {sourceOpportunity.matchRationale ? (
                                  <p className="mt-1 text-xs text-slate-500">{sourceOpportunity.matchRationale.slice(0, 100)}...</p>
                                ) : null}
                              </div>
                            ) : null}
                            <div className="mt-3 flex items-center gap-3 text-xs text-slate-500">
                              <span>{statusLabel}</span>
                              <span>•</span>
                              <span>{timeAgo}</span>
                              {!isBestDraft && draft.finalQualityScore !== undefined ? (
                                <>
                                  <span>•</span>
                                  <span>Quality: {draft.finalQualityScore}/10</span>
                                </>
                              ) : null}
                            </div>
                            {isBestDraft ? (
                              <div className="mt-2">
                                <p className="text-xs text-emerald-700 font-medium">💡 {selectionReason}</p>
                              </div>
                            ) : null}
                          </div>
                          <div className="flex flex-col gap-2 items-end">
                            <button
                              className="rounded-lg border border-slate-900 bg-slate-900 text-white px-4 py-2 text-sm font-medium hover:bg-slate-800"
                              onClick={() => handleOpenDraftReview(draft)}
                              type="button"
                            >
                              {nextAction}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  };

                  return (
                    <>
                      {topDraft && (
                        <Card className="border-2 border-emerald-200 bg-emerald-50">
                          <div className="flex items-start gap-3">
                            <div className="mt-1 flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-white font-bold text-sm">
                              1
                            </div>
                            <div className="flex-1">
                              <h3 className="font-semibold text-emerald-900">Best draft to review now</h3>
                              <p className="mt-1 text-sm text-emerald-800">
                                {topDraft.contentStatus === "ready" ? "System approved this draft based on quality signals" : "Most recent high-quality draft from autonomous system"}
                              </p>
                            </div>
                          </div>
                          <div className="mt-4">
                            {renderDraftCard(topDraft, true, true)}
                          </div>
                        </Card>
                      )}

                      {diverseReviewDrafts.length > 1 && (
                        <Card role="region" aria-label="Review first">
                          <h3 className="text-lg font-semibold">Next drafts ({diverseReviewDrafts.length - 1})</h3>
                          <div className="mt-4 space-y-3">
                            {diverseReviewDrafts.slice(1, 6).map(draft => renderDraftCard(draft))}
                          </div>
                        </Card>
                      )}

                      {needsEditDrafts.length > 0 && (
                        <details className="rounded-lg border border-slate-200 bg-white p-4">
                          <summary className="cursor-pointer text-sm font-medium text-slate-600">
                            Needs revision ({needsEditDrafts.length})
                          </summary>
                          <div className="mt-3 space-y-3" role="region" aria-label="Needs edit">
                            {needsEditDrafts.slice(0, 3).map(draft => renderDraftCard(draft))}
                          </div>
                        </details>
                      )}

                      {archivedDrafts.length > 0 && (
                        <details className="rounded-lg border border-slate-200 bg-white p-4">
                          <summary className="cursor-pointer text-sm font-medium text-slate-600">
                            Archived ({archivedDrafts.length})
                          </summary>
                          <div className="mt-3 space-y-3">
                            {archivedDrafts.slice(0, 3).map(draft => renderDraftCard(draft))}
                          </div>
                        </details>
                      )}
                    </>
                  );
                })()}
              </section>
            ) : operatorDashboardMode === "control" ? (
              <section className="mb-6 space-y-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-bold">🎛️ Control & Monitoring</h2>
                  <p className="text-sm text-slate-600">System health, runtime status, watchlists, and content flow oversight</p>
                </div>

            {operatorControlStatus && (
              <section className="mt-6">
                <Card>
                  <div className="mb-4 flex items-center gap-2">
                    <Radar className="h-5 w-5 text-emerald-600" />
                    <h3 className="text-lg font-semibold">Operator Control</h3>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                    {/* Runtime Health */}
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">Runtime</span>
                        {operatorControlStatus.runtimeHealth.schedulerEnabled ? (
                          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                            Active
                          </span>
                        ) : (
                          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">
                            Inactive
                          </span>
                        )}
                      </div>
                      <div className="mt-2 space-y-1">
                        {operatorControlStatus.runtimeHealth.lastTickAt && (
                          <p className="text-xs text-slate-600">
                            Last: {formatTimeAgo(new Date(operatorControlStatus.runtimeHealth.lastTickAt))}
                          </p>
                        )}
                        {operatorControlStatus.runtimeHealth.failedRunsCount > 0 && (
                          <p className="text-xs font-medium text-red-600">
                            {operatorControlStatus.runtimeHealth.failedRunsCount} failed runs
                          </p>
                        )}
                        {operatorControlStatus.runtimeHealth.staleRunsCount > 0 && (
                          <p className="text-xs font-medium text-amber-600">
                            {operatorControlStatus.runtimeHealth.staleRunsCount} stale runs
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Intake Health */}
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <span className="text-sm font-medium">Intake</span>
                      <div className="mt-2 space-y-1">
                        <p className="text-xs text-slate-600">
                          {operatorControlStatus.intakeHealth.activeWatchlists}/{operatorControlStatus.intakeHealth.totalWatchlists} active watchlists
                        </p>
                        <p className="text-xs text-slate-600">
                          {operatorControlStatus.intakeHealth.recentSuccessfulRuns}/{operatorControlStatus.intakeHealth.last10RunsTotal} recent runs OK
                        </p>
                      </div>
                    </div>

                    {/* Opportunity Flow */}
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <span className="text-sm font-medium">Opportunities</span>
                      <div className="mt-2 space-y-1">
                        <p className="text-xs text-slate-600">
                          {operatorControlStatus.opportunityFlow.reviewQueueSize} in review queue
                        </p>
                        <p className="text-xs text-slate-600">
                          {operatorControlStatus.opportunityFlow.newMatchesCount} new matches
                        </p>
                        <p className="text-xs text-slate-600">
                          {operatorControlStatus.opportunityFlow.workItemsCount} work items
                        </p>
                      </div>
                    </div>

                    {/* Draft Flow */}
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <span className="text-sm font-medium">Drafts</span>
                      <div className="mt-2 space-y-1">
                        <p className="text-xs text-slate-600">
                          {operatorControlStatus.draftFlow.readyForReview} ready for review
                        </p>
                        {operatorControlStatus.draftFlow.blocked > 0 && (
                          <p className="text-xs font-medium text-red-600">
                            {operatorControlStatus.draftFlow.blocked} blocked
                          </p>
                        )}
                        <p className="text-xs text-slate-600">
                          {operatorControlStatus.draftFlow.totalActive} total active
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    {/* Provider Truth */}
                    <div className="rounded-lg border border-slate-200 bg-white p-3">
                      <span className="text-sm font-medium">Provider Status</span>
                      <div className="mt-2 space-y-1">
                        <p className="text-xs text-slate-600">
                          Mode: <span className="font-medium">{operatorControlStatus.providerTruth.mode}</span>
                        </p>
                        <p className="text-xs text-slate-600">
                          Text: {operatorControlStatus.providerTruth.textProvider || "none"}
                        </p>
                        <p className="text-xs text-slate-600">
                          AI Active: {operatorControlStatus.providerTruth.aiActive ? "Yes" : "No"}
                        </p>
                      </div>
                    </div>

                    {/* Learning Truth */}
                    <div className="rounded-lg border border-slate-200 bg-white p-3">
                      <span className="text-sm font-medium">Learning Status</span>
                      <div className="mt-2 space-y-1">
                        <p className="text-xs text-slate-600">
                          {operatorControlStatus.learningTruth.recentAnalyticsCount} analytics (30d)
                        </p>
                        <p className="text-xs text-slate-600">
                          {operatorControlStatus.learningTruth.strongPatternsCount} strong patterns
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Operator Attention */}
                  <div className="mt-4 grid gap-4 md:grid-cols-3">
                    {operatorControlStatus.operatorAttention.needsReview.length > 0 && (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                        <span className="text-sm font-medium text-amber-900">Needs Review</span>
                        <ul className="mt-2 space-y-1">
                          {operatorControlStatus.operatorAttention.needsReview.map((item, i) => (
                            <li key={i} className="text-xs text-amber-800">{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {operatorControlStatus.operatorAttention.degraded.length > 0 && (
                      <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                        <span className="text-sm font-medium text-red-900">Degraded</span>
                        <ul className="mt-2 space-y-1">
                          {operatorControlStatus.operatorAttention.degraded.map((item, i) => (
                            <li key={i} className="text-xs text-red-800">{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {operatorControlStatus.operatorAttention.healthy.length > 0 && (
                      <div className="rounded-lg border border-green-200 bg-green-50 p-3">
                        <span className="text-sm font-medium text-green-900">Healthy</span>
                        <ul className="mt-2 space-y-1">
                          {operatorControlStatus.operatorAttention.healthy.map((item, i) => (
                            <li key={i} className="text-xs text-green-800">{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </Card>
              </section>
            )}

            <section className="mt-6">
              <Card>
                <div className="flex items-center gap-2">
                  <Bookmark className="h-5 w-5 text-slate-600" />
                  <div>
                    <p className="text-sm text-muted">Operator Watchlists</p>
                    <h3 className="text-lg font-semibold">
                      Store watched sources for future live snapshots
                    </h3>
                  </div>
                </div>
                <form className="mt-4 grid gap-4 xl:grid-cols-2" onSubmit={handleAddWatchlistItem}>
                  <div>
                    <label className="text-sm font-medium" htmlFor="watchlist-source-kind">
                      Watchlist source kind
                    </label>
                    <select
                      id="watchlist-source-kind"
                      className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      value={watchlistForm.sourceKind}
                      onChange={(event) =>
                        setWatchlistForm((current) => ({
                          ...current,
                          sourceKind: event.target.value as WatchlistItem["sourceKind"]
                        }))
                      }
                    >
                      <option value="watched_url">watched_url</option>
                      <option value="github_repo">github_repo</option>
                      <option value="github_release">github_release</option>
                      <option value="github_issue">github_issue</option>
                      <option value="article_source">article_source</option>
                      <option value="public_discussion_source">public_discussion_source</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-medium" htmlFor="watchlist-label">
                      Watchlist label
                    </label>
                    <input
                      id="watchlist-label"
                      className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      placeholder="Source name"
                      value={watchlistForm.label}
                      onChange={(event) =>
                        setWatchlistForm((current) => ({
                          ...current,
                          label: event.target.value
                        }))
                      }
                    />
                  </div>
                  <div className="xl:col-span-2">
                    <label className="text-sm font-medium" htmlFor="watchlist-source-url">
                      Watchlist source URL
                    </label>
                    <input
                      id="watchlist-source-url"
                      className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      placeholder="Optional source URL"
                      value={watchlistForm.sourceUrl}
                      onChange={(event) =>
                        setWatchlistForm((current) => ({
                          ...current,
                          sourceUrl: event.target.value
                        }))
                      }
                    />
                  </div>
                  <div className="xl:col-span-2">
                    <label className="text-sm font-medium" htmlFor="watchlist-notes">
                      Watchlist notes
                    </label>
                    <textarea
                      id="watchlist-notes"
                      className="mt-1 min-h-20 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      placeholder="Optional notes for future snapshots"
                      value={watchlistForm.notes}
                      onChange={(event) =>
                        setWatchlistForm((current) => ({
                          ...current,
                          notes: event.target.value
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium" htmlFor="watchlist-refresh-cadence">
                      Refresh cadence
                    </label>
                    <select
                      id="watchlist-refresh-cadence"
                      className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                      value={watchlistForm.refreshCadence}
                      onChange={(event) =>
                        setWatchlistForm((current) => ({
                          ...current,
                          refreshCadence: event.target.value as WatchlistItem["refreshCadence"]
                        }))
                      }
                    >
                      <option value="manual_only">Manual only</option>
                      <option value="daily_candidate">Daily candidate</option>
                      <option value="weekly_candidate">Weekly candidate</option>
                    </select>
                  </div>
                  <div className="flex items-end">
                    <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                      <input
                        checked={watchlistForm.priority === "high"}
                        onChange={(event) =>
                          setWatchlistForm((current) => ({
                            ...current,
                            priority: event.target.checked ? "high" : "normal"
                          }))
                        }
                        type="checkbox"
                      />
                      <span>High priority</span>
                    </label>
                  </div>
                  <div className="flex items-end">
                    <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                      <input
                        checked={watchlistForm.enableAutoPromotion}
                        onChange={(event) =>
                          setWatchlistForm((current) => ({
                            ...current,
                            enableAutoPromotion: event.target.checked,
                            enableAutoDraft: event.target.checked ? current.enableAutoDraft : false
                          }))
                        }
                        type="checkbox"
                      />
                      <span>Auto-promote opportunities</span>
                    </label>
                  </div>
                  <div className="flex items-end">
                    <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                      <input
                        checked={watchlistForm.enableAutoDraft}
                        disabled={!watchlistForm.enableAutoPromotion}
                        onChange={(event) =>
                          setWatchlistForm((current) => ({
                            ...current,
                            enableAutoDraft: event.target.checked
                          }))
                        }
                        type="checkbox"
                      />
                      <span>Auto-generate drafts</span>
                    </label>
                  </div>
                  <button
                    className="w-fit rounded-lg border border-border px-3 py-2 text-sm font-medium xl:col-span-2"
                    type="submit"
                  >
                    Add to Watchlist
                  </button>
                </form>
                {watchlistActionMessage ? (
                  <p className="mt-4 text-sm text-slate-600">{watchlistActionMessage}</p>
                ) : null}
                {watchlistItems.length > 0 ? (
                  <div className="mt-4 rounded-lg border border-border bg-white p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      {renderCompactBadge(`${watchlistItems.length} watched`, "neutral")}
                      {watchlistItems.length !== filteredWatchlistItems.length
                        ? renderCompactBadge(`${filteredWatchlistItems.length} visible`, "neutral")
                        : null}
                      <button
                        className="rounded-lg border border-border px-2 py-1 text-xs font-medium"
                        onClick={handleRefreshActiveWatchlists}
                        type="button"
                      >
                        Refresh active watchlists
                      </button>
                      <button
                        className="rounded-lg border border-border px-2 py-1 text-xs font-medium"
                        onClick={() => handleRefreshWatchlistsByCadence("daily_candidate")}
                        type="button"
                      >
                        Refresh daily candidates
                      </button>
                      <button
                        className="rounded-lg border border-border px-2 py-1 text-xs font-medium"
                        onClick={() => handleRefreshWatchlistsByCadence("weekly_candidate")}
                        type="button"
                      >
                        Refresh weekly candidates
                      </button>
                    </div>
                    <div className="mt-4 space-y-3 rounded-lg border border-border bg-slate-50 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {(
                          [
                            ["all", "All"],
                            ["active", "Active"],
                            ["inactive", "Inactive"]
                          ] as const
                        ).map(([value, label]) => (
                          <button
                            key={value}
                            aria-pressed={activeWatchlistFilter === value}
                            className={`rounded-full border px-3 py-1 text-xs font-medium ${
                              activeWatchlistFilter === value
                                ? "border-slate-900 bg-slate-900 text-white"
                                : "border-border bg-white text-slate-700"
                            }`}
                            onClick={() => setActiveWatchlistFilter(value)}
                            type="button"
                          >
                            {label} (
                            {
                              watchlistFilterCounts[
                                value as keyof typeof watchlistFilterCounts
                              ]
                            }
                            )
                          </button>
                        ))}
                      </div>
                      <div className="grid gap-3 md:grid-cols-3">
                        <label className="text-xs font-medium text-slate-600">
                          <span className="block">Cadence filter</span>
                          <select
                            aria-label="Watchlist cadence filter"
                            className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm"
                            onChange={(event) =>
                              setActiveWatchlistCadenceFilter(
                                event.target.value as WatchlistCadenceFilter
                              )
                            }
                            value={activeWatchlistCadenceFilter}
                          >
                            {(
                              [
                                "all",
                                "manual_only",
                                "daily_candidate",
                                "weekly_candidate"
                              ] as const
                            ).map((value) => (
                              <option key={value} value={value}>
                                {formatWatchlistCadenceLabel(value)} (
                                {
                                  watchlistCadenceFilterCounts[
                                    value as keyof typeof watchlistCadenceFilterCounts
                                  ]
                                }
                                )
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="text-xs font-medium text-slate-600">
                          <span className="block">Priority filter</span>
                          <select
                            aria-label="Watchlist priority filter"
                            className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm"
                            onChange={(event) =>
                              setActiveWatchlistPriorityFilter(
                                event.target.value as WatchlistPriorityFilter
                              )
                            }
                            value={activeWatchlistPriorityFilter}
                          >
                            {(["all", "high", "normal"] as const).map((value) => (
                              <option key={value} value={value}>
                                {formatWatchlistPriorityLabel(value)} (
                                {
                                  watchlistPriorityFilterCounts[
                                    value as keyof typeof watchlistPriorityFilterCounts
                                  ]
                                }
                                )
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="text-xs font-medium text-slate-600">
                          <span className="block">Source kind filter</span>
                          <select
                            aria-label="Watchlist source kind filter"
                            className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm"
                            onChange={(event) =>
                              setActiveWatchlistSourceKindFilter(
                                event.target.value as WatchlistSourceKindFilter
                              )
                            }
                            value={activeWatchlistSourceKindFilter}
                          >
                            {(
                              [
                                "all",
                                "watched_url",
                                "github_repo",
                                "github_release",
                                "github_issue",
                                "article_source",
                                "public_discussion_source"
                              ] as const
                            ).map((value) => (
                              <option key={value} value={value}>
                                {formatWatchlistSourceKindLabel(value)} (
                                {
                                  watchlistSourceKindFilterCounts[
                                    value as keyof typeof watchlistSourceKindFilterCounts
                                  ]
                                }
                                )
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    </div>
                    <div className="mt-4 space-y-3">
                      {filteredWatchlistItems.length > 0 ? (
                        filteredWatchlistItems.map((item) => (
                        <div key={item.id} className="rounded-lg border border-border p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium">{item.label}</p>
                            {renderCompactBadge(item.sourceKind, "neutral")}
                            {renderCompactBadge(item.isActive ? "active" : "inactive", "neutral")}
                            {renderCompactBadge(item.refreshCadence.replace(/_/g, " "), "neutral")}
                            {item.priority === "high"
                              ? renderCompactBadge("high priority", "support")
                              : null}
                          </div>
                          {item.sourceUrl ? (
                            <p className="mt-1 text-xs text-slate-500">{item.sourceUrl}</p>
                          ) : null}
                          {item.notes ? (
                            <p className="mt-2 text-sm text-slate-700">{item.notes}</p>
                          ) : null}
                          {item.lastUsedAt ? (
                            <p className="mt-2 text-xs text-slate-500">
                              Last used: {new Date(item.lastUsedAt).toLocaleString()}
                            </p>
                          ) : null}
                          {item.lastRefreshedAt ? (
                            <p className="mt-1 text-xs text-slate-500">
                              Last refreshed: {new Date(item.lastRefreshedAt).toLocaleString()}
                            </p>
                          ) : null}
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              className="rounded-lg border border-border px-2 py-1 text-xs font-medium"
                              onClick={() => handleUseWatchlistForSnapshot(item)}
                              type="button"
                            >
                              Use for snapshot
                            </button>
                            <button
                              className="rounded-lg border border-border px-2 py-1 text-xs font-medium"
                              onClick={() => handleCreateWatchlistSnapshot(item)}
                              type="button"
                            >
                              Create snapshot
                            </button>
                            <button
                              className="rounded-lg border border-border px-2 py-1 text-xs font-medium"
                              disabled={!item.isActive}
                              onClick={() => handleRefreshWatchlistItem(item)}
                              type="button"
                            >
                              Refresh now
                            </button>
                            <button
                              className="rounded-lg border border-border px-2 py-1 text-xs font-medium text-slate-600"
                              onClick={() => handleSetWatchlistActive(item.id, !item.isActive)}
                              type="button"
                            >
                              {item.isActive ? "Deactivate" : "Activate"}
                            </button>
                            <button
                              className="rounded-lg border border-border px-2 py-1 text-xs font-medium text-slate-600"
                              onClick={() => handleRemoveWatchlistItem(item.id)}
                              type="button"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                        ))
                      ) : (
                        <p className="text-sm text-slate-500">
                          No watchlists match these filters.
                        </p>
                      )}
                    </div>
                    <p className="mt-3 text-sm text-slate-500">
                      Watchlists define sources only. They do not fetch or run scout processing.
                    </p>
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-slate-500">
                    Add watched sources here so future live snapshots are faster to capture.
                  </p>
                )}
              </Card>
            </section>
            </section>
            ) : operatorDashboardMode === "lab" ? (
              renderLabSurface()
            ) : operatorDashboardMode === "legacy" ? (
              <section className="mb-6 space-y-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-bold">📋 Legacy Manual Workflow</h2>
                  <p className="text-sm text-slate-600">Fallback manual content creation path</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="text-sm text-slate-700">
                    Manual signal → idea → content workflow. Use only when autonomous system cannot handle your use case.
                  </p>
                </div>

                {renderLegacyManualWorkflow()}
              </section>
            ) : operatorDashboardMode === "factory" ? (
              <section className="mb-6">
                <FactoryDashboard
                  apiBaseUrl={apiBaseUrl}
                  authToken={window.localStorage.getItem("linkedin-brand-os:operator-auth-token") ?? ""}
                />
              </section>
            ) : null}

            {/* Draft Review Dialog */}
            {reviewingDraftDocument ? (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
                onClick={handleCloseDraftReview}
              >
                <div
                  role="dialog"
                  aria-label="Draft review"
                  className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                          {reviewingDraftDocument.finalHook || reviewingDraftDocument.finalBody ? "LinkedIn-Ready Post" : "Draft Content"}
                        </span>
                        {reviewingDraftDocument.finalStatus === "ready" && (
                          <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">Auto-approved</span>
                        )}
                        {reviewingDraftDocument.finalQualityScore !== undefined && (
                          <span className="rounded bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
                            Quality: {reviewingDraftDocument.finalQualityScore}/10
                          </span>
                        )}
                      </div>
                      <div className="mt-3 whitespace-pre-wrap rounded-lg border-2 border-slate-200 bg-white p-6 text-base leading-relaxed">
                        {reviewingDraftDocument.finalHook || reviewingDraftDocument.finalBody ? (
                          <>
                            <div className="font-semibold text-lg text-slate-900">{reviewingDraftDocument.finalHook}</div>
                            {reviewingDraftDocument.finalBody && (
                              <div className="mt-4 text-slate-800">{reviewingDraftDocument.finalBody}</div>
                            )}
                            {reviewingDraftDocument.finalClosing && (
                              <div className="mt-4 text-slate-700">{reviewingDraftDocument.finalClosing}</div>
                            )}
                          </>
                        ) : (
                          <>
                            <div className="font-semibold text-lg text-slate-900">{reviewingDraftDocument.hook}</div>
                            {reviewingDraftDocument.body && (
                              <div className="mt-4 text-slate-800">{reviewingDraftDocument.body}</div>
                            )}
                            {reviewingDraftDocument.cta && (
                              <div className="mt-4 text-slate-700 italic">{reviewingDraftDocument.cta}</div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                    <button
                      className="rounded-lg p-2 hover:bg-slate-100 flex-shrink-0"
                      onClick={handleCloseDraftReview}
                      type="button"
                      aria-label="Close dialog"
                    >
                      <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  {/* Context and reasoning */}
                  <div className="mt-6 grid gap-4 md:grid-cols-2">
                    {(() => {
                      const sourceOpportunity = reviewingDraftDocument.sourceMatchedOpportunityId
                        ? matchedOpportunities.find(opp => opp.id === reviewingDraftDocument.sourceMatchedOpportunityId)
                        : null;

                      return sourceOpportunity ? (
                        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                          <p className="text-xs font-semibold uppercase tracking-wider text-blue-900">Source Context</p>
                          <p className="mt-2 text-sm font-medium text-blue-900">
                            {sourceOpportunity.title || "Matched opportunity"}
                          </p>
                          {sourceOpportunity.matchRationale && (
                            <p className="mt-1 text-sm text-blue-800">{sourceOpportunity.matchRationale}</p>
                          )}
                        </div>
                      ) : null;
                    })()}

                    {reviewingDraftDocument.bestAngle && (
                      <div className="rounded-lg border border-purple-200 bg-purple-50 p-4">
                        <p className="text-xs font-semibold uppercase tracking-wider text-purple-900">Content Angle</p>
                        <p className="mt-2 text-sm text-purple-800 italic">"{reviewingDraftDocument.bestAngle}"</p>
                        <p className="mt-2 text-xs text-purple-700">This angle was selected by the autonomous system to best position this content for your audience.</p>
                      </div>
                    )}
                  </div>

                  {/* Status and metadata */}
                  <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-slate-600">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">Status:</span>
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium">
                        {reviewingDraftDocument.contentStatus === "ready" ? "Ready to publish" : reviewingDraftDocument.contentStatus === "draft" ? "Draft" : reviewingDraftDocument.contentStatus}
                      </span>
                    </div>
                    <span className="text-slate-400">•</span>
                    <span>Created {formatTimeAgo(new Date(reviewingDraftDocument.createdAt))}</span>
                    {reviewingDraftDocument.finalStatus && (
                      <>
                        <span className="text-slate-400">•</span>
                        <span className="capitalize">{reviewingDraftDocument.finalStatus.replace(/_/g, ' ')}</span>
                      </>
                    )}
                  </div>

                  {draftReviewError ? (
                    <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4">
                      <p className="text-sm font-medium text-red-900">Action failed</p>
                      <p className="mt-1 text-sm text-red-700">{draftReviewError}</p>
                    </div>
                  ) : null}

                  {/* Quick outcome entry after approval */}
                  {reviewingDraftDocument.contentStatus === "ready" && (
                    <details className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                      <summary className="cursor-pointer text-sm font-semibold text-emerald-900">
                        📊 Record performance after publishing (optional)
                      </summary>
                      <div className="mt-4 text-sm text-emerald-800">
                        <p className="mb-3">After you publish this draft to LinkedIn, come back to record the outcome:</p>
                        <ol className="list-decimal list-inside space-y-1 text-xs">
                          <li>Publish this post to LinkedIn</li>
                          <li>Wait 24-48 hours for engagement</li>
                          <li>Switch to Control surface → Analytics section</li>
                          <li>Record impressions, likes, comments to feed learning back</li>
                        </ol>
                        <p className="mt-3 text-xs text-emerald-700">
                          Recording outcomes helps the system learn what content performs well for your audience.
                        </p>
                      </div>
                    </details>
                  )}

                  {/* Action buttons */}
                  <div className="mt-6 flex items-center justify-between gap-3">
                    <button
                      className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-slate-50"
                      onClick={handleCloseDraftReview}
                      type="button"
                      disabled={draftReviewActionInProgress}
                    >
                      Close
                    </button>
                    <div className="flex items-center gap-3">
                      <button
                        className="rounded-lg border border-slate-300 bg-slate-100 px-4 py-2 text-sm font-medium hover:bg-slate-200"
                        onClick={() => void handleDraftReviewAction(reviewingDraftDocument.id, "archived")}
                        type="button"
                        disabled={draftReviewActionInProgress}
                      >
                        {draftReviewActionInProgress ? "Processing..." : "Archive"}
                      </button>
                      {reviewingDraftDocument.contentStatus !== "review" && (
                        <button
                          className="rounded-lg border border-amber-300 bg-amber-100 px-4 py-2 text-sm font-medium hover:bg-amber-200"
                          onClick={() => void handleDraftReviewAction(reviewingDraftDocument.id, "review")}
                          type="button"
                          disabled={draftReviewActionInProgress}
                        >
                          {draftReviewActionInProgress ? "Processing..." : "Needs revision"}
                        </button>
                      )}
                      {reviewingDraftDocument.contentStatus !== "ready" && (
                        <button
                          className="rounded-lg bg-emerald-600 px-6 py-2 text-sm font-medium text-white hover:bg-emerald-700 font-semibold"
                          onClick={() => void handleDraftReviewAction(reviewingDraftDocument.id, "ready")}
                          type="button"
                          disabled={draftReviewActionInProgress}
                        >
                          {draftReviewActionInProgress ? "Processing..." : "✓ Approve for publish"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </main>
        </div>
      </div>
    </div>
  );
}

function getAIScoutEnrichmentLines(
  kind: "audience" | "solution" | "match",
  enrichment: AIScoutEnrichment | undefined
): string[] {
  if (!enrichment) {
    return [];
  }

  const preferredDetailsByKind: Record<"audience" | "solution" | "match", Array<string | undefined>> = {
    audience: [enrichment.improvedSummary, enrichment.businessConsequence],
    solution: [enrichment.improvedSummary, enrichment.operatorAngle],
    match: [
      enrichment.whyItMatters,
      enrichment.businessConsequence,
      enrichment.operatorAngle
    ]
  };
  const fallbackDetails = [
    enrichment.improvedSummary,
    enrichment.whyItMatters,
    enrichment.businessConsequence,
    enrichment.operatorAngle
  ];

  const orderedDetails = [...preferredDetailsByKind[kind], ...fallbackDetails].filter(
    (detail): detail is string => typeof detail === "string" && detail.trim().length > 0
  );

  return Array.from(new Set(orderedDetails)).slice(0, 2);
}

function supportsMatchContentGeneration(item: PersistedMatchedOpportunity) {
  return (
    item.status === "reviewed" &&
    (item.match.recommendedAction === "write_post" ||
      item.match.recommendedAction === "write_comment" ||
      item.match.recommendedAction === "save_for_later")
  );
}

function getAIContentGenerationLines(
  action: MatchedOpportunity["recommendedAction"],
  content: AIContentGeneration | undefined
): Array<{ label: string; value: string }> {
  if (!content) {
    return [];
  }

  if (action === "write_post") {
    return [
      { label: "Content idea", value: content.contentIdea ?? "" },
      { label: "Draft angle", value: content.draftAngle ?? "" },
      { label: "Post seed", value: content.postSeed ?? "" }
    ].filter((line) => line.value.trim().length > 0);
  }

  if (action === "write_comment") {
    return [
      { label: "Content idea", value: content.contentIdea ?? "" },
      { label: "Draft angle", value: content.draftAngle ?? "" },
      { label: "Comment seed", value: content.commentSeed ?? "" }
    ].filter((line) => line.value.trim().length > 0);
  }

  return [
    { label: "Content idea", value: content.contentIdea ?? "" },
    { label: "Angle stub", value: content.angleStub ?? "" }
  ].filter((line) => line.value.trim().length > 0);
}

function renderAIScoutEnrichment(
  kind: "audience" | "solution" | "match",
  enrichment: AIScoutEnrichment | undefined,
  label = "AI insight"
) {
  const details = getAIScoutEnrichmentLines(kind, enrichment);

  if (details.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/80 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        {label}
      </p>
      <div className="mt-2 space-y-1.5 text-sm text-slate-700">
        {details.map((detail) => (
          <p key={detail}>{detail}</p>
        ))}
      </div>
    </div>
  );
}

function renderAIContentGeneration(
  action: MatchedOpportunity["recommendedAction"],
  content: AIContentGeneration | undefined
) {
  const lines = getAIContentGenerationLines(action, content);

  if (lines.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/70 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-emerald-700">
        AI content prep
      </p>
      <div className="mt-2 space-y-1.5 text-sm text-slate-700">
        {lines.map((line) => (
          <p key={line.label}>
            <span className="font-medium">{line.label}:</span> {line.value}
          </p>
        ))}
      </div>
    </div>
  );
}
