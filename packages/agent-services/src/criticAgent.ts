/**
 * @deprecated This deterministic agent has been superseded by providerBackedContentCriticService.
 * Use the provider-backed service instead for AI-powered content critique with deterministic fallback.
 * This agent will be removed in a future version.
 */

import type { ContentAsset } from "@linkedin-brand-os/shared";

export interface CriticAgentInput {
  content: ContentAsset;
}

export interface CriticAgentOutput {
  content: ContentAsset;
}

/**
 * @deprecated Use providerBackedContentCriticService instead.
 */
export async function criticAgent(
  input: CriticAgentInput
): Promise<CriticAgentOutput> {
  const cleanedBody = input.content.body.replace(/\s+/g, " ").trim();

  return {
    content: {
      ...input.content,
      hook: input.content.hook.trim(),
      body: cleanedBody,
      cta: input.content.cta.trim()
    }
  };
}
