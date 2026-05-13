import type { ProviderRouter } from "@linkedin-brand-os/ai-providers";
import type {
  BrandVoiceProfile,
  ContentAsset,
  FinalPostGenerationConfig,
  FinalPostOutcomeContext
} from "@linkedin-brand-os/shared";
import { voiceEditorAgent } from "./voiceEditorAgent";
import { finalPostFormatterAgent } from "./finalPostFormatterAgent";
import { validateHook, repairHook } from "./hookValidator";

export async function providerBackedFinalPostService(input: {
  content: ContentAsset;
  router?: ProviderRouter;
  brandVoice?: BrandVoiceProfile | null;
  config?: FinalPostGenerationConfig;
  outcomeContext?: FinalPostOutcomeContext;
}) {
  const providerSource: ContentAsset = {
    ...input.content,
    hook: input.content.refinedHook ?? input.content.hook,
    body: input.content.refinedBody ?? input.content.body,
    cta: input.content.refinedCta ?? input.content.cta
  };

  const fallback = async () => voiceEditorAgent({ content: providerSource });
  const providerDraft = input.router
    ? await input.router.refinePostDraft({
        content: providerSource,
        fallback
      })
    : await fallback();

  const finalization = await finalPostFormatterAgent({
    content: {
      ...input.content,
      refinedHook: providerDraft.refinedHook,
      refinedBody: providerDraft.refinedBody,
      refinedCta: providerDraft.refinedCta
    },
    brandVoice: input.brandVoice,
    config: input.config,
    outcomeContext: input.outcomeContext
  });

  // Hook validity gate: validate and repair if needed
  const hookValidation = validateHook(finalization.finalization.finalHook);
  let finalHook = finalization.finalization.finalHook;

  if (hookValidation.needsRepair) {
    const repairedHook = repairHook(finalHook);
    const repairedValidation = validateHook(repairedHook);

    // Use repaired hook if it's valid or at least better
    if (repairedValidation.valid || repairedValidation.issues.length < hookValidation.issues.length) {
      finalHook = repairedHook;
    }
  }

  return {
    providerDraft,
    finalization: {
      ...finalization.finalization,
      finalHook
    }
  };
}
