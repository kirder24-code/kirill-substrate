import type { ProviderRouter, ScoutEnrichmentInput } from "@linkedin-brand-os/ai-providers";
import type {
  AIScoutEnrichment,
  AudienceScoutItem,
  AudienceScoutResult,
  MatchedOpportunity,
  ScoutMatchResult,
  SolutionScoutItem,
  SolutionScoutResult
} from "@linkedin-brand-os/shared";

export async function enrichAudienceScoutResult(
  result: AudienceScoutResult,
  router?: ProviderRouter
): Promise<AudienceScoutResult> {
  if (!result.items.length) {
    return result;
  }

  return {
    ...result,
    items: await Promise.all(
      result.items.map(async (item) => ({
        ...item,
        aiEnrichment: await providerBackedScoutEnrichmentService({
          kind: "audience",
          item,
          router
        })
      }))
    )
  };
}

export async function enrichSolutionScoutResult(
  result: SolutionScoutResult,
  router?: ProviderRouter
): Promise<SolutionScoutResult> {
  if (!result.items.length) {
    return result;
  }

  return {
    ...result,
    items: await Promise.all(
      result.items.map(async (item) => ({
        ...item,
        aiEnrichment: await providerBackedScoutEnrichmentService({
          kind: "solution",
          item,
          router
        })
      }))
    )
  };
}

export async function enrichScoutMatchResult(
  result: ScoutMatchResult,
  router?: ProviderRouter
): Promise<ScoutMatchResult> {
  if (!result.items.length) {
    return result;
  }

  return {
    ...result,
    items: await Promise.all(
      result.items.map(async (item) => ({
        ...item,
        aiEnrichment: await providerBackedScoutEnrichmentService({
          kind: "match",
          item,
          router
        })
      }))
    )
  };
}

async function providerBackedScoutEnrichmentService(input: {
  kind: "audience";
  item: AudienceScoutItem;
  router?: ProviderRouter;
} | {
  kind: "solution";
  item: SolutionScoutItem;
  router?: ProviderRouter;
} | {
  kind: "match";
  item: MatchedOpportunity;
  router?: ProviderRouter;
}): Promise<AIScoutEnrichment | undefined> {
  const fallback = async () => undefined;
  if (!input.router) {
    return fallback();
  }

  const scout = buildScoutEnrichmentInput(input);
  const enrichment = await input.router.enrichScoutOutput({ scout, fallback });
  return shapeScoutEnrichment(input.kind, enrichment);
}

function buildScoutEnrichmentInput(input: {
  kind: "audience";
  item: AudienceScoutItem;
} | {
  kind: "solution";
  item: SolutionScoutItem;
} | {
  kind: "match";
  item: MatchedOpportunity;
}): ScoutEnrichmentInput {
  if (input.kind === "audience") {
    return {
      kind: "audience",
      subject: input.item.painSignalSummary,
      whyItMatters: input.item.whyItMatters,
      supportingContext: input.item.topicCluster,
      rawExcerpt: input.item.rawExcerpt,
      operatorAction: input.item.suggestedActionType
    };
  }

  if (input.kind === "solution") {
    return {
      kind: "solution",
      subject: input.item.solutionPattern,
      whyItMatters: input.item.whyItMatters,
      supportingContext: `${input.item.implementationLesson} Tradeoff: ${input.item.tradeoffOrConstraint}`,
      rawExcerpt: input.item.rawExcerpt,
      operatorAction: input.item.suggestedActionType
    };
  }

  return {
    kind: "match",
    subject: input.item.matchedPain,
    whyItMatters: input.item.whyThisMatchWorks,
    supportingContext: input.item.matchedSolutionPattern,
    operatorAction: input.item.recommendedAction
  };
}

function shapeScoutEnrichment(
  kind: "audience" | "solution" | "match",
  enrichment: AIScoutEnrichment | undefined
): AIScoutEnrichment | undefined {
  if (!enrichment) {
    return undefined;
  }

  if (kind === "audience") {
    return compactScoutEnrichment({
      improvedSummary: firstDefined(enrichment.improvedSummary, enrichment.whyItMatters),
      businessConsequence: firstDefined(
        enrichment.businessConsequence,
        enrichment.operatorAngle
      ),
      uncertaintyNote: normalizeOptionalField(enrichment.uncertaintyNote)
    });
  }

  if (kind === "solution") {
    return compactScoutEnrichment({
      improvedSummary: firstDefined(enrichment.improvedSummary, enrichment.whyItMatters),
      operatorAngle: firstDefined(enrichment.operatorAngle, enrichment.businessConsequence),
      uncertaintyNote: normalizeOptionalField(enrichment.uncertaintyNote)
    });
  }

  return compactScoutEnrichment({
    whyItMatters: firstDefined(
      enrichment.whyItMatters,
      enrichment.businessConsequence,
      enrichment.improvedSummary
    ),
    operatorAngle: firstDefined(enrichment.operatorAngle, enrichment.businessConsequence),
    uncertaintyNote: normalizeOptionalField(enrichment.uncertaintyNote)
  });
}

function compactScoutEnrichment(
  enrichment: AIScoutEnrichment
): AIScoutEnrichment | undefined {
  return Object.values(enrichment).some(
    (value) => typeof value === "string" && value.trim().length > 0
  )
    ? enrichment
    : undefined;
}

function firstDefined(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === "string" && value.trim().length > 0);
}

function normalizeOptionalField(value: string | undefined): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}
