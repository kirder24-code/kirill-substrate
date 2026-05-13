import type {
  EngagementAdaptationInput,
  EngagementAdaptationPlan,
  GenerateCommentInput,
  GenerateReplyInput
} from "@linkedin-brand-os/shared";

const founderOperatorPattern =
  /(founder|cofounder|operator|operations|ops|revops|sales ops|gtm|go-to-market|coo)/i;
const executionAngles = new Set([
  "ownership_gap",
  "handoff_failure",
  "exception_handling",
  "workflow_accountability"
]);

export function buildEngagementAdaptationPlan(
  input: EngagementAdaptationInput
): EngagementAdaptationPlan {
  const riskFlags: string[] = [];
  const isFounderOperator = founderOperatorPattern.test(input.targetRole ?? "");
  const isExecutionAngle = executionAngles.has(input.bestAngle);

  let engagementMode: EngagementAdaptationPlan["engagementMode"] = "insight_light_positioning";
  let shouldGenerate = true;
  let depthDirective: EngagementAdaptationPlan["depthDirective"] = "brief";
  let closingStyle: EngagementAdaptationPlan["closingStyle"] = "none";
  let toneDirectives = [
    "Keep it grounded.",
    "Avoid hype.",
    "Make one practical point."
  ];

  if (input.recommendedAction === "ignore" || input.relevanceScore < 30) {
    engagementMode = "neutral_or_skip";
    shouldGenerate = false;
    riskFlags.push("low_relevance");
    toneDirectives = ["Stay neutral.", "Do not force engagement."];
  } else if (input.recommendedAction === "outreach_candidate") {
    engagementMode = "bridge_outreach_aware";
    closingStyle = "bridge";
    riskFlags.push("bridge_not_pitch");
    toneDirectives = [
      "Acknowledge the point naturally.",
      "Bridge to shared operating pain.",
      "Do not sound salesy."
    ];
  } else if (input.relevanceScore >= 75 && isFounderOperator && isExecutionAngle) {
    engagementMode = "strategic_execution";
    depthDirective = "medium";
    toneDirectives = [
      "Lead with the execution risk.",
      "Sound like an operator, not a commentator.",
      "Tie the point to workflow ownership or accountability."
    ];
  } else {
    engagementMode = "insight_light_positioning";
    depthDirective = "brief";
    closingStyle = input.hasCommentContext ? "soft_question" : "none";
    toneDirectives = [
      "Add one useful angle.",
      "Keep it light and practical.",
      "Avoid overcommitting."
    ];
  }

  return {
    engagementMode,
    toneDirectives,
    angleDirective: input.bestAngle,
    depthDirective,
    closingStyle,
    shouldGenerate,
    riskFlags,
    metadata: {
      generationType: input.generationType,
      recommendedAction: input.recommendedAction,
      targetRole: input.targetRole,
      reasoningSummary: input.reasoningSummary
    }
  };
}

export function resolveEngagementAdaptationInput(
  input: GenerateCommentInput | GenerateReplyInput,
  generationType: "comment" | "reply"
): EngagementAdaptationInput | null {
  if (
    input.relevanceScore === undefined ||
    !input.bestAngle ||
    !input.recommendedAction
  ) {
    return null;
  }

  return {
    relevanceScore: input.relevanceScore,
    bestAngle: input.bestAngle,
    recommendedAction: input.recommendedAction,
    reasoningSummary: input.reasoningSummary,
    targetRole: input.targetRole,
    hasCommentContext:
      generationType === "reply" ||
      (generationType === "comment" && input.recommendedAction === "reply"),
    generationType
  };
}
