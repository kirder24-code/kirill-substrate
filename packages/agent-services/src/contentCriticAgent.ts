/**
 * @deprecated This deterministic agent has been superseded by providerBackedContentCriticService.
 * Use the provider-backed service instead for AI-powered content critique with deterministic fallback.
 * This agent will be removed in a future version.
 */

import type { ContentCriticResult } from "@linkedin-brand-os/ai-providers";
import type {
  ContentAsset,
  CriticReview,
  OrchestratorDecision,
  Signal,
  SignalAnalysis
} from "@linkedin-brand-os/shared";

export interface ContentCriticAgentInput {
  signal: Signal;
  analysis: SignalAnalysis;
  content: ContentAsset;
  decision?: OrchestratorDecision;
  providerReview: ContentCriticResult;
}

export interface ContentCriticAgentOutput {
  review: Omit<CriticReview, "id" | "createdAt">;
}

const genericPatterns = [
  /in today's fast-paced/gi,
  /game changer/gi,
  /unlock/gi,
  /revolutionary/gi,
  /ai is changing everything/gi
];

function scoreSignal(signal: "strong" | "mixed" | "weak"): number {
  if (signal === "strong") return 84;
  if (signal === "mixed") return 66;
  return 44;
}

function scoreRisk(risk: "low" | "medium" | "high"): number {
  if (risk === "low") return 18;
  if (risk === "medium") return 44;
  return 72;
}

function collectRewriteSuggestions(input: {
  providerReview: ContentCriticResult;
  genericnessScore: number;
  businessValueScore: number;
  differentiationScore: number;
}): string[] {
  const suggestions = [...input.providerReview.rewriteSuggestions];

  if (input.genericnessScore > 45) {
    suggestions.push("Replace generic framing with one concrete operating lesson from the source.");
  }
  if (input.businessValueScore < 70) {
    suggestions.push("Make the business consequence explicit earlier in the draft.");
  }
  if (input.differentiationScore < 70) {
    suggestions.push("Sharpen the angle so it sounds like a specific point of view, not broad advice.");
  }

  return Array.from(new Set(suggestions)).slice(0, 4);
}

/**
 * @deprecated Use providerBackedContentCriticService instead.
 */
export async function contentCriticAgent(
  input: ContentCriticAgentInput
): Promise<ContentCriticAgentOutput> {
  const draftText =
    `${input.content.longPostDraft ?? input.content.body} ${input.content.shortPostDraft ?? ""}`.trim();
  const genericHits = genericPatterns.reduce(
    (count, pattern) => count + (draftText.toLowerCase().match(pattern)?.length ?? 0),
    0
  );

  const qualityBase = scoreSignal(input.providerReview.qualitySignal);
  const businessValueScore = Math.min(
    100,
    scoreSignal(input.providerReview.businessValueSignal) +
      (input.analysis.practicalImplications.length > 1 ? 4 : 0) +
      (/cost|workflow|owner|handoff|recovery/i.test(draftText) ? 4 : 0)
  );
  const differentiationScore = Math.min(
    100,
    scoreSignal(input.providerReview.differentiationSignal) +
      (input.analysis.uniquenessScore >= 70 ? 6 : 0) +
      ((input.content.bestAngle?.length ?? 0) > 20 ? 4 : 0)
  );
  const genericnessScore = Math.min(
    100,
    scoreRisk(input.providerReview.genericnessRisk) + genericHits * 8
  );
  const qualityScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        qualityBase * 0.35 +
          businessValueScore * 0.3 +
          differentiationScore * 0.2 +
          (100 - genericnessScore) * 0.15
      )
    )
  );

  const rewriteSuggestions = collectRewriteSuggestions({
    providerReview: input.providerReview,
    genericnessScore,
    businessValueScore,
    differentiationScore
  });

  const publishReadyFlag =
    input.providerReview.publishReadyHint &&
    qualityScore >= 80 &&
    businessValueScore >= 75 &&
    differentiationScore >= 70 &&
    genericnessScore <= 35 &&
    rewriteSuggestions.length <= 1;

  const criticNotes = [
    input.providerReview.criticNotes,
    `Decision context: ${(input.decision?.nextAction ?? "no_decision_context").replace(/_/g, " ")}.`,
    publishReadyFlag
      ? "The draft is strong enough to move into publish-ready review."
      : "The draft still needs revision before it should be considered publish-ready."
  ].join(" ");

  return {
    review: {
      contentAssetId: input.content.id,
      humanToneScore: Math.max(45, qualityScore - 8),
      clarityScore: Math.max(50, qualityScore - 4),
      groundednessScore: Math.min(100, businessValueScore + 4),
      antiRobotScore: Math.max(40, 100 - genericnessScore),
      overallScore: qualityScore,
      notes: [
        `Best angle: ${input.content.bestAngle ?? input.analysis.bestAngle ?? input.signal.title}`,
        `Audience: ${input.analysis.targetAudience}`
      ],
      qualityScore,
      genericnessScore,
      businessValueScore,
      differentiationScore,
      publishReadyFlag,
      rewriteSuggestions,
      criticNotes
    }
  };
}
