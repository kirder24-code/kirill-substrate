import type { Signal, SignalRelevanceAgentOutput } from "@linkedin-brand-os/shared";
import { relevanceAnalyzer } from "./relevanceAnalyzer";

const audiencePatternMap: Array<[RegExp, string]> = [
  [/(founder|cofounder|startup|ceo)/i, "Founders building operator-heavy B2B teams"],
  [/(operator|operations|ops leader|coo|revops|sales ops)/i, "Operators responsible for workflow quality and execution"],
  [/(automation|workflow|approval|handoff|exception)/i, "Founder and ops teams designing automation and workflow systems"]
];

const pillarByAngle: Record<string, string> = {
  ownership_gap: "workflow_accountability",
  handoff_failure: "handoff_resilience",
  exception_handling: "exception_operations",
  workflow_accountability: "workflow_accountability",
  operational_roi: "operational_roi",
  low_fit: "low_fit"
};

export interface RelevanceAgentInput {
  signal: Signal;
}

export async function relevanceAgent(
  input: RelevanceAgentInput
): Promise<SignalRelevanceAgentOutput> {
  const corpus = buildSignalCorpus(input.signal);
  const analysis = await relevanceAnalyzer({
    postText: corpus,
    websiteAboutText: input.signal.sourceTitle,
    companyText:
      typeof input.signal.sourceMetadataJson?.repoReference === "string"
        ? String(input.signal.sourceMetadataJson.repoReference)
        : undefined
  });

  const targetAudience = inferTargetAudience(corpus);
  const whyRelevant = buildWhyRelevant(input.signal, analysis, targetAudience);
  const popularityPotentialScore = clampScore(
    Math.round(
      analysis.relevanceScore * 0.5 +
        (/(launch|release|github|tool|workflow|automation)/i.test(corpus) ? 20 : 10)
    )
  );
  const brandGrowthPotentialScore = clampScore(
    Math.round(
      analysis.relevanceScore * 0.6 +
        (analysis.bestAngle !== "low_fit" ? 18 : 0) +
        (/(founder|operator|ops|automation)/i.test(targetAudience) ? 12 : 0)
    )
  );

  return {
    relevanceScore: analysis.relevanceScore,
    whyRelevant,
    targetAudience,
    recommendedPillar: pillarByAngle[analysis.bestAngle],
    popularityPotentialScore,
    brandGrowthPotentialScore,
    reasoningJson: {
      bestAngle: analysis.bestAngle,
      recommendedAction: analysis.recommendedAction,
      targetType: analysis.targetType,
      riskNotes: analysis.riskNotes,
      mode: analysis.mode,
      sourceType: input.signal.sourceType
    }
  };
}

function buildSignalCorpus(signal: Signal): string {
  return [
    signal.title,
    signal.sourceTitle,
    signal.normalizedContent,
    signal.rawText,
    signal.topicTags?.join(" "),
    signal.noveltyHint
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferTargetAudience(corpus: string): string {
  const explicit = audiencePatternMap.find(([pattern]) => pattern.test(corpus))?.[1];
  return explicit ?? "Founders and operators looking for grounded business-process lessons";
}

function buildWhyRelevant(
  signal: Signal,
  analysis: Awaited<ReturnType<typeof relevanceAnalyzer>>,
  targetAudience: string
): string {
  if (analysis.bestAngle === "low_fit") {
    return `${signal.title} has weak overlap with the founder/operator niche and is unlikely to produce strong brand content.`;
  }

  return [
    `${signal.title} maps to ${analysis.bestAngle.replace(/_/g, " ")} themes.`,
    `It is relevant for ${targetAudience.toLowerCase()}.`,
    analysis.reasoningSummary
  ].join(" ");
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value));
}
