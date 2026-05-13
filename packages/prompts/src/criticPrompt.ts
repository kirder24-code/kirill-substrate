import type { ContentAsset } from "@linkedin-brand-os/shared";

export function buildCriticPrompt(content: ContentAsset): string {
  return [
    "Review the draft for quality, genericness risk, business value, differentiation, and publish readiness.",
    "Return fields using these labels exactly:",
    "QUALITY_SIGNAL:",
    "GENERICNESS_RISK:",
    "BUSINESS_VALUE_SIGNAL:",
    "DIFFERENTIATION_SIGNAL:",
    "PUBLISH_READY_HINT:",
    "REWRITE_SUGGESTIONS:",
    "CRITIC_NOTES:",
    `Hook: ${content.hook}`,
    `Body: ${content.body}`,
    `CTA: ${content.cta}`,
    "Return strengths, weaknesses, and improvement suggestions."
  ].join("\n");
}
