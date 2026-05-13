import type { GenerateMatchContentInput } from "@linkedin-brand-os/shared";

export function buildContentGenerationPrompt(input: GenerateMatchContentInput): string {
  const baseContext = [
    "Generate compact review-first content-prep artifacts for a reviewed scout match.",
    "This is not a publishing task and not a full content studio.",
    "Return only the labeled fields requested below.",
    "Keep outputs concise, specific, business-relevant, and human-sounding.",
    "Do not add hype. Do not invent missing facts. Do not change the recommended action.",
    `Recommended action: ${input.recommendedAction}`,
    `Item type: ${input.itemType}`
  ];

  const contextLines = [
    formatLine("Title", input.title),
    formatLine("Audience summary", input.audienceSummary),
    formatLine("Solution summary", input.solutionSummary),
    formatLine("Pain summary", input.painSummary),
    formatLine("Why it matters", input.whyItMatters),
    formatLine("Operator angle", input.operatorAngle),
    formatLine("Business consequence", input.businessConsequence),
    formatLine("Support summary", input.supportSummary)
  ].filter(Boolean);

  const learnedGuidance =
    input.learnedPatterns && input.learnedPatterns.length > 0
      ? [
          "",
          "Learned patterns from past outcomes (use to inform angle and framing):",
          ...input.learnedPatterns.map((pattern) => `- ${pattern}`)
        ]
      : [];

  if (input.recommendedAction === "write_post") {
    return [
      ...baseContext,
      "Post shaping:",
      "- Focus on a compact LinkedIn post starter.",
      "- Do not write a full polished post.",
      "- Bias toward a strong business-relevant framing and a clear operating lesson.",
      "- POST_SEED should read like the first 1-2 lines of a grounded draft.",
      "- Keep the tone practical and human-sounding.",
      ...contextLines,
      ...learnedGuidance,
      "Return exactly these labels if useful:",
      "CONTENT_IDEA:",
      "DRAFT_ANGLE:",
      "POST_SEED:",
      "WARNINGS:"
    ].join("\n");
  }

  if (input.recommendedAction === "write_comment") {
    return [
      ...baseContext,
      "Comment shaping:",
      "- Focus on a concise public comment starter.",
      "- Add specific value instead of summarizing the whole topic.",
      "- Keep it additive, practical, and non-generic.",
      "- Keep it not flattery.",
      "- Keep it not mini-post sprawl.",
      ...contextLines,
      ...learnedGuidance,
      "Return exactly these labels if useful:",
      "CONTENT_IDEA:",
      "DRAFT_ANGLE:",
      "COMMENT_SEED:",
      "WARNINGS:"
    ].join("\n");
  }

  return [
    ...baseContext,
    "Save-for-later shaping:",
    "- Keep this lightweight and defer-oriented.",
    "- Provide only a compact future angle or content idea stub.",
    "- Avoid POST_SEED.",
    "- Avoid COMMENT_SEED.",
    "- Avoid content-forward urgency language.",
    ...contextLines,
    ...learnedGuidance,
    "Return exactly these labels if useful:",
    "CONTENT_IDEA:",
    "ANGLE_STUB:",
    "WARNINGS:"
  ].join("\n");
}

function formatLine(label: string, value: string | undefined): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? `${label}: ${value}` : undefined;
}
