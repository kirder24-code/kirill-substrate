import type {
  Signal,
  SignalAnalysis,
  SignalPositioningAgentOutput
} from "@linkedin-brand-os/shared";

export interface PositioningAgentInput {
  signal: Signal;
  analysis: SignalAnalysis;
}

const fallbackAlternatives = [
  "workflow_accountability",
  "ownership_gap",
  "handoff_failure",
  "operational_roi",
  "exception_handling"
];

export async function positioningAgent(
  input: PositioningAgentInput
): Promise<SignalPositioningAgentOutput> {
  const bestAngle = inferBestAngle(input.analysis);
  return {
    bestAngle,
    alternativeAnglesJson: fallbackAlternatives
      .filter((angle) => angle !== bestAngle)
      .slice(0, 3),
    recommendedFormat: inferRecommendedFormat(input.signal, input.analysis),
    audienceEmphasis: inferAudienceEmphasis(input.analysis),
    toneGuidance: inferToneGuidance(input.signal, input.analysis),
    recommendedPillarFinal:
      input.analysis.recommendedPillar ?? normalizeAngleToPillar(bestAngle),
    reasoningJson: {
      sourceType: input.signal.sourceType,
      bestAngleFromAnalysis: bestAngle
    }
  };
}

function inferBestAngle(analysis: SignalAnalysis): string {
  const fromReasoning = analysis.reasoningJson?.relevance;
  if (fromReasoning && typeof fromReasoning === "object") {
    const bestAngle = (fromReasoning as Record<string, unknown>).bestAngle;
    if (typeof bestAngle === "string" && bestAngle.trim()) {
      return bestAngle;
    }
  }

  if (analysis.recommendedPillar === "handoff_resilience") {
    return "handoff_failure";
  }

  return analysis.recommendedPillar ?? "workflow_accountability";
}

function inferRecommendedFormat(
  signal: Signal,
  analysis: SignalAnalysis
): SignalPositioningAgentOutput["recommendedFormat"] {
  if (signal.sourceType === "github_repo") {
    return "long_linkedin_post";
  }
  if (analysis.popularityPotentialScore >= 75) {
    return "short_authority_post";
  }
  return "long_linkedin_post";
}

function inferAudienceEmphasis(analysis: SignalAnalysis): string {
  return analysis.targetAudience.includes("Founders")
    ? "Emphasize founder decision-making plus operator execution detail."
    : `Emphasize ${analysis.targetAudience.toLowerCase()} with practical workflow lessons.`;
}

function inferToneGuidance(signal: Signal, analysis: SignalAnalysis): string {
  if (signal.sourceType === "github_repo" || analysis.buildabilityScore >= 70) {
    return "Use implementation-aware, operator-first language with concrete specifics.";
  }
  return "Keep the tone direct, grounded, and commercially relevant without hype.";
}

function normalizeAngleToPillar(bestAngle: string): string {
  if (bestAngle === "ownership_gap") return "workflow_accountability";
  if (bestAngle === "handoff_failure") return "handoff_resilience";
  if (bestAngle === "exception_handling") return "exception_operations";
  if (bestAngle === "operational_roi") return "operational_roi";
  return "workflow_accountability";
}
