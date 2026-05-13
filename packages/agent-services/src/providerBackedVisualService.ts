import type { ProviderRouter } from "@linkedin-brand-os/ai-providers";
import type { ContentAsset } from "@linkedin-brand-os/shared";
import { visualAgent } from "./visualAgent";

export async function providerBackedVisualService(input: {
  content: ContentAsset;
  router?: ProviderRouter;
}) {
  const fallback = async () => visualAgent({ content: input.content });
  if (!input.router) {
    return fallback();
  }

  return input.router.generateVisualBrief({
    content: input.content,
    fallback
  });
}
