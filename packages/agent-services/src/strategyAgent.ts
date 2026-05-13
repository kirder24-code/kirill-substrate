import type {
  ContentAsset,
  FeedbackSummary,
  PatternMemorySummary,
  StrategyPriority,
  StrategyRecommendation,
  StrategyType
} from "@linkedin-brand-os/shared";
import type { AnalyticsFindings } from "./analyticsAgent";

export interface StrategyAgentInput {
  findings: AnalyticsFindings;
  contentAssets: ContentAsset[];
  feedbackSummary?: FeedbackSummary;
  patternMemorySummary?: PatternMemorySummary;
}

interface DraftRecommendation {
  type: StrategyType;
  title: string;
  description: string;
  priority: StrategyPriority;
}

export async function strategyAgent(
  input: StrategyAgentInput
): Promise<DraftRecommendation[]> {
  const recommendations: DraftRecommendation[] = [];
  const bestContent = input.contentAssets.find(
    (asset) => asset.id === input.findings.bestPerformingContentId
  );

  if (bestContent) {
    recommendations.push({
      type: "audience",
      title: "Double down on founder-facing operational posts",
      description: `The strongest content so far is tied to ${bestContent.hook.toLowerCase()}, which suggests practical operator content is landing well.`,
      priority: "high"
    });
  }

  if (input.findings.notes.some((note) => note.includes("Visual-linked"))) {
    recommendations.push({
      type: "format",
      title: "Visuals are increasing engagement",
      description: "Keep generating visual briefs for posts with clear operational takeaways.",
      priority: "medium"
    });
  }

  if (input.findings.averageEngagementRate < 0.05) {
    recommendations.push({
      type: "messaging",
      title: "Reduce generic AI commentary",
      description: "Posts need clearer stakes, practical language, and less abstract framing.",
      priority: "high"
    });
  } else {
    recommendations.push({
      type: "messaging",
      title: "Shorter hooks appear stronger",
      description: "Lead with the operational payoff early and keep the opening tighter.",
      priority: "medium"
    });
  }

  if (input.feedbackSummary && input.feedbackSummary.totalRecords > 0) {
    if (input.feedbackSummary.suggestedRepeats.length > 0) {
      recommendations.push({
        type: "messaging",
        title: "Repeat the strongest operator themes",
        description: `Recent feedback suggests these patterns are worth repeating: ${input.feedbackSummary.suggestedRepeats.join(" ")}`,
        priority: "high"
      });
    }

    if (input.feedbackSummary.suggestedAvoids.length > 0) {
      recommendations.push({
        type: "cadence",
        title: "Deprioritize weaker patterns this week",
        description: `Recent feedback suggests caution around: ${input.feedbackSummary.suggestedAvoids.join(" ")}`,
        priority: "medium"
      });
    }
  }

  if (input.patternMemorySummary && input.patternMemorySummary.totalPatterns > 0) {
    if (input.patternMemorySummary.recurringThemes.length > 0) {
      recommendations.push({
        type: "messaging",
        title: "Reinforce recurring long-term themes",
        description: `Long-term memory keeps reinforcing these themes: ${input.patternMemorySummary.recurringThemes.join(", ")}.`,
        priority: "medium"
      });
    }

    if (input.patternMemorySummary.weakThemes.length > 0) {
      recommendations.push({
        type: "cadence",
        title: "Keep recurring weak themes deprioritized",
        description: `Long-term memory keeps flagging these patterns as weak: ${input.patternMemorySummary.weakThemes.join(", ")}.`,
        priority: "medium"
      });
    }
  }

  return recommendations;
}
