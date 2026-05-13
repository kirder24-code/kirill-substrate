import type { ContentAsset } from "@linkedin-brand-os/shared";

export function buildHumanWritingRefinementPrompt(
  content: Pick<ContentAsset, "hook" | "body" | "cta">
): string {
  return [
    "Refine this post to sound more human and grounded.",
    "Avoid generic hype, vague filler, and robotic phrasing.",
    `Hook: ${content.hook}`,
    `Body: ${content.body}`,
    `CTA: ${content.cta}`,
    "Return sections labeled Hook, Body, and CTA."
  ].join("\n");
}
