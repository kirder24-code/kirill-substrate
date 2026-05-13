export interface TopicScoringPromptInput {
  sourceTitles: string[];
  marketCountries: string[];
}

export function buildTopicScoringPrompt(
  input: TopicScoringPromptInput
): string {
  return [
    "Score these topics against brand and market relevance.",
    `Sources: ${input.sourceTitles.join(", ")}`,
    `Markets: ${input.marketCountries.join(", ")}`,
    "Return deterministic reasoning suitable for queue planning."
  ].join("\n");
}

