import type { ContentAsset } from "@linkedin-brand-os/shared";

export function buildVisualPrompt(content: ContentAsset): string {
  return [
    "Generate a structured visual brief for a future image workflow.",
    "Do not generate the image itself.",
    `Hook: ${content.refinedHook ?? content.hook}`,
    `Body: ${content.refinedBody ?? content.body}`,
    "Focus on a credible, editorial, internal-tool aesthetic."
  ].join("\n");
}

