export interface ScoutEnrichmentPromptInput {
  kind: "audience" | "solution" | "match";
  subject: string;
  whyItMatters: string;
  supportingContext?: string;
  rawExcerpt?: string;
  operatorAction?: string;
}

export function buildScoutEnrichmentPrompt(input: ScoutEnrichmentPromptInput): string {
  const kindSpecificGuidance =
    input.kind === "audience"
      ? [
          "Audience shaping:",
          "- Improved summary should sharpen the pain clearly and concretely.",
          "- Business consequence should explain the practical business cost or operational consequence.",
          "- Avoid generic operator-angle filler if pain clarity and consequence are already strong."
        ]
      : input.kind === "solution"
        ? [
            "Solution shaping:",
            "- Improved summary should read like a concrete implementation lesson, not a slogan.",
            "- Operator angle should explain how an operator could frame or use the lesson.",
            "- Avoid generic business-consequence filler if the lesson and operator angle are already strong."
          ]
        : [
            "Match shaping:",
            "- Why it matters should explain why this pain-to-solution pairing matters now.",
            "- Make the why-it-matters line capture the practical business relevance of the pairing, not just thematic overlap.",
            "- Operator angle should suggest a useful operator/content framing angle for review.",
            "- If the current operator action hint is write_post, bias toward a post-worthy operator/content angle rather than a generic observation.",
            "- If you have both generic thematic overlap and stronger pairing-specific business relevance, prefer the pairing-specific explanation.",
            "- Avoid repeating the deterministic match summary if you can add a clearer why-it-matters angle."
          ];

  return [
    "You are enriching a deterministic scout item for a human operator.",
    "Do not change routing, scoring, matching, or action decisions.",
    "Keep every field concise, high-signal, and non-redundant.",
    "Prefer filling the 1-2 fields that matter most for this scout kind over filling every field.",
    "Return concise plain text using exactly these labels:",
    "Improved summary:",
    "Why it matters:",
    "Business consequence:",
    "Operator angle:",
    "Uncertainty note:",
    "If a field is not useful, write n/a.",
    ...kindSpecificGuidance,
    `Scout kind: ${input.kind}`,
    `Subject: ${input.subject}`,
    `Deterministic why-it-matters: ${input.whyItMatters}`,
    input.supportingContext ? `Supporting context: ${input.supportingContext}` : null,
    input.rawExcerpt ? `Raw excerpt: ${input.rawExcerpt}` : null,
    input.operatorAction ? `Current operator action hint: ${input.operatorAction}` : null
  ]
    .filter(Boolean)
    .join("\n");
}
