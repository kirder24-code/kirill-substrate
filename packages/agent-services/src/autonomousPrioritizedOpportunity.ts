import type {
  AutonomousMatchedOpportunity,
  AutonomousOpportunityPriorityBand,
  CreateAutonomousMatchedOpportunityInput
} from "@linkedin-brand-os/shared";

const CONFIDENCE_SCORES: Record<AutonomousMatchedOpportunity["confidence"], number> = {
  high: 40,
  medium: 25,
  low: 10
};

const OPPORTUNITY_STRENGTH_SCORES: Record<
  NonNullable<AutonomousMatchedOpportunity["opportunityStrength"]>,
  number
> = {
  strong: 30,
  medium: 20,
  weak: 10
};

const ACTION_SCORES: Record<AutonomousMatchedOpportunity["recommendedAction"], number> = {
  write_post: 18,
  write_comment: 12,
  write_reply: 8,
  save_for_later: 3
};

export function prioritizeAutonomousMatchedOpportunity(
  input: Omit<
    CreateAutonomousMatchedOpportunityInput,
    "priorityScore" | "priorityBand" | "reasonLines"
  >
): CreateAutonomousMatchedOpportunityInput {
  const confidenceScore = CONFIDENCE_SCORES[input.confidence];
  const strengthScore = input.opportunityStrength
    ? OPPORTUNITY_STRENGTH_SCORES[input.opportunityStrength]
    : 10;
  const actionScore = ACTION_SCORES[input.recommendedAction];
  const scoreNotesBonus = Math.min(input.scoreNotes?.length ?? 0, 3) * 4;
  const priorityScore = Math.min(
    100,
    confidenceScore + strengthScore + actionScore + scoreNotesBonus
  );
  const priorityBand = toPriorityBand(priorityScore);

  return {
    ...input,
    priorityScore,
    priorityBand,
    reasonLines: buildReasonLines({
      confidence: input.confidence,
      opportunityStrength: input.opportunityStrength,
      recommendedAction: input.recommendedAction,
      scoreNotesCount: input.scoreNotes?.length ?? 0
    })
  };
}

function toPriorityBand(score: number): AutonomousOpportunityPriorityBand {
  if (score >= 75) {
    return "high";
  }
  if (score >= 50) {
    return "medium";
  }
  return "low";
}

function buildReasonLines(input: {
  confidence: AutonomousMatchedOpportunity["confidence"];
  opportunityStrength?: AutonomousMatchedOpportunity["opportunityStrength"];
  recommendedAction: AutonomousMatchedOpportunity["recommendedAction"];
  scoreNotesCount: number;
}): string[] {
  const lines = [
    `${capitalize(input.confidence)}-confidence match with ${
      input.opportunityStrength ?? "baseline"
    } opportunity strength.`,
    `${formatAction(input.recommendedAction)} keeps this pair near the top of the review order.`
  ];

  if (input.scoreNotesCount > 0) {
    lines.push(
      `Match evidence includes ${input.scoreNotesCount} supporting score note${
        input.scoreNotesCount === 1 ? "" : "s"
      }.`
    );
  }

  return lines;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatAction(action: AutonomousMatchedOpportunity["recommendedAction"]): string {
  if (action === "write_post") {
    return "Write-post urgency";
  }
  if (action === "write_comment") {
    return "Write-comment follow-through";
  }
  if (action === "write_reply") {
    return "Write-reply follow-up";
  }
  return "Save-for-later review value";
}
