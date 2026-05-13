import type {
  AudienceScoutItem,
  AutonomousMatchedOpportunity,
  AutonomousReviewQueueItem,
  CreateAutonomousMatchedOpportunityInput,
  SolutionScoutItem
} from "@linkedin-brand-os/shared";
import { prioritizeAutonomousMatchedOpportunity } from "./autonomousPrioritizedOpportunity";
import { buildScoutMatchResult } from "./scoutMatcher";

export function mapAutonomousReviewQueueToMatchedOpportunities(input: {
  watchlistId: string;
  autonomousRunId: string;
  queueItems: AutonomousReviewQueueItem[];
  activeQueueItems?: AutonomousReviewQueueItem[];
}): CreateAutonomousMatchedOpportunityInput[] {
  const activeQueueItems = input.activeQueueItems ?? input.queueItems;
  const audienceItems = input.queueItems.filter((item) => item.sourceKind === "audience");
  const solutionItems = input.queueItems.filter((item) => item.sourceKind === "solution");
  const activeAudienceItems = activeQueueItems.filter((item) => item.sourceKind === "audience");
  const activeSolutionItems = activeQueueItems.filter((item) => item.sourceKind === "solution");

  if (
    audienceItems.length === 0 ||
    solutionItems.length === 0 ||
    activeQueueItems.length === 0
  ) {
    return [];
  }

  const matchesByDedupeKey = new Map<string, CreateAutonomousMatchedOpportunityInput>();

  const appendMatches = (
    scopedAudienceItems: AutonomousReviewQueueItem[],
    scopedSolutionItems: AutonomousReviewQueueItem[]
  ): void => {
    if (scopedAudienceItems.length === 0 || scopedSolutionItems.length === 0) {
      return;
    }

    const matchResult = buildScoutMatchResult({
      audienceItems: scopedAudienceItems.map(toAudienceScoutItem),
      solutionItems: scopedSolutionItems.map(toSolutionScoutItem)
    });

    for (const item of matchResult.items) {
      const audienceQueueItem = audienceItems.find(
        (queueItem) => queueItem.id === item.audienceItemId
      );
      const solutionQueueItem = solutionItems.find(
        (queueItem) => queueItem.id === item.solutionItemId
      );
      const dedupeKey = `${audienceQueueItem?.id ?? item.audienceItemId}:${
        solutionQueueItem?.id ?? item.solutionItemId
      }`;

      matchesByDedupeKey.set(
        dedupeKey,
        prioritizeAutonomousMatchedOpportunity({
          watchlistId: input.watchlistId,
          autonomousRunId: input.autonomousRunId,
          audienceQueueItemId: audienceQueueItem?.id ?? item.audienceItemId,
          solutionQueueItemId: solutionQueueItem?.id ?? item.solutionItemId,
          dedupeKey,
          title: `${item.matchedPain} + ${item.matchedSolutionPattern}`,
          matchedPain: item.matchedPain,
          matchedSolutionPattern: item.matchedSolutionPattern,
          matchRationale: item.whyThisMatchWorks,
          suggestedAngle: item.suggestedAngle,
          recommendedAction: item.recommendedAction,
          confidence: item.confidence,
          opportunityStrength: item.opportunityStrength,
          scoreNotes: item.scoreNotes,
          aiEnrichment: item.aiEnrichment,
          aiContent: item.aiContent
        })
      );
    }
  };

  appendMatches(activeAudienceItems, solutionItems);
  appendMatches(audienceItems, activeSolutionItems);

  return [...matchesByDedupeKey.values()];
}

function toAudienceScoutItem(item: AutonomousReviewQueueItem): AudienceScoutItem {
  return {
    id: item.id,
    sourcePlatform: "public_web",
    rawExcerpt: item.summary,
    painSignalSummary: item.title,
    whyItMatters: item.rationale,
    suggestedActionType: toSuggestedActionType(item.recommendedAction),
    confidence: "high",
    aiEnrichment: item.aiEnrichment,
    createdAt: item.createdAt
  };
}

function toSolutionScoutItem(item: AutonomousReviewQueueItem): SolutionScoutItem {
  return {
    id: item.id,
    sourceType: "mixed",
    rawExcerpt: item.summary,
    solutionPattern: item.title,
    implementationLesson: item.summary,
    tradeoffOrConstraint: item.rationale,
    whyItMatters: item.rationale,
    suggestedAngle: "workflow_accountability",
    suggestedActionType: toSuggestedActionType(item.recommendedAction),
    confidence: "high",
    aiEnrichment: item.aiEnrichment,
    createdAt: item.createdAt
  };
}

function toSuggestedActionType(
  recommendedAction: AutonomousMatchedOpportunity["recommendedAction"]
): "post_candidate" | "comment_opportunity" | "reply_opportunity" | "later" {
  if (recommendedAction === "write_comment") {
    return "comment_opportunity";
  }
  if (recommendedAction === "write_reply") {
    return "reply_opportunity";
  }
  if (recommendedAction === "save_for_later") {
    return "later";
  }
  return "post_candidate";
}
