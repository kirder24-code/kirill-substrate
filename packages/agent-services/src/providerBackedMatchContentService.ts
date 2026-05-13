import type { ProviderRouter } from "@linkedin-brand-os/ai-providers";
import type {
  AIContentGeneration,
  GenerateMatchContentInput,
  MemoryPattern,
  PersistedMatchedOpportunity
} from "@linkedin-brand-os/shared";

const SUPPORTED_ACTIONS = new Set(["write_post", "write_comment", "save_for_later"]);

export async function providerBackedMatchContentService(input: {
  savedMatch: PersistedMatchedOpportunity;
  router?: ProviderRouter;
  memoryPatterns?: MemoryPattern[];
}): Promise<AIContentGeneration | undefined> {
  const generationInput = buildGenerateMatchContentInput(
    input.savedMatch,
    input.memoryPatterns
  );
  if (!generationInput || !input.router) {
    return undefined;
  }

  const fallback = async () => undefined;
  const generated = await input.router.generateMatchContent({
    content: generationInput,
    fallback
  });

  return shapeMatchContent(generationInput.recommendedAction, generated);
}

export function buildGenerateMatchContentInput(
  savedMatch: PersistedMatchedOpportunity,
  memoryPatterns?: MemoryPattern[]
): GenerateMatchContentInput | undefined {
  if (savedMatch.status !== "reviewed") {
    return undefined;
  }

  const { match } = savedMatch;
  if (!SUPPORTED_ACTIONS.has(match.recommendedAction)) {
    return undefined;
  }

  const whyItMatters = firstDefined(
    match.aiEnrichment?.whyItMatters,
    match.aiEnrichment?.businessConsequence,
    match.whyThisMatchWorks
  );
  const operatorAngle = firstDefined(match.aiEnrichment?.operatorAngle);
  const businessConsequence = firstDefined(match.aiEnrichment?.businessConsequence);
  const supportSummary = firstDefined(match.whyThisMatchWorks);

  if (
    !hasText(match.matchedPain) ||
    !hasText(match.matchedSolutionPattern) ||
    !whyItMatters ||
    !(operatorAngle || businessConsequence || supportSummary)
  ) {
    return undefined;
  }

  const learnedPatterns = formatLearnedPatterns(memoryPatterns);

  return {
    itemType: "match",
    recommendedAction: match.recommendedAction,
    title: `${match.matchedPain} + ${match.matchedSolutionPattern}`,
    audienceSummary: match.matchedPain,
    solutionSummary: match.matchedSolutionPattern,
    painSummary: match.matchedPain,
    whyItMatters,
    operatorAngle,
    businessConsequence,
    supportSummary,
    learnedPatterns
  };
}

function formatLearnedPatterns(patterns?: MemoryPattern[]): string[] | undefined {
  if (!patterns || patterns.length === 0) {
    return undefined;
  }

  const strongPatterns = patterns
    .filter((pattern) => pattern.recommendedAction === "repeat" && pattern.strengthScore >= 2)
    .sort((a, b) => b.strengthScore - a.strengthScore)
    .slice(0, 8);

  if (strongPatterns.length === 0) {
    return undefined;
  }

  return strongPatterns.map((pattern) => {
    const parts = pattern.patternKey.split(":");
    const outcome = parts[1];
    const value = parts.slice(2).join(":");

    if (pattern.patternType === "angle") {
      return `Angle "${value}" drove ${outcome} outcomes (score: ${pattern.strengthScore.toFixed(1)})`;
    }
    if (pattern.patternType === "pillar") {
      return `Pillar "${value}" drove ${outcome} outcomes (score: ${pattern.strengthScore.toFixed(1)})`;
    }
    if (pattern.patternType === "publish_window") {
      return `Publishing in ${value} drove ${outcome} outcomes (score: ${pattern.strengthScore.toFixed(1)})`;
    }
    if (pattern.patternType === "content_format") {
      return `Format style drove ${outcome} outcomes (score: ${pattern.strengthScore.toFixed(1)})`;
    }
    if (pattern.patternType === "audience_fit") {
      return `Audience fit drove ${outcome} outcomes (score: ${pattern.strengthScore.toFixed(1)})`;
    }
    return `Pattern ${pattern.patternType} drove ${outcome} outcomes (score: ${pattern.strengthScore.toFixed(1)})`;
  });
}

function shapeMatchContent(
  action: GenerateMatchContentInput["recommendedAction"],
  value: AIContentGeneration | undefined
): AIContentGeneration | undefined {
  if (!value) {
    return undefined;
  }

  const warnings = normalizeWarnings(value.warnings);

  if (action === "write_post") {
    return compactContent({
      contentIdea: normalizeOptionalField(value.contentIdea),
      draftAngle: normalizeOptionalField(value.draftAngle),
      postSeed: normalizeOptionalField(value.postSeed),
      warnings,
      provider: normalizeOptionalField(value.provider)
    });
  }

  if (action === "write_comment") {
    return compactContent({
      contentIdea: normalizeOptionalField(value.contentIdea),
      draftAngle: normalizeOptionalField(value.draftAngle),
      commentSeed: normalizeOptionalField(value.commentSeed),
      warnings,
      provider: normalizeOptionalField(value.provider)
    });
  }

  if (action === "save_for_later") {
    return compactContent({
      contentIdea: normalizeOptionalField(value.contentIdea),
      angleStub: normalizeOptionalField(value.angleStub),
      warnings,
      provider: normalizeOptionalField(value.provider)
    });
  }

  return undefined;
}

function compactContent(
  content: AIContentGeneration
): AIContentGeneration | undefined {
  // provider is just an identifier of which model responded - it should NOT
  // count as "real content". Without this filter, a provider-attribution-only
  // object slips through and breaks safe-degradation contract (test expects
  // undefined when no actual content fields present).
  const hasRealContent = Object.entries(content).some(([key, value]) => {
    if (key === "provider") return false;
    if (key === "warnings") {
      return Array.isArray(value) && value.length > 0;
    }
    return typeof value === "string" && value.trim().length > 0;
  });
  return hasRealContent ? content : undefined;
}

function normalizeWarnings(value: string[] | undefined): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const warnings = value
    .map((warning) => (typeof warning === "string" ? warning.trim() : ""))
    .filter((warning) => warning.length > 0);

  return warnings.length > 0 ? warnings : undefined;
}

function normalizeOptionalField(value: string | undefined): string | undefined {
  return hasText(value) ? value.trim() : undefined;
}

function hasText(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function firstDefined(...values: Array<string | undefined>): string | undefined {
  return values.find(hasText)?.trim();
}
