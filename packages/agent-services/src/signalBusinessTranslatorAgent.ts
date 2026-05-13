import type {
  Signal,
  SignalBusinessTranslationAgentOutput
} from "@linkedin-brand-os/shared";

const painPatternEntries: Array<[RegExp, string]> = [
  [/(ownership|owner)/i, "ownership drift"],
  [/(handoff|handoffs)/i, "handoff failures"],
  [/(exception|retry|retries)/i, "exception recovery gaps"],
  [/(approval|queue)/i, "approval bottlenecks"],
  [/(automation|workflow|process)/i, "workflow fragility"]
];

const implicationEntries: Array<[RegExp, string]> = [
  [/(ownership|owner)/i, "Clarify who owns recovery when a workflow leaves the demo path."],
  [/(handoff|handoffs)/i, "Design explicit cross-team handoffs instead of relying on tribal knowledge."],
  [/(exception|retry|retries)/i, "Expose failure and retry state so operators can intervene early."],
  [/(approval|queue)/i, "Make queue state and escalation visible before work stalls."],
  [/(automation|workflow|process)/i, "Treat automation as an operational system, not just a feature."]
];

export interface SignalBusinessTranslatorAgentInput {
  signal: Signal;
  providerTranslation?: {
    businessRelevance: string;
    targetAudience: string;
    coreInsight: string;
  };
}

export async function signalBusinessTranslatorAgent(
  input: SignalBusinessTranslatorAgentInput
): Promise<SignalBusinessTranslationAgentOutput> {
  const corpus = buildSignalCorpus(input.signal);
  const painsSolved = collectMatches(corpus, painPatternEntries, [
    "unclear business risk from the source"
  ]);
  const practicalImplications = collectMatches(corpus, implicationEntries, [
    "Translate the source into one practical operator lesson before turning it into content."
  ]);
  const buildabilityScore = inferBuildabilityScore(input.signal, corpus);
  const uniquenessScore = inferUniquenessScore(input.signal, corpus);

  return {
    businessValueSummary:
      input.providerTranslation?.businessRelevance ??
      buildBusinessValueSummary(input.signal, painsSolved, practicalImplications),
    painsSolved,
    practicalImplications,
    overhypeNotes: inferOverhypeNotes(corpus),
    uniquenessScore,
    uniquenessReason:
      uniquenessScore >= 70
        ? "The source contains concrete operator or implementation detail rather than generic AI commentary."
        : "The source is directionally useful, but the angle still risks sounding generic without stronger specifics.",
    buildabilityScore,
    buildabilityReason:
      buildabilityScore >= 70
        ? "The source exposes enough practical detail to adapt into product, process, or implementation guidance."
        : "The source is more conceptual than implementation-ready and needs more grounding before reuse.",
    targetAudience: input.providerTranslation?.targetAudience,
    reasoningJson: {
      providerCoreInsight: input.providerTranslation?.coreInsight,
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

function collectMatches(
  corpus: string,
  patterns: Array<[RegExp, string]>,
  fallback: string[]
): string[] {
  const values = patterns
    .filter(([pattern]) => pattern.test(corpus))
    .map(([, value]) => value);
  return values.length > 0 ? Array.from(new Set(values)) : fallback;
}

function inferBuildabilityScore(signal: Signal, corpus: string): number {
  if (signal.sourceType === "github_repo") {
    return 82;
  }
  if (/(api|repo|readme|architecture|deployment|integration)/i.test(corpus)) {
    return 74;
  }
  if (signal.sourceType === "manual_note") {
    return 58;
  }
  return 52;
}

function inferUniquenessScore(signal: Signal, corpus: string): number {
  if (signal.sourceType === "github_repo") {
    return 78;
  }
  if (/(workflow|handoff|exception|approval|operator)/i.test(corpus)) {
    return 67;
  }
  return 54;
}

function inferOverhypeNotes(corpus: string): string | undefined {
  if (/(revolutionary|game changing|10x|fully autonomous|world class)/i.test(corpus)) {
    return "The source uses hype-heavy language and should be translated into grounded operator language.";
  }
  if (/(ai|automation)/i.test(corpus)) {
    return "Avoid treating the source as proof of full autonomy without the surrounding workflow and ownership design.";
  }
  return undefined;
}

function buildBusinessValueSummary(
  signal: Signal,
  painsSolved: string[],
  practicalImplications: string[]
): string {
  return [
    `${signal.title} can be translated into a business-facing lesson about ${painsSolved[0]}.`,
    practicalImplications[0]
  ]
    .filter(Boolean)
    .join(" ");
}
