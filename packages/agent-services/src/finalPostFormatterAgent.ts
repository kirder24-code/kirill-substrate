/**
 * @deprecated This deterministic agent has been superseded by providerBackedFinalPostService.
 * Use the provider-backed service instead for AI-powered final post formatting with deterministic fallback.
 * This agent will be removed in a future version.
 */

import type {
  BrandVoiceProfile,
  ContentAsset,
  FinalPostGenerationConfig,
  FinalPostOutcomeContext,
  FinalPostQualityMetadata
} from "@linkedin-brand-os/shared";
import { linkedInPostComposer } from "./linkedInPostComposer";

export interface FinalPostFormatterResult {
  finalization: {
    finalHook: string;
    finalBody: string;
    finalClosing: string;
    finalStatus: "ready";
    finalQualityScore: number;
    finalQualityMetadata: FinalPostQualityMetadata;
  };
}

/**
 * @deprecated Use providerBackedFinalPostService instead.
 */
export async function finalPostFormatterAgent(input: {
  content: Pick<
    ContentAsset,
    "hook" | "body" | "cta" | "refinedHook" | "refinedBody" | "refinedCta"
  >;
  brandVoice?: BrandVoiceProfile | null;
  config?: FinalPostGenerationConfig;
  outcomeContext?: FinalPostOutcomeContext;
}): Promise<FinalPostFormatterResult> {
  const composed = await linkedInPostComposer({
    content: input.content,
    brandVoice: input.brandVoice,
    config: input.config,
    outcomeContext: input.outcomeContext
  });

  return {
    finalization: {
      finalHook: composed.hook,
      finalBody: composed.body,
      finalClosing: composed.closing,
      finalStatus: "ready",
      finalQualityScore: composed.qualityScore,
      finalQualityMetadata: composed.qualityMetadata
    }
  };
}
