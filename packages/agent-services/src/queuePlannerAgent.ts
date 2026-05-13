import type { ContentQueueItem, TopicScore } from "@linkedin-brand-os/shared";

export interface QueuePlannerAgentInput {
  topicScores: TopicScore[];
}

type DraftQueueItem = Omit<ContentQueueItem, "id" | "createdAt">;

export async function queuePlannerAgent(
  input: QueuePlannerAgentInput
): Promise<DraftQueueItem[]> {
  return input.topicScores
    .slice()
    .sort((left, right) => right.priorityScore - left.priorityScore)
    .slice(0, 8)
    .map((score) => ({
      topicScoreId: score.id,
      recommendedAction:
        score.priorityScore >= 75
          ? "write_post"
          : score.priorityScore >= 60
            ? "refine_post"
            : score.marketRelevanceScore >= 70
              ? "analyze_market"
              : "make_visual",
      priority:
        score.priorityScore >= 75
          ? "high"
          : score.priorityScore >= 55
            ? "medium"
            : "low",
      reason: `Topic "${score.topicLabel}" scored ${score.priorityScore} with rationale: ${score.rationale}`,
      status: "queued"
    }));
}

