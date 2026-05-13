import type {
  AIScoutEnrichment,
  AudienceScoutItem,
  AutonomousReviewQueueItem,
  CreateAutonomousReviewQueueItemInput,
  SolutionScoutItem
} from "@linkedin-brand-os/shared";

export function mapScoutFeedResultToReviewQueueItems(input: {
  watchlistId: string;
  autonomousRunId: string;
  sourceArtifactId?: string;
  audienceItems?: AudienceScoutItem[];
  solutionItems?: SolutionScoutItem[];
}): CreateAutonomousReviewQueueItemInput[] {
  const audience = (input.audienceItems ?? []).map((item) =>
    buildAudienceQueueItem(input, item)
  );
  const solutions = (input.solutionItems ?? []).map((item) =>
    buildSolutionQueueItem(input, item)
  );
  return [...audience, ...solutions];
}

function buildAudienceQueueItem(
  input: {
    watchlistId: string;
    autonomousRunId: string;
    sourceArtifactId?: string;
  },
  item: AudienceScoutItem
): CreateAutonomousReviewQueueItemInput {
  return {
    watchlistId: input.watchlistId,
    autonomousRunId: input.autonomousRunId,
    sourceArtifactId: input.sourceArtifactId,
    sourceKind: "audience",
    dedupeKey: buildDedupeKey(
      input.watchlistId,
      "audience",
      item.painSignalSummary,
      mapSuggestedActionTypeToRecommendedAction(item.suggestedActionType)
    ),
    title: item.painSignalSummary,
    summary: item.rawExcerpt,
    rationale: item.whyItMatters,
    recommendedAction: mapSuggestedActionTypeToRecommendedAction(item.suggestedActionType),
    aiEnrichment: normalizeOptionalEnrichment(item.aiEnrichment)
  };
}

function buildSolutionQueueItem(
  input: {
    watchlistId: string;
    autonomousRunId: string;
    sourceArtifactId?: string;
  },
  item: SolutionScoutItem
): CreateAutonomousReviewQueueItemInput {
  return {
    watchlistId: input.watchlistId,
    autonomousRunId: input.autonomousRunId,
    sourceArtifactId: input.sourceArtifactId,
    sourceKind: "solution",
    dedupeKey: buildDedupeKey(
      input.watchlistId,
      "solution",
      item.solutionPattern,
      mapSuggestedActionTypeToRecommendedAction(item.suggestedActionType)
    ),
    title: item.solutionPattern,
    summary: item.implementationLesson,
    rationale: item.whyItMatters,
    recommendedAction: mapSuggestedActionTypeToRecommendedAction(item.suggestedActionType),
    aiEnrichment: normalizeOptionalEnrichment(item.aiEnrichment)
  };
}

function buildDedupeKey(
  watchlistId: string,
  sourceKind: AutonomousReviewQueueItem["sourceKind"],
  title: string,
  recommendedAction: AutonomousReviewQueueItem["recommendedAction"]
): string {
  return `${watchlistId}:${sourceKind}:${normalizeKey(title)}:${recommendedAction}`;
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function mapSuggestedActionTypeToRecommendedAction(
  suggestedActionType: "post_candidate" | "comment_opportunity" | "reply_opportunity" | "later"
): AutonomousReviewQueueItem["recommendedAction"] {
  if (suggestedActionType === "comment_opportunity") {
    return "write_comment";
  }
  if (suggestedActionType === "reply_opportunity") {
    return "write_reply";
  }
  if (suggestedActionType === "later") {
    return "save_for_later";
  }
  return "write_post";
}

function normalizeOptionalEnrichment(
  aiEnrichment: AIScoutEnrichment | undefined
): AIScoutEnrichment | undefined {
  if (!aiEnrichment) {
    return undefined;
  }

  const normalized: AIScoutEnrichment = {
    improvedSummary: normalizeOptionalString(aiEnrichment.improvedSummary),
    whyItMatters: normalizeOptionalString(aiEnrichment.whyItMatters),
    businessConsequence: normalizeOptionalString(aiEnrichment.businessConsequence),
    operatorAngle: normalizeOptionalString(aiEnrichment.operatorAngle),
    uncertaintyNote: normalizeOptionalString(aiEnrichment.uncertaintyNote)
  };

  return Object.values(normalized).some(Boolean) ? normalized : undefined;
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}
