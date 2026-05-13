import type { ProviderRouter } from "@linkedin-brand-os/ai-providers";
import type { BrandVoiceProfile, Idea } from "@linkedin-brand-os/shared";
import { providerBackedContentService } from "./providerBackedContentService";
import { writingQualityAgent } from "./writingQualityAgent";

export async function providerBackedHumanWritingService(input: {
  idea: Idea;
  router?: ProviderRouter;
  brandVoice?: BrandVoiceProfile | null;
}) {
  const generated = await providerBackedContentService({
    idea: input.idea,
    router: input.router
  });

  const assessed = await writingQualityAgent({
    content: {
      id: "draft-preview",
      hook: generated.hook,
      body: generated.body,
      cta: generated.cta
    },
    brandVoice: input.brandVoice
  });

  return {
    content: {
      ...generated,
      body: assessed.refinement.refinedBody,
      hook: assessed.refinement.refinedHook,
      cta: assessed.refinement.refinedCta,
      qualityStatus: assessed.refinement.qualityStatus,
      overallQualityScore: assessed.refinement.overallQualityScore,
      brandVoiceProfileId: assessed.refinement.brandVoiceProfileId
    },
    assessment: assessed.assessment
  };
}
