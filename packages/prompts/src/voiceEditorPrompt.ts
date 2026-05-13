import type { ContentAsset } from "@linkedin-brand-os/shared";

export function buildVoiceEditorPrompt(content: ContentAsset): string {
  return [
    "Refine this LinkedIn draft into practical, grounded language.",
    "Prefer practical, grounded language over hype. Avoid robotic filler.",
    `Hook: ${content.hook}`,
    `Body: ${content.body}`,
    `CTA: ${content.cta}`
  ].join("\n");
}

