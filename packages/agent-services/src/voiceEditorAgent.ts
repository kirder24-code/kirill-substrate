/**
 * @deprecated This deterministic agent has been superseded by providerBackedVoiceEditorService.
 * Use the provider-backed service instead for AI-powered voice editing with deterministic fallback.
 * This agent will be removed in a future version.
 */

import type { ContentAsset, RefinementStatus } from "@linkedin-brand-os/shared";

export interface VoiceEditorAgentInput {
  content: ContentAsset;
}

export interface VoiceEditorAgentOutput {
  refinedHook: string;
  refinedBody: string;
  refinedCta: string;
  refinementStatus: RefinementStatus;
}

/**
 * @deprecated Use providerBackedVoiceEditorService instead.
 */
export async function voiceEditorAgent(
  input: VoiceEditorAgentInput
): Promise<VoiceEditorAgentOutput> {
  return {
    refinedHook: `What leaders actually need to hear about ${input.content.hook
      .replace(/^Most teams miss this about /i, "")
      .trim()}`,
    refinedBody: `${input.content.body} The point is practical: make the business case concrete, keep the language plain, and show the operational payoff.`,
    refinedCta: "If this lines up with what your team is seeing, compare notes.",
    refinementStatus: "refined"
  };
}

