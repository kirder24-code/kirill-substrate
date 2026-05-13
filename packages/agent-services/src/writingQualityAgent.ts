import type {
  BrandVoiceProfile,
  ContentAsset,
  WritingQualityAssessment
} from "@linkedin-brand-os/shared";

export interface WritingQualityAgentResult {
  refinement: {
    refinedHook: string;
    refinedBody: string;
    refinedCta: string;
    refinementStatus: "refined";
    qualityStatus: "reviewed";
    overallQualityScore: number;
    brandVoiceProfileId?: string;
  };
  assessment: Omit<WritingQualityAssessment, "id" | "createdAt">;
}

const roboticPatterns = [
  "ai is changing everything",
  "game changer",
  "revolutionary",
  "in today's fast-paced",
  "unlock the power",
  "in the busy world",
  "in the fast-paced world",
  "throw a wrench in the works",
  "it's a common problem many teams",
  "can really throw a wrench",
  "a promising solution involves"
];

const insufficientContentMarkers = [
  "insufficient source detail",
  "insufficient detail",
  "lacks specific operational context",
  "more context is needed",
  "too vague"
];

function scoreText(text: string, brandVoice?: BrandVoiceProfile) {
  const lower = text.toLowerCase();

  // Check for insufficient content markers - these should score very low
  const hasInsufficientMarker = insufficientContentMarkers.some(marker =>
    lower.includes(marker)
  );

  const penalties = roboticPatterns.reduce(
    (count, pattern) => count + (lower.includes(pattern) ? 1 : 0),
    0
  );
  const preferredHits =
    brandVoice?.preferredPatterns.reduce(
      (count, pattern) =>
        count + (lower.includes(pattern.toLowerCase()) ? 1 : 0),
      0
    ) ?? 0;

  // If content explicitly states it's insufficient, score very low across all dimensions
  if (hasInsufficientMarker) {
    return {
      humanToneScore: 20,
      clarityScore: 15,
      groundednessScore: 10,
      antiRobotScore: 25
    };
  }

  const humanToneScore = Math.max(45, 82 - penalties * 12 + preferredHits * 4);
  const clarityScore = Math.max(50, 78 + (text.length > 80 ? 6 : 0) - penalties * 6);
  const groundednessScore = Math.max(
    48,
    76 +
      (lower.includes("operational") ? 6 : 0) +
      (lower.includes("business") ? 4 : 0) +
      preferredHits * 3 -
      penalties * 6
  );
  const antiRobotScore = Math.max(40, 84 - penalties * 16 + preferredHits * 2);

  return {
    humanToneScore,
    clarityScore,
    groundednessScore,
    antiRobotScore
  };
}

function applyBrandVoice(text: string, brandVoice?: BrandVoiceProfile): string {
  let refined = text.replace(/\s+/g, " ").trim();

  for (const pattern of roboticPatterns) {
    const matcher = new RegExp(pattern, "ig");
    refined = refined.replace(matcher, "practical rollout work");
  }

  if (brandVoice) {
    for (const banned of brandVoice.bannedPatterns) {
      const matcher = new RegExp(banned, "ig");
      refined = refined.replace(matcher, "");
    }

    // Inject the FIRST preferred pattern not already present in the refined
    // text. Refinement step is supposed to move text toward brand voice, not
    // just strip banned phrases. The replacement of robotic patterns with
    // "practical rollout work" may already include ONE preferred pattern by
    // coincidence, but the first declared preferred pattern (e.g.
    // "operational payoff") is more semantically informative and should be
    // present after refinement.
    const refinedLower = refined.toLowerCase();
    const missingPreferred = brandVoice.preferredPatterns.find(
      (pattern) => !refinedLower.includes(pattern.toLowerCase())
    );
    if (missingPreferred) {
      refined = `${refined} because ${missingPreferred}.`;
    }
  }

  return refined.replace(/\s+/g, " ").trim();
}

export async function writingQualityAgent(input: {
  content: Pick<ContentAsset, "id" | "hook" | "body" | "cta">;
  brandVoice?: BrandVoiceProfile | null;
}): Promise<WritingQualityAgentResult> {
  const refinedHook = applyBrandVoice(input.content.hook, input.brandVoice ?? undefined);
  const refinedBody = applyBrandVoice(input.content.body, input.brandVoice ?? undefined);
  const refinedCta = applyBrandVoice(input.content.cta, input.brandVoice ?? undefined);

  const scores = scoreText(`${refinedHook} ${refinedBody}`, input.brandVoice ?? undefined);
  const overallScore = Math.round(
    (scores.humanToneScore +
      scores.clarityScore +
      scores.groundednessScore +
      scores.antiRobotScore) /
      4
  );

  const isInsufficientContent = overallScore < 30;

  const notes = [
    isInsufficientContent
      ? "Content generation failed due to insufficient source detail. The draft explicitly indicates placeholder status."
      : "Reviewed for grounded business language.",
    scores.antiRobotScore < 75
      ? "Reduced robotic phrasing and generic hype."
      : isInsufficientContent
      ? "Source inputs lack specific operational context needed for draft generation."
      : "Anti-robot phrasing is in a healthy range."
  ];

  return {
    refinement: {
      refinedHook,
      refinedBody,
      refinedCta,
      refinementStatus: "refined",
      qualityStatus: "reviewed",
      overallQualityScore: overallScore,
      brandVoiceProfileId: input.brandVoice?.id
    },
    assessment: {
      contentAssetId: input.content.id,
      humanToneScore: scores.humanToneScore,
      clarityScore: scores.clarityScore,
      groundednessScore: scores.groundednessScore,
      antiRobotScore: scores.antiRobotScore,
      overallScore,
      notes
    }
  };
}
