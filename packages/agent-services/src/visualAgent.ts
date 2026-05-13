/**
 * @deprecated This deterministic agent has been superseded by providerBackedVisualService.
 * Use the provider-backed service instead for AI-powered visual generation with deterministic fallback.
 * This agent will be removed in a future version.
 */

import type {
  ContentAsset,
  VisualStatus,
  VisualType
} from "@linkedin-brand-os/shared";

export interface VisualAgentInput {
  content: ContentAsset;
}

export interface VisualAgentOutput {
  title: string;
  visualType: VisualType;
  prompt: string;
  status: VisualStatus;
}

/**
 * @deprecated Use providerBackedVisualService instead.
 */
export async function visualAgent(
  input: VisualAgentInput
): Promise<VisualAgentOutput> {
  return {
    title: `Visual brief for ${input.content.hook}`,
    visualType: "single-image",
    prompt: [
      "Generate a structured visual brief for an internal design or image workflow.",
      `Hook: ${input.content.refinedHook ?? input.content.hook}`,
      `Body summary: ${(input.content.refinedBody ?? input.content.body).slice(0, 180)}`,
      "Style: editorial, minimal, credible, no hype visuals, no generic AI cliches."
    ].join(" "),
    status: "ready"
  };
}

