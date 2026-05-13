import type { ContentAsset } from "@linkedin-brand-os/shared";

export function buildWritingQualityPrompt(
  content: Pick<ContentAsset, "hook" | "body">
): string {
  return [
    "Assess this draft for human tone, clarity, groundedness, and anti-robotic phrasing.",
    `Hook: ${content.hook}`,
    `Body: ${content.body}`
  ].join("\n");
}
