import type { GeneratedPostResult } from "@linkedin-brand-os/ai-providers";
import type { ContentAsset, OrchestratorDecision, Signal, SignalAnalysis } from "@linkedin-brand-os/shared";

export interface SignalContentAgentInput {
  signal: Signal;
  analysis: SignalAnalysis;
  decision: OrchestratorDecision;
  providerDraft: GeneratedPostResult;
}

export interface SignalContentAgentOutput {
  contentType: ContentAsset["contentType"];
  hook: string;
  body: string;
  cta: string;
  bestAngle: NonNullable<ContentAsset["bestAngle"]>;
  alternativeAnglesJson: string[];
  recommendedFormat: NonNullable<ContentAsset["recommendedFormat"]>;
  longPostDraft: string;
  shortPostDraft: string;
  hooksJson: string[];
  commentAnglesJson: string[];
  ctaVariantsJson: string[];
  carouselOutline?: string;
  contentStatus: NonNullable<ContentAsset["contentStatus"]>;
  publishReadyFlag: boolean;
  status: ContentAsset["status"];
}

const bannedPatterns = [
  /in today's fast-paced world/gi,
  /ai is transforming everything/gi,
  /leverage/gi,
  /unlock/gi
];

function cleanText(text: string): string {
  let next = text.replace(/\s+/g, " ").trim();
  for (const pattern of bannedPatterns) {
    next = next.replace(pattern, " ");
  }
  return next.replace(/\s+/g, " ").trim();
}

function uniqueLines(lines: string[]): string[] {
  const seen = new Set<string>();
  return lines.filter((line) => {
    const normalized = line.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
    if (normalized.length === 0 || seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });
}

function toSentence(text: string): string {
  const cleaned = cleanText(text).replace(/[.?!\s]+$/g, "");
  return cleaned.length > 0 ? `${cleaned}.` : "";
}

function summarizePain(signal: SignalAnalysis): string {
  return signal.painsSolved[0] ?? signal.practicalImplications[0] ?? signal.businessValueSummary;
}

function mapContentType(
  recommendedFormat: NonNullable<ContentAsset["recommendedFormat"]>
): ContentAsset["contentType"] {
  if (recommendedFormat === "carousel") {
    return "carousel";
  }

  return "linkedin-post";
}

export async function signalContentAgent(
  input: SignalContentAgentInput
): Promise<SignalContentAgentOutput> {
  const bestAngle = input.analysis.bestAngle ?? input.signal.title;
  const recommendedFormat = input.analysis.recommendedFormat ?? "long_linkedin_post";
  const primaryPain = summarizePain(input.analysis);
  const primaryImplication =
    input.analysis.practicalImplications[0] ?? "Make the operating tradeoff explicit.";
  const providerHook = cleanText(input.providerDraft.hook);
  const providerBody = cleanText(input.providerDraft.body);
  const providerCta = cleanText(input.providerDraft.cta);

  const hooksJson = uniqueLines([
    providerHook,
    `${bestAngle}`,
    `${input.signal.title} is really an ownership problem`,
    `The workflow breaks long before the model does`
  ]).slice(0, 4);

  const ctaVariantsJson = uniqueLines([
    providerCta,
    "If this pattern is showing up in your team, compare notes.",
    "If you are rebuilding this path now, start with the workflow owner."
  ]).slice(0, 3);

  const commentAnglesJson = uniqueLines([
    `The hidden pain here is ${primaryPain}.`,
    `A useful operator question: who owns recovery when the happy path breaks?`,
    `The implementation lesson is ${primaryImplication.toLowerCase()}.`
  ]).slice(0, 4);

  const bodyParagraphs = uniqueLines([
    providerBody,
    input.analysis.businessValueSummary,
    `What makes this worth attention is ${input.analysis.whyRelevant.toLowerCase()}`,
    `For ${input.analysis.targetAudience}, the practical lesson is ${primaryImplication.toLowerCase()}.`,
    `Next move: ${input.decision.nextAction.replace(/_/g, " ")}.`
  ])
    .map(toSentence)
    .filter(Boolean);

  const hook = hooksJson[0] ?? providerHook;
  const cta = ctaVariantsJson[0] ?? providerCta;
  const longPostDraft = [hook, ...bodyParagraphs, cta].join("\n\n");
  const shortPostDraft = [
    hook,
    toSentence(input.analysis.businessValueSummary),
    toSentence(primaryImplication),
    cta
  ]
    .filter(Boolean)
    .join("\n\n");

  const carouselOutline =
    recommendedFormat === "carousel" || input.analysis.practicalImplications.length >= 3
      ? uniqueLines([
          `Slide 1: ${hook}`,
          `Slide 2: The pain - ${primaryPain}`,
          `Slide 3: What teams miss - ${primaryImplication}`,
          `Slide 4: Operator move - ${input.decision.nextAction.replace(/_/g, " ")}`
        ]).join("\n")
      : undefined;

  return {
    contentType: mapContentType(recommendedFormat),
    hook,
    body: bodyParagraphs.join(" "),
    cta,
    bestAngle,
    alternativeAnglesJson: input.analysis.alternativeAnglesJson ?? [],
    recommendedFormat,
    longPostDraft,
    shortPostDraft,
    hooksJson,
    commentAnglesJson,
    ctaVariantsJson,
    ...(carouselOutline ? { carouselOutline } : {}),
    contentStatus: "draft",
    publishReadyFlag: false,
    status: "draft"
  };
}
