/**
 * @deprecated This deterministic agent has been superseded by providerBackedBusinessTranslatorService.
 * Use the provider-backed service instead for AI-powered business translation with deterministic fallback.
 * This agent will be removed in a future version.
 */

import type { IdeaStatus, Signal } from "@linkedin-brand-os/shared";

export interface BusinessTranslatorAgentInput {
  signal: Signal;
}

export interface BusinessTranslatorAgentOutput {
  title: string;
  coreInsight: string;
  businessRelevance: string;
  targetAudience: string;
  status: IdeaStatus;
}

/**
 * @deprecated Use providerBackedBusinessTranslatorService instead.
 */
export async function businessTranslatorAgent(
  input: BusinessTranslatorAgentInput
): Promise<BusinessTranslatorAgentOutput> {
  const condensedText = input.signal.rawText.trim().replace(/\s+/g, " ");
  const firstSentence = condensedText.split(/[.!?]/)[0] ?? condensedText;

  return {
    title: `${input.signal.title}: a business case for action`,
    coreInsight: firstSentence,
    businessRelevance: `Shows why ${input.signal.title.toLowerCase()} matters to pipeline and execution.`,
    targetAudience: "B2B founders and GTM leaders",
    status: "draft"
  };
}
