import type {
  Idea,
  MarketProfile,
  SourceItem,
  TopicScore
} from "@linkedin-brand-os/shared";

export interface TopicScoringAgentInput {
  sources: SourceItem[];
  ideas: Idea[];
  markets: MarketProfile[];
}

type DraftTopicScore = Omit<TopicScore, "id" | "createdAt">;

function scoreBrandRelevance(text: string) {
  const lower = text.toLowerCase();
  return Math.min(
    95,
    45 +
      (lower.includes("operator") ? 20 : 0) +
      (lower.includes("founder") ? 10 : 0) +
      (lower.includes("ai") ? 10 : 0) +
      (lower.includes("market") ? 5 : 0)
  );
}

function scoreNovelty(text: string) {
  return Math.min(90, 40 + new Set(text.toLowerCase().split(/\W+/)).size);
}

export async function topicScoringAgent(
  input: TopicScoringAgentInput
): Promise<DraftTopicScore[]> {
  const market = [...input.markets].sort((a, b) => b.serviceFitScore - a.serviceFitScore)[0];
  const marketScore = market
    ? Math.min(
        95,
        Math.round(
          market.serviceFitScore * 0.6 +
            (market.linkedinPriority === "high"
              ? 25
              : market.linkedinPriority === "medium"
                ? 15
                : 5)
        )
      )
    : 40;

  const sourceScores = input.sources.map((source) => {
    const brandRelevanceScore = scoreBrandRelevance(
      `${source.title} ${source.normalizedSummary} ${source.tags.join(" ")}`
    );
    const noveltyScore = scoreNovelty(source.normalizedSummary);
    const priorityScore = Math.round(
      brandRelevanceScore * 0.45 + marketScore * 0.35 + noveltyScore * 0.2
    );

    return {
      topicLabel: source.title,
      sourceItemId: source.id,
      marketProfileId: market?.id,
      brandRelevanceScore,
      marketRelevanceScore: marketScore,
      noveltyScore,
      priorityScore,
      rationale: `Source aligns with brand themes and ${
        market ? `${market.country} market fit` : "current market assumptions"
      }.`
    };
  });

  const ideaScores = input.ideas.map((idea) => {
    const brandRelevanceScore = scoreBrandRelevance(
      `${idea.title} ${idea.coreInsight} ${idea.businessRelevance}`
    );
    const noveltyScore = scoreNovelty(idea.coreInsight);
    const priorityScore = Math.round(
      brandRelevanceScore * 0.5 + marketScore * 0.3 + noveltyScore * 0.2
    );

    return {
      topicLabel: idea.title,
      ideaId: idea.id,
      marketProfileId: market?.id,
      brandRelevanceScore,
      marketRelevanceScore: marketScore,
      noveltyScore,
      priorityScore,
      rationale: `Idea shows brand fit and ${market ? "market relevance" : "broad market potential"}.`
    };
  });

  return [...sourceScores, ...ideaScores].sort(
    (left, right) => right.priorityScore - left.priorityScore
  );
}

