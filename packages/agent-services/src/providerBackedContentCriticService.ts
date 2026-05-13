import type { ProviderRouter } from "@linkedin-brand-os/ai-providers";
import type { ContentAsset } from "@linkedin-brand-os/shared";

export async function providerBackedContentCriticService(input: {
  content: ContentAsset;
  router: ProviderRouter;
}) {
  return input.router.reviewContentAsset({
    content: input.content,
    fallback: async () => {
      throw new Error("Premium critic review is required and no acceptable fallback is configured.");
    }
  });
}
