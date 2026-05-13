import type {
  DecisionLayerInput,
  DecisionPlan,
  RelevanceAnalysis
} from "@linkedin-brand-os/shared";

const operationalPatterns =
  /(workflow|handoff|owner|ownership|exception|accountability|process|ops|operations|automation|rollout|queue|approval|memory)/i;
const businessPatterns = /(roi|revenue|margin|cost|throughput|adoption|execution|pipeline)/i;
const softPatterns = /(mindset|motivation|personal brand|creativity|inspiration|leadership energy)/i;
const founderOperatorPatterns =
  /(founder|cofounder|operator|operations|ops|revops|sales ops|gtm|go-to-market|coo)/i;

function clean(parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function inferAngle(corpus: string): RelevanceAnalysis["bestAngle"] {
  if (/owner|ownership/i.test(corpus)) return "ownership_gap";
  if (/handoff|handoffs/i.test(corpus)) return "handoff_failure";
  if (/exception/i.test(corpus)) return "exception_handling";
  if (/accountability|workflow|process|queue|approval/i.test(corpus)) {
    return "workflow_accountability";
  }
  if (businessPatterns.test(corpus)) return "operational_roi";
  return "low_fit";
}

function inferRelevanceScore(input: DecisionLayerInput, corpus: string): number {
  let score = 0;
  if (founderOperatorPatterns.test(clean([input.authorRole, input.targetRole]))) score += 30;
  if (operationalPatterns.test(corpus)) score += 35;
  if (businessPatterns.test(corpus)) score += 18;
  if (input.hasCommentContext || input.hasReplyContext || input.postContext) score += 10;
  if (softPatterns.test(corpus)) score -= 30;
  return Math.max(0, Math.min(100, score));
}

export function buildDecisionPlan(input: DecisionLayerInput): DecisionPlan {
  const corpus = clean([
    input.signalText,
    input.companyContext,
    input.postContext,
    input.reasoningSummary,
    input.brandVoiceHints,
    input.recentAnalyticsHints,
    input.signalCategory
  ]);

  const relevanceScore = input.relevanceScore ?? inferRelevanceScore(input, corpus);
  const bestAngle = input.bestAngle ?? inferAngle(corpus);
  const highOperationalSignal = operationalPatterns.test(corpus);
  const businessSignal = businessPatterns.test(corpus);
  const liveThread = Boolean(input.hasReplyContext || input.hasCommentContext || input.postContext);
  const founderOperatorFit = founderOperatorPatterns.test(
    clean([input.authorRole, input.targetRole])
  );
  const riskNotes: string[] = [];

  let recommendedNextAction: DecisionPlan["recommendedNextAction"] = "save_for_later";
  let suggestedFlow: DecisionPlan["suggestedFlow"] = "research_later";
  let contentPriority: DecisionPlan["contentPriority"] = "medium";
  let engagementPriority: DecisionPlan["engagementPriority"] = "low";
  let publishability: DecisionPlan["publishability"] = "medium";

  if (relevanceScore < 30 || bestAngle === "low_fit" || softPatterns.test(corpus)) {
    recommendedNextAction = "ignore";
    suggestedFlow = "ignore";
    contentPriority = "low";
    engagementPriority = "low";
    publishability = "low";
    riskNotes.push("Weak operational relevance.");
  } else if (input.hasReplyContext && relevanceScore >= 60) {
    recommendedNextAction = "generate_reply";
    suggestedFlow = "engagement_only";
    contentPriority = "low";
    engagementPriority = "high";
    publishability = "medium";
  } else if (liveThread && relevanceScore >= 65) {
    recommendedNextAction = "generate_comment";
    suggestedFlow = "engagement_only";
    contentPriority = "medium";
    engagementPriority = "high";
    publishability = "medium";
  } else if (relevanceScore >= 72 && highOperationalSignal && (founderOperatorFit || businessSignal)) {
    recommendedNextAction = "generate_post_candidate";
    suggestedFlow = liveThread ? "post_then_engagement" : "post_only";
    contentPriority = "high";
    engagementPriority = liveThread ? "medium" : "low";
    publishability = "high";
  } else if (relevanceScore >= 45) {
    recommendedNextAction = "save_for_later";
    suggestedFlow = "research_later";
    contentPriority = "medium";
    engagementPriority = liveThread ? "medium" : "low";
    publishability = "medium";
    riskNotes.push("Signal has some fit but weak immediacy.");
  } else {
    recommendedNextAction = "ignore";
    suggestedFlow = "ignore";
    contentPriority = "low";
    engagementPriority = "low";
    publishability = "low";
    riskNotes.push("Low confidence signal.");
  }

  if (!highOperationalSignal) {
    riskNotes.push("Missing clear workflow or process pain.");
  }
  if (!founderOperatorFit && !input.targetRole && !input.authorRole) {
    riskNotes.push("ICP role signal is incomplete.");
  }

  const confidenceBase = Math.min(
    95,
    Math.max(
      25,
      relevanceScore +
        (highOperationalSignal ? 10 : -5) +
        (liveThread ? 6 : 0) +
        (founderOperatorFit ? 8 : 0) +
        (businessSignal ? 6 : 0)
    )
  );

  const reasoningSummary =
    recommendedNextAction === "generate_post_candidate"
      ? "Strong workflow pain plus ICP fit makes this a strong post candidate."
      : recommendedNextAction === "generate_comment"
        ? "There is enough relevance and live context to comment with a practical angle."
        : recommendedNextAction === "generate_reply"
          ? "There is direct thread context, so a concise reply is the highest-value move."
          : recommendedNextAction === "save_for_later"
            ? "The signal is relevant enough to keep, but it is not urgent or fully formed yet."
            : "The signal is too soft or off-ICP to justify immediate action.";

  return {
    recommendedNextAction,
    bestAngle,
    contentPriority,
    engagementPriority,
    publishability,
    confidence: confidenceBase,
    decisionMode: "deterministic",
    riskNotes,
    reasoningSummary,
    suggestedFlow,
    shouldEscalateToPost:
      recommendedNextAction === "generate_post_candidate" ||
      suggestedFlow === "post_then_engagement",
    shouldEscalateToEngagement:
      recommendedNextAction === "generate_comment" ||
      recommendedNextAction === "generate_reply" ||
      suggestedFlow === "post_then_engagement",
    shouldStoreForLater: recommendedNextAction === "save_for_later"
  };
}
